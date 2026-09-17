import { useState, useEffect } from "react";
import { getTallerSolicitudes, getTallerSolicitudCapacidades, crearTallerSolicitud } from "../../services/api";


import { notify } from "../../services/notify";



import { DriverHeading } from "./DriverUI";

import { leerSolicitudesCache, guardarSolicitudesCache, createDriverOfflineActions, esErrorOffline } from "./driverSupport";
const MOTIVOS_AVERIA = [
  { id:"neumatico_pinchado",  l:"Neumático pinchado" },
  { id:"averia_motor",        l:"Avería motor" },
  { id:"frenos",              l:"Problema frenos" },
  { id:"luces_electrico",     l:"Luces / eléctrico" },
  { id:"caja_cambios",        l:"Caja de cambios" },
  { id:"sistema_hidraulico",  l:"Sistema hidráulico" },
  { id:"accidente_golpe",     l:"Accidente / golpe" },
  { id:"remolque_semirremolque", l:"Problema remolque" },
  { id:"temperatura_motor",   l:"Temperatura motor" },
  { id:"otro",                l:"Otro motivo" },
];

const ESTADO_SOLICITUD_TALLER = {
  pendiente: { l:"Pendiente", c:"#f59e0b", bg:"rgba(245,158,11,.14)" },
  revisada: { l:"Revisada", c:"#3b82f6", bg:"rgba(59,130,246,.14)" },
  en_proceso: { l:"En taller", c:"#a78bfa", bg:"rgba(167,139,250,.16)" },
  resuelto: { l:"Resuelta", c:"#10b981", bg:"rgba(16,185,129,.14)" },
  cerrado: { l:"Cerrada", c:"#10b981", bg:"rgba(16,185,129,.14)" },
  cancelado: { l:"Cancelada", c:"#ef4444", bg:"rgba(239,68,68,.12)" },
};

function metaSolicitudTaller(estado) {
  return ESTADO_SOLICITUD_TALLER[String(estado || "pendiente").toLowerCase()] || ESTADO_SOLICITUD_TALLER.pendiente;
}

function emitirSyncSolicitudesTaller() {
  try {
    window.dispatchEvent(new CustomEvent("taller:solicitudes-sync"));
  } catch {}
}

