const JOIN_WORDS = new Set([
  "a", "al", "de", "del", "el", "la", "las", "los", "d", "da", "das", "do", "dos",
]);

const GENERIC_ADDRESS_WORDS = new Set([
  ...JOIN_WORDS,
  "autovia", "autopista", "avenida", "av", "calle", "camino", "carretera", "ctra",
  "km", "kilometro", "paseo", "plaza", "poligono", "ronda", "ruta", "via",
]);

const COUNTRY_CODES = {
  alemania: "de", germany: "de", de: "de",
  austria: "at", at: "at",
  belgica: "be", belgium: "be", be: "be",
  bulgaria: "bg", bg: "bg",
  chequia: "cz", republica_checa: "cz", czechia: "cz", cz: "cz",
  chipre: "cy", cyprus: "cy", cy: "cy",
  croacia: "hr", croatia: "hr", hr: "hr",
  dinamarca: "dk", denmark: "dk", dk: "dk",
  eslovaquia: "sk", slovakia: "sk", sk: "sk",
  eslovenia: "si", slovenia: "si", si: "si",
  espana: "es", spain: "es", es: "es",
  estonia: "ee", ee: "ee",
  finlandia: "fi", finland: "fi", fi: "fi",
  francia: "fr", france: "fr", fr: "fr",
  grecia: "gr", greece: "gr", gr: "gr",
  hungria: "hu", hungary: "hu", hu: "hu",
  irlanda: "ie", ireland: "ie", ie: "ie",
  islandia: "is", iceland: "is", is: "is",
  italia: "it", italy: "it", it: "it",
  letonia: "lv", latvia: "lv", lv: "lv",
  lituania: "lt", lithuania: "lt", lt: "lt",
  luxemburgo: "lu", luxembourg: "lu", lu: "lu",
  malta: "mt", mt: "mt",
  noruega: "no", norway: "no", no: "no",
  paises_bajos: "nl", holanda: "nl", netherlands: "nl", nl: "nl",
  polonia: "pl", poland: "pl", pl: "pl",
  portugal: "pt", pt: "pt",
  reino_unido: "gb", gran_bretana: "gb", inglaterra: "gb", united_kingdom: "gb", uk: "gb", gb: "gb",
  rumania: "ro", romania: "ro", ro: "ro",
  suecia: "se", sweden: "se", se: "se",
  suiza: "ch", switzerland: "ch", ch: "ch",
};

function normalizeGeoText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localityKey(value = "") {
  return normalizeGeoText(value)
    .split(" ")
    .filter(word => word && !JOIN_WORDS.has(word))
    .join(" ");
}

function countryCodeFor(value = "") {
  const key = normalizeGeoText(value).replace(/ /g, "_");
  return COUNTRY_CODES[key] || "";
}

function parsePlaceRequest(q = "", country = "", region = "") {
  let query = String(q || "").replace(/\s+/g, " ").trim();
  let regionHint = String(region || "").replace(/\s+/g, " ").trim();
  const parenthetical = query.match(/\(([^()]{2,80})\)\s*$/);
  if (parenthetical) {
    if (!regionHint) regionHint = parenthetical[1].trim();
    query = query.slice(0, parenthetical.index).trim().replace(/[,;\s]+$/, "");
  }
  const normalized = normalizeGeoText(query);
  const addressLike = /\d/.test(query)
    || /[,;]/.test(query)
    || /\b(?:autovia|autopista|avenida|av|calle|camino|carretera|ctra|km|paseo|plaza|poligono|ronda|ruta|via)\b/i.test(normalized);
  const localityOnly = !addressLike && normalized.split(" ").filter(Boolean).length <= 8;
  return {
    query,
    country: String(country || "").replace(/\s+/g, " ").trim(),
    region: regionHint,
    localityOnly,
  };
}

