async function assertSupplierOrder(db, order, empresaId) {
  if (!order || !order.colaborador_id || order.vehiculo_id) {
    throw Object.assign(new Error('La orden de carga solo esta disponible para colaboradores. Utiliza el DCD o la carta de porte para flota propia.'), { status: 409 });
  }
  const plate = String(order.matricula_colaborador || order.matricula_manual || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (plate) {
    const { rows } = await db.query("SELECT id FROM vehiculos WHERE empresa_id=$1 AND regexp_replace(upper(matricula), '[^A-Z0-9]', '', 'g')=$2 LIMIT 1", [empresaId, plate]);
    if (rows.length) throw Object.assign(new Error('La matricula pertenece a la flota propia. No se puede emitir una orden para un colaborador.'), { status: 409 });
  }
}
module.exports = { assertSupplierOrder };
