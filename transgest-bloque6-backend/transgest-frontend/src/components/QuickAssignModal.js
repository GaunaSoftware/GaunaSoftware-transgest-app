import { useCallback, useEffect, useMemo, useState } from "react";
import ResourcePicker from "./ResourcePicker";
import { formatMatricula } from "../utils/formatos";
import { getDisponibilidadRecursos } from "../services/api";

// Popup rapido de asignacion desde el boton "Asignar" de la lista de pedidos.
// Permite elegir una matricula de la flota o escribirla a mano (asignacion
// propia), y opcionalmente el chofer. No abre el formulario completo del pedido.
export default function QuickAssignModal({ pedido, vehiculos = [], choferes = [], colaboradores = [], onClose, onAssign, bulkCount = 0, fechasLote = [] }) {
  // Se puede asignar a flota propia (matricula + chofer) O a un proveedor
  // externo: son excluyentes, por eso van en dos modos.
  const [modo, setModo] = useState(pedido?.colaborador_id ? "proveedor" : "propio");
  const [colaboradorId, setColaboradorId] = useState(pedido?.colaborador_id || "");
  const [matricula, setMatricula] = useState(
    pedido?.vehiculo_matricula || pedido?.matricula_manual || ""
  );
  const [choferId, setChoferId] = useState(pedido?.chofer_id || "");
  const [remolque, setRemolque] = useState(
    pedido?.remolque_matricula || pedido?.remolque_matricula_manual || ""
  );
  const [trabajando, setTrabajando] = useState(false);
  const [activePicker, setActivePicker] = useState("");
  const [availabilityError, setAvailabilityError] = useState(false);

  // Un vehiculo es remolque si su clase lo indica, si es el remolque de otra
  // cabeza, o por convencion de matricula (R-1234, 1234-R). Asi el desplegable de
  // "Matricula" ofrece solo cabezas tractoras y el de "Remolque" solo remolques.
  const esRemolque = useCallback((v) => {
    const clase = String(v?.clase || v?.tipo || "").toLowerCase();
    const mat = String(v?.matricula || "").toUpperCase();
    const esRemolqueDeAlguien = vehiculos.some(t => t.remolque_id === v?.id);
    return clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly")
      || esRemolqueDeAlguien || /^R[-_\s]/i.test(mat) || mat.endsWith("-R") || mat.endsWith("_R");
  }, [vehiculos]);
  const tractoras = useMemo(() => vehiculos.filter(v => !esRemolque(v)), [vehiculos,esRemolque]);
  const remolques = useMemo(() => vehiculos.filter(v => esRemolque(v)), [vehiculos,esRemolque]);
  const esBulk = Number(bulkCount) > 1;
  // En modo proveedor basta con elegir proveedor; en modo propio, matricula o chofer.
  const puedeAsignar = modo === "proveedor" ? !!colaboradorId : (!!matricula || !!choferId);

  // Disponibilidad para la fecha del viaje: quien esta libre y, si no, por que.
  // Los ocupados NO se ocultan (a veces hay que asignarlos igual): salen
  // atenuados y con el motivo.
  const [disp, setDisp] = useState(null);
  useEffect(() => {
    let vivo = true;
    setDisp(null);
    setAvailabilityError(false);
    const fecha = String(pedido?.fecha_carga || pedido?.fecha_pedido || "").slice(0, 10);
    getDisponibilidadRecursos(fecha, pedido?.id || "")
      .then(d => { if (vivo) setDisp(d); })
      .catch(() => { if (vivo) setAvailabilityError(true); });
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
    // Proveedor externo: excluyente con la flota propia, asi que se limpia todo
    // lo de transporte propio al asignarlo.
    if (modo === "proveedor") {
      if (!colaboradorId) return;
      const col = colaboradores.find(c => String(c.id) === String(colaboradorId));
      setTrabajando(true);
      try {
        await onAssign({
          colaborador_id: colaboradorId,
          colaborador_nombre: col?.nombre || "",
          vehiculo_id: "", chofer_id: "", chofer2_id: "",
          matricula_manual: "", remolque_matricula_manual: "", remolque_id_manual: "",
        });
      } finally {
        setTrabajando(false);
      }
      return;
    }
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
    box: { width: "min(560px,100%)", maxHeight:"calc(100dvh - 32px)",overflowY:"auto",boxSizing:"border-box",background: "var(--bg2,#fff)", border: "1px solid var(--border2,#e2e8f0)", borderRadius: 8, padding: 20, boxShadow: "0 24px 60px rgba(15,23,42,.35)" },
    label: { display: "block", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text5,#94a3b8)", margin: "12px 0 4px" },
    input: { width: "100%", boxSizing: "border-box", background: "var(--bg4,#fff)", border: "1px solid var(--border2,#cfdbe5)", color: "var(--text,#0f172a)", padding: "9px 12px", borderRadius: 8, fontSize: 13, outline: "none" },
    btn: { padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontWeight: 800, fontSize: 13, cursor: "pointer" },
    ayuda: { fontSize: 10, color: "var(--text5)", margin: "8px 0 5px" },
    avisoOcupado: {
      marginTop: 5, fontSize: 11, fontWeight: 700, color: "#b45309",
      background: "rgba(245,158,11,.10)", border: "1px solid rgba(245,158,11,.28)",
      borderRadius: 7, padding: "5px 9px",
    },
  };

  return (
    <div style={S.overlay} onClick={()=>{if(!trabajando) onClose();}}>
      <div role="dialog" aria-label="Asignar recursos" style={S.box} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>
          {esBulk ? `Asignar a ${bulkCount} pedidos` : (modo === "proveedor" ? "Asignar proveedor" : "Asignar vehiculo")}
        </div>
        <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 3 }}>
          {esBulk
            ? "Se aplicara la misma matricula, remolque y chofer a todos los pedidos seleccionados."
            : <>Pedido {pedido?.numero || ""} · {pedido?.origen || ""} {pedido?.destino ? `-> ${pedido.destino}` : ""}</>}
        </div>

        {/* Flota propia o proveedor externo: son excluyentes */}
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          {[["propio", "Flota propia"], ["proveedor", "Proveedor externo"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setModo(v)}
              style={{
                flex: 1, padding: "7px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 800,
                border: `1px solid ${modo === v ? "var(--accent)" : "var(--border2)"}`,
                background: modo === v ? "var(--accent-a12)" : "var(--bg3)",
                color: modo === v ? "var(--accent)" : "var(--text4)",
              }}>{l}</button>
          ))}
        </div>

        {modo === "proveedor" ? (
          <>
            <label style={S.label}>Proveedor / transportista externo</label>
            <select style={S.input} value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
              <option value="">Selecciona un proveedor</option>
              {colaboradores.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}{c.cif ? ` - ${c.cif}` : ""}</option>
              ))}
            </select>
            <div style={{ ...S.ayuda, marginTop: 8 }}>
              Al asignarlo se quita el camion propio. Despues, desde el pedido, puedes generar
              su enlace de acceso para que confirme, ponga su matricula y conductor, marque estados
              y suba los albaranes.
            </div>
            {colaboradores.length === 0 && (
              <div style={S.avisoOcupado}>No hay proveedores dados de alta. Crealos en Colaboradores.</div>
            )}
          </>
        ) : (
        <>
        <div style={{display:"grid",gap:14,marginTop:14}}>
          {availabilityError && <div role="alert" style={S.avisoOcupado}>No se pudo verificar la disponibilidad.</div>}
          {loteVariasFechas && <div style={S.avisoOcupado}>Disponibilidad del {String(pedido?.fecha_carga || "").slice(0,10)}. El lote incluye {fechasDistintas.length} fechas.</div>}
          <ResourcePicker label="Tractora" value={matricula} freeText availability
            options={tractoras.map(v=>({value:v.matricula,label:v.matricula,available:estadoDe(dispVehiculo,v.id)?.disponible,reason:estadoDe(dispVehiculo,v.id)?.motivo}))}
            onChange={onMatriculaChange} open={activePicker==="vehiculo"} onOpen={()=>setActivePicker("vehiculo")} onClose={()=>setActivePicker("")} />
          {vehMatch && estadoDe(dispVehiculo,vehMatch.id)?.disponible===false && <div style={S.avisoOcupado}>{estadoDe(dispVehiculo,vehMatch.id).motivo}</div>}
          <ResourcePicker label="Remolque" value={remolque} freeText availability
            options={remolques.map(v=>({value:v.matricula,label:v.matricula,available:estadoDe(dispVehiculo,v.id)?.disponible,reason:estadoDe(dispVehiculo,v.id)?.motivo}))}
            onChange={setRemolque} open={activePicker==="remolque"} onOpen={()=>setActivePicker("remolque")} onClose={()=>setActivePicker("")} />
          <ResourcePicker label="Chofer" value={choferId} availability
            options={choferes.map(c=>({value:c.id,label:[c.nombre,c.apellidos].filter(Boolean).join(" "),available:estadoDe(dispChofer,c.id)?.disponible,reason:estadoDe(dispChofer,c.id)?.motivo}))}
            onChange={onChoferChange} open={activePicker==="chofer"} onOpen={()=>setActivePicker("chofer")} onClose={()=>setActivePicker("")} />
          {choferId && estadoDe(dispChofer,choferId)?.disponible===false && <div style={S.avisoOcupado}>{estadoDe(dispChofer,choferId).motivo}</div>}
        </div>
        </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button style={S.btn} onClick={onClose} disabled={trabajando}>Cancelar</button>
          <button
            style={{ ...S.btn, background: "var(--accent,var(--accent))", color: "#fff", borderColor: "var(--accent,var(--accent))", opacity: trabajando || !puedeAsignar ? .6 : 1 }}
            onClick={asignar} disabled={trabajando || !puedeAsignar}>
            {trabajando ? "Asignando..." : (esBulk ? `Asignar a ${bulkCount}` : "Asignar")}
          </button>
        </div>
      </div>
    </div>
  );
}
