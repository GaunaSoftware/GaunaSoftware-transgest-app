import { useMemo, useState } from "react";

// Popup rapido de asignacion desde el boton "Asignar" de la lista de pedidos.
// Permite elegir una matricula de la flota o escribirla a mano (asignacion
// propia), y opcionalmente el chofer. No abre el formulario completo del pedido.
export default function QuickAssignModal({ pedido, vehiculos = [], choferes = [], onClose, onAssign }) {
  const [matricula, setMatricula] = useState(
    pedido?.vehiculo_matricula || pedido?.matricula_manual || ""
  );
  const [choferId, setChoferId] = useState(pedido?.chofer_id || "");
  const [remolque, setRemolque] = useState(
    pedido?.remolque_matricula || pedido?.remolque_matricula_manual || ""
  );
  const [trabajando, setTrabajando] = useState(false);

  const vehMatch = useMemo(() => {
    const m = String(matricula || "").trim().toUpperCase();
    if (!m) return null;
    return vehiculos.find(v => String(v.matricula || "").toUpperCase() === m) || null;
  }, [matricula, vehiculos]);

  async function asignar() {
    const mat = String(matricula || "").trim().toUpperCase();
    const rem = String(remolque || "").trim().toUpperCase();
    if (!mat && !choferId) { return; }
    const patch = {};
    if (vehMatch) {
      patch.vehiculo_id = vehMatch.id;
      patch.colaborador_id = "";
      patch.matricula_manual = "";
      patch.remolque_matricula_manual = "";
    } else if (mat) {
      patch.matricula_manual = mat;
      patch.vehiculo_id = "";
      patch.colaborador_id = "";
      patch.remolque_matricula_manual = rem;
    }
    if (choferId) patch.chofer_id = choferId;
    else if (vehMatch && vehMatch.chofer_id) patch.chofer_id = vehMatch.chofer_id;
    setTrabajando(true);
    try {
      await onAssign(patch);
    } finally {
      setTrabajando(false);
    }
  }

  const S = {
    overlay: { position: "fixed", inset: 0, zIndex: 2600, background: "rgba(2,6,23,.55)", display: "grid", placeItems: "center", padding: 16 },
    box: { width: "min(440px,96vw)", background: "var(--bg2,#fff)", border: "1px solid var(--border2,#e2e8f0)", borderRadius: 12, padding: 20, boxShadow: "0 24px 60px rgba(15,23,42,.35)" },
    label: { display: "block", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text5,#94a3b8)", margin: "12px 0 4px" },
    input: { width: "100%", boxSizing: "border-box", background: "var(--bg4,#fff)", border: "1px solid var(--border2,#cfdbe5)", color: "var(--text,#0f172a)", padding: "9px 12px", borderRadius: 8, fontSize: 13, outline: "none" },
    btn: { padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontWeight: 800, fontSize: 13, cursor: "pointer" },
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.box} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>Asignar vehiculo</div>
        <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 3 }}>
          Pedido {pedido?.numero || ""} · {pedido?.origen || ""} {pedido?.destino ? `-> ${pedido.destino}` : ""}
        </div>

        <datalist id="tg-quick-matriculas">
          {vehiculos.map(v => <option key={v.id} value={v.matricula} />)}
        </datalist>

        <label style={S.label}>Matricula (elige de la flota o escribe a mano)</label>
        <input list="tg-quick-matriculas" style={S.input} value={matricula} autoFocus
          onChange={e => setMatricula(e.target.value.toUpperCase())} placeholder="Ej: 1234 ABC" />
        {matricula && (
          <div style={{ fontSize: 11, color: vehMatch ? "#10b981" : "var(--text5)", marginTop: 4 }}>
            {vehMatch ? `Vehiculo de la flota: ${vehMatch.matricula}${vehMatch.marca ? ` (${vehMatch.marca})` : ""}` : "Matricula a mano (no esta en la flota)"}
          </div>
        )}

        <label style={S.label}>Remolque (opcional)</label>
        <input list="tg-quick-matriculas" style={S.input} value={remolque}
          onChange={e => setRemolque(e.target.value.toUpperCase())} placeholder="Ej: R-1234" />

        <label style={S.label}>Chofer (opcional)</label>
        <select style={S.input} value={choferId} onChange={e => setChoferId(e.target.value)}>
          <option value="">{vehMatch && vehMatch.chofer_id ? "Auto del vehiculo" : "Sin asignar"}</option>
          {choferes.map(c => <option key={c.id} value={c.id}>{c.nombre || ""} {c.apellidos || ""}</option>)}
        </select>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button style={S.btn} onClick={onClose} disabled={trabajando}>Cancelar</button>
          <button
            style={{ ...S.btn, background: "var(--accent,#0f766e)", color: "#fff", borderColor: "var(--accent,#0f766e)", opacity: trabajando || (!matricula && !choferId) ? .6 : 1 }}
            onClick={asignar} disabled={trabajando || (!matricula && !choferId)}>
            {trabajando ? "Asignando..." : "Asignar"}
          </button>
        </div>
      </div>
    </div>
  );
}
