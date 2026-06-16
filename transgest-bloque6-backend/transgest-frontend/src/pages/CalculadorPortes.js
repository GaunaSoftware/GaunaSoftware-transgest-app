import { useState } from "react";
import { notify } from "../services/notify";

const PRECIO_GASOIL = 1.45;
const COSTE_KM_BASE = 0.48; // coste operativo: conductor, amortizacion, mantenimiento y seguros
const COSTE_PEAJES = 0.05; // estimacion media por km
const PESO_REFERENCIA_KG = 24000;

function toNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calcularConsumo(pesoKg, esGrupaje) {
  // Referencia práctica: un trailer cargado en torno a 24 T consume aprox. 27 L/100 km.
  const consumoVacio = 22;
  const consumoReferencia = 27;
  const peso = clamp(toNumber(pesoKg, PESO_REFERENCIA_KG), 0, PESO_REFERENCIA_KG * 1.15);
  const factor = peso / PESO_REFERENCIA_KG;
  const exceso = Math.max(0, factor - 1) * 2;
  const consumo = consumoVacio + (consumoReferencia - consumoVacio) * Math.min(factor, 1) + exceso;
  return esGrupaje ? consumo * 0.75 : consumo;
}

export default function CalculadorPortes() {
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [km, setKm] = useState("");
  const [peso, setPeso] = useState("");
  const [esGrupaje, setEsGrupaje] = useState(false);
  const [numPalets, setNumPalets] = useState("");
  const [calcKm, setCalcKm] = useState(false);
  const [margenPct, setMargenPct] = useState(25);
  const [precioGas, setPrecioGas] = useState(PRECIO_GASOIL);
  const [conPeajes, setConPeajes] = useState(true);
  const [usarMultiplicadorCorto, setUsarMultiplicadorCorto] = useState(true);
  const [kmCortoLimite, setKmCortoLimite] = useState(120);
  const [multiplicadorCorto, setMultiplicadorCorto] = useState(1.4);

  async function calcularDistancia() {
    if (!origen.trim() || !destino.trim()) return;
    setCalcKm(true);
    try {
      const geo = async (place) => {
        for (const q of [`${place}, España`, place]) {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`);
          const d = await r.json();
          if (d[0]) return [parseFloat(d[0].lon), parseFloat(d[0].lat)];
        }
        return null;
      };
      const [o, d] = await Promise.all([geo(origen), geo(destino)]);
      if (!o || !d) {
        notify("No se encontro alguna de las poblaciones. Introducelas manualmente.", "warning");
        return;
      }
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${o[0]},${o[1]};${d[0]},${d[1]}?overview=false`);
      const data = await r.json();
      if (data.code === "Ok") setKm(Math.round(data.routes[0].distance / 1000));
      else notify("No se pudo calcular la distancia.", "warning");
    } catch (e) {
      notify("Error: " + e.message, "error");
    } finally {
      setCalcKm(false);
    }
  }

  const kmNum = toNumber(km);
  const pesoIntroducido = toNumber(peso);
  const pesoCalculo = pesoIntroducido > 0 ? pesoIntroducido : PESO_REFERENCIA_KG;
  const gasoilNum = toNumber(precioGas, PRECIO_GASOIL);
  const margenObjetivo = clamp(toNumber(margenPct), 0, 95);
  const puedeCalcular = kmNum > 0;
  const kmCortoNum = Math.max(0, toNumber(kmCortoLimite, 120));
  const multiplicadorCortoNum = clamp(toNumber(multiplicadorCorto, 1.4), 1, 5);
  const aplicaMultiplicadorCorto = usarMultiplicadorCorto && puedeCalcular && kmNum <= kmCortoNum;

  const consumo = calcularConsumo(pesoCalculo, esGrupaje);
  const litros = (kmNum * consumo) / 100;
  const costeComb = litros * gasoilNum;
  const costePeajes = conPeajes ? kmNum * COSTE_PEAJES : 0;
  const costeKm = kmNum * COSTE_KM_BASE + costePeajes;
  const costeDieta = kmNum > 300 ? 42 : kmNum > 150 ? 21 : 0;
  const costeBase = costeComb + costeKm + costeDieta;
  const precioBase = puedeCalcular ? costeBase / (1 - margenObjetivo / 100) : 0;
  const recargoCorto = aplicaMultiplicadorCorto ? precioBase * (multiplicadorCortoNum - 1) : 0;
  const precioSug = aplicaMultiplicadorCorto ? precioBase * multiplicadorCortoNum : precioBase;
  const margen = precioSug - costeBase;
  const margenReal = precioSug > 0 ? (margen / precioSug) * 100 : 0;

  const inp = {
    background: "var(--bg4)",
    border: "1px solid var(--border2)",
    color: "var(--text)",
    padding: "9px 12px",
    borderRadius: 8,
    fontFamily: "'DM Sans',sans-serif",
    fontSize: 13,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };
  const lbl = {
    display: "block",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".07em",
    color: "var(--text5)",
    marginBottom: 4,
    marginTop: 12,
  };
  const fmt = n => toNumber(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ flex: 1, padding: "22px 26px", fontFamily: "'DM Sans',sans-serif", maxWidth: 900 }}>
      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>
        Calculador de portes
      </div>
      <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 24 }}>
        Calcula el coste real del transporte, el consumo estimado y el precio a cobrar con margen real sobre venta.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 12, textTransform: "uppercase", letterSpacing: ".06em" }}>
            Datos del viaje
          </div>

          <label style={lbl}>Población de origen</label>
          <input style={inp} value={origen} onChange={e => setOrigen(e.target.value)} placeholder="Madrid" />

          <label style={lbl}>Población de destino</label>
          <input style={inp} value={destino} onChange={e => setDestino(e.target.value)} placeholder="Barcelona" />

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...lbl, marginTop: 0 }}>Kilómetros</label>
              <input style={inp} type="number" value={km} onChange={e => setKm(e.target.value)} placeholder="0" />
            </div>
            <button onClick={calcularDistancia} disabled={calcKm || !origen || !destino}
              style={{
                padding: "9px 14px", borderRadius: 8, border: "1px solid var(--accent)",
                background: "transparent", color: "var(--accent)", fontSize: 12,
                fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              }}>
              {calcKm ? "Calculando..." : "Calcular"}
            </button>
          </div>

          <label style={lbl}>Peso de la mercancía (kg)</label>
          <input style={inp} type="number" value={peso} onChange={e => setPeso(e.target.value)} placeholder="24.000 por defecto" />
          {!pesoIntroducido && (
            <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 5 }}>
              Si no indicas peso, se calcula con 24.000 kg como referencia.
            </div>
          )}

          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setConPeajes(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600,
                border: conPeajes ? "1px solid rgba(20,184,166,.4)" : "1px solid var(--border2)",
                background: conPeajes ? "rgba(20,184,166,.11)" : "var(--bg3)",
                color: conPeajes ? "var(--accent-xl)" : "var(--text4)",
                transition: "all .15s",
              }}>
              {conPeajes ? "Con peajes" : "Sin peajes"}
              <span style={{
                display: "inline-block", width: 32, height: 18, borderRadius: 9,
                background: conPeajes ? "var(--accent)" : "var(--border3)",
                position: "relative", transition: "background .2s",
              }}>
                <span style={{
                  position: "absolute", top: 2, left: conPeajes ? 14 : 2,
                  width: 14, height: 14, borderRadius: "50%", background: "#fff",
                  transition: "left .2s",
                }} />
              </span>
            </button>
            {conPeajes && (
              <span style={{ fontSize: 11, color: "var(--text5)" }}>
                +{fmt(costePeajes)} € estimado
              </span>
            )}
          </div>

          <label style={{ ...lbl, marginTop: 14 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={esGrupaje} onChange={e => setEsGrupaje(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }} />
              <span style={{ fontWeight: 600, color: "var(--text3)", textTransform: "none", letterSpacing: "normal", fontSize: 13 }}>
                Es grupaje
              </span>
            </span>
          </label>
          {esGrupaje && (
            <input style={inp} type="number" value={numPalets}
              onChange={e => setNumPalets(e.target.value)} placeholder="Nº palets" />
          )}

          <label style={lbl}>Precio gasoil (€/L)</label>
          <input style={inp} type="text" inputMode="decimal" value={precioGas}
            onChange={e => setPrecioGas(e.target.value)} placeholder="1,45" />

          <label style={lbl}>Margen objetivo (%) sobre venta</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...inp, flex: 1 }} type="text" inputMode="decimal" value={margenPct}
              onChange={e => setMargenPct(e.target.value)} />
            {[15, 20, 25, 30, 35].map(m => (
              <button key={m} onClick={() => setMargenPct(m)}
                style={{
                  padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border2)",
                  background: margenObjetivo === m ? "var(--accent)" : "transparent",
                  color: margenObjetivo === m ? "#fff" : "var(--text4)",
                  fontSize: 11, cursor: "pointer", fontWeight: 600,
                }}>
                {m}%
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16, padding: "12px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg3)" }}>
            <label style={{ ...lbl, marginTop: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={usarMultiplicadorCorto} onChange={e => setUsarMultiplicadorCorto(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }} />
                <span style={{ fontWeight: 600, color: "var(--text3)", textTransform: "none", letterSpacing: "normal", fontSize: 13 }}>
                  Activar multiplicador de viaje corto
                </span>
              </span>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
              <div>
                <label style={{ ...lbl, marginTop: 0 }}>Hasta km</label>
                <input style={inp} type="number" value={kmCortoLimite} onChange={e => setKmCortoLimite(e.target.value)} placeholder="120" />
              </div>
              <div>
                <label style={{ ...lbl, marginTop: 0 }}>Multiplicador</label>
                <input style={inp} type="text" inputMode="decimal" value={multiplicadorCorto} onChange={e => setMultiplicadorCorto(e.target.value)} placeholder="1,40" />
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 8 }}>
              Util para trayectos cortos con mucho tiempo de espera, carga o descarga.
            </div>
          </div>
        </div>

        <div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 14, textTransform: "uppercase", letterSpacing: ".06em" }}>
              Desglose de costes
            </div>
            {[
              ["Kilómetros", kmNum > 0 ? `${kmNum.toLocaleString("es-ES")} km` : "—", null],
              ["Peso usado", kmNum > 0 ? `${pesoCalculo.toLocaleString("es-ES")} kg${pesoIntroducido ? "" : " estimado"}` : "—", null],
              ["Consumo estimado", kmNum > 0 ? `${consumo.toFixed(1)} L/100 km = ${litros.toFixed(1)} L` : "—", null],
              ["Coste combustible", kmNum > 0 ? fmt(costeComb) + " €" : "—", "#f59e0b"],
              ["Peajes", conPeajes && kmNum > 0 ? fmt(costePeajes) + " €" : "Sin peajes", conPeajes ? null : "var(--text5)"],
              ["Coste operativo camión", kmNum > 0 ? fmt(kmNum * COSTE_KM_BASE) + " €" : "—", null],
              ["Dietas conductor", kmNum > 0 ? fmt(costeDieta) + " €" : "—", null],
              ["Recargo corto recorrido", aplicaMultiplicadorCorto ? fmt(recargoCorto) + " €" : "No aplica", aplicaMultiplicadorCorto ? "#10b981" : "var(--text5)"],            ].map(([label, val, color], i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0",
                borderBottom: "1px solid var(--border)", fontSize: 13,
              }}>
                <span style={{ color: "var(--text4)" }}>{label}</span>
                <span style={{
                  fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
                  color: color || "var(--text2)", textAlign: "right",
                }}>{val}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontSize: 14, fontWeight: 700 }}>
              <span style={{ color: "var(--text3)" }}>Coste total</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#ef4444" }}>
                {kmNum > 0 ? fmt(costeBase) + " €" : "—"}
              </span>
            </div>
          </div>

          {puedeCalcular && (
            <div style={{
              background: "rgba(16,185,129,.06)", border: "1px solid rgba(16,185,129,.25)",
              borderRadius: 12, padding: 20,
            }}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: "#10b981", marginBottom: 14,
                textTransform: "uppercase", letterSpacing: ".06em",
              }}>
                Precio a cobrar
              </div>
              <div style={{
                fontSize: 36, fontWeight: 900, fontFamily: "'Syne',sans-serif",
                color: "#10b981", marginBottom: 6,
              }}>
                {fmt(precioSug)} €
              </div>
              <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 12 }}>
                Coste {fmt(costeBase)} € + margen {fmt(margen)} €
                <span style={{
                  marginLeft: 8, padding: "2px 7px", borderRadius: 5,
                  background: "rgba(16,185,129,.15)", color: "#10b981", fontWeight: 700, fontSize: 11,
                }}>
                  {margenReal.toFixed(1)}% sobre venta
                </span>
              </div>

              {aplicaMultiplicadorCorto && (
                <div style={{
                  marginBottom: 10, padding: "8px 12px", background: "rgba(245,158,11,.08)",
                  border: "1px solid rgba(245,158,11,.2)", borderRadius: 7,
                  fontSize: 12, color: "#f59e0b",
                }}>
                  Viaje corto activado: x{multiplicadorCortoNum.toFixed(2)} para {kmNum.toLocaleString("es-ES")} km (limite {kmCortoNum.toLocaleString("es-ES")} km).
                </div>
              )}

              {esGrupaje && toNumber(numPalets) > 0 && (
                <div style={{
                  padding: "8px 12px", background: "rgba(20,184,166,.08)",
                  border: "1px solid rgba(20,184,166,.2)", borderRadius: 7,
                  fontSize: 12, color: "var(--accent-xl)", marginBottom: 8,
                }}>
                  Grupaje: {numPalets} palets - <strong>{fmt(precioSug / toNumber(numPalets))} € / palet</strong>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
                {[
                  ["€/km", kmNum > 0 ? fmt(precioSug / kmNum) : "—"],
                  ["€/100 km", kmNum > 0 ? fmt(precioSug / (kmNum / 100)) : "—"],
                  ["Margen", margenReal.toFixed(1) + "%"],
                ].map(([k, v], i) => (
                  <div key={i} style={{ background: "var(--bg3)", borderRadius: 7, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{
                      fontSize: 9, color: "var(--text5)", textTransform: "uppercase",
                      letterSpacing: ".06em", marginBottom: 4,
                    }}>{k}</div>
                    <div style={{
                      fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                      fontSize: 13, color: "var(--text)",
                    }}>{v}</div>
                  </div>
                ))}
              </div>

              {!conPeajes && (
                <div style={{
                  marginTop: 10, padding: "7px 10px", background: "rgba(245,158,11,.08)",
                  border: "1px solid rgba(245,158,11,.2)", borderRadius: 7,
                  fontSize: 11, color: "#f59e0b",
                }}>
                  Precio calculado sin peajes. Si la ruta incluye autopistas, ajusta el precio final.
                </div>
              )}
            </div>
          )}

          {!puedeCalcular && (
            <div style={{
              background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12,
              padding: 40, textAlign: "center", color: "var(--text5)",
            }}>
              <div style={{ fontSize: 13 }}>Introduce los kilómetros para calcular el precio a cobrar.</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>El margen se aplica como margen real sobre venta.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


