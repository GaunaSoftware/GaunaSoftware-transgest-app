import { parseLocaleNumber } from "../../utils/number";

const CUSTOMER_FIELDS = {
  cliente_id: "",
  cliente_nombre: "",
  ruta_id: "",
  referencia_cliente: "",
  tipo_precio: "viaje",
  precio_unitario: "",
  precio_base_sin_combustible: "",
  recargo_combustible_pct: "",
  importe_revision_combustible: "",
  importe_minimo: "",
  minimo_unidades: "",
  precio_cliente_col: "",
  importe: "",
  ventana_carga: "",
  ventana_descarga: "",
  tipo_iva: "",
  iva_regimen: "",
};

const HAS_DEPENDENT_VALUE = [
  "ruta_id", "referencia_cliente", "precio_unitario", "precio_base_sin_combustible",
  "recargo_combustible_pct", "importe_revision_combustible", "importe_minimo",
  "minimo_unidades", "precio_cliente_col", "importe", "ventana_carga", "ventana_descarga",
];

export function hasCustomerDependentValues(draft = {}) {
  return HAS_DEPENDENT_VALUE.some(key => draft[key] !== undefined && draft[key] !== null && String(draft[key]).trim() !== "" && String(draft[key]) !== "0");
}

export function clearCustomerTariffDraft(draft = {}) {
  return { ...draft, ...CUSTOMER_FIELDS };
}

export function switchCustomerDraft(draft = {}, customer = null) {
  const cleared = clearCustomerTariffDraft(draft);
  if (!customer) return cleared;
  return {
    ...cleared,
    cliente_id: customer.id,
    cliente_nombre: customer.nombre || "",
    tipo_iva: customer.tipo_iva ?? "",
    iva_regimen: customer.iva_regimen || "",
    ventana_carga: customer.horario_carga || "",
    ventana_descarga: customer.horario_descarga || "",
    mercancia: draft.mercancia || customer.mercancia_habitual || "",
  };
}

export function routesForCustomer(routes = [], customerId = null) {
  if (!customerId) return [];
  return (Array.isArray(routes) ? routes : []).filter(route =>
    route?.cliente_id && String(route.cliente_id) === String(customerId)
  );
}

export function recoverExistingTripPrice(draft = {}, additionalStops = 0) {
  if (!draft.id || (draft.tipo_precio || 'viaje') !== 'viaje' ||
      (draft.precio_unitario !== null && draft.precio_unitario !== undefined && draft.precio_unitario !== '')) return null;
  const total = parseLocaleNumber(draft.importe, NaN);
  const extras = parseLocaleNumber(draft.extracostes ?? draft.extracostes_importe, 0);
  const price = total - extras - additionalStops;
  return Number.isFinite(price) && price >= 0 ? Number(price.toFixed(2)) : null;
}
