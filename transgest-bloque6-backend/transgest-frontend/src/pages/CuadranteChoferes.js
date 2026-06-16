import { useState, useEffect } from "react";
import { getChoferes, editarChofer, getVehiculos } from "../services/api";
import { notify } from "../services/notify";

const ESTADOS_CHOFER = [
  {v:"disponible",   l:"Disponible",    c:"var(--green)"},
  {v:"en_ruta",      l:"En ruta",       c:"var(--accent-l)"},
  {v:"descansando",  l:"Descansando",   c:"#f59e0b"},
  {v:"vacaciones",   l:"Vacaciones",    c:"#8b5cf6"},
  {v:"baja",         l:"Baja médica",   c:"#ef4444"},
  {v:"ausencia",     l:"Ausencia",      c:"#f97316"},
  {v:"formacion",    l:"Formación",     c:"#22d3ee"},
  {v:"inactivo",     l:"Inactivo",      c:"#4b5675"},
];

const S = {
  page:  {padding:"22px 26px",fontFamily:"'DM Sans',sans-serif"},
  title: {fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,color:"var(--text)",marginBottom:4},
  sub:   {fontSize:12,color:"var(--text4)",marginBottom:20},
  btn:   {padding:"6px 13px",borderRadius:7,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:5},
  inp:   {background:"var(--bg4)",border:"1px solid #1e2d45",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  sel:   {background:"var(--bg4)",border:"1px solid #1e2d45",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  lbl:   {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10},
  modal: {position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  mbox:  {background:"var(--bg2)",border:"1px solid #1e2d45",borderRadius:14,padding:26,width:"min(560px,96vw)",maxHeight:"90vh",overflowY:"auto"},
  th:    {textAlign:"left",padding:"8px 13px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",borderBottom:"1px solid #141a28",background:"var(--bg3)"},
  td:    {padding:"10px 13px",borderBottom:"1px solid #0f1520",fontSize:13,color:"var(--text2)",verticalAlign:"middle"},
};

function EstadoBadge({ estado }) {
  const e = ESTADOS_CHOFER.find(x=>x.v===estado) || {l:estado||"Disponible",c:"var(--green)"};
  return (
    <span style={{display:"inline-flex",padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,
                  background:`${e.c}18`,color:e.c,border:`1px solid ${e.c}30`}}>
      {e.l}
    </span>
  );
}

function AvisoTag({ tipo }) {
  const colores = {
    vacaciones:"#8b5cf6", baja:"#ef4444", ausencia:"#f97316",
    formacion:"#22d3ee", tarea:"#f59e0b",
  };
  const c = colores[tipo] || "#4b5675";
  return (
    <span style={{display:"inline-flex",padding:"1px 7px",borderRadius:4,fontSize:10,fontWeight:700,
                  background:`${c}18`,color:c,border:`1px solid ${c}25`,textTransform:"uppercase",letterSpacing:".06em"}}>
      {tipo}
    </span>
  );
}

// ── Modal aviso/ausencia ─────────────────────────────────────────────────────
function ModalAviso({ chofer, aviso, onClose, onSaved }) {
  const esNuevo = !aviso;
  const [form, setForm] = useState(aviso || {
    tipo:"vacaciones",
    fecha_inicio: new Date().toISOString().slice(0,10),
    fecha_fin:"",
    descripcion:"",
  });
  const [saving, setSaving] = useState(false);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));

  async function guardar() {
    if (!form.fecha_inicio) { notify("La fecha de inicio es obligatoria", "warning"); return; }
    setSaving(true);
    try {
      const avisos = chofer.avisos ? [...chofer.avisos] : [];
      if (esNuevo) {
        avisos.push({ ...form, id: Date.now() });
      } else {
        const idx = avisos.findIndex(a=>a.id===aviso.id);
        if (idx>=0) avisos[idx] = form;
      }
      await editarChofer(chofer.id, { ...chofer, avisos });
      onSaved();
    } catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  return (
    <div style={{...S.modal,zIndex:200}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{...S.mbox,width:"min(440px,96vw)"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:18}}>
          {esNuevo?"Nuevo aviso":"Editar aviso"} - {chofer.nombre}
        </div>
        <div>
          <label style={S.lbl}>Tipo</label>
          <select value={form.tipo} onChange={f("tipo")} style={S.sel}>
            {[["vacaciones","Vacaciones"],["baja","Baja médica"],["ausencia","Ausencia justificada"],["formacion","Formación / Curso"],["tarea","Tarea especial"]].map(([v,l])=>(
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={S.lbl}>Fecha inicio *</label>
            <input type="date" style={S.inp} value={form.fecha_inicio} onChange={f("fecha_inicio")}/>
          </div>
          <div>
            <label style={S.lbl}>Fecha fin</label>
            <input type="date" style={S.inp} value={form.fecha_fin} onChange={f("fecha_fin")}/>
          </div>
        </div>
        <div>
          <label style={S.lbl}>Descripción / Notas</label>
          <textarea style={{...S.inp,height:70,resize:"vertical"}} value={form.descripcion} onChange={f("descripcion")} placeholder="Detalles del aviso..."/>
        </div>
        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid #1e2d45"}} onClick={onClose}>Cancelar</button>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={guardar} disabled={saving}>
            {saving?"Guardando...":esNuevo?"Añadir aviso":"Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ficha de chofer ─────────────────────────────────────────────────────────
function FichaChofer({ chofer, onClose, onSaved, vehiculos=[] }) {
  const [form,        setForm]        = useState({ ...chofer });
  const [saving,      setSaving]      = useState(false);
  const [modalAviso,  setModalAviso]  = useState(false);
  const [editAviso,   setEditAviso]   = useState(null);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));

  const avisos = form.avisos || [];

  async function guardar() {
    setSaving(true);
    try { await editarChofer(chofer.id, form); onSaved(); }
    catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  async function eliminarAviso(id) {
    const nuevos = avisos.filter(a=>a.id!==id);
    setSaving(true);
    try { await editarChofer(chofer.id, { ...form, avisos: nuevos }); setForm(p=>({...p,avisos:nuevos})); }
    catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  // Avisos vigentes
  const ahora = new Date();
  const avisosVigentes = avisos.filter(a => !a.fecha_fin || new Date(a.fecha_fin) >= ahora);
  const avisosHist     = avisos.filter(a =>  a.fecha_fin  && new Date(a.fecha_fin)  < ahora);

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.mbox}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:800,color:"var(--text)"}}>
              {chofer.nombre}{chofer.apellidos ? " "+chofer.apellidos : ""}
            </div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{chofer.telefono||""}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:18,cursor:"pointer"}}>Cerrar</button>
        </div>

        {/* Estado */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <div>
            <label style={S.lbl}>Estado actual</label>
            <select value={form.estado||"disponible"} onChange={f("estado")} style={S.sel}>
              {ESTADOS_CHOFER.map(e=><option key={e.v} value={e.v}>{e.l}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Vehículo asignado</label>
            {(()=>{
              // Find vehicle assigned to this chofer
              const remIds = new Set(vehiculos.map(v=>v.remolque_id).filter(Boolean));
              const tractoras = vehiculos.filter(v=>{
                const mat=(v.matricula||"").toUpperCase();
                const clase=(v.clase||v.tipo||"").toLowerCase();
                return !remIds.has(v.id)&&!mat.startsWith("R-")&&!mat.endsWith("-R")&&
                       !clase.includes("remolque")&&!clase.includes("semirremolque");
              });
              const currentVeh = vehiculos.find(v=>v.chofer_id===chofer.id || v.id===chofer.vehiculo_id);
              return (
                <select style={S.sel}
                  value={form.vehiculo_id||currentVeh?.id||""}
                  onChange={e=>setForm(p=>({...p,vehiculo_id:e.target.value}))}>
                  <option value="">Sin asignar</option>
                  {tractoras.map(v=>(
                    <option key={v.id} value={v.id}>
                      {v.matricula}{v.remolque_matricula?" "+v.remolque_matricula:""}
                    </option>
                  ))}
                </select>
              );
            })()}
          </div>
          <div>
            <label style={S.lbl}>Ubicación actual</label>
            <input style={S.inp} value={form.ubicacion_actual||""} onChange={f("ubicacion_actual")} placeholder="Ciudad, base..."/>
          </div>
          <div>
            <label style={S.lbl}>Notas</label>
            <input style={S.inp} value={form.notas||""} onChange={f("notas")}/>
          </div>
        </div>

        {/* Avisos vigentes */}
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>
              Avisos y ausencias ({avisosVigentes.length} vigentes)
            </div>
            <button style={{...S.btn,background:"var(--accent-dim)",color:"var(--accent-xl)",padding:"4px 10px",fontSize:11,border:"1px solid #1a3060"}}
              onClick={()=>{setEditAviso(null);setModalAviso(true);}}>
              + Añadir aviso
            </button>
          </div>

          {avisosVigentes.length===0
            ? <div style={{fontSize:12,color:"var(--text5)",padding:"8px 0"}}>Sin avisos activos</div>
            : avisosVigentes.map(a=>(
              <div key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"var(--bg3)",borderRadius:7,marginBottom:6,border:"1px solid #141a28"}}>
                <AvisoTag tipo={a.tipo}/>
                <span style={{flex:1,fontSize:12,color:"var(--text2)"}}>
                  {a.fecha_inicio} {a.fecha_fin?`-> ${a.fecha_fin}`:""} {a.descripcion?`- ${a.descripcion}`:""}
                </span>
                <button style={{...S.btn,background:"transparent",color:"var(--text4)",padding:"2px 6px",fontSize:11,border:"none"}}
                  onClick={()=>eliminarAviso(a.id)}>Cerrar</button>
              </div>
            ))
          }

          {avisosHist.length>0 && (
            <details style={{marginTop:8}}>
              <summary style={{fontSize:11,color:"var(--text5)",cursor:"pointer",userSelect:"none"}}>Ver historial ({avisosHist.length})</summary>
              {avisosHist.map(a=>(
                <div key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 12px",background:"var(--bg3)",borderRadius:7,marginTop:4,opacity:.6}}>
                  <AvisoTag tipo={a.tipo}/>
                  <span style={{fontSize:12,color:"var(--text3)"}}>{a.fecha_inicio} -> {a.fecha_fin} {a.descripcion?`- ${a.descripcion}`:""}</span>
                </div>
              ))}
            </details>
          )}
        </div>

        <div style={{display:"flex",justifyContent:"flex-end",gap:10,borderTop:"1px solid #141a28",paddingTop:16}}>
          <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid #1e2d45"}} onClick={onClose}>Cancelar</button>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={guardar} disabled={saving}>
            {saving?"Guardando...":"Guardar cambios"}
          </button>
        </div>
      </div>

      {modalAviso && (
        <ModalAviso
          chofer={form}
          aviso={editAviso}
          onClose={()=>setModalAviso(false)}
          onSaved={()=>{setModalAviso(false); getChoferes().then(ch=>{const c=ch.find(x=>x.id===chofer.id); if(c) setForm({...c});});}}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Componente principal
// ══════════════════════════════════════════════════════════════════════
export default function CuadranteChoferes() {
  const [choferes,  setChoferes]  = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [ficha,     setFicha]     = useState(null);
  const [filtroEst, setFiltroEst] = useState("todos");

  function cargar() {
    setLoading(true);
    Promise.all([getChoferes().catch(()=>[]), getVehiculos().catch(()=>[])])
      .then(([ch, vh]) => {
        setChoferes(Array.isArray(ch)?ch:[]);
        setVehiculos(Array.isArray(vh)?vh:[]);
      }).finally(()=>setLoading(false));
  }
  useEffect(cargar, []);

  const ahora = new Date();
  const filtrados = choferes.filter(c => filtroEst==="todos" || c.estado===filtroEst);

  function avisosVigentes(c) {
    return (c.avisos||[]).filter(a => !a.fecha_fin || new Date(a.fecha_fin) >= ahora);
  }

  return (
    <div style={S.page}>
      <div style={S.title}>Estado de Chóferes</div>
      <div style={S.sub}>Cuadrante - Disponibilidad, rutas activas y avisos de ausencias</div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[["todos","Todos"],["disponible","Disponibles"],["en_ruta","En ruta"],["vacaciones","Vacaciones"],["baja","Baja"],["inactivo","Inactivos"]].map(([v,l])=>(
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
      : filtrados.length===0 ? <div style={{textAlign:"center",color:"var(--text4)",padding:40,background:"var(--bg2)",border:"1px solid #141a28",borderRadius:12}}>Sin choferes</div>
      : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
          {filtrados.map(c => {
            const vigentes = avisosVigentes(c);
            return (
              <div key={c.id} style={{
                background:"var(--bg2)",border:"1px solid #141a28",borderRadius:12,padding:16,
                cursor:"pointer",transition:"border-color .15s",
                borderColor: vigentes.length>0 ? "#f97316_30" : "var(--border)",
              }}
                onClick={()=>setFicha(c)}
                onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border2)"}
                onMouseLeave={e=>e.currentTarget.style.borderColor=vigentes.length>0?"rgba(249,115,22,.2)":"var(--border)"}>

                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"var(--text)"}}>
                    {c.nombre}{c.apellidos ? " "+c.apellidos : ""}
                  </div>
                  <EstadoBadge estado={c.estado||"disponible"}/>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:8}}>
                  {[
                    ["Vehículo", (()=>{
                        const veh = vehiculos.find(v=>v.chofer_id===c.id || v.id===c.vehiculo_id);
                        if (!veh && !c.vehiculo_matricula) return "Sin asignar";
                        const mat = veh?.matricula || c.vehiculo_matricula || "-";
                        const rem = veh?.remolque_matricula;
                        return rem ? mat+" "+rem : mat;
                      })()],
                    ["Ubicación", c.ubicacion_actual || c.ubicacion_auto || c.ciudad || "-"],
                  ].map(([k,v],i)=>(
                    <div key={i}>
                      <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>{k}</div>
                      <div style={{fontSize:12,color:"var(--text2)",marginTop:1}}>{v}</div>
                    </div>
                  ))}
                </div>

                {vigentes.length>0 && (
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                    {vigentes.map((a,i)=><AvisoTag key={i} tipo={a.tipo}/>)}
                  </div>
                )}

                <div style={{marginTop:10,fontSize:11,color:"var(--text5)",textAlign:"right"}}>Click para abrir ficha -></div>
              </div>
            );
          })}
        </div>
      )}

      {ficha && (
        <FichaChofer chofer={ficha} onClose={()=>setFicha(null)} onSaved={()=>{setFicha(null);cargar();}} vehiculos={vehiculos}/>
      )}
    </div>
  );
}
