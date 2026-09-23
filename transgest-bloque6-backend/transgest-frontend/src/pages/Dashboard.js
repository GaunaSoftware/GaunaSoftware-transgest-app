import { useState, useEffect, useMemo } from "react";
import { getFacturasTodas, getPedidosTodos, getVehiculos, getChoferes, getExcepcionesOperativas, getEmpresaConfig, getTallerEstado, getPaletMovimientos, getBiResumen } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { setRuntimeFocus } from "../services/runtimeFocus";

import DashboardWorkspace from "./dashboard/DashboardWorkspace";
import DashboardBI from "./dashboard/DashboardBI";

const fmtN   = n => Number(n||0).toLocaleString("es-ES");
const ESTADO_PEDIDO = {
  pendiente: { label:"Pendiente", color:"var(--text4)" },
  confirmado: { label:"Confirmado", color:"var(--accent-l)" },
  espera_carga: { label:"Espera carga", color:"#eab308" },
  cargando: { label:"Cargando", color:"var(--accent-l)" },
  en_curso: { label:"En ruta", color:"#f59e0b" },
  espera_descarga: { label:"Espera descarga", color:"#d946ef" },
  descarga: { label:"En descarga", color:"#a78bfa" },
  entregado: { label:"Entregado", color:"var(--green)" },
  facturado: { label:"Facturado", color:"#8b5cf6" },
  cancelado: { label:"Cancelado", color:"#ef4444" },
  incidencia: { label:"Incidencia", color:"#f97316" },
};
function estadoPedidoMeta(estado) {
  const key = String(estado || "").toLowerCase();
  return ESTADO_PEDIDO[key] || { label: key ? key.replace(/_/g, " ") : "-", color:"var(--text4)" };
}

function dashboardPeriodToBi(value) {
  return ({ all:"all", hoy:"hoy", mes:"mes", "7d":"7d", "3m":"90d", "6m":"180d", "1y":"365d" }[value] || "30d");
}

function navegar(view) {
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: view }));
}

function semaforo(fecha) {
  if (!fecha) return null;
  const dias = Math.ceil((new Date(fecha) - new Date()) / 86400000);
  if (dias > 30) return null; // solo mostrar urgentes
  const color = dias > 7 ? "#f59e0b" : dias > 0 ? "var(--orange)" : "var(--red)";
  const label = dias > 0 ? `Vence en ${dias}d ` : `VENCIDO hace ${Math.abs(dias)}d`;
  return { color, label, dias };
}

function diasDesdePalets(fecha) {
  if (!fecha) return 0;
  const base = new Date(`${String(fecha).slice(0,10)}T12:00:00`);
  if (Number.isNaN(base.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - base.getTime()) / 86400000));
}

function salidaPaletsConfirmada(m) {
  if (m.tipo !== "devolucion") return true;
  return String(m.estado_salida || "confirmada").toLowerCase() === "confirmada";
}

