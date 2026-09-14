import { PageHeader } from "../ui";
import { setRuntimeFocus } from "../services/runtimeFocus";
import "./traffic/traffic.css";
import { useEffect, useState } from "react";
import PlanDiario from "./PlanDiario";
import GestionTrafico from "./GestionTrafico";

const TABS = [
  { id: "cuadrante", label: "Cuadrante semanal" },
  { id: "plan_diario", label: "Plan diario" },
  { id: "grupajes", label: "Agrupaciones" },
  { id: "optimizacion", label: "Optimización de rutas" },
];

function normalizarTab(value) {
  if (value === "cuadrante_semana" || value === "gestion_trafico") return "cuadrante";
  if (value === "rutas_recomendadas") return "optimizacion";
  return TABS.some(t => t.id === value) ? value : "cuadrante";
}

export default function PlanificacionOperativa({ initialTab = "cuadrante" }) {
  const [tab, setTab] = useState(() => normalizarTab(initialTab));

  useEffect(() => {
    setTab(normalizarTab(initialTab));
  }, [initialTab]);

  return (
    <div className="tg-planificacion-operativa tg-responsive-page traffic-shell" style={{
      flex: 1,
      minHeight: "100%",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg)",
      color: "var(--text)",
      fontFamily: "'DM Sans',sans-serif",
    }}>
      <header className="traffic-shell-heading"><PageHeader title="Mesa de tráfico" description="Planifica, asigna y controla tus viajes en tiempo real."/><button onClick={()=>{setRuntimeFocus("tms_pedidos_focus",{source:"gestion_trafico",action:"nuevo"});window.dispatchEvent(new CustomEvent("tms:navegar",{detail:"pedidos"}));}}>+ Nuevo pedido</button></header>
      <div className="tg-planificacion-tabs" style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg2)",
        overflowX: "auto",
        flexShrink: 0,
      }}>
        {TABS.map(item => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab===item.id}
            onClick={() => setTab(item.id)}
            style={{
              flex: "0 0 auto",
              padding: "8px 14px",
              borderRadius: 8,
              border: tab === item.id ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: tab === item.id ? "var(--accent)" : "var(--bg4)",
              color: tab === item.id ? "#fff" : "var(--text4)",
              fontWeight: 800,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "plan_diario" && <PlanDiario />}
        {tab === "cuadrante" && <GestionTrafico initialVista="cuadrante" hideInternalTabs />}
        {tab === "grupajes" && <GestionTrafico initialVista="grupajes" hideInternalTabs />}
        {tab === "optimizacion" && <GestionTrafico initialVista="optimizacion" hideInternalTabs />}
      </div>
    </div>
  );
}
