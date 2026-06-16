require("../resolveWorkspaceModules");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../services/db");
const config = require("../services/config");
const { accountingRoleForTransgestRole, hasTransgestAccountingPermission } = require("../domain/rbac");
const { syncSsoContext } = require("../services/bootstrapAccounting");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLike(value) {
  return UUID_RE.test(String(value || ""));
}

function issueAccountingToken({ userId, companyId = null }) {
  return jwt.sign(
    { sub: userId, company_id: companyId, purpose: "accounting_session" },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

router.post("/sso/exchange", async (req, res, next) => {
  const token = req.body?.sso_token || req.body?.token;
  if (!token) return res.status(400).json({ error: "sso_token requerido" });

  let payload;
  try {
    payload = jwt.verify(token, config.ssoJwtSecret);
  } catch {
    return res.status(401).json({ error: "Token SSO invalido o caducado" });
  }

  if (payload.purpose !== "accounting_sso") {
    return res.status(401).json({ error: "Token SSO no valido para contabilidad" });
  }
  if (!hasTransgestAccountingPermission(payload.permisos, payload.rol)) {
    return res.status(403).json({ error: "El usuario no tiene permiso para Contabilidad" });
  }
  if (!isUuidLike(payload.empresa_id) || !isUuidLike(payload.tenant_id || payload.empresa_id)) {
    return res.status(400).json({ error: "Contexto SSO de empresa invalido" });
  }

  try {
    const context = await db.transaction(async client => {
      return syncSsoContext(client, {
        ...payload,
        accounting_role: accountingRoleForTransgestRole(payload.rol),
      });
    });

    const sessionToken = issueAccountingToken({ userId: context.user.id, companyId: context.company.id });
    res.json({
      token: sessionToken,
      user: {
        id: context.user.id,
        email: context.user.email,
        display_name: context.user.display_name,
      },
      selected_company_id: context.company.id,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", authenticate, async (req, res) => {
  const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
  res.json({
    user_id: req.accountingUser.id,
    selected_company_id: req.accountingUser.selected_company_id,
    selected_company: selected || null,
    permissions: req.accountingUser.permissions,
  });
});

module.exports = router;
module.exports.isUuidLike = isUuidLike;
