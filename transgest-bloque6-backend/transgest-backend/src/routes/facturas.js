const express = require("express");
const { body, param, query, validationResult } = require("express-validator");
const db      = require("../services/db");
const logger  = require("../services/logger");
const { authenticate, GERENTE_O_CONTABLE, SOLO_GERENTE, PUEDE_CAMBIAR_ESTADO_FACTURA } = require("../middleware/auth");
const { enviarEmail } = require("../services/email");
const { ensureFacturaFiscalRecord, getEmpresaFiscalConfig, buildFiscalStatus, sanitizeFiscalConfigForClient } = require("../services/fiscal");
const { processPendingFiscalQueue } = require("../services/fiscalProcessor");
const { getVerifactiRecordStatus } = require("../services/fiscalProviderVerifacti");
const { markQueueAccepted, markQueuePending, markQueueError, logFiscalEvent } = require("../services/fiscalQueueState");
const fiscalScheduler = require("../services/fiscalScheduler");

const router = express.Router();
router.use(authenticate);

function ivaRegimenFromPct(tipoIva, ivaRegimen) {
  const regimen = String(ivaRegimen || "").trim().toLowerCase();
  if (regimen) return regimen;
  const pct = Number(tipoIva);
  if (pct === 0) return "cero";
  if (pct === 10) return "reducido";
  if (pct === 4) return "superreducido";
  return "general";
}

function isFacturaBorradorAgrupable(factura) {
  return factura?.factura_id && factura?.factura_estado === "borrador";
}

const COBROS_DEFAULT_CONFIG = {
  dias_revision_post_vencimiento: 1,
  dias_entre_reclamaciones: 7,
  max_envios_reclamacion: 6,
  dias_hasta_juridico: 45,
  envio_email_auto: true,
};

function clampInt(value, def, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function normalizeCobrosConfig(raw = {}) {
  return {
    dias_revision_post_vencimiento: clampInt(raw.dias_revision_post_vencimiento, COBROS_DEFAULT_CONFIG.dias_revision_post_vencimiento, 0, 30),
    dias_entre_reclamaciones: clampInt(raw.dias_entre_reclamaciones, COBROS_DEFAULT_CONFIG.dias_entre_reclamaciones, 3, 30),
    max_envios_reclamacion: clampInt(raw.max_envios_reclamacion, COBROS_DEFAULT_CONFIG.max_envios_reclamacion, 1, 20),
    dias_hasta_juridico: clampInt(raw.dias_hasta_juridico, COBROS_DEFAULT_CONFIG.dias_hasta_juridico, 7, 180),
    envio_email_auto: raw.envio_email_auto !== false,
  };
}

async function getCobrosConfig(empresaId, client = db) {
  const { rows } = await client.query("SELECT configuracion FROM empresas WHERE id=$1", [empresaId]);
  return normalizeCobrosConfig(rows[0]?.configuracion?.facturacion_cobros || {});
}

function splitEmails(...values) {
  return [...new Set(values
    .flatMap(v => String(v || "").split(/[;,]/))
    .map(v => v.trim())
    .filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.toLowerCase()))
  )];
}

function extractProviderUuid(response = {}) {
  return response?.provider_uuid
    || response?.uuid
    || response?.response?.uuid
    || response?.response?.data?.uuid
    || response?.response?.registro?.uuid
    || null;
}

function pedidoEstadoDesdeFacturaEstado(estadoFactura) {
  return "entregado";
}

async function getFacturaPedidosSinSoporte(facturaId, empresaId, client = db) {
  const { rows } = await client.query(
    `SELECT p.id, p.numero,
            COUNT(pd.id) FILTER (
              WHERE LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                 OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
            )::int AS soportes
       FROM factura_pedidos fp
       JOIN pedidos p ON p.id=fp.pedido_id AND p.empresa_id=$2
       LEFT JOIN pedido_docs pd ON pd.pedido_id=p.id AND pd.empresa_id=p.empresa_id
      WHERE fp.factura_id=$1
      GROUP BY p.id,p.numero
      HAVING COUNT(pd.id) FILTER (
              WHERE LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                 OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
            ) = 0
      ORDER BY p.numero`,
    [facturaId, empresaId]
  );
  return rows;
}

async function getEmpresaPerfil(empresaId, client = db) {
  const { rows } = await client.query("SELECT nombre, cfg_precios FROM empresas WHERE id=$1", [empresaId]);
  const cfgPrecios = rows[0]?.cfg_precios || {};
  const perfil = cfgPrecios?.empresa_perfil && typeof cfgPrecios.empresa_perfil === "object"
    ? cfgPrecios.empresa_perfil
    : cfgPrecios;
  return {
    razon_social: perfil?.razon_social || rows[0]?.nombre || "TransGest",
    iban: perfil?.iban || "",
  };
}

