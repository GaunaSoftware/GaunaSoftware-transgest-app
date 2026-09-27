const express = require("express");
const db = require("../services/db");
const { authenticate } = require("../middleware/auth");
const { crearNotificacion } = require("../services/notificaciones");
const { userForCompany } = require("../services/companyMembership");
const { OFFICE_ROLES, isOfficeEmployee, canManageAttendance, attendanceDay: dateOnly, attendancePeriod, schedule, fail } = require("../services/officeAttendancePolicy");

const router = express.Router();
router.use(authenticate);
router.use((req, res, next) => {
  if (!isOfficeEmployee(req.user)) return res.status(403).json({ error: "Control horario de oficina solo está disponible para personal interno autorizado." });
  next();
});

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
      await db.query(`
        CREATE TABLE IF NOT EXISTS oficina_teletrabajo_solicitudes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          fecha DATE NOT NULL,
          motivo TEXT,
          estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
          resuelto_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          resuelto_at TIMESTAMPTZ,
          comentario_resolucion TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_teletrabajo_empresa_estado ON oficina_teletrabajo_solicitudes(empresa_id, estado, fecha)").catch(() => {});
      await db.query(`
        CREATE TABLE IF NOT EXISTS oficina_jornada_config (
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          hora_entrada VARCHAR(5) NOT NULL DEFAULT '08:00',
          hora_salida VARCHAR(5) NOT NULL DEFAULT '17:00',
          pausa_min INTEGER NOT NULL DEFAULT 60,
          extras_requieren_aprobacion BOOLEAN NOT NULL DEFAULT true,
          updated_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (empresa_id, usuario_id)
        )
      `);
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
  return canManageAttendance(req.user);
}

async function officeUser(req, id, client = db) {
  const user = await userForCompany(id, empresaId(req), client);
  if (!user || !isOfficeEmployee(user)) fail("Empleado no encontrado en esta empresa.", 404);
  return user;
}

function minutesBetween(a, b) {
  const da = a ? new Date(a) : null;
  const dbb = b ? new Date(b) : null;
  if (!da || !dbb || Number.isNaN(da.getTime()) || Number.isNaN(dbb.getTime())) return 0;
  return Math.max(0, Math.floor((dbb - da) / 60000));
}

function numOrNull(value) {
  if (value == null || value === "") return null;
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
    `SELECT u.id FROM usuarios u JOIN usuario_empresas m ON m.usuario_id=u.id
      WHERE m.empresa_id=$1 AND m.rol='gerente' AND m.activo=true AND u.activo=true`,
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

async function notificarGerentes(req, { tipo, titulo, mensaje, data = {} }) {
  const empresaIdValue = empresaId(req);
  const { rows } = await db.query(
    `SELECT u.id FROM usuarios u JOIN usuario_empresas m ON m.usuario_id=u.id
      WHERE m.empresa_id=$1 AND m.rol='gerente' AND m.activo=true AND u.activo=true`,
    [empresaIdValue]
  ).catch(() => ({ rows: [] }));
  await Promise.all(rows.map(g => crearNotificacion({
    empresa_id: empresaIdValue,
    usuario_id: g.id,
    tipo,
    titulo,
    mensaje,
    data,
    created_by: req.user?.id || null,
  }).catch(() => null)));
}

async function getJornadaConfigForUsuario(req, usuarioId, client = db) {
  const { rows } = await client.query(
    `SELECT pausa_min
       FROM oficina_jornada_config
      WHERE empresa_id=$1 AND usuario_id=$2
      LIMIT 1`,
    [empresaId(req), usuarioId]
  ).catch(() => ({ rows: [] }));
  return { pausa_min: Math.max(0, Number(rows[0]?.pausa_min ?? 60)) };
}

async function notificarGerenciaDescansoExcedido(req, jornada, accion) {
  if (!jornada?.id) return;
  const cfg = await getJornadaConfigForUsuario(req, jornada.usuario_id || req.user.id);
  const totalPausa = Number(jornada.pausa_total_live_min ?? jornada.pausa_total_min ?? 0) || 0;
  const limite = Number(cfg.pausa_min || 0) || 0;
  if (!limite || totalPausa <= limite) return;
  const exceso = Math.max(0, totalPausa - limite);
  await notificarGerentes(req, {
    tipo: "control_horario_descanso_excedido",
    titulo: "Descanso excedido",
    mensaje: `${jornada.usuario_nombre || req.user?.nombre || req.user?.email || "Empleado"} ha superado el descanso previsto en ${exceso} min.`,
    data: {
      fichaje_id: jornada.id,
      usuario_id: jornada.usuario_id || req.user.id,
      usuario_nombre: jornada.usuario_nombre || req.user?.nombre || "",
      accion,
      pausa_total_min: totalPausa,
      pausa_limite_min: limite,
      exceso_min: exceso,
      dedupe_key: `control_horario_descanso:${jornada.id}`,
    },
  });
}

function computeRow(row = {}, now = new Date()) {
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
  );
}

async function getToday(req, client = db) {
  const today = dateOnly();
  const { rows } = await client.query(
    `SELECT f.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol AS usuario_rol
       FROM oficina_fichajes f
       JOIN usuarios u ON u.id=f.usuario_id
      WHERE f.empresa_id=$1 AND f.usuario_id=$2
        AND (f.fecha=$3::date OR (f.entrada_at IS NOT NULL AND f.salida_at IS NULL AND f.estado<>'cerrado'))
      ORDER BY (f.salida_at IS NULL AND f.estado<>'cerrado') DESC, f.fecha DESC LIMIT 1 ${client === db ? "" : "FOR UPDATE OF f"}`,
    [empresaId(req), req.user.id, today]
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
  if (!canManage(req)) return res.status(403).json({ error: "Solo gerencia puede configurar la ubicación de control horario." });
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

router.get("/teletrabajo", async (req, res) => {
  await ensureSchema();
  const eid = empresaId(req);
  const { desde, hasta } = attendancePeriod({ ...req.query, hasta: req.query.hasta ?? new Date(Date.now() + 366 * 86400000) });
  const params = [eid, desde, hasta];
  const where = ["s.empresa_id=$1", "s.fecha BETWEEN $2 AND $3"];
  if (!canManage(req)) {
    params.push(req.user.id);
    where.push(`s.usuario_id=$${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT s.*, u.nombre AS usuario_nombre, u.email AS usuario_email, r.nombre AS resuelto_por_nombre
       FROM oficina_teletrabajo_solicitudes s
       JOIN usuarios u ON u.id=s.usuario_id
       LEFT JOIN usuarios r ON r.id=s.resuelto_por
      WHERE ${where.join(" AND ")}
      ORDER BY s.fecha DESC, s.created_at DESC`,
    params
  );
  res.json(rows);
});

router.post("/teletrabajo", async (req, res) => {
  await ensureSchema();
  if (!req.body?.fecha) fail("Indica el día solicitado.");
  const fecha = dateOnly(req.body.fecha);
  const motivo = String(req.body?.motivo || "").trim().slice(0, 500);
  const out = await db.transaction(async client => {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`remote-work:${empresaId(req)}:${req.user.id}`]);
  if ((await client.query("SELECT id FROM oficina_teletrabajo_solicitudes WHERE empresa_id=$1 AND usuario_id=$2 AND fecha=$3 AND estado IN ('pendiente','aprobada')", [empresaId(req), req.user.id, fecha])).rows.length) fail("Ya existe una solicitud pendiente o aprobada para ese día.", 409);
  const { rows } = await client.query(
    `INSERT INTO oficina_teletrabajo_solicitudes (empresa_id,usuario_id,fecha,motivo)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [empresaId(req), req.user.id, fecha, motivo]
  );
  await logEvento(client, req, null, req.user.id, "teletrabajo_solicitado", { solicitud: rows[0] });
  return rows[0];
  });
  await notificarGerentes(req, {
    tipo: "teletrabajo_solicitud",
    titulo: "Solicitud de teletrabajo",
    mensaje: `${req.user?.nombre || req.user?.email || "Empleado"} solicita teletrabajar el ${fecha}.`,
    data: { solicitud_id: out.id, fecha, usuario_id: req.user.id, dedupe_key: `teletrabajo:${out.id}` },
  });
  res.status(201).json(out);
});

