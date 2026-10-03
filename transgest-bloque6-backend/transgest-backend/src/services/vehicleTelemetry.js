const {positionSource}=require('./gpsSource');
const numeric=value=>value===null||value===undefined||value===''?null:Number(value);
const id=value=>String(value?.id||value||'');
const UNITS={odometer_km:'km',fuel_total_l:'l',frigo_temperature_c:'°C',engine_hours:'h'};
function classify(diagnostic={}) {
 const key=id(diagnostic),unit=id(diagnostic.unitOfMeasure);
 if(key==='DiagnosticOdometerId' && (!unit||unit==='UnitOfMeasureMetersId'))return {metric:'odometer_km',scale:0.001};
 if(key==='DiagnosticTotalFuelUsedId' && (!unit||unit==='UnitOfMeasureLitersId'))return {metric:'fuel_total_l',scale:1};
 if(key==='DiagnosticEngineHoursId' && (!unit||unit==='UnitOfMeasureSecondsId'))return {metric:'engine_hours',scale:1/3600};
 const name=String(diagnostic.name||'');
 const cold=/^ThermographTemperature[1-6]Id$/.test(key)||id(diagnostic.controller)==='ControllerCargoRefrigerationHeatingTrailerId'
   ||/thermograph|reefer|refrigerat|frigor|cargo temperature/i.test(name);
 if(cold && unit==='UnitOfMeasureDegreesCelsiusId' && !/outside|ambient|coolant|engine|exterior|motor|setpoint|consigna/i.test(name))return {metric:'frigo_temperature_c',scale:1};
 return null;
}
function geotabSamples(statuses=[],diagnostics=[],now=Date.now(),interpolatedSearch=false) {
 const metadata=new Map(diagnostics.map(d=>[id(d),d])),samples=[];
 for(const status of statuses)for(const reading of status.statusData||[]) {
  const sensor=id(reading.diagnostic),diagnostic=metadata.get(sensor)||{id:sensor};
  const definition=classify(diagnostic),value=numeric(reading.data),stamp=Date.parse(reading.dateTime);
  if(!definition||!Number.isFinite(value)||!Number.isFinite(stamp)||stamp>now+60000)continue;
  const converted=value*definition.scale;
  if((definition.metric==='frigo_temperature_c' && (converted< -100||converted>100))||
     (definition.metric!=='frigo_temperature_c'&&(converted<0||converted>100000000)))continue;
  samples.push({deviceId:id(status.device),metric:definition.metric,sensor,value:converted,unit:UNITS[definition.metric],
   recorded_at:new Date(stamp).toISOString(),quality:interpolatedSearch&&!reading.id?'interpolated':'measured',label:diagnostic.name||sensor});
 }
 return samples;
}
async function store(db,{empresaId,vehiculoId,provider,externalId,samples}) {
 const unique=new Map();
 for(const sample of samples){const key=`${sample.metric}:${sample.sensor}:${sample.recorded_at}`;
  if(!unique.has(key)||sample.quality==='measured')unique.set(key,sample);}
 const rows=[...unique.values()].map(s=>({...s,quality:s.quality||'measured',label:s.label||s.sensor}));
 for(let offset=0;offset<rows.length;offset+=1000) {
  await db.query(`INSERT INTO vehicle_telemetry_log(empresa_id,vehiculo_id,provider,external_id,metric,sensor,value,unit,recorded_at,quality,label)
   SELECT $1,$2,$3,$4,metric,sensor,value,unit,recorded_at,quality,label
   FROM jsonb_to_recordset($5::jsonb) AS readings(metric text,sensor text,value numeric,unit text,recorded_at timestamptz,quality text,label text)
   ON CONFLICT(empresa_id,vehiculo_id,provider,external_id,metric,sensor,recorded_at)
   DO UPDATE SET value=EXCLUDED.value,quality=EXCLUDED.quality,label=EXCLUDED.label
   WHERE vehicle_telemetry_log.quality<>'measured' OR EXCLUDED.quality='measured'`,
   [empresaId,vehiculoId,provider,externalId||'',JSON.stringify(rows.slice(offset,offset+1000))]);
 }
 const sample=rows.filter(s=>s.metric==='odometer_km'&&s.quality==='measured').sort((a,b)=>Date.parse(b.recorded_at)-Date.parse(a.recorded_at))[0];
 if(sample)await db.query(`UPDATE vehiculos SET km_actuales=ROUND($3),updated_at=NOW()
   WHERE empresa_id=$1 AND id=$2 AND gps_provider=$4 AND gps_external_id IS NOT DISTINCT FROM NULLIF($6,'') AND (km_actuales IS NULL OR km_actuales<=$3)
   AND NOT EXISTS(SELECT 1 FROM vehicle_telemetry_log WHERE empresa_id=$1 AND vehiculo_id=$2 AND provider=$4
     AND external_id=$6 AND metric='odometer_km' AND quality='measured' AND recorded_at>$5)`,[empresaId,vehiculoId,sample.value,provider,sample.recorded_at,externalId||'']);
 return rows.length;
}
async function latestForFleet(db,company,vehicles,now=Date.now()) {
 if(!vehicles.length || !(await db.query("SELECT to_regclass('public.vehicle_telemetry_log') AS name")).rows[0]?.name)return new Map();
 const rows=(await db.query(`SELECT DISTINCT ON(vehiculo_id,provider,external_id,metric,sensor) vehiculo_id,provider,external_id,metric,sensor,value,unit,recorded_at,label
   FROM vehicle_telemetry_log WHERE empresa_id=$1 AND vehiculo_id=ANY($2::uuid[]) AND quality='measured'
   ORDER BY vehiculo_id,provider,external_id,metric,sensor,recorded_at DESC`,[company,vehicles.map(v=>v.id)])).rows;
 return new Map(vehicles.map(v=>[String(v.id),rows.filter(r=>String(r.vehiculo_id)===String(v.id)&&r.provider===positionSource(v)&&r.external_id===(v.gps_external_id||''))
   .map(r=>({...r,value:Number(r.value),age_seconds:Math.max(0,(now-Date.parse(r.recorded_at))/1000)}))]));
}
function providerSamples(input) {
 const at=Date.parse(input.recorded_at);
 if(!Number.isFinite(at)||at>Date.now()+60000)return [];
 const fields=[['odometro_km','odometer_km',0,100000000],['fuel_total_l','fuel_total_l',0,100000000],['frigo_temperature_c','frigo_temperature_c',-100,100],['engine_hours','engine_hours',0,1000000]];
 return fields.flatMap(([field,metric,min,max])=>{const value=numeric(input[field]);return Number.isFinite(value)&&value>=min&&value<=max?
  [{metric,sensor:String(input[`${field}_sensor`]||field).slice(0,120),label:metric==='frigo_temperature_c'?'Sonda de carga':field,value,unit:UNITS[metric],recorded_at:new Date(at).toISOString(),quality:'measured'}]:[];});
}
module.exports={classify,geotabSamples,providerSamples,store,latestForFleet,UNITS,id};
