import { useEffect, useMemo, useState } from "react";
import { formatMatricula } from "../utils/formatos";
import { getDisponibilidadRecursos } from "../services/api";

// Popup rapido de asignacion desde el boton "Asignar" de la lista de pedidos.
// Permite elegir una matricula de la flota o escribirla a mano (asignacion
// propia), y opcionalmente el chofer. No abre el formulario completo del pedido.
export default function QuickAssignModal({ pedido, vehiculos = [], choferes = [], onClose, onAssign, bulkCount = 0, fechasLote = [] }) {
  const [matricula, setMatricula] = useState(
    pedido?.vehiculo_matricula || pedido?.matricula_manual || ""
  );
  const [choferId, setChoferId] = useState(pedido?.chofer_id || "");
  const [remolque, setRemolque] = useState(
    pedido?.remolque_matricula || pedido?.remolque_matricula_manual || ""
  );
  const [trabajando, setTrabajando] = useState(false);

  // Un vehiculo es remolque si su clase lo indica, si es el remolque de otra
  // cabeza, o por convencion de matricula (R-1234, 1234-R). Asi el desplegable de
  // "Matricula" ofrece solo cabezas tractoras y el de "Remolque" solo remolques.
  const esRemolque = (v) => {
    const clase = String(v?.clase || v?.tipo || "").toLowerCase();
    const mat = String(v?.matricula || "").toUpperCase();
    const esRemolqueDeAlguien = vehiculos.some(t => t.remolque_id === v?.id);
    return clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly")
      || esRemolqueDeAlguien || /^R[-_\s]/i.test(mat) || mat.endsWith("-R") || mat.endsWith("_R");
  };
  const tractoras = useMemo(() => vehiculos.filter(v => !esRemolque(v)), [vehiculos]);
  const remolques = useMemo(() => vehiculos.filter(v => esRemolque(v)), [vehiculos]);
  const esBulk = Number(bulkCount) > 1;

  // Disponibilidad para la fecha del viaje: quien esta libre y, si no, por que.
  // Los ocupados NO se ocultan (a veces hay que asignarlos igual): salen
  // atenuados y con el motivo.
  const [disp, setDisp] = useState(null);
  useEffect(() => {
    let vivo = true;
    const fecha = String(pedido?.fecha_carga || pedido?.fecha_pedido || "").slice(0, 10);
    getDisponibilidadRecursos(fecha, pedido?.id || "")
      .then(d => { if (vivo) setDisp(d); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [pedido?.id, pedido?.fecha_carga, pedido?.fecha_pedido]);

  // En lote los pedidos pueden ser de dias distintos: la disponibilidad que se
  // muestra es la del dia del pedido de referencia, asi que hay que avisarlo.
  const fechasDistintas = useMemo(() => [...new Set((fechasLote || []).filter(Boolean))], [fechasLote]);
  const loteVariasFechas = esBulk && fechasDistintas.length > 1;

  const dispVehiculo = useMemo(() => {
    const mapa = new Map();
    (disp?.vehiculos || []).forEach(v => mapa.set(String(v.id), v));
    return mapa;
  }, [disp]);
  const dispChofer = useMemo(() => {
    const mapa = new Map();
    (disp?.choferes || []).forEach(c => mapa.set(String(c.id), c));
    return mapa;
  }, [disp]);
  const estadoDe = (mapa, id) => mapa.get(String(id)) || null;

  const vehMatch = useMemo(() => {
    const m = String(matricula || "").trim().toUpperCase();
    if (!m) return null;
    return vehiculos.find(v => String(v.matricula || "").toUpperCase() === m) || null;
  }, [matricula, vehiculos]);

  const matriculaVehiculo = (id) => {
    const v = vehiculos.find(x => String(x.id) === String(id));
    return v?.matricula ? formatMatricula(v.matricula) : "";
  };

  // Al poner la tractora: si tiene conjunto (remolque/chofer), se rellenan solos.
  function onMatriculaChange(raw) {
    const val = formatMatricula(raw);
    setMatricula(val);
    const veh = vehiculos.find(v => String(v.matricula || "").toUpperCase() === val.trim().toUpperCase());
    if (!veh) return;
    if (veh.remolque_id) {
      const rem = matriculaVehiculo(veh.remolque_id);
      if (rem) setRemolque(rem);
    }
    const choferConjunto = veh.chofer_id || choferes.find(c => String(c.vehiculo_id) === String(veh.id))?.id;
    if (choferConjunto) setChoferId(choferConjunto);
  }

  // Al poner el chofer sin tractora: se usan las matriculas de su vehiculo (las del chofer).
  function onChoferChange(id) {
    setChoferId(id);
    if (!id) return;
    const chofer = choferes.find(c => String(c.id) === String(id));
    const veh = chofer?.vehiculo_id ? vehiculos.find(v => String(v.id) === String(chofer.vehiculo_id)) : null;
    if (!veh) return;
    if (!String(matricula || "").trim()) setMatricula(formatMatricula(veh.matricula || ""));
    if (!String(remolque || "").trim() && veh.remolque_id) {
      const rem = matriculaVehiculo(veh.remolque_id);
      if (rem) setRemolque(rem);
    }
  }

  async function asignar() {
    const mat = String(matricula || "").trim().toUpperCase();
    const rem = String(remolque || "").trim().toUpperCase();
    if (!mat && !choferId) { return; }
    const remVeh = rem ? vehiculos.find(v => String(v.matricula || "").toUpperCase() === rem) : null;
    const patch = {};
    if (vehMatch) {
      patch.vehiculo_id = vehMatch.id;
      patch.colaborador_id = "";
      patch.matricula_manual = "";
    } else if (mat) {
      patch.matricula_manual = mat;
      patch.vehiculo_id = "";
      patch.colaborador_id = "";
    }
    if (mat || rem) {
      // Si el remolque es de la flota, se enlaza por id (conjunto); si no, a mano.
      if (remVeh) { patch.remolque_id_manual = remVeh.id; patch.remolque_matricula_manual = ""; }
      else { patch.remolque_id_manual = ""; patch.remolque_matricula_manual = rem; }
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
    ayuda: { fontSize: 10, color: "var(--text5)", margin: "8px 0 5px" },
    chips: { display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 96, overflowY: "auto", marginTop: 5 },
    // Ocupado = atenuado, pero sigue siendo clicable (a veces hay que asignarlo).
    chip: (libre, sel) => ({
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 9px", borderRadius: 999, cursor: "pointer",
      border: `1px solid ${sel ? "var(--accent)" : libre ? "rgba(16,185,129,.35)" : "var(--border2)"}`,
      background: sel ? "var(--accent-a12)" : libre ? "rgba(16,185,129,.08)" : "var(--bg3)",
      color: libre ? "var(--text)" : "var(--text5)",
      opacity: libre ? 1 : .65,
      fontSize: 11, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace",
    }),
    punto: (libre) => ({
      width: 7, height: 7, borderRadius: "50%", display: "inline-block",
      background: libre ? "#10b981" : "#94a3b8",
    }),
    avisoOcupado: {
      marginTop: 5, fontSize: 11, fontWeight: 700, color: "#b45309",
      background: "rgba(245,158,11,.10)", border: "1px solid rgba(245,158,11,.28)",
      borderRadius: 7, padding: "5px 9px",
    },
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.box} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>
          {esBulk ? `Asignar a ${bulkCount} pedidos` : "Asignar vehiculo"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 3 }}>
          {esBulk
            ? "Se aplicara la misma matricula, remolque y chofer a todos los pedidos seleccionados."
            : <>Pedido {pedido?.numero || ""} · {pedido?.origen || ""} {pedido?.destino ? `-> ${pedido.destino}` : ""}</>}
        </div>

        <datalist id="tg-quick-tractoras">
          {tractoras.map(v => <option key={v.id} value={v.matricula} />)}
        </datalist>
        <datalist id="tg-quick-remolques">
          {remolques.map(v => <option key={v.id} value={v.matricula} />)}
        </datalist>

        <label style={S.label}>Matricula (elige de la flota o escribe a mano)</label>
        <input list="tg-quick-tractoras" style={S.input} value={matricula} autoFocus
          onChange={e => onMatriculaChange(e.target.value)} placeholder="Ej: 1234-ABC" />
        {matricula && (
          <div style={{ fontSize: 11, color: vehMatch ? "#10b981" : "var(--text5)", marginTop: 4 }}>
            {vehMatch ? `Vehiculo de la flota: ${vehMatch.matricula}${vehMatch.marca ? ` (${vehMatch.marca})` : ""}` : "Matricula a mano (no esta en la flota)"}
          </div>
        )}
        {vehMatch && estadoDe(dispVehiculo, vehMatch.id) && !estadoDe(dispVehiculo, vehMatch.id).disponible && (
          <div style={S.avisoOcupado}>Ojo: {estadoDe(dispVehiculo, vehMatch.id).motivo}</div>
        )}

        {/* Flota con disponibilidad para la fecha del viaje */}
        {tractoras.length > 0 && (
          <>
            <div style={S.ayuda}>
              {disp ? "Verde = libre ese dia. Gris = ocupado (puedes asignarlo igual)." : "Comprobando disponibilidad..."}
            </div>
            {loteVariasFechas && (
              <div style={S.avisoOcupado}>
                Los {bulkCount} pedidos seleccionados son de {fechasDistintas.length} dias distintos.
                La disponibilidad mostrada es la del {String(pedido?.fecha_carga || pedido?.fecha_pedido || "").slice(0, 10)}.
              </div>
            )}
            <div style={S.chips}>
              {tractoras.map(v => {
                const est = estadoDe(dispVehiculo, v.id);
                const libre = !est || est.disponible;
                const sel = String(v.matricula || "").toUpperCase() === String(matricula || "").toUpperCase();
                return (
                  <button key={v.id} type="button" title={est?.motivo || "Disponible"}
                    onClick={() => onMatriculaChange(v.matricula)}
                    style={S.chip(libre, sel)}>
                    <span style={S.punto(libre)} />
                    {v.matricula}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <label style={S.label}>Remolque (opcional)</label>
        <input list="tg-quick-remolques" style={S.input} value={remolque}
          onChange={e => setRemolque(formatMatricula(e.target.value))} placeholder="Ej: R-1234-BCD" />

        <label style={S.label}>Chofer (opcional)</label>
        <select style={S.input} value={choferId} onChange={e => onChoferChange(e.target.value)}>
          <option value="">{vehMatch && vehMatch.chofer_id ? "Auto del vehiculo" : "Sin asignar"}</option>
          {choferes.map(c => {
            const est = estadoDe(dispChofer, c.id);
            const sufijo = est && !est.disponible ? ` - ocupado: ${est.motivo}` : "";
            return <option key={c.id} value={c.id}>{`${c.nombre || ""} ${c.apellidos || ""}`.trim()}{sufijo}</option>;
          })}
        </select>
        {choferId && estadoDe(dispChofer, choferId) && !estadoDe(dispChofer, choferId).disponible && (
          <div style={S.avisoOcupado}>Ojo: {estadoDe(dispChofer, choferId).motivo}</div>
        )}
        {choferes.length > 0 && (
          <div style={S.chips}>
            {choferes.map(c => {
              const est = estadoDe(dispChofer, c.id);
              const libre = !est || est.disponible;
              const sel = String(c.id) === String(choferId);
              return (
                <button key={c.id} type="button" title={est?.motivo || "Disponible"}
                  onClick={() => onChoferChange(String(c.id))}
                  style={S.chip(libre, sel)}>
                  <span style={S.punto(libre)} />
                  {(c.nombre || "").split(" ")[0]} {(c.apellidos || "").split(" ")[0]}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button style={S.btn} onClick={onClose} disabled={trabajando}>Cancelar</button>
          <button
            style={{ ...S.btn, background: "var(--accent,var(--accent))", color: "#fff", borderColor: "var(--accent,var(--accent))", opacity: trabajando || (!matricula && !choferId) ? .6 : 1 }}
            onClick={asignar} disabled={trabajando || (!matricula && !choferId)}>
            {trabajando ? "Asignando..." : (esBulk ? `Asignar a ${bulkCount}` : "Asignar")}
          </button>
        </div>
      </div>
    </div>
  );
}
