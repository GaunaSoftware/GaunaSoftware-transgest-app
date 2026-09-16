const {fail,text}=require('./plannerInventory');
async function requestSlot(db,company,collaborator,user,orderId,input){
 const start=new Date(input.inicio),end=new Date(input.fin);
 if(!Number.isFinite(+start)||!Number.isFinite(+end)||start<Date.now()||end<=start||end-start>86400000)throw fail('Selecciona una fecha futura y un intervalo de hasta 24 horas.');
 return db.transaction(async tx=>{
  const order=(await tx.query('SELECT id,estado,colaborador_precio_confirmado FROM pedidos WHERE id=$1 AND empresa_id=$2 AND colaborador_id=$3 FOR UPDATE',[orderId,company,collaborator])).rows[0];
  if(!order)throw fail('Carga no encontrada.',404);
  if(!order.colaborador_precio_confirmado)throw fail('Acepta la carga antes de solicitar un hueco.',409);
  if(['cancelado','entregado','facturado'].includes(order.estado))throw fail('La carga está cerrada.',409);
  if((await tx.query("SELECT id FROM planner_reservas WHERE empresa_id=$1 AND pedido_id=$2 AND tipo='carga'",[company,orderId])).rows.length)throw fail('Esta carga ya tiene un hueco asignado. Contacta con el almacén para cambiarlo.',409);
  if((await tx.query("SELECT id FROM planner_solicitudes_hueco WHERE empresa_id=$1 AND pedido_id=$2 AND estado='pendiente'",[company,orderId])).rows.length)throw fail('Ya hay una solicitud pendiente para esta carga.',409);
  return (await tx.query('INSERT INTO planner_solicitudes_hueco(empresa_id,pedido_id,colaborador_id,inicio,fin,notas,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[company,orderId,collaborator,start,end,text(input.notas,2000),user])).rows[0];
 });
}
module.exports={requestSlot};
