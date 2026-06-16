const express = require("express");
const { body, param, query, validationResult } = require("express-validator");
const db      = require("../services/db");
const logger  = require("../services/logger");
const { authenticate, GERENTE_O_CONTABLE, PUEDE_CAMBIAR_ESTADO_FACTURA } = require("../middleware/auth");
const { enviarEmail } = require("../services/email");

const router = express.Router();
router.use(authenticate);

// ── GET /facturas ─────────────────────────────────────
router.get("/", GERENTE_O_CONTABLE, async (req, res) => {
  const { estado, cliente_id, serie, desde, hasta, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const where  = ["f.empresa_id = $1"]; // tenant isolation
  const params = [req.empresaId||req.user.empresa_id];
  let i = 2;

  if (estado)     { where.push(`f.estado = $${i++}`);      params.push(estado); }
  if (cliente_id) { where.push(`f.cliente_id = $${i++}`);  params.push(cliente_id); }
  if (serie)      { where.push(`f.serie = $${i++}`);        params.push(serie); }
  if (desde)      { where.push(`f.fecha >= $${i++}`);       params.push(desde); }
  if (hasta)      { where.push(`f.fecha <= $${i++}`);       params.push(hasta); }

  const sql = `
    SELECT f.*,
           c.nombre  AS cliente_nombre,
           c.cif     AS cliente_cif,
           c.email   AS cliente_email,
           COALESCE(fp_count.num_pedidos, 0) AS num_pedidos
    FROM facturas f
    JOIN clientes c ON c.id = f.cliente_id
    LEFT JOIN (
      SELECT factura_id, COUNT(*) AS num_pedidos
      FROM factura_pedidos
      GROUP BY factura_id
    ) fp_count ON fp_count.factura_id = f.id
    WHERE ${where.join(" AND ")}
    ORDER BY f.fecha DESC, f.numero DESC
    LIMIT $${i++} OFFSET $${i++}
  `;
  params.push(limit, offset);

  const countSql = `SELECT COUNT(*) FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE ${where.join(" AND ")}`;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query(sql, params),
    db.query(countSql, params.slice(0, -2)),
  ]);

  res.json({ data: rows, total: parseInt(countRows[0].count), page: +page, limit: +limit });
});

// ── GET /facturas/:id ─────────────────────────────────
router.get("/:id", GERENTE_O_CONTABLE, async (req, res) => {
  const { rows } = await db.query(`
    SELECT f.*,
           c.nombre AS cliente_nombre, c.cif AS cliente_cif, c.email AS cliente_email,
           c.direccion AS cliente_dir, c.tipo_iva, c.tipo_irpf, c.forma_pago, c.vencimiento
    FROM facturas f JOIN clientes c ON c.id = f.cliente_id
    WHERE f.id = $1
  `, [req.params.id]);

  if (!rows[0]) return res.status(404).json({ error: "Factura no encontrada" });

  const [lineas, extras, pedidos] = await Promise.all([
    db.query("SELECT * FROM factura_lineas     WHERE factura_id=$1 ORDER BY orden,id", [req.params.id]),
    db.query("SELECT * FROM factura_extracostes WHERE factura_id=$1 ORDER BY id",      [req.params.id]),
    db.query(`SELECT p.id, p.numero, p.origen, p.destino, p.fecha_pedido
              FROM factura_pedidos fp JOIN pedidos p ON p.id=fp.pedido_id
              WHERE fp.factura_id=$1`, [req.params.id]),
  ]);

  res.json({ ...rows[0], lineas: lineas.rows, extracostes: extras.rows, pedidos: pedidos.rows });
});

