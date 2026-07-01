const express = require("express");
const db = require("../services/db");
const { authenticate, requireRole } = require("../middleware/auth");
const { enviarEmail } = require("../services/email");
const { crearNotificacion } = require("../services/notificaciones");
const logger = require("../services/logger");

const router = express.Router();

router.use(authenticate);

const PUEDE_EDITAR_TALLER = requireRole("gerente", "contable", "responsable_taller");
const PUEDE_GESTIONAR_SOLICITUDES = requireRole("gerente", "contable", "responsable_taller", "trafico");

const DEFAULT_DATA = {
  stock: [],
  reparaciones: [],
  historial_vh: {},
  proveedores: [],
  avisos_mant: [],
  tareas_mecanicos: [],
  neumaticos_stock: [],
  neumaticos_vehiculos: {},
  lucro_cesante: {},
  lucro_cesante_archivo: [],
  solicitudes_mecanico: [],
  entregas_equipos_choferes: {},
};

function empresaId(req) {
  return req.user?.empresa_id;
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function num(value, fallback = 0) {
  const clean = emptyToNull(value);
  if (clean === null) return fallback;
  const n = Number(clean);
  return Number.isFinite(n) ? n : fallback;
}

function barcode(prefix = "TG") {
  const tail = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${tail}`;
}

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

let tallerUnidadesSchemaPromise = null;
let tallerIntervencionesExtraSchemaPromise = null;
let tallerPiezasSchemaPromise = null;

async function ensureTallerPiezasSchema() {
  if (!tallerPiezasSchemaPromise) {
    tallerPiezasSchemaPromise = (async () => {
      await db.query("ALTER TABLE taller_piezas ADD COLUMN IF NOT EXISTS tipo_stock VARCHAR(30) NOT NULL DEFAULT 'pieza_taller'").catch(() => {});
      await db.query("ALTER TABLE taller_piezas ADD COLUMN IF NOT EXISTS unidad_medida VARCHAR(30) NOT NULL DEFAULT 'ud'").catch(() => {});
      await db.query("ALTER TABLE taller_piezas ADD COLUMN IF NOT EXISTS precio_venta NUMERIC(12,4) NOT NULL DEFAULT 0").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_taller_piezas_tipo ON taller_piezas(empresa_id, tipo_stock, activo)").catch(() => {});
    })().catch((error) => {
      tallerPiezasSchemaPromise = null;
      throw error;
    });
  }
  await tallerPiezasSchemaPromise;
}

async function ensureTallerIntervencionesExtraSchema() {
  if (!tallerIntervencionesExtraSchemaPromise) {
    tallerIntervencionesExtraSchemaPromise = (async () => {
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS origen_taller VARCHAR(30) NOT NULL DEFAULT 'propio'").catch(() => {});
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS proveedor_id VARCHAR(120)").catch(() => {});
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS factura_proveedor_num VARCHAR(120)").catch(() => {});
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS factura_proveedor_nombre VARCHAR(200)").catch(() => {});
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS factura_proveedor_importe NUMERIC(12,2) NOT NULL DEFAULT 0").catch(() => {});
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS factura_proveedor_fecha DATE").catch(() => {});
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS factura_proveedor_file_name VARCHAR(240)").catch(() => {});
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS factura_proveedor_file_mime VARCHAR(120)").catch(() => {});
      await db.query("ALTER TABLE taller_intervenciones ADD COLUMN IF NOT EXISTS factura_proveedor_file_base64 TEXT").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_taller_intervenciones_externo ON taller_intervenciones(empresa_id, origen_taller, fecha DESC)").catch(() => {});
    })().catch((error) => {
      tallerIntervencionesExtraSchemaPromise = null;
      throw error;
    });
  }
  await tallerIntervencionesExtraSchemaPromise;
}

async function ensureTallerUnidadesSchema() {
  if (!tallerUnidadesSchemaPromise) {
    tallerUnidadesSchemaPromise = (async () => {
      await ensureTallerPiezasSchema();
      await db.query(`
        CREATE TABLE IF NOT EXISTS taller_pieza_unidades (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pieza_id UUID NOT NULL REFERENCES taller_piezas(id) ON DELETE CASCADE,
          codigo_unidad VARCHAR(140) NOT NULL,
          estado VARCHAR(30) NOT NULL DEFAULT 'stock',
          vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
          matricula_snapshot VARCHAR(40),
          intervencion_id UUID REFERENCES taller_intervenciones(id) ON DELETE SET NULL,
          precio_unitario NUMERIC(12,4) NOT NULL DEFAULT 0,
          salida_at TIMESTAMPTZ,
          salida_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          notas TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_taller_pieza_unidades_codigo ON taller_pieza_unidades(empresa_id, codigo_unidad)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_taller_pieza_unidades_pieza_estado ON taller_pieza_unidades(empresa_id, pieza_id, estado)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_taller_pieza_unidades_vehiculo ON taller_pieza_unidades(empresa_id, vehiculo_id, salida_at DESC)");
      await db.query("ALTER TABLE taller_intervencion_piezas ADD COLUMN IF NOT EXISTS unidad_id UUID REFERENCES taller_pieza_unidades(id) ON DELETE SET NULL").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_taller_intervencion_piezas_unidad ON taller_intervencion_piezas(empresa_id, unidad_id)").catch(() => {});
    })().catch((error) => {
      tallerUnidadesSchemaPromise = null;
      throw error;
    });
  }
  await tallerUnidadesSchemaPromise;
}

const ESTADOS_SOLICITUD_TALLER = new Set(["pendiente", "en_proceso", "resuelto", "cerrado", "cancelado"]);
const URGENCIAS_SOLICITUD_TALLER = new Set(["normal", "urgente", "critica"]);

function prioridadSolicitudTaller(urgencia) {
  if (urgencia === "critica") return 100;
  if (urgencia === "urgente") return 60;
  return 20;
}

function eventoSolicitudTaller(tipo, req, detalle = {}) {
  return {
    tipo,
    fecha: new Date().toISOString(),
    actor_id: req.user?.id || null,
    actor_nombre: req.user?.nombre || req.user?.email || "Sistema",
    actor_rol: req.user?.rol || null,
    detalle,
  };
}