function fuzzyEquals(left = "", right = "") {
  const a = localityKey(left);
  const b = localityKey(right);
  if (!a || !b) return false;
  if (a === b || (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)))) return true;
  if (Math.min(a.length, b.length) < 7 || Math.abs(a.length - b.length) > 1) return false;
  return editDistanceAtMost(a, b, 1);
}

function editDistanceAtMost(left = "", right = "", limit = 1) {
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      rowMinimum = Math.min(rowMinimum, current[j]);
    }
    if (rowMinimum > limit) return false;
    previous = current;
  }
  return previous[right.length] <= limit;
}

function isCountryOnlyQuery(query = "", country = "") {
  const normalizedQuery = normalizeGeoText(query);
  if (!normalizedQuery) return false;
  if (countryCodeFor(normalizedQuery)) return true;
  return !!country && normalizedQuery === normalizeGeoText(country);
}

function significantTokens(value = "") {
  return normalizeGeoText(value)
    .split(" ")
    .filter(word => word.length >= 3 && !GENERIC_ADDRESS_WORDS.has(word));
}

function regionMatches(requested = "", candidate = "", label = "") {
  if (!normalizeGeoText(requested)) return true;
  return fuzzyEquals(requested, candidate) || fuzzyEquals(requested, label);
}

function scorePlaceCandidate(request, candidate = {}) {
  if (!candidate || candidate.lat == null || candidate.lng == null) return -1;
  const requestedCountry = countryCodeFor(request.country);
  const candidateCountry = String(candidate.country_code || candidate.countryCode || "").toLowerCase()
    || countryCodeFor(candidate.pais || candidate.country);
  if (requestedCountry && candidateCountry && requestedCountry !== candidateCountry) return -1;
  if (!regionMatches(request.region, candidate.provincia || candidate.region, candidate.label)) return -1;

  const requestedLocality = localityKey(request.query);
  const candidateLocality = localityKey(candidate.municipio || candidate.city || candidate.locality);
  const candidateAliases = (Array.isArray(candidate.aliases) ? candidate.aliases : [])
    .map(localityKey)
    .filter(Boolean);
  const exactLocality = requestedLocality && candidateLocality && requestedLocality === candidateLocality;
  const compatibleLocality = requestedLocality && candidateLocality && fuzzyEquals(requestedLocality, candidateLocality);
  const compatibleAlias = requestedLocality && candidateAliases.some(alias => fuzzyEquals(requestedLocality, alias));
  let score = 0;

  if (exactLocality) score += 130;
  else if (compatibleLocality) score += 105;
  else if (compatibleAlias) score += 100;
  else if (request.localityOnly) return -1;
  else {
    const queryTokens = significantTokens(request.query);
    const labelText = normalizeGeoText([candidate.label, candidate.municipio, candidate.provincia].filter(Boolean).join(" "));
    const hits = queryTokens.filter(token => labelText.includes(token)).length;
    const minimumHits = queryTokens.length <= 1 ? 1 : 2;
    if (!queryTokens.length || hits < minimumHits) return -1;
    score += 45 + (hits * 12);
  }

  if (request.region) score += 30;
  if (requestedCountry && candidateCountry === requestedCountry) score += 12;
  if (["city", "town", "village", "municipality", "administrative"].includes(String(candidate.result_type || candidate.addresstype || "").toLowerCase())) score += 18;
  score += Math.max(0, Math.min(15, Number(candidate.quality || candidate.importance || 0) * 10));
  return score;
}

function selectBestPlaceCandidate(request, candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .map(candidate => ({ candidate, score: scorePlaceCandidate(request, candidate) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

function searchQueryFor(request) {
  if (!request?.localityOnly) return request?.query || "";
  return localityKey(request.query) || request.query;
}

module.exports = {
  countryCodeFor,
  localityKey,
  normalizeGeoText,
  isCountryOnlyQuery,
  parsePlaceRequest,
  scorePlaceCandidate,
  searchQueryFor,
  selectBestPlaceCandidate,
};
