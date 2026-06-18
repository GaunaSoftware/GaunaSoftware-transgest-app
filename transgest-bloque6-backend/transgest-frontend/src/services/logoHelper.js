// ── Logo helper — prioriza cache viva de ventana y usa localStorage solo como rescate ──
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
