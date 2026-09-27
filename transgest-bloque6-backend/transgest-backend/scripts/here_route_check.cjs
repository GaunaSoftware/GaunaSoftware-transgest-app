const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/routes/route_optimizer.js'),'utf8');
const urls=[];
const context={URLSearchParams,DEFAULT_TRUCK:{height_m:4,width_m:2.55,length_m:16.5,weight_t:40,axleload_t:10},resolveStopCoordinate:async s=>[s.lng,s.lat],geocodeHere:()=>{throw new Error('coordinates discarded');},PROVIDERS:{here:{label:'HERE'}},fetchJson:async url=>{urls.push(new URL(url));return {routes:[{sections:[{summary:{length:1000,duration:60},polyline:'BFoz5xJ67i1B1B7PzIhaxL7Y'}]}]};}};
vm.runInNewContext(source.slice(source.indexOf('function preferenceForProvider('),source.indexOf('async function fetchJson(')),context);
const route=vm.runInNewContext(source.slice(source.indexOf('async function routeHere('),source.indexOf('function localRoute('))+'\nrouteHere',context);
(async()=>{
 const stops=[{lat:40.4,lng:-3.7},{lat:39.4,lng:-0.4}];
 await route(stops,'camion',{},'synthetic');await route([...stops,{lat:41.4,lng:2.1}],'eficiente',{height_m:4.2},'synthetic');
 assert.equal(urls[0].searchParams.get('destination'),'39.4,-0.4');assert.equal(urls[1].searchParams.get('destination'),'41.4,2.1');assert.equal(urls[1].searchParams.get('via'),'39.4,-0.4');
 assert.equal(urls[1].searchParams.get('routingMode'),'short');assert.equal(urls[0].searchParams.get('routingMode'),'fast');
 assert.equal(urls[1].searchParams.get('vehicle[height]'),'420');assert.equal(urls[0].searchParams.get('vehicle[grossWeight]'),'40000');
 context.fetchJson=async()=>({routes:[]});await assert.rejects(()=>route(stops,'camion',{},'synthetic'),/recorrido válido/);
 console.log('PASS HERE distinct stops, via, routing mode, current vehicle parameters and empty response rejection (mocked provider)');
})().catch(e=>{console.error(e);process.exitCode=1;});
