const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const crypto   = require("crypto");
const { body, validationResult } = require("express-validator");
const db       = require("../services/db");
const logger   = require("../services/logger");
const stripe   = require("../services/stripe");
const { userJwtSecret } = require("../services/jwtSecrets");
const { authenticate, getSubscriptionState, normalizePermissionsForRole } = require("../middleware/auth");
const ensureDemoShowcase = require("../../scripts/ensure_demo_showcase");

const router = express.Router();
const LOGIN_MAX_ATTEMPTS = Math.max(3, Number(process.env.LOGIN_MAX_ATTEMPTS || 5));
const LOGIN_LOCK_MINUTES = Math.max(5, Number(process.env.LOGIN_LOCK_MINUTES || 15));
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("transgest-invalid-login-probe", 12);
const DEMO_LOGIN_PASSWORD = "demo1234";
const DEMO_LOGIN_IDENTIFIERS = new Set([
  "gerente@empresa.com",
  "trafico@empresa.com",
  "contable@empresa.com",
  "taller@empresa.com",
  "chofer@empresa.com",
  "chofer2@empresa.com",
]);
let demoLoginSeedPromise = null;

let authSchemaReady = false;
async function ensureAuthSchema() {
  if (authSchemaReady) return;
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trafico_config JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT false").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo_base64 TEXT").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfg_precios JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS login_failed_count INTEGER NOT NULL DEFAULT 0").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ").catch(() => {});
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
  `).catch(() => {});
  authSchemaReady = true;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function logoDataUrl(row = {}) {
  const logo = String(row.logo_base64 || "").trim();
  if (!logo) return "";
  if (logo.startsWith("data:")) return logo;
  const mime = String(row.logo_mime || "image/png").trim() || "image/png";
  return `data:${mime};base64,${logo}`;
}

function isDemoEmpresa(row = {}) {
  const cfg = row.cfg_precios && typeof row.cfg_precios === "object" ? row.cfg_precios : {};
  const nombre = String(row.nombre || row.razon_social || "").toLowerCase();
  const dominio = String(row.dominio || "").toLowerCase();
  const email = String(row.email_admin || "").toLowerCase();
  return Boolean(
    cfg.demo_mode === true ||
    dominio === "demo" ||
    dominio.startsWith("demo-") ||
    email === "gerente@demo.com" ||
    email === "gerente@empresa.com" ||
    nombre.includes("demo")
  );
}

function signUserToken(user = {}) {
  return jwt.sign(
    { sub: user.id, rol: user.rol, empresa_id: user.empresa_id, plan: user.plan },
    userJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

async function ensureDemoForLogin(identifier, password) {
  if (password !== DEMO_LOGIN_PASSWORD || !DEMO_LOGIN_IDENTIFIERS.has(identifier)) return;
  if (!demoLoginSeedPromise) {
    demoLoginSeedPromise = ensureDemoShowcase({ closePool: false })
      .catch((err) => {
        demoLoginSeedPromise = null;
        throw err;
      });
  }
  await demoLoginSeedPromise;
}

function authUserPayload(user = {}, extra = {}) {
  const permisos = normalizePermissionsForRole(user.permisos, user.rol);
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    username: user.username,
    rol: user.rol,
    empresa_id: user.empresa_id,
    empresa_nombre: user.empresa_nombre || extra.empresa_nombre || "",
    plan: user.plan,
    demo_mode: Boolean(user.demo_mode ?? extra.demo_mode),
    cliente_id: user.cliente_id,
    chofer_id: user.chofer_id,
    perfil: user.perfil,
    permisos,
    trafico_config: user.trafico_config || {},
    debe_cambiar_password: Boolean(user.debe_cambiar_password),
    password_changed_at: user.password_changed_at || null,
  };
}

async function auditLogin({ user, identifier, ok, req, motivo }) {
  await db.query(
    `INSERT INTO audit_log_saas
      (actor_tipo,actor_id,actor_email,empresa_id,accion,detalle,ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      "usuario",
      user?.id || null,
      user?.email || user?.username || identifier || null,
      user?.empresa_id || null,
      ok ? "LOGIN correcto" : "LOGIN fallido",
      JSON.stringify({
        status: ok ? 200 : 401,
        motivo: motivo || null,
        rol: user?.rol || null,
      }),
      req.ip,
    ]
  ).catch(e => logger.debug("audit_login omitido: " + e.message));
}

