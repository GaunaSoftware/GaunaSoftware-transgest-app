const express  = require("express");
const bcrypt   = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const db       = require("../services/db");
const { authenticate, SOLO_GERENTE } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate, SOLO_GERENTE);

const ROLES_PERMITIDOS = [
  "gerente",
  "contable",
  "trafico",
  "administrativo",
  "responsable_taller",
  "visualizador",
  "chofer",
  "cliente",
];

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id;
}

function normalizarPermisos(permisos) {
  return permisos && typeof permisos === "object" && !Array.isArray(permisos)
    ? permisos
    : {};
}

const TIPOS_VIAJE_TRAFFIC = new Set(["normal", "salida", "retorno"]);

function normalizarTraficoConfig(config = {}) {
  const raw = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const vehiculoIds = Array.isArray(raw.vehiculo_ids)
    ? [...new Set(raw.vehiculo_ids.map(v => String(v || "").trim()).filter(Boolean))]
    : [];
  const tipos = Array.isArray(raw.tipos_viaje)
    ? [...new Set(raw.tipos_viaje.map(v => String(v || "").trim().toLowerCase()).filter(v => TIPOS_VIAJE_TRAFFIC.has(v)))]
    : [];
  return {
    vehiculo_ids: vehiculoIds,
    tipos_viaje: tipos.length ? tipos : ["normal", "salida", "retorno"],
  };
}

async function assertClienteEmpresa(clienteId, eid) {
  if (!clienteId) return null;
  const { rows } = await db.query(
    "SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 AND activo=true",
    [clienteId, eid]
  );
  return rows[0] || null;
}

async function assertChoferEmpresa(choferId, eid) {
  if (!choferId) return null;
  const { rows } = await db.query(
    "SELECT id FROM choferes WHERE id=$1 AND empresa_id=$2 AND activo IS DISTINCT FROM false",
    [choferId, eid]
  );
  return rows[0] || null;
}

async function normalizarClienteUsuario(clienteId, rol, eid) {
  if (!clienteId) return null;
  if (rol !== "cliente") {
    throw Object.assign(new Error("Solo usuarios de cliente pueden vincularse a cliente"), { status: 400 });
  }
  if (!(await assertClienteEmpresa(clienteId, eid))) {
    throw Object.assign(new Error("Cliente no encontrado en esta empresa"), { status: 404 });
  }
  return clienteId;
}

async function normalizarChoferUsuario(choferId, rol, eid) {
  if (!choferId) return null;
  if (rol !== "chofer") {
    throw Object.assign(new Error("Solo usuarios de rol chofer pueden vincularse a una ficha de chofer"), { status: 400 });
  }
  if (!(await assertChoferEmpresa(choferId, eid))) {
    throw Object.assign(new Error("Chofer no encontrado en esta empresa"), { status: 404 });
  }
  return choferId;
}

async function ensureUsuariosChoferSchema() {
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trafico_config JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_chofer ON usuarios(empresa_id, chofer_id)").catch(() => {});
}

async function assertVehiculosEmpresa(vehiculoIds, eid) {
  if (!vehiculoIds.length) return [];
  const { rows } = await db.query(
    "SELECT id FROM vehiculos WHERE empresa_id=$1 AND id = ANY($2::uuid[])",
    [eid, vehiculoIds]
  );
  const valid = new Set(rows.map(r => String(r.id)));
  return vehiculoIds.filter(id => valid.has(String(id)));
}

router.get("/", async (req, res) => {
  await ensureUsuariosChoferSchema();
  const { rows } = await db.query(
    `SELECT u.id,u.nombre,u.email,u.username,u.perfil,u.permisos,u.trafico_config,u.rol,u.cliente_id,u.chofer_id,u.activo,u.ultimo_acceso,u.created_at,
            ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos, v.matricula AS vehiculo_matricula
     FROM usuarios u
     LEFT JOIN choferes ch ON ch.id=u.chofer_id AND ch.empresa_id=u.empresa_id
     LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id AND v.empresa_id=ch.empresa_id
     WHERE u.empresa_id=$1
     ORDER BY nombre`,
    [empresaId(req)]
  );
  res.json(rows);
});

