export const COMPANY_PALETTES = [
  { id:"transgest", label:"TransGest", accent:"#0f766e", accentLight:"#14b8a6", sidebar:"#10231f" },
  { id:"mar", label:"Mar", accent:"#0e7490", accentLight:"#06b6d4", sidebar:"#0f2530" },
  { id:"bosque", label:"Bosque", accent:"#15803d", accentLight:"#22c55e", sidebar:"#10251a" },
  { id:"ambar", label:"Ambar", accent:"#b45309", accentLight:"#f59e0b", sidebar:"#2b2112" },
  { id:"grafito", label:"Grafito", accent:"#475569", accentLight:"#94a3b8", sidebar:"#111827" },
  { id:"custom", label:"Personalizada", accent:"#0f766e", accentLight:"#14b8a6", sidebar:"#10231f" },
];

export function canUseCompanyPalette(plan) {
  const normalized = String(plan || "").toLowerCase();
  return normalized === "profesional" || normalized === "enterprise" || normalized === "premium";
}

export function normalizePaletteConfig(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const requestedId = String(raw.id || "");
  const preset = COMPANY_PALETTES.find(p => p.id === requestedId && p.id !== "custom") || COMPANY_PALETTES[0];
  const custom = raw.custom && typeof raw.custom === "object" ? raw.custom : {};
  const accent = validHex(raw.accent) || validHex(custom.accent) || preset.accent;
  const accentLight = validHex(raw.accentLight) || validHex(custom.accentLight) || preset.accentLight;
  const sidebar = validHex(raw.sidebar) || validHex(custom.sidebar) || preset.sidebar;
  const matchesPreset = COMPANY_PALETTES.find(p => (
    p.id !== "custom"
    && p.accent.toLowerCase() === accent.toLowerCase()
    && p.accentLight.toLowerCase() === accentLight.toLowerCase()
    && p.sidebar.toLowerCase() === sidebar.toLowerCase()
  ));
  const id = requestedId === "custom" || !matchesPreset ? "custom" : matchesPreset.id;
  return {
    id,
    accent,
    accentLight,
    sidebar,
    custom: { accent, accentLight, sidebar },
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
  const theme = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const tokens = theme === "dark" ? DARK_THEME_TOKENS : LIGHT_THEME_TOKENS;

  Object.entries(tokens).forEach(([key, val]) => root.style.setProperty(key, val));
  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--accent-l", palette.accentLight);
  root.style.setProperty("--accent-xl", theme === "dark" ? palette.accentLight : palette.accent);
  root.style.setProperty("--primary", palette.accent);
  root.style.setProperty("--primary-hover", palette.accentLight);
  root.style.setProperty("--brand", palette.accent);
  root.style.setProperty("--brand-2", palette.accentLight);
  root.style.setProperty("--link", theme === "dark" ? palette.accentLight : palette.accent);
  root.style.setProperty("--focus", hexToRgba(palette.accentLight, 0.42));
  root.style.setProperty("--accent-dim", hexToRgba(palette.accentLight, 0.14));
  root.style.setProperty("--accent-soft", hexToRgba(palette.accentLight, 0.10));
  root.style.setProperty("--accent-border", hexToRgba(palette.accentLight, 0.26));
  root.style.setProperty("--sidebar-bg", palette.sidebar);
  root.style.setProperty("--sidebar-active", hexToRgba(palette.accentLight, 0.18));
  root.style.setProperty("--topbar-active", hexToRgba(palette.accentLight, 0.12));
  root.style.colorScheme = theme;
  if (document.body) {
    document.body.style.background = "var(--bg)";
    document.body.style.color = "var(--text)";
  }
  return palette;
}

const LIGHT_THEME_TOKENS = {
  "--bg": "#f5f7f7",
  "--bg2": "#ffffff",
  "--bg3": "#f7faf9",
  "--bg4": "#edf4f2",
  "--bg5": "#e3eeeb",
  "--surface": "#ffffff",
  "--surface-2": "#f7faf9",
  "--muted-bg": "#edf4f2",
  "--table-head-bg": "#f7faf9",
  "--input-bg": "#f7faf9",
  "--button-bg": "#ffffff",
  "--button-text": "#15201d",
  "--topbar-bg": "rgba(255,255,255,.94)",
  "--card-bg": "#ffffff",
  "--border": "#d9e4e1",
  "--border2": "#c4d4cf",
  "--border3": "#aebfba",
  "--text": "#15201d",
  "--text2": "#2f4740",
  "--text3": "#526a62",
  "--text4": "#718980",
  "--text5": "#93a7a0",
  "--green": "#059669",
  "--green-dim": "rgba(5,150,105,.12)",
  "--orange": "#ea580c",
  "--red": "#dc2626",
  "--yellow": "#d97706",
  "--purple": "#7c3aed",
  "--row-hover": "#edf7f4",
  "--shadow": "0 12px 30px rgba(19,32,29,.09)",
  "--shadow-card": "0 16px 42px rgba(19,32,29,.08)",
  "--overlay-bg": "rgba(15,23,42,.52)",
};

const DARK_THEME_TOKENS = {
  "--bg": "#071411",
  "--bg2": "#0d1b18",
  "--bg3": "#10231f",
  "--bg4": "#162c27",
  "--bg5": "#1d3832",
  "--surface": "#0d1b18",
  "--surface-2": "#10231f",
  "--muted-bg": "#162c27",
  "--table-head-bg": "#10231f",
  "--input-bg": "#0a1714",
  "--button-bg": "#10231f",
  "--button-text": "#f4faf7",
  "--topbar-bg": "rgba(8,19,16,.94)",
  "--card-bg": "#0d1b18",
  "--border": "rgba(148,163,184,.18)",
  "--border2": "rgba(148,163,184,.26)",
  "--border3": "rgba(148,163,184,.38)",
  "--text": "#f4faf7",
  "--text2": "#d5e4df",
  "--text3": "#b8cbc4",
  "--text4": "#8fa59d",
  "--text5": "#718b82",
  "--green": "#34d399",
  "--green-dim": "rgba(52,211,153,.14)",
  "--orange": "#fb923c",
  "--red": "#f87171",
  "--yellow": "#fbbf24",
  "--purple": "#c4b5fd",
  "--row-hover": "rgba(20,184,166,.08)",
  "--shadow": "0 18px 52px rgba(0,0,0,.34)",
  "--shadow-card": "0 18px 48px rgba(0,0,0,.28)",
  "--overlay-bg": "rgba(0,0,0,.72)",
};

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
