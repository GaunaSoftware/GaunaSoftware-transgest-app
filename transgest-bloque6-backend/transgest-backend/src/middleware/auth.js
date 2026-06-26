const jwt    = require("jsonwebtoken");
const crypto = require("crypto");
const db     = require("../services/db");
const logger = require("../services/logger");
const { userJwtSecret } = require("../services/jwtSecrets");

const GRACE_DAYS = 7;

const PLAN_ALIAS = {
  lite: "lite",
  mini: "lite",
  transgest_lite: "lite",
  transgest_mini: "lite",
  basic: "basico",
  basico: "basico",
  profesional: "profesional",
  professional: "profesional",
  enterprise: "enterprise",
};

const PLAN_FEATURES = {
  lite: {
    ai: false,
    kpis_avanzados: false,
    here_routing: false,
    optimizacion_rutas: false,
    gestion_rutas: true,
    contabilidad: false,
    taller: false,
    importacion: false,
    objetivos: false,
  },
  basico: {
    ai: false,
    kpis_avanzados: false,
    here_routing: false,
    optimizacion_rutas: false,
    gestion_rutas: true,
    contabilidad: false,
    taller: false,
    importacion: false,
    objetivos: false,
  },
  profesional: {
    ai: false,
    kpis_avanzados: true,
    here_routing: true,
    optimizacion_rutas: true,
    gestion_rutas: true,
    contabilidad: true,
    taller: true,
    importacion: false,
    objetivos: false,
  },
  enterprise: {
    ai: true,
    kpis_avanzados: true,
    here_routing: true,
    optimizacion_rutas: true,
    gestion_rutas: true,
    contabilidad: true,
    taller: true,
    importacion: true,
    objetivos: true,
  },
};

const PLAN_DISABLED_MODULES = {
  lite: new Set([
    "dashboard", "control_tower", "agenda", "plan_diario", "gestion_trafico", "calculador_portes",
    "palets", "colaboradores", "vehiculos", "choferes", "taller", "grupajes", "solicitudes",
    "hojas_ruta", "nominas", "control_horario", "documentos", "facturacion",
    "contabilidad", "informes", "excepciones", "objetivos", "ia", "rutas_recomendadas",
    "rutas_recomendadas_chofer", "importacion", "actividad", "usuarios",
  ]),
  basico: new Set([
    "ia", "informes", "excepciones", "objetivos", "rutas_recomendadas", "rutas_recomendadas_chofer",
    "taller", "contabilidad", "nominas", "explotacion", "gastos_estructura", "importacion",
    "actividad", "colaboradores",
  ]),
  profesional: new Set([
    "ia", "objetivos", "importacion",
  ]),
};

const MODULE_IDS = [
  "agenda",
  "dashboard",
  "pedidos",
  "plan_diario",
  "solicitudes",
  "gestion_trafico",
  "calculador_portes",
  "clientes",
  "rutas",
  "grupajes",
  "palets",
  "colaboradores",
  "vehiculos",
  "choferes",
  "taller",
  "hojas_ruta",
  "facturacion",
  "contabilidad",
  "nominas",
  "control_horario",
  "informes",
  "excepciones",
  "documentos",
  "avisos",
  "empresa",
  "usuarios",
  "actividad",
  "importacion",
  "portal-cliente",
  "portal_cliente",
  "ia",
  "app_chofer",
  "rutas_recomendadas_chofer",
  "mi_cuenta",
];

