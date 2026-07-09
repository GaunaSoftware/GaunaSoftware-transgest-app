import { useMemo, useState } from "react";

const emptyPlatform = () => ({
  id: `plat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  nombre: "",
  documentos: [],
});

const emptyDocument = () => ({
  id: `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  nombre: "",
  caducidad: "",
  fecha_tope: "",
  notas: "",
});

const QUICK_DOCUMENTS = [
  "Alta en plataforma",
  "CAE / PRL",
  "Seguro RC",
  "Tarjeta transporte",
  "ITV",
  "Permiso circulacion",
  "Certificado corriente pagos",
];

export function normalizePlatformDocuments(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((platform, index) => ({
    id: platform?.id || `plat-${index}`,
    nombre: String(platform?.nombre || "").trim(),
    documentos: (Array.isArray(platform?.documentos) ? platform.documentos : []).map((doc, docIndex) => ({
      id: doc?.id || `doc-${index}-${docIndex}`,
      nombre: String(doc?.nombre || "").trim(),
      caducidad: doc?.caducidad ? String(doc.caducidad).slice(0, 10) : "",
      fecha_tope: doc?.fecha_tope ? String(doc.fecha_tope).slice(0, 10) : "",
      notas: String(doc?.notas || "").trim(),
    })).filter(doc => doc.nombre || doc.caducidad || doc.fecha_tope || doc.notas),
  })).filter(platform => platform.nombre || platform.documentos.length);
}

function normalizePlatformDocumentsForEdit(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((platform, index) => ({
    id: platform?.id || `plat-${index}`,
    nombre: String(platform?.nombre || ""),
    documentos: (Array.isArray(platform?.documentos) ? platform.documentos : []).map((doc, docIndex) => ({
      id: doc?.id || `doc-${index}-${docIndex}`,
      nombre: String(doc?.nombre || ""),
      caducidad: doc?.caducidad ? String(doc.caducidad).slice(0, 10) : "",
      fecha_tope: doc?.fecha_tope ? String(doc.fecha_tope).slice(0, 10) : "",
      notas: String(doc?.notas || ""),
    })),
  }));
}

function expiryStatus(date) {
  if (!date) return { label: "Sin caducidad", color: "var(--text5)", bg: "var(--bg4)", level: 5 };
  const days = Math.ceil((new Date(date) - new Date()) / 86400000);
  if (days < 0) return { label: "Caducado", color: "#ef4444", bg: "rgba(239,68,68,.14)", level: 0 };
  if (days <= 7) return { label: `${days} dias`, color: "#ef4444", bg: "rgba(239,68,68,.12)", level: 1 };
  if (days <= 30) return { label: `${days} dias`, color: "#f97316", bg: "rgba(249,115,22,.12)", level: 2 };
  if (days <= 60) return { label: `${days} dias`, color: "#f59e0b", bg: "rgba(245,158,11,.12)", level: 3 };
  return { label: `${days} dias`, color: "var(--green)", bg: "rgba(16,185,129,.12)", level: 4 };
}

function documentStatus(doc) {
  const status = expiryStatus(doc.fecha_tope || doc.caducidad);
  if (doc.fecha_tope && doc.caducidad && doc.fecha_tope !== doc.caducidad) {
    return { ...status, label: status.level <= 3 ? `Tope: ${status.label}` : "Vigilado" };
  }
  return status;
}

export function flattenPlatformDocuments(value, entity = {}) {
  return normalizePlatformDocuments(value).flatMap(platform =>
    platform.documentos.map(doc => ({
      ...doc,
      plataforma_id: platform.id,
      plataforma_nombre: platform.nombre || "Plataforma",
      entity,
    }))
  );
}

export function platformDocumentsSummary(value) {
  const docs = flattenPlatformDocuments(value);
  const expired = docs.filter(doc => documentStatus(doc).level === 0).length;
  const urgent = docs.filter(doc => documentStatus(doc).level > 0 && documentStatus(doc).level <= 2).length;
  return { total: docs.length, expired, urgent };
}

