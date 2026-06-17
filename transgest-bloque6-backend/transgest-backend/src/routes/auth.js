const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const crypto   = require("crypto");
const { body, validationResult } = require("express-validator");
const db       = require("../services/db");
const logger   = require("../services/logger");
const stripe   = require("../services/stripe");
const { authenticate, getSubscriptionState, normalizePermissionsForRole } = require("../middleware/auth");

const router = express.Router();

let authSchemaReady = false;
async function ensureAuthSchema() {
  if (authSchemaReady) return;
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trafico_config JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo_base64 TEXT").catch(() => {});
  await db.query("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfg_precios JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
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
      const { rows } = await db.query(
        `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.activo, u.empresa_id, u.cliente_id, u.chofer_id,
                u.username, u.perfil, u.permisos, u.trafico_config,
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
        if (user) auditLogin({ user, identifier, ok: false, req, motivo: "usuario_inactivo" });
        return res.status(401).json({ error: "Credenciales incorrectas" });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        logger.warn(`Login fallido para: ${identifier} desde ${req.ip}`);
        auditLogin({ user, identifier, ok: false, req, motivo: "credenciales_invalidas" });
        return res.status(401).json({ error: "Credenciales incorrectas" });
      }

      // Actualizar último acceso
      await db.query(
        "UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1",
        [user.id]
      );

      const subState = getSubscriptionState(user.empresa_id ? {
        estado: user.empresa_estado,
        plan: user.plan,
        fecha_vencimiento: user.fecha_vencimiento,
        bloqueo_manual: user.bloqueo_manual,
        bloqueo_motivo: user.bloqueo_motivo,
      } : null);

      const token = jwt.sign(
        { sub: user.id, rol: user.rol, empresa_id: user.empresa_id, plan: user.plan },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
      );

      logger.info(`Login exitoso: ${identifier} (${user.rol})`);
      auditLogin({ user, identifier, ok: true, req, motivo: "acceso_concedido" });

      const permisos = normalizePermissionsForRole(user.permisos, user.rol);

      res.json({
        token,
        user: {
          id:     user.id,
          nombre: user.nombre,
          email:  user.email,
          username: user.username,
          rol:    user.rol,
          cliente_id: user.cliente_id,
          chofer_id: user.chofer_id,
          perfil: user.perfil,
          permisos,
          trafico_config: user.trafico_config || {},
        },
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
  res.json({
    id:     req.user.id,
    nombre: req.user.nombre,
    email:  req.user.email,
    username: req.user.username,
    rol:    req.user.rol,
    cliente_id: req.user.cliente_id,
    chofer_id: req.user.chofer_id,
    perfil: req.user.perfil,
    permisos: req.user.permisos || {},
    trafico_config: req.user.trafico_config || {},
  });
});

router.post("/billing/checkout", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Token de acceso requerido" });

  let payload;
  try {
    payload = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
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
        "UPDATE usuarios SET password_hash=$1, activo=true, debe_cambiar_password=false WHERE id=$2",
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

    const hash = await bcrypt.hash(password_nuevo, 12);
    await db.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);

    logger.info(`Contraseña cambiada: ${req.user.email}`);
    res.json({ ok: true });
  }
);

module.exports = router;
