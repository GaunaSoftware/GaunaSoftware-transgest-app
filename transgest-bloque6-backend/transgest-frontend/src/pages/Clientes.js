import { useState, useEffect, useCallback } from "react";
import {
  getClientes, crearCliente, editarCliente, borrarCliente,
  getRutasCliente, getRutasClienteSalud, crearRutaCliente, editarRutaCliente, borrarRutaCliente,
  getPedidosCliente, crearFacturaMultiple, getRutas, marcarClienteRevisado,
  crearPortalUsuarioCliente, getClienteIntegracionTokens, crearClienteIntegracionToken, revocarClienteIntegracionToken,
  getFacturas, getPortalSolicitudesAdmin, getPuntosInteres, crearPuntoInteres, editarPuntoInteres, borrarPuntoInteres,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";
import { GeoFields } from "../components/GeoFields";

// ---------------------------------------------------------------------------
const PAISES_ISO = [["ES","España"],["PT","Portugal"],["FR","Francia"],["DE","Alemania"],
  ["IT","Italia"],["NL","Países Bajos"],["BE","Bélgica"],["PL","Polonia"],
  ["MA","Marruecos"],["UK","Reino Unido"],["OTHER","Otro"]];

// ---------------------------------------------------------------------------
// onChange recibe el nombre del campo y el valor: onChange(campo, valor)
function DireccionFields({ prefijo="", values={}, onChange, titulo }) {
  const p = prefijo;
  const set = (campo) => (e) => onChange(campo, e.target.value);
  const inp = {
    background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)",
    padding:"8px 12px", borderRadius:7, fontFamily:"'DM Sans',sans-serif",
    fontSize:13, outline:"none", width:"100%", boxSizing:"border-box",
  };
  const lbl = {
    display:"block", fontSize:10, fontWeight:700, textTransform:"uppercase",
    letterSpacing:".07em", color:"var(--text5)", marginBottom:4, marginTop:8,
  };
  return (
    <div style={{background:"var(--bg3)",borderRadius:10,padding:"14px 16px",border:"1px solid var(--border)"}}>
      {titulo && (
        <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
          letterSpacing:".08em",color:"var(--accent)",marginBottom:10}}>
          {titulo}
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 70px 100px",gap:"0 8px"}}>
        <div>
          <label style={lbl}>Calle / Avenida / Vía</label>
          <input style={inp} value={values[p+"calle"]||""} onChange={set(p+"calle")}
            placeholder="Calle Mayor, Av. de la Paz..."/>
        </div>
        <div>
          <label style={lbl}>Nº</label>
          <input style={inp} value={values[p+"num_ext"]||""} onChange={set(p+"num_ext")}
            placeholder="14"/>
        </div>
        <div>
          <label style={lbl}>Piso / Pta.</label>
          <input style={inp} value={values[p+"piso_puerta"]||""} onChange={set(p+"piso_puerta")}
            placeholder="2ºB"/>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"100px 1fr 1fr 100px",gap:"0 8px",marginTop:2}}>
        <div>
          <label style={lbl}>C. Postal</label>
          <input style={inp} value={values[p+"cod_postal"]||""} onChange={set(p+"cod_postal")}
            placeholder="28001" maxLength={10}/>
        </div>
        <div>
          <label style={lbl}>Municipio / Ciudad</label>
          <input style={inp} value={values[p+"municipio"]||""} onChange={set(p+"municipio")}
            placeholder="Madrid"/>
        </div>
        <GeoFields
          values={values}
          onChange={onChange}
          countryField={p+"pais_iso"}
          regionField={p+"provincia"}
          inputStyle={inp}
          labelStyle={lbl}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const TIPOS_IVA = [
  { value:"general", label:"IVA 21%", pct:21 },
  { value:"reducido", label:"IVA reducido 10%", pct:10 },
  { value:"superreducido", label:"IVA superreducido 4%", pct:4 },
  { value:"cero", label:"IVA 0%", pct:0 },
  { value:"exento", label:"Exento de IVA", pct:0 },
];
const ivaOption = (tipoIva, regimen) => {
  const reg = String(regimen || "").toLowerCase();
  if (TIPOS_IVA.some(o => o.value === reg)) return TIPOS_IVA.find(o => o.value === reg);
  const pct = Number(tipoIva);
  return TIPOS_IVA.find(o => o.pct === pct && o.value !== "exento") || TIPOS_IVA[0];
};
const ivaLabel = (tipoIva, regimen) => ivaOption(tipoIva, regimen).label;
const FORMAS_PAGO = ["transferencia","domiciliacion","cheque","efectivo","confirming"];
const PLAZOS_PAGO_CLIENTE = [
  "Al finalizar viaje",
  "Contado",
  "15 dias fecha factura",
  "30 dias fecha factura",
  "45 dias fecha factura",
  "60 dias fecha factura",
  "90 dias fecha factura",
  "Fin de mes",
  "Fin de mes + 30 dias",
  "Personalizado",
];
function normalizePlazoPagoCliente(value) {
  const raw = String(value || "").trim();
  if (!raw) return "30 dias fecha factura";
  if (/^\d+$/.test(raw)) return `${raw} dias fecha factura`;
  return raw;
}
function plazoPagoSelectValue(value) {
  const normalized = normalizePlazoPagoCliente(value);
  return PLAZOS_PAGO_CLIENTE.includes(normalized) ? normalized : "Personalizado";
}
const TIPO_TARIFA_RUTA = [
  {v:"viaje",l:"Viaje cerrado"},
  {v:"tonelada",l:"Por tonelada"},
  {v:"km",l:"Por kilometro"},
  {v:"hora",l:"Por hora"},
];
const TIPO_VEHICULO_RUTA = [
  {v:"cualquiera",l:"Cualquier vehiculo"},
  {v:"tautliner",l:"Tautliner / lona"},
  {v:"banera",l:"Bañera"},
  {v:"frigorifico",l:"Frigorifico"},
  {v:"cisterna",l:"Cisterna"},
  {v:"caja",l:"Caja cerrada"},
  {v:"adr",l:"ADR"},
];
const ESTADO_COLOR = {pendiente:"#fb8c3a",confirmado:"#3b6ef5",en_curso:"#22d3ee",descarga:"#a78bfa",entregado:"var(--green)",cancelado:"#f05252",incidencia:"#fbbf24"};
const LABEL_ESTADO = {pendiente:"Pendiente",confirmado:"Confirmado",en_curso:"En curso",descarga:"En descarga",entregado:"Entregado",cancelado:"Cancelado",incidencia:"Incidencia"};
const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtTarifaRuta = r => {
  const tipo = String(r?.tarifa_tipo || r?.tipo_precio || "viaje");
  const precio = Number(r?.precio_base ?? r?.precio ?? 0);
  if (!precio) return "-";
  const sufijo = tipo === "tonelada" ? "EUR/tn" : tipo === "km" ? "EUR/km" : tipo === "hora" ? "EUR/h" : "EUR/viaje";
  return `${fmt2(precio)} ${sufijo}`;
};
const fmtMinimoRuta = r => {
  const tipo = String(r?.tarifa_tipo || r?.tipo_precio || "viaje");
  if (tipo === "viaje") return r?.minimo_facturable ? `${fmt2(r.minimo_facturable)} EUR` : "-";
  return r?.minimo_unidades ? `${fmt2(r.minimo_unidades)} u.` : "-";
};
const margenRuta = r => {
  const precio = Number(r?.precio_base ?? r?.precio ?? 0);
  const recargo = Number(r?.recargo_combustible_pct || 0) || 0;
  const km = Number(r?.km || 0);
  const peajes = Number(r?.peajes || 0);
  const tipo = String(r?.tarifa_tipo || r?.tipo_precio || "viaje");
  const costeKm = 0.42 + (km > 0 ? peajes / km : 0);
  const precioFinal = precio * (1 + recargo / 100);
  const ingresoTotal = tipo === "km" ? precioFinal * km : precioFinal;
  const ingresoKm = km > 0 ? (tipo === "km" ? precioFinal : ingresoTotal / km) : 0;
  const margenKm = km > 0 ? ingresoKm - costeKm : 0;
  const margen = km > 0 ? margenKm * km : ingresoTotal - peajes;
  const pct = ingresoKm > 0 ? (margenKm / ingresoKm) * 100 : 0;
  return { margen, pct, margenKm, ingresoKm, costeKm };
};

const rutaEditPayload = r => ({
  ...r,
  tipo_vehiculo: r?.tipo_vehiculo || "cualquiera",
  tarifa_tipo: r?.tarifa_tipo || r?.tipo_precio || "viaje",
  precio_base: r?.precio_base ?? r?.precio ?? "",
  recargo_combustible_pct: r?.recargo_combustible_pct ?? r?.recargo_combustible ?? "",
  minimo_facturable: r?.minimo_facturable ?? "",
  minimo_unidades: r?.minimo_unidades ?? "",
});

// ---------------------------------------------------------------------------
const S = {
  page: {flex:1, padding:"30px 36px", background:"linear-gradient(180deg,#fbfdff 0%,#f8fafc 100%)", minHeight:"100vh", fontFamily:"'DM Sans',sans-serif"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:900,marginBottom:0,color:"var(--text)",letterSpacing:"-.02em"},
  bar:  {display:"flex",gap:12,marginBottom:18,alignItems:"center",flexWrap:"wrap"},
  btn:  {padding:"10px 16px",borderRadius:8,border:"1px solid var(--border2)",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:6,boxShadow:"0 8px 18px rgba(15,23,42,.04)"},
  card: {background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border2)",borderRadius:12,overflow:"hidden",boxShadow:"0 16px 36px rgba(15,23,42,.06)"},
  th:   {textAlign:"left",padding:"14px 18px",fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text4)",borderBottom:"1px solid var(--border2)",background:"var(--bg3)",whiteSpace:"nowrap"},
  td:   {padding:"13px 18px",borderBottom:"1px solid var(--border2)",fontSize:13,color:"var(--text2)",verticalAlign:"middle"},
  inp:  {background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text)",padding:"11px 14px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxShadow:"0 6px 14px rgba(15,23,42,.03)"},
  sel:  {background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text)",padding:"11px 14px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:100,display:"flex",alignItems:"stretch",justifyContent:"center",padding:12,overflow:"hidden"},
  mbox: {background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border2)",borderRadius:8,padding:24,width:"min(1320px,calc(100vw - 24px))",height:"calc(100vh - 24px)",maxHeight:"calc(100vh - 24px)",overflowY:"auto",overflowX:"hidden"},
  lbl:  {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:5,marginTop:12},
  sec:  {fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".1em",color:"var(--accent)",marginTop:20,marginBottom:8,paddingBottom:6,borderBottom:"1px solid var(--border)"},
  tab:  {padding:"7px 16px",border:"none",borderBottom:"2px solid transparent",background:"none",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"},
};