// ── GET /facturas ─────────────────────────────────────
router.get("/", GERENTE_O_CONTABLE, async (req, res) => {
  const { estado, cliente_id, serie, desde, hasta, fiscal_estado, fiscal_modo, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const where  = ["f.empresa_id = $1"]; // tenant isolation
  const params = [req.empresaId||req.user.empresa_id];
  let i = 2;

  if (estado)     { where.push(`f.estado = $${i++}`);      params.push(estado); }
  if (cliente_id) { where.push(`f.cliente_id = $${i++}`);  params.push(cliente_id); }
  if (serie)      { where.push(`f.serie = $${i++}`);        params.push(serie); }
  if (desde)      { where.push(`f.fecha >= $${i++}`);       params.push(desde); }
  if (hasta)      { where.push(`f.fecha <= $${i++}`);       params.push(hasta); }
  if (fiscal_modo) {
    where.push(`COALESCE(ff.modo, 'ninguno') = $${i++}`);
    params.push(fiscal_modo);
  }
  if (fiscal_estado === "sin_registro") {
    where.push("ff.id IS NULL");
  } else if (fiscal_estado) {
    where.push(`ff.estado_envio = $${i++}`);
    params.push(fiscal_estado);
  }

  const sql = `
    SELECT f.*,
           c.nombre  AS cliente_nombre,
           c.cif     AS cliente_cif,
           c.email   AS cliente_email,
           c.email_facturacion AS cliente_email_facturacion,
           COALESCE(fp_count.num_pedidos, 0) AS num_pedidos,
           ff.modo AS fiscal_modo,
           ff.estado_envio AS fiscal_estado_envio,
           ff.ultimo_error AS fiscal_ultimo_error,
           ff.ultimo_envio_at AS fiscal_ultimo_envio_at,
           fq.next_retry_at AS fiscal_next_retry_at,
           fq.estado AS fiscal_queue_estado,
           fq.provider_uuid AS fiscal_provider_uuid,
           fae.accepted_ref AS fiscal_referencia_aceptada
    FROM facturas f
    JOIN clientes c ON c.id = f.cliente_id AND c.empresa_id = f.empresa_id
    LEFT JOIN factura_registros_fiscales ff ON ff.factura_id = f.id
    LEFT JOIN LATERAL (
      SELECT
        q.estado,
        q.next_retry_at,
        COALESCE(
          q.response->>'provider_uuid',
          q.response->>'uuid',
          q.response->'response'->>'uuid',
          q.response->'response'->'data'->>'uuid',
          q.response->'response'->'registro'->>'uuid'
        ) AS provider_uuid
      FROM factura_envios_fiscales q
      WHERE q.registro_id = ff.id
      ORDER BY COALESCE(q.updated_at, q.created_at) DESC
      LIMIT 1
    ) fq ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(ev.detalle->>'registro_aeat', ev.detalle->>'csv') AS accepted_ref
      FROM factura_eventos_fiscales ev
      WHERE ev.registro_id = ff.id
        AND ev.evento_tipo = 'queue.accepted'
      ORDER BY ev.created_at DESC
      LIMIT 1
    ) fae ON true
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

  const countSql = `
    SELECT COUNT(*)
      FROM facturas f
      JOIN clientes c ON c.id = f.cliente_id AND c.empresa_id = f.empresa_id
      LEFT JOIN factura_registros_fiscales ff ON ff.factura_id = f.id
     WHERE ${where.join(" AND ")}
  `;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query(sql, params),
    db.query(countSql, params.slice(0, -2)),
  ]);

  const total = parseInt(countRows[0].count);
  const pageN = +page; const limitN = +limit;
  res.json({
    data: rows,
    pagination: { total, page: pageN, limit: limitN,
      totalPages: Math.ceil(total/limitN), hasNext: pageN*limitN<total, hasPrev: pageN>1 }
  });
});

// ── GET /facturas/:id ─────────────────────────────────
router.get("/control-cobros", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const config = await getCobrosConfig(empresaId);
  const [resumen, proximas, riesgo] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado='borrador') AS borradores,
        COUNT(*) FILTER (WHERE estado IN ('emitida','enviada')) AS pendientes,
        COUNT(*) FILTER (WHERE estado='vencida') AS vencidas,
        COUNT(*) FILTER (WHERE estado='reclamada') AS reclamadas,
        COUNT(*) FILTER (WHERE estado='sin_cobrar') AS sin_cobrar,
        COALESCE(SUM(total) FILTER (WHERE estado IN ('emitida','enviada','vencida','reclamada','sin_cobrar')),0) AS importe_pendiente,
        COALESCE(SUM(total) FILTER (WHERE estado='reclamada'),0) AS importe_reclamado,
        COALESCE(SUM(total) FILTER (WHERE estado='sin_cobrar'),0) AS importe_sin_cobrar,
        COUNT(*) FILTER (WHERE revision_cobro_at IS NOT NULL AND revision_cobro_at <= CURRENT_DATE AND estado <> 'cobrada') AS revisar_hoy
      FROM facturas
      WHERE empresa_id=$1 AND estado <> 'rectificada'
    `, [empresaId]),
    db.query(`
      SELECT id, numero, cliente_id, fecha_vencimiento, revision_cobro_at, total, estado
      FROM facturas
      WHERE empresa_id=$1
        AND estado IN ('emitida','enviada','vencida','reclamada')
        AND revision_cobro_at IS NOT NULL
      ORDER BY revision_cobro_at ASC, fecha_vencimiento ASC NULLS LAST
      LIMIT 12
    `, [empresaId]),
    db.query(`
      SELECT f.id, f.numero, f.cliente_id, c.nombre AS cliente_nombre, f.fecha_vencimiento,
             f.revision_cobro_at, f.total, f.estado, f.reclamacion_envios,
             f.reclamacion_estado, f.reclamacion_hasta, f.reclamacion_ultimo_envio_at,
             f.aviso_cobro_dias
       FROM facturas f
      JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
      WHERE f.empresa_id=$1
        AND f.estado IN ('vencida','reclamada','sin_cobrar')
      ORDER BY
        CASE f.estado WHEN 'sin_cobrar' THEN 0 WHEN 'reclamada' THEN 1 ELSE 2 END,
        f.fecha_vencimiento ASC NULLS LAST
      LIMIT 20
    `, [empresaId]),
  ]);

  res.json({
    resumen: resumen.rows[0] || {},
    proximas: proximas.rows,
    riesgo: riesgo.rows,
    config,
  });
});

router.get("/control-cobros/config", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  res.json(await getCobrosConfig(empresaId));
});

router.put("/control-cobros/config", SOLO_GERENTE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const config = normalizeCobrosConfig(req.body || {});
  const { rows } = await db.query(
    `UPDATE empresas
        SET configuracion=jsonb_set(COALESCE(configuracion,'{}'::jsonb), '{facturacion_cobros}', $1::jsonb, true)
      WHERE id=$2
      RETURNING configuracion`,
    [JSON.stringify(config), empresaId]
  );
  res.json(rows[0]?.configuracion?.facturacion_cobros || config);
});

