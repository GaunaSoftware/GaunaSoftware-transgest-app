const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const crypto   = require("crypto");
const db       = require("../services/db");
const logger   = require("../services/logger");
const { enviarEmail, getPlatformEmailConfig, savePlatformEmailConfig } = require("../services/email");
const stripe   = require("../services/stripe");
const { runBackup, listBackups, backupPath, getBackupStatus } = require("../services/backup");
const {
  ensureTables: ensureApiKeyTables,
  setGlobalApiKey,
  deleteGlobalApiKey,
  setCompanyApiConfig,
  publicStatusForProvider,
  getGlobalSetting,
  setGlobalSetting,
  resolveApiKey,
} = require("../services/apiKeys");
const {
  normalizeFiscalConfig,
  buildFiscalStatus,
  testFiscalConnection,
  saveEmpresaFiscalTestResult,
  saveEmpresaFiscalConfig,
  sanitizeFiscalConfigForClient,
  getEmpresaFiscalQueueSummary,
  ensureFacturaFiscalRecord,
  getEmpresaFiscalConfig,
} = require("../services/fiscal");
const { processPendingFiscalQueue } = require("../services/fiscalProcessor");
const { getVerifactiRecordStatus } = require("../services/fiscalProviderVerifacti");
const { markQueueAccepted, markQueuePending, markQueueError, logFiscalEvent } = require("../services/fiscalQueueState");
const { CCAA, buildCalendarResponse, fallbackSpanishHolidays, fetchSpainHolidays, normalizeCcaa, normalizeYear } = require("../services/calendarioLaboral");
const { userJwtSecret, superadminJwtSecret } = require("../services/jwtSecrets");
const {
  ACCOUNTING_MAPPING_ITEM_LABELS,
  buildAccountingIntegrationsGovernance,
  listCompanyAccountingIntegrationConfigs,
  summarizeCompanyAccountingSettings,
  upsertCompanyAccountingIntegrationConfig,
} = require("../services/accountingIntegrationsCatalog");
const {
  AI_PROVIDERS,
  normalizeAiProvider,
  normalizeAiModel,
  testAiProviderConnection,
} = require("../services/aiProvider");

const router = express.Router();

function appUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function extractProviderUuid(response = {}) {
  return response?.provider_uuid
    || response?.uuid
    || response?.response?.uuid
    || response?.response?.data?.uuid
    || response?.response?.registro?.uuid
    || null;
}

const PLAN_PRICES = { lite: 49, basico: 99, profesional: 199, enterprise: 399 };
const API_PROVIDERS = ["here", "ors", "anthropic", "openai", "ai_generic", "locatel", "tacogest", "movildata", "gps_generic"];
const GPS_PROVIDERS = ["locatel", "tacogest", "movildata", "gps_generic"];
const APP_META_DEFAULTS = {
  brand_name: "TransGest",
  version_name: "TMS",
  version: "1.0.0",
  fiscal_software_name: "TransGest",
  fiscal_software_id: "transgest-tms",
};

function listFromProviderPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "Data", "items", "Items", "result", "Result", "vehiculos", "Vehiculos", "vehicles", "Vehicles"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.response?.data)) return payload.response.data;
  if (Array.isArray(payload?.response?.items)) return payload.response.items;
  return payload && typeof payload === "object" ? [payload] : [];
}

function gpsPlateFromItem(item = {}) {
  return String(
    item.Matricula || item["Matrícula"] || item.matricula ||
    item.MatriculaVehiculo || item.matriculaVehiculo || item.plate || item.Plate ||
    item.Placa || item.placa || item.registration || item.Registration || ""
  ).trim();
}

function isGpsProviderAuthError(message = "") {
  const text = String(message || "").toLowerCase();
  return text.includes("deneg") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("invalid api") ||
    text.includes("api key") ||
    text.includes("apikey") ||
    text.includes("no autorizado");
}

async function getGpsLinkedStats(empresaId, provider) {
  if (!empresaId || !GPS_PROVIDERS.includes(provider)) return null;
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE COALESCE(activo,true)=true)::int AS vehiculos_activos,
       COUNT(*) FILTER (
         WHERE COALESCE(activo,true)=true
           AND gps_provider=$2
           AND NULLIF(TRIM(COALESCE(gps_external_id,'')),'') IS NOT NULL
       )::int AS enlazados,
       COUNT(*) FILTER (
         WHERE COALESCE(activo,true)=true
           AND gps_provider=$2
           AND NULLIF(TRIM(COALESCE(gps_external_id,'')),'') IS NOT NULL
           AND ubicacion_ts >= NOW()-INTERVAL '6 hours'
       )::int AS con_senal_reciente
     FROM vehiculos
     WHERE empresa_id=$1`,
    [empresaId, provider]
  );
  return rows[0] || null;
}

async function requestMovildataAdmin(path, apiKey, params = {}, options = {}) {
  const url = new URL(path, "https://mapi.movildata.com/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("apiKey", apiKey);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const timeoutMs = Math.max(3000, Number(options.timeout_ms || options.timeoutMs || 15000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw_text: text }; }
    const message = data?.Message || data?.message || data?.error || data?.Error ||
      (typeof text === "string" && text.length < 500 ? text : "");
    if (!res.ok || isGpsProviderAuthError(message)) {
      const err = new Error(message || `Movildata respondio HTTP ${res.status}.`);
      err.http_status = res.status;
      err.payload = data;
      throw err;
    }
    return { data, http_status: res.status };
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error(`Movildata no respondio en ${Math.round(timeoutMs / 1000)} segundos.`);
      err.http_status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

async function testGpsProviderConnection(provider, apiKey, empresaId = null) {
  if (!apiKey) return { ok: false, message: "Falta clave API." };
  if (provider === "movildata") {
    const linkedStats = await getGpsLinkedStats(empresaId, provider).catch(() => null);
    let vehiclesResult = null;
    try {
      vehiclesResult = await requestMovildataAdmin("Users/GetVehiculos", apiKey);
    } catch (e) {
      return {
        ok: false,
        provider,
        pull_supported: true,
        auth_error: isGpsProviderAuthError(e.message),
        http_status: e.http_status || null,
        linked_vehicles: Number(linkedStats?.enlazados || 0),
        active_vehicles: Number(linkedStats?.vehiculos_activos || 0),
        recent_signal_vehicles: Number(linkedStats?.con_senal_reciente || 0),
        message: e.message || "Movildata ha denegado la consulta de vehiculos.",
      };
    }
    const vehicles = listFromProviderPayload(vehiclesResult.data);
    const plates = vehicles.map(gpsPlateFromItem).filter(Boolean).slice(0, 12);
    try {
      const positionsResult = await requestMovildataAdmin("Users/GetLastLocations", apiKey, { direcciones: "true" });
      const positions = listFromProviderPayload(positionsResult.data);
      return {
        ok: true,
        provider,
        pull_supported: true,
        remote_vehicles: vehicles.length,
        remote_positions: positions.length,
        sample_plates: plates,
        linked_vehicles: Number(linkedStats?.enlazados || 0),
        active_vehicles: Number(linkedStats?.vehiculos_activos || 0),
        recent_signal_vehicles: Number(linkedStats?.con_senal_reciente || 0),
        positions_ok: true,
        positions_message: positions.length
          ? `${positions.length} posicion(es) recibidas desde Movildata.`
          : "Movildata no ha devuelto posiciones en esta prueba.",
        message: `Movildata conectado: ${vehicles.length} vehiculo(s) y ${positions.length} posicion(es) recibidos${plates.length ? ` (${plates.join(", ")})` : ""}.`,
      };
    } catch (e) {
      let fallbackPositions = [];
      let fallbackMessage = "";
      if (plates[0]) {
        try {
          const fallback = await requestMovildataAdmin("Users/GetLastLocationPlate", apiKey, { plate: plates[0] }, { timeoutMs: 10000 });
          fallbackPositions = listFromProviderPayload(fallback.data);
          fallbackMessage = fallbackPositions.length
            ? ` Endpoint masivo no disponible, pero GetLastLocationPlate responde para ${plates[0]}.`
            : ` Endpoint masivo no disponible y GetLastLocationPlate no devolvio posicion para ${plates[0]}.`;
        } catch (fallbackError) {
          fallbackMessage = ` Endpoint masivo no disponible y la prueba por matricula tambien fallo: ${fallbackError.message || "sin detalle"}.`;
        }
      }
      return {
        ok: fallbackPositions.length > 0,
        provider,
        pull_supported: true,
        auth_error: isGpsProviderAuthError(e.message),
        http_status: e.http_status || vehiclesResult.http_status || null,
        remote_vehicles: vehicles.length,
        remote_positions: fallbackPositions.length,
        sample_plates: plates,
        linked_vehicles: Number(linkedStats?.enlazados || 0),
        active_vehicles: Number(linkedStats?.vehiculos_activos || 0),
        recent_signal_vehicles: Number(linkedStats?.con_senal_reciente || 0),
        positions_ok: fallbackPositions.length > 0,
        positions_message: `${e.message || "Movildata ha denegado la consulta masiva de posiciones."}${fallbackMessage}`,
        message: fallbackPositions.length > 0
          ? `Movildata conectado parcialmente: ${vehicles.length} vehiculo(s), posicion por matricula operativa para ${plates[0]}. Solicita a Movildata activar Users/GetLastLocations para sincronizacion masiva.`
          : `Movildata responde a vehiculos (${vehicles.length}), pero no permite leer posiciones con esta clave API: ${e.message || "permiso denegado"}.${fallbackMessage}`,
      };
    }
  }
  if (GPS_PROVIDERS.includes(provider)) {
    const linkedStats = await getGpsLinkedStats(empresaId, provider).catch(() => null);
    return {
      ok: true,
      provider,
      pull_supported: false,
      remote_vehicles: null,
      linked_vehicles: Number(linkedStats?.enlazados || 0),
      active_vehicles: Number(linkedStats?.vehiculos_activos || 0),
      recent_signal_vehicles: Number(linkedStats?.con_senal_reciente || 0),
      message: "Clave configurada. Este proveedor queda listo por webhook o por mapeo de endpoint especifico.",
    };
  }
  return { ok: true, provider, message: "Clave configurada." };
}

function integrationCheck({ key, area, label, ok = false, required = true, warnings = [], detail = "", action = "" }) {
  const cleanWarnings = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  const estado = ok ? (cleanWarnings.length ? "warning" : "ok") : (required ? "blocked" : "warning");
  return {
    key,
    area,
    label,
    ok: !!ok,
    required: !!required,
    estado,
    detail,
    warnings: cleanWarnings,
    action,
  };
}

function summarizeIntegrationChecks(checks = []) {
  const total = checks.length || 1;
  const ok = checks.filter(c => c.estado === "ok").length;
  const warnings = checks.filter(c => c.estado === "warning").length;
  const blocked = checks.filter(c => c.estado === "blocked").length;
  const score = Math.max(0, Math.min(100, Math.round(((ok + warnings * 0.55) / total) * 100)));
  return {
    total: checks.length,
    ok,
    warnings,
    blocked,
    score,
    estado: blocked ? "bloqueada" : warnings ? "vigilancia" : "lista",
  };
}

async function buildIntegracionesSalud() {
  await ensureApiKeyTables();
  const appMeta = await getAppMeta();
  const [{ rows: empresas }, { rows: configs }, { rows: webhooks }, vehiculoStats, gpsDuplicateRows] = await Promise.all([
    db.query("SELECT id,nombre,plan,estado,ia_limite_mensual,ia_usos_mes,ia_periodo_mes,configuracion FROM empresas ORDER BY nombre ASC"),
    db.query(`
      SELECT empresa_id, provider, key_mask, use_global, activo, limite_mensual, usos_mes, periodo_mes, updated_at
      FROM empresa_api_configs
    `),
    db.query(`
      SELECT empresa_id, provider, token_mask, activo, last_used_at, updated_at
      FROM gps_webhook_tokens
    `).catch(() => ({ rows: [] })),
    db.query(`
      SELECT empresa_id,
             COUNT(*) FILTER (WHERE activo=true)::int AS vehiculos_activos,
             COUNT(*) FILTER (WHERE activo=true AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL)::int AS gps_enlazados,
             COUNT(*) FILTER (WHERE activo=true AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND ubicacion_ts >= NOW()-INTERVAL '6 hours')::int AS gps_senal_reciente,
             COUNT(*) FILTER (WHERE activo=true AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND (ubicacion_ts IS NULL OR ubicacion_ts < NOW()-INTERVAL '6 hours'))::int AS gps_sin_senal_reciente
      FROM vehiculos
      GROUP BY empresa_id
    `).catch(() => ({ rows: [] })),
    db.query(`
      SELECT empresa_id, gps_provider, UPPER(TRIM(gps_external_id)) AS gps_external_id, COUNT(*)::int AS total
      FROM vehiculos
      WHERE gps_provider IS NOT NULL
        AND gps_provider <> 'manual'
        AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL
      GROUP BY empresa_id, gps_provider, UPPER(TRIM(gps_external_id))
      HAVING COUNT(*) > 1
    `).catch(() => ({ rows: [] })),
  ]);

  const global = {};
  for (const provider of API_PROVIDERS) global[provider] = await publicStatusForProvider(provider);
  const aiProvider = normalizeAiProvider(await getGlobalSetting("ia_provider", process.env.AI_PROVIDER || "anthropic"));
  const aiBaseUrl = String(await getGlobalSetting("ia_base_url", process.env.AI_BASE_URL || "") || "");
  const aiModel = normalizeAiModel(aiProvider, await getGlobalSetting("ia_model", process.env.AI_MODEL || ""));
  const routingProvider = String(process.env.ROUTING_PROVIDER || "local").toLowerCase();
  const validRoutingProvider = ["local", "here", "ors", ""].includes(routingProvider);
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
  const smtpPartial = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"].some(k => process.env[k]) && !smtpConfigured;
  const vehicleByEmpresa = new Map(vehiculoStats.rows.map(row => [String(row.empresa_id), row]));
  const configsByEmpresaProvider = new Map(configs.map(c => [`${c.empresa_id}:${c.provider}`, c]));
  const webhooksByEmpresaProvider = new Map(webhooks.map(w => [`${w.empresa_id}:${w.provider}`, w]));

  function providerReady(empresaId, provider) {
    const cfg = configsByEmpresaProvider.get(`${empresaId}:${provider}`);
    if (cfg && cfg.activo === false) return false;
    if (cfg?.key_mask) return true;
    if (cfg?.use_global === false) return false;
    return !!global[provider]?.global_configured;
  }

  function activeGpsProvider(empresaId) {
    return configs
      .filter(c => String(c.empresa_id) === String(empresaId) && GPS_PROVIDERS.includes(c.provider) && c.activo !== false)
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0]?.provider || "";
  }

  const empresasSalud = empresas.map(empresa => {
    const veh = vehicleByEmpresa.get(String(empresa.id)) || {};
    const gpsProvider = activeGpsProvider(empresa.id);
    const gpsWebhook = gpsProvider ? webhooksByEmpresaProvider.get(`${empresa.id}:${gpsProvider}`) : null;
    const fiscalConfig = normalizeFiscalConfig(empresa?.configuracion?.facturacion_fiscal || {});
    fiscalConfig.verifactu.software_version = appMeta.version;
    fiscalConfig.verifactu.software_nombre = appMeta.fiscal_software_name;
    fiscalConfig.verifactu.software_id = appMeta.fiscal_software_id;
    const fiscalStatus = buildFiscalStatus(fiscalConfig);
    const empresaGpsDuplicates = gpsDuplicateRows.rows.filter(r => String(r.empresa_id) === String(empresa.id)).length;
    const gpsReady = !!gpsProvider && providerReady(empresa.id, gpsProvider) && empresaGpsDuplicates === 0;
    return {
      id: empresa.id,
      nombre: empresa.nombre,
      plan: empresa.plan,
      estado: empresa.estado,
      ia_visual_ready: providerReady(empresa.id, aiProvider),
      ia_limite_mensual: Number(empresa.ia_limite_mensual || 0),
      ia_usos_mes: Number(empresa.ia_usos_mes || 0),
      routing_truck_ready: providerReady(empresa.id, "here") || providerReady(empresa.id, "ors"),
      gps_provider: gpsProvider,
      gps_ready: gpsReady,
      gps_webhook_activo: !!gpsWebhook?.activo,
      vehiculos_activos: Number(veh.vehiculos_activos || 0),
      gps_enlazados: Number(veh.gps_enlazados || 0),
      gps_senal_reciente: Number(veh.gps_senal_reciente || 0),
      gps_sin_senal_reciente: Number(veh.gps_sin_senal_reciente || 0),
      gps_ids_duplicados: empresaGpsDuplicates,
      fiscal_level: fiscalStatus.level,
      fiscal_production_ready: !!fiscalStatus.production_ready,
    };
  });

  const aiVisualReadyCompanies = empresasSalud.filter(e => e.ia_visual_ready).length;
  const routingTruckReadyCompanies = empresasSalud.filter(e => e.routing_truck_ready).length;
  const gpsReadyCompanies = empresasSalud.filter(e => e.gps_ready).length;
  const fiscalReadyCompanies = empresasSalud.filter(e => e.fiscal_production_ready).length;
  const activeCompanies = empresas.filter(e => e.estado === "activo").length;
  const gpsWithWebhook = empresasSalud.filter(e => e.gps_webhook_activo).length;
  const gpsDuplicatedCompanies = empresasSalud.filter(e => e.gps_ids_duplicados > 0).length;
  const gpsStaleCompanies = empresasSalud.filter(e => e.gps_sin_senal_reciente > 0).length;
  const securitySecretNames = [
    "USER_JWT_SECRET",
    "SUPERADMIN_JWT_SECRET",
    "ACCOUNTING_SSO_JWT_SECRET",
    "API_KEYS_ENCRYPTION_SECRET",
    "DOC_CONTROL_SECRET",
  ];
  const securitySecrets = securitySecretNames.map(name => String(process.env[name] || ""));
  const securitySecretsReady = securitySecrets.every(value => value.length >= 32)
    && new Set(securitySecrets).size === securitySecrets.length
    && securitySecrets.every(value => value !== String(process.env.JWT_SECRET || ""));

  const checks = [
    integrationCheck({
      key: "ai_basic_inbox",
      area: "IA",
      label: "Bandeja IA basica",
      ok: true,
      detail: "Parser local activo para emails, texto, PDF/DOCX/XLSX con texto y documentos legibles.",
      action: "Usar IA visual solo para imagenes o PDF escaneados.",
    }),
    integrationCheck({
      key: "ai_visual_provider",
      area: "IA",
      label: "IA visual/chat configurada",
      ok: aiVisualReadyCompanies > 0,
      required: false,
      warnings: [
        aiProvider === "ai_generic" && !aiBaseUrl ? "Proveedor compatible OpenAI sin URL base propia; usara /v1 por defecto si procede." : "",
        !aiModel ? "Modelo IA no fijado; se usara el modelo por defecto del backend." : "",
      ],
      detail: `${aiVisualReadyCompanies}/${empresas.length} empresa(s) tienen clave resoluble para ${aiProvider}.`,
      action: "Configurar clave global o propia de IA en SuperAdmin > Integraciones > IA/Empresa.",
    }),
    integrationCheck({
      key: "routing_local_fallback",
      area: "Mapas",
      label: "Fallback de rutas operativo",
      ok: true,
      detail: "El optimizador puede generar enlace orientativo y calculo local aunque falten HERE/ORS.",
      action: "Validar restricciones de camion cuando se use fallback local.",
    }),
    integrationCheck({
      key: "routing_truck_provider",
      area: "Mapas",
      label: "Rutas de camion HERE/ORS",
      ok: routingTruckReadyCompanies > 0,
      required: false,
      warnings: [
        !validRoutingProvider ? `ROUTING_PROVIDER no reconocido: ${routingProvider}.` : "",
        routingProvider && routingProvider !== "local" && !global[routingProvider]?.global_configured ? `ROUTING_PROVIDER=${routingProvider} no tiene clave global; se buscara clave por empresa o fallback.` : "",
      ],
      detail: `${routingTruckReadyCompanies}/${empresas.length} empresa(s) tienen HERE u ORS resoluble.`,
      action: "Configurar HERE u ORS si se quiere ruta truck-aware real.",
    }),
    integrationCheck({
      key: "gps_config",
      area: "GPS",
      label: "GPS por empresa",
      ok: gpsReadyCompanies > 0,
      required: false,
      warnings: [
        gpsDuplicatedCompanies ? `${gpsDuplicatedCompanies} empresa(s) tienen IDs GPS duplicados.` : "",
        gpsStaleCompanies ? `${gpsStaleCompanies} empresa(s) tienen vehiculos sin senal reciente.` : "",
      ],
      detail: `${gpsReadyCompanies}/${empresas.length} empresa(s) tienen proveedor GPS activo y clave resoluble. ${gpsWithWebhook} con webhook activo.`,
      action: "Activar un unico proveedor GPS por empresa, enlazar matriculas y revisar senal reciente.",
    }),
    integrationCheck({
      key: "smtp",
      area: "Comunicaciones",
      label: "SMTP",
      ok: smtpConfigured,
      required: false,
      warnings: [smtpPartial ? "SMTP esta parcialmente configurado." : ""],
      detail: smtpConfigured ? "Email operativo para invitaciones, rutas y avisos." : "Email no configurado o incompleto.",
      action: "Completar SMTP_HOST, SMTP_USER, SMTP_PASS y SMTP_FROM antes de produccion.",
    }),
    integrationCheck({
      key: "fiscal",
      area: "Fiscal",
      label: "Fiscal/VERIFACTU/SII",
      ok: fiscalReadyCompanies > 0 || !activeCompanies,
      required: false,
      detail: `${fiscalReadyCompanies}/${empresas.length} empresa(s) marcadas como listas para produccion fiscal.`,
      action: "Probar canal fiscal por empresa antes de emitir en produccion.",
    }),
    integrationCheck({
      key: "secrets",
      area: "Seguridad",
      label: "Claves y tokens",
      ok: securitySecretsReady,
      required: true,
      warnings: [
        !process.env.API_KEYS_ENCRYPTION_SECRET ? "API_KEYS_ENCRYPTION_SECRET no esta definido; el cifrado cae a JWT_SECRET." : "",
        !process.env.DOC_CONTROL_SECRET ? "DOC_CONTROL_SECRET no esta definido; los documentos publicos caen a JWT_SECRET." : "",
        !process.env.USER_JWT_SECRET ? "USER_JWT_SECRET no esta definido; usuarios caen a JWT_SECRET." : "",
        !process.env.SUPERADMIN_JWT_SECRET ? "SUPERADMIN_JWT_SECRET no esta definido; superadmin cae a JWT_SECRET." : "",
        !process.env.ACCOUNTING_SSO_JWT_SECRET ? "ACCOUNTING_SSO_JWT_SECRET no esta definido; SSO contable cae a JWT_SECRET." : "",
        securitySecrets.filter(Boolean).length === securitySecretNames.length && new Set(securitySecrets).size !== securitySecrets.length
          ? "Hay secretos especializados reutilizados entre dominios."
          : "",
        process.env.NODE_ENV === "production" && !process.env.CORS_ORIGINS ? "CORS_ORIGINS no esta fijado explicitamente en produccion." : "",
      ],
      detail: "Usuarios, superadmin, SSO contable, cifrado de APIs y documentos publicos usan dominios criptograficos separados.",
      action: "Configurar USER_JWT_SECRET, SUPERADMIN_JWT_SECRET, ACCOUNTING_SSO_JWT_SECRET, API_KEYS_ENCRYPTION_SECRET y DOC_CONTROL_SECRET largos y distintos en produccion.",
    }),
  ];

  const resumen = summarizeIntegrationChecks(checks);
  return {
    generated_at: new Date().toISOString(),
    app_meta: appMeta,
    resumen,
    checks,
    providers: {
      ai: { provider: aiProvider, base_url_configured: !!aiBaseUrl, model_configured: !!aiModel },
      routing: { provider: routingProvider || "local", valid: validRoutingProvider, here_global: !!global.here?.global_configured, ors_global: !!global.ors?.global_configured },
      gps: { providers: GPS_PROVIDERS, empresas_con_gps: gpsReadyCompanies, empresas_con_webhook: gpsWithWebhook },
      external_live_tests: false,
    },
    empresas: empresasSalud,
    acciones_prioritarias: checks
      .filter(c => c.estado !== "ok")
      .slice(0, 8)
      .map(c => ({ key: c.key, area: c.area, label: c.label, estado: c.estado, action: c.action })),
  };
}

function monthlyPlanValue(plan, ciclo = "mensual") {
  const base = PLAN_PRICES[plan] || 0;
  return ciclo === "anual" ? (base * 12 * 0.85) / 12 : base;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeFilename(value, fallback = "salud-saas.html") {
  const clean = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || fallback;
}

function csvCell(value) {
  const clean = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return `"${clean.replace(/"/g, '""')}"`;
}

