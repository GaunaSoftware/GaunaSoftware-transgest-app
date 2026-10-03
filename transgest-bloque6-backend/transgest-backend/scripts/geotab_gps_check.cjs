const assert = require('node:assert/strict');
const geotab = require('../src/services/geotabGps');

async function main() {
  assert.throws(() => geotab.credentials('invalid'), /JSON/);
  assert.throws(() => geotab.safeHost('my.geotab.com.evil.test'), /no autorizado/);
  assert.equal(geotab.safeHost('eu.geotab.com'),'eu.geotab.com');
  assert.equal(geotab.safeHost('https://eu.geotab.com/apiv1'),'eu.geotab.com');
  assert.throws(() => geotab.safeHost('https://eu.geotab.com.evil.test/apiv1'),/no autorizado/);
  const calls=[];
  const transport=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push({url,method:request.method});
    const result=request.method==='Authenticate'
      ? {path:'eu.geotab.com',credentials:{database:'demo',userName:'api@example.invalid',sessionId:'test-session'}}
      : request.params.typeName==='Device'
        ? [{id:'b1',licensePlate:'7484-HTS'},{id:'b2',licensePlate:'0009-LCZ'}]
        : [{device:{id:'b1'},latitude:40.1,longitude:-3.5,dateTime:'2026-09-28T10:00:00Z',speed:50}];
    return {ok:true,json:async()=>({result})};
  };
  const data=await geotab.snapshot(JSON.stringify({database:'demo',userName:'api@example.invalid',password:'synthetic'}),transport);
  assert.equal(calls.length,3);
  assert.equal(calls[1].url,'https://eu.geotab.com/apiv1');
  const vehicle={id:'vehicle-a',matricula:'7484 HTS',gps_provider:null,gps_external_id:null};
  const {uniqueIndex}=require('../src/services/gpsSource');
  assert.equal(uniqueIndex([{id:'a',device:'same'},{id:'b',device:'same'}],v=>v.device).size,0,'Ambiguous IDs are never assigned');
  const match=geotab.positions(data,[vehicle]);
  assert.equal(match.positions.length,1);
  assert.equal(match.positions[0].vehicle.id,vehicle.id);
  assert.equal(match.positions[0].deviceId,'b1');
  for(const provider of ['locatel','movildata','manual','app_chofer']) {
    assert.equal(geotab.positions(data,[{...vehicle,gps_provider:provider}]).positions.length,0,`Preserve ${provider} assignment`);
  }
  assert.equal(geotab.positions(data,[vehicle,{...vehicle,id:'other'}]).positions.length,0,'No enlazar matrículas duplicadas');
  assert.equal(geotab.positions({...data,devices:[...data.devices,{id:'b3',licensePlate:'7484-HTS'}]},[vehicle]).positions.length,0,'No enlazar dispositivos con matrícula duplicada');
  assert.equal(geotab.positions(data,[{...vehicle,gps_provider:'geotab',gps_external_id:'b2'}]).positions.length,0,'No reemplazar un enlace explícito por matrícula');
  assert.equal(geotab.positions(data,[{...vehicle,gps_provider:'geotab',gps_external_id:'b1'},
    {...vehicle,id:'other',matricula:'OTHER',gps_provider:'geotab',gps_external_id:'b1'}]).positions.length,0,'No enlazar ID externo duplicado');
  console.log('Geotab: autenticación, host, mapeo y aislamiento de matrícula correctos');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
