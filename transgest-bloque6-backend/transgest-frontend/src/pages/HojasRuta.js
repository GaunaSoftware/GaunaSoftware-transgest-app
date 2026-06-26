import { getLogoDataUrl } from "../services/logoHelper";
import { useState, useEffect, useCallback } from "react";
import { borrarNoche, borrarRepostaje, crearNoche, crearRepostaje, getNominasEmitidas, getChoferes, getChoferConfig, getGasoilConfig, getNochesVehiculo, getPedidos, getRepostajes, getVehiculos, getTallerEstado, setChoferConfig, setGasoilConfig } from "../services/api";
import { getChoferConfigSync, useChoferConfig } from "../hooks/useChoferConfig";
import { useEmpresaPerfil } from "../hooks/useEmpresaPerfil";
import { notify } from "../services/notify";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = n => Number(n||0).toLocaleString("es-ES",{maximumFractionDigits:0});
const fmtFecha = v => v ? new Date(String(v).slice(0,10)).toLocaleDateString("es-ES") : "";
const num = v => Number(v || 0) || 0;
function importeDietaPorTipo(cfg, tipo){
  if(tipo==="local") return num(cfg?.dieta_local);
  if(tipo==="internacional") return num(cfg?.dieta_internacional);
  return num(cfg?.dieta_nacional || cfg?.precio_noche || 40);
}
// gasoilVehSave → BD via setGasoilConfig
// litrosVehSave → BD via crearRepostaje
// nochesVehSave → BD via crearNoche
// choferExtSave → BD via setChoferConfig
function primerDiaMes(d){ const x=new Date(d); x.setDate(1); return x.toISOString().slice(0,10); }
function ultimoDiaMes(d){ const x=new Date(d); x.setMonth(x.getMonth()+1,0); return x.toISOString().slice(0,10); }
function precioCombDia(fecha,cfg){ if(!cfg||!cfg.tipo||cfg.tipo==="fijo") return Number((cfg&&cfg.precio_fijo)||0); const p=(cfg.periodos||[]).find(x=>fecha>=x.desde&&fecha<=x.hasta); return p?Number(p.precio||0):Number(cfg.precio_base||cfg.precio_fijo||0); }
const S={
  page:{flex:1,padding:"30px 36px",fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:"linear-gradient(180deg,#fbfdff 0%,#f8fafc 100%)"},
  card:{background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:12,padding:"18px 22px",marginBottom:16,boxShadow:"0 10px 30px rgba(15,23,42,.04)"},
  th:{textAlign:"left",padding:"13px 16px",fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",borderBottom:"1px solid var(--border)",whiteSpace:"nowrap",background:"rgba(248,250,252,.86)"},
  td:{padding:"11px 16px",borderBottom:"1px solid var(--border)",fontSize:12,color:"var(--text2)",verticalAlign:"middle"},
  btn:{padding:"10px 14px",borderRadius:8,border:"1px solid var(--border2)",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:7,background:"var(--bg3)",color:"var(--text3)"},
  inp:{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"11px 13px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
  lbl:{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:10},
};

function RouteSheetIcon({ icon = "truck" }) {
  const common = { width:22, height:22, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:"1.9", strokeLinecap:"round", strokeLinejoin:"round", "aria-hidden":"true" };
  if (icon === "clip") return <svg {...common}><path d="M9 5h6" /><path d="M9 3h6v4H9z" /><path d="M7 5H5v16h14V5h-2" /><path d="m9 14 2 2 4-5" /></svg>;
  if (icon === "doc") return <svg {...common}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /></svg>;
  if (icon === "fuel") return <svg {...common}><path d="M6 3h9v18H6z" /><path d="M9 7h3" /><path d="M15 8h2l2 2v8a2 2 0 0 1-2 2h-2" /></svg>;
  if (icon === "money") return <svg {...common}><path d="M4 7h16v10H4z" /><circle cx="12" cy="12" r="3" /></svg>;
  if (icon === "trend") return <svg {...common}><path d="m4 16 5-5 4 4 7-8" /><path d="M14 7h6v6" /></svg>;
  return <svg {...common}><path d="M3 7h10v9H3z" /><path d="M13 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>;
}

function RouteKpi({ label, value, unit, color, icon }) {
  const cleanLabel = String(label || "").replace(/â‚¬/g, "EUR").replace(/€/g, "EUR");
  const cleanUnit = String(unit || "").replace(/â‚¬/g, "EUR").replace(/€/g, "EUR");
  return (
    <div style={{background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:8,padding:"18px 18px",minHeight:76,display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 24px rgba(15,23,42,.04)"}}>
      <div style={{color,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <RouteSheetIcon icon={icon} />
      </div>
      <div style={{minWidth:0}}>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:18,color,lineHeight:1}}>{value} <span style={{fontSize:11}}>{cleanUnit}</span></div>
        <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".06em",marginTop:8,fontWeight:900}}>{cleanLabel}</div>
      </div>
    </div>
  );
}

function ModalGasoil({vehiculo,onClose}){
  const [cfg,setCfg]=useState({tipo:"fijo",precio_fijo:1.65,periodos:[]});
  // Load from API on mount
  useEffect(()=>{
    import("../services/api").then(({getGasoilConfig})=>{
      getGasoilConfig(vehiculo.id)
        .then(d=>{ if(d && (d.tipo||d.precio_fijo)) setCfg(d); })
        .catch(()=>{});
    });
  },[vehiculo.id]);
  const [np,setNp]=useState({desde:"",hasta:"",precio:""});
  function guardar(){
    setGasoilConfig(vehiculo.id,cfg)
      .then(()=>{ onClose(); })
      .catch(()=>{ onClose(); });
  }
  function addP(){if(!np.desde||!np.hasta||!np.precio){notify("Completa todos los campos", "warning");return;}setCfg(p=>({...p,periodos:[...(p.periodos||[]),{...np,id:"gp_"+Date.now()}]}));setNp({desde:"",hasta:"",precio:""});}
  function delP(id){setCfg(p=>({...p,periodos:(p.periodos||[]).filter(x=>x.id!==id)}));}
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:13,padding:22,width:"min(520px,96vw)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)"}}>&#9981; Gasoil — {vehiculo.matricula}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:18,cursor:"pointer"}}>&#x2715;</button>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {["fijo","periodos"].map(t=>(
            <button key={t} onClick={()=>setCfg(p=>({...p,tipo:t}))}
              style={{padding:"6px 16px",borderRadius:20,border:"1.5px solid "+(cfg.tipo===t?"var(--accent)":"var(--border)"),background:cfg.tipo===t?"rgba(59,130,246,.1)":"transparent",color:cfg.tipo===t?"var(--accent)":"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {t==="fijo"?"Precio fijo unico":"Precios por periodo"}
            </button>
          ))}
        </div>
        {cfg.tipo==="fijo"&&(<div><label style={S.lbl}>Precio por litro (EUR)</label><input type="number" step="0.001" style={{...S.inp,maxWidth:160}} value={cfg.precio_fijo||""} onChange={e=>setCfg(p=>({...p,precio_fijo:e.target.value}))}/></div>)}
        {cfg.tipo==="periodos"&&(
          <div>
            <label style={S.lbl}>Precio base (fuera de periodos)</label>
            <input type="number" step="0.001" style={{...S.inp,maxWidth:160}} value={cfg.precio_base||""} onChange={e=>setCfg(p=>({...p,precio_base:e.target.value}))}/>
            <div style={{marginTop:12,fontWeight:700,fontSize:11,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Periodos de precio</div>
            {(cfg.periodos||[]).map(p=>(
              <div key={p.id} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5,background:"var(--bg3)",padding:"6px 10px",borderRadius:7}}>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text)"}}>{p.desde} a {p.hasta}</span>
                <span style={{marginLeft:"auto",fontWeight:700,color:"var(--green)",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{fmt2(p.precio)} EUR/L</span>
                <button onClick={()=>delP(p.id)} style={{...S.btn,padding:"2px 7px",background:"rgba(239,68,68,.1)",color:"var(--red)",border:"none",fontSize:11}}>X</button>
              </div>
            ))}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px auto",gap:6,marginTop:8,alignItems:"end"}}>
              <div><label style={{...S.lbl,marginTop:0}}>Desde</label><input type="date" style={S.inp} value={np.desde} onChange={e=>setNp(p=>({...p,desde:e.target.value}))}/></div>
              <div><label style={{...S.lbl,marginTop:0}}>Hasta</label><input type="date" style={S.inp} value={np.hasta} onChange={e=>setNp(p=>({...p,hasta:e.target.value}))}/></div>
              <div><label style={{...S.lbl,marginTop:0}}>EUR/L</label><input type="number" step="0.001" style={S.inp} value={np.precio} onChange={e=>setNp(p=>({...p,precio:e.target.value}))}/></div>
              <button onClick={addP} style={{...S.btn,background:"var(--accent)",color:"#fff",marginTop:14}}>+ Añadir</button>
            </div>
          </div>
        )}
        <button onClick={guardar} style={{...S.btn,background:"var(--accent)",color:"#fff",marginTop:18,width:"100%",justifyContent:"center",fontSize:13,fontWeight:700}}>Guardar configuracion</button>
      </div>
    </div>
  );
}

