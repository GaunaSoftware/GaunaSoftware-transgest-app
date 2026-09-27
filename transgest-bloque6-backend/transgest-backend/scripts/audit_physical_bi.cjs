const assert=require('node:assert/strict'),crypto=require('crypto');
module.exports=async({db,base,company,token})=>{
 const ids=Array.from({length:4},()=>crypto.randomUUID()),[customer,a,b,journey]=ids;
 await db.query("INSERT INTO clientes(id,empresa_id,nombre) VALUES($1,$2,'BI físico sintético')",[customer,company]);
 for(const [id,n] of [[a,1],[b,2]])await db.query("INSERT INTO pedidos(id,empresa_id,numero,cliente_id,estado,fecha_descarga,importe,peso_kg,bultos) VALUES($1,$2,$3,$4,'entregado','2026-09-20',$5,$5,$6)",[id,company,'QA-PHYSICAL-'+n,customer,n*500,n]);
 await db.query("INSERT INTO viajes_operativos(id,empresa_id,client_operation_uuid,estado,ejecucion,km_cargados,km_vacios) VALUES($1,$2,$3,'entregado','propia',800,200)",[journey,company,crypto.randomUUID()]);
 for(const id of [a,b])await db.query('INSERT INTO viaje_pedidos(empresa_id,viaje_id,pedido_id) VALUES($1,$2,$3)',[company,journey,id]);
 await db.query("INSERT INTO viaje_costes(empresa_id,viaje_id,client_operation_uuid,concepto,referencia,importe_neto,fecha) VALUES($1,$2,$3,'Coste de viaje sintético','QA-BI-PHYSICAL',1250,'2026-09-20')",[company,journey,crypto.randomUUID()]);
 const read=async(page=1)=>{const res=await fetch(base+'/informes/bi/workspace?periodo=personalizado&desde=2026-09-20&hasta=2026-09-20&cliente_id='+customer+'&limit=1&page='+page,{headers:{Authorization:'Bearer '+token}});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data;};
 const data=await read();assert.equal(data.economia.margen_directo,250);assert.equal(data.economia.ingreso_km_total,1.5);assert.equal(data.economia.kilometros.total,1000);assert.equal(data.servicios.total,2);assert.equal(data.servicios.rows.length,1);assert.equal((await read(2)).economia.margen_directo,250);assert.equal(data.evolucion[0].margen,250);assert.equal(data.matriz.cliente[0].margen_directo_registrado,250);assert.ok(data.economia.metricas.margen_directo.updated_at);assert.ok(data.economia.metricas.km_vacios_pct.drill_down);
 return {api:true,cardsSeriesMatrixReconciled:true,paginationIndependent:true,reference:{income:1500,cost:1250,loaded:800,empty:200}};
};
