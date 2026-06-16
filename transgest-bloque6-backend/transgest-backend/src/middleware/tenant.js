// ── Middleware de aislamiento por tenant ──────────────────────────────────
// Añade req.empresaId a partir del JWT del usuario
// Todos los queries deben filtrar por empresa_id = req.empresaId

const db = require("../services/db");

// Inyecta empresa_id en todas las queries del request
function tenantMiddleware(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "No autenticado" });
  
  // El empresa_id viene del JWT (se incluye al hacer login)
  if (!req.user.empresa_id) {
    return res.status(403).json({ error: "Usuario sin empresa asignada" });
  }
  
  req.empresaId = req.user.empresa_id;
  next();
}

// Helper para añadir empresa_id a queries de forma segura
function tenantFilter(req, extraWhere = [], extraParams = []) {
  const params = [req.empresaId, ...extraParams];
  const where  = [`empresa_id = $1`, ...extraWhere.map((w, i) => 
    w.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + 1}`)
  )];
  return { where, params, offset: 1 };
}

module.exports = { tenantMiddleware, tenantFilter };
