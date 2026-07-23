import { useState, useEffect, useMemo, useCallback } from "react";
import { getFacturas, getPedidos, getVehiculos, getChoferes, getExcepcionesOperativas, getEmpresaConfig, getTallerEstado, getPaletMovimientos } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { setRuntimeFocus } from "../services/runtimeFocus";
import { confirmDialog, notify } from "../services/notify";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const fmt2   = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN   = n => Number(n||0).toLocaleString("es-ES");
const S = {
  page:  { flex:1, padding:"28px 32px 34px", fontFamily:"'DM Sans',sans-serif", background:"linear-gradient(180deg,rgba(236,253,245,.18),rgba(255,255,255,0) 300px)" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:25, fontWeight:900, color:"var(--text)", letterSpacing:0 },
  card:  { background:"var(--card-bg)", border:"1px solid rgba(15,118,110,.12)", borderRadius:14, padding:"20px 22px", boxShadow:"0 16px 42px rgba(15,23,42,.10)" },
  kpi:   { background:"var(--card-bg)", border:"1px solid rgba(15,118,110,.12)", borderRadius:14, padding:"21px 24px", boxShadow:"0 16px 42px rgba(15,23,42,.10)", minHeight:106 },
  sec:   { fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", color:"var(--text5)", marginBottom:8, display:"flex", alignItems:"center", gap:6 },
  badge: { display:"inline-flex", alignItems:"center", padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700 },
};

const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#f97316","#06b6d4","#84cc16"];
const SEV = {
  critica: { label:"Critica", color:"#ef4444" },
  alta: { label:"Alta", color:"#f97316" },
  media: { label:"Media", color:"#f59e0b" },
  baja: { label:"Baja", color:"#3b82f6" },
  info: { label:"Info", color:"var(--accent-l)" },
};
const ESTADO_PEDIDO = {
  pendiente: { label:"Pendiente", color:"var(--text4)" },
  confirmado: { label:"Confirmado", color:"var(--accent-l)" },
  espera_carga: { label:"Espera carga", color:"#eab308" },
  cargando: { label:"Cargando", color:"#14b8a6" },
  en_curso: { label:"En ruta", color:"#f59e0b" },
  espera_descarga: { label:"Espera descarga", color:"#d946ef" },
  descarga: { label:"En descarga", color:"#a78bfa" },
  entregado: { label:"Entregado", color:"var(--green)" },
  facturado: { label:"Facturado", color:"#8b5cf6" },
  cancelado: { label:"Cancelado", color:"#ef4444" },
  incidencia: { label:"Incidencia", color:"#f97316" },
};
const ESTADO_PEDIDO_ORDEN = ["pendiente", "confirmado", "espera_carga", "cargando", "en_curso", "espera_descarga", "descarga", "entregado", "facturado", "incidencia", "cancelado"];

function estadoPedidoMeta(estado) {
  const key = String(estado || "").toLowerCase();
  return ESTADO_PEDIDO[key] || { label: key ? key.replace(/_/g, " ") : "-", color:"var(--text4)" };
}

function estadoPedidoKey(p) {
  return String(p?.estado || "").toLowerCase();
}

function pedidoRealizado(p) {
  return ["entregado", "facturado"].includes(estadoPedidoKey(p));
}

function pedidoTieneFactura(p) {
  return Boolean(p?.factura_id || p?.factura_numero || p?.facturado === true);
}

function importePedido(p) {
  return Number(p?.importe || p?.precio || p?.precio_cliente_col || 0);
}

function costeOperativoPedido(p) {
  return Number(p?.precio_colaborador || 0)
    + Number(p?.coste_gasoil || 0)
    + Number(p?.coste_peajes || 0)
    + Number(p?.coste_dietas || 0)
    + Number(p?.coste_otros || 0);
}

function fechaKpiPedido(p) {
  return p?.fecha_descarga || p?.fecha_carga || p?.fecha_pedido || p?.created_at;
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

async function abrirPedidosConEstado(estado, extra = {}) {
  const total = Number(extra.count ?? 1);
  const title = extra.title || estadoPedidoMeta(estado).label || `Pedidos en ${estado}`;
  if (total <= 0) {
    const crear = await confirmDialog({
      title: `Sin pedidos: ${title}`,
      message: `No hay pedidos en "${title}". Quieres crear uno nuevo?`,
      confirmText: "Crear pedido",
      cancelText: "Seguir en dashboard",
    });
    if (crear) {
      enfocarPedidos({
        source: "dashboard",
        action: "nuevo",
        title: "Nuevo pedido desde Dashboard",
      });
    } else {
      notify(`No hay pedidos en "${title}".`, "info");
    }
    return;
  }
  enfocarPedidos({
    source: "dashboard",
    estado,
    operativo: extra.operativo || "",
    title,
  });
}

function abrirPedidoDesdeDashboard(pedido, extra = {}) {
  if (!pedido?.id) return;
  enfocarPedidos({
    source: "dashboard",
    pedido_id: pedido.id,
    numero: pedido.numero || "",
    estado: pedido.estado || "",
    title: extra.title || "Pedido destacado desde dashboard",
  });
}

function incidenciaResumenPedido(pedido = {}) {
  const directa = String(pedido.incidencia_descripcion || "").trim();
  if (directa) return directa.replace(/^INCIDENCIA:\s*/i, "");
  const notas = String(pedido.notas || "");
  const match = notas.match(/INCIDENCIA(?: AUTO)?:\s*([^|]+)/i);
  return match ? match[1].trim() : "";
}

function AlertRow({ icon, texto, color, bg, view, focusKey, focus, actionLabel = "Abrir" }) {
  return (
    <button onClick={()=>abrirAlerta({ view, focusKey, focus })}
      style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:8,
                  background: bg||"rgba(239,68,68,.08)", border:`1px solid ${color}30`, marginBottom:6, cursor:"pointer", textAlign:"left", fontFamily:"'DM Sans',sans-serif" }}>
      <span style={{ fontSize:14 }}>{icon||""}</span>
      <span style={{ fontSize:12, color, fontWeight:700, flex:1 }}>{texto}</span>
      <span style={{ fontSize:10, color, fontWeight:900, textTransform:"uppercase", letterSpacing:".05em" }}>{actionLabel}</span>
    </button>
  );
}

