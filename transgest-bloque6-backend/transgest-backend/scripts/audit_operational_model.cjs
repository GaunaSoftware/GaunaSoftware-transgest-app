const assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async function({base,fetch,db,managerToken,driverToken,company}){
 assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/);let checks=0;
 async function call(path,token,status=200,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));checks++;return {data,response};
 }
 const id=crypto.randomUUID(),foreign=crypto.randomUUID(),operation=crypto.randomUUID();
 const other=(await db.query("SELECT id FROM empresas WHERE nombre='CT aislado B'")).rows[0].id;
 await db.query(`INSERT INTO pedidos(id,empresa_id,cliente_id,numero,estado,origen,destino,importe)
   SELECT $1,$2,id,'QA-MODEL','confirmado','Valencia','Madrid',400 FROM clientes WHERE empresa_id=$2 ORDER BY id LIMIT 1`,[id,company]);
 // Tenant constraints are checked independently of a foreign master record.
 await db.query(`INSERT INTO pedidos(id,empresa_id,numero,estado,origen,destino,cliente_id)
   SELECT $1,$2,'QA-MODEL-B','confirmado','B','B',cliente_id FROM pedidos WHERE id=$3`,[foreign,other,id]);
 const before=(await db.query('SELECT * FROM pedidos WHERE id=$1',[id])).rows[0];
 assert.equal((await call(`/pedidos/${id}/operativa`,managerToken)).data.origen,'legacy');
 await call(`/pedidos/${id}/operativa`,driverToken,403);
 await call(`/pedidos/${id}/operativa`,driverToken,403,{client_operation_uuid:operation});
 await call(`/pedidos/${foreign}/operativa?empresa_id=${other}`,managerToken,404);
 await call(`/pedidos/${foreign}/operativa`,managerToken,404,{client_operation_uuid:operation,empresa_id:other});
 await call(`/pedidos/${id}/operativa`,managerToken,400,{client_operation_uuid:'bad'});
 const first=await call(`/pedidos/${id}/operativa`,managerToken,201,{client_operation_uuid:operation});
 const retry=await call(`/pedidos/${id}/operativa`,managerToken,200,{client_operation_uuid:operation});
 assert.equal(retry.data.viaje_id,first.data.viaje_id);assert.equal(retry.data.created,false);
 const normalized=await call(`/pedidos/${id}/operativa`,managerToken);
 assert.equal(normalized.response.headers.get('cache-control'),'private, no-store');
 assert.equal(normalized.data.viajes[0].paradas.length,2);assert.equal(normalized.data.viajes[0].envios.length,1);
 assert.deepEqual((await db.query('SELECT * FROM pedidos WHERE id=$1',[id])).rows[0],before);
 return {checks,status:'passed',mode:'synthetic HTTP; real role/module/tenant guards; no historical mutation'};
};
