const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { crearNotificacion } = require("../services/notificaciones");
const { buildDocumentoControlPayload, buildDocumentoControlPublicPayload } = require("../services/documentoControl");

const router = express.Router();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS portal_solicitudes_cliente (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        solicitado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        origen TEXT NOT NULL,
        destino TEXT NOT NULL,
        fecha_carga DATE,
        hora_carga VARCHAR(20),
        fecha_descarga DATE,
        hora_descarga VARCHAR(20),
        mercancia TEXT,
        peso_kg NUMERIC(12,2),
        bultos INTEGER,
        referencia_cliente VARCHAR(255),
        notas TEXT,
        estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
        pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
        respuesta TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(async () => {
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS fecha_propuesta DATE");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS hora_propuesta VARCHAR(20)");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS decision_cliente VARCHAR(20)");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS decision_cliente_at TIMESTAMPTZ");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS importe NUMERIC(12,2)");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS importe_contraoferta NUMERIC(12,2)");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS decision_precio VARCHAR(20)");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS decision_precio_at TIMESTAMPTZ");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS contraoferta_at TIMESTAMPTZ");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS origen_punto_id UUID REFERENCES puntos_interes(id) ON DELETE SET NULL");
      await db.query("ALTER TABLE portal_solicitudes_cliente ADD COLUMN IF NOT EXISTS destino_punto_id UUID REFERENCES puntos_interes(id) ON DELETE SET NULL");
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS referencia_cliente VARCHAR(255)");
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_descarga DATE");
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS hora_descarga TIME");
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pendiente_completar BOOLEAN DEFAULT false");
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aviso_completar TEXT");
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS portal_solicitud_id UUID");
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS puntos_carga JSONB DEFAULT '[]'::jsonb");
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS puntos_descarga JSONB DEFAULT '[]'::jsonb");
      await db.query("CREATE INDEX IF NOT EXISTS idx_portal_solicitudes_empresa_estado ON portal_solicitudes_cliente(empresa_id, estado, created_at DESC)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_portal_solicitudes_cliente ON portal_solicitudes_cliente(cliente_id, created_at DESC)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_numero_portal ON pedidos(empresa_id, numero DESC)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_pedidos_portal_solicitud ON pedidos(empresa_id, portal_solicitud_id) WHERE portal_solicitud_id IS NOT NULL");
      await db.query(`
        CREATE TABLE IF NOT EXISTS pedido_numero_counters (
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          year INTEGER NOT NULL,
          last_num INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (empresa_id, year)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS portal_solicitud_eventos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          solicitud_id UUID NOT NULL REFERENCES portal_solicitudes_cliente(id) ON DELETE CASCADE,
          tipo VARCHAR(80) NOT NULL,
          actor_tipo VARCHAR(40) NOT NULL DEFAULT 'usuario',
          actor_id UUID,
          detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_portal_solicitud_eventos_solicitud ON portal_solicitud_eventos(solicitud_id, created_at DESC)");
    }).catch(err => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id;
}

function normalizeNumeric(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normalizeNonNegativeNumeric(value) {
  const n = normalizeNumeric(value);
  return n !== null && n >= 0 ? n : null;
}

function normalizePositiveInteger(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function resolveSolicitudImporte(solicitud = {}) {
  const importe = solicitud.decision_precio === "aceptada"
    ? normalizeNonNegativeNumeric(solicitud.importe_contraoferta)
    : normalizeNonNegativeNumeric(solicitud.importe);
  return importe ?? 0;
}

function normalizeTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const clean = raw.replace(/[hH.]/g, ":").replace(/\s+/g, "");
  const simpleHour = clean.match(/^([01]?\d|2[0-3])$/);
  if (simpleHour) return `${simpleHour[1].padStart(2, "0")}:00`;
  const hourMinute = clean.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (hourMinute) return `${hourMinute[1].padStart(2, "0")}:${hourMinute[2]}`;
  const compact = clean.match(/^([01]?\d|2[0-3])([0-5]\d)$/);
  if (compact) return `${compact[1].padStart(2, "0")}:${compact[2]}`;
  return null;
}

function portalPointLabel(point = {}, fallback = "") {
  const parts = [point.nombre, point.direccion, point.ciudad, point.provincia]
    .map(value => String(value || "").trim())
    .filter((value, index, all) => value && all.indexOf(value) === index);
  return parts.join(" - ") || String(fallback || "").trim();
}

function portalPointStop(point, fallback, tipo, fecha, hora) {
  return {
    punto_id: point?.id || null,
    nombre: point?.nombre || String(fallback || "").trim(),
    direccion: point?.direccion || String(fallback || "").trim(),
    poblacion: point?.ciudad || "",
    provincia: point?.provincia || "",
    pais: point?.pais || "Espa\u00f1a",
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    ventana: point?.ventana || "",
    fecha: fecha || "",
    hora: hora || "",
    tipo,
  };
}

async function getPortalPoint(client, req, pointId, tipo, clienteId = req.user?.cliente_id) {
  if (!pointId) return null;
  const { rows } = await client.query(
    `SELECT id,nombre,direccion,ciudad,provincia,pais,lat,lng,tipo,ventana,cliente_id
       FROM puntos_interes
      WHERE id=$1 AND empresa_id=$2 AND activo=true
        AND (cliente_id=$3 OR cliente_id IS NULL)
        AND (tipo=$4 OR tipo='ambos')
      LIMIT 1`,
    [pointId, empresaId(req), clienteId || null, tipo]
  );
  return rows[0] || null;
}

async function nextPedidoNumero(client, empresaId) {
  const year = new Date().getFullYear();
  const prefix = `PED-${year}-`;
  await client.query(
    `INSERT INTO pedido_numero_counters (empresa_id, year, last_num)
     SELECT $1, $2,
            COALESCE(MAX(CASE WHEN numero ~ $3 THEN substring(numero from $3)::int ELSE 0 END), 0)
       FROM pedidos
      WHERE empresa_id=$1 AND numero LIKE $4
     ON CONFLICT (empresa_id, year) DO UPDATE
       SET last_num=GREATEST(pedido_numero_counters.last_num, EXCLUDED.last_num),
           updated_at=NOW()`,
    [empresaId, year, `^${prefix}([0-9]+)$`, `${prefix}%`]
  );
  const { rows } = await client.query(
    `UPDATE pedido_numero_counters
        SET last_num=last_num+1, updated_at=NOW()
      WHERE empresa_id=$1 AND year=$2
      RETURNING last_num`,
    [empresaId, year]
  );
  const next = Number(rows[0]?.last_num || 1);
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function publicBaseUrl(req) {
  const envUrl = process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "";
  const reqUrl = req?.protocol && typeof req.get === "function" ? `${req.protocol}://${req.get("host")}` : "";
  const isLocal = (value) => {
    try {
      const url = new URL(String(value || ""));
      return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    } catch {
      return false;
    }
  };
  if (envUrl && !(isLocal(envUrl) && reqUrl && !isLocal(reqUrl))) return envUrl;
  return reqUrl || "http://localhost";
}

function portalPedidoEventoLabel(tipo = "") {
  const labels = {
    "estado.actualizado": "Estado actualizado",
    "pedido.editado_estado": "Pedido actualizado",
    "pedido.completado": "Pedido completado",
    "factura.borrador_auto": "Factura preparada",
    "colaborador.precio_confirmado": "Precio confirmado",
    "colaborador.carga_confirmada": "Carga confirmada",
    "colaborador.en_camino_confirmado": "En camino",
    "colaborador.descarga_confirmada": "Descarga confirmada",
    "documento_control.consultado": "Documento digital consultado",
    "documento_control.descargado": "Documento digital descargado",
    "documento_control.impreso": "Documento digital impreso",
    "documento_control.compartido": "Documento digital compartido",
    "documento_control.remitido": "Documento digital remitido",
    "chofer_doc.subido": "Documento subido",
    "portal_cliente.soporte_descargado": "Soporte descargado por cliente",
    "portal_cliente.feed_integracion_exportado": "Feed EDI/API exportado",
  };
  return labels[tipo] || String(tipo || "Evento").replace(/[._]/g, " ");
}

function portalPedidoEventoResumen(evento = {}) {
  const d = evento.detalle || {};
  if (evento.tipo === "estado.actualizado") return [d.estado_anterior, d.estado].filter(Boolean).join(" -> ") || "";
  if (evento.tipo === "pedido.editado_estado") return [d.estado_anterior, d.estado_nuevo || d.estado].filter(Boolean).join(" -> ") || "";
  if (evento.tipo === "colaborador.descarga_confirmada") {
    const docs = Number(d.documentos || 0);
    return docs > 0 ? `${docs} documento(s) recibido(s)` : (d.notas || "");
  }
  if (evento.tipo === "colaborador.carga_confirmada" || evento.tipo === "colaborador.en_camino_confirmado") return d.notas || "";
  if (evento.tipo?.startsWith("documento_control.")) return d.codigo_control ? `Control ${d.codigo_control}` : "";
  if (evento.tipo === "factura.borrador_auto") return d.numero ? `Factura ${d.numero}` : "";
  if (evento.tipo === "chofer_doc.subido") return d.tipo ? `Tipo ${d.tipo}` : "";
  if (evento.tipo === "portal_cliente.soporte_descargado") return d.nombre ? String(d.nombre) : "";
  if (evento.tipo === "portal_cliente.feed_integracion_exportado") return d.export_id ? `Export ${d.export_id}` : "";
  return "";
}

