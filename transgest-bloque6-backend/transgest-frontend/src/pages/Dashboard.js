import { useState, useEffect, useMemo, useCallback } from "react";
import { getFacturas, getPedidos, getVehiculos, getChoferes, getExcepcionesOperativas, getActividad, getEmpresaConfig, getTallerEstado, getPaletMovimientos } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const fmt2   = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN   = n => Number(n||0).toLocaleString("es-ES");
const S = {
  page:  { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:"var(--text)" },
  card:  { background:"var(--card-bg)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 18px" },
  kpi:   { background:"var(--card-bg)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 18px", flex:1 },
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
  en_curso: { label:"En ruta", color:"#f59e0b" },
  descarga: { label:"En descarga", color:"#a78bfa" },
  entregado: { label:"Entregado", color:"var(--green)" },
  facturado: { label:"Facturado", color:"#8b5cf6" },
  cancelado: { label:"Cancelado", color:"#ef4444" },
  incidencia: { label:"Incidencia", color:"#f97316" },
};
const ESTADO_PEDIDO_ORDEN = ["pendiente", "confirmado", "en_curso", "descarga", "entregado", "facturado", "incidencia", "cancelado"];

function estadoPedidoMeta(estado) {
  const key = String(estado || "").toLowerCase();
  return ESTADO_PEDIDO[key] || { label: key ? key.replace(/_/g, " ") : "-", color:"var(--text4)" };
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

function AlertRow({ icon, texto, color, bg }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:8,
                  background: bg||"rgba(239,68,68,.08)", border:`1px solid ${color}30`, marginBottom:6 }}>
      <span style={{ fontSize:14 }}>{icon||""}</span>
      <span style={{ fontSize:12, color, fontWeight:500 }}>{texto}</span>
    </div>
  );
}

function actividadModulo(accion) {
  const raw = String(accion || "");
  if (raw.includes("/pedidos")) return "Pedidos";
  if (raw.includes("/facturas")) return "Facturacion";
  if (raw.includes("/clientes")) return "Clientes";
  if (raw.includes("/vehiculos")) return "Vehiculos";
  if (raw.includes("/choferes")) return "Choferes";
  if (raw.includes("/colaboradores")) return "Colaboradores";
  if (raw.includes("/taller")) return "Taller";
  if (raw.includes("/palets")) return "Almacen";
  return "Sistema";
}

function actividadColor(accion, status) {
  if (Number(status || 0) >= 400) return "#ef4444";
  const method = String(accion || "").split(" ")[0];
  if (method === "POST") return "var(--green)";
  if (method === "PUT" || method === "PATCH") return "#f59e0b";
  if (method === "DELETE") return "#ef4444";
  return "var(--accent-l)";
}

const PERIOD_LABELS = { "7d":"7 días", "mes":"Este mes", "3m":"3 meses", "6m":"6 meses", "1y":"Este año", "all":"Todo" };