router.patch("/teletrabajo/:id", async (req, res) => {
  await ensureSchema();
  if (!canManage(req)) return res.status(403).json({ error: "Solo gerencia puede resolver teletrabajo." });
  const estado = String(req.body?.estado || "").toLowerCase();
  if (!["aprobada", "rechazada"].includes(estado)) return res.status(400).json({ error: "Estado no valido." });
  const comentario = String(req.body?.comentario || "").trim().slice(0, 500);
  const out = await db.transaction(async client => {
  const { rows } = await client.query(
    `UPDATE oficina_teletrabajo_solicitudes
        SET estado=$1, comentario_resolucion=$2, resuelto_por=$3, resuelto_at=NOW(), updated_at=NOW()
      WHERE id=$4 AND empresa_id=$5 AND estado='pendiente'
      RETURNING *`,
    [estado, comentario, req.user.id, req.params.id, empresaId(req)]
  );
  if (!rows[0]) fail("Solicitud no encontrada o ya resuelta.", 404);
  await logEvento(client, req, null, rows[0].usuario_id, "teletrabajo_resuelto", { solicitud: rows[0] });
  return rows[0];
  });
  await crearNotificacion({
    empresa_id: empresaId(req),
    usuario_id: out.usuario_id,
    tipo: "teletrabajo_resuelta",
    titulo: estado === "aprobada" ? "Teletrabajo aprobado" : "Teletrabajo rechazado",
    mensaje: `Tu solicitud de teletrabajo del ${dateOnly(out.fecha)} ha sido ${estado}.`,
    data: { solicitud_id: out.id, estado, comentario },
    created_by: req.user.id,
  }).catch(() => null);
  res.json(out);
});

