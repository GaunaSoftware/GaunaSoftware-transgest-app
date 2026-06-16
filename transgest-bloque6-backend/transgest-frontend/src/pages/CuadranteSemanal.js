import { useState, useEffect, useCallback } from "react";
import { getPedidos, getVehiculos, getChoferes } from "../services/api";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = n => Number(n||0).toLocaleString("es-ES",{maximumFractionDigits:0});
const ymd = d => d.toISOString().slice(0,10);
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate()+days); return d; };
const addYears = (date, years) => { const d = new Date(date); d.setFullYear(d.getFullYear()+years); return d; };

const EC = {
  pendiente:  { label:"Pendiente",   color:"#9ca3af", bg:"rgba(156,163,175,.13)", border:"rgba(156,163,175,.35)" },
  confirmado: { label:"Confirmado",  color:"#3b82f6", bg:"rgba(59,130,246,.13)",  border:"rgba(59,130,246,.35)"  },
  en_curso:   { label:"En Curso",    color:"#f97316", bg:"rgba(249,115,22,.14)",  border:"rgba(249,115,22,.38)"  },
  descarga:   { label:"Descargando", color:"#a78bfa", bg:"rgba(167,139,250,.13)", border:"rgba(167,139,250,.35)" },
  entregado:  { label:"Entregado",   color:"#10b981", bg:"rgba(16,185,129,.13)",  border:"rgba(16,185,129,.35)"  },
  facturado:  { label:"Facturado",   color:"#8b5cf6", bg:"rgba(139,92,246,.13)",  border:"rgba(139,92,246,.35)"  },
  cancelado:  { label:"Cancelado",   color:"#ef4444", bg:"rgba(239,68,68,.12)",   border:"rgba(239,68,68,.33)"   },
  incidencia: { label:"Incidencia",  color:"#fbbf24", bg:"rgba(251,191,36,.12)",  border:"rgba(251,191,36,.33)"  },
};

const DIAS = ["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];

function getWeekDays(anchor) {
  const d = new Date(anchor);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return Array.from({length:7}, (_,i) => {
    const dt = new Date(d);
    dt.setDate(d.getDate() + i);
    return dt;
  });
}

function Badge({ estado }) {
  const e = EC[estado] || EC.pendiente;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:20,
      background:e.bg,border:"1px solid "+e.border,fontSize:10,fontWeight:700,color:e.color,whiteSpace:"nowrap"}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:e.color,flexShrink:0,display:"inline-block"}}/>
      {e.label}
    </span>
  );
}

function TripMini({ p, onClick }) {
  const e = EC[p.estado] || EC.pendiente;
  const importe = p.estado === "cancelado" ? 0 : Number(p.importe || 0);
  return (
    <button
      onClick={onClick}
      style={{
        width:"100%",
        textAlign:"left",
        border:`1px solid ${e.border}`,
        borderLeft:`4px solid ${e.color}`,
        background:e.bg,
        borderRadius:8,
        padding:"8px 10px",
        cursor:"pointer",
        fontFamily:"'DM Sans',sans-serif",
      }}
    >
      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:900,color:e.color,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {p.numero || p.referencia_cliente || "Pedido"}
          </div>
          <div style={{fontSize:12,fontWeight:800,color:"var(--text)",marginTop:3,lineHeight:1.25,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
            {p.origen && p.destino ? `${p.origen} -> ${p.destino}` : p.origen || p.destino || "Sin ruta"}
          </div>
        </div>
        <Badge estado={p.estado}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"end",marginTop:7}}>
        <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.35}}>
          <div>{p.hora_carga || "--:--"} · {p.cliente_nombre || "Sin cliente"}</div>
          {p.chofer_nombre && <div>{p.chofer_nombre}</div>}
          {p.colaborador_nombre && <div style={{color:"#f59e0b",fontWeight:700}}>{p.colaborador_nombre}</div>}
        </div>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:900,color:importe ? "#10b981" : "var(--text5)"}}>
          {importe ? fmt2(importe) + " €" : "-"}
        </div>
      </div>
    </button>
  );
}

