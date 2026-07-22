// ══════════════════════════════════════════════════════
// CONFIG DE SERVIDOR — resuelve a que backend apunta la app
// ══════════════════════════════════════════════════════
//
// Orden de prioridad:
//   1. URL guardada por el usuario (localStorage "transgest_api_url")
//      -> permite apuntar a un backend LOCAL / on-premise sin recompilar.
//   2. URL fijada en tiempo de build (REACT_APP_API_URL).
//   3. Backend de produccion en la nube (por defecto).
//
// Sirve igual para la web (navegador) y para el ejecutable de escritorio
// (Electron): el .exe es la misma web empaquetada, solo cambia el "envoltorio".

export const DEFAULT_API_URL =
  process.env.REACT_APP_API_URL || "https://transgest-backend.onrender.com";

const STORAGE_KEY = "transgest_api_url";

function readOverride() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return "";
    const v = window.localStorage.getItem(STORAGE_KEY);
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

function normalizeUrl(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  // Aceptar "localhost:3000" o "192.168.1.20:3000" sin protocolo.
  if (!/^https?:\/\//i.test(v)) v = "http://" + v;
  return v.replace(/\/+$/, ""); // sin barra final
}

// URL efectiva del backend (llamar en tiempo de carga de cada modulo).
export function resolveApiBase() {
  const override = readOverride();
  if (override) return normalizeUrl(override);
  return DEFAULT_API_URL.replace(/\/+$/, "");
}

// URL configurada por el usuario ("" = usando la de por defecto).
export function getConfiguredServer() {
  return readOverride();
}

// True si estamos corriendo dentro del ejecutable de escritorio (Electron).
export function isDesktopApp() {
  try {
    return (
      typeof window !== "undefined" &&
      (Boolean(window.transgestDesktop) ||
        /Electron/i.test(window.navigator?.userAgent || ""))
    );
  } catch {
    return false;
  }
}

// Guarda una URL de servidor. Devuelve la URL normalizada guardada.
export function setConfiguredServer(raw) {
  const normalized = normalizeUrl(raw);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (normalized) window.localStorage.setItem(STORAGE_KEY, normalized);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* noop */
  }
  return normalized;
}

// Vuelve al servidor por defecto (nube).
export function clearConfiguredServer() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* noop */
  }
}
