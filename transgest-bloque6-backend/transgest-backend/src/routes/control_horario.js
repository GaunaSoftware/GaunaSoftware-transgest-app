const express = require("express");
const db = require("../services/db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS oficina_fichajes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        fecha DATE NOT NULL DEFAULT CURRENT_DATE,
        entrada_at TIMESTAMPTZ,
        salida_at TIMESTAMPTZ,
        pausa_inicio_at TIMESTAMPTZ,
        pausa_total_min INTEGER NOT NULL DEFAULT 0,
        estado VARCHAR(30) NOT NULL DEFAULT 'abierto',
        modalidad VARCHAR(30) NOT NULL DEFAULT 'oficina',
        ubicacion TEXT,
        notas TEXT,
        ajuste_motivo TEXT,
        ajustado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (empresa_id, usuario_id, fecha)
      )
    `).then(async () => {
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS pausa_inicio_at TIMESTAMPTZ");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS pausa_total_min INTEGER NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS modalidad VARCHAR(30) NOT NULL DEFAULT 'oficina'");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS ubicacion TEXT");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS ajuste_motivo TEXT");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS ajustado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL");
      await db.query("CREATE INDEX IF NOT EXISTS idx_oficina_fichajes_empresa_fecha ON oficina_fichajes(empresa_id, fecha DESC)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_oficina_fichajes_usuario_fecha ON oficina_fichajes(usuario_id, fecha DESC)");
      await db.query(`
        CREATE TABLE IF NOT EXISTS oficina_fichaje_eventos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          fichaje_id UUID REFERENCES oficina_fichajes(id) ON DELETE CASCADE,
          usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          actor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          tipo VARCHAR(60) NOT NULL,
          detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_oficina_fichaje_eventos_fichaje ON oficina_fichaje_eventos(fichaje_id, created_at DESC)");
    }).catch(err => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id;
}

function canManage(req) {
  return ["gerente", "contable", "administrativo"].includes(req.user?.rol);
}

