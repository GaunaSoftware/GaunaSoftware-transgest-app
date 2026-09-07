const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { ensurePointIdentitySchema } = require('../src/services/pointIdentity');
const db = require('../src/services/db');
const queue = require('../src/services/deliveryAutomationQueue');

async function main() {
  const pg = new PGlite();
  const originalQuery=db.query, originalTransaction=db.transaction;
  const empresa='11111111-1111-4111-8111-111111111111';
  const cliente='22222222-2222-4222-8222-222222222222';
  const cliente2='33333333-3333-4333-8333-333333333333';
  const adapt=client=>({query:async(sql,params)=>{const result=await client.query(sql,params);return {...result,rowCount:result.affectedRows};}});
  db.query=adapt(pg).query;
  db.transaction=callback=>pg.transaction(client=>callback(adapt(client)));
  try {
    await pg.exec(`CREATE TABLE puntos_interes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID, cliente_id UUID,
      direccion TEXT, ciudad TEXT, provincia TEXT, pais TEXT, activo BOOLEAN DEFAULT true, notas TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    const insert=(dir,city,owner=cliente)=>pg.query(`INSERT INTO puntos_interes (empresa_id,cliente_id,direccion,ciudad,provincia,pais)
      VALUES ($1,$2,$3,$4,'Alicante','España') RETURNING id`,[empresa,owner,dir,city]);
    await insert('Calle Málaga 1','San Vicente del Raspeig');
    await insert('CALLE MALAGA   1','San Vicente del Raspeig');
    await insert('Calle Málaga 1','Benissa');
    await insert('Calle Málaga 1','San Vicente del Raspeig',cliente2);
    await insert('Calle Málaga 1','San Vicente del Raspeig',null);
    await ensurePointIdentitySchema(db);
    assert.equal((await pg.query('SELECT count(*)::int AS total FROM puntos_interes WHERE activo')).rows[0].total,4);
    await assert.rejects(insert('Calle Malaga 1','San Vicente del Raspeig'),error=>error.code==='23505');
    await insert('Calle Malaga 2','San Vicente del Raspeig');
    await ensurePointIdentitySchema(db);
    assert.equal((await pg.query('SELECT count(*)::int AS total FROM puntos_interes WHERE activo')).rows[0].total,5);
    await pg.exec(`CREATE TABLE clientes(id UUID PRIMARY KEY, empresa_id UUID);
      CREATE TABLE rutas(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), origen TEXT, destino TEXT, km NUMERIC, notas TEXT,
        empresa_id UUID, cliente_id UUID, tipo_vehiculo TEXT, tarifa_tipo TEXT, precio_base NUMERIC,
        minimo_facturable NUMERIC, minimo_unidades NUMERIC, recargo_combustible_pct NUMERIC, activa BOOLEAN DEFAULT true);
      CREATE TABLE ruta_precios_cliente(ruta_id UUID, cliente_id UUID, precio NUMERIC CHECK(precio>=0),
        tarifa_tipo TEXT, minimo_facturable NUMERIC, minimo_unidades NUMERIC, recargo_combustible_pct NUMERIC, UNIQUE(ruta_id,cliente_id))`);
    await pg.query('INSERT INTO clientes VALUES($1,$2)',[cliente,empresa]);
    const clientesRouter=require('../src/routes/clientes');
    const saveRoute=clientesRouter.stack.find(layer=>layer.route?.path==='/:id/rutas' && layer.route.methods.post).route.stack.at(-1).handle;
    const save=async(destino,precio)=>{
      const response={code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
      await saveRoute({params:{id:cliente},user:{empresa_id:empresa},body:{origen:'Madrid',destino,precio_base:precio,tarifa_tipo:'viaje'}},response);
      return response;
    };
    const first=await save('Málaga',100);
    assert.equal(first.code,201);
    const second=await save(' MALAGA ',120);
    assert.equal(second.data.ruta_id,first.data.ruta_id);
    assert.equal((await pg.query('SELECT precio FROM ruta_precios_cliente')).rows[0].precio,'120');
    assert.equal((await save('Vigo',-1)).code,500);
    assert.equal((await pg.query('SELECT count(*)::int AS total FROM rutas')).rows[0].total,1);
    const pedido='44444444-4444-4444-8444-444444444444';
    await queue.enqueue(pedido,empresa,null,{});
    await queue.enqueue(pedido,empresa,null,{});
    assert.equal((await pg.query('SELECT count(*)::int AS total FROM pedido_entrega_jobs')).rows[0].total,1);
    let fail=true;
    queue.start(async()=>{ if(fail) throw new Error('Fallo simulado de factura'); });
    for (let attempt=0;attempt<100;attempt++) {
      const row=(await pg.query('SELECT * FROM pedido_entrega_jobs')).rows[0];
      if(row.error) break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    await queue.processPending();
    const failed=(await pg.query('SELECT * FROM pedido_entrega_jobs')).rows[0];
    assert.equal(failed.error,'Fallo simulado de factura');
    assert.equal(failed.completado_at,null);
    fail=false;
    await pg.query('UPDATE pedido_entrega_jobs SET disponible_at=NOW()');
    await queue.processPending();
    assert.ok((await pg.query('SELECT completado_at FROM pedido_entrega_jobs')).rows[0].completado_at);
    let requeued=false;
    queue.start(async()=>{
      if (!requeued) { requeued=true; await queue.enqueue(pedido,empresa,null,{changed:true}); }
    });
    await queue.enqueue(pedido,empresa,null,{});
    for (let attempt=0;attempt<100 && !requeued;attempt++) await new Promise(resolve=>setTimeout(resolve,20));
    await queue.processPending();
    assert.equal((await pg.query('SELECT completado_at FROM pedido_entrega_jobs')).rows[0].completado_at,null);
    await pg.query('UPDATE pedido_entrega_jobs SET disponible_at=NOW()');
    await queue.processPending();
    assert.ok((await pg.query('SELECT completado_at FROM pedido_entrega_jobs')).rows[0].completado_at);
    console.log('OK PostgreSQL: duplicados aislados, migracion idempotente, cola persistente y reintento de factura');
  } finally {
    await queue.stop(); db.query=originalQuery; db.transaction=originalTransaction; await pg.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