// ── POST /api/v1/auth/login ───────────────────────────
router.get("/login-brand", async (req, res) => {
  const identifier = String(req.query.identifier || req.query.email || req.query.usuario || "").trim().toLowerCase();
  if (!identifier || identifier.length < 3) return res.json({ found: false });
  try {
    await ensureAuthSchema();
    const { rows } = await db.query(
      `SELECT e.nombre, e.razon_social, e.logo_base64, e.cfg_precios->>'logo_mime' AS logo_mime,
              u.rol
         FROM usuarios u
         JOIN empresas e ON e.id=u.empresa_id
        WHERE (LOWER(u.email)=$1 OR LOWER(u.username)=$1)
          AND u.activo IS DISTINCT FROM false
        LIMIT 1`,
      [identifier]
    );
    const row = rows[0];
    if (!row) return res.json({ found: false });
    res.json({
      found: true,
      empresa_nombre: row.nombre || row.razon_social || "",
      portal_cliente: ["cliente", "cliente_portal"].includes(String(row.rol || "").toLowerCase()),
      logo_url: logoDataUrl(row),
    });
  } catch (err) {
    logger.debug("login_brand omitido: " + err.message);
    res.json({ found: false });
  }
});

router.post("/forgot-password",
  body("identifier").optional().isString().trim().isLength({ min: 3 }),
  body("email").optional().isString().trim().isLength({ min: 3 }),
  async (req, res) => {
    const raw = String(req.body?.identifier || req.body?.email || "").trim().toLowerCase();
    if (!raw || raw.length < 3) {
      return res.status(400).json({ error: "Indica tu usuario o email" });
    }
    try {
      await ensureAuthSchema();
      const { rows } = await db.query(
        `SELECT u.id,u.nombre,u.email,u.username,u.rol,u.empresa_id,e.nombre AS empresa_nombre
           FROM usuarios u
           LEFT JOIN empresas e ON e.id=u.empresa_id
          WHERE LOWER(u.email)=$1 OR LOWER(u.username)=$1
          ORDER BY u.activo DESC, u.created_at ASC
          LIMIT 1`,
        [raw]
      );
      const user = rows[0] || null;
      await db.query(
        `INSERT INTO password_reset_requests
          (empresa_id,usuario_id,identifier,email,nombre,rol,estado,ip,user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,'pendiente',$7,$8)`,
        [
          user?.empresa_id || null,
          user?.id || null,
          raw,
          user?.email || raw,
          user?.nombre || null,
          user?.rol || null,
          req.ip || null,
          req.get("user-agent") || null,
        ]
      );
      logger.info(`Solicitud de recuperacion de contrasena: ${raw}${user ? ` (${user.empresa_nombre || user.empresa_id})` : " (sin usuario localizado)"}`);
      res.json({
        ok: true,
        message: "Solicitud recibida. Un administrador revisara el reset de contrasena.",
      });
    } catch (err) {
      logger.error("Forgot password error:", err.message);
      res.status(500).json({ error: "No se pudo registrar la solicitud" });
    }
  }
);

