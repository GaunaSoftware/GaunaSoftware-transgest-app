const { cacheMiddleware } = require("../services/cache");
const express = require("express");
const db      = require("../services/db");
const { authenticate, GERENTE_O_CONTABLE, GERENTE_O_TRAFICO, SOLO_GERENTE } = require("../middleware/auth");
const { crearNotificacion } = require("../services/notificaciones");
const { enviarEmail } = require("../services/email");
const { detectTransportComplianceSignals, detectWasteSignals } = require("../services/documentoControl");
const { ensureRegulatoryCoreSchema } = require("../services/regulatoryCore");

const router = express.Router();
router.use((req, res, next) => {
  if (req.path === "/control-tower") return next();
  if (req.path === "/copiloto-operativo") return next();
  if (req.path === "/cargas-retorno") return next();
  if (req.path === "/cumplimiento-europeo") return next();
  if (req.path === "/cargas-retorno/solicitud") return next();
  if (req.path === "/cargas-retorno/solicitud/enviar") return next();
  if (req.path.startsWith("/cargas-retorno/solicitudes/")) return next();
  return authenticate(req, res, () => GERENTE_O_CONTABLE(req, res, next));
});

function rangoPeriodo(period) {
  const today = new Date();
  const hasta = today.toISOString().slice(0, 10);
  if (period === "all") return { desde: "1970-01-01", hasta };
  if (period === "hoy") return { desde: hasta, hasta };
  if (period === "mes") {
    const desdeMes = new Date(today.getFullYear(), today.getMonth(), 1);
    return { desde: desdeMes.toISOString().slice(0, 10), hasta };
  }
  const dias = { "7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365 }[period] || 30;
  const desde = new Date(today);
  desde.setDate(desde.getDate() - dias);
  return { desde: desde.toISOString().slice(0, 10), hasta };
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function round2(value) {
  const n = Number(value || 0);
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

router.get("/bi/resumen", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { desde, hasta } = rangoPeriodo(String(req.query.periodo || "90d"));
  const params = [empresaId, desde, hasta];
  const [pedidos, facturas, clientes, rutas, incidencias] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE estado='cancelado')::int AS cancelados,
        COUNT(*) FILTER (WHERE estado IN ('entregado','facturado'))::int AS completados,
        COALESCE(SUM(importe),0)::numeric AS venta,
        COALESCE(SUM(importe) FILTER (WHERE estado IN ('entregado','facturado')),0)::numeric AS venta_realizada,
        COALESCE(SUM(importe) FILTER (WHERE estado IN ('entregado','facturado') AND factura_id IS NULL),0)::numeric AS pendiente_facturar_realizado,
        COALESCE(SUM(precio_colaborador),0)::numeric AS coste_colaborador,
        COALESCE(SUM(precio_colaborador) FILTER (WHERE estado IN ('entregado','facturado')),0)::numeric AS coste_colaborador_realizado,
        COALESCE(SUM(COALESCE(km_ruta,0) + COALESCE(km_vacio,0)),0)::numeric AS km,
        COALESCE(SUM(COALESCE(km_ruta,0) + COALESCE(km_vacio,0)) FILTER (WHERE estado IN ('entregado','facturado')),0)::numeric AS km_realizados,
        COALESCE(AVG(NULLIF(COALESCE(km_ruta,0) + COALESCE(km_vacio,0),0)),0)::numeric AS km_medio,
        COALESCE(AVG(EXTRACT(EPOCH FROM (fecha_descarga::timestamp - fecha_carga::timestamp))/86400) FILTER (WHERE fecha_descarga IS NOT NULL AND fecha_carga IS NOT NULL),0)::numeric AS dias_medio
      FROM pedidos
      WHERE empresa_id=$1 AND COALESCE(fecha_descarga, fecha_carga, fecha_pedido, created_at::date) BETWEEN $2 AND $3
    `, params),
    db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE estado IN ('emitida','enviada','vencida','reclamada','sin_cobrar'))::int AS pendientes,
        COUNT(*) FILTER (WHERE estado IN ('vencida','reclamada','sin_cobrar'))::int AS vencidas,
        COALESCE(SUM(total),0)::numeric AS facturado,
        COALESCE(SUM(total) FILTER (WHERE estado IN ('emitida','enviada','vencida','reclamada','sin_cobrar')),0)::numeric AS pendiente_cobro,
        COALESCE(SUM(total) FILTER (WHERE estado IN ('vencida','reclamada','sin_cobrar')),0)::numeric AS vencido
      FROM facturas
      WHERE empresa_id=$1 AND fecha BETWEEN $2 AND $3 AND estado <> 'borrador'
    `, params),
    db.query(`
      WITH pedidos_cliente AS (
        SELECT cliente_id,
               COUNT(*)::int AS pedidos,
               COUNT(*) FILTER (WHERE estado IN ('entregado','facturado'))::int AS realizados,
               COALESCE(SUM(importe),0)::numeric AS venta,
               COALESCE(SUM(importe) FILTER (WHERE estado IN ('entregado','facturado') AND factura_id IS NULL),0)::numeric AS pendiente_facturar_realizado,
               COALESCE(SUM(precio_colaborador) FILTER (WHERE estado IN ('entregado','facturado')),0)::numeric AS coste_realizado
          FROM pedidos
         WHERE empresa_id=$1
           AND COALESCE(fecha_descarga,fecha_carga,fecha_pedido,created_at::date) BETWEEN $2 AND $3
         GROUP BY cliente_id
      ),
      facturas_cliente AS (
        SELECT cliente_id,
               COUNT(*) FILTER (WHERE estado <> 'borrador')::int AS facturas,
               COALESCE(SUM(total) FILTER (WHERE estado <> 'borrador'),0)::numeric AS facturado,
               COALESCE(SUM(total) FILTER (WHERE estado IN ('vencida','reclamada','sin_cobrar')),0)::numeric AS deuda_vencida
          FROM facturas
         WHERE empresa_id=$1 AND fecha BETWEEN $2 AND $3
         GROUP BY cliente_id
      )
      SELECT c.id, c.nombre,
             COALESCE(pc.pedidos,0)::int AS pedidos,
             COALESCE(pc.realizados,0)::int AS realizados,
             COALESCE(fc.facturas,0)::int AS facturas,
             COALESCE(pc.venta,0)::numeric AS venta,
             COALESCE(fc.facturado,0)::numeric AS facturado,
             COALESCE(pc.pendiente_facturar_realizado,0)::numeric AS pendiente_facturar_realizado,
             (COALESCE(fc.facturado,0) + COALESCE(pc.pendiente_facturar_realizado,0))::numeric AS ingreso_gestionado,
             COALESCE(pc.coste_realizado,0)::numeric AS coste,
             (COALESCE(fc.facturado,0) + COALESCE(pc.pendiente_facturar_realizado,0) - COALESCE(pc.coste_realizado,0))::numeric AS margen,
             COALESCE(fc.deuda_vencida,0)::numeric AS deuda_vencida
        FROM clientes c
        LEFT JOIN pedidos_cliente pc ON pc.cliente_id=c.id
        LEFT JOIN facturas_cliente fc ON fc.cliente_id=c.id
       WHERE c.empresa_id=$1
         AND (COALESCE(pc.pedidos,0)>0 OR COALESCE(fc.facturas,0)>0)
       ORDER BY ingreso_gestionado DESC NULLS LAST, margen DESC NULLS LAST
       LIMIT 12
    `, params),
    db.query(`
      SELECT COALESCE(NULLIF(origen,''),'Sin origen') AS origen,
             COALESCE(NULLIF(destino,''),'Sin destino') AS destino,
             COUNT(*)::int AS viajes,
             COALESCE(AVG(NULLIF(COALESCE(km_ruta,0) + COALESCE(km_vacio,0),0)),0)::numeric AS km_medio,
             COALESCE(SUM(importe),0)::numeric AS venta,
             COALESCE(SUM(importe - COALESCE(precio_colaborador,0)),0)::numeric AS margen
        FROM pedidos
       WHERE empresa_id=$1 AND COALESCE(fecha_carga,fecha_pedido,created_at::date) BETWEEN $2 AND $3
         AND estado <> 'cancelado'
       GROUP BY 1,2
       ORDER BY viajes DESC, margen DESC
       LIMIT 10
    `, params),
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado='pendiente')::int AS solicitudes_pendientes,
        (SELECT COUNT(*) FROM factura_registros_fiscales WHERE empresa_id=$1 AND estado_envio='error')::int AS errores_fiscales,
        (SELECT COUNT(*) FROM pedido_docs pd JOIN pedidos p ON p.id=pd.pedido_id WHERE pd.empresa_id=$1 AND pd.created_at::date BETWEEN $2 AND $3)::int AS documentos_periodo
      FROM portal_solicitudes_cliente
      WHERE empresa_id=$1 AND created_at::date BETWEEN $2 AND $3
    `, params).catch(() => ({ rows:[{}] })),
  ]);
  const p = pedidos.rows[0] || {};
  const venta = Number(p.venta || 0);
  const ventaRealizada = Number(p.venta_realizada || 0);
  const pendienteFacturarRealizado = Number(p.pendiente_facturar_realizado || 0);
  const facturado = Number(facturas.rows[0]?.facturado || 0);
  const ingresoGestionado = facturado + pendienteFacturarRealizado;
  const coste = Number(p.coste_colaborador_realizado || 0);
  const margen = ingresoGestionado - coste;
  res.json({
    periodo: { desde, hasta },
    kpis: {
      pedidos: Number(p.total || 0),
      completados: Number(p.completados || 0),
      cancelados: Number(p.cancelados || 0),
      venta: round2(venta),
      venta_realizada: round2(ventaRealizada),
      pendiente_facturar_realizado: round2(pendienteFacturarRealizado),
      ingreso_gestionado: round2(ingresoGestionado),
      coste_colaborador: round2(coste),
      margen: round2(margen),
      margen_pct: ingresoGestionado > 0 ? round2((margen / ingresoGestionado) * 100) : 0,
      eur_km: Number(p.km_realizados || 0) > 0 ? round2(ingresoGestionado / Number(p.km_realizados || 0)) : 0,
      km_medio: round2(p.km_medio),
      dias_medio: round2(p.dias_medio),
      facturado: round2(facturado),
      pendiente_cobro: round2(facturas.rows[0]?.pendiente_cobro),
      vencido: round2(facturas.rows[0]?.vencido),
    },
    clientes: clientes.rows.map(r => ({
      ...r,
      venta: round2(r.venta),
      facturado: round2(r.facturado),
      pendiente_facturar_realizado: round2(r.pendiente_facturar_realizado),
      ingreso_gestionado: round2(r.ingreso_gestionado),
      coste: round2(r.coste),
      margen: round2(r.margen),
      margen_pct: Number(r.ingreso_gestionado || 0) > 0 ? round2((Number(r.margen || 0) / Number(r.ingreso_gestionado || 0)) * 100) : 0,
      deuda_vencida: round2(r.deuda_vencida),
    })),
    rutas: rutas.rows.map(r => ({ ...r, venta: round2(r.venta), margen: round2(r.margen), km_medio: round2(r.km_medio) })),
    alertas: incidencias.rows[0] || {},
  });
});

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function hasEmail(value) {
  const raw = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

let retornoSolicitudesSchemaReady = null;
function ensureRetornoSolicitudesSchema() {
  if (!retornoSolicitudesSchemaReady) {
    retornoSolicitudesSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS retorno_carrier_solicitudes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL,
        pedido_id UUID NOT NULL,
        base_pedido_id UUID,
        carrier_id UUID NOT NULL,
        destinatario TEXT NOT NULL,
        asunto TEXT NOT NULL,
        cuerpo TEXT NOT NULL,
        estado VARCHAR(30) NOT NULL DEFAULT 'enviada',
        simulado BOOLEAN NOT NULL DEFAULT false,
        email_message_id TEXT,
        bloqueantes JSONB NOT NULL DEFAULT '[]'::jsonb,
        avisos JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by UUID,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => Promise.all([
      db.query("ALTER TABLE retorno_carrier_solicitudes ADD COLUMN IF NOT EXISTS notas TEXT"),
      db.query("ALTER TABLE retorno_carrier_solicitudes ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ"),
      db.query("ALTER TABLE retorno_carrier_solicitudes ADD COLUMN IF NOT EXISTS pedido_asignado_at TIMESTAMPTZ"),
      db.query("ALTER TABLE retorno_carrier_solicitudes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ"),
      db.query("CREATE INDEX IF NOT EXISTS idx_retorno_carrier_solicitudes_empresa_fecha ON retorno_carrier_solicitudes(empresa_id, sent_at DESC)"),
      db.query("CREATE INDEX IF NOT EXISTS idx_retorno_carrier_solicitudes_pedido ON retorno_carrier_solicitudes(empresa_id, pedido_id, sent_at DESC)"),
      db.query("CREATE INDEX IF NOT EXISTS idx_retorno_carrier_solicitudes_carrier ON retorno_carrier_solicitudes(empresa_id, carrier_id, sent_at DESC)"),
    ])).catch(err => {
      retornoSolicitudesSchemaReady = null;
      throw err;
    });
  }
  return retornoSolicitudesSchemaReady;
}

let choferVacacionesSchemaReady = null;
function ensureChoferVacacionesSchemaForInformes() {
  if (!choferVacacionesSchemaReady) {
    choferVacacionesSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS chofer_vacaciones_solicitudes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        chofer_id UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL,
        dias NUMERIC(8,2) NOT NULL DEFAULT 0,
        motivo TEXT,
        firma_solicitud JSONB NOT NULL DEFAULT '{}'::jsonb,
        firma_aceptacion JSONB NOT NULL DEFAULT '{}'::jsonb,
        aprobado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        aprobado_at TIMESTAMPTZ,
        rechazado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        rechazado_at TIMESTAMPTZ,
        observaciones TEXT,
        aviso_id VARCHAR(80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => Promise.all([
      db.query("CREATE INDEX IF NOT EXISTS idx_chofer_vacaciones_empresa_estado ON chofer_vacaciones_solicitudes(empresa_id, estado, fecha_inicio)"),
      db.query("CREATE INDEX IF NOT EXISTS idx_chofer_vacaciones_chofer ON chofer_vacaciones_solicitudes(empresa_id, chofer_id, fecha_inicio DESC)"),
    ])).catch(err => {
      choferVacacionesSchemaReady = null;
      throw err;
    });
  }
  return choferVacacionesSchemaReady;
}

function pct(part, total) {
  const p = Number(part || 0);
  const t = Number(total || 0);
  return t > 0 ? Math.round((p / t) * 100) : 100;
}

function readinessFor(item, checks = []) {
  const normalized = checks.map(check => ({ ...check, ok: !!check.ok, required: check.required !== false }));
  const totalWeight = normalized.reduce((sum, check) => sum + (check.required ? 2 : 1), 0);
  const okWeight = normalized.reduce((sum, check) => sum + (check.ok ? (check.required ? 2 : 1) : 0), 0);
  const score = totalWeight ? Math.round((okWeight / totalWeight) * 100) : 100;
  const missing = normalized.filter(check => !check.ok).map(check => ({
    key: check.key,
    label: check.label,
    required: check.required,
    category: check.category || "general",
  }));
  return {
    ...item,
    score,
    estado: score >= 90 ? "verde" : score >= 70 ? "amarillo" : "rojo",
    missing,
    missing_required: missing.filter(x => x.required).length,
    missing_optional: missing.filter(x => !x.required).length,
  };
}

function summarizeReadiness(items = []) {
  const total = items.length;
  const completos = items.filter(x => Number(x.score || 0) >= 90 && Number(x.missing_required || 0) === 0).length;
  const requiredMissing = items.reduce((sum, item) => sum + Number(item.missing_required || 0), 0);
  const avgScore = total ? Math.round(items.reduce((sum, item) => sum + Number(item.score || 0), 0) / total) : 100;
  return {
    total,
    completos,
    incompletos: total - completos,
    pct_completo: pct(completos, total),
    score_medio: avgScore,
    faltantes_obligatorios: requiredMissing,
  };
}

function estadoPedidoLabel(estado) {
  const labels = {
    pendiente: "Pendiente",
    confirmado: "Confirmado",
    en_curso: "En ruta",
    descarga: "En descarga",
    entregado: "Entregado",
    facturado: "Facturado",
    cancelado: "Cancelado",
    incidencia: "Incidencia",
  };
  return labels[String(estado || "").toLowerCase()] || String(estado || "-").replace(/_/g, " ");
}

function normalizeLocationKey(value) {
  const raw = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(cp|poligono|pol|calle|avda|avenida|ctra|carretera)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return raw.split(/\s+/).slice(0, 4).join(" ");
}

function toDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function diffDays(a, b) {
  const da = toDateOnly(a);
  const db = toDateOnly(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function controlTowerNextActions(item = {}) {
  const openPedido = { key: "abrir_pedido", label: "Abrir pedido", view: "pedidos", primary: true };
  const actionsByType = {
    incidencia_pedido: [
      { key: "revisar_incidencia", label: "Revisar incidencia", view: "pedidos", primary: true },
      { key: "reasignar", label: "Reasignar recurso", view: "gestion_trafico" },
      { key: "notificar_cliente", label: "Notificar al cliente", view: "pedidos" },
    ],
    retraso: [
      { key: "notificar_cliente", label: "Notificar al cliente", view: "pedidos", primary: true },
      { key: "reasignar", label: "Reasignar recurso", view: "gestion_trafico" },
      { key: "actualizar_eta", label: "Actualizar ETA", view: "gestion_trafico" },
    ],
    sin_asignar: [
      { key: "asignar_recurso", label: "Asignar camion/chofer", view: "gestion_trafico", primary: true },
      { key: "buscar_colaborador", label: "Buscar colaborador", view: "pedidos" },
    ],
    sin_precio: [
      { key: "completar_precio", label: "Completar precio", view: "pedidos", primary: true },
      { key: "simular_margen", label: "Simular margen", view: "pedidos" },
    ],
    margen_bajo: [
      { key: "revisar_costes", label: "Revisar costes", view: "pedidos", primary: true },
      { key: "buscar_retorno", label: "Buscar retorno", view: "gestion_trafico" },
      { key: "renegociar_precio", label: "Renegociar precio", view: "pedidos" },
    ],
    pod_pendiente: [
      { key: "pedir_albaran", label: "Pedir albaran/POD", view: "pedidos", primary: true },
      { key: "bloquear_factura", label: "Mantener bloqueo factura", view: "facturacion" },
    ],
    facturacion_inconsistente: [
      { key: "revisar_factura", label: "Revisar factura vinculada", view: "facturacion", primary: true },
      { key: "devolver_entregado", label: "Devolver a entregado", view: "pedidos", requires_confirmation: true },
    ],
    cobro_riesgo: [
      { key: "reclamar_cobro", label: "Reclamar cobro", view: "facturacion", primary: true },
      { key: "abrir_control_cobros", label: "Abrir control cobros", view: "facturacion" },
    ],
    gps_sin_senal: [
      { key: "revisar_gps", label: "Revisar GPS", view: "vehiculos", primary: true },
      { key: "contactar_conductor", label: "Contactar conductor", view: "gestion_trafico" },
    ],
    deca_pendiente: [
      { key: "generar_deca", label: "Generar DeCA", view: "pedidos", primary: true },
      { key: "revisar_dcd", label: "Revisar DCD", view: "pedidos" },
    ],
    efti_pendiente: [
      { key: "preparar_efti", label: "Preparar eFTI", view: "pedidos", primary: true },
      { key: "revisar_datos", label: "Revisar datos maestros", view: "pedidos" },
    ],
    regulatory_blocking: [
      { key: "resolver_checklist", label: "Resolver checklist", view: "pedidos", primary: true },
      { key: "abrir_cumplimiento", label: "Abrir cumplimiento", view: "gestion_trafico" },
    ],
    espera_carga: [
      { key: "confirmar_espera", label: "Confirmar espera", view: "gestion_trafico", primary: true },
      { key: "avisar_cliente", label: "Avisar cliente", view: "pedidos" },
    ],
    espera_descarga: [
      { key: "confirmar_espera", label: "Confirmar espera", view: "gestion_trafico", primary: true },
      { key: "avisar_cliente", label: "Avisar cliente", view: "pedidos" },
    ],
    vacaciones_pendientes: [
      { key: "resolver_vacaciones", label: "Resolver vacaciones", view: "choferes", primary: true },
      { key: "ver_cuadrante", label: "Ver cuadrante", view: "cuadrante_choferes" },
    ],
  };
  return actionsByType[item.type] || [openPedido];
}

function controlTowerBuckets(item = {}) {
  const type = String(item.type || "");
  const area = String(item.area || "").toLowerCase();
  const severity = String(item.severity || "").toLowerCase();
  const buckets = new Set();

  if (["incidencia_pedido", "retraso", "sin_asignar", "gps_sin_senal", "espera_carga", "espera_descarga"].includes(type)) {
    buckets.add("hoy");
  }
  if (["critica", "alta"].includes(severity) || ["pod_pendiente", "facturacion_inconsistente", "gps_sin_senal", "deca_pendiente", "efti_pendiente", "regulatory_blocking", "vacaciones_pendientes"].includes(type)) {
    buckets.add("riesgos");
  }
  if (
    area.includes("rentabilidad") ||
    area.includes("cobro") ||
    area.includes("facturacion") ||
    ["sin_precio", "margen_bajo", "cobro_riesgo", "facturacion_inconsistente"].includes(type)
  ) {
    buckets.add("rentabilidad");
  }
  if (type === "incidencia_pedido") {
    buckets.add("incidencias");
  }
  if (area.includes("recursos") || ["vacaciones_pendientes"].includes(type)) {
    buckets.add("recursos");
  }
  if (area.includes("cumplimiento") || ["deca_pendiente", "efti_pendiente", "regulatory_blocking"].includes(type)) {
    buckets.add("documentos");
  }

  return Array.from(buckets);
}

function enrichControlTowerItem(item = {}) {
  return {
    ...item,
    buckets: Array.isArray(item.buckets) && item.buckets.length ? item.buckets : controlTowerBuckets(item),
    next_actions: Array.isArray(item.next_actions) && item.next_actions.length
      ? item.next_actions
      : controlTowerNextActions(item),
  };
}

function kpiDeviation(actual, objetivo, inverse = false) {
  const target = Number(objetivo || 0);
  if (!target) return { objetivo: null, actual: Number(actual || 0), diferencia: null, pct: null, ok: null };
  const value = Number(actual || 0);
  const diferencia = value - target;
  const pct = target ? (diferencia / target) * 100 : null;
  return {
    objetivo: target,
    actual: value,
    diferencia,
    pct: pct == null ? null : Number(pct.toFixed(1)),
    ok: inverse ? value <= target : value >= target,
  };
}

const SLA_HORAS_EXCEPCION = {
  critica: 8,
  alta: 24,
  media: 72,
  baja: 120,
  info: 168,
};

function calcularSlaExcepcion(item, track) {
  const slaHoras = SLA_HORAS_EXCEPCION[item.severity] || SLA_HORAS_EXCEPCION.info;
  const firstSeen = track?.first_seen_at || track?.last_seen_at || new Date();
  const firstSeenDate = new Date(firstSeen);
  const edadHoras = Number.isFinite(firstSeenDate.getTime())
    ? Math.max(0, Math.round((Date.now() - firstSeenDate.getTime()) / 3600000))
    : 0;
  return {
    horas_objetivo: slaHoras,
    horas_abierta: edadHoras,
    vencida: edadHoras > slaHoras,
    first_seen_at: track?.first_seen_at || null,
    last_seen_at: track?.last_seen_at || null,
  };
}

async function avisarBajadaRendimiento(empresaId, userId, desde, hasta) {
  if (!empresaId) return;
  const start = new Date(`${desde}T00:00:00`);
  const end = new Date(`${hasta}T23:59:59`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return;
  const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  const toDate = (d) => d.toISOString().slice(0, 10);
  const metricas = await db.query(
    `WITH actual AS (
       SELECT COALESCE(SUM(importe),0) AS facturacion,
              COALESCE(SUM(COALESCE(km_ruta,0) + COALESCE(km_vacio,0)),0) AS km,
              COUNT(*) AS viajes
         FROM pedidos
        WHERE empresa_id=$1 AND fecha_carga BETWEEN $2 AND $3 AND estado NOT IN ('cancelado')
     ), anterior AS (
       SELECT COALESCE(SUM(importe),0) AS facturacion,
              COALESCE(SUM(COALESCE(km_ruta,0) + COALESCE(km_vacio,0)),0) AS km,
              COUNT(*) AS viajes
         FROM pedidos
        WHERE empresa_id=$1 AND fecha_carga BETWEEN $4 AND $5 AND estado NOT IN ('cancelado')
     )
     SELECT actual.facturacion AS facturacion_actual,
            anterior.facturacion AS facturacion_anterior,
            actual.km AS km_actual,
            anterior.km AS km_anterior,
            actual.viajes AS viajes_actual,
            anterior.viajes AS viajes_anterior
       FROM actual, anterior`,
    [empresaId, desde, hasta, toDate(prevStart), toDate(prevEnd)]
  ).catch(() => ({ rows: [] }));
  const m = metricas.rows[0] || {};
  const factActual = Number(m.facturacion_actual || 0);
  const factAnterior = Number(m.facturacion_anterior || 0);
  const eurKmActual = Number(m.km_actual || 0) > 0 ? factActual / Number(m.km_actual || 0) : null;
  const eurKmAnterior = Number(m.km_anterior || 0) > 0 ? factAnterior / Number(m.km_anterior || 0) : null;
  const avisos = [];
  if (factAnterior > 0 && factActual < factAnterior * 0.8) avisos.push(`facturacion ${Math.round((1 - factActual / factAnterior) * 100)}% por debajo del periodo anterior`);
  if (eurKmAnterior && eurKmActual != null && eurKmActual < eurKmAnterior * 0.85) avisos.push(`EUR/km ${Math.round((1 - eurKmActual / eurKmAnterior) * 100)}% por debajo del periodo anterior`);
  if (!avisos.length) return;
  const titulo = "Bajada de rendimiento detectada";
  const existing = await db.query(
    `SELECT id FROM notificaciones_internas
      WHERE empresa_id=$1 AND tipo='kpi_rendimiento' AND titulo=$2 AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1`,
    [empresaId, titulo]
  ).catch(() => ({ rows: [] }));
  if (existing.rows[0]) return;
  const gerentes = await db.query(
    "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('gerente','admin')",
    [empresaId]
  ).catch(() => ({ rows: [] }));
  const destinatarios = gerentes.rows.length ? gerentes.rows : (userId ? [{ id: userId }] : []);
  await Promise.all(destinatarios.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo: "kpi_rendimiento",
    titulo,
    mensaje: `Revisa KPIs: ${avisos.join("; ")}.`,
    data: { desde, hasta, facturacion_actual: factActual, facturacion_anterior: factAnterior, eur_km_actual: eurKmActual, eur_km_anterior: eurKmAnterior },
    created_by: userId || null,
  }).catch(() => null)));
}

let excepcionesSchemaReady = null;
function ensureExcepcionesSchema() {
  if (!excepcionesSchemaReady) {
    excepcionesSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS excepciones_operativas (
        empresa_id UUID NOT NULL,
        exception_key VARCHAR(180) NOT NULL,
        estado VARCHAR(30) NOT NULL DEFAULT 'abierta',
        nota TEXT,
        asignado_a UUID,
        posponer_hasta DATE,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by UUID,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (empresa_id, exception_key)
      )
    `).then(() => db.query(
      "CREATE INDEX IF NOT EXISTS idx_excepciones_operativas_estado ON excepciones_operativas(empresa_id, estado, posponer_hasta)"
    )).catch(err => {
      excepcionesSchemaReady = null;
      throw err;
    });
  }
  return excepcionesSchemaReady;
}

