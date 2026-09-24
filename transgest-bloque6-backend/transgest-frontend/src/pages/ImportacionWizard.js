import { useCallback, useEffect, useMemo, useState } from 'react';
import { getImportCatalog, getImportBatches, getImportBatch, getImportRows,
  simulateImportBatch, confirmImportBatch, uploadImportFile, downloadImportTemplate,
  uploadDocumentPackage, simulateDocumentBatch, confirmDocumentBatch } from '../services/api';
import { cancelImportBatch, continueImportBatch, retryImportErrors, simulateImportRollback,
  confirmImportRollback, getImportReport, getImportHistoricalOverview, downloadImportResult } from '../services/api';
import './ImportacionWizard.css';

const GROUPS=[
  {title:'Datos maestros',items:[['Clientes','Clientes'],['Conductores','Conductores'],['Vehiculos','Vehículos'],['Colaboradores','Colaboradores'],['Tarifas','Tarifas']]},
  {title:'Operativa',items:[['Viajes_Historicos','Viajes históricos'],['Viajes_Pendientes','Viajes pendientes']]},
  {title:'Finanzas',items:[['Facturas_Historicas','Facturas históricas'],['Facturas_Lineas','Líneas de factura'],['Facturas_Pendientes','Saldos / facturas pendientes'],['Gastos_Operativos','Gastos operativos'],['Repostajes','Repostajes'],['Gastos_Estructura','Gastos de estructura']]},
  {title:'Documentación',items:[['Docs_Conductores','Documentos de conductores'],['Docs_Vehiculos','Documentos de vehículos']]},
];
const STEPS=['Archivo','Validación','Revisión','Importación','Resultado'];
const SUPPORTED=new Set(GROUPS.flatMap(group=>group.items.map(([key])=>key)));
const fmt=value=>Number(value||0).toLocaleString('es-ES');
const eur=value=>Number(value||0).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const HISTORIC_TYPES=new Set(['Facturas_Historicas','Facturas_Lineas','Facturas_Pendientes','Viajes_Historicos','Pack_TransGest']);
const STATUS={review:'Revisión',ready:'Simulación lista',validating:'Simulando',running:'Importando',completed:'Completado',completed_with_errors:'Completado con incidencias',failed:'Fallido',cancelled:'Cancelado',rolled_back:'Revertido'};
function saveBlob(blob,filename){
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);link.download=filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
function currentStep(batch){
  if (!batch) return 1;
  if (['completed','completed_with_errors','failed','cancelled','rolled_back'].includes(batch.status)) return 5;
  if (batch.status==='running') return 4;
  if (batch.status==='ready') return 3;
  return 2;
}
function ErrorBox({message}){return message?<div className="mig-error" role="alert">{message}</div>:null;}