router.get("/bloqueos-documentales", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const [pedidos, facturas, cobros] = await Promise.all([
      db.query(`
        WITH docs AS (
          SELECT pedido_id,
                 COUNT(*)::int AS documentos,
                 COUNT(*) FILTER (
                   WHERE LOWER(COALESCE(tipo,'')) LIKE '%albaran%'
                      OR LOWER(COALESCE(nombre,'')) LIKE '%albaran%'
                      OR LOWER(COALESCE(tipo,'')) LIKE '%pod%'
                      OR LOWER(COALESCE(nombre,'')) LIKE '%pod%'
                      OR LOWER(COALESCE(tipo,'')) LIKE '%cmr%'
                      OR LOWER(COALESCE(nombre,'')) LIKE '%cmr%'
                 )::int AS soportes
            FROM pedido_docs
           WHERE empresa_id=$1
           GROUP BY pedido_id
        )
        SELECT p.id, p.numero, p.estado::text AS estado, p.origen, p.destino,
               p.fecha_carga, p.fecha_descarga, p.importe,
               c.nombre AS cliente_nombre,
               COALESCE(docs.documentos,0) AS documentos,
               COALESCE(docs.soportes,0) AS soportes
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN docs ON docs.pedido_id=p.id
         WHERE p.empresa_id=$1
           AND p.estado::text IN ('entregado','facturado')
           AND (p.factura_id IS NULL OR EXISTS (
             SELECT 1 FROM facturas f
              WHERE f.id=p.factura_id AND f.empresa_id=p.empresa_id AND f.estado='borrador'
           ))
           AND COALESCE(docs.soportes,0)=0
         ORDER BY COALESCE(p.fecha_descarga,p.fecha_carga,p.fecha_pedido) DESC NULLS LAST, p.numero DESC
         LIMIT 30
      `, [empresaId]),
      db.query(`
        WITH pedido_doc_status AS (
          SELECT fp.factura_id,
                 COUNT(fp.pedido_id)::int AS pedidos_count,
                 COUNT(fp.pedido_id) FILTER (WHERE COALESCE(pd.soportes,0)=0)::int AS pedidos_sin_soporte
            FROM factura_pedidos fp
            JOIN pedidos p ON p.id=fp.pedido_id AND p.empresa_id=$1
            LEFT JOIN (
              SELECT pedido_id,
                     COUNT(*) FILTER (
                       WHERE LOWER(COALESCE(tipo,'')) LIKE '%albaran%'
                          OR LOWER(COALESCE(nombre,'')) LIKE '%albaran%'
                          OR LOWER(COALESCE(tipo,'')) LIKE '%pod%'
                          OR LOWER(COALESCE(nombre,'')) LIKE '%pod%'
                          OR LOWER(COALESCE(tipo,'')) LIKE '%cmr%'
                          OR LOWER(COALESCE(nombre,'')) LIKE '%cmr%'
                     )::int AS soportes
                FROM pedido_docs
               WHERE empresa_id=$1
               GROUP BY pedido_id
            ) pd ON pd.pedido_id=fp.pedido_id
           GROUP BY fp.factura_id
        ), factura_docs_count AS (
          SELECT factura_id, COUNT(*)::int AS docs_factura
            FROM factura_docs
           WHERE empresa_id=$1
           GROUP BY factura_id
        )
        SELECT f.id, f.numero, f.estado::text AS estado, f.fecha, f.fecha_vencimiento, f.total,
               c.nombre AS cliente_nombre,
               COALESCE(pds.pedidos_count,0) AS pedidos_count,
               COALESCE(pds.pedidos_sin_soporte,0) AS pedidos_sin_soporte,
               COALESCE(fdc.docs_factura,0) AS docs_factura
          FROM facturas f
          JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
          LEFT JOIN pedido_doc_status pds ON pds.factura_id=f.id
          LEFT JOIN factura_docs_count fdc ON fdc.factura_id=f.id
         WHERE f.empresa_id=$1
           AND f.estado::text IN ('borrador','emitida','enviada')
           AND COALESCE(pds.pedidos_sin_soporte,0)>0
         ORDER BY f.fecha DESC, f.numero DESC
         LIMIT 30
      `, [empresaId]),
      db.query(`
        WITH pedido_doc_status AS (
          SELECT fp.factura_id,
                 COUNT(fp.pedido_id) FILTER (WHERE COALESCE(pd.soportes,0)=0)::int AS pedidos_sin_soporte
            FROM factura_pedidos fp
            JOIN pedidos p ON p.id=fp.pedido_id AND p.empresa_id=$1
            LEFT JOIN (
              SELECT pedido_id,
                     COUNT(*) FILTER (
                       WHERE LOWER(COALESCE(tipo,'')) LIKE '%albaran%'
                          OR LOWER(COALESCE(nombre,'')) LIKE '%albaran%'
                          OR LOWER(COALESCE(tipo,'')) LIKE '%pod%'
                          OR LOWER(COALESCE(nombre,'')) LIKE '%pod%'
                          OR LOWER(COALESCE(tipo,'')) LIKE '%cmr%'
                          OR LOWER(COALESCE(nombre,'')) LIKE '%cmr%'
                     )::int AS soportes
                FROM pedido_docs
               WHERE empresa_id=$1
               GROUP BY pedido_id
            ) pd ON pd.pedido_id=fp.pedido_id
           GROUP BY fp.factura_id
        )
        SELECT f.id, f.numero, f.estado::text AS estado, f.fecha_vencimiento, f.revision_cobro_at,
               f.total, c.nombre AS cliente_nombre,
               COALESCE(pds.pedidos_sin_soporte,0) AS pedidos_sin_soporte
          FROM facturas f
          JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
          LEFT JOIN pedido_doc_status pds ON pds.factura_id=f.id
         WHERE f.empresa_id=$1
           AND f.estado::text IN ('vencida','reclamada','sin_cobrar')
           AND COALESCE(pds.pedidos_sin_soporte,0)>0
         ORDER BY f.fecha_vencimiento ASC NULLS LAST, f.total DESC
         LIMIT 30
      `, [empresaId]),
    ]);

    const pedidosRows = pedidos.rows.map((p) => ({
      ...p,
      bloqueos: ["POD/albaran pendiente"],
      accion: "Pedir o adjuntar soporte antes de facturar.",
    }));
    const facturasRows = facturas.rows.map((f) => ({
      ...f,
      bloqueos: [`${Number(f.pedidos_sin_soporte || 0)} pedido(s) sin soporte`],
      accion: f.estado === "borrador" ? "Completar documentacion antes de emitir." : "Revisar adjuntos antes de reclamar o cerrar cobro.",
    }));
    const cobrosRows = cobros.rows.map((f) => ({
      ...f,
      bloqueos: [`${Number(f.pedidos_sin_soporte || 0)} pedido(s) sin soporte`],
      accion: "Reforzar reclamacion con POD/CMR antes de escalar.",
    }));
    const sum = (items, key) => items.reduce((acc, item) => acc + Number(item[key] || 0), 0);
    res.json({
      resumen: {
        pedidos_sin_soporte: pedidosRows.length,
        importe_bloqueado_facturacion: sum(pedidosRows, "importe"),
        facturas_con_soporte_pendiente: facturasRows.length,
        importe_facturas_con_soporte_pendiente: sum(facturasRows, "total"),
        cobros_en_riesgo_documental: cobrosRows.length,
        importe_cobro_riesgo_documental: sum(cobrosRows, "total"),
        total_bloqueos: pedidosRows.length + facturasRows.length + cobrosRows.length,
      },
      pedidos: pedidosRows,
      facturas: facturasRows,
      cobros: cobrosRows,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudieron calcular los bloqueos documentales" });
  }
});