// ── POST /facturas ────────────────────────────────────
router.post("/", GERENTE_O_CONTABLE,
  body("cliente_id").isUUID(),
  body("serie").isIn(["A","B","R","G"]),
  body("lineas").isArray({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { cliente_id, serie, fecha, fecha_vencimiento, estado, forma_pago, vencimiento,
            lineas, extracostes = [], pedidos_ids = [], observaciones, notas_internas } = req.body;

    await db.transaction(async (client) => {
      // Generar número correlativo
      const año = new Date(fecha || Date.now()).getFullYear();
      const { rows: last } = await client.query(
        `SELECT numero FROM facturas WHERE serie=$1 AND EXTRACT(year FROM fecha)=$2 ORDER BY numero DESC LIMIT 1 FOR UPDATE`,
        [serie, año]
      );
      const lastNum = last[0] ? parseInt(last[0].numero.split("-").pop()) : 0;
      const numero  = `${serie}-${año}-${String(lastNum + 1).padStart(4, "0")}`;

      // Calcular totales
      const base = lineas.reduce((s, l) => s + (l.cantidad * l.precio_unit), 0)
                 + (extracostes||[]).reduce((s, e) => s + parseFloat(e.importe || 0), 0);
      const { rows: cliRows } = await client.query("SELECT tipo_iva, tipo_irpf FROM clientes WHERE id=$1", [cliente_id]);
      const tipoIva  = cliRows[0]?.tipo_iva  || 21;
      const tipoIrpf = cliRows[0]?.tipo_irpf || 0;
      const cuotaIva  = base * tipoIva  / 100;
      const cuotaIrpf = base * tipoIrpf / 100;
      const total     = base + cuotaIva - cuotaIrpf;

      const { rows: [fac] } = await client.query(`
        INSERT INTO facturas
          (numero, serie, cliente_id, fecha, fecha_vencimiento, estado, forma_pago, vencimiento,
           base_imponible, tipo_iva, cuota_iva, tipo_irpf, cuota_irpf, total,
           observaciones, notas_internas, created_by, empresa_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING *`,
        [numero, serie, cliente_id, fecha || new Date(), fecha_vencimiento, estado || "borrador",
         forma_pago, vencimiento, base, tipoIva, cuotaIva, tipoIrpf, cuotaIrpf, total,
         observaciones, notas_internas, req.user.id, req.empresaId||req.user.empresa_id]
      );

      // Insertar líneas
      for (const [i, l] of lineas.entries()) {
        await client.query(
          `INSERT INTO factura_lineas (factura_id, concepto, cantidad, precio_unit, orden) VALUES ($1,$2,$3,$4,$5)`,
          [fac.id, l.concepto, l.cantidad, l.precio_unit, i]
        );
      }

      // Insertar extracostes
      for (const e of extracostes) {
        await client.query(
          `INSERT INTO factura_extracostes (factura_id, tipo, concepto, importe) VALUES ($1,$2,$3,$4)`,
          [fac.id, e.tipo || "otro", e.concepto, e.importe]
        );
      }

      // Vincular pedidos
      for (const pid of pedidos_ids) {
        await client.query(
          `INSERT INTO factura_pedidos (factura_id, pedido_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [fac.id, pid]
        );
        await client.query("UPDATE pedidos SET factura_id=$1 WHERE id=$2", [fac.id, pid]);
      }

      res.status(201).json(fac);
      logger.info(`Factura creada: ${numero} por ${req.user.email}`);
    });
  }
);

// ── PATCH /facturas/:id/estado ────────────────────────
// Solo gerente/contable. Con audit log.
router.patch("/:id/estado", PUEDE_CAMBIAR_ESTADO_FACTURA,
  body("estado").isIn(["borrador","emitida","enviada","cobrada","vencida","rectificada"]),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { estado, motivo } = req.body;

    const { rows } = await db.query("SELECT * FROM facturas WHERE id=$1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Factura no encontrada" });

    const factura      = rows[0];
    const estadoAntes  = factura.estado;

    await db.transaction(async (client) => {
      await client.query("UPDATE facturas SET estado=$1, updated_by=$2 WHERE id=$3", [estado, req.user.id, factura.id]);

      // Audit log
      await client.query(
        `INSERT INTO audit_log (tabla, registro_id, campo, valor_antes, valor_nuevo, usuario_id, ip)
         VALUES ('facturas', $1, 'estado', $2, $3, $4, $5)`,
        [factura.id, estadoAntes, estado, req.user.id, req.ip]
      );

      // Email automático si pasa a "cobrada" o "vencida"
      if (estado === "emitida" || estado === "enviada") {
        const { rows: cliRows } = await client.query("SELECT email, nombre FROM clientes WHERE id=$1", [factura.cliente_id]);
        if (cliRows[0]?.email) {
          enviarEmail({
            trigger: "factura_emitida",
            destinatario: cliRows[0].email,
            plantilla: "factura_emitida",
            datos: {
              numero:           factura.numero,
              total:            factura.total,
              fecha_vencimiento:factura.fecha_vencimiento,
              forma_pago:       factura.forma_pago,
              iban:             "ES91 2100 0418 4502 0005 1332",
              empresa:          cliRows[0].nombre,
            },
          }).catch(err => logger.error("Email factura:", err.message));
        }
      }
    });

    logger.info(`Estado factura ${factura.numero}: ${estadoAntes} → ${estado} por ${req.user.email}`);
    res.json({ ok: true, estado_anterior: estadoAntes, estado_nuevo: estado });
  }
);

// ── DELETE /facturas/:id ──────────────────────────────
// Solo borradores pueden eliminarse
router.delete("/:id", GERENTE_O_CONTABLE, async (req, res) => {
  const { rows } = await db.query("SELECT estado, numero FROM facturas WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Factura no encontrada" });
  if (rows[0].estado !== "borrador") {
    return res.status(400).json({ error: "Solo se pueden eliminar facturas en estado borrador" });
  }

  await db.query("DELETE FROM facturas WHERE id=$1", [req.params.id]);
  logger.warn(`Factura eliminada: ${rows[0].numero} por ${req.user.email}`);
  res.json({ ok: true });
});

module.exports = router;
