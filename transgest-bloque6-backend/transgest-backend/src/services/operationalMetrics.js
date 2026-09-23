// BI phase 4: operational events are read from the existing driver workflow.
// Planned dates never substitute for actual timestamps; refuelling is not consumption.
const db = require('./db');
const { day, money, ratio, metric } = require('./financialKpis');
const { physicalKm } = require('./financialEconomics');
const { driverStops, stopData } = require('./driverStops');

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const own = (rows, company) => rows.filter(row => String(row.empresa_id) === String(company));
const finiteDate = value => { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; };
const localParts = date => {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const part = type => parts.find(x => x.type === type)?.value;
  return {date:`${part('year')}-${part('month')}-${part('day')}`, minute:Number(part('hour')) * 60 + Number(part('minute'))};
};
const duration = (a, b) => {const start=finiteDate(a),end=finiteDate(b);if(!start||!end)return null;const minutes=(end-start)/60000;return minutes>=0&&minutes<=7*24*60?money(minutes):null;};
const percentile = (values, fraction) => {if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return money(sorted[Math.ceil(fraction*sorted.length)-1]);};
function distribution(values, eligible) {
  const valid=values.filter(v=>v!=null && v>=0);
  return {media:valid.length?money(valid.reduce((a,b)=>a+b,0)/valid.length):null,
    mediana:percentile(valid,.5),p90:percentile(valid,.9),unidad:'min',
    cobertura:{evaluables:valid.length,total:eligible},estado:!valid.length?'sin_datos':valid.length<eligible?'parcial':'completo'};
}
function explicitWindow(stop, order) {
  const isLoad=stop.tipo==='carga';
  const plannedDate=day(stop.fecha || (isLoad?order.fecha_carga:order.fecha_descarga));
  const text=String(stop.ventana || (isLoad?order.ventana_carga:order.ventana_descarga) || '');
  const match=text.match(/(?:^|\D)([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|–|—|a|hasta)\s*([01]?\d|2[0-3])[:.]([0-5]\d)(?:\D|$)/i);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)||!match)return null;
  const start=Number(match[1])*60+Number(match[2]),end=Number(match[3])*60+Number(match[4]);
  return end>=start?{date:plannedDate,start,end}:null;
}
function punctuality(stops) {
  const eligible=stops.filter(x=>x.window);
  const evaluated=eligible.filter(x=>x.arrival);
  const onTime=evaluated.filter(x=>{const local=localParts(x.arrival);return local.date===x.window.date&&local.minute>=x.window.start&&local.minute<=x.window.end;}).length;
  return {value:evaluated.length?ratio(onTime,evaluated.length,100):null,on_time:onTime,
    cobertura:{evaluables:evaluated.length,total:stops.length,con_ventana:eligible.length},
    estado:!evaluated.length?'sin_datos':evaluated.length<stops.length?'parcial':'completo'};
}
function makeMetric(value, definition, unit, known, total, status, denominator=null) {
  return {...metric(value,definition,{unit,total,known,status,denominator}),fecha_evento:'fecha económica del pedido para seleccionar la cohorte; marcas de tiempo reales para el evento',costes_incluidos:'Ninguno'};
}
function buildOperationalMetrics({empresaId,range,orders=[],steps=[],docs=[],clients=[],vehicles=[],fuel=[],repairs=[],emptyKm=[],config={},missingSources=[],page=1,limit=20,attributionScope=true}) {
  const selected=own(orders,empresaId).filter(p=>String(p.estado)!=='cancelado'&&String(p.origen_producto||'transgest')!=='planner');
  const stepMap=new Map(own(steps,empresaId).map(r=>[String(r.pedido_id),r.data||{}]));
  const docsByOrder=new Map();
  for(const doc of own(docs,empresaId)) {const id=String(doc.pedido_id);if(!docsByOrder.has(id))docsByOrder.set(id,[]);docsByOrder.get(id).push(doc);}
  const loadStops=[],unloadStops=[],serviceRows=[],podDelays=[];
  for(const order of selected) {
    const all=stepMap.get(String(order.id))||{};
    const stops=driverStops(order);
    let loadComplete=true,deliveryComplete=true,deliveredAt=null;
    for(const stop of stops) {
      const data=stopData(stop,all,stops),isLoad=stop.tipo==='carga';
      const arrival=finiteDate(data[isLoad?'carga_iniciada_at':'posicionado_descarga_at']);
      const start=data[isLoad?'carga_proceso_at':'descarga_iniciada_at'];
      const finish=data[isLoad?'carga_ok_at':'descarga_ok_at'];
      const observation={order_id:order.id,numero:order.numero,stop_id:stop.id,label:stop.label,
        window:explicitWindow(stop,order),arrival,wait:duration(arrival,start),handling:duration(start,finish),
        start:finiteDate(start),finish:finiteDate(finish)};
      if(isLoad) {loadStops.push(observation);if(!data.carga_ok)loadComplete=false;}
      else {
        const signed=finiteDate(data.firma_entrega_at)||finiteDate(finish);
        if(!data.firma_entrega)deliveryComplete=false;
        if(signed&&(!deliveredAt||signed>deliveredAt))deliveredAt=signed;
        const plannedBultos=number(stop.bultos ?? (stops.filter(x=>x.tipo==='descarga').length===1?order.bultos:null));
        const plannedWeight=number(stop.peso_kg ?? (stops.filter(x=>x.tipo==='descarga').length===1?order.peso_kg:null));
        const actualBultos=number(data.mercancia_palets),actualWeight=number(data.mercancia_peso_kg);
        observation.complete=!!data.mercancia_confirmada && plannedBultos!=null && plannedWeight!=null && actualBultos!=null && actualWeight!=null
          ? actualBultos>=plannedBultos && actualWeight>=plannedWeight : null;
        unloadStops.push(observation);
      }
    }
    const supporting=(docsByOrder.get(String(order.id))||[]).filter(d=>{
      const kind=`${d.tipo||''} ${d.nombre||''}`.toLowerCase();
      if(/albaran[_\s-]?carga/.test(kind))return false;
      return /(pod|cmr|foto[_\s-]?entrega|albaran[_\s-]?(descarga|entrega))/.test(kind)
        || (/albaran/.test(kind)&&deliveredAt&&finiteDate(d.created_at)>=deliveredAt);
    });
    const received=supporting.map(d=>finiteDate(d.created_at)).filter(Boolean).sort((a,b)=>a-b)[0]||null;
    if(deliveredAt&&received)podDelays.push(duration(deliveredAt,received));
    serviceRows.push({id:order.id,numero:order.numero,cliente_id:order.cliente_id,vehiculo_id:order.vehiculo_id,
      sin_precio:order.importe==null||!Number.isFinite(Number(order.importe)),sin_km:!(number(order.km_ruta)>0),
      incidencia:!!order.incidencia_creada_at||String(order.estado)==='incidencia',
      incidencia_creada_at:order.incidencia_creada_at||null,
      entregado:deliveryComplete&&unloadStops.some(s=>String(s.order_id)===String(order.id)),
      pod_recibido:!!received,pod_recibido_at:received?.toISOString()||null,
      cargas_confirmadas:loadComplete,descargas_confirmadas:deliveryComplete});
  }
  const pickup=punctuality(loadStops),delivery=punctuality(unloadStops);
  const delivered=serviceRows.filter(r=>r.entregado);
  const deliveredStops=unloadStops.filter(s=>delivered.some(r=>String(r.id)===String(s.order_id)));
  const otifEligible=deliveredStops.filter(s=>s.window&&s.arrival&&s.complete!=null);
  const otifGood=otifEligible.filter(s=>s.complete&&punctuality([s]).on_time===1).length;
  const otif=makeMetric(otifEligible.length?ratio(otifGood,otifEligible.length,100):null,
    'Descargas firmadas, dentro de ventana pactada y con bultos/peso reales iguales o superiores a lo planificado; solo paradas con ambos datos','%',otifEligible.length,unloadStops.length,
    !otifEligible.length?'sin_datos':'parcial',otifEligible.length);
  const received=delivered.filter(r=>r.pod_recibido);
  const km=physicalKm(selected.filter(p=>['entregado','facturado'].includes(String(p.estado))),own(emptyKm,empresaId));
  const ownOrders=selected.filter(p=>!p.colaborador_id&&!p.colaborador_nombre&&['entregado','facturado'].includes(String(p.estado)));
  const ownIds=new Set(ownOrders.map(p=>String(p.vehiculo_id)).filter(Boolean));
  const ownKm=physicalKm(ownOrders,own(emptyKm,empresaId).filter(r=>ownIds.has(String(r.vehiculo_id))));
  const ownKmComplete=ownOrders.length>0&&ownKm.cobertura.evaluables===ownOrders.length&&ownKm.cobertura.grupajes_discrepantes===0&&ownKm.total>0;
  const fuelRows=own(fuel,empresaId).filter(r=>ownIds.has(String(r.vehiculo_id)));
  const pricedFuel=fuelRows.filter(r=>number(r.importe)!=null);
  const litres=fuelRows.filter(r=>number(r.litros)!=null).reduce((n,r)=>n+Number(r.litros),0);
  const fuelCost=pricedFuel.reduce((n,r)=>n+Number(r.importe),0);
  const repairRows=repairs.filter(r=>(!r.empresa_id||String(r.empresa_id)===String(empresaId))&&ownIds.has(String(r.vehiculo_id))&&day(r.fecha)>=range.desde&&day(r.fecha)<=range.hasta);
  const pricedRepairs=repairRows.filter(r=>number(r.coste_total)!=null);
  const repairCost=pricedRepairs.reduce((n,r)=>n+Number(r.coste_total),0);
  const noPrice=selected.filter(p=>!Number.isFinite(Number(p.importe))||p.importe==null);
  const noKm=selected.filter(p=>!(number(p.km_ruta)>0));
  const pendingDocs=delivered.filter(r=>!r.pod_recibido);
  const cfg=config?.sostenibilidad||{};
  const consumption=number(cfg.consumo_l_100km)>0?Number(cfg.consumo_l_100km):32;
  const factor=number(cfg.factor_kg_co2_litro)>0?Number(cfg.factor_kg_co2_litro):2.68;
  const legs=new Map();
  for(const p of selected.filter(p=>['entregado','facturado'].includes(String(p.estado))&&number(p.km_ruta)>0)) {
    const key=p.grupaje_id?`g:${p.grupaje_id}:${p.vehiculo_id||'sin_vehiculo'}`:`p:${p.id}`;
    if(!legs.has(key))legs.set(key,[]);legs.get(key).push(p);
  }
  const emissionRows=[];
  for(const rows of legs.values()) {
    if(rows.some(r=>number(r.km_ruta)!==number(rows[0].km_ruta)||Math.max(0,number(r.km_vacio)||0)!==Math.max(0,number(rows[0].km_vacio)||0)))continue;
    const loaded=Math.max(...rows.map(r=>Number(r.km_ruta)));
    const empty=Math.max(...rows.map(r=>Math.max(0,number(r.km_vacio)||0)));
    const totalKg=(loaded+empty)*consumption/100*factor;
    for(const p of rows) emissionRows.push({id:p.id,numero:p.numero,cliente_id:p.cliente_id,vehiculo_id:p.vehiculo_id,
      kg_co2_estimado:money(totalKg/rows.length),criterio:rows.length>1?'reparto igualitario del tramo compartido':'trayecto del pedido'});
  }
  const sumEmissions=rows=>money(rows.reduce((n,r)=>n+r.kg_co2_estimado,0));
  const clientNames=new Map(own(clients,empresaId).map(r=>[String(r.id),r.nombre]));
  const vehicleNames=new Map(own(vehicles,empresaId).map(r=>[String(r.id),r.matricula]));
  const byDimension=key=>[...new Set(emissionRows.map(r=>String(r[key]||'sin_asignar')))].map(id=>({id,nombre:key==='cliente_id'?clientNames.get(id)||id:vehicleNames.get(id)||id,
    kg_co2_estimado:sumEmissions(emissionRows.filter(r=>String(r[key]||'sin_asignar')===id)),servicios:emissionRows.filter(r=>String(r[key]||'sin_asignar')===id).length}));
  const missing=key=>makeMetric(null,`Requiere capturar ${key}; la información actual no permite inferir el evento.`,key==='tiempo'?'min':'%',0,selected.length,'sin_datos');
  const paged=rows=>({total:rows.length,page,limit,rows:rows.slice((page-1)*limit,page*limit)});
  return {version:'bi.operaciones.v1',periodo:range,poblacion:{pedidos:selected.length,realizados:delivered.length,criterio:'cohorte por fecha económica del pedido; eventos reales por parada'},
    metricas:{
      puntualidad_recogida:makeMetric(pickup.value,'Llegadas reales a carga dentro de la ventana pactada explícita; llegada=carga_iniciada_at','%',pickup.cobertura.evaluables,loadStops.length,pickup.estado,pickup.cobertura.evaluables),
      puntualidad_entrega:makeMetric(delivery.value,'Llegadas reales a descarga dentro de la ventana pactada explícita; llegada=posicionado_descarga_at','%',delivery.cobertura.evaluables,unloadStops.length,delivery.estado,delivery.cobertura.evaluables),
      otif,
      pod_pendiente:makeMetric(missingSources.includes('pedido_docs')||!delivered.length?null:pendingDocs.length,'Entregas firmadas sin POD, albarán de descarga, CMR ni foto de entrega registrados','registros',missingSources.includes('pedido_docs')?0:delivered.length,delivered.length,missingSources.includes('pedido_docs')||!delivered.length?'sin_datos':'completo',delivered.length),
      incidencias_servicio:makeMetric(selected.length?serviceRows.filter(r=>r.incidencia).length:null,'Pedidos con incidencia registrada o estado actual de incidencia; no equivale a todos los episodios históricos','registros',serviceRows.length,serviceRows.length,selected.length?'parcial':'sin_datos',serviceRows.length),
      km_totales:makeMetric(km.cobertura.evaluables?km.total:null,'Km físicos cargados y vacíos, deduplicados por grupaje y vehículo','km',km.cobertura.evaluables,selected.length,km.cobertura.evaluables?'parcial':'sin_datos'),
      km_cargados:makeMetric(km.cobertura.evaluables?km.cargados:null,'Km físicos con carga según ruta del pedido, deduplicados','km',km.cobertura.evaluables,selected.length,km.cobertura.evaluables?'parcial':'sin_datos'),
      km_vacios:makeMetric(km.cobertura.evaluables?km.vacios:null,'Km vacíos del pedido y registros manuales sin duplicar la app','km',km.cobertura.evaluables,selected.length,km.cobertura.evaluables?'parcial':'sin_datos'),
      consumo_l_100km:missing('litros consumidos y km entre aforos de depósito; los repostajes no son consumo'),
      coste_combustible_km:makeMetric(attributionScope&&ownKmComplete&&pricedFuel.length?ratio(fuelCost,ownKm.total):null,
        'Coste de repostajes registrados de flota propia / km físicos de flota propia; periodificación y conciliación pendientes. No atribuible a cliente/ruta','EUR/km',pricedFuel.length,fuelRows.length,!attributionScope?'no_aplicable':ownKmComplete&&pricedFuel.length?'parcial':'sin_datos',ownKm.total),
      mantenimiento_km:makeMetric(attributionScope&&ownKmComplete&&pricedRepairs.length?ratio(repairCost,ownKm.total):null,
        'Coste de taller registrado del vehículo / km físicos de flota propia del periodo; posible desfase temporal. No atribuible a cliente/ruta','EUR/km',pricedRepairs.length,repairRows.length,!attributionScope?'no_aplicable':ownKmComplete&&pricedRepairs.length?'parcial':'sin_datos',ownKm.total),
      disponibilidad_vehiculos:missing('historial fechado de estados de vehículo y tiempo disponible'),
      utilizacion_vehiculos:missing('tiempo disponible y tiempo activo con inicio/fin por vehículo'),
      ocupacion_carga:missing('capacidad homogénea por tramo y carga medida en la misma unidad'),
      servicios_sin_precio:makeMetric(selected.length?noPrice.length:null,'Pedidos de la cohorte sin importe de venta informado','registros',selected.length,selected.length,selected.length?'completo':'sin_datos',selected.length),
      servicios_sin_km:makeMetric(selected.length?noKm.length:null,'Pedidos de la cohorte sin km cargados válidos','registros',selected.length,selected.length,selected.length?'completo':'sin_datos',selected.length),
      co2_estimado:makeMetric(emissionRows.length?sumEmissions(emissionRows):null,
        'Estimación: km cargados y vacíos asignados al pedido × consumo configurado o valor orientativo × factor diésel; no certificada. No incluye vacío manual sin viaje asociado; grupajes discrepantes excluidos','kg CO2 estimado',emissionRows.length,selected.filter(p=>['entregado','facturado'].includes(String(p.estado))).length,emissionRows.length?'parcial':'sin_datos')
    },
    tiempos:{espera_carga:distribution(loadStops.map(s=>s.wait),loadStops.length),carga_efectiva:distribution(loadStops.map(s=>s.handling),loadStops.length),
      espera_descarga:distribution(unloadStops.map(s=>s.wait),unloadStops.length),descarga_efectiva:distribution(unloadStops.map(s=>s.handling),unloadStops.length),
      recepcion_pod:distribution(podDelays,delivered.length)},
    puntualidad:{recogida:pickup,entrega:delivery},
    flota:{litros_repostados:attributionScope&&fuelRows.length?money(litres):null,nota:'Litros repostados no son litros consumidos.',km_propia:ownKm.total,cobertura_km_propia:ownKm.cobertura,
      repostajes:attributionScope?paged(fuelRows.map(r=>({id:r.id,fecha:day(r.fecha),vehiculo:own(vehicles,empresaId).find(v=>String(v.id)===String(r.vehiculo_id))?.matricula||String(r.vehiculo_id),litros:number(r.litros),importe:number(r.importe)}))):paged([]),
      taller:attributionScope?paged(repairRows.map((r,i)=>({id:r.id||`repair:${i}`,fecha:day(r.fecha),vehiculo:own(vehicles,empresaId).find(v=>String(v.id)===String(r.vehiculo_id))?.matricula||String(r.vehiculo_id),tipo:r.tipo||'Sin tipo',importe:number(r.coste_total)}))):paged([])},
    emisiones:{por_viaje:paged(emissionRows),por_cliente:byDimension('cliente_id'),por_vehiculo:byDimension('vehiculo_id'),
      factor_kg_co2_litro:factor,consumo_l_100km:consumption,origen_factor:number(cfg.factor_kg_co2_litro)>0?'empresa':'valor orientativo existente',
      origen_consumo:number(cfg.consumo_l_100km)>0?'empresa':'valor orientativo existente',certificada:false},
    detalle:{servicios:paged(serviceRows),paradas:paged([...loadStops.map(s=>({...s,tipo:'carga'})),...unloadStops.map(s=>({...s,tipo:'descarga'}))].map(s=>({...s,arrival:s.arrival?.toISOString()||null,start:s.start?.toISOString()||null,finish:s.finish?.toISOString()||null})))},
    pendientes:{resolucion_incidencias:'Falta evento de cierre enlazado a incidencia.',paralizaciones:'Importe documentado facturable, líneas emitidas y cobros aplicados no están conciliados por paralización.',
      calidad_colaboradores:'Muestra histórica por proveedor y SLA acordado insuficientes para una puntuación fiable.',consumo:'Los repostajes no prueban consumo.',ocupacion:'Falta capacidad por tramo en unidad comparable.',planner:'Las reservas de muelle son del producto Planner y no se mezclan con esta cohorte transportista.'},
    fuentes_no_disponibles:missingSources};
}
async function loadOperationalEvidence(empresaId,orderIds,queryDb=db.query) {
  if(!empresaId)throw Object.assign(new Error('Sin empresa_id'),{status:401});
  if(!orderIds.length)return {steps:[],docs:[],config:{},missingSources:[]};
  const optional=async(name,sql,params)=>{if(queryDb!==db.query&&!(await queryDb('SELECT to_regclass($1) AS relation',[name])).rows[0]?.relation)
    return {rows:[],missingSource:name};try{return await queryDb(sql,params);}catch(error){if(error.code==='42P01')return {rows:[],missingSource:name};throw error;}};
  const ids=orderIds.map(String);
  const [steps,docs,company]=await Promise.all([
    optional('pedido_chofer_pasos','SELECT pedido_id,empresa_id,data FROM pedido_chofer_pasos WHERE empresa_id=$1 AND pedido_id=ANY($2::uuid[])',[empresaId,ids]),
    optional('pedido_docs','SELECT pedido_id,empresa_id,tipo,nombre,created_at FROM pedido_docs WHERE empresa_id=$1 AND pedido_id=ANY($2::uuid[])',[empresaId,ids]),
    queryDb('SELECT cfg_precios FROM empresas WHERE id=$1',[empresaId])]);
  return {steps:steps.rows,docs:docs.rows,config:company.rows[0]?.cfg_precios||{},missingSources:[steps.missingSource,docs.missingSource].filter(Boolean)};
}
async function loadPlannerMetrics(empresaId,range,queryDb=db.query) {
  if(!empresaId)throw Object.assign(new Error('Sin empresa_id'),{status:401});
  if(queryDb!==db.query&&!(await queryDb("SELECT to_regclass('planner_reservas') AS relation")).rows[0]?.relation)
    return {estado:'sin_datos',fuente_no_disponible:true,reservas:0,por_muelle:[],duracion_carga:distribution([],0)};
  let rows;
  try {
    ({rows}=await queryDb(`SELECT r.id,r.pedido_id,r.muelle_id,r.inicio,r.fin,m.nombre AS muelle,m.almacen,
      pp.carga_inicio_at,pp.carga_fin_at
      FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id AND m.empresa_id=r.empresa_id
      JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id AND p.origen_producto='planner'
      LEFT JOIN LATERAL (SELECT x.carga_inicio_at,x.carga_fin_at FROM planner_preparaciones x
        WHERE x.empresa_id=r.empresa_id AND x.pedido_id=r.pedido_id AND x.estado<>'cancelada'
        ORDER BY x.carga_inicio_at DESC NULLS LAST LIMIT 1) pp ON true
      WHERE r.empresa_id=$1 AND r.inicio < ($3::date + INTERVAL '1 day') AND r.fin >= $2::date
      ORDER BY r.inicio`,[empresaId,range.desde,range.hasta]));
  } catch(error) {if(error.code==='42P01')return {estado:'sin_datos',fuente_no_disponible:true,reservas:0,por_muelle:[],duracion_carga:distribution([],0)};throw error;}
  const dock=new Map(),durations=[];
  for(const r of rows) {
    const id=String(r.muelle_id),booked=duration(r.inicio,r.fin);
    if(!dock.has(id))dock.set(id,{id,nombre:r.muelle,almacen:r.almacen,reservas:0,minutos_reservados:0});
    const item=dock.get(id);item.reservas++;item.minutos_reservados+=booked||0;
    durations.push(duration(r.carga_inicio_at,r.carga_fin_at));
  }
  return {estado:rows.length?'parcial':'sin_datos',fuente_no_disponible:false,reservas:rows.length,
    por_muelle:[...dock.values()].map(r=>({...r,minutos_reservados:money(r.minutos_reservados)})),
    duracion_carga:distribution(durations,rows.length),
    espera_y_permanencia:'Sin llegada real ni salida real del recinto: no calculables.',
    ocupacion:'Minutos reservados por muelle, no utilización física ni porcentaje de capacidad.',
    criterio:'Solo reservas de pedidos con origen_producto=planner y empresa autorizada; separado del BI transportista.'};
}
module.exports={buildOperationalMetrics,loadOperationalEvidence,loadPlannerMetrics,distribution,explicitWindow,punctuality};
