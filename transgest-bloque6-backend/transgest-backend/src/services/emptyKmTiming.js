function shouldCalculateEmptyKmAfterLoad({ step = {}, order = {}, driverId = null } = {}) {
  const reading = step.km_carga;
  const km = Number(reading);
  return step.carga_ok === true
    && reading !== null && reading !== undefined && reading !== ""
    && Number.isFinite(km) && km >= 0
    && Boolean(order.carga_real_at)
    && Boolean(order.vehiculo_id)
    && !order.colaborador_id
    && Boolean(driverId)
    && [order.chofer_id, order.chofer2_id].some(id => String(id || "") === String(driverId))
    && !(Number(order.km_vacio) > 0);
}

module.exports = { shouldCalculateEmptyKmAfterLoad };
