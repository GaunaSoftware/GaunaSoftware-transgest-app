import { useEffect, useMemo, useState } from "react";
import { getControlTower } from "../services/api";
import { setRuntimeFocus } from "../services/runtimeFocus";

const S = {
  page: { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:"var(--text)" },
  card: { background:"var(--card-bg)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 18px" },
  sec: { fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:".08em", color:"var(--text5)", marginBottom:8 },
};

const SEV = {
  critica: { label:"Critica", color:"#ef4444", bg:"rgba(239,68,68,.08)", border:"rgba(239,68,68,.35)" },
  alta: { label:"Alta", color:"#f97316", bg:"rgba(249,115,22,.08)", border:"rgba(249,115,22,.35)" },
  media: { label:"Media", color:"#f59e0b", bg:"rgba(245,158,11,.08)", border:"rgba(245,158,11,.35)" },
  baja: { label:"Baja", color:"#3b82f6", bg:"rgba(59,130,246,.08)", border:"rgba(59,130,246,.32)" },
  info: { label:"Info", color:"var(--accent-xl)", bg:"rgba(20,184,166,.09)", border:"rgba(20,184,166,.28)" },
};

const PERIODS = { hoy:"Hoy", "7d":"Proximos 7 dias", mes:"Este mes" };

function navegar(view) {
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: view }));
}

function abrirItem(item) {
  if (!item) return;
  const focus = {
    pedido_id: item.entity_id || "",
    factura_id: item.entity_id || "",
    vehiculo_id: item.entity_id || "",
    source: "control_tower",
    action: item.action || "",
    type: item.type || "",
    area: item.area || "",
    severity: item.severity || "",
    title: item.title || "",
    description: item.description || "",
  };
  if ((item.view === "pedidos" || item.view === "gestion_trafico") && focus.pedido_id) {
    setRuntimeFocus("tms_pedidos_focus", focus);
    navegar("pedidos");
    return;
  }
  if (item.view === "pedidos" || item.view === "gestion_trafico") {
    setRuntimeFocus("tms_trafico_focus", focus);
    navegar("gestion_trafico");
    return;
  }
  if (item.view === "facturacion") {
    setRuntimeFocus("tms_facturacion_focus", focus);
    navegar("facturacion");
    return;
  }
  if (item.view === "vehiculos") {
    setRuntimeFocus("tms_vehiculos_gps_focus", focus);
    navegar("vehiculos");
    return;
  }
  navegar(item.view || "excepciones");
}

function abrirAccion(item, action) {
  if (!item || !action) return;
  const focus = {
    pedido_id: item.entity_id || "",
    factura_id: item.entity_id || "",
    vehiculo_id: item.entity_id || "",
    source: "control_tower",
    action: action.label || item.action || "",
    action_key: action.key || "",
    type: item.type || "",
    area: item.area || "",
    severity: item.severity || "",
    title: item.title || "",
    description: item.description || "",
    requires_confirmation: !!action.requires_confirmation,
  };
  const targetView = action.view || item.view || "excepciones";
  if ((targetView === "gestion_trafico" || targetView === "pedidos") && focus.pedido_id) {
    setRuntimeFocus("tms_pedidos_focus", focus);
    navegar("pedidos");
    return;
  }
  if (targetView === "gestion_trafico" || targetView === "pedidos") {
    setRuntimeFocus("tms_trafico_focus", focus);
    navegar("gestion_trafico");
    return;
  }
  if (targetView === "facturacion") {
    setRuntimeFocus("tms_facturacion_focus", focus);
    navegar("facturacion");
    return;
  }
  if (targetView === "vehiculos") {
    setRuntimeFocus("tms_vehiculos_gps_focus", focus);
    navegar("vehiculos");
    return;
  }
  navegar(targetView);
}

function abrirViajeEnTrafico(trip, extra = {}) {
  if (!trip) return;
  const route = trip.route || parseRouteFromItem(trip || {});
  setRuntimeFocus("tms_pedidos_focus", {
    pedido_id: trip.entity_id || trip.id || trip.pedido_id || "",
    source: "control_tower",
    action: extra.action || "Abrir viaje",
    action_key: extra.action_key || "",
    type: trip.type || extra.type || "viaje",
    area: trip.area || "Trafico",
    severity: trip.severity || "",
    title: trip.title || `Viaje ${trip.numero || trip.pedido_numero || ""}`.trim(),
    description: trip.description || `${trip.cliente_nombre || "Cliente"} - ${route.origen || trip.origen || "-"} -> ${route.destino || trip.destino || "-"}`,
  });
  navegar("pedidos");
}