function buildCsv(headers = [], rows = []) {
  return [
    headers.map(csvCell).join(";"),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(";")),
  ].join("\n");
}

async function buildSaasHealthRows() {
  const { rows } = await db.query(`
    SELECT e.id, e.nombre, e.plan, e.estado, e.fecha_vencimiento, e.bloqueo_manual,
           e.bloqueo_motivo, e.ciclo_facturacion, e.ia_limite_mensual, e.ia_usos_mes,
           (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id=e.id AND u.activo=true) AS usuarios_activos,
           (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id=e.id AND u.activo=true AND u.rol::text='gerente') AS gerentes_activos,
           (SELECT COUNT(*) FROM clientes c WHERE c.empresa_id=e.id AND COALESCE(c.activo,true)=true) AS clientes_activos,
           (SELECT COUNT(*) FROM vehiculos v WHERE v.empresa_id=e.id AND COALESCE(v.activo,true)=true) AS vehiculos_activos,
           (SELECT COUNT(*) FROM pedidos p WHERE p.empresa_id=e.id AND p.created_at >= NOW()-INTERVAL '30 days') AS pedidos_30d,
           (SELECT COUNT(*) FROM backup_solicitudes bs WHERE bs.empresa_id=e.id AND bs.estado='pendiente') AS backups_pendientes,
           (SELECT COUNT(*) FROM backup_solicitudes bs WHERE bs.empresa_id=e.id AND bs.estado IN ('resuelto','generado','completado','completada','hecho')) AS backups_resueltos,
           (SELECT MAX(created_at) FROM audit_log_saas a WHERE a.empresa_id=e.id) AS ultima_accion_soporte
    FROM empresas e
    ORDER BY e.created_at DESC
  `);
  const now = Date.now();
  return rows.map(e => {
    const venc = e.fecha_vencimiento ? new Date(e.fecha_vencimiento).getTime() : null;
    const dias = venc ? Math.ceil((venc - now) / 86400000) : null;
    const sinGerente = Number(e.gerentes_activos || 0) === 0;
    const sinUsuarios = Number(e.usuarios_activos || 0) === 0;
    const sinActividad30d = e.estado === "activo" && Number(e.pedidos_30d || 0) === 0;
    const sinClientes = Number(e.clientes_activos || 0) === 0;
    const iaLimite = Number(e.ia_limite_mensual || 0);
    const iaUsos = Number(e.ia_usos_mes || 0);
    const iaAgotada = iaLimite > 0 && iaUsos >= iaLimite;
    const color = e.estado !== "activo" || e.bloqueo_manual || (dias !== null && dias < 0) || sinGerente || sinUsuarios
      ? "rojo"
      : (dias !== null && dias <= 7) || Number(e.backups_pendientes || 0) > 0 || sinActividad30d || sinClientes || iaAgotada
        ? "amarillo"
        : "verde";
    const motivos = [];
    if (e.estado !== "activo") motivos.push(`estado ${e.estado}`);
    if (e.bloqueo_manual) motivos.push(`bloqueo ${e.bloqueo_motivo || "manual"}`);
    if (dias !== null && dias < 0) motivos.push("suscripcion vencida");
    if (dias !== null && dias >= 0 && dias <= 7) motivos.push("pago proximo");
    if (sinGerente) motivos.push("sin gerente activo");
    if (sinUsuarios) motivos.push("sin usuarios activos");
    if (sinClientes) motivos.push("sin clientes activos");
    if (sinActividad30d) motivos.push("sin pedidos 30d");
    if (iaAgotada) motivos.push("IA agotada");
    if (Number(e.backups_pendientes || 0) > 0) motivos.push("backup pendiente");
    const checks = [
      { key: "empresa_activa", ok: e.estado === "activo" && !e.bloqueo_manual && !(dias !== null && dias < 0), weight: 25 },
      { key: "gerente_activo", ok: !sinGerente, weight: 20 },
      { key: "usuarios_activos", ok: !sinUsuarios, weight: 15 },
      { key: "clientes_activos", ok: !sinClientes, weight: 15 },
      { key: "actividad_30d", ok: !sinActividad30d, weight: 10 },
      { key: "continuidad", ok: Number(e.backups_pendientes || 0) === 0, weight: 10 },
      { key: "ia_disponible", ok: !iaAgotada, weight: 5 },
    ];
    const total = checks.reduce((sum, check) => sum + check.weight, 0);
    const ok = checks.reduce((sum, check) => sum + (check.ok ? check.weight : 0), 0);
    const implantacionScore = total ? Math.round((ok / total) * 100) : 0;
    const implantacionEstado = color === "rojo" ? "critica" : implantacionScore >= 85 ? "lista" : "vigilancia";
    return {
      ...e,
      color,
      dias_vencimiento: dias,
      motivos,
      implantacion_score: implantacionScore,
      implantacion_estado: implantacionEstado,
      implantacion_checks: checks,
    };
  });
}

