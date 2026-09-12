import { useState, useEffect, useMemo, useCallback } from "react";
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
  // Una factura en BORRADOR no cuenta como facturada: su importe no entra en
  // "facturado" (ahi solo van emitidas/enviadas/cobradas/vencidas), asi que el
  // viaje tiene que seguir contando como PENDIENTE de facturar. Si no, el viaje
  // se caia de los dos lados y el ingreso gestionado salia corto.
  if (["borrador", "cancelada", "anulada"].includes(String(p?.factura_estado || "").toLowerCase())) return false;
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
  // Los viajes realizados (entregado/facturado) se atribuyen por su fecha REAL de
  // entrega (cuando se marcaron entregados / firma), no por la descarga
  // planificada: esta puede caer en otro mes (p. ej. programada a futuro) y dejar
  // el viaje fuera del periodo, aunque se haya entregado hoy.
  const estado = String(p?.estado || "").toLowerCase();
  if (estado === "entregado" || estado === "facturado") {
    // facturacion_mes: mes elegido al entregar fuera de su mes (manda sobre todo).
    return p?.facturacion_mes || p?.entregado_at || p?.firma_fecha || p?.fecha_descarga || p?.fecha_carga || p?.fecha_pedido || p?.created_at;
  }
  return p?.fecha_descarga || p?.fecha_carga || p?.fecha_pedido || p?.created_at;
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
    totalFacturado, cobrado, pendiente,
    nFacturas, ingresoGestionado, pendienteFacturarRealizado, pedidosRealizados, eurKmRealizado,
    margenTotal, margenPct,
    facMensual, topClientes, alertas, today,
  } = useMemo(() => {
    const pedidosKpiPeriodo = pedidos.map(p => ({ ...p, _fecha_kpi: fechaKpiPedido(p) }));
    const pedFilt = filterByPeriod(pedidosKpiPeriodo, "_fecha_kpi");
    const pedKpi = pedFilt.filter(p => ["confirmado","en_curso","descarga","entregado","facturado"].includes(estadoPedidoKey(p)));
    const pedidosRealizados = pedFilt.filter(pedidoRealizado);
    const pedidosRealizadosSinFactura = pedidosRealizados.filter(p => !pedidoTieneFactura(p));
    const facFilt = filterByPeriod(facturas, "fecha");
  
    // ── KPIs ──
    // Solo facturas emitidas/enviadas/cobradas - no borradores
    const facEmitidas    = facFilt.filter(f=>!["borrador","cancelada","anulada"].includes(f.estado));
    const totalFacturado = facEmitidas.reduce((s,f)=>s+Number(f.base_imponible||0),0);
    const cobrado        = facEmitidas.filter(f=>f.estado==="cobrada").reduce((s,f)=>s+Number(f.total||0),0);
    const pendiente      = facEmitidas.filter(f=>["emitida","enviada"].includes(f.estado)).reduce((s,f)=>s+Number(f.total||0),0);
    const nFacturas      = facEmitidas.length;
    const pendienteFacturarRealizado = pedidosRealizadosSinFactura.reduce((s,p)=>s+importePedido(p),0);
    const ingresoGestionado = totalFacturado + pendienteFacturarRealizado;
    const costeTotal = pedidosRealizados.reduce((s,p)=>s+costeOperativoPedido(p),0);
    const ventaRealizada = pedidosRealizados.reduce((sum,p)=>sum+importePedido(p),0);
    const margenTotal = ventaRealizada - costeTotal;
    const margenPct   = ventaRealizada>0 ? (margenTotal/ventaRealizada*100).toFixed(1) : null;
    const kmRealizados = pedidosRealizados.reduce((s,p)=>s+Number(p.km_ruta||0)+Number(p.km_vacio||0),0);
    const eurKmRealizado = kmRealizados>0 ? ventaRealizada/kmRealizados : 0;
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
        meses[k].facturado += Number(f.base_imponible||0);
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
        const total = Number(f.base_imponible||0);
        row.total += total;
        row.facturado += total;
        row.nfact += 1;
        if (f.estado === "cobrada") row.cobrado += Number(f.total||0);
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

  const biKpis = biResumen?.kpis || {};
  const biNumber = (key, fallback = 0) => {
    if (biKpis[key] == null) return fallback;
    const n = Number(biKpis?.[key]);
    return Number.isFinite(n) ? n : fallback;
  };
  const kpiIngresoGestionado = biNumber("ingreso_gestionado", ingresoGestionado);
  const kpiFacturado = biNumber("facturado", totalFacturado);
  const kpiCobrado = biNumber("cobrado", cobrado);
  const kpiPendienteCobro = biNumber("pendiente_cobro", pendiente);
  const kpiPendienteFacturar = biNumber("pendiente_facturar_realizado", pendienteFacturarRealizado);
  const kpiPendientesFacturarCount = biNumber("pendientes_facturar_count", pedidosRealizados.filter(p => !pedidoTieneFactura(p)).length);
  const kpiRealizados = biNumber("realizados", pedidosRealizados.length);
  const kpiMargen = biNumber("margen", margenTotal);
  const kpiMargenPct = biNumber("margen_pct", Number(margenPct || 0));
  const kpiEurKm = biNumber("eur_km", eurKmRealizado);
  const kpiKmRealizados = biNumber("km_realizados", 0);
  const kpiTicket = biNumber("ticket_medio_realizado", 0);
  const kpiIncidencias = biNumber("incidencias", 0);
  const kpiSinPrecio = biNumber("sin_precio", 0);
  const kpiSinKm = biNumber("sin_km", 0);
  const kpiPodPendiente = biNumber("pod_pendiente_realizados", 0);
  const kpiFacturas = biNumber("facturas", nFacturas);
  const facturadoConImpuestos = biNumber("facturado_total", filterByPeriod(facturas,"fecha").filter(f=>!["borrador","cancelada","anulada"].includes(f.estado)).reduce((sum,f)=>sum+Number(f.total||0),0));
  const kpiCobroPct = facturadoConImpuestos > 0 ? (kpiCobrado / facturadoConImpuestos) * 100 : 0;
  const clientesRanking = Array.isArray(biResumen?.clientes) && biResumen.clientes.length
    ? biResumen.clientes.slice(0, 5).map(c => ({
        name: c.nombre || c.cliente_nombre || c.razon_social || c.cliente || "Cliente",
        total: Number(c.ingreso_gestionado || c.venta || c.facturado || 0),
        facturado: Number(c.facturado || 0),
        pendiente: Number(c.pendiente_facturar_realizado || 0),
        viajes_realizados: Number(c.realizados || c.viajes || 0),
        margen: Number(c.margen || 0),
        margen_pct: Number(c.margen_pct || 0),
      }))
    : topClientes;

  const metrics={ingreso:kpiIngresoGestionado,facturado:kpiFacturado,cobrado:kpiCobrado,pendiente:kpiPendienteCobro,sinFactura:kpiPendienteFacturar,pendientesCount:kpiPendientesFacturarCount,realizados:kpiRealizados,margen:kpiMargen,margenPct:kpiMargenPct,eurKm:kpiEurKm,km:kpiKmRealizados,ticket:kpiTicket,incidencias:kpiIncidencias,sinPrecio:kpiSinPrecio,sinKm:kpiSinKm,pod:kpiPodPendiente,facturas:kpiFacturas,cobroPct:kpiCobroPct};
  const canBI=puedeVer("informes")||puedeVer("facturacion");
  return <><DashboardWorkspace pedidos={pedidos} facturas={facturas} vehiculos={vehiculos} choferes={choferes} alertas={alertas} tareas={misTareas} loadErrors={loadErrors} reload={() => setReloadKey(k => k+1)} loading={loading} today={today} navigate={navegar} openOrder={enfocarPedidos} openAlert={abrirAlerta} advanced={() => setBiOpen(true)} showBI={canBI} onSnapshot={setPedidos} stateMeta={estadoPedidoMeta}/>
    {biOpen&&canBI&&<DashboardBI onClose={()=>setBiOpen(false)} period={period} setPeriod={setPeriod} metrics={metrics} clients={clientesRanking} series={facMensual} loading={biLoading} error={biError}/>}
  </>;
}