const ROLE_PERMISSION_PRESETS = {
  gerente: { ver: MODULE_IDS, editar: MODULE_IDS },
  contable: {
    ver: ["agenda","dashboard","pedidos","clientes","rutas","vehiculos","choferes","facturacion","contabilidad","nominas","control_horario","informes","documentos","avisos","empresa","mi_cuenta"],
    editar: ["agenda","clientes","facturacion","contabilidad","nominas","control_horario","documentos","avisos","mi_cuenta"],
  },
  trafico: {
    ver: ["agenda","dashboard","pedidos","plan_diario","solicitudes","gestion_trafico","calculador_portes","clientes","rutas","grupajes","palets","colaboradores","vehiculos","choferes","taller","hojas_ruta","control_horario","documentos","avisos","mi_cuenta"],
    editar: ["agenda","pedidos","plan_diario","solicitudes","gestion_trafico","clientes","rutas","grupajes","palets","colaboradores","vehiculos","choferes","hojas_ruta","control_horario","documentos","avisos","mi_cuenta"],
  },
  administrativo: {
    ver: ["agenda","dashboard","pedidos","plan_diario","solicitudes","clientes","rutas","vehiculos","choferes","palets","facturacion","contabilidad","nominas","control_horario","informes","documentos","avisos","empresa","mi_cuenta"],
    editar: ["agenda","pedidos","plan_diario","solicitudes","clientes","palets","facturacion","control_horario","documentos","avisos","mi_cuenta"],
  },
  responsable_taller: {
    ver: ["agenda","dashboard","vehiculos","choferes","taller","documentos","avisos","mi_cuenta"],
    editar: ["agenda","vehiculos","taller","documentos","avisos","mi_cuenta"],
  },
  visualizador: {
    ver: ["agenda","dashboard","pedidos","plan_diario","gestion_trafico","clientes","rutas","vehiculos","choferes","hojas_ruta","informes","documentos","avisos","mi_cuenta"],
    editar: ["mi_cuenta"],
  },
  chofer: { ver: ["app_chofer","rutas_recomendadas_chofer","mi_cuenta"], editar: ["app_chofer","mi_cuenta"] },
  cliente: { ver: ["portal_cliente","portal-cliente","mi_cuenta"], editar: ["portal_cliente","portal-cliente","mi_cuenta"] },
};

function isChoferPedidosOperationalPath(req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.path || "");
  if (method === "GET" && path === "/") return true;
  if (method === "POST" && path === "/chofer") return true;
  if (["GET", "POST"].includes(method) && /^\/chofer\/(clientes|rutas)(\/|$)/.test(path)) return true;
  if (method === "GET" && /^\/[^/]+$/.test(path)) return true;
  if (["GET", "POST", "PATCH"].includes(method) && /^\/[^/]+\/(documento-control-digital|chofer-pasos|chofer-docs|estado|gps|firma)(\/|$)/.test(path)) return true;
  if (method === "GET" && /^\/[^/]+\/(eventos|carta-porte)$/.test(path)) return true;
  return false;
}

