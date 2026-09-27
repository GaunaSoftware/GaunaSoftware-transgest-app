const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {createImportBatches}=require('../src/services/importBatches');
const {createImportEngine}=require('../src/services/importEngine');
(async()=>{
 const pg=new PGlite(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 try{
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY); CREATE TABLE usuarios(id uuid PRIMARY KEY);
      CREATE TABLE clientes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,cif text UNIQUE,direccion text,cp text,ciudad text,pais text,email text,telefono text,notas text);
      CREATE TABLE choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,dni text UNIQUE,telefono text,categoria_carnet text,activo boolean,notas text);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,matricula text UNIQUE,tipo text,marca text,modelo text,activo boolean,estado text,notas text);
      CREATE TABLE pedidos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,numero varchar(20),cliente_id uuid NOT NULL,
        origen text,destino text,fecha_carga date,hora_carga time,fecha_descarga date,fecha_entrega date,vehiculo_id uuid,remolque_id uuid,
        chofer_id uuid,colaborador_id uuid,mercancia text,peso_kg integer,bultos integer,km_ruta numeric,km_vacio numeric,importe numeric,
        precio_colaborador numeric,coste_gasoil numeric,coste_peajes numeric,coste_dietas numeric,coste_otros numeric,estado text,
        notas text,referencia_cliente text,origen_producto text);
      CREATE TABLE colaboradores(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,tipo text,nombre text,cif text UNIQUE,telefono text,email text,notas text);
      CREATE TABLE rutas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),origen text,destino text,km integer);
      CREATE TABLE ruta_precios_cliente(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ruta_id uuid,cliente_id uuid,precio numeric);
      CREATE TABLE docs_choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chofer_id uuid,tipo text,descripcion text,fecha_emision date,fecha_vencimiento date,referencia text);
      CREATE TABLE docs_vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehiculo_id uuid,tipo text,descripcion text,fecha_emision date,fecha_vencimiento date,referencia text);`);
    const migrations=path.join(__dirname,'migrations');
    for(const name of ['20260924_import_batches.sql','20260924_import_doc_metadata.sql','20260924_import_master_fields.sql','20260924_import_simulations.sql','20260924_import_tenant_keys.sql','20260924_import_costs.sql','20260924_import_history.sql','20260924_import_trips.sql','20260924_import_rollback.sql']) await pg.exec(fs.readFileSync(path.join(migrations,name),'utf8'));
    await pg.query('INSERT INTO empresas(id) VALUES($1),($2)',[a,b]);
    let queries=0;
    const query=(target,...args)=>{queries++;return target.query(...args);};
    const db={query:(...args)=>query(pg,...args),transaction:fn=>pg.transaction(tx=>fn({query:(...args)=>query(tx,...args)}))};
    const batches=createImportBatches(db),engine=createImportEngine(db),size=10001;
    const batch=await batches.createBatch({empresaId:a,tipo:'Clientes',filename:'synthetic-10001.csv',sourceSystem:'scale-test',fileBuffer:Buffer.from('synthetic fixture')});
    const start=performance.now();
    for(let offset=0;offset<size;offset+=500){
      const rows=Array.from({length:Math.min(500,size-offset)},(_,n)=>{const i=offset+n,data={source_id:`scale-${i}`,nombre:`Cliente sintético ${i}`,cif:`B${String(i).padStart(8,'0')}`};
       return{entity_type:'Clientes',row_number:i+2,source_data:data,normalized_data:data,status:'valid'};});
      await batches.stageRows(a,batch.id,rows);
    }
    await batches.sealBatch(a,batch.id,null);const staged=performance.now();
    const simulation=await engine.simulate(a,batch.id);assert.equal(simulation.new,size);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n,0);
    assert.equal((await batches.listRows(a,batch.id,{limit:50,offset:9950})).length,50);
    assert.equal((await batches.getBatch(a,batch.id)).total_rows,size);
    await assert.rejects(engine.confirm(b,batch.id,null),{status:404});
    const simulated=performance.now();
    // Simulate a persisted confirmed job recovered after process restart: no browser poll drives processing.
    await db.query("UPDATE import_batches SET status='running',started_at=NOW() WHERE id=$1",[batch.id]);
    await createImportEngine(db).resume();
    const deadline=Date.now()+240000;let finished;
    do{finished=await batches.getBatch(a,batch.id);if(finished.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
    assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(finished.created_rows,size);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM clientes WHERE empresa_id=$1',[a])).rows[0].n,size);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM clientes WHERE empresa_id=$1',[b])).rows[0].n,0);
    await createImportEngine(db).run(a,batch.id);assert.equal((await pg.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n,size);
    console.log(JSON.stringify({passed:true,synthetic:true,rows:size,queries,stage_ms:Math.round(staged-start),simulate_ms:Math.round(simulated-staged),run_ms:Math.round(performance.now()-simulated),paged_detail:50,recovered_without_browser:true,provider_calls:0},null,2));
 }finally{await pg.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
