const express  = require("express");
const bcrypt   = require("bcryptjs");
const crypto   = require("crypto");
const { body, validationResult } = require("express-validator");
const db       = require("../services/db");
const { enviarEmail } = require("../services/email");
const { authenticate, SOLO_GERENTE } = require("../middleware/auth");
const { ensurePasswordPolicySchema, assertPasswordNotReused, rememberPasswordHash } = require("../services/passwordPolicy");

const router = express.Router();

router.use(authenticate, SOLO_GERENTE);

const ROLES_PERMITIDOS = [
  "gerente",
  "contable",
  "trafico",
  "administrativo",
  "responsable_taller",
  "mecanico",
  "colaborador",
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

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function appUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function generarPasswordTemporal() {
  return `${crypto.randomBytes(12).toString("base64url")}A1!`;
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
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT false").catch(() => {});
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ").catch(() => {});
  await ensurePasswordPolicySchema(db).catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS invitaciones_usuario (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
      usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
      email VARCHAR(200),
      token_hash VARCHAR(200) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      usado_at TIMESTAMPTZ,
      created_by VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.query("ALTER TABLE invitaciones_usuario ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE").catch(() => {});
  await db.query("ALTER TABLE invitaciones_usuario ADD COLUMN IF NOT EXISTS email VARCHAR(200)").catch(() => {});
  await db.query("ALTER TABLE invitaciones_usuario ADD COLUMN IF NOT EXISTS created_by VARCHAR(200)").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_chofer ON usuarios(empresa_id, chofer_id)").catch(() => {});
}

async function crearInvitacionUsuario({ usuario, empresa, actorEmail }) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO invitaciones_usuario (empresa_id, usuario_id, email, token_hash, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [empresa.id, usuario.id, usuario.email, hashToken(token), expiresAt, actorEmail || null]
  );
  return { token, expiresAt, url: `${appUrl()}/invitacion/${token}` };
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
            u.debe_cambiar_password,u.password_changed_at,
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
  body("modo_alta").optional().isIn(["invitacion", "temporal"]),
  body("password").optional({ nullable: true, checkFalsy: true }).isLength({ min: 8 }).withMessage("Minimo 8 caracteres"),
  body("rol").isIn(ROLES_PERMITIDOS),
  async (req, res) => {
    await ensureUsuariosChoferSchema();
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nombre, email, username, rol, perfil, permisos, cliente_id, chofer_id } = req.body;
    const eid = empresaId(req);
    const modoAlta = String(req.body.modo_alta || (email ? "invitacion" : "temporal")).toLowerCase();
    if (modoAlta === "invitacion" && !email) {
      return res.status(400).json({ error: "El email es obligatorio para enviar invitacion" });
    }
    const passwordTemporal = modoAlta === "temporal"
      ? String(req.body.password || generarPasswordTemporal())
      : generarPasswordTemporal();
    const hash = await bcrypt.hash(passwordTemporal, 12);
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
        `INSERT INTO usuarios (nombre,email,username,password_hash,rol,empresa_id,perfil,permisos,trafico_config,cliente_id,chofer_id,activo,debe_cambiar_password,password_changed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL)
         RETURNING id,nombre,email,username,perfil,permisos,trafico_config,rol,cliente_id,chofer_id,activo,debe_cambiar_password`,
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
          modoAlta === "invitacion" ? false : true,
          modoAlta === "temporal",
        ]
      );
      const usuario = rows[0];
      if (modoAlta === "invitacion") {
        const empresa = await db.query("SELECT id,nombre FROM empresas WHERE id=$1 LIMIT 1", [eid]).then(r => r.rows[0] || { id: eid, nombre: "" });
        const invitacion = await crearInvitacionUsuario({ usuario, empresa, actorEmail: req.user?.email || req.user?.username || "" });
        const mail = await enviarEmail({
          trigger: "invitacion_usuario",
          destinatario: usuario.email,
          plantilla: "invitacion_usuario",
          empresa_id: eid,
          datos: { nombre: usuario.nombre, empresa: empresa.nombre, url: invitacion.url },
          meta: { usuario_id: usuario.id, modo_alta: "invitacion" },
        }).catch(e => ({ error: e.message }));
        return res.status(201).json({
          ...usuario,
          invitacion_enviada: !mail?.simulado && !mail?.error,
          invitacion_simulada: !!mail?.simulado,
          invitacion_error: mail?.error || "",
          invitacion_url: invitacion.url,
          invitacion_expira: invitacion.expiresAt,
        });
      }
      res.status(201).json({ ...usuario, password_temporal: req.body.password ? null : passwordTemporal });
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
       RETURNING id,nombre,email,username,perfil,permisos,trafico_config,rol,cliente_id,chofer_id,activo,debe_cambiar_password`,
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

    const current = await db.query(
      "SELECT id, empresa_id, password_hash FROM usuarios WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId(req)]
    );
    if (!current.rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });
    await assertPasswordNotReused({
      usuarioId: current.rows[0].id,
      empresaId: current.rows[0].empresa_id,
      passwordNuevo: req.body.password_nuevo,
      currentHash: current.rows[0].password_hash,
    });
    const hash = await bcrypt.hash(req.body.password_nuevo, 12);
    let updated = 0;
    await db.transaction(async (client) => {
      await rememberPasswordHash({
        usuarioId: current.rows[0].id,
        empresaId: current.rows[0].empresa_id,
        passwordHash: current.rows[0].password_hash,
        queryClient: client,
      });
      const result = await client.query(
        "UPDATE usuarios SET password_hash=$1, debe_cambiar_password=true, password_changed_at=NULL WHERE id=$2 AND empresa_id=$3",
        [hash, req.params.id, empresaId(req)]
      );
      updated = result.rowCount;
    });
    if (!updated) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ ok: true });
  }
);

module.exports = router;
