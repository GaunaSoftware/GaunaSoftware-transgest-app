require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const { buildCsv, buildFinancialStatements, normalizeFinancialStatementQuery, normalizeLedgerQuery, normalizeTrialBalanceQuery } = require("../domain/ledger");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function decimalToUnits(value) {
  const raw = String(value || "0");
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = normalized.split(".");
  const units = (BigInt(whole || "0") * 1000000n) + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  return negative ? -units : units;
}

function unitsToDecimal(units) {
  const value = BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1000000n;
  const fraction = String(absolute % 1000000n).padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function summarizeTrialRows(rows) {
  return rows.reduce((acc, row) => ({
    total_debit: acc.total_debit + decimalToUnits(row.total_debit),
    total_credit: acc.total_credit + decimalToUnits(row.total_credit),
    balance_debit: acc.balance_debit + decimalToUnits(row.balance_debit),
    balance_credit: acc.balance_credit + decimalToUnits(row.balance_credit),
  }), {
    total_debit: 0n,
    total_credit: 0n,
    balance_debit: 0n,
    balance_credit: 0n,
  });
}

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

function compactFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

async function assertPeriodInFiscalYear(client, selected, periodId, fiscalYearId) {
  if (!periodId) return null;
  const { rows } = await client.query(
    `SELECT id, name, fiscal_year_id
       FROM ${q("accounting_periods")}
      WHERE id=$1 AND company_id=$2 AND fiscal_year_id=$3
      LIMIT 1`,
    [periodId, selected.company_id, fiscalYearId]
  );
  if (!rows.length) throw httpError("period_id no pertenece al ejercicio y empresa seleccionados", 400);
  return rows[0];
}

function statementCsvRows(sections, totals, kind) {
  if (kind === "balance_sheet") {
    return [
      ...sections.assets.map(row => ({ section: "Activo", ...row })),
      { section: "Total activo", code: "", name: "", amount: totals.assets },
      ...sections.liabilities.map(row => ({ section: "Pasivo", ...row })),
      { section: "Total pasivo", code: "", name: "", amount: totals.liabilities },
      ...sections.equity.map(row => ({ section: "Patrimonio neto", ...row })),
      { section: "Total patrimonio neto", code: "", name: "", amount: totals.equity },
      { section: "Pasivo + patrimonio neto", code: "", name: "", amount: totals.liabilities_equity },
      { section: "Diferencia tecnica", code: "", name: "", amount: totals.difference },
    ];
  }
  return [
    ...sections.income.map(row => ({ section: "Ingresos", ...row })),
    { section: "Total ingresos", code: "", name: "", amount: totals.income },
    ...sections.expenses.map(row => ({ section: "Gastos", ...row })),
    { section: "Total gastos", code: "", name: "", amount: totals.expenses },
    { section: "Resultado", code: "", name: "", amount: totals.result },
  ];
}

async function loadFinancialStatement(req, filters, auditAction, entityType) {
  const selected = selectedContext(req);
  if (!selected) throw httpError("Empresa contable no autorizada", 403);
  const params = [selected.company_id, filters.fiscal_year_id];
  const joinFilters = ["je.id=jl.journal_entry_id", "je.status='posted'"];
  if (filters.period_id) {
    params.push(filters.period_id);
    joinFilters.push(`je.period_id=$${params.length}`);
  }
  if (filters.date_from) {
    params.push(filters.date_from);
    joinFilters.push(`je.entry_date >= $${params.length}`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    joinFilters.push(`je.entry_date <= $${params.length}`);
  }
  const rows = await db.transaction(async client => {
    await assertPeriodInFiscalYear(client, selected, filters.period_id, filters.fiscal_year_id);
    const statementRows = await client.query(
      `SELECT a.id, a.code, a.name, a.account_type,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_amount ELSE 0 END), 0)::text AS total_debit,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_amount ELSE 0 END), 0)::text AS total_credit
         FROM ${q("accounts")} a
         LEFT JOIN ${q("journal_lines")} jl ON jl.account_id=a.id AND jl.company_id=a.company_id
         LEFT JOIN ${q("journal_entries")} je ON ${joinFilters.join(" AND ")}
        WHERE a.company_id=$1 AND a.fiscal_year_id=$2
          AND a.account_type IN ('asset','liability','equity','income','expense')
        GROUP BY a.id
        ORDER BY a.code`,
      params
    );
    if (filters.format === "csv") {
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          auditAction,
          entityType,
          filters.fiscal_year_id,
          req.id || null,
          JSON.stringify({
            fiscal_year_id: filters.fiscal_year_id,
            filters: compactFilters(filters),
            row_count: statementRows.rows.length,
          }),
        ]
      );
    }
    return statementRows.rows;
  });
  return buildFinancialStatements(rows, { include_empty: filters.include_empty });
}

