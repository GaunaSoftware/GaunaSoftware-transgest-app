const express = require("express");
const db      = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const router  = express.Router();
router.use(authenticate);

// GET /pedidos/:id/descargas
router.get("/pedidos/:id/descargas", async (req, res) => {
  const emp = req.empresaId || req.user?.empresa_id;
  const { rows } = await db.query(
    "SELECT * FROM pedido_descargas WHERE pedido_id=$1 AND empresa_id=$2 ORDER BY orden,created_at",
    [req.params.id, emp]
  ).catch(()=>({rows:[]}));
  res.json(rows);
});

// POST /pedidos/:id/descargas
router.post("/pedidos/:id/descargas", GERENTE_O_TRAFICO, async (req, res) => {
  const emp = req.empresaId || req.user?.empresa_id;
  const { direccion, cliente_nombre, fecha_descarga, hora_descarga, ventana_inicio, ventana_fin, bultos, peso_kg, precio, notas, orden } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO pedido_descargas (pedido_id,empresa_id,direccion,cliente_nombre,fecha_descarga,hora_descarga,ventana_inicio,ventana_fin,bultos,peso_kg,precio,notas,orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.params.id,emp,direccion,cliente_nombre,fecha_descarga||null,hora_descarga||null,ventana_inicio||null,ventana_fin||null,bultos||null,peso_kg||null,precio||0,notas||null,orden||0]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /pedidos/:id/descargas/:did
router.patch("/pedidos/:id/descargas/:did", GERENTE_O_TRAFICO, async (req, res) => {
  const { entregado, ...rest } = req.body;
  const fields = []; const vals = [];
  let i = 1;
  if (entregado !== undefined) { fields.push(`entregado=$${i++}`); vals.push(entregado); }
  Object.entries(rest).forEach(([k,v]) => {
    const allowed = ['direccion','cliente_nombre','fecha_descarga','hora_descarga','ventana_inicio','ventana_fin','bultos','peso_kg','precio','notas','orden'];
    if (allowed.includes(k)) { fields.push(`${k}=$${i++}`); vals.push(v); }
  });
  if (!fields.length) return res.status(400).json({ error: "No fields to update" });
  const emp = req.empresaId || req.user?.empresa_id;
  vals.push(req.params.did, req.params.id, emp);
  const { rows } = await db.query(`UPDATE pedido_descargas SET ${fields.join(',')} WHERE id=$${i++} AND pedido_id=$${i++} AND empresa_id=$${i} RETURNING *`, vals).catch(e=>({rows:[]}));
  res.json(rows[0]||{});
});

// DELETE /pedidos/:id/descargas/:did
router.delete("/pedidos/:id/descargas/:did", GERENTE_O_TRAFICO, async (req, res) => {
  const emp = req.empresaId || req.user?.empresa_id;
  await db.query("DELETE FROM pedido_descargas WHERE id=$1 AND pedido_id=$2 AND empresa_id=$3", [req.params.did, req.params.id, emp]).catch(()=>{});
  res.json({ ok: true });
});

// ── GRUPAJES ──────────────────────────────────────────────────────────────
router.get("/grupajes", async (req, res) => {
  const emp = req.empresaId || req.user?.empresa_id;
  try {
    const { rows } = await db.query(
      `SELECT g.*, 
        COUNT(p.id) AS num_pedidos,
        COALESCE(SUM(p.peso_kg),0) AS peso_total,
        COALESCE(SUM(p.importe),0) AS importe_total
       FROM grupajes g
       LEFT JOIN pedidos p ON p.grupaje_id = g.id
       WHERE g.empresa_id=$1
       GROUP BY g.id ORDER BY g.fecha DESC, g.created_at DESC`,
      [emp]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/grupajes", GERENTE_O_TRAFICO, async (req, res) => {
  const emp = req.empresaId || req.user?.empresa_id;
  const { nombre, vehiculo_id, chofer_id, fecha, metros_libres, kg_disponible, notas } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO grupajes (empresa_id,nombre,vehiculo_id,chofer_id,fecha,metros_libres,kg_disponible,notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [emp, nombre||`Grupaje ${new Date().toLocaleDateString('es-ES')}`, vehiculo_id||null, chofer_id||null, fecha||null, metros_libres||13.6, kg_disponible||25600, notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch("/grupajes/:id", GERENTE_O_TRAFICO, async (req, res) => {
  const emp = req.empresaId || req.user?.empresa_id;
  const { nombre, vehiculo_id, chofer_id, fecha, estado, metros_libres, kg_disponible, notas } = req.body;
  const { rows } = await db.query(
    `UPDATE grupajes SET nombre=COALESCE($1,nombre), vehiculo_id=COALESCE($2,vehiculo_id), chofer_id=COALESCE($3,chofer_id),
     fecha=COALESCE($4,fecha), estado=COALESCE($5,estado), metros_libres=COALESCE($6,metros_libres),
     kg_disponible=COALESCE($7,kg_disponible), notas=COALESCE($8,notas) WHERE id=$9 AND empresa_id=$10 RETURNING *`,
    [nombre, vehiculo_id, chofer_id, fecha, estado, metros_libres, kg_disponible, notas, req.params.id, emp]
  ).catch(()=>({rows:[]}));
  res.json(rows[0]||{});
});

// Añadir pedido a grupaje
router.post("/grupajes/:id/pedidos", GERENTE_O_TRAFICO, async (req, res) => {
  const emp = req.empresaId || req.user?.empresa_id;
  const { pedido_id } = req.body;
  await db.query("UPDATE pedidos SET grupaje_id=$1 WHERE id=$2 AND empresa_id=$3", [req.params.id, pedido_id, emp]).catch(()=>{});
  res.json({ ok: true });
});

// Quitar pedido de grupaje
router.delete("/grupajes/:id/pedidos/:pid", GERENTE_O_TRAFICO, async (req, res) => {
  const emp = req.empresaId || req.user?.empresa_id;
  await db.query("UPDATE pedidos SET grupaje_id=NULL WHERE id=$1 AND empresa_id=$2", [req.params.pid, emp]).catch(()=>{});
  res.json({ ok: true });
});

module.exports = router;
