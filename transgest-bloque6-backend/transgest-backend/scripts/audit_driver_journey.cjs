const signOperation=require('./synthetic_sign_operation.cjs');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async function({base,fetch,db,managerToken,driverToken,company,driver,vehicle}){
 assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/);let checks=0;
 async function call(method,path,body,status=200,token=driverToken){const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));checks++;return data;}
 const ids=[crypto.randomUUID(),crypto.randomUUID()];
 for(let i=0;i<ids.length;i++)await db.query(`INSERT INTO pedidos(id,empresa_id,cliente_id,numero,estado,fecha_carga,origen,destino,importe,mercancia,peso_kg,bultos,vehiculo_id,chofer_id)
   SELECT $1,$2,id,$3,'confirmado',CURRENT_DATE,$4,$5,200,'Sacos sintéticos',100,2,$6,$7 FROM clientes WHERE empresa_id=$2 ORDER BY id LIMIT 1`,[ids[i],company,`QA-CHOFER-PARADAS-${i+1}`,i?'Murcia':'Alicante',i?'Guadalajara':'Madrid',vehicle.id,driver.id]);
 const trailer=crypto.randomUUID();
 await db.query("INSERT INTO vehiculos(id,empresa_id,matricula,clase,estado,activo) VALUES($1,$2,'R-GRP-CHOFER-QA','Semirremolque','disponible',true)",[trailer,company]);
 const grouped=await call('POST','/pedidos/grupaje/combinar',{pedido_ids:ids,borrador:false,client_operation_uuid:crypto.randomUUID(),asignacion:{vehiculo_id:vehicle.id,remolque_id:trailer,chofer_id:driver.id,asignacion_revisada:true}},200,managerToken);
 let context=(await call('GET',`/pedidos/${ids[0]}/chofer-pasos`)).viaje_operativo;
 assert.equal(context.id,grouped.viaje_id);assert.equal(context.paradas.length,4);
 const [first,second]=context.paradas;
 const patch=(stop,body,status=200)=>call('PATCH',`/pedidos/${stop.pedido_id}/chofer-pasos`,{parada_id:stop.parada_legacy_id,client_operation_uuid:crypto.randomUUID(),...body},status);
 await call('PATCH',`/pedidos/${first.pedido_id}/chofer-pasos`,{carga_ok:true},409);
 await call('PATCH',`/pedidos/${first.pedido_id}/estado`,{estado:'entregado'},409);
 await patch(second,{carga_iniciada:true},409);
 const op=crypto.randomUUID(),arrival={carga_iniciada:true,client_operation_uuid:op};
 const saved=await patch(first,arrival);assert.deepEqual(await patch(first,arrival),saved);
 await patch(first,{...arrival,carga_proceso:true},409);
 await patch(first,{carga_proceso:true});
 await patch(first,{mercancia_confirmada:true,mercancia_cargada:'Sacos sintéticos',mercancia_palets:2,mercancia_peso_kg:100});
 await patch(first,{albaran_carga:true});
 const signature=require('./synthetic_signature_fixture.cjs')();
 await signOperation(call, `/pedidos/${first.pedido_id}/firma`, first.parada_legacy_id);
 await patch(first,{firma_cargador:true});await patch(first,{carga_ok:true});
 await patch(second,{carga_iniciada:true}); // Same truck; first child is in transit.
 context=(await call('GET',`/pedidos/${first.pedido_id}/chofer-pasos`)).viaje_operativo;
 assert.equal(context.proxima_parada.id,second.id);assert.equal(context.paradas[0].completa,true);assert.equal(context.paradas[1].completa,false);
 assert.equal((await db.query('SELECT count(*)::int n FROM chofer_parada_operaciones WHERE empresa_id=$1 AND client_operation_uuid=$2',[company,op])).rows[0].n,1);
 const otherDriver=crypto.randomUUID();await db.query("INSERT INTO choferes(id,empresa_id,nombre) VALUES($1,$2,'Asignación ajena sintética')",[otherDriver,company]);
 await db.query('UPDATE pedidos SET chofer_id=$2 WHERE id=$1',[second.pedido_id,otherDriver]);
 await call('GET',`/pedidos/${first.pedido_id}/chofer-pasos`,null,403);
 await patch(first,{carga_ok:true},403);
 await db.query('UPDATE pedidos SET chofer_id=$2 WHERE id=$1',[second.pedido_id,driver.id]);
 return {checks,status:'passed',coverage:'HTTP whole-journey stop order, global-flag bypass rejection, UUID replay/conflict, shared-truck progression and changed-driver denial',synthetic:true};
};
