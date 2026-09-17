async function assertCargoEditable(tx, company, order, patch) {
  const changed = ['bultos','palets_cantidad','peso_kg','metros_lineales'].some(key =>
    key in patch && Number(patch[key] || 0) !== Number(order[key] || 0));
  if (order.origen_producto !== 'planner' || !changed) return;
  const {rows} = await tx.query("SELECT id FROM planner_preparaciones WHERE pedido_id=$1 AND empresa_id=$2 AND estado<>'cancelada'", [order.id, company]);
  if (rows.length) throw Object.assign(new Error('Esta carga tiene mercancía reservada o expedida. Modifica o libera su preparación en Almacén y stock para mantener el inventario y el camión sincronizados.'), {status:409});
}
module.exports = {assertCargoEditable};
