// Stub - registro público SaaS (no activo en este despliegue)
const express = require("express");
const router = express.Router();

router.post("/", (req, res) => {
  res.status(503).json({ error: "Registro público no disponible en este despliegue." });
});

router.get("/verificar", (req, res) => {
  res.status(503).json({ error: "Verificación no disponible." });
});

module.exports = router;
