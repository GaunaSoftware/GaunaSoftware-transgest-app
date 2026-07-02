require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const { buildCsv } = require("../domain/csv");
const {
  buildStraightLineDepreciationPlan,
  depreciationAmountForPeriod,
  normalizeFixedAssetDepreciationRunInput,
  normalizeFixedAssetInput,
  normalizeFixedAssetQuery,
  normalizeFixedAssetStatusInput,
  nextStatusForAction,
} = require("../domain/fixedAssets");
const { journalDraftRequestHash, normalizeCancellationReason } = require("../domain/journalEntries");
const { hasPermission } = require("../domain/rbac");
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

async function loadDepreciationRuns(client, companyId, fixedAssetId) {
  const { rows } = await client.query(
    `SELECT dr.id, dr.fixed_asset_id, dr.fiscal_year_id, dr.period_id, p.name AS period_name,
            dr.journal_entry_id, je.status AS journal_entry_status, je.entry_number,
            dr.reversal_journal_entry_id, rje.status AS reversal_journal_entry_status, rje.entry_number AS reversal_entry_number,
            dr.run_date, dr.amount::text, dr.plan_from_date, dr.plan_to_date, dr.plan_periods,
            dr.status, dr.idempotency_key, dr.reversal_reason, dr.reversed_at, dr.created_at
       FROM ${q("depreciation_runs")} dr
       JOIN ${q("accounting_periods")} p ON p.id=dr.period_id
       JOIN ${q("journal_entries")} je ON je.id=dr.journal_entry_id
       LEFT JOIN ${q("journal_entries")} rje ON rje.id=dr.reversal_journal_entry_id
      WHERE dr.company_id=$1 AND dr.fixed_asset_id=$2
      ORDER BY dr.run_date DESC, dr.created_at DESC`,
    [companyId, fixedAssetId]
  );
  return rows;
}

async function loadFixedAssetDisposalReadiness(client, companyId, fixedAssetId) {
  const assetResult = await client.query(
    `SELECT fa.id, fa.asset_code, fa.name, fa.status, fa.acquisition_cost::text,
            COALESCE(SUM(CASE WHEN dr.status = 'posted' THEN dr.amount ELSE 0 END), 0)::text AS posted_depreciation_amount,
            GREATEST(fa.acquisition_cost - COALESCE(SUM(CASE WHEN dr.status = 'posted' THEN dr.amount ELSE 0 END), 0), 0)::text AS estimated_net_book_value,
            COUNT(*) FILTER (WHERE dr.status = 'draft_created')::int AS depreciation_draft_count,
            COUNT(*) FILTER (WHERE dr.status = 'reversal_draft_created')::int AS reversal_draft_count
       FROM ${q("accounting_fixed_assets")} fa
       LEFT JOIN ${q("depreciation_runs")} dr ON dr.fixed_asset_id=fa.id AND dr.company_id=fa.company_id
      WHERE fa.id=$1 AND fa.company_id=$2
      GROUP BY fa.id`,
    [fixedAssetId, companyId]
  );
  if (!assetResult.rows.length) return null;
  const asset = assetResult.rows[0];
  const blockers = [];
  if (asset.status === "disposed") blockers.push("El inmovilizado ya esta dado de baja");
  if (asset.depreciation_draft_count > 0) blockers.push("Existen borradores de amortizacion pendientes");
  if (asset.reversal_draft_count > 0) blockers.push("Existen reversos de amortizacion pendientes de contabilizar o cancelar");

  return {
    fixed_asset_id: asset.id,
    asset_code: asset.asset_code,
    name: asset.name,
    status: asset.status,
    posted_depreciation_amount: asset.posted_depreciation_amount,
    estimated_net_book_value: asset.estimated_net_book_value,
    pending_depreciation_drafts: asset.depreciation_draft_count,
    pending_reversal_drafts: asset.reversal_draft_count,
    blockers,
    ready: blockers.length === 0,
    disclaimer: "Comprobacion operativa interna. No genera asiento de baja ni sustituye revision contable/fiscal.",
  };
}