function TowerItem({ item }) {
  const sev = SEV[item?.severity] || SEV.info;
  return (
    <div style={{border:`1px solid ${sev.border}`,background:sev.bg,borderRadius:8,padding:"12px 13px",display:"flex",flexDirection:"column",gap:7,minHeight:148}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
        <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:sev.color}}>{sev.label}</span>
        <span style={{fontSize:10,color:"var(--text5)",fontWeight:800}}>{item.area}</span>
      </div>
      <div style={{fontSize:14,fontWeight:900,color:"var(--text)",lineHeight:1.25}}>{item.title}</div>
      <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.35,flex:1}}>{item.description}</div>
      {Array.isArray(item.next_actions) && item.next_actions.length > 0 && (
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:2}}>
          {item.next_actions.slice(0, 4).map(action=>(
            <button key={action.key || action.label} onClick={()=>abrirAccion(item, action)}
              style={{fontSize:10,fontWeight:800,border:`1px solid ${action.primary ? "rgba(20,184,166,.35)" : "var(--border)"}`,background:action.primary ? "rgba(20,184,166,.10)" : "var(--bg3)",color:action.primary ? "var(--accent-xl)" : "var(--text4)",borderRadius:20,padding:"3px 8px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              {action.label}
            </button>
          ))}
        </div>
      )}
      <button onClick={()=>abrirItem(item)} style={{alignSelf:"flex-start",border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",borderRadius:7,padding:"6px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
        {item.action || "Abrir"}
      </button>
    </div>
  );
}

