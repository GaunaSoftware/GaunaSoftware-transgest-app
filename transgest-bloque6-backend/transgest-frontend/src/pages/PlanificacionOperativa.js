import { PageHeader, Tabs } from "../ui";
import { setRuntimeFocus } from "../services/runtimeFocus";
import "./traffic/traffic.css";
import { useEffect, useState } from "react";
import GestionTrafico from "./GestionTrafico";
import TrafficLocationAgenda from './traffic/TrafficLocationAgenda';

const TABS = [
  { id: "cuadrante", label: "Mesa de tráfico" },
  { id: "grupajes", label: "Grupajes" },
  { id: "optimizacion", label: "Optimización de rutas" },
];

function normalizarTab(value) {
  if (value === "cuadrante_semana" || value === "gestion_trafico") return "cuadrante";
  if (value === "rutas_recomendadas") return "optimizacion";
  if (value === "ubicacion" || value === "plan_diario") return "cuadrante";
  return TABS.some(t => t.id === value) ? value : "cuadrante";
}

export default function PlanificacionOperativa({ initialTab = "cuadrante" }) {
  const [tab, setTab] = useState(() => normalizarTab(initialTab));
  const nuevoPedido=()=>{setRuntimeFocus("tms_pedidos_focus",{source:"gestion_trafico",view:tab,action:"nuevo"});window.dispatchEvent(new CustomEvent("tms:navegar",{detail:"pedidos"}));};

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
      <section className="traffic-shell-surface">
      <div className="traffic-module-tabs"><Tabs idPrefix="traffic-module" label="Secciones de Mesa de tráfico" items={TABS.map(item=>({value:item.id,label:item.label}))} value={tab} onChange={setTab}/></div>
      {tab!=="cuadrante"&&<header className="traffic-shell-heading"><PageHeader title="Mesa de tráfico" description="Planifica, asigna y controla tus viajes en tiempo real."/><button onClick={nuevoPedido}>+ Nuevo pedido</button></header>}
      <div id="traffic-module-panel" role="tabpanel" aria-labelledby={`traffic-module-${tab}`} className="traffic-shell-panel">
        {tab === "cuadrante" && <TrafficLocationAgenda onNewOrder={nuevoPedido} />}
        {tab === "grupajes" && <GestionTrafico initialVista="grupajes" hideInternalTabs onViewChange={setTab} />}
        {tab === "optimizacion" && <GestionTrafico initialVista="optimizacion" hideInternalTabs />}
      </div>
      </section>
    </div>
  );
}
