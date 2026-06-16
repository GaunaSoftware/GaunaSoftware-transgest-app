// ── Logo helper — prioriza cache viva de ventana y usa localStorage solo como rescate ──
export function getLogoBase64() {
  try {
    if (typeof window !== "undefined" && window.__TMS_LOGO_CACHE && typeof window.__TMS_LOGO_CACHE === "object") {
      return {
        b64: window.__TMS_LOGO_CACHE.b64 || null,
        mime: window.__TMS_LOGO_CACHE.mime || "image/png",
      };
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
