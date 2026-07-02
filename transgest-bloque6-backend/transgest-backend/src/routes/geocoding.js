const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { resolveApiKey, assertApiUsageAllowed, recordApiUsage } = require("../services/apiKeys");

const router = express.Router();

function normalizeKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickAddressPart(address = {}, keys = []) {
  for (const key of keys) {
    const value = cleanText(address[key]);
    if (value) return value;
  }
  return "";
}

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS geo_place_cache (
      id UUID PRIMARY KEY,
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      query_key TEXT NOT NULL,
      query TEXT NOT NULL,
      country_hint TEXT,
      region_hint TEXT,
      provider VARCHAR(40) NOT NULL DEFAULT 'local',
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (empresa_id, query_key)
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_geo_place_cache_lookup ON geo_place_cache(empresa_id, query_key)");
}

function buildQuery(q, country, region) {
  return [q, region, country].map(cleanText).filter(Boolean).join(", ");
}

function formatResult(raw = {}) {
  const municipio = cleanText(raw.municipio || raw.city || raw.locality);
  const provincia = cleanText(raw.provincia || raw.region || raw.state || raw.county);
  const pais = cleanText(raw.pais || raw.country);
  const lat = raw.lat == null || raw.lat === "" ? null : Number(raw.lat);
  const lng = raw.lng == null || raw.lng === "" ? null : Number(raw.lng);
  return {
    municipio,
    provincia,
    pais,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    label: cleanText(raw.label || [municipio, provincia, pais].filter(Boolean).join(", ")),
  };
}

async function geocodeHere(empresaId, q, country, region) {
  const resolved = await resolveApiKey(empresaId, "here");
  if (!resolved.key) return null;
  await assertApiUsageAllowed(empresaId, "here");
  const attempts = [
    buildQuery(q, country, region),
    country || region ? cleanText(q) : "",
  ].filter(Boolean);
  for (const query of attempts) {
    const url = new URL("https://geocode.search.hereapi.com/v1/geocode");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "1");
    url.searchParams.set("lang", "es-ES");
    url.searchParams.set("apiKey", resolved.key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const item = Array.isArray(data.items) ? data.items[0] : null;
      if (!item) continue;
      const address = item.address || {};
      await recordApiUsage(empresaId, "here", 1);
      return {
        provider: "here",
        ...formatResult({
          municipio: address.city || address.district || address.county,
          provincia: address.county || address.state,
          pais: address.countryName,
          lat: item.position?.lat,
          lng: item.position?.lng,
          label: item.title || address.label,
        }),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function geocodeNominatim(q, country, region) {
  const attempts = [
    buildQuery(q, country, region),
    country || region ? cleanText(q) : "",
  ].filter(Boolean);
  for (const query of attempts) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("accept-language", "es");
    url.searchParams.set("q", query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "TransGestTMS/1.0 geocoding (app.gauna.es)",
        },
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => []);
      const item = Array.isArray(data) ? data[0] : null;
      if (!item) continue;
      const address = item.address || {};
      return {
        provider: "nominatim",
        ...formatResult({
          municipio: pickAddressPart(address, ["city", "town", "village", "municipality", "hamlet", "suburb"]),
          provincia: pickAddressPart(address, ["province", "state", "region", "county"]),
          pais: address.country,
          lat: item.lat,
          lng: item.lon,
          label: item.display_name,
        }),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

router.get("/resolve", async (req, res, next) => {
  try {
    const empresaId = req.user?.empresa_id || req.empresaId;
    if (!empresaId) return res.status(401).json({ error: "Empresa no identificada" });
    const q = cleanText(req.query.q);
    const country = cleanText(req.query.country || req.query.pais || "");
    const region = cleanText(req.query.region || req.query.provincia || "");
    if (q.length < 2) return res.status(400).json({ error: "Indica una poblacion o direccion" });
    await ensureSchema();

    const queryKey = normalizeKey([q, country, region].filter(Boolean).join("|"));
    const cached = await db.query(
      "SELECT result, provider FROM geo_place_cache WHERE empresa_id=$1 AND query_key=$2 LIMIT 1",
      [empresaId, queryKey]
    );
    if (cached.rows[0]?.result) {
      return res.json({ ok: true, source: "cache", provider: cached.rows[0].provider, ...cached.rows[0].result });
    }

    let resolved = await geocodeHere(empresaId, q, country, region).catch(() => null);
    if (!resolved || (!resolved.provincia && !resolved.pais)) {
      resolved = await geocodeNominatim(q, country, region).catch(() => null);
    }
    if (!resolved || (!resolved.municipio && !resolved.provincia && !resolved.pais)) {
      return res.status(404).json({ ok: false, error: "No se pudo localizar esa poblacion" });
    }

    const result = formatResult(resolved);
    await db.query(`
      INSERT INTO geo_place_cache (id, empresa_id, query_key, query, country_hint, region_hint, provider, result, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (empresa_id, query_key) DO UPDATE SET
        query=EXCLUDED.query,
        country_hint=EXCLUDED.country_hint,
        region_hint=EXCLUDED.region_hint,
        provider=EXCLUDED.provider,
        result=EXCLUDED.result,
        updated_at=NOW()
    `, [crypto.randomUUID(), empresaId, queryKey, q, country || null, region || null, resolved.provider || "nominatim", JSON.stringify(result)]);

    res.json({ ok: true, source: "provider", provider: resolved.provider || "nominatim", ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
