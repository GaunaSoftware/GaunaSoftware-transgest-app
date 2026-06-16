require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

function hasPermission(req, permission) {
  return req.accountingUser.permissions.includes(permission);
}

router.use(authenticate);

router.get("/dashboard", async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });

    const companyId = selected.company_id;
    const snapshot = await db.transaction(async client => {
      const result = {
        company_id: companyId,
        generated_at: new Date().toISOString(),
        fiscal_years: null,
        periods: null,
        accounts: null,
        parties: null,
        maturities: null,
        banks: null,
        journal: null,
        outbox: null,
        priority: {
          maturities: [],
          bank_transactions: [],
          journal_drafts: [],
          outbox_events: [],
        },
      };

      if (hasPermission(req, "fiscal_years.read")) {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS total,
                  COALESCE(MAX(start_date)::text, NULL) AS latest_start_date
             FROM ${q("fiscal_years")}
            WHERE company_id=$1`,
          [companyId]
        );
        result.fiscal_years = rows[0];
      }

      if (hasPermission(req, "periods.read")) {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status='open')::int AS open,
                  COUNT(*) FILTER (WHERE status='locked')::int AS locked,
                  COUNT(*) FILTER (WHERE status='closed')::int AS closed
             FROM ${q("accounting_periods")}
            WHERE company_id=$1`,
          [companyId]
        );
        result.periods = rows[0];
      }

      if (hasPermission(req, "accounts.read")) {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active,
                  COUNT(*) FILTER (WHERE is_postable=TRUE AND is_active=TRUE)::int AS postable
             FROM ${q("accounts")}
            WHERE company_id=$1`,
          [companyId]
        );
        result.accounts = rows[0];
      }

      if (hasPermission(req, "parties.read")) {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active,
                  COUNT(*) FILTER (WHERE party_type IN ('customer', 'customer_supplier') AND is_active=TRUE)::int AS customers,
                  COUNT(*) FILTER (WHERE party_type IN ('supplier', 'customer_supplier') AND is_active=TRUE)::int AS suppliers
             FROM ${q("accounting_parties")}
            WHERE company_id=$1`,
          [companyId]
        );
        result.parties = rows[0];
      }

      if (hasPermission(req, "maturities.read")) {
        const { rows } = await client.query(
          `SELECT COUNT(*) FILTER (WHERE status='pending')::int AS pending,
                  COALESCE(SUM(open_amount) FILTER (WHERE status='pending' AND direction='receivable'), 0)::text AS receivable_amount,
                  COALESCE(SUM(open_amount) FILTER (WHERE status='pending' AND direction='payable'), 0)::text AS payable_amount,
                  COUNT(*) FILTER (WHERE status='pending' AND direction='receivable')::int AS receivable_count,
                  COUNT(*) FILTER (WHERE status='pending' AND direction='payable')::int AS payable_count,
                  COUNT(*) FILTER (WHERE status='pending' AND due_date < CURRENT_DATE)::int AS overdue
             FROM ${q("accounting_maturities")}
            WHERE company_id=$1`,
          [companyId]
        );
        result.maturities = rows[0];
        const priority = await client.query(
          `SELECT m.id, m.direction, m.due_date::text, m.document_ref,
                  m.description, m.open_amount::text, m.currency,
                  p.legal_name AS party_name
             FROM ${q("accounting_maturities")} m
             JOIN ${q("accounting_parties")} p ON p.id=m.party_id
            WHERE m.company_id=$1 AND m.status='pending'
            ORDER BY m.due_date ASC, m.created_at ASC
            LIMIT 5`,
          [companyId]
        );
        result.priority.maturities = priority.rows;
      }

      if (hasPermission(req, "banks.read")) {
        const accountsResult = await client.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active
             FROM ${q("accounting_bank_accounts")}
            WHERE company_id=$1`,
          [companyId]
        );
        const transactionsResult = await client.query(
          `SELECT COUNT(*) FILTER (WHERE status='unmatched')::int AS unmatched,
                  COUNT(*) FILTER (WHERE status='matched')::int AS matched,
                  COALESCE(SUM(amount) FILTER (WHERE direction='inflow'), 0)::text AS inflow_amount,
                  COALESCE(SUM(amount) FILTER (WHERE direction='outflow'), 0)::text AS outflow_amount
             FROM ${q("bank_transactions")}
            WHERE company_id=$1`,
          [companyId]
        );
        result.banks = {
          accounts: accountsResult.rows[0],
          transactions: transactionsResult.rows[0],
        };
        const priority = await client.query(
          `SELECT bt.id, bt.transaction_date::text, bt.value_date::text,
                  bt.description, bt.reference, bt.counterparty_name,
                  bt.amount::text, bt.direction, ba.name AS bank_account_name
             FROM ${q("bank_transactions")} bt
             JOIN ${q("accounting_bank_accounts")} ba ON ba.id=bt.bank_account_id
            WHERE bt.company_id=$1 AND bt.status='unmatched'
            ORDER BY bt.transaction_date DESC, bt.created_at DESC
            LIMIT 5`,
          [companyId]
        );
        result.priority.bank_transactions = priority.rows;
      }

      if (hasPermission(req, "journal.read")) {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status='draft')::int AS draft,
                  COUNT(*) FILTER (WHERE status='posted')::int AS posted,
                  COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled
             FROM ${q("journal_entries")}
            WHERE company_id=$1`,
          [companyId]
        );
        result.journal = rows[0];
        const priority = await client.query(
          `SELECT id, fiscal_year_id, period_id, entry_date::text,
                  description, created_at
             FROM ${q("journal_entries")}
            WHERE company_id=$1 AND status='draft'
            ORDER BY entry_date DESC, created_at DESC
            LIMIT 5`,
          [companyId]
        );
        result.priority.journal_drafts = priority.rows;
      }

      if (hasPermission(req, "outbox.read")) {
        const { rows } = await client.query(
          `SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'retry'))::int AS pending,
                  COUNT(*) FILTER (WHERE status='failed')::int AS failed,
                  COUNT(*) FILTER (WHERE status='processed')::int AS processed
             FROM ${q("outbox_events")}
            WHERE company_id=$1`,
          [companyId]
        );
        result.outbox = rows[0];
        const priority = await client.query(
          `SELECT id, event_type, aggregate_type, aggregate_id,
                  status, attempts, available_at, last_error
             FROM ${q("outbox_events")}
            WHERE company_id=$1 AND status IN ('failed', 'retry', 'pending')
            ORDER BY
              CASE status WHEN 'failed' THEN 0 WHEN 'retry' THEN 1 ELSE 2 END,
              available_at ASC
            LIMIT 5`,
          [companyId]
        );
        result.priority.outbox_events = priority.rows;
      }

      return result;
    });

    res.json({ data: snapshot });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
