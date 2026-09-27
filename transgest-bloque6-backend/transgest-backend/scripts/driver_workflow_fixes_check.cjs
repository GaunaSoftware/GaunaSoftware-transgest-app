const assert=require('node:assert/strict');
const {loadDateChoice}=require('../src/services/loadDateChoice');
const {driverStops,mergeStop}=require('../src/services/driverStops');
const now=new Date('2026-10-25T23:15:00Z'); // Madrid is already the following day after the DST change.
const order={estado:'confirmado',fecha_carga:'2026-10-25',origen:'Madrid',destino:'Valencia',peso_kg:24000};
assert.throws(()=>loadDateChoice(order,'en_curso','trafico',{},now),{code:'FECHA_REAL_CARGA_CONFIRMAR',fecha_real:'2026-10-26'});
assert.deepEqual(loadDateChoice(order,'en_curso','trafico',{fecha_carga_accion:'conservar'},now),{recordActual:false,choice:'conservar'});
assert.equal(loadDateChoice(order,'en_curso','trafico',{fecha_carga_accion:'hoy'},now).recordActual,true);
assert.equal(loadDateChoice(order,'en_curso','trafico',{confirmar_carga_real:true},now).recordActual,true,'old clients remain compatible');
assert.equal(loadDateChoice(order,'en_curso','chofer',{fecha_carga_accion:'conservar'},now).recordActual,true,'driver observations cannot suppress actual timestamp');
assert.throws(()=>loadDateChoice(order,'en_curso','trafico',{fecha_carga_accion:'ayer'},now),{status:400});
let data={};const stop=driverStops(order)[0];
function apply(patch){const r=mergeStop(order,data,{...patch,parada_id:stop.id});data=r.data;order.estado=r.state;return r;}
apply({carga_iniciada:true});apply({carga_proceso:true});
const goods={mercancia_confirmada:true,mercancia_cargada:'Cemento',mercancia_palets:'20',mercancia_peso_kg:'24500'};
assert.throws(()=>apply(goods),{code:'DRIVER_WEIGHT_CONFIRMATION_REQUIRED'});
assert.throws(()=>apply({...goods,peso_variacion_confirmacion:'sí'}),{code:'DRIVER_WEIGHT_CONFIRMATION_REQUIRED'});
const result=apply({...goods,peso_variacion_confirmacion:'confirmo'});
assert.equal(result.state,'cargando');assert.equal(result.goods.peso_kg,24500);
assert.equal(data.paradas[stop.id].peso_planificado_kg,24000);assert.equal(data.paradas[stop.id].peso_variacion_kg,500);
assert.equal(data.paradas[stop.id].peso_variacion_confirmacion,'confirmo');assert.ok(data.paradas[stop.id].peso_variacion_confirmada_at);
order.peso_kg=24500;
assert.throws(()=>apply(goods),{code:'DRIVER_WEIGHT_CONFIRMATION_REQUIRED'},'actual order weight must not replace baseline');
apply({...goods,mercancia_peso_kg:'24000'});assert.equal(data.paradas[stop.id].peso_variacion_kg,0);
const multi={estado:'cargando',peso_kg:200,puntos_carga:[{direccion:'A'},{direccion:'B'}],destino:'C'};
const first=driverStops(multi)[0];
const partial=mergeStop(multi,{paradas:{[first.id]:{carga_proceso:true}}},{...goods,parada_id:first.id});
assert.equal(partial.data.paradas[first.id].peso_planificado_kg,null,'cannot compare a stop with whole order total');
console.log('PASS driver workflow: Madrid date choice, compatibility, actual event protection, typed weight acknowledgment, informational audit, stable baseline, multi-stop unknown weight.');
