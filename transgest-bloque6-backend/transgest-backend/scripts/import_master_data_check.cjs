const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { evaluateMaster, createMaster } = require('../src/services/importMasterData');

async function main() {
  const pg = new PGlite();
  const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
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
    const dir=path.join(__dirname,'migrations');
    for (const name of ['20260924_import_batches.sql','20260924_import_doc_metadata.sql','20260924_import_master_fields.sql','20260924_import_tenant_keys.sql','20260924_import_rollback.sql']) await pg.exec(fs.readFileSync(path.join(dir,name),'utf8'));
    await pg.query('INSERT INTO empresas(id) VALUES($1),($2)',[a,b]);
    const batch=(await pg.query("INSERT INTO import_batches(empresa_id,tipo,filename,source_system) VALUES($1,'Pack_TransGest','test.xlsx','old') RETURNING id",[a])).rows[0].id;
    let decision=await evaluateMaster(pg,a,'old','Clientes',{nombre:'Cliente A',cif:'B12345678'},'c1','a'.repeat(64));
    assert.equal(decision.action,'create');
    const client=await createMaster(pg,a,batch,'Clientes',{nombre:'Cliente A',cif:'B12345678'},decision);
    assert.equal((await evaluateMaster(pg,a,'old','Clientes',{nombre:'Otro',cif:'B12345678'},'c2','b'.repeat(64))).action,'skip');
    assert.equal((await evaluateMaster(pg,b,'old','Clientes',{nombre:'Cliente B',cif:'B12345678'},'c1','a'.repeat(64))).action,'create');
    decision=await evaluateMaster(pg,a,'old','Conductores',{nombre:'Ana María López',dni:'12345678Z',estado:'inactivo'},'d1','c'.repeat(64));
    const driver=await createMaster(pg,a,batch,'Conductores',{nombre:'Ana María López',dni:'12345678Z',estado:'inactivo'},decision);
    assert.equal((await pg.query('SELECT activo FROM choferes WHERE id=$1',[driver.id])).rows[0].activo,false);
    assert.equal((await evaluateMaster(pg,a,'old','Conductores',{nombre:'Otro',dni:'12345678-Z'},'d2','d'.repeat(64))).action,'skip');
    const vehicle=await createMaster(pg,a,batch,'Vehiculos',{matricula:'0009-LCZ'},await evaluateMaster(pg,a,'old','Vehiculos',{matricula:'0009-LCZ'},'v1','e'.repeat(64)));
    assert.equal((await evaluateMaster(pg,a,'old','Vehiculos',{matricula:'0009 LCZ'},'v2','f'.repeat(64))).action,'skip');
    decision=await evaluateMaster(pg,a,'old','Docs_Conductores',{chofer_dni:'12345678Z',tipo_doc:'contrato_laboral',estado_vencimiento:'PERMANENTE'},'doc1','g'.repeat(64));
    assert.equal(decision.parentId,driver.id);
    const doc=await createMaster(pg,a,batch,'Docs_Conductores',{chofer_dni:'12345678Z',tipo_doc:'contrato_laboral',estado_vencimiento:'PERMANENTE'},decision);
    assert.equal((await pg.query('SELECT fecha_vencimiento,estado_vencimiento FROM docs_choferes WHERE id=$1',[doc.id])).rows[0].estado_vencimiento,'PERMANENTE');
    assert.equal((await evaluateMaster(pg,a,'old','Docs_Conductores',{chofer_nombre:'Ana María López',tipo_doc:'cap'},'doc2','h'.repeat(64))).action,'review');
    assert.equal((await evaluateMaster(pg,a,'old','Docs_Vehiculos',{matricula:'0009LCZ',tipo_doc:'itv'},'doc3','i'.repeat(64))).parentId,vehicle.id);
    decision=await evaluateMaster(pg,a,'old','Tarifas',{cliente_cif:'B12345678',origen:'Madrid',destino:'Valencia',precio:300,km:350,unidad:'viaje'},'t1','j'.repeat(64));
    assert.equal(decision.action,'create');
    const tariff=await createMaster(pg,a,batch,'Tarifas',{cliente_cif:'B12345678',origen:'Madrid',destino:'Valencia',precio:300,km:350,unidad:'viaje'},decision);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM ruta_precios_cliente WHERE id=$1 AND cliente_id=$2',[tariff.id,client.id])).rows[0].n,1);
    assert.equal((await evaluateMaster(pg,a,'old','Tarifas',{cliente_cif:'B12345678',origen:'Madrid',destino:'Valencia',precio:400,km:350,unidad:'viaje'},'t2','k'.repeat(64))).action,'skip');
    console.log('PASS: client, inactive driver, normalized vehicle, permanent document, tariff, no name-only match, tenant isolation. Synthetic PGlite only.');
  } finally { await pg.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
