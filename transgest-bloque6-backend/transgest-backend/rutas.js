// ══════════════════════════════════════════════════
// src/routes/rutas.js
// ══════════════════════════════════════════════════
const express = require("express");
const db      = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const router  = express.Router();
router.use(authenticate);

router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM rutas WHERE activa=true ORDER BY origen,destino");
  res.json(rows);
});

router.get("/:id/precios", async (req, res) => {
  const [ruta, precios, repartos] = await Promise.all([
    db.query("SELECT * FROM rutas WHERE id=$1", [req.params.id]),
    db.query(`SELECT rpc.*, c.nombre AS cliente_nombre FROM ruta_precios_cliente rpc
              JOIN clientes c ON c.id=rpc.cliente_id WHERE rpc.ruta_id=$1`, [req.params.id]),
    db.query(`SELECT rr.*, c.nombre AS cliente_nombre FROM ruta_repartos rr
              LEFT JOIN clientes c ON c.id=rr.cliente_id WHERE rr.ruta_id=$1 ORDER BY rr.orden`, [req.params.id]),
  ]);
  res.json({ ...ruta.rows[0], precios: precios.rows, repartos: repartos.rows });
});

router.post("/", GERENTE_O_TRAFICO, async (req, res) => {
  const { origen, destino, km, peajes, tiempo_h, notas } = req.body;
  // Always store in uppercase to avoid duplicates
  const origenUp  = (origen||"").trim().toUpperCase();
  const destinoUp = (destino||"").trim().toUpperCase();
  if (!origenUp || !destinoUp) return res.status(400).json({ error: "Origen y destino son obligatorios" });
  // Check duplicate (case-insensitive already handled by uppercase)
  const exists = await db.query(
    "SELECT id FROM rutas WHERE UPPER(origen)=$1 AND UPPER(destino)=$2 AND activa=true",
    [origenUp, destinoUp]
  );
  if (exists.rows[0]) return res.status(409).json({ error: "Ya existe una ruta con ese origen y destino", ruta: exists.rows[0] });
  const { rows } = await db.query(
    "INSERT INTO rutas (origen,destino,km,peajes,tiempo_h,notas) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [origenUp, destinoUp, km||null, peajes||0, tiempo_h||null, notas||null]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", GERENTE_O_TRAFICO, async (req, res) => {
  const { origen, destino, km, peajes, tiempo_h, activa } = req.body;
  const { rows } = await db.query(
    "UPDATE rutas SET origen=$1,destino=$2,km=$3,peajes=$4,tiempo_h=$5,activa=$6 WHERE id=$7 RETURNING *",
    [(origen||"").trim().toUpperCase(),(destino||"").trim().toUpperCase(),km,peajes,tiempo_h,activa!==undefined?activa:true,req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error:"Ruta no encontrada" });
  res.json(rows[0]);
});

// Upsert precio por cliente
router.put("/:id/precio-cliente", GERENTE_O_TRAFICO, async (req, res) => {
  const { cliente_id, precio } = req.body;
  const { rows } = await db.query(`
    INSERT INTO ruta_precios_cliente (ruta_id,cliente_id,precio) VALUES ($1,$2,$3)
    ON CONFLICT (ruta_id,cliente_id) DO UPDATE SET precio=EXCLUDED.precio RETURNING *`,
    [req.params.id, cliente_id, precio]
  );
  res.json(rows[0]);
});

// Guardar repartos de una ruta
router.put("/:id/repartos", GERENTE_O_TRAFICO, async (req, res) => {
  const { repartos } = req.body; // array de {cliente_id, lugar, precio, orden}
  await db.transaction(async (client) => {
    await client.query("DELETE FROM ruta_repartos WHERE ruta_id=$1", [req.params.id]);
    for (const [i, r] of repartos.entries()) {
      await client.query(
        "INSERT INTO ruta_repartos (ruta_id,cliente_id,lugar,precio,orden) VALUES ($1,$2,$3,$4,$5)",
        [req.params.id, r.cliente_id||null, r.lugar, r.precio, i]
      );
    }
  });
  res.json({ ok: true });
});

module.exports = router;
