require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const { buildCsv } = require("../domain/csv");
const {
  buildStraightLineDepreciationPlan,
  normalizeFixedAssetInput,
  normalizeFixedAssetQuery,
  normalizeFixedAssetStatusInput,
  nextStatusForAction,
} = require("../domain/fixedAssets");
const { enqueueOutboxEvent } = require("../services/outbox");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

function compactFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

async function assertFiscalYear(client, companyId, fiscalYearId) {
  const { rows } = await client.query(
    `SELECT id, year_label FROM ${q("fiscal_years")} WHERE id=$1 AND company_id=$2`,
    [fiscalYearId, companyId]
  );
  if (!rows.length) {
    const error = new Error("Ejercicio no encontrado para la empresa seleccionada");
    error.status = 400;
    throw error;
  }
  return rows[0];
}

async function assertOptionalAccount(client, companyId, accountId, field) {
  if (!accountId) return null;
  const { rows } = await client.query(
    `SELECT id, code, name FROM ${q("accounts")} WHERE id=$1 AND company_id=$2 AND is_active=TRUE`,
    [accountId, companyId]
  );
  if (!rows.length) {
    const error = new Error(`${field} no existe o no esta activa en la empresa seleccionada`);
    error.status = 400;
    throw error;
  }
  return rows[0];
}