router.get("/vacaciones", async (req, res) => {
  await ensureSchema();
  const { desde, hasta } = attendancePeriod({ ...req.query, hasta: req.query.hasta ?? new Date(Date.now() + 366 * 86400000) });
  const { rows } = await db.query(
    `SELECT s.*, u.nombre AS usuario_nombre, r.nombre AS resuelto_por_nombre
       FROM oficina_vacaciones_solicitudes s JOIN usuarios u ON u.id=s.usuario_id
       LEFT JOIN usuarios r ON r.id=s.resuelto_por
      WHERE s.empresa_id=$1 AND s.hasta >= $2 AND s.desde <= $3
        AND ($4::uuid IS NULL OR s.usuario_id=$4) ORDER BY s.desde DESC, s.created_at DESC`,
    [empresaId(req), desde, hasta, canManage(req) ? (req.query.usuario_id || null) : req.user.id]
  );
  res.json(rows);
});

router.post("/vacaciones", async (req, res) => {
  await ensureSchema();
  if (!req.body?.desde || !req.body?.hasta) fail("Indica las fechas de vacaciones.");
  const { desde, hasta } = attendancePeriod(req.body);
  const motivo = String(req.body.motivo || "").trim().slice(0, 500);
  const out = await db.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`vacations:${empresaId(req)}:${req.user.id}`]);
    const overlap = await client.query("SELECT id FROM oficina_vacaciones_solicitudes WHERE empresa_id=$1 AND usuario_id=$2 AND estado IN ('pendiente','aprobada') AND hasta >= $3 AND desde <= $4", [empresaId(req), req.user.id, desde, hasta]);
    if (overlap.rows.length) fail("Ya existe una solicitud pendiente o aprobada para esas fechas.", 409);
    const row = (await client.query("INSERT INTO oficina_vacaciones_solicitudes(empresa_id,usuario_id,desde,hasta,motivo) VALUES($1,$2,$3,$4,$5) RETURNING *", [empresaId(req), req.user.id, desde, hasta, motivo])).rows[0];
    await logEvento(client, req, null, req.user.id, "vacaciones_solicitadas", { solicitud: row });
    return row;
  });
  await notificarGerentes(req, { tipo: "vacaciones_oficina_solicitud", titulo: "Solicitud de vacaciones", mensaje: `${req.user.nombre || "Empleado"} solicita vacaciones del ${desde} al ${hasta}.`, data: { solicitud_id: out.id } });
  res.status(201).json(out);
});

router.patch("/vacaciones/:id", async (req, res) => {
  await ensureSchema();
  if (!canManage(req)) return res.status(403).json({ error: "Solo gerencia puede resolver vacaciones." });
  const estado = req.body?.estado;
  if (!["aprobada", "rechazada"].includes(estado)) fail("Estado no válido.");
  const comentario = String(req.body?.comentario || "").trim().slice(0, 500);
  const out = await db.transaction(async client => {
    const row = (await client.query(`UPDATE oficina_vacaciones_solicitudes SET estado=$1,comentario_resolucion=$2,resuelto_por=$3,resuelto_at=NOW(),updated_at=NOW()
      WHERE id=$4 AND empresa_id=$5 AND estado='pendiente' RETURNING *`, [estado, comentario, req.user.id, req.params.id, empresaId(req)])).rows[0];
    if (!row) fail("Solicitud no encontrada o ya resuelta.", 404);
    await logEvento(client, req, null, row.usuario_id, "vacaciones_resueltas", { solicitud: row });
    return row;
  });
  await crearNotificacion({ empresa_id: empresaId(req), usuario_id: out.usuario_id, tipo: "vacaciones_oficina_resuelta", titulo: "Solicitud de vacaciones resuelta", mensaje: `Tu solicitud del ${dateOnly(out.desde)} al ${dateOnly(out.hasta)} ha sido ${estado}.`, data: { solicitud_id: out.id, estado, comentario }, created_by: req.user.id }).catch(() => null);
  res.json(out);
});

