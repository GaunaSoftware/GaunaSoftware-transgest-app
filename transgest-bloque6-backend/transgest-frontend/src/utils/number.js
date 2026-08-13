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