function buildSaasHealthInformeHtml(empresas = [], req) {
  const totals = empresas.reduce((acc, e) => {
    acc.total += 1;
    acc[e.color] = (acc[e.color] || 0) + 1;
    acc.usuarios += Number(e.usuarios_activos || 0);
    acc.gerentes += Number(e.gerentes_activos || 0);
    acc.clientes += Number(e.clientes_activos || 0);
    acc.pedidos += Number(e.pedidos_30d || 0);
    acc.backups += Number(e.backups_pendientes || 0);
    if (Number(e.gerentes_activos || 0) === 0) acc.sin_gerente += 1;
    if (e.estado === "activo" && Number(e.pedidos_30d || 0) === 0) acc.sin_actividad += 1;
    return acc;
  }, { total: 0, verde: 0, amarillo: 0, rojo: 0, usuarios: 0, gerentes: 0, clientes: 0, pedidos: 0, backups: 0, sin_gerente: 0, sin_actividad: 0 });
  const rows = empresas.map(e => `
    <tr>
      <td><span class="${htmlEscape(e.color)}">${htmlEscape(e.color)}</span></td>
      <td><strong>${htmlEscape(e.nombre)}</strong><br><span class="muted">${htmlEscape(e.plan)} - ${htmlEscape(e.ciclo_facturacion || "mensual")}</span></td>
      <td>${htmlEscape(e.estado)}${e.dias_vencimiento !== null ? `<br><span class="muted">${htmlEscape(e.dias_vencimiento)} dia(s) vencimiento</span>` : ""}</td>
      <td>${htmlEscape(e.implantacion_score ?? 0)}%<br><span class="muted">${htmlEscape(e.implantacion_estado || "-")}</span></td>
      <td>${htmlEscape(e.usuarios_activos || 0)} usuario(s)<br><span class="muted">${htmlEscape(e.gerentes_activos || 0)} gerente(s), ${htmlEscape(e.clientes_activos || 0)} cliente(s)</span></td>
      <td>${htmlEscape(e.pedidos_30d || 0)} pedido(s)<br><span class="muted">IA ${htmlEscape(e.ia_usos_mes || 0)}/${htmlEscape(e.ia_limite_mensual || 0)}</span></td>
      <td>${htmlEscape((e.motivos || []).join(", ") || "OK")}</td>
    </tr>
  `).join("");
  const metric = (label, value, cls = "") => `<div class="box"><div class="metric ${cls}">${htmlEscape(value)}</div><div class="label">${htmlEscape(label)}</div></div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>Informe salud SaaS TransGest</title>
  <style>
    body{font-family:Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:32px}
    h1{margin:0;font-size:26px}.sub,.muted{color:#64748b;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:20px 0}
    .box{background:#fff;border:1px solid #dbe4ef;border-radius:8px;padding:12px}.metric{font-size:22px;font-weight:800}.label{font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;margin-top:4px}
    .verde{color:#059669;font-weight:800}.amarillo{color:#b45309;font-weight:800}.rojo{color:#dc2626;font-weight:800}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe4ef;border-radius:8px;overflow:hidden}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;vertical-align:top}
    th{background:#f1f5f9;color:#334155;text-transform:uppercase;font-size:10px}
  </style></head><body>
    <h1>Informe salud SaaS TransGest</h1>
    <div class="sub">Generado el ${htmlEscape(new Date().toLocaleString("es-ES"))} por ${htmlEscape(req.superadmin?.email || "TransGestAdmin")}.</div>
    <div class="grid">
      ${metric("Empresas", totals.total)}
      ${metric("Criticas", totals.rojo, "rojo")}
      ${metric("Avisos", totals.amarillo, "amarillo")}
      ${metric("Listas", totals.verde, "verde")}
      ${metric("Sin gerente", totals.sin_gerente, totals.sin_gerente ? "rojo" : "verde")}
      ${metric("Sin actividad 30d", totals.sin_actividad, totals.sin_actividad ? "amarillo" : "verde")}
      ${metric("Backups pendientes", totals.backups, totals.backups ? "amarillo" : "verde")}
      ${metric("Pedidos 30d", totals.pedidos)}
    </div>
    <table>
      <thead><tr><th>Estado</th><th>Empresa</th><th>Pago</th><th>Implantacion</th><th>Base</th><th>Uso</th><th>Alertas</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='7'>Sin empresas.</td></tr>"}</tbody>
    </table>
  </body></html>`;
}

async function getAppMeta() {
  const brand_name = await getGlobalSetting("app_brand_name", APP_META_DEFAULTS.brand_name);
  const version_name = await getGlobalSetting("app_version_name", APP_META_DEFAULTS.version_name);
  const version = await getGlobalSetting("app_version", APP_META_DEFAULTS.version);
  const fiscal_software_name = await getGlobalSetting("fiscal_software_name", APP_META_DEFAULTS.fiscal_software_name);
  const fiscal_software_id = await getGlobalSetting("fiscal_software_id", APP_META_DEFAULTS.fiscal_software_id);
  return {
    brand_name: String(brand_name || APP_META_DEFAULTS.brand_name).trim() || APP_META_DEFAULTS.brand_name,
    version_name: String(version_name || APP_META_DEFAULTS.version_name).trim() || APP_META_DEFAULTS.version_name,
    version: String(version || APP_META_DEFAULTS.version).trim() || APP_META_DEFAULTS.version,
    fiscal_software_name: String(fiscal_software_name || APP_META_DEFAULTS.fiscal_software_name).trim() || APP_META_DEFAULTS.fiscal_software_name,
    fiscal_software_id: String(fiscal_software_id || APP_META_DEFAULTS.fiscal_software_id).trim() || APP_META_DEFAULTS.fiscal_software_id,
  };
}

async function audit(req, accion, detalle = {}, empresaId = null) {
  await db.query(
    `INSERT INTO audit_log_saas (actor_tipo, actor_id, actor_email, empresa_id, accion, detalle, ip)
     VALUES ('superadmin', $1, $2, $3, $4, $5, $6)`,
    [req.superadmin?.id || null, req.superadmin?.email || null, empresaId, accion, JSON.stringify(detalle), req.ip]
  ).catch(() => {});
}

function formatDateEs(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-ES");
}

function normalizeBillingMethod(value) {
  const method = String(value || "pendiente").trim().toLowerCase();
  if (["tarjeta", "card"].includes(method)) return "tarjeta";
  if (["domiciliacion", "sepa", "sepa_debit"].includes(method)) return "domiciliacion";
  if (["transferencia", "transfer"].includes(method)) return "transferencia";
  return "pendiente";
}

function billingEmailForEmpresa(empresa = {}) {
  return String(empresa.email_facturacion || empresa.email_admin || "").trim().toLowerCase();
}

async function createBillingCheckoutForEmpresa(empresa, userId = null) {
  const plan = empresa.plan || "profesional";
  const ciclo = empresa.ciclo_facturacion || "mensual";
  const priceId = stripe.planPriceId(plan, ciclo);
  if (!stripe.configured() || !priceId) {
    const missing = [
      !stripe.configured() ? "STRIPE_SECRET_KEY" : null,
      !priceId ? `STRIPE_PRICE_${String(plan).toUpperCase()}_${String(ciclo).toUpperCase()}` : null,
    ].filter(Boolean);
    const err = new Error("Stripe no esta configurado para este plan/ciclo");
    err.code = "stripe_not_configured";
    err.missing = missing;
    throw err;
  }

  let customerId = empresa.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.createCustomer({
      email: billingEmailForEmpresa(empresa),
      name: empresa.nombre,
      empresaId: empresa.id,
    });
    customerId = customer.id;
    await db.query("UPDATE empresas SET stripe_customer_id=$1 WHERE id=$2", [customerId, empresa.id]);
  }

  const session = await stripe.createCheckoutSession({
    customerId,
    priceId,
    empresaId: empresa.id,
    plan,
    ciclo,
    userId,
    metodoPago: empresa.metodo_pago || "auto",
  });
  return session;
}

async function sendBillingReminder(empresa, tipo = "auto", checkoutUrl = null) {
  const email = billingEmailForEmpresa(empresa);
  if (!email) {
    const err = new Error("La empresa no tiene email de facturacion ni email admin");
    err.code = "missing_billing_email";
    throw err;
  }
  const venc = empresa.fecha_vencimiento ? new Date(empresa.fecha_vencimiento) : null;
  const isOverdue = tipo === "vencido" || (tipo === "auto" && venc && venc < new Date());
  const plantilla = isOverdue ? "suscripcion_pago_vencido" : "suscripcion_proximo_vencimiento";
  const mail = await enviarEmail({
    trigger: plantilla,
    destinatario: email,
    plantilla,
    datos: {
      nombre: empresa.nombre_contacto || empresa.nombre || "",
      empresa: empresa.nombre,
      fecha_vencimiento: formatDateEs(empresa.fecha_vencimiento),
      checkout_url: checkoutUrl || "",
    },
    empresa_id: empresa.id,
    force_platform: true,
    meta: { empresa_id: empresa.id, tipo },
  });
  await db.query(
    `UPDATE empresas
     SET ultimo_aviso_pago_at=CASE WHEN $2::boolean THEN ultimo_aviso_pago_at ELSE NOW() END,
         ultimo_aviso_vencido_at=CASE WHEN $2::boolean THEN NOW() ELSE ultimo_aviso_vencido_at END
     WHERE id=$1`,
    [empresa.id, isOverdue]
  ).catch(() => {});
  return mail;
}

async function createInvitationForUser({ client = db, empresa, usuario, actorEmail = "" }) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  await client.query(`
    INSERT INTO invitaciones_usuario (empresa_id, usuario_id, email, token_hash, expires_at, created_by)
    VALUES ($1,$2,$3,$4,$5,$6)
  `, [empresa.id, usuario.id, usuario.email, hashToken(token), expiresAt, actorEmail]);
  return { token, expiresAt, url: `${appUrl()}/invitacion/${token}` };
}

// ── Superadmin auth middleware ────────────────────────────────────────────
function superAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autorizado" });
  try {
    const payload = jwt.verify(header.split(" ")[1], superadminJwtSecret());
    if (!payload.superadmin) return res.status(403).json({ error: "Acceso denegado" });
    req.superadmin = payload;
    next();
  } catch { return res.status(401).json({ error: "Token inválido" }); }
}