function buildPaletsDashboardAlerts(movimientos = []) {
  const byCliente = new Map();
  movimientos.forEach(m => {
    const clienteId = String(m.propietario_cliente_id || m.cliente_id || m.propietario_nombre || m.cliente_nombre || "");
    if (!clienteId) return;
    if (!byCliente.has(clienteId)) byCliente.set(clienteId, []);
    byCliente.get(clienteId).push(m);
  });
  const alertas = [];
  byCliente.forEach(items => {
    const entradas = items
      .filter(m => m.tipo === "entrega")
      .map(m => ({ ...m, restante: Number(m.cantidad || 0) }))
      .filter(m => m.restante > 0)
      .sort((a,b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
    let salidas = items
      .filter(m => m.tipo === "devolucion" && salidaPaletsConfirmada(m))
      .reduce((s,m) => s + Number(m.cantidad || 0), 0);
    entradas.forEach(m => {
      if (salidas <= 0) return;
      const usado = Math.min(m.restante, salidas);
      m.restante -= usado;
      salidas -= usado;
    });
    entradas.forEach(m => {
      if (m.restante <= 0) return;
      const dias = diasDesdePalets(m.fecha);
      if (dias < 14) return;
      alertas.push({
        cliente: m.propietario_nombre || m.cliente_nombre || "Cliente sin identificar",
        palets: m.restante,
        dias,
        critico: dias >= 30,
      });
    });
  });
  return alertas.sort((a,b) => b.dias - a.dias).slice(0, 5);
}

function abrirAlerta(alerta = {}) {
  if (alerta.focusKey && alerta.focus) setRuntimeFocus(alerta.focusKey, alerta.focus);
  navegar(alerta.view || "control_tower");
}

function enfocarPedidos(focus) {
  setRuntimeFocus("tms_pedidos_focus", focus);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tms:pedidos-focus", { detail: focus }));
  }
  navegar("pedidos");
}

export default function Dashboard() {
  const { user, puedeVer } = useAuth();
  const [biOpen, setBiOpen] = useState(false);
  const [biLoading,setBiLoading]=useState(false);
  const [biError,setBiError]=useState("");
  const [loadErrors, setLoadErrors] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [period,    setPeriod]    = useState("mes");
  const [pedidos,   setPedidos]   = useState([]);
  const [facturas,  setFacturas]  = useState([]);
  const [vehiculos,  setVehiculos]  = useState([]);
  const [choferes,  setChoferes]  = useState([]);
  const [misTareas, setMisTareas] = useState([]);
  const [empresaCfg, setEmpresaCfg] = useState({ cfg_alertas: [] });
  const [tallerEstado, setTallerEstado] = useState({ stock: [], reparaciones: [] });
  const [paletMovimientos, setPaletMovimientos] = useState([]);
  const [biResumen, setBiResumen] = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setLoadErrors([]);
      const failed = [];
      const unavailable = (name, fallback) => { failed.push(name); return fallback; };
      try {
      const _tout = (p, ms=8000) => { let timer; return Promise.race([p, new Promise(r=>{ timer=setTimeout(()=>r(unavailable("Pedidos", [])),ms); })]).finally(()=>clearTimeout(timer)); };
        const [p, f, v, c, ex, cfg, taller, palets] = await Promise.all([
          _tout(getPedidosTodos({}, { timeoutMs: 45000, silentError: true }).catch(()=>unavailable("Pedidos", [])), 45000),
          getFacturasTodas({}, { silentError: true }).catch(()=>unavailable("Facturación", [])),
          getVehiculos().catch(()=>unavailable("Vehículos", [])),
          getChoferes().catch(()=>unavailable("Conductores", [])),
          getExcepcionesOperativas().catch(()=>unavailable("Tareas", null)),
          getEmpresaConfig().catch(()=>unavailable("Configuración", null)),
          getTallerEstado().catch(()=>unavailable("Taller", null)),
          getPaletMovimientos().catch(()=>unavailable("Palets", [])),
        ]);
        if (!active) return;
        setPedidos(Array.isArray(p)?p:Array.isArray(p?.data)?p.data:[]);
        setFacturas(Array.isArray(f)?f:Array.isArray(f?.data)?f.data:[]);
        setVehiculos(Array.isArray(v)?v:[]);
        setChoferes(Array.isArray(c)?c:[]);
        const exItems = Array.isArray(ex?.data) ? ex.data : [];
        setMisTareas(exItems
          .filter(x => x.workflow?.activa && String(x.workflow?.asignado_a || "") === String(user?.id || ""))
          .slice(0, 5)
        );
        setEmpresaCfg(cfg && typeof cfg === "object" ? cfg : { cfg_alertas: [] });
        setTallerEstado(taller && typeof taller === "object" ? taller : { stock: [], reparaciones: [] });
        setPaletMovimientos(Array.isArray(palets) ? palets : Array.isArray(palets?.data) ? palets.data : []);
      } catch(e) { console.error(e); }
      finally { if (active) { setLoadErrors([...new Set(failed)]); setLoading(false); } }
    }
    load();
    return () => { active = false; };
  }, [user?.id, user?.rol, reloadKey]);

  useEffect(() => {
    let active = true;
    setBiResumen(null);setBiLoading(true);setBiError("");
    getBiResumen(dashboardPeriodToBi(period)).then(bi => {
      const data = bi?.data && typeof bi.data === "object" ? bi.data : bi;
      if (active) setBiResumen(data && typeof data === "object" ? data : null);
    }).catch(() => {if(active)setBiError("No se pudo consultar el resumen BI del servidor.");}).finally(()=>{if(active)setBiLoading(false);});
    return () => { active = false; };
  }, [period, user?.id, user?.rol]);

  const { alertas, today } = useMemo(() => {
    // ── Alertas activas ──
    const alertas = [];
    vehiculos.forEach(v => {
      const merged = { ...v };
      [["ITV",merged.fecha_itv],["Seguro",merged.fecha_seguro]].forEach(([tipo,fecha]) => {
        const s = semaforo(fecha);
        if (s) alertas.push({
          texto: `${tipo} ${merged.matricula}: ${s.label}`,
          color: s.color, bg: s.dias<=0?"rgba(239,68,68,.08)":"rgba(245,158,11,.08)",
          icon: s.dias<=0?"":"",
          view: "vehiculos",
          focusKey: "tms_vehiculos_focus",
          focus: { vehiculo_id: merged.id, source: "dashboard_alertas", section: "documentacion", tipo },
          actionLabel: "Revisar",
        });
      });
    });
    choferes.forEach(c => {
      [["CAP",c.cap_vencimiento],["Carnet",c.carnet_vencimiento],["Médico",c.medico_vencimiento]].forEach(([tipo,fecha]) => {
        const s = semaforo(fecha);
        if (s) alertas.push({
          texto: `${tipo} ${c.nombre}: ${s.label}`,
          color:s.color, bg:s.dias<=0?"rgba(239,68,68,.08)":"rgba(245,158,11,.08)", icon:s.dias<=0?"":"",
          view: "choferes",
          focusKey: "tms_choferes_focus",
          focus: { chofer_id: c.id, source: "dashboard_alertas", section: "documentacion", tipo },
          actionLabel: "Revisar",
        });
      });
    });
    // Mantenimiento taller
    const avisosCfg = Array.isArray(empresaCfg?.cfg_alertas) ? empresaCfg.cfg_alertas : [];
    avisosCfg.forEach(cfg => {
      if (!cfg.activo) return;
      vehiculos.forEach(v => {
        const ult = (tallerEstado.reparaciones||[]).filter(r=>r.vehiculo_id===v.id&&r.tipo===cfg.tipo_mantenimiento).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha))[0];
        if (!ult) return;
        const diasDesde = Math.ceil((new Date() - new Date(ult.fecha)) / 86400000);
        const kmDesde   = (v.km_actuales||0) - (ult.km_salida||0);
        const pctDias   = cfg.dias_aviso ? diasDesde/cfg.dias_aviso : 0;
        const pctKm     = cfg.km_aviso   ? kmDesde/cfg.km_aviso     : 0;
        if (Math.max(pctDias,pctKm) >= 0.85) {
          alertas.push({
            texto: `${cfg.tipo_mantenimiento} ${v.matricula}: ${diasDesde}d / ${fmtN(kmDesde)} km desde último`,
            color: Math.max(pctDias,pctKm)>=1 ? "var(--red)" : "#f59e0b",
            bg:    Math.max(pctDias,pctKm)>=1 ? "rgba(239,68,68,.08)" : "rgba(245,158,11,.08)",
            icon:"",
            view: "taller",
            focusKey: "tms_taller_focus",
            focus: { vehiculo_id: v.id, source: "dashboard_alertas", tipo: cfg.tipo_mantenimiento },
            actionLabel: "Abrir taller",
          });
        }
      });
    });
  
    // ── Facturas vencidas sin cobrar ──
    facturas.forEach(f => {
      if (["cobrada","borrador","cancelada","anulada"].includes(f.estado)) return;
      if (!f.fecha_vencimiento) return;
      const dias = Math.ceil((new Date(f.fecha_vencimiento) - new Date()) / 86400000);
      if (dias <= 0) {
        alertas.push({
          texto: `Factura ${f.numero} (${f.cliente_nombre||"-"}) VENCIDA hace ${Math.abs(dias)} día${Math.abs(dias)!==1?"s":""}`,
          color: "var(--red)", bg: "rgba(239,68,68,.08)", icon:"",
          view: "facturacion",
          focusKey: "tms_facturacion_focus",
          focus: { factura_id: f.id, source: "dashboard_alertas", title: "Factura vencida" },
          actionLabel: "Gestionar",
        });
      } else if (dias <= 7) {
        alertas.push({
          texto: `Factura ${f.numero} (${f.cliente_nombre||"-"}) vence en ${dias} día${dias!==1?"s":""}`,
          color: "#f59e0b", bg: "rgba(245,158,11,.06)", icon:"",
          view: "facturacion",
          focusKey: "tms_facturacion_focus",
          focus: { factura_id: f.id, source: "dashboard_alertas", title: "Factura proxima a vencer" },
          actionLabel: "Ver",
        });
      }
    });

    buildPaletsDashboardAlerts(paletMovimientos).forEach(a => {
      alertas.push({
        texto: `${a.cliente}: ${fmtN(a.palets)} palets pendientes desde hace ${a.dias} dias`,
        color: a.critico ? "var(--red)" : "#f59e0b",
        bg: a.critico ? "rgba(239,68,68,.08)" : "rgba(245,158,11,.08)",
        icon: "",
        view: "palets",
        focus: { source: "dashboard_alertas", cliente: a.cliente },
        actionLabel: "Regularizar",
      });
    });
    // ── Camiones en taller con pérdidas ──
      vehiculos.filter(v=>v.estado==="taller").forEach(v => { // all vehicles in taller
      const entrada = v.taller_entrada_at || null;
      if (entrada) {
        const dias = Math.ceil((new Date()-new Date(entrada))/86400000);
        alertas.push({
          texto: `${v.matricula} lleva ${dias} día${dias!==1?"s":""} en taller`,
          color: "#f97316", bg: "rgba(249,115,22,.08)", icon:"",
          view: "taller",
          focusKey: "tms_taller_focus",
          focus: { vehiculo_id: v.id, source: "dashboard_alertas", section: "taller" },
          actionLabel: "Abrir taller",
        });
      }
    });
    // ── Avisos personalizados de empresa ──
    const avisosEmpresa = Array.isArray(empresaCfg?.cfg_alertas) ? empresaCfg.cfg_alertas : [];
    // (custom alerts are shown as reminders in the alert area when active)
    avisosEmpresa.filter(a => a?.activo !== false).filter(a => ["Otro", "Otro aviso personalizado"].includes(String(a?.tipo || "")) || String(a?.descripcion || "").trim()).forEach(a => {
      alertas.push({ texto: a.descripcion||a.tipo, color:"#818cf8", bg:"rgba(99,102,241,.07)", icon:"", view:"avisos", actionLabel:"Abrir" });
    });
  
    const today = new Date().toLocaleDateString("es-ES",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  

    return { alertas, today };
  }, [facturas, vehiculos, choferes, empresaCfg, tallerEstado, paletMovimientos]);

  const biKpis = biResumen?.kpis || {};
  const biNumber = key => biKpis[key] == null || !Number.isFinite(Number(biKpis[key])) ? null : Number(biKpis[key]);
  const kpiIngresoGestionado = biNumber('ingreso_gestionado');
  const kpiFacturado = biNumber('facturado');
  const kpiCobrado = biNumber('cobrado');
  const kpiPendienteCobro = biNumber('saldo_al_corte');
  const kpiPendienteFacturar = biNumber('pendiente_facturar_realizado');
  const kpiPendientesFacturarCount = biNumber('pendientes_facturar_count');
  const kpiRealizados = biNumber('realizados');
  const kpiMargen = biNumber('margen');
  const kpiMargenPct = biNumber('margen_pct');
  const kpiEurKm = biNumber('eur_km');
  const kpiKmRealizados = biNumber('km_realizados');
  const kpiTicket = biNumber('ticket_medio_realizado');
  const kpiIncidencias = biNumber('incidencias');
  const kpiSinPrecio = biNumber('sin_precio');
  const kpiSinKm = biNumber('sin_km');
  const kpiPodPendiente = biNumber('pod_pendiente_realizados');
  const kpiFacturas = biNumber('facturas');
  const kpiCobroPct = biNumber('cobro_pct');
  const clientesRanking = (biResumen?.clientes || []).map(c=>({id:c.id,name:c.nombre,total:c.ingreso_gestionado,facturado:c.facturado,pendiente:c.pendiente_facturar_realizado,share:c.participacion_pct}));
  const metrics={ingreso:kpiIngresoGestionado,facturado:kpiFacturado,cobrado:kpiCobrado,pendiente:kpiPendienteCobro,sinFactura:kpiPendienteFacturar,pendientesCount:kpiPendientesFacturarCount,realizados:kpiRealizados,margen:kpiMargen,margenPct:kpiMargenPct,eurKm:kpiEurKm,km:kpiKmRealizados,ticket:kpiTicket,incidencias:kpiIncidencias,sinPrecio:kpiSinPrecio,sinKm:kpiSinKm,pod:kpiPodPendiente,facturas:kpiFacturas,cobroPct:kpiCobroPct};
  const canBI=puedeVer("informes")||puedeVer("facturacion");
  return <><DashboardWorkspace pedidos={pedidos} facturas={facturas} vehiculos={vehiculos} choferes={choferes} alertas={alertas} tareas={misTareas} loadErrors={loadErrors} reload={() => setReloadKey(k => k+1)} loading={loading} today={today} navigate={navegar} openOrder={enfocarPedidos} openAlert={abrirAlerta} advanced={() => setBiOpen(true)} showBI={canBI} onSnapshot={setPedidos} stateMeta={estadoPedidoMeta}/>
    {biOpen&&canBI&&<DashboardBI onClose={()=>setBiOpen(false)} period={period} setPeriod={setPeriod} metrics={metrics} clients={clientesRanking} series={biResumen?.series || []} clientSummary={biResumen?.clientes_resumen} metadata={biResumen?.metadata} loading={biLoading} error={biError}/>}
  </>;
}
