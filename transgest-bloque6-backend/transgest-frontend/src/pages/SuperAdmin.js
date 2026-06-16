import { useState, useEffect, useCallback } from "react";
import { confirmDialog, notify, promptDialog } from "../services/notify";
import { removeToken, setToken, setUser } from "../services/api";

const BASE = process.env.REACT_APP_API_URL || "";
const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = n => Number(n||0).toLocaleString("es-ES",{maximumFractionDigits:0});
const fmtDate = d => {
  if (!d) return "-";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("es-ES");
};

function getFiscalTestFreshness(test) {
  const testedAt = test?.tested_at ? new Date(test.tested_at) : null;
  if (!testedAt || Number.isNaN(testedAt.getTime())) return { label: "Sin probar", color: "#94a3b8" };
  const diffDays = Math.floor((Date.now() - testedAt.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return { label: "Reciente", color: "#34d399" };
  if (diffDays <= 30) return { label: "Conviene revisar", color: "#fbbf24" };
  return { label: "Caducada", color: "#f87171" };
}

function saToken(){
  if (typeof window === "undefined") return "";
  if (typeof window.__TMS_SA_TOKEN === "string") return window.__TMS_SA_TOKEN;
  try {
    const sessionToken = sessionStorage.getItem("tms_sa_token");
    if (sessionToken) {
      window.__TMS_SA_TOKEN = sessionToken;
      return sessionToken;
    }
  } catch {}
  try {
    const legacy = localStorage.getItem("tms_sa_token");
    if (legacy) {
      window.__TMS_SA_TOKEN = legacy;
      sessionStorage.setItem("tms_sa_token", legacy);
      localStorage.removeItem("tms_sa_token");
      return legacy;
    }
  } catch {}
  return "";
}
function saTokenSet(t){
  if (typeof window !== "undefined") window.__TMS_SA_TOKEN = t || "";
  try { sessionStorage.setItem("tms_sa_token", t || ""); } catch {}
  try { localStorage.removeItem("tms_sa_token"); } catch {}
}
function saTokenRem(){
  if (typeof window !== "undefined") window.__TMS_SA_TOKEN = "";
  try { sessionStorage.removeItem("tms_sa_token"); } catch {}
  try { localStorage.removeItem("tms_sa_token"); } catch {}
}

async function saFetch(path, opts={}){
  const res = await fetch(`${BASE}/api/v1/superadmin${path}`,{
    ...opts,
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+saToken(),...(opts.headers||{})},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    saTokenRem();
    throw new Error("Sesion de superadmin caducada. Vuelve a iniciar sesion.");
  }
  if(!res.ok) throw new Error(data.error||"Error");
  return data;
}

const PLAN_COLOR   = {basico:"#6b7280",profesional:"#3b82f6",enterprise:"#8b5cf6"};
const ESTADO_COLOR = {activo:"#10b981",suspendido:"#f59e0b",cancelado:"#ef4444"};
const PLANES_OPTS  = ["basico","profesional","enterprise"];
const PLAN_PRICES  = {basico:99,profesional:199,enterprise:399};
const monthlyPlanValue = (plan, ciclo="mensual") => {
  const base = PLAN_PRICES[plan] || 0;
  return ciclo === "anual" ? (base * 12 * 0.85) / 12 : base;
};

// Section
function LoginSA({ onLogin }){
  const [email,setEmail]=useState(""); const [pass,setPass]=useState("");
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  async function login(){
    setLoading(true); setErr("");
    try{
      const res=await fetch(`${BASE}/api/v1/superadmin/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:pass})});
      const data=await res.json();
      if(!res.ok){setErr(data.error);return;}
      saTokenSet(data.token); onLogin(data.nombre);
    }catch{setErr("Error de conexion");}
    finally{setLoading(false);}
  }
  const inp={width:"100%",background:"#1a2035",border:"1px solid #28344f",color:"#e2e8f0",padding:"11px 14px",borderRadius:9,fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",boxSizing:"border-box"};
  const lbl={display:"block",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#64748b",marginBottom:5,marginTop:14};
  return(
    <div style={{minHeight:"100vh",background:"#0f1420",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:"#141c2e",border:"1px solid #1c2740",borderRadius:16,padding:36,width:380}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:22,color:"#e2e8f0",textAlign:"center",marginBottom:6}}>TransGestAdmin</div>
        <div style={{textAlign:"center",fontSize:13,color:"#64748b",marginBottom:24}}>Panel de administracion</div>
        {err&&<div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,padding:"9px 12px",color:"#fca5a5",fontSize:13,marginBottom:14}}>{err}</div>}
        <label style={lbl}>Email</label>
        <input style={inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} autoFocus/>
        <label style={lbl}>Contrasena</label>
        <input style={inp} type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()}/>
        <button onClick={login} disabled={loading}
          style={{width:"100%",padding:"12px",borderRadius:9,border:"none",background:"#3b6ef5",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",marginTop:20}}>
          {loading?"Entrando...":"Entrar"}
        </button>
      </div>
    </div>
  );
}

// Section
function ModalNuevaEmpresa({ onClose, onCreada }){
  const [form,setForm]=useState({nombre_empresa:"",cif:"",nombre_admin:"",email_admin:"",plan:"profesional",ciclo_facturacion:"mensual",fecha_vencimiento:"",metodo_pago:"pendiente",email_facturacion:"",iban_facturacion:""});
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  const f=k=>e=>setForm(p=>({...p,[k]:e.target.value}));
  async function crear(){
    if(!form.nombre_empresa||!form.email_admin||!form.nombre_admin){setErr("Rellena todos los campos obligatorios");return;}
    setLoading(true); setErr("");
    try{
      const res = await saFetch("/empresas",{method:"POST",body:form});
      if(res.invitacion_url && res.email?.simulado){
        notify("Invitacion generada. Email en modo simulado:\n\n" + res.invitacion_url, "success", 12000);
      }
      onCreada();
    }
    catch(e){ setErr(e.message); }
    finally{ setLoading(false); }
  }
  const inp={background:"#1a2035",border:"1px solid #28344f",color:"#e2e8f0",padding:"8px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl={display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"#64748b",marginBottom:3,marginTop:12};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#141c2e",border:"1px solid #1c2740",borderRadius:14,padding:24,width:"min(500px,96vw)",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:18,color:"#e2e8f0",marginBottom:4}}>Nueva empresa</div>
        <div style={{fontSize:12,color:"#64748b",marginBottom:16}}>Se creara el espacio de datos y se enviara una invitacion al gerente valida durante 72 horas.</div>
        {err&&<div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,padding:"9px 12px",color:"#fca5a5",fontSize:13,marginBottom:12}}>{err}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Nombre empresa *</label><input style={inp} value={form.nombre_empresa} onChange={f("nombre_empresa")} placeholder="Transportes Garcia S.L."/></div>
          <div><label style={lbl}>CIF / NIF</label><input style={inp} value={form.cif} onChange={f("cif")} placeholder="B12345678"/></div>
          <div><label style={lbl}>Plan</label>
            <select style={inp} value={form.plan} onChange={f("plan")}>
              {PLANES_OPTS.map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Facturacion</label>
            <select style={inp} value={form.ciclo_facturacion} onChange={f("ciclo_facturacion")}>
              <option value="mensual">Mensual</option>
              <option value="anual">Anual (-15%)</option>
            </select>
          </div>
          <div><label style={lbl}>Metodo de pago</label>
            <select style={inp} value={form.metodo_pago} onChange={f("metodo_pago")}>
              <option value="pendiente">Pendiente</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="domiciliacion">Domiciliacion bancaria</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </div>
          <div style={{gridColumn:"1/-1",borderTop:"1px solid #1c2740",paddingTop:4,marginTop:8}}>
            <label style={{...lbl,color:"#94a3b8"}}>Administrador (rol gerente)</label>
          </div>
          <div><label style={lbl}>Nombre *</label><input style={inp} value={form.nombre_admin} onChange={f("nombre_admin")} placeholder="Carlos Garcia"/></div>
          <div><label style={lbl}>Email *</label><input type="email" style={inp} value={form.email_admin} onChange={f("email_admin")} placeholder="carlos@empresa.com"/></div>
          <div><label style={lbl}>Email facturacion</label><input type="email" style={inp} value={form.email_facturacion} onChange={f("email_facturacion")} placeholder="facturas@empresa.com"/></div>
          <div><label style={lbl}>IBAN domiciliacion</label><input style={inp} value={form.iban_facturacion} onChange={f("iban_facturacion")} placeholder="ES00..."/></div>
          <div><label style={lbl}>Vencimiento (vacio=sin limite)</label><input type="date" style={inp} value={form.fecha_vencimiento} onChange={f("fecha_vencimiento")}/></div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:16,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"8px 16px",borderRadius:8,border:"1px solid #1c2740",background:"transparent",color:"#64748b",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>Cancelar</button>
          <button onClick={crear} disabled={loading} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#3b6ef5",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer",opacity:loading ? .7 : 1}}>
            {loading?"Creando...":"Crear empresa e invitar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Section
function ModalEditarEmpresa({ empresa, onClose, onGuardado }){
  const [form,setForm]=useState({
    plan:empresa.plan,
    estado:empresa.estado,
    ciclo_facturacion:empresa.ciclo_facturacion||"mensual",
    fecha_vencimiento:empresa.fecha_vencimiento?.slice(0,10)||"",
    bloqueo_manual:!!empresa.bloqueo_manual,
    bloqueo_motivo:empresa.bloqueo_motivo||"",
    notas_comerciales:empresa.notas_comerciales||"",
    proxima_tarea:empresa.proxima_tarea||"",
    proxima_tarea_fecha:empresa.proxima_tarea_fecha?.slice(0,10)||"",
    ia_limite_mensual: empresa.ia_limite_mensual ?? (empresa.plan==="enterprise"?1000:0),
    metodo_pago: empresa.metodo_pago || "pendiente",
    email_facturacion: empresa.email_facturacion || empresa.email_admin || "",
    iban_facturacion: empresa.iban_facturacion || "",
  });
  const [loading,setLoading]=useState(false); const [err,setErr]=useState("");
  const f=k=>e=>setForm(p=>({...p,[k]:e.target.value}));
  async function guardar(){
    setLoading(true); setErr("");
    const body = { ...form, fecha_vencimiento: form.fecha_vencimiento || null };
    try{ await saFetch("/empresas/"+empresa.id,{method:"PATCH",body}); onGuardado(); }
    catch(e){ setErr(e.message); }
    finally{ setLoading(false); }
  }

  async function resetPasswordEmpresa(){
    try{
      const password = await promptDialog({
        title:"Cambiar contrasena de empresa",
        message:"Se cambiara la contrasena del gerente o primer usuario de la empresa. Minimo 8 caracteres.",
        inputType:"password",
        placeholder:"Nueva contrasena",
        confirmText:"Cambiar",
      });
      if(!password) return;
      await saFetch(`/empresas/${empresa.id}/reset-password`,{method:"POST",body:{password}});
      notify("Contrasena actualizada. Ya puedes iniciar sesion con ese usuario.", "success");
    }catch(e){ notify(e.message || "No se pudo cambiar la contrasena", "error"); }
  }

  async function reinvitarEmpresa(){
    try{
      const r = await saFetch(`/empresas/${empresa.id}/reinvitar`,{method:"POST",body:{email:empresa.email_admin}});
      if(r.invitacion_url && r.email?.simulado) notify("Invitacion generada en modo simulado:\n\n"+r.invitacion_url, "success", 12000);
      else notify("Invitacion enviada al gerente.", "success");
    }catch(e){ notify(e.message || "No se pudo enviar la invitacion", "error"); }
  }

  async function abrirCheckoutEmpresa(){
    try{
      const r = await saFetch(`/empresas/${empresa.id}/billing/checkout`,{method:"POST"});
      if(r.url) window.open(r.url, "_blank", "noopener,noreferrer");
    }catch(e){ notify(e.message || "No se pudo generar el enlace de pago", "error"); }
  }

  async function enviarAvisoPago(tipo="auto"){
    try{
      const r = await saFetch(`/empresas/${empresa.id}/billing/recordatorio`,{method:"POST",body:{tipo}});
      notify(r.checkout_url ? "Aviso de pago enviado con enlace Stripe." : "Aviso de pago enviado.", "success");
    }catch(e){ notify(e.message || "No se pudo enviar el aviso de pago", "error"); }
  }

  // Exportar datos de esta empresa
  async function exportar(tabla){
    const url = tabla
      ? `${BASE}/api/v1/superadmin/exportar/${empresa.id}/${tabla}`
      : `${BASE}/api/v1/superadmin/exportar/${empresa.id}`;
    const res = await fetch(url, { headers:{"Authorization":"Bearer "+saToken()} });
    if(!res.ok){
      const msg = await res.text().catch(() => "");
      notify("Error al exportar: " + (msg || res.status), "error");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const cd = res.headers.get("Content-Disposition")||"";
    const fname = cd.match(/filename="?([^"]+)"?/)?.[1] || `export_${empresa.id}.txt`;
    a.download = fname;
    a.click();
  }

  const inp={background:"#1a2035",border:"1px solid #28344f",color:"#e2e8f0",padding:"8px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl={display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"#64748b",marginBottom:3,marginTop:12};
  const btnExport={padding:"5px 10px",borderRadius:6,border:"1px solid #1c2740",background:"transparent",color:"#94a3b8",fontFamily:"'DM Sans',sans-serif",fontSize:11,cursor:"pointer"};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#141c2e",border:"1px solid #1c2740",borderRadius:14,padding:24,width:"min(500px,96vw)",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:16,color:"#e2e8f0",marginBottom:2}}>Editar {empresa.nombre}</div>
        <div style={{fontSize:12,color:"#64748b",marginBottom:16}}>{empresa.email_admin}</div>

        {err&&<div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,padding:"9px 12px",color:"#fca5a5",fontSize:12,marginBottom:12}}>{err}</div>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <div><label style={lbl}>Plan</label>
            <select style={inp} value={form.plan} onChange={f("plan")}>
              {PLANES_OPTS.map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
            </select></div>
          <div><label style={lbl}>Estado</label>
            <select style={inp} value={form.estado} onChange={f("estado")}>
              {["activo","suspendido","cancelado"].map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
            </select></div>
          <div><label style={lbl}>Facturacion</label>
            <select style={inp} value={form.ciclo_facturacion} onChange={f("ciclo_facturacion")}>
              <option value="mensual">Mensual</option>
              <option value="anual">Anual (-15%)</option>
            </select></div>
          <div><label style={lbl}>Metodo de pago</label>
            <select style={inp} value={form.metodo_pago} onChange={f("metodo_pago")}>
              <option value="pendiente">Pendiente</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="domiciliacion">Domiciliacion bancaria</option>
              <option value="transferencia">Transferencia</option>
            </select></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Vencimiento</label><input type="date" style={inp} value={form.fecha_vencimiento} onChange={f("fecha_vencimiento")}/></div>
          <div><label style={lbl}>Email facturacion</label><input type="email" style={inp} value={form.email_facturacion} onChange={f("email_facturacion")}/></div>
          <div><label style={lbl}>IBAN domiciliacion</label><input style={inp} value={form.iban_facturacion} onChange={f("iban_facturacion")} placeholder="ES00..."/></div>
          <div><label style={lbl}>Bloqueo manual</label>
            <select style={inp} value={form.bloqueo_manual?"true":"false"} onChange={e=>setForm(p=>({...p,bloqueo_manual:e.target.value==="true"}))}>
              <option value="false">No</option>
              <option value="true">Si</option>
            </select></div>
          <div><label style={lbl}>Motivo bloqueo</label>
            <select style={inp} value={form.bloqueo_motivo} onChange={f("bloqueo_motivo")}>
              <option value="">Sin motivo</option>
              <option value="impago">Impago</option>
              <option value="incidencia">Incidencia</option>
              <option value="baja_solicitada">Baja solicitada</option>
              <option value="prueba_finalizada">Prueba finalizada</option>
            </select></div>
          <div><label style={lbl}>Proxima tarea</label><input style={inp} value={form.proxima_tarea} onChange={f("proxima_tarea")} placeholder="Llamar, revisar pago..."/></div>
          <div><label style={lbl}>Fecha tarea</label><input type="date" style={inp} value={form.proxima_tarea_fecha} onChange={f("proxima_tarea_fecha")}/></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Limite IA mensual (0 = sin IA)</label><input type="number" style={inp} value={form.ia_limite_mensual} onChange={f("ia_limite_mensual")}/></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Notas comerciales</label><textarea style={{...inp,minHeight:70,resize:"vertical"}} value={form.notas_comerciales} onChange={f("notas_comerciales")} /></div>
        </div>

        <div style={{marginTop:18,borderTop:"1px solid #1c2740",paddingTop:14}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"#64748b",marginBottom:10}}>
            Accesos y cobros
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={resetPasswordEmpresa} style={{...btnExport,background:"rgba(20,184,166,.12)",color:"#5eead4",border:"1px solid rgba(20,184,166,.25)",fontWeight:700}}>Cambiar clave</button>
            <button onClick={reinvitarEmpresa} style={btnExport}>Reenviar invitacion</button>
            <button onClick={abrirCheckoutEmpresa} style={{...btnExport,background:"rgba(59,130,246,.15)",color:"#85B7EB",border:"1px solid rgba(59,130,246,.3)",fontWeight:700}}>Enlace Stripe</button>
            <button onClick={()=>enviarAvisoPago("proximo")} style={btnExport}>Aviso vencimiento</button>
            <button onClick={()=>enviarAvisoPago("vencido")} style={{...btnExport,color:"#fca5a5",border:"1px solid rgba(239,68,68,.25)"}}>Aviso impago</button>
          </div>
        </div>

        {/* Section */}
        <div style={{marginTop:18,borderTop:"1px solid #1c2740",paddingTop:14}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"#64748b",marginBottom:10}}>
            Exportar datos - servicio bajo peticion
          </div>
          <div style={{fontSize:12,color:"#94a3b8",marginBottom:10,lineHeight:1.6}}>
            Descarga todos los datos de la empresa en formato CSV para entregarselos al cliente.
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>exportar(null)} style={{...btnExport,background:"rgba(59,130,246,.15)",color:"#85B7EB",border:"1px solid rgba(59,130,246,.3)",fontWeight:700}}>
              Exportar TODO (TXT)
            </button>
            {["clientes","vehiculos","choferes","pedidos","facturas","colaboradores"].map(t=>(
              <button key={t} onClick={()=>exportar(t)} style={btnExport}>
                {t} CSV
              </button>
            ))}
          </div>
        </div>

        <div style={{display:"flex",gap:10,marginTop:16,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"8px 16px",borderRadius:8,border:"1px solid #1c2740",background:"transparent",color:"#64748b",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>Cancelar</button>
          <button onClick={guardar} disabled={loading} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#3b6ef5",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            {loading?"Guardando...":"Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UsuariosAdmin({ saFetchFn }) {
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState({ nombre:"", email:"", password:"", rol:"soporte" });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(() => {
    saFetchFn("/usuarios-admin")
      .then(d => setUsuarios(Array.isArray(d) ? d : []))
      .catch(e => setMsg(e.message));
  }, [saFetchFn]);

  useEffect(() => { cargar(); }, [cargar]);
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function crear() {
    if (!form.nombre || !form.email || !form.password) {
      setMsg("Nombre, email y contrasena son obligatorios");
      return;
    }
    setLoading(true); setMsg("");
    try {
      await saFetchFn("/usuarios-admin", { method:"POST", body:form });
      setForm({ nombre:"", email:"", password:"", rol:"soporte" });
      cargar();
      setMsg("Usuario interno creado");
    } catch (e) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function toggle(u) {
    try {
      await saFetchFn(`/usuarios-admin/${u.id}`, { method:"PATCH", body:{ activo:!u.activo } });
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  const inp = { background:"#1e293b", border:"1px solid #334155", color:"#f1f5f9",
    padding:"8px 10px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:13,
    outline:"none", width:"100%", boxSizing:"border-box" };

  return (
    <div style={{ maxWidth: 760, marginTop: 22 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 6 }}>
        Usuarios TransGestAdmin
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>
        Crea accesos internos para soporte, facturacion o superadmin.
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1.1fr 1.3fr .9fr .9fr auto", gap:8, alignItems:"end", marginBottom:14 }}>
        <input style={inp} value={form.nombre} onChange={f("nombre")} placeholder="Nombre" />
        <input style={inp} value={form.email} onChange={f("email")} placeholder="email@transgest.com" />
        <input style={inp} type="password" value={form.password} onChange={f("password")} placeholder="Contrasena" />
        <select style={inp} value={form.rol} onChange={f("rol")}>
          <option value="soporte">Soporte</option>
          <option value="facturacion">Facturacion</option>
          <option value="superadmin">Superadmin</option>
        </select>
        <button onClick={crear} disabled={loading} style={{padding:"8px 14px",borderRadius:7,border:"none",background:"#3b6ef5",color:"#fff",fontWeight:700,cursor:"pointer"}}>
          Crear
        </button>
      </div>

      {msg && <div style={{fontSize:12,color:msg.includes("creado")?"#22c55e":"#f87171",marginBottom:10}}>{msg}</div>}

      <div style={{border:"1px solid #334155",borderRadius:8,overflow:"hidden"}}>
        {usuarios.map(u => (
          <div key={u.id} style={{display:"grid",gridTemplateColumns:"1.2fr 1.4fr .8fr .7fr auto",gap:10,alignItems:"center",padding:"9px 12px",borderBottom:"1px solid #1e293b",fontSize:12,color:"#cbd5e1"}}>
            <strong style={{color:"#f1f5f9"}}>{u.nombre}</strong>
            <span>{u.email}</span>
            <span>{u.rol}</span>
            <span style={{color:u.activo?"#22c55e":"#f87171"}}>{u.activo?"Activo":"Inactivo"}</span>
            <button onClick={()=>toggle(u)} style={{padding:"5px 10px",borderRadius:6,border:"1px solid #334155",background:"transparent",color:"#94a3b8",cursor:"pointer"}}>
              {u.activo?"Desactivar":"Activar"}
            </button>
          </div>
        ))}
        {!usuarios.length && <div style={{padding:14,fontSize:12,color:"#64748b"}}>Sin usuarios internos.</div>}
      </div>
    </div>
  );
}

function IntegracionesAdmin({ saFetchFn }) {
  const [data, setData] = useState(null);
  const [salud, setSalud] = useState(null);
  const [integrationTab, setIntegrationTab] = useState("version");
  const [empresaId, setEmpresaId] = useState("");
  const [provider, setProvider] = useState("here");
  const [form, setForm] = useState({ use_global:true, activo:true, api_key:"", limite_mensual:0 });
  const [aiForm, setAiForm] = useState({ provider:"anthropic", base_url:"", model:"" });
  const [appMetaForm, setAppMetaForm] = useState({ brand_name:"TransGest", version_name:"TMS", version:"1.0.0", fiscal_software_name:"TransGest", fiscal_software_id:"transgest-tms" });
  const [loading, setLoading] = useState(true);
  const [gpsProvider, setGpsProvider] = useState("locatel");
  const [gpsForm, setGpsForm] = useState({ use_global:true, activo:true, api_key:"", limite_mensual:0 });
  const [showGpsProviderPicker, setShowGpsProviderPicker] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [testingProvider, setTestingProvider] = useState("");
  const [webhookTokenMsg, setWebhookTokenMsg] = useState(null);
  const [fiscalTestMsg, setFiscalTestMsg] = useState(null);
  const [testingFiscal, setTestingFiscal] = useState(false);
  const [fiscalQueueSummary, setFiscalQueueSummary] = useState(null);
  const [processingFiscalQueue, setProcessingFiscalQueue] = useState(false);
  const [iaQuota, setIaQuota] = useState("");
  const [fiscalAlertEmail, setFiscalAlertEmail] = useState("");
  const labels = { here:"HERE Routing camion", ors:"OpenRouteService", anthropic:"Anthropic / Claude", openai:"OpenAI", ai_generic:"IA compatible OpenAI", locatel:"Locatel GPS", tacogest:"Tacogest GPS", movildata:"Movildata GPS", gps_generic:"GPS generico" };

  const cargar = useCallback(() => {
    setLoading(true);
    Promise.all([
      saFetchFn("/integraciones"),
      saFetchFn("/integraciones/salud").catch(() => null),
    ]).then(([d, saludData]) => {
      setData(d);
      setSalud(saludData);
      if (!empresaId && d.empresas?.[0]) setEmpresaId(d.empresas[0].id);
      if (d.ai) setAiForm({ provider:d.ai.provider || "anthropic", base_url:d.ai.base_url || "", model:d.ai.model || "" });
      if (d.app_meta) setAppMetaForm({
        brand_name: d.app_meta.brand_name || "TransGest",
        version_name: d.app_meta.version_name || "TMS",
        version: d.app_meta.version || "1.0.0",
        fiscal_software_name: d.app_meta.fiscal_software_name || "TransGest",
        fiscal_software_id: d.app_meta.fiscal_software_id || "transgest-tms",
      });
    }).finally(()=>setLoading(false));
  }, [saFetchFn, empresaId]);

  useEffect(()=>{ cargar(); }, [cargar]);

  const selectedEmpresa = data?.empresas?.find(e => String(e.id) === String(empresaId));
  const cfgEmpresa = data?.configs?.find(c => c.empresa_id === empresaId && c.provider === provider);
  const gpsProviders = data?.gps_providers || ["locatel","tacogest","movildata","gps_generic"];
  const cfgGps = data?.configs?.find(c => c.empresa_id === empresaId && c.provider === gpsProvider);
  const fiscalCfgEmpresa = data?.fiscal_configs?.find(c => c.empresa_id === empresaId);
  const cfgGpsEmpresaId = cfgGps?.empresa_id;
  const cfgGpsProvider = cfgGps?.provider;
  const cfgGpsUseGlobal = cfgGps ? !!cfgGps.use_global : true;
  const cfgGpsLimite = cfgGps?.limite_mensual || 0;
  const cfgGpsUpdatedAt = cfgGps?.updated_at;
  const gpsActivoEmpresa = data?.gps_active?.[empresaId] || "";
  const cfgWebhookGps = data?.gps_webhooks?.find(c => c.empresa_id === empresaId && c.provider === gpsProvider);
  useEffect(() => {
    setIaQuota(selectedEmpresa?.ia_limite_mensual ?? 0);
  }, [selectedEmpresa?.id, selectedEmpresa?.ia_limite_mensual]);
  useEffect(() => {
    setForm({
      use_global: cfgEmpresa ? !!cfgEmpresa.use_global : true,
      activo: cfgEmpresa ? !!cfgEmpresa.activo : true,
      api_key: "",
      limite_mensual: cfgEmpresa?.limite_mensual || 0,
    });
  }, [cfgEmpresa?.empresa_id, cfgEmpresa?.provider, cfgEmpresa?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (gpsActivoEmpresa && gpsActivoEmpresa !== gpsProvider) setGpsProvider(gpsActivoEmpresa);
  }, [gpsActivoEmpresa, gpsProvider]);
  useEffect(() => {
    setShowGpsProviderPicker(false);
  }, [empresaId]);
  useEffect(() => {
    setGpsForm({
      use_global: cfgGpsUseGlobal,
      activo: true,
      api_key: "",
      limite_mensual: cfgGpsLimite,
    });
  }, [cfgGpsEmpresaId, cfgGpsProvider, cfgGpsUseGlobal, cfgGpsLimite, cfgGpsUpdatedAt]);
  useEffect(() => {
    setFiscalTestMsg(null);
    setFiscalQueueSummary(null);
  }, [empresaId]);
  useEffect(() => {
    if (fiscalCfgEmpresa?.ultima_prueba) {
      setFiscalTestMsg({ ok: true, test: fiscalCfgEmpresa.ultima_prueba });
    }
  }, [fiscalCfgEmpresa?.ultima_prueba]);
  useEffect(() => {
    setFiscalAlertEmail(fiscalCfgEmpresa?.email_alertas || "");
  }, [fiscalCfgEmpresa?.empresa_id, fiscalCfgEmpresa?.email_alertas]);
  const cargarFiscalQueueSummary = useCallback(async () => {
    if (!empresaId) return;
    try {
      const summary = await saFetchFn(`/integraciones/fiscal/${empresaId}/queue-summary`);
      setFiscalQueueSummary(summary);
    } catch {
      setFiscalQueueSummary(null);
    }
  }, [saFetchFn, empresaId]);
  useEffect(() => {
    if (!empresaId) return;
    cargarFiscalQueueSummary();
  }, [empresaId, cargarFiscalQueueSummary]);

  async function guardarGlobal(p) {
    try {
      const apiKey = await promptDialog({
        title: `Clave global ${labels[p] || p}`,
        message: "Se guardara cifrada en el backend. No se mostrara completa despues.",
        inputType: "password",
        placeholder: "Pega la API key",
        confirmText: "Guardar",
      });
      if (!apiKey) return;
      await saFetchFn(`/integraciones/global/${p}`, { method:"PUT", body:{ api_key: apiKey } });
      notify("Clave global guardada.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar la clave global.", "error");
    }
  }

  async function eliminarGlobal(p) {
    const ok = await confirmDialog({
      title: `Eliminar clave global ${labels[p] || p}`,
      message: "Las empresas que dependan de esta clave dejaran de usar ese proveedor.",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    await saFetchFn(`/integraciones/global/${p}`, { method:"DELETE" });
    notify("Clave global eliminada.", "success");
    cargar();
  }

  async function guardarEmpresa() {
    if (!empresaId) return;
    try {
      await saFetchFn(`/integraciones/empresas/${empresaId}/${provider}`, { method:"PUT", body:form });
      notify("Integracion de empresa guardada.", "success");
      setForm(p => ({ ...p, api_key:"" }));
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar la integracion de empresa.", "error");
    }
  }

  async function probarEmpresa(p = provider) {
    if (!empresaId || !p) return;
    setTestingProvider(p);
    setTestMsg(null);
    try {
      const r = await saFetchFn(`/integraciones/empresas/${empresaId}/${p}/test`, { method:"POST" });
      setTestMsg(r);
      notify(r.message || (r.ok ? "Integracion lista." : "Integracion incompleta."), r.ok ? "success" : "warning");
    } catch (e) {
      setTestMsg({ ok:false, provider:p, message:e.message || "No se pudo probar la integracion." });
      notify(e.message || "No se pudo probar la integracion.", "error");
    } finally {
      setTestingProvider("");
    }
  }

  async function probarFiscalEmpresa() {
    if (!empresaId) return;
    setTestingFiscal(true);
    setFiscalTestMsg(null);
    try {
      const r = await saFetchFn(`/integraciones/fiscal/${empresaId}/test`, { method:"POST" });
      setFiscalTestMsg(r);
      cargarFiscalQueueSummary();
      notify(r?.test?.message || (r?.test?.ok ? "Canal fiscal verificado." : "Revisa la integracion fiscal."), r?.test?.ok ? "success" : "warning");
    } catch (e) {
      setFiscalTestMsg({ ok:false, test:{ ok:false, message:e.message || "No se pudo probar el canal fiscal." } });
      notify(e.message || "No se pudo probar el canal fiscal.", "error");
    } finally {
      setTestingFiscal(false);
    }
  }

  async function guardarFiscalAlertEmail() {
    if (!empresaId) return;
    const email = String(fiscalAlertEmail || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      notify("Email de alertas fiscales no valido.", "error");
      return;
    }
    try {
      await saFetchFn(`/integraciones/fiscal/${empresaId}/alertas`, { method:"PUT", body:{ email_alertas: email } });
      notify(email ? "Email de alertas VERIFACTU guardado." : "Email de alertas VERIFACTU eliminado.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar el email de alertas fiscales.", "error");
    }
  }

  async function guardarCuotaIA() {
    if (!empresaId) return;
    const limite = Number(String(iaQuota ?? 0).replace(",", "."));
    if (!Number.isFinite(limite) || limite < 0) {
      notify("Limite IA no valido.", "error");
      return;
    }
    try {
      await saFetchFn(`/empresas/${empresaId}`, { method:"PATCH", body:{ ia_limite_mensual: Math.floor(limite) } });
      notify("Cuota IA de empresa guardada.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar la cuota IA.", "error");
    }
  }

  async function reencolarFiscalSoporte(item) {
    if (!empresaId || !item?.factura_id) return;
    const ok = await confirmDialog({
      title: "Reencolar envio fiscal",
      message: `Reencolar la factura ${item.numero || ""} para que vuelva a procesarse?`,
      confirmText: "Reencolar",
      tone: "warning",
    });
    if (!ok) return;
    try {
      const result = await saFetchFn(`/integraciones/fiscal/${empresaId}/facturas/${item.factura_id}/requeue`, { method:"POST" });
      notify(`Factura ${result.numero || item.numero || ""} reencolada.`, "success");
      await cargarFiscalQueueSummary();
    } catch (e) {
      notify(e.message || "No se pudo reencolar la factura fiscal.", "error");
    }
  }

  async function sincronizarFiscalSoporte(item) {
    if (!empresaId || !item?.factura_id) return;
    try {
      const result = await saFetchFn(`/integraciones/fiscal/${empresaId}/facturas/${item.factura_id}/sincronizar`, { method:"POST" });
      notify(`Verifacti ${result.numero || item.numero || ""}: ${String(result.provider_status || "pendiente").toUpperCase()}`, "success");
      await cargarFiscalQueueSummary();
    } catch (e) {
      notify(e.message || "No se pudo sincronizar con Verifacti.", "error");
    }
  }

  async function procesarColaFiscalSoporte() {
    if (!empresaId) return;
    const ok = await confirmDialog({
      title: "Procesar cola fiscal",
      message: "Procesar ahora hasta 20 envios pendientes o con error de esta empresa?",
      confirmText: "Procesar",
      tone: "warning",
    });
    if (!ok) return;
    setProcessingFiscalQueue(true);
    try {
      const result = await saFetchFn(`/integraciones/fiscal/${empresaId}/process-queue`, { method:"POST", body:{ limit:20 } });
      const r = result?.result || {};
      notify(`Cola procesada: ${Number(r.accepted || 0)} aceptados, ${Number(r.deferred || 0)} pendientes y ${Number(r.errors || 0)} errores.`, r.errors ? "warning" : "success");
      await cargarFiscalQueueSummary();
    } catch (e) {
      notify(e.message || "No se pudo procesar la cola fiscal.", "error");
    } finally {
      setProcessingFiscalQueue(false);
    }
  }

  async function limpiarClaveEmpresa(p = provider, gps = false) {
    if (!empresaId || !p) return;
    const ok = await confirmDialog({
      title: `Eliminar clave propia ${labels[p] || p}`,
      message: "Se eliminara solo la clave propia de esta empresa. Podra seguir usando la global si el modo queda en global.",
      confirmText: "Eliminar clave",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const body = gps ? { ...gpsForm, clear_key:true, api_key:"" } : { ...form, clear_key:true, api_key:"" };
      await saFetchFn(`/integraciones/empresas/${empresaId}/${p}`, { method:"PUT", body });
      notify("Clave propia eliminada.", "success");
      if (gps) setGpsForm(prev => ({ ...prev, api_key:"", use_global:true }));
      else setForm(prev => ({ ...prev, api_key:"", use_global:true }));
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo eliminar la clave propia.", "error");
    }
  }

  async function guardarGpsEmpresa() {
    if (!empresaId || !gpsProvider) return;
    try {
      await saFetchFn(`/integraciones/empresas/${empresaId}/${gpsProvider}`, { method:"PUT", body:{ ...gpsForm, activo:true } });
      notify("GPS de empresa guardado. El resto de proveedores GPS quedan inactivos para esta empresa.", "success");
      setGpsForm(p => ({ ...p, api_key:"" }));
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar el GPS de empresa.", "error");
    }
  }

  async function desactivarGpsEmpresa() {
    if (!empresaId || !gpsProvider) return;
    try {
      await saFetchFn(`/integraciones/empresas/${empresaId}/${gpsProvider}`, { method:"PUT", body:{ ...gpsForm, activo:false, api_key:"" } });
      notify("GPS desactivado para esta empresa.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo desactivar el GPS.", "error");
    }
  }

  async function generarWebhookGps() {
    if (!empresaId || !gpsProvider) return;
    const ok = await confirmDialog({
      title: "Generar token webhook GPS",
      message: "Se generara un token nuevo para recibir posiciones GPS. Si ya existia uno, dejara de servir.",
      confirmText: "Generar token",
    });
    if (!ok) return;
    try {
      const r = await saFetchFn(`/integraciones/empresas/${empresaId}/${gpsProvider}/webhook-token`, { method:"POST" });
      setWebhookTokenMsg(r);
      notify("Token webhook GPS generado. Copialo ahora.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo generar el token GPS.", "error");
    }
  }

  async function desactivarWebhookGps() {
    if (!empresaId || !gpsProvider) return;
    const ok = await confirmDialog({
      title: "Desactivar webhook GPS",
      message: "El proveedor dejara de poder enviar posiciones por webhook para esta empresa.",
      confirmText: "Desactivar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await saFetchFn(`/integraciones/empresas/${empresaId}/${gpsProvider}/webhook-token`, { method:"DELETE" });
      setWebhookTokenMsg(null);
      notify("Webhook GPS desactivado.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo desactivar el webhook GPS.", "error");
    }
  }

  async function guardarIA() {
    try {
      await saFetchFn("/integraciones/ia", { method:"PUT", body:aiForm });
      notify("Configuracion de IA guardada.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar la configuracion de IA.", "error");
    }
  }

  async function guardarAppMeta() {
    try {
      await saFetchFn("/config/app-meta", { method:"PUT", body:appMetaForm });
      if (typeof window !== "undefined") window.__TMS_APP_META = { ...appMetaForm };
      notify("Version global del programa guardada.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar la version global.", "error");
    }
  }

  if (loading && !data) return <div style={SaaS.empty}>Cargando integraciones...</div>;

  const input = {background:"#1a2035",border:"1px solid #28344f",color:"#e2e8f0",padding:"8px 10px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:12,outline:"none",width:"100%",boxSizing:"border-box"};
  const saludIntegraciones = salud || null;
  const saludTone = !saludIntegraciones
    ? { color:"#94a3b8", bg:"rgba(148,163,184,.08)", border:"#22304a", label:"Sin datos" }
    : saludIntegraciones?.resumen?.estado === "lista"
      ? { color:"#34d399", bg:"rgba(16,185,129,.10)", border:"rgba(16,185,129,.24)", label:"Lista" }
      : saludIntegraciones?.resumen?.estado === "vigilancia"
        ? { color:"#fbbf24", bg:"rgba(245,158,11,.10)", border:"rgba(245,158,11,.24)", label:"En vigilancia" }
        : { color:"#f87171", bg:"rgba(239,68,68,.10)", border:"rgba(239,68,68,.24)", label:"Bloqueada" };
  const companyProviderOptions = (data?.providers || []).filter(p => !gpsProviders.includes(p));
  const providerGlobalStatus = data?.global?.[provider] || {};
  const providerGlobalOk = !!providerGlobalStatus.global_configured;
  const providerReady = !!cfgEmpresa?.key_mask || (form.use_global !== false && providerGlobalOk);
  const gpsGlobalStatus = data?.global?.[gpsProvider] || {};
  const gpsGlobalOk = !!gpsGlobalStatus.global_configured;
  const gpsReady = !!cfgGps?.key_mask || (gpsForm.use_global !== false && gpsGlobalOk);
  const gpsActiveLabel = gpsActivoEmpresa ? (labels[gpsActivoEmpresa] || gpsActivoEmpresa) : "Sin GPS activo";
  const visibleGpsProviders = showGpsProviderPicker
    ? gpsProviders
    : [gpsProvider || gpsActivoEmpresa || gpsProviders[0]].filter(Boolean);
  const aiGlobalStatus = data?.global?.[aiForm.provider] || {};
  const aiGlobalOk = !!aiGlobalStatus.global_configured;
  const quickStatusCards = [
    {
      label: "GPS en uso",
      value: gpsActiveLabel,
      detail: gpsReady ? `Clave ${cfgGps?.key_mask ? "propia" : "global"} disponible` : "Pendiente de clave",
      color: gpsReady ? "#34d399" : "#94a3b8",
    },
    {
      label: "Rutas / IA seleccionada",
      value: labels[provider] || provider,
      detail: providerReady ? `Clave ${cfgEmpresa?.key_mask ? "propia" : "global"} disponible` : "Pendiente si se usa este proveedor",
      color: providerReady ? "#34d399" : "#94a3b8",
    },
    {
      label: "Motor IA global",
      value: labels[aiForm.provider] || aiForm.provider,
      detail: aiGlobalOk ? "Clave global disponible" : "Clave global pendiente",
      color: aiGlobalOk ? "#34d399" : "#94a3b8",
    },
    {
      label: "Alertas fiscales",
      value: fiscalCfgEmpresa?.email_alertas || "Sin email",
      detail: fiscalCfgEmpresa?.modo === "verifactu" ? "VERIFACTU" : fiscalCfgEmpresa?.modo === "sii" ? "SII" : "Sin activar",
      color: fiscalCfgEmpresa?.email_alertas ? "#34d399" : "#94a3b8",
    },
  ];
  const fiscalRows = (data?.empresas || []).map((empresa) => {
    const fiscal = data?.fiscal_configs?.find(c => c.empresa_id === empresa.id);
    return {
      empresa,
      fiscal,
      label: fiscal?.modo === "verifactu"
        ? `VERIFACTU${fiscal?.verifactu_provider === "verifacti" ? " - Verifacti" : ""}`
        : fiscal?.modo === "sii"
          ? "SII"
          : "Sin activar",
    };
  });
  const fiscalLevelMeta = fiscalCfgEmpresa?.status?.level === "ok"
    ? { color:"#34d399", bg:"rgba(16,185,129,.12)", border:"rgba(16,185,129,.25)", label:"Listo" }
    : fiscalCfgEmpresa?.status?.level === "warning"
      ? { color:"#fbbf24", bg:"rgba(245,158,11,.12)", border:"rgba(245,158,11,.25)", label:"Pendiente de revision" }
      : { color:"#f87171", bg:"rgba(239,68,68,.12)", border:"rgba(239,68,68,.25)", label:"Incompleto" };
  const fiscalModeLabel = fiscalCfgEmpresa?.modo === "verifactu"
    ? `VERIFACTU${fiscalCfgEmpresa?.verifactu_provider === "verifacti" ? " - Verifacti" : " - directo"}`
    : fiscalCfgEmpresa?.modo === "sii"
      ? "SII"
      : "Sin activar";
  const fiscalTestFreshness = getFiscalTestFreshness(fiscalCfgEmpresa?.ultima_prueba || fiscalTestMsg?.test);
  const integrationTabs = [
    ["salud", "Salud APIs"],
    ["version", "Version programa"],
    ["empresa", "Empresas y APIs"],
  ];

  return (
    <div style={SaaS.card}>
      <div style={SaaS.title}>Integraciones / APIs</div>
      <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.55,marginBottom:14}}>
        Las claves se guardan en backend y nunca se envian al navegador. La version es global; IA, GPS, mapas, fiscalidad y cuotas se gestionan por empresa desde una sola pantalla.
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {integrationTabs.map(([id, label]) => (
          <button
            key={id}
            onClick={()=>setIntegrationTab(id)}
            style={{
              ...SaaS.btn,
              padding:"8px 12px",
              background:integrationTab===id ? "rgba(20,184,166,.16)" : "#0f1728",
              color:integrationTab===id ? "#5eead4" : "#94a3b8",
              border:`1px solid ${integrationTab===id ? "rgba(20,184,166,.35)" : "#1c2740"}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{display:integrationTab==="salud" ? "block" : "none",background:"#0f1728",border:"1px solid #1c2740",borderRadius:8,padding:14,marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
          <div>
            <div style={{fontWeight:900,color:"#e2e8f0",fontSize:15}}>Salud de integraciones</div>
            <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.45,marginTop:4,maxWidth:860}}>
              Auditoria de configuracion de IA, rutas, GPS, SMTP, fiscal y seguridad. Las pruebas reales contra proveedor se hacen con el boton Probar de cada pestaña.
            </div>
          </div>
          <span style={{fontSize:11,fontWeight:900,color:saludTone.color,background:saludTone.bg,border:`1px solid ${saludTone.border}`,borderRadius:20,padding:"6px 11px"}}>
            {saludTone.label} {saludIntegraciones?.resumen?.score != null ? `- ${saludIntegraciones.resumen.score}%` : ""}
          </span>
        </div>
        {saludIntegraciones ? (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:8,marginBottom:12}}>
              {[
                ["OK", saludIntegraciones.resumen?.ok, "#34d399"],
                ["Avisos", saludIntegraciones.resumen?.warnings, "#fbbf24"],
                ["Bloqueos", saludIntegraciones.resumen?.blocked, "#f87171"],
                ["Empresas", saludIntegraciones.empresas?.length, "#93c5fd"],
              ].map(([label, value, color]) => (
                <div key={label} style={{background:"#121b2d",border:"1px solid #22304a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:10,color:"#64748b",fontWeight:900,textTransform:"uppercase"}}>{label}</div>
                  <div style={{fontSize:20,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color,marginTop:4}}>{fmtN(value || 0)}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:8}}>
              {(saludIntegraciones.checks || []).map(check => {
                const tone = check.estado === "ok"
                  ? { color:"#34d399", bg:"rgba(16,185,129,.08)", border:"rgba(16,185,129,.20)", label:"OK" }
                  : check.estado === "warning"
                    ? { color:"#fbbf24", bg:"rgba(245,158,11,.08)", border:"rgba(245,158,11,.22)", label:"Aviso" }
                    : { color:"#f87171", bg:"rgba(239,68,68,.08)", border:"rgba(239,68,68,.22)", label:"Bloqueo" };
                return (
                  <div key={check.key} style={{background:tone.bg,border:`1px solid ${tone.border}`,borderRadius:8,padding:11}}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                      <div style={{fontSize:10,color:"#94a3b8",fontWeight:900,textTransform:"uppercase"}}>{check.area}</div>
                      <span style={{fontSize:10,color:tone.color,fontWeight:900}}>{tone.label}</span>
                    </div>
                    <div style={{fontSize:13,color:"#e2e8f0",fontWeight:900,marginTop:5}}>{check.label}</div>
                    <div style={{fontSize:11,color:"#cbd5e1",lineHeight:1.45,marginTop:5}}>{check.detail}</div>
                    {!!check.warnings?.length && (
                      <div style={{fontSize:10,color:"#fbbf24",lineHeight:1.45,marginTop:6}}>
                        {check.warnings.slice(0, 2).join(" | ")}
                      </div>
                    )}
                    {check.estado !== "ok" && check.action && (
                      <div style={{fontSize:10,color:"#94a3b8",lineHeight:1.45,marginTop:6}}>
                        Accion: {check.action}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!!saludIntegraciones.acciones_prioritarias?.length && (
              <div style={{marginTop:12,padding:"10px 12px",borderRadius:8,border:"1px solid #22304a",background:"#121b2d"}}>
                <div style={{fontSize:11,fontWeight:900,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em",marginBottom:7}}>
                  Acciones prioritarias
                </div>
                <div style={{display:"grid",gap:6}}>
                  {saludIntegraciones.acciones_prioritarias.slice(0, 5).map(item => (
                    <div key={item.key} style={{fontSize:11,color:"#cbd5e1",lineHeight:1.45}}>
                      <strong style={{color:item.estado==="blocked"?"#f87171":"#fbbf24"}}>{item.area}:</strong> {item.action}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{marginTop:12,fontSize:11,color:"#64748b",lineHeight:1.45}}>
              Ultima generacion: {saludIntegraciones.generated_at ? new Date(saludIntegraciones.generated_at).toLocaleString("es-ES") : "-"}.
              No se exponen claves ni tokens completos en este diagnostico.
            </div>
          </>
        ) : (
          <div style={{fontSize:12,color:"#94a3b8",padding:"10px 0"}}>No se pudo cargar el diagnostico de integraciones.</div>
        )}
      </div>

      <div style={{display:integrationTab==="empresa" ? "block" : "none", background:"#0f1728",border:"1px solid #1c2740",borderRadius:8,padding:14,marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
          <div>
            <div style={{fontWeight:900,color:"#e2e8f0",fontSize:15}}>Gestion por empresa</div>
            <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.45,marginTop:4}}>
              Selecciona una empresa y gestiona sus claves, cuotas, GPS, mapas, IA y canal fiscal desde aqui. En GPS solo puede quedar un proveedor activo a la vez.
            </div>
          </div>
          <select style={{...input,maxWidth:360}} value={empresaId} onChange={e=>setEmpresaId(e.target.value)}>
            {(data?.empresas || []).map(e => <option key={e.id} value={e.id}>{e.nombre} - {e.plan}</option>)}
          </select>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8,marginBottom:14}}>
          {quickStatusCards.map(card => (
            <div key={card.label} style={{background:"#121b2d",border:"1px solid #22304a",borderRadius:8,padding:10}}>
              <div style={{fontSize:10,color:"#64748b",fontWeight:900,textTransform:"uppercase"}}>{card.label}</div>
              <div style={{fontSize:13,fontWeight:900,color:"#e2e8f0",marginTop:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={String(card.value || "")}>
                {card.value}
              </div>
              <div style={{fontSize:10,color:card.color,fontWeight:800,marginTop:5}}>
                {card.detail}
              </div>
            </div>
          ))}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10,marginBottom:14}}>
          <div style={{background:"#121b2d",border:"1px solid #22304a",borderRadius:8,padding:12}}>
            <div style={{fontSize:13,fontWeight:900,color:"#e2e8f0"}}>Cuota IA de la empresa</div>
            <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.45,marginTop:4}}>
              Limita el consumo aunque la clave de IA sea global. 0 deja la IA de pago bloqueada para esa empresa.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"end",marginTop:10}}>
              <div>
                <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Usos mensuales maximos</label>
                <input type="number" min="0" step="1" style={input} value={iaQuota} onChange={e=>setIaQuota(e.target.value)} />
              </div>
              <button onClick={guardarCuotaIA} style={{...SaaS.btnOk,height:36}}>Guardar cuota</button>
            </div>
          </div>
          <div style={{background:"#121b2d",border:"1px solid #22304a",borderRadius:8,padding:12}}>
            <div style={{fontSize:13,fontWeight:900,color:"#e2e8f0"}}>Consumo IA actual</div>
            <div style={{fontSize:24,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:"#5eead4",marginTop:8}}>
              {Number(selectedEmpresa?.ia_usos_mes || 0)} / {Number(selectedEmpresa?.ia_limite_mensual || 0)}
            </div>
            <div style={{fontSize:11,color:"#64748b",marginTop:5}}>
              Periodo {selectedEmpresa?.ia_periodo_mes || new Date().toISOString().slice(0,7)}. Las cuotas propias de proveedor se guardan debajo.
            </div>
            <div style={{borderTop:"1px solid #22304a",marginTop:12,paddingTop:10}}>
              <div style={{fontSize:11,fontWeight:900,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".05em",marginBottom:8}}>
                Motor IA global
              </div>
              <div style={{display:"grid",gridTemplateColumns:"minmax(160px,.8fr) minmax(170px,1fr) minmax(170px,1fr) auto",gap:8,alignItems:"end"}}>
                <div>
                  <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Proveedor</label>
                  <select style={input} value={aiForm.provider} onChange={e=>setAiForm(p=>({...p,provider:e.target.value}))}>
                    {(data?.ai_providers || ["anthropic","openai","ai_generic"]).map(p => <option key={p} value={p}>{labels[p] || p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>URL base</label>
                  <input style={input} value={aiForm.base_url} onChange={e=>setAiForm(p=>({...p,base_url:e.target.value}))} placeholder="https://api.proveedor.com/v1" />
                </div>
                <div>
                  <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Modelo</label>
                  <input style={input} value={aiForm.model} onChange={e=>setAiForm(p=>({...p,model:e.target.value}))} placeholder="gpt-4o-mini, claude-sonnet..." />
                </div>
                <button onClick={guardarIA} style={{...SaaS.btnOk,height:36}}>Guardar IA</button>
              </div>
            </div>
          </div>
        </div>

        <div style={{display:"block",marginBottom:14,background:"#121b2d",border:"1px solid #22304a",borderRadius:8,padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:13,fontWeight:900,color:"#e2e8f0"}}>Fiscal por empresa</div>
              <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.45,marginTop:4,maxWidth:780}}>
                VERIFACTU y SII se revisan siempre a nivel de empresa. La API o certificado fiscal no se comparte globalmente entre clientes.
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:11,fontWeight:900,color:fiscalLevelMeta.color,background:fiscalLevelMeta.bg,border:`1px solid ${fiscalLevelMeta.border}`,borderRadius:20,padding:"5px 10px"}}>
                {fiscalLevelMeta.label}
              </span>
              <button onClick={probarFiscalEmpresa} disabled={testingFiscal} style={{...SaaS.btn,height:34}}>
                {testingFiscal ? "Probando..." : "Probar canal fiscal"}
              </button>
              <button onClick={procesarColaFiscalSoporte} disabled={processingFiscalQueue} style={{...SaaS.btn,height:34,color:"#fbbf24",borderColor:"rgba(245,158,11,.28)"}}>
                {processingFiscalQueue ? "Procesando..." : "Procesar cola"}
              </button>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginTop:12}}>
            <div>
              <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Modo</div>
              <div style={{fontSize:13,color:"#e2e8f0",fontWeight:800,marginTop:4}}>{fiscalModeLabel}</div>
            </div>
            <div>
              <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Entorno</div>
              <div style={{fontSize:13,color:"#e2e8f0",fontWeight:800,marginTop:4}}>
                {fiscalCfgEmpresa?.entorno === "produccion" ? "Produccion" : "Pruebas"}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Estado</div>
              <div style={{fontSize:13,color:fiscalLevelMeta.color,fontWeight:800,marginTop:4}}>
                {fiscalCfgEmpresa?.status?.summary || "Sin configurar"}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Produccion</div>
              <div style={{fontSize:13,color:fiscalCfgEmpresa?.status?.production_ready ? "#34d399" : "#94a3b8",fontWeight:800,marginTop:4}}>
                {fiscalCfgEmpresa?.status?.production_ready ? "Lista" : "Pendiente"}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Ultima prueba</div>
              <div style={{fontSize:13,color:"#e2e8f0",fontWeight:800,marginTop:4}}>
                {fiscalCfgEmpresa?.ultima_prueba?.tested_at
                  ? new Date(fiscalCfgEmpresa.ultima_prueba.tested_at).toLocaleString("es-ES")
                  : "Sin probar"}
              </div>
              <div style={{fontSize:10,color:fiscalTestFreshness.color,fontWeight:900,marginTop:4}}>
                {fiscalTestFreshness.label}
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"minmax(220px,1fr) auto",gap:8,alignItems:"end",marginTop:12}}>
            <div>
              <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Email alertas VERIFACTU / SII</label>
              <input
                type="email"
                style={input}
                value={fiscalAlertEmail}
                onChange={e=>setFiscalAlertEmail(e.target.value)}
                placeholder="fiscal@empresa.com"
              />
            </div>
            <button onClick={guardarFiscalAlertEmail} style={{...SaaS.btnOk,height:36}}>Guardar alertas</button>
          </div>
          {!!fiscalCfgEmpresa?.status?.issues?.length && (
            <div style={{marginTop:10,fontSize:11,color:"#fca5a5",lineHeight:1.55}}>
              Pendiente: {fiscalCfgEmpresa.status.issues.slice(0, 3).join(" | ")}
              {fiscalCfgEmpresa.status.issues.length > 3 ? " | ..." : ""}
            </div>
          )}
          {!!fiscalCfgEmpresa?.status?.warnings?.length && (
            <div style={{marginTop:8,fontSize:11,color:"#fbbf24",lineHeight:1.55}}>
              Revisar: {fiscalCfgEmpresa.status.warnings.slice(0, 2).join(" | ")}
              {fiscalCfgEmpresa.status.warnings.length > 2 ? " | ..." : ""}
            </div>
          )}
          {fiscalTestMsg?.test && (
            <div style={{
              marginTop:12,
              padding:"10px 12px",
              borderRadius:8,
              border:`1px solid ${fiscalTestMsg.test.ok ? "rgba(16,185,129,.24)" : "rgba(245,158,11,.26)"}`,
              background:fiscalTestMsg.test.ok ? "rgba(16,185,129,.08)" : "rgba(245,158,11,.08)",
            }}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{fontSize:12,fontWeight:900,color:fiscalTestMsg.test.ok ? "#34d399" : "#fbbf24"}}>
                  {fiscalTestMsg.test.ok ? "Canal fiscal verificado" : "Diagnostico fiscal"}
                </div>
                <div style={{fontSize:11,color:"#94a3b8",fontWeight:700}}>
                  {fiscalTestMsg.test.mode ? `${String(fiscalTestMsg.test.mode).toUpperCase()} · ` : ""}
                  {fiscalTestMsg.test.provider || "sin proveedor"}
                  {fiscalTestMsg.test.transport?.http_status ? ` · HTTP ${fiscalTestMsg.test.transport.http_status}` : ""}
                </div>
              </div>
              <div style={{fontSize:11,color:"#e2e8f0",lineHeight:1.6,marginTop:6}}>
                {fiscalTestMsg.test.message || "Sin mensaje adicional."}
              </div>
              {!!fiscalTestMsg.test.tested_at && (
                <div style={{fontSize:11,color:"#94a3b8",marginTop:6}}>
                  Ultima prueba registrada: <strong>{new Date(fiscalTestMsg.test.tested_at).toLocaleString("es-ES")}</strong>
                </div>
              )}
              {!!fiscalTestMsg.test.transport?.base_url && (
                <div style={{fontSize:11,color:"#94a3b8",marginTop:6,wordBreak:"break-all"}}>
                  Endpoint: <code>{fiscalTestMsg.test.transport.base_url}</code>
                </div>
              )}
              {!!fiscalTestMsg.test.transport?.checks && (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                  {Object.entries(fiscalTestMsg.test.transport.checks).map(([key, ok]) => (
                    <span
                      key={key}
                      style={{
                        fontSize:10,
                        fontWeight:900,
                        borderRadius:999,
                        padding:"4px 8px",
                        background:ok ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.12)",
                        border:`1px solid ${ok ? "rgba(16,185,129,.24)" : "rgba(239,68,68,.24)"}`,
                        color:ok ? "#34d399" : "#fca5a5",
                      }}
                    >
                      {key.replace(/_/g, " ")}: {ok ? "ok" : "revisar"}
                    </span>
                  ))}
                </div>
              )}
              {!!fiscalTestMsg.test.transport?.issues?.length && (
                <div style={{fontSize:11,color:"#fca5a5",lineHeight:1.55,marginTop:8}}>
                  {fiscalTestMsg.test.transport.issues.join(" | ")}
                </div>
              )}
              {fiscalTestMsg.test.pending_connector && (
                <div style={{fontSize:11,color:"#fbbf24",marginTop:6}}>
                  El conector real de este canal sigue pendiente de activacion.
                </div>
              )}
            </div>
          )}
          {!!fiscalCfgEmpresa?.historial_pruebas?.length && (
            <div style={{marginTop:12,padding:"10px 12px",borderRadius:8,border:"1px solid #22304a",background:"#0f1726"}}>
              <div style={{fontSize:11,fontWeight:900,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>
                Historial reciente de pruebas
              </div>
              <div style={{display:"grid",gap:8}}>
                {fiscalCfgEmpresa.historial_pruebas.slice(0, 5).map((test, idx) => {
                  const freshness = getFiscalTestFreshness(test);
                  return (
                    <div key={`${test?.tested_at || "sin-fecha"}-${idx}`} style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",padding:"8px 10px",borderRadius:7,border:"1px solid #1f2b43",background:"#121b2d"}}>
                      <div style={{minWidth:240,flex:"1 1 340px"}}>
                        <div style={{fontSize:11,fontWeight:900,color:test?.ok ? "#34d399" : "#fbbf24"}}>
                          {(test?.mode ? String(test.mode).toUpperCase() : "FISCAL")} - {test?.provider || "sin proveedor"}
                        </div>
                        <div style={{fontSize:11,color:"#cbd5e1",lineHeight:1.5,marginTop:4}}>
                          {test?.message || "Sin mensaje adicional."}
                        </div>
                      </div>
                      <div style={{textAlign:"right",minWidth:170}}>
                        <div style={{fontSize:11,color:"#94a3b8"}}>
                          {test?.tested_at ? new Date(test.tested_at).toLocaleString("es-ES") : "Sin fecha"}
                        </div>
                        <div style={{fontSize:10,fontWeight:900,color:freshness.color,marginTop:4}}>
                          {freshness.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(Number(fiscalQueueSummary?.resumen?.total_registros || 0) > 0 || (fiscalQueueSummary?.cola || []).length > 0) && (
            <div style={{marginTop:12,padding:"10px 12px",borderRadius:8,border:"1px solid #22304a",background:"#0f1726"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:900,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em"}}>
                  Cola fiscal reciente
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {[
                    ["Aceptados", fiscalQueueSummary?.resumen?.aceptados, "#34d399"],
                    ["Pendientes", fiscalQueueSummary?.resumen?.pendientes, "#fbbf24"],
                    ["Errores", fiscalQueueSummary?.resumen?.con_error, "#f87171"],
                    ["Atascados", fiscalQueueSummary?.resumen?.atascados, "#fb7185"],
                  ].map(([label, value, color]) => (
                    <span key={label} style={{fontSize:10,fontWeight:900,color,background:`${color}14`,border:`1px solid ${color}33`,borderRadius:999,padding:"4px 8px"}}>
                      {label}: {Number(value || 0)}
                    </span>
                  ))}
                </div>
              </div>
              {!!fiscalQueueSummary?.recientes?.length && (
                <div style={{display:"grid",gap:8,marginBottom:fiscalQueueSummary?.cola?.length ? 10 : 0}}>
                  {fiscalQueueSummary.recientes.slice(0, 3).map((item) => {
                    const accepted = item.estado_envio === "aceptado";
                    const errored = item.estado_envio === "error" || item.ultimo_error;
                    const tone = accepted ? "#34d399" : errored ? "#f87171" : "#fbbf24";
                    const border = accepted ? "rgba(16,185,129,.24)" : errored ? "rgba(248,113,113,.22)" : "rgba(245,158,11,.22)";
                    const bg = accepted ? "rgba(16,185,129,.06)" : errored ? "rgba(239,68,68,.06)" : "rgba(245,158,11,.06)";
                    return (
                      <div key={`reciente-${item.id}`} style={{padding:"8px 10px",borderRadius:7,border:`1px solid ${border}`,background:bg}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                          <div style={{fontSize:11,fontWeight:900,color:"#e2e8f0"}}>
                            {item.numero || "Factura"} - {String(item.modo || "").toUpperCase()}
                          </div>
                          <div style={{fontSize:10,fontWeight:900,color:tone}}>
                            {accepted ? "aceptada" : errored ? "ultimo error" : "pendiente"}
                          </div>
                        </div>
                        <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>
                          {item.cliente_nombre || "Sin cliente"}
                          {item.updated_at ? ` - ${new Date(item.updated_at).toLocaleString("es-ES")}` : ""}
                        </div>
                        {!!item.accepted_ref && (
                          <div style={{fontSize:10,color:"#34d399",lineHeight:1.45,marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>
                            Ref. {String(item.accepted_ref).slice(0, 28)}{String(item.accepted_ref).length > 28 ? "..." : ""}
                          </div>
                        )}
                        {!item.accepted_ref && !!item.provider_uuid && (
                          <div style={{fontSize:10,color:"#93c5fd",lineHeight:1.45,marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>
                            UUID {String(item.provider_uuid).slice(0, 22)}{String(item.provider_uuid).length > 22 ? "..." : ""}
                          </div>
                        )}
                        {item.next_retry_at && !accepted && (
                          <div style={{fontSize:10,color:"#fbbf24",lineHeight:1.45,marginTop:4,fontWeight:800}}>
                            Reintento: {new Date(item.next_retry_at).toLocaleString("es-ES")}
                          </div>
                        )}
                        {!!item.ultimo_error && (
                          <div style={{fontSize:10,color:"#fca5a5",lineHeight:1.45,marginTop:4}}>
                            {String(item.ultimo_error).slice(0, 120)}{String(item.ultimo_error).length > 120 ? "..." : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {!!fiscalQueueSummary?.cola?.length && (
                <div style={{display:"grid",gap:8}}>
                  {fiscalQueueSummary.cola.slice(0, 3).map((item) => (
                    <div key={item.id} style={{padding:"8px 10px",borderRadius:7,border:item.atascado ? "1px solid rgba(251,113,133,.32)" : "1px solid #1f2b43",background:item.atascado ? "rgba(251,113,133,.07)" : "#121b2d"}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                        <div style={{fontSize:11,fontWeight:900,color:"#e2e8f0"}}>
                          {item.numero || "Factura pendiente"} - {String(item.sistema || "").toUpperCase()}
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                          {item.atascado && (
                            <span style={{fontSize:10,fontWeight:900,color:"#fb7185"}}>
                              atascado
                            </span>
                          )}
                          <span style={{fontSize:10,fontWeight:900,color:item.estado === "error" ? "#f87171" : item.estado === "procesando" ? "#22d3ee" : "#fbbf24"}}>
                            {item.estado}
                          </span>
                        </div>
                      </div>
                      <div style={{fontSize:11,color:"#94a3b8",marginTop:4}}>
                        {item.cliente_nombre || "Sin cliente"} - intento {Number(item.intento || 0)}
                      </div>
                      {item.provider_uuid && (
                        <div style={{fontSize:10,color:"#93c5fd",marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>
                          UUID {String(item.provider_uuid).slice(0, 22)}{String(item.provider_uuid).length > 22 ? "..." : ""}
                        </div>
                      )}
                      {item.next_retry_at && (
                        <div style={{fontSize:10,color:"#fbbf24",marginTop:4,fontWeight:800}}>
                          Siguiente reintento: {new Date(item.next_retry_at).toLocaleString("es-ES")}
                        </div>
                      )}
                      {item.error && (
                        <div style={{fontSize:10,color:"#fca5a5",lineHeight:1.45,marginTop:4}}>
                          {item.error}
                        </div>
                      )}
                      <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                        <button onClick={()=>reencolarFiscalSoporte(item)} style={{...SaaS.btn,padding:"5px 8px",fontSize:11,color:"#fbbf24",borderColor:"rgba(245,158,11,.28)"}}>
                          Reencolar
                        </button>
                        {String(item.sistema || "").toLowerCase() === "verifactu" && item.provider_uuid && (
                          <button onClick={()=>sincronizarFiscalSoporte(item)} style={{...SaaS.btn,padding:"5px 8px",fontSize:11,color:"#93c5fd",borderColor:"rgba(147,197,253,.28)"}}>
                            Sincronizar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{display:"block",marginBottom:14,background:"#121b2d",border:"1px solid #22304a",borderRadius:8,padding:12}}>
          <div style={{fontSize:13,fontWeight:900,color:"#e2e8f0",marginBottom:4}}>Vista soporte multiempresa</div>
          <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.45,marginBottom:10}}>
            Resumen rápido para detectar qué empresa está lista, cuál está en pruebas y cuál necesita intervención fiscal antes de lanzar VERIFACTU o SII.
          </div>
          <div style={{display:"grid",gap:8}}>
            {fiscalRows.map(({ empresa, fiscal, label }) => {
              const level = fiscal?.status?.level;
              const tone = level === "ok"
                ? { color:"#34d399", bg:"rgba(16,185,129,.08)", border:"rgba(16,185,129,.18)" }
                : level === "warning"
                  ? { color:"#fbbf24", bg:"rgba(245,158,11,.08)", border:"rgba(245,158,11,.18)" }
                  : { color:"#f87171", bg:"rgba(239,68,68,.08)", border:"rgba(239,68,68,.18)" };
              const isSelected = String(empresaId) === String(empresa.id);
              return (
                <div key={empresa.id} style={{display:"grid",gridTemplateColumns:"minmax(180px,1.1fr) minmax(120px,.7fr) minmax(110px,.55fr) 1fr auto",gap:10,alignItems:"center",padding:"10px 12px",background:isSelected?"rgba(59,130,246,.08)":"#0f1728",border:`1px solid ${isSelected?"rgba(59,130,246,.24)":"#1c2740"}`,borderRadius:8}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"#e2e8f0"}}>{empresa.nombre}</div>
                    <div style={{fontSize:10,color:"#64748b",marginTop:4}}>{empresa.plan} · {empresa.estado}</div>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>{label}</div>
                  <div style={{fontSize:11,color:"#94a3b8",fontWeight:700}}>
                    {fiscal?.entorno === "produccion" ? "Produccion" : "Pruebas"}
                  </div>
                  <div style={{fontSize:11,color:tone.color,lineHeight:1.45,fontWeight:700}}>
                    {fiscal?.status?.summary || "Sin configurar"}
                  </div>
                  <button onClick={()=>setEmpresaId(empresa.id)} style={{...SaaS.btn,background:tone.bg,borderColor:tone.border,color:tone.color}}>
                    {isSelected ? "Vista activa" : "Ver empresa"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,alignItems:"end",marginBottom:12}}>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Proveedor de rutas / IA</label>
            <select style={input} value={provider} onChange={e=>setProvider(e.target.value)}>
              {companyProviderOptions.map(p => <option key={p} value={p}>{labels[p] || p}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Modo</label>
            <select style={input} value={form.use_global ? "global" : "propia"} onChange={e=>setForm(p=>({...p,use_global:e.target.value==="global"}))}>
              <option value="global">Usar global</option>
              <option value="propia">Clave propia</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Clave propia</label>
            <input type="password" style={input} value={form.api_key} onChange={e=>setForm(p=>({...p,api_key:e.target.value}))} placeholder={cfgEmpresa?.key_mask ? `Actual: ${cfgEmpresa.key_mask}` : "Pegar clave si es propia"} />
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Limite proveedor/mes</label>
            <input type="number" min="0" style={input} value={form.limite_mensual} onChange={e=>setForm(p=>({...p,limite_mensual:e.target.value}))} />
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={guardarEmpresa} style={{...SaaS.btnOk,height:36}}>Guardar</button>
            <button onClick={()=>probarEmpresa(provider)} disabled={testingProvider===provider} style={{...SaaS.btn,height:36}}>
              {testingProvider===provider ? "Probando..." : "Probar"}
            </button>
            {cfgEmpresa?.key_mask && <button onClick={()=>limpiarClaveEmpresa(provider)} style={{...SaaS.btn,color:"#f87171",height:36}}>Limpiar</button>}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",margin:"-2px 0 12px",padding:"8px 10px",borderRadius:8,border:"1px solid #22304a",background:"#0f1726"}}>
          <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.45,flex:"1 1 260px"}}>
            Clave global de <strong style={{color:"#e2e8f0"}}>{labels[provider] || provider}</strong>:
            <span style={{color:providerGlobalOk ? "#34d399" : "#94a3b8",fontWeight:900}}> {providerGlobalOk ? `configurada (${providerGlobalStatus.global_source || "global"})` : "sin configurar"}</span>.
          </div>
          <button onClick={()=>guardarGlobal(provider)} style={{...SaaS.btnOk,padding:"7px 10px"}}>Guardar global</button>
          {providerGlobalOk && <button onClick={()=>eliminarGlobal(provider)} style={{...SaaS.btn,color:"#f87171",padding:"7px 10px"}}>Eliminar global</button>}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,alignItems:"end"}}>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Proveedor GPS de esta empresa</label>
            <select style={input} value={gpsProvider} onChange={e=>setGpsProvider(e.target.value)}>
              {visibleGpsProviders.map(p => <option key={p} value={p}>{labels[p] || p}</option>)}
            </select>
            <button
              onClick={()=>setShowGpsProviderPicker(p=>!p)}
              style={{...SaaS.btn,padding:"5px 8px",fontSize:10,marginTop:6,color:"#93c5fd",borderColor:"rgba(147,197,253,.24)"}}
            >
              {showGpsProviderPicker ? "Ocultar proveedores" : "Cambiar proveedor"}
            </button>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Modo GPS</label>
            <select style={input} value={gpsForm.use_global ? "global" : "propia"} onChange={e=>setGpsForm(p=>({...p,use_global:e.target.value==="global"}))}>
              <option value="global">Usar global</option>
              <option value="propia">Clave propia</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Clave GPS</label>
            <input type="password" style={input} value={gpsForm.api_key} onChange={e=>setGpsForm(p=>({...p,api_key:e.target.value}))} placeholder={cfgGps?.key_mask ? `Actual: ${cfgGps.key_mask}` : "Pegar clave GPS"} />
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Limite GPS/mes</label>
            <input type="number" min="0" style={input} value={gpsForm.limite_mensual} onChange={e=>setGpsForm(p=>({...p,limite_mensual:e.target.value}))} />
          </div>
          <button onClick={guardarGpsEmpresa} style={{...SaaS.btnOk,height:36}}>Guardar GPS activo</button>
          <button onClick={()=>probarEmpresa(gpsProvider)} disabled={testingProvider===gpsProvider} style={{...SaaS.btn,height:36}}>
            {testingProvider===gpsProvider ? "Diagnosticando..." : "Diagnosticar GPS"}
          </button>
          <button onClick={desactivarGpsEmpresa} style={{...SaaS.btn,color:"#f87171",height:36}}>Desactivar</button>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:8,padding:"8px 10px",borderRadius:8,border:"1px solid #22304a",background:"#0f1726"}}>
          <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.45,flex:"1 1 260px"}}>
            Clave global de <strong style={{color:"#e2e8f0"}}>{labels[gpsProvider] || gpsProvider}</strong>:
            <span style={{color:gpsGlobalOk ? "#34d399" : "#94a3b8",fontWeight:900}}> {gpsGlobalOk ? `configurada (${gpsGlobalStatus.global_source || "global"})` : "sin configurar"}</span>.
            {gpsActivoEmpresa && gpsActivoEmpresa !== gpsProvider && <span style={{color:"#fbbf24",fontWeight:800}}> El GPS activo ahora es {labels[gpsActivoEmpresa] || gpsActivoEmpresa}.</span>}
          </div>
          <button onClick={()=>guardarGlobal(gpsProvider)} style={{...SaaS.btnOk,padding:"7px 10px"}}>Guardar global GPS</button>
          {gpsGlobalOk && <button onClick={()=>eliminarGlobal(gpsProvider)} style={{...SaaS.btn,color:"#f87171",padding:"7px 10px"}}>Eliminar global GPS</button>}
        </div>
        {cfgGps?.key_mask && (
          <button onClick={()=>limpiarClaveEmpresa(gpsProvider, true)} style={{...SaaS.btn,color:"#f87171",marginTop:8}}>
            Limpiar clave propia GPS
          </button>
        )}
        <div style={{display:"block",marginTop:12,background:"#121b2d",border:"1px solid #22304a",borderRadius:8,padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:13,fontWeight:900,color:"#e2e8f0"}}>Webhook de posiciones GPS</div>
              <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.45,marginTop:4}}>
                Para proveedores que puedan enviar posiciones automaticamente. El token se envia en la cabecera x-transgest-gps-token.
              </div>
              <div style={{fontSize:11,color:cfgWebhookGps?.activo ? "#34d399" : "#64748b",fontWeight:800,marginTop:7}}>
                {cfgWebhookGps?.activo ? `Activo: ${cfgWebhookGps.token_mask}` : "Sin webhook activo"}
                {cfgWebhookGps?.last_used_at ? ` - ultimo uso ${new Date(cfgWebhookGps.last_used_at).toLocaleString("es-ES")}` : ""}
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={generarWebhookGps} style={SaaS.btnOk}>{cfgWebhookGps?.activo ? "Rotar token" : "Generar token"}</button>
              {cfgWebhookGps?.activo && <button onClick={desactivarWebhookGps} style={{...SaaS.btn,color:"#f87171"}}>Desactivar</button>}
            </div>
          </div>
          {webhookTokenMsg?.token && webhookTokenMsg?.status?.provider === gpsProvider && (
            <div style={{marginTop:10,background:"rgba(20,184,166,.10)",border:"1px solid rgba(20,184,166,.30)",borderRadius:8,padding:10}}>
              <div style={{fontSize:11,color:"#34d399",fontWeight:900,marginBottom:5}}>Token generado. Copialo ahora, no se volvera a mostrar completo.</div>
              <div style={{fontSize:11,color:"#94a3b8",marginBottom:4}}>URL: <code>{webhookTokenMsg.webhook_url}</code></div>
              <div style={{fontSize:11,color:"#e2e8f0",wordBreak:"break-all"}}>Token: <code>{webhookTokenMsg.token}</code></div>
            </div>
          )}
        </div>
        {testMsg && (
          <div style={{
            marginTop:10,
            padding:"9px 11px",
            borderRadius:8,
            border:`1px solid ${testMsg.ok ? "rgba(16,185,129,.28)" : "rgba(245,158,11,.30)"}`,
            background:testMsg.ok ? "rgba(16,185,129,.08)" : "rgba(245,158,11,.09)",
            color:testMsg.ok ? "#34d399" : "#fbbf24",
            fontSize:12,
            lineHeight:1.45,
          }}>
            {labels[testMsg.provider] || testMsg.provider}: {testMsg.message}
            {testMsg.source && <span> Fuente: {testMsg.source}.</span>}
            {testMsg.provider_test?.remote_vehicles !== undefined && testMsg.provider_test?.remote_vehicles !== null && (
              <div style={{marginTop:4,color:"#e2e8f0"}}>
                Vehiculos recibidos del proveedor: <strong>{testMsg.provider_test.remote_vehicles}</strong>
                {Array.isArray(testMsg.provider_test.sample_plates) && testMsg.provider_test.sample_plates.length > 0
                  ? ` - ${testMsg.provider_test.sample_plates.join(", ")}`
                  : ""}
              </div>
            )}
            {testMsg.provider_test?.remote_positions !== undefined && testMsg.provider_test?.remote_positions !== null && (
              <div style={{marginTop:4,color:"#e2e8f0"}}>
                Posiciones recibidas: <strong>{testMsg.provider_test.remote_positions}</strong>
              </div>
            )}
            {testMsg.provider_test?.linked_vehicles !== undefined && (
              <div style={{marginTop:4,color:"#cbd5e1"}}>
                Vehiculos enlazados en TransGest: <strong>{testMsg.provider_test.linked_vehicles}</strong>
                {testMsg.provider_test.active_vehicles !== undefined ? ` / ${testMsg.provider_test.active_vehicles} activos` : ""}
                {testMsg.provider_test.recent_signal_vehicles !== undefined ? ` - senal reciente: ${testMsg.provider_test.recent_signal_vehicles}` : ""}
              </div>
            )}
            {testMsg.provider_test?.positions_message && (
              <div style={{marginTop:4,color:testMsg.provider_test.positions_ok ? "#34d399" : "#fbbf24"}}>
                {testMsg.provider_test.positions_message}
              </div>
            )}
            {testMsg.provider_test?.auth_error && (
              <div style={{marginTop:4,color:"#fca5a5",fontWeight:800}}>
                La clave existe, pero Movildata esta denegando el acceso a la API de vehiculos/posiciones. Revisa permisos del usuario API o solicita a Movildata activar esos endpoints.
              </div>
            )}
          </div>
        )}
        <div style={{display:"block",fontSize:11,color:"#64748b",marginTop:10}}>
          {selectedEmpresa ? `${selectedEmpresa.nombre}: ` : ""}
          al guardar un GPS queda como unico proveedor activo para esa empresa.
        </div>
        <div style={{display:"block",fontSize:11,color:"#64748b",marginTop:6}}>
          La configuracion fiscal sensible se mantiene en la propia empresa para respetar APIs, certificados y credenciales separadas por cliente.
        </div>
      </div>

      <div style={{display:integrationTab==="version" ? "block" : "none", background:"#0f1728",border:"1px solid #1c2740",borderRadius:8,padding:14,marginBottom:18}}>
        <div style={{fontWeight:800,color:"#e2e8f0",fontSize:14,marginBottom:6}}>Version global del programa</div>
        <div style={{fontSize:11,color:"#64748b",lineHeight:1.45,marginBottom:10}}>
          Esta version se usa como referencia general del producto y tambien alimenta la version del software emisor en VERIFACTU para todas las empresas.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 140px 140px auto",gap:10,alignItems:"end",marginBottom:12}}>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Nombre producto</label>
            <input style={input} value={appMetaForm.brand_name} onChange={e=>setAppMetaForm(p=>({...p,brand_name:e.target.value}))} placeholder="TransGest" />
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Etiqueta version</label>
            <input style={input} value={appMetaForm.version_name} onChange={e=>setAppMetaForm(p=>({...p,version_name:e.target.value}))} placeholder="TMS" />
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Version</label>
            <input style={input} value={appMetaForm.version} onChange={e=>setAppMetaForm(p=>({...p,version:e.target.value}))} placeholder="1.0.0" />
          </div>
          <button onClick={guardarAppMeta} style={{...SaaS.btnOk,height:36}}>Guardar version</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Nombre software fiscal</label>
            <input style={input} value={appMetaForm.fiscal_software_name} onChange={e=>setAppMetaForm(p=>({...p,fiscal_software_name:e.target.value}))} placeholder="TransGest" />
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>ID software fiscal</label>
            <input style={input} value={appMetaForm.fiscal_software_id} onChange={e=>setAppMetaForm(p=>({...p,fiscal_software_id:e.target.value}))} placeholder="transgest-tms" />
          </div>
        </div>
      </div>

      <div style={{display:"none", background:"#0f1728",border:"1px solid #1c2740",borderRadius:8,padding:14}}>
        <div style={{fontWeight:800,color:"#e2e8f0",fontSize:14,marginBottom:10}}>Ajustes avanzados por empresa</div>
        <div style={{display:"grid",gridTemplateColumns:"1.2fr .8fr .7fr .7fr",gap:10,alignItems:"end"}}>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Empresa</label>
            <select style={input} value={empresaId} onChange={e=>setEmpresaId(e.target.value)}>
              {(data?.empresas || []).map(e => <option key={e.id} value={e.id}>{e.nombre} - {e.plan}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Proveedor</label>
            <select style={input} value={provider} onChange={e=>setProvider(e.target.value)}>
              {companyProviderOptions.map(p => <option key={p} value={p}>{labels[p] || p}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Modo</label>
            <select style={input} value={form.use_global ? "global" : "propia"} onChange={e=>setForm(p=>({...p,use_global:e.target.value==="global"}))}>
              <option value="global">Usar global</option>
              <option value="propia">Clave propia</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Activo</label>
            <select style={input} value={form.activo ? "si" : "no"} onChange={e=>setForm(p=>({...p,activo:e.target.value==="si"}))}>
              <option value="si">Activo</option>
              <option value="no">Bloqueado</option>
            </select>
          </div>
          <div style={{gridColumn:"1 / span 2"}}>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Clave propia nueva</label>
            <input type="password" style={input} value={form.api_key} onChange={e=>setForm(p=>({...p,api_key:e.target.value}))} placeholder={cfgEmpresa?.key_mask ? `Actual: ${cfgEmpresa.key_mask}` : "Solo si usa clave propia"} />
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>Limite mensual</label>
            <input type="number" style={input} value={form.limite_mensual} onChange={e=>setForm(p=>({...p,limite_mensual:e.target.value}))} />
          </div>
          <button onClick={guardarEmpresa} style={{...SaaS.btnOk,height:36}}>Guardar empresa</button>
        </div>
        <div style={{fontSize:11,color:"#64748b",marginTop:10}}>
          {selectedEmpresa ? `${selectedEmpresa.nombre}: ` : ""}
          {cfgEmpresa ? `modo ${cfgEmpresa.use_global ? "global" : "clave propia"} - ${cfgEmpresa.activo ? "activo" : "bloqueado"} - usos ${cfgEmpresa.usos_mes || 0}/${cfgEmpresa.limite_mensual || 0}` : "sin configuracion propia, usa la global si existe."}
        </div>
      </div>
    </div>
  );
}

function SaludSaaS({ saFetchFn, onGestionar, onEntrar }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const cargar = useCallback(() => {
    setLoading(true);
    Promise.all([
      saFetchFn("/salud"),
      saFetchFn("/salud/resumen").catch(() => null),
    ]).then(([salud, resumen]) => {
      setItems(Array.isArray(salud) ? salud : []);
      setSummary(resumen || null);
    }).finally(()=>setLoading(false));
  }, [saFetchFn]);
  useEffect(()=>{ cargar(); }, [cargar]);
  const color = { verde:"#22c55e", amarillo:"#f59e0b", rojo:"#ef4444" };
  const resumen = summary?.resumen || {};
  const criticalCount = Number(resumen?.por_color?.rojo || 0);
  const warningCount = Number(resumen?.por_color?.amarillo || 0);
  async function gracia(e) {
    const dias = await promptDialog({
      title: "Dias de gracia",
      message: `Conceder dias de gracia a ${e.nombre}.`,
      inputType: "number",
      defaultValue: "7",
      placeholder: "Dias",
      confirmText: "Conceder",
    });
    if (!dias) return;
    await saFetchFn(`/empresas/${e.id}/ampliar-gracia`, { method:"POST", body:{ dias:Number(dias) } });
    cargar();
  }
  async function descargarInforme() {
    try {
      const res = await fetch(`${BASE}/api/v1/superadmin/salud/informe`, {
        headers: { "Authorization": "Bearer " + saToken() },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo descargar el informe.");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="?([^"]+)"?/i)?.[1] || `salud-saas-${new Date().toISOString().slice(0,10)}.html`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      notify(e.message || "No se pudo descargar el informe.", "error");
    }
  }
  return (
    <div style={SaaS.card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{...SaaS.title,marginBottom:0}}>Salud de empresas</div>
        <button onClick={descargarInforme} style={{...SaaS.btn,background:"rgba(59,130,246,.14)",color:"#93c5fd",border:"1px solid rgba(59,130,246,.25)"}}>Informe HTML</button>
      </div>
      {loading ? <div style={SaaS.empty}>Cargando...</div> : (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,marginBottom:14}}>
            {[
              ["Total", resumen.total ?? items.length, "#93c5fd", "Empresas registradas"],
              ["Críticas", criticalCount, "#f87171", "Bloqueadas, vencidas o no activas"],
              ["Avisos", warningCount, "#fbbf24", "Pago próximo o backup pendiente"],
              ["Backups", resumen.backups_pendientes || 0, "#a78bfa", "Solicitudes pendientes"],
              ["Sin gerente", resumen.sin_gerente || 0, "#f87171", "Empresas sin gerente activo"],
              ["Sin actividad", resumen.sin_actividad_30d || 0, "#fbbf24", "Activas sin pedidos 30d"],
              ["Usuarios", resumen.usuarios_activos || 0, "#34d399", "Usuarios activos"],
              ["Clientes", resumen.clientes_activos || 0, "#2dd4bf", "Clientes activos"],
              ["Pedidos 30d", resumen.pedidos_30d || 0, "#38bdf8", "Actividad reciente"],
            ].map(([label,value,tone,help])=>(
              <div key={label} style={{background:"#0f172a",border:"1px solid #1c2740",borderRadius:10,padding:"11px 12px"}}>
                <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
                <div style={{fontSize:21,fontWeight:900,color:tone,marginTop:3}}>{fmtN(value)}</div>
                <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{help}</div>
              </div>
            ))}
          </div>
          {(summary?.criticas?.length || summary?.avisos?.length) ? (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:10,marginBottom:14}}>
              {summary.criticas?.length ? (
                <div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",borderRadius:10,padding:12}}>
                  <div style={{fontSize:11,color:"#fca5a5",fontWeight:900,textTransform:"uppercase",marginBottom:6}}>Atención inmediata</div>
                  {summary.criticas.slice(0,3).map(e=><div key={e.id} style={{fontSize:12,color:"#e2e8f0",marginBottom:4}}>{e.nombre} · {(e.motivos||[]).join(", ") || "Revisar"}</div>)}
                </div>
              ) : null}
              {summary.avisos?.length ? (
                <div style={{background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.22)",borderRadius:10,padding:12}}>
                  <div style={{fontSize:11,color:"#fbbf24",fontWeight:900,textTransform:"uppercase",marginBottom:6}}>Seguimiento</div>
                  {summary.avisos.slice(0,3).map(e=><div key={e.id} style={{fontSize:12,color:"#e2e8f0",marginBottom:4}}>{e.nombre} · {(e.motivos||[]).join(", ") || "Revisar"}</div>)}
                </div>
              ) : null}
            </div>
          ) : null}
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:1040}}>
              <thead><tr>{["Estado","Empresa","Plan","Pago","Uso","Implantacion","Alertas","Acciones"].map(h=><th key={h} style={SaaS.th}>{h}</th>)}</tr></thead>
              <tbody>{items.map(e=>(
                <tr key={e.id}>
                  <td style={SaaS.td}><span style={{padding:"3px 9px",borderRadius:20,fontWeight:800,fontSize:11,background:`${color[e.color]}22`,color:color[e.color]}}>{e.color}</span></td>
                  <td style={{...SaaS.td,color:"#e2e8f0",fontWeight:700}}>{e.nombre}</td>
                  <td style={SaaS.td}>{e.plan} - {e.ciclo_facturacion||"mensual"}</td>
                  <td style={SaaS.td}>{e.fecha_vencimiento ? fmtDate(e.fecha_vencimiento) : "Sin vencimiento"}{e.dias_vencimiento!==null ? ` (${e.dias_vencimiento}d)` : ""}</td>
                  <td style={SaaS.td}>
                    {e.pedidos_30d} pedidos - {e.usuarios_activos} usuarios
                    <div style={{fontSize:11,color:"#64748b",marginTop:2}}>
                      {e.gerentes_activos || 0} gerente(s) - {e.clientes_activos || 0} cliente(s) - IA {e.ia_usos_mes||0}/{e.ia_limite_mensual||0}
                    </div>
                  </td>
                  <td style={SaaS.td}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:(e.implantacion_estado==="critica"?"#f87171":e.implantacion_estado==="vigilancia"?"#fbbf24":"#34d399")}}>
                      {e.implantacion_score ?? 0}%
                    </div>
                    <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase"}}>{e.implantacion_estado || "-"}</div>
                  </td>
                  <td style={SaaS.td}>{(e.motivos||[]).length ? e.motivos.join(", ") : "OK"}</td>
                  <td style={SaaS.td}>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <button onClick={()=>onEntrar(e)} style={SaaS.btnOk}>Entrar</button>
                      <button onClick={()=>onGestionar(e)} style={SaaS.btn}>Gestionar</button>
                      <button onClick={()=>gracia(e)} style={SaaS.btnWarn}>Gracia</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditoriaSaaS({ saFetchFn }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const cargar = useCallback(() => {
    setLoading(true);
    saFetchFn("/auditoria?limit=200").then(d => setItems(Array.isArray(d) ? d : [])).finally(()=>setLoading(false));
  }, [saFetchFn]);
  useEffect(()=>{ cargar(); }, [cargar]);
  return (
    <div style={SaaS.card}>
      <div style={SaaS.title}>Auditoria SaaS</div>
      {loading ? <div style={SaaS.empty}>Cargando...</div> : (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:850}}>
            <thead><tr>{["Fecha","Actor","Empresa","Accion","Detalle"].map(h=><th key={h} style={SaaS.th}>{h}</th>)}</tr></thead>
            <tbody>{items.map(a=>(
              <tr key={a.id}>
                <td style={SaaS.td}>{a.created_at ? new Date(a.created_at).toLocaleString("es-ES") : "-"}</td>
                <td style={SaaS.td}>{a.actor_email||a.actor_tipo}</td>
                <td style={SaaS.td}>{a.empresa_nombre||"-"}</td>
                <td style={{...SaaS.td,color:"#93c5fd",fontWeight:700}}>{a.accion}</td>
                <td style={{...SaaS.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{JSON.stringify(a.detalle||{})}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BackupsAdmin({ saFetchFn }) {
  const [solicitudes, setSolicitudes] = useState([]);
  const [backups, setBackups] = useState([]);
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState("");
  const cargar = useCallback(() => {
    Promise.all([saFetchFn("/backups/solicitudes"), saFetchFn("/backups")])
      .then(([s,b]) => { setSolicitudes(Array.isArray(s) ? s : []); setBackups(b.backups||[]); setStatus(b.status || null); })
      .catch(e => setMsg(e.message));
  }, [saFetchFn]);
  useEffect(()=>{ cargar(); }, [cargar]);
  async function generar(s) {
    const ok = await confirmDialog({
      title: "Generar backup",
      message: `Generar backup solicitado por ${s.empresa_nombre}?`,
      confirmText: "Generar",
    });
    if (!ok) return;
    setMsg("Generando backup...");
    try {
      const r = await saFetchFn(`/backups/solicitudes/${s.id}/generar`, { method:"POST" });
      setMsg("Backup generado: " + r.filename);
      cargar();
    } catch (e) { setMsg(e.message); }
  }
  async function descargar(b) {
    const res = await fetch(`${BASE}/api/v1/superadmin/backups/download/${encodeURIComponent(b.filename)}`, {
      headers: { Authorization:"Bearer "+saToken() },
    });
    if (!res.ok) { setMsg("No se pudo descargar el backup"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = b.filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  const backupTone = !status?.configured
    ? { bg:"rgba(245,158,11,.12)", border:"rgba(245,158,11,.30)", color:"#fbbf24", title:"Backups pendientes de configurar" }
    : status?.degraded || status?.mode === "json_fallback"
      ? { bg:"rgba(245,158,11,.10)", border:"rgba(245,158,11,.28)", color:"#fbbf24", title:"Backups en modo contingencia" }
      : { bg:"rgba(16,185,129,.10)", border:"rgba(16,185,129,.25)", color:"#34d399", title:"Backups configurados" };
  return (
    <div>
      <div style={SaaS.card}>
        <div style={SaaS.title}>Solicitudes de backup</div>
        {status && (
          <div style={{
            background: backupTone.bg,
            border: `1px solid ${backupTone.border}`,
            color: backupTone.color,
            borderRadius:8,
            padding:"10px 12px",
            fontSize:12,
            marginBottom:12,
            lineHeight:1.5,
          }}>
            <strong>{backupTone.title}</strong>
            <div style={{color:"#94a3b8",marginTop:3}}>
              {status.message}
              {status.pg_dump_bin ? ` Ruta: ${status.pg_dump_bin}` : status.mode === "json_fallback" ? " Recomendado: instalar pg_dump para copias PostgreSQL restaurables." : " Configura PG_DUMP_BIN o instala PostgreSQL client."}
            </div>
          </div>
        )}
        {msg && <div style={{fontSize:12,color:"#94a3b8",marginBottom:10}}>{msg}</div>}
        {solicitudes.length===0 ? <div style={SaaS.empty}>Sin solicitudes.</div> : solicitudes.map(s=>(
          <div key={s.id} style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 1fr auto",gap:10,alignItems:"center",padding:"9px 0",borderBottom:"1px solid #1c2740",fontSize:12,color:"#cbd5e1"}}>
            <strong style={{color:"#e2e8f0"}}>{s.empresa_nombre}</strong>
            <span>{s.estado}</span>
            <span>{s.created_at ? new Date(s.created_at).toLocaleDateString("es-ES") : "-"}</span>
            {s.estado==="pendiente" ?
              <button onClick={()=>generar(s)} style={SaaS.btnOk}>Generar</button>
              : <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{s.filename}</span>}
          </div>
        ))}
      </div>
      <div style={SaaS.card}>
        <div style={SaaS.title}>Backups generados</div>
        {backups.length===0 ? <div style={SaaS.empty}>Sin backups.</div> : backups.map(b=>(
          <div key={b.filename} style={{display:"grid",gridTemplateColumns:"1fr .4fr .6fr auto",gap:10,alignItems:"center",padding:"8px 0",borderBottom:"1px solid #1c2740",fontSize:12,color:"#cbd5e1"}}>
            <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{b.filename}</span>
            <span>{b.size_kb} KB {b.type === "json_fallback" ? "JSON" : "PG"}</span>
            <span>{b.created ? new Date(b.created).toLocaleString("es-ES") : "-"}</span>
            <button onClick={()=>descargar(b)} style={SaaS.btn}>Descargar</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarioLaboralAdmin({ saFetchFn, empresas }){
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [ccaa, setCcaa] = useState("ES-MD");
  const [empresaId, setEmpresaId] = useState("");
  const [ccaaOptions, setCcaaOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    saFetchFn("/calendario-laboral/ccaa")
      .then(rows => { if (alive) setCcaaOptions(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setCcaaOptions([]); });
    return () => { alive = false; };
  }, [saFetchFn]);

  useEffect(() => {
    if (!empresaId && empresas?.[0]?.id) setEmpresaId(empresas[0].id);
  }, [empresas, empresaId]);

  async function refrescar() {
    if (!empresaId) {
      notify("Selecciona una empresa antes de asignar calendario laboral.", "warning");
      return;
    }
    const empresa = (empresas || []).find(e => String(e.id) === String(empresaId));
    const ccaaLabel = (ccaaOptions.find(c => c.code === ccaa) || {}).label || ccaa;
    const ok = await confirmDialog({
      title: "Asignar calendario laboral",
      message: `Asignar el calendario laboral de ${ccaaLabel} para ${year} a ${empresa?.nombre || "esta empresa"}?`,
      confirmText: "Asignar calendario",
      tone: "warning",
    });
    if (!ok) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await saFetchFn("/calendario-laboral/refresh", {
        method:"POST",
        body:{ year:Number(year), ccaa, empresa_id:empresaId || null },
      });
      setResult(data);
      notify(`Calendario ${data.ccaa_label || ccaaLabel} asignado a ${empresa?.nombre || "la empresa"}.`, "success");
    } catch(e) {
      notify(e.message || "No se pudo actualizar el calendario laboral.", "error");
    } finally {
      setLoading(false);
    }
  }

  const opciones = ccaaOptions.length ? ccaaOptions : [
    { code:"ES-MD", label:"Comunidad de Madrid" },
    { code:"ES-AN", label:"Andalucia" },
    { code:"ES-CT", label:"Cataluna" },
    { code:"ES-VC", label:"Comunitat Valenciana" },
  ];

  return (
    <div>
      <div style={SaaS.card}>
        <div style={SaaS.title}>Calendario laboral</div>
        <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5,marginBottom:14}}>
          Asigna a cada empresa el calendario laboral que le corresponda por comunidad autonoma. La plataforma usara esos festivos para planificacion, vencimientos y avisos.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,alignItems:"end"}}>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".07em"}}>Ano</label>
            <select value={year} onChange={e=>setYear(Number(e.target.value))} style={{width:"100%",marginTop:5,background:"#1a2035",border:"1px solid #28344f",color:"#e2e8f0",padding:"8px 10px",borderRadius:7}}>
              {Array.from({length:6},(_,i)=>currentYear-1+i).map(y=><option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".07em"}}>Comunidad autonoma</label>
            <select value={ccaa} onChange={e=>setCcaa(e.target.value)} style={{width:"100%",marginTop:5,background:"#1a2035",border:"1px solid #28344f",color:"#e2e8f0",padding:"8px 10px",borderRadius:7}}>
              {opciones.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".07em"}}>Empresa</label>
            <select value={empresaId} onChange={e=>setEmpresaId(e.target.value)} style={{width:"100%",marginTop:5,background:"#1a2035",border:"1px solid #28344f",color:"#e2e8f0",padding:"8px 10px",borderRadius:7}}>
              <option value="">Selecciona empresa</option>
              {(empresas || []).map(e=><option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>
          <button onClick={refrescar} disabled={loading} style={{...SaaS.btnOk,padding:"9px 14px",opacity:loading ? .7 : 1}}>
            {loading ? "Asignando..." : "Asignar calendario"}
          </button>
        </div>
      </div>

      {result && (
        <div style={SaaS.card}>
          <div style={SaaS.title}>Resultado</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:12}}>
            {[
              ["Ano", result.year],
              ["Comunidad", result.ccaa_label || result.ccaa],
              ["Empresas", result.total_empresas],
              ["Actualizadas", result.actualizadas],
              ["Errores", result.errores],
            ].map(([l,v])=>(
              <div key={l} style={{background:"#0f1420",border:"1px solid #1c2740",borderRadius:8,padding:"10px 12px"}}>
                <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".07em"}}>{l}</div>
                <div style={{fontSize:16,color:"#e2e8f0",fontWeight:900,marginTop:3}}>{v ?? "-"}</div>
              </div>
            ))}
          </div>
          <div style={{border:"1px solid #1c2740",borderRadius:8,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr><th style={SaaS.th}>Empresa</th><th style={SaaS.th}>Estado</th><th style={SaaS.th}>Festivos</th><th style={SaaS.th}>Fuente</th></tr></thead>
              <tbody>
                {(result.results || []).map(r=>(
                  <tr key={r.empresa_id}>
                    <td style={SaaS.td}>{r.empresa_nombre || r.empresa_id}</td>
                    <td style={{...SaaS.td,color:r.ok ? "#34d399" : "#f87171",fontWeight:800}}>{r.ok ? "Actualizado" : "Error"}</td>
                    <td style={SaaS.td}>{r.holidays_count ?? "-"}</td>
                    <td style={SaaS.td}>{r.fuente || r.error || "-"}</td>
                  </tr>
                ))}
                {!result.results?.length && (
                  <tr><td colSpan={4} style={SaaS.empty}>Sin resultados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const SaaS = {
  card:{background:"#141c2e",border:"1px solid #1c2740",borderRadius:8,padding:"16px 18px",marginBottom:12},
  title:{fontSize:15,fontWeight:800,color:"#f1f5f9",marginBottom:12},
  empty:{padding:18,textAlign:"center",fontSize:12,color:"#64748b"},
  th:{textAlign:"left",padding:"8px 10px",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"#64748b",borderBottom:"1px solid #1c2740"},
  td:{padding:"9px 10px",borderBottom:"1px solid #0d1525",fontSize:12,color:"#94a3b8",verticalAlign:"middle"},
  btn:{padding:"4px 9px",borderRadius:6,border:"1px solid #1c2740",background:"#1e2d45",color:"#94a3b8",fontSize:11,fontWeight:700,cursor:"pointer"},
  btnOk:{padding:"4px 9px",borderRadius:6,border:"1px solid rgba(16,185,129,.25)",background:"rgba(16,185,129,.12)",color:"#34d399",fontSize:11,fontWeight:700,cursor:"pointer"},
  btnWarn:{padding:"4px 9px",borderRadius:6,border:"1px solid rgba(245,158,11,.25)",background:"rgba(245,158,11,.12)",color:"#fbbf24",fontSize:11,fontWeight:700,cursor:"pointer"},
};

export default function SuperAdmin(){
  const [loggedIn,setLoggedIn]=useState(!!saToken());
  const [tab,setTab]=useState("dashboard"); // dashboard | empresas
  const [empresas,setEmpresas]=useState([]);
  const [stats,setStats]=useState(null);
  const [loading,setLoading]=useState(false);
  const [modalNueva,setModalNueva]=useState(false);
  const [editando,setEditando]=useState(null);
  const [busqueda,setBusqueda]=useState("");
  const [filtroEstado,setFiltroEstado]=useState("todos");
  const [creatingDemo,setCreatingDemo]=useState(false);

  const cargar=useCallback(async()=>{
    if(!loggedIn)return;
    setLoading(true);
    try{
      const [e,s]=await Promise.all([saFetch("/empresas"),saFetch("/stats")]);
      setEmpresas(Array.isArray(e) ? e : []);
      setStats(s);
    }catch(err){
      if(err.message.includes("invalido")||err.message.includes("nvalid")||err.message.includes("No autorizado")||err.message.includes("Sesion de superadmin")){saTokenRem();setLoggedIn(false);}
    }finally{setLoading(false);}
  },[loggedIn]);

  useEffect(()=>{cargar();},[cargar]);

  const empresasFiltradas=empresas.filter(e=>{
    const matchBusq=!busqueda||String(e.nombre||"").toLowerCase().includes(busqueda.toLowerCase())||String(e.email_admin||"").toLowerCase().includes(busqueda.toLowerCase());
    const matchEstado=filtroEstado==="todos"||e.estado===filtroEstado;
    return matchBusq&&matchEstado;
  });

  // Section
  const mrr = Number(stats?.mrr_estimado ?? empresas.filter(e=>e.estado==="activo").reduce((s,e)=>s+monthlyPlanValue(e.plan, e.ciclo_facturacion),0));
  const porVencer = empresas.filter(e=>e.fecha_vencimiento&&(new Date(e.fecha_vencimiento)-new Date())<7*24*3600*1000&&e.estado==="activo");
  const vencidas  = empresas.filter(e=>e.fecha_vencimiento&&new Date(e.fecha_vencimiento)<new Date()&&e.estado==="activo");

  async function entrarEmpresa(empresa) {
    const ok = await confirmDialog({
      title: "Entrar como soporte",
      message: `Entrar como soporte en ${empresa.nombre}?`,
      confirmText: "Entrar",
      tone: "warning",
    });
    if (!ok) return;
    try {
      const data = await saFetch(`/empresas/${empresa.id}/impersonar`, { method:"POST" });
      if (!data?.token || !data?.user) throw new Error("La empresa no tiene un usuario activo para entrar como soporte.");
      removeToken();
      setToken(data.token);
      setUser(data.user);
      try { localStorage.removeItem("tms_bloqueado"); } catch {}
      try { localStorage.removeItem("tms_suscripcion"); } catch {}
      if (typeof window !== "undefined") window.__TMS_BLOQUEADO = null;
      if (typeof window !== "undefined") window.__TMS_SUSCRIPCION = null;
      window.location.assign("/");
    } catch (e) {
      notify(e.message || "No se ha podido entrar en la empresa", "error");
    }
  }

  async function crearEmpresaDemo() {
    const ok = await confirmDialog({
      title: "Crear empresa demo",
      message: "Se creara una empresa enterprise sin limites con gerente activo, clientes, vehiculos, choferes y pedidos de ejemplo. La contrasena inicial sera demo1234.",
      confirmText: "Crear demo",
    });
    if (!ok) return;
    setCreatingDemo(true);
    try {
      const r = await saFetch("/empresas/demo", { method:"POST" });
      notify(`Empresa demo creada.\nUsuario: ${r.credenciales?.usuario}\nContrasena: ${r.credenciales?.password}`, "success", 14000);
      setTab("empresas");
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo crear la empresa demo", "error");
    } finally {
      setCreatingDemo(false);
    }
  }

  const S={
    card:{background:"#141c2e",border:"1px solid #1c2740",borderRadius:12,padding:"14px 18px",marginBottom:12},
    th:{textAlign:"left",padding:"9px 14px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#64748b",borderBottom:"1px solid #1c2740",whiteSpace:"nowrap"},
    td:{padding:"10px 14px",borderBottom:"1px solid #0d1525",fontSize:13,color:"#94a3b8",verticalAlign:"middle"},
    btn:{padding:"6px 12px",borderRadius:7,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  };

  if(!loggedIn) return <LoginSA onLogin={()=>setLoggedIn(true)}/>;

  return(
    <div style={{minHeight:"100vh",background:"#0f1420",fontFamily:"'DM Sans',sans-serif",color:"#e2e8f0"}}>
      {/* Header */}
      <div style={{background:"#141c2e",borderBottom:"1px solid #1c2740",padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:20}}>TransGestAdmin</div>
          <div style={{fontSize:12,color:"#64748b",marginTop:2}}>hola maestro.</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <button onClick={crearEmpresaDemo} disabled={creatingDemo} style={{...S.btn,background:"rgba(20,184,166,.14)",color:"#5eead4",border:"1px solid rgba(20,184,166,.28)",padding:"9px 18px",fontSize:13,fontWeight:700}}>
            {creatingDemo ? "Creando..." : "+ Empresa demo"}
          </button>
          <button onClick={()=>setModalNueva(true)} style={{...S.btn,background:"#3b6ef5",color:"#fff",padding:"9px 18px",fontSize:13,fontWeight:700}}>+ Nueva empresa</button>
          <button onClick={()=>{
            saTokenRem();
            removeToken();
            setLoggedIn(false);
          }} style={{...S.btn,background:"rgba(239,68,68,.1)",color:"#f87171",border:"1px solid rgba(239,68,68,.2)"}}>Salir</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{background:"#141c2e",borderBottom:"1px solid #1c2740",padding:"0 28px",display:"flex",gap:2}}>
        {[["dashboard","Dashboard"],["salud","Salud"],["empresas","Empresas"],["integraciones","Integraciones"],["calendario","Calendario laboral"],["auditoria","Auditoria"],["backups","Backups"],["config","Configuracion"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{padding:"12px 16px",border:"none",borderBottom:`2px solid ${tab===id?"#3b6ef5":"transparent"}`,
              color:tab===id?"#e2e8f0":"#64748b",background:"transparent",
              fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"}}>
            {l}
          </button>
        ))}
      </div>

      <div style={{maxWidth:1300,margin:"0 auto",padding:"24px 28px"}}>

        {/* Section */}
        {tab==="dashboard"&&stats&&(
          <>
            {/* KPIs principales */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginBottom:20}}>
              {[
                ["MRR estimado",     fmt2(mrr)+" EUR/mes",    "#10b981", "Ingresos mensuales recurrentes"],
                ["ARR estimado",     fmt2(stats.arr_estimado || mrr*12)+" EUR/ano", "#14b8a6", "Valor anual recurrente"],
                ["Facturado TransGest", fmt2(stats.facturacion_programa_mes || 0)+" EUR", "#f59e0b", "Emitido este mes"],
                ["Pendiente cobro", fmt2(stats.pendiente_programa || 0)+" EUR", "#ef4444", "Suscripciones pendientes"],
                ["Empresas activas", fmtN(stats.empresas_activas), "#3b82f6", "Suscripciones activas"],
                ["Usuarios totales", fmtN(stats.usuarios_total),  "#8b5cf6", "En todas las empresas"],
              ].map(([l,v,c,sub])=>(
                <div key={l} style={{...S.card,textAlign:"center",marginBottom:0}}>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:22,color:c}}>{v}</div>
                  <div style={{fontSize:11,color:"#e2e8f0",fontWeight:600,marginTop:4}}>{l}</div>
                  <div style={{fontSize:10,color:"#64748b",marginTop:2}}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Section */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div style={S.card}>
                <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em",marginBottom:14}}>Empresas por plan</div>
                {PLANES_OPTS.map(plan=>{
                  const count=empresas.filter(e=>e.plan===plan&&e.estado==="activo").length;
                  const revenue=empresas.filter(e=>e.plan===plan&&e.estado==="activo").reduce((s,e)=>s+monthlyPlanValue(e.plan, e.ciclo_facturacion),0);
                  const pct=stats.empresas_activas>0 ? (count/stats.empresas_activas)*100:0;
                  return(
                    <div key={plan} style={{marginBottom:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                        <span style={{fontSize:12,color:"#e2e8f0",fontWeight:600}}>{plan.charAt(0).toUpperCase()+plan.slice(1)}</span>
                        <div style={{display:"flex",gap:12,fontSize:11}}>
                          <span style={{color:PLAN_COLOR[plan],fontWeight:700}}>{count} empresas</span>
                          <span style={{color:"#64748b"}}>{fmt2(revenue)} EUR/mes</span>
                        </div>
                      </div>
                      <div style={{height:6,background:"#1e2a45",borderRadius:3,overflow:"hidden"}}>
                        <div style={{height:"100%",width:pct+"%",background:PLAN_COLOR[plan],borderRadius:3,transition:"width .4s"}}/>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={S.card}>
                <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em",marginBottom:14}}>Alertas</div>
                {porVencer.length===0&&vencidas.length===0?(
                  <div style={{fontSize:13,color:"#10b981",padding:"12px 0"}}>OK Sin alertas pendientes</div>
                ):(
                  <>
                    {vencidas.map(e=>(
                      <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #1c2740"}}>
                        <div>
                          <div style={{fontSize:13,color:"#ef4444",fontWeight:600}}>{e.nombre}</div>
                          <div style={{fontSize:11,color:"#64748b"}}>Vencida el {fmtDate(e.fecha_vencimiento)}</div>
                        </div>
                        <button onClick={()=>setEditando(e)} style={{...S.btn,background:"rgba(239,68,68,.15)",color:"#f87171",border:"1px solid rgba(239,68,68,.3)",fontSize:10}}>Renovar</button>
                      </div>
                    ))}
                    {porVencer.filter(e=>!vencidas.includes(e)).map(e=>(
                      <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #1c2740"}}>
                        <div>
                          <div style={{fontSize:13,color:"#fbbf24",fontWeight:600}}>{e.nombre}</div>
                          <div style={{fontSize:11,color:"#64748b"}}>Vence {fmtDate(e.fecha_vencimiento)}</div>
                        </div>
                        <button onClick={()=>setEditando(e)} style={{...S.btn,background:"rgba(251,191,36,.15)",color:"#fbbf24",border:"1px solid rgba(251,191,36,.3)",fontSize:10}}>Renovar</button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div style={S.card}>
              <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".06em",marginBottom:12}}>
                Ultimas empresas registradas
              </div>
              {empresas.slice(0,5).map(e=>(
                <div key={e.id} style={{display:"flex",alignItems:"center",gap:12,padding:"7px 0",borderBottom:"1px solid #0d1525",cursor:"pointer"}} onClick={()=>setEditando(e)}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,color:"#e2e8f0",fontWeight:600}}>{e.nombre}</div>
                    <div style={{fontSize:11,color:"#64748b"}}>{e.email_admin} - {fmtDate(e.created_at)}</div>
                  </div>
                  <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:`${PLAN_COLOR[e.plan]}20`,color:PLAN_COLOR[e.plan]}}>{e.plan}</span>
                  <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:`${ESTADO_COLOR[e.estado]}18`,color:ESTADO_COLOR[e.estado]}}>{e.estado}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab==="salud"&&(
          <SaludSaaS
            saFetchFn={saFetch}
            onGestionar={(e)=>setEditando(empresas.find(emp=>emp.id===e.id)||e)}
            onEntrar={entrarEmpresa}
          />
        )}

        {/* Section */}
        {tab==="empresas"&&(
          <div style={S.card}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,gap:12,flexWrap:"wrap"}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16}}>
                Empresas ({empresasFiltradas.length})
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                {/* Filtro estado */}
                <div style={{display:"flex",gap:4,background:"#1a2035",padding:3,borderRadius:8,border:"1px solid #1c2740"}}>
                  {["todos","activo","suspendido","cancelado"].map(s=>(
                    <button key={s} onClick={()=>setFiltroEstado(s)}
                      style={{...S.btn,background:filtroEstado===s?"#3b6ef5":"transparent",color:filtroEstado===s?"#fff":"#64748b",border:"none",padding:"4px 10px",fontSize:11,borderRadius:5}}>
                      {s==="todos"?"Todos":s.charAt(0).toUpperCase()+s.slice(1)}
                    </button>
                  ))}
                </div>
                <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar..."
                  style={{background:"#1a2035",border:"1px solid #28344f",color:"#e2e8f0",padding:"7px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:180}}/>
                <button onClick={cargar} style={{...S.btn,background:"#1e2d45",color:"#94a3b8",border:"1px solid #1c2740",padding:"7px 12px"}}>Actualizar</button>
              </div>
            </div>

            {loading?(
              <div style={{padding:30,textAlign:"center",color:"#64748b"}}>Cargando...</div>
            ):empresasFiltradas.length===0?(
              <div style={{padding:30,textAlign:"center",color:"#64748b"}}>Sin resultados.</div>
            ):(
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:980}}>
                  <thead><tr>
                    <th style={S.th}>Empresa</th><th style={S.th}>Plan</th><th style={S.th}>Estado</th>
                    <th style={S.th}>Pago</th><th style={S.th}>Uso</th><th style={S.th}>Pedidos</th>
                    <th style={S.th}>Registro</th><th style={S.th}>Vencimiento</th><th style={S.th}></th>
                  </tr></thead>
                  <tbody>
                    {empresasFiltradas.map(e=>{
                      const vencida=e.fecha_vencimiento&&new Date(e.fecha_vencimiento)<new Date();
                      const proxima=e.fecha_vencimiento&&!vencida&&(new Date(e.fecha_vencimiento)-new Date())<7*24*3600*1000;
                      return(
                        <tr key={e.id}>
                          <td style={{...S.td,fontWeight:700,color:"#e2e8f0"}}>
                            <div>{e.nombre}</div>
                            <div style={{fontSize:11,color:"#64748b"}}>{e.email_admin}</div>
                            {e.cif&&<div style={{fontSize:10,color:"#475569"}}>{e.cif}</div>}
                          </td>
                          <td style={S.td}><span style={{padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:700,background:`${PLAN_COLOR[e.plan]}20`,color:PLAN_COLOR[e.plan],border:`1px solid ${PLAN_COLOR[e.plan]}40`}}>{e.plan}</span></td>
                          <td style={S.td}><span style={{padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:700,background:`${ESTADO_COLOR[e.estado]}18`,color:ESTADO_COLOR[e.estado]}}>{e.estado}</span></td>
                          <td style={S.td}>
                            <div style={{fontSize:11,color:e.metodo_pago==="pendiente"?"#fbbf24":"#94a3b8",fontWeight:700}}>{e.metodo_pago || "pendiente"}</div>
                            {e.email_facturacion&&<div style={{fontSize:10,color:"#64748b",marginTop:2}}>{e.email_facturacion}</div>}
                          </td>
                          <td style={S.td}>
                            <div style={{fontSize:11,color:"#f97316",fontWeight:700}}>{fmtN(e.n_vehiculos)} vehiculos</div>
                            <div style={{fontSize:11,color:"#3b82f6",fontWeight:700,marginTop:2}}>{fmtN(e.n_usuarios)} usuarios</div>
                          </td>
                          <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"center",color:"#e2e8f0"}}>{fmtN(e.n_pedidos)}</td>
                          <td style={{...S.td,fontSize:11}}>{fmtDate(e.created_at)}</td>
                          <td style={{...S.td,fontSize:11}}>
                            <span style={{color:vencida?"#ef4444":proxima?"#fbbf24":"#94a3b8"}}>
                              {vencida?"Vencida ":proxima?"Proxima ":""}{e.fecha_vencimiento?fmtDate(e.fecha_vencimiento):"Sin limite"}
                            </span>
                          </td>
                          <td style={{...S.td,textAlign:"right"}}>
                            <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                              <button onClick={()=>entrarEmpresa(e)} style={{...S.btn,background:"rgba(16,185,129,.12)",color:"#34d399",border:"1px solid rgba(16,185,129,.25)"}}>Entrar</button>
                              <button onClick={()=>setEditando(e)} style={{...S.btn,background:"#1e2d45",color:"#94a3b8",border:"1px solid #1c2740"}}>Gestionar</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {tab==="config"&&(
          <div style={{padding:"24px 0"}}>
            <UsuariosAdmin saFetchFn={saFetch}/>
          </div>
        )}
        {tab==="integraciones"&&(
          <div style={{padding:"24px 0"}}>
            <IntegracionesAdmin saFetchFn={saFetch}/>
          </div>
        )}
        {tab==="calendario"&&(
          <div style={{padding:"24px 0"}}>
            <CalendarioLaboralAdmin saFetchFn={saFetch} empresas={empresas}/>
          </div>
        )}
        {tab==="auditoria"&&(
          <AuditoriaSaaS saFetchFn={saFetch}/>
        )}
        {tab==="backups"&&(
          <BackupsAdmin saFetchFn={saFetch}/>
        )}
      </div>

      {modalNueva&&<ModalNuevaEmpresa onClose={()=>setModalNueva(false)} onCreada={()=>{setModalNueva(false);cargar();}}/>}
      {editando&&<ModalEditarEmpresa empresa={editando} onClose={()=>setEditando(null)} onGuardado={()=>{setEditando(null);cargar();}}/>}
    </div>
  );
}