async function notificarSolicitudTaller(empresaId, solicitud) {
  const { rows } = await db.query(
    `SELECT DISTINCT id, email, nombre, rol
       FROM usuarios
      WHERE empresa_id=$1
        AND activo=true
        AND email IS NOT NULL
        AND TRIM(email) <> ''
        AND rol IN ('gerente','responsable_taller','trafico')
      ORDER BY rol, nombre`,
    [empresaId]
  );
  if (!rows.length) return { destinatarios: 0 };
  await Promise.all(rows.map(async u => {
    await crearNotificacion({
      empresa_id: empresaId,
      usuario_id: u.id,
      tipo: "taller_solicitud",
      titulo: solicitud.urgencia === "critica" ? "Solicitud critica de taller" : "Nueva solicitud de taller",
      mensaje: `${solicitud.chofer_nombre || "Chofer"} solicita ${solicitud.motivo_label || solicitud.motivo || "revision"}${solicitud.vehiculo ? ` en ${solicitud.vehiculo}` : ""}.`,
      data: { solicitud_id: solicitud.id, urgencia: solicitud.urgencia, vehiculo: solicitud.vehiculo || solicitud.vehiculo_matricula || null },
      created_by: solicitud.created_by || null,
    }).catch(e => logger.warn("No se pudo crear notificacion taller:", e.message));
    await enviarEmail({
      trigger: "taller_solicitud",
      destinatario: u.email,
      plantilla: "taller_solicitud",
      empresa_id: empresaId,
      datos: {
        destinatario: u.nombre || u.email,
        chofer: solicitud.chofer_nombre,
        vehiculo: solicitud.vehiculo || solicitud.vehiculo_matricula || "Sin vehiculo",
        motivo: solicitud.motivo_label || solicitud.motivo,
        urgencia: solicitud.urgencia,
        observaciones: solicitud.observaciones,
        ubicacion: solicitud.ubicacion,
        fecha: solicitud.fecha,
        pedido: solicitud.pedido_numero,
      },
    }).catch(e => logger.warn("No se pudo enviar aviso taller:", e.message));
  }));
  return { destinatarios: rows.length };
}

async function notificarRespuestaSolicitudTaller(empresaId, solicitud, req) {
  const usuarioId = solicitud.created_by || solicitud.chofer_id;
  if (!usuarioId) return null;
  return crearNotificacion({
    empresa_id: empresaId,
    usuario_id: usuarioId,
    tipo: "taller_solicitud_actualizada",
    titulo: "Taller ha actualizado tu solicitud",
    mensaje: `${solicitud.motivo_label || solicitud.motivo || "Solicitud"}: ${solicitud.estado || "actualizada"}.`,
    data: {
      solicitud_id: solicitud.id,
      estado: solicitud.estado,
      respuesta_taller: solicitud.respuesta_taller || "",
      orden_trabajo_id: solicitud.orden_trabajo_id || null,
    },
    created_by: req.user?.id || null,
  }).catch(e => logger.warn("No se pudo notificar al chofer:", e.message));
}

function normalizar(data) {
  return {
    ...DEFAULT_DATA,
    ...(data && typeof data === "object" ? data : {}),
  };
}

router.get("/estado", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const { rows } = await db.query(
    "SELECT data FROM taller_estado WHERE empresa_id=$1",
    [empresaId(req)]
  );
  res.json(normalizar(rows[0]?.data));
});

router.put("/estado", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const data = normalizar(req.body || {});
  const currentRows = await db.query(
    "SELECT data FROM taller_estado WHERE empresa_id=$1",
    [empresaId(req)]
  ).catch(() => ({ rows: [] }));
  const current = normalizar(currentRows.rows[0]?.data);
  const mergedSolicitudes = new Map();
  (current.solicitudes_mecanico || []).forEach(s => {
    if (s?.id) mergedSolicitudes.set(String(s.id), s);
  });
  (data.solicitudes_mecanico || []).forEach(s => {
    if (s?.id) mergedSolicitudes.set(String(s.id), s);
  });
  data.solicitudes_mecanico = [...mergedSolicitudes.values()]
    .sort((a, b) => new Date(b.fecha || b.updated_at || 0) - new Date(a.fecha || a.updated_at || 0))
    .slice(0, 300);
  await db.query(
    `INSERT INTO taller_estado (empresa_id, data, updated_by, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (empresa_id)
     DO UPDATE SET data=$2, updated_by=$3, updated_at=NOW()`,
    [empresaId(req), data, req.user.id]
  );
  res.json({ ok: true, data });
});

router.get("/solicitudes", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const { rows } = await db.query(
    "SELECT data FROM taller_estado WHERE empresa_id=$1",
    [empresaId(req)]
  );
  let solicitudes = normalizar(rows[0]?.data).solicitudes_mecanico || [];
  if (req.user?.rol === "chofer") {
    const uid = String(req.user.id || "");
    const nombre = String(req.user.nombre || req.user.email || "").trim().toLowerCase();
    solicitudes = solicitudes.filter(s =>
      String(s.chofer_id || "") === uid ||
      String(s.created_by || "") === uid ||
      String(s.chofer_nombre || "").trim().toLowerCase() === nombre
    );
  }
  res.json(solicitudes);
});

router.get("/solicitudes/capacidades", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const [{ rows: estadoRows }, { rows: mecanicosRows }] = await Promise.all([
    db.query("SELECT data FROM taller_estado WHERE empresa_id=$1", [empresaId(req)]).catch(() => ({ rows: [] })),
    db.query(
      "SELECT COUNT(*)::int AS total FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('mecanico','responsable_taller')",
      [empresaId(req)]
    ).catch(() => ({ rows: [{ total: 0 }] })),
  ]);
  const data = normalizar(estadoRows[0]?.data);
  const proveedores = Array.isArray(data.proveedores) ? data.proveedores.filter(p => p && p.nombre) : [];
  const mecanicos = Number(mecanicosRows[0]?.total || 0);
  res.json({
    mecanicos,
    proveedores_taller: proveedores.length,
    proveedores: proveedores.map(p => ({
      id: p.id || p.nombre,
      nombre: p.nombre || "",
      telefono: p.telefono || "",
      email: p.email || "",
    })).slice(0, 50),
    puede_mecanico: mecanicos > 0,
    puede_taller_externo: proveedores.length > 0,
  });
});

