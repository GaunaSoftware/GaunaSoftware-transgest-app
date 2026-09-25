import { OrderSection, OrderDisclosure } from "./OrderEditorShell";

import { parseLocaleNumber } from "../../../utils/number";
import { cargoCount, fullLoadLength, cargoLengthMode, syncFullLoadLength } from "../../../utils/cargoDimensions";
import { updateCargo } from "../../../utils/cargoDimensions";
import { PALLET_SIZES } from "../../../utils/cargoDimensions";
import { cargoLength } from "../../../utils/cargoDimensions";
import AdrPanel from "../../../components/AdrPanel";

export default function OrderCargoFields({ S, form, setForm, f, syncPrecioClienteCol, syncCantidadSiVacia, calcularCosteGasoil, setShowCostes, normalizePesoKgDraft, PesoAlerta, vehiculosLocal }) {
 const tractor = vehiculosLocal.find(v => String(v.id) === String(form.vehiculo_id));
 const trailer = vehiculosLocal.find(v => String(v.id) === String(form.remolque_id_manual || form.remolque_id || tractor?.remolque_id));
 const palletCapacity = Number(trailer?.capacidad_palets || 0);
 const palletExcess = !!PALLET_SIZES[form.palets_tipo] && palletCapacity > 0 && cargoCount(form) > palletCapacity;
 return <OrderSection title="Mercancía" icon="truck">

            <div style={{display:"flex",gap:16,marginBottom:10,alignItems:"center",padding:"10px 14px",background:"var(--bg4)",borderRadius:8,border:"1px solid var(--border2)"}}>
              <span style={{fontSize:12,fontWeight:700,color:"var(--text3)"}}>Tipo de carga:</span>
              {["completa","grupaje"].map(t=>(
                <label key={t} style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:13,fontWeight:t===(form.tipo_carga||"completa")?"700":"400",color:t===(form.tipo_carga||"completa")?"var(--accent)":"var(--text4)"}}>
                  <input type="radio" name="tipo_carga" value={t} checked={(form.tipo_carga||"completa")===t}
                    onChange={()=>setForm(p=>{
                      const next={...p,tipo_carga:t};
                      if(t==='completa') return syncFullLoadLength(next,fullLoadLength(next,vehiculosLocal));
                      return cargoLengthMode(p)==='manual' ? next : {...next,carga_largo_m:'',metros_lineales:'',_cargoLengthManual:false};
                    })} style={{accentColor:"var(--accent)"}}/>
                  {t==="completa"?"Carga completa":"Grupaje (carga parcial)"}
                </label>
              ))}
              {(form.tipo_carga||"completa")==="grupaje" && (
                <span style={{fontSize:11,color:"#f59e0b",marginLeft:8}}>Se añadirá a Grupajes para combinarlo con otros pedidos</span>
              )}
            </div>
            {(form.tipo_carga||"completa")==="completa" && <div className="order-editor-help">
              <span>Longitud automática: {fullLoadLength(form,vehiculosLocal).toLocaleString("es-ES")} m. Se utilizan 13,65 m cuando el remolque no tiene medida. En modo manual se conserva el valor indicado.</span>
              <label style={{display:'inline-flex',alignItems:'center',gap:6,marginLeft:12}}>Longitud ocupada
                <select aria-label="Modo de longitud ocupada" value={cargoLengthMode(form)} onChange={e=>setForm(p=>e.target.value==='auto'
                  ? syncFullLoadLength({...p,longitud_ocupada_mode:'auto',_cargoLengthManual:false},fullLoadLength(p,vehiculosLocal))
                  : {...p,longitud_ocupada_mode:'manual',_cargoLengthManual:true})}>
                  <option value="auto">Automática</option><option value="manual">Manual</option>
                </select>
              </label>
            </div>}
            <div className="order-editor-cargo-grid"><div style={{gridColumn:"1/-1"}}><label style={S.label}>Descripcion mercancia</label><input style={S.input} value={form.mercancia||""} onChange={f("mercancia")} placeholder="Pallets de ceramica, maquinaria..."/></div>
