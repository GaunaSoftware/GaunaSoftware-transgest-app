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
  mapAccountStagingRow,
  mapBankTransactionStagingRow,
  mapMaturityStagingRow,
  mapPartyStagingRow,
  nextBatchStatus,
} = require("../domain/externalImportStaging");
const { hasPermission } = require("../domain/rbac");
const { enqueueOutboxEvent } = require("../services/outbox");

const router = express.Router();
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function q(name) {
  return `"${config.schema}"."${String(name).replace(/"/g, '""')}"`;
}

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

async function assertFiscalYear(client, selected, fiscalYearId) {
  const id = String(fiscalYearId || "").trim();
  if (!id) {
    const error = new Error("fiscal_year_id requerido para importar cuentas");
    error.status = 400;
    throw error;
  }
  const result = await client.query(
    `SELECT id, year_label
       FROM ${q("fiscal_years")}
      WHERE id=$1 AND company_id=$2`,
    [id, selected.company_id]
  );
  if (!result.rows.length) {
    const error = new Error("Ejercicio no encontrado para la empresa seleccionada");
    error.status = 404;
    throw error;
  }
  return result.rows[0];
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

async function buildAccountImportPreview(client, selected, batch, fiscalYearId) {
  const fiscalYear = await assertFiscalYear(client, selected, fiscalYearId);
  const rowsResult = await client.query(
    `SELECT id, row_number, row_hash, status, raw_payload, normalized_payload, errors, warnings
       FROM ${q("external_import_rows")}
      WHERE batch_id=$1 AND company_id=$2
      ORDER BY row_number`,
    [batch.id, selected.company_id]
  );
  const codes = rowsResult.rows
    .map(row => mapAccountStagingRow(row).mapped.code)
    .filter(Boolean);
  const existing = codes.length ? await client.query(
    `SELECT id, code, name, account_type
       FROM ${q("accounts")}
      WHERE company_id=$1 AND fiscal_year_id=$2 AND code=ANY($3::text[])`,
    [selected.company_id, fiscalYear.id, codes]
  ) : { rows: [] };
  const byCode = new Map(existing.rows.map(row => [row.code, row]));

  const previewRows = rowsResult.rows.map(row => {
    const mapped = mapAccountStagingRow(row);
    const accountConflict = mapped.mapped.code ? byCode.get(mapped.mapped.code) || null : null;
    const conflicts = accountConflict ? [{ code: "account_code_exists", account: accountConflict }] : [];
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
    fiscal_year: fiscalYear,
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

async function buildMaturityImportPreview(client, selected, batch) {
  const rowsResult = await client.query(
    `SELECT id, row_number, row_hash, status, raw_payload, normalized_payload, errors, warnings
       FROM ${q("external_import_rows")}
      WHERE batch_id=$1 AND company_id=$2
      ORDER BY row_number`,
    [batch.id, selected.company_id]
  );
  const mappedRows = rowsResult.rows.map(row => ({ row, mapped: mapMaturityStagingRow(row) }));
  const partyIds = mappedRows
    .map(item => item.mapped.mapped.party_id)
    .filter(value => /^[0-9a-fA-F-]{36}$/.test(String(value || "")));
  const taxIds = mappedRows.map(item => item.mapped.mapped.party_tax_id).filter(Boolean);
  const names = mappedRows.map(item => item.mapped.mapped.party_name).filter(Boolean);
  const sourceIds = rowsResult.rows.map(row => row.row_hash);

  const parties = await client.query(
    `SELECT id, legal_name, tax_id
       FROM ${q("accounting_parties")}
      WHERE company_id=$1 AND is_active=TRUE
        AND (
          id=ANY($2::uuid[])
          OR (cardinality($3::text[]) > 0 AND tax_id=ANY($3::text[]))
          OR (cardinality($4::text[]) > 0 AND legal_name=ANY($4::text[]))
        )`,
    [selected.company_id, partyIds, taxIds, names]
  );
  const existing = sourceIds.length ? await client.query(
    `SELECT id, source_id, document_ref, description
       FROM ${q("accounting_maturities")}
      WHERE company_id=$1 AND source_system=$2 AND source_type='external_import' AND source_id=ANY($3::text[])`,
    [selected.company_id, batch.provider_id, sourceIds]
  ) : { rows: [] };
  const byPartyId = new Map(parties.rows.map(row => [row.id, row]));
  const byTax = new Map(parties.rows.filter(row => row.tax_id).map(row => [row.tax_id, row]));
  const byName = new Map(parties.rows.map(row => [row.legal_name, row]));
  const bySource = new Map(existing.rows.map(row => [row.source_id, row]));

  const previewRows = mappedRows.map(({ row, mapped }) => {
    const resolvedParty = mapped.mapped.party_id
      ? byPartyId.get(mapped.mapped.party_id) || null
      : mapped.mapped.party_tax_id
        ? byTax.get(mapped.mapped.party_tax_id) || null
        : byName.get(mapped.mapped.party_name) || null;
    const sourceConflict = bySource.get(row.row_hash) || null;
    const errors = [...(row.errors || []), ...mapped.errors];
    if (!resolvedParty && !errors.some(error => error.code === "missing_party_reference")) {
      errors.push({ code: "party_not_found", message: "Tercero no encontrado o inactivo" });
    }
    const conflicts = sourceConflict ? [{ code: "maturity_source_exists", maturity: sourceConflict }] : [];
    const action = errors.length ? "error" : conflicts.length ? "conflict" : "create";
    return {
      row_id: row.id,
      row_number: row.row_number,
      row_hash: row.row_hash,
      action,
      mapped: { ...mapped.mapped, party_id: resolvedParty?.id || mapped.mapped.party_id || null, party_name: resolvedParty?.legal_name || mapped.mapped.party_name },
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

async function buildBankTransactionImportPreview(client, selected, batch) {
  const rowsResult = await client.query(
    `SELECT id, row_number, row_hash, status, raw_payload, normalized_payload, errors, warnings
       FROM ${q("external_import_rows")}
      WHERE batch_id=$1 AND company_id=$2
      ORDER BY row_number`,
    [batch.id, selected.company_id]
  );
  const mappedRows = rowsResult.rows.map(row => ({ row, mapped: mapBankTransactionStagingRow(row) }));
  const bankAccountIds = mappedRows
    .map(item => item.mapped.mapped.bank_account_id)
    .filter(value => UUID_RE.test(String(value || "")));
  const ibans = mappedRows.map(item => item.mapped.mapped.iban).filter(Boolean);
  const sourceIds = rowsResult.rows.map(row => row.row_hash);

  const accounts = await client.query(
    `SELECT id, name, iban, currency
       FROM ${q("accounting_bank_accounts")}
      WHERE company_id=$1 AND is_active=TRUE
        AND (
          id=ANY($2::uuid[])
          OR (cardinality($3::text[]) > 0 AND iban=ANY($3::text[]))
        )`,
    [selected.company_id, bankAccountIds, ibans]
  );
  const existing = sourceIds.length ? await client.query(
    `SELECT id, bank_account_id, source_id, transaction_date, description, amount::text, direction
       FROM ${q("bank_transactions")}
      WHERE company_id=$1 AND source_system=$2 AND source_type='external_import' AND source_id=ANY($3::text[])`,
    [selected.company_id, batch.provider_id, sourceIds]
  ) : { rows: [] };
  const byId = new Map(accounts.rows.map(row => [row.id, row]));
  const byIban = new Map(accounts.rows.filter(row => row.iban).map(row => [row.iban, row]));
  const bySource = new Map(existing.rows.map(row => [`${row.bank_account_id}:${row.source_id}`, row]));

  const previewRows = mappedRows.map(({ row, mapped }) => {
    const resolvedBankAccount = mapped.mapped.bank_account_id
      ? byId.get(mapped.mapped.bank_account_id) || null
      : byIban.get(mapped.mapped.iban) || null;
    const errors = [...(row.errors || []), ...mapped.errors];
    if (!resolvedBankAccount && !errors.some(error => error.code === "missing_bank_account_reference" || error.code === "invalid_bank_account_id" || error.code === "invalid_iban")) {
      errors.push({ code: "bank_account_not_found", message: "Cuenta bancaria no encontrada o inactiva" });
    }
    const sourceConflict = resolvedBankAccount ? bySource.get(`${resolvedBankAccount.id}:${row.row_hash}`) || null : null;
    const conflicts = sourceConflict ? [{ code: "bank_transaction_source_exists", bank_transaction: sourceConflict }] : [];
    const action = errors.length ? "error" : conflicts.length ? "conflict" : "create";
    return {
      row_id: row.id,
      row_number: row.row_number,
      row_hash: row.row_hash,
      action,
      mapped: {
        ...mapped.mapped,
        bank_account_id: resolvedBankAccount?.id || mapped.mapped.bank_account_id || null,
        bank_account_name: resolvedBankAccount?.name || null,
        currency: resolvedBankAccount?.currency || "EUR",
      },
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

function permissionForImportType(importType) {
  if (importType === "parties") return "parties.write";
  if (importType === "accounts") return "accounts.write";
  if (importType === "maturities") return "maturities.write";
  if (importType === "bank_transactions") return "banks.write";
  return null;
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
      const batch = batchResult.rows[0];
      if (batch.import_type === "parties") return buildPartyImportPreview(client, selected, batch);
      if (batch.import_type === "accounts") return buildAccountImportPreview(client, selected, batch, req.query.fiscal_year_id);
      if (batch.import_type === "maturities") return buildMaturityImportPreview(client, selected, batch);
      if (batch.import_type === "bank_transactions") return buildBankTransactionImportPreview(client, selected, batch);
      return {
        batch,
        supported: false,
        reason: "unsupported_import_type",
        summary: { rows: 0, create: 0, conflict: 0, error: 0 },
        rows: [],
      };
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
        const requiredPermission = permissionForImportType(batch.import_type);
        if (!requiredPermission || !hasPermission(req.accountingUser, requiredPermission)) {
          const error = new Error("Permiso contable denegado");
          error.status = 403;
          error.permission = requiredPermission || "unsupported_import_type";
          throw error;
        }
        const preview = batch.import_type === "accounts"
          ? await buildAccountImportPreview(client, selected, batch, req.body?.fiscal_year_id)
          : batch.import_type === "maturities"
            ? await buildMaturityImportPreview(client, selected, batch)
            : batch.import_type === "bank_transactions"
              ? await buildBankTransactionImportPreview(client, selected, batch)
              : await buildPartyImportPreview(client, selected, batch);

        if (batch.status === "applied") {
          const sourceIds = preview.rows.map(row => row.row_hash);
          const existing = batch.import_type === "accounts"
            ? (sourceIds.length ? await client.query(
              `SELECT id, code, name, account_type
                 FROM ${q("accounts")}
                WHERE company_id=$1 AND fiscal_year_id=$2 AND notes ILIKE $3
                ORDER BY code`,
              [selected.company_id, preview.fiscal_year?.id || req.body?.fiscal_year_id, `%${batch.id}%`]
            ) : { rows: [] })
            : batch.import_type === "maturities"
              ? (sourceIds.length ? await client.query(
                `SELECT id, source_id, direction, due_date, document_ref, description, amount::text
                   FROM ${q("accounting_maturities")}
                  WHERE company_id=$1 AND source_system=$2 AND source_type='external_import' AND source_id=ANY($3::text[])
                  ORDER BY due_date, document_ref`,
                [selected.company_id, batch.provider_id, sourceIds]
              ) : { rows: [] })
              : batch.import_type === "bank_transactions"
                ? (sourceIds.length ? await client.query(
                  `SELECT id, bank_account_id, source_id, transaction_date, description, amount::text, direction, status
                     FROM ${q("bank_transactions")}
                    WHERE company_id=$1 AND source_system=$2 AND source_type='external_import' AND source_id=ANY($3::text[])
                    ORDER BY transaction_date DESC, description`,
                  [selected.company_id, batch.provider_id, sourceIds]
                ) : { rows: [] })
                : (sourceIds.length ? await client.query(
                  `SELECT id, source_party_id, party_type, legal_name, tax_id
                     FROM ${q("accounting_parties")}
                    WHERE company_id=$1 AND source_system=$2 AND source_party_id=ANY($3::text[])
                    ORDER BY legal_name`,
                  [selected.company_id, batch.provider_id, sourceIds]
                ) : { rows: [] });
          return {
            batch,
            preview,
            records: existing.rows,
            parties: batch.import_type === "parties" ? existing.rows : [],
            accounts: batch.import_type === "accounts" ? existing.rows : [],
            maturities: batch.import_type === "maturities" ? existing.rows : [],
            bank_transactions: batch.import_type === "bank_transactions" ? existing.rows : [],
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
        const createdAccounts = [];
        const createdMaturities = [];
        const createdBankTransactions = [];
        for (const row of preview.rows.filter(item => item.action === "create")) {
          if (batch.import_type === "bank_transactions") {
            const created = await client.query(
              `INSERT INTO ${q("bank_transactions")}
                 (tenant_id, company_id, bank_account_id, transaction_date, value_date, description,
                  reference, counterparty_name, amount, direction, source_system, source_type,
                  source_id, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'external_import',$12,$13,$14)
               RETURNING id, tenant_id, company_id, bank_account_id, transaction_date, value_date,
                         description, reference, counterparty_name, amount::text, direction, status,
                         source_system, source_type, source_id, notes, created_at, updated_at`,
              [
                selected.tenant_id,
                selected.company_id,
                row.mapped.bank_account_id,
                row.mapped.transaction_date,
                row.mapped.value_date || null,
                row.mapped.description,
                row.mapped.reference || null,
                row.mapped.counterparty_name || null,
                row.mapped.amount,
                row.mapped.direction,
                batch.provider_id,
                row.row_hash,
                `Importado desde lote externo ${batch.id}, fila ${row.row_number}. ${input.reason}${row.mapped.notes ? ` ${row.mapped.notes}` : ""}`,
                req.accountingUser.id,
              ]
            );
            const bankTransaction = created.rows[0];
            createdBankTransactions.push(bankTransaction);
            await client.query(
              `INSERT INTO ${q("audit_log")}
                 (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
               VALUES ($1,$2,'user',$3,'bank_transaction.created_from_external_import','bank_transaction',$4,$5,$6::jsonb)`,
              [
                selected.tenant_id,
                selected.company_id,
                req.accountingUser.id,
                bankTransaction.id,
                req.id || null,
                JSON.stringify({
                  import_batch_id: batch.id,
                  bank_account_id: bankTransaction.bank_account_id,
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
              event_type: "AccountingBankTransactionCreated",
              aggregate_type: "bank_transaction",
              aggregate_id: bankTransaction.id,
              payload: {
                bank_transaction_id: bankTransaction.id,
                bank_account_id: bankTransaction.bank_account_id,
                transaction_date: String(bankTransaction.transaction_date).slice(0, 10),
                direction: bankTransaction.direction,
                amount: String(bankTransaction.amount),
                status: bankTransaction.status,
              },
            });
            continue;
          }

          if (batch.import_type === "accounts") {
            const created = await client.query(
              `INSERT INTO ${q("accounts")}
                 (tenant_id, company_id, fiscal_year_id, code, name, account_type,
                  parent_account_id, is_postable, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9)
               RETURNING id, tenant_id, company_id, fiscal_year_id, code, name,
                         account_type, is_postable, is_active, notes, created_at, updated_at`,
              [
                selected.tenant_id,
                selected.company_id,
                preview.fiscal_year.id,
                row.mapped.code,
                row.mapped.name,
                row.mapped.account_type,
                row.mapped.is_postable,
                `Importado desde lote externo ${batch.id}, fila ${row.row_number}. ${input.reason}${row.mapped.notes ? ` ${row.mapped.notes}` : ""}`,
                req.accountingUser.id,
              ]
            );
            const account = created.rows[0];
            createdAccounts.push(account);
            await client.query(
              `INSERT INTO ${q("audit_log")}
                 (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
               VALUES ($1,$2,'user',$3,'account.created_from_external_import','account',$4,$5,$6::jsonb)`,
              [
                selected.tenant_id,
                selected.company_id,
                req.accountingUser.id,
                account.id,
                req.id || null,
                JSON.stringify({
                  import_batch_id: batch.id,
                  fiscal_year_id: account.fiscal_year_id,
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
              event_type: "AccountingAccountCreated",
              aggregate_type: "account",
              aggregate_id: account.id,
              payload: {
                account_id: account.id,
                fiscal_year_id: account.fiscal_year_id,
                code: account.code,
                name: account.name,
                account_type: account.account_type,
                is_postable: account.is_postable,
              },
            });
            continue;
          }

          if (batch.import_type === "maturities") {
            const created = await client.query(
              `INSERT INTO ${q("accounting_maturities")}
                 (tenant_id, company_id, party_id, direction, issue_date, due_date, document_ref,
                  description, amount, open_amount, currency, payment_method, source_system,
                  source_type, source_id, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'EUR',$10,$11,'external_import',$12,$13,$14)
               RETURNING id, tenant_id, company_id, party_id, direction, issue_date, due_date,
                         document_ref, description, amount::text, open_amount::text, currency,
                         payment_method, status, source_system, source_type, source_id, notes,
                         created_at, updated_at`,
              [
                selected.tenant_id,
                selected.company_id,
                row.mapped.party_id,
                row.mapped.direction,
                row.mapped.issue_date || null,
                row.mapped.due_date,
                row.mapped.document_ref || null,
                row.mapped.description || row.mapped.document_ref || row.mapped.party_name,
                row.mapped.amount,
                row.mapped.payment_method || null,
                batch.provider_id,
                row.row_hash,
                `Importado desde lote externo ${batch.id}, fila ${row.row_number}. ${input.reason}${row.mapped.notes ? ` ${row.mapped.notes}` : ""}`,
                req.accountingUser.id,
              ]
            );
            const maturity = created.rows[0];
            createdMaturities.push(maturity);
            await client.query(
              `INSERT INTO ${q("audit_log")}
                 (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
               VALUES ($1,$2,'user',$3,'maturity.created_from_external_import','accounting_maturity',$4,$5,$6::jsonb)`,
              [
                selected.tenant_id,
                selected.company_id,
                req.accountingUser.id,
                maturity.id,
                req.id || null,
                JSON.stringify({
                  import_batch_id: batch.id,
                  party_id: maturity.party_id,
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
              event_type: "AccountingMaturityCreated",
              aggregate_type: "accounting_maturity",
              aggregate_id: maturity.id,
              payload: {
                maturity_id: maturity.id,
                party_id: maturity.party_id,
                direction: maturity.direction,
                due_date: String(maturity.due_date).slice(0, 10),
                amount: String(maturity.amount),
                status: maturity.status,
              },
            });
            continue;
          }

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
          [req.accountingUser.id, createdParties.length + createdAccounts.length + createdMaturities.length + createdBankTransactions.length, 0, input.reason, batch.id]
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
              applied_count: createdParties.length + createdAccounts.length + createdMaturities.length + createdBankTransactions.length,
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
            applied_count: createdParties.length + createdAccounts.length + createdMaturities.length + createdBankTransactions.length,
            skipped_count: 0,
          },
        });

        return {
          batch: appliedBatch,
          preview,
          records: batch.import_type === "accounts" ? createdAccounts : batch.import_type === "maturities" ? createdMaturities : batch.import_type === "bank_transactions" ? createdBankTransactions : createdParties,
          parties: createdParties,
          accounts: createdAccounts,
          maturities: createdMaturities,
          bank_transactions: createdBankTransactions,
          repeated: false,
          summary: { applied: createdParties.length + createdAccounts.length + createdMaturities.length + createdBankTransactions.length, skipped: 0 },
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
