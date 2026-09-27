const crypto = require('crypto');
const { canonical } = require('./transportDocumentVersions');
const { fail } = require('./plannerInventory');
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const LAW = 'https://www.boe.es/buscar/act.php?id=BOE-A-2009-18004#a22';
const clean = (v, n = 1000) => String(v || '').trim().slice(0, n);

function calculate(input, now = new Date()) {
  const start = new Date(input.inicio), end = new Date(input.fin);
  if (![input.inicio, input.fin].every(v => typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)) ||
      !Number.isFinite(+start) || !Number.isFinite(+end) || end <= start || end > now || end - start > 31 * 86400000)
    throw fail('Indica inicio y fin reales con zona horaria, ya finalizados y con duración máxima de 31 días.');
  const day = start.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  if (day < '2023-01-01' || day > '2026-12-31') throw fail('No hay una tarifa IPREM verificada para esta fecha. Revisa el importe mediante la reclamación documentada.');
  // Consecutive 24-hour periods from contractual availability, not calendar midnights.
  // The allowance applies once. Elapsed milliseconds preserve DST duration.
  const minutes = (end - start) / 60000, rows = [];
  for (let offset = 0, dayNumber = 1; offset < minutes; offset += 1440, dayNumber++) {
    const elapsed = Math.min(1440, minutes - offset);
    const allowance = dayNumber === 1 ? 60 : 0;
    const hours = Math.min(10, Math.ceil(Math.max(0, elapsed - allowance) / 60));
    const rate = dayNumber === 1 ? 40 : dayNumber === 2 ? 50 : 60;
    rows.push({ dia: dayNumber, minutos: elapsed, franquicia_minutos: Math.min(allowance, elapsed), horas: hours, tarifa_hora: rate, importe: hours * rate });
  }
  const statutory = rows.reduce((n, r) => n + r.importe, 0);
  let total = statutory;
  if (input.importe_pactado !== '' && input.importe_pactado != null) {
    const value = Number(input.importe_pactado);
    if (!Number.isFinite(value) || value < statutory || value > 1e7 || !clean(input.acuerdo))
      throw fail('El importe pactado debe ser igual o superior a la referencia legal y requiere describir el acuerdo.');
    total = Math.round(value * 100) / 100;
  }
  return { version: 'ES-LCTTM22-IPREM20-20260927', inicio: start.toISOString(), fin: end.toISOString(), minutos: minutes,
    iprem_diario: 20, referencia_legal: statutory, importe: total, moneda: 'EUR', iva: null, filas: rows, fuente: LAW,
    criterio: 'Periodos consecutivos de 24 horas desde la puesta a disposición pactada; primera hora excluida una sola vez. Máximo 10 horas por periodo, fracciones al alza. Día 2: +25%; siguientes: +50%.',
    alcance: 'Carga/descarga nacional en España, por causas no imputables al porteador. Prefactura sin IVA, sin validez fiscal. La tributación de una factura definitiva requiere revisar la naturaleza de la operación.',
    acuerdo: clean(input.acuerdo) || 'Referencia del artículo 22 de la Ley 15/2009' };
}

const party = p => ({ nombre: clean(p?.razon_social || p?.nombre, 200), cif: clean(p?.cif || p?.nif, 40),
  direccion: clean([p?.direccion, p?.cp || p?.codigo_postal, p?.poblacion || p?.ciudad, p?.provincia].filter(Boolean).join(', '), 400),
  logo_base64: typeof p?.logo_base64 === 'string' && p.logo_base64.length < 1500000 ? p.logo_base64 : null });

async function prepare(db, company, actor, orderId, input) {
  if (!UUID.test(input.operacion || '')) throw fail('Falta identificador de operación.');
  const fingerprint = crypto.createHash('sha256').update(canonical({ pedido: orderId, ...input })).digest('hex');
  return db.transaction(async tx => {
    const p = (await tx.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id::text=$2 FOR UPDATE', [company, String(orderId)])).rows[0];
    if (!p) throw fail('Pedido no encontrado.', 404);
    const prior = (await tx.query('SELECT * FROM pedido_paralizacion_eventos WHERE empresa_id=$1 AND operacion=$2', [company, input.operacion])).rows[0];
    if (prior) {
      if (prior.huella !== fingerprint || prior.actor_id !== actor) throw fail('Operación utilizada con otros datos.', 409);
      return prior.datos.siguiente;
    }
    if (['cancelado','anulado'].includes(p.estado)) throw fail('El pedido está cancelado.', 409);
    if (input.no_imputable !== true || !['carga','descarga'].includes(input.tipo) || !clean(input.motivo))
      throw fail('Indica carga o descarga, motivo y confirma que la causa no es imputable al porteador.');
    const quote = calculate(input);
    if (quote.importe <= 0) throw fail('La duración está dentro de la primera hora excluida. No hay importe para prefacturar.');
    const overlap = (await tx.query("SELECT id FROM pedido_paralizaciones WHERE empresa_id=$1 AND pedido_id=$2 AND estado<>'rechazada' AND inicio<$4 AND fin>$3 LIMIT 1", [company, orderId, quote.inicio, quote.fin])).rows[0];
    if (overlap) throw fail('Ya hay una paralización en ese intervalo. Revisa la existente para evitar duplicados.', 409);
    const companyRow = (await tx.query('SELECT * FROM empresas WHERE id=$1', [company])).rows[0];
    const customer = (await tx.query('SELECT * FROM clientes WHERE empresa_id=$1 AND id=$2', [company, p.cliente_id])).rows[0];
    if (!customer) throw fail('Asigna un cliente de esta empresa al pedido antes de prefacturar.', 409);
    const id = crypto.randomUUID(), created = new Date().toISOString();
    const snapshot = { numero: `PF-PAR-${id}`, created_at: created, pedido_id: p.id, pedido_numero: p.numero,
      referencia_cliente: clean(p.referencia_cliente || p.referencia), origen: clean(p.origen, 400), destino: clean(p.destino, 400),
      empresa: party(companyRow), cliente: party(customer), tipo: input.tipo, motivo: clean(input.motivo), calculo: quote };
    const row = (await tx.query(`INSERT INTO pedido_paralizaciones(id,empresa_id,pedido_id,operacion,huella,estado,inicio,fin,minutos,documentado,aceptado,acuerdo,motivo,created_by,prefactura)
      VALUES($1,$2,$3,$4,$5,'preparada',$6,$7,$8,0,0,$9,$10,$11,$12) RETURNING *`,
      [id, company, orderId, input.operacion, fingerprint, quote.inicio, quote.fin, quote.minutos, quote.acuerdo, snapshot.motivo, actor, JSON.stringify(snapshot)])).rows[0];
    await tx.query('INSERT INTO pedido_paralizacion_eventos(empresa_id,reclamacion_id,operacion,huella,actor_id,datos) VALUES($1,$2,$3,$4,$5,$6)',
      [company, id, input.operacion, fingerprint, actor, JSON.stringify({ anterior: null, siguiente: row })]);
    return row;
  });
}

async function read(db, company, orderId, id) {
  const row = (await db.query('SELECT r.prefactura FROM pedido_paralizaciones r JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id WHERE r.empresa_id=$1 AND r.pedido_id::text=$2 AND r.id::text=$3', [company, String(orderId), String(id)])).rows[0];
  if (!row?.prefactura) throw fail('Prefactura no encontrada.', 404);
  return row.prefactura;
}
module.exports = { calculate, prepare, read };
