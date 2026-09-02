import { useCallback, useEffect, useState } from "react";
import {
  getContabilidadExportConfig,
  setContabilidadExportConfig,
  getContabilidadExportResumen,
  confirmarContabilidadLote,
  borrarContabilidadLote,
  descargarContabilidadExport,
} from "../services/api";
import { confirmDialog, notify } from "../services/notify";

// Traspaso de las facturas emitidas al programa de contabilidad de la empresa.
// Flujo del dia a dia: configurar una vez -> descargar el fichero del periodo ->
// importarlo en el programa -> marcar el lote para no repetir asientos.
const PROGRAMAS = [
  { v: "contasol", l: "CONTASOL / FACTUSOL", fichero: "APU.xlsx", ruta: "Utilidades > Importaciones > Archivos > .XLSX" },
  { v: "a3", l: "a3ASESOR (eco / con)", fichero: "SUENLACE.DAT", ruta: "Utilidades > Importar/Exportar > Enlace Contable" },
  { v: "csv", l: "Otro programa / asesoria (CSV)", fichero: "APU.csv", ruta: "Se entrega a la asesoria o se adapta a otro importador" },
];

const eur = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoy = () => new Date().toISOString().slice(0, 10);
const primerDiaMesAnterior = () => {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

export default function ContabilidadExportPanel({ puedeConfigurar = false }) {
  const [config, setConfig] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [verConfig, setVerConfig] = useState(false);
  const [desde, setDesde] = useState(primerDiaMesAnterior);
  const [hasta, setHasta] = useState(hoy);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [cfg, res] = await Promise.all([
        getContabilidadExportConfig().catch(() => null),
        getContabilidadExportResumen({ desde, hasta }).catch(() => null),
      ]);
      if (cfg) setConfig(cfg);
      if (res) { setResumen(res); if (res.config) setConfig(res.config); }
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => { if (abierto) cargar(); }, [abierto, cargar]);

  const programa = PROGRAMAS.find(p => p.v === (config?.programa || "contasol")) || PROGRAMAS[0];

  async function descargar(formato) {
    setTrabajando(formato);
    try {
      const r = await descargarContabilidadExport({ desde, hasta, formato });
      notify(`Fichero ${r.filename} descargado. Importalo en ${programa.l}.`, "success");
    } catch (e) {
      notify(e.message || "No se pudo generar el fichero.", "error");
    } finally {
      setTrabajando("");
    }
  }

  async function marcarLote() {
    const n = resumen?.pendientes || 0;
    if (!n) { notify("No hay facturas pendientes de traspasar.", "info"); return; }
    const ok = await confirmDialog({
      title: "Marcar como traspasadas",
      message: `Se marcaran ${n} factura(s) (${eur(resumen?.importe_total)} EUR) como ya volcadas a ${programa.l}.\n\nDejaran de salir en el proximo fichero, para no duplicar asientos. Hazlo solo cuando el fichero ya se haya importado correctamente.\n\nSiempre puedes deshacerlo desde el historial.`,
      confirmText: `Marcar ${n} factura(s)`,
      cancelText: "Cancelar",
    });
    if (!ok) return;
    setTrabajando("marcar");
    try {
      await confirmarContabilidadLote({ desde, hasta, formato: config?.programa });
      notify(`${n} factura(s) marcadas como traspasadas.`, "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo marcar el lote.", "error");
    } finally {
      setTrabajando("");
    }
  }

  async function deshacerLote(lote) {
    const ok = await confirmDialog({
      title: "Deshacer traspaso",
      message: `Las ${lote.total_facturas} factura(s) de este lote volveran a quedar pendientes y saldran en el proximo fichero.\n\nUsalo si la importacion en el programa contable fallo o hubo que repetirla.`,
      confirmText: "Deshacer",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await borrarContabilidadLote(lote.id);
      notify("Lote deshecho: las facturas vuelven a estar pendientes.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo deshacer el lote.", "error");
    }
  }

  async function guardarConfig(e) {
    e.preventDefault();
    setTrabajando("config");
    try {
      const guardada = await setContabilidadExportConfig(config);
      setConfig(guardada);
      notify("Configuracion contable guardada.", "success");
      setVerConfig(false);
      cargar();
    } catch (err) {
      notify(err.message || "No se pudo guardar la configuracion.", "error");
    } finally {
      setTrabajando("");
    }
  }

  const S = {
    card: { border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg2)", padding: 14, marginBottom: 14 },
    head: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer" },
    titulo: { fontSize: 13, fontWeight: 900, color: "var(--text)" },
    sub: { fontSize: 11, color: "var(--text4)", marginTop: 2 },
    btn: { padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text3)", fontSize: 12, fontWeight: 800, cursor: "pointer" },
    btnMain: { padding: "7px 14px", borderRadius: 7, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" },
    input: { width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 12 },
    label: { display: "block", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text5)", marginBottom: 3 },
    chip: { fontSize: 10, fontWeight: 900, padding: "3px 9px", borderRadius: 999, background: "var(--accent-a12)", color: "var(--accent)", border: "1px solid var(--accent-a30)" },
  };

  return (
    <div style={S.card}>
      <div style={S.head} onClick={() => setAbierto(v => !v)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.titulo}>Traspaso a contabilidad</div>
          <div style={S.sub}>
            Genera el fichero de importacion para {programa.l} con las facturas emitidas y lleva el control de lo ya volcado.
          </div>
        </div>
        {abierto && resumen?.pendientes > 0 && (
          <span style={{ ...S.chip, background: "rgba(245,158,11,.12)", color: "#b45309", borderColor: "rgba(245,158,11,.3)" }}>
            {resumen.pendientes} pendiente(s)
          </span>
        )}
        <span style={S.chip}>{programa.fichero}</span>
        <button type="button" style={S.btn}>{abierto ? "Ocultar" : "Abrir"}</button>
      </div>

      {abierto && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          {/* Periodo */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <div style={{ minWidth: 140 }}>
              <label style={S.label}>Desde</label>
              <input type="date" style={S.input} value={desde} onChange={e => setDesde(e.target.value)} />
            </div>
            <div style={{ minWidth: 140 }}>
              <label style={S.label}>Hasta</label>
              <input type="date" style={S.input} value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>
            <button type="button" style={S.btn} onClick={cargar} disabled={cargando}>
              {cargando ? "Calculando..." : "Actualizar"}
            </button>
          </div>

          {/* Resumen de lo pendiente */}
          <div style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            {cargando ? (
              <div style={{ fontSize: 12, color: "var(--text4)" }}>Cargando facturas pendientes...</div>
            ) : resumen?.pendientes ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                  {resumen.pendientes} factura(s) sin traspasar - {eur(resumen.importe_total)} EUR
                </div>
                <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 3 }}>
                  De {resumen.primera_fecha || "-"} a {resumen.ultima_fecha || "-"}. Solo salen las emitidas (los borradores nunca entran en contabilidad).
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 700 }}>
                Todo al dia: no hay facturas pendientes de traspasar en este periodo.
              </div>
            )}
          </div>

          {/* Acciones del dia a dia */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button type="button" style={{ ...S.btnMain, opacity: trabajando ? .6 : 1 }} disabled={!!trabajando}
              onClick={() => descargar(config?.programa || "contasol")}>
              {trabajando === (config?.programa || "contasol") ? "Generando..." : `1. Descargar ${programa.fichero}`}
            </button>
            <button type="button" style={S.btn} disabled={!!trabajando} onClick={() => descargar("csv")}>
              Revisar en CSV
            </button>
            <button type="button"
              style={{ ...S.btn, background: "rgba(16,185,129,.10)", color: "var(--green)", borderColor: "rgba(16,185,129,.3)" }}
              disabled={!!trabajando || !resumen?.pendientes} onClick={marcarLote}>
              {trabajando === "marcar" ? "Marcando..." : "2. Ya importado: marcar como traspasadas"}
            </button>
            {puedeConfigurar && (
              <button type="button" style={S.btn} onClick={() => setVerConfig(v => !v)}>
                {verConfig ? "Cerrar ajustes" : "Ajustes contables"}
              </button>
            )}
          </div>

          <div style={{ fontSize: 11, color: "var(--text5)", marginBottom: 12, lineHeight: 1.5 }}>
            Importa el fichero en <b>{programa.l}</b> desde <i>{programa.ruta}</i>. Cuando la importacion haya ido bien,
            pulsa <b>marcar como traspasadas</b>: esas facturas no volveran a salir, asi no se duplican asientos.
          </div>

          {/* Ajustes: programa y cuentas */}
          {verConfig && puedeConfigurar && config && (
            <form onSubmit={guardarConfig} style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                <div style={{ gridColumn: "1/-1" }}>
                  <label style={S.label}>Programa de contabilidad</label>
                  <select style={S.input} value={config.programa || "contasol"}
                    onChange={e => setConfig(c => ({ ...c, programa: e.target.value }))}>
                    {PROGRAMAS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Digitos del plan contable</label>
                  <input type="number" min="3" max="12" style={S.input} value={config.digitos ?? 7}
                    onChange={e => setConfig(c => ({ ...c, digitos: e.target.value }))} />
                </div>
                <div>
                  <label style={S.label}>Diario</label>
                  <input type="number" min="1" style={S.input} value={config.diario ?? 1}
                    onChange={e => setConfig(c => ({ ...c, diario: e.target.value }))} />
                </div>
                <div>
                  <label style={S.label}>Codigo de empresa (a3)</label>
                  <input type="number" min="1" style={S.input} value={config.codigo_empresa ?? 1}
                    onChange={e => setConfig(c => ({ ...c, codigo_empresa: e.target.value }))} />
                </div>
                <div>
                  <label style={S.label}>Cuenta clientes</label>
                  <input style={S.input} value={config.cuenta_cliente || ""}
                    onChange={e => setConfig(c => ({ ...c, cuenta_cliente: e.target.value }))} placeholder="4300000" />
                </div>
                <div>
                  <label style={S.label}>Cuenta ventas</label>
                  <input style={S.input} value={config.cuenta_ventas || ""}
                    onChange={e => setConfig(c => ({ ...c, cuenta_ventas: e.target.value }))} placeholder="7050000" />
                </div>
                <div>
                  <label style={S.label}>Cuenta IVA repercutido</label>
                  <input style={S.input} value={config.cuenta_iva || ""}
                    onChange={e => setConfig(c => ({ ...c, cuenta_iva: e.target.value }))} placeholder="4770000" />
                </div>
                <div>
                  <label style={S.label}>Cuenta retenciones</label>
                  <input style={S.input} value={config.cuenta_retencion || ""}
                    onChange={e => setConfig(c => ({ ...c, cuenta_retencion: e.target.value }))} placeholder="4730000" />
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--text5)", margin: "8px 0" }}>
                Estas cuentas deben existir en tu plan contable. Si no estas seguro, preguntalo a tu asesoria antes
                de la primera importacion y prueba primero en una empresa de pruebas.
              </div>
              <button type="submit" style={S.btnMain} disabled={trabajando === "config"}>
                {trabajando === "config" ? "Guardando..." : "Guardar ajustes"}
              </button>
            </form>
          )}

          {/* Historial de lotes */}
          {resumen?.ultimos_lotes?.length > 0 && (
            <div>
              <div style={{ ...S.label, marginBottom: 6 }}>Traspasos anteriores</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {resumen.ultimos_lotes.map(l => (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 7, padding: "6px 10px" }}>
                    <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700 }}>
                      {String(l.created_at || "").slice(0, 10)}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text4)" }}>
                      {l.total_facturas} factura(s) - {eur(l.importe_total)} EUR - {l.formato}
                    </span>
                    {puedeConfigurar && (
                      <button type="button" style={{ ...S.btn, marginLeft: "auto", padding: "3px 9px", fontSize: 11 }}
                        onClick={() => deshacerLote(l)}>
                        Deshacer
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