// ── POST /superadmin/login ────────────────────────────────────────────────
async function ensurePasswordResetRequestsSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
      usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      identifier VARCHAR(180) NOT NULL,
      email VARCHAR(180),
      nombre VARCHAR(180),
      rol VARCHAR(40),
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      ip VARCHAR(80),
      user_agent TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolved_by UUID REFERENCES superadmins(id) ON DELETE SET NULL,
      resolution_note TEXT
    )
  `).catch(() => {});
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email y contraseña requeridos" });
  try {
    const { rows } = await db.query("SELECT * FROM superadmins WHERE email=$1 AND activo=true", [email]);
    if (!rows[0]) return res.status(401).json({ error: "Credenciales incorrectas" });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Credenciales incorrectas" });
    const token = jwt.sign({ superadmin: true, id: rows[0].id, email, rol: rows[0].rol || "superadmin" }, superadminJwtSecret(), { expiresIn: "4h" });
    res.json({ token, nombre: rows[0].nombre, rol: rows[0].rol || "superadmin" });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get("/public/app-meta", async (req, res) => {
  try {
    res.json({ ok: true, app_meta: await getAppMeta() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /superadmin/empresas — Listar todas las empresas ─────────────────
router.get("/correo/status", superAuth, async (_req, res) => {
  const cfg = await getPlatformEmailConfig(false);
  const fallback = key => process.env[key] || process.env[key.replace("GAUNA_", "PLATFORM_")] || process.env[key.replace("GAUNA_", "")];
  const envHost = String(fallback("GAUNA_SMTP_HOST") || "").trim().toLowerCase();
  const envLooksPlaceholder = ["smtp.tuproveedor.com", "smtp.example.com", "example.com"].some(token => envHost.includes(token));
  const envConfigured = Boolean(!envLooksPlaceholder && fallback("GAUNA_SMTP_HOST") && fallback("GAUNA_SMTP_USER") && fallback("GAUNA_SMTP_PASS") && fallback("GAUNA_SMTP_FROM"));
  const dbConfigured = Boolean(cfg.smtp_host && cfg.smtp_user && (cfg.smtp_pass_masked || cfg.smtp_pass) && cfg.smtp_from);
  res.json({
    ok: dbConfigured || envConfigured,
    provider: dbConfigured ? "gauna_db" : envConfigured ? "gauna_env" : "simulado",
    config: {
      ...cfg,
      smtp_host: cfg.smtp_host || fallback("GAUNA_SMTP_HOST") || "",
      smtp_port: cfg.smtp_host ? cfg.smtp_port : String(fallback("GAUNA_SMTP_PORT") || "587"),
      smtp_secure: cfg.smtp_host ? cfg.smtp_secure : ["true","1","yes","si"].includes(String(fallback("GAUNA_SMTP_SECURE") || "").toLowerCase()),
      smtp_user: cfg.smtp_user || fallback("GAUNA_SMTP_USER") || "",
      smtp_from: cfg.smtp_from || fallback("GAUNA_SMTP_FROM") || "",
      smtp_from_nombre: cfg.smtp_from_nombre || fallback("GAUNA_SMTP_FROM_NAME") || "Gauna - TransGest",
      reply_to: cfg.reply_to || fallback("GAUNA_SMTP_REPLY_TO") || fallback("GAUNA_SMTP_FROM") || "",
    },
    env_configured: envConfigured,
  });
});

router.put("/correo/config", superAuth, async (req, res) => {
  try {
    const saved = await savePlatformEmailConfig(req.body || {}, req.superadmin?.id || null);
    await audit(req, "correo_gauna.config_guardada", {
      smtp_host: saved.smtp_host ? "configurado" : "vacio",
      smtp_user: saved.smtp_user ? "configurado" : "vacio",
      smtp_from: saved.smtp_from || "",
    });
    res.json({ ok: true, config: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/correo/test", superAuth, async (req, res) => {
  const destinatario = String(req.body?.destinatario || req.superadmin?.email || "").trim().toLowerCase();
  if (!destinatario) return res.status(400).json({ error: "Indica un destinatario" });
  try {
    const mail = await enviarEmail({
      trigger: "correo_gauna_test",
      destinatario,
      plantilla: "invitacion_usuario",
      datos: { nombre: "Test", empresa: "Gauna / TransGest", url: `${appUrl()}/superadmin` },
      force_platform: true,
      meta: { test: true, superadmin: req.superadmin?.email || "" },
    });
    await audit(req, "correo_gauna.test", { destinatario, simulado: !!mail.simulado });
    res.json({ ok: true, email: mail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/usuarios-admin", superAuth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT id,nombre,email,rol,activo,created_at FROM superadmins ORDER BY created_at DESC"
  );
  res.json(rows);
});

router.get("/password-reset-requests", superAuth, async (req, res) => {
  await ensurePasswordResetRequestsSchema();
  const estado = String(req.query?.estado || "pendiente").trim().toLowerCase();
  const params = [];
  const where = [];
  if (estado && estado !== "todos") {
    params.push(estado);
    where.push(`r.estado=$${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT r.id,r.empresa_id,r.usuario_id,r.identifier,r.email,r.nombre,r.rol,r.estado,
            r.requested_at,r.resolved_at,r.resolution_note,
            e.nombre AS empresa_nombre,
            u.email AS usuario_email,u.username AS usuario_username,u.activo AS usuario_activo,
            s.email AS resolved_by_email
       FROM password_reset_requests r
       LEFT JOIN empresas e ON e.id=r.empresa_id
       LEFT JOIN usuarios u ON u.id=r.usuario_id
       LEFT JOIN superadmins s ON s.id=r.resolved_by
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY CASE WHEN r.estado='pendiente' THEN 0 ELSE 1 END, r.requested_at DESC
      LIMIT 100`,
    params
  );
  res.json(rows);
});

router.post("/password-reset-requests/:id/reset", superAuth, async (req, res) => {
  await ensurePasswordResetRequestsSchema();
  const password = String(req.body?.password || "").trim();
  if (password.length < 8) return res.status(400).json({ error: "La contrasena debe tener al menos 8 caracteres" });
  const { rows } = await db.query(
    `SELECT r.*, u.email AS usuario_email, u.username AS usuario_username, u.empresa_id AS usuario_empresa_id
       FROM password_reset_requests r
       LEFT JOIN usuarios u ON u.id=r.usuario_id
      WHERE r.id=$1
      LIMIT 1`,
    [req.params.id]
  );
  const solicitud = rows[0];
  if (!solicitud) return res.status(404).json({ error: "Solicitud no encontrada" });
  if (!solicitud.usuario_id) return res.status(400).json({ error: "No hay un usuario asociado a esta solicitud" });

  const hash = await bcrypt.hash(password, 12);
  const updated = await db.query(
    `UPDATE usuarios
        SET password_hash=$1, activo=true, debe_cambiar_password=true, password_changed_at=NULL,
            login_failed_count=0, login_locked_until=NULL
      WHERE id=$2
      RETURNING id,nombre,email,username,rol,empresa_id`,
    [hash, solicitud.usuario_id]
  );
  const usuario = updated.rows[0];
  await db.query(
    `UPDATE password_reset_requests
        SET estado='resuelto', resolved_at=NOW(), resolved_by=$2, resolution_note=$3
      WHERE id=$1`,
    [solicitud.id, req.superadmin?.id || null, "Password reseteada desde superadmin"]
  );
  await audit(req, "password_reset_request.resuelta", {
    solicitud_id: solicitud.id,
    usuario_id: usuario.id,
    email: usuario.email || usuario.username,
  }, usuario.empresa_id || solicitud.empresa_id || null);
  res.json({ ok: true, usuario: usuario.email || usuario.username });
});

router.post("/password-reset-requests/:id/descartar", superAuth, async (req, res) => {
  await ensurePasswordResetRequestsSchema();
  const note = String(req.body?.note || "Solicitud descartada desde superadmin").trim().slice(0, 300);
  const { rows } = await db.query(
    `UPDATE password_reset_requests
        SET estado='descartado', resolved_at=NOW(), resolved_by=$2, resolution_note=$3
      WHERE id=$1
      RETURNING id,empresa_id,identifier`,
    [req.params.id, req.superadmin?.id || null, note]
  );
  if (!rows[0]) return res.status(404).json({ error: "Solicitud no encontrada" });
  await audit(req, "password_reset_request.descartada", {
    solicitud_id: rows[0].id,
    identifier: rows[0].identifier,
  }, rows[0].empresa_id || null);
  res.json({ ok: true });
});

router.post("/usuarios-admin", superAuth, async (req, res) => {
  const { nombre, email, password, rol = "soporte" } = req.body;
  if (!nombre || !email || !password) {
    return res.status(400).json({ error: "Nombre, email y password son obligatorios" });
  }
  if (!["superadmin","soporte","facturacion"].includes(rol)) {
    return res.status(400).json({ error: "Rol no valido" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "La contrasena debe tener al menos 8 caracteres" });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO superadmins (nombre,email,password_hash,rol,activo)
       VALUES ($1,$2,$3,$4,true)
       RETURNING id,nombre,email,rol,activo,created_at`,
      [nombre, email.toLowerCase(), hash, rol]
    );
    await audit(req, "superadmin.creado", { email, rol });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ya existe ese email" });
    res.status(500).json({ error: err.message });
  }
});

router.patch("/usuarios-admin/:id", superAuth, async (req, res) => {
  const { nombre, rol, activo, password } = req.body;
  if (rol !== undefined && !["superadmin","soporte","facturacion"].includes(rol)) {
    return res.status(400).json({ error: "Rol no valido" });
  }

  const updates = [], params = [];
  let i = 1;
  if (nombre !== undefined) { updates.push(`nombre=$${i++}`); params.push(nombre); }
  if (rol !== undefined) { updates.push(`rol=$${i++}`); params.push(rol); }
  if (activo !== undefined) { updates.push(`activo=$${i++}`); params.push(Boolean(activo)); }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: "La contrasena debe tener al menos 8 caracteres" });
    updates.push(`password_hash=$${i++}`); params.push(await bcrypt.hash(password, 12));
  }
  if (!updates.length) return res.status(400).json({ error: "Nada que actualizar" });
  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE superadmins SET ${updates.join(", ")} WHERE id=$${i}
     RETURNING id,nombre,email,rol,activo,created_at`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });
  await audit(req, "superadmin.actualizado", { id: req.params.id, ...req.body });
  res.json(rows[0]);
});

router.get("/empresas", superAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT e.*,
      (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id=e.id) AS n_usuarios,
      (SELECT COUNT(*) FROM vehiculos v WHERE v.empresa_id=e.id) AS n_vehiculos,
      (SELECT COUNT(*) FROM clientes c WHERE c.empresa_id=e.id) AS n_clientes,
      (SELECT COUNT(*) FROM pedidos p WHERE p.empresa_id=e.id) AS n_pedidos,
      (SELECT COUNT(*) FROM facturas f WHERE f.empresa_id=e.id) AS n_facturas
    FROM empresas e
    ORDER BY e.created_at DESC
  `);
  res.json(rows);
});

// ── POST /superadmin/empresas — Crear empresa manualmente ────────────────
async function refreshEmpresaCalendarioLaboral(empresaId, year, ccaa, actorEmail = "") {
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
  const { rows } = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1", [empresaId]);
  if (!rows[0]) throw new Error("Empresa no encontrada");
  const cfg = rows[0]?.cfg_precios && typeof rows[0].cfg_precios === "object" ? rows[0].cfg_precios : {};
  const cacheKey = `${year}_${ccaa}`;
  const compatCacheKey = `${year}:${ccaa}`;
  const ccaaLabel = CCAA.find(c => c.code === ccaa)?.label || ccaa;
  const cacheEntry = {
    fuente: next.fuente,
    updated_at: next.updated_at,
    warnings: next.warnings,
    holidays: next.holidays,
    refreshed_by: actorEmail || null,
  };
  const nextCfg = {
    ...cfg,
    calendario_laboral_ccaa: ccaa,
    calendario_laboral_ccaa_label: ccaaLabel,
    calendario_laboral_last_year: year,
    calendario_laboral_cache: {
      ...(cfg.calendario_laboral_cache || {}),
      [cacheKey]: cacheEntry,
      [compatCacheKey]: cacheEntry,
    },
  };
  await db.query("UPDATE empresas SET cfg_precios=$1 WHERE id=$2", [JSON.stringify(nextCfg), empresaId]);
  return next;
}

router.get("/calendario-laboral/ccaa", superAuth, async (_req, res) => {
  res.json(CCAA);
});

router.post("/calendario-laboral/refresh", superAuth, async (req, res) => {
  const year = normalizeYear(req.body?.year);
  const ccaa = normalizeCcaa(req.body?.ccaa);
  const empresaId = req.body?.empresa_id || null;
  const empresas = empresaId
    ? (await db.query("SELECT id,nombre FROM empresas WHERE id=$1", [empresaId])).rows
    : (await db.query("SELECT id,nombre FROM empresas WHERE estado <> 'cancelado' ORDER BY nombre")).rows;
  const results = [];
  for (const empresa of empresas) {
    try {
      const calendar = await refreshEmpresaCalendarioLaboral(empresa.id, year, ccaa, req.superadmin?.email || "");
      results.push({
        empresa_id: empresa.id,
        empresa_nombre: empresa.nombre,
        ccaa,
        ccaa_label: calendar.ccaa_label,
        ok: true,
        holidays_count: calendar.holidays.length,
        fuente: calendar.fuente,
        warnings: calendar.warnings || [],
      });
    } catch (err) {
      results.push({ empresa_id: empresa.id, empresa_nombre: empresa.nombre, ok: false, error: err.message });
    }
  }
  await audit(req, "calendario_laboral.refrescado", { year, ccaa, empresa_id: empresaId || "todas", total: results.length });
  res.json({
    ok: results.some(r => r.ok),
    year,
    ccaa,
    ccaa_label: CCAA.find(c => c.code === ccaa)?.label || ccaa,
    total_empresas: results.length,
    actualizadas: results.filter(r => r.ok).length,
    errores: results.filter(r => !r.ok).length,
    results,
  });
});

