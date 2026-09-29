const assert=require('node:assert/strict'),crypto=require('crypto');
module.exports=async({db,base,company,user,token,password})=>{
 let checks=0;async function call(method,path,body,status=200,auth=token){body=await require('./audit_company_login.cjs')(db,path,body);const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));checks++;return v;}
 const client=crypto.randomUUID(),order=crypto.randomUUID();await db.query("INSERT INTO clientes(id,empresa_id,nombre,cif,tipo_iva,direccion,cp,ciudad,codigo_postal,municipio,pais) VALUES($1,$2,'Cliente workflow sintético','B99999999',21,'Calle sintética 1','46001','Valencia','46001','Valencia','España')",[client,company]);
 await db.query("INSERT INTO pedidos(id,empresa_id,numero,cliente_id,origen,destino,estado,importe,importe_revision_combustible,fecha_carga,referencia_cliente) VALUES($1,$2,'QA-WORKFLOW',$3,'Valencia','Madrid','en_curso',110,10,CURRENT_DATE,'REF-QA')",[order,company,client]);
 const path='/facturas/operativa';let rules={hito:'departure',exigir_pod:false,exigir_deca:false,bloquear_incidencia:true};await call('PUT',path+'/reglas/'+client,rules);
 const list=()=>call('GET',path+'?cliente_id='+client);let row=(await list()).data[0];assert.equal(row.estado,'excepcion');assert.equal(row.eligible,false);
 await db.query("INSERT INTO pedido_chofer_pasos(empresa_id,pedido_id,data) VALUES($1,$2,'{\"viaje_iniciado\":true}')",[company,order]);
 row=(await list()).data[0];assert.equal(row.estado,'revisar');assert.equal(row.eligible,true);
 await call('POST',path+'/'+order+'/revisar',{confirmado:false,huella:row.huella},400);await call('POST',path+'/'+order+'/revisar',{confirmado:true,huella:'vieja'},409);
 const review=()=>call('POST',path+'/'+order+'/revisar',{confirmado:true,huella:row.huella});await review();await review();assert.equal((await db.query("SELECT count(*)::int n FROM invoice_operational_events WHERE pedido_id=$1 AND evento='revision'",[order])).rows[0].n,1);
 const other=(await call('POST','/auth/login',{email:'planner-b@example.invalid',password})).token;await call('POST',path+'/'+order+'/revisar',{confirmado:true,huella:row.huella},404,other);await call('PUT',path+'/reglas/'+client,rules,404,other);await call('POST','/facturas',{workflow_pedidos_ids:[order]},400,other);
 await db.query('UPDATE pedidos SET importe=120 WHERE id=$1',[order]);await call('POST','/facturas',{workflow_pedidos_ids:[order]},409);row=(await list()).data[0];await review();
 const invoice=await call('POST','/facturas',{workflow_pedidos_ids:[order]},201);assert.equal((await call('POST','/facturas',{workflow_pedidos_ids:[order]},201)).id,invoice.id);assert.equal(Number(invoice.base_imponible),120);assert.equal(Number(invoice.total),145.2);
 const lines=(await db.query('SELECT concepto,importe FROM factura_lineas WHERE factura_id=$1 ORDER BY orden',[invoice.id])).rows;assert.equal(lines.length,2);assert.equal(Number(lines[0].importe),110);assert.equal(Number(lines[1].importe),10);assert.match(lines[1].concepto,/combustible/i);
 await call('POST','/facturas/'+invoice.id+'/revision',{confirmado:true});
 // Client policy edits must invalidate old review before issue.
 await call('PUT',path+'/reglas/'+client,{...rules,exigir_deca:true});await call('PATCH','/facturas/'+invoice.id+'/estado',{estado:'emitida'},409);
 await call('PUT',path+'/reglas/'+client,rules);await call('POST','/facturas/'+invoice.id+'/revision',{confirmado:true});await call('PATCH','/facturas/'+invoice.id+'/estado',{estado:'emitida'});
 assert.equal((await db.query('SELECT estado FROM pedidos WHERE id=$1',[order])).rows[0].estado,'en_curso','billing departure cannot invent delivery');
 await call('POST','/facturas',{workflow_pedidos_ids:[order]},400);assert.equal((await list()).data.length,0);
 const both=await Promise.all([1,2].map(n=>call('POST','/facturas',{cliente_id:client,serie:'A',lineas:[{concepto:'Servicio sintético '+n,cantidad:1,precio_unit:10}]},201)));assert.notEqual(both[0].numero,both[1].numero);
 const view=(await call('POST','/auth/login',{email:'supplier-viewer@example.invalid',password})).token;await call('GET',path,null,403,view);
 return {checks,policyCutoff:true,actualDeparture:true,staleReview:true,tenant:true,oneCost:true,concurrentNumberRequests:true,mode:'PGlite HTTP; native process concurrency remains deployment QA'};
};
