import { useState, useEffect } from "react";
import { getVehiculos, getPedidos, getTallerEstado, getKmVacioVehiculo, crearKmVacioVehiculo } from "../services/api";
import { notify } from "../services/notify";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = n => Number(n||0).toLocaleString("es-ES",{maximumFractionDigits:0});

const S = {
  page: {flex:1, padding:"22px 26px",fontFamily:"'DM Sans',sans-serif"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,color:"var(--text)",marginBottom:4},
  sub:  {fontSize:12,color:"var(--text4)",marginBottom:20},
  card: {background:"var(--bg2)",border:"1px solid #141a28",borderRadius:12,overflow:"hidden",marginBottom:14},
  th:   {textAlign:"left",padding:"8px 13px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",borderBottom:"1px solid #141a28",background:"var(--bg3)",whiteSpace:"nowrap"},
  td:   {padding:"9px 13px",borderBottom:"1px solid #0f1520",fontSize:13,color:"var(--text2)",verticalAlign:"middle"},
  btn:  {padding:"7px 14px",borderRadius:7,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:5},
  inp:  {background:"var(--bg4)",border:"1px solid #1e2d45",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  sel:  {background:"var(--bg4)",border:"1px solid #1e2d45",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  mbox: {background:"var(--bg2)",border:"1px solid #1e2d45",borderRadius:14,padding:26,width:"min(520px,96vw)"},
  lbl:  {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10},
};

// ── Modal para añadir km en vacío manualmente ──────────────────────────────
function ModalKmVacio({vehiculo, onClose, onSaved}) {
  const [form, setForm] = useState({fecha:new Date().toISOString().slice(0,10),km_vacio:0,origen:"",destino:"",motivo:"Posicionamiento"});
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));

  async function guardar() {
    if (!form.km_vacio||form.km_vacio<=0) { notify("Introduce los km en vacio", "warning"); return; }
    try {
      const created = await crearKmVacioVehiculo(vehiculo.id, { ...form, km_vacio: parseFloat(form.km_vacio) });
      onSaved(created);
    } catch (e) {
      notify(`Error al registrar km en vacio: ${e.message || "Error desconocido"}`, "error");
    }
  }

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.mbox}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:18}}>
          Registrar km en vacío - {vehiculo.matricula}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label style={S.lbl}>Fecha</label><input type="date" style={S.inp} value={form.fecha} onChange={f("fecha")}/></div>
          <div><label style={S.lbl}>Km en vacío *</label><input type="number" min="1" style={S.inp} value={form.km_vacio} onChange={f("km_vacio")}/></div>
          <div><label style={S.lbl}>Origen</label><input style={S.inp} value={form.origen} onChange={f("origen")} placeholder="Ciudad..."/></div>
          <div><label style={S.lbl}>Destino</label><input style={S.inp} value={form.destino} onChange={f("destino")} placeholder="Ciudad..."/></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Motivo</label>
            <select value={form.motivo} onChange={f("motivo")} style={S.sel}>
              {["Posicionamiento","Vuelta a base","Búsqueda de carga","Taller","Otro"].map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid #1e2d45"}} onClick={onClose}>Cancelar</button>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={guardar}>Registrar</button>
        </div>
      </div>
    </div>
  );
}