router.post("/login",
  body("email").optional().isString().trim().isLength({ min: 1 }),
  body("usuario").optional().isString().trim().isLength({ min: 1 }),
  body("password").isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, usuario, password } = req.body;
    const identifier = String(email || usuario || "").trim().toLowerCase();
    if (!identifier) return res.status(400).json({ error: "Usuario/email y contraseña requeridos" });

    try {
      await ensureAuthSchema();
      await ensureDemoForLogin(identifier, password);
      const { rows } = await db.query(
        `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.activo, u.empresa_id, u.cliente_id, u.chofer_id,
                u.username, u.perfil, u.permisos, u.trafico_config, u.debe_cambiar_password, u.password_changed_at,
                u.login_failed_count, u.login_locked_until,
                e.nombre AS empresa_nombre, e.email_admin, e.dominio, e.cfg_precios,
                e.plan, e.estado AS empresa_estado, e.fecha_vencimiento,
                e.bloqueo_manual, e.bloqueo_motivo
         FROM usuarios u
         LEFT JOIN empresas e ON e.id = u.empresa_id
         WHERE LOWER(u.email) = $1 OR LOWER(u.username) = $1`,
        [identifier]
      );

      const user = rows[0];

      // Mismo mensaje tanto si no existe como si la contraseña es incorrecta
      if (!user || !user.activo) {
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        if (user) auditLogin({ user, identifier, ok: false, req, motivo: "usuario_inactivo" });
        return res.status(401).json({ error: "Credenciales incorrectas" });
      }

      const lockedUntil = user.login_locked_until ? new Date(user.login_locked_until) : null;
      if (lockedUntil && lockedUntil > new Date()) {
        auditLogin({ user, identifier, ok: false, req, motivo: "bloqueo_temporal" });
        return res.status(429).json({
          error: "Acceso bloqueado temporalmente por intentos fallidos. Vuelve a intentarlo mas tarde.",
          locked_until: lockedUntil.toISOString(),
        });
      }
      if (lockedUntil) {
        user.login_failed_count = 0;
        await db.query("UPDATE usuarios SET login_failed_count=0, login_locked_until=NULL WHERE id=$1", [user.id]);
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        const failedCount = Number(user.login_failed_count || 0) + 1;
        const shouldLock = failedCount >= LOGIN_MAX_ATTEMPTS;
        await db.query(
          `UPDATE usuarios
              SET login_failed_count=$2,
                  login_locked_until=CASE WHEN $3 THEN NOW() + ($4 * INTERVAL '1 minute') ELSE NULL END
            WHERE id=$1`,
          [user.id, failedCount, shouldLock, LOGIN_LOCK_MINUTES]
        );
        logger.warn(`Login fallido para: ${identifier} desde ${req.ip}`);
        auditLogin({ user, identifier, ok: false, req, motivo: shouldLock ? "bloqueo_por_intentos" : "credenciales_invalidas" });
        if (shouldLock) {
          return res.status(429).json({ error: `Acceso bloqueado durante ${LOGIN_LOCK_MINUTES} minutos por intentos fallidos.` });
        }
        return res.status(401).json({ error: "Credenciales incorrectas" });
      }

      // Actualizar último acceso
      await db.query(
        "UPDATE usuarios SET ultimo_acceso=NOW(), login_failed_count=0, login_locked_until=NULL WHERE id=$1",
        [user.id]
      );

      const subState = getSubscriptionState(user.empresa_id ? {
        estado: user.empresa_estado,
        plan: user.plan,
        fecha_vencimiento: user.fecha_vencimiento,
        bloqueo_manual: user.bloqueo_manual,
        bloqueo_motivo: user.bloqueo_motivo,
      } : null);

      user.demo_mode = isDemoEmpresa(user);
      const token = signUserToken(user);

      logger.info(`Login exitoso: ${identifier} (${user.rol})`);
      auditLogin({ user, identifier, ok: true, req, motivo: "acceso_concedido" });

      res.json({
        token,
        user: authUserPayload(user),
        suscripcion: subState.suscripcion,
        bloqueado: subState.blocked ? {
          motivo: subState.motivo,
          mensaje: subState.mensaje,
        } : null,
      });
    } catch (err) {
      logger.error("Login error:", err.message);
      res.status(500).json({ error: "Error del servidor" });
    }
  }
);

