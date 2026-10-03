const {distance,coordinate}=require('./vehicleTracking');
const time=v=>v===null||v===undefined?NaN:v instanceof Date?v.getTime():Date.parse(v);
const round=v=>Math.round(v*100)/100;
function counterDelta(samples,metric,start,end) {
 const groups=new Map();
 for(const row of samples.filter(r=>r.metric===metric&&r.value!=null&&Number.isFinite(Number(r.value)))){
  const key=`${row.provider||''}:${row.sensor}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 for(const rows of groups.values()){
  rows.sort((a,b)=>time(a.recorded_at)-time(b.recorded_at));
  const closest=stamp=>rows.filter(r=>Math.abs(time(r.recorded_at)-stamp)<=300000)
    .sort((a,b)=>Math.abs(time(a.recorded_at)-stamp)-Math.abs(time(b.recorded_at)-stamp))[0];
  const first=closest(start),last=closest(end);
  if(!first||!last||time(first.recorded_at)>=time(last.recorded_at))continue;
  const interval=rows.filter(r=>time(r.recorded_at)>=time(first.recorded_at)&&time(r.recorded_at)<=time(last.recorded_at));
  if(interval.some((r,i)=>i&&Number(r.value)<Number(interval[i-1].value)))continue;
  const value=Number(last.value)-Number(first.value),hours=(end-start)/3600000;
  if(value<0||(metric==='odometer_km'&&value>hours*160+2)||(metric==='fuel_total_l'&&value>hours*200+10))continue;
  return {value:round(value),method:'odometer_km'===metric?'odometer':'fuel_counter',
    quality:first.quality==='measured'&&last.quality==='measured'&&Math.abs(time(first.recorded_at)-start)<=30000&&Math.abs(time(last.recorded_at)-end)<=30000?'measured':'estimated',
    sensor:first.sensor,from_at:first.recorded_at,to_at:last.recorded_at};
 }
 return null;
}
function trace(rows,start,end) {
 const points=rows.map(r=>({...coordinate(r),at:r.recorded_at,accuracy:r.raw?.accuracy_m}))
   .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&time(p.at)>=start&&time(p.at)<=end)
   .sort((a,b)=>time(a.at)-time(b.at));
 const unique=[...new Map(points.map(p=>[time(p.at),p])).values()];
 let segments=[],segment=[],meters=0,gaps=0,rejected=0;
 for(const p of unique){
  if(p.accuracy!=null&&Number(p.accuracy)>100){rejected++;continue;}
  const previous=segment.at(-1);
  if(previous){const seconds=(time(p.at)-time(previous.at))/1000,leg=distance(previous,p);
   if(seconds>900||seconds<=0||leg/seconds*3.6>160){if(segment.length>1)segments.push(segment);segment=[];gaps++;}
   else meters+=leg;
  }
  segment.push(p);
 }
 if(segment.length>1)segments.push(segment);
 const complete=points.length>=2&&!gaps&&!rejected&&time(points[0].at)-start<=900000&&end-time(points.at(-1).at)<=900000;
 const total=segments.reduce((n,s)=>n+s.length,0),stride=Math.max(1,Math.ceil(total/1500));
 segments=segments.map(s=>s.filter((p,i)=>i===0||i===s.length-1||i%stride===0).map(({lat,lng,at})=>({lat,lng,at})));
 return {segments,points:unique.length,gaps,rejected,complete,
  distance:total>=2?{value:round(meters/1000),method:'gps_trace',quality:complete?'estimated':'partial'}:null};
}
function period(rows,samples,start,end) {
 const route=trace(rows,start,end),odometer=counterDelta(samples,'odometer_km',start,end);
 const distanceKm=odometer||route.distance,fuel=counterDelta(samples,'fuel_total_l',start,end);
 return {from:new Date(start).toISOString(),to:new Date(end).toISOString(),distance:distanceKm,fuel,
  consumption_l_100km:fuel&&distanceKm?.value>0&&distanceKm.quality!=='partial'?round(fuel.value/distanceKm.value*100):null,route};
}
function summarize({order,context,previous,positions=[],samples=[],overlap=false,shared=false}) {
 const start=time(context.load_at),end=time(context.unload_at);
 const result={context,generated_at:new Date().toISOString(),loaded:null,empty:null,temperatures:[],warnings:[]};
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end){result.warnings.push('Faltan las horas reales de carga y descarga. No se usan las fechas planificadas.');return result;}
 result.loaded=period(positions,samples,start,end);
 const prev=time(previous?.descarga_real_at);
 if(Number.isFinite(prev)&&prev<start&&!overlap&&!shared){
  result.empty=period(positions,samples,prev,start);delete result.empty.route.segments;
  result.empty.previous_order_id=previous.id;
 }else result.warnings.push(shared||overlap?'Hay servicios compartidos o solapados: el tramo en vacío necesita revisión.':'No hay una descarga anterior confirmada del mismo vehículo para calcular el tramo en vacío.');
 const temps=samples.filter(s=>s.metric==='frigo_temperature_c'&&s.quality==='measured'&&time(s.recorded_at)>=start&&time(s.recorded_at)<=end);
 for(const sensor of new Set(temps.map(s=>s.sensor))){const readings=temps.filter(s=>s.sensor===sensor),values=readings.map(s=>Number(s.value));
  result.temperatures.push({sensor,label:readings[0].label,min_c:Math.min(...values),max_c:Math.max(...values),samples:values.length});}
 if(!result.loaded.distance)result.warnings.push('Sin datos suficientes para calcular kilómetros.');
 if(result.loaded.route.gaps||!result.loaded.route.complete)result.warnings.push('El recorrido GPS tiene huecos. El mapa no une los tramos sin capturas.');
 if(!result.loaded.fuel)result.warnings.push('Consumo no disponible: faltan lecturas compatibles del contador de combustible.');
 return result;
}
module.exports={counterDelta,trace,period,summarize};
