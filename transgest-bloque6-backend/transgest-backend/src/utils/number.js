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



// ── Peso: kilos o toneladas en el mismo campo ────────────────────────────
// El campo de peso admite las dos cosas segun lo que escriba el usuario:
//   890  -> son KILOS      (0,89 tn)
//   8,9  -> son TONELADAS  (8.900 kg)
// El corte esta en 45 porque ningun camion transporta mas de ~45 toneladas
// (el maximo legal de un megacamion son 44 t de masa total), asi que cualquier
// cifra por encima solo puede estar en kilos.
// ANTES el corte estaba en 1000 y por eso 890 kg se tomaban como 890 TONELADAS,
// lo que multiplicaba por mil el precio de una tarifa por tonelada.
const MAX_TONELADAS_CAMION = 45;

function toneladasDesdePeso(value) {
  const n = parseLocaleNumber(value, 0);
  if (!(n > 0)) return 0;
  const toneladas = n <= MAX_TONELADAS_CAMION ? n : n / 1000;
  return Number(toneladas.toFixed(3));
}

function kilosDesdePeso(value) {
  const n = parseLocaleNumber(value, 0);
  if (!(n > 0)) return 0;
  return n <= MAX_TONELADAS_CAMION ? n * 1000 : n;
}

module.exports = {
  MAX_TONELADAS_CAMION,
  toneladasDesdePeso,
  kilosDesdePeso,
  parseLocaleNumber,
};
