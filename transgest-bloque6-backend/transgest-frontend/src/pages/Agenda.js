import { useEffect, useMemo, useState } from "react";
import { borrarAgendaEvento, crearAgendaEvento, editarAgendaEvento, getAgendaEventos, getAgendaUsuarios, getAvisosOperativosIgnorados } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";

const S = {
  page: { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif", minWidth:0, overflowX:"hidden" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:900, color:"var(--text)" },
  sub: { marginTop:4, fontSize:12, color:"var(--text4)", marginBottom:18 },
  card: { background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:16 },
  btn: { padding:"8px 14px", borderRadius:7, border:"none", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  input: { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"8px 10px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" },
  label: { display:"block", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text5)", marginBottom:4 },
};

const MONTH_NAMES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DAY_NAMES = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const PRIORITY = {
  alta: { bg:"rgba(239,68,68,.14)", color:"#f87171" },
  media:{ bg:"rgba(245,158,11,.14)", color:"#f59e0b" },
  baja: { bg:"rgba(16,185,129,.14)", color:"#34d399" },
};
const STATE_LABEL = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  hecha: "Hecha",
  cancelada: "Cancelada",
};

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDateTimeLocal(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromDateTimeLocal(value, allDay = false) {
  if (!value) return null;
  if (allDay) return `${value.slice(0, 10)}T00:00:00`;
  return value.length === 16 ? `${value}:00` : value;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfCalendar(date) {
  const first = startOfMonth(date);
  const day = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - day);
  first.setHours(0,0,0,0);
  return first;
}

function buildCalendar(date) {
  const start = startOfCalendar(date);
  return Array.from({ length: 42 }).map((_, index) => {
    const d = new Date(start);
    d.setDate(start.getDate() + index);
    return d;
  });
}

function dayKey(date) {
  return toDateInput(date);
}

function fmtRange(item) {
  const ini = new Date(item.fecha_inicio);
  if (item.todo_dia) return "Todo el día";
  const fin = item.fecha_fin ? new Date(item.fecha_fin) : null;
  const a = ini.toLocaleTimeString("es-ES", { hour:"2-digit", minute:"2-digit" });
  if (!fin) return a;
  const b = fin.toLocaleTimeString("es-ES", { hour:"2-digit", minute:"2-digit" });
  return `${a} - ${b}`;
}

function alertTitle(item) {
  const alert = item?.alert || {};
  return alert.title || alert.pedido_numero || item?.alert_key || "Aviso ignorado";
}

function alertDetail(item) {
  const alert = item?.alert || {};
  return [alert.detail, alert.action].filter(Boolean).join(" ");
}

function AvisosIgnoradosTab({ mes, setMes }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedUser, setSelectedUser] = useState("");

  const range = useMemo(() => {
    const [y, m] = mes.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { desde: toDateInput(start), hasta: toDateInput(end) };
  }, [mes]);

  async function cargarIgnorados() {
    setLoading(true);
    try {
      const data = await getAvisosOperativosIgnorados(range);
      setRows(Array.isArray(data?.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargarIgnorados(); }, [range.desde, range.hasta]); // eslint-disable-line react-hooks/exhaustive-deps

  const porDia = useMemo(() => rows.reduce((acc, item) => {
    const key = item.dia || String(item.created_at || "").slice(0, 10);
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {}), [rows]);

  const dias = useMemo(() => Object.keys(porDia).sort().reverse(), [porDia]);
  const diaActivo = selectedDay || dias[0] || "";
  const itemsDia = useMemo(() => diaActivo ? porDia[diaActivo] || [] : [], [diaActivo, porDia]);
  const usuariosDia = useMemo(() => itemsDia.reduce((acc, item) => {
    const id = item.usuario_id || "usuario";
    if (!acc[id]) acc[id] = { id, nombre: item.usuario_nombre || "Usuario", rol: item.usuario_rol || "", items: [] };
    acc[id].items.push(item);
    return acc;
  }, {}), [itemsDia]);
  const usuarioActivo = selectedUser && rows.some(r => String(r.usuario_id || "") === String(selectedUser)) ? selectedUser : "";
  const itemsUsuario = usuarioActivo ? rows.filter(r => String(r.usuario_id || "") === String(usuarioActivo)) : [];

  return (
    <div style={{ display:"grid", gridTemplateColumns:"minmax(280px,.75fr) minmax(0,1.25fr)", gap:16 }}>
      <div style={S.card}>
        <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"center", marginBottom:12 }}>
          <div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"var(--text)", marginBottom:4 }}>Dias con avisos ignorados</div>
            <div style={{ fontSize:12, color:"var(--text5)" }}>{range.desde} - {range.hasta}</div>
          </div>
          <input type="month" value={mes} onChange={e=>{ setMes(e.target.value); setSelectedDay(""); setSelectedUser(""); }} style={{ ...S.input, width:150 }} />
        </div>
        {loading ? (
          <div style={{ fontSize:12, color:"var(--text5)" }}>Cargando avisos ignorados...</div>
        ) : dias.length === 0 ? (
          <div style={{ fontSize:12, color:"var(--green)", fontWeight:700 }}>No hay avisos ignorados en este mes.</div>
        ) : (
          <div style={{ display:"grid", gap:8 }}>
            {dias.map(dia => (
              <button key={dia} onClick={() => { setSelectedDay(dia); setSelectedUser(""); }} style={{ textAlign:"left", border:`1px solid ${dia === diaActivo ? "rgba(239,68,68,.55)" : "rgba(239,68,68,.25)"}`, background:dia === diaActivo ? "rgba(239,68,68,.14)" : "rgba(239,68,68,.08)", color:"var(--text)", borderRadius:9, padding:"10px 12px", cursor:"pointer" }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"center" }}>
                  <span style={{ fontSize:13, fontWeight:900, color:"#ef4444" }}>{new Date(`${dia}T12:00:00`).toLocaleDateString("es-ES", { weekday:"long", day:"2-digit", month:"long" })}</span>
                  <span style={{ fontSize:11, fontWeight:900, color:"#ef4444" }}>{porDia[dia].length}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display:"grid", gap:16 }}>
        <div style={S.card}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"var(--text)", marginBottom:12 }}>
            {diaActivo ? `Usuarios que ignoraron avisos el ${new Date(`${diaActivo}T12:00:00`).toLocaleDateString("es-ES")}` : "Usuarios"}
          </div>
          {itemsDia.length === 0 ? (
            <div style={{ fontSize:12, color:"var(--text5)" }}>Selecciona un dia con avisos ignorados.</div>
          ) : (
            <div style={{ display:"grid", gap:8 }}>
              {Object.values(usuariosDia).map(u => (
                <button key={u.id} onClick={() => setSelectedUser(u.id)} style={{ textAlign:"left", border:`1px solid ${String(selectedUser) === String(u.id) ? "rgba(239,68,68,.55)" : "var(--border)"}`, background:String(selectedUser) === String(u.id) ? "rgba(239,68,68,.10)" : "var(--bg3)", borderRadius:9, padding:"10px 12px", cursor:"pointer" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:10 }}>
                    <span style={{ fontSize:14, fontWeight:800, color:"var(--text)" }}>{u.nombre}</span>
                    <span style={{ fontSize:11, fontWeight:900, color:"#ef4444" }}>{u.items.length} ignorado{u.items.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div style={{ fontSize:11, color:"var(--text5)", marginTop:3 }}>{u.rol || "usuario"} - pulsa para ver su historial del mes</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={S.card}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"var(--text)", marginBottom:12 }}>
            {usuarioActivo ? "Historial del usuario en este mes" : "Detalle del dia"}
          </div>
          {(usuarioActivo ? itemsUsuario : itemsDia).length === 0 ? (
            <div style={{ fontSize:12, color:"var(--text5)" }}>No hay detalle para mostrar.</div>
          ) : (
            <div style={{ display:"grid", gap:10 }}>
              {(usuarioActivo ? itemsUsuario : itemsDia).map(item => (
                <div key={item.id} style={{ border:"1px solid rgba(239,68,68,.22)", borderRadius:10, padding:12, background:"rgba(239,68,68,.06)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"flex-start" }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:900, color:"var(--text)" }}>{alertTitle(item)}</div>
                      <div style={{ fontSize:11, color:"var(--text5)", marginTop:3 }}>
                        {item.usuario_nombre || "Usuario"} - {new Date(item.created_at).toLocaleString("es-ES")}
                      </div>
                    </div>
                    <span style={{ fontSize:10, padding:"3px 8px", borderRadius:999, background:"rgba(239,68,68,.14)", color:"#ef4444", fontWeight:900 }}>Ignorado</span>
                  </div>
                  {alertDetail(item) && <div style={{ fontSize:12, color:"var(--text3)", marginTop:8, lineHeight:1.45 }}>{alertDetail(item)}</div>}
                  <div style={{ fontSize:11, color:"var(--text5)", marginTop:8 }}>Motivo: {item.motivo || "Sin motivo indicado"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalAgenda({ evento, usuarios, fechaBase, canEdit, user, onClose, onSaved }) {
  const now = new Date();
  const esGerente = user?.rol === "gerente";
  const start = evento?.fecha_inicio || `${fechaBase}T09:00:00`;
  const end = evento?.fecha_fin || `${fechaBase}T10:00:00`;
  const [form, setForm] = useState({
    titulo: evento?.titulo || "",
    descripcion: evento?.descripcion || "",
    fecha_inicio: toDateTimeLocal(start),
    fecha_fin: toDateTimeLocal(end),
    todo_dia: !!evento?.todo_dia,
    tipo: evento?.tipo || "tarea",
    prioridad: evento?.prioridad || "media",
    estado: evento?.estado || "pendiente",
    visibilidad: evento?.visibilidad || "personal",
    asignado_a: evento?.asignado_a || "",
  });

  function f(key) {
    return e => setForm(prev => ({ ...prev, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  }

  async function guardar() {
    if (!canEdit) return;
    if (!form.titulo.trim()) {
      notify("Indica un título para la tarea o evento.", "warning");
      return;
    }
    if (!form.fecha_inicio) {
      notify("Indica la fecha de inicio.", "warning");
      return;
    }
    const payload = {
      ...form,
      fecha_inicio: fromDateTimeLocal(form.fecha_inicio, form.todo_dia),
      fecha_fin: form.fecha_fin ? fromDateTimeLocal(form.fecha_fin, form.todo_dia) : null,
      asignado_a: form.asignado_a || null,
    };
    if (!esGerente && payload.asignado_a && String(payload.asignado_a) !== String(user?.id || "")) {
      payload.visibilidad = "equipo";
      payload.estado = "pendiente";
      payload.metadata = { ...(payload.metadata || {}), solicitud_tarea: true };
    }
    await onSaved(payload);
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.76)", zIndex:250, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, width:"min(620px,96vw)", padding:20, maxHeight:"92vh", overflowY:"auto" }}>
        <div style={{ fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:800, color:"var(--text)", marginBottom:16 }}>
          {evento ? "Editar tarea / evento" : "Nueva tarea / evento"}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1.2fr .8fr", gap:12 }}>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={S.label}>Título</label>
            <input style={S.input} value={form.titulo} onChange={f("titulo")} placeholder="Ej: Confirmar entregas de mañana" />
          </div>
          <div>
            <label style={S.label}>Tipo</label>
            <select style={S.input} value={form.tipo} onChange={f("tipo")}>
              <option value="tarea">Tarea</option>
              <option value="reunion">Reunión</option>
              <option value="seguimiento">Seguimiento</option>
              <option value="recordatorio">Recordatorio</option>
              <option value="operativa">Operativa</option>
            </select>
          </div>
          <div>
            <label style={S.label}>{esGerente ? "Asignado a" : "Solicitar a"}</label>
            <select style={S.input} value={form.asignado_a} onChange={f("asignado_a")}>
              <option value="">Yo / sin asignar</option>
              {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre || u.username || u.email} · {u.rol}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Inicio</label>
            <input type={form.todo_dia ? "date" : "datetime-local"} style={S.input} value={form.todo_dia ? form.fecha_inicio.slice(0,10) : form.fecha_inicio} onChange={f("fecha_inicio")} />
          </div>
          <div>
            <label style={S.label}>Fin</label>
            <input type={form.todo_dia ? "date" : "datetime-local"} style={S.input} value={form.todo_dia ? form.fecha_fin.slice(0,10) : form.fecha_fin} onChange={f("fecha_fin")} />
          </div>
          <div>
            <label style={S.label}>Estado</label>
            <select style={S.input} value={form.estado} onChange={f("estado")}>
              {Object.entries(STATE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Prioridad</label>
            <select style={S.input} value={form.prioridad} onChange={f("prioridad")}>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, gridColumn:"1/-1", marginTop:2 }}>
            <input id="todo-dia" type="checkbox" checked={form.todo_dia} onChange={f("todo_dia")} style={{ width:16, height:16, accentColor:"var(--accent)" }} />
            <label htmlFor="todo-dia" style={{ fontSize:13, color:"var(--text3)", cursor:"pointer" }}>Todo el día</label>
            <div style={{ marginLeft:16 }}>
              <select style={{ ...S.input, width:180 }} value={form.visibilidad} onChange={f("visibilidad")}>
                <option value="personal">Solo yo / personal</option>
                <option value="equipo">Visible para el equipo</option>
              </select>
            </div>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={S.label}>Descripción</label>
            <textarea style={{ ...S.input, minHeight:92, resize:"vertical" }} value={form.descripcion} onChange={f("descripcion")} placeholder="Detalles, instrucciones, recordatorios o pasos de la tarea..." />
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginTop:18 }}>
          <div style={{ fontSize:11, color:"var(--text5)" }}>Creado {now.toLocaleDateString("es-ES")} · pensado para tareas operativas y agenda interna.</div>
          <div style={{ display:"flex", gap:8 }}>
            <button style={{ ...S.btn, background:"transparent", color:"var(--text4)", border:"1px solid var(--border2)" }} onClick={onClose}>Cancelar</button>
            <button style={{ ...S.btn, background:"var(--accent)", color:"#fff" }} onClick={guardar} disabled={!canEdit}>Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Agenda() {
  const { user, puedeEditar } = useAuth();
  const canEdit = puedeEditar("agenda");
  const esGerente = user?.rol === "gerente";
  const [tab, setTab] = useState("agenda");
  const [mes, setMes] = useState(() => monthKey(new Date()));
  const [usuarios, setUsuarios] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [soloMias, setSoloMias] = useState(false);
  const [estado, setEstado] = useState("todas");
  const [tipo, setTipo] = useState("todos");
  const [selectedDay, setSelectedDay] = useState(() => toDateInput(new Date()));
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);

  const currentMonth = useMemo(() => {
    const [y, m] = mes.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [mes]);

  const calendarDays = useMemo(() => buildCalendar(currentMonth), [currentMonth]);
  const monthStart = useMemo(() => startOfCalendar(currentMonth), [currentMonth]);
  const monthEnd = useMemo(() => {
    const last = new Date(monthStart);
    last.setDate(last.getDate() + 41);
    last.setHours(23, 59, 59, 999);
    return last;
  }, [monthStart]);

  async function cargar() {
    setLoading(true);
    try {
      const [rows, users] = await Promise.all([
        getAgendaEventos({
          desde: monthStart.toISOString(),
          hasta: monthEnd.toISOString(),
          modo: soloMias ? "mias" : "todas",
          ...(estado !== "todas" ? { estado } : {}),
          ...(tipo !== "todos" ? { tipo } : {}),
        }),
        getAgendaUsuarios().catch(() => []),
      ]);
      setEventos(Array.isArray(rows) ? rows : []);
      setUsuarios(Array.isArray(users) ? users : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, [mes, soloMias, estado, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const eventosPorDia = useMemo(() => {
    const map = new Map();
    eventos.forEach(ev => {
      const k = dayKey(new Date(ev.fecha_inicio));
      const list = map.get(k) || [];
      list.push(ev);
      map.set(k, list);
    });
    return map;
  }, [eventos]);

  const eventosDia = (eventosPorDia.get(selectedDay) || []).slice().sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));
  const pendientes = eventos.filter(e => ["pendiente", "en_progreso"].includes(e.estado)).slice().sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

  async function guardarEvento(payload) {
    if (modal?.id) await editarAgendaEvento(modal.id, payload);
    else await crearAgendaEvento(payload);
    setModal(null);
    await cargar();
  }

  async function eliminarEvento(id) {
    const ok = await confirmDialog({
      title: "Eliminar tarea",
      message: "Se eliminará este evento de la agenda.",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    await borrarAgendaEvento(id);
    await cargar();
  }

  return (
    <div className="tg-agenda-page tg-responsive-page" style={S.page}>
      <div className="tg-agenda-title" style={S.title}>Agenda y tareas</div>
      <div style={S.sub}>Calendario operativo para usuarios, recordatorios y seguimiento interno del día a día.</div>

      {esGerente && (
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
          {[
            ["agenda", "Agenda"],
            ["ignorados", "Avisos ignorados"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ ...S.btn, background:tab === id ? "var(--accent)" : "var(--bg3)", color:tab === id ? "#fff" : "var(--text3)", border:tab === id ? "1px solid var(--accent)" : "1px solid var(--border2)" }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "ignorados" && esGerente ? (
        <AvisosIgnoradosTab mes={mes} setMes={setMes} />
      ) : (
        <>
      <div className="tg-agenda-filters" style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", marginBottom:16 }}>
        <input type="month" value={mes} onChange={e=>setMes(e.target.value)} style={{ ...S.input, width:160 }} />
        <select value={estado} onChange={e=>setEstado(e.target.value)} style={{ ...S.input, width:170 }}>
          <option value="todas">Todos los estados</option>
          {Object.entries(STATE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={tipo} onChange={e=>setTipo(e.target.value)} style={{ ...S.input, width:170 }}>
          <option value="todos">Todos los tipos</option>
          <option value="tarea">Tarea</option>
          <option value="reunion">Reunión</option>
          <option value="seguimiento">Seguimiento</option>
          <option value="recordatorio">Recordatorio</option>
          <option value="operativa">Operativa</option>
        </select>
        <label style={{ display:"inline-flex", alignItems:"center", gap:8, fontSize:13, color:"var(--text3)" }}>
          <input type="checkbox" checked={soloMias} onChange={e=>setSoloMias(e.target.checked)} style={{ width:16, height:16, accentColor:"var(--accent)" }} />
          Solo mis tareas
        </label>
        <button style={{ ...S.btn, background:"var(--accent)", color:"#fff", marginLeft:"auto" }} onClick={()=>setModal({ fecha_inicio: `${selectedDay}T09:00:00` })} disabled={!canEdit}>
          + Nueva tarea
        </button>
      </div>

      <div className="tg-agenda-shell" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.4fr) minmax(320px,.9fr)", gap:16 }}>
        <div style={S.card}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:800, color:"var(--text)", marginBottom:12 }}>
            {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </div>
          <div className="tg-agenda-calendar-head" style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8, marginBottom:8 }}>
            {DAY_NAMES.map(label => <div key={label} style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:".08em", color:"var(--text5)", textAlign:"center" }}>{label}</div>)}
          </div>
          <div className="tg-agenda-calendar-grid" style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8 }}>
            {calendarDays.map(day => {
              const key = dayKey(day);
              const items = eventosPorDia.get(key) || [];
              const inMonth = day.getMonth() === currentMonth.getMonth();
              const active = key === selectedDay;
              return (
                <button
                  className="tg-agenda-day"
                  key={key}
                  onClick={()=>setSelectedDay(key)}
                  style={{
                    minHeight:108,
                    borderRadius:10,
                    border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: active ? "rgba(59,110,245,.08)" : "var(--bg3)",
                    color:"var(--text)",
                    padding:10,
                    textAlign:"left",
                    cursor:"pointer",
                    opacity: inMonth ? 1 : 0.48,
                  }}
                >
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <span style={{ fontSize:13, fontWeight:800 }}>{day.getDate()}</span>
                    {items.length > 0 && <span className="tg-agenda-day-count" style={{ fontSize:10, padding:"2px 7px", borderRadius:999, background:"rgba(16,185,129,.14)", color:"var(--green)", fontWeight:800 }}>{items.length}</span>}
                  </div>
                  <div className="tg-agenda-day-events" style={{ display:"grid", gap:4 }}>
                    {items.slice(0, 3).map(ev => (
                      <div key={ev.id} style={{ fontSize:10, lineHeight:1.35, padding:"4px 6px", borderRadius:6, background: PRIORITY[ev.prioridad || "media"]?.bg, color: PRIORITY[ev.prioridad || "media"]?.color, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {ev.titulo}
                      </div>
                    ))}
                    {items.length > 3 && <div style={{ fontSize:10, color:"var(--text5)" }}>+{items.length - 3} más</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tg-agenda-detail" style={{ display:"grid", gap:16 }}>
          <div style={S.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"var(--text)" }}>
                {new Date(selectedDay).toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"long" })}
              </div>
              <div style={{ fontSize:11, color:"var(--text5)" }}>{eventosDia.length} elemento{eventosDia.length !== 1 ? "s" : ""}</div>
            </div>
            {loading ? (
              <div style={{ fontSize:12, color:"var(--text5)" }}>Cargando agenda...</div>
            ) : eventosDia.length === 0 ? (
              <div style={{ fontSize:12, color:"var(--text5)" }}>No hay tareas ni eventos para este día.</div>
            ) : (
              <div style={{ display:"grid", gap:10 }}>
                {eventosDia.map(ev => (
                  <div key={ev.id} style={{ border:"1px solid var(--border)", borderRadius:10, padding:12, background:"var(--bg3)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"flex-start" }}>
                      <div>
                        <div style={{ fontSize:14, fontWeight:800, color:"var(--text)" }}>{ev.titulo}</div>
                        <div style={{ fontSize:11, color:"var(--text5)", marginTop:3 }}>
                          {fmtRange(ev)} · {ev.tipo} · {STATE_LABEL[ev.estado] || ev.estado}
                        </div>
                      </div>
                      <span style={{ fontSize:10, padding:"3px 8px", borderRadius:999, background: PRIORITY[ev.prioridad || "media"]?.bg, color: PRIORITY[ev.prioridad || "media"]?.color, fontWeight:800 }}>
                        {ev.prioridad}
                      </span>
                    </div>
                    {ev.descripcion && <div style={{ fontSize:12, color:"var(--text3)", marginTop:8, lineHeight:1.45 }}>{ev.descripcion}</div>}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginTop:10 }}>
                      <div style={{ fontSize:11, color:"var(--text5)" }}>
                        {ev.asignado_a_nombre ? `Asignado a ${ev.asignado_a_nombre}` : "Sin asignación específica"}
                        {ev.visibilidad === "equipo" ? " · equipo" : " · personal"}
                      </div>
                      {canEdit && (
                        <div style={{ display:"flex", gap:6 }}>
                          <button style={{ ...S.btn, padding:"5px 9px", background:"var(--bg4)", color:"var(--text3)", border:"1px solid var(--border2)" }} onClick={()=>setModal(ev)}>Editar</button>
                          <button style={{ ...S.btn, padding:"5px 9px", background:"rgba(239,68,68,.12)", color:"#ef4444", border:"1px solid rgba(239,68,68,.25)" }} onClick={()=>eliminarEvento(ev.id)}>Eliminar</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"var(--text)", marginBottom:12 }}>Pendientes</div>
            {pendientes.length === 0 ? (
              <div style={{ fontSize:12, color:"var(--green)", fontWeight:700 }}>No tienes tareas pendientes en este periodo.</div>
            ) : (
              <div style={{ display:"grid", gap:8 }}>
                {pendientes.slice(0, 8).map(ev => (
                  <button key={ev.id} onClick={()=>setSelectedDay(dayKey(new Date(ev.fecha_inicio)))} style={{ textAlign:"left", border:"1px solid var(--border)", background:"var(--bg3)", borderRadius:8, padding:"10px 12px", cursor:"pointer" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:10 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:"var(--text)" }}>{ev.titulo}</span>
                      <span style={{ fontSize:10, color:"var(--text5)" }}>{new Date(ev.fecha_inicio).toLocaleDateString("es-ES", { day:"2-digit", month:"2-digit" })}</span>
                    </div>
                    <div style={{ fontSize:11, color:"var(--text4)", marginTop:4 }}>
                      {ev.asignado_a_nombre || user?.nombre || user?.email} · {STATE_LABEL[ev.estado] || ev.estado}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <ModalAgenda
          evento={modal?.id ? modal : null}
          usuarios={usuarios}
          fechaBase={selectedDay}
          canEdit={canEdit}
          user={user}
          onClose={()=>setModal(null)}
          onSaved={guardarEvento}
        />
      )}
        </>
      )}
    </div>
  );
}