async function getPortalPedidoDocumentoControlContext(req, pedidoId) {
  const { rows } = await db.query(
    `SELECT p.*,
            c.id AS cliente_ref_id, c.nombre AS cliente_nombre, c.cif AS cliente_cif, c.direccion AS cliente_direccion, c.cp AS cliente_cp, c.ciudad AS cliente_ciudad, NULL::text AS cliente_provincia, c.pais AS cliente_pais,
            co.id AS colaborador_ref_id, co.nombre AS colaborador_nombre, co.cif AS colaborador_cif,
            TRIM(BOTH ' ' FROM CONCAT_WS(' ', co.calle, co.num_ext)) AS colaborador_direccion, co.codigo_postal AS colaborador_cp, co.ciudad AS colaborador_ciudad, co.provincia AS colaborador_provincia, co.pais AS colaborador_pais
       FROM pedidos p
       LEFT JOIN clientes c ON c.id=p.cliente_id
       LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
      WHERE p.id=$1 AND p.empresa_id=$2 AND p.cliente_id=$3
      LIMIT 1`,
    [pedidoId, empresaId(req), req.user.cliente_id]
  );
  const pedido = rows[0];
  if (!pedido) return null;
  const empresaRes = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1 LIMIT 1", [empresaId(req)]);
  const perfil = empresaRes.rows[0]?.cfg_precios?.empresa_perfil || empresaRes.rows[0]?.cfg_precios || {};
  return {
    pedido,
    empresa: perfil || {},
    cliente: {
      id: pedido.cliente_ref_id,
      nombre: pedido.cliente_nombre,
      cif: pedido.cliente_cif,
      direccion: pedido.cliente_direccion,
      cp: pedido.cliente_cp,
      poblacion: pedido.cliente_ciudad,
      provincia: pedido.cliente_provincia,
      pais: pedido.cliente_pais,
    },
    colaborador: {
      id: pedido.colaborador_ref_id,
      nombre: pedido.colaborador_nombre,
      cif: pedido.colaborador_cif,
      direccion: pedido.colaborador_direccion,
      cp: pedido.colaborador_cp,
      poblacion: pedido.colaborador_ciudad,
      provincia: pedido.colaborador_provincia,
      pais: pedido.colaborador_pais,
    },
  };
}

async function addSolicitudEvento(client, req, solicitudId, tipo, detalle = {}) {
  await client.query(
    `INSERT INTO portal_solicitud_eventos
      (empresa_id,solicitud_id,tipo,actor_tipo,actor_id,detalle)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      empresaId(req),
      solicitudId,
      tipo,
      req.user?.rol || "usuario",
      req.user?.id || null,
      JSON.stringify(detalle),
    ]
  ).catch(() => {});
}

async function requireCliente(req, res, next) {
  if (!req.user?.cliente_id && req.user?.id && req.user?.empresa_id) {
    const { rows } = await db.query(
      `SELECT cliente_id
         FROM usuarios
        WHERE id=$1 AND empresa_id=$2 AND cliente_id IS NOT NULL
        LIMIT 1`,
      [req.user.id, empresaId(req)]
    ).catch(() => ({ rows: [] }));
    if (rows[0]?.cliente_id) req.user.cliente_id = rows[0].cliente_id;
  }
  if (!req.user?.cliente_id && req.user?.empresa_id && req.user?.email) {
    const { rows } = await db.query(
      `SELECT id
         FROM clientes
        WHERE empresa_id=$1
          AND (
            LOWER(TRIM(COALESCE(email,'')))=LOWER(TRIM($2))
            OR LOWER(TRIM(COALESCE(email_facturacion,'')))=LOWER(TRIM($2))
            OR POSITION(LOWER(TRIM($2)) IN LOWER(COALESCE(emails_albaranes,''))) > 0
          )
          AND COALESCE(activo,true)=true
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1`,
      [empresaId(req), req.user.email]
    ).catch(() => ({ rows: [] }));
    if (rows[0]?.id) req.user.cliente_id = rows[0].id;
  }
  const modulos = req.user?.permisos?.modulos || {};
  const hasPortalPermission = Boolean(
    modulos.portal_cliente?.ver ||
    modulos.portal_cliente?.editar ||
    modulos["portal-cliente"]?.ver ||
    modulos["portal-cliente"]?.editar
  );
  if (!["cliente", "cliente_portal"].includes(req.user?.rol) && !hasPortalPermission) {
    return res.status(403).json({ error: "Acceso exclusivo para portal cliente" });
  }
  if (!req.user?.cliente_id) {
    return res.status(403).json({ error: "Usuario cliente sin cliente vinculado" });
  }
  if (req.user?.integracion_token_id) {
    return res.status(403).json({
      error: "Token tecnico EDI/API limitado a endpoints de integracion",
      allowed_paths: ["/portal-cliente/integracion/manifest", "/portal-cliente/integracion/feed"],
    });
  }
  next();
}

function requireClienteIntegracion(scope) {
  return (req, res, next) => {
    if (!["cliente", "cliente_portal"].includes(req.user?.rol)) {
      return res.status(403).json({ error: "Acceso exclusivo para portal cliente" });
    }
    if (!req.user?.cliente_id) {
      return res.status(403).json({ error: "Usuario cliente sin cliente vinculado" });
    }
    if (!req.user?.integracion_token_id) return next();
    const scopes = Array.isArray(req.user.integracion_scopes) ? req.user.integracion_scopes : [];
    if (scopes.includes(scope)) {
      applyTechnicalRateLimitHeaders(req, res);
      return next();
    }
    return res.status(403).json({
      error: "Token tecnico EDI/API sin permiso para este recurso",
      scope_required: scope,
      scopes,
    });
  };
}

function applyTechnicalRateLimitHeaders(req, res) {
  if (!req.user?.integracion_token_id) return;
  const limit = Math.max(Number(req.user.integracion_rate_limit_per_hour || 0) || 0, 0);
  const remaining = Math.max(Number(req.user.integracion_rate_limit_remaining || 0) || 0, 0);
  const resetAt = req.user.integracion_rate_limit_reset_at || "";
  if (limit) res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  if (resetAt) res.setHeader("X-RateLimit-Reset", resetAt);
}

function requireGestion(req, res, next) {
  if (!["gerente", "trafico", "administrativo", "contable"].includes(req.user?.rol)) {
    return res.status(403).json({ error: "No tienes permisos para gestionar solicitudes de clientes" });
  }
  next();
}

function normalizeSolicitudEstado(value) {
  if (value === undefined || value === null || value === "") return null;
  const estado = String(value).trim().toLowerCase();
  return ["pendiente", "revisada", "convertida", "descartada", "rechazada", "cancelada"].includes(estado) ? estado : false;
}

function normalizeDecisionCliente(value) {
  if (value === undefined || value === null || value === "") return null;
  const decision = String(value).trim().toLowerCase();
  return ["pendiente", "aceptada", "rechazada"].includes(decision) ? decision : false;
}

function safeFilename(value, fallback = "albaran.pdf") {
  const cleaned = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function isAlbaranDoc(doc = {}) {
  const raw = `${doc.tipo || ""} ${doc.nombre || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return raw.includes("albar") || raw.includes("pod") || raw.includes("cmr");
}

async function logPedidoEventoCliente(req, pedidoId, tipo, detalle = {}) {
  await db.query(
    `INSERT INTO pedido_eventos (pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      pedidoId,
      empresaId(req),
      tipo,
      "cliente_portal",
      req.user?.id || null,
      JSON.stringify(detalle || {}),
    ]
  ).catch(() => {});
}

async function notificarNuevaSolicitud(req, solicitud) {
  const { rows } = await db.query(
    `SELECT id
      FROM usuarios
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND rol::text IN ('gerente','trafico','administrativo')
      LIMIT 20`,
    [empresaId(req)]
  ).catch(() => ({ rows: [] }));
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId(req),
    usuario_id: u.id,
    tipo: "portal_cliente_solicitud",
    titulo: "Nueva solicitud de cliente",
    mensaje: `${solicitud.cliente_nombre || "Cliente"} solicita ${solicitud.origen} -> ${solicitud.destino}`,
    data: { solicitud_id: solicitud.id, view: "solicitudes" },
    created_by: req.user?.id || null,
  }).catch(() => null)));
}

async function notificarSolicitudIntegracion(req, detalle = {}) {
  const { rows } = await db.query(
    `SELECT id
       FROM usuarios
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND rol::text IN ('gerente','trafico','administrativo')
      LIMIT 20`,
    [empresaId(req)]
  ).catch(() => ({ rows: [] }));
  const clienteNombre = req.user?.nombre || req.user?.email || "Cliente";
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId(req),
    usuario_id: u.id,
    tipo: "portal_cliente_integracion",
    titulo: "Solicitud de integracion EDI/API",
    mensaje: `${clienteNombre} solicita configurar intercambio EDI/API.`,
    data: { view: "clientes", cliente_id: req.user?.cliente_id || null, detalle },
    created_by: req.user?.id || null,
  }).catch(() => null)));
}

router.get("/resumen", requireCliente, async (req, res) => {
  try {
    await ensureSchema();
    const eid = empresaId(req);
    const cid = req.user.cliente_id;
    const [pedidos, facturas, documentos, solicitudes] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE estado::text NOT IN ('entregado','cancelado','facturado'))::int AS activos,
              COUNT(*) FILTER (WHERE estado::text IN ('en_curso','descarga'))::int AS en_curso,
              COUNT(*) FILTER (WHERE estado::text='entregado')::int AS entregados,
              MIN(fecha_carga) FILTER (
                WHERE estado::text NOT IN ('entregado','cancelado','facturado')
                  AND fecha_carga >= CURRENT_DATE
              ) AS proxima_carga
         FROM pedidos
        WHERE empresa_id=$1 AND cliente_id=$2`,
      [eid, cid]
    ),
    db.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(total),0)::numeric AS total_facturado,
              COUNT(*) FILTER (WHERE estado IN ('emitida','enviada','vencida','reclamada','sin_cobrar'))::int AS pendientes,
              COALESCE(SUM(total) FILTER (WHERE estado IN ('emitida','enviada','vencida','reclamada','sin_cobrar')),0)::numeric AS total_pendiente,
              COUNT(*) FILTER (
                WHERE estado IN ('emitida','enviada','vencida','reclamada','sin_cobrar')
                  AND fecha_vencimiento < CURRENT_DATE
              )::int AS vencidas,
              COALESCE(SUM(total) FILTER (
                WHERE estado IN ('emitida','enviada','vencida','reclamada','sin_cobrar')
                  AND fecha_vencimiento < CURRENT_DATE
              ),0)::numeric AS total_vencido
         FROM facturas
        WHERE empresa_id=$1 AND cliente_id=$2 AND estado <> 'borrador'`,
      [eid, cid]
    ),
    db.query(
      `WITH docs AS (
        SELECT p.id,
               COUNT(pd.id) FILTER (
                 WHERE LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                    OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                    OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                    OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                    OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                    OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
               )::int AS albaranes,
               COUNT(pd.id)::int AS documentos
          FROM pedidos p
          LEFT JOIN pedido_docs pd ON pd.pedido_id=p.id AND pd.empresa_id=p.empresa_id
         WHERE p.empresa_id=$1 AND p.cliente_id=$2
         GROUP BY p.id
      )
      SELECT COUNT(*)::int AS viajes,
             COUNT(*) FILTER (WHERE albaranes > 0)::int AS con_albaran,
             COUNT(*) FILTER (WHERE albaranes = 0)::int AS sin_albaran,
             COALESCE(SUM(documentos),0)::int AS documentos_total
        FROM docs`,
      [eid, cid]
    ),
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE estado IN ('pendiente','revisada'))::int AS abiertas,
              COUNT(*) FILTER (WHERE estado='convertida')::int AS convertidas,
              COUNT(*) FILTER (
                WHERE fecha_propuesta IS NOT NULL
                  AND COALESCE(decision_cliente,'pendiente')='pendiente'
              )::int AS propuestas_pendientes
         FROM portal_solicitudes_cliente
        WHERE empresa_id=$1 AND cliente_id=$2`,
      [eid, cid]
    ),
    ]);

    const p = pedidos.rows[0] || {};
    const f = facturas.rows[0] || {};
    const d = documentos.rows[0] || {};
    const s = solicitudes.rows[0] || {};
    const acciones = [];
    if (Number(s.propuestas_pendientes || 0) > 0) {
      acciones.push({
        tipo: "reprogramacion",
        prioridad: "alta",
        tab: "solicitudes",
        titulo: "Responder propuesta de reprogramacion",
        detalle: `${Number(s.propuestas_pendientes || 0)} propuesta(s) pendiente(s) de aceptar o rechazar`,
      });
    }
    if (Number(f.vencidas || 0) > 0) {
      acciones.push({
        tipo: "facturas_vencidas",
        prioridad: "alta",
        tab: "cuenta",
        titulo: "Revisar facturas vencidas",
        detalle: `${Number(f.vencidas || 0)} factura(s), ${Number(f.total_vencido || 0).toFixed(2)} EUR vencidos`,
      });
    }
    if (Number(d.sin_albaran || 0) > 0) {
      acciones.push({
        tipo: "documentos_pendientes",
        prioridad: "media",
        tab: "albaranes",
        titulo: "Comprobar albaranes pendientes",
        detalle: `${Number(d.sin_albaran || 0)} viaje(s) sin albaran visible todavia`,
      });
    }
    if (Number(p.en_curso || 0) > 0) {
      acciones.push({
        tipo: "viajes_en_curso",
        prioridad: "normal",
        tab: "seguimiento",
        titulo: "Seguir viajes en curso",
        detalle: `${Number(p.en_curso || 0)} viaje(s) en ruta o descarga`,
      });
    }

    res.json({
    generated_at: new Date().toISOString(),
    pedidos: {
      total: Number(p.total || 0),
      activos: Number(p.activos || 0),
      en_curso: Number(p.en_curso || 0),
      entregados: Number(p.entregados || 0),
      proxima_carga: p.proxima_carga || null,
    },
    facturas: {
      total: Number(f.total || 0),
      total_facturado: Number(f.total_facturado || 0),
      pendientes: Number(f.pendientes || 0),
      total_pendiente: Number(f.total_pendiente || 0),
      vencidas: Number(f.vencidas || 0),
      total_vencido: Number(f.total_vencido || 0),
    },
    documentos: {
      viajes: Number(d.viajes || 0),
      con_albaran: Number(d.con_albaran || 0),
      sin_albaran: Number(d.sin_albaran || 0),
      documentos_total: Number(d.documentos_total || 0),
    },
    solicitudes: {
      total: Number(s.total || 0),
      abiertas: Number(s.abiertas || 0),
      convertidas: Number(s.convertidas || 0),
      propuestas_pendientes: Number(s.propuestas_pendientes || 0),
    },
    acciones,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo cargar el resumen del portal cliente" });
  }
});

