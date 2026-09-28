import { parseLocaleNumber } from "../../utils/number";

const numeric = value => {
  const parsed = parseLocaleNumber(value, NaN);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function tariffDraftValues(draft = {}) {
  const tipo = String(draft.tipo_precio || "viaje");
  const recargo = numeric(draft.recargo_combustible_pct);
  const precioUnitario = numeric(draft.precio_unitario);
  const factor = 1 + recargo / 100;
  const baseGuardada = parseLocaleNumber(draft.precio_base_sin_combustible, NaN);
  const baseCoherente = Number.isFinite(baseGuardada)
    && Math.abs(baseGuardada * factor - precioUnitario) < 0.011;
  const precioBase = baseCoherente ? baseGuardada : factor > 0 ? precioUnitario / factor : precioUnitario;
  return {
    tipo,
    precioBase: Number(precioBase.toFixed(4)),
    recargo,
    minimo: tipo === "viaje" ? numeric(draft.importe_minimo) : numeric(draft.minimo_unidades),
  };
}

export function tariffChanges(ruta = {}, draft = {}, minimoRuta = null) {
  const actual = {
    tipo: String(ruta.tarifa_tipo || "viaje"),
    precioBase: numeric(ruta.precio_base ?? ruta.precio),
    recargo: numeric(ruta.recargo_combustible_pct),
    minimo: minimoRuta === null ? numeric(ruta.tarifa_tipo === "viaje" ? ruta.minimo_facturable : ruta.minimo_unidades) : numeric(minimoRuta),
  };
  const propuesto = tariffDraftValues(draft);
  const cambios = [];
  if (actual.tipo !== propuesto.tipo) cambios.push({ campo: "Tipo", antes: actual.tipo, despues: propuesto.tipo });
  if (Math.abs(actual.precioBase - propuesto.precioBase) >= 0.0001) cambios.push({ campo: "Precio base (€)", antes: actual.precioBase, despues: propuesto.precioBase });
  if (Math.abs(actual.recargo - propuesto.recargo) >= 0.0001) cambios.push({ campo: "Recargo gasoil (%)", antes: actual.recargo, despues: propuesto.recargo });
  if (Math.abs(actual.minimo - propuesto.minimo) >= 0.001) cambios.push({ campo: "Mínimo", antes: actual.minimo, despues: propuesto.minimo });
  return cambios;
}
