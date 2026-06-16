import { useState, useEffect, useCallback } from "react";
import { getVehiculos, getFacturas,
  getGastosEstructura, crearGastoEstructura, editarGastoEstructura, borrarGastoEstructura,
  getMesesCerrados, cerrarMes as cerrarMesApi, abrirMes as abrirMesApi } from "../services/api";
import { confirmDialog, notify } from "../services/notify";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
// Funciones migradas a BD — ver api.js
function primerDiaMes(d){ const x=new Date(d); x.setDate(1); return x.toISOString().slice(0,10); }

const TIPOS_ESTR = ["Salario personal oficina","Alquiler/Arrendamiento","Suministros (luz, agua, internet)","Seguros empresa","Asesoría/Gestoría","Marketing/Publicidad","Viajes de negocio","Formación","Software/Licencias","Otros gastos generales"];

const S = {
  page:{flex:1,padding:"22px 26px",fontFamily:"'DM Sans',sans-serif"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,color:"var(--text)",marginBottom:16},
  card:{background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 18px",marginBottom:12},
  th:{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",borderBottom:"1px solid var(--border)",whiteSpace:"nowrap"},
  td:{padding:"9px 12px",borderBottom:"1px solid var(--border)",fontSize:13,color:"var(--text2)",verticalAlign:"middle"},
  btn:{padding:"7px 14px",borderRadius:7,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:5},
  inp:{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
  lbl:{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10},
};

function ModalGastoEstr({editando,onClose}){
  const [form,setForm]=useState(editando||{nombre:"",tipo:"Salario personal oficina",importe:0,periodo:"mensual",fecha:new Date().toISOString().slice(0,7),notas:""});
  const f=k=>e=>setForm(p=>({...p,[k]:e.target.value}));
  const [saving,setSaving]=useState(false);
  async function guardar(){
    if(!form.nombre){notify("El nombre es obligatorio", "warning");return;}
    if(!form.importe||parseFloat(form.importe)<=0){notify("El importe debe ser mayor que 0", "warning");return;}
    setSaving(true);
    try {
      const data = {...form, importe: parseFloat(form.importe)||0};
      if(editando?.id) {
        await editarGastoEstructura(editando.id, data);
      } else {
        await crearGastoEstructura(data);
      }
      onClose(); // onClose = recargar in main component
    } catch(e) {
      notify("Error al guardar: " + (e.message||"Error desconocido"), "error");
    } finally {
      setSaving(false);
    }
  }
  const inp=S.inp;const lbl=S.lbl;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(480px,96vw)"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,color:"var(--text)",marginBottom:14}}>{editando?"Editar gasto":"Nuevo gasto de estructura"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Nombre / descripción *</label><input style={inp} value={form.nombre} onChange={f("nombre")} placeholder="Ej: Salario María (recepción), Alquiler oficina..."/></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Tipo</label><select style={inp} value={form.tipo} onChange={f("tipo")}>{TIPOS_ESTR.map(t=><option key={t}>{t}</option>)}</select></div>
          <div><label style={lbl}>Importe (€)</label><input type="number" step="0.01" style={inp} value={form.importe} onChange={f("importe")} onFocus={e=>e.target.select()}/></div>
          <div><label style={lbl}>Período</label>
            <select style={inp} value={form.periodo} onChange={f("periodo")}>
              <option value="mensual">Mensual</option>
              <option value="trimestral">Trimestral</option>
              <option value="anual">Anual</option>
              <option value="unico">Pago único</option>
            </select>
          </div>
          <div><label style={lbl}>Mes/Año</label><input type="month" style={inp} value={form.fecha} onChange={f("fecha")}/></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Notas</label><input style={inp} value={form.notas} onChange={f("notas")}/></div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:saving?.7:1}}>{saving?"Guardando...":"Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

export default function GastosEstructura(){
  const hoy=new Date();
  const [vehiculos,setVehiculos]=useState([]);
  const [facturas,setFacturas]=useState([]);
  const [gastos,setGastos]=useState([]);
  const [modalGasto,setModalGasto]=useState(false);
  const [editGasto,setEditGasto]=useState(null);
  const [periodo,setPeriodo]=useState(hoy.toISOString().slice(0,7)); // YYYY-MM
  const [reparto,setReparto]=useState("igual"); // igual | facturacion
  const [mesesCerrados,setMesesCerrados]=useState([]);
  const mesCerrado = mesesCerrados.includes(periodo);

  useEffect(()=>{
    getVehiculos().then(v=>setVehiculos(Array.isArray(v)?v:[])).catch(()=>{});
    getFacturas().then(f=>setFacturas(Array.isArray(f)?f:Array.isArray(f?.data)?f.data:[])).catch(()=>{});
  },[]);

  const cargar = useCallback(async () => {
    try {
      const [g, m] = await Promise.all([getGastosEstructura(), getMesesCerrados()]);
      setGastos(Array.isArray(g) ? g : []);
      setMesesCerrados(Array.isArray(m) ? m : []);
    } catch(e) { console.error(e); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  function recargar(){ cargar(); setModalGasto(false); setEditGasto(null); }

  async function cerrarMes(){
    const ok = await confirmDialog({
      title: "Cerrar mes",
      message: `Cerrar el mes ${periodo}? Una vez cerrado, los gastos de este periodo no podran editarse ni eliminarse.`,
      confirmText: "Cerrar mes",
      tone: "warning",
    });
    if(!ok) return;
    try { await cerrarMesApi(primerDiaMes(periodo)); await cargar(); } catch(e){notify(e.message, "error");}
    notify("Mes "+periodo+" cerrado correctamente. Ya no se puede editar.", "success");
  }
  async function reabrirMes(){
    const ok = await confirmDialog({
      title: "Reabrir mes",
      message: `Reabrir el mes ${periodo}? Solo gerentes deberian hacer esto.`,
      confirmText: "Reabrir",
      tone: "warning",
    });
    if(!ok) return;
    try { await abrirMesApi(primerDiaMes(periodo)); await cargar(); } catch(e){notify(e.message, "error");}
  }

  function adjuntarFactura(gastoId, file){
    if(!file) return;
    const reader=new FileReader();
    reader.onload=async()=>{
      const gasto = gastos.find(g=>g.id===gastoId);
      if(!gasto) return;
      const updated = { ...gasto, factura_nombre:file.name, factura_data:reader.result };
      setGastos(prev=>prev.map(g=>g.id===gastoId?updated:g));
      try { await editarGastoEstructura(gastoId, updated); }
      catch(e) { notify("No se pudo guardar la factura adjunta: " + (e.message||"Error desconocido"), "error"); await cargar(); }
    };
    reader.readAsDataURL(file);
  }

  // Gastos del período seleccionado
  const gastosPeriodo = gastos.filter(g=>{
    if(g.periodo==="unico") return g.fecha?.slice(0,7)===periodo;
    if(g.periodo==="mensual") return g.fecha?.slice(0,7)===periodo;
    if(g.periodo==="trimestral"){
      const [ay,am]=periodo.split("-").map(Number);
      const [gy,gm]=g.fecha.split("-").map(Number);
      return ay===gy && Math.ceil(am/3)===Math.ceil(gm/3);
    }
    if(g.periodo==="anual") return g.fecha?.slice(0,4)===periodo.slice(0,4);
    return false;
  });

  const totalEstructura=gastosPeriodo.reduce((s,g)=>s+Number(g.importe||0),0);
  // Excluir remolques y semirremolques del reparto
  const esRemolque = v => { const cl=(v.clase||v.tipo||"").toLowerCase(); const mat=(v.matricula||"").toUpperCase(); return cl.includes("remolque")||cl.includes("semirremolque")||cl.includes("dolly")||mat.startsWith("R-")||mat.endsWith("-R"); };
  const vActivos=vehiculos.filter(v=>v.activo&&v.estado!=="baja"&&v.estado!=="inactivo"&&!esRemolque(v));

  // Facturación del mes por camión
  const facPeriodo=facturas.filter(f=>f.fecha?.slice(0,7)===periodo);
  const facTotalMes=facPeriodo.reduce((s,f)=>s+Number(f.total||0),0);

  // Reparto por camión
  const repartoPorCamion=vActivos.map(v=>{
    let peso=1;
    if(reparto==="facturacion"){
      const facVeh=facPeriodo.filter(f=>f.vehiculo_id===v.id);
      const facVehTotal=facVeh.reduce((s,f)=>s+Number(f.total||0),0);
      peso=facTotalMes>0?(facVehTotal/facTotalMes):1/Math.max(vActivos.length,1);
    }else{
      peso=1/Math.max(vActivos.length,1);
    }
    return{ v, peso, coste:totalEstructura*peso };
  });

  return(
    <div style={S.page}>
      <div style={S.title}>Gastos de Estructura</div>

      {/* Controls */}
      <div style={{display:"grid",gridTemplateColumns:"auto auto auto 1fr",gap:10,marginBottom:18,alignItems:"center",flexWrap:"wrap"}}>
        <div>
          <label style={S.lbl}>Período</label>
          <input type="month" style={S.inp} value={periodo} onChange={e=>setPeriodo(e.target.value)}/>
        </div>
        <div>
          <label style={S.lbl}>Reparto por camión</label>
          <select style={S.inp} value={reparto} onChange={e=>setReparto(e.target.value)}>
            <option value="igual">A partes iguales</option>
            <option value="facturacion">Ponderado por facturación</option>
          </select>
        </div>
        {mesCerrado ? (
          <div style={{paddingTop:20,display:"flex",gap:8,alignItems:"center"}}>
            <span style={{padding:"5px 12px",borderRadius:6,background:"rgba(249,115,22,.12)",border:"1px solid rgba(249,115,22,.3)",fontSize:12,fontWeight:700,color:"#f97316"}}>
              Mes cerrado
            </span>
            <button onClick={reabrirMes} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text4)",fontSize:11}}>Reabrir</button>
          </div>
        ) : (
          <div style={{paddingTop:20}}>
            <button onClick={cerrarMes} style={{...S.btn,background:"rgba(249,115,22,.12)",color:"#f97316",border:"1px solid rgba(249,115,22,.3)"}}>
              Cerrar mes
            </button>
          </div>
        )}
        <div style={{paddingTop:20}}>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={()=>{setEditGasto(null);setModalGasto(true);}}>+ Añadir gasto</button>
        </div>
        <div/>
      </div>

      {/* KPI */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
        {[
          {l:"Total estructura período",v:`${fmt2(totalEstructura)} €`,c:"var(--red)"},
          {l:"Camiones activos",v:vActivos.length,c:"var(--text)"},
          {l:"Coste medio por camión",v:`${fmt2(vActivos.length>0?totalEstructura/vActivos.length:0)} €`,c:"#f59e0b"},
        ].map((k,i)=>(
          <div key={i} style={S.card}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:800,color:k.c}}>{k.v}</div>
            <div style={{fontSize:10,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",marginTop:4}}>{k.l}</div>
          </div>
        ))}
      </div>

      {/* Gastos list */}
      <div style={S.card}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:10}}>GASTOS DEL PERÍODO</div>
        {gastosPeriodo.length===0
          ? <div style={{color:"var(--text5)",fontSize:12,padding:"12px 0",textAlign:"center"}}>Sin gastos para {periodo}. Añade gastos con el botón superior.</div>
          : <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Concepto","Tipo","Período","Importe",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {gastosPeriodo.map(g=>(
                  <tr key={g.id}>
                    <td style={{...S.td,fontWeight:600,color:"var(--text)"}}>{g.nombre}</td>
                    <td style={{...S.td,fontSize:11}}><span style={{background:"var(--bg4)",padding:"2px 8px",borderRadius:4}}>{g.tipo}</span></td>
                    <td style={{...S.td,fontSize:11,color:"var(--text4)",textTransform:"capitalize"}}>{g.periodo}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--red)"}}>{fmt2(g.importe)} €</td>
                    <td style={S.td}>
                      <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                        {/* Factura adjunta */}
                        {g.factura_nombre ? (
                          <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:5,background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.25)",fontSize:10,color:"#10b981",cursor:"pointer",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                            onClick={()=>{ const a=document.createElement("a");a.href=g.factura_data;a.download=g.factura_nombre;a.click(); }}
                            title={g.factura_nombre}>
                            Archivo: {g.factura_nombre.length>15?g.factura_nombre.slice(0,15)+"…":g.factura_nombre}
                          </span>
                        ) : (
                          <label style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 8px",borderRadius:5,border:"1px dashed var(--border2)",fontSize:10,color:"var(--text5)",cursor:mesCerrado?"not-allowed":"pointer"}}>
                            Adjuntar factura
                            {!mesCerrado&&<input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" style={{display:"none"}} onChange={e=>adjuntarFactura(g.id,e.target.files[0])}/>}
                          </label>
                        )}
                        {!mesCerrado&&<button style={{padding:"3px 8px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text2)",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600}} onClick={()=>{setEditGasto(g);setModalGasto(true);}}>Editar</button>}
                      {!mesCerrado&&<button style={{padding:"3px 8px",borderRadius:6,border:"none",background:"rgba(239,68,68,.1)",color:"var(--red)",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}} onClick={async()=>{if(await confirmDialog({title:"Eliminar gasto",message:"Eliminar este gasto?",confirmText:"Eliminar",tone:"danger"})){try{await borrarGastoEstructura(g.id);await cargar();}catch(e){notify(e.message, "error");}}}}>Eliminar</button>}
                        {mesCerrado&&<span style={{fontSize:10,color:"#f97316",fontWeight:700}}>Cerrado</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                <tr style={{background:"var(--bg3)"}}>
                  <td colSpan={3} style={{...S.td,fontWeight:800,color:"var(--text)"}}>TOTAL</td>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:15,color:"var(--red)"}}>{fmt2(totalEstructura)} €</td>
                  <td style={S.td}/>
                </tr>
              </tbody>
            </table>
        }
      </div>

      {/* Reparto por camión */}
      {vActivos.length > 0 && totalEstructura > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:16,alignItems:"start"}}>
          {/* Donut chart */}
          <div style={{...S.card,padding:20,textAlign:"center"}}>
            <div style={{fontSize:11,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",marginBottom:12}}>Reparto visual</div>
            <svg viewBox="0 0 200 200" style={{width:"100%",maxWidth:200}}>
              {(()=>{
                const COLORS=['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899'];
                let startAngle=-Math.PI/2;
                const cx=100,cy=100,r=75,inner=45;
                return repartoPorCamion.map(({v,peso},i)=>{
                  const angle=peso*2*Math.PI;
                  const x1=cx+r*Math.cos(startAngle),y1=cy+r*Math.sin(startAngle);
                  const x2=cx+r*Math.cos(startAngle+angle),y2=cy+r*Math.sin(startAngle+angle);
                  const ix1=cx+inner*Math.cos(startAngle),iy1=cy+inner*Math.sin(startAngle);
                  const ix2=cx+inner*Math.cos(startAngle+angle),iy2=cy+inner*Math.sin(startAngle+angle);
                  const large=angle>Math.PI?1:0;
                  const path=`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`;
                  startAngle+=angle;
                  return <path key={v.id} d={path} fill={COLORS[i%COLORS.length]} opacity={0.9}/>;
                });
              })()}
              <text x="100" y="96" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="bold" fontFamily="monospace">{fmt2(totalEstructura)}</text>
              <text x="100" y="112" textAnchor="middle" fill="var(--text5)" fontSize="9" fontFamily="sans-serif">€ total</text>
            </svg>
            {/* Legend */}
            <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:4,textAlign:"left"}}>
              {repartoPorCamion.map(({v,peso},i)=>{
                const COLORS=['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899'];
                return (
                  <div key={v.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
                    <span style={{width:10,height:10,borderRadius:2,background:COLORS[i%COLORS.length],flexShrink:0,display:"inline-block"}}/>
                    <span style={{color:"var(--text3)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.matricula}</span>
                    <span style={{fontWeight:700,color:"var(--text)",fontFamily:"monospace"}}>{(peso*100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Bar breakdown */}
          <div style={{...S.card,padding:20}}>
            <div style={{fontSize:11,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",marginBottom:12}}>
              Coste por vehículo — {vActivos.length} camión{vActivos.length!==1?"es":""} (remolques excluidos)
            </div>
            {repartoPorCamion.length===0
              ? <div style={{color:"var(--text5)",fontSize:12,padding:"20px 0",textAlign:"center"}}>Sin vehículos activos. Añade tractoras en la sección Vehículos.</div>
              : repartoPorCamion.map(({v,peso,coste},i)=>{
                  const COLORS=['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899'];
                  const col=COLORS[i%COLORS.length];
                  return (
                    <div key={v.id} style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{width:8,height:8,borderRadius:2,background:col,display:"inline-block"}}/>
                          <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:13,color:"var(--text)"}}>{v.matricula}</span>
                          <span style={{fontSize:11,color:"var(--text5)"}}>{v.marca||""} {v.modelo||""}</span>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:14,color:col}}>{fmt2(coste)} €</span>
                          <span style={{fontSize:11,color:"var(--text5)",marginLeft:6}}>{(peso*100).toFixed(1)}%</span>
                        </div>
                      </div>
                      <div style={{background:"var(--bg4)",borderRadius:4,height:8,overflow:"hidden"}}>
                        <div style={{width:`${(peso*100).toFixed(1)}%`,height:"100%",background:col,borderRadius:4,transition:"width .4s ease"}}/>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </div>
      )}


      {modalGasto && <ModalGastoEstr editando={editGasto} onClose={recargar}/>}
    </div>
  );
}
