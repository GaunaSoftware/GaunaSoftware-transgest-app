require("../resolveWorkspaceModules");
const crypto = require("crypto");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  moneyUnits,
  IMPORT_SOURCE_SYSTEM,
  IMPORT_SOURCE_TYPE,
  normalizeBankAccountInput,
  normalizeBankAccountQuery,
  normalizeBankReconciliationInput,
  normalizeBankReconciliationSuggestionQuery,
  normalizeBankReconciliationVoidInput,
  normalizeBankStatementImportInput,
  normalizeBankStatementImportQuery,
  normalizeBankTransactionInput,
  normalizeBankTransactionQuery,
  normalizeBankTransactionStatusInput,
  parseBankStatementCsv,
  scoreBankReconciliationCandidate,
} = require("../domain/banks");
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function bankImportRowSourceId(bankAccountId, row) {
  return `csv:${sha256(JSON.stringify({
    bank_account_id: bankAccountId,
    transaction_date: row.transaction_date,
    value_date: row.value_date,
    description: row.description,
    reference: row.reference,
    counterparty_name: row.counterparty_name,
    amount: row.amount,
    direction: row.direction,
  }))}`;
}

function dbDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
}

async function assertPostableAccount(client, companyId, accountId) {
  if (!accountId) return;
  const { rows } = await client.query(
    `SELECT id FROM ${q("accounts")}
      WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_postable=TRUE`,
    [accountId, companyId]
  );
  if (!rows.length) {
    const error = new Error("Cuenta contable asociada no encontrada o no operativa");
    error.status = 400;
    throw error;
  }
}

async function assertActiveBankAccount(client, companyId, bankAccountId) {
  const { rows } = await client.query(
    `SELECT id, name, currency
       FROM ${q("accounting_bank_accounts")}
      WHERE id=$1 AND company_id=$2 AND is_active=TRUE`,
    [bankAccountId, companyId]
  );
  if (!rows.length) {
    const error = new Error("Cuenta bancaria no encontrada o inactiva para la empresa seleccionada");
    error.status = 400;
    throw error;
  }
  return rows[0];
}

