import {useEffect,useRef,useState} from 'react';
import {getBiReportCatalog,getBiReportViews,saveBiReportView,updateBiReportView,deleteBiReportView,runBiReport,getBiReportPage,exportBiReport,downloadBiReport} from '../../services/api';
import './report-center.css';

const date=value=>value?new Intl.DateTimeFormat('es-ES',{dateStyle:'medium'}).format(new Date(`${String(value).slice(0,10)}T12:00:00Z`)):'—';
const show=(value,type)=>value==null?'—':type==='date'?date(value):type==='boolean'?(value?'Sí':'No'):
  type==='money'?new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(value)):
  type==='number'?new Intl.NumberFormat('es-ES',{maximumFractionDigits:2}).format(Number(value)):String(value);
const defaults=(template,state)=>({template:template.id,periodo:state.periodo||'mes',desde:state.desde||'',hasta:state.hasta||'',
  filtros:Object.fromEntries(['cliente_id','ruta','vehiculo_id','ejecucion'].map(k=>[k,state[k]||''])),
  metricas:[...template.metrics],columnas:[...template.columns],dimension:template.dimensions[0],agrupacion:template.dimensions[0],
  orden:{columna:template.columns[0],direccion:'asc'},visualizaciones:[...template.charts]});
export default function ReportCenter({initialState,choices={},role,ownerId}){
  const initial=useRef(initialState);
  const activeRun=useRef(null);
  const [catalog,setCatalog]=useState(null),[views,setViews]=useState([]),[config,setConfig]=useState(null);
  const [selected,setSelected]=useState(null),[name,setName]=useState(''),[description,setDescription]=useState(''),[scope,setScope]=useState('personal');
  const [run,setRun]=useState(null),[page,setPage]=useState(1),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{let live=true;Promise.all([getBiReportCatalog(),getBiReportViews()]).then(([c,v])=>{
    if(!live)return;setCatalog(c);setViews(v);setConfig(defaults(c.templates[0],initial.current));
  }).catch(e=>{if(live)setError(e.message||'No se pudo cargar el centro de informes');});return()=>{live=false;};},[]); // mounted per account
  const edit=fn=>{activeRun.current=null;setConfig(old=>fn(old));setRun(null);setPage(1);setNotice('');};
  const template=catalog?.templates.find(t=>t.id===config?.template);
  const choiceMap={cliente_id:catalog?.opciones?.clientes||choices.clientes||[],ruta:choices.rutas||[],vehiculo_id:choices.vehiculos||[],ejecucion:choices.ejecuciones||[]};
  const updateList=(key,id,checked)=>edit(old=>({...old,[key]:checked?[...old[key],id]:old[key].filter(x=>x!==id)}));
  const selectView=id=>{const view=views.find(v=>v.id===id);setSelected(view||null);activeRun.current=null;setRun(null);setError('');setNotice('');
    if(view){setConfig(view.configuracion);setName(view.nombre);setDescription(view.descripcion);setScope(view.alcance==='compartida'&&role!=='gerente'?'personal':view.alcance);}
    else if(catalog){setConfig(defaults(catalog.templates[0],initialState));setName('');setDescription('');setScope('personal');}};
  const act=async(label,fn)=>{setBusy(label);setError('');setNotice('');try{await fn();}catch(e){setError(e.message||'Operación fallida');}finally{setBusy('');}};
  const reload=async()=>setViews(await getBiReportViews());
  const isOwner=selected&&String(selected.owner_id)===String(ownerId);
  const save=()=>act('guardar',async()=>{const body={nombre:name,descripcion:description,alcance:scope,configuracion:config};
    const view=isOwner?await updateBiReportView(selected.id,body):await saveBiReportView(body);await reload();setSelected(view);setConfig(view.configuracion);setNotice('Vista guardada.');});
  const remove=()=>act('eliminar',async()=>{await deleteBiReportView(selected.id);await reload();selectView('');setNotice('Vista eliminada.');});
  const preview=()=>act('ejecutar',async()=>{const saved=selected&&JSON.stringify(config)===JSON.stringify(selected.configuracion);
    const result=await runBiReport(saved?{vista_id:selected.id}:{configuracion:config});activeRun.current=result.id;setRun(result);setPage(1);
    setNotice(`Informe generado. Descargas privadas hasta ${new Date(result.expires_at).toLocaleString('es-ES')}.`);});
  const weekly=()=>act('semanal',async()=>{const vehicle=catalog.templates.find(t=>t.id==='vehiculo');
    const next=defaults(vehicle,{periodo:'semana_anterior'});activeRun.current=null;setSelected(null);setConfig(next);
    setName('Rentabilidad semanal de flota');setDescription('Semana completa anterior; margen directo registrado, costes y kilómetros por camión.');setScope('personal');
    const result=await runBiReport({configuracion:next});activeRun.current=result.id;setRun(result);setPage(1);
    setNotice('Informe semanal preparado. Puedes verlo aquí o descargar su PDF. El margen directo no es beneficio neto.');});
  const changePage=next=>act('pagina',async()=>{const id=run.id;const report=await getBiReportPage(id,next);
    if(activeRun.current===id){setRun(old=>({...old,report}));setPage(next);}});
  const exportFormat=format=>act(format,async()=>{if(!run)throw new Error('Primero genera la vista previa.');
    const item=await exportBiReport(run.id,format);const blob=await downloadBiReport(item.id);
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`transgest-bi-${config.template}-${run.id}.${format}`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    setNotice(`${format.toUpperCase()} descargado desde la misma ejecución que muestra la pantalla.`);});
  if(!catalog||!config)return <section className="bi-reports" role="status">{error||'Cargando catálogo y vistas guardadas…'}</section>;
  const report=run?.report,rows=report?.rows||[],totalRows=report?.metadata?.total_rows??rows.length;
  return <section className="bi-reports" aria-label="Centro de informes">
    <div className="bi-reports-intro"><div><h2>Informes a demanda</h2><p>Guarda una vista personal o compártela con usuarios autorizados de tu empresa. Pantalla y archivos usan la misma ejecución.</p>
      {role==='gerente'&&<button className="bi-weekly" disabled={!!busy} onClick={weekly}>Ver informe semanal de flota</button>}</div>
      <label>Vistas guardadas<select value={selected?.id||''} onChange={e=>selectView(e.target.value)}><option value="">Nueva vista</option>
        {views.map(v=><option key={v.id} value={v.id}>{v.alcance==='compartida'?'Compartida':'Personal'} · {v.nombre}</option>)}</select></label></div>
    <div className="bi-reports-grid"><div className="bi-reports-editor">
      <div className="bi-reports-fields"><label>Plantilla<select value={config.template} onChange={e=>{const next=catalog.templates.find(t=>t.id===e.target.value);edit(()=>defaults(next,initialState));setSelected(null);setName(next.name);}}>
        {catalog.templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Periodo<select value={config.periodo} onChange={e=>edit(c=>({...c,periodo:e.target.value}))}>{catalog.periods.map(p=><option key={p} value={p}>{({mes:'Este mes',semana_anterior:'Semana anterior (lunes a domingo)','90d':'Últimos 90 días',anual:'Este año','365d':'Últimos 365 días',personalizado:'Personalizado'})[p]}</option>)}</select></label>
        {config.periodo==='personalizado'&&<><label>Desde<input type="date" value={config.desde} onChange={e=>edit(c=>({...c,desde:e.target.value}))}/></label>
          <label>Hasta<input type="date" value={config.hasta} onChange={e=>edit(c=>({...c,hasta:e.target.value}))}/></label></>}
        {[['cliente_id','Cliente'],['ruta','Ruta'],['vehiculo_id','Vehículo'],['ejecucion','Ejecución']].map(([key,label])=><label key={key}>{label}<select value={config.filtros?.[key]||''}
          onChange={e=>edit(c=>({...c,filtros:{...c.filtros,[key]:e.target.value}}))}><option value="">Todos</option>{choiceMap[key].map(x=><option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>)}
        <label>Dimensión<select value={config.dimension} onChange={e=>edit(c=>({...c,dimension:e.target.value,agrupacion:e.target.value}))}>{template.dimensions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
        <label>Agrupación<select value={config.agrupacion} onChange={e=>edit(c=>({...c,agrupacion:e.target.value}))}>{template.dimensions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
        <label>Ordenar por<select value={config.orden.columna} onChange={e=>edit(c=>({...c,orden:{...c.orden,columna:e.target.value}}))}>{config.columnas.map(x=><option key={x} value={x}>{catalog.columns[x].label}</option>)}</select></label>
        <label>Sentido<select value={config.orden.direccion} onChange={e=>edit(c=>({...c,orden:{...c.orden,direccion:e.target.value}}))}><option value="asc">Ascendente</option><option value="desc">Descendente</option></select></label></div>
      <div className="bi-reports-options"><fieldset><legend>Indicadores</legend>{template.metrics.map(x=><label key={x}><input type="checkbox" checked={config.metricas.includes(x)} disabled={config.metricas.length===1&&config.metricas.includes(x)} onChange={e=>updateList('metricas',x,e.target.checked)}/>{catalog.metrics[x]}</label>)}</fieldset>
        <fieldset><legend>Columnas del detalle</legend>{template.columns.map(x=><label key={x}><input type="checkbox" checked={config.columnas.includes(x)} disabled={config.columnas.length===1&&config.columnas.includes(x)} onChange={e=>edit(c=>{const columns=e.target.checked?[...c.columnas,x]:c.columnas.filter(v=>v!==x);return {...c,columnas:columns,orden:{...c.orden,columna:columns.includes(c.orden.columna)?c.orden.columna:columns[0]}};})}/>{catalog.columns[x].label}</label>)}</fieldset>
        <fieldset><legend>Visualizaciones</legend>{template.charts.map(x=><label key={x}><input type="checkbox" checked={config.visualizaciones.includes(x)} disabled={config.visualizaciones.length===1&&config.visualizaciones.includes(x)} onChange={e=>updateList('visualizaciones',x,e.target.checked)}/>{x==='evolucion'?'Evolución':'Comparación en barras'}</label>)}</fieldset></div>
      <div className="bi-reports-save"><label>Nombre<input value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="Nombre de la vista"/></label>
        <label>Descripción<textarea value={description} maxLength={500} rows={2} onChange={e=>setDescription(e.target.value)} placeholder="Qué responde este informe"/></label>
        <label>Visibilidad<select value={scope} onChange={e=>setScope(e.target.value)}><option value="personal">Personal</option>{role==='gerente'&&<option value="compartida">Compartida</option>}</select></label>
        <div className="bi-reports-actions"><button disabled={!!busy||!name.trim()} onClick={save}>{isOwner?'Guardar cambios':selected?'Guardar copia':'Guardar vista'}</button>
          {isOwner&&<button disabled={!!busy} onClick={remove}>Eliminar vista</button>}</div></div>
    </div><div className="bi-reports-output"><div className="bi-reports-actions"><button className="bi-primary" disabled={!!busy} onClick={preview}>{busy==='ejecutar'?'Generando…':'Generar vista previa'}</button>
      {['pdf','xlsx','csv'].map(format=><button key={format} disabled={!run||!!busy} onClick={()=>exportFormat(format)}>{format.toUpperCase()}</button>)}</div>
      {error&&<p role="alert" className="bi-reports-error">{error}</p>}{notice&&<p role="status" className="bi-reports-notice">{notice}</p>}
      {!report?<p className="bi-reports-empty">Selecciona los parámetros y genera el informe para ver cifras reales y descargarlo.</p>:<>
        <div className="bi-report-meta"><h3>{report.title}</h3><p>{date(report.metadata.periodo.desde)} – {date(report.metadata.periodo.hasta)} · Corte {date(report.metadata.fecha_corte)} · {totalRows} registros</p></div>
        <div className="bi-report-metrics">{report.metrics.map(m=><article key={m.id}><span>{m.label}</span><strong>{show(m.valor,m.unidad==='EUR'?'money':'number')}{m.valor!=null&&m.unidad!=='EUR'?` ${m.unidad}`:''}</strong><small>{m.estado}</small><details><summary>Definición y cobertura</summary><p>{m.definicion}</p><p>{m.cobertura?.evaluables??0} de {m.cobertura?.total??0} evaluables</p></details></article>)}</div>
        {report.chart?.length>0&&<div className="bi-report-chart"><h4>Evolución (€)</h4><div className="bi-report-scroll"><table><thead><tr><th>Fecha</th><th>Ingreso</th><th>Margen</th></tr></thead><tbody>{report.chart.map((r,i)=><tr key={i}><td>{r.fecha}</td><td>{show(r.ingreso,'money')}</td><td>{show(r.margen,'money')}</td></tr>)}</tbody></table></div></div>}
        {report.bars?.length>0&&<div className="bi-report-chart"><h4>Comparación</h4><p>{report.bars_label}</p>{report.bars.map((b,i)=><div className="bi-report-bar" key={i}><span>{b.label}</span><div><i style={{width:`${Math.min(100,100*Math.abs(b.value)/Math.max(1,...report.bars.map(x=>Math.abs(x.value))))}%`}}/></div><strong>{show(b.value,b.unit==='EUR'?'money':'number')}{b.unit==='%'?' %':''}</strong></div>)}</div>}
        {report.warnings.length>0&&<div className="bi-report-warnings"><h4>Advertencias y cobertura</h4><ul>{report.warnings.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
        <div className="bi-report-scroll"><table><caption>Detalle completo: {totalRows} registros. Se muestran 25 por página.</caption><thead><tr>{report.columns.map(c=><th key={c.id}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r,i)=><tr key={`${page}-${i}`}>{report.columns.map(c=><td key={c.id}>{show(r[c.id],c.type)}</td>)}</tr>)}</tbody></table></div>
        <div className="bi-reports-actions"><button disabled={page<=1||!!busy} onClick={()=>changePage(page-1)}>Anterior</button><span>Página {page} de {Math.max(1,Math.ceil(totalRows/25))}</span><button disabled={page*25>=totalRows||!!busy} onClick={()=>changePage(page+1)}>Siguiente</button></div>
      </>}</div></div>
  </section>;
}
