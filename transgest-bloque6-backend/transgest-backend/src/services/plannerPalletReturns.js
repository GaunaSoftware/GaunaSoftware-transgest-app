const { fail } = require('./plannerInventory');

const isReturnableArticle = line => [line?.referencia, line?.descripcion]
  .some(value => String(value || '').trim().toUpperCase().startsWith('PALET'));

async function recordDispatch(tx, company, user, order, lines) {
  const returnable = lines.filter(isReturnableArticle);
  if (returnable.length && !order?.cliente_id) throw fail('Asigna un cliente antes de expedir palés retornables.', 409);
  for (const line of returnable) {
    await tx.query(`INSERT INTO planner_palets_cliente
      (empresa_id,preparacion_linea_id,cliente_id,articulo_id,existencia_id,tipo,cantidad,operacion,referencia,created_by)
      SELECT $1,$2,$3,e.articulo_id,e.id,'entrega',$4,$2,$5,$6
      FROM planner_existencias e WHERE e.id=$7 AND e.empresa_id=$1
      ON CONFLICT (empresa_id,operacion) DO NOTHING`,
      [company,line.id,order.cliente_id,line.cantidad,order.numero || '',user,line.existencia_id]);
  }
}

async function balances(queryable, company) {
  return (await queryable.query(`SELECT d.id,d.preparacion_linea_id,d.cliente_id,c.nombre AS cliente,
      d.articulo_id,a.referencia,a.descripcion,d.existencia_id,d.cantidad AS entregados,
      COALESCE(SUM(r.cantidad),0) AS devueltos,
      d.cantidad-COALESCE(SUM(r.cantidad),0) AS pendientes,
      d.referencia AS pedido_numero,d.created_at
    FROM planner_palets_cliente d
    JOIN clientes c ON c.id=d.cliente_id AND c.empresa_id=d.empresa_id
    JOIN planner_articulos a ON a.id=d.articulo_id AND a.empresa_id=d.empresa_id
    LEFT JOIN planner_palets_cliente r ON r.entrega_id=d.id AND r.empresa_id=d.empresa_id AND r.tipo='devolucion'
    WHERE d.empresa_id=$1 AND d.tipo='entrega'
    GROUP BY d.id,c.nombre,a.referencia,a.descripcion
    HAVING d.cantidad>COALESCE(SUM(r.cantidad),0)
    ORDER BY d.created_at DESC,d.id`,[company])).rows;
}

async function returnToStock(db, company, user, input) {
  const quantity = Number(input?.cantidad);
  const reference = String(input?.referencia || '').trim();
  if (!Number.isFinite(quantity) || quantity <= 0 || Math.round(quantity * 1000) !== quantity * 1000) {
    throw fail('Indica una cantidad positiva con hasta tres decimales.');
  }
  if (!reference || reference.length > 160) throw fail('Indica el albarán o referencia de la devolución.');
  if (!/^[0-9a-f-]{36}$/i.test(String(input?.operacion || ''))) throw fail('Falta el identificador de la devolución.');
  if (!/^[0-9a-f-]{36}$/i.test(String(input?.entrega_id || ''))) throw fail('Selecciona una entrega de palés.');
  return db.transaction(async tx => {
    const delivery = (await tx.query(`SELECT d.* FROM planner_palets_cliente d WHERE d.id=$1 AND d.empresa_id=$2 AND d.tipo='entrega' FOR UPDATE`,[input.entrega_id,company])).rows[0];
    if (!delivery) throw fail('Entrega de palés no encontrada en esta empresa.',404);
    const duplicate = (await tx.query('SELECT * FROM planner_palets_cliente WHERE empresa_id=$1 AND operacion=$2',[company,input.operacion])).rows[0];
    if (duplicate) {
      if (duplicate.tipo !== 'devolucion' || String(duplicate.entrega_id) !== String(input.entrega_id) || Number(duplicate.cantidad) !== quantity) throw fail('Este identificador ya corresponde a otra operación.',409);
      return duplicate;
    }
    const returned = (await tx.query(`SELECT COALESCE(SUM(cantidad),0) AS cantidad FROM planner_palets_cliente WHERE empresa_id=$1 AND entrega_id=$2 AND tipo='devolucion'`,[company,delivery.id])).rows[0];
    if (Number(returned.cantidad) + quantity > Number(delivery.cantidad)) throw fail('La devolución supera los palés pendientes de este cliente y viaje.',409);
    const stock = (await tx.query(`UPDATE planner_existencias SET cantidad=cantidad+$3 WHERE id=$1 AND empresa_id=$2 RETURNING *`,[delivery.existencia_id,company,quantity])).rows[0];
    if (!stock) throw fail('La ubicación original de estos palés ya no está disponible.',409);
    const row = (await tx.query(`INSERT INTO planner_palets_cliente
      (empresa_id,preparacion_linea_id,cliente_id,articulo_id,existencia_id,tipo,cantidad,entrega_id,operacion,referencia,created_by)
      VALUES($1,$2,$3,$4,$5,'devolucion',$6,$7,$8,$9,$10) RETURNING *`,
      [company,delivery.preparacion_linea_id,delivery.cliente_id,delivery.articulo_id,delivery.existencia_id,quantity,delivery.id,input.operacion,reference,user])).rows[0];
    await tx.query(`INSERT INTO planner_movimientos(empresa_id,existencia_id,tipo,cantidad,saldo,reservado,motivo,referencia,created_by,operacion)
      VALUES($1,$2,'devolucion',$3,$4,$5,$6,$7,$8,$9)`,
      [company,stock.id,quantity,stock.cantidad,stock.reservado,
        `Devolución de palés del pedido ${delivery.referencia || 'sin referencia'}`,reference,user,input.operacion]);
    return row;
  });
}

module.exports = { isReturnableArticle, recordDispatch, balances, returnToStock };
