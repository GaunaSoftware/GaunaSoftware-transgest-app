const runtimeFocusState = {};

function parseLegacyValue(raw, mode) {
  if (raw == null) return null;
  if (mode === "raw") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readRuntimeFocus(key, options = {}) {
  const { mode = "json" } = options;
  if (Object.prototype.hasOwnProperty.call(runtimeFocusState, key)) {
    return runtimeFocusState[key];
  }
  let legacyValue = null;
  try {
    legacyValue = parseLegacyValue(sessionStorage.getItem(key), mode);
    sessionStorage.removeItem(key);
  } catch {}
  runtimeFocusState[key] = legacyValue;
  return legacyValue;
}

export function setRuntimeFocus(key, value) {
  runtimeFocusState[key] = value ?? null;
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

export function clearRuntimeFocus(key) {
  delete runtimeFocusState[key];
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
