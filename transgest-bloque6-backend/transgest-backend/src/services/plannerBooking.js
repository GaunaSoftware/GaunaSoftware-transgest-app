const crypto=require('crypto');
const {fail,text}=require('./plannerInventory');
function dockFields(input){
 const d={nombre:text(input.nombre),almacen:text(input.almacen,160),activo:input.activo!==false,horario_inicio:input.horario_inicio||'06:00',horario_fin:input.horario_fin||'18:00',dias:input.dias||[1,2,3,4,5],capacidad:Number(input.capacidad??33),duracion_min:Number(input.duracion_min??90),margen_min:Number(input.margen_min??15),zona_horaria:input.zona_horaria||'Europe/Madrid'};
 if(!d.nombre||!d.almacen||!/^\d{2}:\d{2}(:\d{2})?$/.test(d.horario_inicio)||!/^\d{2}:\d{2}(:\d{2})?$/.test(d.horario_fin)||d.horario_inicio>=d.horario_fin)throw fail('Indica muelle, almacén y un horario de apertura anterior al cierre.');
 if(!Array.isArray(d.dias)||!d.dias.length||d.dias.some(n=>!Number.isInteger(n)||n<1||n>7))throw fail('Selecciona los días de apertura.');
 if(!Number.isInteger(d.capacidad)||d.capacidad<1||d.capacidad>1000||!Number.isInteger(d.duracion_min)||d.duracion_min<5||d.duracion_min>1440||!Number.isInteger(d.margen_min)||d.margen_min<0||d.margen_min>240)throw fail('Revisa capacidad, duración y margen entre reservas.');
 try{new Intl.DateTimeFormat('es',{timeZone:d.zona_horaria}).format();}catch{throw fail('Zona horaria no válida.');}return d;
}
async function reserve(db,company,user,input){
 const start=new Date(input.inicio),end=new Date(input.fin),notes=text(input.notas,2000);
 if(!['carga','descarga'].includes(input.tipo)||!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end-start>86400000)throw fail('Selecciona un horario válido de hasta 24 horas.');
 return db.transaction(async tx=>{
  const dock=(await tx.query('SELECT * FROM planner_muelles WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[input.muelle_id,company])).rows[0];
  if(!dock)throw fail('Muelle no encontrado',404);
  if(!dock.activo)throw fail('El muelle está fuera de servicio.',409);
  const window=(await tx.query(`SELECT ($1::timestamptz AT TIME ZONE $3)::time >= $4::time AS abre,
   ($2::timestamptz AT TIME ZONE $3)::time <= $5::time AS cierra,
   ($1::timestamptz AT TIME ZONE $3)::date = ($2::timestamptz AT TIME ZONE $3)::date AS mismo_dia,
   EXTRACT(ISODOW FROM $1::timestamptz AT TIME ZONE $3)::int AS dia`,[start,end,dock.zona_horaria,dock.horario_inicio,dock.horario_fin])).rows[0];
  if(!window.abre||!window.cierra||!window.mismo_dia||!dock.dias.includes(window.dia))throw fail('El hueco está fuera del horario o de los días de apertura del muelle.',409);
  let preparedPallets=0;
  if(input.pedido_id){
   const order=(await tx.query('SELECT id,estado,origen_producto FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[input.pedido_id,company])).rows[0];
   if(!order)throw fail('Pedido no encontrado',404);
   if(order.origen_producto!=='planner')throw fail('Selecciona una carga de Planner.',409);
   if(['cancelado','entregado','facturado'].includes(order.estado))throw fail('El viaje está cerrado.',409);
   const existing=(await tx.query('SELECT id FROM planner_reservas WHERE empresa_id=$1 AND pedido_id=$2 AND tipo=$3',[company,order.id,input.tipo])).rows[0];
   preparedPallets=Number((await tx.query(`SELECT GREATEST(COALESCE(SUM(CEIL(l.cantidad/l.unidades_palet)) FILTER(WHERE l.unidad<>'palet'),0),COALESCE(SUM(l.cantidad) FILTER(WHERE l.unidad='palet'),0)) AS palets FROM planner_preparaciones p JOIN planner_preparacion_lineas l ON l.preparacion_id=p.id AND l.empresa_id=p.empresa_id JOIN planner_existencias e ON e.id=l.existencia_id AND e.empresa_id=l.empresa_id JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id WHERE p.pedido_id=$1 AND p.empresa_id=$2 AND p.estado<>'cancelada'`,[order.id,company])).rows[0]?.palets||0);
   if(existing)throw fail('La carga ya tiene un hueco. Libera su reserva anterior para reprogramarla.',409);
  }
  const overlaps=await tx.query(`SELECT id FROM planner_reservas WHERE muelle_id=$1 AND empresa_id=$2
   AND inicio < $4::timestamptz + ($5::int * INTERVAL '1 minute') AND fin + ($5::int * INTERVAL '1 minute') > $3::timestamptz`,[dock.id,company,start,end,dock.margen_min]);
  if(overlaps.rows.length)throw fail('El muelle ya está reservado o no queda el margen necesario entre cargas.',409);
  const pallets=Math.max(preparedPallets,Number(input.palets||0));if(!Number.isFinite(pallets)||pallets<0||pallets>dock.capacidad)throw fail('La carga supera la capacidad del muelle.');
  const result=(await tx.query('INSERT INTO planner_reservas(id,empresa_id,muelle_id,pedido_id,inicio,fin,tipo,notas,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[crypto.randomUUID(),company,dock.id,input.pedido_id||null,start,end,input.tipo,notes,user])).rows[0];
  if(input.solicitud_id){const updated=await tx.query("UPDATE planner_solicitudes_hueco SET estado='asignada',reserva_id=$1 WHERE id=$2 AND empresa_id=$3 AND pedido_id=$4 AND estado='pendiente' RETURNING id",[result.id,input.solicitud_id,company,input.pedido_id]);if(!updated.rows.length)throw fail('La solicitud ya ha cambiado. Actualiza el cuadrante.',409);}
  return result;
 });
}
module.exports={dockFields,reserve};
