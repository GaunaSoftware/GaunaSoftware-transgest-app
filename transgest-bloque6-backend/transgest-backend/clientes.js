const express = require("express");
const { body, validationResult } = require("express-validator");
const db      = require("../services/db");
const { authenticate, GERENTE_O_CONTABLE } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// GET /clientes?q=texto&activo=true
router.get("/", async (req, res) => {
  const { q, activo, page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;
  const where  = ["empresa_id = $1"]; // tenant isolation
  const params = [req.empresaId||req.user.empresa_id];
  let i = 2;

  if (q) {
    where.push(`(nombre ILIKE $${i} OR cif ILIKE $${i} OR contacto ILIKE $${i} OR email ILIKE $${i})`);
    params.push(`%${q}%`); i++;
  }
  if (activo !== undefined) { where.push(`activo = $${i++}`); params.push(activo === "true"); }

  const { rows } = await db.query(
    `SELECT * FROM clientes WHERE ${where.join(" AND ")} ORDER BY nombre ASC LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );
  res.json(rows);
});

// GET /clientes/:id
router.get("/:id", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Cliente no encontrado" });
  res.json(rows[0]);
});

// POST /clientes
router.post("/", GERENTE_O_CONTABLE,
  body("nombre").notEmpty().trim(),
  body("cif").notEmpty().trim().toUpperCase(),
  body("tipo_iva").isInt({ min:0, max:100 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nombre, cif, direccion, cp, ciudad, pais, email, contacto, telefono,
            forma_pago, vencimiento, tipo_iva, tipo_irpf, precio_tn_km, notas,
            calle, num_ext, codigo_postal, pendiente_revision,
            horario_carga, horario_descarga, email_facturacion, iban } = req.body;
    const empresaId = req.empresaId||req.user.empresa_id;
    // Auto-marcar como pendiente si faltan datos clave
    const incompleto = pendiente_revision ||
      !cif?.trim() || !email?.trim() || !telefono?.trim() ||
      (!cp?.trim() && !codigo_postal?.trim()) || (!ciudad?.trim());

    const { rows } = await db.query(`
      INSERT INTO clientes (nombre,cif,direccion,cp,ciudad,pais,email,contacto,telefono,
        forma_pago,vencimiento,tipo_iva,tipo_irpf,precio_tn_km,notas,empresa_id,
        pendiente_revision)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [nombre,cif||null,calle?(calle+(num_ext?' '+num_ext:'')):direccion||null,
       codigo_postal||cp||null,ciudad||null,pais||"España",
       email||null,contacto||null,telefono||null,
       forma_pago||"Transferencia bancaria",vencimiento||"30 días",
       tipo_iva||21,tipo_irpf||0,precio_tn_km||0,notas||null,empresaId,incompleto]
    );
    res.status(201).json(rows[0]);
  }
);

// PUT /clientes/:id
router.put("/:id", GERENTE_O_CONTABLE, async (req, res) => {
  const { nombre, cif, direccion, cp, ciudad, pais, email, contacto, telefono,
          forma_pago, vencimiento, tipo_iva, tipo_irpf, precio_tn_km, activo, notas } = req.body;

  const { rows } = await db.query(`
    UPDATE clientes SET nombre=$1,cif=$2,direccion=$3,cp=$4,ciudad=$5,pais=$6,email=$7,
      contacto=$8,telefono=$9,forma_pago=$10,vencimiento=$11,tipo_iva=$12,tipo_irpf=$13,
      precio_tn_km=$14,activo=$15,notas=$16
    WHERE id=$17 RETURNING *`,
    [nombre,cif,direccion,cp,ciudad,pais,email,contacto,telefono,forma_pago,vencimiento,
     tipo_iva,tipo_irpf,precio_tn_km,activo!==undefined?activo:true,notas,req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Cliente no encontrado" });
  res.json(rows[0]);
});

// DELETE /clientes/:id — solo desactivar, no borrar
router.delete("/:id", GERENTE_O_CONTABLE, async (req, res) => {
  await db.query("UPDATE clientes SET activo=false WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// GET /clientes/pendientes-revision — count for notification badge
router.get("/pendientes-revision", async (req,res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    const {rows} = await db.query(
      "SELECT COUNT(*) FROM clientes WHERE empresa_id=$1 AND pendiente_revision=true AND activo=true",
      [empresaId]
    );
    res.json({count: parseInt(rows[0].count)});
  } catch(e) {
    // If column doesn't exist yet, return 0
    res.json({count: 0});
  }
});

// PATCH /clientes/:id/revision — mark as reviewed
router.patch("/:id/revision", async (req,res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    await db.query(
      "UPDATE clientes SET pendiente_revision=false WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET /clientes/:id/rutas — listar rutas del cliente
router.get("/:id/rutas", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  try {
    const { rows } = await db.query(
      `SELECT rc.*, r.origen, r.destino, r.km, r.peajes, r.tiempo_h
       FROM ruta_precios_cliente rc
       JOIN rutas r ON r.id = rc.ruta_id
       WHERE rc.cliente_id = $1
       ORDER BY r.origen, r.destino`,
      [req.params.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /clientes/:id/rutas — crear ruta vinculada a cliente
router.post("/:id/rutas", async (req,res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    const { origen, destino, km, precio_base, notas } = req.body;
    if (!origen || !destino) return res.status(400).json({error:"Faltan origen y destino"});
    // Crear o actualizar la ruta general
    const { rows: existing } = await db.query(
      "SELECT id FROM rutas WHERE LOWER(TRIM(origen))=LOWER(TRIM($1)) AND LOWER(TRIM(destino))=LOWER(TRIM($2)) AND empresa_id=$3",
      [origen, destino, empresaId]
    );
    let rutaId;
    if (existing[0]) {
      rutaId = existing[0].id;
    } else {
      const { rows: nueva } = await db.query(
        "INSERT INTO rutas (origen,destino,km,notas,empresa_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [origen.trim(), destino.trim(), km||null, notas||null, empresaId]
      );
      rutaId = nueva[0].id;
    }
    // Vincular precio al cliente
    if (precio_base) {
      await db.query(
        "INSERT INTO ruta_precios_cliente (ruta_id,cliente_id,precio) VALUES ($1,$2,$3) ON CONFLICT (ruta_id,cliente_id) DO UPDATE SET precio=EXCLUDED.precio",
        [rutaId, req.params.id, precio_base]
      );
    }
    res.status(201).json({ ruta_id: rutaId, ok: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
