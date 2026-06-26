const CCAA = [
  { code: "ES-AN", label: "Andalucia" },
  { code: "ES-AR", label: "Aragon" },
  { code: "ES-AS", label: "Asturias" },
  { code: "ES-CN", label: "Canarias" },
  { code: "ES-CB", label: "Cantabria" },
  { code: "ES-CM", label: "Castilla-La Mancha" },
  { code: "ES-CL", label: "Castilla y Leon" },
  { code: "ES-CT", label: "Cataluna" },
  { code: "ES-EX", label: "Extremadura" },
  { code: "ES-GA", label: "Galicia" },
  { code: "ES-IB", label: "Illes Balears" },
  { code: "ES-RI", label: "La Rioja" },
  { code: "ES-MD", label: "Comunidad de Madrid" },
  { code: "ES-MC", label: "Region de Murcia" },
  { code: "ES-NC", label: "Navarra" },
  { code: "ES-PV", label: "Pais Vasco" },
  { code: "ES-VC", label: "Comunitat Valenciana" },
  { code: "ES-CE", label: "Ceuta" },
  { code: "ES-ML", label: "Melilla" },
];

const CCAA_BY_CODE = new Map(CCAA.map(c => [c.code, c]));
const CCAA_BY_LABEL = new Map(CCAA.map(c => [foldText(c.label), c.code]));

const CCAA_TEXT_HINTS = [
  ["ES-AN", ["andalucia", "almeria", "cadiz", "cordoba", "granada", "huelva", "jaen", "malaga", "sevilla"]],
  ["ES-AR", ["aragon", "huesca", "teruel", "zaragoza"]],
  ["ES-AS", ["asturias", "oviedo", "gijon", "aviles"]],
  ["ES-CN", ["canarias", "las palmas", "tenerife", "fuerteventura", "lanzarote", "gran canaria"]],
  ["ES-CB", ["cantabria", "santander", "torrelavega"]],
  ["ES-CM", ["castilla la mancha", "albacete", "ciudad real", "cuenca", "guadalajara", "toledo"]],
  ["ES-CL", ["castilla y leon", "avila", "burgos", "leon", "palencia", "salamanca", "segovia", "soria", "valladolid", "zamora"]],
  ["ES-CT", ["cataluna", "catalunya", "barcelona", "girona", "gerona", "lleida", "lerida", "tarragona"]],
  ["ES-EX", ["extremadura", "badajoz", "caceres"]],
  ["ES-GA", ["galicia", "coruna", "a coruna", "lugo", "ourense", "orense", "pontevedra", "vigo", "santiago"]],
  ["ES-IB", ["illes balears", "islas baleares", "mallorca", "menorca", "ibiza", "eivissa", "palma"]],
  ["ES-RI", ["la rioja", "logrono"]],
  ["ES-MD", ["madrid", "alcala de henares", "getafe", "leganes"]],
  ["ES-MC", ["murcia", "cartagena", "lorca"]],
  ["ES-NC", ["navarra", "pamplona", "iruna", "tudela"]],
  ["ES-PV", ["pais vasco", "euskadi", "bizkaia", "vizcaya", "bilbao", "gipuzkoa", "guipuzcoa", "donostia", "san sebastian", "araba", "alava", "vitoria"]],
  ["ES-VC", ["comunitat valenciana", "comunidad valenciana", "valencia", "castellon", "alicante", "alacant"]],
  ["ES-CE", ["ceuta"]],
  ["ES-ML", ["melilla"]],
];

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeYear(value) {
  const current = new Date().getFullYear();
  const year = Number(value || current);
  if (!Number.isInteger(year) || year < 2020 || year > current + 3) return current;
  return year;
}

function normalizeCcaa(value) {
  const code = String(value || "ES-AN").trim().toUpperCase();
  return CCAA_BY_CODE.has(code) ? code : "ES-AN";
}