router.get("/gestion", cacheMiddleware(30), async (req, res) => {
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
  const period = req.query.period || "30d";
  const { desde, hasta } = req.query.desde && req.query.hasta
    ? { desde: req.query.desde, hasta: req.query.hasta }
    : rangoPeriodo(period);

  const [facturas, pedidos, flota, taller, objetivos] = await Promise.all([
    db.query(`
      SELECT
        COALESCE(SUM(total),0) AS total,
        COALESCE(SUM(CASE WHEN estado='cobrada' THEN total ELSE 0 END),0) AS cobrado,
        COALESCE(SUM(CASE WHEN estado IN ('emitida','enviada','vencida') THEN total ELSE 0 END),0) AS pendiente,
        COALESCE(SUM(CASE WHEN estado='vencida' THEN total ELSE 0 END),0) AS vencido,
        COUNT(*) AS num_facturas
      FROM facturas
      WHERE empresa_id=$1 AND fecha BETWEEN $2 AND $3 AND estado != 'rectificada'
    `, [empresaId, desde, hasta]),
    db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE estado='entregado') AS entregados,
        COUNT(*) FILTER (WHERE estado IN ('en_curso','descarga')) AS en_curso,
        COUNT(*) FILTER (WHERE estado='incidencia') AS incidencias,
        COALESCE(SUM(importe),0) AS importe_pedidos,
        COALESCE(SUM(COALESCE(coste_gasoil,0)+COALESCE(coste_peajes,0)+COALESCE(coste_dietas,0)+COALESCE(coste_otros,0)),0) AS coste_pedidos,
        COALESCE(SUM(COALESCE(km_ruta,0)),0) AS km_ruta,
        COALESCE(SUM(COALESCE(km_vacio,0)),0) AS km_vacio
      FROM pedidos
      WHERE empresa_id=$1
        AND COALESCE(fecha_pedido, fecha_carga::date, created_at::date) BETWEEN $2 AND $3
        AND estado != 'cancelado'
    `, [empresaId, desde, hasta]).catch(() => ({ rows: [{ total:0, entregados:0, en_curso:0, incidencias:0, importe_pedidos:0, coste_pedidos:0, km_ruta:0, km_vacio:0 }] })),
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE activo IS DISTINCT FROM false) AS vehiculos_activos,
        COUNT(*) FILTER (WHERE estado='disponible') AS vehiculos_disponibles,
        COUNT(*) FILTER (WHERE estado='taller') AS vehiculos_taller
      FROM vehiculos
      WHERE empresa_id=$1
    `, [empresaId]),
    db.query("SELECT data FROM taller_estado WHERE empresa_id=$1", [empresaId]).catch(() => ({ rows: [] })),
    db.query(
      `SELECT *
         FROM objetivos_kpi
        WHERE empresa_id=$1 AND periodo IN ($2, 'mensual')
        ORDER BY CASE WHEN periodo=$2 THEN 0 ELSE 1 END
        LIMIT 1`,
      [empresaId, String(req.query.objetivo_periodo || period || "mensual")]
    ).catch(() => ({ rows: [] })),
  ]);

  const tallerData = taller.rows[0]?.data || {};
  const reparaciones = asArray(tallerData.reparaciones).filter(r => {
    if (!r.fecha) return true;
    return r.fecha >= desde && r.fecha <= hasta;
  });
  const stock = asArray(tallerData.stock);
  const solicitudes = asArray(tallerData.solicitudes_mecanico);
  const tareas = asArray(tallerData.tareas_mecanicos);
  const avisos = asArray(tallerData.avisos_mant);
  const costeTaller = reparaciones.reduce((s, r) => s + Number(r.coste_total || 0), 0);
  const factData = facturas.rows[0] || {};
  const pedidoData = pedidos.rows[0] || {};
  const kmRuta = Number(pedidoData.km_ruta || 0);
  const kmVacio = Number(pedidoData.km_vacio || 0);
  const kmTotales = kmRuta + kmVacio;
  const pctKmVacio = kmTotales > 0 ? (kmVacio / kmTotales) * 100 : 0;
  const objetivo = objetivos.rows[0] || null;
  const tallerPendientes = solicitudes.filter(s => s.estado === "pendiente").length;
  const stockBajo = stock.filter(s => Number(s.stock_actual || 0) <= Number(s.stock_minimo || 0)).length;
  const margenEstimado = Number(pedidoData.importe_pedidos || 0) - Number(pedidoData.coste_pedidos || 0) - costeTaller;
  const salud = [
    Number(factData.vencido || 0) > 0 && {
      nivel: "critico",
      area: "Cobros",
      mensaje: `${Number(factData.vencido || 0).toLocaleString("es-ES")} EUR vencidos pendientes de seguimiento.`,
    },
    Number(pedidoData.incidencias || 0) > 0 && {
      nivel: "alerta",
      area: "Trafico",
      mensaje: `${Number(pedidoData.incidencias || 0)} pedido(s) con incidencia abierta.`,
    },
    stockBajo > 0 && {
      nivel: "alerta",
      area: "Taller",
      mensaje: `${stockBajo} referencia(s) de stock por debajo del minimo.`,
    },
    tallerPendientes > 0 && {
      nivel: "info",
      area: "Taller",
      mensaje: `${tallerPendientes} solicitud(es) de taller pendientes.`,
    },
    margenEstimado < 0 && {
      nivel: "critico",
      area: "Margen",
      mensaje: "El margen estimado del periodo es negativo.",
    },
  ].filter(Boolean);

  res.json({
    period,
    desde,
    hasta,
    facturacion: {
      total: Number(facturas.rows[0]?.total || 0),
      cobrado: Number(facturas.rows[0]?.cobrado || 0),
      pendiente: Number(facturas.rows[0]?.pendiente || 0),
      vencido: Number(facturas.rows[0]?.vencido || 0),
      num_facturas: Number(facturas.rows[0]?.num_facturas || 0),
    },
    pedidos: {
      total: Number(pedidos.rows[0]?.total || 0),
      entregados: Number(pedidos.rows[0]?.entregados || 0),
      en_curso: Number(pedidos.rows[0]?.en_curso || 0),
      incidencias: Number(pedidos.rows[0]?.incidencias || 0),
      importe: Number(pedidos.rows[0]?.importe_pedidos || 0),
      coste: Number(pedidos.rows[0]?.coste_pedidos || 0),
      km_ruta: kmRuta,
      km_vacio: kmVacio,
      km_totales: kmTotales,
      pct_km_vacio: Number(pctKmVacio.toFixed(1)),
    },
    flota: {
      activos: Number(flota.rows[0]?.vehiculos_activos || 0),
      disponibles: Number(flota.rows[0]?.vehiculos_disponibles || 0),
      taller: Number(flota.rows[0]?.vehiculos_taller || 0),
    },
    taller: {
      intervenciones: reparaciones.length,
      coste: costeTaller,
      stock_bajo: stock.filter(s => Number(s.stock_actual || 0) <= Number(s.stock_minimo || 0)).length,
      solicitudes_pendientes: solicitudes.filter(s => s.estado === "pendiente").length,
      tareas_abiertas: tareas.filter(t => ["pendiente","en_curso"].includes(t.estado)).length,
      avisos_activos: avisos.filter(a => a.activo !== false && a.estado !== "resuelto").length,
    },
    objetivos: {
      configurado: !!objetivo,
      periodo: objetivo?.periodo || null,
      metas: objetivo ? {
        facturacion: objetivo.facturacion == null ? null : Number(objetivo.facturacion),
        km_totales: objetivo.km_totales == null ? null : Number(objetivo.km_totales),
        pct_km_vacio: objetivo.pct_km_vacio == null ? null : Number(objetivo.pct_km_vacio),
        pedidos: objetivo.pedidos == null ? null : Number(objetivo.pedidos),
        coste_taller: objetivo.coste_taller == null ? null : Number(objetivo.coste_taller),
        margen: objetivo.margen == null ? null : Number(objetivo.margen),
      } : {},
      desviaciones: {
        facturacion: kpiDeviation(Number(facturas.rows[0]?.total || 0), objetivo?.facturacion),
        pedidos: kpiDeviation(Number(pedidos.rows[0]?.total || 0), objetivo?.pedidos),
        km_totales: kpiDeviation(kmTotales, objetivo?.km_totales),
        pct_km_vacio: kpiDeviation(pctKmVacio, objetivo?.pct_km_vacio, true),
        coste_taller: kpiDeviation(costeTaller, objetivo?.coste_taller, true),
        margen: kpiDeviation(margenEstimado, objetivo?.margen),
      },
    },
    salud,
  });
});

// ── GET /informes/dashboard ───────────────────────────
router.get("/rentabilidad-operativa", cacheMiddleware(30), async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    const period = String(req.query.period || "30d");
    const { desde, hasta } = req.query.desde && req.query.hasta
      ? { desde: req.query.desde, hasta: req.query.hasta }
      : rangoPeriodo(period);

    const { rows } = await db.query(`
      WITH extras AS (
        SELECT pe.pedido_id, COALESCE(SUM(COALESCE(pe.importe,0)),0) AS coste_extra
          FROM pedido_extracostes pe
          JOIN pedidos p2 ON p2.id=pe.pedido_id
         WHERE p2.empresa_id=$1
         GROUP BY pe.pedido_id
      ), docs AS (
        SELECT pd.pedido_id,
               COUNT(*)::int AS documentos,
               COUNT(*) FILTER (
                 WHERE LOWER(COALESCE(pd.tipo,'')) LIKE '%albaran%'
                    OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albaran%'
                    OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                    OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                    OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                    OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
               )::int AS albaranes
          FROM pedido_docs pd
         WHERE pd.empresa_id=$1
         GROUP BY pd.pedido_id
      )
      SELECT p.id,
             p.numero,
             p.estado::text AS estado,
             p.origen,
             p.destino,
             COALESCE(p.fecha_carga::date, p.fecha_pedido, p.created_at::date) AS fecha,
             c.nombre AS cliente_nombre,
             COALESCE(NULLIF(p.importe,0), NULLIF(p.precio_cliente_col,0), NULLIF(p.precio_unitario,0), 0)
               + COALESCE(p.importe_paralizacion,0) AS ingreso,
             CASE
               WHEN p.colaborador_id IS NOT NULL THEN COALESCE(p.precio_colaborador,0)
               ELSE COALESCE(p.coste_gasoil,0)+COALESCE(p.coste_peajes,0)+COALESCE(p.coste_dietas,0)+COALESCE(p.coste_otros,0)
             END + COALESCE(extras.coste_extra,0) AS coste,
             COALESCE(p.km_ruta,0) AS km_ruta,
             COALESCE(p.km_vacio,0) AS km_vacio,
             p.colaborador_id IS NOT NULL AS es_colaborador,
             COALESCE(docs.documentos,0) AS documentos,
             COALESCE(docs.albaranes,0) AS albaranes,
             f.estado::text AS factura_estado
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN extras ON extras.pedido_id=p.id
        LEFT JOIN docs ON docs.pedido_id=p.id
        LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
       WHERE p.empresa_id=$1
         AND p.estado::text <> 'cancelado'
         AND COALESCE(p.fecha_carga::date, p.fecha_pedido, p.created_at::date) BETWEEN $2 AND $3
       ORDER BY fecha DESC NULLS LAST, p.created_at DESC
       LIMIT 1500
    `, [empresaId, desde, hasta]);

    const pedidos = rows.map((p) => {
      const ingreso = round2(p.ingreso);
      const coste = round2(p.coste);
      const margen = round2(ingreso - coste);
      const margenPct = ingreso > 0 ? round2((margen / ingreso) * 100) : null;
      const km = Number(p.km_ruta || 0) + Number(p.km_vacio || 0);
      const estado = String(p.estado || "").toLowerCase();
      const riesgos = [];
      if (ingreso <= 0) riesgos.push({ tipo: "sin_precio", severidad: "alta", label: "Sin precio" });
      if (p.es_colaborador && coste <= 0) riesgos.push({ tipo: "colaborador_sin_coste", severidad: "alta", label: "Colaborador sin coste" });
      if (ingreso > 0 && margen < 0) riesgos.push({ tipo: "margen_negativo", severidad: "critica", label: "Margen negativo" });
      else if (ingreso > 0 && margenPct !== null && margenPct < 8) riesgos.push({ tipo: "margen_bajo", severidad: "media", label: "Margen bajo" });
      if (km <= 0) riesgos.push({ tipo: "sin_km", severidad: "media", label: "Sin km" });
      if (["entregado", "facturado"].includes(estado) && Number(p.albaranes || 0) <= 0) {
        riesgos.push({ tipo: "pod_pendiente", severidad: "alta", label: "POD pendiente" });
      }
      if (String(p.factura_estado || "").toLowerCase() === "vencida") {
        riesgos.push({ tipo: "cobro_vencido", severidad: "alta", label: "Cobro vencido" });
      }
      const recomendacion = riesgos.some(r => r.tipo === "margen_negativo")
        ? "Revisar precio/coste antes de repetir esta operacion."
        : riesgos.some(r => r.tipo === "sin_precio" || r.tipo === "sin_km")
          ? "Completar datos economicos y kilometros."
          : riesgos.some(r => r.tipo === "margen_bajo")
            ? "Aceptar solo con retorno, extra recuperable o motivo comercial."
            : riesgos.length
              ? "Operacion viable, con seguimiento documental o de cobro."
              : "Operacion saneada con los datos actuales.";
      return {
        id: p.id,
        numero: p.numero,
        fecha: p.fecha,
        cliente: p.cliente_nombre || "Sin cliente",
        origen: p.origen || "",
        destino: p.destino || "",
        estado: p.estado,
        ingreso,
        coste,
        margen,
        margen_pct: margenPct,
        eur_km: km > 0 ? round2(ingreso / km) : null,
        km: round2(km),
        documentos: Number(p.documentos || 0),
        albaranes: Number(p.albaranes || 0),
        riesgos,
        recomendacion,
      };
    });

    const resumen = pedidos.reduce((acc, p) => {
      acc.pedidos += 1;
      acc.ingreso += p.ingreso;
      acc.coste += p.coste;
      acc.margen += p.margen;
      acc.km += Number(p.km || 0);
      if (p.margen < 0) acc.margen_negativo += 1;
      if (p.margen_pct !== null && p.margen_pct < 8) acc.margen_bajo += 1;
      if (p.riesgos.some(r => r.tipo === "sin_precio")) acc.sin_precio += 1;
      if (p.riesgos.some(r => r.tipo === "sin_km")) acc.sin_km += 1;
      if (p.riesgos.some(r => r.tipo === "pod_pendiente")) acc.pod_pendiente += 1;
      if (p.riesgos.some(r => r.tipo === "cobro_vencido")) acc.cobro_vencido += 1;
      return acc;
    }, {
      pedidos: 0, ingreso: 0, coste: 0, margen: 0, km: 0,
      margen_negativo: 0, margen_bajo: 0, sin_precio: 0, sin_km: 0,
      pod_pendiente: 0, cobro_vencido: 0,
    });
    resumen.ingreso = round2(resumen.ingreso);
    resumen.coste = round2(resumen.coste);
    resumen.margen = round2(resumen.margen);
    resumen.margen_pct = resumen.ingreso > 0 ? round2((resumen.margen / resumen.ingreso) * 100) : null;
    resumen.eur_km = resumen.km > 0 ? round2(resumen.ingreso / resumen.km) : null;
    resumen.km = round2(resumen.km);
    resumen.salud = resumen.margen < 0 || resumen.margen_negativo > 0
      ? "critica"
      : resumen.margen_pct !== null && resumen.margen_pct < 8
        ? "alerta"
        : "ok";

    const clientesMap = new Map();
    for (const p of pedidos) {
      const key = p.cliente || "Sin cliente";
      const item = clientesMap.get(key) || { cliente: key, pedidos: 0, ingreso: 0, coste: 0, margen: 0, riesgos: 0 };
      item.pedidos += 1;
      item.ingreso += p.ingreso;
      item.coste += p.coste;
      item.margen += p.margen;
      if (p.riesgos.length) item.riesgos += 1;
      clientesMap.set(key, item);
    }
    const por_cliente = Array.from(clientesMap.values())
      .map(c => ({
        ...c,
        ingreso: round2(c.ingreso),
        coste: round2(c.coste),
        margen: round2(c.margen),
        margen_pct: c.ingreso > 0 ? round2((c.margen / c.ingreso) * 100) : null,
      }))
      .sort((a, b) => a.margen - b.margen)
      .slice(0, 12);

    const severityOrder = { critica: 0, alta: 1, media: 2, baja: 3 };
    const riesgos = pedidos
      .filter(p => p.riesgos.length)
      .sort((a, b) => {
        const as = Math.min(...a.riesgos.map(r => severityOrder[r.severidad] ?? 9));
        const bs = Math.min(...b.riesgos.map(r => severityOrder[r.severidad] ?? 9));
        return as - bs || a.margen - b.margen;
      })
      .slice(0, 30);

    res.json({
      period,
      desde,
      hasta,
      resumen,
      riesgos,
      por_cliente,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo calcular la rentabilidad operativa" });
  }
});

