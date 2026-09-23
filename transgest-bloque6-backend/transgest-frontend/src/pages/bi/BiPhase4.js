import {useState} from 'react';
import {Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {Badge, Button, Card, Modal} from '../../ui';

const fmt=(n,d=2)=>n==null?'No calculable':new Intl.NumberFormat('es-ES',{maximumFractionDigits:d,minimumFractionDigits:d}).format(Number(n));
const when=v=>v?new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—';
const quality={completo:'Completo',parcial:'Parcial',estimado:'Estimado',sin_datos:'Sin datos',no_aplicable:'No aplicable'};
function Metric({name,item,period}) {
  const unit=item?.unidad||'';
  return <Card className="bi-kpi"><div className="bi-kpi-top"><span>{name}</span><Badge tone={item?.estado==='completo'?'success':'warning'}>{quality[item?.estado]||'Sin datos'}</Badge></div>
    <strong className="bi-kpi-value">{item?.valor==null?'No calculable':`${fmt(item.valor,unit==='registros'||unit==='km'?0:2)} ${unit}`}</strong>
    <details className="bi-definition"><summary>Definición y cobertura</summary><p>{item?.definicion}</p><dl><dt>Fuente/evento</dt><dd>{item?.fecha_evento||'Registro operativo'}</dd>
      <dt>Periodo</dt><dd>{period?.desde} – {period?.hasta}</dd><dt>Cobertura</dt><dd>{item?.cobertura?`${item.cobertura.evaluables}/${item.cobertura.total}`:'No disponible'}</dd>
      <dt>Denominador</dt><dd>{item?.denominador==null?'No aplica':fmt(item.denominador)}</dd></dl></details></Card>;
}
function AccessibleBars({title,rows,valueKey,valueLabel,unit}) {
  const [open,setOpen]=useState(false);
  const chart=height=><ResponsiveContainer width="100%" height={height}><ComposedChart data={rows} margin={{top:10,right:15,left:12,bottom:10}}>
    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3"/><XAxis dataKey="label" tick={{fontSize:11,fill:'var(--text3)'}}/><YAxis tick={{fontSize:11,fill:'var(--text3)'}} tickFormatter={n=>fmt(n,0)}/>
    <Tooltip formatter={n=>`${fmt(n)} ${unit}`}/><Bar dataKey={valueKey} name={valueLabel} fill="var(--accent)" radius={[4,4,0,0]}/>
  </ComposedChart></ResponsiveContainer>;
  const table=<div className="bi-scroll"><table className="bi-table"><thead><tr><th>Concepto</th><th>{valueLabel} ({unit})</th></tr></thead><tbody>
    {rows.length?rows.map((r,i)=><tr key={`${r.label}-${i}`}><td>{r.label}</td><td>{r[valueKey]==null?'No calculable':fmt(r[valueKey])}</td></tr>):<tr><td colSpan="2">Sin datos evaluables.</td></tr>}
  </tbody></table></div>;
  return <Card as="section" className="bi-chart-panel"><div className="bi-section-head"><h2>{title}</h2><Button onClick={()=>setOpen(true)}>Ampliar</Button></div>
    <div className="bi-chart-area" role="img" aria-label={title}>{rows.length?chart(270):<p className="bi-empty">Sin datos evaluables.</p>}</div>
    <details className="bi-chart-table"><summary>Ver datos en tabla</summary>{table}</details>
    <Modal open={open} title={title} onClose={()=>setOpen(false)} width={1100} className="bi-dialog"><div className="bi-chart-area bi-chart-area--large">{rows.length?chart(440):<p className="bi-empty">Sin datos evaluables.</p>}</div>{table}</Modal></Card>;
}
function PagedTable({title,collection,headers,render,onOpen,onPage}) {
  const rows=collection?.rows||[],total=collection?.total||0,page=collection?.page||1,limit=collection?.limit||20;
  return <Card as="section" className="bi-section"><div className="bi-section-head"><h2>{title}</h2><p>{total} registros evaluables</p></div><div className="bi-scroll"><table className="bi-table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}{onOpen&&<th>Acción</th>}</tr></thead>
    <tbody>{rows.length?rows.map((row,i)=><tr key={row.stop_id||row.id||i}>{render(row)}{onOpen&&<td><button className="bi-link" onClick={()=>onOpen(row)}>Abrir pedido</button></td>}</tr>):<tr><td colSpan={headers.length+(onOpen?1:0)}>Sin datos evaluables en esta página.</td></tr>}</tbody></table></div>
    <div className="bi-pagination"><span>Página {page} de {Math.max(1,Math.ceil(total/limit))}</span><Button disabled={page<=1} onClick={()=>onPage(page-1)}>Anterior</Button><Button disabled={page*limit>=total} onClick={()=>onPage(page+1)}>Siguiente</Button></div></Card>;
}
export default function BiPhase4({kind,data,onOpen,onPage}) {
  const info=data?.operations;
  if(!info)return <Card className="bi-feedback">No se recibió el conjunto operativo. Reintenta la consulta.</Card>;
  const m={...info.metricas,gastos_pendientes_valorar:data?.economia?.metricas?.gastos_pendientes_valorar},t=info.tiempos||{};
  const operational=kind==='operaciones',fleet=kind==='flota';
  const keys=operational?[
    ['Puntualidad en recogida','puntualidad_recogida'],['Puntualidad en entrega','puntualidad_entrega'],['OTIF','otif'],['POD pendientes','pod_pendiente'],['Incidencias por servicio','incidencias_servicio']
  ]:fleet?[
    ['Kilómetros totales','km_totales'],['Kilómetros cargados','km_cargados'],['Kilómetros vacíos','km_vacios'],['Combustible por km','coste_combustible_km'],['Mantenimiento por km','mantenimiento_km'],['Consumo por 100 km','consumo_l_100km']
  ]:[['Servicios sin precio','servicios_sin_precio'],['Servicios sin km','servicios_sin_km'],['Gastos sin valorar','gastos_pendientes_valorar'],['Documentación pendiente','pod_pendiente'],['CO₂ estimado','co2_estimado']];
  const timeRows=Object.entries({espera_carga:'Espera carga',carga_efectiva:'Carga efectiva',espera_descarga:'Espera descarga',descarga_efectiva:'Descarga efectiva',recepcion_pod:'Recepción POD'})
    .map(([key,label])=>({label,...t[key]}));
  return <>
    <div className="bi-coverage"><strong>Población:</strong> {info.poblacion.pedidos} pedidos de la cohorte · {info.poblacion.realizados} descargas firmadas. {info.poblacion.criterio}.
      {info.fuentes_no_disponibles?.length>0&&<span> Fuentes ausentes: {info.fuentes_no_disponibles.join(', ')}.</span>}</div>
    <div className="bi-kpi-grid">{keys.map(([name,key])=><Metric key={key} name={name} item={m[key]} period={info.periodo}/>)}</div>
    {operational&&<>
      <div className="bi-main-grid"><AccessibleBars title="Tiempos operativos observados" rows={timeRows.filter(r=>r.mediana!=null)} valueKey="mediana" valueLabel="Mediana" unit="min"/>
        <Card as="section" className="bi-side-panel"><h2>Espera y manipulación</h2><p>Llegada, inicio y finalización son marcas diferentes de cada parada. Una fecha prevista no cuenta como llegada real.</p>
          <div className="bi-scroll"><table className="bi-table"><thead><tr><th>Evento</th><th>Media</th><th>Mediana</th><th>P90</th><th>Cobertura</th></tr></thead><tbody>{timeRows.map(r=><tr key={r.label}><td>{r.label}</td><td>{fmt(r.media)} min</td><td>{fmt(r.mediana)} min</td><td>{fmt(r.p90)} min</td><td>{r.cobertura?.evaluables||0}/{r.cobertura?.total||0}</td></tr>)}</tbody></table></div></Card></div>
      <PagedTable title="Paradas y marcas reales" collection={info.detalle.paradas} headers={['Pedido','Tipo','Parada','Llegada','Inicio','Fin','Espera','Manipulación']}
        render={r=><><td>{r.numero}</td><td>{r.tipo}</td><td>{r.label}</td><td>{when(r.arrival)}</td><td>{when(r.start)}</td><td>{when(r.finish)}</td><td>{fmt(r.wait)} min</td><td>{fmt(r.handling)} min</td></>}
        onOpen={onOpen} onPage={onPage}/>
      <Card as="section" className="bi-section"><h2>Indicadores que requieren trazabilidad adicional</h2><p>{info.pendientes.resolucion_incidencias} {info.pendientes.paralizaciones} {info.pendientes.calidad_colaboradores}</p></Card>
      {info.planner&&<Card as="section" className="bi-section"><div className="bi-section-head"><div><h2>Planner · citas de muelle</h2><p>Vista separada del almacén, visible solo con Planner autorizado y sin filtros de transporte.</p></div></div>
        <p>{info.planner.reservas} reservas en el periodo. Duración efectiva de carga: mediana {fmt(info.planner.duracion_carga.mediana)} min, p90 {fmt(info.planner.duracion_carga.p90)} min ({info.planner.duracion_carga.cobertura.evaluables}/{info.planner.duracion_carga.cobertura.total}).</p>
        <p>{info.planner.ocupacion} {info.planner.espera_y_permanencia}</p><div className="bi-scroll"><table className="bi-table"><thead><tr><th>Muelle</th><th>Almacén</th><th>Citas</th><th>Minutos reservados</th></tr></thead>
          <tbody>{info.planner.por_muelle.length?info.planner.por_muelle.map(r=><tr key={r.id}><td>{r.nombre}</td><td>{r.almacen}</td><td>{r.reservas}</td><td>{fmt(r.minutos_reservados,0)} min</td></tr>):<tr><td colSpan="4">Sin citas evaluables.</td></tr>}</tbody></table></div></Card>}
    </>}
    {fleet&&<>
      <AccessibleBars title="Kilómetros físicos" rows={[
        {label:'Cargados',km:m.km_cargados?.valor},{label:'Vacíos',km:m.km_vacios?.valor}
      ].filter(r=>r.km!=null)} valueKey="km" valueLabel="Distancia" unit="km"/>
      <Card as="section" className="bi-section"><h2>Combustible y flota</h2><p>Litros repostados: {info.flota.litros_repostados==null?'sin registros':`${fmt(info.flota.litros_repostados)} l`}. {info.flota.nota}</p>
        <p>Disponibilidad: {info.pendientes.ocupacion} La utilización necesita estados de vehículo fechados y tiempos activos. El coste por km usa solo registros de flota propia y es parcial.</p></Card>
      <div className="bi-main-grid"><PagedTable title="Repostajes registrados" collection={info.flota.repostajes} headers={['Fecha','Vehículo','Litros','Importe']}
        render={r=><><td>{r.fecha}</td><td>{r.vehiculo}</td><td>{fmt(r.litros)} l</td><td>{r.importe==null?'Sin valorar':`${fmt(r.importe)} €`}</td></>} onPage={onPage}/>
        <PagedTable title="Mantenimiento registrado" collection={info.flota.taller} headers={['Fecha','Vehículo','Tipo','Importe']}
          render={r=><><td>{r.fecha}</td><td>{r.vehiculo}</td><td>{r.tipo}</td><td>{r.importe==null?'Sin valorar':`${fmt(r.importe)} €`}</td></>} onPage={onPage}/></div>
      <PagedTable title="Servicios de flota que explican los kilómetros" collection={info.detalle.servicios} headers={['Pedido','Incidencia','POD','Cargas','Descargas']}
        render={r=><><td>{r.numero}</td><td>{r.incidencia?'Sí':'No registrada'}</td><td>{r.pod_recibido?'Recibido':'Pendiente o no exigible'}</td><td>{r.cargas_confirmadas?'Confirmadas':'Sin confirmar'}</td><td>{r.descargas_confirmadas?'Confirmadas':'Sin confirmar'}</td></>}
        onOpen={onOpen} onPage={onPage}/>
    </>}
    {!operational&&!fleet&&<>
      <Card as="section" className="bi-section"><h2>Metodología de emisiones</h2><p>Estimación no certificada: {fmt(info.emisiones.consumo_l_100km)} l/100 km ({info.emisiones.origen_consumo}) × {fmt(info.emisiones.factor_kg_co2_litro)} kg CO₂/l ({info.emisiones.origen_factor}). En grupajes se reparte por igual el mismo tramo físico entre los pedidos; no se duplica el recorrido. No se calcula CO₂e ni intensidad por tonelada-kilómetro.</p></Card>
      <div className="bi-main-grid"><AccessibleBars title="Emisiones estimadas por cliente" rows={info.emisiones.por_cliente.filter(r=>r.kg_co2_estimado!=null).slice(0,10).map(r=>({label:String(r.nombre).slice(0,18),kg:r.kg_co2_estimado}))} valueKey="kg" valueLabel="CO₂ estimado" unit="kg"/>
        <AccessibleBars title="Emisiones estimadas por vehículo" rows={info.emisiones.por_vehiculo.filter(r=>r.kg_co2_estimado!=null).slice(0,10).map(r=>({label:String(r.nombre).slice(0,18),kg:r.kg_co2_estimado}))} valueKey="kg" valueLabel="CO₂ estimado" unit="kg"/></div>
      <PagedTable title="Estimación por viaje" collection={info.emisiones.por_viaje} headers={['Pedido','CO₂ estimado','Reparto']}
        render={r=><><td>{r.numero}</td><td>{fmt(r.kg_co2_estimado)} kg</td><td>{r.criterio}</td></>}
        onOpen={onOpen} onPage={onPage}/>
      <PagedTable title="Calidad de datos por servicio" collection={info.detalle.servicios} headers={['Pedido','Precio','Kilómetros','POD','Incidencia']}
        render={r=><><td>{r.numero}</td><td>{r.sin_precio?'Sin informar':'Informado'}</td><td>{r.sin_km?'Sin informar':'Informados'}</td>
          <td>{r.entregado?(r.pod_recibido?'Recibido':'Pendiente'):'No exigible todavía'}</td><td>{r.incidencia?'Registrada':'No registrada'}</td></>}
        onOpen={onOpen} onPage={onPage}/>
      <Card as="section" className="bi-section"><h2>Calidad y fuentes pendientes</h2><p>Los servicios sin precio o km y la documentación pendiente se abren desde el detalle. {info.pendientes.consumo} {info.pendientes.planner}</p></Card>
    </>}
  </>;
}