export default function Dashboard() {
  const { user } = useAuth();
  const [period,    setPeriod]    = useState("mes");
  const [pedidos,   setPedidos]   = useState([]);
  const [facturas,  setFacturas]  = useState([]);
  const [vehiculos,  setVehiculos]  = useState([]);
  const [choferes,  setChoferes]  = useState([]);
  const [misTareas, setMisTareas] = useState([]);
  const [actividadReciente, setActividadReciente] = useState([]);
  const [empresaCfg, setEmpresaCfg] = useState({ cfg_alertas: [] });
  const [tallerEstado, setTallerEstado] = useState({ stock: [], reparaciones: [] });
  const [paletMovimientos, setPaletMovimientos] = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
      const _tout = (p, ms=8000) => Promise.race([p, new Promise(r=>setTimeout(()=>r([]),ms))]);
        const [p, f, v, c, ex, act, cfg, taller, palets] = await Promise.all([
          _tout(getPedidos().catch(()=>[])),
          getFacturas().catch(()=>[]),
          getVehiculos().catch(()=>[]),
          getChoferes().catch(()=>[]),
          getExcepcionesOperativas().catch(()=>null),
          user?.rol === "gerente" ? getActividad({ limit: 6 }).catch(()=>null) : Promise.resolve(null),
          getEmpresaConfig().catch(()=>null),
          getTallerEstado().catch(()=>null),
          getPaletMovimientos().catch(()=>[]),
        ]);
        setPedidos(Array.isArray(p)?p:Array.isArray(p?.data)?p.data:[]);
        setFacturas(Array.isArray(f)?f:Array.isArray(f?.data)?f.data:[]);
        setVehiculos(Array.isArray(v)?v:[]);
        setChoferes(Array.isArray(c)?c:[]);
        const exItems = Array.isArray(ex?.data) ? ex.data : [];
        const actItems = Array.isArray(act?.data) ? act.data.slice(0, 6) : [];
        setMisTareas(exItems
          .filter(x => x.workflow?.activa && String(x.workflow?.asignado_a || "") === String(user?.id || ""))
          .slice(0, 5)
        );
        setActividadReciente(actItems);
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
    pedFilt, totalFacturado, cobrado, pendiente,
    nFacturas, costeTotal, margenTotal, margenPct,
    vDisp, vTaller, cDisp,
    estadosPed, facMensual, topClientes, alertas,
    today, ultPedidos, estadoColor,
  } = useMemo(() => {
    const pedFilt = filterByPeriod(pedidos, "fecha_pedido");
    const facFilt = filterByPeriod(facturas, "fecha");
  
    // ── KPIs ──
    // Solo facturas emitidas/enviadas/cobradas - no borradores
    const facEmitidas    = facFilt.filter(f=>["emitida","enviada","cobrada","vencida"].includes(f.estado));
    const totalFacturado = facEmitidas.reduce((s,f)=>s+Number(f.total||0),0);
    const cobrado        = facEmitidas.filter(f=>f.estado==="cobrada").reduce((s,f)=>s+Number(f.total||0),0);
    const pendiente      = facEmitidas.filter(f=>["emitida","enviada"].includes(f.estado)).reduce((s,f)=>s+Number(f.total||0),0);
    const nFacturas      = facEmitidas.length;
    // Margen: from pedidos that have cost data
    const costeTotal = pedidos.reduce((s,p)=>
      s+Number(p.coste_gasoil||0)+Number(p.coste_peajes||0)+Number(p.coste_dietas||0)+Number(p.coste_otros||0),0);
    const margenTotal = totalFacturado - costeTotal;
    const margenPct   = totalFacturado>0 ? (margenTotal/totalFacturado*100).toFixed(1) : null;
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
    const estadoCounts = pedFilt.reduce((acc, p) => {
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
  
    // ── Facturación mensual ──
    const facMensual = (() => {
      const meses = {};
      facEmitidas.forEach(f => {
        if (!f.fecha) return;
        const k = f.fecha.slice(0,7); // YYYY-MM
        meses[k] = (meses[k]||0) + Number(f.total||0);
      });
      return Object.entries(meses).sort(([a],[b])=>a.localeCompare(b))
        .map(([k,v])=>({ name: new Date(k+"-01").toLocaleDateString("es-ES",{month:"short",year:"2-digit"}), total:v }));
    })();
  
    // ── Top clientes ──
    const topClientes = (() => {
      const map = {};
      facEmitidas.forEach(f => { if (f.cliente_nombre) map[f.cliente_nombre] = (map[f.cliente_nombre]||0) + Number(f.total||0); });
      return Object.entries(map).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,5).map(([name,v])=>({ name, total:v }));
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
        });
      });
    });
    choferes.forEach(c => {
      [["CAP",c.cap_vencimiento],["Carnet",c.carnet_vencimiento],["Médico",c.medico_vencimiento]].forEach(([tipo,fecha]) => {
        const s = semaforo(fecha);
        if (s) alertas.push({
          texto: `${tipo} ${c.nombre}: ${s.label}`,
          color:s.color, bg:s.dias<=0?"rgba(239,68,68,.08)":"rgba(245,158,11,.08)", icon:s.dias<=0?"":"",
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
        });
      } else if (dias <= 7) {
        alertas.push({
          texto: `Factura ${f.numero} (${f.cliente_nombre||"-"}) vence en ${dias} día${dias!==1?"s":""}`,
          color: "#f59e0b", bg: "rgba(245,158,11,.06)", icon:"",
        });
      }
    });

    buildPaletsDashboardAlerts(paletMovimientos).forEach(a => {
      alertas.push({
        texto: `${a.cliente}: ${fmtN(a.palets)} palets pendientes desde hace ${a.dias} dias`,
        color: a.critico ? "var(--red)" : "#f59e0b",
        bg: a.critico ? "rgba(239,68,68,.08)" : "rgba(245,158,11,.08)",
        icon: "",
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
        });
      }
    });
    // ── Avisos personalizados de empresa ──
    const avisosEmpresa = Array.isArray(empresaCfg?.cfg_alertas) ? empresaCfg.cfg_alertas : [];
    // (custom alerts are shown as reminders in the alert area when active)
    avisosEmpresa.filter(a => a?.activo !== false).filter(a => ["Otro", "Otro aviso personalizado"].includes(String(a?.tipo || "")) || String(a?.descripcion || "").trim()).forEach(a => {
      alertas.push({ texto: a.descripcion||a.tipo, color:"#818cf8", bg:"rgba(99,102,241,.07)", icon:"" });
    });
  
    // ── Últimas actividades ──
    const ultPedidos = [...pedidos].sort((a,b)=>new Date(b.fecha_pedido||0)-new Date(a.fecha_pedido||0)).slice(0,5);
    const estadoColor = Object.fromEntries(Object.entries(ESTADO_PEDIDO).map(([key, value]) => [key, value.color]));
  
    const today = new Date().toLocaleDateString("es-ES",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  

    return {
      pedFilt, facFilt, facEmitidas, totalFacturado, cobrado, pendiente,
      nFacturas, costeTotal, margenTotal, margenPct,
      vDisp, vRuta, vTaller, cDisp,
      estadosPed, facMensual, topClientes, alertas,
      today, ultPedidos, estadoColor,
    };
  }, [pedidos, facturas, vehiculos, choferes, filterByPeriod, empresaCfg, tallerEstado, paletMovimientos]);

  const puedeVerControlTower = false;
  const copiloto = null;
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
  const abrirCopilotoAction = () => {};
  const renderTowerItem = () => null;

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={S.title}>Dashboard Ejecutivo</div>
          <div style={{ fontSize:12, color:"var(--text4)", marginTop:2, textTransform:"capitalize" }}>{today}</div>
        </div>
        {/* Period selector */}
        <div style={{ display:"flex", gap:5, background:"var(--bg3)", padding:4, borderRadius:9, border:"1px solid var(--border)" }}>
          {Object.entries(PERIOD_LABELS).map(([k,l])=>(
            <button key={k} onClick={()=>setPeriod(k)}
              style={{ padding:"5px 12px", borderRadius:6, border:"none", fontFamily:"'DM Sans',sans-serif",
                       fontSize:12, fontWeight:600, cursor:"pointer",
                       background: period===k ? "var(--accent)" : "transparent",
                       color:      period===k ? "#fff" : "var(--text4)" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color:"var(--text4)", padding:40, textAlign:"center" }}>Cargando datos...</div>
      ) : (
        <>
          {/* ── KPI Row ── */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
            {[
              { label:"TOTAL VIAJES",      val:pedFilt.length,         sub:`${pedFilt.filter(p=>p.estado==="en_curso").length} en curso`,   color:"var(--accent-xl)" },
              { label:"VEHÍCULOS DISP.",
                val:`${vDisp}/${vehiculos.filter(v=>{const cl=(v.clase||v.tipo||"").toLowerCase();const mat=(v.matricula||"").toUpperCase();const rids=new Set(vehiculos.map(x=>x.remolque_id).filter(Boolean));return !cl.includes("remolque")&&!cl.includes("semirremolque")&&!cl.includes("dolly")&&!rids.has(v.id)&&!mat.startsWith("R-")&&!mat.endsWith("-R");}).length}`,
                sub:`${vTaller} en mantenimiento`,                            color:"var(--green)" },
              { label:"CHÓFERES DISP.",    val:`${cDisp}/${choferes.length}`,  sub:`${choferes.filter(c=>c.estado==="vacaciones").length} de vacaciones`, color:"var(--text)" },
              { label:"FACTURACIÓN TOTAL", val:`${fmt2(totalFacturado)} EUR`,     sub:`${fmtN(nFacturas)} facturas emitidas`,                  color:"#f59e0b" },
            ].map((k,i)=>(
              <div key={i} style={S.kpi}>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:800, color:k.color, marginBottom:4 }}>{k.val}</div>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", color:"var(--text5)" }}>{k.label}</div>
                <div style={{ fontSize:11, color:"var(--text4)", marginTop:4 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Row 2: estado viajes + alertas ── */}
          {puedeVerControlTower && copiloto?.resumen && (
          <div style={{...S.card,marginBottom:12,borderColor:copiloto.resumen.salud==="critica"?"rgba(239,68,68,.38)":copiloto.resumen.salud==="alerta"?"rgba(249,115,22,.34)":"var(--border)"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
              <div style={{flex:"1 1 360px"}}>
                <div style={{...S.sec,marginBottom:4}}>Copiloto operativo</div>
                <div style={{fontSize:15,fontWeight:900,color:"var(--text)",lineHeight:1.3}}>{copiloto.resumen.headline || "Operacion revisada con datos reales."}</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:4}}>
                  {Number(copiloto.resumen.activos || 0)} activos - {Number(copiloto.resumen.cargas_hoy || 0)} cargas hoy - {Number(copiloto.resumen.descargas_hoy || 0)} descargas hoy
                  {copiloto.resumen.margen_pct != null ? ` - margen ${fmt2(copiloto.resumen.margen_pct)}%` : ""}
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                {[
                  ["Prioridades", copiloto.resumen.total_prioridades, "var(--accent-xl)"],
                  ["Criticas", copiloto.resumen.criticas, "#ef4444"],
                  ["Altas", copiloto.resumen.altas, "#f97316"],
                ].map(([label,value,color])=>(
                  <div key={label} style={{minWidth:90,border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:900,color}}>{Number(value || 0)}</div>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
            {Array.isArray(copiloto.prioridades) && copiloto.prioridades.length > 0 ? (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:8}}>
                {copiloto.prioridades.slice(0,4).map(p=>{
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
                            <button key={action.key || action.label} onClick={()=>abrirCopilotoAction(p, action)}
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
              <div style={{fontSize:12,color:"var(--green)",fontWeight:800}}>Sin prioridades criticas detectadas por el copiloto.</div>
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

          <div style={{...S.card,marginBottom:12,borderColor:misTareas.length>0?"rgba(249,115,22,.35)":"var(--border)"}}>
            <div style={{...S.sec,justifyContent:"space-between"}}>
              <span>Mis tareas de hoy</span>
              <button onClick={()=>navegar("excepciones")}
                style={{border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text2)",borderRadius:7,padding:"4px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                Abrir bandeja
              </button>
            </div>
            {misTareas.length===0 ? (
              <div style={{fontSize:12,color:"var(--green)",fontWeight:700}}>No tienes excepciones activas asignadas.</div>
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

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            {/* Estado de viajes */}
            <div style={S.card}>
              <div style={S.sec}>Estado de viajes</div>
              {estadosPed.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin viajes en el período seleccionado</div>
                : estadosPed.map((e,i) => {
                  const max = Math.max(...estadosPed.map(x=>x.count));
                  return (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                      <div style={{ width:90, fontSize:12, color:"var(--text2)", flexShrink:0 }}>{e.name}</div>
                      <div style={{ flex:1, background:"var(--bg4)", borderRadius:4, height:8, overflow:"hidden" }}>
                        <div style={{ width:`${(e.count/max)*100}%`, height:"100%", background:e.color, borderRadius:4, transition:"width .4s" }}/>
                      </div>
                      <div style={{ width:24, textAlign:"right", fontWeight:700, fontSize:12, color:"var(--text)", flexShrink:0 }}>{e.count}</div>
                    </div>
                  );
                })
              }
            </div>

            {/* Alertas activas */}
            <div style={S.card}>
              <div style={{ ...S.sec, justifyContent:"space-between" }}>
                <span> Alertas activas</span>
                {alertas.length > 0 && (
                  <span style={{ background:"var(--red)", color:"#fff", borderRadius:"50%", width:20, height:20,
                                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800 }}>
                    {alertas.length}
                  </span>
                )}
              </div>
              <div style={{ maxHeight:200, overflowY:"auto" }}>
                {alertas.length === 0
                  ? <div style={{ color:"var(--green)", fontSize:12, display:"flex", gap:6, alignItems:"center" }}>Sin alertas activas</div>
                  : alertas.map((a,i) => <AlertRow key={i} {...a}/>)
                }
              </div>
            </div>
          </div>

          {user?.rol === "gerente" && (
            <div style={{ ...S.card, marginBottom:12 }}>
              <div style={S.sec}>Actividad reciente del sistema</div>
              {actividadReciente.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12 }}>Sin actividad reciente</div>
                : actividadReciente.map((a,i) => {
                    const status = Number(a?.detalle?.status || 0);
                    const color = actividadColor(a?.accion, status);
                    const method = String(a?.accion || "").split(" ")[0] || "ACCION";
                    const path = String(a?.accion || "").replace(method, "").trim();
                    return (
                      <div key={a.id || i} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid var(--border)" }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:color, flexShrink:0 }}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12, fontWeight:700, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                            {actividadModulo(a?.accion)} - {path || method}
                          </div>
                          <div style={{ fontSize:10, color:"var(--text4)" }}>
                            {a?.actor_email || "usuario"} - {a?.created_at ? new Date(a.created_at).toLocaleString("es-ES") : ""}
                          </div>
                        </div>
                        <span style={{ ...S.badge, background:`${color}1a`, color, flexShrink:0 }}>
                          {status || method}
                        </span>
                      </div>
                    );
                  })
              }
            </div>
          )}

          {/* ── Row 3: Evolución mensual + Top clientes ── */}
          <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:12, marginBottom:12 }}>
            {/* Evolución mensual */}
            <div style={S.card}>
              <div style={S.sec}>EVOLUCIÓN MENSUAL</div>
              {facMensual.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12, padding:"24px 0", textAlign:"center" }}>Sin datos para este período</div>
                : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={facMensual} margin={{top:0,right:0,bottom:0,left:0}}>
                      <XAxis dataKey="name" tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false} width={50}
                        tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                      <Tooltip contentStyle={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}}
                        formatter={v=>[`${fmt2(v)} EUR`,"Facturado"]}/>
                      <Bar dataKey="total" fill="var(--accent-l)" radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </div>

            {/* Por cliente */}
            <div style={S.card}>
              <div style={S.sec}>POR CLIENTE</div>
              {topClientes.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12, padding:"24px 0", textAlign:"center" }}>Sin datos</div>
                : topClientes.map((c,i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:COLORS[i%COLORS.length] }}/>
                      <span style={{ fontSize:12, color:"var(--text2)" }}>{c.name.length>22?c.name.slice(0,22)+"…":c.name}</span>
                    </div>
                    <span style={{ fontSize:12, fontWeight:700, color:"var(--text)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.total)} EUR</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* ── Row 4: KPIs financieros + últimas actividades ── */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {/* Resumen financiero */}
            <div style={S.card}>
              <div style={S.sec}>RESUMEN FINANCIERO</div>
              {[
                { l:"Facturado",         v:`${fmt2(totalFacturado)} EUR`,  c:"var(--text)" },
                { l:"Cobrado",           v:`${fmt2(cobrado)} EUR`,         c:"var(--green)" },
                { l:"Pendiente cobro",   v:`${fmt2(pendiente)} EUR`,       c:"#f59e0b" },
                { l:"% cobrado",         v:`${totalFacturado>0?((cobrado/totalFacturado)*100).toFixed(1):0}%`, c:"var(--accent-xl)" },
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
              <div style={S.sec}>ÚLTIMAS ACTIVIDADES</div>
              {ultPedidos.length === 0
                ? <div style={{ color:"var(--text5)", fontSize:12 }}>Sin actividad reciente</div>
                : ultPedidos.map((p,i)=>(
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", borderBottom:"1px solid var(--border)" }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:estadoColor[p.estado]||"var(--text4)", flexShrink:0 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        {p.origen&&p.destino ? `${p.origen} -> ${p.destino}` : p.numero}
                      </div>
                      <div style={{ fontSize:10, color:"var(--text4)" }}>
                        {p.cliente_nombre||"-"} - {p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):""}
                      </div>
                    </div>
                    <span style={{ ...S.badge, background:`${estadoColor[p.estado]||"var(--text4)"}1a`, color:estadoColor[p.estado]||"var(--text4)", flexShrink:0 }}>
                      {estadoPedidoMeta(p.estado).label}
                    </span>
                  </div>
                ))
              }
            </div>
          </div>
        </>
      )}
    </div>
  );
}
