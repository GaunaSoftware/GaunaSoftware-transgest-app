const { normalizeBankTransactionQuery } = require("../domain/banks");
const { buildCsv } = require("../domain/csv");
const { normalizeJournalQuery } = require("../domain/journalEntries");
const { buildFinancialStatements, normalizeFinancialStatementQuery, normalizeTrialBalanceQuery } = require("../domain/ledger");
const { normalizeMaturityQuery } = require("../domain/maturities");
const { normalizePartyQuery } = require("../domain/parties");
const config = require("./config");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function q(name) {
  return `"${config.schema}"."${String(name).replace(/"/g, '""')}"`;
}

function isoDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function byExportId(manifest) {
  return new Map((manifest.exports || []).map(item => [item.id, item]));
}

function uuidOrNull(value) {
  const text = String(value || "").trim();
  return UUID_RE.test(text) ? text : null;
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

function isAvailable(manifest, exportId) {
  const item = byExportId(manifest).get(exportId);
  return Boolean(item && item.available);
}

async function loadPartiesCsv(client, companyId) {
  const filters = normalizePartyQuery({ format: "csv", limit: 500 });
  const { rows } = await client.query(
    `SELECT p.legal_name, p.party_type, p.tax_id, p.email, p.phone,
            a.code AS default_account_code, p.is_active
       FROM ${q("accounting_parties")} p
       LEFT JOIN ${q("accounts")} a ON a.id=p.default_account_id
      WHERE p.company_id=$1
      ORDER BY p.legal_name ASC
      LIMIT $2`,
    [companyId, filters.limit]
  );
  return {
    name: "exports/terceros.csv",
    row_count: rows.length,
    content: buildCsv([
      { key: "legal_name", label: "Nombre fiscal" },
      { key: "party_type", label: "Tipo" },
      { key: "tax_id", label: "NIF/CIF" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Telefono" },
      { key: "default_account_code", label: "Cuenta" },
      { key: "is_active", label: "Activo" },
    ], rows),
  };
}

async function loadMaturitiesCsv(client, companyId) {
  const filters = normalizeMaturityQuery({ format: "csv", limit: 500 });
  const { rows } = await client.query(
    `SELECT m.direction, p.legal_name AS party_name, m.due_date,
            m.document_ref, m.description, m.amount::text,
            m.open_amount::text, m.status
       FROM ${q("accounting_maturities")} m
       JOIN ${q("accounting_parties")} p ON p.id=m.party_id
      WHERE m.company_id=$1
      ORDER BY m.due_date ASC, p.legal_name ASC
      LIMIT $2`,
    [companyId, filters.limit]
  );
  return {
    name: "exports/vencimientos.csv",
    row_count: rows.length,
    content: buildCsv([
      { key: "direction", label: "Tipo" },
      { key: "party_name", label: "Tercero" },
      { key: "due_date", label: "Vencimiento" },
      { key: "document_ref", label: "Documento" },
      { key: "description", label: "Descripcion" },
      { key: "amount", label: "Importe" },
      { key: "open_amount", label: "Pendiente" },
      { key: "status", label: "Estado" },
    ], rows.map(row => ({ ...row, due_date: isoDate(row.due_date) }))),
  };
}

async function loadBankTransactionsCsv(client, companyId, manifestFilters = {}) {
  const filters = normalizeBankTransactionQuery({
    format: "csv",
    limit: 500,
    date_from: manifestFilters.date_from,
    date_to: manifestFilters.date_to,
  });
  const params = [companyId];
  const where = ["bt.company_id=$1"];
  if (filters.date_from) {
    params.push(filters.date_from);
    where.push(`bt.transaction_date >= $${params.length}::date`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    where.push(`bt.transaction_date <= $${params.length}::date`);
  }
  params.push(filters.limit);
  const { rows } = await client.query(
    `SELECT ba.name AS bank_account_name, bt.transaction_date, bt.value_date,
            bt.direction, bt.amount::text, bt.description, bt.reference,
            bt.counterparty_name, bt.status
       FROM ${q("bank_transactions")} bt
       JOIN ${q("accounting_bank_accounts")} ba ON ba.id=bt.bank_account_id
      WHERE ${where.join(" AND ")}
      ORDER BY bt.transaction_date DESC, bt.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return {
    name: "exports/movimientos_bancarios.csv",
    row_count: rows.length,
    content: buildCsv([
      { key: "bank_account_name", label: "Cuenta bancaria" },
      { key: "transaction_date", label: "Fecha" },
      { key: "value_date", label: "Fecha valor" },
      { key: "direction", label: "Tipo" },
      { key: "amount", label: "Importe" },
      { key: "description", label: "Descripcion" },
      { key: "reference", label: "Referencia" },
      { key: "counterparty_name", label: "Contraparte" },
      { key: "status", label: "Estado" },
    ], rows.map(row => ({
      ...row,
      transaction_date: isoDate(row.transaction_date),
      value_date: isoDate(row.value_date),
    }))),
  };
}

async function loadJournalEntriesCsv(client, companyId, manifestFilters = {}) {
  const filters = normalizeJournalQuery({
    format: "csv",
    fiscal_year_id: uuidOrNull(manifestFilters.fiscal_year_id),
    date_from: manifestFilters.date_from,
    date_to: manifestFilters.date_to,
    limit: 200,
  });
  const params = [companyId];
  const where = ["je.company_id=$1"];
  if (filters.fiscal_year_id) {
    params.push(filters.fiscal_year_id);
    where.push(`je.fiscal_year_id=$${params.length}`);
  }
  if (filters.date_from) {
    params.push(filters.date_from);
    where.push(`je.entry_date >= $${params.length}::date`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    where.push(`je.entry_date <= $${params.length}::date`);
  }
  params.push(filters.limit);
  const { rows } = await client.query(
    `SELECT je.entry_date, je.entry_number, fy.year_label, p.name AS period_name,
            je.description, je.status,
            COALESCE(SUM(jl.debit_amount), 0)::text AS total_debit,
            COALESCE(SUM(jl.credit_amount), 0)::text AS total_credit,
            COUNT(jl.id)::integer AS line_count
       FROM ${q("journal_entries")} je
       JOIN ${q("fiscal_years")} fy ON fy.id=je.fiscal_year_id
       JOIN ${q("accounting_periods")} p ON p.id=je.period_id
       LEFT JOIN ${q("journal_lines")} jl ON jl.journal_entry_id=je.id
      WHERE ${where.join(" AND ")}
      GROUP BY je.id, fy.year_label, p.name, p.status
      ORDER BY je.entry_date DESC, je.entry_number DESC NULLS FIRST, je.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return {
    name: "exports/diario.csv",
    row_count: rows.length,
    content: buildCsv([
      { key: "entry_date", label: "Fecha" },
      { key: "entry_number", label: "Numero" },
      { key: "year_label", label: "Ejercicio" },
      { key: "period_name", label: "Periodo" },
      { key: "description", label: "Concepto" },
      { key: "status_label", label: "Estado" },
      { key: "total_debit", label: "Debe" },
      { key: "total_credit", label: "Haber" },
      { key: "line_count", label: "Lineas" },
    ], rows.map(row => ({
      ...row,
      entry_date: isoDate(row.entry_date),
      entry_number: row.entry_number || "",
      status_label: row.status === "posted" ? "Contabilizado" : row.status === "cancelled" ? "Cancelado" : "Borrador",
    }))),
  };
}

async function assertPeriodInFiscalYear(client, companyId, periodId, fiscalYearId) {
  if (!periodId) return;
  const { rows } = await client.query(
    `SELECT id
       FROM ${q("accounting_periods")}
      WHERE id=$1 AND company_id=$2 AND fiscal_year_id=$3
      LIMIT 1`,
    [periodId, companyId, fiscalYearId]
  );
  if (!rows.length) {
    const error = new Error("period_id no pertenece al ejercicio y empresa seleccionados");
    error.status = 400;
    throw error;
  }
}

function reportFiltersOrNull(manifestFilters = {}, statement = false) {
  const fiscalYearId = uuidOrNull(manifestFilters.fiscal_year_id);
  if (!fiscalYearId) return null;
  const periodId = uuidOrNull(manifestFilters.period_id);
  const input = {
    fiscal_year_id: fiscalYearId,
    period_id: periodId,
    date_from: manifestFilters.date_from,
    date_to: manifestFilters.date_to,
    include_empty: manifestFilters.include_empty,
    format: "csv",
  };
  return statement ? normalizeFinancialStatementQuery(input) : normalizeTrialBalanceQuery(input);
}

async function loadTrialBalanceCsv(client, companyId, manifestFilters = {}) {
  const filters = reportFiltersOrNull(manifestFilters);
  if (!filters) return null;
  await assertPeriodInFiscalYear(client, companyId, filters.period_id, filters.fiscal_year_id);
  const params = [companyId, filters.fiscal_year_id];
  const joinFilters = ["je.id=jl.journal_entry_id", "je.status='posted'"];
  if (filters.period_id) {
    params.push(filters.period_id);
    joinFilters.push(`je.period_id=$${params.length}`);
  }
  if (filters.date_from) {
    params.push(filters.date_from);
    joinFilters.push(`je.entry_date >= $${params.length}::date`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    joinFilters.push(`je.entry_date <= $${params.length}::date`);
  }
  const having = filters.include_empty ? "" : "WHERE total_debit <> 0 OR total_credit <> 0";
  const { rows } = await client.query(
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
  const summaryUnits = summarizeTrialRows(rows);
  const data = [
    ...rows,
    {
      code: "TOTAL",
      name: "Totales",
      account_type: "",
      total_debit: unitsToDecimal(summaryUnits.total_debit),
      total_credit: unitsToDecimal(summaryUnits.total_credit),
      balance_debit: unitsToDecimal(summaryUnits.balance_debit),
      balance_credit: unitsToDecimal(summaryUnits.balance_credit),
    },
  ];
  return {
    name: "exports/sumas_y_saldos.csv",
    row_count: rows.length,
    content: buildCsv([
      { key: "code", label: "Cuenta" },
      { key: "name", label: "Nombre" },
      { key: "account_type", label: "Tipo" },
      { key: "total_debit", label: "Suma Debe" },
      { key: "total_credit", label: "Suma Haber" },
      { key: "balance_debit", label: "Saldo Deudor" },
      { key: "balance_credit", label: "Saldo Acreedor" },
    ], data),
  };
}

async function loadFinancialStatementRows(client, companyId, filters) {
  await assertPeriodInFiscalYear(client, companyId, filters.period_id, filters.fiscal_year_id);
  const params = [companyId, filters.fiscal_year_id];
  const joinFilters = ["je.id=jl.journal_entry_id", "je.status='posted'"];
  if (filters.period_id) {
    params.push(filters.period_id);
    joinFilters.push(`je.period_id=$${params.length}`);
  }
  if (filters.date_from) {
    params.push(filters.date_from);
    joinFilters.push(`je.entry_date >= $${params.length}::date`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    joinFilters.push(`je.entry_date <= $${params.length}::date`);
  }
  const { rows } = await client.query(
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
  return rows;
}

async function loadBalanceSheetCsv(client, companyId, manifestFilters = {}) {
  const filters = reportFiltersOrNull(manifestFilters, true);
  if (!filters) return null;
  const rows = await loadFinancialStatementRows(client, companyId, filters);
  const result = buildFinancialStatements(rows, { include_empty: filters.include_empty });
  const data = statementCsvRows(result.balance_sheet.sections, result.balance_sheet.totals, "balance_sheet");
  return {
    name: "exports/balance_situacion.csv",
    row_count: rows.length,
    content: buildCsv([
      { key: "section", label: "Seccion" },
      { key: "code", label: "Cuenta" },
      { key: "name", label: "Nombre" },
      { key: "amount", label: "Importe" },
    ], data),
  };
}

async function loadProfitLossCsv(client, companyId, manifestFilters = {}) {
  const filters = reportFiltersOrNull(manifestFilters, true);
  if (!filters) return null;
  const rows = await loadFinancialStatementRows(client, companyId, filters);
  const result = buildFinancialStatements(rows, { include_empty: filters.include_empty });
  const data = statementCsvRows(result.profit_loss.sections, result.profit_loss.totals, "profit_loss");
  return {
    name: "exports/perdidas_ganancias.csv",
    row_count: rows.length,
    content: buildCsv([
      { key: "section", label: "Seccion" },
      { key: "code", label: "Cuenta" },
      { key: "name", label: "Nombre" },
      { key: "amount", label: "Importe" },
    ], data),
  };
}

async function buildAdvisorPackageCsvFiles({ client, companyId, manifest }) {
  const loaders = [
    ["parties", () => loadPartiesCsv(client, companyId)],
    ["maturities", () => loadMaturitiesCsv(client, companyId)],
    ["bank_transactions", () => loadBankTransactionsCsv(client, companyId, manifest.filters)],
    ["journal_entries", () => loadJournalEntriesCsv(client, companyId, manifest.filters)],
    ["trial_balance", () => loadTrialBalanceCsv(client, companyId, manifest.filters)],
    ["balance_sheet", () => loadBalanceSheetCsv(client, companyId, manifest.filters)],
    ["profit_loss", () => loadProfitLossCsv(client, companyId, manifest.filters)],
  ];
  const files = [];
  const summary = [];
  for (const [exportId, loader] of loaders) {
    if (!isAvailable(manifest, exportId)) continue;
    const file = await loader();
    if (!file) continue;
    files.push({ name: file.name, content: file.content });
    summary.push({ export_id: exportId, filename: file.name, row_count: file.row_count });
  }
  return { files, summary };
}

module.exports = {
  buildAdvisorPackageCsvFiles,
};