export default function PlatformDocumentsEditor({ value, onChange, canEdit = true, inputStyle, labelStyle, buttonStyle }) {
  const platforms = useMemo(() => normalizePlatformDocumentsForEdit(value), [value]);
  const summary = useMemo(() => platformDocumentsSummary(platforms), [platforms]);
  const [quickNames, setQuickNames] = useState({});

  const setPlatforms = (next) => onChange?.(normalizePlatformDocumentsForEdit(next));
  const updatePlatform = (platformId, patch) => {
    setPlatforms(platforms.map(platform => platform.id === platformId ? { ...platform, ...patch } : platform));
  };
  const updateDocument = (platformId, docId, patch) => {
    setPlatforms(platforms.map(platform => {
      if (platform.id !== platformId) return platform;
      return {
        ...platform,
        documentos: platform.documentos.map(doc => doc.id === docId ? { ...doc, ...patch } : doc),
      };
    }));
  };
  const addDocument = (platformId, nombre = "") => {
    const cleanName = String(nombre || "").trim();
    setPlatforms(platforms.map(platform => platform.id === platformId
      ? { ...platform, documentos: [...platform.documentos, { ...emptyDocument(), nombre: cleanName }] }
      : platform
    ));
  };

  const btn = {
    padding: "9px 13px",
    borderRadius: 8,
    border: "1px solid var(--border2)",
    background: "var(--bg3)",
    color: "var(--text)",
    fontSize: 12,
    fontWeight: 800,
    cursor: canEdit ? "pointer" : "not-allowed",
    fontFamily: "'DM Sans',sans-serif",
    ...(buttonStyle || {}),
  };
  const input = inputStyle || {
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    color: "var(--text)",
    padding: "10px 12px",
    borderRadius: 8,
    width: "100%",
    boxSizing: "border-box",
  };
  const label = labelStyle || {
    display: "block",
    fontSize: 10,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: ".07em",
    color: "var(--text4)",
    marginBottom: 4,
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, color: "var(--text)", fontSize: 15 }}>
            Plataformas de clientes
          </div>
          <div style={{ color: "var(--text4)", fontSize: 12, marginTop: 3 }}>
            Registra plataformas y documentos exigidos por cliente. Sus caducidades entran en el semaforo de avisos.
          </div>
        </div>
        {canEdit && (
          <button type="button" style={{ ...btn, background: "rgba(16,185,129,.12)", color: "var(--green)", borderColor: "rgba(16,185,129,.28)" }}
            onClick={() => setPlatforms([...platforms, emptyPlatform()])}>
            + Plataforma
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={{ padding: "5px 10px", borderRadius: 999, background: "var(--bg4)", color: "var(--text4)", fontSize: 12, fontWeight: 800 }}>
          {summary.total} documento{summary.total === 1 ? "" : "s"}
        </span>
        {summary.expired > 0 && <span style={{ padding: "5px 10px", borderRadius: 999, background: "rgba(239,68,68,.12)", color: "#ef4444", fontSize: 12, fontWeight: 800 }}>{summary.expired} caducado{summary.expired === 1 ? "" : "s"}</span>}
        {summary.urgent > 0 && <span style={{ padding: "5px 10px", borderRadius: 999, background: "rgba(249,115,22,.12)", color: "#f97316", fontSize: 12, fontWeight: 800 }}>{summary.urgent} urgente{summary.urgent === 1 ? "" : "s"}</span>}
      </div>

      {platforms.length === 0 ? (
        <div style={{ border: "1px dashed var(--border2)", borderRadius: 10, padding: 18, color: "var(--text4)", background: "var(--bg3)", fontSize: 13 }}>
          Sin plataformas registradas.
        </div>
      ) : platforms.map((platform, platformIndex) => (
        <div key={platform.id} style={{ border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg3)", padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, alignItems: "end" }}>
            <div>
              <label style={label}>Nombre plataforma</label>
              <input disabled={!canEdit} style={input} value={platform.nombre} placeholder="Ej. Transporeon, Nalanda, CTAIMA..."
                onChange={e => updatePlatform(platform.id, { nombre: e.target.value })} />
            </div>
            {canEdit && (
              <button type="button" style={{ ...btn, color: "#ef4444", background: "rgba(239,68,68,.10)", borderColor: "rgba(239,68,68,.24)" }}
                onClick={() => setPlatforms(platforms.filter((_, i) => i !== platformIndex))}>
                Quitar
              </button>
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {platform.documentos.map((doc, docIndex) => {
              const status = documentStatus(doc);
              return (
                <div key={doc.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, alignItems: "end" }}>
                  <div>
                    <label style={label}>Documento</label>
                    <input disabled={!canEdit} style={input} value={doc.nombre} list={`platform-docs-${platform.id}`} placeholder="Nombre documento"
                      onChange={e => updateDocument(platform.id, doc.id, { nombre: e.target.value })} />
                  </div>
                  <div>
                    <label style={label}>Caduca</label>
                    <input disabled={!canEdit} type="date" style={input} value={doc.caducidad || ""}
                      onChange={e => updateDocument(platform.id, doc.id, { caducidad: e.target.value })} />
                  </div>
                  <div>
                    <label style={label}>Fecha tope aviso</label>
                    <input disabled={!canEdit} type="date" style={input} value={doc.fecha_tope || ""}
                      onChange={e => updateDocument(platform.id, doc.id, { fecha_tope: e.target.value })} />
                  </div>
                  <div>
                    <label style={label}>Notas</label>
                    <input disabled={!canEdit} style={input} value={doc.notas || ""} placeholder="Opcional"
                      onChange={e => updateDocument(platform.id, doc.id, { notas: e.target.value })} />
                  </div>
                  <span style={{ padding: "8px 10px", borderRadius: 8, background: status.bg, color: status.color, fontSize: 12, fontWeight: 800, textAlign: "center", whiteSpace: "nowrap" }}>
                    {status.label}
                  </span>
                  {canEdit && (
                    <button type="button" style={{ ...btn, color: "#ef4444", background: "rgba(239,68,68,.08)", borderColor: "rgba(239,68,68,.2)" }}
                      onClick={() => updatePlatform(platform.id, { documentos: platform.documentos.filter((_, i) => i !== docIndex) })}>
                      X
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <datalist id={`platform-docs-${platform.id}`}>
            {QUICK_DOCUMENTS.map(name => <option key={name} value={name} />)}
          </datalist>

          {canEdit && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={{ ...btn }}
                onClick={() => addDocument(platform.id)}>
                + Documento
              </button>
              <select
                defaultValue=""
                style={{ ...input, width: "min(260px,100%)" }}
                onChange={e => {
                  const nombre = e.target.value;
                  if (!nombre) return;
                  addDocument(platform.id, nombre);
                  e.target.value = "";
                }}
              >
                <option value="">Crear documento rapido...</option>
                {QUICK_DOCUMENTS.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8, flex: "1 1 280px", minWidth: 240 }}>
                <input
                  style={{ ...input, minWidth: 0 }}
                  value={quickNames[platform.id] || ""}
                  placeholder="Nuevo documento rapido..."
                  onChange={e => setQuickNames(prev => ({ ...prev, [platform.id]: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const nombre = quickNames[platform.id] || "";
                    if (!String(nombre).trim()) return;
                    addDocument(platform.id, nombre);
                    setQuickNames(prev => ({ ...prev, [platform.id]: "" }));
                  }}
                />
                <button
                  type="button"
                  style={{ ...btn, whiteSpace: "nowrap" }}
                  onClick={() => {
                    const nombre = quickNames[platform.id] || "";
                    if (!String(nombre).trim()) return;
                    addDocument(platform.id, nombre);
                    setQuickNames(prev => ({ ...prev, [platform.id]: "" }));
                  }}
                >
                  Crear
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
