require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  normalizeMaturityInput,
  normalizeMaturityQuery,
  normalizeMaturityStatusInput,
  nextStatusForAction,
} = require("../domain/maturities");
const { buildCsv } = require("../domain/csv");
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

async function assertActiveParty(client, companyId, partyId) {
  const { rows } = await client.query(
    `SELECT id, party_type, legal_name
       FROM ${q("accounting_parties")}
      WHERE id=$1 AND company_id=$2 AND is_active=TRUE`,
    [partyId, companyId]
  );
  if (!rows.length) {
    const error = new Error("Tercero no encontrado o inactivo para la empresa seleccionada");
    error.status = 400;
    throw error;
  }
  return rows[0];
}

async function loadMaturityRows(client, companyId, filters) {
  const params = [companyId];
  const where = ["m.company_id=$1"];
  if (filters.direction) {
    params.push(filters.direction);
    where.push(`m.direction=$${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`m.status=$${params.length}`);
  }
  if (filters.party_id) {
    params.push(filters.party_id);
    where.push(`m.party_id=$${params.length}`);
  }
  if (filters.due_from) {
    params.push(filters.due_from);
    where.push(`m.due_date >= $${params.length}::date`);
  }
  if (filters.due_to) {
    params.push(filters.due_to);
    where.push(`m.due_date <= $${params.length}::date`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(m.description ILIKE $${params.length} OR m.document_ref ILIKE $${params.length} OR p.legal_name ILIKE $${params.length})`);
  }
  params.push(filters.limit);

  const { rows } = await client.query(
    `SELECT m.id, m.tenant_id, m.company_id, m.party_id, p.legal_name AS party_name,
            p.party_type, m.direction, m.issue_date, m.due_date, m.document_ref,
            m.description, m.amount::text, m.open_amount::text, m.currency,
            m.payment_method, m.status, m.source_system, m.source_type, m.source_id,
            m.notes, m.settled_at, m.cancelled_at, m.status_reason,
            m.created_at, m.updated_at
       FROM ${q("accounting_maturities")} m
       JOIN ${q("accounting_parties")} p ON p.id=m.party_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.due_date ASC, p.legal_name ASC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

router.use(authenticate);

router.get("/maturities", requirePermission("maturities.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeMaturityQuery(req.query);
    if (filters.format === "csv") {
      const rows = await db.transaction(async client => {
        const maturityRows = await loadMaturityRows(client, selected.company_id, filters);
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, request_id, detail)
           VALUES ($1,$2,'user',$3,'maturity.csv_exported','accounting_maturity',$4,$5::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            req.id || null,
            JSON.stringify({ filters: compactFilters(filters), row_count: maturityRows.length }),
          ]
        );
        return maturityRows;
      });
      const csv = buildCsv([
        { key: "direction", label: "Tipo" },
        { key: "party_name", label: "Tercero" },
        { key: "due_date", label: "Vencimiento" },
        { key: "document_ref", label: "Documento" },
        { key: "description", label: "Descripcion" },
        { key: "amount", label: "Importe" },
        { key: "open_amount", label: "Pendiente" },
        { key: "status", label: "Estado" },
      ], rows);
      return sendCsv(res, "vencimientos.csv", csv);
    }
    const rows = await db.transaction(client => loadMaturityRows(client, selected.company_id, filters));
    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.post("/maturities", requirePermission("maturities.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeMaturityInput(req.body);

    const maturity = await db.transaction(async client => {
      await assertActiveParty(client, selected.company_id, input.party_id);
      const { rows } = await client.query(
        `INSERT INTO ${q("accounting_maturities")}
           (tenant_id, company_id, party_id, direction, issue_date, due_date, document_ref,
            description, amount, open_amount, currency, payment_method, source_system,
            source_type, source_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.party_id,
          input.direction,
          input.issue_date,
          input.due_date,
          input.document_ref,
          input.description,
          input.amount,
          input.open_amount,
          input.currency,
          input.payment_method,
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
         VALUES ($1,$2,'user',$3,'maturity.created','accounting_maturity',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          created.id,
          req.id || null,
          JSON.stringify({
            party_id: created.party_id,
            direction: created.direction,
            due_date: created.due_date,
            amount: created.amount,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingMaturityCreated",
        aggregate_type: "accounting_maturity",
        aggregate_id: created.id,
        payload: {
          maturity_id: created.id,
          party_id: created.party_id,
          direction: created.direction,
          due_date: String(created.due_date).slice(0, 10),
          amount: String(created.amount),
          status: created.status,
        },
      });
      return created;
    });

    res.status(201).json({ maturity });
  } catch (error) {
    next(error);
  }
});

router.patch("/maturities/:id/status", requirePermission("maturities.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeMaturityStatusInput(req.body);

    const maturity = await db.transaction(async client => {
      const current = await client.query(
        `SELECT * FROM ${q("accounting_maturities")} WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) {
        const error = new Error("Vencimiento no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const previous = current.rows[0];
      const nextStatus = nextStatusForAction(previous.status, input.action);
      const openAmount = nextStatus === "pending" ? previous.amount : "0.000000";
      const { rows } = await client.query(
        `UPDATE ${q("accounting_maturities")}
            SET status=$1::varchar, open_amount=$2::numeric, status_reason=$3::text, updated_at=NOW(),
                settled_at=CASE WHEN $1::text='settled' THEN COALESCE($4::timestamptz, NOW()) ELSE NULL END,
                settled_by=CASE WHEN $1::text='settled' THEN $5::uuid ELSE NULL END,
                cancelled_at=CASE WHEN $1::text='cancelled' THEN NOW() ELSE NULL END,
                cancelled_by=CASE WHEN $1::text='cancelled' THEN $5::uuid ELSE NULL END
          WHERE id=$6::uuid
          RETURNING *`,
        [nextStatus, openAmount, input.reason, input.settled_date, req.accountingUser.id, req.params.id]
      );
      const updated = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'maturity.status_changed','accounting_maturity',$4,$5,$6::jsonb)`,
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
        event_type: "AccountingMaturityStatusChanged",
        aggregate_type: "accounting_maturity",
        aggregate_id: updated.id,
        payload: {
          maturity_id: updated.id,
          previous_status: previous.status,
          status: updated.status,
          action: input.action,
          reason: input.reason,
        },
      });
      return updated;
    });

    res.json({ maturity });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
