const express = require("express");
const db      = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const { crearNotificacion } = require("../services/notificaciones");
const router  = express.Router();
router.use(authenticate);

let schemaReady = false;
async function ensureChoferesTransparencySchema() {
  if (schemaReady) return;
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS sexo VARCHAR(30)").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS puesto_valor VARCHAR(120)").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS estado VARCHAR(40) NOT NULL DEFAULT 'disponible'").catch(() => {});
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS avisos JSONB NOT NULL DEFAULT '[]'::jsonb").catch(() => {});
  schemaReady = true;
}

let jornadaSchemaReady = false;
let vacacionesSchemaReady = false;
async function ensureChoferJornadaSchema() {
  if (jornadaSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS chofer_jornadas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      chofer_id UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
      usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'abierta',
      inicio_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fin_at TIMESTAMPTZ,
      actividad_actual VARCHAR(30) NOT NULL DEFAULT 'otros_trabajos',
      km_inicio NUMERIC(12,1),
      km_fin NUMERIC(12,1),
      hace_noche BOOLEAN DEFAULT false,
      noche_lugar TEXT,
      notas TEXT,
      eventos JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_jornadas_abierta ON chofer_jornadas(empresa_id, chofer_id, estado) WHERE estado='abierta'").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_jornadas_fecha ON chofer_jornadas(empresa_id, chofer_id, inicio_at DESC)").catch(() => {});
  jornadaSchemaReady = true;
}

async function ensureChoferVacacionesSchema() {
  if (vacacionesSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS chofer_vacaciones_solicitudes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      chofer_id UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
      usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      dias NUMERIC(8,2) NOT NULL DEFAULT 0,
      motivo TEXT,
      firma_solicitud JSONB NOT NULL DEFAULT '{}'::jsonb,
      firma_aceptacion JSONB NOT NULL DEFAULT '{}'::jsonb,
      aprobado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      aprobado_at TIMESTAMPTZ,
      rechazado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      rechazado_at TIMESTAMPTZ,
      observaciones TEXT,
      aviso_id VARCHAR(80),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_vacaciones_empresa_estado ON chofer_vacaciones_solicitudes(empresa_id, estado, fecha_inicio)").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_vacaciones_chofer ON chofer_vacaciones_solicitudes(empresa_id, chofer_id, fecha_inicio DESC)").catch(() => {});
  vacacionesSchemaReady = true;
}

async function resolveChoferApp(req) {
  const empresaId = req.empresaId || req.user?.empresa_id;
  if (!empresaId || req.user?.rol !== "chofer") return null;
  const params = [empresaId];
  const clauses = [];
  if (req.user.chofer_id) {
    params.push(req.user.chofer_id);
    clauses.push(`ch.id=$${params.length}`);
  }
  if (req.user.email) {
    params.push(String(req.user.email).toLowerCase());
    clauses.push(`LOWER(ch.email)=$${params.length}`);
  }
  if (req.user.nombre) {
    params.push(String(req.user.nombre).trim().toLowerCase());
    clauses.push(`LOWER(TRIM(CONCAT(ch.nombre, ' ', COALESCE(ch.apellidos,''))))=$${params.length}`);
    clauses.push(`LOWER(TRIM(ch.nombre))=$${params.length}`);
  }
  if (!clauses.length) return null;
  const { rows } = await db.query(
    `SELECT ch.*, v.matricula AS vehiculo_matricula, v.km_actuales
       FROM choferes ch
       LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id AND v.empresa_id=ch.empresa_id
      WHERE ch.empresa_id=$1 AND (${clauses.join(" OR ")})
      ORDER BY ch.nombre
      LIMIT 1`,
    params
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

function normalizeActividad(value) {
  const v = String(value || "").trim().toLowerCase();
  return ["conduccion", "descanso", "pausa", "disponibilidad", "otros_trabajos"].includes(v) ? v : "otros_trabajos";
}

function jornadaEventos(row = {}) {
  return Array.isArray(row.eventos) ? row.eventos : [];
}

const TACOGRAFO = Object.freeze({
  conduccionContinuaMin: 270,
  pausaCompletaMin: 45,
  pausaPartidaPrimeraMin: 15,
  pausaPartidaSegundaMin: 30,
  descansoDiarioReducidoMin: 540,
  descansoDiarioNormalMin: 660,
  conduccionDiariaNormalMin: 540,
  conduccionDiariaExtendidaMin: 600,
});

function diffMinutes(a, b) {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function splitPausaValido(bloques = []) {
  let primeraEncontrada = false;
  for (const mins of bloques) {
    if (!primeraEncontrada && mins >= TACOGRAFO.pausaPartidaPrimeraMin) primeraEncontrada = true;
    else if (primeraEncontrada && mins >= TACOGRAFO.pausaPartidaSegundaMin) return true;
  }
  return false;
}

async function notificarGerenciaTraficoJornada(empresaId, tipo, titulo, mensaje, data = {}, createdBy = null) {
  if (!empresaId) return;
  const key = data?.dedupe_key || `${tipo}:${data?.jornada_id || ""}:${data?.chofer_id || ""}`;
  const existing = await db.query(
    `SELECT id FROM notificaciones_internas
      WHERE empresa_id=$1 AND tipo=$2 AND data->>'dedupe_key'=$3 AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1`,
    [empresaId, tipo, key]
  ).catch(() => ({ rows: [] }));
  if (existing.rows[0]) return;
  const { rows } = await db.query(
    "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('gerente','trafico')",
    [empresaId]
  ).catch(() => ({ rows: [] }));
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo,
    titulo,
    mensaje,
    data: { ...data, dedupe_key: key },
    created_by: createdBy,
  }).catch(() => null)));
}

