require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  normalizeExternalImportBatchInput,
  normalizeExternalImportQuery,
  normalizeExternalImportReviewInput,
  normalizeExternalImportApplyInput,
  mapPartyStagingRow,
  nextBatchStatus,
} = require("../domain/externalImportStaging");
const { enqueueOutboxEvent } = require("../services/outbox");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${String(name).replace(/"/g, '""')}"`;
}

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

async function buildPartyImportPreview(client, selected, batch) {
  const rowsResult = await client.query(
    `SELECT id, row_number, row_hash, status, raw_payload, normalized_payload, errors, warnings
       FROM ${q("external_import_rows")}
      WHERE batch_id=$1 AND company_id=$2
      ORDER BY row_number`,
    [batch.id, selected.company_id]
  );
  if (batch.import_type !== "parties") {
    return {
      batch,
      supported: false,
      reason: "unsupported_import_type",
      summary: { rows: rowsResult.rows.length, create: 0, conflict: 0, error: rowsResult.rows.length },
      rows: rowsResult.rows.map(row => ({
        row_id: row.id,
        row_number: row.row_number,
        action: "unsupported",
        errors: [{ code: "unsupported_import_type", message: "La previsualizacion especifica solo soporta terceros en esta fase" }],
        warnings: row.warnings || [],
        conflicts: [],
        mapped: null,
      })),
    };
  }

  const sourceSystem = batch.provider_id;
  const sourceIds = rowsResult.rows.map(row => row.row_hash);
  const taxIds = rowsResult.rows
    .map(row => mapPartyStagingRow(row).mapped.tax_id)
    .filter(Boolean);
  const sourceConflicts = sourceIds.length ? await client.query(
    `SELECT source_party_id, id, legal_name, tax_id
       FROM ${q("accounting_parties")}
      WHERE company_id=$1 AND source_system=$2 AND source_party_id=ANY($3::text[])`,
    [selected.company_id, sourceSystem, sourceIds]
  ) : { rows: [] };
  const taxConflicts = taxIds.length ? await client.query(
    `SELECT id, legal_name, tax_id
       FROM ${q("accounting_parties")}
      WHERE company_id=$1 AND tax_id=ANY($2::text[])`,
    [selected.company_id, taxIds]
  ) : { rows: [] };
  const bySource = new Map(sourceConflicts.rows.map(row => [row.source_party_id, row]));
  const byTax = new Map(taxConflicts.rows.map(row => [row.tax_id, row]));

  const previewRows = rowsResult.rows.map(row => {
    const mapped = mapPartyStagingRow(row);
    const sourceConflict = bySource.get(row.row_hash) || null;
    const taxConflict = mapped.mapped.tax_id ? byTax.get(mapped.mapped.tax_id) || null : null;
    const conflicts = [
      ...(sourceConflict ? [{ code: "source_exists", party: sourceConflict }] : []),
      ...(taxConflict ? [{ code: "tax_id_exists", party: taxConflict }] : []),
    ];
    const errors = [...(row.errors || []), ...mapped.errors];
    const action = errors.length ? "error" : conflicts.length ? "conflict" : "create";
    return {
      row_id: row.id,
      row_number: row.row_number,
      row_hash: row.row_hash,
      action,
      mapped: mapped.mapped,
      errors,
      warnings: [...(row.warnings || []), ...mapped.warnings],
      conflicts,
    };
  });

  return {
    batch,
    supported: true,
    summary: {
      rows: previewRows.length,
      create: previewRows.filter(row => row.action === "create").length,
      conflict: previewRows.filter(row => row.action === "conflict").length,
      error: previewRows.filter(row => row.action === "error").length,
    },
    rows: previewRows,
  };
}

router.use(authenticate);

router.get("/external-import-batches", requirePermission("external_imports.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeExternalImportQuery(req.query);
    const params = [selected.company_id];
    const where = ["company_id=$1"];
    if (filters.status) {
      params.push(filters.status);
      where.push(`status=$${params.length}`);
    }
    if (filters.provider_id) {
      params.push(filters.provider_id);
      where.push(`provider_id=$${params.length}`);
    }
    if (filters.import_type) {
      params.push(filters.import_type);
      where.push(`import_type=$${params.length}`);
    }
    params.push(filters.limit);
    const { rows } = await db.transaction(client => client.query(
      `SELECT id, tenant_id, company_id, provider_id, import_type, source_format,
              original_filename, status, row_count, valid_count, error_count,
              warning_count, notes, staged_by, reviewed_by, reviewed_at,
              review_reason, applied_by, applied_at, applied_count, skipped_count,
              created_at, updated_at
         FROM ${q("external_import_batches")}
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params
    ));
    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.get("/external-import-batches/:id", requirePermission("external_imports.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const result = await db.transaction(async client => {
      const batch = await client.query(
        `SELECT *
           FROM ${q("external_import_batches")}
          WHERE id=$1 AND company_id=$2`,
        [req.params.id, selected.company_id]
      );
      if (!batch.rows.length) {
        const error = new Error("Lote staged no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const rows = await client.query(
        `SELECT id, row_number, row_hash, status, raw_payload, normalized_payload,
                errors, warnings, created_at
           FROM ${q("external_import_rows")}
          WHERE batch_id=$1 AND company_id=$2
          ORDER BY row_number`,
        [req.params.id, selected.company_id]
      );
      return { batch: batch.rows[0], rows: rows.rows };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/external-import-batches/:id/preview", requirePermission("external_imports.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const result = await db.transaction(async client => {
      const batchResult = await client.query(
        `SELECT *
           FROM ${q("external_import_batches")}
          WHERE id=$1 AND company_id=$2`,
        [req.params.id, selected.company_id]
      );
      if (!batchResult.rows.length) {
        const error = new Error("Lote staged no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      return buildPartyImportPreview(client, selected, batchResult.rows[0]);
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/external-import-batches", requirePermission("external_imports.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeExternalImportBatchInput(req.body);

    const result = await db.transaction(async client => {
      const existing = await client.query(
        `SELECT *
           FROM ${q("external_import_batches")}
          WHERE company_id=$1 AND request_hash=$2`,
        [selected.company_id, input.request_hash]
      );
      if (existing.rows.length) {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'external_import_batch.reused','external_import_batch',$4,$5,$6::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            existing.rows[0].id,
            req.id || null,
            JSON.stringify({ provider_id: input.provider_id, import_type: input.import_type, request_hash: input.request_hash }),
          ]
        );
        return { batch: existing.rows[0], rows: [], repeated: true };
      }

      const inserted = await client.query(
        `INSERT INTO ${q("external_import_batches")}
           (tenant_id, company_id, provider_id, import_type, source_format,
            original_filename, request_hash, row_count, valid_count, error_count,
            warning_count, notes, staged_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.provider_id,
          input.import_type,
          input.source_format,
          input.original_filename,
          input.request_hash,
          input.row_count,
          input.valid_count,
          input.error_count,
          input.warning_count,
          input.notes,
          req.accountingUser.id,
        ]
      );
      const batch = inserted.rows[0];
      const stagedRows = [];
      for (const row of input.rows) {
        const created = await client.query(
          `INSERT INTO ${q("external_import_rows")}
             (tenant_id, company_id, batch_id, row_number, row_hash, status,
              raw_payload, normalized_payload, errors, warnings)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
           RETURNING id, row_number, row_hash, status, raw_payload, normalized_payload, errors, warnings, created_at`,
          [
            selected.tenant_id,
            selected.company_id,
            batch.id,
            row.row_number,
            row.row_hash,
            row.status,
            JSON.stringify(row.raw_payload),
            JSON.stringify(row.normalized_payload),
            JSON.stringify(row.errors),
            JSON.stringify(row.warnings),
          ]
        );
        stagedRows.push(created.rows[0]);
      }

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'external_import_batch.staged','external_import_batch',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          batch.id,
          req.id || null,
          JSON.stringify({
            provider_id: input.provider_id,
            import_type: input.import_type,
            source_format: input.source_format,
            provider_known: input.provider_known,
            row_count: input.row_count,
            error_count: input.error_count,
            warning_count: input.warning_count,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingExternalImportBatchStaged",
        aggregate_type: "external_import_batch",
        aggregate_id: batch.id,
        payload: {
          import_batch_id: batch.id,
          provider_id: batch.provider_id,
          import_type: batch.import_type,
          row_count: batch.row_count,
          error_count: batch.error_count,
        },
      });
      return { batch, rows: stagedRows, repeated: false };
    });

    res.status(result.repeated ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/external-import-batches/:id/apply",
  requirePermission("external_imports.write"),
  requirePermission("parties.write"),
  async (req, res, next) => {
    try {
      const selected = selectedContext(req);
      if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
      const input = normalizeExternalImportApplyInput(req.body);
      const result = await db.transaction(async client => {
        const current = await client.query(
          `SELECT *
             FROM ${q("external_import_batches")}
            WHERE id=$1 AND company_id=$2
            FOR UPDATE`,
          [req.params.id, selected.company_id]
        );
        if (!current.rows.length) {
          const error = new Error("Lote staged no encontrado para la empresa seleccionada");
          error.status = 404;
          throw error;
        }
        const batch = current.rows[0];
        const preview = await buildPartyImportPreview(client, selected, batch);

        if (batch.status === "applied") {
          const existing = preview.rows.length ? await client.query(
            `SELECT id, source_party_id, party_type, legal_name, tax_id
               FROM ${q("accounting_parties")}
              WHERE company_id=$1 AND source_system=$2 AND source_party_id=ANY($3::text[])
              ORDER BY legal_name`,
            [selected.company_id, batch.provider_id, preview.rows.map(row => row.row_hash)]
          ) : { rows: [] };
          return {
            batch,
            preview,
            parties: existing.rows,
            repeated: true,
            summary: { applied: existing.rows.length, skipped: Math.max(0, preview.rows.length - existing.rows.length) },
          };
        }

        if (batch.status !== "approved") {
          const error = new Error("Solo se pueden aplicar lotes aprobados");
          error.status = 409;
          throw error;
        }
        if (!preview.supported) {
          const error = new Error("Este tipo de lote no se puede aplicar en esta fase");
          error.status = 409;
          throw error;
        }
        if (preview.summary.error > 0 || preview.summary.conflict > 0) {
          const error = new Error("El lote tiene errores o conflictos; revisa la previsualizacion antes de aplicar");
          error.status = 409;
          error.details = preview.summary;
          throw error;
        }

        const createdParties = [];
        for (const row of preview.rows.filter(item => item.action === "create")) {
          const created = await client.query(
            `INSERT INTO ${q("accounting_parties")}
               (tenant_id, company_id, source_system, source_party_id, party_type, legal_name,
                tax_id, email, phone, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING id, tenant_id, company_id, source_system, source_party_id, party_type,
                       legal_name, tax_id, email, phone, is_active, created_at, updated_at`,
            [
              selected.tenant_id,
              selected.company_id,
              batch.provider_id,
              row.row_hash,
              row.mapped.party_type,
              row.mapped.legal_name,
              row.mapped.tax_id || null,
              row.mapped.email || null,
              row.mapped.phone || null,
              `Importado desde lote externo ${batch.id}, fila ${row.row_number}. ${input.reason}`,
            ]
          );
          const party = created.rows[0];
          createdParties.push(party);
          await client.query(
            `INSERT INTO ${q("audit_log")}
               (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
             VALUES ($1,$2,'user',$3,'party.created_from_external_import','accounting_party',$4,$5,$6::jsonb)`,
            [
              selected.tenant_id,
              selected.company_id,
              req.accountingUser.id,
              party.id,
              req.id || null,
              JSON.stringify({
                import_batch_id: batch.id,
                row_number: row.row_number,
                row_hash: row.row_hash,
                provider_id: batch.provider_id,
                reason: input.reason,
              }),
            ]
          );
          await enqueueOutboxEvent(client, {
            tenant_id: selected.tenant_id,
            company_id: selected.company_id,
            event_type: "AccountingPartyCreated",
            aggregate_type: "accounting_party",
            aggregate_id: party.id,
            payload: {
              party_id: party.id,
              party_type: party.party_type,
              legal_name: party.legal_name,
              is_active: party.is_active,
            },
          });
        }

        const updated = await client.query(
          `UPDATE ${q("external_import_batches")}
              SET status='applied',
                  applied_by=$1,
                  applied_at=NOW(),
                  applied_count=$2,
                  skipped_count=$3,
                  review_reason=COALESCE(review_reason, $4),
                  updated_at=NOW()
            WHERE id=$5
            RETURNING *`,
          [req.accountingUser.id, createdParties.length, 0, input.reason, batch.id]
        );
        const appliedBatch = updated.rows[0];

        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'external_import_batch.applied','external_import_batch',$4,$5,$6::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            appliedBatch.id,
            req.id || null,
            JSON.stringify({
              import_type: appliedBatch.import_type,
              provider_id: appliedBatch.provider_id,
              applied_count: createdParties.length,
              skipped_count: 0,
              reason: input.reason,
            }),
          ]
        );
        await enqueueOutboxEvent(client, {
          tenant_id: selected.tenant_id,
          company_id: selected.company_id,
          event_type: "AccountingExternalImportBatchApplied",
          aggregate_type: "external_import_batch",
          aggregate_id: appliedBatch.id,
          payload: {
            import_batch_id: appliedBatch.id,
            import_type: appliedBatch.import_type,
            applied_count: createdParties.length,
            skipped_count: 0,
          },
        });

        return {
          batch: appliedBatch,
          preview,
          parties: createdParties,
          repeated: false,
          summary: { applied: createdParties.length, skipped: 0 },
        };
      });
      res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch("/external-import-batches/:id/status", requirePermission("external_imports.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const review = normalizeExternalImportReviewInput(req.body);
    const result = await db.transaction(async client => {
      const current = await client.query(
        `SELECT *
           FROM ${q("external_import_batches")}
          WHERE id=$1 AND company_id=$2
          FOR UPDATE`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) {
        const error = new Error("Lote staged no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const previous = current.rows[0];
      if (review.action === "approve" && Number(previous.error_count) > 0) {
        const error = new Error("No se puede aprobar un lote con filas en error");
        error.status = 409;
        throw error;
      }
      const status = nextBatchStatus(previous.status, review);
      const updated = await client.query(
        `UPDATE ${q("external_import_batches")}
            SET status=$1, reviewed_by=$2, reviewed_at=NOW(), review_reason=$3, updated_at=NOW()
          WHERE id=$4
          RETURNING *`,
        [status, req.accountingUser.id, review.reason, previous.id]
      );
      const batch = updated.rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'external_import_batch.status_changed','external_import_batch',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          batch.id,
          req.id || null,
          JSON.stringify({ previous_status: previous.status, status, action: review.action, reason: review.reason }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingExternalImportBatchStatusChanged",
        aggregate_type: "external_import_batch",
        aggregate_id: batch.id,
        payload: {
          import_batch_id: batch.id,
          previous_status: previous.status,
          status,
          action: review.action,
          reason: review.reason,
        },
      });
      return { batch };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
