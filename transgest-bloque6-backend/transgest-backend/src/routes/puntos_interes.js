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

  if (!nombre || !direccion) {
    return res.status(400).json({ error: "Nombre y direccion son obligatorios" });
  }

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
      nombre.trim(),
      emptyToNull(cif),
      direccion.trim(),
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
    ]
  );

  if (rows[0]) return res.status(201).json(withComputedFields(rows[0]));

  // Insert sin fila = ya existe ese punto para este mismo cliente (o general).
  // Devolvemos el punto existente del MISMO ambito, nunca el de otro cliente.
  const existing = await db.query(
    `SELECT * FROM puntos_interes
      WHERE empresa_id=$1
        AND LOWER(TRIM(direccion))=LOWER(TRIM($2))
        AND activo=true
        AND (
          ($3::uuid IS NULL AND cliente_id IS NULL)
          OR ($3::uuid IS NOT NULL AND cliente_id=$3::uuid)
        )
      ORDER BY CASE
        WHEN cliente_id::text = COALESCE($3::text,'') THEN 0
        WHEN cliente_id IS NULL THEN 1
        ELSE 2
      END
      LIMIT 1`,
    [empresa, direccion, clienteId]
  );
  if (existing.rows[0]) return res.status(200).json(withComputedFields(existing.rows[0]));
  return res.status(409).json({ error: "No se pudo guardar el punto por un conflicto de direccion. Vuelve a intentarlo." });
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