router.get("/cargas-retorno", authenticate, GERENTE_O_TRAFICO, cacheMiddleware(30), async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    const period = String(req.query.period || "30d");
    const { desde, hasta } = req.query.desde && req.query.hasta
      ? { desde: req.query.desde, hasta: req.query.hasta }
      : rangoPeriodo(period);

    await ensureRetornoSolicitudesSchema();
    const [pedidosRes, carriersRes, solicitudesRes] = await Promise.all([
      db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.estado::text AS estado,
               p.fecha_carga, p.fecha_descarga, p.fecha_entrega, p.created_at,
               p.vehiculo_id, p.chofer_id, p.colaborador_id, p.factura_id,
               COALESCE(p.km_ruta,0) AS km_ruta,
               COALESCE(p.km_vacio,0) AS km_vacio,
               COALESCE(NULLIF(p.importe,0), NULLIF(p.precio_cliente_col,0), NULLIF(p.precio_unitario,0), 0)
                 + COALESCE(p.importe_paralizacion,0) AS ingreso,
               CASE
                 WHEN p.colaborador_id IS NOT NULL THEN COALESCE(p.precio_colaborador,0)
                 ELSE COALESCE(p.coste_gasoil,0)+COALESCE(p.coste_peajes,0)+COALESCE(p.coste_dietas,0)+COALESCE(p.coste_otros,0)
               END AS coste,
               c.nombre AS cliente_nombre,
               v.matricula AS vehiculo_matricula,
               CONCAT_WS(' ', ch.nombre, ch.apellidos) AS chofer_nombre
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
          LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
         WHERE p.empresa_id=$1
           AND p.estado::text <> 'cancelado'
           AND COALESCE(p.fecha_carga::date, p.created_at::date)
               BETWEEN ($2::date - INTERVAL '21 days') AND ($3::date + INTERVAL '30 days')
         ORDER BY COALESCE(p.fecha_carga, p.created_at) ASC NULLS LAST
         LIMIT 2000
      `, [empresaId, desde, hasta]),
      db.query(`
        WITH ops AS (
          SELECT p.colaborador_id,
                 COUNT(*)::int AS pedidos,
                 COUNT(*) FILTER (WHERE p.estado::text='incidencia' OR LOWER(COALESCE(p.notas,'')) LIKE '%incidencia%')::int AS incidencias,
                 COUNT(*) FILTER (WHERE COALESCE(p.precio_colaborador,0)>0 AND COALESCE(pay.documentacion_recibida,false)=false)::int AS factura_pendiente,
                 COUNT(*) FILTER (WHERE COALESCE(p.precio_colaborador,0)>0 AND COALESCE(pay.pagado,false)=false)::int AS pago_pendiente,
                 MAX(COALESCE(p.fecha_carga::date,p.created_at::date)) AS ultima_operacion
            FROM pedidos p
            LEFT JOIN pedido_colaborador_pagos pay ON pay.pedido_id=p.id AND pay.empresa_id=p.empresa_id
           WHERE p.empresa_id=$1
             AND p.colaborador_id IS NOT NULL
             AND p.estado::text <> 'cancelado'
             AND COALESCE(p.fecha_carga::date,p.created_at::date) BETWEEN $2 AND $3
           GROUP BY p.colaborador_id
        ), docs AS (
          SELECT colaborador_id,
                 COUNT(*)::int AS documentos,
                 COUNT(*) FILTER (WHERE caducidad IS NOT NULL AND caducidad < CURRENT_DATE)::int AS docs_caducados,
                 COUNT(*) FILTER (WHERE caducidad IS NOT NULL AND caducidad BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')::int AS docs_proximos
            FROM colaborador_documentos
           WHERE empresa_id=$1
           GROUP BY colaborador_id
        ), veh AS (
          SELECT colaborador_id,
                 COUNT(*) FILTER (WHERE activo IS DISTINCT FROM false)::int AS vehiculos,
                 COUNT(*) FILTER (
                   WHERE activo IS DISTINCT FROM false AND (
                     doc_itv_venc IS NULL OR doc_seguro_venc IS NULL OR doc_tarjeta_exp IS NULL
                     OR doc_itv_venc <= CURRENT_DATE + INTERVAL '30 days'
                     OR doc_seguro_venc <= CURRENT_DATE + INTERVAL '30 days'
                     OR doc_tarjeta_exp <= CURRENT_DATE + INTERVAL '30 days'
                   )
                 )::int AS vehiculos_doc_riesgo
            FROM colaborador_vehiculos
           WHERE empresa_id=$1
           GROUP BY colaborador_id
        )
        SELECT col.id, col.nombre, col.cif, col.email, col.telefono, col.valoracion,
               COALESCE(ops.pedidos,0) AS pedidos,
               COALESCE(ops.incidencias,0) AS incidencias,
               COALESCE(ops.factura_pendiente,0) AS factura_pendiente,
               COALESCE(ops.pago_pendiente,0) AS pago_pendiente,
               ops.ultima_operacion,
               COALESCE(docs.documentos,0) AS documentos,
               COALESCE(docs.docs_caducados,0) AS docs_caducados,
               COALESCE(docs.docs_proximos,0) AS docs_proximos,
               COALESCE(veh.vehiculos,0) AS vehiculos,
               COALESCE(veh.vehiculos_doc_riesgo,0) AS vehiculos_doc_riesgo
          FROM colaboradores col
          LEFT JOIN ops ON ops.colaborador_id=col.id
          LEFT JOIN docs ON docs.colaborador_id=col.id
          LEFT JOIN veh ON veh.colaborador_id=col.id
         WHERE col.empresa_id=$1
           AND COALESCE(col.activo,true)=true
         ORDER BY COALESCE(col.valoracion,5) DESC, col.nombre
         LIMIT 80
      `, [empresaId, desde, hasta]).catch(() => ({ rows: [] })),
      db.query(`
        SELECT s.id, s.pedido_id, s.base_pedido_id, s.carrier_id, s.destinatario,
               s.asunto, s.estado, s.simulado, s.email_message_id, s.notas,
               s.sent_at, s.responded_at, s.pedido_asignado_at, s.updated_at, s.created_at,
               p.numero AS pedido_numero, p.origen, p.destino,
               p.colaborador_id AS pedido_colaborador_id,
               (p.colaborador_id IS NOT NULL AND p.colaborador_id=s.carrier_id) AS pedido_asignado_a_carrier,
               bp.numero AS base_pedido_numero,
               col.nombre AS carrier_nombre
          FROM retorno_carrier_solicitudes s
          LEFT JOIN pedidos p ON p.id=s.pedido_id AND p.empresa_id=s.empresa_id
          LEFT JOIN pedidos bp ON bp.id=s.base_pedido_id AND bp.empresa_id=s.empresa_id
          LEFT JOIN colaboradores col ON col.id=s.carrier_id AND col.empresa_id=s.empresa_id
         WHERE s.empresa_id=$1
           AND s.sent_at::date BETWEEN ($2::date - INTERVAL '21 days') AND ($3::date + INTERVAL '30 days')
         ORDER BY s.sent_at DESC
         LIMIT 40
      `, [empresaId, desde, hasta]).catch(() => ({ rows: [] })),
    ]);
    const rows = pedidosRes.rows || [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pedidos = rows.map(p => {
      const baseDate = p.fecha_descarga || p.fecha_entrega || p.fecha_carga || p.created_at;
      const cargaDate = p.fecha_carga || p.created_at;
      const ingreso = round2(p.ingreso);
      const coste = round2(p.coste);
      const margen = round2(ingreso - coste);
      return {
        id: p.id,
        numero: p.numero,
        origen: p.origen || "",
        destino: p.destino || "",
        origen_key: normalizeLocationKey(p.origen),
        destino_key: normalizeLocationKey(p.destino),
        estado: p.estado,
        estado_label: estadoPedidoLabel(p.estado),
        fecha_carga: p.fecha_carga,
        fecha_descarga: p.fecha_descarga,
        fecha_entrega: p.fecha_entrega,
        base_date: baseDate,
        carga_date: cargaDate,
        vehiculo_id: p.vehiculo_id,
        vehiculo_matricula: p.vehiculo_matricula || "",
        chofer_id: p.chofer_id,
        chofer_nombre: p.chofer_nombre || "",
        colaborador_id: p.colaborador_id,
        factura_id: p.factura_id,
        cliente: p.cliente_nombre || "Sin cliente",
        km_ruta: round2(p.km_ruta),
        km_vacio: round2(p.km_vacio),
        ingreso,
        coste,
        margen,
      };
    });

    const bases = pedidos.filter(p => {
      const date = toDateOnly(p.base_date);
      if (!date || !p.destino_key || !p.vehiculo_id) return false;
      return date >= new Date(`${desde}T00:00:00`) && date <= new Date(today.getTime() + 15 * 86400000);
    });
    const candidatos = pedidos.filter(p => {
      const date = toDateOnly(p.carga_date);
      const estado = String(p.estado || "").toLowerCase();
      if (!date || !p.origen_key || p.factura_id) return false;
      return date >= new Date(today.getTime() - 86400000)
        && ["pendiente", "confirmado"].includes(estado);
    });

    const oportunidades = [];
    for (const base of bases) {
      for (const cand of candidatos) {
        if (base.id === cand.id || base.destino_key !== cand.origen_key) continue;
        const esperaDias = diffDays(base.base_date, cand.carga_date);
        if (esperaDias == null || esperaDias < 0 || esperaDias > 7) continue;
        const mismoVehiculo = cand.vehiculo_id && cand.vehiculo_id === base.vehiculo_id;
        const candidatoLibre = !cand.vehiculo_id && !cand.chofer_id && !cand.colaborador_id;
        const kmVacioEvitable = Number(base.km_vacio || 0);
        const margenCandidato = Number(cand.margen || 0);
        let score = 45;
        if (esperaDias <= 1) score += 20;
        else if (esperaDias <= 3) score += 12;
        if (candidatoLibre) score += 18;
        if (mismoVehiculo) score += 10;
        if (kmVacioEvitable >= 80) score += 12;
        else if (kmVacioEvitable > 0) score += 6;
        if (margenCandidato > 0) score += 8;
        oportunidades.push({
          id: `${base.id}-${cand.id}`,
          source: "red_interna",
          score: Math.min(100, score),
          prioridad: score >= 85 ? "alta" : score >= 65 ? "media" : "baja",
          tipo: candidatoLibre ? "asignacion_directa" : mismoVehiculo ? "mismo_vehiculo" : "revision",
          base: {
            pedido_id: base.id,
            numero: base.numero,
            cliente: base.cliente,
            origen: base.origen,
            destino: base.destino,
            fecha_descarga: base.fecha_descarga || base.fecha_entrega || base.fecha_carga,
            estado: base.estado_label,
            vehiculo_id: base.vehiculo_id,
            matricula: base.vehiculo_matricula,
            chofer: base.chofer_nombre,
            km_vacio: base.km_vacio,
          },
          candidato: {
            pedido_id: cand.id,
            numero: cand.numero,
            cliente: cand.cliente,
            origen: cand.origen,
            destino: cand.destino,
            fecha_carga: cand.fecha_carga,
            estado: cand.estado_label,
            vehiculo_id: cand.vehiculo_id,
            matricula: cand.vehiculo_matricula,
            margen: cand.margen,
          },
          espera_dias: esperaDias,
          impacto: {
            km_vacio_evitable: kmVacioEvitable,
            margen_candidato: margenCandidato,
            ahorro_estimado_label: kmVacioEvitable > 0 ? `${kmVacioEvitable} km vacio a revisar` : "Evita reposicion sin carga",
          },
          accion: candidatoLibre
            ? "Revisar y asignar este camion como retorno."
            : mismoVehiculo
              ? "Confirmar continuidad del mismo camion y ajustar horas."
              : "Revisar compatibilidad operativa antes de reasignar.",
        });
      }
    }

    oportunidades.sort((a, b) => b.score - a.score || Number(b.impacto.km_vacio_evitable || 0) - Number(a.impacto.km_vacio_evitable || 0));

    const sinRetorno = bases
      .filter(base => !oportunidades.some(o => o.base.pedido_id === base.id))
      .filter(base => Number(base.km_vacio || 0) > 0 || toDateOnly(base.base_date) >= today)
      .sort((a, b) => Number(b.km_vacio || 0) - Number(a.km_vacio || 0))
      .slice(0, 20)
      .map(base => ({
        pedido_id: base.id,
        numero: base.numero,
        cliente: base.cliente,
        destino: base.destino,
        fecha_disponible: base.fecha_descarga || base.fecha_entrega || base.fecha_carga,
        matricula: base.vehiculo_matricula,
        km_vacio: base.km_vacio,
        recomendacion: "Buscar carga de retorno externa o consolidar con proximo pedido desde la zona.",
      }));

    const origenesMap = new Map();
    for (const cand of candidatos.filter(c => !c.vehiculo_id && !c.colaborador_id)) {
      const key = cand.origen_key || "sin_origen";
      const item = origenesMap.get(key) || { zona: cand.origen || "Sin origen", pedidos: 0, margen_estimado: 0, proxima_carga: cand.fecha_carga };
      item.pedidos += 1;
      item.margen_estimado += Number(cand.margen || 0);
      if (toDateOnly(cand.fecha_carga) && (!item.proxima_carga || toDateOnly(cand.fecha_carga) < toDateOnly(item.proxima_carga))) item.proxima_carga = cand.fecha_carga;
      origenesMap.set(key, item);
    }
    const zonas_demanda = Array.from(origenesMap.values())
      .map(z => ({ ...z, margen_estimado: round2(z.margen_estimado) }))
      .sort((a, b) => b.pedidos - a.pedidos || b.margen_estimado - a.margen_estimado)
      .slice(0, 12);

    const carriers_recomendados = (carriersRes.rows || []).map(row => {
      const docs = Number(row.documentos || 0);
      const docsCaducados = Number(row.docs_caducados || 0);
      const docsProximos = Number(row.docs_proximos || 0);
      const vehiculos = Number(row.vehiculos || 0);
      const vehiculosDocRiesgo = Number(row.vehiculos_doc_riesgo || 0);
      const incidencias = Number(row.incidencias || 0);
      const facturaPendiente = Number(row.factura_pendiente || 0);
      const pagoPendiente = Number(row.pago_pendiente || 0);
      const hasIdentity = hasText(row.cif) && (hasEmail(row.email) || hasText(row.telefono));
      const checks = [
        { key: "datos", ok: hasIdentity, label: "Datos maestros", detail: hasIdentity ? "CIF/NIF y contacto listos." : "Falta CIF/NIF o contacto." },
        { key: "documentos", ok: docs > 0 && docsCaducados === 0, label: "Documentacion", detail: docs <= 0 ? "Sin documentos registrados." : docsCaducados > 0 ? `${docsCaducados} documento(s) caducado(s).` : "Documentos sin caducar." },
        { key: "vehiculos", ok: vehiculos > 0 && vehiculosDocRiesgo === 0, label: "Vehiculos", detail: vehiculos <= 0 ? "Sin vehiculos registrados." : vehiculosDocRiesgo > 0 ? `${vehiculosDocRiesgo} vehiculo(s) con riesgo documental.` : "Vehiculos aptos." },
        { key: "calidad", ok: incidencias === 0, label: "Calidad", detail: incidencias > 0 ? `${incidencias} incidencia(s) recientes.` : "Sin incidencias recientes." },
        { key: "liquidacion", ok: facturaPendiente === 0 && pagoPendiente <= 1, label: "Liquidacion", detail: facturaPendiente > 0 ? `${facturaPendiente} factura/documentacion pendiente.` : pagoPendiente > 1 ? `${pagoPendiente} pagos pendientes de conciliar.` : "Liquidacion controlada." },
      ];
      const score = Math.max(0, Math.min(100,
        Math.round((Number(row.valoracion || 5) / 5) * 20)
        + checks.reduce((sum, check) => sum + (check.ok ? 16 : 0), 0)
        - Math.min(18, docsProximos * 4)
      ));
      const bloqueantes = checks.filter(check => !check.ok && ["datos", "documentos", "vehiculos"].includes(check.key));
      const avisos = checks.filter(check => !check.ok && !["datos", "documentos", "vehiculos"].includes(check.key));
      const status = bloqueantes.length ? "bloqueado" : (avisos.length || docsProximos > 0 || score < 80) ? "condicionado" : "apto";
      return {
        id: row.id,
        nombre: row.nombre || "Colaborador",
        contacto: row.email || row.telefono || "",
        valoracion: Number(row.valoracion || 0),
        status,
        label: status === "apto" ? "Apto para retorno" : status === "condicionado" ? "Apto con condiciones" : "No asignar sin revisar",
        score,
        pedidos: Number(row.pedidos || 0),
        documentos: docs,
        docs_caducados: docsCaducados,
        docs_proximos: docsProximos,
        vehiculos,
        vehiculos_doc_riesgo: vehiculosDocRiesgo,
        incidencias,
        factura_pendiente: facturaPendiente,
        pago_pendiente: pagoPendiente,
        checks,
        bloqueantes: bloqueantes.map(c => ({ key: c.key, label: c.label, detail: c.detail })),
        avisos: [
          ...avisos.map(c => ({ key: c.key, label: c.label, detail: c.detail })),
          ...(docsProximos > 0 ? [{ key: "docs_proximos", label: "Vencimientos proximos", detail: `${docsProximos} documento(s) vencen en 30 dias.` }] : []),
        ].slice(0, 4),
        next_action: bloqueantes[0]?.detail || avisos[0]?.detail || (docsProximos > 0 ? `${docsProximos} documento(s) vencen en 30 dias.` : "Puede proponerse para retornos o subcontratacion controlada."),
      };
    }).sort((a, b) => {
      const order = { apto: 0, condicionado: 1, bloqueado: 2 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.score - a.score;
    }).slice(0, 12);

    const solicitudes_recientes = (solicitudesRes.rows || []).map(s => ({
      id: s.id,
      pedido_id: s.pedido_id,
      pedido_numero: s.pedido_numero || "",
      base_pedido_id: s.base_pedido_id || null,
      base_pedido_numero: s.base_pedido_numero || "",
      carrier_id: s.carrier_id,
      carrier_nombre: s.carrier_nombre || "Colaborador",
      destinatario: s.destinatario || "",
      asunto: s.asunto || "",
      estado: s.estado || "enviada",
      simulado: !!s.simulado,
      email_message_id: s.email_message_id || "",
      notas: s.notas || "",
      sent_at: s.sent_at,
      responded_at: s.responded_at,
      pedido_asignado_at: s.pedido_asignado_at,
      pedido_asignado_a_carrier: !!s.pedido_asignado_a_carrier,
      pedido_colaborador_id: s.pedido_colaborador_id || null,
      updated_at: s.updated_at,
      ruta: [s.origen, s.destino].filter(Boolean).join(" -> "),
    }));

    const top = oportunidades.slice(0, 30);
    const resumen = {
      oportunidades: top.length,
      alta: top.filter(o => o.prioridad === "alta").length,
      media: top.filter(o => o.prioridad === "media").length,
      km_vacio_evitable: round2(top.reduce((sum, o) => sum + Number(o.impacto?.km_vacio_evitable || 0), 0)),
      pedidos_sin_retorno: sinRetorno.length,
      zonas_con_demanda: zonas_demanda.length,
      carriers_aptos: carriers_recomendados.filter(c => c.status === "apto").length,
      carriers_condicionados: carriers_recomendados.filter(c => c.status === "condicionado").length,
      carriers_bloqueados: carriers_recomendados.filter(c => c.status === "bloqueado").length,
      solicitudes_enviadas: solicitudes_recientes.length,
    };

    res.json({
      period,
      desde,
      hasta,
      generated_at: new Date().toISOString(),
      resumen,
      oportunidades: top,
      sin_retorno: sinRetorno,
      zonas_demanda,
      carriers_recomendados,
      solicitudes_recientes,
      reglas: {
        ventana_dias: 7,
        criterio: "Coincidencia de destino descargado con origen de pedidos proximos no asignados o compatibles.",
        estado: "red_interna_pre_marketplace",
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudieron calcular cargas de retorno" });
  }
});

async function buildRetornoCarrierSolicitud({ empresaId, pedidoId, carrierId, basePedidoId = null }) {
  if (!empresaId) {
    const err = new Error("Sin empresa_id");
    err.status = 401;
    throw err;
  }
  if (!pedidoId || !carrierId) {
    const err = new Error("pedido_id y carrier_id son obligatorios");
    err.status = 400;
    throw err;
  }

  const [pedidoRes, baseRes, carrierRes, docsRes, vehRes] = await Promise.all([
    db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga,
             p.mercancia, p.peso_kg AS peso, p.importe, p.precio_colaborador, p.km_ruta, p.km_vacio,
             c.nombre AS cliente_nombre
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
       WHERE p.id=$1 AND p.empresa_id=$2
       LIMIT 1
    `, [pedidoId, empresaId]),
    basePedidoId ? db.query(`
      SELECT id, numero, origen, destino, fecha_descarga, fecha_entrega, fecha_carga, km_vacio
        FROM pedidos
       WHERE id=$1 AND empresa_id=$2
       LIMIT 1
    `, [basePedidoId, empresaId]).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
    db.query(`
      SELECT id, nombre, cif, email, telefono, valoracion
        FROM colaboradores
       WHERE id=$1 AND empresa_id=$2 AND COALESCE(activo,true)=true
       LIMIT 1
    `, [carrierId, empresaId]),
    db.query(`
      SELECT COUNT(*)::int AS documentos,
             COUNT(*) FILTER (WHERE caducidad IS NOT NULL AND caducidad < CURRENT_DATE)::int AS docs_caducados,
             COUNT(*) FILTER (WHERE caducidad IS NOT NULL AND caducidad BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')::int AS docs_proximos
        FROM colaborador_documentos
       WHERE empresa_id=$1 AND colaborador_id=$2
    `, [empresaId, carrierId]).catch(() => ({ rows: [{ documentos: 0, docs_caducados: 0, docs_proximos: 0 }] })),
    db.query(`
      SELECT COUNT(*) FILTER (WHERE activo IS DISTINCT FROM false)::int AS vehiculos,
             COUNT(*) FILTER (
               WHERE activo IS DISTINCT FROM false AND (
                 doc_itv_venc IS NULL OR doc_seguro_venc IS NULL OR doc_tarjeta_exp IS NULL
                 OR doc_itv_venc <= CURRENT_DATE + INTERVAL '30 days'
                 OR doc_seguro_venc <= CURRENT_DATE + INTERVAL '30 days'
                 OR doc_tarjeta_exp <= CURRENT_DATE + INTERVAL '30 days'
               )
             )::int AS vehiculos_doc_riesgo
        FROM colaborador_vehiculos
       WHERE empresa_id=$1 AND colaborador_id=$2
    `, [empresaId, carrierId]).catch(() => ({ rows: [{ vehiculos: 0, vehiculos_doc_riesgo: 0 }] })),
  ]);

  const pedido = pedidoRes.rows[0];
  const carrier = carrierRes.rows[0];
  if (!pedido) {
    const err = new Error("Pedido no encontrado");
    err.status = 404;
    throw err;
  }
  if (!carrier) {
    const err = new Error("Carrier/colaborador no encontrado");
    err.status = 404;
    throw err;
  }

  const docs = docsRes.rows[0] || {};
  const veh = vehRes.rows[0] || {};
  const base = baseRes.rows[0] || null;
  const bloqueantes = [];
  const avisos = [];
  if (!hasEmail(carrier.email)) bloqueantes.push("El carrier no tiene email valido.");
  if (!hasText(carrier.cif)) bloqueantes.push("Falta CIF/NIF del carrier.");
  if (Number(docs.documentos || 0) <= 0) bloqueantes.push("El carrier no tiene documentacion registrada.");
  if (Number(docs.docs_caducados || 0) > 0) bloqueantes.push(`${Number(docs.docs_caducados || 0)} documento(s) del carrier estan caducados.`);
  if (Number(veh.vehiculos || 0) <= 0) bloqueantes.push("El carrier no tiene vehiculos registrados.");
  if (Number(veh.vehiculos_doc_riesgo || 0) > 0) avisos.push(`${Number(veh.vehiculos_doc_riesgo || 0)} vehiculo(s) del carrier tienen documentacion incompleta o proxima.`);
  if (Number(docs.docs_proximos || 0) > 0) avisos.push(`${Number(docs.docs_proximos || 0)} documento(s) del carrier vencen en 30 dias.`);

  const fechaCarga = pedido.fecha_carga ? new Date(pedido.fecha_carga).toLocaleDateString("es-ES") : "pendiente de confirmar";
  const precio = Number(pedido.precio_colaborador || 0) > 0
    ? `${round2(pedido.precio_colaborador)} EUR`
    : "pendiente de acordar";
  const asunto = `Solicitud disponibilidad retorno ${pedido.numero || ""}`.trim();
  const cuerpo = [
    `Hola ${carrier.nombre || ""},`,
    "",
    "Tenemos una posible carga de retorno para revisar disponibilidad:",
    `Pedido: ${pedido.numero || pedido.id}`,
    `Cliente: ${pedido.cliente_nombre || "Cliente"}`,
    `Ruta: ${pedido.origen || "-"} -> ${pedido.destino || "-"}`,
    `Fecha de carga: ${fechaCarga}`,
    `Mercancia: ${pedido.mercancia || "sin especificar"}`,
    `Peso: ${pedido.peso || "sin especificar"}`,
    `Precio colaborador: ${precio}`,
    base ? `Encaje retorno: camion descarga en ${base.destino || "-"} desde ${base.numero || ""}. Km vacio estimado a revisar: ${round2(base.km_vacio)} km.` : "",
    "",
    "Confirmanos disponibilidad, matricula, conductor y cualquier condicion antes de asignarlo.",
    "",
    "Gracias.",
  ].filter(Boolean).join("\n");

  return {
    ok: true,
    ready: bloqueantes.length === 0,
    bloqueantes,
    avisos,
    solicitud: {
      canal: "email",
      destinatario: carrier.email || "",
      asunto,
      cuerpo,
    },
    carrier: {
      id: carrier.id,
      nombre: carrier.nombre,
      email: carrier.email || "",
      telefono: carrier.telefono || "",
      valoracion: Number(carrier.valoracion || 0),
      documentos: Number(docs.documentos || 0),
      vehiculos: Number(veh.vehiculos || 0),
    },
    pedido: {
      id: pedido.id,
      numero: pedido.numero,
      origen: pedido.origen,
      destino: pedido.destino,
      fecha_carga: pedido.fecha_carga,
      precio_colaborador: round2(pedido.precio_colaborador),
    },
    base_pedido: base ? {
      id: base.id,
      numero: base.numero,
      destino: base.destino,
      fecha_disponible: base.fecha_descarga || base.fecha_entrega || base.fecha_carga,
      km_vacio: round2(base.km_vacio),
    } : null,
  };
}

async function notificarSolicitudRetornoEnviada(empresaId, payload, actorId) {
  const { rows } = await db.query(
    "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('gerente','trafico')",
    [empresaId]
  ).catch(() => ({ rows: [] }));
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo: "retorno.carrier_solicitado",
    titulo: "Solicitud de retorno enviada",
    mensaje: `${payload.pedido?.numero || "Pedido"} enviado a ${payload.carrier?.nombre || "carrier"}`,
    data: {
      pedido_id: payload.pedido?.id,
      pedido_numero: payload.pedido?.numero,
      carrier_id: payload.carrier?.id,
      carrier_nombre: payload.carrier?.nombre,
      base_pedido_id: payload.base_pedido?.id || null,
    },
    created_by: actorId || null,
  }).catch(() => null)));
}

async function notificarRetornoCarrierAsignado(empresaId, payload, actorId) {
  const { rows } = await db.query(
    "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('gerente','trafico')",
    [empresaId]
  ).catch(() => ({ rows: [] }));
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo: "retorno.carrier_asignado",
    titulo: "Retorno asignado a carrier",
    mensaje: `${payload.pedido_numero || "Pedido"} asignado a ${payload.carrier_nombre || "carrier"}`,
    data: payload,
    created_by: actorId || null,
  }).catch(() => null)));
}

async function asignarCarrierRetornoSiProcede({ empresaId, solicitud, actorId = null, actorRol = "usuario" }) {
  if (!empresaId || !solicitud || String(solicitud.estado || "") !== "asignada") return null;
  const { rows } = await db.query(
    `SELECT p.id, p.numero, p.estado::text AS estado, p.factura_id, p.vehiculo_id, p.chofer_id,
            p.colaborador_id, col.nombre AS carrier_nombre, actual.nombre AS colaborador_actual_nombre
       FROM pedidos p
       LEFT JOIN colaboradores col ON col.id=$3 AND col.empresa_id=p.empresa_id
       LEFT JOIN colaboradores actual ON actual.id=p.colaborador_id AND actual.empresa_id=p.empresa_id
      WHERE p.id=$1 AND p.empresa_id=$2
      LIMIT 1`,
    [solicitud.pedido_id, empresaId, solicitud.carrier_id]
  );
  const pedido = rows[0];
  if (!pedido) return { aplicada: false, estado: "pedido_no_encontrado", mensaje: "Pedido no encontrado" };
  if (pedido.factura_id) return { aplicada: false, estado: "pedido_facturado", mensaje: "El pedido ya esta facturado y no se asigna automaticamente" };
  if (pedido.colaborador_id && String(pedido.colaborador_id) === String(solicitud.carrier_id)) {
    await db.query(
      "UPDATE retorno_carrier_solicitudes SET pedido_asignado_at=COALESCE(pedido_asignado_at,NOW()), updated_at=NOW() WHERE id=$1 AND empresa_id=$2",
      [solicitud.id, empresaId]
    ).catch(() => {});
    return {
      aplicada: false,
      estado: "ya_asignado",
      mensaje: "El pedido ya estaba asignado a este carrier",
      pedido_id: pedido.id,
      pedido_numero: pedido.numero,
      carrier_id: solicitud.carrier_id,
      carrier_nombre: pedido.carrier_nombre || "",
      pedido_asignado_at: new Date().toISOString(),
    };
  }
  if (pedido.colaborador_id) {
    return {
      aplicada: false,
      estado: "otro_colaborador",
      mensaje: `El pedido ya esta asignado a ${pedido.colaborador_actual_nombre || "otro colaborador"}`,
      pedido_id: pedido.id,
      pedido_numero: pedido.numero,
      carrier_id: solicitud.carrier_id,
    };
  }
  if (pedido.vehiculo_id || pedido.chofer_id) {
    return {
      aplicada: false,
      estado: "flota_propia",
      mensaje: "El pedido ya tiene camion o chofer de flota propia asignado",
      pedido_id: pedido.id,
      pedido_numero: pedido.numero,
      carrier_id: solicitud.carrier_id,
    };
  }

  const updated = await db.query(
    `UPDATE pedidos
        SET colaborador_id=$1,
            coste_gasoil=0,
            updated_at=NOW()
      WHERE id=$2 AND empresa_id=$3
        AND colaborador_id IS NULL
        AND vehiculo_id IS NULL
        AND chofer_id IS NULL
        AND factura_id IS NULL
      RETURNING id, numero, estado::text AS estado, colaborador_id, updated_at`,
    [solicitud.carrier_id, pedido.id, empresaId]
  );
  const row = updated.rows[0];
  if (!row) return { aplicada: false, estado: "conflicto", mensaje: "El pedido cambio de asignacion antes de guardar" };

  const asignadoAtRes = await db.query(
    `UPDATE retorno_carrier_solicitudes
        SET pedido_asignado_at=COALESCE(pedido_asignado_at,NOW()),
            updated_at=NOW()
      WHERE id=$1 AND empresa_id=$2
      RETURNING pedido_asignado_at`,
    [solicitud.id, empresaId]
  ).catch(() => ({ rows: [] }));
  const pedidoAsignadoAt = asignadoAtRes.rows?.[0]?.pedido_asignado_at || new Date().toISOString();
  const detalle = {
    solicitud_id: solicitud.id,
    pedido_id: row.id,
    pedido_numero: row.numero,
    carrier_id: solicitud.carrier_id,
    carrier_nombre: pedido.carrier_nombre || "",
    pedido_asignado_at: pedidoAsignadoAt,
  };
  await db.query(
    `INSERT INTO pedido_eventos (pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle)
     VALUES ($1,$2,'retorno.carrier_asignado',$3,$4,$5::jsonb)`,
    [row.id, empresaId, actorRol, actorId, JSON.stringify(detalle)]
  ).catch(() => {});
  await db.query(
    `INSERT INTO audit_log (tabla, registro_id, campo, valor_antes, valor_nuevo, usuario_id, ip, empresa_id)
     VALUES ('pedidos',$1,'retorno_carrier_asignado',NULL,$2,$3,NULL,$4)`,
    [row.id, JSON.stringify(detalle), actorId, empresaId]
  ).catch(() => {});
  await notificarRetornoCarrierAsignado(empresaId, detalle, actorId);
  return {
    aplicada: true,
    estado: "asignado",
    mensaje: "Pedido asignado al carrier seleccionado",
    ...detalle,
  };
}

router.post("/cargas-retorno/solicitud", authenticate, GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const payload = await buildRetornoCarrierSolicitud({
      empresaId: req.user?.empresa_id,
      pedidoId: req.body?.pedido_id,
      carrierId: req.body?.carrier_id,
      basePedidoId: req.body?.base_pedido_id || null,
    });
    res.json(payload);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo preparar la solicitud al carrier" });
  }
});

