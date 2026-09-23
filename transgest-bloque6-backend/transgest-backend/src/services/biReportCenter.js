// BI reports use the same, tenant-scoped metric contract as the interactive workspace.
// Saved configuration is a whitelist of catalogue identifiers, never executable SQL.
const db = require('./db');
const { readWorkspace } = require('./financialWorkspace');

const VERSION = 'bi.report.v1';
const METRICS = Object.freeze({
  ingreso_realizado:'Ingreso de servicios realizados', coste_directo:'Coste directo registrado',
  margen_directo:'Margen directo registrado', resultado_con_categorias:'Resultado con categorías declaradas',
  ingreso_km_total:'Ingreso por km total', km_vacios_pct:'Km vacíos',
  pendiente_facturar:'Realizado pendiente de facturar', facturacion_emitida:'Facturación emitida neta',
  saldo_al_corte:'Saldo estimado al corte', vencido_al_corte:'Vencido estimado al corte',
  gastos_pendientes_valorar:'Gastos pendientes de valorar',
  puntualidad_recogida:'Puntualidad en recogida', puntualidad_entrega:'Puntualidad en entrega',
  otif:'Entregas a tiempo y completas', pod_pendiente:'POD pendientes',
  incidencias_servicio:'Servicios con incidencia registrada'
});
const COLUMNS = Object.freeze({
  numero:{label:'Pedido',type:'text'}, fecha:{label:'Fecha',type:'date'}, cliente:{label:'Cliente',type:'text'},
  ruta:{label:'Ruta',type:'text'}, vehiculo:{label:'Vehículo',type:'text'}, ejecucion:{label:'Ejecución',type:'text'},
  ingreso:{label:'Ingreso neto',type:'money'}, coste:{label:'Coste directo',type:'money'},
  margen:{label:'Margen directo',type:'money'}, km_pedido:{label:'Km cargados del pedido',type:'number'},
  pendiente_factura:{label:'Pendiente de facturar',type:'boolean'},
  fecha_vencimiento:{label:'Vencimiento',type:'date'}, total:{label:'Total con impuestos',type:'money'},
  nombre:{label:'Dimensión',type:'text'}, servicios:{label:'Servicios',type:'number'},
  coste_directo_registrado:{label:'Coste directo',type:'money'},
  margen_directo_registrado:{label:'Margen directo',type:'money'}, margen_pct:{label:'Margen %',type:'number'},
  km_total:{label:'Km totales',type:'number'}, km_vacios:{label:'Km vacíos',type:'number'},
  incidencia:{label:'Incidencia registrada',type:'boolean'}, pod_recibido:{label:'POD recibido',type:'boolean'},
  entregado:{label:'Entrega confirmada',type:'boolean'}, cargas_confirmadas:{label:'Cargas confirmadas',type:'boolean'},
  descargas_confirmadas:{label:'Descargas confirmadas',type:'boolean'}
});
const TEMPLATES = Object.freeze({
  ejecutivo:{name:'Resumen ejecutivo de gerencia',kind:'servicios',metrics:['ingreso_realizado','margen_directo','ingreso_km_total','km_vacios_pct','pendiente_facturar','vencido_al_corte'],columns:['numero','fecha','cliente','ruta','ingreso','coste','margen'],dimensions:['cliente','ruta','vehiculo','ejecucion'],charts:['evolucion','barras']},
  vehiculo:{name:'Explotación por vehículo',kind:'vehiculo',metrics:['ingreso_realizado','coste_directo','margen_directo','ingreso_km_total','km_vacios_pct','gastos_pendientes_valorar'],columns:['nombre','servicios','ingreso','coste_directo_registrado','margen_directo_registrado','km_total','km_vacios'],dimensions:['vehiculo'],charts:['barras']},
  rentabilidad:{name:'Rentabilidad por cliente o ruta',kind:'rentabilidad',metrics:['ingreso_realizado','coste_directo','margen_directo'],columns:['nombre','servicios','ingreso','coste_directo_registrado','margen_directo_registrado','margen_pct'],dimensions:['cliente','ruta'],charts:['barras']},
  pendiente:{name:'Servicios realizados pendientes de facturar',kind:'pendiente',metrics:['ingreso_realizado','pendiente_facturar'],columns:['numero','fecha','cliente','ruta','ingreso','pendiente_factura'],dimensions:['cliente','ruta'],charts:['barras']},
  vencida:{name:'Cartera vencida al corte',kind:'vencida',metrics:['saldo_al_corte','vencido_al_corte'],columns:['numero','cliente','fecha_vencimiento','total'],dimensions:['cliente'],charts:['barras']},
  servicio_cliente:{name:'Calidad de servicio para un cliente',kind:'calidad',metrics:['puntualidad_recogida','puntualidad_entrega','otif','pod_pendiente','incidencias_servicio'],columns:['numero','cargas_confirmadas','descargas_confirmadas','entregado','incidencia','pod_recibido'],dimensions:['cliente'],charts:['barras']}
});
const FILTERS = ['cliente_id','ruta','vehiculo_id','ejecucion'];
const PREVIEW_PAGE_SIZE = 25;
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T12:00:00Z`))&&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
function catalogue() {
  return {version:VERSION,templates:Object.entries(TEMPLATES).map(([id,t])=>({id,...t})),metrics:METRICS,columns:COLUMNS,
    periods:['mes','semana_anterior','90d','anual','365d','personalizado'],scopes:['personal','compartida']};
}
function uniqueSubset(input,allowed,label) {
  if (!Array.isArray(input) || !input.length || input.length>allowed.length || input.some(x=>!allowed.includes(x))) fail(`${label} fuera del catálogo autorizado`);
  return [...new Set(input)];
}
function validateConfig(raw={}) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) fail('Configuración inválida');
  const template=String(raw.template||''); const t=TEMPLATES[template]; if(!t)fail('Plantilla no autorizada');
  const periodo=String(raw.periodo||'mes');
  if(!['mes','semana_anterior','90d','anual','365d','personalizado'].includes(periodo))fail('Periodo inválido');
  const desde=periodo==='personalizado'?String(raw.desde||''):'';
  const hasta=periodo==='personalizado'?String(raw.hasta||''):'';
  if(periodo==='personalizado'&&(!validDate(desde)||!validDate(hasta)||desde>hasta))fail('Rango de fechas inválido');
  const filters={}; for(const key of FILTERS){const value=String(raw.filtros?.[key]||'').trim();if(value.length>240)fail('Filtro demasiado largo');if(value)filters[key]=value;}
  if(t.kind==='calidad'&&!filters.cliente_id) fail('El informe de calidad requiere un cliente');
  const metrics=uniqueSubset(raw.metricas||t.metrics,t.metrics,'Métricas');
  const columns=uniqueSubset(raw.columnas||t.columns,t.columns,'Columnas');
  const dimension=String(raw.dimension||t.dimensions[0]);if(!t.dimensions.includes(dimension))fail('Dimensión no autorizada');
  const charts=uniqueSubset(raw.visualizaciones||t.charts,t.charts,'Visualizaciones');
  const groupBy=String(raw.agrupacion||dimension);if(!t.dimensions.includes(groupBy))fail('Agrupación no autorizada');
  const sort=String(raw.orden?.columna||columns[0]);if(!columns.includes(sort))fail('Columna de orden no autorizada');
  const direction=raw.orden?.direccion==='desc'?'desc':'asc';
  return {template,periodo,desde,hasta,filtros:filters,metricas:metrics,columnas:columns,dimension,agrupacion:groupBy,
    orden:{columna:sort,direccion:direction},visualizaciones:charts};
}
function authorizedRows(workspace,config) {
  const t=TEMPLATES[config.template];
  switch(t.kind) {
    case 'vehiculo': return workspace.matriz.vehiculo;
    case 'rentabilidad': return workspace.matriz[config.agrupacion];
    case 'pendiente': return workspace.servicios.rows.filter(r=>r.pendiente_factura);
    case 'vencida': return workspace.facturas_vencidas.rows;
    case 'calidad': return (workspace.operations?.detalle?.servicios?.rows||[]);
    default:return workspace.servicios.rows;
  }
}
function projectReport(workspace,config,company={}) {
  const t=TEMPLATES[config.template];
  const source=t.kind==='calidad'?workspace.operations?.metricas:workspace.economia.metricas;
  if(!source)fail('Fuente de métricas no disponible',503);
  const metrics=config.metricas.map(id=>({id,label:METRICS[id],...source[id]}));
  const sourceRows=[...authorizedRows(workspace,config)];
  const {columna,direccion}=config.orden; const type=COLUMNS[columna].type;
  const groupColumn=['ejecutivo','pendiente','vencida'].includes(t.kind)?({cliente:'cliente',ruta:'ruta',vehiculo:'vehiculo',ejecucion:'ejecucion'})[config.agrupacion]:null;
  sourceRows.sort((a,b)=>{if(groupColumn&&groupColumn!==columna){const group=String(a[groupColumn]||'').localeCompare(String(b[groupColumn]||''),'es');if(group)return group;}
    const av=a[columna],bv=b[columna];if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;
    const comparison=['money','number'].includes(type)?Number(av||0)-Number(bv||0):String(av||'').localeCompare(String(bv||''),'es');
    return direccion==='desc'?-comparison:comparison;});
  const rows=sourceRows.map(row=>Object.fromEntries(config.columnas.map(key=>[key,row[key]??null])));
  const chart=config.visualizaciones.includes('evolucion')?workspace.evolucion.map(r=>({fecha:r.fecha,ingreso:r.ingreso,margen:r.margen})):[];
  let bars=[];
  if(config.visualizaciones.includes('barras')) {
    if(t.kind==='calidad') bars=metrics.filter(m=>m.unidad==='%'&&m.valor!=null).map(m=>({label:m.label,value:m.valor,unit:'%'}));
    else {
      const candidates=t.kind==='ejecutivo'?workspace.matriz[config.agrupacion]:authorizedRows(workspace,config);
      const valueKey=t.kind==='ejecutivo'?'margen_directo_registrado':t.kind==='vencida'?'total':
        ['vehiculo','rentabilidad'].includes(t.kind)?'margen_directo_registrado':'ingreso';
      const labelKey=['vehiculo','rentabilidad','ejecutivo'].includes(t.kind)?'nombre':t.kind==='vencida'?'numero':'numero';
      bars=[...candidates].filter(r=>Number.isFinite(Number(r[valueKey]))).sort((a,b)=>Math.abs(Number(b[valueKey]))-Math.abs(Number(a[valueKey])))
        .slice(0,8).map(r=>({label:String(r[labelKey]||'Sin referencia'),value:Number(r[valueKey]),unit:'EUR'}));
    }
  }
  const warnings=metrics.filter(m=>m.estado!=='completo').map(m=>`${m.label}: ${m.estado||'sin cobertura'}${m.definicion?` - ${m.definicion}`:''}`);
  if(workspace.economia?.fuentes_no_disponibles?.length&&t.kind!=='calidad')warnings.push(`Fuentes no disponibles: ${workspace.economia.fuentes_no_disponibles.join(', ')}`);
  return {version:VERSION,metric_contract:t.kind==='calidad'?workspace.operations.version:workspace.economia.version,
    title:company.reportTitle||t.name,description:company.reportDescription||'',company:{name:company.name||'Empresa',logo:company.logo||null},config,
    metadata:{periodo:workspace.metadata.periodo,fecha_corte:workspace.metadata.periodo.hasta,
      generated_at:new Date().toISOString(),scope:'Empresa autenticada; datos de detalle completos',
      view_id:company.viewId||null,coverage:t.kind==='calidad'?null:workspace.economia?.cobertura||null,total_rows:rows.length},
    metrics,columns:config.columnas.map(id=>({id,...COLUMNS[id]})),rows,chart,bars,
    bars_label:bars.length>=8?'Top 8 por importe absoluto; el detalle contiene todos los registros':'Selección representada; el detalle contiene todos los registros',warnings};
}
function previewReport(snapshot,page=1) {
  const pageNumber=Number(page);
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>1000000)fail('Página de informe no válida');
  return {...snapshot,rows:snapshot.rows.slice((pageNumber-1)*PREVIEW_PAGE_SIZE,pageNumber*PREVIEW_PAGE_SIZE),
    metadata:{...snapshot.metadata,total_rows:snapshot.rows.length,page:pageNumber,page_size:PREVIEW_PAGE_SIZE}};
}
async function runReport(empresaId,ownerId,config,viewId=null,queryDb=db.query,viewMeta={}) {
  const safe=validateConfig(config);
  const result=await db.transaction(async client=>{
    const scoped=(sql,params)=>client.query(sql,params);
    const query={periodo:safe.periodo,...(safe.periodo==='personalizado'?{desde:safe.desde,hasta:safe.hasta}:{}),
      ...safe.filtros,page:1,limit:Number.MAX_SAFE_INTEGER,invoice_page:1,
      ...(safe.template==='servicio_cliente'?{vista:'operaciones'}:{})};
    const [workspace,companyRow]=await Promise.all([
      readWorkspace(empresaId,query,{queryDb:scoped,exportAll:true,plannerAuthorized:false}),
      scoped('SELECT to_jsonb(e) AS data FROM empresas e WHERE e.id=$1',[empresaId])
    ]);
    const e=companyRow.rows[0]?.data||{};
    const rawLogo=String(e.logo_base64||'');
    const logo=rawLogo.startsWith('data:image/')?rawLogo:rawLogo&&rawLogo.length<1400000?
      `data:${e.cfg_precios?.logo_mime||'image/png'};base64,${rawLogo}`:null;
    return projectReport(workspace,safe,{name:e.razon_social||e.nombre||'Empresa',logo,viewId,
      reportTitle:viewMeta.nombre,reportDescription:viewMeta.descripcion});
  },{readOnlyRepeatableRead:true});
  const snapshot=JSON.stringify(result);
  if(Buffer.byteLength(snapshot,'utf8')>50*1024*1024)fail('El informe supera 50 MB; acota el periodo',413);
  const inserted=await queryDb(`INSERT INTO bi_report_runs(empresa_id,owner_id,view_id,snapshot,contract_version)
    VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at`,[empresaId,ownerId,viewId,snapshot,VERSION]);
  return {id:inserted.rows[0].id,expires_at:inserted.rows[0].expires_at,report:previewReport(result)};
}
module.exports={VERSION,METRICS,COLUMNS,TEMPLATES,catalogue,validateConfig,projectReport,previewReport,runReport};