// ── GET /api/v1/auth/me ───────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.username, u.rol, u.empresa_id, u.cliente_id, u.chofer_id,
            u.perfil, u.permisos, u.trafico_config, u.debe_cambiar_password, u.password_changed_at,
            e.nombre AS empresa_nombre, e.email_admin, e.dominio, e.plan, e.cfg_precios
       FROM usuarios u
       LEFT JOIN empresas e ON e.id=u.empresa_id
      WHERE u.id=$1
      LIMIT 1`,
    [req.user.id]
  ).catch(() => ({ rows: [] }));
  const user = rows[0] || req.user;
  user.demo_mode = isDemoEmpresa(user);
  res.json(authUserPayload(user));
});

async function assertDemoSession(req, res) {
  const empresaId = req.user?.empresa_id;
  if (!empresaId) {
    res.status(403).json({ error: "Solo disponible en cuenta demo." });
    return null;
  }
  const { rows } = await db.query(
    "SELECT id,nombre,email_admin,dominio,plan,cfg_precios FROM empresas WHERE id=$1 LIMIT 1",
    [empresaId]
  );
  const empresa = rows[0];
  if (!empresa || !isDemoEmpresa(empresa)) {
    res.status(403).json({ error: "Solo disponible en cuenta demo." });
    return null;
  }
  return empresa;
}

router.get("/demo/options", authenticate, async (req, res) => {
  const empresa = await assertDemoSession(req, res);
  if (!empresa) return;
  const { rows } = await db.query(
    `SELECT id,nombre,email,username,rol,chofer_id,cliente_id
       FROM usuarios
      WHERE empresa_id=$1 AND activo IS DISTINCT FROM false
        AND rol::text IN ('gerente','trafico','contable','chofer','administrativo','responsable_taller','mecanico','colaborador','visualizador')
      ORDER BY CASE rol::text
        WHEN 'gerente' THEN 1
        WHEN 'trafico' THEN 2
        WHEN 'contable' THEN 3
        WHEN 'chofer' THEN 4
        ELSE 9
      END, nombre`,
    [empresa.id]
  );
  res.json({
    demo: true,
    empresa: { id: empresa.id, nombre: empresa.nombre, plan: empresa.plan },
    plans: [
      { id: "lite", label: "Lite / Mini" },
      { id: "basico", label: "Basico" },
      { id: "profesional", label: "Profesional" },
      { id: "enterprise", label: "Enterprise" },
    ],
    usuarios: rows,
  });
});

router.post("/demo/switch-plan", authenticate, async (req, res) => {
  const empresa = await assertDemoSession(req, res);
  if (!empresa) return;
  const plan = String(req.body?.plan || "").toLowerCase();
  if (!["lite", "basico", "profesional", "enterprise"].includes(plan)) {
    return res.status(400).json({ error: "Plan demo no valido" });
  }
  await db.query(
    `UPDATE empresas
        SET plan=$2,
            cfg_precios=jsonb_set(COALESCE(cfg_precios,'{}'::jsonb), '{demo_mode}', 'true'::jsonb, true)
      WHERE id=$1`,
    [empresa.id, plan]
  );
  const { rows } = await db.query(
    `SELECT u.id,u.nombre,u.email,u.username,u.rol,u.empresa_id,u.cliente_id,u.chofer_id,u.perfil,u.permisos,u.trafico_config,
            u.debe_cambiar_password,u.password_changed_at,
            e.nombre AS empresa_nombre, e.email_admin, e.dominio, e.plan, e.cfg_precios
       FROM usuarios u
       JOIN empresas e ON e.id=u.empresa_id
      WHERE u.id=$1 AND u.empresa_id=$2
      LIMIT 1`,
    [req.user.id, empresa.id]
  );
  const user = rows[0];
  user.demo_mode = true;
  res.json({ token: signUserToken(user), user: authUserPayload(user), plan });
});

router.post("/demo/switch-user", authenticate, async (req, res) => {
  const empresa = await assertDemoSession(req, res);
  if (!empresa) return;
  const targetId = String(req.body?.user_id || "").trim();
  const targetRol = String(req.body?.rol || "").trim().toLowerCase();
  const params = [empresa.id];
  let where = "u.empresa_id=$1 AND u.activo IS DISTINCT FROM false";
  if (targetId) {
    params.push(targetId);
    where += ` AND u.id=$${params.length}`;
  } else if (targetRol) {
    params.push(targetRol);
    where += ` AND u.rol::text=$${params.length}`;
  } else {
    return res.status(400).json({ error: "Indica usuario demo" });
  }
  const { rows } = await db.query(
    `SELECT u.id,u.nombre,u.email,u.username,u.rol,u.empresa_id,u.cliente_id,u.chofer_id,u.perfil,u.permisos,u.trafico_config,
            u.debe_cambiar_password,u.password_changed_at,
            e.nombre AS empresa_nombre, e.email_admin, e.dominio, e.plan, e.cfg_precios
       FROM usuarios u
       JOIN empresas e ON e.id=u.empresa_id
      WHERE ${where}
      ORDER BY u.nombre
      LIMIT 1`,
    params
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "Usuario demo no encontrado" });
  user.demo_mode = true;
  res.json({ token: signUserToken(user), user: authUserPayload(user) });
});

router.post("/billing/checkout", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Token de acceso requerido" });

  let payload;
  try {
    payload = jwt.verify(header.split(" ")[1], userJwtSecret());
  } catch {
    return res.status(401).json({ error: "Token invalido" });
  }

  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.rol, u.empresa_id,
            e.nombre AS empresa_nombre, e.email_admin, e.plan, e.ciclo_facturacion, e.metodo_pago,
            e.stripe_customer_id
     FROM usuarios u
     JOIN empresas e ON e.id=u.empresa_id
     WHERE u.id=$1`,
    [payload.sub]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Usuario no valido" });
  if (user.rol !== "gerente") return res.status(403).json({ error: "Solo gerencia puede abrir el pago" });

  const plan = req.body.plan || user.plan || "profesional";
  const ciclo = req.body.ciclo || user.ciclo_facturacion || "mensual";
  const priceId = stripe.planPriceId(plan, ciclo);
  if (!stripe.configured() || !priceId) {
    return res.status(503).json({
      error: "Stripe no esta configurado para este plan/ciclo",
      faltan: [
        !stripe.configured() ? "STRIPE_SECRET_KEY" : null,
        !priceId ? `STRIPE_PRICE_${plan.toUpperCase()}_${ciclo.toUpperCase()}` : null,
      ].filter(Boolean),
    });
  }

  try {
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.createCustomer({
        email: user.email || user.email_admin,
        name: user.empresa_nombre,
        empresaId: user.empresa_id,
      });
      customerId = customer.id;
      await db.query("UPDATE empresas SET stripe_customer_id=$1 WHERE id=$2", [customerId, user.empresa_id]);
    }

    const session = await stripe.createCheckoutSession({
      customerId,
      priceId,
      empresaId: user.empresa_id,
      plan,
      ciclo,
      userId: user.id,
      metodoPago: user.metodo_pago || "auto",
    });
    res.json({ ok: true, url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/invitacion/:token", async (req, res) => {
  const tokenHash = hashToken(req.params.token || "");
  const { rows } = await db.query(`
    SELECT i.id, i.email, i.expires_at, i.usado_at,
           u.id AS usuario_id, u.nombre, u.email AS usuario_email, u.rol,
           e.nombre AS empresa_nombre
    FROM invitaciones_usuario i
    JOIN usuarios u ON u.id=i.usuario_id
    JOIN empresas e ON e.id=i.empresa_id
    WHERE i.token_hash=$1
  `, [tokenHash]).catch(() => ({ rows: [] }));
  const inv = rows[0];
  if (!inv || inv.usado_at || new Date(inv.expires_at) < new Date()) {
    return res.status(404).json({ error: "Invitación no válida o caducada" });
  }
  res.json({
    ok: true,
    nombre: inv.nombre,
    email: inv.usuario_email,
    rol: inv.rol,
    empresa: inv.empresa_nombre,
    expires_at: inv.expires_at,
  });
});

