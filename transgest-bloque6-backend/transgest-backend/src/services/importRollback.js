const {isDeepStrictEqual}=require('node:util');
const dbDefault=require('./db');
const {TABLES:MASTER}=require('./importMasterData');
const {TABLES:COSTS}=require('./importCosts');
const {TABLES:HISTORY}=require('./importHistory');
const {TABLES:TRIPS}=require('./importTrips');
const TABLES=Object.freeze({...MASTER,...COSTS,...HISTORY,...TRIPS,Docs_PDF:'dynamic'});
const REVERSE=['Facturas_Lineas','Facturas_Pendientes','Facturas_Historicas','Gastos_Estructura','Repostajes','Gastos_Operativos',
  'Docs_PDF','Docs_Vehiculos','Docs_Conductores','Viajes_Pendientes','Viajes_Historicos','Tarifas','Colaboradores','Vehiculos','Conductores','Clientes'];
function conflict(message){return Object.assign(new Error(message),{status:409,code:'ROLLBACK_BLOCKED'});}
function quote(identifier){return String(identifier).split('.').map(part=>`"${part.replace(/"/g,'""')}"`).join('.');}
function tableFor(row){return row.entity_type==='Docs_PDF'
  ? row.normalized_data?.scope==='chofer'?'docs_choferes':row.normalized_data?.scope==='vehiculo'?'docs_vehiculos':null
  : TABLES[row.entity_type];}
