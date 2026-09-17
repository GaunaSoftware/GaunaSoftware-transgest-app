import { useState } from "react";
import { solicitarChoferVacacionesApp, firmarChoferVacacionesApp } from "../../services/api";


import { notify } from "../../services/notify";



import { DriverHeading } from "./DriverUI";

import { FirmaLaboralCanvas } from "./driverSupport";
function VacacionesChofer({ items = [], chofer, onRefresh }) {
  const [form, setForm] = useState({
    fecha_inicio: new Date().toISOString().slice(0,10),
    fecha_fin: "",
    motivo: "",
  });
  const [saving, setSaving] = useState(false);
  const [firma, setFirma] = useState(null);
  const [firmaPendiente, setFirmaPendiente] = useState(null);
  const nombreChofer = `${chofer?.nombre || ""} ${chofer?.apellidos || ""}`.trim();
  const estados = {
    pendiente: ["Pendiente", "#f59e0b"],
    aprobada_pendiente_firma: ["Aprobada, falta firma", "#3b82f6"],
    aprobada_firmada: ["Aprobada y firmada", "#10b981"],
    rechazada: ["Rechazada", "#ef4444"],
  };

  async function enviarSolicitud(firmaData) {
    setSaving(true);
    try {
      await solicitarChoferVacacionesApp({ ...form, firma: firmaData });
      setForm({ fecha_inicio: new Date().toISOString().slice(0,10), fecha_fin: "", motivo: "" });
      setFirma(null);
      notify("Solicitud de vacaciones enviada", "success");
      await onRefresh();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function firmarAceptacion(item, firmaData) {
    setSaving(true);
    try {
      await firmarChoferVacacionesApp(item.id, { firma: firmaData });
      setFirmaPendiente(null);
      notify("Hoja de vacaciones firmada", "success");
      await onRefresh();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="tg-chofer-card" style={{margin:"12px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
        <DriverHeading icon="vacaciones" title="Vacaciones"/>
        <div style={{fontSize:14,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>
          Solicita vacaciones y firma la solicitud desde la app. Si gerencia aprueba sin firma directa, aparecerá aquí para firmar la aceptación.
        </div>
        <div className="tg-chofer-vacaciones-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
          <div>
            <label style={{display:"block",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4}}>Inicio</label>
            <input aria-label="Inicio de vacaciones" type="date" value={form.fecha_inicio} onChange={e=>setForm(p=>({...p,fecha_inicio:e.target.value}))}
              style={{width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)"}} />
          </div>
          <div>
            <label style={{display:"block",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4}}>Fin</label>
            <input aria-label="Fin de vacaciones" type="date" value={form.fecha_fin} onChange={e=>setForm(p=>({...p,fecha_fin:e.target.value}))}
              style={{width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)"}} />
          </div>
        </div>
        <label style={{display:"block",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",margin:"10px 0 4px"}}>Motivo / notas</label>
        <textarea aria-label="Motivo de las vacaciones" value={form.motivo} onChange={e=>setForm(p=>({...p,motivo:e.target.value}))} placeholder="Opcional"
          style={{width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)",minHeight:70,resize:"vertical",fontFamily:"'DM Sans',sans-serif"}} />
        <button disabled={saving || !form.fecha_inicio || !form.fecha_fin} onClick={()=>setFirma("solicitud")}
          style={{width:"100%",marginTop:12,padding:"12px",borderRadius:8,border:"none",background:"var(--accent)",color:"#fff",fontSize:14,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",opacity:saving ? .6 : 1}}>
          Solicitar y firmar
        </button>
      </div>

      <div className="tg-chofer-card" style={{margin:"12px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
        <div style={{fontWeight:900,fontSize:14,color:"var(--text)",marginBottom:8}}>Mis solicitudes</div>
        {items.length === 0 ? (
          <div style={{fontSize:14,color:"var(--text5)"}}>Sin solicitudes registradas.</div>
        ) : items.map(item => {
          const [label, color] = estados[item.estado] || [item.estado || "Estado", "var(--text5)"];
          return (
            <div key={item.id} style={{borderTop:"1px solid var(--border)",padding:"10px 0"}}>
              <div className="tg-chofer-vacaciones-row" style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
                <div>
                  <div style={{fontWeight:900,fontSize:14,color:"var(--text)"}}>
                    {String(item.fecha_inicio || "").slice(0,10)} a {String(item.fecha_fin || "").slice(0,10)}
                  </div>
                  <div style={{fontSize:14,color:"var(--text4)",marginTop:2}}>{Number(item.dias || 0)} días {item.motivo ? `- ${item.motivo}` : ""}</div>
                </div>
                <span style={{fontSize:12,fontWeight:900,color,background:`${color}18`,border:`1px solid ${color}30`,borderRadius:99,padding:"3px 8px",whiteSpace:"nowrap"}}>{label}</span>
              </div>
              {item.estado === "aprobada_pendiente_firma" && (
                <button disabled={saving} onClick={()=>setFirmaPendiente(item)}
                  style={{marginTop:8,padding:"9px 11px",borderRadius:8,border:"1px solid rgba(16,185,129,.35)",background:"rgba(16,185,129,.10)",color:"#10b981",fontSize:14,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  Firmar aceptación
                </button>
              )}
              {item.observaciones && <div style={{fontSize:14,color:"var(--text4)",marginTop:6}}>Gerencia: {item.observaciones}</div>}
            </div>
          );
        })}
      </div>

      {firma && (
        <FirmaLaboralCanvas
          title="Firmar solicitud de vacaciones"
          detail={`${form.fecha_inicio} a ${form.fecha_fin}. Esta firma acredita que solicitas estos días.`}
          defaultName={nombreChofer}
          onCancel={()=>setFirma(null)}
          onFirma={enviarSolicitud}
        />
      )}
      {firmaPendiente && (
        <FirmaLaboralCanvas
          title="Firmar hoja de vacaciones"
          detail={`${String(firmaPendiente.fecha_inicio || "").slice(0,10)} a ${String(firmaPendiente.fecha_fin || "").slice(0,10)}. Firma la aceptación de vacaciones aprobadas.`}
          defaultName={nombreChofer}
          onCancel={()=>setFirmaPendiente(null)}
          onFirma={(data)=>firmarAceptacion(firmaPendiente, data)}
        />
      )}
    </div>
  );
}

function DatosChofer({ chofer = {}, user = {}, onCambiarFirma }) {
  const nombreCompleto = `${chofer?.nombre || user?.nombre || ""} ${chofer?.apellidos || ""}`.trim() || "Chófer";
  const firmaFecha = chofer?.firma_base_fecha ? new Date(chofer.firma_base_fecha).toLocaleDateString("es-ES") : "";
  const datos = [
    ["Nombre", nombreCompleto],
    ["DNI/NIE", chofer?.dni || user?.dni || "No informado"],
    ["Teléfono", chofer?.telefono || user?.telefono || "No informado"],
    ["Email", chofer?.email || user?.email || "No informado"],
    ["Tractora", chofer?.matricula || chofer?.vehiculo_matricula || "Sin asignar"],
    ["Remolque", chofer?.remolque_matricula || "Sin asignar"],
  ];

  return (
    <div className="tg-chofer-section-shell" style={{padding:"14px 16px"}}>
      <div className="tg-chofer-card" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:14,padding:16}}>
        <DriverHeading icon="datos" title="Mis datos"/>
        <div style={{fontSize:14,color:"var(--text4)",lineHeight:1.45,marginBottom:14}}>
          Revisa tus datos de chófer. Si algún dato no es correcto, solicita la modificación a tráfico o gerencia.
        </div>
        <div className="tg-chofer-datos-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {datos.map(([label, value]) => (
            <div key={label} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontSize:12,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>{label}</div>
              <div style={{fontSize:14,color:"var(--text)",fontWeight:800,overflowWrap:"anywhere"}}>{value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="tg-chofer-card" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:14,padding:16,marginTop:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)"}}>Firma</div>
            <div style={{fontSize:14,color:"var(--text4)",marginTop:2}}>
              {chofer?.firma_base ? `Guardada${firmaFecha ? ` el ${firmaFecha}` : ""}` : "Pendiente de registrar"}
            </div>
          </div>
          <span style={{padding:"5px 9px",borderRadius:999,background:chofer?.firma_base ? "rgba(16,185,129,.12)" : "rgba(245,158,11,.14)",color:chofer?.firma_base ? "#10b981" : "#d97706",fontSize:14,fontWeight:900}}>
            {chofer?.firma_base ? "Activa" : "Pendiente"}
          </span>
        </div>
        {chofer?.firma_base && (
          <div style={{background:"#fff",border:"1px solid var(--border)",borderRadius:10,padding:10,marginBottom:12,textAlign:"center"}}>
            <img src={chofer.firma_base} alt="Firma del chófer" style={{maxHeight:90,objectFit:"contain"}} />
          </div>
        )}
        <button onClick={onCambiarFirma}
          style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"none",background:"var(--accent)",color:"#fff",fontSize:14,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          {chofer?.firma_base ? "Cambiar firma" : "Registrar firma"}
        </button>
      </div>
    </div>
  );
}


export { VacacionesChofer, DatosChofer };