export default function ImportacionWizard(){
  const [catalog,setCatalog]=useState(null);
  const [history,setHistory]=useState([]);
  const [type,setType]=useState(null);
  const [sourceSystem,setSourceSystem]=useState('software-anterior');
  const [file,setFile]=useState(null);
  const [documentFiles,setDocumentFiles]=useState([]);
  const [batch,setBatch]=useState(null);
  const [rows,setRows]=useState([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [mapping,setMapping]=useState({});
  const [unknownHeader,setUnknownHeader]=useState(null);
  const [rowPage,setRowPage]=useState(0);
  const [report,setReport]=useState(null);
  const [historical,setHistorical]=useState(null);
  const [rollbackPreview,setRollbackPreview]=useState(null);

  const loadHistory=useCallback(()=>getImportBatches().then(data=>setHistory(data.batches||[])).catch(cause=>setError(cause.message)),[]);
  useEffect(()=>{getImportCatalog().then(setCatalog).catch(cause=>setError(cause.message));loadHistory();},[loadHistory]);
  const refresh=useCallback(async id=>{
    const result=await getImportBatch(id);setBatch(result);
    return result;
  },[]);
  useEffect(()=>{
    if (!batch?.id || !['validating','running'].includes(batch.status)) return undefined;
    const id=batch.id;
    const timer=setInterval(()=>refresh(id).catch(cause=>setError(cause.message)),1500);
    return ()=>clearInterval(timer);
  },[batch?.id,batch?.status,refresh]);
  useEffect(()=>{
    if (!batch?.id) return;
    getImportRows(batch.id,{limit:50,offset:rowPage*50}).then(data=>setRows(data.rows||[])).catch(cause=>setError(cause.message));
  },[batch?.id,batch?.status,rowPage]);
  useEffect(()=>{
    if(!batch?.id||!['completed','completed_with_errors','failed','cancelled','rolled_back'].includes(batch.status))return;
    getImportReport(batch.id).then(setReport).catch(cause=>setError(cause.message));
  },[batch?.id,batch?.status]);
  useEffect(()=>{
    if(!batch?.id||!HISTORIC_TYPES.has(batch.tipo)||!['completed','completed_with_errors','rolled_back'].includes(batch.status))return;
    getImportHistoricalOverview(batch.id).then(setHistorical).catch(cause=>setError(cause.message));
  },[batch?.id,batch?.tipo,batch?.status]);

  const definition=useMemo(()=>catalog?.templates?.find(item=>item.type===type),[catalog,type]);
  const dryRun=batch?.config?.dry_run;
  const step=currentStep(batch);
  function selectType(next){setType(next);setBatch(null);setRows([]);setFile(null);setDocumentFiles([]);setMapping({});setUnknownHeader(null);setError('');setRowPage(0);setReport(null);setHistorical(null);setRollbackPreview(null);}
  async function download(typeName){
    try{const result=await downloadImportTemplate(typeName);saveBlob(result.blob,result.filename);}
    catch(cause){setError(cause.message);}
  }
  async function upload(){
    if (!type || (type==='Docs_PDF'?!documentFiles.length:!file)) return;
    if (type!=='Docs_PDF'&&!sourceSystem.trim()){setError('Indica el sistema de origen para identificar futuras cargas.');return;}
    setBusy(true);setError('');
    try{
      const result=type==='Docs_PDF'?await uploadDocumentPackage(documentFiles):await uploadImportFile(file,type,sourceSystem.trim(),mapping);
      setBatch(result.batch);setRows(result.preview?.flatMap(sheet=>sheet.rows)||[]);setUnknownHeader(null);setRowPage(0);
      await loadHistory();
    }catch(cause){
      const match=/Columna no reconocida: ([^;]+)/.exec(cause.message||'');
      setUnknownHeader(match?.[1]||null);setError(cause.message);
    }finally{setBusy(false);}
  }
  async function simulate(){
    setBusy(true);setError('');
    try{if(type==='Docs_PDF')await simulateDocumentBatch(batch.id);else await simulateImportBatch(batch.id);await refresh(batch.id);}
    catch(cause){setError(cause.message);}finally{setBusy(false);}
  }
  async function confirm(){
    setBusy(true);setError('');
    try{if(type==='Docs_PDF')await confirmDocumentBatch(batch.id);else await confirmImportBatch(batch.id);await refresh(batch.id);}
    catch(cause){setError(cause.message);}finally{setBusy(false);}
  }
  async function openBatch(item){
    setType(item.tipo);setFile(null);setRowPage(0);setError('');setReport(null);setHistorical(null);setRollbackPreview(null);
    try{await refresh(item.id);}catch(cause){setError(cause.message);}
  }
  async function runAction(action){
    setBusy(true);setError('');
    try{
      if(action==='rollback-preview')setRollbackPreview(await simulateImportRollback(batch.id));
      else if(action==='rollback-confirm'){
        await confirmImportRollback(batch.id);setRollbackPreview(null);await refresh(batch.id);
      }else{
        const fn={cancel:cancelImportBatch,continue:continueImportBatch,retry:retryImportErrors}[action];
        await fn(batch.id);await refresh(batch.id);
      }
      await loadHistory();
    }catch(cause){setError(cause.message);}finally{setBusy(false);}
  }
  async function downloadResult(kind){
    try{saveBlob(await downloadImportResult(batch.id,kind),`${kind.startsWith('report')?'Informe_Migracion':'Errores_TransGest'}_${batch.id.slice(0,8)}.${kind.split('.').pop()}`);}
    catch(cause){setError(cause.message);}
  }
  const processed=Number(batch?.created_rows||0)+Number(batch?.updated_rows||0)+Number(batch?.skipped_rows||0)+Number(batch?.failed_rows||0);
  const selectedLabel=type==='Pack_TransGest'?'Migración completa':type==='Docs_PDF'?'Carga documental masiva':GROUPS.flatMap(group=>group.items).find(([key])=>key===type)?.[1];

  return <main className="mig-page">
    <header className="mig-header">
      <div><span className="mig-eyebrow">TransGest · Implantación</span><h1>Migración de datos</h1>
        <p>Importa a TransGest información procedente de tu software anterior utilizando nuestras plantillas oficiales.</p></div>
      <button className="mig-button mig-button-secondary" onClick={()=>download('Pack_TransGest')}>Descargar pack de plantillas</button>
    </header>
    <ErrorBox message={error}/>
    {!type ? <>
      <div className="mig-groups">{GROUPS.map(group=><section className="mig-panel" key={group.title}>
        <h2>{group.title}</h2><div className="mig-options">{group.items.map(([key,label])=><button key={key} className="mig-option" disabled={!SUPPORTED.has(key)} onClick={()=>selectType(key)}>
          <span>{label}</span><small>{SUPPORTED.has(key)?'Seleccionar →':'En preparación'}</small>
        </button>)}</div>
      </section>)}</div>
      <button className="mig-full" onClick={()=>selectType('Pack_TransGest')}><strong>Migración completa</strong><span>Un libro XLSX con varias hojas oficiales</span><b>Comenzar →</b></button>
      <button className="mig-full" onClick={()=>selectType('Docs_PDF')}><strong>Carga documental masiva</strong><span>Varios PDF o un ZIP, con revisión de DNI y matrícula</span><b>Comenzar →</b></button>
      <section className="mig-panel"><h2>Lotes anteriores</h2>
        {history.length?<div className="mig-history">{history.map(item=><button key={item.id} onClick={()=>openBatch(item)}>
          <strong>{item.filename}</strong><span>{item.tipo} · {STATUS[item.status]||item.status} · {fmt(item.total_rows)} filas</span>
          <time>{new Date(item.created_at).toLocaleString('es-ES')}</time>
        </button>)}</div>:<p className="mig-muted">Todavía no hay migraciones en esta empresa.</p>}
      </section>
    </>:<>
      <div className="mig-back"><button className="mig-link" onClick={()=>selectType(null)}>← Tipos de importación</button><strong>{selectedLabel}</strong></div>
      <ol className="mig-steps" aria-label="Progreso de importación">{STEPS.map((name,index)=><li key={name} className={step===index+1?'current':step>index+1?'done':''} aria-current={step===index+1?'step':undefined}><span>{index+1}</span>{name}</li>)}</ol>
      {!batch?<section className="mig-panel mig-form">
        <h2>1. Prepara el archivo</h2><p>Usa las cabeceras del formato TransGest. No se importarán columnas desconocidas sin una asignación explícita.</p>
        {type==='Docs_PDF'?<><p>Nombra los archivos <strong>CHOFER_DNI_TIPO.pdf</strong> o <strong>VEH_MATRICULA_TIPO.pdf</strong>. Los documentos ambiguos quedarán pendientes de revisión.</p>
          <div className="mig-drop" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();setDocumentFiles(Array.from(event.dataTransfer.files||[]));}}>
            <label>PDFs o ZIP (máximo 20 MB por lote)<input type="file" accept=".pdf,.zip" multiple onChange={event=>setDocumentFiles(Array.from(event.target.files||[]))}/></label>
            <span>{documentFiles.length?`${documentFiles.length} archivo(s) seleccionado(s)`:'También puedes arrastrarlos aquí'}</span></div></>
          :<div className="mig-form-grid"><label>Origen de los datos<input value={sourceSystem} maxLength={80} onChange={event=>setSourceSystem(event.target.value)} placeholder="Nombre del software anterior"/></label>
            <label>Archivo CSV, TSV o XLSX<input type="file" accept=".csv,.tsv,.xlsx" onChange={event=>setFile(event.target.files?.[0]||null)}/></label></div>}
        <div className="mig-actions">{type!=='Docs_PDF'&&<button className="mig-button mig-button-secondary" onClick={()=>download(type)}>Descargar plantilla</button>}
          <button className="mig-button" disabled={type==='Docs_PDF'?!documentFiles.length||busy:!file||busy} onClick={upload}>{busy?'Validando…':'Validar archivo'}</button></div>
        {unknownHeader&&definition&&<div className="mig-mapping"><strong>Columna sin reconocer: {unknownHeader}</strong><p>Asóciala solo para este lote, ignórala o corrige el archivo.</p>
          <select value={mapping[unknownHeader]??''} onChange={event=>setMapping(value=>({...value,[unknownHeader]:event.target.value||null}))}>
            <option value="">Ignorar esta columna</option>{definition.columns.map(column=><option key={column} value={column}>{column}</option>)}
          </select><button className="mig-button mig-button-secondary" onClick={upload} disabled={busy}>Revalidar</button></div>}
      </section>:<>
        <section className="mig-panel"><div className="mig-panel-head"><div><h2>{batch.filename}</h2><p>{batch.tipo} · {fmt(batch.total_rows)} filas · {STATUS[batch.status]||batch.status}</p></div><span className="mig-status">{STATUS[batch.status]||batch.status}</span></div>
          <div className="mig-stats"><div><strong>{fmt(batch.valid_rows)}</strong><span>Válidas o con aviso</span></div><div><strong>{fmt(batch.invalid_rows)}</strong><span>No válidas</span></div><div><strong>{fmt(batch.created_rows)}</strong><span>Creadas</span></div><div><strong>{fmt(batch.updated_rows)}</strong><span>Asociadas</span></div><div><strong>{fmt(batch.skipped_rows)}</strong><span>Omitidas</span></div><div><strong>{fmt(batch.failed_rows)}</strong><span>Errores</span></div></div>
          {batch.status==='review'&&<div className="mig-actions"><button className="mig-button" onClick={simulate} disabled={busy}>Simular importación</button><span>La simulación no modifica datos.</span></div>}
          {batch.status==='ready'&&<><div className="mig-simulation"><strong>Resultado de la simulación</strong><div className="mig-stats"><div><strong>{fmt(dryRun?.new)}</strong><span>Nuevos</span></div><div><strong>{fmt(dryRun?.associated??dryRun?.existing)}</strong><span>{type==='Docs_PDF'?'Asociables':'Existentes'}</span></div><div><strong>{fmt(dryRun?.review)}</strong><span>A revisar</span></div><div><strong>{fmt(dryRun?.unidentified??dryRun?.invalid)}</strong><span>{type==='Docs_PDF'?'Sin identificar':'Inválidos'}</span></div><div><strong>{fmt(type==='Docs_PDF'?dryRun?.existing:dryRun?.unsupported)}</strong><span>{type==='Docs_PDF'?'Ya asociados':'Sin importador'}</span></div></div></div>
            <div className="mig-actions"><button className="mig-button" disabled={busy||!(dryRun?.new||dryRun?.existing||dryRun?.associated)} onClick={confirm}>Importar filas válidas</button><span>Los registros que requieren revisión no se importarán.</span></div></>}
          {batch.status==='running'&&<div className="mig-progress" role="progressbar" aria-valuenow={processed} aria-valuemin={0} aria-valuemax={batch.total_rows}>
            <div style={{width:`${Math.min(100,100*processed/Math.max(1,batch.total_rows))}%`}}/><span>{fmt(processed)} / {fmt(batch.total_rows)} procesadas. Puedes cerrar esta página.</span></div>}
          {['completed','completed_with_errors'].includes(batch.status)&&<p className="mig-complete">Migración terminada. Revisa las filas con incidencias antes de volver a subir el archivo.</p>}
          <div className="mig-actions">
            {['review','ready','validating','running'].includes(batch.status)&&<button className="mig-button mig-button-secondary" disabled={busy} onClick={()=>runAction('cancel')}>Detener lote</button>}
            {['cancelled','failed'].includes(batch.status)&&<button className="mig-button mig-button-secondary" disabled={busy} onClick={()=>runAction('continue')}>Continuar lote</button>}
            {['completed_with_errors','failed'].includes(batch.status)&&<button className="mig-button mig-button-secondary" disabled={busy} onClick={()=>runAction('retry')}>Reintentar errores procesables</button>}
            {['completed','completed_with_errors','failed','cancelled','rolled_back'].includes(batch.status)&&<button className="mig-button mig-button-secondary" onClick={()=>downloadResult('report.xlsx')}>Descargar informe XLSX</button>}
            {['ready','completed_with_errors','failed','cancelled'].includes(batch.status)&&<><button className="mig-button mig-button-secondary" onClick={()=>downloadResult('errors.csv')}>Errores CSV</button><button className="mig-button mig-button-secondary" onClick={()=>downloadResult('errors.xlsx')}>Errores XLSX</button></>}
            {['completed','completed_with_errors','failed','cancelled'].includes(batch.status)&&!rollbackPreview&&<button className="mig-button mig-button-secondary" disabled={busy} onClick={()=>runAction('rollback-preview')}>Simular reversión</button>}
          </div>
          {rollbackPreview&&<div className="mig-simulation" role="status"><strong>Simulación de reversión</strong>
            <p>{fmt(rollbackPreview.revertibles)} registros reversibles · {fmt(rollbackPreview.bloqueados)} bloqueados · {fmt(rollbackPreview.ignorados)} sin creación.</p>
            {rollbackPreview.bloqueos?.map((item,index)=><p key={`${item.entity_type}-${item.row_number}-${index}`}>{item.entity_type}, fila {item.row_number}: {item.reason}</p>)}
            <div className="mig-actions"><button className="mig-button mig-button-secondary" onClick={()=>setRollbackPreview(null)}>Cerrar simulación</button>
              {rollbackPreview.bloqueados===0&&rollbackPreview.revertibles>0&&<button className="mig-button" disabled={busy} onClick={()=>runAction('rollback-confirm')}>Revertir registros intactos</button>}</div>
          </div>}
        </section>
        {report?.summary?.length>0&&<section className="mig-panel"><h2>Resultado por entidad</h2><div className="mig-table-wrap"><table><thead><tr><th>Entidad</th><th>Estado</th><th>Filas</th></tr></thead><tbody>
          {report.summary.map(item=><tr key={`${item.entity_type}-${item.status}`}><td>{item.entity_type}</td><td>{item.status}</td><td>{fmt(item.count)}</td></tr>)}
        </tbody></table></div></section>}
        {historical&&<section className="mig-panel"><h2>Histórico de origen de este lote</h2>
          <p className="mig-muted">Estos importes conservan el significado del software anterior. No se suman a los KPI netos ni a la cartera actual sin conciliación fiscal y de cobros.</p>
          <div className="mig-stats"><div><strong>{fmt(historical.facturas?.documentos)}</strong><span>Facturas históricas · {eur(historical.facturas?.total_origen)} total de origen</span></div>
            <div><strong>{fmt(historical.lineas?.lineas)}</strong><span>Líneas · {fmt(historical.lineas?.lineas_con_coste)} con coste proveedor</span></div>
            <div><strong>{fmt(historical.saldos?.documentos)}</strong><span>Saldos iniciales · {eur(historical.saldos?.saldo_de_origen)}</span></div>
            <div><strong>{fmt(historical.viajes?.viajes)}</strong><span>Viajes históricos · {fmt(historical.viajes?.viajes_con_importe)} con importe</span></div></div>
        </section>}
        <section className="mig-panel"><div className="mig-panel-head"><h2>Filas del lote</h2><span className="mig-muted">Página {rowPage+1}</span></div>
          <div className="mig-table-wrap"><table><thead><tr><th>Hoja</th><th>Fila</th><th>ID origen</th><th>Estado</th><th>Simulación / incidencia</th></tr></thead><tbody>
            {rows.map(row=><tr key={row.id||`${row.entity_type}-${row.row_number}`}><td>{row.entity_type}</td><td>{row.row_number}</td><td>{row.source_id||'—'}</td><td>{row.status}</td><td>{row.error_message||row.simulation?.reason||'—'}</td></tr>)}
            {!rows.length&&<tr><td colSpan={5}>Sin filas en esta página.</td></tr>}
          </tbody></table></div><div className="mig-actions"><button className="mig-button mig-button-secondary" disabled={!rowPage} onClick={()=>setRowPage(page=>page-1)}>Anterior</button>
            <button className="mig-button mig-button-secondary" disabled={rows.length<50} onClick={()=>setRowPage(page=>page+1)}>Siguiente</button></div>
        </section>
      </>}
    </>}
  </main>;
}
