const { assertStrongPassword } = require("../services/passwordPolicy");
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../services/db");
const logger = require("../services/logger");
const { priceFor } = require("../services/commercialPricing");
const {
  assertPasswordNotReused,
  rememberPasswordHash,
} = require("../services/passwordPolicy");

const router = express.Router();
const EDIT_DATA_ROLES = new Set(["gerente", "administrativo"]);

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id || null;
}

function canEditData(req) {
  return EDIT_DATA_ROLES.has(String(req.user?.rol || "").toLowerCase());
}

function cleanText(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

async function safeOne(sql, params, fallback = {}) {
  try {
    const { rows } = await db.query(sql, params);
    return rows[0] || fallback;
  } catch (err) {
    logger.warn(`[MiCuenta] consulta opcional fallida: ${err.message}`);
    return fallback;
  }
}

async function safeRows(sql, params) {
  try {
    const { rows } = await db.query(sql, params);
    return rows || [];
  } catch (err) {
    if (err.code !== "42P01" && err.code !== "42703") {
      logger.warn(`[MiCuenta] listado opcional fallido: ${err.message}`);
    }
    return [];
  }
}

const { ensureSupportSchema } = require('../services/supportSchema');

router.get("/", async (req, res) => {
  const empId = empresaId(req);
  if (!empId) return res.status(400).json({ error: "Usuario sin empresa asociada" });

  try {
    const empresa = await safeOne(
      `SELECT id, nombre, cif, email_admin, plan, estado, fecha_vencimiento,
              max_vehiculos, max_usuarios, ciclo_facturacion, metodo_pago, origen_comercial
         FROM empresas
        WHERE id=$1`,
      [empId],
      null
    );
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

    const [vehiculos, usuarios, pedidosMes] = await Promise.all([
      safeOne("SELECT COUNT(*)::int AS total FROM vehiculos WHERE empresa_id=$1", [empId], { total: 0 }),
      safeOne("SELECT COUNT(*)::int AS total FROM usuarios WHERE empresa_id=$1 AND COALESCE(activo,true)=true", [empId], { total: 0 }),
      safeOne("SELECT COUNT(*)::int AS total FROM pedidos WHERE empresa_id=$1 AND created_at >= NOW() - INTERVAL '30 days'", [empId], { total: 0 }),
    ]);

    res.json({
      id: empresa.id,
      nombre: empresa.nombre || "",
      cif: empresa.cif || "",
      email_admin: empresa.email_admin || req.user?.email || "",
      plan: empresa.plan || "profesional",
      estado: empresa.estado || "activo",
      fecha_vencimiento: empresa.fecha_vencimiento || null,
      ciclo_facturacion: empresa.ciclo_facturacion || "mensual",
      origen_comercial: empresa.origen_comercial || null,
      tarifa_catalogo_eur: empresa.origen_comercial ? priceFor(empresa.plan, empresa.ciclo_facturacion || "mensual", empresa.origen_comercial) : null,
      metodo_pago: empresa.metodo_pago || "pendiente",
      limites: {
        vehiculos: Number(empresa.max_vehiculos || 0) || null,
        usuarios: Number(empresa.max_usuarios || 0) || null,
      },
      uso: {
        vehiculos: Number(vehiculos.total || 0),
        usuarios: Number(usuarios.total || 0),
        pedidos_mes: Number(pedidosMes.total || 0),
      },
    });
  } catch (err) {
    logger.error(`[MiCuenta] GET /: ${err.message}`);
    res.status(500).json({ error: "No se pudo cargar la cuenta" });
  }
});

router.get("/facturas", async (req, res) => {
  const empId = empresaId(req);
  if (!empId) return res.status(400).json({ error: "Usuario sin empresa asociada" });

  const rows = await safeRows(
    `SELECT id, numero, concepto, plan, periodo_desde, periodo_hasta,
            importe, estado, fecha_emision, fecha_vencimiento, fecha_pago, notas
       FROM facturas_suscripcion
      WHERE empresa_id=$1
      ORDER BY fecha_emision DESC, created_at DESC
      LIMIT 100`,
    [empId]
  );
  res.json(rows);
});

router.patch("/datos", async (req, res) => {
  const empId = empresaId(req);
  if (!empId) return res.status(400).json({ error: "Usuario sin empresa asociada" });
  if (!canEditData(req)) return res.status(403).json({ error: "Solo gerencia o administracion puede modificar los datos de la empresa" });

  const nombre = cleanText(req.body?.nombre, 180);
  const cif = cleanText(req.body?.cif, 40).toUpperCase();
  if (!nombre) return res.status(400).json({ error: "Indica el nombre o razon social" });

  try {
    const { rows } = await db.query(
      `UPDATE empresas
          SET nombre=$2, cif=$3
        WHERE id=$1
        RETURNING id, nombre, cif, email_admin, plan, estado, fecha_vencimiento`,
      [empId, nombre, cif || null]
    );
    if (!rows[0]) return res.status(404).json({ error: "Empresa no encontrada" });
    res.json({ ok: true, ...rows[0] });
  } catch (err) {
    logger.error(`[MiCuenta] PATCH /datos: ${err.message}`);
    res.status(500).json({ error: "No se pudieron guardar los datos" });
  }
});

router.post("/cambiar-password", async (req, res) => {
  const passwordActual = String(req.body?.password_actual || "");
  const passwordNuevo = String(req.body?.password_nuevo || "");
  if (!passwordActual) return res.status(400).json({error:"Indica la contraseña actual"});
  try { assertStrongPassword(passwordNuevo); } catch(error) { return res.status(400).json({error:error.message}); }

  try {
    const { rows } = await db.query(
      "SELECT id, empresa_id, password_hash FROM usuarios WHERE id=$1",
      [req.user.id]
    );
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

    const valid = await bcrypt.compare(passwordActual, usuario.password_hash || "");
    if (!valid) return res.status(400).json({ error: "Contrasena actual incorrecta" });

    await assertPasswordNotReused({
      usuarioId: usuario.id,
      empresaId: usuario.empresa_id,
      passwordNuevo,
      currentHash: usuario.password_hash,
    });

    const hash = await bcrypt.hash(passwordNuevo, 12);
    await db.transaction(async (client) => {
      await rememberPasswordHash({
        usuarioId: usuario.id,
        empresaId: usuario.empresa_id,
        passwordHash: usuario.password_hash,
        queryClient: client,
      });
      await client.query(
        "UPDATE usuarios SET password_hash=$1, debe_cambiar_password=false, password_changed_at=NOW(), login_failed_count=0, login_locked_until=NULL WHERE id=$2",
        [hash, usuario.id]
      );
    });

    logger.info(`[MiCuenta] contrasena cambiada por ${req.user.email || req.user.username}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`[MiCuenta] POST /cambiar-password: ${err.message}`);
    res.status(err.status || 500).json({ error: err.status ? err.message : "No se pudo cambiar la contrasena" });
  }
});

router.post("/soporte", async (req, res) => {
  const empId = empresaId(req);
  if (!empId) return res.status(400).json({ error: "Usuario sin empresa asociada" });

  const mensaje = cleanText(req.body?.mensaje, 4000);
  if (!mensaje) return res.status(400).json({ error: "Escribe el mensaje para soporte" });

  try {
    await ensureSupportSchema();
    const id = require('crypto').randomUUID();
    await db.transaction(async client => {
      await client.query('INSERT INTO soporte_solicitudes(id,empresa_id,usuario_id,asunto) VALUES($1,$2,$3,$4)',
        [id,empId,req.user.id,'Consulta desde Mi cuenta']);
      await client.query(`INSERT INTO soporte_mensajes(id,solicitud_id,autor_id,autor_nombre,desde_soporte,mensaje)
        VALUES($1,$2,$3,$4,false,$5)`,[require('crypto').randomUUID(),id,String(req.user.id),req.user.nombre || 'Usuario',mensaje]);
    });
    res.status(201).json({ ok: true, id, estado: 'abierta' });
  } catch (err) {
    logger.error(`[MiCuenta] POST /soporte: ${err.message}`);
    res.status(500).json({ error: "No se pudo enviar el mensaje a soporte" });
  }
});

module.exports = router;