// ---------------------------------------------------------------------------
// Subcomponente: Ficha de cliente (modal completo con tabs)
// ---------------------------------------------------------------------------
function normalizarHorarioHabitual(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalizeTime = (t) => {
    const clean = String(t || "").trim().replace(/[hH]\.?$/, "").replace(".", ":");
    const m = clean.match(/^(\d{1,2})(?::?(\d{2}))?$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = m[2] === undefined ? 0 : Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  const parts = raw
    .replace(/,/g, ";")
    .replace(/\r?\n/g, ";")
    .replace(/[–—]/g, "-")
    .replace(/\s+a\s+/gi, "-")
    .split(";")
    .map(p => p.trim())
    .filter(Boolean);
  const out = [];
  for (const part of parts) {
    const [start, end] = part.split("-").map(x => x.trim());
    const a = normalizeTime(start);
    const b = normalizeTime(end);
    if (!a || !b) throw new Error("Horario no valido. Usa, por ejemplo: 08:00-13:30; 15:00-18:00");
    out.push(`${a}-${b}`);
  }
  return out.join("; ");
}

function splitEmailList(value) {
  return String(value || "")
    .split(/[;,\n\r]+/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
}

function normalizeEmailListText(value) {
  return splitEmailList(value).join("\n");
}

function emailListFields(value) {
  const raw = String(value || "");
  if (!raw.trim()) return [""];
  return raw.split(/\r?\n/);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizePaisIso(value) {
  const raw = String(value || "ES").trim();
  const upper = raw.toUpperCase();
  if (PAISES_ISO.some(([code]) => code === upper)) return upper;
  const plain = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const aliases = { espana:"ES", portugal:"PT", francia:"FR", alemania:"DE", italia:"IT", paises_bajos:"NL", belgica:"BE", polonia:"PL", marruecos:"MA", reino_unido:"UK" };
  return aliases[plain.replace(/\s+/g, "_")] || "OTHER";
}

function puntoToClienteAddressPatch(punto = {}, prefijo = "") {
  return {
    [prefijo + "calle"]: punto.direccion || "",
    [prefijo + "num_ext"]: "",
    [prefijo + "piso_puerta"]: "",
    [prefijo + "cod_postal"]: punto.codigo_postal || "",
    [prefijo + "municipio"]: punto.ciudad || "",
    [prefijo + "provincia"]: punto.provincia || "",
    [prefijo + "pais_iso"]: normalizePaisIso(punto.pais || "ES"),
  };
}

function PuntoClienteSelector({ cliente, onApply }) {
  const [query, setQuery] = useState("");
  const [puntos, setPuntos] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setPuntos([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      getPuntosInteres({ q, ...(cliente?.id ? { cliente_id: cliente.id } : {}) })
        .then(data => { if (alive) setPuntos(Array.isArray(data) ? data : []); })
        .catch(() => { if (alive) setPuntos([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [cliente?.id, query]);

  const vinculados = puntos.filter(p => cliente?.id && String(p.cliente_id || "") === String(cliente.id));
  const ordenados = [...vinculados, ...puntos.filter(p => !vinculados.some(v => String(v.id) === String(p.id)))].slice(0, 12);

  return (
    <div style={{gridColumn:"1/-1",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
        <div style={{flex:"1 1 280px"}}>
          <label style={{...S.lbl,marginTop:0}}>Buscar punto guardado</label>
          <input
            style={S.inp}
            value={query}
            onChange={e=>setQuery(e.target.value)}
            placeholder="Nombre, direccion o poblacion del punto"
          />
        </div>
        <div style={{fontSize:11,color:"var(--text5)",paddingBottom:8}}>
          {loading ? "Buscando..." : query.trim().length >= 2 ? `${ordenados.length} resultado(s)` : "Escribe al menos 2 caracteres"}
        </div>
      </div>
      {ordenados.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:8,marginTop:10}}>
          {ordenados.map(p => (
            <div key={p.id || `${p.nombre}-${p.direccion}`} style={{border:"1px solid var(--border2)",borderRadius:8,padding:10,background:"var(--bg2)"}}>
              <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{p.nombre || "Punto sin nombre"}</div>
              <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>{p.direccion || "-"}{p.ciudad ? ` - ${p.ciudad}` : ""}</div>
              {cliente?.id && String(p.cliente_id || "") === String(cliente.id) && (
                <div style={{fontSize:10,color:"var(--green)",fontWeight:900,marginTop:4}}>Vinculado a este cliente</div>
              )}
              {!p.cliente_id && (
                <div style={{fontSize:10,color:"var(--accent)",fontWeight:900,marginTop:4}}>Punto general</div>
              )}
              <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                <button type="button" onClick={()=>onApply(p, "")} style={{...S.btn,background:"rgba(59,110,245,.10)",color:"var(--accent)",border:"1px solid rgba(59,110,245,.22)",padding:"6px 10px",fontSize:11,boxShadow:"none"}}>
                  Usar social
                </button>
                <button type="button" onClick={()=>onApply(p, "fiscal_")} style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid var(--border2)",padding:"6px 10px",fontSize:11,boxShadow:"none"}}>
                  Usar fiscal
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientePuntosPanel({ cliente, canEdit }) {
  const emptyPointForm = {
    nombre: "",
    tipo: "ambos",
    direccion: "",
    ciudad: "",
    provincia: "",
    pais: "Espana",
    codigo_postal: "",
    ventana: "",
    contacto_nombre: "",
    contacto_telefono: "",
    email: "",
    notas: "",
    google_maps_url: "",
    punto_general: false,
  };
  const pointToForm = (punto = {}) => {
    const metadata = punto.metadata && typeof punto.metadata === "object" ? punto.metadata : {};
    return {
      ...emptyPointForm,
      ...punto,
      punto_general: punto.punto_general ?? punto.es_general ?? !punto.cliente_id,
      google_maps_url: punto.google_maps_url || metadata.google_maps_url || "",
      contacto_nombre: punto.contacto_nombre || metadata.contacto_nombre || metadata.contacto || "",
      contacto_telefono: punto.contacto_telefono || metadata.contacto_telefono || metadata.telefono_contacto || "",
      email: punto.email || metadata.email || "",
      notas: punto.notas || metadata.notas || "",
    };
  };
  const [puntos, setPuntos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPoint, setEditingPoint] = useState(null);
  const [form, setForm] = useState(emptyPointForm);

  const cargar = useCallback(() => {
    if (!cliente?.id) return;
    setLoading(true);
    getPuntosInteres({ cliente_id: cliente.id })
      .then(data => setPuntos(Array.isArray(data) ? data : []))
      .catch(() => setPuntos([]))
      .finally(() => setLoading(false));
  }, [cliente?.id]);

  useEffect(() => { cargar(); }, [cargar]);

  function set(k, value) {
    setForm(prev => ({ ...prev, [k]: value }));
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.nombre.trim() || !form.direccion.trim()) {
      notify("Indica nombre y direccion del punto", "warning");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        cliente_id: form.punto_general ? "" : cliente.id,
        nombre: form.nombre.trim(),
        direccion: form.direccion.trim(),
        ciudad: form.ciudad.trim(),
        provincia: form.provincia.trim(),
        codigo_postal: form.codigo_postal.trim(),
        google_maps_url: form.google_maps_url.trim(),
      };
      if (editingPoint?.id) await editarPuntoInteres(editingPoint.id, payload);
      else await crearPuntoInteres(payload);
      notify(editingPoint?.id ? "Punto actualizado" : (form.punto_general ? "Punto general creado" : "Punto vinculado al cliente creado"), "success");
      setEditingPoint(null);
      setForm(emptyPointForm);
      cargar();
    } catch (err) {
      notify(err?.message || "No se pudo guardar el punto", "error");
    } finally {
      setSaving(false);
    }
  }

  function editar(punto) {
    setEditingPoint(punto);
    setForm(pointToForm(punto));
  }

  function cancelarEdicion() {
    setEditingPoint(null);
    setForm(emptyPointForm);
  }

  async function borrar(punto) {
    const ok = await confirmDialog({
      title: "Eliminar punto",
      message: `Eliminar "${punto.nombre || "punto"}"? No se eliminan los pedidos ya creados.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    try {
      await borrarPuntoInteres(punto.id);
      notify("Punto eliminado", "success");
      cargar();
    } catch (err) {
      notify(err?.message || "No se pudo eliminar el punto", "error");
    }
  }

  const input = { ...S.inp, minWidth:0 };

  return (
    <div style={{display:"grid",gap:14}}>
      <div style={{background:"rgba(14,165,164,.08)",border:"1px solid rgba(14,165,164,.22)",borderRadius:10,padding:"12px 14px",fontSize:12,color:"var(--text3)",lineHeight:1.45}}>
        Los campos de origen y destino escritos en pedidos son poblaciones. Si necesitas muelle, cantera, almacen, obra o direccion concreta, crealo aqui como punto de carga, descarga o ambos.
      </div>

      {canEdit && (
        <form onSubmit={guardar} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
            <div>
              <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>{editingPoint?.id ? "Ficha del punto" : "Nuevo punto"}</div>
              <div style={{fontSize:11,color:"var(--text4)"}}>{editingPoint?.id ? "Revisa y actualiza los datos guardados del punto." : `Por defecto queda asociado a ${cliente?.nombre}. Marca general si lo quieres reutilizar en otros clientes.`}</div>
            </div>
            <label style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:12,fontWeight:800,color:"var(--text3)"}}>
              <input type="checkbox" checked={form.punto_general} onChange={e=>set("punto_general", e.target.checked)} />
              Punto general
            </label>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
            <div><label style={S.lbl}>Nombre *</label><input style={input} value={form.nombre} onChange={e=>set("nombre", e.target.value)} placeholder="Almacen, cantera, obra..." /></div>
            <div><label style={S.lbl}>Tipo</label><select style={input} value={form.tipo} onChange={e=>set("tipo", e.target.value)}><option value="ambos">Carga y descarga</option><option value="carga">Carga</option><option value="descarga">Descarga</option></select></div>
            <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Direccion *</label><input style={input} value={form.direccion} onChange={e=>set("direccion", e.target.value)} placeholder="Calle, poligono, acceso o enlace de Maps" /></div>
            <div><label style={S.lbl}>Poblacion</label><input style={input} value={form.ciudad} onChange={e=>set("ciudad", e.target.value)} /></div>
            <div><label style={S.lbl}>Provincia / region</label><input style={input} value={form.provincia} onChange={e=>set("provincia", e.target.value)} /></div>
            <div><label style={S.lbl}>CP</label><input style={input} value={form.codigo_postal} onChange={e=>set("codigo_postal", e.target.value)} /></div>
            <div><label style={S.lbl}>Pais</label><input style={input} value={form.pais} onChange={e=>set("pais", e.target.value)} /></div>
            <div><label style={S.lbl}>Ventana horaria</label><input style={input} value={form.ventana} onChange={e=>set("ventana", e.target.value)} placeholder="08:00-14:00" /></div>
            <div><label style={S.lbl}>Contacto</label><input style={input} value={form.contacto_nombre} onChange={e=>set("contacto_nombre", e.target.value)} /></div>
            <div><label style={S.lbl}>Telefono contacto</label><input style={input} value={form.contacto_telefono} onChange={e=>set("contacto_telefono", e.target.value)} /></div>
            <div><label style={S.lbl}>Email contacto</label><input style={input} value={form.email || ""} onChange={e=>set("email", e.target.value)} /></div>
            <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Enlace Maps / HERE</label><input style={input} value={form.google_maps_url} onChange={e=>set("google_maps_url", e.target.value)} placeholder="Opcional" /></div>
            <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Notas operativas</label><textarea style={{...input,minHeight:74,resize:"vertical"}} value={form.notas || ""} onChange={e=>set("notas", e.target.value)} placeholder="Entrada, muelle, persona de contacto, instrucciones..." /></div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
            <button type="submit" disabled={saving} style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:saving?0.6:1}}>
              {saving ? "Guardando..." : (editingPoint?.id ? "Guardar cambios" : "Crear punto")}
            </button>
            {editingPoint?.id && (
              <button type="button" onClick={cancelarEdicion} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)"}}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden"}}>
        <div style={{padding:"10px 12px",fontSize:12,fontWeight:900,color:"var(--text3)",borderBottom:"1px solid var(--border)"}}>
          Puntos del cliente y puntos generales disponibles
        </div>
        {loading ? (
          <div style={{padding:18,textAlign:"center",color:"var(--text4)",fontSize:12}}>Cargando puntos...</div>
        ) : puntos.length === 0 ? (
          <div style={{padding:18,textAlign:"center",color:"var(--text4)",fontSize:12}}>Sin puntos guardados.</div>
        ) : (
          <div style={{display:"grid",gap:8,padding:10}}>
            {puntos.map(p => (
              <div key={p.id} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"center",border:"1px solid var(--border2)",borderRadius:8,padding:10,background:p.cliente_id ? "rgba(16,185,129,.07)" : "var(--bg3)"}}>
                <div style={{minWidth:0}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    <b style={{fontSize:13,color:"var(--text)"}}>{p.nombre}</b>
                    <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:p.cliente_id ? "var(--green)" : "var(--accent)"}}>{p.cliente_id ? "Cliente" : "General"}</span>
                    <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:"var(--text5)"}}>{p.tipo || "ambos"}</span>
                  </div>
                  <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>{[p.direccion, p.codigo_postal, p.ciudad, p.provincia, p.pais].filter(Boolean).join(" - ")}</div>
                  {(p.ventana || p.contacto_nombre || p.contacto_telefono) && (
                    <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>{[p.ventana, p.contacto_nombre, p.contacto_telefono].filter(Boolean).join(" | ")}</div>
                  )}
                  {(p.google_maps_url || p.email || p.notas) && (
                    <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>
                      {[p.google_maps_url ? "Maps configurado" : "", p.email, p.notas].filter(Boolean).join(" | ")}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <button type="button" onClick={()=>editar(p)} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--accent)",padding:"7px 10px"}}>Abrir ficha</button>
                    <button type="button" onClick={()=>borrar(p)} style={{...S.btn,background:"rgba(239,68,68,.10)",border:"1px solid rgba(239,68,68,.25)",color:"#ef4444",padding:"7px 10px"}}>Eliminar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function buildClienteForm(cliente) {
  const source = cliente || {};
  const plazoPago = normalizePlazoPagoCliente(source.dias_pago || source.vencimiento || "30 dias fecha factura");
  return {
    tipo_iva:"21",
    iva_regimen:"general",
    pais:"ES",
    forma_pago:"transferencia",
    ...source,
    calle: source.calle || source.direccion || "",
    num_ext: source.num_ext || "",
    piso_puerta: source.piso_puerta || "",
    cod_postal: source.cod_postal || source.codigo_postal || source.cp || "",
    municipio: source.municipio || source.ciudad || "",
    provincia: source.provincia || "",
    pais_iso: normalizePaisIso(source.pais_iso || source.pais || "ES"),
    contacto_nombre: source.contacto_nombre || source.contacto || "",
    contacto_telefono: source.contacto_telefono || "",
    dias_pago: plazoPago,
    dias_pago_custom: PLAZOS_PAGO_CLIENTE.includes(plazoPago) ? "" : plazoPago,
    emails_albaranes: normalizeEmailListText(source.emails_albaranes || ""),
  };
}

function FichaCliente({ cliente, onClose, onSaved, rutasGlobales, clientesExistentes = [] }) {
  const { puedeEditar } = useAuth();
  const canEdit = puedeEditar("clientes");
  const esNuevo = !cliente;

  const [tab,       setTab]       = useState("datos");
  const [form,      setForm]      = useState(() => buildClienteForm(cliente));
  const [saving,    setSaving]    = useState(false);

  // Rutas del cliente
  const [rutas,     setRutas]     = useState([]);
  const [rutasLoad, setRutasLoad] = useState(false);
  const [rutasSalud, setRutasSalud] = useState(null);
  const [modalRuta, setModalRuta] = useState(false);
  const [editRuta,  setEditRuta]  = useState(null);
  const [formRuta,  setFormRuta]  = useState({});
  const [rutasResaltadas, setRutasResaltadas] = useState(new Set());

  // Historial pedidos
  const [pedidos,   setPedidos]   = useState([]);
  const [pedLoad,   setPedLoad]   = useState(false);
  const [portalFact, setPortalFact] = useState([]);
  const [portalSols, setPortalSols] = useState([]);
  const [portalLoad, setPortalLoad] = useState(false);
  const [portalCreds, setPortalCreds] = useState(null);
  const [portalSaving, setPortalSaving] = useState(false);
  const [integracionTokens, setIntegracionTokens] = useState([]);
  const [integracionTokenNuevo, setIntegracionTokenNuevo] = useState(null);
  const [integracionSaving, setIntegracionSaving] = useState(false);
  const [mesFiltro, setMesFiltro] = useState("");
  const [selPedidos,setSelPedidos]= useState(new Set());
  const [facturando,setFacturando]= useState(false);

  const f  = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const fIva = e => {
    const opt = TIPOS_IVA.find(o => o.value === e.target.value) || TIPOS_IVA[0];
    setForm(p=>({...p,iva_regimen:opt.value,tipo_iva:opt.pct}));
  };
  const fr = k => e => setFormRuta(p=>({...p,[k]:e.target.value}));

  // Cargar rutas
  const cargarRutas = useCallback(async () => {
    if (!cliente?.id) return;
    setRutasLoad(true);
    try {
      const [directas, salud] = await Promise.all([
        getRutasCliente(cliente.id).catch(()=>[]),
        getRutasClienteSalud(cliente.id).catch(()=>null),
      ]);
      const arr = Array.isArray(directas) ? directas : [];
      const fallback = (Array.isArray(rutasGlobales) ? rutasGlobales : [])
        .filter(r => String(r.cliente_id || "") === String(cliente.id));
      const byId = new Map();
      [...fallback, ...arr].forEach(r => byId.set(String(r.id || r.ruta_id), r));
      setRutas(Array.from(byId.values()));
      setRutasSalud(salud);
    }
    finally { setRutasLoad(false); }
  }, [cliente?.id, rutasGlobales]);

  // Cargar pedidos
  const cargarPedidos = useCallback(async () => {
    if (!cliente?.id) return;
    setPedLoad(true);
    const params = mesFiltro ? { mes: mesFiltro } : {};
    try { const d = await getPedidosCliente(cliente.id, params); setPedidos(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[])); }
    catch { setPedidos([]); }
    finally { setPedLoad(false); }
  }, [cliente?.id, mesFiltro]);

  useEffect(() => { if (tab==="rutas")    cargarRutas();  }, [tab, cargarRutas]);
  useEffect(() => { if (tab==="pedidos"||tab==="portal") cargarPedidos();}, [tab, cargarPedidos, mesFiltro]);
  useEffect(() => {
    if (tab !== "portal" || esNuevo || !cliente?.id) return;
    setPortalLoad(true);
    Promise.all([
      getFacturas({cliente_id: cliente.id, limit:50}).catch(()=>[]),
      getPortalSolicitudesAdmin({cliente_id: cliente.id}).catch(()=>[]),
      getClienteIntegracionTokens(cliente.id).catch(()=>[]),
    ])
      .then(([facturas, solicitudes, tokens]) => {
        setPortalFact(Array.isArray(facturas?.data)?facturas.data:Array.isArray(facturas)?facturas:[]);
        setPortalSols(Array.isArray(solicitudes)?solicitudes:[]);
        setIntegracionTokens(Array.isArray(tokens)?tokens:[]);
      })
      .finally(()=>setPortalLoad(false));
  }, [tab, cliente?.id, esNuevo]);

  // Guardar cliente
  async function guardarCliente() {
    if (!form.nombre) { notify("El nombre es obligatorio", "warning"); return; }
    const emailsAlbaranes = splitEmailList(form.emails_albaranes);
    const invalidEmails = emailsAlbaranes.filter(v => !isValidEmail(v));
    if (invalidEmails.length) {
      notify(`Revisa estos correos de albaranes: ${invalidEmails.join(", ")}`, "warning");
      return;
    }
    const cifKey = String(form.cif || "").trim().toUpperCase();
    if (cifKey && !cifKey.startsWith("CLI-")) {
      const duplicado = clientesExistentes.find(c =>
        c?.id !== cliente?.id &&
        c?.activo !== false &&
        String(c?.cif || "").trim().toUpperCase() === cifKey
      );
      if (duplicado) {
        notify(`Ya existe un cliente activo con el CIF ${cifKey}: ${duplicado.nombre || "sin nombre"}. Abre esa ficha o da de baja el duplicado antes de crear otro.`, "error");
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        direccion: [form.calle, form.num_ext, form.piso_puerta].map(v=>String(v || "").trim()).filter(Boolean).join(" "),
        cp: form.cod_postal || "",
        ciudad: form.municipio || "",
        pais: form.pais_iso || "ES",
        contacto: form.contacto_nombre || "",
        vencimiento: normalizePlazoPagoCliente(form.dias_pago === "Personalizado" ? form.dias_pago_custom : form.dias_pago),
        emails_albaranes: emailsAlbaranes.join("\n"),
        horario_carga: normalizarHorarioHabitual(form.horario_carga),
        horario_descarga: normalizarHorarioHabitual(form.horario_descarga),
      };
      const saved = esNuevo ? await crearCliente(payload) : await editarCliente(cliente.id, payload);
      if (!saved?.id) throw new Error("El servidor no ha confirmado el cliente. No repitas el alta: recarga la lista y revisa la API.");
      notify(esNuevo ? "Cliente creado correctamente." : "Cliente actualizado correctamente.", "success");
      onSaved?.(saved);
    } catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  // Guardar ruta
  async function guardarRuta() {
    if (!formRuta.origen || !formRuta.destino) { notify("Origen y destino obligatorios", "warning"); return; }
    setSaving(true);
    try {
      if (editRuta) await editarRutaCliente(cliente.id, editRuta.id, formRuta);
      else          await crearRutaCliente(cliente.id, formRuta);
      setModalRuta(false);
      cargarRutas();
    } catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  async function eliminarRuta(ruta) {
    const ok = await confirmDialog({
      title: "Eliminar ruta",
      message: `Eliminar ruta ${ruta.origen} -> ${ruta.destino}?`,
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try { await borrarRutaCliente(cliente.id, ruta.id); cargarRutas(); }
    catch(e) { notify(e.message, "error"); }
  }

  function abrirRuta(ruta) {
    if (!ruta) return;
    setEditRuta(ruta);
    setFormRuta(rutaEditPayload(ruta));
    setModalRuta(true);
  }

  function rutasFromIssue(issue = {}) {
    const ids = new Set([
      issue.ruta_id,
      ...(Array.isArray(issue.ruta_ids) ? issue.ruta_ids : []),
    ].filter(Boolean).map(String));
    if (!ids.size) return [];
    return rutas.filter(r => ids.has(String(r.ruta_id || r.id)) || ids.has(String(r.id)));
  }

  function verRutasIssue(issue) {
    const afectadas = rutasFromIssue(issue);
    if (!afectadas.length) return;
    setRutasResaltadas(new Set(afectadas.map(r => String(r.id))));
    document.getElementById("cliente-rutas-table")?.scrollIntoView({ behavior:"smooth", block:"start" });
    setTimeout(() => setRutasResaltadas(new Set()), 9000);
  }

  async function corregirIssueRuta(issue) {
    const ruta = rutasFromIssue(issue)[0];
    if (!ruta) return;
    const payload = rutaEditPayload(ruta);
    if (issue.key === "minimo_incoherente") {
      if ((payload.tarifa_tipo || "viaje") === "viaje") {
        payload.minimo_unidades = "";
      } else if (payload.minimo_facturable && !payload.minimo_unidades) {
        payload.minimo_unidades = payload.minimo_facturable;
        payload.minimo_facturable = "";
      } else {
        payload.minimo_facturable = "";
      }
    } else if (issue.key === "minimo_toneladas_kg") {
      const raw = Number(payload.minimo_unidades || 0);
      if (Math.abs(raw) >= 1000) payload.minimo_unidades = String(Number((raw / 1000).toFixed(3)));
      payload.minimo_facturable = "";
    } else {
      abrirRuta(ruta);
      return;
    }
    setSaving(true);
    try {
      await editarRutaCliente(cliente.id, ruta.id, payload);
      notify("Ruta corregida.", "success");
      cargarRutas();
    } catch(e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function descargarPlantillaTarifas() {
    const rows = [
      ["cliente_nombre","origen","destino","km","tipo_vehiculo","tarifa_tipo","precio_base","minimo_unidades","minimo_facturable_eur","recargo_combustible_pct","peajes","tiempo_h","notas"],
      [form.nombre || "CEMENTOS CAPA, S.L.","CEMENTOS CAPA ABANILLA","ELCHE","50","cualquiera","tonelada","5.47","25","","0","0","1","Ejemplo tarifa por tonelada con minimo 25T"],
      [form.nombre || "CEMENTOS CAPA, S.L.","ABANILLA","ZARAGOZA","504","cualquiera","viaje","672.25","","","0","0","7.5","Ejemplo viaje cerrado"],
    ];
    const csv = rows.map(cols => cols.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const name = String(form.nombre || "cliente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "cliente";
    a.href = url;
    a.download = `plantilla-tarifas-${name}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify("Plantilla de tarifas descargada.", "success");
  }

  async function crearAccesoPortal(resetPassword = false) {
    if (!cliente?.id) return;
    setPortalSaving(true);
    try {
      const res = await crearPortalUsuarioCliente(cliente.id, { reset_password: resetPassword });
      setPortalCreds(res);
      if (res?.password_temporal) {
        notify(resetPassword ? "Contraseña temporal regenerada" : "Acceso de portal creado", "success");
      } else if (res?.exists) {
        notify("Este cliente ya tiene usuario de portal activo", "info");
      }
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setPortalSaving(false);
    }
  }

  async function generarTokenIntegracion() {
    if (!cliente?.id) return;
    setIntegracionSaving(true);
    try {
      const res = await crearClienteIntegracionToken(cliente.id, { nombre: "Integracion EDI/API cliente", dias: 365, scopes:["manifest","feed"] });
      setIntegracionTokenNuevo(res);
      const tokens = await getClienteIntegracionTokens(cliente.id).catch(()=>[]);
      setIntegracionTokens(Array.isArray(tokens) ? tokens : []);
      notify("Token tecnico EDI/API generado. Copialo ahora.", "success");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setIntegracionSaving(false);
    }
  }

  async function revocarTokenIntegracion(tokenId) {
    if (!cliente?.id || !tokenId) return;
    const ok = await confirmDialog({
      title: "Revocar token EDI/API",
      message: "El conector externo dejara de poder consultar el feed de este cliente con este token.",
      confirmText: "Revocar",
      tone: "danger",
    });
    if (!ok) return;
    setIntegracionSaving(true);
    try {
      await revocarClienteIntegracionToken(cliente.id, tokenId);
      const tokens = await getClienteIntegracionTokens(cliente.id).catch(()=>[]);
      setIntegracionTokens(Array.isArray(tokens) ? tokens : []);
      notify("Token tecnico revocado.", "success");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setIntegracionSaving(false);
    }
  }

  // Facturar pedidos seleccionados
  async function facturarSeleccionados() {
    const lista = pedidos.filter(p => selPedidos.has(p.id));
    if (!lista.length) { notify("Selecciona al menos un pedido", "warning"); return; }

    // Check for already invoiced
    const yaFacturados = lista.filter(p => p.facturado || p.factura_id);
    if (yaFacturados.length > 0) {
      notify(`${yaFacturados.length} pedido(s) ya estan facturados:\n${yaFacturados.map(p=>p.numero).join(", ")}\n\nDeseleccionalos para continuar.`, "warning");
      return;
    }

    const mesRef = mesFiltro || new Date().toISOString().slice(0,7);
    const base   = lista.reduce((s,p)=>s+Number(p.importe||0),0);
    const ivaObj = ivaOption(form.tipo_iva, form.iva_regimen);
    const iva    = ivaObj.value === "exento" ? "exento" : String(ivaObj.pct);
    const ivaNum = ivaObj.pct;
    const total  = base * (1 + ivaNum/100);
    const estadosPendientes = lista.filter(p => !["entregado","facturado"].includes(p.estado));

    // Confirmation
    const msg = [
      `FACTURAR ${lista.length} PEDIDO${lista.length!==1?"S":""}`,
      `Cliente: ${cliente.nombre}`,
      `Importe base: ${fmt2(base)} EUR`,
      `IVA ${iva==="exento"?"exento":`${iva}%`}: ${fmt2(total-base)} EUR`,
      `TOTAL: ${fmt2(total)} EUR`,
      "",
      estadosPendientes.length > 0
        ? `${estadosPendientes.length} pedido(s) pasarán a "Entregado"`
        : "",
      "¿Crear borrador de factura? (Administración la emitirá desde Facturación)",
    ].filter(Boolean).join("\n");

    const ok = await confirmDialog({
      title: "Crear factura borrador",
      message: msg,
      confirmText: "Crear borrador",
    });
    if (!ok) return;

    setFacturando(true);
    try {
      const { cambiarEstadoPedido } = await import("../services/api");
      await crearFacturaMultiple({
        cliente_id:   cliente.id,
        pedidos_ids:  lista.map(p=>p.id),
        serie:        "A",
        fecha:        new Date().toISOString().slice(0,10),
        estado:       "borrador",  // Admin emite desde Facturación
        observaciones:`Servicios de transporte - ${mesRef}`,
        lineas: lista.map(p=>({
          concepto:    `${p.numero} - ${p.origen||""}${p.destino?" -> "+p.destino:""}`,
          cantidad:    1,
          precio_unit: Number(p.importe || 0),
        })),
      });
      // Update pedido states to entregado
      await Promise.all(estadosPendientes.map(p =>
        cambiarEstadoPedido(p.id, "entregado").catch(()=>{})
      ));
      setSelPedidos(new Set());
      cargarPedidos();
      notify(`Factura emitida con ${lista.length} pedido${lista.length!==1?"s":""} por ${fmt2(total)} EUR (IVA incl.)`, "success");
    } catch(e) { notify("Error: " + e.message, "error"); }
    finally { setFacturando(false); }
  }

  function togglePedido(id) {
    setSelPedidos(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function seleccionarMes() {
    const pendientes = pedidos.filter(p=>p.estado!=="cancelado"&&!p.facturado);
    setSelPedidos(new Set(pendientes.map(p=>p.id)));
  }

  const TABS = [
    {id:"datos", l:"Datos"},
    {id:"puntos", l:"Puntos"},
    {id:"facturacion", l:"Facturación"},
    {id:"rutas", l:"Rutas y tarifas"},
    {id:"pedidos", l:"Histórico"},
    {id:"portal", l:"Portal cliente"},
  ];

  const totalSeleccionado = pedidos.filter(p=>selPedidos.has(p.id)).reduce((s,p)=>s+Number(p.importe||0),0);
  const emailsAlbaranesFields = emailListFields(form.emails_albaranes);

  function setEmailAlbaranField(index, value) {
    const next = [...emailsAlbaranesFields];
    next[index] = value;
    setForm(p => ({ ...p, emails_albaranes: next.join("\n") }));
  }

  function addEmailAlbaranField() {
    setForm(p => ({ ...p, emails_albaranes: `${String(p.emails_albaranes || "").trimEnd()}${String(p.emails_albaranes || "").trim() ? "\n" : ""}` }));
    setTimeout(() => {
      const inputs = document.querySelectorAll("[data-email-albaran-input='1']");
      inputs[inputs.length - 1]?.focus?.();
    }, 0);
  }

  function removeEmailAlbaranField(index) {
    const next = emailsAlbaranesFields.filter((_, i) => i !== index);
    setForm(p => ({ ...p, emails_albaranes: (next.length ? next : [""]).join("\n") }));
  }

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.mbox}>
        {/* Cabecera */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:19,fontWeight:800,color:"var(--text)"}}>
              {esNuevo ? "Nuevo cliente" : form.nombre}
            </div>
            {!esNuevo && <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{form.cif||"Sin CIF"}</div>}
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:13,cursor:"pointer",padding:4}}>Cerrar</button>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:0,borderBottom:"1px solid var(--border)",marginBottom:18,marginTop:12}}>
          {(esNuevo ? TABS.filter(t => ["datos","facturacion"].includes(t.id)) : TABS).map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{...S.tab, borderBottomColor:tab===t.id?"#3b6ef5":"transparent",
                      color:tab===t.id?"var(--accent-xl)":"var(--text4)"}}>
              {t.l}
            </button>
          ))}
        </div>

        {/* TAB: Datos */}
        {tab==="datos" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}>
              <label style={S.lbl}>Nombre / Razón social *</label>
              <input style={S.inp} value={form.nombre||""} onChange={f("nombre")} placeholder="Empresa S.L."/>
            </div>
            {[["cif","CIF / NIF","B-12345678"],["telefono","Teléfono","912 345 678"],
              ["email","Email","contacto@empresa.com"],["web","Web","www.empresa.com"],
              ["contacto_nombre","Persona de contacto"],["contacto_telefono","Tel. contacto"]
            ].map(([k,l,ph])=>(
              <div key={k}><label style={S.lbl}>{l}</label>
              <input style={S.inp} value={form[k]||""} onChange={f(k)} placeholder={ph||""}/></div>
            ))}
            <div style={{gridColumn:"1/-1",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:6}}>
                <div>
                  <label style={{...S.lbl,marginTop:0}}>Correos para envio de albaranes</label>
                  <div style={{fontSize:10,color:"var(--text5)"}}>Aparecen en la orden de carga como destinatarios de albaranes firmados.</div>
                </div>
                <button type="button" onClick={addEmailAlbaranField} style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.28)",padding:"6px 10px",fontSize:11}}>
                  + Anadir correo
                </button>
              </div>
              <div style={{display:"grid",gap:7}}>
                {emailsAlbaranesFields.map((mail, idx) => (
                  <div key={idx} style={{display:"flex",gap:7,alignItems:"center"}}>
                    <input
                      data-email-albaran-input="1"
                      type="email"
                      style={{...S.inp,flex:1}}
                      value={mail}
                      onChange={e=>setEmailAlbaranField(idx, e.target.value)}
                      placeholder={idx === 0 ? "albaranes@cliente.com" : "otro-correo@cliente.com"}
                    />
                    <button
                      type="button"
                      onClick={()=>removeEmailAlbaranField(idx)}
                      disabled={emailsAlbaranesFields.length === 1 && !mail}
                      style={{...S.btn,background:"transparent",color:"var(--text4)",border:"1px solid var(--border2)",padding:"7px 10px",opacity:(emailsAlbaranesFields.length === 1 && !mail)?0.45:1}}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {/* Dirección social */}
            <div style={{gridColumn:"1/-1"}}>
              <PuntoClienteSelector
                cliente={cliente}
                onApply={(punto, prefijo) => setForm(prev => ({
                  ...prev,
                  ...puntoToClienteAddressPatch(punto, prefijo),
                  ...(prefijo === "fiscal_" ? { dir_fiscal_distinta: true } : {}),
                }))}
              />
              <DireccionFields
                titulo="Dirección social / operativa"
                values={form}
                onChange={(campo, valor) => setForm(p => ({...p, [campo]: valor}))}
              />
            </div>

            {/* Dirección fiscal diferente */}
            <div style={{gridColumn:"1/-1"}}>
              {/* Toggle */}
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",
                background:form.dir_fiscal_distinta?"rgba(59,130,246,.08)":"var(--bg3)",
                border:`1px solid ${form.dir_fiscal_distinta?"rgba(59,130,246,.3)":"var(--border)"}`,
                borderRadius:8,cursor:"pointer",userSelect:"none",transition:"all .15s"}}>
                <div style={{position:"relative",width:38,height:22,flexShrink:0}}>
                  <div style={{position:"absolute",inset:0,background:form.dir_fiscal_distinta?"var(--accent)":"var(--bg4)",
                    borderRadius:11,border:"1px solid var(--border2)",transition:"background .2s"}}/>
                  <div style={{position:"absolute",top:3,left:form.dir_fiscal_distinta?18:3,width:16,height:16,
                    background:"#fff",borderRadius:"50%",transition:"left .2s",
                    boxShadow:"0 1px 3px rgba(0,0,0,.3)"}}/>
                  <input type="checkbox" checked={!!form.dir_fiscal_distinta}
                    onChange={e=>setForm(p=>({...p,dir_fiscal_distinta:e.target.checked}))}
                    style={{position:"absolute",opacity:0,inset:0,cursor:"pointer",margin:0}}/>
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>
                    La dirección fiscal es diferente a la social
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:1}}>
                    {form.dir_fiscal_distinta
                      ? "Ambas direcciones aparecerán en la factura"
                      : "Activa esto si la dirección de facturación es diferente"}
                  </div>
                </div>
              </label>

              {/* Dirección fiscal */}
              {form.dir_fiscal_distinta && (
                <div style={{marginTop:10}}>
                  <DireccionFields
                    titulo="Dirección fiscal / de facturación"
                    prefijo="fiscal_"
                    values={form}
                    onChange={(campo, valor) => setForm(p => ({...p, [campo]: valor}))}
                  />
                </div>
              )}
            </div>
            <div>
              <label style={S.lbl}>Notas internas</label>
              <input style={S.inp} value={form.notas||""} onChange={f("notas")} placeholder="Observaciones..."/>
            </div>
            <div>
              <label style={S.lbl}>Límite de riesgo (EUR) - 0 = sin límite</label>
              <input type="number" step="100" style={S.inp} value={form.limite_riesgo||""} onChange={f("limite_riesgo")} placeholder="Ej: 5000 - bloquea nuevos viajes si deuda supera este importe"/>
              <label style={{display:"flex",gap:10,alignItems:"center",padding:"10px 12px",margin:"10px 0",borderRadius:8,border:"1px solid rgba(239,68,68,.24)",background:form.bloqueado?"rgba(239,68,68,.08)":"rgba(248,250,252,.78)",cursor:"pointer"}}>
                <input
                  type="checkbox"
                  checked={!!form.bloqueado}
                  onChange={e=>setForm(p=>({...p,bloqueado:e.target.checked}))}
                  style={{width:16,height:16,accentColor:"#ef4444"}}
                />
                <span>
                  <span style={{display:"block",fontSize:13,fontWeight:900,color:form.bloqueado?"#b91c1c":"var(--text)"}}>Bloquear cliente</span>
                  <span style={{display:"block",fontSize:11,color:"var(--text4)",marginTop:2}}>Impide crear nuevos viajes hasta desactivar el bloqueo.</span>
                </span>
              </label>
              <label style={S.lbl}>Motivo del bloqueo</label>
              <input style={S.inp} value={form.bloqueo_motivo||""} onChange={f("bloqueo_motivo")} placeholder="Ej: impago, documentacion pendiente, decision comercial..."/>
              <label style={S.lbl}>Minimo facturable por toneladas (T)</label>
              <input type="number" step="0.01" style={S.inp} value={form.minimo_facturable_toneladas||""} onChange={f("minimo_facturable_toneladas")} placeholder="Ej: 25"/>
              <label style={S.lbl}>Modo de facturación</label>
              <select style={S.sel} value={form.modo_facturacion||"por_viaje"} onChange={f("modo_facturacion")}>
                <option value="por_viaje">Por viaje (una factura por viaje)</option>
                <option value="agrupada_linea">Agrupada - Una línea por período</option>
                <option value="agrupada_detalle">Agrupada - Línea por cada viaje</option>
                <option value="agrupada_kg">Agrupada por kg (con desglose de tarifas)</option>
              </select>
            </div>
          </div>
        )}

        {/* TAB: Facturación */}
        {tab==="puntos" && !esNuevo && (
          <ClientePuntosPanel cliente={cliente} canEdit={canEdit} />
        )}

        {tab==="facturacion" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label style={S.lbl}>Tipo de IVA</label>
              <select value={ivaOption(form.tipo_iva, form.iva_regimen).value} onChange={fIva} style={S.sel}>
                {TIPOS_IVA.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Condicion de pago</label>
              <select
                value={plazoPagoSelectValue(form.dias_pago)}
                onChange={e=>setForm(p=>({
                  ...p,
                  dias_pago: e.target.value,
                  dias_pago_custom: e.target.value === "Personalizado" ? (p.dias_pago_custom || (!PLAZOS_PAGO_CLIENTE.includes(p.dias_pago) ? p.dias_pago : "")) : "",
                }))}
                style={S.sel}
              >
                {PLAZOS_PAGO_CLIENTE.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {plazoPagoSelectValue(form.dias_pago) === "Personalizado" && (
              <div>
                <label style={S.lbl}>Condicion personalizada</label>
                <input style={S.inp} value={form.dias_pago_custom||""} onChange={f("dias_pago_custom")} placeholder="Ej: 60 dias fecha recepcion factura"/>
              </div>
            )}
            <div>
              <label style={S.lbl}>Forma de pago</label>
              <select value={form.forma_pago||"transferencia"} onChange={f("forma_pago")} style={S.sel}>
                {FORMAS_PAGO.map(fp=><option key={fp} value={fp}>{fp.charAt(0).toUpperCase()+fp.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>IBAN</label>
              <input style={S.inp} value={form.iban||""} onChange={f("iban")} placeholder="ES91 2100 0418 ..."/>
            </div>
            <div style={{gridColumn:"1/-1"}}>
              <label style={S.lbl}>Email de facturación (si diferente)</label>
              <input style={S.inp} value={form.email_facturacion||""} onChange={f("email_facturacion")}/>
            </div>
            <div>
              <label style={S.lbl}>Horario de carga habitual</label>
              <input style={S.inp} value={form.horario_carga||""} onChange={f("horario_carga")}
                onBlur={e=>{ try { setForm(p=>({...p, horario_carga: normalizarHorarioHabitual(e.target.value)})); } catch(err) { notify(err.message, "warning"); } }}
                placeholder="08:00-13:30; 15:00-18:00" title="Se auto-rellena en ventana de carga al crear pedidos"/>
              <div style={{fontSize:10,color:"var(--text5)",marginTop:4}}>Admite horario partido separado por punto y coma.</div>
            </div>
            <div>
              <label style={S.lbl}>Horario de descarga habitual</label>
              <input style={S.inp} value={form.horario_descarga||""} onChange={f("horario_descarga")}
                onBlur={e=>{ try { setForm(p=>({...p, horario_descarga: normalizarHorarioHabitual(e.target.value)})); } catch(err) { notify(err.message, "warning"); } }}
                placeholder="08:00-13:30; 15:00-18:00"/>
              <div style={{fontSize:10,color:"var(--text5)",marginTop:4}}>Ejemplo valido: 08:00-13:30; 15:00-18:00.</div>
            </div>
          </div>
        )}


        {/* TAB: Rutas y tarifas */}
        {tab==="rutas" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:12,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:12,color:"var(--text4)"}}>Rutas pactadas con este cliente, con su tarifa real, minimo y recargo de combustible.</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Aqui se define el precio que luego usan pedidos, trafico y facturacion.</div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",border:"1px solid var(--border)",padding:"6px 12px",fontSize:12}}
                  onClick={descargarPlantillaTarifas}>
                  Plantilla tarifas CSV
                </button>
                {canEdit && (
                  <button style={{...S.btn,background:"#3b6ef5",color:"#fff",padding:"6px 14px",fontSize:12}}
                    onClick={()=>{setEditRuta(null);setFormRuta({tarifa_tipo:"viaje",tipo_vehiculo:"cualquiera",precio_base:"",minimo_facturable:"",minimo_unidades:"",recargo_combustible_pct:""});setModalRuta(true);}}>
                    + Nueva ruta
                  </button>
                )}
              </div>
            </div>
            {rutasSalud?.resumen && (
              <div style={{border:"1px solid var(--border)",background:"var(--bg3)",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",color:"var(--text5)",marginBottom:5}}>Salud de rutas y tarifas</div>
                    <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.45}}>
                      Detecta duplicidades, tipos de tarifa mezclados, rutas sin precio, sin km o minimos incoherentes antes de crear pedidos.
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {[
                      ["Bloqueos", rutasSalud.resumen.bloqueantes || 0, Number(rutasSalud.resumen.bloqueantes||0)>0?"#ef4444":"var(--green)"],
                      ["Avisos", rutasSalud.resumen.avisos || 0, Number(rutasSalud.resumen.avisos||0)>0?"#f59e0b":"var(--green)"],
                      ["Rutas", rutasSalud.resumen.total_rutas || 0, "var(--accent-xl)"],
                    ].map(([label,value,color])=>(
                      <div key={label} style={{minWidth:72,background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 9px"}}>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:900,color}}>{value}</div>
                        <div style={{fontSize:9,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {!!rutasSalud.issues?.length && (
                  <div style={{display:"grid",gap:6,marginTop:10}}>
                    {rutasSalud.issues.slice(0,8).map((i,idx)=>{
                      const afectadas = rutasFromIssue(i);
                      const canAutoFix = ["minimo_incoherente", "minimo_toneladas_kg"].includes(i.key) && afectadas.length > 0;
                      return (
                      <div key={`${i.key}-${i.ruta_id || idx}`} style={{border:`1px solid ${i.severity==="alta"?"rgba(239,68,68,.25)":"rgba(245,158,11,.25)"}`,background:i.severity==="alta"?"rgba(239,68,68,.06)":"rgba(245,158,11,.06)",borderRadius:8,padding:"9px 10px"}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"start"}}>
                          <div>
                            <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                              <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{i.label}</div>
                              <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:i.severity==="alta"?"#ef4444":"#f59e0b"}}>{i.severity}</div>
                            </div>
                            <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.4,marginTop:3}}>{i.detail} {i.action}</div>
                          </div>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                            {afectadas.length > 0 && (
                              <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",border:"1px solid var(--border)",padding:"5px 9px",fontSize:11}}
                                onClick={()=>verRutasIssue(i)}>
                                Ver
                              </button>
                            )}
                            {afectadas[0] && (
                              <button style={{...S.btn,background:"rgba(59,110,245,.12)",color:"var(--accent-xl)",border:"1px solid rgba(59,110,245,.25)",padding:"5px 9px",fontSize:11}}
                                onClick={()=>abrirRuta(afectadas[0])}>
                                Editar
                              </button>
                            )}
                            {canAutoFix && canEdit && (
                              <button style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)",padding:"5px 9px",fontSize:11}}
                                onClick={()=>corregirIssueRuta(i)}>
                                Corregir
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )})}
                  </div>
                )}
              </div>
            )}
            {rutasLoad ? <div style={{textAlign:"center",color:"var(--text4)",padding:30}}>Cargando...</div>
            : rutas.length===0 ? (
              <div style={{textAlign:"center",color:"var(--text4)",padding:30,background:"var(--bg3)",borderRadius:10}}>
                Sin rutas configuradas. {canEdit&&"Anade la primera con el boton de arriba."}
              </div>
            ) : (
              <div id="cliente-rutas-table" style={{width:"100%",overflowX:"auto",border:"1px solid var(--border)",borderRadius:10,background:"var(--bg2)"}}>
              <table style={{width:"100%",minWidth:980,borderCollapse:"collapse"}}>
                <thead><tr>
                  {["Origen","Destino","Km","Tipo vehiculo","Tarifa","Minimo","Combustible","EUR/km","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rutas.map(r=>{
                    const resaltada = rutasResaltadas.has(String(r.id));
                    return (
                    <tr key={r.id} style={{background:resaltada ? "rgba(59,110,245,.12)" : "transparent",outline:resaltada ? "2px solid rgba(59,110,245,.35)" : "none",outlineOffset:-2}}>
                      <td style={{...S.td,fontWeight:600}}>{r.origen}</td>
                      <td style={{...S.td,fontWeight:600}}>{r.destino}</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"var(--accent-xl)"}}>{r.km||"-"}</td>
                      <td style={{...S.td,color:"var(--text2)"}}>{TIPO_VEHICULO_RUTA.find(t=>t.v===(r.tipo_vehiculo||"cualquiera"))?.l || r.tipo_vehiculo || "Cualquiera"}</td>
                      <td style={{...S.td,fontWeight:700,color:"var(--green)"}}>{fmtTarifaRuta(r)}</td>
                      <td style={{...S.td,color:"var(--text2)"}}>{fmtMinimoRuta(r)}</td>
                      <td style={{...S.td,color:"#f59e0b"}}>{Number(r.recargo_combustible_pct||0) ? `${fmt2(r.recargo_combustible_pct)} %` : "-"}</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace"}}
                        title={`Ingreso ${fmt2(margenRuta(r).ingresoKm)} EUR/km - coste ${fmt2(margenRuta(r).costeKm)} EUR/km - margen total ${fmt2(margenRuta(r).margen)} EUR`}>
                        {r.km ? (() => {
                          const m = margenRuta(r);
                          return (
                            <div style={{display:"grid",gap:2}}>
                              <span style={{fontSize:11,color:"var(--text4)"}}>Ing. {fmt2(m.ingresoKm)}</span>
                              <span style={{fontSize:11,color:"var(--text5)"}}>Coste {fmt2(m.costeKm)}</span>
                              <span style={{fontWeight:900,color:m.margenKm>=0?"var(--green)":"#ef4444"}}>Margen {fmt2(m.margenKm)}</span>
                            </div>
                          );
                        })() : "-"}
                      </td>
                      <td style={S.td}>
                        {canEdit&&<div style={{display:"flex",gap:6}}>
                          <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"3px 9px",fontSize:11}}
                            onClick={()=>abrirRuta(r)}>Editar</button>
                          <button style={{...S.btn,background:"rgba(240,82,82,.1)",color:"#f05252",padding:"3px 9px",fontSize:11}}
                            onClick={()=>eliminarRuta(r)}>X</button>
                        </div>}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
              </div>
            )}
            {modalRuta && (
              <div style={{...S.modal,zIndex:200}} onClick={e=>e.target===e.currentTarget&&setModalRuta(false)}>
                <div style={{...S.mbox,width:"min(620px,96vw)"}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,marginBottom:18,color:"var(--text)"}}>{editRuta?"Editar ruta":"Nueva ruta para "+form.nombre}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><label style={S.lbl}>Origen *</label><input style={S.inp} value={formRuta.origen||""} onChange={fr("origen")}/></div>
                    <div><label style={S.lbl}>Destino *</label><input style={S.inp} value={formRuta.destino||""} onChange={fr("destino")}/></div>
                    <div><label style={S.lbl}>Kilometros</label><input type="number" style={S.inp} value={formRuta.km||""} onChange={fr("km")}/></div>
                    <div><label style={S.lbl}>Tiempo estimado (h)</label><input type="number" step="0.5" style={S.inp} value={formRuta.tiempo_h||""} onChange={fr("tiempo_h")}/></div>
                    <div><label style={S.lbl}>Peajes (EUR)</label><input type="number" step="0.01" style={S.inp} value={formRuta.peajes||""} onChange={fr("peajes")}/></div>
                    <div><label style={S.lbl}>Tipo de vehiculo / remolque</label>
                      <select value={formRuta.tipo_vehiculo||"cualquiera"} onChange={fr("tipo_vehiculo")} style={S.sel}>
                        {TIPO_VEHICULO_RUTA.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                      </select>
                    </div>
                    <div><label style={S.lbl}>Tipo de tarifa</label>
                      <select value={formRuta.tarifa_tipo||"viaje"} onChange={fr("tarifa_tipo")} style={S.sel}>
                        {TIPO_TARIFA_RUTA.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                      </select>
                    </div>
                    <div><label style={S.lbl}>Precio base</label><input type="number" step="0.01" style={S.inp} value={formRuta.precio_base||""} onChange={fr("precio_base")} placeholder="0.00"/></div>
                    <div><label style={S.lbl}>{(formRuta.tarifa_tipo||"viaje")==="viaje"?"Minimo facturable (EUR)":"Minimo de unidades"}</label>
                      <input type="number" step="0.01" style={S.inp} value={(formRuta.tarifa_tipo||"viaje")==="viaje"?(formRuta.minimo_facturable||""):(formRuta.minimo_unidades||"")} onChange={e=>setFormRuta(p=>({...p,[(p.tarifa_tipo||"viaje")==="viaje"?"minimo_facturable":"minimo_unidades"]:e.target.value}))}/></div>
                    <div><label style={S.lbl}>Recargo combustible (%)</label><input type="number" step="0.1" style={S.inp} value={formRuta.recargo_combustible_pct||""} onChange={fr("recargo_combustible_pct")} placeholder="0"/></div>
                    <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Notas</label><input style={S.inp} value={formRuta.notas||""} onChange={fr("notas")}/></div>
                  </div>
                  <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
                    <button style={{...S.btn,background:"transparent",color:"var(--text2)",border:"1px solid var(--border2)"}} onClick={()=>setModalRuta(false)}>Cancelar</button>
                    <button style={{...S.btn,background:"#3b6ef5",color:"#fff"}} onClick={guardarRuta} disabled={saving}>{saving?"Guardando...":editRuta?"Guardar":"Crear ruta"}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: Histórico pedidos */}
        {tab==="pedidos" && (
          <div>
            {/* Filtros y acciones */}
            <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
              <input type="month" value={mesFiltro} onChange={e=>setMesFiltro(e.target.value)}
                style={{...S.inp,width:170}} title="Filtrar por mes de carga"/>
              {mesFiltro && <button style={{...S.btn,background:"transparent",color:"var(--text4)",border:"1px solid var(--border2)",padding:"6px 10px",fontSize:12}} onClick={()=>setMesFiltro("")}>x Quitar filtro</button>}
              <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"6px 12px",fontSize:12}} onClick={seleccionarMes}>Seleccionar mes actual</button>
              {selPedidos.size > 0 && (
                <button
                  style={{...S.btn,background:"var(--green)",color:"var(--bg)",marginLeft:"auto",fontWeight:700}}
                  onClick={facturarSeleccionados} disabled={facturando}>
                  {facturando?"Creando...": `Facturar ${selPedidos.size} pedido${selPedidos.size!==1?"s":""} - ${fmt2(totalSeleccionado)} EUR`}
                </button>
              )}
            </div>

            {/* Resumen rápido */}
            {pedidos.length > 0 && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                {[
                  {l:"Total período",v:`${fmt2(pedidos.reduce((s,p)=>s+Number(p.importe||0),0))} EUR`,c:"var(--text)"},
                  {l:"Pedidos",      v:pedidos.length, c:"var(--accent-xl)"},
                  {l:"Sin facturar", v:pedidos.filter(p=>!p.facturado&&p.estado!=="cancelado").length, c:"#fb8c3a"},
                ].map((k,i)=>(
                  <div key={i} style={{background:"var(--bg3)",borderRadius:8,padding:"10px 14px"}}>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:k.c}}>{k.v}</div>
                    <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text4)",marginTop:3}}>{k.l}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={S.card}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr>
                  <th style={{...S.th,width:36}}><input type="checkbox"
                    checked={selPedidos.size===pedidos.filter(p=>!p.facturado&&p.estado!=="cancelado").length&&pedidos.length>0}
                    onChange={e=>e.target.checked?seleccionarMes():setSelPedidos(new Set())}
                    style={{accentColor:"#3b6ef5"}}/></th>
                  {["Nº Pedido","Origen -> Destino","F. Carga","Estado","Tipo precio","Importe","Facturado"].map(h=><th key={h} style={S.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {pedLoad ? <tr><td colSpan={8} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Cargando...</td></tr>
                  : pedidos.length===0 ? <tr><td colSpan={8} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Sin pedidos{mesFiltro?` en ${mesFiltro}`:""}</td></tr>
                  : pedidos.map(p=>{
                    const c = ESTADO_COLOR[p.estado]||"var(--text2)";
                    const canSel = !p.facturado && p.estado!=="cancelado";
                    return (
                      <tr key={p.id} style={{opacity:p.estado==="cancelado"?.5:1}}>
                        <td style={{...S.td,textAlign:"center"}}>
                          {canSel && <input type="checkbox" checked={selPedidos.has(p.id)}
                            onChange={()=>togglePedido(p.id)} style={{accentColor:"#3b6ef5"}}/>}
                        </td>
                        <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--accent-xl)"}}>{p.numero}</td>
                        <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>{p.origen&&p.destino?`${p.origen} -> ${p.destino}`:"-"}</td>
                        <td style={{...S.td,fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"var(--text4)"}}>{p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):"-"}</td>
                        <td style={S.td}><span style={{display:"inline-flex",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:`${c}1a`,color:c}}>{LABEL_ESTADO[p.estado]||p.estado}</span></td>
                        <td style={{...S.td,fontSize:11,color:"var(--text2)"}}>{p.tipo_precio||"viaje"}</td>
                        <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--text)"}}>{fmt2(p.importe)} EUR</td>
                        <td style={S.td}>
                          {p.facturado
                            ? <span style={{display:"inline-flex",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:"rgba(34,211,160,.12)",color:"var(--green)"}}> Facturado</span>
                            : <span style={{display:"inline-flex",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:"rgba(251,140,58,.12)",color:"#fb8c3a"}}>Pendiente</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB: PORTAL CLIENTE */}
        {tab==="portal" && (
          <div>
            {/* Header con enlace de acceso */}
            <div style={{background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.2)",
              borderRadius:10,padding:"14px 16px",marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:13,color:"var(--accent)",marginBottom:6}}>
                Portal de seguimiento para {cliente?.nombre}
              </div>
              <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>
                Tu cliente puede seguir sus envíos y descargar facturas. Comparte su acceso desde Usuarios & Roles.
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <div style={{background:"var(--bg3)",borderRadius:6,padding:"6px 12px",fontSize:11,
                  color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>
                  Rol: <b style={{color:"var(--accent)"}}>cliente</b> - CIF: {cliente?.cif||"-"}
                </div>
                <div style={{background:"var(--bg3)",borderRadius:6,padding:"6px 12px",fontSize:11,color:"var(--text4)"}}>
                  Email acceso: <b style={{color:"var(--text)"}}>{cliente?.email||"Sin email configurado"}</b>
                </div>
              </div>
              <div style={{marginTop:12,fontSize:12,color:"var(--text3)"}}>
                Portal unico por empresa y cliente. Aunque otra empresa trabaje con el mismo CIF, sus solicitudes, pedidos, albaranes y facturas no se mezclan.
              </div>
              {!esNuevo && canEdit && (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
                  <button type="button" disabled={portalSaving} onClick={()=>crearAccesoPortal(false)}
                    style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:portalSaving?0.6:1}}>
                    Crear acceso portal
                  </button>
                  <button type="button" disabled={portalSaving} onClick={()=>crearAccesoPortal(true)}
                    style={{...S.btn,background:"var(--bg3)",color:"var(--text)",border:"1px solid var(--border2)",opacity:portalSaving?0.6:1}}>
                    Resetear clave
                  </button>
                </div>
              )}
              {portalCreds?.usuario && (
                <div style={{marginTop:12,background:"rgba(16,185,129,.09)",border:"1px solid rgba(16,185,129,.25)",
                  borderRadius:8,padding:"10px 12px",fontSize:12,color:"var(--text3)"}}>
                  <b style={{color:"var(--green)"}}>Acceso portal:</b>{" "}
                  usuario <code style={{color:"var(--text)"}}>{portalCreds.usuario.username || portalCreds.usuario.email}</code>
                  {portalCreds.password_temporal && <> - clave temporal <code style={{color:"var(--text)"}}>{portalCreds.password_temporal}</code></>}
                  {!portalCreds.password_temporal && " - ya existe usuario activo"}
                </div>
              )}
              <div style={{marginTop:12,background:"rgba(139,92,246,.08)",border:"1px solid rgba(139,92,246,.22)",borderRadius:8,padding:"10px 12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:800,color:"#a78bfa"}}>Credencial tecnica EDI/API</div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>
                      Token revocable para que el cliente sincronice manifesto y feed sin login manual.
                    </div>
                  </div>
                  {canEdit && (
                    <button type="button" disabled={integracionSaving} onClick={generarTokenIntegracion}
                      style={{...S.btn,background:"#7c3aed",color:"#fff",opacity:integracionSaving?0.6:1}}>
                      Generar token
                    </button>
                  )}
                </div>
                {integracionTokenNuevo?.token && (
                  <div style={{marginTop:10,background:"rgba(16,185,129,.09)",border:"1px solid rgba(16,185,129,.25)",borderRadius:7,padding:"8px 10px",fontSize:11,color:"var(--text3)",lineHeight:1.5}}>
                    <b style={{color:"var(--green)"}}>Token creado. Copiar ahora:</b><br/>
                    <code style={{color:"var(--text)",wordBreak:"break-all"}}>{integracionTokenNuevo.token}</code>
                  </div>
                )}
                <div style={{display:"grid",gap:6,marginTop:10}}>
                  {integracionTokens.length === 0 ? (
                    <div style={{fontSize:11,color:"var(--text5)"}}>Sin tokens tecnicos creados.</div>
                  ) : integracionTokens.slice(0, 5).map(t => (
                    <div key={t.id} style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",fontSize:11,color:"var(--text4)",borderTop:"1px solid rgba(148,163,184,.14)",paddingTop:6}}>
                      <span style={{minWidth:0}}>
                        <b style={{color:t.activo ? "var(--green)" : "#ef4444"}}>{t.activo ? "Activo" : "Revocado"}</b>{" "}
                        <code style={{color:"var(--text3)"}}>{t.token_mask}</code>
                        {Array.isArray(t.scopes) && t.scopes.length ? ` - ${t.scopes.join("+")}` : ""}
                        {t.last_used_at ? ` - usado ${new Date(t.last_used_at).toLocaleString("es-ES")}` : " - sin uso"}
                        {` - uso ${Number(t.usage_count || 0)} - ventana ${Number(t.window_count || 0)}/${Number(t.rate_limit_per_hour || 120)}`}
                        {t.last_rate_limit_at ? ` - bloqueado ${new Date(t.last_rate_limit_at).toLocaleString("es-ES")}` : ""}
                      </span>
                      {canEdit && t.activo && (
                        <button type="button" disabled={integracionSaving} onClick={()=>revocarTokenIntegracion(t.id)}
                          style={{...S.btn,padding:"5px 8px",fontSize:10,background:"rgba(239,68,68,.12)",border:"1px solid rgba(239,68,68,.3)",color:"#fca5a5"}}>
                          Revocar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Pedidos activos - seguimiento en tiempo real */}
            <div style={{fontWeight:700,fontSize:12,color:"var(--text3)",
              textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>
              Envíos activos
            </div>
            {pedLoad
              ? <div style={{color:"var(--text4)",fontSize:12,padding:"20px 0",textAlign:"center"}}>Cargando...</div>
              : (()=>{
                  const activos = pedidos.filter(p=>!["cancelado","facturado"].includes(p.estado));
                  if (!activos.length) return (
                    <div style={{color:"var(--text4)",fontSize:12,textAlign:"center",padding:"16px 0",
                      background:"var(--bg3)",borderRadius:8,marginBottom:14}}>
                      Sin envíos activos en este momento
                    </div>
                  );
                  const ESTADOS_TIMELINE = [
                    {k:"pendiente",    l:"Pendiente",   icon:""},
                    {k:"confirmado",   l:"Confirmado",  icon:""},
                    {k:"en_curso",     l:"En tránsito", icon:""},
                    {k:"descarga",     l:"En descarga", icon:""},
                    {k:"entregado",    l:"Entregado",   icon:""},
                  ];
                  return activos.map(p=>{
                    const stIdx = ESTADOS_TIMELINE.findIndex(e=>e.k===p.estado);
                    return (
                      <div key={p.id} style={{background:"var(--bg3)",border:"1px solid var(--border2)",
                        borderRadius:10,padding:"14px 16px",marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                          <div>
                            <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,
                              fontSize:13,color:"var(--accent)"}}>{p.numero}</span>
                            {p.referencia_cliente&&<span style={{fontSize:11,color:"var(--text4)",
                              marginLeft:8}}>Ref: {p.referencia_cliente}</span>}
                          </div>
                          <span style={{fontSize:11,color:"var(--text4)"}}>
                            {p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):"-"}
                          </span>
                        </div>
                        <div style={{fontWeight:600,fontSize:12,color:"var(--text2)",marginBottom:10}}>
                          {p.origen||"-"} -> {p.destino||"-"}
                        </div>
                        {/* Estado timeline */}
                        <div style={{display:"flex",gap:4,alignItems:"center"}}>
                          {ESTADOS_TIMELINE.map((st,i)=>{
                            const done = i<=stIdx;
                            const curr = i===stIdx;
                            return (
                              <div key={st.k} style={{display:"flex",alignItems:"center",flex:i<ESTADOS_TIMELINE.length-1?1:"none"}}>
                                <div style={{textAlign:"center",minWidth:60}}>
                                  <div style={{width:28,height:28,borderRadius:"50%",margin:"0 auto 3px",
                                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,
                                    background:curr?"#3b6ef5":done?"rgba(16,185,129,.2)":"var(--bg4)",
                                    border:curr?"2px solid #3b6ef5":done?"2px solid rgba(16,185,129,.6)":"1px solid var(--border2)",
                                    color:curr?"#fff":done?"var(--green)":"var(--text5)"}}>
                                    {curr?"●":done?"":"○"}
                                  </div>
                                  <div style={{fontSize:9,color:curr?"var(--accent)":done?"var(--green)":"var(--text5)",
                                    fontWeight:curr||done?700:400,lineHeight:1.2}}>{st.icon}<br/>{st.l}</div>
                                </div>
                                {i<ESTADOS_TIMELINE.length-1&&(
                                  <div style={{flex:1,height:2,background:i<stIdx?"rgba(16,185,129,.4)":"var(--border2)",margin:"0 2px 14px"}}/>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {p.vehiculo_matricula&&(
                          <div style={{marginTop:8,fontSize:11,color:"var(--text4)"}}>
                            {p.vehiculo_matricula}
                            {p.chofer_nombre&&` - Chófer: ${p.chofer_nombre}${p.chofer_apellidos?" "+p.chofer_apellidos:""}`}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()
            }

            {/* Solicitudes del portal */}
            <div style={{fontWeight:700,fontSize:12,color:"var(--text3)",
              textTransform:"uppercase",letterSpacing:".08em",marginTop:18,marginBottom:10}}>
              Solicitudes del portal
            </div>
            {portalLoad
              ? <div style={{color:"var(--text4)",fontSize:12,padding:"16px 0",textAlign:"center"}}>Cargando solicitudes...</div>
              : portalSols.length===0
              ? <div style={{color:"var(--text4)",fontSize:12,textAlign:"center",padding:"16px 0",
                  background:"var(--bg3)",borderRadius:8,marginBottom:14}}>Sin solicitudes enviadas desde el portal</div>
              : (
                <div style={{...S.card,marginBottom:14}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>
                      {["Fecha","Origen / destino","Referencia","Carga","Estado","Pedido","Movimientos"].map(h=>(
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {portalSols.slice(0,8).map(sol=>{
                        const estadoColor = {pendiente:"#f97316",revisada:"#3b6ef5",convertida:"var(--green)",descartada:"#ef4444"}[sol.estado]||"var(--text4)";
                        return (
                          <tr key={sol.id}>
                            <td style={{...S.td,fontSize:11}}>{sol.created_at?new Date(sol.created_at).toLocaleDateString("es-ES"):"-"}</td>
                            <td style={{...S.td,fontSize:12,color:"var(--text)"}}>{sol.origen||"-"} -> {sol.destino||"-"}</td>
                            <td style={{...S.td,fontSize:11,color:"var(--text4)"}}>{sol.referencia_cliente||"-"}</td>
                            <td style={{...S.td,fontSize:11}}>{sol.fecha_carga?new Date(sol.fecha_carga).toLocaleDateString("es-ES"):"-"}</td>
                            <td style={S.td}>
                              <span style={{display:"inline-flex",padding:"2px 8px",borderRadius:20,
                                fontSize:11,fontWeight:700,background:`${estadoColor}1a`,color:estadoColor}}>
                                {sol.estado||"pendiente"}
                              </span>
                            </td>
                            <td style={{...S.td,fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"var(--accent)"}}>{sol.pedido_numero||"-"}</td>
                            <td style={{...S.td,fontSize:11,color:"var(--text4)"}}>
                              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"var(--text)"}}>{Number(sol.eventos_count||0)}</div>
                              <div>{sol.ultimo_evento_at?new Date(sol.ultimo_evento_at).toLocaleDateString("es-ES"):"-"}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {portalSols.length>8&&(
                    <div style={{padding:"8px 12px",fontSize:11,color:"var(--text4)",borderTop:"1px solid var(--border2)"}}>
                      Mostrando las 8 últimas de {portalSols.length}. El resto está en Solicitudes clientes.
                    </div>
                  )}
                </div>
              )
            }

            {/* Facturas descargables */}
            <div style={{fontWeight:700,fontSize:12,color:"var(--text3)",
              textTransform:"uppercase",letterSpacing:".08em",marginTop:18,marginBottom:10}}>
              Facturas
            </div>
            {portalLoad
              ? <div style={{color:"var(--text4)",fontSize:12,padding:"16px 0",textAlign:"center"}}>Cargando facturas...</div>
              : portalFact.length===0
              ? <div style={{color:"var(--text4)",fontSize:12,textAlign:"center",padding:"16px 0",
                  background:"var(--bg3)",borderRadius:8}}>Sin facturas</div>
              : (
                <div style={S.card}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>
                      {["Nº Factura","Fecha","Pedidos","Base","Total","Estado"].map(h=>(
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {portalFact.map(f=>{
                        const estadoColor = {cobrada:"var(--green)",emitida:"#3b6ef5",enviada:"#f59e0b",anulada:"#ef4444"}[f.estado]||"var(--text4)";
                        return (
                          <tr key={f.id}>
                            <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--accent)"}}>{f.numero||"-"}</td>
                            <td style={{...S.td,fontSize:11}}>{f.fecha?new Date(f.fecha).toLocaleDateString("es-ES"):"-"}</td>
                            <td style={{...S.td,fontSize:11,color:"var(--text4)"}}>{f.num_pedidos||"-"}</td>
                            <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{f.base_imponible?Number(f.base_imponible).toLocaleString("es-ES",{minimumFractionDigits:2})+" EUR":"-"}</td>
                            <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:12}}>{f.total?Number(f.total).toLocaleString("es-ES",{minimumFractionDigits:2})+" EUR":"-"}</td>
                            <td style={S.td}>
                              <span style={{display:"inline-flex",padding:"2px 8px",borderRadius:20,
                                fontSize:11,fontWeight:700,background:`${estadoColor}1a`,color:estadoColor}}>
                                {f.estado||"-"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{padding:"8px 12px",fontSize:11,color:"var(--text4)",borderTop:"1px solid var(--border2)"}}>
                    {portalFact.length} factura{portalFact.length!==1?"s":""} -
                    Total: <b style={{color:"var(--text)"}}>
                      {portalFact.reduce((s,f)=>s+Number(f.total||0),0).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR
                    </b>
                  </div>
                </div>
              )
            }
          </div>
        )}

        {/* Footer botones */}
        {(tab==="datos"||tab==="facturacion") && canEdit && (
          <div style={{display:"flex",gap:10,marginTop:24,justifyContent:"flex-end",borderTop:"1px solid var(--border)",paddingTop:18}}>
            <button style={{...S.btn,background:"transparent",color:"var(--text2)",border:"1px solid var(--border2)"}} onClick={onClose}>Cancelar</button>
            <button style={{...S.btn,background:"#3b6ef5",color:"#fff",opacity:saving?0.7:1}} onClick={guardarCliente} disabled={saving}>
              {saving?"Guardando...":esNuevo?"Crear cliente":"Guardar cambios"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal: Lista de clientes
// ---------------------------------------------------------------------------
export default function Clientes() {
  const { puedeEditar } = useAuth();
  const canEdit = puedeEditar("clientes");
  const [clientes, setClientes]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [q,        setQ]          = useState("");
  const [ficha,    setFicha]      = useState(null);  // null | "nuevo" | {cliente}
  const [rutasG,   setRutasG]     = useState([]);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [mostrarBaja, setMostrarBaja] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const activo = mostrarBaja ? "false" : "true";
      let c;
      try {
        c = await getClientes(q, activo, 1, 100, { silentError:true, timeoutMs:60000 });
      } catch (firstError) {
        await new Promise(resolve => setTimeout(resolve, 700));
        c = await getClientes(q, activo, 1, 100, { silentError:true, timeoutMs:60000 }).catch(() => {
          throw firstError;
        });
      }
      setClientes(Array.isArray(c?.data)?c.data:Array.isArray(c)?c:[]);
    } catch {
      setLoadError("No se ha podido cargar el listado de clientes. Revisa que la API de produccion este desplegada y vuelve a intentar.");
    } finally { setLoading(false); }

    getRutas({ silentError:true, timeoutMs:8000 })
      .then(r => setRutasG(Array.isArray(r)?r:[]))
      .catch(() => setRutasG([]));
  }, [q, mostrarBaja]);

  useEffect(() => { cargar(); }, [cargar]);

  async function eliminar(c) {
    const ok = await confirmDialog({
      title: "Dar de baja cliente",
      message: `Dar de baja a "${c.nombre}"?\nEl cliente quedara desactivado pero sus datos e historial se conservaran.`,
      confirmText: "Dar de baja",
      tone: "warning",
    });
    if (!ok) return;
    try { await borrarCliente(c.id); cargar(); }
    catch(e) { notify(e.message, "error"); }
  }

  const clientesPendientes = clientes.filter(c=>c.pendiente_revision);
  const clientesVisibles = soloPendientes ? clientesPendientes : clientes;
  const resumenClientes = {
    total: clientes.length,
    bloqueados: clientes.filter(c=>c.bloqueado).length,
    revisar: clientesPendientes.length,
    conRiesgo: clientes.filter(c=>Number(c.limite_riesgo || 0) > 0).length,
    conEmailFacturacion: clientes.filter(c=>c.email_facturacion || c.email).length,
    rutas: rutasG.length,
  };

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:18}}>
        <div style={S.title}>Clientes</div>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"var(--text3)",cursor:"pointer",userSelect:"none",fontWeight:700}}>
          <input type="checkbox" checked={mostrarBaja} onChange={e=>{setMostrarBaja(e.target.checked);}}
            style={{accentColor:"var(--accent)",cursor:"pointer"}}/>
          Ver dados de baja
        </label>
      </div>

      <div style={S.bar}>
        {canEdit && (
          <button style={{...S.btn,background:"#3b6ef5",color:"#fff"}} onClick={()=>setFicha("nuevo")}>
            + Nuevo cliente
          </button>
        )}
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por nombre, CIF..."
          style={{...S.inp,width:330}}/>
        <span style={{fontSize:13,color:"var(--text4)",marginLeft:"auto",fontWeight:700}}>
          {clientes.length} cliente{clientes.length!==1?"s":""}
        </span>
      </div>

      {clientesPendientes.length > 0 && (
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:14,padding:"12px 14px",borderRadius:8,border:"1px solid rgba(245,158,11,.28)",background:"rgba(245,158,11,.10)",color:"#f59e0b"}}>
          <div>
            <div style={{fontWeight:900,fontSize:13}}>Hay {clientesPendientes.length} cliente{clientesPendientes.length!==1?"s":""} pendiente{clientesPendientes.length!==1?"s":""} de revisar</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:2}}>Revisa datos fiscales, contacto, forma de pago, direcciones y tarifas antes de usarlo de forma operativa.</div>
          </div>
          <button style={{...S.btn,background:soloPendientes?"rgba(245,158,11,.20)":"rgba(245,158,11,.12)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.35)",boxShadow:"none"}} onClick={()=>setSoloPendientes(v=>!v)}>
            {soloPendientes ? "Ver todos" : "Ver pendientes"}
          </button>
        </div>
      )}

      {loadError && (
        <div style={{marginBottom:14,padding:"12px 14px",borderRadius:8,border:"1px solid rgba(239,68,68,.35)",background:"rgba(239,68,68,.10)",color:"#fecaca",fontWeight:800}}>
          {loadError}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}>
        {[
          ["Clientes activos", resumenClientes.total, "var(--text)", "Listado visible"],
          ["Bloqueados", resumenClientes.bloqueados, resumenClientes.bloqueados ? "#ef4444" : "var(--green)", "No admiten viajes"],
          ["A revisar", resumenClientes.revisar, resumenClientes.revisar ? "#f59e0b" : "var(--green)", "Pendiente validacion"],
          ["Con riesgo", resumenClientes.conRiesgo, "var(--accent-xl)", "Limite configurado"],
          ["Email fact.", resumenClientes.conEmailFacturacion, "var(--green)", "Preparados para envio"],
          ["Rutas/tarifas", resumenClientes.rutas, "var(--accent-xl)", "Tarifas activas"],
        ].map(([label,value,color,detail])=>(
          <div key={label} style={{...S.card,padding:"12px 14px",marginBottom:0}}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color}}>{value}</div>
            <div style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",marginTop:4}}>{label}</div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>{detail}</div>
          </div>
        ))}
      </div>

      <div style={S.card}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>
            {["Nombre","CIF","Teléfono","Email","IVA","Forma pago","País","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Cargando...</td></tr>
            : clientesVisibles.length===0 ? <tr><td colSpan={8} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>
                Sin clientes. {canEdit&&"Crea el primero con el botón de arriba."}
              </td></tr>
            : clientesVisibles.map(c=>(
              <tr key={c.id}
                style={{
                  cursor:"pointer",
                  background: c.pendiente_revision
                    ? "linear-gradient(90deg, rgba(251,191,36,.14), rgba(251,191,36,.03) 24%)"
                    : "transparent",
                  boxShadow: c.pendiente_revision ? "inset 3px 0 0 #f59e0b" : "inset 3px 0 0 transparent",
                }}
                onClick={()=>setFicha(c)}>
                <td style={{...S.td,fontWeight:700,color:"var(--text)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {c.nombre}
                    {c.pendiente_revision && (
                      <span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:10,
                        background:"rgba(251,191,36,.15)",color:"#f59e0b",
                        border:"1px solid rgba(251,191,36,.3)",whiteSpace:"nowrap",flexShrink:0}}>
                        REVISAR
                      </span>
                    )}
                    {c.bloqueado && (
                      <span title={c.bloqueo_motivo || "Cliente bloqueado"} style={{fontSize:9,fontWeight:900,padding:"2px 7px",borderRadius:10,
                        background:"rgba(239,68,68,.12)",color:"#ef4444",
                        border:"1px solid rgba(239,68,68,.26)",whiteSpace:"nowrap",flexShrink:0}}>
                        BLOQUEADO
                      </span>
                    )}
                  </div>
                </td>
                <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--text2)"}}>{c.cif||"-"}</td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>{c.telefono||"-"}</td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>{c.email||"-"}</td>
                <td style={S.td}>
                  <span style={{display:"inline-flex",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:"rgba(59,110,245,.14)",color:"var(--accent-xl)"}}>
                    {ivaLabel(c.tipo_iva, c.iva_regimen)}
                  </span>
                </td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)",textTransform:"capitalize"}}>{c.forma_pago||"transferencia"}</td>
                <td style={{...S.td,fontSize:11,color:"var(--text2)"}}>
                  {c.calle ? `${c.calle}${c.num_ext?" "+c.num_ext:""}` : c.direccion||"-"}
                  {c.cod_postal||c.municipio ? <><br/><span style={{color:"var(--text4)"}}>{[c.cod_postal,c.municipio].filter(Boolean).join(" ")}</span></> : null}
                </td>
                <td style={S.td} onClick={e=>e.stopPropagation()}>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <button style={{...S.btn,background:"rgba(148,163,184,.08)",color:"var(--text)",padding:"6px 12px",fontSize:12,boxShadow:"none"}} onClick={()=>setFicha(c)}>Abrir ficha</button>
                    {c.pendiente_revision && canEdit && (
                      <button style={{...S.btn,background:"rgba(16,185,129,.10)",color:"#059669",padding:"6px 12px",fontSize:12,border:"1px solid rgba(16,185,129,.25)",boxShadow:"none"}}
                        onClick={async e=>{
                          e.stopPropagation();
                          await marcarClienteRevisado(c.id);
                          cargar();
                        }}> Revisado</button>
                    )}
                    {canEdit && <button style={{...S.btn,background:"rgba(239,68,68,.10)",color:"#ef4444",padding:"6px 12px",fontSize:12,border:"1px solid rgba(239,68,68,.18)",boxShadow:"none"}} onClick={()=>eliminar(c)}>Eliminar</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ficha cliente */}
      {ficha && (
        <FichaCliente
          cliente={ficha==="nuevo" ? null : ficha}
          rutasGlobales={rutasG}
          clientesExistentes={clientes}
          onClose={()=>setFicha(null)}
          onSaved={(saved)=>{
            setFicha(null);
            if (saved?.id) setClientes(prev => [saved, ...prev.filter(c => c.id !== saved.id)]);
            if (saved?.pendiente_revision) notify("Cliente creado. Queda pendiente de revision por trafico/gerencia.", "warning");
          }}
        />
      )}
    </div>
  );
}