router.get("/fiscal/resumen", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const [config, resumen, recientes, cola] = await Promise.all([
    getEmpresaFiscalConfig(empresaId),
    db.query(
      `SELECT
         COUNT(*) AS total_registros,
         COUNT(*) FILTER (WHERE modo='verifactu') AS verifactu,
         COUNT(*) FILTER (WHERE modo='sii') AS sii,
         COUNT(*) FILTER (WHERE estado_envio='pendiente') AS pendientes,
         COUNT(*) FILTER (WHERE estado_envio='aceptado') AS aceptados,
         COUNT(*) FILTER (WHERE estado_envio='error') AS con_error
       FROM factura_registros_fiscales
       WHERE empresa_id=$1`,
      [empresaId]
    ),
    db.query(
      `SELECT frf.id, frf.factura_id, frf.modo, frf.estado_envio, frf.huella, frf.ultimo_error, frf.updated_at,
              f.numero, f.fecha, f.total, c.nombre AS cliente_nombre,
              ultimo_envio.provider_uuid,
              ultimo_sync.ultimo_sync_tipo,
              ultimo_sync.ultimo_sync_at
         FROM factura_registros_fiscales frf
         JOIN facturas f ON f.id=frf.factura_id
         JOIN clientes c ON c.id=f.cliente_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(
                    q.response->>'provider_uuid',
                    q.response->>'uuid',
                    q.response->'response'->>'uuid',
                    q.response->'response'->'data'->>'uuid',
                    q.response->'response'->'registro'->>'uuid'
                  ) AS provider_uuid
             FROM factura_envios_fiscales q
            WHERE q.factura_id=frf.factura_id
              AND q.empresa_id=frf.empresa_id
            ORDER BY q.created_at DESC
            LIMIT 1
         ) ultimo_envio ON TRUE
         LEFT JOIN LATERAL (
           SELECT ev.evento_tipo AS ultimo_sync_tipo, ev.created_at AS ultimo_sync_at
             FROM factura_eventos_fiscales ev
            WHERE ev.factura_id=frf.factura_id
              AND ev.empresa_id=frf.empresa_id
              AND ev.evento_tipo IN ('sync.verifacti.manual','webhook.verifacti.recibido')
            ORDER BY ev.created_at DESC
            LIMIT 1
         ) ultimo_sync ON TRUE
        WHERE frf.empresa_id=$1
        ORDER BY frf.updated_at DESC NULLS LAST, frf.created_at DESC
        LIMIT 8`,
      [empresaId]
    ),
    db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (factura_id, sistema)
                q.id, q.factura_id, q.sistema, q.entorno, q.estado, q.intento, q.error, q.next_retry_at, q.created_at,
                CASE
                  WHEN q.estado = 'error' AND (q.next_retry_at IS NULL OR q.next_retry_at <= NOW()) THEN true
                  WHEN q.estado IN ('pendiente','procesando') AND q.created_at <= NOW() - INTERVAL '30 minutes' THEN true
                  ELSE false
                END AS atascado,
                COALESCE(
                  q.response->>'provider_uuid',
                  q.response->>'uuid',
                  q.response->'response'->>'uuid',
                  q.response->'response'->'data'->>'uuid',
                  q.response->'response'->'registro'->>'uuid'
                ) AS provider_uuid,
                sync_ev.ultimo_sync_tipo,
                sync_ev.ultimo_sync_at,
                f.numero, f.total, c.nombre AS cliente_nombre
           FROM factura_envios_fiscales q
           JOIN facturas f ON f.id=q.factura_id
           JOIN clientes c ON c.id=f.cliente_id
           LEFT JOIN LATERAL (
             SELECT ev.evento_tipo AS ultimo_sync_tipo, ev.created_at AS ultimo_sync_at
               FROM factura_eventos_fiscales ev
              WHERE ev.factura_id=q.factura_id
                AND ev.empresa_id=q.empresa_id
                AND ev.evento_tipo IN ('sync.verifacti.manual','webhook.verifacti.recibido')
              ORDER BY ev.created_at DESC
              LIMIT 1
           ) sync_ev ON TRUE
          WHERE q.empresa_id=$1
            AND q.estado IN ('pendiente','procesando','error')
          ORDER BY q.factura_id, q.sistema, q.created_at DESC
       ) cola
       ORDER BY
         CASE estado WHEN 'error' THEN 0 WHEN 'procesando' THEN 1 ELSE 2 END,
         next_retry_at ASC NULLS LAST,
         created_at DESC
       LIMIT 12`,
      [empresaId]
    ),
  ]);

  res.json({
    config: sanitizeFiscalConfigForClient(config),
    status: buildFiscalStatus(config),
    resumen: {
      ...(resumen.rows[0] || {}),
      atascados: Array.isArray(cola.rows) ? cola.rows.filter((item) => item.atascado).length : 0,
    },
    recientes: recientes.rows,
    cola: cola.rows,
    scheduler: fiscalScheduler.getStatus(),
  });
});

router.post("/fiscal/procesar-cola", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const limit = Math.max(1, Math.min(Number(req.body?.limit) || 10, 50));
  const facturaId = req.body?.factura_id || null;
  const result = await db.transaction((client) =>
    processPendingFiscalQueue({
      empresaId,
      actorUserId: req.user.id,
      limit,
      facturaId,
      client,
    })
  );
  res.json(result);
});

router.get("/:id", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const { rows } = await db.query(`
    SELECT f.*,
           c.nombre AS cliente_nombre, c.cif AS cliente_cif, c.email AS cliente_email, c.email_facturacion AS cliente_email_facturacion,
           c.direccion AS cliente_dir, c.tipo_iva, c.iva_regimen AS cliente_iva_regimen, c.tipo_irpf, c.forma_pago, c.vencimiento
    FROM facturas f JOIN clientes c ON c.id = f.cliente_id
    WHERE f.id = $1 AND f.empresa_id = $2
  `, [req.params.id, empresaId]);

  if (!rows[0]) return res.status(404).json({ error: "Factura no encontrada" });

  const [lineas, extras, pedidos, docs, fiscal, fiscalEventos, fiscalEnvios, auditRows, emailRows] = await Promise.all([
    db.query(`SELECT fl.*
                FROM factura_lineas fl
                JOIN facturas f ON f.id=fl.factura_id
               WHERE fl.factura_id=$1 AND f.empresa_id=$2
               ORDER BY fl.orden, fl.id`, [req.params.id, empresaId]),
    db.query(`SELECT fe.*
                FROM factura_extracostes fe
                JOIN facturas f ON f.id=fe.factura_id
               WHERE fe.factura_id=$1 AND f.empresa_id=$2
               ORDER BY fe.id`, [req.params.id, empresaId]),
    db.query(`SELECT p.id, p.numero, p.origen, p.destino, p.fecha_pedido
              FROM factura_pedidos fp JOIN pedidos p ON p.id=fp.pedido_id
              WHERE fp.factura_id=$1 AND p.empresa_id=$2`, [req.params.id, empresaId]),
    db.query(`SELECT id, pedido_doc_id, pedido_id, nombre, tipo, file_mime, created_at
              FROM factura_docs
              WHERE factura_id=$1 AND empresa_id=$2
              ORDER BY created_at DESC`, [req.params.id, empresaId]).catch(() => ({ rows: [] })),
    db.query(`SELECT * FROM factura_registros_fiscales WHERE factura_id=$1 AND empresa_id=$2`, [req.params.id, empresaId]).catch(() => ({ rows: [] })),
    db.query(`SELECT id, evento_tipo, detalle, created_at
                FROM factura_eventos_fiscales
               WHERE factura_id=$1 AND empresa_id=$2
               ORDER BY created_at DESC
               LIMIT 25`, [req.params.id, empresaId]).catch(() => ({ rows: [] })),
    db.query(`SELECT id, sistema, entorno, estado, intento, error, response, next_retry_at, processed_at, created_at
                FROM factura_envios_fiscales
               WHERE factura_id=$1 AND empresa_id=$2
               ORDER BY created_at DESC
               LIMIT 25`, [req.params.id, empresaId]).catch(() => ({ rows: [] })),
    db.query(`SELECT a.id, a.campo, a.valor_antes, a.valor_nuevo, a.ip, a.created_at,
                     u.nombre AS usuario_nombre, u.email AS usuario_email
               FROM audit_log a
               LEFT JOIN usuarios u ON u.id = a.usuario_id
               WHERE a.tabla='facturas'
                 AND a.registro_id=$1
                 AND (a.empresa_id=$2 OR a.empresa_id IS NULL)
               ORDER BY a.created_at DESC
               LIMIT 30`, [req.params.id, empresaId]).catch(() => ({ rows: [] })),
    db.query(`SELECT id, trigger, destinatario, asunto, estado, error, provider, adjuntos_count, message_id, meta, sent_at
                FROM email_log
               WHERE empresa_id=$2
                 AND (meta->>'factura_id'=$1 OR meta->>'factura_numero'=(SELECT numero FROM facturas WHERE id=$1 AND empresa_id=$2))
               ORDER BY sent_at DESC
               LIMIT 20`, [req.params.id, empresaId]).catch(() => ({ rows: [] })),
  ]);

  res.json({
    ...rows[0],
    lineas: lineas.rows,
    extracostes: extras.rows,
    pedidos: pedidos.rows,
    documentos: docs.rows,
    fiscal: fiscal.rows[0] || null,
    fiscal_eventos: fiscalEventos.rows,
    fiscal_envios: fiscalEnvios.rows,
    audit_log: auditRows.rows,
    email_log: emailRows.rows,
  });
});

router.get("/:id/fiscal", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const [factura, fiscal, eventos, envios, config] = await Promise.all([
    db.query("SELECT id, numero, fecha, estado, total FROM facturas WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]),
    db.query("SELECT * FROM factura_registros_fiscales WHERE factura_id=$1 AND empresa_id=$2", [req.params.id, empresaId]),
    db.query(`SELECT id, evento_tipo, detalle, created_at
                FROM factura_eventos_fiscales
               WHERE factura_id=$1 AND empresa_id=$2
               ORDER BY created_at DESC
               LIMIT 40`, [req.params.id, empresaId]),
    db.query(`SELECT id, sistema, entorno, estado, intento, payload, response, error, next_retry_at, processed_at, created_at
                FROM factura_envios_fiscales
               WHERE factura_id=$1 AND empresa_id=$2
               ORDER BY created_at DESC
               LIMIT 40`, [req.params.id, empresaId]),
    getEmpresaFiscalConfig(empresaId),
  ]);
  if (!factura.rows[0]) return res.status(404).json({ error: "Factura no encontrada" });
  res.json({
    factura: factura.rows[0],
    config: sanitizeFiscalConfigForClient(config),
    registro: fiscal.rows[0] || null,
    eventos: eventos.rows,
    envios: envios.rows,
  });
});

router.post("/:id/fiscal/requeue", SOLO_GERENTE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const result = await db.transaction(async (client) => {
    const fiscalResult = await ensureFacturaFiscalRecord({
      facturaId: req.params.id,
      empresaId,
      actorUserId: req.user.id,
      force: true,
      client,
    });
    if (fiscalResult.skipped && fiscalResult.reason !== "already_exists") {
      return fiscalResult;
    }
    const record = fiscalResult.record;
    const { rows: pendingRows } = await client.query(
      `SELECT id
         FROM factura_envios_fiscales
        WHERE factura_id=$1 AND empresa_id=$2 AND estado IN ('pendiente','procesando')
        ORDER BY created_at DESC
        LIMIT 1`,
      [req.params.id, empresaId]
    );
    if (!pendingRows[0]) {
      await client.query(
        `INSERT INTO factura_envios_fiscales
          (registro_id, factura_id, empresa_id, sistema, entorno, estado, payload, next_retry_at)
         VALUES ($1,$2,$3,$4,$5,'pendiente',$6::jsonb,NOW())`,
        [record.id, req.params.id, empresaId, record.modo, record.entorno, JSON.stringify(record.payload || {})]
      );
    }
    await client.query(
      `INSERT INTO factura_eventos_fiscales
        (registro_id, factura_id, empresa_id, evento_tipo, detalle)
       VALUES ($1,$2,$3,'queue.manual_requeue',$4::jsonb)`,
      [record.id, req.params.id, empresaId, JSON.stringify({ usuario_id: req.user.id, reused_pending: !!pendingRows[0] })]
    );
    return { ok: true, record };
  });
  res.json(result);
});

// ── POST /facturas ────────────────────────────────────
router.post("/:id/fiscal/sincronizar", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const config = await getEmpresaFiscalConfig(empresaId);
  if (config?.modo !== "verifactu" || config?.verifactu?.proveedor !== "verifacti") {
    return res.status(400).json({ error: "La empresa no esta trabajando con Verifacti en VERIFACTU." });
  }

  const factura = await db.query(
    "SELECT id, numero FROM facturas WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresaId]
  );
  if (!factura.rows[0]) return res.status(404).json({ error: "Factura no encontrada" });

  const envio = await db.query(
    `SELECT q.*, frf.modo, frf.estado_envio
       FROM factura_envios_fiscales q
       JOIN factura_registros_fiscales frf ON frf.id=q.registro_id
      WHERE q.factura_id=$1
        AND q.empresa_id=$2
        AND q.sistema='verifactu'
      ORDER BY q.created_at DESC
      LIMIT 1`,
    [req.params.id, empresaId]
  );
  const item = envio.rows[0];
  if (!item) {
    return res.status(404).json({ error: "La factura aun no tiene un envio fiscal VERIFACTU para sincronizar." });
  }

  const providerUuid = extractProviderUuid(item.response || {});
  if (!providerUuid) {
    return res.status(409).json({ error: "Esta factura aun no tiene UUID de proveedor en Verifacti." });
  }

  const providerResult = await getVerifactiRecordStatus(config, providerUuid);
  await db.transaction(async (client) => {
    if (providerResult.provider_status === "accepted") {
      await markQueueAccepted(client, item, providerResult, req.user.id);
    } else if (providerResult.provider_status === "pending") {
      await markQueuePending(client, item, providerResult, req.user.id, 2 * 60 * 1000, "Sincronizacion manual con Verifacti");
    } else {
      await markQueueError(
        client,
        item,
        providerResult?.response?.error || providerResult?.response?.message || "Error devuelto por Verifacti al sincronizar.",
        req.user.id,
        false,
        providerResult
      );
    }
    await logFiscalEvent(client, item.registro_id, item.factura_id, item.empresa_id, "sync.verifacti.manual", {
      usuario_id: req.user.id,
      provider_uuid: providerUuid,
      provider_status: providerResult.provider_status,
    });
  });

  res.json({
    ok: true,
    factura_id: req.params.id,
    numero: factura.rows[0].numero,
    provider: "verifacti",
    provider_uuid: providerUuid,
    provider_status: providerResult.provider_status,
  });
});

router.post("/", GERENTE_O_CONTABLE,
  body("cliente_id").isUUID(),
  body("serie").isIn(["A","B","R","G"]),
  body("lineas").isArray({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { cliente_id, serie, fecha, fecha_vencimiento, estado, forma_pago, vencimiento,
            lineas, extracostes = [], pedidos_ids = [], observaciones, notas_internas } = req.body;
    const empresaId = req.empresaId || req.user.empresa_id;
    const pedidosIdsUnicos = [...new Set((pedidos_ids || []).filter(Boolean))];
    const borradoresPrevios = new Set();

    if (pedidosIdsUnicos.length) {
      const { rows: pedidosFacturables } = await db.query(
        `SELECT p.id, p.numero, p.estado, p.factura_id, p.cliente_id,
                f.estado AS factura_estado,
                f.cliente_id AS factura_cliente_id
           FROM pedidos p
           LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
          WHERE p.id = ANY($1::uuid[]) AND p.empresa_id=$2`,
        [pedidosIdsUnicos, empresaId]
      );
      const porId = new Map(pedidosFacturables.map(p => [String(p.id), p]));
      for (const pid of pedidosIdsUnicos) {
        const pedido = porId.get(String(pid));
        if (!pedido) return res.status(400).json({ error: "Pedido no encontrado o no pertenece a la empresa" });
        if (String(pedido.cliente_id) !== String(cliente_id)) {
          return res.status(400).json({ error: `El pedido ${pedido.numero || pid} pertenece a otro cliente` });
        }
        if (pedido.factura_id && !isFacturaBorradorAgrupable(pedido)) {
          return res.status(400).json({ error: `El pedido ${pedido.numero || pid} ya tiene una factura emitida o no editable vinculada` });
        }
        if (isFacturaBorradorAgrupable(pedido)) {
          if (String(pedido.factura_cliente_id) !== String(cliente_id)) {
            return res.status(400).json({ error: `El borrador del pedido ${pedido.numero || pid} pertenece a otro cliente` });
          }
          borradoresPrevios.add(String(pedido.factura_id));
        }
        if (pedido.estado !== "entregado") {
          return res.status(400).json({
            error: `El pedido ${pedido.numero || pid} debe estar terminado/entregado antes de crear la factura`,
          });
        }
      }
    }

    await db.transaction(async (client) => {
      const cobrosConfig = await getCobrosConfig(empresaId, client);
      const borradoresPreviosArr = [...borradoresPrevios];
      if (borradoresPreviosArr.length) {
        await client.query(
          `DELETE FROM factura_pedidos
            WHERE pedido_id = ANY($1::uuid[])
              AND factura_id = ANY($2::uuid[])`,
          [pedidosIdsUnicos, borradoresPreviosArr]
        );
        await client.query(
          "UPDATE pedidos SET factura_id=NULL WHERE id = ANY($1::uuid[]) AND empresa_id=$2",
          [pedidosIdsUnicos, empresaId]
        );
      }

      // Generar número correlativo
      const año = new Date(fecha || Date.now()).getFullYear();
      const { rows: last } = await client.query(
        `SELECT numero FROM facturas WHERE serie=$1 AND EXTRACT(year FROM fecha)=$2 AND empresa_id=$3 ORDER BY numero DESC LIMIT 1 FOR UPDATE`,
        [serie, año, empresaId]
      );
      const lastNum = last[0] ? parseInt(last[0].numero.split("-").pop()) : 0;
      const numero  = `${serie}-${año}-${String(lastNum + 1).padStart(4, "0")}`;

      // Calcular totales
      const base = lineas.reduce((s, l) => s + (l.cantidad * l.precio_unit), 0)
                 + (extracostes||[]).reduce((s, e) => s + parseFloat(e.importe || 0), 0);
      const { rows: cliRows } = await client.query("SELECT tipo_iva, iva_regimen, tipo_irpf FROM clientes WHERE id=$1 AND empresa_id=$2", [cliente_id, empresaId]);
      if (!cliRows[0]) throw new Error("Cliente no encontrado");
      const tipoIva  = cliRows[0]?.tipo_iva !== undefined && cliRows[0]?.tipo_iva !== null ? Number(cliRows[0].tipo_iva) : 21;
      const ivaRegimen = ivaRegimenFromPct(tipoIva, cliRows[0]?.iva_regimen);
      const tipoIrpf = cliRows[0]?.tipo_irpf || 0;
      const cuotaIva  = base * tipoIva  / 100;
      const cuotaIrpf = base * tipoIrpf / 100;
      const total     = base + cuotaIva - cuotaIrpf;
      let revisionCobroAt = null;
      if (fecha_vencimiento) {
        const d = new Date(fecha_vencimiento);
        if (!Number.isNaN(d.getTime())) {
          d.setDate(d.getDate() + cobrosConfig.dias_revision_post_vencimiento);
          revisionCobroAt = d.toISOString().slice(0, 10);
        }
      }

      const { rows: [fac] } = await client.query(`
        INSERT INTO facturas
          (numero, serie, cliente_id, fecha, fecha_vencimiento, estado, forma_pago, vencimiento,
           base_imponible, tipo_iva, cuota_iva, tipo_irpf, cuota_irpf, total,
           iva_regimen, observaciones, notas_internas, created_by, empresa_id, revision_cobro_at, aviso_cobro_dias)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        RETURNING *`,
        [numero, serie, cliente_id, fecha || new Date(), fecha_vencimiento, estado || "borrador",
         forma_pago, vencimiento, base, tipoIva, cuotaIva, tipoIrpf, cuotaIrpf, total,
         ivaRegimen, observaciones, notas_internas, req.user.id, empresaId, revisionCobroAt,
         cobrosConfig.dias_entre_reclamaciones]
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

      // Vincular pedidos — solo si están en estado válido para facturar
      const ESTADOS_FACTURABLES = ["entregado"];
      for (const pid of pedidosIdsUnicos) {
        const { rows: pedCheck } = await client.query(
          "SELECT id, estado FROM pedidos WHERE id=$1 AND empresa_id=$2",
          [pid, empresaId]
        );
        if (!pedCheck[0]) continue; // skip if not found
        if (!ESTADOS_FACTURABLES.includes(pedCheck[0].estado)) {
          // Skip pedidos that are not in a billable state (pendiente, cancelado)
          logger.warn(`Pedido ${pid} en estado ${pedCheck[0].estado} — no se vincula a la factura`);
          continue;
        }
        await client.query(
          `INSERT INTO factura_pedidos (factura_id, pedido_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [fac.id, pid]
        );
        await client.query("UPDATE pedidos SET factura_id=$1 WHERE id=$2 AND empresa_id=$3", [fac.id, pid, empresaId]);
      }

      if (pedidosIdsUnicos.length) {
        await client.query(
          `INSERT INTO factura_docs (factura_id,pedido_doc_id,pedido_id,empresa_id,nombre,tipo,file_base64,file_mime)
           SELECT $1,id,pedido_id,empresa_id,nombre,tipo,file_base64,file_mime
             FROM pedido_docs
            WHERE empresa_id=$2
              AND pedido_id = ANY($3::uuid[])
              AND (
                LOWER(COALESCE(tipo,'')) LIKE '%albar%'
                OR LOWER(COALESCE(nombre,'')) LIKE '%albar%'
                OR LOWER(COALESCE(tipo,'')) LIKE '%cmr%'
                OR LOWER(COALESCE(nombre,'')) LIKE '%cmr%'
              )
           ON CONFLICT DO NOTHING`,
          [fac.id, empresaId, pedidosIdsUnicos]
        ).catch(e => logger.warn("No se pudieron vincular albaranes a factura:", e.message));
      }

      if (borradoresPreviosArr.length) {
        await client.query(
          `DELETE FROM facturas f
            WHERE f.id = ANY($1::uuid[])
              AND f.empresa_id=$2
              AND f.estado='borrador'
              AND NOT EXISTS (
                SELECT 1 FROM factura_pedidos fp WHERE fp.factura_id=f.id
              )`,
          [borradoresPreviosArr, empresaId]
        );
      }

      if ((fac.estado || "").toLowerCase() !== "borrador") {
        await ensureFacturaFiscalRecord({
          facturaId: fac.id,
          empresaId,
          actorUserId: req.user.id,
          client,
        });
      }

      res.status(201).json(fac);
      logger.info(`Factura creada: ${numero} por ${req.user.email}`);
    });
  }
);

