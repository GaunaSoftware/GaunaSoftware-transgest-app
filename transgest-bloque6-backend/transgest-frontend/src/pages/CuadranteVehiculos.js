import { useState, useEffect } from "react";
import { getVehiculos, getDocsVehiculo, editarVehiculo, getChoferes , actualizarKmVehiculo} from "../services/api";
import { notify } from "../services/notify";

// ── Semáforo de documentos ─────────────────────────────────────────────────
function semaforoDoc(fecha) {
  if (!fecha) return { color:"var(--text5)", label:"Sin fecha", nivel:99 };
  const dias = Math.ceil((new Date(fecha) - new Date()) / 86400000);
  if (dias > 30)  return { color:"var(--green)", label:`${dias}d`, nivel:3, bg:"rgba(16,185,129,.12)" };
  if (dias > 7)   return { color:"#f97316", label:`${dias}d`, nivel:2, bg:"rgba(249,115,22,.12)" };
  if (dias > 0)   return { color:"#ef4444", label:`${dias}d`, nivel:1, bg:"rgba(239,68,68,.14)" };
  return { color:"#ef4444", label:"CADUCADO", nivel:0, bg:"rgba(239,68,68,.2)", caducado:true };
}

const ESTADOS_VH = [
  {v:"disponible",  l:"Disponible",    c:"var(--green)"},
  {v:"en_ruta",     l:"En ruta",       c:"var(--accent-l)"},
  {v:"cargando",    l:"Cargando",      c:"#f59e0b"},
  {v:"descargando", l:"Descargando",   c:"#a78bfa"},
  {v:"taller",      l:"En taller",     c:"#f97316"},
  {v:"inactivo",    l:"Inactivo",      c:"#4b5675"},
];