function inferCcaaFromText(value) {
  const text = foldText(value);
  if (!text) return null;
  if (CCAA_BY_CODE.has(String(value || "").trim().toUpperCase())) return String(value).trim().toUpperCase();
  if (CCAA_BY_LABEL.has(text)) return CCAA_BY_LABEL.get(text);
  for (const [code, hints] of CCAA_TEXT_HINTS) {
    if (hints.some(hint => text.includes(hint))) return code;
  }
  return null;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function fallbackSpanishHolidays(year) {
  const easter = easterSunday(year);
  return [
    ["01-01", "Ano Nuevo"],
    ["01-06", "Epifania del Senor"],
    [isoDate(addDays(easter, -2)).slice(5), "Viernes Santo"],
    ["05-01", "Fiesta del Trabajo"],
    ["08-15", "Asuncion de la Virgen"],
    ["10-12", "Fiesta Nacional de Espana"],
    ["11-01", "Todos los Santos"],
    ["12-06", "Dia de la Constitucion Espanola"],
    ["12-08", "Inmaculada Concepcion"],
    ["12-25", "Natividad del Senor"],
  ].map(([md, name]) => ({
    date: `${year}-${md}`,
    localName: name,
    name,
    global: true,
    counties: null,
    scope: "nacional",
  }));
}

function normalizeHoliday(row, ccaa) {
  const counties = Array.isArray(row.counties) ? row.counties : null;
  const scope = row.global ? "nacional" : counties?.includes(ccaa) ? "autonomico" : "local";
  return {
    date: row.date,
    localName: row.localName || row.name || "",
    name: row.name || row.localName || "",
    global: !!row.global,
    counties,
    scope,
    types: Array.isArray(row.types) ? row.types : [],
  };
}

async function fetchSpainHolidays(year, ccaa) {
  if (typeof fetch !== "function") {
    return {
      fuente: "fallback",
      warnings: ["La version de Node no tiene fetch disponible; se usa calendario nacional basico."],
      holidays: fallbackSpanishHolidays(year),
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.HOLIDAY_API_TIMEOUT_MS || 8000));
  let response;
  try {
    response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/ES`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Public holiday API ${response.status}`);
  const data = await response.json();
  const holidays = (Array.isArray(data) ? data : [])
    .filter(h => h?.global || !Array.isArray(h?.counties) || h.counties.includes(ccaa))
    .map(h => normalizeHoliday(h, ccaa))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    fuente: "Nager.Date",
    warnings: [],
    holidays,
  };
}

function buildCalendarResponse({ year, ccaa, holidays, fuente, updatedAt, cache, warnings = [] }) {
  const ccaaMeta = CCAA_BY_CODE.get(ccaa) || CCAA_BY_CODE.get("ES-AN");
  return {
    year,
    ccaa,
    ccaa_label: ccaaMeta.label,
    fuente,
    updated_at: updatedAt || new Date().toISOString(),
    cache: !!cache,
    warnings,
    holidays: (holidays || []).sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
}

async function getEmpresaCalendarForDate(db, empresaId, year, ccaa, options = {}) {
  const normalizedYear = normalizeYear(year);
  const { rows } = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1", [empresaId]);
  const cfg = rows[0]?.cfg_precios && typeof rows[0].cfg_precios === "object" ? rows[0].cfg_precios : {};
  const normalizedCcaa = normalizeCcaa(ccaa || cfg.calendario_laboral_ccaa || cfg.calendario_laboral_default_ccaa);
  const key = `${normalizedYear}_${normalizedCcaa}`;
  const compatKey = `${normalizedYear}:${normalizedCcaa}`;
  const cache = cfg.calendario_laboral_cache && typeof cfg.calendario_laboral_cache === "object" ? cfg.calendario_laboral_cache : {};
  const cached = cache[key] || cache[compatKey];
  const updatedAtMs = cached?.updated_at ? new Date(cached.updated_at).getTime() : 0;
  const fresh = updatedAtMs && (Date.now() - updatedAtMs) < 1000 * 60 * 60 * 24 * 30;
  if (!options.force && cached?.holidays && fresh) {
    return buildCalendarResponse({
      year: normalizedYear,
      ccaa: normalizedCcaa,
      holidays: cached.holidays,
      fuente: cached.fuente || "cache",
      updatedAt: cached.updated_at,
      cache: true,
      warnings: cached.warnings || [],
    });
  }

  let fetched;
  try {
    fetched = await fetchSpainHolidays(normalizedYear, normalizedCcaa);
  } catch (e) {
    fetched = {
      fuente: "fallback",
      warnings: [`No se pudo refrescar calendario externo: ${e.message}`],
      holidays: fallbackSpanishHolidays(normalizedYear),
    };
  }
  const next = buildCalendarResponse({
    year: normalizedYear,
    ccaa: normalizedCcaa,
    holidays: fetched.holidays,
    fuente: fetched.fuente,
    warnings: fetched.warnings,
    cache: false,
  });
  await db.query(
    `UPDATE empresas
        SET cfg_precios = COALESCE(cfg_precios,'{}'::jsonb) || $1::jsonb
      WHERE id=$2`,
    [JSON.stringify({
      calendario_laboral_cache: {
        ...cache,
        [key]: {
          holidays: next.holidays,
          fuente: next.fuente,
          warnings: next.warnings,
          updated_at: next.updated_at,
        },
        [compatKey]: {
          holidays: next.holidays,
          fuente: next.fuente,
          warnings: next.warnings,
          updated_at: next.updated_at,
        },
      },
    }), empresaId]
  ).catch(() => {});
  return next;
}

module.exports = {
  CCAA,
  buildCalendarResponse,
  fallbackSpanishHolidays,
  fetchSpainHolidays,
  getEmpresaCalendarForDate,
  inferCcaaFromText,
  normalizeCcaa,
  normalizeYear,
};
