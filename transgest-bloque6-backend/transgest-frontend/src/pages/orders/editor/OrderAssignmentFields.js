import { clearAssignmentPatch } from "../../../utils/assignment";
import { OrderSection, OrderDisclosure } from "./OrderEditorShell";
import React from "react";
import { assignDriver } from "../quickInfo";
import { driverName } from "../quickInfo";
import { parseLocaleNumber } from "../../../utils/number";
import { supplierPriceType } from "../../../utils/supplierPricing";
import { formatMatricula } from "../../../utils/formatos";
import { getEmpresaPerfilSync } from "../../../hooks/useEmpresaPerfil";
import { formatDni } from "../../../utils/formatos";

export default function OrderAssignmentFields({ S, form, vehiculosLocal, autoEtiquetasVehiculo, etiquetasCatalogo, setForm, choferesLocal, mergeEtiquetas, isMeaningfulVehicleNotice, setAvisoVehiculo, avisoCargaExcedeRemolque, cargaMetrosLineales, remolqueActual, remolqueMetrosCarga, f, colaboradorBusqueda, setColaboradorBusqueda, setShowColaboradorSuggestions, showColaboradorSuggestions, colaboradoresLocal, creandoColaborador, crearColaboradorDesdePedido, aplicarColaborador, importeClienteColCalculado, importeColaboradorCalculado, sumAdditionalStopPrices, syncPrecioColaboradorCalc, calcImporte, unidadesFacturablesPedido, previsualizandoColaborador, editando, previsualizarColaborador, notificandoColaborador, notificarColaborador, generandoAccesoTemporal, generarAccesoTemporalColaborador, accesoTemporalColaborador, copiarAccesoTemporalColaborador, revocarAccesoTemporalColaborador, formatPaymentTerms, draftDirty }) {
 const [useSupplier,setUseSupplier]=React.useState(!!form.colaborador_id);
 React.useEffect(()=>{ if(form.colaborador_id) setUseSupplier(true); },[form.colaborador_id]);
 const committedSupplier=!!editando?.id && String(editando.colaborador_id||"")===String(form.colaborador_id||"") && !!form.colaborador_id;
 const canSend=committedSupplier && !draftDirty && calcImporte(form)>0 && (parseLocaleNumber(form.precio_colaborador,0)>0 || parseLocaleNumber(form.precio_colaborador_unitario,0)>0);
 return <><OrderSection title="Asignación de recursos" icon="truck">

            <label className="order-editor-mode"><span>Colaborador · transporte subcontratado</span><input type="checkbox" role="switch" checked={useSupplier} onChange={e=>{setUseSupplier(e.target.checked);setForm(p=>({...p,...clearAssignmentPatch(),remolque_id_manual:"",colaborador_nombre:"",precio_cliente_col:"",precio_colaborador:"",precio_colaborador_unitario:"",minimo_colaborador_unidades:""}));}}/><span>Usar colaborador en este viaje</span></label>
 <div hidden={useSupplier}><div className="tg-pedido-form-grid-2"><div><label style={S.label}>Vehiculo</label>
                <select value={form.vehiculo_id||""} onChange={e=>{
                  const vid = e.target.value;
                  const veh = vehiculosLocal.find(v=>v.id===vid);
                  const prevVeh = vehiculosLocal.find(v=>v.id===form.vehiculo_id);
                  const remolqueAuto = vehiculosLocal.find(v=>v.id===(veh&&veh.remolque_id));
                  const autoEt = vid ? [...autoEtiquetasVehiculo(etiquetasCatalogo, veh), ...autoEtiquetasVehiculo(etiquetasCatalogo, remolqueAuto)] : [];
                  setForm(p=>{
                    const choferEraDelAnterior = !p.chofer_id || p.chofer_id === prevVeh?.chofer_id;
                    const remolqueEraDelAnterior = !p.remolque_id_manual || p.remolque_id_manual === prevVeh?.remolque_id;
                    const choferDelVehiculo = veh?.chofer_id ||
                      choferesLocal.find(ch => ch.vehiculo_id === vid)?.id || "";
                    return {
                      ...p,
                      vehiculo_id: vid,
                      // Camion propio y colaborador son excluyentes: al asignar vehiculo se quita el colaborador
                      ...(vid ? { colaborador_id:"", colaborador_nombre:"", precio_cliente_col:"", precio_colaborador:"", precio_colaborador_unitario:"", minimo_colaborador_unidades:"" } : {}),
                      chofer_id: choferEraDelAnterior ? choferDelVehiculo : p.chofer_id,
                      remolque_id_manual: remolqueEraDelAnterior ? (veh?.remolque_id || "") : p.remolque_id_manual,
                      matricula_manual: vid ? "" : p.matricula_manual,
                      remolque_matricula_manual: vid ? "" : p.remolque_matricula_manual,
                      etiquetas: vid ? mergeEtiquetas(p.etiquetas, autoEt) : p.etiquetas,
                    };
                  });
                  // Mostrar aviso operacional si el vehiculo tiene notas
                  if (isMeaningfulVehicleNotice(veh?.notas_operacion)) {
                    setAvisoVehiculo({ matricula: veh.matricula, notas: veh.notas_operacion });
                  } else {
                    setAvisoVehiculo(null);
                  }
                }} style={S.sel}>
                  <option value="">Sin asignar</option>
                  {(()=>{
                    // Detectar remolques: por clase, por matricula R-*, o por ser remolque_id de alguien
                    const esRemolqueDeAlguien = new Set(vehiculosLocal.map(v=>v.remolque_id).filter(Boolean));
                    const esRemolque = v => {
                      const clase = (v.clase||v.tipo||"").toLowerCase();
                      const mat = (v.matricula||"").toUpperCase();
                      return clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly") ||
                             esRemolqueDeAlguien.has(v.id) ||
                             /^R[-_\s]/i.test(mat) || mat.endsWith("-R") || mat.endsWith("_R");
                    };
                    return vehiculosLocal
                      .filter(v => !esRemolque(v))
                      .map(v => {
                        const label = v.matricula;
                        return <option key={v.id} value={v.id}>{label}</option>;
                      });
                  })()}
                </select>
              </div>
<div>
                <label style={S.label}>
                  Chofer principal
                  {form.vehiculo_id&&vehiculosLocal.find(v=>v.id===form.vehiculo_id)?.chofer_id&&(
                    <span style={{marginLeft:6,fontSize:10,color:"var(--accent)",fontWeight:500}}>
                      - auto del vehiculo
                    </span>
                  )}
                </label>
                <select value={form.chofer_id||""} onChange={e=>{ const cid=e.target.value; setForm(p=>assignDriver(p,cid,choferesLocal,vehiculosLocal)); }} style={S.sel}>
                  <option value="">Sin asignar</option>
                  {choferesLocal.map(c=><option key={c.id} value={c.id}>{driverName(c)}</option>)}
                </select>
              </div>
<div>
                <label style={S.label}>
                  Remolque
                  {form.vehiculo_id && vehiculosLocal.find(v=>v.id===form.vehiculo_id)?.remolque_id && (
                    <span style={{marginLeft:6,fontSize:10,color:"#a78bfa",fontWeight:500}}>- del conjunto</span>
                  )}
                </label>
                <select
                  value={form.remolque_id_manual||vehiculosLocal.find(v=>v.id===form.vehiculo_id)?.remolque_id||""}
                  onChange={e=>setForm(p=>({...p, remolque_id_manual: e.target.value||""}))}
                  style={S.sel}>
                  <option value="">Sin remolque</option>
                  {(()=>{
                    const remolqueIds2 = new Set(vehiculosLocal.map(v=>v.remolque_id).filter(Boolean));
                    const esRemolque2 = v => {
                      const clase = (v.clase||v.tipo||"").toLowerCase();
                      const mat = (v.matricula||"").toUpperCase();
                      return clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly") ||
                             remolqueIds2.has(v.id) ||
                             /^R[-_\s]/i.test(mat) || mat.endsWith("-R") || mat.endsWith("_R");
                    };
                    return vehiculosLocal.filter(v => esRemolque2(v))
                      .map(v=>(
                        <option key={v.id} value={v.id}>{v.matricula}{v.marca?" - "+v.marca:""}</option>
                      ));
                  })()}
                </select>
                {form.remolque_id_manual && form.vehiculo_id &&
                 form.remolque_id_manual !== vehiculosLocal.find(v=>v.id===form.vehiculo_id)?.remolque_id && (
                  <div style={{marginTop:4,fontSize:11,color:"#fbbf24",padding:"4px 9px",background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.2)",borderRadius:6}}>
                    Aviso: Distinto al conjunto habitual - al guardar se actualizara el conjunto de la tractora
                  </div>
                )}
                {avisoCargaExcedeRemolque && (
                  <div style={{marginTop:4,fontSize:11,color:"#f87171",fontWeight:700,padding:"5px 9px",background:"rgba(239,68,68,.09)",border:"1px solid rgba(239,68,68,.28)",borderRadius:6}}>
                    Aviso: la carga ({cargaMetrosLineales.toString().replace(".", ",")} m) supera los metros de carga del remolque {remolqueActual?.matricula ? `(${remolqueActual.matricula}, ${remolqueMetrosCarga.toString().replace(".", ",")} m)` : `(${remolqueMetrosCarga.toString().replace(".", ",")} m)`}. Revisa la asignacion.
                  </div>
                )}
              </div>
<div><label style={S.label}>2o Chofer (opcional)</label>
                <select value={form.chofer2_id||""} onChange={f("chofer2_id")} style={S.sel}>
                  <option value="">Sin segundo chofer</option>
                  {choferesLocal.filter(c=>c.id!==form.chofer_id).map(c=><option key={c.id} value={c.id}>{driverName(c)}</option>)}
                </select>
              </div>
{!form.vehiculo_id && !form.colaborador_id && form.matricula_manual && (
                <div style={{gridColumn:"1/-1",fontSize:12,color:"var(--text3)",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"8px 12px"}}>
                  Matricula asignada a mano: <strong style={{color:"var(--text)"}}>{form.matricula_manual}</strong>{form.remolque_matricula_manual?` · Remolque ${form.remolque_matricula_manual}`:""} — para cambiarla usa el boton "Asignar" de la lista.
                </div>
              )}
{form.chofer2_id&&(
                <div style={{gridColumn:"1/-1",background:"rgba(139,92,246,.06)",border:"1px solid rgba(139,92,246,.18)",borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",gap:12}}>
                  <span style={{fontSize:13}}></span>
                  <div style={{flex:1,fontSize:12,color:"var(--text3)"}}>Viaje compartido entre dos choferes. El importe se repartira a partes iguales en las hojas de ruta.</div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <label style={{fontSize:11,color:"var(--text4)"}}>% chofer 1:</label>
                    <input type="number" min="0" max="100" style={{...S.input,width:60,padding:"4px 8px",fontSize:12}} value={form.reparto_chofer1??50}
                      onChange={e=>{ const v=Math.max(0,Math.min(100,Number(e.target.value)||0)); setForm(p=>({...p, reparto_chofer1:v})); }}/>
                    <label style={{fontSize:11,color:"var(--text4)"}}>% chofer 2:</label>
                    <input type="number" min="0" max="100" style={{...S.input,width:60,padding:"4px 8px",fontSize:12}} value={100-Number(form.reparto_chofer1??50)}
                      onChange={e=>{ const v2=Math.max(0,Math.min(100,Number(e.target.value)||0)); setForm(p=>({...p, reparto_chofer1:100-v2})); }}/>
                  </div>
                </div>
              )}</div></div>
 <div hidden={!useSupplier}><div style={{gridColumn:"1/-1",background:"rgba(139,92,246,.05)",border:"1px solid rgba(139,92,246,.15)",borderRadius:9,padding:"12px 14px",marginTop:4}}>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                  <div><label style={S.label}>Colaborador / proveedor</label>
                    <div style={{position:"relative",marginBottom:6}}>
                      <input
                        style={S.input}
                        placeholder="Buscar o crear colaborador..."
                        value={colaboradorBusqueda}
                        onChange={e=>{ setColaboradorBusqueda(e.target.value); setShowColaboradorSuggestions(true); }}
                        onFocus={()=>setShowColaboradorSuggestions(true)}
                        onBlur={()=>setTimeout(()=>setShowColaboradorSuggestions(false),200)}
                      />
                      {showColaboradorSuggestions && colaboradorBusqueda && (()=>{
                        const q = colaboradorBusqueda.toLowerCase();
                        const sugs = colaboradoresLocal.filter(c =>
                          String(c.nombre || "").toLowerCase().includes(q) ||
                          String(c.cif || "").toLowerCase().includes(q) ||
                          String(c.email || "").toLowerCase().includes(q)
                        ).slice(0,6);
                        if (!sugs.length) return (
                          <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,zIndex:60,padding:"10px 14px"}}>
                            <div style={{fontSize:12,color:"var(--text4)",marginBottom:8}}>No hay ningun colaborador con ese nombre.</div>
                            <button type="button" disabled={creandoColaborador}
                              onMouseDown={e=>{ e.preventDefault(); crearColaboradorDesdePedido(colaboradorBusqueda); }}
                              style={{...S.btn,background:"var(--accent)",color:"#fff",fontSize:12,padding:"5px 12px",opacity:creandoColaborador ? .7 : 1}}>
                              {creandoColaborador ? "Creando..." : `Crear colaborador "${colaboradorBusqueda}"`}
                            </button>
                          </div>
                        );
                        return (
                          <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,zIndex:60,overflow:"hidden"}}>
                            {sugs.map(c=>(
                              <div key={c.id}
                                onMouseDown={()=>aplicarColaborador(c)}
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
                    <select value={form.colaborador_id||""} onChange={e=>{
                      const col=colaboradoresLocal.find(c=>c.id===e.target.value);
                      const impActual = importeClienteColCalculado(form) || parseLocaleNumber(form.precio_unitario, 0);
                      setForm(p=>({
                        ...p,
                        colaborador_id: e.target.value,
                        colaborador_nombre: col?.nombre||"",
                        // Excluyente con transporte propio: al poner colaborador se quita el camion/chofer asignado
                        ...(e.target.value ? { vehiculo_id:"", chofer_id:"", chofer2_id:"", remolque_id_manual:"", matricula_manual:"", remolque_matricula_manual:"" } : {}),
                        // Siempre sincronizar precio del viaje -> lo que cobramos al colaborador
                        precio_cliente_col: e.target.value ? (impActual || p.precio_cliente_col || "") : "",
                        precio_colaborador: e.target.value ? (importeColaboradorCalculado({ ...p, colaborador_id: e.target.value }) || p.precio_colaborador || "") : "",
                        coste_gasoil: e.target.value ? 0 : p.coste_gasoil,
                      }));
                      setColaboradorBusqueda("");
                    }} style={S.sel}>
                      <option value="">Sin colaborador (chofer propio)</option>
                      {colaboradoresLocal.map(c=><option key={c.id} value={c.id}>{c.nombre} {c.cif?`- ${c.cif}`:""}</option>)}
                    </select>
                  </div>
                  {form.colaborador_id&&(<>
                    <div>
                      <label style={S.label}>
                        Lo que cobramos al cliente (EUR, sin IVA)
                        <span style={{marginLeft:4,fontSize:9,color:"var(--text5)",fontWeight:400,textTransform:"none"}}>
                          - precio del viaje
                        </span>
                      </label>
                      <input type="text" inputMode="decimal" style={S.input}
                        value={form.precio_cliente_col||""}
                        onChange={e=>{
                          const v = e.target.value;
                          setForm(p=>{
                            // "Lo que cobramos al cliente" ES el total del viaje: al
                            // editarlo, el importe del pedido pasa a valer eso. Se
                            // despeja el precio unitario segun el tipo de tarifa (sin
                            // cambiar el tipo, para no ocultar los campos por tonelada
                            // del colaborador) y se descuentan extracostes/paradas para
                            // que el total (base+extras) coincida con lo tecleado.
                            const nv = parseLocaleNumber(v, NaN);
                            if (!Number.isFinite(nv)) return { ...p, precio_cliente_col: v };
                            const extras = parseLocaleNumber(p.extracostes ?? p.extracostes_importe, 0)
                              + sumAdditionalStopPrices(p.puntos_descarga)
                              + sumAdditionalStopPrices(p.puntos_carga);
                            const base = Math.max(0, nv - extras);
                            const cant = parseLocaleNumber(p.cantidad, 0);
                            const minU = parseLocaleNumber(p.minimo_unidades, 0);
                            const units = minU > 0 ? Math.max(cant, minU) : cant;
                            const tipo = p.tipo_precio || "viaje";
                            if (tipo !== "viaje" && units > 0) {
                              const precioUnit = tipo === "kg" ? (base * 100 / units) : (base / units);
                              return { ...p, precio_cliente_col: v, precio_unitario: String(Number(precioUnit.toFixed(4))) };
                            }
                            // Tarifa por viaje (o por unidad sin cantidad aun): precio de
                            // viaje cerrado = base.
                            return { ...p, precio_cliente_col: v, tipo_precio: "viaje", precio_unitario: String(Number(base.toFixed(2))), importe_minimo: "" };
                          });
                        }}
                        placeholder="Ej: 850"/>
                    </div>
                    <div>
                      <label style={S.label}>Tarifa del proveedor</label>
                      <select style={S.sel} value={supplierPriceType(form)} onChange={e=>setForm(p=>({
                        ...p, tipo_precio_colaborador:e.target.value, precio_colaborador:"",
                        precio_colaborador_unitario:"", minimo_colaborador_unidades:"",
                      }))}>
                        <option value="viaje">Precio cerrado por viaje</option>
                        <option value="tonelada">Por tonelada cargada</option>
                      </select>
                    </div>
                    {supplierPriceType(form)==="tonelada" ? (<>
                      <div>
                        <label style={S.label}>Precio acordado EUR/tonelada</label>
                        <input type="text" inputMode="decimal" style={S.input}
                          value={form.precio_colaborador_unitario ?? ""}
                          onChange={e=>setForm(p=>syncPrecioColaboradorCalc({...p,precio_colaborador_unitario:e.target.value}))}
                          placeholder="Ej: 32,50"/>
                      </div>
                      <div>
                        <label style={S.label}>Minimo facturable acordado (toneladas)</label>
                        <input type="text" inputMode="decimal" style={S.input}
                          value={form.minimo_colaborador_unidades ?? ""}
                          onChange={e=>setForm(p=>syncPrecioColaboradorCalc({...p,minimo_colaborador_unidades:e.target.value}))}
                          placeholder="Ej: 25,5"/>
                      </div>
                      <div>
                        <label style={S.label}>Liquidacion</label>
                        <div style={{...S.input,background:"var(--bg3)"}}>Segun toneladas cargadas</div>
                      </div>
                    </>) : (
                      <div><label style={S.label}>Lo que pagamos al colaborador (EUR, sin IVA)</label>
                        <input type="text" inputMode="decimal" style={S.input} value={form.precio_colaborador||""} onChange={f("precio_colaborador")} placeholder="Ej: 650"/>
                      </div>
                    )}
                    <div><label style={S.label}>Matricula tractora colaborador</label>
                      <input style={S.input} value={form.matricula_colaborador||""} onChange={e=>setForm(p=>({...p,matricula_colaborador:formatMatricula(e.target.value)}))} placeholder="Ej: 1234-ABC"/>
                    </div>
                    <div><label style={S.label}>Matricula remolque colaborador</label>
                      <input style={S.input} value={form.remolque_matricula_colaborador||""} onChange={e=>setForm(p=>({...p,remolque_matricula_colaborador:formatMatricula(e.target.value)}))} placeholder="Opcional"/>
                    </div>
                    {(supplierPriceType(form)!=="tonelada"&&calcImporte(form)>0&&parseLocaleNumber(form.precio_colaborador)>0)&&(
                      <div style={{gridColumn:"1/-1",display:"flex",gap:16,background:"var(--bg3)",borderRadius:7,padding:"8px 14px",alignItems:"center"}}>
                        <div><span style={{fontSize:11,color:"var(--text5)"}}>Beneficio viaje: </span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:calcImporte(form)-parseLocaleNumber(form.precio_colaborador)>=0?"var(--green)":"var(--red)"}}>{(calcImporte(form)-parseLocaleNumber(form.precio_colaborador)).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR</span></div>
                        <div><span style={{fontSize:11,color:"var(--text5)"}}>Margen: </span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"#f59e0b"}}>{calcImporte(form)>0?((1-parseLocaleNumber(form.precio_colaborador)/calcImporte(form))*100).toFixed(1):0}%</span></div>
                        {form.tipo_precio==="tonelada" && form.precio_colaborador_unitario && (
                          <div><span style={{fontSize:11,color:"var(--text5)"}}>Pago acordado: </span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"var(--text2)"}}>{parseLocaleNumber(form.precio_colaborador_unitario,0).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR/tn x {unidadesFacturablesPedido(form, form.minimo_colaborador_unidades).toLocaleString("es-ES")} tn</span></div>
                        )}
                        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.25)",borderRadius:6,padding:"4px 10px"}}>
                          <span style={{fontSize:12}}>!</span><span style={{fontSize:11,fontWeight:700,color:"#fbbf24"}}>Pendiente de pago al colaborador</span>
                        </div>
                      </div>
                    )}
                    <div style={{gridColumn:"1/-1",display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",background:"rgba(15,118,110,.08)",border:"1px solid rgba(15,118,110,.22)",borderRadius:8,padding:"9px 12px",flexWrap:"wrap"}}>
                      <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.45}}>
                        {!canSend ? "Guarda la asignación y los precios para enviar el enlace. " : ""}Se enviara un enlace para que el colaborador confirme precio y matriculas. Despues recibira enlaces para marcar carga, en camino, descarga y subir albaranes.
                      </div>
                      {canSend && <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                        <button
                          type="button"
                          disabled={previsualizandoColaborador || !editando?.id}
                          onClick={previsualizarColaborador}
                          style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",opacity:(previsualizandoColaborador || !editando?.id)?0.6:1}}
                        >
                          {previsualizandoColaborador ? "Abriendo..." : "Previsualizar"}
                        </button>
                        <button
                          type="button"
                          disabled={notificandoColaborador || !editando?.id}
                          onClick={()=>notificarColaborador(true)}
                          style={{...S.btn,background:"var(--green)",color:"#fff",opacity:(notificandoColaborador || !editando?.id)?0.6:1}}
                        >
                          {notificandoColaborador ? "Enviando..." : editando?.id ? (form.workflow_colaborador_enviado_at ? "Reenviar enlace" : "Enviar enlace") : "Guarda para enviar"}
                        </button>
                      </div>}
                    </div>
                    <div style={{gridColumn:"1/-1",background:"rgba(37,99,235,.07)",border:"1px solid rgba(37,99,235,.2)",borderRadius:8,padding:"10px 12px"}}>
                      <div style={{display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
                        <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.45,flex:"1 1 360px"}}>
                          <strong>Acceso temporal de conductor.</strong> Da acceso solo a este viaje para completar conductor, estados, albaranes y DCD. Caduca al entregar o cancelar el viaje.
                        </div>
                        {committedSupplier && !draftDirty && (!accesoTemporalColaborador?.operativa_url || String(accesoTemporalColaborador.colaborador_id) !== String(form.colaborador_id)) && <button type="button" disabled={generandoAccesoTemporal} onClick={generarAccesoTemporalColaborador}
                          style={{...S.btn,background:"#2563eb",color:"#fff",opacity:(generandoAccesoTemporal || !editando?.id)?0.6:1}}>
                          {generandoAccesoTemporal ? "Generando..." : editando?.id ? "Generar acceso temporal" : "Guarda para generar"}
                        </button>}
                      </div>
                      {committedSupplier && !draftDirty && accesoTemporalColaborador?.operativa_url && String(accesoTemporalColaborador.colaborador_id) === String(form.colaborador_id) &&(
                        <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginTop:10}}>
                          <input readOnly value={accesoTemporalColaborador.operativa_url} onFocus={e=>e.target.select()} style={{...S.input,minWidth:0,flex:"1 1 260px",fontSize:11}} />
                          <button type="button" disabled={generandoAccesoTemporal} onClick={copiarAccesoTemporalColaborador} style={{...S.btn,whiteSpace:"nowrap"}}>Copiar enlace</button>
                          {accesoTemporalColaborador.id && <button type="button" disabled={generandoAccesoTemporal} onClick={revocarAccesoTemporalColaborador} style={{...S.btn,color:"var(--red)"}}>Revocar</button>}
                          <button type="button" onClick={()=>window.open(accesoTemporalColaborador.operativa_url,"_blank","noopener,noreferrer")} style={{...S.btn,whiteSpace:"nowrap"}}>Abrir</button>
                        </div>
                      )}
                    </div>
                    <div style={{gridColumn:"1/-1",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.18)",borderRadius:8,padding:"10px 12px"}}>
                      <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",color:"var(--accent)",marginBottom:4}}>Forma de pago al colaborador</div>
                      <div style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>{formatPaymentTerms(getEmpresaPerfilSync())}</div>
                    </div>
                    {committedSupplier && form.workflow_colaborador_enviado_at && <div className="order-editor-supplier-progress" style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                      {[
                        ["Precio y matriculas", form.colaborador_precio_confirmado_at || form.colaborador_precio_confirmado],
                        ["Carga", form.colaborador_carga_confirmada_at],
                        ["En camino", form.colaborador_en_camino_confirmada_at],
                        ["Descarga y albaranes", form.colaborador_descarga_confirmada_at],
                      ].map(([label, done])=>(
                        <div key={label} style={{border:"1px solid "+(done?"rgba(16,185,129,.28)":"var(--border2)"),background:done?"rgba(16,185,129,.08)":"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",color:done?"var(--green)":"var(--text5)"}}>{done?"Confirmado":"Pendiente"}</div>
                          <div style={{fontSize:12,fontWeight:700,color:"var(--text)",marginTop:2}}>{label}</div>
                          {typeof done === "string" && <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>{new Date(done).toLocaleString("es-ES")}</div>}
                        </div>
                      ))}
                    </div>}
                  </>)}
                </div>


              </div></div>
 {form.chofer_id && !form.colaborador_id ? <div className="order-editor-driver-summary"><strong>Conductor efectivo</strong><span>{driverName(choferesLocal.find(c=>String(c.id)===String(form.chofer_id)))}</span><OrderDisclosure title="Conductor efectivo · completar datos manuales" ><div style={{gridColumn:"1/-1",borderTop:"1px solid rgba(139,92,246,.15)",marginTop:12,paddingTop:12}}>
                  <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text3)",marginBottom:8}}>Conductor efectivo</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                    <div><label style={S.label}>Nombre</label><input style={S.input} value={form.conductor_efectivo_nombre||""} onChange={f("conductor_efectivo_nombre")} placeholder="Nombre" /></div>
                    <div><label style={S.label}>Apellidos</label><input style={S.input} value={form.conductor_efectivo_apellidos||""} onChange={f("conductor_efectivo_apellidos")} placeholder="Apellidos" /></div>
                    <div><label style={S.label}>DNI / NIE</label><input style={S.input} value={form.conductor_efectivo_dni||""} onChange={e=>setForm(p=>({...p,conductor_efectivo_dni:formatDni(e.target.value)}))} placeholder="Documento de identidad" /></div>
                    <div><label style={S.label}>Telefono</label><input type="tel" style={S.input} value={form.conductor_efectivo_telefono||""} onChange={f("conductor_efectivo_telefono")} placeholder="Telefono" /></div>
                  </div>
                </div></OrderDisclosure></div> : <OrderDisclosure title="Conductor efectivo · completar datos manuales" ><div style={{gridColumn:"1/-1",borderTop:"1px solid rgba(139,92,246,.15)",marginTop:12,paddingTop:12}}>
                  <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text3)",marginBottom:8}}>Conductor efectivo</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                    <div><label style={S.label}>Nombre</label><input style={S.input} value={form.conductor_efectivo_nombre||""} onChange={f("conductor_efectivo_nombre")} placeholder="Nombre" /></div>
                    <div><label style={S.label}>Apellidos</label><input style={S.input} value={form.conductor_efectivo_apellidos||""} onChange={f("conductor_efectivo_apellidos")} placeholder="Apellidos" /></div>
                    <div><label style={S.label}>DNI / NIE</label><input style={S.input} value={form.conductor_efectivo_dni||""} onChange={e=>setForm(p=>({...p,conductor_efectivo_dni:formatDni(e.target.value)}))} placeholder="Documento de identidad" /></div>
                    <div><label style={S.label}>Telefono</label><input type="tel" style={S.input} value={form.conductor_efectivo_telefono||""} onChange={f("conductor_efectivo_telefono")} placeholder="Telefono" /></div>
                  </div>
                </div></OrderDisclosure>}
 </OrderSection></>;
}
