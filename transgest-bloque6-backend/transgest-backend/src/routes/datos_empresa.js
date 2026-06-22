const { cacheMiddleware } = require("../services/cache");
// ── Rutas que migran localStorage → BD ───────────────────────────────────
// Cubre: gastos estructura, gasoil/repostajes, noches, objetivos,
//        nóminas emitidas, config chófer, config empresa
const express = require("express");
const bcrypt  = require("bcryptjs");
const db      = require("../services/db");
const { authenticate, SOLO_GERENTE, GERENTE_O_CONTABLE, requireRole } = require("../middleware/auth");
const { getEmpresaFiscalConfig, saveEmpresaFiscalConfig, buildFiscalStatus, testFiscalConnection, saveEmpresaFiscalTestResult, getEmpresaFiscalQueueSummary, sanitizeFiscalConfigForClient } = require("../services/fiscal");
const { getGlobalSetting, publicStatusForProvider } = require("../services/apiKeys");
const { getEmpresaEmailConfig } = require("../services/email");
const { getWhatsappStatus } = require("../services/whatsapp");
const { CCAA, buildCalendarResponse, fallbackSpanishHolidays, fetchSpainHolidays, normalizeCcaa, normalizeYear } = require("../services/calendarioLaboral");
const stripe = require("../services/stripe");
const { IMAGE_MIMES, validateBase64Upload } = require("../services/uploadValidation");
const router  = express.Router();
router.use(authenticate);

