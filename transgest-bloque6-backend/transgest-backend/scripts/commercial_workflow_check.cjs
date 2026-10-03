const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {customerNeedsReview}=require('../src/services/customerReview');
const {saveCommercialRoute}=require('../src/services/commercialRouteWrite');
const {routePerformance}=require('../src/services/routePerformance');
async function main(){
 const data={nombre:'Cliente',cif:'',email:'',telefono:'',ciudad:''};
 for(const rol of ['gerente','contable','administrativo'])assert.equal(customerNeedsReview({rol},data),false);
 assert.equal(customerNeedsReview({rol:'trafico'},data),true);
 assert.equal(customerNeedsReview({rol:'trafico'},{cif:'B12345678',email:'a@example.com',telefono:'1',cp:'12345',ciudad:'Madrid'}),false);
 const pg=new PGlite(), company='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', customer='33333333-3333-4333-8333-333333333333', point='44444444-4444-4444-8444-444444444444';
 try{
  await pg.exec(`CREATE TABLE clientes(id uuid PRIMARY KEY,empresa_id uuid,activo boolean DEFAULT true);
    CREATE TABLE puntos_interes(id uuid PRIMARY KEY,empresa_id uuid,activo boolean DEFAULT true);
    CREATE TABLE rutas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,cliente_id uuid,activa boolean,origen text,destino text,tipo_vehiculo text,tarifa_tipo text,notas text,observaciones_factura text,km numeric,peajes numeric,tiempo_h numeric,precio_base numeric,minimo_facturable numeric,minimo_unidades numeric,recargo_combustible_pct numeric,pct_subida numeric,origen_punto_id uuid,destino_punto_id uuid);
    CREATE TABLE ruta_precios_cliente(ruta_id uuid,cliente_id uuid,precio numeric,tarifa_tipo text,minimo_facturable numeric,minimo_unidades numeric,recargo_combustible_pct numeric,notas text,observaciones_factura text,origen_punto_id uuid,destino_punto_id uuid,UNIQUE(ruta_id,cliente_id));`);
  await pg.query('INSERT INTO clientes(id,empresa_id) VALUES($1,$2)',[customer,company]);
  await pg.query('INSERT INTO puntos_interes(id,empresa_id) VALUES($1,$2)',[point,company]);
  const query=(sql,params)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):pg.query(sql,params);
  const tx={query}, body={cliente_id:customer,origen:'Almacén',destino:'Obra',precio_base:'275,50',tarifa_tipo:'viaje',origen_punto_id:point,observaciones_factura:'Entrega concertada'};
  const inTransaction=(payload,id)=>pg.transaction(tr=>saveCommercialRoute({query:(sql,params)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):tr.query(sql,params)},company,payload,id));
  const created=await inTransaction(body);
  assert.equal(Number(created.precio_base),275.5);assert.equal(created.origen_punto_id,point);
  const same=await inTransaction(body);assert.equal(same.id,created.id);
  const updated=await inTransaction({tarifa_tipo:'tonelada',precio_base:22,minimo_unidades:24},created.id);
  assert.equal(updated.tarifa_tipo,'tonelada');assert.equal(updated.observaciones_factura,'Entrega concertada');
  const price=(await pg.query('SELECT * FROM ruta_precios_cliente')).rows[0];assert.equal(Number(price.precio),22);assert.equal(price.tarifa_tipo,'tonelada');
  await assert.rejects(()=>saveCommercialRoute(tx,other,{},created.id),e=>e.status===404);
  await assert.rejects(()=>saveCommercialRoute(tx,other,body),e=>e.status===404);
  await assert.rejects(()=>saveCommercialRoute(tx,company,{...body,precio_base:'NaN'}),e=>e.status===400);
  const result=routePerformance([{id:'a',paradas:[{tipo:'descarga',llegada_real_at:'2026-10-02T12:00:00Z',inicio_real_at:'2026-10-02T12:20:00Z',fin_real_at:'2026-10-02T13:00:00Z',progreso:{viaje_iniciado_at:'2026-10-02T09:00:00Z'}},{tipo:'descarga',inicio_real_at:'2026-10-02T14:00:00Z',fin_real_at:'2026-10-02T13:00:00Z'}]}]);
  assert.deepEqual(result.indicadores.descarga,{minutos:40,muestras:1});assert.deepEqual(result.indicadores.espera,{minutos:20,muestras:1});assert.equal(result.indicadores.trayecto.minutos,180);assert.equal(result.indicadores.carga.minutos,null);
  console.log('Commercial workflow: review roles, atomic rate changes, tenant guards, point links and recorded timings OK');
 }finally{await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