const S = {
  page:  {padding:"22px 26px", fontFamily:"'DM Sans',sans-serif"},
  title: {fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,color:"var(--text)",marginBottom:4},
  sub:   {fontSize:12,color:"var(--text4)",marginBottom:20},
  card:  {background:"var(--bg2)",border:"1px solid #141a28",borderRadius:12,overflow:"hidden",marginBottom:14},
  th:    {textAlign:"left",padding:"8px 13px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",borderBottom:"1px solid #141a28",background:"var(--bg3)",whiteSpace:"nowrap"},
  td:    {padding:"10px 13px",borderBottom:"1px solid #0f1520",fontSize:13,color:"var(--text2)",verticalAlign:"middle"},
  btn:   {padding:"6px 13px",borderRadius:7,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:5},
  inp:   {background:"var(--bg4)",border:"1px solid #1e2d45",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  sel:   {background:"var(--bg4)",border:"1px solid #1e2d45",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  modal: {position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  mbox:  {background:"var(--bg2)",border:"1px solid #1e2d45",borderRadius:14,padding:26,width:"min(680px,96vw)",maxHeight:"92vh",overflowY:"auto"},
  lbl:   {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10},
};

function DocBadge({ fecha }) {
  const s = semaforoDoc(fecha);
  return (
    <span style={{display:"inline-flex",alignItems:"center",padding:"2px 8px",borderRadius:20,
                  fontSize:11,fontWeight:700,background:s.bg||"rgba(42,58,88,.2)",color:s.color,
                  minWidth:62,justifyContent:"center"}}>
      {s.label}
    </span>
  );
}

function EstadoBadge({ estado }) {
  const e = ESTADOS_VH.find(x=>x.v===estado) || {l:estado,c:"#4b5675"};
  return (
    <span style={{display:"inline-flex",padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,
                  background:`${e.c}18`,color:e.c,border:`1px solid ${e.c}30`}}>
      {e.l}
    </span>
  );
}

// ── Ficha de vehículo expandida ─────────────────────────────────────────────
function FichaVehiculo({ vehiculo, onClose, onSaved }) {
  const [tab, setTab]     = useState("estado");
  const [docs, setDocs]   = useState([]);
  const [form, setForm]   = useState({ ...vehiculo });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (vehiculo?.id) {
      getDocsVehiculo(vehiculo.id).then(d=>setDocs(Array.isArray(d)?d:[])).catch(()=>{});
    }
  }, [vehiculo?.id]);

  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));

  async function guardar() {
    setSaving(true);
    try { await editarVehiculo(vehiculo.id, form); onSaved(); }
    catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  // Calcular peor estado de docs
  const peorDoc = docs.reduce((peor, d) => {
    const s = semaforoDoc(d.fecha_vencimiento);
    return s.nivel < peor ? s.nivel : peor;
  }, 99);

  const alertaColor = peorDoc === 0 ? "#ef4444" : peorDoc <= 2 ? "#f97316" : peorDoc <= 3 ? "var(--green)" : "var(--text5)";

  const TABS = [
    {id:"estado",    l:"Estado"},
    {id:"docs",      l:"Documentos"},
    {id:"remolques", l:"Remolques"},
    {id:"historial", l:" Historial taller"},
  ];

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.mbox}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:"var(--text)",display:"flex",alignItems:"center",gap:10}}>
              {vehiculo.matricula}
              <span style={{width:8,height:8,borderRadius:"50%",background:alertaColor,boxShadow:`0 0 6px ${alertaColor}80`,flexShrink:0}}></span>
            </div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{vehiculo.marca} {vehiculo.modelo} - {vehiculo.año||"?"}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:18,cursor:"pointer"}}>Cerrar</button>
        </div>

        <div style={{display:"flex",gap:0,borderBottom:"1px solid #141a28",margin:"12px 0 18px"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:"6px 14px",border:"none",borderBottom:`2px solid ${tab===t.id?"var(--accent-l)":"transparent"}`,
                      background:"none",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer",
                      color:tab===t.id?"var(--accent-xl)":"var(--text4)"}}>
              {t.l}
            </button>
          ))}
        </div>

        {/* ── Estado ── */}
        {tab==="estado" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label style={S.lbl}>Estado actual</label>
              <select value={form.estado||"disponible"} onChange={f("estado")} style={S.sel}>
                {ESTADOS_VH.map(e=><option key={e.v} value={e.v}>{e.l}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Ubicación actual</label>
              <input style={S.inp} value={form.ubicacion_actual||""} onChange={f("ubicacion_actual")} placeholder="Ciudad, base..."/>
            </div>
            <div>
              <label style={S.lbl}>Km actuales</label>
              <input type="number" style={S.inp} value={form.km_actuales||""} onChange={f("km_actuales")} onBlur={e=>{ if(vehiculo?.id&&e.target.value) actualizarKmVehiculo(vehiculo.id, Number(e.target.value)).catch(()=>{}); }}/>
            </div>
            <div>
              <label style={S.lbl}>Próxima revisión (km)</label>
              <input type="number" style={S.inp} value={form.km_proxima_revision||""} onChange={f("km_proxima_revision")}/>
            </div>
            <div>
              <label style={S.lbl}>Chófer asignado</label>
              <div style={{...S.inp, background:"var(--bg3)", color:"var(--text3)", cursor:"default", display:"flex", alignItems:"center", gap:8}}>
                {form.chofer_id ? (
                  <>
                    <span style={{width:24,height:24,borderRadius:"50%",background:"var(--accent)",color:"#fff",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,flexShrink:0}}>
                      {(form.chofer_nombre||"?")[0]}
                    </span>
                    <span>{form.chofer_nombre || "Chófer asignado"}</span>
                  </>
                ) : (
                  <span style={{color:"var(--text5)"}}>Sin chófer - asigna desde Vehículos -> Conjunto</span>
                )}
              </div>
            </div>
            <div>
              <label style={S.lbl}>Notas</label>
              <input style={S.inp} value={form.notas||""} onChange={f("notas")}/>
            </div>
          </div>
        )}

        {/* ── Documentos ── */}
        {tab==="docs" && (
          <div>
            {docs.length===0
              ? <div style={{textAlign:"center",color:"var(--text4)",padding:30}}>Sin documentos registrados. Añádelos desde el módulo Documentos.</div>
              : (
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>{["Tipo doc","Vencimiento","Estado","Emisión"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {docs.sort((a,b)=>{
                      const da = semaforoDoc(a.fecha_vencimiento).nivel;
                      const db = semaforoDoc(b.fecha_vencimiento).nivel;
                      return da - db;
                    }).map((d,i)=>(
                      <tr key={i}>
                        <td style={{...S.td,fontWeight:600,color:"var(--text)"}}>{d.tipo_doc}</td>
                        <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>
                          {d.fecha_vencimiento ? new Date(d.fecha_vencimiento).toLocaleDateString("es-ES") : "-"}
                        </td>
                        <td style={S.td}><DocBadge fecha={d.fecha_vencimiento}/></td>
                        <td style={{...S.td,fontSize:11,color:"var(--text5)"}}>
                          {d.fecha_emision ? new Date(d.fecha_emision).toLocaleDateString("es-ES") : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        )}

        {/* ── Remolques ── */}
        {tab==="remolques" && (
          <div>
            <div style={{background:"rgba(59,130,246,.06)",border:"1px solid rgba(59,130,246,.15)",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"var(--text3)"}}>
              Asocia remolques a este vehículo. Los remolques compartidos pueden asignarse a diferentes tractoras.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div>
                <label style={S.lbl}>Matrícula remolque 1</label>
                <div style={{...S.inp, background:"var(--bg3)", fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color: form.remolque_matricula?"#a78bfa":"var(--text5)"}}>
                  {form.remolque_matricula || "Sin remolque asignado"}
                </div>
                {form.remolque_matricula && (
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>
                    Conjunto activo - edita el conjunto desde la pestaña Vehículos -> Conjunto / Chófer
                  </div>
                )}
              </div>
              <div>
                <label style={S.lbl}>Tipo remolque 1</label>
                <select value={form.remolque1_tipo||""} onChange={f("remolque1_tipo")} style={S.sel}>
                  <option value="">Seleccionar...</option>
                  {["Tautliner","Frigorífico","Cisterna","Plataforma","Basculante","Granelero","Portacoches","Otro"].map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={S.lbl}>Matrícula remolque 2</label>
                <input style={S.inp} value={form.remolque2_matricula||""} onChange={f("remolque2_matricula")} placeholder="5678-XYZ"/>
              </div>
              <div>
                <label style={S.lbl}>Tipo remolque 2</label>
                <select value={form.remolque2_tipo||""} onChange={f("remolque2_tipo")} style={S.sel}>
                  <option value="">Seleccionar...</option>
                  {["Tautliner","Frigorífico","Cisterna","Plataforma","Basculante","Granelero","Portacoches","Otro"].map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={S.lbl}>Notas sobre remolques</label>
              <textarea style={{...S.inp,height:60,resize:"vertical"}} value={form.notas_remolques||""} onChange={f("notas_remolques")} placeholder="Observaciones sobre la combinación..."/>
            </div>
          </div>
        )}

        {/* ── Historial taller ── */}
        {tab==="historial" && (
          <div>
            <div style={{fontSize:12,color:"var(--text4)",marginBottom:12}}>
              Los registros de taller se gestionan desde el módulo <strong style={{color:"var(--accent-xl)"}}>Taller</strong>. Aquí puedes ver el historial asociado a este vehículo.
            </div>
            {/* Últimos cambios registrados en form */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={S.lbl}>Último cambio aceite (fecha)</label>
                <input type="date" style={S.inp} value={form.fecha_ultimo_aceite||""} onChange={f("fecha_ultimo_aceite")}/>
              </div>
              <div>
                <label style={S.lbl}>Km en último cambio aceite</label>
                <input type="number" style={S.inp} value={form.km_ultimo_aceite||""} onChange={f("km_ultimo_aceite")}/>
              </div>
              <div>
                <label style={S.lbl}>Último cambio neumáticos (fecha)</label>
                <input type="date" style={S.inp} value={form.fecha_ultimo_neumaticos||""} onChange={f("fecha_ultimo_neumaticos")}/>
              </div>
              <div>
                <label style={S.lbl}>Km en último cambio neumáticos</label>
                <input type="number" style={S.inp} value={form.km_ultimo_neumaticos||""} onChange={f("km_ultimo_neumaticos")}/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.lbl}>Últimas intervenciones (resumen)</label>
                <textarea style={{...S.inp,height:80,resize:"vertical"}} value={form.historial_taller||""} onChange={f("historial_taller")} placeholder="Ej: 12/02/2026 - Cambio pastillas freno eje delantero..."/>
              </div>
            </div>
          </div>
        )}

        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20,borderTop:"1px solid #141a28",paddingTop:16}}>
          <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid #1e2d45"}} onClick={onClose}>Cancelar</button>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={guardar} disabled={saving}>
            {saving?"Guardando...":"Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Componente principal
// ══════════════════════════════════════════════════════════════════════
export default function CuadranteVehiculos() {
  const [vehiculos, setVehiculos] = useState([]);
  const [choferes,  setChoferes]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [ficha,     setFicha]     = useState(null);
  const [filtroEst, setFiltroEst] = useState("todos");

  useEffect(() => {
    Promise.all([
      getVehiculos().catch(()=>[]),
      getChoferes().catch(()=>[]),
    ]).then(([v,ch])=>{
      setVehiculos(Array.isArray(v)?v:[]);
      setChoferes(Array.isArray(ch)?ch:[]);
    }).finally(()=>setLoading(false));
  }, []);

  function recargar() {
    setFicha(null);
    setLoading(true);
    Promise.all([
      getVehiculos().catch(()=>[]),
      getChoferes().catch(()=>[]),
    ]).then(([v,ch])=>{
      setVehiculos(Array.isArray(v)?v:[]);
      setChoferes(Array.isArray(ch)?ch:[]);
    }).finally(()=>setLoading(false));
  }

  // Conjuntos: show only tractoras/camiones as main cards (remolques shown inside)
  const tractoras = vehiculos.filter(v => {
    const clase = (v.clase||v.tipo||"").toLowerCase();
    const mat = (v.matricula||"").toUpperCase();
    const isRemolqueDeAlguien = vehiculos.some(t=>t.remolque_id===v.id);
    const esRemolque = clase.includes("remolque")||clase.includes("semirremolque")||clase.includes("dolly")||
                       isRemolqueDeAlguien||mat.startsWith("R-")||mat.endsWith("-R");
    if (esRemolque) return false;
    return filtroEst==="todos" || v.estado===filtroEst;
  });
  const filtrados = tractoras; // keep variable name for compatibility

  // Obtener docs de cada vehículo (simplificado: usamos fecha del form si existe)
  function alertaVehiculo(v) {
    // Si tiene fecha de ITV registrada usarla
    if (v.fecha_itv) {
      const s = semaforoDoc(v.fecha_itv);
      if (s.nivel <= 2) return s;
    }
    if (v.fecha_seguro) {
      const s = semaforoDoc(v.fecha_seguro);
      if (s.nivel <= 2) return s;
    }
    return null;
  }

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={S.title}>Estado de Vehículos</div>
      <div style={S.sub}>Cuadrante - Estado actual, documentación y alertas de vencimiento</div>

      {/* Leyenda semáforo */}
      <div style={{display:"flex",gap:14,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>Semáforo docs:</span>
        {[
          {c:"var(--green)",l:">30 días"},
          {c:"#f97316",l:"8–30 días"},
          {c:"#ef4444",l:"<7 días o caducado"},
        ].map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"var(--text3)"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:s.c,boxShadow:`0 0 5px ${s.c}60`}}></span>
            {s.l}
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[["todos","Todos"],["disponible","Disponibles"],["en_ruta","En ruta"],["taller","En taller"],["inactivo","Inactivos"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFiltroEst(v)}
            style={{...S.btn,
                    background:filtroEst===v?"var(--accent)":"var(--bg3)",
                    border:"1px solid",borderColor:filtroEst===v?"var(--accent)":"var(--border2)",
                    color:filtroEst===v?"#fff":"var(--text3)"}}>
            {l}
          </button>
        ))}
      </div>

      {loading ? <div style={{textAlign:"center",color:"var(--text4)",padding:60}}>Cargando...</div>
      : filtrados.length===0 ? <div style={{textAlign:"center",color:"var(--text4)",padding:60,background:"var(--bg2)",border:"1px solid #141a28",borderRadius:12}}>Sin vehículos</div>
      : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
          {filtrados.map(v => {
            const alerta = alertaVehiculo(v);
            return (
              <div key={v.id} style={{
                background:"var(--bg2)",border:"1px solid #141a28",borderRadius:12,padding:16,
                cursor:"pointer",transition:"border-color .15s",
                borderColor: alerta ? `${alerta.color}40` : "var(--border)",
              }}
                onClick={()=>setFicha(v)}
                onMouseEnter={e=>e.currentTarget.style.borderColor=alerta?`${alerta.color}60`:"var(--border2)"}
                onMouseLeave={e=>e.currentTarget.style.borderColor=alerta?`${alerta.color}40`:"var(--border)"}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {/* Indicador semáforo */}
                    <span style={{
                      width:9,height:9,borderRadius:"50%",flexShrink:0,
                      background:alerta?alerta.color:"var(--green)",
                      boxShadow:`0 0 6px ${alerta?alerta.color:"var(--green)"}60`,
                    }}></span>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)"}}>
                      {v.matricula}
                    </span>
                  </div>
                  <EstadoBadge estado={v.estado||"disponible"}/>
                </div>

                <div style={{fontSize:12,color:"var(--text4)",marginBottom:8}}>
                  {v.marca} {v.modelo} {v.año?`(${v.año})`:""}
                </div>

                {/* Detalles rápidos */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {/* Conjunto badge */}
                  {v.remolque_matricula && (
                    <div style={{marginBottom:8,padding:"4px 10px",background:"rgba(139,92,246,.08)",border:"1px solid rgba(139,92,246,.2)",borderRadius:6,fontSize:11,color:"#a78bfa",display:"flex",alignItems:"center",gap:6}}>
                      <span>Conjunto</span>
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{v.matricula}</span>
                      <span style={{color:"var(--text5)"}}>+</span>
                      <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{v.remolque_matricula}</span>
                    </div>
                  )}
                  {[
                    ["Km actuales", v.km_actuales ? `${Number(v.km_actuales).toLocaleString("es-ES")} km` : "-"],
                    ["Carga máx", v.carga_max_kg ? `${Number(v.carga_max_kg/1000).toFixed(1)} t` : "-"],
                    ["Remolque", v.remolque_matricula || "Sin remolque"],
                    ["Chófer", choferes.find(ch=>ch.id===v.chofer_id)?.nombre || v.chofer_asignado || "Sin asignar"],
                  ].map(([k,val],i)=>(
                    <div key={i}>
                      <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>{k}</div>
                      <div style={{fontSize:12,color:"var(--text2)",marginTop:1}}>{val}</div>
                    </div>
                  ))}
                </div>

                {alerta && (
                  <div style={{marginTop:10,padding:"5px 10px",borderRadius:6,background:`${alerta.color}10`,
                               border:`1px solid ${alerta.color}25`,fontSize:11,color:alerta.color,fontWeight:600}}>
                     Documentación: {alerta.label}
                  </div>
                )}

                <div style={{marginTop:10,fontSize:11,color:"var(--text5)",textAlign:"right"}}>Click para abrir ficha -></div>
              </div>
            );
          })}
        </div>
      )}

      {ficha && (
        <FichaVehiculo vehiculo={ficha} onClose={()=>setFicha(null)} onSaved={recargar}/>
      )}
    </div>
  );
}
