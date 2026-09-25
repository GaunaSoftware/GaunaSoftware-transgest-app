const db = require('./db');

const CAUSES = Object.freeze({
  carga_sin_finalizar: {
    title: 'Carga prevista sin finalizar',
    explanation: 'La fecha planificada de carga ha pasado y no consta que el conductor haya finalizado todas las cargas.',
    action: 'Comprueba el estado de las paradas de carga y solicita la confirmación al conductor o colaborador.',
    resolution: 'Todas las cargas confirmadas, cambio de planificación o pedido entregado/cancelado.',
  },
  entrega_vencida: {
    title: 'Entrega prevista vencida',
    explanation: 'Ha pasado el plazo configurado desde la entrega prevista y el pedido no consta como entregado.',
    action: 'Confirma la entrega y su documentación o actualiza la planificación con el motivo real.',
    resolution: 'Entrega confirmada, cambio de planificación o pedido cancelado.',
  },
});

function asDateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dayMinus(date, count) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - count);
  return d.toISOString().slice(0, 10);
}

function allLoadsComplete(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.carga_ok === true) return true;
  const stops = Object.values(data.paradas || {}).filter(stop => stop?.tipo === 'carga');
  return stops.length > 0 && stops.every(stop => stop.carga_ok === true);
}

async function upsertActive(queryable, { empresaId, pedido, causeCode }) {
  const cause = CAUSES[causeCode];
  if (!cause) throw new Error(`Causa desconocida: ${causeCode}`);
  const orderLabel = pedido.numero || pedido.id;
  const date = causeCode === 'carga_sin_finalizar'
    ? asDateOnly(pedido.fecha_carga)
    : asDateOnly(pedido.fecha_entrega || pedido.fecha_descarga);
  const explanation = `${cause.explanation} Pedido ${orderLabel}${date ? `; fecha prevista ${date}` : ''}.`;
  await queryable.query(
    `INSERT INTO agenda_eventos
      (empresa_id, titulo, descripcion, fecha_inicio, todo_dia, tipo, prioridad, estado,
       visibilidad, pedido_id, source_type, source_id, cause_code, explanation,
       recommended_action, resolution_condition, generated_at)
     VALUES ($1,$2,$3,NOW(),false,'operativa','alta','pendiente','equipo',$4::uuid,
             'pedido',$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (empresa_id, source_type, source_id, cause_code)
       WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND cause_code IS NOT NULL AND resolved_at IS NULL
     DO UPDATE SET explanation=EXCLUDED.explanation,
                   descripcion=EXCLUDED.descripcion,
                   recommended_action=EXCLUDED.recommended_action,
                   resolution_condition=EXCLUDED.resolution_condition,
                   updated_at=NOW()`,
    [empresaId, `${cause.title} · ${orderLabel}`, explanation, pedido.id,
      String(pedido.id), causeCode, explanation, cause.action, cause.resolution]
  );
}

async function resolveActive(queryable, { empresaId, pedidoId, causeCode, reason }) {
  await queryable.query(
    `UPDATE agenda_eventos SET resolved_at=NOW(), resolution_reason=$4,
        estado='hecha', updated_at=NOW()
      WHERE empresa_id=$1 AND source_type='pedido' AND source_id=$2
        AND cause_code=$3 AND resolved_at IS NULL`,
    [empresaId, String(pedidoId), causeCode, reason]
  );
}

async function syncOrderIncidents({ empresaId, pedidoId, queryable = db, today = null }) {
  if (!empresaId || !pedidoId) return;
  const { rows } = await queryable.query(
    `SELECT p.id, p.numero, p.estado::text AS estado, p.fecha_carga, p.fecha_entrega,
            p.fecha_descarga, p.pendiente_completar, p.incidencia_automatica,
            COALESCE(e.cfg_trafico,'{}'::jsonb) AS cfg_trafico,
            s.data AS pasos,
            (NOW() AT TIME ZONE 'Europe/Madrid')::date AS today_madrid
       FROM pedidos p
       JOIN empresas e ON e.id=p.empresa_id
       LEFT JOIN pedido_chofer_pasos s ON s.pedido_id=p.id AND s.empresa_id=p.empresa_id
      WHERE p.id=$1 AND p.empresa_id=$2 LIMIT 1`,
    [pedidoId, empresaId]
  );
  const order = rows[0];
  if (!order) return;
  const currentDay = today || asDateOnly(order.today_madrid);
  const state = String(order.estado || '').toLowerCase();
  const closed = ['entregado', 'cancelado'].includes(state);
  const config = order.cfg_trafico || {};
  const automaticEnabled = String(config.auto_incidencia) !== 'false';
  const loadDate = asDateOnly(order.fecha_carga);
  const deliveryDate = asDateOnly(order.fecha_entrega || order.fecha_descarga);
  const offset = /^[1-9][0-9]*$/.test(String(config.auto_incidencia_dias || ''))
    ? Math.min(365, Number(config.auto_incidencia_dias)) : 1;
  const loadPending = !closed && automaticEnabled && !allLoadsComplete(order.pasos) &&
    !['en_curso', 'espera_descarga', 'descarga'].includes(state) &&
    loadDate && loadDate < currentDay && loadDate >= dayMinus(currentDay, 60);
  const deliveryPending = !closed && !order.pendiente_completar &&
    automaticEnabled && deliveryDate &&
    deliveryDate <= dayMinus(currentDay, offset) && deliveryDate >= dayMinus(currentDay, 60);
  for (const [causeCode, active] of [
    ['carga_sin_finalizar', loadPending], ['entrega_vencida', deliveryPending],
  ]) {
    if (active) await upsertActive(queryable, { empresaId, pedido: order, causeCode });
    else await resolveActive(queryable, {
      empresaId, pedidoId, causeCode,
      reason: closed ? `Pedido ${state}` : !automaticEnabled ? 'Automatismo desactivado para la empresa' : causeCode === 'carga_sin_finalizar'
        ? 'Carga confirmada o planificación actualizada' : 'Entrega confirmada o planificación actualizada',
    });
  }
}

module.exports = { CAUSES, allLoadsComplete, syncOrderIncidents, resolveActive };
