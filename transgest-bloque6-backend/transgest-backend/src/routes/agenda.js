const express = require("express");
const db = require("../services/db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

const ROLES_INTERNOS = ["gerente", "contable", "administrativo", "trafico", "responsable_taller", "mecanico", "colaborador", "visualizador", "chofer"];
const PUEDE_VER_EQUIPO = new Set(["gerente", "contable", "administrativo", "trafico", "responsable_taller", "mecanico"]);
const PUEDE_EDITAR = requireRole(...ROLES_INTERNOS);

function empresaId(req) {
  return req.user?.empresa_id || null;
}

function canManageAll(req) {
  return PUEDE_VER_EQUIPO.has(req.user?.rol);
}

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function normalizeVisibility(value) {
  return value === "equipo" ? "equipo" : "personal";
}

function normalizeState(value) {
  return ["pendiente", "en_progreso", "hecha", "cancelada"].includes(value) ? value : "pendiente";
}

function normalizePriority(value) {
  return ["alta", "media", "baja"].includes(value) ? value : "media";
}

function normalizeType(value) {
  return cleanText(value) || "tarea";
}

async function ensureOwnerOrManager(req, eventoId) {
  const { rows } = await db.query(
    `SELECT id, empresa_id, creado_por, asignado_a
       FROM agenda_eventos
      WHERE id=$1 AND empresa_id=$2`,
    [eventoId, empresaId(req)]
  );
  const row = rows[0];
  if (!row) {
    const err = new Error("Evento no encontrado");
    err.statusCode = 404;
    throw err;
  }
  if (canManageAll(req)) return row;
  const uid = String(req.user?.id || "");
  if (String(row.creado_por || "") === uid || String(row.asignado_a || "") === uid) return row;
  const err = new Error("No puedes modificar este evento");
  err.statusCode = 403;
  throw err;
}

router.get("/usuarios", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const { rows } = await db.query(
    `SELECT id, nombre, email, username, rol, activo
       FROM usuarios
      WHERE empresa_id=$1
        AND activo=true
      ORDER BY
        CASE rol
          WHEN 'gerente' THEN 1
          WHEN 'contable' THEN 2
          WHEN 'administrativo' THEN 3
          WHEN 'trafico' THEN 4
          WHEN 'responsable_taller' THEN 5
          WHEN 'visualizador' THEN 6
          WHEN 'chofer' THEN 7
          ELSE 99
        END,
        COALESCE(NULLIF(TRIM(nombre),''), NULLIF(TRIM(username),''), NULLIF(TRIM(email),''), id::text)`,
    [empresaId(req)]
  );
  res.json(rows);
});

router.get("/", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const params = [empresaId(req)];
  const where = ["e.empresa_id=$1"];
  const qIdx = () => `$${params.length}`;

  if (req.query.desde) {
    params.push(req.query.desde);
    where.push(`e.fecha_inicio >= ${qIdx()}::timestamptz`);
  }
  if (req.query.hasta) {
    params.push(req.query.hasta);
    where.push(`e.fecha_inicio <= ${qIdx()}::timestamptz`);
  }
  if (req.query.estado) {
    params.push(req.query.estado);
    where.push(`e.estado = ${qIdx()}`);
  }
  if (req.query.tipo) {
    params.push(req.query.tipo);
    where.push(`e.tipo = ${qIdx()}`);
  }
  if (req.query.usuario_id) {
    params.push(req.query.usuario_id);
    where.push(`e.asignado_a = ${qIdx()}::uuid`);
  }
  if (req.query.modo === "mias" || !canManageAll(req)) {
    params.push(req.user.id);
    const idx = qIdx();
    where.push(`(e.asignado_a = ${idx}::uuid OR e.creado_por = ${idx}::uuid OR e.visibilidad = 'equipo')`);
  }

  const { rows } = await db.query(
    `SELECT e.*,
            uc.nombre AS creado_por_nombre,
            ua.nombre AS asignado_a_nombre,
            ua.rol    AS asignado_a_rol
       FROM agenda_eventos e
       LEFT JOIN usuarios uc ON uc.id = e.creado_por
       LEFT JOIN usuarios ua ON ua.id = e.asignado_a
      WHERE ${where.join(" AND ")}
      ORDER BY e.fecha_inicio ASC, e.created_at ASC`,
    params
  );
  res.json(rows);
});

