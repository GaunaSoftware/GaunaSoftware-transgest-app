import { useState } from "react";

const BASE = process.env.REACT_APP_API_URL || "";

// eslint-disable-next-line no-unused-vars
const PLANES = [
  { id:"lite",        nombre:"Lite",        precio:29,  veh:1,  usr:2,  color:"#0f766e",
    features:["App chofer","Clientes, rutas y pedidos","DCD con QR"] },
  { id:"basico",      nombre:"Básico",      precio:49,  veh:3,  usr:2,  color:"#6b7280",
    features:["Pedidos y tráfico","Facturación básica","Hasta 3 vehículos","2 usuarios"] },
  { id:"profesional", nombre:"Profesional", precio:149, veh:10, usr:5,  color:"#3b82f6", recommended:true,
    features:["Todo lo del Básico","Chóferes y hojas de ruta","Informes avanzados","Tarifas y objetivos","Hasta 10 vehículos","5 usuarios"] },
  { id:"enterprise",  nombre:"Enterprise",  precio:399, veh:50, usr:20, color:"#8b5cf6",
    features:["Todo lo del Profesional","Nóminas automáticas","Portal de clientes","App chóferes","Soporte prioritario","50 vehículos · 20 usuarios"] },
];

const REGISTRO_PLANES = [
  { id:"lite",        nombre:"Lite",        precio:49,  veh:"DCD", usr:"2", color:"#0f766e",
    features:["App chofer","Clientes, rutas y pedidos","DCD con QR"] },
  { id:"basico",      nombre:"Basico",      precio:99,  veh:"Ilimitados", usr:"ilimitados", color:"#6b7280",
    features:["Vehiculos ilimitados","Usuarios ilimitados","Pedidos y trafico","Facturacion operativa"] },
  { id:"profesional", nombre:"Profesional", precio:199, veh:"Ilimitados", usr:"ilimitados", color:"#3b82f6", recommended:true,
    features:["Todo lo del Basico","KPIs de gestion","Informes avanzados","Tarifas y objetivos"] },
  { id:"enterprise",  nombre:"Enterprise",  precio:399, veh:"Ilimitados", usr:"ilimitados", color:"#8b5cf6",
    features:["Todo lo del Profesional","IA incluida","Portal de clientes","App choferes","Soporte prioritario"] },
];

