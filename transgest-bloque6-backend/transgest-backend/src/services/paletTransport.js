async function linkPaletTransport(queryable, { empresa, movimientoId, pedidoId }) {
  const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(pedidoId || ""))) fail(400, "Selecciona un pedido de transporte válido.");
  const { rows: movements } = await queryable.query("SELECT id,tipo FROM palets_movimientos WHERE id=$1 AND empresa_id=$2 FOR UPDATE", [movimientoId,empresa]);
  if (!movements[0]) fail(404,"Movimiento no encontrado.");
  if (movements[0].tipo !== "devolucion") fail(400,"Solo se puede vincular transporte a una devolución.");
  const { rows: orders } = await queryable.query("SELECT id,estado FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR SHARE", [pedidoId,empresa]);
  if (!orders[0]) fail(404,"Pedido no encontrado en esta empresa.");
  if (orders[0].estado === "cancelado") fail(409,"No puedes vincular un pedido cancelado.");
  const { rows } = await queryable.query("UPDATE palets_movimientos SET pedido_transporte_id=$1 WHERE id=$2 AND empresa_id=$3 RETURNING *",[pedidoId,movimientoId,empresa]);
  return rows[0];
}
module.exports = { linkPaletTransport };