router.post("/cargas-retorno/solicitud/enviar", authenticate, GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    await ensureRetornoSolicitudesSchema();
    const payload = await buildRetornoCarrierSolicitud({
      empresaId,
      pedidoId: req.body?.pedido_id,
      carrierId: req.body?.carrier_id,
      basePedidoId: req.body?.base_pedido_id || null,
    });
    if (!payload.ready) {
      return res.status(409).json({
        ...payload,
        error: "No se puede enviar hasta resolver los bloqueantes del carrier.",
      });
    }
    const asunto = String(req.body?.asunto || payload.solicitud.asunto || "").trim().slice(0, 200);
    const cuerpo = String(req.body?.cuerpo || payload.solicitud.cuerpo || "").trim().slice(0, 5000);
    if (!asunto || !cuerpo) return res.status(400).json({ error: "Asunto y cuerpo son obligatorios" });

    const result = await enviarEmail({
      trigger: "retorno_carrier_solicitud",
      destinatario: payload.solicitud.destinatario,
      plantilla: "retorno_carrier_solicitud",
      empresa_id: empresaId,
      datos: {
        asunto,
        cuerpo,
        carrier: payload.carrier.nombre,
        numero: payload.pedido.numero,
        ruta: [payload.pedido.origen, payload.pedido.destino].filter(Boolean).join(" -> "),
        fecha_carga: payload.pedido.fecha_carga ? new Date(payload.pedido.fecha_carga).toLocaleDateString("es-ES") : "-",
        precio: payload.pedido.precio_colaborador ? `${payload.pedido.precio_colaborador} EUR` : "pendiente de acordar",
      },
      meta: {
        pedido_id: payload.pedido.id,
        pedido_numero: payload.pedido.numero,
        carrier_id: payload.carrier.id,
        base_pedido_id: payload.base_pedido?.id || null,
        origen: "informes_retornos",
      },
    });

    const solicitudDb = await db.query(
      `INSERT INTO retorno_carrier_solicitudes
        (empresa_id,pedido_id,base_pedido_id,carrier_id,destinatario,asunto,cuerpo,estado,simulado,email_message_id,bloqueantes,avisos,created_by,sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,NOW())
       RETURNING id, estado, simulado, email_message_id, sent_at, created_at`,
      [
        empresaId,
        payload.pedido.id,
        payload.base_pedido?.id || null,
        payload.carrier.id,
        payload.solicitud.destinatario,
        asunto,
        cuerpo,
        result?.simulado ? "simulada" : "enviada",
        !!result?.simulado,
        result?.messageId || null,
        JSON.stringify(payload.bloqueantes || []),
        JSON.stringify(payload.avisos || []),
        req.user?.id || null,
      ]
    ).catch(() => ({ rows: [] }));
    const solicitudRow = solicitudDb.rows?.[0] || null;

    await db.query(
      `INSERT INTO audit_log (tabla, registro_id, campo, valor_antes, valor_nuevo, usuario_id, ip, empresa_id)
       VALUES ('pedidos',$1,'retorno_carrier_solicitud',NULL,$2,$3,$4,$5)`,
      [
        payload.pedido.id,
        JSON.stringify({
          carrier_id: payload.carrier.id,
          carrier_nombre: payload.carrier.nombre,
          destinatario: payload.solicitud.destinatario,
          asunto,
          simulado: !!result?.simulado,
          solicitud_id: solicitudRow?.id || null,
        }),
        req.user?.id || null,
        req.ip || null,
        empresaId,
      ]
    ).catch(() => {});
    await db.query(
      `INSERT INTO pedido_eventos (pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle)
       VALUES ($1,$2,'retorno.carrier_solicitado',$3,$4,$5::jsonb)`,
      [
        payload.pedido.id,
        empresaId,
        req.user?.rol || "usuario",
        req.user?.id || null,
        JSON.stringify({
          carrier_id: payload.carrier.id,
          carrier_nombre: payload.carrier.nombre,
          destinatario: payload.solicitud.destinatario,
          asunto,
          simulado: !!result?.simulado,
          solicitud_id: solicitudRow?.id || null,
          base_pedido_id: payload.base_pedido?.id || null,
        }),
      ]
    ).catch(() => {});
    await notificarSolicitudRetornoEnviada(empresaId, payload, req.user?.id || null);

    res.json({
      ...payload,
      solicitud: { ...payload.solicitud, asunto, cuerpo },
      enviado: !result?.simulado,
      simulado: !!result?.simulado,
      email: {
        estado: result?.simulado ? "simulado" : "enviado",
        message_id: result?.messageId || null,
      },
      solicitud_registro: solicitudRow ? {
        id: solicitudRow.id,
        estado: solicitudRow.estado,
        simulado: !!solicitudRow.simulado,
        email_message_id: solicitudRow.email_message_id || null,
        sent_at: solicitudRow.sent_at,
        created_at: solicitudRow.created_at,
      } : null,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo enviar la solicitud al carrier" });
  }
});

router.patch("/cargas-retorno/solicitudes/:id", authenticate, GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    await ensureRetornoSolicitudesSchema();
    const estado = String(req.body?.estado || "").trim().toLowerCase();
    const estadosValidos = ["enviada", "simulada", "respondida", "asignada", "descartada"];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: "Estado de solicitud no valido" });
    }
    const notas = String(req.body?.notas || "").trim().slice(0, 1200);
    const { rows } = await db.query(
      `UPDATE retorno_carrier_solicitudes
          SET estado=$1,
              notas=NULLIF($2,''),
              responded_at=CASE WHEN $1 IN ('respondida','asignada','descartada') THEN COALESCE(responded_at,NOW()) ELSE responded_at END,
              updated_at=NOW()
        WHERE id=$3 AND empresa_id=$4
        RETURNING id, pedido_id, base_pedido_id, carrier_id, destinatario, asunto, estado, simulado,
                  email_message_id, notas, sent_at, responded_at, pedido_asignado_at, updated_at, created_at`,
      [estado, notas, req.params.id, empresaId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "Solicitud no encontrada" });
    const asignacion = await asignarCarrierRetornoSiProcede({
      empresaId,
      solicitud: row,
      actorId: req.user?.id || null,
      actorRol: req.user?.rol || "usuario",
    });

    await db.query(
      `INSERT INTO pedido_eventos (pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle)
       VALUES ($1,$2,'retorno.carrier_solicitud_actualizada',$3,$4,$5::jsonb)`,
      [
        row.pedido_id,
        empresaId,
        req.user?.rol || "usuario",
        req.user?.id || null,
        JSON.stringify({
          solicitud_id: row.id,
          carrier_id: row.carrier_id,
          estado,
          notas: notas || null,
        }),
      ]
    ).catch(() => {});
    await db.query(
      `INSERT INTO audit_log (tabla, registro_id, campo, valor_antes, valor_nuevo, usuario_id, ip, empresa_id)
       VALUES ('pedidos',$1,'retorno_carrier_solicitud_estado',NULL,$2,$3,$4,$5)`,
      [
        row.pedido_id,
        JSON.stringify({ solicitud_id: row.id, carrier_id: row.carrier_id, estado, notas: notas || null }),
        req.user?.id || null,
        req.ip || null,
        empresaId,
      ]
    ).catch(() => {});

    res.json({
      ok: true,
      solicitud: {
        id: row.id,
        pedido_id: row.pedido_id,
        base_pedido_id: row.base_pedido_id || null,
        carrier_id: row.carrier_id,
        destinatario: row.destinatario,
        asunto: row.asunto,
        estado: row.estado,
        simulado: !!row.simulado,
          email_message_id: row.email_message_id || "",
          notas: row.notas || "",
          sent_at: row.sent_at,
          responded_at: row.responded_at,
          pedido_asignado_at: asignacion?.pedido_asignado_at || row.pedido_asignado_at || null,
          pedido_asignado_a_carrier: !!asignacion?.aplicada || asignacion?.estado === "ya_asignado",
          updated_at: row.updated_at,
          created_at: row.created_at,
      },
      asignacion,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo actualizar la solicitud al carrier" });
  }
});

router.get("/scoring-operativo", cacheMiddleware(30), async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    const period = String(req.query.period || "90d");
    const { desde, hasta } = req.query.desde && req.query.hasta
      ? { desde: req.query.desde, hasta: req.query.hasta }
      : rangoPeriodo(period);
    const safeRows = (promise) => promise.then(r => r.rows || []).catch(() => []);

    const [clientesRows, colaboradoresRows] = await Promise.all([
      safeRows(db.query(`
        WITH extras AS (
          SELECT pe.pedido_id, COALESCE(SUM(COALESCE(pe.importe,0)),0) AS coste_extra
            FROM pedido_extracostes pe
            JOIN pedidos p2 ON p2.id=pe.pedido_id
           WHERE p2.empresa_id=$1
           GROUP BY pe.pedido_id
        ), docs AS (
          SELECT pd.pedido_id,
                 COUNT(*) FILTER (
                   WHERE LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                      OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                      OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                      OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                      OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                      OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
                 )::int AS albaranes
            FROM pedido_docs pd
           WHERE pd.empresa_id=$1
           GROUP BY pd.pedido_id
        ), pedidos_cliente AS (
          SELECT p.cliente_id,
                 COUNT(*)::int AS pedidos,
                 COALESCE(SUM(
                   COALESCE(NULLIF(p.importe,0), NULLIF(p.precio_cliente_col,0), NULLIF(p.precio_unitario,0), 0)
                   + COALESCE(p.importe_paralizacion,0)
                 ),0) AS ingreso,
                 COALESCE(SUM(
                   CASE
                     WHEN p.colaborador_id IS NOT NULL THEN COALESCE(p.precio_colaborador,0)
                     ELSE COALESCE(p.coste_gasoil,0)+COALESCE(p.coste_peajes,0)+COALESCE(p.coste_dietas,0)+COALESCE(p.coste_otros,0)
                   END + COALESCE(extras.coste_extra,0)
                 ),0) AS coste,
                 COUNT(*) FILTER (WHERE p.estado::text='incidencia' OR LOWER(COALESCE(p.notas,'')) LIKE '%incidencia%')::int AS incidencias,
                 COUNT(*) FILTER (WHERE p.estado::text IN ('entregado','facturado') AND COALESCE(docs.albaranes,0)=0)::int AS pod_pendiente,
                 COUNT(*) FILTER (WHERE p.estado::text NOT IN ('cancelado','entregado','facturado'))::int AS activos,
                 MAX(COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date)) AS ultima_operacion
            FROM pedidos p
            LEFT JOIN extras ON extras.pedido_id=p.id
            LEFT JOIN docs ON docs.pedido_id=p.id
           WHERE p.empresa_id=$1
             AND p.estado::text <> 'cancelado'
             AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) BETWEEN $2 AND $3
           GROUP BY p.cliente_id
        ), facturas_cliente AS (
          SELECT f.cliente_id,
                 COUNT(*)::int AS facturas,
                 COUNT(*) FILTER (WHERE f.estado::text IN ('vencida','reclamada','sin_cobrar'))::int AS cobros_riesgo,
                 COALESCE(SUM(f.total) FILTER (WHERE f.estado::text IN ('vencida','reclamada','sin_cobrar')),0) AS importe_cobro_riesgo
            FROM facturas f
           WHERE f.empresa_id=$1
             AND f.fecha BETWEEN $2 AND $3
           GROUP BY f.cliente_id
        )
        SELECT c.id, c.nombre,
               COALESCE(pc.pedidos,0) AS pedidos,
               COALESCE(pc.ingreso,0) AS ingreso,
               COALESCE(pc.coste,0) AS coste,
               COALESCE(pc.ingreso,0)-COALESCE(pc.coste,0) AS margen,
               COALESCE(pc.incidencias,0) AS incidencias,
               COALESCE(pc.pod_pendiente,0) AS pod_pendiente,
               COALESCE(pc.activos,0) AS activos,
               COALESCE(fc.facturas,0) AS facturas,
               COALESCE(fc.cobros_riesgo,0) AS cobros_riesgo,
               COALESCE(fc.importe_cobro_riesgo,0) AS importe_cobro_riesgo,
               pc.ultima_operacion
          FROM clientes c
          LEFT JOIN pedidos_cliente pc ON pc.cliente_id=c.id
          LEFT JOIN facturas_cliente fc ON fc.cliente_id=c.id
         WHERE c.empresa_id=$1
           AND (COALESCE(pc.pedidos,0)>0 OR COALESCE(fc.facturas,0)>0)
         ORDER BY (COALESCE(pc.pedidos,0)+COALESCE(fc.facturas,0)) DESC, c.nombre
         LIMIT 80
      `, [empresaId, desde, hasta])),
      safeRows(db.query(`
        WITH docs AS (
          SELECT pd.pedido_id,
                 COUNT(*) FILTER (
                   WHERE LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                      OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                      OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                      OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                      OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                      OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
                 )::int AS albaranes
            FROM pedido_docs pd
           WHERE pd.empresa_id=$1
           GROUP BY pd.pedido_id
        ), pagos AS (
          SELECT pedido_id,
                 BOOL_OR(COALESCE(pagado,false)) AS pagado,
                 BOOL_OR(COALESCE(documentacion_recibida,false)) AS documentacion_recibida,
                 MIN(fecha_pago_calculada) AS proximo_pago
            FROM pedido_colaborador_pagos
           WHERE empresa_id=$1
           GROUP BY pedido_id
        ), pedidos_colaborador AS (
          SELECT p.colaborador_id,
                 COUNT(*)::int AS pedidos,
                 COALESCE(SUM(COALESCE(p.precio_cliente_col,p.importe,0)),0) AS ingreso_cliente,
                 COALESCE(SUM(COALESCE(p.precio_colaborador,0)),0) AS coste_colaborador,
                 COUNT(*) FILTER (WHERE p.estado::text='incidencia' OR LOWER(COALESCE(p.notas,'')) LIKE '%incidencia%')::int AS incidencias,
                 COUNT(*) FILTER (WHERE p.estado::text IN ('entregado','facturado') AND COALESCE(docs.albaranes,0)=0)::int AS pod_pendiente,
                 COUNT(*) FILTER (WHERE COALESCE(p.precio_colaborador,0)>0 AND COALESCE(pagos.documentacion_recibida,false)=false)::int AS factura_pendiente,
                 COUNT(*) FILTER (WHERE COALESCE(p.precio_colaborador,0)>0 AND COALESCE(pagos.pagado,false)=false)::int AS pago_pendiente,
                 MAX(COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date)) AS ultima_operacion
            FROM pedidos p
            LEFT JOIN docs ON docs.pedido_id=p.id
            LEFT JOIN pagos ON pagos.pedido_id=p.id
           WHERE p.empresa_id=$1
             AND p.colaborador_id IS NOT NULL
             AND p.estado::text <> 'cancelado'
             AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) BETWEEN $2 AND $3
           GROUP BY p.colaborador_id
        ), documentos_colaborador AS (
          SELECT colaborador_id,
                 COUNT(*)::int AS documentos,
                 COUNT(*) FILTER (WHERE caducidad IS NOT NULL AND caducidad < CURRENT_DATE)::int AS docs_caducados,
                 COUNT(*) FILTER (WHERE caducidad IS NOT NULL AND caducidad BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')::int AS docs_proximos,
                 COUNT(*) FILTER (WHERE caducidad IS NULL)::int AS docs_sin_caducidad
            FROM colaborador_documentos
           WHERE empresa_id=$1
           GROUP BY colaborador_id
        ), vehiculos_colaborador AS (
          SELECT colaborador_id,
                 COUNT(*) FILTER (WHERE activo IS DISTINCT FROM false)::int AS vehiculos,
                 COUNT(*) FILTER (
                   WHERE activo IS DISTINCT FROM false AND (
                     doc_itv_venc IS NULL OR doc_seguro_venc IS NULL OR doc_tarjeta_exp IS NULL
                     OR doc_itv_venc <= CURRENT_DATE + INTERVAL '30 days'
                     OR doc_seguro_venc <= CURRENT_DATE + INTERVAL '30 days'
                     OR doc_tarjeta_exp <= CURRENT_DATE + INTERVAL '30 days'
                     OR doc_tacografo_venc <= CURRENT_DATE + INTERVAL '30 days'
                   )
                 )::int AS vehiculos_doc_riesgo
            FROM colaborador_vehiculos
           WHERE empresa_id=$1
           GROUP BY colaborador_id
        )
        SELECT col.id, col.nombre, col.valoracion, col.cif, col.email, col.telefono,
               COALESCE(pc.pedidos,0) AS pedidos,
               COALESCE(pc.ingreso_cliente,0) AS ingreso_cliente,
               COALESCE(pc.coste_colaborador,0) AS coste_colaborador,
               COALESCE(pc.ingreso_cliente,0)-COALESCE(pc.coste_colaborador,0) AS margen_intermediacion,
               COALESCE(pc.incidencias,0) AS incidencias,
               COALESCE(pc.pod_pendiente,0) AS pod_pendiente,
               COALESCE(pc.factura_pendiente,0) AS factura_pendiente,
               COALESCE(pc.pago_pendiente,0) AS pago_pendiente,
               COALESCE(dc.documentos,0) AS documentos,
               COALESCE(dc.docs_caducados,0) AS docs_caducados,
               COALESCE(dc.docs_proximos,0) AS docs_proximos,
               COALESCE(dc.docs_sin_caducidad,0) AS docs_sin_caducidad,
               COALESCE(vc.vehiculos,0) AS vehiculos,
               COALESCE(vc.vehiculos_doc_riesgo,0) AS vehiculos_doc_riesgo,
               pc.ultima_operacion
          FROM colaboradores col
          JOIN pedidos_colaborador pc ON pc.colaborador_id=col.id
          LEFT JOIN documentos_colaborador dc ON dc.colaborador_id=col.id
          LEFT JOIN vehiculos_colaborador vc ON vc.colaborador_id=col.id
         WHERE col.empresa_id=$1
         ORDER BY COALESCE(pc.pedidos,0) DESC, col.nombre
         LIMIT 80
      `, [empresaId, desde, hasta])),
    ]);

    const buildAcceptanceDecision = ({ type, salud, motivos, margenPct, cobrosRiesgo, podPendiente, incidencias, facturaPendiente, pagoPendiente, pedidos }) => {
      const controls = [];
      const conditions = [];
      const flags = new Set(motivos || []);

      if (flags.has("Margen negativo") || flags.has("Margen bajo") || (margenPct != null && margenPct < 8)) {
        controls.push("Validar precio minimo rentable antes de repetir ruta");
        conditions.push("Renegociar tarifa, minimo o recargo antes de aceptar mas volumen");
      }
      if (type === "cliente" && Number(cobrosRiesgo || 0) > 0) {
        controls.push("Revisar deuda vencida y responsable de cobro");
        conditions.push("Aceptar solo con vencimiento reducido, anticipo o autorizacion de gerencia");
      }
      if (Number(podPendiente || 0) > 0) {
        controls.push("Exigir POD/albaran/CMR antes de emitir factura o liquidar");
      }
      if (Number(incidencias || 0) > 0) {
        controls.push("Confirmar ventanas, contacto operativo y SLA antes de planificar");
      }
      if (type === "colaborador" && Number(facturaPendiente || 0) > 0) {
        controls.push("Cerrar factura/documentacion pendiente antes de ampliar asignaciones");
      }
      if (type === "colaborador" && Number(pagoPendiente || 0) > 0) {
        controls.push("Conciliar pagos pendientes para evitar doble pago o reclamaciones");
      }

      const risk = salud === "rojo" ? "alto" : salud === "amarillo" ? "medio" : "bajo";
      const acceptance = salud === "rojo"
        ? "autorizar_gerencia"
        : salud === "amarillo"
          ? "aceptar_condicionado"
          : "aceptar_normal";
      const label = acceptance === "autorizar_gerencia"
        ? "Requiere autorizacion de gerencia"
        : acceptance === "aceptar_condicionado"
          ? "Aceptar con condiciones"
          : "Aceptar normal";
      const maxVolume = risk === "alto"
        ? "No aumentar volumen hasta resolver motivos criticos"
        : risk === "medio"
          ? `Mantener volumen controlado${Number(pedidos || 0) > 0 ? " y revisar los proximos viajes" : ""}`
          : "Puede operar con seguimiento normal";

      return {
        risk,
        acceptance,
        label,
        max_volume: maxVolume,
        required_controls: Array.from(new Set(controls)).slice(0, 5),
        recommended_conditions: Array.from(new Set(conditions)).slice(0, 4),
      };
    };

    const buildScore = (row, type) => {
      const pedidos = Number(row.pedidos || 0);
      const ingreso = Number(row.ingreso ?? row.ingreso_cliente ?? 0);
      const coste = Number(row.coste ?? row.coste_colaborador ?? 0);
      const margen = Number(row.margen ?? row.margen_intermediacion ?? (ingreso - coste));
      const margenPct = ingreso > 0 ? (margen / ingreso) * 100 : null;
      const incidencias = Number(row.incidencias || 0);
      const podPendiente = Number(row.pod_pendiente || 0);
      const cobrosRiesgo = Number(row.cobros_riesgo || 0);
      const facturaPendiente = Number(row.factura_pendiente || 0);
      const pagoPendiente = Number(row.pago_pendiente || 0);
      const motivos = [];
      let score = 100;

      if (margenPct !== null && margenPct < 0) { score -= 35; motivos.push("Margen negativo"); }
      else if (margenPct !== null && margenPct < 8) { score -= 22; motivos.push("Margen bajo"); }
      else if (margenPct !== null && margenPct < 15) { score -= 10; motivos.push("Margen ajustado"); }
      if (pedidos > 0 && incidencias / pedidos >= 0.15) { score -= 18; motivos.push("Incidencias recurrentes"); }
      else if (incidencias > 0) { score -= 8; motivos.push("Incidencias"); }
      if (pedidos > 0 && podPendiente / pedidos >= 0.20) { score -= 16; motivos.push("Documentacion irregular"); }
      else if (podPendiente > 0) { score -= 7; motivos.push("POD/albaran pendiente"); }
      if (type === "cliente" && cobrosRiesgo > 0) { score -= Math.min(24, 10 + cobrosRiesgo * 4); motivos.push("Cobros en riesgo"); }
      if (type === "colaborador" && facturaPendiente > 0) { score -= Math.min(18, 8 + facturaPendiente * 3); motivos.push("Factura/documentacion pendiente"); }
      if (type === "colaborador" && pagoPendiente > 0) { score -= 4; motivos.push("Pagos pendientes de conciliar"); }
      if (type === "colaborador" && Number(row.valoracion || 5) < 4) { score -= 8; motivos.push("Valoracion interna baja"); }

      score = Math.max(0, Math.min(100, Math.round(score)));
      const salud = score >= 80 ? "verde" : score >= 60 ? "amarillo" : "rojo";
      const accion = motivos.includes("Cobros en riesgo")
        ? "Revisar condiciones de cobro y documentacion antes de aceptar mas volumen."
        : motivos.includes("Margen negativo") || motivos.includes("Margen bajo")
          ? "Renegociar tarifa, minimo o recargos antes de repetir operativa."
          : motivos.includes("Factura/documentacion pendiente") || motivos.includes("Documentacion irregular")
            ? "Cerrar soporte documental y responsable antes de facturar o liquidar."
            : motivos.includes("Incidencias recurrentes")
              ? "Revisar calidad operativa, ventanas y SLA antes de asignar mas viajes."
              : "Relacion saneada; mantener seguimiento normal.";
      return {
        score,
        salud,
        motivos,
        accion,
        decision: buildAcceptanceDecision({
          type,
          salud,
          motivos,
          margenPct,
          cobrosRiesgo,
          podPendiente,
          incidencias,
          facturaPendiente,
          pagoPendiente,
          pedidos,
        }),
        margen_pct: margenPct == null ? null : round2(margenPct),
      };
    };

    const buildCarrierVerification = (row, scoring) => {
      const hasIdentity = hasText(row.cif) && (hasEmail(row.email) || hasText(row.telefono));
      const docs = Number(row.documentos || 0);
      const docsCaducados = Number(row.docs_caducados || 0);
      const docsProximos = Number(row.docs_proximos || 0);
      const vehiculos = Number(row.vehiculos || 0);
      const vehiculosDocRiesgo = Number(row.vehiculos_doc_riesgo || 0);
      const facturaPendiente = Number(row.factura_pendiente || 0);
      const pagoPendiente = Number(row.pago_pendiente || 0);
      const incidencias = Number(row.incidencias || 0);
      const checks = [
        {
          key: "datos_maestros",
          label: "Datos maestros",
          ok: hasIdentity,
          required: true,
          detail: hasIdentity ? "CIF/NIF y contacto disponibles." : "Completar CIF/NIF y email o telefono.",
        },
        {
          key: "documentacion_empresa",
          label: "Documentacion del proveedor",
          ok: docs > 0 && docsCaducados === 0,
          required: true,
          detail: docs <= 0 ? "No hay documentos registrados." : docsCaducados > 0 ? `${docsCaducados} documento(s) caducado(s).` : "Sin documentos caducados.",
        },
        {
          key: "vehiculos_verificados",
          label: "Vehiculos del proveedor",
          ok: vehiculos > 0 && vehiculosDocRiesgo === 0,
          required: true,
          detail: vehiculos <= 0 ? "No hay vehiculos registrados." : vehiculosDocRiesgo > 0 ? `${vehiculosDocRiesgo} vehiculo(s) con documentacion incompleta/proxima.` : "Vehiculos con documentacion vigente.",
        },
        {
          key: "calidad_operativa",
          label: "Calidad operativa",
          ok: scoring.salud !== "rojo" && incidencias <= Math.max(1, Math.ceil(Number(row.pedidos || 0) * 0.15)),
          required: false,
          detail: incidencias > 0 ? `${incidencias} incidencia(s) en el periodo.` : "Sin incidencias relevantes.",
        },
        {
          key: "liquidacion",
          label: "Liquidacion y pagos",
          ok: facturaPendiente === 0 && pagoPendiente <= Math.max(1, Math.ceil(Number(row.pedidos || 0) * 0.25)),
          required: false,
          detail: facturaPendiente > 0 ? `${facturaPendiente} factura/documentacion pendiente.` : pagoPendiente > 0 ? `${pagoPendiente} pago(s) pendiente(s) de conciliar.` : "Liquidacion controlada.",
        },
      ];
      const requiredPending = checks.filter(c => c.required && !c.ok);
      const recommendedPending = checks.filter(c => !c.required && !c.ok);
      const status = requiredPending.length > 0 || scoring.salud === "rojo"
        ? "bloqueado"
        : recommendedPending.length > 0 || docsProximos > 0
          ? "condicionado"
          : "verificado";
      const label = status === "verificado"
        ? "Carrier verificado"
        : status === "condicionado"
          ? "Verificado con condiciones"
          : "No asignar sin revision";
      return {
        status,
        label,
        can_assign: status !== "bloqueado",
        score: checks.length ? Math.round((checks.filter(c => c.ok).length / checks.length) * 100) : 0,
        checks,
        faltantes: requiredPending.map(c => ({ key: c.key, label: c.label, detail: c.detail })),
        avisos: [
          ...recommendedPending.map(c => ({ key: c.key, label: c.label, detail: c.detail })),
          ...(docsProximos > 0 ? [{ key: "docs_proximos", label: "Documentos proximos", detail: `${docsProximos} documento(s) vencen en 30 dias.` }] : []),
        ].slice(0, 5),
        next_action: requiredPending[0]?.detail || recommendedPending[0]?.detail || (docsProximos > 0 ? `${docsProximos} documento(s) vencen en 30 dias.` : "Apto para asignacion normal."),
      };
    };

    const clientes = clientesRows.map(r => {
      const scoring = buildScore(r, "cliente");
      return {
        id: r.id,
        nombre: r.nombre || "Cliente",
        pedidos: Number(r.pedidos || 0),
        facturas: Number(r.facturas || 0),
        ingreso: round2(r.ingreso),
        coste: round2(r.coste),
        margen: round2(r.margen),
        incidencias: Number(r.incidencias || 0),
        pod_pendiente: Number(r.pod_pendiente || 0),
        cobros_riesgo: Number(r.cobros_riesgo || 0),
        importe_cobro_riesgo: round2(r.importe_cobro_riesgo),
        ultima_operacion: r.ultima_operacion,
        ...scoring,
      };
    }).sort((a, b) => a.score - b.score || b.ingreso - a.ingreso);

    const colaboradores = colaboradoresRows.map(r => {
      const scoring = buildScore(r, "colaborador");
      const verificacion = buildCarrierVerification(r, scoring);
      return {
        id: r.id,
        nombre: r.nombre || "Colaborador",
        valoracion: Number(r.valoracion || 0),
        pedidos: Number(r.pedidos || 0),
        ingreso_cliente: round2(r.ingreso_cliente),
        coste_colaborador: round2(r.coste_colaborador),
        margen_intermediacion: round2(r.margen_intermediacion),
        incidencias: Number(r.incidencias || 0),
        pod_pendiente: Number(r.pod_pendiente || 0),
        factura_pendiente: Number(r.factura_pendiente || 0),
        pago_pendiente: Number(r.pago_pendiente || 0),
        documentos: Number(r.documentos || 0),
        docs_caducados: Number(r.docs_caducados || 0),
        docs_proximos: Number(r.docs_proximos || 0),
        vehiculos: Number(r.vehiculos || 0),
        vehiculos_doc_riesgo: Number(r.vehiculos_doc_riesgo || 0),
        ultima_operacion: r.ultima_operacion,
        verificacion,
        ...scoring,
      };
    }).sort((a, b) => a.score - b.score || b.pedidos - a.pedidos);

    const resumen = {
      clientes: clientes.length,
      colaboradores: colaboradores.length,
      clientes_rojo: clientes.filter(x => x.salud === "rojo").length,
      colaboradores_rojo: colaboradores.filter(x => x.salud === "rojo").length,
      clientes_amarillo: clientes.filter(x => x.salud === "amarillo").length,
      colaboradores_amarillo: colaboradores.filter(x => x.salud === "amarillo").length,
      riesgo_alto: clientes.filter(x => x.salud === "rojo").length + colaboradores.filter(x => x.salud === "rojo").length,
      aceptacion_autorizacion: clientes.filter(x => x.decision?.acceptance === "autorizar_gerencia").length + colaboradores.filter(x => x.decision?.acceptance === "autorizar_gerencia").length,
      aceptacion_condicionada: clientes.filter(x => x.decision?.acceptance === "aceptar_condicionado").length + colaboradores.filter(x => x.decision?.acceptance === "aceptar_condicionado").length,
      carriers_verificados: colaboradores.filter(x => x.verificacion?.status === "verificado").length,
      carriers_condicionados: colaboradores.filter(x => x.verificacion?.status === "condicionado").length,
      carriers_bloqueados: colaboradores.filter(x => x.verificacion?.status === "bloqueado").length,
    };
    const decisiones_prioritarias = [
      ...clientes.map(x => ({ tipo: "cliente", ...x })),
      ...colaboradores.map(x => ({ tipo: "colaborador", ...x })),
    ]
      .filter(x => ["autorizar_gerencia", "aceptar_condicionado"].includes(String(x.decision?.acceptance || "")))
      .sort((a, b) => a.score - b.score || Number(b.pedidos || 0) - Number(a.pedidos || 0))
      .slice(0, 12)
      .map(x => ({
        id: x.id,
        tipo: x.tipo,
        nombre: x.nombre,
        score: x.score,
        salud: x.salud,
        pedidos: x.pedidos,
        margen_pct: x.margen_pct,
        motivos: x.motivos,
        accion: x.accion,
        decision: x.decision,
      }));

    res.json({
      period,
      desde,
      hasta,
      resumen,
      decisiones_prioritarias,
      clientes: clientes.slice(0, 30),
      colaboradores: colaboradores.slice(0, 30),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo calcular scoring operativo" });
  }
});

