require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  buildFiscalYearCloseReadiness,
  buildMonthlyPeriods,
  normalizeFiscalYearInput,
  validateFiscalYearStatusChange,
} = require("../domain/fiscalYears");
const { hasPermission } = require("../domain/rbac");
const { buildPeriodCloseReadiness, validatePeriodStatusChange } = require("../domain/periods");
const { enqueueOutboxEvent } = require("../services/outbox");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

router.use(authenticate);

router.get("/fiscal-years", requirePermission("fiscal_years.read"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM ${q("fiscal_years")}
      WHERE company_id=$1
      ORDER BY start_date DESC`,
    [req.accountingUser.selected_company_id]
  );
  res.json({ data: rows });
});

router.post("/fiscal-years", requirePermission("fiscal_years.write"), async (req, res, next) => {
  try {
    const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });

    const input = normalizeFiscalYearInput(req.body || {});
    const periods = buildMonthlyPeriods(input.start_date, input.end_date);

    const result = await db.transaction(async client => {
      const { rows: yearRows } = await client.query(
        `INSERT INTO ${q("fiscal_years")}
           (tenant_id, company_id, year_label, start_date, end_date, status)
         VALUES ($1,$2,$3,$4,$5,'open')
         RETURNING *`,
        [selected.tenant_id, selected.company_id, input.year_label, input.start_date, input.end_date]
      ).catch(err => {
        if (err.code === "23505") {
          const conflict = new Error("Ya existe un ejercicio con esa etiqueta para la empresa seleccionada");
          conflict.status = 409;
          throw conflict;
        }
        throw err;
      });
      const fiscalYear = yearRows[0];

      const createdPeriods = [];
      for (const period of periods) {
        const { rows } = await client.query(
          `INSERT INTO ${q("accounting_periods")}
             (tenant_id, company_id, fiscal_year_id, period_number, name, start_date, end_date, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'open')
           RETURNING *`,
          [
            selected.tenant_id,
            selected.company_id,
            fiscalYear.id,
            period.period_number,
            period.name,
            period.start_date,
            period.end_date,
          ]
        );
        createdPeriods.push(rows[0]);
      }

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'fiscal_year.opened','fiscal_year',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          fiscalYear.id,
          req.id || null,
          JSON.stringify({ year_label: fiscalYear.year_label, periods: createdPeriods.length }),
        ]
      );

      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingFiscalYearOpened",
        aggregate_type: "fiscal_year",
        aggregate_id: fiscalYear.id,
        schema_version: 1,
        payload: {
          fiscal_year_id: fiscalYear.id,
          year_label: fiscalYear.year_label,
          start_date: fiscalYear.start_date,
          end_date: fiscalYear.end_date,
          period_count: createdPeriods.length,
        },
      });

      return { fiscal_year: fiscalYear, periods: createdPeriods };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

async function loadFiscalYearCloseReadiness(client, companyId, fiscalYearId) {
  const { rows } = await client.query(
    `SELECT
        COUNT(DISTINCT p.id) FILTER (WHERE p.status='open')::int AS open_periods,
        COUNT(DISTINCT p.id) FILTER (WHERE p.status='locked')::int AS locked_periods,
        COUNT(DISTINCT je.id) FILTER (WHERE je.status='draft')::int AS draft_journal_entries,
        COUNT(DISTINCT dr.id) FILTER (WHERE dr.status='draft_created')::int AS pending_depreciation_drafts,
        COUNT(DISTINCT dr.id) FILTER (WHERE dr.status='reversal_draft_created')::int AS pending_depreciation_reversals
       FROM ${q("fiscal_years")} fy
       LEFT JOIN ${q("accounting_periods")} p ON p.fiscal_year_id=fy.id AND p.company_id=fy.company_id
       LEFT JOIN ${q("journal_entries")} je ON je.fiscal_year_id=fy.id AND je.company_id=fy.company_id
       LEFT JOIN ${q("depreciation_runs")} dr ON dr.fiscal_year_id=fy.id AND dr.company_id=fy.company_id
      WHERE fy.id=$1 AND fy.company_id=$2`,
    [fiscalYearId, companyId]
  );
  return buildFiscalYearCloseReadiness(rows[0] || {});
}

router.get("/fiscal-years/:id/close-readiness", requirePermission("fiscal_years.read"), async (req, res, next) => {
  try {
    const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const result = await db.transaction(async client => {
      const { rows } = await client.query(
        `SELECT id, year_label, status
           FROM ${q("fiscal_years")}
          WHERE id=$1 AND company_id=$2`,
        [req.params.id, selected.company_id]
      );
      if (!rows.length) {
        const err = new Error("Ejercicio no encontrado para la empresa seleccionada");
        err.status = 404;
        throw err;
      }
      return {
        fiscal_year: rows[0],
        readiness: await loadFiscalYearCloseReadiness(client, selected.company_id, rows[0].id),
      };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch("/fiscal-years/:id/status", requirePermission("fiscal_years.write"), async (req, res, next) => {
  try {
    const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const { action, reason } = req.body || {};
    const result = await db.transaction(async client => {
      const { rows } = await client.query(
        `SELECT *
           FROM ${q("fiscal_years")}
          WHERE id=$1 AND company_id=$2
          FOR UPDATE`,
        [req.params.id, selected.company_id]
      );
      if (!rows.length) {
        const err = new Error("Ejercicio no encontrado para la empresa seleccionada");
        err.status = 404;
        throw err;
      }
      const fiscalYear = rows[0];
      const change = validateFiscalYearStatusChange(fiscalYear, action, reason);
      const closeReadiness = change.action === "close"
        ? await loadFiscalYearCloseReadiness(client, selected.company_id, fiscalYear.id)
        : null;
      if (closeReadiness && !closeReadiness.ready) {
        const err = new Error(`No se puede cerrar el ejercicio: ${closeReadiness.blockers.join("; ")}`);
        err.status = 409;
        err.readiness = closeReadiness;
        throw err;
      }
      const { rows: updatedRows } = await client.query(
        `UPDATE ${q("fiscal_years")}
            SET status=$1,
                closed_at=$2,
                closed_by=$3,
                status_reason=$4,
                updated_at=NOW()
          WHERE id=$5
          RETURNING *`,
        [
          change.target_status,
          change.action === "close" ? new Date().toISOString() : null,
          change.action === "close" ? req.accountingUser.id : null,
          change.reason,
          fiscalYear.id,
        ]
      );
      const updatedFiscalYear = updatedRows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,$4,'fiscal_year',$5,$6,$7::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          change.audit_action,
          updatedFiscalYear.id,
          req.id || null,
          JSON.stringify({
            previous_status: change.previous_status,
            status: updatedFiscalYear.status,
            reason: change.reason,
            closed_at: updatedFiscalYear.closed_at || null,
            closed_by: updatedFiscalYear.closed_by || null,
            close_readiness: closeReadiness,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: change.event_type,
        aggregate_type: "fiscal_year",
        aggregate_id: updatedFiscalYear.id,
        schema_version: 1,
        payload: {
          fiscal_year_id: updatedFiscalYear.id,
          year_label: updatedFiscalYear.year_label,
          previous_status: change.previous_status,
          status: updatedFiscalYear.status,
          reason: change.reason,
          closed_at: updatedFiscalYear.closed_at || null,
          closed_by: updatedFiscalYear.closed_by || null,
        },
      });
      return { fiscal_year: updatedFiscalYear };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/periods", requirePermission("periods.read"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, fy.year_label, closed_user.display_name AS closed_by_name
       FROM ${q("accounting_periods")} p
       JOIN ${q("fiscal_years")} fy ON fy.id=p.fiscal_year_id
       LEFT JOIN ${q("accounting_users")} closed_user ON closed_user.id=p.closed_by
      WHERE p.company_id=$1
      ORDER BY fy.start_date DESC, p.period_number ASC`,
    [req.accountingUser.selected_company_id]
  );
  res.json({ data: rows });
});

