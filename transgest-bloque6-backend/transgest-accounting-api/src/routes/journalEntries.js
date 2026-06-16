require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const {
  assertBalancedJournal,
  journalDraftRequestHash,
  normalizeCancellationReason,
  normalizeIdempotencyKey,
  normalizeJournalDraftInput,
  normalizeJournalDraftUpdateInput,
  normalizeJournalReversalInput,
  normalizeJournalQuery,
} = require("../domain/journalEntries");
const { buildCsv } = require("../domain/csv");
const { enqueueOutboxEvent } = require("../services/outbox");

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

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

function compactFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

async function loadEntryWithLines(client, entryId, companyId) {
  const entry = await client.query(
    `SELECT je.*, fy.year_label, p.name AS period_name, p.status AS period_status,
            COALESCE(t.total_debit, 0)::text AS total_debit,
            COALESCE(t.total_credit, 0)::text AS total_credit,
            COALESCE(t.line_count, 0)::integer AS line_count
       FROM ${q("journal_entries")} je
       JOIN ${q("fiscal_years")} fy ON fy.id=je.fiscal_year_id
       JOIN ${q("accounting_periods")} p ON p.id=je.period_id
       LEFT JOIN (
         SELECT journal_entry_id, SUM(debit_amount) AS total_debit,
                SUM(credit_amount) AS total_credit, COUNT(*) AS line_count
           FROM ${q("journal_lines")}
          GROUP BY journal_entry_id
       ) t ON t.journal_entry_id=je.id
      WHERE je.id=$1 AND je.company_id=$2`,
    [entryId, companyId]
  );
  if (!entry.rows.length) throw httpError("Asiento no encontrado para la empresa seleccionada", 404);
  const lines = await client.query(
    `SELECT jl.id, jl.line_number, jl.account_id, a.code AS account_code, a.name AS account_name,
            jl.debit_amount::text, jl.credit_amount::text, jl.currency, jl.description
       FROM ${q("journal_lines")} jl
       JOIN ${q("accounts")} a ON a.id=jl.account_id
      WHERE jl.journal_entry_id=$1 AND jl.company_id=$2
      ORDER BY jl.line_number`,
    [entryId, companyId]
  );
  const sourceLinks = await client.query(
    `SELECT id, journal_line_id, source_system, source_type, source_id,
            source_line_id, source_event_id, document_url, payload_hash, created_at
       FROM ${q("source_links")}
      WHERE journal_entry_id=$1 AND company_id=$2
      ORDER BY created_at, id`,
    [entryId, companyId]
  );
  return { ...entry.rows[0], lines: lines.rows, source_links: sourceLinks.rows };
}

router.use(authenticate);

