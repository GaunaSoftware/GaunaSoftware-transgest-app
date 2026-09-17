import { OrderSection, OrderDisclosure } from "./OrderEditorShell";

import EndpointAutocomplete from "../../../components/EndpointAutocomplete";

function pointDraft(form,side) {
 let stops=form[side==="carga"?"puntos_carga":"puntos_descarga"];
 try { if(typeof stops==="string") stops=JSON.parse(stops); } catch { stops=[]; }
 const point=Array.isArray(stops)?stops[0]||{}:{};
 return {...point,nombre:point.cliente_nombre||form[side==="carga"?"origen":"destino"],direccion:point.direccion||"",tipo:side,cliente_id:form.cliente_id||"",ventana:point.ventana||form[side==="carga"?"ventana_carga":"ventana_descarga"]||"",pais:point.pais||"España"};
}
export default function OrderRouteFields({ S, nombreBusqueda, form, clientes, setNombreBusqueda, setForm, setShowSuggestions, showSuggestions, setModalNuevoCliente, ivaOptionValue, editando, bloqueoClienteModal, clienteRiesgoLoading, clienteRiesgo, clienteRiesgoPedido, formatRiskPct, rutas, cmrInternacionalModal, tarifasCoincidentes, syncPrecioClienteCol, aplicarTarifaRutaADraft, rutaTarifaSugerida, applyRouteEndpointsFromSavedPoints, setShowCostes, calcularCosteGasoil, groupRutasByOrigen, rutaCompatibleConConjunto, rutasCompatibles, rutaIncompatible, rutaSeleccionada, tipoRemolqueActual, remolquesCompatiblesRuta, f, aplicarEndpointText, resolverEndpointEnFormulario, puntosCargaSugeridosModal, direccionCompletaPunto, applyPuntoCargaToDraft, puntosCargaClienteModal, PuntoInteresPicker, puntosCargaClienteLoading, setPoiDraft, setManagePointsMode, setManagePointsOpen, puntosDescargaSugeridosModal, applyPuntoDescargaToDraft }) {
 return <OrderSection title="Cliente, referencia y puntos" icon="clients">

            <div className="tg-pedido-form-grid-3"><div >
                <label style={S.label}>Cliente *</label>
                {/* Autocomplete por nombre */}
                <div style={{position:"relative"}}>
                  <input
                    placeholder="Escribe el nombre del cliente..."
                    style={{...S.input,width:"100%"}}
                    value={nombreBusqueda || (form.cliente_id ? clientes.find(c=>c.id===form.cliente_id)?.nombre||"" : "")}
                    onChange={e=>{
                      const val = e.target.value;
                      setNombreBusqueda(val);
                      if(!val) { setForm(p=>({...p,cliente_id:""})); }
                      setShowSuggestions(true);
                    }}
                    onFocus={()=>setShowSuggestions(true)}
                    onBlur={()=>setTimeout(()=>setShowSuggestions(false),200)}
                  />
                  {/* Sugerencias */}
                  {showSuggestions && nombreBusqueda && (()=>{
                    const sugs = clientes.filter(c=>
                      c.nombre.toLowerCase().includes(nombreBusqueda.toLowerCase()) ||
                      (c.cif||"").toLowerCase().includes(nombreBusqueda.toLowerCase())
                    ).slice(0,6);
                    if(sugs.length===0) return(
                      <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,zIndex:50,padding:"10px 14px"}}>
                        <div style={{fontSize:12,color:"var(--text4)",marginBottom:8}}>
                          No hay ningun cliente con ese nombre.
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <button type="button"
                            onClick={()=>{ setModalNuevoCliente({nombre:nombreBusqueda}); setShowSuggestions(false); }}
                            style={{...S.btn,background:"var(--accent)",color:"#fff",fontSize:12,padding:"5px 12px"}}>
                            Crear cliente "{nombreBusqueda}"
                          </button>
                          <button type="button"
                            onClick={()=>{ setNombreBusqueda(""); setShowSuggestions(false); }}
                            style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text4)",fontSize:12,padding:"5px 10px"}}>
                            Cancelar
                          </button>
                        </div>
                        <div style={{fontSize:11,color:"var(--text5)",marginTop:6}}>
                          Aviso: sin cliente no se puede crear el viaje.
                        </div>
                      </div>
                    );
                    return(
                      <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,zIndex:50,overflow:"hidden"}}>
                        {sugs.map(c=>(
                          <div key={c.id}
                            onMouseDown={()=>{
                              setForm(p=>({
                                ...p,
                                cliente_id: c.id,
                                tipo_iva: c.tipo_iva ?? p.tipo_iva ?? 21,
                                iva_regimen: c.iva_regimen || ivaOptionValue({ tipo_iva: c.tipo_iva ?? p.tipo_iva }),
                                ventana_carga: p.ventana_carga || c.horario_carga || "",
                                ventana_descarga: p.ventana_descarga || c.horario_descarga || "",
                                // Mercancia habitual del cliente (si no hay una escrita ya)
                                mercancia: p.mercancia || c.mercancia_habitual || "",
                              }));
                              setNombreBusqueda("");
                              setShowSuggestions(false);
                            }}
                            style={{padding:"9px 14px",cursor:"pointer",borderBottom:"1px solid var(--border2)",display:"flex",justifyContent:"space-between",alignItems:"center"}}
                            onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{c.nombre}</span>
                            {c.cif&&<span style={{fontSize:11,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>{c.cif}</span>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                {form.cliente_id && <button type="button" className="order-editor-clear-client" data-pedido-mutation="true" onClick={()=>{setForm(p=>({...p,cliente_id:""}));setNombreBusqueda("");}}>Quitar cliente</button>}

              </div><div><label style={S.label}>Referencia cliente</label><input style={S.input} value={form.referencia_cliente||""} onChange={f("referencia_cliente")} placeholder="Ref. pedido del cliente"/></div><div><label style={S.label}>Cargar tarifa / ruta guardada</label>
                <select value={form.ruta_id||""} onChange={e=>{
  const r=rutas.find(rt=>rt.id===e.target.value);
  setForm(p=>{
    const newForm = {...p, ruta_id:e.target.value};
    if (r) {
      // Auto-fill route data
      if (r.origen)  newForm.origen  = r.origen;
      if (r.destino) newForm.destino = r.destino;
      if (r.km)      newForm.km_ruta = r.km;
      Object.assign(newForm, applyRouteEndpointsFromSavedPoints(newForm, r));

      // Auto-fill peajes cost if ruta has it
      if (r.peajes && Number(r.peajes) > 0) {
        newForm.coste_peajes = Number(r.peajes);
      }
      Object.assign(newForm, aplicarTarifaRutaADraft(newForm, r));

      // Auto-fill estimated gasoil cost if km available
      if (r.km && !newForm.colaborador_id) {
        newForm.coste_gasoil = calcularCosteGasoil(newForm);
      }
    }
    return syncPrecioClienteCol(newForm);
  });
}} style={S.sel}>
                  <option value="">Sin ruta / Manual</option>
                  {groupRutasByOrigen(rutas).map(g => (
                    <optgroup key={g.origen} label={g.origen}>
                      {g.rutas.map(r=>{
                        const compatible = rutaCompatibleConConjunto(r);
                        const tipoReq = r.tipo_vehiculo && r.tipo_vehiculo !== "cualquiera" ? ` (${r.tipo_vehiculo})` : "";
                        return (
                          <option key={r.id} value={r.id} disabled={!compatible}>
                            {r.destino}{tipoReq}{!compatible ? " - requiere cambio de remolque" : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
                <div style={{marginTop:6,fontSize:11,color:"var(--text5)"}}>
                  Al seleccionar una ruta se cargan automaticamente origen, destino, km, precio, minimo facturable y recargo.
                </div>
                {form.cliente_id && rutas.length > rutasCompatibles.length && (
                  <div style={{marginTop:6,fontSize:11,color:"var(--text5)"}}>
                    Hay {rutas.length - rutasCompatibles.length} ruta(s) del cliente no compatibles con el remolque actual. Cambia el remolque para poder seleccionarlas.
                  </div>
                )}
                {rutaIncompatible && (
                  <div style={{marginTop:6,fontSize:11,color:"#f59e0b",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.22)",borderRadius:7,padding:"7px 9px"}}>
                    La ruta exige {rutaSeleccionada.tipo_vehiculo}; el remolque actual parece {tipoRemolqueActual || "sin clasificar"}. Cambia el remolque a uno compatible antes de guardar.
                    {remolquesCompatiblesRuta.length > 0 && (
                      <button data-pedido-mutation="true" type="button" onClick={()=>setForm(p=>({...p,remolque_id_manual:remolquesCompatiblesRuta[0].id}))}
                        style={{marginLeft:8,padding:"3px 8px",borderRadius:6,border:"1px solid rgba(245,158,11,.35)",background:"transparent",color:"#f59e0b",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                        Usar {remolquesCompatiblesRuta[0].matricula}
                      </button>
                    )}
                  </div>
                )}
              </div></div>{!editando?.id && bloqueoClienteModal && (
                <div style={{gridColumn:"1/-1",padding:"10px 12px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,fontSize:12,color:"#b91c1c",fontWeight:800}}>
                  {bloqueoClienteModal.title}: {bloqueoClienteModal.message}
                </div>
              )}{form.cliente_id && clienteRiesgoLoading && (
                <div style={{gridColumn:"1/-1",padding:"8px 12px",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:7,fontSize:12,color:"var(--text4)"}}>
                  Revisando cobros pendientes y limite de riesgo del cliente...
                </div>
              )}{form.cliente_id && clienteRiesgo && (() => {
                const nivel = clienteRiesgoPedido.nivel || "medio";
                const danger = nivel === "critico" || nivel === "alto";
                const color = nivel === "critico" ? "#ef4444" : danger ? "#f59e0b" : "#22c55e";
                const money = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (!danger && !clienteRiesgoPedido.avisos.length) return <div className="order-editor-risk-ok">✓ Cliente sin alertas de cobro</div>;
                return (
                  <div style={{gridColumn:"1/-1",padding:"10px 12px",background:danger ? "rgba(245,158,11,.09)" : "rgba(34,197,94,.08)",border:`1px solid ${danger ? "rgba(245,158,11,.3)" : "rgba(34,197,94,.24)"}`,borderRadius:8,display:"grid",gap:6}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
                      <strong style={{fontSize:12,color}}>Aviso de cobro/riesgo del cliente</strong>
                      <span style={{fontSize:18,color,fontWeight:900,fontFamily:"'JetBrains Mono',monospace"}}>
                        {formatRiskPct(clienteRiesgoPedido.riesgo_pct_actual)}
                      </span>
                    </div>
                    <div style={{fontSize:11,color:"var(--text4)"}}>
                      Pendiente: {money(clienteRiesgo.total_pendiente)} EUR
                      {clienteRiesgo.limite_riesgo > 0 ? ` de ${money(clienteRiesgo.limite_riesgo)} EUR` : " | Sin limite de riesgo configurado"}
                      {clienteRiesgoPedido.riesgo_pct_proyectado !== null ? ` | con este pedido: ${formatRiskPct(clienteRiesgoPedido.riesgo_pct_proyectado)}` : ""}
                    </div>
                    {clienteRiesgoPedido.avisos.length > 0 && (
                      <div style={{display:"grid",gap:4}}>
                        {clienteRiesgoPedido.avisos.map((av, idx) => (
                          <div key={`${av.tipo}-${idx}`} style={{fontSize:12,color:"var(--text3)"}}>{av.mensaje}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}{tarifasCoincidentes.length > 1 && !form.ruta_id && <div role="status" style={{gridColumn:'1/-1',padding:12,border:'1px solid var(--border2)',borderRadius:8}}>
                <strong>Hay varias tarifas compatibles. Selecciona la que corresponde.</strong>
                <p>Se conservarán las direcciones del pedido.</p>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{tarifasCoincidentes.map(r=><button type="button" data-pedido-mutation="true" key={r.id} style={S.btn} onClick={()=>setForm(p=>syncPrecioClienteCol(aplicarTarifaRutaADraft({...p,ruta_id:r.id},r)))}>
                  {r.origen} → {r.destino} · {Number(r.precio_base||0).toLocaleString('es-ES')} € / {r.tarifa_tipo||'viaje'}
                </button>)}</div>
              </div>}{form.cliente_id&&form.origen&&form.destino&&(()=>{
                const rutaTarifa = rutaTarifaSugerida;
                if(!rutaTarifa) return null;
                const precioVista = Number(rutaTarifa.precio_base || 0) * (1 + ((Number(rutaTarifa.recargo_combustible_pct || 0) || 0) / 100));
                const tipos={viaje:"viaje",kg:"EUR/100kg",tonelada:"EUR/tn",km:"EUR/km",hora:"EUR/h",palet:"EUR/palet"};
                return(
                  <div style={{gridColumn:"1/-1",padding:"8px 12px",background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.2)",borderRadius:7,display:"flex",alignItems:"center",gap:10,fontSize:12}}>
                    <span style={{fontSize:14}}>Ruta</span>
                    <span style={{color:"var(--text3)"}}>
                      {form.ruta_id === rutaTarifa.id ? "✓ Tarifa aplicada:" : "Tarifa disponible:"} <strong style={{color:"#10b981"}}>{precioVista.toLocaleString("es-ES",{minimumFractionDigits:2})} EUR {tipos[rutaTarifa.tarifa_tipo]||rutaTarifa.tarifa_tipo}</strong>
                      {Number(rutaTarifa.recargo_combustible_pct||0)>0 && <span style={{marginLeft:8,color:"#fbbf24"}}>+{Number(rutaTarifa.recargo_combustible_pct).toLocaleString("es-ES")} % combustible</span>}
                    </span>
                    {form.ruta_id !== rutaTarifa.id && <button type="button" data-pedido-mutation="true" onClick={()=>{
                      setForm(p=>{
                        const next = aplicarTarifaRutaADraft(p, rutaTarifa);
                        return syncPrecioClienteCol(next);
                      });
                    }} style={{marginLeft:"auto",padding:"3px 10px",borderRadius:5,border:"none",background:"rgba(16,185,129,.2)",color:"#10b981",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Aplicar precio
                    </button>}
                  </div>
                );
              })()}<OrderDisclosure title="Cambiar origen / destino y gestionar puntos" initiallyOpen={!form.origen || !form.destino}><div className="tg-pedido-form-grid-2"><div>
                <label style={S.label}>Origen (carga) *</label>
                <EndpointAutocomplete
                  inputStyle={S.input}
                  value={form.origen||""}
                  onChange={aplicarEndpointText("origen", "carga")}
                  onBlur={e=>resolverEndpointEnFormulario("origen", "carga", e.currentTarget.value)}
                  placeholder="Escribe o elige un punto de carga"
                  suggestions={puntosCargaSugeridosModal}
                  getValue={p => p.nombre || p.direccion}
                  getLabel={p => direccionCompletaPunto(p) || p.direccion || p.nombre}
                  onPick={p => setForm(x => applyPuntoCargaToDraft(x, p))}
                />
                {form.cliente_id && (
                  <div style={{marginTop:6}}>
                    {puntosCargaClienteModal.length > 0 ? (
                      <PuntoInteresPicker
                        placeholder="Elegir punto de carga del cliente"
                        puntos={puntosCargaClienteModal}
                        clienteId={form.cliente_id}
                        tipo="carga"
                        onPick={p=>setForm(x=>applyPuntoCargaToDraft(x, p))}
                        style={{...S.sel,width:"100%"}}
                      />
                    ) : (
                      <div style={{fontSize:11,color:"var(--text5)",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:7,padding:"7px 9px"}}>
                        {puntosCargaClienteLoading ? "Cargando puntos de carga del cliente..." : "Este cliente no tiene puntos de carga propios. Crea un punto nuevo asociado a este cliente."}
                      </div>
                    )}
                  </div>
                )}
                <div className="tg-pedido-actions-row">
                  <PuntoInteresPicker
                    placeholder="Usar punto como origen"
                    clienteId={form.cliente_id}
                    tipo="carga"
                    onPick={p=>setForm(x=>applyPuntoCargaToDraft(x, p))}
                    style={{...S.sel,flex:1}}
                  />
                  <button type="button" onClick={()=>setPoiDraft(pointDraft(form,"carga"))} disabled={!form.origen?.trim()}
                    style={{...S.btn,background:"transparent",color:form.origen?.trim()?"var(--accent)":"var(--text5)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Guardar punto
                  </button>
                  <button type="button" onClick={()=>{ setManagePointsMode("carga"); setManagePointsOpen(true); }}
                    style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Puntos
                  </button>
                </div>
              </div><div>
                <label style={S.label}>Destino (entrega) *</label>
                <EndpointAutocomplete
                  inputStyle={S.input}
                  value={form.destino||""}
                  onChange={aplicarEndpointText("destino", "descarga")}
                  onBlur={e=>resolverEndpointEnFormulario("destino", "descarga", e.currentTarget.value)}
                  placeholder="Escribe o elige un punto de descarga"
                  suggestions={puntosDescargaSugeridosModal}
                  getValue={p => p.nombre || p.direccion}
                  getLabel={p => direccionCompletaPunto(p) || p.direccion || p.nombre}
                  onPick={p => setForm(x => applyPuntoDescargaToDraft(x, p))}
                />
                <div className="tg-pedido-actions-row">
                  <PuntoInteresPicker
                    placeholder="Usar punto como destino"
                    clienteId={form.cliente_id}
                    tipo="descarga"
                    onPick={p=>setForm(x=>{
                      return applyPuntoDescargaToDraft(x, p);
                    })}
                    style={{...S.sel,flex:1}}
                  />
                  <button type="button" onClick={()=>setPoiDraft(pointDraft(form,"descarga"))} disabled={!form.destino?.trim()}
                    style={{...S.btn,background:"transparent",color:form.destino?.trim()?"var(--accent)":"var(--text5)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Guardar punto
                  </button>
                  <button type="button" onClick={()=>{ setManagePointsMode("descarga"); setManagePointsOpen(true); }}
                    style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Puntos
                  </button>
                </div>
              </div></div></OrderDisclosure><OrderDisclosure title="Información de ruta y documentación" initiallyOpen={false}>{form.cliente_id && rutas.length > 0 && (
                <div style={{gridColumn:"1/-1",padding:"8px 12px",background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.2)",borderRadius:7,fontSize:12,color:"var(--text3)"}}>
                  Hay {rutas.length} tarifa(s) guardada(s) para este cliente. Usa "Cargar tarifa / ruta guardada" para rellenar origen, destino, km, precio, minimos y recargos.
                </div>
              )}{cmrInternacionalModal && (
                <div style={{gridColumn:"1/-1",padding:"9px 12px",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.22)",borderRadius:8,fontSize:12,color:"var(--text3)",lineHeight:1.35}}>
                  <strong style={{color:"#2563eb"}}>eCMR internacional:</strong> origen o destino fuera de España. El documento se preparara como CMR internacional con trazabilidad, firmas/evidencias, historial y exportacion eFTI/eCMR cuando generes la carta de porte/documento digital.
                </div>
              )}</OrderDisclosure>


 </OrderSection>;
}
