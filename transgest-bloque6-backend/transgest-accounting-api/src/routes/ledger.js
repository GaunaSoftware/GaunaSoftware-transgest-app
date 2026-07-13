require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const { buildCsv, buildFinancialStatements, normalizeFinancialStatementQuery, normalizeLedgerQuery, normalizeTrialBalanceQuery } = require("../domain/ledger");
const { buildModel347File } = require("../domain/aeat347");

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

// ── Liquidacion de IVA / Modelo 303 preliminar ──────────────────────────────
// Deriva el IVA de las cuentas del PGC: 477* (repercutido/devengado) y
// 472* (soportado/deducible). No sustituye el modelo oficial de la AEAT.
function detectVatRate(code, name) {
  const text = `${code || ""} ${name || ""}`;
  const pct = text.match(/(\d{1,2}(?:[.,]\d)?)\s*%/);
  if (pct) {
    const rate = Number(String(pct[1]).replace(",", "."));
    if (Number.isFinite(rate) && rate > 0 && rate <= 100) return rate;
  }
  return null;
}

function estimateBaseUnits(cuotaUnits, rate) {
  if (!rate || rate <= 0) return null;
  // base = cuota / (rate/100); cuotaUnits ya viene en micro-unidades.
  const absCuota = cuotaUnits < 0n ? -cuotaUnits : cuotaUnits;
  const baseAbs = (absCuota * 100n) / BigInt(Math.round(rate * 100)) * 100n;
  const base = cuotaUnits < 0n ? -baseAbs : baseAbs;
  return base;
}

router.get("/reports/vat-summary", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeFinancialStatementQuery(req.query);
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
      const result = await client.query(
        `SELECT a.code, a.name,
                COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_amount ELSE 0 END), 0)::text AS total_debit,
                COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_amount ELSE 0 END), 0)::text AS total_credit
           FROM ${q("accounts")} a
           LEFT JOIN ${q("journal_lines")} jl ON jl.account_id=a.id AND jl.company_id=a.company_id
           LEFT JOIN ${q("journal_entries")} je ON ${joinFilters.join(" AND ")}
          WHERE a.company_id=$1 AND a.fiscal_year_id=$2
            AND (a.code LIKE '472%' OR a.code LIKE '477%')
          GROUP BY a.id
          ORDER BY a.code`,
        params
      );
      if (filters.format === "csv") {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'ledger.vat_summary_csv_exported','vat_summary',$4,$5,$6::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            filters.fiscal_year_id,
            req.id || null,
            JSON.stringify({ fiscal_year_id: filters.fiscal_year_id, filters: compactFilters(filters), row_count: result.rows.length }),
          ]
        );
      }
      return result.rows;
    });

    const build = (row, sign) => {
      const debit = decimalToUnits(row.total_debit);
      const credit = decimalToUnits(row.total_credit);
      const cuotaUnits = sign === "repercutido" ? credit - debit : debit - credit;
      const rate = detectVatRate(row.code, row.name);
      const baseUnits = estimateBaseUnits(cuotaUnits, rate);
      return {
        code: row.code,
        name: row.name,
        rate,
        base: baseUnits === null ? null : unitsToDecimal(baseUnits),
        base_estimated: baseUnits !== null,
        cuota: unitsToDecimal(cuotaUnits),
        _cuotaUnits: cuotaUnits,
      };
    };

    const repercutidoRows = rows.filter(r => String(r.code).startsWith("477")).map(r => build(r, "repercutido"));
    const soportadoRows = rows.filter(r => String(r.code).startsWith("472")).map(r => build(r, "soportado"));
    const visible = list => list.filter(r => filters.include_empty || r._cuotaUnits !== 0n).map(({ _cuotaUnits, ...rest }) => rest);
    const sumCuota = list => list.reduce((acc, r) => acc + r._cuotaUnits, 0n);

    const devengadaUnits = sumCuota(repercutidoRows);
    const deducibleUnits = sumCuota(soportadoRows);
    const resultadoUnits = devengadaUnits - deducibleUnits;
    const sentido = resultadoUnits > 0n ? "a_ingresar" : resultadoUnits < 0n ? "a_compensar" : "neutro";

    const data = {
      repercutido: { rows: visible(repercutidoRows), total_cuota: unitsToDecimal(devengadaUnits) },
      soportado: { rows: visible(soportadoRows), total_cuota: unitsToDecimal(deducibleUnits) },
      liquidacion: {
        iva_devengado: unitsToDecimal(devengadaUnits),
        iva_deducible: unitsToDecimal(deducibleUnits),
        resultado: unitsToDecimal(resultadoUnits),
        sentido,
      },
      modelo_303: {
        casilla_27_cuota_devengada: unitsToDecimal(devengadaUnits),
        casilla_45_cuota_deducible: unitsToDecimal(deducibleUnits),
        casilla_71_resultado: unitsToDecimal(resultadoUnits),
      },
      note: "Liquidacion preliminar calculada desde cuentas 472/477 de asientos contabilizados. No sustituye el modelo 303 oficial de la AEAT ni la revision de un asesor.",
    };

    if (filters.format === "csv") {
      const csvRows = [
        ...data.repercutido.rows.map(r => ({ bloque: "IVA repercutido", code: r.code, name: r.name, rate: r.rate ?? "", base: r.base ?? "", cuota: r.cuota })),
        { bloque: "Total IVA devengado", code: "", name: "", rate: "", base: "", cuota: data.liquidacion.iva_devengado },
        ...data.soportado.rows.map(r => ({ bloque: "IVA soportado", code: r.code, name: r.name, rate: r.rate ?? "", base: r.base ?? "", cuota: r.cuota })),
        { bloque: "Total IVA deducible", code: "", name: "", rate: "", base: "", cuota: data.liquidacion.iva_deducible },
        { bloque: "Resultado liquidacion", code: "", name: "", rate: "", base: "", cuota: data.liquidacion.resultado },
      ];
      const csv = buildCsv([
        { key: "bloque", label: "Bloque" },
        { key: "code", label: "Cuenta" },
        { key: "name", label: "Nombre" },
        { key: "rate", label: "Tipo %" },
        { key: "base", label: "Base estimada" },
        { key: "cuota", label: "Cuota" },
      ], csvRows);
      return sendCsv(res, `liquidacion-iva-${filters.fiscal_year_id}.csv`, csv);
    }

    res.json({ data, filters });
  } catch (error) {
    next(error);
  }
});

