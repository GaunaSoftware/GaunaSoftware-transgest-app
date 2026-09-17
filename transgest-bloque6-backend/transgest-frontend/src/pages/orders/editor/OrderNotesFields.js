import { OrderSection } from "./OrderEditorShell";
export default function OrderNotesFields({S,form,f,setForm}) { return <OrderSection title="Notas e instrucciones" icon="invoice" className="order-editor-notes"><div className="tg-pedido-form-grid-2"><div><label style={S.label}>Notas / Instrucciones</label>
                <textarea style={{...S.input,height:64,resize:"vertical"}} value={form.notas||""} onChange={f("notas")}/>
                <label style={{display:"flex",alignItems:"center",gap:8,marginTop:7,cursor:form.notas?"pointer":"default",fontSize:12,color:form.notas?"var(--text3)":"var(--text5)"}}>
                  <input type="checkbox" checked={!!form.nota_visible} disabled={!form.notas}
                    onChange={e=>setForm(p=>({...p,nota_visible:e.target.checked}))}
                    style={{width:15,height:15,cursor:form.notas?"pointer":"default",accentColor:"var(--accent)"}}/>
                  Dejar nota visible en el pedido
                  <span style={{fontSize:10,color:"var(--text5)"}}>- aparece al pasar el raton por encima del pedido en la lista</span>
                </label>
              </div>
<div>
                <label style={S.label}>
                  Condiciones del encargo
                  <span style={{marginLeft:6,fontSize:9,color:"var(--text5)",fontWeight:400,
                    textTransform:"none",letterSpacing:"normal"}}>
                    - aparecen al pie de la orden de carga
                  </span>
                </label>
                <textarea
                  style={{...S.input,height:72,resize:"vertical",fontSize:12,color:"var(--text3)"}}
                  value={form.condiciones_adicionales||""}
                  onChange={f("condiciones_adicionales")}
                  placeholder="Ej: Mercancia fragil - manipular con precaucion. Temperatura 2-8oC. Firmar albaran en destino y devolver copia..."/>
              </div></div>


 </OrderSection>; }
