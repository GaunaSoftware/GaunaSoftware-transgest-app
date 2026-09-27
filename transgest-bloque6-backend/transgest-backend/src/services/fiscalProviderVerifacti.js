function ensureBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function toDdMmYyyy(value) {
  // DATE is a civil date, never shift it through the server timezone.
  const iso = value instanceof Date ? value.toISOString() : String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
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
  // Invoice totals are authoritative (including supplements); per-line rounding
  // can disagree with the emitted invoice. Current model has one tax rate.
  if (Number(importes.cuota_irpf || 0) !== 0) throw Object.assign(new Error("La retención requiere validar el contrato fiscal antes del envío."), { status: 422 });
  const base = Number(importes.base_imponible), cuota = Number(importes.cuota_iva), total = Number(importes.total);
  if (![base, cuota, total, Number(importes.tipo_iva)].every(Number.isFinite) || Math.abs(base + cuota - total) > 0.011) {
    throw Object.assign(new Error("Los importes del registro fiscal no reconcilian."), { status: 422 });
  }
  const mappedLineas = [{ descripcion: lineas[0]?.concepto || "Servicio",
    base_imponible: normalizeNumber(base), tipo_impositivo: normalizeNumber(importes.tipo_iva).replace(".00", ""),
    cuota_repercutida: normalizeNumber(cuota) }];

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

  if (!payload.fecha_expedicion || !payload.numero) throw Object.assign(new Error("Falta identidad fiscal de la factura."), { status: 422 });
  if (expedicion.rectificativa_de) {
    const original = expedicion.original;
    if (!original || !["I", "S"].includes(expedicion.tipo_rectificativa)) throw Object.assign(new Error("Falta el tipo de rectificación o la identidad original; requiere revisión fiscal."), { status: 422 });
    payload.tipo_rectificativa = expedicion.tipo_rectificativa;
    payload.facturas_rectificadas = [{ ...splitSerieNumero(original.numero, original.serie), fecha_expedicion: toDdMmYyyy(original.fecha) }];
    if (payload.tipo_rectificativa === "S") payload.importe_rectificativa = { base_rectificada: normalizeNumber(original.base_imponible), cuota_rectificada: normalizeNumber(original.cuota_iva) };
  }
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
    signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, Number(process.env.VERIFACTI_TIMEOUT_MS) || 10000))),
  });
  return parseResponse(res);
}

async function probeVerifactiConnection(config) {
  try {
    const data = await requestVerifacti(config, "/verifactu/health");
    const expected = config.entorno === "produccion" ? "prod" : "test";
    const environment = String(data.entorno || "").toLowerCase();
    const environmentOk = expected === "test" ? environment === "test" : ["prod", "production", "produccion"].includes(environment);
    const nif = String(config.nif_declarante || "").trim().toUpperCase();
    const ok = data.estado === "OK" && !!nif && String(data.nif || "").toUpperCase() === nif && environmentOk;
    return { ok, provider: "verifacti", stage: ok ? "remote" : "identity", authenticated: data.estado === "OK", reachable: true,
      response: data, message: ok ? "API autenticada y NIF/entorno verificados. No equivale a aceptación de una factura por AEAT." : "Revisa el NIF y el entorno asociados a la API key." };
  } catch (error) {
    return { ok: false, provider: "verifacti", stage: error.status ? "remote" : "network", authenticated: false, reachable: !!error.status, http_status: error.status, message: error.message };
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
  const value = String(status || "").trim().toLowerCase();
  if (["correcto", "accepted", "aceptado", "registrado", "registrada"].includes(value)) return "accepted";
  if (["pendiente", "queued", "processing", "procesando", "en_cola", "pending", "error servidor aeat"].includes(value)) return "pending";
  // Accepted with errors, duplicates and cancellation need explicit reconciliation.
  return "error";
}

function idempotencyKey(item, operation = "create") {
  return `transgest-${operation}-${item.empresa_id}-${item.registro_id}`;
}

async function createVerifactiRecord(config, queueItem) {
  const body = mapInternalPayloadToVerifacti(queueItem.payload || {});
  const response = await requestVerifacti(config, "/verifactu/create", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey(queueItem) },
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

async function cancelVerifactiRecord(config, queueItem) {
  const exp = queueItem.payload?.expedicion || {};
  const body = { ...splitSerieNumero(exp.numero, exp.serie), fecha_expedicion: toDdMmYyyy(exp.fecha_factura) };
  const response = await requestVerifacti(config, "/verifactu/cancel", { method: "POST", body, headers: { "Idempotency-Key": idempotencyKey(queueItem, "cancel") } });
  return { provider: "verifacti", operation: "cancel", request: body, response, provider_uuid: extractProviderUuid(response), provider_status: normalizeStatus(extractProviderStatus(response)) };
}

module.exports = {
  cancelVerifactiRecord,
  mapInternalPayloadToVerifacti,
  toDdMmYyyy,
  createVerifactiRecord,
  getVerifactiRecordStatus,
  probeVerifactiConnection,
  extractVerifactiWebhookPayload,
  extractProviderUuid,
  normalizeStatus,
};