router.post("/integracion/solicitar", requireCliente, async (req, res) => {
  try {
    await ensureSchema();
    const detalle = {
      canal: String(req.body?.canal || "edi_api").slice(0, 60),
      notas: String(req.body?.notas || "").slice(0, 1000),
      requested_at: new Date().toISOString(),
    };
    await notificarSolicitudIntegracion(req, detalle);
    await db.query(
      `INSERT INTO audit_log_saas (actor_tipo,actor_id,actor_email,empresa_id,accion,detalle,ip)
       VALUES ('cliente',$1,$2,$3,'SOLICITUD portal_cliente.integracion_edi_api',$4,$5)`,
      [
        req.user?.id || null,
        req.user?.email || req.user?.username || null,
        empresaId(req),
        JSON.stringify({ cliente_id: req.user?.cliente_id || null, ...detalle }),
        req.ip || null,
      ]
    ).catch(() => {});
    res.json({ ok: true, message: "Solicitud de integracion registrada" });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo solicitar la integracion" });
  }
});

router.get("/pedidos", requireCliente, async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id,p.numero,p.referencia_cliente,p.origen,p.destino,p.fecha_carga,p.hora_carga,
            p.fecha_descarga,p.hora_descarga,p.fecha_entrega,p.mercancia,p.peso_kg,p.bultos,
            p.estado,p.ultima_posicion,p.posicion_ts,p.notas,
            v.matricula AS vehiculo_matricula,
            r.matricula AS remolque_matricula,
            COALESCE(p.matricula_colaborador,'') AS matricula_colaborador,
            COALESCE(p.remolque_matricula_colaborador,'') AS remolque_matricula_colaborador,
            COALESCE(v.ubicacion_actual, p.ultima_posicion) AS ubicacion_actual,
            v.gps_provider,
            ch.nombre AS chofer_nombre
       FROM pedidos p
       LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
       LEFT JOIN vehiculos r ON r.id=COALESCE(p.remolque_id, v.remolque_id) AND r.empresa_id=p.empresa_id
       LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
      WHERE p.empresa_id=$1 AND p.cliente_id=$2
      ORDER BY COALESCE(p.fecha_carga, p.fecha_pedido, p.created_at::date) DESC, p.created_at DESC
      LIMIT 200`,
    [empresaId(req), req.user.cliente_id]
  );
  res.json(rows);
});

router.get("/facturas", requireCliente, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id,numero,serie,fecha,fecha_vencimiento,base_imponible,cuota_iva,total,estado,created_at
       FROM facturas
      WHERE empresa_id=$1 AND cliente_id=$2 AND estado <> 'borrador'
      ORDER BY fecha DESC, created_at DESC
      LIMIT 100`,
    [empresaId(req), req.user.cliente_id]
  );
  res.json(rows);
});

router.get("/facturas/:id", requireCliente, async (req, res) => {
  const eid = empresaId(req);
  const factura = await db.query(
    `SELECT id,numero,serie,fecha,fecha_vencimiento,base_imponible,cuota_iva,total,estado,
            forma_pago,observaciones,created_at
       FROM facturas
      WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3 AND estado <> 'borrador'
      LIMIT 1`,
    [req.params.id, eid, req.user.cliente_id]
  );
  if (!factura.rows[0]) return res.status(404).json({ error: "Factura no encontrada" });

  const [lineas, extracostes, pedidos, documentos, albaranes] = await Promise.all([
    db.query(
      `SELECT id,concepto,cantidad,precio_unit,orden
         FROM factura_lineas
        WHERE factura_id=$1
        ORDER BY orden ASC, id ASC`,
      [req.params.id]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT id,tipo,concepto,importe
         FROM factura_extracostes
        WHERE factura_id=$1
        ORDER BY id ASC`,
      [req.params.id]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT p.id,p.numero,p.origen,p.destino,p.fecha_carga,p.fecha_descarga
         FROM factura_pedidos fp
         JOIN pedidos p ON p.id=fp.pedido_id AND p.empresa_id=$2 AND p.cliente_id=$3
        WHERE fp.factura_id=$1
        ORDER BY p.fecha_carga NULLS LAST, p.numero`,
      [req.params.id, eid, req.user.cliente_id]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT id,nombre,tipo,file_base64,file_mime,created_at
         FROM factura_docs
        WHERE factura_id=$1 AND empresa_id=$2
        ORDER BY created_at DESC`,
      [req.params.id, eid]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT d.id,d.nombre,d.tipo,d.file_mime,d.file_size_kb,d.created_at,
              p.id AS pedido_id,p.numero AS pedido_numero
         FROM factura_pedidos fp
         JOIN pedidos p ON p.id=fp.pedido_id AND p.empresa_id=$2 AND p.cliente_id=$3
         JOIN pedido_docs d ON d.pedido_id=p.id AND d.empresa_id=p.empresa_id
        WHERE fp.factura_id=$1
          AND (
            LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
            OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
            OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
            OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
            OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
            OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
          )
        ORDER BY p.fecha_carga NULLS LAST, p.numero, d.created_at DESC`,
      [req.params.id, eid, req.user.cliente_id]
    ).catch(() => ({ rows: [] })),
  ]);

  res.json({
    ...factura.rows[0],
    lineas: lineas.rows,
    extracostes: extracostes.rows,
    pedidos: pedidos.rows,
    documentos: documentos.rows,
    albaranes: albaranes.rows.map(row => ({
      ...row,
      download_url: `/api/v1/portal-cliente/pedidos/${encodeURIComponent(row.pedido_id)}/albaranes/${encodeURIComponent(row.id)}/descargar`,
    })),
  });
});

