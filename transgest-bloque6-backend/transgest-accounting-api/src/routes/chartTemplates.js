require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  classifyTemplateAccounts,
  normalizeTemplateImportInput,
  normalizeTemplateSnapshotInput,
  templateChecksum,
} = require("../domain/chartTemplates");
const { ensureFiscalYearOpen } = require("../domain/fiscalYears");
const { enqueueOutboxEvent } = require("../services/outbox");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function loadFiscalYear(client, fiscalYearId, companyId, forUpdate = false) {
  const { rows } = await client.query(
    `SELECT * FROM ${q("fiscal_years")} WHERE id=$1 AND company_id=$2${forUpdate ? " FOR UPDATE" : ""}`,
    [fiscalYearId, companyId]
  );
  if (!rows.length) throw httpError("Ejercicio no encontrado para la empresa seleccionada", 404);
  return rows[0];
}

async function loadAccessibleTemplate(client, templateId, companyId) {
  const { rows } = await client.query(
    `SELECT t.*, COUNT(ta.id)::integer AS account_count
       FROM ${q("chart_templates")} t
       LEFT JOIN ${q("chart_template_accounts")} ta ON ta.template_id=t.id
      WHERE t.id=$1
        AND t.status='published'
        AND (t.template_scope='system' OR t.company_id=$2)
      GROUP BY t.id`,
    [templateId, companyId]
  );
  if (!rows.length) throw httpError("Plantilla no encontrada o no disponible", 404);
  return rows[0];
}

async function loadTemplateAccounts(client, templateId) {
  const { rows } = await client.query(
    `SELECT code, name, account_type, parent_code, is_postable, notes
       FROM ${q("chart_template_accounts")}
      WHERE template_id=$1
      ORDER BY LENGTH(code), code`,
    [templateId]
  );
  return rows;
}

async function loadExistingAccounts(client, companyId, fiscalYearId) {
  const { rows } = await client.query(
    `SELECT id, code, name, account_type, is_postable
       FROM ${q("accounts")}
      WHERE company_id=$1 AND fiscal_year_id=$2`,
    [companyId, fiscalYearId]
  );
  return rows;
}

router.use(authenticate);

router.get("/chart-templates", requirePermission("templates.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const { rows } = await db.query(
      `SELECT t.id, t.template_scope, t.code, t.name, t.version_label, t.status,
              t.source_type, t.source_url, t.source_checksum, t.effective_from,
              t.created_at, t.published_at, COUNT(ta.id)::integer AS account_count
         FROM ${q("chart_templates")} t
         LEFT JOIN ${q("chart_template_accounts")} ta ON ta.template_id=t.id
        WHERE t.status='published'
          AND (t.template_scope='system' OR t.company_id=$1)
        GROUP BY t.id
        ORDER BY t.template_scope DESC, t.created_at DESC`,
      [selected.company_id]
    );
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/chart-templates/from-fiscal-year", requirePermission("templates.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeTemplateSnapshotInput(req.body);

    const template = await db.transaction(async client => {
      const fiscalYear = await loadFiscalYear(client, input.fiscal_year_id, selected.company_id);
      const sourceAccounts = await client.query(
        `SELECT a.code, a.name, a.account_type, parent.code AS parent_code, a.is_postable, a.notes
           FROM ${q("accounts")} a
           LEFT JOIN ${q("accounts")} parent ON parent.id=a.parent_account_id AND parent.is_active=TRUE
          WHERE a.company_id=$1 AND a.fiscal_year_id=$2 AND a.is_active=TRUE
          ORDER BY LENGTH(a.code), a.code`,
        [selected.company_id, fiscalYear.id]
      );
      if (!sourceAccounts.rows.length) {
        throw httpError("El ejercicio origen no contiene cuentas activas para crear la plantilla", 409);
      }
      const checksum = templateChecksum(sourceAccounts.rows);
      const inserted = await client.query(
        `INSERT INTO ${q("chart_templates")}
           (tenant_id, company_id, template_scope, code, name, version_label, status,
            source_type, source_checksum, effective_from, created_by, published_at)
         VALUES ($1,$2,'company',$3,$4,$5,'published','company_snapshot',$6,$7,$8,NOW())
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.code,
          input.name,
          input.version_label,
          checksum,
          fiscalYear.start_date,
          req.accountingUser.id,
        ]
      ).catch(error => {
        if (error.code === "23505") throw httpError("Ya existe una plantilla con ese codigo y version", 409);
        throw error;
      });
      const created = inserted.rows[0];
      for (const account of sourceAccounts.rows) {
        await client.query(
          `INSERT INTO ${q("chart_template_accounts")}
             (template_id, code, name, account_type, parent_code, is_postable, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [created.id, account.code, account.name, account.account_type, account.parent_code, account.is_postable, account.notes]
        );
      }
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'chart_template.created','chart_template',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          created.id,
          req.id || null,
          JSON.stringify({
            code: created.code,
            version_label: created.version_label,
            source_fiscal_year_id: fiscalYear.id,
            account_count: sourceAccounts.rows.length,
            source_checksum: checksum,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingChartTemplateCreated",
        aggregate_type: "chart_template",
        aggregate_id: created.id,
        payload: {
          template_id: created.id,
          source_fiscal_year_id: fiscalYear.id,
          code: created.code,
          version_label: created.version_label,
          account_count: sourceAccounts.rows.length,
          source_checksum: checksum,
        },
      });
      return { ...created, account_count: sourceAccounts.rows.length };
    });

    res.status(201).json({ template });
  } catch (error) {
    next(error);
  }
});