router.get("/jornada-config", async (req, res) => {
  await ensureSchema();
  const usuarioId = canManage(req) && req.query.usuario_id ? req.query.usuario_id : req.user.id;
  const employee = await officeUser(req, usuarioId);
  const { rows } = await db.query(
    `SELECT * FROM oficina_jornada_config WHERE empresa_id=$1 AND usuario_id=$2`,
    [empresaId(req), usuarioId]
  );
  const row = rows[0] || {};
  res.json({
    usuario_id: usuarioId,
    usuario_nombre: employee.nombre || "",
    hora_entrada: row.hora_entrada || "08:00",
    hora_salida: row.hora_salida || "17:00",
    pausa_min: Number(row.pausa_min ?? 60),
    extras_requieren_aprobacion: row.extras_requieren_aprobacion !== false,
  });
});

router.put("/jornada-config", async (req, res) => {
  await ensureSchema();
  if (!canManage(req)) return res.status(403).json({ error: "Solo gerencia puede modificar la jornada prevista." });
  const usuarioId = req.body?.usuario_id || req.user.id;
  await officeUser(req, usuarioId);
  const { entrada, salida, pausa, extras } = schedule(req.body);
  const out = await db.transaction(async client => {
  const before = (await client.query("SELECT * FROM oficina_jornada_config WHERE empresa_id=$1 AND usuario_id=$2 FOR UPDATE", [empresaId(req), usuarioId])).rows[0] || null;
  const { rows } = await client.query(
    `INSERT INTO oficina_jornada_config
      (empresa_id,usuario_id,hora_entrada,hora_salida,pausa_min,extras_requieren_aprobacion,updated_by,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (empresa_id, usuario_id) DO UPDATE SET
      hora_entrada=EXCLUDED.hora_entrada,
      hora_salida=EXCLUDED.hora_salida,
      pausa_min=EXCLUDED.pausa_min,
      extras_requieren_aprobacion=EXCLUDED.extras_requieren_aprobacion,
      updated_by=EXCLUDED.updated_by,
      updated_at=NOW()
     RETURNING *`,
    [empresaId(req), usuarioId, entrada, salida, pausa, extras, req.user.id]
  );
  await logEvento(client, req, null, usuarioId, "jornada_config", { antes: before, despues: rows[0] });
  return rows[0];
  });
  res.json(out);
});