function dateOnly(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function minutesBetween(a, b) {
  const da = a ? new Date(a) : null;
  const dbb = b ? new Date(b) : null;
  if (!da || !dbb || Number.isNaN(da.getTime()) || Number.isNaN(dbb.getTime())) return 0;
  return Math.max(0, Math.round((dbb - da) / 60000));
}

function computeRow(row = {}) {
  const now = new Date();
  const pausaLive = row.pausa_inicio_at && !row.salida_at ? minutesBetween(row.pausa_inicio_at, now) : 0;
  const totalPausa = Number(row.pausa_total_min || 0) + pausaLive;
  const fin = row.salida_at || now;
  const bruto = row.entrada_at ? minutesBetween(row.entrada_at, fin) : 0;
  const trabajado = Math.max(0, bruto - totalPausa);
  return {
    ...row,
    pausa_total_live_min: totalPausa,
    bruto_min: bruto,
    trabajado_min: trabajado,
    abierto: row.estado !== "cerrado",
    en_pausa: Boolean(row.pausa_inicio_at && !row.salida_at),
  };
}

async function logEvento(client, req, fichajeId, usuarioId, tipo, detalle = {}) {
  await client.query(
    `INSERT INTO oficina_fichaje_eventos (empresa_id,fichaje_id,usuario_id,actor_id,tipo,detalle)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [empresaId(req), fichajeId, usuarioId, req.user?.id || null, tipo, JSON.stringify(detalle || {})]
  ).catch(() => {});
}

async function getToday(req, client = db) {
  const { rows } = await client.query(
    `SELECT f.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol AS usuario_rol
       FROM oficina_fichajes f
       JOIN usuarios u ON u.id=f.usuario_id
      WHERE f.empresa_id=$1 AND f.usuario_id=$2 AND f.fecha=CURRENT_DATE`,
    [empresaId(req), req.user.id]
  );
  return rows[0] ? computeRow(rows[0]) : null;
}

router.get("/mi-jornada", async (req, res) => {
  await ensureSchema();
  res.json(await getToday(req));
});

router.post("/fichar", async (req, res) => {
  await ensureSchema();
  const accion = String(req.body?.accion || "").trim().toLowerCase();
  const modalidad = ["oficina", "teletrabajo", "visita", "otro"].includes(String(req.body?.modalidad || "").toLowerCase())
    ? String(req.body.modalidad).toLowerCase()
    : "oficina";
  const ubicacion = String(req.body?.ubicacion || "").trim().slice(0, 240);
  const notas = String(req.body?.notas || "").trim().slice(0, 500);

  const out = await db.transaction(async (client) => {
    let jornada = await getToday(req, client);
    if (!jornada && accion !== "entrada") {
      const err = new Error("Primero debes fichar entrada.");
      err.status = 409;
      throw err;
    }

    if (accion === "entrada") {
      const { rows } = await client.query(
        `INSERT INTO oficina_fichajes (empresa_id,usuario_id,fecha,entrada_at,estado,modalidad,ubicacion,notas)
         VALUES ($1,$2,CURRENT_DATE,NOW(),'abierto',$3,$4,$5)
         ON CONFLICT (empresa_id, usuario_id, fecha) DO UPDATE
           SET entrada_at=COALESCE(oficina_fichajes.entrada_at, NOW()),
               estado=CASE WHEN oficina_fichajes.salida_at IS NULL THEN 'abierto' ELSE oficina_fichajes.estado END,
               modalidad=EXCLUDED.modalidad,
               ubicacion=COALESCE(NULLIF(EXCLUDED.ubicacion,''), oficina_fichajes.ubicacion),
               notas=COALESCE(NULLIF(EXCLUDED.notas,''), oficina_fichajes.notas),
               updated_at=NOW()
         RETURNING *`,
        [empresaId(req), req.user.id, modalidad, ubicacion, notas]
      );
      await logEvento(client, req, rows[0].id, req.user.id, "entrada", { modalidad, ubicacion });
      return computeRow(rows[0]);
    }

    if (accion === "pausa") {
      if (jornada.salida_at) throw Object.assign(new Error("La jornada ya esta cerrada."), { status: 409 });
      if (jornada.pausa_inicio_at) throw Object.assign(new Error("Ya hay una pausa activa."), { status: 409 });
      const { rows } = await client.query(
        `UPDATE oficina_fichajes SET pausa_inicio_at=NOW(), updated_at=NOW()
          WHERE id=$1 AND empresa_id=$2 RETURNING *`,
        [jornada.id, empresaId(req)]
      );
      await logEvento(client, req, jornada.id, req.user.id, "pausa_inicio", {});
      return computeRow(rows[0]);
    }

    if (accion === "reanudar") {
      if (!jornada.pausa_inicio_at) throw Object.assign(new Error("No hay pausa activa."), { status: 409 });
      const extra = minutesBetween(jornada.pausa_inicio_at, new Date());
      const { rows } = await client.query(
        `UPDATE oficina_fichajes
            SET pausa_total_min=pausa_total_min+$1, pausa_inicio_at=NULL, updated_at=NOW()
          WHERE id=$2 AND empresa_id=$3 RETURNING *`,
        [extra, jornada.id, empresaId(req)]
      );
      await logEvento(client, req, jornada.id, req.user.id, "pausa_fin", { minutos: extra });
      return computeRow(rows[0]);
    }

    if (accion === "salida") {
      let extra = 0;
      if (jornada.pausa_inicio_at) extra = minutesBetween(jornada.pausa_inicio_at, new Date());
      const { rows } = await client.query(
        `UPDATE oficina_fichajes
            SET salida_at=NOW(),
                pausa_total_min=pausa_total_min+$1,
                pausa_inicio_at=NULL,
                estado='cerrado',
                notas=COALESCE(NULLIF($2,''), notas),
                updated_at=NOW()
          WHERE id=$3 AND empresa_id=$4 RETURNING *`,
        [extra, notas, jornada.id, empresaId(req)]
      );
      await logEvento(client, req, jornada.id, req.user.id, "salida", { pausa_extra_min: extra });
      return computeRow(rows[0]);
    }

    throw Object.assign(new Error("Accion de fichaje no valida."), { status: 400 });
  });
  res.json(out);
});

router.get("/", async (req, res) => {
  await ensureSchema();
  const eid = empresaId(req);
  const usuarioId = canManage(req) ? (req.query.usuario_id || null) : req.user.id;
  const desde = req.query.desde || dateOnly(new Date(Date.now() - 30 * 86400000));
  const hasta = req.query.hasta || dateOnly(new Date());
  const params = [eid, desde, hasta];
  const where = ["f.empresa_id=$1", "f.fecha BETWEEN $2 AND $3"];
  if (usuarioId) {
    params.push(usuarioId);
    where.push(`f.usuario_id=$${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT f.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol AS usuario_rol
       FROM oficina_fichajes f
       JOIN usuarios u ON u.id=f.usuario_id
      WHERE ${where.join(" AND ")}
      ORDER BY f.fecha DESC, u.nombre ASC`,
    params
  );
  res.json(rows.map(computeRow));
});

router.get("/resumen", async (req, res) => {
  await ensureSchema();
  const eid = empresaId(req);
  const desde = req.query.desde || dateOnly(new Date(Date.now() - 30 * 86400000));
  const hasta = req.query.hasta || dateOnly(new Date());
  const params = [eid, desde, hasta];
  const userFilter = canManage(req) ? req.query.usuario_id : req.user.id;
  let extra = "";
  if (userFilter) {
    params.push(userFilter);
    extra = ` AND f.usuario_id=$${params.length}`;
  }
  const [resumen, porUsuario, abiertos] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS jornadas,
              COUNT(*) FILTER (WHERE estado<>'cerrado')::int AS abiertas,
              COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(salida_at,NOW())-entrada_at))/60 - pausa_total_min),0)::int AS trabajado_min,
              COALESCE(SUM(pausa_total_min),0)::int AS pausa_min
         FROM oficina_fichajes f
        WHERE f.empresa_id=$1 AND f.fecha BETWEEN $2 AND $3${extra}`,
      params
    ),
    db.query(
      `SELECT u.id AS usuario_id, u.nombre, u.email, u.rol,
              COUNT(f.id)::int AS jornadas,
              COUNT(f.id) FILTER (WHERE f.estado<>'cerrado')::int AS abiertas,
              COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(f.salida_at,NOW())-f.entrada_at))/60 - f.pausa_total_min),0)::int AS trabajado_min
         FROM usuarios u
         LEFT JOIN oficina_fichajes f ON f.usuario_id=u.id AND f.empresa_id=u.empresa_id AND f.fecha BETWEEN $2 AND $3
        WHERE u.empresa_id=$1 AND u.rol NOT IN ('chofer','cliente','cliente_portal') AND u.activo IS DISTINCT FROM false
        GROUP BY u.id,u.nombre,u.email,u.rol
        ORDER BY u.nombre`,
      [eid, desde, hasta]
    ),
    db.query(
      `SELECT f.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol AS usuario_rol
         FROM oficina_fichajes f JOIN usuarios u ON u.id=f.usuario_id
        WHERE f.empresa_id=$1 AND f.estado<>'cerrado'
        ORDER BY f.entrada_at ASC`,
      [eid]
    ),
  ]);
  res.json({
    desde,
    hasta,
    resumen: resumen.rows[0] || {},
    por_usuario: porUsuario.rows,
    abiertas: abiertos.rows.map(computeRow),
  });
});