router.post("/empresas", superAuth, async (req, res) => {
  const {
    nombre_empresa,
    cif,
    email_admin,
    nombre_admin,
    plan = "profesional",
    fecha_vencimiento,
    ciclo_facturacion = "mensual",
    metodo_pago = "pendiente",
    iban_facturacion,
    email_facturacion,
  } = req.body;
  if (!nombre_empresa || !email_admin || !nombre_admin) {
    return res.status(400).json({ error: "Nombre empresa, email admin y nombre admin son obligatorios" });
  }
  try {
    const dominio = nombre_empresa.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 30);

    const result = await db.transaction(async (client) => {
      const empresaRes = await client.query(`
        INSERT INTO empresas (nombre, cif, email_admin, dominio, plan, max_vehiculos, max_usuarios, fecha_vencimiento, ciclo_facturacion, metodo_pago, iban_facturacion, email_facturacion)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, nombre, dominio
      `, [nombre_empresa, cif||null, email_admin, dominio, plan, 0, 0,
          fecha_vencimiento || null, ciclo_facturacion, normalizeBillingMethod(metodo_pago), iban_facturacion || null, email_facturacion || email_admin]);

      const empresa = empresaRes.rows[0];
      const tempHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12);
      const userRes = await client.query(`
        INSERT INTO usuarios (nombre, email, username, password_hash, rol, empresa_id, activo, debe_cambiar_password)
        VALUES ($1,$2,$3,$4,'gerente',$5,false,true)
        RETURNING id, nombre, email, rol
      `, [nombre_admin, email_admin, email_admin.toLowerCase(), tempHash, empresa.id]);

      const invitation = await createInvitationForUser({
        client,
        empresa,
        usuario: userRes.rows[0],
        actorEmail: req.superadmin.email,
      });

      return { empresa, usuario: userRes.rows[0], ...invitation };
    });

    const mail = await enviarEmail({
      trigger: "invitacion_usuario",
      destinatario: email_admin,
      plantilla: "invitacion_usuario",
      datos: { nombre: nombre_admin, empresa: nombre_empresa, url: result.url },
      empresa_id: result.empresa.id,
      force_platform: true,
    }).catch(e => ({ error: e.message }));
    await audit(req, "empresa.creada", { nombre_empresa, email_admin, plan }, result.empresa.id);

    res.status(201).json({
      ok: true,
      empresa: result.empresa,
      invitacion_url: result.url,
      invitacion_expira: result.expiresAt,
      email: mail,
    });
  } catch(err) {
    if (err.code === "23505") return res.status(409).json({ error: "El email o dominio ya existe" });
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /superadmin/empresas/:id — Actualizar empresa ──────────────────
router.post("/empresas/demo", superAuth, async (req, res) => {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
  const nombreEmpresa = String(req.body?.nombre_empresa || `Empresa Demo ${stamp}`).trim();
  const emailAdmin = String(req.body?.email_admin || `gerente.demo.${stamp}@transgest.local`).trim().toLowerCase();
  const password = String(req.body?.password || "demo1234");
  const dominio = `demo-${stamp}`;
  const today = new Date();
  const isoDate = (offsetDays) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };

  if (password.length < 8) return res.status(400).json({ error: "La contrasena demo debe tener al menos 8 caracteres" });

  try {
    const result = await db.transaction(async (client) => {
      const empresaRes = await client.query(`
        INSERT INTO empresas (nombre, cif, email_admin, dominio, plan, max_vehiculos, max_usuarios, estado, ciclo_facturacion, metodo_pago, email_facturacion)
        VALUES ($1,$2,$3,$4,'enterprise',0,0,'activo','mensual','pendiente',$3)
        RETURNING id, nombre, dominio, plan, estado
      `, [nombreEmpresa, `DEMO${stamp.slice(-8)}`, emailAdmin, dominio]);
      const empresa = empresaRes.rows[0];

      const passHash = await bcrypt.hash(password, 12);
      const userRes = await client.query(`
        INSERT INTO usuarios (nombre, email, username, password_hash, rol, empresa_id, activo, debe_cambiar_password)
        VALUES ('Gerente Demo', $1, $1, $2, 'gerente', $3, true, false)
        RETURNING id, nombre, email, username, rol
      `, [emailAdmin, passHash, empresa.id]);

      const clientes = [];
      for (const c of [
        ["Cementos Capa Demo", `B${stamp.slice(-8)}`, "Av. Industria 12", "03006", "Alicante", "trafico@cementos-demo.local", "Logistica Capa", "965000100"],
        ["Almacenes Centro Demo", `C${stamp.slice(-8)}`, "Calle Mayor 40", "28805", "Alcala de Henares", "operaciones@centro-demo.local", "Operaciones", "910000200"],
      ]) {
        const r = await client.query(`
          INSERT INTO clientes (nombre,cif,direccion,cp,ciudad,pais,email,contacto,telefono,
            forma_pago,vencimiento,tipo_iva,iva_regimen,tipo_irpf,precio_tn_km,notas,empresa_id,pendiente_revision)
          VALUES ($1,$2,$3,$4,$5,'Espana',$6,$7,$8,'Transferencia bancaria','30 dias',21,'general',0,0,$9,$10,false)
          RETURNING id, nombre
        `, [...c, "Cliente de demostracion", empresa.id]);
        clientes.push(r.rows[0]);
      }

      const vehiculos = [];
      for (const v of [
        ["1234LTD", "Volvo", "FH 500", "Tractora", 7600, 24000, "ALICANTE"],
        ["5678LTD", "Mercedes", "Actros", "Tractora", 7800, 24000, "MADRID"],
      ]) {
        const r = await client.query(`
          INSERT INTO vehiculos (matricula,marca,modelo,tipo,tara_kg,carga_max_kg,empresa_id,clase,ubicacion_actual,ubicacion_fuente,ubicacion_ts)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'Nacional',$8,'manual',NOW())
          RETURNING id, matricula
        `, [v[0], v[1], v[2], v[3], v[4], v[5], empresa.id, v[6]]);
        vehiculos.push(r.rows[0]);
      }

      const choferes = [];
      for (const [idx, ch] of [
        ["Carlos", "Garcia", "11111111A", "600000101"],
        ["Laura", "Martinez", "22222222B", "600000202"],
      ].entries()) {
        const r = await client.query(
          "INSERT INTO choferes (nombre,apellidos,dni,telefono,email,vehiculo_id,categoria_carnet,tipo_contrato,salario,notas,empresa_id) VALUES ($1,$2,$3,$4,$5,$6,'C+E','indefinido',NULL,'Chofer demo',$7) RETURNING id,nombre,apellidos",
          [ch[0], ch[1], ch[2], ch[3], `${ch[0].toLowerCase()}.${stamp}@demo.local`, vehiculos[idx]?.id || null, empresa.id]
        );
        choferes.push(r.rows[0]);
      }

      const pedidos = [];
      const baseNumero = `D${stamp.slice(-10)}-`;
      const demoPedidos = [
        [clientes[0].id, vehiculos[0].id, choferes[0].id, "Cementos Capa Demo - Alicante", "Obra Norte - Alcala de Henares", isoDate(1), "08:00", isoDate(2), "Palets cemento", 24000, 33, 580],
        [clientes[1].id, vehiculos[1].id, choferes[1].id, "Almacenes Centro Demo - Madrid", "Plataforma Levante - Valencia", isoDate(3), "09:30", isoDate(3), "Mercancia general", 12000, 18, 420],
        [clientes[0].id, null, null, "Cementos Capa Demo - Alicante", "Cliente final - Murcia", isoDate(5), "07:30", isoDate(5), "Grupaje paletizado", 6000, 8, 210],
      ];
      for (const [idx, p] of demoPedidos.entries()) {
        const numero = `${baseNumero}${String(idx + 1).padStart(4, "0")}`;
        const r = await client.query(`
          INSERT INTO pedidos (numero, cliente_id, vehiculo_id, chofer_id,
            origen, destino, fecha_pedido, fecha_carga, hora_carga, fecha_entrega,
            mercancia, peso_kg, bultos, importe, notas, empresa_id)
          VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10,$11,$12,$13,'Pedido demo creado desde superadmin',$14)
          RETURNING id, numero
        `, [numero, ...p, empresa.id]);
        pedidos.push(r.rows[0]);
      }

      return { empresa, usuario: userRes.rows[0], clientes, vehiculos, choferes, pedidos };
    });

    await audit(req, "empresa.demo.creada", {
      email_admin: emailAdmin,
      seeded: {
        clientes: result.clientes.length,
        vehiculos: result.vehiculos.length,
        choferes: result.choferes.length,
        pedidos: result.pedidos.length,
      },
    }, result.empresa.id);

    res.status(201).json({
      ok: true,
      empresa: result.empresa,
      usuario: result.usuario,
      credenciales: { usuario: emailAdmin, password },
      seeded: {
        clientes: result.clientes.length,
        vehiculos: result.vehiculos.length,
        choferes: result.choferes.length,
        pedidos: result.pedidos.length,
      },
    });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ya existe una empresa demo con esos datos. Prueba de nuevo." });
    res.status(500).json({ error: err.message });
  }
});

router.patch("/empresas/:id", superAuth, async (req, res) => {
  const {
    plan,
    estado,
    fecha_vencimiento,
    ciclo_facturacion,
    bloqueo_motivo,
    bloqueo_manual,
    notas_comerciales,
    proxima_tarea,
    proxima_tarea_fecha,
    ia_limite_mensual,
    metodo_pago,
    iban_facturacion,
    email_facturacion,
  } = req.body;
  const updates = [], params = [];
  let i = 1;
  if (plan !== undefined) {
    if (!["lite","basico","profesional","enterprise"].includes(plan)) return res.status(400).json({ error: "Plan no válido" });
    updates.push(`plan=$${i++}`); params.push(plan);
  }
  if (estado !== undefined) {
    if (!["activo","suspendido","cancelado"].includes(estado)) return res.status(400).json({ error: "Estado no válido" });
    updates.push(`estado=$${i++}`); params.push(estado);
  }
  if ("fecha_vencimiento" in req.body) { updates.push(`fecha_vencimiento=$${i++}`); params.push(fecha_vencimiento || null); }
  if (ciclo_facturacion !== undefined) {
    if (!["mensual","anual"].includes(ciclo_facturacion)) return res.status(400).json({ error: "Ciclo no valido" });
    updates.push(`ciclo_facturacion=$${i++}`); params.push(ciclo_facturacion);
  }
  if ("metodo_pago" in req.body) {
    updates.push(`metodo_pago=$${i++}`); params.push(normalizeBillingMethod(metodo_pago));
  }
  if ("iban_facturacion" in req.body) { updates.push(`iban_facturacion=$${i++}`); params.push(iban_facturacion || null); }
  if ("email_facturacion" in req.body) { updates.push(`email_facturacion=$${i++}`); params.push(email_facturacion || null); }
  if ("bloqueo_motivo" in req.body) { updates.push(`bloqueo_motivo=$${i++}`); params.push(bloqueo_motivo || null); }
  if ("bloqueo_manual" in req.body) { updates.push(`bloqueo_manual=$${i++}`); params.push(Boolean(bloqueo_manual)); }
  if ("notas_comerciales" in req.body) { updates.push(`notas_comerciales=$${i++}`); params.push(notas_comerciales || null); }
  if ("proxima_tarea" in req.body) { updates.push(`proxima_tarea=$${i++}`); params.push(proxima_tarea || null); }
  if ("proxima_tarea_fecha" in req.body) { updates.push(`proxima_tarea_fecha=$${i++}`); params.push(proxima_tarea_fecha || null); }
  if ("ia_limite_mensual" in req.body) {
    const n = Number(ia_limite_mensual || 0);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "Limite IA no valido" });
    updates.push(`ia_limite_mensual=$${i++}`); params.push(n);
  }
  if (!updates.length) return res.status(400).json({ error: "Nada que actualizar" });
  params.push(req.params.id);
  await db.query(`UPDATE empresas SET ${updates.join(",")} WHERE id=$${i}`, params);
  await audit(req, "empresa.actualizada", req.body, req.params.id);
  res.json({ ok: true });
});

router.post("/empresas/:id/reset-password", superAuth, async (req, res) => {
  const password = String(req.body?.password || "").trim();
  if (password.length < 8) return res.status(400).json({ error: "La contrasena debe tener al menos 8 caracteres" });

  const empresaRes = await db.query("SELECT id,nombre,email_admin FROM empresas WHERE id=$1", [req.params.id]);
  const empresa = empresaRes.rows[0];
  if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

  const hash = await bcrypt.hash(password, 12);
  const userRes = await db.query(
    `SELECT id,nombre,email,username,rol
     FROM usuarios
     WHERE empresa_id=$1
     ORDER BY CASE WHEN rol='gerente' THEN 0 ELSE 1 END, activo DESC, created_at ASC
     LIMIT 1`,
    [empresa.id]
  );
  let usuario = userRes.rows[0];
  if (usuario) {
    const updated = await db.query(
      `UPDATE usuarios
       SET password_hash=$1, activo=true, debe_cambiar_password=true, password_changed_at=NULL,
           username=COALESCE(NULLIF(username,''), LOWER(COALESCE(email,$2)))
       WHERE id=$3
       RETURNING id,nombre,email,username,rol`,
      [hash, empresa.email_admin || null, usuario.id]
    );
    usuario = updated.rows[0];
  } else {
    const email = String(empresa.email_admin || `gerente.${empresa.id}@transgest.local`).trim().toLowerCase();
    const created = await db.query(
      `INSERT INTO usuarios (nombre,email,username,password_hash,rol,empresa_id,activo,debe_cambiar_password)
       VALUES ('Gerente', $1, $1, $2, 'gerente', $3, true, false)
       RETURNING id,nombre,email,username,rol`,
      [email, hash, empresa.id]
    );
    usuario = created.rows[0];
  }

  await audit(req, "empresa.password_reset", { usuario_id: usuario.id, email: usuario.email || usuario.username }, empresa.id);
  res.json({ ok: true, usuario: usuario.email || usuario.username });
});