router.get("/emisiones-operativas", cacheMiddleware(30), async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    const period = String(req.query.period || "90d");
    const { desde, hasta } = req.query.desde && req.query.hasta
      ? { desde: req.query.desde, hasta: req.query.hasta }
      : rangoPeriodo(period);

    const cfgRows = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1", [empresaId]).catch(() => ({ rows: [] }));
    const cfg = cfgRows.rows[0]?.cfg_precios && typeof cfgRows.rows[0].cfg_precios === "object" ? cfgRows.rows[0].cfg_precios : {};
    const sostenibilidadCfg = cfg.sostenibilidad && typeof cfg.sostenibilidad === "object" ? cfg.sostenibilidad : {};
    const consumoL100 = Number(sostenibilidadCfg.consumo_l_100km || 32);
    const factorKgLitro = Number(sostenibilidadCfg.factor_kg_co2_litro || 2.68);
    const consumoSeguro = Number.isFinite(consumoL100) && consumoL100 > 0 ? consumoL100 : 32;
    const factorSeguro = Number.isFinite(factorKgLitro) && factorKgLitro > 0 ? factorKgLitro : 2.68;

    const { rows } = await db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.estado::text AS estado,
             COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) AS fecha,
             COALESCE(p.km_ruta,0) AS km_ruta,
             COALESCE(p.km_vacio,0) AS km_vacio,
             COALESCE(NULLIF(p.importe,0), NULLIF(p.precio_cliente_col,0), NULLIF(p.precio_unitario,0), 0) AS ingreso,
             c.id AS cliente_id, c.nombre AS cliente_nombre,
             v.id AS vehiculo_id, v.matricula, v.clase, v.marca, v.modelo
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
       WHERE p.empresa_id=$1
         AND p.estado::text <> 'cancelado'
         AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) BETWEEN $2 AND $3
       ORDER BY fecha DESC NULLS LAST, p.created_at DESC
       LIMIT 2000
    `, [empresaId, desde, hasta]);

    const calcPedido = (p) => {
      const kmRuta = Number(p.km_ruta || 0);
      const kmVacio = Number(p.km_vacio || 0);
      const kmTotal = kmRuta + kmVacio;
      const litros = kmTotal > 0 ? (kmTotal * consumoSeguro) / 100 : 0;
      const co2Kg = litros * factorSeguro;
      const ingreso = Number(p.ingreso || 0);
      return {
        id: p.id,
        numero: p.numero,
        fecha: p.fecha,
        cliente_id: p.cliente_id,
        cliente: p.cliente_nombre || "Sin cliente",
        vehiculo_id: p.vehiculo_id,
        matricula: p.matricula || "Sin vehiculo",
        vehiculo: [p.matricula, p.marca, p.modelo].filter(Boolean).join(" ") || "Sin vehiculo",
        origen: p.origen || "",
        destino: p.destino || "",
        estado: p.estado,
        km_ruta: round2(kmRuta),
        km_vacio: round2(kmVacio),
        km_total: round2(kmTotal),
        litros_estimados: round2(litros),
        co2_kg: round2(co2Kg),
        co2_t: round2(co2Kg / 1000),
        co2_kg_km: kmTotal > 0 ? round2(co2Kg / kmTotal) : null,
        co2_kg_eur: ingreso > 0 ? round2(co2Kg / ingreso) : null,
        ingreso: round2(ingreso),
        datos_incompletos: kmTotal <= 0,
      };
    };
    const pedidos = rows.map(calcPedido);

    const aggregate = (items, keyFn, labelFn) => {
      const map = new Map();
      for (const p of items) {
        const key = keyFn(p);
        const item = map.get(key) || { id: key, nombre: labelFn(p), pedidos: 0, km_total: 0, km_vacio: 0, litros_estimados: 0, co2_kg: 0, ingreso: 0, datos_incompletos: 0 };
        item.pedidos += 1;
        item.km_total += Number(p.km_total || 0);
        item.km_vacio += Number(p.km_vacio || 0);
        item.litros_estimados += Number(p.litros_estimados || 0);
        item.co2_kg += Number(p.co2_kg || 0);
        item.ingreso += Number(p.ingreso || 0);
        if (p.datos_incompletos) item.datos_incompletos += 1;
        map.set(key, item);
      }
      return Array.from(map.values())
        .map(x => ({
          ...x,
          km_total: round2(x.km_total),
          km_vacio: round2(x.km_vacio),
          pct_km_vacio: x.km_total > 0 ? round2((x.km_vacio / x.km_total) * 100) : null,
          litros_estimados: round2(x.litros_estimados),
          co2_kg: round2(x.co2_kg),
          co2_t: round2(x.co2_kg / 1000),
          co2_kg_km: x.km_total > 0 ? round2(x.co2_kg / x.km_total) : null,
          co2_kg_eur: x.ingreso > 0 ? round2(x.co2_kg / x.ingreso) : null,
          ingreso: round2(x.ingreso),
        }))
        .sort((a, b) => b.co2_kg - a.co2_kg);
    };

    const resumen = pedidos.reduce((acc, p) => {
      acc.pedidos += 1;
      acc.km_total += Number(p.km_total || 0);
      acc.km_vacio += Number(p.km_vacio || 0);
      acc.litros_estimados += Number(p.litros_estimados || 0);
      acc.co2_kg += Number(p.co2_kg || 0);
      acc.ingreso += Number(p.ingreso || 0);
      if (p.datos_incompletos) acc.datos_incompletos += 1;
      return acc;
    }, { pedidos: 0, km_total: 0, km_vacio: 0, litros_estimados: 0, co2_kg: 0, ingreso: 0, datos_incompletos: 0 });
    resumen.km_total = round2(resumen.km_total);
    resumen.km_vacio = round2(resumen.km_vacio);
    resumen.pct_km_vacio = resumen.km_total > 0 ? round2((resumen.km_vacio / resumen.km_total) * 100) : null;
    resumen.litros_estimados = round2(resumen.litros_estimados);
    resumen.co2_kg = round2(resumen.co2_kg);
    resumen.co2_t = round2(resumen.co2_kg / 1000);
    resumen.co2_kg_km = resumen.km_total > 0 ? round2(resumen.co2_kg / resumen.km_total) : null;
    resumen.co2_kg_eur = resumen.ingreso > 0 ? round2(resumen.co2_kg / resumen.ingreso) : null;
    resumen.ingreso = round2(resumen.ingreso);

    const por_cliente = aggregate(pedidos, p => p.cliente_id || p.cliente, p => p.cliente).slice(0, 20);
    const por_vehiculo = aggregate(pedidos, p => p.vehiculo_id || p.matricula, p => p.vehiculo).slice(0, 20);
    const por_ruta = aggregate(
      pedidos,
      p => `${p.origen || "-"} -> ${p.destino || "-"}`,
      p => `${p.origen || "-"} -> ${p.destino || "-"}`
    ).slice(0, 20);
    const pendientes_km = pedidos.filter(p => p.datos_incompletos).slice(0, 30);
    const acciones = [];
    if (pendientes_km.length > 0) {
      acciones.push({
        type: "viajes_sin_km",
        severity: pendientes_km.length >= 10 ? "alta" : "media",
        title: `${pendientes_km.length} viaje(s) sin kilometros`,
        description: "Completar km ruta/km vacio antes de usar el informe en licitaciones o reporting ESG.",
        recommendation: "Priorizar viajes recientes y clientes con mas volumen para no falsear CO2/km.",
        count: pendientes_km.length,
        items: pendientes_km.slice(0, 8).map(p => ({ id: p.id, numero: p.numero, cliente: p.cliente, origen: p.origen, destino: p.destino })),
      });
    }
    if (resumen.pct_km_vacio != null && Number(resumen.pct_km_vacio) >= 25) {
      acciones.push({
        type: "km_vacio_alto",
        severity: Number(resumen.pct_km_vacio) >= 35 ? "alta" : "media",
        title: `KM en vacio alto: ${round2(resumen.pct_km_vacio)}%`,
        description: "El porcentaje de km en vacio penaliza coste, margen y emisiones.",
        recommendation: "Revisar retornos, consolidaciones y asignacion de vehiculos en rutas repetidas.",
        value: resumen.pct_km_vacio,
      });
    }
    const clienteIntensivo = por_cliente.find(c => Number(c.co2_kg_km || 0) > 1.05 * Number(resumen.co2_kg_km || 0) && Number(c.pedidos || 0) >= 2);
    if (clienteIntensivo) {
      acciones.push({
        type: "cliente_intensivo",
        severity: "media",
        title: `Cliente con intensidad alta: ${clienteIntensivo.nombre}`,
        description: `${round2(clienteIntensivo.co2_kg_km)} kg CO2/km frente a media ${resumen.co2_kg_km == null ? "-" : round2(resumen.co2_kg_km)}.`,
        recommendation: "Simular rutas, retornos o vehiculo alternativo antes de renovar condiciones.",
        entity_id: clienteIntensivo.id,
      });
    }
    const rutasVacio = por_ruta.filter(r => Number(r.pct_km_vacio || 0) >= 30).slice(0, 3);
    for (const ruta of rutasVacio) {
      acciones.push({
        type: "ruta_vacio_alto",
        severity: Number(ruta.pct_km_vacio || 0) >= 45 ? "alta" : "media",
        title: `Ruta con mucho vacio: ${ruta.nombre}`,
        description: `${round2(ruta.pct_km_vacio)}% km vacio - ${round2(ruta.co2_t)} t CO2.`,
        recommendation: "Buscar carga de retorno, agrupar viajes o revisar tarifa con coste ambiental.",
        entity_id: ruta.id,
      });
    }

    res.json({
      period,
      desde,
      hasta,
      metodologia: {
        estado: "estimacion_preparatoria_iso_14083_glec",
        consumo_l_100km: consumoSeguro,
        factor_kg_co2_litro: factorSeguro,
        nota: "Estimacion basada en kilometros operativos y factor diesel. Preparado para sustituir por consumos reales/telematica cuando esten disponibles.",
      },
      resumen,
      por_cliente,
      por_vehiculo,
      por_ruta,
      pendientes_km,
      acciones,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo calcular emisiones operativas" });
  }
});

router.get("/datos-maestros-readiness", cacheMiddleware(30), async (req, res) => {
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
  try {
    const [clientesRes, colaboradoresRes, choferesRes, vehiculosRes] = await Promise.all([
      db.query(`
        SELECT id,nombre,cif,email,email_facturacion,telefono,contacto,contacto AS contacto_nombre,
               direccion,calle,cp,cod_postal,ciudad,municipio,provincia,pais,pais_iso
          FROM clientes
         WHERE empresa_id=$1 AND activo IS DISTINCT FROM false
         ORDER BY nombre
         LIMIT 250
      `, [empresaId]).catch(() => ({ rows: [] })),
      db.query(`
        SELECT id,nombre,cif,email,telefono,iban,calle,codigo_postal,ciudad,provincia,pais,
               contacto_nombre,contacto_telefono
          FROM colaboradores
         WHERE empresa_id=$1 AND activo IS DISTINCT FROM false
         ORDER BY nombre
         LIMIT 250
      `, [empresaId]).catch(() => ({ rows: [] })),
      db.query(`
        SELECT id,nombre,apellidos,dni,telefono,email,categoria_carnet,fecha_alta
          FROM choferes
         WHERE empresa_id=$1 AND activo IS DISTINCT FROM false
         ORDER BY nombre,apellidos
         LIMIT 250
      `, [empresaId]).catch(() => ({ rows: [] })),
      db.query(`
        SELECT id,matricula,marca,modelo,tipo,clase,bastidor,fecha_itv,fecha_seguro,carga_max_kg,tara_kg
          FROM vehiculos
         WHERE empresa_id=$1 AND activo IS DISTINCT FROM false
         ORDER BY matricula
         LIMIT 250
      `, [empresaId]).catch(() => ({ rows: [] })),
    ]);

    const clientes = clientesRes.rows.map(c => {
      const direccion = [c.direccion, c.calle, c.cp || c.cod_postal, c.ciudad || c.municipio, c.provincia, c.pais || c.pais_iso].filter(hasText).join(" ");
      return readinessFor({
        id: c.id,
        nombre: c.nombre,
        tipo: "cliente",
        contacto: [c.contacto_nombre || c.contacto, c.email_facturacion || c.email, c.telefono].filter(hasText).join(" | "),
      }, [
        { key:"nombre", label:"Nombre fiscal/comercial", ok:hasText(c.nombre), category:"identidad" },
        { key:"cif", label:"CIF/NIF/VAT", ok:hasText(c.cif), category:"identidad" },
        { key:"direccion", label:"Domicilio completo", ok:hasText(direccion), category:"direccion" },
        { key:"email", label:"Email valido", ok:hasEmail(c.email_facturacion || c.email), category:"contacto" },
        { key:"telefono", label:"Telefono", ok:hasText(c.telefono), category:"contacto", required:false },
        { key:"contacto", label:"Persona de contacto", ok:hasText(c.contacto_nombre || c.contacto), category:"contacto", required:false },
      ]);
    });

    const colaboradores = colaboradoresRes.rows.map(c => {
      const direccion = [c.calle, c.codigo_postal, c.ciudad, c.provincia, c.pais].filter(hasText).join(" ");
      return readinessFor({
        id: c.id,
        nombre: c.nombre,
        tipo: "colaborador",
        contacto: [c.contacto_nombre, c.email, c.telefono || c.contacto_telefono].filter(hasText).join(" | "),
      }, [
        { key:"nombre", label:"Razon social/nombre", ok:hasText(c.nombre), category:"identidad" },
        { key:"cif", label:"CIF/NIF/VAT", ok:hasText(c.cif), category:"identidad" },
        { key:"direccion", label:"Domicilio completo", ok:hasText(direccion), category:"direccion" },
        { key:"email", label:"Email valido", ok:hasEmail(c.email), category:"contacto" },
        { key:"telefono", label:"Telefono", ok:hasText(c.telefono || c.contacto_telefono), category:"contacto", required:false },
        { key:"iban", label:"IBAN para liquidaciones", ok:hasText(c.iban), category:"finanzas", required:false },
      ]);
    });

    const choferes = choferesRes.rows.map(c => readinessFor({
      id: c.id,
      nombre: [c.nombre, c.apellidos].filter(hasText).join(" ") || c.nombre,
      tipo: "chofer",
      contacto: [c.email, c.telefono].filter(hasText).join(" | "),
    }, [
      { key:"nombre", label:"Nombre y apellidos", ok:hasText(c.nombre) && hasText(c.apellidos), category:"identidad" },
      { key:"dni", label:"DNI/NIE", ok:hasText(c.dni), category:"identidad" },
      { key:"telefono", label:"Telefono", ok:hasText(c.telefono), category:"contacto" },
      { key:"email", label:"Email valido", ok:hasEmail(c.email), category:"contacto", required:false },
      { key:"carnet", label:"Categoria de carnet", ok:hasText(c.categoria_carnet), category:"cumplimiento" },
      { key:"fecha_alta", label:"Fecha de alta", ok:!!c.fecha_alta, category:"laboral", required:false },
    ]));

    const vehiculos = vehiculosRes.rows.map(v => readinessFor({
      id: v.id,
      nombre: v.matricula || "Vehiculo sin matricula",
      tipo: "vehiculo",
      contacto: [v.marca, v.modelo, v.clase || v.tipo].filter(hasText).join(" | "),
    }, [
      { key:"matricula", label:"Matricula", ok:hasText(v.matricula), category:"identidad" },
      { key:"tipo", label:"Tipo/clase de vehiculo", ok:hasText(v.clase || v.tipo), category:"operativa" },
      { key:"marca_modelo", label:"Marca y modelo", ok:hasText(v.marca) && hasText(v.modelo), category:"identidad", required:false },
      { key:"bastidor", label:"Bastidor", ok:hasText(v.bastidor), category:"identidad", required:false },
      { key:"itv", label:"Fecha ITV", ok:!!v.fecha_itv, category:"cumplimiento" },
      { key:"seguro", label:"Fecha seguro", ok:!!v.fecha_seguro, category:"cumplimiento" },
      { key:"capacidad", label:"Tara o carga maxima", ok:Number(v.carga_max_kg || 0) > 0 || Number(v.tara_kg || 0) > 0, category:"operativa", required:false },
    ]));

    const secciones = {
      clientes: { resumen: summarizeReadiness(clientes), items: clientes.sort((a,b) => a.score - b.score).slice(0, 50) },
      colaboradores: { resumen: summarizeReadiness(colaboradores), items: colaboradores.sort((a,b) => a.score - b.score).slice(0, 50) },
      choferes: { resumen: summarizeReadiness(choferes), items: choferes.sort((a,b) => a.score - b.score).slice(0, 50) },
      vehiculos: { resumen: summarizeReadiness(vehiculos), items: vehiculos.sort((a,b) => a.score - b.score).slice(0, 50) },
    };
    const totalItems = Object.values(secciones).reduce((sum, sec) => sum + sec.resumen.total, 0);
    const completos = Object.values(secciones).reduce((sum, sec) => sum + sec.resumen.completos, 0);
    const faltantes = Object.values(secciones).reduce((sum, sec) => sum + sec.resumen.faltantes_obligatorios, 0);
    const scoreMedio = totalItems
      ? Math.round(Object.values(secciones).reduce((sum, sec) => sum + (sec.resumen.score_medio * sec.resumen.total), 0) / totalItems)
      : 100;

    res.json({
      generated_at: new Date().toISOString(),
      objetivo: "Preparacion de datos maestros para DCD/eCMR/eFTI, firma electronica y portales B2B.",
      resumen: {
        total: totalItems,
        completos,
        incompletos: totalItems - completos,
        pct_completo: pct(completos, totalItems),
        score_medio: scoreMedio,
        faltantes_obligatorios: faltantes,
        estado: scoreMedio >= 90 && faltantes === 0 ? "verde" : scoreMedio >= 70 ? "amarillo" : "rojo",
      },
      secciones,
      acciones_recomendadas: [
        "Completar CIF/NIF/VAT y domicilio antes de emitir documentos digitales.",
        "Revisar emails de facturacion/contacto para firma, eCMR y portal cliente.",
        "Mantener ITV, seguro y categoria de vehiculo actualizados antes de planificar viajes regulados.",
        "Completar DNI, telefono y carnet de choferes antes de activar flujos de firma o inspeccion.",
      ],
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo calcular la preparacion de datos maestros" });
  }
});

router.get("/cumplimiento-europeo", authenticate, GERENTE_O_TRAFICO, cacheMiddleware(30), async (req, res) => {
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
  const days = Math.max(1, Math.min(120, Number(req.query.days || 30) || 30));
  const desde = new Date();
  desde.setDate(desde.getDate() - 3);
  const hasta = new Date();
  hasta.setDate(hasta.getDate() + days);
  const desdeStr = desde.toISOString().slice(0, 10);
  const hastaStr = hasta.toISOString().slice(0, 10);
  try {
    await ensureRegulatoryCoreSchema().catch(() => {});
    const { rows } = await db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.estado::text AS estado,
             p.fecha_carga, p.fecha_descarga, p.fecha_entrega,
             p.mercancia, p.notas, p.condiciones_adicionales, p.referencia_cliente,
             p.peso_kg, p.colaborador_id,
             c.nombre AS cliente_nombre,
             co.nombre AS colaborador_nombre,
             v.matricula AS vehiculo_matricula,
             v.clase AS vehiculo_clase,
             v.tipo AS vehiculo_tipo
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
        LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
       WHERE p.empresa_id=$1
         AND p.estado::text NOT IN ('cancelado','entregado','facturado')
         AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) BETWEEN $2 AND $3
       ORDER BY COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) ASC, p.created_at ASC
       LIMIT 300
    `, [empresaId, desdeStr, hastaStr]);

    const pedidoIds = rows.map(r => r.id).filter(Boolean);
    const regulatoryByPedido = new Map();
    const ensureReg = id => {
      const key = String(id);
      if (!regulatoryByPedido.has(key)) {
        regulatoryByPedido.set(key, {
          payloads: {},
          documents: {},
          checklist: null,
          waste: null,
          adr: null,
          latest_audit_at: null,
        });
      }
      return regulatoryByPedido.get(key);
    };

    if (pedidoIds.length) {
      const [payloads, documents, wasteRows, adrRows, audits] = await Promise.all([
        db.query(`
          SELECT pedido_id,payload_type,status,version,hash_sha256,validation,updated_at
            FROM regulatory_payloads
           WHERE empresa_id=$1 AND pedido_id = ANY($2::uuid[])
        `, [empresaId, pedidoIds]).catch(() => ({ rows: [] })),
        db.query(`
          SELECT pedido_id,document_type,status,filename,mime,hash_sha256,url,metadata,updated_at
            FROM regulatory_documents
           WHERE empresa_id=$1 AND pedido_id = ANY($2::uuid[])
        `, [empresaId, pedidoIds]).catch(() => ({ rows: [] })),
        db.query(`
          SELECT pedido_id,is_waste,procedure_type,waste_code,hazardous,annex_vii,notification_required,validation,updated_at
            FROM regulatory_waste_details
           WHERE empresa_id=$1 AND pedido_id = ANY($2::uuid[])
        `, [empresaId, pedidoIds]).catch(() => ({ rows: [] })),
        db.query(`
          SELECT pedido_id,adr_applicable,un_number,adr_class,validation,updated_at
            FROM regulatory_dangerous_goods_details
           WHERE empresa_id=$1 AND pedido_id = ANY($2::uuid[])
        `, [empresaId, pedidoIds]).catch(() => ({ rows: [] })),
        db.query(`
          SELECT DISTINCT ON (pedido_id) pedido_id,detail,created_at
            FROM regulatory_audit_logs
           WHERE empresa_id=$1 AND pedido_id = ANY($2::uuid[])
           ORDER BY pedido_id, created_at DESC
        `, [empresaId, pedidoIds]).catch(() => ({ rows: [] })),
      ]);
      for (const p of payloads.rows || []) {
        ensureReg(p.pedido_id).payloads[p.payload_type] = {
          status: p.status,
          version: Number(p.version || 1),
          hash_sha256: p.hash_sha256 || "",
          validation: p.validation || {},
          updated_at: p.updated_at,
        };
      }
      for (const d of documents.rows || []) {
        ensureReg(d.pedido_id).documents[d.document_type] = {
          status: d.status,
          filename: d.filename || "",
          mime: d.mime || "",
          hash_sha256: d.hash_sha256 || "",
          url: d.url || "",
          metadata: d.metadata || {},
          updated_at: d.updated_at,
        };
      }
      for (const w of wasteRows.rows || []) ensureReg(w.pedido_id).waste = w;
      for (const a of adrRows.rows || []) ensureReg(a.pedido_id).adr = a;
      for (const audit of audits.rows || []) {
        const reg = ensureReg(audit.pedido_id);
        reg.latest_audit_at = audit.created_at;
        reg.checklist = audit.detail?.checklist || null;
      }
    }

    const makeRegulatoryStatus = (pedidoId, flags) => {
      const reg = regulatoryByPedido.get(String(pedidoId)) || { payloads: {}, documents: {}, checklist: null, waste: null, adr: null };
      const deca = reg.documents?.deca || null;
      const efti = reg.payloads?.efti || null;
      const ecmr = reg.payloads?.ecmr || null;
      const diwass = reg.payloads?.diwass || null;
      const blocking = Array.isArray(reg.checklist?.blocking) ? reg.checklist.blocking : [];
      const ecmrMissing = Array.isArray(ecmr?.validation?.missing) ? ecmr.validation.missing : [];
      const diwassMissing = Array.isArray(diwass?.validation?.missing) ? diwass.validation.missing : [];
      const adrMissing = Array.isArray(reg.adr?.validation?.missing) ? reg.adr.validation.missing : [];
      const generated = !!(deca?.hash_sha256 || deca?.filename);
      return {
        status: reg.checklist?.status || (generated && efti ? "ready" : "requires_preparation"),
        ready: !!generated && !!efti && blocking.length === 0,
        latest_audit_at: reg.latest_audit_at || null,
        deca: {
          ready: generated,
          status: deca?.status || "missing",
          filename: deca?.filename || "",
          hash_sha256: deca?.hash_sha256 || "",
          updated_at: deca?.updated_at || null,
        },
        payloads: {
          efti: efti || null,
          ecmr: ecmr || null,
          diwass: diwass || null,
        },
        checklist: reg.checklist,
        blocking,
        requires_review: {
          deca: !generated,
          efti: !efti,
          ecmr: !!(flags.internacional && ecmrMissing.length),
          diwass: !!(flags.diwass || reg.waste?.is_waste) && (!diwass || diwass.status === "requires_review" || diwassMissing.length > 0),
          adr: !!(flags.adr || reg.adr?.adr_applicable) && adrMissing.length > 0,
        },
        waste: reg.waste,
        adr: reg.adr,
      };
    };

    const items = rows.map(p => {
      const compliance = detectTransportComplianceSignals(p);
      const wasteSignals = detectWasteSignals(p);
      const flags = {
        adr: !!compliance.adr?.requiere_revision,
        zbe: !!compliance.zbe?.requiere_revision,
        internacional: !!compliance.internacional?.requiere_revision,
        cabotaje: !!compliance.cabotaje?.requiere_revision,
        tacografo: !!compliance.tacografo?.requiere_revision,
        diwass: !!wasteSignals.detected,
      };
      const regulatory = makeRegulatoryStatus(p.id, flags);
      const regulatoryFlags = {
        deca: !!regulatory.requires_review.deca,
        efti: !!regulatory.requires_review.efti,
        ecmr: !!regulatory.requires_review.ecmr,
        regulatory_blocking: !!(regulatory.blocking || []).length,
      };
      const allFlags = { ...flags, ...regulatoryFlags };
      const count = Object.values(allFlags).filter(Boolean).length;
      const prioridad = flags.adr || flags.cabotaje || flags.diwass || regulatory.requires_review.diwass || regulatory.requires_review.adr
        ? "alta"
        : flags.internacional || flags.tacografo || flags.zbe || regulatoryFlags.deca || regulatoryFlags.efti || regulatoryFlags.ecmr || regulatoryFlags.regulatory_blocking
          ? "media"
          : "baja";
      return {
        id: p.id,
        numero: p.numero,
        cliente: p.cliente_nombre || "Sin cliente",
        colaborador: p.colaborador_nombre || null,
        vehiculo: p.vehiculo_matricula || null,
        origen: p.origen || "",
        destino: p.destino || "",
        estado: p.estado,
        estado_label: estadoPedidoLabel(p.estado),
        fecha_carga: p.fecha_carga,
        fecha_descarga: p.fecha_descarga || p.fecha_entrega || null,
        prioridad,
        score_riesgo: count ? Math.min(100, 25 + count * 12 + (flags.adr ? 20 : 0) + (flags.cabotaje ? 15 : 0) + (flags.diwass ? 20 : 0) + (regulatoryFlags.regulatory_blocking ? 10 : 0)) : 0,
        flags: allFlags,
        regulatory_core: regulatory,
        cumplimiento: {
          ...compliance,
          diwass_eannex_vii: {
            requiere_revision: flags.diwass,
            senal_residuo: !!wasteSignals.detected,
            indicio_transfronterizo: !!wasteSignals.cross_border_hint,
            terminos_detectados: wasteSignals.detected_terms || [],
            terminos_transfronterizos: wasteSignals.cross_border_terms || [],
            datos_requeridos_si_aplica: [
              "codigo_ler_residuo",
              "productor_o_poseedor",
              "destinatario_instalacion",
              "transportistas_intervinientes",
              "pais_origen_destino",
              "firmas_de_las_partes",
            ],
            accion: flags.diwass
              ? "Validar si el traslado entra en eAnnex VII/DIWASS, completar datos maestros de residuos y preparar firma/documento digital."
              : "Sin senal automatica de residuos/eAnnex VII.",
          },
        },
        accion_recomendada: count
          ? "Revisar y documentar los avisos antes de confirmar, asignar o remitir el documento digital."
          : "Sin señales automáticas; mantener comprobaciones ordinarias de operativa.",
      };
    });
    const conSenales = items.filter(i => Object.values(i.flags).some(Boolean));
    const countFlag = key => conSenales.filter(i => i.flags[key]).length;
    const regCount = (predicate) => items.filter(predicate).length;
    const resumen = {
      total_viajes: items.length,
      con_senales: conSenales.length,
      sin_senales: items.length - conSenales.length,
      adr: countFlag("adr"),
      zbe: countFlag("zbe"),
      internacional: countFlag("internacional"),
      cabotaje: countFlag("cabotaje"),
      tacografo: countFlag("tacografo"),
      diwass: countFlag("diwass"),
      deca_pendiente: countFlag("deca"),
      efti_pendiente: countFlag("efti"),
      ecmr_revision: countFlag("ecmr"),
      bloqueos_regulatorios: countFlag("regulatory_blocking"),
      regulatory_ready: regCount(i => i.regulatory_core?.ready),
      regulatory_preparacion: regCount(i => !i.regulatory_core?.ready),
      alta: conSenales.filter(i => i.prioridad === "alta").length,
      media: conSenales.filter(i => i.prioridad === "media").length,
      baja: conSenales.filter(i => i.prioridad === "baja").length,
    };
    const acciones = [];
    if (resumen.deca_pendiente) acciones.push({ type: "deca", severity: "media", title: `${resumen.deca_pendiente} viaje(s) sin DeCA archivado`, recommendation: "Generar el PDF nativo DeCA/DCD, guardarlo en repositorio, activar URL/QR durante el servicio y conservarlo internamente." });
    if (resumen.efti_pendiente) acciones.push({ type: "efti", severity: "media", title: `${resumen.efti_pendiente} viaje(s) sin payload eFTI interno`, recommendation: "Preparar dataset eFTI interno para futura pasarela certificada y mantener trazabilidad de versiones." });
    if (resumen.ecmr_revision) acciones.push({ type: "ecmr", severity: "media", title: `${resumen.ecmr_revision} viaje(s) con eCMR a revisar`, recommendation: "Completar datos de carta de porte internacional y preparar interoperabilidad con proveedor eCMR certificado si aplica." });
    if (resumen.bloqueos_regulatorios) acciones.push({ type: "regulatory_blocking", severity: "alta", title: `${resumen.bloqueos_regulatorios} viaje(s) con bloqueos regulatorios`, recommendation: "Resolver los elementos marcados en checklist antes de cerrar la preparacion documental." });
    if (resumen.adr) acciones.push({ type: "adr", severity: "alta", title: `${resumen.adr} viaje(s) con senal ADR`, recommendation: "Validar carta ADR, conductor, vehiculo, instrucciones escritas y restricciones antes de expedir." });
    if (resumen.cabotaje) acciones.push({ type: "cabotaje", severity: "alta", title: `${resumen.cabotaje} viaje(s) con riesgo de cabotaje/subcontratacion`, recommendation: "Revisar carrier, reglas aplicables y evidencia documental antes de asignar." });
    if (resumen.diwass) acciones.push({ type: "diwass", severity: "alta", title: `${resumen.diwass} viaje(s) con senal DIWASS/eAnnex VII`, recommendation: "Confirmar si es traslado transfronterizo de residuos, completar codigo LER, partes, transportistas, destino y firmas antes de operar." });
    if (resumen.internacional) acciones.push({ type: "internacional", severity: "media", title: `${resumen.internacional} viaje(s) con senal internacional`, recommendation: "Preparar eCMR/eFTI, datos maestros y soporte documental B2B/B2A." });
    if (resumen.zbe) acciones.push({ type: "zbe", severity: "media", title: `${resumen.zbe} viaje(s) con posible ZBE/acceso urbano`, recommendation: "Comprobar etiqueta ambiental, ventanas locales, galibo, MMA y accesos a muelle." });
    if (resumen.tacografo) acciones.push({ type: "tacografo", severity: "media", title: `${resumen.tacografo} viaje(s) requieren revisar tacografo/horas`, recommendation: "Confirmar horas disponibles, descansos, dispositivo y compatibilidad del vehiculo." });

    res.json({
      generated_at: new Date().toISOString(),
      periodo: { desde: desdeStr, hasta: hastaStr, dias_adelante: days },
      marco_normativo: {
        documento_control_obligatorio_desde: "2026-10-05",
        diwass_eannex_vii_entrada_vigor: "2026-05-21",
        efti_plena_aplicacion_desde: "2027-07-09",
        nota: "Detección preventiva por señales del pedido. No sustituye validación legal humana ni integraciones certificadas.",
      },
      resumen,
      acciones,
      viajes: conSenales
        .sort((a, b) => Number(b.score_riesgo || 0) - Number(a.score_riesgo || 0))
        .slice(0, 100),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo calcular cumplimiento europeo" });
  }
});

