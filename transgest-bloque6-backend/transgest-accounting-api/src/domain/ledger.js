const { buildCsv } = require("./csv");

function inputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeOptionalUuid(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(normalized)) throw inputError(`${field} no es valido`);
  return normalized;
}

function normalizeDate(value, field) {
  const date = String(value || "").trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw inputError(`${field} debe usar formato YYYY-MM-DD`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw inputError(`${field} debe ser una fecha valida`);
  }
  return date;
}

function normalizeExportFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized !== "csv") throw inputError("format solo admite csv");
  return normalized;
}

function normalizeLedgerQuery(query = {}) {
  const from = normalizeDate(query.date_from, "date_from");
  const to = normalizeDate(query.date_to, "date_to");
  if (from && to && from > to) throw inputError("date_from no puede ser posterior a date_to");
  const rawLimit = Number.parseInt(query.limit, 10);
  return {
    period_id: normalizeOptionalUuid(query.period_id, "period_id"),
    date_from: from,
    date_to: to,
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200,
    format: normalizeExportFormat(query.format),
  };
}

function normalizeTrialBalanceQuery(query = {}) {
  const fiscalYearId = normalizeOptionalUuid(query.fiscal_year_id, "fiscal_year_id");
  if (!fiscalYearId) throw inputError("fiscal_year_id es obligatorio");
  const from = normalizeDate(query.date_from, "date_from");
  const to = normalizeDate(query.date_to, "date_to");
  if (from && to && from > to) throw inputError("date_from no puede ser posterior a date_to");
  const includeEmpty = String(query.include_empty ?? "true").trim().toLowerCase();
  if (!["true", "false", "1", "0"].includes(includeEmpty)) throw inputError("include_empty debe ser true o false");
  return {
    fiscal_year_id: fiscalYearId,
    period_id: normalizeOptionalUuid(query.period_id, "period_id"),
    date_from: from,
    date_to: to,
    include_empty: includeEmpty === "true" || includeEmpty === "1",
    format: normalizeExportFormat(query.format),
  };
}

function normalizeFinancialStatementQuery(query = {}) {
  return normalizeTrialBalanceQuery({
    ...query,
    include_empty: query.include_empty ?? "false",
  });
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

function statementAmount(row) {
  const debit = decimalToUnits(row.total_debit);
  const credit = decimalToUnits(row.total_credit);
  if (row.account_type === "asset" || row.account_type === "expense") return debit - credit;
  if (row.account_type === "liability" || row.account_type === "equity" || row.account_type === "income") return credit - debit;
  return debit - credit;
}

function mapStatementRow(row) {
  const amount = statementAmount(row);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    account_type: row.account_type,
    amount: unitsToDecimal(amount),
    total_debit: String(row.total_debit || "0"),
    total_credit: String(row.total_credit || "0"),
  };
}

function includeStatementRow(row, includeEmpty) {
  return includeEmpty || statementAmount(row) !== 0n;
}

function sumAmounts(rows) {
  return rows.reduce((total, row) => total + decimalToUnits(row.amount), 0n);
}

function buildFinancialStatements(rows = [], options = {}) {
  const includeEmpty = Boolean(options.include_empty);
  const assets = rows.filter(row => row.account_type === "asset" && includeStatementRow(row, includeEmpty)).map(mapStatementRow);
  const liabilities = rows.filter(row => row.account_type === "liability" && includeStatementRow(row, includeEmpty)).map(mapStatementRow);
  const equity = rows.filter(row => row.account_type === "equity" && includeStatementRow(row, includeEmpty)).map(mapStatementRow);
  const income = rows.filter(row => row.account_type === "income" && includeStatementRow(row, includeEmpty)).map(mapStatementRow);
  const expenses = rows.filter(row => row.account_type === "expense" && includeStatementRow(row, includeEmpty)).map(mapStatementRow);

  const totalAssets = sumAmounts(assets);
  const totalLiabilities = sumAmounts(liabilities);
  const totalEquity = sumAmounts(equity);
  const totalIncome = sumAmounts(income);
  const totalExpenses = sumAmounts(expenses);

  return {
    balance_sheet: {
      sections: { assets, liabilities, equity },
      totals: {
        assets: unitsToDecimal(totalAssets),
        liabilities: unitsToDecimal(totalLiabilities),
        equity: unitsToDecimal(totalEquity),
        liabilities_equity: unitsToDecimal(totalLiabilities + totalEquity),
        difference: unitsToDecimal(totalAssets - totalLiabilities - totalEquity),
      },
      note: "Informe tecnico preliminar calculado desde asientos contabilizados; no sustituye revision contable externa.",
    },
    profit_loss: {
      sections: { income, expenses },
      totals: {
        income: unitsToDecimal(totalIncome),
        expenses: unitsToDecimal(totalExpenses),
        result: unitsToDecimal(totalIncome - totalExpenses),
      },
      note: "Informe tecnico preliminar calculado desde asientos contabilizados; no sustituye revision contable externa.",
    },
  };
}

module.exports = {
  buildFinancialStatements,
  buildCsv,
  normalizeFinancialStatementQuery,
  normalizeLedgerQuery,
  normalizeTrialBalanceQuery,
};
