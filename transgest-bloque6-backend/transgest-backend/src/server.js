require("dotenv").config();
const express     = require("express");
const helmet      = require("helmet");
const cors        = require("cors");
const compression = require("compression");
const morgan      = require("morgan");
const rateLimit   = require("express-rate-limit");
const crypto      = require("crypto");

const logger      = require("./services/logger");
const db          = require("./services/db");
const backupService = require("./services/backup");
const fiscalScheduler = require("./services/fiscalScheduler");
const billingReminders = require("./services/billingReminders");
const auditQueue = require("./services/auditQueue");
const { ensureTables: ensureApiKeyTables } = require("./services/apiKeys");
const { ensureNotificacionesSchema } = require("./services/notificaciones");
const { validateEnv } = require("./services/envValidator");
const { authenticate, requireModulePermission, requirePlanFeature, requireRole } = require("./middleware/auth");

// ── Rutas ─────────────────────────────────────────────
const authRoutes          = require("./routes/auth");
const usuariosRoutes      = require("./routes/usuarios");
const clientesRoutes      = require("./routes/clientes");
const pedidosRoutes       = require("./routes/pedidos");
const facturasRoutes      = require("./routes/facturas");
const rutasRoutes         = require("./routes/rutas");
const vehiculosRoutes     = require("./routes/vehiculos");
const grupajesRoutes      = require("./routes/grupajes");
const choferesRoutes      = require("./routes/choferes");
const colaboradoresRoutes = require("./routes/colaboradores");
const informesRoutes      = require("./routes/informes");
const docsRoutes          = require("./routes/docs");
const cartaPorteRoutes  = require("./routes/carta_porte");
const adrRoutes         = require("./routes/adr");
const emailRoutes         = require("./routes/email");
const registroRoutes      = require("./routes/registro");
const miCuentaRoutes      = require("./routes/mi_cuenta");
const superadminRoutes    = require("./routes/superadmin");
const exportacionRoutes   = require("./routes/exportacion");
const datosEmpresaRoutes  = require("./routes/datos_empresa");
const paletsRoutes        = require("./routes/palets");
const puntosInteresRoutes = require("./routes/puntos_interes");
const backupRoutes        = require("./routes/backup");
const iaRoutes            = require("./routes/ia");
const descargasRoutes     = require("./routes/descargas");
const tallerRoutes        = require("./routes/taller");
const routeOptimizerRoutes = require("./routes/route_optimizer");
const stripeWebhookRoutes = require("./routes/stripe_webhook");
const notificacionesRoutes = require("./routes/notificaciones");
const actividadRoutes     = require("./routes/actividad");
const clientePortalRoutes = require("./routes/cliente_portal");
const gpsWebhookRoutes    = require("./routes/gps_webhook");
const fiscalWebhookRoutes = require("./routes/fiscal_webhook");
const agendaRoutes        = require("./routes/agenda");
const accountingSsoRoutes = require("./routes/accounting_sso");
const whatsappRoutes      = require("./routes/whatsapp");
const planDiarioRoutes    = require("./routes/plan_diario");
const controlHorarioRoutes = require("./routes/control_horario");
const geocodingRoutes     = require("./routes/geocoding");
const apiKeysPublicRoutes = require("./routes/apiKeysPublic");
const integrationRoutes   = require("./routes/integration");
const webhooksRoutes      = require("./routes/webhooks");

const app  = express();
const PORT = process.env.PORT || 3001;
let httpServer = null;
let shuttingDown = false;
validateEnv();
const RELEASE = String(
  process.env.RENDER_GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.APP_RELEASE ||
  "local"
).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "local";
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

// ── Middlewares globales ──────────────────────────────
app.disable("x-powered-by");
app.set("trust proxy", 1);
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  logger.error("JWT_SECRET no esta configurado. No arranques produccion sin una clave fuerte.");
}
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  res.setHeader("X-TransGest-Release", RELEASE);
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=()");
  next();
});
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!corsOrigins.length) return cb(null, true);
    return cb(null, corsOrigins.includes(origin));
  },
  credentials: true,
}));
app.use("/api/v1/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookRoutes);
app.use(express.json({
  limit: process.env.REQUEST_BODY_LIMIT || "12mb",
  verify: (req, _res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith("/api/v1/whatsapp/webhook")) {
      req.rawBody = Buffer.from(buf);
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: process.env.REQUEST_BODY_LIMIT || "12mb" }));
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("combined", { stream: { write: msg => logger.info(msg.trim()) } }));
}

const AUDIT_REDACT_PATTERNS = [
  "password", "pass", "token", "authorization", "api_key", "apikey", "secret",
  "clave", "key", "file_base64", "base64", "firma", "logo"
];

function auditValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") {
    return value.length > 300 ? `${value.slice(0, 300)}...` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => auditValue(item, depth + 1));

  return Object.fromEntries(
    Object.entries(value).slice(0, 60).map(([key, val]) => {
      const lower = String(key).toLowerCase();
      const redacted = AUDIT_REDACT_PATTERNS.some(pattern => lower.includes(pattern));
      return [key, redacted ? "[redacted]" : auditValue(val, depth + 1)];
    })
  );
}

function shouldSkipAudit(req) {
  if (!req.path.startsWith("/api/v1")) return true;
  if (req.method === "OPTIONS") return true;
  if (req.path.startsWith("/api/v1/actividad")) return true;
  if (req.path.startsWith("/api/v1/auth/login")) return true; // Se registra manualmente.
  return false;
}

app.use((req, res, next) => {
  res.on("finish", () => {
    if (shouldSkipAudit(req)) return;

    const actor = req.user || req.superadmin;
    if (!actor) return;
    const actorTipo = req.superadmin ? "superadmin" : "usuario";
    const empresaId = req.empresaId || req.user?.empresa_id || null;
    const detalle = {
      status: res.statusCode,
      request_id: req.id,
      rol: req.user?.rol || null,
      query: auditValue(req.query || {}),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : auditValue(req.body || {}),
      user_agent: req.get("user-agent") || null,
    };

    auditQueue.enqueue({
      actor_tipo: actorTipo,
      actor_id: actor.id || null,
      actor_email: actor.email || actor.username || null,
      empresa_id: empresaId,
      accion: `${req.method} ${req.path}`,
      detalle,
      ip: req.ip,
    });
  });
  next();
});

