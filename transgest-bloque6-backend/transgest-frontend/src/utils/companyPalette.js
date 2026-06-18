export const COMPANY_PALETTES = [
  { id:"transgest", label:"TransGest", accent:"#0f766e", accentLight:"#14b8a6", sidebar:"#10231f" },
  { id:"mar", label:"Mar", accent:"#0e7490", accentLight:"#06b6d4", sidebar:"#0f2530" },
  { id:"bosque", label:"Bosque", accent:"#15803d", accentLight:"#22c55e", sidebar:"#10251a" },
  { id:"ambar", label:"Ambar", accent:"#b45309", accentLight:"#f59e0b", sidebar:"#2b2112" },
  { id:"grafito", label:"Grafito", accent:"#475569", accentLight:"#94a3b8", sidebar:"#111827" },
];

export function canUseCompanyPalette(plan) {
  const normalized = String(plan || "").toLowerCase();
  return normalized === "profesional" || normalized === "enterprise" || normalized === "premium";
}

export function normalizePaletteConfig(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const preset = COMPANY_PALETTES.find(p => p.id === raw.id) || COMPANY_PALETTES[0];
  const custom = raw.custom && typeof raw.custom === "object" ? raw.custom : {};
  return {
    id: preset.id,
    accent: validHex(custom.accent) || preset.accent,
    accentLight: validHex(custom.accentLight) || preset.accentLight,
    sidebar: validHex(custom.sidebar) || preset.sidebar,
  };
}

export function loadCompanyPalette() {
  try {
    const local = JSON.parse(localStorage.getItem("tms_company_palette") || "null");
    if (local) return normalizePaletteConfig(local);
  } catch {}
  return normalizePaletteConfig();
}

export function saveCompanyPalette(value) {
  const normalized = normalizePaletteConfig(value);
  try { localStorage.setItem("tms_company_palette", JSON.stringify(normalized)); } catch {}
  if (typeof window !== "undefined") {
    window.__TMS_COMPANY_PALETTE = normalized;
    window.dispatchEvent(new CustomEvent("tms:company-palette-changed", { detail: normalized }));
  }
  return normalized;
}

export function applyCompanyPalette(value) {
  const palette = normalizePaletteConfig(value);
  const root = document.documentElement;
  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--accent-l", palette.accentLight);
  root.style.setProperty("--accent-xl", palette.accentLight);
  root.style.setProperty("--accent-dim", hexToRgba(palette.accentLight, 0.14));
  root.style.setProperty("--sidebar-bg", palette.sidebar);
  root.style.setProperty("--topbar-active", hexToRgba(palette.accentLight, 0.12));
  return palette;
}

function validHex(value) {
  const raw = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : "";
}

function hexToRgba(hex, alpha) {
  const clean = validHex(hex).slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