let authChoferSchemaReady = false;
async function ensureAuthChoferSchema() {
  if (authChoferSchemaReady) return;
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trafico_config JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_chofer ON usuarios(empresa_id, chofer_id)").catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS cliente_integracion_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      nombre VARCHAR(120) NOT NULL DEFAULT 'Integracion EDI/API',
      token_hash VARCHAR(80) NOT NULL UNIQUE,
      token_mask VARCHAR(80) NOT NULL,
      scopes JSONB NOT NULL DEFAULT '["manifest","feed"]'::jsonb,
      activo BOOLEAN NOT NULL DEFAULT true,
      expires_at TIMESTAMPTZ,
      created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      last_used_ip VARCHAR(80),
      usage_count INTEGER NOT NULL DEFAULT 0,
      window_started_at TIMESTAMPTZ,
      window_count INTEGER NOT NULL DEFAULT 0,
      rate_limit_per_hour INTEGER NOT NULL DEFAULT 120,
      last_rate_limit_at TIMESTAMPTZ
    )
  `).catch(() => {});
  await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0").catch(() => {});
  await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ").catch(() => {});
  await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS window_count INTEGER NOT NULL DEFAULT 0").catch(() => {});
  await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER NOT NULL DEFAULT 120").catch(() => {});
  await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS last_rate_limit_at TIMESTAMPTZ").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_cliente_integracion_tokens_empresa_cliente ON cliente_integracion_tokens(empresa_id, cliente_id, activo)").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_cliente_integracion_tokens_hash ON cliente_integracion_tokens(token_hash)").catch(() => {});
  authChoferSchemaReady = true;
}

function hashAccessToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function permisosDesdeListas(ver = [], editar = []) {
  const canView = new Set(ver);
  const canEdit = new Set(editar);
  return {
    modulos: Object.fromEntries(MODULE_IDS.map((id) => [
      id,
      { ver: canView.has(id), editar: canEdit.has(id) },
    ])),
  };
}

function presetPermisosRol(rol) {
  const preset = ROLE_PERMISSION_PRESETS[rol] || ROLE_PERMISSION_PRESETS.visualizador;
  return permisosDesdeListas(preset.ver, preset.editar);
}

function normalizePermissionsForRole(permisos, rol) {
  const base = presetPermisosRol(rol);
  if (["chofer", "cliente", "cliente_portal"].includes(String(rol || "").toLowerCase())) return base;
  const raw = permisos && typeof permisos === "object" && !Array.isArray(permisos) ? permisos : {};
  const modulos = raw.modulos && typeof raw.modulos === "object" ? raw.modulos : raw;
  for (const id of MODULE_IDS) {
    const regla = modulos[id];
    if (regla && typeof regla === "object" && !Array.isArray(regla)) {
      base.modulos[id] = {
        ver: Boolean(regla.ver),
        editar: Boolean(regla.editar),
      };
    }
  }
  return base;
}

function normalizePlan(plan) {
  return PLAN_ALIAS[String(plan || "").trim().toLowerCase()] || "enterprise";
}

function planHasFeature(plan, feature) {
  const normalized = normalizePlan(plan);
  return Boolean((PLAN_FEATURES[normalized] || PLAN_FEATURES.enterprise)[feature]);
}

function getSubscriptionState(empresa) {
  if (!empresa) return { blocked: false, suscripcion: null };

  const estado = empresa.estado || "activo";
  const motivoBloqueo = empresa.bloqueo_motivo || empresa.motivo || estado;

  if (empresa.bloqueo_manual) {
    return {
      blocked: true,
      motivo: motivoBloqueo,
      mensaje: "La cuenta esta bloqueada. Contacta con soporte para reactivarla.",
      suscripcion: {
        estado,
        plan: empresa.plan || null,
        motivo: motivoBloqueo,
        bloqueo_manual: true,
      },
    };
  }

  if (estado === "cancelado" || estado === "suspendido") {
    return {
      blocked: true,
      motivo: motivoBloqueo,
      mensaje: estado === "cancelado"
        ? "La cuenta esta cancelada. Contacta con soporte para reactivarla."
        : "La cuenta esta suspendida. Contacta con soporte para reactivarla.",
      suscripcion: { estado, plan: empresa.plan || null, motivo: motivoBloqueo },
    };
  }

  if (!empresa.fecha_vencimiento) {
    return {
      blocked: false,
      suscripcion: { estado, plan: empresa.plan || null, aviso: false },
    };
  }

  const now = new Date();
  const vencimiento = new Date(empresa.fecha_vencimiento);
  if (Number.isNaN(vencimiento.getTime())) {
    return {
      blocked: false,
      suscripcion: { estado, plan: empresa.plan || null, aviso: false },
    };
  }

  const diasRestantes = Math.ceil((vencimiento.getTime() - now.getTime()) / 86400000);
  if (diasRestantes < 0) {
    const diasGraciaRestantes = GRACE_DAYS + diasRestantes;
    if (diasGraciaRestantes >= 0) {
      return {
        blocked: false,
        suscripcion: {
          estado,
          plan: empresa.plan || null,
          aviso: true,
          motivo: "gracia",
          dias_gracia_restantes: diasGraciaRestantes,
          fecha_vencimiento: empresa.fecha_vencimiento,
        },
      };
    }
    return {
      blocked: true,
      motivo: "vencido",
      mensaje: "Tu suscripcion ha vencido. Renueva para seguir usando TransGest.",
      suscripcion: {
        estado,
        plan: empresa.plan || null,
        motivo: "vencido",
        fecha_vencimiento: empresa.fecha_vencimiento,
      },
    };
  }

  return {
    blocked: false,
    suscripcion: {
      estado,
      plan: empresa.plan || null,
      aviso: diasRestantes <= 7,
      motivo: diasRestantes <= 7 ? "vence_pronto" : null,
      dias_restantes: diasRestantes,
      fecha_vencimiento: empresa.fecha_vencimiento,
    },
  };
}

async function authenticate(req, res, next) {
  if (req.user) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token de acceso requerido" });
  }

  const token = header.split(" ")[1];
  try {
    await ensureAuthChoferSchema();
    if (String(token || "").startsWith("tedi_")) {
      const tokenHash = hashAccessToken(token);
      const { rows } = await db.query(
        `SELECT t.id AS token_id, t.empresa_id, t.cliente_id, t.nombre AS token_nombre,
                t.scopes, t.activo, t.expires_at,
                t.usage_count, t.window_started_at, t.window_count, t.rate_limit_per_hour, t.last_rate_limit_at,
                c.nombre AS cliente_nombre, c.email AS cliente_email,
                e.plan, e.estado AS empresa_estado, e.fecha_vencimiento,
                e.bloqueo_manual, e.bloqueo_motivo
           FROM cliente_integracion_tokens t
           JOIN clientes c ON c.id=t.cliente_id AND c.empresa_id=t.empresa_id AND COALESCE(c.activo,true)=true
           LEFT JOIN empresas e ON e.id=t.empresa_id
          WHERE t.token_hash=$1
            AND t.activo=true
            AND (t.expires_at IS NULL OR t.expires_at > NOW())
          LIMIT 1`,
        [tokenHash]
      );
      const row = rows[0];
      if (!row) {
        return res.status(401).json({ error: "Token tecnico EDI/API invalido o revocado" });
      }
      const subState = getSubscriptionState({
        estado: row.empresa_estado,
        plan: row.plan,
        fecha_vencimiento: row.fecha_vencimiento,
        bloqueo_manual: row.bloqueo_manual,
        bloqueo_motivo: row.bloqueo_motivo,
      });
      req.suscripcion = subState.suscripcion;
      if (subState.blocked) {
        return res.status(402).json({
          motivo: subState.motivo,
          mensaje: subState.mensaje,
          suscripcion: subState.suscripcion,
        });
      }
      const limit = Math.min(Math.max(Number(row.rate_limit_per_hour || 120) || 120, 1), 10000);
      const usedInWindow = Math.max(Number(row.window_count || 0) || 0, 0);
      const windowStarted = row.window_started_at ? new Date(row.window_started_at) : null;
      const windowMs = windowStarted && !Number.isNaN(windowStarted.getTime()) ? Date.now() - windowStarted.getTime() : Infinity;
      const resetWindow = windowMs >= 3600000;
      if (!resetWindow && usedInWindow >= limit) {
        const retryAfterSeconds = Math.max(60, Math.ceil((3600000 - windowMs) / 1000));
        await db.query(
          "UPDATE cliente_integracion_tokens SET last_rate_limit_at=NOW(), updated_at=NOW() WHERE id=$1",
          [row.token_id]
        ).catch(() => {});
        return res.status(429).json({
          error: "Limite horario del token EDI/API superado",
          limit_per_hour: limit,
          retry_after_seconds: retryAfterSeconds,
        });
      }
      const nextWindowCount = resetWindow ? 1 : usedInWindow + 1;
      const rateLimitResetAt = resetWindow
        ? new Date(Date.now() + 3600000)
        : new Date(windowStarted.getTime() + 3600000);
      req.user = {
        id: null,
        nombre: row.token_nombre || "Integracion EDI/API",
        email: row.cliente_email || null,
        username: `edi:${row.cliente_id}`,
        rol: "cliente_portal",
        activo: true,
        empresa_id: row.empresa_id,
        cliente_id: row.cliente_id,
        plan: row.plan,
        permisos: presetPermisosRol("cliente"),
        trafico_config: {},
        integracion_token_id: row.token_id,
        integracion_token_nombre: row.token_nombre || "",
        integracion_scopes: Array.isArray(row.scopes) ? row.scopes.map(s => String(s || "").trim()).filter(Boolean) : ["manifest", "feed"],
        integracion_usage_count: Number(row.usage_count || 0) + 1,
        integracion_rate_limit_per_hour: limit,
        integracion_window_count: nextWindowCount,
        integracion_rate_limit_remaining: Math.max(0, limit - nextWindowCount),
        integracion_rate_limit_reset_at: rateLimitResetAt.toISOString(),
        cliente_nombre: row.cliente_nombre || "",
      };
      req.empresaId = row.empresa_id;
      await db.query(
        `UPDATE cliente_integracion_tokens
            SET last_used_at=NOW(),
                last_used_ip=$1,
                usage_count=COALESCE(usage_count,0)+1,
                window_started_at=CASE WHEN $3::boolean THEN NOW() ELSE COALESCE(window_started_at,NOW()) END,
                window_count=$4,
                updated_at=NOW()
          WHERE id=$2`,
        [req.ip || null, row.token_id, resetWindow, nextWindowCount]
      ).catch(() => {});
      return next();
    }

    const payload = jwt.verify(token, userJwtSecret());

    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.email, u.username, u.rol, u.activo, u.empresa_id, u.cliente_id, u.chofer_id,
              u.perfil, u.permisos, u.trafico_config,
              e.plan, e.estado AS empresa_estado, e.fecha_vencimiento,
              e.bloqueo_manual, e.bloqueo_motivo
       FROM usuarios u
       LEFT JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = $1`,
      [payload.sub]
    );

    if (!rows[0] || (!rows[0].activo && !payload.superadmin_impersonation)) {
      return res.status(401).json({ error: "Usuario no valido o desactivado" });
    }

    req.user = rows[0];
    req.user.permisos = normalizePermissionsForRole(rows[0].permisos, rows[0].rol);
    req.user.trafico_config = rows[0].trafico_config && typeof rows[0].trafico_config === "object" && !Array.isArray(rows[0].trafico_config)
      ? rows[0].trafico_config
      : {};
    req.empresaId = rows[0].empresa_id || null;
    const subState = getSubscriptionState(rows[0].empresa_id ? {
      estado: rows[0].empresa_estado,
      plan: rows[0].plan,
      fecha_vencimiento: rows[0].fecha_vencimiento,
      bloqueo_manual: rows[0].bloqueo_manual,
      bloqueo_motivo: rows[0].bloqueo_motivo,
    } : null);
    req.suscripcion = subState.suscripcion;

    if (subState.blocked && !payload.superadmin_impersonation) {
      return res.status(402).json({
        motivo: subState.motivo,
        mensaje: subState.mensaje,
        suscripcion: subState.suscripcion,
      });
    }
    req.user.superadmin_impersonation = !!payload.superadmin_impersonation;
    req.user.impersonado_por = payload.impersonado_por || null;
    req.empresaId = req.user.empresa_id || null;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Sesion expirada. Inicia sesion de nuevo." });
    }
    return res.status(401).json({ error: "Token invalido" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    if (!roles.includes(req.user.rol)) {
      logger.warn(`Acceso denegado: ${req.user.email || req.user.username} (${req.user.rol}) intento acceder a ruta restringida para [${roles.join(",")}]`);
      return res.status(403).json({
        error: `Acceso denegado. Se requiere rol: ${roles.join(" o ")}`,
      });
    }
    next();
  };
}

