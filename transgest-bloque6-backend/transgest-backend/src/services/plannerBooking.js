const crypto=require('crypto');
const {fail,text}=require('./plannerInventory');
function dockFields(input){
 const d={nombre:text(input.nombre),almacen:text(input.almacen,160),activo:input.activo!==false,horario_inicio:input.horario_inicio||'06:00',horario_fin:input.horario_fin||'18:00',dias:input.dias||[1,2,3,4,5],capacidad:33,duracion_min:90,margen_min:0,zona_horaria:input.zona_horaria||'Europe/Madrid'};
 // Legacy columns remain compatible, but no longer impose pallet/time limits.
 if(!d.nombre||!d.almacen||!/^\d{2}:\d{2}(:\d{2})?$/.test(d.horario_inicio)||!/^\d{2}:\d{2}(:\d{2})?$/.test(d.horario_fin)||d.horario_inicio>=d.horario_fin)throw fail('Indica muelle, almacén y un horario de apertura anterior al cierre.');
 if(!Array.isArray(d.dias)||!d.dias.length||d.dias.some(n=>!Number.isInteger(n)||n<1||n>7))throw fail('Selecciona los días de apertura.');
 try{new Intl.DateTimeFormat('es',{timeZone:d.zona_horaria}).format();}catch{throw fail('Zona horaria no válida.');}return d;
}
async function reserve(db,company,user,input){
 const start=new Date(input.inicio);
 if(!['carga','descarga'].includes(input.tipo)||!Number.isFinite(+start))throw fail('Selecciona la operación y la fecha de llegada.');
 // Compatibility marker, not a duration or an exclusive time reservation.
 const end=new Date(+start+60000);
 return db.transaction(async tx=>{
  const dock=(await tx.query('SELECT * FROM planner_muelles WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[input.muelle_id,company])).rows[0];
  if(!dock)throw fail('Muelle no encontrado',404);
  if(!dock.activo)throw fail('El muelle está fuera de servicio.',409);
  const window=(await tx.query(`SELECT ($1::timestamptz AT TIME ZONE $2)::time >= $3::time AND ($1::timestamptz AT TIME ZONE $2)::time < $4::time AS abierto,
   EXTRACT(ISODOW FROM $1::timestamptz AT TIME ZONE $2)::int AS dia`,[start,dock.zona_horaria,dock.horario_inicio,dock.horario_fin])).rows[0];
  if(!window.abierto||!dock.dias.includes(window.dia))throw fail('La llegada está fuera del horario de apertura del muelle.',409);
  let order;
  if(input.pedido_id){
   order=(await tx.query('SELECT id,estado,origen_producto FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[input.pedido_id,company])).rows[0];
   if(!order)throw fail('Pedido no encontrado',404);
   if(order.origen_producto!=='planner')throw fail('Selecciona una carga de Planner.',409);
   if(['cancelado','entregado','facturado'].includes(order.estado))throw fail('El viaje está cerrado.',409);
   if((await tx.query('SELECT id FROM planner_reservas WHERE empresa_id=$1 AND pedido_id=$2 AND tipo=$3',[company,order.id,input.tipo])).rows.length)throw fail('La carga ya tiene un muelle. Libera su asignación anterior para reprogramarla.',409);
  }
  const occupied=(await tx.query(`SELECT DISTINCT p.id,p.numero FROM planner_reservas r JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id
   LEFT JOIN planner_preparaciones pp ON pp.pedido_id=p.id AND pp.empresa_id=p.empresa_id AND pp.estado<>'cancelada'
   WHERE r.muelle_id=$1 AND r.empresa_id=$2 AND (pp.situacion_camion='cargando' OR p.estado::text IN ('cargando','en_carga'))`,[dock.id,company])).rows;
  if(occupied.length && input.confirmar_ocupado!==true)throw Object.assign(fail(`Hay un camión cargando en ${dock.nombre}: ${occupied.map(p=>p.numero).join(', ')}. ¿Deseas continuar con la asignación?`,409),{code:'MUELLE_OCUPADO',requiere_confirmacion:true});
  const result=(await tx.query('INSERT INTO planner_reservas(id,empresa_id,muelle_id,pedido_id,inicio,fin,tipo,notas,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[crypto.randomUUID(),company,dock.id,order?.id||null,start,end,input.tipo,text(input.notas,2000),user])).rows[0];
  if(order){
   await tx.query("UPDATE pedidos SET estado='confirmado' WHERE id=$1 AND empresa_id=$2 AND estado='pendiente'",[order.id,company]);
   await tx.query("UPDATE planner_solicitudes_hueco SET estado='asignada',reserva_id=$1 WHERE empresa_id=$2 AND pedido_id=$3 AND estado='pendiente'",[result.id,company,order.id]);
  }
  await tx.query("INSERT INTO planner_eventos(empresa_id,pedido_id,tipo,datos,created_by) VALUES($1,$2,'muelle.asignado',$3,$4)",[company,order?.id||null,JSON.stringify({muelle_id:dock.id,reserva_id:result.id,inicio:start,confirmacion:'planificador',muelle_ocupado_aceptado:occupied.length>0}),user]);
  return result;
 });
}
module.exports={dockFields,reserve};