router.post("/fichar", async (req, res) => {
  await ensureSchema();
  const accion = String(req.body?.accion || "").trim().toLowerCase();
  if (!["entrada", "pausa", "reanudar", "salida"].includes(accion)) fail("Acción de fichaje no válida.");
  const modalidad = ["oficina", "teletrabajo", "visita", "otro"].includes(String(req.body?.modalidad || "").toLowerCase())
    ? String(req.body.modalidad).toLowerCase()
    : "oficina";
  const ubicacion = String(req.body?.ubicacion || "").trim().slice(0, 240);
  const notas = String(req.body?.notas || "").trim().slice(0, 500);
  const gps = normalizeGps(req.body?.ubicacion_gps || req.body?.gps || req.body || {});

  const out = await db.transaction(async (client) => {
    // Serialize each employee, including the first entry when no row exists yet.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`attendance:${empresaId(req)}:${req.user.id}`]);
    const cfg = await getControlConfig(empresaId(req), client);
    const evalGps = evalUbicacion(gps, cfg);
    let jornada = await getToday(req, client);
    if (!jornada && accion !== "entrada") {
      const err = new Error("Primero debes fichar entrada.");
      err.status = 409;
      throw err;
    }

    if (accion === "entrada") {
      if (jornada?.salida_at || jornada?.estado === "cerrado") {
        const err = new Error("La jornada de hoy ya esta cerrada. Solicita un ajuste si necesitas corregirla.");
        err.status = 409;
        throw err;
      }
      if (jornada?.entrada_at && !jornada?.salida_at) {
        return jornada;
      }
      if (modalidad === "teletrabajo") {
        const approved = await client.query("SELECT id FROM oficina_teletrabajo_solicitudes WHERE empresa_id=$1 AND usuario_id=$2 AND fecha=$3 AND estado='aprobada' LIMIT 1", [empresaId(req), req.user.id, dateOnly()]);
        if (!approved.rows.length) fail("Solicita teletrabajo y espera la aprobación de gerencia antes de fichar en esta modalidad.", 409);
      }
      const { rows } = await client.query(
        `INSERT INTO oficina_fichajes (empresa_id,usuario_id,fecha,entrada_at,estado,modalidad,ubicacion,notas,entrada_lat,entrada_lng,entrada_accuracy_m,ubicacion_estado,ubicacion_distancia_m)
         VALUES ($1,$2,$11::date,NOW(),'abierto',$3,$4,$5,$6,$7,$8,$9,$10)
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
        [empresaId(req), req.user.id, modalidad, ubicacion, notas, gps?.lat ?? null, gps?.lng ?? null, gps?.accuracy_m ?? null, evalGps.estado, evalGps.distancia_m, dateOnly()]
      );
      await logEvento(client, req, rows[0].id, req.user.id, "entrada", { modalidad, ubicacion, gps, ubicacion_estado: evalGps.estado, distancia_m: evalGps.distancia_m });
      return computeRow(rows[0]);
    }

    if (jornada.salida_at || jornada.estado === "cerrado") {
      if (accion === "salida") return jornada; // Retries cannot rewrite the original clock-out.
      fail("La jornada ya está cerrada.", 409);
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
        [extra, notas, jornada.id, empresaId(req), gps?.lat ?? null, gps?.lng ?? null, gps?.accuracy_m ?? null, evalGps.estado, evalGps.distancia_m]
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
  if (["reanudar", "salida"].includes(accion)) {
    await notificarGerenciaDescansoExcedido(req, out, accion);
  }
  res.json(out);
});

router.get("/", async (req, res) => {
  await ensureSchema();
  const eid = empresaId(req);
  const usuarioId = canManage(req) ? (req.query.usuario_id || null) : req.user.id;
  const { desde, hasta } = attendancePeriod(req.query);
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
  res.json(rows.map(row => computeRow(row)));
});

router.get("/resumen", async (req, res) => {
  await ensureSchema();
  const eid = empresaId(req);
  const { desde, hasta } = attendancePeriod(req.query);
  const userFilter = canManage(req) ? (req.query.usuario_id || null) : req.user.id;
  const [records, users, abiertos] = await Promise.all([
    db.query(
      `SELECT * FROM oficina_fichajes f
        WHERE f.empresa_id=$1 AND f.fecha BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR f.usuario_id=$4)`,
      [eid, desde, hasta, userFilter]
    ),
    db.query(
      `SELECT u.id AS usuario_id, u.nombre, u.email, m.rol
         FROM usuarios u JOIN usuario_empresas m ON m.usuario_id=u.id
        WHERE m.empresa_id=$1 AND m.activo=true AND u.activo=true AND m.rol=ANY($3::text[])
          AND ($2::uuid IS NULL OR u.id=$2) ORDER BY u.nombre`,
      [eid, userFilter, OFFICE_ROLES]
    ),
    db.query(
      `SELECT f.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol AS usuario_rol
         FROM oficina_fichajes f JOIN usuarios u ON u.id=f.usuario_id
        WHERE f.empresa_id=$1 AND f.estado<>'cerrado' AND ($2::uuid IS NULL OR f.usuario_id=$2)
        ORDER BY f.entrada_at ASC`,
      [eid, userFilter]
    ),
  ]);
  const rows = records.rows.map(row => computeRow(row));
  const total = list => list.reduce((sum, row) => ({
    jornadas: sum.jornadas + 1, abiertas: sum.abiertas + Number(row.abierto),
    trabajado_min: sum.trabajado_min + row.trabajado_min, pausa_min: sum.pausa_min + row.pausa_total_live_min,
  }), { jornadas: 0, abiertas: 0, trabajado_min: 0, pausa_min: 0 });
  res.json({
    desde,
    hasta,
    resumen: total(rows),
    por_usuario: users.rows.map(user => ({ ...user, ...total(rows.filter(row => row.usuario_id === user.usuario_id)) })),
    abiertas: abiertos.rows.map(row => computeRow(row)),
  });
});

router.put("/:id", async (req, res) => {
  await ensureSchema();
  if (!canManage(req)) return res.status(403).json({ error: "Solo gerencia puede ajustar fichajes." });
  const motivo = String(req.body?.motivo || "").trim();
  if (!motivo) return res.status(400).json({ error: "Indica un motivo de ajuste." });
  const fields = [];
  const values = [];
  const add = (field, value) => {
    if (value === undefined) return;
    values.push(value === "" ? null : value);
    fields.push(`${field}=$${values.length}`);
  };
  add("entrada_at", req.body.entrada_at);
  add("salida_at", req.body.salida_at);
  if (req.body.pausa_total_min !== undefined) {
    const pause = numOrNull(req.body.pausa_total_min);
    if (!Number.isInteger(pause) || pause < 0) fail("Indica una pausa válida en minutos.");
    add("pausa_total_min", pause);
  }
  add("modalidad", req.body.modalidad);
  add("ubicacion", req.body.ubicacion);
  add("notas", req.body.notas);
  if (!fields.length) return res.status(400).json({ error: "No hay campos para ajustar." });
  values.push(motivo, req.user.id, req.params.id, empresaId(req));
  const out = await db.transaction(async client => {
  const before = (await client.query("SELECT * FROM oficina_fichajes WHERE id=$1 AND empresa_id=$2 FOR UPDATE", [req.params.id, empresaId(req)])).rows[0];
  if (!before) fail("Fichaje no encontrado.", 404);
  const start = req.body.entrada_at === undefined ? before.entrada_at : req.body.entrada_at;
  const end = req.body.salida_at === undefined ? before.salida_at : req.body.salida_at;
  if (!start || !Number.isFinite(new Date(start).getTime()) || (end && (!Number.isFinite(new Date(end).getTime()) || new Date(end) < new Date(start)))) fail("Revisa las horas de entrada y salida.");
  const { rows } = await client.query(
    `UPDATE oficina_fichajes
        SET ${fields.join(", ")}, ajuste_motivo=$${values.length - 3}, ajustado_por=$${values.length - 2}, updated_at=NOW()
      WHERE id=$${values.length - 1} AND empresa_id=$${values.length}
      RETURNING *`,
    values
  );
  const adjusted = (await client.query("UPDATE oficina_fichajes SET estado=CASE WHEN salida_at IS NULL THEN 'abierto' ELSE 'cerrado' END, pausa_inicio_at=CASE WHEN salida_at IS NULL THEN pausa_inicio_at ELSE NULL END WHERE id=$1 AND empresa_id=$2 RETURNING *", [rows[0].id, empresaId(req)])).rows[0];
  await logEvento(client, req, adjusted.id, adjusted.usuario_id, "ajuste_manual", { motivo, antes: before, despues: adjusted });
  return adjusted;
  });
  res.json(computeRow(out));
});

router.get("/export.csv", async (req, res) => {
  await ensureSchema();
  if (!canManage(req)) return res.status(403).json({ error: "No tienes permisos para exportar control horario." });
  const { desde, hasta } = attendancePeriod(req.query);
  const { rows } = await db.query(
    `SELECT f.*, u.nombre, u.email, u.rol
       FROM oficina_fichajes f JOIN usuarios u ON u.id=f.usuario_id
      WHERE f.empresa_id=$1 AND f.fecha BETWEEN $2 AND $3
      ORDER BY f.fecha DESC, u.nombre`,
    [empresaId(req), desde, hasta]
  );
  const esc = (v) => {
    const raw = v instanceof Date ? v.toISOString() : String(v ?? "");
    const safe = /^[=+@\-\t\r\n]/.test(raw) ? "'" + raw : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [
    ["fecha","usuario","email","rol","entrada","salida","pausa_min","trabajado_min","estado","modalidad","ubicacion","ubicacion_estado","distancia_base_m","entrada_lat","entrada_lng","salida_lat","salida_lng","notas"].map(esc).join(";"),
    ...rows.map(row => computeRow(row)).map(r => [r.fecha, r.nombre, r.email, r.rol, r.entrada_at, r.salida_at, r.pausa_total_live_min, r.trabajado_min, r.estado, r.modalidad, r.ubicacion, r.ubicacion_estado, r.ubicacion_distancia_m, r.entrada_lat, r.entrada_lng, r.salida_lat, r.salida_lng, r.notas].map(esc).join(";")),
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="control-horario-${desde}-${hasta}.csv"`);
  res.send(`\ufeff${csv}`);
});

module.exports = router;