router.get("/chart-templates/:id/preview", requirePermission("templates.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const fiscalYearId = String(req.query.fiscal_year_id || "").trim();
    if (!fiscalYearId) throw httpError("fiscal_year_id requerido", 400);
    const preview = await db.transaction(async client => {
      const template = await loadAccessibleTemplate(client, req.params.id, selected.company_id);
      const fiscalYear = await loadFiscalYear(client, fiscalYearId, selected.company_id);
      const templateAccounts = await loadTemplateAccounts(client, template.id);
      const existingAccounts = await loadExistingAccounts(client, selected.company_id, fiscalYear.id);
      const classified = classifyTemplateAccounts(templateAccounts, existingAccounts);
      return {
        template,
        fiscal_year: fiscalYear,
        inserted_count: classified.inserted.length,
        matching_count: classified.matching.length,
        conflict_count: classified.conflicts.length,
        conflicts: classified.conflicts.slice(0, 20).map(item => ({
          code: item.template.code,
          template_name: item.template.name,
          existing_name: item.existing.name,
        })),
      };
    });
    res.json({ preview });
  } catch (error) {
    next(error);
  }
});

router.post("/chart-templates/:id/import", requirePermission("templates.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeTemplateImportInput(req.body);

    const result = await db.transaction(async client => {
      const repeated = await client.query(
        `SELECT * FROM ${q("chart_template_imports")} WHERE company_id=$1 AND idempotency_key=$2`,
        [selected.company_id, input.idempotency_key]
      );
      if (repeated.rows.length) {
        const previous = repeated.rows[0];
        if (previous.template_id !== req.params.id || previous.fiscal_year_id !== input.fiscal_year_id) {
          throw httpError("idempotency_key ya utilizado para otra importacion", 409);
        }
        return { import: previous, repeated: true };
      }

      const template = await loadAccessibleTemplate(client, req.params.id, selected.company_id);
      const fiscalYear = await loadFiscalYear(client, input.fiscal_year_id, selected.company_id, true);
      ensureFiscalYearOpen(fiscalYear, "importar plantillas en el plan contable");
      const previousImport = await client.query(
        `SELECT id FROM ${q("chart_template_imports")}
          WHERE company_id=$1 AND fiscal_year_id=$2 AND template_id=$3`,
        [selected.company_id, fiscalYear.id, template.id]
      );
      if (previousImport.rows.length) throw httpError("Esta plantilla ya fue importada en el ejercicio", 409);

      const templateAccounts = await loadTemplateAccounts(client, template.id);
      const existingAccounts = await loadExistingAccounts(client, selected.company_id, fiscalYear.id);
      const accountsByCode = new Map(existingAccounts.map(account => [String(account.code), account]));
      const counts = { inserted: 0, matching: 0, conflicts: 0 };
      const insertedCodes = new Set();

      for (const account of templateAccounts) {
        const existing = accountsByCode.get(String(account.code));
        if (existing) {
          const classified = classifyTemplateAccounts([account], [existing]);
          counts.matching += classified.matching.length;
          counts.conflicts += classified.conflicts.length;
          continue;
        }
        const parent = account.parent_code ? accountsByCode.get(String(account.parent_code)) : null;
        const inserted = await client.query(
          `INSERT INTO ${q("accounts")}
             (tenant_id, company_id, fiscal_year_id, code, name, account_type,
              parent_account_id, is_postable, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (company_id, fiscal_year_id, code) DO NOTHING
           RETURNING id, code, name, account_type, is_postable`,
          [
            selected.tenant_id,
            selected.company_id,
            fiscalYear.id,
            account.code,
            account.name,
            account.account_type,
            parent?.id || null,
            account.is_postable,
            account.notes,
            req.accountingUser.id,
          ]
        );
        if (inserted.rows.length) {
          accountsByCode.set(String(account.code), inserted.rows[0]);
          insertedCodes.add(String(account.code));
          counts.inserted += 1;
        } else {
          const raced = await client.query(
            `SELECT id, code, name, account_type, is_postable
               FROM ${q("accounts")}
              WHERE company_id=$1 AND fiscal_year_id=$2 AND code=$3`,
            [selected.company_id, fiscalYear.id, account.code]
          );
          const classified = classifyTemplateAccounts([account], raced.rows);
          counts.matching += classified.matching.length;
          counts.conflicts += classified.conflicts.length;
          if (raced.rows[0]) accountsByCode.set(String(account.code), raced.rows[0]);
        }
      }

      for (const account of templateAccounts) {
        if (!account.parent_code || !insertedCodes.has(String(account.code))) continue;
        const child = accountsByCode.get(String(account.code));
        const parent = accountsByCode.get(String(account.parent_code));
        if (child && parent) {
          await client.query(
            `UPDATE ${q("accounts")} SET parent_account_id=$1, updated_at=NOW() WHERE id=$2`,
            [parent.id, child.id]
          );
        }
      }

      const imported = await client.query(
        `INSERT INTO ${q("chart_template_imports")}
           (tenant_id, company_id, fiscal_year_id, template_id, idempotency_key,
            template_checksum, inserted_count, matching_count, conflict_count, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          fiscalYear.id,
          template.id,
          input.idempotency_key,
          template.source_checksum,
          counts.inserted,
          counts.matching,
          counts.conflicts,
          req.accountingUser.id,
        ]
      );
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'chart_template.imported','chart_template_import',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          imported.rows[0].id,
          req.id || null,
          JSON.stringify({
            template_id: template.id,
            fiscal_year_id: fiscalYear.id,
            inserted_count: counts.inserted,
            matching_count: counts.matching,
            conflict_count: counts.conflicts,
            template_checksum: template.source_checksum,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingChartTemplateImported",
        aggregate_type: "chart_template_import",
        aggregate_id: imported.rows[0].id,
        payload: {
          import_id: imported.rows[0].id,
          template_id: template.id,
          fiscal_year_id: fiscalYear.id,
          inserted_count: counts.inserted,
          matching_count: counts.matching,
          conflict_count: counts.conflicts,
          template_checksum: template.source_checksum,
        },
      });
      return { import: imported.rows[0], repeated: false };
    });

    res.status(result.repeated ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