router.get("/journal-entries", requirePermission("journal.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const filters = normalizeJournalQuery(req.query);
    const params = [selected.company_id];
    const where = ["je.company_id=$1"];
    if (filters.fiscal_year_id) {
      params.push(filters.fiscal_year_id);
      where.push(`je.fiscal_year_id=$${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`je.status=$${params.length}`);
    }
    if (filters.date_from) {
      params.push(filters.date_from);
      where.push(`je.entry_date >= $${params.length}::date`);
    }
    if (filters.date_to) {
      params.push(filters.date_to);
      where.push(`je.entry_date <= $${params.length}::date`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(`(je.description ILIKE $${params.length} OR je.entry_number::text ILIKE $${params.length})`);
    }
    params.push(filters.limit);
    const { rows } = await db.transaction(async client => {
      const result = await client.query(
        `SELECT je.id, je.fiscal_year_id, fy.year_label, je.period_id, p.name AS period_name,
              p.status AS period_status, je.entry_number, je.entry_date, je.posting_date,
              je.description, je.status, je.entry_type, je.source_system, je.source_type,
              je.created_at, je.cancelled_at, je.cancel_reason,
              je.reversal_of_entry_id, je.reversed_by_entry_id, je.reversal_reason,
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
      if (filters.format === "csv") {
        await client.query(
          `INSERT INTO ${q("audit_log")}
             (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
           VALUES ($1,$2,'user',$3,'journal_entry.csv_exported','journal_entry',$4,$5,$6::jsonb)`,
          [
            selected.tenant_id,
            selected.company_id,
            req.accountingUser.id,
            selected.company_id,
            req.id || null,
            JSON.stringify({
              filters: compactFilters(filters),
              row_count: result.rows.length,
            }),
          ]
        );
      }
      return result;
    });
    if (filters.format === "csv") {
      const csv = buildCsv([
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
        entry_date: String(row.entry_date).slice(0, 10),
        entry_number: row.entry_number || "",
        status_label: row.status === "posted" ? "Contabilizado" : row.status === "cancelled" ? "Cancelado" : "Borrador",
      })));
      return sendCsv(res, "diario.csv", csv);
    }
    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.get("/journal-entries/:id", requirePermission("journal.read"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const entry = await db.transaction(client => loadEntryWithLines(client, req.params.id, selected.company_id));
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

router.post("/journal-entries/drafts", requirePermission("journal.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeJournalDraftInput(req.body);
    const requestHash = journalDraftRequestHash(input);

    const result = await db.transaction(async client => {
      const repeated = await client.query(
        `SELECT id, request_hash FROM ${q("journal_entries")} WHERE company_id=$1 AND idempotency_key=$2`,
        [selected.company_id, input.idempotency_key]
      );
      if (repeated.rows.length) {
        if (repeated.rows[0].request_hash !== requestHash) {
          throw httpError("idempotency_key ya utilizado con otro contenido", 409);
        }
        return { entry: await loadEntryWithLines(client, repeated.rows[0].id, selected.company_id), repeated: true };
      }

      const period = await client.query(
        `SELECT p.*, fy.year_label, fy.status AS fiscal_year_status
           FROM ${q("accounting_periods")} p
           JOIN ${q("fiscal_years")} fy ON fy.id=p.fiscal_year_id
          WHERE p.company_id=$1 AND p.fiscal_year_id=$2
            AND $3::date BETWEEN p.start_date AND p.end_date`,
        [selected.company_id, input.fiscal_year_id, input.entry_date]
      );
      if (!period.rows.length) throw httpError("No existe un periodo para la fecha y ejercicio seleccionados", 409);

      const accountIds = [...new Set(input.lines.map(line => line.account_id))];
      const accounts = await client.query(
        `SELECT id, code, name, is_active, is_postable
           FROM ${q("accounts")}
          WHERE company_id=$1 AND fiscal_year_id=$2 AND id=ANY($3::uuid[])`,
        [selected.company_id, input.fiscal_year_id, accountIds]
      );
      if (accounts.rows.length !== accountIds.length) {
        throw httpError("Una o mas cuentas no pertenecen al ejercicio y empresa seleccionados", 400);
      }
      const unusable = accounts.rows.find(account => !account.is_active || !account.is_postable);
      if (unusable) throw httpError(`La cuenta ${unusable.code} no esta activa o no admite movimientos`, 409);

      const inserted = await client.query(
        `INSERT INTO ${q("journal_entries")}
           (tenant_id, company_id, fiscal_year_id, period_id, entry_date, description,
            status, entry_type, source_system, source_type, idempotency_key,
            request_hash, trace_id, request_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'draft','manual','accounting','manual',$7,$8,$9,$10,$11)
         ON CONFLICT (company_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          input.fiscal_year_id,
          period.rows[0].id,
          input.entry_date,
          input.description,
          input.idempotency_key,
          requestHash,
          req.id || null,
          req.id || null,
          req.accountingUser.id,
        ]
      );
      if (!inserted.rows.length) {
        const concurrent = await client.query(
          `SELECT id, request_hash FROM ${q("journal_entries")} WHERE company_id=$1 AND idempotency_key=$2`,
          [selected.company_id, input.idempotency_key]
        );
        if (!concurrent.rows.length) throw httpError("No se pudo resolver la creacion idempotente del borrador", 409);
        if (concurrent.rows[0].request_hash !== requestHash) {
          throw httpError("idempotency_key ya utilizado con otro contenido", 409);
        }
        return {
          entry: await loadEntryWithLines(client, concurrent.rows[0].id, selected.company_id),
          repeated: true,
        };
      }
      const entry = inserted.rows[0];
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO ${q("journal_lines")}
             (tenant_id, company_id, journal_entry_id, line_number, account_id,
              debit_amount, credit_amount, currency, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'EUR',$8)`,
          [
            selected.tenant_id,
            selected.company_id,
            entry.id,
            line.line_number,
            line.account_id,
            line.side === "debit" ? line.amount : "0",
            line.side === "credit" ? line.amount : "0",
            line.description,
          ]
        );
      }

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'journal_entry.draft_created','journal_entry',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          entry.id,
          req.id || null,
          JSON.stringify({
            fiscal_year_id: entry.fiscal_year_id,
            period_id: entry.period_id,
            entry_date: entry.entry_date,
            line_count: input.lines.length,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingJournalEntryDraftCreated",
        aggregate_type: "journal_entry",
        aggregate_id: entry.id,
        payload: {
          journal_entry_id: entry.id,
          fiscal_year_id: entry.fiscal_year_id,
          period_id: entry.period_id,
          entry_date: entry.entry_date,
          line_count: input.lines.length,
        },
      });
      return { entry: await loadEntryWithLines(client, entry.id, selected.company_id), repeated: false };
    });

    res.status(result.repeated ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/journal-entries/:id/draft", requirePermission("journal.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });

    const result = await db.transaction(async client => {
      const current = await client.query(
        `SELECT je.*, fy.status AS fiscal_year_status
           FROM ${q("journal_entries")} je
           JOIN ${q("fiscal_years")} fy ON fy.id=je.fiscal_year_id
          WHERE je.id=$1 AND je.company_id=$2
          FOR UPDATE OF je, fy`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) throw httpError("Asiento no encontrado para la empresa seleccionada", 404);
      const entry = current.rows[0];
      if (entry.status === "posted") throw httpError("No se puede editar un asiento contabilizado", 409);
      if (entry.status === "cancelled") throw httpError("No se puede editar un borrador cancelado", 409);
      if (entry.fiscal_year_status !== "open") throw httpError("El ejercicio no esta abierto", 409);

      const input = normalizeJournalDraftUpdateInput(req.body, entry.fiscal_year_id, entry.idempotency_key);
      const requestHash = journalDraftRequestHash({
        fiscal_year_id: entry.fiscal_year_id,
        idempotency_key: entry.idempotency_key,
        ...input,
      });

      const period = await client.query(
        `SELECT p.*
           FROM ${q("accounting_periods")} p
          WHERE p.company_id=$1 AND p.fiscal_year_id=$2
            AND $3::date BETWEEN p.start_date AND p.end_date`,
        [selected.company_id, entry.fiscal_year_id, input.entry_date]
      );
      if (!period.rows.length) throw httpError("No existe un periodo para la fecha y ejercicio seleccionados", 409);
      if (period.rows[0].status !== "open") throw httpError(`El periodo ${period.rows[0].name} no esta abierto`, 409);

      const accountIds = [...new Set(input.lines.map(line => line.account_id))];
      const accounts = await client.query(
        `SELECT id, code, name, is_active, is_postable
           FROM ${q("accounts")}
          WHERE company_id=$1 AND fiscal_year_id=$2 AND id=ANY($3::uuid[])`,
        [selected.company_id, entry.fiscal_year_id, accountIds]
      );
      if (accounts.rows.length !== accountIds.length) {
        throw httpError("Una o mas cuentas no pertenecen al ejercicio y empresa seleccionados", 400);
      }
      const unusable = accounts.rows.find(account => !account.is_active || !account.is_postable);
      if (unusable) throw httpError(`La cuenta ${unusable.code} no esta activa o no admite movimientos`, 409);

      const updated = await client.query(
        `UPDATE ${q("journal_entries")}
            SET period_id=$1, entry_date=$2, description=$3, request_hash=$4,
                trace_id=$5, request_id=$6, updated_at=NOW()
          WHERE id=$7
          RETURNING *`,
        [
          period.rows[0].id,
          input.entry_date,
          input.description,
          requestHash,
          req.id || null,
          req.id || null,
          entry.id,
        ]
      );

      await client.query(
        `DELETE FROM ${q("journal_lines")}
          WHERE journal_entry_id=$1 AND company_id=$2`,
        [entry.id, selected.company_id]
      );
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO ${q("journal_lines")}
             (tenant_id, company_id, journal_entry_id, line_number, account_id,
              debit_amount, credit_amount, currency, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'EUR',$8)`,
          [
            selected.tenant_id,
            selected.company_id,
            entry.id,
            line.line_number,
            line.account_id,
            line.side === "debit" ? line.amount : "0",
            line.side === "credit" ? line.amount : "0",
            line.description,
          ]
        );
      }

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'journal_entry.draft_updated','journal_entry',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          entry.id,
          req.id || null,
          JSON.stringify({
            fiscal_year_id: updated.rows[0].fiscal_year_id,
            period_id: updated.rows[0].period_id,
            entry_date: updated.rows[0].entry_date,
            line_count: input.lines.length,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingJournalEntryDraftUpdated",
        aggregate_type: "journal_entry",
        aggregate_id: entry.id,
        payload: {
          journal_entry_id: entry.id,
          fiscal_year_id: updated.rows[0].fiscal_year_id,
          period_id: updated.rows[0].period_id,
          entry_date: updated.rows[0].entry_date,
          line_count: input.lines.length,
        },
      });

      return { entry: await loadEntryWithLines(client, entry.id, selected.company_id) };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/journal-entries/:id/reverse", requirePermission("journal.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const input = normalizeJournalReversalInput(req.body);

    const result = await db.transaction(async client => {
      const current = await client.query(
        `SELECT je.*, fy.status AS fiscal_year_status, fy.year_label
           FROM ${q("journal_entries")} je
           JOIN ${q("fiscal_years")} fy ON fy.id=je.fiscal_year_id
          WHERE je.id=$1 AND je.company_id=$2
          FOR UPDATE OF je, fy`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) throw httpError("Asiento no encontrado para la empresa seleccionada", 404);
      const original = current.rows[0];
      if (original.status !== "posted") throw httpError("Solo se puede revertir un asiento contabilizado", 409);
      if (original.entry_type === "reversal") throw httpError("No se permite revertir un asiento reverso desde este caso de uso", 409);
      if (original.reversed_by_entry_id) {
        return { entry: await loadEntryWithLines(client, original.reversed_by_entry_id, selected.company_id), repeated: true };
      }
      if (original.fiscal_year_status !== "open") throw httpError("El ejercicio no esta abierto", 409);

      const sourceLines = await client.query(
        `SELECT jl.*, a.code AS account_code, a.is_active, a.is_postable,
                a.company_id AS account_company_id, a.fiscal_year_id AS account_fiscal_year_id
           FROM ${q("journal_lines")} jl
           JOIN ${q("accounts")} a ON a.id=jl.account_id
          WHERE jl.journal_entry_id=$1 AND jl.company_id=$2
          ORDER BY jl.line_number
          FOR UPDATE OF a`,
        [original.id, selected.company_id]
      );
      const unusable = sourceLines.rows.find(line => (
        !line.is_active
        || !line.is_postable
        || line.account_company_id !== selected.company_id
        || line.account_fiscal_year_id !== original.fiscal_year_id
      ));
      if (unusable) throw httpError(`La cuenta ${unusable.account_code} no puede recibir movimientos`, 409);

      const period = await client.query(
        `SELECT p.*
           FROM ${q("accounting_periods")} p
          WHERE p.company_id=$1 AND p.fiscal_year_id=$2
            AND $3::date BETWEEN p.start_date AND p.end_date
          FOR UPDATE`,
        [selected.company_id, original.fiscal_year_id, input.entry_date]
      );
      if (!period.rows.length) throw httpError("No existe un periodo para la fecha de reverso seleccionada", 409);
      if (period.rows[0].status !== "open") throw httpError(`El periodo ${period.rows[0].name} no esta abierto`, 409);

      const description = `Reverso asiento ${original.entry_number}: ${input.reason}`;
      const reversalLines = sourceLines.rows.map((line, index) => {
        const debit = Number(line.debit_amount || 0);
        return {
          line_number: index + 1,
          account_id: line.account_id,
          side: debit > 0 ? "credit" : "debit",
          amount: debit > 0 ? String(line.debit_amount) : String(line.credit_amount),
          description: `Reverso linea ${line.line_number}`,
        };
      });
      const requestHash = journalDraftRequestHash({
        fiscal_year_id: original.fiscal_year_id,
        entry_date: input.entry_date,
        description,
        lines: reversalLines,
      });

      const repeated = await client.query(
        `SELECT id, request_hash FROM ${q("journal_entries")} WHERE company_id=$1 AND idempotency_key=$2`,
        [selected.company_id, input.idempotency_key]
      );
      if (repeated.rows.length) {
        if (repeated.rows[0].request_hash !== requestHash) {
          throw httpError("idempotency_key ya utilizado con otro contenido", 409);
        }
        return { entry: await loadEntryWithLines(client, repeated.rows[0].id, selected.company_id), repeated: true };
      }

      const inserted = await client.query(
        `INSERT INTO ${q("journal_entries")}
           (tenant_id, company_id, fiscal_year_id, period_id, entry_date, description,
            status, entry_type, source_system, source_type, source_id, idempotency_key,
            request_hash, trace_id, request_id, created_by, reversal_of_entry_id, reversal_reason)
         VALUES ($1,$2,$3,$4,$5,$6,'draft','reversal','accounting','journal_entry',$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          selected.tenant_id,
          selected.company_id,
          original.fiscal_year_id,
          period.rows[0].id,
          input.entry_date,
          description,
          original.id,
          input.idempotency_key,
          requestHash,
          req.id || null,
          req.id || null,
          req.accountingUser.id,
          original.id,
          input.reason,
        ]
      ).catch(error => {
        if (error.code === "23505") throw httpError("El asiento ya tiene un reverso asociado", 409);
        throw error;
      });
      const reversal = inserted.rows[0];

      for (const line of reversalLines) {
        await client.query(
          `INSERT INTO ${q("journal_lines")}
             (tenant_id, company_id, journal_entry_id, line_number, account_id,
              debit_amount, credit_amount, currency, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'EUR',$8)`,
          [
            selected.tenant_id,
            selected.company_id,
            reversal.id,
            line.line_number,
            line.account_id,
            line.side === "debit" ? line.amount : "0",
            line.side === "credit" ? line.amount : "0",
            line.description,
          ]
        );
      }

      await client.query(
        `INSERT INTO ${q("source_links")}
           (tenant_id, company_id, journal_entry_id, source_system, source_type, source_id)
         VALUES ($1,$2,$3,'accounting','journal_entry',$4)`,
        [selected.tenant_id, selected.company_id, reversal.id, original.id]
      );
      await client.query(
        `UPDATE ${q("journal_entries")}
            SET reversed_by_entry_id=$1, updated_at=NOW()
          WHERE id=$2`,
        [reversal.id, original.id]
      );
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'journal_entry.reversal_draft_created','journal_entry',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          reversal.id,
          req.id || null,
          JSON.stringify({
            reversal_of_entry_id: original.id,
            fiscal_year_id: reversal.fiscal_year_id,
            period_id: reversal.period_id,
            entry_date: reversal.entry_date,
            line_count: reversalLines.length,
            reason: input.reason,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingJournalEntryReversalDraftCreated",
        aggregate_type: "journal_entry",
        aggregate_id: reversal.id,
        payload: {
          journal_entry_id: reversal.id,
          reversal_of_entry_id: original.id,
          fiscal_year_id: reversal.fiscal_year_id,
          period_id: reversal.period_id,
          entry_date: reversal.entry_date,
          line_count: reversalLines.length,
          reason: input.reason,
        },
      });

      return { entry: await loadEntryWithLines(client, reversal.id, selected.company_id), repeated: false };
    });

    res.status(result.repeated ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/journal-entries/:id/post", requirePermission("journal.post"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const postIdempotencyKey = normalizeIdempotencyKey(req.body?.idempotency_key);

    const result = await db.transaction(async client => {
      const current = await client.query(
        `SELECT je.*, p.status AS period_status, p.name AS period_name,
                fy.year_label, fy.status AS fiscal_year_status
           FROM ${q("journal_entries")} je
           JOIN ${q("accounting_periods")} p ON p.id=je.period_id
           JOIN ${q("fiscal_years")} fy ON fy.id=je.fiscal_year_id
          WHERE je.id=$1 AND je.company_id=$2
          FOR UPDATE OF je, p, fy`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) throw httpError("Asiento no encontrado para la empresa seleccionada", 404);
      const entry = current.rows[0];
      if (entry.status === "posted") {
        if (entry.post_idempotency_key === postIdempotencyKey) {
          return { entry: await loadEntryWithLines(client, entry.id, selected.company_id), repeated: true };
        }
        throw httpError("El asiento ya esta contabilizado", 409);
      }
      if (entry.status === "cancelled") throw httpError("No se puede contabilizar un borrador cancelado", 409);
      if (entry.period_status !== "open") {
        throw httpError(`El periodo ${entry.period_name} no esta abierto`, 409);
      }
      if (entry.fiscal_year_status !== "open") throw httpError("El ejercicio no esta abierto", 409);

      const lines = await client.query(
        `SELECT jl.*, a.code AS account_code, a.is_active, a.is_postable,
                a.fiscal_year_id AS account_fiscal_year_id, a.company_id AS account_company_id
           FROM ${q("journal_lines")} jl
           JOIN ${q("accounts")} a ON a.id=jl.account_id
          WHERE jl.journal_entry_id=$1 AND jl.company_id=$2
          ORDER BY jl.line_number
          FOR UPDATE OF jl, a`,
        [entry.id, selected.company_id]
      );
      const unusable = lines.rows.find(line => (
        !line.is_active
        || !line.is_postable
        || line.account_fiscal_year_id !== entry.fiscal_year_id
        || line.account_company_id !== selected.company_id
      ));
      if (unusable) throw httpError(`La cuenta ${unusable.account_code} no puede recibir movimientos`, 409);
      const summary = assertBalancedJournal(lines.rows);

      const number = await client.query(
        `SELECT COALESCE(MAX(entry_number), 0) + 1 AS next_number
           FROM ${q("journal_entries")}
          WHERE company_id=$1 AND fiscal_year_id=$2 AND entry_number IS NOT NULL`,
        [selected.company_id, entry.fiscal_year_id]
      );
      const updated = await client.query(
        `UPDATE ${q("journal_entries")}
            SET status='posted', entry_number=$1, posting_date=NOW(),
                post_idempotency_key=$2, updated_at=NOW()
          WHERE id=$3
          RETURNING *`,
        [number.rows[0].next_number, postIdempotencyKey, entry.id]
      ).catch(error => {
        if (error.code === "23505") throw httpError("idempotency_key de contabilizacion ya utilizado", 409);
        throw error;
      });
      const posted = updated.rows[0];

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'journal_entry.posted','journal_entry',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          posted.id,
          req.id || null,
          JSON.stringify({
            fiscal_year_id: posted.fiscal_year_id,
            period_id: posted.period_id,
            entry_number: posted.entry_number,
            total_debit: summary.total_debit,
            total_credit: summary.total_credit,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingJournalEntryPosted",
        aggregate_type: "journal_entry",
        aggregate_id: posted.id,
        payload: {
          journal_entry_id: posted.id,
          fiscal_year_id: posted.fiscal_year_id,
          period_id: posted.period_id,
          entry_number: posted.entry_number,
          entry_date: posted.entry_date,
          total_debit: summary.total_debit,
          total_credit: summary.total_credit,
          line_count: lines.rows.length,
        },
      });
      return { entry: await loadEntryWithLines(client, posted.id, selected.company_id), repeated: false };
    });

    res.status(result.repeated ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/journal-entries/:id/cancel", requirePermission("journal.write"), async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const reason = normalizeCancellationReason(req.body?.reason);

    const result = await db.transaction(async client => {
      const current = await client.query(
        `SELECT je.*, p.name AS period_name
           FROM ${q("journal_entries")} je
           JOIN ${q("accounting_periods")} p ON p.id=je.period_id
          WHERE je.id=$1 AND je.company_id=$2
          FOR UPDATE OF je`,
        [req.params.id, selected.company_id]
      );
      if (!current.rows.length) throw httpError("Asiento no encontrado para la empresa seleccionada", 404);
      const entry = current.rows[0];
      if (entry.status === "posted") throw httpError("No se puede cancelar un asiento contabilizado", 409);
      if (entry.status === "cancelled") {
        return { entry: await loadEntryWithLines(client, entry.id, selected.company_id), repeated: true };
      }

      const updated = await client.query(
        `UPDATE ${q("journal_entries")}
            SET status='cancelled',
                cancelled_at=NOW(),
                cancelled_by=$1,
                cancel_reason=$2,
                updated_at=NOW()
          WHERE id=$3
          RETURNING *`,
        [req.accountingUser.id, reason, entry.id]
      );
      const cancelled = updated.rows[0];

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'journal_entry.draft_cancelled','journal_entry',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          cancelled.id,
          req.id || null,
          JSON.stringify({
            fiscal_year_id: cancelled.fiscal_year_id,
            period_id: cancelled.period_id,
            entry_date: cancelled.entry_date,
            reason,
          }),
        ]
      );
      await enqueueOutboxEvent(client, {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        event_type: "AccountingJournalEntryDraftCancelled",
        aggregate_type: "journal_entry",
        aggregate_id: cancelled.id,
        payload: {
          journal_entry_id: cancelled.id,
          fiscal_year_id: cancelled.fiscal_year_id,
          period_id: cancelled.period_id,
          reason,
        },
      });
      return { entry: await loadEntryWithLines(client, cancelled.id, selected.company_id), repeated: false };
    });

    res.status(result.repeated ? 200 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