// ── PATCH /facturas/:id/estado ────────────────────────
// Solo gerente/contable. Con audit log.
router.patch("/:id/estado", PUEDE_CAMBIAR_ESTADO_FACTURA,
  body("estado").isIn(["borrador","emitida","enviada","cobrada","vencida","reclamada","sin_cobrar","rectificada"]),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { estado, motivo } = req.body;
    const empresaId = req.empresaId || req.user.empresa_id;

    const { rows } = await db.query("SELECT * FROM facturas WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
    if (!rows[0]) return res.status(404).json({ error: "Factura no encontrada" });

    const factura      = rows[0];
    const estadoAntes  = factura.estado;

    if (estado === "enviada") {
      const sinSoporte = await getFacturaPedidosSinSoporte(factura.id, empresaId);
      if (sinSoporte.length) {
        return res.status(409).json({
          error: `No se puede marcar como enviada: faltan albaranes/POD en ${sinSoporte.length} pedido(s).`,
          pedidos_sin_soporte: sinSoporte.map(p => ({ id: p.id, numero: p.numero })),
        });
      }
    }

    let pedidosAfectados = [];
    await db.transaction(async (client) => {
      await client.query("UPDATE facturas SET estado=$1, updated_by=$2 WHERE id=$3 AND empresa_id=$4", [estado, req.user.id, factura.id, empresaId]);

      const { rows: linkedPedidos } = await client.query(
        `SELECT id
           FROM pedidos
          WHERE factura_id=$1
            AND empresa_id=$2`,
        [factura.id, empresaId]
      );
      pedidosAfectados = linkedPedidos.map(row => row.id);

      // Audit log
      await client.query(
        `INSERT INTO audit_log (tabla, registro_id, campo, valor_antes, valor_nuevo, usuario_id, ip, empresa_id)
         VALUES ('facturas', $1, 'estado', $2, $3, $4, $5, $6)`,
        [factura.id, estadoAntes, estado, req.user.id, req.ip, empresaId]
      );

      // Email automático si pasa a "cobrada" o "vencida"
      if (estado !== "borrador") {
        await ensureFacturaFiscalRecord({
          facturaId: factura.id,
          empresaId,
          actorUserId: req.user.id,
          client,
        });
      }
    });

    logger.info(`Estado factura ${factura.numero}: ${estadoAntes} → ${estado} por ${req.user.email}`);
    res.json({
      ok: true,
      estado_anterior: estadoAntes,
      estado_nuevo: estado,
      pedido_estado_aplicado: pedidoEstadoDesdeFacturaEstado(estado),
      pedido_ids_afectados: pedidosAfectados,
    });
  }
);

