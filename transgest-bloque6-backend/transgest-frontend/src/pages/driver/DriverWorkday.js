import { useState, useEffect, useCallback } from "react";
import { iniciarChoferJornada, cambiarChoferJornadaActividad, cerrarChoferJornada, getChoferConjuntoApp, cambiarChoferConjuntoApp } from "../../services/api";


import { notify } from "../../services/notify";



import { DriverHeading } from "./DriverUI";

import { Mini } from "./driverSupport";
function ConjuntoChofer({ onRefresh }) {
  const [data, setData] = useState(null);
  const [vehiculoId, setVehiculoId] = useState("");
  const [remolqueId, setRemolqueId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const S = {
    card:{margin:"12px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14},
    btn:{padding:"10px 12px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:14},
    input:{width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)",fontFamily:"'DM Sans',sans-serif"},
    label:{display:"block",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",margin:"10px 0 4px"},
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getChoferConjuntoApp();
      setData(res);
      setVehiculoId(res?.conjunto?.vehiculo_id || "");
      setRemolqueId(res?.conjunto?.remolque_id || "");
    } catch (e) {
      setData({ error: e.message || "No se pudo cargar el conjunto" });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const tractoras = Array.isArray(data?.tractoras) ? data.tractoras : [];
  const remolques = Array.isArray(data?.remolques) ? data.remolques : [];
  const tractorasVisibles = tractoras.filter(v => !v.ocupada || String(v.id) === String(data?.conjunto?.vehiculo_id || ""));
  const remolquesVisibles = remolques.filter(r => !r.ocupado || String(r.id) === String(data?.conjunto?.remolque_id || ""));
  async function guardar() {
    setSaving(true);
    try {
      await cambiarChoferConjuntoApp({ vehiculo_id: vehiculoId || null, remolque_id: remolqueId || null });
      notify("Conjunto actualizado. Tráfico queda avisado.", "success");
      await load();
      await onRefresh?.();
    } catch (e) {
      notify(e.message || "No se pudo cambiar el conjunto", "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="tg-chofer-card" style={S.card}>
      <DriverHeading icon="activos" title="Mi conjunto"/>
      <div style={{fontSize:14,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>
        Puedes seleccionar una tractora y remolque libres. Si necesitas mover un equipo ocupado, lo revisa tráfico.
      </div>
      {loading ? (
        <div style={{fontSize:14,color:"var(--text4)",marginTop:10}}>Cargando conjunto...</div>
      ) : data?.error ? (
        <div style={{fontSize:14,color:"#ef4444",marginTop:10}}>{data.error}</div>
      ) : (
        <>
          <label style={S.label} htmlFor="driver-tractor">Tractora</label>
          <select id="driver-tractor" style={S.input} value={vehiculoId} onChange={e => { setVehiculoId(e.target.value); if (!e.target.value) setRemolqueId(""); }}>
            <option value="">Sin tractora</option>
            {tractorasVisibles.map(v => (
              <option key={v.id} value={v.id}>{v.matricula || "Sin matrícula"}</option>
            ))}
          </select>
          <label style={S.label} htmlFor="driver-trailer">Remolque</label>
          <select id="driver-trailer" style={S.input} value={remolqueId} onChange={e => setRemolqueId(e.target.value)} disabled={!vehiculoId}>
            <option value="">Sin remolque</option>
            {remolquesVisibles.map(r => (
              <option key={r.id} value={r.id}>{r.matricula || "Sin matrícula"}</option>
            ))}
          </select>
          <button disabled={saving} onClick={guardar} style={{...S.btn,width:"100%",marginTop:12,background:"var(--accent)",color:"#fff",borderColor:"var(--accent)",opacity:saving?0.65:1}}>
            {saving ? "Guardando..." : "Actualizar conjunto"}
          </button>
        </>
      )}
    </div>
  );
}

function JornadaChofer({ jornadaInfo, gpsSeguimientoEstado, onRefresh }) {
  const jornada = jornadaInfo?.jornada || null;
  const chofer = jornadaInfo?.chofer || null;
  const resumen = jornada?.resumen || {};
  const [confirmed, setConfirmed] = useState(false);
  useEffect(()=>setConfirmed(false),[chofer?.vehiculo_id,chofer?.vehiculo_remolque_id,jornada?.id]);
  const [kmInicio, setKmInicio] = useState("");
  const [kmFin, setKmFin] = useState("");
  const [haceNoche, setHaceNoche] = useState(false);
  const [nocheLugar, setNocheLugar] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const S = {
    card:{margin:"12px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14},
    btn:{padding:"10px 12px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:14},
    input:{width:"100%",boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)",fontFamily:"'DM Sans',sans-serif"},
    label:{display:"block",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",margin:"10px 0 4px"},
  };
  const fmtMin = (m=0) => {
    const mins = Math.max(0, Number(m || 0));
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return h ? `${h}h ${String(r).padStart(2,"0")}m` : `${r}m`;
  };
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const liveExtra = (() => {
    const base = new Date(resumen.calculado_at || Date.now()).getTime();
    if (!Number.isFinite(base) || tick <= base) return 0;
    return Math.floor((tick - base) / 60000);
  })();
  const actividadActual = jornada?.actividad_actual || "";
  const conduccionDesdePausaLive = Number(resumen.conduccion_desde_pausa_min || 0) + (actividadActual === "conduccion" ? liveExtra : 0);
  const conduccionHoyLive = Number(resumen.conduccion_min || 0) + (actividadActual === "conduccion" ? liveExtra : 0);
  const pausaActualLive = Number(resumen.pausa_actual_min || 0) + (["pausa","descanso"].includes(actividadActual) ? liveExtra : 0);
  const descansoActualLive = Number(resumen.descanso_diario_actual_min || 0) + (actividadActual === "descanso" ? liveExtra : 0);
  const proximaPausaLive = Math.max(0, Number(resumen.limites?.conduccionContinuaMin || 270) - conduccionDesdePausaLive);
  const puedeArrancarLive = proximaPausaLive > 0 && conduccionHoyLive < Number(resumen.limites?.conduccionDiariaExtendidaMin || 600);
  const pausaRestanteLive = Math.max(0, Number(resumen.limites?.pausaCompletaMin || 45) - pausaActualLive);
  const descanso9RestanteLive = Math.max(0, Number(resumen.limites?.descansoDiarioReducidoMin || 540) - descansoActualLive);
  const descanso11RestanteLive = Math.max(0, Number(resumen.limites?.descansoDiarioNormalMin || 660) - descansoActualLive);
  const eventos = Array.isArray(jornada?.eventos) ? jornada.eventos : [];
  const actividadLabel = (v) => v === "conduccion" ? "Conducción" : v === "pausa" ? "Pausa" : v === "descanso" ? "Descanso" : v === "disponibilidad" ? "Disponibilidad" : v === "fin" ? "Fin" : "Otros trabajos";
  async function run(fn) {
    setSaving(true);
    try {
      await fn();
      await onRefresh();
      return true;
    } catch (e) {
      notify(e.message, "error");
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function cambiarActividad(actividad, payload = {}) {
    if (jornada?.actividad_actual === actividad) {
      notify(`Ya estas en ${actividadLabel(actividad).toLowerCase()}.`, "warning");
      return;
    }
    return run(()=>cambiarChoferJornadaActividad({ actividad, ...payload }));
  }
  function kmValido(value, label) {
    const raw = String(value || "").trim().replace(",", ".");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 0) {
      notify(`${label} es obligatorio y debe ser un numero valido.`, "warning");
      return null;
    }
    return Math.round(n * 10) / 10;
  }
  function confirmedSet() {
    if(!confirmed || !chofer?.vehiculo_id) { notify("Selecciona y confirma tu conjunto antes de continuar.", "warning"); return null; }
    return { conjunto_confirmado:true, vehiculo_id:chofer.vehiculo_id, remolque_id:chofer.vehiculo_remolque_id || null };
  }
  async function iniciarJornadaConKm() {
    const conjunto=confirmedSet(); if(!conjunto) return;
    const km = kmValido(kmInicio, "Km inicio");
    if (km == null) return;
    await run(()=>iniciarChoferJornada({ ...conjunto, km_inicio: km, actividad:"otros_trabajos", notas }));
  }
  async function cerrarJornadaCompleta() {
    const km = kmValido(kmFin, "Km cierre");
    if (km == null) return;
    const conjunto=confirmedSet(); if(!conjunto) return;
    if(km < Number(jornada.km_inicio)+1) { notify("El cierre debe superar a la apertura en al menos 1 km.","warning"); return; }
    const ok=await run(()=>cerrarChoferJornada({ ...conjunto, km_fin:km, hace_noche:haceNoche, noche_lugar:nocheLugar||null, notas }));
    if(ok) { setKmFin("");setKmInicio("");setConfirmed(false);notify("Jornada cerrada y descanso registrado.","success"); }

  }
  return (
    <div>
      <div className="tg-chofer-card" style={S.card}>
        <DriverHeading icon="jornada" title="Registro de jornada"/>
        <span className="driver-status">{jornada ? "Jornada en curso" : "Jornada sin iniciar"}</span>
        {jornada && <div className="driver-jornada-summary"><Mini label="Inicio de jornada" value={jornada.inicio_at ? new Date(jornada.inicio_at).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "Sin registro"}/><Mini label="Tiempo transcurrido" value={jornada.inicio_at && Number.isFinite(new Date(jornada.inicio_at).getTime()) ? fmtMin(Math.floor(Math.max(0,tick-new Date(jornada.inicio_at).getTime())/60000)) : "Sin registro"}/></div>}
        <div style={{fontSize:14,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>
          Registro interno de jornada y asistente de tiempos. No sustituye al tacógrafo legal del vehículo.
        </div>
        <details className="driver-details"><summary>Información del registro y GPS</summary>
        {gpsSeguimientoEstado?.text && (
          <div style={{
            marginTop:10,
            padding:"8px 10px",
            borderRadius:8,
            border:`1px solid ${gpsSeguimientoEstado.active ? "rgba(16,185,129,.28)" : "rgba(245,158,11,.28)"}`,
            background:gpsSeguimientoEstado.active ? "rgba(16,185,129,.10)" : "rgba(245,158,11,.10)",
            color:gpsSeguimientoEstado.active ? "#10b981" : "#f59e0b",
            fontSize:14,
            fontWeight:900,
          }}>
            {gpsSeguimientoEstado.text}
          </div>
        )}
        {chofer && (
          <div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <Mini label="Chofer" value={`${chofer.nombre || ""} ${chofer.apellidos || ""}`.trim()} />
            <Mini label="Conjunto" value={`${chofer.vehiculo_matricula || "Sin tractora"}${chofer.remolque_matricula ? ` + ${chofer.remolque_matricula}` : ""}`} />
          </div>
        )}
        </details>
      </div>
      <details className="driver-card driver-set-editor"><summary><strong>Mi conjunto</strong><span>{chofer?.vehiculo_matricula || "Selecciona tractora"}{chofer?.remolque_matricula ? " · " + chofer.remolque_matricula : ""}</span><span>Cambiar conjunto</span></summary><ConjuntoChofer onRefresh={onRefresh}/></details>
      <label className="driver-set-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Confirmo que trabajo con {chofer?.vehiculo_matricula || "la tractora seleccionada"}{chofer?.remolque_matricula ? " y el remolque " + chofer.remolque_matricula : " sin remolque"}.</span></label>
      {!jornada ? (
        <div className="tg-chofer-card" style={S.card}>
          <DriverHeading icon="jornada" title="Iniciar jornada"/><label style={S.label}>Kilómetros al iniciar</label>
          <input aria-label="Kilómetros al iniciar" type="number" style={S.input} value={kmInicio} onChange={e=>setKmInicio(e.target.value)} placeholder={chofer?.km_actuales ? String(chofer.km_actuales) : "Kilómetros actuales"} />
          <label style={S.label}>Notas de inicio</label>
          <input aria-label="Base, incidencia inicial, observaciones..." style={S.input} value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Base, incidencia inicial, observaciones..." />
          <button disabled={saving} onClick={iniciarJornadaConKm} style={{...S.btn,width:"100%",marginTop:12,background:"var(--accent)",color:"#fff",borderColor:"var(--accent)"}}>
            Iniciar jornada
          </button>
        </div>
      ) : (
        <>
          <div className="tg-chofer-card" style={S.card}>
            <DriverHeading icon="jornada" title="Tiempos de conducción y descanso"/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
              <Mini label="Actividad" value={actividadLabel(jornada.actividad_actual)} />
              <Mini label="Desde" value={resumen.actividad_actual_desde ? new Date(resumen.actividad_actual_desde).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}) : "-"} />
              <Mini label="Conduccion hoy" value={fmtMin(conduccionHoyLive)} />
              <Mini label="Desde pausa" value={fmtMin(conduccionDesdePausaLive)} />
            </div>
            <div style={{marginTop:10,padding:"9px 10px",borderRadius:8,background:puedeArrancarLive?"rgba(16,185,129,.10)":"rgba(239,68,68,.10)",border:`1px solid ${puedeArrancarLive?"rgba(16,185,129,.25)":"rgba(239,68,68,.25)"}`,color:puedeArrancarLive?"#10b981":"#ef4444",fontWeight:800,fontSize:14}}>
              {puedeArrancarLive ? `Puede conducir. Proxima pausa en ${fmtMin(proximaPausaLive)}.` : "No debería iniciar conducción hasta realizar la pausa/descanso necesario."}
            </div>
            <div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <Mini label="Pausa actual" value={["pausa","descanso"].includes(actividadActual) ? `${fmtMin(pausaActualLive)} / faltan ${fmtMin(pausaRestanteLive)}` : "-"} />
              <Mini label="Descanso diario" value={actividadActual === "descanso" ? `9h: ${fmtMin(descanso9RestanteLive)} | 11h: ${fmtMin(descanso11RestanteLive)}` : "-"} />
            </div>
            <div style={{marginTop:8,fontSize:14,color:"var(--text4)",lineHeight:1.45}}>
              Pausa válida: 45 minutos seguidos o partida 15 + 30. Descanso diario: 11h normal o 9h reducido cuando proceda.
            </div>
            {Array.isArray(resumen.avisos) && resumen.avisos.map((a,idx)=>(
              <div key={idx} style={{marginTop:8,fontSize:14,color:"#f59e0b",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.22)",borderRadius:8,padding:"8px 10px",lineHeight:1.4}}>{a}</div>
            ))}
          </div>
          <div className="tg-chofer-card" style={{...S.card,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button disabled={saving || !puedeArrancarLive} onClick={()=>cambiarActividad("conduccion")} style={{...S.btn,background:"rgba(249,115,22,.12)",color:"#f97316",borderColor:"rgba(249,115,22,.25)",opacity:puedeArrancarLive?1:.55}}>Conducir</button>
            <button disabled={saving} onClick={()=>cambiarActividad("pausa", { notas:"Pausa 45 min o pausa partida 15 + 30" })} style={{...S.btn,background:"rgba(16,185,129,.12)",color:"#10b981",borderColor:"rgba(16,185,129,.25)"}}>Pausa 45 / partida</button>
            <button disabled={saving} onClick={()=>cambiarActividad("descanso", { objetivo_descanso_min:540, notas:"Descanso diario reducido 9h" })} style={{...S.btn,background:"rgba(59,130,246,.10)",color:"#3b82f6",borderColor:"rgba(59,130,246,.25)"}}>Descanso 9h</button>
            <button disabled={saving} onClick={()=>cambiarActividad("descanso", { objetivo_descanso_min:660, notas:"Descanso diario normal 11h" })} style={{...S.btn,background:"rgba(59,130,246,.10)",color:"#3b82f6",borderColor:"rgba(59,130,246,.25)"}}>Descanso 11h</button>
            <button disabled={saving} onClick={()=>cambiarActividad("disponibilidad")} style={S.btn}>Disponibilidad</button>
            <button disabled={saving} onClick={()=>cambiarActividad("otros_trabajos")} style={S.btn}>Otros trabajos</button>
          </div>
          {eventos.length > 0 && (
            <div className="tg-chofer-card" style={S.card}>
              <div style={{fontWeight:900,fontSize:14,color:"var(--text)",marginBottom:8}}>Registro de eventos</div>
              <div style={{display:"grid",gap:7}}>
                {eventos.slice(-8).reverse().map((ev, idx)=>(
                  <div key={`${ev.at || idx}-${idx}`} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:14,color:"var(--text3)",borderBottom:idx===Math.min(7,eventos.length-1)?"none":"1px solid var(--border)",paddingBottom:6}}>
                    <span style={{fontWeight:800,color:"var(--text)"}}>{actividadLabel(ev.tipo)}{ev.objetivo_descanso_min ? ` ${fmtMin(ev.objetivo_descanso_min)}` : ""}</span>
                    <span>{ev.at ? new Date(ev.at).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "-"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="tg-chofer-card" style={S.card}>
            <DriverHeading icon="jornada" title="Finalizar jornada"/><label style={S.label}>Kilómetros al terminar</label>
            <input aria-label="Kilómetros al terminar" type="number" style={S.input} value={kmFin} onChange={e=>setKmFin(e.target.value)} placeholder="Kilómetros al terminar" />
            <label style={{display:"flex",gap:8,alignItems:"center",fontSize:14,color:"var(--text3)",fontWeight:800,marginTop:10}}>
              <input type="checkbox" checked={haceNoche} onChange={e=>setHaceNoche(e.target.checked)} />
              He hecho noche fuera
            </label>
            {haceNoche && (
              <>
                <label style={S.label}>Lugar de noche</label>
                <input aria-label="Ciudad / parking / base" style={S.input} value={nocheLugar} onChange={e=>setNocheLugar(e.target.value)} placeholder="Ciudad / parking / base" />
              </>
            )}
            <label style={S.label}>Notas de cierre</label>
            <input aria-label="Observaciones de cierre" style={S.input} value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Observaciones de cierre" />
            <button disabled={saving} onClick={cerrarJornadaCompleta} style={{...S.btn,width:"100%",marginTop:12,background:"#ef4444",color:"#fff",borderColor:"#ef4444"}}>
              Cerrar jornada
            </button>
          </div>
        </>
      )}
    </div>
  );
}


export { JornadaChofer };