router.put("/:id", async (req, res) => {
  await ensureSchema();
  if (!canManage(req)) return res.status(403).json({ error: "Solo gerencia/administracion puede ajustar fichajes." });
  const motivo = String(req.body?.motivo || "").trim();
  if (!motivo) return res.status(400).json({ error: "Indica un motivo de ajuste." });
  const fields = [];
  const values = [];
  const add = (field, value) => {
    if (value === undefined) return;
    values.push(value || null);
    fields.push(`${field}=$${values.length}`);
  };
  add("entrada_at", req.body.entrada_at);
  add("salida_at", req.body.salida_at);
  if (req.body.pausa_total_min !== undefined) add("pausa_total_min", Math.max(0, Math.round(Number(req.body.pausa_total_min) || 0)));
  add("modalidad", req.body.modalidad);
  add("ubicacion", req.body.ubicacion);
  add("notas", req.body.notas);
  if (!fields.length) return res.status(400).json({ error: "No hay campos para ajustar." });
  values.push(motivo, req.user.id, req.params.id, empresaId(req));
  const { rows } = await db.query(
    `UPDATE oficina_fichajes
        SET ${fields.join(", ")}, ajuste_motivo=$${values.length - 3}, ajustado_por=$${values.length - 2}, updated_at=NOW()
      WHERE id=$${values.length - 1} AND empresa_id=$${values.length}
      RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: "Fichaje no encontrado." });
  await db.transaction((client) => logEvento(client, req, rows[0].id, rows[0].usuario_id, "ajuste_manual", { motivo }));
  res.json(computeRow(rows[0]));
});

router.get("/export.csv", async (req, res) => {
  await ensureSchema();
  if (!canManage(req)) return res.status(403).json({ error: "No tienes permisos para exportar control horario." });
  const desde = req.query.desde || dateOnly(new Date(Date.now() - 30 * 86400000));
  const hasta = req.query.hasta || dateOnly(new Date());
  const { rows } = await db.query(
    `SELECT f.fecha, u.nombre, u.email, u.rol, f.entrada_at, f.salida_at, f.pausa_total_min,
            GREATEST(0, ROUND(EXTRACT(EPOCH FROM (COALESCE(f.salida_at,NOW())-f.entrada_at))/60 - f.pausa_total_min))::int AS trabajado_min,
            f.estado, f.modalidad, f.ubicacion, f.notas
       FROM oficina_fichajes f JOIN usuarios u ON u.id=f.usuario_id
      WHERE f.empresa_id=$1 AND f.fecha BETWEEN $2 AND $3
      ORDER BY f.fecha DESC, u.nombre`,
    [empresaId(req), desde, hasta]
  );
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["fecha","usuario","email","rol","entrada","salida","pausa_min","trabajado_min","estado","modalidad","ubicacion","notas"].map(esc).join(";"),
    ...rows.map(r => [r.fecha, r.nombre, r.email, r.rol, r.entrada_at, r.salida_at, r.pausa_total_min, r.trabajado_min, r.estado, r.modalidad, r.ubicacion, r.notas].map(esc).join(";")),
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="control-horario-${desde}-${hasta}.csv"`);
  res.send(`\ufeff${csv}`);
});

module.exports = router;
