import { Button } from "../../../ui";

import { parseLocaleNumber } from "../../../utils/number";
import { notify } from "../../../services/notify";
import { confirmDialog } from "../../../services/notify";

export default function OrderCostFields({ showCostes, setShowCostes, form, calcImporte, S, calcularCosteGasoil, setForm, consumoLitros100PorPeso, precioGasoilDefault }) {
 return <>
            <Button className="order-editor-cost-trigger" aria-expanded={showCostes} onClick={()=>setShowCostes(v=>!v)}><strong>Costes del viaje</strong><span>{[form.coste_gasoil,form.coste_peajes,form.coste_dietas,form.coste_otros].some(v=>parseLocaleNumber(v,0)>0) ? "Costes registrados: " + [form.coste_gasoil,form.coste_peajes,form.coste_dietas,form.coste_otros].reduce((sum,v)=>sum+parseLocaleNumber(v,0),0).toLocaleString("es-ES",{minimumFractionDigits:2}) + " € · Editar" : "Sin costes registrados · Registrar costes"}</span><span aria-hidden="true">{showCostes ? "−" : "+"}</span></Button>
            {showCostes && (
              <div style={{background:"rgba(239,68,68,.04)",border:"1px solid rgba(239,68,68,.15)",borderRadius:8,padding:"14px",marginBottom:14}}>
                {!form.colaborador_id&&<button data-pedido-mutation="true" type="button" style={{...S.btn,marginBottom:10}} onClick={async()=>{
                  if(parseLocaleNumber(form.km_ruta,0)<=0){notify("Calcula o indica los kilómetros de la ruta antes de estimar el gasoil.","warning");return;}
                  const estimate=calcularCosteGasoil(form);
                  if(parseLocaleNumber(form.coste_gasoil,0)>0&&!await confirmDialog({title:"Recalcular gasoil",message:`Sustituir el gasoil registrado por la estimación de ${estimate.toLocaleString("es-ES")} EUR. Peajes, dietas y otros costes se conservan.`,confirmText:"Recalcular"}))return;
                  setForm(p=>({...p,coste_gasoil:estimate}));
                }}>Calcular gasoil estimado</button>}
                {parseLocaleNumber(form.km_ruta, 0) > 0 && (
                  <div style={{fontSize:11,color:"var(--text4)",marginBottom:10}}>
                    {form.colaborador_id
                      ? "Viaje realizado por colaborador: el coste es su precio acordado, sin gasoil propio."
                      : `Estimación de gasoil con ${consumoLitros100PorPeso(form.peso_kg)} L/100 km segun peso (${parseLocaleNumber(form.peso_kg,0).toLocaleString("es-ES")} kg) y ${parseLocaleNumber(form.km_ruta,0).toLocaleString("es-ES")} km y ${precioGasoilDefault().toLocaleString("es-ES")} EUR/litro.`}
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  {[
                    {l:"Gasoil (EUR)",    k:"coste_gasoil"},
                    {l:"Peajes (EUR)",     k:"coste_peajes"},
                    {l:"Dietas (EUR)",     k:"coste_dietas"},
                    {l:"Otros costes (EUR)", k:"coste_otros"},
                  ].map(({l,k})=>(
                    <div key={k}>
                      <label style={{...S.label,color:"var(--text3)"}}>{l}</label>
                      <input type="number" min="0" step="0.01" style={S.sel}
                        disabled={k==="coste_gasoil" && !!form.colaborador_id}
                        value={k==="coste_gasoil" && form.colaborador_id ? "" : form[k]||""}
                        onChange={e=>setForm(p=>({...p,[k]:e.target.value}))}
                        placeholder={k==="coste_gasoil" && form.colaborador_id ? "0 por colaborador" : "0.00"}/>
                    </div>
                  ))}
                </div>
                {/* Resumen margen */}
                {(()=>{
                  const ingreso = calcImporte(form) + parseLocaleNumber(form.importe_paralizacion, 0);
                  const totalC  = [form.coste_gasoil,form.coste_peajes,form.coste_dietas,form.coste_otros]
                    .reduce((s,v)=>s+Number(v||0),0);
                  const margen  = ingreso - totalC;
                  const pct     = ingreso>0 ? (margen/ingreso*100).toFixed(1) : 0;
                  return ingreso>0||totalC>0 ? (
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                      {[
                        {l:"Ingresos",v:`${ingreso.toFixed(2)} EUR`,c:"var(--green)"},
                        {l:"Costes",  v:`${totalC.toFixed(2)} EUR`, c:"#ef4444"},
                        {l:"Margen",  v:`${margen.toFixed(2)} EUR (${pct}%)`,
                          c:margen>=0?"var(--green)":"#ef4444"},
                      ].map(({l,v,c})=>(
                        <div key={l} style={{background:"var(--bg3)",borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
                          <div style={{fontSize:13,fontWeight:800,color:c}}>{v}</div>
                          <div style={{fontSize:9,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".07em",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
                <div>
                  <label style={{...S.label,color:"var(--text3)"}}>Notas de costes</label>
                  <input style={S.sel} value={form.coste_notas||""} placeholder="Ej: Conductor extra, esperas en carga..."
                    onChange={e=>setForm(p=>({...p,coste_notas:e.target.value}))}/>
                </div>
              </div>
            )}


 </>;
}
