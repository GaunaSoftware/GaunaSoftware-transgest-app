const express = require("express");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const db = require("../services/db");
const logger = require("../services/logger");
const { assertPasswordNotReused, rememberPasswordHash } = require("../services/passwordPolicy");

const router = express.Router();

let miCuentaSchemaReady = false;
async function ensureMiCuentaSchema() {
  if (miCuentaSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS soporte_mensajes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
      usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      email VARCHAR(200),
      mensaje TEXT NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      ip VARCHAR(80),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch((e) => logger.error("ensureMiCuentaSchema soporte: " + e.message));
  await db.query(`
    CREATE TABLE IF NOT EXISTS facturas_saas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      numero VARCHAR(60),
      concepto TEXT,
      periodo_desde DATE,
      periodo_hasta DATE,
      importe NUMERIC(12,2) NOT NULL DEFAULT 0,
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      fecha_vencimiento DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch((e) => logger.error("ensureMiCuentaSchema facturas_saas: " + e.message));
  await db.query("CREATE INDEX IF NOT EXISTS idx_facturas_saas_empresa ON facturas_saas(empresa_id, created_at DESC)").catch(() => {});
  miCuentaSchemaReady = true;
}

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id || null;
}

// ── GET / ── Resumen de cuenta: plan, estado, vencimiento y uso real ──
router.get("/", async (req, res) => {
  try {
    const eid = empresaId(req);
    if (!eid) return res.status(403).json({ error: "Usuario sin empresa asignada" });

    const { rows } = await db.query(
      `SELECT id, nombre, cif, plan, estado, fecha_vencimiento, ciclo_facturacion, metodo_pago
         FROM empresas WHERE id=$1 LIMIT 1`,
      [eid]
    );
    const empresa = rows[0];
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

    const [veh, usu, ped] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS n FROM vehiculos WHERE empresa_id=$1 AND COALESCE(activo,true)=true", [eid]).catch(() => ({ rows: [{ n: 0 }] })),
      db.query("SELECT COUNT(*)::int AS n FROM usuarios WHERE empresa_id=$1 AND activo IS DISTINCT FROM false", [eid]).catch(() => ({ rows: [{ n: 0 }] })),
      db.query("SELECT COUNT(*)::int AS n FROM pedidos WHERE empresa_id=$1 AND created_at >= NOW() - INTERVAL '30 days'", [eid]).catch(() => ({ rows: [{ n: 0 }] })),
    ]);

    res.json({
      ...empresa,
      suscripcion: req.suscripcion || null,
      uso: {
        vehiculos: veh.rows[0]?.n || 0,
        usuarios: usu.rows[0]?.n || 0,
        pedidos_mes: ped.rows[0]?.n || 0,
      },
    });
  } catch (err) {
    logger.error("mi-cuenta GET /: " + err.message);
    res.status(500).json({ error: "No se pudo cargar la información de la cuenta" });
  }
});

// ── GET /facturas ── Facturas de suscripción SaaS (vacío si aún no hay) ──
router.get("/facturas", async (req, res) => {
  try {
    const eid = empresaId(req);
    if (!eid) return res.json([]);
    await ensureMiCuentaSchema();
    const { rows } = await db.query(
      `SELECT id, numero, concepto, periodo_desde, periodo_hasta, importe, estado, fecha_vencimiento
         FROM facturas_saas
        WHERE empresa_id=$1
        ORDER BY created_at DESC
        LIMIT 100`,
      [eid]
    );
    res.json(rows);
  } catch (err) {
    logger.error("mi-cuenta GET /facturas: " + err.message);
    res.json([]);
  }
});

// ── PATCH /datos ── Actualizar razón social / CIF (solo gerencia) ──
router.patch("/datos",
  body("nombre").optional().isString().trim().isLength({ max: 200 }),
  body("cif").optional().isString().trim().isLength({ max: 60 }),
  async (req, res) => {
    try {
      if (req.user?.rol !== "gerente") {
        return res.status(403).json({ error: "Solo gerencia puede editar los datos de la empresa." });
      }
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const eid = empresaId(req);
      if (!eid) return res.status(403).json({ error: "Usuario sin empresa asignada" });

      const updates = [];
      const params = [eid];
      let i = 2;
      if (typeof req.body?.nombre === "string" && req.body.nombre.trim()) {
        updates.push(`nombre=$${i++}`); params.push(req.body.nombre.trim());
      }
      if ("cif" in (req.body || {})) {
        updates.push(`cif=$${i++}`); params.push(String(req.body.cif || "").trim() || null);
      }
      if (!updates.length) return res.status(400).json({ error: "Nada que actualizar" });

      await db.query(`UPDATE empresas SET ${updates.join(",")} WHERE id=$1`, params);
      res.json({ ok: true });
    } catch (err) {
      logger.error("mi-cuenta PATCH /datos: " + err.message);
      res.status(500).json({ error: "No se pudieron guardar los datos" });
    }
  }
);

// ── POST /cambiar-password ── Cambio de contraseña del propio usuario ──
router.post("/cambiar-password",
  body("password_actual").notEmpty(),
  body("password_nuevo").isLength({ min: 8 }).withMessage("Mínimo 8 caracteres"),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { password_actual, password_nuevo } = req.body;
      const { rows } = await db.query(
        "SELECT id, empresa_id, password_hash FROM usuarios WHERE id=$1",
        [req.user.id]
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

      const valid = await bcrypt.compare(password_actual, user.password_hash);
      if (!valid) return res.status(400).json({ error: "Contraseña actual incorrecta" });

      await assertPasswordNotReused({
        usuarioId: user.id,
        empresaId: user.empresa_id,
        passwordNuevo: password_nuevo,
        currentHash: user.password_hash,
      });

      const hash = await bcrypt.hash(password_nuevo, 12);
      await db.transaction(async (client) => {
        await rememberPasswordHash({
          usuarioId: user.id,
          empresaId: user.empresa_id,
          passwordHash: user.password_hash,
          queryClient: client,
        });
        await client.query(
          "UPDATE usuarios SET password_hash=$1, debe_cambiar_password=false, password_changed_at=NOW() WHERE id=$2",
          [hash, user.id]
        );
      });

      logger.info(`Contraseña cambiada (mi-cuenta): ${req.user.email || req.user.username}`);
      res.json({ ok: true });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) logger.error("mi-cuenta POST /cambiar-password: " + err.message);
      res.status(status).json({ error: status < 500 ? err.message : "No se pudo cambiar la contraseña" });
    }
  }
);

// ── POST /soporte ── Mensaje de soporte del cliente ──
router.post("/soporte",
  body("mensaje").isString().trim().isLength({ min: 1, max: 5000 }),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      await ensureMiCuentaSchema();
      await db.query(
        `INSERT INTO soporte_mensajes (empresa_id, usuario_id, email, mensaje, ip)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          empresaId(req),
          req.user?.id || null,
          req.user?.email || req.user?.username || null,
          String(req.body.mensaje).trim(),
          req.ip || null,
        ]
      );
      logger.info(`Mensaje de soporte recibido de ${req.user?.email || req.user?.username || "usuario"} (${empresaId(req)})`);
      res.json({ ok: true });
    } catch (err) {
      logger.error("mi-cuenta POST /soporte: " + err.message);
      res.status(500).json({ error: "No se pudo enviar el mensaje" });
    }
  }
);

module.exports = router;
