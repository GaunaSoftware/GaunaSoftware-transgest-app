import { OrderSection, OrderDisclosure } from "./OrderEditorShell";


export default function OrderPlanningFields({ S, form, f, editando, esGerente, ESTADOS_RAW, LABEL_ESTADO, getPrimaryStopField, setForm, updatePrimaryStop, etiquetasCatalogo }) {
 return <OrderSection title="Planificación" icon="clock">

            <div className="order-editor-planning-grid"><div><label style={S.label}>Fecha carga</label><input type="date" min="2000-01-01" max="2100-12-31" style={S.input} value={form.fecha_carga||""} onChange={f("fecha_carga")}/></div>
<div><label style={S.label}>Hora carga</label><input type="time" style={S.input} value={form.hora_carga||""} onChange={f("hora_carga")}/></div>
<div><label style={S.label}>Ventana carga</label><input style={S.input} value={form.ventana_carga||""} onChange={f("ventana_carga")} placeholder="08:00-14:00"/></div>
<div><label style={S.label}>Fecha descarga</label><input type="date" min="2000-01-01" max="2100-12-31" style={S.input} value={form.fecha_descarga||""} onChange={f("fecha_descarga")}/></div>
<div><label style={S.label}>Hora descarga</label><input type="time" style={S.input} value={form.hora_descarga||""} onChange={f("hora_descarga")}/></div>
<div><label style={S.label}>Ventana descarga</label><input style={S.input} value={form.ventana_descarga||""} onChange={f("ventana_descarga")} placeholder="07:00-17:00"/></div>
<div><label style={S.label}>Estado</label>
                <select
                  value={form.estado||"pendiente"}
                  onChange={f("estado")}
                  disabled={editando?.id && String(editando?.estado || "").toLowerCase() === "entregado" && !esGerente}
                  style={{...S.sel,opacity:editando?.id && String(editando?.estado || "").toLowerCase() === "entregado" && !esGerente ? 0.65 : 1}}
                >
                  {ESTADOS_RAW.map(e=><option key={e} value={e}>{LABEL_ESTADO[e]}</option>)}
                </select>
                {editando?.id && String(editando?.estado || "").toLowerCase() === "entregado" && !esGerente && (
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Estado bloqueado: solo gerencia puede cambiar un pedido entregado.</div>
                )}
              </div></div><div className="order-editor-map-links">{getPrimaryStopField(form.puntos_carga,"google_maps_url") && <a href={getPrimaryStopField(form.puntos_carga,"google_maps_url")} target="_blank" rel="noopener noreferrer">Ver carga en Maps ↗</a>} {getPrimaryStopField(form.puntos_descarga,"google_maps_url") && <a href={getPrimaryStopField(form.puntos_descarga,"google_maps_url")} target="_blank" rel="noopener noreferrer">Ver descarga en Maps ↗</a>}</div><OrderDisclosure title="Más opciones de planificación" initiallyOpen={false}><div className="tg-pedido-form-grid-3"><div><label style={S.label}>Fecha pedido</label><input type="date" min="2000-01-01" max="2100-12-31" style={S.input} value={form.fecha_pedido||""} onChange={f("fecha_pedido")}/></div>
<div style={{gridColumn:"1/3"}}>
                <label style={S.label}>Google Maps carga</label>
                <input
                  style={S.input}
                  value={getPrimaryStopField(form.puntos_carga, "google_maps_url")}
                  onChange={e=>setForm(p=>({
                    ...p,
                    puntos_carga: updatePrimaryStop(
                      p.puntos_carga,
                      { google_maps_url: e.target.value },
                      p.origen || ""
                    ),
                  }))}
                  placeholder="https://maps.google.com/..."
                />
              </div>
<div style={{gridColumn:"3/5"}}>
                <label style={S.label}>Google Maps descarga</label>
                <input
                  style={S.input}
                  value={getPrimaryStopField(form.puntos_descarga, "google_maps_url")}
                  onChange={e=>setForm(p=>({
                    ...p,
                    puntos_descarga: updatePrimaryStop(
                      p.puntos_descarga,
                      { google_maps_url: e.target.value },
                      p.destino || ""
                    ),
                  }))}
                  placeholder="https://maps.google.com/..."
                />
              </div></div>{etiquetasCatalogo.length > 0 && (
              <div style={{margin:"2px 0 12px"}}>
                <label style={S.label}>Etiquetas del viaje</label>
                {(()=>{
                  const etiquetaTipo = (e) => e?.tipo === "perfil" ? "perfil" : e?.tipo === "categoria" ? "categoria" : (String(e?.auto_match||"").trim() ? "categoria" : "perfil");
                  const grupoLabel = {fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",color:"var(--text5)",margin:"4px 0 4px"};
                  const chip = (et)=>{
                    const nombre = String(et.nombre||"").trim();
                    if(!nombre) return null;
                    const activa = Array.isArray(form.etiquetas) && form.etiquetas.map(String).includes(nombre);
                    return (
                      <button type="button" key={nombre}
                        onClick={()=>setForm(p=>{
                          const list = Array.isArray(p.etiquetas)?p.etiquetas.map(String).filter(Boolean):[];
                          const set = new Set(list);
                          set.has(nombre)?set.delete(nombre):set.add(nombre);
                          return {...p, etiquetas:[...set]};
                        })}
                        style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 11px",borderRadius:20,border:`1px solid ${activa?(et.color||"var(--accent)"):"var(--border2)"}`,background:activa?`${et.color||"#14b8a6"}22`:"var(--bg4)",color:activa?"var(--text)":"var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                        <span style={{width:9,height:9,borderRadius:"50%",background:et.color||"var(--accent-l)",display:"inline-block"}}/>
                        {nombre}
                      </button>
                    );
                  };
                  const cats = etiquetasCatalogo.filter(e=>etiquetaTipo(e)==="categoria" && String(e.nombre||"").trim());
                  const perfs = etiquetasCatalogo.filter(e=>etiquetaTipo(e)==="perfil" && String(e.nombre||"").trim());
                  return (
                    <>
                      {cats.length>0 && (<>
                        <div style={grupoLabel}>Categorias de vehiculo</div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{cats.map(chip)}</div>
                      </>)}
                      {perfs.length>0 && (<>
                        <div style={{...grupoLabel,marginTop:8}}>Perfiles de viaje</div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{perfs.map(chip)}</div>
                      </>)}
                    </>
                  );
                })()}
              </div>
            )}</OrderDisclosure>


 </OrderSection>;
}