function SolicitudMecanico({ chofer, vehiculo, solicitudes = [], onEnviado, onSolicitudesSync }) {
  const [{encolarOffline}] = useState(createDriverOfflineActions);
  const [motivo,   setMotivo]   = useState("");
  const [obs,      setObs]      = useState("");
  const [urgencia, setUrgencia] = useState("normal"); // normal | urgente | critica
  const [capacidades, setCapacidades] = useState(null);
  const [canal, setCanal] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [enviado,  setEnviado]  = useState(false);
  const [historial, setHistorial] = useState(() => Array.isArray(solicitudes) && solicitudes.length ? solicitudes.slice(0, 50) : []);

  useEffect(()=>{
    let alive = true;
    Promise.all([
      getTallerSolicitudes().catch(() => []),
      getTallerSolicitudCapacidades().catch(() => null),
    ]).then(([remotas, caps]) => {
      if (!alive) return;
      if (caps) {
        setCapacidades(caps);
        const nextCanal = caps.puede_mecanico ? "mecanico" : caps.puede_taller_externo ? "taller_externo" : "";
        setCanal(prev => prev || nextCanal);
        const proveedores = Array.isArray(caps.proveedores) ? caps.proveedores : [];
        if (proveedores[0]?.id) setProveedorId(prev => prev || proveedores[0].id);
      }
      if (Array.isArray(remotas)) {
        const synced = guardarSolicitudesCache(remotas);
        setHistorial(synced);
        onSolicitudesSync?.(synced);
      }
    }).catch(()=>{
      const local = leerSolicitudesCache();
      if (alive && local.length) setHistorial(local);
    });
    return () => { alive = false; };
  },[onSolicitudesSync]);

  useEffect(() => {
    if (Array.isArray(solicitudes) && solicitudes.length) {
      setHistorial(guardarSolicitudesCache(solicitudes));
    }
  }, [solicitudes]);

  async function enviar() {
    if (!motivo) { notify("Selecciona el motivo de la avería", "warning"); return; }
    const puedeMecanico = !!capacidades?.puede_mecanico;
    const puedeTallerExterno = !!capacidades?.puede_taller_externo;
    if (!puedeMecanico && !puedeTallerExterno) {
      notify("No hay mecánicos ni talleres externos configurados para recibir solicitudes.", "warning");
      return;
    }
    const canalSolicitud = canal || (puedeMecanico ? "mecanico" : "taller_externo");
    if (canalSolicitud === "taller_externo" && !proveedorId && Array.isArray(capacidades?.proveedores) && capacidades.proveedores.length > 1) {
      notify("Selecciona el taller externo.", "warning");
      return;
    }
    const solicitud = {
      id: "sol_"+Date.now(),
      chofer_nombre: chofer?.nombre || "Chófer",
      chofer_id: chofer?.id,
      vehiculo: vehiculo?.matricula || "-",
      motivo,
      motivo_label: MOTIVOS_AVERIA.find(m=>m.id===motivo)?.l || motivo,
      observaciones: obs,
      urgencia,
      canal: canalSolicitud,
      proveedor_id: canalSolicitud === "taller_externo" ? (proveedorId || capacidades?.proveedores?.[0]?.id || "") : "",
      fecha: new Date().toISOString(),
      estado: "pendiente",
      pedido_numero: vehiculo?.numero,
      vehiculo_id: vehiculo?.vehiculo_id || vehiculo?.id || null,
      vehiculo_matricula: vehiculo?.vehiculo_matricula || vehiculo?.matricula || "",
      ubicacion: vehiculo?.ubicacion_actual || vehiculo?.destino || vehiculo?.origen || "",
    };
    if (solicitud.vehiculo_matricula) solicitud.vehiculo = solicitud.vehiculo_matricula;
    const nextLocal = [solicitud, ...historial].slice(0, 50);
    try {
      const created = await crearTallerSolicitud(solicitud);
      const remotas = await getTallerSolicitudes().catch(()=>[created, ...historial].slice(0, 50));
      const merged = Array.isArray(remotas) ? remotas : nextLocal;
      const synced = guardarSolicitudesCache(merged);
      emitirSyncSolicitudesTaller();
      setHistorial(synced);
      onSolicitudesSync?.(synced);
      setEnviado(true);
      setMotivo(""); setObs("");
      onEnviado?.();
    } catch(e) {
      if (!esErrorOffline(e)) {
        notify(e?.message || "No se pudo enviar la solicitud al taller", "error");
        return;
      }
      const fallbackLocal = guardarSolicitudesCache(nextLocal);
      setHistorial(fallbackLocal);
      onSolicitudesSync?.(fallbackLocal);
      emitirSyncSolicitudesTaller();
      encolarOffline({
        tipo: "solicitud_taller",
        solicitud,
        dedupe_key: `solicitud_taller:${solicitud.id}`,
        fecha: new Date().toISOString(),
      });
      notify("Sin conexión: la solicitud se ha guardado y se enviará en cuanto vuelva el sistema.", "warning");
      setEnviado(true);
      setMotivo(""); setObs("");
      onEnviado?.();
    }
  }

  const inp = {background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--text)",
    padding:"10px 14px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"};
  const URGENCIA_COLORS = {normal:"#3b82f6", urgente:"#f59e0b", critica:"#ef4444"};

  return (
    <div style={{padding:"16px"}}>
      {enviado ? (
        <div style={{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.3)",
          borderRadius:12,padding:24,textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:16,marginBottom:8,fontWeight:800,color:"var(--green)"}}>OK</div>
          <div style={{fontWeight:800,fontSize:16,color:"var(--green)",marginBottom:4}}>Solicitud enviada</div>
          <div style={{fontSize:14,color:"var(--text4)",marginBottom:16}}>El equipo de taller ha sido notificado</div>
          <button onClick={()=>setEnviado(false)}
            style={{padding:"8px 20px",borderRadius:8,border:"none",background:"var(--accent)",
              color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
            Nueva solicitud
          </button>
        </div>
      ) : (
        <div className="tg-chofer-card" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:16,marginBottom:16}}>
          <DriverHeading icon="solicitud" title="Solicitar asistencia de taller"/>

          {/* Vehiculo info */}
          {vehiculo && (
            <div style={{padding:"8px 12px",background:"var(--bg3)",borderRadius:8,marginBottom:14,fontSize:14,color:"var(--text4)"}}>
              Vehículo: <strong style={{color:"var(--text)"}}>{vehiculo.matricula||vehiculo.vehiculo_matricula||"-"}</strong>
              {vehiculo.numero&&<span style={{marginLeft:8}}> - Pedido {vehiculo.numero}</span>}
            </div>
          )}

          {capacidades && !capacidades.puede_mecanico && !capacidades.puede_taller_externo && (
            <div style={{padding:"10px 12px",borderRadius:8,border:"1px solid rgba(245,158,11,.28)",background:"rgba(245,158,11,.10)",color:"#f59e0b",fontSize:14,fontWeight:800,lineHeight:1.4,marginBottom:14}}>
              La empresa no tiene mecánico interno ni talleres externos configurados. Pide a gerencia que configure al menos un canal de taller.
            </div>
          )}

          {capacidades && capacidades.puede_mecanico && capacidades.puede_taller_externo && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Enviar a</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <button type="button" onClick={()=>setCanal("mecanico")}
                  style={{padding:"10px",borderRadius:8,border:`1.5px solid ${canal==="mecanico"?"var(--accent)":"var(--border)"}`,background:canal==="mecanico"?"rgba(59,130,246,.10)":"var(--bg3)",color:canal==="mecanico"?"var(--accent)":"var(--text3)",fontSize:14,fontWeight:900,cursor:"pointer"}}>
                  Mecánico interno
                </button>
                <button type="button" onClick={()=>setCanal("taller_externo")}
                  style={{padding:"10px",borderRadius:8,border:`1.5px solid ${canal==="taller_externo"?"var(--accent)":"var(--border)"}`,background:canal==="taller_externo"?"rgba(59,130,246,.10)":"var(--bg3)",color:canal==="taller_externo"?"var(--accent)":"var(--text3)",fontSize:14,fontWeight:900,cursor:"pointer"}}>
                  Taller externo
                </button>
              </div>
            </div>
          )}

          {capacidades && !capacidades.puede_mecanico && capacidades.puede_taller_externo && (
            <div style={{padding:"9px 11px",borderRadius:8,background:"var(--accent-a08)",border:"1px solid var(--accent-a22)",color:"var(--accent-l)",fontSize:14,fontWeight:800,marginBottom:14}}>
              Se enviará a taller externo.
            </div>
          )}

          {canal === "taller_externo" && Array.isArray(capacidades?.proveedores) && capacidades.proveedores.length > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Taller externo</div>
              <select value={proveedorId} onChange={e=>setProveedorId(e.target.value)} style={inp}>
                {capacidades.proveedores.map(p => <option key={p.id || p.nombre} value={p.id || p.nombre}>{p.nombre}</option>)}
              </select>
            </div>
          )}

          {/* Urgencia */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Urgencia</div>
            <div style={{display:"flex",gap:8}}>
              {[["normal","Normal",""],["urgente","Urgente",""],["critica","Crítica",""]].map(([v,l,icon])=>(
                <button key={v} onClick={()=>setUrgencia(v)}
                  style={{flex:1,padding:"10px 6px",borderRadius:8,border:`2px solid ${urgencia===v?URGENCIA_COLORS[v]:"var(--border)"}`,
                    background:urgencia===v?`${URGENCIA_COLORS[v]}22`:"transparent",
                    color:urgencia===v?URGENCIA_COLORS[v]:"var(--text4)",
                    fontWeight:urgencia===v?800:500,fontSize:14,cursor:"pointer"}}>
                  {icon} {l}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Motivo de la avería *</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {MOTIVOS_AVERIA.map(m=>(
                <button key={m.id} onClick={()=>setMotivo(m.id)}
                  style={{padding:"10px 8px",borderRadius:8,textAlign:"left",fontSize:14,
                    border:`1.5px solid ${motivo===m.id?"var(--accent)":"var(--border)"}`,
                    background:motivo===m.id?"rgba(59,130,246,.1)":"var(--bg3)",
                    color:motivo===m.id?"var(--accent)":"var(--text3)",
                    fontWeight:motivo===m.id?700:400,cursor:"pointer"}}>
                  {m.l}
                </button>
              ))}
            </div>
          </div>

          {/* Observaciones */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>
              Describe el problema (opcional)
            </div>
            <textarea aria-label="Describe con detalle lo que ocurre..." value={obs} onChange={e=>setObs(e.target.value)}
              rows={3} placeholder="Describe con detalle lo que ocurre..."
              style={{...inp,resize:"none"}}/>
          </div>

          <button onClick={enviar} disabled={capacidades && !capacidades.puede_mecanico && !capacidades.puede_taller_externo}
            style={{width:"100%",padding:"14px",borderRadius:10,border:"none",
              background:urgencia==="critica"?"#ef4444":urgencia==="urgente"?"#f59e0b":"var(--accent)",
              color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif",opacity:capacidades && !capacidades.puede_mecanico && !capacidades.puede_taller_externo ? .55 : 1}}>
            Enviar solicitud de taller
          </button>
        </div>
      )}

      {/* Historial de solicitudes */}
      {historial.length>0 && (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:16}}>
          <div style={{fontWeight:700,fontSize:14,color:"var(--text5)",textTransform:"uppercase",marginBottom:10}}>
            Mis solicitudes recientes
          </div>
          {historial.slice(0,5).map(s=>{
            const estadoMeta = metaSolicitudTaller(s.estado);
            const eventos = Array.isArray(s.eventos) ? s.eventos.slice(-3).reverse() : [];
            return (
              <div key={s.id} style={{borderBottom:"1px solid var(--border)",padding:"9px 0"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>{s.motivo_label || s.motivo}</div>
                    <div style={{fontSize:14,color:"var(--text5)",marginTop:2}}>
                      {new Date(s.fecha || s.created_at || Date.now()).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
                      {s.vehiculo&&<span style={{marginLeft:6}}> - {s.vehiculo}</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <span style={{fontSize:12,padding:"3px 8px",borderRadius:10,fontWeight:800,background:estadoMeta.bg,color:estadoMeta.c}}>
                      {estadoMeta.l}
                    </span>
                    {s.canal && (
                      <span style={{fontSize:12,padding:"3px 8px",borderRadius:10,fontWeight:800,background:"var(--accent-a12)",color:"var(--accent-l)"}}>
                        {s.canal === "taller_externo" ? (s.proveedor_nombre || "Taller") : "Mecánico"}
                      </span>
                    )}
                    <span style={{fontSize:12,padding:"3px 8px",borderRadius:10,fontWeight:800,
                      background:s.urgencia==="critica"?"rgba(239,68,68,.15)":s.urgencia==="urgente"?"rgba(245,158,11,.15)":"rgba(59,130,246,.15)",
                      color:s.urgencia==="critica"?"#ef4444":s.urgencia==="urgente"?"#f59e0b":"var(--accent)"}}>
                      {s.urgencia || "normal"}
                    </span>
                  </div>
                </div>
                {s.observaciones&&<div style={{fontSize:14,color:"var(--text4)",marginTop:4,fontStyle:"italic"}}>"{s.observaciones}"</div>}
                {s.respuesta_taller&&(
                  <div style={{fontSize:14,color:"var(--green)",marginTop:7,background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.18)",borderRadius:8,padding:"7px 9px"}}>
                    Taller: {s.respuesta_taller}
                  </div>
                )}
                {s.orden_trabajo_numero&&(
                  <div style={{fontSize:14,color:"var(--text5)",marginTop:5}}>Orden de trabajo: {s.orden_trabajo_numero}</div>
                )}
                {eventos.length > 0 && (
                  <div style={{marginTop:7,display:"grid",gap:4}}>
                    {eventos.map((ev, idx)=>(
                      <div key={`${s.id}-ev-${idx}`} style={{fontSize:12,color:"var(--text5)"}}>
                        {new Date(ev.created_at || ev.fecha || Date.now()).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
                        {" - "}{String(ev.tipo || ev.evento || "actualizacion").replace(/\./g, " ")}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


export { SolicitudMecanico };
