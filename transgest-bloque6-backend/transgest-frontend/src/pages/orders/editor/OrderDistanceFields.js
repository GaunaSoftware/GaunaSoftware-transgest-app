import { OrderSection, OrderDisclosure } from "./OrderEditorShell";

import { parseLocaleNumber } from "../../../utils/number";
import { notify } from "../../../services/notify";

export default function OrderDistanceFields({ S, getRoutePlaces, form, calcularKmRuta, setForm, calcularCosteGasoil, setShowCostes, syncCantidadSiVacia, calcKm, syncPrecioClienteCol, calcularKmVacio, f }) {
 return <OrderSection title="Distancias y operativa" icon="route">

            <div className="tg-pedido-form-grid-2"><div>
                <label style={S.label}>
                  Km en ruta
                  {getRoutePlaces(form).length >= 2 && (
                    <button data-pedido-mutation="true" type="button" onClick={async()=>{
                      const km = await calcularKmRuta(form.origen, form.destino, getRoutePlaces(form));
                      if(km) setForm(p=>{
                        const next = {...p, km_ruta:km};
                        if (!next.colaborador_id) {
                          next.coste_gasoil = calcularCosteGasoil(next);
                        }
                        return syncCantidadSiVacia(next);
                      });
                    }} disabled={calcKm}
                      style={{marginLeft:8,padding:"1px 8px",borderRadius:5,border:"1px solid var(--accent)",background:"transparent",color:"var(--accent)",fontSize:10,cursor:calcKm?"not-allowed":"pointer",fontWeight:700}}>
                      {calcKm ? "Calculando..." : "Calcular"}
                    </button>
                  )}
                </label>
                <input type="text" inputMode="decimal" style={S.input} value={form.km_ruta||""} onChange={e=>{ const km=parseLocaleNumber(e.target.value,0); setForm(p=>{ const u=syncPrecioClienteCol(syncCantidadSiVacia({...p,km_ruta:e.target.value})); if(km>0&&!u.colaborador_id){u.coste_gasoil=calcularCosteGasoil(u);} return u; }); }}
                  placeholder="Se calcula automaticamente"/>
              </div><OrderDisclosure className="order-editor-empty-distance" title="Kilómetros en vacío" initiallyOpen={parseLocaleNumber(form.km_vacio,0)>0}><div>
                <label style={S.label}>
                  Km en vacio
                  {form.vehiculo_id && form.origen && (
                    <button data-pedido-mutation="true" type="button" onClick={async()=>{
                      const result = await calcularKmVacio(form.vehiculo_id, form.origen);
                      if(result) {
                        setForm(p=>({...p, km_vacio:result.km}));
                        if(result.km > 0)
                          notify(`Km en vacio calculados: ${result.km} km (desde ${result.desde} hasta ${form.origen})`, "success");
                      } else {
                        notify("No hay viajes anteriores de este vehiculo o no se pudo calcular la distancia.", "warning");
                      }
                    }} disabled={calcKm}
                      style={{marginLeft:8,padding:"1px 8px",borderRadius:5,border:"1px solid #a78bfa",background:"transparent",color:"#a78bfa",fontSize:10,cursor:calcKm?"not-allowed":"pointer",fontWeight:700}}>
                      {calcKm ? "..." : "Calcular"}
                    </button>
                  )}
                </label>
                <input type="text" inputMode="decimal" style={S.input} value={form.km_vacio||""} onChange={f("km_vacio")}
                  placeholder="Distancia hasta punto de carga"/>
              </div></OrderDisclosure></div><div style={{gridColumn:"1/-1",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"8px 10px",marginTop:8}}>
                <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                  {[
                    ["carga_lateral","Carga lateral"],
                    ["carga_trasera","Carga trasera"],
                    ["carga_techo","Techo"],
                    ["intercambio_palets","Intercambio de palets"],
                    ["requiere_cinchas","Necesario llevar cinchas"],
                  ].map(([key,label])=>(
                    <label key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"var(--text3)",cursor:"pointer"}}>
                      <input type="checkbox" checked={!!form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.checked}))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>


 </OrderSection>;
}
