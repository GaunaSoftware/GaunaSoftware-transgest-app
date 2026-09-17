const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/routes/route_optimizer.js'),'utf8');
const geometry = {type:'LineString',coordinates:[[-3.7,40.4],[-3.6,40.45],[-0.4,39.4]]};
const context = {URLSearchParams, resolveStopCoordinate:async s=>s.coordinates, stopQuery:s=>s.address,
  estimatedRouteFromCoordinates:()=>({geometry:null}),
  fetchJson:async url=>{
    const query=new URL(url).searchParams;
    assert.equal(query.get('overview'),'full');assert.equal(query.get('geometries'),'geojson');
    return {code:'Ok',routes:[{distance:350000,duration:14000,geometry,legs:[]}]};
  }};
const routeLocal = vm.runInNewContext(source.slice(source.indexOf('async function routeLocal('),source.indexOf('async function routeOrs('))+'\nrouteLocal',context);
(async()=>{
  const result=await routeLocal([{coordinates:[-3.7,40.4]},{coordinates:[-0.4,39.4]}]);
  assert.deepEqual(result.geometry,geometry);assert.equal(result.distance_km,350);assert.equal(result.truck_aware,false);
  context.fetchJson=async()=>{throw new Error('provider unavailable');};
  assert.equal((await routeLocal([{coordinates:[-3.7,40.4]},{coordinates:[-0.4,39.4]}])).geometry,null);
  console.log('PASS optimizer actual road geometry, explicit non-truck routing and no fabricated line on provider failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
