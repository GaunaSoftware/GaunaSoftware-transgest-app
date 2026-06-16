const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../services/db");
const { authenticate, requireModulePermission } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

async function launchToken(req, res) {
  const empresaId = req.empresaId || req.user?.empresa_id;
  if (!empresaId) return res.status(403).json({ error: "Usuario sin empresa asignada" });

  const { rows } = await db.query(
    `SELECT id, nombre, cif
       FROM empresas
      WHERE id=$1
      LIMIT 1`,
    [empresaId]
  );
  const empresa = rows[0];
  if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

  const ssoToken = jwt.sign(
    {
      purpose: "accounting_sso",
      sub: req.user.id,
      email: req.user.email || req.user.username || null,
      nombre: req.user.nombre || "",
      rol: req.user.rol,
      permisos: req.user.permisos || {},
      tenant_id: empresa.id,
      tenant_name: empresa.nombre,
      empresa_id: empresa.id,
      empresa_nombre: empresa.nombre,
      empresa_cif: empresa.cif || null,
      source: "transgest",
    },
    process.env.ACCOUNTING_SSO_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.ACCOUNTING_SSO_EXPIRES_IN || "2m" }
  );

  const baseUrl = (process.env.ACCOUNTING_FRONTEND_URL || "http://localhost:8080").replace(/\/+$/, "");
  res.json({
    ok: true,
    sso_token: ssoToken,
    launch_url: `${baseUrl}/?sso_token=${encodeURIComponent(ssoToken)}`,
    expires_in_seconds: 120,
  });
}

router.get("/launch-token", requireModulePermission("contabilidad"), launchToken);
router.post("/launch-token", requireModulePermission("contabilidad"), launchToken);

module.exports = router;
