// Gestion de API keys de empresa (solo gerencia). Las claves permiten a
// programas externos integrarse con la API de TransGest.
const express = require("express");
const empresaApiKeys = require("../services/empresaApiKeys");

const router = express.Router();

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id || null;
}

// Scopes disponibles (util para el frontend y la documentacion de integracion).
router.get("/scopes", (req, res) => {
  res.json({
    modules: empresaApiKeys.API_SCOPE_MODULES,
    format: "Cada scope es un modulo (acceso total) o modulo:read / modulo:write.",
    examples: ["pedidos", "clientes:read", "facturacion:write"],
    usage: "Envia la clave en la cabecera: Authorization: Bearer tgk_...",
  });
});

router.get("/", async (req, res, next) => {
  try {
    const eid = empresaId(req);
    if (!eid) return res.status(403).json({ error: "Usuario sin empresa" });
    res.json({ data: await empresaApiKeys.listKeys(eid) });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const eid = empresaId(req);
    if (!eid) return res.status(403).json({ error: "Usuario sin empresa" });
    const result = await empresaApiKeys.createKey(
      eid,
      {
        nombre: req.body?.nombre,
        scopes: req.body?.scopes,
        dias: req.body?.dias,
        rate_limit_per_hour: req.body?.rate_limit_per_hour,
      },
      req.user?.id || null,
      req.ip || null
    );
    res.status(201).json({
      token: result.token,
      message: "Copia esta clave ahora. No se volvera a mostrar completa.",
      credencial: result.credencial,
    });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const eid = empresaId(req);
    if (!eid) return res.status(403).json({ error: "Usuario sin empresa" });
    const revoked = await empresaApiKeys.revokeKey(eid, req.params.id, req.user?.id || null, req.ip || null);
    if (!revoked) return res.status(404).json({ error: "API key no encontrada" });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
