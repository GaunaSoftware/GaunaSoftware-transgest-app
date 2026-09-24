const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createImportBatches } = require('../src/services/importBatches');
const { createImportEngine } = require('../src/services/importEngine');

async function main() {
  const pg=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  try {
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY); CREATE TABLE usuarios(id uuid PRIMARY KEY);
      CREATE TABLE clientes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,cif text UNIQUE,direccion text,cp text,ciudad text,pais text,email text,telefono text,notas text);
      CREATE TABLE choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,dni text UNIQUE,telefono text,categoria_carnet text,activo boolean,notas text);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,matricula text UNIQUE,tipo text,marca text,modelo text,activo boolean,estado text,notas text);
      CREATE TABLE colaboradores(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,tipo text,nombre text,cif text UNIQUE,telefono text,email text,notas text);
      CREATE TABLE rutas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),origen text,destino text,km integer);
      CREATE TABLE ruta_precios_cliente(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ruta_id uuid,cliente_id uuid,precio numeric);
      CREATE TABLE docs_choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chofer_id uuid,tipo text,descripcion text,fecha_emision date,fecha_vencimiento date,referencia text);
      CREATE TABLE docs_vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehiculo_id uuid,tipo text,descripcion text,fecha_emision date,fecha_vencimiento date,referencia text);`);
    const migrations=path.join(__dirname,'migrations');
    for(const name of ['20260924_import_batches.sql','20260924_import_doc_metadata.sql','20260924_import_master_fields.sql','20260924_import_simulations.sql','20260924_import_tenant_keys.sql']) await pg.exec(fs.readFileSync(path.join(migrations,name),'utf8'));
    await pg.query('INSERT INTO empresas(id) VALUES($1),($2)',[a,b]);
    const db={query:(...args)=>pg.query(...args),transaction:async fn=>{
      await pg.exec('BEGIN');try{const result=await fn(pg);await pg.exec('COMMIT');return result;}catch(cause){await pg.exec('ROLLBACK');throw cause;}
    }};
    const batches=createImportBatches(db),engine=createImportEngine(db);
    const input=[
      {entity_type:'Clientes',row_number:2,source_data:{source_id:'c1',nombre:'Cliente A',cif:'B12345678'},normalized_data:{source_id:'c1',nombre:'Cliente A',cif:'B12345678'},status:'valid'},
      {entity_type:'Conductores',row_number:2,source_data:{source_id:'d1',nombre:'Ana',dni:'12345678Z',estado:'inactivo'},normalized_data:{source_id:'d1',nombre:'Ana',dni:'12345678Z',estado:'inactivo'},status:'valid'},
      {entity_type:'Docs_Conductores',row_number:2,source_data:{source_id:'doc1',chofer_dni:'12345678Z',tipo_doc:'contrato_laboral'},normalized_data:{source_id:'doc1',chofer_dni:'12345678Z',tipo_doc:'contrato_laboral',estado_vencimiento:'PERMANENTE'},status:'valid'},
    ];
    async function upload(company) {
      const batch=await batches.createBatch({empresaId:company,tipo:'Pack_TransGest',filename:'test.xlsx',fileBuffer:Buffer.from('synthetic test'),sourceSystem:'old'});
      await batches.stageRows(company,batch.id,input);
      await batches.sealBatch(company,batch.id,null);
      return batch.id;
    }
    const id=await upload(a);
    await assert.rejects(engine.confirm(a,id,null),{status:409});
    const preview=await engine.simulate(a,id);
    assert.equal(preview.new,3);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM choferes')).rows[0].n,0);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM docs_choferes')).rows[0].n,0);
    await engine.confirm(a,id,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,id)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    const result=await batches.getBatch(a,id);
    assert.equal(result.status,'completed',JSON.stringify(result));
    assert.equal(result.created_rows,3);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM import_identities')).rows[0].n,3);
    assert.equal((await pg.query('SELECT activo FROM choferes WHERE empresa_id=$1',[a])).rows[0].activo,false);
    const second=await upload(a);
    const preview2=await engine.simulate(a,second);
    assert.equal(preview2.existing,3);
    await engine.confirm(a,second,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,second)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,second)).skipped_rows,3);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n,1);
    await assert.rejects(engine.simulate(b,id),{status:404});
    console.log('PASS: mandatory dry-run without target writes, deferred document match, asynchronous confirmation, repeated batch idempotence, company isolation. Synthetic PGlite only.');
  } finally { await pg.close(); }
}
main().catch(cause=>{console.error(cause);process.exitCode=1;});