router.post("/solicitudes", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const body = req.body || {};
  if (!body.motivo && !body.motivo_label) return res.status(400).json({ error: "Motivo obligatorio" });
  const { rows } = await db.query(
    "SELECT data FROM taller_estado WHERE empresa_id=$1",
    [empresaId(req)]
  );
  const data = normalizar(rows[0]?.data);
  const proveedores = Array.isArray(data.proveedores) ? data.proveedores.filter(p => p && p.nombre) : [];
  const { rows: mecanicosRows } = await db.query(
    "SELECT COUNT(*)::int AS total FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('mecanico','responsable_taller')",
    [empresaId(req)]
  ).catch(() => ({ rows: [{ total: 0 }] }));
  const puedeMecanico = Number(mecanicosRows[0]?.total || 0) > 0;
  const puedeTallerExterno = proveedores.length > 0;
  if (!puedeMecanico && !puedeTallerExterno) {
    return res.status(409).json({ error: "No hay mecanicos ni talleres externos configurados para recibir solicitudes." });
  }
  let canal = String(body.canal || "").toLowerCase();
  if (!["mecanico", "taller_externo"].includes(canal)) canal = puedeMecanico ? "mecanico" : "taller_externo";
  if (canal === "mecanico" && !puedeMecanico) {
    return res.status(409).json({ error: "La empresa no tiene mecanico interno configurado. Selecciona un taller externo." });
  }
  if (canal === "taller_externo" && !puedeTallerExterno) {
    return res.status(409).json({ error: "La empresa no tiene talleres externos configurados." });
  }
  const proveedorId = body.proveedor_id ? String(body.proveedor_id) : "";
  const proveedor = canal === "taller_externo"
    ? (proveedores.find(p => String(p.id || p.nombre) === proveedorId) || proveedores[0])
    : null;
  const solicitud = {
    id: body.id || `sol_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    chofer_nombre: body.chofer_nombre || req.user?.nombre || req.user?.email || "Chofer",
    chofer_id: body.chofer_id || req.user?.id || null,
    created_by: req.user?.id || null,
    vehiculo: body.vehiculo || null,
    vehiculo_id: body.vehiculo_id || null,
    motivo: body.motivo || body.motivo_label,
    motivo_label: body.motivo_label || body.motivo,
    observaciones: body.observaciones || "",
    canal,
    proveedor_id: proveedor?.id || null,
    proveedor_nombre: proveedor?.nombre || "",
    urgencia: URGENCIAS_SOLICITUD_TALLER.has(body.urgencia) ? body.urgencia : "normal",
    prioridad: prioridadSolicitudTaller(URGENCIAS_SOLICITUD_TALLER.has(body.urgencia) ? body.urgencia : "normal"),
    fecha: body.fecha || new Date().toISOString(),
    estado: ESTADOS_SOLICITUD_TALLER.has(body.estado) ? body.estado : "pendiente",
    pedido_numero: body.pedido_numero || null,
    pedido_id: body.pedido_id || null,
    ubicacion: body.ubicacion || "",
    origen: body.origen || (req.user?.rol === "chofer" ? "app_chofer" : "programa"),
    eventos: [eventoSolicitudTaller("solicitud.creada", req, {
      urgencia: URGENCIAS_SOLICITUD_TALLER.has(body.urgencia) ? body.urgencia : "normal",
      vehiculo: body.vehiculo || body.vehiculo_matricula || null,
      canal,
      proveedor_nombre: proveedor?.nombre || "",
    })],
    notificacion_taller_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const solicitudes = Array.isArray(data.solicitudes_mecanico) ? data.solicitudes_mecanico : [];
  const yaExistente = solicitudes.find(s => String(s.id) === String(solicitud.id));
  data.solicitudes_mecanico = [solicitud, ...solicitudes.filter(s => s.id !== solicitud.id)].slice(0, 300);
  await db.query(
    `INSERT INTO taller_estado (empresa_id, data, updated_by, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (empresa_id)
     DO UPDATE SET data=$2, updated_by=$3, updated_at=NOW()`,
    [empresaId(req), data, req.user.id]
  );
  if (!yaExistente) {
    notificarSolicitudTaller(empresaId(req), solicitud).catch(e => logger.warn("Aviso taller solicitud:", e.message));
  }
  res.status(yaExistente ? 200 : 201).json({ ...solicitud, sincronizada: !!yaExistente });
});

router.patch("/solicitudes/:id", PUEDE_GESTIONAR_SOLICITUDES, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const { rows } = await db.query(
    "SELECT data FROM taller_estado WHERE empresa_id=$1",
    [empresaId(req)]
  );
  const data = normalizar(rows[0]?.data);
  const solicitudes = Array.isArray(data.solicitudes_mecanico) ? data.solicitudes_mecanico : [];
  let found = null;
  data.solicitudes_mecanico = solicitudes.map(s => {
    if (String(s.id) !== String(req.params.id)) return s;
    const prevEstado = s.estado || "pendiente";
    const body = req.body || {};
    const estado = ESTADOS_SOLICITUD_TALLER.has(body.estado) ? body.estado : prevEstado;
    const urgencia = URGENCIAS_SOLICITUD_TALLER.has(body.urgencia) ? body.urgencia : (s.urgencia || "normal");
    const eventos = Array.isArray(s.eventos) ? s.eventos.slice(-30) : [];
    const detalle = {};
    if (estado !== prevEstado) detalle.estado = { antes: prevEstado, despues: estado };
    if (body.respuesta_taller !== undefined) detalle.respuesta_taller = String(body.respuesta_taller || "").slice(0, 500);
    if (body.orden_trabajo_id !== undefined) detalle.orden_trabajo_id = body.orden_trabajo_id || null;
    if (body.orden_trabajo_numero !== undefined) detalle.orden_trabajo_numero = body.orden_trabajo_numero || null;
    if (Object.keys(detalle).length) eventos.push(eventoSolicitudTaller(estado !== prevEstado ? "estado.actualizado" : "solicitud.actualizada", req, detalle));
    found = {
      ...s,
      id: s.id,
      estado,
      urgencia,
      prioridad: prioridadSolicitudTaller(urgencia),
      respuesta_taller: body.respuesta_taller !== undefined ? String(body.respuesta_taller || "").slice(0, 500) : s.respuesta_taller,
      orden_trabajo_id: body.orden_trabajo_id !== undefined ? body.orden_trabajo_id : s.orden_trabajo_id,
      orden_trabajo_numero: body.orden_trabajo_numero !== undefined ? body.orden_trabajo_numero : s.orden_trabajo_numero,
      taller_notas: body.taller_notas !== undefined ? String(body.taller_notas || "").slice(0, 1000) : s.taller_notas,
      iniciado_at: estado === "en_proceso" && !s.iniciado_at ? new Date().toISOString() : s.iniciado_at,
      resuelto_at: ["resuelto", "cerrado"].includes(estado) && !s.resuelto_at ? new Date().toISOString() : s.resuelto_at,
      eventos,
      updated_at: new Date().toISOString(),
      atendido_por: req.user?.nombre || req.user?.email || s.atendido_por,
    };
    return found;
  });
  if (!found) return res.status(404).json({ error: "Solicitud no encontrada" });
  await db.query(
    `INSERT INTO taller_estado (empresa_id, data, updated_by, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (empresa_id)
     DO UPDATE SET data=$2, updated_by=$3, updated_at=NOW()`,
    [empresaId(req), data, req.user.id]
  );
  if (["en_proceso", "resuelto", "cerrado"].includes(found.estado)) {
    notificarRespuestaSolicitudTaller(empresaId(req), found, req);
  }
  res.json(found);
});

router.get("/piezas", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerPiezasSchema();
  await ensureTallerUnidadesSchema();
  const { q, bajo_minimo, tipo_stock } = req.query;
  const params = [empresaId(req)];
  const where = ["p.empresa_id=$1", "p.activo=true"];
  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where.push(`(LOWER(p.nombre) LIKE $${params.length} OR LOWER(COALESCE(p.referencia,'')) LIKE $${params.length} OR LOWER(COALESCE(p.codigo_barras,'')) LIKE $${params.length})`);
  }
  if (bajo_minimo === "true") where.push("p.stock_actual <= p.stock_minimo");
  if (tipo_stock && tipo_stock !== "todos") {
    params.push(String(tipo_stock));
    where.push(`p.tipo_stock=$${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT p.*, a.nombre AS almacen_nombre,
            COALESCE(u.total_unidades,0)::int AS unidades_total,
            COALESCE(u.stock_unidades,0)::int AS unidades_stock
       FROM taller_piezas p
       LEFT JOIN almacenes a ON a.id=p.almacen_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_unidades,
                COUNT(*) FILTER (WHERE estado='stock') AS stock_unidades
           FROM taller_pieza_unidades u
          WHERE u.empresa_id=p.empresa_id AND u.pieza_id=p.id
       ) u ON TRUE
      WHERE ${where.join(" AND ")}
      ORDER BY p.nombre`,
    params
  );
  res.json(rows);
});

router.get("/piezas/codigo/:codigo", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerPiezasSchema();
  await ensureTallerUnidadesSchema();
  const code = String(req.params.codigo || "").trim().toLowerCase();
  if (!code) return res.status(400).json({ error: "Codigo obligatorio" });
  const { rows } = await db.query(
    `SELECT p.*, a.nombre AS almacen_nombre,
            u.id AS unidad_id, u.codigo_unidad, u.estado AS unidad_estado, u.vehiculo_id AS unidad_vehiculo_id
       FROM taller_piezas p
       LEFT JOIN almacenes a ON a.id=p.almacen_id
       LEFT JOIN taller_pieza_unidades u ON u.pieza_id=p.id AND u.empresa_id=p.empresa_id AND LOWER(u.codigo_unidad)=$2
      WHERE p.empresa_id=$1
        AND p.activo=true
        AND (
          LOWER(COALESCE(p.codigo_barras,''))=$2
          OR LOWER(COALESCE(p.referencia,''))=$2
          OR LOWER(COALESCE(u.codigo_unidad,''))=$2
        )
      ORDER BY CASE WHEN LOWER(COALESCE(u.codigo_unidad,''))=$2 THEN 0 ELSE 1 END, p.updated_at DESC
      LIMIT 1`,
    [empresaId(req), code]
  );
  if (!rows[0]) return res.status(404).json({ error: "Pieza no encontrada" });
  res.json(rows[0]);
});

router.get("/piezas/:id/unidades", asyncRoute(async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerUnidadesSchema();
  const { estado } = req.query;
  const params = [empresaId(req), req.params.id];
  const where = ["u.empresa_id=$1", "u.pieza_id=$2"];
  if (estado) {
    params.push(estado);
    where.push(`u.estado=$${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT u.*, p.nombre AS pieza_nombre, p.referencia, p.codigo_barras AS codigo_producto,
            v.matricula AS vehiculo_matricula
       FROM taller_pieza_unidades u
       JOIN taller_piezas p ON p.id=u.pieza_id AND p.empresa_id=u.empresa_id
       LEFT JOIN vehiculos v ON v.id=u.vehiculo_id
      WHERE ${where.join(" AND ")}
      ORDER BY u.estado, u.created_at DESC`,
    params
  );
  res.json(rows);
}));

router.get("/piezas/unidades/historial", asyncRoute(async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerUnidadesSchema();
  const { vehiculo_id, matricula, q, estado } = req.query;
  const params = [empresaId(req)];
  const where = ["u.empresa_id=$1"];
  if (vehiculo_id) {
    params.push(vehiculo_id);
    where.push(`u.vehiculo_id=$${params.length}`);
  }
  if (matricula) {
    params.push(String(matricula).trim().toUpperCase());
    where.push(`UPPER(REPLACE(COALESCE(v.matricula,u.matricula_snapshot,''),' ',''))=UPPER(REPLACE($${params.length},' ',''))`);
  }
  if (estado) {
    params.push(estado);
    where.push(`u.estado=$${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(p.nombre,'')) LIKE $${params.length}
      OR LOWER(COALESCE(p.referencia,'')) LIKE $${params.length}
      OR LOWER(COALESCE(p.codigo_barras,'')) LIKE $${params.length}
      OR LOWER(COALESCE(u.codigo_unidad,'')) LIKE $${params.length}
      OR LOWER(COALESCE(v.matricula,u.matricula_snapshot,'')) LIKE $${params.length}
    )`);
  }
  const { rows } = await db.query(
    `SELECT u.*, p.nombre AS pieza_nombre, p.referencia, p.codigo_barras AS codigo_producto,
            v.matricula AS vehiculo_matricula,
            i.fecha AS intervencion_fecha, i.tipo AS intervencion_tipo, i.descripcion AS intervencion_descripcion,
            i.estado AS intervencion_estado
       FROM taller_pieza_unidades u
       JOIN taller_piezas p ON p.id=u.pieza_id AND p.empresa_id=u.empresa_id
       LEFT JOIN vehiculos v ON v.id=u.vehiculo_id
       LEFT JOIN taller_intervenciones i ON i.id=u.intervencion_id AND i.empresa_id=u.empresa_id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(u.salida_at,u.updated_at,u.created_at) DESC
      LIMIT 500`,
    params
  );
  res.json(rows);
}));

router.post("/piezas/:id/unidades/generar", PUEDE_EDITAR_TALLER, asyncRoute(async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerUnidadesSchema();
  const cantidad = Math.max(1, Math.min(Math.floor(num(req.body?.cantidad, 1)), 500));
  const empresa = empresaId(req);
  const result = await db.transaction(async client => {
    const piezaRes = await client.query(
      "SELECT * FROM taller_piezas WHERE id=$1 AND empresa_id=$2 AND activo=true",
      [req.params.id, empresa]
    );
    const pieza = piezaRes.rows[0];
    if (!pieza) {
      const err = new Error("Pieza no encontrada");
      err.statusCode = 404;
      throw err;
    }
    const inserted = [];
    for (let i = 0; i < cantidad; i += 1) {
      const prefix = String(pieza.referencia || pieza.codigo_barras || "PZ").replace(/[^0-9A-Z-]/gi, "").slice(0, 18).toUpperCase() || "PZ";
      const code = `${prefix}-U${String(Date.now()).slice(-6)}${String(i + 1).padStart(3, "0")}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const { rows } = await client.query(
        `INSERT INTO taller_pieza_unidades
          (empresa_id,pieza_id,codigo_unidad,precio_unitario,estado)
         VALUES ($1,$2,$3,$4,'stock')
         RETURNING *`,
        [empresa, pieza.id, code, num(pieza.precio_compra)]
      );
      inserted.push(rows[0]);
    }
    return { pieza, unidades: inserted };
  });
  res.status(201).json(result);
}));

