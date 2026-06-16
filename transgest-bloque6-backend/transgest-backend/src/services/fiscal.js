const crypto = require("crypto");
const db = require("./db");
const { probeVerifactiConnection } = require("./fiscalProviderVerifacti");

const FISCAL_DEFAULTS = {
  modo: "ninguno",
  entorno: "pruebas",
  nif_declarante: "",
  razon_social_declarante: "",
  email_alertas: "",
  notas: "",
  ultima_prueba: null,
  historial_pruebas: [],
  verifactu: {
    habilitado: false,
    envio_automatico: true,
    proveedor: "directo",
    endpoint_url: "",
    certificado_alias: "",
    provider_base_url: "",
    provider_api_key: "",
    provider_webhook_secret: "",
    software_nombre: "TransGest",
    software_id: "transgest-tms",
    software_version: "1.0.0",
  },
  sii: {
    habilitado: false,
    envio_automatico: true,
    endpoint_url: "",
    certificado_alias: "",
    incluir_emitidas: true,
    incluir_recibidas: false,
  },
};

function normalizeFiscalTestMeta(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  return {
    ok: raw.ok === true,
    mode: String(raw.mode || "").trim().toLowerCase(),
    provider: String(raw.provider || "").trim().toLowerCase(),
    tested_at: String(raw.tested_at || "").trim(),
    message: String(raw.message || "").trim(),
    pending_connector: raw.pending_connector === true,
    transport: raw.transport && typeof raw.transport === "object"
      ? {
          ok: raw.transport.ok === true,
          mode: String(raw.transport.mode || "").trim().toLowerCase(),
          base_url: String(raw.transport.base_url || "").trim(),
          endpoint_host: String(raw.transport.endpoint_host || "").trim(),
          endpoint_protocol: String(raw.transport.endpoint_protocol || "").trim(),
          endpoint_https: raw.transport.endpoint_https === true,
          certificado_alias: String(raw.transport.certificado_alias || "").trim(),
          checks: raw.transport.checks && typeof raw.transport.checks === "object" ? raw.transport.checks : {},
          issues: Array.isArray(raw.transport.issues) ? raw.transport.issues.map(x => String(x || "").trim()).filter(Boolean) : [],
          http_status: raw.transport.http_status ?? null,
          stage: String(raw.transport.stage || "").trim(),
        }
      : null,
    status: raw.status && typeof raw.status === "object"
      ? {
          ready: raw.status.ready === true,
          production_ready: raw.status.production_ready === true,
          level: String(raw.status.level || "").trim(),
          summary: String(raw.status.summary || "").trim(),
          issues: Array.isArray(raw.status.issues) ? raw.status.issues.map(x => String(x || "").trim()).filter(Boolean) : [],
          warnings: Array.isArray(raw.status.warnings) ? raw.status.warnings.map(x => String(x || "").trim()).filter(Boolean) : [],
        }
      : null,
  };
}

function normalizeFiscalTestHistory(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeFiscalTestMeta)
    .filter(Boolean)
    .sort((a, b) => String(b?.tested_at || "").localeCompare(String(a?.tested_at || "")))
    .slice(0, 10);
}

