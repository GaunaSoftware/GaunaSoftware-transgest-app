require("../resolveWorkspaceModules");
const jwt = require("jsonwebtoken");
const config = require("../services/config");
const db = require("../services/db");
const { hasPermission } = require("../domain/rbac");
const { loadUserContext } = require("../services/bootstrapAccounting");

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Token contable requerido" });
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    if (payload.purpose !== "accounting_session") return res.status(401).json({ error: "Token contable invalido" });
    const contexts = await db.transaction(client => loadUserContext(client, payload.sub));
    if (!contexts.length) return res.status(401).json({ error: "Usuario contable no autorizado" });
    req.accountingUser = {
      id: payload.sub,
      selected_company_id: payload.company_id || contexts[0].company_id,
      contexts,
      permissions: contexts.find(c => c.company_id === (payload.company_id || contexts[0].company_id))?.permissions || [],
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token contable invalido o caducado" });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.accountingUser, permission)) {
      return res.status(403).json({ error: "Permiso contable denegado", permission });
    }
    next();
  };
}

module.exports = { authenticate, requirePermission };
