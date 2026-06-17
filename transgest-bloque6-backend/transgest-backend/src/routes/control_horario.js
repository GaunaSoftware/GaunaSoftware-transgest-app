const express = require("express");
const db = require("../services/db");
const { authenticate } = require("../middleware/auth");
const { crearNotificacion } = require("../services/notificaciones");

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
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS entrada_lat NUMERIC(11,8)");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS entrada_lng NUMERIC(11,8)");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS entrada_accuracy_m NUMERIC(10,2)");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS salida_lat NUMERIC(11,8)");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS salida_lng NUMERIC(11,8)");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS salida_accuracy_m NUMERIC(10,2)");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS ubicacion_estado VARCHAR(40)");
      await db.query("ALTER TABLE oficina_fichajes ADD COLUMN IF NOT EXISTS ubicacion_distancia_m INTEGER");
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

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeGps(raw = {}) {
  const lat = numOrNull(raw.lat ?? raw.latitude);
  const lng = numOrNull(raw.lng ?? raw.lon ?? raw.longitude);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat,
    lng,
    accuracy_m: Math.max(0, Math.round(Number(raw.accuracy ?? raw.accuracy_m ?? 0) || 0)),
  };
}

function distanceMeters(a, b) {
  if (!a || !b) return null;
  const toRad = (v) => (Number(v) * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

async function getControlConfig(empresaId, client = db) {
  const { rows } = await client.query("SELECT cfg_precios FROM empresas WHERE id=$1", [empresaId]).catch(() => ({ rows: [] }));
  const cfg = rows[0]?.cfg_precios && typeof rows[0].cfg_precios === "object" ? rows[0].cfg_precios : {};
  const control = cfg.control_horario && typeof cfg.control_horario === "object" ? cfg.control_horario : {};
  const lat = numOrNull(control.base_lat);
  const lng = numOrNull(control.base_lng);
  const radio = Math.max(50, Math.round(Number(control.radio_m || 250) || 250));
  return {
    base_lat: lat,
    base_lng: lng,
    radio_m: radio,
    nombre_base: String(control.nombre_base || "Base empresa").trim() || "Base empresa",
    configurada: lat != null && lng != null,
  };
}

function evalUbicacion(gps, cfg) {
  if (!gps) return { estado: "sin_ubicacion", distancia_m: null, fuera_radio: false };
  if (!cfg?.configurada) return { estado: "sin_base_configurada", distancia_m: null, fuera_radio: false };
  const distancia = distanceMeters(gps, { lat: cfg.base_lat, lng: cfg.base_lng });
  const fuera = distancia != null && distancia > Number(cfg.radio_m || 250);
  return { estado: fuera ? "fuera_radio" : "ok", distancia_m: distancia, fuera_radio: fuera };
}

async function notificarGerenciaUbicacion({ req, usuarioNombre, accion, gps, evalGps, cfg }) {
  if (!evalGps?.fuera_radio) return;
  const empresaIdValue = empresaId(req);
  const { rows } = await db.query(
    `SELECT id FROM usuarios
      WHERE empresa_id=$1
        AND rol='gerente'
        AND activo IS DISTINCT FROM false`,
    [empresaIdValue]
  ).catch(() => ({ rows: [] }));
  const titulo = "Fichaje fuera de ubicacion";
  const mensaje = `${usuarioNombre || req.user?.nombre || "Usuario"} ha fichado ${accion} a ${evalGps.distancia_m || "?"} m de ${cfg.nombre_base || "la base"}.`;
  await Promise.all(rows.map(g => crearNotificacion({
    empresa_id: empresaIdValue,
    usuario_id: g.id,
    tipo: "control_horario_ubicacion",
    titulo,
    mensaje,
    data: {
      accion,
      usuario_id: req.user.id,
      usuario_nombre: usuarioNombre || req.user?.nombre || "",
      lat: gps?.lat,
      lng: gps?.lng,
      accuracy_m: gps?.accuracy_m,
      distancia_m: evalGps.distancia_m,
      radio_m: cfg.radio_m,
      dedupe_key: `control_horario_ubicacion:${req.user.id}:${dateOnly()}:${accion}`,
    },
    created_by: req.user.id,
  }).catch(() => null)));
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

router.get("/config", async (req, res) => {
  await ensureSchema();
  res.json(await getControlConfig(empresaId(req)));
});

router.put("/config", async (req, res) => {
  await ensureSchema();
  if (!canManage(req)) return res.status(403).json({ error: "Solo gerencia/administracion puede configurar la ubicacion de control horario." });
  const gps = normalizeGps(req.body || {});
  if (!gps) return res.status(400).json({ error: "Ubicacion GPS no valida." });
  const radio = Math.max(50, Math.round(Number(req.body?.radio_m || 250) || 250));
  const nombre = String(req.body?.nombre_base || "Base empresa").trim().slice(0, 80) || "Base empresa";
  const cfg = { base_lat: gps.lat, base_lng: gps.lng, radio_m: radio, nombre_base: nombre };
  await db.query(
    `UPDATE empresas
        SET cfg_precios=jsonb_set(COALESCE(cfg_precios,'{}'::jsonb), '{control_horario}', $1::jsonb, true)
      WHERE id=$2`,
    [JSON.stringify(cfg), empresaId(req)]
  );
  res.json({ ...cfg, configurada: true });
});

router.post("/fichar", async (req, res) => {
  await ensureSchema();
  const accion = String(req.body?.accion || "").trim().toLowerCase();
  const modalidad = ["oficina", "teletrabajo", "visita", "otro"].includes(String(req.body?.modalidad || "").toLowerCase())
    ? String(req.body.modalidad).toLowerCase()
    : "oficina";
  const ubicacion = String(req.body?.ubicacion || "").trim().slice(0, 240);
  const notas = String(req.body?.notas || "").trim().slice(0, 500);
  const gps = normalizeGps(req.body?.ubicacion_gps || req.body?.gps || req.body || {});
  if (["entrada", "salida"].includes(accion) && !gps) {
    return res.status(400).json({ error: "Activa la ubicacion del navegador para fichar entrada o salida." });
  }

  const out = await db.transaction(async (client) => {
    const cfg = await getControlConfig(empresaId(req), client);
    const evalGps = evalUbicacion(gps, cfg);
    let jornada = await getToday(req, client);
    if (!jornada && accion !== "entrada") {
      const err = new Error("Primero debes fichar entrada.");
      err.status = 409;
      throw err;
    }

    if (accion === "entrada") {
      const { rows } = await client.query(
        `INSERT INTO oficina_fichajes (empresa_id,usuario_id,fecha,entrada_at,estado,modalidad,ubicacion,notas,entrada_lat,entrada_lng,entrada_accuracy_m,ubicacion_estado,ubicacion_distancia_m)
         VALUES ($1,$2,CURRENT_DATE,NOW(),'abierto',$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (empresa_id, usuario_id, fecha) DO UPDATE
           SET entrada_at=COALESCE(oficina_fichajes.entrada_at, NOW()),
               estado=CASE WHEN oficina_fichajes.salida_at IS NULL THEN 'abierto' ELSE oficina_fichajes.estado END,
               modalidad=EXCLUDED.modalidad,
               ubicacion=COALESCE(NULLIF(EXCLUDED.ubicacion,''), oficina_fichajes.ubicacion),
               notas=COALESCE(NULLIF(EXCLUDED.notas,''), oficina_fichajes.notas),
               entrada_lat=COALESCE(oficina_fichajes.entrada_lat, EXCLUDED.entrada_lat),
               entrada_lng=COALESCE(oficina_fichajes.entrada_lng, EXCLUDED.entrada_lng),
               entrada_accuracy_m=COALESCE(oficina_fichajes.entrada_accuracy_m, EXCLUDED.entrada_accuracy_m),
               ubicacion_estado=EXCLUDED.ubicacion_estado,
               ubicacion_distancia_m=EXCLUDED.ubicacion_distancia_m,
               updated_at=NOW()
         RETURNING *`,
        [empresaId(req), req.user.id, modalidad, ubicacion, notas, gps?.lat || null, gps?.lng || null, gps?.accuracy_m || null, evalGps.estado, evalGps.distancia_m]
      );
      await logEvento(client, req, rows[0].id, req.user.id, "entrada", { modalidad, ubicacion, gps, ubicacion_estado: evalGps.estado, distancia_m: evalGps.distancia_m });
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
                salida_lat=$5,
                salida_lng=$6,
                salida_accuracy_m=$7,
                ubicacion_estado=$8,
                ubicacion_distancia_m=$9,
                updated_at=NOW()
          WHERE id=$3 AND empresa_id=$4 RETURNING *`,
        [extra, notas, jornada.id, empresaId(req), gps?.lat || null, gps?.lng || null, gps?.accuracy_m || null, evalGps.estado, evalGps.distancia_m]
      );
      await logEvento(client, req, jornada.id, req.user.id, "salida", { pausa_extra_min: extra, gps, ubicacion_estado: evalGps.estado, distancia_m: evalGps.distancia_m });
      return computeRow(rows[0]);
    }

    throw Object.assign(new Error("Accion de fichaje no valida."), { status: 400 });
  });
  if (["entrada", "salida"].includes(accion) && out?.ubicacion_estado === "fuera_radio") {
    const cfg = await getControlConfig(empresaId(req));
    await notificarGerenciaUbicacion({
      req,
      usuarioNombre: req.user?.nombre || out?.usuario_nombre || "",
      accion,
      gps,
      evalGps: { fuera_radio: true, distancia_m: Number(out.ubicacion_distancia_m || 0) || null },
      cfg,
    });
  }
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
            f.estado, f.modalidad, f.ubicacion, f.ubicacion_estado, f.ubicacion_distancia_m,
            f.entrada_lat, f.entrada_lng, f.salida_lat, f.salida_lng, f.notas
       FROM oficina_fichajes f JOIN usuarios u ON u.id=f.usuario_id
      WHERE f.empresa_id=$1 AND f.fecha BETWEEN $2 AND $3
      ORDER BY f.fecha DESC, u.nombre`,
    [empresaId(req), desde, hasta]
  );
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["fecha","usuario","email","rol","entrada","salida","pausa_min","trabajado_min","estado","modalidad","ubicacion","ubicacion_estado","distancia_base_m","entrada_lat","entrada_lng","salida_lat","salida_lng","notas"].map(esc).join(";"),
    ...rows.map(r => [r.fecha, r.nombre, r.email, r.rol, r.entrada_at, r.salida_at, r.pausa_total_min, r.trabajado_min, r.estado, r.modalidad, r.ubicacion, r.ubicacion_estado, r.ubicacion_distancia_m, r.entrada_lat, r.entrada_lng, r.salida_lat, r.salida_lng, r.notas].map(esc).join(";")),
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="control-horario-${desde}-${hasta}.csv"`);
  res.send(`\ufeff${csv}`);
});

module.exports = router;
