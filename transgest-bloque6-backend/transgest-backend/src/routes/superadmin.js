const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../services/db");
const { superadminJwtSecret } = require("../services/jwtSecrets");
const legacyRouter = require("./superadmin_original");

const router = express.Router();

const PUBLIC_ROUTES = new Set([
  "POST /login",
  "GET /public/app-meta",
]);

function requestKey(req) {
  return `${String(req.method || "GET").toUpperCase()} ${req.path || "/"}`;
}

function currentAdminRole(value) {
  return String(value || "superadmin").trim().toLowerCase() || "superadmin";
}

function isSuperadminOnlyRequest(req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.path || "/");

  if (path === "/usuarios-admin" || path.startsWith("/usuarios-admin/")) return true;
  if (method === "DELETE" && /^\/empresas\/[^/]+\/purgar\/?$/.test(path)) return true;
  if (method === "PUT" && path === "/correo/config") return true;
  if (["PUT", "DELETE"].includes(method) && /^\/integraciones\/global\/[^/]+\/?$/.test(path)) return true;
  if (method === "PUT" && path === "/integraciones/ia") return true;
  if (["PUT", "DELETE"].includes(method) && path === "/config/ia-key") return true;
  if (method === "PUT" && path === "/config/app-meta") return true;
  if (method === "DELETE" && /^\/empresas\/[^/]+\/?$/.test(path)) return true;
  return false;
}

function isSupportOrSuperadminRequest(req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.path || "/");
  if (method === "POST" && /^\/password-reset-requests\/[^/]+\/(?:reset|descartar)\/?$/.test(path)) return true;
  if (method === "POST" && /^\/empresas\/[^/]+\/(?:reset-password|reinvitar|impersonar)\/?$/.test(path)) return true;
  return false;
}

async function audit(req, accion, detalle = {}, empresaId = null) {
  await db.query(
    `INSERT INTO audit_log_saas (actor_tipo, actor_id, actor_email, empresa_id, accion, detalle, ip)
     VALUES ('superadmin', $1, $2, $3, $4, $5, $6)`,
    [req.superadmin?.id || null, req.superadmin?.email || null, empresaId, accion, JSON.stringify(detalle), req.ip]
  ).catch(() => {});
}

async function ensurePasswordResetRequestsSchema() {
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
}

router.use(async (req, res, next) => {
  if (PUBLIC_ROUTES.has(requestKey(req))) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autorizado" });

  try {
    const payload = jwt.verify(header.slice(7), superadminJwtSecret(), { algorithms: ["HS256"] });
    if (!payload?.superadmin || !payload?.id) return res.status(403).json({ error: "Acceso denegado" });

    const { rows } = await db.query(
      "SELECT id,nombre,email,rol,activo FROM superadmins WHERE id=$1 LIMIT 1",
      [payload.id]
    );
    const account = rows[0];
    if (!account || account.activo !== true) {
      return res.status(401).json({ error: "Sesion administrativa no valida" });
    }

    req.superadmin = {
      ...payload,
      id: account.id,
      nombre: account.nombre,
      email: account.email,
      rol: currentAdminRole(account.rol),
    };

    if (isSuperadminOnlyRequest(req) && req.superadmin.rol !== "superadmin") {
      return res.status(403).json({ error: "Esta operacion requiere rol superadmin" });
    }
    if (isSupportOrSuperadminRequest(req) && !["superadmin", "soporte"].includes(req.superadmin.rol)) {
      return res.status(403).json({ error: "Esta operacion requiere rol de soporte o superadmin" });
    }

    return next();
  } catch (err) {
    if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError" || err?.name === "NotBeforeError") {
      return res.status(401).json({ error: "Token invalido o caducado" });
    }
    return next(err);
  }
});

