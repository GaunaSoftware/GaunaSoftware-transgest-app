import { useState, useEffect } from "react";
import { getToken, getUser } from "../services/api";

const BASE = process.env.REACT_APP_API_URL || "https://transgest-backend.onrender.com";
const fmt  = d => d ? new Date(d).toLocaleDateString("es-ES") : "Sin límite";
const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});

const PLAN_INFO = {
  lite:        { label:"Lite",        color:"#0f766e", precio:"Consultar", features:["App chofer","Clientes y rutas","Pedidos y DCD con QR"] },
  basico:      { label:"Basico",      color:"#6b7280", precio:"99 EUR/mes",  features:["Vehiculos ilimitados","Usuarios ilimitados","Pedidos y facturacion"] },
  profesional: { label:"Profesional", color:"#3b82f6", precio:"199 EUR/mes", features:["Vehiculos ilimitados","Usuarios ilimitados","KPIs de gestion","Tarifas y objetivos"] },
  enterprise:  { label:"Enterprise",  color:"#8b5cf6", precio:"399 EUR/mes", features:["Vehiculos ilimitados","Usuarios ilimitados","KPIs e IA","Soporte prioritario"] },
};

const EF = { pendiente:"#f59e0b", pagada:"#10b981", vencida:"#ef4444" };