function MetricBox({ label, value, detail, color = "var(--accent-xl)" }) {
  return (
    <div style={{border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",background:"var(--bg3)",minHeight:74}}>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color}}>{Number(value || 0)}</div>
      <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
      {detail && <div style={{fontSize:11,color:"var(--text4)",marginTop:4,lineHeight:1.25}}>{detail}</div>}
    </div>
  );
}

function MapMovedPanel({ item }) {
  if (!item) return null;
  const route = parseRouteFromItem(item || {});
  return (
    <div style={S.card}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
        <div>
          <div style={S.sec}>Mapa del pedido</div>
          <div style={{fontSize:14,fontWeight:900,color:"var(--text)"}}>{item.numero || item.pedido_numero || item.title || "Viaje seleccionado"}</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:4,lineHeight:1.35}}>
            {route.origen || item.origen || "-"} -&gt; {route.destino || item.destino || "-"}
          </div>
          <div style={{fontSize:11,color:"var(--text5)",marginTop:8,lineHeight:1.35}}>
            El mapa se abre dentro del pedido para evitar vistas incompletas en Control Tower.
          </div>
        </div>
        <button
          type="button"
          onClick={() => abrirViajeEnTrafico(item, { action:"Ver mapa del pedido", action_key:"mapa_pedido" })}
          style={{border:"1px solid rgba(20,184,166,.35)",background:"rgba(20,184,166,.12)",color:"var(--accent-xl)",borderRadius:8,padding:"8px 12px",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
        >
          Abrir pedido
        </button>
      </div>
    </div>
  );
}

function FlowPanel({ flujo = [], selectedKey = "", onStatusClick }) {
  const rows = Array.isArray(flujo) ? flujo : [];
  const max = Math.max(1, ...rows.map(r => Number(r.total || 0)));
  return (
    <div style={S.card}>
      <div style={S.sec}>Visibilidad extremo a extremo</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
        {rows.map(row => {
          const total = Number(row.total || 0);
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => total > 0 && onStatusClick?.(row)}
              disabled={total <= 0}
              style={{
                border:`1px solid ${selectedKey === row.key ? "rgba(20,184,166,.48)" : "var(--border)"}`,
                borderRadius:8,
                padding:"9px 10px",
                background:selectedKey === row.key ? "rgba(20,184,166,.10)" : "var(--bg3)",
                cursor:total > 0 ? "pointer" : "default",
                textAlign:"left",
                fontFamily:"'DM Sans',sans-serif",
                opacity:total > 0 ? 1 : .72,
              }}
            >
              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                <span style={{fontSize:11,fontWeight:900,color:"var(--text)",whiteSpace:"nowrap"}}>{row.label}</span>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:900,color:"var(--accent-xl)"}}>{total}</span>
              </div>
              <div style={{height:5,background:"var(--bg4)",borderRadius:99,overflow:"hidden",marginTop:8}}>
                <div style={{height:"100%",width:`${Math.max(4, total / max * 100)}%`,background:"var(--accent)",borderRadius:99}} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function parseRouteFromItem(item = {}) {
  const text = [item.ruta, item.route, item.description, item.title].filter(Boolean).join(" ");
  const match = String(text).match(/([A-ZÁÉÍÓÚÜÑ0-9 .,'/-]{2,})\s*(?:>|->|→|a)\s*([A-ZÁÉÍÓÚÜÑ0-9 .,'/-]{2,})/i);
  const origen = item.origen || match?.[1]?.trim() || "";
  const destino = item.destino || match?.[2]?.replace(/\s+-\s+.*/, "").trim() || "";
  return { origen, destino };
}

function DecisionsPanel({ decisiones = [], onOpenDecision }) {
  const rows = Array.isArray(decisiones) ? decisiones.slice(0, 5) : [];
  return (
    <div style={S.card}>
      <div style={S.sec}>Gestión proactiva</div>
      {rows.length === 0 ? (
        <div style={{fontSize:12,color:"var(--text4)"}}>Sin decisiones urgentes. Operación estable para el filtro actual.</div>
      ) : (
        <div style={{display:"grid",gap:8}}>
          {rows.map((d, idx) => {
            const sev = SEV[d.severity] || SEV.info;
            return (
              <button key={d.id || idx} onClick={()=>onOpenDecision ? onOpenDecision(d) : navegar(d.view || "gestion_trafico")}
                style={{textAlign:"left",border:`1px solid ${sev.border}`,background:sev.bg,borderRadius:8,padding:"9px 11px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{d.title}</span>
                  <span style={{fontSize:10,fontWeight:900,color:sev.color,textTransform:"uppercase"}}>{sev.label}</span>
                </div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:3,lineHeight:1.3}}>{d.recommended_action}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function actorEventoLabel(ev = {}) {
  if (ev.actor_nombre) return ev.actor_nombre;
  if (ev.actor_email) return ev.actor_email;
  if (String(ev.actor_tipo || "").toLowerCase() === "sistema") return "Sistema";
  if (String(ev.actor_tipo || "").toLowerCase() === "cliente") return "Cliente";
  return "Usuario";
}

function accionEventoAmigable(ev = {}) {
  const tipo = String(ev.tipo || "").toLowerCase();
  const detalle = ev.detalle && typeof ev.detalle === "object" ? ev.detalle : {};
  const estado = detalle.estado_nuevo || detalle.estado || detalle.to || detalle.next_estado;
  const map = {
    "pedido.creado": "creo el pedido",
    "pedido.editado": "edito el pedido",
    "pedido.actualizado": "actualizo el pedido",
    "pedido.editado_estado": estado ? `cambio el estado a ${estado}` : "cambio el estado",
    "pedido.estado": estado ? `cambio el estado a ${estado}` : "cambio el estado",
    "estado.actualizado": estado ? `cambio el estado a ${estado}` : "cambio el estado",
    "documento.generado": "genero documentacion",
    "documento.firmado": "firmo documentacion",
    "ruta.enviada": "envio la ruta al conductor",
    "chofer.actualizo_pasos": "actualizo el seguimiento del viaje",
  };
  if (map[tipo]) return map[tipo];
  return tipo.replace(/^pedido[._-]?/i, "").replace(/[._-]+/g, " ").trim() || "registro actividad";
}

function EventsPanel({ eventos = [] }) {
  const rows = Array.isArray(eventos) ? eventos.slice(0, 8) : [];
  return (
    <div style={S.card}>
      <div style={S.sec}>Eventos recientes</div>
      {rows.length === 0 ? (
        <div style={{fontSize:12,color:"var(--text4)"}}>Aún no hay eventos recientes de app, portal, WhatsApp o pedidos.</div>
      ) : rows.map(ev => (
        <div key={ev.id} style={{display:"grid",gridTemplateColumns:"92px 1fr",gap:10,borderTop:"1px solid var(--border)",padding:"8px 0"}}>
          <div style={{fontSize:10,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>
            {ev.created_at ? new Date(ev.created_at).toLocaleTimeString("es-ES", { hour:"2-digit", minute:"2-digit" }) : "--:--"}
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{ev.pedido_numero || "Pedido"} - {actorEventoLabel(ev)} {accionEventoAmigable(ev)}</div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{ev.ruta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ControlTower() {
  const [period, setPeriod] = useState("7d");
  const [tab, setTab] = useState("todas");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusPicker, setStatusPicker] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError("");
    getControlTower(period)
      .then(d => { if (alive) setData(d && typeof d === "object" ? d : null); })
      .catch((e) => { if (alive) { setData(null); setLoadError(e.message || "No se pudo cargar Control Tower."); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  const items = useMemo(() => Array.isArray(data?.items) ? data.items : [], [data]);
  const incidencias = useMemo(
    () => Array.isArray(data?.incidencias) ? data.incidencias : items.filter(item => item?.type === "incidencia_pedido"),
    [data, items]
  );
  const resumen = data?.resumen || {};
  const kpis = data?.kpis || {};
  const vistas = data?.vistas || {};
  const flujo = Array.isArray(data?.flujo_operativo) ? data.flujo_operativo : [];
  const viajesPorEstado = useMemo(
    () => data?.viajes_por_estado && typeof data.viajes_por_estado === "object" ? data.viajes_por_estado : {},
    [data]
  );
  const recursos = data?.recursos || {};
  const visibilidad = data?.visibilidad || {};
  const decisiones = Array.isArray(data?.decisiones) ? data.decisiones : [];
  const eventos = Array.isArray(data?.eventos_recientes) ? data.eventos_recientes : [];
  const mapItem = useMemo(() => {
    const enRuta = Array.isArray(viajesPorEstado.en_curso) ? viajesPorEstado.en_curso[0] : null;
    if (enRuta) return enRuta;
    return items.find(item => ["en_ruta", "gps_sin_senal", "retraso", "incidencia_pedido"].includes(String(item?.type || ""))) ||
      items.find(item => parseRouteFromItem(item).origen && parseRouteFromItem(item).destino) ||
      null;
  }, [items, viajesPorEstado]);

  function abrirEstadoFlujo(row) {
    const key = row?.key || "";
    const trips = Array.isArray(viajesPorEstado[key]) ? viajesPorEstado[key] : [];
    if (!trips.length) return;
    setStatusPicker({ ...row, trips });
  }

  function seleccionarViajeFlujo(trip) {
    const focusedTrip = {
      ...trip,
      title: `Viaje ${trip.numero || ""}`,
      entity_id: trip.id,
      view: "pedidos",
      description: `${trip.cliente_nombre || "Cliente"} - ${trip.origen || "-"} > ${trip.destino || "-"}`,
    };
    setStatusPicker(null);
    abrirViajeEnTrafico(focusedTrip, { action: "Abrir desde visibilidad", action_key: "abrir_viaje" });
  }
  const grupos = useMemo(() => ({
    todas: items,
    hoy: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("hoy")),
    riesgos: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("riesgos")),
    rentabilidad: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("rentabilidad")),
    recursos: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("recursos")),
    documentos: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("documentos")),
    incidencias,
  }), [items, incidencias]);
  const visible = grupos[tab] || items;
  const visibleGroups = useMemo(() => {
    const grouped = visible.reduce((acc, item) => {
      const key = item?.area || "Operacion";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    return Object.entries(grouped).sort(([a], [b]) => String(a).localeCompare(String(b), "es"));
  }, [visible]);

  return (
    <div className="tg-responsive-page tg-controltower-page" style={S.page}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:18}}>
        <div>
          <div style={S.title}>Control Tower</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Prioridades de tráfico, margen, documentos, cobros y GPS.</div>
        </div>
        <div style={{display:"flex",gap:5,background:"var(--bg3)",padding:4,borderRadius:9,border:"1px solid var(--border)"}}>
          {Object.entries(PERIODS).map(([key,label])=>(
            <button key={key} onClick={()=>setPeriod(key)} style={{padding:"5px 12px",borderRadius:6,border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer",background:period===key?"var(--accent)":"transparent",color:period===key?"#fff":"var(--text4)"}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{...S.card,marginBottom:12,borderColor:Number(resumen.critica||0)>0?"rgba(239,68,68,.40)":Number(resumen.alta||0)>0?"rgba(249,115,22,.35)":"var(--border)"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
          {[
            ["Activos", kpis.activos, "var(--accent-xl)"],
            ["Cargas periodo", kpis.cargas_periodo ?? kpis.cargas_hoy, "#f59e0b"],
            ["Descargas periodo", kpis.descargas_periodo ?? kpis.descargas_hoy, "var(--green)"],
            ["Criticas", resumen.critica, "#ef4444"],
            ["Altas", resumen.alta, "#f97316"],
          ].map(([label,value,color])=>(
            <div key={label} style={{border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",background:"var(--bg3)"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color}}>{Number(value || 0)}</div>
              <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {statusPicker && (
        <div
          style={{position:"fixed",inset:0,zIndex:420,background:"rgba(15,23,42,.58)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={e => e.target === e.currentTarget && setStatusPicker(null)}
        >
          <div style={{width:"min(680px,96vw)",maxHeight:"82vh",overflowY:"auto",background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:14,padding:18,boxShadow:"0 24px 70px rgba(15,23,42,.24)"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:12}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:900,color:"var(--text)"}}>{statusPicker.label}</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Selecciona un viaje para abrirlo en Mesa de trafico con este filtro.</div>
              </div>
              <button onClick={() => setStatusPicker(null)} style={{border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",borderRadius:8,width:34,height:34,fontSize:18,fontWeight:900,cursor:"pointer"}}>x</button>
            </div>
            <div style={{display:"grid",gap:8}}>
              {statusPicker.trips.map(trip => (
                <button
                  key={trip.id}
                  type="button"
                  onClick={() => seleccionarViajeFlujo(trip)}
                  style={{
                    textAlign:"left",
                    border:"1px solid var(--border)",
                    background:"var(--bg3)",
                    borderRadius:10,
                    padding:"10px 12px",
                    cursor:"pointer",
                    fontFamily:"'DM Sans',sans-serif",
                  }}
                >
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}>
                    <span style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>{trip.numero || "Pedido"} - {trip.cliente_nombre || "Cliente"}</span>
                    <span style={{fontSize:11,fontWeight:900,color:"var(--accent-xl)",whiteSpace:"nowrap"}}>{trip.vehiculo_matricula || trip.colaborador_nombre || "Sin matricula"}</span>
                  </div>
                  <div style={{fontSize:12,color:"var(--text4)",marginTop:4}}>
                    {trip.origen || "-"} - {trip.destino || "-"}{trip.fecha_carga ? ` - ${String(trip.fecha_carga).slice(0,10)}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && data && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginBottom:12}}>
          <div style={{display:"grid",gap:12}}>
            <FlowPanel flujo={flujo} selectedKey={statusPicker?.key || ""} onStatusClick={abrirEstadoFlujo} />
            {mapItem && <MapMovedPanel item={mapItem} />}
            <div style={{...S.card}}>
              <div style={S.sec}>Flota, recursos y señales</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
                <MetricBox label="Disponibles" value={recursos.disponibles} detail={`${recursos.choferes_activos || 0} choferes activos`} color="var(--green)" />
                <MetricBox label="En ruta" value={recursos.en_ruta} detail="Chóferes ocupados" color="var(--accent-xl)" />
                <MetricBox label="Vacaciones" value={recursos.vacaciones} detail={`${recursos.solicitudes_vacaciones || 0} solicitudes`} color="#8b5cf6" />
                <MetricBox label="GPS OK" value={visibilidad.gps_ok} detail={`${visibilidad.gps_enlazados || 0} enlazados`} color="var(--green)" />
                <MetricBox label="Sin señal" value={visibilidad.gps_sin_senal} detail="Revisar localización" color="#f97316" />
                <MetricBox label="Esperas" value={visibilidad.esperas_activas} detail="Carga/descarga" color="#ef4444" />
              </div>
            </div>
          </div>
          <div style={{display:"grid",gap:12}}>
            <DecisionsPanel decisiones={decisiones} onOpenDecision={(d) => {
              if (d?.entity_id && (d.view === "gestion_trafico" || d.view === "pedidos")) {
                abrirViajeEnTrafico(d, { action: d.recommended_action || d.action || "Abrir decision", action_key: d.action_key || "" });
              } else {
                navegar(d.view || "gestion_trafico");
              }
            }} />
            <EventsPanel eventos={eventos} />
          </div>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
        <div style={{display:"flex",gap:6,background:"var(--bg3)",padding:4,borderRadius:8,border:"1px solid var(--border)",flexWrap:"wrap"}}>
          {[
            ["todas", `Todas (${vistas.todas ?? items.length})`],
            ["hoy", `Hoy (${vistas.hoy ?? grupos.hoy.length})`],
            ["riesgos", `Riesgos (${vistas.riesgos ?? grupos.riesgos.length})`],
            ["rentabilidad", `Rentabilidad (${vistas.rentabilidad ?? grupos.rentabilidad.length})`],
            ["recursos", `Recursos (${vistas.recursos ?? grupos.recursos.length})`],
            ["documentos", `Docs (${vistas.documentos ?? grupos.documentos.length})`],
            ["incidencias", `Incidencias (${vistas.incidencias ?? incidencias.length})`],
          ].map(([key,label])=>(
            <button key={key} onClick={()=>setTab(key)}
              style={{padding:"6px 11px",borderRadius:6,border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:800,cursor:"pointer",background:tab===key?"var(--accent)":"transparent",color:tab===key?"#fff":"var(--text4)"}}>
              {label}
            </button>
          ))}
        </div>
        <div style={{fontSize:11,color:"var(--text5)",fontWeight:800}}>{visible.length} señales visibles</div>
      </div>

      {loading ? (
        <div style={{color:"var(--text4)",padding:40,textAlign:"center"}}>Cargando Control Tower...</div>
      ) : loadError ? (
        <div style={{...S.card,borderColor:"rgba(239,68,68,.32)",background:"rgba(239,68,68,.06)"}}>
          <div style={{fontSize:14,color:"#ef4444",fontWeight:900,marginBottom:6}}>No se pudo cargar Control Tower</div>
          <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.45,marginBottom:12}}>
            No se han perdido los viajes: la consulta al servidor ha fallado o ha tardado demasiado.
          </div>
          <button onClick={() => { setLoading(true); setLoadError(""); getControlTower(period).then(d => setData(d && typeof d === "object" ? d : null)).catch(e => setLoadError(e.message || "No se pudo cargar Control Tower.")).finally(() => setLoading(false)); }} style={{border:"1px solid rgba(239,68,68,.25)",background:"rgba(239,68,68,.10)",color:"#ef4444",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Reintentar
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div style={S.card}>
          <div style={{fontSize:14,color:"var(--green)",fontWeight:900,marginBottom:6}}>Sin señales activas en esta vista</div>
          <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.45,marginBottom:12}}>
            No se han detectado retrasos, incidencias, margen bajo, documentos pendientes, cobros en riesgo, preparación regulatoria o GPS sin señal para este filtro.
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>navegar("gestion_trafico")} style={{border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Abrir tráfico
            </button>
            <button onClick={()=>navegar("excepciones")} style={{border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Ver excepciones
            </button>
          </div>
        </div>
      ) : (
        <div style={{display:"grid",gap:16}}>
          {visibleGroups.map(([area, group]) => (
            <section key={area} style={{display:"grid",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",whiteSpace:"nowrap"}}>
                  {area}
                </div>
                <div style={{height:1,background:"var(--border)",flex:1}} />
                <div style={{fontSize:10,fontWeight:900,color:"var(--text5)",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:999,padding:"3px 8px"}}>
                  {group.length}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10}}>
                {group.map(item => <TowerItem key={item.id || `${item.type}-${item.entity_id}`} item={item} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
