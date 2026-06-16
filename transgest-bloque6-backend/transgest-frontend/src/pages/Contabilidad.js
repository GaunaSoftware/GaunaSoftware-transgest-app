import { useCallback, useEffect, useState } from "react";
import { getAccountingLaunch } from "../services/api";

export default function Contabilidad() {
  const [state, setState] = useState({
    status: "loading",
    message: "Preparando acceso a TransGest Contabilidad...",
    launchUrl: "",
  });

  const refreshLaunchUrl = useCallback(async () => {
    const data = await getAccountingLaunch();
    if (!data?.launch_url) throw new Error("El backend no devolvio una URL de Contabilidad.");
    setState({
      status: "ready",
      message: "El navegador ha bloqueado la apertura automatica. Puedes continuar desde aqui.",
      launchUrl: data.launch_url,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer = null;

    async function refresh() {
      try {
        await refreshLaunchUrl();
      } catch (err) {
        if (cancelled) return;
        setState({
          status: err.status === 403 ? "denied" : "error",
          message: err.message || "No se pudo abrir TransGest Contabilidad.",
          launchUrl: "",
        });
      }
    }

    const handleLaunchUrl = (event) => {
      if (!event.detail) return;
      setState({
        status: "ready",
        message: "El navegador ha bloqueado la apertura automatica. Puedes continuar desde aqui.",
        launchUrl: event.detail,
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("tms:accounting-launch-url", handleLaunchUrl);
    document.addEventListener("visibilitychange", handleVisibility);

    refresh();
    refreshTimer = setInterval(refresh, 60000);

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      window.removeEventListener("tms:accounting-launch-url", handleLaunchUrl);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshLaunchUrl]);

  return (
    <div style={{
      minHeight:"100%", display:"flex", alignItems:"center", justifyContent:"center",
      padding:32, fontFamily:"'DM Sans',sans-serif", color:"#17211d",
    }}>
      <section style={{
        width:"min(520px,100%)", background:"#fff", border:"1px solid #dce4e2",
        borderRadius:8, padding:26, boxShadow:"0 18px 42px rgba(23,33,29,.08)",
      }}>
        <h1 style={{ margin:"0 0 8px", fontSize:24 }}>TransGest Contabilidad</h1>
        <p style={{ margin:"0 0 18px", color:"#66736f", lineHeight:1.55 }}>
          {state.message}
        </p>
        {state.status === "loading" && (
          <div style={{ height:4, borderRadius:99, overflow:"hidden", background:"#edf2f7" }}>
            <div style={{ width:"45%", height:"100%", background:"#0f766e" }} />
          </div>
        )}
        {state.status !== "loading" && (
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {state.launchUrl && (
              <a
                href={state.launchUrl}
                style={{
                  border:"1px solid #0f766e", background:"#0f766e", color:"#fff",
                  borderRadius:6, padding:"10px 14px", fontWeight:800, cursor:"pointer",
                  textDecoration:"none",
                }}
              >
                Abrir Contabilidad
              </a>
            )}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"dashboard" }))}
              style={{
                border:"1px solid #dce4e2", background:"#f8fafc", color:"#17211d",
                borderRadius:6, padding:"10px 14px", fontWeight:800, cursor:"pointer",
              }}
            >
              Volver al dashboard
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