export default function Explotacion() {
  const [vehiculos,   setVehiculos]   = useState([]);
  const [pedidos,     setPedidos]     = useState([]);
  const [taller,      setTaller]      = useState({ stock: [], reparaciones: [] });
  const [kmVacioMap,  setKmVacioMap]  = useState({});
  const [loading,     setLoading]     = useState(true);
  const [periodo,     setPeriodo]     = useState("mes");
  const [modalKm,     setModalKm]     = useState(null);
  const [selVehiculo, setSelVehiculo] = useState(null);

  async function cargarKmVacioVehiculos(listaVehiculos) {
    const base = Array.isArray(listaVehiculos) ? listaVehiculos : [];
    if (!base.length) {
      setKmVacioMap({});
      return;
    }
    const pairs = await Promise.all(
      base.map(async (vehiculo) => {
        try {
          const rows = await getKmVacioVehiculo(vehiculo.id);
          return [vehiculo.id, Array.isArray(rows) ? rows : []];
        } catch {
          return [vehiculo.id, []];
        }
      })
    );
    setKmVacioMap(Object.fromEntries(pairs));
  }

  useEffect(() => {
    Promise.all([getVehiculos(), getPedidos({}), getTallerEstado().catch(()=>null)])
      .then(async ([v,p,t])=>{
        const vehiculosArr = Array.isArray(v)?v:[];
        setVehiculos(vehiculosArr);
        setPedidos(Array.isArray(p)?p:[]);
        setTaller(t && typeof t === "object" ? t : { stock: [], reparaciones: [] });
        await cargarKmVacioVehiculos(vehiculosArr);
      }).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  // Calcular rango de fechas según período
  function getRango() {
    const ahora = new Date();
    if (periodo==="mes") {
      const ini = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      return { desde: ini, hasta: ahora };
    }
    if (periodo==="trimestre") {
      const ini = new Date(ahora); ini.setMonth(ahora.getMonth()-3);
      return { desde: ini, hasta: ahora };
    }
    if (periodo==="año") {
      const ini = new Date(ahora.getFullYear(), 0, 1);
      return { desde: ini, hasta: ahora };
    }
    return { desde: new Date(0), hasta: ahora };
  }

  function getKmVacio(vehiculoId) {
    return Array.isArray(kmVacioMap?.[vehiculoId]) ? kmVacioMap[vehiculoId] : [];
  }

  const { desde, hasta } = getRango();

  // Construir análisis por vehículo
  // Explotación: solo tractoras y camiones (no remolques)
  // Los remolques se analizan siempre junto a su tractora
  const vehiculosFiltrados = vehiculos.filter(v => {
    const clase = (v.clase || v.tipo || "").toLowerCase();
    const mat = (v.matricula||"").toUpperCase();
    const isRemolqueDeAlguien = vehiculos.some(t=>t.remolque_id===v.id);
    return !clase.includes("remolque") && !clase.includes("semirremolque") && 
           !clase.includes("dolly") && !clase.includes("lowboy") &&
           !isRemolqueDeAlguien && !mat.startsWith("R-") && !mat.endsWith("-R");
  });

  const analisis = vehiculosFiltrados.map(v => {
    // Pedidos asignados a este vehículo en el período
    const pedidosVh = pedidos.filter(p => {
      if (p.vehiculo_id !== v.id) return false;
      if (!p.fecha_carga) return true;
      const fc = new Date(p.fecha_carga);
      return fc >= desde && fc <= hasta;
    });

    const ingresos     = pedidosVh.reduce((s,p)=>s+Number(p.importe||0),0);
    const kmCargados   = pedidosVh.reduce((s,p)=>s+Number(p.km||0),0);

    // Km en vacío registrados
    const kmVacioReg = getKmVacio(v.id)
      .filter(kv=>{ const f=new Date(kv.fecha); return f>=desde&&f<=hasta; })
      .reduce((s,kv)=>s+kv.km_vacio,0);

    // Costos de taller en período
    const costosTaller = taller.reparaciones
      .filter(r=>r.vehiculo_id===v.id && new Date(r.fecha)>=desde && new Date(r.fecha)<=hasta)
      .reduce((s,r)=>s+(r.coste_total||0),0);

    const kmTotales = kmCargados + kmVacioReg;
    const pctVacio  = kmTotales > 0 ? (kmVacioReg/kmTotales*100) : 0;
    const margen    = ingresos - costosTaller;
    const costoKm   = kmTotales > 0 ? costosTaller/kmTotales : 0;
    const ingresoKm = kmCargados > 0 ? ingresos/kmCargados : 0;

    return { vehiculo:v, pedidosVh, ingresos, kmCargados, kmVacioReg, kmTotales, pctVacio, costosTaller, margen, costoKm, ingresoKm };
  });

  // Totales globales
  const totales = analisis.reduce((acc,a)=>({
    ingresos:     acc.ingresos+a.ingresos,
    kmCargados:   acc.kmCargados+a.kmCargados,
    kmVacioReg:   acc.kmVacioReg+a.kmVacioReg,
    costosTaller: acc.costosTaller+a.costosTaller,
    margen:       acc.margen+a.margen,
  }), {ingresos:0,kmCargados:0,kmVacioReg:0,costosTaller:0,margen:0});

  const vehiculoDetalle = selVehiculo ? analisis.find(a=>a.vehiculo.id===selVehiculo) : null;

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={S.title}>Explotación</div>
      <div style={S.sub}>Rentabilidad por vehículo - Km en vacío - Costes de taller</div>

      {/* Filtro período */}
      <div style={{display:"flex",gap:8,marginBottom:18,alignItems:"center"}}>
        <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>Período:</span>
        {[["mes","Este mes"],["trimestre","Trimestre"],["año","Este año"],["todo","Todo"]].map(([v,l])=>(
          <button key={v} onClick={()=>setPeriodo(v)}
            style={{...S.btn,padding:"5px 12px",
                    background:periodo===v?"var(--accent)":"var(--bg3)",
                    border:"1px solid",borderColor:periodo===v?"var(--accent)":"var(--border2)",
                    color:periodo===v?"#fff":"var(--text3)"}}>
            {l}
          </button>
        ))}
      </div>

      {/* KPIs globales */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:18}}>
        {[
          {l:"Ingresos",        v:`${fmt2(totales.ingresos)} EUR`,        c:"var(--green)"},
          {l:"Km cargados",     v:`${fmtN(totales.kmCargados)} km`,     c:"var(--accent-xl)"},
          {l:"Km en vacío",     v:`${fmtN(totales.kmVacioReg)} km`,     c:"#f97316"},
          {l:"Costes taller",   v:`${fmt2(totales.costosTaller)} EUR`,    c:"#ef4444"},
          {l:"Margen estimado", v:`${fmt2(totales.margen)} EUR`,          c:totales.margen>=0?"var(--green)":"#ef4444"},
        ].map((k,i)=>(
          <div key={i} style={{background:"var(--bg2)",border:"1px solid #141a28",borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,color:k.c,lineHeight:1.2}}>{k.v}</div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginTop:3}}>{k.l}</div>
          </div>
        ))}
      </div>

      {/* Tabla por vehículo */}
      {loading ? <div style={{textAlign:"center",color:"var(--text4)",padding:40}}>Cargando...</div>
      : (
        <div style={S.card}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              {["Vehículo","Pedidos","Ingresos","Km cargados","Km vacío","% Vacío","Coste taller","EUR/km cargado","Margen","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {analisis.length===0
                ? <tr><td colSpan={10} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Sin vehículos</td></tr>
                : analisis.map(a=>{
                  const pctColor = a.pctVacio>30?"#ef4444":a.pctVacio>15?"#f97316":"var(--green)";
                  return (
                    <tr key={a.vehiculo.id} style={{cursor:"pointer"}} onClick={()=>setSelVehiculo(s=>s===a.vehiculo.id?null:a.vehiculo.id)}>
                      <td style={{...S.td,fontWeight:700,color:"var(--text)"}}>
                        <div>{a.vehiculo.matricula}</div>
                        {a.vehiculo.remolque_matricula && (
                          <div style={{fontSize:10,color:"#a78bfa",marginTop:2}}>
                            {a.vehiculo.remolque_matricula}
                          </div>
                        )}
                      </td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"var(--accent-xl)"}}>{a.pedidosVh.length}</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"var(--green)",fontWeight:700}}>{fmt2(a.ingresos)} EUR</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"var(--accent-xl)"}}>{fmtN(a.kmCargados)} km</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#f97316"}}>{fmtN(a.kmVacioReg)} km</td>
                      <td style={S.td}>
                        <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:pctColor}}>
                          {a.pctVacio.toFixed(1)}%
                        </span>
                      </td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#ef4444"}}>{fmt2(a.costosTaller)} EUR</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>{fmt2(a.ingresoKm)} EUR</td>
                      <td style={S.td}>
                        <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:a.margen>=0?"var(--green)":"#ef4444"}}>
                          {fmt2(a.margen)} EUR
                        </span>
                      </td>
                      <td style={S.td} onClick={e=>e.stopPropagation()}>
                        <button style={{...S.btn,background:"var(--bg3)",color:"var(--text2)",padding:"3px 10px",fontSize:11,border:"1px solid #1e2d45"}}
                          onClick={()=>setModalKm(a.vehiculo)}>
                          + Km vacío
                        </button>
                      </td>
                    </tr>
                  );
                })
              }
            </tbody>
          </table>
        </div>
      )}

      {/* Detalle vehículo expandido */}
      {vehiculoDetalle && (
        <div style={{background:"var(--bg2)",border:"1px solid #1e2d45",borderRadius:12,padding:18,marginTop:4}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"var(--text)",marginBottom:14}}>
            Detalle - {vehiculoDetalle.vehiculo.matricula}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            {/* Pedidos */}
            <div>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:8}}>Pedidos del período</div>
              {vehiculoDetalle.pedidosVh.length===0
                ? <div style={{fontSize:12,color:"var(--text5)"}}>Sin pedidos en este período</div>
                : vehiculoDetalle.pedidosVh.slice(0,8).map(p=>(
                  <div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #0f1520",fontSize:12}}>
                    <span style={{color:"var(--text3)"}}>{p.numero} {p.origen&&p.destino?`- ${p.origen}->${p.destino}`:""}</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",color:"var(--green)"}}>{fmt2(p.importe)} EUR</span>
                  </div>
                ))
              }
              {vehiculoDetalle.pedidosVh.length>8&&<div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>+{vehiculoDetalle.pedidosVh.length-8} más...</div>}
            </div>
            {/* Km en vacío */}
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>Km en vacío registrados</div>
                <button style={{...S.btn,background:"transparent",color:"var(--accent-xl)",border:"1px solid #1e2d45",padding:"2px 8px",fontSize:11}}
                  onClick={()=>setModalKm(vehiculoDetalle.vehiculo)}>+ Añadir</button>
              </div>
              {getKmVacio(vehiculoDetalle.vehiculo.id).length===0
                ? <div style={{fontSize:12,color:"var(--text5)"}}>Sin km en vacío registrados</div>
                : getKmVacio(vehiculoDetalle.vehiculo.id).slice(0,8).map((kv,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #0f1520",fontSize:12}}>
                    <span style={{color:"var(--text3)"}}>{kv.fecha} {kv.origen&&kv.destino?`- ${kv.origen}->${kv.destino}`:""} <span style={{color:"var(--text5)"}}>({kv.motivo})</span></span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#f97316"}}>{fmtN(kv.km_vacio)} km</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Costes taller */}
          <div style={{marginTop:14}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:8}}>Intervenciones de taller</div>
            {taller.reparaciones.filter(r=>r.vehiculo_id===vehiculoDetalle.vehiculo.id).length===0
              ? <div style={{fontSize:12,color:"var(--text5)"}}>Sin intervenciones registradas en Taller</div>
              : taller.reparaciones.filter(r=>r.vehiculo_id===vehiculoDetalle.vehiculo.id).slice(0,5).map(r=>(
                <div key={r.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #0f1520",fontSize:12}}>
                  <span style={{color:"var(--text3)"}}>{r.fecha} - {r.tipo} - {r.descripcion.slice(0,50)}{r.descripcion.length>50?"...":""}</span>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#ef4444"}}>{fmt2(r.coste_total)} EUR</span>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {modalKm && (
        <ModalKmVacio
          vehiculo={modalKm}
          onClose={()=>setModalKm(null)}
          onSaved={(created)=>{
            setModalKm(null);
            if (!created?.id) return;
            setKmVacioMap(prev => ({
              ...prev,
              [modalKm.id]: [created, ...(Array.isArray(prev?.[modalKm.id]) ? prev[modalKm.id] : [])],
            }));
          }}
        />
      )}
    </div>
  );
}
