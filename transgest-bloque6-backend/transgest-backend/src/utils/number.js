// Parseo de números en formato español/europeo desde inputs de texto.
// Acepta coma o punto como separador decimal y punto como separador de miles.
//   "1.234,56" -> 1234.56    "1234,5" -> 1234.5    "1.234.567" -> 1234567
//   Un solo punto se interpreta como decimal ("1.500" -> 1.5).
// Devuelve null si el valor está vacío o no es numérico.
//
// IMPORTANTE: esta lógica está espejada en el frontend
// (transgest-frontend/src/utils/number.js). Cliente y servidor deben parsear
// igual, así que si cambias las reglas aquí, cámbialas también allí. No se puede
// compartir un único módulo: son bundles distintos (CRA no permite importar
// fuera de src/).
function parseLocaleNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value).trim().replace(/\s+/g, "");
  if (!raw) return null;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (hasComma) raw = raw.replace(",", ".");
  else if (hasDot && /^\d{1,3}(\.\d{3}){2,}$/.test(raw)) raw = raw.replace(/\./g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

module.exports = { parseLocaleNumber };
