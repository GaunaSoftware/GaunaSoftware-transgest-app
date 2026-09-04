import { useMemo } from "react";

// Vista de un remolque desde arriba con las cargas de un grupaje colocadas por
// ORDEN DE CARGA (como se carga de verdad, una detras de otra desde el porton).
// No impide pasarse: si se excede peso, metros lineales o palets lo marca en
// rojo pero deja seguir, porque en trafico la carga real difiere de la prevista.

// Trailer estandar espanol, usado solo si el vehiculo no trae sus medidas.
export const REMOLQUE_DEFECTO = { metros: 13.6, peso: 24000, palets: 33 };

// Metros lineales que ocupa un palet segun su tipo, colocado en el sentido
// normal de carga (dos por fila a lo ancho del remolque).
const ML_POR_PALET = {
  europeo: 0.4,    // 120x80: 2 por fila -> 0,80 m de fondo entre 2
  americano: 0.5,  // 120x100: 2 por fila -> 1,00 m de fondo entre 2
  medio: 0.2,      // medio palet 80x60
};

export function mlDeCarga(p) {
  const ml = Number(p?.metros_lineales || 0);
  if (ml > 0) return ml;
  // Sin ML declarados: se estiman con el tipo y el numero de palets.
  const n = Number(p?.palets_cantidad || 0);
  if (n > 0) {
    const unit = ML_POR_PALET[String(p?.palets_tipo || "europeo")] ?? ML_POR_PALET.europeo;
    // Si se pueden apilar ocupan la mitad de suelo (dos alturas).
    return n * unit * (p?.palets_apilables ? 0.5 : 1);
  }
  // Mercancia sin paletizar: se usa el largo declarado.
  return Number(p?.carga_largo_m || 0);
}

export function paletsDeCarga(p) {
  return Number(p?.palets_cantidad || 0) || Number(p?.bultos || 0) || 0;
}

// Capacidad del remolque a partir del vehiculo asignado. Si le faltan datos cae
// al trailer estandar y lo indica, para no confundir un valor por defecto con
// una medida real de la flota.
export function capacidadRemolque(vehiculo) {
  const metros = Number(vehiculo?.metros_carga || 0)
    || (Number(vehiculo?.longitud_mm || 0) ? Number(vehiculo.longitud_mm) / 1000 : 0);
  const peso = Number(vehiculo?.masa_total_kg || 0);
  const palets = Number(vehiculo?.capacidad_palets || 0);
  return {
    metros: metros > 0 ? metros : REMOLQUE_DEFECTO.metros,
    peso: peso > 0 ? peso : REMOLQUE_DEFECTO.peso,
    palets: palets > 0 ? palets : REMOLQUE_DEFECTO.palets,
    estimado: !(metros > 0 && peso > 0 && palets > 0),
  };
}

const COLORES = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];
const fmt = (n, d = 1) => Number(n || 0).toLocaleString("es-ES", { maximumFractionDigits: d });

function Barra({ etiqueta, valor, max, unidad, decimales = 1 }) {
  const pct = max > 0 ? (valor / max) * 100 : 0;
  const excede = valor > max;
  const color = excede ? "#ef4444" : pct > 85 ? "#f59e0b" : "var(--green)";
  return (
    <div style={{ flex: "1 1 150px", minWidth: 140 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 800, marginBottom: 3 }}>
        <span style={{ color: "var(--text5)", textTransform: "uppercase", letterSpacing: ".05em" }}>{etiqueta}</span>
        <span style={{ color, fontFamily: "'JetBrains Mono',monospace" }}>
          {fmt(valor, decimales)} / {fmt(max, decimales)} {unidad}
        </span>
      </div>
      <div style={{ height: 7, borderRadius: 999, background: "var(--bg4)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: color, transition: "width .2s" }} />
      </div>
      {excede && (
        <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 800, marginTop: 3 }}>
          Se pasa en {fmt(valor - max, decimales)} {unidad}
        </div>
      )}
    </div>
  );
}

