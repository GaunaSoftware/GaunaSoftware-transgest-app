const express = require("express");
const db = require("../services/db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();
const PUEDE_EDITAR = requireRole("gerente", "trafico", "administrativo");

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

function normalizeMetadata(metadata = {}, googleMapsUrl = null) {
  const base = metadata && typeof metadata === "object" ? { ...metadata } : {};
  if (googleMapsUrl) base.google_maps_url = String(googleMapsUrl).trim();
  else delete base.google_maps_url;
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

async function findExistingPoint({ empresa, clienteId, direccion, nombre, ciudad, provincia }) {
  const { rows } = await db.query(
    `SELECT *
       FROM puntos_interes
      WHERE empresa_id=$1
        AND cliente_id IS NOT DISTINCT FROM $2::uuid
        AND activo=true
        AND (
          LOWER(TRIM(COALESCE(direccion,'')))=LOWER(TRIM(COALESCE($3,'')))
          OR (
            $5::text IS NOT NULL
            AND
            LOWER(TRIM(COALESCE(nombre,'')))=LOWER(TRIM(COALESCE($4,'')))
            AND COALESCE(LOWER(TRIM(ciudad)),'')=COALESCE(LOWER(TRIM($5)),'')
          )
          OR (
            $6::text IS NOT NULL
            AND
            LOWER(TRIM(COALESCE(nombre,'')))=LOWER(TRIM(COALESCE($4,'')))
            AND COALESCE(LOWER(TRIM(provincia)),'')=COALESCE(LOWER(TRIM($6)),'')
          )
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1`,
    [empresa, clienteId, direccion, nombre, ciudad, provincia]
  );
  return rows[0] || null;
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
  const cleanCiudad = cleanOptionalText(ciudad);
  const cleanProvincia = cleanOptionalText(provincia);

  if (!cleanNombre || !cleanDireccion) {
    return res.status(400).json({ error: "Nombre y direccion son obligatorios" });
  }

  const already = await findExistingPoint({
    empresa,
    clienteId,
    direccion: cleanDireccion,
    nombre: cleanNombre,
    ciudad: cleanCiudad,
    provincia: cleanProvincia,
  });
  if (already) return res.status(200).json(withComputedFields(already));

  const { rows } = await db.query(
    `INSERT INTO puntos_interes
      (empresa_id,cliente_id,nombre,cif,direccion,codigo_postal,ciudad,provincia,pais,lat,lng,tipo,ventana,
       contacto_nombre,contacto_telefono,email,notas,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      empresa,
      clienteId,
      cleanNombre,
      cleanOptionalText(cif),
      cleanDireccion,
      cleanOptionalText(codigo_postal),
      cleanCiudad,
      cleanProvincia,
      emptyToNull(pais) || "España",
      numberOrNull(lat),
      numberOrNull(lng),
      cleanOptionalText(tipo) || "ambos",
      cleanOptionalText(ventana),
      cleanOptionalText(contacto_nombre),
      cleanOptionalText(contacto_telefono),
      cleanOptionalText(email),
      cleanOptionalText(notas),
      normalizeMetadata(metadata, cleanOptionalText(google_maps_url)),
    ]
  );

  if (rows[0]) return res.status(201).json(withComputedFields(rows[0]));

  const existing = await findExistingPoint({
    empresa,
    clienteId,
    direccion: cleanDireccion,
    nombre: cleanNombre,
    ciudad: cleanCiudad,
    provincia: cleanProvincia,
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

  const { rows } = await db.query(
    `UPDATE puntos_interes SET
       nombre=$1,cif=$2,direccion=$3,codigo_postal=$4,ciudad=$5,provincia=$6,pais=$7,
       lat=$8,lng=$9,tipo=$10,ventana=$11,contacto_nombre=$12,contacto_telefono=$13,
       email=$14,notas=$15,metadata=$16,cliente_id=$17,updated_at=NOW()
     WHERE id=$18 AND empresa_id=$19 AND activo=true
     RETURNING *`,
    [
      nombre,
      emptyToNull(cif),
      direccion,
      emptyToNull(codigo_postal),
      emptyToNull(ciudad),
      emptyToNull(provincia),
      emptyToNull(pais) || "España",
      numberOrNull(lat),
      numberOrNull(lng),
      emptyToNull(tipo) || "ambos",
      emptyToNull(ventana),
      emptyToNull(contacto_nombre),
      emptyToNull(contacto_telefono),
      emptyToNull(email),
      emptyToNull(notas),
      normalizeMetadata(metadata, emptyToNull(google_maps_url)),
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
