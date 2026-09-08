export function buildPedidoUpdatePatch(overrides = {}) {
  // Las acciones de lista no tienen una ficha completa ni deben recalcularla.
  const { remolque_id_manual, colaborador_nombre, ...fields } = overrides;
  const patch = Object.fromEntries(Object.entries(fields).filter(([,value])=>value !== undefined));
  if (remolque_id_manual !== undefined) patch.remolque_id = remolque_id_manual || null;
  if (patch.colaborador_id) {
    patch.vehiculo_id = null;
    patch.chofer_id = null;
    patch.chofer2_id = null;
    patch.remolque_id = null;
  }
  return patch;
}
