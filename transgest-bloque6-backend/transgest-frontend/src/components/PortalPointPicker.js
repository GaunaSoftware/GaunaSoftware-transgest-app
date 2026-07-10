import { useMemo, useState } from "react";
import { crearPortalClientePunto } from "../services/api";
import { notify } from "../services/notify";

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg4)",
  border: "1px solid var(--border2)",
  color: "var(--text)",
  borderRadius: 8,
  padding: "9px 11px",
  fontSize: 13,
  outline: "none",
};

function pointOptionLabel(point = {}) {
  const parts = [point.nombre, point.direccion, point.ciudad, point.provincia]
    .map(value => String(value || "").trim())
    .filter((value, index, all) => value && all.indexOf(value) === index);
  return parts.join(" - ");
}

export default function PortalPointPicker({ tipo, points = [], selectedId = "", onSelect, onCreated }) {
  const isLoad = tipo === "carga";
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nombre:"", direccion:"", ciudad:"", provincia:"", pais:"Espa\u00f1a" });
  const available = useMemo(
    () => points.filter(point => point.tipo === "ambos" || point.tipo === tipo),
    [points, tipo]
  );
  const update = key => event => setForm(prev => ({ ...prev, [key]: event.target.value }));

  async function savePoint() {
    const direccion = String(form.direccion || form.ciudad || "").trim();
    const nombre = String(form.nombre || form.ciudad || direccion).trim();
    if (!nombre || !direccion) {
      notify("Indica el nombre y la direccion o poblacion del punto", "warning");
      return;
    }
    setSaving(true);
    try {
      const created = await crearPortalClientePunto({ ...form, nombre, direccion, tipo });
      onCreated?.(created);
      onSelect?.(created);
      setForm({ nombre:"", direccion:"", ciudad:"", provincia:"", pais:"Espa\u00f1a" });
      setOpen(false);
      notify(`${isLoad ? "Punto de carga" : "Punto de descarga"} guardado`, "success");
    } catch (error) {
      notify(error.message || "No se pudo guardar el punto", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop:8, padding:10, border:"1px solid var(--border2)", borderRadius:8, background:"var(--bg3)" }}>
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <select
          value={selectedId || ""}
          onChange={event => onSelect?.(available.find(point => String(point.id) === event.target.value) || null)}
          style={{ ...inputStyle, flex:"1 1 260px" }}
        >
          <option value="">{available.length ? `Seleccionar punto de ${isLoad ? "carga" : "descarga"}` : `Sin puntos de ${isLoad ? "carga" : "descarga"} guardados`}</option>
          {available.map(point => (
            <option key={point.id} value={point.id}>
              {pointOptionLabel(point)}{point.es_general ? " (general)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          style={{ border:"1px solid var(--border2)", background:"var(--bg4)", color:"var(--accent)", borderRadius:8, padding:"9px 12px", fontWeight:800, cursor:"pointer" }}
        >
          {open ? "Cancelar" : "+ Crear punto"}
        </button>
      </div>
      <div style={{ fontSize:11, color:"var(--text5)", marginTop:6 }}>
        Puedes elegir un punto guardado o escribir {isLoad ? "otro origen" : "solo la poblacion de destino"} en el campo superior.
      </div>

      {open && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:8, marginTop:10 }}>
          <input style={inputStyle} value={form.nombre} onChange={update("nombre")} placeholder="Nombre del punto" />
          <input style={inputStyle} value={form.direccion} onChange={update("direccion")} placeholder={isLoad ? "Direccion de carga" : "Direccion o poblacion"} />
          <input style={inputStyle} value={form.ciudad} onChange={update("ciudad")} placeholder="Poblacion" />
          <input style={inputStyle} value={form.provincia} onChange={update("provincia")} placeholder="Provincia / region" />
          <input style={inputStyle} value={form.pais} onChange={update("pais")} placeholder="Pais" />
          <button
            type="button"
            onClick={savePoint}
            disabled={saving}
            style={{ border:"none", background:"var(--accent)", color:"#fff", borderRadius:8, padding:"9px 12px", fontWeight:900, cursor:"pointer", opacity:saving ? 0.65 : 1 }}
          >
            {saving ? "Guardando..." : "Guardar y seleccionar"}
          </button>
        </div>
      )}
    </div>
  );
}