router.use(authenticate);

router.get("/ledger/accounts/:accountId", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeLedgerQuery(req.query);
    const result = await db.transaction(async client => {
      const accountRows = await client.query(
        `SELECT a.id, a.code, a.name, a.account_type, a.is_active, a.is_postable,
                a.fiscal_year_id, fy.year_label
           FROM ${q("accounts")} a
           JOIN ${q("fiscal_years")} fy ON fy.id=a.fiscal_year_id
          WHERE a.id=$1 AND a.company_id=$2`,
        [req.params.accountId, selected.company_id]
      );
      if (!accountRows.rows.length) throw httpError("Cuenta no encontrada para la empresa seleccionada", 404);
      const account = accountRows.rows[0];
      await assertPeriodInFiscalYear(client, selected, filters.period_id, account.fiscal_year_id);
      const params = [selected.company_id, account.id];
      const where = ["je.company_id=$1", "jl.account_id=$2", "je.status='posted'"];
      if (filters.period_id) {
        params.push(filters.period_id);
        where.push(`je.period_id=$${params.length}`);
      }
      if (filters.date_from) {
        params.push(filters.date_from);
        where.push(`je.entry_date >= $${params.length}`);
      }
      if (filters.date_to) {
        params.push(filters.date_to);
        where.push(`je.entry_date <= $${params.length}`);
      }
      params.push(filters.limit);
      const movements = await client.query(
        `SELECT je.id AS journal_entry_id, je.entry_number, je.entry_date, je.description AS entry_description,
                p.id AS period_id, p.name AS period_name, jl.id AS journal_line_id, jl.line_number,
                jl.description AS line_description, jl.debit_amount::text, jl.credit_amount::text,
                SUM(jl.debit_amount - jl.credit_amount)
                  OVER (ORDER BY je.entry_date, je.entry_number, jl.line_number, jl.id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::text AS running_balance
           FROM ${q("journal_lines")} jl
           JOIN ${q("journal_entries")} je ON je.id=jl.journal_entry_id
           JOIN ${q("accounting_periods")} p ON p.id=je.period_id
          WHERE ${where.join(" AND ")}
          ORDER BY je.entry_date, je.entry_number, jl.line_number, jl.id
          LIMIT $${params.length}`,
        params
      );
      const summary = await client.query(
        `SELECT COALESCE(SUM(jl.debit_amount), 0)::text AS total_debit,
                COALESCE(SUM(jl.credit_amount), 0)::text AS total_credit,
                COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0)::text AS balance
           FROM ${q("journal_lines")} jl
           JOIN ${q("journal_entries")} je ON je.id=jl.journal_entry_id
          WHERE ${where.join(" AND ")}`,
        params.slice(0, -1)
      );
      if (filters.format === "csv") {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'ledger.account_csv_exported','account',$4,$5,$6::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            account.id,
            req.id || null,
            JSON.stringify({
              account_code: account.code,
              fiscal_year_id: account.fiscal_year_id,
              filters: compactFilters(filters),
              row_count: movements.rows.length,
            }),
          ]
        );
      }
      return { account, movements: movements.rows, summary: summary.rows[0] };
    });
    if (filters.format === "csv") {
      const csv = buildCsv([
        { key: "entry_date", label: "Fecha" },
        { key: "entry_number", label: "Asiento" },
        { key: "period_name", label: "Periodo" },
        { key: "entry_description", label: "Concepto" },
        { key: "line_description", label: "Detalle" },
        { key: "debit_amount", label: "Debe" },
        { key: "credit_amount", label: "Haber" },
        { key: "running_balance", label: "Saldo" },
      ], result.movements.map(row => ({
        ...row,
        entry_date: String(row.entry_date).slice(0, 10),
        line_description: row.line_description || "",
      })));
      return sendCsv(res, `mayor-${result.account.code}.csv`, csv);
    }
    res.json({ ...result, filters });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/trial-balance", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeTrialBalanceQuery(req.query);
    const params = [selected.company_id, filters.fiscal_year_id];
    const joinFilters = ["je.id=jl.journal_entry_id", "je.status='posted'"];
    if (filters.period_id) {
      params.push(filters.period_id);
      joinFilters.push(`je.period_id=$${params.length}`);
    }
    if (filters.date_from) {
      params.push(filters.date_from);
      joinFilters.push(`je.entry_date >= $${params.length}`);
    }
    if (filters.date_to) {
      params.push(filters.date_to);
      joinFilters.push(`je.entry_date <= $${params.length}`);
    }
    const having = filters.include_empty ? "" : "WHERE total_debit <> 0 OR total_credit <> 0";
    const { rows } = await db.transaction(async client => {
      await assertPeriodInFiscalYear(client, selected, filters.period_id, filters.fiscal_year_id);
      const trial = await client.query(
        `WITH account_totals AS (
           SELECT a.id, a.code, a.name, a.account_type, a.is_active, a.is_postable,
                  COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_amount ELSE 0 END), 0) AS total_debit,
                  COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_amount ELSE 0 END), 0) AS total_credit
             FROM ${q("accounts")} a
             LEFT JOIN ${q("journal_lines")} jl ON jl.account_id=a.id AND jl.company_id=a.company_id
             LEFT JOIN ${q("journal_entries")} je ON ${joinFilters.join(" AND ")}
            WHERE a.company_id=$1 AND a.fiscal_year_id=$2
            GROUP BY a.id
         )
         SELECT id, code, name, account_type, is_active, is_postable,
                total_debit::text, total_credit::text,
                GREATEST(total_debit - total_credit, 0)::text AS balance_debit,
                GREATEST(total_credit - total_debit, 0)::text AS balance_credit
           FROM account_totals
          ${having}
          ORDER BY code`,
        params
      );
      if (filters.format === "csv") {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'ledger.trial_balance_csv_exported','trial_balance',$4,$5,$6::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            filters.fiscal_year_id,
            req.id || null,
            JSON.stringify({
              fiscal_year_id: filters.fiscal_year_id,
              filters: compactFilters(filters),
              row_count: trial.rows.length,
            }),
          ]
        );
      }
      return trial;
    });
    const summaryUnits = summarizeTrialRows(rows);
    const summary = {
      total_debit: unitsToDecimal(summaryUnits.total_debit),
      total_credit: unitsToDecimal(summaryUnits.total_credit),
      balance_debit: unitsToDecimal(summaryUnits.balance_debit),
      balance_credit: unitsToDecimal(summaryUnits.balance_credit),
    };
    if (filters.format === "csv") {
      const csv = buildCsv([
        { key: "code", label: "Cuenta" },
        { key: "name", label: "Nombre" },
        { key: "account_type", label: "Tipo" },
        { key: "total_debit", label: "Suma Debe" },
        { key: "total_credit", label: "Suma Haber" },
        { key: "balance_debit", label: "Saldo Deudor" },
        { key: "balance_credit", label: "Saldo Acreedor" },
      ], rows);
      return sendCsv(res, `sumas-y-saldos-${filters.fiscal_year_id}.csv`, csv);
    }
    res.json({ data: rows, summary, filters });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/balance-sheet", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const filters = normalizeFinancialStatementQuery(req.query);
    const result = await loadFinancialStatement(req, filters, "ledger.balance_sheet_csv_exported", "balance_sheet");
    if (filters.format === "csv") {
      const csv = buildCsv([
        { key: "section", label: "Seccion" },
        { key: "code", label: "Cuenta" },
        { key: "name", label: "Nombre" },
        { key: "amount", label: "Importe" },
      ], statementCsvRows(result.balance_sheet.sections, result.balance_sheet.totals, "balance_sheet"));
      return sendCsv(res, `balance-situacion-${filters.fiscal_year_id}.csv`, csv);
    }
    res.json({ data: result.balance_sheet, filters });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/profit-loss", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const filters = normalizeFinancialStatementQuery(req.query);
    const result = await loadFinancialStatement(req, filters, "ledger.profit_loss_csv_exported", "profit_loss");
    if (filters.format === "csv") {
      const csv = buildCsv([
        { key: "section", label: "Seccion" },
        { key: "code", label: "Cuenta" },
        { key: "name", label: "Nombre" },
        { key: "amount", label: "Importe" },
      ], statementCsvRows(result.profit_loss.sections, result.profit_loss.totals, "profit_loss"));
      return sendCsv(res, `perdidas-ganancias-${filters.fiscal_year_id}.csv`, csv);
    }
    res.json({ data: result.profit_loss, filters });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
