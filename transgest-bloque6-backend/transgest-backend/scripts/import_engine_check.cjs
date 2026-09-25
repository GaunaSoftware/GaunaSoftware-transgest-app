const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createImportBatches } = require('../src/services/importBatches');
const { createImportEngine } = require('../src/services/importEngine');
const { createImportRollback } = require('../src/services/importRollback');
const { createImportReports } = require('../src/services/importReports');
const { createImportHistoricalOverview } = require('../src/services/importHistoricalOverview');

async function main() {
  const pg=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  try {
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
    const db={query:(...args)=>pg.query(...args),transaction:async fn=>{
      await pg.exec('BEGIN');try{const result=await fn(pg);await pg.exec('COMMIT');return result;}catch(cause){await pg.exec('ROLLBACK');throw cause;}
    }};
    const batches=createImportBatches(db),engine=createImportEngine(db),rollback=createImportRollback(db),reports=createImportReports(db,batches),historical=createImportHistoricalOverview(db);
    const input=[
      {entity_type:'Clientes',row_number:2,source_data:{source_id:'c1',nombre:'Cliente A',cif:'B12345678'},normalized_data:{source_id:'c1',nombre:'Cliente A',cif:'B12345678'},status:'valid'},
      {entity_type:'Conductores',row_number:2,source_data:{source_id:'d1',nombre:'Ana',dni:'12345678Z',estado:'inactivo'},normalized_data:{source_id:'d1',nombre:'Ana',dni:'12345678Z',estado:'inactivo'},status:'valid'},
      {entity_type:'Docs_Conductores',row_number:2,source_data:{source_id:'doc1',chofer_dni:'12345678Z',tipo_doc:'contrato_laboral'},normalized_data:{source_id:'doc1',chofer_dni:'12345678Z',tipo_doc:'contrato_laboral',estado_vencimiento:'PERMANENTE'},status:'valid'},
    ];
    async function upload(company,rows=input) {
      const batch=await batches.createBatch({empresaId:company,tipo:'Pack_TransGest',filename:'test.xlsx',fileBuffer:Buffer.from('synthetic test'),sourceSystem:'old'});
      await batches.stageRows(company,batch.id,rows);
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
    const costRows=[
      {entity_type:'Vehiculos',row_number:2,source_data:{source_id:'v1',matricula:'0009-LCZ'},normalized_data:{source_id:'v1',matricula:'0009-LCZ'},status:'valid'},
      {entity_type:'Gastos_Operativos',row_number:2,source_data:{source_id:'g1',tipo:'combustible_agregado',matricula:'0009LCZ',periodo_desde:'2026-08-01',importe:300},normalized_data:{source_id:'g1',tipo:'combustible_agregado',matricula:'0009LCZ',periodo_desde:'2026-08-01',importe:300},status:'valid'},
      {entity_type:'Repostajes',row_number:2,source_data:{source_id:'r1',matricula:'0009LCZ',fecha:'2026-08-03',litros:30,importe:45},normalized_data:{source_id:'r1',matricula:'0009LCZ',fecha:'2026-08-03',litros:30,importe:45},status:'valid'},
      {entity_type:'Gastos_Estructura',row_number:2,source_data:{source_id:'s1',nombre:'Abono',fecha:'2026-08-31',importe:-20},normalized_data:{source_id:'s1',nombre:'Abono',fecha:'2026-08-31',importe:-20},status:'valid'},
    ];
    const costs=await upload(a,costRows);
    assert.equal((await engine.simulate(a,costs)).new,4);
    await engine.confirm(a,costs,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,costs)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,costs)).status,'completed');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM gastos_operativos')).rows[0].n,1);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM vehiculo_repostajes')).rows[0].n,1);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM gastos_estructura_movimientos')).rows[0].n,1);
    const historyRows=[
      {entity_type:'Facturas_Historicas',row_number:2,source_data:{source_id:'f1',numero_origen:'OLD-1',fecha:'2024-03-01',cliente_nombre:'Cliente A',cliente_cif:'B12345678',total:1210},normalized_data:{source_id:'f1',numero_origen:'OLD-1',fecha:'2024-03-01',cliente_nombre:'Cliente A',cliente_cif:'B12345678',total:1210},status:'valid'},
      {entity_type:'Facturas_Lineas',row_number:2,source_data:{source_id:'l1',factura_source_id:'f1',linea:1,importe:1000},normalized_data:{source_id:'l1',factura_source_id:'f1',linea:1,importe:1000},status:'valid'},
      {entity_type:'Facturas_Pendientes',row_number:2,source_data:{source_id:'p1',numero_origen:'OLD-OPEN',cliente_nombre:'Cliente A',total:1210,cobrado:605},normalized_data:{source_id:'p1',numero_origen:'OLD-OPEN',cliente_nombre:'Cliente A',total:1210,cobrado:605},status:'valid'},
    ];
    const history=await upload(a,historyRows);
    assert.equal((await engine.simulate(a,history)).new,3);
    await engine.confirm(a,history,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,history)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,history)).status,'completed');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM import_factura_lineas_historicas')).rows[0].n,1);
    assert.equal(Number((await pg.query('SELECT saldo_pendiente FROM import_saldos_pendientes')).rows[0].saldo_pendiente),605);
    const historicalReport=await historical.overview(a,history);
    assert.equal(Number(historicalReport.facturas.total_origen),1210);
    assert.equal(Number(historicalReport.lineas.importe_lineas_origen),1000);
    assert.equal(Number(historicalReport.saldos.saldo_de_origen),605);
    assert.equal((await historical.overview(b,history)).facturas.documentos,0);
    const tripRows=[
      {entity_type:'Viajes_Historicos',row_number:2,source_data:{source_id:'old-trip',cliente_nombre:'Cliente A',origen:'Madrid',destino:'Valencia',fecha_carga:'2024-01-01',estado:'entregado'},normalized_data:{source_id:'old-trip',cliente_nombre:'Cliente A',origen:'Madrid',destino:'Valencia',fecha_carga:'2024-01-01',estado:'entregado'},status:'valid'},
      {entity_type:'Viajes_Pendientes',row_number:2,source_data:{source_id:'pending-trip',cliente_nombre:'Cliente A',cliente_cif:'B12345678',origen:'Madrid',destino:'Valencia',fecha_carga:'2026-10-01'},normalized_data:{source_id:'pending-trip',cliente_nombre:'Cliente A',cliente_cif:'B12345678',origen:'Madrid',destino:'Valencia',fecha_carga:'2026-10-01'},status:'valid'},
    ];
    const trips=await upload(a,tripRows);
    assert.equal((await engine.simulate(a,trips)).new,2);
    await engine.confirm(a,trips,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,trips)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,trips)).status,'completed');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM import_viajes_historicos')).rows[0].n,1);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM pedidos')).rows[0].n,1);
    const rollbackBatch=await upload(a,[
      {entity_type:'Conductores',row_number:2,source_data:{source_id:'rollback-driver',nombre:'Prueba Reversión',dni:'87654321X'},normalized_data:{source_id:'rollback-driver',nombre:'Prueba Reversión',dni:'87654321X'},status:'valid'},
      {entity_type:'Docs_Conductores',row_number:2,source_data:{source_id:'rollback-doc',chofer_dni:'87654321X',tipo_doc:'cap'},normalized_data:{source_id:'rollback-doc',chofer_dni:'87654321X',tipo_doc:'cap'},status:'valid'},
    ]);
    assert.equal((await engine.simulate(a,rollbackBatch)).new,2);
    await engine.confirm(a,rollbackBatch,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,rollbackBatch)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,rollbackBatch)).status,'completed');
    await pg.exec('ALTER TABLE docs_choferes ADD CONSTRAINT test_rollback_driver_fk FOREIGN KEY (chofer_id) REFERENCES choferes(id)');
    const driver=(await pg.query('SELECT id FROM choferes WHERE dni=$1',['87654321X'])).rows[0];
    const outsider=(await pg.query("INSERT INTO docs_choferes(chofer_id,tipo) VALUES($1,'externo') RETURNING id",[driver.id])).rows[0];
    assert.equal((await rollback.simulate(a,rollbackBatch)).bloqueados,1);
    await assert.rejects(rollback.confirm(a,rollbackBatch,null),{status:409});
    await pg.query('DELETE FROM docs_choferes WHERE id=$1',[outsider.id]);
    assert.equal((await rollback.simulate(a,rollbackBatch)).revertibles,2);
    await assert.rejects(rollback.simulate(b,rollbackBatch),{status:404});
    await pg.query('UPDATE choferes SET nombre=$2 WHERE id=$1',[driver.id,'Modificado después']);
    assert.equal((await rollback.simulate(a,rollbackBatch)).bloqueados,1);
    await pg.query('UPDATE choferes SET nombre=$2 WHERE id=$1',[driver.id,'Prueba Reversión']);
    const undone=await rollback.confirm(a,rollbackBatch,null);
    assert.equal(undone.status,'rolled_back');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM choferes WHERE dni=$1',['87654321X'])).rows[0].n,0);
    const cancelled=await upload(a,[{entity_type:'Clientes',row_number:2,
      source_data:{source_id:'cancel-test',nombre:'Cancelado',cif:'B88888888'},
      normalized_data:{source_id:'cancel-test',nombre:'Cancelado',cif:'B88888888'},status:'valid'}]);
    await engine.simulate(a,cancelled);
    assert.equal((await engine.cancel(a,cancelled,null)).status,'cancelled');
    assert.equal((await engine.continueBatch(a,cancelled,null)).status,'running');
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,cancelled)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,cancelled)).created_rows,1);
    assert.equal((await reports.report(a,cancelled)).summary.find(item=>item.status==='created').count,1);
    assert.equal((await reports.errorsCsv(a,cancelled)).split('\r\n').length,2);
    assert.ok((await reports.reportXlsx(a,cancelled)).length>1000);
    await assert.rejects(reports.report(b,cancelled),{status:404});
    const retryBatch=await upload(a,[{entity_type:'Clientes',row_number:2,
      source_data:{source_id:'retry-test',nombre:'Reintentar',cif:'B77777777'},
      normalized_data:{source_id:'retry-test',nombre:'Reintentar',cif:'B77777777'},status:'valid'}]);
    await engine.simulate(a,retryBatch);
    await pg.exec("ALTER TABLE clientes ADD CONSTRAINT import_retry_test CHECK (nombre <> 'Reintentar')");
    await engine.confirm(a,retryBatch,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,retryBatch)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,retryBatch)).status,'completed_with_errors');
    assert.match(await reports.errorsCsv(a,retryBatch),/Reintentar/);
    await pg.exec('ALTER TABLE clientes DROP CONSTRAINT import_retry_test');
    assert.equal((await engine.retryErrors(a,retryBatch,null)).retried,1);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,retryBatch)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,retryBatch)).status,'completed');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM clientes WHERE cif=$1',['B77777777'])).rows[0].n,1);
    const tariffBatch=await upload(a,[{entity_type:'Tarifas',row_number:2,
      source_data:{source_id:'tariff-rollback',cliente_cif:'B12345678',origen:'Madrid',destino:'Sevilla',km:540,precio:500},
      normalized_data:{source_id:'tariff-rollback',cliente_cif:'B12345678',origen:'Madrid',destino:'Sevilla',km:540,precio:500},status:'valid'}]);
    assert.equal((await engine.simulate(a,tariffBatch)).new,1);
    await engine.confirm(a,tariffBatch,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,tariffBatch)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await rollback.simulate(a,tariffBatch)).revertibles,1);
    await rollback.confirm(a,tariffBatch,null);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM rutas WHERE destino='Sevilla'")).rows[0].n,0);
    await assert.rejects(engine.simulate(b,id),{status:404});
    console.log('PASS: dry-run, async processing, idempotence, cancellation/resume, retry, guarded rollback, reports and company isolation. Synthetic PGlite only.');
  } finally { await pg.close(); }
}
main().catch(cause=>{console.error(cause);process.exitCode=1;});