router.post("/empresas/:id/reinvitar", superAuth, async (req, res) => {
  const empresaRes = await db.query("SELECT id,nombre,email_admin FROM empresas WHERE id=$1", [req.params.id]);
  const empresa = empresaRes.rows[0];
  if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

  const email = String(req.body?.email || empresa.email_admin || "").trim().toLowerCase();
  const nombre = String(req.body?.nombre || "Gerente").trim();
  if (!email) return res.status(400).json({ error: "La empresa no tiene email admin para enviar invitacion" });

  const result = await db.transaction(async (client) => {
    const existing = await client.query(
      `SELECT id,nombre,email,username,rol FROM usuarios
       WHERE empresa_id=$1 AND (LOWER(email)=LOWER($2) OR LOWER(username)=LOWER($2))
       ORDER BY CASE WHEN rol='gerente' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      [empresa.id, email]
    );
    let usuario = existing.rows[0];
    if (!usuario) {
      const tempHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12);
      const created = await client.query(
        `INSERT INTO usuarios (nombre,email,username,password_hash,rol,empresa_id,activo,debe_cambiar_password)
         VALUES ($1,$2,$2,$3,'gerente',$4,false,true)
         RETURNING id,nombre,email,username,rol`,
        [nombre, email, tempHash, empresa.id]
      );
      usuario = created.rows[0];
    } else {
      const updated = await client.query(
        `UPDATE usuarios SET email=COALESCE(email,$2), username=COALESCE(NULLIF(username,''),$2), debe_cambiar_password=true
         WHERE id=$1 RETURNING id,nombre,email,username,rol`,
        [usuario.id, email]
      );
      usuario = updated.rows[0];
    }
    const invitation = await createInvitationForUser({ client, empresa, usuario, actorEmail: req.superadmin.email });
    return { usuario, ...invitation };
  });

  const mail = await enviarEmail({
    trigger: "invitacion_usuario",
    destinatario: email,
    plantilla: "invitacion_usuario",
    datos: { nombre: result.usuario.nombre || nombre, empresa: empresa.nombre, url: result.url },
    empresa_id: empresa.id,
    force_platform: true,
  }).catch(e => ({ error: e.message }));

  await audit(req, "empresa.reinvitada", { email }, empresa.id);
  res.json({ ok: true, invitacion_url: result.url, invitacion_expira: result.expiresAt, email: mail });
});

router.post("/empresas/:id/billing/checkout", superAuth, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM empresas WHERE id=$1", [req.params.id]);
  const empresa = rows[0];
  if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });
  try {
    const session = await createBillingCheckoutForEmpresa(empresa, req.superadmin.id || null);
    await audit(req, "empresa.billing_checkout", { metodo_pago: empresa.metodo_pago || "auto" }, empresa.id);
    res.json({ ok: true, url: session.url });
  } catch (err) {
    if (err.code === "stripe_not_configured") {
      return res.status(503).json({ error: err.message, faltan: err.missing || [] });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/empresas/:id/billing/recordatorio", superAuth, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM empresas WHERE id=$1", [req.params.id]);
  const empresa = rows[0];
  if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });
  let checkoutUrl = "";
  if (stripe.configured() && stripe.planPriceId(empresa.plan, empresa.ciclo_facturacion)) {
    checkoutUrl = (await createBillingCheckoutForEmpresa(empresa, req.superadmin.id || null).catch(() => null))?.url || "";
  }
  try {
    const mail = await sendBillingReminder(empresa, req.body?.tipo || "auto", checkoutUrl);
    await audit(req, "empresa.billing_recordatorio", { tipo: req.body?.tipo || "auto" }, empresa.id);
    res.json({ ok: true, email: mail, checkout_url: checkoutUrl || null });
  } catch (err) {
    res.status(err.code === "missing_billing_email" ? 400 : 500).json({ error: err.message });
  }
});

// ── GET /superadmin/stats — Métricas globales ─────────────────────────────
router.get("/stripe/status", superAuth, async (req, res) => {
  res.json({
    configured: stripe.configured(),
    prices: {
      lite: {
        mensual: Boolean(stripe.planPriceId("lite", "mensual")),
        anual: Boolean(stripe.planPriceId("lite", "anual")),
      },
      basico: {
        mensual: Boolean(stripe.planPriceId("basico", "mensual")),
        anual: Boolean(stripe.planPriceId("basico", "anual")),
      },
      profesional: {
        mensual: Boolean(stripe.planPriceId("profesional", "mensual")),
        anual: Boolean(stripe.planPriceId("profesional", "anual")),
      },
      enterprise: {
        mensual: Boolean(stripe.planPriceId("enterprise", "mensual")),
        anual: Boolean(stripe.planPriceId("enterprise", "anual")),
      },
    },
  });
});

router.get("/salud", superAuth, async (req, res) => {
  res.json(await buildSaasHealthRows());
});

router.get("/salud/informe", superAuth, async (req, res) => {
  try {
    const empresas = await buildSaasHealthRows();
    const html = buildSaasHealthInformeHtml(empresas, req);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`salud-saas-${new Date().toISOString().slice(0, 10)}.html`)}"`);
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo generar el informe de salud SaaS" });
  }
});

router.get("/salud/resumen", superAuth, async (req, res) => {
  const empresas = await buildSaasHealthRows();
  const resumen = empresas.reduce((acc, e) => {
    acc.total += 1;
    acc.por_color[e.color] = (acc.por_color[e.color] || 0) + 1;
    if (e.estado === "activo") acc.activas += 1;
    else acc.no_activas += 1;
    if (e.bloqueo_manual) acc.bloqueadas += 1;
    if (Number(e.backups_pendientes || 0) > 0) acc.backups_pendientes += Number(e.backups_pendientes || 0);
    acc.backups_resueltos += Number(e.backups_resueltos || 0);
    if (e.dias_vencimiento !== null && e.dias_vencimiento < 0) acc.vencidas += 1;
    if (e.dias_vencimiento !== null && e.dias_vencimiento >= 0 && e.dias_vencimiento <= 7) acc.vencen_7d += 1;
    if (Number(e.gerentes_activos || 0) === 0) acc.sin_gerente += 1;
    if (Number(e.usuarios_activos || 0) === 0) acc.sin_usuarios += 1;
    if (Number(e.clientes_activos || 0) === 0) acc.sin_clientes += 1;
    if (e.estado === "activo" && Number(e.pedidos_30d || 0) === 0) acc.sin_actividad_30d += 1;
    if (Number(e.ia_limite_mensual || 0) > 0 && Number(e.ia_usos_mes || 0) >= Number(e.ia_limite_mensual || 0)) acc.ia_agotada += 1;
    acc.usuarios_activos += Number(e.usuarios_activos || 0);
    acc.gerentes_activos += Number(e.gerentes_activos || 0);
    acc.clientes_activos += Number(e.clientes_activos || 0);
    acc.pedidos_30d += Number(e.pedidos_30d || 0);
    return acc;
  }, {
    total: 0,
    activas: 0,
    no_activas: 0,
    bloqueadas: 0,
    vencidas: 0,
    vencen_7d: 0,
    backups_pendientes: 0,
    backups_resueltos: 0,
    sin_gerente: 0,
    sin_usuarios: 0,
    sin_clientes: 0,
    sin_actividad_30d: 0,
    ia_agotada: 0,
    usuarios_activos: 0,
    gerentes_activos: 0,
    clientes_activos: 0,
    pedidos_30d: 0,
    por_color: { verde: 0, amarillo: 0, rojo: 0 },
  });
  res.json({
    resumen,
    criticas: empresas.filter(e => e.color === "rojo").slice(0, 20),
    avisos: empresas.filter(e => e.color === "amarillo").slice(0, 20),
    generated_at: new Date().toISOString(),
  });
});

router.get("/auditoria", superAuth, async (req, res) => {
  const { empresa_id, limit = 100 } = req.query;
  const params = [];
  let where = "";
  if (empresa_id) {
    params.push(empresa_id);
    where = "WHERE a.empresa_id=$1";
  }
  params.push(Math.min(Number(limit) || 100, 500));
  const { rows } = await db.query(
    `SELECT a.*, e.nombre AS empresa_nombre
     FROM audit_log_saas a
     LEFT JOIN empresas e ON e.id=a.empresa_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  res.json(rows);
});

router.get("/backups", superAuth, async (req, res) => {
  const status = getBackupStatus();
  const backups = listBackups().map(b => ({
    filename: b.filename,
    type: b.type,
    size_kb: Math.round(b.size / 1024),
    created: b.created,
  }));
  res.json({ backups, count: backups.length, status });
});

router.get("/backups/download/:filename", superAuth, async (req, res) => {
  const filepath = backupPath(req.params.filename);
  if (!filepath) return res.status(400).json({ error: "Nombre de backup no valido" });
  res.download(filepath, req.params.filename);
});

router.get("/backups/solicitudes", superAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT bs.*, e.nombre AS empresa_nombre, u.nombre AS solicitado_por_nombre, u.email AS solicitado_por_email
    FROM backup_solicitudes bs
    LEFT JOIN empresas e ON e.id=bs.empresa_id
    LEFT JOIN usuarios u ON u.id=bs.solicitado_por
    ORDER BY CASE WHEN bs.estado='pendiente' THEN 0 ELSE 1 END, bs.created_at DESC
  `);
  res.json(rows);
});

router.post("/backups/solicitudes/:id/generar", superAuth, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM backup_solicitudes WHERE id=$1", [req.params.id]);
  const solicitud = rows[0];
  if (!solicitud) return res.status(404).json({ error: "Solicitud no encontrada" });
  try {
    const filename = await runBackup();
    await db.query(
      `UPDATE backup_solicitudes
       SET estado='generado', filename=$1, resuelto_por=$2, resuelto_at=NOW()
       WHERE id=$3`,
      [filename, req.superadmin.id || null, req.params.id]
    );
    await audit(req, "backup.generado", { solicitud_id: req.params.id, filename }, solicitud.empresa_id);
    res.json({ ok: true, filename });
  } catch (e) {
    res.status(500).json({ error: "Error al ejecutar backup: " + e.message });
  }
});

