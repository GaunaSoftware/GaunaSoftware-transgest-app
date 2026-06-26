import { useEffect, useState } from "react";

const BASE = process.env.REACT_APP_API_URL || "";

export default function Invitacion() {
  const token = window.location.pathname.split("/").filter(Boolean).pop();
  const [info, setInfo] = useState(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    async function cargar() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${BASE}/api/v1/auth/invitacion/${token}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Invitacion no valida");
        setInfo(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    cargar();
  }, [token]);

  async function activar(e) {
    e.preventDefault();
    if (password.length < 8) {
      setError("La contrasena debe tener al menos 8 caracteres");
      return;
    }
    if (password !== password2) {
      setError("Las contrasenas no coinciden");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/v1/auth/invitacion/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se ha podido activar la cuenta");
      setOk(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const input = {
    width:"100%", background:"#1a2035", border:"1px solid #28344f", color:"#e2e8f0",
    padding:"11px 14px", borderRadius:8, fontFamily:"'DM Sans',sans-serif",
    fontSize:14, outline:"none", boxSizing:"border-box",
  };

  return (
    <div className="tg-invitacion-page" style={{minHeight:"100vh",background:"#0f1420",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:20}}>
      <style>{`
        .tg-invitacion-page, .tg-invitacion-page * { box-sizing:border-box; }
        @media (max-width: 520px) {
          .tg-invitacion-page { align-items:flex-start !important; padding:14px !important; overflow:auto; }
          .tg-invitacion-page > div { width:100% !important; padding:24px 18px !important; }
        }
      `}</style>
      <div style={{background:"#141c2e",border:"1px solid #1c2740",borderRadius:8,padding:34,width:"min(430px,96vw)",color:"#e2e8f0"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:24,marginBottom:6}}>TransGest</div>
        <div style={{fontSize:13,color:"#64748b",marginBottom:22}}>Crear contrasena de acceso</div>

        {loading && <div style={{fontSize:13,color:"#94a3b8"}}>Comprobando invitacion...</div>}

        {!loading && error && !info && (
          <div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,padding:"12px 14px",color:"#fca5a5",fontSize:13}}>
            {error}
          </div>
        )}

        {!loading && info && ok && (
          <>
            <div style={{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.25)",borderRadius:8,padding:"12px 14px",color:"#86efac",fontSize:13,marginBottom:16}}>
              Cuenta activada. Ya puedes iniciar sesion.
            </div>
            <button onClick={()=>{ window.location.href="/"; }} style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:"#3b6ef5",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Ir al login
            </button>
          </>
        )}

        {!loading && info && !ok && (
          <form onSubmit={activar}>
            <div style={{fontSize:13,color:"#94a3b8",lineHeight:1.6,marginBottom:16}}>
              Hola {info.nombre}. Has sido invitado como <strong style={{color:"#e2e8f0"}}>{info.rol}</strong> en <strong style={{color:"#e2e8f0"}}>{info.empresa}</strong>.
            </div>
            {error && <div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,padding:"9px 12px",color:"#fca5a5",fontSize:13,marginBottom:14}}>{error}</div>}
            <label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#64748b",marginBottom:5}}>Nueva contrasena</label>
            <input style={input} type="password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus />
            <label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#64748b",marginBottom:5,marginTop:14}}>Repetir contrasena</label>
            <input style={input} type="password" value={password2} onChange={e=>setPassword2(e.target.value)} />
            <button disabled={saving} style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:"#3b6ef5",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",marginTop:20,opacity:saving?.7:1}}>
              {saving ? "Activando..." : "Activar cuenta"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
