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
  critica: { label:"Critica", color:"#ef4444" },
  alta: { label:"Alta", color:"#f97316" },
  media: { label:"Media", color:"#f59e0b" },
  baja: { label:"Baja", color:"#3b82f6" },
  info: { label:"Info", color:"var(--accent-l)" },
};

const PERIODS = { "7d":"7 dias", mes:"Este mes", "30d":"30 dias" };

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

function TowerItem({ item }) {
  const sev = SEV[item?.severity] || SEV.info;
  return (
    <div style={{border:`1px solid ${sev.color}40`,background:`${sev.color}0f`,borderRadius:8,padding:"12px 13px",display:"flex",flexDirection:"column",gap:7,minHeight:148}}>
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

export default function ControlTower() {
  const [period, setPeriod] = useState("7d");
  const [tab, setTab] = useState("todas");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getControlTower(period)
      .then(d => { if (alive) setData(d && typeof d === "object" ? d : null); })
      .catch(() => { if (alive) setData(null); })
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
  const grupos = useMemo(() => ({
    todas: items,
    hoy: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("hoy")),
    riesgos: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("riesgos")),
    rentabilidad: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("rentabilidad")),
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
    <div style={S.page}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:18}}>
        <div>
          <div style={S.title}>Control Tower</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Prioridades de trafico, margen, documentos, cobros y GPS.</div>
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
            ["Cargas hoy", kpis.cargas_hoy, "#f59e0b"],
            ["Descargas hoy", kpis.descargas_hoy, "var(--green)"],
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

      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
        <div style={{display:"flex",gap:6,background:"var(--bg3)",padding:4,borderRadius:8,border:"1px solid var(--border)",flexWrap:"wrap"}}>
          {[
            ["todas", `Todas (${vistas.todas ?? items.length})`],
            ["hoy", `Hoy (${vistas.hoy ?? grupos.hoy.length})`],
            ["riesgos", `Riesgos (${vistas.riesgos ?? grupos.riesgos.length})`],
            ["rentabilidad", `Rentabilidad (${vistas.rentabilidad ?? grupos.rentabilidad.length})`],
            ["incidencias", `Incidencias (${vistas.incidencias ?? incidencias.length})`],
          ].map(([key,label])=>(
            <button key={key} onClick={()=>setTab(key)}
              style={{padding:"6px 11px",borderRadius:6,border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:800,cursor:"pointer",background:tab===key?"var(--accent)":"transparent",color:tab===key?"#fff":"var(--text4)"}}>
              {label}
            </button>
          ))}
        </div>
        <div style={{fontSize:11,color:"var(--text5)",fontWeight:800}}>{visible.length} senales visibles</div>
      </div>

      {loading ? (
        <div style={{color:"var(--text4)",padding:40,textAlign:"center"}}>Cargando Control Tower...</div>
      ) : visible.length === 0 ? (
        <div style={S.card}>
          <div style={{fontSize:13,color:"var(--green)",fontWeight:800}}>No hay senales en esta vista.</div>
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
