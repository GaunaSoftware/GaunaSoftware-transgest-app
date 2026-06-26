function ensureBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function toDdMmYyyy(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function normalizeNumber(value) {
  return Number(Number(value || 0).toFixed(2)).toFixed(2);
}

function splitSerieNumero(numeroCompleto, seriePreferida = "") {
  const serie = String(seriePreferida || "").trim();
  const numero = String(numeroCompleto || "").trim();
  if (!serie) return { serie: "", numero };
  const prefix = `${serie}-`;
  if (numero.startsWith(prefix)) {
    return { serie, numero: numero.slice(prefix.length) || numero };
  }
  return { serie, numero };
}

function mapInternalPayloadToVerifacti(recordPayload = {}) {
  const expedicion = recordPayload.expedicion || {};
  const receptor = recordPayload.receptor || {};
  const importes = recordPayload.importes || {};
  const lineas = Array.isArray(recordPayload.lineas) ? recordPayload.lineas : [];
  const { serie, numero } = splitSerieNumero(expedicion.numero, expedicion.serie);
  const tipoFactura = expedicion.rectificativa_de ? "R1" : "F1";
  const mappedLineas = (lineas.length ? lineas : [{
    concepto: expedicion.numero || "Factura",
    subtotal: importes.base_imponible || 0,
  }]).map((linea) => {
    const base = Number(linea.subtotal || 0);
    const tipoImpositivo = Number(importes.tipo_iva || 0);
    const cuota = base * tipoImpositivo / 100;
    return {
      descripcion: linea.concepto || "Servicio",
      base_imponible: normalizeNumber(base),
      tipo_impositivo: normalizeNumber(tipoImpositivo).replace(".00", ""),
      cuota_repercutida: normalizeNumber(cuota),
    };
  });

  const payload = {
    serie: serie || "",
    numero: numero || String(expedicion.numero || ""),
    fecha_expedicion: toDdMmYyyy(expedicion.fecha_factura),
    tipo_factura: tipoFactura,
    descripcion: mappedLineas[0]?.descripcion || `Factura ${expedicion.numero || ""}`.trim(),
    nombre: String(receptor.nombre || "").trim(),
    lineas: mappedLineas.map(({ descripcion, ...rest }) => rest),
    importe_total: normalizeNumber(importes.total || 0),
  };

  if (receptor.nif) payload.nif = String(receptor.nif).trim();
  return payload;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const message = data?.error || data?.message || data?.mensaje || `HTTP ${res.status}`;
    const err = new Error(String(message));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function requestVerifacti(config, path, options = {}) {
  const baseUrl = ensureBaseUrl(config?.verifactu?.provider_base_url);
  const apiKey = String(config?.verifactu?.provider_api_key || "").trim();
  if (!baseUrl) throw new Error("Falta la URL base de Verifacti.");
  if (!apiKey) throw new Error("Falta la API key de Verifacti.");

  const url = `${baseUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(Number(process.env.VERIFACTI_TIMEOUT_MS || 10000)),
  });
  return parseResponse(res);
}

async function probeVerifactiConnection(config) {
  const baseUrl = ensureBaseUrl(config?.verifactu?.provider_base_url);
  const apiKey = String(config?.verifactu?.provider_api_key || "").trim();
  if (!baseUrl) {
    return {
      ok: false,
      provider: "verifacti",
      stage: "config",
      message: "Falta la URL base de Verifacti.",
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      provider: "verifacti",
      stage: "config",
      base_url: baseUrl,
      message: "Falta la API key de Verifacti.",
    };
  }

  const url = `${baseUrl}/verifactu/status?uuid=${encodeURIComponent("transgest-connectivity-check")}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    const providerMessage = data?.error || data?.message || data?.mensaje || "";
    const status = Number(res.status || 0);
    if (res.ok) {
      return {
        ok: true,
        provider: "verifacti",
        stage: "remote",
        base_url: baseUrl,
        http_status: status,
        reachable: true,
        authenticated: true,
        response: data,
        message: "Conexion correcta con Verifacti.",
      };
    }
    if ([400, 404, 422].includes(status)) {
      return {
        ok: true,
        provider: "verifacti",
        stage: "remote",
        base_url: baseUrl,
        http_status: status,
        reachable: true,
        authenticated: true,
        response: data,
        message: providerMessage || "Verifacti responde. La conexion y la API key parecen validas.",
      };
    }
    if ([401, 403].includes(status)) {
      return {
        ok: false,
        provider: "verifacti",
        stage: "auth",
        base_url: baseUrl,
        http_status: status,
        reachable: true,
        authenticated: false,
        response: data,
        message: providerMessage || "Verifacti ha rechazado la autenticacion. Revisa la API key.",
      };
    }
    return {
      ok: false,
      provider: "verifacti",
      stage: "remote",
      base_url: baseUrl,
      http_status: status,
      reachable: true,
      authenticated: status < 500,
      response: data,
      message: providerMessage || `Verifacti ha respondido con HTTP ${status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "verifacti",
      stage: "network",
      base_url: baseUrl,
      reachable: false,
      authenticated: false,
      message: `No se pudo conectar con Verifacti: ${error.message}`,
    };
  }
}

function extractProviderUuid(response = {}) {
  return response?.uuid
    || response?.id
    || response?.data?.uuid
    || response?.registro?.uuid
    || response?.payload?.uuid
    || response?.payload?.data?.uuid
    || response?.event?.uuid
    || response?.event?.data?.uuid
    || null;
}

function extractProviderStatus(response = {}) {
  return String(
    response?.estado ||
    response?.status ||
    response?.registro?.estado ||
    response?.data?.estado ||
    response?.data?.status ||
    response?.payload?.estado ||
    response?.payload?.status ||
    response?.payload?.data?.estado ||
    response?.payload?.data?.status ||
    response?.event?.estado ||
    response?.event?.status ||
    response?.event?.data?.estado ||
    response?.event?.data?.status ||
    ""
  ).toLowerCase();
}

function extractQrValue(response = {}) {
  return response?.qr
    || response?.qr_base64
    || response?.data?.qr
    || response?.data?.qr_base64
    || response?.payload?.qr
    || response?.payload?.qr_base64
    || response?.payload?.data?.qr
    || response?.payload?.data?.qr_base64
    || response?.event?.qr
    || response?.event?.data?.qr
    || null;
}

function normalizeStatus(status = "") {
  const value = String(status || "").toLowerCase();
  if (["correcto", "accepted", "aceptado", "registrado", "registrada", "enviado", "ok", "success"].includes(value)) return "accepted";
  if (["pendiente", "queued", "processing", "procesando", "en_cola", "pending"].includes(value)) return "pending";
  if (["error", "failed", "rechazado", "rechazada", "cancelado", "cancelada"].includes(value)) return "error";
  return "pending";
}

async function createVerifactiRecord(config, queueItem) {
  const body = mapInternalPayloadToVerifacti(queueItem.payload || {});
  const response = await requestVerifacti(config, "/verifactu/create", {
    method: "POST",
    body,
  });
  return {
    provider: "verifacti",
    operation: "create",
    request: body,
    response,
    provider_uuid: extractProviderUuid(response),
    provider_status: normalizeStatus(extractProviderStatus(response)),
    qr_value: extractQrValue(response),
  };
}

async function getVerifactiRecordStatus(config, providerUuid) {
  const response = await requestVerifacti(config, `/verifactu/status?uuid=${encodeURIComponent(providerUuid)}`);
  return {
    provider: "verifacti",
    operation: "status",
    response,
    provider_uuid: providerUuid,
    provider_status: normalizeStatus(extractProviderStatus(response)),
    qr_value: extractQrValue(response),
  };
}

function extractVerifactiWebhookPayload(body = {}) {
  const response = body && typeof body === "object" ? body : {};
  return {
    provider: "verifacti",
    operation: "webhook",
    response,
    provider_uuid: extractProviderUuid(response),
    provider_status: normalizeStatus(extractProviderStatus(response)),
    qr_value: extractQrValue(response),
  };
}

module.exports = {
  createVerifactiRecord,
  getVerifactiRecordStatus,
  probeVerifactiConnection,
  extractVerifactiWebhookPayload,
  extractProviderUuid,
  normalizeStatus,
};
