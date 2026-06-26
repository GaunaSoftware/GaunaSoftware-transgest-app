import { useCallback, useEffect, useMemo, useState } from "react";
import { editarPedido, getPlanDiario, guardarPlanDiarioNota, guardarPlanDiarioOrden } from "../services/api";
import { notify } from "../services/notify";
import { setRuntimeFocus } from "../services/runtimeFocus";

const S = {
  page: { flex:1, padding:"24px 30px", fontFamily:"'DM Sans',sans-serif", background:"linear-gradient(180deg, rgba(248,250,252,.92), rgba(255,255,255,.98))" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:30, fontWeight:900, color:"var(--text)", marginBottom:4 },
  sub: { fontSize:12, color:"var(--text4)", marginBottom:16 },
  bar: { display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:22 },
  btn: { padding:"10px 14px", borderRadius:8, border:"1px solid var(--border2)", fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", background:"var(--bg3)", color:"var(--text3)" },
  input: { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"10px 12px", borderRadius:8, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", boxSizing:"border-box" },
  panel: { background:"var(--card-bg)", border:"1px solid var(--border)", borderRadius:12, overflow:"hidden", boxShadow:"0 12px 34px rgba(15,23,42,.06)" },
  th: { textAlign:"left", padding:"13px 14px", fontSize:10, fontWeight:900, textTransform:"uppercase", letterSpacing:".06em", color:"var(--text4)", background:"rgba(248,250,252,.86)", borderBottom:"1px solid var(--border)", whiteSpace:"nowrap" },
  td: { padding:"13px 14px", borderBottom:"1px solid var(--border)", fontSize:12, color:"var(--text2)", verticalAlign:"top" },
};

const STATE = {
  pendiente:  { label:"Pendiente", color:"#9ca3af", bg:"rgba(156,163,175,.14)" },
  confirmado: { label:"Confirmado", color:"#3b82f6", bg:"rgba(59,130,246,.14)" },
  en_curso:   { label:"En curso", color:"#f97316", bg:"rgba(249,115,22,.15)" },
  descarga:   { label:"Descarga", color:"#a78bfa", bg:"rgba(167,139,250,.15)" },
  entregado:  { label:"Entregado", color:"#10b981", bg:"rgba(16,185,129,.14)" },
  facturado:  { label:"Facturado", color:"#8b5cf6", bg:"rgba(139,92,246,.14)" },
  cancelado:  { label:"Cancelado", color:"#ef4444", bg:"rgba(239,68,68,.14)" },
};

const ALERT = {
  danger:  { color:"#ef4444", bg:"rgba(239,68,68,.13)", border:"rgba(239,68,68,.30)", label:"Rojo" },
  warning: { color:"#f59e0b", bg:"rgba(245,158,11,.13)", border:"rgba(245,158,11,.30)", label:"Aviso" },
  info:    { color:"#3b82f6", bg:"rgba(59,130,246,.11)", border:"rgba(59,130,246,.25)", label:"Info" },
  ok:      { color:"#10b981", bg:"rgba(16,185,129,.12)", border:"rgba(16,185,129,.28)", label:"OK" },
};

function ymd(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDays(base, days) {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d);
}

function fmtDate(value) {
  if (!value) return "";
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-ES", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isPlanTractora(row = {}) {
  const text = normalizeSearchText(`${row.clase || ""} ${row.tipo || ""} ${row.tipo_vehiculo || ""}`);
  const remolqueTerms = [
    "remolque", "semirremolque", "semi", "trailer", "tautliner", "tauliner",
    "lona", "banera", "volcador", "cisterna", "frigorifico", "frigo",
    "portacoches", "lateral bajo", "lowboy", "dolly", "balleston",
    "plataforma", "chasis", "piso movil", "gondola",
  ];
  return !remolqueTerms.some(term => text.includes(term));
}

function normalizePlanData(res) {
  const rawRows = Array.isArray(res?.rows) ? res.rows : [];
  const rows = rawRows.filter(isPlanTractora);
  const visibleIds = new Set(rows.map(r => String(r.id)));
  const hiddenPedidos = rawRows
    .filter(r => !visibleIds.has(String(r.id)))
    .flatMap(r => (r.pedidos || []).map(p => ({
      ...p,
      vehiculo_id: "",
      vehiculo_matricula: "",
      aviso_completar: p.aviso_completar || `Asignacion anterior no valida: ${r.matricula || "remolque"}`,
    })));
  const unassigned = [
    ...(Array.isArray(res?.unassigned) ? res.unassigned : []),
    ...hiddenPedidos,
  ];
  const resumen = {
    ...(res?.resumen || {}),
    tractoras: rows.length,
    vehiculos: rows.length,
    con_trabajo: rows.filter(r => (r.pedidos || []).length > 0).length,
    sin_trabajo: rows.filter(r => (r.pedidos || []).length === 0).length,
    pedidos_sin_asignar: unassigned.length,
  };
  return { ...(res || {}), rows, unassigned, resumen };
}

function StatusBadge({ estado }) {
  const s = STATE[estado] || STATE.pendiente;
  return <span style={{ display:"inline-flex", padding:"2px 8px", borderRadius:999, fontSize:10, fontWeight:900, color:s.color, background:s.bg }}>{s.label}</span>;
}

function AlertBadge({ aviso }) {
  const s = ALERT[aviso.severity] || ALERT.info;
  return (
    <div style={{ border:`1px solid ${s.border}`, background:s.bg, borderRadius:7, padding:"6px 8px", color:s.color, minWidth:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
        <span style={{ width:7, height:7, borderRadius:"50%", background:s.color, flexShrink:0 }} />
        <span style={{ fontSize:11, fontWeight:900, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{aviso.title || s.label}</span>
        {aviso.label && <span style={{ marginLeft:"auto", fontSize:10, color:s.color, opacity:.9, whiteSpace:"nowrap" }}>{aviso.label}</span>}
      </div>
      {aviso.detail && <div style={{ marginTop:3, fontSize:10, lineHeight:1.35, color:"var(--text4)" }}>{aviso.detail}</div>}
    </div>
  );
}

function ChoferAvatar({ row }) {
  const name = row?.chofer_nombre || "Sin chofer";
  const src = row?.chofer_foto_url || row?.chofer_avatar_url || row?.chofer_foto || row?.foto_url || "";
  const baseStyle = {
    width:34,
    height:34,
    borderRadius:"50%",
    flexShrink:0,
    border:"1px solid rgba(148,163,184,.26)",
    background:"linear-gradient(180deg, #eef7f5 0%, #e2ebe9 100%)",
    color:"#7a8b8a",
    display:"inline-flex",
    alignItems:"center",
    justifyContent:"center",
    overflow:"hidden",
  };
  if (src) return <img src={src} alt={name} style={{ ...baseStyle, objectFit:"cover", background:"var(--bg3)" }} />;
  return (
    <span style={baseStyle} title={name}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <circle cx="12" cy="8.2" r="4.1" fill="currentColor" opacity=".78" />
        <path d="M4.6 21.2c.9-4.1 3.7-6.4 7.4-6.4s6.5 2.3 7.4 6.4" fill="currentColor" opacity=".78" />
      </svg>
    </span>
  );
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function buildPlanChoferText(row, fecha) {
  const pedidos = Array.isArray(row?.pedidos) ? row.pedidos : [];
  const lines = [
    `Plan diario ${fmtDate(fecha)}`,
    `Vehiculo: ${row?.matricula || "-"}${row?.remolque_matricula ? ` + ${row.remolque_matricula}` : ""}`,
    `Chofer: ${row?.chofer_nombre || "-"}`,
    "",
    ...pedidos.flatMap((p, idx) => [
      `${idx + 1}. ${p.numero || "Pedido"} - ${p.ruta || ""}`,
      `   Carga: ${p.fecha_carga || "-"} ${p.hora_carga || p.ventana_carga || ""}`.trim(),
      `   Descarga: ${p.fecha_descarga || "-"} ${p.hora_descarga || p.ventana_descarga || ""}`.trim(),
      p.cliente_nombre ? `   Cliente: ${p.cliente_nombre}` : "",
    ].filter(Boolean)),
    "",
    row?.nota_plan ? `Nota: ${row.nota_plan}` : "",
  ].filter(line => line !== "");
  return lines.join("\n");
}

function PedidoMini({ pedido, onOpen, draggable = false, onDragStart, onDragOverPedido, onDropPedido }) {
  const hora = pedido.momento === "descarga"
    ? (pedido.hora_descarga || pedido.ventana_descarga || "--:--")
    : (pedido.hora_carga || pedido.ventana_carga || "--:--");
  return (
    <button
      onClick={() => onOpen(pedido)}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, pedido)}
      onDragOver={(e) => onDragOverPedido?.(e, pedido)}
      onDrop={(e) => onDropPedido?.(e, pedido)}
      style={{ width:"100%", textAlign:"left", border:"1px solid var(--border2)", background:"var(--bg3)", borderRadius:7, padding:"7px 8px", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}
    >
      <div style={{ display:"flex", gap:8, alignItems:"flex-start", justifyContent:"space-between" }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", color:"var(--accent-xl)", fontSize:11, fontWeight:900, whiteSpace:"nowrap" }}>{pedido.numero || "Pedido"}</div>
          <div style={{ marginTop:2, fontSize:12, fontWeight:850, color:"var(--text)", lineHeight:1.25, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{pedido.ruta}</div>
        </div>
        <StatusBadge estado={pedido.estado} />
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:6, fontSize:10, color:"var(--text4)" }}>
        <span>{pedido.momento === "descarga" ? "Descarga" : "Carga"} {hora}</span>
        {pedido.cliente_nombre && <span>{pedido.cliente_nombre}</span>}
        {pedido.pendiente_completar && <span style={{ color:"#f59e0b", fontWeight:900 }}>Completar</span>}
      </div>
    </button>
  );
}

function KpiIcon({ icon }) {
  const common = { width:26, height:26, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:"1.8", strokeLinecap:"round", strokeLinejoin:"round", "aria-hidden":"true" };
  if (icon === "truck") return <svg {...common}><path d="M3 7h10v9H3z" /><path d="M13 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>;
  if (icon === "work") return <svg {...common}><path d="M9 6h6" /><path d="M10 4h4v4h-4z" /><rect x="4" y="7" width="16" height="13" rx="2" /><path d="m9 13 2 2 4-5" /></svg>;
  if (icon === "empty") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="m9 9 6 6" /><path d="m15 9-6 6" /></svg>;
  if (icon === "alert") return <svg {...common}><path d="M12 4 3 20h18L12 4Z" /><path d="M12 9v5" /><path d="M12 17h.01" /></svg>;
  if (icon === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>;
  return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-8 0v2" /><circle cx="12" cy="7" r="4" /></svg>;
}

function Kpi({ label, value, tone = "info", icon = "truck", caption = "" }) {
  const s = ALERT[tone] || ALERT.info;
  return (
    <div style={{ border:"1px solid var(--border)", background:"var(--card-bg)", borderRadius:12, padding:"18px 20px", minHeight:82, display:"flex", alignItems:"center", gap:16, boxShadow:"0 10px 28px rgba(15,23,42,.05)" }}>
      <div style={{ width:52, height:52, borderRadius:"50%", display:"inline-flex", alignItems:"center", justifyContent:"center", color:s.color, background:s.bg, border:`1px solid ${s.border}`, flexShrink:0 }}>
        <KpiIcon icon={icon} />
      </div>
      <div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:24, lineHeight:1, fontWeight:900, color:s.color }}>{value}</div>
        <div style={{ marginTop:7, fontSize:10, color:"var(--text4)", fontWeight:900, textTransform:"uppercase", letterSpacing:".06em" }}>{label}</div>
        {caption && <div style={{ marginTop:3, fontSize:11, color:"var(--text4)" }}>{caption}</div>}
      </div>
    </div>
  );
}

export default function PlanDiario() {
  const [fecha, setFecha] = useState(() => addDays(ymd(new Date()), 1));
  const [data, setData] = useState({ rows: [], unassigned: [], resumen: {} });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [soloAvisos, setSoloAvisos] = useState(false);
  const [savingNote, setSavingNote] = useState("");
  const [notas, setNotas] = useState({});
  const [dragOverRow, setDragOverRow] = useState("");
  const [savingPlan, setSavingPlan] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPlanDiario({ fecha });
      const plan = normalizePlanData(res || { rows: [], unassigned: [], resumen: {} });
      setData(plan);
      const nextNotas = {};
      (plan.rows || []).forEach(r => { nextNotas[r.id] = r.nota_plan || ""; });
      setNotas(nextNotas);
    } catch (e) {
      notify(e.message || "No se pudo cargar el plan diario.", "error");
    } finally {
      setLoading(false);
    }
  }, [fecha]);

  useEffect(() => { cargar(); }, [cargar]);

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return (data.rows || [])
      .filter(r => !soloAvisos || r.avisos?.length || r.pedidos?.length === 0)
      .filter(r => {
        if (!text) return true;
        return `${r.matricula} ${r.remolque_matricula || ""} ${r.chofer_nombre || ""} ${r.notas_operacion || ""} ${(r.pedidos || []).map(p => p.ruta).join(" ")}`.toLowerCase().includes(text);
      });
  }, [data.rows, q, soloAvisos]);

  function openPedido(pedido) {
    if (!pedido?.id) return;
    setRuntimeFocus("tms_pedidos_focus", { pedido_id: pedido.id, numero: pedido.numero || "" });
    window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"pedidos" }));
  }

  async function saveNote(row, value) {
    setSavingNote(String(row.id));
    try {
      await guardarPlanDiarioNota({ fecha, vehiculo_id: row.id, nota: value, color:"info" });
      notify("Nota del plan guardada.", "success");
    } catch (e) {
      notify(e.message || "No se pudo guardar la nota.", "error");
    } finally {
      setSavingNote("");
    }
  }

  function startPedidoDrag(e, pedido, row = null) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("pedido_id", String(pedido?.id || ""));
    e.dataTransfer.setData("from_vehiculo_id", row?.id ? String(row.id) : "");
  }

  function moveBefore(list, draggedId, targetId) {
    const ids = list.map(p => String(p.id));
    const from = ids.indexOf(String(draggedId));
    const to = ids.indexOf(String(targetId));
    if (from < 0 || to < 0 || from === to) return list;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  async function saveRowOrder(row, pedidos) {
    const pedidoOrden = pedidos.map(p => p.id);
    await guardarPlanDiarioOrden({ fecha, vehiculo_id: row.id, pedido_orden: pedidoOrden });
  }

  async function reorderPedidoInRow(e, row, targetPedido) {
    e.preventDefault();
    e.stopPropagation();
    const pedidoId = e.dataTransfer.getData("pedido_id");
    const fromVehiculoId = e.dataTransfer.getData("from_vehiculo_id");
    if (!pedidoId || String(fromVehiculoId) !== String(row.id)) return;
    const nextPedidos = moveBefore(row.pedidos || [], pedidoId, targetPedido.id);
    setData(prev => ({
      ...prev,
      rows: (prev.rows || []).map(r => String(r.id) === String(row.id) ? { ...r, pedidos: nextPedidos } : r),
    }));
    try {
      await saveRowOrder(row, nextPedidos);
    } catch (e2) {
      notify(e2.message || "No se pudo guardar el orden del plan.", "error");
      cargar();
    }
  }

  async function dropPedidoOnRow(e, row) {
    e.preventDefault();
    setDragOverRow("");
    const pedidoId = e.dataTransfer.getData("pedido_id");
    const fromVehiculoId = e.dataTransfer.getData("from_vehiculo_id");
    if (!pedidoId || !row?.id) return;
    const sourceRow = (data.rows || []).find(r => String(r.id) === String(fromVehiculoId));
    const pedido =
      (sourceRow?.pedidos || []).find(p => String(p.id) === String(pedidoId)) ||
      (data.unassigned || []).find(p => String(p.id) === String(pedidoId));
    if (!pedido) return;

    if (String(fromVehiculoId) === String(row.id)) {
      const ordered = [...(row.pedidos || [])];
      try {
        await saveRowOrder(row, ordered);
        notify("Orden del plan guardado.", "success");
      } catch (e2) {
        notify(e2.message || "No se pudo guardar el orden del plan.", "error");
      }
      return;
    }

    setSavingPlan(String(pedido.id));
    try {
      await editarPedido(pedido.id, {
        vehiculo_id: row.id,
        chofer_id: row.chofer_id || pedido.chofer_id || "",
        remolque_id: row.remolque_id || pedido.remolque_id || "",
        fecha_carga: fecha,
      });
      notify(`${pedido.numero || "Pedido"} asignado a ${row.matricula}.`, "success");
      await cargar();
    } catch (e2) {
      notify(e2.message || "No se pudo asignar el pedido desde el plan diario.", "error");
    } finally {
      setSavingPlan("");
    }
  }

  async function copiarPlanChofer(row) {
    const ok = await copyTextToClipboard(buildPlanChoferText(row, fecha));
    notify(ok ? "Plan del chofer copiado para WhatsApp." : "No se pudo copiar el plan.", ok ? "success" : "error");
  }

  const resumen = data.resumen || {};
  const avisosDia = useMemo(() => {
    const pedidosDia = [
      ...(data.rows || []).flatMap(row => (row.pedidos || []).map(p => ({ ...p, _row: row }))),
      ...(data.unassigned || []),
    ];
    const rowsAlerts = (data.rows || []).flatMap(row => (row.avisos || []).map((aviso, idx) => ({
      id: `${row.id}-${aviso.source || "aviso"}-${idx}`,
      severity: aviso.severity || "info",
      title: aviso.title || "Aviso operativo",
      detail: [row.matricula, aviso.detail].filter(Boolean).join(" - "),
      label: aviso.label || row.chofer_nombre || "",
    })));
    const festivoAlerts = pedidosDia
      .map(p => {
        const raw = p.aviso_festivo || p.festivo || p.festivo_nombre || p.festivo_ccaa || "";
        const text = typeof raw === "object"
          ? [raw.nombre, raw.descripcion, raw.municipio, raw.provincia, raw.ccaa].filter(Boolean).join(" - ")
          : String(raw || "");
        if (!text) return null;
        return {
          id: `festivo-${p.id || p.numero}`,
          severity: "warning",
          title: "Festivo en ruta",
          detail: `${p.numero || "Pedido"} - ${[p.origen, p.destino].filter(Boolean).join(" -> ") || p.ruta || text}`,
          label: text,
        };
      })
      .filter(Boolean);
    const sinAsignarAlerts = (data.unassigned || []).slice(0, 5).map(p => ({
      id: `unassigned-${p.id}`,
      severity: "warning",
      title: p.aviso_completar || "Pedido sin asignacion completa",
      detail: `${p.numero || "Pedido"} - ${p.ruta || [p.origen, p.destino].filter(Boolean).join(" -> ") || "Sin ruta"}`,
      label: p.fecha_carga || "",
    }));
    return [...rowsAlerts, ...festivoAlerts, ...sinAsignarAlerts].sort((a, b) => {
      const order = { danger: 0, warning: 1, info: 2, ok: 3 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    }).slice(0, 8);
  }, [data.rows, data.unassigned]);
  const today = ymd(new Date());
  const tomorrow = addDays(today, 1);

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={S.title}>Plan diario</div>
          <div style={S.sub}>{fmtDate(fecha)} - flota, rutas, avisos y notas operativas en una sola vista</div>
        </div>
        <button onClick={() => window.print()} style={{ ...S.btn, background:"rgba(59,130,246,.12)", color:"#60a5fa", border:"1px solid rgba(59,130,246,.25)" }}>Imprimir</button>
      </div>

      <div style={S.bar}>
        <button onClick={() => setFecha(today)} style={{ ...S.btn, background:fecha === today ? "var(--accent)" : "var(--bg3)", color:fecha === today ? "#fff" : "var(--text3)", borderColor:fecha === today ? "var(--accent)" : "var(--border2)" }}>Hoy</button>
        <button onClick={() => setFecha(tomorrow)} style={{ ...S.btn, background:fecha === tomorrow ? "var(--accent)" : "var(--bg3)", color:fecha === tomorrow ? "#fff" : "var(--text3)", borderColor:fecha === tomorrow ? "var(--accent)" : "var(--border2)" }}>Mañana</button>
        <button onClick={() => setFecha(addDays(fecha, -1))} style={S.btn}>Día anterior</button>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ ...S.input, width:142 }} />
        <button onClick={() => setFecha(addDays(fecha, 1))} style={S.btn}>Día siguiente</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar matricula, chofer o ruta..." style={{ ...S.input, width:260, marginLeft:"auto" }} />
        <button onClick={() => setSoloAvisos(v => !v)} style={{ ...S.btn, background:soloAvisos ? "#f59e0b" : "var(--bg3)", color:soloAvisos ? "#111827" : "var(--text3)", borderColor:soloAvisos ? "#f59e0b" : "var(--border2)" }}>
          {soloAvisos ? "Mostrando avisos" : "Solo avisos / sin trabajo"}
        </button>
        <button onClick={cargar} style={S.btn}>Actualizar</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(6, minmax(140px, 1fr))", gap:14, marginBottom:18 }}>
        <Kpi label="Tractoras" value={resumen.tractoras ?? resumen.vehiculos ?? 0} tone="info" icon="truck" caption="Disponibles" />
        <Kpi label="Con trabajo" value={resumen.con_trabajo || 0} tone="ok" icon="work" caption="Asignadas hoy" />
        <Kpi label="Sin trabajo" value={resumen.sin_trabajo || 0} tone="info" icon="empty" caption="Sin asignar" />
        <Kpi label="Avisos rojos" value={resumen.avisos_rojos || 0} tone={(resumen.avisos_rojos || 0) ? "danger" : "ok"} icon="alert" caption="Criticos" />
        <Kpi label="Avisos" value={resumen.avisos_amarillos || 0} tone={(resumen.avisos_amarillos || 0) ? "warning" : "ok"} icon="bell" caption="Informativos" />
        <Kpi label="Sin asignar" value={resumen.pedidos_sin_asignar || 0} tone={(resumen.pedidos_sin_asignar || 0) ? "warning" : "ok"} icon="users" caption="Pendientes" />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) 320px", gap:12, alignItems:"start" }}>
        <div style={S.panel}>
          <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
            <colgroup>
              <col style={{ width:116 }} />
              <col style={{ width:118 }} />
              <col style={{ width:170 }} />
              <col />
              <col style={{ width:260 }} />
              <col style={{ width:240 }} />
            </colgroup>
            <thead>
              <tr>
                {["Tractora", "Remolque", "Chofer", "Rutas del dia", "Avisos", "Notas"].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...S.td, textAlign:"center", padding:34, color:"var(--text4)" }}>Cargando plan...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ ...S.td, textAlign:"center", padding:34, color:"var(--text4)" }}>No hay filas para este filtro.</td></tr>
              ) : rows.map(row => {
                const bloqueado = row.avisos?.some(a => a.severity === "danger");
                const warning = !bloqueado && row.avisos?.some(a => a.severity === "warning");
                return (
                  <tr key={row.id} style={{ background:bloqueado ? "rgba(239,68,68,.045)" : warning ? "rgba(245,158,11,.035)" : "transparent" }}>
                    <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace", fontWeight:900, color:bloqueado ? "#ef4444" : "var(--text)" }}>
                      {row.matricula}
                      <div style={{ marginTop:3, fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"var(--text5)" }}>{row.estado || "disponible"}</div>
                    </td>
                    <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace", fontWeight:800, color:row.remolque_matricula ? "#a78bfa" : "var(--text5)" }}>{row.remolque_matricula || "-"}</td>
                    <td style={S.td}>
                      <div style={{ display:"flex", alignItems:"center", gap:9, minWidth:0 }}>
                        <ChoferAvatar row={row} />
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontWeight:850, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row.chofer_nombre || "Sin chofer"}</div>
                          {row.chofer_telefono && <div style={{ fontSize:10, color:"var(--text5)", marginTop:3 }}>{row.chofer_telefono}</div>}
                        </div>
                      </div>
                    </td>
                    <td
                      style={{
                        ...S.td,
                        background: dragOverRow === String(row.id) ? "rgba(20,184,166,.08)" : S.td.background,
                        outline: dragOverRow === String(row.id) ? "2px dashed rgba(20,184,166,.35)" : "none",
                        outlineOffset:-4,
                      }}
                      onDragOver={e => { e.preventDefault(); setDragOverRow(String(row.id)); }}
                      onDragLeave={() => setDragOverRow("")}
                      onDrop={e => dropPedidoOnRow(e, row)}
                    >
                      <div style={{ display:"grid", gap:6 }}>
                        {row.pedidos?.length ? row.pedidos.map(p => <PedidoMini
                          key={p.id}
                          pedido={p}
                          onOpen={openPedido}
                          draggable
                          onDragStart={(e, pedido) => startPedidoDrag(e, pedido, row)}
                          onDragOverPedido={(e) => e.preventDefault()}
                          onDropPedido={(e, target) => reorderPedidoInRow(e, row, target)}
                        />) : (
                          <div style={{ minHeight:34, padding:"8px 10px", border:"1px dashed var(--border2)", borderRadius:7, color:"var(--text5)", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center" }}>Sin trabajo planificado</div>
                        )}
                        {savingPlan && <div style={{fontSize:10,color:"var(--text5)"}}>Guardando asignacion...</div>}
                      </div>
                    </td>
                    <td style={S.td}>
                      <div style={{ display:"grid", gap:6 }}>
                        {row.avisos?.length ? row.avisos.slice(0, 5).map((a, idx) => <AlertBadge key={`${a.source}-${idx}`} aviso={a} />) : (
                          <div style={{ minHeight:34, color:"var(--text5)", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center" }}>Sin avisos</div>
                        )}
                        {row.avisos?.length > 5 && <div style={{ fontSize:10, color:"var(--text5)" }}>+{row.avisos.length - 5} aviso(s) mas</div>}
                      </div>
                    </td>
                    <td style={S.td}>
                      {row.notas_operacion && <div style={{ marginBottom:6, padding:"6px 8px", borderRadius:7, background:"rgba(59,130,246,.08)", color:"#60a5fa", fontSize:11, fontWeight:800 }}>{row.notas_operacion}</div>}
                      <textarea
                        value={notas[row.id] || ""}
                        onChange={e => setNotas(prev => ({ ...prev, [row.id]: e.target.value }))}
                        onBlur={e => saveNote(row, e.target.value)}
                        placeholder="Nota para este dia..."
                        style={{ ...S.input, width:"100%", minHeight:72, resize:"vertical", lineHeight:1.35 }}
                      />
                      {savingNote === String(row.id) && <div style={{ marginTop:4, fontSize:10, color:"var(--text5)" }}>Guardando...</div>}
                      <button
                        onClick={() => copiarPlanChofer(row)}
                        style={{ ...S.btn, marginTop:7, width:"100%", padding:"6px 8px", background:"rgba(16,185,129,.10)", color:"#10b981", border:"1px solid rgba(16,185,129,.24)" }}
                      >
                        Enviar plan por WhatsApp
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside style={S.panel}>
          <div style={{ padding:"10px 12px", borderBottom:"1px solid var(--border)", background:"var(--bg3)" }}>
            <div style={{ fontSize:12, fontWeight:900, color:"var(--text)" }}>Pedidos sin asignacion completa</div>
            <div style={{ fontSize:10, color:"var(--text5)", marginTop:2 }}>Viajes del dia sin tractora valida o sin chofer</div>
          </div>
          <div style={{ padding:10, display:"grid", gap:8 }}>
            {loading ? <div style={{ color:"var(--text4)", fontSize:12 }}>Cargando...</div> : (data.unassigned || []).length === 0 ? (
              <div style={{ color:"var(--text4)", fontSize:12, padding:12 }}>No hay pedidos pendientes de asignacion.</div>
            ) : (data.unassigned || []).map(p => (
              <div key={p.id} style={{ border:"1px solid rgba(245,158,11,.24)", background:"rgba(245,158,11,.08)", borderRadius:8, padding:9 }}>
                <PedidoMini pedido={p} onOpen={openPedido} draggable onDragStart={(e, pedido) => startPedidoDrag(e, pedido, null)} />
                <div style={{ display:"flex", gap:6, marginTop:7, flexWrap:"wrap" }}>
                  {!p.vehiculo_id && <span style={{ fontSize:10, color:"#f59e0b", fontWeight:900 }}>Sin tractora</span>}
                  {!p.chofer_id && <span style={{ fontSize:10, color:"#f59e0b", fontWeight:900 }}>Sin chofer</span>}
                  {p.colaborador_nombre && <span style={{ fontSize:10, color:"#60a5fa", fontWeight:900 }}>{p.colaborador_nombre}</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding:"10px 12px", borderTop:"1px solid var(--border)", borderBottom:"1px solid var(--border)", background:"var(--bg3)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}>
              <div style={{ fontSize:12, fontWeight:900, color:"var(--text)" }}>Avisos del dia</div>
              <span style={{ fontSize:10, color:"var(--text5)", fontWeight:900 }}>{avisosDia.length}</span>
            </div>
            <div style={{ fontSize:10, color:"var(--text5)", marginTop:2 }}>Trafico, mantenimiento, agenda, documentacion y festivos aceptados</div>
          </div>
          <div style={{ padding:10, display:"grid", gap:8 }}>
            {loading ? (
              <div style={{ color:"var(--text4)", fontSize:12 }}>Cargando avisos...</div>
            ) : avisosDia.length ? (
              avisosDia.map(a => <AlertBadge key={a.id} aviso={a} />)
            ) : (
              <div style={{ color:"var(--text4)", fontSize:12, padding:12 }}>Sin avisos relevantes para este dia.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