async function evaluarAlertasJornadaAlCambiarActividad({ empresaId, chofer, jornada, nuevaActividad, userId }) {
  const eventos = jornadaEventos(jornada);
  const last = eventos[eventos.length - 1];
  if (!last?.at || !["descanso", "pausa"].includes(last.tipo)) return;
  const minutos = diffMinutes(last.at, new Date().toISOString());
  const nombreChofer = `${chofer?.nombre || ""} ${chofer?.apellidos || ""}`.trim() || "Chofer";
  if (last.tipo === "descanso") {
    const objetivo = Number(last.objetivo_descanso_min || 0);
    if (objetivo === TACOGRAFO.descansoDiarioReducidoMin && minutos > 550 && minutos < TACOGRAFO.descansoDiarioNormalMin) {
      await notificarGerenciaTraficoJornada(
        empresaId,
        "chofer_descanso_incorrecto",
        "Descanso diario incorrecto",
        `${nombreChofer} ha registrado un descanso reducido de ${minutos} min: supera 9h10 y no alcanza 11h.`,
        { jornada_id: jornada.id, chofer_id: chofer?.id, minutos, objetivo, dedupe_key: `descanso_incorrecto:${jornada.id}:${last.at}` },
        userId
      );
    } else if ((objetivo === TACOGRAFO.descansoDiarioReducidoMin && minutos > 550) || (objetivo === TACOGRAFO.descansoDiarioNormalMin && minutos > 670)) {
      await notificarGerenciaTraficoJornada(
        empresaId,
        "chofer_descanso_excedido",
        "Descanso diario excedido",
        `${nombreChofer} ha excedido el descanso diario marcado: ${minutos} min.`,
        { jornada_id: jornada.id, chofer_id: chofer?.id, minutos, objetivo, dedupe_key: `descanso_excedido:${jornada.id}:${last.at}` },
        userId
      );
    }
  }
  if (last.tipo === "pausa" && nuevaActividad === "conduccion") {
    const resumen = calcularResumenJornada(jornada);
    if (minutos >= TACOGRAFO.pausaPartidaPrimeraMin && minutos < TACOGRAFO.pausaCompletaMin && !resumen.pausa_partida_valida && resumen.conduccion_desde_pausa_min >= 240) {
      await notificarGerenciaTraficoJornada(
        empresaId,
        "chofer_pausa_incorrecta",
        "Pausa obligatoria incompleta",
        `${nombreChofer} ha reanudado conduccion tras una pausa de ${minutos} min sin completar 45 min ni pausa partida 15 + 30. Puede conllevar sancion.`,
        { jornada_id: jornada.id, chofer_id: chofer?.id, minutos, conduccion_desde_pausa_min: resumen.conduccion_desde_pausa_min, dedupe_key: `pausa_incorrecta:${jornada.id}:${last.at}` },
        userId
      );
    }
  }
}

