import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { BRAND_NAME, getBrandDisplayName, getBrandVersionLabel } from "../branding";
import { getLoginBrand, getPublicAppMeta, healthCheck, requestPasswordReset } from "../services/api";
import { confirmDialog } from "../services/notify";
import { getEmpresaPlanLocal } from "../utils/planFeatures";
import { useTheme } from "../context/ThemeContext";
import transgestLogoDark from "../assets/brand/transgest_logo_dark.svg";
import transgestLogoWhite from "../assets/brand/transgest_logo_white.svg";

const IS_DEMO = process.env.REACT_APP_DEMO_MODE === "true";

const S = {
  bg: { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
        background:"var(--bg)", backgroundImage:"radial-gradient(ellipse 62% 48% at 50% -12%, rgba(20,184,166,.20) 0%, transparent 70%), radial-gradient(ellipse 40% 34% at 12% 92%, rgba(245,158,11,.10) 0%, transparent 65%)" },
  card: { width:430, background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16,
          padding:36, boxShadow:"var(--shadow)", position:"relative", overflow:"hidden" },
  logo: { textAlign:"center", marginBottom:28, display:"flex", flexDirection:"column", alignItems:"center", gap:8 },
  logoBox: { display:"flex", flexDirection:"column", alignItems:"center", gap:12, width:"100%" },
  logoImage: { width:"100%", maxWidth:290, height:"auto", display:"block" },
  companyLogoImage: { width:"100%", maxWidth:230, maxHeight:120, objectFit:"contain", display:"block" },
  logoEdition: { display:"inline-flex", alignItems:"center", minHeight:28, padding:"0 12px", borderRadius:999, background:"rgba(15,118,110,.12)", color:"#0f766e", fontSize:11, fontWeight:900, letterSpacing:".04em", border:"1px solid rgba(15,118,110,.18)" },
  logoSub:  { fontSize:12, color:"var(--text4)", marginTop:2 },
  err: { background:"rgba(240,82,82,.1)", border:"1px solid rgba(240,82,82,.25)",
         borderRadius:8, padding:"9px 12px", color:"#fca5a5", fontSize:13, marginBottom:14 },
  server: { background:"rgba(59,130,246,.08)", border:"1px solid rgba(59,130,246,.20)",
         borderRadius:8, padding:"9px 12px", color:"#93c5fd", fontSize:13, marginBottom:14 },
  label: { display:"block", fontSize:10, fontWeight:700, textTransform:"uppercase",
           letterSpacing:".07em", color:"var(--text4)", marginBottom:5 },
  input: { width:"100%", background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)",
           padding:"10px 14px", borderRadius:8, fontFamily:"'DM Sans',sans-serif",
           fontSize:14, outline:"none", boxSizing:"border-box" },
  btn: { width:"100%", background:"linear-gradient(135deg,var(--accent),var(--green))", color:"#fff", border:"none", borderRadius:8,
         padding:"12px 0", fontSize:15, fontWeight:700, cursor:"pointer",
         fontFamily:"'DM Sans',sans-serif", marginTop:4, boxShadow:"0 14px 28px rgba(15,118,110,.24)" },
  demo: { marginTop:18, padding:"12px 14px", background:"var(--bg3)", borderRadius:8,
          border:"1px solid #1c2336" },
  demoTitle: { fontSize:10, color:"var(--text4)", textTransform:"uppercase", letterSpacing:".07em", marginBottom:6 },
  demoRow:   { display:"flex", justifyContent:"space-between", fontSize:12, color:"#5b7099",
               fontFamily:"'JetBrains Mono',monospace", padding:"2px 0", cursor:"pointer" },
  footer: { textAlign:"center", marginTop:20, fontSize:11, color:"var(--text5)" },
  linkBtn: { border:"none", background:"transparent", color:"var(--accent)", fontSize:12, fontWeight:800, cursor:"pointer", padding:0, fontFamily:"'DM Sans',sans-serif" },
};

