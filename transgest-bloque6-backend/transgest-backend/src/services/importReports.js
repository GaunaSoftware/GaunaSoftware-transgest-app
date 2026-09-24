const ExcelJS=require('exceljs');
const dbDefault=require('./db');
const {createImportBatches}=require('./importBatches');

const COLUMNS=['entity_type','row_number','source_id','status','error_code','error_message','datos_origen'];
function safeCell(value){
  const text=String(value??'');
  return /^[\s\u0000-\u001f]*[=+@\-\t\r]/.test(text)?`'${text}`:text;
}
function csvCell(value){return `"${safeCell(value).replace(/"/g,'""')}"`;}
function createImportReports(db=dbDefault,batches=createImportBatches(db)){
  async function report(empresaId,batchId){
    const batch=await batches.getBatch(empresaId,batchId);
    const {rows}=await db.query(`SELECT entity_type,status,count(*)::int AS count FROM import_rows
      WHERE batch_id=$1 GROUP BY entity_type,status ORDER BY entity_type,status`,[batchId]);
    const {rows:events}=await db.query(`SELECT action,created_at,actor_id,details FROM import_events
      WHERE batch_id=$1 ORDER BY created_at,id`,[batchId]);
    return{batch,summary:rows,events,generated_at:new Date().toISOString()};
  }
  async function errors(empresaId,batchId){
    await batches.getBatch(empresaId,batchId);
    const {rows}=await db.query(`SELECT entity_type,row_number,source_id,status,error_code,error_message,source_data
      FROM import_rows WHERE batch_id=$1 AND status IN ('invalid','warning','failed')
      ORDER BY entity_type,row_number`,[batchId]);
    return rows.map(row=>({...row,datos_origen:JSON.stringify(row.source_data??{})}));
  }
  async function errorsCsv(empresaId,batchId){
    const rows=await errors(empresaId,batchId);
    return '\uFEFF'+[COLUMNS.join(';'),...rows.map(row=>COLUMNS.map(key=>csvCell(row[key])).join(';'))].join('\r\n')+'\r\n';
  }
  async function errorsXlsx(empresaId,batchId){
    const rows=await errors(empresaId,batchId);
    const workbook=new ExcelJS.Workbook();workbook.creator='TransGest';
    const sheet=workbook.addWorksheet('Incidencias');sheet.addRow(COLUMNS);
    for(const row of rows)sheet.addRow(COLUMNS.map(key=>key==='row_number'?Number(row[key]):safeCell(row[key])));
    sheet.columns.forEach(column=>{column.width=24;});
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  async function reportXlsx(empresaId,batchId){
    const data=await report(empresaId,batchId);
    const workbook=new ExcelJS.Workbook();workbook.creator='TransGest';
    const summary=workbook.addWorksheet('Resumen');
    for(const [label,value] of [['Lote',data.batch.id],['Empresa',data.batch.empresa_id],['Archivo',data.batch.filename],
      ['SHA-256',data.batch.file_hash_sha256],['Origen',data.batch.source_system],['Estado',data.batch.status],
      ['Inicio',data.batch.started_at||''],['Fin',data.batch.finished_at||''],
      ['Duración (s)',data.batch.started_at&&data.batch.finished_at?
        Math.max(0,Math.round((new Date(data.batch.finished_at)-new Date(data.batch.started_at))/1000)):''],
      ['Mapeo del lote',safeCell(JSON.stringify(data.batch.config?.mapping||{}))],['Filas',Number(data.batch.total_rows)],
      ['Creadas',Number(data.batch.created_rows)],['Actualizadas',Number(data.batch.updated_rows)],
      ['Omitidas',Number(data.batch.skipped_rows)],['Errores',Number(data.batch.failed_rows)]])summary.addRow([label,value]);
    summary.addRow([]);summary.addRow(['Entidad','Estado','Filas']);
    for(const item of data.summary)summary.addRow([item.entity_type,item.status,Number(item.count)]);
    summary.getColumn(1).width=28;summary.getColumn(2).width=48;summary.getColumn(3).width=16;
    const audit=workbook.addWorksheet('Auditoría');audit.addRow(['Acción','Fecha','Usuario','Detalle']);
    for(const event of data.events)audit.addRow([event.action,event.created_at,event.actor_id||'',safeCell(JSON.stringify(event.details||{}))]);
    audit.columns.forEach(column=>{column.width=28;});
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  return{report,reportXlsx,errorsCsv,errorsXlsx};
}
module.exports={createImportReports,safeCell};
