const express = require("express");
const db = require("../services/db");
const { requireRole } = require("../middleware/auth");
const { fallbackPlaceForAddress } = require("../services/geoFallback");
const { coordsFromText, isMapsUrl, resolveMapsCoords } = require("../services/mapsLink");

const router = express.Router();
const PUEDE_EDITAR = requireRole("gerente", "trafico", "administrativo");
const DEFAULT_COUNTRY = "España";
const STREET_ADDRESS_RE = /\b(calle|c\/|avda|avenida|carretera|ctra|camino|poligono|pol\.|parcela|nave|autovia|autopista|plaza|paseo|ronda|km)\b/i;

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id;
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function cleanOptionalText(value) {
  const clean = cleanText(value);
  return clean ? clean : null;
}

function foldPointKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberOrNull(value) {
  const clean = emptyToNull(value);
  if (clean === null) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function boolFromBody(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return false;
  return ["1", "true", "si", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function boolFromQuery(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return false;
  return ["1", "true", "si", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function puntoGeneralFromBody(body = {}) {
  return boolFromBody(body.punto_general ?? body.es_general ?? body.general);
}

function normalizeMetadata(metadata = {}, googleMapsUrl = null, location = {}) {
  const base = metadata && typeof metadata === "object" ? { ...metadata } : {};
  if (googleMapsUrl) base.google_maps_url = String(googleMapsUrl).trim();
  else delete base.google_maps_url;
  if (location.lat !== null && location.lat !== undefined) base.lat = location.lat;
  if (location.lng !== null && location.lng !== undefined) base.lng = location.lng;
  if (location.location_quality) base.location_quality = location.location_quality;
  if (location.coords_source) base.coords_source = location.coords_source;
  if (location.normalized_query) base.normalized_query = location.normalized_query;
  return base;
}

function withComputedFields(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    ...row,
    google_maps_url: metadata.google_maps_url || "",
    es_general: !row?.cliente_id,
    punto_general: !row?.cliente_id,
  };
}

async function findExistingPoint({ empresa, clienteId, direccion, nombre, ciudad, provincia, direccionKey }) {
  const { rows } = await db.query(
    `SELECT *
       FROM puntos_interes
      WHERE empresa_id=$1
        AND cliente_id IS NOT DISTINCT FROM $2::uuid
        AND activo=true
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 500`,
    [empresa, clienteId]
  );
  const wantedDireccionKey = direccionKey || foldPointKey(direccion);
  const wantedNombreKey = foldPointKey(nombre);
  const wantedCiudadKey = foldPointKey(ciudad);
  const wantedProvinciaKey = foldPointKey(provincia);

  return rows.find((row) => {
    const rowDireccionKey = foldPointKey(row.direccion_key || row.direccion);
    if (wantedDireccionKey && rowDireccionKey === wantedDireccionKey) return true;

    const rowNombreKey = foldPointKey(row.nombre);
    if (!wantedNombreKey || rowNombreKey !== wantedNombreKey) return false;

    const rowCiudadKey = foldPointKey(row.ciudad);
    const rowProvinciaKey = foldPointKey(row.provincia);
    return (
      (wantedCiudadKey && rowCiudadKey === wantedCiudadKey) ||
      (wantedProvinciaKey && rowProvinciaKey === wantedProvinciaKey)
    );
  }) || null;
}

function isCountryOnly(value = "") {
  const clean = cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return ["espana", "spain", "españa", "portugal", "francia", "france", "italia", "italy"].includes(clean);
}

async function normalizeLocationFields({
  cleanDireccion,
  cleanCiudad,
  cleanProvincia,
  pais,
  lat,
  lng,
  google_maps_url,
}) {
  const googleMapsUrl = cleanOptionalText(google_maps_url);
  if (googleMapsUrl && !isMapsUrl(googleMapsUrl) && !/^geo:/i.test(googleMapsUrl) && !coordsFromText(googleMapsUrl)) {
    const err = new Error("El enlace del punto debe ser un enlace de Google Maps, geo: o coordenadas lat,lng.");
    err.status = 400;
    throw err;
  }

  let nextCiudad = cleanCiudad;
  let nextProvincia = cleanProvincia;
  const nextPais = cleanOptionalText(pais) || DEFAULT_COUNTRY;
  let nextLat = numberOrNull(lat);
  let nextLng = numberOrNull(lng);
  let coordsSource = "";

  const inlineCoords = coordsFromText(googleMapsUrl || "");
  if (inlineCoords) {
    nextLat = inlineCoords.lat;
    nextLng = inlineCoords.lng;
    coordsSource = "maps_inline";
  } else if (googleMapsUrl) {
    const resolvedCoords = await resolveMapsCoords(googleMapsUrl).catch(() => null);
    if (resolvedCoords) {
      nextLat = resolvedCoords.lat;
      nextLng = resolvedCoords.lng;
      coordsSource = "maps_shortlink";
    }
  }

  const hasCoords = nextLat !== null && nextLng !== null;
  const addressNeedsContext = STREET_ADDRESS_RE.test(cleanDireccion) && !nextCiudad && !nextProvincia && !hasCoords;
  if (addressNeedsContext) {
    const err = new Error("Indica poblacion y provincia para direcciones de calle, o pega un enlace de Google Maps con coordenadas.");
    err.status = 400;
    throw err;
  }

  if ((!nextCiudad || !nextProvincia) && !addressNeedsContext && !isCountryOnly(cleanDireccion)) {
    const inferred = fallbackPlaceForAddress([cleanDireccion, nextCiudad, nextProvincia, nextPais].filter(Boolean).join(", "));
    if (inferred) {
      nextCiudad = nextCiudad || inferred.municipio;
      nextProvincia = nextProvincia || inferred.provincia;
      if (!hasCoords) {
        nextLat = inferred.lat;
        nextLng = inferred.lng;
        coordsSource = "local_dictionary";
      }
    }
  }

  const hasFinalCoords = nextLat !== null && nextLng !== null;
  if (isCountryOnly(cleanDireccion) || (!nextCiudad && !nextProvincia && !hasFinalCoords)) {
    const err = new Error("El punto necesita poblacion/provincia o coordenadas. No se guardan puntos solo con pais o texto ambiguo.");
    err.status = 400;
    throw err;
  }

  return {
    ciudad: nextCiudad,
    provincia: nextProvincia,
    pais: nextPais,
    lat: nextLat,
    lng: nextLng,
    googleMapsUrl,
    coords_source: coordsSource || (hasCoords ? "manual" : ""),
    location_quality: hasFinalCoords ? "precisa" : "estructurada",
    normalized_query: [cleanDireccion, nextCiudad, nextProvincia, nextPais].filter(Boolean).join(", "),
  };
}

router.get("/", async (req, res) => {
  const empresa = empresaId(req);
  if (!empresa) return res.status(401).json({ error: "Sin empresa_id" });

  const { q, tipo, cliente_id } = req.query;
  const includeGeneral = boolFromQuery(req.query.include_general ?? req.query.incluir_generales ?? req.query.generales);
  const params = [empresa];
  const where = ["empresa_id=$1", "activo=true"];

  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where.push(`(LOWER(nombre) LIKE $${params.length} OR LOWER(direccion) LIKE $${params.length} OR LOWER(COALESCE(ciudad,'')) LIKE $${params.length})`);
  }
  if (tipo && tipo !== "todos") {
    params.push(tipo);
    where.push(`(tipo=$${params.length} OR tipo='ambos')`);
  }
  if (cliente_id) {
    params.push(cliente_id);
    where.push(includeGeneral ? `(cliente_id=$${params.length} OR cliente_id IS NULL)` : `cliente_id=$${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT *
       FROM puntos_interes
      WHERE ${where.join(" AND ")}
      ORDER BY ${cliente_id && includeGeneral ? `CASE WHEN cliente_id=$${params.length} THEN 0 ELSE 1 END, ` : ""}nombre ASC
      LIMIT 200`,
    params
  );
  res.json(rows.map(withComputedFields));
});

router.post("/", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  if (!empresa) return res.status(401).json({ error: "Sin empresa_id" });

  const {
    nombre, cif, direccion, codigo_postal, ciudad, provincia, pais,
    lat, lng, tipo, ventana, contacto_nombre, contacto_telefono,
    email, notas, metadata, google_maps_url, cliente_id,
  } = req.body || {};
  const clienteId = puntoGeneralFromBody(req.body) ? null : emptyToNull(cliente_id);
  const cleanNombre = cleanText(nombre);
  const cleanDireccion = cleanText(direccion);
  const direccionKey = foldPointKey(cleanDireccion);
  const cleanCiudad = cleanOptionalText(ciudad);
  const cleanProvincia = cleanOptionalText(provincia);

  if (!cleanNombre || !cleanDireccion) {
    return res.status(400).json({ error: "Nombre y direccion son obligatorios" });
  }

  let location;
  try {
    location = await normalizeLocationFields({
      cleanDireccion,
      cleanCiudad,
      cleanProvincia,
      pais,
      lat,
      lng,
      google_maps_url,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || "No se pudo validar la ubicacion del punto." });
  }

  const already = await findExistingPoint({
    empresa,
    clienteId,
    direccion: cleanDireccion,
    nombre: cleanNombre,
    ciudad: location.ciudad,
    provincia: location.provincia,
    direccionKey,
  });
  if (already) return res.status(200).json(withComputedFields(already));

  const { rows } = await db.query(
    `INSERT INTO puntos_interes
      (empresa_id,cliente_id,nombre,cif,direccion,codigo_postal,ciudad,provincia,pais,lat,lng,tipo,ventana,
       contacto_nombre,contacto_telefono,email,notas,direccion_key,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      empresa,
      clienteId,
      cleanNombre,
      cleanOptionalText(cif),
      cleanDireccion,
      cleanOptionalText(codigo_postal),
      location.ciudad,
      location.provincia,
      location.pais,
      location.lat,
      location.lng,
      cleanOptionalText(tipo) || "ambos",
      cleanOptionalText(ventana),
      cleanOptionalText(contacto_nombre),
      cleanOptionalText(contacto_telefono),
      cleanOptionalText(email),
      cleanOptionalText(notas),
      direccionKey,
      normalizeMetadata(metadata, location.googleMapsUrl, location),
    ]
  );

  if (rows[0]) return res.status(201).json(withComputedFields(rows[0]));

  const existing = await findExistingPoint({
    empresa,
    clienteId,
    direccion: cleanDireccion,
    nombre: cleanNombre,
    ciudad: location.ciudad,
    provincia: location.provincia,
    direccionKey,
  });
  if (existing) return res.status(200).json(withComputedFields(existing));
  return res.status(409).json({ error: "Ya existe un punto similar o no se ha podido guardar. Actualiza la lista y seleccionalo." });
});

router.put("/:id", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  if (!empresa) return res.status(401).json({ error: "Sin empresa_id" });

  const {
    nombre, cif, direccion, codigo_postal, ciudad, provincia, pais,
    lat, lng, tipo, ventana, contacto_nombre, contacto_telefono,
    email, notas, metadata, google_maps_url, cliente_id,
  } = req.body || {};
  const clienteId = puntoGeneralFromBody(req.body) ? null : emptyToNull(cliente_id);
  const cleanNombre = cleanText(nombre);
  const cleanDireccion = cleanText(direccion);
  const direccionKey = foldPointKey(cleanDireccion);
  const cleanCiudad = cleanOptionalText(ciudad);
  const cleanProvincia = cleanOptionalText(provincia);

  if (!cleanNombre || !cleanDireccion) {
    return res.status(400).json({ error: "Nombre y direccion son obligatorios" });
  }

  let location;
  try {
    location = await normalizeLocationFields({
      cleanDireccion,
      cleanCiudad,
      cleanProvincia,
      pais,
      lat,
      lng,
      google_maps_url,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || "No se pudo validar la ubicacion del punto." });
  }

  const already = await findExistingPoint({
    empresa,
    clienteId,
    direccion: cleanDireccion,
    nombre: cleanNombre,
    ciudad: location.ciudad,
    provincia: location.provincia,
    direccionKey,
  });
  if (already && String(already.id) !== String(req.params.id)) {
    return res.status(200).json(withComputedFields(already));
  }

  const { rows } = await db.query(
     `UPDATE puntos_interes SET
       nombre=$1,cif=$2,direccion=$3,codigo_postal=$4,ciudad=$5,provincia=$6,pais=$7,
       lat=$8,lng=$9,tipo=$10,ventana=$11,contacto_nombre=$12,contacto_telefono=$13,
       email=$14,notas=$15,direccion_key=$16,metadata=$17,cliente_id=$18,updated_at=NOW()
     WHERE id=$19 AND empresa_id=$20 AND activo=true
    RETURNING *`,
    [
      cleanNombre,
      cleanOptionalText(cif),
      cleanDireccion,
      cleanOptionalText(codigo_postal),
      location.ciudad,
      location.provincia,
      location.pais,
      location.lat,
      location.lng,
      cleanOptionalText(tipo) || "ambos",
      cleanOptionalText(ventana),
      cleanOptionalText(contacto_nombre),
      cleanOptionalText(contacto_telefono),
      cleanOptionalText(email),
      cleanOptionalText(notas),
      direccionKey,
      normalizeMetadata(metadata, location.googleMapsUrl, location),
      clienteId,
      req.params.id,
      empresa,
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: "Punto no encontrado" });
  res.json(withComputedFields(rows[0]));
});

router.delete("/:id", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  if (!empresa) return res.status(401).json({ error: "Sin empresa_id" });
  await db.query(
    "UPDATE puntos_interes SET activo=false, updated_at=NOW() WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresa]
  );
  res.json({ ok: true });
});

module.exports = router;