async function loadPeriodCloseReadiness(client, companyId, periodId) {
  const { rows } = await client.query(
    `SELECT
        COUNT(DISTINCT je.id) FILTER (WHERE je.status='draft')::int AS draft_journal_entries,
        COUNT(DISTINCT dr.id) FILTER (WHERE dr.status='draft_created')::int AS pending_depreciation_drafts,
        COUNT(DISTINCT dr.id) FILTER (WHERE dr.status='reversal_draft_created')::int AS pending_depreciation_reversals
       FROM ${q("accounting_periods")} p
       LEFT JOIN ${q("journal_entries")} je ON je.period_id=p.id AND je.company_id=p.company_id
       LEFT JOIN ${q("depreciation_runs")} dr ON dr.period_id=p.id AND dr.company_id=p.company_id
      WHERE p.id=$1 AND p.company_id=$2`,
    [periodId, companyId]
  );
  return buildPeriodCloseReadiness(rows[0] || {});
}

router.get("/periods/:id/close-readiness", requirePermission("periods.read"), async (req, res, next) => {
  try {
    const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const result = await db.transaction(async client => {
      const { rows } = await client.query(
        `SELECT id, fiscal_year_id, period_number, name, status
           FROM ${q("accounting_periods")}
          WHERE id=$1 AND company_id=$2`,
        [req.params.id, selected.company_id]
      );
      if (!rows.length) {
        const err = new Error("Periodo no encontrado para la empresa seleccionada");
        err.status = 404;
        throw err;
      }
      return {
        period: rows[0],
        readiness: await loadPeriodCloseReadiness(client, selected.company_id, rows[0].id),
      };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch("/periods/:id/status", async (req, res, next) => {
  try {
    const { action, reason } = req.body || {};
    const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });

    const result = await db.transaction(async client => {
      const { rows } = await client.query(
        `SELECT p.*, fy.year_label
           FROM ${q("accounting_periods")} p
           JOIN ${q("fiscal_years")} fy ON fy.id=p.fiscal_year_id
          WHERE p.id=$1 AND p.company_id=$2
          FOR UPDATE OF p`,
        [req.params.id, selected.company_id]
      );

      if (!rows.length) {
        const err = new Error("Periodo no encontrado para la empresa seleccionada");
        err.status = 404;
        throw err;
      }

      const period = rows[0];
      const change = validatePeriodStatusChange(period, action, reason);
      if (!hasPermission(req.accountingUser, change.permission)) {
        const err = new Error("Permiso contable denegado");
        err.status = 403;
        err.permission = change.permission;
        throw err;
      }
      const closeReadiness = change.action === "close"
        ? await loadPeriodCloseReadiness(client, selected.company_id, period.id)
        : null;
      if (closeReadiness && !closeReadiness.ready) {
        const err = new Error(`No se puede cerrar el periodo: ${closeReadiness.blockers.join("; ")}`);
        err.status = 409;
        err.readiness = closeReadiness;
        throw err;
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE ${q("accounting_periods")}
            SET status=$1,
                locked_reason=$2,
                closed_at=$3,
                closed_by=$4,
                updated_at=now()
          WHERE id=$5
          RETURNING *`,
        [
          change.target_status,
          change.target_status === "open" ? null : change.reason,
          change.target_status === "closed" ? new Date().toISOString() : null,
          change.target_status === "closed" ? req.accountingUser.id : null,
          period.id,
        ]
      );
      const updatedPeriod = updatedRows[0];

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,$4,'accounting_period',$5,$6,$7::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          change.audit_action,
          updatedPeriod.id,
          req.id || null,
          JSON.stringify({
            fiscal_year_id: updatedPeriod.fiscal_year_id,
            period_number: updatedPeriod.period_number,
            previous_status: change.previous_status,
            status: updatedPeriod.status,
            reason: change.reason,
            closed_at: updatedPeriod.closed_at || null,
            closed_by: updatedPeriod.closed_by || null,
            close_readiness: closeReadiness,
          }),
        ]
      );

      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: change.event_type,
        aggregate_type: "accounting_period",
        aggregate_id: updatedPeriod.id,
        schema_version: 1,
        payload: {
          period_id: updatedPeriod.id,
          fiscal_year_id: updatedPeriod.fiscal_year_id,
          period_number: updatedPeriod.period_number,
          previous_status: change.previous_status,
          status: updatedPeriod.status,
          reason: change.reason,
          closed_at: updatedPeriod.closed_at || null,
          closed_by: updatedPeriod.closed_by || null,
          close_readiness: closeReadiness,
        },
      });

      return { period: updatedPeriod };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
