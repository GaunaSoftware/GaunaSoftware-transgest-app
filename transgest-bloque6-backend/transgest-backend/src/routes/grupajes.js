const express = require("express");
const r = express.Router();
const db = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const mw = [authenticate, GERENTE_O_TRAFICO];

// GET /grupajes — list all grupajes
r.get("/", mw, async (req,res) => {
  const { empresa_id } = req.user;
  try {
    const { rows } = await db.query(
      `SELECT g.*, 
        COUNT(p.id) AS num_pedidos,
        COALESCE(SUM(p.importe),0) AS importe_total,
        COALESCE(SUM(p.peso_kg),0) AS peso_total_kg,
        v.matricula AS vehiculo_matricula
       FROM grupajes g
       LEFT JOIN pedidos p ON p.grupaje_id = g.id
       LEFT JOIN vehiculos v ON v.id = g.vehiculo_id
       WHERE g.empresa_id = $1
       GROUP BY g.id, v.matricula
       ORDER BY g.created_at DESC`,
      [empresa_id]
    );
    res.json(rows);
  } catch(e) {
    // Table might not exist yet
    if (e.code === '42P01') return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

// POST /grupajes — create grupaje
r.post("/", mw, async (req,res) => {
  const { empresa_id } = req.user;
  const { nombre, vehiculo_id, chofer_id, fecha, kg_disponible } = req.body;
  try {
    // Create table if not exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS grupajes (
        id          SERIAL PRIMARY KEY,
        empresa_id  INTEGER NOT NULL,
        nombre      VARCHAR(200) NOT NULL,
        vehiculo_id INTEGER REFERENCES vehiculos(id),
        chofer_id   INTEGER REFERENCES choferes(id),
        fecha       DATE,
        kg_disponible NUMERIC DEFAULT 24000,
        estado      VARCHAR(30) DEFAULT 'pendiente',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add tipo_carga and grupaje_id to pedidos if missing
    await db.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_carga VARCHAR(20) DEFAULT 'completa'`).catch(()=>{});
    await db.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS grupaje_id INTEGER REFERENCES grupajes(id)`).catch(()=>{});

    const { rows } = await db.query(
      `INSERT INTO grupajes (empresa_id, nombre, vehiculo_id, chofer_id, fecha, kg_disponible)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [empresa_id, nombre, vehiculo_id||null, chofer_id||null, fecha||null, kg_disponible||24000]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /grupajes/:id — update grupaje
r.patch("/:id", mw, async (req,res) => {
  const { empresa_id } = req.user;
  const { nombre, vehiculo_id, chofer_id, fecha, kg_disponible, estado } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE grupajes SET 
        nombre=COALESCE($1,nombre), vehiculo_id=COALESCE($2,vehiculo_id),
        chofer_id=COALESCE($3,chofer_id), fecha=COALESCE($4,fecha),
        kg_disponible=COALESCE($5,kg_disponible), estado=COALESCE($6,estado)
       WHERE id=$7 AND empresa_id=$8 RETURNING *`,
      [nombre, vehiculo_id, chofer_id, fecha, kg_disponible, estado, req.params.id, empresa_id]
    );
    if (!rows[0]) return res.status(404).json({ error: "No encontrado" });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /grupajes/:id/pedidos — add pedido to grupaje
r.post("/:id/pedidos", mw, async (req,res) => {
  const { empresa_id } = req.user;
  const { pedido_id } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE pedidos SET grupaje_id=$1 WHERE id=$2 AND empresa_id=$3 RETURNING *`,
      [req.params.id, pedido_id, empresa_id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /grupajes/:id/pedidos/:pedidoId — remove pedido from grupaje
r.delete("/:id/pedidos/:pedidoId", mw, async (req,res) => {
  const { empresa_id } = req.user;
  try {
    await db.query(
      `UPDATE pedidos SET grupaje_id=NULL WHERE id=$1 AND empresa_id=$2`,
      [req.params.pedidoId, empresa_id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /grupajes/:id — delete grupaje
r.delete("/:id", mw, async (req,res) => {
  const { empresa_id } = req.user;
  try {
    // Unlink pedidos first
    await db.query(`UPDATE pedidos SET grupaje_id=NULL WHERE grupaje_id=$1 AND empresa_id=$2`, [req.params.id, empresa_id]);
    await db.query(`DELETE FROM grupajes WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresa_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = r;
