async function validateAgendaReferences(db,user,body) {
  const fail=()=>Object.assign(new Error('La persona, pedido o vehículo no pertenece a esta empresa.'),{statusCode:400});
  if(body.asignado_a) {
    const {rows}=await db.query('SELECT usuario_id FROM usuario_empresas WHERE empresa_id=$1 AND usuario_id=$2 AND activo=true',[user.empresa_id,body.asignado_a]);
    if(!rows.length)throw fail();
  }
  for(const [key,table] of [['pedido_id','pedidos'],['vehiculo_id','vehiculos']])if(body[key]){
    const {rows}=await db.query(`SELECT id FROM ${table} WHERE empresa_id=$1 AND id=$2`,[user.empresa_id,body[key]]);
    if(!rows.length)throw fail();
  }
}
function validateAgendaDates(body,prior={}) {
  const start=new Date(body.fecha_inicio===undefined?prior.fecha_inicio:body.fecha_inicio);
  const endValue=body.fecha_fin===undefined?prior.fecha_fin:body.fecha_fin;
  const end=endValue?new Date(endValue):null;
  if(!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end<start)))throw Object.assign(new Error('Indica un inicio válido y una finalización posterior o igual.'),{statusCode:400});
}
module.exports={validateAgendaReferences,validateAgendaDates};
