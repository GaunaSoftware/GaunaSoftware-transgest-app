const { cacheMiddleware, invalidateCache } = require("../services/cache");
// src/routes/docs.js — Documentación vehículos y choferes
const express = require("express");
const db      = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const router  = express.Router();
router.use(authenticate);

function normalizeDocType(value, scope) {
  const raw = String(value || "").trim().toLowerCase();
  const clean = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (scope === "vehiculo") {
    if (clean.includes("itv")) return "itv";
    if (clean.includes("seguro")) return "seguro";
    if (clean.includes("tacografo")) return "tacografo";
    if (clean.includes("tarjeta") && clean.includes("transporte")) return "tarjeta_transporte";
    if (clean.includes("permiso") || clean.includes("circulacion")) return "permiso_circulacion";
    if (["itv","seguro","tacografo","tarjeta_transporte","permiso_circulacion","otro"].includes(clean)) return clean;
    return "otro";
  }
  if (clean.includes("cap")) return "cap";
  if (clean.includes("tarjeta") && clean.includes("tacografo")) return "tarjeta_tacografo";
  if (clean.includes("reconocimiento")) return "reconocimiento";
  if (clean.includes("adr")) return "adr";
  if (clean.includes("permiso") || clean.includes("carnet") || clean.includes("conducir")) return "permiso";
  if (["permiso","cap","tarjeta_tacografo","reconocimiento","adr","otro"].includes(clean)) return clean;
  return "otro";
}

function normalizeDocInput(body = {}, scope = "vehiculo") {
  const fileSizeKb = body.file_size_kb
    ? Number(body.file_size_kb)
    : (body.file_size ? Math.ceil(Number(body.file_size) / 1024) : null);
  return {
    tipo: normalizeDocType(body.tipo || body.tipo_doc, scope),
    descripcion: body.descripcion || body.organismo || body.notas || null,
    fecha_emision: body.fecha_emision || null,
    fecha_vencimiento: body.fecha_vencimiento || null,
    referencia: body.referencia || body.numero_doc || null,
    alerta_dias: Number(body.alerta_dias || 30) || 30,
    file_url: body.file_url || null,
    file_nombre: body.file_nombre || body.file_name || null,
    file_size_kb: Number.isFinite(fileSizeKb) ? fileSizeKb : null,
  };
}

function normalizeDocRow(row = {}, extra = {}) {
  const entidadNombre = extra.entidad_nombre || row.entidad_nombre || row.matricula || row.chofer_nombre || "";
  return {
    ...row,
    ...extra,
    tipo_doc: row.tipo_doc || row.tipo || "Otros",
    organismo: row.organismo || row.descripcion || "",
    notas: row.notas || row.descripcion || "",
    numero_doc: row.numero_doc || row.referencia || "",
    vehiculo_matricula: extra.vehiculo_matricula || row.vehiculo_matricula || row.matricula || null,
    chofer_nombre: extra.chofer_nombre || row.chofer_nombre || (extra.entidad_tipo === "chofer" ? entidadNombre : null),
  };
}