// ── Rate limiting ─────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera 15 minutos antes de volver a probar." },
});
const superadminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 8,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiados intentos de superadmin. Espera 15 minutos antes de volver a probar." },
});
const publicWorkflowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 120,
  standardHeaders: true, legacyHeaders: false,
});
app.use("/api/v1/auth/login",    authLimiter);
app.use("/api/v1/auth/register", authLimiter);
app.use("/api/v1/superadmin/login", superadminAuthLimiter);
app.use("/api/v1/pedidos/colaborador", publicWorkflowLimiter);
app.use("/api/v1/gps/webhook", publicWorkflowLimiter);
app.use("/api/v1/fiscal/webhook", publicWorkflowLimiter);
app.use("/api/v1/whatsapp/webhook", publicWorkflowLimiter);
// Rate limit global por IP (ASVS V13.1): frena abuso/DoS sin afectar al uso
// normal. Generoso y configurable con RATE_LIMIT_PER_MIN. Los limites de login
// (mas estrictos) siguen aplicando encima en sus rutas.
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Math.max(60, Number(process.env.RATE_LIMIT_PER_MIN || 1200)),
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Reduce el ritmo e intenta de nuevo en unos segundos." },
});
app.use("/api/v1", globalApiLimiter);

// ── Health check ──────────────────────────────────────
app.head("/", (_req, res) => {
  res.status(200).end();
});

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "transgest-api", release: RELEASE });
});

app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      status: "ok",
      db: "connected",
      release: RELEASE,
      audit: auditQueue.stats(),
      ts: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// ── API Routes ────────────────────────────────────────
const api = "/api/v1";
function safeUse(path, ...handlers) {
  try { app.use(path, ...handlers); }
  catch (e) { logger.error("Route failed: " + path + " — " + e.message); }
}
function pedidosAuthUnlessPublic(req, res, next) {
  if (req.path.startsWith("/colaborador/")) return next();
  if (req.path.startsWith("/public/")) return next();
  return authenticate(req, res, (err) => {
    if (err) return next(err);
    return requireModulePermission("pedidos")(req, res, next);
  });
}
function routeOptimizerAuthUnlessPublic(req, res, next) {
  if (req.path.startsWith("/public/")) return next();
  return authenticate(req, res, (err) => {
    if (err) return next(err);
    return requireModulePermission("gestion_trafico")(req, res, next);
  });
}
function routeOptimizerPlanUnlessPublic(req, res, next) {
  if (req.path.startsWith("/public/")) return next();
  return requirePlanFeature("optimizacion_rutas")(req, res, next);
}
function colaboradoresAuthUnlessPublic(req, res, next) {
  if (req.path.startsWith("/public/liquidacion/")) return next();
  if (req.path.startsWith("/public/portal/")) return next();
  return authenticate(req, res, (err) => {
    if (err) return next(err);
    return requireModulePermission("colaboradores")(req, res, next);
  });
}
function portalClientePermission(req, res, next) {
  if (req.user?.integracion_token_id && req.path.startsWith("/integracion/")) {
    return next();
  }
  if (["cliente", "cliente_portal"].includes(req.user?.rol) && !req.path.startsWith("/admin/")) {
    return next();
  }
  const modulos = req.user?.permisos?.modulos || {};
  const hasPortalPermission = Boolean(
    modulos.portal_cliente?.ver ||
    modulos.portal_cliente?.editar ||
    modulos["portal-cliente"]?.ver ||
    modulos["portal-cliente"]?.editar
  );
  if (hasPortalPermission && !req.path.startsWith("/admin/")) {
    return next();
  }
  const modulo = req.path.startsWith("/admin/") ? "solicitudes" : "portal-cliente";
  return requireModulePermission(modulo)(req, res, next);
}
function choferesPermissionUnlessApp(req, res, next) {
  if (req.user?.rol === "chofer" && req.path.startsWith("/app/")) return next();
  return requireModulePermission("choferes")(req, res, next);
}
function vehiculosPermissionUnlessChoferAlertas(req, res, next) {
  if (req.user?.rol === "chofer" && req.path === "/alertas-doc") return res.json([]);
  if (req.user?.rol === "chofer" && req.method === "PATCH" && /^\/[^/]+\/km$/.test(req.path || "")) return next();
  return requireModulePermission("vehiculos")(req, res, next);
}
safeUse(`${api}/auth`,          authRoutes);
safeUse(`${api}/gps`,           gpsWebhookRoutes);
safeUse(`${api}/fiscal`,        fiscalWebhookRoutes);
safeUse(`${api}/whatsapp`,      whatsappRoutes);
safeUse(`${api}/usuarios`,      authenticate, requireModulePermission("usuarios"), usuariosRoutes);
safeUse(`${api}/clientes`,      authenticate, requireModulePermission("clientes"), clientesRoutes);
safeUse(`${api}/pedidos`,       pedidosAuthUnlessPublic, pedidosRoutes);
safeUse(`${api}/facturas`,      authenticate, requireModulePermission("facturacion"), facturasRoutes);
safeUse(`${api}/rutas`,         authenticate, requireModulePermission("rutas"), requirePlanFeature("gestion_rutas"), rutasRoutes);
safeUse(`${api}/vehiculos`,     authenticate, vehiculosPermissionUnlessChoferAlertas, vehiculosRoutes);
safeUse(`${api}/grupajes`,      authenticate, requireModulePermission("grupajes"), grupajesRoutes);
safeUse(`${api}/choferes`,      authenticate, choferesPermissionUnlessApp, choferesRoutes);
safeUse(`${api}/colaboradores`, colaboradoresAuthUnlessPublic, colaboradoresRoutes);
safeUse(`${api}/informes`,      authenticate, requireModulePermission("informes"), requirePlanFeature("kpis_avanzados"), informesRoutes);
safeUse(`${api}/docs`,          authenticate, requireModulePermission("documentos"), docsRoutes);
safeUse(`${api}/pedidos`,       authenticate, requireModulePermission("pedidos"), cartaPorteRoutes);
safeUse(`${api}/adr`,           authenticate, requireModulePermission("pedidos"), adrRoutes);
safeUse(`${api}/email`,         authenticate, requireModulePermission("empresa"), emailRoutes);
safeUse(`${api}/registro`,      registroRoutes);
safeUse(`${api}/mi-cuenta`,     authenticate, requireModulePermission("mi_cuenta"), miCuentaRoutes);
  safeUse(`${api}/api-keys`,      authenticate, requireRole("gerente"), apiKeysPublicRoutes);
  safeUse(`${api}/integration`,   authenticate, integrationRoutes);
  safeUse(`${api}/webhooks`,      authenticate, requireRole("gerente"), webhooksRoutes);
