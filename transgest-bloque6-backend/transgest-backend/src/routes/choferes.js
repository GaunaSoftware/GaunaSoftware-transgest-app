const express = require("express");
const db      = require("../services/db");
const logger  = require("../services/logger");
const { authenticate, GERENTE_O_TRAFICO, SOLO_GERENTE } = require("../middleware/auth");
const { crearNotificacion } = require("../services/notificaciones");
const { validateBase64Upload } = require("../services/uploadValidation");
const router  = express.Router();
router.use(authenticate);

let schemaReady = false;
function failChoferSchema(error) {
  logger.error("Chofer schema no disponible: " + error.message);
  throw error;
}

async function ensureChoferesTransparencySchema() {
  if (schemaReady) return;
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS sexo VARCHAR(30)").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS puesto_valor VARCHAR(120)").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS estado VARCHAR(40) NOT NULL DEFAULT 'disponible'").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS avisos JSONB NOT NULL DEFAULT '[]'::jsonb").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS fecha_alta DATE").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS fecha_baja DATE").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS motivo_baja TEXT").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS firma_base TEXT").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS firma_base_nombre VARCHAR(180)").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS firma_base_fecha TIMESTAMPTZ").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS carta_renuncia_nombre TEXT").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS carta_renuncia_mime VARCHAR(120)").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS carta_renuncia_base64 TEXT").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS historial_laboral JSONB NOT NULL DEFAULT '[]'::jsonb").catch(failChoferSchema);
  await db.query("ALTER TABLE choferes ADD COLUMN IF NOT EXISTS plataformas JSONB NOT NULL DEFAULT '[]'::jsonb").catch(failChoferSchema);
  schemaReady = true;
}

function normalizePlataformas(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((platform, index) => ({
    id: String(platform?.id || `plat-${index}`),
    nombre: String(platform?.nombre || "").trim().slice(0, 160),
    documentos: (Array.isArray(platform?.documentos) ? platform.documentos : []).slice(0, 120).map((doc, docIndex) => ({
      id: String(doc?.id || `doc-${index}-${docIndex}`),
      nombre: String(doc?.nombre || "").trim().slice(0, 180),
      caducidad: doc?.caducidad ? String(doc.caducidad).slice(0, 10) : "",
      fecha_tope: doc?.fecha_tope ? String(doc.fecha_tope).slice(0, 10) : "",
      notas: String(doc?.notas || "").trim().slice(0, 500),
    })).filter(doc => doc.nombre || doc.caducidad || doc.fecha_tope || doc.notas),
  })).filter(platform => platform.nombre || platform.documentos.length);
}

function normalizeDuplicateText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDuplicateDni(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeDuplicatePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
}

async function findDuplicateChofer({ empresaId, dni, email, telefono, nombre, apellidos, excludeId = null }) {
  const dniKey = normalizeDuplicateDni(dni);
  const emailKey = String(email || "").trim().toLowerCase();
  const phoneKey = normalizeDuplicatePhone(telefono);
  const nombreKey = normalizeDuplicateText(nombre);
  const apellidosKey = normalizeDuplicateText(apellidos);
  if (!dniKey && !emailKey && !(phoneKey && nombreKey)) return null;

  const params = [empresaId];
  let excludeSql = "";
  if (excludeId) {
    params.push(excludeId);
    excludeSql = ` AND id<>$${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT id,nombre,apellidos,dni,email,telefono
       FROM choferes
      WHERE empresa_id=$1
        ${excludeSql}
        AND COALESCE(activo,true)=true
      LIMIT 500`,
    params
  );
  return rows.find(row => {
    if (dniKey && normalizeDuplicateDni(row.dni) === dniKey) return true;
    if (emailKey && String(row.email || "").trim().toLowerCase() === emailKey) return true;
    if (phoneKey && normalizeDuplicatePhone(row.telefono) === phoneKey) {
      const sameNombre = normalizeDuplicateText(row.nombre) === nombreKey;
      const sameApellidos = !apellidosKey || normalizeDuplicateText(row.apellidos) === apellidosKey;
      if (sameNombre && sameApellidos) return true;
    }
    return false;
  }) || null;
}

