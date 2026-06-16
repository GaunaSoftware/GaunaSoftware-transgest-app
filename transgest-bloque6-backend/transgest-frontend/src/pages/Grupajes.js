import { useState, useEffect, useCallback } from "react";
import { getGrupajes, crearGrupaje, editarGrupaje, getPedidos, addPedidoGrupaje, quitarPedidoGrupaje, getVehiculos, getChoferes } from "../services/api";
import { notify } from "../services/notify";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const S = {
  page:  {flex:1,padding:"24px 28px",overflowY:"auto"},
  title: {fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,marginBottom:6,color:"var(--text)"},
  btn:   {padding:"7px 14px",borderRadius:7,border:"none",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  inp:   {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
  card:  {background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:16},
};
const CAMION_KG_MIN=24000;

function esTractora(v) {
  const cl=(v.clase||v.tipo||"").toLowerCase();
  return !cl.includes("remolque")&&!cl.includes("semirremolque")&&!cl.includes("dolly");
}
function calcOcupacion(g, pedidos) {
  const peds = pedidos.filter(p=>String(p.grupaje_id)===String(g.id));
  const kg = peds.reduce((s,p)=>s+Number(p.peso_kg||0),0);
  const pct = g.kg_disponible>0?(kg/g.kg_disponible)*100:0;
  return { peds, kg, pct };
}

export default function Grupajes() {
  const [grupajes,  setGrupajes]  = useState([]);
  const [pedidos,   setPedidos]   = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [choferes,  setChoferes]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [sel,       setSel]       = useState(null);
  const [modalNew,  setModalNew]  = useState(false);
  const [newForm,   setNewForm]   = useState({nombre:"",vehiculo_id:"",chofer_id:"",fecha:new Date().toISOString().slice(0,10),kg_disponible:CAMION_KG_MIN});
  const [saving,    setSaving]    = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    const _tout = (pr, ms=8000) => Promise.race([pr, new Promise(r=>setTimeout(()=>r([]),ms))]);
    try {
      const [g,p,v,c] = await Promise.all([
        getGrupajes().catch(()=>[]),
        _tout(getPedidos().catch(()=>[])),
        getVehiculos().catch(()=>[]),
        getChoferes().catch(()=>[]),
      ]);
      const gs = Array.isArray(g)?g:[];
      const ps = Array.isArray(p)?p:[];
      setGrupajes(gs);
      setPedidos(ps.filter(pd=>pd.tipo_carga==="grupaje"));
      setVehiculos(Array.isArray(v)?v:[]);
      setChoferes(Array.isArray(c)?c:[]);
      if (gs.length>0) setSel(prev=>prev?gs.find(x=>x.id===prev.id)||gs[0]:gs[0]);
    } finally { setLoading(false); }
  }, []);

  useEffect(()=>{ cargar(); },[cargar]);

  // Pedidos grupaje without a grupaje assigned = pending
  const pendientes = pedidos.filter(p=>!p.grupaje_id);
  const tractoras  = vehiculos.filter(esTractora);

  async function crear() {
    if (!newForm.nombre) { notify("Indica un nombre", "warning"); return; }
    setSaving(true);
    try {
      const g = await crearGrupaje(newForm);
      setModalNew(false);
      await cargar();
      setSel(g);
    } catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  async function asignar(gid, pid) {
    await addPedidoGrupaje(gid, pid).catch(e=>notify(e.message, "error"));
    cargar();
  }

  async function desasignar(gid, pid) {
    await quitarPedidoGrupaje(gid, pid).catch(e=>notify(e.message, "error"));
    cargar();
  }

  return (
    <div style={S.page}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={S.title}>🔗 Grupajes</div>
          <div style={{fontSize:12,color:"var(--text4)"}}>Combina pedidos de carga parcial en un mismo camión</div>
        </div>
        <button onClick={()=>setModalNew(true)} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>+ Nuevo grupaje</button>
      </div>

      {/* Pending alert */}
      {pendientes.length>0 && (
        <div style={{background:"rgba(245,158,11,.09)",border:"1px solid rgba(245,158,11,.35)",borderRadius:10,padding:"10px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:18}}>⚡</span>
          <div>
            <span style={{fontWeight:700,color:"#f59e0b",fontSize:13}}>{pendientes.length} pedido{pendientes.length>1?"s":""} de grupaje sin asignar</span>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:1}}>
              {pendientes.map(p=>`${p.numero} (${Number(p.peso_kg||0).toLocaleString("es-ES")}kg → ${p.destino||"?"})`).join(" · ")}
            </div>
          </div>
          {grupajes.length===0 && (
            <button onClick={()=>setModalNew(true)} style={{...S.btn,background:"#f59e0b",color:"#000",padding:"5px 12px",fontSize:12,marginLeft:"auto"}}>Crear grupaje</button>
          )}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"290px 1fr",gap:14,alignItems:"start"}}>
        {/* Left panel: grupajes list */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Grupajes ({grupajes.length})</div>
          {loading ? <div style={{color:"var(--text5)",fontSize:12,padding:12}}>Cargando...</div> :
            grupajes.length===0
              ? <div style={{...S.card,textAlign:"center",padding:24,color:"var(--text5)",fontSize:12}}>
                  Sin grupajes aún.<br/>Crea uno para empezar.
                </div>
              : grupajes.map(g=>{
                  const {peds,kg,pct} = calcOcupacion(g,pedidos);
                  const isSelected = sel?.id===g.id;
                  return (
                    <div key={g.id} onClick={()=>setSel(g)} style={{
                      ...S.card, cursor:"pointer", marginBottom:8,
                      borderColor:isSelected?"var(--accent)":"var(--border2)",
                      background:isSelected?"rgba(59,130,246,.07)":"var(--bg2)"
                    }}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:4}}>
                        <div style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>{g.nombre}</div>
                        <span style={{fontSize:10,padding:"2px 7px",borderRadius:8,fontWeight:700,
                          background:g.estado==="cerrado"?"rgba(16,185,129,.15)":g.estado==="en_curso"?"rgba(59,130,246,.15)":"var(--bg4)",
                          color:g.estado==="cerrado"?"var(--green)":g.estado==="en_curso"?"var(--accent)":"var(--text5)"}}>
                          {g.estado}
                        </span>
                      </div>
                      <div style={{fontSize:11,color:"var(--text5)",marginBottom:6}}>
                        {g.fecha&&<span style={{marginRight:8}}>{new Date(g.fecha).toLocaleDateString("es-ES")}</span>}
                        {g.vehiculo_matricula&&<span style={{marginRight:8}}>🚛 {g.vehiculo_matricula}</span>}
                        <span>{peds.length} pedido{peds.length!==1?"s":""}</span>
                      </div>
                      {/* Weight bar */}
                      <div style={{background:"var(--bg4)",borderRadius:3,height:5,overflow:"hidden"}}>
                        <div style={{width:`${Math.min(pct,100)}%`,height:"100%",borderRadius:3,
                          background:pct>90?"var(--red)":pct>70?"#f59e0b":"var(--accent)",transition:"width .3s"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text5)",marginTop:2}}>
                        <span>{Number(kg).toLocaleString("es-ES")}kg</span>
                        <span style={{color:pct>90?"var(--red)":pct>70?"#f59e0b":"var(--green)",fontWeight:700}}>{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })
          }
        </div>

        {/* Right panel: detail */}
        {sel ? (
          <GrupajeDetalle
            grupaje={sel}
            pedidos={pedidos}
            pendientes={pendientes}
            tractoras={tractoras}
            choferes={choferes}
            calcOcupacion={calcOcupacion}
            onAsignar={(pid)=>asignar(sel.id,pid)}
            onDesasignar={(pid)=>desasignar(sel.id,pid)}
            onUpdate={d=>editarGrupaje(sel.id,d).then(cargar)}
            onReload={cargar}
          />
        ) : (
          <div style={{...S.card,textAlign:"center",padding:40,color:"var(--text5)"}}>
            <div style={{fontSize:36,marginBottom:10}}>🔗</div>
            <div style={{fontWeight:700,color:"var(--text)"}}>Selecciona un grupaje</div>
          </div>
        )}
      </div>

      {/* Modal nuevo grupaje */}
      {modalNew && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={e=>e.target===e.currentTarget&&setModalNew(false)}>
          <div style={{...S.card,width:"min(480px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,color:"var(--text)",marginBottom:16}}>Nuevo grupaje</div>
            {[
              ["Nombre *", <input style={S.inp} value={newForm.nombre} onChange={e=>setNewForm(p=>({...p,nombre:e.target.value}))} placeholder="Ej: Valencia-Madrid 25 Mar"/>],
              ["Fecha", <input type="date" style={S.inp} value={newForm.fecha} onChange={e=>setNewForm(p=>({...p,fecha:e.target.value}))}/>],
              ["Tractora (solo tractoras)", <select style={S.inp} value={newForm.vehiculo_id} onChange={e=>setNewForm(p=>({...p,vehiculo_id:e.target.value}))}>
                <option value="">— Sin asignar —</option>
                {tractoras.filter(v=>v.activo).map(v=><option key={v.id} value={v.id}>{v.matricula} {v.marca||""}</option>)}
              </select>],
              ["Chófer", <select style={S.inp} value={newForm.chofer_id} onChange={e=>setNewForm(p=>({...p,chofer_id:e.target.value}))}>
                <option value="">— Sin asignar —</option>
                {choferes.filter(c=>c.activo).map(c=><option key={c.id} value={c.id}>{c.nombre} {c.apellidos||""}</option>)}
              </select>],
              ["Kg disponibles", <input type="number" style={S.inp} value={newForm.kg_disponible} onChange={e=>setNewForm(p=>({...p,kg_disponible:Number(e.target.value)}))} onFocus={e=>e.target.select()}/>],
            ].map(([lbl,input])=>(
              <div key={String(lbl)} style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:3}}>{lbl}</div>
                {input}
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button onClick={()=>setModalNew(false)} style={{...S.btn,background:"var(--bg4)",color:"var(--text3)",border:"1px solid var(--border2)"}}>Cancelar</button>
              <button onClick={crear} disabled={saving} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>{saving?"Creando...":"Crear grupaje"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GrupajeDetalle({ grupaje, pedidos, pendientes, tractoras, choferes, calcOcupacion, onAsignar, onDesasignar, onUpdate, onReload }) {
  const { peds, kg, pct } = calcOcupacion(grupaje, pedidos);
  const disponibles = pendientes; // already filtered to tipo_carga=grupaje && !grupaje_id

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Header card */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,color:"var(--text)"}}>{grupaje.nombre}</div>
            <div style={{fontSize:12,color:"var(--text5)",marginTop:2}}>
              {grupaje.fecha&&`${new Date(grupaje.fecha).toLocaleDateString("es-ES")} · `}{peds.length} pedidos · {Number(kg).toLocaleString("es-ES")} kg
            </div>
          </div>
          <select value={grupaje.estado||"pendiente"} onChange={e=>onUpdate({estado:e.target.value})}
            style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"5px 10px",borderRadius:7,fontSize:12,outline:"none",cursor:"pointer"}}>
            {["pendiente","en_curso","cerrado"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Assign tractora - only tractoras shown */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:3}}>Tractora asignada</div>
            <select value={grupaje.vehiculo_id||""} onChange={e=>onUpdate({vehiculo_id:e.target.value||null})}
              style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"6px 10px",borderRadius:7,fontSize:12,outline:"none",width:"100%"}}>
              <option value="">— Solo tractoras —</option>
              {tractoras.filter(v=>v.activo).map(v=><option key={v.id} value={v.id}>{v.matricula}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:3}}>Chófer</div>
            <select value={grupaje.chofer_id||""} onChange={e=>onUpdate({chofer_id:e.target.value||null})}
              style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"6px 10px",borderRadius:7,fontSize:12,outline:"none",width:"100%"}}>
              <option value="">— Sin asignar —</option>
              {choferes.filter(c=>c.activo).map(c=><option key={c.id} value={c.id}>{c.nombre} {c.apellidos||""}</option>)}
            </select>
          </div>
        </div>

        {/* Occupancy bar */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
            <span style={{color:"var(--text4)"}}>Ocupación: {Number(kg).toLocaleString("es-ES")} / {Number(grupaje.kg_disponible).toLocaleString("es-ES")} kg</span>
            <span style={{fontWeight:700,color:pct>90?"var(--red)":pct>70?"#f59e0b":"var(--green)"}}>{pct.toFixed(1)}%</span>
          </div>
          <div style={{background:"var(--bg4)",borderRadius:6,height:10,overflow:"hidden"}}>
            <div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:pct>90?"var(--red)":pct>70?"#f59e0b":"var(--accent)",borderRadius:6,transition:"width .4s"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text5)",marginTop:2}}>
            <span>{Number(grupaje.kg_disponible-kg).toLocaleString("es-ES")} kg libres</span>
            <span>Total ingresos: <strong style={{color:"var(--green)"}}>{fmt2(peds.reduce((s,p)=>s+Number(p.importe||0),0))} €</strong></span>
          </div>
        </div>
      </div>

      {/* Pedidos asignados */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:16}}>
        <div style={{fontWeight:700,fontSize:12,color:"var(--text5)",textTransform:"uppercase",marginBottom:10}}>
          Pedidos en este grupaje ({peds.length})
        </div>
        {peds.length===0
          ? <div style={{color:"var(--text5)",fontSize:12,textAlign:"center",padding:"12px 0"}}>
              Sin pedidos asignados. Añade pedidos desde abajo.
            </div>
          : peds.map(p=>(
            <div key={p.id} style={{display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:"1px solid var(--border2)"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:12,color:"var(--text)"}}>{p.numero}</div>
                <div style={{fontSize:11,color:"var(--text5)"}}>
                  📍 {p.origen||"?"} → {p.destino||"?"}
                  {p.fecha_carga&&<span style={{marginLeft:8}}>📅 Carga: {new Date(p.fecha_carga).toLocaleDateString("es-ES")}</span>}
                  {p.fecha_descarga&&<span style={{marginLeft:8}}>📅 Descarga: {new Date(p.fecha_descarga).toLocaleDateString("es-ES")}</span>}
                </div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:1}}>
                  {Number(p.peso_kg||0).toLocaleString("es-ES")} kg · {fmt2(p.importe)} €
                  {p.cliente_nombre&&<span style={{marginLeft:8,color:"var(--text5)"}}>— {p.cliente_nombre}</span>}
                </div>
              </div>
              <button onClick={()=>onDesasignar(p.id)}
                style={{padding:"3px 8px",borderRadius:5,border:"none",background:"rgba(239,68,68,.1)",color:"var(--red)",fontSize:11,cursor:"pointer",fontWeight:700}}>
                Quitar
              </button>
            </div>
          ))
        }
      </div>

      {/* Disponibles para añadir */}
      {disponibles.length>0 && (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:16}}>
          <div style={{fontWeight:700,fontSize:12,color:"var(--text5)",textTransform:"uppercase",marginBottom:10}}>
            Pedidos de grupaje disponibles ({disponibles.length})
          </div>
          {disponibles.map(p=>{
            const kgNuevo = kg + Number(p.peso_kg||0);
            const pctNuevo = grupaje.kg_disponible>0?(kgNuevo/grupaje.kg_disponible)*100:0;
            const cabe = kgNuevo <= grupaje.kg_disponible;
            return (
              <div key={p.id} style={{display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:"1px solid var(--border2)",opacity:cabe?1:0.5}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:12,color:"var(--text)"}}>{p.numero} — {p.origen||"?"} → {p.destino||"?"}</div>
                  <div style={{fontSize:11,color:"var(--text5)"}}>
                    {Number(p.peso_kg||0).toLocaleString("es-ES")} kg · {fmt2(p.importe)} €
                    {!cabe&&<span style={{color:"var(--red)",marginLeft:6,fontWeight:700}}>Supera capacidad ({pctNuevo.toFixed(0)}%)</span>}
                    {cabe&&<span style={{color:"var(--green)",marginLeft:6}}>→ quedaría al {pctNuevo.toFixed(0)}%</span>}
                  </div>
                </div>
                <button onClick={()=>cabe&&onAsignar(p.id)} disabled={!cabe}
                  style={{padding:"4px 12px",borderRadius:6,border:"none",
                    background:cabe?"rgba(59,130,246,.15)":"var(--bg4)",
                    color:cabe?"var(--accent)":"var(--text5)",fontSize:11,cursor:cabe?"pointer":"not-allowed",fontWeight:700}}>
                  {cabe?"+ Añadir":"No cabe"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