router.get("/documentos-resumen", requireCliente, async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id AS pedido_id,
            p.numero,
            p.referencia_cliente,
            p.fecha_carga,
            p.estado,
            COUNT(pd.id)::int AS documentos_count,
            COUNT(pd.id) FILTER (
              WHERE LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                 OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                 OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
            )::int AS albaranes_count,
            MAX(pd.created_at) AS ultimo_documento_at,
            COUNT(fd.id)::int AS documentos_factura_count
       FROM pedidos p
       LEFT JOIN pedido_docs pd ON pd.pedido_id=p.id AND pd.empresa_id=p.empresa_id
       LEFT JOIN factura_pedidos fp ON fp.pedido_id=p.id
       LEFT JOIN facturas f ON f.id=fp.factura_id AND f.empresa_id=p.empresa_id AND f.estado <> 'borrador'
       LEFT JOIN factura_docs fd ON fd.factura_id=f.id AND fd.empresa_id=p.empresa_id
      WHERE p.empresa_id=$1 AND p.cliente_id=$2
      GROUP BY p.id,p.numero,p.referencia_cliente,p.fecha_carga,p.estado
      ORDER BY COALESCE(p.fecha_carga,p.created_at::date) DESC, p.numero DESC
      LIMIT 200`,
    [empresaId(req), req.user.cliente_id]
  );
  const resumen = rows.map(row => ({
    ...row,
    completo: Number(row.albaranes_count || 0) > 0,
  }));
  res.json({
    pedidos: resumen,
    total: resumen.length,
    con_albaran: resumen.filter(r => Number(r.albaranes_count || 0) > 0).length,
    sin_albaran: resumen.filter(r => Number(r.albaranes_count || 0) === 0).length,
    documentos_total: resumen.reduce((s, r) => s + Number(r.documentos_count || 0), 0),
  });
});

router.get("/integracion/manifest", requireClienteIntegracion("manifest"), async (req, res) => {
  try {
    const base = String(publicBaseUrl(req) || "").replace(/\/$/, "");
    const eid = empresaId(req);
    const cid = req.user.cliente_id;
    const clienteRes = await db.query(
      "SELECT id,nombre,cif,email FROM clientes WHERE id=$1 AND empresa_id=$2 LIMIT 1",
      [cid, eid]
    ).catch(() => ({ rows: [] }));
    const generatedAt = new Date().toISOString();
    const manifest = {
      schema: "transgest.portal_cliente.manifest.v1",
      generated_at: generatedAt,
      cliente: {
        id: clienteRes.rows[0]?.id || cid,
        nombre: clienteRes.rows[0]?.nombre || "",
        cif: clienteRes.rows[0]?.cif || "",
      },
      api: {
        base_url: `${base}/api/v1`,
        auth: {
          type: "Bearer JWT o token tecnico tedi_",
          header: "Authorization: Bearer <token>",
          technical_token_prefix: "tedi_",
          note: "Usar credenciales del portal cliente o token tecnico revocable emitido desde la ficha del cliente.",
        },
        rate_limit_hint: "Evitar mas de 1 sincronizacion completa cada 15 minutos por cliente. Para integracion recurrente usar since/next_cursor.",
        rate_limit_headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
        rate_limit_current: req.user?.integracion_token_id ? {
          limit_per_hour: Number(req.user.integracion_rate_limit_per_hour || 0),
          remaining_current_window: Number(req.user.integracion_rate_limit_remaining || 0),
          reset_at: req.user.integracion_rate_limit_reset_at || null,
        } : undefined,
      },
      endpoints: {
        feed: {
          method: "GET",
          path: "/portal-cliente/integracion/feed",
          url: `${base}/api/v1/portal-cliente/integracion/feed`,
          query: {
            days: { type: "integer", default: 90, min: 1, max: 365, description: "Ventana maxima de datos a revisar." },
            since: { type: "ISO datetime", required: false, description: "Cursor incremental. Si se informa, devuelve cambios desde esa fecha." },
          },
          sync: {
            supports_delta: true,
            cursor_field: "sync.next_cursor",
            recommended_flow: [
              "Primera llamada sin since o con days amplio.",
              "Guardar sync.next_cursor.",
              "Siguientes llamadas con since=<cursor_guardado>.",
            ],
          },
        },
        factura_detalle: {
          method: "GET",
          path: "/portal-cliente/facturas/{id}",
        },
        albaran_descarga: {
          method: "GET",
          path: "/portal-cliente/pedidos/{pedido_id}/albaranes/{documento_id}/descargar",
          note: "Solo disponible para documentos identificados como albaran/POD/CMR descargables.",
        },
      },
      contract: {
        feed_schema: "transgest.portal_cliente.feed.v1",
        top_level_fields: ["schema", "export_id", "generated_at", "window_days", "sync", "cliente", "counts", "governance", "shipments", "invoices", "integrity_hash_sha256"],
        shipment_fields: ["id", "numero", "referencia_cliente", "estado", "origen", "destino", "fechas", "mercancia", "tracking", "documentos", "updated_at"],
        invoice_fields: ["id", "numero", "serie", "fecha", "fecha_vencimiento", "estado", "importes", "pedido_ids", "detail_url", "updated_at"],
        document_fields: ["id", "nombre", "tipo", "mime", "size_kb", "created_at", "download_url"],
        status_values_hint: ["pendiente", "confirmado", "en_curso", "descarga", "entregado", "facturado", "incidencia", "cancelado"],
      },
      governance: {
        authenticated: true,
        tenant_isolation: "cliente_autenticado",
        includes_binary_content: false,
        includes_secrets: false,
        integrity: "Cada feed incluye integrity_hash_sha256 calculado sobre el payload sin contenido binario.",
        audit: "Cada export de feed queda registrado como EXPORT portal_cliente.integracion_feed en auditoria SaaS.",
      },
      examples: {
        full_window: `${base}/api/v1/portal-cliente/integracion/feed?days=90`,
        delta: `${base}/api/v1/portal-cliente/integracion/feed?days=365&since=${encodeURIComponent(generatedAt)}`,
      },
    };
    manifest.integrity_hash_sha256 = crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    res.setHeader("Cache-Control", "private, no-store");
    res.json(manifest);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo generar el manifiesto de integracion" });
  }
});

router.get("/integracion/feed", requireClienteIntegracion("feed"), async (req, res) => {
  try {
    const eid = empresaId(req);
    const cid = req.user.cliente_id;
    const days = Math.min(Math.max(Number(req.query.days || 90) || 90, 1), 365);
    const sinceRaw = String(req.query.since || "").trim();
    let sinceIso = null;
    if (sinceRaw) {
      const sinceDate = new Date(sinceRaw);
      if (Number.isNaN(sinceDate.getTime())) {
        return res.status(400).json({ error: "Parametro since invalido. Usa fecha ISO, por ejemplo 2026-06-02T08:00:00.000Z" });
      }
      sinceIso = sinceDate.toISOString();
    }
    const exportId = `FEED-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const [clienteRes, pedidosRes, docsRes, facturasRes, facturaPedidosRes] = await Promise.all([
      db.query(
        "SELECT id,nombre,cif,email,telefono FROM clientes WHERE id=$1 AND empresa_id=$2 LIMIT 1",
        [cid, eid]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT p.id,p.numero,p.referencia_cliente,p.origen,p.destino,p.fecha_pedido,p.fecha_carga,p.hora_carga,
                p.fecha_descarga,p.hora_descarga,p.fecha_entrega,p.mercancia,p.peso_kg,p.bultos,p.estado::text AS estado,
                p.ultima_posicion,p.posicion_ts,p.created_at,p.updated_at,
                v.matricula AS vehiculo_matricula,
                COALESCE(v.ubicacion_actual,p.ultima_posicion) AS ubicacion_actual
           FROM pedidos p
          LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
          WHERE p.empresa_id=$1 AND p.cliente_id=$2
            AND COALESCE(p.fecha_carga,p.created_at::date) >= CURRENT_DATE - ($3::int * INTERVAL '1 day')
            AND ($4::timestamptz IS NULL OR COALESCE(p.updated_at,p.created_at) >= $4::timestamptz)
          ORDER BY COALESCE(p.fecha_carga,p.created_at::date) DESC, p.created_at DESC
          LIMIT 250`,
        [eid, cid, days, sinceIso]
      ),
      db.query(
        `SELECT pd.id,pd.pedido_id,pd.nombre,pd.tipo,pd.file_mime,pd.file_size_kb,pd.created_at
           FROM pedido_docs pd
           JOIN pedidos p ON p.id=pd.pedido_id AND p.empresa_id=pd.empresa_id
          WHERE pd.empresa_id=$1 AND p.cliente_id=$2
            AND COALESCE(p.fecha_carga,p.created_at::date) >= CURRENT_DATE - ($3::int * INTERVAL '1 day')
            AND ($4::timestamptz IS NULL OR pd.created_at >= $4::timestamptz)
          ORDER BY pd.created_at DESC
          LIMIT 1000`,
        [eid, cid, days, sinceIso]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT id,numero,serie,fecha,fecha_vencimiento,base_imponible,cuota_iva,total,estado,created_at,updated_at
           FROM facturas
          WHERE empresa_id=$1 AND cliente_id=$2 AND estado <> 'borrador'
            AND COALESCE(fecha,created_at::date) >= CURRENT_DATE - ($3::int * INTERVAL '1 day')
            AND ($4::timestamptz IS NULL OR COALESCE(updated_at,created_at) >= $4::timestamptz)
          ORDER BY COALESCE(fecha,created_at::date) DESC, created_at DESC
          LIMIT 250`,
        [eid, cid, days, sinceIso]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT fp.factura_id,fp.pedido_id
           FROM factura_pedidos fp
           JOIN facturas f ON f.id=fp.factura_id AND f.empresa_id=$1 AND f.cliente_id=$2 AND f.estado <> 'borrador'
          WHERE COALESCE(f.fecha,f.created_at::date) >= CURRENT_DATE - ($3::int * INTERVAL '1 day')
            AND ($4::timestamptz IS NULL OR COALESCE(f.updated_at,f.created_at) >= $4::timestamptz)`,
        [eid, cid, days, sinceIso]
      ).catch(() => ({ rows: [] })),
    ]);
    const docsByPedido = new Map();
    (docsRes.rows || []).forEach(doc => {
      const list = docsByPedido.get(String(doc.pedido_id)) || [];
      list.push({
        id: doc.id,
        nombre: doc.nombre || "",
        tipo: doc.tipo || "",
        mime: doc.file_mime || "",
        size_kb: Number(doc.file_size_kb || 0),
        created_at: doc.created_at || null,
        download_url: isAlbaranDoc(doc) ? `/api/v1/portal-cliente/pedidos/${encodeURIComponent(doc.pedido_id)}/albaranes/${encodeURIComponent(doc.id)}/descargar` : "",
      });
      docsByPedido.set(String(doc.pedido_id), list);
    });
    const pedidosByFactura = new Map();
    (facturaPedidosRes.rows || []).forEach(row => {
      const list = pedidosByFactura.get(String(row.factura_id)) || [];
      list.push(row.pedido_id);
      pedidosByFactura.set(String(row.factura_id), list);
    });
    const shipments = (pedidosRes.rows || []).map(p => ({
      id: p.id,
      numero: p.numero || "",
      referencia_cliente: p.referencia_cliente || "",
      estado: p.estado || "",
      origen: p.origen || "",
      destino: p.destino || "",
      fechas: {
        pedido: p.fecha_pedido || null,
        carga: p.fecha_carga || null,
        hora_carga: p.hora_carga || "",
        descarga: p.fecha_descarga || p.fecha_entrega || null,
        hora_descarga: p.hora_descarga || "",
      },
      mercancia: { descripcion: p.mercancia || "", peso_kg: Number(p.peso_kg || 0), bultos: Number(p.bultos || 0) },
      tracking: { ubicacion_actual: p.ubicacion_actual || "", ultima_posicion: p.ultima_posicion || "", posicion_ts: p.posicion_ts || null, vehiculo_matricula: p.vehiculo_matricula || "" },
      documentos: docsByPedido.get(String(p.id)) || [],
      updated_at: p.updated_at || p.created_at || null,
    }));
    const invoices = (facturasRes.rows || []).map(f => ({
      id: f.id,
      numero: f.numero || "",
      serie: f.serie || "",
      fecha: f.fecha || null,
      fecha_vencimiento: f.fecha_vencimiento || null,
      estado: f.estado || "",
      importes: {
        base_imponible: Number(f.base_imponible || 0),
        cuota_iva: Number(f.cuota_iva || 0),
        total: Number(f.total || 0),
      },
      pedido_ids: pedidosByFactura.get(String(f.id)) || [],
      detail_url: `/api/v1/portal-cliente/facturas/${encodeURIComponent(f.id)}`,
      updated_at: f.updated_at || f.created_at || null,
    }));
    const generatedAt = new Date().toISOString();
    const payload = {
      schema: "transgest.portal_cliente.feed.v1",
      export_id: exportId,
      generated_at: generatedAt,
      window_days: days,
      sync: {
        mode: sinceIso ? "delta" : "window",
        since: sinceIso,
        next_cursor: generatedAt,
        supports_delta: true,
        filtered_by: sinceIso ? "updated_at_or_created_at" : "window_days",
      },
      cliente: {
        id: clienteRes.rows[0]?.id || cid,
        nombre: clienteRes.rows[0]?.nombre || "",
        cif: clienteRes.rows[0]?.cif || "",
      },
      counts: { shipments: shipments.length, invoices: invoices.length, documents: (docsRes.rows || []).length },
      governance: {
        authenticated: true,
        actor: "cliente_portal",
        data_scope: "cliente_autenticado",
        includes_binary_content: false,
        max_window_days: 365,
        retention_hint: "Conservar segun contrato con el cliente y politica interna de proteccion de datos.",
      },
      shipments,
      invoices,
    };
    payload.integrity_hash_sha256 = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await Promise.all(shipments.slice(0, 50).map(p => logPedidoEventoCliente(req, p.id, "portal_cliente.feed_integracion_exportado", {
      export_id: exportId,
      schema: payload.schema,
      window_days: days,
    })));
    await db.query(
      `INSERT INTO audit_log_saas (actor_tipo,actor_id,actor_email,empresa_id,accion,detalle,ip)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        "cliente_portal",
        req.user?.id || null,
        req.user?.email || req.user?.username || null,
        eid,
        "EXPORT portal_cliente.integracion_feed",
        JSON.stringify({
          export_id: exportId,
          schema: payload.schema,
          cliente_id: cid,
          window_days: days,
          sync_mode: payload.sync.mode,
          since: sinceIso,
          next_cursor: payload.sync.next_cursor,
          counts: payload.counts,
          integrity_hash_sha256: payload.integrity_hash_sha256,
          request_id: req.id || null,
          status: 200,
        }),
        req.ip || null,
      ]
    ).catch(() => {});
    res.setHeader("Cache-Control", "private, no-store");
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo generar el feed de integracion del portal cliente" });
  }
});