router.post("/piezas/unidades/asignar", PUEDE_EDITAR_TALLER, asyncRoute(async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerUnidadesSchema();
  const empresa = empresaId(req);
  const codigo = String(req.body?.codigo || "").trim();
  const matricula = String(req.body?.matricula || "").trim().toUpperCase();
  const intervencionSolicitada = emptyToNull(req.body?.intervencion_id);
  if (!codigo) return res.status(400).json({ error: "Escanea o introduce el codigo de la unidad o de la pieza" });
  if (!matricula) return res.status(400).json({ error: "Introduce la matricula del vehiculo" });

  const result = await db.transaction(async client => {
    const vehRes = await client.query(
      "SELECT id, matricula FROM vehiculos WHERE empresa_id=$1 AND activo IS DISTINCT FROM false AND UPPER(REPLACE(matricula,' ',''))=UPPER(REPLACE($2,' ','')) LIMIT 1",
      [empresa, matricula]
    );
    const vehiculo = vehRes.rows[0];
    if (!vehiculo) {
      const err = new Error("No se encontro un vehiculo activo con esa matricula");
      err.statusCode = 404;
      throw err;
    }

    const lower = codigo.toLowerCase();
    let unidadRes = await client.query(
      `SELECT u.*, p.nombre AS pieza_nombre, p.precio_compra, p.stock_actual
         FROM taller_pieza_unidades u
         JOIN taller_piezas p ON p.id=u.pieza_id AND p.empresa_id=u.empresa_id
        WHERE u.empresa_id=$1 AND LOWER(u.codigo_unidad)=$2
        LIMIT 1
        FOR UPDATE OF u`,
      [empresa, lower]
    );
    let unidad = unidadRes.rows[0] || null;
    let pieza = null;

    if (!unidad) {
      const piezaRes = await client.query(
        `SELECT *
           FROM taller_piezas
          WHERE empresa_id=$1 AND activo=true
            AND (LOWER(COALESCE(codigo_barras,''))=$2 OR LOWER(COALESCE(referencia,''))=$2)
          LIMIT 1
          FOR UPDATE`,
        [empresa, lower]
      );
      pieza = piezaRes.rows[0] || null;
      if (!pieza) {
        const err = new Error("No se encontro ninguna pieza o unidad con ese codigo");
        err.statusCode = 404;
        throw err;
      }
      if (num(pieza.stock_actual) <= 0) {
        const err = new Error("La pieza existe, pero no tiene stock disponible");
        err.statusCode = 409;
        throw err;
      }
      const disponible = await client.query(
        `SELECT *
           FROM taller_pieza_unidades
          WHERE empresa_id=$1 AND pieza_id=$2 AND estado='stock'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE`,
        [empresa, pieza.id]
      );
      unidad = disponible.rows[0] || null;
      if (!unidad) {
        const generatedCode = `${String(pieza.referencia || pieza.codigo_barras || "PZ").replace(/[^0-9A-Z-]/gi, "").slice(0,18).toUpperCase() || "PZ"}-U${Date.now().toString(36).toUpperCase()}`;
        const created = await client.query(
          `INSERT INTO taller_pieza_unidades
            (empresa_id,pieza_id,codigo_unidad,precio_unitario,estado)
           VALUES ($1,$2,$3,$4,'stock')
           RETURNING *`,
          [empresa, pieza.id, generatedCode, num(pieza.precio_compra)]
        );
        unidad = created.rows[0];
      }
    } else {
      if (unidad.estado !== "stock") {
        const err = new Error(`La unidad ${unidad.codigo_unidad} ya no esta en stock`);
        err.statusCode = 409;
        throw err;
      }
      const piezaRes = await client.query(
        "SELECT * FROM taller_piezas WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
        [unidad.pieza_id, empresa]
      );
      pieza = piezaRes.rows[0];
    }

    const assigned = await client.query(
      `UPDATE taller_pieza_unidades
          SET estado='montada',
              vehiculo_id=$1,
              matricula_snapshot=$2,
              salida_at=NOW(),
              salida_por=$3,
              updated_at=NOW()
        WHERE id=$4 AND empresa_id=$5 AND estado='stock'
        RETURNING *`,
      [vehiculo.id, vehiculo.matricula, req.user?.id || null, unidad.id, empresa]
    );
    if (!assigned.rows[0]) {
      const err = new Error("La unidad ya ha sido asignada por otro usuario");
      err.statusCode = 409;
      throw err;
    }
    await client.query(
      "UPDATE taller_piezas SET stock_actual=GREATEST(stock_actual-1,0), updated_at=NOW() WHERE id=$1 AND empresa_id=$2",
      [unidad.pieza_id, empresa]
    );

    let intervencion = null;
    if (intervencionSolicitada) {
      const intRes = await client.query(
        "SELECT * FROM taller_intervenciones WHERE id=$1 AND empresa_id=$2 AND vehiculo_id=$3 LIMIT 1",
        [intervencionSolicitada, empresa, vehiculo.id]
      );
      intervencion = intRes.rows[0] || null;
    }
    if (!intervencion) {
      const intRes = await client.query(
        `SELECT *
           FROM taller_intervenciones
          WHERE empresa_id=$1
            AND vehiculo_id=$2
            AND fecha=CURRENT_DATE
            AND tipo='Salida de recambios'
            AND estado='abierta'
          ORDER BY created_at DESC
          LIMIT 1`,
        [empresa, vehiculo.id]
      );
      intervencion = intRes.rows[0] || null;
    }
    if (!intervencion) {
      const intRes = await client.query(
        `INSERT INTO taller_intervenciones
          (empresa_id,vehiculo_id,fecha,tipo,descripcion,coste_mano_obra,coste_total,estado,notas,created_by)
         VALUES ($1,$2,CURRENT_DATE,'Salida de recambios',$3,0,0,'abierta',$4,$5)
         RETURNING *`,
        [
          empresa,
          vehiculo.id,
          `Imputacion de recambios por escaneo a ${vehiculo.matricula}`,
          "Intervencion generada automaticamente desde salida rapida de stock.",
          req.user?.id || null,
        ]
      );
      intervencion = intRes.rows[0];
    }

    const unitPrice = num(unidad.precio_unitario, num(pieza?.precio_compra));
    await client.query(
      `INSERT INTO taller_intervencion_piezas
        (intervencion_id,empresa_id,pieza_id,unidad_id,codigo_barras,cantidad,precio_unitario,escaneado,pendiente_asignar,autorizado_por)
       VALUES ($1,$2,$3,$4,$5,1,$6,true,false,NULL)`,
      [
        intervencion.id,
        empresa,
        unidad.pieza_id,
        assigned.rows[0].id,
        assigned.rows[0].codigo_unidad || codigo,
        unitPrice,
      ]
    );
    await client.query(
      `UPDATE taller_intervenciones
          SET coste_total=CASE WHEN origen_taller='externo' THEN COALESCE(factura_proveedor_importe,0) ELSE COALESCE(coste_mano_obra,0) END + COALESCE((
                SELECT SUM(cantidad * precio_unitario)
                  FROM taller_intervencion_piezas
                 WHERE intervencion_id=$1
              ),0),
              updated_at=NOW()
        WHERE id=$1 AND empresa_id=$2`,
      [intervencion.id, empresa]
    );
    await client.query(
      "UPDATE taller_pieza_unidades SET intervencion_id=$1 WHERE id=$2 AND empresa_id=$3",
      [intervencion.id, assigned.rows[0].id, empresa]
    );

    return {
      unidad: { ...assigned.rows[0], intervencion_id: intervencion.id },
      pieza: {
        id: pieza?.id || unidad.pieza_id,
        nombre: pieza?.nombre || unidad.pieza_nombre,
        referencia: pieza?.referencia || "",
        codigo_barras: pieza?.codigo_barras || "",
      },
      vehiculo,
      intervencion_id: intervencion.id,
    };
  });

  res.json(result);
}));