function duplicateChoferMessage(duplicate, draft = {}) {
  if (!duplicate) return "Ya existe un chofer con esos datos en esta empresa.";
  if (normalizeDuplicateDni(duplicate.dni) && normalizeDuplicateDni(duplicate.dni) === normalizeDuplicateDni(draft.dni)) {
    return "Ya existe un chofer activo con ese DNI/NIE en esta empresa.";
  }
  if (duplicate.email && draft.email && String(duplicate.email).trim().toLowerCase() === String(draft.email).trim().toLowerCase()) {
    return "Ya existe un chofer activo con ese email en esta empresa.";
  }
  return "Ya existe un chofer activo con el mismo nombre y telefono en esta empresa.";
}

async function resolveChoferByIdOrPrefix(empresaId, rawId) {
  const id = String(rawId || "").trim();
  if (!id) {
    const err = new Error("ID de chofer no indicado.");
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    `SELECT *
       FROM choferes
      WHERE empresa_id=$1
        AND (id::text=$2 OR id::text LIKE $3)
      ORDER BY id::text
      LIMIT 3`,
    [empresaId, id, `${id}%`]
  );
  if (!rows.length) {
    const err = new Error("Chofer no encontrado.");
    err.status = 404;
    throw err;
  }
  if (rows.length > 1 && !rows.some(row => String(row.id) === id)) {
    const err = new Error("El prefijo de ID coincide con varios choferes. Indica el UUID completo.");
    err.status = 409;
    throw err;
  }
  return rows.find(row => String(row.id) === id) || rows[0];
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
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_jornadas_abierta ON chofer_jornadas(empresa_id, chofer_id, estado) WHERE estado='abierta'").catch(failChoferSchema);
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_jornadas_fecha ON chofer_jornadas(empresa_id, chofer_id, inicio_at DESC)").catch(failChoferSchema);
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
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_vacaciones_empresa_estado ON chofer_vacaciones_solicitudes(empresa_id, estado, fecha_inicio)").catch(failChoferSchema);
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_vacaciones_chofer ON chofer_vacaciones_solicitudes(empresa_id, chofer_id, fecha_inicio DESC)").catch(failChoferSchema);
  vacacionesSchemaReady = true;
}

