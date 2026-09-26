const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);
const positive=value=>Number(value)>0?Number(value):null;
const failure=(message,code,extra={})=>{throw Object.assign(new Error(message),{status:409,code,...extra});};
function period(order){
 const start=day(order.fecha_carga||order.fecha_pedido),end=day(order.fecha_descarga||order.fecha_entrega)||start;
 return {start:`${start}T${String(order.hora_carga||'00:00').slice(0,5)}`,end:`${end}T${String(order.hora_descarga||'23:59').slice(0,5)}`};
}
function overlaps(a,b){const left=period(a),right=period(b);return left.start<=right.end&&right.start<=left.end;}
async function validateTrafficAssignment(tx,empresaId,previous,patch,actorId){
 if(patch.asignar_solo_si_libre!==true)return;
 const next={...previous,...patch};
 if(!['pendiente','confirmado'].includes(previous.estado))failure('Este viaje ya ha comenzado. Revisa su planificación desde el pedido.','ASSIGNMENT_STARTED');
 if(!next.vehiculo_id)failure('Selecciona un vehículo de la empresa.','ASSIGNMENT_VEHICLE');
 const vehicles=[...new Set([next.vehiculo_id,next.remolque_id||next.remolque_id_manual].filter(Boolean))];
 const drivers=[...new Set([next.chofer_id,next.chofer2_id].filter(Boolean))];
 for(const id of [...vehicles,...drivers].sort())await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:assignment:${id}`]);
 const fleet=(await tx.query('SELECT v.*,e.data AS extra FROM vehiculos v LEFT JOIN vehiculos_ext e ON e.empresa_id=v.empresa_id AND e.vehiculo_id=v.id WHERE v.empresa_id=$1 AND v.id=ANY($2::uuid[])',[empresaId,vehicles])).rows;
 const staff=(await tx.query('SELECT * FROM choferes WHERE empresa_id=$1 AND id=ANY($2::uuid[])',[empresaId,drivers])).rows;
 if(fleet.length!==vehicles.length||staff.length!==drivers.length)failure('El vehículo, remolque o conductor no pertenece a la empresa.','ASSIGNMENT_SCOPE');
 if(fleet.some(v=>v.activo===false||['baja','inactivo','taller','en_taller','averia'].includes(v.estado)))failure('Hay un vehículo o remolque no disponible. Revisa su ficha o la salida de taller.','ASSIGNMENT_UNAVAILABLE');
 if(staff.some(c=>c.activo===false||['baja','vacaciones','ausencia'].includes(c.estado)))failure('El conductor no está disponible.','ASSIGNMENT_UNAVAILABLE');
 const from=day(next.fecha_carga||next.fecha_pedido),to=day(next.fecha_descarga||next.fecha_entrega)||from;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||to<from)failure('Revisa el intervalo de carga y descarga.','ASSIGNMENT_DATES');
 const holidays=(await tx.query(`SELECT chofer_id FROM chofer_vacaciones_solicitudes WHERE empresa_id=$1 AND chofer_id=ANY($2::uuid[])
   AND LOWER(estado) IN ('aprobada','aprobado','aceptada') AND fecha_inicio<=$4::date AND fecha_fin>=$3::date`,[empresaId,drivers,from,to])).rows;
 if(holidays.length)failure('El conductor tiene vacaciones aprobadas en ese intervalo.','ASSIGNMENT_UNAVAILABLE');
 const warnings=[];
 if(!next.chofer_id)warnings.push('Falta conductor; la asignación quedará incompleta.');
 const truck=fleet.find(v=>v.id===next.vehiculo_id),trailer=fleet.find(v=>v.id===(next.remolque_id||next.remolque_id_manual));
 if(!trailer&&String(truck.clase||truck.tipo).toLowerCase().includes('tractora'))warnings.push('La tractora no tiene remolque seleccionado.');
 for(const v of fleet){if(v.fecha_itv&&day(v.fecha_itv)<from)warnings.push(`${v.matricula}: ITV anterior a la carga.`);if(v.fecha_seguro&&day(v.fecha_seguro)<from)warnings.push(`${v.matricula}: seguro anterior a la carga.`);}
 const capacity=trailer||truck,ext=capacity.extra||{};
 for(const [label,amount,limit] of [['peso (kg)',positive(next.peso_kg),positive(capacity.carga_max_kg)],['palés',positive(next.palets_cantidad),positive(ext.capacidad_palets)],['longitud (m)',positive(next.carga_largo_m||next.metros_lineales),positive(ext.metros_carga)]]){
  if(amount&&limit&&amount>limit)warnings.push(`La carga supera la capacidad de ${label}: ${amount} / ${limit}.`);
 }
 const candidates=(await tx.query(`SELECT * FROM pedidos WHERE empresa_id=$1 AND id<>$2 AND estado::text NOT IN ('entregado','facturado','cancelado')
   AND (vehiculo_id=ANY($3::uuid[]) OR remolque_id=ANY($3::uuid[]) OR chofer_id=ANY($4::uuid[]) OR chofer2_id=ANY($4::uuid[]))
   AND COALESCE(fecha_carga,fecha_pedido)<=$6::date AND COALESCE(fecha_descarga,fecha_entrega,fecha_carga,fecha_pedido)>=$5::date`,[empresaId,previous.id,vehicles,drivers,from,to])).rows;
 for(const order of candidates){if(next.grupaje_id&&String(next.grupaje_id)===String(order.grupaje_id))continue;if(overlaps(next,order))warnings.push(`Posible solapamiento con ${order.numero||order.id}; se usa el día completo cuando falta la hora.`);}
 if(warnings.length&&patch.asignacion_revisada!==true)failure(warnings.join('\n'),'ASSIGNMENT_REVIEW_REQUIRED',{advertencias:warnings,requiere_confirmacion:true});
 if(warnings.length)await tx.query(`INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle)
   VALUES($1,$2,'asignacion.avisos_aceptados','usuario',$3,$4)`,[previous.id,empresaId,actorId||null,JSON.stringify({advertencias:warnings,vehiculo_id:next.vehiculo_id,chofer_id:next.chofer_id||null,fecha_carga:from})]);
 return warnings;
}
module.exports={validateTrafficAssignment,overlaps};
