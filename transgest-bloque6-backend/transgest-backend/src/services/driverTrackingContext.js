// A short lease prevents an offline or suspended client from tracking indefinitely.
async function driverTrackingContext(db,{empresaId,chofer,now=Date.now()}) {
  if(!chofer||chofer.activo===false||chofer.estado==='baja')return {allowed:false,reason:'chofer_no_activo'};
  const jornada=(await db.query("SELECT id,actividad_actual FROM chofer_jornadas WHERE empresa_id=$1 AND chofer_id=$2 AND estado='abierta' ORDER BY inicio_at DESC LIMIT 1",[empresaId,chofer.id])).rows[0];
  if(!jornada)return {allowed:false,reason:'jornada_cerrada'};
  if(['pausa','descanso','fin'].includes(jornada.actividad_actual))return {allowed:false,reason:'jornada_pausada'};
  if(!chofer.vehiculo_id)return {allowed:false,reason:'sin_vehiculo'};
  const vehicle=(await db.query('SELECT id FROM vehiculos WHERE id=$1 AND empresa_id=$2 AND activo IS DISTINCT FROM false',[chofer.vehiculo_id,empresaId])).rows[0];
  if(!vehicle)return {allowed:false,reason:'vehiculo_no_disponible'};
  const external=(await db.query("SELECT recorded_at FROM gps_position_log WHERE empresa_id=$1 AND vehiculo_id=$2 AND provider NOT IN ('manual','app_chofer') AND raw->>'timestamp_source'='device' AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY recorded_at DESC LIMIT 1",[empresaId,vehicle.id])).rows[0];
  const ms=Date.parse(external?.recorded_at);
  if(ms>=now-300000&&ms<=now+60000)return {allowed:false,reason:'gps_externo_reciente'};
  const active=(await db.query("SELECT id FROM pedidos WHERE empresa_id=$1 AND chofer_id=$2 AND vehiculo_id=$3 AND estado::text IN ('en_curso','descarga','espera_carga','espera_descarga')",[empresaId,chofer.id,vehicle.id])).rows;
  return {allowed:true,jornada_id:jornada.id,vehiculo_id:vehicle.id,active_trip_ids:active.map(p=>p.id),lease_seconds:120};
}
module.exports={driverTrackingContext};
