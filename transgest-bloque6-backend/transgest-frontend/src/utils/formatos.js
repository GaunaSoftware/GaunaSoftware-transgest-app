// ══════════════════════════════════════════════════════
// FORMATOS AUTOMATICOS — matriculas, DNI/NIE, mayusculas
// ══════════════════════════════════════════════════════
// Formatean mientras se escribe: ponen el guion y pasan a MAYUSCULAS.

// Matricula espanola. Detecta:
//   - Remolque:  R + 4 digitos + 3 letras     -> R-4348-BDC
//   - Moderna:   4 digitos + 3 letras          -> 4857-MBR
//   - Antigua:   1-2 letras + 4 digitos + 1-2 letras -> M-1234-AB
export function formatMatricula(raw) {
  const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  // Remolque (empieza por R seguido de numero)
  if (s[0] === "R" && /[0-9]/.test(s[1] || "")) {
    const m = s.slice(1).match(/^(\d{0,4})([A-Z]{0,3})/);
    const d = m[1];
    const l = m[2];
    return "R" + (d ? "-" + d : "") + (l ? "-" + l : "");
  }
  // Moderna (empieza por digito)
  if (/^[0-9]/.test(s)) {
    const m = s.match(/^(\d{0,4})([A-Z]{0,3})/);
    return m[1] + (m[2] ? "-" + m[2] : "");
  }
  // Antigua provincial (empieza por letra)
  const m = s.match(/^([A-Z]{1,2})(\d{0,4})([A-Z]{0,2})/);
  if (m) return m[1] + (m[2] ? "-" + m[2] : "") + (m[3] ? "-" + m[3] : "");
  return s;
}

// DNI (8 digitos + letra) o NIE (X/Y/Z + 7 digitos + letra).
//   48788257J -> 48788257-J     X1234567L -> X-1234567-L
export function formatDni(raw) {
  const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  if (/^[XYZ]/.test(s)) {
    const rest = s.slice(1);
    const d = rest.replace(/[^0-9]/g, "").slice(0, 7);
    const l = rest.slice(d.length).replace(/[^A-Z]/g, "").slice(0, 1);
    return s[0] + (d ? "-" + d : "") + (l ? "-" + l : "");
  }
  const d = s.replace(/[^0-9]/g, "").slice(0, 8);
  const l = s.slice(d.length).replace(/[^A-Z]/g, "").slice(0, 1);
  return d + (l ? "-" + l : "");
}

// Mayusculas simples (para campos de texto operativo).
export function upper(raw) {
  return String(raw || "").toUpperCase();
}

// Campos que NO se deben pasar a mayusculas (se romperian): email, contrasena,
// URLs / enlaces de Maps, tokens, IBAN/BIC, dominios, etc.
const KEEP_CASE_KEY = /(email|correo|e_mail|url|http|link|enlace|maps|web|dominio|domain|slug|password|contrasena|clave|pass|token|secret|api_key|apikey|iban|bic|swift|nota|observ|coment|mensaje|descripcion_larga|_id$|^id$|uuid)/i;

export function shouldKeepCase(key = "") {
  return KEEP_CASE_KEY.test(String(key || ""));
}

// Tipos de input que NO se mayusculizan (se romperian o no procede).
const KEEP_CASE_INPUT_TYPES = ["email", "password", "url", "number", "date", "time", "datetime-local", "month", "week", "tel", "color", "range", "file", "checkbox", "radio"];

// Mayusculas por defecto a partir del EVENTO de cambio: solo para inputs/textarea
// de texto, respetando exclusiones por clave y por tipo. Salta <select> (enums)
// y campos como email/URL/UUID. Los numeros/fechas quedan igual.
export function upperFromEvent(key, e) {
  const el = e && e.target;
  const value = el ? el.value : "";
  if (typeof value !== "string") return value;
  const tag = String(el?.tagName || "").toUpperCase();
  if (tag === "SELECT") return value; // enums / valores fijos
  const type = String(el?.type || "text").toLowerCase();
  if (KEEP_CASE_INPUT_TYPES.includes(type)) return value;
  if (shouldKeepCase(key)) return value;
  return value.toUpperCase();
}

// Version por valor (cuando no hay evento). Respeta exclusiones por clave.
export function upperValueForKey(key, value) {
  if (typeof value !== "string") return value;
  if (shouldKeepCase(key)) return value;
  return value.toUpperCase();
}
