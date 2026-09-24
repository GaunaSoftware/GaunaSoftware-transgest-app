const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {createImportBatches}=require('../src/services/importBatches');
const {createImportDocuments,parsePackage,identityFromFilename}=require('../src/services/importDocuments');
const {DatabaseDocumentStorageProvider}=require('../src/services/DocumentStorageProvider');
const {createImportRollback}=require('../src/services/importRollback');

const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
function zipSingle(name,content){
  const filename=Buffer.from(name);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
  local.writeUInt32LE(content.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt32LE(content.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(filename.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(local.length+filename.length+content.length,16);
  return Buffer.concat([local,filename,content,central,filename,end]);
}
async function main(){
  const pg=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  try{
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY); CREATE TABLE usuarios(id uuid PRIMARY KEY);
      CREATE TABLE choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,dni text,nombre text);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,matricula text);
      CREATE TABLE docs_choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chofer_id uuid,tipo text,descripcion text,fecha_emision date,fecha_vencimiento date,referencia text,file_url text);
      CREATE TABLE docs_vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehiculo_id uuid,tipo text,descripcion text,fecha_emision date,fecha_vencimiento date,referencia text,file_url text);
      CREATE TABLE ruta_precios_cliente(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      INSERT INTO empresas VALUES('${a}'),('${b}');
      INSERT INTO choferes(empresa_id,dni,nombre) VALUES('${a}','12826758A','Ana'),('${b}','12826758A','Otra');
      INSERT INTO vehiculos(empresa_id,matricula) VALUES('${a}','0009-LCZ'),('${b}','0009-LCZ');`);
    for(const name of ['20260924_import_batches.sql','20260924_import_simulations.sql','20260924_import_doc_metadata.sql','20260924_import_document_blobs.sql','20260924_import_rollback.sql'])
      await pg.exec(fs.readFileSync(path.join(__dirname,'migrations',name),'utf8'));
    const db={query:(...args)=>pg.query(...args),transaction:async fn=>{await pg.exec('BEGIN');try{const value=await fn(pg);await pg.exec('COMMIT');return value;}catch(cause){await pg.exec('ROLLBACK');throw cause;}}};
    const batches=createImportBatches(db),storage=new DatabaseDocumentStorageProvider(db),documents=createImportDocuments(db,batches,storage),rollback=createImportRollback(db);
    assert.equal(identityFromFilename('CHOFER_12826758A_CONTRATO.pdf').type,'contrato_laboral');
    assert.equal(identityFromFilename('VEH_0009LCZ_ITV.pdf').scope,'vehiculo');
    assert.ok(identityFromFilename('desconocido.pdf').error);
    assert.throws(()=>parsePackage(Buffer.from('fake'),'lote.zip'),{code:'ZIP_INVALID'});
    assert.equal(parsePackage(zipSingle('CHOFER_12826758A_CAP.pdf',pdf),'lote.zip').length,1);
    assert.throws(()=>parsePackage(zipSingle('../evil.pdf',pdf),'lote.zip'),{code:'ZIP_ENTRY'});
    const manifest=Buffer.from(JSON.stringify({files:[{name:'CHOFER_12826758A_CAP.pdf',size:pdf.length},{name:'VEH_0009LCZ_ITV.pdf',size:pdf.length}]}));
    const packetHead=Buffer.alloc(10);packetHead.write('TGDP1\n');packetHead.writeUInt32BE(manifest.length,6);
    assert.equal(parsePackage(Buffer.concat([packetHead,manifest,pdf,pdf]),'multi.tgdp').length,2);
    const id=await documents.stage({empresaId:a,filename:'CHOFER_12826758A_CAP.pdf',buffer:pdf});
    const preview=await documents.simulate(a,id);
    assert.equal(preview.new,1);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM docs_choferes')).rows[0].n,0,'Preview is not a business write');
    await documents.confirm(a,id,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,id)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,id)).status,'completed',JSON.stringify((await pg.query('SELECT status,error_code,error_message FROM import_rows WHERE batch_id=$1',[id])).rows));
    const created=(await pg.query('SELECT storage_key,chofer_id FROM docs_choferes')).rows[0];
    assert.ok(created.storage_key.startsWith('db:'));
    assert.ok((await storage.read(a,created.storage_key)).content.length===pdf.length);
    assert.equal(await storage.read(b,created.storage_key),null,'Other company cannot read stored PDF');
    const vehicle=(await pg.query('SELECT id FROM vehiculos WHERE empresa_id=$1',[a])).rows[0].id;
    await pg.query("INSERT INTO docs_vehiculos(empresa_id,vehiculo_id,tipo,tipo_doc,archivo_nombre) VALUES($1,$2,'otro','itv','VEH_0009LCZ_ITV.pdf')",[a,vehicle]);
    const id2=await documents.stage({empresaId:a,filename:'VEH_0009LCZ_ITV.pdf',buffer:pdf});
    assert.equal((await documents.simulate(a,id2)).associated,1);
    await documents.confirm(a,id2,null);
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,id2)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,id2)).status,'completed');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM docs_vehiculos WHERE empresa_id=$1',[a])).rows[0].n,1,'Existing metadata reused');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM import_document_blobs WHERE committed_at IS NOT NULL')).rows[0].n,2);
    assert.equal((await rollback.simulate(a,id2)).revertibles,1);
    await rollback.confirm(a,id2,null);
    assert.equal((await pg.query('SELECT storage_key FROM docs_vehiculos WHERE empresa_id=$1',[a])).rows[0].storage_key,null);
    assert.equal((await rollback.simulate(a,id)).revertibles,1);
    await rollback.confirm(a,id,null);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM docs_choferes WHERE empresa_id=$1',[a])).rows[0].n,0);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM import_document_blobs WHERE committed_at IS NOT NULL')).rows[0].n,0);
    const resumed=await documents.stage({empresaId:a,filename:'CHOFER_12826758A_CAP.pdf',buffer:pdf});
    assert.equal((await documents.simulate(a,resumed)).new,1);
    assert.equal((await documents.cancel(a,resumed,null)).status,'cancelled');
    assert.equal((await documents.continueBatch(a,resumed,null)).status,'running');
    for(let i=0;i<100;i++){
      if(['completed','completed_with_errors','failed'].includes((await batches.getBatch(a,resumed)).status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((await batches.getBatch(a,resumed)).status,'completed');
    await assert.rejects(batches.getBatch(b,id),{status:404});
    console.log('PASS: bulk-document preview, private database storage, metadata attachment, single-file PDF validation, A/B isolation. Synthetic PGlite only.');
  }finally{await pg.close();}
}
main().catch(cause=>{console.error(cause);process.exitCode=1;});
