const { driverStops, stopData, stopDone } = require('./driverStops');

// Read projection only: keep the legacy enum and historical records untouched.
// Loaded goods do not prove departure; neither GPS nor planned times do so.
function transportProgress(order, data = {}) {
  const legacy = String(order.estado || 'pendiente');
  const result = (codigo, fuente = 'estado_pedido') => ({ codigo, estado_legacy: legacy, fuente,
    cobertura: fuente === 'pasos_chofer' ? 'registrado' : legacy === 'en_curso' ? 'sin_desglose' : 'estado_registrado' });
  if (legacy !== 'en_curso') return result(legacy);
  const stops = driverStops(order);
  const loads = stops.filter(stop => stop.tipo === 'carga');
  const unloads = stops.filter(stop => stop.tipo === 'descarga');
  const loadsDone = loads.every(stop => stopData(stop, data, stops).carga_ok === true);
  // A global legacy flag cannot complete several planned stops.
  if (!loadsDone) return result(legacy);
  const active = unloads.find(stop => !stopDone(stop, stopData(stop, data, stops)));
  if (!active) return result(legacy);
  const progress = stopData(active, data, stops);
  if (progress.posicionado_descarga === true || progress.descarga_iniciada === true) return result(legacy);
  if (progress.viaje_iniciado === true) return result('en_transito', 'pasos_chofer');
  // After an intermediate delivery, do not reuse departure at the previous stop.
  if (unloads.some(stop => stopData(stop, data, stops).firma_entrega === true)) return result(legacy);
  // A stop edited after departure leaves evidence under its old stable id.
  // Do not describe that journey as still waiting to leave the loading site.
  if (Object.entries(data.paradas || {}).some(([id, previous]) => id.startsWith('descarga-') && previous &&
    ['viaje_iniciado','posicionado_descarga','descarga_iniciada','firma_entrega'].some(key => previous[key] === true))) return result(legacy);
  return result('cargado', 'pasos_chofer');
}

// Only hydrate an already authorized page. No N+1 requests, writes or new schema.
async function withTransportProgress(db, company, orders) {
  if (!orders.length) return [];
  if (!company || orders.some(order => order.empresa_id && String(order.empresa_id) !== String(company))) {
    throw Object.assign(new Error('Ámbito de empresa inválido'), { status: 403 });
  }
  const ids = orders.filter(order => order.estado === 'en_curso').map(order => order.id);
  let rows = [];
  if (ids.length) {
    try {
      ({ rows } = await db.query(`SELECT pedido_id, data FROM pedido_chofer_pasos
        WHERE empresa_id=$1 AND pedido_id=ANY($2::uuid[])`, [company, ids]));
    } catch (error) {
      if (error.code !== '42P01') throw error; // Legacy installation without event table.
    }
  }
  const events = new Map(rows.map(row => [String(row.pedido_id), row.data]));
  return orders.map(order => ({ ...order, estado_operativo: transportProgress(order, events.get(String(order.id)) || {}) }));
}

module.exports = { transportProgress, withTransportProgress };
