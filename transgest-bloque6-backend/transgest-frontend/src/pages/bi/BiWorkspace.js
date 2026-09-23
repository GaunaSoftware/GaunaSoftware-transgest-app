import {lazy, Suspense, useEffect, useState} from 'react';
import {Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {Badge, Button, Card, Modal} from '../../ui';
import {useAuth} from '../../context/AuthContext';
import {getBiWorkspace} from '../../services/api';
import {setRuntimeFocus} from '../../services/runtimeFocus';
import {changeBiFilter,clearBiFilters,filterKeys,initialBiState,queryForBi,restoreBiState} from './biWorkspaceState';
import BiPhase4 from './BiPhase4';
import ReportCenter from './ReportCenter';
import './bi-workspace.css';

const LegacyInformes = lazy(() => import('../Informes'));
const money = n => n == null ? 'No calculable' : new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(n));
const decimal = (n,d=2) => n == null ? 'No calculable' : new Intl.NumberFormat('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(n));
const date = value => value ? new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${String(value).slice(0,10)}T12:00:00Z`)) : '—';
const moment = value => value ? new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';
const quality = {completo:'Completo',parcial:'Parcial',estimado:'Estimado',sin_datos:'Sin datos',no_aplicable:'No aplicable',error:'Error'};
const columnNames = {nombre:'Dimensión',ingreso:'Ingreso',coste_directo_registrado:'Coste directo',margen_directo_registrado:'Margen directo',margen_pct:'Margen %',km_total:'Km totales',km_vacios:'Km vacíos',servicios:'Servicios'};
const rowNumber = (row,key) => row[key] == null ? 'No calculable' : key === 'margen_pct' ? `${decimal(row[key])} %` : key === 'km_total' || key === 'km_vacios' ? `${decimal(row[key],0)} km` : key === 'servicios' ? decimal(row[key],0) : money(row[key]);
const metricNumber = (metadata,key) => {
  const item=metadata?.[key];
  if (!item || item.valor == null) return item?.estado === 'no_aplicable' ? 'No aplicable' : 'No calculable';
  if (item.unidad === '%') return `${decimal(item.valor)} %`;
  if (item.unidad === 'EUR/km total') return `${decimal(item.valor)} €/km`;
  if (item.unidad === 'registros') return decimal(item.valor,0);
  return money(item.valor);
};
const nav = view => window.dispatchEvent(new CustomEvent('tms:navegar',{detail:view}));
const blank = {data:null,error:'',loading:true,key:''};

function MetricCard({title,metric,period,extra,onClick}) {
  return <Card className="bi-kpi">
    <div className="bi-kpi-top"><span>{title}</span><Badge tone={metric?.estado === 'completo' ? 'success' : metric?.estado === 'error' ? 'danger' : 'warning'}>{quality[metric?.estado] || 'Sin datos'}</Badge></div>
    <strong className="bi-kpi-value">{metricNumber({value:metric},'value')}</strong>
    {extra && <span className="bi-kpi-extra">{extra}</span>}
    <details className="bi-definition"><summary>Cómo se calcula</summary><p>{metric?.definicion || 'Definición no disponible.'}</p>
      <dl><dt>Unidad</dt><dd>{metric?.unidad || '—'}</dd><dt>Periodo</dt><dd>{period ? `${date(period.desde)} – ${date(period.hasta)}` : '—'}</dd>
        <dt>Impuestos</dt><dd>{metric?.impuestos || '—'}</dd><dt>Denominador</dt><dd>{metric?.denominador == null ? 'No aplica' : decimal(metric.denominador)}</dd>
        <dt>Numerador</dt><dd>{metric?.numerador == null ? 'No aplica' : decimal(metric.numerador)}</dd>
        <dt>Costes incluidos</dt><dd>{metric?.costes_incluidos || 'Ninguno'}</dd>
        <dt>Cobertura</dt><dd>{metric?.cobertura ? `${metric.cobertura.evaluables} de ${metric.cobertura.total}` : 'No disponible'}</dd></dl>
    </details>
    {onClick && <Button onClick={onClick}>Ver registros</Button>}
  </Card>;
}
function ChartPanel({title,subtitle,rows,columns,renderChart}) {
  const [expanded,setExpanded]=useState(false);
  const table=<div className="bi-scroll"><table className="bi-table"><thead><tr>{columns.map(c=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((row,i)=><tr key={row.id || row.fecha || i}>{columns.map(c=><td key={c.key}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>)}</tr>) :
      <tr><td colSpan={columns.length}>Sin datos evaluables para este gráfico.</td></tr>}</tbody></table></div>;
  return <Card as="section" className="bi-chart-panel"><div className="bi-section-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    <Button onClick={()=>setExpanded(true)} aria-label={`Ampliar gráfico ${title}`}>Ampliar</Button></div>
    <div className="bi-chart-area" role="img" aria-label={title}>{rows.length ? renderChart(270) : <p className="bi-empty">Sin datos evaluables.</p>}</div>
    <details className="bi-chart-table"><summary>Ver datos en tabla</summary>{table}</details>
    <Modal open={expanded} title={title} onClose={()=>setExpanded(false)} width={1100} className="bi-dialog">
      <div className="bi-chart-area bi-chart-area--large">{rows.length ? renderChart(440) : <p className="bi-empty">Sin datos evaluables.</p>}</div>{table}
    </Modal>
  </Card>;
}
function Comparison({item,label,range}) {
  const change=item?.variacion_pct;
  return <span className="bi-comparison">{label}: {change == null ? 'sin base comparable' : `${change > 0 ? '+' : ''}${decimal(change)} %`}
    <small> frente a {date(range?.desde)} – {date(range?.hasta)}</small></span>;
}
function Trend({data,onDrill}) {
  const rows=data?.evolucion || [];
  const chart=height=><ResponsiveContainer width="100%" height={height}><ComposedChart data={rows} margin={{top:12,right:12,bottom:10,left:4}}>
    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3"/><XAxis dataKey="fecha" tick={{fontSize:11,fill:'var(--text3)'}}/>
    <YAxis tick={{fontSize:11,fill:'var(--text3)'}} tickFormatter={v=>`${decimal(v,0)} €`}/>
    <Tooltip formatter={(v,name)=>[money(v),name==='ingreso'?'Ingreso realizado':'Margen directo registrado']}/>
    <Line type="monotone" dataKey="ingreso" name="Ingreso realizado" stroke="var(--accent)" strokeWidth={2.5} dot={{r:3}} connectNulls={false}
      onClick={payload=>payload?.payload?.fecha && onDrill(payload.payload.fecha)}/>
    <Line type="monotone" dataKey="margen" name="Margen directo registrado" stroke="var(--orange)" strokeWidth={2} dot={{r:3}} connectNulls={false}
      onClick={payload=>payload?.payload?.fecha && onDrill(payload.payload.fecha)}/>
  </ComposedChart></ResponsiveContainer>;
  return <ChartPanel title="Evolución de servicios y margen" subtitle={`EUR netos · agrupación por ${data?.granularidad || 'día'}. Selecciona un punto para profundizar.`}
    rows={rows} columns={[{key:'fecha',label:'Periodo',render:r=><button className="bi-link" onClick={()=>onDrill(r.fecha)} aria-label={`Profundizar en ${r.fecha}`}>{r.fecha}</button>},{key:'ingreso',label:'Ingreso',render:r=>money(r.ingreso)},
      {key:'margen',label:'Margen',render:r=>money(r.margen)},{key:'cobertura_costes',label:'Costes evaluables',render:r=>`${r.cobertura_costes.evaluables}/${r.cobertura_costes.total}`}]} renderChart={chart}/>;
}
function MarginBars({title,rows,onSelect}) {
  const chart=height=><ResponsiveContainer width="100%" height={height}><ComposedChart layout="vertical" data={rows} margin={{top:8,right:12,bottom:8,left:12}}>
    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false}/>
    <XAxis type="number" tick={{fontSize:10,fill:'var(--text3)'}} tickFormatter={v=>`${decimal(v,0)} €`}/>
    <YAxis type="category" dataKey="nombre" width={95} tick={{fontSize:10,fill:'var(--text3)'}} tickFormatter={v=>String(v).slice(0,16)}/>
    <Tooltip formatter={v=>money(v)}/><Bar dataKey="margen_directo_registrado" name="Margen directo registrado" fill="var(--accent)" radius={[0,4,4,0]}
      onClick={r=>onSelect?.(r?.payload?.id || r?.id)}/>
  </ComposedChart></ResponsiveContainer>;
  return <ChartPanel title={title} subtitle="Ordenado por margen directo registrado · EUR netos. Selecciona una barra o una fila."
    rows={rows} columns={[{key:'nombre',label:'Nombre',render:r=>onSelect ? <button className="bi-link" onClick={()=>onSelect(r.id)}>{r.nombre}</button> : r.nombre},
      {key:'ingreso',label:'Ingreso',render:r=>money(r.ingreso)},{key:'coste_directo_registrado',label:'Coste',render:r=>money(r.coste_directo_registrado)},
      {key:'margen_directo_registrado',label:'Margen',render:r=>money(r.margen_directo_registrado)}]} renderChart={chart}/>;
}

export default function BiWorkspace() {
  const {user}=useAuth();
  const storageKey=`tms_bi_workspace_${user?.empresa_id || 'empresa'}_${user?.id || 'usuario'}_${user?.rol || 'rol'}_${user?.plan || 'plan'}_${JSON.stringify(user?.productos || [])}_${Boolean(user?.permisos?.modulos?.informes?.ver)}`;
  const [state,setState]=useState(()=>{try{return restoreBiState(sessionStorage.getItem(storageKey));}catch{return initialBiState;}});
  const [stateScope,setStateScope]=useState(storageKey);
  const [result,setResult]=useState(blank);
  const [choiceCache,setChoiceCache]=useState({scope:storageKey,options:{}});
  const [retry,setRetry]=useState(0);
  const [localSearch,setLocalSearch]=useState('');
  const [drillStack,setDrillStack]=useState([]);
  useEffect(()=>{if(stateScope!==storageKey){try{setState(restoreBiState(sessionStorage.getItem(storageKey)));}catch{setState(initialBiState);}setStateScope(storageKey);setResult(blank);}},[stateScope,storageKey]);
  useEffect(()=>{if(stateScope===storageKey)try{sessionStorage.setItem(storageKey,JSON.stringify(state));}catch{}},[state,stateScope,storageKey]);
  const query=queryForBi(state);
  const key=JSON.stringify(query);
  const requestKey=`${storageKey}|${key}`;
  useEffect(()=>{
    if(stateScope!==storageKey)return;
    const requestQuery=JSON.parse(key);
    if (Object.prototype.hasOwnProperty.call(requestQuery,'desde') && (!requestQuery.desde || !requestQuery.hasta || requestQuery.desde>requestQuery.hasta)) {setResult({key:requestKey,data:null,error:'Completa un rango de fechas válido.',loading:false});return;}
    const controller=new AbortController(); let active=true;
    setResult({key:requestKey,data:null,error:'',loading:true});
    getBiWorkspace(requestQuery,controller.signal).then(data=>{if(active){setChoiceCache({scope:storageKey,options:data?.filtros?.opciones||{}});setResult({key:requestKey,data,error:'',loading:false});}})
      .catch(error=>{if(active && error?.name!=='AbortError')setResult({key:requestKey,data:null,error:error.message || 'No se pudo cargar el panel.',loading:false});});
    return ()=>{active=false;controller.abort();};
  },[key,requestKey,retry,stateScope,storageKey,state.vista]);
  const loading=stateScope!==storageKey || result.loading || result.key!==requestKey;
  const data=result.key===requestKey?result.data:null;
  const economy=data?.economia, metrics=economy?.metricas || {};
  const setFilter=(name,value)=>setState(old=>changeBiFilter(old,name,value));
  const choices=data?.filtros?.opciones || (choiceCache.scope===storageKey ? choiceCache.options : {});
  const selectedLabel=(name,value)=>({cliente_id:'clientes',ruta:'rutas',vehiculo_id:'vehiculos',ejecucion:'ejecuciones'})[name] ?
    choices[({cliente_id:'clientes',ruta:'rutas',vehiculo_id:'vehiculos',ejecucion:'ejecuciones'})[name]]?.find(x=>x.id===value)?.nombre || value : value;
  const navigateService=row=>{setRuntimeFocus('tms_pedidos_focus',{pedido_id:row.id,numero:row.numero,source:'bi_workspace'});nav('pedidos');};
  const navigateInvoice=row=>{setRuntimeFocus('tms_facturacion_focus',{factura_id:row.id,source:'bi_workspace'});nav('facturacion');};
  const drill=key=>{
    if (!key) return;
    const granularity=data?.granularidad || 'dia';
    let end=key;
    if (granularity==='semana') {const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+6);end=d.toISOString().slice(0,10);}
    if (granularity==='mes') {const d=new Date(`${key}-01T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1,0);end=d.toISOString().slice(0,10);key=`${key}-01`;}
    const prior=data.metadata.periodo;
    if (key<prior.desde) key=prior.desde;
    if (end>prior.hasta) end=prior.hasta;
    setDrillStack(old=>[...old,{periodo:state.periodo,desde:state.desde,hasta:state.hasta,granularity:state.granularity}]);
    setState(old=>({...old,periodo:'personalizado',desde:key,hasta:end,granularity:granularity==='mes'?'semana':'dia',page:1}));
  };
  const undrill=()=>{const previous=drillStack[drillStack.length-1];if(!previous)return;
    setState(old=>({...old,...previous,page:1}));setDrillStack(old=>old.slice(0,-1));};
  const active=filterKeys.filter(k=>state[k]);
  const serviceRows=(data?.servicios?.rows || []).filter(r=>`${r.numero} ${r.cliente} ${r.ruta} ${r.vehiculo}`.toLowerCase().includes(localSearch.toLowerCase()));
  const matrixRows=data?.matriz?.[state.matriz] || [];
  const matrixSorted=[...matrixRows].sort((a,b)=>{
    const av=a[state.matrizSort],bv=b[state.matrizSort];
    const comparison=typeof av==='number' || typeof bv==='number' ? Number(av || 0)-Number(bv || 0) : String(av || '').localeCompare(String(bv || ''),'es');
    return state.matrizDirection==='asc'?comparison:-comparison;
  });
  const matrixPageRows=matrixSorted.slice((state.matrizPage-1)*20,state.matrizPage*20);
  const columns=state.columnas.filter(k=>columnNames[k]);
  const serviceDefinitions=[
    {key:'numero',label:'Pedido',render:r=>r.numero},{key:'fecha',label:'Fecha',render:r=>date(r.fecha)},
    {key:'cliente',label:'Cliente',render:r=>r.cliente},{key:'ruta',label:'Ruta',render:r=>r.ruta},
    {key:'vehiculo',label:'Vehículo',render:r=>r.vehiculo},{key:'ejecucion',label:'Ejecución',render:r=>r.ejecucion==='flota_propia'?'Propia':'Subcontratada'},
    {key:'ingreso',label:'Ingreso',render:r=>money(r.ingreso)},{key:'coste',label:'Coste',render:r=>money(r.coste)},
    {key:'margen',label:'Margen',render:r=>money(r.margen)},{key:'km_pedido',label:'Km pedido',render:r=>r.km_pedido==null?'—':`${decimal(r.km_pedido,0)} km`}
  ];
  const visibleServiceDefinitions=serviceDefinitions.filter(d=>state.columnasServicios.includes(d.key));
  const mode=state.vista;
  const phase4=['operaciones','flota','calidad'].includes(mode);
  const viewNames={direccion:'Dirección',rentabilidad:'Rentabilidad',operaciones:'Operaciones y servicio',flota:'Flota y combustible',calidad:'Calidad y sostenibilidad',centro:'Centro de informes',anteriores:'Informes anteriores'};
  return <div className="bi-workspace">
    <div className="bi-head"><div><p className="bi-eyebrow">TRANS GEST · INTELIGENCIA DE NEGOCIO</p><h1>{viewNames[mode]||'Dirección'}</h1>
      <p>{phase4?'Eventos reales, población elegible y cobertura de cada indicador.':'Servicios realizados, costes registrados y cobro estimado con definiciones visibles.'}</p></div>
      <div className="bi-head-meta"><span>{data ? `${date(data.metadata.periodo.desde)} – ${date(data.metadata.periodo.hasta)}` : 'Periodo seleccionado'}</span>
        <small>Comparación: {data ? `${date(data.metadata.comparacion.desde)} – ${date(data.metadata.comparacion.hasta)}` : 'pendiente'}</small>
        <small>Actualizado: {moment(data?.metadata?.actualizado_en)}</small></div></div>
    <div className="bi-view-tabs" role="tablist" aria-label="Vistas de informes">
      {[['direccion','Dirección'],['rentabilidad','Rentabilidad'],['operaciones','Operaciones'],['flota','Flota'],['calidad','Calidad y sostenibilidad'],['centro','Centro de informes'],['anteriores','Informes anteriores']].map(([id,label],index,tabs)=><button key={id} role="tab" aria-selected={mode===id} tabIndex={mode===id?0:-1}
        onKeyDown={e=>{const next=e.key==='ArrowRight'?(index+1)%tabs.length:e.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;if(next!==null){e.preventDefault();setState(old=>({...old,vista:tabs[next][0]}));e.currentTarget.parentElement.children[next]?.focus();}}}
        onClick={()=>setState(old=>({...old,vista:id}))}>{label}</button>)}
    </div>
    {mode==='anteriores' ? <Suspense fallback={<p role="status">Cargando informes anteriores…</p>}><LegacyInformes/></Suspense> : mode==='centro' ? <ReportCenter key={storageKey} initialState={state} choices={choices} role={user?.rol} ownerId={user?.id}/> : <>
      <Card as="section" className="bi-filterbar"><div className="bi-filter-grid">
        <label>Periodo<select value={state.periodo} onChange={e=>setState(old=>({...old,periodo:e.target.value,page:1}))}>
          <option value="mes">Este mes</option><option value="90d">Últimos 90 días</option><option value="anual">Este año</option><option value="365d">Últimos 365 días</option><option value="personalizado">Personalizado</option></select></label>
        {state.periodo==='personalizado' && <><label>Desde<input type="date" value={state.desde} onChange={e=>setState(old=>({...old,desde:e.target.value,page:1}))}/></label>
          <label>Hasta<input type="date" value={state.hasta} onChange={e=>setState(old=>({...old,hasta:e.target.value,page:1}))}/></label></>}
        {[['cliente_id','Cliente','clientes'],['ruta','Ruta','rutas'],['vehiculo_id','Vehículo','vehiculos'],['ejecucion','Ejecución','ejecuciones']].map(([key,label,option])=><label key={key}>{label}
          <select value={state[key]} onChange={e=>setFilter(key,e.target.value)}><option value="">Todos</option>{(choices[option]||[]).map(x=><option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>)}
      </div><div className="bi-filter-foot"><div className="bi-chips">{active.length ? active.map(key=><button key={key} onClick={()=>setFilter(key,'')} aria-label={`Quitar filtro ${selectedLabel(key,state[key])}`}>{selectedLabel(key,state[key])} ×</button>) : <span>Sin filtros de dimensión</span>}</div>
        <Button onClick={()=>{setState(old=>clearBiFilters(old));setLocalSearch('');}}>Restablecer filtros</Button></div></Card>
      {drillStack.length>0 && <Button onClick={undrill}>← Volver al periodo anterior</Button>}
      {loading && <Card className="bi-feedback" role="status">Calculando indicadores y preparando gráficos…</Card>}
      {!loading && result.error && <Card className="bi-feedback bi-feedback--error" role="alert">{result.error} <Button onClick={()=>setRetry(n=>n+1)}>Reintentar</Button></Card>}
      {!loading && data && <>
        {!phase4 && <div className="bi-coverage" role="status"><strong>Cobertura:</strong> {economy.cobertura.ingresos}/{economy.cobertura.servicios} ingresos, {economy.cobertura.costes}/{economy.cobertura.servicios} costes y {economy.cobertura.km}/{economy.cobertura.servicios} distancias evaluables.
          {economy.cobertura.gastos_pendientes_valorar>0 && <span> {economy.cobertura.gastos_pendientes_valorar} registros pendientes de valorar.</span>}
          {economy.fuentes_no_disponibles?.length>0 && <span> Fuentes no disponibles: {economy.fuentes_no_disponibles.join(', ')}.</span>}
        </div>}
        {!phase4 && economy.cobertura.servicios===0 && <Card className="bi-feedback">No hay servicios realizados para los filtros y el periodo seleccionados. Ajusta los filtros para consultar otra selección.</Card>}
        {mode==='direccion' ? <>
          <div className="bi-kpi-grid">
            <MetricCard title="Ingreso de servicios realizados" metric={metrics.ingreso_realizado} period={data.metadata.periodo} extra={<Comparison item={data.comparacion.ingreso} label="Variación" range={data.metadata.comparacion}/>}/>
            <MetricCard title="Margen directo registrado" metric={metrics.margen_directo} period={data.metadata.periodo} extra={<Comparison item={data.comparacion.margen} label="Variación" range={data.metadata.comparacion}/>}/>
            <MetricCard title="Ingreso por km total" metric={metrics.ingreso_km_total} period={data.metadata.periodo}/>
            <MetricCard title="Kilómetros vacíos" metric={metrics.km_vacios_pct} period={data.metadata.periodo}/>
            <MetricCard title="Realizado pendiente de facturar" metric={metrics.pendiente_facturar} period={data.metadata.periodo} onClick={()=>document.getElementById('bi-servicios')?.scrollIntoView({behavior:'smooth'})}/>
            <MetricCard title="Vencido al corte" metric={metrics.vencido_al_corte} period={data.metadata.periodo} onClick={data.metadata.facturas_atribuibles?()=>document.getElementById('bi-facturas')?.scrollIntoView({behavior:'smooth'}):undefined}/>
          </div>
          <div className="bi-main-grid"><Trend data={data} onDrill={drill}/>
            <Card as="section" className="bi-side-panel"><h2>Lectura de dirección</h2>
              {data.objetivo?.facturacion != null && <div className="bi-insight"><strong>Objetivo de facturación emitida</strong><p>{money(data.objetivo.facturacion)} para el {data.objetivo.periodo==='mensual'?'mes':'año'} completo. Emitido en este corte: {money(economy.facturacion_emitida_neta)}.</p><small>{data.objetivo.nota}</small></div>}
              <div className="bi-insight"><strong>Concentración de ingresos</strong><p>Cliente principal: {economy.concentracion.principal_cliente_pct == null?'no calculable':`${decimal(economy.concentracion.principal_cliente_pct)} %`}. Top 5: {economy.concentracion.top_5_pct == null?'no calculable':`${decimal(economy.concentracion.top_5_pct)} %`}.</p></div>
              <div className="bi-insight"><strong>Operaciones a revisar</strong>{data.revision.length ? <ul>{data.revision.slice(0,6).map((r,i)=><li key={`${r.tipo}-${r.id}-${i}`}><button className="bi-link" onClick={()=>r.tipo==='factura'?navigateInvoice(r):navigateService(r)}>{r.numero || r.tipo}</button> · {r.motivo}</li>)}</ul> : <p>Sin desviaciones detectadas entre los registros evaluables.</p>}</div>
            </Card></div>
          {data.metadata.facturas_atribuibles && <Card as="section" id="bi-facturas" className="bi-section"><div className="bi-section-head"><h2>Facturas vencidas al corte</h2><p>Saldo bruto estimado según estado actual; los pagos parciales no están registrados.</p></div>
            <div className="bi-scroll"><table className="bi-table"><thead><tr>{[['numero','Factura'],['cliente','Cliente'],['fecha_vencimiento','Vencimiento'],['total','Saldo estimado']].map(([key,label])=><th key={key}><button onClick={()=>setState(old=>({...old,invoiceSort:key,invoiceDirection:old.invoiceSort===key&&old.invoiceDirection==='asc'?'desc':'asc',invoicePage:1}))}>{label} {state.invoiceSort===key?(state.invoiceDirection==='asc'?'↑':'↓'):''}</button></th>)}<th>Acción</th></tr></thead><tbody>{data.facturas_vencidas.rows.length ? data.facturas_vencidas.rows.map(f=><tr key={f.id}><td>{f.numero}</td><td>{f.cliente}</td><td>{date(f.fecha_vencimiento)}</td><td>{money(f.total)}</td><td><button className="bi-link" onClick={()=>navigateInvoice(f)}>Abrir factura</button></td></tr>) : <tr><td colSpan="5">Sin facturas vencidas evaluables.</td></tr>}</tbody></table></div>
            <div className="bi-pagination"><span>{data.facturas_vencidas.total} facturas · página {state.invoicePage} de {Math.max(1,Math.ceil(data.facturas_vencidas.total/20))}</span><Button disabled={state.invoicePage<=1} onClick={()=>setState(old=>({...old,invoicePage:old.invoicePage-1}))}>Anterior</Button><Button disabled={state.invoicePage*20>=data.facturas_vencidas.total} onClick={()=>setState(old=>({...old,invoicePage:old.invoicePage+1}))}>Siguiente</Button></div></Card>}
        </> : mode==='rentabilidad' ? <>
          <div className="bi-kpi-grid bi-kpi-grid--four"><MetricCard title="Ingreso realizado" metric={metrics.ingreso_realizado} period={data.metadata.periodo}/>
            <MetricCard title="Costes directos registrados" metric={metrics.coste_directo} period={data.metadata.periodo}/>
            <MetricCard title="Margen directo" metric={metrics.margen_directo} period={data.metadata.periodo}/>
            <MetricCard title="Margen por km total" metric={metrics.margen_km_total} period={data.metadata.periodo}/></div>
          <ChartPanel title="De ingreso a resultado" subtitle="Impactos en EUR netos · el resultado es parcial y muestra solo las categorías reconciliadas."
            rows={data.cascada} columns={[{key:'etiqueta',label:'Concepto'},{key:'impacto',label:'Impacto',render:r=>money(r.impacto)},
              {key:'acumulado',label:'Acumulado',render:r=>money(r.acumulado)}]}
            renderChart={height=><ResponsiveContainer width="100%" height={height}><ComposedChart data={data.cascada} margin={{top:14,right:14,bottom:12,left:8}}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3"/><XAxis dataKey="clave" tick={{fontSize:10,fill:'var(--text3)'}} tickFormatter={v=>({ingreso:'Ingreso',directo:'Directos',taller:'Taller',nomina:'Nómina',estructura:'Estructura'})[v]||v} interval={0} height={34}/>
              <YAxis tick={{fontSize:11,fill:'var(--text3)'}} tickFormatter={v=>`${decimal(v,0)} €`}/><Tooltip formatter={v=>money(v)}/>
              <Bar dataKey="base" stackId="puente" fill="transparent" legendType="none" tooltipType="none"/>
              <Bar dataKey="tramo" stackId="puente" name="Impacto absoluto" radius={[3,3,3,3]}>{data.cascada.map((step,i)=><Cell key={`${step.clave}-${i}`} fill={step.tipo==='coste'?'var(--orange)':'var(--accent)'}/>)}</Bar>
              <Line dataKey="acumulado" name="Acumulado" stroke="var(--link)" strokeWidth={2}/>
            </ComposedChart></ResponsiveContainer>}/>
          <p className="bi-method">{economy.resultado_categorias.importe == null ? 'Resultado después de flota y estructura no atribuible a esta selección.' : `Resultado parcial: ${money(economy.resultado_categorias.importe)}.`} Categorías incluidas: {economy.resultado_categorias.incluidas.join(', ') || 'ninguna'}. Estructura sin atribuir: {money(economy.resultado_categorias.estructura_no_atribuida)}.</p>
          <div className="bi-three-grid"><MarginBars title="Margen por cliente" rows={data.rankings.cliente} onSelect={id=>setFilter('cliente_id',String(id))}/>
            <MarginBars title="Margen por ruta" rows={data.rankings.ruta} onSelect={id=>setFilter('ruta',String(id))}/>
            <MarginBars title="Margen por vehículo" rows={data.rankings.vehiculo} onSelect={id=>id!=='sin_vehiculo'&&setFilter('vehiculo_id',String(id))}/></div>
          <Card as="section" className="bi-section"><div className="bi-section-head"><h2>Flota propia y subcontratación</h2><p>Ingresos y márgenes directos registrados; no son beneficio neto.</p></div>
            <div className="bi-scroll"><table className="bi-table"><thead><tr><th>Ejecución</th><th>Servicios</th><th>Ingreso neto</th><th>Coste directo</th><th>Margen directo</th><th>Cobertura</th></tr></thead><tbody>{(data.matriz.ejecucion||[]).map(r=><tr key={r.id}><td><button className="bi-link" onClick={()=>setFilter('ejecucion',r.id)}>{r.id==='flota_propia'?'Flota propia':'Subcontratación'}</button></td><td>{r.servicios}</td><td>{money(r.ingreso)}</td><td>{money(r.coste_directo_registrado)}</td><td>{money(r.margen_directo_registrado)}</td><td>{r.cobertura_costes.evaluables}/{r.cobertura_costes.total}</td></tr>)}</tbody></table></div></Card>
          <Card as="section" className="bi-section"><div className="bi-section-head"><div><h2>Matriz de rentabilidad</h2><p>Los kilómetros compartidos en grupaje no se suman entre dimensiones.</p></div><label>Desglose <select value={state.matriz} onChange={e=>setState(old=>({...old,matriz:e.target.value,matrizPage:1}))}><option value="cliente">Cliente</option><option value="ruta">Ruta</option><option value="vehiculo">Vehículo</option><option value="ejecucion">Ejecución</option></select></label></div>
            <details className="bi-columns"><summary>Configurar columnas</summary>{Object.entries(columnNames).map(([key,label])=><label key={key}><input type="checkbox" checked={columns.includes(key)} onChange={e=>setState(old=>({...old,columnas:e.target.checked?[...old.columnas,key]:old.columnas.filter(x=>x!==key)}))}/>{label}</label>)}</details>
            <div className="bi-scroll"><table className="bi-table"><thead><tr>{columns.map(key=><th key={key} scope="col"><button onClick={()=>setState(old=>({...old,matrizSort:key,matrizDirection:old.matrizSort===key&&old.matrizDirection==='desc'?'asc':'desc'}))}>{columnNames[key]} {state.matrizSort===key?(state.matrizDirection==='desc'?'↓':'↑'):''}</button></th>)}</tr></thead>
              <tbody>{matrixPageRows.length?matrixPageRows.map(r=><tr key={r.id}>{columns.map(key=><td key={key}>{key==='nombre'?r.nombre:rowNumber(r,key)}</td>)}</tr>):<tr><td colSpan={columns.length}>Sin filas evaluables.</td></tr>}</tbody></table></div>
            <div className="bi-pagination"><span>{matrixRows.length} grupos · página {state.matrizPage} de {Math.max(1,Math.ceil(matrixRows.length/20))}</span><Button disabled={state.matrizPage<=1} onClick={()=>setState(old=>({...old,matrizPage:old.matrizPage-1}))}>Anterior</Button><Button disabled={state.matrizPage*20>=matrixRows.length} onClick={()=>setState(old=>({...old,matrizPage:old.matrizPage+1}))}>Siguiente</Button></div>
          </Card>
        </> : <BiPhase4 kind={mode} data={data} onOpen={row=>navigateService({...row,id:row.order_id||row.id})} onPage={page=>setState(old=>({...old,page}))}/>}
        {!phase4 && <Card as="section" id="bi-servicios" className="bi-section"><div className="bi-section-head"><div><h2>Servicios que explican el agregado</h2><p>La búsqueda de esta tabla es local a la página; los filtros superiores recalculan todo el panel.</p></div>
          <label>Buscar en esta página<input value={localSearch} onChange={e=>setLocalSearch(e.target.value)} placeholder="Número, cliente o ruta"/></label></div>
          <details className="bi-columns"><summary>Configurar columnas del detalle</summary>{serviceDefinitions.map(d=><label key={d.key}><input type="checkbox" checked={state.columnasServicios.includes(d.key)} onChange={e=>setState(old=>({...old,columnasServicios:e.target.checked?[...old.columnasServicios,d.key]:old.columnasServicios.filter(k=>k!==d.key)}))}/>{d.label}</label>)}</details>
          <div className="bi-scroll"><table className="bi-table"><thead><tr>{visibleServiceDefinitions.map(d=><th key={d.key} scope="col"><button onClick={()=>setState(old=>({...old,sort:d.key,direction:old.sort===d.key&&old.direction==='desc'?'asc':'desc',page:1}))}>{d.label} {state.sort===d.key?(state.direction==='desc'?'↓':'↑'):''}</button></th>)}<th>Acción</th></tr></thead>
            <tbody>{serviceRows.length?serviceRows.map(r=><tr key={r.id}>{visibleServiceDefinitions.map(d=><td key={d.key}>{d.render(r)}</td>)}<td><button className="bi-link" onClick={()=>navigateService(r)}>Abrir pedido</button></td></tr>):<tr><td colSpan={visibleServiceDefinitions.length+1}>Sin servicios en esta página o búsqueda.</td></tr>}</tbody></table></div>
          <div className="bi-pagination"><span>{data.servicios.total} servicios · página {state.page} de {Math.max(1,Math.ceil(data.servicios.total/state.limit))}</span>
            <label>Filas<select value={state.limit} onChange={e=>setState(old=>({...old,limit:Number(e.target.value),page:1}))}><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label>
            <Button disabled={state.page<=1} onClick={()=>setState(old=>({...old,page:old.page-1}))}>Anterior</Button><Button disabled={state.page*state.limit>=data.servicios.total} onClick={()=>setState(old=>({...old,page:old.page+1}))}>Siguiente</Button></div>
          <p className="bi-method">{data.servicios.nota_km}</p></Card>}
      </>}
    </>}
  </div>;
}