function ModalLitros({vehiculo,fechaDesde,fechaHasta,onClose}){
  const [lista,setLista]=useState([]);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({fecha:new Date().toISOString().slice(0,10),litros:"",nota:""});
  useEffect(()=>{
    setLoading(true);
    getRepostajes(vehiculo.id)
        .then(d=>{ if(Array.isArray(d)) setLista(d.filter(x=>x.fecha>=fechaDesde&&x.fecha<=fechaHasta)); else setLista([]); })
        .catch(()=>{ setLista([]); })
      .finally(()=>setLoading(false));
  },[vehiculo.id,fechaDesde,fechaHasta]);
  const [adding, setAdding] = useState(false);
  async function add(){
    if(!form.fecha||!form.litros||Number(form.litros)<=0){
      notify("Introduce fecha y litros (mayor que 0)", "warning"); return;
    }
    setAdding(true);
    try {
      await crearRepostaje(vehiculo.id,{
        fecha:form.fecha,
        litros:Number(form.litros),
        precio_litro: Number(form.precio_litro||0)||null,
        notas:form.nota||null
      });
      // Clear form first
      setForm(p=>({...p,litros:"",nota:"",precio_litro:""}));
      // Then reload list
      const d = await getRepostajes(vehiculo.id);
      if(Array.isArray(d)) setLista(d.filter(x=>x.fecha>=fechaDesde&&x.fecha<=fechaHasta));
    } catch(e) {
      notify("Error al guardar: "+(e.message||"Error desconocido"), "error");
    } finally {
      setAdding(false);
    }
  }
  function del(id){borrarRepostaje(id).then(()=>setLista(p=>p.filter(x=>x.id!==id))).catch(e=>notify("Error: "+e.message, "error"));}
  const total=lista.reduce((s,x)=>s+Number(x.litros||0),0);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose(total)}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:13,padding:22,width:"min(480px,96vw)",maxHeight:"88vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)"}}>Litros repostados — {vehiculo.matricula}</div>
          <button onClick={()=>onClose(total)} style={{background:"none",border:"none",color:"var(--text4)",fontSize:18,cursor:"pointer"}}>X</button>
        </div>
        <div style={{background:"var(--bg3)",borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:"var(--text4)"}}>Total periodo {fechaDesde} a {fechaHasta}</span>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:18,color:"var(--accent)"}}>{fmtN(total)} L</span>
        </div>
        {loading ? <div style={{textAlign:"center",color:"var(--text4)",padding:20}}>⏳ Cargando repostajes...</div>
        : lista.length>0 ? (<table style={{width:"100%",borderCollapse:"collapse",marginBottom:12}}><thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Litros</th><th style={S.th}>Nota</th><th style={S.th}></th></tr></thead><tbody>{lista.map(x=>(<tr key={x.id}><td style={S.td}>{fmtFecha(x.fecha)}</td><td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{fmtN(x.litros)} L</td><td style={{...S.td,color:"var(--text4)"}}>{x.nota||"—"}</td><td style={S.td}><button onClick={()=>del(x.id)} style={{...S.btn,padding:"2px 7px",background:"rgba(239,68,68,.1)",color:"var(--red)",border:"none",fontSize:11}}>✕</button></td></tr>))}</tbody></table>)
        : <div style={{textAlign:"center",color:"var(--text5)",padding:"16px 0",fontSize:12}}>Sin repostajes registrados en este periodo</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 100px 100px 1fr auto",gap:6,alignItems:"end",marginTop:8}}>
          <div><label style={S.lbl}>Fecha repostaje</label><input type="date" style={S.inp} value={form.fecha} onChange={e=>setForm(p=>({...p,fecha:e.target.value}))}/></div>
          <div><label style={S.lbl}>Litros *</label><input type="number" step="0.1" min="0.1" style={{...S.inp,borderColor:!form.litros?"rgba(239,68,68,.5)":"var(--border2)"}} value={form.litros} onChange={e=>setForm(p=>({...p,litros:e.target.value}))}/></div>
          <div><label style={S.lbl}>€/L</label><input type="number" step="0.001" style={S.inp} value={form.precio_litro||""} onChange={e=>setForm(p=>({...p,precio_litro:e.target.value}))}/></div>
          <div><label style={S.lbl}>Nota</label><input style={S.inp} value={form.nota} onChange={e=>setForm(p=>({...p,nota:e.target.value}))}/></div>
          <button onClick={add} disabled={adding} style={{...S.btn,background:adding?"#666":"var(--accent)",color:"#fff",marginTop:14}}>{adding?"...":"+"}</button>
        </div>
        <button onClick={()=>onClose(total)} style={{...S.btn,background:"var(--accent)",color:"#fff",marginTop:16,width:"100%",justifyContent:"center",fontWeight:700,fontSize:13}}>Aceptar</button>
      </div>
    </div>
  );
}

