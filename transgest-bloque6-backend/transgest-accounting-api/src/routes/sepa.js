require("../resolveWorkspaceModules");
const express = require("express");
const crypto = require("crypto");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const { buildCreditTransferXml } = require("../domain/sepa");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

function normalizeDate(value, field) {
  const date = String(value || "").trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error(`${field} debe usar formato YYYY-MM-DD`);
    error.status = 400;
    throw error;
  }
  return date;
}

router.use(authenticate);

// ── GET /sepa/credit-transfer ── Remesa SEPA de pagos (pain.001.001.03) ──
// Genera el fichero XML de transferencias con los vencimientos pagaderos
// pendientes cuyo tercero tiene IBAN. Validar con el banco antes de usar.
router.get("/sepa/credit-transfer", requirePermission("maturities.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });

    const bankAccountId = String(req.query.bank_account_id || "").trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(bankAccountId)) {
      return res.status(400).json({ error: "bank_account_id es obligatorio" });
    }
    const dueBefore = normalizeDate(req.query.due_before, "due_before");
    const execDate = normalizeDate(req.query.execution_date, "execution_date");

    const result = await db.transaction(async client => {
      const company = await client.query(
        `SELECT legal_name FROM ${q("accounting_companies")} WHERE id=$1 LIMIT 1`,
        [selected.company_id]
      );
      const bank = await client.query(
        `SELECT name, bank_name, iban, swift_bic
           FROM ${q("accounting_bank_accounts")}
          WHERE id=$1 AND company_id=$2 AND is_active=true
          LIMIT 1`,
        [bankAccountId, selected.company_id]
      );
      if (!bank.rows.length) {
        const error = new Error("Cuenta bancaria ordenante no encontrada o inactiva");
        error.status = 404;
        throw error;
      }
      if (!bank.rows[0].iban) {
        const error = new Error("La cuenta bancaria ordenante no tiene IBAN configurado");
        error.status = 422;
        throw error;
      }

      const params = [selected.company_id];
      let dueFilter = "";
      if (dueBefore) { params.push(dueBefore); dueFilter = `AND m.due_date <= $${params.length}`; }
      const maturities = await client.query(
        `SELECT m.id, m.open_amount::text AS open_amount, m.description, m.document_ref, m.due_date,
                p.legal_name AS party_name, p.iban AS party_iban, p.swift_bic AS party_bic
           FROM ${q("accounting_maturities")} m
           JOIN ${q("accounting_parties")} p ON p.id=m.party_id
          WHERE m.company_id=$1 AND m.direction='payable' AND m.status='pending'
            AND m.open_amount > 0
            AND p.iban IS NOT NULL AND p.iban <> ''
            ${dueFilter}
          ORDER BY m.due_date ASC, p.legal_name ASC`,
        params
      );

      const messageId = `REM${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const built = buildCreditTransferXml({
        messageId,
        debtorName: company.rows[0]?.legal_name || bank.rows[0].name,
        debtorIban: bank.rows[0].iban,
        debtorBic: bank.rows[0].swift_bic || "",
        requestedExecutionDate: execDate || undefined,
        payments: maturities.rows.map(row => ({
          endToEndId: row.document_ref || String(row.id).slice(0, 35),
          amount: row.open_amount,
          creditorName: row.party_name,
          creditorIban: row.party_iban,
          creditorBic: row.party_bic || "",
          remittanceInfo: row.description || row.document_ref || "",
        })),
      });

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'sepa.credit_transfer_generated','sepa_remittance',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id, selected.company_id, req.accountingUser.id, bankAccountId, req.id || null,
          JSON.stringify({ message_id: messageId, nb_of_txs: built.nbOfTxs, ctrl_sum: built.ctrlSum, due_before: dueBefore || null }),
        ]
      );

      return { ...built, messageId };
    });

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${result.messageId}.xml"`);
    res.send(result.xml);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