function calcularResumenJornada(row = {}) {
  const nowIso = new Date().toISOString();
  const eventos = jornadaEventos(row);
  const normalized = eventos.length ? eventos : [{ tipo: row.actividad_actual || "otros_trabajos", at: row.inicio_at || nowIso }];
  let conduccion = 0;
  let pausaDescanso = 0;
  let otros = 0;
  let conduccionDesdePausa = 0;
  let pausaActual = 0;
  let descansoDiarioActual = 0;
  let pausaBloques = [];
  let actividadActualDesde = row.inicio_at || normalized[0]?.at || nowIso;
  let actividadActualMin = 0;
  let objetivoDescansoMin = null;
  const segmentos = [];
  for (let idx = 0; idx < normalized.length; idx++) {
    const ev = normalized[idx];
    const nextAt = normalized[idx + 1]?.at || row.fin_at || nowIso;
    const mins = diffMinutes(ev.at, nextAt);
    if (ev.tipo === "fin") continue;
    segmentos.push({ tipo: ev.tipo, at: ev.at, hasta: nextAt, minutos: mins, nota: ev.nota || "", objetivo_descanso_min: ev.objetivo_descanso_min || null });
    if (idx === normalized.length - 1 && !row.fin_at) {
      actividadActualDesde = ev.at || actividadActualDesde;
      actividadActualMin = mins;
      objetivoDescansoMin = ev.objetivo_descanso_min || null;
    }
    if (ev.tipo === "conduccion") {
      conduccion += mins;
      conduccionDesdePausa += mins;
      pausaActual = 0;
      descansoDiarioActual = 0;
    } else if (["pausa", "descanso"].includes(ev.tipo)) {
      pausaDescanso += mins;
      pausaActual = mins;
      if (ev.tipo === "descanso") descansoDiarioActual = mins;
      if (mins >= TACOGRAFO.pausaPartidaPrimeraMin) pausaBloques.push(mins);
      if (mins >= TACOGRAFO.pausaCompletaMin || splitPausaValido(pausaBloques)) {
        conduccionDesdePausa = 0;
        pausaBloques = [];
      }
    } else {
      otros += mins;
      pausaActual = 0;
      descansoDiarioActual = 0;
    }
  }
  const avisos = [];
  const pausaPartidaValida = splitPausaValido(pausaBloques);
  const pausaAcumuladaBloque = pausaBloques.reduce((sum, mins) => sum + mins, 0);
  if (conduccionDesdePausa >= TACOGRAFO.conduccionContinuaMin) avisos.push("Pausa obligatoria: has alcanzado 4h30 de conduccion acumulada desde la ultima pausa suficiente.");
  else if (conduccionDesdePausa >= 240) avisos.push("Quedan 30 minutos o menos para la pausa de 45 minutos.");
  if (conduccion >= TACOGRAFO.conduccionDiariaExtendidaMin) avisos.push("Conduccion diaria en 10h: revisa que sea una de las dos ampliaciones semanales permitidas.");
  else if (conduccion >= TACOGRAFO.conduccionDiariaNormalMin) avisos.push("Conduccion diaria en 9h: no deberias seguir conduciendo salvo ampliacion legal a 10h.");
  if (["descanso", "pausa"].includes(row.actividad_actual) && pausaActual > 0 && pausaActual < TACOGRAFO.pausaCompletaMin && !pausaPartidaValida) {
    avisos.push("Descanso en curso: para volver a conducir necesitas 45 minutos seguidos o pausa partida de 15 + 30 minutos.");
  }
  return {
    calculado_at: nowIso,
    conduccion_min: conduccion,
    pausa_descanso_min: pausaDescanso,
    otros_min: otros,
    conduccion_desde_pausa_min: conduccionDesdePausa,
    actividad_actual_desde: actividadActualDesde,
    actividad_actual_min: actividadActualMin,
    pausa_actual_min: ["pausa", "descanso"].includes(row.actividad_actual) ? pausaActual : 0,
    descanso_diario_actual_min: row.actividad_actual === "descanso" ? descansoDiarioActual : 0,
    objetivo_descanso_min: objetivoDescansoMin,
    pausa_acumulada_bloque_min: pausaAcumuladaBloque,
    pausa_partida_valida: pausaPartidaValida,
    pausa_restante_min: Math.max(0, TACOGRAFO.pausaCompletaMin - pausaActual),
    descanso_9_restante_min: Math.max(0, TACOGRAFO.descansoDiarioReducidoMin - descansoDiarioActual),
    descanso_11_restante_min: Math.max(0, TACOGRAFO.descansoDiarioNormalMin - descansoDiarioActual),
    puede_cerrar_descanso_reducido: descansoDiarioActual >= TACOGRAFO.descansoDiarioReducidoMin,
    puede_cerrar_descanso_normal: descansoDiarioActual >= TACOGRAFO.descansoDiarioNormalMin,
    puede_arrancar: conduccionDesdePausa < TACOGRAFO.conduccionContinuaMin && conduccion < TACOGRAFO.conduccionDiariaExtendidaMin,
    avisos,
    proxima_pausa_en_min: Math.max(0, TACOGRAFO.conduccionContinuaMin - conduccionDesdePausa),
    limites: TACOGRAFO,
    segmentos,
  };
}

function serializeJornada(row) {
  if (!row) return null;
  const resumen = calcularResumenJornada(row);
  return {
    ...row,
    eventos: jornadaEventos(row),
    resumen,
  };
}

function requireChoferApp(req, res, next) {
  if (req.user?.rol !== "chofer") return res.status(403).json({ error: "Acceso exclusivo para app de chofer" });
  next();
}

