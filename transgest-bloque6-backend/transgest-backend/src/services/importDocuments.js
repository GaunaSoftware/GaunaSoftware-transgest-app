const zlib=require('node:zlib');
const crypto=require('node:crypto');
const dbDefault=require('./db');
const {createImportBatches,normalizeFilename}=require('./importBatches');
const {DatabaseDocumentStorageProvider}=require('./DocumentStorageProvider');
const {compact}=require('./importMasterData');

const MAX_PACKAGE=20*1024*1024,MAX_TOTAL=100*1024*1024,MAX_FILES=256,MAX_PDF=5*1024*1024;
const DRIVER_TYPES=new Set('dni,pasaporte,permiso_conducir,permiso_camion,cap,tarjeta_tacografo,adr,reconocimiento_medico,certificado_formacion,certificado_comunitario,a1_ta300,road_cert,contrato_laboral,otro'.split(','));
const VEHICLE_TYPES=new Set('itv,seguro,permiso_circulacion,ficha_tecnica,tarjeta_transporte,tacografo,contrato_renting,contrato_leasing,mantenimiento,extintor,otro'.split(','));
const TYPE_ALIAS={CONTRATO:'contrato_laboral',PERMISO:'permiso_conducir',CARNET:'permiso_conducir'};
function fail(message,code='DOC_IMPORT_INVALID',status=422){return Object.assign(new Error(message),{code,status});}
function assertPdf(bytes,name){
  if (!/\.pdf$/i.test(name)||bytes.length<10||bytes.length>MAX_PDF||bytes.toString('ascii',0,5)!=='%PDF-'||!bytes.subarray(-1024).includes(Buffer.from('%%EOF')))
    throw fail(`Archivo PDF no válido o superior a 5 MB: ${name}`,'PDF_INVALID');
}
function parseZip(buffer){
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw fail('ZIP sin directorio central','ZIP_INVALID');
  const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),start=buffer.readUInt32LE(end+16);
  if(!count||count>MAX_FILES||start===0xffffffff||size===0xffffffff||start+size>end)throw fail('ZIP excede los límites','ZIP_LIMIT');
  let cursor=start,total=0;
  const files=[];
  for(let i=0;i<count;i++){
    if(cursor+46>start+size||buffer.readUInt32LE(cursor)!==0x02014b50)throw fail('Directorio ZIP inválido','ZIP_INVALID');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10);
    const compressed=buffer.readUInt32LE(cursor+20),length=buffer.readUInt32LE(cursor+24);
    const nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32);
    const local=buffer.readUInt32LE(cursor+42);
    const rawName=buffer.toString('utf8',cursor+46,cursor+46+nameLength);
    cursor+=46+nameLength+extra+comment;
    if(rawName.endsWith('/'))continue;
    if(rawName.includes('..')||rawName.startsWith('/')||rawName.includes('\\')||!/^.*\.pdf$/i.test(rawName))throw fail('El ZIP solo puede contener PDFs con nombres seguros','ZIP_ENTRY');
    if((flags&1)||![0,8].includes(method)||compressed===0xffffffff||length===0xffffffff||length>MAX_PDF||local+30>buffer.length)
      throw fail('Entrada ZIP no permitida','ZIP_ENTRY');
    total+=length;if(total>MAX_TOTAL||compressed===0||length/compressed>200)throw fail('ZIP comprimido peligroso','ZIP_BOMB');
    if(buffer.readUInt32LE(local)!==0x04034b50)throw fail('Cabecera ZIP inválida','ZIP_INVALID');
    const dataStart=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
    if(dataStart+compressed>start)throw fail('Entrada ZIP fuera de rango','ZIP_INVALID');
    const compressedBytes=buffer.subarray(dataStart,dataStart+compressed);
    const bytes=method===0?Buffer.from(compressedBytes):zlib.inflateRawSync(compressedBytes,{maxOutputLength:MAX_PDF});
    if(bytes.length!==length)throw fail('Tamaño ZIP inconsistente','ZIP_INVALID');
    const name=normalizeFilename(rawName);
    assertPdf(bytes,name);
    files.push({name,bytes});
  }
  if(cursor!==start+size||!files.length)throw fail('ZIP sin documentos PDF','ZIP_EMPTY');
  return files;
}
function parsePackage(buffer,filename){
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_PACKAGE)throw fail('Paquete vacío o superior a 20 MB','FILE_SIZE',413);
  if(/\.zip$/i.test(filename))return parseZip(buffer);
  if(/\.pdf$/i.test(filename)){assertPdf(buffer,filename);return[{name:normalizeFilename(filename),bytes:buffer}];}
  if(buffer.toString('ascii',0,6)!=='TGDP1\n'||buffer.length<10)throw fail('Formato documental no reconocido','FILE_TYPE');
  const manifestLength=buffer.readUInt32BE(6);
  if(manifestLength<2||manifestLength>65536||10+manifestLength>buffer.length)throw fail('Manifiesto inválido','PACKAGE_INVALID');
  let manifest;try{manifest=JSON.parse(buffer.toString('utf8',10,10+manifestLength));}catch{throw fail('Manifiesto JSON inválido','PACKAGE_INVALID');}
  if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>MAX_FILES)throw fail('Número de archivos inválido','PACKAGE_INVALID');
  let offset=10+manifestLength,total=0;
  const files=manifest.files.map(item=>{
    if(!item||!Number.isSafeInteger(item.size)||item.size<10||item.size>MAX_PDF||typeof item.name!=='string')throw fail('Archivo del paquete inválido','PACKAGE_INVALID');
    const end=offset+item.size;if(end>buffer.length)throw fail('Paquete truncado','PACKAGE_INVALID');
    const bytes=buffer.subarray(offset,end);offset=end;total+=bytes.length;
    if(total>MAX_TOTAL)throw fail('Paquete descomprimido demasiado grande','PACKAGE_LIMIT');
    const name=normalizeFilename(item.name);assertPdf(bytes,name);
    return{name,bytes};
  });
  if(offset!==buffer.length)throw fail('Bytes sobrantes en paquete','PACKAGE_INVALID');
  return files;
}
function identityFromFilename(name){
  const match=/^(CHOFER|VEH)_([A-Z0-9-]+)_([A-Z0-9_]+)\.pdf$/i.exec(name);
  if(!match)return {error:'Nombre no identificable; usa CHOFER_<DNI>_<TIPO>.pdf o VEH_<MATRICULA>_<TIPO>.pdf'};
  const scope=match[1].toUpperCase()==='CHOFER'?'chofer':'vehiculo';
  const identifier=compact(match[2]);
  const rawType=match[3].toUpperCase();
  const type=TYPE_ALIAS[rawType]||rawType.toLowerCase();
  if(!(scope==='chofer'?DRIVER_TYPES:VEHICLE_TYPES).has(type))return {error:'Tipo documental no reconocido'};
  return {scope,identifier,type};
}
function createImportDocuments(db=dbDefault,batches=createImportBatches(db),storage=new DatabaseDocumentStorageProvider(db)){
  async function stage({empresaId,actorId,filename,buffer}){
    const files=parsePackage(buffer,filename);
    const batch=await batches.createBatch({empresaId,actorId,tipo:'Docs_PDF',filename,fileBuffer:buffer,sourceSystem:'documentos',config:{count:files.length}});
    try{
      for(let start=0;start<files.length;start+=100){
        const block=files.slice(start,start+100).map((file,index)=>{
          const identity=identityFromFilename(file.name);
          return {entity_type:'Docs_PDF',row_number:start+index+2,source_data:{filename:file.name},
            normalized_data:identity.error?{filename:file.name}:{filename:file.name,...identity},
            status:identity.error?'invalid':'valid',error_code:identity.error?'NAME_INVALID':null,error_message:identity.error||null};
        });
        await batches.stageRows(empresaId,batch.id,block);
      }
      const staged=(await db.query(`SELECT id,row_number FROM import_rows WHERE batch_id=$1 ORDER BY row_number`,[batch.id])).rows;
      for(let i=0;i<files.length;i++)await db.transaction(async client=>{
        await storage.stage(client,empresaId,batch.id,staged[i].id,files[i].name,files[i].bytes);
      });
      await batches.sealBatch(empresaId,batch.id,actorId);
      return batch.id;
    }catch(cause){await batches.failBatch(empresaId,batch.id,actorId,cause.code||'DOCUMENT_STAGE_FAILED');throw cause;}
  }
  async function match(client,empresaId,row){
    const data=row.normalized_data||{};
    if(row.status==='invalid'||!data.scope)return{action:'invalid',reason:row.error_message||'Nombre no identificable'};
    const driver=data.scope==='chofer',entity=driver?'choferes':'vehiculos',docTable=driver?'docs_choferes':'docs_vehiculos',foreign=driver?'chofer_id':'vehiculo_id';
    const key=driver?'dni':'matricula';
    const {rows:entities}=await client.query(`SELECT id FROM ${entity} WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(${key}),'[^A-Z0-9]','','g')=$2 LIMIT 2`,[empresaId,data.identifier]);
    if(entities.length!==1)return{action:'review',reason:entities.length?'Entidad ambigua':'Conductor o vehículo no localizado'};
    const entityId=entities[0].id;
    const blob=(await client.query(`SELECT id,sha256,file_name FROM import_document_blobs WHERE empresa_id=$1 AND row_id=$2`,[empresaId,row.id])).rows[0];
    if(!blob)return{action:'review',reason:'PDF temporal no localizado'};
    const {rows:documents}=await client.query(`SELECT id,archivo_nombre,file_name,file_url,storage_key,file_sha256 FROM ${docTable}
      WHERE empresa_id=$1 AND ${foreign}=$2 AND tipo_doc=$3`,[empresaId,entityId,data.type]);
    const same=documents.find(doc=>doc.file_sha256===blob.sha256);
    if(same)return{action:'skip',targetId:same.id,reason:'PDF idéntico ya asociado'};
    const free=documents.filter(doc=>!doc.storage_key&&!doc.file_url);
    const named=free.filter(doc=>doc.archivo_nombre&&doc.archivo_nombre.toLowerCase()===blob.file_name.toLowerCase());
    if(named.length>1||(!named.length&&free.length>1))return{action:'review',reason:'Metadatos documentales ambiguos'};
    const target=named[0]||free[0];
    if(documents.some(doc=>doc.storage_key||doc.file_url)&&!target)return{action:'review',reason:'Ya existe un PDF distinto; requiere revisión'};
    return{action:target?'attach':'create',targetId:target?.id||null,entityId,docTable,foreign,blob};
  }
  async function simulate(empresaId,batchId){
    const batch=await batches.getBatch(empresaId,batchId);
    if(batch.tipo!=='Docs_PDF'||!['review','ready'].includes(batch.status))throw fail('Lote documental no disponible','BATCH_STATE',409);
    const rows=(await db.query(`SELECT * FROM import_rows WHERE batch_id=$1 ORDER BY row_number`,[batchId])).rows;
    const totals={associated:0,new:0,existing:0,review:0,unidentified:0};
    for(const row of rows){
      const decision=await match(db,empresaId,row);
      const bucket={attach:'associated',create:'new',skip:'existing',review:'review',invalid:'unidentified'}[decision.action];totals[bucket]++;
      await db.query('UPDATE import_rows SET simulation=$3::jsonb WHERE id=$1 AND batch_id=$2',
        [row.id,batchId,JSON.stringify({action:decision.action,reason:decision.reason||null,target_id:decision.targetId||null})]);
    }
    await db.query(`UPDATE import_batches SET status='ready',dry_run_at=NOW(),config=jsonb_set(config,'{dry_run}',$3::jsonb,true)
      WHERE id=$1 AND empresa_id=$2`,[batchId,empresaId,JSON.stringify(totals)]);
    return totals;
  }
  async function confirm(empresaId,batchId,actorId){
    await db.transaction(async client=>{
      const {rows}=await client.query('SELECT * FROM import_batches WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[batchId,empresaId]);
      const batch=rows[0];
      if(!batch||batch.tipo!=='Docs_PDF'||batch.status!=='ready'||!batch.dry_run_at)throw fail('Simula los PDFs antes de confirmar','BATCH_STATE',409);
      await client.query("UPDATE import_batches SET status='running',started_at=NOW() WHERE id=$1 AND empresa_id=$2",[batchId,empresaId]);
      await client.query('INSERT INTO import_events(batch_id,actor_id,action) VALUES($1,$2,$3)',[batchId,actorId||null,'documents_confirmed']);
    });
    setImmediate(()=>run(empresaId,batchId).catch(async()=>{await db.query("UPDATE import_batches SET status='failed' WHERE id=$1 AND empresa_id=$2 AND status='running'",[batchId,empresaId]).catch(()=>{});}));
    return {id:batchId,status:'running'};
  }
  async function run(empresaId,batchId){
    const rows=(await db.query("SELECT id FROM import_rows WHERE batch_id=$1 AND status='valid' ORDER BY row_number",[batchId])).rows;
    for(const {id} of rows){
      try{await db.transaction(async client=>{
        const batch=(await client.query('SELECT status FROM import_batches WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[batchId,empresaId])).rows[0];
        if(batch?.status!=='running')return;
        const row=(await client.query('SELECT * FROM import_rows WHERE id=$1 AND batch_id=$2 FOR UPDATE',[id,batchId])).rows[0];
        if(row.status!=='valid')return;
        const decision=await match(client,empresaId,row);
        if(!['attach','create','skip'].includes(decision.action))throw fail(decision.reason||'Documento requiere revisión','DOC_REVIEW');
        let targetId=decision.targetId;
        if(decision.action==='attach'){
          const {rows:docs}=await client.query(`UPDATE ${decision.docTable} SET storage_key=$3,file_name=$4,file_mime='application/pdf',
            file_size_bytes=$5,file_sha256=$6,uploaded_at=NOW() WHERE id=$1 AND empresa_id=$2 AND storage_key IS NULL AND file_url IS NULL RETURNING id`,
          [targetId,empresaId,`db:${decision.blob.id}`,decision.blob.file_name,(await client.query('SELECT size_bytes FROM import_document_blobs WHERE id=$1',[decision.blob.id])).rows[0].size_bytes,decision.blob.sha256]);
          if(!docs.length)throw fail('Los metadatos cambiaron desde la simulación','DOC_CHANGED');
        }else if(decision.action==='create'){
          const {rows:docs}=await client.query(`INSERT INTO ${decision.docTable}(empresa_id,${decision.foreign},tipo,tipo_doc,descripcion,archivo_nombre,
            storage_key,file_name,file_mime,file_size_bytes,file_sha256,uploaded_at,import_batch_id)
            SELECT $1,$2,'otro',$3::text,$3::text,$4::text,$5,$4::text,'application/pdf',size_bytes,sha256,NOW(),$6
            FROM import_document_blobs WHERE id=$7 AND empresa_id=$1 RETURNING id`,
          [empresaId,decision.entityId,row.normalized_data.type,decision.blob.file_name,`db:${decision.blob.id}`,batchId,decision.blob.id]);
          targetId=docs[0]?.id;
        }
        if(!targetId)throw fail('Destino documental no encontrado','DOC_TARGET');
        if(decision.action!=='skip')await storage.commit(client,empresaId,`db:${decision.blob.id}`);
        await client.query('UPDATE import_rows SET status=$3,target_id=$4,error_code=NULL,error_message=NULL,updated_at=NOW() WHERE id=$1 AND batch_id=$2',
          [id,batchId,decision.action==='skip'?'skipped':decision.action==='attach'?'updated':'created',targetId]);
      });}catch(cause){await db.query("UPDATE import_rows SET status='failed',error_code=$3,error_message=$4 WHERE id=$1 AND batch_id=$2 AND status='valid'",
        [id,batchId,cause.code||'DOC_FAILED',String(cause.message||'Error').slice(0,500)]);}
    }
    await db.query(`UPDATE import_batches SET created_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status='created'),
      updated_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status='updated'),
      skipped_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status='skipped'),
      failed_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status='failed'),
      status=CASE WHEN EXISTS(SELECT 1 FROM import_rows WHERE batch_id=$1 AND status NOT IN ('created','updated','skipped'))
        THEN 'completed_with_errors' ELSE 'completed' END,finished_at=NOW()
      WHERE id=$1 AND empresa_id=$2 AND status='running'`,[batchId,empresaId]);
  }
  async function resume(){
    const {rows}=await db.query("SELECT id,empresa_id FROM import_batches WHERE tipo='Docs_PDF' AND status='running' ORDER BY created_at LIMIT 100");
    for(const row of rows)setImmediate(()=>run(row.empresa_id,row.id).catch(()=>{}));
  }
  return{stage,simulate,confirm,run,resume,parsePackage};
}
module.exports={createImportDocuments,parsePackage,identityFromFilename};
