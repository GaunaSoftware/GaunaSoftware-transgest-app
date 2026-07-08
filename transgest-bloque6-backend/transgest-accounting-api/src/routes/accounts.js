require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  normalizeAccountInput,
  normalizeAccountQuery,
  normalizeAccountStatusInput,
} = require("../domain/accounts");
const { ensureFiscalYearOpen } = require("../domain/fiscalYears");
const { enqueueOutboxEvent } = require("../services/outbox");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

router.use(authenticate);

router.get("/accounts", requirePermission("accounts.read"), async (req, res) => {
  const filters = normalizeAccountQuery(req.query);
  const params = [req.accountingUser.selected_company_id];
  const where = ["a.company_id=$1"];

  if (filters.fiscal_year_id) {
    params.push(filters.fiscal_year_id);
    where.push(`a.fiscal_year_id=$${params.length}`);
  }
  if (filters.active !== null) {
    params.push(filters.active);
    where.push(`a.is_active=$${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(a.code ILIKE $${params.length} OR a.name ILIKE $${params.length})`);
  }
  params.push(filters.limit);

  const { rows } = await db.query(
    `SELECT a.id, a.tenant_id, a.company_id, a.fiscal_year_id, fy.year_label,
            a.code, a.name, a.account_type, a.parent_account_id,
            parent.code AS parent_code, a.is_postable, a.is_active, a.notes,
            a.created_at, a.updated_at
       FROM ${q("accounts")} a
       JOIN ${q("fiscal_years")} fy ON fy.id=a.fiscal_year_id
       LEFT JOIN ${q("accounts")} parent ON parent.id=a.parent_account_id
      WHERE ${where.join(" AND ")}
      ORDER BY fy.start_date DESC, a.code ASC
      LIMIT $${params.length}`,
    params
  );

  res.json({ data: rows, filters });
});

router.post("/accounts", requirePermission("accounts.write"), async (req, res, next) => {
  try {
    const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const fiscalYearId = String(req.body?.fiscal_year_id || "").trim();
    if (!fiscalYearId) return res.status(400).json({ error: "fiscal_year_id requerido" });
    const input = normalizeAccountInput(req.body);

    const account = await db.transaction(async client => {
      const fiscalYear = await client.query(
        `SELECT id, year_label, status FROM ${q("fiscal_years")} WHERE id=$1 AND company_id=$2`,
        [fiscalYearId, selected.company_id]
      );
      if (!fiscalYear.rows.length) {
        const error = new Error("Ejercicio no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      ensureFiscalYearOpen(fiscalYear.rows[0], "crear cuentas");

      if (input.parent_account_id) {
        const parent = await client.query(
          `SELECT id FROM ${q("accounts")}
            WHERE id=$1 AND company_id=$2 AND fiscal_year_id=$3`,
          [input.parent_account_id, selected.company_id, fiscalYearId]
        );
        if (!parent.rows.length) {
          const error = new Error("Cuenta padre no encontrada en el mismo ejercicio");
          error.status = 400;
          throw error;
        }
      }

      const { rows } = await client.query(
        `INSERT INTO ${q("accounts")}
           (tenant_id, company_id, fiscal_year_id, code, name, account_type,
            parent_account_id, is_postable, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          fiscalYearId,
          input.code,
          input.name,
          input.account_type,
          input.parent_account_id,
          input.is_postable,
          input.notes,
          req.accountingUser.id,
        ]
      ).catch(error => {
        if (error.code === "23505") {
          const conflict = new Error("Ya existe una cuenta con ese codigo en el ejercicio");
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      });

      const created = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'account.created','account',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          created.id,
          req.id || null,
          JSON.stringify({ code: created.code, name: created.name, fiscal_year_id: created.fiscal_year_id }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingAccountCreated",
        aggregate_type: "account",
        aggregate_id: created.id,
        payload: {
          account_id: created.id,
          fiscal_year_id: created.fiscal_year_id,
          code: created.code,
          name: created.name,
          account_type: created.account_type,
          is_postable: created.is_postable,
        },
      });
      return created;
    });

    res.status(201).json({ account });
  } catch (error) {
    next(error);
  }
});

router.patch("/accounts/:id/status", requirePermission("accounts.write"), async (req, res, next) => {
  try {
    const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeAccountStatusInput(req.body);

    const account = await db.transaction(async client => {
      const current = await client.query(
        `SELECT a.*, fy.year_label, fy.status AS fiscal_year_status
           FROM ${q("accounts")} a
           JOIN ${q("fiscal_years")} fy ON fy.id=a.fiscal_year_id
          WHERE a.id=$1 AND a.company_id=$2
          FOR UPDATE OF a, fy`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) {
        const error = new Error("Cuenta no encontrada para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      ensureFiscalYearOpen({
        id: current.rows[0].fiscal_year_id,
        year_label: current.rows[0].year_label,
        status: current.rows[0].fiscal_year_status,
      }, "cambiar cuentas");
      if (current.rows[0].is_active === input.is_active) {
        const error = new Error(`La cuenta ya esta ${input.is_active ? "activa" : "inactiva"}`);
        error.status = 409;
        throw error;
      }

      const { rows } = await client.query(
        `UPDATE ${q("accounts")}
            SET is_active=$1, updated_at=NOW()
          WHERE id=$2
          RETURNING *`,
        [input.is_active, req.params.id]
      );
      const updated = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'account.status_changed','account',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          updated.id,
          req.id || null,
          JSON.stringify({
            code: updated.code,
            previous_is_active: current.rows[0].is_active,
            is_active: updated.is_active,
            reason: input.reason,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingAccountStatusChanged",
        aggregate_type: "account",
        aggregate_id: updated.id,
        payload: {
          account_id: updated.id,
          fiscal_year_id: updated.fiscal_year_id,
          code: updated.code,
          previous_is_active: current.rows[0].is_active,
          is_active: updated.is_active,
          reason: input.reason,
        },
      });
      return updated;
    });

    res.json({ account });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