router.get("/pedidos/:id/albaranes", requireCliente, async (req, res) => {
  const pedido = await db.query(
    "SELECT id FROM pedidos WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3",
    [req.params.id, empresaId(req), req.user.cliente_id]
  );
  if (!pedido.rows[0]) return res.status(404).json({ error: "Pedido no encontrado" });
  const { rows } = await db.query(
    `SELECT id,nombre,tipo,file_mime,file_size_kb,file_base64,notas,created_at
       FROM pedido_docs
      WHERE pedido_id=$1 AND empresa_id=$2
        AND (
          LOWER(COALESCE(tipo,'')) LIKE '%albar%'
          OR LOWER(COALESCE(nombre,'')) LIKE '%albar%'
          OR LOWER(COALESCE(tipo,'')) LIKE '%pod%'
          OR LOWER(COALESCE(nombre,'')) LIKE '%pod%'
          OR LOWER(COALESCE(tipo,'')) LIKE '%cmr%'
          OR LOWER(COALESCE(nombre,'')) LIKE '%cmr%'
        )
      ORDER BY created_at DESC`,
    [req.params.id, empresaId(req)]
  );
  res.json(rows.map(row => ({
    ...row,
    download_url: `/api/v1/portal-cliente/pedidos/${encodeURIComponent(req.params.id)}/albaranes/${encodeURIComponent(row.id)}/descargar`,
  })));
});