router.post("/invitacion/:token",
  body("password").isLength({ min: 8 }).withMessage("Mínimo 8 caracteres"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const tokenHash = hashToken(req.params.token || "");
    const { rows } = await db.query(`
      SELECT i.id, i.usuario_id, i.expires_at, i.usado_at, u.email
      FROM invitaciones_usuario i
      JOIN usuarios u ON u.id=i.usuario_id
      WHERE i.token_hash=$1
    `, [tokenHash]).catch(() => ({ rows: [] }));
    const inv = rows[0];
    if (!inv || inv.usado_at || new Date(inv.expires_at) < new Date()) {
      return res.status(404).json({ error: "Invitación no válida o caducada" });
    }
    const hash = await bcrypt.hash(req.body.password, 12);
    await db.transaction(async (client) => {
      await client.query(
        "UPDATE usuarios SET password_hash=$1, activo=true, debe_cambiar_password=false, password_changed_at=NOW() WHERE id=$2",
        [hash, inv.usuario_id]
      );
      await client.query("UPDATE invitaciones_usuario SET usado_at=NOW() WHERE id=$1", [inv.id]);
    });
    res.json({ ok: true });
  }
);

// ── POST /api/v1/auth/cambiar-password ────────────────
router.post("/cambiar-password", authenticate,
  body("password_actual").notEmpty(),
  body("password_nuevo").isLength({ min: 8 }).withMessage("Mínimo 8 caracteres"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { password_actual, password_nuevo } = req.body;

    const { rows } = await db.query(
      "SELECT password_hash FROM usuarios WHERE id = $1",
      [req.user.id]
    );

    const valid = await bcrypt.compare(password_actual, rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: "Contraseña actual incorrecta" });
    const samePassword = await bcrypt.compare(password_nuevo, rows[0].password_hash);
    if (samePassword) {
      return res.status(400).json({ error: "La nueva contrasena debe ser distinta a la actual" });
    }

    const hash = await bcrypt.hash(password_nuevo, 12);
    await db.query(
      "UPDATE usuarios SET password_hash = $1, debe_cambiar_password=false, password_changed_at=NOW() WHERE id = $2",
      [hash, req.user.id]
    );

    logger.info(`Contraseña cambiada: ${req.user.email}`);
    res.json({ ok: true });
  }
);

module.exports = router;