router.patch("/piezas/unidades/:id/devolver", PUEDE_EDITAR_TALLER, asyncRoute(async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerUnidadesSchema();
  const empresa = empresaId(req);
  const result = await db.transaction(async client => {
    const unidadRes = await client.query(
      `SELECT u.*, p.nombre AS pieza_nombre
         FROM taller_pieza_unidades u
         JOIN taller_piezas p ON p.id=u.pieza_id AND p.empresa_id=u.empresa_id
        WHERE u.id=$1 AND u.empresa_id=$2
        LIMIT 1
        FOR UPDATE OF u`,
      [req.params.id, empresa]
    );
    const unidad = unidadRes.rows[0];
    if (!unidad) {
      const err = new Error("Unidad no encontrada");
      err.statusCode = 404;
      throw err;
    }
    if (unidad.estado === "stock") {
      return { ok: true, unidad, restored: false };
    }

    const intervencionId = unidad.intervencion_id || null;
    await client.query(
      "DELETE FROM taller_intervencion_piezas WHERE empresa_id=$1 AND unidad_id=$2",
      [empresa, unidad.id]
    );
    await client.query(
      `UPDATE taller_pieza_unidades
          SET estado='stock',
              vehiculo_id=NULL,
              matricula_snapshot=NULL,
              intervencion_id=NULL,
              salida_at=NULL,
              salida_por=NULL,
              notas=COALESCE(notas || E'\n', '') || $3,
              updated_at=NOW()
        WHERE id=$1 AND empresa_id=$2`,
      [
        unidad.id,
        empresa,
        `Devuelta a stock el ${new Date().toISOString()} por ${req.user?.nombre || req.user?.email || "usuario"}`,
      ]
    );
    await client.query(
      "UPDATE taller_piezas SET stock_actual=stock_actual+1, updated_at=NOW() WHERE id=$1 AND empresa_id=$2",
      [unidad.pieza_id, empresa]
    );
    if (intervencionId) {
      await client.query(
        `UPDATE taller_intervenciones
            SET coste_total=coste_mano_obra + COALESCE((
                  SELECT SUM(cantidad * precio_unitario)
                    FROM taller_intervencion_piezas
                   WHERE intervencion_id=$1
                ),0),
                updated_at=NOW()
          WHERE id=$1 AND empresa_id=$2`,
        [intervencionId, empresa]
      );
    }
    const updated = await client.query(
      `SELECT u.*, p.nombre AS pieza_nombre, v.matricula AS vehiculo_matricula
         FROM taller_pieza_unidades u
         JOIN taller_piezas p ON p.id=u.pieza_id AND p.empresa_id=u.empresa_id
         LEFT JOIN vehiculos v ON v.id=u.vehiculo_id
        WHERE u.id=$1 AND u.empresa_id=$2`,
      [unidad.id, empresa]
    );
    return { ok: true, unidad: updated.rows[0], restored: true, intervencion_id: intervencionId };
  });
  res.json(result);
}));