safeUse(`${api}/superadmin`,    superadminRoutes);
safeUse(`${api}/superadmin`,    exportacionRoutes);
safeUse(`${api}/empresa`,       authenticate, requireModulePermission("empresa"), datosEmpresaRoutes);
safeUse(`${api}/palets`,        authenticate, requireModulePermission("palets"), paletsRoutes);
safeUse(`${api}/puntos-interes`, authenticate, requireModulePermission("pedidos"), puntosInteresRoutes);
safeUse(`${api}/geocoding`,     authenticate, requireModulePermission("pedidos"), geocodingRoutes);
safeUse(`${api}/backup`,        authenticate, requireModulePermission("mi_cuenta"), backupRoutes);
safeUse(`${api}/ia`,            authenticate, requireRole("gerente", "trafico", "administrativo", "contable"), requireModulePermission("ia"), requirePlanFeature("ai"), iaRoutes);
safeUse(`${api}/taller`,        authenticate, requireModulePermission("taller"), tallerRoutes);
safeUse(`${api}/route-optimizer`, routeOptimizerAuthUnlessPublic, routeOptimizerPlanUnlessPublic, routeOptimizerRoutes);
safeUse(`${api}/notificaciones`, authenticate, requireModulePermission("avisos"), notificacionesRoutes);
safeUse(`${api}/actividad`,      authenticate, requireModulePermission("actividad"), actividadRoutes);
safeUse(`${api}/portal-cliente`, authenticate, portalClientePermission, clientePortalRoutes);
safeUse(`${api}/agenda`,         authenticate, requireModulePermission("agenda"), agendaRoutes);
safeUse(`${api}/plan-diario`,    authenticate, requireModulePermission("plan_diario"), planDiarioRoutes);
safeUse(`${api}/control-horario`, authenticate, requireModulePermission("control_horario"), controlHorarioRoutes);
safeUse(`${api}/accounting`,      accountingSsoRoutes);
safeUse(`${api}`,               authenticate, requireModulePermission("gestion_trafico"), descargasRoutes);

// ── 404 ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada: " + req.method + " " + req.path });
});

// ── Error handler global ──────────────────────────────
app.use((err, req, res, next) => {
  logger.error({ request_id: req.id, msg: err.message, path: req.path, stack: err.stack });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status < 500 ? err.message : "Error interno del servidor",
    request_id: req.id,
  });
});

// ── DB migrations on startup ──────────────────────────
function captureStartupMigrationError(error) {
  logger.error("[startup] DDL fallido: " + error.message);
  throw error;
}