const EID = req => req.empresaId || req.user.empresa_id;

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeFilename(value, fallback = "puesta-marcha.html") {
  const cleaned = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

async function ensureChoferJornadasSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS chofer_jornadas (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      chofer_id INTEGER NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
      vehiculo_id INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
      estado TEXT NOT NULL DEFAULT 'abierta',
      actividad_actual TEXT NOT NULL DEFAULT 'otros_trabajos',
      inicio_at TIMESTAMP NOT NULL DEFAULT NOW(),
      fin_at TIMESTAMP,
      km_inicio NUMERIC,
      km_fin NUMERIC,
      hace_noche BOOLEAN DEFAULT FALSE,
      noche_lugar TEXT,
      notas TEXT,
      eventos JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_chofer_jornadas_empresa_chofer_inicio ON chofer_jornadas(empresa_id, chofer_id, inicio_at DESC)");
}

async function ensureControlCobrosConfigSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS control_cobros_config (
      empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
      cfg_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
const EMPRESA_PROFILE_DEFAULTS = {
  razon_social: "",
  cif: "",
  domicilio: "",
  cp: "",
  municipio: "",
  provincia: "",
  pais: "Espana",
  telefono: "",
  email: "",
  emails_albaranes: "",
  web: "",
  iban: "",
  bic: "",
  banco: "",
  regimen_iva: "Regimen general",
  forma_pago_colaboradores: "dias_fijos",
  dias_pago_colaboradores: "15",
  plazo_pago_colaboradores: 60,
  forma_pago_clientes: "recepcion_factura",
  dias_pago_clientes: "",
  plazo_pago_clientes: 60,
  texto_pago_clientes: "Transferencia 60 dias fecha recepcion factura",
  tipo_iva_defecto: "21",
  serie_facturas: "A",
  serie_rectificativas: "R",
  serie_ordenes: "OC",
  texto_pie: "",
  logo_url: "",
  documento_control: {
    habilitado: false,
    sistema: "codigo_numerico",
    dominio_url: "",
    dominio_comunicado: false,
    usar_orden_carga_como_soporte: true,
    observaciones: "",
  },
};

async function assertChoferEmpresa(choferId, empresaId) {
  if (!choferId || !empresaId) return null;
  const { rows } = await db.query(
    "SELECT id FROM choferes WHERE id=$1 AND empresa_id=$2 AND COALESCE(activo,true)=true LIMIT 1",
    [choferId, empresaId]
  );
  return rows[0] || null;
}

let nominasSchemaReady = null;
function ensureNominasSchema() {
  if (!nominasSchemaReady) {
    nominasSchemaReady = (async () => {
      await db.query("ALTER TABLE nominas_emitidas ADD COLUMN IF NOT EXISTS plus_actividad NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE nominas_emitidas ADD COLUMN IF NOT EXISTS horas_extra NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE nominas_emitidas ADD COLUMN IF NOT EXISTS noches INTEGER NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE nominas_emitidas ADD COLUMN IF NOT EXISTS importe_noches NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE nominas_emitidas ADD COLUMN IF NOT EXISTS ss_empresa NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE nominas_emitidas ADD COLUMN IF NOT EXISTS ss_trabajador NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE nominas_emitidas ADD COLUMN IF NOT EXISTS irpf NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE nominas_emitidas ADD COLUMN IF NOT EXISTS emitida_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
      await db.query("CREATE UNIQUE INDEX IF NOT EXISTS uniq_nominas_empresa_chofer_periodo ON nominas_emitidas(empresa_id, chofer_id, periodo)");
    })().catch(err => {
      nominasSchemaReady = null;
      throw err;
    });
  }
  return nominasSchemaReady;
}

let liquidacionChoferSchemaReady = null;
function ensureLiquidacionChoferSchema() {
  if (!liquidacionChoferSchemaReady) {
    liquidacionChoferSchemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS chofer_config (
          chofer_id UUID PRIMARY KEY REFERENCES choferes(id) ON DELETE CASCADE,
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          salario_base NUMERIC(10,2),
          precio_noche NUMERIC(10,2) NOT NULL DEFAULT 40,
          plus_actividad NUMERIC(10,2) NOT NULL DEFAULT 0,
          irpf_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
          ss_empresa_pct NUMERIC(6,2) NOT NULL DEFAULT 29.9,
          ss_trabajador_pct NUMERIC(6,2) NOT NULL DEFAULT 6.35,
          convenio TEXT,
          incentivo_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS vehiculo_noches (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          fecha DATE NOT NULL,
          chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL,
          pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
          ciudad VARCHAR(180),
          importe NUMERIC(10,2) NOT NULL DEFAULT 0,
          notas TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_vehiculo_noches_empresa_vehiculo_fecha ON vehiculo_noches(empresa_id, vehiculo_id, fecha DESC)");
      await db.query(`
        CREATE TABLE IF NOT EXISTS vehiculo_gasoil_config (
          vehiculo_id UUID PRIMARY KEY REFERENCES vehiculos(id) ON DELETE CASCADE,
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          tipo VARCHAR(20) NOT NULL DEFAULT 'fijo',
          precio_fijo NUMERIC(10,4) NOT NULL DEFAULT 1.65,
          periodos JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS vehiculo_repostajes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          fecha DATE NOT NULL,
          litros NUMERIC(10,2) NOT NULL DEFAULT 0,
          precio_litro NUMERIC(10,4),
          importe NUMERIC(10,2),
          km_odometro NUMERIC(12,2),
          notas TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_vehiculo_repostajes_empresa_vehiculo_fecha ON vehiculo_repostajes(empresa_id, vehiculo_id, fecha DESC)");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS precio_km NUMERIC(10,4) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS km_pago_tipo VARCHAR(20) NOT NULL DEFAULT 'todos'");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS dieta_local NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS dieta_nacional NUMERIC(10,2) NOT NULL DEFAULT 40");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS dieta_internacional NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS disponibilidad_diaria NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS disponibilidad_mensual NUMERIC(10,2) NOT NULL DEFAULT 0");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS convenio_notas TEXT");
      await db.query("ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS convenio_importado_nombre VARCHAR(180)");
      await db.query("ALTER TABLE vehiculo_noches ADD COLUMN IF NOT EXISTS tipo_dieta VARCHAR(30) NOT NULL DEFAULT 'nacional'");
    })().catch(err => {
      liquidacionChoferSchemaReady = null;
      throw err;
    });
  }
  return liquidacionChoferSchemaReady;
}

async function integrationProviderStatus(empresaId, provider) {
  const status = await publicStatusForProvider(provider, empresaId);
  const configured = status.company_configured || (status.use_global && status.global_configured);
  return {
    provider,
    configured: !!configured,
    company_configured: !!status.company_configured,
    global_configured: !!status.global_configured,
    global_source: status.global_source || "none",
    use_global: status.use_global !== false,
    activo: status.activo !== false,
    limite_mensual: Number(status.limite_mensual || 0),
    usos_mes: Number(status.usos_mes || 0),
    masked: status.company_masked || "",
  };
}

function buildFirmaIntegracionStatus({ perfil = {}, providers = [], fiscalStatus = null } = {}) {
  const providerList = Array.isArray(providers) ? providers.filter(Boolean) : [];
  const providerReady = providerList.some(p => p?.configured && p?.activo);
  const documentoControl = perfil?.documento_control || {};
  const hasEmpresa = !!(String(perfil?.razon_social || "").trim() && String(perfil?.cif || "").trim());
  const hasContact = !!(String(perfil?.email || "").trim() || String(perfil?.telefono || "").trim());
  const dcdReady = !!documentoControl?.habilitado;
  const dominioReady = documentoControl?.sistema !== "qr_url" || !!(documentoControl?.dominio_url && documentoControl?.dominio_comunicado);
  const fiscalReady = !!(fiscalStatus?.level === "ok" || fiscalStatus?.production_ready);
  const checks = [
    {
      key: "proveedor_firma",
      label: "Proveedor de firma avanzada",
      ok: providerReady,
      required: true,
      detail: providerReady ? "Proveedor configurado sin exponer secretos." : "Falta conectar un proveedor de firma avanzada/eIDAS.",
    },
    {
      key: "datos_empresa",
      label: "Datos maestros de la empresa",
      ok: hasEmpresa && hasContact,
      required: true,
      detail: hasEmpresa && hasContact ? "Razon social, NIF/CIF y contacto disponibles." : "Completa razon social, NIF/CIF y email o telefono.",
    },
    {
      key: "documento_control",
      label: "Documento de control digital",
      ok: dcdReady,
      required: true,
      detail: dcdReady ? "Modulo DeCA activado." : "Activa el Documento de Control Digital.",
    },
    {
      key: "dominio_publico",
      label: "Dominio/QR trazable",
      ok: dominioReady,
      required: documentoControl?.sistema === "qr_url",
      detail: dominioReady ? "Sistema de enlace valido para el modo actual." : "En modo QR hace falta dominio HTTPS comunicado.",
    },
    {
      key: "canal_fiscal",
      label: "Canal fiscal",
      ok: fiscalReady,
      required: false,
      detail: fiscalReady ? "Canal fiscal preparado." : "Recomendado antes de produccion para enlazar factura, documento y evidencia.",
    },
  ];
  const requiredPending = checks.filter(c => c.required && !c.ok);
  const recommendedPending = checks.filter(c => !c.required && !c.ok);
  const ready = requiredPending.length === 0;
  return {
    target: "firma_electronica_avanzada_eidas",
    mode: ready ? "preparado" : "preparatorio",
    ready,
    production_ready: ready && fiscalReady,
    providers: providerList,
    checks,
    faltantes: requiredPending.map(c => ({ key: c.key, label: c.label, detail: c.detail })),
    recomendaciones: recommendedPending.map(c => ({ key: c.key, label: c.label, detail: c.detail })),
    siguiente_accion: requiredPending[0]?.detail || (recommendedPending[0]?.detail || "Preparado para conectar el flujo de firma documental."),
    legal_note: "El estado valida preparacion tecnica. La validez legal final depende del proveedor, del metodo de autenticacion y de la evidencia generada en cada firma.",
  };
}

function buildEdiApiClienteStatus({ perfil = {}, counts = {}, emailConfigured = false, fiscalStatus = null, publicUrl = "" } = {}) {
  const documentoControl = perfil?.documento_control || {};
  const clientes = Number(counts.clientes || 0);
  const clientesContacto = Number(counts.clientes_contacto || 0);
  const clientesPortal = Number(counts.clientes_portal || 0);
  const pedidos90d = Number(counts.pedidos_90d || 0);
  const soporte90d = Number(counts.soporte_90d || 0);
  const dcdReady = !!documentoControl?.habilitado;
  const dominioReady = documentoControl?.sistema !== "qr_url" || !!(documentoControl?.dominio_url && documentoControl?.dominio_comunicado);
  const fiscalReady = !!(fiscalStatus?.level === "ok" || fiscalStatus?.production_ready);
  const publicUrlReady = /^https?:\/\//i.test(String(publicUrl || ""));
  const checks = [
    {
      key: "clientes_contacto",
      label: "Clientes con contacto B2B",
      ok: clientes > 0 && clientesContacto > 0,
      required: true,
      detail: `${clientesContacto}/${clientes} cliente(s) activo(s) con email o telefono.`,
      weight: 18,
    },
    {
      key: "portal_cliente",
      label: "Portal cliente operativo",
      ok: clientesPortal > 0,
      required: true,
      detail: clientesPortal > 0 ? `${clientesPortal} cliente(s) con usuario de portal.` : "Genera usuarios de portal para clientes integrables.",
      weight: 18,
    },
    {
      key: "documento_control_export",
      label: "DCD/eFTI exportable",
      ok: dcdReady && dominioReady,
      required: true,
      detail: dcdReady && dominioReady ? "Documento digital y acceso verificable listos." : "Activa DCD y revisa dominio/QR si aplica.",
      weight: 20,
    },
    {
      key: "smtp_notificaciones",
      label: "Canal de notificaciones",
      ok: !!emailConfigured,
      required: true,
      detail: emailConfigured ? "SMTP configurado para avisos y envios documentales." : "Configura SMTP antes de integraciones con clientes.",
      weight: 14,
    },
    {
      key: "soporte_documental",
      label: "Soporte documental historico",
      ok: pedidos90d === 0 || soporte90d > 0,
      required: false,
      detail: pedidos90d === 0 ? "Sin pedidos recientes para medir." : `${soporte90d} soporte(s) documental(es) en pedidos recientes.`,
      weight: 10,
    },
    {
      key: "canal_fiscal",
      label: "Canal fiscal trazable",
      ok: fiscalReady,
      required: false,
      detail: fiscalReady ? "Fiscalidad preparada para enlazar factura y evento B2B." : "Recomendado para clientes enterprise.",
      weight: 10,
    },
    {
      key: "endpoint_publico",
      label: "URL publica de integracion",
      ok: publicUrlReady,
      required: false,
      detail: publicUrlReady ? "URL publica disponible para portales/webhooks." : "Define PUBLIC_APP_URL/APP_PUBLIC_URL para produccion.",
      weight: 10,
    },
  ];
  const totalWeight = checks.reduce((sum, c) => sum + Number(c.weight || 0), 0) || checks.length || 1;
  const okWeight = checks.reduce((sum, c) => sum + (c.ok ? Number(c.weight || 0) : 0), 0);
  const score = Math.round((okWeight / totalWeight) * 100);
  const faltantes = checks.filter(c => c.required && !c.ok).map(c => ({ key: c.key, label: c.label, detail: c.detail }));
  const recomendaciones = checks.filter(c => !c.required && !c.ok).map(c => ({ key: c.key, label: c.label, detail: c.detail }));
  return {
    target: "edi_api_cliente_b2b",
    mode: faltantes.length === 0 ? "preparado" : "preparatorio",
    ready: faltantes.length === 0,
    production_ready: faltantes.length === 0 && recomendaciones.length === 0,
    score,
    checks,
    faltantes,
    recomendaciones,
    metrics: { clientes, clientes_contacto: clientesContacto, clientes_portal: clientesPortal, pedidos_90d: pedidos90d, soporte_90d: soporte90d },
    siguiente_accion: faltantes[0]?.detail || recomendaciones[0]?.detail || "Base preparada para conectar EDI/API con clientes grandes.",
    legal_note: "Este diagnostico no activa un conector EDI externo; valida que la empresa dispone de datos, portal, soporte documental y canales para integracion B2B.",
  };
}

async function buildPuestaMarchaComercial(req) {
  const empresaId = EID(req);
  await ensureControlCobrosConfigSchema().catch(() => {});
  const safeOne = async (query, params = [], fallback = {}) => {
    const { rows } = await db.query(query, params).catch(() => ({ rows: [fallback] }));
    return rows[0] || fallback;
  };
  const safeRows = async (query, params = []) => {
    const { rows } = await db.query(query, params).catch(() => ({ rows: [] }));
    return rows || [];
  };

  const [empresaRow, emailCfg, fiscalConfig, counts, docsRow, cobrosRow, fiscalQueue, backupRow] = await Promise.all([
    safeOne("SELECT plan, cfg_precios FROM empresas WHERE id=$1 LIMIT 1", [empresaId]),
    getEmpresaEmailConfig(empresaId).catch(() => null),
    getEmpresaFiscalConfig(empresaId).catch(() => ({})),
    safeOne(`
      SELECT
        (SELECT COUNT(*)::int FROM usuarios WHERE empresa_id=$1 AND activo=true) AS usuarios,
        (SELECT COUNT(*)::int FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text='gerente') AS gerentes,
        (SELECT COUNT(*)::int FROM clientes WHERE empresa_id=$1 AND COALESCE(activo,true)=true) AS clientes,
        (SELECT COUNT(*)::int FROM vehiculos WHERE empresa_id=$1 AND COALESCE(activo,true)=true) AS vehiculos,
        (SELECT COUNT(*)::int FROM choferes WHERE empresa_id=$1 AND COALESCE(activo,true)=true) AS choferes,
        (SELECT COUNT(*)::int FROM colaboradores WHERE empresa_id=$1 AND COALESCE(activo,true)=true) AS colaboradores,
        (SELECT COUNT(*)::int FROM pedidos WHERE empresa_id=$1 AND created_at >= NOW() - INTERVAL '60 days') AS pedidos_60d,
        (SELECT COUNT(*)::int FROM facturas WHERE empresa_id=$1) AS facturas
    `, [empresaId], {}),
    safeOne(`
      SELECT
        COUNT(*) FILTER (
          WHERE p.estado::text IN ('entregado','facturado')
            AND NOT EXISTS (
              SELECT 1 FROM pedido_docs pd
               WHERE pd.empresa_id=p.empresa_id AND pd.pedido_id=p.id
                 AND (
                   LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                   OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                   OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
                 )
            )
        )::int AS entregados_sin_soporte
      FROM pedidos p
      WHERE p.empresa_id=$1
        AND p.created_at >= NOW() - INTERVAL '90 days'
    `, [empresaId], { entregados_sin_soporte: 0 }),
    safeOne("SELECT cfg_json FROM control_cobros_config WHERE empresa_id=$1 LIMIT 1", [empresaId], {}),
    getEmpresaFiscalQueueSummary(empresaId).catch(() => ({ resumen: {} })),
    safeOne(`
      SELECT
        COUNT(*)::int AS solicitudes_backup,
        COUNT(*) FILTER (WHERE estado::text IN ('pendiente','en_proceso'))::int AS backups_pendientes,
        COUNT(*) FILTER (WHERE estado::text IN ('resuelto','generado','completado','completada','hecho'))::int AS backups_resueltos,
        MAX(created_at) AS ultimo_backup_solicitado_at,
        MAX(resuelto_at) AS ultimo_backup_resuelto_at
      FROM backup_solicitudes
      WHERE empresa_id=$1
    `, [empresaId], {
      solicitudes_backup: 0,
      backups_pendientes: 0,
      backups_resueltos: 0,
      ultimo_backup_solicitado_at: null,
      ultimo_backup_resuelto_at: null,
    }),
  ]);

  const cfgPrecios = empresaRow?.cfg_precios && typeof empresaRow.cfg_precios === "object" ? empresaRow.cfg_precios : {};
  const perfil = normalizeEmpresaProfile(cfgPrecios.empresa_perfil || cfgPrecios);
  const fiscalStatus = buildFiscalStatus(await applyGlobalFiscalSoftwareMeta(fiscalConfig || {}));
  const documentoControl = perfil.documento_control || {};
  const cobrosCfg = cobrosRow?.cfg_json && typeof cobrosRow.cfg_json === "object" ? cobrosRow.cfg_json : {};
  const emailConfigured = !!(emailCfg?.activo !== false && emailCfg?.smtp_host && (emailCfg?.smtp_from || emailCfg?.smtp_user));
  const emailTestOk = emailCfg?.last_test_ok === true;
  const queueResumen = fiscalQueue?.resumen || {};
  const facturasAtascadas = Number(queueResumen.atascados || 0) + Number(queueResumen.con_error || 0);
  const backupSolicitudes = Number(backupRow?.solicitudes_backup || 0);
  const backupsPendientes = Number(backupRow?.backups_pendientes || 0);
  const backupsResueltos = Number(backupRow?.backups_resueltos || 0);
  const backupPreparado = backupSolicitudes > 0 || backupsPendientes > 0 || backupsResueltos > 0;

  const checks = [
    {
      key: "empresa_fiscal",
      area: "Empresa",
      label: "Datos fiscales completos",
      ok: !!(perfil.razon_social && perfil.cif && perfil.domicilio && perfil.municipio && perfil.provincia && perfil.email),
      required: true,
      weight: 14,
      detail: "Razon social, CIF/NIF, domicilio, municipio, provincia y email.",
      action: "Completar Datos fiscales en Mi Empresa.",
    },
    {
      key: "facturacion_base",
      area: "Facturacion",
      label: "Series, IVA y pago configurados",
      ok: !!(perfil.serie_facturas && perfil.tipo_iva_defecto && perfil.texto_pago_clientes && Number(perfil.plazo_pago_clientes || 0) >= 0),
      required: true,
      weight: 12,
      detail: "Series y reglas de pago listas para emitir borradores/facturas.",
      action: "Revisar Configuracion facturas.",
    },
    {
      key: "usuarios",
      area: "Seguridad",
      label: "Usuarios y gerente activos",
      ok: Number(counts.usuarios || 0) > 0 && Number(counts.gerentes || 0) > 0,
      required: true,
      weight: 12,
      detail: `${Number(counts.usuarios || 0)} usuario(s), ${Number(counts.gerentes || 0)} gerente(s).`,
      action: "Crear al menos un gerente activo.",
    },
    {
      key: "clientes",
      area: "Operativa",
      label: "Clientes operativos",
      ok: Number(counts.clientes || 0) > 0,
      required: true,
      weight: 10,
      detail: `${Number(counts.clientes || 0)} cliente(s) activo(s).`,
      action: "Crear o importar clientes reales.",
    },
    {
      key: "capacidad_transporte",
      area: "Operativa",
      label: "Capacidad de transporte",
      ok: Number(counts.vehiculos || 0) > 0 || Number(counts.colaboradores || 0) > 0,
      required: true,
      weight: 12,
      detail: `${Number(counts.vehiculos || 0)} vehiculo(s), ${Number(counts.colaboradores || 0)} colaborador(es).`,
      action: "Registrar flota propia o colaboradores/proveedores.",
    },
    {
      key: "choferes",
      area: "Operativa",
      label: "Choferes para flota propia",
      ok: Number(counts.vehiculos || 0) === 0 || Number(counts.choferes || 0) > 0,
      required: true,
      weight: 8,
      detail: `${Number(counts.choferes || 0)} chofer(es) activo(s).`,
      action: "Registrar choferes si se opera con flota propia.",
    },
    {
      key: "smtp",
      area: "Comunicaciones",
      label: "Email operativo",
      ok: emailConfigured,
      required: true,
      weight: 10,
      detail: emailConfigured ? (emailTestOk ? "SMTP configurado y probado." : "SMTP configurado; conviene enviar prueba.") : "SMTP no configurado.",
      action: "Configurar y probar SMTP para clientes/colaboradores.",
    },
    {
      key: "documento_control",
      area: "Documentacion",
      label: "Documento de control digital",
      ok: !!documentoControl.habilitado,
      required: true,
      weight: 10,
      detail: documentoControl.habilitado ? "DeCA/DCD activado." : "DeCA/DCD pendiente de activar.",
      action: "Activar Documento de Control Digital.",
    },
    {
      key: "soporte_documental",
      area: "Cobro",
      label: "Soporte documental para cobro",
      ok: Number(docsRow.entregados_sin_soporte || 0) === 0,
      required: false,
      weight: 7,
      detail: `${Number(docsRow.entregados_sin_soporte || 0)} viaje(s) entregados sin albaran/POD/CMR en 90 dias.`,
      action: "Subir albaranes/POD/CMR antes de facturar o reclamar.",
    },
    {
      key: "control_cobros",
      area: "Tesoreria",
      label: "Politica de cobros definida",
      ok: Number(cobrosCfg.dias_entre_reclamaciones || 0) > 0 && Number(cobrosCfg.dias_hasta_juridico || 0) > 0,
      required: false,
      weight: 5,
      detail: "Parametros de reclamacion y juridico preparados.",
      action: "Revisar politica de cobros.",
    },
    {
      key: "backup_go_live",
      area: "Continuidad",
      label: "Backup de salida solicitado",
      ok: backupPreparado,
      required: false,
      weight: 6,
      detail: backupPreparado
        ? `${backupSolicitudes} solicitud(es), ${backupsPendientes} pendiente(s), ${backupsResueltos} resuelta(s).`
        : "No hay solicitud de backup registrada para la salida a produccion.",
      action: "Solicitar backup inicial desde Puesta en marcha antes de activar una empresa real.",
    },
    {
      key: "fiscal",
      area: "Fiscal",
      label: "Canal fiscal sin errores activos",
      ok: facturasAtascadas === 0,
      required: false,
      weight: 5,
      detail: `${facturasAtascadas} documento(s) fiscal(es) con error o atascados.`,
      action: "Revisar cola fiscal antes de emitir en produccion.",
    },
  ];

  const totalWeight = checks.reduce((sum, c) => sum + Number(c.weight || 0), 0);
  const okWeight = checks.reduce((sum, c) => sum + (c.ok ? Number(c.weight || 0) : 0), 0);
  const score = totalWeight ? Math.round((okWeight / totalWeight) * 100) : 0;
  const bloqueantes = checks.filter(c => c.required && !c.ok);
  const avisos = checks.filter(c => !c.required && !c.ok);
  const estado = bloqueantes.length ? "bloqueado" : score >= 92 ? "listo" : "vigilancia";
  const acciones_prioritarias = [...bloqueantes, ...avisos]
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
    .slice(0, 8)
    .map(c => ({ key: c.key, area: c.area, label: c.label, action: c.action, required: !!c.required, detail: c.detail }));

  return {
    generated_at: new Date().toISOString(),
    objetivo: "Checklist operativo para dejar la empresa lista para venta/produccion.",
    resumen: {
      score,
      estado,
      listo_para_operar: bloqueantes.length === 0,
      bloqueantes: bloqueantes.length,
      avisos: avisos.length,
      checks_ok: checks.filter(c => c.ok).length,
      checks_total: checks.length,
      producto_operativo_vendible_estimado: bloqueantes.length === 0 && score >= 92 ? "95-100%" : score >= 85 ? "90-95%" : "pendiente",
    },
    metricas: {
      usuarios: Number(counts.usuarios || 0),
      gerentes: Number(counts.gerentes || 0),
      clientes: Number(counts.clientes || 0),
      vehiculos: Number(counts.vehiculos || 0),
      choferes: Number(counts.choferes || 0),
      colaboradores: Number(counts.colaboradores || 0),
      pedidos_60d: Number(counts.pedidos_60d || 0),
      facturas: Number(counts.facturas || 0),
      entregados_sin_soporte: Number(docsRow.entregados_sin_soporte || 0),
      backup_solicitudes: backupSolicitudes,
      backups_pendientes: backupsPendientes,
      backups_resueltos: backupsResueltos,
    },
    backup: {
      solicitado: backupPreparado,
      solicitudes: backupSolicitudes,
      pendientes: backupsPendientes,
      resueltos: backupsResueltos,
      ultimo_solicitado_at: backupRow?.ultimo_backup_solicitado_at || null,
      ultimo_resuelto_at: backupRow?.ultimo_backup_resuelto_at || null,
      gestion: "TransGestAdmin",
    },
    checks,
    acciones_prioritarias,
  };
}

function buildPuestaMarchaInformeHtml(data, req) {
  const resumen = data.resumen || {};
  const metricas = data.metricas || {};
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const acciones = Array.isArray(data.acciones_prioritarias) ? data.acciones_prioritarias : [];
  const estado = String(resumen.estado || "vigilancia");
  const stateClass = estado === "listo" ? "green" : estado === "bloqueado" ? "red" : "amber";
  const generatedAt = data.generated_at || new Date().toISOString();
  const metricRows = Object.entries(metricas).map(([key, value]) => `
    <tr><th>${htmlEscape(key.replace(/_/g, " "))}</th><td>${htmlEscape(value)}</td></tr>
  `).join("");
  const actionRows = acciones.map(action => `
    <tr>
      <td><span class="${action.required ? "red" : "amber"}">${htmlEscape(action.required ? "Bloqueante" : "Aviso")}</span></td>
      <td>${htmlEscape(action.area)}</td>
      <td><strong>${htmlEscape(action.label)}</strong><br><span class="muted">${htmlEscape(action.detail)}</span></td>
      <td>${htmlEscape(action.action)}</td>
    </tr>
  `).join("");
  const checkRows = checks.map(check => `
    <tr>
      <td><span class="${check.ok ? "green" : check.required ? "red" : "amber"}">${htmlEscape(check.ok ? "OK" : check.required ? "Pendiente" : "Aviso")}</span></td>
      <td>${htmlEscape(check.area)}</td>
      <td>${htmlEscape(check.label)}</td>
      <td>${htmlEscape(check.detail)}</td>
      <td>${htmlEscape(check.action)}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Informe de puesta en marcha</title>
  <style>
    body{font-family:Arial,sans-serif;color:#0f172a;margin:32px;background:#f8fafc}
    h1{margin:0;font-size:28px} h2{font-size:18px;margin-top:28px}
    .sub{color:#64748b;font-size:13px;margin-top:6px}.muted{color:#64748b;font-size:12px}
    .grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:22px 0}
    .box{background:#fff;border:1px solid #dbe4ef;border-radius:8px;padding:13px}
    .metric{font-size:24px;font-weight:800}.label{font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;margin-top:4px}
    .green{color:#059669;font-weight:800}.amber{color:#b45309;font-weight:800}.red{color:#dc2626;font-weight:800}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe4ef;border-radius:8px;overflow:hidden;margin-top:10px}
    th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;vertical-align:top}
    th{background:#f1f5f9;color:#334155;text-transform:uppercase;font-size:11px}
    .note{background:#fff;border:1px solid #dbe4ef;border-left:4px solid #2563eb;border-radius:8px;padding:12px 14px;margin-top:18px;font-size:13px;line-height:1.5}
  </style>
</head>
<body>
  <h1>Informe de puesta en marcha</h1>
  <div class="sub">Generado el ${htmlEscape(new Date(generatedAt).toLocaleString("es-ES"))} por ${htmlEscape(req.user?.email || req.user?.username || "TransGest")}.</div>
  <div class="grid">
    <div class="box"><div class="metric">${htmlEscape(resumen.score || 0)}%</div><div class="label">Score</div></div>
    <div class="box"><div class="metric ${stateClass}">${htmlEscape(estado)}</div><div class="label">Estado</div></div>
    <div class="box"><div class="metric ${Number(resumen.bloqueantes || 0) ? "red" : "green"}">${htmlEscape(resumen.bloqueantes || 0)}</div><div class="label">Bloqueantes</div></div>
    <div class="box"><div class="metric ${Number(resumen.avisos || 0) ? "amber" : "green"}">${htmlEscape(resumen.avisos || 0)}</div><div class="label">Avisos</div></div>
    <div class="box"><div class="metric ${stateClass}">${htmlEscape(resumen.producto_operativo_vendible_estimado || "-")}</div><div class="label">Producto vendible</div></div>
  </div>
  <div class="note">${htmlEscape(data.objetivo || "Checklist operativo para salida comercial.")}</div>
  <h2>Acciones prioritarias</h2>
  <table><thead><tr><th>Tipo</th><th>Area</th><th>Control</th><th>Accion</th></tr></thead><tbody>${actionRows || "<tr><td colspan='4'>Sin acciones pendientes.</td></tr>"}</tbody></table>
  <h2>Metricas de base</h2>
  <table><tbody>${metricRows || "<tr><td>Sin metricas disponibles.</td></tr>"}</tbody></table>
  <h2>Checklist operativo</h2>
  <table><thead><tr><th>Estado</th><th>Area</th><th>Control</th><th>Detalle</th><th>Accion</th></tr></thead><tbody>${checkRows || "<tr><td colspan='5'>Sin checks disponibles.</td></tr>"}</tbody></table>
  <div class="note">Este informe no sustituye auditoria legal, fiscal ni certificacion de integraciones externas. Sirve como acta operativa interna para salida comercial, implantacion y seguimiento de bloqueantes.</div>
</body>
</html>`;
}

async function buildJornadaDiaria(req) {
  const empresaId = EID(req);
  const safeOne = async (query, params = [], fallback = {}) => {
    const { rows } = await db.query(query, params).catch(() => ({ rows: [fallback] }));
    return rows[0] || fallback;
  };
  const puesta = await buildPuestaMarchaComercial(req).catch(() => null);
  const fiscalQueue = await getEmpresaFiscalQueueSummary(empresaId).catch(() => ({ resumen: {} }));
  const [trafico, docs, cobros, pagos] = await Promise.all([
    safeOne(`
      SELECT
        COUNT(*) FILTER (WHERE p.estado::text NOT IN ('cancelado','entregado','facturado'))::int AS activos,
        COUNT(*) FILTER (WHERE p.fecha_carga::date = CURRENT_DATE AND p.estado::text NOT IN ('cancelado','entregado','facturado'))::int AS cargas_hoy,
        COUNT(*) FILTER (WHERE COALESCE(p.fecha_descarga,p.fecha_entrega)::date = CURRENT_DATE AND p.estado::text NOT IN ('cancelado','facturado'))::int AS descargas_hoy,
        COUNT(*) FILTER (
          WHERE COALESCE(p.fecha_descarga,p.fecha_entrega,p.fecha_carga)::date < CURRENT_DATE
            AND p.estado::text NOT IN ('cancelado','entregado','facturado')
        )::int AS vencidos,
        COUNT(*) FILTER (WHERE p.estado::text='incidencia')::int AS incidencias,
        COUNT(*) FILTER (
          WHERE p.estado::text IN ('pendiente','confirmado','en_curso','descarga')
            AND p.vehiculo_id IS NULL
            AND p.colaborador_id IS NULL
        )::int AS sin_asignacion,
        COUNT(*) FILTER (
          WHERE p.estado::text IN ('pendiente','confirmado','en_curso','descarga')
            AND COALESCE(p.importe,p.precio_cliente_col,p.precio_unitario,0) <= 0
        )::int AS sin_precio,
        COUNT(*) FILTER (
          WHERE p.estado::text IN ('pendiente','confirmado','en_curso','descarga','entregado')
            AND COALESCE(p.precio_colaborador,0) > COALESCE(NULLIF(p.precio_cliente_col,0), p.importe, 0)
        )::int AS margen_negativo,
        COUNT(*) FILTER (WHERE COALESCE(p.pendiente_completar,false)=true AND p.estado::text NOT IN ('cancelado','facturado'))::int AS pendientes_completar
      FROM pedidos p
      WHERE p.empresa_id=$1
        AND p.created_at >= NOW() - INTERVAL '120 days'
    `, [empresaId], {
      activos: 0, cargas_hoy: 0, descargas_hoy: 0, vencidos: 0, incidencias: 0,
      sin_asignacion: 0, sin_precio: 0, margen_negativo: 0, pendientes_completar: 0,
    }),
    safeOne(`
      SELECT
        COUNT(*) FILTER (
          WHERE p.estado::text IN ('entregado','facturado')
            AND NOT EXISTS (
              SELECT 1 FROM pedido_docs pd
               WHERE pd.empresa_id=p.empresa_id AND pd.pedido_id=p.id
                 AND (
                   LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                   OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                   OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
                 )
            )
        )::int AS entregados_sin_soporte
      FROM pedidos p
      WHERE p.empresa_id=$1
        AND p.created_at >= NOW() - INTERVAL '45 days'
    `, [empresaId], { entregados_sin_soporte: 0 }),
    safeOne(`
      SELECT
        COUNT(*) FILTER (WHERE estado::text IN ('vencida','reclamada','sin_cobrar'))::int AS cobros_riesgo,
        COUNT(*) FILTER (WHERE revision_cobro_at IS NOT NULL AND revision_cobro_at <= CURRENT_DATE AND estado::text <> 'cobrada')::int AS revisar_hoy,
        COALESCE(SUM(total) FILTER (WHERE estado::text IN ('vencida','reclamada','sin_cobrar')),0)::numeric AS importe_riesgo
      FROM facturas
      WHERE empresa_id=$1
        AND estado::text <> 'rectificada'
    `, [empresaId], { cobros_riesgo: 0, revisar_hoy: 0, importe_riesgo: 0 }),
    safeOne(`
      SELECT
        COUNT(*) FILTER (
          WHERE pay.id IS NULL
             OR (NULLIF(TRIM(COALESCE(pay.factura_nombre,'')),'') IS NULL
                 AND NULLIF(TRIM(COALESCE(pay.factura_data,'')),'') IS NULL)
        )::int AS facturas_pendientes,
        COUNT(*) FILTER (WHERE pay.id IS NULL OR COALESCE(pay.documentacion_recibida,false)=false)::int AS documentacion_pendiente,
        COUNT(*) FILTER (
          WHERE COALESCE(pay.pagado,false)=false
            AND COALESCE(pay.fecha_pago_calculada, p.fecha_descarga, p.fecha_entrega, p.fecha_carga, p.created_at::date) < CURRENT_DATE
        )::int AS pagos_vencidos,
        COALESCE(SUM(COALESCE(pay.importe,p.precio_colaborador,0)) FILTER (WHERE COALESCE(pay.pagado,false)=false),0)::numeric AS importe_pendiente
      FROM pedidos p
      LEFT JOIN pedido_colaborador_pagos pay ON pay.pedido_id=p.id AND pay.empresa_id=p.empresa_id
      WHERE p.empresa_id=$1
        AND COALESCE(p.precio_colaborador,0) > 0
        AND p.estado::text NOT IN ('cancelado')
    `, [empresaId], { facturas_pendientes: 0, documentacion_pendiente: 0, pagos_vencidos: 0, importe_pendiente: 0 }),
  ]);

  const fiscalResumen = fiscalQueue?.resumen || {};
  const fiscalAtascado = Number(fiscalResumen.atascados || 0) + Number(fiscalResumen.con_error || 0);
  const checks = [
    {
      key: "base_go_live",
      area: "Base",
      label: "Bloqueantes de puesta en marcha",
      ok: Number(puesta?.resumen?.bloqueantes || 0) === 0,
      required: true,
      severity: "critica",
      detail: `${Number(puesta?.resumen?.bloqueantes || 0)} bloqueante(s) base.`,
      action: "Resolver bloqueantes de Mi Empresa > Puesta en marcha.",
    },
    {
      key: "trafico_vencido",
      area: "Trafico",
      label: "Viajes vencidos sin cerrar",
      ok: Number(trafico.vencidos || 0) === 0,
      required: true,
      severity: "critica",
      detail: `${Number(trafico.vencidos || 0)} viaje(s) vencido(s).`,
      action: "Actualizar estado, avisar cliente o abrir incidencia.",
    },
    {
      key: "incidencias",
      area: "Trafico",
      label: "Incidencias abiertas",
      ok: Number(trafico.incidencias || 0) === 0,
      required: true,
      severity: "critica",
      detail: `${Number(trafico.incidencias || 0)} incidencia(s) activa(s).`,
      action: "Entrar en Excepciones/Gestion de Trafico y asignar responsable.",
    },
    {
      key: "asignaciones",
      area: "Planificacion",
      label: "Pedidos sin asignacion",
      ok: Number(trafico.sin_asignacion || 0) === 0,
      required: false,
      severity: "alta",
      detail: `${Number(trafico.sin_asignacion || 0)} pedido(s) sin vehiculo ni colaborador.`,
      action: "Asignar flota, chofer o colaborador antes de la carga.",
    },
    {
      key: "precios",
      area: "Rentabilidad",
      label: "Pedidos sin precio o margen negativo",
      ok: Number(trafico.sin_precio || 0) === 0 && Number(trafico.margen_negativo || 0) === 0,
      required: false,
      severity: "alta",
      detail: `${Number(trafico.sin_precio || 0)} sin precio; ${Number(trafico.margen_negativo || 0)} con margen negativo.`,
      action: "Revisar tarifa, precio cliente y coste de colaborador.",
    },
    {
      key: "soporte_documental",
      area: "Documentacion",
      label: "Entregas recientes sin soporte",
      ok: Number(docs.entregados_sin_soporte || 0) === 0,
      required: false,
      severity: "alta",
      detail: `${Number(docs.entregados_sin_soporte || 0)} entrega(s) sin albaran/POD/CMR.`,
      action: "Solicitar soporte antes de facturar, reclamar o cerrar cobro.",
    },
    {
      key: "cobros",
      area: "Tesoreria",
      label: "Cobros a revisar",
      ok: Number(cobros.cobros_riesgo || 0) === 0 && Number(cobros.revisar_hoy || 0) === 0,
      required: false,
      severity: "media",
      detail: `${Number(cobros.cobros_riesgo || 0)} en riesgo; ${Number(cobros.revisar_hoy || 0)} a revisar hoy.`,
      action: "Revisar Seguimiento de cobros y enviar reclamaciones si procede.",
    },
    {
      key: "pagos_colaborador",
      area: "Proveedores",
      label: "Pagos/documentacion de colaboradores",
      ok: Number(pagos.pagos_vencidos || 0) === 0 && Number(pagos.facturas_pendientes || 0) === 0,
      required: false,
      severity: "media",
      detail: `${Number(pagos.facturas_pendientes || 0)} factura(s) pendiente(s); ${Number(pagos.pagos_vencidos || 0)} pago(s) vencido(s).`,
      action: "Revisar pagos a colaboradores y documentacion recibida.",
    },
    {
      key: "fiscal",
      area: "Fiscal",
      label: "Cola fiscal sin atascos",
      ok: fiscalAtascado === 0,
      required: false,
      severity: "alta",
      detail: `${fiscalAtascado} documento(s) fiscal(es) con error o atascados.`,
      action: "Reencolar o sincronizar documentos fiscales desde Facturacion/SuperAdmin.",
    },
  ];
  const bloqueantes = checks.filter(c => c.required && !c.ok);
  const avisos = checks.filter(c => !c.required && !c.ok);
  const score = Math.max(0, Math.round((checks.filter(c => c.ok).length / Math.max(1, checks.length)) * 100));
  const estado = bloqueantes.length ? "bloqueado" : avisos.length ? "atencion" : "listo";
  const acciones = [...bloqueantes, ...avisos]
    .sort((a, b) => {
      const rank = { critica: 3, alta: 2, media: 1, baja: 0 };
      return (rank[b.severity] || 0) - (rank[a.severity] || 0);
    })
    .slice(0, 8)
    .map(c => ({ key: c.key, area: c.area, label: c.label, severity: c.severity, action: c.action, detail: c.detail, required: !!c.required }));

  return {
    generated_at: new Date().toISOString(),
    objetivo: "Control diario para empezar la jornada operativa con trafico, cobros, pagos, documentacion y fiscalidad bajo control.",
    resumen: {
      score,
      estado,
      listo_para_jornada: bloqueantes.length === 0,
      bloqueantes: bloqueantes.length,
      avisos: avisos.length,
      checks_ok: checks.filter(c => c.ok).length,
      checks_total: checks.length,
    },
    metricas: {
      cargas_hoy: Number(trafico.cargas_hoy || 0),
      descargas_hoy: Number(trafico.descargas_hoy || 0),
      viajes_activos: Number(trafico.activos || 0),
      vencidos: Number(trafico.vencidos || 0),
      incidencias: Number(trafico.incidencias || 0),
      sin_asignacion: Number(trafico.sin_asignacion || 0),
      sin_precio: Number(trafico.sin_precio || 0),
      margen_negativo: Number(trafico.margen_negativo || 0),
      entregados_sin_soporte: Number(docs.entregados_sin_soporte || 0),
      cobros_riesgo: Number(cobros.cobros_riesgo || 0),
      cobros_revisar_hoy: Number(cobros.revisar_hoy || 0),
      pagos_colaborador_vencidos: Number(pagos.pagos_vencidos || 0),
      facturas_colaborador_pendientes: Number(pagos.facturas_pendientes || 0),
      fiscal_atascado: fiscalAtascado,
    },
    importes: {
      cobro_riesgo: Number(cobros.importe_riesgo || 0),
      pago_colaborador_pendiente: Number(pagos.importe_pendiente || 0),
    },
    checks,
    acciones_prioritarias: acciones,
  };
}

function buildJornadaDiariaInformeHtml(data, req) {
  const resumen = data.resumen || {};
  const metricas = data.metricas || {};
  const importes = data.importes || {};
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const acciones = Array.isArray(data.acciones_prioritarias) ? data.acciones_prioritarias : [];
  const estado = String(resumen.estado || "atencion");
  const stateClass = estado === "listo" ? "green" : estado === "bloqueado" ? "red" : "amber";
  const rows = checks.map(check => `<tr><td><span class="${check.ok ? "green" : check.required ? "red" : "amber"}">${htmlEscape(check.ok ? "OK" : check.required ? "Bloqueante" : "Aviso")}</span></td><td>${htmlEscape(check.area)}</td><td>${htmlEscape(check.label)}</td><td>${htmlEscape(check.detail)}</td><td>${htmlEscape(check.action)}</td></tr>`).join("");
  const actionRows = acciones.map(action => `<tr><td><span class="${action.required ? "red" : "amber"}">${htmlEscape(action.severity || "-")}</span></td><td>${htmlEscape(action.area)}</td><td><strong>${htmlEscape(action.label)}</strong><br><span class="muted">${htmlEscape(action.detail)}</span></td><td>${htmlEscape(action.action)}</td></tr>`).join("");
  const metricRows = Object.entries(metricas).map(([key, value]) => `<tr><th>${htmlEscape(key.replace(/_/g, " "))}</th><td>${htmlEscape(value)}</td></tr>`).join("");
  const importeRows = Object.entries(importes).map(([key, value]) => `<tr><th>${htmlEscape(key.replace(/_/g, " "))}</th><td>${Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de jornada diaria</title>
  <style>
    body{font-family:Arial,sans-serif;color:#0f172a;margin:32px;background:#f8fafc}h1{margin:0;font-size:28px}h2{font-size:18px;margin-top:28px}.sub{color:#64748b;font-size:13px;margin-top:6px}.muted{color:#64748b;font-size:12px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:22px 0}.box{background:#fff;border:1px solid #dbe4ef;border-radius:8px;padding:13px}.metric{font-size:24px;font-weight:800}.label{font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;margin-top:4px}.green{color:#059669;font-weight:800}.amber{color:#b45309;font-weight:800}.red{color:#dc2626;font-weight:800}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe4ef;border-radius:8px;overflow:hidden;margin-top:10px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;vertical-align:top}th{background:#f1f5f9;color:#334155;text-transform:uppercase;font-size:11px}.note{background:#fff;border:1px solid #dbe4ef;border-left:4px solid #0f766e;border-radius:8px;padding:12px 14px;margin-top:18px;font-size:13px;line-height:1.5}
  </style></head><body>
  <h1>Informe de jornada diaria</h1>
  <div class="sub">Generado el ${htmlEscape(new Date(data.generated_at || Date.now()).toLocaleString("es-ES"))} por ${htmlEscape(req.user?.email || req.user?.username || "TransGest")}.</div>
  <div class="grid">
    <div class="box"><div class="metric">${htmlEscape(resumen.score || 0)}%</div><div class="label">Score jornada</div></div>
    <div class="box"><div class="metric ${stateClass}">${htmlEscape(estado)}</div><div class="label">Estado</div></div>
    <div class="box"><div class="metric ${Number(resumen.bloqueantes || 0) ? "red" : "green"}">${htmlEscape(resumen.bloqueantes || 0)}</div><div class="label">Bloqueantes</div></div>
    <div class="box"><div class="metric ${Number(resumen.avisos || 0) ? "amber" : "green"}">${htmlEscape(resumen.avisos || 0)}</div><div class="label">Avisos</div></div>
    <div class="box"><div class="metric ${stateClass}">${htmlEscape(resumen.listo_para_jornada ? "Si" : "No")}</div><div class="label">Operar hoy</div></div>
  </div>
  <div class="note">${htmlEscape(data.objetivo || "")}</div>
  <h2>Acciones prioritarias</h2><table><thead><tr><th>Prioridad</th><th>Area</th><th>Control</th><th>Accion</th></tr></thead><tbody>${actionRows || "<tr><td colspan='4'>Sin acciones pendientes.</td></tr>"}</tbody></table>
  <h2>Metricas</h2><table><tbody>${metricRows || "<tr><td>Sin metricas.</td></tr>"}</tbody></table>
  <h2>Importes</h2><table><tbody>${importeRows || "<tr><td>Sin importes.</td></tr>"}</tbody></table>
  <h2>Checks diarios</h2><table><thead><tr><th>Estado</th><th>Area</th><th>Control</th><th>Detalle</th><th>Accion</th></tr></thead><tbody>${rows || "<tr><td colspan='5'>Sin checks.</td></tr>"}</tbody></table>
  </body></html>`;
}

function normalizeEmpresaProfile(raw = {}) {
  return {
    ...EMPRESA_PROFILE_DEFAULTS,
    ...(raw && typeof raw === "object" ? raw : {}),
    plazo_pago_colaboradores: Number(raw?.plazo_pago_colaboradores || EMPRESA_PROFILE_DEFAULTS.plazo_pago_colaboradores),
    plazo_pago_clientes: Number(raw?.plazo_pago_clientes || EMPRESA_PROFILE_DEFAULTS.plazo_pago_clientes),
    paleta_colores: normalizeEmpresaPalette(raw?.paleta_colores),
  };
}

function normalizeEmpresaPalette(raw = {}) {
  const presets = {
    transgest: { accent:"#0f766e", accentLight:"#14b8a6", sidebar:"#10231f" },
    mar: { accent:"#0e7490", accentLight:"#06b6d4", sidebar:"#0f2530" },
    bosque: { accent:"#15803d", accentLight:"#22c55e", sidebar:"#10251a" },
    ambar: { accent:"#b45309", accentLight:"#f59e0b", sidebar:"#2b2112" },
    grafito: { accent:"#475569", accentLight:"#94a3b8", sidebar:"#111827" },
  };
  const cfg = raw && typeof raw === "object" ? raw : {};
  const custom = cfg.custom && typeof cfg.custom === "object" ? cfg.custom : {};
  const cleanHex = value => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim() : "";
  const requestedId = String(cfg.id || "");
  const preset = presets[requestedId] || presets.transgest;
  const clean = {
    accent: cleanHex(cfg.accent) || cleanHex(custom.accent) || preset.accent,
    accentLight: cleanHex(cfg.accentLight) || cleanHex(custom.accentLight) || preset.accentLight,
    sidebar: cleanHex(cfg.sidebar) || cleanHex(custom.sidebar) || preset.sidebar,
  };
  const matchingPresetId = Object.entries(presets).find(([, value]) => (
    value.accent.toLowerCase() === clean.accent.toLowerCase()
    && value.accentLight.toLowerCase() === clean.accentLight.toLowerCase()
    && value.sidebar.toLowerCase() === clean.sidebar.toLowerCase()
  ))?.[0];
  const id = requestedId === "custom" || !matchingPresetId ? "custom" : matchingPresetId;
  return {
    id,
    ...clean,
    custom: clean,
  };
}

function publicAppUrl(req) {
  return String(
    process.env.PUBLIC_APP_URL
    || process.env.APP_PUBLIC_URL
    || process.env.APP_URL
    || `${req.protocol}://${req.get("host")}`
    || ""
  ).replace(/\/$/, "");
}

async function buildEdiFeedAuditSummary(empresaId) {
  const { rows } = await db.query(
    `SELECT a.id, a.actor_email, a.created_at, a.detalle,
            c.nombre AS cliente_nombre
      FROM audit_log_saas a
      LEFT JOIN clientes c
         ON c.empresa_id=a.empresa_id
        AND c.id::text = NULLIF(a.detalle->>'cliente_id','')
      WHERE a.empresa_id=$1
        AND a.accion='EXPORT portal_cliente.integracion_feed'
      ORDER BY a.created_at DESC
      LIMIT 25`,
    [empresaId]
  ).catch(() => ({ rows: [] }));

  const recent = rows.slice(0, 10).map(row => {
    const detail = row.detalle && typeof row.detalle === "object" ? row.detalle : {};
    const counts = detail.counts && typeof detail.counts === "object" ? detail.counts : {};
    return {
      id: row.id,
      export_id: detail.export_id || null,
      cliente_id: detail.cliente_id || null,
      cliente_nombre: row.cliente_nombre || null,
      actor_email: row.actor_email || null,
      created_at: row.created_at,
      window_days: Number(detail.window_days || 0),
      sync_mode: detail.sync_mode || "window",
      since: detail.since || null,
      next_cursor: detail.next_cursor || null,
      shipments: Number(counts.shipments || 0),
      invoices: Number(counts.invoices || 0),
      documents: Number(counts.documents || 0),
      integrity_hash_sha256: detail.integrity_hash_sha256 || null,
      status: Number(detail.status || 200),
    };
  });
  const clientes = new Set(recent.map(item => String(item.cliente_id || "")).filter(Boolean));
  const shipments = recent.reduce((sum, item) => sum + Number(item.shipments || 0), 0);
  const invoices = recent.reduce((sum, item) => sum + Number(item.invoices || 0), 0);
  const documents = recent.reduce((sum, item) => sum + Number(item.documents || 0), 0);
  const last = recent[0] || null;
  return {
    target: "portal_cliente_feed_b2b",
    active: recent.length > 0,
    total_exports_sample: rows.length,
    clientes_distintos_sample: clientes.size,
    shipments_exported_sample: shipments,
    invoices_exported_sample: invoices,
    documents_exported_sample: documents,
    last_export_at: last?.created_at || null,
    last_export_id: last?.export_id || null,
    last_integrity_hash_sha256: last?.integrity_hash_sha256 || null,
    recent,
    governance: {
      source: "audit_log_saas",
      data_scope: "metadatos_exportacion",
      includes_binary_content: false,
      includes_secrets: false,
    },
  };
}

function buildFiscalMeta(req, empresaId, configInput = {}) {
  const config = typeof configInput === "object" && configInput ? configInput : {};
  const base = publicAppUrl(req);
  const isVerifacti = config?.modo === "verifactu" && config?.verifactu?.proveedor === "verifacti";
  return {
    verifacti_webhook_url: isVerifacti ? `${base}/api/v1/fiscal/webhook/verifacti/${empresaId}` : "",
    verifacti_webhook_header: isVerifacti ? "x-verifacti-secret" : "",
    verifacti_webhook_secret_configured: !!config?.verifactu?.provider_webhook_secret,
  };
}

async function applyGlobalFiscalSoftwareMeta(configInput = {}) {
  const config = configInput && typeof configInput === "object" ? { ...configInput } : {};
  config.verifactu = {
    ...(config.verifactu || {}),
    software_nombre: await getGlobalSetting("fiscal_software_name", config?.verifactu?.software_nombre || "TransGest"),
    software_id: await getGlobalSetting("fiscal_software_id", config?.verifactu?.software_id || "transgest-tms"),
    software_version: await getGlobalSetting("app_version", config?.verifactu?.software_version || "1.0.0"),
  };
  return config;
}

// ════════════════════════════════════════════════════════════
// GASTOS DE ESTRUCTURA
// ════════════════════════════════════════════════════════════
router.get("/gastos-estructura", async (req,res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM gastos_estructura WHERE empresa_id=$1 AND activo=true ORDER BY fecha DESC, nombre",
      [EID(req)]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post("/gastos-estructura", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    const {nombre,tipo,importe,periodo,fecha,notas} = req.body;
    if (!nombre) return res.status(400).json({error:"Nombre obligatorio"});
    const {rows} = await db.query(
      "INSERT INTO gastos_estructura (empresa_id,nombre,tipo,importe,periodo,fecha,notas) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [EID(req),nombre,tipo||"Otros",importe||0,periodo||"mensual",fecha||new Date().toISOString().slice(0,7),notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put("/gastos-estructura/:id", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    const {nombre,tipo,importe,periodo,fecha,notas} = req.body;
    const {rows} = await db.query(
      "UPDATE gastos_estructura SET nombre=$1,tipo=$2,importe=$3,periodo=$4,fecha=$5,notas=$6 WHERE id=$7 AND empresa_id=$8 RETURNING *",
      [nombre,tipo,importe,periodo,fecha,notas||null,req.params.id,EID(req)]
    );
    if (!rows[0]) return res.status(404).json({error:"No encontrado"});
    res.json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete("/gastos-estructura/:id", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    await db.query("UPDATE gastos_estructura SET activo=false WHERE id=$1 AND empresa_id=$2", [req.params.id,EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Meses cerrados
router.get("/meses-cerrados", async (req,res) => {
  const {rows} = await db.query("SELECT mes FROM meses_cerrados WHERE empresa_id=$1",[EID(req)]);
  res.json(rows.map(r=>r.mes));
});
router.post("/meses-cerrados/:mes", GERENTE_O_CONTABLE, async (req,res) => {
  await db.query("INSERT INTO meses_cerrados (empresa_id,mes) VALUES ($1,$2) ON CONFLICT DO NOTHING",[EID(req),req.params.mes]);
  res.json({ok:true});
});
router.delete("/meses-cerrados/:mes", GERENTE_O_CONTABLE, async (req,res) => {
  await db.query("DELETE FROM meses_cerrados WHERE empresa_id=$1 AND mes=$2",[EID(req),req.params.mes]);
  res.json({ok:true});
});

// ════════════════════════════════════════════════════════════
// GASOIL CONFIG por vehículo
// ════════════════════════════════════════════════════════════
router.get("/gasoil-config/:vehiculo_id", async (req,res) => {
  try {
    await ensureLiquidacionChoferSchema();
    const {rows} = await db.query("SELECT * FROM vehiculo_gasoil_config WHERE vehiculo_id=$1 AND empresa_id=$2",[req.params.vehiculo_id,EID(req)]);
    res.json(rows[0] || {tipo:"fijo",precio_fijo:1.65,periodos:[]});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/gasoil-config/:vehiculo_id", async (req,res) => {
  try {
    await ensureLiquidacionChoferSchema();
    const vehiculo = await db.query("SELECT id FROM vehiculos WHERE id=$1 AND empresa_id=$2", [req.params.vehiculo_id, EID(req)]);
    if (!vehiculo.rows[0]) return res.status(404).json({ error:"Vehiculo no encontrado" });
    const {tipo,precio_fijo,periodos} = req.body;
    await db.query(
      `INSERT INTO vehiculo_gasoil_config (vehiculo_id,empresa_id,tipo,precio_fijo,periodos,updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (vehiculo_id) DO UPDATE SET tipo=$3,precio_fijo=$4,periodos=$5,updated_at=NOW()`,
      [req.params.vehiculo_id,EID(req),tipo||"fijo",precio_fijo||1.65,JSON.stringify(periodos||[])]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// REPOSTAJES
// ════════════════════════════════════════════════════════════
router.get("/repostajes/:vehiculo_id", async (req,res) => {
  try {
    await ensureLiquidacionChoferSchema();
    const {rows} = await db.query(
      "SELECT * FROM vehiculo_repostajes WHERE vehiculo_id=$1 AND empresa_id=$2 ORDER BY fecha DESC",
      [req.params.vehiculo_id,EID(req)]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post("/repostajes/:vehiculo_id", async (req,res) => {
  try {
    await ensureLiquidacionChoferSchema();
    const {fecha,litros,precio_litro,importe,km_odometro,notas} = req.body;
    const {rows} = await db.query(
      "INSERT INTO vehiculo_repostajes (vehiculo_id,empresa_id,fecha,litros,precio_litro,importe,km_odometro,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [req.params.vehiculo_id,EID(req),fecha,litros||0,precio_litro||null,importe||null,km_odometro||null,notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/repostajes/:id", async (req,res) => {
  await db.query("DELETE FROM vehiculo_repostajes WHERE id=$1 AND empresa_id=$2",[req.params.id,EID(req)]);
  res.json({ok:true});
});

// ════════════════════════════════════════════════════════════
// NOCHES / DIETAS
// ════════════════════════════════════════════════════════════
router.get("/noches/:vehiculo_id", async (req,res) => {
  try {
    await ensureLiquidacionChoferSchema();
    const {desde,hasta} = req.query;
    let q = "SELECT n.*, ch.nombre AS chofer_nombre FROM vehiculo_noches n LEFT JOIN choferes ch ON ch.id=n.chofer_id AND ch.empresa_id=n.empresa_id WHERE n.vehiculo_id=$1 AND n.empresa_id=$2";
    const params = [req.params.vehiculo_id,EID(req)];
    if (desde) { q += ` AND n.fecha>=$${params.length+1}`; params.push(desde); }
    if (hasta) { q += ` AND n.fecha<=$${params.length+1}`; params.push(hasta); }
    q += " ORDER BY n.fecha DESC";
    const {rows} = await db.query(q,params);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post("/noches/:vehiculo_id", async (req,res) => {
  try {
    await ensureLiquidacionChoferSchema();
    const {fecha,chofer_id,pedido_id,ciudad,importe,notas,tipo_dieta} = req.body;
    const {rows} = await db.query(
      "INSERT INTO vehiculo_noches (vehiculo_id,empresa_id,fecha,chofer_id,pedido_id,ciudad,importe,notas,tipo_dieta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [req.params.vehiculo_id,EID(req),fecha,chofer_id||null,pedido_id||null,ciudad||null,importe||0,notas||null,tipo_dieta||"nacional"]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/noches/:id", async (req,res) => {
  await db.query("DELETE FROM vehiculo_noches WHERE id=$1 AND empresa_id=$2",[req.params.id,EID(req)]);
  res.json({ok:true});
});

router.get("/chofer-jornadas/:chofer_id", async (req,res) => {
  try {
    await ensureChoferJornadasSchema();
    const empresaId = EID(req);
    const { chofer_id } = req.params;
    const { desde, hasta } = req.query;
    const belongs = await db.query("SELECT id FROM choferes WHERE id=$1 AND empresa_id=$2", [chofer_id, empresaId]);
    if (!belongs.rows[0]) return res.status(404).json({ error: "Chofer no encontrado" });

    let q = `
      SELECT j.*,
             v.matricula AS vehiculo_matricula,
             CASE
               WHEN j.km_inicio IS NOT NULL AND j.km_fin IS NOT NULL AND j.km_fin >= j.km_inicio
               THEN j.km_fin - j.km_inicio
               ELSE NULL
             END AS km_jornada
      FROM chofer_jornadas j
      LEFT JOIN vehiculos v ON v.id=j.vehiculo_id AND v.empresa_id=j.empresa_id
      WHERE j.empresa_id=$1 AND j.chofer_id=$2
    `;
    const params = [empresaId, chofer_id];
    if (desde) { q += ` AND j.inicio_at::date >= $${params.length + 1}`; params.push(desde); }
    if (hasta) { q += ` AND j.inicio_at::date <= $${params.length + 1}`; params.push(hasta); }
    q += " ORDER BY j.inicio_at DESC";
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/km-vacio/:vehiculo_id", async (req,res) => {
  try {
    const { desde, hasta } = req.query;
    let q = "SELECT * FROM vehiculo_km_vacio WHERE vehiculo_id=$1 AND empresa_id=$2";
    const params = [req.params.vehiculo_id, EID(req)];
    if (desde) { q += ` AND fecha>=$${params.length+1}`; params.push(desde); }
    if (hasta) { q += ` AND fecha<=$${params.length+1}`; params.push(hasta); }
    q += " ORDER BY fecha DESC, created_at DESC";
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post("/km-vacio/:vehiculo_id", async (req,res) => {
  try {
    const { fecha, km_vacio, origen, destino, motivo, notas } = req.body || {};
    const { rows } = await db.query(
      `INSERT INTO vehiculo_km_vacio
        (vehiculo_id,empresa_id,fecha,km_vacio,origen,destino,motivo,notas,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [req.params.vehiculo_id, EID(req), fecha, km_vacio || 0, origen || null, destino || null, motivo || null, notas || null, req.user?.id || null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/km-vacio/:id", async (req,res) => {
  await db.query("DELETE FROM vehiculo_km_vacio WHERE id=$1 AND empresa_id=$2",[req.params.id,EID(req)]);
  res.json({ok:true});
});

// ════════════════════════════════════════════════════════════
// CONFIGURACIÓN CHÓFER
// ════════════════════════════════════════════════════════════
router.get("/chofer-config/:chofer_id", async (req,res) => {
  try {
    await ensureLiquidacionChoferSchema();
    const chofer = await assertChoferEmpresa(req.params.chofer_id, EID(req));
    if (!chofer) return res.status(404).json({ error: "Chofer no encontrado" });
    const {rows} = await db.query("SELECT * FROM chofer_config WHERE chofer_id=$1 AND empresa_id=$2",[req.params.chofer_id, EID(req)]);
    res.json(rows[0] || {salario_base:0,precio_noche:40,plus_actividad:0,incentivo_pct:0,irpf_pct:0,ss_empresa_pct:29.9,ss_trabajador_pct:6.35,precio_km:0,km_pago_tipo:"todos",dieta_local:0,dieta_nacional:40,dieta_internacional:0,disponibilidad_diaria:0,disponibilidad_mensual:0,convenio:"",convenio_notas:"",convenio_importado_nombre:""});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/chofer-config/:chofer_id", async (req,res) => {
  try {
    await ensureLiquidacionChoferSchema();
    const chofer = await assertChoferEmpresa(req.params.chofer_id, EID(req));
    if (!chofer) return res.status(404).json({ error: "Chofer no encontrado" });
    const {salario_base,precio_noche,plus_actividad,irpf_pct,ss_empresa_pct,ss_trabajador_pct,convenio,incentivo_pct,precio_km,km_pago_tipo,dieta_local,dieta_nacional,dieta_internacional,disponibilidad_diaria,disponibilidad_mensual,convenio_notas,convenio_importado_nombre} = req.body;
    await db.query(
      `INSERT INTO chofer_config (chofer_id,empresa_id,salario_base,precio_noche,plus_actividad,irpf_pct,ss_empresa_pct,ss_trabajador_pct,convenio,incentivo_pct,
        precio_km,km_pago_tipo,dieta_local,dieta_nacional,dieta_internacional,disponibilidad_diaria,disponibilidad_mensual,convenio_notas,convenio_importado_nombre,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
       ON CONFLICT (chofer_id) DO UPDATE SET salario_base=$3,precio_noche=$4,plus_actividad=$5,irpf_pct=$6,ss_empresa_pct=$7,ss_trabajador_pct=$8,convenio=$9,incentivo_pct=$10,
         precio_km=$11,km_pago_tipo=$12,dieta_local=$13,dieta_nacional=$14,dieta_internacional=$15,disponibilidad_diaria=$16,disponibilidad_mensual=$17,convenio_notas=$18,convenio_importado_nombre=$19,updated_at=NOW()`,
      [req.params.chofer_id,EID(req),salario_base||null,precio_noche||40,plus_actividad||0,irpf_pct||0,ss_empresa_pct||29.9,ss_trabajador_pct||6.35,convenio||null,incentivo_pct||0,
       precio_km||0,["todos","cargado","vacio"].includes(km_pago_tipo)?km_pago_tipo:"todos",dieta_local||0,dieta_nacional||precio_noche||40,dieta_internacional||0,disponibilidad_diaria||0,disponibilidad_mensual||0,convenio_notas||null,convenio_importado_nombre||null]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// NÓMINAS EMITIDAS
// ════════════════════════════════════════════════════════════
router.get("/nominas-emitidas", async (req,res) => {
  try {
    await ensureNominasSchema();
    const {chofer_id} = req.query;
    if (chofer_id && !await assertChoferEmpresa(chofer_id, EID(req))) {
      return res.status(404).json({ error: "Chofer no encontrado" });
    }
    let q = `SELECT n.*, ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos
             FROM nominas_emitidas n
             LEFT JOIN choferes ch ON ch.id=n.chofer_id AND ch.empresa_id=n.empresa_id
             WHERE n.empresa_id=$1`;
    const params = [EID(req)];
    if (chofer_id) { q += " AND n.chofer_id=$2"; params.push(chofer_id); }
    q += " ORDER BY n.periodo DESC, ch.nombre";
    const {rows} = await db.query(q,params);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post("/nominas-emitidas", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    await ensureNominasSchema();
    const {chofer_id,periodo,salario_base,plus_actividad,horas_extra,noches,importe_noches,
           ss_empresa,ss_trabajador,irpf,liquido,total_empresa,notas} = req.body;
    if (!await assertChoferEmpresa(chofer_id, EID(req))) {
      return res.status(404).json({ error: "Chofer no encontrado" });
    }
    const {rows} = await db.query(
      `INSERT INTO nominas_emitidas (empresa_id,chofer_id,periodo,salario_base,plus_actividad,horas_extra,
        noches,importe_noches,ss_empresa,ss_trabajador,irpf,liquido,total_empresa,notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (empresa_id,chofer_id,periodo) DO UPDATE SET
         salario_base=$4,plus_actividad=$5,horas_extra=$6,noches=$7,importe_noches=$8,
         ss_empresa=$9,ss_trabajador=$10,irpf=$11,liquido=$12,total_empresa=$13,notas=$14,
         emitida_at=NOW()
       RETURNING *`,
      [EID(req),chofer_id,periodo,salario_base||0,plus_actividad||0,horas_extra||0,
       noches||0,importe_noches||0,ss_empresa||0,ss_trabajador||0,irpf||0,liquido||0,total_empresa||0,notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/nominas-emitidas/:id", GERENTE_O_CONTABLE, async (req,res) => {
  await ensureNominasSchema();
  await db.query("DELETE FROM nominas_emitidas WHERE id=$1 AND empresa_id=$2",[req.params.id,EID(req)]);
  res.json({ok:true});
});

// ════════════════════════════════════════════════════════════
// OBJETIVOS KPI
// ════════════════════════════════════════════════════════════
router.get("/objetivos", async (req,res) => {
  try {
    const {rows} = await db.query("SELECT * FROM objetivos_kpi WHERE empresa_id=$1",[EID(req)]);
    // Return as object keyed by periodo
    const result = {};
    rows.forEach(r => { result[r.periodo] = r; });
    res.json(result);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/objetivos/:periodo", SOLO_GERENTE, async (req,res) => {
  try {
    const {facturacion,km_totales,pct_km_vacio,pedidos,coste_taller,margen} = req.body;
    await db.query(
      `INSERT INTO objetivos_kpi (empresa_id,periodo,facturacion,km_totales,pct_km_vacio,pedidos,coste_taller,margen,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (empresa_id,periodo) DO UPDATE SET
         facturacion=$3,km_totales=$4,pct_km_vacio=$5,pedidos=$6,coste_taller=$7,margen=$8,updated_at=NOW()`,
      [EID(req),req.params.periodo,facturacion||null,km_totales||null,pct_km_vacio||null,pedidos||null,coste_taller||null,margen||null]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// CONFIGURACIÓN EMPRESA (cfg_trafico, cfg_precios, cfg_alertas)
// ════════════════════════════════════════════════════════════
router.get("/integraciones/status", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    const empresaId = EID(req);
    const [empresa, emailCfg, whatsappStatus, fiscalConfig, providers, ediCounts, ediFeedAudit] = await Promise.all([
      db.query("SELECT plan, ciclo_facturacion, stripe_customer_id, cfg_precios FROM empresas WHERE id=$1 LIMIT 1", [empresaId]).catch(() => ({ rows: [] })),
      getEmpresaEmailConfig(empresaId).catch(() => null),
      getWhatsappStatus(empresaId).catch(() => ({ provider:"meta_cloud", configured:false, ready:false, mode:"simulado" })),
      getEmpresaFiscalConfig(empresaId).catch(() => ({})),
      Promise.all([
        "here", "ors",
        "locatel", "tacogest", "movildata", "gps_generic",
        "anthropic", "openai", "ai_generic",
        "firma_electronica", "signaturit", "vidsigner", "docusign",
      ].map(provider => integrationProviderStatus(empresaId, provider))),
      db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM clientes WHERE empresa_id=$1 AND COALESCE(activo,true)=true) AS clientes,
          (SELECT COUNT(*)::int FROM clientes WHERE empresa_id=$1 AND COALESCE(activo,true)=true AND (NULLIF(TRIM(COALESCE(email,'')),'') IS NOT NULL OR NULLIF(TRIM(COALESCE(telefono,'')),'') IS NOT NULL)) AS clientes_contacto,
          (SELECT COUNT(DISTINCT cliente_id)::int FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text='cliente' AND cliente_id IS NOT NULL) AS clientes_portal,
          (SELECT COUNT(*)::int FROM pedidos WHERE empresa_id=$1 AND created_at >= NOW() - INTERVAL '90 days') AS pedidos_90d,
          (SELECT COUNT(*)::int
             FROM pedido_docs pd
             JOIN pedidos p ON p.id=pd.pedido_id AND p.empresa_id=pd.empresa_id
            WHERE pd.empresa_id=$1 AND p.created_at >= NOW() - INTERVAL '90 days') AS soporte_90d
      `, [empresaId]).catch(() => ({ rows: [{}] })),
      buildEdiFeedAuditSummary(empresaId),
    ]);
    const byProvider = Object.fromEntries(providers.map(item => [item.provider, item]));
    const gpsProviders = [byProvider.locatel, byProvider.tacogest, byProvider.movildata, byProvider.gps_generic];
    const iaProviders = [byProvider.anthropic, byProvider.openai, byProvider.ai_generic];
    const firmaProviders = [byProvider.firma_electronica, byProvider.signaturit, byProvider.vidsigner, byProvider.docusign];
    const perfil = normalizeEmpresaProfile(empresa.rows[0]?.cfg_precios?.empresa_perfil || empresa.rows[0]?.cfg_precios || {});
    const fiscalStatus = buildFiscalStatus(fiscalConfig || {});
    const firmaStatus = buildFirmaIntegracionStatus({ perfil, providers: firmaProviders, fiscalStatus });
    const emailConfigured = !!(emailCfg?.activo !== false && emailCfg?.smtp_host && (emailCfg?.smtp_from || emailCfg?.smtp_user));
    const ediApiStatus = buildEdiApiClienteStatus({
      perfil,
      counts: ediCounts.rows?.[0] || {},
      emailConfigured,
      fiscalStatus,
      publicUrl: publicAppUrl(req),
    });
    const routingReady = !!(byProvider.here?.configured || byProvider.ors?.configured);
    const gpsReady = gpsProviders.some(p => p?.configured && p?.activo);
    const iaReady = iaProviders.some(p => p?.configured && p?.activo);
    res.json({
      routing: { here: byProvider.here, ors: byProvider.ors, ready: routingReady },
      gps: { providers: gpsProviders, ready: gpsReady },
      ia: { providers: iaProviders, ready: iaReady },
      smtp: {
        configured: emailConfigured,
        activo: emailCfg?.activo !== false,
        host_configured: !!emailCfg?.smtp_host,
        from_configured: !!(emailCfg?.smtp_from || emailCfg?.smtp_user),
        last_test_at: emailCfg?.last_test_at || null,
        last_test_ok: emailCfg?.last_test_ok ?? null,
        password_masked: emailCfg?.smtp_pass_masked || "",
      },
      whatsapp: whatsappStatus,
      stripe: {
        configured: stripe.configured(),
        customer: !!empresa.rows[0]?.stripe_customer_id,
        plan: empresa.rows[0]?.plan || null,
        ciclo: empresa.rows[0]?.ciclo_facturacion || null,
      },
      firma: firmaStatus,
      edi_api: ediApiStatus,
      edi_feed: ediFeedAudit,
      resumen: { routing: routingReady, gps: gpsReady, ia: iaReady, smtp: emailConfigured, whatsapp: !!whatsappStatus?.ready, stripe: stripe.configured(), firma: firmaStatus.ready, edi_api: ediApiStatus.ready, edi_feed: ediFeedAudit.active },
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/puesta-marcha", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    res.json(await buildPuestaMarchaComercial(req));
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/puesta-marcha/informe", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    const data = await buildPuestaMarchaComercial(req);
    const html = buildPuestaMarchaInformeHtml(data, req);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`puesta-marcha-${new Date().toISOString().slice(0, 10)}.html`)}"`);
    res.send(html);
  } catch(e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.get("/jornada-diaria", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    res.json(await buildJornadaDiaria(req));
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/jornada-diaria/informe", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    const data = await buildJornadaDiaria(req);
    const html = buildJornadaDiariaInformeHtml(data, req);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`jornada-diaria-${new Date().toISOString().slice(0, 10)}.html`)}"`);
    res.send(html);
  } catch(e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.get("/config", async (req,res) => {
  try {
    const {rows} = await db.query(
      "SELECT cfg_trafico, cfg_precios, cfg_alertas FROM empresas WHERE id=$1",
      [EID(req)]
    );
    res.json(rows[0] || {cfg_trafico:{},cfg_precios:{},cfg_alertas:[]});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/config/trafico", async (req,res) => {
  try {
    await db.query("UPDATE empresas SET cfg_trafico=$1 WHERE id=$2",[JSON.stringify(req.body),EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/config/precios", async (req,res) => {
  try {
    const empresaId = EID(req);
    const { rows } = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1", [empresaId]);
    const prev = rows[0]?.cfg_precios && typeof rows[0].cfg_precios === "object" ? rows[0].cfg_precios : {};
    const incoming = req.body && typeof req.body === "object" ? { ...req.body } : {};
    if (prev.tesoreria || incoming.tesoreria) {
      incoming.tesoreria = {
        ...(incoming.tesoreria || {}),
        ...(prev.tesoreria || {}),
      };
    }
    await db.query("UPDATE empresas SET cfg_precios=$1 WHERE id=$2",[JSON.stringify(incoming),empresaId]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/config/tesoreria/capital", SOLO_GERENTE, async (req,res) => {
  try {
    const empresaId = EID(req);
    const capital = Number(req.body?.capital_actual);
    const gerenteConfirmacion = String(req.body?.gerente_confirmacion || "").trim().toUpperCase();
    const superEmail = String(req.body?.superadmin_email || "").trim().toLowerCase();
    const superPassword = String(req.body?.superadmin_password || "");
    const motivo = String(req.body?.motivo || "").trim();
    const origenFondos = String(req.body?.origen_fondos || "").trim();
    const documentoSoporte = String(req.body?.documento_soporte || "").trim();
    const responsableConfirmacion = String(req.body?.responsable_contable_confirmacion || "").trim().toUpperCase();
    if (!Number.isFinite(capital) || capital < 0) {
      return res.status(400).json({ error: "Saldo operativo de tesoreria invalido" });
    }
    if (gerenteConfirmacion !== "CAMBIAR CAPITAL") {
      return res.status(400).json({ error: "Falta confirmacion literal del gerente" });
    }
    if (!superEmail || !superPassword) {
      return res.status(400).json({ error: "Faltan credenciales de superadmin" });
    }
    const superRes = await db.query(
      "SELECT id,email,password_hash,rol FROM superadmins WHERE LOWER(email)=LOWER($1) AND activo=true LIMIT 1",
      [superEmail]
    );
    const superadmin = superRes.rows[0];
    if (!superadmin || superadmin.rol !== "superadmin") {
      return res.status(403).json({ error: "Superadmin no autorizado" });
    }
    const okPassword = await bcrypt.compare(superPassword, superadmin.password_hash || "");
    if (!okPassword) {
      return res.status(403).json({ error: "Credenciales de superadmin incorrectas" });
    }
    if (motivo.length < 12) {
      return res.status(400).json({ error: "Indica un motivo suficientemente claro para el ajuste de tesoreria" });
    }
    if (origenFondos.length < 4) {
      return res.status(400).json({ error: "Indica el origen o naturaleza del saldo de tesoreria" });
    }
    if (documentoSoporte.length < 4) {
      return res.status(400).json({ error: "Indica una referencia documental o soporte contable" });
    }
    if (responsableConfirmacion !== "SALDO TESORERIA") {
      return res.status(400).json({ error: "Falta confirmacion de que no se modifica capital social legal" });
    }
    const currentRes = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1", [empresaId]);
    const prevPrecios = currentRes.rows[0]?.cfg_precios && typeof currentRes.rows[0].cfg_precios === "object"
      ? currentRes.rows[0].cfg_precios
      : {};
    const prevCapital = Number(prevPrecios?.tesoreria?.capital_actual || 0);
    const historialPrevio = Array.isArray(prevPrecios?.tesoreria?.historial_saldos)
      ? prevPrecios.tesoreria.historial_saldos
      : [];
    const movimiento = {
      tipo: "saldo_tesoreria_operativo_no_capital_social",
      anterior: prevCapital,
      nuevo: capital,
      motivo,
      origen_fondos: origenFondos,
      documento_soporte: documentoSoporte,
      gerente_email: req.user?.email || req.user?.username || null,
      superadmin_email: superadmin.email,
      created_at: new Date().toISOString(),
      ip: req.ip,
    };
    const nextPrecios = {
      ...prevPrecios,
      tesoreria: {
        ...(prevPrecios.tesoreria || {}),
        capital_actual: capital,
        capital_tipo: "saldo_tesoreria_operativo_no_capital_social",
        capital_advertencia: "Saldo interno de tesoreria para prevision de caja/bancos. No modifica capital social ni sustituye contabilidad oficial.",
        capital_actual_at: new Date().toISOString(),
        capital_actual_by: req.user?.email || req.user?.username || null,
        capital_actual_superadmin_by: superadmin.email,
        capital_actual_motivo: motivo,
        capital_actual_origen_fondos: origenFondos,
        capital_actual_documento_soporte: documentoSoporte,
        historial_saldos: [...historialPrevio.slice(-49), movimiento],
      },
    };
    await db.query("UPDATE empresas SET cfg_precios=$1 WHERE id=$2", [JSON.stringify(nextPrecios), empresaId]);
    await db.query(
      `INSERT INTO audit_log_saas (actor_tipo, actor_id, actor_email, empresa_id, accion, detalle, ip)
       VALUES ('usuario', $1, $2, $3, 'empresa.tesoreria.capital_actual', $4::jsonb, $5)`,
      [
        req.user?.id || null,
        req.user?.email || req.user?.username || null,
        empresaId,
        JSON.stringify(movimiento),
        req.ip,
      ]
    ).catch(() => {});
    res.json({ ok:true, tesoreria: nextPrecios.tesoreria });
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.get("/config/alertas", async (req,res) => {
  try {
    const {rows} = await db.query("SELECT cfg_alertas FROM empresas WHERE id=$1",[EID(req)]);
    res.json(rows[0]?.cfg_alertas || []);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/config/alertas", async (req,res) => {
  try {
    await db.query("UPDATE empresas SET cfg_alertas=$1 WHERE id=$2",[JSON.stringify(req.body),EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/calendario-laboral", async (req,res) => {
  try {
    const empresaId = EID(req);
    const year = normalizeYear(req.query.year);
    const force = ["1", "true", "yes"].includes(String(req.query.force || "").toLowerCase());
    const { rows } = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1", [empresaId]);
    const cfg = rows[0]?.cfg_precios && typeof rows[0].cfg_precios === "object" ? rows[0].cfg_precios : {};
    const preferredCcaa = req.query.ccaa || cfg.calendario_laboral_ccaa || cfg.calendario_laboral_default_ccaa;
    const ccaa = normalizeCcaa(preferredCcaa);
    const cacheKey = `${year}_${ccaa}`;
    const compatCacheKey = `${year}:${ccaa}`;
    const calendarCache = cfg.calendario_laboral_cache && typeof cfg.calendario_laboral_cache === "object" ? cfg.calendario_laboral_cache : {};
    const cached = calendarCache[cacheKey] || calendarCache[compatCacheKey];
    const fetchedAt = cached?.updated_at ? new Date(cached.updated_at) : null;
    const ageMs = fetchedAt && !Number.isNaN(fetchedAt.getTime()) ? Date.now() - fetchedAt.getTime() : Infinity;
    const fresh = ageMs < 1000 * 60 * 60 * 24 * 30;

    if (!force && cached?.holidays && fresh) {
      return res.json(buildCalendarResponse({
        year,
        ccaa,
        holidays: cached.holidays,
        fuente: cached.fuente || "cache",
        updatedAt: cached.updated_at,
        cache: true,
        warnings: cached.warnings || [],
      }));
    }

    let fetched;
    try {
      fetched = await fetchSpainHolidays(year, ccaa);
    } catch (err) {
      fetched = {
        fuente: "fallback",
        warnings: [`No se pudo actualizar desde la API externa: ${err.message}`],
        holidays: fallbackSpanishHolidays(year),
      };
    }

    const next = buildCalendarResponse({
      year,
      ccaa,
      holidays: fetched.holidays,
      fuente: fetched.fuente,
      updatedAt: new Date().toISOString(),
      cache: false,
      warnings: fetched.warnings,
    });
    const nextCfg = {
      ...cfg,
      calendario_laboral_cache: {
        ...calendarCache,
        [cacheKey]: {
          fuente: next.fuente,
          updated_at: next.updated_at,
          warnings: next.warnings,
          holidays: next.holidays,
        },
        [compatCacheKey]: {
          fuente: next.fuente,
          updated_at: next.updated_at,
          warnings: next.warnings,
          holidays: next.holidays,
        },
      },
    };
    await db.query("UPDATE empresas SET cfg_precios=$1 WHERE id=$2", [JSON.stringify(nextCfg), empresaId]).catch(() => {});
    res.json(next);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/calendario-laboral/ccaa", async (_req,res) => {
  res.json(CCAA);
});

router.get("/perfil", async (req,res) => {
  try {
    const { rows } = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1", [EID(req)]);
    const cfgPrecios = rows[0]?.cfg_precios || {};
    const perfil = normalizeEmpresaProfile(cfgPrecios?.empresa_perfil || cfgPrecios);
    res.json(perfil);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put("/perfil", SOLO_GERENTE, async (req,res) => {
  try {
    const perfil = normalizeEmpresaProfile(req.body || {});
    const planRes = await db.query("SELECT plan FROM empresas WHERE id=$1", [EID(req)]).catch(() => ({ rows: [] }));
    const plan = String(planRes.rows[0]?.plan || "").toLowerCase();
    if (!["profesional", "enterprise", "premium"].includes(plan)) {
      perfil.paleta_colores = normalizeEmpresaPalette({ id:"transgest" });
    }
    const { rows } = await db.query(
      `UPDATE empresas
          SET cfg_precios = jsonb_set(COALESCE(cfg_precios,'{}'::jsonb), '{empresa_perfil}', $1::jsonb, true)
        WHERE id=$2
      RETURNING cfg_precios->'empresa_perfil' AS empresa_perfil`,
      [JSON.stringify(perfil), EID(req)]
    );
    res.json({ ok:true, perfil: normalizeEmpresaProfile(rows[0]?.empresa_perfil || perfil) });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/fiscal-config", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    const config = await applyGlobalFiscalSoftwareMeta(await getEmpresaFiscalConfig(EID(req)));
    res.json({ config: sanitizeFiscalConfigForClient(config), status: buildFiscalStatus(config), meta: buildFiscalMeta(req, EID(req), config) });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put("/fiscal-config", SOLO_GERENTE, async (req,res) => {
  try {
    const config = await applyGlobalFiscalSoftwareMeta(await saveEmpresaFiscalConfig(EID(req), req.body || {}));
    res.json({ ok:true, config: sanitizeFiscalConfigForClient(config), status: buildFiscalStatus(config), meta: buildFiscalMeta(req, EID(req), config) });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post("/fiscal-config/test", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    const empresaId = EID(req);
    const config = await applyGlobalFiscalSoftwareMeta(await getEmpresaFiscalConfig(empresaId));
    const test = await testFiscalConnection(config);
    const savedConfig = await applyGlobalFiscalSoftwareMeta(await saveEmpresaFiscalTestResult(empresaId, test));
    res.json({
      ok: true,
      config: sanitizeFiscalConfigForClient(savedConfig),
      status: buildFiscalStatus(savedConfig),
      meta: buildFiscalMeta(req, empresaId, savedConfig),
      test,
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/fiscal-config/queue-summary", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    const empresaId = EID(req);
    const summary = await getEmpresaFiscalQueueSummary(empresaId);
    res.json(summary);
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;

// ════════════════════════════════════════════════════════════
// LOGO EMPRESA
// ════════════════════════════════════════════════════════════
router.post("/logo", async (req,res) => {
  try {
    const { logo_base64, logo_mime } = req.body;
    if (!logo_base64) return res.status(400).json({error:"Falta logo_base64"});
    const upload = validateBase64Upload({ data: logo_base64, mime: logo_mime, maxBytes: 500 * 1024, allowedMimes: IMAGE_MIMES });
    await db.query(
      "UPDATE empresas SET logo_base64=$1, cfg_precios=jsonb_set(COALESCE(cfg_precios,'{}'),'{logo_mime}',$2) WHERE id=$3",
      [upload.base64, JSON.stringify(upload.mime), EID(req)]
    );
    res.json({ok:true, logo_base64: upload.base64});
  } catch(e) { res.status(e.status || 500).json({error:e.message}); }
});

router.delete("/logo", async (req,res) => {
  try {
    await db.query("UPDATE empresas SET logo_base64=NULL WHERE id=$1",[EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/logo", async (req,res) => {
  try {
    const {rows} = await db.query("SELECT logo_base64, cfg_precios->>'logo_mime' AS logo_mime FROM empresas WHERE id=$1",[EID(req)]);
    res.json({logo_base64: rows[0]?.logo_base64||null, logo_mime: rows[0]?.logo_mime||"image/png"});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// DOCUMENTOS DE PEDIDO
// ════════════════════════════════════════════════════════════
router.get("/pedido-docs/:pedido_id", async (req,res) => {
  try {
    const {rows} = await db.query(
      "SELECT id,nombre,tipo,file_mime,file_size_kb,notas,created_at FROM pedido_docs WHERE pedido_id=$1 AND empresa_id=$2 ORDER BY created_at",
      [req.params.pedido_id,EID(req)]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET con base64 para un doc específico (para generar PDF adjunto)
router.get("/pedido-docs/:pedido_id/base64", async (req,res) => {
  try {
    const {rows} = await db.query(
      "SELECT * FROM pedido_docs WHERE pedido_id=$1 AND empresa_id=$2 ORDER BY created_at",
      [req.params.pedido_id,EID(req)]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post("/pedido-docs/:pedido_id", async (req,res) => {
  try {
    const {nombre,tipo,file_base64,file_mime,file_size_kb,notas} = req.body;
    if (!nombre || !file_base64) return res.status(400).json({error:"Faltan nombre o archivo"});
    const upload = validateBase64Upload({ data: file_base64, mime: file_mime, filename: nombre });
    const {rows} = await db.query(
      "INSERT INTO pedido_docs (pedido_id,empresa_id,nombre,tipo,file_base64,file_mime,file_size_kb,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,nombre,tipo,file_mime,file_size_kb,created_at",
      [req.params.pedido_id,EID(req),nombre,tipo||"otro",upload.base64,upload.mime,Math.ceil(upload.sizeBytes/1024),notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(e.status || 500).json({error:e.message}); }
});

router.delete("/pedido-docs/:doc_id", async (req,res) => {
  try {
    await db.query("DELETE FROM pedido_docs WHERE id=$1 AND empresa_id=$2",[req.params.doc_id,EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// PERIODOS TRACTORA POR CHÓFER
// ════════════════════════════════════════════════════════════
router.get("/tractora-periodos/:chofer_id", async (req,res) => {
  try {
    const empresaId = EID(req);
    const {rows} = await db.query(
      `SELECT p.*, v.matricula AS veh_matricula, v.marca, v.modelo,
              r.matricula AS rem_matricula
       FROM chofer_tractora_periodos p
       LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
       LEFT JOIN vehiculos r ON r.id=p.remolque_id AND r.empresa_id=p.empresa_id
       WHERE p.chofer_id=$1 AND p.empresa_id=$2
       ORDER BY p.fecha_inicio DESC`,
      [req.params.chofer_id, empresaId]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post("/tractora-periodos", async (req,res) => {
  try {
    const empresaId = EID(req);
    const {chofer_id,vehiculo_id,remolque_id,fecha_inicio,fecha_fin,notas} = req.body;
    const [chofer, vehiculo, remolque] = await Promise.all([
      db.query("SELECT id FROM choferes WHERE id=$1 AND empresa_id=$2", [chofer_id, empresaId]),
      db.query("SELECT id FROM vehiculos WHERE id=$1 AND empresa_id=$2", [vehiculo_id, empresaId]),
      remolque_id ? db.query("SELECT id FROM vehiculos WHERE id=$1 AND empresa_id=$2", [remolque_id, empresaId]) : Promise.resolve({ rows: [null] }),
    ]);
    if (!chofer.rows[0]) return res.status(404).json({ error: "Chofer no encontrado" });
    if (!vehiculo.rows[0]) return res.status(404).json({ error: "Vehiculo no encontrado" });
    if (remolque_id && !remolque.rows[0]) return res.status(404).json({ error: "Remolque no encontrado" });

    // Cerrar período activo anterior para esta tractora+chófer
    await db.query(
      "UPDATE chofer_tractora_periodos SET fecha_fin=$1 WHERE chofer_id=$2 AND vehiculo_id=$3 AND empresa_id=$4 AND fecha_fin IS NULL",
      [fecha_inicio, chofer_id, vehiculo_id, empresaId]
    );
    const {rows} = await db.query(
      `INSERT INTO chofer_tractora_periodos (chofer_id,vehiculo_id,remolque_id,empresa_id,fecha_inicio,fecha_fin,notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [chofer_id,vehiculo_id,remolque_id||null,empresaId,fecha_inicio||new Date().toISOString().slice(0,10),fecha_fin||null,notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Docs de varios pedidos a la vez (para generar PDF adjunto de factura)
router.post("/pedido-docs-bulk", async (req,res) => {
  try {
    const {pedido_ids} = req.body;
    if (!Array.isArray(pedido_ids)||!pedido_ids.length) return res.json([]);
    const placeholders = pedido_ids.map((_,i)=>`$${i+2}`).join(",");
    const {rows} = await db.query(
      `SELECT d.*, p.numero AS pedido_numero, p.origen, p.destino
       FROM pedido_docs d
       JOIN pedidos p ON p.id=d.pedido_id
       WHERE d.pedido_id IN (${placeholders}) AND d.empresa_id=$1
       ORDER BY p.numero, d.tipo, d.created_at`,
      [EID(req), ...pedido_ids]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
