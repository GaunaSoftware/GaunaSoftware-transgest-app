const crypto=require('node:crypto');
const db=require('./db');
const {normalizeFilename}=require('./importBatches');

// file_url/DataURL sigue siendo legible en documentos anteriores. Los nuevos
// binarios se guardan en una tabla privada; el contrato storage_key permite
// sustituir este proveedor por almacenamiento de objetos sin cambiar negocio.
class LegacyDocumentStorageProvider {
  resolveUrl(document){return document?.file_url||null;}
}
class DatabaseDocumentStorageProvider {
  constructor(database=db){this.db=database;}
  async stage(client,empresaId,batchId,rowId,name,bytes){
    if(!Buffer.isBuffer(bytes)||bytes.length<10||bytes.length>5*1024*1024)throw new Error('PDF vacío o superior a 5 MB');
    const filename=normalizeFilename(name);
    const sha=crypto.createHash('sha256').update(bytes).digest('hex');
    const {rows}=await client.query(`INSERT INTO import_document_blobs(empresa_id,batch_id,row_id,file_name,size_bytes,sha256,content)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[empresaId,batchId,rowId,filename,bytes.length,sha,bytes]);
    return {storageKey:`db:${rows[0].id}`,fileName:filename,mime:'application/pdf',sizeBytes:bytes.length,sha256:sha};
  }
  async commit(client,empresaId,storageKey){
    const id=String(storageKey||'').replace(/^db:/,'');
    const {rows}=await client.query(`UPDATE import_document_blobs SET committed_at=NOW()
      WHERE id=$1 AND empresa_id=$2 RETURNING id`,[id,empresaId]);
    if(!rows.length)throw new Error('Archivo temporal no encontrado');
  }
  async read(empresaId,storageKey){
    const match=/^db:([0-9a-f-]{36})$/i.exec(String(storageKey||''));
    if(!match)return null;
    const {rows}=await this.db.query(`SELECT file_name,mime,size_bytes,content FROM import_document_blobs
      WHERE id=$1 AND empresa_id=$2 AND committed_at IS NOT NULL`,[match[1],empresaId]);
    return rows[0]||null;
  }
  async cleanupExpired(){
    const result=await this.db.query(`DELETE FROM import_document_blobs WHERE committed_at IS NULL
      AND created_at<NOW()-INTERVAL '30 days'`);
    return result.rowCount||0;
  }
}
module.exports={LegacyDocumentStorageProvider,DatabaseDocumentStorageProvider};
