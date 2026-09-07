// ── Logo helper — prioriza cache viva de ventana y usa localStorage solo como rescate ──
import { getLogo } from "./api";

// Carga el logo de la empresa una sola vez y lo deja en window.__TMS_LOGO_CACHE,
// para que cualquier impresion (orden de carga, factura, nomina...) lo tenga sin
// necesidad de haber pasado antes por "Mi Empresa". Guardada: solo hace la
// peticion una vez; si falla la red, permite reintento.
let logoLoadPromise = null;
export function ensureLogoCargado() {
  if (typeof window !== "undefined" && window.__TMS_LOGO_CACHE && window.__TMS_LOGO_CACHE.b64) {
    return Promise.resolve(window.__TMS_LOGO_CACHE);
  }
  if (logoLoadPromise) return logoLoadPromise;
  logoLoadPromise = getLogo()
    .then((d) => {
      const cache = { b64: d?.logo_base64 || null, mime: d?.logo_mime || "image/png" };
      if (typeof window !== "undefined") window.__TMS_LOGO_CACHE = cache;
      return cache;
    })
    .catch(() => {
      logoLoadPromise = null; // permite reintentar si fue un fallo de red
      return { b64: null, mime: "image/png" };
    });
  return logoLoadPromise;
}

export function getLogoBase64() {
  try {
    if (typeof window !== "undefined" && window.__TMS_LOGO_CACHE && typeof window.__TMS_LOGO_CACHE === "object") {
      return {
        b64: window.__TMS_LOGO_CACHE.b64 || null,
        mime: window.__TMS_LOGO_CACHE.mime || "image/png",
      };
    }
    const readJson = (key) => {
      try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
    };
    const user = readJson("tms_user") || {};
    const empresa = readJson("tms_empresa") || {};
    const userLogo = user.logo_base64 || user.logo_b64 || user.logo_url || user.empresa_logo_base64 || user.empresa_logo_url || user.empresa?.logo_base64 || user.empresa?.logo_url || "";
    const empresaLogo = empresa.logo_base64 || empresa.logo_b64 || empresa.logo_url || "";
    const fromProfile = userLogo || empresaLogo;
    if (fromProfile) {
      const mime = user.logo_mime || user.empresa_logo_mime || user.empresa?.logo_mime || empresa.logo_mime || "image/png";
      const cachedProfile = { b64: String(fromProfile).replace(/^data:[^;]+;base64,/, ""), mime };
      if (typeof window !== "undefined") window.__TMS_LOGO_CACHE = cachedProfile;
      return cachedProfile;
    }
    const cached = {
      b64:  localStorage.getItem("tms_logo_b64")  || null,
      mime: localStorage.getItem("tms_logo_mime") || "image/png",
    };
    if (typeof window !== "undefined") window.__TMS_LOGO_CACHE = cached;
    return cached;
  } catch { return {b64:null, mime:"image/png"}; }
}

export function getLogoImgTag(style="max-height:48px;max-width:160px;object-fit:contain;") {
  const {b64, mime} = getLogoBase64();
  if (!b64) return "";
  return `<img src="data:${mime};base64,${b64}" style="${style}" alt="Logo empresa"/>`;
}

export function getLogoDataUrl() {
  const {b64, mime} = getLogoBase64();
  if (!b64) return null;
  return `data:${mime};base64,${b64}`;
}
