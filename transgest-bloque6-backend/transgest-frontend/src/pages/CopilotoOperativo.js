import { useEffect, useState } from "react";
import { getCopilotoOperativo } from "../services/api";
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
const fmt2 = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits:2, maximumFractionDigits:2 });

function navegar(view) {
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: view }));
}

function abrirAccion(priority, action) {
  if (!priority || !action) return;
  const focus = {
    source: "copiloto_operativo",
    action: action.label || priority.recommended_action || "",
    action_key: action.key || "",
    type: priority.key || "",
    area: priority.area || "",
    severity: priority.severity || "",
    title: priority.title || "",
    description: priority.answer || priority.recommended_action || "",
    requires_confirmation: !!priority.requires_confirmation,
  };
  const targetView = action.view || priority.target_view || "dashboard";
  if (targetView === "gestion_trafico" || targetView === "pedidos" || targetView === "rutas_recomendadas") {
    setRuntimeFocus("tms_trafico_focus", focus);
    navegar(targetView === "rutas_recomendadas" ? "rutas_recomendadas" : "gestion_trafico");
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

function PriorityCard({ priority }) {
  const sev = SEV[priority?.severity] || SEV.info;
  return (
    <div style={{border:`1px solid ${sev.color}40`,background:`${sev.color}0f`,borderRadius:9,padding:"13px 14px",display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
        <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:sev.color}}>{sev.label}</span>
        <span style={{fontSize:10,color:"var(--text5)",fontWeight:800}}>{priority.area}</span>
      </div>
      <div style={{fontSize:15,fontWeight:900,color:"var(--text)",lineHeight:1.25}}>{priority.title}</div>
      <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.4}}>{priority.recommended_action || priority.answer}</div>
      {Array.isArray(priority.playbook) && priority.playbook.length > 0 && (
        <div>
          <div style={{...S.sec,marginTop:3,marginBottom:6}}>Playbook</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {priority.playbook.slice(0,5).map((step, idx)=>(
              <span key={idx} style={{fontSize:10,fontWeight:700,color:"var(--text4)",background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:999,padding:"3px 8px"}}>
                {step}
              </span>
            ))}
          </div>
        </div>
      )}
      {Array.isArray(priority.quick_actions) && priority.quick_actions.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:2}}>
          {priority.quick_actions.slice(0,4).map(action=>(
            <button key={action.key || action.label} onClick={()=>abrirAccion(priority, action)}
              style={{fontSize:11,fontWeight:800,border:`1px solid ${action.primary ? "rgba(20,184,166,.35)" : "var(--border)"}`,background:action.primary ? "rgba(20,184,166,.10)" : "var(--bg3)",color:action.primary ? "var(--accent-xl)" : "var(--text4)",borderRadius:20,padding:"4px 9px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CopilotoOperativo() {
  const [period, setPeriod] = useState("7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCopilotoOperativo(period)
      .then(d => { if (alive) setData(d && typeof d === "object" ? d : null); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  const resumen = data?.resumen || {};
  const prioridades = Array.isArray(data?.prioridades) ? data.prioridades : [];
  const saludColor = resumen.salud === "critica" ? "#ef4444" : resumen.salud === "alerta" ? "#f97316" : "var(--green)";

  return (
    <div style={S.page}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:18}}>
        <div>
          <div style={S.title}>Copiloto operativo</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Lectura accionable de riesgos, margen, documentos y prioridades.</div>
        </div>
        <div style={{display:"flex",gap:5,background:"var(--bg3)",padding:4,borderRadius:9,border:"1px solid var(--border)"}}>
          {Object.entries(PERIODS).map(([key,label])=>(
            <button key={key} onClick={()=>setPeriod(key)} style={{padding:"5px 12px",borderRadius:6,border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer",background:period===key?"var(--accent)":"transparent",color:period===key?"#fff":"var(--text4)"}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{color:"var(--text4)",padding:40,textAlign:"center"}}>Cargando copiloto...</div>
      ) : (
        <>
          <div style={{...S.card,marginBottom:12,borderColor:resumen.salud==="critica"?"rgba(239,68,68,.38)":resumen.salud==="alerta"?"rgba(249,115,22,.34)":"var(--border)"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
              <div style={{flex:"1 1 360px"}}>
                <div style={{...S.sec,marginBottom:5,color:saludColor}}>Estado de la operacion</div>
                <div style={{fontSize:16,fontWeight:900,color:"var(--text)",lineHeight:1.3}}>{resumen.headline || "Operacion revisada con datos reales."}</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:5}}>
                  {Number(resumen.activos || 0)} activos - {Number(resumen.cargas_hoy || 0)} cargas hoy - {Number(resumen.descargas_hoy || 0)} descargas hoy
                  {resumen.margen_pct != null ? ` - margen ${fmt2(resumen.margen_pct)}%` : ""}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(88px,1fr))",gap:8}}>
                {[
                  ["Prioridades", resumen.total_prioridades, "var(--accent-xl)"],
                  ["Criticas", resumen.criticas, "#ef4444"],
                  ["Altas", resumen.altas, "#f97316"],
                ].map(([label,value,color])=>(
                  <div key={label} style={{border:"1px solid var(--border)",borderRadius:8,padding:"9px 10px",background:"var(--bg3)"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:17,fontWeight:900,color}}>{Number(value || 0)}</div>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {prioridades.length === 0 ? (
            <div style={S.card}>
              <div style={{fontSize:13,color:"var(--green)",fontWeight:800}}>Sin prioridades criticas detectadas.</div>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10}}>
              {prioridades.map(p => <PriorityCard key={p.key || p.title} priority={p} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
