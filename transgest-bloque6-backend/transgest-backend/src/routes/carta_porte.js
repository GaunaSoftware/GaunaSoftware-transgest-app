// routes/carta_porte.js
const express = require("express");
const router  = express.Router();
const db      = require("../services/db");
const { authenticate } = require("../middleware/auth");
router.use(authenticate);

router.get("/:id/carta-porte", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;

    const { rows } = await db.query(`
      SELECT p.*,
        c.nombre AS cliente_nombre, c.cif AS cliente_cif,
        c.direccion AS cliente_direccion, c.ciudad AS cliente_ciudad,
        c.pais AS cliente_pais, c.telefono AS cliente_telefono,
        c.email AS cliente_email,
        ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos,
        ch.dni AS chofer_dni, ch.telefono AS chofer_telefono,
        v.matricula AS vehiculo_matricula, v.marca AS vehiculo_marca,
        v.modelo AS vehiculo_modelo, r2.matricula AS remolque_matricula
      FROM pedidos p
      LEFT JOIN clientes  c  ON c.id  = p.cliente_id
      LEFT JOIN choferes  ch ON ch.id = p.chofer_id
      LEFT JOIN vehiculos v  ON v.id  = p.vehiculo_id
      LEFT JOIN vehiculos r2 ON r2.id = p.remolque_id
      WHERE p.id = $1 AND p.empresa_id = $2
    `, [req.params.id, empresaId]);

    if (!rows[0]) return res.status(404).json({ error: "Pedido no encontrado" });

    // empresas tabla REAL solo tiene: nombre, cif (sin direccion/telefono/email)
    let empresaData = { empresa_nombre: "", empresa_cif: "", empresa_direccion: "", empresa_telefono: "", empresa_email: "" };
    try {
      const { rows: er } = await db.query(
        "SELECT nombre, cif FROM empresas WHERE id = $1 LIMIT 1", [empresaId]
      );
      if (er[0]) {
        empresaData.empresa_nombre = er[0].nombre || "";
        empresaData.empresa_cif    = er[0].cif    || "";
      }
    } catch (e2) { /* sin datos de empresa */ }

    res.json({ ...rows[0], ...empresaData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