async function loadFixedAssetRows(client, companyId, filters) {
  const params = [companyId];
  const where = ["fa.company_id=$1"];
  if (filters.fiscal_year_id) {
    params.push(filters.fiscal_year_id);
    where.push(`fa.fiscal_year_id=$${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`fa.status=$${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(fa.asset_code ILIKE $${params.length} OR fa.name ILIKE $${params.length} OR fa.notes ILIKE $${params.length})`);
  }
  params.push(filters.limit);
  const { rows } = await client.query(
    `SELECT fa.id, fa.tenant_id, fa.company_id, fa.fiscal_year_id, fy.year_label,
            fa.asset_code, fa.name, fa.acquisition_date, fa.acquisition_cost::text,
            fa.residual_value::text, fa.useful_life_months, fa.depreciation_method,
            fa.asset_account_id, aa.code AS asset_account_code, aa.name AS asset_account_name,
            fa.accumulated_depreciation_account_id, ada.code AS accumulated_depreciation_account_code, ada.name AS accumulated_depreciation_account_name,
            fa.expense_account_id, ea.code AS expense_account_code, ea.name AS expense_account_name,
            fa.status, fa.source_system, fa.source_type, fa.source_id, fa.notes,
            fa.disposed_at, fa.status_reason, fa.created_at, fa.updated_at
       FROM ${q("accounting_fixed_assets")} fa
       JOIN ${q("fiscal_years")} fy ON fy.id=fa.fiscal_year_id
       LEFT JOIN ${q("accounts")} aa ON aa.id=fa.asset_account_id
       LEFT JOIN ${q("accounts")} ada ON ada.id=fa.accumulated_depreciation_account_id
       LEFT JOIN ${q("accounts")} ea ON ea.id=fa.expense_account_id
      WHERE ${where.join(" AND ")}
      ORDER BY fa.acquisition_date DESC, fa.asset_code ASC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

router.use(authenticate);

router.get("/fixed-assets", requirePermission("fixed_assets.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeFixedAssetQuery(req.query);
    if (filters.format === "csv") {
      const rows = await db.transaction(async client => {
        const assetRows = await loadFixedAssetRows(client, selected.company_id, filters);
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, request_id, detail)
           VALUES ($1,$2,'user',$3,'fixed_asset.csv_exported','accounting_fixed_asset',$4,$5::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            req.id || null,
            JSON.stringify({ filters: compactFilters(filters), row_count: assetRows.length }),
          ]
        );
        return assetRows;
      });
      const csv = buildCsv([
        { key: "year_label", label: "Ejercicio" },
        { key: "asset_code", label: "Codigo" },
        { key: "name", label: "Nombre" },
        { key: "acquisition_date", label: "Fecha adquisicion" },
        { key: "acquisition_cost", label: "Coste" },
        { key: "residual_value", label: "Valor residual" },
        { key: "useful_life_months", label: "Vida util meses" },
        { key: "depreciation_method", label: "Metodo" },
        { key: "status", label: "Estado" },
      ], rows);
      return sendCsv(res, "inmovilizado.csv", csv);
    }
    const rows = await db.transaction(client => loadFixedAssetRows(client, selected.company_id, filters));
    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.post("/fixed-assets", requirePermission("fixed_assets.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeFixedAssetInput(req.body);
    const fixedAsset = await db.transaction(async client => {
      await assertFiscalYear(client, selected.company_id, input.fiscal_year_id);
      await assertOptionalAccount(client, selected.company_id, input.asset_account_id, "asset_account_id");
      await assertOptionalAccount(client, selected.company_id, input.accumulated_depreciation_account_id, "accumulated_depreciation_account_id");
      await assertOptionalAccount(client, selected.company_id, input.expense_account_id, "expense_account_id");
      const { rows } = await client.query(
        `INSERT INTO ${q("accounting_fixed_assets")}
           (tenant_id, company_id, fiscal_year_id, asset_code, name, acquisition_date, acquisition_cost,
            residual_value, useful_life_months, depreciation_method, asset_account_id,
            accumulated_depreciation_account_id, expense_account_id, source_system, source_type,
            source_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.fiscal_year_id,
          input.asset_code,
          input.name,
          input.acquisition_date,
          input.acquisition_cost,
          input.residual_value,
          input.useful_life_months,
          input.depreciation_method,
          input.asset_account_id,
          input.accumulated_depreciation_account_id,
          input.expense_account_id,
          input.source_system,
          input.source_type,
          input.source_id,
          input.notes,
          req.accountingUser.id,
        ]
      );
      const created = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'fixed_asset.created','accounting_fixed_asset',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          created.id,
          req.id || null,
          JSON.stringify({
            fiscal_year_id: created.fiscal_year_id,
            asset_code: created.asset_code,
            acquisition_cost: created.acquisition_cost,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingFixedAssetCreated",
        aggregate_type: "accounting_fixed_asset",
        aggregate_id: created.id,
        payload: {
          fixed_asset_id: created.id,
          fiscal_year_id: created.fiscal_year_id,
          asset_code: created.asset_code,
          name: created.name,
          acquisition_date: String(created.acquisition_date).slice(0, 10),
          acquisition_cost: String(created.acquisition_cost),
          status: created.status,
        },
      });
      return created;
    });
    res.status(201).json({ fixed_asset: fixedAsset });
  } catch (error) {
    if (error.code === "23505") {
      error.status = 409;
      error.message = "Ya existe inmovilizado con ese codigo en el ejercicio seleccionado";
    }
    next(error);
  }
});

router.get("/fixed-assets/:id/depreciation-plan", requirePermission("fixed_assets.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const { rows } = await db.query(
      `SELECT * FROM ${q("accounting_fixed_assets")} WHERE id=$1 AND company_id=$2`,
      [req.params.id, selected.company_id]
    );
    if (!rows.length) return res.status(404).json({ error: "Inmovilizado no encontrado para la empresa seleccionada" });
    const asset = rows[0];
    const plan = buildStraightLineDepreciationPlan(asset);
    res.json({
      fixed_asset: asset,
      plan,
      disclaimer: "Plan tecnico preliminar de amortizacion lineal. No genera asientos ni acredita tratamiento fiscal o legal.",
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/fixed-assets/:id/status", requirePermission("fixed_assets.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeFixedAssetStatusInput(req.body);
    const fixedAsset = await db.transaction(async client => {
      const current = await client.query(
        `SELECT * FROM ${q("accounting_fixed_assets")} WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) {
        const error = new Error("Inmovilizado no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const previous = current.rows[0];
      const nextStatus = nextStatusForAction(previous.status, input.action);
      const { rows } = await client.query(
        `UPDATE ${q("accounting_fixed_assets")}
            SET status=$1::varchar,
                status_reason=$2::text,
                disposed_at=CASE WHEN $1::text='disposed' THEN COALESCE($3::date, CURRENT_DATE) ELSE NULL END,
                updated_at=NOW()
          WHERE id=$4::uuid
          RETURNING *`,
        [nextStatus, input.reason, input.disposed_at, req.params.id]
      );
      const updated = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'fixed_asset.status_changed','accounting_fixed_asset',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          updated.id,
          req.id || null,
          JSON.stringify({
            previous_status: previous.status,
            status: updated.status,
            action: input.action,
            reason: input.reason,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingFixedAssetStatusChanged",
        aggregate_type: "accounting_fixed_asset",
        aggregate_id: updated.id,
        payload: {
          fixed_asset_id: updated.id,
          previous_status: previous.status,
          status: updated.status,
          action: input.action,
          reason: input.reason,
        },
      });
      return updated;
    });
    res.json({ fixed_asset: fixedAsset });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