router.get("/pedidos/:id/albaranes/:docId/descargar", requireCliente, async (req, res) => {
  const pedido = await db.query(
    "SELECT id FROM pedidos WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3",
    [req.params.id, empresaId(req), req.user.cliente_id]
  );
  if (!pedido.rows[0]) return res.status(404).send("Pedido no encontrado");
  const { rows } = await db.query(
    `SELECT id,nombre,tipo,file_mime,file_base64
       FROM pedido_docs
      WHERE id=$1 AND pedido_id=$2 AND empresa_id=$3
      LIMIT 1`,
    [req.params.docId, req.params.id, empresaId(req)]
  );
  const doc = rows[0];
  if (!doc || !isAlbaranDoc(doc) || !doc.file_base64) return res.status(404).send("Albaran no disponible");
  await logPedidoEventoCliente(req, req.params.id, "portal_cliente.soporte_descargado", {
    documento_id: doc.id,
    nombre: doc.nombre || "",
    tipo: doc.tipo || "",
  });
  res.setHeader("Content-Type", doc.file_mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(doc.nombre || "albaran.pdf")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(Buffer.from(String(doc.file_base64 || ""), "base64"));
});

router.get("/pedidos/:id/eventos", requireCliente, async (req, res) => {
  const pedido = await db.query(
    "SELECT id FROM pedidos WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3",
    [req.params.id, empresaId(req), req.user.cliente_id]
  );
  if (!pedido.rows[0]) return res.status(404).json({ error: "Pedido no encontrado" });

  const { rows } = await db.query(
    `SELECT id,tipo,actor_tipo,created_at,detalle
       FROM pedido_eventos
      WHERE pedido_id=$1 AND empresa_id=$2
      ORDER BY created_at DESC
      LIMIT 80`,
    [req.params.id, empresaId(req)]
  );

  res.json(rows.map(row => ({
    id: row.id,
    tipo: row.tipo,
    etiqueta: portalPedidoEventoLabel(row.tipo),
    resumen: portalPedidoEventoResumen(row),
    actor_tipo: row.actor_tipo,
    created_at: row.created_at,
  })));
});

router.get("/pedidos/:id/documento-control", requireCliente, async (req, res) => {
  const ctx = await getPortalPedidoDocumentoControlContext(req, req.params.id);
  if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json(buildDocumentoControlPublicPayload(buildDocumentoControlPayload({
    empresaId: empresaId(req),
    pedido: ctx.pedido,
    empresa: ctx.empresa,
    cliente: ctx.cliente,
    colaborador: ctx.colaborador,
    appBaseUrl: publicBaseUrl(req),
  })));
});

router.get("/puntos", requireCliente, asyncRoute(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id,nombre,direccion,codigo_postal,ciudad,provincia,pais,lat,lng,tipo,ventana,
            contacto_nombre,contacto_telefono,email,notas,cliente_id
       FROM puntos_interes
      WHERE empresa_id=$1 AND activo=true
        AND (cliente_id=$2 OR cliente_id IS NULL)
      ORDER BY CASE WHEN cliente_id=$2 THEN 0 ELSE 1 END, nombre ASC
      LIMIT 250`,
    [empresaId(req), req.user.cliente_id]
  );
  res.json(rows.map(row => ({ ...row, es_general: !row.cliente_id })));
}));

router.post("/puntos", requireCliente, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const tipo = ["carga", "descarga", "ambos"].includes(String(body.tipo || "").toLowerCase())
    ? String(body.tipo).toLowerCase()
    : "ambos";
  const direccion = String(body.direccion || body.ciudad || body.nombre || "").trim();
  const nombre = String(body.nombre || body.ciudad || direccion).trim();
  if (!nombre || !direccion) {
    return res.status(400).json({ error: "Indica un nombre y una direccion o poblacion" });
  }

  const { rows } = await db.query(
    `INSERT INTO puntos_interes
      (empresa_id,cliente_id,nombre,direccion,codigo_postal,ciudad,provincia,pais,lat,lng,tipo,ventana,
       contacto_nombre,contacto_telefono,email,notas,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'{}'::jsonb)
     RETURNING id,nombre,direccion,codigo_postal,ciudad,provincia,pais,lat,lng,tipo,ventana,
               contacto_nombre,contacto_telefono,email,notas,cliente_id`,
    [
      empresaId(req),
      req.user.cliente_id,
      nombre,
      direccion,
      body.codigo_postal || null,
      body.ciudad || null,
      body.provincia || null,
      body.pais || "Espa\u00f1a",
      normalizeNumeric(body.lat),
      normalizeNumeric(body.lng),
      tipo,
      body.ventana || null,
      body.contacto_nombre || null,
      body.contacto_telefono || null,
      body.email || null,
      body.notas || null,
    ]
  );
  res.status(201).json({ ...rows[0], es_general: false });
}));

router.get("/solicitudes", requireCliente, asyncRoute(async (req, res) => {
  await ensureSchema();
  const { rows } = await db.query(
    `SELECT s.*, p.numero AS pedido_numero,
            v.matricula AS vehiculo_matricula,
            r.matricula AS remolque_matricula,
            COALESCE(p.matricula_colaborador,'') AS matricula_colaborador,
            COALESCE(p.remolque_matricula_colaborador,'') AS remolque_matricula_colaborador,
            COALESCE(ev.eventos_count,0)::int AS eventos_count,
            ev.ultimo_evento_at
       FROM portal_solicitudes_cliente s
       LEFT JOIN pedidos p ON p.id=s.pedido_id AND p.empresa_id=s.empresa_id
       LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
       LEFT JOIN vehiculos r ON r.id=COALESCE(p.remolque_id, v.remolque_id) AND r.empresa_id=p.empresa_id
       LEFT JOIN (
         SELECT solicitud_id, empresa_id, COUNT(*) AS eventos_count, MAX(created_at) AS ultimo_evento_at
           FROM portal_solicitud_eventos
          WHERE empresa_id=$1
          GROUP BY solicitud_id, empresa_id
       ) ev ON ev.solicitud_id=s.id AND ev.empresa_id=s.empresa_id
      WHERE s.empresa_id=$1 AND s.cliente_id=$2
      ORDER BY s.created_at DESC
      LIMIT 100`,
    [empresaId(req), req.user.cliente_id]
  );
  res.json(rows);
}));

router.get("/solicitudes/:id/eventos", requireCliente, asyncRoute(async (req, res) => {
  await ensureSchema();
  const solicitud = await db.query(
    "SELECT id FROM portal_solicitudes_cliente WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3",
    [req.params.id, empresaId(req), req.user.cliente_id]
  );
  if (!solicitud.rows[0]) return res.status(404).json({ error: "Solicitud no encontrada" });
  const { rows } = await db.query(
    `SELECT id,tipo,actor_tipo,detalle,created_at
       FROM portal_solicitud_eventos
      WHERE solicitud_id=$1 AND empresa_id=$2
      ORDER BY created_at DESC
      LIMIT 60`,
    [req.params.id, empresaId(req)]
  );
  res.json(rows);
}));

router.post("/solicitudes", requireCliente, asyncRoute(async (req, res) => {
  await ensureSchema();
  const body = req.body || {};
  const [origenPunto, destinoPunto] = await Promise.all([
    getPortalPoint(db, req, body.origen_punto_id, "carga"),
    getPortalPoint(db, req, body.destino_punto_id, "descarga"),
  ]);
  if (body.origen_punto_id && !origenPunto) return res.status(400).json({ error: "El punto de carga no pertenece a este cliente" });
  if (body.destino_punto_id && !destinoPunto) return res.status(400).json({ error: "El punto de descarga no pertenece a este cliente" });
  const origen = origenPunto ? portalPointLabel(origenPunto, body.origen) : String(body.origen || "").trim();
  const destino = destinoPunto ? portalPointLabel(destinoPunto, body.destino) : String(body.destino || "").trim();
  if (!origen || !destino) return res.status(400).json({ error: "Origen y destino son obligatorios" });
  const cliente = await db.query(
    "SELECT id,nombre FROM clientes WHERE id=$1 AND empresa_id=$2",
    [req.user.cliente_id, empresaId(req)]
  );
  if (!cliente.rows[0]) return res.status(404).json({ error: "Cliente no encontrado" });
  const duplicada = await db.query(
    `SELECT s.*, p.numero AS pedido_numero
       FROM portal_solicitudes_cliente s
       LEFT JOIN pedidos p ON p.id=s.pedido_id
      WHERE s.empresa_id=$1
        AND s.cliente_id=$2
        AND s.estado IN ('pendiente','revisada')
        AND LOWER(TRIM(s.origen))=LOWER(TRIM($3))
        AND LOWER(TRIM(s.destino))=LOWER(TRIM($4))
        AND COALESCE(s.fecha_carga::text,'')=COALESCE($5::text,'')
        AND COALESCE(LOWER(TRIM(s.referencia_cliente)),'')=COALESCE(LOWER(TRIM($6)),'')
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [
      empresaId(req),
      req.user.cliente_id,
      origen,
      destino,
      body.fecha_carga || body.fecha || null,
      body.referencia_cliente || null,
    ]
  );
  if (duplicada.rows[0]) {
    return res.status(200).json({ ...duplicada.rows[0], duplicada: true });
  }
  const { rows } = await db.query(
    `INSERT INTO portal_solicitudes_cliente
      (empresa_id,cliente_id,solicitado_por,origen,destino,fecha_carga,hora_carga,fecha_descarga,hora_descarga,
       mercancia,peso_kg,bultos,importe,referencia_cliente,notas,origen_punto_id,destino_punto_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      empresaId(req),
      req.user.cliente_id,
      req.user.id,
      origen,
      destino,
      body.fecha_carga || body.fecha || null,
      normalizeTime(body.hora_carga),
      body.fecha_descarga || null,
      normalizeTime(body.hora_descarga),
      body.mercancia || null,
      normalizeNonNegativeNumeric(body.peso_kg ?? body.peso),
      normalizePositiveInteger(body.bultos),
      normalizeNonNegativeNumeric(body.importe ?? body.precio),
      body.referencia_cliente || null,
      body.notas || null,
      origenPunto?.id || null,
      destinoPunto?.id || null,
    ]
  );
  const solicitud = { ...rows[0], cliente_nombre: cliente.rows[0].nombre };
  await db.transaction(async (client) => {
    await addSolicitudEvento(client, req, solicitud.id, "solicitud.creada", {
      origen: solicitud.origen,
      destino: solicitud.destino,
      fecha_carga: solicitud.fecha_carga,
      referencia_cliente: solicitud.referencia_cliente,
    });
  }).catch(() => {});
  notificarNuevaSolicitud(req, solicitud).catch(() => {});
  res.status(201).json(solicitud);
}));

router.post("/solicitudes/:id/reprogramacion", requireCliente, asyncRoute(async (req, res) => {
  await ensureSchema();
  const decision = String(req.body?.decision || "").toLowerCase();
  if (!["aceptada", "rechazada"].includes(decision)) {
    return res.status(400).json({ error: "Decision no valida" });
  }
  let result;
  await db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT *
         FROM portal_solicitudes_cliente
        WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3
        FOR UPDATE`,
      [req.params.id, empresaId(req), req.user.cliente_id]
    );
    const solicitud = rows[0];
    if (!solicitud) {
      result = { status: 404, body: { error: "Solicitud no encontrada" } };
      return;
    }
    if (!solicitud.fecha_propuesta) {
      result = { status: 400, body: { error: "No hay una propuesta pendiente para esta solicitud" } };
      return;
    }

    const aceptada = decision === "aceptada";
    const nuevaRespuesta = aceptada
      ? `El cliente ha aceptado la nueva fecha propuesta: ${solicitud.fecha_propuesta}${solicitud.hora_propuesta ? ` ${solicitud.hora_propuesta}` : ""}.`
      : `El cliente ha rechazado la nueva fecha propuesta: ${solicitud.fecha_propuesta}${solicitud.hora_propuesta ? ` ${solicitud.hora_propuesta}` : ""}.`;
    const nuevoEstado = aceptada ? "revisada" : "pendiente";
    const updated = await client.query(
      `UPDATE portal_solicitudes_cliente
          SET decision_cliente=$1,
              decision_cliente_at=NOW(),
              estado=$2,
              respuesta=$3,
              updated_at=NOW()
        WHERE id=$4 AND empresa_id=$5
        RETURNING *`,
      [decision, nuevoEstado, nuevaRespuesta, solicitud.id, empresaId(req)]
    );
    await addSolicitudEvento(client, req, solicitud.id, "solicitud.reprogramacion.cliente", {
      decision,
      fecha_propuesta: solicitud.fecha_propuesta,
      hora_propuesta: solicitud.hora_propuesta,
    });
    result = { status: 200, body: updated.rows[0] };
  });
  res.status(result.status).json(result.body);
}));