router.post("/", PUEDE_EDITAR, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const body = req.body || {};
  const titulo = cleanText(body.titulo);
  const fechaInicio = cleanText(body.fecha_inicio);
  if (!titulo) return res.status(400).json({ error: "Titulo obligatorio" });
  if (!fechaInicio) return res.status(400).json({ error: "Fecha de inicio obligatoria" });

  const asignadoA = cleanText(body.asignado_a) || req.user.id;
  const solicitadaAOtro = req.user?.rol !== "gerente" && String(asignadoA) !== String(req.user.id);
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  if (solicitadaAOtro) {
    metadata.solicitud_tarea = true;
    metadata.solicitada_por = req.user.id;
  }
  const { rows } = await db.query(
    `INSERT INTO agenda_eventos
      (empresa_id, creado_por, asignado_a, titulo, descripcion, fecha_inicio, fecha_fin,
       todo_dia, tipo, prioridad, estado, visibilidad, pedido_id, vehiculo_id, metadata)
     VALUES
      ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11,$12,$13::uuid,$14::uuid,$15::jsonb)
     RETURNING *`,
    [
      empresaId(req),
      req.user.id,
      asignadoA,
      titulo,
      cleanText(body.descripcion),
      fechaInicio,
      cleanText(body.fecha_fin),
      !!body.todo_dia,
      normalizeType(body.tipo),
      normalizePriority(body.prioridad),
      solicitadaAOtro ? "pendiente" : normalizeState(body.estado),
      solicitadaAOtro ? "equipo" : normalizeVisibility(body.visibilidad),
      cleanText(body.pedido_id),
      cleanText(body.vehiculo_id),
      metadata,
    ]
  );
  res.status(201).json(rows[0]);
});

router.patch("/:id", PUEDE_EDITAR, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureOwnerOrManager(req, req.params.id);
  const body = req.body || {};
  const sets = [];
  const params = [];
  let i = 1;

  const push = (sql, value) => {
    sets.push(sql.replace("?", `$${i++}`));
    params.push(value);
  };

  if ("titulo" in body) push("titulo=?", cleanText(body.titulo));
  if ("descripcion" in body) push("descripcion=?", cleanText(body.descripcion));
  if ("fecha_inicio" in body) push("fecha_inicio=?::timestamptz", cleanText(body.fecha_inicio));
  if ("fecha_fin" in body) push("fecha_fin=?::timestamptz", cleanText(body.fecha_fin));
  if ("todo_dia" in body) push("todo_dia=?", !!body.todo_dia);
  if ("tipo" in body) push("tipo=?", normalizeType(body.tipo));
  if ("prioridad" in body) push("prioridad=?", normalizePriority(body.prioridad));
  if ("estado" in body) push("estado=?", normalizeState(body.estado));
  if ("visibilidad" in body) push("visibilidad=?", normalizeVisibility(body.visibilidad));
  if ("asignado_a" in body) {
    const nextAsignado = cleanText(body.asignado_a);
    push("asignado_a=?::uuid", nextAsignado);
    if (req.user?.rol !== "gerente" && nextAsignado && String(nextAsignado) !== String(req.user.id)) {
      push("visibilidad=?", "equipo");
      push("estado=?", "pendiente");
      push("metadata=COALESCE(metadata,'{}'::jsonb) || ?::jsonb", { solicitud_tarea:true, solicitada_por:req.user.id });
    }
  }
  if ("pedido_id" in body) push("pedido_id=?::uuid", cleanText(body.pedido_id));
  if ("vehiculo_id" in body) push("vehiculo_id=?::uuid", cleanText(body.vehiculo_id));
  if ("metadata" in body) push("metadata=?::jsonb", body.metadata && typeof body.metadata === "object" ? body.metadata : {});

  if (!sets.length) return res.status(400).json({ error: "Sin cambios" });
  params.push(req.params.id, empresaId(req));
  const { rows } = await db.query(
    `UPDATE agenda_eventos
        SET ${sets.join(", ")}, updated_at=NOW()
      WHERE id=$${i++} AND empresa_id=$${i}
      RETURNING *`,
    params
  );
  res.json(rows[0]);
});

router.delete("/:id", PUEDE_EDITAR, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureOwnerOrManager(req, req.params.id);
  await db.query(
    "DELETE FROM agenda_eventos WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresaId(req)]
  );
  res.json({ ok: true });
});

module.exports = router;