function requireModulePermission(modulo) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    const plan = normalizePlan(req.user?.plan || req.suscripcion?.plan);
    if (PLAN_DISABLED_MODULES[plan]?.has(modulo)) {
      return res.status(403).json({
        error: "Tu plan actual no incluye este modulo.",
        modulo,
        plan,
        upgrade_required: true,
      });
    }

    const reglas = normalizePermissionsForRole(req.user.permisos, req.user.rol).modulos;

    if (
      modulo === "taller" &&
      req.user.rol === "chofer" &&
      typeof req.path === "string" &&
      req.path.startsWith("/solicitudes") &&
      ["GET", "POST", "HEAD"].includes(String(req.method || "GET").toUpperCase())
    ) {
      return next();
    }
    if (modulo === "pedidos" && req.user.rol === "chofer" && isChoferPedidosOperationalPath(req)) {
      return next();
    }

    const tipo = req.method === "GET" || req.method === "HEAD" ? "ver" : "editar";
    const regla = reglas[modulo];
    if (
      modulo === "empresa" &&
      tipo === "editar" &&
      typeof req.path === "string" &&
      req.path.startsWith("/factura/") &&
      reglas.facturacion?.editar !== false
    ) {
      return next();
    }
    if (modulo === "empresa" && typeof req.path === "string") {
      const path = req.path;
      const isHojasRutaEndpoint = [
        "/gasoil-config/",
        "/repostajes/",
        "/noches/",
        "/chofer-config/",
        "/chofer-jornadas/",
        "/nominas-emitidas",
      ].some((prefix) => path.startsWith(prefix));
      if (isHojasRutaEndpoint && Boolean(reglas.hojas_ruta?.[tipo])) return next();
      if (path.startsWith("/nominas-emitidas") && Boolean(reglas.nominas?.[tipo])) return next();
    }
    if (!regla) {
      logger.warn(`Modulo sin regla de permisos: ${modulo} usuario=${req.user.email || req.user.username}`);
      return res.status(403).json({
        error: `Permiso denegado para el modulo ${modulo}`,
        modulo,
        tipo,
      });
    }

    if (regla[tipo] === false) {
      logger.warn(`Acceso denegado por permisos: ${req.user.email || req.user.username} modulo=${modulo} tipo=${tipo}`);
      return res.status(403).json({
        error: `Permiso denegado para ${tipo} el modulo ${modulo}`,
        modulo,
        tipo,
      });
    }

    next();
  };
}

function requirePlanFeature(feature) {
  return (req, res, next) => {
    const plan = normalizePlan(req.user?.plan || req.suscripcion?.plan);
    if (planHasFeature(plan, feature)) return next();
    return res.status(403).json({
      error: "Tu plan actual no incluye esta funcionalidad.",
      feature,
      plan,
      upgrade_required: true,
    });
  };
}

const PUEDE_CAMBIAR_ESTADO_FACTURA = requireRole("gerente", "contable");
const SOLO_GERENTE                 = requireRole("gerente");
const GERENTE_O_CONTABLE           = requireRole("gerente", "contable");
const GERENTE_O_TRAFICO            = requireRole("gerente", "trafico");
const GERENTE_O_TALLER             = requireRole("gerente", "contable", "responsable_taller");

module.exports = {
  GERENTE_O_TALLER,
  authenticate,
  getSubscriptionState,
  normalizePermissionsForRole,
  normalizePlan,
  planHasFeature,
  presetPermisosRol,
  requireRole,
  requireModulePermission,
  requirePlanFeature,
  PUEDE_CAMBIAR_ESTADO_FACTURA,
  SOLO_GERENTE,
  GERENTE_O_CONTABLE,
  GERENTE_O_TRAFICO,
};
