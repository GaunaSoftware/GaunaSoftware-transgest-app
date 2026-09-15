import "./refinements.css";
import { orderByDate, groupOrderDates } from "./dateGroups";
import { useEffect, useState } from "react";
import { Page, PageHeader, Button, Card, KpiCard, Badge, Icon, FilterBar, SearchInput, Select, DataTable, MobileDataCard, DropdownMenu, Modal } from "../../ui";
import "./orders.css";

const dayKey = value => String(value || "").slice(0,10);
const todayKey = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const stateTone = state => state === "incidencia" || state === "cancelado" ? "danger" : ["entregado","en_curso","descarga"].includes(state) ? "success" : state === "pendiente" ? "warning" : "neutral";
const dateLabel = value => { const key=dayKey(value); return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key.split("-").reverse().join("/") : "—"; };
const incidentLabel = p => p.incidencia_tipo?.replace(/_/g," ") || (p.estado === "incidencia" ? "Incidencia operativa" : "");

export default function OrdersWorkspace({ items, allItems, loading, error, reload, clients, drivers, labels, filters, actions, permissions, selectedIds, toggleSelected, tools, bulkTools, serverPage, serverPages, totalCount, setServerPage, describe }) {
  const [actionPanel,setActionPanel]=useState(null);
  const [showTools,setShowTools]=useState(false);
  const [size,setSize]=useState(10), [localPage,setLocalPage]=useState(1);
  useEffect(()=>setLocalPage(1),[items.length,filters.q,filters.state,filters.client,filters.from,filters.to,filters.unassigned,filters.critical,serverPage,size]);
  const countPages=Math.max(1,Math.ceil(items.length/size)), current=Math.min(localPage,countPages);
  const rows=groupOrderDates(orderByDate(items).slice((current-1)*size,current*size),items);
  const selected=items.filter(item=>selectedIds.includes(String(item.pedido.id)));
  const single=selected.length===1 ? selected[0].pedido : null;
  const unassigned=allItems.filter(item=>item.priorityMeta.flags.missingAssignment);
  const incidents=allItems.filter(item=>item.pedido.estado === "incidencia");
  const today=todayKey();
  const kpis=[
    {label:"Cargas hoy",value:allItems.filter(i=>dayKey(i.pedido.fecha_carga)===today).length,icon:"invoice",tone:"neutral"},
    {label:"En tránsito",value:allItems.filter(i=>i.pedido.estado === "en_curso").length,icon:"truck",tone:"success"},
    {label:"Pendientes de asignar",value:unassigned.length,icon:"clock",tone:"warning"},
    {label:"Entregados",value:allItems.filter(i=>i.pedido.estado === "entregado").length,icon:"shield",tone:"success"},
    {label:"Incidencias",value:incidents.length,icon:"alert",tone:"danger"},
  ];
  const isLocked=p=>permissions.finalInvoice(p);
  const canAssign=p=>permissions.edit && !isLocked(p) && !permissions.draftInvoice(p);
  const canOrder=p=>permissions.edit && permissions.supplierOrder(p);
  const driver=p=>p.chofer_nombre || drivers.find(d=>String(d.id)===String(p.chofer_id))?.nombre || p.chofer_nombre_manual || (p.colaborador_id ? "Gestionado por el colaborador" : "Sin asignar");
  function exportList(){
    const quote=v=>`"${String(v??"").replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')}"`;
    const data=[["Pedido","Cliente","Origen","Destino","Carga","Matrícula","Conductor","Estado","Incidencia"],...items.map(({pedido:p})=>{const route=describe(p);return [p.numero,p.cliente_nombre,route.origin,route.destination,p.fecha_carga,p.vehiculo_matricula||p.matricula_manual,driver(p),labels[p.estado]||p.estado,incidentLabel(p)];})];
    const url=URL.createObjectURL(new Blob(["\ufeff",data.map(row=>row.map(quote).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="pedidos-listado.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function panel(p,kind){
    const groups={
      'Cambiar estado':Object.entries(labels).filter(([state])=>state!==p.estado&&state!=="cancelado").map(([state,label])=>({label,onClick:()=>actions.changeState(p,state)})),
      'Asignación':[{label:'Asignar camión, conductor o colaborador',onClick:()=>actions.assign(p)},{label:'Autoasignación IA',onClick:()=>actions.autoAssign(p)},{label:'Limpiar asignación',onClick:()=>actions.clearAssignment(p)},{label:'Retrasar pedido',onClick:()=>actions.delay(p)},{label:'Ver en mesa de tráfico',onClick:()=>actions.traffic(p)}],
      'Documentos':[{label:'Carta de porte / CMR',onClick:()=>actions.letter(p)},...(canOrder(p)?[{label:'Orden de carga',onClick:()=>actions.order(p)}]:[]),...(permissions.invoice&&p.estado==='entregado'&&!isLocked(p)&&!permissions.draftInvoice(p)?[{label:'Facturar',onClick:()=>actions.invoice(p)}]:[])],
      'Avisos':[{label:'WhatsApp al cliente',onClick:()=>actions.send(p)},...(p.chofer_id?[{label:'Avisar en la app del conductor',onClick:()=>actions.notifyDriver(p)},{label:'WhatsApp al conductor',onClick:()=>actions.sendTo(p,'chofer')}]:[]),...(p.colaborador_telefono?[{label:'WhatsApp al colaborador',onClick:()=>actions.sendTo(p,'colaborador')}]:[])],
    };
    setActionPanel({title:`${kind} · ${p.numero||''}`,items:groups[kind]});
  }
  const rowActions=p=><div className="orders-row-actions"><Button aria-label={`Ver pedido ${p.numero}`} onClick={()=>actions.open(p)}>Ver</Button><DropdownMenu label={`Acciones de ${p.numero}`} items={[
    ...(canAssign(p)?[{label:'Cambiar estado',onClick:()=>panel(p,'Cambiar estado')},{label:'Asignación',onClick:()=>panel(p,'Asignación')}]:[]),
    {label:'Documentos',onClick:()=>panel(p,'Documentos')},
    ...(permissions.edit&&!isLocked(p)?[{label:'Avisos',onClick:()=>panel(p,'Avisos')}]:[]),
    ...(permissions.edit?[{label:'Copiar pedido',onClick:()=>actions.copy(p)}]:[]),
    ...(canAssign(p)&&p.estado!=='cancelado'?[{label:'Cancelar pedido',onClick:()=>actions.cancel(p)}]:[]),
    ...(canAssign(p)&&p.estado==='cancelado'?[{label:'Eliminar pedido',onClick:()=>actions.remove(p)}]:[]),
  ]}/></div>;
  const check=p=><input type="checkbox" aria-label={`Seleccionar ${p.numero}`} checked={selectedIds.includes(String(p.id))} onChange={()=>toggleSelected(p.id)} />;
  const columns=[{key:"selection",label:<span className="orders-sr">Selección</span>,render:({pedido:p})=>check(p)},
    {key:"number",label:"Pedido",render:({pedido:p})=><button className="orders-link" onClick={()=>actions.open(p)}>{p.numero || "Sin número"}</button>},
    {key:"client",label:"Cliente",render:({pedido:p})=>p.cliente_nombre || clients.find(c=>String(c.id)===String(p.cliente_id))?.nombre || "—"},
    {key:"origin",label:"Origen",render:({pedido:p})=>{const r=describe(p);return <><span>{r.origin}</span>{r.loads>1&&<small>+{r.loads-1} cargas</small>}</>;}},
    {key:"destination",label:"Destino",render:({pedido:p})=>{const r=describe(p);return <><span>{r.destination}</span>{r.unloads>1&&<small>+{r.unloads-1} descargas</small>}</>;}},
    {key:"date",label:"Fecha carga",render:({pedido:p})=><span className="orders-date">{dateLabel(p.fecha_carga)}<small>{String(p.hora_carga||"").slice(0,5)}</small></span>},
    {key:"vehicle",label:"Matrícula",render:({pedido:p})=><>{p.vehiculo_matricula || p.matricula_manual || p.matricula_colaborador || (p.colaborador_id ? "Asignado a colaborador" : "Sin asignar")}{p.colaborador_id&&<small>{p.colaborador_nombre || "Colaborador"}</small>}</>},
    {key:"driver",label:"Conductor",render:({pedido:p})=>driver(p)},
    {key:"state",label:"Estado",render:({pedido:p})=><><span title={p.incidencia_descripcion||incidentLabel(p)}><Badge tone={stateTone(p.estado)}>{labels[p.estado] || p.estado || "Sin estado"}</Badge></span>{isLocked(p)&&<small>Facturado</small>}{p.estado==="cancelado"&&p.motivo_cancelacion&&<small>{p.motivo_cancelacion}</small>}</>},
    {key:"incident",label:"Incidencia",render:({pedido:p,priorityMeta:m})=>incidentLabel(p)?<span title={p.incidencia_descripcion||incidentLabel(p)} className="orders-incident"><Icon name="alert" size={14}/>{incidentLabel(p)}</span>:m.validationIssues.length?<span title={m.validationIssues.join(" · ")} className="orders-warning">Datos pendientes ({m.validationIssues.length})</span>:"—"},
    {key:"actions",label:"Acciones",render:({pedido:p})=>rowActions(p)}];
  return <Page className="orders-workspace">{actionPanel&&<Modal title={actionPanel.title} onClose={()=>setActionPanel(null)}><div className="order-action-choices">{actionPanel.items.map(item=><Button key={item.label} onClick={()=>{setActionPanel(null);item.onClick();}}>{item.label}</Button>)}</div></Modal>}<PageHeader title="Pedidos / Tráfico" description="Control y seguimiento de tus pedidos de transporte." actions={<><span className="orders-today">{new Date().toLocaleDateString("es-ES",{day:"numeric",month:"long",year:"numeric"})}</span>{permissions.edit&&<Button variant="primary" onClick={actions.new}>+ Nuevo pedido</Button>}<DropdownMenu label="Opciones de pedidos" items={[...(permissions.edit?[{label:"Pedido rápido",onClick:actions.quick}]:[]),{label:"Planificación y bandeja IA",onClick:()=>setShowTools(v=>!v)}]}/></>}/>
    {showTools&&<Card className="orders-tools-panel"><Button onClick={()=>setShowTools(false)}>Cerrar herramientas</Button>{tools}</Card>}
    <div className="orders-layout"><div className="orders-main"><div className="orders-kpis">{kpis.map(k=><KpiCard key={k.label} {...k} value={loading||error?"—":k.value} detail="En el listado cargado"/>)}</div>
      <Card className="orders-list-card"><FilterBar search={<SearchInput label="Buscar pedidos" value={filters.q} onChange={e=>filters.setQ(e.target.value)} placeholder="Buscar por pedido, cliente, origen, destino…"/>} advanced={<>
        <label>Fecha de carga desde<input className="tgui-input" type="date" value={filters.from} onChange={e=>filters.setFrom(e.target.value)}/></label>
        <label>Fecha de carga hasta<input className="tgui-input" type="date" value={filters.to} onChange={e=>filters.setTo(e.target.value)}/></label>
        <label><input type="checkbox" checked={filters.history} onChange={e=>filters.setHistory(e.target.checked)}/> Incluir meses anteriores</label>
        <label><input type="checkbox" checked={filters.unassigned} onChange={e=>filters.setUnassigned(e.target.checked)}/> Sin asignación completa</label>
        <label><input type="checkbox" checked={filters.critical} onChange={e=>filters.setCritical(e.target.checked)}/> Solo críticos</label>
        <label><input type="checkbox" checked={filters.incomplete} onChange={e=>filters.setIncomplete(e.target.checked)}/> Pendientes de completar</label><label><input type="checkbox" checked={filters.external} onChange={e=>filters.setExternal(e.target.checked)}/> Solo colaboradores</label>
      </>}><Select label="Estado del pedido" value={filters.state} onChange={e=>filters.setState(e.target.value)}><option value="todos">Todos los estados</option><option value="activos">Activos</option>{Object.entries(labels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</Select><Select label="Cliente de pedidos" value={filters.client} onChange={e=>filters.setClient(e.target.value)}><option value="">Todos los clientes</option>{clients.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</Select><Button onClick={exportList} disabled={loading||!!error||!items.length}>Exportar</Button></FilterBar>
        <div className="orders-scope"><span>{filters.history?"Histórico incluido":filters.from||filters.to?`${dateLabel(filters.from)} – ${dateLabel(filters.to)}`:"Hoy y días siguientes"}{filters.unassigned?" · Sin asignación":""}{filters.critical?" · Solo críticos":""}</span><Button onClick={filters.reset}>Restablecer filtros</Button></div>
        {selected.length>0&&<div className="orders-selection"><strong>{selected.length} seleccionados</strong><Button onClick={actions.selectAll}>Seleccionar todos los filtrados</Button><Button onClick={actions.clearSelection}>Quitar selección</Button></div>}
        {selected.length>0&&permissions.edit&&bulkTools}
        {error?<div className="orders-error" role="alert"><p>No se han podido cargar los pedidos.</p><Button onClick={reload}>Reintentar</Button></div>:<DataTable loading={loading} rows={rows} rowKey={i=>i.__group?i.id:i.pedido.id} renderGroup={g=><div className={`orders-date-group orders-date-group-${g.level}`}><strong>{g.label}</strong>{g.count!=null&&<span>{g.count} pedidos en el listado filtrado</span>}</div>} rowId={i=>`order-compact-${i.pedido.id}`} columns={columns} emptyTitle="No hay pedidos con estos filtros" rowClassName={i=>!i.__group&&selectedIds.includes(String(i.pedido.id))?"orders-selected":""} renderMobile={({pedido:p,priorityMeta:m})=><MobileDataCard title={<button className="orders-link" onClick={()=>actions.open(p)}>{p.numero}</button>} subtitle={p.cliente_nombre} actions={<>{check(p)}{rowActions(p)}</>}><span>{describe(p).origin} → {describe(p).destination}</span><span>Carga: {dateLabel(p.fecha_carga)} {String(p.hora_carga||"").slice(0,5)}</span><span>{p.vehiculo_matricula||p.matricula_manual||"Sin camión"} · {driver(p)}</span><Badge tone={stateTone(p.estado)}>{labels[p.estado]||p.estado}</Badge>{incidentLabel(p)&&<span className="orders-incident">{incidentLabel(p)}{p.incidencia_descripcion?`: ${p.incidencia_descripcion}`:""}</span>}{m.validationIssues.length>0&&<small>{m.validationIssues.length} datos pendientes</small>}</MobileDataCard>}/>}
        <footer className="orders-pagination"><small>{items.length?`${(current-1)*size+1}–${Math.min(current*size,items.length)} de ${items.length}`:"0"} pedidos cargados · {totalCount} en la consulta</small><div><Button aria-label="Página anterior de pedidos" disabled={current===1} onClick={()=>setLocalPage(current-1)}>‹</Button><span>{current} / {countPages}</span><Button aria-label="Página siguiente de pedidos" disabled={current===countPages} onClick={()=>setLocalPage(current+1)}>›</Button><Select label="Pedidos por página" value={size} onChange={e=>setSize(Number(e.target.value))}><option value={10}>10 por página</option><option value={25}>25 por página</option><option value={50}>50 por página</option></Select></div>{serverPages>1&&<div><Button disabled={serverPage===1} onClick={()=>setServerPage(serverPage-1)}>Cargar bloque anterior</Button><span>Bloque {serverPage} / {serverPages}</span><Button disabled={serverPage===serverPages} onClick={()=>setServerPage(serverPage+1)}>Cargar más pedidos</Button></div>}</footer>
      </Card>
    </div><aside className="orders-aside" aria-label="Seguimiento de tráfico">
      <Card><header><h2>Viajes pendientes</h2><Button onClick={()=>filters.setUnassigned(!filters.unassigned)}>{filters.unassigned?"Ver todos":"Ver pendientes"}</Button></header><div className="orders-side-count"><Icon name="truck" size={30}/><div><strong>{loading||error?"—":unassigned.length}</strong><small>pedidos sin asignación completa</small></div></div><ul><li><b>{unassigned.filter(i=>dayKey(i.pedido.fecha_carga)===today).length}</b> con fecha de carga hoy</li><li><b>{unassigned.filter(i=>i.priorityMeta.flags.urgentAssignment).length}</b> urgentes</li><li><b>{unassigned.filter(i=>i.priorityMeta.flags.overdueAssignment).length}</b> con carga vencida</li></ul>{permissions.edit&&<Button variant="primary" onClick={()=>single&&canAssign(single)?actions.assign(single):filters.setUnassigned(true)}>{single&&canAssign(single)?"Asignar camión al seleccionado":"Elegir pedido para asignar"}</Button>}</Card>
      <Card><header><h2>Incidencias</h2><Button onClick={()=>filters.setState("incidencia")}>Ver todas</Button></header><div className="orders-side-count orders-incident"><Icon name="alert" size={30}/><div><strong>{loading||error?"—":incidents.length}</strong><small>pedidos con incidencia en el listado</small></div></div>{incidents.slice(0,3).map(({pedido:p})=><Button className="orders-incident-row" key={p.id} onClick={()=>actions.open(p)}><b>{p.numero}</b><span>{incidentLabel(p)}</span></Button>)}<Button onClick={()=>filters.setState("incidencia")}>Revisar incidencias</Button></Card>
      <Card><header><h2>Acciones rápidas</h2></header><small>Selecciona un pedido en la tabla.</small><div className="orders-quick-actions"><Button disabled={!single||!canAssign(single)} onClick={()=>actions.assign(single)}>Asignar camión</Button><Button disabled={!single||!permissions.edit} onClick={()=>actions.copy(single)}>Copiar pedido</Button><Button disabled={!single||!canOrder(single)} onClick={()=>actions.order(single)}>Ver / imprimir OC</Button><Button disabled={!single||!permissions.edit||isLocked(single)} onClick={()=>actions.send(single)}>Avisar al cliente</Button></div><Button onClick={()=>setShowTools(v=>!v)} aria-expanded={showTools}>Planificación y bandeja IA</Button></Card>
    </aside></div>
  </Page>;
}