router.post("/piezas", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerPiezasSchema();
  const {
    almacen_id, proveedor, nombre, referencia, codigo_barras, categoria,
    stock_actual, stock_minimo, precio_compra, precio_venta, tipo_stock, unidad_medida, etiqueta_tamano, notas,
  } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "Nombre obligatorio" });

  const code = emptyToNull(codigo_barras) || barcode("PZ");
  const { rows } = await db.query(
    `INSERT INTO taller_piezas
      (empresa_id,almacen_id,proveedor,nombre,referencia,codigo_barras,categoria,stock_actual,stock_minimo,
       precio_compra,precio_venta,tipo_stock,unidad_medida,etiqueta_tamano,notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      empresaId(req),
      emptyToNull(almacen_id),
      emptyToNull(proveedor),
      nombre,
      emptyToNull(referencia),
      code,
      emptyToNull(categoria),
      num(stock_actual),
      num(stock_minimo),
      num(precio_compra),
      num(precio_venta),
      ["producto_venta", "pieza_taller"].includes(String(tipo_stock || "")) ? String(tipo_stock) : "pieza_taller",
      emptyToNull(unidad_medida) || "ud",
      emptyToNull(etiqueta_tamano) || "50x25",
      emptyToNull(notas),
    ]
  );
  res.status(201).json(rows[0]);
});

router.put("/piezas/:id", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerPiezasSchema();
  const {
    almacen_id, proveedor, nombre, referencia, codigo_barras, categoria,
    stock_actual, stock_minimo, precio_compra, precio_venta, tipo_stock, unidad_medida, etiqueta_tamano, notas, activo,
  } = req.body || {};
  const { rows } = await db.query(
    `UPDATE taller_piezas SET
       almacen_id=$1,proveedor=$2,nombre=$3,referencia=$4,codigo_barras=$5,categoria=$6,
       stock_actual=$7,stock_minimo=$8,precio_compra=$9,precio_venta=$10,tipo_stock=$11,unidad_medida=$12,
       etiqueta_tamano=$13,notas=$14,activo=$15,updated_at=NOW()
     WHERE id=$16 AND empresa_id=$17
     RETURNING *`,
    [
      emptyToNull(almacen_id),
      emptyToNull(proveedor),
      nombre,
      emptyToNull(referencia),
      emptyToNull(codigo_barras),
      emptyToNull(categoria),
      num(stock_actual),
      num(stock_minimo),
      num(precio_compra),
      num(precio_venta),
      ["producto_venta", "pieza_taller"].includes(String(tipo_stock || "")) ? String(tipo_stock) : "pieza_taller",
      emptyToNull(unidad_medida) || "ud",
      emptyToNull(etiqueta_tamano) || "50x25",
      emptyToNull(notas),
      activo !== false,
      req.params.id,
      empresaId(req),
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: "Pieza no encontrada" });
  res.json(rows[0]);
});

router.delete("/piezas/:id", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const { rows } = await db.query(
    `UPDATE taller_piezas
        SET activo=false, updated_at=NOW()
      WHERE id=$1 AND empresa_id=$2
      RETURNING id`,
    [req.params.id, empresaId(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: "Pieza no encontrada" });
  res.json({ ok: true, id: rows[0].id });
});

router.get("/intervenciones", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerIntervencionesExtraSchema();
  const { estado, vehiculo_id } = req.query;
  const params = [empresaId(req)];
  const where = ["i.empresa_id=$1"];
  if (estado) {
    params.push(estado);
    where.push(`i.estado=$${params.length}`);
  }
  if (vehiculo_id) {
    params.push(vehiculo_id);
    where.push(`i.vehiculo_id=$${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT i.*, v.matricula AS vehiculo_matricula,
       COALESCE(
         json_agg(json_build_object(
           'id', ip.id,
           'pieza_id', ip.pieza_id,
           'unidad_id', ip.unidad_id,
           'nombre', p.nombre,
           'codigo_barras', COALESCE(ip.codigo_barras, p.codigo_barras),
           'codigo_unidad', u.codigo_unidad,
           'cantidad', ip.cantidad,
           'precio_unitario', ip.precio_unitario,
           'escaneado', ip.escaneado,
           'pendiente_asignar', ip.pendiente_asignar
         ) ORDER BY ip.created_at) FILTER (WHERE ip.id IS NOT NULL),
         '[]'
       ) AS piezas
       FROM taller_intervenciones i
       LEFT JOIN vehiculos v ON v.id=i.vehiculo_id
       LEFT JOIN taller_intervencion_piezas ip ON ip.intervencion_id=i.id
       LEFT JOIN taller_piezas p ON p.id=ip.pieza_id
       LEFT JOIN taller_pieza_unidades u ON u.id=ip.unidad_id
      WHERE ${where.join(" AND ")}
      GROUP BY i.id, v.matricula
      ORDER BY i.fecha DESC, i.created_at DESC
      LIMIT 500`,
    params
  );
  res.json(rows);
});

router.post("/intervenciones", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerIntervencionesExtraSchema();
  const {
    vehiculo_id, fecha, tipo, descripcion, km_en_intervencion,
    taller_externo, coste_mano_obra, estado, notas,
    origen_taller, proveedor_id, factura_proveedor_num, factura_proveedor_nombre,
    factura_proveedor_importe, factura_proveedor_fecha, factura_proveedor_file_name,
    factura_proveedor_file_mime, factura_proveedor_file_base64,
  } = req.body || {};
  if (!tipo) return res.status(400).json({ error: "Tipo obligatorio" });
  const origen = String(origen_taller || (taller_externo ? "externo" : "propio")).trim().toLowerCase() === "externo" ? "externo" : "propio";
  const manoObra = origen === "externo" ? 0 : num(coste_mano_obra);
  const facturaImporte = num(factura_proveedor_importe);
  const servicioCoste = origen === "externo" ? facturaImporte : manoObra;

  const { rows } = await db.query(
    `INSERT INTO taller_intervenciones
      (empresa_id,vehiculo_id,fecha,tipo,descripcion,km_en_intervencion,taller_externo,
       coste_mano_obra,coste_total,estado,notas,created_by,origen_taller,proveedor_id,
       factura_proveedor_num,factura_proveedor_nombre,factura_proveedor_importe,factura_proveedor_fecha,
       factura_proveedor_file_name,factura_proveedor_file_mime,factura_proveedor_file_base64)
     VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [
      empresaId(req),
      emptyToNull(vehiculo_id),
      emptyToNull(fecha),
      tipo,
      emptyToNull(descripcion),
      emptyToNull(km_en_intervencion),
      emptyToNull(taller_externo),
      manoObra,
      servicioCoste,
      emptyToNull(estado) || "abierta",
      emptyToNull(notas),
      req.user?.id || null,
      origen,
      emptyToNull(proveedor_id),
      emptyToNull(factura_proveedor_num),
      emptyToNull(factura_proveedor_nombre) || emptyToNull(taller_externo),
      facturaImporte,
      emptyToNull(factura_proveedor_fecha),
      emptyToNull(factura_proveedor_file_name),
      emptyToNull(factura_proveedor_file_mime),
      emptyToNull(factura_proveedor_file_base64),
    ]
  );
  res.status(201).json(rows[0]);
});