// ── Libro Registro de IVA (detalle linea a linea) ───────────────────────────
// Lista los movimientos de las cuentas 472/477 de asientos contabilizados.
router.get("/reports/vat-book", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeFinancialStatementQuery(req.query);
    const rawType = String(req.query.type || "all").trim().toLowerCase();
    const type = ["repercutido", "soportado", "all"].includes(rawType) ? rawType : "all";

    const params = [selected.company_id, filters.fiscal_year_id];
    const where = ["jl.company_id=$1", "je.fiscal_year_id=$2", "je.status='posted'"];
    if (type === "repercutido") where.push("a.code LIKE '477%'");
    else if (type === "soportado") where.push("a.code LIKE '472%'");
    else where.push("(a.code LIKE '472%' OR a.code LIKE '477%')");
    if (filters.period_id) { params.push(filters.period_id); where.push(`je.period_id=$${params.length}`); }
    if (filters.date_from) { params.push(filters.date_from); where.push(`je.entry_date >= $${params.length}`); }
    if (filters.date_to) { params.push(filters.date_to); where.push(`je.entry_date <= $${params.length}`); }

    const rows = await db.transaction(async client => {
      await assertPeriodInFiscalYear(client, selected, filters.period_id, filters.fiscal_year_id);
      const result = await client.query(
        `SELECT je.entry_date, je.entry_number, je.description AS entry_description,
                a.code, a.name, jl.description AS line_description,
                jl.debit_amount::text AS debit, jl.credit_amount::text AS credit
           FROM ${q("journal_lines")} jl
           JOIN ${q("journal_entries")} je ON je.id=jl.journal_entry_id
           JOIN ${q("accounts")} a ON a.id=jl.account_id
          WHERE ${where.join(" AND ")}
          ORDER BY je.entry_date, je.entry_number, jl.line_number
          LIMIT 5000`,
        params
      );
      if (filters.format === "csv") {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'ledger.vat_book_csv_exported','vat_book',$4,$5,$6::jsonb)`,
          [selected.tenant_id, selected.company_id, req.accountingUser.id, filters.fiscal_year_id, req.id || null,
           JSON.stringify({ fiscal_year_id: filters.fiscal_year_id, filters: compactFilters(filters), type, row_count: result.rows.length })]
        );
      }
      return result.rows;
    });

    let devengadaUnits = 0n;
    let deducibleUnits = 0n;
    const mapped = rows.map(row => {
      const debit = decimalToUnits(row.debit);
      const credit = decimalToUnits(row.credit);
      const isRepercutido = String(row.code).startsWith("477");
      const cuotaUnits = isRepercutido ? credit - debit : debit - credit;
      if (isRepercutido) devengadaUnits += cuotaUnits; else deducibleUnits += cuotaUnits;
      return {
        entry_date: row.entry_date,
        entry_number: row.entry_number,
        tipo: isRepercutido ? "repercutido" : "soportado",
        code: row.code,
        name: row.name,
        concepto: row.line_description || row.entry_description || "",
        cuota: unitsToDecimal(cuotaUnits),
      };
    });

    const summary = {
      iva_devengado: unitsToDecimal(devengadaUnits),
      iva_deducible: unitsToDecimal(deducibleUnits),
      resultado: unitsToDecimal(devengadaUnits - deducibleUnits),
      row_count: mapped.length,
    };

    if (filters.format === "csv") {
      const csv = buildCsv([
        { key: "entry_date", label: "Fecha" },
        { key: "entry_number", label: "Asiento" },
        { key: "tipo", label: "Tipo" },
        { key: "code", label: "Cuenta" },
        { key: "name", label: "Nombre cuenta" },
        { key: "concepto", label: "Concepto" },
        { key: "cuota", label: "Cuota" },
      ], mapped);
      return sendCsv(res, `libro-iva-${filters.fiscal_year_id}.csv`, csv);
    }

    res.json({ data: mapped, summary, filters: { ...filters, type } });
  } catch (error) {
    next(error);
  }
});

// ── Modelo 347 preliminar (operaciones con terceros > 3.005,06 €) ───────────
// Derivado de los vencimientos (accounting_maturities) agrupados por tercero,
// direccion (ventas/compras) y trimestre. Aproximacion: el 347 oficial parte
// de facturas; aqui usamos los importes de cartera. No sustituye el modelo AEAT.
const MODELO_347_UMBRAL_UNITS = 3005060000n; // 3.005,06 € en micro-unidades

router.get("/reports/model-347", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeFinancialStatementQuery(req.query);

    const result = await db.transaction(async client => {
      const fy = await client.query(
        `SELECT year_label, start_date, end_date FROM ${q("fiscal_years")} WHERE id=$1 AND company_id=$2 LIMIT 1`,
        [filters.fiscal_year_id, selected.company_id]
      );
      if (!fy.rows.length) throw httpError("Ejercicio no encontrado para la empresa seleccionada", 404);
      const start = filters.date_from || String(fy.rows[0].start_date).slice(0, 10);
      const end = filters.date_to || String(fy.rows[0].end_date).slice(0, 10);

      const rows = await client.query(
        `SELECT p.id AS party_id, p.legal_name, p.tax_id, m.direction,
                EXTRACT(QUARTER FROM COALESCE(m.issue_date, m.due_date))::int AS quarter,
                SUM(m.amount)::text AS total
           FROM ${q("accounting_maturities")} m
           JOIN ${q("accounting_parties")} p ON p.id=m.party_id
          WHERE m.company_id=$1 AND m.status <> 'cancelled'
            AND COALESCE(m.issue_date, m.due_date) BETWEEN $2 AND $3
          GROUP BY p.id, p.legal_name, p.tax_id, m.direction, quarter`,
        [selected.company_id, start, end]
      );
      if (filters.format === "csv") {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'ledger.model_347_csv_exported','model_347',$4,$5,$6::jsonb)`,
          [selected.tenant_id, selected.company_id, req.accountingUser.id, filters.fiscal_year_id, req.id || null,
           JSON.stringify({ fiscal_year_id: filters.fiscal_year_id, start, end, row_count: rows.rows.length })]
        );
      }
      return { year_label: fy.rows[0].year_label, start, end, rows: rows.rows };
    });

    const byParty = new Map();
    for (const row of result.rows) {
      const key = `${row.party_id}|${row.direction}`;
      if (!byParty.has(key)) {
        byParty.set(key, { party_name: row.legal_name, tax_id: row.tax_id || "", direction: row.direction, q: [0n, 0n, 0n, 0n], totalUnits: 0n });
      }
      const entry = byParty.get(key);
      const units = decimalToUnits(row.total);
      const qIdx = Math.min(Math.max(Number(row.quarter) || 1, 1), 4) - 1;
      entry.q[qIdx] += units;
      entry.totalUnits += units;
    }

    const toRow = entry => ({
      party_name: entry.party_name,
      tax_id: entry.tax_id,
      q1: unitsToDecimal(entry.q[0]),
      q2: unitsToDecimal(entry.q[1]),
      q3: unitsToDecimal(entry.q[2]),
      q4: unitsToDecimal(entry.q[3]),
      total: unitsToDecimal(entry.totalUnits),
    });
    const declarables = [...byParty.values()].filter(e => e.totalUnits > MODELO_347_UMBRAL_UNITS);
    const ventas = declarables.filter(e => e.direction === "receivable").sort((a, b) => a.party_name.localeCompare(b.party_name));
    const compras = declarables.filter(e => e.direction === "payable").sort((a, b) => a.party_name.localeCompare(b.party_name));
    const sum = list => unitsToDecimal(list.reduce((acc, e) => acc + e.totalUnits, 0n));

    const data = {
      year_label: result.year_label,
      umbral: "3005.06",
      ventas: { rows: ventas.map(toRow), total: sum(ventas), count: ventas.length },
      compras: { rows: compras.map(toRow), total: sum(compras), count: compras.length },
      note: "Modelo 347 preliminar derivado de la cartera de vencimientos (no de facturas). No sustituye el modelo 347 oficial de la AEAT.",
    };

    if (filters.format === "csv") {
      const csvRows = [
        ...data.ventas.rows.map(r => ({ bloque: "Ventas/ingresos", ...r })),
        ...data.compras.rows.map(r => ({ bloque: "Compras/gastos", ...r })),
      ];
      const csv = buildCsv([
        { key: "bloque", label: "Bloque" },
        { key: "party_name", label: "Tercero" },
        { key: "tax_id", label: "NIF/CIF" },
        { key: "q1", label: "1T" },
        { key: "q2", label: "2T" },
        { key: "q3", label: "3T" },
        { key: "q4", label: "4T" },
        { key: "total", label: "Total anual" },
      ], csvRows);
      return sendCsv(res, `modelo-347-${filters.fiscal_year_id}.csv`, csv);
    }

    res.json({ data, filters });
  } catch (error) {
    next(error);
  }
});

