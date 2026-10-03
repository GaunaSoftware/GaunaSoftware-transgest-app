const { assignedGps, positionSource } = require('./gpsSource');
function numeric(value) { if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null; }
function observation(row, now, staleSeconds) {
  const lat=numeric(row.lat), lng=numeric(row.lng), time=Date.parse(row.recorded_at);
  const valid=lat!==null&&lng!==null&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const verified=row.raw?.timestamp_source==='device'&&Number.isFinite(time)&&time<=now+60000;
  const age=verified?Math.max(0,(now-time)/1000):null;
  return {provider:row.provider,recorded_at:row.recorded_at,age_seconds:age,
    status:!verified?'sin_fecha_verificada':!valid?'coordenadas_invalidas':age>staleSeconds?'obsoleta':'reciente',
    position:verified&&valid&&age<=staleSeconds?{lat,lng,speed_kmh:numeric(row.velocidad_kmh)}:null};
}
function locationForVehicle(vehicle, rows, {now=Date.now(), staleSeconds=900}={}) {
  const relevant=rows.filter(row=>String(row.vehiculo_id)===String(vehicle.id))
    .filter(row=>row.provider===positionSource(vehicle))
    .map(row=>observation(row,now,staleSeconds)).sort((a,b)=>Date.parse(b.recorded_at)-Date.parse(a.recorded_at));
  // One assigned source per vehicle, independent of which company connector
  // was saved last. A newer app or second-provider fix cannot replace its GPS.
  const current=relevant.find(row=>row.position);
  const last=current||relevant[0];
  return {id:vehicle.id,matricula:vehicle.matricula,chofer_nombre:vehicle.chofer_nombre||null,
    gps_provider:vehicle.gps_provider||null,estado:vehicle.estado,
    status:last?.status||'sin_datos',position:current?.position||null,
    provider:last?.provider||positionSource(vehicle),last_recorded_at:last?.recorded_at||null,age_seconds:last?.age_seconds??null,
    source_mode:assignedGps(vehicle)?'gps':'app',fallback:false,stale_seconds:staleSeconds};
}
async function readFleetLocations(db, company, options={}) {
  if(!company)throw Object.assign(Error('Empresa no identificada'),{status:401});
  const vehicles=(await db.query(`SELECT v.id,v.matricula,v.estado,v.gps_provider,v.gps_external_id,
    trim(concat_ws(' ',ch.nombre,ch.apellidos)) AS chofer_nombre
    FROM vehiculos v LEFT JOIN choferes ch ON ch.id=v.chofer_id AND ch.empresa_id=v.empresa_id
    WHERE v.empresa_id=$1 AND v.activo=true
      AND lower(coalesce(v.clase,v.tipo::text,'')) NOT LIKE '%remolque%'
      AND lower(coalesce(v.clase,v.tipo::text,'')) NOT LIKE '%dolly%'
      AND upper(v.matricula) NOT LIKE 'R-%' ORDER BY v.matricula`,[company])).rows;
  const rows=vehicles.length?(await db.query(`SELECT DISTINCT ON (vehiculo_id,provider)
    vehiculo_id,provider,lat,lng,velocidad_kmh,recorded_at,raw
    FROM gps_position_log WHERE empresa_id=$1 AND vehiculo_id=ANY($2::uuid[])
    ORDER BY vehiculo_id,provider,recorded_at DESC,id DESC`,[company,vehicles.map(v=>v.id)])).rows:[];
  const telemetry=await require('./vehicleTelemetry').latestForFleet(db,company,vehicles,options.now??Date.now());
  return {generated_at:new Date(options.now??Date.now()).toISOString(),items:vehicles.map(v=>({...locationForVehicle(v,rows,options),telemetry:telemetry.get(String(v.id))||[]})),
    definition:'Cada vehículo usa su GPS asignado; si no tiene GPS, usa la app del conductor. Las capturas sin fecha verificada o de más de 15 minutos no se muestran como posición actual.'};
}
module.exports={locationForVehicle,readFleetLocations,observation};