function ModalNoches({vehiculo,choferConfig={},fechaDesde,fechaHasta,onClose}){
  const [lista,setLista]=useState([]);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({fecha:new Date().toISOString().slice(0,10),ciudad:"",importe:importeDietaPorTipo(choferConfig,"nacional")||"",chofer_id:"",tipo_dieta:"nacional"});
  useEffect(()=>{
    setLoading(true);
    getNochesVehiculo(vehiculo.id)
        .then(d=>{ if(Array.isArray(d)) setLista(d.filter(x=>x.fecha>=fechaDesde&&x.fecha<=fechaHasta)); else setLista([]); })
        .catch(()=>{ setLista([]); })
      .finally(()=>setLoading(false));
  },[vehiculo.id,fechaDesde,fechaHasta]);
  const [adding, setAdding] = useState(false);
  async function add(){
    if(!form.fecha||!form.importe||Number(form.importe)<=0){
      notify("Introduce fecha e importe (mayor que 0)", "warning"); return;
    }
    setAdding(true);
    try {
      await crearNoche(vehiculo.id,{
        fecha:form.fecha,
        ciudad:form.ciudad||null,
        importe:Number(form.importe),
        chofer_id:form.chofer_id||null,
        tipo_dieta:form.tipo_dieta||"nacional"
      });
      setForm(p=>({...p,importe:"",ciudad:""}));
      const d = await getNochesVehiculo(vehiculo.id);
      if(Array.isArray(d)) setLista(d.filter(x=>x.fecha>=fechaDesde&&x.fecha<=fechaHasta));
    } catch(e) {
      notify("Error al guardar noche: "+(e.message||"Error desconocido"), "error");
    } finally {
      setAdding(false);
    }
  }
  function del(id){borrarNoche(id).then(()=>setLista(p=>p.filter(x=>x.id!==id))).catch(e=>notify("Error: "+e.message, "error"));}
  const total=lista.reduce((s,x)=>s+Number(x.importe||0),0);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose(total)}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:13,padding:22,width:"min(480px,96vw)",maxHeight:"88vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)"}}>Noches — {vehiculo.matricula}</div>
          <button onClick={()=>onClose(total)} style={{background:"none",border:"none",color:"var(--text4)",fontSize:18,cursor:"pointer"}}>X</button>
        </div>
        <div style={{background:"var(--bg3)",borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:12,color:"var(--text4)"}}>Total periodo</span>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:"#a78bfa"}}>{fmt2(total)} EUR</span>
        </div>
        {loading ? <div style={{textAlign:"center",color:"var(--text4)",padding:20}}>⏳ Cargando repostajes...</div>
        : lista.length>0 ? (<table style={{width:"100%",borderCollapse:"collapse",marginBottom:12}}><thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Tipo</th><th style={S.th}>Ciudad</th><th style={S.th}>Importe</th><th style={S.th}></th></tr></thead><tbody>{lista.map(x=>(<tr key={x.id}><td style={S.td}>{fmtFecha(x.fecha)}</td><td style={{...S.td,textTransform:"capitalize"}}>{x.tipo_dieta||"nacional"}</td><td style={{...S.td,color:"var(--text4)"}}>{x.ciudad||"—"}</td><td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{fmt2(x.importe)} EUR</td><td style={S.td}><button onClick={()=>del(x.id)} style={{...S.btn,padding:"2px 7px",background:"rgba(239,68,68,.1)",color:"var(--red)",border:"none",fontSize:11}}>✕</button></td></tr>))}</tbody></table>)
        : <div style={{textAlign:"center",color:"var(--text5)",padding:"16px 0",fontSize:12}}>Sin noches registradas en este periodo</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 130px 100px auto",gap:6,alignItems:"end"}}>
          <div><label style={S.lbl}>Fecha</label><input type="date" style={S.inp} value={form.fecha} onChange={e=>setForm(p=>({...p,fecha:e.target.value}))}/></div>
          <div><label style={S.lbl}>Ciudad</label><input style={S.inp} value={form.ciudad} onChange={e=>setForm(p=>({...p,ciudad:e.target.value}))}/></div>
          <div><label style={S.lbl}>Tipo dieta</label><select style={S.inp} value={form.tipo_dieta} onChange={e=>setForm(p=>({...p,tipo_dieta:e.target.value,importe:p.importe||importeDietaPorTipo(choferConfig,e.target.value)}))}><option value="local">Local</option><option value="nacional">Nacional</option><option value="internacional">Internacional</option></select></div>
          <div><label style={S.lbl}>Importe EUR</label><input type="number" step="0.01" style={S.inp} value={form.importe} onChange={e=>setForm(p=>({...p,importe:e.target.value}))}/></div>
          <button onClick={add} disabled={adding} style={{...S.btn,background:adding?"#666":"var(--accent)",color:"#fff",marginTop:14}}>{adding?"...":"+"}</button>
        </div>
        <button onClick={()=>onClose(total)} style={{...S.btn,background:"var(--accent)",color:"#fff",marginTop:16,width:"100%",justifyContent:"center",fontWeight:700,fontSize:13}}>Aceptar</button>
      </div>
    </div>
  );
}

function ModalChoferExt({chofer,onClose}){
  const [form,setForm]=useState({salario_base:'',incentivo_pct:''});
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    // Load from API using top-level import
    setLoading(true);
    getChoferConfig(chofer.id)
      .then(d=>{ if(d) setForm(p=>({...p,...d})); })
      .catch(()=>{ const local=getChoferConfigSync(chofer.id); if(Object.keys(local).length) setForm(p=>({...p,...local})); })
      .finally(()=>setLoading(false));
  },[chofer.id]);
  async function guardar(){
    try {
      await setChoferConfig(chofer.id,form);
      onClose();
    } catch(e) {
      notify("Error al guardar: "+e.message, "error");
    }
  }
  async function importarConvenio(e){
    const file=e.target.files?.[0];
    if(!file) return;
    try{
      const text=await file.text();
      let patch={convenio_importado_nombre:file.name};
      if(file.name.toLowerCase().endsWith(".json")){
        const obj=JSON.parse(text);
        patch={...patch,...obj};
      }else{
        const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
        const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
        for(const line of lines){
          const parts=line.split(/[;,]/).map(x=>x.trim());
          if(parts.length<2) continue;
          const key=norm(parts[0]);
          const value=Number(String(parts[1]).replace(",","."));
          if(!Number.isFinite(value)) continue;
          if(key.includes("dieta")&&key.includes("local")) patch.dieta_local=value;
          else if(key.includes("dieta")&&key.includes("intern")) patch.dieta_internacional=value;
          else if(key.includes("dieta")||key.includes("nacional")||key.includes("noche")) patch.dieta_nacional=value;
          else if(key.includes("km")) patch.precio_km=value;
          else if(key.includes("dispon")&&key.includes("dia")) patch.disponibilidad_diaria=value;
          else if(key.includes("dispon")) patch.disponibilidad_mensual=value;
        }
      }
      setForm(p=>({...p,...patch}));
      notify("Convenio cargado en la ficha. Revisa importes antes de guardar.", "success");
    }catch(err){
      notify("No se pudo leer el convenio. Usa CSV simple: concepto;importe", "error");
    }finally{
      e.target.value="";
    }
  }
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:13,padding:22,width:"min(680px,96vw)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)"}}>Config. {chofer.nombre} {chofer.apellidos||""}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:18,cursor:"pointer"}}>X</button>
        </div>
        <label style={S.lbl}>Salario base (EUR/mes)</label>
        <input type="number" step="0.01" style={S.inp} value={form.salario_base} onChange={e=>setForm(p=>({...p,salario_base:Number(e.target.value)}))}/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10}}>
          <div><label style={S.lbl}>Incentivo sobre ingresos (%)</label><input type="number" step="0.1" min="0" max="100" style={S.inp} value={form.incentivo_pct} onChange={e=>setForm(p=>({...p,incentivo_pct:Number(e.target.value)}))}/></div>
          <div><label style={S.lbl}>Precio por km (EUR/km)</label><input type="number" step="0.0001" min="0" style={S.inp} value={form.precio_km||""} onChange={e=>setForm(p=>({...p,precio_km:Number(e.target.value)}))}/></div>
          <div><label style={S.lbl}>Km que se pagan</label><select style={S.inp} value={form.km_pago_tipo||"todos"} onChange={e=>setForm(p=>({...p,km_pago_tipo:e.target.value}))}><option value="todos">Km totales</option><option value="cargado">Solo km cargado</option><option value="vacio">Solo km vacio</option></select></div>
          <div><label style={S.lbl}>Convenio / pacto</label><input style={S.inp} value={form.convenio||""} onChange={e=>setForm(p=>({...p,convenio:e.target.value}))} placeholder="Ej: convenio provincial / acuerdo interno"/></div>
        </div>

        <div style={{marginTop:14,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:10,padding:12}}>
          <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text4)",marginBottom:8}}>Dietas segun convenio</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
            <div><label style={{...S.lbl,marginTop:0}}>Dieta local</label><input type="number" step="0.01" min="0" style={S.inp} value={form.dieta_local||""} onChange={e=>setForm(p=>({...p,dieta_local:Number(e.target.value)}))}/></div>
            <div><label style={{...S.lbl,marginTop:0}}>Dieta nacional</label><input type="number" step="0.01" min="0" style={S.inp} value={form.dieta_nacional||form.precio_noche||""} onChange={e=>setForm(p=>({...p,dieta_nacional:Number(e.target.value),precio_noche:Number(e.target.value)}))}/></div>
            <div><label style={{...S.lbl,marginTop:0}}>Dieta internacional</label><input type="number" step="0.01" min="0" style={S.inp} value={form.dieta_internacional||""} onChange={e=>setForm(p=>({...p,dieta_internacional:Number(e.target.value)}))}/></div>
          </div>
          <div style={{fontSize:10,color:"var(--text5)",lineHeight:1.5,marginTop:8}}>Se usan para pre-rellenar dietas en Hojas de Ruta. El importe final queda guardado por registro para justificarlo.</div>
        </div>

        <div style={{marginTop:12,background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.18)",borderRadius:10,padding:12}}>
          <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text4)",marginBottom:8}}>Disponibilidad pactada</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
            <div><label style={{...S.lbl,marginTop:0}}>Disponibilidad diaria</label><input type="number" step="0.01" min="0" style={S.inp} value={form.disponibilidad_diaria||""} onChange={e=>setForm(p=>({...p,disponibilidad_diaria:Number(e.target.value)}))}/></div>
            <div><label style={{...S.lbl,marginTop:0}}>Disponibilidad mensual</label><input type="number" step="0.01" min="0" style={S.inp} value={form.disponibilidad_mensual||""} onChange={e=>setForm(p=>({...p,disponibilidad_mensual:Number(e.target.value)}))}/></div>
          </div>
          <div style={{fontSize:10,color:"var(--text5)",lineHeight:1.5,marginTop:8}}>Concepto separado para pactos de disponibilidad. No sustituye horas extra ni descansos; revisar convenio antes de cerrar nomina.</div>
        </div>

        <label style={S.lbl}>Notas del convenio</label>
        <textarea style={{...S.inp,minHeight:64,resize:"vertical"}} value={form.convenio_notas||""} onChange={e=>setForm(p=>({...p,convenio_notas:e.target.value}))} placeholder="Importes, vigencia, provincia, condiciones o enlaces al convenio"/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginTop:10,flexWrap:"wrap"}}>
          <label style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text3)"}}>
            Subir convenio CSV/JSON
            <input type="file" accept=".csv,.txt,.json" onChange={importarConvenio} style={{display:"none"}}/>
          </label>
          {form.convenio_importado_nombre&&<div style={{fontSize:11,color:"var(--text5)"}}>Cargado: {form.convenio_importado_nombre}</div>}
        </div>
        <div style={{fontSize:11,color:"var(--text5)",marginTop:8}}>CSV simple aceptado: concepto;importe. Ejemplos: dieta nacional;45 | precio km;0,08 | disponibilidad diaria;12.</div>
        <button onClick={guardar} disabled={loading} style={{...S.btn,background:loading?"#666":"var(--accent)",color:"#fff",marginTop:18,width:"100%",justifyContent:"center",fontWeight:700,fontSize:13}}>{loading?"Cargando...":"Guardar"}</button>
      </div>
    </div>
  );
}

