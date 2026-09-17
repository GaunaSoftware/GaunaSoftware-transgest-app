import { OrderSection, OrderDisclosure } from "./OrderEditorShell";

import { parseLocaleNumber } from "../../../utils/number";

export default function OrderPriceFields({ S, form, setForm, syncPrecioClienteCol, syncCantidadSiVacia, opcionesTipoPrecio, compactNumberInput, syncPrecioColaboradorCalc, ivaOptionValue, applyIvaOptionToDraft, IVA_PEDIDO_OPTIONS, calcRevisionCombustible, f, calcImporte, additionalStopPriceItems, precioKmPedidoInfo, calcIvaPedido }) {
 return <OrderSection title="Precio y condiciones" icon="coins">

            <p className="order-editor-help">Precio sin impuestos.</p><div className="tg-pedido-form-grid-3"><div><label style={S.label}>Tipo tarificacion</label>
                <select value={form.tipo_precio||"viaje"} onChange={e=>setForm(p=>syncPrecioClienteCol(syncCantidadSiVacia({...p,tipo_precio:e.target.value}, true)))} style={S.sel}>
                  {opcionesTipoPrecio(form.tipo_precio).map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
<div><label style={S.label}>{form.tipo_precio==="viaje"?"Precio viaje (EUR)":form.tipo_precio==="kg"?"EUR por 100 kg":form.tipo_precio==="tonelada"?"EUR por tonelada":form.tipo_precio==="km"?"EUR por km":form.tipo_precio==="palet"?"EUR por palet":"EUR por hora"}</label>
                <input type="text" inputMode="decimal" style={S.input} value={form.precio_unitario||""} onChange={e => {
                  const v = e.target.value;
                  setForm(p => syncPrecioClienteCol({
                    ...p,
                    precio_unitario: v,
                  }));
                }}/>
              </div>
<div>
                <label style={S.label}>IVA del viaje</label>
                <select value={ivaOptionValue(form)} onChange={e=>setForm(p=>applyIvaOptionToDraft(p,e.target.value))} style={S.sel}>
                  {IVA_PEDIDO_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
{form.tipo_precio!=="viaje"&&<div><label style={S.label}>{form.tipo_precio==="kg"?"Peso kg":form.tipo_precio==="tonelada"?"Toneladas":form.tipo_precio==="km"?"Kilometros":form.tipo_precio==="palet"?"Palets":"Horas"}</label>
                <input type="text" inputMode="decimal" style={S.input} value={compactNumberInput(form.cantidad)} onChange={e=>setForm(p=>syncPrecioClienteCol(syncPrecioColaboradorCalc({...p,cantidad:e.target.value})))}/>
              </div>}</div><OrderDisclosure title="Más opciones de precio (gasoil, extras, mínimo, paralización)" initiallyOpen={['recargo_combustible_pct','extracostes','extracostes_importe','importe_minimo','minimo_unidades','importe_paralizacion'].some(k=>parseLocaleNumber(form[k],0)>0)}><div className="tg-pedido-form-grid-3"><div><label style={S.label}>Extracostes / Esperas (EUR)</label><input type="text" inputMode="decimal" style={S.input} value={form.extracostes ?? form.extracostes_importe ?? ""} onChange={e=>setForm(p=>syncPrecioClienteCol({...p,extracostes:e.target.value,extracostes_importe:e.target.value}))} placeholder="0.00"/></div>
<div>
                <label style={{...S.label,color:"#f59e0b"}}>Clausula gasoil (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  style={S.input}
                  value={form.recargo_combustible_pct || ""}
                  onChange={e=>setForm(p=>{
                    const base = parseLocaleNumber(p.precio_base_sin_combustible || p.precio_unitario, 0);
                    const pct = parseLocaleNumber(e.target.value, 0);
                    const next = {
                      ...p,
                      recargo_combustible_pct:e.target.value,
                      precio_base_sin_combustible:p.precio_base_sin_combustible || p.precio_unitario || "",
                      precio_unitario:base > 0 && pct > 0 ? Number((base * (1 + pct / 100)).toFixed(2)) : p.precio_unitario,
                    };
                    return {...next, importe_revision_combustible:calcRevisionCombustible(next)};
                  })}
                  placeholder="Ej. 5"
                />
              </div>
<div>
                <label style={{...S.label,color:"#f59e0b"}}>Precio base sin gasoil</label>
                <input
                  type="text"
                  inputMode="decimal"
                  style={S.input}
                  value={(() => {
                    // El precio base sin gasoil debe cumplir: EUR/tn = base * (1 + %gasoil).
                    // Si el valor guardado no cuadra con el EUR/tn y el % actuales (p. ej.
                    // arrastrado de una tarifa antigua), mostramos el valor correcto derivado
                    // (con % = 0, la base es el propio EUR/tn).
                    const stored = form.precio_base_sin_combustible;
                    const pct = parseLocaleNumber(form.recargo_combustible_pct, 0);
                    const unit = parseLocaleNumber(form.precio_unitario, NaN);
                    const storedNum = parseLocaleNumber(stored, NaN);
                    const cuadra = Number.isFinite(storedNum) && Number.isFinite(unit) && Math.abs(storedNum * (1 + pct / 100) - unit) < 0.01;
                    if (stored !== "" && stored != null && cuadra) return stored;
                    if (Number.isFinite(unit) && unit > 0) return String(Number((pct > 0 ? unit / (1 + pct / 100) : unit).toFixed(2)));
                    return stored || "";
                  })()}
                  onChange={e=>setForm(p=>{
                    const base = parseLocaleNumber(e.target.value, 0);
                    const pct = parseLocaleNumber(p.recargo_combustible_pct, 0);
                    const next = {...p,precio_base_sin_combustible:e.target.value,precio_unitario:base > 0 ? Number((base * (1 + pct / 100)).toFixed(2)) : p.precio_unitario};
                    return {...next, importe_revision_combustible:calcRevisionCombustible(next)};
                  })}
                  placeholder="Importe antes del recargo"
                />
                <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Importe del viaje antes de aplicar la clausula de gasoil.</div>
              </div></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}>
              <div>
                <label style={{...S.label,color:"#f59e0b"}}>{form.tipo_precio==="kg"?"Minimo facturable (kg)":form.tipo_precio==="tonelada"?"Minimo facturable (toneladas)":form.tipo_precio==="km"?"Minimo facturable (km)":form.tipo_precio==="palet"?"Minimo facturable (palets)":form.tipo_precio==="hora"?"Minimo facturable (horas)":"Minimo facturable (EUR)"}</label>
                <input type="text" inputMode="decimal" style={S.input}
                  value={form.tipo_precio==="viaje" ? compactNumberInput(form.importe_minimo) : compactNumberInput(form.minimo_unidades)}
                  onChange={e=>setForm(p=>syncPrecioClienteCol(syncPrecioColaboradorCalc({...p,[p.tipo_precio==="viaje" ? "importe_minimo" : "minimo_unidades"]:e.target.value})))}
                  placeholder="Dejar vacio si no hay minimo"/>
                <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>
                  {form.tipo_precio==="viaje" ? "Si el calculo queda por debajo, se cobra este importe." : "Para kg, toneladas, km, palets u horas se aplica el minimo de unidades antes de multiplicar por el precio."}
                </div>
              </div>
              <div>
                <label style={{...S.label,color:"#ef4444"}}>Importe paralizacion (EUR, sin IVA)</label>
                <input type="text" inputMode="decimal"
                  style={{...S.input, borderColor:"rgba(239,68,68,.35)"}}
                  value={form.importe_paralizacion||""} onChange={f("importe_paralizacion")}
                  placeholder="0 si no hay paralizacion"/>
                <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>
                  Se factura en documento separado sin IVA
                </div>
              </div>
            </div>
{parseLocaleNumber(form.importe_paralizacion,0)>0&&(
              <div style={{background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.2)",borderRadius:7,padding:"8px 14px",fontSize:11,color:"#ef4444",fontWeight:600,marginTop:4}}>
                Se generara factura de paralizacion por {parseLocaleNumber(form.importe_paralizacion,0).toFixed(2)} EUR sin IVA
              </div>
            )}</OrderDisclosure>{(calcImporte(form)>0 || form.precio_unitario) && <div className="order-editor-money"><span>Neto<strong>{calcImporte(form).toLocaleString('es-ES',{minimumFractionDigits:2})} €</strong></span><span>IVA<strong>{calcIvaPedido(form).cuota.toLocaleString('es-ES',{minimumFractionDigits:2})} €</strong></span><span>Total<strong>{(calcIvaPedido(form).total+parseLocaleNumber(form.importe_paralizacion,0)).toLocaleString('es-ES',{minimumFractionDigits:2})} €</strong></span></div>}<OrderDisclosure title="Desglose del importe" initiallyOpen={false}>{(calcImporte(form)>0 || form.precio_unitario)&&(
              <div style={{background:"rgba(34,211,160,.07)",border:"1px solid rgba(34,211,160,.2)",borderRadius:8,padding:"10px 16px",marginTop:4}}>
                {(() => {
                  const cargaItems = additionalStopPriceItems(form.puntos_carga);
                  const descItems = additionalStopPriceItems(form.puntos_descarga);
                  if (!cargaItems.length && !descItems.length) return null;
                  const extracostes = parseLocaleNumber(form.extracostes ?? form.extracostes_importe, 0);
                  const sumExtras = [...cargaItems, ...descItems].reduce((s, it) => s + it.precio, 0) + (extracostes > 0 ? extracostes : 0);
                  const fleteBase = calcImporte(form) - sumExtras;
                  const row = { display:"flex", justifyContent:"space-between", marginBottom:4 };
                  const lbl = { fontSize:11, color:"var(--text3)" };
                  const val = { fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:13, color:"var(--green)" };
                  return (
                    <>
                      <div style={row}>
                        <span style={lbl}>Flete base (viaje)</span>
                        <span style={{ ...val, color:"var(--text2)" }}>{fleteBase.toFixed(2)} EUR</span>
                      </div>
                      {cargaItems.map(it => (
                        <div key={`c-${it.num}`} style={row}>
                          <span style={lbl}>+ Carga {it.num}{it.label ? ` · ${it.label}` : ""}</span>
                          <span style={val}>+{it.precio.toFixed(2)} EUR</span>
                        </div>
                      ))}
                      {descItems.map(it => (
                        <div key={`d-${it.num}`} style={row}>
                          <span style={lbl}>+ Descarga {it.num}{it.label ? ` · ${it.label}` : ""}</span>
                          <span style={val}>+{it.precio.toFixed(2)} EUR</span>
                        </div>
                      ))}
                      {extracostes > 0 && (
                        <div style={row}>
                          <span style={lbl}>+ Extracostes</span>
                          <span style={val}>+{extracostes.toFixed(2)} EUR</span>
                        </div>
                      )}
                    </>
                  );
                })()}

                <div style={{display:"flex",justifyContent:"space-between",marginTop:4,paddingTop:4,borderTop:"1px solid rgba(34,211,160,.2)"}}>
                  <span style={{fontSize:11,color:"var(--text3)"}}>EUR/km venta</span>
                  {(() => {
                    const eurKm = precioKmPedidoInfo(form);
                    return <span title={eurKm.hint} style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:13,color:eurKm.value ? "var(--green)" : "var(--text5)"}}>{eurKm.label}</span>;
                  })()}
                </div>
                {parseLocaleNumber(form.importe_paralizacion,0)>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:4,paddingTop:4,borderTop:"1px solid rgba(34,211,160,.2)"}}>
                    <span style={{fontSize:11,color:"#ef4444"}}>+ Paralizacion (sin IVA)</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"#ef4444"}}>+{parseLocaleNumber(form.importe_paralizacion,0).toFixed(2)} EUR</span>
                  </div>
                )}
                {calcRevisionCombustible(form)>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:4,paddingTop:4,borderTop:"1px solid rgba(245,158,11,.25)"}}>
                    <span style={{fontSize:11,color:"#f59e0b"}}>Revision combustible desglosable en factura ({Number(form.recargo_combustible_pct||0).toLocaleString("es-ES")}%)</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"#f59e0b"}}>{calcRevisionCombustible(form).toFixed(2)} EUR</span>
                  </div>
                )}


              </div>
            )}</OrderDisclosure>


 </OrderSection>;
}
