import useBiAnalytics from "../services/useBiAnalytics";
import { useState, useEffect, useCallback } from "react";
import { getObjetivos, setObjetivo } from "../services/api";
import { notify } from "../services/notify";

const fmt2 = n => n == null ? "—" : Number(n).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = n => n == null ? "—" : Number(n).toLocaleString("es-ES",{maximumFractionDigits:0});

// Objetivos migrados a BD

const PERIODOS = [
  { k:"mes",       l:"Este mes" },
  { k:"trimestre", l:"Este trimestre" },
  { k:"anual",     l:"Este año" },
];

// ── Barra de progreso de objetivo ─────────────────────────────────────────
function ObjBar({ label, actual, objetivo, unidad="€", color="#3b82f6", sublabel="" }){
  const pct = actual != null && objetivo>0 ? Math.min((actual/objetivo)*100,100) : null;
  const over = objetivo>0 && actual>objetivo;
  const c = over?"#10b981":pct>=80?"#f59e0b":pct>=50?"#3b82f6":"#ef4444";
  return(
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
        <div>
          <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{label}</span>
          {sublabel&&<span style={{fontSize:11,color:"var(--text5)",marginLeft:6}}>{sublabel}</span>}
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:6}}>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:15,color:c}}>
            {unidad==="€"?fmt2(actual):fmtN(actual)}{unidad==="€"?" €":unidad==="#"?"":" "+unidad}
          </span>
          <span style={{fontSize:11,color:"var(--text5)"}}>/ {unidad==="€"?fmt2(objetivo):fmtN(objetivo)}{unidad==="€"?" €":""}</span>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:c}}>{pct == null ? "—" : pct.toFixed(1)+"%"}</span>
        </div>
      </div>
      <div style={{height:8,background:"var(--bg4)",borderRadius:4,overflow:"hidden"}}>
        <div style={{height:"100%",width:(pct ?? 0)+"%",background:c,borderRadius:4,transition:"width .4s"}}/>
      </div>
      {over&&<div style={{fontSize:10,color:"#10b981",marginTop:2,fontWeight:700}}>✅ Objetivo superado</div>}
    </div>
  );
}