async function loadBankAccounts(client, companyId, filters) {
  const params = [companyId];
  const where = ["ba.company_id=$1"];
  if (filters.active !== null) {
    params.push(filters.active);
    where.push(`ba.is_active=$${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(ba.name ILIKE $${params.length} OR ba.bank_name ILIKE $${params.length} OR ba.iban ILIKE $${params.length})`);
  }
  params.push(filters.limit);

  const { rows } = await client.query(
    `SELECT ba.id, ba.tenant_id, ba.company_id, ba.account_id, a.code AS account_code,
            a.name AS account_name, ba.name, ba.bank_name, ba.iban, ba.swift_bic,
            ba.currency, ba.opening_balance::text, ba.is_active, ba.notes,
            ba.created_at, ba.updated_at
       FROM ${q("accounting_bank_accounts")} ba
       LEFT JOIN ${q("accounts")} a ON a.id=ba.account_id
      WHERE ${where.join(" AND ")}
      ORDER BY ba.name ASC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function loadBankTransactions(client, companyId, filters) {
  const params = [companyId];
  const where = ["bt.company_id=$1"];
  if (filters.bank_account_id) {
    params.push(filters.bank_account_id);
    where.push(`bt.bank_account_id=$${params.length}`);
  }
  if (filters.direction) {
    params.push(filters.direction);
    where.push(`bt.direction=$${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`bt.status=$${params.length}`);
  }
  if (filters.date_from) {
    params.push(filters.date_from);
    where.push(`bt.transaction_date >= $${params.length}::date`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    where.push(`bt.transaction_date <= $${params.length}::date`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(bt.description ILIKE $${params.length} OR bt.reference ILIKE $${params.length} OR bt.counterparty_name ILIKE $${params.length} OR ba.name ILIKE $${params.length})`);
  }
  params.push(filters.limit);

  const { rows } = await client.query(
    `SELECT bt.id, bt.tenant_id, bt.company_id, bt.bank_account_id, ba.name AS bank_account_name,
            bt.transaction_date, bt.value_date, bt.description, bt.reference, bt.counterparty_name,
            bt.amount::text, bt.direction, bt.status, bt.source_system, bt.source_type,
            bt.source_id, bt.notes, br.id AS reconciliation_id, br.maturity_id AS reconciled_maturity_id,
            br.matched_at AS reconciled_at, bt.created_at, bt.updated_at
       FROM ${q("bank_transactions")} bt
       JOIN ${q("accounting_bank_accounts")} ba ON ba.id=bt.bank_account_id
       LEFT JOIN ${q("bank_reconciliations")} br ON br.bank_transaction_id=bt.id AND br.status='active'
      WHERE ${where.join(" AND ")}
      ORDER BY bt.transaction_date DESC, bt.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function loadBankStatementImports(client, companyId, filters) {
  const params = [companyId];
  const where = ["bsi.company_id=$1"];
  if (filters.bank_account_id) {
    params.push(filters.bank_account_id);
    where.push(`bsi.bank_account_id=$${params.length}`);
  }
  params.push(filters.limit);

  const { rows } = await client.query(
    `SELECT bsi.id, bsi.tenant_id, bsi.company_id, bsi.bank_account_id,
            ba.name AS bank_account_name, bsi.source_type, bsi.original_filename,
            bsi.row_count, bsi.inserted_count, bsi.skipped_count, bsi.error_count,
            bsi.imported_by, u.display_name AS imported_by_name, bsi.created_at
       FROM ${q("bank_statement_imports")} bsi
       JOIN ${q("accounting_bank_accounts")} ba ON ba.id=bsi.bank_account_id
       LEFT JOIN ${q("accounting_users")} u ON u.id=bsi.imported_by
      WHERE ${where.join(" AND ")}
      ORDER BY bsi.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

router.use(authenticate);

router.get("/bank-accounts", requirePermission("banks.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeBankAccountQuery(req.query);
    const rows = await db.transaction(client => loadBankAccounts(client, selected.company_id, filters));
    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.post("/bank-accounts", requirePermission("banks.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeBankAccountInput(req.body);

    const bankAccount = await db.transaction(async client => {
      await assertPostableAccount(client, selected.company_id, input.account_id);
      const { rows } = await client.query(
        `INSERT INTO ${q("accounting_bank_accounts")}
           (tenant_id, company_id, account_id, name, bank_name, iban, swift_bic,
            currency, opening_balance, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.account_id,
          input.name,
          input.bank_name,
          input.iban,
          input.swift_bic,
          input.currency,
          input.opening_balance,
          input.notes,
          req.accountingUser.id,
        ]
      );
      const created = rows[0];
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'bank_account.created','accounting_bank_account',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          created.id,
          req.id || null,
          JSON.stringify({
            name: created.name,
            bank_name: created.bank_name,
            currency: created.currency,
            has_iban: Boolean(created.iban),
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingBankAccountCreated",
        aggregate_type: "accounting_bank_account",
        aggregate_id: created.id,
        payload: {
          bank_account_id: created.id,
          name: created.name,
          currency: created.currency,
          is_active: created.is_active,
        },
      });
      return created;
    });

    res.status(201).json({ bank_account: bankAccount });
  } catch (error) {
    next(error);
  }
});