function calcVacationDays(inicio, fin) {
  const a = new Date(`${String(inicio || "").slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(fin || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || b < a) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

async function notifyVacacionesGerenciaTrafico(empresaId, solicitud, chofer, action, actorId = null) {
  const nombre = `${chofer?.nombre || ""} ${chofer?.apellidos || ""}`.trim() || "Chofer";
  const title = action === "solicitada" ? "Nueva solicitud de vacaciones" : action === "aprobada" ? "Vacaciones aprobadas" : "Solicitud de vacaciones actualizada";
  const msg = `${nombre}: ${solicitud.fecha_inicio} a ${solicitud.fecha_fin} (${Number(solicitud.dias || 0)} dias).`;
  const { rows } = await db.query(
    "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('gerente','trafico')",
    [empresaId]
  ).catch(() => ({ rows: [] }));
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo: "chofer_vacaciones_" + action,
    titulo: title,
    mensaje: msg,
    data: { solicitud_id: solicitud.id, chofer_id: solicitud.chofer_id, fecha_inicio: solicitud.fecha_inicio, fecha_fin: solicitud.fecha_fin },
    created_by: actorId,
  }).catch(() => null)));
}

async function syncAvisoVacacionesChofer({ empresaId, solicitud, aprobadoPor = null }) {
  if (!solicitud?.chofer_id) return null;
  const avisoId = solicitud.aviso_id || `vac-${solicitud.id}`;
  const { rows } = await db.query("SELECT avisos FROM choferes WHERE id=$1 AND empresa_id=$2 LIMIT 1", [solicitud.chofer_id, empresaId]);
  const avisos = Array.isArray(rows[0]?.avisos) ? rows[0].avisos : [];
  const nextAviso = {
    id: avisoId,
    tipo: "vacaciones",
    fecha_inicio: String(solicitud.fecha_inicio).slice(0, 10),
    fecha_fin: String(solicitud.fecha_fin).slice(0, 10),
    descripcion: `Vacaciones aprobadas (${Number(solicitud.dias || 0)} dias)`,
    origen: "solicitud_chofer",
    solicitud_id: solicitud.id,
    firmado: !!solicitud.firma_aceptacion?.hash_sha256,
    aprobado_por: aprobadoPor || solicitud.aprobado_por || null,
  };
  const merged = avisos.filter(a => String(a.id) !== String(avisoId));
  merged.push(nextAviso);
  await db.query(
    "UPDATE choferes SET avisos=$1::jsonb, estado='vacaciones' WHERE id=$2 AND empresa_id=$3",
    [JSON.stringify(merged), solicitud.chofer_id, empresaId]
  );
  if (!solicitud.aviso_id) {
    await db.query("UPDATE chofer_vacaciones_solicitudes SET aviso_id=$1, updated_at=NOW() WHERE id=$2 AND empresa_id=$3", [avisoId, solicitud.id, empresaId]).catch(() => {});
  }
  return nextAviso;
}

router.get("/", async (req,res)=>{
  await ensureChoferesTransparencySchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { activo } = req.query;
  let q = `SELECT ch.*,
             v.matricula AS vehiculo_matricula,
             v.matricula AS vehiculo_matricula_display,
             v.remolque_id AS vehiculo_remolque_id,
             COALESCE(ch.apellidos,'') AS apellidos
           FROM choferes ch LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id WHERE 1=1`;
  const params = [];
  if (empresaId) { q += " AND ch.empresa_id=$"+(params.length+1); params.push(empresaId); }
  if (activo === "false") { q += " AND ch.activo=false"; }
  else if (activo === "todos") { /* no filter */ }
  else { q += " AND ch.activo=true"; }
  q += " ORDER BY ch.nombre";
  const {rows} = await db.query(q, params);
  res.json(rows);
});

router.get("/app/jornada", requireChoferApp, async (req, res) => {
  await ensureChoferJornadaSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  const { rows } = await db.query(
    `SELECT * FROM chofer_jornadas
      WHERE empresa_id=$1 AND chofer_id=$2 AND estado='abierta'
      ORDER BY inicio_at DESC
      LIMIT 1`,
    [empresaId, chofer.id]
  );
  res.json({ chofer, jornada: serializeJornada(rows[0]) });
});

router.get("/vacaciones", GERENTE_O_TRAFICO, async (req, res) => {
  await ensureChoferVacacionesSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const estado = String(req.query.estado || "").trim().toLowerCase();
  const where = ["s.empresa_id=$1"];
  const params = [empresaId];
  if (estado && estado !== "todas") {
    params.push(estado);
    where.push(`s.estado=$${params.length}`);
  }
  const { rows } = await db.query(`
    SELECT s.*, ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos, ch.email AS chofer_email,
           u.nombre AS aprobado_por_nombre
      FROM chofer_vacaciones_solicitudes s
      JOIN choferes ch ON ch.id=s.chofer_id AND ch.empresa_id=s.empresa_id
      LEFT JOIN usuarios u ON u.id=s.aprobado_por
     WHERE ${where.join(" AND ")}
     ORDER BY CASE s.estado WHEN 'pendiente' THEN 0 WHEN 'aprobada_pendiente_firma' THEN 1 WHEN 'aprobada_firmada' THEN 2 ELSE 3 END,
              s.fecha_inicio ASC, s.created_at DESC
     LIMIT 300
  `, params);
  res.json(rows);
});

router.get("/app/vacaciones", requireChoferApp, async (req, res) => {
  await ensureChoferVacacionesSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  const { rows } = await db.query(
    `SELECT * FROM chofer_vacaciones_solicitudes
      WHERE empresa_id=$1 AND chofer_id=$2
      ORDER BY created_at DESC
      LIMIT 50`,
    [empresaId, chofer.id]
  );
  res.json({ chofer, solicitudes: rows });
});

router.post("/app/vacaciones", requireChoferApp, async (req, res) => {
  await ensureChoferVacacionesSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  const inicio = String(req.body?.fecha_inicio || "").slice(0, 10);
  const fin = String(req.body?.fecha_fin || inicio).slice(0, 10);
  const dias = calcVacationDays(inicio, fin);
  if (!dias) return res.status(400).json({ error: "Fechas de vacaciones no validas" });
  const firma = req.body?.firma && typeof req.body.firma === "object" ? req.body.firma : {};
  const firmaPayload = {
    ...firma,
    signed_at: new Date().toISOString(),
    signed_by_user_id: req.user?.id || null,
    chofer_id: chofer.id,
    type: "solicitud_vacaciones",
  };
  firmaPayload.hash_sha256 = require("crypto").createHash("sha256").update(JSON.stringify(firmaPayload)).digest("hex");
  const { rows } = await db.query(
    `INSERT INTO chofer_vacaciones_solicitudes
      (empresa_id,chofer_id,usuario_id,estado,fecha_inicio,fecha_fin,dias,motivo,firma_solicitud)
     VALUES ($1,$2,$3,'pendiente',$4,$5,$6,$7,$8::jsonb)
     RETURNING *`,
    [empresaId, chofer.id, req.user?.id || null, inicio, fin, dias, req.body?.motivo || null, JSON.stringify(firmaPayload)]
  );
  await notifyVacacionesGerenciaTrafico(empresaId, rows[0], chofer, "solicitada", req.user?.id || null).catch(() => {});
  res.status(201).json({ chofer, solicitud: rows[0] });
});

router.post("/app/vacaciones/:id/firma-aceptacion", requireChoferApp, async (req, res) => {
  await ensureChoferVacacionesSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  const current = await db.query(
    `SELECT * FROM chofer_vacaciones_solicitudes WHERE id=$1 AND empresa_id=$2 AND chofer_id=$3 LIMIT 1`,
    [req.params.id, empresaId, chofer.id]
  );
  const solicitud = current.rows[0];
  if (!solicitud) return res.status(404).json({ error: "Solicitud no encontrada" });
  if (solicitud.estado !== "aprobada_pendiente_firma") return res.status(400).json({ error: "Esta solicitud no esta pendiente de firma" });
  const firmaPayload = {
    ...(req.body?.firma || {}),
    signed_at: new Date().toISOString(),
    signed_by_user_id: req.user?.id || null,
    chofer_id: chofer.id,
    solicitud_id: solicitud.id,
    type: "aceptacion_vacaciones",
  };
  firmaPayload.hash_sha256 = require("crypto").createHash("sha256").update(JSON.stringify(firmaPayload)).digest("hex");
  const { rows } = await db.query(
    `UPDATE chofer_vacaciones_solicitudes
        SET estado='aprobada_firmada', firma_aceptacion=$4::jsonb, updated_at=NOW()
      WHERE id=$1 AND empresa_id=$2 AND chofer_id=$3
      RETURNING *`,
    [solicitud.id, empresaId, chofer.id, JSON.stringify(firmaPayload)]
  );
  await syncAvisoVacacionesChofer({ empresaId, solicitud: rows[0] }).catch(() => {});
  await notifyVacacionesGerenciaTrafico(empresaId, rows[0], chofer, "aprobada", req.user?.id || null).catch(() => {});
  res.json({ chofer, solicitud: rows[0] });
});

router.post("/vacaciones/:id/resolver", GERENTE_O_TRAFICO, async (req, res) => {
  await ensureChoferVacacionesSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const estadoSolicitado = String(req.body?.estado || "").toLowerCase();
  const accion = String(req.body?.accion || (estadoSolicitado === "rechazada" ? "rechazar" : "aprobar")).toLowerCase();
  const current = await db.query(
    `SELECT s.*, ch.nombre, ch.apellidos
       FROM chofer_vacaciones_solicitudes s
       JOIN choferes ch ON ch.id=s.chofer_id AND ch.empresa_id=s.empresa_id
      WHERE s.id=$1 AND s.empresa_id=$2
      LIMIT 1`,
    [req.params.id, empresaId]
  );
  const solicitud = current.rows[0];
  if (!solicitud) return res.status(404).json({ error: "Solicitud no encontrada" });
  if (accion === "rechazar") {
    const { rows } = await db.query(
      `UPDATE chofer_vacaciones_solicitudes
          SET estado='rechazada', rechazado_por=$3, rechazado_at=NOW(), observaciones=$4, updated_at=NOW()
        WHERE id=$1 AND empresa_id=$2
        RETURNING *`,
      [solicitud.id, empresaId, req.user?.id || null, req.body?.observaciones || null]
    );
    return res.json(rows[0]);
  }
  const firmaDirecta = req.body?.firma && typeof req.body.firma === "object" ? req.body.firma : null;
  let firmaAceptacion = {};
  let estado = "aprobada_pendiente_firma";
  if (firmaDirecta) {
    firmaAceptacion = {
      ...firmaDirecta,
      signed_at: new Date().toISOString(),
      signed_by_user_id: req.user?.id || null,
      chofer_id: solicitud.chofer_id,
      solicitud_id: solicitud.id,
      type: "aceptacion_vacaciones_directa",
    };
    firmaAceptacion.hash_sha256 = require("crypto").createHash("sha256").update(JSON.stringify(firmaAceptacion)).digest("hex");
    estado = "aprobada_firmada";
  }
  const { rows } = await db.query(
    `UPDATE chofer_vacaciones_solicitudes
        SET estado=$3, aprobado_por=$4, aprobado_at=NOW(), observaciones=$5,
            firma_aceptacion=CASE WHEN $6::jsonb <> '{}'::jsonb THEN $6::jsonb ELSE firma_aceptacion END,
            updated_at=NOW()
      WHERE id=$1 AND empresa_id=$2
      RETURNING *`,
    [solicitud.id, empresaId, estado, req.user?.id || null, req.body?.observaciones || null, JSON.stringify(firmaAceptacion)]
  );
  if (estado === "aprobada_firmada") {
    await syncAvisoVacacionesChofer({ empresaId, solicitud: rows[0], aprobadoPor: req.user?.id || null }).catch(() => {});
  }
  await notifyVacacionesGerenciaTrafico(empresaId, rows[0], solicitud, "aprobada", req.user?.id || null).catch(() => {});
  res.json(rows[0]);
});

router.post("/vacaciones/adjudicar", GERENTE_O_TRAFICO, async (req, res) => {
  await ensureChoferVacacionesSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const choferId = req.body?.chofer_id;
  const inicio = String(req.body?.fecha_inicio || "").slice(0, 10);
  const fin = String(req.body?.fecha_fin || inicio).slice(0, 10);
  const dias = calcVacationDays(inicio, fin);
  if (!choferId || !dias) return res.status(400).json({ error: "Indica chofer y fechas validas" });
  const ch = await db.query("SELECT * FROM choferes WHERE id=$1 AND empresa_id=$2 LIMIT 1", [choferId, empresaId]);
  const chofer = ch.rows[0];
  if (!chofer) return res.status(404).json({ error: "Chofer no encontrado" });
  const firmaAceptacion = req.body?.firma ? {
    ...req.body.firma,
    signed_at: new Date().toISOString(),
    signed_by_user_id: req.user?.id || null,
    chofer_id: chofer.id,
    type: "adjudicacion_vacaciones_directa",
  } : {};
  if (req.body?.firma) firmaAceptacion.hash_sha256 = require("crypto").createHash("sha256").update(JSON.stringify(firmaAceptacion)).digest("hex");
  const estado = req.body?.firma ? "aprobada_firmada" : "aprobada_pendiente_firma";
  const { rows } = await db.query(
    `INSERT INTO chofer_vacaciones_solicitudes
      (empresa_id,chofer_id,usuario_id,estado,fecha_inicio,fecha_fin,dias,motivo,firma_aceptacion,aprobado_por,aprobado_at,observaciones)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$3,NOW(),$10)
     RETURNING *`,
    [empresaId, chofer.id, req.user?.id || null, estado, inicio, fin, dias, req.body?.motivo || "Adjudicadas por empresa", JSON.stringify(firmaAceptacion), req.body?.observaciones || null]
  );
  if (estado === "aprobada_firmada") await syncAvisoVacacionesChofer({ empresaId, solicitud: rows[0], aprobadoPor: req.user?.id || null }).catch(() => {});
  await notifyVacacionesGerenciaTrafico(empresaId, rows[0], chofer, "aprobada", req.user?.id || null).catch(() => {});
  res.status(201).json(rows[0]);
});

router.post("/app/jornada/iniciar", requireChoferApp, async (req, res) => {
  await ensureChoferJornadaSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  const kmInicio = req.body?.km_inicio === "" || req.body?.km_inicio == null ? null : Number(req.body.km_inicio);
  if (kmInicio != null && (!Number.isFinite(kmInicio) || kmInicio < 0)) return res.status(400).json({ error: "Kilometros de inicio no validos" });
  const open = await db.query(
    `SELECT * FROM chofer_jornadas WHERE empresa_id=$1 AND chofer_id=$2 AND estado='abierta' ORDER BY inicio_at DESC LIMIT 1`,
    [empresaId, chofer.id]
  );
  if (open.rows[0]) return res.json({ chofer, jornada: serializeJornada(open.rows[0]) });
  const actividad = normalizeActividad(req.body?.actividad || "otros_trabajos");
  const { rows: lastClosedRows } = await db.query(
    `SELECT id, fin_at, actividad_actual, eventos
       FROM chofer_jornadas
      WHERE empresa_id=$1 AND chofer_id=$2 AND estado='cerrada' AND fin_at IS NOT NULL
      ORDER BY fin_at DESC
      LIMIT 1`,
    [empresaId, chofer.id]
  ).catch(() => ({ rows: [] }));
  const lastClosed = lastClosedRows[0] || null;
  const descansoEntreTurnosMin = lastClosed?.fin_at ? diffMinutes(lastClosed.fin_at, new Date().toISOString()) : 0;
  const inicioEventos = [];
  if (descansoEntreTurnosMin > 0) {
    inicioEventos.push({
      tipo: "descanso_entre_turnos",
      at: lastClosed.fin_at,
      hasta: new Date().toISOString(),
      minutos: descansoEntreTurnosMin,
      valido_9h: descansoEntreTurnosMin >= TACOGRAFO.descansoDiarioReducidoMin,
      valido_11h: descansoEntreTurnosMin >= TACOGRAFO.descansoDiarioNormalMin,
    });
  }
  inicioEventos.push({ tipo: actividad, at: new Date().toISOString(), km: kmInicio, nota: "Inicio de jornada" });
  const { rows } = await db.query(
    `INSERT INTO chofer_jornadas
      (empresa_id, chofer_id, usuario_id, vehiculo_id, km_inicio, actividad_actual, eventos, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING *`,
    [
      empresaId,
      chofer.id,
      req.user.id,
      chofer.vehiculo_id || null,
      kmInicio,
      actividad,
      JSON.stringify(inicioEventos),
      req.body?.notas || null,
    ]
  );
  const row = rows[0] || (await db.query(
    `SELECT * FROM chofer_jornadas WHERE empresa_id=$1 AND chofer_id=$2 AND estado='abierta' ORDER BY inicio_at DESC LIMIT 1`,
    [empresaId, chofer.id]
  )).rows[0];
  if (chofer.vehiculo_id && kmInicio != null) {
    await db.query(
      `UPDATE vehiculos
          SET km_actuales = CASE
                WHEN km_actuales IS NULL OR $1 >= km_actuales THEN $1
                ELSE km_actuales
              END,
              updated_at=NOW()
        WHERE id=$2 AND empresa_id=$3`,
      [Math.round(kmInicio), chofer.vehiculo_id, empresaId]
    ).catch(() => {});
  }
  res.status(201).json({ chofer, descanso_entre_turnos_min: descansoEntreTurnosMin, jornada: serializeJornada(row) });
});

router.post("/app/jornada/actividad", requireChoferApp, async (req, res) => {
  await ensureChoferJornadaSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  const actividad = normalizeActividad(req.body?.actividad);
  const { rows: currentRows } = await db.query(
    `SELECT * FROM chofer_jornadas WHERE empresa_id=$1 AND chofer_id=$2 AND estado='abierta' ORDER BY inicio_at DESC LIMIT 1`,
    [empresaId, chofer.id]
  );
  const current = currentRows[0];
  if (!current) return res.status(400).json({ error: "No hay jornada abierta" });
  if (actividad === current.actividad_actual) {
    return res.json({ chofer, jornada: serializeJornada(current) });
  }
  const resumenActual = calcularResumenJornada(current);
  if (actividad === "conduccion" && !resumenActual.puede_arrancar) {
    await notificarGerenciaTraficoJornada(
      empresaId,
      "chofer_pausa_obligatoria",
      "Intento de conducir sin pausa obligatoria",
      `${chofer.nombre || "Chofer"} ha intentado iniciar conduccion sin completar la pausa obligatoria. Puede conllevar sancion.`,
      { jornada_id: current.id, chofer_id: chofer.id, conduccion_desde_pausa_min: resumenActual.conduccion_desde_pausa_min, dedupe_key: `pausa_obligatoria:${current.id}:${Math.floor(Date.now() / 3600000)}` },
      req.user?.id || null
    ).catch(() => {});
    return res.status(400).json({
      error: "No puedes iniciar conduccion hasta completar la pausa o descanso obligatorio.",
      resumen: resumenActual,
    });
  }
  await evaluarAlertasJornadaAlCambiarActividad({
    empresaId,
    chofer,
    jornada: current,
    nuevaActividad: actividad,
    userId: req.user?.id || null,
  }).catch(() => {});
  const objetivoDescansoMin = Number(req.body?.objetivo_descanso_min || 0);
  const evento = { tipo: actividad, at: new Date().toISOString(), nota: req.body?.notas || "" };
  if (actividad === "descanso" && Number.isFinite(objetivoDescansoMin) && objetivoDescansoMin > 0) {
    evento.objetivo_descanso_min = objetivoDescansoMin;
  }
  const eventos = [...jornadaEventos(current), evento];
  const { rows } = await db.query(
    `UPDATE chofer_jornadas
        SET actividad_actual=$1, eventos=$2::jsonb, updated_at=NOW()
      WHERE id=$3 AND empresa_id=$4
      RETURNING *`,
    [actividad, JSON.stringify(eventos), current.id, empresaId]
  );
  res.json({ chofer, jornada: serializeJornada(rows[0]) });
});

router.post("/app/jornada/cerrar", requireChoferApp, async (req, res) => {
  await ensureChoferJornadaSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  const kmFin = req.body?.km_fin === "" || req.body?.km_fin == null ? null : Number(req.body.km_fin);
  if (kmFin != null && (!Number.isFinite(kmFin) || kmFin < 0)) return res.status(400).json({ error: "Kilometros de cierre no validos" });
  const { rows: currentRows } = await db.query(
    `SELECT * FROM chofer_jornadas WHERE empresa_id=$1 AND chofer_id=$2 AND estado='abierta' ORDER BY inicio_at DESC LIMIT 1`,
    [empresaId, chofer.id]
  );
  const current = currentRows[0];
  if (!current) return res.status(400).json({ error: "No hay jornada abierta" });
  if (kmFin != null && current.km_inicio != null && kmFin < Number(current.km_inicio)) {
    return res.status(400).json({ error: "Los kilometros de cierre no pueden ser inferiores a los de inicio" });
  }
  const nowIso = new Date().toISOString();
  const eventos = [...jornadaEventos(current)];
  if (current.actividad_actual === "conduccion") {
    eventos.push({ tipo: "pausa", at: nowIso, nota: "Pausa automatica al cerrar turno desde conduccion" });
  }
  eventos.push({ tipo: "fin", at: nowIso, km: kmFin, noche: !!req.body?.hace_noche, nota: "Cierre de turno. El descanso se contabiliza hasta la siguiente apertura." });
  const { rows } = await db.query(
    `UPDATE chofer_jornadas
        SET estado='cerrada',
            fin_at=NOW(),
            actividad_actual='fin',
            km_fin=$1,
            hace_noche=$2,
            noche_lugar=$3,
            notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(chofer_jornadas.notas,''), $4)),
            eventos=$5::jsonb,
            updated_at=NOW()
      WHERE id=$6 AND empresa_id=$7
      RETURNING *`,
    [kmFin, !!req.body?.hace_noche, req.body?.noche_lugar || null, req.body?.notas || null, JSON.stringify(eventos), current.id, empresaId]
  );
  if (chofer.vehiculo_id && kmFin != null) {
    await db.query(
      `UPDATE vehiculos
          SET km_actuales = CASE
                WHEN km_actuales IS NULL OR $1 >= km_actuales THEN $1
                ELSE km_actuales
              END,
              updated_at=NOW()
        WHERE id=$2 AND empresa_id=$3`,
      [Math.round(kmFin), chofer.vehiculo_id, empresaId]
    ).catch(() => {});
    if (req.body?.hace_noche) {
      await db.query(
        `INSERT INTO vehiculo_noches (empresa_id, vehiculo_id, fecha, ciudad, chofer_id, notas)
         VALUES ($1,$2,CURRENT_DATE,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [empresaId, chofer.vehiculo_id, req.body?.noche_lugar || null, chofer.id, "Registrado desde app chofer"]
      ).catch(() => {});
    }
  }
  res.json({ chofer, jornada: serializeJornada(rows[0]) });
});
router.get("/:id", async (req,res)=>{
  await ensureChoferesTransparencySchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const {rows}=await db.query(
    "SELECT ch.*,v.matricula FROM choferes ch LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id AND v.empresa_id=ch.empresa_id WHERE ch.id=$1 AND ch.empresa_id=$2",
    [req.params.id, empresaId]
  );
  if(!rows[0])return res.status(404).json({error:"No encontrado"});
  res.json(rows[0]);
});
router.post("/", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureChoferesTransparencySchema();
    const {nombre,dni,telefono,email,vehiculo_id,categoria_carnet,apellidos,tipo_contrato,salario,notas,sexo,puesto_valor}=req.body;
    const empresaId = req.empresaId || req.user.empresa_id;
    const {rows}=await db.query(
      "INSERT INTO choferes (nombre,apellidos,dni,telefono,email,vehiculo_id,categoria_carnet,tipo_contrato,salario,notas,empresa_id,sexo,puesto_valor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
      [nombre,apellidos||null,dni||null,telefono||null,email||null,vehiculo_id||null,categoria_carnet||"C+E",tipo_contrato||null,salario||null,notas||null,empresaId,sexo||null,puesto_valor||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/:id", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureChoferesTransparencySchema();
    const {nombre,apellidos,dni,telefono,email,vehiculo_id,categoria_carnet,activo,notas,tipo_contrato,salario,sexo,puesto_valor,estado,avisos}=req.body;
    const empresaId = req.empresaId || req.user.empresa_id;
    const {rows}=await db.query(
      `UPDATE choferes
          SET nombre=$1,apellidos=$2,dni=$3,telefono=$4,email=$5,vehiculo_id=$6,categoria_carnet=$7,
              activo=$8,notas=$9,tipo_contrato=$10,salario=$11,sexo=$12,puesto_valor=$13,
              estado=COALESCE(NULLIF($14,''), estado),
              avisos=COALESCE($15::jsonb, avisos)
        WHERE id=$16 AND empresa_id=$17
        RETURNING *`,
      [
        nombre,apellidos||null,dni||null,telefono||null,email||null,vehiculo_id||null,categoria_carnet||"C+E",
        activo!==undefined?activo:true,notas||null,tipo_contrato||null,salario||null,sexo||null,puesto_valor||null,
        estado || null,
        Array.isArray(avisos) ? JSON.stringify(avisos.slice(0, 120)) : null,
        req.params.id,empresaId,
      ]
    );
    if(!rows[0]) return res.status(404).json({error:"No encontrado"});
    res.json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
module.exports = router;