// Correccion acotada: un reset administrativo debe invalidar cualquier JWT de usuario
// emitido antes del cambio de contrasena. Se conserva el resto del comportamiento.
router.post("/password-reset-requests/:id/reset", async (req, res, next) => {
  try {
    await ensurePasswordResetRequestsSchema();
    const password = String(req.body?.password || "").trim();
    if (password.length < 8) return res.status(400).json({ error: "La contrasena debe tener al menos 8 caracteres" });

    const { rows } = await db.query(
      `SELECT r.*, u.email AS usuario_email, u.username AS usuario_username, u.empresa_id AS usuario_empresa_id
         FROM password_reset_requests r
         LEFT JOIN usuarios u ON u.id=r.usuario_id
        WHERE r.id=$1
        LIMIT 1`,
      [req.params.id]
    );
    const solicitud = rows[0];
    if (!solicitud) return res.status(404).json({ error: "Solicitud no encontrada" });
    if (!solicitud.usuario_id) return res.status(400).json({ error: "No hay un usuario asociado a esta solicitud" });

    const hash = await bcrypt.hash(password, 12);
    const updated = await db.query(
      `UPDATE usuarios
          SET password_hash=$1, activo=true, debe_cambiar_password=true, password_changed_at=NOW(),
              login_failed_count=0, login_locked_until=NULL
        WHERE id=$2
        RETURNING id,nombre,email,username,rol,empresa_id`,
      [hash, solicitud.usuario_id]
    );
    const usuario = updated.rows[0];
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

    await db.query(
      `UPDATE password_reset_requests
          SET estado='resuelto', resolved_at=NOW(), resolved_by=$2, resolution_note=$3
        WHERE id=$1`,
      [solicitud.id, req.superadmin?.id || null, "Password reseteada desde superadmin"]
    );
    await audit(req, "password_reset_request.resuelta", {
      solicitud_id: solicitud.id,
      usuario_id: usuario.id,
      email: usuario.email || usuario.username,
    }, usuario.empresa_id || solicitud.empresa_id || null);

    return res.json({ ok: true, usuario: usuario.email || usuario.username });
  } catch (err) {
    return next(err);
  }
});

router.post("/empresas/:id/reset-password", async (req, res, next) => {
  try {
    const password = String(req.body?.password || "").trim();
    if (password.length < 8) return res.status(400).json({ error: "La contrasena debe tener al menos 8 caracteres" });

    const empresaRes = await db.query("SELECT id,nombre,email_admin FROM empresas WHERE id=$1", [req.params.id]);
    const empresa = empresaRes.rows[0];
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

    const hash = await bcrypt.hash(password, 12);
    const userRes = await db.query(
      `SELECT id,nombre,email,username,rol
       FROM usuarios
       WHERE empresa_id=$1
       ORDER BY CASE WHEN rol='gerente' THEN 0 ELSE 1 END, activo DESC, created_at ASC
       LIMIT 1`,
      [empresa.id]
    );
    let usuario = userRes.rows[0];

    if (usuario) {
      const updated = await db.query(
        `UPDATE usuarios
         SET password_hash=$1, activo=true, debe_cambiar_password=true, password_changed_at=NOW(),
             username=COALESCE(NULLIF(username,''), LOWER(COALESCE(email,$2)))
         WHERE id=$3
         RETURNING id,nombre,email,username,rol`,
        [hash, empresa.email_admin || null, usuario.id]
      );
      usuario = updated.rows[0];
    } else {
      const email = String(empresa.email_admin || `gerente.${empresa.id}@transgest.local`).trim().toLowerCase();
      const created = await db.query(
        `INSERT INTO usuarios (nombre,email,username,password_hash,rol,empresa_id,activo,debe_cambiar_password)
         VALUES ('Gerente', $1, $1, $2, 'gerente', $3, true, false)
         RETURNING id,nombre,email,username,rol`,
        [email, hash, empresa.id]
      );
      usuario = created.rows[0];
    }

    await audit(req, "empresa.password_reset", { usuario_id: usuario.id, email: usuario.email || usuario.username }, empresa.id);
    return res.json({ ok: true, usuario: usuario.email || usuario.username });
  } catch (err) {
    return next(err);
  }
});

router.use(legacyRouter);

module.exports = router;