async function resolveChoferApp(req) {
  await ensureChoferesTransparencySchema();
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
    `SELECT ch.*, v.matricula AS vehiculo_matricula, v.km_actuales,
            v.remolque_id AS vehiculo_remolque_id, r.matricula AS remolque_matricula,
            v.gps_provider, v.gps_external_id, v.gps_lat, v.gps_lng,
            v.ubicacion_actual, v.ubicacion_ts
       FROM choferes ch
       LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id AND v.empresa_id=ch.empresa_id
       LEFT JOIN vehiculos r ON r.id=v.remolque_id AND r.empresa_id=v.empresa_id
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

function vehiculoTieneGpsExterno(row = {}) {
  const provider = String(row.gps_provider || "").trim().toLowerCase();
  const externalId = String(row.gps_external_id || "").trim();
  return !!(provider && provider !== "manual" && provider !== "app_chofer" && externalId);
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

async function notifyAsignacionConjunto(empresaId, tipo, titulo, mensaje, data = {}, actorId = null) {
  if (!empresaId) return;
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
    data,
    created_by: actorId,
  }).catch(() => null)));
}

async function setChoferConjunto({ empresaId, choferId, vehiculoId = null, remolqueId = null, actorId = null, notify = false }) {
  if (!empresaId || !choferId) return null;
  const chRes = await db.query(
    "SELECT id, nombre, apellidos, vehiculo_id, activo FROM choferes WHERE id=$1 AND empresa_id=$2 LIMIT 1",
    [choferId, empresaId]
  );
  const chofer = chRes.rows[0];
  if (!chofer) {
    const err = new Error("Chofer no encontrado");
    err.status = 404;
    throw err;
  }

  const nextVehiculoId = vehiculoId || null;
  const nextRemolqueId = remolqueId || null;
  let vehiculo = null;
  let remolque = null;
  if (nextVehiculoId) {
    const { rows } = await db.query(
      `SELECT v.*, ch.id AS asignado_chofer_id
         FROM vehiculos v
         LEFT JOIN choferes ch ON ch.vehiculo_id=v.id AND ch.empresa_id=v.empresa_id AND ch.id<>$3 AND ch.activo=true
        WHERE v.id=$1 AND v.empresa_id=$2 AND v.activo IS DISTINCT FROM false AND v.estado IS DISTINCT FROM 'baja'
        LIMIT 1`,
      [nextVehiculoId, empresaId, choferId]
    );
    vehiculo = rows[0];
    if (!vehiculo) {
      const err = new Error("La tractora seleccionada no existe o esta de baja.");
      err.status = 404;
      throw err;
    }
    if (vehiculo.asignado_chofer_id || (vehiculo.chofer_id && String(vehiculo.chofer_id) !== String(choferId))) {
      const err = new Error("La tractora ya esta asignada a otro chofer. Cambiala desde Trafico para mover el conjunto.");
      err.status = 409;
      throw err;
    }
  }
  if (nextRemolqueId) {
    if (!nextVehiculoId) {
      const err = new Error("Para asignar remolque primero selecciona una tractora.");
      err.status = 400;
      throw err;
    }
    const { rows } = await db.query(
      `SELECT r.*, t.id AS tractora_asignada_id, t.matricula AS tractora_asignada_matricula
         FROM vehiculos r
         LEFT JOIN vehiculos t ON t.remolque_id=r.id AND t.empresa_id=r.empresa_id AND t.id<>$3 AND t.activo=true
        WHERE r.id=$1 AND r.empresa_id=$2 AND r.activo IS DISTINCT FROM false AND r.estado IS DISTINCT FROM 'baja'
        LIMIT 1`,
      [nextRemolqueId, empresaId, nextVehiculoId]
    );
    remolque = rows[0];
    if (!remolque) {
      const err = new Error("El remolque seleccionado no existe o esta de baja.");
      err.status = 404;
      throw err;
    }
    if (remolque.tractora_asignada_id) {
      const err = new Error(`El remolque ya esta asignado a la tractora ${remolque.tractora_asignada_matricula}. Cambialo desde Trafico para moverlo.`);
      err.status = 409;
      throw err;
    }
  }

  await db.transaction(async client => {
    await client.query("UPDATE vehiculos SET chofer_id=NULL WHERE empresa_id=$1 AND chofer_id=$2", [empresaId, choferId]);
    if (chofer.vehiculo_id && (!nextVehiculoId || String(chofer.vehiculo_id) !== String(nextVehiculoId))) {
      await client.query(
        "UPDATE vehiculos SET chofer_id=NULL WHERE empresa_id=$1 AND id=$2 AND chofer_id=$3",
        [empresaId, chofer.vehiculo_id, choferId]
      );
    }
    await client.query(
      "UPDATE choferes SET vehiculo_id=$1 WHERE empresa_id=$2 AND id=$3",
      [nextVehiculoId, empresaId, choferId]
    );
    if (nextVehiculoId) {
      await client.query(
        "UPDATE vehiculos SET chofer_id=$1, remolque_id=$2, updated_at=NOW() WHERE empresa_id=$3 AND id=$4",
        [choferId, nextRemolqueId, empresaId, nextVehiculoId]
      );
    }
  });

  if (notify) {
    const nombre = `${chofer.nombre || ""} ${chofer.apellidos || ""}`.trim() || "Chofer";
    const conjunto = nextVehiculoId
      ? `${vehiculo?.matricula || "Tractora"}${remolque?.matricula ? ` + ${remolque.matricula}` : ""}`
      : "Sin conjunto";
    await notifyAsignacionConjunto(
      empresaId,
      "chofer_conjunto_actualizado",
      "Conjunto actualizado por chofer",
      `${nombre} ha actualizado su conjunto a ${conjunto}.`,
      { chofer_id: choferId, vehiculo_id: nextVehiculoId, remolque_id: nextRemolqueId, dedupe_key: `conjunto:${choferId}:${nextVehiculoId || "none"}:${nextRemolqueId || "none"}` },
      actorId
    ).catch(() => {});
  }

  const { rows } = await db.query(
    `SELECT ch.*, v.matricula AS vehiculo_matricula, v.km_actuales,
            v.remolque_id AS vehiculo_remolque_id, r.matricula AS remolque_matricula,
            v.gps_provider, v.gps_external_id, v.gps_lat, v.gps_lng,
            v.ubicacion_actual, v.ubicacion_ts
       FROM choferes ch
       LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id AND v.empresa_id=ch.empresa_id
       LEFT JOIN vehiculos r ON r.id=v.remolque_id AND r.empresa_id=v.empresa_id
      WHERE ch.id=$1 AND ch.empresa_id=$2
      LIMIT 1`,
    [choferId, empresaId]
  );
  return rows[0] || null;
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
             r.matricula AS remolque_matricula,
             COALESCE(ch.apellidos,'') AS apellidos
           FROM choferes ch
           LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id AND v.empresa_id=ch.empresa_id
           LEFT JOIN vehiculos r ON r.id=v.remolque_id AND r.empresa_id=v.empresa_id
           WHERE 1=1`;
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

router.post("/app/firma-base", requireChoferApp, async (req, res) => {
  try {
    await ensureChoferesTransparencySchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const chofer = await resolveChoferApp(req);
    if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
    const firma = String(req.body?.firma_png || req.body?.firma || "").trim();
    const nombre = String(req.body?.nombre || `${chofer.nombre || ""} ${chofer.apellidos || ""}`.trim()).trim();
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(firma)) {
      return res.status(400).json({ error: "Firma no valida" });
    }
    if (!nombre) return res.status(400).json({ error: "Indica el nombre de la firma" });
    validateBase64Upload({ data: firma, maxBytes: 1024 * 1024, allowedMimes: new Set(["image/png", "image/jpeg", "image/webp"]) });
    const { rows } = await db.query(
      `UPDATE choferes
          SET firma_base=$1,
              firma_base_nombre=$2,
              firma_base_fecha=NOW()
        WHERE id=$3 AND empresa_id=$4
        RETURNING *`,
      [firma, nombre, chofer.id, empresaId]
    );
    await notifyAsignacionConjunto(
      empresaId,
      "chofer_firma_base",
      "Firma de chofer registrada",
      `${nombre} ha registrado su firma base desde la app.`,
      { chofer_id: chofer.id },
      req.user?.id || null
    ).catch(() => {});
    res.json({ ok: true, chofer: rows[0] });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get("/app/conjunto", requireChoferApp, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  const vehiculoId = chofer.vehiculo_id || null;
  const remolqueId = chofer.vehiculo_remolque_id || null;
  const { rows: tractoras } = await db.query(
    `SELECT v.id, v.matricula, v.marca, v.modelo, v.clase, v.estado, v.remolque_id,
            CASE WHEN ch.id IS NOT NULL AND ch.id<>$2 THEN true ELSE false END AS ocupada
       FROM vehiculos v
       LEFT JOIN choferes ch ON ch.vehiculo_id=v.id AND ch.empresa_id=v.empresa_id AND ch.activo=true
      WHERE v.empresa_id=$1
        AND v.activo IS DISTINCT FROM false
        AND v.estado IS DISTINCT FROM 'baja'
        AND LOWER(COALESCE(v.clase,v.tipo,'')) NOT LIKE '%remolque%'
        AND LOWER(COALESCE(v.clase,v.tipo,'')) NOT LIKE '%semirremolque%'
        AND LOWER(COALESCE(v.clase,v.tipo,'')) NOT LIKE '%dolly%'
      ORDER BY ocupada ASC, v.matricula`,
    [empresaId, chofer.id]
  );
  const { rows: remolques } = await db.query(
    `SELECT r.id, r.matricula, r.marca, r.modelo, r.clase, r.estado,
            t.id AS tractora_id, t.matricula AS tractora_matricula,
            CASE WHEN t.id IS NOT NULL AND t.id<>$2 THEN true ELSE false END AS ocupado
       FROM vehiculos r
       LEFT JOIN vehiculos t ON t.remolque_id=r.id AND t.empresa_id=r.empresa_id AND t.activo=true AND ($2::uuid IS NULL OR t.id<>$2::uuid)
      WHERE r.empresa_id=$1
        AND r.activo IS DISTINCT FROM false
        AND r.estado IS DISTINCT FROM 'baja'
        AND (
          LOWER(COALESCE(r.clase,r.tipo,'')) LIKE '%remolque%'
          OR LOWER(COALESCE(r.clase,r.tipo,'')) LIKE '%semirremolque%'
          OR LOWER(COALESCE(r.clase,r.tipo,'')) LIKE '%dolly%'
          OR UPPER(COALESCE(r.matricula,'')) LIKE 'R-%'
          OR UPPER(COALESCE(r.matricula,'')) LIKE '%-R'
        )
      ORDER BY ocupado ASC, r.matricula`,
    [empresaId, vehiculoId]
  );
  res.json({
    chofer,
    conjunto: { vehiculo_id: vehiculoId, remolque_id: remolqueId },
    tractoras,
    remolques,
  });
});

router.post("/app/conjunto", requireChoferApp, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  if (chofer.activo === false || chofer.estado === "baja") return res.status(403).json({ error: "Tu ficha de chofer esta de baja." });
  try {
    const updated = await setChoferConjunto({
      empresaId,
      choferId: chofer.id,
      vehiculoId: req.body?.vehiculo_id || null,
      remolqueId: req.body?.remolque_id || null,
      actorId: req.user?.id || null,
      notify: true,
    });
    res.json({ chofer: updated, conjunto: { vehiculo_id: updated?.vehiculo_id || null, remolque_id: updated?.vehiculo_remolque_id || null } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post("/app/gps", requireChoferApp, async (req, res) => {
  await ensureChoferJornadaSchema();
  const empresaId = req.empresaId || req.user?.empresa_id;
  const chofer = await resolveChoferApp(req);
  if (!chofer) return res.status(404).json({ error: "Tu usuario no esta vinculado a una ficha de chofer" });
  if (!chofer.vehiculo_id) return res.json({ ok: true, skipped: "sin_vehiculo" });
  if (req.body?.vehiculo_id && String(req.body.vehiculo_id) !== String(chofer.vehiculo_id)) {
    return res.status(403).json({ error: "El vehiculo no esta asignado a tu ficha de chofer" });
  }
  if (vehiculoTieneGpsExterno(chofer)) return res.json({ ok: true, skipped: "gps_externo_configurado" });

  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Ubicacion GPS no valida" });
  }
  const velocidadKmh = req.body?.velocidad_kmh == null ? null : Number(req.body.velocidad_kmh);
  const accuracyM = req.body?.accuracy_m == null ? null : Number(req.body.accuracy_m);
  const recordedAt = req.body?.recorded_at ? new Date(req.body.recorded_at) : new Date();
  const recordedIso = Number.isFinite(recordedAt.getTime()) ? recordedAt.toISOString() : new Date().toISOString();

  const open = await db.query(
    `SELECT * FROM chofer_jornadas
      WHERE empresa_id=$1 AND chofer_id=$2 AND estado='abierta'
      ORDER BY inicio_at DESC
      LIMIT 1`,
    [empresaId, chofer.id]
  );
  const jornada = open.rows[0];
  if (!jornada) return res.json({ ok: true, skipped: "jornada_cerrada" });
  if (["pausa", "descanso", "fin"].includes(String(jornada.actividad_actual || "").toLowerCase())) {
    return res.json({ ok: true, skipped: "jornada_pausada" });
  }

  const ubicacion = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const { rows } = await db.query(
    `UPDATE vehiculos
        SET ubicacion_actual=$1,
            ubicacion_fuente='app_chofer',
            ubicacion_ts=$2::timestamptz,
            gps_lat=$3,
            gps_lng=$4,
            gps_provider=CASE
              WHEN gps_provider IS NULL OR gps_provider='' OR gps_provider='manual' THEN 'app_chofer'
              ELSE gps_provider
            END,
            updated_at=NOW()
      WHERE id=$5
        AND empresa_id=$6
        AND (
          gps_provider IS NULL
          OR gps_provider=''
          OR gps_provider IN ('manual','app_chofer')
          OR NULLIF(TRIM(COALESCE(gps_external_id,'')), '') IS NULL
        )
      RETURNING id, matricula, ubicacion_actual, ubicacion_ts, gps_lat, gps_lng, gps_provider`,
    [ubicacion, recordedIso, lat, lng, chofer.vehiculo_id, empresaId]
  );
  const vehiculo = rows[0];
  if (!vehiculo) return res.json({ ok: true, skipped: "gps_externo_configurado" });

  await db.query(
    `INSERT INTO gps_position_log
      (empresa_id, vehiculo_id, provider, external_id, lat, lng, ubicacion, velocidad_kmh, odometro_km, raw, recorded_at)
     VALUES ($1,$2,'app_chofer',$3,$4,$5,$6,$7,NULL,$8::jsonb,$9::timestamptz)`,
    [
      empresaId,
      chofer.vehiculo_id,
      `chofer:${chofer.id}`,
      lat,
      lng,
      ubicacion,
      Number.isFinite(velocidadKmh) ? velocidadKmh : null,
      JSON.stringify({
        source: "app_chofer",
        usuario_id: req.user?.id || null,
        chofer_id: chofer.id,
        jornada_id: jornada.id,
        accuracy_m: Number.isFinite(accuracyM) ? accuracyM : null,
      }),
      recordedIso,
    ]
  ).catch(() => {});

  res.json({ ok: true, vehiculo });
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
  if (kmInicio == null) return res.status(400).json({ error: "Kilometros de inicio obligatorios" });
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
  if (kmFin == null) return res.status(400).json({ error: "Kilometros de cierre obligatorios" });
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
  if (current.actividad_actual !== "descanso") {
    eventos.push({ tipo: "descanso", at: nowIso, objetivo_descanso_min: TACOGRAFO.descansoDiarioNormalMin, nota: "Descanso automatico al cerrar jornada" });
  }
  eventos.push({ tipo: "fin", at: nowIso, km: kmFin, noche: !!req.body?.hace_noche, nota: "Cierre de turno. El descanso se contabiliza hasta la siguiente apertura." });
  const { rows } = await db.query(
    `UPDATE chofer_jornadas
        SET estado='cerrada',
            fin_at=NOW(),
            actividad_actual='descanso',
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
    const {nombre,dni,telefono,email,vehiculo_id,categoria_carnet,apellidos,tipo_contrato,salario,notas,sexo,puesto_valor,fecha_alta,plataformas}=req.body;
    const empresaId = req.empresaId || req.user.empresa_id;
    const duplicate = await findDuplicateChofer({ empresaId, dni, email, telefono, nombre, apellidos });
    if (duplicate) {
      return res.status(409).json({
        error: duplicateChoferMessage(duplicate, { dni, email, telefono, nombre, apellidos }),
        duplicate_id: duplicate.id,
      });
    }
    const {rows}=await db.query(
      `INSERT INTO choferes (nombre,apellidos,dni,telefono,email,vehiculo_id,categoria_carnet,tipo_contrato,salario,notas,empresa_id,sexo,puesto_valor,fecha_alta,historial_laboral,plataformas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::date,CURRENT_DATE),$15::jsonb,$16::jsonb) RETURNING *`,
      [
        nombre,apellidos||null,dni||null,telefono||null,email||null,vehiculo_id||null,categoria_carnet||"C+E",tipo_contrato||null,salario||null,notas||null,empresaId,sexo||null,puesto_valor||null,
        fecha_alta || null,
        JSON.stringify([{ tipo:"alta", fecha: fecha_alta || new Date().toISOString().slice(0,10), usuario_id: req.user?.id || null, created_at: new Date().toISOString() }]),
        JSON.stringify(normalizePlataformas(plataformas))
      ]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/:id", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureChoferesTransparencySchema();
    const {nombre,apellidos,dni,telefono,email,vehiculo_id,categoria_carnet,activo,notas,tipo_contrato,salario,sexo,puesto_valor,estado,avisos,fecha_alta,fecha_baja,motivo_baja,carta_renuncia_nombre,carta_renuncia_mime,carta_renuncia_base64,plataformas}=req.body;
    const empresaId = req.empresaId || req.user.empresa_id;
    const current = await db.query("SELECT * FROM choferes WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
    if(!current.rows[0]) return res.status(404).json({error:"No encontrado"});
    const duplicate = await findDuplicateChofer({ empresaId, dni, email, telefono, nombre, apellidos, excludeId: req.params.id });
    if (duplicate) {
      return res.status(409).json({
        error: duplicateChoferMessage(duplicate, { dni, email, telefono, nombre, apellidos }),
        duplicate_id: duplicate.id,
      });
    }
    const previous = current.rows[0];
    const nextActivo = activo!==undefined ? activo !== false : previous.activo !== false;
    const currentHistorial = Array.isArray(previous.historial_laboral) ? previous.historial_laboral : [];
    let nextHistorial = currentHistorial;
    let nextEstado = estado || previous.estado || "disponible";
    let nextVehiculoId = vehiculo_id || null;
    let nextFechaBaja = fecha_baja || previous.fecha_baja || null;
    let nextMotivoBaja = motivo_baja || previous.motivo_baja || null;
    let nextCartaNombre = carta_renuncia_nombre || previous.carta_renuncia_nombre || null;
    let nextCartaMime = carta_renuncia_mime || previous.carta_renuncia_mime || null;
    let nextCartaBase64 = carta_renuncia_base64 || previous.carta_renuncia_base64 || null;
    if (carta_renuncia_base64) {
      const upload = validateBase64Upload({ data: carta_renuncia_base64, mime: carta_renuncia_mime, filename: carta_renuncia_nombre });
      nextCartaMime = upload.mime;
      nextCartaBase64 = upload.base64;
    }
    const nowIso = new Date().toISOString();
    if (!nextActivo) {
      if (!nextFechaBaja) return res.status(400).json({error:"Para dar de baja al chofer indica la fecha de baja."});
      if (!String(nextMotivoBaja || "").trim()) return res.status(400).json({error:"Para dar de baja al chofer indica el motivo."});
      if (!nextCartaBase64) return res.status(400).json({error:"Para dar de baja al chofer sube la carta de renuncia o baja."});
      nextEstado = "baja";
      nextVehiculoId = null;
      if (previous.activo !== false) {
        nextHistorial = [...currentHistorial, { tipo:"baja", fecha: nextFechaBaja, motivo: nextMotivoBaja, documento: nextCartaNombre, usuario_id: req.user?.id || null, created_at: nowIso }];
      }
    } else if (previous.activo === false) {
      const altaFecha = fecha_alta || new Date().toISOString().slice(0,10);
      nextEstado = estado || "disponible";
      nextFechaBaja = null;
      nextMotivoBaja = null;
      nextHistorial = [...currentHistorial, { tipo:"alta", fecha: altaFecha, usuario_id: req.user?.id || null, created_at: nowIso }];
    }
    const {rows}=await db.query(
      `UPDATE choferes
          SET nombre=$1,apellidos=$2,dni=$3,telefono=$4,email=$5,vehiculo_id=$6,categoria_carnet=$7,
              activo=$8,notas=$9,tipo_contrato=$10,salario=$11,sexo=$12,puesto_valor=$13,
              estado=COALESCE(NULLIF($14,''), estado),
              avisos=COALESCE($15::jsonb, avisos),
              fecha_alta=COALESCE($18::date, fecha_alta),
              fecha_baja=$19::date,
              motivo_baja=$20,
              carta_renuncia_nombre=$21,
              carta_renuncia_mime=$22,
              carta_renuncia_base64=$23,
              historial_laboral=$24::jsonb,
              plataformas=COALESCE($25::jsonb, plataformas)
        WHERE id=$16 AND empresa_id=$17
        RETURNING *`,
      [
        nombre,apellidos||null,dni||null,telefono||null,email||null,nextVehiculoId,categoria_carnet||"C+E",
        nextActivo,notas||null,tipo_contrato||null,salario||null,sexo||null,puesto_valor||null,
        nextEstado || null,
        Array.isArray(avisos) ? JSON.stringify(avisos.slice(0, 120)) : null,
        req.params.id,empresaId,
        fecha_alta || null,nextFechaBaja,nextMotivoBaja,nextCartaNombre,nextCartaMime,nextCartaBase64,JSON.stringify(nextHistorial.slice(-120)),
        Array.isArray(plataformas) ? JSON.stringify(normalizePlataformas(plataformas)) : null,
      ]
    );
    if(!rows[0]) return res.status(404).json({error:"No encontrado"});
    if (!nextActivo && previous.activo !== false) {
      await db.query(
        "UPDATE vehiculos SET chofer_id=NULL, updated_at=NOW() WHERE empresa_id=$1 AND (chofer_id=$2 OR id=$3)",
        [empresaId, req.params.id, previous.vehiculo_id || null]
      ).catch(() => {});
      if (previous.vehiculo_id) {
        const { rows: vehRows } = await db.query(
          `SELECT v.id, v.matricula, v.remolque_id, r.matricula AS remolque_matricula
             FROM vehiculos v
             LEFT JOIN vehiculos r ON r.id=v.remolque_id AND r.empresa_id=v.empresa_id
            WHERE v.id=$1 AND v.empresa_id=$2
            LIMIT 1`,
          [previous.vehiculo_id, empresaId]
        ).catch(() => ({ rows: [] }));
        const veh = vehRows[0];
        const nombre = `${previous.nombre || ""} ${previous.apellidos || ""}`.trim() || "Chofer";
        if (veh) {
          await notifyAsignacionConjunto(
            empresaId,
            "vehiculo_sin_chofer",
            "Vehiculo pendiente de asignacion",
            `${veh.matricula} se ha quedado sin chofer al dar de baja a ${nombre}.`,
            { chofer_id: req.params.id, vehiculo_id: veh.id, remolque_id: veh.remolque_id || null, dedupe_key: `vehiculo_sin_chofer:${veh.id}` },
            req.user?.id || null
          ).catch(() => {});
          if (veh.remolque_id) {
            await notifyAsignacionConjunto(
              empresaId,
              "remolque_sin_chofer",
              "Remolque en conjunto sin chofer",
              `${veh.remolque_matricula || "Un remolque"} queda en el conjunto ${veh.matricula}, pero el conjunto no tiene chofer asignado.`,
              { chofer_id: req.params.id, vehiculo_id: veh.id, remolque_id: veh.remolque_id, dedupe_key: `remolque_sin_chofer:${veh.remolque_id}` },
              req.user?.id || null
            ).catch(() => {});
          }
        }
      }
    } else if (nextActivo) {
      await setChoferConjunto({
        empresaId,
        choferId: req.params.id,
        vehiculoId: nextVehiculoId,
        remolqueId: req.body?.remolque_id || null,
        actorId: req.user?.id || null,
        notify: false,
      }).catch(() => {});
    }
    res.json(rows[0]);
  } catch(e) { res.status(e.status || 500).json({error:e.message}); }
});

// Eliminar chofer: SOLO gerente. Si tiene pedidos asociados hace baja blanda
// (conserva historico); si no, borrado real.
router.delete("/:id", SOLO_GERENTE, async (req, res) => {
  try {
    await ensureChoferesTransparencySchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const chofer = await resolveChoferByIdOrPrefix(empresaId, req.params.id);
    const choferId = chofer.id;

    const { rows: pedidoRows } = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM pedidos
        WHERE empresa_id=$1
          AND (chofer_id=$2 OR chofer2_id=$2)`,
      [empresaId, choferId]
    ).catch(() => ({ rows: [{ total: 0 }] }));
    const pedidosAsociados = Number(pedidoRows?.[0]?.total || 0);

    await db.query("UPDATE vehiculos SET chofer_id=NULL, updated_at=NOW() WHERE empresa_id=$1 AND chofer_id=$2", [empresaId, choferId]).catch(() => {});
    await db.query("UPDATE vehiculos SET chofer_id=NULL, updated_at=NOW() WHERE empresa_id=$1 AND id=$2", [empresaId, chofer.vehiculo_id || null]).catch(() => {});
    await db.query("UPDATE usuarios SET chofer_id=NULL WHERE empresa_id=$1 AND chofer_id=$2", [empresaId, choferId]).catch(() => {});

    if (pedidosAsociados > 0) {
      const historial = Array.isArray(chofer.historial_laboral) ? chofer.historial_laboral : [];
      const baja = {
        tipo: "baja",
        fecha: new Date().toISOString().slice(0, 10),
        motivo: "Eliminado desde ficha de chofer; conserva historico por pedidos asociados.",
        usuario_id: req.user?.id || null,
        created_at: new Date().toISOString(),
      };
      const { rows } = await db.query(
        `UPDATE choferes
            SET activo=false,
                estado='baja',
                vehiculo_id=NULL,
                fecha_baja=COALESCE(fecha_baja, CURRENT_DATE),
                motivo_baja=COALESCE(NULLIF(motivo_baja,''), $3),
                historial_laboral=$4::jsonb
          WHERE id=$1 AND empresa_id=$2
          RETURNING *`,
        [choferId, empresaId, baja.motivo, JSON.stringify([...historial, baja].slice(-120))]
      );
      return res.json({ ok: true, mode: "soft_delete", chofer: rows[0], pedidos_asociados: pedidosAsociados });
    }

    await db.query("DELETE FROM choferes WHERE id=$1 AND empresa_id=$2", [choferId, empresaId]);
    res.json({ ok: true, mode: "hard_delete", id: choferId });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo eliminar el chofer." });
  }
});

router.initializeSchema = async function initializeChoferesSchema() {
  await ensureChoferesTransparencySchema();
  await ensureChoferJornadaSchema();
  await ensureChoferVacacionesSchema();
};

module.exports = router;