function apiFetch(path, opts={}) {
  const token = getToken();
  return fetch(`${BASE}/api/v1/mi-cuenta${path}`, {
    ...opts,
    headers:{ "Content-Type":"application/json", Authorization:"Bearer "+token, ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r => r.json());
}

function backupFetch(path, opts={}) {
  const token = getToken();
  return fetch(`${BASE}/api/v1/backup${path}`, {
    ...opts,
    headers:{ "Content-Type":"application/json", Authorization:"Bearer "+token, ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r => r.json());
}

function apiKeysFetch(path, opts={}) {
  const token = getToken();
  return fetch(`${BASE}/api/v1/api-keys${path}`, {
    ...opts,
    headers:{ "Content-Type":"application/json", Authorization:"Bearer "+token, ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r => r.json());
}

const API_KEY_SCOPES = ["pedidos","clientes","vehiculos","choferes","colaboradores","facturacion","rutas","palets","agenda","documentos","informes","control_horario","plan_diario"];

function webhooksFetch(path, opts={}) {
  const token = getToken();
  return fetch(`${BASE}/api/v1/webhooks${path}`, {
    ...opts,
    headers:{ "Content-Type":"application/json", Authorization:"Bearer "+token, ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r => r.json());
}

const WEBHOOK_EVENTS = ["pedido.creado","pedido.estado_cambiado","factura.emitida","cliente.creado"];

export default function MiCuenta(){
  const [cuenta,   setCuenta]   = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState("plan"); // plan | facturas | datos | password
  const esGerente = String(getUser()?.rol || "").toLowerCase() === "gerente";
  const [apiKeys,    setApiKeys]    = useState([]);
  const [apiKeyForm, setApiKeyForm] = useState({ nombre:"", scopes:[], dias:365 });
  const [nuevaApiKey, setNuevaApiKey] = useState(null);
  const [apiKeyMsj,  setApiKeyMsj]  = useState("");
  const [webhooks,     setWebhooks]     = useState([]);
  const [webhookForm,  setWebhookForm]  = useState({ url:"", events:[] });
  const [nuevoWebhookSecret, setNuevoWebhookSecret] = useState(null);
  const [webhookMsj,   setWebhookMsj]   = useState("");

  // Formulario datos empresa
  const [datosForm, setDatosForm] = useState({ nombre:"", cif:"" });
  const [datosMsj,  setDatosMsj]  = useState("");
  const [datosLoading, setDatosLoading] = useState(false);

  // Formulario contraseña
  const [passForm, setPassForm] = useState({ password_actual:"", password_nuevo:"", password_nuevo2:"" });
  const [passMsj,  setPassMsj]  = useState("");
  const [passLoading, setPassLoading] = useState(false);

  // Soporte
  const [soporte, setSoporte] = useState("");
  const [soporteMsj, setSoporteMsj] = useState("");
  const [soporteLoading, setSoporteLoading] = useState(false);

  // Backups
  const [backupMotivo, setBackupMotivo] = useState("");
  const [backupMsj, setBackupMsj] = useState("");
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupSolicitudes, setBackupSolicitudes] = useState([]);

  useEffect(()=>{
    Promise.all([
      apiFetch("/"),
      apiFetch("/facturas"),
      backupFetch("/solicitudes").catch(()=>[]),
    ])
    .then(([c,f,b])=>{
      setCuenta(c);
      setDatosForm({ nombre:c.nombre||"", cif:c.cif||"" });
      setFacturas(Array.isArray(f)?f:[]);
      setBackupSolicitudes(Array.isArray(b)?b:[]);
    }).catch(()=>{})
    .finally(()=>setLoading(false));
  },[]);

  async function guardarDatos(){
    setDatosLoading(true); setDatosMsj("");
    const r = await apiFetch("/datos",{ method:"PATCH", body:datosForm });
    setDatosLoading(false);
    if(r.ok){ setDatosMsj("✅ Datos actualizados correctamente"); setCuenta(p=>({...p,...datosForm})); }
    else setDatosMsj("❌ "+r.error);
  }

  async function cambiarPassword(){
    if(passForm.password_nuevo!==passForm.password_nuevo2){ setPassMsj("❌ Las contraseñas no coinciden"); return; }
    if(passForm.password_nuevo.length<8){ setPassMsj("❌ La nueva contraseña debe tener al menos 8 caracteres"); return; }
    setPassLoading(true); setPassMsj("");
    const r = await apiFetch("/cambiar-password",{ method:"POST", body:{ password_actual:passForm.password_actual, password_nuevo:passForm.password_nuevo }});
    setPassLoading(false);
    if(r.ok){ setPassMsj("✅ Contraseña cambiada correctamente"); setPassForm({password_actual:"",password_nuevo:"",password_nuevo2:""}); }
    else setPassMsj("❌ "+r.error);
  }

  async function enviarSoporte(){
    if(!soporte.trim()) return;
    setSoporteLoading(true); setSoporteMsj("");
    const r = await apiFetch("/soporte",{ method:"POST", body:{ mensaje:soporte }});
    setSoporteLoading(false);
    if(r.ok){ setSoporteMsj("✅ Mensaje enviado. Te responderemos en menos de 24h."); setSoporte(""); }
    else setSoporteMsj("❌ "+r.error);
  }

  async function solicitarBackup(){
    setBackupLoading(true); setBackupMsj("");
    const r = await backupFetch("/solicitudes", {
      method:"POST",
      body:{ motivo: backupMotivo || "Solicitud desde Mi cuenta" },
    });
    setBackupLoading(false);
    if(r.id){
      setBackupMsj("Solicitud enviada a TransGestAdmin.");
      setBackupMotivo("");
      const lista = await backupFetch("/solicitudes").catch(()=>[]);
      setBackupSolicitudes(Array.isArray(lista)?lista:[]);
    } else {
      setBackupMsj(r.error || "No se pudo enviar la solicitud.");
    }
  }

  async function cargarApiKeys(){
    if (!esGerente) return;
    const r = await apiKeysFetch("/").catch(()=>({data:[]}));
    setApiKeys(Array.isArray(r.data) ? r.data : []);
  }
  async function cargarWebhooks(){
    if (!esGerente) return;
    const r = await webhooksFetch("/").catch(()=>({data:[]}));
    setWebhooks(Array.isArray(r.data) ? r.data : []);
  }
  useEffect(()=>{ if (esGerente){ cargarApiKeys(); cargarWebhooks(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ },[]);
  function toggleWebhookEvent(ev){
    setWebhookForm(p => ({ ...p, events: p.events.includes(ev) ? p.events.filter(e=>e!==ev) : [...p.events, ev] }));
  }
  async function crearWebhook(){
    setWebhookMsj(""); setNuevoWebhookSecret(null);
    if (!/^https:\/\//i.test(webhookForm.url)){ setWebhookMsj("❌ La URL debe empezar por https://"); return; }
    if (!webhookForm.events.length){ setWebhookMsj("❌ Selecciona al menos un evento."); return; }
    const r = await webhooksFetch("/", { method:"POST", body:{ url: webhookForm.url.trim(), events: webhookForm.events } });
    if (r.secret){ setNuevoWebhookSecret(r.secret); setWebhookForm({ url:"", events:[] }); cargarWebhooks(); }
    else setWebhookMsj("❌ "+(r.error||"No se pudo crear el webhook"));
  }
  async function revocarWebhook(id){
    const r = await webhooksFetch(`/${id}`, { method:"DELETE" });
    if (r.ok) cargarWebhooks(); else setWebhookMsj("❌ "+(r.error||"No se pudo eliminar"));
  }
  function toggleScope(mod){
    setApiKeyForm(p => ({ ...p, scopes: p.scopes.includes(mod) ? p.scopes.filter(s=>s!==mod) : [...p.scopes, mod] }));
  }
  async function crearApiKey(){
    setApiKeyMsj(""); setNuevaApiKey(null);
    if (!apiKeyForm.scopes.length){ setApiKeyMsj("❌ Selecciona al menos un modulo."); return; }
    const r = await apiKeysFetch("/", { method:"POST", body:{ nombre: apiKeyForm.nombre || "Integracion API", scopes: apiKeyForm.scopes, dias: Number(apiKeyForm.dias)||365 } });
    if (r.token){ setNuevaApiKey(r.token); setApiKeyForm({ nombre:"", scopes:[], dias:365 }); cargarApiKeys(); }
    else setApiKeyMsj("❌ "+(r.error||"No se pudo crear la clave"));
  }
  async function revocarApiKey(id){
    const r = await apiKeysFetch(`/${id}`, { method:"DELETE" });
    if (r.ok) cargarApiKeys(); else setApiKeyMsj("❌ "+(r.error||"No se pudo revocar"));
  }

  const plan = PLAN_INFO[cuenta?.plan] || PLAN_INFO.profesional;
  const diasRestantes = cuenta?.fecha_vencimiento
    ? Math.ceil((new Date(cuenta.fecha_vencimiento)-new Date())/(1000*60*60*24)) : null;

  const S={
    card:{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"18px 20px",marginBottom:14},
    btn:{padding:"9px 20px",borderRadius:8,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"},
    inp:{width:"100%",background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"9px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",boxSizing:"border-box"},
    lbl:{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:14},
    msj_ok:{ padding:"8px 12px",borderRadius:7,background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.2)",fontSize:12,color:"#10b981",marginTop:10 },
    msj_err:{ padding:"8px 12px",borderRadius:7,background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.2)",fontSize:12,color:"var(--red)",marginTop:10 },
  };

  if(loading) return <div style={{padding:40,textAlign:"center",color:"var(--text5)",fontFamily:"'DM Sans',sans-serif"}}>Cargando...</div>;
  if(!cuenta)  return <div style={{padding:40,textAlign:"center",color:"var(--text5)",fontFamily:"'DM Sans',sans-serif"}}>No se pudo cargar la información.</div>;

  const TABS = [
    ["plan",      "📊 Mi plan"],
    ["facturas",  "🧾 Facturas"],
    ["datos",     "🏢 Mis datos"],
    ["password",  "🔑 Contraseña"],
    ["backups",   "Backups"],
    ...(esGerente ? [["api", "🔌 Integraciones API"]] : []),
    ["soporte",   "💬 Soporte"],
  ];

  return(
    <div style={{padding:"22px 26px",fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",maxWidth:800}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:900,color:"var(--text)",marginBottom:20}}>
        🏢 Mi cuenta
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:2,borderBottom:"1px solid var(--border)",marginBottom:20,flexWrap:"wrap"}}>
        {TABS.map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{padding:"8px 14px",border:"none",borderRadius:"6px 6px 0 0",
              borderBottom:`2px solid ${tab===id?"var(--accent)":"transparent"}`,
              color:tab===id?"var(--accent)":"var(--text4)",background:"transparent",
              fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Plan ── */}
      {tab==="plan"&&(
        <>
          <div style={{...S.card,border:`1.5px solid ${plan.color}40`,background:`${plan.color}08`}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Plan activo</div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:24,color:plan.color}}>{plan.label}</span>
                  <span style={{padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:`${plan.color}20`,color:plan.color,border:`1px solid ${plan.color}40`}}>{cuenta.estado}</span>
                </div>
                <div style={{fontSize:13,color:"var(--text4)",marginTop:3}}>{plan.precio}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:11,color:"var(--text5)",marginBottom:2}}>Vence el</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,
                  color:diasRestantes!==null&&diasRestantes<7?"var(--red)":diasRestantes!==null&&diasRestantes<30?"#f59e0b":"#10b981"}}>
                  {fmt(cuenta.fecha_vencimiento)}
                </div>
                {diasRestantes!==null&&diasRestantes<=30&&(
                  <div style={{fontSize:11,color:diasRestantes<7?"var(--red)":"#f59e0b",marginTop:2}}>
                    {diasRestantes>0?`${diasRestantes} días restantes`:"⚠️ Vencido — contacta con soporte"}
                  </div>
                )}
              </div>
            </div>
            <div style={{marginTop:14,display:"flex",gap:8,flexWrap:"wrap"}}>
              {plan.features.map(f=>(
                <span key={f} style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,
                  background:`${plan.color}15`,color:plan.color,border:`1px solid ${plan.color}30`}}>✓ {f}</span>
              ))}
            </div>
          </div>

          {/* Uso */}
          <div style={S.card}>
            <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:14}}>Uso actual</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
              {[
                ["Vehiculos",      cuenta.uso?.vehiculos||0,   "Sin limite", "#f97316"],
                ["Usuarios",       cuenta.uso?.usuarios||0,    "Sin limite", "#3b82f6"],
                ["Pedidos 30 dias",cuenta.uso?.pedidos_mes||0, "Ultimos 30 dias", "#10b981"],
              ].map(([l,v,nota,c])=>{
                return(
                  <div key={l} style={{background:"var(--bg3)",borderRadius:9,padding:"12px 14px"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:22,color:c}}>
                      {v}
                    </div>
                    <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>{l}</div>
                    <div style={{fontSize:10,color:"var(--text5)",marginTop:6}}>{nota}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Facturas ── */}
      {tab==="facturas"&&(
        <div style={S.card}>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:14}}>
            Facturas de suscripción
          </div>
          {facturas.length===0?(
            <div style={{padding:"24px 0",textAlign:"center",color:"var(--text5)",fontSize:13}}>
              Aún no tienes facturas emitidas. Aparecerán aquí cuando se generen.
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr>
                  {["Número","Concepto","Período","Importe","Estado","F. Vencimiento"].map(h=>(
                    <th key={h} style={{textAlign:"left",padding:"7px 10px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",borderBottom:"1px solid var(--border)"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facturas.map(f=>(
                  <tr key={f.id}>
                    <td style={{padding:"9px 10px",borderBottom:"1px solid var(--border2)",fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:"var(--accent)"}}>{f.numero}</td>
                    <td style={{padding:"9px 10px",borderBottom:"1px solid var(--border2)",fontSize:13,color:"var(--text)"}}>{f.concepto}</td>
                    <td style={{padding:"9px 10px",borderBottom:"1px solid var(--border2)",fontSize:12,color:"var(--text4)"}}>{fmt(f.periodo_desde)} — {fmt(f.periodo_hasta)}</td>
                    <td style={{padding:"9px 10px",borderBottom:"1px solid var(--border2)",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"#10b981"}}>{fmt2(f.importe)} €</td>
                    <td style={{padding:"9px 10px",borderBottom:"1px solid var(--border2)"}}>
                      <span style={{padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:700,
                        background:`${EF[f.estado]||"#6b7280"}18`,color:EF[f.estado]||"#6b7280",
                        border:`1px solid ${EF[f.estado]||"#6b7280"}30`}}>
                        {f.estado}
                      </span>
                    </td>
                    <td style={{padding:"9px 10px",borderBottom:"1px solid var(--border2)",fontSize:12,
                      color:f.estado==="vencida"?"var(--red)":"var(--text4)"}}>
                      {fmt(f.fecha_vencimiento)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{background:"var(--bg3)"}}>
                  <td colSpan={3} style={{padding:"9px 10px",fontWeight:700,fontSize:13,color:"var(--text)"}}>Total pagado</td>
                  <td style={{padding:"9px 10px",fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:14,color:"#10b981"}}>
                    {fmt2(facturas.filter(f=>f.estado==="pagada").reduce((s,f)=>s+Number(f.importe||0),0))} €
                  </td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── Datos empresa ── */}
      {tab==="datos"&&(
        <div style={S.card}>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:14}}>
            Datos de la empresa
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
            <div style={{gridColumn:"1/-1"}}>
              <label style={S.lbl}>Nombre / Razón social *</label>
              <input style={S.inp} value={datosForm.nombre} onChange={e=>setDatosForm(p=>({...p,nombre:e.target.value}))}/>
            </div>
            <div>
              <label style={S.lbl}>CIF / NIF</label>
              <input style={S.inp} value={datosForm.cif} onChange={e=>setDatosForm(p=>({...p,cif:e.target.value}))} placeholder="B12345678"/>
            </div>
            <div>
              <label style={S.lbl}>Email de contacto</label>
              <input style={{...S.inp,background:"var(--bg3)",color:"var(--text5)"}} value={cuenta.email_admin} disabled/>
            </div>
          </div>
          <div style={{marginTop:6,fontSize:11,color:"var(--text5)"}}>Para cambiar el email de acceso contacta con soporte.</div>
          <button onClick={guardarDatos} disabled={datosLoading}
            style={{...S.btn,marginTop:16,opacity:datosLoading?.7:1}}>
            {datosLoading?"Guardando...":"💾 Guardar cambios"}
          </button>
          {datosMsj&&<div style={datosMsj.startsWith("✅")?S.msj_ok:S.msj_err}>{datosMsj}</div>}
        </div>
      )}

      {/* ── Contraseña ── */}
      {tab==="password"&&(
        <div style={S.card}>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:14}}>
            Cambiar contraseña
          </div>
          {[
            ["password_actual",  "Contraseña actual *"],
            ["password_nuevo",   "Nueva contraseña * (mín. 8 caracteres)"],
            ["password_nuevo2",  "Repetir nueva contraseña *"],
          ].map(([k,l])=>(
            <div key={k}>
              <label style={S.lbl}>{l}</label>
              <input type="password" style={S.inp} value={passForm[k]}
                onChange={e=>setPassForm(p=>({...p,[k]:e.target.value}))}/>
            </div>
          ))}
          <button onClick={cambiarPassword} disabled={passLoading}
            style={{...S.btn,marginTop:16,opacity:passLoading?.7:1}}>
            {passLoading?"Cambiando...":"🔑 Cambiar contraseña"}
          </button>
          {passMsj&&<div style={passMsj.startsWith("✅")?S.msj_ok:S.msj_err}>{passMsj}</div>}
        </div>
      )}

      {/* ── Backups ── */}
      {tab==="backups"&&(
        <div style={S.card}>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:8}}>
            Solicitudes de backup
          </div>
          <div style={{fontSize:13,color:"var(--text4)",marginBottom:14,lineHeight:1.6}}>
            Pide una copia de seguridad y TransGestAdmin la generara desde el panel de super usuario.
          </div>
          <label style={S.lbl}>Motivo</label>
          <textarea
            value={backupMotivo}
            onChange={e=>setBackupMotivo(e.target.value)}
            placeholder="Ejemplo: cierre mensual, auditoria, copia preventiva..."
            style={{...S.inp,minHeight:90,resize:"vertical"}}
          />
          <button
            onClick={solicitarBackup}
            disabled={backupLoading}
            style={{...S.btn,marginTop:12,opacity:backupLoading?.6:1}}
          >
            {backupLoading?"Enviando...":"Solicitar backup"}
          </button>
          {backupMsj&&<div style={backupMsj.startsWith("Solicitud")?S.msj_ok:S.msj_err}>{backupMsj}</div>}

          <div style={{marginTop:18,fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)"}}>
            Historial
          </div>
          {backupSolicitudes.length===0 ? (
            <div style={{padding:"14px 0",fontSize:13,color:"var(--text5)"}}>Sin solicitudes de backup.</div>
          ) : (
            <div style={{marginTop:8}}>
              {backupSolicitudes.map(s=>(
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"10px 0",borderTop:"1px solid var(--border2)"}}>
                  <div>
                    <div style={{fontSize:13,color:"var(--text)",fontWeight:700}}>{s.motivo || "Backup"}</div>
                    <div style={{fontSize:11,color:"var(--text5)"}}>{fmt(s.created_at)}</div>
                    {s.filename&&<div style={{fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>{s.filename}</div>}
                  </div>
                  <span style={{alignSelf:"flex-start",padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:800,background:s.estado==="generado"?"rgba(16,185,129,.12)":"rgba(245,158,11,.12)",color:s.estado==="generado"?"#10b981":"#f59e0b"}}>
                    {s.estado}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Integraciones API ── */}
      {tab==="api"&&esGerente&&(
        <div style={S.card}>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:8}}>Claves de API para integraciones</div>
          <div style={{fontSize:13,color:"var(--text4)",marginBottom:14}}>
            Genera claves para que programas externos se integren con tu API. Envía la clave en la cabecera <code>Authorization: Bearer tgk_...</code> Cada clave respeta solo los módulos que selecciones.
          </div>
          {nuevaApiKey && (
            <div style={{...S.msj_ok, marginBottom:12, wordBreak:"break-all"}}>
              Clave creada (cópiala ahora, no se volverá a mostrar):<br/><strong>{nuevaApiKey}</strong>
            </div>
          )}
          {apiKeyMsj && <div style={apiKeyMsj.startsWith("❌")?S.msj_err:S.msj_ok}>{apiKeyMsj}</div>}
          <label style={S.lbl}>Nombre</label>
          <input style={S.inp} value={apiKeyForm.nombre} onChange={e=>setApiKeyForm(p=>({...p,nombre:e.target.value}))} placeholder="Integración ERP, etc." />
          <label style={S.lbl}>Módulos (scopes)</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {API_KEY_SCOPES.map(m=>(
              <button key={m} type="button" onClick={()=>toggleScope(m)} style={{padding:"5px 10px",borderRadius:20,border:"1px solid var(--border)",fontSize:12,cursor:"pointer",background:apiKeyForm.scopes.includes(m)?"var(--accent)":"var(--bg4)",color:apiKeyForm.scopes.includes(m)?"#fff":"var(--text3)"}}>{m}</button>
            ))}
          </div>
          <label style={S.lbl}>Caducidad (días)</label>
          <input style={{...S.inp,maxWidth:160}} type="number" min={1} max={1095} value={apiKeyForm.dias} onChange={e=>setApiKeyForm(p=>({...p,dias:e.target.value}))} />
          <div><button style={{...S.btn,marginTop:12}} onClick={crearApiKey}>Crear clave</button></div>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",margin:"22px 0 8px"}}>Claves activas</div>
          {apiKeys.length===0 ? (
            <div style={{fontSize:13,color:"var(--text5)"}}>Aún no has creado ninguna clave.</div>
          ) : apiKeys.map(k=>(
            <div key={k.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid var(--border2)",flexWrap:"wrap"}}>
              <div>
                <div style={{fontWeight:700,color:"var(--text)"}}>{k.nombre} {!k.activo&&<span style={{color:"var(--red)",fontSize:11}}>(revocada)</span>}</div>
                <div style={{fontSize:11,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>{k.token_mask} · {(k.scopes||[]).join(", ")} · {k.usage_count||0} usos</div>
              </div>
              {k.activo && <button style={{...S.btn,background:"var(--red)"}} onClick={()=>revocarApiKey(k.id)}>Revocar</button>}
            </div>
          ))}
        </div>
      )}

      {/* ── Webhooks salientes ── */}
      {tab==="api"&&esGerente&&(
        <div style={S.card}>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:8}}>Webhooks salientes</div>
          <div style={{fontSize:13,color:"var(--text4)",marginBottom:14}}>
            TransGest avisará a tu sistema (por POST) cuando ocurran estos eventos, sin que tengas que consultar la API. Cada envío incluye la cabecera <code>X-TransGest-Signature: sha256=…</code> Verifícala con HMAC-SHA256 del cuerpo usando el secreto de la suscripción.
          </div>
          {nuevoWebhookSecret && (
            <div style={{...S.msj_ok, marginBottom:12, wordBreak:"break-all"}}>
              Secreto del webhook (guárdalo ahora, no se volverá a mostrar):<br/><strong>{nuevoWebhookSecret}</strong>
            </div>
          )}
          {webhookMsj && <div style={webhookMsj.startsWith("❌")?S.msj_err:S.msj_ok}>{webhookMsj}</div>}
          <label style={S.lbl}>URL de destino (https)</label>
          <input style={S.inp} value={webhookForm.url} onChange={e=>setWebhookForm(p=>({...p,url:e.target.value}))} placeholder="https://tu-sistema.com/hooks/transgest" />
          <label style={S.lbl}>Eventos</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {WEBHOOK_EVENTS.map(ev=>(
              <button key={ev} type="button" onClick={()=>toggleWebhookEvent(ev)} style={{padding:"5px 10px",borderRadius:20,border:"1px solid var(--border)",fontSize:12,cursor:"pointer",background:webhookForm.events.includes(ev)?"var(--accent)":"var(--bg4)",color:webhookForm.events.includes(ev)?"#fff":"var(--text3)"}}>{ev}</button>
            ))}
          </div>
          <div><button style={{...S.btn,marginTop:12}} onClick={crearWebhook}>Crear webhook</button></div>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",margin:"22px 0 8px"}}>Webhooks activos</div>
          {webhooks.length===0 ? (
            <div style={{fontSize:13,color:"var(--text5)"}}>Aún no has creado ningún webhook.</div>
          ) : webhooks.map(w=>(
            <div key={w.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid var(--border2)",flexWrap:"wrap"}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:700,color:"var(--text)",wordBreak:"break-all"}}>{w.url} {!w.activo&&<span style={{color:"var(--red)",fontSize:11}}>(inactivo)</span>}</div>
                <div style={{fontSize:11,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>{(w.events||[]).join(", ")}{w.last_status?` · último envío: ${w.last_status}`:""}{w.failure_count?` · ${w.failure_count} fallos`:""}</div>
              </div>
              {w.activo && <button style={{...S.btn,background:"var(--red)"}} onClick={()=>revocarWebhook(w.id)}>Eliminar</button>}
            </div>
          ))}
        </div>
      )}

      {/* ── Soporte ── */}
      {tab==="soporte"&&(
        <div style={S.card}>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:8}}>
            Contactar con soporte
          </div>
          <div style={{fontSize:13,color:"var(--text4)",marginBottom:14,lineHeight:1.6}}>
            ¿Tienes alguna duda, incidencia o quieres ampliar tu plan? Escríbenos y te responderemos en menos de 24h.
          </div>
          <textarea value={soporte} onChange={e=>setSoporte(e.target.value)}
            placeholder="Describe tu consulta, incidencia o solicitud de cambio de plan..."
            style={{...S.inp,minHeight:120,resize:"vertical"}}/>
          <div style={{display:"flex",alignItems:"center",gap:14,marginTop:12,flexWrap:"wrap"}}>
            <button onClick={enviarSoporte} disabled={!soporte.trim()||soporteLoading}
              style={{...S.btn,opacity:(!soporte.trim()||soporteLoading)?.5:1}}>
              {soporteLoading?"Enviando...":"📨 Enviar mensaje"}
            </button>
            <div style={{fontSize:12,color:"var(--text5)"}}>
              También puedes escribirnos directamente a <strong style={{color:"var(--text3)"}}>soporte@transgest.com</strong>
            </div>
          </div>
          {soporteMsj&&<div style={soporteMsj.startsWith("✅")?S.msj_ok:S.msj_err}>{soporteMsj}</div>}
        </div>
      )}
    </div>
  );
}