function createImportRollback(db=dbDefault){
  async function getRows(client,empresaId,batchId){
    const batch=(await client.query('SELECT * FROM import_batches WHERE id=$1 AND empresa_id=$2',[batchId,empresaId])).rows[0];
    if(!batch)throw Object.assign(new Error('Lote no encontrado'),{status:404});
    if(!['completed','completed_with_errors','failed','cancelled'].includes(batch.status))throw conflict('Solo se puede revertir un lote detenido');
    const {rows}=await client.query("SELECT * FROM import_rows WHERE batch_id=$1 AND status IN ('created','updated')",[batchId]);
    return{batch,rows};
  }
  async function assess(client,empresaId,batchId){
    const {batch,rows}=await getRows(client,empresaId,batchId);
    const items=[];
    const candidates=new Map();
    function addCandidate(table,id){
      if(!candidates.has(table))candidates.set(table,new Set());
      candidates.get(table).add(String(id));
    }
    for(const row of rows){
      const table=tableFor(row);
      let reason=null,current=null;
      if(!table||!row.target_id||!row.target_snapshot)reason='Registro sin huella de destino';
      else{
        current=(await client.query(`SELECT to_jsonb(t) AS snapshot FROM ${table} t WHERE id=$1 AND empresa_id=$2`,[row.target_id,empresaId])).rows[0]?.snapshot;
        if(!current)reason='Destino inexistente o de otra empresa';
        else if(!isDeepStrictEqual(current,row.target_snapshot))reason='El registro fue modificado después de importar';
        else if(row.status==='created'&&current.import_batch_id!==batchId)reason='El registro ya no pertenece al lote';
        else if(row.status==='updated'&&(!row.previous_snapshot||row.entity_type!=='Docs_PDF'))reason='Actualización sin estado anterior verificable';
      }
      const item={row,table,current,reason,auxiliary:row.auxiliary_target||null};
      if(!reason&&row.auxiliary_target){
        const aux=row.auxiliary_target;
        if(aux.table!=='rutas'||!aux.id||!aux.snapshot)item.reason='Ruta auxiliar sin huella';
        else{
          const previous=(await client.query('SELECT to_jsonb(r) AS snapshot FROM rutas r WHERE id=$1 AND empresa_id=$2',[aux.id,empresaId])).rows[0]?.snapshot;
          if(!previous||!isDeepStrictEqual(previous,aux.snapshot)||previous.import_batch_id!==batchId)item.reason='Ruta auxiliar modificada o en uso';
        }
      }
      if(!item.reason&&row.status==='created'){
        addCandidate(table,row.target_id);
        if(item.auxiliary)addCandidate(item.auxiliary.table,item.auxiliary.id);
      }
      items.push(item);
    }
    for(const item of items){
      if(item.reason||item.row.status!=='created')continue;
      for(const [table,id] of [[item.table,item.row.target_id],...(item.auxiliary?[[item.auxiliary.table,item.auxiliary.id]]:[])]){
        let references;
        try{
          references=(await client.query(`SELECT c.conrelid::regclass::text AS child_table,a.attname AS child_column,
              array_length(c.conkey,1) AS child_columns,array_length(c.confkey,1) AS parent_columns
            FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
            WHERE c.contype='f' AND c.confrelid=$1::regclass`,[table])).rows;
        }catch{item.reason='No se pudieron verificar dependencias';break;}
        for(const reference of references){
          if(Number(reference.child_columns)!==1||Number(reference.parent_columns)!==1){item.reason='Referencia compuesta no evaluable';break;}
          const child=reference.child_table;
          let linked;
          try{linked=(await client.query(`SELECT id FROM ${quote(child)} WHERE ${quote(reference.child_column)}=$1 LIMIT 1001`,[id])).rows;}
          catch{item.reason=`No se pudo verificar ${child}`;break;}
          const candidateIds=candidates.get(child)||candidates.get(child.replace(/^public\./,''));
          if(linked.length>=1001||linked.some(link=>!candidateIds?.has(String(link.id)))){
            item.reason=`Referencia posterior en ${child}`;break;
          }
        }
        if(item.reason)break;
      }
    }
    return{batch,items,summary:{revertibles:items.filter(item=>!item.reason).length,bloqueados:items.filter(item=>item.reason).length,
      ignorados:Number(batch.total_rows)-items.length,
      bloqueos:items.filter(item=>item.reason).slice(0,50).map(item=>({entity_type:item.row.entity_type,row_number:item.row.row_number,reason:item.reason}))}};
  }
  async function simulate(empresaId,batchId){return(await assess(db,empresaId,batchId)).summary;}
  async function confirm(empresaId,batchId,actorId){
    return db.transaction(async client=>{
      const batch=(await client.query('SELECT id FROM import_batches WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[batchId,empresaId])).rows[0];
      if(!batch)throw Object.assign(new Error('Lote no encontrado'),{status:404});
      const outcome=await assess(client,empresaId,batchId);
      if(outcome.summary.bloqueados)throw conflict(`Rollback bloqueado: ${outcome.summary.bloqueados} registros modificados o referenciados`);
      const ordered=outcome.items.sort((a,b)=>REVERSE.indexOf(a.row.entity_type)-REVERSE.indexOf(b.row.entity_type));
      for(const item of ordered){
        const {row,table,current}=item;
        if(row.status==='updated'){
          const prior=row.previous_snapshot;
          const restored=await client.query(`UPDATE ${table} AS t SET storage_key=$3,file_name=$4,file_mime=$5,file_size_bytes=$6,
            file_sha256=$7,uploaded_at=$8 WHERE id=$1 AND empresa_id=$2 AND to_jsonb(t)=$9::jsonb RETURNING id`,
          [row.target_id,empresaId,prior.storage_key||null,prior.file_name||null,prior.file_mime||null,
            prior.file_size_bytes||null,prior.file_sha256||null,prior.uploaded_at||null,JSON.stringify(row.target_snapshot)]);
          if(restored.rows.length!==1)throw conflict('Documento modificado durante el rollback');
        }else{
          const result=await client.query(`DELETE FROM ${table} AS t WHERE id=$1 AND empresa_id=$2 AND import_batch_id=$3
            AND to_jsonb(t)=$4::jsonb RETURNING id`,[row.target_id,empresaId,batchId,JSON.stringify(row.target_snapshot)]);
          if(result.rows.length!==1)throw conflict('Destino modificado durante el rollback');
          if(item.auxiliary){
            const route=await client.query(`DELETE FROM rutas AS r WHERE id=$1 AND empresa_id=$2 AND import_batch_id=$3
              AND to_jsonb(r)=$4::jsonb RETURNING id`,[item.auxiliary.id,empresaId,batchId,JSON.stringify(item.auxiliary.snapshot)]);
            if(route.rows.length!==1)throw conflict('Ruta auxiliar modificada durante el rollback');
          }
        }
        if(row.entity_type==='Docs_PDF'&&current.storage_key?.startsWith('db:')){
          await client.query('DELETE FROM import_document_blobs WHERE id=$1 AND empresa_id=$2',[current.storage_key.slice(3),empresaId]);
        }
        await client.query('DELETE FROM import_identities WHERE empresa_id=$1 AND target_table=$2 AND target_id=$3 AND created_by_batch_id=$4',
          [empresaId,table,row.target_id,batchId]);
        await client.query("UPDATE import_rows SET status='rolled_back',updated_at=NOW() WHERE id=$1 AND batch_id=$2",[row.id,batchId]);
      }
      await client.query('DELETE FROM import_identities WHERE empresa_id=$1 AND created_by_batch_id=$2',[empresaId,batchId]);
      await client.query("UPDATE import_batches SET status='rolled_back',finished_at=NOW() WHERE id=$1 AND empresa_id=$2",[batchId,empresaId]);
      await client.query('INSERT INTO import_events(batch_id,actor_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
        [batchId,actorId||null,'rolled_back',JSON.stringify(outcome.summary)]);
      return{status:'rolled_back',...outcome.summary};
    });
  }
  return{simulate,confirm};
}
module.exports={createImportRollback};