// ── DELETE /facturas/:id ──────────────────────────────
// Solo borradores pueden eliminarse
router.post("/reclamaciones/procesar", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const cobrosConfig = await getCobrosConfig(empresaId);
  const maxEnvios = clampInt(req.body?.max_envios, cobrosConfig.max_envios_reclamacion, 1, 20);
  const { rows } = await db.query(
    `SELECT f.*, c.nombre AS cliente_nombre, c.email AS cliente_email, c.email_facturacion AS cliente_email_facturacion
       FROM facturas f
       JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
      WHERE f.empresa_id=$1
        AND f.estado <> 'cobrada'
        AND f.revision_cobro_at IS NOT NULL
        AND f.revision_cobro_at <= CURRENT_DATE
      ORDER BY f.fecha_vencimiento NULLS LAST, f.fecha ASC
      LIMIT 100`,
    [empresaId]
  );

  let reclamadas = 0;
  let sinCobrar = 0;
  let emails = 0;

  for (const f of rows) {
    const envios = Number(f.reclamacion_envios || 0);
    const fechaLimite = f.reclamacion_hasta ? new Date(f.reclamacion_hasta) : null;
    if (fechaLimite && fechaLimite < new Date() && f.estado !== "sin_cobrar") {
      await db.query(
        "UPDATE facturas SET estado='sin_cobrar', reclamacion_estado='juridico_recomendado' WHERE id=$1 AND empresa_id=$2",
        [f.id, empresaId]
      );
      sinCobrar++;
      continue;
    }

    if (!["reclamada","sin_cobrar"].includes(f.estado)) {
      await db.query(
        `UPDATE facturas
            SET estado='reclamada',
                reclamacion_estado='reclamada',
                reclamacion_hasta=COALESCE(reclamacion_hasta, CURRENT_DATE + ($3::int * INTERVAL '1 day'))
          WHERE id=$1 AND empresa_id=$2`,
        [f.id, empresaId, cobrosConfig.dias_hasta_juridico]
      );
      reclamadas++;
    }

    const ultimo = f.reclamacion_ultimo_envio_at ? new Date(f.reclamacion_ultimo_envio_at) : null;
    const diasEspacio = Math.max(Number(f.aviso_cobro_dias || cobrosConfig.dias_entre_reclamaciones), 3);
    const puedeEnviar = !ultimo || (Date.now() - ultimo.getTime()) >= diasEspacio * 86400000;
    const destinatarios = splitEmails(f.cliente_email_facturacion, f.cliente_email);
    if (cobrosConfig.envio_email_auto && destinatarios.length && puedeEnviar && envios < maxEnvios) {
      for (const destinatario of destinatarios) {
        await enviarEmail({
          trigger: "factura_reclamacion",
          destinatario,
          plantilla: "factura_reclamacion",
          empresa_id: empresaId,
          datos: {
            empresa: f.cliente_nombre,
            numero: f.numero,
            total: f.total,
            fecha_vencimiento: f.fecha_vencimiento,
          },
        }).catch(err => logger.error("Email reclamacion factura:", err.message));
        emails++;
      }
      await db.query(
        `UPDATE facturas
            SET reclamacion_envios=COALESCE(reclamacion_envios,0)+1,
                reclamacion_ultimo_envio_at=NOW()
          WHERE id=$1 AND empresa_id=$2`,
        [f.id, empresaId]
      );
    }
  }

  res.json({ ok: true, revisadas: rows.length, reclamadas, sin_cobrar: sinCobrar, emails });
});