async function assertPostableAccounts(client, companyId, fiscalYearId, accountIds) {
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  const { rows } = await client.query(
    `SELECT id, code, name, is_active, is_postable
       FROM ${q("accounts")}
      WHERE company_id=$1 AND fiscal_year_id=$2 AND id=ANY($3::uuid[])`,
    [companyId, fiscalYearId, uniqueIds]
  );
  if (rows.length !== uniqueIds.length) {
    const error = new Error("Una o mas cuentas de amortizacion no pertenecen al ejercicio y empresa seleccionados");
    error.status = 400;
    throw error;
  }
  const unusable = rows.find(account => !account.is_active || !account.is_postable);
  if (unusable) {
    const error = new Error(`La cuenta ${unusable.code} no esta activa o no admite movimientos`);
    error.status = 409;
    throw error;
  }
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
    const { asset, plan, runs } = await db.transaction(async client => {
      const assetResult = await client.query(
        `SELECT * FROM ${q("accounting_fixed_assets")} WHERE id=$1 AND company_id=$2`,
        [req.params.id, selected.company_id]
      );
      if (!assetResult.rows.length) {
        const error = new Error("Inmovilizado no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const fixedAsset = assetResult.rows[0];
      return {
        asset: fixedAsset,
        plan: buildStraightLineDepreciationPlan(fixedAsset),
        runs: await loadDepreciationRuns(client, selected.company_id, fixedAsset.id),
      };
    });
    res.json({
      fixed_asset: asset,
      plan,
      depreciation_runs: runs,
      disclaimer: "Plan tecnico preliminar de amortizacion lineal. Los borradores generados requieren revision y contabilizacion manual; no acredita tratamiento fiscal o legal.",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/fixed-assets/:id/disposal-readiness", requirePermission("fixed_assets.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const readiness = await db.transaction(client => loadFixedAssetDisposalReadiness(client, selected.company_id, req.params.id));
    if (!readiness) {
      const error = new Error("Inmovilizado no encontrado para la empresa seleccionada");
      error.status = 404;
      throw error;
    }
    res.json({ readiness });
  } catch (error) {
    next(error);
  }
});

router.post("/fixed-assets/:id/depreciation-runs", requirePermission("fixed_assets.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    if (!hasPermission(req.accountingUser, "journal.write")) {
      return res.status(403).json({ error: "Permiso contable denegado", permission: "journal.write" });
    }
    const input = normalizeFixedAssetDepreciationRunInput(req.body);
    const result = await db.transaction(async client => {
      const repeatedRun = await client.query(
        `SELECT dr.*
           FROM ${q("depreciation_runs")} dr
          WHERE dr.company_id=$1 AND dr.idempotency_key=$2`,
        [selected.company_id, input.idempotency_key]
      );
      if (repeatedRun.rows.length) {
        return {
          depreciation_run: repeatedRun.rows[0],
          depreciation_runs: await loadDepreciationRuns(client, selected.company_id, repeatedRun.rows[0].fixed_asset_id),
          repeated: true,
        };
      }

      const assetResult = await client.query(
        `SELECT * FROM ${q("accounting_fixed_assets")}
          WHERE id=$1 AND company_id=$2
          FOR UPDATE`,
        [req.params.id, selected.company_id]
      );
      if (!assetResult.rows.length) {
        const error = new Error("Inmovilizado no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const asset = assetResult.rows[0];
      if (asset.status !== "active") {
        const error = new Error("Solo se puede amortizar inmovilizado activo");
        error.status = 409;
        throw error;
      }
      if (!asset.expense_account_id || !asset.accumulated_depreciation_account_id) {
        const error = new Error("El inmovilizado necesita cuenta de gasto y cuenta de amortizacion acumulada");
        error.status = 409;
        throw error;
      }

      const periodResult = await client.query(
        `SELECT p.*, fy.status AS fiscal_year_status, fy.year_label
           FROM ${q("accounting_periods")} p
           JOIN ${q("fiscal_years")} fy ON fy.id=p.fiscal_year_id
          WHERE p.id=$1 AND p.company_id=$2 AND p.fiscal_year_id=$3
          FOR UPDATE OF p, fy`,
        [input.period_id, selected.company_id, asset.fiscal_year_id]
      );
      if (!periodResult.rows.length) {
        const error = new Error("Periodo no encontrado para el ejercicio del inmovilizado");
        error.status = 400;
        throw error;
      }
      const period = periodResult.rows[0];
      if (period.fiscal_year_status !== "open") {
        const error = new Error("El ejercicio no esta abierto");
        error.status = 409;
        throw error;
      }
      if (period.status !== "open") {
        const error = new Error(`El periodo ${period.name} no esta abierto`);
        error.status = 409;
        throw error;
      }

      const duplicateRun = await client.query(
        `SELECT id, journal_entry_id
           FROM ${q("depreciation_runs")}
          WHERE company_id=$1 AND fixed_asset_id=$2 AND period_id=$3`,
        [selected.company_id, asset.id, period.id]
      );
      if (duplicateRun.rows.length) {
        const error = new Error("Ya existe una amortizacion preparada para este activo y periodo");
        error.status = 409;
        throw error;
      }

      await assertPostableAccounts(client, selected.company_id, asset.fiscal_year_id, [
        asset.expense_account_id,
        asset.accumulated_depreciation_account_id,
      ]);
      const depreciation = depreciationAmountForPeriod(asset, period);
      const description = input.description || `Amortizacion ${asset.asset_code} - ${period.name}`;
      const lines = [
        {
          line_number: 1,
          account_id: asset.expense_account_id,
          side: "debit",
          amount: depreciation.amount,
          description: `Gasto amortizacion ${asset.asset_code}`,
        },
        {
          line_number: 2,
          account_id: asset.accumulated_depreciation_account_id,
          side: "credit",
          amount: depreciation.amount,
          description: `Amortizacion acumulada ${asset.asset_code}`,
        },
      ];
      const requestHash = journalDraftRequestHash({
        fiscal_year_id: asset.fiscal_year_id,
        entry_date: depreciation.run_date,
        description,
        lines,
      });

      const entryResult = await client.query(
        `INSERT INTO ${q("journal_entries")}
           (tenant_id, company_id, fiscal_year_id, period_id, entry_date, description,
            status, entry_type, source_system, source_type, source_id, idempotency_key,
            request_hash, trace_id, request_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'draft','depreciation','accounting','fixed_asset_depreciation',$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          asset.fiscal_year_id,
          period.id,
          depreciation.run_date,
          description,
          asset.id,
          input.idempotency_key,
          requestHash,
          req.id || null,
          req.id || null,
          req.accountingUser.id,
        ]
      ).catch(error => {
        if (error.code === "23505") {
          const conflict = new Error("idempotency_key ya utilizado con otro contenido");
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      });
      const entry = entryResult.rows[0];

      for (const line of lines) {
        await client.query(
          `INSERT INTO ${q("journal_lines")}
             (tenant_id, company_id, journal_entry_id, line_number, account_id,
              debit_amount, credit_amount, currency, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'EUR',$8)`,
          [
            selected.tenant_id,
            selected.company_id,
            entry.id,
            line.line_number,
            line.account_id,
            line.side === "debit" ? line.amount : "0",
            line.side === "credit" ? line.amount : "0",
            line.description,
          ]
        );
      }

      await client.query(
        `INSERT INTO ${q("source_links")}
           (tenant_id, company_id, journal_entry_id, source_system, source_type, source_id, source_line_id)
         VALUES ($1,$2,$3,'accounting','fixed_asset',$4,$5)`,
        [selected.tenant_id, selected.company_id, entry.id, asset.id, depreciation.plan_periods.join(",")]
      );

      const runResult = await client.query(
        `INSERT INTO ${q("depreciation_runs")}
           (tenant_id, company_id, fixed_asset_id, fiscal_year_id, period_id, journal_entry_id,
            run_date, amount, plan_from_date, plan_to_date, plan_periods, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::integer[],$12,$13)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          asset.id,
          asset.fiscal_year_id,
          period.id,
          entry.id,
          depreciation.run_date,
          depreciation.amount,
          depreciation.plan_from_date,
          depreciation.plan_to_date,
          depreciation.plan_periods,
          input.idempotency_key,
          req.accountingUser.id,
        ]
      );
      const run = runResult.rows[0];

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'fixed_asset.depreciation_draft_created','depreciation_run',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          run.id,
          req.id || null,
          JSON.stringify({
            fixed_asset_id: asset.id,
            journal_entry_id: entry.id,
            fiscal_year_id: asset.fiscal_year_id,
            period_id: period.id,
            amount: depreciation.amount,
            plan_periods: depreciation.plan_periods,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingFixedAssetDepreciationDraftCreated",
        aggregate_type: "depreciation_run",
        aggregate_id: run.id,
        payload: {
          depreciation_run_id: run.id,
          fixed_asset_id: asset.id,
          journal_entry_id: entry.id,
          fiscal_year_id: asset.fiscal_year_id,
          period_id: period.id,
          amount: depreciation.amount,
        },
      });

      return {
        depreciation_run: run,
        journal_entry: entry,
        depreciation_runs: await loadDepreciationRuns(client, selected.company_id, asset.id),
        repeated: false,
      };
    });
    res.status(result.repeated ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/fixed-assets/depreciation-runs/:runId/cancel", requirePermission("fixed_assets.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    if (!hasPermission(req.accountingUser, "journal.write")) {
      return res.status(403).json({ error: "Permiso contable denegado", permission: "journal.write" });
    }
    const reason = normalizeCancellationReason(req.body?.reason);
    const result = await db.transaction(async client => {
      const runResult = await client.query(
        `SELECT dr.*, je.status AS journal_status, je.entry_type, je.company_id AS journal_company_id
           FROM ${q("depreciation_runs")} dr
           JOIN ${q("journal_entries")} je ON je.id=dr.journal_entry_id
          WHERE dr.id=$1 AND dr.company_id=$2
          FOR UPDATE OF dr, je`,
        [req.params.runId, selected.company_id]
      );
      if (!runResult.rows.length) {
        const error = new Error("Amortizacion no encontrada para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const run = runResult.rows[0];
      if (run.status === "cancelled") {
        return {
          depreciation_run: run,
          depreciation_runs: await loadDepreciationRuns(client, selected.company_id, run.fixed_asset_id),
          repeated: true,
        };
      }
      if (run.status === "posted" || run.journal_status !== "draft" || run.entry_type !== "depreciation") {
        const error = new Error("Solo se pueden cancelar borradores de amortizacion no contabilizados");
        error.status = 409;
        throw error;
      }

      await client.query(
        `UPDATE ${q("journal_entries")}
            SET status='cancelled',
                cancelled_at=NOW(),
                cancelled_by=$1,
                cancel_reason=$2,
                updated_at=NOW()
          WHERE id=$3`,
        [req.accountingUser.id, reason, run.journal_entry_id]
      );
      const cancelledRun = await client.query(
        `UPDATE ${q("depreciation_runs")}
            SET status='cancelled',
                cancelled_at=NOW(),
                cancelled_by=$1,
                cancel_reason=$2
          WHERE id=$3
          RETURNING *`,
        [req.accountingUser.id, reason, run.id]
      );
      const updatedRun = cancelledRun.rows[0];

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'journal_entry.draft_cancelled','journal_entry',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          run.journal_entry_id,
          req.id || null,
          JSON.stringify({
            fiscal_year_id: run.fiscal_year_id,
            period_id: run.period_id,
            reason,
            source: "fixed_asset.depreciation_run.cancel",
          }),
        ]
      );
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'fixed_asset.depreciation_draft_cancelled','depreciation_run',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          updatedRun.id,
          req.id || null,
          JSON.stringify({
            fixed_asset_id: updatedRun.fixed_asset_id,
            journal_entry_id: updatedRun.journal_entry_id,
            reason,
            source: "fixed_asset.depreciation_run.cancel",
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingJournalEntryDraftCancelled",
        aggregate_type: "journal_entry",
        aggregate_id: run.journal_entry_id,
        payload: {
          journal_entry_id: run.journal_entry_id,
          fiscal_year_id: run.fiscal_year_id,
          period_id: run.period_id,
          reason,
        },
      });
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingFixedAssetDepreciationDraftCancelled",
        aggregate_type: "depreciation_run",
        aggregate_id: updatedRun.id,
        payload: {
          depreciation_run_id: updatedRun.id,
          fixed_asset_id: updatedRun.fixed_asset_id,
          journal_entry_id: updatedRun.journal_entry_id,
          reason,
        },
      });
      return {
        depreciation_run: updatedRun,
        depreciation_runs: await loadDepreciationRuns(client, selected.company_id, updatedRun.fixed_asset_id),
        repeated: false,
      };
    });
    res.json(result);
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
      if (nextStatus === "disposed") {
        const readiness = await loadFixedAssetDisposalReadiness(client, selected.company_id, previous.id);
        if (!readiness?.ready) {
          const error = new Error(`No se puede dar de baja el inmovilizado: ${readiness?.blockers.join("; ") || "revision pendiente"}`);
          error.status = 409;
          throw error;
        }
      }
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
