import { useState, useEffect } from "react";
import { getFacturas, getPedidos, getVehiculos, getChoferes, getTallerEstado, getInformeGestion, getBiResumen, getRentabilidadOperativa, getCargasRetorno, prepararSolicitudRetornoCarrier, enviarSolicitudRetornoCarrier, actualizarSolicitudRetornoCarrier, getScoringOperativo, getEmisionesOperativas, getDatosMaestrosReadiness, getCumplimientoEuropeo, getObjetivos, setObjetivo, getEmpresaConfig, setConfigPrecios } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { setRuntimeFocus } from "../services/runtimeFocus";
import { getEmpresaPlanLocal, planHasFeature } from "../utils/planFeatures";
import { notify } from "../services/notify";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from "recharts";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = n => Number(n||0).toLocaleString("es-ES");
const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#f97316","#06b6d4","#84cc16","#ec4899","#14b8a6"];

const S = {
  page:  { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:"var(--text)", marginBottom:20 },
  card:  { background:"var(--card-bg)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 18px", marginBottom:12 },
  sec:   { fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", color:"var(--text5)", marginBottom:10 },
  tab:   { padding:"7px 16px", border:"none", borderBottom:"2px solid transparent", background:"none",
           fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:600, cursor:"pointer" },
  btn:   { padding:"7px 14px", borderRadius:7, border:"none", fontSize:12, fontWeight:600, cursor:"pointer",
           fontFamily:"'DM Sans',sans-serif" },
  inp:   { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"7px 11px",
           borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" },
  lbl:   { display:"block", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text5)", marginBottom:4, marginTop:10 },
};

const PERIOD_OPTS = [
  { k:"7d",   l:"7 días",    days:7   },
  { k:"30d",  l:"Este mes",  days:30  },
  { k:"90d",  l:"3 meses",   days:90  },
  { k:"180d", l:"6 meses",   days:180 },
  { k:"365d", l:"Este año",  days:365 },
  { k:"all",  l:"Todo",      days:0   },
];

const TABS = [
  { id:"resumen",      l:"Resumen" },
  { id:"facturacion",  l:"Facturación" },
  { id:"clientes",     l:"Clientes" },
  { id:"datos_maestros", l:"Datos maestros" },
  { id:"cumplimiento", l:"Cumplimiento" },
  { id:"scoring",      l:"Scoring" },
  { id:"sostenibilidad", l:"CO2" },
  { id:"rentabilidad", l:"Rentabilidad" },
  { id:"retornos",     l:"Retornos" },
  { id:"rutas",        l:"Rutas" },
  { id:"flota",        l:"Flota" },
  { id:"choferes",     l:"Chóferes" },
  { id:"costes",       l:"Costes taller" },
  { id:"kpi_avanzado", l:"KPI avanzado" },
  { id:"objetivos",    l:"Objetivos" },
];

function filterItems(items, dateKey, period) {
  if (period === "all") return items;
  const opt = PERIOD_OPTS.find(o=>o.k===period);
  if (!opt || opt.days===0) return items;
  const cut = new Date(); cut.setDate(cut.getDate()-opt.days);
  return items.filter(x => x[dateKey] && new Date(x[dateKey]) >= cut);
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function normalizeObjetivosApi(data) {
  if (!data || typeof data !== "object") return {};
  return {
    facturacion_mes: Number(data.facturacion_mes?.facturacion || 0),
    facturacion_anual: Number(data.facturacion_anual?.facturacion || 0),
    cobros_mes: Number(data.cobros_mes?.facturacion || 0),
    viajes_mes: Number(data.viajes_mes?.pedidos || 0),
    facturacion_por_camion: Number(data.facturacion_por_camion?.facturacion || 0),
  };
}

function scoreColor(salud) {
  return salud === "rojo" ? "var(--red)" : salud === "amarillo" ? "#f59e0b" : "var(--green)";
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildCo2ReportHtml(data = {}) {
  const resumen = data.resumen || {};
  const metodologia = data.metodologia || {};
  const rows = (items, cols) => (Array.isArray(items) && items.length ? items.slice(0, 20).map(item => `
    <tr>${cols.map(col => `<td>${htmlEscape(typeof col.v === "function" ? col.v(item) : item[col.k])}</td>`).join("")}</tr>
  `).join("") : `<tr><td colspan="${cols.length}">Sin datos</td></tr>`);
  const metric = (label, value) => `<div class="box"><div class="metric">${htmlEscape(value)}</div><div class="muted">${htmlEscape(label)}</div></div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Informe CO2 TransGest</title>
    <style>
      body{font-family:Arial,sans-serif;margin:32px;color:#111827;background:#f8fafc}
      main{max-width:1120px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:28px}
      h1{margin:0;font-size:24px} h2{font-size:16px;margin-top:28px;border-bottom:1px solid #e5e7eb;padding-bottom:8px}
      .sub,.muted{color:#64748b;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}
      .box{border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#f8fafc}.metric{font-size:20px;font-weight:800;color:#047857}
      table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;border-bottom:1px solid #e5e7eb;padding:8px;font-size:12px}
      th{text-transform:uppercase;color:#64748b;font-size:10px}.warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px;color:#9a3412;font-size:12px}
    </style></head><body><main>
      <h1>Informe de emisiones CO2</h1>
      <div class="sub">Generado el ${htmlEscape(new Date().toLocaleString("es-ES"))} - periodo ${htmlEscape(data.desde || "-")} a ${htmlEscape(data.hasta || "-")}</div>
      <div class="grid">
        ${metric("CO2 estimado", `${fmt2(resumen.co2_t)} t`)}
        ${metric("KM analizados", `${fmtN(resumen.km_total)} km`)}
        ${metric("Litros estimados", `${fmt2(resumen.litros_estimados)} L`)}
        ${metric("CO2/km", resumen.co2_kg_km == null ? "-" : `${fmt2(resumen.co2_kg_km)} kg/km`)}
        ${metric("KM vacio", resumen.pct_km_vacio == null ? "-" : `${fmt2(resumen.pct_km_vacio)}%`)}
        ${metric("Viajes sin km", resumen.datos_incompletos || 0)}
      </div>
      <h2>Metodologia</h2>
      <p class="muted">Estado: ${htmlEscape(metodologia.estado || "estimacion")}. Consumo medio ${htmlEscape(metodologia.consumo_l_100km || "-")} L/100 km. Factor ${htmlEscape(metodologia.factor_kg_co2_litro || "-")} kg CO2/litro.</p>
      <p class="muted">${htmlEscape(metodologia.nota || "")}</p>
      ${Number(resumen.datos_incompletos || 0) > 0 ? `<div class="warn">Hay ${htmlEscape(resumen.datos_incompletos)} viaje(s) sin kilometros. Se separan para no falsear el reporting.</div>` : ""}
      <h2>CO2 por cliente</h2>
      <table><thead><tr><th>Cliente</th><th>Viajes</th><th>KM</th><th>CO2</th><th>CO2/km</th></tr></thead><tbody>
        ${rows(data.por_cliente, [
          {k:"nombre"}, {k:"pedidos"}, {v:x=>`${fmtN(x.km_total)} km`}, {v:x=>`${fmt2(x.co2_t)} t`}, {v:x=>x.co2_kg_km==null?"-":`${fmt2(x.co2_kg_km)} kg/km`}
        ])}
      </tbody></table>
      <h2>CO2 por vehiculo</h2>
      <table><thead><tr><th>Vehiculo</th><th>Viajes</th><th>KM</th><th>Litros</th><th>CO2</th></tr></thead><tbody>
        ${rows(data.por_vehiculo, [
          {k:"nombre"}, {k:"pedidos"}, {v:x=>`${fmtN(x.km_total)} km`}, {v:x=>`${fmt2(x.litros_estimados)} L`}, {v:x=>`${fmt2(x.co2_t)} t`}
        ])}
      </tbody></table>
      <h2>Rutas con mayor huella</h2>
      <table><thead><tr><th>Ruta</th><th>Viajes</th><th>KM</th><th>CO2</th><th>KM vacio</th></tr></thead><tbody>
        ${rows(data.por_ruta, [
          {k:"nombre"}, {k:"pedidos"}, {v:x=>`${fmtN(x.km_total)} km`}, {v:x=>`${fmt2(x.co2_t)} t`}, {v:x=>x.pct_km_vacio==null?"-":`${fmt2(x.pct_km_vacio)}%`}
        ])}
      </tbody></table>
    </main></body></html>`;
}

function navegar(view) {
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: view }));
}

// Objetivo progress bar
function ObjetivoBar({ label, actual, objetivo, color="#3b82f6" }) {
  const pct = objetivo > 0 ? Math.min((actual/objetivo)*100, 100) : 0;
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:12, color:"var(--text2)", fontWeight:600 }}>{label}</span>
        <span style={{ fontSize:11, color:"var(--text4)", fontFamily:"'JetBrains Mono',monospace" }}>
          {fmt2(actual)} € / <span style={{ color:"var(--text2)" }}>{fmt2(objetivo)} €</span>
        </span>
      </div>
      <div style={{ background:"var(--bg4)", borderRadius:6, height:10, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:pct>=100?"var(--green)":color, borderRadius:6, transition:"width .5s" }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
        <span style={{ fontSize:10, color: pct>=100?"var(--green)":pct>=75?"#f59e0b":"var(--text5)" }}>
          {pct.toFixed(1)}% completado
        </span>
        {pct >= 100 && <span style={{ fontSize:10, color:"var(--green)", fontWeight:700 }}>Objetivo cumplido</span>}
      </div>
    </div>
  );
}

