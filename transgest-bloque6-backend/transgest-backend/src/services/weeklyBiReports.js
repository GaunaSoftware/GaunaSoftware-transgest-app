const db = require('./db');
const logger = require('./logger');
const { periodRange } = require('./financialKpis');
const { planHasFeature, normalizePermissionsForRole } = require('../middleware/auth');
const companyProducts = require('./companyProducts');
const reports = require('./biReportCenter');
const { buildPdf } = require('./biReportExport');
const { enviarEmail } = require('./email');

const MAIL_HOUR = 9;
let timer;

function madridClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { monday: parts.weekday === 'Mon', hour: Number(parts.hour), minute: Number(parts.minute) };
}

function weeklyPeriod(now = new Date()) {
  return periodRange('semana_anterior', now);
}

function managerCanReceive(row) {
  if (row.rol !== 'gerente' || row.activo === false || !row.email || !planHasFeature(row.plan, 'kpis_avanzados')) return false;
  if (!['activo', 'activa'].includes(String(row.empresa_estado || '').toLowerCase())) return false;
  return normalizePermissionsForRole(row.permisos, row.rol).modulos.informes?.ver !== false;
}

async function processRecipient(row, period, deps = {}) {
  const query = deps.query || db.query;
  const generate = deps.generate || reports.runReport;
  const renderPdf = deps.renderPdf || buildPdf;
  const send = deps.send || enviarEmail;
  const claimed = await query(`INSERT INTO bi_weekly_deliveries (empresa_id,user_id,week_start,status)
    VALUES ($1,$2,$3,'preparando') ON CONFLICT (empresa_id,user_id,week_start) DO NOTHING RETURNING id`,
    [row.empresa_id, row.user_id, period.desde]);
  const id = claimed.rows[0]?.id;
  if (!id) return { status: 'ya_registrado' };
  let sending = false;
  try {
    const run = await generate(row.empresa_id, row.user_id, {
      template: 'vehiculo', periodo: 'personalizado', desde: period.desde, hasta: period.hasta,
    });
    const stored = await query(`SELECT snapshot FROM bi_report_runs WHERE id=$1 AND empresa_id=$2 AND owner_id=$3`,
      [run.id, row.empresa_id, row.user_id]);
    if (!stored.rows[0]) throw new Error('No se pudo recuperar la ejecución privada del informe');
    const pdf = await renderPdf(stored.rows[0].snapshot);
    if (pdf.length > 10 * 1024 * 1024) throw new Error('PDF superior a 10 MB; revisa el periodo o el volumen de detalle');
    const ready = await query(`UPDATE bi_weekly_deliveries SET status='enviando',run_id=$2,updated_at=now()
      WHERE id=$1 AND empresa_id=$3 AND user_id=$4 AND status='preparando' RETURNING id`,
      [id, run.id, row.empresa_id, row.user_id]);
    if (!ready.rows.length) throw new Error('La preparación del envío ya no está disponible');
    sending = true;
    const result = await send({
      trigger: 'bi_rentabilidad_semanal', plantilla: 'bi_rentabilidad_semanal', destinatario: row.email,
      empresa_id: row.empresa_id,
      datos: { empresa: row.empresa_nombre, desde: period.desde, hasta: period.hasta },
      attachments: [{ filename: `transgest-rentabilidad-${period.desde}.pdf`, content: pdf, contentType: 'application/pdf' }],
      meta: { week_start: period.desde, run_id: run.id },
    });
    const status = result?.simulado ? 'sin_smtp' : 'enviado';
    await query(`UPDATE bi_weekly_deliveries SET status=$2,message_id=$3,
      error=$4,updated_at=now() WHERE id=$1`,
      [id, status, result?.messageId || null, result?.simulado ? 'SMTP no configurado; no se envió el PDF' : null]);
    return { status, runId: run.id };
  } catch (error) {
    // Once handed to SMTP a timeout may mean that the mail was delivered.
    // Never retry an ambiguous attempt automatically.
    await query(`UPDATE bi_weekly_deliveries SET status=$2,error=$3,updated_at=now() WHERE id=$1`,
      [id, sending ? 'por_verificar' : 'fallido', String(error.message || error).slice(0,500)]).catch(() => {});
    logger.warn(`[BI semanal] Envío ${id}: ${sending ? 'por verificar' : 'fallido'}`);
    return { status: sending ? 'por_verificar' : 'fallido' };
  }
}

async function tick(now = new Date(), deps = {}) {
  const clock = madridClock(now);
  if (!clock.monday || clock.hour < MAIL_HOUR) return { skipped: 'fuera_de_horario' };
  const query = deps.query || db.query;
  const rows = await query(`SELECT s.empresa_id,s.user_id,u.email,u.rol,u.activo,u.permisos,
      e.nombre AS empresa_nombre,e.plan,e.estado AS empresa_estado
    FROM bi_weekly_subscriptions s JOIN usuarios u ON u.id=s.user_id AND u.empresa_id=s.empresa_id
      JOIN empresas e ON e.id=s.empresa_id
    WHERE s.enabled=true ORDER BY s.empresa_id,s.user_id`);
  const period = weeklyPeriod(now);
  const results = [];
  for (const row of rows.rows) {
    if (!managerCanReceive(row)) continue;
    const products = await (deps.products || companyProducts.get)(row.empresa_id);
    if (!products.productos.includes('transgest')) continue;
    results.push(await processRecipient(row, period, deps));
  }
  return { checked: rows.rows.length, results };
}

function startScheduler() {
  if (timer) return;
  const run = () => tick().catch(error => logger.error(`[BI semanal] Scheduler: ${error.message}`));
  timer = setInterval(run, 15 * 60 * 1000);
  timer.unref?.();
  setTimeout(run, 20 * 1000).unref?.();
  logger.info('[BI semanal] Programación activa los lunes desde las 09:00 Europe/Madrid');
}

module.exports = { madridClock, weeklyPeriod, managerCanReceive, processRecipient, tick, startScheduler };