export default function RemolqueGrupaje({ pedidos = [], vehiculo = null, onSelect = null, seleccionadoId = "" }) {
  const cap = useMemo(() => capacidadRemolque(vehiculo), [vehiculo]);

  const cargas = useMemo(() => pedidos.map((p, i) => ({
    pedido: p,
    ml: mlDeCarga(p),
    peso: Number(p.peso_kg || 0),
    palets: paletsDeCarga(p),
    color: COLORES[i % COLORES.length],
  })), [pedidos]);

  const totales = useMemo(() => cargas.reduce((a, c) => ({
    ml: a.ml + c.ml, peso: a.peso + c.peso, palets: a.palets + c.palets,
  }), { ml: 0, peso: 0, palets: 0 }), [cargas]);

  const excedeAlgo = totales.ml > cap.metros || totales.peso > cap.peso || totales.palets > cap.palets;
  // La escala usa el mayor entre capacidad y carga, para que el exceso se VEA
  // saliendose del remolque en lugar de recortarse.
  const escala = Math.max(cap.metros, totales.ml) || 1;
  const libre = Math.max(0, cap.metros - totales.ml);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg2)", padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)" }}>Ocupacion del remolque</div>
          <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 2 }}>
            {vehiculo?.matricula ? `${vehiculo.matricula} - ` : ""}
            {fmt(cap.metros)} m de carga, {fmt(cap.peso, 0)} kg, {cap.palets} palets
            {cap.estimado ? " (medidas estimadas: completa la ficha del vehiculo)" : ""}
          </div>
        </div>
        {excedeAlgo && (
          <span style={{ fontSize: 11, fontWeight: 900, color: "#ef4444", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 999, padding: "4px 10px" }}>
            Se pasa de capacidad
          </span>
        )}
      </div>

      {/* Remolque visto desde arriba: cabeza a la izquierda, porton a la derecha */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 4, marginBottom: 12 }}>
        <div title="Cabeza tractora" style={{ width: 26, borderRadius: "6px 2px 2px 6px", background: "var(--bg4)", border: "1px solid var(--border2)", display: "grid", placeItems: "center", fontSize: 9, color: "var(--text5)", fontWeight: 800 }}>
          CAB
        </div>
        <div style={{ flex: 1, position: "relative", minHeight: 74, display: "flex", borderRadius: 6, border: `2px solid ${excedeAlgo ? "#ef4444" : "var(--border2)"}`, background: "var(--bg3)", overflow: "hidden" }}>
          {cargas.map((c, i) => {
            const pct = (c.ml / escala) * 100;
            const sel = String(c.pedido.id) === String(seleccionadoId);
            return (
              <div key={c.pedido.id || i}
                onClick={() => onSelect && onSelect(c.pedido)}
                title={`${c.pedido.numero || "Viaje"} - ${c.pedido.cliente_nombre || ""} | ${fmt(c.ml)} ML, ${fmt(c.peso, 0)} kg, ${c.palets} palets`}
                style={{
                  width: `${pct}%`, minWidth: pct > 0 ? 8 : 0,
                  background: c.color, opacity: sel ? 1 : 0.82,
                  borderRight: "1px solid rgba(255,255,255,.35)",
                  cursor: onSelect ? "pointer" : "default",
                  display: "flex", flexDirection: "column", justifyContent: "center",
                  padding: "4px 5px", overflow: "hidden", color: "#fff",
                  outline: sel ? "2px solid #fff" : "none", outlineOffset: -3,
                }}>
                <div style={{ fontSize: 10, fontWeight: 900, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                  {c.pedido.numero || `Carga ${i + 1}`}
                </div>
                <div style={{ fontSize: 9, opacity: 0.9, whiteSpace: "nowrap" }}>{fmt(c.ml)} ML</div>
              </div>
            );
          })}
          {libre > 0 && (
            <div style={{ width: `${(libre / escala) * 100}%`, display: "grid", placeItems: "center", fontSize: 10, color: "var(--text5)", fontWeight: 800 }}>
              {libre >= 1 ? `${fmt(libre)} m libres` : ""}
            </div>
          )}
          {!cargas.length && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 11, color: "var(--text5)" }}>
              Remolque vacio: anade viajes al grupaje
            </div>
          )}
        </div>
        <div title="Porton (por aqui se carga)" style={{ width: 10, borderRadius: "2px 6px 6px 2px", background: "var(--bg4)", border: "1px solid var(--border2)" }} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Barra etiqueta="Metros lineales" valor={totales.ml} max={cap.metros} unidad="m" />
        <Barra etiqueta="Peso" valor={totales.peso} max={cap.peso} unidad="kg" decimales={0} />
        <Barra etiqueta="Palets" valor={totales.palets} max={cap.palets} unidad="" decimales={0} />
      </div>
    </div>
  );
}