router.delete("/:id", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const { rows } = await db.query("SELECT estado, numero FROM facturas WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
  if (!rows[0]) return res.status(404).json({ error: "Factura no encontrada" });
  if (rows[0].estado !== "borrador") {
    return res.status(400).json({ error: "Solo se pueden eliminar facturas en estado borrador" });
  }

  let pedidosAfectados = [];
  let paletsAfectados = [];
  await db.transaction(async (client) => {
    const { rows: detachedPedidos } = await client.query(
        `UPDATE pedidos
            SET factura_id=NULL
          WHERE factura_id=$1 AND empresa_id=$2
      RETURNING id`,
        [req.params.id, empresaId]
      );
    pedidosAfectados = detachedPedidos.map(row => row.id);
    const { rows: detachedPalets } = await client.query(
      `UPDATE palets_movimientos
          SET factura_id=NULL,
              updated_at=NOW()
        WHERE factura_id=$1 AND empresa_id=$2
    RETURNING id`,
      [req.params.id, empresaId]
    );
    paletsAfectados = detachedPalets.map(row => row.id);
    await client.query("DELETE FROM facturas WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
  });
  logger.warn(`Factura eliminada: ${rows[0].numero} por ${req.user.email}`);
  res.json({ ok: true, pedido_ids_afectados: pedidosAfectados, palets_movimiento_ids_afectados: paletsAfectados, pedido_estado_aplicado: "entregado" });
});

module.exports = router;
