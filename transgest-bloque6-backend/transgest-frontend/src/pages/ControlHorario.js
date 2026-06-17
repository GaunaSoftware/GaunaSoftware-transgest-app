import { useCallback, useEffect, useMemo, useState } from "react";
import { getControlHorario, getControlHorarioResumen, getMiControlHorario, ficharControlHorario, editarControlHorario, controlHorarioCsvUrl } from "../services/api";
import { notify } from "../services/notify";
import { useAuth } from "../context/AuthContext";

const S = {
  page: { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif" },
  title:{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, color:"var(--text)", marginBottom:4 },
  sub:{ fontSize:12, color:"var(--text4)", marginBottom:18 },
  card:{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, padding:14, marginBottom:14 },
  btn:{ border:"none", borderRadius:8, padding:"8px 12px", fontWeight:900, fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  inp:{ background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"8px 10px", borderRadius:8, outline:"none", fontFamily:"'DM Sans',sans-serif", fontSize:13 },
  lbl:{ display:"block", fontSize:10, fontWeight:900, textTransform:"uppercase", letterSpacing:".06em", color:"var(--text5)", marginBottom:4 },
  th:{ textAlign:"left", padding:"8px 10px", fontSize:10, textTransform:"uppercase", letterSpacing:".06em", color:"var(--text5)", borderBottom:"1px solid var(--border)" },
  td:{ padding:"9px 10px", borderBottom:"1px solid var(--border)", fontSize:12, color:"var(--text2)", verticalAlign:"top" },
};

function minToClock(min) {
  const n = Math.max(0, Math.round(Number(min || 0)));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function fmtDt(v) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("es-ES", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function ControlHorario() {
  const { user } = useAuth();
  const canManage = ["gerente", "contable", "administrativo"].includes(user?.rol);
  const [miJornada, setMiJornada] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [items, setItems] = useState([]);
  const [desde, setDesde] = useState(monthStartIso());
  const [hasta, setHasta] = useState(todayIso());
  const [modalidad, setModalidad] = useState("oficina");
  const [ubicacion, setUbicacion] = useState("");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r, l] = await Promise.all([
        getMiControlHorario().catch(() => null),
        getControlHorarioResumen({ desde, hasta }).catch(() => null),
        getControlHorario({ desde, hasta }).catch(() => []),
      ]);
      setMiJornada(m);
      setResumen(r);
      setItems(Array.isArray(l) ? l : []);
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const resumenBase = resumen?.resumen || {};
  const abiertos = Array.isArray(resumen?.abiertas) ? resumen.abiertas : [];
  const estadoTexto = miJornada?.en_pausa ? "En pausa" : miJornada?.abierto ? "Jornada abierta" : miJornada ? "Jornada cerrada" : "Sin fichar";
  const acciones = useMemo(() => {
    if (!miJornada) return [["entrada", "Fichar entrada", "var(--accent)"]];
    if (miJornada.salida_at) return [["entrada", "Jornada cerrada", "#64748b"]];
    if (miJornada.en_pausa) return [["reanudar", "Reanudar", "var(--accent)"], ["salida", "Fichar salida", "#ef4444"]];
    return [["pausa", "Iniciar pausa", "#f59e0b"], ["salida", "Fichar salida", "#ef4444"]];
  }, [miJornada]);

  async function fichar(accion) {
    if (accion === "entrada" && miJornada?.salida_at) return;
    try {
      await ficharControlHorario({ accion, modalidad, ubicacion, notas });
      notify("Fichaje registrado.", "success");
      setNotas("");
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo registrar el fichaje.", "error");
    }
  }

  function exportCsv() {
    const token = localStorage.getItem("tms_token") || "";
    fetch(controlHorarioCsvUrl({ desde, hasta }), { headers:{ Authorization:`Bearer ${token}` } })
      .then(async res => {
        if (!res.ok) throw new Error("No se pudo exportar el control horario.");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `control-horario-${desde}-${hasta}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(e => notify(e.message, "error"));
  }

  async function guardarAjuste() {
    try {
      await editarControlHorario(edit.id, edit);
      notify("Fichaje ajustado.", "success");
      setEdit(null);
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo ajustar el fichaje.", "error");
    }
  }

  return (
    <div style={S.page}>
      <div style={S.title}>Control horario oficina</div>
      <div style={S.sub}>Registro diario de jornada para personal interno, pausas, teletrabajo y revisión por gerencia/administración.</div>

      <div style={{display:"grid",gridTemplateColumns:"minmax(280px,1.1fr) minmax(280px,1fr)",gap:14,alignItems:"stretch"}}>
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em"}}>Mi jornada de hoy</div>
              <div style={{fontSize:18,fontWeight:900,color:"var(--text)",marginTop:2}}>{estadoTexto}</div>
            </div>
            <div style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:"var(--accent-xl)"}}>
              {minToClock(miJornada?.trabajado_min)}
              <div style={{fontSize:10,color:"var(--text5)",fontFamily:"'DM Sans',sans-serif"}}>trabajado</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
            <Mini label="Entrada" value={fmtDt(miJornada?.entrada_at)} />
            <Mini label="Salida" value={fmtDt(miJornada?.salida_at)} />
            <Mini label="Pausas" value={minToClock(miJornada?.pausa_total_live_min)} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:10}}>
            <div><label style={S.lbl}>Modalidad</label><select style={{...S.inp,width:"100%"}} value={modalidad} onChange={e=>setModalidad(e.target.value)}><option value="oficina">Oficina</option><option value="teletrabajo">Teletrabajo</option><option value="visita">Visita</option><option value="otro">Otro</option></select></div>
            <div><label style={S.lbl}>Ubicacion</label><input style={{...S.inp,width:"100%"}} value={ubicacion} onChange={e=>setUbicacion(e.target.value)} placeholder="Oficina, casa, cliente..." /></div>
          </div>
          <textarea style={{...S.inp,width:"100%",minHeight:68,boxSizing:"border-box"}} value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Notas de jornada, incidencia o disponibilidad..." />
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
            {acciones.map(([accion,label,color]) => (
              <button key={accion} onClick={()=>fichar(accion)} disabled={accion==="entrada" && miJornada?.salida_at} style={{...S.btn,background:color,color:"#fff",opacity:(accion==="entrada" && miJornada?.salida_at) ? .55 : 1}}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:10}}>
            <div>
              <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em"}}>Resumen periodo</div>
              <div style={{fontSize:18,fontWeight:900,color:"var(--text)"}}>{minToClock(resumenBase.trabajado_min)}</div>
            </div>
            {canManage && <button onClick={exportCsv} style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)"}}>Exportar CSV</button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
            <Mini label="Jornadas" value={resumenBase.jornadas || 0} />
            <Mini label="Abiertas" value={resumenBase.abiertas || 0} tone={Number(resumenBase.abiertas) ? "#f59e0b" : "var(--green)"} />
            <Mini label="Pausas" value={minToClock(resumenBase.pausa_min)} />
            <Mini label="Personas abiertas" value={abiertos.length} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><label style={S.lbl}>Desde</label><input type="date" style={{...S.inp,width:"100%"}} value={desde} onChange={e=>setDesde(e.target.value)} /></div>
            <div><label style={S.lbl}>Hasta</label><input type="date" style={{...S.inp,width:"100%"}} value={hasta} onChange={e=>setHasta(e.target.value)} /></div>
          </div>
          {abiertos.length > 0 && (
            <div style={{marginTop:12,display:"grid",gap:6}}>
              {abiertos.slice(0,4).map(a => (
                <div key={a.id} style={{fontSize:11,color:"var(--text3)",display:"flex",justifyContent:"space-between",gap:8}}>
                  <span>{a.usuario_nombre} · {a.en_pausa ? "pausa" : "activo"}</span>
                  <b>{minToClock(a.trabajado_min)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={S.card}>
        <div style={{fontSize:14,fontWeight:900,color:"var(--text)",marginBottom:10}}>Jornadas registradas</div>
        {loading ? <div style={{color:"var(--text4)",fontSize:12}}>Cargando...</div> : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:860}}>
              <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Usuario</th><th style={S.th}>Entrada</th><th style={S.th}>Salida</th><th style={S.th}>Pausa</th><th style={S.th}>Trabajado</th><th style={S.th}>Estado</th><th style={S.th}>Modalidad</th><th style={S.th}>Acciones</th></tr></thead>
              <tbody>
                {items.map(row => (
                  <tr key={row.id}>
                    <td style={S.td}>{row.fecha ? new Date(row.fecha).toLocaleDateString("es-ES") : "-"}</td>
                    <td style={S.td}><b>{row.usuario_nombre}</b><div style={{color:"var(--text5)",fontSize:10}}>{row.usuario_rol}</div></td>
                    <td style={S.td}>{fmtDt(row.entrada_at)}</td>
                    <td style={S.td}>{fmtDt(row.salida_at)}</td>
                    <td style={S.td}>{minToClock(row.pausa_total_live_min)}</td>
                    <td style={S.td}><b>{minToClock(row.trabajado_min)}</b></td>
                    <td style={S.td}><span style={{color:row.estado==="cerrado"?"var(--green)":"#f59e0b",fontWeight:900}}>{row.en_pausa ? "pausa" : row.estado}</span></td>
                    <td style={S.td}>{row.modalidad || "-"}</td>
                    <td style={S.td}>{canManage && <button onClick={()=>setEdit({...row, motivo:""})} style={{...S.btn,padding:"5px 8px",background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border2)"}}>Editar</button>}</td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={9} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Sin fichajes en el periodo.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edit && (
        <div style={{position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div style={{...S.card,width:"min(560px,96vw)",margin:0}}>
            <div style={{fontSize:18,fontWeight:900,color:"var(--text)",marginBottom:4}}>Ajustar fichaje</div>
            <div style={{fontSize:12,color:"var(--text4)",marginBottom:12}}>{edit.usuario_nombre} · {edit.fecha ? new Date(edit.fecha).toLocaleDateString("es-ES") : ""}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Field label="Entrada" type="datetime-local" value={toLocalInput(edit.entrada_at)} onChange={v=>setEdit(p=>({...p,entrada_at:v ? new Date(v).toISOString() : null}))} />
              <Field label="Salida" type="datetime-local" value={toLocalInput(edit.salida_at)} onChange={v=>setEdit(p=>({...p,salida_at:v ? new Date(v).toISOString() : null}))} />
              <Field label="Pausa total min" type="number" value={edit.pausa_total_min || 0} onChange={v=>setEdit(p=>({...p,pausa_total_min:v}))} />
              <Field label="Modalidad" value={edit.modalidad || ""} onChange={v=>setEdit(p=>({...p,modalidad:v}))} />
            </div>
            <label style={S.lbl}>Motivo obligatorio</label>
            <textarea style={{...S.inp,width:"100%",minHeight:70,boxSizing:"border-box"}} value={edit.motivo || ""} onChange={e=>setEdit(p=>({...p,motivo:e.target.value}))} />
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>
              <button onClick={()=>setEdit(null)} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)"}}>Cancelar</button>
              <button onClick={guardarAjuste} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>Guardar ajuste</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, tone = "var(--text)" }) {
  return <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 9px"}}>
    <div style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".05em"}}>{label}</div>
    <div style={{fontSize:13,color:tone,fontWeight:900,marginTop:3}}>{value ?? "-"}</div>
  </div>;
}

function Field({ label, value, onChange, type = "text" }) {
  return <div><label style={S.lbl}>{label}</label><input type={type} style={{...S.inp,width:"100%",boxSizing:"border-box"}} value={value || ""} onChange={e=>onChange(e.target.value)} /></div>;
}

function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