router.get("/dashboard", cacheMiddleware(60), async (req, res) => {
  const { desde, hasta } = req.query;
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
  const d = desde || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);
  const h = hasta || new Date().toISOString().slice(0,10);

  const [kpis, evolucion, porCliente, costes] = await Promise.all([
    // KPIs globales — filtered by empresa_id
    db.query(`
      SELECT
        COALESCE(SUM(f.base_imponible),0)                                       AS base_total,
        COALESCE(SUM(f.total),0)                                                AS facturado_total,
        COALESCE(SUM(CASE WHEN f.estado='cobrada' THEN f.total ELSE 0 END),0)  AS cobrado,
        COALESCE(SUM(CASE WHEN f.estado IN ('emitida','enviada') THEN f.total ELSE 0 END),0) AS pendiente,
        COUNT(f.id)                                                             AS num_facturas,
        COUNT(DISTINCT f.cliente_id)                                            AS num_clientes_activos
      FROM facturas f
      WHERE f.empresa_id = $3 AND f.fecha BETWEEN $1 AND $2 AND f.estado != 'rectificada'
    `, [d, h, empresaId]),

    // Evolución mensual
    db.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', f.fecha), 'YYYY-MM') AS mes,
        TO_CHAR(DATE_TRUNC('month', f.fecha), 'Mon')     AS mes_label,
        SUM(f.total)                                     AS facturado,
        SUM(CASE WHEN f.estado='cobrada' THEN f.total ELSE 0 END) AS cobrado
      FROM facturas f
      WHERE f.empresa_id = $3 AND f.fecha BETWEEN $1 AND $2 AND f.estado != 'rectificada'
      GROUP BY DATE_TRUNC('month', f.fecha)
      ORDER BY DATE_TRUNC('month', f.fecha)
    `, [d, h, empresaId]),

    // Por cliente (top 10)
    db.query(`
      SELECT c.nombre, c.id,
             SUM(f.total) AS facturado,
             SUM(CASE WHEN f.estado='cobrada' THEN f.total ELSE 0 END) AS cobrado,
             COUNT(f.id) AS num_facturas
      FROM facturas f JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
      WHERE f.empresa_id = $3 AND f.fecha BETWEEN $1 AND $2 AND f.estado != 'rectificada'
      GROUP BY c.id, c.nombre
      ORDER BY facturado DESC
      LIMIT 10
    `, [d, h, empresaId]),

    // Costes y margen de pedidos — safe with column existence check
    db.query(`
      SELECT
        COALESCE(SUM(
          COALESCE(coste_gasoil,0)+COALESCE(coste_peajes,0)+
          COALESCE(coste_dietas,0)+COALESCE(coste_otros,0)
        ),0) AS coste_total,
        COUNT(*) AS total_pedidos
      FROM pedidos
      WHERE empresa_id = $3
        AND fecha_carga BETWEEN $1 AND $2
        AND estado NOT IN ('cancelado')
    `, [d, h, empresaId]).catch(() => ({ rows: [{ coste_total: 0, total_pedidos: 0 }] })),
  ]);

  const kpiData = kpis.rows[0] || {};
  const costData = costes ? costes.rows[0] : {};
  const costeTotal = parseFloat(costData.coste_total || 0);
  const facturado  = parseFloat(kpiData.base_total || 0);
  avisarBajadaRendimiento(empresaId, req.user?.id || null, d, h).catch(() => {});
  res.json({
    kpis: {
      ...kpiData,
      coste_total:     costeTotal,
      margen_total:    facturado - costeTotal,
      margen_pct:      facturado > 0 ? ((facturado - costeTotal) / facturado * 100).toFixed(1) : null,
      pedidos_con_coste: parseInt(costData.pedidos_con_coste || 0),
      total_pedidos:     parseInt(costData.total_pedidos || 0),
    },
    evolucion:  evolucion.rows,
    porCliente: porCliente.rows,
  });
});

// ── GET /informes/rutas ───────────────────────────────
router.get("/rutas", async (req, res) => {
  const { desde, hasta } = req.query;
  const empresaId = req.user?.empresa_id;
  const d = desde || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);
  const h = hasta || new Date().toISOString().slice(0,10);

  const { rows } = await db.query(`
    SELECT
      r.id, r.origen, r.destino, r.km, r.peajes,
      COUNT(p.id)                  AS num_viajes,
      COALESCE(SUM(p.importe), 0)  AS facturado,
      COALESCE(SUM(p.importe - (r.km * 0.42 + r.peajes)), 0) AS margen_estimado
    FROM rutas r
    LEFT JOIN pedidos p ON p.ruta_id = r.id
      AND p.fecha_pedido BETWEEN $1 AND $2
      AND p.estado = 'entregado'
      AND p.empresa_id = $3
    WHERE r.empresa_id = $3
    GROUP BY r.id, r.origen, r.destino, r.km, r.peajes
    ORDER BY facturado DESC
  `, [d, h, empresaId]);

  res.json(rows);
});

// ── GET /informes/choferes (solo gerente) ─────────────
router.get("/choferes", SOLO_GERENTE, async (req, res) => {
  const { desde, hasta } = req.query;
  const empresaId = req.user?.empresa_id;
  const d = desde || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);
  const h = hasta || new Date().toISOString().slice(0,10);

  const { rows } = await db.query(`
    SELECT
      ch.id, ch.nombre, ch.vehiculo_id, v.matricula,
      COUNT(p.id)                 AS num_viajes,
      COALESCE(SUM(p.importe),0)  AS facturado,
      COALESCE(SUM(pe.importe),0) AS extracostes
    FROM choferes ch
    LEFT JOIN pedidos p ON p.chofer_id = ch.id
      AND p.fecha_pedido BETWEEN $1 AND $2
      AND p.estado = 'entregado'
      AND p.empresa_id = $3
    LEFT JOIN pedido_extracostes pe ON pe.pedido_id = p.id
    LEFT JOIN vehiculos v ON v.id = ch.vehiculo_id AND v.empresa_id=ch.empresa_id
    WHERE ch.empresa_id = $3
    GROUP BY ch.id, ch.nombre, ch.vehiculo_id, v.matricula
    ORDER BY facturado DESC
  `, [d, h, empresaId]);

  res.json(rows);
});

// ── GET /informes/cobros ──────────────────────────────
router.get("/cobros", async (req, res) => {
  const empresaId = req.user?.empresa_id;
  const [pendientes, ratioMensual] = await Promise.all([
    db.query(`
      SELECT f.id, f.numero, f.total, f.fecha, f.fecha_vencimiento, f.estado,
             c.nombre AS cliente_nombre, c.email AS cliente_email
      FROM facturas f JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
      WHERE f.empresa_id=$1 AND f.estado IN ('emitida','enviada','vencida')
      ORDER BY f.fecha_vencimiento ASC NULLS LAST
    `, [empresaId]),
    db.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', fecha), 'Mon YYYY') AS mes,
        SUM(total) AS emitido,
        SUM(CASE WHEN estado='cobrada' THEN total ELSE 0 END) AS cobrado
      FROM facturas
      WHERE empresa_id=$1 AND estado != 'rectificada'
        AND fecha >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', fecha)
      ORDER BY DATE_TRUNC('month', fecha)
    `, [empresaId]),
  ]);

  res.json({ pendientes: pendientes.rows, ratioMensual: ratioMensual.rows });
});

