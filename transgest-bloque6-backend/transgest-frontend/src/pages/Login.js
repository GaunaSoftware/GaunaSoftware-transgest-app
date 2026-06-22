import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { BRAND_NAME, getBrandDisplayName, getBrandVersionLabel } from "../branding";
import { getLoginBrand, getPublicAppMeta, healthCheck } from "../services/api";
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
    } catch (err) {
      const apiError = typeof window !== "undefined" ? window.__TMS_LAST_API_ERROR : null;
      const hint = apiError?.request_id ? ` Codigo: ${apiError.request_id}.` : "";
      const msg = (err.message || "Credenciales incorrectas") + hint;
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

  return (
    <div style={S.bg}>
      <div style={S.card}>
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
    </div>
  );
}

