const crypto=require('node:crypto');
const {loadJourney}=require('./driverJourney');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status,code:'JOURNEY_REPLAN'});};
const uuid=v=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(v||''));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const fingerprint=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const fixed=s=>s.estado!=='pendiente'||s.llegada_real_at||s.inicio_real_at||s.fin_real_at;
function validatePendingSequence(stops,links,sequence){
 if(!Array.isArray(sequence)||sequence.length!==stops.length||new Set(sequence).size!==stops.length||sequence.some(id=>!stops.some(s=>s.id===id)))fail('Incluye cada parada exactamente una vez.',400);
 for(const s of stops)if(fixed(s)&&sequence.indexOf(s.id)!==s.orden-1)fail('Las paradas con actividad conservan su posición.');
 const lastFixed=Math.max(-1,...stops.filter(fixed).map(s=>s.orden-1));
 if(sequence.slice(0,lastFixed+1).some((id,i)=>id!==stops[i].id))fail('Conserva toda la secuencia anterior a la operación en curso.');
 const loaded=new Set();
 for(const id of sequence){const stop=stops.find(s=>s.id===id);for(const link of links.filter(l=>l.parada_id===id)){
   if(stop.tipo==='carga')loaded.add(link.envio_id);
   else if(!loaded.has(link.envio_id))fail('Cada envío debe cargarse antes de descargarse.',400);
 }}
 return sequence;
}
async function replan(tx,{empresaId,pedidoId,actorId,body}){
 if(!uuid(body.client_operation_uuid))fail('Identificador de operación obligatorio.',400);
 const reason=String(body.motivo||'').trim();
 if(reason.length<4||reason.length>1000)fail('Indica el motivo (entre 4 y 1.000 caracteres).',400);
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:groupage-write`]);
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:journey-operation:${body.client_operation_uuid}`]);
 const hash=fingerprint({pedidoId,body});
 const receipt=(await tx.query('SELECT request_hash,resultado FROM viaje_operaciones WHERE empresa_id=$1 AND client_operation_uuid=$2',[empresaId,body.client_operation_uuid])).rows[0];
 if(receipt){if(receipt.request_hash!==hash)fail('La operación se ha reutilizado con otros datos.');return {...receipt.resultado,replayed:true};}
 const members=(await tx.query(`SELECT p.* FROM pedidos p WHERE p.empresa_id=$1 AND p.id IN (
   SELECT vp.pedido_id FROM viaje_pedidos vp WHERE vp.empresa_id=$1 AND vp.viaje_id IN (SELECT viaje_id FROM viaje_pedidos WHERE empresa_id=$1 AND pedido_id=$2 AND activo) AND vp.activo) ORDER BY p.id FOR UPDATE`,[empresaId,pedidoId])).rows;
 if(!members.length)fail('Primero prepara el modelo operativo del pedido.',409);
 const journey=await loadJourney(tx,empresaId,pedidoId,{lock:true});
 if(!journey||!members.some(p=>p.id===pedidoId))fail('Viaje no encontrado.',404);
 if(Number(body.version)!==journey.trip.version)fail('El viaje ha cambiado. Actualiza el plan.');
 if(['entregado','facturado','cancelado'].includes(journey.trip.estado)||members.some(p=>p.factura_id||p.estado==='cancelado'))fail('No se replanifica un viaje cerrado, cancelado o facturado.');
 const links=(await tx.query('SELECT * FROM parada_envios WHERE empresa_id=$1 AND viaje_id=$2',[empresaId,journey.trip.id])).rows;
 const sequence=validatePendingSequence(journey.stops,links,body.paradas||journey.stops.map(s=>s.id));
 let assignment=journey.trip.asignacion_snapshot,relief=null;
 if(body.asignacion){
   if(assignment.colaborador_id||members.some(p=>p.colaborador_id))fail('El cambio de proveedor requiere renovar su aceptación. Conserva el encargo y utiliza el flujo de colaboradores.');
   const keys=['vehiculo_id','remolque_id','chofer_id','chofer2_id'];
   const next=Object.fromEntries(keys.map(k=>[k,body.asignacion[k]||null]));
   if(!next.vehiculo_id||!next.chofer_id||Object.values(next).some(v=>v&&!uuid(v)))fail('Selecciona tractora y conductor válidos.',400);
   if(next.chofer2_id===next.chofer_id)fail('El segundo conductor debe ser diferente.',400);
   if(next.vehiculo_id===next.remolque_id)fail('La tractora y el remolque deben ser distintos.',400);
   const resourceChanged=keys.some(k=>String(next[k]||'')!==String(assignment[k]||''));
   if(resourceChanged){
     const location=String(body.ubicacion_relevo||'').trim();
     if(location.length<3||location.length>400||body.relevo_confirmado!==true)fail('Confirma el relevo e indica el lugar donde se realiza.',400);
     const vehicles=[next.vehiculo_id,next.remolque_id].filter(Boolean),drivers=[next.chofer_id,next.chofer2_id].filter(Boolean);
     for(const id of [...vehicles,...drivers].sort())await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:${id}`]);
     for(const [table,ids] of [['vehiculos',vehicles],['choferes',drivers]]){
       const rows=(await tx.query(`SELECT * FROM ${table} WHERE empresa_id=$1 AND id=ANY($2::uuid[])`,[empresaId,ids])).rows;
       if(table==='vehiculos'){const isTrailer=r=>/remolque|trailer|dolly/i.test([r.clase,r.tipo].filter(Boolean).join(' '));if(rows.some(r=>r.id===next.vehiculo_id&&isTrailer(r)||r.id===next.remolque_id&&!isTrailer(r)))fail('Selecciona un vehículo tractor y un remolque de su tipo correspondiente.',400);}
       if(rows.length!==ids.length)fail('Algún recurso no pertenece a esta empresa.',404);
       if(rows.some(r=>r.activo===false||['baja','inactivo','vacaciones','ausencia','taller','en_taller','averia'].includes(r.estado)))fail('Un recurso no está disponible.');
     }
     const holidays=(await tx.query("SELECT id FROM chofer_vacaciones_solicitudes WHERE empresa_id=$1 AND chofer_id=ANY($2::uuid[]) AND LOWER(estado) IN ('aprobada','aprobado','aceptada') AND fecha_inicio<=(NOW() AT TIME ZONE 'Europe/Madrid')::date AND fecha_fin>=(NOW() AT TIME ZONE 'Europe/Madrid')::date LIMIT 1",[empresaId,drivers])).rows;
     if(holidays.length)fail('El conductor tiene vacaciones aprobadas hoy.');
     const conflict=(await tx.query(`SELECT numero FROM pedidos WHERE empresa_id=$1 AND NOT(id=ANY($2::uuid[])) AND estado::text IN ('en_curso','descarga','cargando','espera_carga','espera_descarga') AND (vehiculo_id=ANY($3::uuid[]) OR remolque_id=ANY($3::uuid[]) OR chofer_id=ANY($4::uuid[]) OR chofer2_id=ANY($4::uuid[])) LIMIT 1`,[empresaId,members.map(p=>p.id),vehicles,drivers])).rows[0];
     if(conflict)fail('Hay otro viaje en curso con estos recursos: '+conflict.numero);
     const now=new Date().toISOString();
     relief={anterior:assignment,siguiente:next,ubicacion:location,received_at:now,actor_id:actorId,motivo:reason,paradas_completadas:journey.stops.filter(s=>s.estado==='finalizada').map(s=>s.id)};
     assignment=next;
     await tx.query('UPDATE pedidos SET vehiculo_id=$3,remolque_id=$4,chofer_id=$5,chofer2_id=$6,matricula_manual=NULL,updated_at=NOW() WHERE empresa_id=$1 AND id=ANY($2::uuid[]) AND estado::text NOT IN (\'entregado\',\'facturado\')',[empresaId,members.map(p=>p.id),next.vehiculo_id,next.remolque_id,next.chofer_id,next.chofer2_id]);
   }
 }
 const changed=sequence.some((id,i)=>id!==journey.stops[i].id);
 if(!changed&&!relief)fail('No hay cambios para guardar.',400);
 const snapshot={...journey.trip,paradas:journey.stops};
 await tx.query('INSERT INTO viaje_plan_versiones(empresa_id,viaje_id,version,snapshot,motivo,actor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(empresa_id,viaje_id,version) DO NOTHING',[empresaId,journey.trip.id,journey.trip.version,JSON.stringify(snapshot),'Estado anterior a replanificación',actorId]);
 if(changed){
   const max=Math.max(...journey.stops.map(s=>s.orden))+sequence.length;
   await tx.query('UPDATE viaje_paradas SET orden=orden+$3 WHERE empresa_id=$1 AND viaje_id=$2',[empresaId,journey.trip.id,max]);
   for(const [i,id] of sequence.entries())await tx.query('UPDATE viaje_paradas SET orden=$4 WHERE empresa_id=$1 AND viaje_id=$2 AND id=$3',[empresaId,journey.trip.id,id,i+1]);
 }
 const trip=(await tx.query('UPDATE viajes_operativos SET version=version+1,asignacion_snapshot=$3,relevos=$4,ruta_calculada=NULL,updated_at=NOW() WHERE empresa_id=$1 AND id=$2 RETURNING *',[empresaId,journey.trip.id,JSON.stringify(assignment),JSON.stringify([...(journey.trip.relevos||[]),...(relief?[relief]:[])])])).rows[0];
 const after={...trip,paradas:sequence.map((id,i)=>({...journey.stops.find(s=>s.id===id),orden:i+1}))};
 await tx.query('INSERT INTO viaje_plan_versiones(empresa_id,viaje_id,version,snapshot,motivo,actor_id) VALUES($1,$2,$3,$4,$5,$6)',[empresaId,trip.id,trip.version,JSON.stringify(after),reason,actorId]);
 const result={ok:true,viaje_id:trip.id,version:trip.version,relevo:!!relief,documentos_conservados:true};
 for(const order of members)await tx.query("INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle) VALUES($1,$2,'viaje.replanificado','usuario',$3,$4)",[order.id,empresaId,actorId,JSON.stringify({...result,motivo:reason,ubicacion:relief?.ubicacion||null})]);
 await tx.query('INSERT INTO viaje_operaciones(empresa_id,client_operation_uuid,viaje_id,request_hash,resultado) VALUES($1,$2,$3,$4,$5)',[empresaId,body.client_operation_uuid,trip.id,hash,JSON.stringify(result)]);
 return result;
}
module.exports={validatePendingSequence,replan};
