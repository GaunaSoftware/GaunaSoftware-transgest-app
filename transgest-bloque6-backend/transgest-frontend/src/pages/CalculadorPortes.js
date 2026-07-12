import { useState } from "react";
import { notify } from "../services/notify";
import { calcularDistanciaGeo } from "../services/api";

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
      const route = await calcularDistanciaGeo(origen.trim(), destino.trim());
      const calculatedKm = Number(route?.km);
      if (!route?.ok || !Number.isFinite(calculatedKm) || calculatedKm <= 0) {
        notify("No se pudo calcular una distancia fiable. Revisa las poblaciones.", "warning");
        return;
      }
      setKm(Math.round(calculatedKm));
      if (route.warning) notify(route.warning, route.provider === "estimate" ? "warning" : "info");
    } catch (e) {
      notify(e.message || "No se pudo calcular la distancia.", "error");
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
    background: "var(--input-bg)",
    border: "1px solid var(--input-border)",
    color: "var(--input-text)",
    padding: "12px 14px",
    borderRadius: 8,
    fontFamily: "'DM Sans',sans-serif",
    fontSize: 15,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    boxShadow: "var(--shadow)",
  };
  const lbl = {
    display: "block",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: ".07em",
    color: "var(--text4)",
    marginBottom: 7,
    marginTop: 14,
  };
  const fmt = n => toNumber(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ flex: 1, padding: "36px 44px", fontFamily: "'DM Sans',sans-serif", minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 8, maxWidth: 1500, marginLeft: "auto", marginRight: "auto" }}>
        <button type="button" onClick={() => window.history.back()} style={{
          width: 42,
          height: 42,
          borderRadius: 8,
          border: "1px solid var(--accent-border)",
          background: "var(--button-bg)",
          color: "var(--accent)",
          fontSize: 24,
          fontWeight: 800,
          lineHeight: 1,
          cursor: "pointer",
        }}>
          ‹
        </button>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 34, fontWeight: 900, color: "var(--text)" }}>
          Calculador de portes
        </div>
      </div>
      <div style={{ fontSize: 16, color: "var(--text4)", marginBottom: 28, maxWidth: 1500, marginLeft: "auto", marginRight: "auto", paddingLeft: 60 }}>
        Calcula el coste real del transporte, el consumo estimado y el precio a cobrar con margen real sobre venta.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(430px, .95fr) minmax(430px, 1fr)", gap: 24, maxWidth: 1500, margin: "0 auto", alignItems: "start" }}>
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: 26, boxShadow: "var(--shadow-card)" }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: "var(--accent-xl)", marginBottom: 18, textTransform: "uppercase", letterSpacing: ".06em" }}>
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
                padding: "12px 34px", borderRadius: 8, border: "1px solid var(--accent-border)",
                background: "var(--button-bg)", color: "var(--accent-xl)", fontSize: 15,
                fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                boxShadow: "var(--shadow)",
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
                padding: "10px 16px", borderRadius: 8, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600,
                border: conPeajes ? "1px solid var(--accent-border)" : "1px solid var(--border)",
                background: conPeajes ? "var(--accent-soft)" : "var(--button-bg)",
                color: conPeajes ? "var(--accent-xl)" : "var(--text4)",
                transition: "all .15s",
              }}>
              {conPeajes ? "Con peajes" : "Sin peajes"}
              <span style={{
                display: "inline-block", width: 32, height: 18, borderRadius: 9,
                background: conPeajes ? "var(--accent)" : "var(--border)",
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
                  padding: "9px 16px", borderRadius: 7, border: "1px solid var(--border)",
                  background: margenObjetivo === m ? "linear-gradient(180deg,var(--accent),var(--accent-xl))" : "var(--button-bg)",
                  color: margenObjetivo === m ? "#fff" : "var(--text2)",
                  fontSize: 13, cursor: "pointer", fontWeight: 800,
                  boxShadow: margenObjetivo === m ? "0 10px 18px rgba(0,111,104,.18)" : "none",
                }}>
                {m}%
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16, padding: "14px", borderRadius: 8, border: "1px solid var(--accent-border)", background: "var(--accent-soft)" }}>
            <label style={{ ...lbl, marginTop: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={usarMultiplicadorCorto} onChange={e => setUsarMultiplicadorCorto(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }} />
                <span style={{ fontWeight: 700, color: "var(--accent-xl)", textTransform: "none", letterSpacing: "normal", fontSize: 14 }}>
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
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: 26, marginBottom: 24, boxShadow: "var(--shadow-card)" }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: "var(--accent-xl)", marginBottom: 20, textTransform: "uppercase", letterSpacing: ".06em" }}>
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
                borderBottom: "1px solid var(--border)", fontSize: 15,
              }}>
                <span style={{ color: "var(--text4)" }}>{label}</span>
                <span style={{
                  fontFamily: "'JetBrains Mono',monospace", fontWeight: 600,
                  color: color || "var(--text2)", textAlign: "right",
                }}>{val}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "28px 0 0", fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em" }}>
              <span style={{ color: "var(--accent-xl)" }}>Coste total</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "var(--accent-xl)", fontSize: 28 }}>
                {kmNum > 0 ? fmt(costeBase) + " €" : "—"}
              </span>
            </div>
          </div>

          {puedeCalcular && (
            <div style={{
              background: "var(--bg2)", border: "1px solid var(--accent-border)",
              borderRadius: 12, padding: 26, boxShadow: "var(--shadow-card)",
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
                background: "rgba(16,185,129,.15)", color: "var(--accent-xl)", fontWeight: 700, fontSize: 11,
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
                  padding: "8px 12px", background: "var(--accent-soft)",
                  border: "1px solid var(--accent-border)", borderRadius: 7,
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
                  <div key={i} style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", textAlign: "center" }}>
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
              background: "var(--bg2)", border: "1px solid var(--accent-border)", borderRadius: 12,
              padding: 66, textAlign: "center", color: "var(--text4)", minHeight: 190, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--accent-soft)", border: "1px solid var(--accent-border)", color: "var(--accent-xl)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, marginBottom: 28 }}>▦</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>Introduce los kilómetros para calcular el precio a cobrar.</div>
              <div style={{ fontSize: 15, marginTop: 12 }}>El margen se aplica como margen real sobre venta.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


