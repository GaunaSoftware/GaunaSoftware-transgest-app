const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const db       = require("../services/db");
const logger   = require("../services/logger");

const router = express.Router();

// ── Superadmin auth middleware ────────────────────────────────────────────
function superAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autorizado" });
  try {
    const payload = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    if (!payload.superadmin) return res.status(403).json({ error: "Acceso denegado" });
    req.superadmin = payload;
    next();
  } catch { return res.status(401).json({ error: "Token inválido" }); }
}

// ── POST /superadmin/login ────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email y contraseña requeridos" });
  try {
    const { rows } = await db.query("SELECT * FROM superadmins WHERE email=$1", [email]);
    if (!rows[0]) return res.status(401).json({ error: "Credenciales incorrectas" });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Credenciales incorrectas" });
    const token = jwt.sign({ superadmin: true, id: rows[0].id, email }, process.env.JWT_SECRET, { expiresIn: "4h" });
    res.json({ token, nombre: rows[0].nombre });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── GET /superadmin/empresas — Listar todas las empresas ─────────────────
router.get("/empresas", superAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT e.*,
      (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id=e.id) AS n_usuarios,
      (SELECT COUNT(*) FROM vehiculos v WHERE v.empresa_id=e.id) AS n_vehiculos,
      (SELECT COUNT(*) FROM pedidos p WHERE p.empresa_id=e.id) AS n_pedidos,
      (SELECT COUNT(*) FROM facturas f WHERE f.empresa_id=e.id) AS n_facturas
    FROM empresas e
    ORDER BY e.created_at DESC
  `);
  res.json(rows);
});

// ── POST /superadmin/empresas — Crear empresa manualmente ────────────────
router.post("/empresas", superAuth, async (req, res) => {
  const bcrypt = require("bcryptjs");
  const { nombre_empresa, cif, email_admin, nombre_admin, password, plan = "profesional", fecha_vencimiento } = req.body;
  if (!nombre_empresa || !email_admin || !password || !nombre_admin) {
    return res.status(400).json({ error: "Nombre empresa, email, nombre admin y contraseña son obligatorios" });
  }
  try {
    const PLANES = {
      lite:        { max_vehiculos: 1,  max_usuarios: 2 },
      basico:      { max_vehiculos: 3,  max_usuarios: 2 },
      profesional: { max_vehiculos: 10, max_usuarios: 5 },
      enterprise:  { max_vehiculos: 50, max_usuarios: 20 },
    };
    const planCfg = PLANES[plan] || PLANES.profesional;
    const dominio = nombre_empresa.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 30);

    const empresaRes = await db.query(`
      INSERT INTO empresas (nombre, cif, email_admin, dominio, plan, max_vehiculos, max_usuarios, fecha_vencimiento)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, nombre, dominio
    `, [nombre_empresa, cif||null, email_admin, dominio, plan, planCfg.max_vehiculos, planCfg.max_usuarios,
        fecha_vencimiento || null]);

    const empresa = empresaRes.rows[0];
    const hash = await bcrypt.hash(password, 12);
    await db.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol, empresa_id)
      VALUES ($1,$2,$3,'gerente',$4)
    `, [nombre_admin, email_admin, hash, empresa.id]);

    res.status(201).json({ ok: true, empresa });
  } catch(err) {
    if (err.code === "23505") return res.status(409).json({ error: "El email o dominio ya existe" });
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /superadmin/empresas/:id — Actualizar empresa ──────────────────
router.patch("/empresas/:id", superAuth, async (req, res) => {
  const { plan, estado, max_vehiculos, max_usuarios, fecha_vencimiento } = req.body;
  const updates = [], params = [];
  let i = 1;
  if (plan)               { updates.push(`plan=$${i++}`);               params.push(plan); }
  if (estado)             { updates.push(`estado=$${i++}`);             params.push(estado); }
  if (max_vehiculos)      { updates.push(`max_vehiculos=$${i++}`);      params.push(max_vehiculos); }
  if (max_usuarios)       { updates.push(`max_usuarios=$${i++}`);       params.push(max_usuarios); }
  if (fecha_vencimiento)  { updates.push(`fecha_vencimiento=$${i++}`);  params.push(fecha_vencimiento); }
  if (!updates.length) return res.status(400).json({ error: "Nada que actualizar" });
  params.push(req.params.id);
  await db.query(`UPDATE empresas SET ${updates.join(",")} WHERE id=$${i}`, params);
  res.json({ ok: true });
});

// ── GET /superadmin/stats — Métricas globales ─────────────────────────────
router.get("/stats", superAuth, async (req, res) => {
  const [empresas, usuarios, pedidos, facturas] = await Promise.all([
    db.query("SELECT COUNT(*) FROM empresas WHERE estado='activo'"),
    db.query("SELECT COUNT(*) FROM usuarios"),
    db.query("SELECT COUNT(*) FROM pedidos WHERE fecha_pedido >= NOW()-INTERVAL '30 days'"),
    db.query("SELECT COALESCE(SUM(total),0) AS total FROM facturas WHERE fecha >= NOW()-INTERVAL '30 days'"),
  ]);
  res.json({
    empresas_activas: parseInt(empresas.rows[0].count),
    usuarios_total:   parseInt(usuarios.rows[0].count),
    pedidos_mes:      parseInt(pedidos.rows[0].count),
    facturacion_mes:  parseFloat(facturas.rows[0].total),
  });
});

// ── DELETE /superadmin/empresas/:id — Eliminar empresa ───────────────────
router.delete("/empresas/:id", superAuth, async (req, res) => {
  if (!req.body.confirmar) return res.status(400).json({ error: "Incluye confirmar:true" });
  await db.query("UPDATE empresas SET estado='cancelado' WHERE id=$1", [req.params.id]);
  logger.warn(`Empresa ${req.params.id} marcada como cancelada por superadmin ${req.superadmin.email}`);
  res.json({ ok: true });
});

// ── POST /superadmin/facturas-suscripcion — Emitir factura a empresa ─────
router.post("/facturas-suscripcion", superAuth, async (req, res) => {
  const { empresa_id, concepto, plan, periodo_desde, periodo_hasta, importe, fecha_vencimiento } = req.body;
  if (!empresa_id || !importe || !periodo_desde || !periodo_hasta) {
    return res.status(400).json({ error: "empresa_id, importe, periodo_desde y periodo_hasta son obligatorios" });
  }
  try {
    // Check table exists, create if not
    await db.query(`
      CREATE TABLE IF NOT EXISTS facturas_suscripcion (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero VARCHAR(30) NOT NULL,
        concepto VARCHAR(200) NOT NULL DEFAULT 'Suscripción TransGest',
        plan VARCHAR(20),
        periodo_desde DATE NOT NULL,
        periodo_hasta DATE NOT NULL,
        importe NUMERIC(8,2) NOT NULL,
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
        fecha_vencimiento DATE,
        fecha_pago DATE,
        notas TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Generate number
    const last = await db.query("SELECT numero FROM facturas_suscripcion ORDER BY created_at DESC LIMIT 1");
    const lastN = last.rows[0] ? parseInt(last.rows[0].numero.replace(/[^0-9]/g,"")) : 0;
    const numero = "FTMS-" + String(new Date().getFullYear()) + "-" + String(lastN+1).padStart(4,"0");
    const { rows } = await db.query(`
      INSERT INTO facturas_suscripcion (empresa_id, numero, concepto, plan, periodo_desde, periodo_hasta, importe, fecha_vencimiento)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [empresa_id, numero, concepto||"Suscripción TransGest", plan||null, periodo_desde, periodo_hasta, importe, fecha_vencimiento||null]);
    res.status(201).json(rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /superadmin/facturas-suscripcion/:id — Marcar pagada/vencida ────
router.patch("/facturas-suscripcion/:id", superAuth, async (req, res) => {
  const { estado, fecha_pago } = req.body;
  await db.query(
    "UPDATE facturas_suscripcion SET estado=$1, fecha_pago=$2 WHERE id=$3",
    [estado, fecha_pago||null, req.params.id]
  );
  res.json({ ok: true });
});

// ── GET/SET Anthropic API Key (superadmin only) ─────────────────────
router.get("/config/ia-key", superAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT value FROM system_config WHERE key='anthropic_api_key' LIMIT 1"
    );
    const key = rows[0]?.value || process.env.ANTHROPIC_API_KEY || "";
    // Return masked key for security
    const masked = key ? key.slice(0,12) + "..." + key.slice(-4) : "";
    res.json({ configured: !!key, masked, source: rows[0] ? "database" : (process.env.ANTHROPIC_API_KEY ? "env" : "none") });
  } catch(e) {
    // Table might not exist yet
    const key = process.env.ANTHROPIC_API_KEY || "";
    res.json({ configured: !!key, masked: key ? key.slice(0,12)+"..."+key.slice(-4) : "", source: key ? "env" : "none" });
  }
});

router.put("/config/ia-key", superAuth, async (req, res) => {
  const { api_key } = req.body;
  if (!api_key?.startsWith("sk-ant-")) {
    return res.status(400).json({ error: "Clave inválida. Debe empezar por sk-ant-" });
  }
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        key   VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('anthropic_api_key', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
    `, [api_key]);
    // Update runtime env so current process uses it immediately
    process.env.ANTHROPIC_API_KEY = api_key;
    res.json({ ok: true, message: "Clave API de IA guardada correctamente" });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/config/ia-key", superAuth, async (req, res) => {
  try {
    await db.query("DELETE FROM system_config WHERE key='anthropic_api_key'");
    delete process.env.ANTHROPIC_API_KEY;
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


module.exports = router;
