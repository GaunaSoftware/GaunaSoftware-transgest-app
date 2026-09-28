const express = require("express");
const db = require("../services/db");
const noticeCenter = require('../services/noticeCenter');
const companyInsurance = require('../services/companyInsurance');
const operativeRead = require('../services/operativeReadState');
const {
  crearNotificacion,
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
} = require("../services/notificaciones");

const router = express.Router();

const ROLES_OPERATIVOS = new Set(["gerente", "contable", "administrativo", "trafico"]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const iso = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function daysFromToday(value) {
  const date = dateOnly(value);
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

async function ensureAvisosOperativosSchema() {
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_precio_confirmado_at TIMESTAMPTZ").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_carga_confirmada_at TIMESTAMPTZ").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_en_camino_confirmada_at TIMESTAMPTZ").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_descarga_confirmada_at TIMESTAMPTZ").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_workflow_enviado_at TIMESTAMPTZ").catch(() => {});
  await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_colaborador NUMERIC(10,2)").catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS pedido_colaborador_pagos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL,
      factura_nombre VARCHAR(255),
      factura_data TEXT,
      fecha_recepcion DATE,
      fecha_pago_calculada DATE,
      fecha_pago_real DATE,
      importe NUMERIC(12,2) DEFAULT 0,
      pagado BOOLEAN NOT NULL DEFAULT false,
      documentacion_recibida BOOLEAN NOT NULL DEFAULT false,
      fecha_documentacion_recepcion DATE,
      notas_pago TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (pedido_id, empresa_id)
    )
  `).catch(() => {});
  await db.query("ALTER TABLE pedido_colaborador_pagos ADD COLUMN IF NOT EXISTS factura_nombre VARCHAR(255)").catch(() => {});
  await db.query("ALTER TABLE pedido_colaborador_pagos ADD COLUMN IF NOT EXISTS factura_data TEXT").catch(() => {});
  await db.query("ALTER TABLE pedido_colaborador_pagos ADD COLUMN IF NOT EXISTS documentacion_recibida BOOLEAN NOT NULL DEFAULT false").catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS pedido_docs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre VARCHAR(255) NOT NULL,
      tipo VARCHAR(80),
      file_base64 TEXT,
      file_mime VARCHAR(120),
      file_size_kb INTEGER,
      notas TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS pedido_chofer_pasos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      empresa_id UUID NOT NULL,
      chofer_id UUID,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (pedido_id)
    )
  `).catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS avisos_operativos_ignorados (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      usuario_id UUID NOT NULL,
      alert_key VARCHAR(220) NOT NULL,
      alert JSONB,
      motivo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (empresa_id, usuario_id, alert_key)
    )
  `);
  await db.query("ALTER TABLE avisos_operativos_ignorados ADD COLUMN IF NOT EXISTS alert JSONB").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_avisos_operativos_ignorados_usuario ON avisos_operativos_ignorados(empresa_id, usuario_id, created_at DESC)").catch(() => {});
  await db.query(`CREATE TABLE IF NOT EXISTS avisos_operativos_reconocidos (
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    alert_key VARCHAR(220) NOT NULL,
    reconocido_por UUID NOT NULL REFERENCES usuarios(id),
    reconocido_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (empresa_id, alert_key)
  )`);
}

function buildAlert(row, kind, severity, title, detail, action) {
  return {
    key: `colaborador:${row.id}:${kind}`,
    kind,
    severity,
    pedido_id: row.id,
    pedido_numero: row.numero,
    estado: row.estado || "pendiente",
    colaborador_id: row.colaborador_id,
    colaborador_nombre: row.colaborador_nombre || "Colaborador",
    colaborador_email: row.colaborador_email || "",
    fecha_carga: dateOnly(row.fecha_carga || row.fecha_pedido),
    fecha_descarga: dateOnly(row.fecha_descarga || row.fecha_entrega),
    title,
    detail,
    action,
  };
}

function buildColaboradorAlerts(row) {
  const alerts = [];
  const estado = String(row.estado || "pendiente").toLowerCase();
  const finalizado = ["entregado", "facturado"].includes(estado);
  const cargaDiff = daysFromToday(row.fecha_carga || row.fecha_pedido);
  const descargaDiff = daysFromToday(row.fecha_descarga || row.fecha_entrega);
  const albaranes = Number(row.albaranes_count || 0);
  const tieneFacturaProveedor = cleanText(row.factura_nombre) || cleanText(row.factura_data);
  const docPagoRecibida = row.documentacion_recibida === true;
  // Las confirmaciones por enlace solo son accionables si podemos enviarlo.
  // La falta de correo no equivale a aceptación del precio ni a una incidencia.
  const puedeConfirmarPorEnlace = Boolean(cleanText(row.colaborador_email));

  if (puedeConfirmarPorEnlace && !finalizado && !row.colaborador_workflow_enviado_at) {
    alerts.push(buildAlert(
      row,
      "workflow_no_enviado",
      cargaDiff !== null && cargaDiff <= 1 ? "alta" : "media",
      `Enviar seguimiento al colaborador ${row.numero || ""}`.trim(),
      "El viaje tiene colaborador asignado, pero no consta enlace/flujo enviado para confirmar precio, carga, camino o descarga.",
      "Enviar el flujo al colaborador o contactar manualmente."
    ));
  }

  if (puedeConfirmarPorEnlace && !finalizado && !row.colaborador_precio_confirmado_at && Number(row.precio_colaborador || 0) > 0) {
    alerts.push(buildAlert(
      row,
      "precio_sin_confirmar",
      cargaDiff !== null && cargaDiff <= 1 ? "alta" : "media",
      `Precio pendiente de confirmar ${row.numero || ""}`.trim(),
      `Coste previsto colaborador: ${Number(row.precio_colaborador || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR.`,
      "Verificar aceptación del precio antes de la carga."
    ));
  }

  if (puedeConfirmarPorEnlace && !finalizado && cargaDiff !== null && cargaDiff <= 0 && ["confirmado", "en_curso", "descarga"].includes(estado) && !row.colaborador_carga_confirmada_at) {
    alerts.push(buildAlert(
      row,
      "carga_sin_confirmar",
      cargaDiff < 0 ? "alta" : "media",
      `Verificar carga ${row.numero || ""}`.trim(),
      `La carga estaba prevista para ${dateOnly(row.fecha_carga || row.fecha_pedido)} y no consta confirmación de carga del colaborador.`,
      "Llamar al colaborador o reenviar confirmación de carga."
    ));
  }

  if (puedeConfirmarPorEnlace && !finalizado && row.colaborador_carga_confirmada_at && !row.colaborador_en_camino_confirmada_at && ["en_curso", "descarga"].includes(estado)) {
    alerts.push(buildAlert(
      row,
      "camino_sin_confirmar",
      "media",
      `Confirmar tránsito ${row.numero || ""}`.trim(),
      "El colaborador confirmó carga, pero no consta confirmación de que vaya en camino.",
      "Verificar ubicación/ETA con el colaborador."
    ));
  }

  if (puedeConfirmarPorEnlace && !finalizado && (descargaDiff !== null && descargaDiff <= 0 || estado === "descarga") && !row.colaborador_descarga_confirmada_at) {
    alerts.push(buildAlert(
      row,
      "descarga_sin_confirmar",
      descargaDiff !== null && descargaDiff < 0 ? "alta" : "media",
      `Confirmar descarga ${row.numero || ""}`.trim(),
      `No consta confirmación de descarga del colaborador${row.fecha_descarga || row.fecha_entrega ? ` para ${dateOnly(row.fecha_descarga || row.fecha_entrega)}` : ""}.`,
      "Pedir confirmación y albaranes si ya ha descargado."
    ));
  }

  if (["entregado", "facturado"].includes(estado) && albaranes <= 0) {
    alerts.push(buildAlert(
      row,
      "albaran_pendiente",
      "alta",
      `Albarán/POD pendiente ${row.numero || ""}`.trim(),
      "El viaje figura entregado pero no hay albarán, POD o CMR visible en el pedido.",
      row.colaborador_email ? "Reclamar al colaborador o subir documentación manual." : "Solicitar documentación manualmente al proveedor."
    ));
  }

  if (["entregado", "facturado"].includes(estado) && albaranes > 0 && (!docPagoRecibida || !tieneFacturaProveedor)) {
    alerts.push(buildAlert(
      row,
      "documentacion_pago_pendiente",
      "media",
      `Documentación proveedor pendiente ${row.numero || ""}`.trim(),
      "Hay soporte del viaje, pero falta marcar documentación/factura del colaborador para cerrar pago.",
      "Revisar liquidación/factura del colaborador."
    ));
  }

  return alerts;
}

function minutesSinceIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

function buildChoferAlert(row, kind, severity, title, detail, action, minutos, episodeAt, stopId = 'viaje') {
  const phase = kind.includes('carga') && !kind.includes('descarga') ? 'demora_carga' : 'demora_descarga';
  return {
    key: `chofer:${row.id}:${stopId}:${phase}:${String(episodeAt || 'sin_fecha')}`,
    kind,
    severity,
    pedido_id: row.id,
    pedido_numero: row.numero,
    estado: row.estado || "en_curso",
    chofer_id: row.chofer_id,
    chofer_nombre: row.chofer_nombre || "Chofer",
    colaborador_id: null,
    colaborador_nombre: row.chofer_nombre || "Chofer interno",
    colaborador_email: "",
    vehiculo_matricula: row.vehiculo_matricula || "",
    fecha_carga: dateOnly(row.fecha_carga || row.fecha_pedido),
    fecha_descarga: dateOnly(row.fecha_descarga || row.fecha_entrega),
    title,
    detail,
    action,
    minutos,
    parada_id: stopId === 'viaje' ? null : stopId,
    demora_paralizacion: true,
    prefactura_disponible: kind === 'chofer_demora_carga',
  };
}

function buildChoferStaleAlertsForStop(row, data, stopId = 'viaje') {
  const alerts = [];
  if (data.carga_proceso && !data.carga_ok) {
    const mins = minutesSinceIso(data.carga_proceso_at || data.carga_iniciada_at);
    if (mins && mins > 60) alerts.push(buildChoferAlert(
      row,
      "chofer_carga_bloqueada",
      mins > 180 ? "alta" : "media",
      `Carga bloqueada ${row.numero || ""}`.trim(),
      `El chofer lleva ${mins} minutos en carga. Revisar posible paralizacion, cita o incidencia con el punto de carga.`,
      "Contactar con chofer/cargador y valorar reclamacion por paralizacion.",
      mins,
      data.carga_iniciada_at || data.carga_proceso_at, stopId
    ));
  } else if (data.carga_iniciada && !data.carga_proceso && !data.carga_ok) {
    const mins = minutesSinceIso(data.carga_iniciada_at);
    if (mins && mins > 60) alerts.push(buildChoferAlert(
      row,
      "chofer_espera_carga",
      mins > 180 ? "alta" : "media",
      `Espera de carga ${row.numero || ""}`.trim(),
      `El chofer esta posicionado en carga desde hace ${mins} minutos y no consta inicio de carga.`,
      "Contactar con chofer/cargador y revisar cita.",
      mins,
      data.carga_iniciada_at, stopId
    ));
  }

  if (data.descarga_iniciada && !data.descarga_ok) {
    const mins = minutesSinceIso(data.descarga_iniciada_at || data.posicionado_descarga_at);
    if (mins && mins > 60) alerts.push(buildChoferAlert(
      row,
      "chofer_descarga_bloqueada",
      mins > 180 ? "alta" : "media",
      `Descarga bloqueada ${row.numero || ""}`.trim(),
      `El chofer lleva ${mins} minutos en descarga. Revisar posible paralizacion o incidencia en destino.`,
      "Contactar con chofer/destinatario y valorar reclamacion por paralizacion.",
      mins,
      data.descarga_iniciada_at || data.posicionado_descarga_at, stopId
    ));
  } else if (data.posicionado_descarga && !data.descarga_iniciada && !data.descarga_ok) {
    const mins = minutesSinceIso(data.posicionado_descarga_at);
    if (mins && mins > 60) alerts.push(buildChoferAlert(
      row,
      "chofer_espera_descarga",
      mins > 180 ? "alta" : "media",
      `Espera de descarga ${row.numero || ""}`.trim(),
      `El chofer esta en destino desde hace ${mins} minutos y no consta inicio de descarga.`,
      "Contactar con chofer/destinatario y revisar cita.",
      mins,
      data.posicionado_descarga_at, stopId
    ));
  }
  // The driver's threshold crossing is persisted in pedido_chofer_pasos.
  // Keep the actionable notice after loading ends until traffic or management
  // acknowledges this episode once for the whole company.
  if (data.aviso_espera_carga && data.carga_ok) alerts.push(buildChoferAlert(
    row, "chofer_demora_carga", "media",
    `Demora de carga ${row.numero || ""}`.trim(),
    "La carga terminó tras superar el umbral de espera. Verifica la causa y la documentación antes de solicitar paralización.",
    "Abrir pedido y valorar paralización; el aviso no crea una factura automáticamente.",
    null, data.carga_iniciada_at || data.aviso_espera_carga_at, stopId
  ));
  return alerts.map(alert => ({...alert, parada_label:data.label||null,
    title:data.label?`${alert.title} · ${data.label}`:alert.title}));
}

function buildChoferStaleAlerts(row) {
  const data = row.pasos && typeof row.pasos === 'object' ? row.pasos : {};
  const stops = data.paradas && typeof data.paradas === 'object' && !Array.isArray(data.paradas)
    ? Object.entries(data.paradas).filter(([,value]) => value && typeof value === 'object' && !Array.isArray(value)) : [];
  return stops.length
    ? stops.flatMap(([id,value]) => buildChoferStaleAlertsForStop(row,value,id))
    : buildChoferStaleAlertsForStop(row,data);
}

function filterAlertsByRole(items, rol) {
  if (rol === "gerente") return items;
  const roleKinds = {
    trafico: new Set(["workflow_no_enviado", "precio_sin_confirmar", "carga_sin_confirmar", "camino_sin_confirmar", "descarga_sin_confirmar", "chofer_carga_bloqueada", "chofer_espera_carga", "chofer_demora_carga", "chofer_descarga_bloqueada", "chofer_espera_descarga"]),
    administrativo: new Set(["albaran_pendiente", "documentacion_pago_pendiente"]),
    contable: new Set(["albaran_pendiente", "documentacion_pago_pendiente"]),
  };
  const allowed = roleKinds[rol];
  if (!allowed) return [];
  return items.filter(item => allowed.has(item.kind));
}

async function listarAvisosColaboradores(req, { all = false, includeRead = false } = {}) {
  await ensureAvisosOperativosSchema();
  const empresaId = req.user?.empresa_id;
  const usuarioId = req.user?.id;
  const rol = req.user?.rol;
  if (!empresaId || !usuarioId) return { items: [], resumen: {} };
  if (!ROLES_OPERATIVOS.has(rol)) return { items: [], resumen: { total: 0 } };

  let rows = [];
  let choferRows = [];
  try {
    const result = await db.query(
    `SELECT p.id, p.numero, p.estado, p.fecha_pedido, p.fecha_carga, p.fecha_descarga, p.fecha_entrega,
            p.precio_colaborador, p.colaborador_id,
            p.colaborador_workflow_enviado_at, p.colaborador_precio_confirmado_at,
            p.colaborador_carga_confirmada_at, p.colaborador_en_camino_confirmada_at, p.colaborador_descarga_confirmada_at,
            co.nombre AS colaborador_nombre, co.email AS colaborador_email,
            pay.documentacion_recibida, COALESCE(NULLIF(pay.factura_nombre,''),(SELECT f.nombre FROM colaborador_facturas cf JOIN facturas_proveedor f ON f.id=cf.factura_proveedor_id AND f.empresa_id=cf.empresa_id WHERE cf.pedido_id=p.id AND cf.empresa_id=p.empresa_id AND cf.colaborador_id=p.colaborador_id AND f.estado='revisada' ORDER BY f.created_at DESC LIMIT 1)) AS factura_nombre, pay.factura_data,
            COALESCE(docs.albaranes_count,0)::int AS albaranes_count
       FROM pedidos p
       JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id AND COALESCE(co.activo,true)=true
       LEFT JOIN pedido_colaborador_pagos pay ON pay.pedido_id=p.id AND pay.empresa_id=p.empresa_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS albaranes_count
           FROM pedido_docs d
          WHERE d.pedido_id=p.id AND d.empresa_id=p.empresa_id
            AND (
              LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
              OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
              OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
              OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
              OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
              OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
            )
       ) docs ON true
      WHERE p.empresa_id=$1
        AND p.colaborador_id IS NOT NULL
        AND COALESCE(p.estado::text,'pendiente') NOT IN ('cancelado')
        AND COALESCE(p.fecha_descarga,p.fecha_entrega,p.fecha_carga,p.fecha_pedido,p.created_at::date) >= CURRENT_DATE - INTERVAL '60 days'
        AND COALESCE(p.fecha_carga,p.fecha_pedido,p.created_at::date) <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY COALESCE(p.fecha_carga,p.fecha_pedido,p.created_at::date) ASC, p.numero ASC
      `,
    [empresaId]
    );
    rows = result.rows || [];
    const choferResult = await db.query(
      `SELECT p.id, p.numero, p.estado::text AS estado, p.fecha_pedido, p.fecha_carga, p.fecha_descarga, p.fecha_entrega,
              p.chofer_id, COALESCE(ch.nombre || ' ' || ch.apellidos, ch.nombre, 'Chofer') AS chofer_nombre,
              v.matricula AS vehiculo_matricula,
              s.data AS pasos, s.updated_at AS pasos_updated_at
         FROM pedido_chofer_pasos s
         JOIN pedidos p ON p.id=s.pedido_id AND p.empresa_id=s.empresa_id
         LEFT JOIN choferes ch ON ch.id=COALESCE(s.chofer_id,p.chofer_id) AND ch.empresa_id=p.empresa_id
         LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
        WHERE p.empresa_id=$1
          AND (p.estado::text IN ('en_curso','descarga') OR COALESCE(s.data->>'aviso_espera_carga','false')='true'
            OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(s.data->'paradas')='object'
              THEN s.data->'paradas' ELSE '{}'::jsonb END) AS stop(id,progress)
              WHERE COALESCE(stop.progress->>'aviso_espera_carga','false')='true'))
          AND (COALESCE(p.fecha_descarga,p.fecha_entrega,p.fecha_carga,p.fecha_pedido,p.created_at::date) >= CURRENT_DATE - INTERVAL '10 days'
            OR COALESCE(s.data->>'aviso_espera_carga','false')='true'
            OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(s.data->'paradas')='object'
              THEN s.data->'paradas' ELSE '{}'::jsonb END) AS stop(id,progress)
              WHERE COALESCE(stop.progress->>'aviso_espera_carga','false')='true'))
        ORDER BY COALESCE(p.fecha_carga,p.fecha_pedido,p.created_at::date) ASC, p.numero ASC
        `,
      [empresaId]
    );
    choferRows = choferResult.rows || [];
  } catch (error) {
    if (["42703", "42P01", "42883"].includes(error.code)) {
      console.warn("[avisos_colaboradores] esquema incompleto; se omiten avisos operativos", error.message);
      return { items: [], resumen: { total: 0, warning: "schema_pending" } };
    }
    throw error;
  }

  const ignored = await db.query(
    "SELECT alert_key FROM avisos_operativos_ignorados WHERE empresa_id=$1 AND usuario_id=$2",
    [empresaId, usuarioId]
  ).catch(() => ({ rows: [] }));
  const ignoredKeys = new Set(ignored.rows.map(r => String(r.alert_key || "")));
  const acknowledged = await db.query('SELECT alert_key FROM avisos_operativos_reconocidos WHERE empresa_id=$1', [empresaId]);
  const acknowledgedKeys = new Set(acknowledged.rows.map(r => String(r.alert_key)));
  const pending = filterAlertsByRole(
    rows.flatMap(buildColaboradorAlerts)
      .concat(choferRows.flatMap(buildChoferStaleAlerts))
      .filter(a => a.demora_paralizacion ? !acknowledgedKeys.has(a.key) : !ignoredKeys.has(a.key)),
    rol
  );
  pending.sort((a,b) => Number(!!b.demora_paralizacion)-Number(!!a.demora_paralizacion)
    || Number(b.severity==='alta')-Number(a.severity==='alta')
    || String(a.fecha_carga||'').localeCompare(String(b.fecha_carga||'')));
  let unread = includeRead ? pending : [
    ...pending.filter(item => item.demora_paralizacion),
    ...await operativeRead.unreadItems(db, req.user, pending.filter(item => !item.demora_paralizacion)),
  ];
  if (!includeRead && noticeCenter.can(req.user, 'agenda')) {
    const { rows: tasks } = await db.query(`SELECT metadata->>'alert_key' AS alert_key,source_id,cause_code FROM agenda_eventos
      WHERE empresa_id=$1 AND (asignado_a=$2 OR creado_por=$2 OR visibilidad='equipo') AND estado IN ('pendiente','en_progreso')
      AND (metadata->>'source'='avisos_operativos_colaborador' OR source_type='pedido')`, [empresaId, usuarioId]);
    const delegated = new Set(tasks.map(t => t.alert_key));
    const automated = new Set(tasks.map(t => `${t.source_id}:${t.cause_code}`));
    const cause = {carga_sin_confirmar:'carga_sin_finalizar',descarga_sin_confirmar:'entrega_vencida'};
    unread = unread.filter(i => i.demora_paralizacion || (!delegated.has(i.key) && !(cause[i.kind] && automated.has(`${i.pedido_id}:${cause[i.kind]}`))));
  }
  const items = all ? unread : unread.slice(0, 80);
  const resumen = {
    total: unread.length,
    alta: unread.filter(i => i.severity === "alta").length,
    media: unread.filter(i => i.severity === "media").length,
    colaboradores: new Set(unread.map(i => i.colaborador_id).filter(Boolean)).size,
    albaranes_pendientes: unread.filter(i => i.kind === "albaran_pendiente").length,
  };
  return { items, resumen, pending_total: pending.length, limited: items.length < unread.length };
}

router.get('/centro', async (req, res, next) => {
  try { res.json(await noticeCenter.readNotices(db, req.user)); } catch (e) { next(e); }
});
router.get('/configuracion', async (req, res, next) => {
  try { res.json(await noticeCenter.settings(db, req.user)); } catch (e) { next(e); }
});
router.put('/configuracion', async (req, res, next) => {
  try { res.json(await noticeCenter.saveSettings(db, req.user, req.body)); } catch (e) { next(e); }
});
router.get('/seguros', async (req, res, next) => {
  try { res.json(await companyInsurance.list(db, req.user)); } catch (e) { next(e); }
});
router.post('/seguros', async (req, res, next) => {
  try { res.status(201).json(await companyInsurance.save(db, req.user, req.body)); } catch (e) { next(e); }
});
router.put('/seguros/:id', async (req, res, next) => {
  try { res.json(await companyInsurance.save(db, req.user, req.body, req.params.id)); } catch (e) { next(e); }
});
router.post('/operativas/leer-todas', async (req, res, next) => {
  try {
    if (!ROLES_OPERATIVOS.has(req.user?.rol)) return res.status(403).json({ error: 'No autorizado' });
    const result = await listarAvisosColaboradores(req, { all: true });
    if (result.resumen.warning) return res.status(503).json({ error: 'No se pudieron consultar todos los avisos.' });
    const delays = result.items.filter(item => item.demora_paralizacion);
    const regular = result.items.filter(item => !item.demora_paralizacion);
    let shared = 0;
    if (delays.length && ['trafico','gerente'].includes(req.user.rol)) {
      const inserted = await db.query(`INSERT INTO avisos_operativos_reconocidos(empresa_id,alert_key,reconocido_por)
        SELECT $1::uuid,keys.alert_key,$2::uuid FROM unnest($3::text[]) AS keys(alert_key) ON CONFLICT DO NOTHING RETURNING alert_key`,
      [req.user.empresa_id,req.user.id,delays.map(item => item.key)]);
      shared = inserted.rows.length;
    }
    res.json({ ok: true, actualizadas: shared + await operativeRead.markRead(db, req.user, regular) });
  } catch (e) { next(e); }
});
router.post('/operativas/colaboradores/leer', async (req, res, next) => {
  try {
    if (!['trafico','gerente'].includes(req.user?.rol)) return res.status(403).json({ error: 'Solo tráfico o gerencia pueden reconocer este aviso' });
    const key = String(req.body?.key || '');
    if (!key || key.length > 300) return res.status(400).json({ error: 'Aviso no válido' });
    const pending = await listarAvisosColaboradores(req, { all: true, includeRead: true });
    if (pending.resumen.warning) return res.status(503).json({ error: 'No se pudieron consultar los avisos.' });
    const alert = pending.items.find(item => item.key === key);
    if (!alert) return res.status(404).json({ error: 'Aviso no encontrado o resuelto' });
    if (alert.demora_paralizacion) {
      const inserted = await db.query(`INSERT INTO avisos_operativos_reconocidos(empresa_id,alert_key,reconocido_por)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING alert_key`, [req.user.empresa_id,key,req.user.id]);
      return res.json({ ok:true, actualizadas:inserted.rows.length, compartido:true });
    }
    res.json({ ok: true, actualizadas: await operativeRead.markRead(db, req.user, [alert]) });
  } catch (e) { next(e); }
});

router.get("/", async (req, res) => {
  const empresaId = req.user?.empresa_id;
  const usuarioId = req.user?.id;
  if (!empresaId || !usuarioId) return res.status(401).json({ error: "Sesion no valida" });
  const result = await listarNotificaciones(empresaId, usuarioId, {
    limit: req.query.limit,
    includeRead: req.query.include_read,
    audience: ["cliente", "cliente_portal"].includes(req.user?.rol) ? "cliente" : "",
  });
  res.json(result);
});

router.get("/operativas/colaboradores", async (req, res, next) => {
  try {
    res.json(await listarAvisosColaboradores(req));
  } catch (error) {
    next(error);
  }
});

router.get("/operativas/ignorados", async (req, res, next) => {
  try {
    await ensureAvisosOperativosSchema();
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sesion no valida" });
    if (req.user?.rol !== "gerente") return res.status(403).json({ error: "Solo gerencia puede consultar avisos ignorados" });
    const desde = dateOnly(req.query.desde) || dateOnly(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const hasta = dateOnly(req.query.hasta) || dateOnly(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
    const { rows } = await db.query(
      `SELECT i.id, i.usuario_id, i.alert_key, i.alert, i.motivo, i.created_at,
              COALESCE(u.nombre, u.username, u.email, 'Usuario') AS usuario_nombre,
              u.email AS usuario_email,
              u.rol AS usuario_rol
         FROM avisos_operativos_ignorados i
         LEFT JOIN usuarios u ON u.id=i.usuario_id AND u.empresa_id=i.empresa_id
        WHERE i.empresa_id=$1
          AND i.created_at >= $2::date
          AND i.created_at < ($3::date + INTERVAL '1 day')
        ORDER BY i.created_at DESC
        LIMIT 500`,
      [empresaId, desde, hasta]
    );
    res.json({
      desde,
      hasta,
      items: rows.map(r => ({
        ...r,
        dia: dateOnly(r.created_at),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/operativas/colaboradores/agenda", async (req, res, next) => {
  try {
    await ensureAvisosOperativosSchema();
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sesion no valida" });
    if (!noticeCenter.can(req.user, 'agenda', 'editar')) return res.status(403).json({ error: 'Sin permiso de edición de agenda' });
    const pending = await listarAvisosColaboradores(req, { all: true, includeRead: true });
    const alert = pending.items.find(a => a.key === req.body?.alert?.key);
    if (!alert) return res.status(404).json({ error: 'Aviso no encontrado o ya resuelto' });
    const assignee = req.body?.asignado_a || req.user.id;
    const owner = await db.query('SELECT id FROM usuarios WHERE id=$1 AND empresa_id=$2 AND activo=true', [assignee, empresaId]);
    if (!owner.rows.length) return res.status(400).json({ error: 'Usuario de agenda no válido' });
    const pedidoId = cleanText(alert.pedido_id);
    const alertKey = cleanText(alert.key);
    if (!pedidoId || !alertKey) return res.status(400).json({ error: "Aviso no valido" });
    const fechaBase = dateOnly(alert.fecha_descarga || alert.fecha_carga || new Date());
    const fechaInicio = `${fechaBase || new Date().toISOString().slice(0, 10)}T09:00:00`;
    let created = false;
    const { rows } = await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`avimp:${empresaId}:${alertKey}`]);
      const existing = await tx.query(`SELECT * FROM agenda_eventos WHERE empresa_id=$1 AND metadata->>'alert_key'=$2 AND estado IN ('pendiente','en_progreso') ORDER BY created_at LIMIT 1`, [empresaId, alertKey]);
      if (existing.rows.length) return existing;
      created = true;
      return tx.query(
      `INSERT INTO agenda_eventos
        (empresa_id, creado_por, asignado_a, titulo, descripcion, fecha_inicio, todo_dia,
         tipo, prioridad, estado, visibilidad, pedido_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,true,$7,$8,'pendiente','equipo',$9::uuid,$10::jsonb)
       RETURNING *`,
      [
        empresaId,
        req.user.id,
        assignee,
        cleanText(alert.title) || "Revisar aviso colaborador",
        `${cleanText(alert.detail) || "Revisar viaje de colaborador."}\n\nAccion: ${cleanText(alert.action) || "Revisar y cerrar aviso."}`,
        fechaInicio,
        "aviso_colaborador",
        alert.severity === "alta" ? "alta" : "media",
        pedidoId,
        JSON.stringify({ source: "avisos_operativos_colaborador", alert_key: alertKey, kind: alert.kind || "" }),
      ]
    );
    });
    await operativeRead.markRead(db, req.user, [alert]);
    if (created) await crearNotificacion({
      empresa_id: empresaId,
      usuario_id: assignee,
      tipo: "agenda_aviso_colaborador",
      titulo: "Recordatorio de colaborador en agenda",
      mensaje: cleanText(alert.title) || "Revisar aviso de colaborador",
      data: {
        pedido_id: pedidoId,
        alert_key: alertKey,
        agenda_evento_id: rows[0]?.id || null,
        view: "agenda",
        dedupe_key: `agenda-aviso-colaborador:${alertKey}:${req.body?.asignado_a || req.user.id}`,
      },
      created_by: req.user.id,
    });
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post("/operativas/colaboradores/ignorar", async (req, res, next) => {
  try {
    await ensureAvisosOperativosSchema();
    const empresaId = req.user?.empresa_id;
    const usuarioId = req.user?.id;
    if (!empresaId || !usuarioId) return res.status(401).json({ error: "Sesion no valida" });
    const pending = await listarAvisosColaboradores(req, { all:true, includeRead:true });
    const alert = pending.items.find(a=>a.key === req.body?.alert?.key);
    if (!alert) return res.status(404).json({error:'Aviso no encontrado o ya resuelto'});
    const alertKey = cleanText(alert.key);
    if (!alertKey) return res.status(400).json({ error: "Aviso no valido" });
    const motivo = cleanText(req.body?.motivo) || "Ignorado desde panel operativo";
    await db.query(
      `INSERT INTO avisos_operativos_ignorados (empresa_id, usuario_id, alert_key, alert, motivo)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (empresa_id, usuario_id, alert_key)
       DO UPDATE SET alert=EXCLUDED.alert, motivo=EXCLUDED.motivo, created_at=NOW()`,
      [empresaId, usuarioId, alertKey, JSON.stringify(alert || {}), motivo]
    );

    if (req.user?.rol !== "gerente") {
      const gerentes = await db.query(
        "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol='gerente'",
        [empresaId]
      ).catch(() => ({ rows: [] }));
      const actor = cleanText(req.user?.nombre) || cleanText(req.user?.email) || cleanText(req.user?.username) || "Usuario";
      await Promise.all(gerentes.rows.map(g => crearNotificacion({
        empresa_id: empresaId,
        usuario_id: g.id,
        tipo: "aviso_operativo_ignorado",
        titulo: "Aviso operativo ignorado",
        mensaje: `${actor} ha ignorado el aviso "${cleanText(alert.title) || alertKey}" el ${new Date().toLocaleString("es-ES")}.`,
        data: {
          alert_key: alertKey,
          pedido_id: alert.pedido_id || null,
          pedido_numero: alert.pedido_numero || null,
          usuario_id: usuarioId,
          usuario_nombre: actor,
          ignored_at: new Date().toISOString(),
          dedupe_key: `aviso-ignorado:${usuarioId}:${alertKey}`,
          view: "avisos",
        },
        created_by: usuarioId,
      })));
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/leida", async (req, res) => {
  const empresaId = req.user?.empresa_id;
  const usuarioId = req.user?.id;
  if (!empresaId || !usuarioId) return res.status(401).json({ error: "Sesion no valida" });
  const item = await marcarLeida(empresaId, usuarioId, req.params.id);
  if (!item) return res.status(404).json({ error: "Notificacion no encontrada" });
  res.json({ ok: true, data: item });
});

router.post("/leer-todas", async (req, res) => {
  const empresaId = req.user?.empresa_id;
  const usuarioId = req.user?.id;
  if (!empresaId || !usuarioId) return res.status(401).json({ error: "Sesion no valida" });
  const count = await marcarTodasLeidas(empresaId, usuarioId);
  res.json({ ok: true, actualizadas: count });
});

module.exports = router;
