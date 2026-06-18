const express = require("express");
const db = require("../services/db");
const { SOLO_GERENTE } = require("../middleware/auth");

const router = express.Router();
router.use(SOLO_GERENTE);

function parseLimit(value) {
  const n = Number(value || 100);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(Math.trunc(n), 1), 300);
}

function moduloFromAccion(accion = "") {
  const path = String(accion).split(" ").slice(1).join(" ");
  const parts = path.split("/").filter(Boolean);
  const idx = parts.indexOf("v1");
  return (idx >= 0 ? parts[idx + 1] : parts[2]) || "sistema";
}

function splitAccion(accion = "") {
  const raw = String(accion || "");
  const [method = "ACCION", ...rest] = raw.split(" ");
  const path = rest.join(" ").trim();
  return { method, path };
}

function criticidad(row) {
  const { method, path } = splitAccion(row.accion);
  const status = Number(row.detalle?.status || 0);
  if (status >= 500) return "critica";
  if (status >= 400) return "alta";
  if (method === "DELETE") return "alta";
  if (["POST", "PUT", "PATCH"].includes(method)) {
    if (/\/(superadmin|usuarios|empresa|facturas|fiscal|backup|api-keys|gps)/i.test(path)) return "alta";
    return "media";
  }
  return "baja";
}

function enrichAuditRow(row) {
  const { method, path } = splitAccion(row.accion);
  const status = Number(row.detalle?.status || 0) || null;
  return {
    ...row,
    method,
    path,
    modulo: moduloFromAccion(row.accion),
    status,
    criticidad: criticidad(row),
    request_id: row.detalle?.request_id || null,
  };
}

router.get("/", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });

  const { accion = "", actor = "", desde = "", hasta = "", modulo = "", metodo = "", status = "", criticidad: criticidadFiltro = "" } = req.query;
  const params = [empresaId];
  const where = [
    "empresa_id=$1",
    "accion NOT ILIKE 'LOGIN %'",
    "accion NOT ILIKE 'GET %'",
    "accion NOT ILIKE 'HEAD %'",
    "accion NOT ILIKE 'OPTIONS %'",
    "accion NOT ILIKE '%/api/v1/auth/login%'",
    "accion NOT ILIKE '%/api/v1/auth/me%'",
    "accion NOT ILIKE '%/api/v1/actividad%'",
  ];

  if (accion) {
    params.push(`%${String(accion).trim()}%`);
    where.push(`accion ILIKE $${params.length}`);
  }
  if (actor) {
    params.push(`%${String(actor).trim()}%`);
    where.push(`COALESCE(actor_email,'') ILIKE $${params.length}`);
  }
  if (modulo) {
    params.push(`%/api/v1/${String(modulo).trim()}%`);
    where.push(`accion ILIKE $${params.length}`);
  }
  if (metodo) {
    params.push(`${String(metodo).trim().toUpperCase()} %`);
    where.push(`accion ILIKE $${params.length}`);
  }
  if (status) {
    if (status === "error") {
      where.push(`COALESCE((detalle->>'status')::int, 0) >= 400`);
    } else if (status === "ok") {
      where.push(`COALESCE((detalle->>'status')::int, 0) BETWEEN 200 AND 399`);
    } else if (/^\d{3}$/.test(String(status))) {
      params.push(Number(status));
      where.push(`COALESCE((detalle->>'status')::int, 0) = $${params.length}`);
    }
  }
  if (desde) {
    params.push(String(desde));
    where.push(`created_at::date >= $${params.length}::date`);
  }
  if (hasta) {
    params.push(String(hasta));
    where.push(`created_at::date <= $${params.length}::date`);
  }

  const limit = parseLimit(req.query.limit);
  const queryLimit = criticidadFiltro ? Math.min(limit * 5, 1000) : limit;
  params.push(queryLimit);

  const { rows } = await db.query(
    `SELECT id, actor_tipo, actor_email, accion, detalle, ip, created_at
       FROM audit_log_saas
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );

  const enriched = rows.map(enrichAuditRow)
    .filter(row => !criticidadFiltro || row.criticidad === criticidadFiltro)
    .slice(0, limit);

  const resumen = enriched.reduce((acc, row) => {
    const key = row.method || "accion";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const porModulo = enriched.reduce((acc, row) => {
    const key = row.modulo || "sistema";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const porCriticidad = enriched.reduce((acc, row) => {
    acc[row.criticidad] = (acc[row.criticidad] || 0) + 1;
    return acc;
  }, {});
  const errores = enriched.filter(row => Number(row.status || 0) >= 400).length;
  const usuarios = Array.from(new Set(enriched.map(row => row.actor_email).filter(Boolean))).length;

  res.json({
    data: enriched,
    resumen,
    porModulo,
    porCriticidad,
    totales: {
      registros: enriched.length,
      errores,
      usuarios,
      altas: Number(porCriticidad.alta || 0) + Number(porCriticidad.critica || 0),
    },
  });
});

module.exports = router;
