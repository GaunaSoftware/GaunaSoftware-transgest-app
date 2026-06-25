require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  normalizeExternalImportBatchInput,
  normalizeExternalImportQuery,
  normalizeExternalImportReviewInput,
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
              review_reason, created_at, updated_at
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
