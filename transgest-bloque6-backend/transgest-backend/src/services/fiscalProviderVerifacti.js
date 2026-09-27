function ensureBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function toDdMmYyyy(value) {
  const iso = value instanceof Date ? value.toISOString().slice(0,10) : String(value || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0,10)!==iso) throw Object.assign(new Error('Fecha fiscal no válida'), {retryable:false});
  return iso.split('-').reverse().join('-');
}
function normalizeNumber(value) {
  if(value == null || value === '' || !Number.isFinite(Number(value))) throw Object.assign(new Error('Importe fiscal no válido'), {retryable:false});
  return Number(value).toFixed(2);
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
  const e=recordPayload.expedicion || {}, r=recordPayload.receptor || {}, totals=recordPayload.importes || {};
  if (Number(totals.cuota_irpf || 0) !== 0) throw Object.assign(new Error('La retención requiere validar el contrato fiscal antes del envío.'), { status: 422, retryable: false });
  const {serie,numero}=splitSerieNumero(e.numero,e.serie);
  const error=message=>{throw Object.assign(new Error(message),{retryable:false});};
  if(!numero || !r.nombre || !r.nif) error('Faltan número, nombre o NIF del destinatario');
  const lineas=(recordPayload.desglose_fiscal || [{base_imponible:totals.base_imponible,tipo_impositivo:totals.tipo_iva,cuota_repercutida:totals.cuota_iva,operacion_exenta:totals.operacion_exenta,calificacion_operacion:totals.calificacion_operacion}]).map(line=>{
    const out={base_imponible:normalizeNumber(line.base_imponible)};
    if(line.operacion_exenta) {
      if(!/^E[1-6]$/.test(line.operacion_exenta)) error('Código de exención IVA no válido');
      out.operacion_exenta=line.operacion_exenta;
    } else {
      if(totals.iva_regimen === 'exento') error('Indica la causa de exención E1–E6 antes de emitir');
      if(totals.iva_regimen==='no_sujeto' && !['N1','N2'].includes(line.calificacion_operacion)) error('Indica la causa de no sujeción N1 o N2 antes de emitir');
      out.calificacion_operacion=line.calificacion_operacion || 'S1';
      if(!['S1','S2','N1','N2'].includes(out.calificacion_operacion)) error('Calificación fiscal no válida');
      if(out.calificacion_operacion==='S1') {
        out.tipo_impositivo=normalizeNumber(line.tipo_impositivo).replace('.00','');
        out.cuota_repercutida=normalizeNumber(line.cuota_repercutida);
      }
    }
    return out;
  });
  const fiscalTotal=lineas.reduce((n,l)=>n+Number(l.base_imponible)+Number(l.cuota_repercutida||0),0);
  if(normalizeNumber(fiscalTotal)!==normalizeNumber(Number(totals.total)+Number(totals.cuota_irpf||0))) error('Los totales fiscales no coinciden con la factura');
  const body={serie,numero,fecha_expedicion:toDdMmYyyy(e.fecha_factura),tipo_factura:'F1',descripcion:String(recordPayload.lineas?.[0]?.concepto || `Factura ${e.numero}`).slice(0,500),nombre:String(r.nombre).trim(),nif:String(r.nif).trim(),lineas,importe_total:normalizeNumber(fiscalTotal)};
  if(e.rectificativa_de) {
    const rc=e.rectificacion || (e.original && {tipo_factura:'R1',tipo_rectificativa:e.tipo_rectificativa,original_numero:e.original.numero,original_serie:e.original.serie,original_fecha:e.original.fecha,base_rectificada:e.original.base_imponible,cuota_rectificada:e.original.cuota_iva}) || {};
    if(!/^R[1-5]$/.test(rc.tipo_factura || '') || !['I','S'].includes(rc.tipo_rectificativa) || !rc.original_fecha || !rc.original_numero) error('Completa el motivo fiscal R1–R5, método y factura original de la rectificativa');
    body.tipo_factura=rc.tipo_factura; body.tipo_rectificativa=rc.tipo_rectificativa;
    const original=splitSerieNumero(rc.original_numero,rc.original_serie);
    body.facturas_rectificadas=[{...original,fecha_expedicion:toDdMmYyyy(rc.original_fecha)}];
    if(rc.tipo_rectificativa==='S') body.importe_rectificativa={base_rectificada:normalizeNumber(rc.base_rectificada),cuota_rectificada:normalizeNumber(rc.cuota_rectificada),cuota_recargo_rectificada:normalizeNumber(rc.cuota_recargo_rectificada ?? 0)};
  }
  return body;
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
  const endpoint=new URL(baseUrl);
  if(endpoint.protocol!=='https:' || endpoint.hostname!=='api.verifacti.com' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.port || endpoint.pathname!=='/')throw Object.assign(new Error('La URL de Verifacti debe ser https://api.verifacti.com.'),{retryable:false});

  const url = `${baseUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const res = await fetch(url, {
    method: options.method || "GET",
    redirect: 'error',
    headers,
    body: options.body ? require('./fiscalIdentity').serialize(options.body) : undefined,
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

function normalizeStatus(status = '') {
  const value=String(status).toLowerCase().replace(/\s+/g,'');
  if(['correcto','correcta','aceptado','accepted','registrado','registrada'].includes(value))return 'accepted';
  if(['aceptadoconerrores','aceptadaconerrores'].includes(value))return 'accepted_with_errors';
  if(['incorrecto','noregistrado','duplicado','anulado','anulada','facturainexistente','error','failed','rechazado','rechazada','cancelado','cancelada'].includes(value))return 'error';
  if(['enviado','pendiente','queued','processing','procesando','en_cola','pending','errorservidoraeat'].includes(value))return 'pending';
  return 'error'; // Unknown states need reconciliation, never silent acceptance.
}
function officialQrUrl(value) {
  try { const u=new URL(value); return u.protocol==='https:' && ['www2.agenciatributaria.gob.es','prewww2.aeat.es','www2.aeat.es'].includes(u.hostname) && u.pathname==='/wlpl/TIKE-CONT/ValidarQR' ? u.href : null; }catch{return null;}
}
function providerResult(response,operation,uuid) {
  return {provider:'verifacti',operation,response,provider_uuid:uuid || extractProviderUuid(response),provider_status:normalizeStatus(extractProviderStatus(response)),qr_value:extractQrValue(response),qr_url:officialQrUrl(response.url),provider_hash:response.huella || null};
}

function idempotencyKey(item, operation = "create") {
  return `transgest-${operation}-${item.empresa_id}-${item.registro_id}`;
}

async function createVerifactiRecord(config, queueItem) {
  const body = queueItem.request_payload || mapInternalPayloadToVerifacti(queueItem.payload || {});
  const key=queueItem.idempotency_key || idempotencyKey(queueItem);
  const response = await requestVerifacti(config, "/verifactu/create", {
    method: "POST",
    headers: {"Idempotency-Key":key},
    body,
  });
  const result=providerResult(response,'create');
  if(!result.provider_uuid) throw new Error('Respuesta fiscal incompleta: falta el identificador. Se conciliará antes de reintentar.');
  return {...result,request:body};
}

async function downloadVerifactiXml(config, record) {
  const request=mapInternalPayloadToVerifacti(record.payload);
  const response=await requestVerifacti(config,'/verifactu/downloadXML',{method:'POST',body:{serie:request.serie,numero:request.numero}});
  if(!Array.isArray(response)) throw Object.assign(new Error('Verifacti no devolvió los XML del registro.'),{status:502});
  const item=response.find(value=>value.uuid===record.provider_uuid);
  if(!item?.xml_req || typeof item.xml_req!=='string') throw Object.assign(new Error('El XML oficial de este registro todavía no está disponible.'),{status:409});
  return item.xml_req;
}

async function getVerifactiRecordStatus(config, providerUuid) {
  const response = await requestVerifacti(config, `/verifactu/status?uuid=${encodeURIComponent(providerUuid)}`);
  return providerResult(response,'status',providerUuid);
}

function extractVerifactiWebhookPayload(body = {}) { return providerResult(body,'webhook'); }
async function findVerifactiInvoice(config,request) {
  const response=await requestVerifacti(config,'/verifactu/status',{method:'POST',body:{serie:request.serie,numero:request.numero,fecha_expedicion:request.fecha_expedicion}});
  return providerResult(response,'lookup');
}

async function cancelVerifactiRecord(config, queueItem) {
  const exp = queueItem.payload?.expedicion || {};
  const body = { ...splitSerieNumero(exp.numero, exp.serie), fecha_expedicion: toDdMmYyyy(exp.fecha_factura) };
  const response = await requestVerifacti(config, "/verifactu/cancel", { method: "POST", body, headers: { "Idempotency-Key": idempotencyKey(queueItem, "cancel") } });
  return { provider: "verifacti", operation: "cancel", request: body, response, provider_uuid: extractProviderUuid(response), provider_status: normalizeStatus(extractProviderStatus(response)) };
}

module.exports = {
  cancelVerifactiRecord, toDdMmYyyy, idempotencyKey,
  downloadVerifactiXml,
  createVerifactiRecord,
  mapInternalPayloadToVerifacti,
  findVerifactiInvoice,
  officialQrUrl,
  getVerifactiRecordStatus,
  probeVerifactiConnection,
  extractVerifactiWebhookPayload,
  extractProviderUuid,
  normalizeStatus,
};