// ── Libro registro de IVA por factura (desde la facturacion del TMS) ────────
// Lee accounting_vat_entries (base, tipo, cuota y tercero por factura),
// alimentado por /invoices/ingest. Es el libro de IVA "real" (no derivado de
// saldos de cuentas). Si no hay facturas ingeridas, devuelve lista vacia.
router.get("/reports/vat-ledger", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeFinancialStatementQuery(req.query);
    const rawType = String(req.query.type || "all").trim().toLowerCase();
    const type = ["repercutido", "soportado", "all"].includes(rawType) ? rawType : "all";

    const result = await db.transaction(async client => {
      const fy = await client.query(
        `SELECT start_date, end_date FROM ${q("fiscal_years")} WHERE id=$1 AND company_id=$2 LIMIT 1`,
        [filters.fiscal_year_id, selected.company_id]
      );
      if (!fy.rows.length) throw httpError("Ejercicio no encontrado para la empresa seleccionada", 404);
      const start = filters.date_from || String(fy.rows[0].start_date).slice(0, 10);
      const end = filters.date_to || String(fy.rows[0].end_date).slice(0, 10);

      const params = [selected.company_id, start, end];
      let typeFilter = "";
      if (type !== "all") { params.push(type); typeFilter = `AND direction=$${params.length}`; }
      const rows = await client.query(
        `SELECT entry_date, direction, party_tax_id, party_name, invoice_number,
                base::text, iva_rate::text, iva_amount::text, irpf_amount::text, total::text
           FROM ${q("accounting_vat_entries")}
          WHERE company_id=$1 AND entry_date BETWEEN $2 AND $3 ${typeFilter}
          ORDER BY entry_date ASC, invoice_number ASC
          LIMIT 5000`,
        params
      );
      if (filters.format === "csv") {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'ledger.vat_ledger_csv_exported','vat_ledger',$4,$5,$6::jsonb)`,
          [selected.tenant_id, selected.company_id, req.accountingUser.id, filters.fiscal_year_id, req.id || null,
           JSON.stringify({ start, end, type, row_count: rows.rows.length })]
        );
      }
      return rows.rows;
    });

    let baseDevengada = 0n, ivaDevengada = 0n, baseDeducible = 0n, ivaDeducible = 0n;
    const mapped = result.map(row => {
      const baseUnits = decimalToUnits(row.base);
      const ivaUnits = decimalToUnits(row.iva_amount);
      if (row.direction === "repercutido") { baseDevengada += baseUnits; ivaDevengada += ivaUnits; }
      else { baseDeducible += baseUnits; ivaDeducible += ivaUnits; }
      return {
        entry_date: row.entry_date,
        tipo: row.direction,
        party_tax_id: row.party_tax_id || "",
        party_name: row.party_name || "",
        invoice_number: row.invoice_number || "",
        base: row.base,
        iva_rate: row.iva_rate,
        iva_amount: row.iva_amount,
        total: row.total,
      };
    });

    const summary = {
      repercutido: { base: unitsToDecimal(baseDevengada), cuota: unitsToDecimal(ivaDevengada) },
      soportado: { base: unitsToDecimal(baseDeducible), cuota: unitsToDecimal(ivaDeducible) },
      resultado: unitsToDecimal(ivaDevengada - ivaDeducible),
      row_count: mapped.length,
    };

    if (filters.format === "csv") {
      const csv = buildCsv([
        { key: "entry_date", label: "Fecha" },
        { key: "tipo", label: "Tipo" },
        { key: "party_tax_id", label: "NIF tercero" },
        { key: "party_name", label: "Tercero" },
        { key: "invoice_number", label: "Factura" },
        { key: "base", label: "Base" },
        { key: "iva_rate", label: "Tipo IVA %" },
        { key: "iva_amount", label: "Cuota IVA" },
        { key: "total", label: "Total" },
      ], mapped);
      return sendCsv(res, `libro-iva-facturas-${filters.fiscal_year_id}.csv`, csv);
    }

    res.json({ data: mapped, summary, filters: { ...filters, type } });
  } catch (error) {
    next(error);
  }
});

// ── Modelo 347: fichero oficial AEAT (diseño de registro) ───────────────────
router.get("/reports/model-347/file", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeFinancialStatementQuery(req.query);

    const built = await db.transaction(async client => {
      const fy = await client.query(
        `SELECT year_label, start_date, end_date FROM ${q("fiscal_years")} WHERE id=$1 AND company_id=$2 LIMIT 1`,
        [filters.fiscal_year_id, selected.company_id]
      );
      if (!fy.rows.length) throw httpError("Ejercicio no encontrado para la empresa seleccionada", 404);
      const ejercicio = String(fy.rows[0].year_label).replace(/[^0-9]/g, "").slice(0, 4) || String(new Date(fy.rows[0].start_date).getFullYear());
      const start = filters.date_from || String(fy.rows[0].start_date).slice(0, 10);
      const end = filters.date_to || String(fy.rows[0].end_date).slice(0, 10);

      const company = await client.query(
        `SELECT legal_name, tax_id FROM ${q("accounting_companies")} WHERE id=$1 LIMIT 1`,
        [selected.company_id]
      );
      if (!company.rows[0]?.tax_id) throw httpError("La empresa declarante no tiene NIF configurado", 422);

      const rows = await client.query(
        `SELECT p.id AS party_id, p.legal_name, p.tax_id, p.province_code, m.direction,
                EXTRACT(QUARTER FROM COALESCE(m.issue_date, m.due_date))::int AS quarter,
                SUM(m.amount)::text AS total
           FROM ${q("accounting_maturities")} m
           JOIN ${q("accounting_parties")} p ON p.id=m.party_id
          WHERE m.company_id=$1 AND m.status <> 'cancelled'
            AND COALESCE(m.issue_date, m.due_date) BETWEEN $2 AND $3
          GROUP BY p.id, p.legal_name, p.tax_id, p.province_code, m.direction, quarter`,
        [selected.company_id, start, end]
      );

      const byKey = new Map();
      for (const row of rows.rows) {
        if (!row.tax_id) continue; // sin NIF no se puede declarar
        const key = `${row.party_id}|${row.direction}`;
        if (!byKey.has(key)) {
          byKey.set(key, { nif: row.tax_id, nombre: row.legal_name, provincia: row.province_code || "", clave: row.direction === "receivable" ? "B" : "A", totalCents: 0, quartersCents: [0, 0, 0, 0] });
        }
        const entry = byKey.get(key);
        const [w, f = ""] = String(row.total).split(".");
        const cents = (Number(w || "0") * 100) + Number((f + "00").slice(0, 2));
        const qi = Math.min(Math.max(Number(row.quarter) || 1, 1), 4) - 1;
        entry.quartersCents[qi] += cents;
        entry.totalCents += cents;
      }

      const file = buildModel347File({
        ejercicio,
        declarante: { nif: company.rows[0].tax_id, nombre: company.rows[0].legal_name, telefono: "", contacto: company.rows[0].legal_name },
        records: [...byKey.values()],
      });

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'ledger.model_347_file_generated','model_347',$4,$5,$6::jsonb)`,
        [selected.tenant_id, selected.company_id, req.accountingUser.id, filters.fiscal_year_id, req.id || null,
         JSON.stringify({ ejercicio, num_declarados: file.numDeclarados, id_declaracion: file.idDeclaracion })]
      );
      return { ejercicio, ...file };
    });

    res.setHeader("Content-Type", "text/plain; charset=iso-8859-1");
    res.setHeader("Content-Disposition", `attachment; filename="347_${built.ejercicio}.txt"`);
    res.send(Buffer.from(built.content, "latin1"));
  } catch (error) {
    next(error);
  }
});

