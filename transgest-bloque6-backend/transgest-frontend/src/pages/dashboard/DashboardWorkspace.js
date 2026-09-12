import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useAuth } from "../../context/AuthContext";
import { Button, Card, Icon, KpiCard, DataTable, MobileDataCard, EmptyState, Badge } from "../../ui";
import "./dashboard.css";

const money = n => Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const datePart = d => String(d || "").slice(0,10);
const dateLabel = d => d ? new Date(`${datePart(d)}T12:00:00`).toLocaleDateString("es-ES") : "—";
const activeStates = ["confirmado","espera_carga","cargando","en_curso","espera_descarga","descarga"];
const validInvoice = f => !["borrador","cancelada","anulada"].includes(String(f.estado || "").toLowerCase());

function Section({ title, icon, action, children, className = "" }) {
  return <Card className={`dashboard-card ${className}`}><header><h2><Icon name={icon} size={19}/>{title}</h2>{action}</header>{children}</Card>;
}

export default function DashboardWorkspace({ pedidos, facturas, vehiculos, choferes, alertas, tareas, loadErrors, reload, loading, today, navigate, openOrder, openAlert, advanced, stateMeta }) {
  const { puedeVer, puedeEditar } = useAuth();
  const data = useMemo(() => {
    const now = new Date(), todayKey = dayKey(now), month = todayKey.slice(0,7);
    const current = pedidos.filter(p => p.estado !== "cancelado");
    const invoices = facturas.filter(f => validInvoice(f) && datePart(f.fecha).startsWith(month));
    const agenda = current.flatMap(p => ["carga","descarga"].filter(kind => datePart(p[`fecha_${kind}`]) === todayKey).map(kind => ({
      id: `${p.id}-${kind}`, p, kind, time: String(p[`hora_${kind}`] || "").slice(0,5), place: kind === "carga" ? p.origen : p.destino,
    }))).sort((a,b) => (a.time || "99").localeCompare(b.time || "99"));
    const monday = new Date(now); monday.setDate(now.getDate() - (now.getDay()+6)%7);
    const week = Array.from({length:7}, (_,i) => { const d = new Date(monday); d.setDate(d.getDate()+i); const key = dayKey(d); return {
      day:d.toLocaleDateString("es-ES",{weekday:"short",day:"numeric"}),
      cargas:current.filter(p => datePart(p.fecha_carga) === key).length,
      descargas:current.filter(p => datePart(p.fecha_descarga) === key).length,
    }; });
    const clients = new Map(); invoices.forEach(f => { const key = f.cliente_id || f.cliente_nombre || "Sin cliente"; const row = clients.get(key) || {id:key,name:f.cliente_nombre || "Sin nombre",total:0}; row.total += Number(f.base_imponible || 0); clients.set(key,row); });
    const ranking = [...clients.values()].sort((a,b) => b.total-a.total).slice(0,5);
    const due = [];
    const addDue = (id,title,date,view,focusKey,focus) => {
      const parsed = new Date(`${datePart(date)}T12:00:00`), end = new Date(now); end.setDate(end.getDate()+30);
      if (!date || !Number.isFinite(parsed.getTime()) || datePart(date)<todayKey || parsed>end) return;
      due.push({id,title,date,view,focusKey,focus});
    };
    vehiculos.forEach(v => [["ITV",v.fecha_itv],["Seguro",v.fecha_seguro]].forEach(([label,date]) => addDue(`${v.id}-${label}`,`${label} · ${v.matricula || "Vehículo"}`,date,"vehiculos","tms_vehiculos_focus",{vehiculo_id:v.id,section:"documentacion"})));
    choferes.forEach(c => [["CAP",c.cap_vencimiento],["Carnet",c.carnet_vencimiento],["Médico",c.medico_vencimiento]].forEach(([label,date]) => addDue(`${c.id}-${label}`,`${label} · ${c.nombre || "Conductor"}`,date,"choferes","tms_choferes_focus",{chofer_id:c.id,section:"documentacion"})));
    facturas.filter(f => validInvoice(f) && !["cobrada","rectificada"].includes(f.estado)).forEach(f => addDue(f.id,`Factura ${f.numero || ""}`,f.fecha_vencimiento,"facturacion","tms_facturacion_focus",{factura_id:f.id}));
    return {
      agenda, week, ranking, due:due.sort((a,b) => datePart(a.date).localeCompare(datePart(b.date))),
      active:current.filter(p => activeStates.includes(p.estado)).length,
      today:current.filter(p => datePart(p.fecha_carga)===todayKey).length,
      billed:invoices.reduce((s,f) => s+Number(f.base_imponible||0),0),
      incidents:current.filter(p => p.estado === "incidencia").length,
      recent:[...pedidos].sort((a,b) => String(b.fecha_pedido||b.created_at||b.fecha_carga||"").localeCompare(String(a.fecha_pedido||a.created_at||a.fecha_carga||""))).slice(0,5),
      route:current.filter(p => p.estado === "en_curso").length,
      handling:current.filter(p => ["cargando","descarga"].includes(p.estado)).length,
      workshop:vehiculos.filter(v => v.estado === "taller").length,
    };
  }, [pedidos,facturas,vehiculos,choferes]);
  const link = (label,view) => puedeVer(view) ? <button className="dashboard-link" onClick={() => navigate(view)}>{label} <span aria-hidden="true">→</span></button> : null;
  const status = p => <Badge tone={p.estado === "incidencia" ? "danger" : p.estado === "pendiente" ? "warning" : "success"}>{stateMeta(p.estado).label}</Badge>;
  const quick = [
    ["Nuevo pedido","invoice","pedidos",true,() => openOrder({action:"nuevo"})],
    ["Asignar vehículo","truck","pedidos",true,() => navigate("pedidos")],
    ["Peticiones de viaje","route","solicitudes",false],
    ["Revisar incidencias","alert","pedidos",false,() => openOrder({estado:"incidencia",title:"Incidencias"})],
    ["Calcular porte","coins","calculador_portes",false],
    ["Facturación","invoice","facturacion",false],
    ["Gestionar clientes","clients","clientes",false],
    ["Control Tower","shield","control_tower",false],
  ].filter(([, ,view,edit]) => puedeVer(view) && (!edit || puedeEditar(view)));
  const availableAlerts = alertas.filter(a => puedeVer(a.view || "control_tower"));
  const due = data.due.filter(a => puedeVer(a.view));
  const columns = [
    {key:"numero",label:"Nº pedido",render:p => <button className="dashboard-link" onClick={() => openOrder({pedido_id:p.id,numero:p.numero})}>{p.numero || "Ver pedido"}</button>},
    {key:"fecha",label:"Carga",render:p => dateLabel(p.fecha_carga)},
    {key:"cliente_nombre",label:"Cliente"}, {key:"origen",label:"Origen"}, {key:"destino",label:"Destino"},
    {key:"estado",label:"Estado",render:status}, {key:"vehiculo_matricula",label:"Vehículo",render:p => p.vehiculo_matricula || "Sin asignar"},
    {key:"importe",label:"Importe",render:p => money(p.importe ?? p.precio ?? p.precio_cliente_col)},
  ];
  return <main className="dashboard-workspace">
    <div className="dashboard-heading"><div><h1>Dashboard</h1><p>Vista general de la actividad de tu empresa de transporte. Todo lo importante, en un solo lugar.</p></div><div className="dashboard-heading-actions"><span><Icon name="clock" size={17}/>{today}</span><Button onClick={advanced}>Análisis detallado</Button></div></div>
    {!!loadErrors.length && <div className="dashboard-error" role="alert">No se pudieron cargar: {loadErrors.join(", ")}. El resumen está incompleto. <Button onClick={reload}>Reintentar</Button></div>}
    {loading ? <div role="status" className="dashboard-loading">Cargando actividad…</div> : <>
    <div className="dashboard-kpis">
      {[["Viajes activos",data.active,"truck","success","pedidos","Confirmados y en operación"],["Pedidos de hoy",data.today,"invoice","info","pedidos","Con fecha de carga hoy"],["Facturación del mes",money(data.billed),"coins","success","facturacion","Base imponible · sin borradores"],["Incidencias activas",data.incidents,"alert","danger","pedidos","Pedidos en estado incidencia"]].filter(k => puedeVer(k[4])).map(([label,value,icon,tone,view,detail]) => <button key={label} className="dashboard-kpi-button" onClick={() => label==="Incidencias activas" ? openOrder({estado:"incidencia"}) : navigate(view)}><KpiCard {...{label,value,icon,tone,detail}}/></button>)}
    </div>
    <div className="dashboard-grid">
      {puedeVer("pedidos") && <Section title="Agenda de hoy" icon="clock" className="dashboard-agenda" action={link("Ver agenda completa","agenda")}><p className="dashboard-caption">Cargas y descargas previstas · {data.agenda.length} eventos</p><div className="dashboard-scroll">{data.agenda.length ? data.agenda.map(e => <button key={e.id} className="dashboard-agenda-row" onClick={() => openOrder({pedido_id:e.p.id,numero:e.p.numero})}><time>{e.time || "Sin hora"}</time><Badge tone={e.kind === "carga" ? "success" : "info"}>{e.kind === "carga" ? "Carga" : "Descarga"}</Badge><span>{e.p.cliente_nombre || "Sin cliente"}</span><span>{e.place || "Sin ubicación"}</span><small>{e.p.vehiculo_matricula || "Sin asignar"}</small></button>) : <EmptyState title="Sin cargas ni descargas previstas hoy"/>}</div></Section>}
      <Section title="Acciones rápidas" icon="route" className="dashboard-quick"><div className="dashboard-quick-grid">{quick.map(([label,icon,view,,action]) => <Button key={label} onClick={action || (() => navigate(view))}><Icon name={icon} size={19}/>{label}</Button>)}</div>{!quick.length && <EmptyState title="Sin accesos disponibles"/>}</Section>
      <Section title="Alertas y tareas" icon="alert" className="dashboard-alerts" action={link("Ver avisos","avisos")}><div className="dashboard-scroll">{availableAlerts.map((a,i) => <button key={i} className="dashboard-alert-row" onClick={() => openAlert(a)}><Icon name="alert" size={20}/><span>{a.texto}<small>{a.actionLabel || "Revisar"}</small></span><Icon name="chevron" size={14}/></button>)}{tareas.filter(t=>puedeVer(t.view)).map(t=><button key={t.id} className="dashboard-alert-row" onClick={()=>navigate(t.view)}><Icon name="invoice"/><span>{t.titulo || t.title || t.descripcion || "Tarea asignada"}<small>Asignada a ti</small></span></button>)}{!availableAlerts.length && !tareas.length && <EmptyState title="Sin alertas ni tareas en los datos cargados"/>}</div></Section>
      {puedeVer("pedidos") && <Section title="Pedidos recientes" icon="invoice" className="dashboard-recent" action={link("Ver todos los pedidos","pedidos")}><DataTable rows={data.recent} columns={columns} emptyTitle="Todavía no hay pedidos" renderMobile={p => <MobileDataCard title={p.numero} subtitle={`${p.cliente_nombre||"Sin cliente"} · ${p.origen||"—"} → ${p.destino||"—"}`} amount={money(p.importe ?? p.precio ?? p.precio_cliente_col)} actions={<Button onClick={() => openOrder({pedido_id:p.id,numero:p.numero})}>Ver pedido</Button>}>{status(p)}<span>{dateLabel(p.fecha_carga)}</span></MobileDataCard>}/></Section>}
      <Section title="Próximos vencimientos" icon="clock" className="dashboard-due"><p className="dashboard-caption">Próximos 30 días · {due.length} vencimientos</p><div className="dashboard-scroll">{due.map(d => <button key={d.id} className="dashboard-due-row" onClick={() => openAlert(d)}><Icon name="clock" size={20}/><span>{d.title}</span><time>{dateLabel(d.date)}</time></button>)}{!due.length && <EmptyState title="Sin vencimientos próximos en los datos cargados"/>}</div></Section>
      {puedeVer("pedidos") && <Section title="Actividad semanal" icon="route" className="dashboard-week"><p className="dashboard-caption">Cargas y descargas planificadas · semana actual</p><div className="dashboard-chart" role="img" aria-label={data.week.map(d=>`${d.day}: ${d.cargas} cargas, ${d.descargas} descargas`).join("; ")}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.week} margin={{top:8,right:8,left:-25,bottom:0}}><CartesianGrid vertical={false} stroke="var(--border)"/><XAxis dataKey="day" tick={{fontSize:10,fill:"var(--text3)"}} axisLine={false} tickLine={false}/><YAxis allowDecimals={false} tick={{fontSize:10,fill:"var(--text3)"}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"var(--card-bg)",borderColor:"var(--border)",color:"var(--text)"}}/><Bar dataKey="cargas" name="Cargas" fill="var(--accent)" radius={[3,3,0,0]}/><Bar dataKey="descargas" name="Descargas" fill="#83cdb9" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div><div className="dashboard-legend"><span>Cargas</span><span>Descargas</span></div></Section>}
      {puedeVer("facturacion") && <Section title="Facturación por cliente" icon="coins" className="dashboard-ranking"><p className="dashboard-caption">Mes actual · base imponible emitida</p>{data.ranking.length ? data.ranking.map(c => <div className="dashboard-ranking-row" key={c.id}><span title={c.name}>{c.name}</span><div><i style={{width:`${Math.max(0,c.total)/Math.max(1,...data.ranking.map(r=>r.total))*100}%`}}/></div><strong>{money(c.total)}</strong></div>) : <EmptyState title="Sin facturación emitida este mes"/>}</Section>}
      {puedeVer("control_tower") && <Section title="Control Tower" icon="shield" className="dashboard-tower" action={link("Abrir control","control_tower")}><div className="dashboard-tower-grid">{[[data.route,"Pedidos en ruta"],[data.handling,"En carga / descarga"],[data.workshop,"Vehículos en taller"]].map(([n,label])=><div key={label}><strong>{n}</strong><small>{label}</small></div>)}</div><Button className="dashboard-tower-action" onClick={() => navigate("control_tower")}><Icon name="shield"/>Consultar seguimiento operativo <Icon name="chevron" size={16}/></Button><p className="dashboard-caption">Resumen de los datos cargados al abrir el Dashboard.</p></Section>}
    </div></>}
  </main>;
}
