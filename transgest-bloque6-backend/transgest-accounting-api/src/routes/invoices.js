require("../resolveWorkspaceModules");
const express = require("express");
const crypto = require("crypto");
const config = require("../services/config");
const db = require("../services/db");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

// Autenticacion servicio-a-servicio con clave compartida (el TMS principal
// empuja las facturas). No usa la sesion de usuario del modulo contable.
function ingestKeyMatches(provided) {
  const expected = process.env.ACCOUNTING_INGEST_KEY || "";
  if (!expected) return null; // ingesta no configurada
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// POST /invoices/ingest — registra una factura en el libro de IVA contable.
router.post("/invoices/ingest", async (req, res, next) => {
  try {
    const match = ingestKeyMatches(req.headers["x-accounting-ingest-key"]);
    if (match === null) return res.status(503).json({ error: "Ingesta de facturas no configurada (ACCOUNTING_INGEST_KEY)" });
    if (!match) return res.status(401).json({ error: "Clave de ingesta invalida" });

    const body = req.body || {};
    const sourceSystem = String(body.source_system || "transgest").trim() || "transgest";
    const sourceCompanyId = String(body.source_company_id || "").trim();
    const sourceRef = String(body.source_ref || "").trim();
    const direction = String(body.direction || "").trim().toLowerCase();
    const entryDate = String(body.entry_date || "").trim();

    if (!/^[0-9a-fA-F-]{36}$/.test(sourceCompanyId)) return res.status(400).json({ error: "source_company_id invalido" });
    if (!sourceRef) return res.status(400).json({ error: "source_ref es obligatorio" });
    if (!["repercutido", "soportado"].includes(direction)) return res.status(400).json({ error: "direction debe ser repercutido o soportado" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return res.status(400).json({ error: "entry_date debe usar formato YYYY-MM-DD" });

    const company = await db.query(
      `SELECT id, tenant_id FROM ${q("accounting_companies")}
        WHERE source_system=$1 AND source_company_id=$2 LIMIT 1`,
      [sourceSystem, sourceCompanyId]
    );
    if (!company.rows.length) {
      return res.status(404).json({ error: "No hay empresa contable vinculada a esa empresa de origen" });
    }
    const companyId = company.rows[0].id;
    const tenantId = company.rows[0].tenant_id;
    const party = body.party || {};

    const saved = await db.query(
      `INSERT INTO ${q("accounting_vat_entries")}
         (tenant_id, company_id, direction, entry_date, party_tax_id, party_name, invoice_number,
          base, iva_rate, iva_amount, irpf_rate, irpf_amount, total, source_system, source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (company_id, source_system, source_ref) DO UPDATE SET
         direction=EXCLUDED.direction, entry_date=EXCLUDED.entry_date,
         party_tax_id=EXCLUDED.party_tax_id, party_name=EXCLUDED.party_name, invoice_number=EXCLUDED.invoice_number,
         base=EXCLUDED.base, iva_rate=EXCLUDED.iva_rate, iva_amount=EXCLUDED.iva_amount,
         irpf_rate=EXCLUDED.irpf_rate, irpf_amount=EXCLUDED.irpf_amount, total=EXCLUDED.total, updated_at=NOW()
       RETURNING id`,
      [
        tenantId, companyId, direction, entryDate,
        String(party.tax_id || "").slice(0, 40) || null,
        String(party.name || "").slice(0, 220) || null,
        String(body.invoice_number || "").slice(0, 80) || null,
        num(body.base), num(body.iva_rate), num(body.iva_amount),
        num(body.irpf_rate), num(body.irpf_amount), num(body.total),
        sourceSystem, sourceRef.slice(0, 180),
      ]
    );

    res.json({ ok: true, id: saved.rows[0].id });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
