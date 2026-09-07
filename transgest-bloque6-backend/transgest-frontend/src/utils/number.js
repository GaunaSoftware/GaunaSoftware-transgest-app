// Parseo de números en formato español/europeo desde inputs de texto.
// Acepta coma o punto como separador decimal y punto como separador de miles.
//   "1.234,56" -> 1234.56    "1234,5" -> 1234.5    "1.234.567" -> 1234567
//   Un solo punto se interpreta como decimal ("1.500" -> 1.5).
//
// IMPORTANTE: esta lógica está espejada en el backend
// (transgest-backend/src/utils/number.js). Cliente y servidor deben parsear igual
// (el backend recalcula importes), así que si cambias las reglas aquí, cámbialas
// también allí. No se puede compartir un único módulo: son bundles distintos
// (CRA no permite importar fuera de src/).
export function parseLocaleNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  let raw = String(value).trim().replace(/\s+/g, "");
  if (!raw) return fallback;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    raw = raw.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3}){2,}$/.test(raw)) {
    raw = raw.replace(/\./g, "");
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ── Peso: kilos o toneladas en el mismo campo ────────────────────────────
// El campo de peso admite las dos cosas segun lo que escriba el usuario:
//   890  -> son KILOS      (0,89 tn)
//   8,9  -> son TONELADAS  (8.900 kg)
// El corte esta en 45 porque ningun camion transporta mas de ~45 toneladas
// (el maximo legal de un megacamion son 44 t de masa total), asi que cualquier
// cifra por encima solo puede estar en kilos.
// ANTES el corte estaba en 1000 y por eso 890 kg se tomaban como 890 TONELADAS,
// lo que multiplicaba por mil el precio de una tarifa por tonelada.
export const MAX_TONELADAS_CAMION = 45;

export function toneladasDesdePeso(value) {
  const n = parseLocaleNumber(value, 0);
  if (!(n > 0)) return 0;
  const toneladas = n <= MAX_TONELADAS_CAMION ? n : n / 1000;
  return Number(toneladas.toFixed(3));
}

export function kilosDesdePeso(value) {
  const n = parseLocaleNumber(value, 0);
  if (!(n > 0)) return 0;
  return n <= MAX_TONELADAS_CAMION ? n * 1000 : n;
}