// Main
export default function Informes() {
  const { user } = useAuth();
  const isGerente = user?.rol === "gerente";
  const empresaPlan = getEmpresaPlanLocal();
  const kpisAvanzadosDisponibles = planHasFeature(empresaPlan, "kpis_avanzados");

  const [tab,      setTab]      = useState("resumen");
  const [period,   setPeriod]   = useState("30d");
  const [pedidos,  setPedidos]  = useState([]);
  const [facturas, setFacturas] = useState([]);
  const [vehiculos,setVehiculos]= useState([]);
  const [choferes, setChoferes] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [objetivos,setObjetivos]= useState({});
  const [editObj,  setEditObj]  = useState(false);
  const [objForm,  setObjForm]  = useState({});
  const [taller, setTaller] = useState({ stock:[], reparaciones:[] });
  const [kpisBackend, setKpisBackend] = useState(null);
  const [biResumen, setBiResumen] = useState(null);
  const [rentabilidadOperativa, setRentabilidadOperativa] = useState(null);
  const [cargasRetorno, setCargasRetorno] = useState(null);
  const [scoringOperativo, setScoringOperativo] = useState(null);
  const [emisionesOperativas, setEmisionesOperativas] = useState(null);
  const [datosMaestrosReadiness, setDatosMaestrosReadiness] = useState(null);
  const [cumplimientoEuropeo, setCumplimientoEuropeo] = useState(null);
  const [empresaCfg, setEmpresaCfg] = useState({});
  const [solicitudRetorno, setSolicitudRetorno] = useState(null);
  const [enviandoSolicitudRetorno, setEnviandoSolicitudRetorno] = useState(false);
  const [carrierRetornoPorOportunidad, setCarrierRetornoPorOportunidad] = useState({});
  const [actualizandoSolicitudRetorno, setActualizandoSolicitudRetorno] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const _tout = (pr, ms=8000) => Promise.race([pr, new Promise(r=>setTimeout(()=>r([]),ms))]);
          const [p,f,v,c,t,obj,cfgEmpresa,dm] = await Promise.all([
            _tout(getPedidos().catch(()=>[])), getFacturas().catch(()=>[]),
            getVehiculos().catch(()=>[]), getChoferes().catch(()=>[]),
            getTallerEstado().catch(()=>null),
            getObjetivos().catch(()=>({})),
            getEmpresaConfig().catch(()=>({})),
            getDatosMaestrosReadiness().catch(()=>null),
          ]);
        setPedidos(asArray(p));
        setFacturas(asArray(f));
        setVehiculos(asArray(v));
        setChoferes(asArray(c));
        if (t && typeof t === "object") {
          setTaller({ stock:t.stock||[], reparaciones:t.reparaciones||[] });
        }
          const nextObjetivos = normalizeObjetivosApi(obj);
          setObjetivos(nextObjetivos);
          setObjForm(nextObjetivos);
          setDatosMaestrosReadiness(dm);
          let cfgEmpresaObj = cfgEmpresa && typeof cfgEmpresa === "object" ? cfgEmpresa : {};
          setEmpresaCfg(cfgEmpresaObj);
          if (typeof window !== "undefined") window.__TMS_EMPRESA_CONFIG = cfgEmpresaObj;
          const hasCombCfg = !!(cfgEmpresaObj?.cfg_precios?.combustible || cfgEmpresaObj?.cfg_precios?.gasoil);
          if (!hasCombCfg) {
            try {
              const legacyComb = JSON.parse(localStorage.getItem("tms_combustible_cfg") || "null");
              if (legacyComb && typeof legacyComb === "object") {
                const nextPrecios = {
                  ...(cfgEmpresaObj?.cfg_precios || {}),
                  combustible: legacyComb,
                };
                await setConfigPrecios(nextPrecios);
                cfgEmpresaObj = { ...cfgEmpresaObj, cfg_precios: nextPrecios };
                setEmpresaCfg(cfgEmpresaObj);
                if (typeof window !== "undefined") window.__TMS_EMPRESA_CONFIG = cfgEmpresaObj;
                localStorage.removeItem("tms_combustible_cfg");
              }
            } catch {}
          }
        } finally { setLoading(false); }
      }
    load();
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getInformeGestion(period).catch(() => null),
      getBiResumen(period).catch(() => null),
      getRentabilidadOperativa(period).catch(() => null),
      getCargasRetorno(period).catch(() => null),
      getScoringOperativo(period).catch(() => null),
      getEmisionesOperativas(period).catch(() => null),
      getCumplimientoEuropeo(period === "7d" ? 15 : period === "30d" ? 45 : period === "90d" ? 90 : 120).catch(() => null),
    ]).then(([k, bi, rent, retornos, scoring, emisiones, cumplimiento]) => {
      if (!alive) return;
      setKpisBackend(k);
      setBiResumen(bi);
      setRentabilidadOperativa(rent);
      setCargasRetorno(retornos);
      setScoringOperativo(scoring);
      setEmisionesOperativas(emisiones);
      setCumplimientoEuropeo(cumplimiento);
    });
    return () => { alive = false; };
  }, [period]);

  // Filtered data
  const pedFilt  = filterItems(pedidos,  "fecha_pedido", period);
  const facFilt  = filterItems(facturas, "fecha",        period);
  const repFilt  = filterItems(taller.reparaciones, "fecha", period);
  const pedKpi = pedFilt.filter(p => ["confirmado","en_curso","descarga","entregado","facturado"].includes(String(p.estado || "").toLowerCase()));
  const pedCancelados = pedFilt.filter(p => String(p.estado || "").toLowerCase() === "cancelado");

  // KPIs base
  const kpisPeriodo = kpisBackend?.period === period ? kpisBackend : null;
  const totalFact   = kpisPeriodo?.facturacion?.total ?? facFilt.reduce((s,f)=>s+Number(f.total||0), 0);
  const cobrado     = kpisPeriodo?.facturacion?.cobrado ?? facFilt.filter(f=>f.estado==="cobrada").reduce((s,f)=>s+Number(f.total||0), 0);
  const pendiente   = kpisPeriodo?.facturacion?.pendiente ?? (totalFact - cobrado);
  const costeTaller = kpisPeriodo?.taller?.coste ?? repFilt.reduce((s,r)=>s+Number(r.coste_total||0), 0);
  const saludGestion = Array.isArray(kpisPeriodo?.salud) ? kpisPeriodo.salud : [];

  // Facturación mensual
  const facMensual = (() => {
    const meses = {};
    facFilt.forEach(f => {
      if (!f.fecha) return;
      const k = f.fecha.slice(0,7);
      meses[k] = { fact:(meses[k]?.fact||0)+Number(f.total||0), cobr:(meses[k]?.cobr||0)+(f.estado==="cobrada"?Number(f.total||0):0) };
    });
    return Object.entries(meses).sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>({ name:new Date(k+"-01").toLocaleDateString("es-ES",{month:"short",year:"2-digit"}), ...v }));
  })();

  // Top clientes
  const topClientes = (() => {
    const map = {};
    facFilt.forEach(f => {
      const k = f.cliente_nombre||"Desconocido";
      if (!map[k]) map[k]={total:0,nfact:0,cobrado:0};
      map[k].total += Number(f.total||0);
      map[k].nfact++;
      if (f.estado==="cobrada") map[k].cobrado += Number(f.total||0);
    });
    return Object.entries(map).sort(([,a],[,b])=>b.total-a.total).slice(0,10)
      .map(([name,v])=>({ name, ...v }));
  })();

  // Rutas más rentables
  const topRutas = (() => {
    const map = {};
    pedKpi.forEach(p => {
      if (!p.origen || !p.destino) return;
      const k = `${p.origen} - ${p.destino}`;
      if (!map[k]) map[k]={viajes:0,importe:0};
      map[k].viajes++;
      map[k].importe += Number(p.importe||p.precio||0);
    });
    return Object.entries(map).sort(([,a],[,b])=>b.importe-a.importe).slice(0,8)
      .map(([name,v])=>({ name:name.length>35?name.slice(0,35)+"...":name, ...v, rentabilidad: v.viajes>0?v.importe/v.viajes:0 }));
  })();

  // Flota rentabilidad: solo tractoras/cabezas (no remolques)
  // esTractora: clase + matrícula patrón + no es remolque_id de nadie
  const _remIds = new Set(vehiculos.map(v=>v.remolque_id).filter(Boolean));
  const esTractora = v => {
    const clase = (v.clase||v.tipo||"").toLowerCase();
    const mat = (v.matricula||"").toUpperCase();
    return !clase.includes("remolque") && !clase.includes("semirremolque") && !clase.includes("dolly") &&
           !_remIds.has(v.id) && !mat.startsWith("R-") && !mat.endsWith("-R");
  };
  const flotaStats = vehiculos.filter(esTractora).map(v => {
    const pedVeh  = pedKpi.filter(p=>p.vehiculo_id===v.id||p.matricula===v.matricula);
    const facVeh  = facFilt.filter(f=>f.vehiculo_id===v.id||pedVeh.find(p=>p.id===f.pedido_id));
    const repVeh  = repFilt.filter(r=>r.vehiculo_id===v.id);
    const ingresos= facVeh.reduce((s,f)=>s+Number(f.total||0),0);
    const costes  = repVeh.reduce((s,r)=>s+Number(r.coste_total||0),0);
    const viajes  = pedVeh.length;
    const kmTot   = pedVeh.reduce((s,p)=>s+Number(p.km_ruta||p.km||0),0);
    const kmVac   = pedVeh.reduce((s,p)=>s+Number(p.km_vacio||0),0);
    return { id:v.id, matricula:v.matricula, marca:v.marca||"", modelo:v.modelo||"", clase:v.clase||"",
             ingresos, costes, margen:ingresos-costes, viajes, km:v.km_actuales||0, kmTot, kmVac };
  }).sort((a,b)=>b.margen-a.margen);

  // Chóferes stats: incluye pedidos como chofer1 Y chofer2
  const choferesStats = choferes.map(c => {
    const pedCh = pedKpi.filter(p=>p.chofer_id===c.id || p.chofer2_id===c.id);
    // Para pedidos compartidos, prorratear el ingreso según reparto
    const ingresos = pedCh.reduce((s,p)=>{
      const pct = p.chofer2_id && p.chofer_id !== c.id
        ? (100 - Number(p.reparto_chofer1||50)) / 100
        : p.chofer2_id ? Number(p.reparto_chofer1||50) / 100 : 1;
      return s + Number(p.importe||0) * pct;
    }, 0);
    const entregas = pedCh.filter(p=>p.estado==="entregado"||p.estado==="facturado").length;
    const kmTotal  = pedCh.reduce((s,p)=>s+Number(p.km_ruta||p.km||0),0);
    const kmVacio  = pedCh.reduce((s,p)=>s+Number(p.km_vacio||0),0);
    const eurosKm  = kmTotal>0?ingresos/kmTotal:0;
    const pctVacio = (kmTotal+kmVacio)>0?(kmVacio/(kmTotal+kmVacio))*100:0;
    return { nombre:`${c.nombre||""} ${c.apellidos||""}`.trim()||"N/A", viajes:pedCh.length, entregas, ingresos, kmTotal, kmVacio, eurosKm, pctVacio };
  }).sort((a,b)=>b.ingresos-a.ingresos);

  // Advanced KPIs
  // Taller visits per vehicle - incluye TODOS los vehículos (tractoras Y remolques)
  const tallerVisitas = vehiculos.map(v => {
    const repsVeh = taller.reparaciones.filter(r=>r.vehiculo_id===v.id);
    const coste   = repsVeh.reduce((s,r)=>s+Number(r.coste_total||0),0);
    const tipos   = {};
    repsVeh.forEach(r=>{ tipos[r.tipo]=(tipos[r.tipo]||0)+1; });
    const topTipo = Object.entries(tipos).sort(([,a],[,b])=>b-a)[0];
    return { matricula:v.matricula, marca:v.marca||"", modelo:v.modelo||"", visitas:repsVeh.length, coste, topTipo:topTipo?.[0]||"-" };
  }).sort((a,b)=>b.visitas-a.visitas);

  // Taller visits by brand
  const tallerPorMarca = (() => {
    const m = {};
    vehiculos.forEach(v=>{
      const marca = v.marca||"Desconocida";
      const repsVeh = taller.reparaciones.filter(r=>r.vehiculo_id===v.id);
      if(!m[marca]) m[marca]={marca,visitas:0,coste:0,vehiculos:0};
      m[marca].vehiculos++;
      m[marca].visitas += repsVeh.length;
      m[marca].coste   += repsVeh.reduce((s,r)=>s+Number(r.coste_total||0),0);
    });
    return Object.values(m).sort((a,b)=>b.visitas-a.visitas);
  })();

  // €/km by vehicle
  const eurosKmFlota = flotaStats.map(v => {
    const eKm    = v.kmTot>0?v.ingresos/v.kmTot:0;
    const pVac   = (v.kmTot+v.kmVac)>0?(v.kmVac/(v.kmTot+v.kmVac))*100:0;
    return { ...v, eKm, pVac };
  }).sort((a,b)=>b.eKm-a.eKm);

  // Costes por categoría
  const costesCat = (() => {
    const map = {};
    repFilt.forEach(r => {
      const k = r.tipo||"Otros";
      map[k] = (map[k]||0) + Number(r.coste_total||0);
    });
    taller.stock.forEach(s => {
      if ((s.stock_actual||0) < (s.stock_minimo||0)) return;
      // no añadir valor de stock como gasto
    });
    return Object.entries(map).sort(([,a],[,b])=>b-a).map(([name,v])=>({ name:name.length>20?name.slice(0,20)+"...":name, value:v }));
  })();

  const costeMensualTaller = (() => {
    const meses = {};
    taller.reparaciones.forEach(r => {
      if (!r.fecha) return;
      const k = r.fecha.slice(0,7);
      meses[k] = (meses[k]||0) + Number(r.coste_total||0);
    });
    return Object.entries(meses).sort(([a],[b])=>a.localeCompare(b)).slice(-12)
      .map(([k,v])=>({ name:new Date(k+"-01").toLocaleDateString("es-ES",{month:"short",year:"2-digit"}), coste:v }));
  })();

  const visionGerencia = {
    viajesOperativos: pedKpi.length,
    viajesCancelados: pedCancelados.length,
    cancelacionPct: pedFilt.length ? (pedCancelados.length / pedFilt.length) * 100 : 0,
    ticketMedio: pedKpi.length ? totalFact / pedKpi.length : 0,
    cobroPct: totalFact > 0 ? (cobrado / totalFact) * 100 : 0,
    pendientePct: totalFact > 0 ? (pendiente / totalFact) * 100 : 0,
    facturacionPorCamion: flotaStats.length ? totalFact / Math.max(1, flotaStats.length) : 0,
    costeTallerPorCamion: flotaStats.length ? costeTaller / Math.max(1, flotaStats.length) : 0,
  };
  const panelesGerencia = [
    { l:"Viajes KPI", v:fmtN(visionGerencia.viajesOperativos), c:"var(--accent-xl)", d:`${fmtN(visionGerencia.viajesCancelados)} cancelados excluidos` },
    { l:"Ticket medio", v:`${fmt2(visionGerencia.ticketMedio)} EUR`, c:"var(--text)", d:"Facturacion / viajes KPI" },
    { l:"Cobro efectivo", v:`${fmt2(visionGerencia.cobroPct)}%`, c:visionGerencia.cobroPct >= 80 ? "var(--green)" : "#f59e0b", d:`Pendiente ${fmt2(visionGerencia.pendientePct)}%` },
    { l:"Fact. por camion", v:`${fmt2(visionGerencia.facturacionPorCamion)} EUR`, c:"var(--green)", d:`Taller/camion ${fmt2(visionGerencia.costeTallerPorCamion)} EUR` },
  ];

  // Objetivos keys
  const OBJ_KEYS = [
    { k:"facturacion_mes",   l:"Facturación mensual",   tipo:"money" },
    { k:"facturacion_anual", l:"Facturación anual",     tipo:"money" },
    { k:"cobros_mes",        l:"Cobros mensual",        tipo:"money" },
    { k:"viajes_mes",        l:"Viajes / mes",          tipo:"number" },
  ];

  async function saveObjetivos() {
    try {
      await setObjetivo("facturacion_mes", { facturacion: Number(objForm.facturacion_mes || 0) });
      await setObjetivo("facturacion_anual", { facturacion: Number(objForm.facturacion_anual || 0) });
      await setObjetivo("cobros_mes", { facturacion: Number(objForm.cobros_mes || 0) });
      await setObjetivo("viajes_mes", { pedidos: Number(objForm.viajes_mes || 0) });
      await setObjetivo("facturacion_por_camion", { facturacion: Number(objForm.facturacion_por_camion || 0) });
      const next = {
        ...objForm,
        facturacion_mes: Number(objForm.facturacion_mes || 0),
        facturacion_anual: Number(objForm.facturacion_anual || 0),
        cobros_mes: Number(objForm.cobros_mes || 0),
        viajes_mes: Number(objForm.viajes_mes || 0),
        facturacion_por_camion: Number(objForm.facturacion_por_camion || 0),
      };
      setObjetivos(next);
      setObjForm(next);
      setEditObj(false);
    } catch (e) {
      console.error(e);
      notify("No se pudieron guardar los objetivos: " + e.message, "error");
      return;
    }
    notify("Objetivos guardados correctamente.", "success");
  }

  // Facturación vs objetivo this period
  function descargarInformeCo2() {
    try {
      const html = buildCo2ReportHtml(emisionesOperativas || {});
      const blob = new Blob([html], { type:"text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe-co2-${new Date().toISOString().slice(0,10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(e.message || "No se pudo descargar el informe CO2.", "error");
    }
  }

  function abrirRetornoEnTrafico(item) {
    if (!item) return;
    setRuntimeFocus("tms_trafico_focus", {
      pedido_id: item.candidato?.pedido_id || item.base?.pedido_id || "",
      source: "cargas_retorno",
      action: item.accion || "Revisar carga de retorno",
      action_key: "buscar_retorno",
      type: "carga_retorno",
      area: "Rentabilidad",
      severity: item.prioridad || "media",
      title: `Retorno ${item.base?.numero || ""} -> ${item.candidato?.numero || ""}`,
      description: `${item.base?.destino || "-"} -> ${item.candidato?.destino || "-"} | ${item.impacto?.ahorro_estimado_label || ""}`,
      base_pedido_id: item.base?.pedido_id || "",
      retorno_pedido_id: item.candidato?.pedido_id || "",
      vehiculo_id: item.base?.vehiculo_id || "",
      matricula: item.base?.matricula || "",
    });
    navegar("gestion_trafico");
  }

  function abrirCumplimientoEnTrafico(viaje, actionKey = "revisar_cumplimiento") {
    if (!viaje?.id) return;
    setRuntimeFocus("tms_trafico_focus", {
      pedido_id: viaje.id,
      source: "cumplimiento_europeo",
      action: viaje.accion_recomendada || "Revisar cumplimiento operativo",
      action_key: actionKey,
      type: "cumplimiento_europeo",
      area: "Cumplimiento",
      severity: viaje.prioridad || "media",
      title: `${viaje.numero || "Viaje"} - cumplimiento preventivo`,
      description: `${viaje.origen || "-"} -> ${viaje.destino || "-"} | riesgo ${viaje.score_riesgo || 0}`,
      flags: viaje.flags || {},
    });
    navegar("gestion_trafico");
  }

  async function prepararSolicitudCarrier(item, carrier) {
    if (!item?.candidato?.pedido_id || !carrier?.id) {
      notify("Selecciona una oportunidad y un carrier valido.", "warning");
      return;
    }
    try {
      const res = await prepararSolicitudRetornoCarrier({
        pedido_id: item.candidato.pedido_id,
        base_pedido_id: item.base?.pedido_id || null,
        carrier_id: carrier.id,
      });
      setSolicitudRetorno(res);
      notify(res.ready ? "Solicitud preparada para revisar." : "Solicitud preparada con bloqueantes.", res.ready ? "success" : "warning");
    } catch (e) {
      notify(e.message || "No se pudo preparar la solicitud al carrier.", "error");
    }
  }

  async function enviarSolicitudCarrier() {
    if (!solicitudRetorno?.pedido?.id || !solicitudRetorno?.carrier?.id) {
      notify("Prepara primero una solicitud valida.", "warning");
      return;
    }
    if (!solicitudRetorno.ready) {
      notify("Resuelve los bloqueantes antes de enviar al carrier.", "warning");
      return;
    }
    setEnviandoSolicitudRetorno(true);
    try {
      const res = await enviarSolicitudRetornoCarrier({
        pedido_id: solicitudRetorno.pedido.id,
        base_pedido_id: solicitudRetorno.base_pedido?.id || null,
        carrier_id: solicitudRetorno.carrier.id,
        asunto: solicitudRetorno.solicitud?.asunto || "",
        cuerpo: solicitudRetorno.solicitud?.cuerpo || "",
      });
      setSolicitudRetorno(res);
      notify(res.simulado ? "Solicitud registrada como email simulado." : "Solicitud enviada al carrier.", res.simulado ? "warning" : "success");
    } catch (e) {
      notify(e.message || "No se pudo enviar la solicitud al carrier.", "error");
    } finally {
      setEnviandoSolicitudRetorno(false);
    }
  }

  async function marcarSolicitudRetorno(id, estado) {
    if (!id || !estado) return;
    const notas = estado === "respondida"
      ? "Carrier confirma disponibilidad pendiente de asignacion."
      : estado === "asignada"
        ? "Carrier seleccionado para ejecutar o continuar la asignacion."
        : estado === "descartada"
          ? "Carrier descartado para esta oportunidad."
          : "";
    setActualizandoSolicitudRetorno(`${id}:${estado}`);
    try {
      const res = await actualizarSolicitudRetornoCarrier(id, { estado, notas });
      const asignacion = res.asignacion || null;
      setCargasRetorno(prev => ({
        ...(prev || {}),
        solicitudes_recientes: (prev?.solicitudes_recientes || []).map(s => (
          s.id === id ? {
            ...s,
            ...(res.solicitud || {}),
            carrier_nombre:s.carrier_nombre,
            pedido_numero:s.pedido_numero,
            base_pedido_numero:s.base_pedido_numero,
            ruta:s.ruta,
            pedido_asignado_a_carrier: Boolean(res.solicitud?.pedido_asignado_a_carrier || asignacion?.aplicada || s.pedido_asignado_a_carrier),
            pedido_asignado_at: res.solicitud?.pedido_asignado_at || asignacion?.pedido_asignado_at || s.pedido_asignado_at,
          } : s
        )),
      }));
      if (estado === "asignada" && asignacion) {
        notify(asignacion.aplicada ? "Solicitud asignada y pedido actualizado con el carrier." : (asignacion.mensaje || "Solicitud marcada como asignada."), asignacion.aplicada ? "success" : "warning");
      } else {
        notify("Solicitud de carrier actualizada.", "success");
      }
    } catch (e) {
      notify(e.message || "No se pudo actualizar la solicitud.", "error");
    } finally {
      setActualizandoSolicitudRetorno("");
    }
  }

  const objActual = period==="30d"||period==="7d" ? objetivos.facturacion_mes||0 : period==="365d" ? objetivos.facturacion_anual||0 : 0;

  return (
    <div className="tg-responsive-page" style={S.page}>
      {/* Header + period */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div style={S.title}>Informes de gerencia</div>
        <div style={{ display:"flex", gap:5, background:"var(--bg3)", padding:4, borderRadius:9, border:"1px solid var(--border)" }}>
          {PERIOD_OPTS.map(o=>(
            <button key={o.k} onClick={()=>setPeriod(o.k)}
              style={{ padding:"5px 11px", borderRadius:6, border:"none", fontFamily:"'DM Sans',sans-serif",
                       fontSize:12, fontWeight:600, cursor:"pointer",
                       background:period===o.k?"var(--accent)":"transparent",
                       color:period===o.k?"#fff":"var(--text4)" }}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:0, borderBottom:"1px solid var(--border)", marginBottom:18, overflowX:"auto" }}>
        {TABS.filter(t=>(t.id!=="objetivos"||isGerente) && (t.id!=="kpi_avanzado" || kpisAvanzadosDisponibles)).map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            ...S.tab, whiteSpace:"nowrap",
            borderBottomColor: tab===t.id ? "var(--accent-l)" : "transparent",
            color: tab===t.id ? "var(--accent-xl)" : "var(--text4)",
          }}>{t.l}</button>
        ))}
      </div>

      {loading && <div style={{ color:"var(--text4)", padding:40, textAlign:"center" }}>Cargando datos...</div>}

      {!loading && (
        <>
          {/* RESUMEN */}
          {tab==="resumen" && (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
                {[
                  { l:"Facturado",    v:`${fmt2(totalFact)} €`,  c:"var(--text)" },
                  { l:"Cobrado",      v:`${fmt2(cobrado)} €`,    c:"var(--green)" },
                  { l:"Pendiente",    v:`${fmt2(pendiente)} €`,  c:"#f59e0b" },
                  { l:"Coste taller", v:`${fmt2(costeTaller)} €`,c:"var(--red)" },
                ].map((k,i)=>(
                  <div key={i} style={S.card}>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:19, fontWeight:800, color:k.c }}>{k.v}</div>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", marginTop:4 }}>{k.l}</div>
                  </div>
                ))}
              </div>

              <div style={{...S.card,borderColor:"rgba(20,184,166,.25)",background:"linear-gradient(135deg, rgba(20,184,166,.08), var(--card-bg))"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:10}}>
                  <div>
                    <div style={S.sec}>VISION GERENCIA</div>
                    <div style={{fontSize:12,color:"var(--text4)"}}>Lectura transversal de operaciones, cobro, cancelaciones, flota y margen para el periodo seleccionado.</div>
                  </div>
                  <div style={{fontSize:11,fontWeight:900,color:visionGerencia.cancelacionPct > 8 ? "#ef4444" : "var(--green)"}}>
                    Cancelacion {fmt2(visionGerencia.cancelacionPct)}%
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}}>
                  {panelesGerencia.map((k,i)=>(
                    <div key={i} style={{border:"1px solid var(--border)",background:"var(--bg3)",borderRadius:9,padding:"10px 12px"}}>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:17,fontWeight:900,color:k.c}}>{k.v}</div>
                      <div style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",marginTop:4}}>{k.l}</div>
                      <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>{k.d}</div>
                    </div>
                  ))}
                </div>
              </div>

              {objActual > 0 && (
                <div style={S.card}>
                  <div style={S.sec}>OBJETIVO DEL PERÍODO</div>
                  <ObjetivoBar label={`Facturación (${PERIOD_OPTS.find(o=>o.k===period)?.l})`} actual={totalFact} objetivo={objActual}/>
                </div>
              )}

              <div style={S.card}>
                <div style={S.sec}>Centro de control</div>
                {saludGestion.length===0
                  ? <div style={{fontSize:12,color:"var(--green)",fontWeight:700}}>Todo correcto en el periodo seleccionado.</div>
                  : <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:8}}>
                      {saludGestion.map((a,i)=>{
                        const color = a.nivel==="critico" ? "#ef4444" : a.nivel==="alerta" ? "#f59e0b" : "var(--accent-l)";
                        return (
                          <div key={i} style={{border:`1px solid ${color}44`,background:`${color}12`,borderRadius:8,padding:"9px 11px"}}>
                            <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",color,letterSpacing:".06em"}}>{a.area}</div>
                            <div style={{fontSize:12,color:"var(--text2)",marginTop:3}}>{a.mensaje}</div>
                          </div>
                        );
                      })}
                    </div>
                }
              </div>

              {biResumen && (
                <div style={S.card}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
                    <div>
                      <div style={S.sec}>Pulso BI</div>
                      <div style={{fontSize:12,color:"var(--text4)"}}>
                        Periodo {biResumen.periodo?.desde || "-"} a {biResumen.periodo?.hasta || "-"}
                      </div>
                    </div>
                    <div style={{fontSize:11,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>
                      {Number(biResumen.alertas?.errores_fiscales || 0) > 0 ? `${biResumen.alertas.errores_fiscales} errores fiscales` : "Fiscalidad sin bloqueos"}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:12}}>
                    {[
                      { l:"Ingreso gestionado", v:`${fmt2(biResumen.kpis?.ingreso_gestionado)} EUR`, c:"var(--accent-xl)" },
                      { l:"Facturado", v:`${fmt2(biResumen.kpis?.facturado)} EUR`, c:"var(--text)" },
                      { l:"Realizado sin facturar", v:`${fmt2(biResumen.kpis?.pendiente_facturar_realizado)} EUR`, c:"#f59e0b" },
                      { l:"Margen", v:`${fmt2(biResumen.kpis?.margen)} EUR`, c:Number(biResumen.kpis?.margen || 0) >= 0 ? "var(--green)" : "var(--red)" },
                      { l:"Margen %", v:`${fmt2(biResumen.kpis?.margen_pct)}%`, c:Number(biResumen.kpis?.margen_pct || 0) >= 0 ? "var(--green)" : "var(--red)" },
                      { l:"EUR/km", v:fmt2(biResumen.kpis?.eur_km), c:"var(--accent-xl)" },
                      { l:"Vencido", v:`${fmt2(biResumen.kpis?.vencido)} EUR`, c:Number(biResumen.kpis?.vencido || 0) > 0 ? "#ef4444" : "var(--green)" },
                      { l:"Pedidos", v:fmtN(biResumen.kpis?.pedidos), c:"var(--text)" },
                    ].map((k,i)=>(
                      <div key={i} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px"}}>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:17,fontWeight:900,color:k.c}}>{k.v}</div>
                        <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",marginTop:4}}>{k.l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"minmax(260px,1fr) minmax(260px,1fr)",gap:12}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:900,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Clientes por margen y riesgo</div>
                      {(biResumen.clientes || []).slice(0,5).map(c=>(
                        <div key={c.id || c.nombre} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,borderBottom:"1px solid var(--border)",padding:"7px 0"}}>
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:800,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.nombre}</div>
                            <div style={{fontSize:10,color:"var(--text5)"}}>
                              {fmtN(c.pedidos)} viajes · ingreso {fmt2(c.ingreso_gestionado || c.venta)} EUR · margen {fmt2(c.margen_pct)}%
                            </div>
                          </div>
                          <div style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:Number(c.deuda_vencida || 0) > 0 ? "#ef4444" : "var(--green)",fontWeight:900}}>
                            {fmt2(c.facturado || 0)} EUR fact.
                            {Number(c.pendiente_facturar_realizado || 0) > 0 && (
                              <div style={{color:"#f59e0b",marginTop:2}}>{fmt2(c.pendiente_facturar_realizado)} EUR sin fact.</div>
                            )}
                            {Number(c.deuda_vencida || 0) > 0 && (
                              <div style={{color:"#ef4444",marginTop:2}}>{fmt2(c.deuda_vencida)} EUR venc.</div>
                            )}
                          </div>
                        </div>
                      ))}
                      {!(biResumen.clientes || []).length && <div style={{fontSize:12,color:"var(--text5)"}}>Sin clientes con movimiento en el periodo.</div>}
                    </div>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:900,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Rutas con mas actividad</div>
                      {(biResumen.rutas || []).slice(0,5).map((r,i)=>(
                        <div key={`${r.origen}-${r.destino}-${i}`} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,borderBottom:"1px solid var(--border)",padding:"7px 0"}}>
                          <div style={{fontSize:12,color:"var(--text2)",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.origen} -> {r.destino}</div>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--accent-xl)",fontWeight:900}}>{fmtN(r.viajes)} viajes</div>
                        </div>
                      ))}
                      {!(biResumen.rutas || []).length && <div style={{fontSize:12,color:"var(--text5)"}}>Sin rutas en el periodo.</div>}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div style={S.card}>
                  <div style={S.sec}>EVOLUCIÓN FACTURACIÓN</div>
                  {facMensual.length===0
                    ? <div style={{ color:"var(--text5)", fontSize:12, padding:"20px 0", textAlign:"center" }}>Sin datos</div>
                    : <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={facMensual}>
                          <XAxis dataKey="name" tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false}/>
                          <YAxis tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false} width={50}
                            tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                          <Tooltip contentStyle={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}}
                            formatter={(v,n)=>[`${fmt2(v)} €`,n==="fact"?"Facturado":"Cobrado"]}/>
                          <Bar dataKey="fact" fill="var(--accent-l)" radius={[3,3,0,0]} name="fact"/>
                          <Bar dataKey="cobr" fill="var(--green)" radius={[3,3,0,0]} name="cobr"/>
                        </BarChart>
                      </ResponsiveContainer>
                  }
                </div>
                <div style={S.card}>
                  <div style={S.sec}>TOP 5 CLIENTES</div>
                  {topClientes.slice(0,5).map((c,i)=>(
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", marginBottom:8, alignItems:"center" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:COLORS[i], flexShrink:0 }}/>
                        <span style={{ fontSize:12, color:"var(--text2)" }}>{c.name.length>22?c.name.slice(0,22)+"...":c.name}</span>
                      </div>
                      <span style={{ fontSize:12, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:"var(--text)" }}>{fmt2(c.total)} €</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FACTURACIÓN */}
          {tab==="facturacion" && (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
                {[
                  { l:"Total facturado",  v:`${fmt2(totalFact)} €`,  c:"var(--text)" },
                  { l:"Cobrado",          v:`${fmt2(cobrado)} €`,    c:"var(--green)", pct:totalFact>0?((cobrado/totalFact)*100).toFixed(1)+"% del total":null },
                  { l:"Pendiente cobro",  v:`${fmt2(pendiente)} €`,  c:"#f59e0b" },
                ].map((k,i)=>(
                  <div key={i} style={S.card}>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:800, color:k.c }}>{k.v}</div>
                    <div style={{ fontSize:10, color:"var(--text5)", marginTop:4, fontWeight:700, textTransform:"uppercase" }}>{k.l}</div>
                    {k.pct && <div style={{ fontSize:11, color:"var(--green)", marginTop:2 }}>{k.pct}</div>}
                  </div>
                ))}
              </div>
              <div style={S.card}>
                <div style={S.sec}>FACTURACIÓN MENSUAL</div>
                {facMensual.length===0
                  ? <div style={{ color:"var(--text5)", fontSize:12, padding:"20px 0", textAlign:"center" }}>Sin datos para el período</div>
                  : <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={facMensual}>
                        <XAxis dataKey="name" tick={{fontSize:11,fill:"var(--text4)"}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false} width={55}
                          tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
                        <Tooltip contentStyle={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}}
                          formatter={(v,n)=>[`${fmt2(v)} €`,n==="fact"?"Facturado":"Cobrado"]}/>
                        <Legend formatter={v=>v==="fact"?"Facturado":"Cobrado"} wrapperStyle={{fontSize:11}}/>
                        <Bar dataKey="fact" fill="var(--accent-l)" radius={[3,3,0,0]} name="fact"/>
                        <Bar dataKey="cobr" fill="var(--green)"    radius={[3,3,0,0]} name="cobr"/>
                      </BarChart>
                    </ResponsiveContainer>
                }
              </div>
              {/* Estado facturas */}
              <div style={S.card}>
                <div style={S.sec}>FACTURAS POR ESTADO</div>
                <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                  {["borrador","emitida","enviada","cobrada","vencida","rectificada"].map(e=>{
                    const n = facFilt.filter(f=>f.estado===e).length;
                    const tot = facFilt.filter(f=>f.estado===e).reduce((s,f)=>s+Number(f.total||0),0);
                    const colors = {borrador:"var(--text4)",emitida:"var(--accent-l)",enviada:"#06b6d4",cobrada:"var(--green)",vencida:"var(--red)",rectificada:"#f97316"};
                    if (!n) return null;
                    return (
                      <div key={e} style={{ background:"var(--bg4)", borderRadius:8, padding:"10px 14px", minWidth:120, border:`1px solid ${colors[e]}20` }}>
                        <div style={{ fontSize:18, fontWeight:800, color:colors[e], fontFamily:"'JetBrains Mono',monospace" }}>{n}</div>
                        <div style={{ fontSize:10, color:"var(--text5)", textTransform:"uppercase", fontWeight:700 }}>{e}</div>
                        <div style={{ fontSize:11, color:"var(--text4)", marginTop:2 }}>{fmt2(tot)} €</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* CLIENTES */}
          {tab==="clientes" && (
            <div>
              <div style={S.card}>
                <div style={S.sec}>RANKING DE CLIENTES - FACTURACIÓN</div>
                {topClientes.length === 0
                  ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin datos</div>
                  : (
                    <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <thead><tr>{["#","Cliente","Facturas","Facturado","Cobrado","% Cobro"].map(h=>(
                        <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {topClientes.map((c,i)=>(
                          <tr key={i}>
                            <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text4)", borderBottom:"1px solid var(--border)" }}>{i+1}</td>
                            <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <div style={{ width:8, height:8, borderRadius:"50%", background:COLORS[i%COLORS.length] }}/>
                                <span style={{ fontSize:13, fontWeight:600, color:"var(--text)" }}>{c.name}</span>
                              </div>
                            </td>
                            <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{c.nfact}</td>
                            <td style={{ padding:"9px 10px", fontSize:13, fontWeight:700, color:"var(--text)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.total)} €</td>
                            <td style={{ padding:"9px 10px", fontSize:13, color:"var(--green)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.cobrado)} €</td>
                            <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                              <span style={{ fontSize:12, color:c.total>0&&c.cobrado/c.total>=0.9?"var(--green)":"#f59e0b", fontWeight:700 }}>
                                {c.total>0?((c.cobrado/c.total)*100).toFixed(0):0}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                }
              </div>
            </div>
          )}

          {/* DATOS MAESTROS */}
          {tab==="datos_maestros" && (
            <div>
              {(() => {
                const data = datosMaestrosReadiness || {};
                const resumen = data.resumen || {};
                const secciones = data.secciones || {};
                const sectionDefs = [
                  ["clientes", "Clientes"],
                  ["colaboradores", "Colaboradores"],
                  ["choferes", "Choferes"],
                  ["vehiculos", "Vehiculos"],
                ];
                const estadoColor = scoreColor(resumen.estado);
                return (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))", gap:10, marginBottom:16 }}>
                      {[
                        { l:"Score medio", v:`${resumen.score_medio ?? 100}%`, c:estadoColor },
                        { l:"Registros revisados", v:resumen.total || 0, c:"var(--accent-xl)" },
                        { l:"Completos", v:resumen.completos || 0, c:"var(--green)" },
                        { l:"Incompletos", v:resumen.incompletos || 0, c:Number(resumen.incompletos||0)>0?"#f59e0b":"var(--green)" },
                        { l:"Faltantes obligatorios", v:resumen.faltantes_obligatorios || 0, c:Number(resumen.faltantes_obligatorios||0)>0?"var(--red)":"var(--green)" },
                      ].map((k,i)=>(
                        <div key={i} style={S.card}>
                          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:800, color:k.c }}>{k.v}</div>
                          <div style={{ fontSize:10, color:"var(--text5)", marginTop:4, fontWeight:700, textTransform:"uppercase" }}>{k.l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={S.card}>
                      <div style={S.sec}>CALIDAD DE DATOS OPERATIVOS</div>
                      <div style={{ fontSize:12, color:"var(--text3)", lineHeight:1.5 }}>{data.objetivo || "Control de clientes, colaboradores, choferes y vehiculos para evitar bloqueos al crear viajes, facturar o asignar recursos."}</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:10 }}>
                        {(data.acciones_recomendadas || []).map((a,i)=>(
                          <span key={i} style={{ fontSize:11, color:"var(--text3)", background:"var(--bg4)", border:"1px solid var(--border)", borderRadius:999, padding:"4px 9px" }}>{a}</span>
                        ))}
                      </div>
                    </div>

                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))", gap:12 }}>
                      {sectionDefs.map(([key,label]) => {
                        const sec = secciones[key] || {};
                        const sr = sec.resumen || {};
                        const items = Array.isArray(sec.items) ? sec.items : [];
                        return (
                          <div key={key} style={S.card}>
                            <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"center", marginBottom:10 }}>
                              <div style={S.sec}>{label.toUpperCase()}</div>
                              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:900, color:sr.score_medio>=90?"var(--green)":sr.score_medio>=70?"#f59e0b":"var(--red)" }}>{sr.score_medio ?? 100}%</div>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:10 }}>
                              {[
                                ["Total", sr.total || 0],
                                ["Completos", sr.completos || 0],
                                ["Faltantes", sr.faltantes_obligatorios || 0],
                              ].map(([l,v])=>(
                                <div key={l} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"8px 9px" }}>
                                  <div style={{ fontSize:15, fontWeight:900, color:"var(--text)" }}>{v}</div>
                                  <div style={{ fontSize:10, color:"var(--text5)", textTransform:"uppercase", fontWeight:800 }}>{l}</div>
                                </div>
                              ))}
                            </div>
                            {items.length === 0 ? (
                              <div style={{ fontSize:12, color:"var(--green)", fontWeight:700 }}>Sin registros pendientes en esta seccion.</div>
                            ) : (
                              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                                {items.slice(0,6).map(item => (
                                  <div key={item.id} style={{ border:"1px solid var(--border)", background:"var(--bg4)", borderRadius:8, padding:"9px 10px" }}>
                                    <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
                                      <div style={{ fontSize:13, fontWeight:800, color:"var(--text)" }}>{item.nombre}</div>
                                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:900, color:scoreColor(item.estado) }}>{item.score}%</div>
                                    </div>
                                    {item.contacto && <div style={{ fontSize:11, color:"var(--text5)", marginTop:2 }}>{item.contacto}</div>}
                                    <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:7 }}>
                                      {(item.missing || []).slice(0,4).map(m => (
                                        <span key={m.key} style={{ fontSize:10, fontWeight:800, color:m.required?"#fca5a5":"var(--accent)", border:`1px solid ${m.required?"rgba(239,68,68,.22)":"rgba(59,130,246,.22)"}`, background:m.required?"rgba(239,68,68,.07)":"rgba(59,130,246,.07)", borderRadius:999, padding:"2px 7px" }}>
                                          {m.label}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* CUMPLIMIENTO */}
          {tab==="cumplimiento" && (
            <div>
              {(() => {
                const data = cumplimientoEuropeo || {};
                const resumen = data.resumen || {};
                const viajes = Array.isArray(data.viajes) ? data.viajes : [];
                const acciones = Array.isArray(data.acciones) ? data.acciones : [];
                const flagLabels = {
                  adr: "ADR",
                  zbe: "ZBE",
                  internacional: "Internacional",
                  cabotaje: "Cabotaje",
                  tacografo: "Tacógrafo",
                  diwass: "DIWASS/eAnnex VII",
                  deca: "DeCA pendiente",
                  efti: "eFTI pendiente",
                  ecmr: "eCMR",
                  regulatory_blocking: "Bloqueo checklist",
                };
                const sevColor = sev => sev === "alta" ? "var(--red)" : sev === "media" ? "#f59e0b" : "var(--accent-xl)";
                const statusColor = status => {
                  const key = String(status || "").toLowerCase();
                  if (["ready","prepared","archived","not_applicable"].includes(key)) return "var(--green)";
                  if (["missing","requires_review","requires_preparation"].includes(key)) return "var(--red)";
                  return "#f59e0b";
                };
                const statusLabel = status => ({
                  ready: "Listo",
                  prepared: "Preparado",
                  archived: "Archivado",
                  missing: "Pendiente",
                  requires_review: "Revisar",
                  requires_preparation: "Preparar",
                  not_applicable: "No aplica",
                }[String(status || "")] || status || "-");
                return (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10, marginBottom:16 }}>
                      {[
                        { l:"Viajes revisados", v:resumen.total_viajes || 0, c:"var(--accent-xl)" },
                        { l:"Con señales", v:resumen.con_senales || 0, c:Number(resumen.con_senales||0)>0?"#f59e0b":"var(--green)" },
                        { l:"Prioridad alta", v:resumen.alta || 0, c:Number(resumen.alta||0)>0?"var(--red)":"var(--green)" },
                        { l:"Regulatorio listo", v:resumen.regulatory_ready || 0, c:"var(--green)" },
                        { l:"DeCA pendiente", v:resumen.deca_pendiente || 0, c:Number(resumen.deca_pendiente||0)>0?"#f59e0b":"var(--green)" },
                        { l:"eFTI pendiente", v:resumen.efti_pendiente || 0, c:Number(resumen.efti_pendiente||0)>0?"#f59e0b":"var(--green)" },
                        { l:"ADR", v:resumen.adr || 0, c:Number(resumen.adr||0)>0?"var(--red)":"var(--text)" },
                        { l:"DIWASS", v:resumen.diwass || 0, c:Number(resumen.diwass||0)>0?"var(--red)":"var(--text)" },
                        { l:"Bloqueos", v:resumen.bloqueos_regulatorios || 0, c:Number(resumen.bloqueos_regulatorios||0)>0?"var(--red)":"var(--green)" },
                        { l:"ZBE", v:resumen.zbe || 0, c:Number(resumen.zbe||0)>0?"#f59e0b":"var(--text)" },
                        { l:"Tacógrafo", v:resumen.tacografo || 0, c:Number(resumen.tacografo||0)>0?"#f59e0b":"var(--text)" },
                      ].map((k,i)=>(
                        <div key={i} style={S.card}>
                          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:800, color:k.c }}>{k.v}</div>
                          <div style={{ fontSize:10, color:"var(--text5)", marginTop:4, fontWeight:700, textTransform:"uppercase" }}>{k.l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={S.card}>
                      <div style={S.sec}>CONTROL OPERATIVO Y DOCUMENTAL</div>
                      <div style={{ fontSize:12, color:"var(--text3)", lineHeight:1.5 }}>
                        Prioriza viajes con documentacion pendiente, senales ADR/ZBE, rutas internacionales, tacografo, bloqueos de checklist o datos incompletos antes de confirmar, cargar o facturar.
                      </div>
                      <div style={{ fontSize:12, color:"var(--text3)", lineHeight:1.5, marginTop:8 }}>
                        Usa esta vista como lista de trabajo: cada senal debe tener responsable, accion y cierre antes de que el viaje avance.
                      </div>
                      <div style={{ fontSize:11, color:"var(--text5)", marginTop:8, fontFamily:"'JetBrains Mono',monospace" }}>
                        Periodo {data.periodo?.desde || "-"} a {data.periodo?.hasta || "-"} - actualizado {data.generated_at ? new Date(data.generated_at).toLocaleString("es-ES") : "-"}
                      </div>
                    </div>

                    <div style={{...S.card,borderColor:acciones.length?"rgba(245,158,11,.35)":"var(--border)"}}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div>
                          <div style={S.sec}>ACCIONES RECOMENDADAS</div>
                          <div style={{fontSize:12,color:"var(--text4)"}}>Prioridades antes de confirmar, asignar o remitir documentacion digital.</div>
                        </div>
                        <div style={{fontSize:11,color:"var(--text5)",fontWeight:800}}>{acciones.length} accion{acciones.length!==1?"es":""}</div>
                      </div>
                      {acciones.length===0 ? (
                        <div style={{color:"var(--green)",fontSize:12,fontWeight:700,padding:"8px 0"}}>Sin señales preventivas relevantes en el periodo.</div>
                      ) : (
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:8}}>
                          {acciones.map((a,i)=>(
                            <div key={`${a.type}-${i}`} style={{border:`1px solid ${sevColor(a.severity)}44`,background:`${sevColor(a.severity)}0f`,borderRadius:8,padding:"10px 11px"}}>
                              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
                                <div style={{fontSize:13,fontWeight:900,color:"var(--text)",lineHeight:1.25}}>{a.title}</div>
                                <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:sevColor(a.severity)}}>{a.severity || "info"}</span>
                              </div>
                              <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.35,marginTop:7,fontWeight:700}}>{a.recommendation}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={S.card}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div>
                          <div style={S.sec}>VIAJES A REVISAR</div>
                          <div style={{fontSize:12,color:"var(--text4)"}}>Señales detectadas en viajes próximos o abiertos.</div>
                        </div>
                        <div style={{fontSize:11,color:"var(--text5)",fontWeight:800}}>{viajes.length} viaje{viajes.length!==1?"s":""}</div>
                      </div>
                      {viajes.length===0 ? (
                        <div style={{color:"var(--green)",fontSize:12,fontWeight:700,padding:"12px 0"}}>No hay viajes con señales de cumplimiento en el periodo.</div>
                      ) : (
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr>{["Riesgo","Viaje","Ruta","Cliente","Señales","Regulatorio","Acción"].map(h=>(
                            <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                          ))}</tr></thead>
                          <tbody>
                            {viajes.slice(0,30).map(v=>(
                              <tr key={v.id}>
                                <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:15, fontWeight:900, color:sevColor(v.prioridad) }}>{v.score_riesgo || 0}</div>
                                  <div style={{ fontSize:10, color:sevColor(v.prioridad), fontWeight:900, textTransform:"uppercase" }}>{v.prioridad}</div>
                                </td>
                                <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                  <div style={{ fontSize:13, fontWeight:900, color:"var(--text)" }}>{v.numero || "Sin numero"}</div>
                                  <div style={{ fontSize:10, color:"var(--text5)" }}>{v.estado_label || v.estado || "-"} - {v.fecha_carga ? new Date(v.fecha_carga).toLocaleDateString("es-ES") : "sin fecha"}</div>
                                </td>
                                <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text3)", borderBottom:"1px solid var(--border)", maxWidth:260 }}>{v.origen || "-"} - {v.destino || "-"}</td>
                                <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>
                                  <div>{v.cliente || "-"}</div>
                                  {v.colaborador && <div style={{ fontSize:10, color:"var(--text5)", marginTop:3 }}>Carrier: {v.colaborador}</div>}
                                </td>
                                <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                  <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                                    {Object.entries(v.flags || {}).filter(([,ok])=>ok).map(([key])=>(
                                      <span key={key} style={{ fontSize:10, fontWeight:900, color:key==="adr"||key==="cabotaje"||key==="diwass"||key==="regulatory_blocking"?"var(--red)":"#f59e0b", border:"1px solid var(--border)", background:"var(--bg4)", borderRadius:999, padding:"2px 7px" }}>
                                        {flagLabels[key] || key}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)", minWidth:180 }}>
                                  <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                                    {[
                                      ["DeCA", v.regulatory_core?.deca?.status],
                                      ["eFTI", v.regulatory_core?.payloads?.efti?.status || "missing"],
                                      ["eCMR", v.regulatory_core?.payloads?.ecmr?.status || (v.flags?.internacional ? "missing" : "not_applicable")],
                                      ["DIWASS", v.regulatory_core?.payloads?.diwass?.status || (v.flags?.diwass ? "missing" : "not_applicable")],
                                    ].map(([label,status]) => (
                                      <span key={label} title={`${label}: ${statusLabel(status)}`} style={{ fontSize:10, fontWeight:900, color:statusColor(status), border:"1px solid var(--border)", background:"var(--bg4)", borderRadius:999, padding:"2px 7px" }}>
                                        {label}: {statusLabel(status)}
                                      </span>
                                    ))}
                                  </div>
                                  {v.regulatory_core?.latest_audit_at && (
                                    <div style={{ fontSize:10, color:"var(--text5)", marginTop:5 }}>
                                      Sync {new Date(v.regulatory_core.latest_audit_at).toLocaleString("es-ES")}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                  <button onClick={()=>abrirCumplimientoEnTrafico(v)} style={{...S.btn,background:"rgba(245,158,11,.12)",color:"#b45309",border:"1px solid rgba(245,158,11,.28)"}}>
                                    Revisar en tráfico
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* SCORING */}
          {tab==="scoring" && (
            <div>
              {(() => {
                const data = scoringOperativo || {};
                const resumen = data.resumen || {};
                const clientesScore = Array.isArray(data.clientes) ? data.clientes : [];
                const colaboradoresScore = Array.isArray(data.colaboradores) ? data.colaboradores : [];
                const decisiones = Array.isArray(data.decisiones_prioritarias) ? data.decisiones_prioritarias : [];
                const decisionColor = decision => {
                  const key = String(decision?.acceptance || decision || "");
                  if (key === "autorizar_gerencia") return "var(--red)";
                  if (key === "aceptar_condicionado") return "#f59e0b";
                  return "var(--green)";
                };
                const verifColor = verificacion => {
                  const key = String(verificacion?.status || verificacion || "");
                  if (key === "bloqueado") return "var(--red)";
                  if (key === "condicionado") return "#f59e0b";
                  return "var(--green)";
                };
                return (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10, marginBottom:16 }}>
                      {[
                        { l:"Clientes revisados", v:resumen.clientes || 0, c:"var(--accent-xl)" },
                        { l:"Colaboradores", v:resumen.colaboradores || 0, c:"var(--accent-xl)" },
                        { l:"Carriers verificados", v:resumen.carriers_verificados || 0, c:"var(--green)" },
                        { l:"Carriers bloqueados", v:resumen.carriers_bloqueados || 0, c:Number(resumen.carriers_bloqueados||0)>0?"var(--red)":"var(--green)" },
                        { l:"Riesgo alto", v:resumen.riesgo_alto || 0, c:Number(resumen.riesgo_alto||0)>0?"var(--red)":"var(--green)" },
                        { l:"Condicionados", v:resumen.aceptacion_condicionada || 0, c:Number(resumen.aceptacion_condicionada||0)>0?"#f59e0b":"var(--green)" },
                      ].map((k,i)=>(
                        <div key={i} style={S.card}>
                          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:800, color:k.c }}>{k.v}</div>
                          <div style={{ fontSize:10, color:"var(--text5)", marginTop:4, fontWeight:700, textTransform:"uppercase" }}>{k.l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={S.card}>
                      <div style={S.sec}>LECTURA DE SCORING</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
                        {[
                          ["Riesgo cliente", "Bloqueo comercial, limite de riesgo, deuda vencida y volumen pendiente antes de admitir nuevos viajes."],
                          ["Riesgo carrier", "Verificacion documental, incidencias, aceptacion condicionada y bloqueos antes de asignar cargas."],
                          ["Decision gerencia", "Casos que requieren autorizar, condicionar o parar la operativa para proteger margen y cobro."],
                        ].map(([title, text])=>(
                          <div key={title} style={{border:"1px solid var(--border)",background:"var(--bg3)",borderRadius:9,padding:"10px 12px"}}>
                            <div style={{fontSize:12,fontWeight:900,color:"var(--text)",marginBottom:5}}>{title}</div>
                            <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.45}}>{text}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{...S.card,marginBottom:14,borderColor:decisiones.length?"rgba(249,115,22,.30)":"var(--border)"}}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div>
                          <div style={S.sec}>DECISION ANTES DE ACEPTAR MAS VIAJES</div>
                          <div style={{ fontSize:12, color:"var(--text4)" }}>Clientes y colaboradores que requieren autorizacion, condiciones o controles antes de aumentar volumen.</div>
                        </div>
                        <div style={{fontSize:11,color:"var(--text5)",fontWeight:800}}>{decisiones.length} prioridad{decisiones.length!==1?"es":""}</div>
                      </div>
                      {decisiones.length===0 ? (
                        <div style={{ color:"var(--green)", fontSize:12, padding:"8px 0", fontWeight:700 }}>No hay relaciones que requieran condiciones especiales en el periodo.</div>
                      ) : (
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:8 }}>
                          {decisiones.slice(0,8).map(item=>(
                            <div key={`${item.tipo}-${item.id}`} style={{ border:`1px solid ${decisionColor(item.decision)}44`, background:`${decisionColor(item.decision)}0f`, borderRadius:8, padding:"10px 11px" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"flex-start" }}>
                                <div>
                                  <div style={{ fontSize:10, color:"var(--text5)", fontWeight:900, textTransform:"uppercase", letterSpacing:".06em" }}>{item.tipo}</div>
                                  <div style={{ fontSize:13, color:"var(--text)", fontWeight:900, marginTop:2 }}>{item.nombre}</div>
                                </div>
                                <div style={{ textAlign:"right" }}>
                                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:900, color:scoreColor(item.salud) }}>{item.score}</div>
                                  <div style={{ fontSize:10, color:"var(--text5)" }}>score</div>
                                </div>
                              </div>
                              <div style={{ marginTop:8, fontSize:12, color:decisionColor(item.decision), fontWeight:900 }}>{item.decision?.label || "Revisar antes de aceptar"}</div>
                              <div style={{ marginTop:5, fontSize:11, color:"var(--text4)", lineHeight:1.35 }}>{item.decision?.max_volume || item.accion}</div>
                              <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:8 }}>
                                {(item.motivos||[]).slice(0,3).map((m,idx)=>(
                                  <span key={idx} style={{ fontSize:10, fontWeight:800, color:"var(--text3)", background:"var(--bg4)", border:"1px solid var(--border)", borderRadius:999, padding:"2px 7px" }}>{m}</span>
                                ))}
                              </div>
                              {(item.decision?.required_controls || []).length > 0 && (
                                <div style={{ marginTop:8, fontSize:11, color:"var(--text3)", lineHeight:1.35 }}>
                                  {(item.decision.required_controls || []).slice(0,2).join(" · ")}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={S.card}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div style={S.sec}>CLIENTES: MARGEN, COBRO Y DOCUMENTACION</div>
                        <div style={{ fontSize:11, color:"var(--text4)" }}>Score bajo primero</div>
                      </div>
                      {clientesScore.length===0
                        ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0", textAlign:"center" }}>Sin datos de clientes para el periodo.</div>
                        : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr>{["Score","Cliente","Pedidos","Margen","Cobros riesgo","Docs","Motivos","Accion"].map(h=>(
                              <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                            ))}</tr></thead>
                            <tbody>
                              {clientesScore.slice(0,18).map((c,i)=>(
                                <tr key={c.id||i}>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <span style={{ display:"inline-flex", minWidth:44, justifyContent:"center", borderRadius:999, padding:"3px 8px", fontSize:12, fontWeight:900, color:scoreColor(c.salud), background:"var(--bg4)", border:"1px solid var(--border)" }}>{c.score}</span>
                                  </td>
                                  <td style={{ padding:"9px 10px", fontSize:13, fontWeight:700, color:"var(--text)", borderBottom:"1px solid var(--border)" }}>{c.nombre}</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>{c.pedidos}</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, fontWeight:800, color:Number(c.margen||0)<0?"var(--red)":scoreColor(c.salud), borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.margen)} EUR</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:Number(c.cobros_riesgo||0)>0?"var(--red)":"var(--text4)", borderBottom:"1px solid var(--border)" }}>{c.cobros_riesgo}</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:Number(c.pod_pendiente||0)>0?"#f59e0b":"var(--text4)", borderBottom:"1px solid var(--border)" }}>{c.pod_pendiente}</td>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                                      {(c.motivos||[]).slice(0,3).map((m,idx)=><span key={idx} style={{ fontSize:10, fontWeight:700, color:"var(--text3)", background:"var(--bg4)", border:"1px solid var(--border)", borderRadius:6, padding:"2px 6px" }}>{m}</span>)}
                                    </div>
                                    {c.decision?.label && <div style={{ marginTop:5, fontSize:10, color:decisionColor(c.decision), fontWeight:900 }}>{c.decision.label}</div>}
                                  </td>
                                  <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text3)", borderBottom:"1px solid var(--border)", maxWidth:270 }}>{c.accion}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      }
                    </div>

                    <div style={S.card}>
                      <div style={S.sec}>COLABORADORES: CALIDAD, DOCUMENTACION Y LIQUIDACION</div>
                      {colaboradoresScore.length===0
                        ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0", textAlign:"center" }}>Sin viajes con colaboradores en el periodo.</div>
                        : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr>{["Score","Colaborador","Verificacion","Viajes","Margen inter.","Docs/Veh.","Factura pend.","Pago pend.","Accion"].map(h=>(
                              <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                            ))}</tr></thead>
                            <tbody>
                              {colaboradoresScore.slice(0,18).map((c,i)=>(
                                <tr key={c.id||i}>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <span style={{ display:"inline-flex", minWidth:44, justifyContent:"center", borderRadius:999, padding:"3px 8px", fontSize:12, fontWeight:900, color:scoreColor(c.salud), background:"var(--bg4)", border:"1px solid var(--border)" }}>{c.score}</span>
                                  </td>
                                  <td style={{ padding:"9px 10px", fontSize:13, fontWeight:700, color:"var(--text)", borderBottom:"1px solid var(--border)" }}>{c.nombre}</td>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)", maxWidth:210 }}>
                                    <div style={{ fontSize:11, fontWeight:900, color:verifColor(c.verificacion), textTransform:"uppercase" }}>
                                      {c.verificacion?.label || "Sin verificar"}
                                    </div>
                                    <div style={{ fontSize:10, color:"var(--text4)", marginTop:3, lineHeight:1.35 }}>
                                      {c.verificacion?.next_action || "-"}
                                    </div>
                                  </td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>{c.pedidos}</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, fontWeight:800, color:Number(c.margen_intermediacion||0)<0?"var(--red)":"var(--green)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.margen_intermediacion)} EUR</td>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <div style={{ fontSize:11, color:Number(c.docs_caducados||0)>0?"var(--red)":Number(c.docs_proximos||0)>0?"#f59e0b":"var(--text3)" }}>
                                      {c.documentos || 0} doc. / {c.vehiculos || 0} veh.
                                    </div>
                                    <div style={{ fontSize:10, color:Number(c.vehiculos_doc_riesgo||0)>0?"#f59e0b":"var(--text5)", marginTop:3 }}>
                                      {c.docs_caducados || 0} cad. - {c.vehiculos_doc_riesgo || 0} veh. riesgo
                                    </div>
                                  </td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:Number(c.factura_pendiente||0)>0?"#f59e0b":"var(--text4)", borderBottom:"1px solid var(--border)" }}>{c.factura_pendiente}</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:Number(c.pago_pendiente||0)>0?"#f59e0b":"var(--text4)", borderBottom:"1px solid var(--border)" }}>{c.pago_pendiente}</td>
                                  <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text3)", borderBottom:"1px solid var(--border)", maxWidth:270 }}>{c.accion}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      }
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* SOSTENIBILIDAD */}
          {tab==="sostenibilidad" && (
            <div>
              {(() => {
                const data = emisionesOperativas || {};
                const resumen = data.resumen || {};
                const metodologia = data.metodologia || {};
                const porCliente = Array.isArray(data.por_cliente) ? data.por_cliente : [];
                const porVehiculo = Array.isArray(data.por_vehiculo) ? data.por_vehiculo : [];
                const porRuta = Array.isArray(data.por_ruta) ? data.por_ruta : [];
                const pendientesKm = Array.isArray(data.pendientes_km) ? data.pendientes_km : [];
                const accionesCo2 = Array.isArray(data.acciones) ? data.acciones : [];
                const accionColor = sev => sev === "alta" ? "var(--red)" : sev === "media" ? "#f59e0b" : "var(--accent-xl)";
                return (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))", gap:10, marginBottom:16 }}>
                      {[
                        { l:"CO2 estimado", v:`${fmt2(resumen.co2_t)} t`, c:"var(--green)" },
                        { l:"KM analizados", v:`${fmtN(resumen.km_total)} km`, c:"var(--accent-xl)" },
                        { l:"Litros estimados", v:`${fmt2(resumen.litros_estimados)} L`, c:"#f59e0b" },
                        { l:"CO2/km", v:resumen.co2_kg_km==null?"-":`${fmt2(resumen.co2_kg_km)} kg`, c:"var(--text)" },
                        { l:"KM vacio", v:resumen.pct_km_vacio==null?"-":`${fmt2(resumen.pct_km_vacio)}%`, c:Number(resumen.pct_km_vacio||0)>25?"var(--red)":"var(--text)" },
                        { l:"Datos sin km", v:resumen.datos_incompletos || 0, c:Number(resumen.datos_incompletos||0)>0?"var(--red)":"var(--green)" },
                      ].map((k,i)=>(
                        <div key={i} style={S.card}>
                          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:800, color:k.c }}>{k.v}</div>
                          <div style={{ fontSize:10, color:"var(--text5)", marginTop:4, fontWeight:700, textTransform:"uppercase" }}>{k.l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ ...S.card, display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap" }}>
                      <div>
                        <div style={S.sec}>METODOLOGIA PREPARATORIA ISO 14083 / GLEC</div>
                        <div style={{ fontSize:12, color:"var(--text3)", lineHeight:1.45, maxWidth:780 }}>
                          Calculo estimado con kilometros operativos, consumo medio {fmt2(metodologia.consumo_l_100km)} L/100 km y factor {fmt2(metodologia.factor_kg_co2_litro)} kg CO2/L. Los viajes sin km se separan para no distorsionar el informe.
                        </div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
                        <div style={{ fontSize:11, color:"var(--text5)", fontFamily:"'JetBrains Mono',monospace" }}>
                          {data.generated_at ? new Date(data.generated_at).toLocaleString("es-ES") : ""}
                        </div>
                        <button onClick={descargarInformeCo2} style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)"}}>
                          Informe CO2
                        </button>
                      </div>
                    </div>

                    <div style={{...S.card,borderColor:accionesCo2.length?"rgba(16,185,129,.30)":"var(--border)"}}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div>
                          <div style={S.sec}>ACCIONES CO2 / ESG</div>
                          <div style={{fontSize:12,color:"var(--text4)"}}>Prioridades para mejorar calidad del dato, reducir km en vacio y preparar informes de cliente.</div>
                        </div>
                        <div style={{fontSize:11,color:"var(--text5)",fontWeight:800}}>{accionesCo2.length} accion{accionesCo2.length!==1?"es":""}</div>
                      </div>
                      {accionesCo2.length===0 ? (
                        <div style={{color:"var(--green)",fontSize:12,fontWeight:700,padding:"8px 0"}}>Sin acciones ESG urgentes en el periodo.</div>
                      ) : (
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:8}}>
                          {accionesCo2.slice(0,6).map((a,i)=>(
                            <div key={`${a.type}-${i}`} style={{border:`1px solid ${accionColor(a.severity)}44`,background:`${accionColor(a.severity)}0f`,borderRadius:8,padding:"10px 11px"}}>
                              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
                                <div style={{fontSize:13,fontWeight:900,color:"var(--text)",lineHeight:1.25}}>{a.title}</div>
                                <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:accionColor(a.severity)}}>{a.severity || "info"}</span>
                              </div>
                              <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.35,marginTop:6}}>{a.description}</div>
                              <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.35,marginTop:7,fontWeight:700}}>{a.recommendation}</div>
                              {Array.isArray(a.items) && a.items.length > 0 && (
                                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8}}>
                                  {a.items.slice(0,4).map(item=>(
                                    <span key={item.id || item.numero} style={{fontSize:10,color:"var(--text4)",background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:999,padding:"2px 7px"}}>
                                      {item.numero || "Pedido"}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(360px,1fr))", gap:12 }}>
                      <div style={S.card}>
                        <div style={S.sec}>CO2 POR CLIENTE</div>
                        {porCliente.length===0
                          ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0", textAlign:"center" }}>Sin datos de clientes.</div>
                          : porCliente.slice(0,10).map((c,i)=>(
                            <div key={c.id||i} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, padding:"8px 0", borderBottom:i<Math.min(porCliente.length,10)-1?"1px solid var(--border)":"none" }}>
                              <div>
                                <div style={{ fontSize:13, fontWeight:800, color:"var(--text)" }}>{c.nombre}</div>
                                <div style={{ fontSize:11, color:"var(--text5)" }}>{c.pedidos} viaje{c.pedidos!==1?"s":""} - {fmtN(c.km_total)} km - vacio {c.pct_km_vacio==null?"-":`${fmt2(c.pct_km_vacio)}%`}</div>
                              </div>
                              <div style={{ textAlign:"right", fontFamily:"'JetBrains Mono',monospace" }}>
                                <div style={{ fontSize:14, fontWeight:900, color:"var(--green)" }}>{fmt2(c.co2_t)} t</div>
                                <div style={{ fontSize:10, color:"var(--text5)" }}>{c.co2_kg_km==null?"-":`${fmt2(c.co2_kg_km)} kg/km`}</div>
                              </div>
                            </div>
                          ))
                        }
                      </div>

                      <div style={S.card}>
                        <div style={S.sec}>CO2 POR VEHICULO</div>
                        {porVehiculo.length===0
                          ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0", textAlign:"center" }}>Sin vehiculos con kilometros.</div>
                          : porVehiculo.slice(0,10).map((v,i)=>(
                            <div key={v.id||i} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, padding:"8px 0", borderBottom:i<Math.min(porVehiculo.length,10)-1?"1px solid var(--border)":"none" }}>
                              <div>
                                <div style={{ fontSize:13, fontWeight:800, color:"var(--text)", fontFamily:"'JetBrains Mono',monospace" }}>{v.nombre}</div>
                                <div style={{ fontSize:11, color:"var(--text5)" }}>{v.pedidos} viaje{v.pedidos!==1?"s":""} - {fmtN(v.km_total)} km - {fmt2(v.litros_estimados)} L</div>
                              </div>
                              <div style={{ textAlign:"right", fontFamily:"'JetBrains Mono',monospace" }}>
                                <div style={{ fontSize:14, fontWeight:900, color:"var(--green)" }}>{fmt2(v.co2_t)} t</div>
                                <div style={{ fontSize:10, color:Number(v.pct_km_vacio||0)>25?"var(--red)":"var(--text5)" }}>{v.pct_km_vacio==null?"-":`${fmt2(v.pct_km_vacio)}% vacio`}</div>
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>

                    <div style={S.card}>
                      <div style={S.sec}>RUTAS CON MAYOR HUELLA</div>
                      {porRuta.length===0
                        ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0", textAlign:"center" }}>Sin rutas con datos.</div>
                        : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr>{["Ruta","Viajes","KM","CO2","CO2/km","KM vacio"].map(h=>(
                              <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                            ))}</tr></thead>
                            <tbody>
                              {porRuta.slice(0,12).map((r,i)=>(
                                <tr key={r.id||i}>
                                  <td style={{ padding:"9px 10px", fontSize:12, fontWeight:700, color:"var(--text)", borderBottom:"1px solid var(--border)" }}>{r.nombre}</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>{r.pedidos}</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmtN(r.km_total)} km</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, fontWeight:900, color:"var(--green)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(r.co2_t)} t</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{r.co2_kg_km==null?"-":`${fmt2(r.co2_kg_km)} kg/km`}</td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:Number(r.pct_km_vacio||0)>25?"var(--red)":"var(--text4)", borderBottom:"1px solid var(--border)" }}>{r.pct_km_vacio==null?"-":`${fmt2(r.pct_km_vacio)}%`}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      }
                    </div>

                    {pendientesKm.length > 0 && (
                      <div style={{ ...S.card, border:"1px solid rgba(239,68,68,.22)", background:"rgba(239,68,68,.04)" }}>
                        <div style={S.sec}>VIAJES SIN KM PARA CO2</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                          {pendientesKm.slice(0,16).map(p=>(
                            <span key={p.id} style={{ fontSize:11, color:"#fca5a5", background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.18)", borderRadius:999, padding:"3px 8px" }}>
                              {p.numero || "Pedido"} - {p.cliente}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* RENTABILIDAD */}
          {tab==="rentabilidad" && (
            <div>
              {(() => {
                const data = rentabilidadOperativa || {};
                const resumen = data.resumen || {};
                const riesgos = Array.isArray(data.riesgos) ? data.riesgos : [];
                const porCliente = Array.isArray(data.por_cliente) ? data.por_cliente : [];
                const saludColor = resumen.salud==="critica" ? "var(--red)" : resumen.salud==="alerta" ? "#f59e0b" : "var(--green)";
                const datosIncompletos = Number(resumen.sin_precio||0) + Number(resumen.sin_km||0);
                return (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10, marginBottom:16 }}>
                      {[
                        { l:"Ingreso previsto", v:`${fmt2(resumen.ingreso)} EUR`, c:"var(--green)" },
                        { l:"Coste previsto", v:`${fmt2(resumen.coste)} EUR`, c:"var(--red)" },
                        { l:"Margen", v:`${fmt2(resumen.margen)} EUR`, c:Number(resumen.margen||0)>=0?"var(--green)":"var(--red)" },
                        { l:"Margen %", v:resumen.margen_pct==null?"-":`${fmt2(resumen.margen_pct)}%`, c:saludColor },
                        { l:"EUR/km", v:resumen.eur_km==null?"-":`${fmt2(resumen.eur_km)} EUR/km`, c:"var(--accent-xl)" },
                        { l:"Datos incompletos", v:datosIncompletos, c:datosIncompletos>0?"#f59e0b":"var(--green)" },
                      ].map((k,i)=>(
                        <div key={i} style={S.card}>
                          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:800, color:k.c }}>{k.v}</div>
                          <div style={{ fontSize:10, color:"var(--text5)", marginTop:4, fontWeight:700, textTransform:"uppercase" }}>{k.l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={S.card}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div style={S.sec}>RIESGOS ECONOMICOS Y DOCUMENTALES</div>
                        <div style={{ fontSize:11, color:"var(--text4)" }}>
                          {Number(resumen.margen_bajo||0)} margen bajo - {Number(resumen.pod_pendiente||0)} POD pendiente - {Number(resumen.cobro_vencido||0)} cobro vencido
                        </div>
                      </div>
                      {riesgos.length===0
                        ? <div style={{ color:"var(--green)", fontSize:12, padding:"14px 0", fontWeight:700 }}>Sin riesgos relevantes en el periodo seleccionado.</div>
                        : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr>{["Pedido","Cliente","Ruta","Ingreso","Coste","Margen","Riesgo","Recomendacion"].map(h=>(
                              <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                            ))}</tr></thead>
                            <tbody>
                              {riesgos.slice(0,18).map((p,i)=>{
                                const color = Number(p.margen||0)<0 ? "var(--red)" : p.margen_pct!=null && Number(p.margen_pct)<8 ? "#f59e0b" : "var(--green)";
                                return (
                                  <tr key={p.id||i}>
                                    <td style={{ padding:"9px 10px", fontSize:12, fontWeight:800, color:"var(--accent-xl)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{p.numero||"-"}</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text)", borderBottom:"1px solid var(--border)" }}>{p.cliente||"-"}</td>
                                    <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text4)", borderBottom:"1px solid var(--border)" }}>{[p.origen,p.destino].filter(Boolean).join(" - ") || "-"}</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, color:"var(--green)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(p.ingreso)} EUR</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, color:"var(--red)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(p.coste)} EUR</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, fontWeight:800, color, borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(p.margen)} EUR</td>
                                    <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                                        {(p.riesgos||[]).slice(0,3).map((r,idx)=>(
                                          <span key={idx} style={{ fontSize:10, fontWeight:700, color:r.severidad==="critica"?"var(--red)":r.severidad==="alta"?"#f59e0b":"var(--text4)", background:"var(--bg4)", border:"1px solid var(--border)", borderRadius:6, padding:"2px 6px" }}>
                                            {r.label||r.tipo}
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                    <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text3)", borderBottom:"1px solid var(--border)", maxWidth:260 }}>{p.recomendacion}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )
                      }
                    </div>

                    <div style={S.card}>
                      <div style={S.sec}>CLIENTES A REVISAR POR MARGEN</div>
                      {porCliente.length===0
                        ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0", textAlign:"center" }}>Sin datos de clientes en el periodo.</div>
                        : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr>{["Cliente","Pedidos","Ingreso","Coste","Margen","Margen %","Pedidos con riesgo"].map(h=>(
                              <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                            ))}</tr></thead>
                            <tbody>
                              {porCliente.map((c,i)=>{
                                const color = Number(c.margen||0)<0 ? "var(--red)" : c.margen_pct!=null && Number(c.margen_pct)<8 ? "#f59e0b" : "var(--green)";
                                return (
                                  <tr key={i}>
                                    <td style={{ padding:"9px 10px", fontSize:13, fontWeight:700, color:"var(--text)", borderBottom:"1px solid var(--border)" }}>{c.cliente}</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>{c.pedidos}</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, color:"var(--green)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.ingreso)} EUR</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, color:"var(--red)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.coste)} EUR</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, fontWeight:800, color, borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.margen)} EUR</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, fontWeight:700, color, borderBottom:"1px solid var(--border)" }}>{c.margen_pct==null?"-":`${fmt2(c.margen_pct)}%`}</td>
                                    <td style={{ padding:"9px 10px", fontSize:12, color:Number(c.riesgos||0)>0?"#f59e0b":"var(--text4)", borderBottom:"1px solid var(--border)" }}>{c.riesgos}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )
                      }
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* RETORNOS */}
          {tab==="retornos" && (
            <div>
              {(() => {
                const data = cargasRetorno || {};
                const resumen = data.resumen || {};
                const oportunidades = Array.isArray(data.oportunidades) ? data.oportunidades : [];
                const sinRetorno = Array.isArray(data.sin_retorno) ? data.sin_retorno : [];
                const zonas = Array.isArray(data.zonas_demanda) ? data.zonas_demanda : [];
                const carriers = Array.isArray(data.carriers_recomendados) ? data.carriers_recomendados : [];
                const solicitudes = Array.isArray(data.solicitudes_recientes) ? data.solicitudes_recientes : [];
                const carrierPreferente = carriers.find(c => c.status === "apto") || carriers.find(c => c.status === "condicionado") || carriers[0];
                const carrierColor = status => status === "apto" ? "var(--green)" : status === "condicionado" ? "#f59e0b" : "var(--red)";
                return (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10, marginBottom:16 }}>
                      {[
                        { l:"Oportunidades", v:resumen.oportunidades || 0, c:"var(--green)" },
                        { l:"Prioridad alta", v:resumen.alta || 0, c:(resumen.alta||0)>0?"#f59e0b":"var(--text4)" },
                        { l:"KM vacio evitable", v:`${fmtN(resumen.km_vacio_evitable || 0)} km`, c:"var(--accent-xl)" },
                        { l:"Sin retorno", v:resumen.pedidos_sin_retorno || 0, c:(resumen.pedidos_sin_retorno||0)>0?"var(--red)":"var(--green)" },
                        { l:"Zonas con demanda", v:resumen.zonas_con_demanda || 0, c:"#8b5cf6" },
                        { l:"Carriers aptos", v:resumen.carriers_aptos || 0, c:"var(--green)" },
                        { l:"Solicitudes enviadas", v:resumen.solicitudes_enviadas || 0, c:"var(--accent-xl)" },
                      ].map((k,i)=>(
                        <div key={i} style={S.card}>
                          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:800, color:k.c }}>{k.v}</div>
                          <div style={{ fontSize:10, color:"var(--text5)", marginTop:4, fontWeight:700, textTransform:"uppercase" }}>{k.l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={S.card}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div>
                          <div style={S.sec}>CARGAS DE RETORNO DETECTADAS</div>
                          <div style={{ fontSize:11, color:"var(--text4)", marginTop:-4 }}>
                            {data.reglas?.criterio || "Coincidencia de destino descargado con origen de pedidos proximos."}
                          </div>
                        </div>
                        <span style={{ fontSize:10, fontWeight:900, textTransform:"uppercase", color:"var(--accent-xl)" }}>
                          {data.reglas?.estado || "red interna"}
                        </span>
                      </div>
                      {oportunidades.length===0
                        ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin coincidencias de retorno en el periodo.</div>
                        : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr>{["Prioridad","Camion disponible","Pedido retorno","Espera","Impacto","Accion"].map(h=>(
                              <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                            ))}</tr></thead>
                            <tbody>
                              {oportunidades.slice(0,18).map((o,i)=>{
                                const selectedCarrierId = carrierRetornoPorOportunidad[o.id] || carrierPreferente?.id || "";
                                const selectedCarrier = carriers.find(c => c.id === selectedCarrierId) || carrierPreferente;
                                return (
                                <tr key={o.id||i}>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <div style={{ fontSize:16, fontWeight:900, color:o.prioridad==="alta"?"#f59e0b":o.prioridad==="media"?"var(--accent-xl)":"var(--text4)", fontFamily:"'JetBrains Mono',monospace" }}>{o.score}</div>
                                    <div style={{ fontSize:10, color:"var(--text5)", textTransform:"uppercase", fontWeight:800 }}>{o.prioridad}</div>
                                  </td>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <div style={{ fontSize:12, fontWeight:800, color:"var(--text)" }}>{o.base?.matricula || "Sin matricula"} - {o.base?.numero || "-"}</div>
                                    <div style={{ fontSize:11, color:"var(--text4)" }}>{o.base?.cliente || "-"} | descarga {o.base?.destino || "-"}</div>
                                  </td>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <div style={{ fontSize:12, fontWeight:800, color:"var(--accent-xl)", fontFamily:"'JetBrains Mono',monospace" }}>{o.candidato?.numero || "-"}</div>
                                    <div style={{ fontSize:11, color:"var(--text4)" }}>{o.candidato?.origen || "-"} -> {o.candidato?.destino || "-"}</div>
                                    <div style={{ fontSize:10, color:"var(--text5)" }}>{o.candidato?.cliente || "-"}</div>
                                  </td>
                                  <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>{o.espera_dias} dia(s)</td>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <div style={{ fontSize:12, fontWeight:800, color:"var(--green)" }}>{fmtN(o.impacto?.km_vacio_evitable || 0)} km vacio</div>
                                    <div style={{ fontSize:10, color:"var(--text5)" }}>Margen retorno {fmt2(o.impacto?.margen_candidato || 0)} EUR</div>
                                  </td>
                                  <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                                      <button onClick={()=>abrirRetornoEnTrafico(o)}
                                        style={{ ...S.btn, background:"var(--accent)", color:"#fff", padding:"6px 10px", fontSize:11 }}>
                                        Revisar en trafico
                                      </button>
                                      {!!carriers.length && (
                                        <select
                                          value={selectedCarrierId}
                                          onChange={e=>setCarrierRetornoPorOportunidad(prev => ({ ...prev, [o.id]: e.target.value }))}
                                          style={{ ...S.inp, width:190, padding:"5px 8px", fontSize:11 }}
                                        >
                                          {carriers.map(c=>(
                                            <option key={c.id} value={c.id}>{c.nombre} - {c.status}</option>
                                          ))}
                                        </select>
                                      )}
                                      {selectedCarrier && (
                                        <button onClick={()=>prepararSolicitudCarrier(o, selectedCarrier)}
                                          style={{ ...S.btn, background:"rgba(16,185,129,.12)", color:"var(--green)", border:"1px solid rgba(16,185,129,.25)", padding:"6px 10px", fontSize:11 }}>
                                          Solicitud carrier
                                        </button>
                                      )}
                                    </div>
                                    <div style={{ fontSize:10, color:"var(--text4)", marginTop:5, maxWidth:220 }}>{o.accion}</div>
                                  </td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )
                      }
                    </div>

                    <div style={S.card}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div>
                          <div style={S.sec}>CARRIERS / COLABORADORES PARA RETORNOS</div>
                          <div style={{ fontSize:11, color:"var(--text4)", marginTop:-4 }}>
                            Proveedores filtrados por datos maestros, documentos, vehiculos, calidad y liquidacion.
                          </div>
                        </div>
                        <div style={{ fontSize:11, color:"var(--text5)", fontWeight:800 }}>
                          {resumen.carriers_condicionados || 0} condicionados - {resumen.carriers_bloqueados || 0} bloqueados
                        </div>
                      </div>
                      {carriers.length===0
                        ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0", textAlign:"center" }}>Sin carriers registrados para recomendar.</div>
                        : (
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))", gap:8 }}>
                            {carriers.slice(0,8).map(c=>(
                              <div key={c.id} style={{ border:`1px solid ${carrierColor(c.status)}44`, background:`${carrierColor(c.status)}0f`, borderRadius:8, padding:"10px 11px" }}>
                                <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"flex-start" }}>
                                  <div>
                                    <div style={{ fontSize:13, fontWeight:900, color:"var(--text)" }}>{c.nombre}</div>
                                    <div style={{ fontSize:10, color:carrierColor(c.status), fontWeight:900, textTransform:"uppercase", marginTop:3 }}>{c.label}</div>
                                  </div>
                                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:900, color:carrierColor(c.status) }}>{c.score}</div>
                                </div>
                                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginTop:9 }}>
                                  {[
                                    ["Veh.", c.vehiculos || 0, Number(c.vehiculos_doc_riesgo||0)>0],
                                    ["Docs", c.documentos || 0, Number(c.docs_caducados||0)>0],
                                    ["Inc.", c.incidencias || 0, Number(c.incidencias||0)>0],
                                  ].map(([l,v,w])=>(
                                    <div key={l} style={{ background:"var(--bg4)", border:"1px solid var(--border)", borderRadius:7, padding:"5px 6px" }}>
                                      <div style={{ fontSize:12, fontWeight:900, color:w?"#f59e0b":"var(--text)" }}>{v}</div>
                                      <div style={{ fontSize:9, color:"var(--text5)", fontWeight:800, textTransform:"uppercase" }}>{l}</div>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ fontSize:11, color:"var(--text4)", lineHeight:1.35, marginTop:8 }}>{c.next_action}</div>
                              </div>
                            ))}
                          </div>
                        )
                      }
                    </div>

                    {solicitudRetorno?.solicitud && (
                      <div style={{ ...S.card, borderColor: solicitudRetorno.ready ? "rgba(16,185,129,.30)" : "rgba(249,115,22,.35)" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start", marginBottom:10 }}>
                          <div>
                            <div style={S.sec}>{solicitudRetorno.email ? "SOLICITUD ENVIADA A CARRIER" : "SOLICITUD PREPARADA PARA CARRIER"}</div>
                            <div style={{ fontSize:12, color:"var(--text3)" }}>
                              {solicitudRetorno.carrier?.nombre || "Carrier"} - {solicitudRetorno.solicitud.destinatario || "sin destinatario"}
                            </div>
                          </div>
                          <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
                            <button
                              onClick={enviarSolicitudCarrier}
                              disabled={!solicitudRetorno.ready || enviandoSolicitudRetorno || !!solicitudRetorno.email}
                              style={{ ...S.btn, background:(!solicitudRetorno.ready || solicitudRetorno.email)?"var(--bg4)":"var(--green)", color:(!solicitudRetorno.ready || solicitudRetorno.email)?"var(--text5)":"#fff", border:"1px solid var(--border)", padding:"6px 10px", opacity:enviandoSolicitudRetorno ? .6 : 1 }}
                            >
                              {enviandoSolicitudRetorno ? "Enviando..." : solicitudRetorno.email ? "Enviada" : "Enviar solicitud"}
                            </button>
                            <button onClick={()=>setSolicitudRetorno(null)} style={{ ...S.btn, background:"transparent", color:"var(--text4)", border:"1px solid var(--border)", padding:"5px 9px" }}>Cerrar</button>
                          </div>
                        </div>
                        {solicitudRetorno.email && (
                          <div style={{ background:"rgba(16,185,129,.08)", border:"1px solid rgba(16,185,129,.22)", borderRadius:8, padding:"8px 10px", color:"var(--green)", fontSize:11, marginBottom:8 }}>
                            Estado email: {solicitudRetorno.email.estado}{solicitudRetorno.email.message_id ? ` - ${solicitudRetorno.email.message_id}` : ""}
                          </div>
                        )}
                        {!!solicitudRetorno.bloqueantes?.length && (
                          <div style={{ background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.22)", borderRadius:8, padding:"8px 10px", color:"var(--red)", fontSize:11, marginBottom:8 }}>
                            {solicitudRetorno.bloqueantes.join(" | ")}
                          </div>
                        )}
                        {!!solicitudRetorno.avisos?.length && (
                          <div style={{ background:"rgba(245,158,11,.08)", border:"1px solid rgba(245,158,11,.22)", borderRadius:8, padding:"8px 10px", color:"#f59e0b", fontSize:11, marginBottom:8 }}>
                            {solicitudRetorno.avisos.join(" | ")}
                          </div>
                        )}
                        <div style={{ fontSize:11, color:"var(--text5)", fontWeight:800, textTransform:"uppercase", marginBottom:4 }}>Asunto</div>
                        <input
                          value={solicitudRetorno.solicitud.asunto || ""}
                          onChange={e=>setSolicitudRetorno(s => ({ ...s, solicitud:{ ...s.solicitud, asunto:e.target.value } }))}
                          disabled={!!solicitudRetorno.email}
                          style={{ ...S.inp, marginBottom:8, fontWeight:800 }}
                        />
                        <div style={{ fontSize:11, color:"var(--text5)", fontWeight:800, textTransform:"uppercase", marginBottom:4 }}>Cuerpo</div>
                        <textarea
                          value={solicitudRetorno.solicitud.cuerpo || ""}
                          onChange={e=>setSolicitudRetorno(s => ({ ...s, solicitud:{ ...s.solicitud, cuerpo:e.target.value } }))}
                          disabled={!!solicitudRetorno.email}
                          style={{ ...S.inp, minHeight:180, resize:"vertical", fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}
                        />
                      </div>
                    )}

                    <div style={S.card}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                        <div>
                          <div style={S.sec}>SOLICITUDES RECIENTES A CARRIERS</div>
                          <div style={{ fontSize:11, color:"var(--text4)", marginTop:-4 }}>
                            Trazabilidad de disponibilidad enviada para retornos y subcontratacion controlada.
                          </div>
                        </div>
                        <span style={{ fontSize:10, fontWeight:900, textTransform:"uppercase", color:"var(--text5)" }}>
                          {solicitudes.length} registros
                        </span>
                      </div>
                      {solicitudes.length===0
                        ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0", textAlign:"center" }}>Todavia no hay solicitudes enviadas en el periodo.</div>
                        : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr>{["Fecha","Pedido","Carrier","Ruta","Estado","Accion"].map(h=>(
                              <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                            ))}</tr></thead>
                            <tbody>
                              {solicitudes.slice(0,10).map(s=>{
                                const terminal = ["asignada","descartada"].includes(String(s.estado || ""));
                                const colorEstado = s.estado === "asignada" ? "var(--green)" : s.estado === "descartada" ? "var(--red)" : s.estado === "respondida" ? "var(--accent-xl)" : s.simulado ? "#f59e0b" : "var(--green)";
                                return (
                                  <tr key={s.id}>
                                    <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text4)", borderBottom:"1px solid var(--border)" }}>
                                      {s.sent_at ? new Date(s.sent_at).toLocaleString("es-ES") : "-"}
                                    </td>
                                    <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                      <div style={{ fontSize:12, fontWeight:900, color:"var(--accent-xl)", fontFamily:"'JetBrains Mono',monospace" }}>{s.pedido_numero || "-"}</div>
                                      {!!s.base_pedido_numero && <div style={{ fontSize:10, color:"var(--text5)" }}>Base {s.base_pedido_numero}</div>}
                                    </td>
                                    <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                      <div style={{ fontSize:12, fontWeight:800, color:"var(--text)" }}>{s.carrier_nombre || "-"}</div>
                                      <div style={{ fontSize:10, color:"var(--text5)" }}>{s.destinatario || "-"}</div>
                                    </td>
                                    <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text3)", borderBottom:"1px solid var(--border)", maxWidth:260 }}>
                                      {s.ruta || "-"}
                                      {!!s.notas && <div style={{ fontSize:10, color:"var(--text5)", marginTop:3 }}>{s.notas}</div>}
                                    </td>
                                    <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                      <span style={{ fontSize:10, fontWeight:900, textTransform:"uppercase", color:colorEstado, background:`${colorEstado}14`, border:`1px solid ${colorEstado}44`, borderRadius:999, padding:"3px 8px" }}>
                                        {s.simulado && s.estado === "simulada" ? "Simulada" : (s.estado || "Enviada")}
                                      </span>
                                      {!!s.pedido_asignado_a_carrier && (
                                        <div style={{ fontSize:10, color:"var(--green)", fontWeight:800, marginTop:5 }}>
                                          Pedido asignado{s.pedido_asignado_at ? ` - ${new Date(s.pedido_asignado_at).toLocaleString("es-ES")}` : ""}
                                        </div>
                                      )}
                                      {!!s.responded_at && <div style={{ fontSize:10, color:"var(--text5)", marginTop:4 }}>{new Date(s.responded_at).toLocaleString("es-ES")}</div>}
                                    </td>
                                    <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                                      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                                        {["respondida","asignada","descartada"].map(estado => (
                                          <button
                                            key={estado}
                                            disabled={terminal || actualizandoSolicitudRetorno === `${s.id}:${estado}`}
                                            onClick={()=>marcarSolicitudRetorno(s.id, estado)}
                                            style={{ ...S.btn, padding:"4px 7px", fontSize:10, border:"1px solid var(--border)", background:terminal?"var(--bg4)":"transparent", color:terminal?"var(--text5)":"var(--text3)" }}
                                          >
                                            {estado === "respondida" ? "Respondida" : estado === "asignada" ? "Asignar" : "Descartar"}
                                          </button>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )
                      }
                    </div>

                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                      <div style={S.card}>
                        <div style={S.sec}>CAMIONES / VIAJES SIN RETORNO</div>
                        {sinRetorno.length===0
                          ? <div style={{ color:"var(--green)", fontSize:12, padding:"14px 0", fontWeight:700 }}>No hay retornos pendientes destacados.</div>
                          : sinRetorno.slice(0,8).map((item,i)=>(
                            <div key={item.pedido_id||i} style={{ padding:"9px 0", borderBottom:i===Math.min(sinRetorno.length,8)-1?"none":"1px solid var(--border)" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
                                <div style={{ fontSize:12, fontWeight:800, color:"var(--text)" }}>{item.matricula || "Sin matricula"} - {item.numero}</div>
                                <div style={{ fontSize:11, fontWeight:900, color:"var(--red)", fontFamily:"'JetBrains Mono',monospace" }}>{fmtN(item.km_vacio)} km</div>
                              </div>
                              <div style={{ fontSize:11, color:"var(--text4)" }}>{item.destino || "-"} | {item.cliente || "-"}</div>
                              <div style={{ fontSize:10, color:"var(--text5)", marginTop:3 }}>{item.recomendacion}</div>
                            </div>
                          ))}
                      </div>
                      <div style={S.card}>
                        <div style={S.sec}>ZONAS CON DEMANDA SIN ASIGNAR</div>
                        {zonas.length===0
                          ? <div style={{ color:"var(--text5)", fontSize:12, padding:"14px 0" }}>Sin zonas calientes en el periodo.</div>
                          : zonas.slice(0,8).map((z,i)=>(
                            <div key={i} style={{ padding:"9px 0", borderBottom:i===Math.min(zonas.length,8)-1?"none":"1px solid var(--border)" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
                                <div style={{ fontSize:12, fontWeight:800, color:"var(--text)" }}>{z.zona || "-"}</div>
                                <div style={{ fontSize:11, color:"var(--accent-xl)", fontWeight:900 }}>{z.pedidos} pedido(s)</div>
                              </div>
                              <div style={{ fontSize:11, color:"var(--text4)" }}>Proxima carga: {z.proxima_carga ? new Date(z.proxima_carga).toLocaleDateString("es-ES") : "-"}</div>
                              <div style={{ fontSize:10, color:"var(--green)", marginTop:3 }}>Margen estimado {fmt2(z.margen_estimado || 0)} EUR</div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* RUTAS */}
          {tab==="rutas" && (
            <div>
              <div style={S.card}>
                <div style={S.sec}>RUTAS MÁS RENTABLES</div>
                {topRutas.length===0
                  ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin datos de rutas en el período</div>
                  : <>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={topRutas} layout="vertical" margin={{left:10,right:10}}>
                        <XAxis type="number" tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false}
                          tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
                        <YAxis type="category" dataKey="name" tick={{fontSize:10,fill:"var(--text3)"}} axisLine={false} tickLine={false} width={160}/>
                        <Tooltip contentStyle={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}}
                          formatter={v=>[`${fmt2(v)} €`,"Importe"]}/>
                        <Bar dataKey="importe" fill="var(--accent-l)" radius={[0,4,4,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                    <table style={{ width:"100%", borderCollapse:"collapse", marginTop:12 }}>
                      <thead><tr>{["Ruta","Viajes","Importe total","Rentabilidad/viaje"].map(h=>(
                        <th key={h} style={{ textAlign:"left", padding:"7px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {topRutas.map((r,i)=>(
                          <tr key={i}>
                            <td style={{ padding:"8px 10px", fontSize:12, fontWeight:600, color:"var(--text)", borderBottom:"1px solid var(--border)" }}>{r.name}</td>
                            <td style={{ padding:"8px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{r.viajes}</td>
                            <td style={{ padding:"8px 10px", fontSize:13, fontWeight:700, color:"var(--text)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(r.importe)} €</td>
                            <td style={{ padding:"8px 10px", fontSize:12, color:"var(--green)", fontWeight:700, borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(r.rentabilidad)} €</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                }
              </div>
            </div>
          )}

          {/* FLOTA */}
          {tab==="flota" && (
            <div>
              <div style={S.card}>
                <div style={S.sec}>RENTABILIDAD POR VEHÍCULO</div>
                {flotaStats.length===0
                  ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin datos</div>
                  : (
                    <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <thead><tr>{["Matrícula","Clase","Ingresos","Costes taller","Margen","Viajes","KM"].map(h=>(
                        <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {flotaStats.map((v,i)=>(
                          <tr key={i}>
                            <td style={{ padding:"9px 10px", fontSize:13, fontWeight:700, color:"var(--accent-xl)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{v.matricula}</td>
                            <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text4)", borderBottom:"1px solid var(--border)" }}>{v.clase||"-"}</td>
                            <td style={{ padding:"9px 10px", fontSize:13, fontWeight:700, color:"var(--green)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(v.ingresos)} €</td>
                            <td style={{ padding:"9px 10px", fontSize:12, color:"var(--red)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(v.costes)} €</td>
                            <td style={{ padding:"9px 10px", fontWeight:700, borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace", color:v.margen>=0?"var(--green)":"var(--red)" }}>{fmt2(v.margen)} €</td>
                            <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>{v.viajes}</td>
                            <td style={{ padding:"9px 10px", fontSize:11, color:"var(--text4)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmtN(v.km)} km</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                }
              </div>
            </div>
          )}

          {/* CHÓFERES */}
          {tab==="choferes" && (
            <div>
              <div style={S.card}>
                <div style={S.sec}>RENDIMIENTO POR CHÓFER</div>
                {choferesStats.length===0
                  ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin datos</div>
                  : (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={choferesStats.slice(0,8)}>
                          <XAxis dataKey="nombre" tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false}
                            tickFormatter={v=>v.length>10?v.slice(0,10)+"...":v}/>
                          <YAxis tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false} width={50}
                            tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                          <Tooltip contentStyle={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}}
                            formatter={v=>[`${fmt2(v)} €`,"Ingresos"]}/>
                          <Bar dataKey="ingresos" fill="#8b5cf6" radius={[3,3,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                      <table style={{ width:"100%", borderCollapse:"collapse", marginTop:12 }}>
                        <thead><tr>{["Chófer","Viajes","Entregas","Ingresos generados"].map(h=>(
                          <th key={h} style={{ textAlign:"left", padding:"7px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                        ))}</tr></thead>
                        <tbody>
                          {choferesStats.map((c,i)=>(
                            <tr key={i}>
                              <td style={{ padding:"9px 10px", fontSize:13, fontWeight:600, color:"var(--text)", borderBottom:"1px solid var(--border)" }}>{c.nombre}</td>
                              <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>{c.viajes}</td>
                              <td style={{ padding:"9px 10px", fontSize:12, color:"var(--green)", borderBottom:"1px solid var(--border)" }}>{c.entregas}</td>
                              <td style={{ padding:"9px 10px", fontSize:13, fontWeight:700, color:"var(--text)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(c.ingresos)} €</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )
                }
              </div>
            </div>
          )}

          {/* COSTES TALLER */}
          {tab==="costes" && (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
                {[
                  { l:"Coste período",     v:`${fmt2(costeTaller)} €`,            c:"var(--red)" },
                  { l:"Intervenciones",    v:repFilt.length,                       c:"var(--text)" },
                  { l:"Valor stock actual",v:`${fmt2(taller.stock.reduce((s,p)=>s+(p.stock_actual||0)*(p.precio_unitario||0),0))} €`, c:"#f59e0b" },
                ].map((k,i)=>(
                  <div key={i} style={S.card}>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:800, color:k.c }}>{k.v}</div>
                    <div style={{ fontSize:10, color:"var(--text5)", marginTop:4, fontWeight:700, textTransform:"uppercase" }}>{k.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div style={S.card}>
                  <div style={S.sec}>COSTE MENSUAL TALLER</div>
                  {costeMensualTaller.length===0
                    ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin datos</div>
                    : <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={costeMensualTaller}>
                          <XAxis dataKey="name" tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false}/>
                          <YAxis tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false} width={50}/>
                          <Tooltip contentStyle={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}}
                            formatter={v=>[`${fmt2(v)} €`,"Coste"]}/>
                          <Bar dataKey="coste" fill="var(--red)" radius={[3,3,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                  }
                </div>
                <div style={S.card}>
                  <div style={S.sec}>COSTES POR TIPO</div>
                  {costesCat.length===0
                    ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin datos</div>
                    : costesCat.map((c,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", marginBottom:8, alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:8, height:8, borderRadius:"50%", background:COLORS[i%COLORS.length] }}/>
                          <span style={{ fontSize:12, color:"var(--text2)" }}>{c.name}</span>
                        </div>
                        <span style={{ fontSize:12, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:"var(--red)" }}>{fmt2(c.value)} €</span>
                      </div>
                    ))
                  }
                </div>
              </div>
              {/* Stock bajo mínimo */}
              {taller.stock.filter(s=>(s.stock_actual||0)<=(s.stock_minimo||0)).length > 0 && (
                <div style={{ ...S.card, border:"1px solid rgba(249,115,22,.3)", background:"rgba(249,115,22,.04)" }}>
                  <div style={{ ...S.sec, color:"#f97316" }}>STOCK BAJO MÍNIMO</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {taller.stock.filter(s=>(s.stock_actual||0)<=(s.stock_minimo||0)).map((s,i)=>(
                      <span key={i} style={{ background:"rgba(249,115,22,.1)", border:"1px solid rgba(249,115,22,.2)", borderRadius:8, padding:"4px 12px", fontSize:11, color:"#f97316", fontWeight:600 }}>
                        {s.nombre} - {s.stock_actual} ud. (mín: {s.stock_minimo})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* KPI AVANZADO */}
          {tab==="kpi_avanzado" && (
            <div>
              {/* €/km by vehicle */}
              <div style={S.card}>
                <div style={S.sec}>MEDIA €/KM POR VEHÍCULO (período seleccionado)</div>
                {eurosKmFlota.length===0
                  ? <div style={{ color:"var(--text5)", fontSize:12, padding:"12px 0", textAlign:"center" }}>Sin datos de KM registrados en pedidos</div>
                  : <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <thead><tr>{["Matrícula","KM cargado","KM vacío","% Vacío","€/km","Ingresos"].map(h=>(
                        <th key={h} style={{ textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {eurosKmFlota.map((v,i)=>(
                          <tr key={i}>
                            <td style={{ padding:"9px 10px", fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:"var(--accent-xl)", borderBottom:"1px solid var(--border)" }}>{v.matricula}</td>
                            <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmtN(v.kmTot)} km</td>
                            <td style={{ padding:"9px 10px", fontSize:12, color:"var(--text4)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmtN(v.kmVac)} km</td>
                            <td style={{ padding:"9px 10px", borderBottom:"1px solid var(--border)" }}>
                              <span style={{ fontSize:12, fontWeight:700, color:v.pVac>30?"var(--red)":v.pVac>15?"#f59e0b":"var(--green)" }}>{v.pVac.toFixed(1)}%</span>
                            </td>
                            <td style={{ padding:"9px 10px", fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:14, color:v.eKm>1.5?"var(--green)":v.eKm>0.8?"#f59e0b":"var(--red)", borderBottom:"1px solid var(--border)" }}>{fmt2(v.eKm)} €/km</td>
                            <td style={{ padding:"9px 10px", fontSize:13, fontWeight:700, color:"var(--text)", borderBottom:"1px solid var(--border)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(v.ingresos)} €</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                }
              </div>

              {/* Choferes avanzado: km vacio, €/km */}
              <div style={S.card}>
                <div style={S.sec}>CHÓFERES - KM VACÍO Y EFICIENCIA</div>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead><tr>{["Chófer","Viajes","KM cargado","KM vacío","% Vacío","€/km","Ingresos"].map(h=>(
                    <th key={h} style={{ textAlign:"left", padding:"7px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--text5)", borderBottom:"1px solid var(--border)" }}>{h}</th>
                  ))}</tr></thead>
                  <tbody>
                    {choferesStats.map((c,i)=>(
                      <tr key={i}>
                        <td style={{ padding:"8px 10px", fontSize:13, fontWeight:600, color:"var(--text)", borderBottom:"1px solid var(--border)" }}>{c.nombre}</td>
                        <td style={{ padding:"8px 10px", fontSize:12, color:"var(--text3)", borderBottom:"1px solid var(--border)" }}>{c.viajes}</td>
                        <td style={{ padding:"8px 10px", fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"var(--text4)", borderBottom:"1px solid var(--border)" }}>{fmtN(c.kmTotal)} km</td>
                        <td style={{ padding:"8px 10px", fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"var(--text4)", borderBottom:"1px solid var(--border)" }}>{fmtN(c.kmVacio)} km</td>
                        <td style={{ padding:"8px 10px", borderBottom:"1px solid var(--border)" }}>
                          <span style={{ fontSize:12, fontWeight:700, color:c.pctVacio>30?"var(--red)":c.pctVacio>15?"#f59e0b":"var(--green)" }}>{c.pctVacio.toFixed(1)}%</span>
                        </td>
                        <td style={{ padding:"8px 10px", fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:12, borderBottom:"1px solid var(--border)", color:c.eurosKm>1.5?"var(--green)":c.eurosKm>0?"#f59e0b":"var(--text4)" }}>{fmt2(c.eurosKm)} €/km</td>
                        <td style={{ padding:"8px 10px", fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:"var(--green)", borderBottom:"1px solid var(--border)" }}>{fmt2(c.ingresos)} €</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Taller por vehículo y por marca */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div style={S.card}>
                  <div style={S.sec}>VEHÍCULOS CON MÁS VISITAS A TALLER</div>
                  {tallerVisitas.filter(v=>v.visitas>0).slice(0,8).map((v,i)=>(
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, padding:"6px 8px", background:"var(--bg4)", borderRadius:7 }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color:"var(--text)", fontFamily:"'JetBrains Mono',monospace" }}>{v.matricula}</div>
                        <div style={{ fontSize:10, color:"var(--text5)" }}>{v.marca} - Top: {v.topTipo}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:14, fontWeight:800, color:"#f97316" }}>{v.visitas}x</div>
                        <div style={{ fontSize:10, color:"var(--red)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(v.coste)} €</div>
                      </div>
                    </div>
                  ))}
                  {tallerVisitas.filter(v=>v.visitas>0).length===0 && <div style={{ color:"var(--text5)", fontSize:12, padding:"12px 0", textAlign:"center" }}>Sin registros de taller</div>}
                </div>
                <div style={S.card}>
                  <div style={S.sec}>TALLER POR MARCA DE VEHÍCULO</div>
                  {tallerPorMarca.filter(m=>m.visitas>0).map((m,i)=>(
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:COLORS[i%COLORS.length] }}/>
                        <div>
                          <div style={{ fontSize:12, fontWeight:700, color:"var(--text)" }}>{m.marca}</div>
                          <div style={{ fontSize:10, color:"var(--text5)" }}>{m.vehiculos} vehículo{m.vehiculos!==1?"s":""}</div>
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:13, fontWeight:700, color:"#f97316" }}>{m.visitas} visita{m.visitas!==1?"s":""}</div>
                        <div style={{ fontSize:11, color:"var(--red)", fontFamily:"'JetBrains Mono',monospace" }}>{fmt2(m.coste)} €</div>
                      </div>
                    </div>
                  ))}
                  {tallerPorMarca.filter(m=>m.visitas>0).length===0 && <div style={{ color:"var(--text5)", fontSize:12, padding:"12px 0", textAlign:"center" }}>Sin visitas a taller registradas</div>}
                </div>
              </div>

              {/* Combustible price evolution */}
                {(() => {
                 const cfg = empresaCfg?.cfg_precios?.combustible || empresaCfg?.cfg_precios?.gasoil || {};
                 if (!cfg.periodos || cfg.periodos.length===0) return null;
                const chartData = cfg.periodos.map(p=>({ name:new Date(p.desde).toLocaleDateString("es-ES",{day:"2-digit",month:"short"}), precio:Number(p.precio||0) }));
                return (
                  <div style={S.card}>
                    <div style={S.sec}>EVOLUCIÓN PRECIO COMBUSTIBLE</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={chartData}>
                        <XAxis dataKey="name" tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:10,fill:"var(--text4)"}} axisLine={false} tickLine={false} width={45} domain={["auto","auto"]} tickFormatter={v=>`${v}€`}/>
                        <Tooltip contentStyle={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,fontSize:12}} formatter={v=>[`${v} €/L`,"Precio"]}/>
                        <Line type="monotone" dataKey="precio" stroke="#f59e0b" strokeWidth={2.5} dot={{fill:"#f59e0b",r:4}}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
            </div>
          )}

          {/* OBJETIVOS (solo gerente) */}
          {tab==="objetivos" && isGerente && (
            <div>
              <div style={{ ...S.card, marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <div style={S.sec}>OBJETIVOS DE FACTURACIÓN</div>
                  <button style={{ ...S.btn, background:"var(--accent)", color:"#fff" }} onClick={()=>setEditObj(!editObj)}>
                    {editObj?"Cancelar":"Editar objetivos"}
                  </button>
                </div>
                {editObj ? (
                  <div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
                      {OBJ_KEYS.map(o=>(
                        <div key={o.k}>
                          <label style={S.lbl}>{o.l}</label>
                          <input type="number" step={o.tipo==="money"?"100":"1"} style={S.inp}
                            value={objForm[o.k]||""} onChange={e=>setObjForm(p=>({...p,[o.k]:e.target.value}))}
                            placeholder={o.tipo==="money"?"0.00 €":"0"}/>
                        </div>
                      ))}
                    </div>
                    <button style={{ ...S.btn, background:"var(--green)", color:"#fff", marginTop:14 }} onClick={saveObjetivos}>
                      Guardar objetivos
                    </button>
                  </div>
                ) : (
                  <div>
                    {OBJ_KEYS.map(o=>{
                      const val = Number(objetivos[o.k]||0);
                      if (!val) return (
                        <div key={o.k} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid var(--border)" }}>
                          <span style={{ fontSize:12, color:"var(--text4)" }}>{o.l}</span>
                          <span style={{ fontSize:11, color:"var(--text5)", fontStyle:"italic" }}>Sin objetivo definido</span>
                        </div>
                      );
                      // Pick actual value based on period/key
                      const actuals = {
                        facturacion_mes:   filterItems(facturas,"fecha","30d").reduce((s,f)=>s+Number(f.total||0),0),
                        facturacion_anual: filterItems(facturas,"fecha","365d").reduce((s,f)=>s+Number(f.total||0),0),
                        cobros_mes:        filterItems(facturas,"fecha","30d").filter(f=>f.estado==="cobrada").reduce((s,f)=>s+Number(f.total||0),0),
                        viajes_mes:        filterItems(pedidos,"fecha_pedido","30d").length,
                      };
                      return <ObjetivoBar key={o.k} label={o.l} actual={actuals[o.k]||0} objetivo={val}/>;
                    })}
                  </div>
                )}
              </div>

              {/* Objetivo por camión */}
              <div style={S.card}>
                <div style={S.sec}>OBJETIVO POR CAMIÓN (facturación mensual)</div>
                {!objetivos.facturacion_por_camion ? (
                  <div style={{ fontSize:12, color:"var(--text5)", textAlign:"center", padding:"12px 0" }}>
                    Define un objetivo mensual por camión para ver el progreso.
                    {editObj===false && <span style={{ color:"var(--accent-l)", cursor:"pointer", marginLeft:6 }} onClick={()=>setEditObj(true)}>Editar objetivos</span>}
                  </div>
                ) : (
                  flotaStats.map((v,i)=>(
                    <ObjetivoBar key={i} label={`${v.matricula} - ${v.clase||v.marca}`} actual={v.ingresos} objetivo={Number(objetivos.facturacion_por_camion||0)} color={COLORS[i%COLORS.length]}/>
                  ))
                )}
                {editObj && (
                  <div style={{ marginTop:12 }}>
                    <label style={S.lbl}>Objetivo por camión (€/mes)</label>
                    <input type="number" step="100" style={S.inp}
                      value={objForm.facturacion_por_camion||""} onChange={e=>setObjForm(p=>({...p,facturacion_por_camion:e.target.value}))}/>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