router.post("/",
  body("nombre").isString().trim().isLength({ min: 2 }).withMessage("Nombre obligatorio"),
  body("username").isString().trim().isLength({ min: 3 }).withMessage("Usuario minimo 3 caracteres"),
  body("email").optional({ nullable: true, checkFalsy: true }).isEmail().normalizeEmail(),
  body("password").isLength({ min: 8 }).withMessage("Minimo 8 caracteres"),
  body("rol").isIn(ROLES_PERMITIDOS),
  async (req, res) => {
    await ensureUsuariosChoferSchema();
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nombre, email, username, password, rol, perfil, permisos, cliente_id, chofer_id } = req.body;
    const eid = empresaId(req);
    const hash = await bcrypt.hash(password, 12);
    const traficoConfig = normalizarTraficoConfig(req.body.trafico_config);
    traficoConfig.vehiculo_ids = await assertVehiculosEmpresa(traficoConfig.vehiculo_ids, eid);
    let clienteUsuario;
    try {
      clienteUsuario = await normalizarClienteUsuario(cliente_id || null, rol, eid);
      var choferUsuario = await normalizarChoferUsuario(chofer_id || null, rol, eid);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }

    try {
      const { rows } = await db.query(
        `INSERT INTO usuarios (nombre,email,username,password_hash,rol,empresa_id,perfil,permisos,trafico_config,cliente_id,chofer_id,debe_cambiar_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         RETURNING id,nombre,email,username,perfil,permisos,trafico_config,rol,cliente_id,chofer_id,activo`,
        [
          nombre.trim(),
          email || null,
          username.trim().toLowerCase(),
          hash,
          rol,
          eid,
          perfil || null,
          normalizarPermisos(permisos),
          traficoConfig,
          clienteUsuario,
          choferUsuario,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === "23505") {
        return res.status(409).json({ error: "Ya existe un usuario o email en esta empresa" });
      }
      throw e;
    }
  }
);

router.patch("/:id", async (req, res) => {
  await ensureUsuariosChoferSchema();
  const { nombre, rol, activo, username, email, perfil, permisos, cliente_id, chofer_id } = req.body;
  const eid = empresaId(req);
  if (rol !== undefined && !ROLES_PERMITIDOS.includes(rol)) {
    return res.status(400).json({ error: "Rol no valido" });
  }
  if (String(req.params.id) === String(req.user?.id) && activo === false) {
    return res.status(400).json({ error: "No puedes desactivar tu propio usuario" });
  }

  const current = await db.query(
    "SELECT id,email,username,perfil,permisos,trafico_config,cliente_id,chofer_id,rol FROM usuarios WHERE id=$1 AND empresa_id=$2",
    [req.params.id, eid]
  );
  if (!current.rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });

  const nextEmail = email === undefined ? current.rows[0].email : (email || null);
  const nextUsername = username === undefined
    ? current.rows[0].username
    : (username ? username.trim().toLowerCase() : current.rows[0].username);
  const nextPerfil = perfil === undefined ? current.rows[0].perfil : (perfil || null);
  const nextPermisos = permisos === undefined ? current.rows[0].permisos : normalizarPermisos(permisos);
  const nextTraficoConfig = req.body.trafico_config === undefined
    ? normalizarTraficoConfig(current.rows[0].trafico_config)
    : normalizarTraficoConfig(req.body.trafico_config);
  nextTraficoConfig.vehiculo_ids = await assertVehiculosEmpresa(nextTraficoConfig.vehiculo_ids, eid);
  const nextRol = rol || current.rows[0].rol;
  let nextClienteId = cliente_id === undefined ? current.rows[0].cliente_id : (cliente_id || null);
  let nextChoferId = chofer_id === undefined ? current.rows[0].chofer_id : (chofer_id || null);
  try {
    nextClienteId = await normalizarClienteUsuario(nextClienteId, nextRol, eid);
    nextChoferId = await normalizarChoferUsuario(nextChoferId, nextRol, eid);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  try {
    const { rows } = await db.query(
      `UPDATE usuarios SET
         nombre=COALESCE($1,nombre),
         rol=COALESCE($2,rol),
         activo=COALESCE($3,activo),
         username=$4,
         email=$5,
         perfil=$6,
         permisos=$7,
         trafico_config=$8,
         cliente_id=$9,
         chofer_id=$10
       WHERE id=$11 AND empresa_id=$12
       RETURNING id,nombre,email,username,perfil,permisos,trafico_config,rol,cliente_id,chofer_id,activo`,
      [
        nombre?.trim(),
        rol,
        activo,
        nextUsername,
        nextEmail,
        nextPerfil,
        nextPermisos,
        nextTraficoConfig,
        nextClienteId,
        nextChoferId,
        req.params.id,
        eid,
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Ya existe un usuario o email en esta empresa" });
    }
    throw e;
  }
});

router.post("/:id/reset-password",
  body("password_nuevo").isLength({ min: 8 }).withMessage("Minimo 8 caracteres"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const hash = await bcrypt.hash(req.body.password_nuevo, 12);
    const { rowCount } = await db.query(
      "UPDATE usuarios SET password_hash=$1, debe_cambiar_password=true WHERE id=$2 AND empresa_id=$3",
      [hash, req.params.id, empresaId(req)]
    );
    if (!rowCount) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ ok: true });
  }
);

module.exports = router;