async function applyMigrations() {
  try {
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS fecha_matriculacion DATE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS fecha_itv DATE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS fecha_seguro DATE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS clase VARCHAR(100)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS notas TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS peajes NUMERIC DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tiempo_h NUMERIC").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS activa BOOLEAN DEFAULT true").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tipo_vehiculo VARCHAR(50) DEFAULT 'cualquiera'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS pct_subida NUMERIC DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tarifa_tipo VARCHAR(30) DEFAULT 'viaje'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS precio_base NUMERIC DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS minimo_facturable NUMERIC").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS minimo_unidades NUMERIC").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS recargo_combustible_pct NUMERIC DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("UPDATE rutas SET activa=true WHERE activa IS NULL").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS ruta_precios_cliente (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ruta_id UUID NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
        cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        precio NUMERIC DEFAULT 0,
        tarifa_tipo VARCHAR(30),
        minimo_facturable NUMERIC,
        minimo_unidades NUMERIC,
        recargo_combustible_pct NUMERIC DEFAULT 0,
        iva_pct NUMERIC DEFAULT 21,
        notas TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (ruta_id, cliente_id)
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS tarifa_tipo VARCHAR(30)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS minimo_facturable NUMERIC").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS minimo_unidades NUMERIC").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS recargo_combustible_pct NUMERIC DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS iva_pct NUMERIC DEFAULT 21").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS notas TEXT").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_ruta_precios_cliente_cliente ON ruta_precios_cliente(cliente_id)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE puntos_interes ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_puntos_interes_empresa_cliente ON puntos_interes(empresa_id, cliente_id) WHERE activo = true").catch(captureStartupMigrationError);
    // FIX: el indice unico antiguo era (empresa_id, direccion) sin cliente_id, lo
    // que impedia que dos clientes tuvieran la misma direccion y provocaba que los
    // puntos se asociaran al cliente/general equivocado. Ahora la unicidad incluye
    // el cliente (NULL = punto general) para que cada cliente tenga su propia copia.
    await db.query("DROP INDEX IF EXISTS idx_puntos_interes_empresa_dir").catch(captureStartupMigrationError);
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_puntos_interes_empresa_cli_dir ON puntos_interes(empresa_id, COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(TRIM(direccion))) WHERE activo = true").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS portal_solicitudes_cliente (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        solicitado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        origen TEXT NOT NULL,
        destino TEXT NOT NULL,
        fecha_carga DATE,
        hora_carga VARCHAR(20),
        fecha_descarga DATE,
        hora_descarga VARCHAR(20),
        mercancia TEXT,
        peso_kg NUMERIC(12,2),
        bultos INTEGER,
        importe NUMERIC(12,2),
        referencia_cliente VARCHAR(255),
        notas TEXT,
        estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
        pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
        respuesta TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS fecha_propuesta DATE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS hora_propuesta VARCHAR(20)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS decision_cliente VARCHAR(20)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS decision_cliente_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS importe NUMERIC(12,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS importe_contraoferta NUMERIC(12,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS decision_precio VARCHAR(20)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS decision_precio_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS contraoferta_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS origen_punto_id UUID REFERENCES puntos_interes(id) ON DELETE SET NULL").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS destino_punto_id UUID REFERENCES puntos_interes(id) ON DELETE SET NULL").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_portal_solicitudes_empresa_estado ON portal_solicitudes_cliente(empresa_id, estado, created_at DESC)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_portal_solicitudes_cliente ON portal_solicitudes_cliente(cliente_id, created_at DESC)").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS portal_solicitud_eventos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        solicitud_id UUID NOT NULL REFERENCES portal_solicitudes_cliente(id) ON DELETE CASCADE,
        tipo VARCHAR(80) NOT NULL,
        actor_tipo VARCHAR(40) NOT NULL DEFAULT 'usuario',
        actor_id UUID,
        detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_portal_solicitud_eventos_solicitud ON portal_solicitud_eventos(solicitud_id, created_at DESC)").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS pedido_numero_counters (
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        last_num INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (empresa_id, year)
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_numero_key").catch(captureStartupMigrationError);
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_empresa_numero_unique ON pedidos(empresa_id, numero)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_vehiculos ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_vehiculos ADD COLUMN IF NOT EXISTS tipo VARCHAR(60)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_vehiculos ADD COLUMN IF NOT EXISTS tipo_doc VARCHAR(60)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_vehiculos ADD COLUMN IF NOT EXISTS file_url TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_vehiculos ADD COLUMN IF NOT EXISTS file_nombre VARCHAR(200)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_vehiculos ADD COLUMN IF NOT EXISTS file_size_kb INTEGER").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_choferes ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_choferes ADD COLUMN IF NOT EXISTS tipo VARCHAR(60)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_choferes ADD COLUMN IF NOT EXISTS tipo_doc VARCHAR(60)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_choferes ADD COLUMN IF NOT EXISTS file_url TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_choferes ADD COLUMN IF NOT EXISTS file_nombre VARCHAR(200)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE docs_choferes ADD COLUMN IF NOT EXISTS file_size_kb INTEGER").catch(captureStartupMigrationError);
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='docs_vehiculos' AND column_name='tipo' AND data_type IN ('character varying','text')
        ) THEN
          UPDATE docs_vehiculos SET tipo=tipo_doc::text WHERE tipo IS NULL AND tipo_doc IS NOT NULL;
        END IF;
      END $$;
    `).catch(captureStartupMigrationError);
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='docs_choferes' AND column_name='tipo' AND data_type IN ('character varying','text')
        ) THEN
          UPDATE docs_choferes SET tipo=tipo_doc::text WHERE tipo IS NULL AND tipo_doc IS NOT NULL;
        END IF;
      END $$;
    `).catch(captureStartupMigrationError);
    await db.query("UPDATE docs_vehiculos d SET empresa_id=v.empresa_id FROM vehiculos v WHERE d.vehiculo_id=v.id AND d.empresa_id IS NULL").catch(captureStartupMigrationError);
    await db.query("UPDATE docs_choferes d SET empresa_id=c.empresa_id FROM choferes c WHERE d.chofer_id=c.id AND d.empresa_id IS NULL").catch(captureStartupMigrationError);
    const idxs = [
      "CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_estado  ON pedidos(empresa_id, estado)",
      "CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_fecha   ON pedidos(empresa_id, fecha_carga DESC NULLS LAST)",
      "CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_fecha_operativa ON pedidos(empresa_id, (COALESCE(fecha_carga, fecha_pedido)))",
      "CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_fecha_operativa_full ON pedidos(empresa_id, (COALESCE(fecha_carga, fecha_pedido, fecha_descarga, fecha_entrega)) DESC, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_estado_fecha_operativa ON pedidos(empresa_id, estado, (COALESCE(fecha_carga, fecha_pedido, fecha_descarga, fecha_entrega)) DESC, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_fecha_pedido_created ON pedidos(empresa_id, fecha_pedido DESC, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_pedidos_vehiculo        ON pedidos(vehiculo_id) WHERE vehiculo_id IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS idx_pedidos_cliente         ON pedidos(cliente_id)  WHERE cliente_id  IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS idx_pedido_docs_pedido_empresa ON pedido_docs(pedido_id, empresa_id)",
      "CREATE INDEX IF NOT EXISTS idx_facturas_empresa_estado ON facturas(empresa_id, estado)",
      "CREATE INDEX IF NOT EXISTS idx_facturas_empresa_fecha  ON facturas(empresa_id, fecha DESC)",
      "CREATE INDEX IF NOT EXISTS idx_vehiculos_empresa       ON vehiculos(empresa_id) WHERE activo = true",
      "CREATE INDEX IF NOT EXISTS idx_clientes_empresa        ON clientes(empresa_id)  WHERE activo = true",
      "CREATE INDEX IF NOT EXISTS idx_vehiculos_itv           ON vehiculos(empresa_id, fecha_itv)    WHERE fecha_itv    IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS idx_vehiculos_seguro        ON vehiculos(empresa_id, fecha_seguro) WHERE fecha_seguro IS NOT NULL",
    ];
    for (const sql of idxs) { await db.query(sql).catch(captureStartupMigrationError); }
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS revision_cobro_at DATE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS reclamacion_estado VARCHAR(40)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS reclamacion_hasta DATE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS reclamacion_envios INTEGER NOT NULL DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS reclamacion_ultimo_envio_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS aviso_cobro_dias INTEGER NOT NULL DEFAULT 7").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS referencia_cliente VARCHAR(255)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS vencimiento VARCHAR(80)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ALTER COLUMN vencimiento TYPE VARCHAR(80) USING vencimiento::text").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE").catch(captureStartupMigrationError);
    await db.query("UPDATE facturas SET vencimiento=fecha_vencimiento::text WHERE vencimiento IS NULL AND fecha_vencimiento IS NOT NULL").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_facturas_revision_cobro ON facturas(empresa_id, revision_cobro_at) WHERE estado <> 'cobrada'").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS factura_registros_fiscales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        modo VARCHAR(20) NOT NULL DEFAULT 'ninguno',
        entorno VARCHAR(20) NOT NULL DEFAULT 'pruebas',
        estado_registro VARCHAR(20) NOT NULL DEFAULT 'alta',
        estado_envio VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        hash_anterior VARCHAR(128),
        huella VARCHAR(128) NOT NULL,
        qr_text TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        ultimo_error TEXT,
        ultimo_envio_at TIMESTAMPTZ,
        created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (factura_id)
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_factura_registros_fiscales_empresa ON factura_registros_fiscales(empresa_id, created_at DESC)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_factura_registros_fiscales_estado ON factura_registros_fiscales(empresa_id, estado_envio, modo)").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS factura_envios_fiscales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        registro_id UUID NOT NULL REFERENCES factura_registros_fiscales(id) ON DELETE CASCADE,
        factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        sistema VARCHAR(20) NOT NULL,
        entorno VARCHAR(20) NOT NULL DEFAULT 'pruebas',
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        intento INTEGER NOT NULL DEFAULT 0,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        response JSONB,
        error TEXT,
        next_retry_at TIMESTAMPTZ,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_factura_envios_fiscales_pendientes ON factura_envios_fiscales(empresa_id, estado, next_retry_at)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_factura_envios_fiscales_factura ON factura_envios_fiscales(factura_id, created_at DESC)").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS factura_eventos_fiscales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        registro_id UUID NOT NULL REFERENCES factura_registros_fiscales(id) ON DELETE CASCADE,
        factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        evento_tipo VARCHAR(60) NOT NULL,
        detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_factura_eventos_fiscales_registro ON factura_eventos_fiscales(registro_id, created_at DESC)").catch(captureStartupMigrationError);
    // Schema additions
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email_admin VARCHAR(200)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dominio VARCHAR(100)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'basico'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'activo'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS max_vehiculos INTEGER NOT NULL DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS max_usuarios INTEGER NOT NULL DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ALTER COLUMN max_vehiculos SET DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ALTER COLUMN max_usuarios SET DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("UPDATE empresas SET max_vehiculos=0, max_usuarios=0 WHERE max_vehiculos<>0 OR max_usuarios<>0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS fecha_vencimiento TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS configuracion JSONB NOT NULL DEFAULT '{}'::jsonb").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfg_trafico JSONB NOT NULL DEFAULT '{}'::jsonb").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfg_precios JSONB NOT NULL DEFAULT '{}'::jsonb").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfg_alertas JSONB NOT NULL DEFAULT '[]'::jsonb").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ciclo_facturacion VARCHAR(20) DEFAULT 'mensual'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(30) DEFAULT 'pendiente'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS iban_facturacion VARCHAR(80)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email_facturacion VARCHAR(255)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultimo_aviso_pago_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultimo_aviso_vencido_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS bloqueo_motivo VARCHAR(60)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS bloqueo_manual BOOLEAN DEFAULT false").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS notas_comerciales TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS proxima_tarea TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS proxima_tarea_fecha DATE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ia_limite_mensual INTEGER DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ia_usos_mes INTEGER DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ia_periodo_mes VARCHAR(7)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email_facturacion TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS emails_albaranes TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS iban VARCHAR(50)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS horario_carga VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS horario_descarga VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS limite_riesgo NUMERIC DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS modo_facturacion VARCHAR(60) DEFAULT 'por_viaje'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN DEFAULT false").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS bloqueo_motivo TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS web TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS contacto_telefono VARCHAR(60)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pendiente_revision BOOLEAN DEFAULT false").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS calle VARCHAR(200)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS num_ext VARCHAR(30)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(20)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_clientes_pendiente ON clientes(empresa_id, pendiente_revision) WHERE pendiente_revision=true").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_clientes_empresa_cif_norm ON clientes(empresa_id, UPPER(TRIM(COALESCE(cif,'')))) WHERE COALESCE(activo,true)=true AND NULLIF(TRIM(COALESCE(cif,'')),'') IS NOT NULL").catch(captureStartupMigrationError);
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM clientes
           WHERE COALESCE(activo,true)=true
             AND NULLIF(TRIM(COALESCE(cif,'')),'') IS NOT NULL
             AND UPPER(TRIM(COALESCE(cif,''))) NOT LIKE 'CLI-%'
           GROUP BY empresa_id, UPPER(TRIM(COALESCE(cif,'')))
          HAVING COUNT(*) > 1
        ) THEN
          CREATE UNIQUE INDEX IF NOT EXISTS uniq_clientes_empresa_cif_activo
            ON clientes(empresa_id, UPPER(TRIM(COALESCE(cif,''))))
            WHERE COALESCE(activo,true)=true
              AND NULLIF(TRIM(COALESCE(cif,'')),'') IS NOT NULL
              AND UPPER(TRIM(COALESCE(cif,''))) NOT LIKE 'CLI-%';
        END IF;
      END $$;
    `).catch(captureStartupMigrationError);
    await db.query(`
      DO $$
      BEGIN
        BEGIN ALTER TABLE clientes ALTER COLUMN cif TYPE VARCHAR(60); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN cp TYPE VARCHAR(20); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN telefono TYPE VARCHAR(80); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN forma_pago TYPE VARCHAR(80); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN vencimiento TYPE VARCHAR(80); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN num_ext TYPE VARCHAR(30); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN cod_postal TYPE VARCHAR(20); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN contacto_telefono TYPE VARCHAR(80); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN fiscal_num_ext TYPE VARCHAR(30); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN fiscal_cod_postal TYPE VARCHAR(20); EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER TABLE clientes ALTER COLUMN modo_facturacion TYPE VARCHAR(80); EXCEPTION WHEN others THEN NULL; END;
      END $$;
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen_pais VARCHAR(80) DEFAULT 'España'").catch(captureStartupMigrationError);
    await db.query("ALTER TYPE estado_pedido ADD VALUE IF NOT EXISTS 'incidencia'").catch(captureStartupMigrationError);
    await db.query("ALTER TYPE estado_pedido ADD VALUE IF NOT EXISTS 'espera_carga'").catch(captureStartupMigrationError);
    await db.query("ALTER TYPE estado_pedido ADD VALUE IF NOT EXISTS 'cargando'").catch(captureStartupMigrationError);
    await db.query("ALTER TYPE estado_pedido ADD VALUE IF NOT EXISTS 'espera_descarga'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen_provincia VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS destino_pais VARCHAR(80) DEFAULT 'España'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS destino_provincia VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cmr_tipo VARCHAR(30) DEFAULT 'nacional'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ALTER COLUMN horario_carga TYPE VARCHAR(255)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE clientes ALTER COLUMN horario_descarga TYPE VARCHAR(255)").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS empresa_smtp_config (
        empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
        smtp_host VARCHAR(200),
        smtp_port INTEGER NOT NULL DEFAULT 587,
        smtp_secure BOOLEAN NOT NULL DEFAULT false,
        smtp_user VARCHAR(255),
        smtp_pass_encrypted TEXT,
        smtp_from VARCHAR(255),
        smtp_from_nombre VARCHAR(150),
        reply_to VARCHAR(255),
        envio_facturas_auto BOOLEAN NOT NULL DEFAULT false,
        envio_avisos_carga_auto BOOLEAN NOT NULL DEFAULT false,
        asunto_factura TEXT,
        cuerpo_factura TEXT,
        asunto_carga TEXT,
        cuerpo_carga TEXT,
        activo BOOLEAN NOT NULL DEFAULT true,
        last_test_at TIMESTAMPTZ,
        last_test_ok BOOLEAN,
        last_error TEXT,
        updated_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID,
        trigger VARCHAR(100),
        destinatario TEXT,
        asunto TEXT,
        estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
        error TEXT,
        provider VARCHAR(40),
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE email_log ADD COLUMN IF NOT EXISTS empresa_id UUID").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE email_log ADD COLUMN IF NOT EXISTS provider VARCHAR(40)").catch(captureStartupMigrationError);
    await ensureApiKeyTables().catch(captureStartupMigrationError);
    await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS username VARCHAR(80)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil VARCHAR(80)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '{}'::jsonb").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN DEFAULT false").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS login_failed_count INTEGER NOT NULL DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        identifier VARCHAR(180) NOT NULL,
        email VARCHAR(180),
        nombre VARCHAR(180),
        rol VARCHAR(40),
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        ip VARCHAR(80),
        user_agent TEXT,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by UUID REFERENCES superadmins(id) ON DELETE SET NULL,
        resolution_note TEXT
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE usuarios ALTER COLUMN email DROP NOT NULL").catch(captureStartupMigrationError);
    await db.query("UPDATE usuarios SET username=LOWER(email) WHERE username IS NULL AND email IS NOT NULL").catch(captureStartupMigrationError);
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_empresa_username ON usuarios(empresa_id, LOWER(username)) WHERE username IS NOT NULL").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS superadmins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(200) NOT NULL UNIQUE,
        password_hash VARCHAR(200) NOT NULL,
        nombre VARCHAR(200),
        rol VARCHAR(40) NOT NULL DEFAULT 'superadmin',
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS rol VARCHAR(40) NOT NULL DEFAULT 'superadmin'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS invitaciones_usuario (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        email VARCHAR(200),
        token_hash VARCHAR(200) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        usado_at TIMESTAMPTZ,
        created_by VARCHAR(200),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_log_saas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_tipo VARCHAR(30),
        actor_id UUID,
        actor_email VARCHAR(200),
        empresa_id UUID,
        accion VARCHAR(120) NOT NULL,
        detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip VARCHAR(80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_saas_empresa_created ON audit_log_saas(empresa_id, created_at DESC)`).catch(captureStartupMigrationError);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_saas_actor_created ON audit_log_saas(actor_id, created_at DESC)`).catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
        tabla VARCHAR(50) NOT NULL,
        registro_id UUID NOT NULL,
        campo VARCHAR(50),
        valor_antes TEXT,
        valor_nuevo TEXT,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        ip INET,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS empresa_id UUID`).catch(captureStartupMigrationError);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_registro ON audit_log(tabla, registro_id)`).catch(captureStartupMigrationError);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_empresa_registro ON audit_log(empresa_id, tabla, registro_id)`).catch(captureStartupMigrationError);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_fecha ON audit_log(created_at DESC)`).catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS perfiles_usuario (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
        nombre VARCHAR(100) NOT NULL,
        rol_base VARCHAR(40) NOT NULL,
        permisos JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(empresa_id, nombre)
      )
    `).catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS taller_estado (
        empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS backup_solicitudes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
        solicitado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        motivo TEXT,
        estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
        filename TEXT,
        resuelto_por UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resuelto_at TIMESTAMPTZ
      )
    `).catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS facturas_suscripcion (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero VARCHAR(30) NOT NULL,
        concepto VARCHAR(200) NOT NULL DEFAULT 'Suscripción TransGest',
        plan VARCHAR(20),
        periodo_desde DATE NOT NULL,
        periodo_hasta DATE NOT NULL,
        importe NUMERIC(8,2) NOT NULL,
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
        fecha_vencimiento DATE,
        fecha_pago DATE,
        stripe_invoice_id VARCHAR(120),
        notas TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE facturas_suscripcion ADD COLUMN IF NOT EXISTS stripe_invoice_id VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_suscripcion_stripe_invoice ON facturas_suscripcion(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS notas_operacion TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_actual VARCHAR(255)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_fuente VARCHAR(40) DEFAULT 'manual'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_ts TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_provider VARCHAR(40)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_external_id VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(10,7)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(10,7)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_vehiculos_gps_link ON vehiculos(empresa_id, gps_provider, gps_external_id) WHERE gps_external_id IS NOT NULL").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS gps_position_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
        provider VARCHAR(40) NOT NULL DEFAULT 'manual',
        external_id VARCHAR(120),
        lat NUMERIC(10,7),
        lng NUMERIC(10,7),
        ubicacion TEXT,
        velocidad_kmh NUMERIC(8,2),
        odometro_km NUMERIC(12,2),
        raw JSONB NOT NULL DEFAULT '{}'::jsonb,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_gps_position_log_vehicle ON gps_position_log(vehiculo_id, recorded_at DESC)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS coste_gasoil NUMERIC(10,2) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS coste_peajes NUMERIC(10,2) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS coste_dietas NUMERIC(10,2) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS coste_otros  NUMERIC(10,2) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS coste_notas  TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_descarga DATE").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS hora_descarga TIME").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ventana_carga VARCHAR(100)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ventana_descarga VARCHAR(100)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS km_ruta NUMERIC(10,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS km_vacio NUMERIC(10,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS volumen NUMERIC(10,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metros_lineales NUMERIC(10,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_precio VARCHAR(50) DEFAULT 'viaje'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(10,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_iva NUMERIC(5,2) NOT NULL DEFAULT 21").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_base_sin_combustible NUMERIC(10,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS recargo_combustible_pct NUMERIC(7,3) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS importe_revision_combustible NUMERIC(10,2) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS extracostes_importe NUMERIC(10,2) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS chofer2_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS referencia_cliente VARCHAR(255)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pendiente_completar BOOLEAN DEFAULT false").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aviso_completar TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_carga VARCHAR(50)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carga_techo BOOLEAN DEFAULT false").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS grupaje_id UUID").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_matricula VARCHAR(50)").catch(captureStartupMigrationError);
    // Firma digital y foto de entrega
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_destinatario TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_fecha TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_nombre VARCHAR(150)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_evidencia JSONB").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_hash VARCHAR(64)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS foto_entrega TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS condiciones_adicionales TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ultima_posicion VARCHAR(100)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS posicion_ts TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS route_optimizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        provider VARCHAR(40) NOT NULL DEFAULT 'local',
        provider_label VARCHAR(120),
        preference VARCHAR(40) NOT NULL DEFAULT 'camion',
        truck_aware BOOLEAN NOT NULL DEFAULT false,
        distance_km NUMERIC(10,2),
        duration_min INTEGER,
        maps_url TEXT,
        stops JSONB NOT NULL DEFAULT '[]'::jsonb,
        truck JSONB NOT NULL DEFAULT '{}'::jsonb,
        waypoint_coordinates JSONB NOT NULL DEFAULT '[]'::jsonb,
        geometry JSONB,
        steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        warning TEXT,
        created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_route_optimizations_pedido ON route_optimizations(pedido_id, created_at DESC)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_route_optimizations_empresa ON route_optimizations(empresa_id, created_at DESC)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS waypoint_coordinates JSONB NOT NULL DEFAULT '[]'::jsonb").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS route_dispatches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        route_optimization_id UUID REFERENCES route_optimizations(id) ON DELETE SET NULL,
        recipient_type VARCHAR(30) NOT NULL,
        recipient_email VARCHAR(200) NOT NULL,
        recipient_name VARCHAR(200),
        status VARCHAR(30) NOT NULL DEFAULT 'enviada',
        token_hash VARCHAR(80) NOT NULL UNIQUE,
        route_url TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        opened_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
        created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_route_dispatches_pedido ON route_dispatches(pedido_id, sent_at DESC)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_route_dispatches_token ON route_dispatches(token_hash)").catch(captureStartupMigrationError);
    // facturado as a generated/computed boolean based on factura_id
    // Some old code sends facturado in payload — ensure it's handled gracefully
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
          WHERE table_name='pedidos' AND column_name='facturado') THEN
          ALTER TABLE pedidos ADD COLUMN facturado BOOLEAN GENERATED ALWAYS AS (factura_id IS NOT NULL) STORED;
        END IF;
      END $$;
    `).catch(captureStartupMigrationError);
    // Add colaborador price fields
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_cliente_col NUMERIC(10,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS notas_operacion TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_actual VARCHAR(255)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_fuente VARCHAR(40) DEFAULT 'manual'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_ts TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_provider VARCHAR(40)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_external_id VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(10,7)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(10,7)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_vehiculos_gps_link ON vehiculos(empresa_id, gps_provider, gps_external_id) WHERE gps_external_id IS NOT NULL").catch(captureStartupMigrationError);
        await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cantidad NUMERIC(10,3)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS importe_minimo NUMERIC(10,2) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS minimo_unidades NUMERIC(10,3) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_iva NUMERIC(5,2) NOT NULL DEFAULT 21").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS puntos_carga JSONB DEFAULT '[]'::jsonb").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS puntos_descarga JSONB DEFAULT '[]'::jsonb").catch(captureStartupMigrationError);
    await db.query(`
      UPDATE pedidos
         SET puntos_carga = CASE
               WHEN jsonb_typeof(COALESCE(puntos_carga, '[]'::jsonb)) = 'array'
                AND jsonb_array_length(COALESCE(puntos_carga, '[]'::jsonb)) > 0
                AND (COALESCE(puntos_carga->0->>'pais','') = '' OR COALESCE(puntos_carga->0->>'provincia','') = '')
                 THEN jsonb_set(
                   jsonb_set(COALESCE(puntos_carga, '[]'::jsonb), '{0,pais}', to_jsonb(COALESCE(NULLIF(origen_pais,''), 'España')), true),
                   '{0,provincia}', to_jsonb(COALESCE(origen_provincia, '')), true
                 )
               WHEN COALESCE(origen,'') <> ''
                 THEN jsonb_build_array(jsonb_build_object(
                   'direccion', origen,
                   'fecha', COALESCE(fecha_carga::text, ''),
                   'hora', COALESCE(hora_carga::text, ''),
                   'tipo', 'carga',
                   'es_principal', true,
                   'pais', COALESCE(NULLIF(origen_pais,''), 'España'),
                   'provincia', COALESCE(origen_provincia, '')
                 ))
               ELSE COALESCE(puntos_carga, '[]'::jsonb)
             END,
             puntos_descarga = CASE
               WHEN jsonb_typeof(COALESCE(puntos_descarga, '[]'::jsonb)) = 'array'
                AND jsonb_array_length(COALESCE(puntos_descarga, '[]'::jsonb)) > 0
                AND (COALESCE(puntos_descarga->0->>'pais','') = '' OR COALESCE(puntos_descarga->0->>'provincia','') = '')
                 THEN jsonb_set(
                   jsonb_set(COALESCE(puntos_descarga, '[]'::jsonb), '{0,pais}', to_jsonb(COALESCE(NULLIF(destino_pais,''), 'España')), true),
                   '{0,provincia}', to_jsonb(COALESCE(destino_provincia, '')), true
                 )
               WHEN COALESCE(destino,'') <> ''
                 THEN jsonb_build_array(jsonb_build_object(
                   'direccion', destino,
                   'fecha', COALESCE(fecha_descarga::text, fecha_entrega::text, ''),
                   'hora', COALESCE(hora_descarga::text, ''),
                   'tipo', 'descarga',
                   'es_principal', true,
                   'pais', COALESCE(NULLIF(destino_pais,''), 'España'),
                   'provincia', COALESCE(destino_provincia, '')
                 ))
               ELSE COALESCE(puntos_descarga, '[]'::jsonb)
             END
       WHERE (jsonb_typeof(COALESCE(puntos_carga, '[]'::jsonb)) = 'array'
              AND (jsonb_array_length(COALESCE(puntos_carga, '[]'::jsonb)) = 0 OR COALESCE(puntos_carga->0->>'pais','') = '' OR COALESCE(puntos_carga->0->>'provincia','') = ''))
          OR (jsonb_typeof(COALESCE(puntos_descarga, '[]'::jsonb)) = 'array'
              AND (jsonb_array_length(COALESCE(puntos_descarga, '[]'::jsonb)) = 0 OR COALESCE(puntos_descarga->0->>'pais','') = '' OR COALESCE(puntos_descarga->0->>'provincia','') = ''))
    `).catch(captureStartupMigrationError);
    await db.query(`
      UPDATE pedidos p
         SET origen_pais = COALESCE(NULLIF(p.puntos_carga->0->>'pais',''), p.origen_pais, 'España'),
             origen_provincia = COALESCE(NULLIF(p.puntos_carga->0->>'provincia',''), p.origen_provincia),
             destino_pais = COALESCE(NULLIF(p.puntos_descarga->0->>'pais',''), p.destino_pais, 'España'),
             destino_provincia = COALESCE(NULLIF(p.puntos_descarga->0->>'provincia',''), p.destino_provincia),
             cmr_tipo = CASE WHEN EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(COALESCE(p.puntos_carga, '[]'::jsonb) || COALESCE(p.puntos_descarga, '[]'::jsonb)) AS s(stop)
                WHERE lower(COALESCE(s.stop->>'pais','España')) NOT IN ('', 'es', 'espana', 'españa', 'spain')
             ) THEN 'internacional' ELSE 'nacional' END
       WHERE TRUE
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pendiente_completar BOOLEAN DEFAULT false").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aviso_completar TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS portal_solicitud_id UUID").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_numero_portal ON pedidos(empresa_id, numero DESC)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_pedidos_portal_solicitud ON pedidos(empresa_id, portal_solicitud_id) WHERE portal_solicitud_id IS NOT NULL").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS importe_paralizacion NUMERIC(10,2) DEFAULT 0").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paralizacion_horas NUMERIC(6,2) DEFAULT 0").catch(captureStartupMigrationError);
          await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_colaborador NUMERIC(10,2)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS matricula_colaborador VARCHAR(60)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_matricula_colaborador VARCHAR(60)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_efectivo_nombre VARCHAR(120)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_efectivo_apellidos VARCHAR(180)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_efectivo_dni VARCHAR(40)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_efectivo_telefono VARCHAR(40)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_precio_confirmado BOOLEAN DEFAULT false").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_precio_confirmado_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_carga_confirmada_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_en_camino_confirmada_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_descarga_confirmada_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_workflow_enviado_at TIMESTAMPTZ").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS colaborador_pedido_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        empresa_id UUID NOT NULL,
        accion VARCHAR(40) NOT NULL,
        token_hash VARCHAR(80) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        usado_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_colaborador_tokens_hash ON colaborador_pedido_tokens(token_hash)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_colaborador_tokens_pedido ON colaborador_pedido_tokens(pedido_id)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_colaborador_liq_tokens_pedido ON colaborador_liquidacion_tokens(pedido_id) WHERE pedido_id IS NOT NULL").catch(captureStartupMigrationError);
    // nominas_emitidas table
    await db.query(`
      CREATE TABLE IF NOT EXISTS nominas_emitidas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID,
        chofer_id UUID REFERENCES choferes(id) ON DELETE CASCADE,
        periodo VARCHAR(50) NOT NULL,
        datos JSONB,
        salario_base NUMERIC(10,2),
        total_bruto NUMERIC(10,2),
        total_deducciones NUMERIC(10,2),
        liquido NUMERIC(10,2),
        total_empresa NUMERIC(10,2),
        estado VARCHAR(20) DEFAULT 'borrador',
        notas TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS empresa_id UUID").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS cif VARCHAR(50)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS email VARCHAR(255)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS telefono VARCHAR(50)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS iban VARCHAR(50)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS valoracion SMALLINT DEFAULT 5").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS notas TEXT").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS tipo_iva NUMERIC(5,2) NOT NULL DEFAULT 21").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general'").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS calle VARCHAR(200)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS num_ext VARCHAR(20)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS ciudad VARCHAR(100)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS provincia VARCHAR(100)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS pais VARCHAR(80)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS contacto_nombre VARCHAR(150)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS contacto_telefono VARCHAR(50)").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(80) DEFAULT 'Transferencia bancaria'").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS vehiculos_ext (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (vehiculo_id)
      )
    `).catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()").catch(captureStartupMigrationError);
    await db.query("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_vehiculos_ext_empresa ON vehiculos_ext(empresa_id, vehiculo_id)").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS vehiculo_eventos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
        tipo VARCHAR(80) NOT NULL,
        actor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_vehiculo_eventos_empresa_vehiculo ON vehiculo_eventos(empresa_id, vehiculo_id, created_at DESC)").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS agenda_eventos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        creado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        asignado_a UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        titulo VARCHAR(220) NOT NULL,
        descripcion TEXT,
        fecha_inicio TIMESTAMPTZ NOT NULL,
        fecha_fin TIMESTAMPTZ,
        todo_dia BOOLEAN NOT NULL DEFAULT false,
        tipo VARCHAR(60) NOT NULL DEFAULT 'tarea',
        prioridad VARCHAR(20) NOT NULL DEFAULT 'media',
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        visibilidad VARCHAR(20) NOT NULL DEFAULT 'personal',
        pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
        vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_agenda_eventos_empresa_fecha ON agenda_eventos(empresa_id, fecha_inicio)").catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_agenda_eventos_asignado ON agenda_eventos(empresa_id, asignado_a, fecha_inicio)").catch(captureStartupMigrationError);
    await db.query(`
      CREATE TABLE IF NOT EXISTS vehiculo_km_vacio (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
        fecha DATE NOT NULL,
        km_vacio NUMERIC(12,2) NOT NULL DEFAULT 0,
        origen VARCHAR(180),
        destino VARCHAR(180),
        motivo VARCHAR(120),
        notas TEXT,
        created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    await db.query("CREATE INDEX IF NOT EXISTS idx_vehiculo_km_vacio_empresa_vehiculo_fecha ON vehiculo_km_vacio(empresa_id, vehiculo_id, fecha DESC)").catch(captureStartupMigrationError);
    // Ensure colaborador_vehiculos table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS colaborador_vehiculos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        colaborador_id UUID REFERENCES colaboradores(id) ON DELETE CASCADE,
        empresa_id UUID,
        matricula VARCHAR(20) NOT NULL,
        marca VARCHAR(100),
        modelo VARCHAR(100),
        año INTEGER,
        tipo VARCHAR(50),
        tara_kg INTEGER,
        carga_max_kg INTEGER,
        bastidor VARCHAR(100),
        num_ejes INTEGER,
        longitud_m NUMERIC(5,2),
        notas TEXT,
        activo BOOLEAN DEFAULT true,
        doc_tarjeta_exp DATE,
        doc_seguro_venc DATE,
        doc_itv_venc DATE,
        doc_tacografo_venc DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(captureStartupMigrationError);
    logger.info("✅ DB indexes + schema ready");
  } catch (e) {
    logger.error("[startup] migration failure: " + e.message);
    throw e;
  }
}


// ── Auto-seed: carga datos demo si la BD está vacía ──
function redactStartupOutput(value) {
  return String(value || "")
    .replace(/("(?:password|password_hash|token|secret)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/((?:password|token|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function runStartupScript(scriptName, label) {
  const { execFile } = require("child_process");
  const path = require("path");
  const scriptPath = path.join(__dirname, "../scripts", scriptName);
  execFile("node", [scriptPath], { env: process.env }, (err, stdout, stderr) => {
    if (err) {
      logger.warn(`${label} fallo: ${err.message}`);
      if (stderr) logger.warn(String(stderr).slice(0, 800));
      return;
    }
    logger.info(`${label} completado:\n${redactStartupOutput(stdout).slice(0, 800)}`);
  });
}

async function autoSeedIfEmpty() {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_SEED !== "true") return;
  try {
    const { rows } = await db.query("SELECT COUNT(*) AS n FROM empresas");
    if (parseInt(rows[0].n) === 0) {
      logger.info("🌱 BD vacía — ejecutando seed de demo...");
      // Run seed as a child process to avoid circular deps
      const { execFile } = require("child_process");
      const path = require("path");
      const seedPath = path.join(__dirname, "../scripts/seed.js");
      execFile("node", [seedPath], { env: process.env }, (err, stdout, stderr) => {
        if (err) { logger.warn("Seed falló: " + err.message); return; }
        logger.info("🌱 Seed completado:\n" + stdout.slice(0, 500));
      });
    }
  } catch(e) {
    // empresas table might not exist yet — ignore
    logger.debug("autoSeed check skipped: " + e.message);
  }
}
// ── Arranque ──────────────────────────────────────────
function seedDemoShowcaseIfEnabled() {
  if (process.env.DEMO_SHOWCASE_SEED === "false") return;
  runStartupScript("ensure_demo_showcase.js", "Demo showcase");
}

async function startServer() {
  try {
  logger.info("🚛 TransGest API — puerto " + PORT + " — " + process.env.NODE_ENV);
  await ensureApiKeyTables();
  await ensureNotificacionesSchema();
  await applyMigrations();
  await authRoutes.initializeSchema?.();
  await choferesRoutes.initializeSchema?.();
  await geocodingRoutes.initializeSchema?.();
  httpServer = app.listen(PORT, () => {
    logger.info("TransGest API lista en puerto " + PORT + " - " + process.env.NODE_ENV);
    if (process.env.ALLOW_DEMO_SEED === "true") setTimeout(autoSeedIfEmpty, 5000);
    if (process.env.DEMO_SHOWCASE_SEED !== "false") setTimeout(seedDemoShowcaseIfEnabled, 7000);
    try { backupService.startScheduler(); } catch (e) { logger.warn("Backup: " + e.message); }
    try { fiscalScheduler.startScheduler(); } catch (e) { logger.warn("Fiscal: " + e.message); }
    try { pedidosRoutes.startAlbaranesReminderScheduler?.(); } catch (e) { logger.warn("Albaranes: " + e.message); }
    try { billingReminders.startScheduler(); } catch (e) { logger.warn("Billing: " + e.message); }
    try { vehiculosRoutes.startGpsScheduler?.(); } catch (e) { logger.warn("GPS poller: " + e.message); }
  });
  } catch (e) {
    logger.error("Startup abortado: " + e.message);
    process.exit(1);
  }
}

startServer();

process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection: " + reason);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Cierre ordenado iniciado (${signal})`);
  const forcedExit = setTimeout(() => {
    logger.error("Cierre forzado tras agotar el tiempo de espera");
    process.exit(1);
  }, 10000);

  try {
    if (httpServer) {
      await new Promise(resolve => httpServer.close(resolve));
    }
    await auditQueue.flush();
    await db.pool.end();
    clearTimeout(forcedExit);
    process.exit(0);
  } catch (error) {
    logger.error("Error durante el cierre: " + error.message);
    clearTimeout(forcedExit);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