<div>
                  <label style={S.label}>Peso (kg)</label>
                  <input type="text" inputMode="decimal" style={S.input} value={form.peso_kg||""} onChange={e=>setForm(p=>{
                    const next = syncPrecioClienteCol(syncCantidadSiVacia({...p, peso_kg:e.target.value}));
                    if (!next.colaborador_id && parseLocaleNumber(next.km_ruta, 0) > 0) {
                      next.coste_gasoil = calcularCosteGasoil(next);
                    }
                    return next;
                  })} onBlur={()=>setForm(p=>{
                    const next = normalizePesoKgDraft(p);
                    if (!next.colaborador_id && parseLocaleNumber(next.km_ruta, 0) > 0) next.coste_gasoil = calcularCosteGasoil(next);
                    return next;
                  })}/>
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:4}}>Acepta kg totales o toneladas con coma. Ej: 27,6 -> 27.600 kg.</div>
                  <PesoAlerta
                    pesoKg={form.peso_kg}
                    vehiculoId={form.vehiculo_id}
                    remolqueId={form.remolque_id_manual}
                  vehiculos={vehiculosLocal}
                />
              </div>
<div><label style={S.label}>{form.palets_tipo === "granel" ? "Número de bultos" : "Número de palets / bultos"}</label><input aria-label="Cantidad de carga" type="number" min="0" step="1" style={S.input} value={cargoCount(form)||""} onChange={e=>setForm(p=>syncPrecioClienteCol(syncCantidadSiVacia(updateCargo(p,"palets_cantidad",e.target.value))))}/>{palletExcess&&<small role="alert" style={{color:'var(--red)'}}>La carga indica {cargoCount(form)} palés y el remolque admite {palletCapacity}. Revisa la capacidad.</small>}</div>
<div><label style={S.label}>Tipo de palet</label>
                <select style={S.sel} value={form.palets_tipo||""} onChange={e=>setForm(p=>updateCargo(p,"palets_tipo",e.target.value))}>
                  <option value="">Sin especificar</option>
                  <option value="europeo">Europeo (120x80)</option>
                  <option value="americano">Americano (120x100)</option>
                  <option value="medio">Medio palet (80x60)</option>
                  <option value="granel">Sin paletizar / granel</option>
                </select>
                {PALLET_SIZES[form.palets_tipo] && <small>Medidas del palet: {PALLET_SIZES[form.palets_tipo].map(v=>v*100).join(" × ")} cm. La ocupación se calcula al indicar la cantidad.</small>}
              </div></div><OrderDisclosure title="Dimensiones y otros datos (opcional)" initiallyOpen={['carga_largo_m','carga_ancho_m','carga_alto_m','volumen','temperatura_c'].some(k => form[k] !== '' && form[k] != null && Number(form[k]) !== 0) || !!form.palets_apilables}><div className="tg-pedido-form-grid-3"><div style={{display:"flex",alignItems:"flex-end",paddingBottom:6}}>
                <label style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--text3)",cursor:"pointer"}}>
                  <input type="checkbox" checked={!!form.palets_apilables} onChange={e=>setForm(p=>updateCargo(p,"palets_apilables",e.target.checked))}/>
                  Se pueden apilar
                </label>
              </div>
<div><label style={S.label}>Longitud ocupada / ML (m)</label><input type="text" inputMode="decimal" style={S.input} aria-label="Longitud ocupada" value={form.carga_largo_m ?? (cargoLength(form)||"")} onChange={e=>setForm(p=>updateCargo(p,"carga_largo_m",e.target.value))} placeholder="Calculada según los palets"/></div>
<div><label style={S.label}>Ancho carga (m)</label><input type="text" inputMode="decimal" style={S.input} value={form.carga_ancho_m||""} aria-label="Ancho de carga" onChange={e=>setForm(p=>updateCargo(p,"carga_ancho_m",e.target.value))}/></div>
<div><label style={S.label}>Alto carga (m)</label><input type="text" inputMode="decimal" style={S.input} value={form.carga_alto_m||""} onChange={f("carga_alto_m")}/></div>
<div><label style={S.label}>Temperatura (C)</label><input type="text" inputMode="decimal" style={S.input} value={form.temperatura_c??""} onChange={f("temperatura_c")} placeholder="Ej: -18 (vacio = sin frio)"/></div>
<div><label style={S.label}>Volumen (m3)</label><input type="text" inputMode="decimal" style={S.input} value={form.volumen||""} onChange={f("volumen")}/></div></div></OrderDisclosure>

            <AdrPanel
              adr={!!form.adr}
              items={Array.isArray(form.adr_items) ? form.adr_items : []}
              onChange={({ adr, adr_items }) => setForm(p => ({ ...p, adr, adr_items }))}
            />


 </OrderSection>;
}