export default function Registro() {
  const [step,  setStep]  = useState(1); // 1=plan, 2=datos, 3=confirmado
  const [plan,  setPlan]  = useState("profesional");
  const [form,  setForm]  = useState({ nombre_empresa:"", cif:"", nombre_admin:"", email:"", password:"", password2:"" });
  const [error, setError] = useState("");
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);

  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));

  async function registrar() {
    if (!form.nombre_empresa||!form.email||!form.password||!form.nombre_admin) {
      setError("Rellena todos los campos obligatorios"); return;
    }
    if (form.password !== form.password2) {
      setError("Las contraseñas no coinciden"); return;
    }
    if (form.password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres"); return;
    }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${BASE}/api/v1/registro`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ ...form, plan }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || data.errors?.[0]?.msg || "Error al registrar"); return; }
      setResult(data);
      setStep(3);
    } catch(e) {
      setError("Error de conexión. Verifica tu internet.");
    } finally { setLoading(false); }
  }

  const inp = { width:"100%", background:"#1a2035", border:"1px solid #28344f", color:"#e2e8f0",
    padding:"11px 14px", borderRadius:9, fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none", boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:11, fontWeight:700, textTransform:"uppercase",
    letterSpacing:".07em", color:"#64748b", marginBottom:5, marginTop:16 };

  return (
    <div style={{ minHeight:"100vh", background:"#0f1420", fontFamily:"'DM Sans',sans-serif",
      backgroundImage:"radial-gradient(ellipse 60% 40% at 50% -10%, rgba(59,110,245,.2) 0%, transparent 70%)" }}>

      {/* Nav */}
      <div style={{ padding:"16px 32px", display:"flex", alignItems:"center", justifyContent:"space-between",
        borderBottom:"1px solid #1c2740" }}>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:22, color:"#e2e8f0" }}>
          🚛 TransGest TMS
        </div>
        <a href="/" style={{ fontSize:13, color:"#64748b", textDecoration:"none" }}>
          ← Ya tengo cuenta
        </a>
      </div>

      <div style={{ maxWidth: step===1?900:520, margin:"0 auto", padding:"40px 24px" }}>

        {/* Step 1 — Elegir plan */}
        {step===1 && (
          <>
            <div style={{ textAlign:"center", marginBottom:40 }}>
              <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:36, color:"#e2e8f0", margin:"0 0 10px" }}>
                Empieza gratis 14 días
              </h1>
              <p style={{ color:"#64748b", fontSize:16, margin:0 }}>Sin tarjeta de crédito. Cancela cuando quieras.</p>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:32 }}>
              {REGISTRO_PLANES.map(p=>(
                <div key={p.id} onClick={()=>setPlan(p.id)}
                  style={{ background:"#141c2e", border:`2px solid ${plan===p.id?p.color:"#1c2740"}`,
                    borderRadius:16, padding:24, cursor:"pointer", transition:"all .15s", position:"relative" }}>
                  {p.recommended&&(
                    <div style={{ position:"absolute", top:-12, left:"50%", transform:"translateX(-50%)",
                      background:p.color, color:"#fff", fontSize:11, fontWeight:700, padding:"3px 14px",
                      borderRadius:20, whiteSpace:"nowrap" }}>
                      MÁS POPULAR
                    </div>
                  )}
                  <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color:"#e2e8f0", marginBottom:6 }}>
                    {p.nombre}
                  </div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:900, fontSize:32, color:p.color, marginBottom:4 }}>
                    {p.precio}€
                    <span style={{ fontSize:14, fontWeight:400, color:"#64748b" }}>/mes</span>
                  </div>
                  <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>
                    {p.veh} vehículos · {p.usr} usuarios
                  </div>
                  <div style={{ borderTop:"1px solid #1c2740", paddingTop:14 }}>
                    {p.features.map(feat=>(
                      <div key={feat} style={{ fontSize:13, color:"#94a3b8", padding:"3px 0",
                        display:"flex", alignItems:"center", gap:7 }}>
                        <span style={{ color:p.color, fontSize:14 }}>✓</span>{feat}
                      </div>
                    ))}
                  </div>
                  {plan===p.id&&(
                    <div style={{ position:"absolute", top:12, right:12, width:20, height:20,
                      borderRadius:"50%", background:p.color, display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:11, color:"#fff" }}>✓</div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ textAlign:"center" }}>
              <button onClick={()=>setStep(2)}
                style={{ padding:"14px 48px", borderRadius:10, border:"none", background:"#3b6ef5",
                  color:"#fff", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                Empezar con el plan {REGISTRO_PLANES.find(p=>p.id===plan)?.nombre} →
              </button>
            </div>
          </>
        )}

        {/* Step 2 — Datos empresa */}
        {step===2 && (
          <div style={{ background:"#141c2e", border:"1px solid #1c2740", borderRadius:18, padding:36 }}>
            <button onClick={()=>setStep(1)} style={{ background:"none",border:"none",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",marginBottom:20,padding:0,display:"flex",alignItems:"center",gap:5 }}>
              ← Cambiar plan
            </button>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:24, color:"#e2e8f0", margin:"0 0 4px" }}>
              Crea tu cuenta
            </h2>
            <p style={{ color:"#64748b", fontSize:14, margin:"0 0 20px" }}>
              Plan <strong style={{ color:"#3b82f6" }}>{REGISTRO_PLANES.find(p=>p.id===plan)?.nombre}</strong>
              · 14 días de prueba gratuita
            </p>

            {error&&<div style={{ background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.25)", borderRadius:8,
              padding:"10px 14px", color:"#fca5a5", fontSize:13, marginBottom:16 }}>{error}</div>}

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>Nombre de tu empresa *</label>
                <input style={inp} value={form.nombre_empresa} onChange={f("nombre_empresa")} placeholder="Transportes García S.L."/>
              </div>
              <div>
                <label style={lbl}>CIF / NIF (opcional)</label>
                <input style={inp} value={form.cif} onChange={f("cif")} placeholder="B12345678"/>
              </div>
              <div>
                <label style={lbl}>Tu nombre *</label>
                <input style={inp} value={form.nombre_admin} onChange={f("nombre_admin")} placeholder="Carlos García"/>
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>Email de acceso *</label>
                <input type="email" style={inp} value={form.email} onChange={f("email")} placeholder="carlos@tuempresa.com"/>
              </div>
              <div>
                <label style={lbl}>Contraseña * (mín. 8 caracteres)</label>
                <input type="password" style={inp} value={form.password} onChange={f("password")} placeholder="••••••••"/>
              </div>
              <div>
                <label style={lbl}>Repetir contraseña *</label>
                <input type="password" style={inp} value={form.password2} onChange={f("password2")} placeholder="••••••••"
                  onKeyDown={e=>e.key==="Enter"&&registrar()}/>
              </div>
            </div>

            <button onClick={registrar} disabled={loading}
              style={{ width:"100%", padding:"14px", borderRadius:10, border:"none", background:loading?"#374151":"#3b6ef5",
                color:"#fff", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer",
                fontFamily:"'DM Sans',sans-serif", marginTop:24 }}>
              {loading ? "Creando tu cuenta..." : "🚀 Crear cuenta gratis"}
            </button>

            <p style={{ textAlign:"center", fontSize:12, color:"#64748b", marginTop:14, lineHeight:1.6 }}>
              Al registrarte aceptas los Términos de Servicio y la Política de Privacidad.
              Tus datos están seguros y protegidos.
            </p>
          </div>
        )}

        {/* Step 3 — Confirmado */}
        {step===3 && result && (
          <div style={{ background:"#141c2e", border:"1px solid #1c2740", borderRadius:18, padding:40, textAlign:"center" }}>
            <div style={{ fontSize:56, marginBottom:16 }}>🎉</div>
            <h2 style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:28, color:"#e2e8f0", margin:"0 0 10px" }}>
              ¡Todo listo, {result.user?.nombre}!
            </h2>
            <p style={{ color:"#94a3b8", fontSize:15, margin:"0 0 24px", lineHeight:1.7 }}>
              Tu cuenta de <strong style={{ color:"#e2e8f0" }}>{result.empresa?.nombre}</strong> está creada.
              Tienes 14 dias de prueba gratuita del plan {REGISTRO_PLANES.find(p=>p.id===plan)?.nombre}.
            </p>
            <div style={{ background:"#0f1420", borderRadius:10, padding:"16px 20px", marginBottom:24, textAlign:"left" }}>
              <div style={{ fontSize:12, color:"#64748b", textTransform:"uppercase", letterSpacing:".07em", marginBottom:8 }}>
                Tus credenciales de acceso
              </div>
              <div style={{ fontSize:14, color:"#94a3b8" }}>Email: <strong style={{ color:"#e2e8f0", fontFamily:"'JetBrains Mono',monospace" }}>{form.email}</strong></div>
              <div style={{ fontSize:14, color:"#94a3b8", marginTop:4 }}>Contraseña: la que acabas de crear</div>
            </div>
            <a href="/" style={{ display:"inline-block", padding:"14px 48px", borderRadius:10, background:"#3b82f6",
              color:"#fff", fontSize:15, fontWeight:700, textDecoration:"none", fontFamily:"'DM Sans',sans-serif" }}>
              Entrar a TransGest →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