router.put("/intervenciones/:id", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await ensureTallerIntervencionesExtraSchema();
  const {
    vehiculo_id, fecha, tipo, descripcion, km_en_intervencion,
    taller_externo, coste_mano_obra, estado, notas,
    origen_taller, proveedor_id, factura_proveedor_num, factura_proveedor_nombre,
    factura_proveedor_importe, factura_proveedor_fecha, factura_proveedor_file_name,
    factura_proveedor_file_mime, factura_proveedor_file_base64,
  } = req.body || {};
  if (!tipo) return res.status(400).json({ error: "Tipo obligatorio" });
  const origen = String(origen_taller || (taller_externo ? "externo" : "propio")).trim().toLowerCase() === "externo" ? "externo" : "propio";
  const manoObra = origen === "externo" ? 0 : num(coste_mano_obra);
  const facturaImporte = num(factura_proveedor_importe);
  const servicioCoste = origen === "externo" ? facturaImporte : manoObra;

  const { rows } = await db.query(
    `UPDATE taller_intervenciones
        SET vehiculo_id=$1,
            fecha=COALESCE($2::date, fecha),
            tipo=$3,
            descripcion=$4,
            km_en_intervencion=$5,
            taller_externo=$6,
            coste_mano_obra=$7,
            coste_total=$12 + COALESCE((
              SELECT SUM(cantidad * precio_unitario)
              FROM taller_intervencion_piezas
              WHERE intervencion_id=$8
            ),0),
            estado=COALESCE($9, estado),
            notas=$10,
            origen_taller=$13,
            proveedor_id=$14,
            factura_proveedor_num=$15,
            factura_proveedor_nombre=$16,
            factura_proveedor_importe=$17,
            factura_proveedor_fecha=$18,
            factura_proveedor_file_name=COALESCE($19, factura_proveedor_file_name),
            factura_proveedor_file_mime=COALESCE($20, factura_proveedor_file_mime),
            factura_proveedor_file_base64=COALESCE($21, factura_proveedor_file_base64),
            updated_at=NOW()
      WHERE id=$8 AND empresa_id=$11
      RETURNING *`,
    [
      emptyToNull(vehiculo_id),
      emptyToNull(fecha),
      tipo,
      emptyToNull(descripcion),
      emptyToNull(km_en_intervencion),
      emptyToNull(taller_externo),
      manoObra,
      req.params.id,
      emptyToNull(estado),
      emptyToNull(notas),
      empresaId(req),
      servicioCoste,
      origen,
      emptyToNull(proveedor_id),
      emptyToNull(factura_proveedor_num),
      emptyToNull(factura_proveedor_nombre) || emptyToNull(taller_externo),
      facturaImporte,
      emptyToNull(factura_proveedor_fecha),
      emptyToNull(factura_proveedor_file_name),
      emptyToNull(factura_proveedor_file_mime),
      emptyToNull(factura_proveedor_file_base64),
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: "Intervencion no encontrada" });
  res.json(rows[0]);
});