router.post("/solicitudes/:id/precio", requireCliente, asyncRoute(async (req, res) => {
  await ensureSchema();
  const decision = String(req.body?.decision || "").trim().toLowerCase();
  if (!["aceptada", "rechazada"].includes(decision)) {
    return res.status(400).json({ error: "Decision de precio no valida" });
  }

  let result;
  await db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM portal_solicitudes_cliente
        WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3
        FOR UPDATE`,
      [req.params.id, empresaId(req), req.user.cliente_id]
    );
    const solicitud = rows[0];
    if (!solicitud) {
      result = { status: 404, body: { error: "Solicitud no encontrada" } };
      return;
    }
    if (["convertida", "rechazada", "descartada", "cancelada"].includes(String(solicitud.estado || "").toLowerCase())) {
      result = { status: 409, body: { error: "La solicitud ya esta cerrada y no admite cambios de precio" } };
      return;
    }
    if (normalizeNonNegativeNumeric(solicitud.importe_contraoferta) === null) {
      result = { status: 400, body: { error: "No hay una contraoferta pendiente" } };
      return;
    }
    if (solicitud.decision_precio === decision) {
      result = { status: 200, body: solicitud };
      return;
    }
    if (solicitud.decision_precio && solicitud.decision_precio !== "pendiente") {
      result = { status: 409, body: { error: "Esta contraoferta ya fue respondida" } };
      return;
    }

    const accepted = decision === "aceptada";
    const respuesta = accepted
      ? `El cliente ha aceptado el precio propuesto de ${Number(solicitud.importe_contraoferta).toFixed(2)} EUR.`
      : `El cliente ha rechazado el precio propuesto de ${Number(solicitud.importe_contraoferta).toFixed(2)} EUR.`;
    const updated = await client.query(
      `UPDATE portal_solicitudes_cliente
          SET decision_precio=$1,
              decision_precio_at=NOW(),
              importe=CASE WHEN $1='aceptada' THEN importe_contraoferta ELSE importe END,
              respuesta=$2,
              updated_at=NOW()
        WHERE id=$3 AND empresa_id=$4
        RETURNING *`,
      [decision, respuesta, solicitud.id, empresaId(req)]
    );
    await addSolicitudEvento(client, req, solicitud.id, `solicitud.precio.${decision}`, {
      importe_cliente: normalizeNonNegativeNumeric(solicitud.importe),
      importe_contraoferta: normalizeNonNegativeNumeric(solicitud.importe_contraoferta),
    });
    result = { status: 200, body: updated.rows[0] };
  });
  res.status(result.status).json(result.body);
}));

router.post("/solicitudes/:id/cancelar", requireCliente, asyncRoute(async (req, res) => {
  await ensureSchema();
  const motivo = String(req.body?.motivo || "").trim().slice(0, 500);
  let result;
  await db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT *
         FROM portal_solicitudes_cliente
        WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3
        FOR UPDATE`,
      [req.params.id, empresaId(req), req.user.cliente_id]
    );
    const solicitud = rows[0];
    if (!solicitud) {
      result = { status: 404, body: { error: "Solicitud no encontrada" } };
      return;
    }
    if (solicitud.pedido_id || solicitud.estado === "convertida") {
      result = { status: 409, body: { error: "Esta solicitud ya esta convertida en pedido. Contacta con trafico para cancelarla." } };
      return;
    }
    if (["cancelada", "descartada", "rechazada"].includes(String(solicitud.estado || "").toLowerCase())) {
      result = { status: 200, body: solicitud };
      return;
    }
    const respuesta = motivo ? `Cancelada por el cliente. Motivo: ${motivo}` : "Cancelada por el cliente.";
    const updated = await client.query(
      `UPDATE portal_solicitudes_cliente
          SET estado='cancelada',
              decision_cliente='cancelada',
              decision_cliente_at=NOW(),
              respuesta=$1,
              updated_at=NOW()
        WHERE id=$2 AND empresa_id=$3
        RETURNING *`,
      [respuesta, solicitud.id, empresaId(req)]
    );
    await addSolicitudEvento(client, req, solicitud.id, "solicitud.cancelada.cliente", { motivo });
    result = { status: 200, body: updated.rows[0] };
  });
  res.status(result.status).json(result.body);
}));

router.get("/admin/solicitudes/:id/eventos", requireGestion, asyncRoute(async (req, res) => {
  await ensureSchema();
  const solicitud = await db.query(
    "SELECT id FROM portal_solicitudes_cliente WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresaId(req)]
  );
  if (!solicitud.rows[0]) return res.status(404).json({ error: "Solicitud no encontrada" });
  const { rows } = await db.query(
    `SELECT id,tipo,actor_tipo,actor_id,detalle,created_at
       FROM portal_solicitud_eventos
      WHERE solicitud_id=$1 AND empresa_id=$2
      ORDER BY created_at DESC
      LIMIT 100`,
    [req.params.id, empresaId(req)]
  );
  res.json(rows);
}));