const PERIOD_LABELS = { "7d":"7 días", "mes":"Este mes", "3m":"3 meses", "6m":"6 meses", "1y":"Este año", "all":"Todo" };

function DashboardIcon({ name, size = 24 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "truck") return (
    <svg {...common}>
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h4l3 3v3h-7z" />
      <path d="M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M17.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
    </svg>
  );
  if (name === "vehicle") return (
    <svg {...common}>
      <path d="M5 11h14l-1.4-4.2A2 2 0 0 0 15.7 5H8.3a2 2 0 0 0-1.9 1.8L5 11z" />
      <path d="M5 11v5h14v-5" />
      <path d="M7.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
      <path d="M16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
    </svg>
  );
  if (name === "driver") return (
    <svg {...common}>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
      <path d="M4 21a8 8 0 0 1 16 0" />
      <path d="M15 14l2 3" />
      <path d="M9 14l-2 3" />
    </svg>
  );
  if (name === "euro") return (
    <svg {...common}>
      <path d="M17 5.5A7 7 0 1 0 17 18.5" />
      <path d="M5 10h10" />
      <path d="M5 14h9" />
    </svg>
  );
  if (name === "clipboard") return (
    <svg {...common}>
      <path d="M9 4h6l1 2h3v15H5V6h3z" />
      <path d="M9 4v3h6V4" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
  if (name === "bars") return (
    <svg {...common}>
      <path d="M5 20V10" />
      <path d="M12 20V4" />
      <path d="M19 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
  if (name === "pie") return (
    <svg {...common}>
      <path d="M12 3v9h9" />
      <path d="M20.5 15a9 9 0 1 1-11-11" />
    </svg>
  );
  if (name === "money") return (
    <svg {...common}>
      <path d="M3 7h18v10H3z" />
      <path d="M7 12h.01" />
      <path d="M17 12h.01" />
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
    </svg>
  );
  if (name === "pulse") return (
    <svg {...common}>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </svg>
  );
  if (name === "tower") return (
    <svg {...common}>
      <path d="M8 21l4-18 4 18" />
      <path d="M7 10h10" />
      <path d="M6 15h12" />
      <path d="M9 6h6" />
    </svg>
  );
  return (
    <svg {...common}>
      <path d="M4 4h16v16H4z" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </svg>
  );
}

function ExecutiveKpi({ icon, iconBg, iconColor, value, label, sub, valueColor }) {
  return (
    <div style={{...S.kpi,display:"flex",alignItems:"center",gap:18}}>
      <div style={{width:58,height:58,borderRadius:"50%",background:iconBg,color:iconColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:900,boxShadow:"inset 0 0 0 1px rgba(255,255,255,.44)",flexShrink:0}}>
        {icon}
      </div>
      <div style={{minWidth:0}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:900,color:valueColor || "var(--text)",lineHeight:1.05}}>{value}</div>
        <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginTop:5}}>{label}</div>
        <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>{sub}</div>
      </div>
    </div>
  );
}