export default function Login() {
  const { login }   = useAuth();
  const { isDark } = useTheme() || {};
  const plan = getEmpresaPlanLocal();
  const brandDisplayName = getBrandDisplayName(plan);
  const [appMeta, setAppMeta] = useState(null);
  const [loginBrand, setLoginBrand] = useState(null);
  const versionLabel = getBrandVersionLabel(appMeta);
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingServer, setCheckingServer] = useState(false);
  const [serverOk, setServerOk] = useState(null);
  const [serverMessage, setServerMessage] = useState("");
  const [remember, setRemember] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");

  async function checkServerStatus() {
    setCheckingServer(true);
    try {
      const data = await healthCheck();
      const ok = String(data?.status || "").toLowerCase() === "ok";
      setServerOk(ok);
      setServerMessage(ok ? "Servidor operativo." : "El servidor no ha respondido correctamente.");
    } catch (_) {
      setServerOk(false);
      setServerMessage("No se pudo comprobar el estado del servidor.");
    } finally {
      setCheckingServer(false);
    }
  }

  useEffect(() => {
    checkServerStatus();
    getPublicAppMeta().then(setAppMeta).catch(() => {});
    try {
      const saved = JSON.parse(localStorage.getItem("tms_remember_credentials") || "null");
      if (saved?.remember) {
        setEmail(saved.email || "");
        setRemember(true);
        if (saved.password) {
          localStorage.setItem("tms_remember_credentials", JSON.stringify({ remember:true, email:saved.email || "" }));
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const identifier = email.trim();
    if (identifier.length < 3) {
      setLoginBrand(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      getLoginBrand(identifier)
        .then(data => { if (alive) setLoginBrand(data?.found ? data : null); })
        .catch(() => { if (alive) setLoginBrand(null); });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [email]);

  async function handleLogin(e) {
    e?.preventDefault();
    if (!email || !pass) { setError("Introduce usuario/email y contraseña"); return; }
    setLoading(true); setError("");
    try {
      await login(email, pass);
      try {
        if (remember) {
          localStorage.setItem("tms_remember_credentials", JSON.stringify({ remember:true, email }));
        } else {
          localStorage.removeItem("tms_remember_credentials");
        }
      } catch {}
    } catch (err) {
      const msg = String(err.message || "Credenciales incorrectas").toLowerCase().includes("credenciales incorrectas")
        ? "Credenciales incorrectas"
        : (err.message || "Credenciales incorrectas");
      setError(msg);
      if (String(err.message || "").toLowerCase().includes("credenciales incorrectas")) {
        await confirmDialog({
          title: "Credenciales incorrectas",
          message: "La combinacion de usuario/email y contrasena no es correcta. Revisa los datos e intentalo de nuevo.",
          confirmText: "Aceptar",
          cancelText: "",
          tone: "warning",
        });
      }
      if (
        String(err.message || "").includes("No se pudo conectar con el servidor") ||
        String(err.message || "").includes("problema interno del servidor")
      ) {
        setServerOk(false);
        setServerMessage("El backend no esta disponible o ha devuelto un error interno.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e) {
    e?.preventDefault();
    const identifier = String(forgotIdentifier || email || "").trim();
    if (!identifier || identifier.length < 3) {
      setForgotMessage("Indica tu usuario o email.");
      return;
    }
    setForgotLoading(true);
    setForgotMessage("");
    try {
      const data = await requestPasswordReset(identifier);
      setForgotMessage(data?.message || "Solicitud enviada. Superadmin recibira el aviso.");
    } catch (err) {
      setForgotMessage(err?.message || "No se pudo registrar la solicitud.");
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <>
    <style>{`
      .tg-login-page, .tg-login-page * { box-sizing:border-box; }
      .tg-login-card { width:min(430px, calc(100vw - 28px)) !important; }
      @media (max-width: 520px) {
        .tg-login-page { align-items:flex-start !important; padding:14px !important; overflow:auto; }
        .tg-login-card { padding:24px 18px !important; border-radius:12px !important; }
        .tg-login-card img { max-width:min(260px, 82vw) !important; }
        .tg-login-page [style*="position:fixed"],
        .tg-login-page [style*="position: fixed"] { padding:10px !important; align-items:flex-start !important; overflow:auto !important; }
        .tg-login-page form { width:100% !important; max-width:calc(100vw - 20px) !important; padding:18px !important; }
      }
    `}</style>
    <div className="tg-login-page" style={S.bg}>
      <div className="tg-login-card" style={S.card}>
        {/* Logo */}
        <div style={S.logo}>
          <div style={S.logoBox} aria-label={`${brandDisplayName} ${versionLabel}`}>
            <img
              src={loginBrand?.logo_url || (isDark ? transgestLogoWhite : transgestLogoDark)}
              alt={loginBrand?.empresa_nombre || brandDisplayName}
              style={loginBrand?.logo_url ? S.companyLogoImage : S.logoImage}
            />
            <div style={S.logoEdition}>
              {loginBrand?.portal_cliente && loginBrand?.empresa_nombre
                ? `Portal cliente - ${loginBrand.empresa_nombre}`
                : `${brandDisplayName} - ${versionLabel}`}
            </div>
          </div>
          <div style={S.logoSub}>
            {loginBrand?.empresa_nombre && !loginBrand?.portal_cliente
              ? `Acceso ${loginBrand.empresa_nombre}`
              : "Sistema de gestion de transporte"}
          </div>
        </div>

        {error && <div style={S.err}>{error}</div>}
        {serverOk === false && (
          <div style={S.server}>
            <div style={{fontWeight:800, color:"#fbbf24", marginBottom:4}}>Estado del servidor</div>
            <div style={{color:"var(--text2)"}}>
              {serverMessage || "No se pudo contactar con el backend."}
            </div>
            <button
              onClick={checkServerStatus}
              disabled={checkingServer}
              style={{marginTop:8,padding:"6px 10px",borderRadius:6,border:"1px solid rgba(59,130,246,.24)",background:"rgba(59,130,246,.10)",color:"#93c5fd",fontWeight:800,fontSize:11,cursor:checkingServer?"not-allowed":"pointer",fontFamily:"'DM Sans',sans-serif",opacity:checkingServer?0.6:1}}
            >
              {checkingServer ? "Comprobando..." : "Reintentar conexion"}
            </button>
          </div>
        )}

        <div style={{ marginBottom:14 }}>
          <label style={S.label}>Usuario o email</label>
          <input style={S.input} type="text" value={email}
            onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            placeholder="usuario o tu@empresa.com" autoFocus />
        </div>
        <div style={{ marginBottom:20 }}>
          <label style={S.label}>Contraseña</label>
          <input style={S.input} type="password" value={pass}
            onChange={e=>setPass(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            placeholder="••••••••" />
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginTop:-8,marginBottom:18,flexWrap:"wrap"}}>
          <label style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:12,color:"var(--text3)",fontWeight:700,cursor:"pointer"}}>
            <input
              type="checkbox"
              checked={remember}
              onChange={e=>{
                const next = e.target.checked;
                setRemember(next);
                if (!next) {
                  try { localStorage.removeItem("tms_remember_credentials"); } catch {}
                }
              }}
            />
            Recordar usuario en este equipo
          </label>
          <button
            type="button"
            style={S.linkBtn}
            onClick={() => {
              setForgotIdentifier(email || "");
              setForgotMessage("");
              setForgotOpen(true);
            }}
          >
            He olvidado la contraseña
          </button>
        </div>

        <button style={{ ...S.btn, opacity: loading ? .7 : 1 }}
          onClick={handleLogin} disabled={loading}>
          {loading ? "Entrando..." : "Iniciar sesión"}
        </button>

        {/* Panel demo - solo en modo demo */}
        {IS_DEMO && (
          <div style={S.demo}>
            <div style={S.demoTitle}>Accesos rápidos (entorno demo)</div>
            {["gerente","contable","trafico","visualizador"].map(rol => (
              <div key={rol} style={S.demoRow}
                onClick={()=>{ setEmail(`${rol}@empresa.com`); setPass("demo1234"); }}>
                <span style={{ textTransform:"capitalize", color:"var(--text2)" }}>{rol}</span>
                <span>{rol}@empresa.com</span>
              </div>
            ))}
          </div>
        )}

        <div style={S.footer}>
          © {new Date().getFullYear()} {BRAND_NAME} {versionLabel} · Todos los derechos reservados
        </div>
      </div>
      {forgotOpen && (
        <div style={{position:"fixed",inset:0,zIndex:8000,background:"rgba(15,20,32,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <form onSubmit={handleForgotPassword} style={{width:"min(390px,96vw)",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:22,boxShadow:"var(--shadow)"}}>
            <div style={{fontSize:17,fontWeight:900,color:"var(--text)",marginBottom:6}}>Recuperar contrasena</div>
            <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.45,marginBottom:14}}>
              Se enviara un aviso a superadmin para revisar y resetear la clave de este usuario.
            </div>
            <label style={S.label}>Usuario o email</label>
            <input
              autoFocus
              style={S.input}
              type="text"
              value={forgotIdentifier}
              onChange={e=>setForgotIdentifier(e.target.value)}
              placeholder="usuario o tu@empresa.com"
            />
            {forgotMessage && (
              <div style={{marginTop:12,fontSize:12,color:forgotMessage.includes("Solicitud") || forgotMessage.includes("recibida") ? "var(--green)" : "#fbbf24",lineHeight:1.45}}>
                {forgotMessage}
              </div>
            )}
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
              <button type="button" onClick={()=>setForgotOpen(false)} style={{padding:"8px 13px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontWeight:800,cursor:"pointer"}}>Cerrar</button>
              <button type="submit" disabled={forgotLoading} style={{padding:"8px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontWeight:900,cursor:"pointer",opacity:forgotLoading?.7:1}}>
                {forgotLoading ? "Enviando..." : "Enviar aviso"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
    </>
  );
}