router.post("/admin/solicitudes/:id/convertir", requireGestion, asyncRoute(async (req, res) => {
  await ensureSchema();
  const eid = empresaId(req);
  const limpiarInvalidos = req.body?.force === true || req.body?.limpiar_bultos === true || req.body?.limpiar_invalidos === true;
  let result;
  await db.transaction(async (client) => {
    let { rows } = await client.query(
      `SELECT s.*, c.nombre AS cliente_nombre
         FROM portal_solicitudes_cliente s
         JOIN clientes c ON c.id=s.cliente_id AND c.empresa_id=s.empresa_id
        WHERE s.id=$1 AND s.empresa_id=$2
        FOR UPDATE`,
      [req.params.id, eid]
    );
    const sol = rows[0];
    if (!sol) {
      result = { status: 404, body: { error: "Solicitud no encontrada" } };
      return;
    }
    if (["descartada", "rechazada"].includes(String(sol.estado || "").toLowerCase())) {
      result = { status: 400, body: { error: "No se puede convertir una solicitud rechazada" } };
      return;
    }
    if (sol.decision_precio === "pendiente") {
      result = { status: 409, body: { error: "El cliente todavia debe aceptar o rechazar la contraoferta" } };
      return;
    }
    const bultosInvalidos = sol.bultos !== null && sol.bultos !== undefined && Number(sol.bultos) <= 0;
    if (bultosInvalidos && limpiarInvalidos) {
      const cleaned = await client.query(
        `UPDATE portal_solicitudes_cliente
            SET bultos=NULL,
                notas=CASE
                  WHEN COALESCE(notas,'') NOT LIKE '%Bultos invalidos limpiados%'
                    THEN CONCAT(COALESCE(notas,''), CASE WHEN COALESCE(notas,'')='' THEN '' ELSE E'\n' END, 'Bultos invalidos limpiados al aceptar la solicitud.')
                  ELSE notas
                END,
                updated_at=NOW()
          WHERE id=$1 AND empresa_id=$2 AND COALESCE(bultos,0) <= 0
          RETURNING *`,
        [sol.id, eid]
      );
      if (cleaned.rows[0]) Object.assign(sol, cleaned.rows[0]);
    }
    if (!String(sol.origen || "").trim() || !String(sol.destino || "").trim()) {
      result = { status: 400, body: { error: "La solicitud no tiene origen y destino validos" } };
      return;
    }

    if (sol.pedido_id || sol.id) {
      const pedidoExistente = await client.query(
        `SELECT * FROM pedidos
          WHERE empresa_id=$1
            AND (($2::uuid IS NOT NULL AND id=$2::uuid) OR portal_solicitud_id=$3)
          ORDER BY numero DESC
          LIMIT 1`,
        [eid, sol.pedido_id || null, sol.id]
      );
      if (pedidoExistente.rows[0]) {
        const pedidoConfirmado = await client.query(
          `UPDATE pedidos
              SET estado='confirmado', updated_at=NOW()
            WHERE id=$1 AND empresa_id=$2 AND estado::text='pendiente'
            RETURNING *`,
          [pedidoExistente.rows[0].id, eid]
        );
        const pedidoActual = pedidoConfirmado.rows[0] || pedidoExistente.rows[0];
        const updatedExisting = await client.query(
          `UPDATE portal_solicitudes_cliente
              SET estado='convertida',
                  respuesta=COALESCE(respuesta,$1),
                  decision_cliente=COALESCE(decision_cliente,'aceptada'),
                  decision_cliente_at=COALESCE(decision_cliente_at,NOW()),
                  updated_at=NOW()
            WHERE id=$2 AND empresa_id=$3
            RETURNING *`,
          [`Solicitud aceptada. Pedido ${pedidoActual.numero} creado.`, sol.id, eid]
        );
        result = { status: 200, body: { ok: true, pedido: pedidoActual, solicitud: updatedExisting.rows[0] || sol, ya_convertida: true } };
        return;
      }
    }

    const numero = await nextPedidoNumero(client, eid);
    const notas = [
      sol.notas,
      `Solicitud portal cliente: ${sol.id}`,
      "Pedido creado desde portal de cliente. Revisar y completar planificación.",
    ].filter(Boolean).join("\n");

    const [origenPunto, destinoPunto] = await Promise.all([
      getPortalPoint(client, req, sol.origen_punto_id, "carga", sol.cliente_id),
      getPortalPoint(client, req, sol.destino_punto_id, "descarga", sol.cliente_id),
    ]);
    const horaCarga = normalizeTime(sol.hora_carga);
    const horaDescarga = normalizeTime(sol.hora_descarga);
    const puntosCarga = [portalPointStop(origenPunto, sol.origen, "carga", sol.fecha_carga, horaCarga)];
    const puntosDescarga = [portalPointStop(destinoPunto, sol.destino, "descarga", sol.fecha_descarga, horaDescarga)];
    const importePedido = resolveSolicitudImporte(sol);

    const inserted = await client.query(
      `INSERT INTO pedidos
        (numero,cliente_id,origen,destino,fecha_pedido,fecha_carga,hora_carga,fecha_entrega,
         mercancia,peso_kg,bultos,importe,notas,estado,empresa_id,referencia_cliente,fecha_descarga,hora_descarga,
         puntos_carga,puntos_descarga,pendiente_completar,aviso_completar,portal_solicitud_id)
       VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9,$10,$11,$12,'confirmado',$13,$14,$15,$16,$17::jsonb,$18::jsonb,true,$19,$20)
       RETURNING *`,
      [
        numero,
        sol.cliente_id,
        String(sol.origen).trim(),
        String(sol.destino).trim(),
        sol.fecha_carga,
        horaCarga,
        sol.fecha_descarga,
        sol.mercancia || null,
        normalizeNonNegativeNumeric(sol.peso_kg),
        normalizePositiveInteger(sol.bultos),
        importePedido,
        notas,
        eid,
        sol.referencia_cliente || null,
        sol.fecha_descarga,
        horaDescarga,
        JSON.stringify(puntosCarga),
        JSON.stringify(puntosDescarga),
        "Creado desde solicitud de cliente. Completar precio, camion, chofer, costes y documentacion.",
        sol.id,
      ]
    );
    const pedido = inserted.rows[0];

    const updated = await client.query(
      `UPDATE portal_solicitudes_cliente
          SET estado='convertida',
              pedido_id=$1,
              respuesta=$2,
              decision_cliente='aceptada',
              decision_cliente_at=NOW(),
              updated_at=NOW()
        WHERE id=$3 AND empresa_id=$4
        RETURNING *`,
      [pedido.id, `Solicitud aceptada. Pedido ${pedido.numero} creado.`, sol.id, eid]
    );
    await addSolicitudEvento(client, req, sol.id, "solicitud.convertida", {
      pedido_id: pedido.id,
      pedido_numero: pedido.numero,
      estado_pedido: "confirmado",
      bultos_limpiados: bultosInvalidos && limpiarInvalidos,
    });
    result = { status: 201, body: { ok: true, pedido, solicitud: updated.rows[0] } };
  });
  res.status(result.status).json(result.body);
}));

router.get("/admin/solicitudes", requireGestion, asyncRoute(async (req, res) => {
  await ensureSchema();
  const { estado = "", cliente_id = "" } = req.query;
  const params = [empresaId(req)];
  const where = ["s.empresa_id=$1"];
  if (estado) {
    params.push(estado);
    where.push(`s.estado=$${params.length}`);
  }
  if (cliente_id) {
    params.push(cliente_id);
    where.push(`s.cliente_id=$${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT s.*, c.nombre AS cliente_nombre, c.email AS cliente_email, p.numero AS pedido_numero,
            v.matricula AS vehiculo_matricula,
            r.matricula AS remolque_matricula,
            COALESCE(p.matricula_colaborador,'') AS matricula_colaborador,
            COALESCE(p.remolque_matricula_colaborador,'') AS remolque_matricula_colaborador,
            COALESCE(ev.eventos_count,0)::int AS eventos_count,
            ev.ultimo_evento_at
       FROM portal_solicitudes_cliente s
       JOIN clientes c ON c.id=s.cliente_id AND c.empresa_id=s.empresa_id
       LEFT JOIN pedidos p ON p.id=s.pedido_id AND p.empresa_id=s.empresa_id
       LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
       LEFT JOIN vehiculos r ON r.id=COALESCE(p.remolque_id, v.remolque_id) AND r.empresa_id=p.empresa_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS eventos_count, MAX(created_at) AS ultimo_evento_at
           FROM portal_solicitud_eventos e
          WHERE e.solicitud_id=s.id AND e.empresa_id=s.empresa_id
       ) ev ON true
      WHERE ${where.join(" AND ")}
      ORDER BY s.created_at DESC
      LIMIT 200`,
    params
  );
  res.json(rows);
}));

router.patch("/admin/solicitudes/:id", requireGestion, asyncRoute(async (req, res) => {
  await ensureSchema();
  const { estado, pedido_id, respuesta, fecha_propuesta, hora_propuesta, decision_cliente, importe_contraoferta } = req.body || {};
  const eid = empresaId(req);
  const estadoNormalizado = normalizeSolicitudEstado(estado);
  const decisionNormalizada = normalizeDecisionCliente(decision_cliente);
  const contraofertaProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "importe_contraoferta");
  const contraofertaNormalizada = contraofertaProvided ? normalizeNonNegativeNumeric(importe_contraoferta) : null;
  if (estadoNormalizado === false) return res.status(400).json({ error: "Estado de solicitud no valido" });
  if (decisionNormalizada === false) return res.status(400).json({ error: "Decision de cliente no valida" });
  if (contraofertaProvided && contraofertaNormalizada === null) return res.status(400).json({ error: "El precio propuesto no es valido" });

  let result;
  await db.transaction(async (client) => {
    const current = await client.query(
      "SELECT id, cliente_id, estado, pedido_id FROM portal_solicitudes_cliente WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
      [req.params.id, eid]
    );
    const solicitud = current.rows[0];
    if (!solicitud) {
      result = { status: 404, body: { error: "Solicitud no encontrada" } };
      return;
    }
    if (contraofertaProvided && (solicitud.pedido_id || ["convertida", "rechazada", "descartada", "cancelada"].includes(String(solicitud.estado || "").toLowerCase()))) {
      result = { status: 409, body: { error: "La solicitud ya esta cerrada y no admite una contraoferta" } };
      return;
    }

    if (pedido_id) {
      const pedido = await client.query(
        "SELECT id FROM pedidos WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3",
        [pedido_id, eid, solicitud.cliente_id]
      );
      if (!pedido.rows[0]) {
        result = { status: 404, body: { error: "Pedido no encontrado para este cliente" } };
        return;
      }
    }

    const { rows } = await client.query(
      `UPDATE portal_solicitudes_cliente
          SET estado=COALESCE($1,estado),
              pedido_id=COALESCE($2,pedido_id),
              respuesta=COALESCE($3,respuesta),
              fecha_propuesta=COALESCE($4,fecha_propuesta),
              hora_propuesta=COALESCE($5,hora_propuesta),
              decision_cliente=COALESCE($6,decision_cliente),
              decision_cliente_at=CASE WHEN $6 IN ('aceptada','rechazada') THEN NOW() ELSE decision_cliente_at END,
              importe_contraoferta=CASE WHEN $7::boolean THEN $8 ELSE importe_contraoferta END,
              decision_precio=CASE WHEN $7::boolean THEN 'pendiente' ELSE decision_precio END,
              decision_precio_at=CASE WHEN $7::boolean THEN NULL ELSE decision_precio_at END,
              contraoferta_at=CASE WHEN $7::boolean THEN NOW() ELSE contraoferta_at END,
              updated_at=NOW()
        WHERE id=$9 AND empresa_id=$10
        RETURNING *`,
      [
        estadoNormalizado,
        pedido_id || null,
        respuesta || null,
        fecha_propuesta || null,
        hora_propuesta || null,
        decisionNormalizada,
        contraofertaProvided,
        contraofertaNormalizada,
        req.params.id,
        eid,
      ]
    );
    const tipoEvento = estadoNormalizado === "rechazada"
      ? "solicitud.rechazada"
      : contraofertaProvided
        ? "solicitud.precio.propuesto"
      : fecha_propuesta
        ? "solicitud.reprogramacion.propuesta"
        : "solicitud.actualizada";
    await addSolicitudEvento(client, req, rows[0].id, tipoEvento, {
      estado: estadoNormalizado,
      pedido_id: pedido_id || null,
      respuesta: respuesta || null,
      fecha_propuesta: fecha_propuesta || null,
      hora_propuesta: hora_propuesta || null,
      decision_cliente: decisionNormalizada,
      importe_contraoferta: contraofertaProvided ? contraofertaNormalizada : null,
    });
    result = { status: 200, body: rows[0] };
  });
  res.status(result.status).json(result.body);
}));

module.exports = router;
module.exports._test = {
  asyncRoute,
  nextPedidoNumero,
  normalizeNonNegativeNumeric,
  normalizePositiveInteger,
  portalPointLabel,
  portalPointStop,
  resolveSolicitudImporte,
};
