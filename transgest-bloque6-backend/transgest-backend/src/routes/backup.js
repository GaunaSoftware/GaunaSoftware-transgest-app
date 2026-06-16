const express = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const db = require("../services/db");

const router = express.Router();
router.use(authenticate);
router.use(requireRole("gerente"));

router.get("/", (req, res) => {
  res.status(403).json({ error: "Los backups se gestionan desde TransGestAdmin. Usa /backup/solicitudes para pedir uno." });
});

router.post("/solicitudes", async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    const { motivo } = req.body || {};
    const { rows } = await db.query(
      `INSERT INTO backup_solicitudes (empresa_id, solicitado_por, motivo)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [empresaId, req.user.id, motivo || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/solicitudes", async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    const { rows } = await db.query(
      `SELECT id,motivo,estado,filename,created_at,resuelto_at
       FROM backup_solicitudes
       WHERE empresa_id=$1
       ORDER BY created_at DESC`,
      [empresaId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/run", async (req, res) => {
  res.status(403).json({ error: "Las empresas solo pueden solicitar backups. TransGestAdmin debe generarlos." });
});

router.get("/download/:filename", (req, res) => {
  res.status(403).json({ error: "La descarga de backups solo esta disponible en TransGestAdmin." });
});

module.exports = router;