function PanelTitle({ icon, title, action }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
        {icon && (
          <span style={{width:30,height:30,borderRadius:9,border:"1px solid rgba(15,118,110,.18)",background:"rgba(20,184,166,.07)",color:"var(--accent-xl)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,flexShrink:0}}>
            {icon}
          </span>
        )}
        <span style={{...S.sec,marginBottom:0}}>{title}</span>
      </div>
      {action}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [period,    setPeriod]    = useState("mes");
  const [pedidos,   setPedidos]   = useState([]);
  const [facturas,  setFacturas]  = useState([]);
  const [vehiculos,  setVehiculos]  = useState([]);
  const [choferes,  setChoferes]  = useState([]);
  const [misTareas, setMisTareas] = useState([]);
  const [empresaCfg, setEmpresaCfg] = useState({ cfg_alertas: [] });
  const [tallerEstado, setTallerEstado] = useState({ stock: [], reparaciones: [] });
  const [paletMovimientos, setPaletMovimientos] = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
      const _tout = (p, ms=8000) => Promise.race([p, new Promise(r=>setTimeout(()=>r([]),ms))]);
        const [p, f, v, c, ex, cfg, taller, palets] = await Promise.all([
          _tout(getPedidos({}, { timeoutMs: 45000, silentError: true }).catch(()=>[]), 45000),
          getFacturas().catch(()=>[]),
          getVehiculos().catch(()=>[]),
          getChoferes().catch(()=>[]),
          getExcepcionesOperativas().catch(()=>null),
          getEmpresaConfig().catch(()=>null),
          getTallerEstado().catch(()=>null),
          getPaletMovimientos().catch(()=>[]),
        ]);
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
      finally { setLoading(false); }
    }
    load();
  }, [user?.id, user?.rol]);

  // ── Filter by period ──
  const filterByPeriod = useCallback((items, dateKey="fecha") => {
    const now  = new Date();
    if (period === "all") return items;
    if (period === "mes") {
      // Calendar month: current month only
      const y = now.getFullYear(), m = now.getMonth();
      const start = new Date(y, m, 1);
      const end   = new Date(y, m+1, 0, 23, 59, 59);
      return items.filter(x => {
        if (!x[dateKey]) return false;
        const d2 = new Date(x[dateKey]);
        return d2 >= start && d2 <= end;
      });
    }
    const cuts = { "7d":7, "3m":90, "6m":180, "1y":365 };
    if (!cuts[period]) return items;
    const cut = new Date(now); cut.setDate(cut.getDate() - cuts[period]);
    return items.filter(x => x[dateKey] && new Date(x[dateKey]) >= cut);
  }, [period]);

  const {
    pedKpi, totalFacturado, cobrado, pendiente,
    nFacturas, ingresoGestionado, pendienteFacturarRealizado, pedidosRealizados, eurKmRealizado,
    costeTotal, margenTotal, margenPct,
    vDisp, vTaller, cDisp,
    estadosPed, facMensual, topClientes, alertas,
    operativos,
    today, ultPedidos, estadoColor,
  } = useMemo(() => {
    const pedidosKpiPeriodo = pedidos.map(p => ({ ...p, _fecha_kpi: fechaKpiPedido(p) }));
    const pedFilt = filterByPeriod(pedidosKpiPeriodo, "_fecha_kpi");
    const pedKpi = pedFilt.filter(p => ["confirmado","en_curso","descarga","entregado","facturado"].includes(estadoPedidoKey(p)));
    const pedidosRealizados = pedFilt.filter(pedidoRealizado);
    const pedidosRealizadosSinFactura = pedidosRealizados.filter(p => !pedidoTieneFactura(p));
    const facFilt = filterByPeriod(facturas, "fecha");
  
    // ── KPIs ──
    // Solo facturas emitidas/enviadas/cobradas - no borradores
    const facEmitidas    = facFilt.filter(f=>["emitida","enviada","cobrada","vencida"].includes(f.estado));
    const totalFacturado = facEmitidas.reduce((s,f)=>s+Number(f.total||0),0);
    const cobrado        = facEmitidas.filter(f=>f.estado==="cobrada").reduce((s,f)=>s+Number(f.total||0),0);
    const pendiente      = facEmitidas.filter(f=>["emitida","enviada"].includes(f.estado)).reduce((s,f)=>s+Number(f.total||0),0);
    const nFacturas      = facEmitidas.length;
    const pendienteFacturarRealizado = pedidosRealizadosSinFactura.reduce((s,p)=>s+importePedido(p),0);
    const ingresoGestionado = totalFacturado + pendienteFacturarRealizado;
    const costeTotal = pedidosRealizados.reduce((s,p)=>s+costeOperativoPedido(p),0);
    const margenTotal = ingresoGestionado - costeTotal;
    const margenPct   = ingresoGestionado>0 ? (margenTotal/ingresoGestionado*100).toFixed(1) : null;
    const kmRealizados = pedidosRealizados.reduce((s,p)=>s+Number(p.km_ruta||0)+Number(p.km_vacio||0),0);
    const eurKmRealizado = kmRealizados>0 ? ingresoGestionado/kmRealizados : 0;
    // Fleet stats: tractoras for operational KPIs, all vehicles for taller
    const _remIds2 = new Set(vehiculos.map(v=>v.remolque_id).filter(Boolean));
    const esTractora = v => {
      const cl=(v.clase||v.tipo||"").toLowerCase();
      const mat=(v.matricula||"").toUpperCase();
      return !cl.includes("remolque")&&!cl.includes("semirremolque")&&!cl.includes("dolly")&&
             !_remIds2.has(v.id)&&!mat.startsWith("R-")&&!mat.endsWith("-R");
    };
    const vDisp      = vehiculos.filter(v=>v.estado==="disponible" && esTractora(v)).length;
    const vRuta      = vehiculos.filter(v=>v.estado==="en_ruta"    && esTractora(v)).length;
    const vTaller    = vehiculos.filter(v=>v.estado==="taller").length; // ALL vehicles (remolques también)
    const cDisp          = choferes.filter(c=>c.activo!==false&&c.estado!=="baja").length;
  
    // ── Estado de pedidos ──
    const estadoCounts = pedFilt.filter(p => String(p.estado || "").toLowerCase() !== "cancelado").reduce((acc, p) => {
      const key = String(p.estado || "sin_estado").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const estadosOrdenados = [
      ...ESTADO_PEDIDO_ORDEN.filter(e => estadoCounts[e]),
      ...Object.keys(estadoCounts).filter(e => !ESTADO_PEDIDO_ORDEN.includes(e)).sort(),
    ];
    const estadosPed = estadosOrdenados.map(e=>({
      key: e,
      name: estadoPedidoMeta(e).label,
      count: estadoCounts[e],
      color: estadoPedidoMeta(e).color,
    })).filter(x=>x.count>0);
    const enCarga = pedFilt.filter(p => {
      const estado = String(p.estado || "").toLowerCase();
      const fecha = String(p.fecha_carga || p.fecha_pedido || "").slice(0, 10);
      const hoyIso = new Date().toISOString().slice(0, 10);
      return estado === "confirmado" && Boolean(fecha) && fecha <= hoyIso;
    });
    const enDescarga = pedFilt.filter(p => String(p.estado || "").toLowerCase() === "descarga");
    const enRuta = pedFilt.filter(p => String(p.estado || "").toLowerCase() === "en_curso");
    const conIncidencia = pedFilt.filter(p => String(p.estado || "").toLowerCase() === "incidencia");
    const operativos = [
      { key:"carga", estado:"confirmado", label:"En carga", value:enCarga.length, color:"#f59e0b", sub:"Confirmados con carga ya prevista" },
      { key:"ruta", estado:"en_curso", label:"En ruta", value:enRuta.length, color:"#3b82f6", sub:"Viajes circulando" },
      { key:"descarga", estado:"descarga", label:"En descarga", value:enDescarga.length, color:"#a78bfa", sub:"En destino o descargando" },
      { key:"incidencia", estado:"incidencia", label:"Incidencia", value:conIncidencia.length, color:"#ef4444", sub:"Requieren revisión" },
    ];
  
    // ── Facturación mensual ──
    const facMensual = (() => {
      const meses = {};
      facEmitidas.forEach(f => {
        if (!f.fecha) return;
        const k = f.fecha.slice(0,7); // YYYY-MM
        if (!meses[k]) meses[k] = { facturado:0, pendiente:0 };
        meses[k].facturado += Number(f.total||0);
      });
      pedidosRealizadosSinFactura.forEach(p => {
        const fecha = fechaKpiPedido(p);
        if (!fecha) return;
        const k = String(fecha).slice(0,7);
        if (!meses[k]) meses[k] = { facturado:0, pendiente:0 };
        meses[k].pendiente += importePedido(p);
      });
      return Object.entries(meses).sort(([a],[b])=>a.localeCompare(b))
        .map(([k,v])=>({ name: new Date(k+"-01").toLocaleDateString("es-ES",{month:"short",year:"2-digit"}), ...v, total:(v.facturado||0)+(v.pendiente||0) }));
    })();
  
    // ── Top clientes ──
    const topClientes = (() => {
      const map = {};
      const ensure = name => {
        const key = name || "Desconocido";
        if (!map[key]) map[key] = { total:0, facturado:0, pendiente:0, cobrado:0, nfact:0, viajes_realizados:0 };
        return map[key];
      };
      facEmitidas.forEach(f => {
        const row = ensure(f.cliente_nombre);
        const total = Number(f.total||0);
        row.total += total;
        row.facturado += total;
        row.nfact += 1;
        if (f.estado === "cobrada") row.cobrado += total;
      });
      pedidosRealizadosSinFactura.forEach(p => {
        const row = ensure(p.cliente_nombre || p.cliente);
        const importe = importePedido(p);
        row.total += importe;
        row.pendiente += importe;
        row.viajes_realizados += 1;
      });
      return Object.entries(map).filter(([,v])=>v.total>0).sort(([,a],[,b])=>b.total-a.total).slice(0,5).map(([name,v])=>({ name, ...v }));
    })();
  
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
      if (f.estado === "cobrada" || f.estado === "rectificada") return;
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
  
    // ── Últimas actividades ──
    const ultPedidos = [...pedidos].sort((a,b)=>new Date(b.fecha_pedido||0)-new Date(a.fecha_pedido||0)).slice(0,5);
    const estadoColor = Object.fromEntries(Object.entries(ESTADO_PEDIDO).map(([key, value]) => [key, value.color]));
  
    const today = new Date().toLocaleDateString("es-ES",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  

    return {
      pedKpi, facFilt, facEmitidas, totalFacturado, cobrado, pendiente,
      nFacturas, ingresoGestionado, pendienteFacturarRealizado, pedidosRealizados, eurKmRealizado,
      costeTotal, margenTotal, margenPct,
      vDisp, vRuta, vTaller, cDisp,
      estadosPed, facMensual, topClientes, alertas,
      operativos,
      today, ultPedidos, estadoColor,
    };
  }, [pedidos, facturas, vehiculos, choferes, filterByPeriod, empresaCfg, tallerEstado, paletMovimientos]);

  const puedeVerControlTower = false;
  const controlAnalysis = null;
  const towerResumen = {};
  const towerKpis = {};
  const towerVistas = {};
  const towerItems = [];
  const towerIncidencias = [];
  const towerHoy = [];
  const towerRiesgos = [];
  const towerRentabilidad = [];
  const towerVistaItems = [];
  const towerExpanded = false;
  const towerTab = "todas";
  const controlTowerRef = { current: null };
  const setTowerExpanded = () => {};
  const setTowerTab = () => {};
  const abrirControlAnalysisAction = () => {};
  const renderTowerItem = () => null;

  return (
    <div className="tg-responsive-page" style={S.page}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:26, flexWrap:"wrap", gap:16 }}>
        <div>
          <div style={S.title}>Dashboard Ejecutivo</div>
          <div style={{ fontSize:12, color:"var(--text4)", marginTop:4, textTransform:"capitalize" }}>{today}</div>
          <div style={{ fontSize:11, color:"var(--text5)", marginTop:3 }}>
            Vista de negocio y salud general. La operativa diaria se atiende en Control Tower.
          </div>
        </div>
        {/* Period selector */}
        <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>navegar("control_tower")} style={{border:"1px solid rgba(15,118,110,.18)",background:"var(--card-bg)",color:"var(--accent-xl)",borderRadius:10,padding:"10px 16px",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 10px 25px rgba(15,23,42,.07)",display:"inline-flex",alignItems:"center",gap:8}}>
            <DashboardIcon name="tower" size={15} /> Abrir Control Tower
          </button>
          <div style={{ display:"flex", gap:4, background:"var(--card-bg)", padding:5, borderRadius:11, border:"1px solid rgba(15,118,110,.12)", boxShadow:"0 10px 25px rgba(15,23,42,.07)" }}>
            {Object.entries(PERIOD_LABELS).map(([k,l])=>(
              <button key={k} onClick={()=>setPeriod(k)}
                style={{ padding:"8px 17px", borderRadius:8, border:"none", fontFamily:"'DM Sans',sans-serif",
                         fontSize:12, fontWeight:600, cursor:"pointer",
                         background: period===k ? "var(--accent)" : "transparent",
                         color:      period===k ? "#fff" : "var(--text4)" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color:"var(--text4)", padding:40, textAlign:"center" }}>Cargando datos...</div>
      ) : (
        <>
          {/* ── KPI Row ── */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:22, marginBottom:22 }}>
            {[
              { label:"TOTAL VIAJES",      val:pedKpi.length,         sub:`${pedKpi.filter(p=>p.estado==="en_curso").length} en curso`,   color:"var(--accent-xl)" },
              { label:"VEHÍCULOS DISP.",
                val:`${vDisp}/${vehiculos.filter(v=>{const cl=(v.clase||v.tipo||"").toLowerCase();const mat=(v.matricula||"").toUpperCase();const rids=new Set(vehiculos.map(x=>x.remolque_id).filter(Boolean));return !cl.includes("remolque")&&!cl.includes("semirremolque")&&!cl.includes("dolly")&&!rids.has(v.id)&&!mat.startsWith("R-")&&!mat.endsWith("-R");}).length}`,
                sub:`${vTaller} en mantenimiento`,                            color:"var(--green)" },
              { label:"CHÓFERES DISP.",    val:`${cDisp}/${choferes.length}`,  sub:`${choferes.filter(c=>c.estado==="vacaciones").length} de vacaciones`, color:"var(--text)" },
              { label:"INGRESO GESTIONADO", val:`${fmt2(ingresoGestionado)} EUR`,     sub:`${fmtN(nFacturas)} facturas + ${fmtN(pedidosRealizados.length)} viajes realizados`,                  color:"#f59e0b" },
            ].map((k,i)=>(
              <ExecutiveKpi
                key={i}
                icon={[
                  <DashboardIcon name="truck" size={25} />,
                  <DashboardIcon name="vehicle" size={25} />,
                  <DashboardIcon name="driver" size={25} />,
                  <DashboardIcon name="euro" size={25} />,
                ][i]}
                iconBg={[
                  "linear-gradient(135deg,#0f766e,#14b8a6)",
                  "rgba(20,184,166,.22)",
                  "rgba(245,158,11,.24)",
                  "rgba(249,115,22,.28)",
                ][i]}
                iconColor={["#fff","var(--accent-xl)","#b45309","#c2410c"][i]}
                value={k.val}
                label={k.label}
                sub={k.sub}
                valueColor={i === 3 ? "#b45309" : k.color}
              />
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:12, marginBottom:22 }}>
            {operativos.map(item => (
              <button key={item.key} onClick={()=>abrirPedidosConEstado(item.estado, { title:item.label, count:item.value, operativo:item.key })}
                style={{...S.card,padding:"14px 16px",textAlign:"left",cursor:"pointer",borderColor:`${item.color}44`,background:`linear-gradient(135deg, ${item.color}12, var(--card-bg) 60%)`,fontFamily:"'DM Sans',sans-serif"}}>
                <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:item.color}}>{item.label}</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:25,fontWeight:900,color:"var(--text)",marginTop:5}}>{fmtN(item.value)}</div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>{item.sub}</div>
              </button>
            ))}
          </div>

          {/* ── Row 2: estado viajes + alertas ── */}
          {puedeVerControlTower && controlAnalysis?.resumen && (
          <div style={{...S.card,marginBottom:12,borderColor:controlAnalysis.resumen.salud==="critica"?"rgba(239,68,68,.38)":controlAnalysis.resumen.salud==="alerta"?"rgba(249,115,22,.34)":"var(--border)"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
              <div style={{flex:"1 1 360px"}}>
                <div style={{...S.sec,marginBottom:4}}>Analisis operativo</div>
                <div style={{fontSize:15,fontWeight:900,color:"var(--text)",lineHeight:1.3}}>{controlAnalysis.resumen.headline || "Operacion revisada con datos reales."}</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:4}}>
                  {Number(controlAnalysis.resumen.activos || 0)} activos - {Number(controlAnalysis.resumen.cargas_hoy || 0)} cargas hoy - {Number(controlAnalysis.resumen.descargas_hoy || 0)} descargas hoy
                  {controlAnalysis.resumen.margen_pct != null ? ` - margen ${fmt2(controlAnalysis.resumen.margen_pct)}%` : ""}
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                {[
                  ["Prioridades", controlAnalysis.resumen.total_prioridades, "var(--accent-xl)"],
                  ["Criticas", controlAnalysis.resumen.criticas, "#ef4444"],
                  ["Altas", controlAnalysis.resumen.altas, "#f97316"],
                ].map(([label,value,color])=>(
                  <div key={label} style={{minWidth:90,border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:900,color}}>{Number(value || 0)}</div>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
            {Array.isArray(controlAnalysis.prioridades) && controlAnalysis.prioridades.length > 0 ? (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:8}}>
                {controlAnalysis.prioridades.slice(0,4).map(p=>{
                  const sev = SEV[p.severity] || SEV.info;
                  return (
                    <div key={p.key} style={{border:`1px solid ${sev.color}40`,background:`${sev.color}0f`,borderRadius:8,padding:"9px 10px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                        <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:sev.color}}>{sev.label}</span>
                        <span style={{fontSize:10,color:"var(--text5)",fontWeight:800}}>{p.area}</span>
                      </div>
                      <div style={{fontSize:13,fontWeight:900,color:"var(--text)",marginTop:5,lineHeight:1.25}}>{p.title}</div>
                      <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.35,marginTop:4}}>{p.recommended_action || p.answer}</div>
                      {Array.isArray(p.playbook) && p.playbook.length > 0 && (
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:7}}>
                          {p.playbook.slice(0,3).map((step,idx)=>(
                            <span key={idx} style={{fontSize:10,fontWeight:700,color:"var(--text4)",background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:999,padding:"2px 7px"}}>
                              {step}
                            </span>
                          ))}
                        </div>
                      )}
                      {Array.isArray(p.quick_actions) && p.quick_actions.length > 0 && (
                        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:8}}>
                          {p.quick_actions.slice(0,3).map(action=>(
                            <button key={action.key || action.label} onClick={()=>abrirControlAnalysisAction(p, action)}
                              style={{fontSize:10,fontWeight:800,border:`1px solid ${action.primary ? "rgba(20,184,166,.35)" : "var(--border)"}`,background:action.primary ? "rgba(20,184,166,.10)" : "var(--bg3)",color:action.primary ? "var(--accent-xl)" : "var(--text4)",borderRadius:20,padding:"2px 7px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{fontSize:12,color:"var(--green)",fontWeight:800}}>Sin prioridades criticas detectadas.</div>
            )}
          </div>
          )}

          {puedeVerControlTower && (
          <div ref={controlTowerRef} style={{...S.card,marginBottom:12,borderColor:Number(towerResumen.critica||0)>0?"rgba(239,68,68,.40)":Number(towerResumen.alta||0)>0?"rgba(249,115,22,.35)":"var(--border)"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
              <div style={{flex:"1 1 320px"}}>
                <button onClick={()=>setTowerExpanded(v=>!v)} style={{...S.sec,marginBottom:4,border:"none",background:"transparent",padding:0,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  Control Tower operativo
                </button>
                <div style={{fontSize:12,color:"var(--text4)"}}>Senales priorizadas de trafico, margen, documentos, cobros y GPS para decidir que atender primero.</div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                {[
                  ["Activos", towerKpis.activos, "var(--accent-xl)"],
                  ["Cargas hoy", towerKpis.cargas_hoy, "#f59e0b"],
                  ["Descargas hoy", towerKpis.descargas_hoy, "var(--green)"],
                  ["Criticas", towerResumen.critica, "#ef4444"],
                  ["Altas", towerResumen.alta, "#f97316"],
                ].map(([label,value,color])=>(
                  <div key={label} style={{minWidth:92,border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:900,color}}>{Number(value || 0)}</div>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
            {towerItems.length === 0 ? (
              <div style={{fontSize:12,color:"var(--green)",fontWeight:800}}>No hay senales criticas en la torre de control.</div>
            ) : (
              <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{fontSize:11,color:"var(--text5)",fontWeight:800}}>
                    Mostrando {Math.min(6, towerItems.length)} de {towerItems.length} senales
                    {towerIncidencias.length ? ` - ${towerIncidencias.length} incidencias` : ""}
                  </div>
                  <button onClick={()=>setTowerExpanded(v=>!v)} style={{border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text2)",borderRadius:7,padding:"5px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    {towerExpanded ? "Ocultar detalle" : `Ver todas (${towerItems.length})`}
                  </button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:8}}>
                  {towerItems.slice(0,6).map(item=>renderTowerItem(item, true))}
                </div>
                {towerExpanded && (
                  <div style={{marginTop:12,borderTop:"1px solid var(--border)",paddingTop:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>Control Tower completo</div>
                        <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>Pedidos no facturados y senales operativas pendientes de revision.</div>
                      </div>
                      <div style={{display:"flex",gap:6,background:"var(--bg3)",padding:4,borderRadius:8,border:"1px solid var(--border)",flexWrap:"wrap"}}>
                        {[
                          ["todas", `Todas (${towerVistas.todas ?? towerItems.length})`],
                          ["hoy", `Hoy (${towerVistas.hoy ?? towerHoy.length})`],
                          ["riesgos", `Riesgos (${towerVistas.riesgos ?? towerRiesgos.length})`],
                          ["rentabilidad", `Rentabilidad (${towerVistas.rentabilidad ?? towerRentabilidad.length})`],
                          ["incidencias", `Incidencias (${towerVistas.incidencias ?? towerIncidencias.length})`],
                        ].map(([key,label])=>(
                          <button key={key} onClick={()=>setTowerTab(key)}
                            style={{padding:"5px 10px",borderRadius:6,border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:800,cursor:"pointer",background:towerTab===key?"var(--accent)":"transparent",color:towerTab===key?"#fff":"var(--text4)"}}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {towerVistaItems.length === 0 ? (
                      <div style={{fontSize:12,color:"var(--text5)",padding:"12px 0"}}>No hay elementos en esta vista.</div>
                    ) : (
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:8,maxHeight:520,overflowY:"auto",paddingRight:4}}>
                        {towerVistaItems.map(item=>renderTowerItem(item))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          )}

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(420px,100%),1fr))", gap:22, marginBottom:22, alignItems:"stretch" }}>
            <div style={{display:"grid",gap:22}}>
          <div style={{...S.card,minHeight:98,borderColor:misTareas.length>0?"rgba(249,115,22,.28)":"rgba(15,118,110,.12)"}}>
            <PanelTitle
              icon={<DashboardIcon name="clipboard" size={17} />}
              title="Mis tareas de hoy"
              action={(
                <button onClick={()=>navegar("agenda")}
                  style={{border:"1px solid rgba(15,118,110,.16)",background:"rgba(15,118,110,.07)",color:"var(--accent-xl)",borderRadius:9,padding:"8px 14px",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  Abrir agenda
                </button>
              )}
            />
            {misTareas.length===0 ? (
              <div style={{fontSize:12,color:"var(--green)",fontWeight:700}}>No tienes tareas pendientes asignadas.</div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:8}}>
                {misTareas.map(t=>{
                  const sev = SEV[t.severity] || SEV.info;
                  return (
                    <div key={t.id} style={{border:`1px solid ${sev.color}44`,background:`${sev.color}10`,borderRadius:8,padding:"9px 11px",display:"flex",flexDirection:"column",gap:5}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                        <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:sev.color}}>{sev.label}</span>
                        <span style={{fontSize:10,color:"var(--text5)",fontWeight:800}}>{t.area}</span>
                      </div>
                      <div style={{fontSize:13,fontWeight:800,color:"var(--text)",lineHeight:1.25}}>{t.title}</div>
                      <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.35,flex:1}}>{t.description}</div>
                      <button onClick={()=>navegar(t.view)} style={{alignSelf:"flex-start",border:"1px solid #1e2d45",background:"var(--bg4)",color:"var(--text)",borderRadius:7,padding:"5px 9px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                        {t.action || "Abrir"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bloques ejecutivos */}
            {/* Estado de viajes */}
            <div style={S.card}>
              <PanelTitle icon={<DashboardIcon name="bars" size={17} />} title="Estado de viajes" />
              {estadosPed.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin viajes en el período seleccionado</div>
                : estadosPed.map((e,i) => {
                  const max = Math.max(...estadosPed.map(x=>x.count));
                  return (
                    <button key={i} type="button" onClick={()=>abrirPedidosConEstado(e.key, { title:e.name, count:e.count })}
                      style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, width:"100%", border:"none", background:"transparent", padding:0, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                      <div style={{ width:90, fontSize:12, color:"var(--text2)", flexShrink:0 }}>{e.name}</div>
                      <div style={{ flex:1, background:"var(--bg4)", borderRadius:4, height:8, overflow:"hidden" }}>
                        <div style={{ width:`${(e.count/max)*100}%`, height:"100%", background:e.color, borderRadius:4, transition:"width .4s" }}/>
                      </div>
                      <div style={{ width:24, textAlign:"right", fontWeight:700, fontSize:12, color:"var(--text)", flexShrink:0 }}>{e.count}</div>
                    </button>
                  );
                })
              }
            </div>
            </div>

            {/* Alertas activas */}
            <div style={{...S.card,minHeight:290}}>
              <PanelTitle
                icon="!"
                title="Alertas activas"
                action={alertas.length > 0 && (
                  <span style={{ background:"var(--red)", color:"#fff", borderRadius:"50%", width:22, height:22,
                                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900 }}>
                    {alertas.length}
                  </span>
                )}
              />
              <div style={{ maxHeight:300, overflowY:"auto", paddingRight:2 }}>
                {alertas.length === 0
                  ? <div style={{ color:"var(--green)", fontSize:12, display:"flex", gap:6, alignItems:"center" }}>Sin alertas activas</div>
                  : alertas.slice(0, 7).map((a,i) => <AlertRow key={i} {...a}/>)
                }
                {alertas.length > 7 && (
                  <button onClick={()=>navegar("avisos")} style={{width:"100%",marginTop:4,border:"1px solid rgba(15,118,110,.18)",background:"rgba(15,118,110,.07)",color:"var(--accent-xl)",borderRadius:8,padding:"8px 10px",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    Ver todas las alertas
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Row 3: Evolución mensual + Top clientes ── */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(420px,100%),1fr))", gap:22, marginBottom:22 }}>
            {/* Evolución mensual */}
            <div style={S.card}>
              <PanelTitle icon={<DashboardIcon name="bars" size={17} />} title="EVOLUCIÓN MENSUAL" />
              {facMensual.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12, padding:"24px 0", textAlign:"center" }}>Sin datos para este período</div>
                : (
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={facMensual} margin={{top:0,right:0,bottom:0,left:0}}>
                      <XAxis dataKey="name" tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false} width={50}
                        tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                      <Tooltip contentStyle={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}}
                        formatter={(v,n)=>[`${fmt2(v)} EUR`, n==="facturado" ? "Facturado" : "Realizado sin factura"]}/>
                      <Bar dataKey="facturado" stackId="ingresos" fill="var(--accent-l)" radius={[4,4,0,0]}/>
                      <Bar dataKey="pendiente" stackId="ingresos" fill="#f59e0b" radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </div>

            {/* Por cliente */}
            <div style={S.card}>
              <PanelTitle icon={<DashboardIcon name="pie" size={17} />} title="POR CLIENTE" />
              {topClientes.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12, padding:"24px 0", textAlign:"center" }}>Sin datos</div>
                : topClientes.map((c,i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, gap:12 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:COLORS[i%COLORS.length] }}/>
                      <span style={{ fontSize:12, color:"var(--text2)" }}>{c.name.length>22?c.name.slice(0,22)+"…":c.name}</span>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:"var(--text)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.total)} EUR</div>
                      <div style={{ fontSize:10, color:"var(--text5)" }}>
                        {fmt2(c.facturado)} fact.{Number(c.pendiente||0)>0 ? ` + ${fmt2(c.pendiente)} sin fact.` : ""}
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>

          {/* ── Row 4: KPIs financieros + últimas actividades ── */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(420px,100%),1fr))", gap:22 }}>
            {/* Resumen financiero */}
            <div style={S.card}>
              <PanelTitle icon={<DashboardIcon name="money" size={17} />} title="RESUMEN FINANCIERO" />
              {[
                { l:"Ingreso gestionado", v:`${fmt2(ingresoGestionado)} EUR`, c:"var(--accent-xl)" },
                { l:"Facturado emitido", v:`${fmt2(totalFacturado)} EUR`,  c:"var(--text)" },
                { l:"Realizado sin facturar", v:`${fmt2(pendienteFacturarRealizado)} EUR`, c:"#f59e0b" },
                { l:"Cobrado",           v:`${fmt2(cobrado)} EUR`,         c:"var(--green)" },
                { l:"Pendiente cobro",   v:`${fmt2(pendiente)} EUR`,       c:"#f59e0b" },
                { l:"% cobrado",         v:`${totalFacturado>0?((cobrado/totalFacturado)*100).toFixed(1):0}%`, c:"var(--accent-xl)" },
                ...(eurKmRealizado>0 ? [
                  { l:"EUR/km realizado", v:`${fmt2(eurKmRealizado)} EUR/km`, c:"var(--accent-xl)" },
                ] : []),
                ...(costeTotal>0 ? [
                  { l:"Costes viajes",   v:`${fmt2(costeTotal)} EUR`,      c:"#ef4444" },
                  { l:"Margen bruto",    v:`${fmt2(margenTotal)} EUR${margenPct?` (${margenPct}%)` :""}`, c:margenTotal>=0?"var(--green)":"#ef4444" },
                ] : []),
              ].map((k,i)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid var(--border)" }}>
                  <span style={{ fontSize:12, color:"var(--text4)" }}>{k.l}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:k.c, fontFamily:"'JetBrains Mono',monospace" }}>{k.v}</span>
                </div>
              ))}
            </div>

            {/* Últimas actividades */}
            <div style={S.card}>
              <PanelTitle icon={<DashboardIcon name="pulse" size={17} />} title="ÚLTIMAS ACTIVIDADES" />
              {ultPedidos.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12 }}>Sin actividad reciente</div>
                : ultPedidos.map((p,i)=>(
                  <button key={i} type="button" onClick={()=>abrirPedidoDesdeDashboard(p, { title:String(p.estado).toLowerCase()==="incidencia" ? "Revisar incidencia" : "Abrir pedido" })}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", border:"none", borderBottom:"1px solid var(--border)", background:"transparent", width:"100%", textAlign:"left", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:estadoColor[p.estado]||"var(--text4)", flexShrink:0 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        {p.origen&&p.destino ? `${p.origen} -> ${p.destino}` : p.numero}
                      </div>
                      <div style={{ fontSize:10, color:"var(--text4)" }}>
                        {p.cliente_nombre||"-"} - {p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):""}
                      </div>
                      {String(p.estado || "").toLowerCase() === "incidencia" && incidenciaResumenPedido(p) && (
                        <div style={{fontSize:10,color:"#ef4444",fontWeight:800,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          {incidenciaResumenPedido(p)}
                        </div>
                      )}
                    </div>
                    <span style={{ ...S.badge, background:`${estadoColor[p.estado]||"var(--text4)"}1a`, color:estadoColor[p.estado]||"var(--text4)", flexShrink:0 }}>
                      {estadoPedidoMeta(p.estado).label}
                    </span>
                  </button>
                ))
              }
            </div>
          </div>
        </>
      )}
    </div>
  );
}