router.post("/empresas/:id/ampliar-gracia", superAuth, async (req, res) => {
  const dias = Math.max(1, Math.min(Number(req.body?.dias || 7), 90));
  const { rows } = await db.query(
    `UPDATE empresas
     SET fecha_vencimiento=GREATEST(COALESCE(fecha_vencimiento, CURRENT_DATE), CURRENT_DATE) + ($1 || ' days')::interval,
         estado='activo',
         bloqueo_manual=false,
         bloqueo_motivo=NULL
     WHERE id=$2
     RETURNING id,nombre,fecha_vencimiento`,
    [dias, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Empresa no encontrada" });
  await audit(req, "empresa.gracia", { dias }, req.params.id);
  res.json(rows[0]);
});

router.get("/stats", superAuth, async (req, res) => {
  const [empresas, usuarios, pedidos, facturasPrograma, pendientesPrograma, empresasPlanes] = await Promise.all([
    db.query("SELECT COUNT(*) FROM empresas WHERE estado='activo'"),
    db.query("SELECT COUNT(*) FROM usuarios"),
    db.query("SELECT COUNT(*) FROM pedidos WHERE fecha_pedido >= NOW()-INTERVAL '30 days'"),
    db.query("SELECT COALESCE(SUM(importe),0) AS total FROM facturas_suscripcion WHERE fecha_emision >= date_trunc('month', CURRENT_DATE)").catch(() => ({ rows: [{ total: 0 }] })),
    db.query("SELECT COALESCE(SUM(importe),0) AS total FROM facturas_suscripcion WHERE estado IN ('pendiente','vencida')").catch(() => ({ rows: [{ total: 0 }] })),
    db.query("SELECT plan, ciclo_facturacion FROM empresas WHERE estado='activo'"),
  ]);
  const mrr = empresasPlanes.rows.reduce((sum, e) => sum + monthlyPlanValue(e.plan, e.ciclo_facturacion), 0);
  res.json({
    empresas_activas: parseInt(empresas.rows[0].count),
    usuarios_total:   parseInt(usuarios.rows[0].count),
    pedidos_mes:      parseInt(pedidos.rows[0].count),
    mrr_estimado:     mrr,
    arr_estimado:     mrr * 12,
    facturacion_programa_mes: parseFloat(facturasPrograma.rows[0].total),
    pendiente_programa:       parseFloat(pendientesPrograma.rows[0].total),
  });
});

// ── DELETE /superadmin/empresas/:id — Eliminar empresa ───────────────────
router.delete("/empresas/:id", superAuth, async (req, res) => {
  if (!req.body.confirmar) return res.status(400).json({ error: "Incluye confirmar:true" });
  await db.query("UPDATE empresas SET estado='cancelado' WHERE id=$1", [req.params.id]);
  logger.warn(`Empresa ${req.params.id} marcada como cancelada por superadmin ${req.superadmin.email}`);
  res.json({ ok: true });
});

// ── POST /superadmin/facturas-suscripcion — Emitir factura a empresa ─────
router.post("/empresas/:id/impersonar", superAuth, async (req, res) => {
  let { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.username, u.rol, u.empresa_id, e.plan, e.nombre AS empresa
     FROM usuarios u
     JOIN empresas e ON e.id=u.empresa_id
     WHERE u.empresa_id=$1
     ORDER BY CASE WHEN u.rol='gerente' THEN 0 ELSE 1 END, u.activo DESC, u.created_at ASC
     LIMIT 1`,
    [req.params.id]
  );
  let user = rows[0];
  if (!user) {
    const empresaRes = await db.query("SELECT id,nombre,plan,email_admin FROM empresas WHERE id=$1", [req.params.id]);
    const empresa = empresaRes.rows[0];
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });
    const email = String(empresa.email_admin || `soporte.${empresa.id}@transgest.local`).trim().toLowerCase();
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12);
    const created = await db.query(
      `INSERT INTO usuarios (nombre,email,username,password_hash,rol,empresa_id,activo,debe_cambiar_password)
       VALUES ('Soporte TransGest', $1, $1, $2, 'gerente', $3, true, true)
       RETURNING id,nombre,email,username,rol,empresa_id`,
      [email, hash, empresa.id]
    );
    user = {
      ...created.rows[0],
      plan: empresa.plan,
      empresa: empresa.nombre,
    };
  }

  const token = jwt.sign(
    {
      sub: user.id,
      rol: user.rol,
      empresa_id: user.empresa_id,
      plan: user.plan,
      superadmin_impersonation: true,
      impersonado_por: req.superadmin.email,
    },
    userJwtSecret(),
    { expiresIn: "2h" }
  );

  await audit(req, "empresa.impersonar", { usuario_id: user.id, rol: user.rol }, user.empresa_id);
  res.json({
    token,
    user: {
      id: user.id,
      nombre: `${user.nombre} (soporte)`,
      email: user.email,
      username: user.username,
      rol: user.rol,
      empresa: user.empresa,
      impersonado_por: req.superadmin.email,
    },
  });
});

router.post("/facturas-suscripcion", superAuth, async (req, res) => {
  const { empresa_id, concepto, plan, periodo_desde, periodo_hasta, importe, fecha_vencimiento } = req.body;
  if (!empresa_id || !importe || !periodo_desde || !periodo_hasta) {
    return res.status(400).json({ error: "empresa_id, importe, periodo_desde y periodo_hasta son obligatorios" });
  }
  try {
    // Check table exists, create if not
    await db.query(`
      CREATE TABLE IF NOT EXISTS facturas_suscripcion (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero VARCHAR(30) NOT NULL,
        concepto VARCHAR(200) NOT NULL DEFAULT 'Suscripción TransGest',
        plan VARCHAR(20),
        periodo_desde DATE NOT NULL,
        periodo_hasta DATE NOT NULL,
        importe NUMERIC(8,2) NOT NULL,
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
        fecha_vencimiento DATE,
        fecha_pago DATE,
        notas TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Generate number
    const last = await db.query("SELECT numero FROM facturas_suscripcion ORDER BY created_at DESC LIMIT 1");
    const lastN = last.rows[0] ? parseInt(last.rows[0].numero.replace(/[^0-9]/g,"")) : 0;
    const numero = "FTMS-" + String(new Date().getFullYear()) + "-" + String(lastN+1).padStart(4,"0");
    const { rows } = await db.query(`
      INSERT INTO facturas_suscripcion (empresa_id, numero, concepto, plan, periodo_desde, periodo_hasta, importe, fecha_vencimiento)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [empresa_id, numero, concepto||"Suscripción TransGest", plan||null, periodo_desde, periodo_hasta, importe, fecha_vencimiento||null]);
    res.status(201).json(rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /superadmin/facturas-suscripcion/:id — Marcar pagada/vencida ────
router.patch("/facturas-suscripcion/:id", superAuth, async (req, res) => {
  const { estado, fecha_pago } = req.body;
  await db.query(
    "UPDATE facturas_suscripcion SET estado=$1, fecha_pago=$2 WHERE id=$3",
    [estado, fecha_pago||null, req.params.id]
  );
  res.json({ ok: true });
});

router.get("/integraciones", superAuth, async (req, res, next) => {
  try {
    await ensureApiKeyTables();
    const empresas = await db.query("SELECT id,nombre,plan,estado,ia_limite_mensual,ia_usos_mes,ia_periodo_mes,configuracion FROM empresas ORDER BY nombre ASC");
    const companyRows = await db.query(`
      SELECT empresa_id,provider,key_mask,use_global,activo,limite_mensual,usos_mes,periodo_mes,updated_at
      FROM empresa_api_configs
      ORDER BY updated_at DESC
    `);
    const gpsActiveRows = await db.query(
      `SELECT DISTINCT ON (empresa_id) empresa_id, provider
       FROM empresa_api_configs
       WHERE provider = ANY($1::varchar[]) AND activo=true
       ORDER BY empresa_id, updated_at DESC`,
      [GPS_PROVIDERS]
    );
    const gps_active = gpsActiveRows.rows.reduce((acc, row) => {
      acc[row.empresa_id] = row.provider;
      return acc;
    }, {});
    const webhookRows = await db.query(`
      SELECT empresa_id, provider, token_mask, activo, created_at, updated_at, last_used_at
      FROM gps_webhook_tokens
      ORDER BY updated_at DESC
    `).catch(() => ({ rows: [] }));
    const global = {};
    for (const provider of API_PROVIDERS) global[provider] = await publicStatusForProvider(provider);
    const aiProvider = normalizeAiProvider(await getGlobalSetting("ia_provider", process.env.AI_PROVIDER || "anthropic"));
    const ai = {
      provider: aiProvider,
      base_url: await getGlobalSetting("ia_base_url", process.env.AI_BASE_URL || ""),
      model: normalizeAiModel(aiProvider, await getGlobalSetting("ia_model", process.env.AI_MODEL || "")),
    };
    const app_meta = await getAppMeta();
    const fiscal_configs = empresas.rows.map((empresa) => {
      const fiscalConfig = normalizeFiscalConfig(empresa?.configuracion?.facturacion_fiscal || {});
      fiscalConfig.verifactu.software_version = app_meta.version;
      fiscalConfig.verifactu.software_nombre = app_meta.fiscal_software_name;
      fiscalConfig.verifactu.software_id = app_meta.fiscal_software_id;
      const fiscalStatus = buildFiscalStatus(fiscalConfig);
      return {
        empresa_id: empresa.id,
        modo: fiscalConfig.modo,
        entorno: fiscalConfig.entorno,
        email_alertas: fiscalConfig.email_alertas || "",
        verifactu_provider: fiscalConfig.verifactu?.proveedor || "directo",
        sii_emitidas: !!fiscalConfig.sii?.incluir_emitidas,
        sii_recibidas: !!fiscalConfig.sii?.incluir_recibidas,
        ultima_prueba: fiscalConfig.ultima_prueba || null,
        historial_pruebas: Array.isArray(fiscalConfig.historial_pruebas) ? fiscalConfig.historial_pruebas : [],
        status: fiscalStatus,
      };
    });
    res.json({
      providers: API_PROVIDERS,
      ai_providers: AI_PROVIDERS,
      gps_providers: GPS_PROVIDERS,
      app_meta,
      ai,
      global,
      empresas: empresas.rows.map(({ configuracion, ...empresa }) => empresa),
      configs: companyRows.rows,
      gps_active,
      gps_webhooks: webhookRows.rows,
      fiscal_configs,
    });
  } catch (e) { next(e); }
});

router.get("/integraciones/salud", superAuth, async (req, res, next) => {
  try {
    const report = await buildIntegracionesSalud();
    res.json(report);
  } catch (e) { next(e); }
});

router.get("/integraciones/contabilidad", superAuth, async (req, res, next) => {
  try {
    const governance = buildAccountingIntegrationsGovernance();
    const companySettings = await listCompanyAccountingIntegrationConfigs();
    const history = await db.query(`
      SELECT
        a.id,
        a.empresa_id,
        e.nombre AS empresa_nombre,
        a.actor_email,
        a.detalle,
        a.created_at
      FROM audit_log_saas a
      LEFT JOIN empresas e ON e.id=a.empresa_id
      WHERE a.accion='integracion.contabilidad.empresa_actualizada'
      ORDER BY a.created_at DESC
      LIMIT 50
    `).catch(() => ({ rows: [] }));
    await audit(req, "integracion.contabilidad.catalogo_consultado", {
      catalog_version: governance.catalog_version,
      total: governance.summary?.total || 0,
    });
    res.json({
      ...governance,
      company_settings: companySettings,
      company_summary: summarizeCompanyAccountingSettings(companySettings),
      history: history.rows,
    });
  } catch (e) { next(e); }
});

router.get("/integraciones/contabilidad/export.csv", superAuth, async (req, res, next) => {
  try {
    const companySettings = await listCompanyAccountingIntegrationConfigs();
    const statusLabel = {
      not_configured: "Sin configurar",
      assessing: "Evaluando",
      export_ready: "Exportacion lista",
      pilot: "Piloto",
      active: "Activo",
      paused: "Pausado",
    };
    const modeLabel = {
      export_first: "Exportar primero",
      advisor_export: "Paquete asesoria",
      api_with_outbox: "API + outbox",
      bidirectional_with_approval: "Bidireccional con aprobacion",
      file_import_export: "Ficheros import/export",
      fiscal_boundary_export: "Frontera fiscal",
      plugin_or_api: "Plugin/API",
    };
    const mappingLabel = {
      pending: "Pendiente",
      drafted: "Borrador",
      validated: "Validado",
    };
    const formatMappingItems = item => Object.entries(item.mapping_items || {})
      .filter(([, ready]) => ready)
      .map(([key]) => ACCOUNTING_MAPPING_ITEM_LABELS[key] || key)
      .join(", ");
    const headers = [
      "Empresa",
      "Programa",
      "Estado",
      "Modo",
      "Mapeo",
      "Mapeados",
      "Modulos mapeados",
      "Responsable",
      "Asesoria",
      "Notas",
      "Actualizado",
    ];
    const rows = companySettings.map(item => ({
      Empresa: item.empresa_nombre || "",
      Programa: item.connector_name || "",
      Estado: statusLabel[item.status] || item.status || "",
      Modo: modeLabel[item.mode] || item.mode || "",
      Mapeo: mappingLabel[item.mapping_status] || item.mapping_status || "",
      Mapeados: `${Number(item.mapping_ready_count || 0)}/6`,
      "Modulos mapeados": formatMappingItems(item),
      Responsable: item.owner_email || "",
      Asesoria: item.advisor_name || "",
      Notas: item.notes || "",
      Actualizado: item.updated_at ? new Date(item.updated_at).toISOString() : "",
    }));
    await audit(req, "integracion.contabilidad.export_csv", {
      total: rows.length,
      configured: rows.filter(row => row.Programa).length,
    });
    const filename = safeFilename(`integraciones-contables-${new Date().toISOString().slice(0, 10)}.csv`, "integraciones-contables.csv");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`\uFEFF${buildCsv(headers, rows)}`);
  } catch (e) { next(e); }
});

router.put("/integraciones/contabilidad/empresas/:empresaId", superAuth, async (req, res, next) => {
  try {
    const empresa = await db.query("SELECT id,nombre FROM empresas WHERE id=$1", [req.params.empresaId]);
    if (!empresa.rows[0]) return res.status(404).json({ error: "Empresa no encontrada" });
    const config = await upsertCompanyAccountingIntegrationConfig(
      req.params.empresaId,
      req.body || {},
      req.superadmin?.id || null
    );
    await audit(req, "integracion.contabilidad.empresa_actualizada", {
      connector_id: config.connector_id,
      connector_name: config.connector_name,
      status: config.status,
      mode: config.mode,
      mapping_status: config.mapping_status,
      mapping_ready_count: config.mapping_ready_count,
    }, req.params.empresaId);
    res.json({ ok: true, config: { ...config, empresa_nombre: empresa.rows[0].nombre } });
  } catch (e) { next(e); }
});

router.put("/integraciones/global/:provider", superAuth, async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!API_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor no valido" });
    const apiKey = String(req.body?.api_key || "").trim();
    if (!apiKey) return res.status(400).json({ error: "Clave API obligatoria" });
    await setGlobalApiKey(provider, apiKey);
    await audit(req, "integracion.global.actualizada", { provider });
    res.json({ ok: true, status: await publicStatusForProvider(provider) });
  } catch (e) { next(e); }
});

router.delete("/integraciones/global/:provider", superAuth, async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!API_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor no valido" });
    await deleteGlobalApiKey(provider);
    await audit(req, "integracion.global.eliminada", { provider });
    res.json({ ok: true, status: await publicStatusForProvider(provider) });
  } catch (e) { next(e); }
});

router.post("/integraciones/global/:provider/test", superAuth, async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!API_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor no valido" });
    const resolved = await resolveApiKey(null, provider);
    let providerTest = null;
    if (AI_PROVIDERS.includes(provider) && resolved.key) {
      const selectedProvider = normalizeAiProvider(await getGlobalSetting("ia_provider", process.env.AI_PROVIDER || "anthropic"));
      providerTest = await testAiProviderConnection({
        provider,
        apiKey: resolved.key,
        model: req.body?.model || (provider === selectedProvider ? await getGlobalSetting("ia_model", process.env.AI_MODEL || "") : ""),
        baseUrl: req.body?.base_url || (provider === selectedProvider ? await getGlobalSetting("ia_base_url", process.env.AI_BASE_URL || "") : ""),
      });
    } else if (resolved.key) {
      providerTest = await testGpsProviderConnection(provider, resolved.key, null);
    }
    const ok = Boolean(resolved.key) && Boolean(providerTest?.ok);
    await audit(req, "integracion.global.test", {
      provider,
      ok,
      source: resolved.source,
      model: providerTest?.model || null,
    });
    res.json({
      ok,
      provider,
      source: resolved.source,
      has_key: Boolean(resolved.key),
      model: providerTest?.model || null,
      message: providerTest?.message || "No hay una clave global configurada para este proveedor.",
      provider_test: providerTest,
    });
  } catch (e) { next(e); }
});

router.put("/integraciones/empresas/:empresaId/:provider", superAuth, async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!API_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor no valido" });
    const exists = await db.query("SELECT id FROM empresas WHERE id=$1", [req.params.empresaId]);
    if (!exists.rows[0]) return res.status(404).json({ error: "Empresa no encontrada" });
    await setCompanyApiConfig(req.params.empresaId, provider, req.body || {}, req.superadmin?.id || null);
    if (GPS_PROVIDERS.includes(provider) && req.body?.activo !== false) {
      await db.query(
        `UPDATE empresa_api_configs
         SET activo=false, updated_at=NOW()
         WHERE empresa_id=$1 AND provider <> $2 AND provider = ANY($3::varchar[])`,
        [req.params.empresaId, provider, GPS_PROVIDERS]
      );
    }
    await audit(req, "integracion.empresa.actualizada", {
      provider,
      use_global: req.body?.use_global,
      activo: req.body?.activo,
      limite_mensual: req.body?.limite_mensual,
      gps_unico: GPS_PROVIDERS.includes(provider) ? true : undefined,
    }, req.params.empresaId);
    res.json({ ok: true, status: await publicStatusForProvider(provider, req.params.empresaId) });
  } catch (e) { next(e); }
});

// ── GET/SET Anthropic API Key (superadmin only) ─────────────────────
router.post("/integraciones/empresas/:empresaId/:provider/test", superAuth, async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!API_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor no valido" });
    const exists = await db.query("SELECT id,nombre FROM empresas WHERE id=$1", [req.params.empresaId]);
    if (!exists.rows[0]) return res.status(404).json({ error: "Empresa no encontrada" });

    const [status, resolved, gpsRows] = await Promise.all([
      publicStatusForProvider(provider, req.params.empresaId),
      resolveApiKey(req.params.empresaId, provider),
      GPS_PROVIDERS.includes(provider)
        ? db.query(
            `SELECT provider
             FROM empresa_api_configs
             WHERE empresa_id=$1 AND provider = ANY($2::varchar[]) AND activo=true
             ORDER BY updated_at DESC`,
            [req.params.empresaId, GPS_PROVIDERS]
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const gpsActive = gpsRows.rows[0]?.provider || "";
    const gpsConflict = GPS_PROVIDERS.includes(provider) && gpsActive && gpsActive !== provider;
    const ok = Boolean(resolved.key) && resolved.source !== "disabled" && !gpsConflict;
    const reasons = [];
    if (!resolved.key) reasons.push(status.use_global === false ? "falta clave propia" : "falta clave global o propia");
    if (resolved.source === "disabled") reasons.push("integracion bloqueada");
    if (gpsConflict) reasons.push(`GPS activo: ${gpsActive}`);
    const providerTest = ok ? await (AI_PROVIDERS.includes(provider)
      ? (async () => {
          const selectedProvider = normalizeAiProvider(await getGlobalSetting("ia_provider", process.env.AI_PROVIDER || "anthropic"));
          return testAiProviderConnection({
          provider,
          apiKey: resolved.key,
          model: provider === selectedProvider ? await getGlobalSetting("ia_model", process.env.AI_MODEL || "") : "",
          baseUrl: provider === selectedProvider ? await getGlobalSetting("ia_base_url", process.env.AI_BASE_URL || "") : "",
          });
        })()
      : testGpsProviderConnection(provider, resolved.key, req.params.empresaId)).catch(e => ({
      ok: false,
      provider,
      message: e.message || "No se pudo comprobar el proveedor.",
    })) : null;
    const finalOk = ok && (providerTest ? providerTest.ok : true);
    if (providerTest && !providerTest.ok) reasons.push(providerTest.message || "prueba del proveedor fallida");

    await audit(req, "integracion.empresa.test", { provider, ok: finalOk, source: resolved.source, reasons }, req.params.empresaId);
    res.json({
      ok: finalOk,
      provider,
      empresa_id: req.params.empresaId,
      empresa_nombre: exists.rows[0].nombre,
      source: resolved.source,
      has_key: Boolean(resolved.key),
      key_mask: status.company_masked || "",
      use_global: status.use_global,
      activo: status.activo,
      limite_mensual: status.limite_mensual,
      usos_mes: status.usos_mes,
      gps_active: gpsActive,
      provider_test: providerTest,
      reasons,
      message: finalOk
        ? (providerTest?.message || `Configuracion lista (${resolved.source}).`)
        : `Configuracion incompleta: ${reasons.join(", ") || "sin clave"}.`,
    });
  } catch (e) { next(e); }
});

router.post("/integraciones/fiscal/:empresaId/test", superAuth, async (req, res, next) => {
  try {
    const empresaRes = await db.query(
      "SELECT id,nombre,configuracion FROM empresas WHERE id=$1",
      [req.params.empresaId]
    );
    const empresa = empresaRes.rows[0];
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });
    const fiscalConfig = normalizeFiscalConfig(empresa?.configuracion?.facturacion_fiscal || {});
    const appMeta = await getAppMeta();
    fiscalConfig.verifactu.software_version = appMeta.version;
    fiscalConfig.verifactu.software_nombre = appMeta.fiscal_software_name;
    fiscalConfig.verifactu.software_id = appMeta.fiscal_software_id;
    const test = await testFiscalConnection(fiscalConfig);
    const savedConfig = await saveEmpresaFiscalTestResult(empresa.id, test);
    await audit(req, "integracion.fiscal.test", {
      ok: test.ok,
      mode: test.mode,
      provider: test.provider,
      transport_stage: test.transport?.stage || null,
      http_status: test.transport?.http_status || null,
    }, req.params.empresaId);
    res.json({
      ok: true,
      empresa_id: empresa.id,
      empresa_nombre: empresa.nombre,
      config: {
        modo: savedConfig.modo,
        entorno: savedConfig.entorno,
        email_alertas: savedConfig.email_alertas || "",
        verifactu_provider: savedConfig.verifactu?.proveedor || "directo",
        ultima_prueba: savedConfig.ultima_prueba || null,
        historial_pruebas: Array.isArray(savedConfig.historial_pruebas) ? savedConfig.historial_pruebas : [],
      },
      status: buildFiscalStatus(savedConfig),
      test,
    });
  } catch (e) { next(e); }
});

router.put("/integraciones/fiscal/:empresaId/alertas", superAuth, async (req, res, next) => {
  try {
    const empresaRes = await db.query(
      "SELECT id,nombre,configuracion FROM empresas WHERE id=$1",
      [req.params.empresaId]
    );
    const empresa = empresaRes.rows[0];
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

    const email = String(req.body?.email_alertas || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Email de alertas no valido" });
    }

    const current = normalizeFiscalConfig(empresa?.configuracion?.facturacion_fiscal || {});
    const savedConfig = await saveEmpresaFiscalConfig(empresa.id, {
      ...current,
      email_alertas: email,
    });
    await audit(req, "integracion.fiscal.alertas.actualizada", {
      email_alertas: email ? "configurado" : "vacio",
    }, req.params.empresaId);
    res.json({
      ok: true,
      empresa_id: empresa.id,
      empresa_nombre: empresa.nombre,
      config: sanitizeFiscalConfigForClient(savedConfig),
      status: buildFiscalStatus(savedConfig),
      message: email ? "Email de alertas fiscales guardado." : "Email de alertas fiscales eliminado.",
    });
  } catch (e) { next(e); }
});

router.post("/integraciones/empresas/:empresaId/:provider/webhook-token", superAuth, async (req, res, next) => {
  try {
    await ensureApiKeyTables();
    const provider = String(req.params.provider || "").toLowerCase();
    if (!GPS_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor GPS no valido" });
    const exists = await db.query("SELECT id,nombre FROM empresas WHERE id=$1", [req.params.empresaId]);
    if (!exists.rows[0]) return res.status(404).json({ error: "Empresa no encontrada" });
    const token = `tgps_${provider}_${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(token);
    const tokenMask = `${token.slice(0, 14)}...${token.slice(-6)}`;
    const { rows } = await db.query(
      `INSERT INTO gps_webhook_tokens
        (empresa_id, provider, token_hash, token_mask, activo, created_by, updated_at)
       VALUES ($1,$2,$3,$4,true,$5,NOW())
       ON CONFLICT (empresa_id, provider) DO UPDATE SET
         token_hash=$3,
         token_mask=$4,
         activo=true,
         created_by=$5,
         updated_at=NOW()
       RETURNING empresa_id, provider, token_mask, activo, created_at, updated_at, last_used_at`,
      [req.params.empresaId, provider, tokenHash, tokenMask, req.superadmin?.id || null]
    );
    await audit(req, "integracion.gps.webhook_token.rotado", { provider }, req.params.empresaId);
    res.json({
      ok: true,
      token,
      token_mask: tokenMask,
      webhook_url: `${appUrl()}/api/v1/gps/webhook/${req.params.empresaId}/${provider}`,
      status: rows[0],
      message: "Copia este token ahora. No se volvera a mostrar completo.",
    });
  } catch (e) { next(e); }
});

router.delete("/integraciones/empresas/:empresaId/:provider/webhook-token", superAuth, async (req, res, next) => {
  try {
    await ensureApiKeyTables();
    const provider = String(req.params.provider || "").toLowerCase();
    if (!GPS_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor GPS no valido" });
    await db.query(
      "UPDATE gps_webhook_tokens SET activo=false, updated_at=NOW() WHERE empresa_id=$1 AND provider=$2",
      [req.params.empresaId, provider]
    );
    await audit(req, "integracion.gps.webhook_token.desactivado", { provider }, req.params.empresaId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.put("/integraciones/ia", superAuth, async (req, res, next) => {
  try {
    const provider = normalizeAiProvider(req.body?.provider);
    if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor de IA no valido" });
    const model = normalizeAiModel(provider, req.body?.model);
    await setGlobalSetting("ia_provider", provider);
    await setGlobalSetting("ia_base_url", String(req.body?.base_url || "").trim());
    await setGlobalSetting("ia_model", model);
    await audit(req, "integracion.ia.configurada", { provider });
    res.json({
      ok: true,
      ai: {
        provider,
        base_url: await getGlobalSetting("ia_base_url", ""),
        model: await getGlobalSetting("ia_model", ""),
      },
    });
  } catch (e) { next(e); }
});

router.get("/config/ia-key", superAuth, async (req, res) => {
  try {
    const provider = normalizeAiProvider(await getGlobalSetting("ia_provider", process.env.AI_PROVIDER || "anthropic"));
    const status = await publicStatusForProvider(provider);
    res.json({
      provider,
      configured: !!status.global_configured,
      masked: "",
      source: status.global_source,
      base_url: await getGlobalSetting("ia_base_url", process.env.AI_BASE_URL || ""),
      model: normalizeAiModel(provider, await getGlobalSetting("ia_model", process.env.AI_MODEL || "")),
    });
  } catch(e) {
    const key = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "";
    res.json({ provider: process.env.AI_PROVIDER || "anthropic", configured: !!key, masked: "", source: key ? "env" : "none" });
  }
});

router.get("/integraciones/fiscal/:empresaId/queue-summary", superAuth, async (req, res, next) => {
  try {
    const empresaId = req.params.empresaId;
    const empresaRes = await db.query("SELECT id FROM empresas WHERE id=$1", [empresaId]);
    if (!empresaRes.rows[0]) return res.status(404).json({ error: "Empresa no encontrada" });
    const summary = await getEmpresaFiscalQueueSummary(empresaId);
    res.json(summary);
  } catch (e) { next(e); }
});

router.post("/integraciones/fiscal/:empresaId/process-queue", superAuth, async (req, res, next) => {
  try {
    const empresaId = req.params.empresaId;
    const empresaRes = await db.query("SELECT id,nombre FROM empresas WHERE id=$1", [empresaId]);
    if (!empresaRes.rows[0]) return res.status(404).json({ error: "Empresa no encontrada" });
    const limit = Math.max(1, Math.min(Number(req.body?.limit || 20), 50));
    const result = await processPendingFiscalQueue({
      empresaId,
      actorUserId: null,
      limit,
    });
    await audit(req, "integracion.fiscal.process_queue", {
      limit,
      total: result.total,
      accepted: result.accepted,
      errors: result.errors,
      deferred: result.deferred,
    }, empresaId);
    res.json({
      ok: true,
      empresa_id: empresaId,
      empresa_nombre: empresaRes.rows[0].nombre,
      result,
    });
  } catch (e) { next(e); }
});

router.post("/integraciones/fiscal/:empresaId/facturas/:facturaId/requeue", superAuth, async (req, res, next) => {
  try {
    const { empresaId, facturaId } = req.params;
    const factura = await db.query(
      "SELECT id, numero FROM facturas WHERE id=$1 AND empresa_id=$2",
      [facturaId, empresaId]
    );
    if (!factura.rows[0]) return res.status(404).json({ error: "Factura no encontrada para esta empresa" });

    const result = await db.transaction(async (client) => {
      const fiscalResult = await ensureFacturaFiscalRecord({
        facturaId,
        empresaId,
        actorUserId: null,
        force: true,
        client,
      });
      if (fiscalResult.skipped && fiscalResult.reason !== "already_exists") return fiscalResult;
      const record = fiscalResult.record;
      const { rows: pendingRows } = await client.query(
        `SELECT id
           FROM factura_envios_fiscales
          WHERE factura_id=$1 AND empresa_id=$2 AND estado IN ('pendiente','procesando')
          ORDER BY created_at DESC
          LIMIT 1`,
        [facturaId, empresaId]
      );
      if (!pendingRows[0]) {
        await client.query(
          `INSERT INTO factura_envios_fiscales
            (registro_id, factura_id, empresa_id, sistema, entorno, estado, payload, next_retry_at)
           VALUES ($1,$2,$3,$4,$5,'pendiente',$6::jsonb,NOW())`,
          [record.id, facturaId, empresaId, record.modo, record.entorno, JSON.stringify(record.payload || {})]
        );
      }
      await client.query(
        `INSERT INTO factura_eventos_fiscales
          (registro_id, factura_id, empresa_id, evento_tipo, detalle)
         VALUES ($1,$2,$3,'queue.superadmin_requeue',$4::jsonb)`,
        [record.id, facturaId, empresaId, JSON.stringify({ superadmin_id: req.superadmin?.id || null, superadmin_email: req.superadmin?.email || "", reused_pending: !!pendingRows[0] })]
      );
      return { ok: true, record, reused_pending: !!pendingRows[0] };
    });

    await audit(req, "integracion.fiscal.requeue", { factura_id: facturaId, numero: factura.rows[0].numero }, empresaId);
    res.json({ ...result, factura_id: facturaId, numero: factura.rows[0].numero });
  } catch (e) { next(e); }
});

router.post("/integraciones/fiscal/:empresaId/facturas/:facturaId/sincronizar", superAuth, async (req, res, next) => {
  try {
    const { empresaId, facturaId } = req.params;
    const config = await getEmpresaFiscalConfig(empresaId);
    if (config?.modo !== "verifactu" || config?.verifactu?.proveedor !== "verifacti") {
      return res.status(400).json({ error: "La empresa no esta trabajando con Verifacti en VERIFACTU." });
    }

    const factura = await db.query(
      "SELECT id, numero FROM facturas WHERE id=$1 AND empresa_id=$2",
      [facturaId, empresaId]
    );
    if (!factura.rows[0]) return res.status(404).json({ error: "Factura no encontrada para esta empresa" });

    const envio = await db.query(
      `SELECT q.*, frf.modo, frf.estado_envio
         FROM factura_envios_fiscales q
         JOIN factura_registros_fiscales frf ON frf.id=q.registro_id
        WHERE q.factura_id=$1
          AND q.empresa_id=$2
          AND q.sistema='verifactu'
        ORDER BY q.created_at DESC
        LIMIT 1`,
      [facturaId, empresaId]
    );
    const item = envio.rows[0];
    if (!item) return res.status(404).json({ error: "La factura aun no tiene un envio fiscal VERIFACTU para sincronizar." });

    const providerUuid = extractProviderUuid(item.response || {});
    if (!providerUuid) return res.status(409).json({ error: "Esta factura aun no tiene UUID de proveedor en Verifacti." });

    const providerResult = await getVerifactiRecordStatus(config, providerUuid);
    await db.transaction(async (client) => {
      if (providerResult.provider_status === "accepted") {
        await markQueueAccepted(client, item, providerResult, null);
      } else if (providerResult.provider_status === "pending") {
        await markQueuePending(client, item, providerResult, null, 2 * 60 * 1000, "Sincronizacion manual de soporte con Verifacti");
      } else {
        await markQueueError(
          client,
          item,
          providerResult?.response?.error || providerResult?.response?.message || "Error devuelto por Verifacti al sincronizar.",
          null,
          false,
          providerResult
        );
      }
      await logFiscalEvent(client, item.registro_id, item.factura_id, item.empresa_id, "sync.verifacti.superadmin", {
        superadmin_id: req.superadmin?.id || null,
        superadmin_email: req.superadmin?.email || "",
        provider_uuid: providerUuid,
        provider_status: providerResult.provider_status,
      });
    });

    await audit(req, "integracion.fiscal.sincronizar", { factura_id: facturaId, numero: factura.rows[0].numero, provider_uuid: providerUuid, provider_status: providerResult.provider_status }, empresaId);
    res.json({
      ok: true,
      factura_id: facturaId,
      numero: factura.rows[0].numero,
      provider: "verifacti",
      provider_uuid: providerUuid,
      provider_status: providerResult.provider_status,
    });
  } catch (e) { next(e); }
});

router.get("/config/app-meta", superAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, app_meta: await getAppMeta() });
  } catch (e) { next(e); }
});

router.put("/config/app-meta", superAuth, async (req, res, next) => {
  try {
    const nextVersion = String(req.body?.version || "").trim();
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nextVersion)) {
      return res.status(400).json({ error: "La version debe tener formato tipo 1.2.3" });
    }
    const nextVersionName = String(req.body?.version_name || APP_META_DEFAULTS.version_name).trim() || APP_META_DEFAULTS.version_name;
    const nextBrandName = String(req.body?.brand_name || APP_META_DEFAULTS.brand_name).trim() || APP_META_DEFAULTS.brand_name;
    const nextSoftwareName = String(req.body?.fiscal_software_name || APP_META_DEFAULTS.fiscal_software_name).trim() || APP_META_DEFAULTS.fiscal_software_name;
    const nextSoftwareId = String(req.body?.fiscal_software_id || APP_META_DEFAULTS.fiscal_software_id).trim() || APP_META_DEFAULTS.fiscal_software_id;

    await setGlobalSetting("app_version", nextVersion);
    await setGlobalSetting("app_version_name", nextVersionName);
    await setGlobalSetting("app_brand_name", nextBrandName);
    await setGlobalSetting("fiscal_software_name", nextSoftwareName);
    await setGlobalSetting("fiscal_software_id", nextSoftwareId);
    await audit(req, "app_meta.actualizada", {
      version: nextVersion,
      version_name: nextVersionName,
      brand_name: nextBrandName,
      fiscal_software_name: nextSoftwareName,
      fiscal_software_id: nextSoftwareId,
    });
    res.json({ ok: true, app_meta: await getAppMeta() });
  } catch (e) { next(e); }
});

router.put("/config/ia-key", superAuth, async (req, res) => {
  const api_key = String(req.body?.api_key || "").trim();
  const provider = normalizeAiProvider(req.body?.provider);
  if (!AI_PROVIDERS.includes(provider) || !api_key) {
    return res.status(400).json({ error: "Proveedor o clave API de IA no validos." });
  }
  try {
    await setGlobalApiKey(provider, api_key);
    await setGlobalSetting("ia_provider", provider);
    await setGlobalSetting("ia_base_url", String(req.body?.base_url || "").trim());
    await setGlobalSetting("ia_model", normalizeAiModel(provider, req.body?.model));
    return res.json({ ok: true, message: "Clave API de IA guardada correctamente" });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/config/ia-key", superAuth, async (req, res) => {
  try {
    const provider = normalizeAiProvider(req.body?.provider || await getGlobalSetting("ia_provider", "anthropic"));
    await deleteGlobalApiKey(provider);
    return res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


module.exports = router;
