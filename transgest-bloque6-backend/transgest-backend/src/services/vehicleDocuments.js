const {upload}=require('./vehicleDocumentExtraction');
const {DatabaseDocumentStorageProvider}=require('./DocumentStorageProvider');
const fail=(message,status=422)=>Object.assign(Error(message),{status});
function prepareDocuments(items=[]){
  if(!Array.isArray(items)||items.length>6)throw fail('Adjunta como máximo seis documentos por vehículo.');
  const documents=items.map(item=>{
    const file=upload(item.file_url,item.file_nombre||item.file_name);
    const tipo=['itv','seguro','tacografo','tarjeta_transporte','permiso_circulacion','otro'].includes(item.tipo)?item.tipo:'otro';
    return {file,tipo,descripcion:String(item.descripcion||'Documento del vehículo').slice(0,200)};
  });
  if(documents.reduce((sum,item)=>sum+item.file.bytes.length,0)>6*1024*1024)throw fail('Los documentos pendientes no pueden superar 6 MB en total. Guarda el vehículo y añade el resto después.');
  return documents;
}
async function savePreparedDocuments(client,company,vehicleId,documents){
  const vehicle=(await client.query('SELECT id FROM vehiculos WHERE id=$1 AND empresa_id=$2',[vehicleId,company])).rows[0];
  if(!vehicle)throw fail('Vehículo no encontrado.',404);
  const storage=new DatabaseDocumentStorageProvider(client),saved=[];
  for(const {file,tipo,descripcion} of documents){
    const blob=await storage.stage(client,company,null,null,file.name,file.bytes,file.mime);
    const row=(await client.query(`INSERT INTO docs_vehiculos
      (vehiculo_id,empresa_id,tipo,tipo_doc,descripcion,file_nombre,file_size_kb,storage_key,file_name,file_mime,file_size_bytes,file_sha256,uploaded_at)
      VALUES($1,$2,$3,$11,$4,$5::text,$6,$7,$5::text,$8,$9,$10,NOW()) RETURNING *`,
      [vehicleId,company,tipo,descripcion,blob.fileName,Math.ceil(blob.sizeBytes/1024),blob.storageKey,blob.mime,blob.sizeBytes,blob.sha256,tipo])).rows[0];
    await storage.commit(client,company,blob.storageKey);saved.push(row);
  }
  return saved;
}
module.exports={prepareDocuments,savePreparedDocuments};