// ── Modal edición objetivo ────────────────────────────────────────────────
function ModalEditarObjetivo({ objetivo, onClose, onSave }){
  const [form, setForm] = useState({...objetivo});
  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:10};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onMouseDown={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(460px,96vw)"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:14}}>
          🎯 {form.nombre}
        </div>
        {PERIODOS.map(p=>(
          <div key={p.k}>
            <label style={lbl}>{p.l}</label>
            <input type="number" step="any" style={inp} value={form[p.k]||""} onChange={e=>setForm(x=>({...x,[p.k]:e.target.value}))} placeholder="0 — dejar vacío para no definir"/>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
          <button onClick={()=>onSave(form)} style={{padding:"7px 16px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>💾 Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
export default function Objetivos(){
  const [periodo, setPeriodo] = useState("mes");
  const loading = false;
  const [config,  setConfig]  = useState({});
  const cargar = useCallback(async()=>{
    try{ const d=await getObjetivos(); setConfig(d||{}); }catch(e){}
  },[]);
  useEffect(()=>{ cargar(); },[cargar]);
  const [editando,setEditando]= useState(null);

  const analytics = useBiAnalytics(periodo);
  const stats = analytics.data?.totals || {};
  const facturacionTotal = stats.facturado_total;
  const cobrado = stats.cobrado;
  const viajesTotal = stats.viajes;
  const kmTotal = stats.kmTotal;
  const pctVacio = stats.pctVacio;
  const eurosKm = stats.eurosKm;
  const ticketMedio = stats.ticket_medio;
  const facturasVencidas = stats.facturas_vencidas;
  const porCamion = analytics.data?.flotaStats || [];
  const porChofer = analytics.data?.choferesStats || [];
  // ── Obtener objetivo de un indicador para el período ─────────────────
  const obj = (key) => Number(config[key]?.[periodo] || 0);

  // ── Guardar objetivo ──────────────────────────────────────────────────
  async function guardarObj(form){
    const updated = { ...config, [form.id]: { mes:Number(form.mes)||0, trimestre:Number(form.trimestre)||0, anual:Number(form.anual)||0, nombre:form.nombre } };
    try{
      await setObjetivo(editando, updated[editando]);
      setConfig(updated);
    }catch(e){notify(e.message, "error");}
    setEditando(null);
  }

  // Alertas: objetivos no alcanzados
  const alertas = [];
  if(facturacionTotal != null && obj("facturacion")>0&&facturacionTotal<obj("facturacion")*0.8) alertas.push(`Facturación al ${((facturacionTotal/obj("facturacion"))*100).toFixed(0)}% del objetivo`);
  if(cobrado != null && obj("cobro")>0&&cobrado<obj("cobro")*0.8) alertas.push(`Cobros al ${((cobrado/obj("cobro"))*100).toFixed(0)}% del objetivo`);
  if(viajesTotal != null && obj("viajes")>0&&viajesTotal<obj("viajes")*0.8) alertas.push(`Viajes al ${((viajesTotal/obj("viajes"))*100).toFixed(0)}% del objetivo`);
  if(pctVacio>25) alertas.push(`KM en vacío alto: ${pctVacio.toFixed(1)}%`);
  if(facturasVencidas>0) alertas.push(`${facturasVencidas} factura${facturasVencidas!==1?"s":""} vencida${facturasVencidas!==1?"s":""} sin cobrar`);

  const INDICADORES_GLOBALES = [
    { id:"facturacion", nombre:"Facturación total", actual:facturacionTotal, unidad:"€" },
    { id:"cobro",       nombre:"Cobros realizados", actual:cobrado,          unidad:"€" },
    { id:"viajes",      nombre:"Viajes completados",actual:viajesTotal,      unidad:"#" },
    { id:"km",          nombre:"Kilómetros totales",actual:kmTotal,          unidad:"km"},
    { id:"ticket",      nombre:"Ticket medio por viaje",actual:ticketMedio,  unidad:"€" },
    { id:"euros_km",    nombre:"€/km total medio",        actual:eurosKm,          unidad:"€/km total"},
    { id:"pct_vacio",   nombre:"% km en vacío",     actual:pctVacio,         unidad:"%" },
  ];

  const S = {
    card:{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 18px",marginBottom:14},
    sec:{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:13,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12},
    btn:{padding:"6px 13px",borderRadius:7,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:5},
  };

  return(
    <div style={{flex:1, padding:"22px 26px",fontFamily:"'DM Sans',sans-serif",minHeight:"100vh"}}>
      {analytics.error && <p role="alert">{analytics.error}</p>}
      {analytics.loading && <p role="status">Calculando indicadores…</p>}
      <p>Viajes e ingresos de servicios realizados, sin impuestos. Facturación y cobro estimado con impuestos. Saldo incluye deuda anterior al corte.</p>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:900,color:"var(--text)"}}>🎯 Objetivos</div>
        {/* Período */}
        <div style={{display:"flex",gap:4,background:"var(--bg3)",padding:3,borderRadius:8,border:"1px solid var(--border)"}}>
          {PERIODOS.map(p=>(
            <button key={p.k} onClick={()=>setPeriodo(p.k)}
              style={{...S.btn,background:periodo===p.k?"var(--accent)":"transparent",color:periodo===p.k?"#fff":"var(--text4)",border:"none",borderRadius:5,padding:"5px 12px"}}>
              {p.l}
            </button>
          ))}
        </div>
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--text5)"}}>{analytics.data?.metadata?.periodo?.desde || "—"} — {analytics.data?.metadata?.periodo?.hasta || "—"}</span>
      </div>

      {/* Alertas */}
      {alertas.length>0&&(
        <div style={{background:"rgba(239,68,68,.07)",border:"1px solid rgba(239,68,68,.25)",borderRadius:10,padding:"12px 16px",marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:12,color:"var(--red)",marginBottom:6}}>⚠️ Alertas de objetivos</div>
          {alertas.map((a,i)=>(
            <div key={i} style={{fontSize:12,color:"var(--text3)",padding:"3px 0",borderBottom:"1px solid rgba(239,68,68,.1)",display:"flex",alignItems:"center",gap:6}}>
              <span style={{color:"var(--red)"}}>•</span>{a}
            </div>
          ))}
        </div>
      )}

      {/* Objetivos globales */}
      <div style={S.card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={S.sec}>📊 INDICADORES GLOBALES</div>
        </div>
        {loading?(
          <div style={{padding:20,textAlign:"center",color:"var(--text5)"}}>Cargando...</div>
        ):(
          <div>
            {INDICADORES_GLOBALES.map(ind=>{
              const objetivo=obj(ind.id);
              return(
                <div key={ind.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{flex:1}}>
                    {objetivo>0?(
                      <ObjBar label={ind.nombre} actual={ind.actual} objetivo={objetivo} unidad={ind.unidad}/>
                    ):(
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--border2)"}}>
                        <span style={{fontSize:13,color:"var(--text)"}}>{ind.nombre}</span>
                        <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:14,color:"var(--text2)"}}>
                          {ind.unidad==="€"?fmt2(ind.actual):ind.unidad==="%"?(ind.actual == null ? "—" : ind.actual.toFixed(1)+"%"):fmtN(ind.actual)}{ind.unidad==="km"?" km":""}
                        </span>
                      </div>
                    )}
                  </div>
                  <button onClick={()=>setEditando({id:ind.id,nombre:ind.nombre,...(config[ind.id]||{})})}
                    style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text4)",fontSize:11,flexShrink:0,padding:"4px 9px"}}>
                    🎯 {objetivo>0?"Editar":"Definir"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Objetivos por camión */}
      {porCamion.length>0&&(
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={S.sec}>🚛 POR CAMIÓN</div>
          </div>
          {porCamion.map(v=>{
            const objV = Number(config["camion_"+v.id]?.[periodo]||config["facturacion"]?.[periodo]||0);
            return(
              <div key={v.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{flex:1}}>
                  {objV>0?(
                    <ObjBar label={v.matricula} sublabel={v.marca+" "+v.modelo} actual={v.ingresos} objetivo={objV}/>
                  ):(
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid var(--border2)"}}>
                      <div>
                        <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{v.matricula}</span>
                        <span style={{fontSize:11,color:"var(--text5)",marginLeft:6}}>{v.marca} {v.modelo}</span>
                      </div>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"#10b981"}}>{fmt2(v.ingresos)} €</span>
                        <span style={{fontSize:11,color:"var(--text5)"}}>{v.viajes} viajes</span>
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={()=>setEditando({id:"camion_"+v.id,nombre:"Objetivo "+v.matricula,...(config["camion_"+v.id]||{})})}
                  style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text4)",fontSize:11,flexShrink:0,padding:"4px 9px"}}>
                  🎯 {objV>0?"Editar":"Definir"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Objetivos por chófer */}
      {porChofer.length>0&&(
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={S.sec}>👤 POR CHÓFER</div>
          </div>
          {porChofer.map(c=>{
            const objC = Number(config["chofer_"+c.id]?.[periodo]||0);
            return(
              <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{flex:1}}>
                  {objC>0?(
                    <ObjBar label={c.nombre} actual={c.ingresos} objetivo={objC}/>
                  ):(
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid var(--border2)"}}>
                      <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{c.nombre}</span>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"#10b981"}}>{fmt2(c.ingresos)} €</span>
                        <span style={{fontSize:11,color:"var(--text5)"}}>{c.viajes} viajes</span>
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={()=>setEditando({id:"chofer_"+c.id,nombre:"Objetivo "+c.nombre,...(config["chofer_"+c.id]||{})})}
                  style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text4)",fontSize:11,flexShrink:0,padding:"4px 9px"}}>
                  🎯 {objC>0?"Editar":"Definir"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editando&&<ModalEditarObjetivo objetivo={editando} onClose={()=>setEditando(null)} onSave={guardarObj}/>}
    </div>
  );
}