router.get("/proximos-vencer", cacheMiddleware(120), async (req,res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.json([]);
    const vehiculos = await db.query(`
      SELECT d.*, v.matricula, v.marca
      FROM docs_vehiculos d
      JOIN vehiculos v ON v.id = d.vehiculo_id
      WHERE v.empresa_id = $1
        AND d.fecha_vencimiento IS NOT NULL
        AND d.fecha_vencimiento <= CURRENT_DATE + INTERVAL '60 days'
      ORDER BY d.fecha_vencimiento ASC
      LIMIT 50
    `, [empresaId]).catch(() => ({rows:[]}));
    const choferes = await db.query(`
      SELECT d.*,
             TRIM(CONCAT(COALESCE(c.nombre,''), ' ', COALESCE(c.apellidos,''))) AS chofer_nombre
      FROM docs_choferes d
      JOIN choferes c ON c.id = d.chofer_id
      WHERE c.empresa_id = $1
        AND d.fecha_vencimiento IS NOT NULL
        AND d.fecha_vencimiento <= CURRENT_DATE + INTERVAL '60 days'
      ORDER BY d.fecha_vencimiento ASC
      LIMIT 50
    `, [empresaId]).catch(() => ({rows:[]}));
    const rows = [
      ...vehiculos.rows.map(r => normalizeDocRow(r, { entidad_tipo:"vehiculo", vehiculo_matricula:r.matricula, entidad_nombre:r.matricula || r.marca })),
      ...choferes.rows.map(r => normalizeDocRow(r, { entidad_tipo:"chofer", chofer_nombre:r.chofer_nombre, entidad_nombre:r.chofer_nombre })),
    ].sort((a, b) => String(a.fecha_vencimiento || "9999-12-31").localeCompare(String(b.fecha_vencimiento || "9999-12-31")));
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/todos", cacheMiddleware(120), async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.json([]);
    const vehiculos = await db.query(`
      SELECT d.id, d.tipo, d.descripcion, d.fecha_emision, d.fecha_vencimiento,
             d.referencia, d.alerta_dias, d.created_at,
             'vehiculo' AS entidad_tipo,
             v.id AS entidad_id,
             COALESCE(v.matricula, v.marca, 'Vehiculo') AS entidad_nombre
      FROM docs_vehiculos d
      JOIN vehiculos v ON v.id = d.vehiculo_id
      WHERE v.empresa_id=$1
    `, [empresaId]).catch(() => ({ rows: [] }));
    const choferes = await db.query(`
      SELECT d.id, d.tipo, d.descripcion, d.fecha_emision, d.fecha_vencimiento,
             d.referencia, d.alerta_dias, d.created_at,
             'chofer' AS entidad_tipo,
             c.id AS entidad_id,
             TRIM(CONCAT(COALESCE(c.nombre,''), ' ', COALESCE(c.apellidos,''))) AS entidad_nombre
      FROM docs_choferes d
      JOIN choferes c ON c.id = d.chofer_id
      WHERE c.empresa_id=$1
    `, [empresaId]).catch(() => ({ rows: [] }));
    const rows = [...vehiculos.rows, ...choferes.rows]
      .map(r => normalizeDocRow(r, {
        entidad_tipo: r.entidad_tipo,
        entidad_nombre: r.entidad_nombre,
        vehiculo_matricula: r.entidad_tipo === "vehiculo" ? r.entidad_nombre : null,
        chofer_nombre: r.entidad_tipo === "chofer" ? r.entidad_nombre : null,
      }))
      .sort((a, b) => String(a.fecha_vencimiento || "9999-12-31").localeCompare(String(b.fecha_vencimiento || "9999-12-31")));
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/vehiculo/:id", async (req,res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { rows } = await db.query(`
    SELECT d.*
    FROM docs_vehiculos d
    JOIN vehiculos v ON v.id=d.vehiculo_id
    WHERE d.vehiculo_id=$1 AND v.empresa_id=$2
    ORDER BY d.fecha_vencimiento ASC
  `, [req.params.id, empresaId]);
  res.json(rows.map(r => normalizeDocRow(r, { entidad_tipo:"vehiculo" })));
});

router.post("/vehiculo/:id", GERENTE_O_TRAFICO, invalidateCache("docs"), async (req,res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const data = normalizeDocInput(req.body, "vehiculo");
    let rows;
    try {
      ({ rows } = await db.query(
        `INSERT INTO docs_vehiculos
          (vehiculo_id,empresa_id,tipo,descripcion,fecha_emision,fecha_vencimiento,referencia,alerta_dias,file_url,file_nombre,file_size_kb)
         SELECT v.id,v.empresa_id,$2,$3,$4,$5,$6,$7,$8,$9,$10
         FROM vehiculos v
         WHERE v.id=$1 AND v.empresa_id=$11
         RETURNING *`,
        [req.params.id, data.tipo, data.descripcion, data.fecha_emision, data.fecha_vencimiento, data.referencia, data.alerta_dias, data.file_url, data.file_nombre, data.file_size_kb, empresaId]
      ));
    } catch(e) {
      if (e.code !== "22P02") throw e;
      ({ rows } = await db.query(
        `INSERT INTO docs_vehiculos
          (vehiculo_id,empresa_id,tipo,descripcion,fecha_emision,fecha_vencimiento,referencia,alerta_dias,file_url,file_nombre,file_size_kb)
         SELECT v.id,v.empresa_id,$2,$3,$4,$5,$6,$7,$8,$9,$10
         FROM vehiculos v
         WHERE v.id=$1 AND v.empresa_id=$11
         RETURNING *`,
        [req.params.id, "otro", data.descripcion, data.fecha_emision, data.fecha_vencimiento, data.referencia, data.alerta_dias, data.file_url, data.file_nombre, data.file_size_kb, empresaId]
      ));
    }
    if (!rows.length) return res.status(404).json({ error:"Vehiculo no encontrado" });
    res.status(201).json(normalizeDocRow(rows[0], { entidad_tipo:"vehiculo" }));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.delete("/vehiculo/:vehiculoId/:docId", GERENTE_O_TRAFICO, invalidateCache("docs"), async (req,res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rowCount } = await db.query(`
      DELETE FROM docs_vehiculos d
      USING vehiculos v
      WHERE d.id=$1
        AND d.vehiculo_id=$2
        AND v.id=d.vehiculo_id
        AND v.empresa_id=$3
    `, [req.params.docId, req.params.vehiculoId, empresaId]);
    if (!rowCount) return res.status(404).json({ error:"Documento no encontrado" });
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.get("/chofer/:id", async (req,res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { rows } = await db.query(`
    SELECT d.*
    FROM docs_choferes d
    JOIN choferes c ON c.id=d.chofer_id
    WHERE d.chofer_id=$1 AND c.empresa_id=$2
    ORDER BY d.fecha_vencimiento ASC
  `, [req.params.id, empresaId]);
  res.json(rows.map(r => normalizeDocRow(r, { entidad_tipo:"chofer" })));
});

router.post("/chofer/:id", GERENTE_O_TRAFICO, invalidateCache("docs"), async (req,res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const data = normalizeDocInput(req.body, "chofer");
    let rows;
    try {
      ({ rows } = await db.query(
        `INSERT INTO docs_choferes
          (chofer_id,empresa_id,tipo,descripcion,fecha_emision,fecha_vencimiento,referencia,alerta_dias,file_url,file_nombre,file_size_kb)
         SELECT c.id,c.empresa_id,$2,$3,$4,$5,$6,$7,$8,$9,$10
         FROM choferes c
         WHERE c.id=$1 AND c.empresa_id=$11
         RETURNING *`,
        [req.params.id, data.tipo, data.descripcion, data.fecha_emision, data.fecha_vencimiento, data.referencia, data.alerta_dias, data.file_url, data.file_nombre, data.file_size_kb, empresaId]
      ));
    } catch(e) {
      if (e.code !== "22P02") throw e;
      ({ rows } = await db.query(
        `INSERT INTO docs_choferes
          (chofer_id,empresa_id,tipo,descripcion,fecha_emision,fecha_vencimiento,referencia,alerta_dias,file_url,file_nombre,file_size_kb)
         SELECT c.id,c.empresa_id,$2,$3,$4,$5,$6,$7,$8,$9,$10
         FROM choferes c
         WHERE c.id=$1 AND c.empresa_id=$11
         RETURNING *`,
        [req.params.id, "otro", data.descripcion, data.fecha_emision, data.fecha_vencimiento, data.referencia, data.alerta_dias, data.file_url, data.file_nombre, data.file_size_kb, empresaId]
      ));
    }
    if (!rows.length) return res.status(404).json({ error:"Chofer no encontrado" });
    res.status(201).json(normalizeDocRow(rows[0], { entidad_tipo:"chofer" }));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.delete("/chofer/:choferId/:docId", GERENTE_O_TRAFICO, invalidateCache("docs"), async (req,res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rowCount } = await db.query(`
      DELETE FROM docs_choferes d
      USING choferes c
      WHERE d.id=$1
        AND d.chofer_id=$2
        AND c.id=d.chofer_id
        AND c.empresa_id=$3
    `, [req.params.docId, req.params.choferId, empresaId]);
    if (!rowCount) return res.status(404).json({ error:"Documento no encontrado" });
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

module.exports = router;
