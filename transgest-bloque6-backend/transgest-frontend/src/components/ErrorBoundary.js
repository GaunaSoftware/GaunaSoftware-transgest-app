import React from "react";
import { removeToken } from "../services/api";
import { downloadIncidentReport, rememberFrontendIncident } from "../services/incidents";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, incident: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const incident = rememberFrontendIncident(error, info, { source: "error_boundary" });
    this.setState({ info, incident });
    console.error("Error no controlado en TransGest:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error?.message || "Error inesperado";
    const isDev = process.env.NODE_ENV !== "production";
    const incident = this.state.incident;

    return (
      <div style={{
        minHeight:"100vh",
        background:"var(--bg,#f4f7f6)",
        color:"var(--text,#14211d)",
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        padding:24,
        fontFamily:"'DM Sans', Arial, sans-serif",
      }}>
        <div style={{
          width:"min(620px,96vw)",
          background:"var(--bg2,#fff)",
          border:"1px solid var(--border,#d8e5e1)",
          borderRadius:12,
          padding:24,
          boxShadow:"0 22px 70px rgba(15,23,42,.12)",
        }}>
          <div style={{fontFamily:"'Syne',Arial,sans-serif",fontSize:22,fontWeight:900,marginBottom:8}}>
            No se ha podido cargar esta pantalla
          </div>
          <p style={{margin:"0 0 16px",color:"var(--text3,#587068)",lineHeight:1.5}}>
            Hemos protegido la aplicacion para que no se quede en blanco. Recarga la pantalla y, si vuelve a pasar, revisa el ultimo cambio realizado.
          </p>
          {incident?.id && (
            <div style={{
              background:"var(--bg3,#eef4f2)",
              border:"1px solid var(--border,#d8e5e1)",
              borderRadius:8,
              padding:"10px 12px",
              marginBottom:12,
              fontSize:13,
              color:"var(--text2,#263b34)",
              fontWeight:800,
            }}>
              Codigo de incidencia: {incident.id}
            </div>
          )}
          {isDev && (
            <pre style={{
              whiteSpace:"pre-wrap",
              background:"var(--bg3,#eef4f2)",
              border:"1px solid var(--border,#d8e5e1)",
              borderRadius:8,
              padding:12,
              maxHeight:220,
              overflow:"auto",
              fontSize:12,
              color:"var(--text2,#263b34)",
            }}>{message}</pre>
          )}
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:16}}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{border:0,borderRadius:8,background:"#0f766e",color:"#fff",padding:"10px 14px",fontWeight:800,cursor:"pointer"}}
            >
              Recargar
            </button>
            {incident && (
              <button
                type="button"
                onClick={() => downloadIncidentReport(incident)}
                style={{border:"1px solid var(--border,#d8e5e1)",borderRadius:8,background:"var(--bg3,#f8fafc)",color:"var(--text,#14211d)",padding:"10px 14px",fontWeight:800,cursor:"pointer"}}
              >
                Descargar incidencia
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                try { localStorage.removeItem("tms_bloqueado"); } catch {}
                removeToken();
                window.location.href = "/";
              }}
              style={{border:"1px solid var(--border,#d8e5e1)",borderRadius:8,background:"transparent",color:"var(--text,#14211d)",padding:"10px 14px",fontWeight:800,cursor:"pointer"}}
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}