router.get("/bank-transactions", requirePermission("banks.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeBankTransactionQuery(req.query);
    if (filters.format === "csv") {
      const rows = await db.transaction(async client => {
        const bankRows = await loadBankTransactions(client, selected.company_id, filters);
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, request_id, detail)
           VALUES ($1,$2,'user',$3,'bank_transaction.csv_exported','bank_transaction',$4,$5::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            req.id || null,
            JSON.stringify({ filters: compactFilters(filters), row_count: bankRows.length }),
          ]
        );
        return bankRows;
      });
      const csv = buildCsv([
        { key: "bank_account_name", label: "Cuenta bancaria" },
        { key: "transaction_date", label: "Fecha" },
        { key: "value_date", label: "Fecha valor" },
        { key: "direction", label: "Tipo" },
        { key: "amount", label: "Importe" },
        { key: "description", label: "Descripcion" },
        { key: "reference", label: "Referencia" },
        { key: "counterparty_name", label: "Contraparte" },
        { key: "status", label: "Estado" },
      ], rows);
      return sendCsv(res, "movimientos_bancarios.csv", csv);
    }
    const rows = await db.transaction(client => loadBankTransactions(client, selected.company_id, filters));
    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.post("/bank-transactions", requirePermission("banks.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeBankTransactionInput(req.body);

    const transaction = await db.transaction(async client => {
      await assertActiveBankAccount(client, selected.company_id, input.bank_account_id);
      const { rows } = await client.query(
        `INSERT INTO ${q("bank_transactions")}
           (tenant_id, company_id, bank_account_id, transaction_date, value_date, description,
            reference, counterparty_name, amount, direction, source_system, source_type,
            source_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.bank_account_id,
          input.transaction_date,
          input.value_date,
          input.description,
          input.reference,
          input.counterparty_name,
          input.amount,
          input.direction,
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
         VALUES ($1,$2,'user',$3,'bank_transaction.created','bank_transaction',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          created.id,
          req.id || null,
          JSON.stringify({
            bank_account_id: created.bank_account_id,
            transaction_date: created.transaction_date,
            direction: created.direction,
            amount: created.amount,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingBankTransactionCreated",
        aggregate_type: "bank_transaction",
        aggregate_id: created.id,
        payload: {
          bank_transaction_id: created.id,
          bank_account_id: created.bank_account_id,
          transaction_date: String(created.transaction_date).slice(0, 10),
          direction: created.direction,
          amount: String(created.amount),
          status: created.status,
        },
      });
      return created;
    });

    res.status(201).json({ bank_transaction: transaction });
  } catch (error) {
    next(error);
  }
});

router.get("/bank-statement-imports", requirePermission("banks.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeBankStatementImportQuery(req.query);
    const rows = await db.transaction(client => loadBankStatementImports(client, selected.company_id, filters));
    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.post("/bank-statement-imports", requirePermission("banks.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeBankStatementImportInput(req.body);
    const parsed = parseBankStatementCsv(input.csv_text);
    if (!parsed.rows.length) {
      const error = new Error("El CSV no contiene movimientos validos para importar");
      error.status = 400;
      error.details = parsed.errors;
      throw error;
    }
    const requestHash = sha256(JSON.stringify({
      bank_account_id: input.bank_account_id,
      csv_text: input.csv_text.replace(/\r\n/g, "\n").trim(),
    }));

    const result = await db.transaction(async client => {
      const bankAccount = await assertActiveBankAccount(client, selected.company_id, input.bank_account_id);
      const existing = await client.query(
        `SELECT *
           FROM ${q("bank_statement_imports")}
          WHERE company_id=$1 AND request_hash=$2`,
        [selected.company_id, requestHash]
      );
      if (existing.rows.length) {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'bank_statement_import.reused','bank_statement_import',$4,$5,$6::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            existing.rows[0].id,
            req.id || null,
            JSON.stringify({ bank_account_id: input.bank_account_id, request_hash: requestHash }),
          ]
        );
        return {
          import: existing.rows[0],
          inserted_transactions: [],
          errors: [],
          idempotent: true,
        };
      }

      const importResult = await client.query(
        `INSERT INTO ${q("bank_statement_imports")}
           (tenant_id, company_id, bank_account_id, source_type, original_filename,
            request_hash, row_count, error_count, imported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.bank_account_id,
          IMPORT_SOURCE_TYPE,
          input.filename,
          requestHash,
          parsed.row_count,
          parsed.errors.length,
          req.accountingUser.id,
        ]
      );
      const importRecord = importResult.rows[0];
      const insertedTransactions = [];
      for (const row of parsed.rows) {
        const sourceId = bankImportRowSourceId(input.bank_account_id, row);
        const inserted = await client.query(
          `INSERT INTO ${q("bank_transactions")}
             (tenant_id, company_id, bank_account_id, transaction_date, value_date,
              description, reference, counterparty_name, amount, direction,
              source_system, source_type, source_id, notes, created_by, import_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [
            selected.tenant_id,
            selected.company_id,
            input.bank_account_id,
            row.transaction_date,
            row.value_date,
            row.description,
            row.reference,
            row.counterparty_name,
            row.amount,
            row.direction,
            IMPORT_SOURCE_SYSTEM,
            IMPORT_SOURCE_TYPE,
            sourceId,
            `Importado desde CSV fila ${row.row_number}`,
            req.accountingUser.id,
            importRecord.id,
          ]
        );
        if (inserted.rows.length) insertedTransactions.push(inserted.rows[0]);
      }
      const skippedCount = parsed.rows.length - insertedTransactions.length;
      const updatedImport = await client.query(
        `UPDATE ${q("bank_statement_imports")}
            SET inserted_count=$1, skipped_count=$2
          WHERE id=$3
          RETURNING *`,
        [insertedTransactions.length, skippedCount, importRecord.id]
      );

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'bank_statement_import.created','bank_statement_import',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          importRecord.id,
          req.id || null,
          JSON.stringify({
            bank_account_id: input.bank_account_id,
            bank_account_name: bankAccount.name,
            filename: input.filename,
            row_count: parsed.row_count,
            inserted_count: insertedTransactions.length,
            skipped_count: skippedCount,
            error_count: parsed.errors.length,
            errors: parsed.errors.slice(0, 10),
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingBankStatementImported",
        aggregate_type: "bank_statement_import",
        aggregate_id: importRecord.id,
        payload: {
          import_id: importRecord.id,
          bank_account_id: input.bank_account_id,
          row_count: parsed.row_count,
          inserted_count: insertedTransactions.length,
          skipped_count: skippedCount,
          error_count: parsed.errors.length,
        },
      });

      return {
        import: updatedImport.rows[0],
        inserted_transactions: insertedTransactions,
        errors: parsed.errors,
        idempotent: false,
      };
    });

    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/bank-transactions/:id/status", requirePermission("banks.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeBankTransactionStatusInput(req.body);

    const result = await db.transaction(async client => {
      const transactionResult = await client.query(
        `SELECT bt.*, ba.name AS bank_account_name
           FROM ${q("bank_transactions")} bt
           JOIN ${q("accounting_bank_accounts")} ba ON ba.id=bt.bank_account_id
          WHERE bt.id=$1 AND bt.company_id=$2
          FOR UPDATE OF bt`,
        [req.params.id, selected.company_id]
      );
      if (!transactionResult.rows.length) {
        const error = new Error("Movimiento bancario no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const bankTransaction = transactionResult.rows[0];
      const nextStatus = input.action === "ignore" ? "ignored" : "unmatched";
      if (input.action === "ignore" && bankTransaction.status !== "unmatched") {
        const error = new Error("Solo se pueden ignorar movimientos bancarios pendientes");
        error.status = 400;
        throw error;
      }
      if (input.action === "reopen" && bankTransaction.status !== "ignored") {
        const error = new Error("Solo se pueden reabrir movimientos bancarios ignorados");
        error.status = 400;
        throw error;
      }

      const updated = await client.query(
        `UPDATE ${q("bank_transactions")}
            SET status=$1, updated_at=NOW()
          WHERE id=$2
          RETURNING *`,
        [nextStatus, bankTransaction.id]
      );

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'bank_transaction.status_changed','bank_transaction',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          bankTransaction.id,
          req.id || null,
          JSON.stringify({
            previous_status: bankTransaction.status,
            status: nextStatus,
            action: input.action,
            reason: input.reason,
          }),
        ]
      );

      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingBankTransactionStatusChanged",
        aggregate_type: "bank_transaction",
        aggregate_id: bankTransaction.id,
        payload: {
          bank_transaction_id: bankTransaction.id,
          previous_status: bankTransaction.status,
          status: nextStatus,
          action: input.action,
          reason: input.reason,
        },
      });

      return {
        bank_transaction: {
          ...updated.rows[0],
          bank_account_name: bankTransaction.bank_account_name,
        },
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/bank-transactions/:id/reconciliation-suggestions", requirePermission("banks.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeBankReconciliationSuggestionQuery(req.query);

    const result = await db.transaction(async client => {
      const transactionResult = await client.query(
        `SELECT bt.*, ba.name AS bank_account_name
           FROM ${q("bank_transactions")} bt
           JOIN ${q("accounting_bank_accounts")} ba ON ba.id=bt.bank_account_id
          WHERE bt.id=$1 AND bt.company_id=$2`,
        [req.params.id, selected.company_id]
      );
      if (!transactionResult.rows.length) {
        const error = new Error("Movimiento bancario no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const bankTransaction = transactionResult.rows[0];
      if (bankTransaction.status !== "unmatched") {
        const error = new Error("Solo se generan sugerencias para movimientos bancarios pendientes");
        error.status = 400;
        throw error;
      }

      const expectedDirection = bankTransaction.direction === "inflow" ? "receivable" : "payable";
      const transactionDate = dbDateOnly(bankTransaction.transaction_date);
      const maturityResult = await client.query(
        `SELECT m.id, m.tenant_id, m.company_id, m.party_id, p.legal_name AS party_name,
                m.direction, m.status, m.issue_date, m.due_date, m.document_ref,
                m.description, m.amount::text, m.open_amount::text, m.payment_method, m.notes
           FROM ${q("accounting_maturities")} m
           JOIN ${q("accounting_parties")} p ON p.id=m.party_id
          WHERE m.company_id=$1
            AND m.status='pending'
            AND m.direction=$2
            AND m.open_amount=$3::numeric
            AND m.due_date BETWEEN ($4::date - ($5::int * INTERVAL '1 day'))
                              AND ($4::date + ($5::int * INTERVAL '1 day'))
          ORDER BY ABS(m.due_date - $4::date), m.due_date ASC, m.created_at ASC
          LIMIT 100`,
        [
          selected.company_id,
          expectedDirection,
          bankTransaction.amount,
          transactionDate,
          filters.days_window,
        ]
      );

      const suggestions = maturityResult.rows
        .map(maturity => {
          const scoring = scoreBankReconciliationCandidate(bankTransaction, maturity);
          return { maturity, score: scoring.score, reasons: scoring.reasons };
        })
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || String(left.maturity.due_date).localeCompare(String(right.maturity.due_date)))
        .slice(0, filters.limit);

      return {
        bank_transaction: bankTransaction,
        suggestions,
        filters,
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/bank-transactions/:id/reconcile", requirePermission("banks.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeBankReconciliationInput(req.body);

    const result = await db.transaction(async client => {
      const transactionResult = await client.query(
        `SELECT bt.*, ba.name AS bank_account_name
           FROM ${q("bank_transactions")} bt
           JOIN ${q("accounting_bank_accounts")} ba ON ba.id=bt.bank_account_id
          WHERE bt.id=$1 AND bt.company_id=$2
          FOR UPDATE OF bt`,
        [req.params.id, selected.company_id]
      );
      if (!transactionResult.rows.length) {
        const error = new Error("Movimiento bancario no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const bankTransaction = transactionResult.rows[0];
      if (bankTransaction.status !== "unmatched") {
        const error = new Error("Solo se pueden conciliar movimientos bancarios pendientes");
        error.status = 400;
        throw error;
      }

      const maturityResult = await client.query(
        `SELECT m.*, p.legal_name AS party_name
           FROM ${q("accounting_maturities")} m
           JOIN ${q("accounting_parties")} p ON p.id=m.party_id
          WHERE m.id=$1 AND m.company_id=$2
          FOR UPDATE OF m`,
        [input.maturity_id, selected.company_id]
      );
      if (!maturityResult.rows.length) {
        const error = new Error("Vencimiento no encontrado para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const maturity = maturityResult.rows[0];
      if (maturity.status !== "pending") {
        const error = new Error("Solo se pueden conciliar vencimientos pendientes");
        error.status = 400;
        throw error;
      }

      const expectedDirection = bankTransaction.direction === "inflow" ? "receivable" : "payable";
      if (maturity.direction !== expectedDirection) {
        const error = new Error("La direccion del movimiento bancario no coincide con el tipo de vencimiento");
        error.status = 400;
        throw error;
      }
      if (moneyUnits(bankTransaction.amount) !== moneyUnits(maturity.open_amount)) {
        const error = new Error("La conciliacion manual v1 exige importe exacto entre movimiento y vencimiento");
        error.status = 400;
        throw error;
      }

      const reconciliationResult = await client.query(
        `INSERT INTO ${q("bank_reconciliations")}
           (tenant_id, company_id, bank_transaction_id, maturity_id, matched_amount, matched_by, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          bankTransaction.id,
          maturity.id,
          bankTransaction.amount,
          req.accountingUser.id,
          input.reason,
        ]
      );

      const updatedTransaction = await client.query(
        `UPDATE ${q("bank_transactions")}
            SET status='matched', updated_at=NOW()
          WHERE id=$1
          RETURNING *`,
        [bankTransaction.id]
      );
      const updatedMaturity = await client.query(
        `UPDATE ${q("accounting_maturities")}
            SET status='settled', open_amount=0, settled_at=NOW(), settled_by=$1,
                status_reason=$2, updated_at=NOW()
          WHERE id=$3
          RETURNING *`,
        [req.accountingUser.id, input.reason, maturity.id]
      );
      const reconciliation = reconciliationResult.rows[0];

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'bank_transaction.reconciled','bank_reconciliation',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          reconciliation.id,
          req.id || null,
          JSON.stringify({
            bank_transaction_id: bankTransaction.id,
            maturity_id: maturity.id,
            amount: bankTransaction.amount,
            reason: input.reason,
          }),
        ]
      );

      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingBankTransactionReconciled",
        aggregate_type: "bank_reconciliation",
        aggregate_id: reconciliation.id,
        payload: {
          bank_reconciliation_id: reconciliation.id,
          bank_transaction_id: bankTransaction.id,
          maturity_id: maturity.id,
          amount: String(bankTransaction.amount),
          reason: input.reason,
        },
      });
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingMaturityStatusChanged",
        aggregate_type: "accounting_maturity",
        aggregate_id: maturity.id,
        payload: {
          maturity_id: maturity.id,
          previous_status: maturity.status,
          status: "settled",
          action: "settle",
          reason: input.reason,
        },
      });

      return {
        reconciliation,
        bank_transaction: {
          ...updatedTransaction.rows[0],
          bank_account_name: bankTransaction.bank_account_name,
        },
        maturity: {
          ...updatedMaturity.rows[0],
          party_name: maturity.party_name,
        },
      };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/bank-reconciliations/:id/reverse", requirePermission("banks.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeBankReconciliationVoidInput(req.body);

    const result = await db.transaction(async client => {
      const reconciliationResult = await client.query(
        `SELECT br.*, bt.status AS bank_transaction_status, bt.amount AS bank_transaction_amount,
                bt.direction AS bank_transaction_direction, bt.bank_account_id,
                bt.description AS bank_transaction_description, ba.name AS bank_account_name,
                m.status AS maturity_status, m.direction AS maturity_direction,
                m.open_amount AS maturity_open_amount, p.legal_name AS party_name
           FROM ${q("bank_reconciliations")} br
           JOIN ${q("bank_transactions")} bt ON bt.id=br.bank_transaction_id
           JOIN ${q("accounting_bank_accounts")} ba ON ba.id=bt.bank_account_id
           JOIN ${q("accounting_maturities")} m ON m.id=br.maturity_id
           JOIN ${q("accounting_parties")} p ON p.id=m.party_id
          WHERE br.id=$1 AND br.company_id=$2 AND br.status='active'
          FOR UPDATE OF br, bt, m`,
        [req.params.id, selected.company_id]
      );
      if (!reconciliationResult.rows.length) {
        const error = new Error("Conciliacion bancaria activa no encontrada para la empresa seleccionada");
        error.status = 404;
        throw error;
      }
      const reconciliation = reconciliationResult.rows[0];
      if (reconciliation.bank_transaction_status !== "matched" || reconciliation.maturity_status !== "settled") {
        const error = new Error("Solo se pueden revertir conciliaciones con movimiento conciliado y vencimiento liquidado");
        error.status = 400;
        throw error;
      }

      const voided = await client.query(
        `UPDATE ${q("bank_reconciliations")}
            SET status='voided', voided_at=NOW(), voided_by=$1, void_reason=$2
          WHERE id=$3
          RETURNING *`,
        [req.accountingUser.id, input.reason, reconciliation.id]
      );
      const updatedTransaction = await client.query(
        `UPDATE ${q("bank_transactions")}
            SET status='unmatched', updated_at=NOW()
          WHERE id=$1
          RETURNING *`,
        [reconciliation.bank_transaction_id]
      );
      const updatedMaturity = await client.query(
        `UPDATE ${q("accounting_maturities")}
            SET status='pending', open_amount=$1, settled_at=NULL, settled_by=NULL,
                status_reason=$2, updated_at=NOW()
          WHERE id=$3
          RETURNING *`,
        [reconciliation.matched_amount, input.reason, reconciliation.maturity_id]
      );

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'bank_reconciliation.reversed','bank_reconciliation',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          reconciliation.id,
          req.id || null,
          JSON.stringify({
            bank_transaction_id: reconciliation.bank_transaction_id,
            maturity_id: reconciliation.maturity_id,
            amount: reconciliation.matched_amount,
            reason: input.reason,
          }),
        ]
      );

      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingBankReconciliationReversed",
        aggregate_type: "bank_reconciliation",
        aggregate_id: reconciliation.id,
        payload: {
          bank_reconciliation_id: reconciliation.id,
          bank_transaction_id: reconciliation.bank_transaction_id,
          maturity_id: reconciliation.maturity_id,
          amount: String(reconciliation.matched_amount),
          reason: input.reason,
        },
      });
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingMaturityStatusChanged",
        aggregate_type: "accounting_maturity",
        aggregate_id: reconciliation.maturity_id,
        payload: {
          maturity_id: reconciliation.maturity_id,
          previous_status: "settled",
          status: "pending",
          action: "reopen",
          reason: input.reason,
        },
      });

      return {
        reconciliation: voided.rows[0],
        bank_transaction: {
          ...updatedTransaction.rows[0],
          bank_account_name: reconciliation.bank_account_name,
        },
        maturity: {
          ...updatedMaturity.rows[0],
          party_name: reconciliation.party_name,
        },
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