export default function HojasRuta(){
  const empresaPerfil = useEmpresaPerfil();
  const hoy=new Date().toISOString().slice(0,10);
  const [tab,setTab]=useState("hoja");
  const [fechaDesde,setFechaDesde]=useState(primerDiaMes(hoy));
  const [fechaHasta,setFechaHasta]=useState(ultimoDiaMes(hoy));
  const [vehiculoSel,setVehiculoSel]=useState("");
  const [vehiculos,setVehiculos]=useState([]);
  const [pedidos,setPedidos]=useState([]);
  const [choferes,setChoferes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [litrosSel,setLitrosSel]=useState(0);
  const [nochesSel,setNochesSel]=useState(0);    // total importe noches
  const [nochesCount,setNochesCount]=useState(0); // número de noches
  const [repostajesPeriodo,setRepostajesPeriodo]=useState([]);
  const [nochesPeriodo,setNochesPeriodo]=useState([]);
  const [gasoilCfgData,setGasoilCfgData]=useState({tipo:'fijo',precio_fijo:1.65,periodos:[]});
  const [modalGasoil,setModalGasoil]=useState(false);
  const [modalLitros,setModalLitros]=useState(false);
  const [modalNoches,setModalNoches]=useState(false);
  const [modalChofer,setModalChofer]=useState(false);
  const [cfgV,setCfgV]=useState(0);
  const [nominaEmitida,setNominaEmitida]=useState(null);
  const [taller,setTaller]=useState({ stock: [], reparaciones: [] });
  const recargar=useCallback(()=>setCfgV(v=>v+1),[]);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      try{
        const[v,p,c,t]=await Promise.all([getVehiculos().catch(()=>[]),getPedidos().catch(()=>[]),getChoferes().catch(()=>[]),getTallerEstado().catch(()=>null)]);
        const vArr=Array.isArray(v)?v:[];
        const pArr=Array.isArray(p)?p:(Array.isArray(p?.data)?p.data:[]);
        setVehiculos(vArr);setPedidos(pArr);setChoferes(Array.isArray(c)?c:[]);
        setTaller(t && typeof t === "object" ? t : { stock: [], reparaciones: [] });
        if(vArr.length>0) setVehiculoSel(prev => prev || vArr[0].id);
      }finally{setLoading(false);}
    }
    load();
  },[cfgV]);

  useEffect(()=>{
    if(!vehiculoSel||!vehiculos.length||!choferes.length) return;
    const veh=vehiculos.find(v=>v.id===vehiculoSel);
    const choferId=veh?(choferes.find(c=>c.vehiculo_id===veh.id||c.id===veh.chofer_id)?.id):null;
    if(!choferId){setNominaEmitida(null);return;}
    const mes=fechaDesde.slice(0,7);
    getNominasEmitidas({chofer_id:choferId}).catch(()=>[]).then(noms=>{
      const arr=Array.isArray(noms)?noms:[];
      setNominaEmitida(arr.find(n=>n.periodo&&n.periodo.startsWith(mes))||null);
    });
  },[vehiculoSel,fechaDesde,vehiculos,choferes]);

  useEffect(()=>{
    if(!vehiculoSel) return;
    // Load from API (not localStorage)
    Promise.all([
      getRepostajes(vehiculoSel).catch(()=>[]),
      getNochesVehiculo(vehiculoSel,{desde:fechaDesde,hasta:fechaHasta}).catch(()=>[]),
    ]).then(([repostajes, noches]) => {
      const repoArr = Array.isArray(repostajes) ? repostajes : [];
      const nochesArr = Array.isArray(noches) ? noches : [];
      const repostajesFiltered = repoArr.filter(x => { const f = (x.fecha||"").slice(0,10); return f>=fechaDesde && f<=fechaHasta; });
      const l = repostajesFiltered.reduce((s,x)=>s+Number(x.litros||0), 0);
      const nochesFiltered = nochesArr.filter(x => { const f = (x.fecha||"").slice(0,10); return f>=fechaDesde && f<=fechaHasta; });
      const n = nochesFiltered.reduce((s,x)=>s+Number(x.importe||0), 0);
      setRepostajesPeriodo(repostajesFiltered);
      setNochesPeriodo(nochesFiltered);
      setLitrosSel(l);
      setNochesSel(n);
      setNochesCount(nochesFiltered.length);
    });
  },[vehiculoSel,fechaDesde,fechaHasta,cfgV]);

  const vehiculo=vehiculos.find(v=>v.id===vehiculoSel);
  const chofer=vehiculo?choferes.find(c=>c.vehiculo_id===vehiculo.id||c.id===vehiculo.chofer_id):null;
  const choferExt = useChoferConfig(chofer?.id);

  // Load gasoil price config from API when vehicle changes (direct import)
  useEffect(()=>{
    if(!vehiculoSel) return;
    getGasoilConfig(vehiculoSel)
      .then(d=>{ if(d && (d.tipo || d.precio_fijo)) setGasoilCfgData(d); })
      .catch(()=>setGasoilCfgData({tipo:"fijo",precio_fijo:1.65,periodos:[]}));
  },[vehiculoSel,cfgV]);
  const gasoilCfg=vehiculoSel?gasoilCfgData:{tipo:"fijo",precio_fijo:1.65};

  const hoja=(()=>{
    if(!vehiculo) return null;
    const pedVeh=pedidos.filter(p=>{
      const f=(p.fecha_carga||p.fecha_pedido||"").slice(0,10);
      return p.vehiculo_id===vehiculo.id&&f>=fechaDesde&&f<=fechaHasta&&p.estado!=="cancelado";
    });
    const kmCargado=pedVeh.reduce((s,p)=>s+Number(p.km_ruta||p.km||0),0);
    const kmVacio=pedVeh.reduce((s,p)=>s+Number(p.km_vacio||0),0);
    const kmTotal = kmCargado+kmVacio;
    const ingresos=pedVeh.reduce((s,p)=>s+Number(p.importe||0),0);
    const viajes=pedVeh.length;
    const precioLitro=precioCombDia(fechaDesde,gasoilCfg);
    const costeGasoilReal=repostajesPeriodo.reduce((s,x)=>{
      const importe=Number(x.importe||0);
      if(importe>0) return s+importe;
      const precio=Number(x.precio_litro||0);
      return precio>0 ? s+(Number(x.litros||0)*precio) : s;
    },0);
    const costeGasoil=costeGasoilReal>0?costeGasoilReal:litrosSel*precioLitro;
    const costeTaller=taller.reparaciones.filter(r=>r.vehiculo_id===vehiculo.id&&r.fecha>=fechaDesde&&r.fecha<=fechaHasta).reduce((s,r)=>s+Number(r.coste_total||0),0);
    const costeNoches=nochesSel;
    const salarioBase=nominaEmitida?Number(nominaEmitida.salario_base||0):Number(choferExt.salario_base||0);
    const ssTrabajador=nominaEmitida?Number(nominaEmitida.ss_trabajador||0):salarioBase*0.0655;
    const ssEmpresa=nominaEmitida?Number(nominaEmitida.ss_empresa||0):salarioBase*0.2940;
    const retencionIRPF=nominaEmitida?Number(nominaEmitida.irpf||0):0;
    const liquidoNeto=nominaEmitida?Number(nominaEmitida.liquido||0):(salarioBase-ssTrabajador-retencionIRPF);
    const incentivoPct=Number(choferExt.incentivo_pct||0);
    const incentivo=ingresos>0?(ingresos*incentivoPct/100):0;
    const kmPagoTipo=choferExt.km_pago_tipo||"todos";
    const kmRetribuidos=kmPagoTipo==="cargado"?kmCargado:(kmPagoTipo==="vacio"?kmVacio:kmTotal);
    const pagoKm=kmRetribuidos*Number(choferExt.precio_km||0);
    const diasActivos=new Set([...pedVeh.map(p=>String(p.fecha_carga||p.fecha_pedido||"").slice(0,10)),...nochesPeriodo.map(n=>String(n.fecha||"").slice(0,10))].filter(Boolean)).size;
    const disponibilidad=Number(choferExt.disponibilidad_mensual||0)+(Number(choferExt.disponibilidad_diaria||0)*diasActivos);
    const totalChofer=salarioBase+incentivo+costeNoches+pagoKm+disponibilidad;
    const costeEmpresaTotal=salarioBase+ssEmpresa+incentivo+costeNoches+pagoKm+disponibilidad;
    const totalCostes=costeGasoil+costeTaller+costeEmpresaTotal;
    const margen=ingresos-totalCostes;
    const eurosKmIngresos=(kmTotal)>0?ingresos/kmTotal:0;     // ingresos/km total
    const eurosKmMargen=(kmTotal)>0?margen/kmTotal:0;          // margen bruto/km
    const eurosKmCostes=(kmTotal)>0?totalCostes/kmTotal:0;     // coste/km
    const eurosKm=eurosKmIngresos; // backward compat
    return{pedVeh,kmCargado,kmVacio,kmTotal,kmPagoTipo,kmRetribuidos,pagoKm,diasActivos,disponibilidad,ingresos,viajes,costeGasoil,precioLitro,costeTaller,costeNoches,salarioBase,ssTrabajador,ssEmpresa,retencionIRPF,liquidoNeto,incentivoPct,incentivo,totalChofer,costeEmpresaTotal,totalCostes,margen,eurosKm,eurosKmIngresos,eurosKmMargen,eurosKmCostes};
  })();

  function imprimir(){
    if(!vehiculo||!hoja) return;
    const empresa = empresaPerfil;
    const w=window.open("","_blank","width=800,height=900");
    w.document.write("<!DOCTYPE html><html><head><title>Hoja de Ruta "+vehiculo.matricula+"</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#111;font-size:12px}h1{font-size:18px;margin:0 0 4px 0}table{width:100%;border-collapse:collapse;margin:10px 0}th{background:#f5f5f5;border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase}td{border:1px solid #ddd;padding:6px 8px}.kpi{display:inline-block;background:#f8f8f8;border:1px solid #ddd;border-radius:6px;padding:8px 14px;margin:4px;text-align:center}.kpi-val{font-size:18px;font-weight:bold;font-family:monospace}.kpi-lbl{font-size:9px;color:#666;text-transform:uppercase}.resumen-row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:5px 0}.resumen-row.total{font-weight:bold;font-size:14px;border-top:2px solid #111;margin-top:4px}.firma{display:flex;gap:60px;margin-top:40px}.firma-box{flex:1;border-top:1px solid #111;padding-top:8px;font-size:10px;color:#555}</style></head><body>");
    w.document.write("<div style='display:flex;justify-content:space-between;margin-bottom:16px'><div>"+(getLogoDataUrl()?`<img src='${getLogoDataUrl()}' style='max-height:44px;max-width:140px;object-fit:contain;margin-bottom:4px;display:block;' alt='Logo'/>`:"")+"<h1>HOJA DE RUTA - "+vehiculo.matricula+"</h1><div>"+vehiculo.marca+" "+vehiculo.modelo+" - Periodo: "+fechaDesde+" a "+fechaHasta+"</div></div><div style='text-align:right;font-size:11px;color:#555'><div style='font-weight:bold;font-size:14px'>"+(empresa.razon_social||"EMPRESA")+"</div><div>Generado: "+new Date().toLocaleDateString("es-ES")+"</div></div></div>");
    if(chofer) w.document.write("<div style='background:#f0f4ff;border:1px solid #c7d5f8;padding:8px 12px;margin-bottom:14px;font-size:11px'>Chofer: <strong>"+chofer.nombre+" "+(chofer.apellidos||"")+"</strong>"+(choferExt.salario_base?" - Salario: <strong>"+fmt2(choferExt.salario_base)+" EUR</strong>":"")+(choferExt.incentivo_pct?" - Incentivo: <strong>"+choferExt.incentivo_pct+"%</strong>":"")+"</div>");
    w.document.write("<div style='margin-bottom:16px'>");
    [["Viajes",hoja.viajes,""],["Km cargado",fmtN(hoja.kmCargado),"km"],["Km vacio",fmtN(hoja.kmVacio),"km"],["Gasoil",fmtN(litrosSel),"L"],["Ingresos",fmt2(hoja.ingresos),"EUR"],["Margen",fmt2(hoja.margen),"EUR"]].forEach(function(k){w.document.write("<div class='kpi'><div class='kpi-val'>"+k[1]+" "+k[2]+"</div><div class='kpi-lbl'>"+k[0]+"</div></div>");});
    w.document.write("</div><h3 style='font-size:12px;text-transform:uppercase;color:#555;margin:14px 0 6px 0'>Viajes del periodo</h3>");
    w.document.write("<table><thead><tr><th>N Pedido</th><th>Fecha</th><th>Origen</th><th>Destino</th><th>Cliente</th><th>Km</th><th>Importe</th></tr></thead><tbody>");
    hoja.pedVeh.forEach(function(p){w.document.write("<tr><td>"+p.numero+"</td><td>"+(p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):"")+"</td><td>"+(p.origen||"")+"</td><td>"+(p.destino||"")+"</td><td>"+(p.cliente_nombre||"")+"</td><td style='text-align:right'>"+fmtN(p.km_ruta||p.km||0)+"</td><td style='text-align:right'>"+fmt2(p.importe||0)+" EUR</td></tr>");});
    w.document.write("</tbody></table><h3 style='font-size:12px;text-transform:uppercase;color:#555;margin:14px 0 6px 0'>Resumen de costes</h3><div style='max-width:400px'>");
    w.document.write("<div class='resumen-row'><span>Gasoil ("+fmtN(litrosSel)+" L x "+fmt2(hoja.precioLitro)+" EUR/L)</span><span>"+fmt2(hoja.costeGasoil)+" EUR</span></div>");
    w.document.write("<div class='resumen-row'><span>Mantenimiento / Taller</span><span>"+fmt2(hoja.costeTaller)+" EUR</span></div>");
    w.document.write("<div class='resumen-row'><span>Noches / Dietas</span><span>"+fmt2(hoja.costeNoches)+" EUR</span></div>");
    w.document.write("<div class='resumen-row'><span>Salario base chofer</span><span>"+fmt2(hoja.salarioBase)+" EUR</span></div>");
    w.document.write("<div class='resumen-row'><span>SS empresa</span><span>"+fmt2(hoja.ssEmpresa)+" EUR</span></div>");
    if(hoja.pagoKm>0) w.document.write("<div class='resumen-row'><span>Km retribuidos ("+fmtN(hoja.kmRetribuidos)+" km x "+fmt2(choferExt.precio_km)+" EUR/km)</span><span>"+fmt2(hoja.pagoKm)+" EUR</span></div>");
    if(hoja.disponibilidad>0) w.document.write("<div class='resumen-row'><span>Disponibilidad pactada ("+hoja.diasActivos+" dia(s))</span><span>"+fmt2(hoja.disponibilidad)+" EUR</span></div>");
    if(hoja.incentivo>0) w.document.write("<div class='resumen-row'><span>Incentivo ("+hoja.incentivoPct+"% x "+fmt2(hoja.ingresos)+" EUR)</span><span>"+fmt2(hoja.incentivo)+" EUR</span></div>");
    w.document.write("<div class='resumen-row total'><span>TOTAL COSTES</span><span>"+fmt2(hoja.totalCostes)+" EUR</span></div>");
    w.document.write("<div class='resumen-row total' style='color:"+(hoja.margen>=0?"#166534":"#991b1b")+"'><span>MARGEN BRUTO</span><span>"+fmt2(hoja.margen)+" EUR</span></div>");
    w.document.write("</div><div class='firma'><div class='firma-box'>Firma chofer:<br/><br/>"+(chofer?chofer.nombre+" "+(chofer.apellidos||""):"")+"</div><div class='firma-box'>Firma responsable:<br/><br/>"+(empresa.razon_social||"")+"</div></div></body></html>");
    w.document.close();w.focus();setTimeout(function(){w.print();},400);
  }

  const TABS=[["hoja","Hoja de ruta"],["gasoil","Gasoil"],["noches","Noches"],["chofer_cfg","Chofer / Nomina"]];

  return(
    <div className="tg-responsive-page" style={S.page}>
      <div style={{display:"flex",alignItems:"center",gap:18,marginBottom:24,flexWrap:"wrap"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:34,fontWeight:900,color:"var(--text)",marginRight:8}}>Hojas de Ruta</div>
        <select value={vehiculoSel} onChange={e=>setVehiculoSel(e.target.value)} style={{...S.inp,width:"auto",minWidth:290,fontWeight:800}}>
          {(()=>{
            const remIds = new Set(vehiculos.map(v=>v.remolque_id).filter(Boolean));
            return vehiculos
              .filter(v=>{
                const mat=(v.matricula||"").toUpperCase();
                const clase=(v.clase||v.tipo||"").toLowerCase();
                return !remIds.has(v.id)&&!mat.startsWith("R-")&&!mat.endsWith("-R")&&
                       !clase.includes("remolque")&&!clase.includes("semirremolque");
              })
              .map(v=>{
                const rem=v.remolque_matricula;
                return <option key={v.id} value={v.id}>{v.matricula}{rem?" 🔗 "+rem:""} — {v.marca} {v.modelo}</option>;
              });
          })()}
        </select>
        <input type="date" style={{...S.inp,width:170}} value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)}/>
        <span style={{color:"var(--text5)",fontSize:12}}>a</span>
        <input type="date" style={{...S.inp,width:170}} value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)}/>
        <button onClick={imprimir} style={{...S.btn,background:"var(--accent)",color:"#fff",border:"1px solid var(--accent)",marginLeft:"auto",padding:"12px 22px",fontSize:14}}>Imprimir / PDF</button>
      </div>

      {loading&&<div style={{color:"var(--text5)",padding:40,textAlign:"center"}}>Cargando datos...</div>}

      {!loading&&vehiculo&&(
        <>
          <div style={{...S.card,display:"flex",gap:28,flexWrap:"wrap",alignItems:"center",marginBottom:10,minHeight:70}}>
            <div style={{paddingRight:28,borderRight:"1px solid var(--border)"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:22,color:"var(--text)"}}>{vehiculo.matricula}</div>
              <div style={{fontSize:13,color:"var(--text4)",marginTop:4}}>{vehiculo.clase || vehiculo.marca || "Tractora"}</div>
            </div>
            {chofer&&(
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div>
                  <div style={{fontSize:15,fontWeight:900,color:"var(--accent-xl)"}}>{chofer.nombre} {chofer.apellidos||""}</div>
                  <div style={{fontSize:13,color:"var(--text5)",marginTop:3}}>{choferExt.salario_base?"Salario: "+fmt2(choferExt.salario_base)+" EUR":"Sin salario base"}{choferExt.incentivo_pct?" - Incentivo: "+choferExt.incentivo_pct+"%":""}</div>
                </div>
                <button onClick={()=>setModalChofer(true)} style={{...S.btn,background:"rgba(20,184,166,.08)",border:"1px solid rgba(20,184,166,.20)",color:"var(--accent-xl)",fontSize:12}}>Config.</button>
              </div>
            )}
          </div>

          <div style={{display:"flex",gap:20,borderBottom:"1px solid var(--border)",marginBottom:22,paddingLeft:2}}>
            {TABS.map(([id,l])=>(
              <button key={id} onClick={()=>setTab(id)} style={{...S.btn,borderRadius:0,border:"none",borderBottom:"3px solid "+(tab===id?"var(--accent)":"transparent"),color:tab===id?"var(--accent-xl)":"var(--text4)",background:"transparent",padding:"12px 0",fontSize:14,fontWeight:900}}>{l}</button>
            ))}
          </div>

          {tab==="hoja"&&hoja&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(165px,1fr))",gap:14,marginBottom:18}}>
                {[["Viajes",hoja.viajes,"","var(--accent)"],["Km cargado",fmtN(hoja.kmCargado),"km","#10b981"],["Km vacío",fmtN(hoja.kmVacio),"km","#f59e0b"],["Km pagados",fmtN(hoja.kmRetribuidos),"km","#0ea5e9"],["Gasoil",fmtN(litrosSel),"L","#f97316"],["Dietas",nochesCount,"reg.","#a78bfa"],["Disponibilidad",fmt2(hoja.disponibilidad),"€","#6366f1"],["Ingresos",fmt2(hoja.ingresos),"€","#10b981"],["Costes totales",fmt2(hoja.totalCostes),"€","#ef4444"],["Margen bruto",fmt2(hoja.margen),"€",hoja.margen>=0?"#10b981":"#ef4444"],["€/km (ing.)",fmt2(hoja.eurosKmIngresos),"€/km","#8b5cf6"],["€/km (margen)",fmt2(hoja.eurosKmMargen),"€/km",hoja.eurosKmMargen>=0?"#10b981":"#ef4444"],["€/km (coste)",fmt2(hoja.eurosKmCostes),"€/km","#f97316"]].map(([l,v,u,c])=>(
                  <RouteKpi key={l} label={l} value={v} unit={u} color={c} icon={l==="Gasoil"?"fuel":l==="Ingresos"||l==="Disponibilidad"?"money":String(l).includes("Margen")||String(l).includes("km")?"trend":l==="Viajes"?"truck":"doc"} />
                ))}
              </div>
              <div style={{...S.card,padding:"20px 24px"}}>
                <div style={{fontWeight:900,fontSize:13,color:"var(--accent-xl)",textTransform:"uppercase",letterSpacing:".04em",marginBottom:14}}>Desglose de costes</div>
                <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>
                  {[["Gasoil",repostajesPeriodo.some(r=>Number(r.importe||0)>0||Number(r.precio_litro||0)>0)?fmtN(litrosSel)+"L con precio real":fmtN(litrosSel)+"L x "+fmt2(hoja.precioLitro)+" EUR/L",fmt2(hoja.costeGasoil)],["Taller / Mantenimiento","",fmt2(hoja.costeTaller)],["Dietas / manutencion",nochesCount+" registro(s)",fmt2(hoja.costeNoches)],["Km retribuidos",fmtN(hoja.kmRetribuidos)+" km x "+fmt2(choferExt.precio_km||0)+" EUR/km",fmt2(hoja.pagoKm)],["Disponibilidad pactada",hoja.diasActivos+" dia(s) + mensual",fmt2(hoja.disponibilidad)],["Salario base chofer","",fmt2(hoja.salarioBase)],["SS empresa","",fmt2(hoja.ssEmpresa)],...(hoja.incentivo>0?[["Incentivo",hoja.incentivoPct+"% x "+fmt2(hoja.ingresos)+" EUR",fmt2(hoja.incentivo)]]:[] )].map(([l,d,v])=>(
                    <tr key={l}><td style={{...S.td,fontWeight:600,color:"var(--text)"}}>{l}</td><td style={{...S.td,color:"var(--text5)",fontSize:11}}>{d}</td><td style={{...S.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--text)"}}>{v} EUR</td></tr>
                  ))}
                  <tr style={{background:"linear-gradient(90deg, rgba(239,68,68,.09), rgba(239,68,68,.04))"}}><td style={{...S.td,fontWeight:900,color:"#ef4444"}} colSpan={2}>TOTAL COSTES</td><td style={{...S.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:15,color:"#ef4444"}}>{fmt2(hoja.totalCostes)} EUR</td></tr>
                  <tr style={{background:hoja.margen>=0?"linear-gradient(90deg, rgba(20,184,166,.12), rgba(20,184,166,.05))":"linear-gradient(90deg, rgba(239,68,68,.09), rgba(239,68,68,.04))"}}><td style={{...S.td,fontWeight:900,color:"var(--accent-xl)"}} colSpan={2}>MARGEN BRUTO</td><td style={{...S.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:16,color:hoja.margen>=0?"var(--accent-xl)":"#ef4444"}}>{fmt2(hoja.margen)} EUR</td></tr>
                </tbody></table>
              </div>
              <div style={{...S.card,padding:"20px 24px"}}>
                <div style={{fontWeight:900,fontSize:13,color:"var(--accent-xl)",textTransform:"uppercase",letterSpacing:".04em",marginBottom:14}}>Viajes del periodo ({hoja.viajes})</div>
                {hoja.pedVeh.length===0?(<div style={{padding:"32px 20px",textAlign:"center",color:"var(--text5)",display:"flex",alignItems:"center",justifyContent:"center",gap:20}}>
                  <div style={{width:58,height:58,borderRadius:"50%",background:"rgba(20,184,166,.10)",color:"var(--accent-xl)",display:"inline-flex",alignItems:"center",justifyContent:"center"}}><RouteSheetIcon icon="doc" /></div>
                  <div style={{textAlign:"left"}}><div style={{fontWeight:900,fontSize:14,color:"var(--text)"}}>Sin viajes en este periodo</div><div style={{fontSize:11,marginTop:4}}>Aun no se han registrado viajes en el rango de fechas seleccionado.</div></div>
                </div>):(
                  <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th style={S.th}>N</th><th style={S.th}>Fecha</th><th style={S.th}>Origen / Destino</th><th style={S.th}>Cliente</th><th style={S.th}>Km</th><th style={S.th}>Km vacio</th><th style={S.th}>Importe</th></tr></thead><tbody>
                    {hoja.pedVeh.map(p=>(<tr key={p.id}><td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--accent)"}}>{p.numero}</td><td style={S.td}>{p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):""}</td><td style={S.td}>{p.origen||""}{p.destino?" a "+p.destino:""}</td><td style={{...S.td,color:"var(--text4)"}}>{p.cliente_nombre||"—"}</td><td style={{...S.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{fmtN(p.km_ruta||p.km||0)}</td><td style={{...S.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",color:"#f59e0b"}}>{fmtN(p.km_vacio||0)}</td><td style={{...S.td,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--green)"}}>{fmt2(p.importe||0)} EUR</td></tr>))}
                  </tbody></table>
                )}
              </div>
            </>
          )}

          {tab==="gasoil"&&(
            <div style={S.card}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>Gasoil — {vehiculo.matricula}</div>
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Tipo: <strong>{gasoilCfg.tipo==="fijo"?"Precio fijo":"Por periodos"}</strong> - Precio aplicado: <strong style={{color:"var(--green)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt2(precioCombDia(hoy,gasoilCfg))} EUR/L</strong></div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setModalLitros(true)} style={{...S.btn,background:"rgba(249,115,22,.1)",color:"#f97316",border:"1px solid rgba(249,115,22,.25)"}}>Registrar litros</button>
                  <button onClick={()=>setModalGasoil(true)} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>Configurar precios</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
                {[["Litros periodo",fmtN(litrosSel)+" L","#f97316"],["Precio aplicado",fmt2(precioCombDia(fechaDesde,gasoilCfg))+" EUR/L","var(--green)"],["Coste total gasoil",fmt2(hoja?.costeGasoil||0)+" EUR","var(--red)"]].map(([l,v,c])=>(
                  <div key={l} style={{background:"var(--bg3)",borderRadius:8,padding:"12px 16px",textAlign:"center"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:18,color:c}}>{v}</div>
                    <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".06em"}}>{l}</div>
                  </div>
                ))}
              </div>
              {repostajesPeriodo.length>0&&(
                <table style={{width:"100%",borderCollapse:"collapse",marginBottom:16}}><thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Litros</th><th style={S.th}>EUR/L</th><th style={S.th}>Importe</th><th style={S.th}>Nota</th></tr></thead><tbody>
                  {repostajesPeriodo.map(x=>{
                    const precio=Number(x.precio_litro||0);
                    const importe=Number(x.importe||0) || (precio>0?Number(x.litros||0)*precio:0);
                    return <tr key={x.id}><td style={S.td}>{fmtFecha(x.fecha)}</td><td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{fmtN(x.litros)} L</td><td style={{...S.td,fontFamily:"'JetBrains Mono',monospace"}}>{precio>0?fmt2(precio):"-"}</td><td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"#f97316"}}>{importe>0?fmt2(importe)+" EUR":"-"}</td><td style={{...S.td,color:"var(--text4)"}}>{x.notas||x.nota||"-"}</td></tr>;
                  })}
                </tbody></table>
              )}
              {gasoilCfg.tipo==="periodos"&&(gasoilCfg.periodos||[]).length>0&&(
                <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th style={S.th}>Desde</th><th style={S.th}>Hasta</th><th style={S.th}>EUR/Litro</th></tr></thead><tbody>
                  {gasoilCfg.periodos.map((p,i)=>(<tr key={i}><td style={S.td}>{p.desde}</td><td style={S.td}>{p.hasta}</td><td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--green)"}}>{fmt2(p.precio)} EUR/L</td></tr>))}
                </tbody></table>
              )}
            </div>
          )}

          {tab==="noches"&&(()=>{
            // nochesSel is already loaded from API
            const total=nochesSel;
            const lista=nochesPeriodo;
            return(
              <div style={S.card}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>Noches / Dietas — {vehiculo.matricula}</div>
                    <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Noches registradas para este camion en el periodo seleccionado</div>
                  </div>
                  <button onClick={()=>setModalNoches(true)} style={{...S.btn,background:"rgba(167,139,250,.15)",color:"#a78bfa",border:"1px solid rgba(167,139,250,.25)"}}>+ Anadir noches</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:14}}>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"12px 16px",textAlign:"center"}}><div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:22,color:"#a78bfa"}}>{lista.length}</div><div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".06em"}}>Noches registradas</div></div>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"12px 16px",textAlign:"center"}}><div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:22,color:"#a78bfa"}}>{fmt2(total)} EUR</div><div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".06em"}}>Importe total</div></div>
                </div>
                {lista.length===0?(<div style={{padding:20,textAlign:"center",color:"var(--text5)"}}>Sin noches registradas en este periodo para {vehiculo.matricula}</div>):(
                  <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Tipo</th><th style={S.th}>Ciudad</th><th style={S.th}>Importe</th></tr></thead><tbody>
                    {lista.map(x=>(<tr key={x.id}><td style={S.td}>{fmtFecha(x.fecha)}</td><td style={{...S.td,textTransform:"capitalize"}}>{x.tipo_dieta||"nacional"}</td><td style={{...S.td,color:"var(--text4)"}}>{x.ciudad||"—"}</td><td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"#a78bfa"}}>{fmt2(x.importe)} EUR</td></tr>))}
                  </tbody></table>
                )}
              </div>
            );
          })()}

          {tab==="chofer_cfg"&&(
            <div style={S.card}>
              <div style={{fontWeight:800,fontSize:14,color:"var(--text)",marginBottom:14}}>💶 Nómina y coste del trabajador</div>
              {!chofer?(<div style={{color:"var(--text5)",padding:20,textAlign:"center"}}>Vehículo sin chófer asignado.</div>):(
                <>
                  {nominaEmitida?(
                    <div style={{background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.3)",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
                      <div style={{fontWeight:700,fontSize:12,color:"#10b981",marginBottom:10}}>✅ Nómina emitida — {nominaEmitida.periodo}</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                        {[["Salario bruto",hoja?.salarioBase||0,"var(--text)"],["SS trabajador (-)",hoja?.ssTrabajador||0,"#ef4444"],["IRPF ret. (-)",hoja?.retencionIRPF||0,"#f97316"],["💰 Líquido a cobrar",hoja?.liquidoNeto||0,"#10b981"],["SS empresa (+)",hoja?.ssEmpresa||0,"#6366f1"],["Coste empresa total",hoja?.costeEmpresaTotal||0,"#1d4ed8"]].map(([k,v,c])=>(
                          <div key={k} style={{background:"var(--bg3)",borderRadius:8,padding:"10px 12px"}}>
                            <div style={{fontSize:10,fontWeight:700,color:"var(--text5)",marginBottom:2}}>{k}</div>
                            <div style={{fontSize:14,fontWeight:800,color:c,fontFamily:"'JetBrains Mono',monospace"}}>{Number(v).toLocaleString("es-ES",{minimumFractionDigits:2})} €</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ):(
                    <div style={{background:"rgba(249,115,22,.08)",border:"1px solid rgba(249,115,22,.3)",borderRadius:10,padding:"12px 16px",marginBottom:12,fontSize:12,color:"#f97316"}}>
                      ⚠️ Sin nómina emitida para {fechaDesde.slice(0,7)}. Ve a <b>💶 Nóminas → Calcular nóminas</b> y emite la nómina de {chofer.nombre}.
                      {choferExt.salario_base&&<div style={{marginTop:6,color:"var(--text3)"}}>Config actual: salario base <b>{Number(choferExt.salario_base).toLocaleString("es-ES",{minimumFractionDigits:2})} €</b></div>}
                    </div>
                  )}
                  <button onClick={()=>setModalChofer(true)} style={{...S.btn,background:"var(--accent)",color:"#fff",fontSize:12,marginBottom:14}}>⚙️ Config. salario / incentivos</button>
                  {hoja&&(
                    <div style={{background:"var(--bg3)",borderRadius:10,padding:"14px 16px",marginBottom:14}}>
                      <div style={{fontWeight:700,fontSize:12,color:"var(--text)",marginBottom:10}}>🏭 Desglose coste empresa</div>
                      {[["Salario bruto",hoja.salarioBase],["+ Incentivo",hoja.incentivo],["+ Dietas / manutencion",hoja.costeNoches],["+ Km retribuidos",hoja.pagoKm],["+ Disponibilidad pactada",hoja.disponibilidad],["+ SS empresa (29,40%)",hoja.ssEmpresa]].filter(([,v])=>v>0).map(([k,v])=>(
                        <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid var(--border2)"}}>
                          <span style={{color:"var(--text3)"}}>{k}</span>
                          <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{Number(v).toLocaleString("es-ES",{minimumFractionDigits:2})} €</span>
                        </div>
                      ))}
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:800,marginTop:6,color:"#1d4ed8"}}>
                        <span>COSTE EMPRESA TOTAL</span>
                        <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{Number(hoja.costeEmpresaTotal||hoja.totalChofer).toLocaleString("es-ES",{minimumFractionDigits:2})} €</span>
                      </div>
                    </div>
                  )}
                  <div style={{background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.2)",borderRadius:10,padding:"14px 16px"}}>
                    <div style={{fontWeight:700,fontSize:12,color:"#ef4444",marginBottom:8}}>📋 Liquidación / Finiquito (Estatuto de los Trabajadores)</div>
                    {(()=>{
                      const sb=Number(choferExt.salario_base||0);
                      const diaS=sb/30;
                      return(
                        <div>
                          <div style={{fontSize:11,color:"var(--text4)",marginBottom:10,lineHeight:1.6}}>Conceptos del finiquito conforme al ET España. Los importes se calculan sobre el salario base configurado (<b>{sb.toLocaleString("es-ES",{minimumFractionDigits:2})} €/mes</b>):</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                            {[["Salario/día (base)",diaS.toFixed(2)+" €"],["Vacaciones/mes (2.5 días)",((diaS*2.5).toFixed(2))+" €"],["Paga extra/mes (prorrateada)",((sb/6).toFixed(2))+" €"],["Indemn. despido objetivo\n20 días/año (art. 52 ET)","20 × "+diaS.toFixed(2)+" × años"],["Indemn. despido improcedente\n33 días/año (art. 56 ET)","33 × "+diaS.toFixed(2)+" × años"],["SS trabajador sobre finiquito","6.55% s/base cotiz."]].map(([k,v])=>(
                              <div key={k} style={{background:"var(--bg3)",borderRadius:7,padding:"8px 12px"}}>
                                <div style={{fontSize:9,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",lineHeight:1.4,marginBottom:3}}>{k}</div>
                                <div style={{fontSize:12,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:"var(--text)"}}>{v}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{marginTop:10,fontSize:10,color:"var(--text5)",lineHeight:1.6}}>⚖️ Art. 49 ET: el finiquito incluye salario pendiente + vacaciones no disfrutadas + pagas extra pendientes ± liquidaciones. La indemnización depende del tipo de extinción. Consultar convenio colectivo aplicable.</div>
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {modalGasoil&&vehiculo&&<ModalGasoil vehiculo={vehiculo} onClose={()=>{setModalGasoil(false);recargar();}}/>}
      {modalLitros&&vehiculo&&<ModalLitros vehiculo={vehiculo} fechaDesde={fechaDesde} fechaHasta={fechaHasta} onClose={total=>{setLitrosSel(total);setModalLitros(false);recargar();}}/>}
      {modalNoches&&vehiculo&&<ModalNoches vehiculo={vehiculo} choferConfig={choferExt} fechaDesde={fechaDesde} fechaHasta={fechaHasta} onClose={total=>{setNochesSel(total);setModalNoches(false);recargar();}}/>}
      {modalChofer&&chofer&&<ModalChoferExt chofer={chofer} onClose={()=>{setModalChofer(false);recargar();}}/>}
    </div>
  );
}
