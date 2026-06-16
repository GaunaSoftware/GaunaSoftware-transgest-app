const INCIDENTS_KEY = "tms_frontend_incidents";

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function compactStack(value = "") {
  return String(value || "")
    .split("\n")
    .slice(0, 18)
    .join("\n")
    .slice(0, 5000);
}

function readLocalStorage(key, fallback = null) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

export function buildIncidentId(prefix = "TG") {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

export function rememberFrontendIncident(error, info = {}, extra = {}) {
  if (typeof window === "undefined") return null;
  const user = window.__TMS_USER || safeJsonParse(readLocalStorage("tms_user", "null"), null);
  const incident = {
    id: extra.id || buildIncidentId(),
    ts: new Date().toISOString(),
    route: window.location?.pathname || "",
    search: window.location?.search || "",
    user_agent: window.navigator?.userAgent || "",
    message: error?.message || String(error || "Error inesperado"),
    stack: compactStack(error?.stack || ""),
    component_stack: compactStack(info?.componentStack || ""),
    last_api_error: window.__TMS_LAST_API_ERROR || null,
    api_errors: safeJsonParse(readLocalStorage("tms_api_errors", "[]"), []).slice(0, 8),
    user: user ? { id: user.id || null, rol: user.rol || null, email: user.email || user.username || null } : null,
    ...extra,
  };
  window.__TMS_LAST_FRONTEND_INCIDENT = incident;
  const previous = safeJsonParse(readLocalStorage(INCIDENTS_KEY, "[]"), []);
  writeLocalStorage(INCIDENTS_KEY, JSON.stringify([incident, ...(Array.isArray(previous) ? previous : [])].slice(0, 20)));
  return incident;
}

export function getStoredFrontendIncidents() {
  if (typeof window === "undefined") return [];
  return safeJsonParse(readLocalStorage(INCIDENTS_KEY, "[]"), []);
}

export function downloadIncidentReport(incident = null) {
  if (typeof window === "undefined") return;
  const data = incident || window.__TMS_LAST_FRONTEND_INCIDENT || getStoredFrontendIncidents()[0] || null;
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transgest-incidencia-${data.id || "sin-id"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
