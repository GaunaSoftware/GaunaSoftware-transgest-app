const jwt    = require("jsonwebtoken");
const db     = require("../services/db");
const logger = require("../services/logger");

// ── Días de gracia tras vencimiento ──────────────────
const DIAS_GRACIA = 7;

function calcularEstadoSuscripcion(empresa) {
  if (!empresa) return { bloqueado: true, motivo: "suspendido" };

  if (empresa.estado === "cancelado") {
    return { bloqueado: true, motivo: "cancelado" };
  }
  if (empresa.estado === "suspendido") {
    return { bloqueado: true, motivo: "suspendido" };
  }

  if (empresa.fecha_vencimiento) {
    const vencimiento  = new Date(empresa.fecha_vencimiento);
    const ahora        = new Date();
    const diffMs       = vencimiento - ahora;
    const diffDias     = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDias < -DIAS_GRACIA) {
      // Más de 7 días vencido — bloqueo total
      return { bloqueado: true, motivo: "vencido", dias_vencido: Math.abs(diffDias) };
    }
    if (diffDias < 0) {
      // Dentro del periodo de gracia — acceso pero con aviso
      return { bloqueado: false, aviso: true, motivo: "gracia", dias_restantes: diffDias, dias_gracia_restantes: DIAS_GRACIA + diffDias };
    }
    if (diffDias <= 15) {
      // Próximo a vencer — aviso
      return { bloqueado: false, aviso: true, motivo: "proximo", dias_restantes: diffDias };
    }
  }

  return { bloqueado: false };
}

// ── Verificar JWT + estado empresa ───────────────────
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token de acceso requerido" });
  }

  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await db.query(
      "SELECT id, nombre, email, rol, activo, empresa_id FROM usuarios WHERE id = $1",
      [payload.sub]
    );

    if (!rows[0] || !rows[0].activo) {
      return res.status(401).json({ error: "Usuario no válido o desactivado" });
    }

    req.user = rows[0];
    req.empresaId = rows[0].empresa_id;

    // ── Comprobar suscripción de la empresa ──────────
    // Superadmins y rutas de mi-cuenta/registro/superadmin se saltan el check
    const rutaLibre = req.path?.startsWith("/mi-cuenta") ||
                      req.originalUrl?.includes("/mi-cuenta") ||
                      req.originalUrl?.includes("/superadmin") ||
                      req.originalUrl?.includes("/registro");

    if (req.user.empresa_id && !rutaLibre) {
      const { rows: empRows } = await db.query(
        "SELECT estado, fecha_vencimiento, plan, nombre FROM empresas WHERE id = $1",
        [req.user.empresa_id]
      );
      const empresa = empRows[0];
      const suscripcion = calcularEstadoSuscripcion(empresa);

      if (suscripcion.bloqueado) {
        logger.warn(`Acceso bloqueado: ${req.user.email} — empresa ${empresa?.nombre} (${suscripcion.motivo})`);
        return res.status(402).json({
          error: "suscripcion_bloqueada",
          motivo: suscripcion.motivo,
          mensaje: suscripcion.motivo === "vencido"
            ? `Tu suscripción venció hace ${suscripcion.dias_vencido} días. Renueva para continuar usando TransGest.`
            : suscripcion.motivo === "cancelado"
            ? "Tu cuenta ha sido cancelada. Contacta con soporte para reactivarla."
            : "Tu cuenta está suspendida. Contacta con soporte.",
        });
      }

      // Adjuntar info de suscripción para que el frontend pueda mostrar avisos
      req.suscripcion = suscripcion;
    }

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Sesión expirada. Inicia sesión de nuevo." });
    }
    return res.status(401).json({ error: "Token inválido" });
  }
}

// ── Login: también devuelve info de suscripción ───────
// (se usa en auth.js para incluirlo en la respuesta del login)
async function getEmpresaSuscripcion(empresa_id) {
  if (!empresa_id) return null;
  const { rows } = await db.query(
    "SELECT estado, fecha_vencimiento, plan, nombre FROM empresas WHERE id = $1",
    [empresa_id]
  );
  return calcularEstadoSuscripcion(rows[0]);
}

// ── Guards de rol ─────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    if (!roles.includes(req.user.rol)) {
      logger.warn(`Acceso denegado: ${req.user.email} (${req.user.rol}) — ruta restringida [${roles.join(",")}]`);
      return res.status(403).json({ error: `Acceso denegado. Se requiere rol: ${roles.join(" o ")}` });
    }
    next();
  };
}

const PUEDE_CAMBIAR_ESTADO_FACTURA = requireRole("gerente", "contable");
const CHOFER_O_TRAFICO             = requireRole("gerente", "trafico", "chofer");
const ES_CHOFER                    = requireRole("chofer");
const SOLO_GERENTE                 = requireRole("gerente");
const GERENTE_O_CONTABLE           = requireRole("gerente", "contable");
const GERENTE_O_TRAFICO            = requireRole("gerente", "trafico");

module.exports = {
  authenticate,
  requireRole,
  getEmpresaSuscripcion,
  calcularEstadoSuscripcion,
  PUEDE_CAMBIAR_ESTADO_FACTURA,
  SOLO_GERENTE,
  GERENTE_O_CONTABLE,
  GERENTE_O_TRAFICO,
  CHOFER_O_TRAFICO,
  ES_CHOFER,
};
