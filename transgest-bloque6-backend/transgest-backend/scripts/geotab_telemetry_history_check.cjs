const assert=require('node:assert/strict');
const geotab=require('../src/services/geotabGps');
const secret=JSON.stringify({database:'synthetic',userName:'api@example.invalid',password:'local-fixture'});
const from=new Date(Date.now()-3600000).toISOString(),to=new Date(Date.now()-1800000).toISOString();
const metadata=[
 {id:'DiagnosticOdometerId',unitOfMeasure:{id:'UnitOfMeasureMetersId'}},
 {id:'DiagnosticTotalFuelUsedId',unitOfMeasure:{id:'UnitOfMeasureLitersId'}},
 {id:'DiagnosticEngineHoursId',unitOfMeasure:{id:'UnitOfMeasureSecondsId'}},
 {id:'ThermographTemperature1Id',name:'Cargo probe 1',unitOfMeasure:{id:'UnitOfMeasureDegreesCelsiusId'}},
 {id:'outside',name:'Outside temperature',unitOfMeasure:{id:'UnitOfMeasureDegreesCelsiusId'}}];
async function main(){
 const calls=[];let budgetChecks=0,split=false;
 const transport=async(url,options)=>{
  const request=JSON.parse(options.body);calls.push(request);
  const p=request.params;let result;
  if(request.method==='Authenticate')result={path:'eu.geotab.com',credentials:{sessionId:'synthetic'}};
  else if(p.typeName==='Diagnostic')result=metadata;
  else if(p.typeName==='DeviceStatusInfo')result=[{device:{id:'own'},statusData:metadata.map(d=>({diagnostic:{id:d.id},data:1,dateTime:from}))}];
  else if(p.typeName==='LogRecord'){
   assert.equal(p.search.deviceSearch.id,'own');
   if(!split){split=true;result=Array.from({length:5000},(_,i)=>({id:`overflow${i}`,device:{id:'own'}}));}
   else result=[{id:'real',device:{id:'own'},latitude:38,longitude:-1,dateTime:from},{id:'foreign',device:{id:'other'},dateTime:to}];
  }else if(p.typeName==='StatusData'){
   assert.deepEqual(Object.keys(p.search.diagnosticSearch),['id']);
   const id=p.search.diagnosticSearch.id;
   result=[{device:{id:'own'},diagnostic:{id},data:id==='DiagnosticOdometerId'?500000000:id==='DiagnosticEngineHoursId'?3600:id==='ThermographTemperature1Id'?-18:5,dateTime:from},
    {id:`${id}:real`,device:{id:'own'},diagnostic:{id},data:id==='DiagnosticOdometerId'?500025000:id==='DiagnosticEngineHoursId'?5400:id==='ThermographTemperature1Id'?-17:10,dateTime:to}];
  }
  return {ok:true,json:async()=>({result})};
 };
 const report=await geotab.history(secret,'own',from,to,transport,async()=>{budgetChecks++;});
 assert.equal(budgetChecks,calls.length,'Every remote request, including split queries, checks usage');
 assert.equal(calls.filter(c=>c.params.typeName==='LogRecord').length,3,'Full pages are subdivided rather than truncated');
 assert.equal(report.positions.length,1,'Duplicates removed and foreign devices excluded');
 assert.equal(report.samples.find(s=>s.metric==='odometer_km').value,500000);
 assert.equal(report.samples.find(s=>s.metric==='odometer_km').quality,'interpolated');
 assert.equal(report.samples.find(s=>s.metric==='engine_hours').value,1);
 assert.equal(report.samples.find(s=>s.metric==='frigo_temperature_c').value,-18);
 assert(!report.samples.some(s=>s.sensor==='outside'));
 assert.equal(report.samples.find(s=>s.metric==='odometer_km'&&s.recorded_at===to).quality,'measured');
 const baseline=calls.length;
 const trailer=await geotab.history(secret,'own',from,to,transport,async()=>{},{metrics:['frigo_temperature_c'],includePositions:false});
 assert.equal(trailer.positions.length,0);assert(trailer.samples.every(s=>s.metric==='frigo_temperature_c'));
 assert.equal(calls.length-baseline,4,'Trailer query only fetches its cargo temperature');
 let allowed=0;
 await assert.rejects(geotab.history(secret,'own',from,to,transport,async()=>{if(++allowed>2)throw Object.assign(Error('Quota exhausted'),{status:429});}),{status:429});
 await assert.rejects(geotab.history(secret,'own',from,new Date(Date.now()+86400000).toISOString(),transport),{status:422});
 const degraded=await geotab.history(secret,'own',from,to,async(url,options)=>{
  if(JSON.parse(options.body).params.typeName==='StatusData')return {ok:true,json:async()=>({error:{message:'private provider response'}})};
  return transport(url,options);
 });
 assert.equal(degraded.samples.length,0);assert(degraded.positions.length);assert(degraded.warnings.length);
 assert(!JSON.stringify(degraded).includes('private provider response'),'Provider credentials/errors are not stored in the report');
 console.log('Geotab history: real units, probes, scoped periods/devices, interpolation, split pages, quotas and optional-sensor failure passed. No live provider calls.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