export default function CuadranteSemanal() {
  const [anchor,    setAnchor]    = useState(new Date());
  const [pedidos,   setPedidos]   = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [choferes,  setChoferes]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [diaFiltro, setDiaFiltro] = useState("todos"); // "todos" | "0".."6"
  const [estFiltro, setEstFiltro] = useState("todos");
  const [vehFiltro, setVehFiltro] = useState("todos");
  const [expanded,  setExpanded]  = useState(null);
  const [vista,     setVista]     = useState("recursos");
  const [cerrados,  setCerrados]  = useState({});

  const dias = getWeekDays(anchor);
  const today = new Date().toISOString().slice(0,10);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const semana = getWeekDays(anchor);
      const desde = ymd(addYears(semana[0], -1));
      const hasta = ymd(semana[6]);
      const [p, v, c] = await Promise.all([
        getPedidos({ desde, hasta, limit: 1000 }).catch(() => []),
        getVehiculos().catch(() => []),
        getChoferes().catch(() => []),
      ]);
      setPedidos(Array.isArray(p?.data) ? p.data : Array.isArray(p) ? p : []);
      setVehiculos(Array.isArray(v) ? v : []);
      setChoferes(Array.isArray(c) ? c : []);
    } finally { setLoading(false); }
  }, [anchor]);

  useEffect(() => { cargar(); }, [cargar]);

  // Pedidos de la semana
  const pedidosSemana = pedidos.filter(p => {
    if (String(p.estado || "").toLowerCase() === "cancelado") return false;
    const f = (p.fecha_carga || p.fecha_pedido || "").slice(0, 10);
    return f >= dias[0].toISOString().slice(0,10) && f <= dias[6].toISOString().slice(0,10);
  });

  // Aplicar filtros
  const pedidosFiltrados = pedidosSemana.filter(p => {
    if (estFiltro !== "todos" && p.estado !== estFiltro) return false;
    if (vehFiltro !== "todos" && p.vehiculo_id !== vehFiltro) return false;
    if (diaFiltro !== "todos") {
      const f = (p.fecha_carga || p.fecha_pedido || "").slice(0, 10);
      const diaIdx = dias[parseInt(diaFiltro)].toISOString().slice(0,10);
      if (f !== diaIdx) return false;
    }
    return true;
  });

  // KPIs semana
  const totalIngresos   = pedidosSemana.filter(p=>p.estado!=="cancelado").reduce((s,p)=>s+Number(p.importe||0),0);
  const totalEntregados = pedidosSemana.filter(p=>p.estado==="entregado"||p.estado==="facturado").length;
  const totalEnCurso    = pedidosSemana.filter(p=>p.estado==="en_curso"||p.estado==="descarga").length;
  const totalPendientes = pedidosSemana.filter(p=>p.estado==="pendiente"||p.estado==="confirmado").length;
  const totalCancelados = pedidosSemana.filter(p=>p.estado==="cancelado").length;
  const pedidosRango = (ini, fin) => pedidos.filter(p => {
    if (String(p.estado || "").toLowerCase() === "cancelado") return false;
    const f = (p.fecha_carga || p.fecha_pedido || "").slice(0,10);
    return f >= ymd(ini) && f <= ymd(fin);
  });
  const pedidosSemanaAnterior = pedidosRango(addDays(dias[0], -7), addDays(dias[6], -7));
  const pedidosAnoAnterior = pedidosRango(addYears(dias[0], -1), addYears(dias[6], -1));
  const ingresosSemanaAnterior = pedidosSemanaAnterior.filter(p=>p.estado!=="cancelado").reduce((s,p)=>s+Number(p.importe||0),0);
  const ingresosAnoAnterior = pedidosAnoAnterior.filter(p=>p.estado!=="cancelado").reduce((s,p)=>s+Number(p.importe||0),0);
  const diffLabel = (actual, anterior, suf="") => {
    if (!anterior) return "Sin datos";
    const diff = actual - anterior;
    const pct = anterior ? (diff / anterior) * 100 : 0;
    const sign = diff >= 0 ? "+" : "";
    return `${sign}${fmt2(diff)}${suf} (${sign}${pct.toFixed(1)}%)`;
  };

  // KPIs por día
  const kpiDia = dias.map(d => {
    const dStr = d.toISOString().slice(0,10);
    const ps = pedidosSemana.filter(p=>(p.fecha_carga||p.fecha_pedido||"").slice(0,10)===dStr);
    return {
      n:       ps.length,
      ingreso: ps.filter(p=>p.estado!=="cancelado").reduce((s,p)=>s+Number(p.importe||0),0),
      enCurso: ps.filter(p=>["en_curso","descarga"].includes(p.estado)).length,
    };
  });

  const fmtFecha = d => d.toLocaleDateString("es-ES",{day:"2-digit",month:"short"});
  const weekLabel = `${fmtFecha(dias[0])} — ${fmtFecha(dias[6])} ${dias[6].getFullYear()}`;

  const pedidosOrdenados = [...pedidosFiltrados].sort((a,b) => {
    const fa = `${(a.fecha_carga || a.fecha_pedido || "").slice(0,10)} ${a.hora_carga || "00:00"}`;
    const fb = `${(b.fecha_carga || b.fecha_pedido || "").slice(0,10)} ${b.hora_carga || "00:00"}`;
    return fa.localeCompare(fb);
  });
  const esRemolque = v => {
    const clase = String(v.clase || v.tipo || "").toLowerCase();
    const mat = String(v.matricula || "").toUpperCase();
    return clase.includes("remolque") || clase.includes("semirremolque") || mat.startsWith("R-") || mat.endsWith("-R");
  };
  const vehiculosConViaje = vehiculos
    .filter(v => !esRemolque(v))
    .map(v => ({
      id:`veh_${v.id}`,
      tipo:"propio",
      titulo:v.matricula || "Vehiculo",
      subtitulo:[v.marca, v.modelo].filter(Boolean).join(" "),
      viajes:pedidosOrdenados.filter(p => p.vehiculo_id === v.id && !p.colaborador_id),
    }))
    .filter(g => g.viajes.length > 0);
  const sinAsignacion = {
    id:"sin_asignacion",
    tipo:"sin",
    titulo:"Sin asignacion",
    subtitulo:"Pedidos pendientes de vehiculo, chofer o colaborador",
    viajes:pedidosOrdenados.filter(p => !p.vehiculo_id && !p.colaborador_id),
  };
  const colaboradoresMap = pedidosOrdenados
    .filter(p => p.colaborador_id || p.colaborador_nombre)
    .reduce((acc,p) => {
      const id = p.colaborador_id || p.colaborador_nombre || "colaborador";
      if (!acc[id]) {
        acc[id] = {
          id:`col_${id}`,
          tipo:"colaborador",
          titulo:p.colaborador_nombre || "Colaborador asignado",
          subtitulo:"Viajes subcontratados esta semana",
          viajes:[],
        };
      }
      acc[id].viajes.push(p);
      return acc;
    }, {});
  const gruposRecursos = [
    ...(sinAsignacion.viajes.length ? [sinAsignacion] : []),
    ...vehiculosConViaje,
    ...Object.values(colaboradoresMap).filter(g => g.viajes.length > 0),
  ];

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",padding:"20px 24px",minHeight:"100vh",background:"var(--bg)"}}>

      {/* ── Header ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,flexWrap:"wrap"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:900,color:"var(--text)"}}>
          📅 Vista Semanal
        </div>

        {/* Navegación semanas */}
        <div style={{display:"flex",gap:6,alignItems:"center",marginLeft:8}}>
          <button onClick={()=>{const d=new Date(anchor);d.setDate(d.getDate()-7);setAnchor(d);setDiaFiltro("todos");}}
            style={{padding:"4px 12px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text3)",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            ‹ Anterior
          </button>
          <button onClick={()=>{setAnchor(new Date());setDiaFiltro("todos");}}
            style={{padding:"4px 12px",borderRadius:6,border:"none",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Hoy
          </button>
          <button onClick={()=>{const d=new Date(anchor);d.setDate(d.getDate()+7);setAnchor(d);setDiaFiltro("todos");}}
            style={{padding:"4px 12px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text3)",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Siguiente ›
          </button>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,color:"var(--text)",marginLeft:4}}>{weekLabel}</span>
        </div>

        {/* Filtros */}
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={estFiltro} onChange={e=>setEstFiltro(e.target.value)}
            style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"5px 10px",borderRadius:6,fontFamily:"'DM Sans',sans-serif",fontSize:12,outline:"none"}}>
            <option value="todos">Todos los estados</option>
            {Object.entries(EC).map(([v,d])=><option key={v} value={v}>{d.label}</option>)}
          </select>
          <select value={vehFiltro} onChange={e=>setVehFiltro(e.target.value)}
            style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"5px 10px",borderRadius:6,fontFamily:"'DM Sans',sans-serif",fontSize:12,outline:"none"}}>
            <option value="todos">Todos los vehículos</option>
            {vehiculos.map(v=><option key={v.id} value={v.id}>{v.matricula}</option>)}
          </select>
          <div style={{display:"inline-flex",border:"1px solid var(--border)",borderRadius:7,overflow:"hidden"}}>
            {[["recursos","Por recursos"],["tabla","Tabla"]].map(([id,label])=>(
              <button key={id} onClick={()=>setVista(id)}
                style={{padding:"5px 10px",border:"none",background:vista===id?"var(--accent)":"var(--bg3)",color:vista===id?"#fff":"var(--text4)",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={cargar} style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            ↻ Actualizar
          </button>
        </div>
      </div>

      {/* ── KPIs generales semana ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10,marginBottom:18}}>
        {[
          ["Viajes semana",     pedidosSemana.length,      `${pedidosSemanaAnterior.length ? `${pedidosSemana.length-pedidosSemanaAnterior.length>=0?"+":""}${pedidosSemana.length-pedidosSemanaAnterior.length} vs semana anterior` : "Sin datos semana anterior"}`,   "var(--text)"],
          ["Ingresos estimados",fmt2(totalIngresos)+" €",  "",   "#10b981"],
          ["En curso / carga",  totalEnCurso,               "",   "#f97316"],
          ["Pendientes",        totalPendientes,             "",   "#3b82f6"],
          ["Entregados",        totalEntregados,             "",   "#10b981"],
          ["Cancelados",        totalCancelados,             "",   "#ef4444"],
        ].map(([l,v,sub,c])=>(
          <div key={l} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:18,color:c}}>{v}</div>
            <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".06em",marginTop:3}}>{l}</div>
            {sub && <div style={{fontSize:10,color:"var(--text4)",marginTop:5,lineHeight:1.35}}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Barra de días (mini cards filtrables) ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10,marginBottom:18}}>
        <div style={{background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.18)",borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"#10b981"}}>Comparativa ingresos</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:5}}>
            Semana anterior: <strong style={{color:"var(--text)"}}>{diffLabel(totalIngresos, ingresosSemanaAnterior, " €")}</strong>
          </div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>
            Mismo periodo ano anterior: <strong style={{color:"var(--text)"}}>{diffLabel(totalIngresos, ingresosAnoAnterior, " €")}</strong>
          </div>
        </div>
        <div style={{background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.18)",borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--accent)"}}>Comparativa viajes</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:5}}>
            Semana anterior: <strong style={{color:"var(--text)"}}>{pedidosSemanaAnterior.length ? `${pedidosSemana.length-pedidosSemanaAnterior.length>=0?"+":""}${pedidosSemana.length-pedidosSemanaAnterior.length}` : "Sin datos"}</strong>
          </div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>
            Mismo periodo ano anterior: <strong style={{color:"var(--text)"}}>{pedidosAnoAnterior.length ? `${pedidosSemana.length-pedidosAnoAnterior.length>=0?"+":""}${pedidosSemana.length-pedidosAnoAnterior.length}` : "Sin datos"}</strong>
          </div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:18}}>
        {dias.map((d,i)=>{
          const dStr  = d.toISOString().slice(0,10);
          const isToday   = dStr === today;
          const isSelDia  = diaFiltro === String(i);
          const k = kpiDia[i];
          return (
            <button key={i} onClick={()=>setDiaFiltro(isSelDia?"todos":String(i))}
              style={{
                padding:"10px 8px", borderRadius:10, cursor:"pointer", textAlign:"center",
                fontFamily:"'DM Sans',sans-serif", transition:"all .12s",
                background: isSelDia ? "rgba(59,130,246,.18)" : isToday ? "rgba(59,130,246,.07)" : "var(--bg2)",
                border: `2px solid ${isSelDia ? "var(--accent)" : isToday ? "rgba(59,130,246,.4)" : "var(--border)"}`,
              }}>
              <div style={{fontSize:10,fontWeight:700,color:"var(--text5)",letterSpacing:".07em"}}>{DIAS[i]}</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,color:isSelDia?"var(--accent)":isToday?"var(--accent-xl)":"var(--text)",lineHeight:1.1}}>
                {d.getDate()}
              </div>
              <div style={{fontSize:11,fontWeight:700,color: k.n>0?"var(--accent)":"var(--text5)",marginTop:2}}>
                {k.n > 0 ? `${k.n} viaje${k.n!==1?"s":""}` : "—"}
              </div>
              {k.ingreso > 0 && (
                <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#10b981",marginTop:1}}>
                  {fmt2(k.ingreso)} €
                </div>
              )}
              {k.enCurso > 0 && (
                <div style={{fontSize:9,color:"#f97316",marginTop:1,fontWeight:700}}>
                  {k.enCurso} en curso
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tabla de pedidos ── */}
      {vista==="recursos" && (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginBottom:18}}>
          <div style={{padding:"10px 16px",borderBottom:"1px solid var(--border)",background:"var(--bg3)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div style={{fontSize:12,fontWeight:800,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".06em"}}>
              Cuadrante por recursos
              <span style={{marginLeft:8,fontFamily:"'JetBrains Mono',monospace",color:"var(--accent)",fontWeight:900}}>({gruposRecursos.length})</span>
            </div>
            <div style={{fontSize:11,color:"var(--text5)"}}>Vehiculos propios, sin asignacion y colaboradores con viajes esta semana</div>
          </div>
          {loading ? (
            <div style={{padding:40,textAlign:"center",color:"var(--text5)"}}>Cargando...</div>
          ) : gruposRecursos.length === 0 ? (
            <div style={{padding:40,textAlign:"center",color:"var(--text5)"}}>Sin recursos con viajes para los filtros seleccionados</div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12,padding:14}}>
              {gruposRecursos.map(g=>{
                const cerrado = !!cerrados[g.id];
                const total = g.viajes.filter(p=>p.estado!=="cancelado").reduce((s,p)=>s+Number(p.importe||0),0);
                const color = g.tipo==="sin" ? "#f59e0b" : g.tipo==="colaborador" ? "#a78bfa" : "var(--accent)";
                return (
                  <div key={g.id} style={{border:"1px solid var(--border)",borderRadius:10,background:"var(--bg3)",overflow:"hidden"}}>
                    <button onClick={()=>setCerrados(p=>({...p,[g.id]:!p[g.id]}))}
                      style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"10px 12px",border:"none",background:"transparent",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",textAlign:"left"}}>
                      <div style={{minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{width:8,height:8,borderRadius:"50%",background:color,boxShadow:`0 0 6px ${color}80`,flexShrink:0}}/>
                          <span style={{fontWeight:900,color:"var(--text)",fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.titulo}</span>
                        </div>
                        <div style={{fontSize:11,color:"var(--text5)",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.subtitulo || "Recurso"}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:"#10b981",fontSize:12}}>{fmt2(total)} €</div>
                        <div style={{fontSize:10,color:"var(--text5)"}}>{g.viajes.length} viaje{g.viajes.length!==1?"s":""} {cerrado ? "+" : "-"}</div>
                      </div>
                    </button>
                    {!cerrado && (
                      <div style={{display:"flex",flexDirection:"column",gap:8,padding:"0 10px 10px"}}>
                        {g.viajes.map(p=>(
                          <div key={p.id}>
                            <TripMini p={p} onClick={()=>setExpanded(expanded===p.id?null:p.id)}/>
                            {expanded===p.id && (
                              <div style={{marginTop:6,background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:10}}>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                                  {[
                                    ["Fecha carga", p.fecha_carga ? new Date(p.fecha_carga).toLocaleDateString("es-ES") : "-"],
                                    ["Fecha descarga", p.fecha_descarga ? new Date(p.fecha_descarga).toLocaleDateString("es-ES") : "-"],
                                    ["Mercancia", p.mercancia || p.descripcion_carga || "-"],
                                    ["Peso", p.peso_kg ? fmtN(p.peso_kg)+" kg" : "-"],
                                    ["Km ruta", p.km_ruta || p.km ? fmtN(p.km_ruta || p.km)+" km" : "-"],
                                    ["Referencia", p.referencia_cliente || "-"],
                                  ].map(([l,v])=>(
                                    <div key={l}>
                                      <div style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>{l}</div>
                                      <div style={{fontSize:12,color:"var(--text2)",fontWeight:600,marginTop:2}}>{v}</div>
                                    </div>
                                  ))}
                                </div>
                                {p.notas && <div style={{marginTop:8,fontSize:11,color:"var(--text4)",lineHeight:1.45}}>{p.notas}</div>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {vista==="tabla" && <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
        {/* Sub-header */}
        <div style={{padding:"10px 16px",borderBottom:"1px solid var(--border)",background:"var(--bg3)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".06em"}}>
            {diaFiltro==="todos" ? `Todos los viajes de la semana` : `Viajes del ${DIAS[parseInt(diaFiltro)]} ${dias[parseInt(diaFiltro)].getDate()}`}
            <span style={{marginLeft:8,fontFamily:"'JetBrains Mono',monospace",color:"var(--accent)",fontWeight:700}}>
              ({pedidosFiltrados.length})
            </span>
          </div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:"#10b981"}}>
            {fmt2(pedidosFiltrados.filter(p=>p.estado!=="cancelado").reduce((s,p)=>s+Number(p.importe||0),0))} €
          </div>
        </div>

        {loading ? (
          <div style={{padding:40,textAlign:"center",color:"var(--text5)"}}>Cargando...</div>
        ) : pedidosFiltrados.length === 0 ? (
          <div style={{padding:40,textAlign:"center",color:"var(--text5)"}}>
            Sin viajes para los filtros seleccionados
          </div>
        ) : (
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr>
                {["Nº Pedido","Fecha","Hora","Origen → Destino","Cliente","Vehículo","Chófer","Estado","Importe"].map(h=>(
                  <th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,
                    textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",
                    borderBottom:"1px solid var(--border)",whiteSpace:"nowrap"}}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pedidosFiltrados.map(p => {
                const isExp = expanded === p.id;
                const veh   = vehiculos.find(v=>v.id===p.vehiculo_id);
                const cho   = choferes.find(c=>c.id===p.chofer_id);
                const fecha = p.fecha_carga||p.fecha_pedido||"";
                const dIdx  = dias.findIndex(d=>d.toISOString().slice(0,10)===fecha.slice(0,10));
                const isToday2 = fecha.slice(0,10) === today;
                return (
                  <>
                    <tr key={p.id}
                      onClick={()=>setExpanded(isExp?null:p.id)}
                      style={{cursor:"pointer",background:isExp?"rgba(59,130,246,.06)":isToday2?"rgba(59,130,246,.02)":"transparent",
                        borderLeft:isToday2?"3px solid var(--accent)":"3px solid transparent"}}>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:700,color:"var(--accent)"}}>
                        {p.numero}
                      </td>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontSize:12,color:"var(--text4)"}}>
                        {dIdx>=0 ? <span style={{fontWeight:700,color:isToday2?"var(--accent)":"var(--text3)"}}>{DIAS[dIdx]} {dias[dIdx]?.getDate()}</span> : fecha.slice(0,10)}
                      </td>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"var(--text4)"}}>
                        {p.hora_carga||"—"}
                      </td>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontSize:12,fontWeight:600,color:"var(--text)"}}>
                        {p.origen&&p.destino ? `${p.origen} → ${p.destino}` : p.origen||p.destino||"—"}
                      </td>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontSize:12,color:"var(--text3)"}}>
                        {p.cliente_nombre||"—"}
                      </td>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"var(--text4)"}}>
                        {veh?.matricula || p.vehiculo_matricula || "—"}
                      </td>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontSize:12,color:"var(--text4)"}}>
                        {cho ? `${cho.nombre} ${cho.apellidos||""}`.trim() : p.chofer_nombre||"—"}
                      </td>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)"}}>
                        <Badge estado={p.estado}/>
                      </td>
                      <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,
                        color:p.estado==="cancelado"?"var(--text5)":"#10b981",textAlign:"right"}}>
                        {p.estado==="cancelado" ? "—" : fmt2(p.importe||0)+" €"}
                      </td>
                    </tr>

                    {/* Fila expandida con detalles */}
                    {isExp && (
                      <tr key={p.id+"_exp"}>
                        <td colSpan={9} style={{padding:"0",borderBottom:"1px solid var(--border)"}}>
                          <div style={{padding:"12px 16px",background:"rgba(59,130,246,.04)",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
                            {[
                              ["Mercancía",     p.mercancia||p.descripcion_carga||"—"],
                              ["Peso (kg)",      p.peso_kg||p.kg||"—"],
                              ["Bultos",         p.bultos||"—"],
                              ["Km ruta",        p.km_ruta||p.km ? fmtN(p.km_ruta||p.km)+" km" : "—"],
                              ["Km vacío",       p.km_vacio ? fmtN(p.km_vacio)+" km" : "—"],
                              ["Fecha descarga", p.fecha_descarga ? new Date(p.fecha_descarga).toLocaleDateString("es-ES") : "—"],
                              ["Referencia",     p.referencia_cliente||"—"],
                              ["Notas",          p.notas||"—"],
                              ...(p.colaborador_nombre?[["Colaborador",p.colaborador_nombre]]:[] ),
                              ...(p.precio_colaborador?[["Pago colaborador",fmt2(p.precio_colaborador)+" €"]]:[] ),
                            ].map(([l,v])=>(
                              <div key={l} style={{background:"var(--bg3)",borderRadius:7,padding:"7px 10px"}}>
                                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>{l}</div>
                                <div style={{fontSize:12,color:"var(--text2)",fontWeight:500}}>{v}</div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>

            {/* Footer con totales */}
            <tfoot>
              <tr style={{background:"var(--bg3)"}}>
                <td colSpan={7} style={{padding:"9px 12px",fontSize:11,fontWeight:700,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".06em"}}>
                  TOTALES — {pedidosFiltrados.filter(p=>p.estado!=="cancelado").length} viajes activos
                </td>
                <td style={{padding:"9px 12px"}}>
                  <span style={{fontSize:10,color:"var(--text5)"}}>
                    {Object.entries(
                      pedidosFiltrados.reduce((acc,p)=>{ acc[p.estado]=(acc[p.estado]||0)+1; return acc; },{})
                    ).map(([e,n])=>`${EC[e]?.label||e}: ${n}`).join(" · ")}
                  </span>
                </td>
                <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:15,color:"#10b981",textAlign:"right"}}>
                  {fmt2(pedidosFiltrados.filter(p=>p.estado!=="cancelado").reduce((s,p)=>s+Number(p.importe||0),0))} €
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>}
    </div>
  );
}
