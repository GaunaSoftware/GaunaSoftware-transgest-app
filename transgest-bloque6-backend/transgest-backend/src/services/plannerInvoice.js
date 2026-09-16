const {fail}=require('./plannerInventory');
async function saleLines(tx,company,prepId,customer){
 const prep=(await tx.query('SELECT * FROM planner_preparaciones WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[prepId,company])).rows[0];
 if(!prep)throw fail('Preparación de venta no encontrada.',404);
 if(prep.estado!=='expedida')throw fail('Confirma la expedición antes de facturar la mercancía.',409);
 const order=(await tx.query('SELECT cliente_id FROM pedidos WHERE id=$1 AND empresa_id=$2',[prep.pedido_id,company])).rows[0];
 if(String(order?.cliente_id)!==String(customer))throw fail('La preparación pertenece a otro cliente.',409);
 const old=(await tx.query('SELECT id FROM facturas WHERE empresa_id=$1 AND planner_preparacion_id=$2',[company,prepId])).rows[0];
 if(old)throw fail('Esta mercancía ya tiene una factura de venta. Ábrela desde Facturación.',409);
 const lines=(await tx.query(`SELECT l.referencia || ' · ' || l.descripcion || ' · lote ' || COALESCE(NULLIF(e.lote,''),'—') AS concepto,
  l.cantidad,l.precio_venta AS precio_unit FROM planner_preparacion_lineas l JOIN planner_existencias e ON e.id=l.existencia_id AND e.empresa_id=l.empresa_id
  JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id WHERE l.preparacion_id=$1 AND l.empresa_id=$2 ORDER BY l.parada,a.referencia`,[prepId,company])).rows;
 if(!lines.length)throw fail('La preparación no contiene mercancía.',409);return lines;
}
module.exports={saleLines};