function sortedClone(value) {
  if (Array.isArray(value)) return value.map(sortedClone);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortedClone(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function normalizeFiscalConfig(raw = {}) {
  const base = raw && typeof raw === "object" ? raw : {};
  const cfg = base.facturacion_fiscal && typeof base.facturacion_fiscal === "object"
    ? base.facturacion_fiscal
    : base;
  const modo = ["ninguno", "verifactu", "sii"].includes(String(cfg.modo || "").toLowerCase())
    ? String(cfg.modo).toLowerCase()
    : "ninguno";
  const entorno = String(cfg.entorno || "").toLowerCase() === "produccion" ? "produccion" : "pruebas";
  return {
    ...FISCAL_DEFAULTS,
    ...cfg,
    modo,
    entorno,
    nif_declarante: String(cfg.nif_declarante || "").trim().toUpperCase(),
    razon_social_declarante: String(cfg.razon_social_declarante || "").trim(),
    email_alertas: String(cfg.email_alertas || "").trim(),
    notas: String(cfg.notas || "").trim(),
    ultima_prueba: normalizeFiscalTestMeta(cfg.ultima_prueba || cfg.last_test || null),
    historial_pruebas: normalizeFiscalTestHistory(cfg.historial_pruebas || cfg.test_history || []),
    verifactu: {
      ...FISCAL_DEFAULTS.verifactu,
      ...(cfg.verifactu && typeof cfg.verifactu === "object" ? cfg.verifactu : {}),
      habilitado: modo === "verifactu",
      envio_automatico: cfg?.verifactu?.envio_automatico !== false,
      proveedor: String(cfg?.verifactu?.proveedor || "directo").toLowerCase() === "verifacti" ? "verifacti" : "directo",
      endpoint_url: String(cfg?.verifactu?.endpoint_url || "").trim(),
      certificado_alias: String(cfg?.verifactu?.certificado_alias || "").trim(),
      provider_base_url: String(cfg?.verifactu?.provider_base_url || "").trim().replace(/\/+$/, ""),
      provider_api_key: String(cfg?.verifactu?.provider_api_key || "").trim(),
      provider_webhook_secret: String(cfg?.verifactu?.provider_webhook_secret || "").trim(),
      software_nombre: String(cfg?.verifactu?.software_nombre || FISCAL_DEFAULTS.verifactu.software_nombre).trim(),
      software_id: String(cfg?.verifactu?.software_id || FISCAL_DEFAULTS.verifactu.software_id).trim(),
      software_version: String(cfg?.verifactu?.software_version || FISCAL_DEFAULTS.verifactu.software_version).trim(),
    },
    sii: {
      ...FISCAL_DEFAULTS.sii,
      ...(cfg.sii && typeof cfg.sii === "object" ? cfg.sii : {}),
      habilitado: modo === "sii",
      envio_automatico: cfg?.sii?.envio_automatico !== false,
      endpoint_url: String(cfg?.sii?.endpoint_url || "").trim(),
      certificado_alias: String(cfg?.sii?.certificado_alias || "").trim(),
      incluir_emitidas: cfg?.sii?.incluir_emitidas !== false,
      incluir_recibidas: cfg?.sii?.incluir_recibidas === true,
    },
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function getFiscalTestFreshnessMeta(test) {
  const testedAt = test?.tested_at ? new Date(test.tested_at) : null;
  if (!testedAt || Number.isNaN(testedAt.getTime())) {
    return {
      key: "missing",
      label: "Sin probar",
      tested_at: null,
      diff_days: null,
      review: true,
      stale: true,
    };
  }
  const diffDays = Math.floor((Date.now() - testedAt.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) {
    return {
      key: "recent",
      label: "Reciente",
      tested_at: testedAt.toISOString(),
      diff_days: diffDays,
      review: false,
      stale: false,
    };
  }
  if (diffDays <= 30) {
    return {
      key: "review",
      label: "Conviene revisar",
      tested_at: testedAt.toISOString(),
      diff_days: diffDays,
      review: true,
      stale: false,
    };
  }
  return {
    key: "stale",
    label: "Caducada",
    tested_at: testedAt.toISOString(),
    diff_days: diffDays,
    review: true,
    stale: true,
  };
}

function buildFiscalStatus(configInput = {}) {
  const config = normalizeFiscalConfig(configInput);
  const issues = [];
  const warnings = [];
  const checks = [];
  const addCheck = (label, ok, detail, severity = "required") => {
    const item = { label, ok: !!ok, detail, severity };
    checks.push(item);
    if (!ok) {
      if (severity === "warning") warnings.push(detail || label);
      else issues.push(detail || label);
    }
  };

  addCheck("Modo fiscal seleccionado", config.modo !== "ninguno", "Selecciona si la empresa trabajara con VERIFACTU o SII.");
  addCheck("NIF declarante", !!config.nif_declarante, "Falta el NIF del declarante.");
  addCheck("Razon social declarante", !!config.razon_social_declarante, "Falta la razon social del declarante.");
  addCheck("Email de alertas", !!config.email_alertas, "Conviene definir un email de alertas fiscales.", "warning");
  if (config.email_alertas) {
    addCheck("Formato email alertas", isValidEmail(config.email_alertas), "El email de alertas no tiene un formato valido.", "warning");
  }

  if (config.modo === "verifactu") {
    addCheck("Proveedor VERIFACTU", ["directo", "verifacti"].includes(config.verifactu.proveedor), "Selecciona un proveedor valido para VERIFACTU.");
    if (config.verifactu.proveedor === "verifacti") {
      addCheck("Base URL Verifacti", !!config.verifactu.provider_base_url, "Falta la URL base de la API de Verifacti.");
      addCheck("API key Verifacti", !!config.verifactu.provider_api_key, "Falta la API key de Verifacti.");
      addCheck("Webhook secret Verifacti", !!config.verifactu.provider_webhook_secret, "Conviene definir un webhook secret para sincronizacion segura desde Verifacti.", "warning");
    } else {
      addCheck("Alias certificado VERIFACTU", !!config.verifactu.certificado_alias, "Falta el alias del certificado VERIFACTU.");
      addCheck("Endpoint VERIFACTU", !!config.verifactu.endpoint_url, "Falta el endpoint VERIFACTU.");
    }
    addCheck("Nombre software", !!config.verifactu.software_nombre, "Falta el nombre del software emisor.");
    addCheck("ID software", !!config.verifactu.software_id, "Falta el identificador del software.");
    addCheck("Version software", !!config.verifactu.software_version, "Falta la version del software.");
    addCheck("Envio automatico", !!config.verifactu.envio_automatico, "El envio automatico esta desactivado. Habra que procesar la cola manualmente.", "warning");
  } else if (config.modo === "sii") {
    addCheck("Alias certificado SII", !!config.sii.certificado_alias, "Falta el alias del certificado SII.");
    addCheck("Endpoint SII", !!config.sii.endpoint_url, "Falta el endpoint SII.");
    addCheck("Facturas emitidas activas", !!config.sii.incluir_emitidas, "SII deberia incluir al menos facturas emitidas.");
    addCheck("Envio automatico", !!config.sii.envio_automatico, "El envio automatico esta desactivado. Habra que procesar la cola manualmente.", "warning");
  }

  if (config.entorno === "produccion") {
    addCheck("Canal listo para produccion", config.modo === "verifactu"
      ? config.verifactu.proveedor === "verifacti"
        ? !!config.verifactu.provider_api_key
        : !!config.verifactu.certificado_alias
      : config.modo === "sii"
        ? !!config.sii.certificado_alias
        : false, "No hay certificado configurado para produccion.");
    addCheck("Endpoint real configurado", config.modo === "verifactu"
      ? config.verifactu.proveedor === "verifacti"
        ? !!config.verifactu.provider_base_url
        : !!config.verifactu.endpoint_url
      : config.modo === "sii"
        ? !!config.sii.endpoint_url
        : false, "No hay endpoint real configurado para produccion.");
  } else {
    addCheck("Entorno de pruebas activo", true, "La empresa esta trabajando en entorno de pruebas.", "warning");
  }

  const lastTestFreshness = getFiscalTestFreshnessMeta(config.ultima_prueba);
  if (config.modo !== "ninguno") {
    const missingSeverity = config.entorno === "produccion" ? "required" : "warning";
    addCheck(
      "Ultima prueba fiscal registrada",
      lastTestFreshness.key !== "missing",
      "Aun no se ha registrado ninguna prueba del canal fiscal.",
      missingSeverity
    );
    if (lastTestFreshness.key === "review") {
      addCheck(
        "Vigencia de la ultima prueba fiscal",
        false,
        "La ultima prueba fiscal ya tiene dias encima. Conviene revisarla antes de operar en serio.",
        "warning"
      );
    } else if (lastTestFreshness.key === "stale") {
      addCheck(
        "Vigencia de la ultima prueba fiscal",
        false,
        "La ultima prueba fiscal esta caducada. Conviene repetirla antes de seguir operando.",
        config.entorno === "produccion" ? "required" : "warning"
      );
    } else if (lastTestFreshness.key === "recent") {
      addCheck(
        "Vigencia de la ultima prueba fiscal",
        true,
        "La ultima prueba fiscal es reciente.",
        "warning"
      );
    }
  }

  const ready = issues.length === 0 && config.modo !== "ninguno";
  const productionReady = ready && config.entorno === "produccion";
  return {
    ready,
    production_ready: productionReady,
    level: issues.length ? "error" : warnings.length ? "warning" : "ok",
    summary: issues.length
      ? `${issues.length} requisito(s) pendiente(s)`
      : warnings.length
        ? `${warnings.length} aviso(s) a revisar`
        : "Configuracion fiscal lista",
    issues,
    warnings,
    checks,
    last_test_freshness: lastTestFreshness,
  };
}

async function getEmpresaFiscalConfig(empresaId, client = db) {
  const { rows } = await client.query("SELECT configuracion FROM empresas WHERE id=$1", [empresaId]);
  return normalizeFiscalConfig(rows[0]?.configuracion?.facturacion_fiscal || {});
}

function maskSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return "********";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function sanitizeFiscalConfigForClient(input = {}) {
  const config = normalizeFiscalConfig(input);
  return {
    modo: config.modo,
    entorno: config.entorno,
    nif_declarante: config.nif_declarante,
    razon_social_declarante: config.razon_social_declarante,
    email_alertas: config.email_alertas,
    notas: config.notas,
    ultima_prueba: config.ultima_prueba,
    historial_pruebas: config.historial_pruebas,
    verifactu: {
      habilitado: config.verifactu.habilitado,
      envio_automatico: config.verifactu.envio_automatico,
      proveedor: config.verifactu.proveedor,
      endpoint_url: config.verifactu.endpoint_url,
      certificado_alias: config.verifactu.certificado_alias,
      provider_base_url: config.verifactu.provider_base_url,
      provider_api_key_masked: maskSecret(config.verifactu.provider_api_key),
      provider_webhook_secret_masked: maskSecret(config.verifactu.provider_webhook_secret),
      software_nombre: config.verifactu.software_nombre,
      software_id: config.verifactu.software_id,
      software_version: config.verifactu.software_version,
    },
    sii: {
      habilitado: config.sii.habilitado,
      envio_automatico: config.sii.envio_automatico,
      endpoint_url: config.sii.endpoint_url,
      certificado_alias: config.sii.certificado_alias,
      incluir_emitidas: config.sii.incluir_emitidas,
      incluir_recibidas: config.sii.incluir_recibidas,
    },
  };
}

async function saveEmpresaFiscalConfig(empresaId, input, client = db) {
  const current = await getEmpresaFiscalConfig(empresaId, client);
  const raw = input && typeof input === "object" ? { ...input } : {};
  const rawVerifactu = raw.verifactu && typeof raw.verifactu === "object" ? { ...raw.verifactu } : {};
  if (!String(rawVerifactu.provider_api_key || "").trim() && current.verifactu.provider_api_key) {
    rawVerifactu.provider_api_key = current.verifactu.provider_api_key;
  }
  if (!String(rawVerifactu.provider_webhook_secret || "").trim() && current.verifactu.provider_webhook_secret) {
    rawVerifactu.provider_webhook_secret = current.verifactu.provider_webhook_secret;
  }
  raw.verifactu = rawVerifactu;
  const config = normalizeFiscalConfig(raw);
  const { rows } = await client.query(
    `UPDATE empresas
        SET configuracion = jsonb_set(COALESCE(configuracion,'{}'::jsonb), '{facturacion_fiscal}', $1::jsonb, true)
      WHERE id=$2
      RETURNING configuracion->'facturacion_fiscal' AS facturacion_fiscal`,
    [JSON.stringify(config), empresaId]
  );
  return normalizeFiscalConfig(rows[0]?.facturacion_fiscal || config);
}

async function saveEmpresaFiscalTestResult(empresaId, testResult, client = db) {
  const current = await getEmpresaFiscalConfig(empresaId, client);
  const normalizedTest = normalizeFiscalTestMeta(testResult);
  const next = {
    ...current,
    ultima_prueba: normalizedTest,
    historial_pruebas: normalizeFiscalTestHistory([normalizedTest, ...(current.historial_pruebas || [])]),
  };
  return saveEmpresaFiscalConfig(empresaId, next, client);
}

async function getEmpresaFiscalQueueSummary(empresaId, client = db) {
  const [config, resumen, recientes, cola] = await Promise.all([
    getEmpresaFiscalConfig(empresaId, client),
    client.query(
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
    client.query(
      `SELECT frf.id, frf.factura_id, frf.modo, frf.estado_envio, frf.huella, frf.ultimo_error, frf.updated_at,
              fae.accepted_ref, fq.provider_uuid, fq.next_retry_at,
              f.numero, f.fecha, f.total, c.nombre AS cliente_nombre
         FROM factura_registros_fiscales frf
         JOIN facturas f ON f.id=frf.factura_id
         JOIN clientes c ON c.id=f.cliente_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(ev.detalle->>'registro_aeat', ev.detalle->>'csv') AS accepted_ref
           FROM factura_eventos_fiscales ev
           WHERE ev.registro_id = frf.id
             AND ev.evento_tipo = 'queue.accepted'
           ORDER BY ev.created_at DESC
           LIMIT 1
         ) fae ON true
         LEFT JOIN LATERAL (
           SELECT
             q.next_retry_at,
             COALESCE(
               q.response->>'provider_uuid',
               q.response->>'uuid',
               q.response->'response'->>'uuid',
               q.response->'response'->'data'->>'uuid',
               q.response->'response'->'registro'->>'uuid'
             ) AS provider_uuid
           FROM factura_envios_fiscales q
           WHERE q.registro_id = frf.id
           ORDER BY COALESCE(q.updated_at, q.created_at) DESC
           LIMIT 1
         ) fq ON true
        WHERE frf.empresa_id=$1
        ORDER BY frf.updated_at DESC NULLS LAST, frf.created_at DESC
        LIMIT 5`,
      [empresaId]
    ),
    client.query(
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
                f.numero, c.nombre AS cliente_nombre
           FROM factura_envios_fiscales q
           JOIN facturas f ON f.id=q.factura_id
           JOIN clientes c ON c.id=f.cliente_id
          WHERE q.empresa_id=$1
            AND q.estado IN ('pendiente','procesando','error')
          ORDER BY q.factura_id, q.sistema, q.created_at DESC
       ) cola
       ORDER BY
         CASE estado WHEN 'error' THEN 0 WHEN 'procesando' THEN 1 ELSE 2 END,
         next_retry_at ASC NULLS LAST,
         created_at DESC
       LIMIT 5`,
      [empresaId]
    ),
  ]);

  return {
    config: sanitizeFiscalConfigForClient(config),
    status: buildFiscalStatus(config),
    resumen: {
      ...(resumen.rows[0] || {}),
      atascados: Array.isArray(cola.rows) ? cola.rows.filter((item) => item.atascado).length : 0,
    },
    recientes: recientes.rows || [],
    cola: cola.rows || [],
  };
}

function probeStaticFiscalTransport({ mode, endpointUrl, entorno, certificadoAlias, extra = {} }) {
  const endpoint = String(endpointUrl || "").trim();
  let parsed = null;
  let urlOk = false;
  let httpsOk = false;
  try {
    parsed = endpoint ? new URL(endpoint) : null;
    urlOk = !!parsed;
    httpsOk = !parsed || parsed.protocol === "https:";
  } catch {
    parsed = null;
  }
  const issues = [];
  if (!endpoint) issues.push("Falta el endpoint.");
  else if (!urlOk) issues.push("El endpoint no tiene un formato valido.");
  else if (entorno === "produccion" && !httpsOk) issues.push("En produccion el endpoint debe trabajar sobre HTTPS.");
  if (!certificadoAlias) issues.push("Falta el alias del certificado.");

  return {
    ok: issues.length === 0,
    mode,
    base_url: endpoint,
    endpoint_host: parsed?.host || "",
    endpoint_protocol: parsed?.protocol ? parsed.protocol.replace(":", "") : "",
    endpoint_https: httpsOk,
    certificado_alias: String(certificadoAlias || "").trim(),
    checks: {
      endpoint: !!endpoint,
      endpoint_url_valida: urlOk,
      https_requerido_ok: httpsOk,
      certificado: !!certificadoAlias,
      ...extra,
    },
    issues,
    message: issues.length
      ? issues.join(" ")
      : "La configuracion base del canal fiscal es coherente a nivel de endpoint y certificado.",
  };
}

async function testFiscalConnection(configInput = {}) {
  const config = normalizeFiscalConfig(configInput);
  const status = buildFiscalStatus(config);
  const testedAt = new Date().toISOString();

  if (config.modo === "ninguno") {
    return {
      ok: false,
      mode: config.modo,
      provider: "none",
      tested_at: testedAt,
      status,
      message: "La empresa no tiene un canal fiscal activado.",
    };
  }

  if (config.modo === "verifactu") {
    if (config.verifactu.proveedor === "verifacti") {
      const transport = await probeVerifactiConnection(config);
      return {
        ok: Boolean(transport.ok) && status.level !== "error",
        mode: config.modo,
        provider: "verifacti",
        tested_at: testedAt,
        status,
        transport,
        message: transport.ok
          ? "Canal VERIFACTU listo y Verifacti responde."
          : transport.message || "No se pudo validar la conexion con Verifacti.",
      };
    }

    return {
      ok: status.level !== "error",
      mode: config.modo,
      provider: "directo",
      tested_at: testedAt,
      status,
      transport: probeStaticFiscalTransport({
        mode: "verifactu",
        endpointUrl: config.verifactu.endpoint_url,
        entorno: config.entorno,
        certificadoAlias: config.verifactu.certificado_alias,
      }),
      pending_connector: true,
      message: status.level === "error"
        ? "La configuracion directa de VERIFACTU aun tiene campos pendientes."
        : "La configuracion directa de VERIFACTU esta preparada, pero el conector AEAT directo todavia no esta conectado.",
    };
  }

  return {
    ok: false,
    mode: config.modo,
    provider: "sii",
    tested_at: testedAt,
    status,
    transport: probeStaticFiscalTransport({
      mode: "sii",
      endpointUrl: config.sii.endpoint_url,
      entorno: config.entorno,
      certificadoAlias: config.sii.certificado_alias,
      extra: {
        incluir_emitidas: !!config.sii.incluir_emitidas,
        incluir_recibidas: !!config.sii.incluir_recibidas,
      },
    }),
    pending_connector: true,
    message: status.level === "error"
      ? "La configuracion SII aun tiene campos pendientes."
      : "La configuracion SII esta preparada, pero el conector real todavia no esta activado.",
  };
}

function buildFacturaFiscalPayload({ factura, cliente, empresaPerfil, lineas, config, previousHash }) {
  const payload = {
    version: 1,
    sistema: config.modo,
    entorno: config.entorno,
    expedicion: {
      fecha_generacion: new Date().toISOString(),
      fecha_factura: factura.fecha,
      estado_factura: factura.estado,
      serie: factura.serie || "",
      numero: factura.numero,
      factura_id: factura.id,
      rectificativa_de: factura.factura_original_numero || null,
    },
    emisor: {
      nombre: config.razon_social_declarante || empresaPerfil.razon_social || "",
      nif: config.nif_declarante || empresaPerfil.cif || "",
    },
    receptor: {
      nombre: cliente.nombre || factura.cliente_nombre || "",
      nif: cliente.cif || factura.cliente_cif || "",
      email: cliente.email_facturacion || cliente.email || "",
    },
    importes: {
      base_imponible: Number(factura.base_imponible || 0),
      tipo_iva: Number(factura.tipo_iva || 0),
      cuota_iva: Number(factura.cuota_iva || 0),
      tipo_irpf: Number(factura.tipo_irpf || 0),
      cuota_irpf: Number(factura.cuota_irpf || 0),
      total: Number(factura.total || 0),
      moneda: "EUR",
    },
    lineas: (lineas || []).map((linea, index) => ({
      orden: index + 1,
      concepto: linea.concepto,
      cantidad: Number(linea.cantidad || 0),
      precio_unitario: Number(linea.precio_unit || 0),
      subtotal: Number(linea.cantidad || 0) * Number(linea.precio_unit || 0),
    })),
    encadenado: {
      hash_anterior: previousHash || null,
    },
  };

  const canonical = JSON.stringify(sortedClone(payload));
  const huella = sha256(canonical);
  const qrText = [
    "TRANSGEST",
    config.modo.toUpperCase(),
    factura.numero,
    factura.fecha,
    Number(factura.total || 0).toFixed(2),
    huella,
  ].join("|");

  return { payload, huella, qrText };
}

async function appendFiscalEvent(client, recordId, facturaId, empresaId, eventType, detail = {}) {
  await client.query(
    `INSERT INTO factura_eventos_fiscales
      (registro_id, factura_id, empresa_id, evento_tipo, detalle)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [recordId, facturaId, empresaId, eventType, JSON.stringify(detail || {})]
  );
}

async function ensureFacturaFiscalRecord({ facturaId, empresaId, actorUserId = null, force = false, client = db }) {
  const config = await getEmpresaFiscalConfig(empresaId, client);
  if (config.modo === "ninguno") {
    return { skipped: true, reason: "fiscal_mode_disabled" };
  }

  const { rows: facturaRows } = await client.query(
    `SELECT f.*,
            c.nombre AS cliente_nombre,
            c.cif AS cliente_cif,
            c.email AS cliente_email,
            c.email_facturacion,
            e.nombre AS empresa_nombre,
            e.cfg_precios
       FROM facturas f
       JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
       JOIN empresas e ON e.id=f.empresa_id
      WHERE f.id=$1 AND f.empresa_id=$2`,
    [facturaId, empresaId]
  );
  const factura = facturaRows[0];
  if (!factura) throw new Error("Factura no encontrada para registro fiscal");
  if (factura.estado === "borrador") {
    return { skipped: true, reason: "draft_invoice" };
  }

  const { rows: lineas } = await client.query(
    "SELECT concepto, cantidad, precio_unit FROM factura_lineas WHERE factura_id=$1 ORDER BY orden,id",
    [facturaId]
  );

  const empresaPerfil = factura.cfg_precios?.empresa_perfil && typeof factura.cfg_precios.empresa_perfil === "object"
    ? factura.cfg_precios.empresa_perfil
    : (factura.cfg_precios || {});

  const cliente = {
    nombre: factura.cliente_nombre,
    cif: factura.cliente_cif,
    email: factura.cliente_email,
    email_facturacion: factura.email_facturacion,
  };

  const { rows: existingRows } = await client.query(
    "SELECT * FROM factura_registros_fiscales WHERE factura_id=$1 AND empresa_id=$2",
    [facturaId, empresaId]
  );
  const existing = existingRows[0] || null;

  if (existing && !force) {
    return { skipped: true, reason: "already_exists", record: existing };
  }

  const { rows: previousRows } = await client.query(
    `SELECT huella
       FROM factura_registros_fiscales
      WHERE empresa_id=$1 AND factura_id<>$2 AND modo=$3
      ORDER BY created_at DESC
      LIMIT 1`,
    [empresaId, facturaId, config.modo]
  );
  const previousHash = previousRows[0]?.huella || null;
  const { payload, huella, qrText } = buildFacturaFiscalPayload({
    factura,
    cliente,
    empresaPerfil,
    lineas,
    config,
    previousHash,
  });

  const { rows: recordRows } = await client.query(
    `INSERT INTO factura_registros_fiscales
      (empresa_id, factura_id, modo, entorno, estado_registro, estado_envio, hash_anterior, huella, qr_text, payload, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'alta','pendiente',$5,$6,$7,$8::jsonb,$9,$9)
     ON CONFLICT (factura_id) DO UPDATE
       SET modo=EXCLUDED.modo,
           entorno=EXCLUDED.entorno,
           estado_registro='alta',
           estado_envio=CASE WHEN factura_registros_fiscales.estado_envio='aceptado' THEN 'aceptado' ELSE 'pendiente' END,
           hash_anterior=EXCLUDED.hash_anterior,
           huella=EXCLUDED.huella,
           qr_text=EXCLUDED.qr_text,
           payload=EXCLUDED.payload,
           ultimo_error=NULL,
           updated_by=EXCLUDED.updated_by,
           updated_at=NOW()
     RETURNING *`,
    [empresaId, facturaId, config.modo, config.entorno, previousHash, huella, qrText, JSON.stringify(payload), actorUserId]
  );
  const record = recordRows[0];

  const shouldQueue = (config.modo === "verifactu" && config.verifactu.envio_automatico)
    || (config.modo === "sii" && config.sii.envio_automatico);

  if (shouldQueue) {
    const { rows: pendingRows } = await client.query(
      `SELECT id FROM factura_envios_fiscales
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
        [record.id, facturaId, empresaId, config.modo, config.entorno, JSON.stringify(payload)]
      );
      await appendFiscalEvent(client, record.id, facturaId, empresaId, "queue.created", {
        modo: config.modo,
        entorno: config.entorno,
      });
    }
  }

  await appendFiscalEvent(client, record.id, facturaId, empresaId, existing ? "record.updated" : "record.created", {
    modo: config.modo,
    entorno: config.entorno,
    huella,
  });

  return { skipped: false, record, config };
}

module.exports = {
  FISCAL_DEFAULTS,
  normalizeFiscalConfig,
  normalizeFiscalTestMeta,
  sanitizeFiscalConfigForClient,
  buildFiscalStatus,
  getEmpresaFiscalConfig,
  saveEmpresaFiscalConfig,
  testFiscalConnection,
  saveEmpresaFiscalTestResult,
  getEmpresaFiscalQueueSummary,
  ensureFacturaFiscalRecord,
};
