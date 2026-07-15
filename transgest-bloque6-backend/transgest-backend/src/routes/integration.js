// Endpoints de conveniencia para integradores externos. Accesibles con API key
// (tgk_) o con sesion de usuario. No requieren permiso de modulo concreto.
const express = require("express");
const db = require("../services/db");

const router = express.Router();

// GET /integration/ping — comprobacion rapida de conectividad y credencial.
router.get("/ping", (req, res) => {
  res.json({
    ok: true,
    service: "transgest-api",
    time: new Date().toISOString(),
    principal: req.user?.api_key_id ? "api_key" : "usuario",
    empresa_id: req.user?.empresa_id || null,
  });
});

// GET /integration/whoami — identidad y permisos efectivos de la credencial.
router.get("/whoami", async (req, res, next) => {
  try {
    const empresaId = req.user?.empresa_id || req.empresaId || null;
    let empresaNombre = "";
    if (empresaId) {
      const { rows } = await db
        .query("SELECT nombre FROM empresas WHERE id=$1 LIMIT 1", [empresaId])
        .catch(() => ({ rows: [] }));
      empresaNombre = rows[0]?.nombre || "";
    }

    const modulos = req.user?.permisos?.modulos || {};
    const grants = Object.entries(modulos)
      .filter(([, v]) => v && (v.ver || v.editar))
      .map(([modulo, v]) => ({ modulo, read: !!v.ver, write: !!v.editar }));

    if (req.user?.api_key_id) {
      return res.json({
        type: "api_key",
        key_id: req.user.api_key_id,
        nombre: req.user.nombre || "Integracion API",
        empresa_id: empresaId,
        empresa_nombre: empresaNombre,
        plan: req.user.plan || null,
        scopes: req.user.api_key_scopes || [],
        grants,
      });
    }

    res.json({
      type: "usuario",
      id: req.user?.id || null,
      rol: req.user?.rol || null,
      empresa_id: empresaId,
      empresa_nombre: empresaNombre,
      plan: req.user?.plan || null,
      grants,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
