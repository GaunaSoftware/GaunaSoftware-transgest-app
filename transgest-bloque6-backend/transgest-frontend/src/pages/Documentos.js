import { useState, useEffect } from "react";
import {
  getVehiculos, getChoferes,
  getDocsVehiculo, getDocsChofer,
  crearDocVehiculo, crearDocChofer,
  borrarDocVehiculo, borrarDocChofer,
  getDocsProximosVencer,
  chatIA,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";

// ── Tipos de documentos ────────────────────────────────────────────────────
const DOCS_VEHICULO = [
  "ITV","Seguro","Tarjeta de transporte","Tacógrafo (calibración)",
  "Revisión mantenimiento","Extintor","Tacógrafo digital (tarjeta)","Otros",
];
const DOCS_CHOFER = [
  "Carnet de conducir","CAP (Certificado Aptitud Profesional)",
  "Tarjeta de conductor (tacógrafo)","ADR (mercancías peligrosas)",
  "Reconocimiento médico","Certificado formación","Otros",
];

// ── Lógica del semáforo ─────────────────────────────────────────────────────
// Verde: >90d | Amarillo: 61-90d | Naranja: 31-60d | Rojo claro: 8-30d | Rojo: 0-7d | Caducado: <0d
const DOC_TYPE_LABELS = {
  itv: "ITV",
  seguro: "Seguro",
  tacografo: "Tacografo",
  tarjeta_transporte: "Tarjeta de transporte",
  permiso_circulacion: "Permiso de circulacion",
  permiso: "Carnet de conducir",
  cap: "CAP",
  tarjeta_tacografo: "Tarjeta de conductor",
  reconocimiento: "Reconocimiento medico",
  adr: "ADR",
  otro: "Otros",
};

function labelDocType(value) {
  return DOC_TYPE_LABELS[String(value || "").toLowerCase()] || value || "Otros";
}

function slugArchivo(value, fallback = "documento") {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return slug || fallback;
}

function extensionArchivo(value) {
  const clean = String(value || "").split("?")[0].split("#")[0];
  const match = clean.match(/\.([a-z0-9]{2,8})$/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function buildArchivoSugerido(entidad, form, tipoDoc) {
  const entidadLabel = tipoDoc === "vehiculo"
    ? (entidad?.matricula || "vehiculo")
    : (entidad?.dni || entidad?.nombre || "chofer");
  const tipoLabel = slugArchivo(labelDocType(form?.tipo_doc));
  const venc = form?.fecha_vencimiento || "sin-vencimiento";
  return `${slugArchivo(entidadLabel, tipoDoc || "entidad")}_${tipoLabel}_${venc}`.toLowerCase();
}

function buildArchivoArchivado(entidad, form, tipoDoc) {
  const base = buildArchivoSugerido(entidad, form, tipoDoc);
  const ext = extensionArchivo(form?.file_nombre) || extensionArchivo(form?.file_url);
  return ext && !base.endsWith(ext) ? `${base}${ext}` : base;
}

function buildDescripcionDoc(form) {
  const parts = [form?.organismo, form?.notas].map(v => String(v || "").trim()).filter(Boolean);
  return parts.join(" | ") || null;
}

function semaforo(fechaVencimiento) {
  if (!fechaVencimiento) return { color:"var(--text4)", label:"Sin fecha", dias:null, nivel:0 };
  const dias = Math.ceil((new Date(fechaVencimiento) - new Date()) / 86400000);
  if (dias > 90)  return { color:"var(--green)", label:`${dias}d`, dias, nivel:5, bg:"rgba(34,211,160,.12)" };
  if (dias > 60)  return { color:"#84cc16", label:`${dias}d`, dias, nivel:4, bg:"rgba(132,204,22,.12)" };
  if (dias > 30)  return { color:"#fbbf24", label:`${dias}d`, dias, nivel:3, bg:"rgba(251,191,36,.12)" };
  if (dias > 7)   return { color:"#fb8c3a", label:`${dias}d`, dias, nivel:2, bg:"rgba(251,140,58,.12)" };
  if (dias > 0)   return { color:"#f05252", label:`${dias}d`, dias, nivel:1, bg:"rgba(240,82,82,.15)" };
  return { color:"#f05252", label:"CADUCADO", dias, nivel:0, bg:"rgba(240,82,82,.2)", caducado:true };
}

const S = {
  page:  { flex:1, padding:"24px 28px"},
  title: {fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,marginBottom:16,color:"var(--text)"},
  bar:   {display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"},
  btn:   {padding:"8px 14px",borderRadius:7,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:6},
  card:  {background:"var(--bg2)",border:"1px solid #181e2e",borderRadius:12,overflow:"hidden"},
  th:    {textAlign:"left",padding:"9px 14px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text4)",borderBottom:"1px solid #181e2e",background:"var(--bg3)",whiteSpace:"nowrap"},
  td:    {padding:"10px 14px",borderBottom:"1px solid #181e2e",fontSize:13,color:"var(--text)",verticalAlign:"middle"},
  inp:   {background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  sel:   {background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"},
  modal: {position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  mbox:  {background:"var(--bg2)",border:"1px solid #28344f",borderRadius:16,padding:28,width:"min(600px,96vw)",maxHeight:"90vh",overflowY:"auto"},
  lbl:   {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:5,marginTop:12},
  tab:   {padding:"7px 16px",border:"none",borderBottom:"2px solid transparent",background:"none",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"},
};

function Badge({ fecha }) {
  const s = semaforo(fecha);
  return (
    <span style={{display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:20,
                  fontSize:12,fontWeight:700,background:s.bg||"rgba(61,79,114,.2)",color:s.color,
                  minWidth:70,justifyContent:"center"}}>
      {s.label}
    </span>
  );
}

function DocRow({ doc, entidad, tipo, canEdit, onDeleted }) {
  function descargar() {
    if (!doc.file_url && !doc.url) { notify("Este documento no tiene archivo adjunto.", "warning"); return; }
    const url = doc.file_url || doc.url;
    const a   = document.createElement("a");
    a.href = url; a.target = "_blank"; a.download = doc.file_nombre || `${doc.tipo_doc}_${entidad.matricula||entidad.nombre||"doc"}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function enviarEmail() {
    const mail = entidad.email_contacto || entidad.email || "";
    if (!mail) { notify("Esta entidad no tiene email de contacto registrado.", "warning"); return; }
    const asunto  = encodeURIComponent(`Documento: ${doc.tipo_doc} — ${entidad.matricula||entidad.nombre||""}`);
    const cuerpo  = encodeURIComponent(`Adjunto el documento "${doc.tipo_doc}"${doc.fecha_vencimiento?" con vencimiento "+new Date(doc.fecha_vencimiento).toLocaleDateString("es-ES"):""}.

TransGest TMS`);
    window.open(`mailto:${mail}?subject=${asunto}&body=${cuerpo}`);
  }

  async function eliminar() {
    const ok = await confirmDialog({
      title: "Eliminar documento",
      message: `Eliminar ${doc.tipo_doc || "documento"} de ${entidad.matricula || entidad.nombre || "la ficha"}.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      if (tipo === "vehiculo") await borrarDocVehiculo(entidad.id, doc.id);
      else await borrarDocChofer(entidad.id, doc.id);
      onDeleted?.(doc.id);
    } catch(e) {
      notify(e.message, "error");
    }
  }

  return (
    <tr>
      <td style={{...S.td,fontWeight:600,fontSize:12}}>
        <div>{labelDocType(doc.tipo_doc)}</div>
        {(doc.file_nombre || doc.file_url || doc.url) && (
          <div style={{fontSize:10,color:"var(--green)",marginTop:3,fontWeight:700}}>
            Archivo registrado
          </div>
        )}
      </td>
      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>
        {doc.fecha_emision?new Date(doc.fecha_emision).toLocaleDateString("es-ES"):"—"}
      </td>
      <td style={S.td}><Badge fecha={doc.fecha_vencimiento}/></td>
      <td style={{...S.td,fontSize:11,color:"var(--text2)"}}>{doc.organismo||"—"}</td>
      <td style={{...S.td,fontSize:11,color:"var(--text2)"}}>{doc.notas||"—"}</td>
      <td style={{...S.td,whiteSpace:"nowrap"}}>
        <div style={{display:"flex",gap:5}}>
          <button title="Descargar documento" onClick={descargar}
            style={{...S.btn,padding:"3px 8px",fontSize:11,background:(doc.file_url||doc.url)?"var(--bg4)":"var(--bg3)",color:(doc.file_url||doc.url)?"var(--accent-xl)":"var(--text5)",border:"1px solid #1e2d45",cursor:(doc.file_url||doc.url)?"pointer":"not-allowed"}}>
            Descargar
          </button>
          <button title="Enviar por email" onClick={enviarEmail}
            style={{...S.btn,padding:"3px 8px",fontSize:11,background:"var(--bg4)",color:"var(--text2)",border:"1px solid #1e2d45"}}>
            Email
          </button>
          {canEdit && (
            <button title="Eliminar documento" onClick={eliminar}
              style={{...S.btn,padding:"3px 8px",fontSize:11,background:"rgba(239,68,68,.10)",color:"#ef4444",border:"1px solid rgba(239,68,68,.25)"}}>
              Eliminar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function DocsEntidad({ tipo, entidad, onAnadirDoc, refreshKey, onChanged }) {
  const [docs,    setDocs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const { puedeEditar } = useAuth();
  const canEdit = puedeEditar("docs");

  useEffect(() => {
    const fn = tipo==="vehiculo" ? getDocsVehiculo : getDocsChofer;
    fn(entidad.id).then(d=>setDocs(Array.isArray(d)?d:[])).catch(()=>setDocs([])).finally(()=>setLoading(false));
  }, [tipo, entidad.id, refreshKey]);

  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontWeight:700,color:"var(--text)",fontSize:14}}>
          {tipo==="vehiculo"
            ? `${entidad.matricula} - ${entidad.marca||""} ${entidad.modelo||""}`
            : `${entidad.nombre}`}
        </div>
        {canEdit && (
          <button style={{...S.btn,background:"var(--bg4)",color:"var(--accent-xl)",padding:"4px 10px",fontSize:11}}
            onClick={()=>onAnadirDoc(tipo, entidad)}>
            + Añadir documento
          </button>
        )}
      </div>
      {loading ? <div style={{color:"var(--text4)",fontSize:12,padding:"6px 0"}}>Cargando...</div>
      : docs.length===0 ? <div style={{color:"var(--text4)",fontSize:12,padding:"8px 14px",background:"var(--bg3)",borderRadius:8}}>Sin documentos registrados</div>
      : (
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>{["Documento","Emisión","Vencimiento","Organismo","Notas",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{docs.map((d,i)=><DocRow key={i} doc={d} entidad={entidad} tipo={tipo} canEdit={canEdit} onDeleted={(id)=>{ setDocs(prev=>prev.filter(x=>x.id!==id)); onChanged?.(); }}/>)}</tbody>
        </table>
      )}
    </div>
  );
}

export default function Documentos() {
  const [tab,       setTab]       = useState("vehiculos");
  const [vehiculos, setVehiculos] = useState([]);
  const [filtroTipoVeh, setFiltroTipoVeh] = useState("todos"); // todos | tractora | remolque | <clase>
  const [choferes,  setChoferes]  = useState([]);
  const [proximos,  setProximos]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [docsVersion, setDocsVersion] = useState(0);

  // Modal añadir doc
  const [modalDoc,  setModalDoc]  = useState(false);
  const [tipoDoc,   setTipoDoc]   = useState("vehiculo");
  const [entidadDoc,setEntidadDoc]= useState(null);
  const [formDoc,   setFormDoc]   = useState({});
  const [saving,    setSaving]    = useState(false);
  const [iaResultado, setIaResultado] = useState(null);

  useEffect(() => {
    Promise.all([getVehiculos(), getChoferes(), getDocsProximosVencer()])
      .then(([v, c, p]) => {
        setVehiculos(Array.isArray(v)?v:[]);
        setChoferes(Array.isArray(c)?c:[]);
        setProximos(Array.isArray(p)?p:[]);
      }).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  async function recargarProximos() {
    try {
      const p = await getDocsProximosVencer();
      setProximos(Array.isArray(p) ? p : []);
    } catch {
      setProximos([]);
    }
  }

  function marcarDocsCambiados() {
    setDocsVersion(v => v + 1);
    recargarProximos();
  }

  function abrirModalDoc(tipo, entidad) {
    setTipoDoc(tipo);
    setEntidadDoc(entidad);
    setFormDoc({ usar_nombre_archivistico: true });
    setIaResultado(null);
    setModalDoc(true);
  }

  async function guardarDoc() {
    if (!formDoc.tipo_doc||!formDoc.fecha_vencimiento) { notify("Tipo y fecha de vencimiento obligatorios", "warning"); return; }
    setSaving(true);
    try {
      const payload = {
        ...formDoc,
        descripcion: formDoc.descripcion || buildDescripcionDoc(formDoc),
        referencia: formDoc.referencia || formDoc.numero_doc || null,
      };
      if (payload.usar_nombre_archivistico !== false && (payload.file_nombre || payload.file_url)) {
        payload.file_nombre = buildArchivoArchivado(entidadDoc, payload, tipoDoc);
      }
      delete payload.usar_nombre_archivistico;
      if (tipoDoc==="vehiculo") await crearDocVehiculo(entidadDoc.id, payload);
      else                      await crearDocChofer(entidadDoc.id, payload);
      setModalDoc(false);
      marcarDocsCambiados();
    } catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  const fd = k => e => setFormDoc(p=>({...p,[k]:e.target.value}));

  // ── Análisis IA del documento ──────────────────────────────────────────
  const [analizando, setAnalizando] = useState(false);

  async function analizarConIA(fileBase64, fileName) {
    setAnalizando(true);
    try {
      const esImagen = fileBase64.startsWith("data:image/");
      const esPDF    = fileBase64.startsWith("data:application/pdf");

      if (!esImagen && !esPDF) {
        notify("La IA solo puede analizar imagenes (JPG, PNG) y PDFs.", "warning");
        return;
      }

      const mediaType = esImagen
        ? fileBase64.split(";")[0].replace("data:","")
        : "application/pdf";
      const base64Data = fileBase64.split(",")[1];

      const tiposDisponibles = tipoDoc==="vehiculo" ? DOCS_VEHICULO : DOCS_CHOFER;

      const prompt = `Analiza este documento y extrae la siguiente información en formato JSON.
El documento parece ser uno de estos tipos: ${tiposDisponibles.join(", ")}.

Devuelve SOLO un JSON con estos campos (null si no encuentras el dato):
{
  "tipo_doc": "tipo exacto de entre la lista proporcionada o null",
  "fecha_emision": "YYYY-MM-DD o null",
  "fecha_vencimiento": "YYYY-MM-DD o null",
  "organismo": "nombre del organismo/entidad emisora o null",
  "numero_doc": "número de referencia, póliza, expediente o null",
  "notas": "información relevante adicional o null"
}

Tipos disponibles: ${tiposDisponibles.join(", ")}
Responde SOLO con el JSON, sin texto adicional.`;

      const data = await chatIA({
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: esImagen ? "image" : "document",
              source: { type: "base64", media_type: mediaType, data: base64Data }
            },
            { type: "text", text: prompt }
          ]
        }]
      });
      const texto = data.content?.[0]?.text || "";

      // Parse JSON from response
      const jsonMatch = texto.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No se pudo extraer información del documento");

      const extraido = JSON.parse(jsonMatch[0]);

      const encontrados = Object.entries(extraido).filter(([,v])=>v).map(([k])=>k);
      setIaResultado({
        fileName,
        encontrados,
        sugerido: {
          tipo_doc: extraido.tipo_doc || null,
          fecha_vencimiento: extraido.fecha_vencimiento || null,
          organismo: extraido.organismo || null,
        },
      });

      // Merge into form - only fill empty fields
      setFormDoc(p => ({
        ...p,
        tipo_doc:          extraido.tipo_doc          || p.tipo_doc,
        fecha_emision:     extraido.fecha_emision     || p.fecha_emision,
        fecha_vencimiento: extraido.fecha_vencimiento || p.fecha_vencimiento,
        organismo:         extraido.organismo         || p.organismo,
        numero_doc:        extraido.numero_doc        || p.numero_doc,
        notas:             extraido.notas             || p.notas,
      }));

      // Show what was found
      if (encontrados.length > 0) {
        // Small toast-like feedback
        window._iaExito = `IA encontró: ${encontrados.join(", ")}`;
        setTimeout(()=>{ window._iaExito=null; }, 3000);
      }

    } catch(e) {
      console.error("Error IA:", e);
      notify("Error al analizar el documento: " + e.message, "error");
    } finally {
      setAnalizando(false);
    }
  }

  // Contar alertas
  const criticos = proximos.filter(d=>{ const s=semaforo(d.fecha_vencimiento); return s.nivel<=2; });
  const caducados= proximos.filter(d=>{ const s=semaforo(d.fecha_vencimiento); return s.caducado; });

  const TABS = [
    {id:"vehiculos", l:"Vehículos"},
    {id:"choferes",  l:"Choferes"},
    {id:"proximos",  l:`Próximos${criticos.length>0?` (${criticos.length} alertas)`:""}`},
  ];

  return (
    <div style={S.page}>
      <div style={S.title}>Gestión de documentos</div>

      {/* Alertas críticas en cabecera */}
      {caducados.length>0 && (
        <div style={{background:"rgba(240,82,82,.1)",border:"1px solid rgba(240,82,82,.3)",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
          <div>
            <div style={{fontWeight:700,color:"#f05252",fontSize:13}}>
              {caducados.length} documento{caducados.length!==1?"s":""} CADUCADO{caducados.length!==1?"S":""}
            </div>
            <div style={{fontSize:12,color:"#fca5a5",marginTop:2}}>
              {caducados.map(d=>d.vehiculo_matricula||d.chofer_nombre).join(", ")}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",gap:0,borderBottom:"1px solid #181e2e",marginBottom:18}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{...S.tab,borderBottomColor:tab===t.id?"#3b6ef5":"transparent",
                    color:tab===t.id?"var(--accent-xl)":"var(--text4)"}}>
            {t.l}
          </button>
        ))}
      </div>

      {loading ? <div style={{textAlign:"center",color:"var(--text4)",padding:60}}>Cargando...</div> : (
        <>
          {/* ── Vehículos ── */}
          {tab==="vehiculos" && (() => {
            // Separate tractoras vs remolques
            const esRemolque = v => { const cl=(v.clase||v.tipo||"").toLowerCase(); const mat=(v.matricula||"").toUpperCase(); return cl.includes("remolque")||cl.includes("semirremolque")||cl.includes("dolly")||mat.startsWith("R-")||mat.endsWith("-R"); };
            const tractoras = vehiculos.filter(v=>!esRemolque(v));
            const remolques = vehiculos.filter(esRemolque);
            // Get unique classes within remolques for sub-filter
            const clasesRemolque = [...new Set(remolques.map(v=>(v.clase||v.tipo||"Remolque").toLowerCase()).filter(Boolean))];
            const clasesLabel = { "remolque":"Remolque","semirremolque":"Semirremolque","cisternas":"Cisterna","lona":"Lona/Tautliner","frigorifico":"Frigorífico","dolly":"Dolly" };
            // Filter by tipo
            let vehFilt = vehiculos;
            if (filtroTipoVeh === "tractora") vehFilt = tractoras;
            else if (filtroTipoVeh === "remolque") vehFilt = remolques;
            else if (filtroTipoVeh !== "todos") vehFilt = vehiculos.filter(v=>(v.clase||v.tipo||"").toLowerCase()===filtroTipoVeh);
            return (
              <>
                {/* Sub-filter tabs */}
                <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
                  {[["todos","Todos",vehiculos.length],
                    ["tractora","Tractoras",tractoras.length],
                    ["remolque","Remolques",remolques.length],
                    ...clasesRemolque.map(cl=>[cl, (clasesLabel[cl]||cl.charAt(0).toUpperCase()+cl.slice(1)), vehiculos.filter(v=>(v.clase||v.tipo||"").toLowerCase()===cl).length])
                  ].filter(([,, n])=>n>0).map(([key,label,count])=>(
                    <button key={key} onClick={()=>setFiltroTipoVeh(key)}
                      style={{padding:"4px 12px",borderRadius:20,border:"1px solid var(--border2)",fontSize:12,fontWeight:filtroTipoVeh===key?700:400,
                        background:filtroTipoVeh===key?"var(--accent)":"var(--bg4)",color:filtroTipoVeh===key?"#fff":"var(--text4)",cursor:"pointer"}}>
                      {label} <span style={{opacity:0.7}}>({count})</span>
                    </button>
                  ))}
                </div>
                {vehFilt.map(v=>(
                  <DocsEntidad key={v.id} tipo="vehiculo" entidad={v} onAnadirDoc={abrirModalDoc} refreshKey={docsVersion} onChanged={marcarDocsCambiados}/>
                ))}
                {vehFilt.length===0 && <div style={{textAlign:"center",color:"var(--text4)",padding:40}}>Sin vehículos en esta categoría</div>}
              </>
            );
          })()}

          {/* ── Choferes ── */}
          {tab==="choferes" && choferes.map(c=>(
            <DocsEntidad key={c.id} tipo="chofer" entidad={c} onAnadirDoc={abrirModalDoc} refreshKey={docsVersion} onChanged={marcarDocsCambiados}/>
          ))}
          {tab==="choferes" && choferes.length===0 && (
            <div style={{textAlign:"center",color:"var(--text4)",padding:40}}>Sin choferes registrados</div>
          )}

          {/* ── Próximos vencimientos ── */}
          {tab==="proximos" && (
            <div>
              {/* Leyenda del semáforo */}
              <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                {[
                  {c:"var(--green)",l:">90 días"},
                  {c:"#84cc16",l:"61–90 días"},
                  {c:"#fbbf24",l:"31–60 días"},
                  {c:"#fb8c3a",l:"8–30 días"},
                  {c:"#f05252",l:"1–7 días"},
                  {c:"#f05252",l:"Caducado",bold:true},
                ].map((s,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--text2)"}}>
                    <span style={{width:10,height:10,borderRadius:"50%",background:s.c,flexShrink:0,
                                  boxShadow:s.bold?`0 0 6px ${s.c}`:undefined}}></span>
                    {s.l}
                  </div>
                ))}
              </div>

              {proximos.length===0 ? (
                <div style={{textAlign:"center",color:"var(--green)",padding:40,fontSize:14}}>
                  Sin vencimientos próximos
                </div>
              ) : (
                <div style={S.card}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>
                      {["Entidad","Tipo doc","Vencimiento","Días restantes","Emisión","Organismo"].map(h=><th key={h} style={S.th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {[...proximos].sort((a,b)=>new Date(a.fecha_vencimiento)-new Date(b.fecha_vencimiento)).map((d,i)=>{
                        const s = semaforo(d.fecha_vencimiento);
                        return (
                          <tr key={i} style={{background:s.nivel<=1?`${s.bg}`:undefined}}>
                            <td style={{...S.td,fontWeight:600,fontSize:12}}>
                              {d.vehiculo_matricula
                                ? <span>{d.vehiculo_matricula}</span>
                                : <span>{d.chofer_nombre}</span>}
                            </td>
                            <td style={{...S.td,fontSize:12}}>{d.tipo_doc}</td>
                            <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--text4)"}}>
                              {new Date(d.fecha_vencimiento).toLocaleDateString("es-ES")}
                            </td>
                            <td style={S.td}><Badge fecha={d.fecha_vencimiento}/></td>
                            <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>
                              {d.fecha_emision?new Date(d.fecha_emision).toLocaleDateString("es-ES"):"—"}
                            </td>
                            <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>{d.organismo||"—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal añadir documento */}
      {modalDoc && (
        <div style={S.modal} onClick={e=>e.target===e.currentTarget&&setModalDoc(false)}>
          <div style={S.mbox}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,marginBottom:4,color:"var(--text)"}}>
              Añadir documento
            </div>
            <div style={{fontSize:12,color:"var(--text4)",marginBottom:18}}>
              {tipoDoc==="vehiculo"
                ? `${entidadDoc?.matricula} - ${entidadDoc?.marca} ${entidadDoc?.modelo}`
                : `${entidadDoc?.nombre}`}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.lbl}>Tipo de documento *</label>
                <select value={formDoc.tipo_doc||""} onChange={fd("tipo_doc")} style={S.sel}>
                  <option value="">Seleccionar...</option>
                  {(tipoDoc==="vehiculo"?DOCS_VEHICULO:DOCS_CHOFER).map(d=>(
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={S.lbl}>Fecha de emisión</label>
                <input type="date" style={S.inp} value={formDoc.fecha_emision||""} onChange={fd("fecha_emision")}/>
              </div>
              <div>
                <label style={S.lbl}>Fecha de vencimiento *</label>
                <input type="date" style={S.inp} value={formDoc.fecha_vencimiento||""} onChange={fd("fecha_vencimiento")}/>
              </div>
              <div>
                <label style={S.lbl}>Organismo / Entidad</label>
                <input style={S.inp} value={formDoc.organismo||""} onChange={fd("organismo")} placeholder="DGT, aseguradora..."/>
              </div>
              <div>
                <label style={S.lbl}>Nº documento / referencia</label>
                <input style={S.inp} value={formDoc.numero_doc||""} onChange={fd("numero_doc")} placeholder="Nº póliza, matricula..."/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.lbl}>Notas</label>
                <textarea style={{...S.inp,height:60,resize:"vertical"}} value={formDoc.notas||""} onChange={fd("notas")}/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.lbl}>Archivo adjunto</label>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                    style={{display:"none"}} id="doc_file_input"
                    onChange={e=>{
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 5*1024*1024) { notify("El archivo no puede superar 5 MB", "warning"); return; }
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const base64 = ev.target.result;
                        setFormDoc(p=>({...p, file_url:base64, file_nombre:file.name, file_size:file.size, usar_nombre_archivistico:true}));
                        // Auto-analizar con IA si es imagen o PDF
                        const esAnalizable = file.type.startsWith("image/") || file.type === "application/pdf";
                        if (esAnalizable) {
                          analizarConIA(base64, file.name);
                        }
                      };
                      reader.readAsDataURL(file);
                    }}/>
                  <label htmlFor="doc_file_input" style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text2)",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:6}}>
                    Seleccionar archivo local
                  </label>
                  <input style={{...S.inp,flex:1}} value={formDoc.file_url?.startsWith("data:")?"":(formDoc.file_url||"")} onChange={fd("file_url")} placeholder="O pega una URL externa (https://...)"/>
                </div>
                {formDoc.file_nombre && (
                  <div style={{marginTop:6,fontSize:11,color:"var(--green)",display:"flex",alignItems:"center",gap:6}}>
                    Archivo seleccionado: {formDoc.file_nombre} ({formDoc.file_size?(formDoc.file_size/1024).toFixed(0)+"KB":"-"})
                    <button onClick={()=>setFormDoc(p=>({...p,file_url:"",file_nombre:"",file_size:0}))}
                      style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700}}>Quitar</button>
                  </div>
                )}
                {(formDoc.file_nombre || formDoc.file_url) && (
                  <div style={{marginTop:8,padding:"8px 10px",border:"1px solid #28344f",borderRadius:7,background:"var(--bg3)",fontSize:11,color:"var(--text4)"}}>
                    <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",color:"var(--text2)",fontWeight:700}}>
                      <input
                        type="checkbox"
                        checked={formDoc.usar_nombre_archivistico !== false}
                        onChange={e=>setFormDoc(p=>({...p,usar_nombre_archivistico:e.target.checked}))}
                      />
                      Guardar con nombre archivístico
                    </label>
                    <div style={{marginTop:5}}>
                      Se archivará como: <strong style={{color:"var(--text2)"}}>{buildArchivoArchivado(entidadDoc, formDoc, tipoDoc)}</strong>
                    </div>
                    <div style={{marginTop:3,color:"var(--text4)"}}>
                      El nombre se recalcula con la entidad, tipo de documento y vencimiento antes de guardar.
                    </div>
                  </div>
                )}
                {iaResultado && (
                  <div style={{marginTop:8,padding:"8px 12px",background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.2)",borderRadius:7,fontSize:12,color:"var(--text3)"}}>
                    <div style={{fontWeight:800,color:"var(--green)",marginBottom:4}}>Analisis IA aplicado</div>
                    <div>Campos detectados: {iaResultado.encontrados.length ? iaResultado.encontrados.join(", ") : "sin campos fiables"}</div>
                    <div style={{marginTop:3,color:"var(--text4)"}}>Revisa los datos antes de guardar el documento.</div>
                  </div>
                )}
                {analizando && (
                  <div style={{marginTop:8,padding:"8px 12px",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.2)",borderRadius:7,fontSize:12,color:"var(--accent)",display:"flex",alignItems:"center",gap:8}}>
                    Analizando documento con IA... los campos se rellenarán automáticamente.
                  </div>
                )}
              </div>
            </div>

            {/* Preview semáforo */}
            {formDoc.fecha_vencimiento && (
              <div style={{display:"flex",alignItems:"center",gap:12,marginTop:12,background:"var(--bg3)",borderRadius:8,padding:"10px 14px"}}>
                <span style={{fontSize:12,color:"var(--text4)"}}>Estado:</span>
                <Badge fecha={formDoc.fecha_vencimiento}/>
                <span style={{fontSize:12,color:"var(--text2)"}}>
                  {semaforo(formDoc.fecha_vencimiento).dias!==null
                    ? `${semaforo(formDoc.fecha_vencimiento).dias} días hasta vencimiento`
                    : ""}
                </span>
              </div>
            )}

            <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
              <button style={{...S.btn,background:"transparent",color:"var(--text2)",border:"1px solid #28344f"}} onClick={()=>setModalDoc(false)}>Cancelar</button>
              <button style={{...S.btn,background:"#3b6ef5",color:"#fff"}} onClick={guardarDoc} disabled={saving}>
                {saving?"Guardando...":"Añadir documento"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