router.post("/intervenciones/:id/piezas", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const {
    pieza_id, codigo_barras, cantidad, precio_unitario,
    autorizar_sin_pieza,
  } = req.body || {};
  const empresa = empresaId(req);
  const qty = num(cantidad, 1) || 1;
  const code = emptyToNull(codigo_barras);

  if (!pieza_id && !code && !autorizar_sin_pieza) {
    return res.status(400).json({ error: "Escanea o introduce el codigo de barras de la pieza" });
  }
  if (autorizar_sin_pieza && req.user?.rol !== "gerente") {
    return res.status(403).json({ error: "Solo gerente puede autorizar una pieza pendiente" });
  }

  const result = await db.transaction(async client => {
    const exists = await client.query(
      "SELECT id FROM taller_intervenciones WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresa]
    );
    if (!exists.rows[0]) {
      const err = new Error("Intervencion no encontrada");
      err.statusCode = 404;
      throw err;
    }

    let pieza = null;
    if (pieza_id || code) {
      const found = await client.query(
        `SELECT * FROM taller_piezas
          WHERE empresa_id=$1 AND activo=true AND (id=$2 OR codigo_barras=$3)
          LIMIT 1`,
        [empresa, emptyToNull(pieza_id), code]
      );
      pieza = found.rows[0] || null;
      if (!pieza && !autorizar_sin_pieza) {
        const err = new Error("Pieza no encontrada para ese codigo");
        err.statusCode = 404;
        throw err;
      }
    }

    const unitPrice = precio_unitario !== undefined ? num(precio_unitario) : num(pieza?.precio_compra);
    const inserted = await client.query(
      `INSERT INTO taller_intervencion_piezas
        (intervencion_id,empresa_id,pieza_id,codigo_barras,cantidad,precio_unitario,escaneado,pendiente_asignar,autorizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        req.params.id,
        empresa,
        pieza?.id || null,
        code || pieza?.codigo_barras || null,
        qty,
        unitPrice,
        !!pieza,
        !pieza,
        !pieza ? req.user?.id || null : null,
      ]
    );

    if (pieza?.id) {
      await client.query(
        "UPDATE taller_piezas SET stock_actual=stock_actual-$1, updated_at=NOW() WHERE id=$2 AND empresa_id=$3",
        [qty, pieza.id, empresa]
      );
    }
    await client.query(
      `UPDATE taller_intervenciones
          SET coste_total=coste_mano_obra + COALESCE((
                SELECT SUM(cantidad * precio_unitario)
                  FROM taller_intervencion_piezas
                 WHERE intervencion_id=$1
              ),0),
              updated_at=NOW()
        WHERE id=$1 AND empresa_id=$2`,
      [req.params.id, empresa]
    );

    return inserted.rows[0];
  });

  res.status(201).json(result);
});

router.post("/intervenciones/:id/cerrar", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const empresa = empresaId(req);
  const pending = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM taller_intervencion_piezas
      WHERE intervencion_id=$1 AND empresa_id=$2
        AND (pendiente_asignar=true OR escaneado=false)`,
    [req.params.id, empresa]
  );
  if (pending.rows[0].n > 0) {
    return res.status(409).json({
      error: "No se puede cerrar definitivo: hay piezas pendientes de asignar o sin escanear",
    });
  }

  const { rows } = await db.query(
    `UPDATE taller_intervenciones
        SET estado='cerrada', cierre_definitivo_at=NOW(), updated_at=NOW()
      WHERE id=$1 AND empresa_id=$2
      RETURNING *`,
    [req.params.id, empresa]
  );
  if (!rows[0]) return res.status(404).json({ error: "Intervencion no encontrada" });
  res.json(rows[0]);
});

router.delete("/intervenciones/:id", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await db.query(
    "DELETE FROM taller_intervenciones WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresaId(req)]
  );
  res.json({ ok: true });
});

router.get("/neumaticos", async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const { estado, medida, vehiculo_id, tipo } = req.query;
  const params = [empresaId(req)];
  const where = ["n.empresa_id=$1"];
  if (estado) {
    params.push(estado);
    where.push(`n.estado=$${params.length}`);
  }
  if (medida) {
    params.push(medida);
    where.push(`n.medida=$${params.length}`);
  }
  if (vehiculo_id) {
    params.push(vehiculo_id);
    where.push(`n.vehiculo_id=$${params.length}`);
  }
  if (tipo) {
    params.push(tipo);
    where.push(`n.tipo=$${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT n.*, v.matricula AS vehiculo_matricula
       FROM taller_neumaticos n
       LEFT JOIN vehiculos v ON v.id=n.vehiculo_id
      WHERE ${where.join(" AND ")}
      ORDER BY n.medida, n.marca, n.created_at DESC`,
    params
  );
  res.json(rows);
});

router.post("/neumaticos", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const {
    codigo_barras, marca, modelo, medida, lote, precio_compra,
    tipo, proveedor, dot, profundidad_mm, cantidad,
    estado, vehiculo_id, posicion, km_montaje, fecha_montaje, fecha_baja, notas,
  } = req.body || {};
  if (!medida) return res.status(400).json({ error: "Medida obligatoria" });
  const total = Math.max(1, Math.min(200, Math.trunc(num(cantidad, 1) || 1)));

  const rows = [];
  for (let i = 0; i < total; i++) {
    const inserted = await db.query(
      `INSERT INTO taller_neumaticos
        (empresa_id,codigo_barras,marca,modelo,medida,lote,precio_compra,tipo,proveedor,dot,profundidad_mm,
         estado,vehiculo_id,posicion,km_montaje,fecha_montaje,fecha_baja,notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        empresaId(req),
        total === 1 && emptyToNull(codigo_barras) ? emptyToNull(codigo_barras) : barcode("NEU"),
        emptyToNull(marca),
        emptyToNull(modelo),
        medida,
        emptyToNull(lote),
        num(precio_compra),
        emptyToNull(tipo) || "tractora",
        emptyToNull(proveedor),
        emptyToNull(dot),
        emptyToNull(profundidad_mm),
        emptyToNull(estado) || "stock",
        emptyToNull(vehiculo_id),
        emptyToNull(posicion),
        emptyToNull(km_montaje),
        emptyToNull(fecha_montaje),
        emptyToNull(fecha_baja),
        emptyToNull(notas),
      ]
    );
    rows.push(inserted.rows[0]);
  }
  res.status(201).json({ ...rows[0], items: rows, cantidad_creada: rows.length });
});

router.patch("/neumaticos/:id/montar", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const { vehiculo_id, posicion, km_montaje, fecha_montaje, notas } = req.body || {};
  if (!vehiculo_id || !posicion) return res.status(400).json({ error: "Vehiculo y posicion son obligatorios" });
  const { rows } = await db.query(
    `UPDATE taller_neumaticos SET
       estado='montado', vehiculo_id=$1, posicion=$2, km_montaje=$3,
       fecha_montaje=COALESCE($4::date,CURRENT_DATE), fecha_baja=NULL,
       notas=COALESCE($5, notas), updated_at=NOW()
     WHERE id=$6 AND empresa_id=$7 AND estado IN ('stock','montado')
     RETURNING *`,
    [
      vehiculo_id,
      posicion,
      emptyToNull(km_montaje),
      emptyToNull(fecha_montaje),
      emptyToNull(notas),
      req.params.id,
      empresaId(req),
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: "Neumatico no encontrado" });
  res.json(rows[0]);
});

router.patch("/neumaticos/:id/baja", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  const { motivo } = req.body || {};
  const { rows } = await db.query(
    `UPDATE taller_neumaticos SET
       estado='baja', fecha_baja=CURRENT_DATE, notas=COALESCE($1, notas), updated_at=NOW()
     WHERE id=$2 AND empresa_id=$3
     RETURNING *`,
    [emptyToNull(motivo), req.params.id, empresaId(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: "Neumatico no encontrado" });
  res.json(rows[0]);
});

router.delete("/neumaticos/:id", PUEDE_EDITAR_TALLER, async (req, res) => {
  if (!empresaId(req)) return res.status(401).json({ error: "Sin empresa_id" });
  await db.query(
    "UPDATE taller_neumaticos SET estado='baja', fecha_baja=CURRENT_DATE, updated_at=NOW() WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresaId(req)]
  );
  res.json({ ok: true });
});

module.exports = router;
