const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {evaluateTrip,createTrip}=require('../src/services/importTrips');
async function main(){
  const pg=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  const batch='33333333-3333-4333-8333-333333333333';
  try{
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY);CREATE TABLE usuarios(id uuid PRIMARY KEY);
      CREATE TABLE clientes(id uuid PRIMARY KEY,empresa_id uuid,cif text,nombre text);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY,empresa_id uuid,matricula text);
      CREATE TABLE choferes(id uuid PRIMARY KEY,empresa_id uuid,dni text);
      CREATE TABLE colaboradores(id uuid PRIMARY KEY,empresa_id uuid,cif text);
      CREATE TABLE pedidos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,numero varchar(20),cliente_id uuid NOT NULL,
        origen text,destino text,fecha_carga date,hora_carga time,fecha_descarga date,fecha_entrega date,vehiculo_id uuid,remolque_id uuid,
        chofer_id uuid,colaborador_id uuid,mercancia text,peso_kg integer,bultos integer,km_ruta numeric,km_vacio numeric,importe numeric,
        precio_colaborador numeric,coste_gasoil numeric,coste_peajes numeric,coste_dietas numeric,coste_otros numeric,estado text,
        notas text,referencia_cliente text,origen_producto text);
      INSERT INTO empresas VALUES('${a}'),('${b}');
      INSERT INTO clientes VALUES('44444444-4444-4444-8444-444444444444','${a}','A12345678','Cliente A'),
        ('55555555-5555-4555-8555-555555555555','${b}','A12345678','Cliente B');
      INSERT INTO vehiculos VALUES('66666666-6666-4666-8666-666666666666','${a}','0009-LCZ');
      INSERT INTO choferes VALUES('77777777-7777-4777-8777-777777777777','${a}','12826758A');`);
    for(const name of ['20260924_import_batches.sql','20260924_import_trips.sql'])await pg.exec(fs.readFileSync(path.join(__dirname,'migrations',name),'utf8'));
    await pg.query("INSERT INTO import_batches(id,empresa_id,tipo,filename,source_system) VALUES($1,$2,'Pack_TransGest','synthetic.xlsx','old')",[batch,a]);
    const source={source_id:'t1',numero_origen:'OLD-99',cliente_nombre:'Cliente A',cliente_cif:'A12345678',origen:'Madrid',destino:'Valencia',fecha_carga:'2024-08-01',fecha_descarga:'2024-08-02',matricula_tractora:'0009LCZ',chofer_dni:'12826758A',importe:500,estado:'entregado'};
    const historical=await evaluateTrip(pg,a,'old','Viajes_Historicos',source,'t1');
    assert.equal(historical.action,'create');
    const historic=await createTrip(pg,a,batch,'old','Viajes_Historicos',source,historical);
    assert.equal(historic.table,'import_viajes_historicos');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM pedidos')).rows[0].n,0,'Historical trip must not appear as active order');
    assert.equal((await evaluateTrip(pg,a,'old','Viajes_Historicos',source,'t1')).action,'skip');
    const pending={...source,source_id:'t2',estado:'pendiente',fecha_carga:'2026-10-01',fecha_descarga:'2026-10-02'};
    const decision=await evaluateTrip(pg,a,'old','Viajes_Pendientes',pending,'t2');
    assert.equal(decision.action,'create');
    const created=await createTrip(pg,a,batch,'old','Viajes_Pendientes',pending,decision);
    assert.equal(created.table,'pedidos');
    const row=(await pg.query('SELECT numero,estado,vehiculo_id,chofer_id,migration_source_id FROM pedidos WHERE id=$1',[created.id])).rows[0];
    assert.equal(row.numero.length,20);
    assert.equal(row.estado,'pendiente');assert.equal(row.migration_source_id,'t2');
    assert.ok(row.vehiculo_id);assert.ok(row.chofer_id);
    assert.equal((await evaluateTrip(pg,a,'old','Viajes_Pendientes',pending,'t2')).action,'skip');
    assert.equal((await evaluateTrip(pg,b,'old','Viajes_Pendientes',pending,'t2')).action,'review','Cannot borrow vehicle across companies');
    assert.equal((await evaluateTrip(pg,a,'old','Viajes_Pendientes',{...pending,peso_kg:24.2},'t3')).action,'review');
    console.log('PASS: historical trips isolated from live orders, pending trip direct insert, idempotence, tenant resources and numeric validation. Synthetic PGlite only.');
  }finally{await pg.close();}
}
main().catch(cause=>{console.error(cause);process.exitCode=1;});
