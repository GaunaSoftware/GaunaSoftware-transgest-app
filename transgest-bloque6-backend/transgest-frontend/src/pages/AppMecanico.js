import { useEffect, useState } from "react";
import {
  actualizarTallerSolicitud,
  crearTallerIntervencion,
  crearTallerPieza,
  generarTallerPiezaUnidades,
  getTallerIntervenciones,
  getTallerPiezaPorCodigo,
  getTallerPiezas,
  getTallerSolicitudes,
  getVehiculos,
} from "../services/api";
import { notify } from "../services/notify";
import { useAuth } from "../context/AuthContext";

const S = {
  page:{minHeight:"100vh",maxWidth:520,margin:"0 auto",background:"var(--bg)",fontFamily:"'DM Sans',sans-serif",padding:"0 0 84px"},
  head:{position:"sticky",top:0,zIndex:20,background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"14px 16px",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:900,color:"var(--text)"},
  sub:{fontSize:11,color:"var(--text4)",marginTop:2},
  tabs:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",background:"var(--bg2)",borderBottom:"1px solid var(--border)"},
  tab:{padding:"11px 6px",border:"none",background:"transparent",fontSize:12,fontWeight:900,fontFamily:"'DM Sans',sans-serif",cursor:"pointer"},
  card:{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:13},
  btn:{border:"1px solid var(--border2)",borderRadius:9,padding:"9px 11px",fontSize:12,fontWeight:900,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:"var(--bg4)",color:"var(--text)"},
  primary:{background:"var(--accent)",borderColor:"var(--accent)",color:"#fff"},
  inp:{width:"100%",boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",borderRadius:9,padding:"10px 11px",fontSize:13,fontFamily:"'DM Sans',sans-serif"},
  lbl:{display:"block",fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4},
};

function esc(v) {
  return String(v || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function printLabel(item) {
  const code = item.codigo_unidad || item.codigo_barras || item.referencia || "";
  if (!code) return notify("La pieza no tiene codigo escaneable.", "warning");
  const w = window.open("", "_blank", "width=420,height=320");
  if (!w) return notify("El navegador ha bloqueado la impresion.", "warning");
  w.document.write(`<!doctype html><html><head><title>Etiqueta ${esc(code)}</title><style>
    body{margin:0;font-family:Arial,sans-serif;background:#fff;color:#111}
    .label{width:50mm;height:25mm;box-sizing:border-box;padding:2.5mm;border:1px solid #111;display:flex;flex-direction:column;justify-content:center;gap:1.5mm}
    .name{font-size:9px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bar{font-family:'Courier New',monospace;font-size:18px;font-weight:900;letter-spacing:1px}
    .code{font-family:'Courier New',monospace;font-size:8px}
  </style></head><body><div class="label"><div class="name">${esc(item.nombre || item.pieza_nombre || "Pieza")}</div><div class="bar">*${esc(code)}*</div><div class="code">${esc(code)}</div></div><script>window.print();</script></body></html>`);
  w.document.close();
}

function daysSince(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((Date.now() - t) / 86400000));
}

export default function AppMecanico() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("solicitudes");
  const [loading, setLoading] = useState(true);
  const [solicitudes, setSolicitudes] = useState([]);
  const [piezas, setPiezas] = useState([]);
  const [ots, setOts] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [codigo, setCodigo] = useState("");
  const [piezaEncontrada, setPiezaEncontrada] = useState(null);
  const [piezaForm, setPiezaForm] = useState({ nombre:"", referencia:"", codigo_barras:"", categoria:"Otros", stock_actual:1, stock_minimo:1 });
  const [otForm, setOtForm] = useState({ vehiculo_matricula:"", tipo:"Reparacion", descripcion:"" });
  const [generar, setGenerar] = useState({ pieza_id:"", cantidad:1 });

  async function cargar() {
    setLoading(true);
    try {
      const [s, p, o, v] = await Promise.all([
        getTallerSolicitudes().catch(() => []),
        getTallerPiezas().catch(() => []),
        getTallerIntervenciones().catch(() => []),
        getVehiculos().catch(() => []),
      ]);
      setSolicitudes(Array.isArray(s) ? s : []);
      setPiezas(Array.isArray(p) ? p : []);
      setOts(Array.isArray(o) ? o : []);
      setVehiculos(Array.isArray(v) ? v : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  const pendientes = solicitudes.filter(s => !["resuelto","cerrado","cancelado"].includes(String(s.estado || "").toLowerCase()));
  const vehiculosTaller = vehiculos.filter(v => ["taller","averia","en_taller"].includes(String(v.estado || "").toLowerCase()));
  const stockBajo = piezas.filter(p => Number(p.stock_actual || 0) <= Number(p.stock_minimo || 0));
  const abiertas = ots.filter(o => !["cerrada","finalizada"].includes(String(o.estado || "").toLowerCase()));

  async function buscarCodigo() {
    if (!codigo.trim()) return;
    try {
      const data = await getTallerPiezaPorCodigo(codigo.trim());
      setPiezaEncontrada(data);
      notify("Pieza encontrada.", "success");
    } catch (e) {
      setPiezaEncontrada(null);
      notify(e.message || "No se encontro esa pieza.", "warning");
    }
  }

  async function crearPieza() {
    if (!piezaForm.nombre.trim()) return notify("Indica el nombre de la pieza.", "warning");
    const saved = await crearTallerPieza({
      ...piezaForm,
      stock_actual: Number(piezaForm.stock_actual || 0),
      stock_minimo: Number(piezaForm.stock_minimo || 0),
    });
    notify("Pieza creada en stock.", "success");
    setPiezaForm({ nombre:"", referencia:"", codigo_barras:"", categoria:"Otros", stock_actual:1, stock_minimo:1 });
    printLabel(saved);
    await cargar();
  }

  async function generarEtiquetas() {
    if (!generar.pieza_id) return notify("Selecciona una pieza.", "warning");
    const data = await generarTallerPiezaUnidades(generar.pieza_id, { cantidad:Number(generar.cantidad || 1) });
    const unidades = Array.isArray(data?.unidades) ? data.unidades : [];
    unidades.slice(0, 20).forEach(u => printLabel({ ...u, nombre:data?.pieza?.nombre }));
    notify(`${unidades.length || generar.cantidad} etiqueta(s) generadas.`, "success");
    await cargar();
  }

  async function comenzarOt(extra = {}) {
    if (!otForm.vehiculo_matricula && !extra.vehiculo_matricula) return notify("Indica vehiculo o matricula.", "warning");
    await crearTallerIntervencion({
      fecha:new Date().toISOString().slice(0,10),
      tipo: extra.tipo || otForm.tipo || "Reparacion",
      descripcion: extra.descripcion || otForm.descripcion || "Trabajo iniciado desde app mecanico",
      vehiculo_matricula: extra.vehiculo_matricula || otForm.vehiculo_matricula,
      estado:"abierta",
      mecanico_nombre:user?.nombre || user?.email || "",
    });
    if (extra.solicitud_id) {
      await actualizarTallerSolicitud(extra.solicitud_id, { estado:"en_proceso", taller_notas:"Trabajo iniciado desde app mecanico" }).catch(() => {});
    }
    notify("Trabajo iniciado.", "success");
    setOtForm({ vehiculo_matricula:"", tipo:"Reparacion", descripcion:"" });
    await cargar();
  }

  return (
    <div className="tg-app-mecanico-page" style={S.page}>
      <style>{`
        .tg-app-mecanico-page *{box-sizing:border-box;min-width:0}
        @media(max-width:380px){.tg-app-mecanico-grid{grid-template-columns:1fr!important}.tg-app-mecanico-page button{width:100%}}
      `}</style>
      <div style={S.head}>
        <div>
          <div style={S.title}>Taller</div>
          <div style={S.sub}>{user?.nombre || user?.email} · app mecanico</div>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button style={S.btn} onClick={cargar}>Actualizar</button>
          <button style={{...S.btn,background:"rgba(239,68,68,.12)",color:"#ef4444",borderColor:"rgba(239,68,68,.25)"}} onClick={logout}>Salir</button>
        </div>
      </div>

      <div style={S.tabs}>
        {[["solicitudes","Avisos"],["trabajos","Trabajos"],["stock","Stock"],["scan","Escaner"]].map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)} style={{...S.tab,color:tab===id?"var(--accent)":"var(--text4)",borderBottom:`2px solid ${tab===id?"var(--accent)":"transparent"}`}}>
            {label}
          </button>
        ))}
      </div>

      <div style={{padding:14,display:"grid",gap:12}}>
        <div className="tg-app-mecanico-grid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          <Mini label="Solicitudes" value={pendientes.length} tone={pendientes.length ? "#f59e0b" : "var(--green)"} />
          <Mini label="OT abiertas" value={abiertas.length} tone={abiertas.length ? "var(--accent)" : "var(--green)"} />
          <Mini label="Stock bajo" value={stockBajo.length} tone={stockBajo.length ? "#ef4444" : "var(--green)"} />
          <Mini label="En taller" value={vehiculosTaller.length} tone={vehiculosTaller.length ? "#f97316" : "var(--green)"} />
        </div>

        {loading ? <div style={{fontSize:12,color:"var(--text5)"}}>Cargando taller...</div> : null}

        {tab === "solicitudes" && (
          <Section title="Solicitudes y vehiculos en taller">
            {pendientes.map(s => (
              <div key={s.id} style={S.card}>
                <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>{s.vehiculo || s.vehiculo_matricula || "Vehiculo"} · {s.motivo_label || s.motivo || "Solicitud"}</div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:4,lineHeight:1.4}}>{s.observaciones || s.descripcion || "Sin observaciones"}</div>
                <button style={{...S.btn,...S.primary,marginTop:10}} onClick={()=>comenzarOt({ solicitud_id:s.id, vehiculo_matricula:s.vehiculo || s.vehiculo_matricula, tipo:s.motivo_label || "Reparacion", descripcion:s.observaciones || "Solicitud de chofer" })}>
                  Comenzar trabajo
                </button>
              </div>
            ))}
            {!pendientes.length && <Empty text="No hay solicitudes pendientes." />}
            {vehiculosTaller.map(v => (
              <div key={v.id} style={S.card}>
                <div style={{fontSize:13,fontWeight:900,color:"#f97316"}}>{v.matricula} · {daysSince(v.taller_entrada_at || v.updated_at)} dia(s) en taller</div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>{v.marca || ""} {v.modelo || ""}</div>
                <button style={{...S.btn,marginTop:10}} onClick={()=>comenzarOt({ vehiculo_matricula:v.matricula, tipo:"Revision taller", descripcion:"Trabajo iniciado desde vehiculo en taller" })}>Abrir OT</button>
              </div>
            ))}
          </Section>
        )}

        {tab === "trabajos" && (
          <Section title="Comenzar reparacion">
            <Field label="Vehiculo / matricula" value={otForm.vehiculo_matricula} onChange={v=>setOtForm(p=>({...p,vehiculo_matricula:v}))} placeholder="1234-ABC" />
            <Field label="Tipo" value={otForm.tipo} onChange={v=>setOtForm(p=>({...p,tipo:v}))} />
            <Field label="Descripcion" value={otForm.descripcion} onChange={v=>setOtForm(p=>({...p,descripcion:v}))} placeholder="Averia, revision, mantenimiento..." />
            <button style={{...S.btn,...S.primary}} onClick={()=>comenzarOt()}>Comenzar trabajo</button>
            {abiertas.slice(0,8).map(o => (
              <div key={o.id} style={S.card}>
                <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>{o.vehiculo_matricula || "Sin matricula"} · {o.tipo || "OT"}</div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>{o.descripcion || "-"}</div>
              </div>
            ))}
          </Section>
        )}

        {tab === "stock" && (
          <Section title="Stock y etiquetas">
            <Field label="Nombre pieza" value={piezaForm.nombre} onChange={v=>setPiezaForm(p=>({...p,nombre:v}))} placeholder="Filtro aceite..." />
            <Field label="Referencia" value={piezaForm.referencia} onChange={v=>setPiezaForm(p=>({...p,referencia:v,codigo_barras:p.codigo_barras || v}))} />
            <Field label="Codigo barras" value={piezaForm.codigo_barras} onChange={v=>setPiezaForm(p=>({...p,codigo_barras:v}))} />
            <div className="tg-app-mecanico-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <Field label="Stock" type="number" value={piezaForm.stock_actual} onChange={v=>setPiezaForm(p=>({...p,stock_actual:v}))} />
              <Field label="Minimo" type="number" value={piezaForm.stock_minimo} onChange={v=>setPiezaForm(p=>({...p,stock_minimo:v}))} />
            </div>
            <button style={{...S.btn,...S.primary}} onClick={crearPieza}>Crear pieza e imprimir etiqueta</button>
            <div className="tg-app-mecanico-grid" style={{display:"grid",gridTemplateColumns:"1fr 100px",gap:8,alignItems:"end"}}>
              <div>
                <label style={S.lbl}>Generar etiquetas trazables</label>
                <select style={S.inp} value={generar.pieza_id} onChange={e=>setGenerar(p=>({...p,pieza_id:e.target.value}))}>
                  <option value="">Seleccionar pieza...</option>
                  {piezas.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.referencia || p.codigo_barras || ""}</option>)}
                </select>
              </div>
              <Field label="Uds" type="number" value={generar.cantidad} onChange={v=>setGenerar(p=>({...p,cantidad:v}))} />
            </div>
            <button style={S.btn} onClick={generarEtiquetas}>Generar / imprimir etiquetas</button>
          </Section>
        )}

        {tab === "scan" && (
          <Section title="Escanear pieza">
            <input style={S.inp} value={codigo} onChange={e=>setCodigo(e.target.value)} onKeyDown={e=>{ if (e.key === "Enter") buscarCodigo(); }} placeholder="Escanea o escribe codigo..." autoFocus />
            <button style={{...S.btn,...S.primary}} onClick={buscarCodigo}>Buscar codigo</button>
            {piezaEncontrada && (
              <div style={S.card}>
                <div style={{fontSize:14,fontWeight:900,color:"var(--text)"}}>{piezaEncontrada.nombre}</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:4}}>Stock {piezaEncontrada.stock_actual ?? "-"} · {piezaEncontrada.referencia || piezaEncontrada.codigo_barras}</div>
                <button style={{...S.btn,marginTop:10}} onClick={()=>printLabel(piezaEncontrada)}>Imprimir etiqueta</button>
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, tone }) {
  return <div style={{...S.card,padding:10,minHeight:68}}>
    <div style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>{label}</div>
    <div style={{fontSize:22,fontWeight:900,color:tone,marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>{value}</div>
  </div>;
}

function Section({ title, children }) {
  return <div style={{display:"grid",gap:10}}>
    <div style={{fontSize:12,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>{title}</div>
    {children}
  </div>;
}

function Field({ label, value, onChange, placeholder = "", type = "text" }) {
  return <div>
    <label style={S.lbl}>{label}</label>
    <input type={type} style={S.inp} value={value || ""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} />
  </div>;
}

function Empty({ text }) {
  return <div style={{fontSize:12,color:"var(--text5)",padding:"12px 4px"}}>{text}</div>;
}