router.get("/control-tower", authenticate, GERENTE_O_TRAFICO, cacheMiddleware(20), async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    const period = String(req.query.period || "7d");
    const { desde, hasta } = rangoPeriodo(period);
    const safeRows = (promise) => promise.then(r => r.rows || []).catch(() => []);
    await ensureRegulatoryCoreSchema().catch(() => {});
    await ensureChoferVacacionesSchemaForInformes().catch(() => {});

    const [kpiRows, proximos, incidencias, retrasos, sinAsignar, margen, docs, facturacionInconsistente, cobros, gps, regulatoryDocs] = await Promise.all([
      safeRows(db.query(`
        SELECT
          COUNT(*) FILTER (WHERE p.estado::text NOT IN ('cancelado','entregado','facturado') AND p.factura_id IS NULL)::int AS activos,
          COUNT(*) FILTER (WHERE p.fecha_carga::date=CURRENT_DATE AND p.factura_id IS NULL)::int AS cargas_hoy,
          COUNT(*) FILTER (WHERE COALESCE(p.fecha_descarga::date,p.fecha_entrega::date)=CURRENT_DATE AND p.factura_id IS NULL)::int AS descargas_hoy,
          COUNT(*) FILTER (WHERE p.fecha_carga::date BETWEEN $2::date AND $3::date AND p.factura_id IS NULL)::int AS cargas_periodo,
          COUNT(*) FILTER (WHERE COALESCE(p.fecha_descarga::date,p.fecha_entrega::date) BETWEEN $2::date AND $3::date AND p.factura_id IS NULL)::int AS descargas_periodo,
          COUNT(*) FILTER (WHERE p.estado::text='incidencia' AND p.factura_id IS NULL)::int AS incidencias,
          COUNT(*) FILTER (
            WHERE p.estado::text NOT IN ('cancelado','entregado','facturado')
              AND p.factura_id IS NULL
              AND COALESCE(p.fecha_descarga::date,p.fecha_entrega::date,p.fecha_carga::date) < CURRENT_DATE
          )::int AS retrasados
        FROM pedidos p
        LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
        WHERE p.empresa_id=$1
      `, [empresaId, desde, hasta])),
      safeRows(db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga, p.estado::text AS estado,
               c.nombre AS cliente_nombre,
               v.matricula AS vehiculo_matricula,
               ch.nombre AS chofer_nombre,
               col.nombre AS colaborador_nombre
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
          LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
          LEFT JOIN colaboradores col ON col.id=p.colaborador_id AND col.empresa_id=p.empresa_id
         WHERE p.empresa_id=$1
           AND p.estado::text NOT IN ('cancelado','facturado')
           AND p.factura_id IS NULL
           AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
         ORDER BY COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) ASC, p.numero ASC
         LIMIT 16
      `, [empresaId])),
      safeRows(db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga, p.estado::text AS estado,
               c.nombre AS cliente_nombre
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
         WHERE p.empresa_id=$1
           AND p.estado::text='incidencia'
           AND p.factura_id IS NULL
         ORDER BY COALESCE(p.updated_at,p.created_at) DESC NULLS LAST, p.fecha_carga DESC NULLS LAST
      `, [empresaId])),
      safeRows(db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga, p.estado::text AS estado,
               c.nombre AS cliente_nombre
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
         WHERE p.empresa_id=$1
           AND p.estado::text NOT IN ('cancelado','entregado','facturado')
           AND p.factura_id IS NULL
           AND COALESCE(p.fecha_descarga::date,p.fecha_entrega::date,p.fecha_carga::date) < CURRENT_DATE
         ORDER BY COALESCE(p.fecha_descarga,p.fecha_entrega,p.fecha_carga) ASC NULLS LAST
         LIMIT 20
      `, [empresaId])),
      safeRows(db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.estado::text AS estado,
               c.nombre AS cliente_nombre
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
         WHERE p.empresa_id=$1
           AND p.estado::text NOT IN ('cancelado','entregado','facturado')
           AND p.factura_id IS NULL
           AND p.fecha_carga BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
           AND p.colaborador_id IS NULL
           AND (p.vehiculo_id IS NULL OR p.chofer_id IS NULL)
         ORDER BY p.fecha_carga ASC NULLS LAST
         LIMIT 20
      `, [empresaId])),
      safeRows(db.query(`
        WITH econ AS (
          SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.estado::text AS estado,
                 c.nombre AS cliente_nombre,
                 COALESCE(NULLIF(p.importe,0), NULLIF(p.precio_cliente_col,0), NULLIF(p.precio_unitario,0), 0)
                   + COALESCE(p.importe_paralizacion,0) AS ingreso,
                 CASE
                   WHEN p.colaborador_id IS NOT NULL THEN COALESCE(p.precio_colaborador,0)
                   ELSE COALESCE(p.coste_gasoil,0)+COALESCE(p.coste_peajes,0)+COALESCE(p.coste_dietas,0)+COALESCE(p.coste_otros,0)
                 END AS coste
            FROM pedidos p
            LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
           LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
           WHERE p.empresa_id=$1
             AND p.estado::text NOT IN ('cancelado','facturado')
             AND p.factura_id IS NULL
             AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) BETWEEN $2 AND $3
        )
        SELECT *, (ingreso-coste) AS margen,
               CASE WHEN ingreso>0 THEN ROUND(((ingreso-coste)/ingreso*100)::numeric, 2) ELSE NULL END AS margen_pct
          FROM econ
         WHERE ingreso <= 0 OR (ingreso > 0 AND ingreso-coste < ingreso*0.08)
         ORDER BY CASE WHEN ingreso>0 AND ingreso-coste < 0 THEN 0 WHEN ingreso<=0 THEN 1 ELSE 2 END,
                  margen ASC NULLS LAST
         LIMIT 20
      `, [empresaId, desde, hasta])),
      safeRows(db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga, p.estado::text AS estado,
               c.nombre AS cliente_nombre
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
         WHERE p.empresa_id=$1
           AND (
             p.estado::text='entregado'
           OR p.estado::text='facturado'
           )
           AND p.factura_id IS NULL
           AND NOT EXISTS (
             SELECT 1
               FROM pedido_docs d
              WHERE d.pedido_id=p.id
                AND d.empresa_id=p.empresa_id
                AND (
                  LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
                  OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
                  OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
                )
           )
         ORDER BY COALESCE(p.fecha_descarga,p.fecha_entrega,p.fecha_carga) DESC NULLS LAST
         LIMIT 20
      `, [empresaId])),
      safeRows(db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga, p.estado::text AS estado,
               p.factura_id, c.nombre AS cliente_nombre,
               f.numero AS factura_numero, f.estado::text AS factura_estado
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
         WHERE p.empresa_id=$1
           AND p.estado::text='facturado'
           AND (
             p.factura_id IS NULL
             OR f.id IS NULL
             OR f.estado::text='borrador'
           )
         ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
         LIMIT 20
      `, [empresaId])),
      safeRows(db.query(`
        SELECT f.id, f.numero, f.estado::text AS estado, f.total, f.fecha_vencimiento, c.nombre AS cliente_nombre
          FROM facturas f
          JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
         WHERE f.empresa_id=$1
           AND f.estado::text IN ('vencida','reclamada','sin_cobrar')
         ORDER BY CASE f.estado::text WHEN 'sin_cobrar' THEN 0 WHEN 'reclamada' THEN 1 ELSE 2 END,
                  f.fecha_vencimiento ASC NULLS LAST
         LIMIT 20
      `, [empresaId])),
      safeRows(db.query(`
        SELECT id, matricula, marca, modelo, gps_provider, gps_external_id, ubicacion_ts,
               CASE
                 WHEN ubicacion_ts IS NULL THEN NULL
                 ELSE ROUND(EXTRACT(EPOCH FROM (NOW() - ubicacion_ts)) / 3600.0, 1)
               END AS horas_sin_senal
          FROM vehiculos
         WHERE empresa_id=$1
           AND activo IS DISTINCT FROM false
           AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%remolque%'
           AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%semirremolque%'
           AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%dolly%'
           AND UPPER(COALESCE(matricula,'')) NOT LIKE 'R-%'
           AND UPPER(COALESCE(matricula,'')) NOT LIKE '%-R'
           AND NOT EXISTS (
             SELECT 1
               FROM vehiculos vt
              WHERE vt.empresa_id=vehiculos.empresa_id
                AND vt.remolque_id=vehiculos.id
                AND vt.activo IS DISTINCT FROM false
           )
           AND gps_provider IS NOT NULL
           AND gps_provider <> 'manual'
           AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL
           AND (ubicacion_ts IS NULL OR ubicacion_ts < NOW() - INTERVAL '6 hours')
         ORDER BY ubicacion_ts NULLS FIRST, matricula
         LIMIT 20
      `, [empresaId])),
      safeRows(db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.estado::text AS estado,
               c.nombre AS cliente_nombre,
               d.id AS deca_repo_id,
               d.pdf_hash_sha256 AS deca_hash,
               d.pdf_filename AS deca_filename,
               e.status AS efti_status,
               e.hash_sha256 AS efti_hash,
               latest.detail->'checklist' AS checklist,
               latest.detail->'checklist'->>'status' AS checklist_status,
               latest.created_at AS checklist_updated_at
          FROM pedidos p
          LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          LEFT JOIN LATERAL (
            SELECT id, pdf_hash_sha256, pdf_filename
              FROM documento_control_repositorio dcr
             WHERE dcr.pedido_id=p.id
               AND dcr.empresa_id=p.empresa_id
               AND dcr.activo IS DISTINCT FROM false
             ORDER BY dcr.updated_at DESC NULLS LAST, dcr.archivado_at DESC NULLS LAST, dcr.created_at DESC NULLS LAST
             LIMIT 1
          ) d ON true
          LEFT JOIN regulatory_payloads e ON e.pedido_id=p.id AND e.empresa_id=p.empresa_id AND e.payload_type='efti'
          LEFT JOIN LATERAL (
            SELECT detail, created_at
              FROM regulatory_audit_logs ral
             WHERE ral.pedido_id=p.id AND ral.empresa_id=p.empresa_id
             ORDER BY created_at DESC
             LIMIT 1
          ) latest ON true
         WHERE p.empresa_id=$1
           AND p.estado::text NOT IN ('cancelado','facturado')
           AND p.factura_id IS NULL
           AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) BETWEEN CURRENT_DATE - INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '10 days'
           AND (
             NULLIF(d.pdf_hash_sha256,'') IS NULL
             OR e.id IS NULL
             OR COALESCE(latest.detail->'checklist'->>'status','') = 'requires_review'
           )
         ORDER BY COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) ASC, p.numero ASC
         LIMIT 30
      `, [empresaId])),
    ]);

    const tractoraFilter = `
      AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%remolque%'
      AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%semirremolque%'
      AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%dolly%'
      AND UPPER(COALESCE(matricula,'')) NOT LIKE 'R-%'
      AND UPPER(COALESCE(matricula,'')) NOT LIKE '%-R'
      AND NOT EXISTS (
        SELECT 1
          FROM vehiculos vt
         WHERE vt.empresa_id=vehiculos.empresa_id
           AND vt.remolque_id=vehiculos.id
           AND vt.activo IS DISTINCT FROM false
      )
    `;

    const [flujo, viajesFlujo, recursos, eventosRecientes, esperas, vacacionesPendientes, gpsResumen] = await Promise.all([
      safeRows(db.query(`
        SELECT
          COALESCE(NULLIF(p.estado::text,''),'pendiente') AS estado,
          COUNT(*)::int AS total
        FROM pedidos p
        WHERE p.empresa_id=$1
          AND p.factura_id IS NULL
          AND p.estado::text NOT IN ('cancelado','facturado')
          AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date)
              BETWEEN CURRENT_DATE - INTERVAL '2 days' AND CURRENT_DATE + INTERVAL '10 days'
        GROUP BY COALESCE(NULLIF(p.estado::text,''),'pendiente')
      `, [empresaId])),
      safeRows(db.query(`
        SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga,
               p.origen_pais, p.origen_provincia, p.destino_pais, p.destino_provincia,
               p.puntos_carga, p.puntos_descarga, p.cmr_tipo,
               COALESCE(NULLIF(p.importe,0), NULLIF(p.precio_cliente_col,0), NULLIF(p.precio_unitario,0), 0)
                 + COALESCE(p.importe_paralizacion,0) AS ingreso,
               CASE
                 WHEN p.colaborador_id IS NOT NULL THEN COALESCE(p.precio_colaborador,0)
                 ELSE COALESCE(p.coste_gasoil,0)+COALESCE(p.coste_peajes,0)+COALESCE(p.coste_dietas,0)+COALESCE(p.coste_otros,0)
               END AS coste,
               p.estado::text AS estado,
               c.nombre AS cliente_nombre,
               v.matricula AS vehiculo_matricula,
               v.gps_lat, v.gps_lng, v.ubicacion_actual, v.ubicacion_ts,
               ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos,
               col.nombre AS colaborador_nombre
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
        LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
        LEFT JOIN colaboradores col ON col.id=p.colaborador_id AND col.empresa_id=p.empresa_id
        WHERE p.empresa_id=$1
          AND p.factura_id IS NULL
          AND p.estado::text NOT IN ('cancelado','facturado')
          AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date)
              BETWEEN CURRENT_DATE - INTERVAL '2 days' AND CURRENT_DATE + INTERVAL '10 days'
        ORDER BY COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) ASC, p.numero ASC
        LIMIT 160
      `, [empresaId])),
      safeRows(db.query(`
        SELECT
          COUNT(*) FILTER (WHERE ch.activo IS DISTINCT FROM false)::int AS choferes_activos,
          COUNT(*) FILTER (WHERE ch.activo IS DISTINCT FROM false AND COALESCE(ch.estado,'disponible')='disponible')::int AS disponibles,
          COUNT(*) FILTER (WHERE ch.activo IS DISTINCT FROM false AND COALESCE(ch.estado,'disponible')='en_ruta')::int AS en_ruta,
          COUNT(*) FILTER (WHERE ch.activo IS DISTINCT FROM false AND COALESCE(ch.estado,'disponible')='vacaciones')::int AS vacaciones,
          COUNT(*) FILTER (WHERE ch.activo IS DISTINCT FROM false AND COALESCE(ch.estado,'disponible') IN ('baja','ausencia'))::int AS ausencias,
          COUNT(*) FILTER (WHERE ch.activo IS DISTINCT FROM false AND ch.vehiculo_id IS NULL)::int AS sin_tractora
        FROM choferes ch
        WHERE ch.empresa_id=$1
      `, [empresaId])),
      safeRows(db.query(`
        SELECT e.id, e.pedido_id, e.tipo, e.actor_tipo, e.detalle, e.created_at,
               u.nombre AS actor_nombre, u.email AS actor_email, u.rol AS actor_rol,
               p.numero AS pedido_numero, p.estado::text AS pedido_estado,
               COALESCE(p.origen,'') AS origen, COALESCE(p.destino,'') AS destino
        FROM pedido_eventos e
        JOIN pedidos p ON p.id=e.pedido_id AND p.empresa_id=e.empresa_id
        LEFT JOIN usuarios u ON u.id=e.actor_id AND u.empresa_id=e.empresa_id
        WHERE e.empresa_id=$1
          AND p.estado::text NOT IN ('cancelado')
          AND e.created_at >= NOW() - INTERVAL '48 hours'
        ORDER BY e.created_at DESC
        LIMIT 18
      `, [empresaId])),
      safeRows(db.query(`
        SELECT s.pedido_id AS id, p.numero, p.origen, p.destino, p.estado::text AS estado,
               c.nombre AS cliente_nombre,
               ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos,
               s.data->>'aviso_espera_carga_at' AS aviso_espera_carga_at,
               s.data->>'aviso_espera_descarga_at' AS aviso_espera_descarga_at,
               s.data->>'carga_iniciada_at' AS carga_iniciada_at,
               s.data->>'posicionado_descarga_at' AS posicionado_descarga_at,
               CASE
                 WHEN COALESCE(s.data->>'aviso_espera_descarga','false')='true' THEN 'descarga'
                 ELSE 'carga'
               END AS tipo_espera
        FROM pedido_chofer_pasos s
        JOIN pedidos p ON p.id=s.pedido_id AND p.empresa_id=s.empresa_id
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN choferes ch ON ch.id=COALESCE(s.chofer_id,p.chofer_id) AND ch.empresa_id=p.empresa_id
        WHERE s.empresa_id=$1
          AND p.estado::text NOT IN ('cancelado','facturado')
          AND (
            COALESCE(s.data->>'aviso_espera_carga','false')='true'
            OR COALESCE(s.data->>'aviso_espera_descarga','false')='true'
          )
          AND s.updated_at >= NOW() - INTERVAL '48 hours'
        ORDER BY s.updated_at DESC
        LIMIT 12
      `, [empresaId])),
      safeRows(db.query(`
        SELECT s.*, ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos
        FROM chofer_vacaciones_solicitudes s
        JOIN choferes ch ON ch.id=s.chofer_id AND ch.empresa_id=s.empresa_id
        WHERE s.empresa_id=$1
          AND s.estado IN ('pendiente','aprobada_pendiente_firma')
        ORDER BY s.fecha_inicio ASC, s.created_at ASC
        LIMIT 16
      `, [empresaId])),
      safeRows(db.query(`
        SELECT
          COUNT(*) FILTER (WHERE activo IS DISTINCT FROM false ${tractoraFilter})::int AS vehiculos_activos,
          COUNT(*) FILTER (WHERE activo IS DISTINCT FROM false ${tractoraFilter} AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL)::int AS gps_enlazados,
          COUNT(*) FILTER (WHERE activo IS DISTINCT FROM false ${tractoraFilter} AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND ubicacion_ts >= NOW() - INTERVAL '6 hours')::int AS gps_ok,
          COUNT(*) FILTER (WHERE activo IS DISTINCT FROM false ${tractoraFilter} AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND (ubicacion_ts IS NULL OR ubicacion_ts < NOW() - INTERVAL '6 hours'))::int AS gps_sin_senal
        FROM vehiculos
        WHERE empresa_id=$1
      `, [empresaId])),
    ]);

    const items = [];
    const add = (item) => items.push(enrichControlTowerItem({ id: `${item.type}-${item.entity_id || item.title}-${items.length}`, ...item }));
    for (const p of proximos) add({
      type: "viaje_programado", area: "Trafico", severity: "info", view: "gestion_trafico", entity_id: p.id,
      title: `Viaje ${p.numero || ""} programado`,
      description: `${p.cliente_nombre || "Cliente"} - ${p.origen || "-"} > ${p.destino || "-"} - ${p.vehiculo_matricula || p.colaborador_nombre || "sin recurso visible"}`,
      action: "Abrir planificacion",
      score: 25,
    });
    const incidenciaItems = incidencias.map((p, index) => ({
      id: `incidencia_pedido-${p.id || "sin-id"}-${index}`,
      type: "incidencia_pedido", area: "Trafico", severity: "critica", view: "pedidos", entity_id: p.id,
      title: `Viaje ${p.numero || ""} con incidencia`,
      description: `${p.cliente_nombre || "Cliente"} - ${p.origen || "-"} > ${p.destino || "-"} - estado ${estadoPedidoLabel(p.estado)}`,
      action: "Revisar incidencia y decidir accion",
      score: 105,
    })).map(enrichControlTowerItem);
    incidenciaItems.forEach(add);
    for (const p of retrasos) add({
      type: "retraso", area: "Trafico", severity: "critica", view: "pedidos", entity_id: p.id,
      title: `Viaje ${p.numero || ""} retrasado`,
      description: `${p.cliente_nombre || "Cliente"} - ${p.origen || "-"} > ${p.destino || "-"} - estado ${estadoPedidoLabel(p.estado)}`,
      action: "Revisar estado y avisar al cliente",
      score: 100,
    });
    for (const p of sinAsignar) add({
      type: "sin_asignar", area: "Planificacion", severity: "alta", view: "pedidos", entity_id: p.id,
      title: `Viaje ${p.numero || ""} sin asignacion completa`,
      description: `${p.cliente_nombre || "Cliente"} - carga ${p.fecha_carga || "sin fecha"}`,
      action: "Asignar camion, chofer o colaborador",
      score: 85,
    });
    for (const p of esperas) {
      const tipo = p.tipo_espera === "descarga" ? "descarga" : "carga";
      const chofer = `${p.chofer_nombre || ""} ${p.chofer_apellidos || ""}`.trim();
      add({
        type: tipo === "descarga" ? "espera_descarga" : "espera_carga",
        area: "Tiempo real",
        severity: "alta",
        view: "gestion_trafico",
        entity_id: p.id,
        title: `Espera de ${tipo} en ${p.numero || "pedido"}`,
        description: `${p.cliente_nombre || "Cliente"} - ${p.origen || "-"} > ${p.destino || "-"}${chofer ? ` - ${chofer}` : ""}. Revisar paralizacion y aviso al cliente.`,
        action: "Gestionar espera",
        score: 86,
      });
    }
    for (const s of vacacionesPendientes) {
      const fechaInicio = s.fecha_inicio ? String(s.fecha_inicio).slice(0, 10) : "-";
      const chofer = `${s.chofer_nombre || ""} ${s.chofer_apellidos || ""}`.trim() || "Chofer";
      add({
        type: "vacaciones_pendientes",
        area: "Recursos",
        severity: s.estado === "pendiente" ? "media" : "baja",
        view: "choferes",
        entity_id: s.id,
        title: s.estado === "pendiente" ? `Vacaciones pendientes: ${chofer}` : `Vacaciones aprobadas sin firma: ${chofer}`,
        description: `${fechaInicio} a ${String(s.fecha_fin || "").slice(0, 10) || "-"} - ${Number(s.dias || 0)} dias. ${s.estado === "pendiente" ? "Resolver para cuadrar flota." : "Pendiente firma del chofer."}`,
        action: "Resolver vacaciones",
        score: s.estado === "pendiente" ? 62 : 42,
      });
    }
    for (const p of margen) {
      const margenValue = Number(p.margen || 0);
      const sinPrecio = Number(p.ingreso || 0) <= 0;
      add({
        type: sinPrecio ? "sin_precio" : "margen_bajo",
        area: "Rentabilidad",
        severity: sinPrecio || margenValue < 0 ? "alta" : "media",
        view: "pedidos",
        entity_id: p.id,
        title: sinPrecio ? `Pedido ${p.numero || ""} sin precio` : `Margen bajo en ${p.numero || ""}`,
        description: sinPrecio
          ? `${p.cliente_nombre || "Cliente"} - falta precio para decidir.`
          : `Ingreso ${round2(p.ingreso)} EUR - coste ${round2(p.coste)} EUR - margen ${round2(margenValue)} EUR`,
        action: sinPrecio ? "Completar precio" : "Revisar precio, coste o retorno",
        score: margenValue < 0 ? 95 : sinPrecio ? 90 : 65,
      });
    }
    for (const p of docs) add({
      type: "pod_pendiente", area: "Documentacion", severity: "alta", view: "pedidos", entity_id: p.id,
      title: `Pedido ${p.numero || ""} sin POD/albaran`,
      description: `${p.cliente_nombre || "Cliente"} - bloquea facturacion o defensa de cobro.`,
      action: "Pedir o adjuntar soporte",
      score: 82,
    });
    for (const p of facturacionInconsistente) add({
      type: "facturacion_inconsistente", area: "Facturacion", severity: "critica", view: "pedidos", entity_id: p.id,
      title: `Pedido ${p.numero || ""} marcado como facturado sin factura valida`,
      description: `${p.cliente_nombre || "Cliente"} - ${p.factura_id ? `factura vinculada ${p.factura_numero || p.factura_id} no finalizada o no visible` : "sin factura vinculada"}.`,
      action: "Revisar enlace de factura o devolver a entregado",
      score: 99,
    });
    for (const f of cobros) add({
      type: "cobro_riesgo", area: "Cobros", severity: f.estado === "sin_cobrar" ? "critica" : "alta", view: "facturacion", entity_id: f.id,
      title: `Factura ${f.numero || ""} en riesgo`,
      description: `${f.cliente_nombre || "Cliente"} - ${round2(f.total)} EUR - vcto. ${f.fecha_vencimiento || "-"}`,
      action: "Gestionar reclamacion",
      score: f.estado === "sin_cobrar" ? 98 : 88,
    });
    for (const v of gps) add({
      type: "gps_sin_senal", area: "GPS", severity: !v.ubicacion_ts || Number(v.horas_sin_senal || 0) >= 24 ? "alta" : "media", view: "vehiculos", entity_id: v.id,
      title: `GPS sin senal: ${v.matricula || ""}`,
      description: `${v.gps_provider || "GPS"} / ${v.gps_external_id || "-"} - ${v.horas_sin_senal == null ? "sin posiciones" : `${v.horas_sin_senal} h sin senal`}`,
      action: "Revisar enlace GPS",
      score: !v.ubicacion_ts || Number(v.horas_sin_senal || 0) >= 24 ? 78 : 58,
    });
    for (const p of regulatoryDocs) {
      const route = `${p.origen || "-"} > ${p.destino || "-"}`;
      if (!p.deca_hash) add({
        type: "deca_pendiente",
        area: "Cumplimiento",
        severity: "media",
        view: "pedidos",
        entity_id: p.id,
        title: `DeCA pendiente en ${p.numero || "pedido"}`,
        description: `${p.cliente_nombre || "Cliente"} - ${route}. Generar PDF nativo, QR/URL y repositorio antes del servicio.`,
        action: "Generar DeCA",
        score: 72,
      });
      if (!p.efti_hash) add({
        type: "efti_pendiente",
        area: "Cumplimiento",
        severity: "media",
        view: "pedidos",
        entity_id: p.id,
        title: `Payload eFTI pendiente en ${p.numero || "pedido"}`,
        description: `${p.cliente_nombre || "Cliente"} - falta dataset interno para interoperar con plataforma certificada cuando aplique.`,
        action: "Preparar eFTI",
        score: 64,
      });
      if (p.checklist_status === "requires_review") {
        const blocking = Array.isArray(p.checklist?.blocking) ? p.checklist.blocking.join(", ") : "checklist";
        add({
          type: "regulatory_blocking",
          area: "Cumplimiento",
          severity: "alta",
          view: "pedidos",
          entity_id: p.id,
          title: `Checklist regulatorio bloqueado en ${p.numero || "pedido"}`,
          description: `${p.cliente_nombre || "Cliente"} - pendiente resolver: ${blocking}.`,
          action: "Resolver checklist",
          score: 90,
        });
      }
    }

    const order = { critica: 0, alta: 1, media: 2, baja: 3, info: 4 };
    items.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || Number(b.score || 0) - Number(a.score || 0));
    const resumen = items.reduce((acc, item) => {
      acc.total += 1;
      acc[item.severity] = (acc[item.severity] || 0) + 1;
      acc.areas[item.area] = (acc.areas[item.area] || 0) + 1;
      return acc;
    }, { total: 0, critica: 0, alta: 0, media: 0, baja: 0, info: 0, areas: {} });
    const vistas = items.reduce((acc, item) => {
      for (const bucket of item.buckets || []) {
        acc[bucket] = (acc[bucket] || 0) + 1;
      }
      return acc;
    }, { todas: items.length, hoy: 0, riesgos: 0, rentabilidad: 0, recursos: 0, documentos: 0, incidencias: incidenciaItems.length });

    const k = kpiRows[0] || {};
    const flujoMap = new Map((flujo || []).map(r => [String(r.estado || "pendiente"), Number(r.total || 0)]));
    const flujoOperativo = [
      ["pendiente", "Pendientes"],
      ["confirmado", "Confirmados"],
      ["en_curso", "En ruta"],
      ["descarga", "Descarga"],
      ["entregado", "Entregados"],
      ["incidencia", "Incidencias"],
    ].map(([key, label]) => ({ key, label, total: Number(flujoMap.get(key) || 0) }));
    const viajesPorEstado = (viajesFlujo || []).reduce((acc, p) => {
      const key = String(p.estado || "pendiente").toLowerCase() || "pendiente";
      if (!acc[key]) acc[key] = [];
      const ingreso = round2(p.ingreso);
      const coste = round2(p.coste);
      const margen = round2(ingreso - coste);
      acc[key].push({
        id: p.id,
        numero: p.numero,
        origen: p.origen,
        destino: p.destino,
        origen_pais: p.origen_pais,
        origen_provincia: p.origen_provincia,
        destino_pais: p.destino_pais,
        destino_provincia: p.destino_provincia,
        puntos_carga: p.puntos_carga,
        puntos_descarga: p.puntos_descarga,
        cmr_tipo: p.cmr_tipo,
        fecha_carga: p.fecha_carga,
        fecha_descarga: p.fecha_descarga,
        estado: key,
        cliente_nombre: p.cliente_nombre,
        vehiculo_matricula: p.vehiculo_matricula,
        gps_lat: p.gps_lat,
        gps_lng: p.gps_lng,
        ubicacion_actual: p.ubicacion_actual,
        ubicacion_ts: p.ubicacion_ts,
        chofer_nombre: [p.chofer_nombre, p.chofer_apellidos].filter(Boolean).join(" ").trim(),
        colaborador_nombre: p.colaborador_nombre,
        ingreso,
        coste,
        margen,
        margen_pct: ingreso > 0 ? round2((margen / ingreso) * 100) : null,
      });
      return acc;
    }, {});
    const recursosRow = recursos[0] || {};
    const gpsRow = gpsResumen[0] || {};
    const recursosResumen = {
      choferes_activos: Number(recursosRow.choferes_activos || 0),
      disponibles: Number(recursosRow.disponibles || 0),
      en_ruta: Number(recursosRow.en_ruta || 0),
      vacaciones: Number(recursosRow.vacaciones || 0),
      ausencias: Number(recursosRow.ausencias || 0),
      sin_tractora: Number(recursosRow.sin_tractora || 0),
      solicitudes_vacaciones: vacacionesPendientes.length,
    };
    const visibilidadResumen = {
      vehiculos_activos: Number(gpsRow.vehiculos_activos || 0),
      gps_enlazados: Number(gpsRow.gps_enlazados || 0),
      gps_ok: Number(gpsRow.gps_ok || 0),
      gps_sin_senal: Number(gpsRow.gps_sin_senal || 0),
      esperas_activas: esperas.length,
    };
    const decisiones = items.slice(0, 8).map(item => ({
      id: item.id,
      severity: item.severity,
      area: item.area,
      title: item.title,
      impact: item.description,
      recommended_action: item.next_actions?.[0]?.label || item.action || "Abrir",
      view: item.next_actions?.[0]?.view || item.view || "gestion_trafico",
      entity_id: item.entity_id || null,
      type: item.type || "",
      action: item.action || "",
      action_key: item.next_actions?.[0]?.key || "",
      description: item.description || "",
      next_actions: item.next_actions || [],
    }));
    const eventos = (eventosRecientes || []).map(ev => ({
      id: ev.id,
      pedido_id: ev.pedido_id,
      pedido_numero: ev.pedido_numero,
      tipo: ev.tipo,
      actor_tipo: ev.actor_tipo,
      actor_nombre: ev.actor_nombre || null,
      actor_email: ev.actor_email || null,
      actor_rol: ev.actor_rol || null,
      detalle: ev.detalle || {},
      created_at: ev.created_at,
      ruta: `${ev.origen || "-"} > ${ev.destino || "-"}`,
      estado: ev.pedido_estado,
    }));
    res.json({
      period,
      generated_at: new Date().toISOString(),
      kpis: {
        activos: Number(k.activos || 0),
        cargas_hoy: Number(k.cargas_hoy || 0),
        descargas_hoy: Number(k.descargas_hoy || 0),
        cargas_periodo: Number(k.cargas_periodo || 0),
        descargas_periodo: Number(k.descargas_periodo || 0),
        incidencias: Number(k.incidencias || 0),
        retrasados: Number(k.retrasados || 0),
      },
      resumen,
      vistas,
      flujo_operativo: flujoOperativo,
      viajes_por_estado: viajesPorEstado,
      recursos: recursosResumen,
      visibilidad: visibilidadResumen,
      decisiones,
      eventos_recientes: eventos,
      incidencias: incidenciaItems,
      items,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo cargar Control Tower" });
  }
});

router.get("/copiloto-operativo", authenticate, GERENTE_O_TRAFICO, cacheMiddleware(20), async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
    const period = String(req.query.period || "7d");
    const { desde, hasta } = rangoPeriodo(period);
    const safeOne = (promise, fallback = {}) => promise.then(r => r.rows?.[0] || fallback).catch(() => fallback);

    const [ops, fact, gps, docs, margen] = await Promise.all([
      safeOne(db.query(`
        SELECT
          COUNT(*) FILTER (WHERE p.estado::text NOT IN ('cancelado','entregado','facturado') AND p.factura_id IS NULL)::int AS activos,
          COUNT(*) FILTER (WHERE p.estado::text='incidencia' AND p.factura_id IS NULL)::int AS incidencias,
          COUNT(*) FILTER (
            WHERE p.estado::text NOT IN ('cancelado','entregado','facturado')
              AND p.factura_id IS NULL
              AND COALESCE(p.fecha_descarga::date,p.fecha_entrega::date,p.fecha_carga::date) < CURRENT_DATE
          )::int AS retrasados,
          COUNT(*) FILTER (
            WHERE p.estado::text NOT IN ('cancelado','entregado','facturado')
              AND p.factura_id IS NULL
              AND p.fecha_carga BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
              AND p.colaborador_id IS NULL
              AND (p.vehiculo_id IS NULL OR p.chofer_id IS NULL)
          )::int AS sin_asignar,
          COUNT(*) FILTER (WHERE p.fecha_carga::date=CURRENT_DATE AND p.factura_id IS NULL)::int AS cargas_hoy,
          COUNT(*) FILTER (WHERE COALESCE(p.fecha_descarga::date,p.fecha_entrega::date)=CURRENT_DATE AND p.factura_id IS NULL)::int AS descargas_hoy
        FROM pedidos p
        WHERE p.empresa_id=$1
      `, [empresaId])),
      safeOne(db.query(`
        SELECT
          COUNT(*) FILTER (WHERE f.estado::text IN ('vencida','reclamada','sin_cobrar'))::int AS cobros_riesgo,
          COALESCE(SUM(f.total) FILTER (WHERE f.estado::text IN ('vencida','reclamada','sin_cobrar')),0) AS importe_cobros_riesgo,
          COUNT(*) FILTER (WHERE f.estado::text='borrador')::int AS borradores
        FROM facturas f
        WHERE f.empresa_id=$1
          AND f.estado::text <> 'rectificada'
          AND f.fecha BETWEEN $2 AND $3
      `, [empresaId, desde, hasta])),
      safeOne(db.query(`
        SELECT COUNT(*)::int AS gps_sin_senal
          FROM vehiculos
         WHERE empresa_id=$1
           AND activo IS DISTINCT FROM false
           AND gps_provider IS NOT NULL
           AND gps_provider <> 'manual'
           AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL
           AND (ubicacion_ts IS NULL OR ubicacion_ts < NOW() - INTERVAL '6 hours')
      `, [empresaId])),
      safeOne(db.query(`
        SELECT COUNT(*)::int AS soporte_pendiente
          FROM pedidos p
         WHERE p.empresa_id=$1
           AND p.estado::text IN ('entregado','facturado')
           AND p.factura_id IS NULL
           AND NOT EXISTS (
             SELECT 1
               FROM pedido_docs d
              WHERE d.pedido_id=p.id
                AND d.empresa_id=p.empresa_id
                AND (
                  LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
                  OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
                  OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
                )
           )
      `, [empresaId])),
      safeOne(db.query(`
        WITH econ AS (
          SELECT
            COALESCE(NULLIF(p.importe,0), NULLIF(p.precio_cliente_col,0), NULLIF(p.precio_unitario,0), 0)
              + COALESCE(p.importe_paralizacion,0) AS ingreso,
            CASE
              WHEN p.colaborador_id IS NOT NULL THEN COALESCE(p.precio_colaborador,0)
              ELSE COALESCE(p.coste_gasoil,0)+COALESCE(p.coste_peajes,0)+COALESCE(p.coste_dietas,0)+COALESCE(p.coste_otros,0)
            END AS coste
          FROM pedidos p
          WHERE p.empresa_id=$1
            AND p.estado::text NOT IN ('cancelado','facturado')
            AND p.factura_id IS NULL
            AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date) BETWEEN $2 AND $3
        )
        SELECT
          COUNT(*) FILTER (WHERE ingreso <= 0)::int AS sin_precio,
          COUNT(*) FILTER (WHERE ingreso > 0 AND ingreso-coste < ingreso*0.08)::int AS margen_bajo,
          COALESCE(SUM(ingreso),0) AS ingreso,
          COALESCE(SUM(coste),0) AS coste
        FROM econ
      `, [empresaId, desde, hasta])),
    ]);

    const copilotoPlaybook = (key) => ({
      retrasos: {
        playbook: ["Confirmar posicion/ETA real", "Avisar al cliente si cambia la ventana", "Reasignar recurso si hay penalizacion o bloqueo"],
        quick_actions: [
          { key:"abrir_control_tower", label:"Abrir Control Tower", view:"dashboard", primary:true },
          { key:"revisar_trafico", label:"Revisar trafico", view:"gestion_trafico" },
        ],
      },
      incidencias: {
        playbook: ["Ordenar por severidad y cliente", "Asignar responsable", "Dejar decision trazada antes de cerrar"],
        quick_actions: [
          { key:"abrir_excepciones", label:"Abrir excepciones", view:"excepciones", primary:true },
          { key:"abrir_trafico", label:"Ver trafico", view:"gestion_trafico" },
        ],
      },
      cobros: {
        playbook: ["Comprobar soporte documental", "Preparar reclamacion", "Bloquear nuevo volumen si hay deuda critica"],
        quick_actions: [
          { key:"abrir_cobros", label:"Abrir cobros", view:"facturacion", primary:true },
          { key:"revisar_scoring", label:"Ver scoring", view:"informes" },
        ],
      },
      documentos: {
        playbook: ["Pedir albaran/POD/CMR", "Vincular soporte al viaje", "No enviar agrupacion hasta completar todos los albaranes"],
        quick_actions: [
          { key:"bloqueos_documentales", label:"Bloqueos documentales", view:"facturacion", primary:true },
          { key:"abrir_trafico", label:"Ver viajes", view:"gestion_trafico" },
        ],
      },
      asignacion: {
        playbook: ["Asignar camion/chofer", "Buscar colaborador si no hay recurso propio", "Confirmar carga y datos maestros antes de aceptar mas volumen"],
        quick_actions: [
          { key:"abrir_planificacion", label:"Planificar", view:"gestion_trafico", primary:true },
          { key:"rutas_recomendadas", label:"Optimizar rutas", view:"rutas_recomendadas" },
        ],
      },
      margen: {
        playbook: ["Completar precio", "Revisar costes", "Simular retorno o renegociar minimo"],
        quick_actions: [
          { key:"abrir_rentabilidad", label:"Ver rentabilidad", view:"informes", primary:true },
          { key:"abrir_pedidos", label:"Revisar pedidos", view:"pedidos" },
        ],
      },
      gps: {
        playbook: ["Validar proveedor e ID GPS", "Comprobar ultima posicion", "Contactar conductor si afecta entregas de hoy"],
        quick_actions: [
          { key:"abrir_gps", label:"Revisar GPS", view:"vehiculos", primary:true },
          { key:"abrir_trafico", label:"Ver trafico", view:"gestion_trafico" },
        ],
      },
    }[key] || { playbook: [], quick_actions: [] });
    const priorities = [];
    const add = (item) => priorities.push({ ...item, ...copilotoPlaybook(item.key) });
    const retrasados = Number(ops.retrasados || 0);
    const incidencias = Number(ops.incidencias || 0);
    const cobrosRiesgo = Number(fact.cobros_riesgo || 0);
    const soportePendiente = Number(docs.soporte_pendiente || 0);
    const sinAsignar = Number(ops.sin_asignar || 0);
    const gpsSinSenal = Number(gps.gps_sin_senal || 0);
    const sinPrecio = Number(margen.sin_precio || 0);
    const margenBajo = Number(margen.margen_bajo || 0);
    const ingreso = Number(margen.ingreso || 0);
    const coste = Number(margen.coste || 0);
    const margenPct = ingreso > 0 ? round2(((ingreso - coste) / ingreso) * 100) : null;

    if (retrasados > 0) add({ key:"retrasos", area:"Trafico", severity:"critica", title:`${retrasados} viaje(s) retrasado(s)`, answer:"Hay entregas fuera de fecha operativa.", recommended_action:"Abrir Control Tower, confirmar ETA y avisar al cliente antes de que escale.", target_view:"dashboard", requires_confirmation:false });
    if (incidencias > 0) add({ key:"incidencias", area:"Trafico", severity:"critica", title:`${incidencias} incidencia(s) abierta(s)`, answer:"Hay incidencias activas que requieren decision humana.", recommended_action:"Priorizar por cliente, penalizacion y documentacion asociada.", target_view:"excepciones", requires_confirmation:false });
    if (cobrosRiesgo > 0) add({ key:"cobros", area:"Cobros", severity:"alta", title:`${cobrosRiesgo} factura(s) en riesgo`, answer:`Importe en riesgo: ${round2(fact.importe_cobros_riesgo)} EUR.`, recommended_action:"Reclamar, revisar soporte documental y bloquear nuevo volumen si procede.", target_view:"facturacion", requires_confirmation:true });
    if (soportePendiente > 0) add({ key:"documentos", area:"Documentacion", severity:"alta", title:`${soportePendiente} entrega(s) sin POD/albaran`, answer:"Puede bloquear facturacion, cobro o defensa ante incidencia.", recommended_action:"Solicitar soporte al conductor/colaborador y no agrupar facturas hasta completar albaranes.", target_view:"facturacion", requires_confirmation:false });
    if (sinAsignar > 0) add({ key:"asignacion", area:"Planificacion", severity:"alta", title:`${sinAsignar} viaje(s) proximos sin asignacion completa`, answer:"Falta camion, chofer o colaborador para cargas de los proximos 7 dias.", recommended_action:"Asignar recurso o buscar colaborador antes de aceptar mas carga compatible.", target_view:"gestion_trafico", requires_confirmation:false });
    if (sinPrecio > 0 || margenBajo > 0) add({ key:"margen", area:"Rentabilidad", severity:sinPrecio > 0 ? "alta" : "media", title:`${sinPrecio + margenBajo} viaje(s) con riesgo economico`, answer:`Margen periodo: ${margenPct == null ? "-" : `${margenPct}%`}.`, recommended_action:"Completar precios, revisar costes y simular retorno antes de confirmar.", target_view:"informes", requires_confirmation:false });
    if (gpsSinSenal > 0) add({ key:"gps", area:"GPS", severity:"media", title:`${gpsSinSenal} vehiculo(s) sin senal GPS`, answer:"La visibilidad real puede estar incompleta.", recommended_action:"Revisar proveedor/ID GPS y contactar conductor si afecta entregas de hoy.", target_view:"vehiculos", requires_confirmation:false });

    const order = { critica: 0, alta: 1, media: 2, baja: 3, info: 4 };
    priorities.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
    const criticas = priorities.filter(p => p.severity === "critica").length;
    const altas = priorities.filter(p => p.severity === "alta").length;
    const salud = criticas > 0 ? "critica" : altas > 0 ? "alerta" : priorities.length > 0 ? "vigilancia" : "ok";
    const headline = salud === "critica"
      ? "Atender trafico/incidencias antes de aceptar mas carga."
      : salud === "alerta"
        ? "Revisar cobros, documentos o asignaciones antes de aumentar volumen."
        : salud === "vigilancia"
          ? "Operacion estable con puntos de vigilancia."
          : "Operacion sin prioridades criticas detectadas.";

    res.json({
      period,
      desde,
      hasta,
      generated_at: new Date().toISOString(),
      resumen: {
        salud,
        headline,
        total_prioridades: priorities.length,
        criticas,
        altas,
        cargas_hoy: Number(ops.cargas_hoy || 0),
        descargas_hoy: Number(ops.descargas_hoy || 0),
        activos: Number(ops.activos || 0),
        margen_pct: margenPct,
      },
      prioridades: priorities.slice(0, 8),
      preguntas_sugeridas: [
        "Que cargas de hoy estan en riesgo?",
        "Que viajes bloquean facturacion por falta de albaran?",
        "Que clientes o colaboradores requieren condiciones antes de aceptar mas viajes?",
        "Donde estoy perdiendo margen esta semana?",
      ],
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo generar el briefing operativo" });
  }
});

router.get("/excepciones", async (req, res) => {
  await ensureExcepcionesSchema();
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });

  const safe = (promise, fallback = []) => promise.then(r => r.rows || r || fallback).catch(() => fallback);
  const [
    pedidosSinPrecio,
    pedidosSinAsignar,
    pedidosSinAlbaran,
    pedidosMargen,
    colaboradoresPendientes,
    facturasRiesgo,
    vehiculosGps,
    vehiculosGpsSinSenal,
    docsVehiculos,
    docsChoferes,
    tallerRows,
  ] = await Promise.all([
    safe(db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, c.nombre AS cliente_nombre
      FROM pedidos p
      LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
      WHERE p.empresa_id=$1
        AND p.estado NOT IN ('cancelado','entregado')
        AND COALESCE(p.importe, p.precio_cliente_col, p.precio_unitario, 0) <= 0
      ORDER BY p.fecha_carga ASC NULLS LAST, p.created_at DESC
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, c.nombre AS cliente_nombre
      FROM pedidos p
      LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
      WHERE p.empresa_id=$1
        AND p.estado NOT IN ('cancelado','entregado')
        AND p.fecha_carga BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
        AND p.colaborador_id IS NULL
        AND (p.vehiculo_id IS NULL OR p.chofer_id IS NULL)
      ORDER BY p.fecha_carga ASC NULLS LAST
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, c.nombre AS cliente_nombre
      FROM pedidos p
      LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
      WHERE p.empresa_id=$1
        AND p.estado='entregado'
        AND NOT EXISTS (
          SELECT 1 FROM pedido_docs d
          WHERE d.pedido_id=p.id
            AND d.empresa_id=p.empresa_id
            AND (
              LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
              OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
              OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
              OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
            )
        )
      ORDER BY p.fecha_entrega DESC NULLS LAST, p.fecha_carga DESC NULLS LAST
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga,
             COALESCE(p.importe, p.precio_cliente_col, 0) AS ingreso,
             COALESCE(p.precio_colaborador,0) +
             COALESCE(p.coste_gasoil,0) + COALESCE(p.coste_peajes,0) +
             COALESCE(p.coste_dietas,0) + COALESCE(p.coste_otros,0) AS coste,
             c.nombre AS cliente_nombre
      FROM pedidos p
      LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
      WHERE p.empresa_id=$1
        AND p.estado NOT IN ('cancelado')
        AND COALESCE(p.importe, p.precio_cliente_col, 0) > 0
        AND (
          COALESCE(p.importe, p.precio_cliente_col, 0)
          - COALESCE(p.precio_colaborador,0)
          - COALESCE(p.coste_gasoil,0) - COALESCE(p.coste_peajes,0)
          - COALESCE(p.coste_dietas,0) - COALESCE(p.coste_otros,0)
        ) < COALESCE(p.importe, p.precio_cliente_col, 0) * 0.08
      ORDER BY p.fecha_carga DESC NULLS LAST
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.estado,
             p.colaborador_precio_confirmado, p.colaborador_carga_confirmada_at,
             p.colaborador_descarga_confirmada_at, co.nombre AS colaborador_nombre
      FROM pedidos p
      JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
      WHERE p.empresa_id=$1
        AND p.estado NOT IN ('cancelado','entregado')
        AND (
          p.colaborador_precio_confirmado IS DISTINCT FROM true
          OR p.colaborador_carga_confirmada_at IS NULL
        )
      ORDER BY p.fecha_carga ASC NULLS LAST
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT f.id, f.numero, f.total, f.fecha_vencimiento, f.estado, c.nombre AS cliente_nombre
      FROM facturas f
      JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
      WHERE f.empresa_id=$1
        AND f.estado IN ('vencida','reclamada','sin_cobrar')
      ORDER BY CASE f.estado WHEN 'sin_cobrar' THEN 0 WHEN 'reclamada' THEN 1 ELSE 2 END,
               f.fecha_vencimiento ASC NULLS LAST
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT id, matricula, marca, modelo, estado, ubicacion_actual
      FROM vehiculos
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND COALESCE(gps_external_id,'')=''
      ORDER BY matricula
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT id, matricula, marca, modelo, gps_provider, gps_external_id, ubicacion_actual, ubicacion_ts,
             CASE
               WHEN ubicacion_ts IS NULL THEN NULL
               ELSE ROUND(EXTRACT(EPOCH FROM (NOW() - ubicacion_ts)) / 3600.0, 1)
             END AS horas_sin_senal
      FROM vehiculos
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND gps_provider IS NOT NULL
        AND gps_provider <> 'manual'
        AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL
        AND (ubicacion_ts IS NULL OR ubicacion_ts < NOW() - INTERVAL '6 hours')
      ORDER BY ubicacion_ts NULLS FIRST, matricula
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT d.id, d.vehiculo_id, d.tipo, d.fecha_vencimiento, v.matricula
      FROM docs_vehiculos d
      JOIN vehiculos v ON v.id=d.vehiculo_id AND v.empresa_id=d.empresa_id
      WHERE d.empresa_id=$1
        AND d.fecha_vencimiento IS NOT NULL
        AND d.fecha_vencimiento <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY d.fecha_vencimiento ASC
      LIMIT 25
    `, [empresaId])),
    safe(db.query(`
      SELECT d.id, d.chofer_id, d.tipo, d.fecha_vencimiento, ch.nombre, ch.apellidos
      FROM docs_choferes d
      JOIN choferes ch ON ch.id=d.chofer_id AND ch.empresa_id=d.empresa_id
      WHERE d.empresa_id=$1
        AND d.fecha_vencimiento IS NOT NULL
        AND d.fecha_vencimiento <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY d.fecha_vencimiento ASC
      LIMIT 25
    `, [empresaId])),
    safe(db.query("SELECT data FROM taller_estado WHERE empresa_id=$1", [empresaId]), []),
  ]);

  const tallerData = tallerRows[0]?.data || {};
  const stockBajo = asArray(tallerData.stock)
    .filter(s => Number(s.stock_actual || 0) <= Number(s.stock_minimo || 0))
    .slice(0, 25);
  const solicitudesTaller = asArray(tallerData.solicitudes_mecanico)
    .filter(s => s.estado === "pendiente")
    .slice(0, 25);

  const exceptions = [];
  const add = (items, config) => {
    for (const item of items) {
      exceptions.push({
        id: `${config.type}-${item.id || item.numero || item.matricula || exceptions.length}`,
        type: config.type,
        severity: typeof config.severity === "function" ? config.severity(item) : config.severity,
        area: config.area,
        title: typeof config.title === "function" ? config.title(item) : config.title,
        description: typeof config.description === "function" ? config.description(item) : config.description,
        action: config.action,
        view: config.view,
        entity_id: item.id || null,
        data: item,
      });
    }
  };

  add(pedidosSinPrecio, {
    type: "pedido_sin_precio", severity: "alta", area: "Pedidos", action: "Completar precio", view: "pedidos",
    title: p => `Pedido ${p.numero || ""} sin precio`,
    description: p => `${p.cliente_nombre || "Cliente"} · ${p.origen || "-"} / ${p.destino || "-"} · ${p.fecha_carga || "sin fecha"}`,
  });
  add(pedidosSinAsignar, {
    type: "pedido_sin_asignar", severity: "alta", area: "Trafico", action: "Asignar camion, chofer o colaborador", view: "pedidos",
    title: p => `Viaje ${p.numero || ""} sin asignacion completa`,
    description: p => `${p.origen || "-"} / ${p.destino || "-"} · carga ${p.fecha_carga || "sin fecha"}`,
  });
  add(pedidosSinAlbaran, {
    type: "pedido_sin_albaran", severity: "alta", area: "Facturacion", action: "Adjuntar albaran/CMR", view: "pedidos",
    title: p => `Pedido ${p.numero || ""} entregado sin albaran`,
    description: p => `${p.cliente_nombre || "Cliente"} · revisar documentacion antes de emitir factura`,
  });
  add(pedidosMargen, {
    type: "margen_bajo", severity: p => Number(p.ingreso || 0) - Number(p.coste || 0) < 0 ? "critica" : "media", area: "Margen", action: "Revisar costes y precio", view: "pedidos",
    title: p => `Margen bajo en ${p.numero || "pedido"}`,
    description: p => `Ingreso ${Number(p.ingreso || 0).toLocaleString("es-ES")} EUR · coste ${Number(p.coste || 0).toLocaleString("es-ES")} EUR`,
  });
  add(colaboradoresPendientes, {
    type: "colaborador_pendiente", severity: "media", area: "Colaboradores", action: "Reenviar enlace o confirmar estado", view: "pedidos",
    title: p => `${p.colaborador_nombre || "Colaborador"} pendiente de confirmar`,
    description: p => `Pedido ${p.numero || ""} · ${p.origen || "-"} / ${p.destino || "-"}`,
  });
  add(facturasRiesgo, {
    type: "cobro_riesgo", severity: f => f.estado === "sin_cobrar" ? "critica" : "alta", area: "Cobros", action: "Gestionar reclamacion", view: "facturacion",
    title: f => `Factura ${f.numero} ${f.estado}`,
    description: f => `${f.cliente_nombre} · ${Number(f.total || 0).toLocaleString("es-ES")} EUR · vcto. ${f.fecha_vencimiento || "-"}`,
  });
  add(vehiculosGps, {
    type: "gps_sin_enlace", severity: "media", area: "GPS", action: "Vincular matricula con GPS", view: "vehiculos",
    title: v => `Vehiculo ${v.matricula} sin GPS enlazado`,
    description: v => `${v.marca || ""} ${v.modelo || ""}`.trim() || "Sin proveedor GPS asociado",
  });
  add(vehiculosGpsSinSenal, {
    type: "gps_sin_senal",
    severity: v => !v.ubicacion_ts || Number(v.horas_sin_senal || 0) >= 24 ? "alta" : "media",
    area: "GPS",
    action: "Revisar senal GPS",
    view: "vehiculos",
    title: v => `Vehiculo ${v.matricula} sin senal GPS reciente`,
    description: v => {
      const horas = v.horas_sin_senal === null || v.horas_sin_senal === undefined ? "sin posiciones recibidas" : `${v.horas_sin_senal} h sin senal`;
      return `${v.gps_provider || "GPS"} / ${v.gps_external_id || "-"} - ${horas}`;
    },
  });
  add(docsVehiculos, {
    type: "doc_vehiculo", severity: d => new Date(d.fecha_vencimiento) < new Date() ? "critica" : "alta", area: "Documentacion", action: "Actualizar documento", view: "vehiculos",
    title: d => `${d.tipo || "Documento"} de ${d.matricula}`,
    description: d => `Vence el ${d.fecha_vencimiento}`,
  });
  add(docsChoferes, {
    type: "doc_chofer", severity: d => new Date(d.fecha_vencimiento) < new Date() ? "critica" : "alta", area: "Documentacion", action: "Actualizar documento", view: "choferes",
    title: d => `${d.tipo || "Documento"} de ${[d.nombre,d.apellidos].filter(Boolean).join(" ")}`,
    description: d => `Vence el ${d.fecha_vencimiento}`,
  });
  add(stockBajo, {
    type: "stock_bajo", severity: "media", area: "Taller", action: "Reponer stock", view: "taller",
    title: s => `Stock bajo: ${s.nombre || s.referencia || "pieza"}`,
    description: s => `Actual ${s.stock_actual || 0} · minimo ${s.stock_minimo || 0}`,
  });
  add(solicitudesTaller, {
    type: "solicitud_taller", severity: "media", area: "Taller", action: "Revisar solicitud", view: "taller",
    title: s => `Solicitud de taller pendiente`,
    description: s => s.descripcion || s.motivo || "Pendiente de revisar",
  });

  const order = { critica: 0, alta: 1, media: 2, baja: 3, info: 4 };
  exceptions.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  const keys = exceptions.map(e => e.id);
  if (keys.length) {
    await db.query(
      `INSERT INTO excepciones_operativas (empresa_id, exception_key, estado, last_seen_at)
       SELECT $1, unnest($2::varchar[]), 'abierta', NOW()
       ON CONFLICT (empresa_id, exception_key) DO UPDATE SET
         last_seen_at=NOW(),
         estado=CASE
           WHEN excepciones_operativas.estado='resuelta' THEN 'abierta'
           ELSE excepciones_operativas.estado
         END`,
      [empresaId, keys]
    ).catch(() => {});
  }

  if (keys.length) {
    await db.query(
      `UPDATE excepciones_operativas
          SET estado='resuelta',
              updated_at=NOW(),
              nota=COALESCE(NULLIF(nota,''), 'Resuelta automaticamente al corregirse el dato que la generaba')
        WHERE empresa_id=$1
          AND estado IN ('abierta','pospuesta')
          AND NOT (exception_key = ANY($2::varchar[]))
          AND last_seen_at < NOW() - INTERVAL '30 seconds'`,
      [empresaId, keys]
    ).catch(() => {});
  } else {
    await db.query(
      `UPDATE excepciones_operativas
          SET estado='resuelta',
              updated_at=NOW(),
              nota=COALESCE(NULLIF(nota,''), 'Resuelta automaticamente al corregirse el dato que la generaba')
        WHERE empresa_id=$1
          AND estado IN ('abierta','pospuesta')
          AND last_seen_at < NOW() - INTERVAL '30 seconds'`,
      [empresaId]
    ).catch(() => {});
  }

  const { rows: trackedRows } = keys.length
    ? await db.query(
        `SELECT eo.*, u.nombre AS asignado_nombre, u.rol AS asignado_rol
           FROM excepciones_operativas eo
           LEFT JOIN usuarios u ON u.id=eo.asignado_a AND u.empresa_id=eo.empresa_id
          WHERE eo.empresa_id=$1 AND eo.exception_key = ANY($2::varchar[])`,
        [empresaId, keys]
      )
    : { rows: [] };
  const { rows: responsables } = await db.query(
    `SELECT id,nombre,rol,username,email
       FROM usuarios
      WHERE empresa_id=$1 AND activo IS DISTINCT FROM false
      ORDER BY nombre`,
    [empresaId]
  ).catch(() => ({ rows: [] }));
  const tracked = new Map(trackedRows.map(r => [r.exception_key, r]));
  const today = new Date().toISOString().slice(0, 10);
  const enriched = exceptions.map(item => {
    const track = tracked.get(item.id);
    const estado = track?.estado || "abierta";
    const posponerHasta = track?.posponer_hasta ? String(track.posponer_hasta).slice(0, 10) : null;
    const activa = estado === "abierta" || (estado === "pospuesta" && (!posponerHasta || posponerHasta <= today));
    const sla = calcularSlaExcepcion(item, track);
    return {
      ...item,
      sla: {
        ...sla,
        vencida: activa && sla.vencida,
      },
      workflow: {
        estado,
        nota: track?.nota || "",
        asignado_a: track?.asignado_a || null,
        asignado_nombre: track?.asignado_nombre || "",
        asignado_rol: track?.asignado_rol || "",
        posponer_hasta: posponerHasta,
        updated_at: track?.updated_at || null,
        activa,
      },
    };
  });

  const resumen = enriched.filter(item => item.workflow.activa).reduce((acc, item) => {
    acc.total++;
    acc[item.severity] = (acc[item.severity] || 0) + 1;
    acc.areas[item.area] = (acc.areas[item.area] || 0) + 1;
    return acc;
  }, { total: 0, critica: 0, alta: 0, media: 0, baja: 0, info: 0, areas: {} });
  resumen.revisadas = enriched.filter(item => item.workflow.estado === "revisada").length;
  resumen.pospuestas = enriched.filter(item => item.workflow.estado === "pospuesta" && !item.workflow.activa).length;
  resumen.asignadas_a_mi = enriched.filter(item => item.workflow.activa && String(item.workflow.asignado_a || "") === String(req.user?.id || "")).length;
  resumen.sla_vencidas = enriched.filter(item => item.workflow.activa && item.sla?.vencida).length;
  const { rows: resueltasRows } = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM excepciones_operativas
      WHERE empresa_id=$1
        AND estado='resuelta'
        AND updated_at >= NOW() - INTERVAL '7 days'`,
    [empresaId]
  ).catch(() => ({ rows: [{ total: 0 }] }));
  resumen.resueltas_7d = Number(resueltasRows[0]?.total || 0);

  res.json({ resumen, responsables, data: enriched.slice(0, 200) });
});

router.patch("/excepciones/:key", async (req, res) => {
  await ensureExcepcionesSchema();
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return res.status(401).json({ error: "Sin empresa_id" });
  const key = String(req.params.key || "").trim();
  if (!key) return res.status(400).json({ error: "Clave de excepcion obligatoria" });

  const estado = String(req.body?.estado || "abierta").toLowerCase();
  if (!["abierta", "revisada", "pospuesta", "resuelta"].includes(estado)) {
    return res.status(400).json({ error: "Estado no valido" });
  }
  const nota = req.body?.nota === undefined ? null : String(req.body.nota || "").trim();
  const posponerHasta = estado === "pospuesta" ? (req.body?.posponer_hasta || null) : null;
  const hasAsignado = Object.prototype.hasOwnProperty.call(req.body || {}, "asignado_a");
  const asignadoA = hasAsignado && req.body?.asignado_a ? req.body.asignado_a : null;
  const anterior = hasAsignado
    ? await db.query(
        "SELECT asignado_a FROM excepciones_operativas WHERE empresa_id=$1 AND exception_key=$2",
        [empresaId, key]
      ).catch(() => ({ rows: [] }))
    : { rows: [] };
  const asignadoAnterior = anterior.rows[0]?.asignado_a || null;

  const { rows } = await db.query(
    `INSERT INTO excepciones_operativas
      (empresa_id, exception_key, estado, nota, asignado_a, posponer_hasta, updated_by, updated_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
     ON CONFLICT (empresa_id, exception_key) DO UPDATE SET
       estado=EXCLUDED.estado,
       nota=COALESCE(EXCLUDED.nota, excepciones_operativas.nota),
       asignado_a=CASE WHEN $8::boolean THEN EXCLUDED.asignado_a ELSE excepciones_operativas.asignado_a END,
       posponer_hasta=EXCLUDED.posponer_hasta,
       updated_by=EXCLUDED.updated_by,
       updated_at=NOW()
     RETURNING *`,
    [empresaId, key, estado, nota, asignadoA, posponerHasta, req.user?.id || null, hasAsignado]
  );
  if (hasAsignado && asignadoA && String(asignadoA) !== String(asignadoAnterior || "")) {
    await crearNotificacion({
      empresa_id: empresaId,
      usuario_id: asignadoA,
      tipo: "excepcion_asignada",
      titulo: "Nueva excepcion asignada",
      mensaje: `Se te ha asignado una excepcion operativa: ${key}`,
      data: { exception_key: key, estado },
      created_by: req.user?.id || null,
    }).catch(() => {});
  }
  res.json({ ok: true, data: rows[0] });
});

module.exports = router;