// ── Modelos fiscales preliminares (111, 115, 130, 390) ──────────────────────
// Derivados de saldos de cuentas de asientos contabilizados. Preliminares:
// no sustituyen los modelos oficiales de la AEAT.
router.get("/reports/tax-models", requirePermission("ledger.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeFinancialStatementQuery(req.query);
    const params = [selected.company_id, filters.fiscal_year_id];
    const joinFilters = ["je.id=jl.journal_entry_id", "je.status='posted'"];
    if (filters.period_id) { params.push(filters.period_id); joinFilters.push(`je.period_id=$${params.length}`); }
    if (filters.date_from) { params.push(filters.date_from); joinFilters.push(`je.entry_date >= $${params.length}`); }
    if (filters.date_to) { params.push(filters.date_to); joinFilters.push(`je.entry_date <= $${params.length}`); }

    const rows = await db.transaction(async client => {
      await assertPeriodInFiscalYear(client, selected, filters.period_id, filters.fiscal_year_id);
      const result = await client.query(
        `SELECT a.code, a.account_type,
                COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_amount ELSE 0 END), 0)::text AS total_debit,
                COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_amount ELSE 0 END), 0)::text AS total_credit
           FROM ${q("accounts")} a
           LEFT JOIN ${q("journal_lines")} jl ON jl.account_id=a.id AND jl.company_id=a.company_id
           LEFT JOIN ${q("journal_entries")} je ON ${joinFilters.join(" AND ")}
          WHERE a.company_id=$1 AND a.fiscal_year_id=$2
            AND (a.account_type IN ('income','expense')
                 OR a.code LIKE '472%' OR a.code LIKE '477%' OR a.code LIKE '475%')
          GROUP BY a.id`,
        params
      );
      if (filters.format === "csv") {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'ledger.tax_models_csv_exported','tax_models',$4,$5,$6::jsonb)`,
          [selected.tenant_id, selected.company_id, req.accountingUser.id, filters.fiscal_year_id, req.id || null,
           JSON.stringify({ fiscal_year_id: filters.fiscal_year_id, filters: compactFilters(filters) })]
        );
      }
      return result.rows;
    });

    let incomeUnits = 0n, expenseUnits = 0n, devengadaUnits = 0n, deducibleUnits = 0n, ret111Units = 0n, ret115Units = 0n;
    for (const row of rows) {
      const debit = decimalToUnits(row.total_debit);
      const credit = decimalToUnits(row.total_credit);
      const code = String(row.code);
      if (row.account_type === "income") incomeUnits += credit - debit;
      else if (row.account_type === "expense") expenseUnits += debit - credit;
      if (code.startsWith("477")) devengadaUnits += credit - debit;
      else if (code.startsWith("472")) deducibleUnits += debit - credit;
      if (code.startsWith("4751")) ret111Units += credit - debit;
      else if (code.startsWith("4752")) ret115Units += credit - debit;
    }
    const resultadoUnits = incomeUnits - expenseUnits;
    const pagoFraccUnits = resultadoUnits > 0n ? (resultadoUnits * 20n) / 100n : 0n;
    const ivaResultUnits = devengadaUnits - deducibleUnits;

    const data = {
      modelo_390: {
        iva_devengado: unitsToDecimal(devengadaUnits),
        iva_deducible: unitsToDecimal(deducibleUnits),
        resultado: unitsToDecimal(ivaResultUnits),
      },
      modelo_130: {
        ingresos: unitsToDecimal(incomeUnits),
        gastos: unitsToDecimal(expenseUnits),
        rendimiento: unitsToDecimal(resultadoUnits),
        pago_fraccionado_estimado: unitsToDecimal(pagoFraccUnits),
      },
      modelo_111: { retenciones: unitsToDecimal(ret111Units) },
      modelo_115: { retenciones: unitsToDecimal(ret115Units) },
      note: "Modelos preliminares derivados de saldos de cuentas (7/6, 477/472, 4751/4752). No sustituyen los modelos oficiales de la AEAT. El 390 refleja el IVA del rango seleccionado (usar el ejercicio completo).",
    };

    if (filters.format === "csv") {
      const csvRows = [
        { modelo: "111 Retenciones trabajo/profesionales", concepto: "Retenciones practicadas (4751)", importe: data.modelo_111.retenciones },
        { modelo: "115 Retenciones alquileres", concepto: "Retenciones practicadas (4752)", importe: data.modelo_115.retenciones },
        { modelo: "130 Pago fraccionado IRPF", concepto: "Rendimiento (ingresos - gastos)", importe: data.modelo_130.rendimiento },
        { modelo: "130 Pago fraccionado IRPF", concepto: "Pago fraccionado estimado (20%)", importe: data.modelo_130.pago_fraccionado_estimado },
        { modelo: "390 Resumen anual IVA", concepto: "IVA devengado", importe: data.modelo_390.iva_devengado },
        { modelo: "390 Resumen anual IVA", concepto: "IVA deducible", importe: data.modelo_390.iva_deducible },
        { modelo: "390 Resumen anual IVA", concepto: "Resultado", importe: data.modelo_390.resultado },
      ];
      const csv = buildCsv([
        { key: "modelo", label: "Modelo" },
        { key: "concepto", label: "Concepto" },
        { key: "importe", label: "Importe" },
      ], csvRows);
      return sendCsv(res, `modelos-fiscales-${filters.fiscal_year_id}.csv`, csv);
    }

    res.json({ data, filters });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
