import { notify } from "../services/notify";
import { getToken, removeToken } from "../services/api";

const BASE = process.env.REACT_APP_API_URL || "";

export default function Bloqueado({ motivo, mensaje, user }) {
  const esGerente = user?.rol === "gerente";

  async function pagarAhora() {
    try {
      const token = getToken();
      const res = await fetch(`${BASE}/api/v1/auth/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se ha podido abrir el pago");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      notify(err.message || "No se ha podido abrir el pago", "error");
    }
  }

  return (
    <div style={{
      minHeight:"100vh", background:"var(--bg)",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'DM Sans',sans-serif", padding:24,
    }}>
      <div style={{
        maxWidth:500, width:"100%",
        background:"var(--bg2)", border:"1px solid var(--border)",
        borderRadius:8, padding:"38px 34px", textAlign:"center",
      }}>
        <div style={{ fontSize:42, marginBottom:16 }}>!</div>

        <div style={{
          fontFamily:"'Syne',sans-serif", fontWeight:900,
          fontSize:22, color:"var(--text)", marginBottom:10,
        }}>
          {motivo === "cancelado" ? "Cuenta cancelada"
           : motivo === "suspendido" ? "Cuenta suspendida"
           : motivo === "impago" ? "Pago pendiente"
           : "Suscripcion bloqueada"}
        </div>

        <div style={{
          fontSize:14, color:"var(--text4)", lineHeight:1.7,
          marginBottom:24, padding:"0 8px",
        }}>
          {mensaje || "Hay un problema con la facturacion y no se puede utilizar el programa."}
        </div>

        {esGerente ? (
          <div style={{
            background:"rgba(59,130,246,.06)", border:"1px solid rgba(59,130,246,.15)",
            borderRadius:8, padding:"14px 18px", marginBottom:24, textAlign:"left",
          }}>
            <div style={{ fontSize:12, fontWeight:700, color:"var(--accent)", marginBottom:8, textTransform:"uppercase", letterSpacing:".06em" }}>
              Pago de la suscripcion
            </div>
            <div style={{ fontSize:13, color:"var(--text3)", lineHeight:1.6 }}>
              Puedes abrir el pago seguro de Stripe. Cuando se confirme el pago, TransGestAdmin podra reactivar la cuenta automaticamente mediante el webhook de Stripe.
            </div>
          </div>
        ) : (
          <div style={{
            background:"rgba(245,158,11,.08)", border:"1px solid rgba(245,158,11,.2)",
            borderRadius:8, padding:"14px 18px", marginBottom:24, textAlign:"left",
            fontSize:13, color:"var(--text3)", lineHeight:1.6,
          }}>
            Tu gerente debe revisar el pago de la suscripcion. Hasta que se reactive la cuenta no se pueden crear pedidos, emitir facturas, descargar datos ni usar el programa.
          </div>
        )}

        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {esGerente && (
            <button onClick={pagarAhora}
              style={{
                padding:"13px 0", borderRadius:8, border:"none",
                background:"var(--accent)", color:"#fff",
                fontWeight:700, fontSize:15, cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",
              }}>
              Pagar ahora
            </button>
          )}
          <a href="mailto:soporte@transgest.com?subject=Renovacion%20de%20suscripcion"
            style={{
              display:"block", padding:"11px 0", borderRadius:8,
              border:"1px solid var(--border2)", background:"transparent",
              color:"var(--text3)", fontWeight:700, fontSize:13,
              textDecoration:"none", fontFamily:"'DM Sans',sans-serif",
            }}>
            Contactar con soporte
          </a>
          <button
            onClick={() => {
              try { localStorage.removeItem("tms_bloqueado"); } catch {}
              removeToken();
              window.location.href = "/";
            }}
            style={{
              padding:"10px 0", borderRadius:8, border:"1px solid var(--border2)",
              background:"transparent", color:"var(--text4)",
              fontFamily:"'DM Sans',sans-serif", fontSize:13,
              fontWeight:600, cursor:"pointer", width:"100%",
            }}>
            Cerrar sesion
          </button>
        </div>

        <div style={{ marginTop:20, fontSize:11, color:"var(--text5)" }}>
          TransGest TMS | soporte@transgest.com
        </div>
      </div>
    </div>
  );
}
