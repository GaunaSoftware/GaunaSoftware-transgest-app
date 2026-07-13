require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  normalizePartyInput,
  normalizePartyQuery,
  normalizePartyStatusInput,
  normalizePartyUpdateInput,
} = require("../domain/parties");
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

async function assertDefaultAccount(client, companyId, accountId) {
  if (!accountId) return;
  const account = await client.query(
    `SELECT id FROM ${q("accounts")}
      WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_postable=TRUE`,
    [accountId, companyId]
  );
  if (!account.rows.length) {
    const error = new Error("Cuenta contable por defecto no encontrada o no operativa");
    error.status = 400;
    throw error;
  }
}

async function loadPartyRows(client, companyId, filters) {
  const params = [companyId];
  const where = ["p.company_id=$1"];

  if (filters.party_type) {
    params.push(filters.party_type);
    where.push(`p.party_type=$${params.length}`);
  }
  if (filters.active !== null) {
    params.push(filters.active);
    where.push(`p.is_active=$${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(p.legal_name ILIKE $${params.length} OR p.tax_id ILIKE $${params.length} OR p.email ILIKE $${params.length})`);
  }
  params.push(filters.limit);

  const { rows } = await client.query(
    `SELECT p.id, p.tenant_id, p.company_id, p.source_system, p.source_party_id,
            p.party_type, p.legal_name, p.tax_id, p.email, p.phone,
            p.default_account_id, a.code AS default_account_code, a.name AS default_account_name,
            p.iban, p.swift_bic, p.mandate_ref, p.mandate_date,
            p.notes, p.is_active, p.created_at, p.updated_at
       FROM ${q("accounting_parties")} p
       LEFT JOIN ${q("accounts")} a ON a.id=p.default_account_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.legal_name ASC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

router.use(authenticate);

router.get("/parties", requirePermission("parties.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizePartyQuery(req.query);
    if (filters.format === "csv") {
      const rows = await db.transaction(async client => {
        const partyRows = await loadPartyRows(client, selected.company_id, filters);
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, request_id, detail)
           VALUES ($1,$2,'user',$3,'party.csv_exported','accounting_party',$4,$5::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            req.id || null,
            JSON.stringify({ filters: compactFilters(filters), row_count: partyRows.length }),
          ]
        );
        return partyRows;
      });
      const csv = buildCsv([
        { key: "legal_name", label: "Nombre fiscal" },
        { key: "party_type", label: "Tipo" },
        { key: "tax_id", label: "NIF/CIF" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Telefono" },
        { key: "default_account_code", label: "Cuenta" },
        { key: "is_active", label: "Activo" },
      ], rows);
      return sendCsv(res, "terceros.csv", csv);
    }

    const rows = await db.transaction(client => loadPartyRows(client, selected.company_id, filters));

    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.post("/parties", requirePermission("parties.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizePartyInput(req.body);

    const party = await db.transaction(async client => {
      await assertDefaultAccount(client, selected.company_id, input.default_account_id);

      const { rows } = await client.query(
        `INSERT INTO ${q("accounting_parties")}
           (tenant_id, company_id, source_system, source_party_id, party_type, legal_name,
            tax_id, email, phone, default_account_id, notes, iban, swift_bic, mandate_ref, mandate_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.source_system,
          input.source_party_id,
          input.party_type,
          input.legal_name,
          input.tax_id,
          input.email,
          input.phone,
          input.default_account_id,
          input.notes,
          input.iban,
          input.swift_bic,
          input.mandate_ref,
          input.mandate_date,
          req.accountingUser.id,
        ]
      ).catch(error => {
        if (error.code === "23505") {
          const conflict = new Error("Ya existe un tercero con ese origen externo");
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      });

      const created = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'party.created','accounting_party',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          created.id,
          req.id || null,
          JSON.stringify({ party_type: created.party_type, legal_name: created.legal_name, tax_id: created.tax_id }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingPartyCreated",
        aggregate_type: "accounting_party",
        aggregate_id: created.id,
        payload: {
          party_id: created.id,
          party_type: created.party_type,
          legal_name: created.legal_name,
          tax_id: created.tax_id,
          is_active: created.is_active,
        },
      });
      return created;
    });

    res.status(201).json({ party });
  } catch (error) {
    next(error);
  }
});

router.put("/parties/:id", requirePermission("parties.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizePartyUpdateInput(req.body);

    const party = await db.transaction(async client => {
      await assertDefaultAccount(client, selected.company_id, input.default_account_id);
      const current = await client.query(
        `SELECT * FROM ${q("accounting_parties")} WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) {
        const error = new Error("Tercero no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }

      const { rows } = await client.query(
        `UPDATE ${q("accounting_parties")}
            SET party_type=$1, legal_name=$2, tax_id=$3, email=$4, phone=$5,
                default_account_id=$6, notes=$7, iban=$8, swift_bic=$9,
                mandate_ref=$10, mandate_date=$11, updated_at=NOW()
          WHERE id=$12
          RETURNING *`,
        [
          input.party_type,
          input.legal_name,
          input.tax_id,
          input.email,
          input.phone,
          input.default_account_id,
          input.notes,
          input.iban,
          input.swift_bic,
          input.mandate_ref,
          input.mandate_date,
          req.params.id,
        ]
      );
      const updated = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'party.updated','accounting_party',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          updated.id,
          req.id || null,
          JSON.stringify({
            previous_legal_name: current.rows[0].legal_name,
            legal_name: updated.legal_name,
            party_type: updated.party_type,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingPartyUpdated",
        aggregate_type: "accounting_party",
        aggregate_id: updated.id,
        payload: {
          party_id: updated.id,
          party_type: updated.party_type,
          legal_name: updated.legal_name,
        },
      });
      return updated;
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

router.patch("/parties/:id/status", requirePermission("parties.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizePartyStatusInput(req.body);

    const party = await db.transaction(async client => {
      const current = await client.query(
        `SELECT * FROM ${q("accounting_parties")} WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) {
        const error = new Error("Tercero no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      if (current.rows[0].is_active === input.is_active) {
        const error = new Error(`El tercero ya esta ${input.is_active ? "activo" : "inactivo"}`);
        error.status = 409;
        throw error;
      }

      const { rows } = await client.query(
        `UPDATE ${q("accounting_parties")}
            SET is_active=$1, updated_at=NOW()
          WHERE id=$2
          RETURNING *`,
        [input.is_active, req.params.id]
      );
      const updated = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'party.status_changed','accounting_party',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          updated.id,
          req.id || null,
          JSON.stringify({
            previous_is_active: current.rows[0].is_active,
            is_active: updated.is_active,
            reason: input.reason,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingPartyStatusChanged",
        aggregate_type: "accounting_party",
        aggregate_id: updated.id,
        payload: {
          party_id: updated.id,
          previous_is_active: current.rows[0].is_active,
          is_active: updated.is_active,
          reason: input.reason,
        },
      });
      return updated;
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
