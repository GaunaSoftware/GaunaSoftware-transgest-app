const express = require("express");
const { body, validationResult } = require("express-validator");
const db      = require("../services/db");
const logger  = require("../services/logger");
const crypto  = require("crypto");
const zlib = require("zlib");
const pdfParse = require("pdf-parse");
const { getPaginationParams, paginatedResponse } = require("../services/paginate");
const { authenticate, GERENTE_O_TRAFICO, GERENTE_O_CONTABLE, SOLO_GERENTE } = require("../middleware/auth");
const { enviarEmail } = require("../services/email");
const { crearNotificacion, notificarUsuariosCliente } = require("../services/notificaciones");
const { buildDocumentoControlPayload, buildDocumentoControlPublicPayload, buildDocumentoControlExpediente, buildDocumentoControlStructuredExport, buildDocumentoControlSignaturePackage, buildDocumentoControlQrDataUrl, buildDocumentoControlHtml, generateDocumentoControlPdf, buildDocumentoControlFilename, buildDocumentoControlExportFilename, verifyPublicToken, verifyPublicVerificationCode } = require("../services/documentoControl");
const {
  syncPedidoRegulatoryCore,
  getPedidoRegulatoryCoreSummary,
  buildRegulatoryTransportPackage,
  getRegulatoryPayloadForExport,
  createRegulatoryTransmissionDraft,
  generateRegulatoryDossierPdf,
} = require("../services/regulatoryCore");
const { getEmpresaCalendarForDate, inferCcaaFromText } = require("../services/calendarioLaboral");
const { resolveBestApiKey, assertApiUsageAllowed, recordApiUsage, getGlobalSetting } = require("../services/apiKeys");
const { validateBase64Upload } = require("../services/uploadValidation");
const webhooks = require("../services/webhooks");
const adrService = require("../services/adr");

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let colaboradorWorkflowSchemaPromise = null;
let pedidoOrdenCargaSchemaPromise = null;
let pedidoCartaPorteSchemaPromise = null;
let documentoControlRepositorioSchemaPromise = null;

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function optionalUuid(value) {
  const normalized = String(value || "").trim();
  return UUID_RE.test(normalized) ? normalized : null;
}

const INCIDENCIA_PEDIDO_TIPOS = {
  taller: "Camion en taller",
  carga: "Problema en carga",
  descarga: "Problema en descarga",
  retraso: "Retraso",
  documentacion: "Documentacion",
  cliente: "Cliente",
  colaborador: "Colaborador",
  trafico: "Trafico",
  paralizacion: "Paralizacion",
  gps: "GPS / localizacion",
  otro: "Otro",
  operativa: "Operativa",
};

function normalizePedidoIncidenciaTipo(value) {
  const raw = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (["camion_taller", "vehiculo_taller", "averia", "taller"].includes(raw)) return "taller";
  if (["problema_carga", "carga"].includes(raw)) return "carga";
  if (["problema_descarga", "descarga"].includes(raw)) return "descarga";
  if (["retraso", "demora"].includes(raw)) return "retraso";
  if (["documentacion", "documento", "albaran", "dcd"].includes(raw)) return "documentacion";
  if (["cliente"].includes(raw)) return "cliente";
  if (["colaborador", "proveedor", "subcontratado"].includes(raw)) return "colaborador";
  if (["trafico", "planificacion"].includes(raw)) return "trafico";
  if (["paralizacion", "espera"].includes(raw)) return "paralizacion";
  if (["gps", "localizacion", "ubicacion"].includes(raw)) return "gps";
  if (["otro", "otros"].includes(raw)) return "otro";
  return "operativa";
}

function buildPedidoIncidenciaInput(body = {}, fallbackPedido = {}, actorRol = "") {
  const tipo = normalizePedidoIncidenciaTipo(body.incidencia_tipo || body.tipo_incidencia || fallbackPedido.incidencia_tipo);
  const descripcionRaw = String(
    body.incidencia
    ?? body.incidencia_descripcion
    ?? body.descripcion_incidencia
    ?? fallbackPedido.incidencia_descripcion
    ?? ""
  ).trim();
  const label = INCIDENCIA_PEDIDO_TIPOS[tipo] || INCIDENCIA_PEDIDO_TIPOS.operativa;
  const descripcion = descripcionRaw || label;
  const origen = actorRol === "chofer" ? "chofer" : "trafico";
  return { tipo, label, descripcion, origen };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function buildFirmaPedidoContext(pedido = {}) {
  return {
    pedido_id: pedido.id || "",
    pedido_numero: pedido.numero || "",
    ruta: {
      origen: pedido.origen || "",
      destino: pedido.destino || "",
    },
    fechas: {
      carga: dateOnly(pedido.fecha_carga),
      descarga: dateOnly(pedido.fecha_descarga || pedido.fecha_entrega),
    },
  };
}

function normalizeFirmaRol(value = "") {
  const raw = String(value || "").toLowerCase().trim();
  if (["cargador", "remitente", "origen"].includes(raw)) return "cargador";
  if (["chofer", "transportista", "carrier"].includes(raw)) return "chofer";
  return "destinatario";
}

function mergeFirmaEvidencia(existing = null, role = "destinatario", evidencia = {}) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const firmas = base.firmas && typeof base.firmas === "object" ? { ...base.firmas } : {};
  firmas[role] = evidencia;
  return {
    ...base,
    version: "transgest-firma-evidencia-multirrol-2026.06",
    estado: "evidencia_interna_pre_eidas",
    provider: "transgest_internal",
    firmas,
    last_role: role,
    last_signed_at: evidencia.firmado_at || new Date().toISOString(),
  };
}

function getFirmaEvidenciaPrincipal(evidencia = null) {
  if (!evidencia || typeof evidencia !== "object") return evidencia;
  if (evidencia.pedido_context) return evidencia;
  const role = evidencia.last_role || "destinatario";
  const principal = evidencia.firmas?.[role] || evidencia.firmas?.destinatario || evidencia.firmas?.cargador || evidencia.firmas?.chofer || null;
  if (principal && typeof principal === "object") return principal;
  if (evidencia.firma?.hash || evidencia.firma_hash || evidencia.pedido_context_hash_sha256 || evidencia.integrity_hash_sha256) return evidencia;
  return null;
}

function normalizeFirmaEvidenciaForResponse(evidencia = null) {
  const principal = getFirmaEvidenciaPrincipal(evidencia);
  if (!principal || typeof principal !== "object") return null;
  if (/^[a-f0-9]{64}$/i.test(String(principal.integrity_hash_sha256 || ""))) return principal;
  return {
    ...principal,
    integrity_hash_sha256: sha256Hex(stableJson({
      ...principal,
      integrity_hash_sha256: undefined,
    })),
  };
}

function buildFirmaPostSignatureIntegrity(pedido = {}, evidencia = null) {
  evidencia = getFirmaEvidenciaPrincipal(evidencia);
  if (!evidencia || typeof evidencia !== "object") {
    return {
      checked: false,
      status: "sin_firma",
      changed_after_signature: false,
      changes: [],
    };
  }
  const currentContext = buildFirmaPedidoContext(pedido);
  const signedContext = evidencia.pedido_context && typeof evidencia.pedido_context === "object"
    ? {
        pedido_id: evidencia.pedido_context.pedido_id || evidencia.pedido_id || pedido.id || "",
        pedido_numero: evidencia.pedido_context.pedido_numero || evidencia.pedido_numero || pedido.numero || "",
        ruta: {
          origen: evidencia.pedido_context.ruta?.origen || evidencia.ruta?.origen || "",
          destino: evidencia.pedido_context.ruta?.destino || evidencia.ruta?.destino || "",
        },
        fechas: {
          carga: dateOnly(evidencia.pedido_context.fechas?.carga || evidencia.fechas?.carga),
          descarga: dateOnly(evidencia.pedido_context.fechas?.descarga || evidencia.fechas?.descarga),
        },
      }
    : {
        pedido_id: evidencia.pedido_id || pedido.id || "",
        pedido_numero: evidencia.pedido_numero || pedido.numero || "",
        ruta: {
          origen: evidencia.ruta?.origen || "",
          destino: evidencia.ruta?.destino || "",
        },
        fechas: {
          carga: dateOnly(evidencia.fechas?.carga),
          descarga: dateOnly(evidencia.fechas?.descarga),
        },
      };
  const comparisons = [
    ["origen", signedContext.ruta.origen, currentContext.ruta.origen],
    ["destino", signedContext.ruta.destino, currentContext.ruta.destino],
    ["fecha_carga", signedContext.fechas.carga, currentContext.fechas.carga],
    ["fecha_descarga", signedContext.fechas.descarga, currentContext.fechas.descarga],
  ];
  const changes = comparisons
    .filter(([, signed, current]) => String(signed || "") !== String(current || ""))
    .map(([field, signed, current]) => ({ field, signed: signed || null, current: current || null }));
  return {
    checked: true,
    status: changes.length ? "cambios_detectados" : "sin_cambios",
    changed_after_signature: changes.length > 0,
    changes,
    signed_context_hash_sha256: evidencia.pedido_context_hash_sha256 || sha256Hex(stableJson(signedContext)),
    current_context_hash_sha256: sha256Hex(stableJson(currentContext)),
    signed_context: signedContext,
    current_context: currentContext,
  };
}

function didFirmaSignedContextChange(before = {}, after = {}) {
  const a = buildFirmaPedidoContext(before);
  const b = buildFirmaPedidoContext(after);
  return stableJson(a) !== stableJson(b);
}

async function logFirmaContextoModificadoSiProcede({ before, after, empresaId, actorTipo, actorId, queryClient = db }) {
  if (!before?.firma_evidencia || !after?.id || !didFirmaSignedContextChange(before, after)) return;
  const integrity = buildFirmaPostSignatureIntegrity(after, before.firma_evidencia);
  if (!integrity.changed_after_signature) return;
  await logPedidoEvento(after.id, empresaId, "firma.contexto_modificado", {
    status: integrity.status,
    changes: integrity.changes,
    signed_context_hash_sha256: integrity.signed_context_hash_sha256,
    current_context_hash_sha256: integrity.current_context_hash_sha256,
    mensaje: "Se modificaron datos sensibles del pedido despues de registrar la firma.",
  }, actorTipo || "usuario", actorId || null, queryClient);
  await notificarGerenciaPedido(
    empresaId,
    "firma_postfirma_modificada",
    "Pedido firmado modificado",
    `El pedido ${after.numero || after.id} tiene cambios en datos sensibles despues de registrar la firma.`,
    {
      pedido_id: after.id,
      pedido_numero: after.numero || "",
      changes: integrity.changes,
      signed_context_hash_sha256: integrity.signed_context_hash_sha256,
      current_context_hash_sha256: integrity.current_context_hash_sha256,
      dedupe_key: `firma-postfirma:${after.id}:${integrity.current_context_hash_sha256}`,
    },
    actorId || null
  ).catch(e => logger.warn("No se pudo notificar cambio postfirma a gerencia:", e.message));
}

function publicBaseUrl(req) {
  const apiEnvUrl = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || process.env.BACKEND_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "";
  const envUrl = process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "";
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req?.protocol || "";
  const host = forwardedHost || (typeof req?.get === "function" ? req.get("host") : "");
  const reqUrl = protocol && host ? `${protocol}://${host}` : "";
  const isLocal = (value) => {
    try {
      const url = new URL(String(value || ""));
      return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    } catch {
      return false;
    }
  };
  const isFrontendHost = (value) => {
    try {
      const url = new URL(String(value || ""));
      return /^app\./i.test(url.hostname) || /vercel\.app$/i.test(url.hostname);
    } catch {
      return false;
    }
  };
  if (apiEnvUrl && !(isLocal(apiEnvUrl) && reqUrl && !isLocal(reqUrl))) return apiEnvUrl;
  if (envUrl && reqUrl && isFrontendHost(envUrl) && !isFrontendHost(reqUrl)) return reqUrl;
  if (envUrl && !(isLocal(envUrl) && reqUrl && !isLocal(reqUrl))) return envUrl;
  if (reqUrl) return reqUrl;
  return "http://localhost";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizePedidoJsonList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function googleMapsSearchUrl(query) {
  const clean = String(query || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}`;
}

function stopDireccion(stop, fallback = "") {
  return String(stop?.direccion || stop?.address || stop?.lugar || fallback || "").replace(/\s+/g, " ").trim();
}

function stopMapsUrl(stop, fallback = "") {
  const direct = String(stop?.google_maps_url || stop?.googleMapsUrl || stop?.maps_url || stop?.metadata?.google_maps_url || "").trim();
  if (direct) return direct;
  const lat = Number(stop?.lat ?? stop?.latitud ?? stop?.metadata?.lat);
  const lng = Number(stop?.lng ?? stop?.longitud ?? stop?.metadata?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return googleMapsSearchUrl(`${lat},${lng}`);
  return googleMapsSearchUrl(stopDireccion(stop, fallback));
}

function buildColaboradorMapLinks(pedido = {}) {
  const cargas = normalizePedidoJsonList(pedido.puntos_carga);
  const descargas = normalizePedidoJsonList(pedido.puntos_descarga);
  const items = [
    ...cargas.map((stop, idx) => ({ tipo: idx === 0 ? "Carga" : `Carga ${idx + 1}`, stop, fallback: pedido.origen })),
    ...descargas.map((stop, idx) => ({ tipo: idx === 0 ? "Descarga" : `Descarga ${idx + 1}`, stop, fallback: pedido.destino })),
  ];
  const mapped = items.map(({ tipo, stop, fallback }) => {
    const direccion = stopDireccion(stop, fallback);
    const url = stopMapsUrl(stop, fallback);
    return { tipo, nombre: String(stop?.cliente_nombre || stop?.nombre || "").trim(), direccion, url };
  }).filter(item => item.direccion || item.url);
  if (!mapped.length) {
    const origenUrl = googleMapsSearchUrl(pedido.origen);
    const destinoUrl = googleMapsSearchUrl(pedido.destino);
    return [
      pedido.origen ? { tipo: "Carga", nombre: "", direccion: pedido.origen, url: origenUrl } : null,
      pedido.destino ? { tipo: "Descarga", nombre: "", direccion: pedido.destino, url: destinoUrl } : null,
    ].filter(Boolean);
  }
  return mapped;
}

function renderColaboradorMapsBox(pedido) {
  const links = buildColaboradorMapLinks(pedido);
  if (!links.length) return "";
  return `
    <div class="card">
      <h2>Ubicaciones y navegacion</h2>
      <p class="muted">Abre cada punto desde el movil. Si el enlace original no existe, se genera una busqueda de Google Maps con la direccion guardada.</p>
      ${links.map((item) => `
        <div class="f" style="margin-top:8px">
          <div class="fl">${htmlEscape(item.tipo)}</div>
          <div class="fv">${htmlEscape(item.nombre || item.direccion || "-")}</div>
          ${item.nombre && item.direccion ? `<div class="meta">${htmlEscape(item.direccion)}</div>` : ""}
          ${item.url ? `<a class="btn mapbtn" href="${htmlEscape(item.url)}" target="_blank" rel="noreferrer">Abrir ${htmlEscape(item.tipo)} en Google Maps</a>` : ""}
          ${item.url ? `<div class="muted" style="word-break:break-all;margin-top:6px">${htmlEscape(item.url)}</div>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

const PEDIDO_DATE_FIELDS = new Set(["fecha_pedido", "fecha_carga", "fecha_entrega", "fecha_descarga", "firma_fecha"]);

function normalizePedidoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getUTCFullYear();
    if (year < 2000 || year > 2100) return null;
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return raw;
}

function isInvalidPedidoDateInput(value) {
  return value !== "" && value !== null && value !== undefined && !normalizePedidoDate(value);
}

function assertPedidoDateInputs(source = {}, fields = PEDIDO_DATE_FIELDS) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field) && isInvalidPedidoDateInput(source[field])) {
      const err = new Error("Formato de fecha no valido. Usa el selector de fecha o el formato AAAA-MM-DD.");
      err.status = 400;
      err.field = field;
      throw err;
    }
  }
}

function assertPedidoDateOrder(fechaCarga, fechaDescarga) {
  const carga = normalizePedidoDate(fechaCarga);
  const descarga = normalizePedidoDate(fechaDescarga);
  if (carga && descarga && descarga < carga) {
    const err = new Error("La fecha de descarga no puede ser anterior a la fecha de carga.");
    err.status = 400;
    throw err;
  }
}

function normalizePedidoTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/(\d{2}:\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(11, 16);
}

function normalizeCountryKey(value = "") {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function paisEsEspana(value = "") {
  const key = normalizeCountryKey(value);
  return !key || ["espana", "españa", "spain", "es"].includes(key);
}

function calcularParalizacion({ minutos = 0, pais = "Espana", fase = "carga" } = {}) {
  const totalMin = Math.max(0, Math.round(Number(minutos || 0)));
  const ipremDia = Math.max(0, Number(process.env.IPREM_DIA_EUR || 20));
  const graciaLegalMin = Math.max(0, Number(process.env.PARALIZACION_GRACIA_MIN || 60));
  const avisoMin = Math.max(0, Number(process.env.PARALIZACION_AVISO_MIN || 60));
  const horasPorDia = Math.max(1, Number(process.env.PARALIZACION_HORAS_DIA || 10));
  const multiplicador = Math.max(0, Number(process.env.PARALIZACION_MULTIPLICADOR_IPREM || 2));
  const esEspana = paisEsEspana(pais);
  const reclamableMin = esEspana ? Math.max(0, totalMin - graciaLegalMin) : 0;
  let horasPendientes = reclamableMin > 0 ? Math.ceil(reclamableMin / 60) : 0;
  const tarifaHora = esEspana ? (ipremDia * multiplicador) / horasPorDia : 0;
  let importeBase = 0;
  let dia = 1;
  while (horasPendientes > 0) {
    const horasDia = Math.min(horasPendientes, horasPorDia);
    const recargoDia = dia === 1 ? 1 : dia === 2 ? 1.25 : 1.5;
    importeBase += horasDia * tarifaHora * recargoDia;
    horasPendientes -= horasDia;
    dia += 1;
  }
  const importe = Math.round(importeBase * 100) / 100;
  return {
    pais: pais || "Espana",
    fase,
    minutos: totalMin,
    aviso: totalMin > avisoMin,
    reclamable: esEspana && totalMin > graciaLegalMin,
    importe,
    moneda: "EUR",
    norma: esEspana
      ? "Espana: LCTTM art. 22. Reclamacion orientativa tras 1 h, sin computar la primera hora, segun IPREM/dia x2, maximo 10 h/dia y pacto aplicable."
      : "Internacional/CMR: no hay cuantia uniforme en CMR para esperas de carga/descarga; aplicar pacto contractual o norma local del pais.",
  };
}

function inferPaisOperacionPedido(pedido = {}, fase = "carga") {
  if (String(fase || "").toLowerCase().includes("descarga")) {
    return pedido.destino_pais || pedido.pais_destino || "Espana";
  }
  return pedido.origen_pais || pedido.pais_origen || "Espana";
}

function normalizePedidoForClient(pedido) {
  if (!pedido || typeof pedido !== "object") return pedido;
  return {
    ...pedido,
    fecha_pedido: normalizePedidoDate(pedido.fecha_pedido),
    fecha_carga: normalizePedidoDate(pedido.fecha_carga),
    fecha_descarga: normalizePedidoDate(pedido.fecha_descarga),
    fecha_entrega: normalizePedidoDate(pedido.fecha_entrega),
    hora_carga: normalizePedidoTime(pedido.hora_carga),
    hora_descarga: normalizePedidoTime(pedido.hora_descarga),
    puntos_carga: normalizePedidoJsonList(pedido.puntos_carga),
    puntos_descarga: normalizePedidoJsonList(pedido.puntos_descarga),
  };
}

async function ensureColaboradorWorkflowSchema() {
  if (!colaboradorWorkflowSchemaPromise) {
    colaboradorWorkflowSchemaPromise = (async () => {
      await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"').catch(() => {});
      await db.query("ALTER TYPE estado_pedido ADD VALUE IF NOT EXISTS 'incidencia'").catch(error => {
        logger.warn("No se pudo asegurar el estado incidencia en pedidos:", error.message);
      });
      await db.query("ALTER TABLE pedidos ALTER COLUMN ventana_carga TYPE VARCHAR(80)").catch(() => {});
      await db.query("ALTER TABLE pedidos ALTER COLUMN ventana_descarga TYPE VARCHAR(80)").catch(() => {});
      await db.query(`
        CREATE TABLE IF NOT EXISTS colaborador_pedido_tokens (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          empresa_id UUID NOT NULL,
          accion VARCHAR(40) NOT NULL,
          token_hash VARCHAR(80) NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          usado_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS matricula_colaborador VARCHAR(60)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_matricula_colaborador VARCHAR(60)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS matricula_manual VARCHAR(60)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_matricula_manual VARCHAR(60)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carga_lateral BOOLEAN DEFAULT false").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carga_trasera BOOLEAN DEFAULT false").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carga_techo BOOLEAN DEFAULT false").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS intercambio_palets BOOLEAN DEFAULT false").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS requiere_cinchas BOOLEAN DEFAULT true").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen_pais VARCHAR(80) DEFAULT 'España'").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen_provincia VARCHAR(120)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS destino_pais VARCHAR(80) DEFAULT 'España'").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS destino_provincia VARCHAR(120)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metros_lineales NUMERIC(10,2)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cmr_tipo VARCHAR(30) DEFAULT 'nacional'").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS adr BOOLEAN DEFAULT false").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS adr_items JSONB NOT NULL DEFAULT '[]'::jsonb").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelado_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelado_by TEXT").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_viaje VARCHAR(20) DEFAULT 'normal'").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS viaje_enlazado_id UUID REFERENCES pedidos(id) ON DELETE SET NULL").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS grupo_ida_vuelta UUID").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS km_vacio_enlace NUMERIC(10,2) DEFAULT 0").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS enlace_retorno_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS enlace_retorno_by UUID").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_pedidos_ida_retorno_grupo ON pedidos(empresa_id, grupo_ida_vuelta)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_pedidos_viaje_enlazado ON pedidos(empresa_id, viaje_enlazado_id)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_base_sin_combustible NUMERIC(10,2)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS recargo_combustible_pct NUMERIC(7,3) DEFAULT 0").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS importe_revision_combustible NUMERIC(10,2) DEFAULT 0").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_iva NUMERIC(5,2) NOT NULL DEFAULT 21").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general'").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_colaborador_unitario NUMERIC(12,4)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS minimo_colaborador_unidades NUMERIC(12,3)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_precio_confirmado BOOLEAN DEFAULT false").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_precio_confirmado_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_carga_confirmada_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_en_camino_confirmada_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_descarga_confirmada_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_workflow_enviado_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_tipo VARCHAR(80)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_descripcion TEXT").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_origen VARCHAR(40)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_creada_por UUID").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_creada_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_automatica BOOLEAN DEFAULT false").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paralizacion_minutos INTEGER DEFAULT 0").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paralizacion_importe NUMERIC(10,2) DEFAULT 0").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paralizacion_moneda VARCHAR(8) DEFAULT 'EUR'").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paralizacion_norma TEXT").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paralizacion_pais VARCHAR(80)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_cargador TEXT").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_cargador_nombre VARCHAR(180)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_cargador_fecha TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_chofer TEXT").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_chofer_nombre VARCHAR(180)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS firma_chofer_fecha TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_efectivo_nombre VARCHAR(120)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_efectivo_apellidos VARCHAR(180)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_efectivo_dni VARCHAR(40)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_efectivo_telefono VARCHAR(40)").catch(() => {});
      await db.query(`
        CREATE TABLE IF NOT EXISTS pedido_docs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          pedido_id UUID NOT NULL,
          empresa_id UUID,
          nombre VARCHAR(255) NOT NULL,
          tipo VARCHAR(80),
          file_base64 TEXT,
          file_mime VARCHAR(120),
          file_size_kb INTEGER,
          notas TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(() => {});
      await db.query("ALTER TABLE pedido_docs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
      await db.query("ALTER TABLE pedido_docs ADD COLUMN IF NOT EXISTS visible_chofer BOOLEAN NOT NULL DEFAULT false").catch(() => {});
      await db.query(`
        CREATE TABLE IF NOT EXISTS pedido_eventos (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          pedido_id UUID NOT NULL,
          empresa_id UUID NOT NULL,
          tipo VARCHAR(80) NOT NULL,
          actor_tipo VARCHAR(40) NOT NULL DEFAULT 'sistema',
          actor_id UUID,
          detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(() => {});
      await db.query(`
        CREATE TABLE IF NOT EXISTS pedido_chofer_pasos (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
        CREATE TABLE IF NOT EXISTS pedido_colaborador_pagos (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          empresa_id UUID NOT NULL,
          colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL,
          factura_nombre VARCHAR(255),
          factura_data TEXT,
          fecha_recepcion DATE,
          fecha_pago_calculada DATE,
          fecha_pago_real DATE,
          importe NUMERIC(12,2) NOT NULL DEFAULT 0,
          pagado BOOLEAN NOT NULL DEFAULT false,
          documentacion_recibida BOOLEAN NOT NULL DEFAULT false,
          fecha_documentacion_recepcion DATE,
          notas_pago TEXT,
          created_by UUID,
          updated_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (pedido_id)
        )
      `).catch(() => {});
      await db.query(`ALTER TABLE pedido_colaborador_pagos ADD COLUMN IF NOT EXISTS documentacion_recibida BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
      await db.query(`ALTER TABLE pedido_colaborador_pagos ADD COLUMN IF NOT EXISTS fecha_documentacion_recepcion DATE`).catch(() => {});
      await db.query(`ALTER TABLE pedido_colaborador_pagos ADD COLUMN IF NOT EXISTS notas_pago TEXT`).catch(() => {});
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_inbox_runs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          empresa_id UUID NOT NULL,
          user_id UUID,
          provider VARCHAR(40),
          status VARCHAR(40) NOT NULL DEFAULT 'local',
          confidence INTEGER DEFAULT 0,
          source_type VARCHAR(80),
          filename TEXT,
          attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
          issues JSONB NOT NULL DEFAULT '[]'::jsonb,
          warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
          suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
          error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_ai_inbox_runs_empresa_created ON ai_inbox_runs(empresa_id, created_at DESC)").catch(() => {});
    })().catch((error) => {
      colaboradorWorkflowSchemaPromise = null;
      throw error;
    });
  }
  await colaboradorWorkflowSchemaPromise;
}

async function optionalPedidoQuery(queryClient, sql, params, warning) {
  if (queryClient === db) {
    return queryClient.query(sql, params).catch(error => {
      logger.warn(warning, error.message);
      return { rows: [] };
    });
  }
  const savepoint = "pedido_optional_query";
  await queryClient.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await queryClient.query(sql, params);
    await queryClient.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    await queryClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await queryClient.query(`RELEASE SAVEPOINT ${savepoint}`);
    logger.warn(warning, error.message);
    return { rows: [] };
  }
}

async function logPedidoEvento(pedidoId, empresaId, tipo, detalle = {}, actorTipo = "sistema", actorId = null, queryClient = db) {
  await optionalPedidoQuery(
    queryClient,
    `INSERT INTO pedido_eventos (pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [pedidoId, empresaId, tipo, actorTipo, actorId, JSON.stringify(detalle)],
    "No se pudo registrar evento de pedido:"
  );
}

function summarizePedidoChanges(before = {}, after = {}, fieldNames = []) {
  const labels = {
    cliente_id: "Cliente",
    ruta_id: "Ruta",
    origen: "Origen",
    destino: "Destino",
    fecha_carga: "Fecha carga",
    fecha_descarga: "Fecha descarga",
    fecha_entrega: "Fecha entrega",
    estado: "Estado",
    vehiculo_id: "Vehiculo",
    chofer_id: "Chofer",
    chofer2_id: "Segundo chofer",
    remolque_id: "Remolque",
    colaborador_id: "Colaborador",
    importe: "Importe",
    precio_unitario: "Precio unitario",
    peso_kg: "Peso",
    bultos: "Bultos",
    referencia_cliente: "Referencia cliente",
    condiciones_adicionales: "Condiciones",
  };
  const norm = (value) => value === null || value === undefined ? "" : String(value);
  return [...new Set(fieldNames)]
    .map(field => ({
      field,
      label: labels[field] || field.replace(/_/g, " "),
      before: norm(before[field]).slice(0, 160),
      after: norm(after[field]).slice(0, 160),
    }))
    .filter(change => change.before !== change.after)
    .slice(0, 20);
}

async function logAiInboxRun({
  empresaId,
  userId = null,
  provider = null,
  status = "local",
  confidence = 0,
  sourceType = "",
  filename = "",
  attachments = [],
  issues = [],
  warnings = [],
  suggestions = [],
  error = "",
} = {}) {
  if (!empresaId) return;
  await db.query(
    `INSERT INTO ai_inbox_runs
       (empresa_id,user_id,provider,status,confidence,source_type,filename,attachments,issues,warnings,suggestions,error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      empresaId,
      userId,
      provider || null,
      String(status || "local").slice(0, 40),
      Math.max(0, Math.min(100, Math.round(Number(confidence || 0)))),
      String(sourceType || "").slice(0, 80),
      filename ? String(filename).slice(0, 500) : null,
      JSON.stringify(attachments || []),
      JSON.stringify(issues || []),
      JSON.stringify(warnings || []),
      JSON.stringify(suggestions || []),
      error ? String(error).slice(0, 1000) : null,
    ]
  ).catch(e => logger.warn("No se pudo registrar analisis de Bandeja IA:", e.message));
}

function buildAiInboxOperationalSummary(run = {}) {
  const issues = Array.isArray(run.issues) ? run.issues : [];
  const warnings = Array.isArray(run.warnings) ? run.warnings : [];
  const suggestions = Array.isArray(run.suggestions) ? run.suggestions : [];
  const attachments = Array.isArray(run.attachments) ? run.attachments : [];
  const status = String(run.status || "");
  const confidence = Number(run.confidence || 0);
  const criticalIssues = issues.filter(i => String(i?.severity || "").toLowerCase() === "alta");
  const detected = suggestions.slice(0, 4).map(s => s?.label || s?.detail || s?.type).filter(Boolean);
  const missing = issues.slice(0, 5).map(i => i?.message || i?.label || i?.key).filter(Boolean);
  const alerts = warnings.slice(0, 4).map(w => w?.message || w?.label || w?.key).filter(Boolean);
  let priority = "media";
  if (status === "error" || criticalIssues.length || warnings.some(w => String(w?.severity || "").toLowerCase() === "alta")) priority = "alta";
  else if (status === "listo_para_revisar" && confidence >= 78 && !issues.length) priority = "baja";
  let action = "Revisar borrador antes de guardar.";
  if (status === "error") action = "Reintentar con texto mas claro o revisar el documento origen.";
  else if (criticalIssues.length || issues.length) action = "Completar campos bloqueantes antes de crear el pedido.";
  else if (warnings.length) action = "Validar avisos de tarifa, ruta o asignacion antes de guardar.";
  else if (status === "listo_para_revisar") action = "Abrir borrador y guardar si coincide con la orden recibida.";
  return {
    priority,
    action,
    detected,
    missing,
    alerts,
    attachment_count: attachments.length,
    document_text_count: suggestions.filter(s => s?.type === "documento_texto").length,
    has_visual_ai: suggestions.some(s => s?.type === "ia_visual"),
    ready_to_create: status === "listo_para_revisar" && !issues.length,
  };
}

function normalizeChoferPasosPayload(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const boolKeys = [
    "carga_iniciada",
    "carga_proceso",
    "carga_ok",
    "viaje_iniciado",
    "posicionado_descarga",
    "descarga_iniciada",
    "descarga_ok",
    "albaran_carga",
    "albaran_descarga",
    "firma_entrega",
    "aviso_espera_carga",
    "aviso_espera_descarga",
    "dcd_revisado",
    "dcd_disponible",
  ];
  const next = {};
  for (const key of boolKeys) {
    if (source[key] !== undefined) next[key] = Boolean(source[key]);
  }
  [
    "mercancia",
    "bultos",
    "referencia_cliente",
    "mercancia_cargada",
    "mercancia_palets",
    "mercancia_referencia",
  ].forEach((key) => {
    if (source[key] !== undefined) next[key] = String(source[key] || "").trim().slice(0, 500);
  });
  if (source.peso_kg !== undefined || source.mercancia_peso_kg !== undefined) {
    const n = parseLocaleNumber(source.peso_kg ?? source.mercancia_peso_kg);
    if (Number.isFinite(n) && n >= 0) next.peso_kg = Math.round(n * 100) / 100;
    if (Number.isFinite(n) && n >= 0) next.mercancia_peso_kg = String(Math.round(n * 100) / 100);
  }
  for (const key of ["km_carga", "km_descarga"]) {
    if (source[key] !== undefined && source[key] !== "") {
      const n = Number(source[key]);
      if (Number.isFinite(n) && n >= 0) next[key] = Math.round(n * 10) / 10;
    }
  }
  if (source.carga_ubicacion && typeof source.carga_ubicacion === "object") {
    const lat = Number(source.carga_ubicacion.lat);
    const lng = Number(source.carga_ubicacion.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const capturedDate = source.carga_ubicacion.captured_at ? new Date(source.carga_ubicacion.captured_at) : null;
      next.carga_ubicacion = {
        lat,
        lng,
        accuracy_m: Number.isFinite(Number(source.carga_ubicacion.accuracy_m)) ? Math.round(Number(source.carga_ubicacion.accuracy_m)) : null,
        captured_at: capturedDate && Number.isFinite(capturedDate.getTime()) ? capturedDate.toISOString() : new Date().toISOString(),
        google_maps_url: googleMapsSearchUrl(`${lat},${lng}`),
        source: "app_chofer",
      };
    }
  }
  if (source.updated_at) next.updated_at = source.updated_at;
  [
    "carga_iniciada_at",
    "carga_proceso_at",
    "carga_ok_at",
    "viaje_iniciado_at",
    "posicionado_descarga_at",
    "descarga_iniciada_at",
    "descarga_ok_at",
    "albaran_carga_at",
    "albaran_descarga_at",
    "firma_entrega_at",
    "aviso_espera_carga_at",
    "aviso_espera_descarga_at",
    "dcd_revisado_at",
    "dcd_disponible_at",
  ].forEach((key) => {
    if (source[key]) {
      const d = new Date(source[key]);
      if (Number.isFinite(d.getTime())) next[key] = d.toISOString();
    }
  });
  return next;
}

function hasStopUsableLocation(stop = {}) {
  if (!stop || typeof stop !== "object") return false;
  if (String(stop.google_maps_url || stop.maps_url || "").trim()) return true;
  const lat = Number(stop.lat ?? stop.latitude);
  const lng = Number(stop.lng ?? stop.lon ?? stop.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

async function guardarUbicacionCargaDesdeChofer({ pedidoId, empresaId, location = {}, actorId = null }) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { rows } = await db.query(
    "SELECT id, numero, origen, puntos_carga, ultima_posicion FROM pedidos WHERE id=$1 AND empresa_id=$2 LIMIT 1",
    [pedidoId, empresaId]
  );
  const pedido = rows[0];
  if (!pedido) return null;
  const puntos = normalizePedidoJsonList(pedido.puntos_carga);
  const first = puntos[0] && typeof puntos[0] === "object" ? { ...puntos[0] } : { direccion: pedido.origen || "", tipo: "carga" };
  if (hasStopUsableLocation(first) || String(pedido.ultima_posicion || "").trim()) return null;
  const capturedAt = location.captured_at || new Date().toISOString();
  const mapsUrl = googleMapsSearchUrl(`${lat},${lng}`);
  const nextFirst = {
    ...first,
    lat,
    lng,
    google_maps_url: mapsUrl,
    ubicacion_fuente: "app_chofer_carga",
    ubicacion_precision_m: location.accuracy_m ?? null,
    ubicacion_capturada_at: capturedAt,
  };
  const nextPuntos = [nextFirst, ...puntos.slice(1)];
  await db.query(
    `UPDATE pedidos
        SET puntos_carga=$1::jsonb,
            updated_at=NOW()
      WHERE id=$2 AND empresa_id=$3`,
    [JSON.stringify(nextPuntos), pedidoId, empresaId]
  );
  await logPedidoEvento(pedidoId, empresaId, "chofer.ubicacion_carga_guardada", {
    lat,
    lng,
    accuracy_m: location.accuracy_m ?? null,
    google_maps_url: mapsUrl,
    captured_at: capturedAt,
  }, "chofer", actorId || null);
  await notificarGestionPedido(
    empresaId,
    "chofer_ubicacion_carga",
    "Ubicacion de carga guardada por chofer",
    `El chofer ha marcado posicion de carga para el pedido ${pedido.numero || pedidoId}.`,
    { pedido_id: pedidoId, lat, lng, google_maps_url: mapsUrl, dedupe_key: `ubicacion-carga:${pedidoId}` },
    actorId
  );
  return nextPuntos;
}

function minutosEntreIso(a, b) {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function buildLocalDateTime(fecha, hora = "00:00") {
  const date = normalizePedidoDate(fecha);
  if (!date) return null;
  const time = normalizePedidoTime(hora) || "00:00";
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addMinutesDate(date, minutes = 0) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + Number(minutes || 0) * 60000);
}

function splitPedidoDateTime(date) {
  if (!date || Number.isNaN(date.getTime())) return { fecha: null, hora: null };
  const pad = n => String(n).padStart(2, "0");
  return {
    fecha: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    hora: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

async function notificarGestionPedido(empresaId, tipo, titulo, mensaje, data = {}, createdBy = null) {
  if (!empresaId) return;
  const { rows } = await db.query(
    "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('gerente','trafico')",
    [empresaId]
  ).catch(() => ({ rows: [] }));
  const key = data?.dedupe_key || `${tipo}:${data?.pedido_id || ""}:${data?.fase || ""}`;
  const existing = await db.query(
    `SELECT id FROM notificaciones_internas
      WHERE empresa_id=$1 AND tipo=$2 AND data->>'dedupe_key'=$3 AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1`,
    [empresaId, tipo, key]
  ).catch(() => ({ rows: [] }));
  if (existing.rows[0]) return;
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo,
    titulo,
    mensaje,
    data: { ...data, dedupe_key: key },
    created_by: createdBy,
  }).catch(() => null)));
}

async function notificarClienteEstadoPedido(pedido, estadoAnterior, estadoNuevo, createdBy = null) {
  if (!pedido?.empresa_id || !pedido?.cliente_id || !estadoNuevo || String(estadoAnterior || "") === String(estadoNuevo)) return [];
  const labels = {
    pendiente: "Pendiente",
    confirmado: "Confirmado",
    en_curso: "En ruta",
    descarga: "En descarga",
    entregado: "Entregado",
    cancelado: "Cancelado",
    incidencia: "Con incidencia",
    facturado: "Facturado",
  };
  const label = labels[estadoNuevo] || estadoNuevo;
  return notificarUsuariosCliente({
    empresa_id: pedido.empresa_id,
    cliente_id: pedido.cliente_id,
    tipo: "portal_cliente_pedido_estado",
    titulo: `Viaje ${pedido.numero || "actualizado"}: ${label}`,
    mensaje: `El viaje ${pedido.origen || "Origen"} -> ${pedido.destino || "Destino"} ha cambiado a ${label.toLowerCase()}.`,
    data: {
      pedido_id: pedido.id,
      pedido_numero: pedido.numero || null,
      estado_anterior: estadoAnterior || null,
      estado: estadoNuevo,
      tab: "seguimiento",
      view: "portal_cliente",
      dedupe_key: `portal-pedido-estado:${pedido.id}:${estadoNuevo}`,
    },
    created_by: createdBy,
  });
}

async function notificarGerenciaPedido(empresaId, tipo, titulo, mensaje, data = {}, createdBy = null) {
  if (!empresaId) return;
  const { rows } = await db.query(
    "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text='gerente'",
    [empresaId]
  ).catch(() => ({ rows: [] }));
  const key = data?.dedupe_key || `${tipo}:${data?.pedido_id || ""}:${data?.fecha || ""}:${data?.ccaa || ""}`;
  const existing = await db.query(
    `SELECT id FROM notificaciones_internas
      WHERE empresa_id=$1 AND tipo=$2 AND data->>'dedupe_key'=$3 AND created_at > NOW() - INTERVAL '7 days'
      LIMIT 1`,
    [empresaId, tipo, key]
  ).catch(() => ({ rows: [] }));
  if (existing.rows[0]) return;
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo,
    titulo,
    mensaje,
    data: { ...data, dedupe_key: key },
    created_by: createdBy,
  }).catch(() => null)));
}

async function notificarAdministracionPedido(empresaId, tipo, titulo, mensaje, data = {}, createdBy = null) {
  if (!empresaId) return;
  const { rows } = await db.query(
    "SELECT id FROM usuarios WHERE empresa_id=$1 AND activo=true AND rol::text IN ('gerente','administrativo','contable')",
    [empresaId]
  ).catch(() => ({ rows: [] }));
  const key = data?.dedupe_key || `${tipo}:${data?.pedido_id || ""}:${data?.fase || ""}`;
  const existing = await db.query(
    `SELECT id FROM notificaciones_internas
      WHERE empresa_id=$1 AND tipo=$2 AND data->>'dedupe_key'=$3 AND leida=false
      LIMIT 1`,
    [empresaId, tipo, key]
  ).catch(() => ({ rows: [] }));
  if (existing.rows[0]) return;
  await Promise.all(rows.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo,
    titulo,
    mensaje,
    data: { ...data, dedupe_key: key },
    created_by: createdBy,
  }).catch(() => null)));
}

function fechaOperacionDestinoPedido(payload = {}) {
  return normalizePedidoDate(
    payload.fecha_descarga ||
    payload.fecha_entrega ||
    payload.fecha_carga ||
    payload.fecha_pedido
  );
}

function textoDestinoPedido(payload = {}) {
  const partes = [payload.destino];
  for (const stop of normalizePedidoJsonList(payload.puntos_descarga)) partes.push(stopDireccion(stop));
  return partes.filter(Boolean).join(" | ");
}

async function evaluarFestivoDestinoPedido(empresaId, payload = {}) {
  const fecha = fechaOperacionDestinoPedido(payload);
  const destino = textoDestinoPedido(payload);
  if (!empresaId || !fecha || !destino) return null;
  const ccaa = inferCcaaFromText(destino);
  if (!ccaa) return null;
  const year = Number(String(fecha).slice(0, 4));
  const calendar = await getEmpresaCalendarForDate(db, empresaId, year, ccaa);
  const holiday = (calendar.holidays || []).find(h => h.date === fecha);
  if (!holiday) return null;
  return {
    fecha,
    destino,
    ccaa,
    ccaa_label: calendar.ccaa_label,
    festivo_nombre: holiday.localName || holiday.name || "Festivo",
    ambito: holiday.scope || (holiday.global ? "nacional" : "autonomico"),
    fuente: calendar.fuente,
    updated_at: calendar.updated_at,
  };
}

async function bloquearSiFestivoNoConfirmado(req, payload = {}, pedidoActual = null) {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const merged = { ...(pedidoActual || {}), ...(payload || {}) };
  const aviso = await evaluarFestivoDestinoPedido(empresaId, merged);
  if (!aviso) return null;
  const confirmado = req.body?.festivo_confirmado === true || req.body?.festivo_leido === true || req.body?.confirmar_festivo === true;
  if (!confirmado) {
    const err = new Error("Festivo en destino");
    err.status = 409;
    err.aviso = aviso;
    throw err;
  }
  return aviso;
}

function responderFestivoPendiente(res, aviso) {
  return res.status(409).json({
    error: `El destino esta en ${aviso.ccaa_label} y el ${aviso.fecha} figura como festivo (${aviso.festivo_nombre}).`,
    requiere_confirmacion: true,
    aviso_festivo: aviso,
  });
}

function normalizePlanningText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstPedidoStopWithCoords(pedido = {}) {
  const stops = normalizePedidoJsonList(pedido.puntos_carga);
  for (const stop of stops) {
    const lat = Number(stop.lat ?? stop.latitude);
    const lng = Number(stop.lng ?? stop.lon ?? stop.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, text: stopDireccion(stop) };
  }
  return null;
}

function distanceKm(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.lat);
  const lon1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lon2 = Number(b.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const r = 6371;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function ageHours(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 36e5);
}

function lastPedidoStopWithCoords(pedido = {}) {
  const stops = normalizePedidoJsonList(pedido.puntos_descarga);
  for (let i = stops.length - 1; i >= 0; i -= 1) {
    const stop = stops[i] || {};
    const lat = Number(stop.lat ?? stop.latitude);
    const lng = Number(stop.lng ?? stop.lon ?? stop.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, text: stopDireccion(stop) };
  }
  return null;
}

function combinePedidoDateTime(dateValue, timeValue) {
  if (!dateValue) return null;
  const datePart = dateOnly(dateValue);
  if (!datePart) return null;
  const rawTime = String(timeValue || "").trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(rawTime);
  const timePart = match ? `${match[1].padStart(2, "0")}:${match[2]}:00` : "12:00:00";
  const date = new Date(`${datePart}T${timePart}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function estimateTruckTravelMinutes(distanceKmValue) {
  const km = Number(distanceKmValue);
  if (!Number.isFinite(km) || km < 0) return null;
  const driving = (km / 70) * 60;
  const buffer = km > 250 ? 45 : km > 100 ? 30 : 15;
  return Math.max(5, Math.round(driving + buffer));
}

function buildRepositioningPlan({ vehicle, originCoord, previousTrip, targetPedido }) {
  const now = new Date();
  const currentLocation = pickVehiclePlanningLocation(vehicle);
  const previousCoord = previousTrip ? lastPedidoStopWithCoords(previousTrip) : null;
  const previousFinishAt = previousTrip ? combinePedidoDateTime(previousTrip.fecha_descarga || previousTrip.fecha_entrega || previousTrip.fecha_carga, previousTrip.hora_descarga) : null;
  const fromLocation = previousCoord || currentLocation;
  const source = previousCoord ? "fin_viaje_asignado" : (currentLocation.priority || "sin_posicion");
  const distance = distanceKm(fromLocation, originCoord);
  const travelMin = estimateTruckTravelMinutes(distance);
  const departureBase = previousFinishAt && previousFinishAt > now ? previousFinishAt : now;
  const arrivalAt = travelMin !== null ? new Date(departureBase.getTime() + travelMin * 60000) : null;
  const targetLoadAt = combinePedidoDateTime(targetPedido?.fecha_carga, targetPedido?.hora_carga);
  return {
    source,
    source_label: previousCoord
      ? `Fin previsto del viaje ${previousTrip.numero || ""}`.trim()
      : (currentLocation.priority === "gps_api" ? "Posicion GPS actual" : currentLocation.priority === "app_chofer" ? "Ultima posicion app chofer" : "Ultima posicion conocida"),
    from_text: previousCoord?.text || currentLocation.text || "",
    from_recorded_at: previousCoord ? previousFinishAt?.toISOString() || null : currentLocation.recorded_at || null,
    previous_trip: previousTrip ? {
      id: previousTrip.id,
      numero: previousTrip.numero,
      destino: previousTrip.destino || "",
      fecha_fin_prevista: previousFinishAt?.toISOString() || null,
    } : null,
    distancia_hasta_carga_km: distance === null ? null : Number(distance.toFixed(1)),
    tiempo_hasta_carga_min: travelMin,
    salida_considerada_at: travelMin !== null ? departureBase.toISOString() : null,
    llegada_estimada_carga_at: arrivalAt?.toISOString() || null,
    hora_carga_objetivo_at: targetLoadAt?.toISOString() || null,
    llega_antes_hora_carga: arrivalAt && targetLoadAt ? arrivalAt <= targetLoadAt : null,
    calculado_desde_hora_actual: !(previousFinishAt && previousFinishAt > now),
  };
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return null;
}

function numericFromDeep(raw, keys = []) {
  const stack = [raw].filter(Boolean);
  const wanted = new Set(keys.map(k => String(k).toLowerCase()));
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, value] of Object.entries(item)) {
      const normalized = String(key).toLowerCase();
      if (wanted.has(normalized) && Number.isFinite(Number(value))) return Number(value);
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

function jornadaEventosForPlanning(row = {}) {
  const raw = row.jornada_eventos;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function minutesBetweenSafe(a, b) {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function buildDriverHoursInfo(vehicle = {}) {
  const raw = parseMaybeJson(vehicle.gps_log_raw);
  const tachoRemaining = numericFromDeep(raw, [
    "driving_remaining_min",
    "remaining_driving_min",
    "remainingdrivingminutes",
    "driver_remaining_minutes",
    "conduccion_restante_min",
    "minutos_conduccion_restantes",
  ]);
  if (tachoRemaining !== null) {
    return {
      integrated: true,
      source: vehicle.gps_log_provider || vehicle.gps_provider || "tacografo",
      conduccion_disponible_min: Math.max(0, Math.round(tachoRemaining)),
      jornada_disponible_min: numericFromDeep(raw, ["shift_remaining_min", "jornada_restante_min", "working_time_remaining_min"]),
      avisos: [],
    };
  }
  if (vehicle.jornada_estado !== "abierta") {
    return {
      integrated: false,
      source: "sin_tacografo",
      conduccion_disponible_min: null,
      jornada_disponible_min: null,
      avisos: ["Sin dato de tacografo integrado ni jornada abierta."],
    };
  }
  const nowIso = new Date().toISOString();
  const eventos = jornadaEventosForPlanning(vehicle);
  const normalized = eventos.length ? eventos : [{ tipo: vehicle.actividad_actual || "otros_trabajos", at: vehicle.jornada_inicio_at || nowIso }];
  let conduccion = 0;
  let conduccionDesdePausa = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const ev = normalized[i] || {};
    const nextAt = normalized[i + 1]?.at || nowIso;
    const mins = minutesBetweenSafe(ev.at, nextAt);
    if (ev.tipo === "conduccion") {
      conduccion += mins;
      conduccionDesdePausa += mins;
    } else if (["pausa", "descanso"].includes(ev.tipo) && mins >= 45) {
      conduccionDesdePausa = 0;
    }
  }
  return {
    integrated: false,
    source: "app_chofer_estimado",
    conduccion_disponible_min: Math.max(0, 540 - conduccion),
    conduccion_continua_disponible_min: Math.max(0, 270 - conduccionDesdePausa),
    jornada_disponible_min: null,
    avisos: ["Estimacion interna por app; no sustituye el tacografo legal."],
  };
}

function pickVehiclePlanningLocation(v = {}) {
  const gpsLat = Number(v.gps_log_lat);
  const gpsLng = Number(v.gps_log_lng);
  if (Number.isFinite(gpsLat) && Number.isFinite(gpsLng)) {
    return {
      lat: gpsLat,
      lng: gpsLng,
      text: v.gps_log_ubicacion || v.ubicacion_actual || "",
      source: v.gps_log_provider || v.gps_provider || "gps",
      priority: "gps_api",
      recorded_at: v.gps_log_recorded_at || v.ubicacion_ts || null,
    };
  }
  const appLat = Number(v.app_log_lat);
  const appLng = Number(v.app_log_lng);
  if (Number.isFinite(appLat) && Number.isFinite(appLng)) {
    return {
      lat: appLat,
      lng: appLng,
      text: v.app_log_ubicacion || v.ubicacion_actual || "",
      source: "app_chofer",
      priority: "app_chofer",
      recorded_at: v.app_log_recorded_at || v.ubicacion_ts || null,
    };
  }
  const lat = Number(v.gps_lat);
  const lng = Number(v.gps_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const fuente = String(v.ubicacion_fuente || v.gps_provider || "manual");
    const apiLike = fuente && !["app_chofer", "manual", "ultima_descarga"].includes(fuente);
    return {
      lat,
      lng,
      text: v.ubicacion_actual || "",
      source: fuente,
      priority: apiLike ? "gps_api" : (fuente === "app_chofer" ? "app_chofer" : "manual"),
      recorded_at: v.ubicacion_ts || null,
    };
  }
  return {
    lat: null,
    lng: null,
    text: v.ubicacion_actual || "",
    source: v.ubicacion_fuente || (v.jornada_estado === "abierta" ? "app_chofer_jornada" : "sin_posicion"),
    priority: v.jornada_estado === "abierta" ? "app_chofer" : "sin_posicion",
    recorded_at: v.ubicacion_ts || v.jornada_updated_at || null,
  };
}

function scorePlanningCandidate({ pedido, vehicle, originCoord, originText, conflicts, previousTrip = null }) {
  let score = 45;
  const reasons = [];
  const warnings = [];
  const location = pickVehiclePlanningLocation(vehicle);
  const locAge = ageHours(location.recorded_at);
  const distancia_origen_km = distanceKm(location, originCoord);
  const peso = Number(pedido.peso_kg || 0);
  const cargaMax = Number(vehicle.carga_max_kg || 0);
  const estado = String(vehicle.estado || "").toLowerCase();
  const fuente = String(location.priority || "");
  const reposicionamiento = buildRepositioningPlan({ vehicle, originCoord, previousTrip, targetPedido: pedido });
  const tachograph = buildDriverHoursInfo(vehicle);

  if (estado === "disponible") { score += 18; reasons.push("Vehiculo disponible."); }
  else if (["en_ruta", "ruta", "en ruta"].includes(estado)) { score -= 14; warnings.push("Vehiculo marcado en ruta."); }
  else if (estado) { score -= 8; warnings.push(`Estado del vehiculo: ${vehicle.estado}.`); }

  if (peso > 0 && cargaMax > 0) {
    if (cargaMax >= peso) { score += 12; reasons.push("Capacidad suficiente para el peso indicado."); }
    else { score -= 30; warnings.push(`Carga maxima insuficiente (${cargaMax} kg para ${peso} kg).`); }
  } else if (peso > 0) {
    warnings.push("Vehiculo sin carga maxima informada.");
  }

  if (fuente === "gps_api") {
    score += 16;
    reasons.push(`Posicion tomada de GPS conectado (${location.source}).`);
  } else if (fuente === "app_chofer") {
    score += 10;
    reasons.push("Sin GPS API prioritario: se usa ultima posicion de la app del chofer.");
  } else if (fuente === "manual") {
    score += 3;
    warnings.push("Solo hay ubicacion manual o ultima descarga.");
  } else {
    score -= 8;
    warnings.push("Sin posicion reciente para calcular proximidad.");
  }

  if (locAge !== null) {
    if (locAge <= 2) score += 10;
    else if (locAge <= 12) score += 4;
    else {
      score -= 6;
      warnings.push(`Posicion antigua (${Math.round(locAge)} h).`);
    }
  }

  if (distancia_origen_km !== null) {
    if (distancia_origen_km <= 30) { score += 18; reasons.push("Muy cerca del punto de carga."); }
    else if (distancia_origen_km <= 120) { score += 10; reasons.push("Proximo al punto de carga."); }
    else if (distancia_origen_km <= 300) score += 2;
    else { score -= 8; warnings.push(`Lejos del origen (${Math.round(distancia_origen_km)} km).`); }
  } else {
    const locText = normalizePlanningText(location.text);
    const origin = normalizePlanningText(originText);
    if (locText && origin && (origin.includes(locText) || locText.includes(origin))) {
      score += 8;
      reasons.push("La ubicacion textual coincide con el origen.");
    } else {
      warnings.push("No hay coordenadas suficientes para calcular distancia al origen.");
    }
  }

  if (reposicionamiento.distancia_hasta_carga_km !== null && reposicionamiento.distancia_hasta_carga_km !== distancia_origen_km) {
    reasons.push(`Reposicionamiento desde ${reposicionamiento.source_label}: ${reposicionamiento.distancia_hasta_carga_km} km.`);
  }
  if (reposicionamiento.llega_antes_hora_carga === false) {
    score -= 20;
    warnings.push("La llegada estimada al punto de carga queda despues de la hora prevista.");
  }
  if (tachograph.conduccion_disponible_min !== null && reposicionamiento.tiempo_hasta_carga_min !== null && tachograph.conduccion_disponible_min < reposicionamiento.tiempo_hasta_carga_min) {
    score -= 18;
    warnings.push("Las horas de conduccion disponibles no cubren el reposicionamiento estimado.");
  }

  const vehicleConflicts = Number(conflicts?.vehiculo || 0);
  const driverConflicts = Number(conflicts?.chofer || 0);
  if (vehicleConflicts > 0) {
    score -= 22;
    warnings.push(`${vehicleConflicts} pedido(s) cercanos usan este vehiculo.`);
  }
  if (driverConflicts > 0) {
    score -= 18;
    warnings.push(`${driverConflicts} pedido(s) cercanos usan este chofer.`);
  }

  if (vehicle.jornada_estado === "abierta") {
    const actividad = String(vehicle.actividad_actual || "").replace(/_/g, " ");
    reasons.push(`Jornada de chofer abierta${actividad ? ` (${actividad})` : ""}.`);
    if (["descanso", "pausa"].includes(String(vehicle.actividad_actual || ""))) score -= 4;
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    warnings,
    distancia_origen_km: distancia_origen_km === null ? null : Number(distancia_origen_km.toFixed(1)),
    location,
    reposicionamiento,
    tachograph,
  };
}

function usuarioEsGerencia(req) {
  return String(req.user?.rol || "").toLowerCase() === "gerente";
}

async function getCfgTraficoEmpresa(empresaId) {
  if (!empresaId) return {};
  const { rows } = await db.query("SELECT cfg_trafico FROM empresas WHERE id=$1 LIMIT 1", [empresaId]);
  const cfg = rows[0]?.cfg_trafico;
  return cfg && typeof cfg === "object" ? cfg : {};
}

async function assertClienteAdmiteNuevoPedido(client, req, clienteId, importeNuevo = 0) {
  const empresaId = req.empresaId || req.user?.empresa_id;
  if (!empresaId || !clienteId) return;
  const { rows } = await client.query(`
    SELECT c.id, c.nombre,
           COALESCE(c.bloqueado,false) AS bloqueado,
           COALESCE(NULLIF(TRIM(c.bloqueo_motivo), ''), 'Sin motivo indicado') AS bloqueo_motivo,
           COALESCE(c.limite_riesgo, 0) AS limite_riesgo,
           COALESCE(f.total_facturas_pendiente, 0)::numeric AS total_facturas_pendiente,
           COALESCE(p.total_pedidos_confirmados, 0)::numeric AS total_pedidos_confirmados
      FROM clientes c
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(total), 0)::numeric AS total_facturas_pendiente
          FROM facturas f
         WHERE f.empresa_id = c.empresa_id
           AND f.cliente_id = c.id
           AND f.estado::text IN ('emitida','enviada','vencida','reclamada','sin_cobrar')
      ) f ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(
          COALESCE(
            p.importe,
            p.precio_cliente_col,
            CASE
              WHEN p.tipo_precio::text = 'viaje' THEN p.precio_unitario
              WHEN p.tipo_precio::text = 'kg' THEN (COALESCE(p.cantidad, 0) / 100.0) * COALESCE(p.precio_unitario, 0)
              ELSE GREATEST(COALESCE(p.cantidad, 0), COALESCE(p.minimo_unidades, 0)) * COALESCE(p.precio_unitario, 0)
            END,
            0
          )
        ), 0)::numeric AS total_pedidos_confirmados
          FROM pedidos p
         WHERE p.empresa_id = c.empresa_id
           AND p.cliente_id = c.id
           AND p.estado::text IN ('confirmado','en_curso','descarga','entregado')
           AND p.factura_id IS NULL
      ) p ON true
     WHERE c.id=$1 AND c.empresa_id=$2
     LIMIT 1`,
    [clienteId, empresaId]
  );
  const cliente = rows[0];
  if (!cliente) {
    const err = new Error("Cliente no encontrado");
    err.status = 404;
    throw err;
  }
  if (cliente.bloqueado) {
    const err = new Error(`Cliente bloqueado: ${cliente.bloqueo_motivo}`);
    err.status = 409;
    err.code = "CLIENTE_BLOQUEADO";
    err.cliente = cliente;
    throw err;
  }
  const limite = Number(cliente.limite_riesgo || 0) || 0;
  const pendiente = Number(cliente.total_facturas_pendiente || 0) + Number(cliente.total_pedidos_confirmados || 0);
  const proyectado = pendiente + Math.max(0, Number(importeNuevo || 0) || 0);
  if (limite > 0 && proyectado >= limite && !usuarioEsGerencia(req)) {
    const pct = Math.round((proyectado / limite) * 1000) / 10;
    const err = new Error(`Cliente en limite de riesgo: ${proyectado.toFixed(2)} EUR sobre ${limite.toFixed(2)} EUR (${pct.toFixed(1)}%). Solo gerencia puede autorizar nuevos viajes.`);
    err.status = 409;
    err.code = "CLIENTE_RIESGO_BLOQUEADO";
    err.cliente = { ...cliente, total_pendiente: pendiente, total_proyectado: proyectado, riesgo_pct_proyectado: pct };
    throw err;
  }
}

async function updateVehiculoKmFromOdometer(empresaId, vehiculoId, km) {
  const n = Number(km);
  if (!vehiculoId || !Number.isFinite(n) || n < 0) return;
  await db.query(
    `UPDATE vehiculos
        SET km_actuales = CASE
              WHEN km_actuales IS NULL OR $1 >= km_actuales THEN $1
              ELSE km_actuales
            END,
            updated_at=NOW()
      WHERE id=$2 AND empresa_id=$3`,
    [Math.round(n), vehiculoId, empresaId]
  ).catch(e => logger.warn("No se pudo actualizar km del vehiculo desde app chofer:", e.message));
}

async function aplicarKmVacioDesdePasos({ pedidoId, empresaId, patch = {}, actorId = null }) {
  const kmCarga = Number(patch.km_carga);
  if (!Number.isFinite(kmCarga) || kmCarga < 0) return null;
  const { rows: pedidoRows } = await db.query(
    `SELECT id, vehiculo_id, origen, destino, fecha_carga, fecha_pedido, km_vacio
       FROM pedidos
      WHERE id=$1 AND empresa_id=$2
      LIMIT 1`,
    [pedidoId, empresaId]
  );
  const pedido = pedidoRows[0];
  if (!pedido?.vehiculo_id) return null;

  const { rows: prevRows } = await db.query(
    `SELECT p.id, p.numero, p.destino, p.fecha_descarga, p.fecha_entrega, p.fecha_carga,
            REPLACE(s.data->>'km_descarga', ',', '.')::numeric AS km_descarga
       FROM pedido_chofer_pasos s
       JOIN pedidos p ON p.id=s.pedido_id AND p.empresa_id=s.empresa_id
      WHERE s.empresa_id=$1
        AND p.vehiculo_id=$2
        AND p.id<>$3
        AND (s.data->>'km_descarga') ~ '^[0-9]+([,.][0-9]+)?$'
        AND COALESCE(p.fecha_descarga, p.fecha_entrega, p.fecha_carga, p.fecha_pedido, p.created_at::date)
            <= COALESCE($4::date, $5::date, CURRENT_DATE)
      ORDER BY COALESCE(p.fecha_descarga, p.fecha_entrega, p.fecha_carga, p.fecha_pedido, p.created_at::date) DESC,
               s.updated_at DESC
      LIMIT 1`,
    [empresaId, pedido.vehiculo_id, pedidoId, pedido.fecha_carga, pedido.fecha_pedido]
  );
  const prev = prevRows[0];
  const kmDescarga = Number(prev?.km_descarga);
  if (!Number.isFinite(kmDescarga) || kmCarga < kmDescarga) return null;
  const kmVacio = Math.round((kmCarga - kmDescarga) * 100) / 100;
  if (kmVacio <= 0 || kmVacio > 2000) return null;

  await db.query(
    `UPDATE pedidos
        SET km_vacio=$1,
            updated_at=NOW()
      WHERE id=$2 AND empresa_id=$3 AND COALESCE(km_vacio,0)=0`,
    [kmVacio, pedidoId, empresaId]
  );
  const nota = `app_chofer:pedido:${pedidoId}`;
  await db.query(
    "DELETE FROM vehiculo_km_vacio WHERE empresa_id=$1 AND vehiculo_id=$2 AND notas=$3",
    [empresaId, pedido.vehiculo_id, nota]
  ).catch(() => {});
  await db.query(
    `INSERT INTO vehiculo_km_vacio
       (vehiculo_id,empresa_id,fecha,km_vacio,origen,destino,motivo,notas,created_by)
     VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7,$8,$9)`,
    [
      pedido.vehiculo_id,
      empresaId,
      pedido.fecha_carga || null,
      kmVacio,
      prev.destino || "Descarga anterior",
      pedido.origen || "Carga siguiente",
      "Entre descarga y siguiente carga",
      nota,
      actorId,
    ]
  ).catch(e => logger.warn("No se pudo registrar km en vacio desde app chofer:", e.message));
  await logPedidoEvento(pedidoId, empresaId, "km_vacio.calculado_app_chofer", {
    km_vacio: kmVacio,
    km_carga: kmCarga,
    pedido_descarga_anterior_id: prev.id,
    km_descarga_anterior: kmDescarga,
  }, "sistema");
  return kmVacio;
}

function normalizeColaboradorPagoPayload(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    colaborador_id: source.colaborador_id || null,
    factura_nombre: source.factura_nombre ? String(source.factura_nombre).slice(0, 255) : null,
    factura_data: source.factura_data ? String(source.factura_data) : null,
    fecha_recepcion: normalizePedidoDate(source.fecha_recepcion),
    fecha_pago_calculada: normalizePedidoDate(source.fecha_pago_calculada),
    fecha_pago_real: normalizePedidoDate(source.fecha_pago_real),
    importe: parseLocaleNumber(source.importe) ?? 0,
    pagado: Boolean(source.pagado),
    documentacion_recibida: Boolean(source.documentacion_recibida),
    fecha_documentacion_recepcion: normalizePedidoDate(source.fecha_documentacion_recepcion),
    notas_pago: source.notas_pago ? String(source.notas_pago).slice(0, 2000) : null,
  };
}

async function getPedidoChoferPasos(pedidoId, empresaId) {
  await ensureColaboradorWorkflowSchema();
  const { rows } = await db.query(
    `SELECT data, chofer_id, updated_at
       FROM pedido_chofer_pasos
      WHERE pedido_id=$1 AND empresa_id=$2
      LIMIT 1`,
    [pedidoId, empresaId]
  ).catch(() => ({ rows: [] }));
  const row = rows[0];
  return {
    chofer_id: row?.chofer_id || null,
    updated_at: row?.updated_at || null,
    data: normalizeChoferPasosPayload(row?.data || {}),
  };
}

async function savePedidoChoferPasos({
  pedidoId,
  empresaId,
  choferId = null,
  patch = {},
  actorTipo = "sistema",
  actorId = null,
}) {
  await ensureColaboradorWorkflowSchema();
  const current = await getPedidoChoferPasos(pedidoId, empresaId);
  const nextData = {
    ...current.data,
    ...normalizeChoferPasosPayload(patch),
    updated_at: new Date().toISOString(),
  };
  await db.query(
    `INSERT INTO pedido_chofer_pasos (pedido_id, empresa_id, chofer_id, data, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (pedido_id) DO UPDATE
       SET chofer_id = COALESCE(EXCLUDED.chofer_id, pedido_chofer_pasos.chofer_id),
           data = EXCLUDED.data,
           updated_at = NOW()`,
    [pedidoId, empresaId, choferId || current.chofer_id || null, JSON.stringify(nextData)]
  );
  await logPedidoEvento(
    pedidoId,
    empresaId,
    "chofer_pasos.actualizado",
    { pasos: nextData },
    actorTipo,
    actorId
  );
  const pedidoMeta = await db.query(
    "SELECT id, numero, origen, destino, origen_pais, destino_pais, estado::text AS estado, chofer_id, fecha_carga, hora_carga, fecha_descarga, fecha_entrega, hora_descarga FROM pedidos WHERE id=$1 AND empresa_id=$2 LIMIT 1",
    [pedidoId, empresaId]
  ).catch(() => ({ rows: [] }));
  const pedido = pedidoMeta.rows[0] || {};
  async function sincronizarPedidoYChoferDesdePasos() {
    const updates = [];
    const params = [];
    const addUpdate = (sql, value) => {
      params.push(value);
      updates.push(`${sql}=$${params.length}`);
    };
    let nextEstado = null;
    if (patch.descarga_ok || nextData.descarga_ok) nextEstado = "entregado";
    else if (patch.descarga_iniciada || nextData.descarga_iniciada) nextEstado = "descarga";
    else if (patch.posicionado_descarga || patch.aviso_espera_descarga || nextData.posicionado_descarga || nextData.aviso_espera_descarga) nextEstado = "espera_descarga";
    else if (patch.viaje_iniciado || patch.carga_ok || nextData.viaje_iniciado || nextData.carga_ok) nextEstado = "en_curso";
    else if (patch.carga_iniciada || nextData.carga_iniciada) nextEstado = "cargando";
    else if (patch.aviso_espera_carga || nextData.aviso_espera_carga) nextEstado = "espera_carga";
    if (nextEstado && !["cancelado", "entregado"].includes(String(pedido.estado || "").toLowerCase())) {
      await assertUnicoViajeActivoChofer({ pedido, empresaId, estadoDestino: nextEstado });
      addUpdate("estado", nextEstado);
    }
    if (patch.mercancia_confirmada || nextData.mercancia_confirmada) {
      const mercanciaReal = nextData.mercancia_cargada || nextData.mercancia || null;
      const bultosReal = nextData.mercancia_palets || nextData.bultos || null;
      const pesoReal = parseLocaleNumber(nextData.mercancia_peso_kg || nextData.peso_kg);
      const referenciaReal = nextData.mercancia_referencia || nextData.referencia_cliente || null;
      if (mercanciaReal) addUpdate("mercancia", mercanciaReal);
      if (bultosReal) addUpdate("bultos", bultosReal);
      if (Number.isFinite(pesoReal) && pesoReal > 0) addUpdate("peso_kg", pesoReal);
      if (referenciaReal) addUpdate("referencia_cliente", referenciaReal);
    }

    const cargaPlan = buildLocalDateTime(pedido.fecha_carga, pedido.hora_carga || "00:00");
    const descargaPlan = buildLocalDateTime(pedido.fecha_descarga || pedido.fecha_entrega, pedido.hora_descarga || "00:00");
    const cargaReal = nextData.carga_iniciada_at ? new Date(nextData.carga_iniciada_at) : null;
    const referenciaRetraso = cargaReal && Number.isFinite(cargaReal.getTime()) ? cargaReal : new Date();
    const debeEvaluarRetraso = cargaPlan && descargaPlan && (
      patch.carga_iniciada || patch.carga_ok || patch.viaje_iniciado || patch.posicionado_descarga || patch.descarga_iniciada || patch.descarga_ok || !nextData.carga_iniciada
    );
    const retrasoMin = debeEvaluarRetraso ? minutosEntreIso(cargaPlan.toISOString(), referenciaRetraso.toISOString()) : 0;
    if (retrasoMin > 5) {
      const nuevaDescarga = splitPedidoDateTime(addMinutesDate(descargaPlan, retrasoMin));
      if (nuevaDescarga.fecha) {
        if (pedido.fecha_descarga) addUpdate("fecha_descarga", nuevaDescarga.fecha);
        else addUpdate("fecha_entrega", nuevaDescarga.fecha);
      }
      if (nuevaDescarga.hora) addUpdate("hora_descarga", nuevaDescarga.hora);
    }

    if (updates.length) {
      params.push(pedidoId, empresaId);
      await db.query(
        `UPDATE pedidos SET ${updates.join(", ")}, updated_at=NOW() WHERE id=$${params.length - 1} AND empresa_id=$${params.length}`,
        params
      ).catch(e => logger.warn("No se pudo sincronizar pedido desde pasos de chofer:", e.message));
      await logPedidoEvento(pedidoId, empresaId, "pedido.sincronizado_app_chofer", {
        estado: nextEstado,
        retraso_min: retrasoMin > 5 ? retrasoMin : 0,
      }, actorTipo, actorId);
      if (nextEstado === "entregado") {
        await aplicarAutomatismosEntrega(pedidoId, empresaId, actorId || null, {}).catch(e => logger.warn("No se pudo aplicar automatismo de entrega desde app chofer:", e.message));
      }
    }

    const choferTarget = choferId || pedido.chofer_id || current.chofer_id || null;
    if (choferTarget) {
      let estadoChofer = null;
      if (patch.descarga_ok || nextData.descarga_ok) estadoChofer = "disponible";
      else if (patch.descarga_iniciada || patch.posicionado_descarga || nextData.descarga_iniciada || nextData.posicionado_descarga) estadoChofer = "descargando";
      else if (patch.viaje_iniciado || patch.carga_ok || nextData.viaje_iniciado || nextData.carga_ok) estadoChofer = "en_ruta";
      else if (patch.carga_iniciada || patch.carga_proceso || nextData.carga_iniciada || nextData.carga_proceso) estadoChofer = "carga";
      if (estadoChofer) {
        await db.query(
          "UPDATE choferes SET estado=$1 WHERE id=$2 AND empresa_id=$3 AND COALESCE(estado,'disponible') NOT IN ('baja','vacaciones','ausencia')",
          [estadoChofer, choferTarget, empresaId]
        ).catch(e => logger.warn("No se pudo actualizar estado del chofer desde app:", e.message));
      }
    }
  }
  await sincronizarPedidoYChoferDesdePasos();
  async function avisarParalizacion(fase, titulo, mins, dedupeSuffix) {
    if (!mins || mins <= 60) return;
    const paisOperacion = inferPaisOperacionPedido(pedido, fase);
    const calculo = calcularParalizacion({ minutos: mins, pais: paisOperacion, fase });
    const descripcion = `${titulo}: ${mins} minutos en ${fase}. ${calculo.reclamable ? `Importe orientativo reclamable: ${calculo.importe.toLocaleString("es-ES", { minimumFractionDigits: 2 })} ${calculo.moneda}.` : "Revisar pacto/condiciones antes de reclamar."}`;
    await db.query(
      `UPDATE pedidos
          SET estado='incidencia',
              incidencia_tipo='paralizacion',
              incidencia_descripcion=$3,
              incidencia_origen='auto',
              incidencia_creada_por=$4,
              incidencia_creada_at=COALESCE(incidencia_creada_at, NOW()),
              incidencia_automatica=true,
              paralizacion_minutos=GREATEST(COALESCE(paralizacion_minutos,0), $5),
              paralizacion_importe=$6,
              paralizacion_moneda=$7,
              paralizacion_norma=$8,
              paralizacion_pais=$9,
              notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(notas,''), $10))
        WHERE id=$1 AND empresa_id=$2`,
      [
        pedidoId,
        empresaId,
        descripcion,
        actorId || null,
        calculo.minutos,
        calculo.importe,
        calculo.moneda,
        calculo.norma,
        calculo.pais,
        `INCIDENCIA AUTO: ${descripcion}`,
      ]
    ).catch(e => logger.warn("No se pudo registrar incidencia automatica de paralizacion:", e.message));
    await notificarGestionPedido(
      empresaId,
      "chofer_paralizacion",
      titulo,
      `El pedido ${pedido.numero || ""} lleva ${mins} minutos en ${fase}. ${calculo.reclamable ? `Posible reclamacion: ${calculo.importe.toLocaleString("es-ES", { minimumFractionDigits: 2 })} ${calculo.moneda}.` : "Revisar condiciones de paralizacion."}`,
      {
        pedido_id: pedidoId,
        fase,
        minutos: mins,
        paralizacion: calculo,
        ruta: `${pedido.origen || ""} -> ${pedido.destino || ""}`,
        dedupe_key: `paralizacion:${fase}:${pedidoId}:${dedupeSuffix}`,
      },
      actorId
    );
  }
  if ((patch.aviso_espera_carga || patch.carga_proceso) && nextData.carga_iniciada_at) {
    const mins = minutosEntreIso(nextData.carga_iniciada_at, nextData.carga_proceso_at || new Date().toISOString());
    await avisarParalizacion("espera de carga", "Espera de carga superior a 60 minutos", mins, "espera");
  }
  if (patch.carga_ok && nextData.carga_iniciada_at && nextData.carga_ok_at) {
    const mins = minutosEntreIso(nextData.carga_iniciada_at, nextData.carga_ok_at);
    await avisarParalizacion("carga completa", "Paralizacion de carga superior a 60 minutos", mins, "total");
  }
  if (patch.carga_ok && nextData.carga_proceso_at && nextData.carga_ok_at) {
    const mins = minutosEntreIso(nextData.carga_proceso_at, nextData.carga_ok_at);
    await avisarParalizacion("operacion de carga", "Carga superior a 60 minutos", mins, "operacion");
  }
  if ((patch.aviso_espera_descarga || patch.descarga_iniciada) && nextData.posicionado_descarga_at) {
    const mins = minutosEntreIso(nextData.posicionado_descarga_at, nextData.descarga_iniciada_at || new Date().toISOString());
    await avisarParalizacion("espera de descarga", "Espera de descarga superior a 60 minutos", mins, "espera");
  }
  if (patch.descarga_ok && nextData.descarga_iniciada_at && nextData.descarga_ok_at) {
    const mins = minutosEntreIso(nextData.descarga_iniciada_at, nextData.descarga_ok_at);
    await avisarParalizacion("operacion de descarga", "Descarga superior a 60 minutos", mins, "operacion");
  }
  if (patch.descarga_ok && nextData.posicionado_descarga_at && nextData.descarga_ok_at) {
    const mins = minutosEntreIso(nextData.posicionado_descarga_at, nextData.descarga_ok_at);
    await avisarParalizacion("descarga completa", "Paralizacion de descarga superior a 60 minutos", mins, "total");
  }
  const { rows: pedidoRows } = await db.query(
    "SELECT vehiculo_id FROM pedidos WHERE id=$1 AND empresa_id=$2 LIMIT 1",
    [pedidoId, empresaId]
  ).catch(() => ({ rows: [] }));
  const vehiculoId = pedidoRows[0]?.vehiculo_id || null;
  await updateVehiculoKmFromOdometer(empresaId, vehiculoId, patch.km_descarga ?? patch.km_carga);
  if (patch.km_carga !== undefined) {
    await aplicarKmVacioDesdePasos({ pedidoId, empresaId, patch: nextData, actorId }).catch(e => logger.warn("No se pudo calcular km en vacio desde pasos:", e.message));
  }
  if (patch.carga_iniciada && patch.carga_ubicacion) {
    await guardarUbicacionCargaDesdeChofer({ pedidoId, empresaId, location: patch.carga_ubicacion, actorId })
      .catch(e => logger.warn("No se pudo guardar ubicacion de carga desde app chofer:", e.message));
  }
  return nextData;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function isoDate(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function calcularFechaPagoColaborador(fechaRecepcion, perfil = {}) {
  const baseInput = normalizePedidoDate(fechaRecepcion);
  if (!baseInput) return null;
  const plazo = Number(perfil.plazo_pago_colaboradores || 60);
  const forma = String(perfil.forma_pago_colaboradores || "dias_fijos");
  const dias = String(perfil.dias_pago_colaboradores || "15")
    .split(",")
    .map(d => Number.parseInt(d.trim(), 10))
    .filter(d => Number.isFinite(d) && d >= 1 && d <= 31)
    .sort((a, b) => a - b);
  const base = addDays(`${baseInput}T00:00:00`, plazo);
  if (forma === "transferencia_inmediata") return isoDate(base);
  if (forma === "fin_mes") return isoDate(new Date(base.getFullYear(), base.getMonth() + 1, 0));
  const paymentDays = dias.length ? dias : [15];
  const nextDay = paymentDays.find(d => d >= base.getDate());
  return isoDate(nextDay
    ? new Date(base.getFullYear(), base.getMonth(), nextDay)
    : new Date(base.getFullYear(), base.getMonth() + 1, paymentDays[0]));
}

async function getEmpresaPerfilPagos(empresaId) {
  const { rows } = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1", [empresaId]);
  const cfg = rows[0]?.cfg_precios || {};
  return cfg?.empresa_perfil && typeof cfg.empresa_perfil === "object" ? cfg.empresa_perfil : cfg;
}

async function getPedidoDocumentoControlContext(pedidoId, empresaId) {
  const { rows } = await queryWithColaboradorFallback(`
    SELECT p.*,
           c.id AS cliente_ref_id, c.nombre AS cliente_nombre, c.cif AS cliente_cif, c.direccion AS cliente_direccion, c.cp AS cliente_cp, COALESCE(c.municipio, c.ciudad) AS cliente_ciudad, c.provincia AS cliente_provincia, c.pais AS cliente_pais,
           c.email AS cliente_email, c.email_facturacion AS cliente_email_facturacion, c.emails_albaranes AS cliente_emails_albaranes, c.telefono AS cliente_telefono, c.contacto AS cliente_contacto,
           ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos, ch.dni AS chofer_dni, ch.telefono AS chofer_telefono, ch.email AS chofer_email,
           ch.firma_base AS chofer_firma_base, ch.firma_base_nombre AS chofer_firma_base_nombre, ch.firma_base_fecha AS chofer_firma_base_fecha,
           v.matricula AS veh_matricula, r.matricula AS rem_matricula,
           co.id AS colaborador_ref_id, co.nombre AS colaborador_nombre, co.cif AS colaborador_cif, co.email AS colaborador_email, co.telefono AS colaborador_telefono, co.contacto_nombre AS colaborador_contacto,
           TRIM(BOTH ' ' FROM CONCAT_WS(' ', co.calle, co.num_ext)) AS colaborador_direccion, co.codigo_postal AS colaborador_cp, co.ciudad AS colaborador_ciudad, co.provincia AS colaborador_provincia, co.pais AS colaborador_pais
    FROM pedidos p
    LEFT JOIN clientes c ON c.id=p.cliente_id
    LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
    LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
    LEFT JOIN vehiculos r ON r.id=COALESCE(p.remolque_id, v.remolque_id) AND r.empresa_id=p.empresa_id
    LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
    WHERE p.id=$1 AND p.empresa_id=$2
  `, `
    SELECT p.*,
           c.id AS cliente_ref_id, c.nombre AS cliente_nombre, c.cif AS cliente_cif, c.direccion AS cliente_direccion, c.cp AS cliente_cp, COALESCE(c.municipio, c.ciudad) AS cliente_ciudad, c.provincia AS cliente_provincia, c.pais AS cliente_pais,
           c.email AS cliente_email, c.email_facturacion AS cliente_email_facturacion, c.emails_albaranes AS cliente_emails_albaranes, c.telefono AS cliente_telefono, c.contacto AS cliente_contacto,
           ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos, ch.dni AS chofer_dni, ch.telefono AS chofer_telefono, ch.email AS chofer_email,
           ch.firma_base AS chofer_firma_base, ch.firma_base_nombre AS chofer_firma_base_nombre, ch.firma_base_fecha AS chofer_firma_base_fecha,
           v.matricula AS veh_matricula, r.matricula AS rem_matricula,
           NULL AS colaborador_ref_id, NULL AS colaborador_nombre, NULL AS colaborador_cif, NULL AS colaborador_email, NULL AS colaborador_telefono, NULL AS colaborador_contacto, NULL AS colaborador_direccion, NULL AS colaborador_cp, NULL AS colaborador_ciudad, NULL AS colaborador_provincia, NULL AS colaborador_pais
    FROM pedidos p
    LEFT JOIN clientes c ON c.id=p.cliente_id
    LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
    LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
    LEFT JOIN vehiculos r ON r.id=COALESCE(p.remolque_id, v.remolque_id) AND r.empresa_id=p.empresa_id
    WHERE p.id=$1 AND p.empresa_id=$2
  `, [pedidoId, empresaId]);
  const pedido = rows[0];
  if (!pedido) return null;
  const ordenCarga = await ensurePedidoOrdenCargaNumero(pedido.id, empresaId).catch((error) => {
    logger.warn("No se pudo asegurar la numeracion de orden de carga:", error.message);
    return null;
  });
  if (ordenCarga?.numero) {
    pedido.orden_carga_numero = ordenCarga.numero;
    pedido.orden_carga_generada_at = ordenCarga.generated_at || pedido.orden_carga_generada_at || null;
  }
  const empresaRes = await db.query("SELECT * FROM empresas WHERE id=$1 LIMIT 1", [empresaId]);
  const empresaRow = empresaRes.rows[0] || {};
  const perfil = empresaRow?.cfg_precios?.empresa_perfil || empresaRow?.cfg_precios || {};
  const logoMime = empresaRow?.cfg_precios?.logo_mime || perfil?.logo_mime || "image/png";
  const empresa = {
    ...(perfil || {}),
    ...(empresaRow || {}),
    nombre: empresaRow.razon_social || empresaRow.nombre || perfil?.razon_social || perfil?.nombre || "",
    razon_social: empresaRow.razon_social || perfil?.razon_social || empresaRow.nombre || perfil?.nombre || "",
    cif: empresaRow.cif || empresaRow.nif || perfil?.cif || perfil?.nif || "",
    nif: empresaRow.nif || empresaRow.cif || perfil?.nif || perfil?.cif || "",
    domicilio: empresaRow.domicilio || empresaRow.direccion || perfil?.domicilio || perfil?.direccion || "",
    direccion: empresaRow.direccion || empresaRow.domicilio || perfil?.direccion || perfil?.domicilio || "",
    cp: empresaRow.cp || empresaRow.codigo_postal || perfil?.cp || perfil?.codigo_postal || "",
    codigo_postal: empresaRow.codigo_postal || empresaRow.cp || perfil?.codigo_postal || perfil?.cp || "",
    municipio: empresaRow.municipio || empresaRow.ciudad || perfil?.municipio || perfil?.ciudad || "",
    ciudad: empresaRow.ciudad || empresaRow.municipio || perfil?.ciudad || perfil?.municipio || "",
    provincia: empresaRow.provincia || perfil?.provincia || "",
    pais: empresaRow.pais || perfil?.pais || "España",
    telefono: empresaRow.telefono || perfil?.telefono || "",
    email: empresaRow.email_facturacion || empresaRow.email_admin || empresaRow.email || perfil?.email || "",
    email_admin: empresaRow.email_admin || perfil?.email_admin || "",
    contacto: empresaRow.contacto || perfil?.contacto || "",
    logo_base64: empresaRow.logo_base64 || perfil?.logo_base64 || "",
    logo_mime: logoMime,
  };
  return {
    pedido,
    empresa,
    cliente: {
      id: pedido.cliente_ref_id,
      nombre: pedido.cliente_nombre,
      cif: pedido.cliente_cif,
      direccion: pedido.cliente_direccion,
      cp: pedido.cliente_cp,
      poblacion: pedido.cliente_ciudad,
      provincia: pedido.cliente_provincia,
      pais: pedido.cliente_pais,
      email: pedido.cliente_email,
      email_facturacion: pedido.cliente_email_facturacion,
      emails_albaranes: pedido.cliente_emails_albaranes,
      telefono: pedido.cliente_telefono,
      contacto: pedido.cliente_contacto,
    },
    colaborador: {
      id: pedido.colaborador_ref_id,
      nombre: pedido.colaborador_nombre,
      cif: pedido.colaborador_cif,
      email: pedido.colaborador_email,
      telefono: pedido.colaborador_telefono,
      contacto: pedido.colaborador_contacto,
      direccion: pedido.colaborador_direccion,
      cp: pedido.colaborador_cp,
      poblacion: pedido.colaborador_ciudad,
      provincia: pedido.colaborador_provincia,
      pais: pedido.colaborador_pais,
    },
  };
}

async function getPedidoDocumentoControlExpedienteData(pedidoId, empresaId) {
  const [docsRes, eventosRes] = await Promise.all([
    db.query(`
      SELECT id, nombre, tipo, file_mime, file_size_kb, notas, metadata, created_at,
             CASE
               WHEN file_mime ILIKE 'image/%' THEN file_base64
               ELSE NULL
             END AS file_base64,
             CASE
               WHEN file_mime ILIKE 'application/pdf%' THEN true
               ELSE false
             END AS es_pdf
        FROM pedido_docs
       WHERE pedido_id=$1 AND empresa_id=$2
         AND (
           LOWER(COALESCE(tipo,'')) LIKE '%albaran%'
           OR LOWER(COALESCE(nombre,'')) LIKE '%albaran%'
           OR LOWER(COALESCE(tipo,'')) LIKE '%pod%'
           OR LOWER(COALESCE(nombre,'')) LIKE '%pod%'
           OR LOWER(COALESCE(tipo,'')) LIKE '%cmr%'
           OR LOWER(COALESCE(nombre,'')) LIKE '%cmr%'
         )
       ORDER BY created_at DESC
       LIMIT 80
    `, [pedidoId, empresaId]).catch(() => ({ rows: [] })),
    db.query(`
      SELECT tipo, actor_tipo, detalle, created_at
        FROM pedido_eventos
       WHERE pedido_id=$1
         AND empresa_id=$2
         AND (
           tipo LIKE 'documento_control.%'
           OR tipo LIKE 'firma.%'
           OR tipo LIKE 'colaborador.%'
           OR tipo IN ('pedido.entregado', 'pedido.estado_cambiado')
         )
       ORDER BY created_at DESC
       LIMIT 80
    `, [pedidoId, empresaId]).catch(() => ({ rows: [] })),
  ]);
  return {
    documentos: docsRes.rows || [],
    eventos: eventosRes.rows || [],
  };
}

function anexosDocumentoControl(documentos = []) {
  return (Array.isArray(documentos) ? documentos : []).map(doc => ({
    id: doc.id || null,
    nombre: doc.nombre || "Documento adjunto",
    tipo: doc.tipo || "",
    mime: doc.file_mime || "",
    size_kb: doc.file_size_kb || null,
    created_at: doc.created_at || null,
    firmado: Boolean(doc.metadata?.firmado || doc.metadata?.scanner || doc.metadata?.fase || String(doc.tipo || "").toLowerCase().includes("albaran")),
    etiqueta: String(doc.tipo || doc.nombre || "").toLowerCase().includes("descarga") ? "Albaran/POD descarga" :
      String(doc.tipo || doc.nombre || "").toLowerCase().includes("carga") ? "Albaran carga" :
      String(doc.tipo || doc.nombre || "").toLowerCase().includes("cmr") ? "CMR adjunto" :
      "Albaran/POD adjunto",
    pdf_adjunto: Boolean(doc.es_pdf || String(doc.file_mime || "").toLowerCase().includes("pdf")),
    data_url: doc.file_base64 && String(doc.file_mime || "").startsWith("image/")
      ? `data:${doc.file_mime};base64,${doc.file_base64}`
      : "",
  })).slice(0, 20);
}

function attachDocumentoControlAnexos(payload, documentos = []) {
  if (payload?.documento) {
    payload.documento.documentos_anexos = anexosDocumentoControl(documentos);
  }
  return payload;
}

async function getPedidoDocumentoControlAnexos(pedidoId, empresaId) {
  const expedienteData = await getPedidoDocumentoControlExpedienteData(pedidoId, empresaId);
  return anexosDocumentoControl(expedienteData.documentos);
}

async function buildPedidoDocumentoControlResponse(req, ctx, empresaId) {
  const payload = buildDocumentoControlPayload({
    empresaId,
    pedido: ctx.pedido,
    empresa: ctx.empresa,
    cliente: ctx.cliente,
    colaborador: ctx.colaborador,
    appBaseUrl: publicBaseUrl(req),
  });
  const expedienteData = await getPedidoDocumentoControlExpedienteData(ctx.pedido.id, empresaId);
  attachDocumentoControlAnexos(payload, expedienteData.documentos);
  const postSignatureIntegrity = buildFirmaPostSignatureIntegrity(ctx.pedido, ctx.pedido?.firma_evidencia || null);
  const repositorio = await getDocumentoControlRepositorioByPedido(ctx.pedido.id, empresaId).catch(() => null);
  const regulatoryCore = await getPedidoRegulatoryCoreSummary(ctx.pedido.id, empresaId).catch(() => null);
  const qrDataUrl = await buildDocumentoControlQrDataUrl(payload.documento).catch(() => "");
  return {
    ...payload,
    qr: {
      url: payload.documento?.qr_url || payload.documento?.soporte_url || "",
      data_url: qrDataUrl,
      label: "QR de verificacion DCD",
    },
    repositorio: repositorio ? {
      id: repositorio.id,
      estado: repositorio.estado,
      activo: repositorio.activo,
      archivado_at: repositorio.archivado_at,
      retencion_minima_hasta: repositorio.retencion_minima_hasta,
      retencion_politica: repositorio.retencion_politica,
      payload_hash_sha256: repositorio.payload_hash_sha256,
      html_hash_sha256: repositorio.html_hash_sha256,
      pdf_hash_sha256: repositorio.pdf_hash_sha256,
      public_activo: repositorio.public_activo,
      public_expires_at: repositorio.public_expires_at,
      filename: repositorio.pdf_filename || repositorio.filename,
      download_url: `/api/v1/pedidos/documento-control-repositorio/${encodeURIComponent(repositorio.id)}/descargar`,
      export_url: `/api/v1/pedidos/documento-control-repositorio/${encodeURIComponent(repositorio.id)}/export`,
    } : null,
    expediente: buildDocumentoControlExpediente(payload, {
      ...expedienteData,
      firma: {
        firma_fecha: ctx.pedido?.firma_fecha || null,
        firma_nombre: ctx.pedido?.firma_nombre || "",
        firma_hash: ctx.pedido?.firma_hash || "",
        firma_evidencia: ctx.pedido?.firma_evidencia || null,
      },
      postSignatureIntegrity,
    }),
    regulatory_core: regulatoryCore,
  };
}

async function ensureDocumentoControlRepositorioSchema() {
  if (!documentoControlRepositorioSchemaPromise) {
    documentoControlRepositorioSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS documento_control_repositorio (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          codigo_control VARCHAR(80) NOT NULL,
          pedido_numero VARCHAR(80),
          cliente_nombre VARCHAR(200),
          estado VARCHAR(30) NOT NULL DEFAULT 'activo',
          activo BOOLEAN NOT NULL DEFAULT true,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          expediente JSONB NOT NULL DEFAULT '{}'::jsonb,
          export_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          html TEXT NOT NULL,
          filename VARCHAR(240) NOT NULL,
          pdf_base64 TEXT,
          pdf_mime VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
          pdf_filename VARCHAR(240),
          pdf_hash_sha256 VARCHAR(64),
          public_activo BOOLEAN NOT NULL DEFAULT true,
          public_expires_at TIMESTAMPTZ,
          public_desactivado_at TIMESTAMPTZ,
          public_desactivado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          created_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          export_filename VARCHAR(240) NOT NULL,
          payload_hash_sha256 VARCHAR(64) NOT NULL,
          html_hash_sha256 VARCHAR(64) NOT NULL,
          archivado_at TIMESTAMPTZ,
          archivado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          retencion_minima_hasta DATE,
          retencion_politica VARCHAR(80) NOT NULL DEFAULT 'indefinida_empresa',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (empresa_id, pedido_id)
        )
      `);
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS expediente JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS export_json JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS export_filename VARCHAR(240) NOT NULL DEFAULT 'dcd-export.json'").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS retencion_politica VARCHAR(80) NOT NULL DEFAULT 'indefinida_empresa'").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS pdf_base64 TEXT").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS pdf_mime VARCHAR(80) NOT NULL DEFAULT 'application/pdf'").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS pdf_filename VARCHAR(240)").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS pdf_hash_sha256 VARCHAR(64)").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS public_activo BOOLEAN NOT NULL DEFAULT true").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS public_expires_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS public_desactivado_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS public_desactivado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS created_metadata JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
      await db.query("ALTER TABLE documento_control_repositorio ADD COLUMN IF NOT EXISTS updated_metadata JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
      await db.query(`
        CREATE TABLE IF NOT EXISTS documento_control_repositorio_historial (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          repo_id UUID NOT NULL REFERENCES documento_control_repositorio(id) ON DELETE CASCADE,
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          action VARCHAR(80) NOT NULL DEFAULT 'snapshot',
          payload_hash_sha256 VARCHAR(64),
          html_hash_sha256 VARCHAR(64),
          pdf_hash_sha256 VARCHAR(64),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (repo_id, version)
        )
      `).catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_dcd_repo_empresa_estado ON documento_control_repositorio(empresa_id, estado, updated_at DESC)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_dcd_repo_empresa_codigo ON documento_control_repositorio(empresa_id, codigo_control)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_dcd_repo_public_expires ON documento_control_repositorio(empresa_id, public_activo, public_expires_at)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_dcd_repo_historial_repo ON documento_control_repositorio_historial(repo_id, version DESC)").catch(() => {});
    })().catch((error) => {
      documentoControlRepositorioSchemaPromise = null;
      throw error;
    });
  }
  await documentoControlRepositorioSchemaPromise;
}

async function getDocumentoControlRepositorioByPedido(pedidoId, empresaId) {
  await ensureDocumentoControlRepositorioSchema();
  const { rows } = await db.query(
    `SELECT *
       FROM documento_control_repositorio
      WHERE pedido_id=$1 AND empresa_id=$2
      LIMIT 1`,
    [pedidoId, empresaId]
  );
  return rows[0] || null;
}

function buildDocumentoControlPublicExpiresAt(pedido = {}) {
  const candidates = [
    pedido?.fecha_descarga,
    pedido?.fecha_entrega,
    pedido?.fecha_carga,
    pedido?.fecha_servicio,
  ].filter(Boolean);
  const nowPlus7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const dateCandidates = candidates
    .map(value => new Date(String(value).includes("T") ? value : `${value}T23:59:59`))
    .filter(date => !Number.isNaN(date.getTime()))
    .map(date => new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000));
  return dateCandidates.reduce((max, date) => (date > max ? date : max), nowPlus7);
}

async function insertDocumentoControlRepoHistory(repo = {}, metadata = {}, userId = null, action = "snapshot") {
  if (!repo?.id) return null;
  await ensureDocumentoControlRepositorioSchema();
  const { rows } = await db.query(`
    WITH next_version AS (
      SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM documento_control_repositorio_historial
       WHERE repo_id=$1
    )
    INSERT INTO documento_control_repositorio_historial
      (repo_id,empresa_id,pedido_id,version,action,payload_hash_sha256,html_hash_sha256,pdf_hash_sha256,metadata,created_by)
    SELECT $1,$2,$3,version,$4,$5,$6,$7,$8::jsonb,$9
      FROM next_version
    RETURNING id, version
  `, [
    repo.id,
    repo.empresa_id,
    repo.pedido_id,
    action,
    repo.payload_hash_sha256 || null,
    repo.html_hash_sha256 || null,
    repo.pdf_hash_sha256 || null,
    JSON.stringify(metadata || {}),
    userId || null,
  ]);
  return rows[0] || null;
}

async function archivarDocumentoControlPedido({ pedidoId, empresaId, appBaseUrl = "", userId = null, motivo = "viaje_finalizado" }) {
  await ensureDocumentoControlRepositorioSchema();
  const ctx = await getPedidoDocumentoControlContext(pedidoId, empresaId);
  if (!ctx?.pedido) return null;
  const payload = buildDocumentoControlPayload({
    empresaId,
    pedido: ctx.pedido,
    empresa: ctx.empresa,
    cliente: ctx.cliente,
    colaborador: ctx.colaborador,
    appBaseUrl,
  });
  const expedienteData = await getPedidoDocumentoControlExpedienteData(ctx.pedido.id, empresaId);
  attachDocumentoControlAnexos(payload, expedienteData.documentos);
  const postSignatureIntegrity = buildFirmaPostSignatureIntegrity(ctx.pedido, ctx.pedido?.firma_evidencia || null);
  const expediente = buildDocumentoControlExpediente(payload, {
    ...expedienteData,
    firma: {
      firma_fecha: ctx.pedido?.firma_fecha || null,
      firma_nombre: ctx.pedido?.firma_nombre || "",
      firma_hash: ctx.pedido?.firma_hash || "",
      firma_evidencia: ctx.pedido?.firma_evidencia || null,
    },
    postSignatureIntegrity,
  });
  const exportData = buildDocumentoControlStructuredExport(payload);
  const html = await buildDocumentoControlHtml({
    documento: payload.documento,
    empresaNombre: ctx.empresa?.razon_social || ctx.empresa?.nombre || "TransGest TMS",
    generatedAt: new Date().toISOString(),
    autoPrint: false,
  });
  const generatedAt = new Date().toISOString();
  const pdf = await generateDocumentoControlPdf({
    documento: payload.documento,
    empresaNombre: ctx.empresa?.razon_social || ctx.empresa?.nombre || "TransGest TMS",
    generatedAt,
  });
  const payloadHash = sha256Hex(stableJson({ payload, expediente, exportData }));
  const htmlHash = sha256Hex(html);
  const filename = buildDocumentoControlFilename(payload.documento);
  const exportFilename = buildDocumentoControlExportFilename(payload.documento);
  const publicExpiresAt = buildDocumentoControlPublicExpiresAt(ctx.pedido);
  const { rows } = await db.query(`
    INSERT INTO documento_control_repositorio
      (empresa_id,pedido_id,codigo_control,pedido_numero,cliente_nombre,estado,activo,payload,expediente,export_json,html,filename,pdf_base64,pdf_mime,pdf_filename,pdf_hash_sha256,public_activo,public_expires_at,created_metadata,updated_metadata,export_filename,payload_hash_sha256,html_hash_sha256,archivado_at,archivado_por,retencion_minima_hasta,retencion_politica)
    VALUES
      ($1,$2,$3,$4,$5,'archivado',false,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,true,$15,$16::jsonb,$16::jsonb,$17,$18,$19,NOW(),$20,(CURRENT_DATE + INTERVAL '1 year')::date,'minimo_1_ano')
    ON CONFLICT (empresa_id,pedido_id)
    DO UPDATE SET
      codigo_control=EXCLUDED.codigo_control,
      pedido_numero=EXCLUDED.pedido_numero,
      cliente_nombre=EXCLUDED.cliente_nombre,
      estado='archivado',
      activo=false,
      payload=EXCLUDED.payload,
      expediente=EXCLUDED.expediente,
      export_json=EXCLUDED.export_json,
      html=EXCLUDED.html,
      filename=EXCLUDED.filename,
      pdf_base64=EXCLUDED.pdf_base64,
      pdf_mime=EXCLUDED.pdf_mime,
      pdf_filename=EXCLUDED.pdf_filename,
      pdf_hash_sha256=EXCLUDED.pdf_hash_sha256,
      public_activo=CASE
        WHEN documento_control_repositorio.public_desactivado_at IS NULL THEN true
        ELSE documento_control_repositorio.public_activo
      END,
      public_expires_at=GREATEST(COALESCE(documento_control_repositorio.public_expires_at, EXCLUDED.public_expires_at), EXCLUDED.public_expires_at),
      updated_metadata=EXCLUDED.updated_metadata,
      export_filename=EXCLUDED.export_filename,
      payload_hash_sha256=EXCLUDED.payload_hash_sha256,
      html_hash_sha256=EXCLUDED.html_hash_sha256,
      archivado_at=COALESCE(documento_control_repositorio.archivado_at, NOW()),
      archivado_por=COALESCE(documento_control_repositorio.archivado_por, EXCLUDED.archivado_por),
      retencion_minima_hasta=COALESCE(documento_control_repositorio.retencion_minima_hasta, EXCLUDED.retencion_minima_hasta),
      retencion_politica='minimo_1_ano',
      updated_at=NOW()
    RETURNING id,empresa_id,pedido_id,codigo_control,estado,activo,filename,pdf_filename,payload_hash_sha256,html_hash_sha256,pdf_hash_sha256,public_activo,public_expires_at,archivado_at,retencion_minima_hasta
  `, [
    empresaId,
    pedidoId,
    payload.documento?.codigo_control || "",
    ctx.pedido?.numero || "",
    ctx.cliente?.nombre || ctx.pedido?.cliente_nombre || "",
    JSON.stringify(payload),
    JSON.stringify(expediente),
    JSON.stringify(exportData),
    html,
    filename,
    pdf.base64,
    pdf.mime,
    pdf.filename,
    pdf.hash_sha256,
    publicExpiresAt,
    JSON.stringify(pdf.metadata || {}),
    exportFilename,
    payloadHash,
    htmlHash,
    userId || null,
  ]);
  const repo = rows[0] || null;
  if (repo) {
    await syncPedidoRegulatoryCore({
      empresaId,
      pedidoId,
      payload,
      structuredExport: exportData,
      repository: repo,
      userId: userId || null,
      reason: motivo,
    }).catch(e => logger.warn("No se pudo sincronizar nucleo regulatorio:", e.message));
    await insertDocumentoControlRepoHistory(repo, {
      motivo,
      pdf_metadata: pdf.metadata || {},
      public_expires_at: repo.public_expires_at || publicExpiresAt,
      retencion_minima_hasta: repo.retencion_minima_hasta,
    }, userId || null, "archivar").catch(() => {});
    await logPedidoEvento(pedidoId, empresaId, "documento_control.archivado", {
      motivo,
      repositorio_id: repo.id,
      codigo_control: repo.codigo_control,
      estado: repo.estado,
      activo: repo.activo,
      payload_hash_sha256: repo.payload_hash_sha256,
      html_hash_sha256: repo.html_hash_sha256,
      pdf_hash_sha256: repo.pdf_hash_sha256,
      public_activo: repo.public_activo,
      public_expires_at: repo.public_expires_at,
      retencion_minima_hasta: repo.retencion_minima_hasta,
      retencion_politica: "minimo_1_ano",
    }, "sistema", userId || null).catch(() => {});
  }
  return repo;
}

async function ensurePedidoOrdenCargaSchema() {
  if (!pedidoOrdenCargaSchemaPromise) {
    pedidoOrdenCargaSchemaPromise = (async () => {
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS orden_carga_numero VARCHAR(40)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS orden_carga_generada_at TIMESTAMPTZ").catch(() => {});
      await db.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_empresa_orden_carga_numero ON pedidos(empresa_id, orden_carga_numero) WHERE orden_carga_numero IS NOT NULL"
      ).catch(() => {});
    })().catch((error) => {
      pedidoOrdenCargaSchemaPromise = null;
      throw error;
    });
  }
  await pedidoOrdenCargaSchemaPromise;
}

function sanitizeSerieOrdenes(value) {
  return String(value || "OC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "") || "OC";
}

async function ensurePedidoCartaPorteSchema() {
  if (!pedidoCartaPorteSchemaPromise) {
    pedidoCartaPorteSchemaPromise = (async () => {
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carta_porte_numero VARCHAR(40)").catch(() => {});
      await db.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carta_porte_generada_at TIMESTAMPTZ").catch(() => {});
      await db.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_empresa_carta_porte_numero ON pedidos(empresa_id, carta_porte_numero) WHERE carta_porte_numero IS NOT NULL"
      ).catch(() => {});
    })().catch((error) => {
      pedidoCartaPorteSchemaPromise = null;
      throw error;
    });
  }
  await pedidoCartaPorteSchemaPromise;
}

function sanitizeSerieCartaPorte(value) {
  return String(value || "CP")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "") || "CP";
}

async function ensurePedidoOrdenCargaNumero(pedidoId, empresaId) {
  await ensurePedidoOrdenCargaSchema();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.transaction(async (client) => {
        const { rows: pedidoRows } = await client.query(
          "SELECT id, empresa_id, fecha_carga, created_at, orden_carga_numero, orden_carga_generada_at FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
          [pedidoId, empresaId]
        );
        const pedido = pedidoRows[0];
        if (!pedido) return null;
        if (pedido.orden_carga_numero) {
          return { numero: pedido.orden_carga_numero, generated_at: pedido.orden_carga_generada_at || null };
        }

        const { rows: empresaRows } = await client.query(
          "SELECT cfg_precios FROM empresas WHERE id=$1 LIMIT 1",
          [empresaId]
        );
        const perfil = empresaRows[0]?.cfg_precios?.empresa_perfil || empresaRows[0]?.cfg_precios || {};
        const serie = sanitizeSerieOrdenes(perfil?.serie_ordenes || "OC");
        const baseDate = pedido.fecha_carga || pedido.created_at || new Date().toISOString();
        const year = new Date(baseDate).getFullYear() || new Date().getFullYear();
        const prefix = `${serie}-${year}-`;

        const { rows: lastRows } = await client.query(
          `SELECT orden_carga_numero
             FROM pedidos
            WHERE empresa_id=$1
              AND orden_carga_numero LIKE $2
            ORDER BY orden_carga_numero DESC
            LIMIT 1`,
          [empresaId, `${prefix}%`]
        );
        const lastSeq = lastRows[0]?.orden_carga_numero
          ? (parseInt(String(lastRows[0].orden_carga_numero).split("-").pop(), 10) || 0)
          : 0;
        const numero = `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
        const { rows: updatedRows } = await client.query(
          `UPDATE pedidos
              SET orden_carga_numero=$1,
                  orden_carga_generada_at=COALESCE(orden_carga_generada_at, NOW())
            WHERE id=$2 AND empresa_id=$3
            RETURNING orden_carga_numero, orden_carga_generada_at`,
          [numero, pedidoId, empresaId]
        );
        return {
          numero: updatedRows[0]?.orden_carga_numero || numero,
          generated_at: updatedRows[0]?.orden_carga_generada_at || null,
        };
      });
    } catch (error) {
      if (error?.code === "23505" && attempt < 2) continue;
      throw error;
    }
  }
  return null;
}

async function ensurePedidoCartaPorteNumero(pedidoId, empresaId) {
  await ensurePedidoCartaPorteSchema();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.transaction(async (client) => {
        const { rows: pedidoRows } = await client.query(
          "SELECT id, empresa_id, fecha_carga, created_at, carta_porte_numero, carta_porte_generada_at FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
          [pedidoId, empresaId]
        );
        const pedido = pedidoRows[0];
        if (!pedido) return null;
        if (pedido.carta_porte_numero) {
          return { numero: pedido.carta_porte_numero, generated_at: pedido.carta_porte_generada_at || null };
        }

        const { rows: empresaRows } = await client.query(
          "SELECT cfg_precios FROM empresas WHERE id=$1 LIMIT 1",
          [empresaId]
        );
        const perfil = empresaRows[0]?.cfg_precios?.empresa_perfil || empresaRows[0]?.cfg_precios || {};
        const serie = sanitizeSerieCartaPorte(perfil?.serie_carta_porte || perfil?.serie_documentos || "CP");
        const baseDate = pedido.fecha_carga || pedido.created_at || new Date().toISOString();
        const year = new Date(baseDate).getFullYear() || new Date().getFullYear();
        const prefix = `${serie}-${year}-`;

        const { rows: lastRows } = await client.query(
          `SELECT carta_porte_numero
             FROM pedidos
            WHERE empresa_id=$1
              AND carta_porte_numero LIKE $2
            ORDER BY carta_porte_numero DESC
            LIMIT 1`,
          [empresaId, `${prefix}%`]
        );
        const lastSeq = lastRows[0]?.carta_porte_numero
          ? (parseInt(String(lastRows[0].carta_porte_numero).split("-").pop(), 10) || 0)
          : 0;
        const numero = `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
        const { rows: updatedRows } = await client.query(
          `UPDATE pedidos
              SET carta_porte_numero=$1,
                  carta_porte_generada_at=COALESCE(carta_porte_generada_at, NOW())
            WHERE id=$2 AND empresa_id=$3
            RETURNING carta_porte_numero, carta_porte_generada_at`,
          [numero, pedidoId, empresaId]
        );
        return {
          numero: updatedRows[0]?.carta_porte_numero || numero,
          generated_at: updatedRows[0]?.carta_porte_generada_at || null,
        };
      });
    } catch (error) {
      if (error?.code === "23505" && attempt < 2) continue;
      throw error;
    }
  }
  return null;
}

async function getPedidoColaboradorData(pedidoId, empresaId) {
  const { rows } = await db.query(`
    SELECT p.*,
           co.nombre AS colaborador_nombre,
           co.email AS colaborador_email,
           co.telefono AS colaborador_telefono,
           e.nombre AS empresa_nombre,
           e.email_admin AS empresa_email
    FROM pedidos p
    LEFT JOIN colaboradores co ON co.id = p.colaborador_id AND co.empresa_id = p.empresa_id
    LEFT JOIN empresas e ON e.id = p.empresa_id
    WHERE p.id=$1 AND p.empresa_id=$2
  `, [pedidoId, empresaId]);
  return rows[0] || null;
}

function facturaVencimientoDesdeCliente(cliente) {
  const dias = parseInt(String(cliente?.vencimiento || 30), 10);
  const safeDias = Number.isFinite(dias) ? dias : 30;
  const d = new Date();
  d.setDate(d.getDate() + safeDias);
  return d.toISOString().slice(0, 10);
}

function normalizeIvaRegimen(tipoIva, ivaRegimen) {
  const regimen = String(ivaRegimen || "").trim().toLowerCase();
  if (regimen === "exento") return { tipo_iva: 0, iva_regimen: "exento" };
  if (regimen === "cero") return { tipo_iva: 0, iva_regimen: "cero" };
  if (regimen === "reducido") return { tipo_iva: 10, iva_regimen: "reducido" };
  if (regimen === "superreducido") return { tipo_iva: 4, iva_regimen: "superreducido" };
  const pct = Number(tipoIva);
  if (Number.isFinite(pct)) {
    if (pct === 0) return { tipo_iva: 0, iva_regimen: regimen === "exento" ? "exento" : "cero" };
    if (pct === 10) return { tipo_iva: 10, iva_regimen: "reducido" };
    if (pct === 4) return { tipo_iva: 4, iva_regimen: "superreducido" };
  }
  return { tipo_iva: 21, iva_regimen: "general" };
}

async function crearFacturaBorradorPedido(pedidoId, empresaId, userId = null) {
  await db.transaction(async (client) => {
    const { rows: pedRows } = await client.query(
      `SELECT p.*,
              c.tipo_iva, c.iva_regimen, c.tipo_irpf, c.forma_pago, c.vencimiento
         FROM pedidos p
         JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        WHERE p.id=$1 AND p.empresa_id=$2
        FOR UPDATE`,
      [pedidoId, empresaId]
    );
    const pedido = pedRows[0];
    if (!pedido || pedido.factura_id) return;

    const base = Number(pedido.importe || pedido.precio_cliente_col || pedido.precio_unitario || 0);
    if (!Number.isFinite(base) || base <= 0) return;

    const fecha = new Date();
    const year = fecha.getFullYear();
    const serie = "A";
    const { rows: last } = await client.query(
      `SELECT numero FROM facturas
        WHERE serie=$1 AND EXTRACT(year FROM fecha)=$2 AND empresa_id=$3
        ORDER BY numero DESC LIMIT 1 FOR UPDATE`,
      [serie, year, empresaId]
    );
    const lastNum = last[0] ? parseInt(String(last[0].numero).split("-").pop(), 10) || 0 : 0;
    const numero = `${serie}-${year}-${String(lastNum + 1).padStart(4, "0")}`;
    const tipoIva = pedido.tipo_iva !== undefined && pedido.tipo_iva !== null ? Number(pedido.tipo_iva) : 21;
    const ivaRegimen = pedido.iva_regimen || (tipoIva === 0 ? "cero" : tipoIva === 10 ? "reducido" : tipoIva === 4 ? "superreducido" : "general");
    const tipoIrpf = Number(pedido.tipo_irpf || 0);
    const cuotaIva = base * tipoIva / 100;
    const cuotaIrpf = base * tipoIrpf / 100;
    const total = base + cuotaIva - cuotaIrpf;
    const fechaVencimiento = facturaVencimientoDesdeCliente(pedido);
    const revisionCobro = new Date(fechaVencimiento);
    revisionCobro.setDate(revisionCobro.getDate() + 1);

    const { rows: facRows } = await client.query(
      `INSERT INTO facturas
        (numero, serie, cliente_id, fecha, fecha_vencimiento, estado, forma_pago, vencimiento,
         base_imponible, tipo_iva, cuota_iva, tipo_irpf, cuota_irpf, total, iva_regimen,
         observaciones, notas_internas, created_by, empresa_id, revision_cobro_at)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,'borrador',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        numero, serie, pedido.cliente_id, fechaVencimiento, pedido.forma_pago || null, pedido.vencimiento || null,
        base, tipoIva, cuotaIva, tipoIrpf, cuotaIrpf, total, ivaRegimen,
        `Borrador generado automaticamente al terminar el pedido ${pedido.numero || ""}.`,
        "Revisar albaranes adjuntos antes de emitir.",
        userId, empresaId, revisionCobro.toISOString().slice(0, 10),
      ]
    );
    const factura = facRows[0];
    const revisionCombustible = Math.max(0, Number(pedido.importe_revision_combustible || 0));
    const recargoCombustiblePct = Number(pedido.recargo_combustible_pct || 0);
    const porteSinRevision = revisionCombustible > 0 && revisionCombustible < base
      ? Math.round((base - revisionCombustible) * 100) / 100
      : base;
    await client.query(
      "INSERT INTO factura_lineas (factura_id, concepto, cantidad, precio_unit, orden) VALUES ($1,$2,1,$3,0)",
      [factura.id, `Porte ${pedido.numero || ""} ${pedido.origen || ""} - ${pedido.destino || ""}`.trim(), porteSinRevision]
    );
    if (revisionCombustible > 0 && revisionCombustible < base) {
      await client.query(
        "INSERT INTO factura_lineas (factura_id, concepto, cantidad, precio_unit, orden) VALUES ($1,$2,1,$3,1)",
        [
          factura.id,
          `Revision combustible art. 38 Ley 15/2009${recargoCombustiblePct ? ` (${recargoCombustiblePct}%)` : ""}`,
          revisionCombustible,
        ]
      );
    }
    await client.query(
      "INSERT INTO factura_pedidos (factura_id, pedido_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [factura.id, pedido.id]
    );
    await client.query(
      "UPDATE pedidos SET factura_id=$1 WHERE id=$2 AND empresa_id=$3",
      [factura.id, pedido.id, empresaId]
    );
    await client.query(
      `INSERT INTO factura_docs (factura_id,pedido_doc_id,pedido_id,empresa_id,nombre,tipo,file_base64,file_mime)
       SELECT $1,id,pedido_id,empresa_id,nombre,tipo,file_base64,file_mime
         FROM pedido_docs
        WHERE pedido_id=$2 AND empresa_id=$3
          AND (LOWER(COALESCE(tipo,'')) LIKE '%albar%' OR LOWER(COALESCE(nombre,'')) LIKE '%albar%' OR LOWER(COALESCE(tipo,'')) LIKE '%cmr%')
       ON CONFLICT DO NOTHING`,
      [factura.id, pedido.id, empresaId]
    ).catch(e => logger.warn("No se pudieron vincular albaranes a factura:", e.message));
    await logPedidoEvento(pedido.id, empresaId, "factura.borrador_auto", { factura_id: factura.id, numero }, "sistema", null, client);
  });
}

async function crearFacturaRecibidaColaborador(pedidoId, empresaId, userId = null) {
  await db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT p.id, p.numero, p.referencia_cliente, p.colaborador_id, p.precio_colaborador,
              co.tipo_iva, co.iva_regimen, co.forma_pago
         FROM pedidos p
         JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
        WHERE p.id=$1 AND p.empresa_id=$2
        FOR UPDATE`,
      [pedidoId, empresaId]
    );
    const pedido = rows[0];
    if (!pedido?.colaborador_id) return;

    const base = Number(pedido.precio_colaborador || 0);
    if (!Number.isFinite(base) || base <= 0) return;

    const dup = await client.query(
      `SELECT id FROM colaborador_facturas
        WHERE empresa_id=$1 AND colaborador_id=$2 AND pedido_id=$3
        LIMIT 1`,
      [empresaId, pedido.colaborador_id, pedido.id]
    );
    if (dup.rows[0]) return;

    const iva = normalizeIvaRegimen(pedido.tipo_iva, pedido.iva_regimen);
    const total = base * (1 + Number(iva.tipo_iva || 0) / 100);
    const referencia = pedido.numero || pedido.referencia_cliente || String(pedido.id);
    await client.query(
      `INSERT INTO colaborador_facturas
        (empresa_id,colaborador_id,pedido_id,referencia_orden,fecha,base,iva_pct,iva_regimen,total,estado,notas,created_by)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$8,'pendiente',$9,$10)`,
      [
        empresaId,
        pedido.colaborador_id,
        pedido.id,
        referencia,
        base,
        iva.tipo_iva,
        iva.iva_regimen,
        total,
        "Prevision de factura recibida generada automaticamente al terminar el viaje. Pendiente de recibir factura del colaborador.",
        userId,
      ]
    );
    await logPedidoEvento(pedido.id, empresaId, "colaborador.factura_recibida_auto", { referencia, base, total }, "sistema", null, client);
  }).catch(e => logger.warn("No se pudo crear la factura recibida del colaborador:", e.message));
}

async function vincularAlbaranesAFacturaPedido(pedidoId, empresaId) {
  await db.query(
    `INSERT INTO factura_docs (factura_id,pedido_doc_id,pedido_id,empresa_id,nombre,tipo,file_base64,file_mime)
     SELECT p.factura_id, d.id, d.pedido_id, d.empresa_id, d.nombre, d.tipo, d.file_base64, d.file_mime
       FROM pedidos p
       JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
       JOIN pedido_docs d ON d.pedido_id=p.id AND d.empresa_id=p.empresa_id
      WHERE p.id=$1
        AND p.empresa_id=$2
        AND p.factura_id IS NOT NULL
        AND f.estado='borrador'
        AND (
          LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
          OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
          OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
          OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
        )
     ON CONFLICT DO NOTHING`,
    [pedidoId, empresaId]
  ).catch(e => logger.warn("No se pudieron sincronizar albaranes con factura:", e.message));
}

async function hayRecordatorioAlbaranHoy(pedidoId, empresaId) {
  const { rows } = await db.query(
    `SELECT id
       FROM email_log
      WHERE empresa_id=$1
        AND trigger='colaborador_albaran_recordatorio'
        AND meta->>'pedido_id'=$2
        AND sent_at::date=CURRENT_DATE
      LIMIT 1`,
    [empresaId, String(pedidoId)]
  ).catch(() => ({ rows: [] }));
  return !!rows[0];
}

async function enviarRecordatorioAlbaranColaborador(pedido, { baseUrl = null, force = false } = {}) {
  if (!pedido?.id || !pedido?.empresa_id || !pedido?.colaborador_email) return { sent: false, reason: "sin_email" };
  if (!force && await hayRecordatorioAlbaranHoy(pedido.id, pedido.empresa_id)) {
    return { sent: false, reason: "ya_enviado_hoy" };
  }
  const token = await createColaboradorToken(pedido, "descarga", 168);
  const url = `${baseUrl || publicBaseUrl()}/api/v1/pedidos/colaborador/descarga/${token}`;
  await enviarEmail({
    trigger: "colaborador_albaran_recordatorio",
    destinatario: pedido.colaborador_email,
    plantilla: "colaborador_albaran_recordatorio",
    empresa_id: pedido.empresa_id,
    datos: {
      empresa: pedido.empresa_nombre || "TransGest",
      colaborador: pedido.colaborador_nombre || "Colaborador",
      numero: pedido.numero || "",
      ruta: `${pedido.origen || ""} -> ${pedido.destino || ""}`,
      fecha_descarga: pedido.fecha_descarga || pedido.fecha_entrega || "",
      url,
    },
    meta: {
      pedido_id: pedido.id,
      pedido_numero: pedido.numero || "",
      colaborador_id: pedido.colaborador_id || null,
      tipo: "recordatorio_albaran_pendiente",
    },
  });
  await logPedidoEvento(pedido.id, pedido.empresa_id, "colaborador.albaran_recordatorio_email", {
    destinatario: pedido.colaborador_email,
  }, "sistema");
  return { sent: true };
}

async function solicitarAlbaranesAdministracionSiFaltan(pedidoId, empresaId, userId = null) {
  const { rows } = await db.query(
    `SELECT p.id, p.numero, p.origen, p.destino, p.fecha_descarga, p.fecha_entrega, p.factura_id,
            p.empresa_id, p.colaborador_id,
            co.nombre AS colaborador_nombre, co.email AS colaborador_email,
            e.nombre AS empresa_nombre,
            COUNT(d.id) FILTER (
              WHERE LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
                 OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
            ) AS albaranes
       FROM pedidos p
       LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
       LEFT JOIN empresas e ON e.id=p.empresa_id
       LEFT JOIN pedido_docs d ON d.pedido_id=p.id AND d.empresa_id=p.empresa_id
      WHERE p.id=$1 AND p.empresa_id=$2
      GROUP BY p.id, co.id, e.id`,
    [pedidoId, empresaId]
  ).catch(() => ({ rows: [] }));
  const pedido = rows[0];
  if (!pedido || Number(pedido.albaranes || 0) > 0) return;
  const tieneEmailProveedor = !!String(pedido.colaborador_email || "").trim();
  await notificarAdministracionPedido(
    empresaId,
    "pedido_albaranes_solicitados",
    "Solicitar albaranes del viaje",
    tieneEmailProveedor
      ? `El pedido ${pedido.numero || pedido.id} se ha marcado como realizado sin albaranes/CMR. El sistema enviara recordatorio diario al proveedor hasta que los suba. Si llegan por otro canal, adjuntalos manualmente al viaje.`
      : `El pedido ${pedido.numero || pedido.id} se ha marcado como realizado sin albaranes/CMR. No hay email de proveedor, por lo que administracion debe solicitarlos por otro canal o subirlos manualmente al viaje.`,
    {
      pedido_id: pedido.id,
      pedido_numero: pedido.numero || "",
      factura_id: pedido.factura_id || null,
      colaborador_id: pedido.colaborador_id || null,
      colaborador_email: pedido.colaborador_email || "",
      origen: pedido.origen || "",
      destino: pedido.destino || "",
      fase: "entrega_sin_albaranes",
      dedupe_key: `albaranes-realizado:${pedido.id}`,
    },
    userId
  );
  await logPedidoEvento(pedido.id, empresaId, "pedido.albaranes_solicitados_admin", {
    motivo: "entrega_sin_albaranes",
    factura_id: pedido.factura_id || null,
    recordatorio_email: tieneEmailProveedor,
  }, "sistema", userId || null);
  if (tieneEmailProveedor) {
    await enviarRecordatorioAlbaranColaborador(pedido, { force: false })
      .catch(e => logger.warn("No se pudo enviar recordatorio de albaran al colaborador:", e.message));
  }
}

async function aplicarAutomatismosEntrega(pedidoId, empresaId, userId = null, options = {}) {
  await crearFacturaBorradorPedido(pedidoId, empresaId, userId)
    .catch(e => logger.error("No se pudo crear factura borrador automatica:", e.message));
  await vincularAlbaranesAFacturaPedido(pedidoId, empresaId);
  await solicitarAlbaranesAdministracionSiFaltan(pedidoId, empresaId, userId)
    .catch(e => logger.warn("No se pudo solicitar albaranes a administracion:", e.message));
  await crearFacturaRecibidaColaborador(pedidoId, empresaId, userId);
  await archivarDocumentoControlPedido({
    pedidoId,
    empresaId,
    appBaseUrl: options.appBaseUrl || "",
    userId,
    motivo: "viaje_finalizado",
  }).catch(e => logger.warn("No se pudo archivar el DCD del pedido:", e.message));
}

async function procesarRecordatoriosAlbaranesPendientes({ limit = 200 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const { rows } = await db.query(
    `SELECT p.id, p.numero, p.origen, p.destino, p.fecha_descarga, p.fecha_entrega,
            p.empresa_id, p.colaborador_id,
            co.nombre AS colaborador_nombre, co.email AS colaborador_email,
            e.nombre AS empresa_nombre,
            COUNT(d.id) FILTER (
              WHERE LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
                 OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
                 OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
                 OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
            ) AS albaranes
       FROM pedidos p
       JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
       LEFT JOIN empresas e ON e.id=p.empresa_id
       LEFT JOIN pedido_docs d ON d.pedido_id=p.id AND d.empresa_id=p.empresa_id
      WHERE p.estado::text IN ('entregado','facturado')
        AND p.colaborador_id IS NOT NULL
        AND COALESCE(NULLIF(TRIM(co.email),''),'') <> ''
      GROUP BY p.id, co.id, e.id
     HAVING COUNT(d.id) FILTER (
              WHERE LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
                 OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
                 OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
                 OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
                 OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
            ) = 0
      ORDER BY COALESCE(p.fecha_descarga, p.fecha_entrega, p.created_at) ASC
      LIMIT $1`,
    [max]
  ).catch(e => {
    logger.warn("No se pudieron buscar albaranes pendientes para recordatorio:", e.message);
    return { rows: [] };
  });

  let enviados = 0;
  let omitidos = 0;
  for (const pedido of rows) {
    const result = await enviarRecordatorioAlbaranColaborador(pedido).catch(e => {
      logger.warn("Recordatorio albaran pendiente fallo:", e.message);
      return { sent: false, reason: e.message };
    });
    if (result?.sent) enviados += 1;
    else omitidos += 1;
  }
  return { revisados: rows.length, enviados, omitidos };
}

let albaranesReminderSchedulerStarted = false;
function startAlbaranesReminderScheduler() {
  if (albaranesReminderSchedulerStarted) return;
  albaranesReminderSchedulerStarted = true;
  const run = async () => {
    const result = await procesarRecordatoriosAlbaranesPendientes();
    logger.info(`[Albaranes] Recordatorios diarios revisados=${result.revisados} enviados=${result.enviados} omitidos=${result.omitidos}`);
  };
  try {
    const cron = require("node-cron");
    cron.schedule("30 8 * * *", () => {
      run().catch(e => logger.warn("[Albaranes] Scheduler fallo:", e.message));
    }, { timezone: "Europe/Madrid" });
    logger.info("[Albaranes] Scheduler iniciado - recordatorios diarios a las 08:30");
  } catch(e) {
    setInterval(() => {
      run().catch(err => logger.warn("[Albaranes] Scheduler fallo:", err.message));
    }, 24 * 60 * 60 * 1000);
    logger.info("[Albaranes] Scheduler iniciado - recordatorios cada 24h");
  }
}

async function createColaboradorToken(pedido, accion, horas = 360) {
  await ensureColaboradorWorkflowSchema();
  const token = crypto.randomBytes(32).toString("hex");
  await db.query(
    `INSERT INTO colaborador_pedido_tokens (pedido_id,empresa_id,accion,token_hash,expires_at)
     VALUES ($1,$2,$3,$4,NOW() + ($5 || ' hours')::interval)`,
    [pedido.id, pedido.empresa_id, accion, hashToken(token), String(horas)]
  );
  return token;
}

async function getColaboradorTokenData(token, accion) {
  await ensureColaboradorWorkflowSchema();
  const { rows } = await db.query(`
    SELECT t.id AS token_id,
           t.pedido_id,
           t.empresa_id AS token_empresa_id,
           t.accion AS token_accion,
           t.expires_at AS token_expires_at,
           p.*,
           co.nombre AS colaborador_nombre,
           co.email AS colaborador_email,
           e.nombre AS empresa_nombre,
           e.email_admin AS empresa_email
    FROM colaborador_pedido_tokens t
    JOIN pedidos p ON p.id=t.pedido_id AND p.empresa_id=t.empresa_id
    LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
    LEFT JOIN empresas e ON e.id=p.empresa_id
    WHERE t.token_hash=$1
      AND t.accion=$2
      AND t.usado_at IS NULL
      AND t.expires_at > NOW()
    LIMIT 1
  `, [hashToken(token), accion]);
  return rows[0] || null;
}

function colaboradorPage(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>${htmlEscape(title)}</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f4f7f6;margin:0;color:#14211d}
      main{max-width:720px;margin:32px auto;background:#fff;border:1px solid #d8e5e1;border-radius:12px;padding:24px}
      h1{margin:0 0 8px;font-size:24px} p{line-height:1.5;color:#475b54}
      label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;color:#587068;margin:14px 0 5px}
      input,textarea{width:100%;box-sizing:border-box;padding:11px;border:1px solid #c9d8d3;border-radius:8px;font-size:15px}
      button,.btn{display:inline-block;margin-top:18px;background:#0f766e;color:#fff;border:0;border-radius:8px;padding:12px 16px;font-weight:800;text-decoration:none;cursor:pointer}
      .mapbtn{margin-top:10px;background:#2563eb}
      .muted{font-size:13px;color:#6c8179}.ok{background:#e7f7f2;border:1px solid #b9eadb;color:#0f766e;padding:12px;border-radius:8px}
      .warn{background:#fff7e6;border:1px solid #f7d898;color:#8a5a00;padding:12px;border-radius:8px}
      .card{margin:16px 0;padding:16px;border:1px solid #cfe2df;border-radius:10px;background:#f8fcfb}
      .card h2{margin:0 0 8px;font-size:16px}
      .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
      .meta{font-size:13px;color:#38524a}
      .f{background:#fff;border:1px solid #dbe8e4;border-radius:8px;padding:9px 10px}
      .fl{font-size:10px;font-weight:800;text-transform:uppercase;color:#6c8179;margin-bottom:3px}
      .fv{font-size:13px;font-weight:700;color:#14211d}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:640px){.grid{grid-template-columns:1fr}}
    </style></head><body><main>${body}</main></body></html>`;
}

async function getColaboradorDocumentoControlPayload(req, pedidoId, empresaId) {
  try {
    const ctx = await getPedidoDocumentoControlContext(pedidoId, empresaId);
    if (!ctx?.pedido) return null;
    return buildDocumentoControlPayload({
      empresaId,
      pedido: ctx.pedido,
      empresa: ctx.empresa,
      cliente: ctx.cliente,
      colaborador: ctx.colaborador,
      appBaseUrl: publicBaseUrl(req),
    });
  } catch (error) {
    logger.warn("No se pudo preparar el documento de control para colaborador:", error.message);
    return null;
  }
}

function renderColaboradorDocumentoControlBox(docControl) {
  if (!docControl?.documento) return "";
  const supportFromDownload = String(docControl.remision?.download_url || "").replace(/([?&])download=1\b/, "").replace(/[?&]$/, "");
  const soporteUrl = docControl.soporte_url || docControl.documento?.url_publica || supportFromDownload || "";
  const downloadUrl = docControl.remision?.download_url || soporteUrl;
  const faltantes = Array.isArray(docControl.status?.faltantes) ? docControl.status.faltantes.slice(0, 4) : [];
  return `
    <div class="card">
      <h2>Documento de control digital</h2>
      <p class="meta"><strong>${htmlEscape(docControl.remision?.etiqueta || docControl.documento?.sistema_label || "Soporte documental")}</strong></p>
      <p class="meta">Codigo: <strong>${htmlEscape(docControl.documento.codigo_control || "-")}</strong></p>
      ${docControl.status?.ready
        ? `<div class="ok">El soporte documental del viaje ya esta disponible para consulta e impresion.</div>`
        : `<div class="warn">Aun faltan datos por completar en el documento.${faltantes.length ? ` Revisar: ${htmlEscape(faltantes.join(", "))}.` : ""}</div>`}
      <div class="actions">
        ${soporteUrl ? `<a class="btn" href="${htmlEscape(soporteUrl)}" target="_blank" rel="noreferrer">Abrir soporte</a>` : ""}
        ${downloadUrl ? `<a class="btn" href="${htmlEscape(downloadUrl)}" target="_blank" rel="noreferrer">Descargar soporte</a>` : ""}
      </div>
      ${docControl.remision?.instrucciones ? `<p class="muted">${htmlEscape(docControl.remision.instrucciones)}</p>` : ""}
    </div>
  `;
}

function getColaboradorPrecioTonelada(data) {
  if (!data || String(data.tipo_precio || "").toLowerCase() !== "tonelada") return null;
  const unitarioManual = parseLocaleNumber(data.precio_colaborador_unitario);
  if (!Number.isFinite(unitarioManual) || unitarioManual <= 0) return null;
  const minimoManual = parseLocaleNumber(data.minimo_colaborador_unidades);
  const minimoPedido = parseLocaleNumber(data.minimo_unidades);
  const cantidad = parseLocaleNumber(data.cantidad);
  const pesoKg = parseLocaleNumber(data.peso_kg || data.kg);
  const toneladasBase = Number.isFinite(cantidad) && cantidad > 0
    ? cantidad
    : (Number.isFinite(pesoKg) && pesoKg > 0 ? (pesoKg < 1000 ? pesoKg : Number((pesoKg / 1000).toFixed(3))) : 0);
  const minimoToneladas = Number.isFinite(minimoManual) && minimoManual > 0
    ? minimoManual
    : (Number.isFinite(minimoPedido) && minimoPedido > 0 ? minimoPedido : toneladasBase);
  const toneladasFacturables = Math.max(toneladasBase || 0, minimoToneladas || 0);
  if (!Number.isFinite(minimoToneladas) || minimoToneladas <= 0 || !Number.isFinite(toneladasFacturables) || toneladasFacturables <= 0) return null;
  return {
    precioTonelada: unitarioManual,
    minimoToneladas,
    toneladasFacturables,
  };
}

function getColaboradorPrecioCerradoTonelada(data) {
  if (!data || String(data.tipo_precio || "").toLowerCase() !== "tonelada") return null;
  if (getColaboradorPrecioTonelada(data)) return null;
  const total = parseLocaleNumber(data.precio_colaborador);
  if (!Number.isFinite(total) || total <= 0) return null;
  return { total };
}

function renderColaboradorConfirmacionPreview(data, docControl) {
  const precioTonelada = getColaboradorPrecioTonelada(data);
  const precioCerrado = getColaboradorPrecioCerradoTonelada(data);
  const modoPrecio = precioTonelada ? "precio_por_tonelada" : (precioCerrado ? "precio_cerrado" : "sin_importe_impreso");
  const ayudaPrecio = precioTonelada
    ? "La confirmacion mostrara al colaborador el precio por tonelada y el minimo facturable acordado."
    : (precioCerrado ? "La confirmacion mostrara al colaborador el precio cerrado acordado para este viaje por toneladas."
    : "La confirmacion no mostrara importes porque el pago esta como precio cerrado o no hay precio por tonelada con minimo acordado.");
  const html = colaboradorPage("Previsualizacion colaborador", `
    <h1>Previsualizacion colaborador</h1>
    <div class="warn">Vista interna para revisar antes de enviar el enlace. No genera token publico ni confirma el transporte.</div>
    <div class="card">
      <h2>Regla economica aplicada</h2>
      <p class="meta"><strong>${htmlEscape(modoPrecio)}</strong></p>
      <p class="meta">${htmlEscape(ayudaPrecio)}</p>
    </div>
    ${renderColaboradorPedidoBox(data, { mostrarPrecio: true })}
    ${renderColaboradorDocumentoControlBox(docControl)}
  `);
  return { html, modo_precio: modoPrecio, precio_visible: !!(precioTonelada || precioCerrado) };
}

function renderColaboradorPedidoBox(data, { mostrarPrecio = false } = {}) {
  if (!data) return "";
  const precioTonelada = mostrarPrecio ? getColaboradorPrecioTonelada(data) : null;
  const precioCerrado = mostrarPrecio && !precioTonelada ? getColaboradorPrecioCerradoTonelada(data) : null;
  const precioRow = precioTonelada
    ? `<div class="f"><div class="fl">Precio acordado por tonelada</div><div class="fv">${precioTonelada.precioTonelada.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR/tn</div></div>
        <div class="f"><div class="fl">Minimo facturable acordado</div><div class="fv">${precioTonelada.minimoToneladas.toLocaleString("es-ES", { maximumFractionDigits: 3 })} tn</div></div>`
    : (precioCerrado
      ? `<div class="f"><div class="fl">Precio acordado</div><div class="fv">${precioCerrado.total.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR</div></div>
          <div class="f"><div class="fl">Tipo de acuerdo</div><div class="fv">Precio cerrado</div></div>`
      : "");
  return `
    <div class="card">
      <h2>Datos del transporte</h2>
      <div class="grid">
        <div class="f"><div class="fl">Pedido</div><div class="fv">${htmlEscape(data.numero || "-")}</div></div>
        <div class="f"><div class="fl">Colaborador</div><div class="fv">${htmlEscape(data.colaborador_nombre || "-")}</div></div>
        <div class="f"><div class="fl">Origen</div><div class="fv">${htmlEscape(data.origen || "-")}</div></div>
        <div class="f"><div class="fl">Destino</div><div class="fv">${htmlEscape(data.destino || "-")}</div></div>
        <div class="f"><div class="fl">Carga</div><div class="fv">${htmlEscape([data.fecha_carga, data.hora_carga || data.ventana_carga].filter(Boolean).join(" ") || "-")}</div></div>
        <div class="f"><div class="fl">Descarga</div><div class="fv">${htmlEscape([data.fecha_descarga || data.fecha_entrega, data.hora_descarga || data.ventana_descarga].filter(Boolean).join(" ") || "-")}</div></div>
        <div class="f"><div class="fl">Mercancia</div><div class="fv">${htmlEscape(data.mercancia || "-")}</div></div>
        <div class="f"><div class="fl">Peso / bultos</div><div class="fv">${htmlEscape([data.peso_kg ? `${data.peso_kg} kg` : "", data.bultos ? `${data.bultos} bultos` : ""].filter(Boolean).join(" - ") || "-")}</div></div>
        <div class="f"><div class="fl">M3 / ML</div><div class="fv">${htmlEscape([data.volumen ? `${data.volumen} m3` : "", data.metros_lineales ? `${data.metros_lineales} ML` : ""].filter(Boolean).join(" - ") || "-")}</div></div>
        <div class="f"><div class="fl">Tractora</div><div class="fv">${htmlEscape(data.matricula_colaborador || "Pendiente")}</div></div>
        <div class="f"><div class="fl">Remolque</div><div class="fv">${htmlEscape(data.remolque_matricula_colaborador || "-")}</div></div>
        ${precioRow}
      </div>
      ${data.notas ? `<p class="muted">${htmlEscape(String(data.notas).slice(0, 500))}</p>` : ""}
    </div>
    ${renderColaboradorMapsBox(data)}
  `;
}

function renderColaboradorAcuseBox(titulo, data, detalle = {}) {
  const generated = new Date().toLocaleString("es-ES");
  const ref = [data?.numero, data?.referencia_cliente].filter(Boolean).join(" / ") || data?.pedido_id || "pedido";
  const acuseHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>${htmlEscape(titulo)} ${htmlEscape(ref)}</title>
    <style>
      body{font-family:Arial,sans-serif;color:#111827;margin:0;padding:28px;background:#f8fafc}
      main{max-width:860px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:24px 28px}
      h1{font-size:23px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
      .box{border:1px solid #e5e7eb;border-radius:9px;background:#f8fafc;padding:12px}
      .label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{margin-top:5px;font-size:13px;font-weight:800}
      .ok{border-color:#bbf7d0;background:#f0fdf4;color:#166534}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>${htmlEscape(titulo)}</h1>
      <div class="sub">${htmlEscape(data?.empresa_nombre || "TransGest")} - generado el ${htmlEscape(generated)}</div>
      <div class="box ok"><div class="value">Confirmacion registrada correctamente.</div></div>
      <div class="grid">
        <div class="box"><div class="label">Pedido</div><div class="value">${htmlEscape(data?.numero || "-")}</div></div>
        <div class="box"><div class="label">Colaborador</div><div class="value">${htmlEscape(data?.colaborador_nombre || "-")}</div></div>
        <div class="box"><div class="label">Origen</div><div class="value">${htmlEscape(data?.origen || "-")}</div></div>
        <div class="box"><div class="label">Destino</div><div class="value">${htmlEscape(data?.destino || "-")}</div></div>
        <div class="box"><div class="label">Carga</div><div class="value">${htmlEscape([data?.fecha_carga, data?.hora_carga || data?.ventana_carga].filter(Boolean).join(" ") || "-")}</div></div>
        <div class="box"><div class="label">Descarga</div><div class="value">${htmlEscape([data?.fecha_descarga || data?.fecha_entrega, data?.hora_descarga || data?.ventana_descarga].filter(Boolean).join(" ") || "-")}</div></div>
        <div class="box"><div class="label">Tractora</div><div class="value">${htmlEscape(detalle.matricula || data?.matricula_colaborador || "-")}</div></div>
        <div class="box"><div class="label">Remolque</div><div class="value">${htmlEscape(detalle.remolque || data?.remolque_matricula_colaborador || "-")}</div></div>
        ${detalle.documentos !== undefined ? `<div class="box"><div class="label">Documentos adjuntos</div><div class="value">${htmlEscape(detalle.documentos)}</div></div>` : ""}
      </div>
      ${detalle.notas ? `<div class="box"><div class="label">Observaciones</div><div class="value">${htmlEscape(detalle.notas)}</div></div>` : ""}
    </main></body></html>`;
  const encoded = Buffer.from(acuseHtml, "utf8").toString("base64");
  const filename = `acuse-colaborador-${String(ref).replace(/[^a-z0-9_-]+/gi, "-")}.html`;
  return `
    <div class="card">
      <h2>Justificante</h2>
      <p class="meta">Puedes descargar o imprimir este acuse para conservar la confirmacion.</p>
      <div class="actions">
        <a class="btn" download="${htmlEscape(filename)}" href="data:text/html;base64,${encoded}">Descargar acuse</a>
        <button type="button" onclick="window.print()">Imprimir</button>
      </div>
    </div>
  `;
}

async function logColaboradorDocumentoControl(pedidoId, empresaId, action, detalle = {}) {
  try {
    await logPedidoEvento(pedidoId, empresaId, "documento_control." + action, {
      source: "colaborador",
      ...detalle,
    }, "colaborador");
  } catch (error) {
    logger.warn("No se pudo registrar evento DCD colaborador:", error.message);
  }
}

async function sendColaboradorEmail(req, pedido, accion, token) {
  const base = publicBaseUrl(req);
  const links = {
    confirmar: `${base}/api/v1/pedidos/colaborador/confirmar/${token}`,
    carga: `${base}/api/v1/pedidos/colaborador/carga/${token}`,
    camino: `${base}/api/v1/pedidos/colaborador/camino/${token}`,
    descarga: `${base}/api/v1/pedidos/colaborador/descarga/${token}`,
  };
  const plantilla = accion === "confirmar"
    ? "colaborador_confirmar"
    : accion === "carga" ? "colaborador_carga" : accion === "camino" ? "colaborador_camino" : "colaborador_descarga";
  const docControl = pedido?.id ? await getColaboradorDocumentoControlPayload(req, pedido.id, pedido.empresa_id) : null;
  const supportFromDownload = String(docControl?.remision?.download_url || "").replace(/([?&])download=1\b/, "").replace(/[?&]$/, "");
  if (docControl?.documento) {
    await logColaboradorDocumentoControl(pedido.id, pedido.empresa_id, "remitido", {
      accion,
      canal: "email_colaborador",
      codigo_control: docControl.documento.codigo_control || null,
      ready: !!docControl.status?.ready,
    });
  }
  await enviarEmail({
    trigger: `colaborador_${accion}`,
    destinatario: pedido.colaborador_email,
    plantilla,
    empresa_id: pedido.empresa_id,
    datos: {
      empresa: pedido.empresa_nombre || "TransGest",
      colaborador: pedido.colaborador_nombre || "Colaborador",
      numero: pedido.numero,
      ruta: `${pedido.origen || ""} -> ${pedido.destino || ""}`,
      fecha_carga: pedido.fecha_carga || "",
      precio: Number(pedido.precio_colaborador || 0).toLocaleString("es-ES", { minimumFractionDigits: 2 }),
      url: links[accion],
      map_links: buildColaboradorMapLinks(pedido),
      dcd_url: docControl?.soporte_url || docControl?.documento?.url_publica || supportFromDownload || "",
      dcd_codigo: docControl?.documento?.codigo_control || "",
      dcd_estado: docControl?.status?.ready ? "listo" : "pendiente",
      dcd_canal: docControl?.remision?.etiqueta || "",
      dcd_instrucciones: docControl?.remision?.instrucciones || "",
    },
  });
}

router.get("/colaborador/confirmar/:token", async (req, res) => {
  try {
    const data = await getColaboradorTokenData(req.params.token, "confirmar");
    if (!data) return res.status(404).send(colaboradorPage("Enlace no disponible", `<h1>Enlace no disponible</h1><p>El enlace ha caducado o ya fue utilizado.</p>`));
    const docControl = await getColaboradorDocumentoControlPayload(req, data.pedido_id, data.empresa_id);
    if (docControl?.documento) await logColaboradorDocumentoControl(data.pedido_id, data.empresa_id, "consultado", { accion: "confirmar", codigo_control: docControl.documento.codigo_control || null });
    res.send(colaboradorPage("Confirmar transporte", `
      <h1>Confirmar transporte</h1>
      <p><strong>${htmlEscape(data.empresa_nombre || "")}</strong> solicita confirmar el pedido <strong>${htmlEscape(data.numero)}</strong>.</p>
      ${renderColaboradorPedidoBox(data, { mostrarPrecio: true })}
      ${renderColaboradorDocumentoControlBox(docControl)}
      <form method="post">
        <div class="grid">
          <div><label>Matricula tractora / vehiculo</label><input name="matricula_colaborador" required value="${htmlEscape(data.matricula_colaborador || "")}"/></div>
          <div><label>Matricula remolque</label><input name="remolque_matricula_colaborador" value="${htmlEscape(data.remolque_matricula_colaborador || "")}"/></div>
        </div>
        <label>Observaciones</label><textarea name="notas" rows="3"></textarea>
        <p><label style="display:flex;gap:8px;align-items:center;text-transform:none;font-size:14px"><input type="checkbox" name="acepta_precio" required style="width:auto"/> Confirmo las condiciones de la orden y acepto realizar el transporte.</label></p>
        <button type="submit">Confirmar datos</button>
      </form>
    `));
  } catch(e) { res.status(500).send(colaboradorPage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`)); }
});

router.post("/colaborador/confirmar/:token", async (req, res) => {
  try {
    const data = await getColaboradorTokenData(req.params.token, "confirmar");
    if (!data) return res.status(404).send(colaboradorPage("Enlace no disponible", `<h1>Enlace no disponible</h1><p>El enlace ha caducado o ya fue utilizado.</p>`));
    const matricula = String(req.body.matricula_colaborador || "").trim().toUpperCase();
    if (!matricula) return res.status(400).send(colaboradorPage("Falta matricula", `<h1>Falta matricula</h1><p>Introduce la matricula del vehiculo.</p>`));
    if (!req.body.acepta_precio) return res.status(400).send(colaboradorPage("Confirmacion pendiente", `<h1>Confirmacion pendiente</h1><p>Debes confirmar las condiciones de la orden para continuar.</p>`));
    const notas = String(req.body.notas || "").trim();
    await db.query(`
      UPDATE pedidos
      SET estado=CASE WHEN estado::text='pendiente' THEN 'confirmado'::estado_pedido ELSE estado END,
          matricula_colaborador=$1,
          remolque_matricula_colaborador=$2,
          colaborador_precio_confirmado=true,
          colaborador_precio_confirmado_at=NOW(),
          notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(notas,''), $3))
      WHERE id=$4 AND empresa_id=$5
    `, [matricula, String(req.body.remolque_matricula_colaborador || "").trim().toUpperCase() || null, notas ? `COLABORADOR: ${notas}` : null, data.pedido_id, data.empresa_id]);
    await logPedidoEvento(data.pedido_id, data.empresa_id, "colaborador.precio_confirmado", {
      matricula,
      remolque: String(req.body.remolque_matricula_colaborador || "").trim().toUpperCase() || null,
      notas: notas || null,
    }, "colaborador");
    if (String(data.estado || "").toLowerCase() === "pendiente") {
      await logPedidoEvento(data.pedido_id, data.empresa_id, "pedido.confirmado_auto_asignacion", {
        motivo: "colaborador_confirmado",
        colaborador_id: data.colaborador_id || null,
      }, "colaborador");
    }
    await db.query("UPDATE colaborador_pedido_tokens SET usado_at=NOW() WHERE id=$1", [data.token_id]);

    const pedido = await getPedidoColaboradorData(data.pedido_id, data.empresa_id);
    if (pedido?.colaborador_email) {
      const tokenCarga = await createColaboradorToken(pedido, "carga", 360);
      await sendColaboradorEmail(req, pedido, "carga", tokenCarga).catch(e => logger.error("Email colaborador carga:", e.message));
    }

    res.send(colaboradorPage("Datos confirmados", `
      <h1>Datos confirmados</h1>
      <div class="ok">Hemos registrado las matriculas y la confirmacion del precio. Recibiras otro email para confirmar la carga.</div>
      ${renderColaboradorAcuseBox("Acuse de confirmacion de transporte", data, {
        matricula,
        remolque: String(req.body.remolque_matricula_colaborador || "").trim().toUpperCase() || null,
        notas,
      })}
    `));
  } catch(e) { res.status(500).send(colaboradorPage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`)); }
});

router.get("/colaborador/carga/:token", async (req, res) => {
  try {
    const data = await getColaboradorTokenData(req.params.token, "carga");
    if (!data) return res.status(404).send(colaboradorPage("Enlace no disponible", `<h1>Enlace no disponible</h1><p>El enlace ha caducado o ya fue utilizado.</p>`));
    const docControl = await getColaboradorDocumentoControlPayload(req, data.pedido_id, data.empresa_id);
    if (docControl?.documento) await logColaboradorDocumentoControl(data.pedido_id, data.empresa_id, "consultado", { accion: "carga", codigo_control: docControl.documento.codigo_control || null });
    res.send(colaboradorPage("Confirmar carga", `
      <h1>Confirmar carga</h1>
      ${renderColaboradorPedidoBox(data)}
      ${renderColaboradorDocumentoControlBox(docControl)}
      <form method="post">
        <label>Incidencia u observacion en carga</label><textarea name="notas" rows="3"></textarea>
        <button type="submit">Marcar como cargado</button>
      </form>
    `));
  } catch(e) { res.status(500).send(colaboradorPage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`)); }
});

router.post("/colaborador/carga/:token", async (req, res) => {
  try {
    const data = await getColaboradorTokenData(req.params.token, "carga");
    if (!data) return res.status(404).send(colaboradorPage("Enlace no disponible", `<h1>Enlace no disponible</h1><p>El enlace ha caducado o ya fue utilizado.</p>`));
    const notas = String(req.body.notas || "").trim();
    await db.query(`
      UPDATE pedidos
      SET estado='en_curso',
          colaborador_carga_confirmada_at=NOW(),
          notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(notas,''), $1))
      WHERE id=$2 AND empresa_id=$3
    `, [notas ? `CARGA COLABORADOR: ${notas}` : null, data.pedido_id, data.empresa_id]);
    await logPedidoEvento(data.pedido_id, data.empresa_id, "colaborador.carga_confirmada", { notas: notas || null }, "colaborador");
    await db.query("UPDATE colaborador_pedido_tokens SET usado_at=NOW() WHERE id=$1", [data.token_id]);

    const pedido = await getPedidoColaboradorData(data.pedido_id, data.empresa_id);
    if (pedido?.colaborador_email) {
      const tokenCamino = await createColaboradorToken(pedido, "camino", 360);
      await sendColaboradorEmail(req, pedido, "camino", tokenCamino).catch(e => logger.error("Email colaborador camino:", e.message));
    }
    res.send(colaboradorPage("Carga registrada", `
      <h1>Carga registrada</h1>
      <div class="ok">El pedido queda marcado como cargado. Se ha enviado el enlace para confirmar que va en camino.</div>
      ${renderColaboradorAcuseBox("Acuse de carga registrada", data, { notas })}
    `));
  } catch(e) { res.status(500).send(colaboradorPage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`)); }
});

router.get("/colaborador/camino/:token", async (req, res) => {
  try {
    const data = await getColaboradorTokenData(req.params.token, "camino");
    if (!data) return res.status(404).send(colaboradorPage("Enlace no disponible", `<h1>Enlace no disponible</h1><p>El enlace ha caducado o ya fue utilizado.</p>`));
    const docControl = await getColaboradorDocumentoControlPayload(req, data.pedido_id, data.empresa_id);
    if (docControl?.documento) await logColaboradorDocumentoControl(data.pedido_id, data.empresa_id, "consultado", { accion: "camino", codigo_control: docControl.documento.codigo_control || null });
    res.send(colaboradorPage("Confirmar en camino", `
      <h1>Confirmar salida hacia destino</h1>
      ${renderColaboradorPedidoBox(data)}
      ${renderColaboradorDocumentoControlBox(docControl)}
      <form method="post">
        <label>Observacion durante el viaje</label><textarea name="notas" rows="3"></textarea>
        <button type="submit">Marcar como en camino</button>
      </form>
    `));
  } catch(e) { res.status(500).send(colaboradorPage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`)); }
});

router.post("/colaborador/camino/:token", async (req, res) => {
  try {
    const data = await getColaboradorTokenData(req.params.token, "camino");
    if (!data) return res.status(404).send(colaboradorPage("Enlace no disponible", `<h1>Enlace no disponible</h1><p>El enlace ha caducado o ya fue utilizado.</p>`));
    const notas = String(req.body.notas || "").trim();
    await db.query(`
      UPDATE pedidos
      SET estado='en_curso',
          colaborador_en_camino_confirmada_at=NOW(),
          notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(notas,''), $1))
      WHERE id=$2 AND empresa_id=$3
    `, [notas ? `EN CAMINO COLABORADOR: ${notas}` : null, data.pedido_id, data.empresa_id]);
    await logPedidoEvento(data.pedido_id, data.empresa_id, "colaborador.en_camino_confirmado", { notas: notas || null }, "colaborador");
    await db.query("UPDATE colaborador_pedido_tokens SET usado_at=NOW() WHERE id=$1", [data.token_id]);

    const pedido = await getPedidoColaboradorData(data.pedido_id, data.empresa_id);
    if (pedido?.colaborador_email) {
      const tokenDescarga = await createColaboradorToken(pedido, "descarga", 720);
      await sendColaboradorEmail(req, pedido, "descarga", tokenDescarga).catch(e => logger.error("Email colaborador descarga:", e.message));
    }
    res.send(colaboradorPage("Viaje en camino", `
      <h1>Viaje en camino</h1>
      <div class="ok">Hemos registrado que el transporte va en camino. Se ha enviado el enlace para confirmar descarga y subir albaranes.</div>
      ${renderColaboradorAcuseBox("Acuse de salida hacia destino", data, { notas })}
    `));
  } catch(e) { res.status(500).send(colaboradorPage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`)); }
});

router.get("/colaborador/descarga/:token", async (req, res) => {
  try {
    const data = await getColaboradorTokenData(req.params.token, "descarga");
    if (!data) return res.status(404).send(colaboradorPage("Enlace no disponible", `<h1>Enlace no disponible</h1><p>El enlace ha caducado o ya fue utilizado.</p>`));
    const postUrl = `/api/v1/pedidos/colaborador/descarga/${htmlEscape(req.params.token)}`;
    const docControl = await getColaboradorDocumentoControlPayload(req, data.pedido_id, data.empresa_id);
    if (docControl?.documento) await logColaboradorDocumentoControl(data.pedido_id, data.empresa_id, "consultado", { accion: "descarga", codigo_control: docControl.documento.codigo_control || null });
    res.send(colaboradorPage("Confirmar descarga", `
      <h1>Confirmar descarga</h1>
      <p>Pedido <strong>${htmlEscape(data.numero)}</strong>. Sube los albaranes firmados y confirma la entrega.</p>
      ${renderColaboradorPedidoBox(data)}
      ${renderColaboradorDocumentoControlBox(docControl)}
      <label>Albaranes firmados</label><input id="files" type="file" multiple accept="image/*,.pdf"/>
      <label>Observaciones de descarga</label><textarea id="notas" rows="3"></textarea>
      <button id="send" type="button">Confirmar descarga y subir albaranes</button>
      <p id="msg" class="muted"></p>
      <script>
        async function fileToBase64(file) {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        }
        document.getElementById('send').onclick = async () => {
          const msg = document.getElementById('msg');
          const files = Array.from(document.getElementById('files').files || []);
          msg.textContent = 'Subiendo...';
          const documentos = [];
          for (const f of files) {
            documentos.push({ nombre:f.name, file_mime:f.type || 'application/octet-stream', file_size_kb:Math.round(f.size/1024), file_base64: await fileToBase64(f) });
          }
          const res = await fetch('${postUrl}', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ notas:document.getElementById('notas').value, documentos }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { msg.textContent = data.error || 'No se pudo enviar'; return; }
          document.body.querySelector('main').innerHTML = data.html || '<h1>Descarga registrada</h1><div class="ok">Gracias. Hemos recibido la confirmacion y los albaranes.</div>';
        };
      </script>
    `));
  } catch(e) { res.status(500).send(colaboradorPage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`)); }
});

router.post("/colaborador/descarga/:token", async (req, res) => {
  try {
    const data = await getColaboradorTokenData(req.params.token, "descarga");
    if (!data) return res.status(404).json({ error: "El enlace ha caducado o ya fue utilizado" });
    const notas = String(req.body.notas || "").trim();
    await db.query(`
      UPDATE pedidos
      SET estado='entregado',
          colaborador_descarga_confirmada_at=NOW(),
          fecha_entrega=COALESCE(fecha_entrega, CURRENT_DATE),
          notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(notas,''), $1))
      WHERE id=$2 AND empresa_id=$3
    `, [notas ? `DESCARGA COLABORADOR: ${notas}` : null, data.pedido_id, data.empresa_id]);
    const documentos = Array.isArray(req.body.documentos) ? req.body.documentos.slice(0, 8) : [];
    for (const doc of documentos) {
      if (!doc?.file_base64) continue;
      if (String(doc.file_base64).length > 5000000) continue;
      await db.query(
        `INSERT INTO pedido_docs (pedido_id,empresa_id,nombre,tipo,file_base64,file_mime,file_size_kb,notas)
         VALUES ($1,$2,$3,'Albaran',$4,$5,$6,$7)`,
        [data.pedido_id, data.empresa_id, doc.nombre || "Albaran colaborador", doc.file_base64, doc.file_mime || "application/pdf", doc.file_size_kb || null, "Subido por colaborador"]
      ).catch(e => logger.warn("No se pudo guardar albaran colaborador:", e.message));
    }
    await logPedidoEvento(data.pedido_id, data.empresa_id, "colaborador.descarga_confirmada", {
      notas: notas || null,
      documentos: documentos.length,
      documentos_meta: documentos.map((doc) => ({
        nombre: String(doc?.nombre || "Albaran colaborador").slice(0, 160),
        mime: String(doc?.file_mime || "application/octet-stream").slice(0, 80),
        size_kb: Number(doc?.file_size_kb || 0) || null,
      })),
    }, "colaborador");
    await crearFacturaBorradorPedido(data.pedido_id, data.empresa_id, null)
      .catch(e => logger.error("No se pudo crear factura borrador automatica:", e.message));
    await vincularAlbaranesAFacturaPedido(data.pedido_id, data.empresa_id);
    await crearFacturaRecibidaColaborador(data.pedido_id, data.empresa_id, null);
    await db.query("UPDATE colaborador_pedido_tokens SET usado_at=NOW() WHERE id=$1", [data.token_id]);
    res.json({
      ok: true,
      html: `<h1>Descarga registrada</h1><div class="ok">Gracias. Hemos recibido la confirmacion y los albaranes.</div>${renderColaboradorAcuseBox("Acuse de descarga registrada", data, { notas, documentos: documentos.length })}`
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/public/documento-control/:empresaId/:pedidoId", async (req, res) => {
  try {
    const empresaId = req.params.empresaId;
    const pedidoId = req.params.pedidoId;
    if (!verifyPublicToken({ empresaId, pedidoId, token: req.query.token })) {
      return res.status(403).send("Token no valido");
    }
    if (!verifyPublicVerificationCode({ empresaId, pedidoId, code: req.query.verify })) {
      return res.status(403).send("Codigo de verificacion no valido");
    }
    const archived = await getDocumentoControlRepositorioByPedido(pedidoId, empresaId).catch(() => null);
    const ctx = await getPedidoDocumentoControlContext(pedidoId, empresaId);
    if (!ctx?.pedido) return res.status(404).send("Pedido no encontrado");
    const isDownload = ["1", "true", "yes"].includes(String(req.query.download || "").toLowerCase());
    const isPrint = ["1", "true", "yes"].includes(String(req.query.print || "").toLowerCase());
    const wantsHtml = isPrint || ["html", "1", "true"].includes(String(req.query.html || req.query.format || "").toLowerCase());
    if (archived?.html || archived?.pdf_base64) {
      const publicExpired = archived.public_expires_at && new Date(archived.public_expires_at).getTime() < Date.now();
      if (archived.public_activo === false || publicExpired) {
        await logPedidoEvento(pedidoId, empresaId, "documento_control.publico_bloqueado", {
          source: "public_documento_control_repositorio",
          repositorio_id: archived.id,
          codigo_control: archived.codigo_control || null,
          public_activo: archived.public_activo,
          public_expires_at: archived.public_expires_at,
          motivo: archived.public_activo === false ? "desactivado" : "caducado",
          user_agent: String(req.get("user-agent") || "").slice(0, 180),
        }, "publico").catch(() => {});
        return res.status(410).send("La descarga publica del DeCA ya no esta activa. Solicita el documento a la empresa transportista.");
      }
      const eventoArchivado = isDownload ? "documento_control.descargado" : isPrint ? "documento_control.impreso" : "documento_control.consultado";
      await logPedidoEvento(pedidoId, empresaId, eventoArchivado, {
        source: "public_documento_control_repositorio",
        repositorio_id: archived.id,
        codigo_control: archived.codigo_control || null,
        archived: true,
        estado_repositorio: archived.estado,
        activo: archived.activo,
        print: isPrint,
        download: isDownload,
        user_agent: String(req.get("user-agent") || "").slice(0, 180),
      }, "publico");
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-DCD-Repository-State", archived.estado || "archivado");
      res.setHeader("X-DCD-Archived", "true");
      res.setHeader("X-DCD-Public-Expires-At", archived.public_expires_at || "");
      const expedienteData = await getPedidoDocumentoControlExpedienteData(pedidoId, empresaId);
      const livePayload = buildDocumentoControlPublicPayload(attachDocumentoControlAnexos(buildDocumentoControlPayload({
        empresaId,
        pedido: ctx.pedido,
        empresa: ctx.empresa,
        cliente: ctx.cliente,
        colaborador: ctx.colaborador,
        appBaseUrl: publicBaseUrl(req),
      }), expedienteData.documentos));
      if (!wantsHtml) {
        const pdf = await generateDocumentoControlPdf({
          documento: livePayload.documento,
          empresaNombre: ctx.empresa?.razon_social || ctx.empresa?.nombre || "TransGest TMS",
          generatedAt: new Date().toISOString(),
          publicView: true,
        });
        res.setHeader("Content-Disposition", `${isDownload ? "attachment" : "inline"}; filename="${pdf.filename}"`);
        res.setHeader("Content-Type", pdf.mime);
        return res.send(pdf.buffer);
      }
      if (isDownload) {
        res.setHeader("Content-Disposition", `attachment; filename="${archived.filename || "documento-control.html"}"`);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(await buildDocumentoControlHtml({
        documento: livePayload.documento,
        empresaNombre: ctx.empresa?.razon_social || ctx.empresa?.nombre || "TransGest TMS",
        generatedAt: new Date().toISOString(),
        autoPrint: isPrint,
        publicView: true,
      }));
    }
    const expedienteData = await getPedidoDocumentoControlExpedienteData(pedidoId, empresaId);
    const payload = buildDocumentoControlPublicPayload(attachDocumentoControlAnexos(buildDocumentoControlPayload({
      empresaId,
      pedido: ctx.pedido,
      empresa: ctx.empresa,
      cliente: ctx.cliente,
      colaborador: ctx.colaborador,
      appBaseUrl: publicBaseUrl(req),
    }), expedienteData.documentos));
    const eventoDcd = isDownload ? "documento_control.descargado" : isPrint ? "documento_control.impreso" : "documento_control.consultado";
    await logPedidoEvento(pedidoId, empresaId, eventoDcd, {
      source: "public_documento_control",
      codigo_control: payload.documento?.codigo_control || null,
      print: isPrint,
      download: isDownload,
      user_agent: String(req.get("user-agent") || "").slice(0, 180),
    }, "publico");
    if (isDownload) {
      res.setHeader("Content-Disposition", `attachment; filename="${buildDocumentoControlFilename(payload.documento)}"`);
    }
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "private, no-store");
    if (!wantsHtml) {
      const pdf = await generateDocumentoControlPdf({
        documento: payload.documento,
        empresaNombre: ctx.empresa?.razon_social || ctx.empresa?.nombre || "TransGest TMS",
        generatedAt: new Date().toISOString(),
        publicView: true,
      });
      res.setHeader("Content-Disposition", `${isDownload ? "attachment" : "inline"}; filename="${pdf.filename}"`);
      res.setHeader("Content-Type", pdf.mime);
      return res.send(pdf.buffer);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(await buildDocumentoControlHtml({
      documento: payload.documento,
      empresaNombre: ctx.empresa?.razon_social || ctx.empresa?.nombre || "TransGest TMS",
      generatedAt: new Date().toISOString(),
      autoPrint: isPrint,
      publicView: true,
    }));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

router.use(authenticate);

function getMissingColumn(error) {
  if (!error || error.code !== "42703") return null;
  const match = /column "([^"]+)"/i.exec(error.message || "");
  return match?.[1] || null;
}

const NUMERIC_PEDIDO_FIELDS = new Set([
  "peso_kg", "bultos", "importe", "km_ruta", "km_vacio", "volumen", "metros_lineales",
  "cantidad", "precio_unitario", "extracostes_importe",
  "tipo_iva",
  "km_vacio_enlace",
  "precio_base_sin_combustible", "recargo_combustible_pct", "importe_revision_combustible",
  "precio_cliente_col", "precio_colaborador", "precio_colaborador_unitario", "minimo_colaborador_unidades", "reparto_chofer1",
  "coste_gasoil", "coste_peajes", "coste_dietas", "coste_otros",
  "importe_minimo", "minimo_unidades", "importe_paralizacion",
  "paralizacion_horas", "grupaje_id",
]);
const UUID_PEDIDO_FIELDS = new Set([
  "cliente_id", "ruta_id", "vehiculo_id", "chofer_id", "chofer2_id",
  "colaborador_id", "remolque_id", "viaje_enlazado_id", "grupo_ida_vuelta",
]);

function normalizePedidoUuid(value) {
  if (value === "" || value === null || value === undefined) return null;
  const raw = String(value).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

function parseLocaleNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value).trim().replace(/\s+/g, "");
  if (!raw) return null;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (hasComma) raw = raw.replace(",", ".");
  else if (hasDot && /^\d{1,3}(\.\d{3}){2,}$/.test(raw)) raw = raw.replace(/\./g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizePaisPedido(value, fallback = "España") {
  const raw = String(value || fallback || "").trim();
  if (!raw) return fallback;
  const ascii = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (["espana", "spain", "es"].includes(ascii)) return "España";
  return raw;
}

function cmrTipoPedido(origenPais = "España", destinoPais = "España", explicit = null) {
  const requested = String(explicit || "").trim().toLowerCase();
  if (requested === "internacional" || requested === "nacional") return requested;
  const origen = normalizePaisPedido(origenPais);
  const destino = normalizePaisPedido(destinoPais);
  return shouldUseInternationalCmr(origen, destino) ? "internacional" : "nacional";
}

function normalizePaisKeyPedido(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const EU_CMR_COUNTRY_KEYS = new Set([
  "espana", "spain", "es",
  "alemania", "germany", "deutschland",
  "austria",
  "belgica", "belgium", "belgique",
  "bulgaria",
  "chipre", "cyprus",
  "croacia", "croatia",
  "dinamarca", "denmark",
  "eslovaquia", "slovakia",
  "eslovenia", "slovenia",
  "estonia",
  "finlandia", "finland",
  "francia", "france",
  "grecia", "greece",
  "hungria", "hungary",
  "irlanda", "ireland",
  "italia", "italy",
  "letonia", "latvia",
  "lituania", "lithuania",
  "luxemburgo", "luxembourg",
  "malta",
  "paises bajos", "netherlands", "holanda",
  "polonia", "poland",
  "portugal",
  "republica checa", "chequia", "czech republic", "czechia",
  "rumania", "romania",
  "suecia", "sweden",
]);

function isSpainPaisPedido(value = "") {
  const key = normalizePaisKeyPedido(value);
  return !key || ["espana", "spain", "es"].includes(key);
}

function isEuCmrPaisPedido(value = "") {
  return EU_CMR_COUNTRY_KEYS.has(normalizePaisKeyPedido(value));
}

function shouldUseInternationalCmr(origenPais = "España", destinoPais = "España") {
  return [origenPais, destinoPais].some(country => !isSpainPaisPedido(country) && isEuCmrPaisPedido(country));
}

function normalizePedidoValue(field, value) {
  if (value === "") return null;
  if (UUID_PEDIDO_FIELDS.has(field)) return normalizePedidoUuid(value);
  if (PEDIDO_DATE_FIELDS.has(field)) return normalizePedidoDate(value);
  if (!NUMERIC_PEDIDO_FIELDS.has(field) || value === null || value === undefined) return value;
  let normalizedValue = value;
  if (typeof normalizedValue === "string") {
    normalizedValue = normalizedValue.trim().replace(/\s+/g, "");
    if (field === "peso_kg") {
      const parsed = parseLocaleNumber(normalizedValue);
      if ((normalizedValue.includes(",") || normalizedValue.includes(".")) && Number.isFinite(parsed) && parsed > 0 && parsed < 1000) return Math.round(parsed * 1000);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  const n = parseLocaleNumber(normalizedValue);
  if (field === "bultos") return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
  return Number.isFinite(n) ? n : null;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const n = parseLocaleNumber(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function roundMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function sumAdditionalDescargaPrices(stops) {
  return normalizePedidoJsonList(stops)
    .slice(1)
    .reduce((total, stop) => {
      const n = parseLocaleNumber(stop?.precio ?? stop?.importe ?? stop?.precio_cliente);
      return total + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
}

function normalizePedidoTarifaFields(fieldMap = {}) {
  const next = { ...fieldMap };
  const tipo = String(next.tipo_precio || "viaje").trim().toLowerCase();
  if (tipo !== "tonelada") return next;

  const minUnits = parseLocaleNumber(next.minimo_unidades);
  if (Number.isFinite(minUnits) && Math.abs(minUnits) >= 1000) {
    next.minimo_unidades = Number((minUnits / 1000).toFixed(3));
  }
  const minColUnits = parseLocaleNumber(next.minimo_colaborador_unidades);
  if (Number.isFinite(minColUnits) && Math.abs(minColUnits) >= 1000) {
    next.minimo_colaborador_unidades = Number((minColUnits / 1000).toFixed(3));
  }

  const cantidad = parseLocaleNumber(next.cantidad);
  const pesoKg = parseLocaleNumber(next.peso_kg);
  if (Number.isFinite(pesoKg) && pesoKg > 0) {
    const toneladas = pesoKg < 1000 ? pesoKg : Number((pesoKg / 1000).toFixed(3));
    if (!Number.isFinite(cantidad) || cantidad <= 0 || (cantidad < 1 && pesoKg >= 1000)) {
      next.cantidad = toneladas;
    }
  }

  return next;
}

const PEDIDO_TARIFA_CALC_FIELDS = new Set([
  "tipo_precio",
  "cantidad",
  "precio_unitario",
  "extracostes",
  "extracostes_importe",
  "importe_minimo",
  "minimo_unidades",
  "peso_kg",
  "puntos_carga",
  "puntos_descarga",
]);

function hasPedidoTarifaCalcInput(source = {}) {
  return Object.keys(source || {}).some(key => PEDIDO_TARIFA_CALC_FIELDS.has(key));
}

function calcPedidoImporteCanonical(payload = {}) {
  const tipo = String(payload.tipo_precio || "viaje").trim().toLowerCase();
  const precio = parseLocaleNumber(payload.precio_unitario);
  if (!Number.isFinite(precio) || precio < 0) return null;
  const cantidadRaw = parseLocaleNumber(payload.cantidad);
  const extra = Math.max(0, parseLocaleNumber(payload.extracostes_importe ?? payload.extracostes) || 0);
  const descargasExtra = sumAdditionalDescargaPrices(payload.puntos_descarga);
  const cargasExtra = sumAdditionalDescargaPrices(payload.puntos_carga);
  const stopsExtra = descargasExtra + cargasExtra;
  const minEur = Math.max(0, parseLocaleNumber(payload.importe_minimo) || 0);
  const minUnits = Math.max(0, parseLocaleNumber(payload.minimo_unidades) || 0);
  let cantidad = Number.isFinite(cantidadRaw) ? cantidadRaw : 0;
  if (tipo === "viaje") {
    return roundMoney(Math.max(precio, minEur) + extra + stopsExtra);
  }
  cantidad = Math.max(cantidad, minUnits);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
  const base = tipo === "kg" ? (cantidad / 100) * precio : cantidad * precio;
  return roundMoney(base + extra + stopsExtra);
}

function normalizeAiText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\r/g, "\n");
}

function pickAiMatch(text, patterns = []) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return String(match[1]).replace(/\s+/g, " ").trim();
  }
  return "";
}

function normalizeAiDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const es = raw.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/);
  if (es) {
    const year = es[3] ? (String(es[3]).length === 2 ? `20${es[3]}` : es[3]) : String(new Date().getFullYear());
    return `${year}-${String(es[2]).padStart(2, "0")}-${String(es[1]).padStart(2, "0")}`;
  }
  return "";
}

function cleanAiDocumentText(text = "") {
  return String(text || "")
    .replace(/\0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeAiAttachmentBase64(base64 = "") {
  try {
    const clean = String(base64 || "").replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
    if (!clean || clean.length > 10_000_000) return null;
    return Buffer.from(clean, "base64");
  } catch {
    return null;
  }
}

function extractPdfTextHeuristic(raw = "") {
  const chunks = [];
  String(raw || "").replace(/\(([^()]{2,500})\)\s*Tj/g, (_, value) => {
    chunks.push(value.replace(/\\([()\\])/g, "$1"));
    return "";
  });
  String(raw || "").replace(/\[((?:\([^()]{1,300}\)\s*){1,80})\]\s*TJ/g, (_, group) => {
    const line = [];
    group.replace(/\(([^()]{1,300})\)/g, (_m, value) => {
      line.push(value.replace(/\\([()\\])/g, "$1"));
      return "";
    });
    if (line.join("").trim()) chunks.push(line.join(""));
    return "";
  });
  const visible = chunks.join("\n");
  const fallback = String(raw || "").replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ");
  return cleanAiDocumentText(visible.length > 80 ? visible : fallback.slice(0, 14000));
}

function parseZipEntries(buffer) {
  const entries = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < 30) return entries;
  for (let offset = 0; offset < buffer.length - 30;) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length || fileNameLength <= 0) break;
    const name = buffer.slice(nameStart, nameStart + fileNameLength).toString("utf8");
    const raw = buffer.slice(dataStart, dataEnd);
    let data = Buffer.alloc(0);
    try {
      if (method === 0) data = raw;
      else if (method === 8) data = zlib.inflateRawSync(raw);
    } catch {
      data = Buffer.alloc(0);
    }
    entries.push({ name, data });
    offset = dataEnd;
  }
  return entries;
}

function xmlToPlainText(xml = "") {
  return cleanAiDocumentText(
    String(xml || "")
      .replace(/<w:tab\/>/g, " ")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/row>|<\/x:row>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
  );
}

function extractOfficeZipText(buffer, name = "") {
  const lower = String(name || "").toLowerCase();
  const entries = parseZipEntries(buffer);
  if (!entries.length) return "";
  const wanted = lower.endsWith(".xlsx")
    ? entries.filter(e => /xl\/sharedStrings\.xml$|xl\/worksheets\/sheet\d+\.xml$/i.test(e.name))
    : entries.filter(e => /word\/document\.xml$|word\/header\d+\.xml$|word\/footer\d+\.xml$/i.test(e.name));
  return cleanAiDocumentText(wanted.map(e => xmlToPlainText(e.data.toString("utf8"))).filter(Boolean).join("\n")).slice(0, 16000);
}

async function extractAiAttachmentText(attachment = {}) {
  const buffer = decodeAiAttachmentBase64(attachment.base64);
  if (!buffer) return "";
  const name = String(attachment.name || attachment.filename || "").toLowerCase();
  const mediaType = String(attachment.mediaType || attachment.type || "").toLowerCase();
  if (mediaType.includes("pdf") || name.endsWith(".pdf")) {
    try {
      const parsed = await pdfParse(buffer, { max: 40 });
      const text = cleanAiDocumentText(parsed?.text || "").slice(0, 16000);
      if (text.length >= 40) return text;
    } catch (error) {
      logger.warn(`No se pudo extraer texto PDF con el parser principal (${name || "documento"}): ${error.message}`);
    }
    return extractPdfTextHeuristic(buffer.toString("latin1"));
  }
  if (name.endsWith(".docx") || name.endsWith(".xlsx") || mediaType.includes("officedocument")) return extractOfficeZipText(buffer, name);
  if (/(\.txt|\.md|\.json|\.eml|\.csv|\.tsv|\.xml|\.html?)$/i.test(name) || mediaType.startsWith("text/") || mediaType.includes("message") || mediaType.includes("json") || mediaType.includes("xml")) {
    return cleanAiDocumentText(buffer.toString("utf8")).slice(0, 16000);
  }
  return "";
}

function extractAiNumber(text = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (!match) continue;
    const value = parseLocaleNumber(match[1] || match[2] || "");
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function extractAiMinimumUnits(text = "", tipoPrecio = "") {
  const match = String(text || "").match(/\bmin(?:imo|\.?)\s*(?:facturable)?\s*[:#-]?\s*(\d+(?:[,.]\d+)?)\s*(tn|ton|toneladas|t|kg|km|palets|pales|pallets|plt)?\b/i);
  if (!match) return null;
  let value = parseLocaleNumber(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = String(match[2] || "").toLowerCase();
  if (tipoPrecio === "tonelada" && unit === "kg") value = value / 1000;
  return Number(value.toFixed(3));
}

function extractAiReference(clean = "", lineValue = () => "") {
  return lineValue("referencia|ref|orden|pedido cliente|order|order no|booking|po|subject|asunto") || pickAiMatch(clean, [
    /\b(?:ref\.?|referencia|orden|booking|po|pedido|order(?:\s+no\.?)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,40})/i,
    /\b(?:subject|asunto)\s*[:#-]\s*([^\n]{3,80})/i,
  ]);
}

function extractAiJsonPayload(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  try { return JSON.parse(candidate); } catch { return null; }
}

function aiTextFromProviderResponse(provider, data = {}) {
  if (provider === "openai" || provider === "ai_generic") {
    if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
    if (data?.output_text) return data.output_text;
    return Array.isArray(data?.output)
      ? data.output.flatMap(item => Array.isArray(item?.content) ? item.content : [])
          .map(item => item?.text || item?.output_text || "")
          .filter(Boolean)
          .join("\n")
      : "";
  }
  return Array.isArray(data?.content)
    ? data.content.map(x => x?.text || "").join("\n")
    : (data?.completion || data?.text || "");
}

async function getPedidoAiRuntimeConfig(empresaId) {
  const providerRaw = String(await getGlobalSetting("ia_provider", process.env.AI_PROVIDER || "anthropic") || "anthropic").toLowerCase();
  const provider = ["anthropic", "openai", "ai_generic"].includes(providerRaw) ? providerRaw : "anthropic";
  const baseUrl = String(await getGlobalSetting("ia_base_url", process.env.AI_BASE_URL || "") || "").replace(/\/$/, "");
  const configuredModel = String(await getGlobalSetting("ia_model", process.env.AI_MODEL || "") || "").trim();
  const keyInfo = await resolveBestApiKey(empresaId, provider, ["openai", "ai_generic", "anthropic"]);
  const resolvedProvider = keyInfo.provider || provider;
  let model = resolvedProvider === provider ? configuredModel : "";
  if (resolvedProvider === "openai") {
    model = model.toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
    if (/^gpt-5(?:\.\d+)+-mini$/.test(model)) model = "gpt-5-mini";
  }
  return { provider: resolvedProvider, baseUrl, model, configuredModel, apiKey: keyInfo.key || "", source: keyInfo.source };
}

function buildAiPedidoExtractionPrompt(texto = "") {
  return `Eres un asistente de trafico para un TMS de transporte por carretera en Espana.
Extrae los datos de una orden de transporte, email, PDF o imagen. Devuelve SOLO JSON valido, sin markdown.

Campos esperados:
{
  "cliente_nombre": string|null,
  "origen": string|null,
  "destino": string|null,
  "fecha_carga": "YYYY-MM-DD"|null,
  "hora_carga": "HH:MM"|null,
  "fecha_descarga": "YYYY-MM-DD"|null,
  "hora_descarga": "HH:MM"|null,
  "mercancia": string|null,
  "peso_kg": number|null,
  "bultos": number|null,
  "tipo_precio": "viaje"|"tonelada"|"km"|"palet"|"kg"|"hora"|null,
  "precio_unitario": number|null,
  "cantidad": number|null,
  "minimo_unidades": number|null,
  "importe_minimo": number|null,
  "importe": number|null,
  "referencia_cliente": string|null,
  "matricula_detectada": string|null,
  "notas_detectadas": string|null
}

Reglas:
- Si ves toneladas como 25,6 t o 25.6 t, devuelve peso_kg=25600 y cantidad=25.6 si la tarifa es por tonelada.
- Si ves precio por tonelada, usa tipo_precio="tonelada" y precio_unitario como EUR/tonelada.
- Si hay minimo facturable por toneladas, pon minimo_unidades en toneladas.
- En un "Pedido a proveedor" de transporte, cliente_nombre es la empresa que emite/solicita el pedido, no la empresa transportista que lo recibe como proveedor.
- Una expresion de ruta como "SAN MIGUEL DE SALINAS A MADRID" significa origen SAN MIGUEL DE SALINAS y destino MADRID.
- Para el precio del viaje usa la base/importe del servicio de transporte sin IVA, no el total con impuestos.
- No inventes datos. Usa null si no esta claro.

Texto disponible:
${String(texto || "").slice(0, 12000)}`;
}

function buildOpenAiPedidoContent(prompt, attachments = []) {
  const content = [{ type: "text", text: prompt }];
  for (const a of attachments) {
    if (!a.base64 || !String(a.mediaType || "").startsWith("image/")) continue;
    content.push({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.base64}` } });
  }
  return content;
}

function buildOpenAiResponsesPedidoContent(prompt, attachments = []) {
  const content = [{ type: "input_text", text: prompt }];
  for (const attachment of attachments) {
    if (!attachment.base64) continue;
    const mediaType = String(attachment.mediaType || "application/octet-stream").toLowerCase();
    if (mediaType.startsWith("image/")) {
      content.push({
        type: "input_image",
        image_url: `data:${mediaType};base64,${attachment.base64}`,
        detail: "high",
      });
      continue;
    }
    content.push({
      type: "input_file",
      filename: String(attachment.name || "documento").slice(0, 180),
      file_data: `data:${mediaType};base64,${attachment.base64}`,
      ...(mediaType === "application/pdf" ? { detail: "high" } : {}),
    });
  }
  return content;
}

function isOpenAiPedidoFileSupported(attachment = {}) {
  const name = String(attachment.name || attachment.filename || "").toLowerCase();
  const mediaType = String(attachment.mediaType || attachment.type || "").toLowerCase();
  if (mediaType.startsWith("image/")) return true;
  if (/\.(pdf|txt|md|json|html?|xml|doc|docx|rtf|odt|ppt|pptx|csv|tsv|xls|xlsx)$/i.test(name)) return true;
  return mediaType.includes("pdf")
    || mediaType.startsWith("text/")
    || mediaType.includes("word")
    || mediaType.includes("officedocument")
    || mediaType.includes("spreadsheet")
    || mediaType.includes("presentation")
    || mediaType.includes("excel")
    || mediaType.includes("rtf")
    || mediaType.includes("opendocument")
    || mediaType.includes("json")
    || mediaType.includes("xml");
}

async function fetchPedidoAi(url, options, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("El proveedor de IA ha superado el tiempo maximo de respuesta");
      timeoutError.code = "AI_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isOpenAiModelAvailabilityError(status, data = {}) {
  const code = String(data?.error?.code || "").toLowerCase();
  const message = String(data?.error?.message || data?.message || "").toLowerCase();
  return [400, 403, 404].includes(Number(status)) && (
    code.includes("model") || message.includes("model") || message.includes("access") || message.includes("not exist")
  );
}

function buildAnthropicPedidoContent(prompt, attachments = []) {
  const content = [{ type: "text", text: prompt }];
  for (const a of attachments) {
    if (!a.base64) continue;
    const mediaType = String(a.mediaType || "application/octet-stream");
    if (mediaType.startsWith("image/")) {
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: a.base64 } });
    } else if (mediaType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: mediaType, data: a.base64 } });
    }
  }
  return content;
}

async function callPedidoDocumentAi({ empresaId, texto, attachments = [] }) {
  const iaConfig = await getPedidoAiRuntimeConfig(empresaId);
  if (!iaConfig.apiKey) return { used: false, reason: "sin_api_key", provider: iaConfig.provider };

  const aiFiles = attachments.filter(a => {
    const mediaType = String(a.mediaType || "");
    if (!a.base64 || String(a.base64).length > 9_500_000) return false;
    if (mediaType.startsWith("image/")) return true;
    if (iaConfig.provider === "openai") return isOpenAiPedidoFileSupported(a);
    return iaConfig.provider === "anthropic" && mediaType === "application/pdf";
  });
  if (!aiFiles.length && !String(texto || "").trim()) return { used: false, reason: "sin_contenido_visual", provider: iaConfig.provider };

  await assertApiUsageAllowed(empresaId, iaConfig.provider);
  const prompt = buildAiPedidoExtractionPrompt(texto);

  let response;
  let modelUsed = iaConfig.model;
  let recoveredFromModel = "";
  if (iaConfig.provider === "openai") {
    const baseUrl = "https://api.openai.com/v1";
    const requestOpenAi = model => fetchPedidoAi(`${baseUrl}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${iaConfig.apiKey}` },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: buildOpenAiResponsesPedidoContent(prompt, aiFiles) }],
        max_output_tokens: 1400,
      }),
    });
    modelUsed = iaConfig.model || "gpt-5-mini";
    response = await requestOpenAi(modelUsed);
    const fallbackModels = ["gpt-5-mini", "gpt-4o-mini"].filter(model => model !== modelUsed);
    while (!response.ok) {
      const firstError = await response.json().catch(() => ({}));
      if (!isOpenAiModelAvailabilityError(response.status, firstError) || !fallbackModels.length) {
        const err = new Error(firstError?.error?.message || firstError?.message || `IA respondio HTTP ${response.status}`);
        err.status = response.status;
        throw err;
      }
      if (!recoveredFromModel) recoveredFromModel = modelUsed;
      modelUsed = fallbackModels.shift();
      response = await requestOpenAi(modelUsed);
    }
  } else if (iaConfig.provider === "ai_generic") {
    const baseUrl = iaConfig.baseUrl || "https://api.openai.com/v1";
    response = await fetchPedidoAi(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${iaConfig.apiKey}` },
      body: JSON.stringify({
        model: iaConfig.model || "gpt-4o-mini",
        messages: [{ role: "user", content: buildOpenAiPedidoContent(prompt, aiFiles) }],
        max_tokens: 1200,
        temperature: 0,
      }),
    });
  } else {
    modelUsed = iaConfig.model || "claude-sonnet-4-20250514";
    response = await fetchPedidoAi("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": iaConfig.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: iaConfig.model || "claude-sonnet-4-20250514",
        max_tokens: 1200,
        temperature: 0,
        messages: [{ role: "user", content: buildAnthropicPedidoContent(prompt, aiFiles) }],
      }),
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || data?.message || `IA respondio HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  await recordApiUsage(empresaId, iaConfig.provider, 1).catch(() => {});
  const parsed = extractAiJsonPayload(aiTextFromProviderResponse(iaConfig.provider, data));
  return {
    used: true,
    provider: iaConfig.provider,
    model: modelUsed,
    recoveredFromModel,
    parsed,
    raw_text: parsed ? "" : aiTextFromProviderResponse(iaConfig.provider, data).slice(0, 2000),
  };
}

function mergeAiDraftFields(draft = {}, ai = {}) {
  if (!ai || typeof ai !== "object") return draft;
  const next = { ...draft };
  const setIf = (key, value, transform = v => v) => {
    if (value === null || value === undefined || value === "") return;
    if (next[key] === null || next[key] === undefined || next[key] === "") next[key] = transform(value);
  };
  setIf("cliente_nombre", ai.cliente_nombre);
  setIf("origen", ai.origen, v => String(v).toUpperCase());
  setIf("destino", ai.destino, v => String(v).toUpperCase());
  setIf("fecha_carga", normalizeAiDate(ai.fecha_carga));
  setIf("hora_carga", normalizePedidoTime(ai.hora_carga));
  setIf("fecha_descarga", normalizeAiDate(ai.fecha_descarga));
  setIf("hora_descarga", normalizePedidoTime(ai.hora_descarga));
  setIf("mercancia", ai.mercancia);
  setIf("referencia_cliente", ai.referencia_cliente);
  setIf("matricula_detectada", ai.matricula_detectada, v => String(v).toUpperCase().replace(/\s+/g, "-"));
  for (const key of ["peso_kg", "bultos", "precio_unitario", "cantidad", "minimo_unidades", "importe_minimo", "importe"]) {
    const n = parseLocaleNumber(ai[key]);
    if (Number.isFinite(n) && n > 0 && !(Number.isFinite(parseLocaleNumber(next[key])) && parseLocaleNumber(next[key]) > 0)) next[key] = key === "bultos" ? Math.round(n) : n;
  }
  if (ai.tipo_precio && (!next.tipo_precio || next.tipo_precio === "viaje")) next.tipo_precio = String(ai.tipo_precio).toLowerCase();
  if (next.tipo_precio === "tonelada" && Number.isFinite(parseLocaleNumber(next.peso_kg)) && !Number.isFinite(parseLocaleNumber(next.cantidad))) {
    next.cantidad = Number((parseLocaleNumber(next.peso_kg) / 1000).toFixed(3));
  }
  const importeCanonico = calcPedidoImporteCanonical(next);
  if (importeCanonico !== null) next.importe = importeCanonico;
  if (next.origen && !next.puntos_carga?.length) next.puntos_carga = [{ direccion: next.origen, fecha: next.fecha_carga || "", hora: next.hora_carga || "", tipo: "carga" }];
  if (next.destino && !next.puntos_descarga?.length) next.puntos_descarga = [{ direccion: next.destino, fecha: next.fecha_descarga || "", hora: next.hora_descarga || "", tipo: "descarga" }];
  if (ai.notas_detectadas) next.notas = [next.notas, `IA visual: ${ai.notas_detectadas}`].filter(Boolean).join("\n\n").slice(0, 1400);
  next._ia_visual_detectada = true;
  return next;
}

function extractSupplierOrderHints(text = "") {
  const clean = cleanAiDocumentText(text);
  if (!/pedido\s+a\s+proveedor/i.test(clean)) return {};
  const lines = clean.split("\n").map(line => line.trim()).filter(Boolean);
  const titleIndex = lines.findIndex(line => /pedido\s+a\s+proveedor/i.test(line));
  const companyPattern = /\b(?:S\.?\s*L\.?\s*U?\.?|S\.?\s*A\.?\s*U?\.?|SOCIEDAD\s+LIMITADA|SOCIEDAD\s+ANONIMA)\b/i;
  const clienteNombre = lines.slice(Math.max(0, titleIndex + 1), titleIndex + 9)
    .find(line => companyPattern.test(line) && line.length <= 120) || "";
  const routeLine = lines.find(line => (
    line.length >= 7 && line.length <= 140 &&
    /^[A-ZÁÉÍÓÚÜÑ0-9 .,'()\/-]+\s+A\s+[A-ZÁÉÍÓÚÜÑ0-9 .,'()\/-]+$/i.test(line) &&
    !/transferencia|forma de pago|proveedor/i.test(line)
  )) || "";
  const routeMatch = routeLine.match(/^(.+?)\s+A\s+(.+)$/i);
  const fecha = normalizeAiDate(clean.match(/\d{1,2}[/-]\d{1,2}[/-]20\d{2}/)?.[0] || "");
  const transportLine = lines.find(line => /transporte/i.test(line) && /\d/.test(line)) || "";
  const priceMatch = transportLine.match(/\b1[,.]00\s*(\d{2,6}[,.]\d{2,4})/i)
    || transportLine.match(/(\d{2,6}[,.]\d{2})\s*$/);
  const price = parseLocaleNumber(priceMatch?.[1]);
  const description = transportLine
    .replace(/^\d{5,}\s*/, "")
    .replace(/\s+1[,.]00[\s\d,.-]*$/, "")
    .trim();
  return {
    cliente_nombre: clienteNombre,
    origen: routeMatch?.[1]?.trim() || "",
    destino: routeMatch?.[2]?.trim() || "",
    fecha_carga: fecha,
    mercancia: description || "Servicio de transporte",
    precio_unitario: Number.isFinite(price) && price > 0 ? price : null,
    importe: Number.isFinite(price) && price > 0 ? price : null,
  };
}

function extractAiPedidoDraft(text = "") {
  const raw = String(text || "");
  const clean = normalizeAiText(raw);
  const lower = clean.toLowerCase();
  const supplierOrder = extractSupplierOrderHints(clean);
  const lineValue = label => {
    const rx = new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:\\-]\\s*([^\\n]+)`, "i");
    const m = clean.match(rx);
    return m?.[1]?.trim() || "";
  };
  const clienteNombre = lineValue("cliente|cargador|empresa|customer|shipper|from|de") || supplierOrder.cliente_nombre || pickAiMatch(clean, [
    /\bcliente\s+(?:es\s+)?([A-ZÁÉÍÓÚÜÑ0-9][^\n,;]{2,80})/i,
  ]);
  const origen = lineValue("origen|carga|recogida|lugar de carga|loading|pickup|pick up|load address") || supplierOrder.origen || pickAiMatch(clean, [
    /\b(?:carga|recogida|origen)\s+(?:en|desde)?\s*([A-ZÁÉÍÓÚÜÑ0-9][^\n;,.]{2,90})/i,
    /\bdesde\s+([A-ZÁÉÍÓÚÜÑ0-9][^\n;,.]{2,90})/i,
  ]);
  const destino = lineValue("destino|descarga|entrega|lugar de descarga|unloading|delivery|deliver to|delivery address") || supplierOrder.destino || pickAiMatch(clean, [
    /\b(?:descarga|entrega|destino)\s+(?:en|a)?\s*([A-ZÁÉÍÓÚÜÑ0-9][^\n;,.]{2,90})/i,
    /\bhasta\s+([A-ZÁÉÍÓÚÜÑ0-9][^\n;,.]{2,90})/i,
  ]);
  const fechaCargaRaw = lineValue("fecha carga|fecha de carga|carga dia|fecha|pickup date|loading date|load date") || supplierOrder.fecha_carga;
  const fechaDescargaRaw = lineValue("fecha descarga|fecha de descarga|entrega dia|descarga dia|delivery date|unloading date");
  const anyDate = pickAiMatch(clean, [/\b(?:dia|fecha)\s+(\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?)/i]);
  const horaCarga = normalizePedidoTime(lineValue("hora carga|hora de carga|ventana carga|pickup time|loading time") || pickAiMatch(clean, [/\b(?:carga|recogida|loading|pickup)[^\n]{0,50}\b(\d{1,2}[:.]\d{2})\b/i]));
  const horaDescarga = normalizePedidoTime(lineValue("hora descarga|hora de descarga|hora entrega|ventana descarga|delivery time|unloading time") || pickAiMatch(clean, [/\b(?:descarga|entrega|delivery|unloading)[^\n]{0,50}\b(\d{1,2}[:.]\d{2})\b/i]));
  const mercancia = lineValue("mercancia|mercancia / notas|producto|goods|commodity|description|carga") || supplierOrder.mercancia || pickAiMatch(clean, [
    /\bmercancia\s+(?:de\s+)?([^\n;.]{3,120})/i,
  ]);
  const referencia = extractAiReference(clean, lineValue);
  const pesoTon = lower.match(/\b(\d+(?:[,.]\d+)?)\s*(?:tn|ton|toneladas|t)\b/);
  const pesoKg = lower.match(/\b(\d{2,6}(?:[,.]\d+)?)\s*(?:kg|kilos)\b/);
  const palets = lower.match(/\b(\d{1,4})\s*(?:palets|pales|pallets|pallet|plt)\b/);
  const importeRaw = lineValue("importe|precio|tarifa|rate|price|amount") || pickAiMatch(clean, [
    /\b(?:importe|precio|tarifa|porte)\s*[:#-]?\s*(\d+(?:[,.]\d{1,2})?)\s*(?:eur|€)?/i,
    /(\d+(?:[,.]\d{1,2})?)\s*(?:eur|€)\b/i,
  ]);
  const matricula = pickAiMatch(clean, [
    /\b(?:matricula|camion|tractora)\s*[:#-]?\s*([0-9]{4}[ -]?[A-Z]{3}|[A-Z]{1,3}[ -]?[0-9]{3,5}[ -]?[A-Z]{0,3})\b/i,
  ]).toUpperCase().replace(/\s+/g, "-");
  const pesoKgValue = pesoTon
    ? Math.round((parseLocaleNumber(pesoTon[1]) || 0) * 1000)
    : (pesoKg ? parseLocaleNumber(pesoKg[1]) : null);
  const importeNumberRaw = String(importeRaw || "").match(/(\d+(?:[,.]\d{1,2})?)/)?.[1] || "";
  const importe = supplierOrder.importe ?? parseLocaleNumber(importeRaw) ?? parseLocaleNumber(importeNumberRaw);
  const toneladas = Number.isFinite(pesoKgValue) && pesoKgValue > 0
    ? Number((pesoKgValue / 1000).toFixed(3))
    : null;
  const kmDetectado = extractAiNumber(clean, [
    /\b(\d+(?:[,.]\d+)?)\s*km\b/i,
    /\b(?:km|kilometros|distance)\s*[:#-]?\s*(\d+(?:[,.]\d+)?)/i,
  ]);
  const precioTon = extractAiNumber(clean, [
    /(\d+(?:[,.]\d+)?)\s*(?:eur|€|â‚¬)?\s*(?:\/|\s*(?:por|x)\s*)\s*(?:tn|ton|tonelada|toneladas|t)\b/i,
    /\b(?:precio|tarifa|rate)[^\n]{0,35}(?:tn|ton|tonelada|toneladas)[^\n]{0,20}(\d+(?:[,.]\d+)?)/i,
  ]);
  const precioKm = extractAiNumber(clean, [
    /(\d+(?:[,.]\d+)?)\s*(?:eur|€|â‚¬)?\s*(?:\/|\s*(?:por|x)\s*)\s*km\b/i,
    /\b(?:precio|tarifa|rate)[^\n]{0,35}km[^\n]{0,20}(\d+(?:[,.]\d+)?)/i,
  ]);
  const precioPalet = extractAiNumber(clean, [
    /(\d+(?:[,.]\d+)?)\s*(?:eur|€|â‚¬)?\s*(?:\/|\s*(?:por|x)\s*)\s*(?:palet|pallet|plt)\b/i,
  ]);
  let tipoPrecio = "viaje";
  let precioUnitario = importe || supplierOrder.precio_unitario || null;
  let cantidad = null;
  let minimoUnidades = null;
  let tarifaUnitariaDetectada = false;
  if (Number.isFinite(precioTon) && precioTon > 0) {
    tipoPrecio = "tonelada";
    precioUnitario = precioTon;
    cantidad = toneladas;
    minimoUnidades = extractAiMinimumUnits(clean, tipoPrecio);
    tarifaUnitariaDetectada = true;
  } else if (Number.isFinite(precioKm) && precioKm > 0) {
    tipoPrecio = "km";
    precioUnitario = precioKm;
    cantidad = kmDetectado;
    minimoUnidades = extractAiMinimumUnits(clean, tipoPrecio);
    tarifaUnitariaDetectada = true;
  } else if (Number.isFinite(precioPalet) && precioPalet > 0) {
    tipoPrecio = "palet";
    precioUnitario = precioPalet;
    cantidad = palets ? Number(palets[1]) : null;
    minimoUnidades = extractAiMinimumUnits(clean, tipoPrecio);
    tarifaUnitariaDetectada = true;
  }
  const importeCalculado = calcPedidoImporteCanonical({
    tipo_precio: tipoPrecio,
    precio_unitario: precioUnitario,
    cantidad,
    minimo_unidades: minimoUnidades,
    peso_kg: pesoKgValue,
  });
  const draft = {
    cliente_nombre: clienteNombre,
    origen: origen ? origen.toUpperCase() : "",
    destino: destino ? destino.toUpperCase() : "",
    fecha_carga: normalizeAiDate(fechaCargaRaw || anyDate),
    hora_carga: horaCarga || "",
    fecha_descarga: normalizeAiDate(fechaDescargaRaw),
    hora_descarga: horaDescarga || "",
    mercancia,
    peso_kg: pesoKgValue || null,
    bultos: palets ? Number(palets[1]) : null,
    importe: importeCalculado || importe || null,
    precio_unitario: precioUnitario || null,
    tipo_precio: tipoPrecio,
    cantidad: cantidad || null,
    km_ruta: kmDetectado || null,
    minimo_unidades: tipoPrecio !== "viaje" ? (minimoUnidades || null) : null,
    referencia_cliente: referencia,
    matricula_detectada: matricula || "",
    notas: raw.slice(0, 1200),
    _tarifa_unitaria_detectada: tarifaUnitariaDetectada,
    pendiente_completar: true,
    aviso_completar: "Borrador generado desde Bandeja IA: revisar campos, tarifa, asignacion y documentos antes de confirmar.",
    puntos_carga: origen ? [{ direccion: origen.toUpperCase(), fecha: normalizeAiDate(fechaCargaRaw || anyDate), hora: horaCarga || "", tipo: "carga" }] : [],
    puntos_descarga: destino ? [{ direccion: destino.toUpperCase(), fecha: normalizeAiDate(fechaDescargaRaw), hora: horaDescarga || "", tipo: "descarga" }] : [],
  };
  return draft;
}

function aiCompletenessScore(draft = {}) {
  const required = ["cliente_id", "origen", "destino", "fecha_carga"];
  const useful = ["hora_carga", "fecha_descarga", "mercancia", "peso_kg", "importe", "referencia_cliente", "ruta_id"];
  const reqScore = required.filter(k => draft[k]).length * 18;
  const usefulScore = useful.filter(k => draft[k]).length * 4;
  return Math.max(0, Math.min(100, reqScore + usefulScore));
}

function normalizeRouteMinimumUnits(route = {}, tarifaTipo = route?.tarifa_tipo) {
  const raw = route.minimo_unidades ?? route.minimo_facturable;
  const value = parseLocaleNumber(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (String(tarifaTipo || "").toLowerCase() === "tonelada" && value >= 1000) {
    return Number((value / 1000).toFixed(3));
  }
  return value;
}

function routeTarifaCompatibleWithPedido(route = {}, payload = {}) {
  const tipoRuta = String(route.tarifa_tipo || "viaje").trim().toLowerCase();
  const tipoPedido = String(payload.tipo_precio || "viaje").trim().toLowerCase();
  if (tipoRuta !== tipoPedido) return false;
  const precioRuta = parseLocaleNumber(route.precio_base ?? route.precio);
  const precioPedido = parseLocaleNumber(payload.precio_unitario);
  if (Number.isFinite(precioRuta) && precioRuta > 0 && Number.isFinite(precioPedido) && precioPedido > 0) {
    const diffPct = Math.abs(precioRuta - precioPedido) / Math.max(precioRuta, precioPedido);
    if (diffPct > 0.05) return false;
  }
  if (tipoRuta !== "viaje") {
    const minRuta = normalizeRouteMinimumUnits(route, tipoRuta);
    const minPedido = parseLocaleNumber(payload.minimo_unidades);
    if (minRuta > 0 && Number.isFinite(minPedido) && minPedido > 0 && Math.abs(minRuta - minPedido) > 0.01) return false;
  }
  return true;
}

async function resolveCompatibleRutaId(queryClient, empresaId, rutaId, payload = {}) {
  const rutaIdNorm = normalizePedidoUuid(rutaId);
  if (!rutaIdNorm) return { rutaId: null, ruta: null, incompatible: false };
  const clienteId = normalizePedidoUuid(payload.cliente_id);
  const { rows } = await queryClient.query(
    `SELECT r.id, r.km,
            COALESCE(rpc.precio, r.precio_base, 0) AS precio_base,
            COALESCE(rpc.tarifa_tipo, r.tarifa_tipo, 'viaje') AS tarifa_tipo,
            COALESCE(rpc.minimo_facturable, r.minimo_facturable) AS minimo_facturable,
            COALESCE(rpc.minimo_unidades, r.minimo_unidades) AS minimo_unidades,
            COALESCE(rpc.recargo_combustible_pct, r.recargo_combustible_pct, 0) AS recargo_combustible_pct
       FROM rutas r
       LEFT JOIN ruta_precios_cliente rpc ON rpc.ruta_id=r.id AND ($3::uuid IS NULL OR rpc.cliente_id=$3)
      WHERE r.id=$1
        AND COALESCE(r.activa,true)=true
        AND (r.empresa_id=$2 OR r.empresa_id IS NULL)
      LIMIT 1`,
    [rutaIdNorm, empresaId, clienteId]
  );
  const ruta = rows[0] || null;
  if (!ruta) return { rutaId: null, ruta: null, incompatible: false };
  const shouldCheck = hasPedidoTarifaCalcInput(payload) || payload.importe !== undefined || payload.precio_cliente_col !== undefined;
  if (shouldCheck && !routeTarifaCompatibleWithPedido(ruta, normalizePedidoTarifaFields(payload))) {
    return { rutaId: null, ruta, incompatible: true };
  }
  return { rutaId: ruta.id, ruta, incompatible: false };
}

function isValidMapsUrl(value) {
  const raw = String(value || "").trim();
  return /^(https?:\/\/|geo:)/i.test(raw);
}

function normalizePedidoStopsForStorage(value, fallbackAddress = "", fallbackCountry = "España", fallbackRegion = "", fallbackSchedule = {}) {
  const parsed = normalizePedidoJsonList(value);
  const seen = new Set();
  return parsed.map((stop, idx) => {
    const source = stop && typeof stop === "object" ? stop : {};
    const rawMaps = String(source.google_maps_url || source.googleMapsUrl || source.maps_url || "").trim();
    const cleanMaps = isValidMapsUrl(rawMaps) ? rawMaps : "";
    const direccion = String(source.direccion || source.address || source.lugar || (idx === 0 ? fallbackAddress : "") || "").trim();
    const notas = !cleanMaps && rawMaps
      ? [source.notas, rawMaps].filter(Boolean).join(" | ")
      : source.notas;
    return {
      ...source,
      direccion,
      pais: normalizePaisPedido(source.pais || source.country || (idx === 0 ? fallbackCountry : "España")),
      provincia: String(source.provincia || source.region || source.state || (idx === 0 ? fallbackRegion : "") || "").trim(),
      google_maps_url: cleanMaps,
      notas: notas || "",
      fecha: source.fecha || source.fecha_carga || source.fecha_descarga || (idx === 0 ? fallbackSchedule.fecha || "" : ""),
      hora: source.hora || source.hora_carga || source.hora_descarga || (idx === 0 ? fallbackSchedule.hora || "" : ""),
      ventana: source.ventana || source.ventana_carga || source.ventana_descarga || (idx === 0 ? fallbackSchedule.ventana || "" : ""),
      lat: source.lat ?? source.latitud ?? source.metadata?.lat ?? null,
      lng: source.lng ?? source.longitud ?? source.metadata?.lng ?? null,
    };
  }).filter(stop => {
    // No descartar una parada que tenga nombre de cliente/punto aunque le falte
    // la direccion exacta (p. ej. una 2a descarga elegida por nombre).
    if (!stop.direccion && !stop.google_maps_url && !stop.cliente_nombre && (stop.lat == null || stop.lng == null)) return false;
    // Deduplicado: incluir cliente_nombre y referencia para NO colapsar dos
    // descargas distintas que geocodifiquen al mismo punto (misma poblacion) o
    // compartan direccion pero sean clientes distintos.
    const key = [
      String(stop.direccion || "").trim().toLowerCase(),
      String(stop.cliente_nombre || "").trim().toLowerCase(),
      String(stop.referencia || stop.referencia_cliente || "").trim().toLowerCase(),
      String(stop.google_maps_url || "").trim().toLowerCase(),
      stop.lat ?? "",
      stop.lng ?? "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergePrimaryStopScheduleForStorage(stops = [], schedule = {}) {
  return normalizePedidoJsonList(stops).map((stop, idx) => idx === 0 ? {
    ...stop,
    fecha: stop.fecha || stop.fecha_carga || stop.fecha_descarga || schedule.fecha || "",
    hora: stop.hora || stop.hora_carga || stop.hora_descarga || schedule.hora || "",
    ventana: stop.ventana || stop.ventana_carga || stop.ventana_descarga || schedule.ventana || "",
  } : stop);
}

function derivePedidoGeoFromStops(cargas = [], descargas = [], fallback = {}) {
  const cargaPrincipal = normalizePedidoJsonList(cargas)[0] || {};
  const descargaPrincipal = normalizePedidoJsonList(descargas)[0] || {};
  const origenPais = normalizePaisPedido(cargaPrincipal.pais || fallback.origen_pais || fallback.pais_origen || "España");
  const destinoPais = normalizePaisPedido(descargaPrincipal.pais || fallback.destino_pais || fallback.pais_destino || "España");
  const allCountries = [
    ...normalizePedidoJsonList(cargas).map(stop => normalizePaisPedido(stop.pais || "España")),
    ...normalizePedidoJsonList(descargas).map(stop => normalizePaisPedido(stop.pais || "España")),
    origenPais,
    destinoPais,
  ];
  return {
    origen_pais: origenPais,
    origen_provincia: String(cargaPrincipal.provincia || fallback.origen_provincia || fallback.provincia_origen || "").trim() || null,
    destino_pais: destinoPais,
    destino_provincia: String(descargaPrincipal.provincia || fallback.destino_provincia || fallback.provincia_destino || "").trim() || null,
    cmr_tipo: allCountries.some(country => cmrTipoPedido(country, "España") === "internacional") ? "internacional" : "nacional",
  };
}

function routeMatchKeyPedido(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?l\.?u?|s\.?a\.?u?|s\.?l\.?|s\.?a\.?|slu|sau|sl|sa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function routeCandidatesPedido(text = "", stops = []) {
  const values = [text];
  normalizePedidoJsonList(stops).forEach(stop => {
    values.push(
      stop.nombre,
      stop.direccion,
      stop.poblacion,
      stop.ciudad,
      stop.provincia,
      [stop.nombre, stop.poblacion || stop.ciudad].filter(Boolean).join(" "),
      [stop.direccion, stop.poblacion || stop.ciudad].filter(Boolean).join(" ")
    );
  });
  String(text || "").split(/\s+-\s+/).forEach(part => values.push(part));
  return [...new Set(values.map(routeMatchKeyPedido).filter(Boolean))];
}

function routeTextScorePedido(routeText = "", candidates = []) {
  const routeKey = routeMatchKeyPedido(routeText);
  if (!routeKey || !candidates.length) return 0;
  let best = 0;
  for (const candidate of candidates) {
    if (routeKey === candidate) best = Math.max(best, 100);
    else if (routeKey.includes(candidate) || candidate.includes(routeKey)) {
      const ratio = Math.min(routeKey.length, candidate.length) / Math.max(routeKey.length, candidate.length);
      best = Math.max(best, ratio >= 0.42 ? 70 + Math.round(ratio * 20) : 35);
    }
  }
  return best;
}

async function inferKmRutaPedido(queryClient, empresaId, payload = {}) {
  const current = parseLocaleNumber(payload.km_ruta);
  if (Number.isFinite(current) && current > 0) return current;
  const rutaId = normalizePedidoUuid(payload.ruta_id);
  if (rutaId) {
    const { rows } = await optionalPedidoQuery(
      queryClient,
      "SELECT km FROM rutas WHERE id=$1 AND activa=true AND (empresa_id=$2 OR empresa_id IS NULL) LIMIT 1",
      [rutaId, empresaId],
      "No se pudieron inferir los kilometros desde la ruta seleccionada:"
    );
    const km = Number(rows[0]?.km || 0);
    if (Number.isFinite(km) && km > 0) return km;
  }
  const origen = String(payload.origen || "").trim();
  const destino = String(payload.destino || "").trim();
  const clienteId = normalizePedidoUuid(payload.cliente_id);
  if (!origen || !destino || !clienteId) return null;
  const { rows } = await optionalPedidoQuery(
    queryClient,
    `SELECT r.km,r.origen,r.destino,
            CASE WHEN r.cliente_id=$2 THEN 0 ELSE 1 END AS prioridad
       FROM rutas r
       LEFT JOIN ruta_precios_cliente rpc ON rpc.ruta_id=r.id
      WHERE r.activa=true
        AND (r.empresa_id=$1 OR r.empresa_id IS NULL)
        AND (r.cliente_id=$2 OR rpc.cliente_id=$2)
      ORDER BY CASE WHEN r.cliente_id=$2 THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT 350`,
    [empresaId, clienteId],
    "No se pudieron inferir los kilometros desde las rutas del cliente:"
  );
  const origenCandidates = routeCandidatesPedido(origen, payload.puntos_carga || payload.cargas || []);
  const destinoCandidates = routeCandidatesPedido(destino, payload.puntos_descarga || payload.descargas || []);
  let best = null;
  for (const route of rows) {
    const originScore = routeTextScorePedido(route.origen, origenCandidates);
    const destinationScore = routeTextScorePedido(route.destino, destinoCandidates);
    if (originScore < 55 || destinationScore < 55) continue;
    const score = originScore + destinationScore - Number(route.prioridad || 0) * 8;
    if (!best || score > best.score) best = { ...route, score };
  }
  const km = Number(best?.km || 0);
  return Number.isFinite(km) && km > 0 ? km : null;
}

function normalizeTipoViaje(value) {
  const raw = String(value || "normal").trim().toLowerCase();
  return ["normal", "salida", "retorno"].includes(raw) ? raw : "normal";
}

function normalizeTraficoConfig(config = {}) {
  const raw = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const vehiculoIds = Array.isArray(raw.vehiculo_ids)
    ? [...new Set(raw.vehiculo_ids.map(v => normalizePedidoUuid(v)).filter(Boolean))]
    : [];
  const tiposRaw = Array.isArray(raw.tipos_viaje) ? raw.tipos_viaje : [];
  const tipos = [...new Set(tiposRaw.map(normalizeTipoViaje).filter(Boolean))];
  return {
    vehiculo_ids: vehiculoIds,
    tipos_viaje: tipos.length ? tipos : ["normal", "salida", "retorno"],
  };
}

function traficoConfigIsOpen(config = {}) {
  const cfg = normalizeTraficoConfig(config);
  return cfg.vehiculo_ids.length === 0 && cfg.tipos_viaje.length >= 3;
}

function traficoConfigMatchesPedido(config = {}, pedido = {}, targetTipo = null) {
  const cfg = normalizeTraficoConfig(config);
  const tipo = normalizeTipoViaje(targetTipo || pedido.tipo_viaje || "normal");
  if (!cfg.tipos_viaje.includes(tipo)) return false;
  if (cfg.vehiculo_ids.length && !cfg.vehiculo_ids.includes(String(pedido.vehiculo_id || ""))) return false;
  return true;
}

function tipoViajeContrario(tipo) {
  const t = normalizeTipoViaje(tipo);
  if (t === "salida") return "retorno";
  if (t === "retorno") return "salida";
  return null;
}

function tipoViajeLabel(tipo) {
  const t = normalizeTipoViaje(tipo);
  if (t === "salida") return "salida";
  if (t === "retorno") return "retorno";
  return "viaje";
}

async function notificarPlanificacionIdaRetorno(pedido = {}, empresaId, actorId = null) {
  const tipo = normalizeTipoViaje(pedido.tipo_viaje);
  const objetivo = tipoViajeContrario(tipo);
  if (!objetivo || !pedido?.vehiculo_id || !empresaId) return;
  const { rows: vehRows } = await db.query(
    "SELECT matricula FROM vehiculos WHERE id=$1 AND empresa_id=$2 LIMIT 1",
    [pedido.vehiculo_id, empresaId]
  ).catch(() => ({ rows: [] }));
  const matricula = pedido.vehiculo_matricula || pedido.matricula || vehRows[0]?.matricula || "vehiculo";
  const { rows: usuarios } = await db.query(
    `SELECT id, trafico_config
       FROM usuarios
      WHERE empresa_id=$1
        AND activo=true
        AND rol::text='trafico'
        AND ($2::uuid IS NULL OR id<>$2::uuid)`,
    [empresaId, actorId || null]
  ).catch(() => ({ rows: [] }));
  const destinatarios = usuarios.filter(u => traficoConfigMatchesPedido(u.trafico_config, pedido, objetivo));
  if (!destinatarios.length) return;
  const desde = tipo === "salida" ? (pedido.destino || "destino de descarga") : (pedido.origen || "punto de retorno");
  const fecha = pedido.fecha_descarga || pedido.fecha_entrega || pedido.fecha_carga || null;
  const titulo = objetivo === "retorno"
    ? `Retorno pendiente: ${matricula}`
    : `Salida informada: ${matricula}`;
  const mensaje = objetivo === "retorno"
    ? `Se ha asignado una salida a ${matricula}. Preparar retorno desde ${desde}${fecha ? ` para ${normalizePedidoDate(fecha)}` : ""}.`
    : `Se ha asignado un retorno a ${matricula}. Trafico de salidas ya puede ver donde tendra el camion: ${desde}${fecha ? ` (${normalizePedidoDate(fecha)})` : ""}.`;
  await Promise.all(destinatarios.map(async (u) => {
    const dedupe = `ida-retorno:${objetivo}:${pedido.id}:${pedido.vehiculo_id}`;
    const existing = await db.query(
      `SELECT id FROM notificaciones_internas
        WHERE empresa_id=$1 AND usuario_id=$2 AND tipo='planificacion_ida_retorno'
          AND data->>'dedupe_key'=$3 AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [empresaId, u.id, dedupe]
    ).catch(() => ({ rows: [] }));
    if (existing.rows[0]) return;
    await crearNotificacion({
      empresa_id: empresaId,
      usuario_id: u.id,
      tipo: "planificacion_ida_retorno",
      titulo,
      mensaje,
      data: {
        pedido_id: pedido.id,
        pedido_numero: pedido.numero || null,
        vehiculo_id: pedido.vehiculo_id,
        matricula,
        tipo_origen: tipo,
        tipo_objetivo: objetivo,
        origen: pedido.origen || null,
        destino: pedido.destino || null,
        fecha,
        destino_modulo: "gestion_trafico",
        dedupe_key: dedupe,
      },
      created_by: actorId,
    });
  }));
}

function pedidoIngresoOperativo(pedido = {}) {
  return roundMoney(firstPositiveNumber(pedido.importe, pedido.precio_cliente_col, pedido.precio_unitario));
}

function buildIdaRetornoResumen(salida = {}, retorno = {}, kmVacioManual = null) {
  const kmIda = Math.max(0, Number(salida.km_ruta || salida.km || 0));
  const kmRetorno = Math.max(0, Number(retorno.km_ruta || retorno.km || 0));
  const kmVacio = Math.max(0, Number(
    kmVacioManual ??
    retorno.km_vacio_enlace ??
    retorno.km_vacio ??
    salida.km_vacio_enlace ??
    0
  ));
  const ingresoIda = pedidoIngresoOperativo(salida);
  const ingresoRetorno = pedidoIngresoOperativo(retorno);
  const ingresoTotal = roundMoney(ingresoIda + ingresoRetorno);
  const kmCargadoTotal = roundMoney(kmIda + kmRetorno);
  const kmTotal = roundMoney(kmCargadoTotal + kmVacio);
  const avisos = [];
  if (!kmIda) avisos.push("Faltan kilometros cargados de la salida.");
  if (!kmRetorno) avisos.push("Faltan kilometros cargados del retorno.");
  if (!kmVacio) avisos.push("Completa los kilometros en vacio entre descarga de salida y carga de retorno.");
  if (salida.vehiculo_id && retorno.vehiculo_id && String(salida.vehiculo_id) !== String(retorno.vehiculo_id)) {
    avisos.push("La salida y el retorno estan asignados a vehiculos distintos.");
  }
  return {
    salida_id: salida.id || null,
    salida_numero: salida.numero || null,
    retorno_id: retorno.id || null,
    retorno_numero: retorno.numero || null,
    grupo_ida_vuelta: salida.grupo_ida_vuelta || retorno.grupo_ida_vuelta || null,
    vehiculo_id: salida.vehiculo_id || retorno.vehiculo_id || null,
    vehiculo_matricula: salida.vehiculo_matricula || salida.matricula || retorno.vehiculo_matricula || retorno.matricula || null,
    rutas: {
      ida: { origen: salida.origen || "", destino: salida.destino || "", km: kmIda },
      retorno: { origen: retorno.origen || "", destino: retorno.destino || "", km: kmRetorno },
      vacio: { origen: salida.destino || "", destino: retorno.origen || "", km: kmVacio },
    },
    ingresos: {
      ida: ingresoIda,
      retorno: ingresoRetorno,
      total: ingresoTotal,
    },
    km: {
      cargado_ida: kmIda,
      cargado_retorno: kmRetorno,
      cargado_total: kmCargadoTotal,
      vacio_enlace: kmVacio,
      total: kmTotal,
    },
    precio_total_ida_vuelta: ingresoTotal,
    eur_km_total: kmTotal > 0 ? roundMoney(ingresoTotal / kmTotal) : null,
    avisos,
  };
}

function buildRentabilidadPedido(pedido = {}, extras = [], docs = {}) {
  const ingresoBase = firstPositiveNumber(pedido.importe, pedido.precio_cliente_col, pedido.precio_unitario);
  const ingresoParalizacion = Math.max(0, Number(pedido.importe_paralizacion || 0));
  const ingreso = roundMoney(ingresoBase + ingresoParalizacion);
  const esColaborador = Boolean(pedido.colaborador_id);
  const costeColaborador = esColaborador ? Math.max(0, Number(pedido.precio_colaborador || 0)) : 0;
  const costePropio = esColaborador ? 0 : [
    pedido.coste_gasoil,
    pedido.coste_peajes,
    pedido.coste_dietas,
    pedido.coste_otros,
  ].reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  const costeExtra = Array.isArray(extras)
    ? extras.reduce((sum, x) => sum + Math.max(0, Number(x.importe || 0)), 0)
    : 0;
  const coste = roundMoney(costeColaborador + costePropio);
  const margen = roundMoney(ingreso - coste);
  const margenPct = ingreso > 0 ? roundMoney((margen / ingreso) * 100) : null;
  const kmRuta = Math.max(0, Number(pedido.km_ruta || 0));
  const estado = String(pedido.estado || "").toLowerCase();
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaCompromiso = pedido.fecha_descarga || pedido.fecha_entrega || pedido.fecha_carga || null;
  const fecha = fechaCompromiso ? new Date(fechaCompromiso) : null;
  if (fecha && !Number.isNaN(fecha.getTime())) fecha.setHours(0, 0, 0, 0);

  const riesgos = [];
  const acciones = [];
  const push = (tipo, severidad, mensaje, accion) => {
    riesgos.push({ tipo, severidad, mensaje });
    if (accion) acciones.push(accion);
  };

  if (ingreso <= 0) push("sin_precio", "alta", "El pedido no tiene precio de venta usable.", "Completar precio cliente antes de aceptar o facturar.");
  if (esColaborador && costeColaborador <= 0) push("colaborador_sin_coste", "alta", "Hay colaborador asignado sin precio acordado.", "Registrar precio del colaborador.");
  if (ingreso > 0 && margen < 0) push("margen_negativo", "critica", "El coste previsto supera al ingreso.", "Revisar precio, coste o alternativa de asignacion.");
  else if (ingreso > 0 && margenPct !== null && margenPct < 8) push("margen_bajo", "media", "El margen previsto esta por debajo del 8%.", "Revisar precio minimo rentable o buscar retorno.");
  if (kmRuta <= 0) push("sin_km", "media", "Faltan kilometros de ruta para evaluar EUR/km y coste real.", "Calcular o completar kilometros de ruta.");
  if ((estado === "entregado" || estado === "facturado") && Number(docs.albaranes || 0) === 0) {
    push("pod_pendiente", "alta", "El viaje esta entregado/facturado sin albaran/POD visible.", "Pedir o adjuntar POD antes de cerrar cobro.");
  }
  if (fecha && fecha < hoy && !["entregado", "cancelado", "facturado"].includes(estado)) {
    push("posible_retraso", "alta", "La fecha comprometida ya vencio y el viaje no figura entregado.", "Revisar estado, avisar al cliente o abrir incidencia.");
  }
  if (String(pedido.factura_estado || "").toLowerCase() === "vencida") {
    push("cobro_vencido", "alta", "La factura vinculada esta vencida.", "Revisar reclamacion de cobro.");
  }

  let decision = "aceptar";
  let recomendacion = "Operacion viable con los datos actuales.";
  if (riesgos.some(r => r.tipo === "sin_precio" || r.tipo === "colaborador_sin_coste" || r.tipo === "sin_km")) {
    decision = "completar_datos";
    recomendacion = "Completar datos economicos y kilometros antes de decidir.";
  } else if (margen < 0) {
    decision = "revisar_precio";
    recomendacion = "No aceptar en estas condiciones salvo ajuste de precio, coste o retorno compensatorio.";
  } else if (margenPct !== null && margenPct < 8) {
    decision = "vigilar_margen";
    recomendacion = "Aceptar solo si hay retorno, urgencia comercial o posibilidad de recuperar esperas/extras.";
  } else if (riesgos.some(r => ["pod_pendiente", "posible_retraso", "cobro_vencido"].includes(r.tipo))) {
    decision = "vigilar_operacion";
    recomendacion = "Operacion rentable, pero requiere seguimiento documental, operativo o de cobro.";
  }

  return {
    pedido_id: pedido.id,
    pedido_numero: pedido.numero,
    cliente: pedido.cliente_nombre || null,
    ruta: { origen: pedido.origen || "", destino: pedido.destino || "", km: kmRuta },
    modelo: esColaborador ? "colaborador" : "flota_propia",
    ingreso: {
      base: roundMoney(ingresoBase),
      paralizacion: roundMoney(ingresoParalizacion),
      total: ingreso,
      eur_km: kmRuta > 0 ? roundMoney(ingreso / kmRuta) : null,
    },
    costes: {
      colaborador: roundMoney(costeColaborador),
      propios: roundMoney(costePropio),
      extras_registrados: roundMoney(costeExtra),
      total: coste,
      eur_km: kmRuta > 0 ? roundMoney(coste / kmRuta) : null,
    },
    margen: {
      importe: margen,
      pct: margenPct,
      color: margen < 0 ? "rojo" : margenPct !== null && margenPct < 8 ? "amarillo" : "verde",
    },
    documentos: {
      albaranes: Number(docs.albaranes || 0),
      documentos: Number(docs.documentos || 0),
    },
    riesgos,
    acciones,
    decision,
    recomendacion,
    generated_at: new Date().toISOString(),
  };
}

async function validatePedidoAssignment(client, body = {}, empresaId) {
  const checks = [
    ["vehiculo_id", "vehiculos", "vehiculo"],
    ["remolque_id", "vehiculos", "remolque"],
    ["chofer_id", "choferes", "chofer"],
    ["chofer2_id", "choferes", "segundo chofer"],
    ["colaborador_id", "colaboradores", "colaborador"],
  ];
  for (const [field, table, label] of checks) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === "" || raw === null || raw === undefined) {
      body[field] = null;
      continue;
    }
    const id = normalizePedidoUuid(raw);
    if (!id) {
      const err = new Error(`El ${label} indicado no es valido. Refresca la pantalla y vuelve a seleccionarlo.`);
      err.status = 400;
      throw err;
    }
    const selectFields = table === "choferes" ? "id,nombre,apellidos,activo,estado" : "id";
    const { rows } = await client.query(
      `SELECT ${selectFields} FROM ${table} WHERE id=$1 AND empresa_id=$2 LIMIT 1`,
      [id, empresaId]
    );
    if (!rows[0]) {
      const err = new Error(`El ${label} indicado no existe o no pertenece a esta empresa. Refresca la pantalla y vuelve a seleccionarlo.`);
      err.status = 400;
      throw err;
    }
    if (table === "choferes" && (rows[0].activo === false || ["baja", "ausencia"].includes(String(rows[0].estado || "").toLowerCase()))) {
      const nombreChofer = `${rows[0].nombre || ""} ${rows[0].apellidos || ""}`.trim() || "El chofer";
      const err = new Error(`${nombreChofer} esta de baja o ausente y no puede asignarse a viajes.`);
      err.status = 409;
      throw err;
    }
    body[field] = id;
  }
  return body;
}

async function registrarHistorialAsignacionPedido(client, pedido = {}, empresaId) {
  if (!pedido?.chofer_id || !pedido?.vehiculo_id) return;
  try {
    const { rows: veh } = await client.query(
      "SELECT matricula FROM vehiculos WHERE id=$1 AND empresa_id=$2",
      [pedido.vehiculo_id, empresaId]
    );
    const { rows: rem } = pedido.remolque_id
      ? await client.query("SELECT matricula FROM vehiculos WHERE id=$1 AND empresa_id=$2", [pedido.remolque_id, empresaId])
      : { rows: [] };
    await client.query(`
      INSERT INTO chofer_vehiculo_historial
        (chofer_id, vehiculo_id, remolque_id, pedido_id, matricula, remolque_mat, tipo, empresa_id)
      VALUES ($1,$2,$3,$4,$5,$6,'pedido',$7)
    `, [
      pedido.chofer_id,
      pedido.vehiculo_id,
      pedido.remolque_id || null,
      pedido.id,
      veh[0]?.matricula || null,
      pedido.remolque_matricula || rem[0]?.matricula || null,
      empresaId,
    ]);
  } catch (histErr) {
    logger.warn("No se pudo registrar historial de asignacion:", histErr.message);
  }
}

async function sincronizarConjuntoChoferDesdePedido(queryClient, pedido = {}, empresaId) {
  if (!pedido?.chofer_id || !pedido?.vehiculo_id || !empresaId) return;
  try {
    const choferId = pedido.chofer_id;
    const vehiculoId = pedido.vehiculo_id;
    const remolqueId = pedido.remolque_id || null;

    await queryClient.query(
      "UPDATE vehiculos SET chofer_id=NULL WHERE empresa_id=$1 AND chofer_id=$2 AND id<>$3",
      [empresaId, choferId, vehiculoId]
    );

    if (remolqueId) {
      await queryClient.query(
        "UPDATE vehiculos SET remolque_id=NULL WHERE empresa_id=$1 AND remolque_id=$2 AND id<>$3",
        [empresaId, remolqueId, vehiculoId]
      );
    }

    await queryClient.query(
      "UPDATE choferes SET vehiculo_id=$1 WHERE empresa_id=$2 AND id=$3",
      [vehiculoId, empresaId, choferId]
    );

    await queryClient.query(
      "UPDATE vehiculos SET chofer_id=$1, remolque_id=$2, updated_at=NOW() WHERE empresa_id=$3 AND id=$4",
      [choferId, remolqueId, empresaId, vehiculoId]
    );
  } catch (err) {
    logger.warn("No se pudo sincronizar el conjunto del chofer desde pedido:", err.message);
  }
}

function pedidoTieneMinimosOperativos(pedido = {}) {
  const tieneAsignacion = Boolean(pedido.vehiculo_id || pedido.colaborador_id);
  const importe = Number(pedido.importe || pedido.precio_cliente_col || 0);
  return Boolean(
    pedido.cliente_id &&
    String(pedido.origen || "").trim() &&
    String(pedido.destino || "").trim() &&
    pedido.fecha_carga &&
    tieneAsignacion &&
    importe > 0
  );
}

async function limpiarPendienteCompletarSiProcede(pedido, empresaId, actor = {}) {
  if (!pedido?.pendiente_completar || !pedidoTieneMinimosOperativos(pedido)) return pedido;
  const { rows } = await db.query(
    `UPDATE pedidos
        SET pendiente_completar=false,
            aviso_completar=NULL
      WHERE id=$1 AND empresa_id=$2
      RETURNING *`,
    [pedido.id, empresaId]
  );
  const actualizado = rows[0] || pedido;
  await logPedidoEvento(actualizado.id, empresaId, "pedido.completado", {
    origen: actualizado.origen,
    destino: actualizado.destino,
    fecha_carga: actualizado.fecha_carga,
    asignacion: actualizado.vehiculo_id ? "vehiculo" : "colaborador",
  }, actor.rol || "usuario", actor.id || null);
  return actualizado;
}

function pedidoTieneAsignacionActiva(pedido = {}) {
  return Boolean(
    pedido.vehiculo_id ||
    pedido.chofer_id ||
    pedido.chofer2_id ||
    pedido.remolque_id ||
    pedido.colaborador_id ||
    String(pedido.matricula_manual || "").trim() ||
    String(pedido.matricula_colaborador || "").trim()
  );
}

function debeConfirmarPorAsignacion(pedido = {}) {
  const estado = String(pedido.estado || "pendiente").toLowerCase();
  return estado === "pendiente" && pedidoTieneAsignacionActiva(pedido);
}

async function confirmarPedidoPorAsignacionSiProcede(pedido, empresaId, actor = {}, queryClient = db) {
  if (!debeConfirmarPorAsignacion(pedido)) return pedido;
  const { rows } = await queryClient.query(
    `UPDATE pedidos
        SET estado='confirmado'
      WHERE id=$1
        AND empresa_id=$2
        AND estado::text='pendiente'
      RETURNING *`,
    [pedido.id, empresaId]
  );
  const actualizado = rows[0] || { ...pedido, estado: "confirmado" };
  await logPedidoEvento(actualizado.id, empresaId, "pedido.confirmado_auto_asignacion", {
    motivo: actualizado.colaborador_id ? "colaborador_asignado" : "asignacion_operativa",
    vehiculo_id: actualizado.vehiculo_id || null,
    chofer_id: actualizado.chofer_id || null,
    remolque_id: actualizado.remolque_id || null,
    colaborador_id: actualizado.colaborador_id || null,
  }, actor.rol || "sistema", actor.id || null, queryClient);
  return actualizado;
}

async function updateExistingPedidoFields(client, fields, pedidoId, empresaId) {
  const pending = fields.map(([field, value]) => [field, normalizePedidoValue(field, value)]);
  const transactionalClient = client !== db;
  let attempt = 0;
  while (pending.length) {
    const setClauses = pending.map(([k], i) => `${k}=$${i + 1}`).join(", ");
    const values = pending.map(([, v]) => v);
    values.push(pedidoId, empresaId);
    const savepoint = `pedido_optional_fields_${attempt++}`;
    if (transactionalClient) await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const { rows } = await client.query(
        `UPDATE pedidos SET ${setClauses} WHERE id=$${values.length - 1} AND empresa_id=$${values.length} RETURNING *`,
        values
      );
      if (transactionalClient) await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return rows[0] || null;
    } catch (error) {
      if (transactionalClient) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
      const missingColumn = getMissingColumn(error);
      if (!missingColumn) throw error;
      const next = pending.filter(([field]) => field !== missingColumn);
      if (next.length === pending.length) throw error;
      logger.warn(`Pedidos: columna opcional ausente en el esquema; se omite ${missingColumn}.`);
      pending.length = 0;
      pending.push(...next);
    }
  }
  return null;
}

async function queryWithColaboradorFallback(sqlWithColaborador, sqlFallback, params) {
  try {
    return await db.query(sqlWithColaborador, params);
  } catch (error) {
    if (error.code === "42703" || error.code === "42P01") {
      logger.warn("Pedidos: consulta sin datos de colaborador por esquema antiguo:", error.message);
      return db.query(sqlFallback, params);
    }
    throw error;
  }
}

const ROLES_GESTION_PEDIDOS = new Set(["gerente", "trafico"]);

async function getChoferIdsForUser(user, empresaId) {
  if (!user || user.rol !== "chofer") return [];
  const ids = new Set();
  if (user.id) ids.add(String(user.id));
  if (user.chofer_id) ids.add(String(user.chofer_id));

  const clauses = [];
  const params = [empresaId];
  if (user.email) {
    params.push(String(user.email).toLowerCase());
    clauses.push(`LOWER(email) = $${params.length}`);
  }
  if (user.nombre) {
    params.push(String(user.nombre).trim().toLowerCase());
    clauses.push(`LOWER(TRIM(CONCAT(nombre, ' ', COALESCE(apellidos, '')))) = $${params.length}`);
    clauses.push(`LOWER(TRIM(nombre)) = $${params.length}`);
  }
  if (!clauses.length) return [...ids];

  const { rows } = await db.query(
    `SELECT id FROM choferes WHERE empresa_id=$1 AND (${clauses.join(" OR ")})`,
    params
  ).catch(() => ({ rows: [] }));
  rows.forEach(r => ids.add(String(r.id)));
  return [...ids];
}

async function getChoferAccessForUser(user, empresaId) {
  const choferIds = await getChoferIdsForUser(user, empresaId);
  if (!choferIds.length) return { choferIds: [], vehiculoIds: [] };
  const { rows } = await db.query(
    `SELECT id, vehiculo_id
       FROM choferes
      WHERE empresa_id=$1
        AND id = ANY($2::uuid[])`,
    [empresaId, choferIds]
  ).catch(() => ({ rows: [] }));
  return {
    choferIds: [...new Set([...choferIds, ...rows.map(r => String(r.id))])],
    vehiculoIds: [...new Set(rows.map(r => r.vehiculo_id).filter(Boolean).map(String))],
  };
}

async function resolveChoferPrincipalForUser(user, empresaId) {
  const access = await getChoferAccessForUser(user, empresaId);
  if (!access.choferIds.length) return null;
  const { rows } = await db.query(
    `SELECT ch.id, ch.vehiculo_id, v.remolque_id
       FROM choferes ch
       LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id AND v.empresa_id=ch.empresa_id
      WHERE ch.empresa_id=$1
        AND ch.id = ANY($2::uuid[])
      ORDER BY CASE WHEN ch.id=$3 THEN 0 ELSE 1 END
      LIMIT 1`,
    [empresaId, access.choferIds, normalizePedidoUuid(user?.chofer_id)]
  ).catch(() => ({ rows: [] }));
  if (rows[0]) return rows[0];
  const explicitChoferId = normalizePedidoUuid(user?.chofer_id);
  if (!explicitChoferId) return null;
  return {
    id: explicitChoferId,
    vehiculo_id: access.vehiculoIds[0] || null,
    remolque_id: null,
  };
}

async function resolveClienteLitePedido(client, empresaId, body = {}) {
  const clienteId = normalizePedidoUuid(body.cliente_id);
  if (clienteId) {
    const { rows } = await client.query(
      "SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 AND COALESCE(activo,true)=true LIMIT 1",
      [clienteId, empresaId]
    );
    if (!rows[0]) {
      const err = new Error("Cliente no encontrado para este viaje.");
      err.status = 404;
      throw err;
    }
    return clienteId;
  }
  const nombre = String(body.cliente_nombre || body.cliente || body.destinatario || "Cliente app chofer").trim().slice(0, 180);
  const cif = String(body.cliente_cif || "").trim().slice(0, 30);
  const direccion = String(body.cliente_direccion || body.destino || "").trim().slice(0, 240);
  const { rows: existing } = await client.query(
    `SELECT id FROM clientes
      WHERE empresa_id=$1
        AND LOWER(TRIM(nombre))=LOWER(TRIM($2))
      ORDER BY created_at ASC NULLS LAST
      LIMIT 1`,
    [empresaId, nombre]
  ).catch(() => ({ rows: [] }));
  if (existing[0]?.id) return existing[0].id;
  const { rows } = await client.query(
    `INSERT INTO clientes (empresa_id,nombre,cif,direccion,pais,activo,notas)
     VALUES ($1,$2,$3,$4,$5,true,$6)
     RETURNING id`,
    [
      empresaId,
      nombre || "Cliente app chofer",
      cif || "",
      direccion || "",
      normalizePaisPedido(body.destino_pais || "España"),
      "Alta automatica desde TransGest Lite / app chofer para DCD.",
    ]
  );
  return rows[0].id;
}

async function nextPedidoNumero(client, empresaId, prefix = "DCD") {
  const anio = new Date().getFullYear();
  const like = `${prefix}-${anio}-%`;
  const { rows } = await client.query(
    `SELECT numero FROM pedidos
      WHERE empresa_id=$1 AND numero LIKE $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [empresaId, like]
  );
  const lastNum = rows[0] ? parseInt(String(rows[0].numero || "").split("-").pop(), 10) || 0 : 0;
  return `${prefix}-${anio}-${String(lastNum + 1).padStart(4, "0")}`;
}

async function nextGestionPedidoNumero(client, empresaId) {
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

async function usuarioPuedeGestionarPedido(req, pedido) {
  if (ROLES_GESTION_PEDIDOS.has(req.user?.rol)) return true;
  if (req.user?.rol !== "chofer") return false;
  const empresaId = req.empresaId || req.user.empresa_id;
  const access = await getChoferAccessForUser(req.user, empresaId);
  return access.choferIds.some(id => id === String(pedido.chofer_id || "") || id === String(pedido.chofer2_id || ""))
    || access.vehiculoIds.some(id => id === String(pedido.vehiculo_id || ""));
}

async function assertUnicoViajeActivoChofer({ pedido, empresaId, estadoDestino }) {
  const estado = String(estadoDestino || "").toLowerCase();
  if (!["en_curso", "descarga"].includes(estado)) return;
  if (["en_curso", "descarga"].includes(String(pedido.estado || "").toLowerCase())) return;
  const choferIds = [pedido.chofer_id, pedido.chofer2_id].filter(Boolean);
  const vehiculoId = pedido.vehiculo_id || null;
  if (!choferIds.length && !vehiculoId) return;
  const { rows } = await db.query(
    `SELECT id, numero, estado::text AS estado
       FROM pedidos
      WHERE empresa_id=$1
        AND id<>$2
        AND estado::text IN ('en_curso','descarga')
        AND (
          ($3::uuid[] IS NOT NULL AND (chofer_id = ANY($3::uuid[]) OR chofer2_id = ANY($3::uuid[])))
          OR ($4::uuid IS NOT NULL AND vehiculo_id=$4)
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [empresaId, pedido.id, choferIds.length ? choferIds : null, vehiculoId]
  );
  if (rows[0]) {
    const err = new Error(`Este chofer o vehiculo ya tiene un viaje activo (${rows[0].numero || "pedido sin numero"}). Finaliza o libera ese viaje antes de iniciar otro.`);
    err.status = 409;
    err.code = "CHOFER_VIAJE_ACTIVO";
    err.pedido_activo = rows[0];
    throw err;
  }
}

router.get("/chofer/clientes", async (req, res) => {
  try {
    if (req.user?.rol !== "chofer") return res.status(403).json({ error: "Solo app chofer" });
    const empresaId = req.empresaId || req.user.empresa_id;
    const q = String(req.query?.q || "").trim();
    const access = await getChoferAccessForUser(req.user, empresaId);
    const ownClauses = [];
    const ownParams = [empresaId];
    if (access.choferIds.length) {
      ownParams.push(access.choferIds);
      ownClauses.push(`(p.chofer_id = ANY($${ownParams.length}::uuid[]) OR p.chofer2_id = ANY($${ownParams.length}::uuid[]))`);
    }
    if (access.vehiculoIds.length) {
      ownParams.push(access.vehiculoIds);
      ownClauses.push(`p.vehiculo_id = ANY($${ownParams.length}::uuid[])`);
    }

    if (!q) {
      if (!ownClauses.length) return res.json([]);
      const { rows } = await db.query(
        `SELECT c.id, c.nombre, c.cif, c.direccion, c.ciudad, c.pais,
                COUNT(p.id)::int AS cargas_total,
                MAX(p.fecha_carga) AS ultima_carga,
                TRUE AS acceso_rapido
           FROM pedidos p
           JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
          WHERE p.empresa_id=$1
            AND COALESCE(c.activo,true)=true
            AND p.cliente_id IS NOT NULL
            AND (${ownClauses.join(" OR ")})
          GROUP BY c.id
          ORDER BY COUNT(p.id) DESC, MAX(p.fecha_carga) DESC NULLS LAST, c.nombre ASC
          LIMIT 8`,
        ownParams
      );
      return res.json(rows);
    }

    const params = [empresaId, `%${q.toLowerCase()}%`];
    const { rows } = await db.query(
      `SELECT c.id, c.nombre, c.cif, c.direccion, c.ciudad, c.pais,
              COUNT(p.id)::int AS cargas_total,
              MAX(p.fecha_carga) AS ultima_carga,
              FALSE AS acceso_rapido
         FROM clientes c
         LEFT JOIN pedidos p ON p.cliente_id=c.id AND p.empresa_id=c.empresa_id
        WHERE c.empresa_id=$1
          AND COALESCE(c.activo,true)=true
          AND (LOWER(c.nombre) LIKE $2 OR LOWER(COALESCE(c.cif,'')) LIKE $2)
        GROUP BY c.id
        ORDER BY COUNT(p.id) DESC, c.nombre ASC
        LIMIT 20`,
      params
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudieron cargar clientes" });
  }
});

router.get("/chofer/clientes/:clienteId/puntos-carga", async (req, res) => {
  try {
    if (req.user?.rol !== "chofer") return res.status(403).json({ error: "Solo app chofer" });
    const empresaId = req.empresaId || req.user.empresa_id;
    const clienteId = normalizePedidoUuid(req.params.clienteId);
    if (!clienteId) return res.status(400).json({ error: "Cliente no valido" });
    const { rows: clienteRows } = await db.query(
      "SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 AND COALESCE(activo,true)=true LIMIT 1",
      [clienteId, empresaId]
    );
    if (!clienteRows[0]) return res.status(404).json({ error: "Cliente no encontrado" });
    const { rows } = await db.query(
      `SELECT id, cliente_id, nombre, direccion, codigo_postal, ciudad, provincia, pais,
              lat, lng, tipo, ventana, contacto_nombre, contacto_telefono, email, notas, metadata,
              COALESCE(metadata->>'google_maps_url','') AS google_maps_url,
              CASE WHEN LOWER(COALESCE(metadata->>'pending_review','')) IN ('true','t','1','yes') THEN true ELSE false END AS pendiente_revision
        FROM puntos_interes
        WHERE empresa_id=$1
          AND cliente_id=$2
          AND activo=true
          AND (tipo='carga' OR tipo='ambos')
        ORDER BY CASE WHEN LOWER(COALESCE(metadata->>'pending_review','')) IN ('true','t','1','yes') THEN true ELSE false END DESC,
                 nombre ASC
        LIMIT 100`,
      [empresaId, clienteId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudieron cargar puntos de carga del cliente" });
  }
});

router.get("/chofer/clientes/:clienteId/rutas", async (req, res) => {
  try {
    if (req.user?.rol !== "chofer") return res.status(403).json({ error: "Solo app chofer" });
    const empresaId = req.empresaId || req.user.empresa_id;
    const clienteId = normalizePedidoUuid(req.params.clienteId);
    if (!clienteId) return res.status(400).json({ error: "Cliente no valido" });
    const { rows: clienteRows } = await db.query(
      "SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 AND COALESCE(activo,true)=true LIMIT 1",
      [clienteId, empresaId]
    );
    if (!clienteRows[0]) return res.status(404).json({ error: "Cliente no encontrado" });
    const { rows } = await db.query(
      `SELECT r.id, r.origen, r.destino, r.km, r.tipo_vehiculo, r.notas
         FROM rutas r
         LEFT JOIN ruta_precios_cliente rc ON rc.ruta_id=r.id AND rc.cliente_id=$1
        WHERE (r.cliente_id=$1 OR rc.cliente_id=$1)
          AND COALESCE(r.activa,true)=true
          AND (r.empresa_id=$2 OR r.empresa_id IS NULL)
        ORDER BY r.origen, r.destino
        LIMIT 100`,
      [clienteId, empresaId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudieron cargar rutas del cliente" });
  }
});

router.post("/chofer/clientes/:clienteId/puntos-carga", async (req, res) => {
  try {
    if (req.user?.rol !== "chofer") return res.status(403).json({ error: "Solo app chofer" });
    const empresaId = req.empresaId || req.user.empresa_id;
    const clienteId = normalizePedidoUuid(req.params.clienteId);
    if (!clienteId) return res.status(400).json({ error: "Cliente no valido" });
    const nombre = String(req.body?.nombre || req.body?.direccion || "").trim().slice(0, 180);
    const direccion = String(req.body?.direccion || "").trim().slice(0, 240);
    if (!nombre || !direccion) return res.status(400).json({ error: "Indica nombre y direccion del punto de carga" });
    const { rows: clienteRows } = await db.query(
      "SELECT id, nombre FROM clientes WHERE id=$1 AND empresa_id=$2 AND COALESCE(activo,true)=true LIMIT 1",
      [clienteId, empresaId]
    );
    const cliente = clienteRows[0];
    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
    const metadata = {
      source: "app_chofer",
      pending_review: true,
      review_status: "pending",
      created_by_user_id: req.user?.id || null,
      created_at: new Date().toISOString(),
      google_maps_url: String(req.body?.google_maps_url || "").trim(),
    };
    const notas = [
      "Creado desde App Chofer. Pendiente de revision por trafico.",
      String(req.body?.notas || "").trim(),
    ].filter(Boolean).join(" ");
    const { rows } = await db.query(
      `INSERT INTO puntos_interes
        (empresa_id, cliente_id, nombre, direccion, codigo_postal, ciudad, provincia, pais,
         lat, lng, tipo, ventana, contacto_nombre, contacto_telefono, email, notas, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'carga',$11,$12,$13,$14,$15,$16::jsonb)
       RETURNING *, COALESCE(metadata->>'google_maps_url','') AS google_maps_url,
                 CASE WHEN LOWER(COALESCE(metadata->>'pending_review','')) IN ('true','t','1','yes') THEN true ELSE false END AS pendiente_revision`,
      [
        empresaId,
        clienteId,
        nombre,
        direccion,
        String(req.body?.codigo_postal || "").trim() || null,
        String(req.body?.ciudad || "").trim() || null,
        String(req.body?.provincia || "").trim() || null,
        String(req.body?.pais || "Espana").trim() || "Espana",
        parseLocaleNumber(req.body?.lat),
        parseLocaleNumber(req.body?.lng),
        String(req.body?.ventana || "").trim() || null,
        String(req.body?.contacto_nombre || "").trim() || null,
        String(req.body?.contacto_telefono || "").trim() || null,
        String(req.body?.email || "").trim() || null,
        notas,
        JSON.stringify(metadata),
      ]
    );
    const punto = rows[0];
    await notificarGestionPedido(
      empresaId,
      "punto_carga_chofer_pendiente_revision",
      "Nuevo punto de carga creado por chofer",
      `El chofer ha creado un punto de carga para ${cliente.nombre}: ${nombre}. Revisar direccion y datos antes de validarlo.`,
      { cliente_id: clienteId, cliente_nombre: cliente.nombre, punto_id: punto.id, nombre, direccion, dedupe_key: `punto-carga-chofer:${punto.id}` },
      req.user?.id || null
    );
    res.status(201).json({ ok: true, punto, pendiente_revision: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo crear el punto de carga desde app chofer" });
  }
});

router.post("/chofer/rutas", async (req, res) => {
  try {
    if (req.user?.rol !== "chofer") return res.status(403).json({ error: "Solo app chofer" });
    const empresaId = req.empresaId || req.user.empresa_id;
    const clienteId = normalizePedidoUuid(req.body?.cliente_id);
    const origen = String(req.body?.origen || "").trim();
    const destino = String(req.body?.destino || "").trim();
    if (!clienteId || !origen || !destino) return res.status(400).json({ error: "Indica cliente, origen y destino" });
    const { rows: clienteRows } = await db.query(
      "SELECT id, nombre FROM clientes WHERE id=$1 AND empresa_id=$2 AND COALESCE(activo,true)=true LIMIT 1",
      [clienteId, empresaId]
    );
    const cliente = clienteRows[0];
    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
    const notas = [
      "Creada desde App Chofer sin precio. Pendiente de revision por trafico/gerencia.",
      String(req.body?.notas || "").trim(),
    ].filter(Boolean).join(" ");
    const { rows: existing } = await db.query(
      `SELECT id FROM rutas
        WHERE empresa_id=$1
          AND cliente_id=$2
          AND LOWER(TRIM(origen))=LOWER(TRIM($3))
          AND LOWER(TRIM(destino))=LOWER(TRIM($4))
          AND COALESCE(activa,true)=true
        LIMIT 1`,
      [empresaId, clienteId, origen, destino]
    );
    let rutaId = existing[0]?.id || null;
    if (!rutaId) {
      const { rows } = await db.query(
        `INSERT INTO rutas (empresa_id, cliente_id, origen, destino, km, tipo_vehiculo, tarifa_tipo, precio_base, notas, activa)
         VALUES ($1,$2,$3,$4,$5,'cualquiera','viaje',0,$6,true)
         RETURNING id`,
        [empresaId, clienteId, origen, destino, parseLocaleNumber(req.body?.km) || null, notas]
      );
      rutaId = rows[0].id;
    }
    await notificarGestionPedido(
      empresaId,
      "ruta_chofer_pendiente_revision",
      "Nueva ruta creada por chofer",
      `El chofer ha creado una ruta para ${cliente.nombre}: ${origen} -> ${destino}. Revisar tarifa antes de usarla en facturacion.`,
      { cliente_id: clienteId, cliente_nombre: cliente.nombre, ruta_id: rutaId, origen, destino, dedupe_key: `ruta-chofer:${rutaId}` },
      req.user?.id || null
    );
    res.status(existing[0] ? 200 : 201).json({ ok: true, ruta_id: rutaId, origen, destino, pendiente_revision: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo crear la ruta desde app chofer" });
  }
});

// GET /pedidos
router.get("/", async (req, res) => {
  await ensureColaboradorWorkflowSchema();
  const { estado, cliente_id, chofer_id, desde, hasta, facturado, pendiente_completar, tipo_carga, q, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const empresaId = req.empresaId || req.user.empresa_id;
  const where  = ["p.empresa_id = $1"]; // tenant isolation
  const params = [empresaId];
  let i = 2;

  if (estado) {
    const estados = estado.split(',').map(s=>s.trim()).filter(Boolean);
    if (estados.length === 1) {
      where.push(`p.estado::text = $${i++}`);
      params.push(estados[0]);
    } else {
      where.push(`p.estado::text = ANY($${i++}::text[])`);
      params.push(estados);
    }
  }
  if (cliente_id) { where.push(`p.cliente_id = $${i++}`);     params.push(cliente_id); }
  if (req.user?.rol === "chofer") {
    const access = await getChoferAccessForUser(req.user, empresaId);
    if (!access.choferIds.length && !access.vehiculoIds.length) {
      return res.json({ data: [], page: Number(page)||1, limit: Number(limit)||50, total: 0, total_pages: 0 });
    }
    const ownClauses = [];
    if (access.choferIds.length) {
      ownClauses.push(`(p.chofer_id = ANY($${i}::uuid[]) OR p.chofer2_id = ANY($${i}::uuid[]))`);
      params.push(access.choferIds);
      i++;
    }
    if (access.vehiculoIds.length) {
      ownClauses.push(`p.vehiculo_id = ANY($${i}::uuid[])`);
      params.push(access.vehiculoIds);
      i++;
    }
    where.push(`(${ownClauses.join(" OR ")})`);
  } else if (chofer_id) {
    where.push(`(p.chofer_id = $${i} OR p.chofer2_id = $${i++})`);
    params.push(chofer_id);
  }
  if (req.user?.rol === "trafico" && !traficoConfigIsOpen(req.user.trafico_config)) {
    const scope = normalizeTraficoConfig(req.user.trafico_config);
    if (scope.vehiculo_ids.length) {
      where.push(`p.vehiculo_id = ANY($${i++}::uuid[])`);
      params.push(scope.vehiculo_ids);
    }
    if (scope.tipos_viaje.length && scope.tipos_viaje.length < 3) {
      where.push(`COALESCE(p.tipo_viaje,'normal') = ANY($${i++}::text[])`);
      params.push(scope.tipos_viaje);
    }
  }
  if (desde)      { where.push(`COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) >= $${i++}`);  params.push(desde); }
  if (hasta)      { where.push(`COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) <= $${i++}`);  params.push(hasta); }
  if (pendiente_completar === "true")  { where.push("p.pendiente_completar IS TRUE"); }
  if (pendiente_completar === "false") { where.push("COALESCE(p.pendiente_completar,false) IS FALSE"); }
  if (tipo_carga) { where.push(`COALESCE(p.tipo_carga,'') = $${i++}`); params.push(tipo_carga); }
  if (facturado === "false") { where.push("(p.factura_id IS NULL OR EXISTS (SELECT 1 FROM facturas fx WHERE fx.id=p.factura_id AND fx.empresa_id=p.empresa_id AND fx.estado='borrador'))"); }
  if (facturado === "true")  { where.push("p.factura_id IS NOT NULL AND EXISTS (SELECT 1 FROM facturas fx WHERE fx.id=p.factura_id AND fx.empresa_id=p.empresa_id AND fx.estado<>'borrador')"); }
  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(p.numero,'')) LIKE $${i}
      OR LOWER(COALESCE(p.origen,'')) LIKE $${i}
      OR LOWER(COALESCE(p.destino,'')) LIKE $${i}
      OR LOWER(COALESCE(p.referencia_cliente,'')) LIKE $${i}
      OR EXISTS (
        SELECT 1 FROM clientes c2
        WHERE c2.id=p.cliente_id AND LOWER(COALESCE(c2.nombre,'')) LIKE $${i}
      )
      OR EXISTS (
        SELECT 1 FROM colaboradores co2
        WHERE co2.id=p.colaborador_id AND co2.empresa_id=p.empresa_id AND LOWER(COALESCE(co2.nombre,'')) LIKE $${i}
      )
    )`);
    i++;
  }

  const { rows } = await queryWithColaboradorFallback(`
    WITH filtered AS (
      SELECT p.* -- empresa_id filtrado en where dinamico
        FROM pedidos p
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) DESC NULLS LAST, p.created_at DESC
       LIMIT $${i++} OFFSET $${i++}
    )
    SELECT p.*,
           c.nombre  AS cliente_nombre,
           c.telefono AS cliente_telefono,
           c.email AS cliente_email,
           c.email_facturacion AS cliente_email_facturacion,
           c.emails_albaranes AS cliente_emails_albaranes,
           co.nombre AS colaborador_nombre,
           co.cif AS colaborador_cif,
           co.telefono AS colaborador_telefono,
           co.email AS colaborador_email,
           ch.nombre AS chofer_nombre,
           v.matricula AS vehiculo_matricula,
           r.matricula AS remolque_matricula,
           f.estado AS factura_estado,
           f.numero AS factura_numero,
           COALESCE(docs.documentos_count,0)::int AS documentos_count,
           COALESCE(docs.albaranes_count,0)::int AS albaranes_count
    FROM filtered p
    LEFT JOIN clientes  c  ON c.id  = p.cliente_id AND c.empresa_id = p.empresa_id
    LEFT JOIN colaboradores co ON co.id = p.colaborador_id AND co.empresa_id = p.empresa_id
    LEFT JOIN choferes  ch ON ch.id = p.chofer_id AND ch.empresa_id = p.empresa_id
    LEFT JOIN vehiculos v  ON v.id  = p.vehiculo_id AND v.empresa_id = p.empresa_id
    LEFT JOIN vehiculos r  ON r.id  = p.remolque_id AND r.empresa_id = p.empresa_id
    LEFT JOIN facturas  f  ON f.id  = p.factura_id AND f.empresa_id = p.empresa_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS documentos_count,
             COUNT(*) FILTER (
               WHERE LOWER(COALESCE(d.tipo,'') || ' ' || COALESCE(d.nombre,'') || ' ' || COALESCE(d.notas,'')) LIKE '%albar%'
             )::int AS albaranes_count
        FROM pedido_docs d
       WHERE d.pedido_id = p.id AND d.empresa_id = p.empresa_id
    ) docs ON true
    ORDER BY COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) DESC NULLS LAST, p.created_at DESC
  `, `
    WITH filtered AS (
      SELECT p.* -- empresa_id filtrado en where dinamico
        FROM pedidos p
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) DESC NULLS LAST, p.created_at DESC
       LIMIT $${i - 2} OFFSET $${i - 1}
    )
    SELECT p.*,
           c.nombre  AS cliente_nombre,
           c.telefono AS cliente_telefono,
           c.email AS cliente_email,
           c.email_facturacion AS cliente_email_facturacion,
           c.emails_albaranes AS cliente_emails_albaranes,
           NULL AS colaborador_nombre,
           NULL AS colaborador_cif,
           NULL AS colaborador_telefono,
           NULL AS colaborador_email,
           ch.nombre AS chofer_nombre,
           v.matricula AS vehiculo_matricula,
           r.matricula AS remolque_matricula,
           f.estado AS factura_estado,
           f.numero AS factura_numero,
           COALESCE(docs.documentos_count,0)::int AS documentos_count,
           COALESCE(docs.albaranes_count,0)::int AS albaranes_count
    FROM filtered p
    LEFT JOIN clientes  c  ON c.id  = p.cliente_id AND c.empresa_id = p.empresa_id
    LEFT JOIN choferes  ch ON ch.id = p.chofer_id AND ch.empresa_id = p.empresa_id
    LEFT JOIN vehiculos v  ON v.id  = p.vehiculo_id AND v.empresa_id = p.empresa_id
    LEFT JOIN vehiculos r  ON r.id  = p.remolque_id AND r.empresa_id = p.empresa_id
    LEFT JOIN facturas  f  ON f.id  = p.factura_id AND f.empresa_id = p.empresa_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS documentos_count,
             COUNT(*) FILTER (
               WHERE LOWER(COALESCE(d.tipo,'') || ' ' || COALESCE(d.nombre,'') || ' ' || COALESCE(d.notas,'')) LIKE '%albar%'
             )::int AS albaranes_count
        FROM pedido_docs d
       WHERE d.pedido_id = p.id AND d.empresa_id = p.empresa_id
    ) docs ON true
    ORDER BY COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) DESC NULLS LAST, p.created_at DESC
  `, [...params, limit, offset]);

  // Get total count for pagination (params already excludes limit/offset)
  const countWhere = where.join(" AND ");
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) FROM pedidos p WHERE ${countWhere}`,
    params
  );
  const total = parseInt(countRows[0].count);
  const pageN = parseInt(req.query.page || 1);
  const limitN = parseInt(req.query.limit || 50);

  res.json({
    data: rows,
    pagination: {
      total,
      page: pageN,
      limit: limitN,
      totalPages: Math.ceil(total / limitN),
      hasNext: pageN * limitN < total,
      hasPrev: pageN > 1,
    }
  });
});

// GET /pedidos/resumen-lista - listado operativo ligero para pantallas de trafico
router.get("/resumen-lista", async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const { estado, cliente_id, chofer_id, desde, hasta, facturado, pendiente_completar, tipo_carga, q, page = 1, limit = 100 } = req.query;
    const pageN = Math.max(Number(page) || 1, 1);
    const limitN = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    const offset = (pageN - 1) * limitN;
    const empresaId = req.empresaId || req.user.empresa_id;
    const where = ["p.empresa_id = $1"];
    const params = [empresaId];
    let i = 2;

    if (estado) {
      const estados = String(estado).split(",").map(s => s.trim()).filter(Boolean);
      if (estados.length === 1) {
        where.push(`p.estado::text = $${i++}`);
        params.push(estados[0]);
      } else if (estados.length > 1) {
        where.push(`p.estado::text = ANY($${i++}::text[])`);
        params.push(estados);
      }
    }
    if (cliente_id) { where.push(`p.cliente_id = $${i++}`); params.push(cliente_id); }
    if (req.user?.rol === "chofer") {
      const access = await getChoferAccessForUser(req.user, empresaId);
      if (!access.choferIds.length && !access.vehiculoIds.length) {
        return res.json({ data: [], pagination: { total: 0, page: pageN, limit: limitN, totalPages: 0, hasNext: false, hasPrev: pageN > 1 } });
      }
      const ownClauses = [];
      if (access.choferIds.length) {
        ownClauses.push(`(p.chofer_id = ANY($${i}::uuid[]) OR p.chofer2_id = ANY($${i}::uuid[]))`);
        params.push(access.choferIds);
        i++;
      }
      if (access.vehiculoIds.length) {
        ownClauses.push(`p.vehiculo_id = ANY($${i++}::uuid[])`);
        params.push(access.vehiculoIds);
      }
      where.push(`(${ownClauses.join(" OR ")})`);
    } else if (chofer_id) {
      where.push(`(p.chofer_id = $${i} OR p.chofer2_id = $${i++})`);
      params.push(chofer_id);
    }
    if (req.user?.rol === "trafico" && !traficoConfigIsOpen(req.user.trafico_config)) {
      const scope = normalizeTraficoConfig(req.user.trafico_config);
      if (scope.vehiculo_ids.length) {
        where.push(`p.vehiculo_id = ANY($${i++}::uuid[])`);
        params.push(scope.vehiculo_ids);
      }
      if (scope.tipos_viaje.length && scope.tipos_viaje.length < 3) {
        where.push(`COALESCE(p.tipo_viaje,'normal') = ANY($${i++}::text[])`);
        params.push(scope.tipos_viaje);
      }
    }
    if (desde) { where.push(`COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) >= $${i++}`); params.push(desde); }
    if (hasta) { where.push(`COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) <= $${i++}`); params.push(hasta); }
    if (pendiente_completar === "true") where.push("p.pendiente_completar IS TRUE");
    if (pendiente_completar === "false") where.push("COALESCE(p.pendiente_completar,false) IS FALSE");
    if (tipo_carga) { where.push(`COALESCE(p.tipo_carga,'') = $${i++}`); params.push(tipo_carga); }
    if (facturado === "false") where.push("(p.factura_id IS NULL OR f.estado='borrador')");
    if (facturado === "true") where.push("p.factura_id IS NOT NULL AND COALESCE(f.estado,'')<>'borrador'");
    if (q) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      where.push(`(
        LOWER(COALESCE(p.numero,'')) LIKE $${i}
        OR LOWER(COALESCE(p.origen,'')) LIKE $${i}
        OR LOWER(COALESCE(p.destino,'')) LIKE $${i}
        OR LOWER(COALESCE(p.referencia_cliente,'')) LIKE $${i}
        OR EXISTS (
          SELECT 1 FROM clientes c2
          WHERE c2.id=p.cliente_id AND c2.empresa_id=p.empresa_id AND LOWER(COALESCE(c2.nombre,'')) LIKE $${i}
        )
        OR EXISTS (
          SELECT 1 FROM colaboradores co2
          WHERE co2.id=p.colaborador_id AND co2.empresa_id=p.empresa_id AND LOWER(COALESCE(co2.nombre,'')) LIKE $${i}
        )
      )`);
      i++;
    }

    const { rows } = await queryWithColaboradorFallback(`
      SELECT p.id, p.numero, p.empresa_id, p.cliente_id, p.colaborador_id,
             p.vehiculo_id, p.chofer_id, p.chofer2_id, p.remolque_id,
             p.fecha_pedido, p.fecha_carga, p.fecha_descarga, p.fecha_entrega,
             p.hora_carga, p.hora_descarga, p.ventana_carga, p.ventana_descarga,
             p.puntos_carga, p.puntos_descarga, p.origen, p.destino, p.referencia_cliente,
             p.mercancia, p.peso_kg, p.bultos, p.importe, p.precio_colaborador,
             p.km_ruta, p.km_vacio, p.estado::text AS estado, p.pendiente_completar,
             p.notas, p.incidencia_tipo, p.incidencia_descripcion, p.incidencia_origen,
             p.incidencia_creada_at, p.incidencia_automatica, p.paralizacion_minutos,
             p.paralizacion_importe, p.paralizacion_moneda, p.paralizacion_norma, p.paralizacion_pais,
             p.tipo_carga, p.tipo_viaje, p.factura_id,
             c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.email AS cliente_email,
             co.nombre AS colaborador_nombre, co.telefono AS colaborador_telefono, co.email AS colaborador_email,
             ch.nombre AS chofer_nombre,
             v.matricula AS vehiculo_matricula,
             r.matricula AS remolque_matricula,
             f.estado AS factura_estado,
             f.numero AS factura_numero,
             0::int AS documentos_count,
             0::int AS albaranes_count
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
        LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
        LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
        LEFT JOIN vehiculos r ON r.id=p.remolque_id AND r.empresa_id=p.empresa_id
        LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) DESC NULLS LAST, p.created_at DESC
       LIMIT $${i++} OFFSET $${i++}
    `, `
      SELECT p.id, p.numero, p.empresa_id, p.cliente_id, p.colaborador_id,
             p.vehiculo_id, p.chofer_id, p.chofer2_id, p.remolque_id,
             p.fecha_pedido, p.fecha_carga, p.fecha_descarga, p.fecha_entrega,
             p.hora_carga, p.hora_descarga, p.ventana_carga, p.ventana_descarga,
             p.puntos_carga, p.puntos_descarga, p.origen, p.destino, p.referencia_cliente,
             p.mercancia, p.peso_kg, p.bultos, p.importe, p.precio_colaborador,
             p.km_ruta, p.km_vacio, p.estado::text AS estado, p.pendiente_completar,
             p.notas, p.incidencia_tipo, p.incidencia_descripcion, p.incidencia_origen,
             p.incidencia_creada_at, p.incidencia_automatica, p.paralizacion_minutos,
             p.paralizacion_importe, p.paralizacion_moneda, p.paralizacion_norma, p.paralizacion_pais,
             p.tipo_carga, p.tipo_viaje, p.factura_id,
             c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.email AS cliente_email,
             NULL AS colaborador_nombre, NULL AS colaborador_telefono, NULL AS colaborador_email,
             ch.nombre AS chofer_nombre,
             v.matricula AS vehiculo_matricula,
             r.matricula AS remolque_matricula,
             f.estado AS factura_estado,
             f.numero AS factura_numero,
             0::int AS documentos_count,
             0::int AS albaranes_count
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
        LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
        LEFT JOIN vehiculos r ON r.id=p.remolque_id AND r.empresa_id=p.empresa_id
        LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) DESC NULLS LAST, p.created_at DESC
       LIMIT $${i - 2} OFFSET $${i - 1}
    `, [...params, limitN, offset]);

    const totalAproximado = offset + rows.length + (rows.length === limitN ? 1 : 0);
    res.json({
      data: rows,
      pagination: {
        total: totalAproximado,
        page: pageN,
        limit: limitN,
        totalPages: rows.length === limitN ? pageN + 1 : pageN,
        hasNext: rows.length === limitN,
        hasPrev: pageN > 1,
        approximate: true,
      },
    });
  } catch (e) {
    logger.error("Error en resumen-lista de pedidos:", e.message);
    res.status(500).json({ error: e.message || "No se pudo cargar el resumen de pedidos" });
  }
});

// GET /pedidos/:id
router.post("/:id/colaborador/notificar", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const pedido = await getPedidoColaboradorData(req.params.id, empresaId);
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!pedido.colaborador_id) return res.status(400).json({ error: "Este pedido no tiene colaborador asignado" });
    if (!pedido.colaborador_email) return res.status(400).json({ error: "El colaborador no tiene email configurado" });
    if (!Number(pedido.precio_colaborador || 0)) return res.status(400).json({ error: "Indica el precio acordado con el colaborador antes de enviar el enlace" });
    if (pedido.colaborador_workflow_enviado_at && !req.body?.force) {
      return res.json({ ok: true, already: true, message: "El flujo del colaborador ya estaba enviado" });
    }

    const token = await createColaboradorToken(pedido, "confirmar", 360);
    await sendColaboradorEmail(req, pedido, "confirmar", token);
    await db.query(
      "UPDATE pedidos SET colaborador_workflow_enviado_at=NOW() WHERE id=$1 AND empresa_id=$2",
      [pedido.id, empresaId]
    );
    res.json({ ok: true, already: false });
  } catch (e) {
    logger.error("Error notificando colaborador:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/documento-control-repositorio", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureDocumentoControlRepositorioSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const limit = Math.min(Math.max(Number(req.query.limit || 100) || 100, 1), 500);
    const estado = String(req.query.estado || "").trim().toLowerCase();
    const q = String(req.query.q || "").trim();
    const where = ["empresa_id=$1"];
    const params = [empresaId];
    let i = 2;
    if (estado) {
      where.push(`estado=$${i++}`);
      params.push(estado);
    }
    if (q) {
      where.push(`(pedido_numero ILIKE $${i} OR cliente_nombre ILIKE $${i} OR codigo_control ILIKE $${i})`);
      params.push(`%${q}%`);
      i += 1;
    }
    const { rows } = await db.query(`
      SELECT id, pedido_id, codigo_control, pedido_numero, cliente_nombre, estado, activo,
             filename, pdf_filename, export_filename, payload_hash_sha256, html_hash_sha256, pdf_hash_sha256,
             public_activo, public_expires_at, public_desactivado_at,
             archivado_at, retencion_minima_hasta, retencion_politica, created_at, updated_at
        FROM documento_control_repositorio
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(archivado_at, updated_at, created_at) DESC
       LIMIT $${i}
    `, [...params, limit]);
    res.json({
      data: rows,
      total: rows.length,
      governance: {
        tenant_isolation: "empresa_id",
        storage: "repositorio propio TransGest por empresa",
        external_provider_required: false,
        finalized_trip_policy: "Al entregar el viaje, el DCD queda archivado/desactivado para edicion operativa. La descarga publica puede caducar/desactivarse y el PDF interno se conserva minimo 1 ano.",
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo cargar el repositorio DCD" });
  }
});

router.get("/documento-control-repositorio/:repoId", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureDocumentoControlRepositorioSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      `SELECT id, empresa_id, pedido_id, codigo_control, pedido_numero, cliente_nombre, estado, activo,
              payload, expediente, export_json, filename, pdf_mime, pdf_filename, payload_hash_sha256, html_hash_sha256, pdf_hash_sha256,
              public_activo, public_expires_at, public_desactivado_at, created_metadata, updated_metadata,
              export_filename, archivado_at, archivado_por, retencion_minima_hasta, retencion_politica, created_at, updated_at
         FROM documento_control_repositorio
        WHERE id=$1 AND empresa_id=$2
        LIMIT 1`,
      [req.params.repoId, empresaId]
    );
    const repo = rows[0];
    if (!repo) return res.status(404).json({ error: "DCD no encontrado en el repositorio" });
    const hist = await db.query(`
      SELECT h.id,h.version,h.action,h.payload_hash_sha256,h.html_hash_sha256,h.pdf_hash_sha256,h.metadata,h.created_at,
             u.nombre AS created_by_nombre,u.rol AS created_by_rol
        FROM documento_control_repositorio_historial h
        LEFT JOIN usuarios u ON u.id=h.created_by
       WHERE h.repo_id=$1 AND h.empresa_id=$2
       ORDER BY h.version DESC
       LIMIT 100
    `, [repo.id, empresaId]).catch(() => ({ rows: [] }));
    res.json({ ...repo, historial: hist.rows || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo cargar el DCD archivado" });
  }
});

router.get("/documento-control-repositorio/:repoId/descargar", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureDocumentoControlRepositorioSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      `SELECT id, pedido_id, codigo_control, html, filename, pdf_base64, pdf_mime, pdf_filename, estado, activo
         FROM documento_control_repositorio
        WHERE id=$1 AND empresa_id=$2
        LIMIT 1`,
      [req.params.repoId, empresaId]
    );
    const repo = rows[0];
    if (!repo) return res.status(404).send("DCD no encontrado en el repositorio");
    await logPedidoEvento(repo.pedido_id, empresaId, "documento_control.repositorio_descargado", {
      repositorio_id: repo.id,
      codigo_control: repo.codigo_control,
      estado: repo.estado,
      activo: repo.activo,
    }, req.user?.rol || "usuario", req.user?.id || null).catch(() => {});
    res.setHeader("Cache-Control", "private, no-store");
    if (repo.pdf_base64 && !["html", "1", "true"].includes(String(req.query.html || req.query.format || "").toLowerCase())) {
      res.setHeader("Content-Disposition", `attachment; filename="${repo.pdf_filename || repo.filename || "documento-control.pdf"}"`);
      res.setHeader("Content-Type", repo.pdf_mime || "application/pdf");
      return res.send(Buffer.from(repo.pdf_base64, "base64"));
    }
    res.setHeader("Content-Disposition", `attachment; filename="${repo.filename || "documento-control.html"}"`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(repo.html);
  } catch (e) {
    res.status(500).send(e.message || "No se pudo descargar el DCD archivado");
  }
});

router.patch("/documento-control-repositorio/:repoId/publico", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureDocumentoControlRepositorioSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const activo = req.body?.activo !== false;
    const expiresAtRaw = req.body?.public_expires_at || req.body?.expires_at || null;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    const { rows } = await db.query(`
      UPDATE documento_control_repositorio
         SET public_activo=$3,
             public_expires_at=CASE
               WHEN $4::timestamptz IS NOT NULL THEN $4::timestamptz
               ELSE public_expires_at
             END,
             public_desactivado_at=CASE WHEN $3=false THEN NOW() ELSE NULL END,
             public_desactivado_por=CASE WHEN $3=false THEN $5 ELSE NULL END,
             updated_at=NOW()
       WHERE id=$1 AND empresa_id=$2
       RETURNING id,empresa_id,pedido_id,codigo_control,public_activo,public_expires_at,public_desactivado_at,payload_hash_sha256,html_hash_sha256,pdf_hash_sha256
    `, [
      req.params.repoId,
      empresaId,
      activo,
      expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      req.user?.id || null,
    ]);
    const repo = rows[0];
    if (!repo) return res.status(404).json({ error: "DCD no encontrado en el repositorio" });
    await insertDocumentoControlRepoHistory(repo, {
      public_activo: repo.public_activo,
      public_expires_at: repo.public_expires_at,
      public_desactivado_at: repo.public_desactivado_at,
    }, req.user?.id || null, activo ? "reactivar_descarga_publica" : "desactivar_descarga_publica").catch(() => {});
    await logPedidoEvento(repo.pedido_id, empresaId, activo ? "documento_control.publico_reactivado" : "documento_control.publico_desactivado", {
      repositorio_id: repo.id,
      codigo_control: repo.codigo_control,
      public_activo: repo.public_activo,
      public_expires_at: repo.public_expires_at,
      public_desactivado_at: repo.public_desactivado_at,
    }, req.user?.rol || "usuario", req.user?.id || null).catch(() => {});
    res.json({ ok: true, data: repo });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo cambiar la descarga publica del DCD" });
  }
});

router.get("/documento-control-repositorio/:repoId/export", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureDocumentoControlRepositorioSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      `SELECT id, pedido_id, codigo_control, export_json, export_filename, estado, activo
         FROM documento_control_repositorio
        WHERE id=$1 AND empresa_id=$2
        LIMIT 1`,
      [req.params.repoId, empresaId]
    );
    const repo = rows[0];
    if (!repo) return res.status(404).json({ error: "DCD no encontrado en el repositorio" });
    await logPedidoEvento(repo.pedido_id, empresaId, "documento_control.repositorio_exportado", {
      repositorio_id: repo.id,
      codigo_control: repo.codigo_control,
      estado: repo.estado,
      activo: repo.activo,
      formato: "json_efti_ecmr_ready",
    }, req.user?.rol || "usuario", req.user?.id || null).catch(() => {});
    res.setHeader("Content-Disposition", `attachment; filename="${repo.export_filename || "dcd-export.json"}"`);
    res.json(repo.export_json || {});
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo exportar el DCD archivado" });
  }
});

router.get("/:id/colaborador/preview", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const pedido = await getPedidoColaboradorData(req.params.id, empresaId);
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!pedido.colaborador_id) return res.status(400).json({ error: "Este pedido no tiene colaborador asignado" });
    const docControl = await getColaboradorDocumentoControlPayload(req, pedido.pedido_id || pedido.id, empresaId);
    const preview = renderColaboradorConfirmacionPreview(pedido, docControl);
    res.json({
      ok: true,
      pedido_id: pedido.id,
      numero: pedido.numero || null,
      colaborador: pedido.colaborador_nombre || null,
      ...preview,
    });
  } catch (e) {
    logger.error("Error previsualizando colaborador:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/documento-control-digital", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const ctx = await getPedidoDocumentoControlContext(req.params.id, empresaId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (req.user?.rol === "chofer" && !(await usuarioPuedeGestionarPedido(req, ctx.pedido))) {
      return res.status(403).json({ error: "No puedes acceder a este pedido" });
    }
    res.json(await buildPedidoDocumentoControlResponse(req, ctx, empresaId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/documento-control-digital/generar", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const ctx = await getPedidoDocumentoControlContext(req.params.id, empresaId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const repo = await archivarDocumentoControlPedido({
      pedidoId: req.params.id,
      empresaId,
      appBaseUrl: publicBaseUrl(req),
      userId: req.user?.id || null,
      motivo: "generacion_manual",
    });
    const refreshed = await getPedidoDocumentoControlContext(req.params.id, empresaId);
    res.json({
      ok: true,
      repositorio: repo,
      ...(await buildPedidoDocumentoControlResponse(req, refreshed || ctx, empresaId)),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo generar el DeCA" });
  }
});

router.get("/:id/documento-control-digital/export", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const ctx = await getPedidoDocumentoControlContext(req.params.id, empresaId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const payload = buildDocumentoControlPayload({
      empresaId,
      pedido: ctx.pedido,
      empresa: ctx.empresa,
      cliente: ctx.cliente,
      colaborador: ctx.colaborador,
      appBaseUrl: publicBaseUrl(req),
    });
    const exportData = buildDocumentoControlStructuredExport(payload);
    await syncPedidoRegulatoryCore({
      empresaId,
      pedidoId: req.params.id,
      payload,
      structuredExport: exportData,
      userId: req.user?.id || null,
      reason: "export_documento_control",
    }).catch(e => logger.warn("No se pudo sincronizar payload eFTI/DIWASS:", e.message));
    await logPedidoEvento(req.params.id, empresaId, "documento_control.exportado", {
      codigo_control: payload.documento?.codigo_control || "",
      formato: "json_efti_ecmr_ready",
      filename: exportData.audit?.export_filename || "",
      integrity_hash_sha256: exportData.audit?.integrity_hash_sha256 || "",
      ready: !!payload.status?.ready,
    }, req.user?.rol || "usuario", req.user?.id || null);
    res.json(exportData);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo generar la exportacion documental" });
  }
});

router.get("/:id/documento-control-digital/firma-paquete", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const ctx = await getPedidoDocumentoControlContext(req.params.id, empresaId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const payload = buildDocumentoControlPayload({
      empresaId,
      pedido: ctx.pedido,
      empresa: ctx.empresa,
      cliente: ctx.cliente,
      colaborador: ctx.colaborador,
      appBaseUrl: publicBaseUrl(req),
    });
    const signaturePackage = buildDocumentoControlSignaturePackage(payload, {
      firma_fecha: ctx.pedido?.firma_fecha,
      firma_nombre: ctx.pedido?.firma_nombre,
      firma_hash: ctx.pedido?.firma_hash,
      evidencia: ctx.pedido?.firma_evidencia,
    });
    await logPedidoEvento(req.params.id, empresaId, "documento_control.firma_paquete_exportado", {
      codigo_control: payload.documento?.codigo_control || "",
      filename: signaturePackage.document?.signature_package_filename || "",
      payload_hash_sha256: signaturePackage.hashes?.payload_hash_sha256 || "",
      signature_package_hash_sha256: signaturePackage.hashes?.signature_package_hash_sha256 || "",
      ready: !!payload.status?.ready,
    }, req.user?.rol || "usuario", req.user?.id || null);
    res.setHeader("Content-Disposition", `attachment; filename="${signaturePackage.document?.signature_package_filename || "deca-firma-eidas.json"}"`);
    res.json(signaturePackage);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo generar el paquete de firma eIDAS" });
  }
});

router.get("/:id/regulatory-core", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const ctx = await getPedidoDocumentoControlContext(req.params.id, empresaId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const payload = buildDocumentoControlPayload({
      empresaId,
      pedido: ctx.pedido,
      empresa: ctx.empresa,
      cliente: ctx.cliente,
      colaborador: ctx.colaborador,
      appBaseUrl: publicBaseUrl(req),
    });
    const structuredExport = buildDocumentoControlStructuredExport(payload);
    const synced = await syncPedidoRegulatoryCore({
      empresaId,
      pedidoId: req.params.id,
      payload,
      structuredExport,
      userId: req.user?.id || null,
      reason: "regulatory_core_view",
    });
    const summary = await getPedidoRegulatoryCoreSummary(req.params.id, empresaId);
    res.json({ ok: true, synced, summary });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo preparar el nucleo regulatorio" });
  }
});

async function syncRegulatoryCoreForPedido(req, pedidoId, empresaId, reason = "regulatory_core_sync") {
  const ctx = await getPedidoDocumentoControlContext(pedidoId, empresaId);
  if (!ctx?.pedido) return null;
  const payload = buildDocumentoControlPayload({
    empresaId,
    pedido: ctx.pedido,
    empresa: ctx.empresa,
    cliente: ctx.cliente,
    colaborador: ctx.colaborador,
    appBaseUrl: publicBaseUrl(req),
  });
  const structuredExport = buildDocumentoControlStructuredExport(payload);
  await syncPedidoRegulatoryCore({
    empresaId,
    pedidoId,
    payload,
    structuredExport,
    userId: req.user?.id || null,
    reason,
  });
  return { ctx, payload, structuredExport };
}

router.get("/:id/regulatory-core/export", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const synced = await syncRegulatoryCoreForPedido(req, req.params.id, empresaId, "regulatory_transport_package_export");
    if (!synced?.ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const pkg = await buildRegulatoryTransportPackage(req.params.id, empresaId, {
      includePayloadBodies: req.query?.include_payloads !== "false",
    });
    if (!pkg) return res.status(404).json({ error: "Paquete regulatorio no encontrado" });
    await logPedidoEvento(req.params.id, empresaId, "regulatory_core.package_exported", {
      package_hash_sha256: pkg.package_hash_sha256,
      checklist_status: pkg.regulatory_readiness?.checklist_status || "",
      include_payloads: req.query?.include_payloads !== "false",
    }, req.user?.rol || "usuario", req.user?.id || null).catch(() => {});
    const filename = `transgest-regulatory-package-${synced.ctx.pedido.numero || req.params.id}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]+/g, "-")}"`);
    res.json(pkg);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo exportar el paquete regulatorio" });
  }
});

router.get("/:id/regulatory-core/dossier.pdf", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const synced = await syncRegulatoryCoreForPedido(req, req.params.id, empresaId, "regulatory_dossier_pdf_export");
    if (!synced?.ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const pkg = await buildRegulatoryTransportPackage(req.params.id, empresaId, { includePayloadBodies: false });
    if (!pkg?.certification_dossier) return res.status(404).json({ error: "Dossier regulatorio no encontrado" });
    const pdf = await generateRegulatoryDossierPdf(pkg.certification_dossier);
    await logPedidoEvento(req.params.id, empresaId, "regulatory_core.dossier_pdf_exported", {
      dossier_hash_sha256: pkg.certification_dossier.dossier_hash_sha256,
      pdf_hash_sha256: pdf.hash_sha256,
      readiness_score: pkg.certification_dossier.readiness_score,
      checklist_status: pkg.regulatory_readiness?.checklist_status || "",
    }, req.user?.rol || "usuario", req.user?.id || null).catch(() => {});
    res.setHeader("Content-Type", pdf.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${pdf.filename.replace(/[^a-zA-Z0-9._-]+/g, "-")}"`);
    res.send(pdf.buffer);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo generar el dossier regulatorio" });
  }
});

router.get("/:id/regulatory-core/payload/:type", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const synced = await syncRegulatoryCoreForPedido(req, req.params.id, empresaId, `regulatory_payload_${req.params.type}_export`);
    if (!synced?.ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const payload = await getRegulatoryPayloadForExport(req.params.id, empresaId, req.params.type);
    if (!payload) return res.status(404).json({ error: "Payload regulatorio no encontrado" });
    await logPedidoEvento(req.params.id, empresaId, "regulatory_core.payload_exported", {
      payload_type: payload.payload_type,
      version: payload.version,
      hash_sha256: payload.hash_sha256,
      status: payload.status,
    }, req.user?.rol || "usuario", req.user?.id || null).catch(() => {});
    const filename = `transgest-${payload.payload_type}-payload-${synced.ctx.pedido.numero || req.params.id}-v${payload.version || 1}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]+/g, "-")}"`);
    res.json({
      schema: `transgest.regulatory.payload_export.${payload.payload_type}.v1`,
      exported_at: new Date().toISOString(),
      pedido_id: req.params.id,
      pedido_numero: synced.ctx.pedido.numero || null,
      payload,
      governance: {
        official_exchange: "No enviado a plataforma externa en esta exportacion.",
        hash_sha256: payload.hash_sha256,
        version: payload.version,
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo exportar el payload regulatorio" });
  }
});

router.post("/:id/regulatory-core/transmission-draft", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const payloadType = String(req.body?.payload_type || "efti").trim().toLowerCase();
    const provider = String(req.body?.provider || "certified_platform_pending").trim();
    const synced = await syncRegulatoryCoreForPedido(req, req.params.id, empresaId, `regulatory_transmission_draft_${payloadType}`);
    if (!synced?.ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const draft = await createRegulatoryTransmissionDraft({
      empresaId,
      pedidoId: req.params.id,
      payloadType,
      provider,
      userId: req.user?.id || null,
    });
    await logPedidoEvento(req.params.id, empresaId, "regulatory_core.transmission_draft_created", {
      payload_type: draft?.payload_type,
      provider: draft?.provider,
      status: draft?.status,
      request_hash_sha256: draft?.request_hash_sha256,
      idempotency_key: draft?.idempotency_key,
    }, req.user?.rol || "usuario", req.user?.id || null).catch(() => {});
    res.status(201).json({
      ok: true,
      draft,
      note: "Borrador creado. No se ha enviado informacion a una plataforma externa.",
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo crear el borrador de transmision regulatoria" });
  }
});

router.post("/:id/documento-control-digital/evento", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const ctx = await getPedidoDocumentoControlContext(req.params.id, empresaId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (req.user?.rol === "chofer" && !(await usuarioPuedeGestionarPedido(req, ctx.pedido))) {
      return res.status(403).json({ error: "No puedes acceder a este pedido" });
    }

    const action = String(req.body?.action || "consultado").trim().toLowerCase();
    const allowed = new Set(["abierto", "impreso", "descargado", "copiado", "compartido", "consultado", "revisado", "disponible", "remitido"]);
    const normalizedAction = allowed.has(action) ? action : "consultado";
    const payload = buildDocumentoControlPayload({
      empresaId,
      pedido: ctx.pedido,
      empresa: ctx.empresa,
      cliente: ctx.cliente,
      colaborador: ctx.colaborador,
      appBaseUrl: publicBaseUrl(req),
    });
    const isRemisionFormal = normalizedAction === "remitido";
    if (isRemisionFormal && !["gerente", "trafico"].includes(String(req.user?.rol || ""))) {
      return res.status(403).json({ error: "Solo gerencia o trafico pueden marcar la remision formal del documento de control." });
    }
    const firmaPostSignatureIntegrity = buildFirmaPostSignatureIntegrity(ctx.pedido, ctx.pedido?.firma_evidencia || null);
    if (isRemisionFormal && firmaPostSignatureIntegrity.changed_after_signature) {
      if (req.user?.rol !== "gerente" || req.body?.confirmar_firma_modificada !== true) {
        return res.status(409).json({
          error: req.user?.rol === "gerente"
            ? "La firma del pedido tiene cambios posteriores. Gerencia debe confirmar expresamente la remision."
            : "La firma del pedido tiene cambios posteriores. Requiere confirmacion de gerencia antes de remitir.",
          requiere_confirmacion: true,
          requiere_gerente: true,
          firma_modificada: true,
          changes: firmaPostSignatureIntegrity.changes,
          signed_context_hash_sha256: firmaPostSignatureIntegrity.signed_context_hash_sha256,
          current_context_hash_sha256: firmaPostSignatureIntegrity.current_context_hash_sha256,
        });
      }
    }
    if (isRemisionFormal && !payload.status?.ready) {
      const faltantes = Array.isArray(payload.status?.faltantes) ? payload.status.faltantes : [];
      const score = Number(payload.status?.readiness?.score || 0);
      if (req.user?.rol !== "gerente" || req.body?.confirmar_remision_incompleta !== true) {
        return res.status(409).json({
          error: req.user?.rol === "gerente"
            ? "El documento de control no esta listo. Gerencia debe confirmar expresamente la remision incompleta."
            : "El documento de control no esta listo. Requiere confirmacion de gerencia antes de remitir.",
          requiere_confirmacion: true,
          requiere_gerente: true,
          dcd_incompleto: true,
          score,
          faltantes,
          avisos: Array.isArray(payload.status?.avisos) ? payload.status.avisos : [],
          summary: payload.status?.summary || "",
        });
      }
    }

    await logPedidoEvento(req.params.id, empresaId, "documento_control." + normalizedAction, {
      codigo_control: payload.documento?.codigo_control || "",
      sistema: payload.documento?.sistema || "",
      ready: !!payload.status?.ready,
      remision_incompleta_confirmada: isRemisionFormal && !payload.status?.ready && req.body?.confirmar_remision_incompleta === true,
      firma_modificada_confirmada: isRemisionFormal && firmaPostSignatureIntegrity.changed_after_signature && req.body?.confirmar_firma_modificada === true,
      firma_post_signature_integrity: isRemisionFormal ? {
        changed_after_signature: !!firmaPostSignatureIntegrity.changed_after_signature,
        changes: firmaPostSignatureIntegrity.changes || [],
        signed_context_hash_sha256: firmaPostSignatureIntegrity.signed_context_hash_sha256 || "",
        current_context_hash_sha256: firmaPostSignatureIntegrity.current_context_hash_sha256 || "",
      } : undefined,
      readiness_score: payload.status?.readiness?.score ?? null,
      faltantes: isRemisionFormal ? (payload.status?.faltantes || []) : undefined,
      canal: payload.remision?.canal || "",
      source: req.body?.source || (req.user?.rol === "chofer" ? "app_chofer" : "pedidos"),
    }, req.user?.rol || "usuario", req.user?.id || null);

    res.json({
      ok: true,
      action: normalizedAction,
      ready: !!payload.status?.ready,
      remision_incompleta_confirmada: isRemisionFormal && !payload.status?.ready && req.body?.confirmar_remision_incompleta === true,
      firma_modificada_confirmada: isRemisionFormal && firmaPostSignatureIntegrity.changed_after_signature && req.body?.confirmar_firma_modificada === true,
      firma_post_signature_integrity: isRemisionFormal ? firmaPostSignatureIntegrity : undefined,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/planificacion-ia", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows: pedidoRows } = await db.query(
      `SELECT p.*
         FROM pedidos p
        WHERE p.id=$1 AND p.empresa_id=$2
        LIMIT 1`,
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes planificar este pedido" });
    }

    const originCoord = firstPedidoStopWithCoords(pedido);
    const originText = originCoord?.text || pedido.origen || "";
    const fechaCarga = dateOnly(pedido.fecha_carga);
    const fechaDesde = fechaCarga ? new Date(`${fechaCarga}T00:00:00.000Z`) : null;
    const fechaHasta = fechaDesde ? new Date(fechaDesde.getTime() + 36 * 60 * 60 * 1000) : null;

    const [vehiculosRes, conflictsRes] = await Promise.all([
      db.query(
        `SELECT v.id, v.matricula, v.clase, v.tipo, v.estado, v.carga_max_kg,
                v.remolque_id, (SELECT rv.matricula FROM vehiculos rv WHERE rv.id = v.remolque_id) AS remolque_matricula, v.chofer_id,
                v.ubicacion_actual, v.ubicacion_fuente, v.ubicacion_ts,
                v.gps_provider, v.gps_external_id, v.gps_lat, v.gps_lng,
                ch.id AS chofer_id_resuelto, ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos,
                ch.telefono AS chofer_telefono, ch.vehiculo_id AS chofer_vehiculo_id,
                j.estado AS jornada_estado, j.actividad_actual, j.inicio_at AS jornada_inicio_at,
                j.eventos AS jornada_eventos, j.updated_at AS jornada_updated_at,
                gps.lat AS gps_log_lat, gps.lng AS gps_log_lng, gps.ubicacion AS gps_log_ubicacion,
                gps.provider AS gps_log_provider, gps.raw AS gps_log_raw, gps.recorded_at AS gps_log_recorded_at,
                app.lat AS app_log_lat, app.lng AS app_log_lng, app.ubicacion AS app_log_ubicacion,
                app.recorded_at AS app_log_recorded_at
           FROM vehiculos v
           LEFT JOIN choferes ch
             ON ch.empresa_id=v.empresa_id
            AND COALESCE(ch.activo,true)=true
            AND (ch.id=v.chofer_id OR (v.chofer_id IS NULL AND ch.vehiculo_id=v.id))
           LEFT JOIN LATERAL (
             SELECT *
               FROM chofer_jornadas j
              WHERE j.empresa_id=v.empresa_id
                AND j.estado='abierta'
                AND (j.vehiculo_id=v.id OR (ch.id IS NOT NULL AND j.chofer_id=ch.id))
              ORDER BY j.updated_at DESC
              LIMIT 1
           ) j ON true
           LEFT JOIN LATERAL (
             SELECT lat,lng,ubicacion,provider,raw,recorded_at
               FROM gps_position_log l
              WHERE l.empresa_id=v.empresa_id
                AND l.vehiculo_id=v.id
                AND l.provider NOT IN ('app_chofer','manual')
                AND l.lat IS NOT NULL AND l.lng IS NOT NULL
              ORDER BY l.recorded_at DESC
              LIMIT 1
           ) gps ON true
           LEFT JOIN LATERAL (
             SELECT lat,lng,ubicacion,recorded_at
               FROM gps_position_log l
              WHERE l.empresa_id=v.empresa_id
                AND l.vehiculo_id=v.id
                AND l.provider='app_chofer'
                AND l.lat IS NOT NULL AND l.lng IS NOT NULL
              ORDER BY l.recorded_at DESC
              LIMIT 1
           ) app ON true
          WHERE v.empresa_id=$1
            AND COALESCE(v.activo,true)=true
            AND LOWER(COALESCE(v.clase, v.tipo, '')) NOT LIKE '%remolque%'
          ORDER BY v.matricula ASC`,
        [empresaId]
      ).catch(async () => db.query(
        `SELECT v.id, v.matricula, v.clase, v.tipo, v.estado, v.carga_max_kg,
                v.remolque_id, (SELECT rv.matricula FROM vehiculos rv WHERE rv.id = v.remolque_id) AS remolque_matricula, v.chofer_id,
                v.ubicacion_actual, v.ubicacion_fuente, v.ubicacion_ts,
                v.gps_provider, v.gps_external_id, v.gps_lat, v.gps_lng,
                ch.id AS chofer_id_resuelto, ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos,
                ch.telefono AS chofer_telefono, ch.vehiculo_id AS chofer_vehiculo_id,
                NULL::text AS jornada_estado, NULL::text AS actividad_actual, NULL::timestamptz AS jornada_inicio_at,
                '[]'::jsonb AS jornada_eventos, NULL::timestamptz AS jornada_updated_at,
                NULL::numeric AS gps_log_lat, NULL::numeric AS gps_log_lng, NULL::text AS gps_log_ubicacion,
                NULL::text AS gps_log_provider, NULL::jsonb AS gps_log_raw, NULL::timestamptz AS gps_log_recorded_at,
                NULL::numeric AS app_log_lat, NULL::numeric AS app_log_lng, NULL::text AS app_log_ubicacion,
                NULL::timestamptz AS app_log_recorded_at
           FROM vehiculos v
           LEFT JOIN choferes ch
             ON ch.empresa_id=v.empresa_id
            AND COALESCE(ch.activo,true)=true
            AND (ch.id=v.chofer_id OR (v.chofer_id IS NULL AND ch.vehiculo_id=v.id))
          WHERE v.empresa_id=$1
            AND COALESCE(v.activo,true)=true
            AND LOWER(COALESCE(v.clase, v.tipo, '')) NOT LIKE '%remolque%'
          ORDER BY v.matricula ASC`,
        [empresaId]
      )),
      fechaDesde && fechaHasta
        ? db.query(
            `SELECT vehiculo_id, chofer_id, COUNT(*)::int AS total
               FROM pedidos
              WHERE empresa_id=$1
                AND id<>$2
                AND estado::text NOT IN ('cancelado','facturado','entregado')
                AND fecha_carga >= $3
                AND fecha_carga <= $4
                AND (vehiculo_id IS NOT NULL OR chofer_id IS NOT NULL)
              GROUP BY vehiculo_id, chofer_id`,
            [empresaId, req.params.id, fechaDesde.toISOString(), fechaHasta.toISOString()]
          ).catch(() => ({ rows: [] }))
        : Promise.resolve({ rows: [] }),
    ]);

    const conflictsByVehicle = new Map();
    const conflictsByDriver = new Map();
    for (const row of conflictsRes.rows || []) {
      if (row.vehiculo_id) conflictsByVehicle.set(String(row.vehiculo_id), (conflictsByVehicle.get(String(row.vehiculo_id)) || 0) + Number(row.total || 0));
      if (row.chofer_id) conflictsByDriver.set(String(row.chofer_id), (conflictsByDriver.get(String(row.chofer_id)) || 0) + Number(row.total || 0));
    }

    const vehiculoIds = Array.from(new Set((vehiculosRes.rows || []).map(v => v.id).filter(Boolean).map(String)));
    const choferIds = Array.from(new Set((vehiculosRes.rows || []).map(v => v.chofer_id_resuelto || v.chofer_id).filter(Boolean).map(String)));
    const previousByVehicle = new Map();
    const previousByDriver = new Map();
    if (vehiculoIds.length || choferIds.length) {
      const previousTrips = await db.query(
        `SELECT id, numero, vehiculo_id, chofer_id, destino, puntos_descarga,
                fecha_carga, fecha_descarga, fecha_entrega, hora_descarga, estado::text AS estado
           FROM pedidos
          WHERE empresa_id=$1
            AND id<>$2
            AND estado::text NOT IN ('cancelado','facturado')
            AND (
              ($3::uuid[] IS NOT NULL AND vehiculo_id = ANY($3::uuid[]))
              OR ($4::uuid[] IS NOT NULL AND chofer_id = ANY($4::uuid[]))
            )
          ORDER BY COALESCE(fecha_descarga, fecha_entrega, fecha_carga, created_at) DESC
          LIMIT 300`,
        [empresaId, req.params.id, vehiculoIds, choferIds]
      ).catch(() => ({ rows: [] }));
      for (const trip of previousTrips.rows || []) {
        if (trip.vehiculo_id && !previousByVehicle.has(String(trip.vehiculo_id))) previousByVehicle.set(String(trip.vehiculo_id), trip);
        if (trip.chofer_id && !previousByDriver.has(String(trip.chofer_id))) previousByDriver.set(String(trip.chofer_id), trip);
      }
    }

    const seen = new Set();
    const candidatos = (vehiculosRes.rows || [])
      .filter(v => {
        if (!v.id || seen.has(String(v.id))) return false;
        seen.add(String(v.id));
        return true;
      })
      .map(v => {
        const choferId = v.chofer_id_resuelto || v.chofer_id || null;
        const previousTrip = previousByVehicle.get(String(v.id)) || (choferId ? previousByDriver.get(String(choferId)) : null) || null;
        const scored = scorePlanningCandidate({
          pedido,
          vehicle: v,
          originCoord,
          originText,
          previousTrip,
          conflicts: {
            vehiculo: conflictsByVehicle.get(String(v.id)) || 0,
            chofer: choferId ? conflictsByDriver.get(String(choferId)) || 0 : 0,
          },
        });
        return {
          vehiculo_id: v.id,
          vehiculo_matricula: v.matricula || "",
          vehiculo_tipo: v.clase || v.tipo || "",
          chofer_id: choferId,
          chofer_nombre: [v.chofer_nombre, v.chofer_apellidos].filter(Boolean).join(" ").trim(),
          remolque_id_manual: v.remolque_id || null,
          remolque_matricula: v.remolque_matricula || null,
          confianza: scored.score >= 78 ? "alta" : scored.score >= 55 ? "media" : "baja",
          score: scored.score,
          razon: scored.reasons.slice(0, 3).join(" "),
          reasons: scored.reasons,
          advertencias: scored.warnings,
          distancia_origen_km: scored.distancia_origen_km,
          reposicionamiento: scored.reposicionamiento,
          tacografo: scored.tachograph,
          ubicacion: scored.location,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const sugerencia = candidatos[0] || null;
    res.json({
      ok: true,
      mode: "planning_ai_rules_v1",
      pedido: {
        id: pedido.id,
        numero: pedido.numero,
        origen: pedido.origen,
        destino: pedido.destino,
        fecha_carga: pedido.fecha_carga,
        peso_kg: pedido.peso_kg,
      },
      origin_has_coords: !!originCoord,
      data_policy: "Prioridad: GPS API conectado; si no hay, ultima posicion de app del chofer; si no hay coordenadas, ubicacion textual/manual.",
      sugerencia,
      candidatos,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo planificar la carga con IA" });
  }
});

router.get("/:id/rentabilidad-predictiva", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await queryWithColaboradorFallback(`
      SELECT p.*,
             c.nombre AS cliente_nombre,
             co.nombre AS colaborador_nombre,
             f.estado AS factura_estado,
             f.numero AS factura_numero
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
        LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
       WHERE p.id=$1 AND p.empresa_id=$2
       LIMIT 1
    `, `
      SELECT p.*,
             c.nombre AS cliente_nombre,
             NULL AS colaborador_nombre,
             f.estado AS factura_estado,
             f.numero AS factura_numero
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
        LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
       WHERE p.id=$1 AND p.empresa_id=$2
       LIMIT 1
    `, [req.params.id, empresaId]);
    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

    const [extras, docs] = await Promise.all([
      db.query(
        `SELECT id,tipo,concepto,importe
           FROM pedido_extracostes
          WHERE pedido_id=$1
          ORDER BY id ASC`,
        [req.params.id]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT COUNT(*)::int AS documentos,
                COUNT(*) FILTER (
                  WHERE LOWER(COALESCE(tipo,'')) LIKE '%albaran%'
                     OR LOWER(COALESCE(nombre,'')) LIKE '%albaran%'
                     OR LOWER(COALESCE(tipo,'')) LIKE '%pod%'
                     OR LOWER(COALESCE(nombre,'')) LIKE '%pod%'
                )::int AS albaranes
           FROM pedido_docs
          WHERE pedido_id=$1 AND empresa_id=$2`,
        [req.params.id, empresaId]
      ).catch(() => ({ rows: [{ documentos: 0, albaranes: 0 }] })),
    ]);

    res.json(buildRentabilidadPedido(pedido, extras.rows, docs.rows[0] || {}));
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo calcular la rentabilidad predictiva" });
  }
});

router.get("/:id/avisar-cliente/preflight", GERENTE_O_TRAFICO, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga, p.fecha_entrega,
             p.estado::text AS estado, p.cliente_id,
             c.nombre AS cliente_nombre, c.email AS cliente_email, c.email_facturacion AS cliente_email_facturacion
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
       WHERE p.id=$1 AND p.empresa_id=$2
       LIMIT 1
    `, [req.params.id, empresaId]);
    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes avisar sobre este pedido" });
    }
    const destinatario = String(req.query?.destinatario || pedido.cliente_email || pedido.cliente_email_facturacion || "").trim();
    const bloqueantes = [];
    if (!destinatario) bloqueantes.push("El cliente no tiene email configurado.");
    res.json({
      ok: bloqueantes.length === 0,
      bloqueantes,
      destinatario,
      cliente: pedido.cliente_nombre || "",
      pedido: { id: pedido.id, numero: pedido.numero, estado: pedido.estado, origen: pedido.origen, destino: pedido.destino },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo validar el aviso al cliente" });
  }
});

router.post("/:id/avisar-cliente", GERENTE_O_TRAFICO, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga, p.fecha_entrega,
             p.estado::text AS estado, p.mercancia, p.cliente_id,
             c.nombre AS cliente_nombre, c.email AS cliente_email, c.email_facturacion AS cliente_email_facturacion
        FROM pedidos p
        LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
       WHERE p.id=$1 AND p.empresa_id=$2
       LIMIT 1
    `, [req.params.id, empresaId]);
    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes avisar sobre este pedido" });
    }
    const destinatario = String(req.body?.destinatario || pedido.cliente_email || pedido.cliente_email_facturacion || "").trim();
    if (!destinatario) return res.status(400).json({ error: "El cliente no tiene email configurado" });

    const estadoLabels = {
      pendiente: "Pendiente",
      confirmado: "Confirmado",
      en_curso: "En ruta",
      descarga: "En descarga",
      entregado: "Entregado",
      incidencia: "Incidencia",
      cancelado: "Cancelado",
      facturado: "Facturado",
    };
    const motivo = String(req.body?.motivo || "Seguimiento operativo").trim().slice(0, 160);
    const mensaje = String(req.body?.mensaje || "Nuestro equipo de trafico esta revisando el transporte y le mantendra informado.").trim().slice(0, 1200);
    const result = await enviarEmail({
      trigger: "pedido_aviso_cliente",
      destinatario,
      plantilla: "pedido_aviso_cliente",
      empresa_id: empresaId,
      datos: {
        numero: pedido.numero,
        ruta: [pedido.origen, pedido.destino].filter(Boolean).join(" -> "),
        fecha_carga: pedido.fecha_carga || "-",
        fecha_descarga: pedido.fecha_descarga || pedido.fecha_entrega || "-",
        estado: estadoLabels[pedido.estado] || pedido.estado || "-",
        motivo,
        mensaje,
        portal_url: `${publicBaseUrl(req)}/portal-cliente`,
      },
      meta: {
        pedido_id: pedido.id,
        pedido_numero: pedido.numero,
        cliente_id: pedido.cliente_id,
        origen: "gestion_trafico_control_tower",
      },
    });
    await logPedidoEvento(pedido.id, empresaId, "cliente.avisado", {
      destinatario,
      motivo,
      mensaje,
      simulado: !!result?.simulado,
      origen: "control_tower",
    }, req.user?.rol || "usuario", req.user?.id || null);
    res.json({ ok: true, destinatario, simulado: !!result?.simulado });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo avisar al cliente" });
  }
});

router.get("/:id/ida-retorno", async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      `SELECT p.*, v.matricula AS vehiculo_matricula
         FROM pedidos p
         LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
        WHERE p.empresa_id=$1
          AND (p.id=$2 OR p.viaje_enlazado_id=$2 OR p.id=(SELECT viaje_enlazado_id FROM pedidos WHERE id=$2 AND empresa_id=$1))
        LIMIT 2`,
      [empresaId, req.params.id]
    );
    const pedido = rows.find(r => String(r.id) === String(req.params.id));
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes acceder a este pedido" });
    }
    const linked = rows.find(r => String(r.id) !== String(req.params.id));
    if (!linked) return res.json({ enlazado: false, pedido: normalizePedidoForClient(pedido), resumen: null });
    const salida = normalizeTipoViaje(pedido.tipo_viaje) === "retorno" ? linked : pedido;
    const retorno = normalizeTipoViaje(pedido.tipo_viaje) === "retorno" ? pedido : linked;
    res.json({
      enlazado: true,
      pedido: normalizePedidoForClient(pedido),
      salida: normalizePedidoForClient(salida),
      retorno: normalizePedidoForClient(retorno),
      resumen: buildIdaRetornoResumen(salida, retorno),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo obtener el enlace ida-retorno" });
  }
});

router.post("/:id/notificar-chofer-app", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      `SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.hora_carga, p.chofer_id,
              u.id AS usuario_id
         FROM pedidos p
         LEFT JOIN usuarios u ON u.chofer_id=p.chofer_id AND u.empresa_id=p.empresa_id AND u.activo=true
        WHERE p.id=$1 AND p.empresa_id=$2
        LIMIT 1`,
      [req.params.id, empresaId]
    );
    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!pedido.chofer_id) return res.status(400).json({ error: "Asigna un chofer antes de enviar aviso a la app." });
    if (!pedido.usuario_id) return res.status(400).json({ error: "El chofer no tiene usuario de app asociado." });
    const mensaje = String(req.body?.mensaje || "").trim()
      || `Revisa el pedido ${pedido.numero || ""}: ${pedido.origen || "-"} -> ${pedido.destino || "-"}`;
    const notificacion = await crearNotificacion({
      empresa_id: empresaId,
      usuario_id: pedido.usuario_id,
      tipo: "pedido_app_chofer",
      titulo: `Pedido ${pedido.numero || ""}`,
      mensaje,
      data: {
        pedido_id: pedido.id,
        pedido_numero: pedido.numero,
        fecha_carga: pedido.fecha_carga,
        hora_carga: pedido.hora_carga,
        dedupe_key: `pedido_app_chofer:${pedido.id}`,
      },
      created_by: req.user?.id || null,
    });
    await logPedidoEvento(pedido.id, empresaId, "app_chofer.notificado", {
      mensaje,
      notificacion_id: notificacion?.id || null,
    }, req.user?.rol || "usuario", req.user?.id || null);
    res.json({ ok: true, notificacion });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo notificar al chofer en la app" });
  }
});

router.post("/:id/ida-retorno", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const salidaId = normalizePedidoUuid(req.params.id);
    const retornoId = normalizePedidoUuid(req.body?.retorno_id);
    if (!salidaId || !retornoId || String(salidaId) === String(retornoId)) {
      return res.status(400).json({ error: "Selecciona una salida y un retorno validos." });
    }
    const kmVacioEnlace = Math.max(0, parseLocaleNumber(req.body?.km_vacio_enlace) ?? 0);
    const copiarAsignacion = req.body?.copiar_asignacion !== false;
    let payload = null;
    await db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT p.*, v.matricula AS vehiculo_matricula
          FROM pedidos p
           LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
          WHERE p.empresa_id=$1 AND p.id = ANY($2::uuid[])
          FOR UPDATE OF p`,
        [empresaId, [salidaId, retornoId]]
      );
      const salida = rows.find(r => String(r.id) === String(salidaId));
      const retorno = rows.find(r => String(r.id) === String(retornoId));
      if (!salida || !retorno) {
        const err = new Error("Pedido de salida o retorno no encontrado.");
        err.status = 404;
        throw err;
      }
      if (normalizeTipoViaje(salida.tipo_viaje) === "retorno") {
        const err = new Error("El pedido base ya esta marcado como retorno. Abre el viaje de salida para enlazar.");
        err.status = 400;
        throw err;
      }
      const grupoId = salida.grupo_ida_vuelta || retorno.grupo_ida_vuelta || crypto.randomUUID();
      const retornoVehiculo = copiarAsignacion && !retorno.vehiculo_id ? salida.vehiculo_id : retorno.vehiculo_id;
      const retornoChofer = copiarAsignacion && !retorno.chofer_id ? salida.chofer_id : retorno.chofer_id;
      const retornoChofer2 = copiarAsignacion && !retorno.chofer2_id ? salida.chofer2_id : retorno.chofer2_id;
      const retornoRemolque = copiarAsignacion && !retorno.remolque_id ? salida.remolque_id : retorno.remolque_id;
      await client.query(
        `UPDATE pedidos
            SET tipo_viaje='salida',
                viaje_enlazado_id=$1,
                grupo_ida_vuelta=$2,
                enlace_retorno_at=NOW(),
                enlace_retorno_by=$3,
                updated_at=NOW()
          WHERE id=$4 AND empresa_id=$5`,
        [retorno.id, grupoId, req.user?.id || null, salida.id, empresaId]
      );
      await client.query(
        `UPDATE pedidos
            SET tipo_viaje='retorno',
                viaje_enlazado_id=$1,
                grupo_ida_vuelta=$2,
                km_vacio_enlace=$3::numeric,
                km_vacio=CASE WHEN COALESCE(km_vacio,0)=0 AND $3::numeric > 0 THEN $3::numeric ELSE km_vacio END,
                vehiculo_id=$4,
                chofer_id=$5,
                chofer2_id=$6,
                remolque_id=$7,
                enlace_retorno_at=NOW(),
                enlace_retorno_by=$8,
                updated_at=NOW()
          WHERE id=$9 AND empresa_id=$10`,
        [salida.id, grupoId, kmVacioEnlace, retornoVehiculo || null, retornoChofer || null, retornoChofer2 || null, retornoRemolque || null, req.user?.id || null, retorno.id, empresaId]
      );
      const { rows: updatedRows } = await client.query(
        `SELECT p.*, v.matricula AS vehiculo_matricula
           FROM pedidos p
           LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
          WHERE p.empresa_id=$1 AND p.id = ANY($2::uuid[])`,
        [empresaId, [salida.id, retorno.id]]
      );
      const salidaUpd = updatedRows.find(r => String(r.id) === String(salida.id));
      const retornoUpd = updatedRows.find(r => String(r.id) === String(retorno.id));
      const resumen = buildIdaRetornoResumen(salidaUpd, retornoUpd, kmVacioEnlace);
      await logPedidoEvento(salida.id, empresaId, "ida_retorno.enlazado", {
        retorno_id: retorno.id,
        grupo_ida_vuelta: grupoId,
        km_vacio_enlace: kmVacioEnlace,
        precio_total_ida_vuelta: resumen.precio_total_ida_vuelta,
      }, req.user?.rol || "usuario", req.user?.id || null, client);
      await logPedidoEvento(retorno.id, empresaId, "ida_retorno.enlazado", {
        salida_id: salida.id,
        grupo_ida_vuelta: grupoId,
        km_vacio_enlace: kmVacioEnlace,
        asignacion_copiada: copiarAsignacion,
      }, req.user?.rol || "usuario", req.user?.id || null, client);
      payload = {
        ok: true,
        enlazado: true,
        salida: normalizePedidoForClient(salidaUpd),
        retorno: normalizePedidoForClient(retornoUpd),
        resumen,
      };
    });
    if (payload?.salida) {
      await notificarPlanificacionIdaRetorno(payload.salida, empresaId, req.user?.id || null)
        .catch(e => logger.warn("No se pudo notificar salida ida-retorno:", e.message));
    }
    if (payload?.retorno) {
      await notificarPlanificacionIdaRetorno(payload.retorno, empresaId, req.user?.id || null)
        .catch(e => logger.warn("No se pudo notificar retorno ida-retorno:", e.message));
    }
    res.json(payload);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo enlazar salida y retorno" });
  }
});

router.delete("/:id/ida-retorno", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      "SELECT id, viaje_enlazado_id, grupo_ida_vuelta FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const ids = [pedido.id, pedido.viaje_enlazado_id].filter(Boolean);
    await db.query(
      `UPDATE pedidos
          SET tipo_viaje='normal',
              viaje_enlazado_id=NULL,
              grupo_ida_vuelta=NULL,
              km_vacio_enlace=0,
              enlace_retorno_at=NULL,
              enlace_retorno_by=NULL,
              updated_at=NOW()
        WHERE empresa_id=$1
          AND (id = ANY($2::uuid[]) OR ($3::uuid IS NOT NULL AND grupo_ida_vuelta=$3::uuid))`,
      [empresaId, ids, pedido.grupo_ida_vuelta || null]
    );
    await Promise.all(ids.map(id => logPedidoEvento(id, empresaId, "ida_retorno.desvinculado", {
      grupo_ida_vuelta: pedido.grupo_ida_vuelta || null,
      desde_pedido_id: pedido.id,
    }, req.user?.rol || "usuario", req.user?.id || null)));
    res.json({ ok: true, desvinculado: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo desvincular ida-retorno" });
  }
});

router.get("/:id", async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const { rows } = await queryWithColaboradorFallback(`
    SELECT p.*,
           c.nombre AS cliente_nombre, c.email AS cliente_email,
           c.email_facturacion AS cliente_email_facturacion,
           c.emails_albaranes AS cliente_emails_albaranes,
           co.nombre AS colaborador_nombre, co.cif AS colaborador_cif,
           co.telefono AS colaborador_telefono, co.email AS colaborador_email,
           ch.nombre AS chofer_nombre, v.matricula,
           f.estado AS factura_estado, f.numero AS factura_numero
    FROM pedidos p
    LEFT JOIN clientes c ON c.id=p.cliente_id
    LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
    LEFT JOIN choferes ch ON ch.id=p.chofer_id
    LEFT JOIN vehiculos v ON v.id=p.vehiculo_id
    LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
    WHERE p.id=$1 AND p.empresa_id=$2
  `, `
    SELECT p.*,
           c.nombre AS cliente_nombre, c.email AS cliente_email,
           c.email_facturacion AS cliente_email_facturacion,
           c.emails_albaranes AS cliente_emails_albaranes,
           NULL AS colaborador_nombre, NULL AS colaborador_cif,
           NULL AS colaborador_telefono, NULL AS colaborador_email,
           ch.nombre AS chofer_nombre, v.matricula,
           f.estado AS factura_estado, f.numero AS factura_numero
    FROM pedidos p
    LEFT JOIN clientes c ON c.id=p.cliente_id
    LEFT JOIN choferes ch ON ch.id=p.chofer_id
    LEFT JOIN vehiculos v ON v.id=p.vehiculo_id
    LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
    WHERE p.id=$1 AND p.empresa_id=$2
  `, [req.params.id, empresaId]);
  if (!rows[0]) return res.status(404).json({ error: "Pedido no encontrado" });
  if (req.user?.rol === "chofer" && !(await usuarioPuedeGestionarPedido(req, rows[0]))) {
    return res.status(403).json({ error: "No puedes acceder a este pedido" });
  }

  const extras = await db.query(
    `SELECT pe.*
       FROM pedido_extracostes pe
       JOIN pedidos p ON p.id=pe.pedido_id
      WHERE pe.pedido_id=$1 AND p.empresa_id=$2`,
    [req.params.id, empresaId]
  );
  res.json(normalizePedidoForClient({ ...rows[0], extracostes: extras.rows }));
});

// POST /pedidos
router.get("/:id/eventos", async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows: pedidoRows } = await db.query(
      "SELECT id, chofer_id, chofer2_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    if (!pedidoRows[0]) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedidoRows[0]))) {
      return res.status(403).json({ error: "No puedes acceder a este pedido" });
    }
    const { rows } = await db.query(
      `SELECT pe.id,pe.tipo,pe.actor_tipo,pe.actor_id,pe.detalle,pe.created_at,
              COALESCE(NULLIF(TRIM(CONCAT(u.nombre,' ',u.apellidos)),''), u.nombre, u.email) AS actor_nombre,
              u.email AS actor_email,
              u.rol AS actor_rol
         FROM pedido_eventos pe
         LEFT JOIN usuarios u ON u.id=pe.actor_id AND u.empresa_id=pe.empresa_id
        WHERE pe.pedido_id=$1 AND pe.empresa_id=$2
        ORDER BY pe.created_at DESC
        LIMIT 100`,
      [req.params.id, empresaId]
    );
    res.json(rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/chofer-pasos", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows: pedidoRows } = await db.query(
      "SELECT id, chofer_id, chofer2_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes acceder a este pedido" });
    }
    const payload = await getPedidoChoferPasos(req.params.id, empresaId);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/:id/chofer-pasos", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows: pedidoRows } = await db.query(
      "SELECT id, chofer_id, chofer2_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes modificar este pedido" });
    }
    const patch = normalizeChoferPasosPayload(req.body || {});
    const saved = await savePedidoChoferPasos({
      pedidoId: req.params.id,
      empresaId,
      choferId: pedido.chofer_id || pedido.chofer2_id || null,
      patch,
      actorTipo: req.user?.rol === "chofer" ? "chofer" : "usuario",
      actorId: req.user?.id || null,
    });
    res.json({ ok: true, data: saved });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code || undefined, pedido_activo: e.pedido_activo || undefined });
  }
});

// Documentos que trafico ha marcado como visibles para el chofer (p. ej. la
// orden de carga). No se envian automaticamente: solo los explicitamente marcados.
router.get("/:id/chofer-docs", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows: pedidoRows } = await db.query(
      "SELECT id, chofer_id, chofer2_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes ver documentos de este pedido" });
    }
    const { rows } = await db.query(
      "SELECT id,nombre,tipo,file_mime,file_size_kb,created_at FROM pedido_docs WHERE pedido_id=$1 AND empresa_id=$2 AND visible_chofer=true ORDER BY created_at",
      [req.params.id, empresaId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/:id/chofer-docs/:docId/archivo", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows: pedidoRows } = await db.query(
      "SELECT id, chofer_id, chofer2_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes ver documentos de este pedido" });
    }
    const { rows } = await db.query(
      "SELECT id,nombre,file_base64,file_mime FROM pedido_docs WHERE id=$1 AND pedido_id=$2 AND empresa_id=$3 AND visible_chofer=true LIMIT 1",
      [req.params.docId, req.params.id, empresaId]
    );
    const doc = rows[0];
    if (!doc || !doc.file_base64) return res.status(404).json({ error: "Documento no disponible" });
    const mime = String(doc.file_mime || "application/octet-stream").split(";")[0] || "application/octet-stream";
    const filename = String(doc.nombre || `documento-${doc.id}`).replace(/[\r\n"]/g, " ").slice(0, 180);
    const cleanBase64 = String(doc.file_base64).includes(",") ? String(doc.file_base64).split(",").pop() : String(doc.file_base64);
    const buffer = Buffer.from(cleanBase64, "base64");
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/:id/chofer-docs", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows: pedidoRows } = await db.query(
      "SELECT id, chofer_id, chofer2_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes adjuntar documentos a este pedido" });
    }

    const { nombre, tipo, file_base64, file_mime, file_size_kb, notas, metadata } = req.body || {};
    const tipoDoc = String(tipo || "").toLowerCase();
    if (!nombre || !file_base64) return res.status(400).json({ error: "Faltan nombre o archivo" });
    const tipoPermitido = tipoDoc.includes("albaran") || ["pod", "foto_entrega", "documento_chofer", "incidencia_chofer"].includes(tipoDoc);
    if (!tipoPermitido) return res.status(400).json({ error: "Desde la app del chofer solo se pueden adjuntar soportes del viaje" });
    const upload = validateBase64Upload({ data: file_base64, mime: file_mime, filename: nombre });

    const values = [
      req.params.id,
      empresaId,
      String(nombre).slice(0, 255),
      tipoDoc || "albaran",
      upload.base64,
      upload.mime,
      Math.ceil(upload.sizeBytes / 1024),
      notas || "Subido desde app chofer",
    ];
    let rows;
    try {
      ({ rows } = await db.query(
        `INSERT INTO pedido_docs (pedido_id,empresa_id,nombre,tipo,file_base64,file_mime,file_size_kb,notas,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         RETURNING id,nombre,tipo,file_mime,file_size_kb,metadata,created_at`,
        [...values, JSON.stringify(metadata && typeof metadata === "object" ? metadata : {})]
      ));
    } catch (err) {
      if (err.code !== "42703") throw err;
      ({ rows } = await db.query(
        `INSERT INTO pedido_docs (pedido_id,empresa_id,nombre,tipo,file_base64,file_mime,file_size_kb,notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id,nombre,tipo,file_mime,file_size_kb,created_at`,
        values
      ));
      rows[0].metadata = {};
    }
    await logPedidoEvento(req.params.id, empresaId, "chofer_doc.subido", { documento_id: rows[0].id, tipo: tipoDoc, metadata: rows[0].metadata || {} }, req.user?.rol === "chofer" ? "chofer" : "usuario", req.user?.id || null);
    const pedidoId = req.params.id;
    const actorId = req.user?.id || null;
    const appBaseUrl = publicBaseUrl(req);
    setImmediate(() => {
      archivarDocumentoControlPedido({
        pedidoId,
        empresaId,
        appBaseUrl,
        userId: actorId,
        motivo: `documento_chofer_${tipoDoc}`,
      }).catch(repoErr => logger.warn("No se pudo actualizar el repositorio DCD tras documento de chofer:", repoErr.message));
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get("/colaborador-pagos/pendientes", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const perfil = await getEmpresaPerfilPagos(empresaId);
    const { rows } = await db.query(
      `SELECT p.id AS pedido_id, p.numero, p.estado, p.fecha_carga, p.fecha_descarga,
              p.origen, p.destino, p.precio_colaborador,
              co.id AS colaborador_id, co.nombre AS colaborador_nombre, co.forma_pago AS colaborador_forma_pago,
              pay.id AS pago_id, pay.factura_nombre, pay.factura_data, pay.fecha_recepcion, pay.fecha_pago_calculada,
              pay.fecha_pago_real, pay.importe, pay.pagado, pay.documentacion_recibida,
              pay.fecha_documentacion_recepcion, pay.notas_pago
         FROM pedidos p
         JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
         LEFT JOIN pedido_colaborador_pagos pay ON pay.pedido_id=p.id AND pay.empresa_id=p.empresa_id
        WHERE p.empresa_id=$1
          AND p.colaborador_id IS NOT NULL
          AND COALESCE(p.precio_colaborador,0) > 0
          AND COALESCE(pay.pagado,false) = false
          AND p.estado NOT IN ('cancelado')
        ORDER BY COALESCE(pay.fecha_pago_calculada, p.fecha_descarga, p.fecha_carga, p.created_at::date) ASC
        LIMIT 120`,
      [empresaId]
    );
    res.json(rows.map(row => {
      const fechaRecepcion = normalizePedidoDate(row.fecha_recepcion);
      const fechaPago = normalizePedidoDate(row.fecha_pago_calculada) || calcularFechaPagoColaborador(fechaRecepcion, perfil);
      return {
        ...row,
        fecha_carga: normalizePedidoDate(row.fecha_carga),
        fecha_descarga: normalizePedidoDate(row.fecha_descarga),
        fecha_recepcion: fechaRecepcion,
        fecha_pago_calculada: fechaPago,
        fecha_pago_real: normalizePedidoDate(row.fecha_pago_real),
        fecha_documentacion_recepcion: normalizePedidoDate(row.fecha_documentacion_recepcion),
        importe: Number(row.importe ?? row.precio_colaborador ?? 0),
        precio_colaborador: Number(row.precio_colaborador || 0),
        pagado: Boolean(row.pagado),
        documentacion_recibida: Boolean(row.documentacion_recibida),
        pendiente_factura: !row.factura_nombre,
      };
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/colaborador-pago", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows: pedidoRows } = await db.query(
      "SELECT id, colaborador_id, precio_colaborador FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const { rows } = await db.query(
      `SELECT id, pedido_id, colaborador_id, factura_nombre, factura_data, fecha_recepcion,
              fecha_pago_calculada, fecha_pago_real, importe, pagado, documentacion_recibida,
              fecha_documentacion_recepcion, notas_pago, created_at, updated_at
         FROM pedido_colaborador_pagos
        WHERE pedido_id=$1 AND empresa_id=$2
        LIMIT 1`,
      [req.params.id, empresaId]
    );
    const row = rows[0];
    if (!row) {
      return res.json({
        pedido_id: pedido.id,
        colaborador_id: pedido.colaborador_id || null,
        importe: Number(pedido.precio_colaborador || 0),
        pagado: false,
        documentacion_recibida: false,
      });
    }
    res.json({
      ...row,
      fecha_recepcion: normalizePedidoDate(row.fecha_recepcion),
      fecha_pago_calculada: normalizePedidoDate(row.fecha_pago_calculada),
      fecha_pago_real: normalizePedidoDate(row.fecha_pago_real),
      fecha_documentacion_recepcion: normalizePedidoDate(row.fecha_documentacion_recepcion),
      importe: Number(row.importe || 0),
      pagado: Boolean(row.pagado),
      documentacion_recibida: Boolean(row.documentacion_recibida),
      notas_pago: row.notas_pago || "",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id/colaborador-pago", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows: pedidoRows } = await db.query(
      "SELECT id, colaborador_id, precio_colaborador FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const payload = normalizeColaboradorPagoPayload({
      ...req.body,
      colaborador_id: req.body?.colaborador_id || pedido.colaborador_id || null,
      importe: req.body?.importe ?? pedido.precio_colaborador ?? 0,
    });
    if (payload.fecha_recepcion && !payload.fecha_pago_calculada) {
      const perfil = await getEmpresaPerfilPagos(empresaId);
      payload.fecha_pago_calculada = calcularFechaPagoColaborador(payload.fecha_recepcion, perfil);
    }
    const { rows } = await db.query(
      `INSERT INTO pedido_colaborador_pagos
         (pedido_id, empresa_id, colaborador_id, factura_nombre, factura_data, fecha_recepcion,
          fecha_pago_calculada, fecha_pago_real, importe, pagado, documentacion_recibida,
          fecha_documentacion_recepcion, notas_pago, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       ON CONFLICT (pedido_id) DO UPDATE SET
         colaborador_id=EXCLUDED.colaborador_id,
         factura_nombre=EXCLUDED.factura_nombre,
         factura_data=EXCLUDED.factura_data,
         fecha_recepcion=EXCLUDED.fecha_recepcion,
         fecha_pago_calculada=EXCLUDED.fecha_pago_calculada,
         fecha_pago_real=EXCLUDED.fecha_pago_real,
         importe=EXCLUDED.importe,
         pagado=EXCLUDED.pagado,
         documentacion_recibida=EXCLUDED.documentacion_recibida,
         fecha_documentacion_recepcion=EXCLUDED.fecha_documentacion_recepcion,
         notas_pago=EXCLUDED.notas_pago,
         updated_by=EXCLUDED.updated_by,
         updated_at=NOW()
       RETURNING id, pedido_id, colaborador_id, factura_nombre, factura_data, fecha_recepcion,
                 fecha_pago_calculada, fecha_pago_real, importe, pagado, documentacion_recibida,
                 fecha_documentacion_recepcion, notas_pago, created_at, updated_at`,
      [
        req.params.id,
        empresaId,
        payload.colaborador_id,
        payload.factura_nombre,
        payload.factura_data,
        payload.fecha_recepcion,
        payload.fecha_pago_calculada,
        payload.fecha_pago_real,
        payload.importe,
        payload.pagado,
        payload.documentacion_recibida,
        payload.fecha_documentacion_recepcion,
        payload.notas_pago,
        req.user?.id || null,
      ]
    );
    await logPedidoEvento(req.params.id, empresaId, "colaborador.pago_actualizado", {
      pagado: payload.pagado,
      fecha_recepcion: payload.fecha_recepcion,
      fecha_pago_calculada: payload.fecha_pago_calculada,
      fecha_pago_real: payload.fecha_pago_real,
      importe: payload.importe,
      factura_nombre: payload.factura_nombre,
      documentacion_recibida: payload.documentacion_recibida,
      fecha_documentacion_recepcion: payload.fecha_documentacion_recepcion,
      notas_pago: payload.notas_pago,
    }, "usuario", req.user?.id || null);
    const row = rows[0];
    res.json({
      ...row,
      fecha_recepcion: normalizePedidoDate(row.fecha_recepcion),
      fecha_pago_calculada: normalizePedidoDate(row.fecha_pago_calculada),
      fecha_pago_real: normalizePedidoDate(row.fecha_pago_real),
      fecha_documentacion_recepcion: normalizePedidoDate(row.fecha_documentacion_recepcion),
      importe: Number(row.importe || 0),
      pagado: Boolean(row.pagado),
      documentacion_recibida: Boolean(row.documentacion_recibida),
      notas_pago: row.notas_pago || "",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/ai-inbox/runs", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const limit = Math.max(1, Math.min(80, Number(req.query.limit || 30)));
    const { rows } = await db.query(
      `SELECT id, provider, status, confidence, source_type, filename, attachments,
              issues, warnings, suggestions, error, created_at
         FROM ai_inbox_runs
        WHERE empresa_id=$1
        ORDER BY created_at DESC
        LIMIT $2`,
      [empresaId, limit]
    );
    const normalized = rows.map(r => ({
      ...r,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      issues: Array.isArray(r.issues) ? r.issues : [],
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
      suggestions: Array.isArray(r.suggestions) ? r.suggestions : [],
      confidence: Number(r.confidence || 0),
    }));
    res.json(normalized.map(r => ({
      ...r,
      operational_summary: buildAiInboxOperationalSummary(r),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo cargar el historial de Bandeja IA" });
  }
});

router.get("/ai-inbox/status", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const iaConfig = await getPedidoAiRuntimeConfig(empresaId);
    res.json({
      basic_available: true,
      visual_available: Boolean(iaConfig.apiKey),
      provider: iaConfig.provider || "local",
      model: iaConfig.model || null,
      provider_configured_from: iaConfig.apiKey ? (iaConfig.source || "configuracion") : null,
      supported_basic_documents: ["pdf_texto", "doc", "docx", "rtf", "odt", "xls", "xlsx", "csv", "tsv", "txt", "eml", "html", "xml", "json"],
      supported_visual_documents: ["jpg", "jpeg", "png", "webp", "pdf_escaneado"],
      mode_label: iaConfig.apiKey ? "Documentos + IA visual" : "Extraccion local",
      guidance: iaConfig.apiKey
        ? "Interpreta documentos de oficina, PDF, imagenes y PDF escaneados. Los datos siempre quedan pendientes de revision antes de crear el pedido."
        : "Interpreta PDF con texto, DOCX/XLSX basicos, emails y texto. Imagenes o PDF escaneados requieren configurar IA visual en SuperAdmin.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo comprobar el estado de la Bandeja IA" });
  }
});

router.post("/ai-inbox/parse", GERENTE_O_TRAFICO, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const textoOriginal = String(req.body?.texto || req.body?.text || "").trim();
  const attachments = Array.isArray(req.body?.attachments)
    ? req.body.attachments.slice(0, 8).map(a => ({
        name: String(a?.name || a?.filename || "").slice(0, 180),
        mediaType: String(a?.mediaType || a?.type || "").slice(0, 120),
        sizeKb: Number(a?.sizeKb || a?.size_kb || 0) || null,
        extractionStatus: String(a?.extractionStatus || a?.status || "").slice(0, 80),
        base64: a?.base64 ? String(a.base64) : "",
      })).filter(a => a.name)
    : [];
  const attachmentTexts = (await Promise.all(attachments.map(async a => ({
    name: a.name,
    text: await extractAiAttachmentText(a),
  })))).filter(a => a.text && a.text.length >= 12);
  const texto = [textoOriginal, ...attachmentTexts.map(a => `Documento ${a.name}:\n${a.text}`)]
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 20000);
  const hasAiAttachment = attachments.some(a => a.base64);
  const hasDocumentAttachment = attachments.some(a => a.base64) || attachmentTexts.length > 0;
  const sourceAttachments = attachments.map(({ base64, ...a }) => a);
  if ((!texto || texto.length < 12) && !hasDocumentAttachment) {
    return res.status(400).json({ error: "Pega texto o sube un PDF/DOCX/XLSX/TXT/email de la orden para generar el borrador." });
  }
  if (texto.length > 20000) {
    return res.status(400).json({ error: "El texto es demasiado largo. Resume o pega solo la orden de carga." });
  }
  try {
    await ensureColaboradorWorkflowSchema();
    let draft = extractAiPedidoDraft(texto);
    let tarifaUnitariaDetectada = Boolean(draft._tarifa_unitaria_detectada);
    const issues = [];
    const warnings = [];
    const suggestions = [];
    let visualAi = { used: false };
    if (hasAiAttachment) {
      try {
        visualAi = await callPedidoDocumentAi({ empresaId, texto, attachments });
        if (visualAi.used && visualAi.parsed) {
          draft = mergeAiDraftFields(draft, visualAi.parsed);
          tarifaUnitariaDetectada = tarifaUnitariaDetectada || (draft.tipo_precio && draft.tipo_precio !== "viaje" && Number.isFinite(parseLocaleNumber(draft.precio_unitario)));
          suggestions.push({
            type: "ia_visual",
            label: "Documento analizado por IA",
            detail: `Proveedor: ${visualAi.provider}${visualAi.model ? ` | Modelo: ${visualAi.model}` : ""}`,
            confidence: 0.88,
          });
          if (visualAi.recoveredFromModel) {
            warnings.push({
              key: "ia_model_fallback",
              severity: "baja",
              message: "El modelo configurado no estaba disponible y el documento se proceso automaticamente con el modelo compatible de respaldo.",
            });
          }
        } else if (visualAi.used && !visualAi.parsed) {
          warnings.push({ key: "ia_visual", severity: "media", message: "La IA respondio, pero no devolvio JSON interpretable. Se usa el parser local." });
        } else if (!visualAi.used && visualAi.reason === "sin_api_key" && !attachmentTexts.length) {
          warnings.push({ key: "ia_visual_api", severity: "media", message: "El documento parece imagen o PDF escaneado y requiere API visual configurada en SuperAdmin para extraer datos automaticamente." });
        } else if (!visualAi.used && visualAi.reason === "sin_contenido_visual" && !attachmentTexts.length) {
          warnings.push({ key: "ia_visual_pdf", severity: "media", message: "No se detecto texto legible en el documento. Si es un PDF escaneado, conviertelo a imagen o usa un proveedor visual compatible con PDF." });
        }
      } catch (e) {
        logger.warn(`Bandeja IA: proveedor no disponible, se usa extraccion local: ${e.message}`);
        warnings.push({ key: "ia_visual", severity: "media", message: "El proveedor de IA no ha estado disponible. Se ha mantenido la extraccion local del documento; revisa los campos antes de continuar." });
      }
    }

    const { rows: clientesRows } = await db.query(
      `SELECT id,nombre,cif,email,email_facturacion
         FROM clientes
        WHERE empresa_id=$1 AND activo IS DISTINCT FROM false
        ORDER BY nombre
        LIMIT 500`,
      [empresaId]
    );
    const cleanNeedle = normalizeAiText(draft.cliente_nombre || "").toLowerCase();
    const clienteMatch = clientesRows.find(c => {
      const n = normalizeAiText(c.nombre || "").toLowerCase();
      return cleanNeedle && (n.includes(cleanNeedle) || cleanNeedle.includes(n));
    }) || clientesRows.find(c => normalizeAiText(texto).toLowerCase().includes(normalizeAiText(c.nombre || "").toLowerCase()));
    if (clienteMatch) {
      draft.cliente_id = clienteMatch.id;
      draft.cliente_nombre = clienteMatch.nombre;
      suggestions.push({ type: "cliente", label: "Cliente encontrado", detail: clienteMatch.nombre, confidence: cleanNeedle ? 0.92 : 0.78 });
    } else {
      issues.push({ key: "cliente_id", severity: "alta", message: "No se ha podido asociar el cliente. Seleccionalo o crealo antes de guardar." });
    }

    const vehText = draft.matricula_detectada;
    let vehiculoMatch = null;
    if (vehText) {
      const { rows: vehRows } = await db.query(
        `SELECT id,matricula,chofer_id,remolque_id
           FROM vehiculos
          WHERE empresa_id=$1 AND activo IS DISTINCT FROM false`,
        [empresaId]
      ).catch(() => ({ rows: [] }));
      vehiculoMatch = vehRows.find(v => normalizeAiText(v.matricula || "").replace(/[^a-z0-9]/g, "") === normalizeAiText(vehText).replace(/[^a-z0-9]/g, ""));
      if (vehiculoMatch) {
        draft.vehiculo_id = vehiculoMatch.id;
        draft.chofer_id = vehiculoMatch.chofer_id || null;
        draft.remolque_id = vehiculoMatch.remolque_id || null;
        suggestions.push({ type: "vehiculo", label: "Matricula encontrada", detail: vehiculoMatch.matricula, confidence: 0.86 });
      } else {
        warnings.push({ key: "vehiculo", severity: "media", message: `Se detecto matricula ${vehText}, pero no existe en flota.` });
      }
    }

    if (draft.cliente_id && draft.origen && draft.destino) {
      const { rows: rutaRows } = await db.query(`
        SELECT r.id, r.origen, r.destino, r.km, r.precio_base, r.tarifa_tipo, r.minimo_facturable, r.minimo_unidades,
               rpc.precio AS cliente_precio_base, rpc.tarifa_tipo AS cliente_tarifa_tipo,
               rpc.minimo_facturable AS cliente_minimo_facturable, rpc.minimo_unidades AS cliente_minimo_unidades
          FROM rutas r
          LEFT JOIN ruta_precios_cliente rpc ON rpc.ruta_id=r.id AND rpc.cliente_id=$2
         WHERE r.empresa_id=$1
           AND (r.cliente_id IS NULL OR r.cliente_id=$2 OR rpc.cliente_id=$2)
           AND UPPER(TRIM(r.origen))=UPPER(TRIM($3))
           AND UPPER(TRIM(r.destino))=UPPER(TRIM($4))
         ORDER BY CASE WHEN rpc.cliente_id=$2 THEN 0 WHEN r.cliente_id=$2 THEN 1 ELSE 2 END, r.updated_at DESC NULLS LAST
         LIMIT 1`,
        [empresaId, draft.cliente_id, draft.origen, draft.destino]
      ).catch(() => ({ rows: [] }));
      const ruta = rutaRows[0];
      if (ruta) {
        const tarifaTipo = ruta.cliente_tarifa_tipo || ruta.tarifa_tipo || "viaje";
        const precioBase = parseLocaleNumber(ruta.cliente_precio_base ?? ruta.precio_base) || 0;
        draft.ruta_id = ruta.id;
        draft.km_ruta = draft.km_ruta || Number(ruta.km || 0) || null;
        if (!tarifaUnitariaDetectada) {
          draft.tipo_precio = tarifaTipo;
          draft.precio_unitario = precioBase || draft.precio_unitario || draft.importe || null;
          draft.importe_minimo = tarifaTipo === "viaje" ? (parseLocaleNumber(ruta.cliente_minimo_facturable ?? ruta.minimo_facturable) || null) : null;
          draft.minimo_unidades = tarifaTipo !== "viaje" ? normalizeRouteMinimumUnits({
            minimo_unidades: ruta.cliente_minimo_unidades ?? ruta.minimo_unidades,
          }, tarifaTipo) || null : null;
        } else if (tarifaTipo !== draft.tipo_precio) {
          warnings.push({
            key: "tarifa_documento_ruta",
            severity: "media",
            message: `El documento indica tarifa por ${draft.tipo_precio}, pero la ruta esta configurada como ${tarifaTipo}. Se mantiene la tarifa detectada para revision.`,
          });
        }
        const importeCanonico = calcPedidoImporteCanonical(draft);
        if (importeCanonico !== null) draft.importe = importeCanonico;
        suggestions.push({
          type: "tarifa",
          label: "Tarifa/ruta sugerida",
          detail: `${ruta.origen} -> ${ruta.destino}: ${draft.importe || draft.precio_unitario || 0} EUR`,
          confidence: 0.9,
        });
      } else {
        warnings.push({ key: "ruta", severity: "media", message: "No hay ruta/tarifa exacta para este cliente. Revisar precio antes de guardar." });
      }
    }

    if (draft.vehiculo_id && draft.fecha_carga) {
      const { rows: overlapRows } = await db.query(
        `SELECT id,numero,origen,destino,fecha_carga,estado::text AS estado
           FROM pedidos
          WHERE empresa_id=$1 AND vehiculo_id=$2
            AND estado::text NOT IN ('cancelado','entregado','facturado')
            AND fecha_carga::date=$3::date
          LIMIT 5`,
        [empresaId, draft.vehiculo_id, draft.fecha_carga]
      ).catch(() => ({ rows: [] }));
      if (overlapRows.length) {
        warnings.push({
          key: "conflicto_vehiculo",
          severity: "alta",
          message: `El vehiculo detectado ya tiene ${overlapRows.length} viaje(s) activo(s) ese dia.`,
          items: overlapRows.map(p => ({ id: p.id, numero: p.numero, ruta: `${p.origen || ""} -> ${p.destino || ""}` })),
        });
      }
    }

    for (const [key, label] of [["origen", "origen"], ["destino", "destino"], ["fecha_carga", "fecha de carga"]]) {
      if (!draft[key]) issues.push({ key, severity: "alta", message: `Falta ${label}.` });
    }
    if (!draft.importe && !draft.precio_unitario) warnings.push({ key: "precio", severity: "media", message: "No se ha detectado importe. Se debera revisar la tarifa manualmente." });
    if (attachmentTexts.length) {
      suggestions.push({ type: "documento_texto", label: "Texto extraido de documento", detail: `${attachmentTexts.length} adjunto(s) con texto usable`, confidence: 0.82 });
    }
    if (sourceAttachments.some(a => a.extractionStatus && a.extractionStatus !== "ok") && !visualAi.used && !attachmentTexts.length) {
      warnings.push({ key: "documentos", severity: "media", message: "Alguno de los documentos no tenia texto claro. El adjunto se conserva y el pedido queda para revision." });
    }

    const confidence = aiCompletenessScore(draft);
    delete draft._tarifa_unitaria_detectada;
    delete draft._ia_visual_detectada;
    const status = issues.some(i => i.severity === "alta") ? "requiere_revision" : confidence >= 78 ? "listo_para_revisar" : "incompleto";
    const operationalSummary = buildAiInboxOperationalSummary({
      status,
      confidence,
      attachments: sourceAttachments,
      issues,
      warnings,
      suggestions,
    });
    await logAiInboxRun({
      empresaId,
      userId: req.user?.id || null,
      provider: visualAi.provider || null,
      status,
      confidence,
      sourceType: req.body?.source || "texto",
      filename: req.body?.filename || null,
      attachments: sourceAttachments,
      issues,
      warnings,
      suggestions,
      error: visualAi.used && !visualAi.parsed ? "Respuesta IA sin JSON interpretable" : "",
    });
    res.json({
      source: {
        type: req.body?.source || "texto",
        filename: req.body?.filename || null,
        received_chars: texto.length,
        attachments: sourceAttachments.map(a => ({
          ...a,
          serverTextDetected: attachmentTexts.some(t => t.name === a.name),
        })),
        ai_visual: visualAi.used
          ? { provider: visualAi.provider, model: visualAi.model || null, ok: Boolean(visualAi.parsed), recovered: Boolean(visualAi.recoveredFromModel) }
          : { provider: visualAi.provider || null, ok: false, reason: visualAi.reason || null },
      },
      confidence,
      status,
      pedido: draft,
      suggestions,
      issues,
      warnings,
      next_action: issues.length
        ? "Completa los campos bloqueantes y revisa tarifa/asignacion antes de guardar."
        : "Revisa el borrador y guardalo si los datos son correctos.",
      operational_summary: operationalSummary,
    });
  } catch (e) {
    await logAiInboxRun({
      empresaId,
      userId: req.user?.id || null,
      provider: null,
      status: "error",
      confidence: 0,
      sourceType: req.body?.source || "texto",
      filename: req.body?.filename || null,
      attachments: sourceAttachments,
      error: e.message || "No se pudo interpretar el pedido",
    });
    res.status(500).json({ error: e.message || "No se pudo interpretar el pedido" });
  }
});

router.post("/chofer", async (req, res) => {
  try {
    if (req.user?.rol !== "chofer") {
      return res.status(403).json({ error: "Solo la app de chofer puede crear viajes propios desde este endpoint." });
    }
    await ensureColaboradorWorkflowSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const chofer = await resolveChoferPrincipalForUser(req.user, empresaId);
    if (!chofer?.id) {
      return res.status(400).json({ error: "Tu usuario no esta vinculado a una ficha de chofer activa." });
    }

    const origen = String(req.body?.origen || "").trim();
    const destino = String(req.body?.destino || "").trim();
    const mercancia = String(req.body?.mercancia || req.body?.descripcion_carga || "").trim();
    if (!origen || !destino || !mercancia) {
      return res.status(400).json({ error: "Indica origen, destino y mercancia para crear el DCD." });
    }

    const fechaCargaNorm = normalizePedidoDate(req.body?.fecha_carga) || new Date().toISOString().slice(0, 10);
    const fechaDescargaNorm = normalizePedidoDate(req.body?.fecha_descarga || req.body?.fecha_entrega) || fechaCargaNorm;
    const horaCargaNorm = normalizePedidoTime(req.body?.hora_carga);
    const horaDescargaNorm = normalizePedidoTime(req.body?.hora_descarga);
    assertPedidoDateOrder(fechaCargaNorm, fechaDescargaNorm);

    let pedido;
    await db.transaction(async (client) => {
      const clienteId = await resolveClienteLitePedido(client, empresaId, req.body || {});
      await assertClienteAdmiteNuevoPedido(client, req, clienteId, 0);
      let rutaId = normalizePedidoUuid(req.body?.ruta_id);
      if (rutaId) {
        const { rows: rutaRows } = await client.query(
          `SELECT r.id
             FROM rutas r
             LEFT JOIN ruta_precios_cliente rc ON rc.ruta_id=r.id AND rc.cliente_id=$2
            WHERE r.id=$1
              AND (r.cliente_id=$2 OR rc.cliente_id=$2)
              AND (r.empresa_id=$3 OR r.empresa_id IS NULL)
              AND COALESCE(r.activa,true)=true
            LIMIT 1`,
          [rutaId, clienteId, empresaId]
        );
        if (!rutaRows[0]) rutaId = null;
      }
      const numero = await nextPedidoNumero(client, empresaId, "DCD");
      const origenPais = normalizePaisPedido(req.body?.origen_pais || "España");
      const destinoPais = normalizePaisPedido(req.body?.destino_pais || "España");
      const puntosCarga = normalizePedidoStopsForStorage(req.body?.puntos_carga || [{
        nombre: req.body?.origen_nombre || origen,
        direccion: origen,
        fecha: fechaCargaNorm,
        hora: horaCargaNorm || "",
        pais: origenPais,
      }], origen, origenPais, req.body?.origen_provincia || "", {
        fecha: fechaCargaNorm,
        hora: horaCargaNorm || "",
        ventana: req.body?.ventana_carga || "",
      });
      const puntosDescarga = normalizePedidoStopsForStorage(req.body?.puntos_descarga || [{
        nombre: req.body?.destino_nombre || destino,
        direccion: destino,
        fecha: fechaDescargaNorm,
        hora: horaDescargaNorm || "",
        pais: destinoPais,
      }], destino, destinoPais, req.body?.destino_provincia || "", {
        fecha: fechaDescargaNorm,
        hora: horaDescargaNorm || "",
        ventana: req.body?.ventana_descarga || "",
      });
      const geoPedido = derivePedidoGeoFromStops(puntosCarga, puntosDescarga, {
        origen_pais: origenPais,
        destino_pais: destinoPais,
        origen_provincia: req.body?.origen_provincia || "",
        destino_provincia: req.body?.destino_provincia || "",
      });

      const { rows } = await client.query(`
        INSERT INTO pedidos
          (numero, cliente_id, ruta_id, vehiculo_id, chofer_id, origen, destino,
           fecha_pedido, fecha_carga, hora_carga, fecha_entrega, empresa_id,
           mercancia, peso_kg, bultos, importe, notas, estado)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,$8,$9,$10,$11,$12,$13,$14,0,$15,'confirmado')
        RETURNING *`,
        [
          numero,
          clienteId,
          rutaId,
          normalizePedidoUuid(req.body?.vehiculo_id) || chofer.vehiculo_id || null,
          chofer.id,
          origen,
          destino,
          fechaCargaNorm,
          horaCargaNorm,
          fechaDescargaNorm,
          empresaId,
          mercancia,
          normalizePedidoValue("peso_kg", req.body?.peso_kg),
          normalizePedidoValue("bultos", req.body?.bultos),
          String(req.body?.notas || "Creado desde app chofer para DCD.").trim().slice(0, 1000),
        ]
      );
      pedido = rows[0];

      const extraFields = [
        ["fecha_descarga", fechaDescargaNorm],
        ["hora_descarga", horaDescargaNorm],
        ["ventana_carga", req.body?.ventana_carga || null],
        ["ventana_descarga", req.body?.ventana_descarga || null],
        ["origen_pais", geoPedido.origen_pais],
        ["origen_provincia", geoPedido.origen_provincia || req.body?.origen_provincia || null],
        ["destino_pais", geoPedido.destino_pais],
        ["destino_provincia", geoPedido.destino_provincia || req.body?.destino_provincia || null],
        ["cmr_tipo", cmrTipoPedido(geoPedido.origen_pais, geoPedido.destino_pais, req.body?.cmr_tipo)],
        ["referencia_cliente", req.body?.referencia_cliente || null],
        ["tipo_carga", req.body?.tipo_carga || null],
        ["metros_lineales", normalizePedidoValue("metros_lineales", req.body?.metros_lineales)],
        ["puntos_carga", JSON.stringify(puntosCarga)],
        ["puntos_descarga", JSON.stringify(puntosDescarga)],
        ["remolque_id", normalizePedidoUuid(req.body?.remolque_id) || chofer.remolque_id || null],
      ].filter(([, value]) => value !== undefined);
      const updated = await updateExistingPedidoFields(client, extraFields, pedido.id, empresaId);
      pedido = updated || pedido;
      await logPedidoEvento(pedido.id, empresaId, "pedido.creado_app_chofer", {
        source: "app_chofer",
        transgest_lite: true,
        dcd_required: true,
      }, "chofer", req.user?.id || null, client);
    });

    const repo = await archivarDocumentoControlPedido({
      pedidoId: pedido.id,
      empresaId,
      appBaseUrl: publicBaseUrl(req),
      userId: req.user?.id || null,
      motivo: "creacion_app_chofer_dcd",
    }).catch(e => {
      logger.warn("No se pudo prearchivar el DCD creado por chofer:", e.message);
      return null;
    });
    const ctx = await getPedidoDocumentoControlContext(pedido.id, empresaId);
    res.status(201).json({
      ok: true,
      pedido,
      repositorio: repo,
      documento_control: ctx ? await buildPedidoDocumentoControlResponse(req, ctx, empresaId) : null,
    });
    webhooks.dispatch(empresaId, "pedido.creado", { pedido_id: pedido.id, numero: pedido.numero, cliente_id: pedido.cliente_id, origen: pedido.origen, destino: pedido.destino }).catch(() => {});
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === "22P02") return res.status(400).json({ error: "Alguno de los datos del viaje no tiene formato valido." });
    if (e.code === "23503") return res.status(400).json({ error: "Cliente, chofer o vehiculo no pertenecen a esta empresa." });
    res.status(500).json({ error: e.message || "No se pudo crear el viaje desde la app de chofer" });
  }
});

router.post("/", GERENTE_O_TRAFICO,
  body("cliente_id").isUUID(),
  body("importe").optional({ checkFalsy: true }).custom(value => parseLocaleNumber(value) !== null),
  async (req, res) => {
    await ensureColaboradorWorkflowSchema();
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
    const { cliente_id, ruta_id, vehiculo_id, chofer_id, origen, destino,
            fecha_pedido, fecha_carga, hora_carga, fecha_entrega,
            mercancia, peso_kg, bultos, importe, notas, extracostes = [],
            remolque_id_manual, remolque_id } = req.body; // remolque_id_manual si se especifica uno distinto al del conjunto

    const empresaId = req.empresaId||req.user.empresa_id;
    try {
      assertPedidoDateInputs(req.body, new Set(["fecha_pedido", "fecha_carga", "fecha_entrega", "fecha_descarga"]));
    } catch (dateErr) {
      return res.status(dateErr.status || 400).json({ error: dateErr.message, field: dateErr.field });
    }
    let rutaIdNorm = normalizePedidoUuid(ruta_id);
    if (ruta_id && !rutaIdNorm) {
      return res.status(400).json({ error: "La ruta indicada no es valida." });
    }
    if (rutaIdNorm) {
      const resolvedRuta = await resolveCompatibleRutaId(db, empresaId, rutaIdNorm, req.body);
      rutaIdNorm = resolvedRuta.rutaId;
    }
    const fechaPedidoNorm = normalizePedidoDate(fecha_pedido) || new Date();
    const fechaCargaNorm = normalizePedidoDate(fecha_carga);
    const horaCargaNorm = normalizePedidoTime(hora_carga);
    const fechaEntregaNorm = normalizePedidoDate(fecha_entrega);
    const fechaDescargaNorm = normalizePedidoDate(req.body.fecha_descarga);
    const horaDescargaNorm = normalizePedidoTime(req.body.hora_descarga);
    try {
      assertPedidoDateOrder(fechaCargaNorm, fechaDescargaNorm || fechaEntregaNorm);
    } catch (dateErr) {
      return res.status(dateErr.status || 400).json({ error: dateErr.message });
    }
    const importeInicial = parseLocaleNumber(importe)
      ?? calcPedidoImporteCanonical(normalizePedidoTarifaFields({
        ...req.body,
        extracostes_importe: req.body.extracostes_importe ?? req.body.extracostes,
      }))
      ?? 0;
    let festivoAviso = null;
    try {
      festivoAviso = await bloquearSiFestivoNoConfirmado(req, {
        ...req.body,
        fecha_carga: fechaCargaNorm,
        fecha_descarga: fechaDescargaNorm,
        fecha_entrega: fechaEntregaNorm,
      });
    } catch (festivoErr) {
      if (festivoErr.status === 409) return responderFestivoPendiente(res, festivoErr.aviso);
      throw festivoErr;
    }
    try {
      await validatePedidoAssignment(db, req.body, empresaId);
    } catch (validationErr) {
      return res.status(validationErr.status || 400).json({ error: validationErr.message });
    }

    let pedidoCreado = null;
    let remolqueMatCreado = null;
    await db.transaction(async (client) => {
      await assertClienteAdmiteNuevoPedido(client, req, cliente_id, importeInicial);
      // Resolver el remolque efectivo para este pedido
      const remolqueSolicitado = remolque_id_manual || remolque_id || null;
      let remolque_id_efectivo = remolqueSolicitado;
      let remolque_mat = null;

      if (vehiculo_id) {
        await client.query("SAVEPOINT pedido_vehicle_lookup");
        try {
          const { rows: veh } = await client.query(
            "SELECT matricula, clase, remolque_id FROM vehiculos WHERE id=$1 AND empresa_id=$2",
            [vehiculo_id, empresaId]
          );
          const tractora = veh[0];
          const currentRemolqueId = tractora?.remolque_id;

          if (remolqueSolicitado && remolqueSolicitado !== currentRemolqueId) {
            await client.query(
              "UPDATE vehiculos SET remolque_id=$1 WHERE id=$2 AND empresa_id=$3",
              [remolqueSolicitado, vehiculo_id, empresaId]
            );
            const { rows: rm } = await client.query("SELECT matricula FROM vehiculos WHERE id=$1 AND empresa_id=$2", [remolqueSolicitado, empresaId]);
            remolque_mat = rm[0]?.matricula;
            remolque_id_efectivo = remolqueSolicitado;
          } else if (!remolque_id_manual && currentRemolqueId) {
            remolque_id_efectivo = currentRemolqueId;
            const { rows: rem } = await client.query("SELECT matricula FROM vehiculos WHERE id=$1 AND empresa_id=$2", [currentRemolqueId, empresaId]);
            remolque_mat = rem[0]?.matricula;
          }
          await client.query("RELEASE SAVEPOINT pedido_vehicle_lookup");
        } catch(vehErr) {
          await client.query("ROLLBACK TO SAVEPOINT pedido_vehicle_lookup");
          await client.query("RELEASE SAVEPOINT pedido_vehicle_lookup");
          logger.warn(`Pedidos: no se pudo resolver el conjunto asignado; se conserva la seleccion recibida. ${vehErr.message}`);
        }
      }

      const numero = await nextGestionPedidoNumero(client, empresaId);

      // Check if remolque columns exist (migration may not have run)
      let pedido;
      await client.query("SAVEPOINT pedido_insert_with_trailer");
      try {
        const r = await client.query(`
          INSERT INTO pedidos (numero, cliente_id, ruta_id, vehiculo_id, chofer_id,
            origen, destino, fecha_pedido, fecha_carga, hora_carga, fecha_entrega,
            mercancia, peso_kg, bultos, importe, notas, empresa_id,
            remolque_id, remolque_matricula)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [numero,cliente_id,rutaIdNorm,vehiculo_id||null,chofer_id||null,origen,destino,
           fechaPedidoNorm,fechaCargaNorm,horaCargaNorm,fechaEntregaNorm,
           mercancia,normalizePedidoValue("peso_kg", peso_kg),normalizePedidoValue("bultos", bultos),normalizePedidoValue("importe", importeInicial),notas,empresaId,
           remolque_id_efectivo, remolque_mat]
        );
        pedido = r.rows[0];
        await client.query("RELEASE SAVEPOINT pedido_insert_with_trailer");
      } catch(colErr) {
        await client.query("ROLLBACK TO SAVEPOINT pedido_insert_with_trailer");
        await client.query("RELEASE SAVEPOINT pedido_insert_with_trailer");
        // Fallback: insert without remolque columns if migration not run
        if (colErr.code === '42703') {
          logger.warn("Pedidos: esquema sin columnas de remolque; se usa alta compatible.");
          const r = await client.query(`
            INSERT INTO pedidos (numero, cliente_id, ruta_id, vehiculo_id, chofer_id,
              origen, destino, fecha_pedido, fecha_carga, hora_carga, fecha_entrega,
              mercancia, peso_kg, bultos, importe, notas, empresa_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
            [numero,cliente_id,rutaIdNorm,vehiculo_id||null,chofer_id||null,origen,destino,
             fechaPedidoNorm,fechaCargaNorm,horaCargaNorm,fechaEntregaNorm,
             mercancia,normalizePedidoValue("peso_kg", peso_kg),normalizePedidoValue("bultos", bultos),normalizePedidoValue("importe", importeInicial),notas,empresaId]
          );
          pedido = r.rows[0];
        } else { throw colErr; }
      }

      const ivaPedido = (req.body.tipo_iva !== undefined || req.body.iva_regimen !== undefined)
        ? normalizeIvaRegimen(req.body.tipo_iva, req.body.iva_regimen)
        : null;
      const origenPaisFallback = normalizePaisPedido(req.body.origen_pais || req.body.pais_origen || "España");
      const destinoPaisFallback = normalizePaisPedido(req.body.destino_pais || req.body.pais_destino || "España");
      const puntosCargaNorm = req.body.puntos_carga !== undefined
        ? normalizePedidoStopsForStorage(req.body.puntos_carga, origen, origenPaisFallback, req.body.origen_provincia || req.body.provincia_origen || "", {
            fecha: fechaCargaNorm || "",
            hora: horaCargaNorm || "",
            ventana: req.body.ventana_carga || "",
          })
        : null;
      const puntosDescargaNorm = req.body.puntos_descarga !== undefined
        ? normalizePedidoStopsForStorage(req.body.puntos_descarga, destino, destinoPaisFallback, req.body.destino_provincia || req.body.provincia_destino || "", {
            fecha: fechaDescargaNorm || fechaEntregaNorm || "",
            hora: horaDescargaNorm || "",
            ventana: req.body.ventana_descarga || "",
          })
        : null;
      const geoPedido = derivePedidoGeoFromStops(puntosCargaNorm || [], puntosDescargaNorm || [], {
        ...req.body,
        origen_pais: origenPaisFallback,
        destino_pais: destinoPaisFallback,
      });
      const extraFieldMap = {
        fecha_descarga: fechaDescargaNorm ?? null,
        hora_descarga: horaDescargaNorm ?? null,
        ventana_carga: req.body.ventana_carga ?? null,
        ventana_descarga: req.body.ventana_descarga ?? null,
        origen_pais: geoPedido.origen_pais,
        origen_provincia: geoPedido.origen_provincia,
        destino_pais: geoPedido.destino_pais,
        destino_provincia: geoPedido.destino_provincia,
        cmr_tipo: req.body.cmr_tipo ? cmrTipoPedido(geoPedido.origen_pais, geoPedido.destino_pais, req.body.cmr_tipo) : geoPedido.cmr_tipo,
        peso_kg: req.body.peso_kg ?? peso_kg ?? null,
        km_ruta: req.body.km_ruta ?? null,
        km_vacio: req.body.km_vacio ?? null,
        volumen: req.body.volumen ?? null,
        metros_lineales: req.body.metros_lineales ?? null,
        tipo_precio: req.body.tipo_precio ?? "viaje",
        cantidad: req.body.cantidad !== undefined ? (req.body.cantidad ?? null) : undefined,
        precio_unitario: req.body.precio_unitario ?? null,
        precio_base_sin_combustible: req.body.precio_base_sin_combustible !== undefined ? (req.body.precio_base_sin_combustible ?? null) : undefined,
        recargo_combustible_pct: req.body.recargo_combustible_pct !== undefined ? (req.body.recargo_combustible_pct ?? 0) : undefined,
        importe_revision_combustible: req.body.importe_revision_combustible !== undefined ? (req.body.importe_revision_combustible ?? 0) : undefined,
        extracostes_importe: req.body.extracostes_importe ?? 0,
        tipo_iva: ivaPedido ? ivaPedido.tipo_iva : undefined,
        iva_regimen: ivaPedido ? ivaPedido.iva_regimen : undefined,
        colaborador_id: req.body.colaborador_id ?? null,
        chofer2_id: req.body.chofer2_id ?? null,
        precio_cliente_col: req.body.precio_cliente_col !== undefined ? (req.body.precio_cliente_col ?? null) : undefined,
        precio_colaborador: req.body.precio_colaborador !== undefined ? (req.body.precio_colaborador ?? null) : undefined,
        precio_colaborador_unitario: req.body.precio_colaborador_unitario !== undefined ? (req.body.precio_colaborador_unitario ?? null) : undefined,
        minimo_colaborador_unidades: req.body.minimo_colaborador_unidades !== undefined ? (req.body.minimo_colaborador_unidades ?? null) : undefined,
        reparto_chofer1: req.body.reparto_chofer1 ?? 50,
        referencia_cliente: req.body.referencia_cliente ?? null,
        matricula_colaborador: req.body.matricula_colaborador !== undefined ? (req.body.matricula_colaborador ? String(req.body.matricula_colaborador).trim().toUpperCase() : null) : undefined,
        remolque_matricula_colaborador: req.body.remolque_matricula_colaborador !== undefined ? (req.body.remolque_matricula_colaborador ? String(req.body.remolque_matricula_colaborador).trim().toUpperCase() : null) : undefined,
        conductor_efectivo_nombre: req.body.conductor_efectivo_nombre !== undefined ? String(req.body.conductor_efectivo_nombre || "").trim().slice(0, 120) || null : undefined,
        conductor_efectivo_apellidos: req.body.conductor_efectivo_apellidos !== undefined ? String(req.body.conductor_efectivo_apellidos || "").trim().slice(0, 180) || null : undefined,
        conductor_efectivo_dni: req.body.conductor_efectivo_dni !== undefined ? String(req.body.conductor_efectivo_dni || "").trim().toUpperCase().slice(0, 40) || null : undefined,
        conductor_efectivo_telefono: req.body.conductor_efectivo_telefono !== undefined ? String(req.body.conductor_efectivo_telefono || "").trim().slice(0, 40) || null : undefined,
        pendiente_completar: req.body.pendiente_completar ?? false,
        aviso_completar: req.body.aviso_completar ?? null,
        tipo_carga: req.body.tipo_carga ?? null,
        tipo_viaje: req.body.tipo_viaje !== undefined ? normalizeTipoViaje(req.body.tipo_viaje) : undefined,
        grupaje_id: req.body.grupaje_id ?? null,
        carga_lateral: req.body.carga_lateral ?? false,
        carga_trasera: req.body.carga_trasera ?? false,
        carga_techo: req.body.carga_techo ?? false,
        intercambio_palets: req.body.intercambio_palets ?? false,
        requiere_cinchas: req.body.requiere_cinchas ?? true,
        adr: req.body.adr !== undefined ? !!req.body.adr : undefined,
        adr_items: req.body.adr_items !== undefined ? JSON.stringify(Array.isArray(req.body.adr_items) ? req.body.adr_items.map(it => adrService.normalizeItem(it)) : []) : undefined,
        matricula_manual: req.body.matricula_manual !== undefined ? (String(req.body.matricula_manual || "").trim().toUpperCase().slice(0, 60) || null) : undefined,
        remolque_matricula_manual: req.body.remolque_matricula_manual !== undefined ? (String(req.body.remolque_matricula_manual || "").trim().toUpperCase().slice(0, 60) || null) : undefined,
        coste_gasoil: req.body.coste_gasoil !== undefined ? (req.body.coste_gasoil ?? 0) : undefined,
        coste_peajes: req.body.coste_peajes !== undefined ? (req.body.coste_peajes ?? 0) : undefined,
        coste_dietas: req.body.coste_dietas !== undefined ? (req.body.coste_dietas ?? 0) : undefined,
        coste_otros: req.body.coste_otros !== undefined ? (req.body.coste_otros ?? 0) : undefined,
        coste_notas: req.body.coste_notas !== undefined ? (req.body.coste_notas ?? null) : undefined,
        condiciones_adicionales: req.body.condiciones_adicionales !== undefined ? (req.body.condiciones_adicionales ?? null) : undefined,
        importe_minimo: req.body.importe_minimo !== undefined ? (parseLocaleNumber(req.body.importe_minimo) || 0) : undefined,
        minimo_unidades: req.body.minimo_unidades !== undefined ? (parseLocaleNumber(req.body.minimo_unidades) || 0) : undefined,
        importe_paralizacion: req.body.importe_paralizacion !== undefined ? (parseLocaleNumber(req.body.importe_paralizacion) || 0) : undefined,
        paralizacion_horas: req.body.paralizacion_horas !== undefined ? (parseLocaleNumber(req.body.paralizacion_horas) || 0) : undefined,
        puntos_carga: puntosCargaNorm !== null ? JSON.stringify(mergePrimaryStopScheduleForStorage(puntosCargaNorm, {
          fecha: fechaCargaNorm || "",
          hora: horaCargaNorm || "",
          ventana: req.body.ventana_carga || "",
        })) : undefined,
        puntos_descarga: puntosDescargaNorm !== null ? JSON.stringify(mergePrimaryStopScheduleForStorage(puntosDescargaNorm, {
          fecha: fechaDescargaNorm || fechaEntregaNorm || "",
          hora: horaDescargaNorm || "",
          ventana: req.body.ventana_descarga || "",
        })) : undefined,
      };
      const requestedRutaId = normalizePedidoUuid(req.body.ruta_id);
      let rutaIncompatibleDesvinculada = false;
      if (requestedRutaId && !rutaIdNorm) {
        rutaIncompatibleDesvinculada = true;
      }
      const kmInferido = await inferKmRutaPedido(client, empresaId, { ...pedido, ...extraFieldMap, cliente_id, ruta_id: rutaIdNorm, origen, destino });
      if (kmInferido && !parseLocaleNumber(extraFieldMap.km_ruta)) extraFieldMap.km_ruta = kmInferido;
      const normalizedExtraFieldMap = normalizePedidoTarifaFields(extraFieldMap);
      let precioClienteColSincronizado = false;
      if (hasPedidoTarifaCalcInput(req.body)) {
        const importeCanonico = calcPedidoImporteCanonical({ ...pedido, ...normalizedExtraFieldMap });
        if (importeCanonico !== null) {
          normalizedExtraFieldMap.importe = importeCanonico;
          if (normalizedExtraFieldMap.colaborador_id) {
            normalizedExtraFieldMap.precio_cliente_col = importeCanonico;
            precioClienteColSincronizado = true;
          }
        }
      }
      if (normalizedExtraFieldMap.colaborador_id) normalizedExtraFieldMap.coste_gasoil = 0;
      const extraFields = Object.entries(normalizedExtraFieldMap).filter(([k]) => (
        (k in req.body) ||
        ((k === "tipo_iva" || k === "iva_regimen") && ivaPedido) ||
        ["origen_pais","destino_pais","cmr_tipo"].includes(k) ||
        (["origen_provincia","destino_provincia"].includes(k) && (req.body.puntos_carga !== undefined || req.body.puntos_descarga !== undefined)) ||
        (k === "coste_gasoil" && normalizedExtraFieldMap.colaborador_id) ||
        (k === "importe" && hasPedidoTarifaCalcInput(req.body)) ||
        (k === "precio_cliente_col" && precioClienteColSincronizado) ||
        (k === "km_ruta" && normalizedExtraFieldMap.km_ruta !== extraFieldMap.km_ruta) ||
        (k === "km_ruta" && normalizedExtraFieldMap.km_ruta && !req.body.km_ruta) ||
        (k === "cantidad" && normalizedExtraFieldMap.cantidad !== extraFieldMap.cantidad) ||
        (k === "minimo_unidades" && normalizedExtraFieldMap.minimo_unidades !== extraFieldMap.minimo_unidades)
      ) && normalizedExtraFieldMap[k] !== undefined);
      if (extraFields.length) {
        const updatedPedido = await updateExistingPedidoFields(client, extraFields, pedido.id, empresaId);
        pedido = updatedPedido || pedido;
      }
      pedido = await confirmarPedidoPorAsignacionSiProcede(pedido, empresaId, req.user, client);
      await sincronizarConjuntoChoferDesdePedido(client, pedido, empresaId);
      if (rutaIncompatibleDesvinculada) {
        await logPedidoEvento(pedido.id, empresaId, "ruta.incompatible_desvinculada", {
          ruta_id_solicitada: requestedRutaId,
          motivo: "La ruta indicada tiene una tarifa/precio/minimo incompatible con el pedido guardado.",
          tipo_precio: pedido.tipo_precio,
          precio_unitario: pedido.precio_unitario,
          minimo_unidades: pedido.minimo_unidades,
        }, "sistema", null, client);
      }

      // Registrar historial (only if table exists)
      if (chofer_id && vehiculo_id) {
        try {
          const { rows: veh } = await client.query("SELECT matricula FROM vehiculos WHERE id=$1 AND empresa_id=$2", [vehiculo_id, empresaId]);
          await client.query(`
            INSERT INTO chofer_vehiculo_historial
              (chofer_id, vehiculo_id, remolque_id, pedido_id, matricula, remolque_mat, tipo, empresa_id)
            VALUES ($1,$2,$3,$4,$5,$6,'pedido',$7)`,
            [chofer_id, vehiculo_id, remolque_id_efectivo||null, pedido.id,
             veh[0]?.matricula, remolque_mat, empresaId]
          );
        } catch(histErr) { /* tabla no existe aun - ignorar */ }
      }

      for (const e of extracostes) {
        await client.query(
          "INSERT INTO pedido_extracostes (pedido_id,tipo,concepto,importe) VALUES ($1,$2,$3,$4)",
          [pedido.id, e.tipo||"otro", e.concepto, normalizePedidoValue("importe", e.importe) || 0]
        );
      }
      if (req.body?.ai_metadata && typeof req.body.ai_metadata === "object") {
        const aiMeta = req.body.ai_metadata;
        await logPedidoEvento(pedido.id, empresaId, "pedido.creado_bandeja_ia", {
          source: String(aiMeta.source || "bandeja_ia").slice(0, 80),
          filename: aiMeta.filename ? String(aiMeta.filename).slice(0, 240) : null,
          confidence: Math.max(0, Math.min(100, Math.round(Number(aiMeta.confidence || 0)))),
          status: String(aiMeta.status || "").slice(0, 60),
          issues_count: Math.max(0, Math.round(Number(aiMeta.issues_count || 0))),
          warnings_count: Math.max(0, Math.round(Number(aiMeta.warnings_count || 0))),
          attachments_count: Math.max(0, Math.round(Number(aiMeta.attachments_count || 0))),
          visual_provider: aiMeta.visual_provider ? String(aiMeta.visual_provider).slice(0, 80) : null,
          visual_ok: Boolean(aiMeta.visual_ok),
        }, req.user?.rol || "usuario", req.user?.id || null, client);
      }
      await logPedidoEvento(pedido.id, empresaId, "pedido.creado", {
        numero: pedido.numero,
        cliente_id,
        ruta_id: rutaIdNorm || null,
        origen: pedido.origen || origen || null,
        destino: pedido.destino || destino || null,
      }, req.user?.rol || "usuario", req.user?.id || null, client);
      pedidoCreado = pedido;
      remolqueMatCreado = remolque_mat;
    });
    res.status(201).json({...pedidoCreado, remolque_matricula: remolqueMatCreado});
    webhooks.dispatch(empresaId, "pedido.creado", { pedido_id: pedidoCreado && pedidoCreado.id, numero: pedidoCreado && pedidoCreado.numero, cliente_id, origen: pedidoCreado && pedidoCreado.origen, destino: pedidoCreado && pedidoCreado.destino }).catch(() => {});
    if (pedidoCreado && festivoAviso) {
      notificarGerenciaPedido(
        empresaId,
        "pedido_destino_festivo",
        "Pedido enviado a zona en festivo",
        `El pedido ${pedidoCreado.numero || pedidoCreado.id} se ha confirmado para ${festivoAviso.ccaa_label} en festivo (${festivoAviso.festivo_nombre}).`,
        { ...festivoAviso, pedido_id: pedidoCreado.id, pedido_numero: pedidoCreado.numero, dedupe_key: `festivo:${pedidoCreado.id}:${festivoAviso.fecha}:${festivoAviso.ccaa}` },
        req.user?.id || null
      ).catch(e => logger.warn("No se pudo notificar destino festivo:", e.message));
    }
    if (pedidoCreado) {
      notificarPlanificacionIdaRetorno(pedidoCreado, empresaId, req.user?.id || null)
        .catch(e => logger.warn("No se pudo notificar planificacion ida-retorno:", e.message));
    }
    } catch (e) {
      if (e.code === "23505" && String(e.constraint || "").includes("pedidos_numero")) {
        return res.status(409).json({
          error: "No se pudo reservar el numero del pedido. Actualiza la pantalla y vuelve a guardarlo.",
          code: "PEDIDO_NUMERO_DUPLICADO",
        });
      }
      if (e.code === "22001") {
        return res.status(400).json({ error: "Alguno de los textos del pedido supera la longitud permitida. Revisa ventanas horarias, matriculas o referencias." });
      }
      if (e.code === "22P02") {
        return res.status(400).json({ error: "Alguno de los importes, pesos, bultos o identificadores del pedido no tiene un formato valido." });
      }
      if (e.code === "23503") {
        return res.status(400).json({ error: "Alguna asignacion del pedido no existe o no pertenece a esta empresa. Refresca la pantalla y vuelve a seleccionar vehiculo, chofer, remolque o colaborador." });
      }
      if (e.status === 404) {
        return res.status(404).json({ error: e.message || "No encontrado" });
      }
      if (e.status === 409 && (e.code === "CLIENTE_BLOQUEADO" || e.code === "CLIENTE_RIESGO_BLOQUEADO")) {
        return res.status(409).json({
          error: e.message,
          code: e.code,
          cliente: e.cliente || null,
        });
      }
      res.status(500).json({ error: e.message || "No se pudo crear el pedido" });
    }
  }
);

// PATCH /pedidos/:id/estado
router.patch("/:id/estado",
  body("estado").isIn(["pendiente","confirmado","espera_carga","cargando","en_curso","espera_descarga","descarga","entregado","cancelado","incidencia"]),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
    const { estado } = req.body;
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query("SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
    if (!rows[0]) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, rows[0]))) {
      return res.status(403).json({ error: "No puedes modificar este pedido" });
    }
    if (req.user?.rol === "chofer" && !["espera_carga","cargando","en_curso","espera_descarga","descarga","entregado","incidencia"].includes(estado)) {
      return res.status(403).json({ error: "El chofer no puede aplicar este estado" });
    }
    if (String(rows[0].estado || "").toLowerCase() === "entregado" && String(estado || "").toLowerCase() !== "entregado" && req.user?.rol !== "gerente") {
      return res.status(403).json({ error: "Solo gerencia puede cambiar el estado de un pedido entregado" });
    }
    await assertUnicoViajeActivoChofer({ pedido: rows[0], empresaId, estadoDestino: estado });

    await ensureColaboradorWorkflowSchema();
    const actorUsuarioId = optionalUuid(req.user?.id);
    const incidenciaData = buildPedidoIncidenciaInput(req.body || {}, rows[0], req.user?.rol);
    const incidencia = incidenciaData.descripcion;
    const incidenciaTipo = incidenciaData.tipo;
    const motivoCancelacion = typeof req.body.motivo_cancelacion === "string"
      ? req.body.motivo_cancelacion.trim()
      : typeof req.body.motivo === "string" ? req.body.motivo.trim() : "";
    if (estado === "cancelado") {
      const cfgTrafico = await getCfgTraficoEmpresa(empresaId);
      const requiereMotivo = cfgTrafico.requerir_motivo_cancelacion !== false && cfgTrafico.requiere_motivo_cancelacion !== false;
      if (requiereMotivo && !motivoCancelacion) {
        return res.status(400).json({ error: "Indica el motivo de cancelacion para cancelar este pedido.", code: "MOTIVO_CANCELACION_REQUERIDO" });
      }
    }
    if (estado === "incidencia") {
      const incidenciaNota = `INCIDENCIA: ${incidenciaData.label} - ${incidencia}`;
      try {
        await db.query(
          `UPDATE pedidos
           SET estado=$1,
               incidencia_tipo=$5,
               incidencia_descripcion=$2,
               incidencia_origen=$6,
               incidencia_creada_por=$7,
               incidencia_creada_at=NOW(),
               incidencia_automatica=false,
               notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(notas,''), $8::text))
           WHERE id=$3 AND empresa_id=$4`,
          [estado, incidencia, req.params.id, empresaId, incidenciaTipo, incidenciaData.origen, actorUsuarioId, incidenciaNota]
        );
      } catch (incidenciaError) {
        // Ante CUALQUIER error del update completo, no fallamos: aplicamos el
        // update seguro (estado + notas) y rellenamos las columnas estructuradas
        // en best-effort. Asi crear una incidencia nunca devuelve un 500.
        logger.warn(`Incidencia en modo compatible para pedido ${req.params.id} (code ${incidenciaError?.code || "?"}): ${incidenciaError.message}`);
        await db.query(
          `UPDATE pedidos
              SET estado=$1,
                  notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(notas,''), $2::text))
            WHERE id=$3 AND empresa_id=$4`,
          [estado, incidenciaNota, req.params.id, empresaId]
        );
        await db.query(
          `UPDATE pedidos
              SET incidencia_tipo=$1, incidencia_descripcion=$2, incidencia_origen=$3,
                  incidencia_creada_por=$4, incidencia_creada_at=NOW(), incidencia_automatica=false
            WHERE id=$5 AND empresa_id=$6`,
          [incidenciaTipo, incidencia, incidenciaData.origen, actorUsuarioId, req.params.id, empresaId]
        ).catch(colErr => logger.warn(`Campos estructurados de incidencia no guardados (${colErr?.code || "?"}): ${colErr.message}`));
      }
    } else if (estado === "cancelado") {
      await db.query(
        `UPDATE pedidos
         SET estado=$1,
             motivo_cancelacion=$2::text,
             cancelado_at=NOW(),
             cancelado_by=$3,
             notas=CASE
               WHEN NULLIF($2::text,'') IS NULL THEN notas
               ELSE TRIM(BOTH ' ' FROM CONCAT_WS(' | ', NULLIF(notas,''), $4::text))
             END
         WHERE id=$5 AND empresa_id=$6`,
        [estado, motivoCancelacion || null, actorUsuarioId, `CANCELACION: ${motivoCancelacion}`, req.params.id, empresaId]
      );
    } else {
      await db.query(
        "UPDATE pedidos SET estado=$1, motivo_cancelacion=NULL, cancelado_at=NULL, cancelado_by=NULL WHERE id=$2 AND empresa_id=$3",
        [estado, req.params.id, empresaId]
      );
    }

    if (estado === "descarga" && rows[0].vehiculo_id && rows[0].destino) {
      await db.query(
        "UPDATE vehiculos SET ubicacion_actual=$1, ubicacion_fuente='ultima_descarga', ubicacion_ts=NOW() WHERE id=$2 AND empresa_id=$3",
        [rows[0].destino, rows[0].vehiculo_id, empresaId]
      ).catch(e => logger.warn("No se pudo actualizar ubicacion del vehiculo:", e.message));
    }

    // Emails automaticos
    await logPedidoEvento(req.params.id, empresaId, "estado.actualizado", {
      estado,
      incidencia: incidencia || null,
      motivo_cancelacion: motivoCancelacion || null,
    }, req.user?.rol || "usuario", actorUsuarioId)
      .catch(e => logger.warn("No se pudo registrar la trazabilidad del cambio de estado:", e.message));
    await notificarClienteEstadoPedido(rows[0], rows[0].estado, estado, actorUsuarioId)
      .catch(e => logger.warn("No se pudo notificar el estado al cliente:", e.message));

    if (estado === "incidencia") {
      const origenIncidencia = req.user?.rol === "chofer" ? "chofer" : "trafico";
      await notificarGestionPedido(
        empresaId,
        "pedido_incidencia",
        `Incidencia en ${rows[0].numero || "pedido"}`,
        incidencia
          ? `${origenIncidencia === "chofer" ? "El chofer" : "Trafico"} ha avisado: ${incidencia}`
          : `${origenIncidencia === "chofer" ? "El chofer" : "Trafico"} ha marcado el pedido con incidencia.`,
        {
          pedido_id: req.params.id,
          pedido_numero: rows[0].numero || null,
          origen: incidenciaData.origen || origenIncidencia,
          incidencia_tipo: incidenciaTipo,
          incidencia: incidencia || null,
          incidencia_label: incidenciaData.label,
          ruta: `${rows[0].origen || ""} -> ${rows[0].destino || ""}`,
          dedupe_key: `incidencia:${req.params.id}:${crypto.randomUUID()}`,
        },
        actorUsuarioId
      ).catch(e => logger.warn("No se pudo notificar incidencia de pedido:", e.message));
    }

    if (estado === "entregado") {
      await aplicarAutomatismosEntrega(req.params.id, empresaId, actorUsuarioId, { appBaseUrl: publicBaseUrl(req) });
    }

    if (estado === "confirmado" || estado === "entregado") {
      const { rows: cliRows } = await db.query("SELECT email, nombre FROM clientes WHERE id=$1 AND empresa_id=$2", [rows[0].cliente_id, empresaId]);
      if (cliRows[0]?.email) {
        const plantilla = estado === "confirmado" ? "pedido_confirmado" : "pedido_entregado";
        enviarEmail({
          trigger: plantilla,
          destinatario: cliRows[0].email,
          plantilla,
          empresa_id: empresaId,
          datos: {
            numero:        rows[0].numero,
            ruta:          `${rows[0].origen} -> ${rows[0].destino}`,
            fecha_carga:   rows[0].fecha_carga,
            fecha_entrega: rows[0].fecha_entrega || new Date().toLocaleDateString("es-ES"),
            mercancia:     rows[0].mercancia,
            destino:       rows[0].destino,
          },
        }).catch(e => logger.error("Email pedido:", e.message));
      }
    }

    res.json({ ok: true, estado, facturacion_auto: estado === "entregado" });
    } catch (e) {
      if (e.status === 409 && e.code === "CHOFER_VIAJE_ACTIVO") {
        return res.status(409).json({ error: e.message, code: e.code, pedido_activo: e.pedido_activo || null });
      }
      next(e);
    }
  }
);

// PUT /pedidos/:id
router.put("/:id", GERENTE_O_TRAFICO, async (req, res) => {
  await ensureColaboradorWorkflowSchema();
  const empresaId = req.empresaId||req.user?.empresa_id;
  const body = req.body;
  const { rows: pedidoActualRows } = await db.query(
    "SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresaId]
  );
  if (!pedidoActualRows[0]) return res.status(404).json({ error: "Pedido no encontrado" });
  try {
    assertPedidoDateInputs(body || {}, new Set(["fecha_pedido", "fecha_carga", "fecha_entrega", "fecha_descarga", "firma_fecha"]));
  } catch (dateErr) {
    return res.status(dateErr.status || 400).json({ error: dateErr.message, field: dateErr.field });
  }
  if (
    Object.prototype.hasOwnProperty.call(body || {}, "estado") &&
    String(pedidoActualRows[0].estado || "").toLowerCase() === "entregado" &&
    String(body.estado || "").toLowerCase() !== "entregado" &&
    req.user?.rol !== "gerente"
  ) {
    return res.status(403).json({ error: "Solo gerencia puede cambiar el estado de un pedido entregado" });
  }
  try {
    await validatePedidoAssignment(db, body, empresaId);
  } catch (validationErr) {
    return res.status(validationErr.status || 400).json({ error: validationErr.message });
  }
  let festivoAviso = null;
  try {
    festivoAviso = await bloquearSiFestivoNoConfirmado(req, body, pedidoActualRows[0]);
  } catch (festivoErr) {
    if (festivoErr.status === 409) return responderFestivoPendiente(res, festivoErr.aviso);
    throw festivoErr;
  }
  const assignmentFieldsTouched = ["vehiculo_id", "chofer_id", "chofer2_id", "remolque_id", "colaborador_id"].some(k => k in body);
  let pedidoAntesAsignacion = null;
  if (assignmentFieldsTouched) {
    const { rows } = await db.query(
      "SELECT id, vehiculo_id, chofer_id, chofer2_id, remolque_id, colaborador_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    pedidoAntesAsignacion = rows[0] || null;
  }

  const ivaPedido = (body.tipo_iva !== undefined || body.iva_regimen !== undefined)
    ? normalizeIvaRegimen(body.tipo_iva, body.iva_regimen)
    : null;
  const puntosCargaNormUpdate = body.puntos_carga !== undefined
    ? normalizePedidoStopsForStorage(
        body.puntos_carga,
        body.origen ?? pedidoActualRows[0].origen,
        body.origen_pais ?? body.pais_origen ?? pedidoActualRows[0].origen_pais ?? "España",
        body.origen_provincia ?? body.provincia_origen ?? pedidoActualRows[0].origen_provincia ?? ""
      )
    : normalizePedidoJsonList(pedidoActualRows[0].puntos_carga);
  const puntosDescargaNormUpdate = body.puntos_descarga !== undefined
    ? normalizePedidoStopsForStorage(
        body.puntos_descarga,
        body.destino ?? pedidoActualRows[0].destino,
        body.destino_pais ?? body.pais_destino ?? pedidoActualRows[0].destino_pais ?? "España",
        body.destino_provincia ?? body.provincia_destino ?? pedidoActualRows[0].destino_provincia ?? ""
      )
    : normalizePedidoJsonList(pedidoActualRows[0].puntos_descarga);
  const geoTouched = body.puntos_carga !== undefined || body.puntos_descarga !== undefined ||
    body.origen_pais !== undefined || body.pais_origen !== undefined || body.origen_provincia !== undefined || body.provincia_origen !== undefined ||
    body.destino_pais !== undefined || body.pais_destino !== undefined || body.destino_provincia !== undefined || body.provincia_destino !== undefined ||
    body.cmr_tipo !== undefined;
  const geoPedidoUpdate = derivePedidoGeoFromStops(puntosCargaNormUpdate, puntosDescargaNormUpdate, {
    ...pedidoActualRows[0],
    ...body,
  });
  try {
    assertPedidoDateOrder(
      body.fecha_carga !== undefined ? body.fecha_carga : pedidoActualRows[0].fecha_carga,
      body.fecha_descarga !== undefined ? body.fecha_descarga : (body.fecha_entrega !== undefined ? body.fecha_entrega : (pedidoActualRows[0].fecha_descarga || pedidoActualRows[0].fecha_entrega))
    );
  } catch (dateErr) {
    return res.status(dateErr.status || 400).json({ error: dateErr.message });
  }

  // Build dynamic UPDATE - only update fields that are present in the request
  const fieldMap = {
    cliente_id: body.cliente_id,
    ruta_id: body.ruta_id ?? null,
    vehiculo_id: body.vehiculo_id ?? null,
    chofer_id: body.chofer_id ?? null,
    chofer2_id: body.chofer2_id ?? null,
    remolque_id: body.remolque_id ?? null,
    origen: body.origen,
    destino: body.destino,
    fecha_pedido: body.fecha_pedido !== undefined ? normalizePedidoDate(body.fecha_pedido) : undefined,
    fecha_carga: body.fecha_carga !== undefined ? normalizePedidoDate(body.fecha_carga) : undefined,
    hora_carga: body.hora_carga !== undefined ? normalizePedidoTime(body.hora_carga) : undefined,
    fecha_entrega: body.fecha_entrega !== undefined ? normalizePedidoDate(body.fecha_entrega) : undefined,
    fecha_descarga: body.fecha_descarga !== undefined ? normalizePedidoDate(body.fecha_descarga) : undefined,
    hora_descarga: body.hora_descarga !== undefined ? normalizePedidoTime(body.hora_descarga) : undefined,
    ventana_carga: body.ventana_carga ?? null,
    ventana_descarga: body.ventana_descarga ?? null,
    origen_pais: geoTouched ? geoPedidoUpdate.origen_pais : undefined,
    origen_provincia: geoTouched ? geoPedidoUpdate.origen_provincia : undefined,
    destino_pais: geoTouched ? geoPedidoUpdate.destino_pais : undefined,
    destino_provincia: geoTouched ? geoPedidoUpdate.destino_provincia : undefined,
    cmr_tipo: geoTouched ? (body.cmr_tipo ? cmrTipoPedido(geoPedidoUpdate.origen_pais, geoPedidoUpdate.destino_pais, body.cmr_tipo) : geoPedidoUpdate.cmr_tipo) : undefined,
    mercancia: body.mercancia ?? null,
    peso_kg: body.peso_kg ?? null,
    bultos: body.bultos ?? null,
    volumen: body.volumen ?? null,
    metros_lineales: body.metros_lineales ?? null,
    importe: body.importe,
    notas: body.notas ?? null,
    km_ruta: body.km_ruta ?? null,
    km_vacio: body.km_vacio ?? null,
    tipo_precio: body.tipo_precio ?? 'viaje',
    cantidad: body.cantidad !== undefined ? (body.cantidad ?? null) : undefined,
    precio_unitario: body.precio_unitario ?? null,
    precio_base_sin_combustible: body.precio_base_sin_combustible !== undefined ? (body.precio_base_sin_combustible ?? null) : undefined,
    recargo_combustible_pct: body.recargo_combustible_pct !== undefined ? (body.recargo_combustible_pct ?? 0) : undefined,
    importe_revision_combustible: body.importe_revision_combustible !== undefined ? (body.importe_revision_combustible ?? 0) : undefined,
    extracostes_importe: body.extracostes_importe ?? 0,
    tipo_iva: ivaPedido ? ivaPedido.tipo_iva : undefined,
    iva_regimen: ivaPedido ? ivaPedido.iva_regimen : undefined,
    colaborador_id: body.colaborador_id ?? null,
    precio_cliente_col: body.precio_cliente_col !== undefined ? (body.precio_cliente_col ?? null) : undefined,
    precio_colaborador: body.precio_colaborador !== undefined ? (body.precio_colaborador ?? null) : undefined,
    precio_colaborador_unitario: body.precio_colaborador_unitario !== undefined ? (body.precio_colaborador_unitario ?? null) : undefined,
    minimo_colaborador_unidades: body.minimo_colaborador_unidades !== undefined ? (body.minimo_colaborador_unidades ?? null) : undefined,
    reparto_chofer1: body.reparto_chofer1 ?? 50,
    referencia_cliente: body.referencia_cliente ?? null,
    matricula_colaborador: body.matricula_colaborador !== undefined ? (body.matricula_colaborador ? String(body.matricula_colaborador).trim().toUpperCase() : null) : undefined,
    remolque_matricula_colaborador: body.remolque_matricula_colaborador !== undefined ? (body.remolque_matricula_colaborador ? String(body.remolque_matricula_colaborador).trim().toUpperCase() : null) : undefined,
    conductor_efectivo_nombre: body.conductor_efectivo_nombre !== undefined ? String(body.conductor_efectivo_nombre || "").trim().slice(0, 120) || null : undefined,
    conductor_efectivo_apellidos: body.conductor_efectivo_apellidos !== undefined ? String(body.conductor_efectivo_apellidos || "").trim().slice(0, 180) || null : undefined,
    conductor_efectivo_dni: body.conductor_efectivo_dni !== undefined ? String(body.conductor_efectivo_dni || "").trim().toUpperCase().slice(0, 40) || null : undefined,
    conductor_efectivo_telefono: body.conductor_efectivo_telefono !== undefined ? String(body.conductor_efectivo_telefono || "").trim().slice(0, 40) || null : undefined,
    pendiente_completar: body.pendiente_completar ?? false,
    aviso_completar: body.aviso_completar ?? null,
    tipo_carga: body.tipo_carga ?? null,
    tipo_viaje: body.tipo_viaje !== undefined ? normalizeTipoViaje(body.tipo_viaje) : undefined,
    grupaje_id: body.grupaje_id ?? null,
    carga_lateral: body.carga_lateral ?? false,
    carga_trasera: body.carga_trasera ?? false,
    carga_techo: body.carga_techo ?? false,
    intercambio_palets: body.intercambio_palets ?? false,
    requiere_cinchas: body.requiere_cinchas ?? true,
    adr: body.adr !== undefined ? !!body.adr : undefined,
    adr_items: body.adr_items !== undefined ? JSON.stringify(Array.isArray(body.adr_items) ? body.adr_items.map(it => adrService.normalizeItem(it)) : []) : undefined,
    matricula_manual: body.matricula_manual !== undefined ? (String(body.matricula_manual || "").trim().toUpperCase().slice(0, 60) || null) : undefined,
    remolque_matricula_manual: body.remolque_matricula_manual !== undefined ? (String(body.remolque_matricula_manual || "").trim().toUpperCase().slice(0, 60) || null) : undefined,
    estado: body.estado ?? undefined,
    incidencia_tipo: body.estado === "incidencia" || body.incidencia_tipo !== undefined || body.incidencia_descripcion !== undefined || body.incidencia !== undefined
      ? buildPedidoIncidenciaInput(body || {}, pedidoActualRows[0], req.user?.rol).tipo
      : undefined,
    incidencia_descripcion: body.estado === "incidencia" || body.incidencia_descripcion !== undefined || body.incidencia !== undefined
      ? buildPedidoIncidenciaInput(body || {}, pedidoActualRows[0], req.user?.rol).descripcion
      : undefined,
    incidencia_origen: body.estado === "incidencia"
      ? buildPedidoIncidenciaInput(body || {}, pedidoActualRows[0], req.user?.rol).origen
      : undefined,
    incidencia_creada_por: body.estado === "incidencia" ? optionalUuid(req.user?.id) : undefined,
    incidencia_creada_at: body.estado === "incidencia" ? new Date() : undefined,
    incidencia_automatica: body.estado === "incidencia" ? false : undefined,
    // Costes reales por viaje
    coste_gasoil:  body.coste_gasoil  !== undefined ? (body.coste_gasoil  ?? 0) : undefined,
    coste_peajes:  body.coste_peajes  !== undefined ? (body.coste_peajes  ?? 0) : undefined,
    coste_dietas:  body.coste_dietas  !== undefined ? (body.coste_dietas  ?? 0) : undefined,
    coste_otros:   body.coste_otros   !== undefined ? (body.coste_otros   ?? 0) : undefined,
    coste_notas:       body.coste_notas       !== undefined ? (body.coste_notas       ?? null) : undefined,
    // Firma digital y foto de entrega
    firma_destinatario:     body.firma_destinatario     !== undefined ? (body.firma_destinatario     ?? null) : undefined,
    firma_fecha:            body.firma_fecha            !== undefined ? (body.firma_fecha            ?? null) : undefined,
    firma_nombre:           body.firma_nombre           !== undefined ? (body.firma_nombre           ?? null) : undefined,
    foto_entrega:           body.foto_entrega           !== undefined ? (body.foto_entrega           ?? null) : undefined,
    // Condiciones del encargo
    condiciones_adicionales: body.condiciones_adicionales !== undefined ? (body.condiciones_adicionales ?? null) : undefined,
    // Minimo facturable + paralizacion
    importe_minimo:         body.importe_minimo         !== undefined ? (parseLocaleNumber(body.importe_minimo) || 0) : undefined,
    minimo_unidades:        body.minimo_unidades        !== undefined ? (parseLocaleNumber(body.minimo_unidades) || 0) : undefined,
    importe_paralizacion:   body.importe_paralizacion   !== undefined ? (parseLocaleNumber(body.importe_paralizacion) || 0) : undefined,
    paralizacion_horas:     body.paralizacion_horas     !== undefined ? (parseLocaleNumber(body.paralizacion_horas) || 0) : undefined,
    puntos_carga:           body.puntos_carga           !== undefined ? JSON.stringify(mergePrimaryStopScheduleForStorage(puntosCargaNormUpdate, {
      fecha: body.fecha_carga !== undefined ? normalizePedidoDate(body.fecha_carga) : normalizePedidoDate(pedidoActualRows[0].fecha_carga),
      hora: body.hora_carga !== undefined ? normalizePedidoTime(body.hora_carga) : (pedidoActualRows[0].hora_carga || ""),
      ventana: body.ventana_carga !== undefined ? body.ventana_carga || "" : (pedidoActualRows[0].ventana_carga || ""),
    })) : undefined,
    puntos_descarga:        body.puntos_descarga        !== undefined ? JSON.stringify(mergePrimaryStopScheduleForStorage(puntosDescargaNormUpdate, {
      fecha: body.fecha_descarga !== undefined
        ? normalizePedidoDate(body.fecha_descarga)
        : (body.fecha_entrega !== undefined ? normalizePedidoDate(body.fecha_entrega) : normalizePedidoDate(pedidoActualRows[0].fecha_descarga || pedidoActualRows[0].fecha_entrega)),
      hora: body.hora_descarga !== undefined ? normalizePedidoTime(body.hora_descarga) : (pedidoActualRows[0].hora_descarga || ""),
      ventana: body.ventana_descarga !== undefined ? body.ventana_descarga || "" : (pedidoActualRows[0].ventana_descarga || ""),
    })) : undefined,
  };
  const inferPayload = { ...pedidoActualRows[0] };
  for (const [key, value] of Object.entries(fieldMap)) {
    if ((key in body) && value !== undefined) inferPayload[key] = value;
  }
  const rutaCheckId = (body.route_id !== undefined || hasPedidoTarifaCalcInput(body))
    ? (body.route_id !== undefined ? body.route_id : pedidoActualRows[0].ruta_id)
    : null;
  let rutaIncompatibleDesvinculada = false;
  let rutaIncompatibleSolicitada = null;
  if (rutaCheckId) {
    const resolvedRuta = await resolveCompatibleRutaId(db, empresaId, rutaCheckId, inferPayload);
    if (!resolvedRuta.rutaId) {
      fieldMap.ruta_id = null;
      inferPayload.ruta_id = null;
      rutaIncompatibleDesvinculada = true;
      rutaIncompatibleSolicitada = normalizePedidoUuid(rutaCheckId);
    } else if (body.route_id !== undefined) {
      fieldMap.ruta_id = resolvedRuta.rutaId;
      inferPayload.ruta_id = resolvedRuta.rutaId;
    }
  }
  const kmInferido = await inferKmRutaPedido(db, empresaId, inferPayload);
  if (kmInferido && !parseLocaleNumber(fieldMap.km_ruta)) fieldMap.km_ruta = kmInferido;
  const normalizedFieldMap = normalizePedidoTarifaFields(fieldMap);
  const colaboradorIdEfectivo = Object.prototype.hasOwnProperty.call(body, "colaborador_id")
    ? normalizedFieldMap.colaborador_id
    : pedidoActualRows[0].colaborador_id;
  let precioClienteColSincronizado = false;
  if (hasPedidoTarifaCalcInput(body)) {
    const calcBase = normalizePedidoTarifaFields(inferPayload);
    const importeCanonico = calcPedidoImporteCanonical({ ...calcBase, ...normalizedFieldMap });
    if (importeCanonico !== null) {
      normalizedFieldMap.importe = importeCanonico;
      if (colaboradorIdEfectivo) {
        normalizedFieldMap.precio_cliente_col = importeCanonico;
        precioClienteColSincronizado = true;
      }
    }
  }
  if (normalizedFieldMap.colaborador_id) normalizedFieldMap.coste_gasoil = 0;

  // Remove fields not sent in request body (undefined = not sent at all)
  const fields = Object.entries(normalizedFieldMap)
    .filter(([k]) => (
      (k in body) ||
      ((k === "tipo_iva" || k === "iva_regimen") && ivaPedido) ||
      (["origen_pais","origen_provincia","destino_pais","destino_provincia","cmr_tipo"].includes(k) && geoTouched) ||
      (k === "origen_pais" && ("pais_origen" in body)) ||
      (k === "origen_provincia" && ("provincia_origen" in body)) ||
      (k === "destino_pais" && ("pais_destino" in body)) ||
      (k === "destino_provincia" && ("provincia_destino" in body)) ||
      (k === "cmr_tipo" && ("origen_pais" in body || "destino_pais" in body || "pais_origen" in body || "pais_destino" in body)) ||
      (k === "coste_gasoil" && normalizedFieldMap.colaborador_id) ||
      (k === "importe" && hasPedidoTarifaCalcInput(body)) ||
      (k === "precio_cliente_col" && precioClienteColSincronizado) ||
      (k === "ruta_id" && rutaIncompatibleDesvinculada) ||
      (k === "km_ruta" && normalizedFieldMap.km_ruta && !body.km_ruta) ||
      (k === "cantidad" && normalizedFieldMap.cantidad !== fieldMap.cantidad) ||
      (k === "minimo_unidades" && normalizedFieldMap.minimo_unidades !== fieldMap.minimo_unidades) ||
      (String(body.estado || "").toLowerCase() === "incidencia" && [
        "incidencia_tipo",
        "incidencia_descripcion",
        "incidencia_origen",
        "incidencia_creada_por",
        "incidencia_creada_at",
        "incidencia_automatica",
      ].includes(k))
    ))
    .map(([k, v]) => [k, normalizePedidoValue(k, v)]);
  if (fields.length === 0) return res.status(400).json({ error: "No hay campos para actualizar" });

  const setClauses = fields.map(([k], i) => `${k}=$${i+1}`).join(', ');
  const values = fields.map(([, v]) => v);
  values.push(req.params.id, empresaId);

  try {
    const { rows } = await db.query(
      `UPDATE pedidos SET ${setClauses} WHERE id=$${values.length-1} AND empresa_id=$${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "Pedido no encontrado" });
    let pedidoActualizado = rows[0];
    pedidoActualizado = await limpiarPendienteCompletarSiProcede(pedidoActualizado, empresaId, req.user);
    pedidoActualizado = await confirmarPedidoPorAsignacionSiProcede(pedidoActualizado, empresaId, req.user);
    if (assignmentFieldsTouched) await sincronizarConjuntoChoferDesdePedido(db, pedidoActualizado, empresaId);
    if (assignmentFieldsTouched && pedidoAntesAsignacion) {
      const changed = ["vehiculo_id", "chofer_id", "chofer2_id", "remolque_id", "colaborador_id"].some(
        k => String(pedidoAntesAsignacion[k] || "") !== String(pedidoActualizado[k] || "")
      );
      if (changed) await registrarHistorialAsignacionPedido(db, pedidoActualizado, empresaId);
    }
    if (pedidoActualizado.estado === "descarga" && pedidoActualizado.vehiculo_id && pedidoActualizado.destino) {
      await db.query(
        "UPDATE vehiculos SET ubicacion_actual=$1, ubicacion_fuente='ultima_descarga', ubicacion_ts=NOW() WHERE id=$2 AND empresa_id=$3",
        [pedidoActualizado.destino, pedidoActualizado.vehiculo_id, empresaId]
      ).catch(e => logger.warn("No se pudo actualizar ubicacion del vehiculo:", e.message));
    }
    if ("estado" in body) {
      await logPedidoEvento(pedidoActualizado.id, empresaId, "pedido.editado_estado", {
        estado: pedidoActualizado.estado,
      }, req.user?.rol || "usuario", req.user?.id || null);
      await notificarClienteEstadoPedido(pedidoActualRows[0], pedidoActualRows[0].estado, pedidoActualizado.estado, req.user?.id || null)
        .catch(error => logger.warn("No se pudo notificar el estado al cliente:", error.message));
    }
    const cambiosPedido = summarizePedidoChanges(pedidoActualRows[0], pedidoActualizado, fields.map(([k]) => k));
    if (cambiosPedido.length) {
      await logPedidoEvento(pedidoActualizado.id, empresaId, "pedido.editado", {
        campos: cambiosPedido.map(c => c.label),
        changes: cambiosPedido,
      }, req.user?.rol || "usuario", req.user?.id || null);
    }
    await logFirmaContextoModificadoSiProcede({
      before: pedidoActualRows[0],
      after: pedidoActualizado,
      empresaId,
      actorTipo: req.user?.rol || "usuario",
      actorId: req.user?.id || null,
    });
    if (rutaIncompatibleDesvinculada) {
      await logPedidoEvento(pedidoActualizado.id, empresaId, "ruta.incompatible_desvinculada", {
        ruta_id_solicitada: rutaIncompatibleSolicitada,
        motivo: "La ruta indicada tiene una tarifa/precio/minimo incompatible con el pedido guardado.",
        tipo_precio: pedidoActualizado.tipo_precio,
        precio_unitario: pedidoActualizado.precio_unitario,
        minimo_unidades: pedidoActualizado.minimo_unidades,
      }, "sistema", null);
    }
    if (pedidoActualizado.estado === "entregado") {
      await aplicarAutomatismosEntrega(pedidoActualizado.id, empresaId, req.user?.id || null, { appBaseUrl: publicBaseUrl(req) });
    }
    if (assignmentFieldsTouched || "tipo_viaje" in body || "fecha_descarga" in body || "fecha_entrega" in body || "destino" in body || "origen" in body) {
      await notificarPlanificacionIdaRetorno(pedidoActualizado, empresaId, req.user?.id || null)
        .catch(e => logger.warn("No se pudo notificar planificacion ida-retorno:", e.message));
    }
    if (festivoAviso) {
      await notificarGerenciaPedido(
        empresaId,
        "pedido_destino_festivo",
        "Pedido enviado a zona en festivo",
        `El pedido ${pedidoActualizado.numero || pedidoActualizado.id} se ha confirmado para ${festivoAviso.ccaa_label} en festivo (${festivoAviso.festivo_nombre}).`,
        { ...festivoAviso, pedido_id: pedidoActualizado.id, pedido_numero: pedidoActualizado.numero, dedupe_key: `festivo:${pedidoActualizado.id}:${festivoAviso.fecha}:${festivoAviso.ccaa}` },
        req.user?.id || null
      );
    }
    res.json(pedidoActualizado);
  } catch(e) {
    if (e.code === '42703') {
      let updatedPedido = await updateExistingPedidoFields(db, fields, req.params.id, empresaId);
      if (!updatedPedido) return res.status(400).json({ error: "No hay campos compatibles para actualizar" });
      updatedPedido = await limpiarPendienteCompletarSiProcede(updatedPedido, empresaId, req.user);
      updatedPedido = await confirmarPedidoPorAsignacionSiProcede(updatedPedido, empresaId, req.user);
      if ("estado" in body) {
        await logPedidoEvento(updatedPedido.id, empresaId, "pedido.editado_estado", {
          estado: updatedPedido.estado,
        }, req.user?.rol || "usuario", req.user?.id || null);
        await notificarClienteEstadoPedido(pedidoActualRows[0], pedidoActualRows[0].estado, updatedPedido.estado, req.user?.id || null)
          .catch(error => logger.warn("No se pudo notificar el estado al cliente:", error.message));
      }
      const cambiosPedido = summarizePedidoChanges(pedidoActualRows[0], updatedPedido, fields.map(([k]) => k));
      if (cambiosPedido.length) {
        await logPedidoEvento(updatedPedido.id, empresaId, "pedido.editado", {
          campos: cambiosPedido.map(c => c.label),
          changes: cambiosPedido,
        }, req.user?.rol || "usuario", req.user?.id || null);
      }
      await logFirmaContextoModificadoSiProcede({
        before: pedidoActualRows[0],
        after: updatedPedido,
        empresaId,
        actorTipo: req.user?.rol || "usuario",
        actorId: req.user?.id || null,
      });
      if (updatedPedido.estado === "entregado") {
        await aplicarAutomatismosEntrega(updatedPedido.id, empresaId, req.user?.id || null, { appBaseUrl: publicBaseUrl(req) });
      }
      if (assignmentFieldsTouched || "tipo_viaje" in body || "fecha_descarga" in body || "fecha_entrega" in body || "destino" in body || "origen" in body) {
        await notificarPlanificacionIdaRetorno(updatedPedido, empresaId, req.user?.id || null)
          .catch(err => logger.warn("No se pudo notificar planificacion ida-retorno:", err.message));
      }
      if (festivoAviso) {
        await notificarGerenciaPedido(
          empresaId,
          "pedido_destino_festivo",
          "Pedido enviado a zona en festivo",
          `El pedido ${updatedPedido.numero || updatedPedido.id} se ha confirmado para ${festivoAviso.ccaa_label} en festivo (${festivoAviso.festivo_nombre}).`,
          { ...festivoAviso, pedido_id: updatedPedido.id, pedido_numero: updatedPedido.numero, dedupe_key: `festivo:${updatedPedido.id}:${festivoAviso.fecha}:${festivoAviso.ccaa}` },
          req.user?.id || null
        );
      }
      return res.json(updatedPedido);
    }
    if (e.code === "22P02") {
      return res.status(400).json({
        error: "Alguno de los importes, pesos, bultos o identificadores del pedido no tiene un formato valido.",
      });
    }
    if (e.code === "23503") {
      return res.status(400).json({
        error: "Alguna asignacion del pedido no existe o no pertenece a esta empresa. Refresca la pantalla y vuelve a seleccionar vehiculo, chofer o remolque.",
      });
    }
    res.status(500).json({ error: e.message });
  }
});

;

// GET /pedidos/chofer/:chofer_id/historial-vehiculos
router.get("/chofer/:chofer_id/historial-vehiculos", async (req, res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    const { rows } = await db.query(`
      SELECT h.*,
             p.numero AS pedido_numero, p.origen, p.destino, p.fecha_carga
      FROM chofer_vehiculo_historial h
      LEFT JOIN pedidos p ON p.id = h.pedido_id
      WHERE h.chofer_id=$1 AND h.empresa_id=$2
      ORDER BY h.fecha DESC
      LIMIT 100
    `, [req.params.chofer_id, empresaId]);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// DELETE /pedidos/:id - solo cancelados; auto-elimina factura borrador huerfana
router.delete("/:id", async (req,res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      "SELECT id, estado, numero, factura_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    if (!rows[0]) return res.status(404).json({error:"Pedido no encontrado"});
    if (rows[0].estado !== "cancelado") {
      return res.status(400).json({error:`Solo se eliminan pedidos cancelados. Estado actual: ${rows[0].estado}`});
    }
    const facturaId = rows[0].factura_id;
    await db.query("DELETE FROM pedidos WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
    // Cascade: if linked to a borrador factura with no more pedidos -> delete it
    if (facturaId) {
      const { rows: facRows } = await db.query(
        "SELECT id, estado FROM facturas WHERE id=$1 AND empresa_id=$2",
        [facturaId, empresaId]
      );
      if (facRows[0] && facRows[0].estado === "borrador") {
        const { rows: cntRows } = await db.query(
          "SELECT COUNT(*)::int AS cnt FROM factura_pedidos WHERE factura_id=$1",
          [facturaId]
        );
        if ((cntRows[0]?.cnt || 0) === 0) {
          await db.query("DELETE FROM facturas WHERE id=$1 AND empresa_id=$2", [facturaId, empresaId]);
          return res.json({ok:true, numero:rows[0].numero, factura_eliminada:true});
        }
      }
    }
    res.json({ok:true, numero: rows[0].numero});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// DELETE /pedidos/:id/factura - desvincula pedido de su factura
// Solo para corregir errores de facturacion. Requiere rol gerente.
router.delete("/:id/factura", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    // Get current pedido
    const { rows: pedRows } = await db.query(
      "SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    if (!pedRows[0]) return res.status(404).json({ error: "Pedido no encontrado" });
    const pedido = pedRows[0];
    if (!pedido.factura_id) return res.status(400).json({ error: "Este pedido no tiene factura asignada" });

    // Remove from factura_pedidos junction table
    await db.query(
      "DELETE FROM factura_pedidos WHERE pedido_id=$1 AND factura_id=$2",
      [req.params.id, pedido.factura_id]
    );

    // Clear factura_id on the pedido (facturado is a computed field, not a column)
    const { rows } = await db.query(
      "UPDATE pedidos SET factura_id=NULL WHERE id=$1 AND empresa_id=$2 RETURNING *",
      [req.params.id, empresaId]
    );

    res.json({ ok: true, pedido: rows[0], mensaje: "Pedido desvinculado de la factura correctamente" });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});



// GET /pedidos/:id/carta-porte
router.get("/:id/carta-porte", async (req, res) => {
  try {
    const empresaId = req.user && req.user.empresa_id;
    const cartaPorte = await ensurePedidoCartaPorteNumero(req.params.id, empresaId).catch((error) => {
      logger.warn("No se pudo asegurar la numeracion de carta de porte:", error.message);
      return null;
    });
    const { rows } = await db.query(`
      SELECT
        p.*,
        c.nombre       AS cliente_nombre,  c.cif          AS cliente_cif,
        c.direccion    AS cliente_dir,      c.direccion    AS cliente_direccion,
        c.ciudad       AS cliente_ciudad,
        c.pais         AS cliente_pais,     c.telefono     AS cliente_tel,
        c.telefono     AS cliente_telefono,
        c.email        AS cliente_email,
        ch.nombre      AS chofer_nombre,    ch.apellidos   AS chofer_apellidos,
        ch.dni         AS chofer_dni,       ch.telefono    AS chofer_tel,
        ch.telefono    AS chofer_telefono,
        v.matricula    AS veh_matricula,    v.marca        AS veh_marca,
        v.matricula    AS vehiculo_matricula,
        v.marca        AS vehiculo_marca,
        v.modelo       AS veh_modelo,       v.modelo       AS vehiculo_modelo,
        r2.matricula   AS rem_matricula,    r2.matricula   AS remolque_matricula
      FROM pedidos p
      LEFT JOIN clientes  c   ON c.id  = p.cliente_id
      LEFT JOIN choferes  ch  ON ch.id = p.chofer_id
      LEFT JOIN vehiculos v   ON v.id  = p.vehiculo_id
      LEFT JOIN vehiculos r2  ON r2.id = p.remolque_id
      WHERE p.id = $1 AND p.empresa_id = $2
    `, [req.params.id, empresaId]);
    if (!rows[0]) return res.status(404).json({ error: "Pedido no encontrado" });

    const { rows: empresaRows } = await db.query(
      "SELECT nombre, cif, cfg_precios FROM empresas WHERE id = $1 LIMIT 1",
      [empresaId]
    ).catch(() => ({ rows: [] }));
    const empresa = empresaRows[0] || {};
    const perfilEmpresa = empresa.cfg_precios?.empresa_perfil && typeof empresa.cfg_precios.empresa_perfil === "object"
      ? empresa.cfg_precios.empresa_perfil
      : (empresa.cfg_precios && typeof empresa.cfg_precios === "object" ? empresa.cfg_precios : {});
    const empresaDireccion = [
      perfilEmpresa.domicilio || perfilEmpresa.direccion,
      [perfilEmpresa.cp || perfilEmpresa.codigo_postal, perfilEmpresa.municipio || perfilEmpresa.ciudad || perfilEmpresa.poblacion].filter(Boolean).join(" "),
      perfilEmpresa.provincia,
      perfilEmpresa.pais,
    ].filter(Boolean).join(", ");
    const documentosAnexos = await getPedidoDocumentoControlAnexos(req.params.id, empresaId).catch(() => []);

    res.json({
      ...rows[0],
      pedido_numero: rows[0].numero || "",
      carta_porte_numero: cartaPorte?.numero || rows[0].carta_porte_numero || rows[0].numero || "",
      carta_porte_generada_at: cartaPorte?.generated_at || rows[0].carta_porte_generada_at || null,
      empresa_nombre: perfilEmpresa.razon_social || empresa.nombre || "",
      empresa_cif: perfilEmpresa.cif || empresa.cif || "",
      empresa_direccion: empresaDireccion,
      empresa_telefono: perfilEmpresa.telefono || "",
      empresa_email: perfilEmpresa.email || "",
      emp_nombre: perfilEmpresa.razon_social || empresa.nombre || "",
      emp_cif: perfilEmpresa.cif || empresa.cif || "",
      emp_dir: empresaDireccion,
      emp_tel: perfilEmpresa.telefono || "",
      emp_email: perfilEmpresa.email || "",
      emp_logo: "",
      documentos_anexos: documentosAnexos,
      albaranes_adjuntos_count: documentosAnexos.length,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /pedidos/:id/gps - guardar ultima posicion enviada por chofer
router.post("/:id/gps", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    const velocidad = Number.isFinite(Number(req.body.velocidad)) ? Number(req.body.velocidad) : null;
    const odometro = Number.isFinite(Number(req.body.odometro_km ?? req.body.km_actuales)) ? Number(req.body.odometro_km ?? req.body.km_actuales) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Coordenadas no validas" });
    }

    const { rows: pedidosRows } = await db.query(
      "SELECT id, vehiculo_id, chofer_id, chofer2_id FROM pedidos WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const pedido = pedidosRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes actualizar la posicion de este pedido" });
    }

    const posicion = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const { rows } = await db.query(
      `UPDATE pedidos
       SET ultima_posicion=$1, posicion_ts=NOW()
       WHERE id=$2 AND empresa_id=$3
       RETURNING id, ultima_posicion, posicion_ts`,
      [posicion, req.params.id, empresaId]
    );
    if (pedido.vehiculo_id) {
      await db.query(
        `UPDATE vehiculos
         SET ubicacion_actual=$1,
             ubicacion_fuente='app_chofer',
             ubicacion_ts=NOW(),
             gps_lat=$2,
             gps_lng=$3,
             km_actuales=COALESCE($4, km_actuales)
         WHERE id=$5 AND empresa_id=$6`,
        [`GPS ${posicion}`, lat, lng, odometro, pedido.vehiculo_id, empresaId]
      ).catch(e => logger.warn("No se pudo actualizar GPS del vehiculo:", e.message));
      await db.query(
        `INSERT INTO gps_position_log
          (empresa_id,vehiculo_id,provider,external_id,lat,lng,ubicacion,velocidad_kmh,odometro_km,raw,recorded_at)
         VALUES ($1,$2,'app_chofer',NULL,$3,$4,$5,$6,$7,$8::jsonb,NOW())`,
        [
          empresaId,
          pedido.vehiculo_id,
          lat,
          lng,
          `GPS ${posicion}`,
          velocidad,
          odometro,
          JSON.stringify({
            source: "pedido_gps",
            pedido_id: pedido.id,
            chofer_user_id: req.user?.id || null,
          }),
        ]
      ).catch(e => logger.warn("No se pudo registrar posicion GPS del vehiculo:", e.message));
    }
    res.json({ ok: true, ...rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /pedidos/:id/firma - guardar firma digital por rol y actualizar DCD
router.post("/:id/firma", async (req, res) => {
  try {
    const empresaId = req.user && req.user.empresa_id;
    await ensureColaboradorWorkflowSchema();
    const { firma_destinatario, firma_nombre } = req.body;
    const firmaImagen = firma_destinatario || req.body?.firma || req.body?.firma_png || req.body?.firma_data_url;
    const firmaRol = normalizeFirmaRol(req.body?.rol || req.body?.firma_rol || "destinatario");
    if (!firmaImagen) return res.status(400).json({ error: "Firma requerida" });
    const { rows: pedidoRows } = await db.query(
      `SELECT id, numero, origen, destino, fecha_carga, fecha_descarga, fecha_entrega,
              vehiculo_id, chofer_id, chofer2_id, estado::text AS estado,
              firma_evidencia
         FROM pedidos
        WHERE id=$1 AND empresa_id=$2
        LIMIT 1`,
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (!(await usuarioPuedeGestionarPedido(req, pedido))) {
      return res.status(403).json({ error: "No puedes firmar este pedido" });
    }

    const firmadoAt = new Date().toISOString();
    const firmaHash = sha256Hex(firmaImagen);
    const pedidoContext = buildFirmaPedidoContext(pedido);
    const defaultNombre = firmaRol === "chofer" ? "Chofer" : firmaRol === "cargador" ? "Cargador" : "Destinatario";
    const evidenciaBase = {
      version: "transgest-firma-evidencia-2026.05",
      estado: "evidencia_interna_pre_eidas",
      provider: "transgest_internal",
      required_level_target: "firma electronica avanzada eIDAS",
      pedido_id: pedido.id,
      pedido_numero: pedido.numero,
      ruta: { origen: pedido.origen || "", destino: pedido.destino || "" },
      fechas: {
        carga: pedido.fecha_carga || null,
        descarga: pedido.fecha_descarga || pedido.fecha_entrega || null,
      },
      pedido_context: pedidoContext,
      pedido_context_hash_sha256: sha256Hex(stableJson(pedidoContext)),
      firmante: {
        nombre: String(firma_nombre || defaultNombre).trim(),
        rol: firmaRol,
      },
      firma: {
        algoritmo_hash: "SHA-256",
        hash: firmaHash,
        formato: String(firmaImagen).startsWith("data:image/") ? "data_url_image" : "desconocido",
        data_url: String(firmaImagen).startsWith("data:image/") ? firmaImagen : "",
      },
      captura: {
        ip: req.ip || req.headers["x-forwarded-for"] || "",
        user_agent: req.get("user-agent") || "",
        actor_tipo: req.user?.rol || "usuario",
        actor_id: req.user?.id || null,
        source: req.body?.source || (req.user?.rol === "chofer" ? "app_chofer" : "pedidos"),
      },
      firmado_at: firmadoAt,
    };
    const evidencia = {
      ...evidenciaBase,
      integrity_hash_sha256: sha256Hex(stableJson(evidenciaBase)),
    };
    const evidenciaMulti = mergeFirmaEvidencia(pedido.firma_evidencia || null, firmaRol, evidencia);

    const roleSetSql = {
      cargador: "firma_cargador = $1, firma_cargador_nombre = $2, firma_cargador_fecha = $5",
      chofer: "firma_chofer = $1, firma_chofer_nombre = $2, firma_chofer_fecha = $5",
      destinatario: "firma_destinatario = $1, firma_nombre = $2, firma_fecha = $5, firma_hash = $7",
    }[firmaRol];

    const firmaParams = [
      firmaImagen,
      evidencia.firmante.nombre || defaultNombre,
      req.params.id,
      empresaId,
      firmadoAt,
      JSON.stringify(evidenciaMulti),
    ];
    if (firmaRol === "destinatario") firmaParams.push(firmaHash);

    const { rows } = await db.query(`
      UPDATE pedidos
      SET ${roleSetSql},
          firma_evidencia = $6::jsonb,
          updated_at = NOW()
      WHERE id = $3 AND empresa_id = $4
      RETURNING id, numero, firma_fecha, firma_nombre, firma_hash, firma_cargador_fecha, firma_cargador_nombre, firma_chofer_fecha, firma_chofer_nombre, firma_evidencia
    `, firmaParams);

    await logPedidoEvento(req.params.id, empresaId, `firma.${firmaRol}_registrada`, {
      firma_rol: firmaRol,
      firma_nombre: evidencia.firmante.nombre,
      firma_hash: firmaHash,
      integrity_hash_sha256: evidencia.integrity_hash_sha256,
      pedido_context_hash_sha256: evidencia.pedido_context_hash_sha256,
      estado: evidencia.estado,
      source: evidencia.captura.source,
    }, req.user?.rol || "usuario", req.user?.id || null);

    const pedidoId = req.params.id;
    const actorId = req.user?.id || null;
    const appBaseUrl = publicBaseUrl(req);
    setImmediate(() => {
      getPedidoDocumentoControlContext(pedidoId, empresaId)
        .then(ctx => ctx ? archivarDocumentoControlPedido({
          pedidoId,
          empresaId,
          appBaseUrl,
          userId: actorId,
          motivo: `firma_${firmaRol}`,
        }) : null)
        .catch(repoErr => logger.warn("No se pudo actualizar el repositorio DCD tras firma:", repoErr.message));
    });

    res.json({ ok: true, firma_rol: firmaRol, repositorio_pendiente: true, ...rows[0] });
  } catch(e) {
    logger.error("Error guardando firma de pedido:", {
      message: e.message,
      code: e.code,
      pedido_id: req.params.id,
      user_id: req.user?.id || null,
      rol: req.user?.rol || null,
    });
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code || undefined });
    if (e.code === "22001") return res.status(400).json({ error: "La firma o la evidencia generada supera el tamano permitido. Vuelve a firmar con un trazo mas simple.", code: e.code });
    if (e.code === "22P02") return res.status(400).json({ error: "Alguno de los datos de firma no tiene formato valido. Refresca el viaje y vuelve a intentarlo.", code: e.code });
    res.status(500).json({ error: e.message || "No se pudo guardar la firma del pedido" });
  }
});

router.get("/:id/firma/evidencia", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.user && req.user.empresa_id;
    const { rows } = await db.query(`
      SELECT id, numero, origen, destino, fecha_carga, fecha_descarga, fecha_entrega,
             firma_fecha, firma_nombre, firma_hash, firma_evidencia
        FROM pedidos
       WHERE id=$1 AND empresa_id=$2
       LIMIT 1
    `, [req.params.id, empresaId]);
    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const evidencia = normalizeFirmaEvidenciaForResponse(pedido.firma_evidencia || null);
    const postSignatureIntegrity = buildFirmaPostSignatureIntegrity(pedido, pedido.firma_evidencia || null);
    res.json({
      pedido_id: pedido.id,
      pedido_numero: pedido.numero,
      firmado: !!(pedido.firma_fecha || evidencia),
      firma_fecha: pedido.firma_fecha || evidencia?.firmado_at || null,
      firma_nombre: pedido.firma_nombre || evidencia?.firmante?.nombre || "",
      firma_hash: pedido.firma_hash || evidencia?.firma?.hash || "",
      evidencia,
      post_signature_integrity: postSignatureIntegrity,
      target_eidas: "firma electronica avanzada",
    });
  } catch(e) { res.status(500).json({ error: e.message || "No se pudo consultar la evidencia de firma" }); }
});

router.get("/:id/firma/evidencia/informe", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.user && req.user.empresa_id;
    const { rows } = await db.query(`
      SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.fecha_descarga, p.fecha_entrega,
             p.firma_fecha, p.firma_nombre, p.firma_hash, p.firma_evidencia,
             e.nombre AS empresa_nombre, e.cif AS empresa_cif
        FROM pedidos p
        LEFT JOIN empresas e ON e.id=p.empresa_id
       WHERE p.id=$1 AND p.empresa_id=$2
       LIMIT 1
    `, [req.params.id, empresaId]);
    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const evidencia = normalizeFirmaEvidenciaForResponse(pedido.firma_evidencia || null) || {};
    const captura = evidencia.captura || {};
    const firmante = evidencia.firmante || {};
    const firma = evidencia.firma || {};
    const firmado = !!pedido.firma_fecha;
    const postSignatureIntegrity = buildFirmaPostSignatureIntegrity(pedido, pedido.firma_evidencia || null);
    const integrityOk = !postSignatureIntegrity.changed_after_signature;
    const filename = `evidencia-firma-${String(pedido.numero || pedido.id).replace(/[^a-z0-9_-]+/gi, "-")}.html`;
    const generatedAt = new Date().toISOString();
    const row = (label, value) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value || "-")}</td></tr>`;
    const changesHtml = postSignatureIntegrity.changes.length
      ? `<ul>${postSignatureIntegrity.changes.map(change => `<li><strong>${htmlEscape(change.field)}:</strong> firmado ${htmlEscape(change.signed || "-")} / actual ${htmlEscape(change.current || "-")}</li>`).join("")}</ul>`
      : "Sin cambios sensibles detectados.";
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Evidencia firma ${htmlEscape(pedido.numero || "")}</title>
<style>
body{font-family:Arial,sans-serif;background:#f4f7fb;color:#111827;margin:0;padding:28px;font-size:13px;line-height:1.45}
.sheet{max-width:860px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:28px;box-shadow:0 16px 50px rgba(15,23,42,.10)}
.top{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:18px}
h1{font-size:24px;margin:0 0 5px;color:#0f172a}.sub{color:#64748b;font-size:12px}.badge{display:inline-block;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:800;background:${firmado ? "#dcfce7" : "#fef3c7"};color:${firmado ? "#166534" : "#92400e"};border:1px solid ${firmado ? "#86efac" : "#fcd34d"}}
.badge.warn{background:#fef3c7;color:#92400e;border-color:#fcd34d}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.box{border:1px solid #e5e7eb;background:#f8fafc;border-radius:10px;padding:12px}
.lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:800;margin-bottom:4px}.val{font-size:14px;font-weight:800;color:#111827;word-break:break-word}
table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #e5e7eb;padding:9px 10px;text-align:left;vertical-align:top}th{width:220px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.hash{font-family:'Courier New',monospace;font-size:11px;word-break:break-all}.note{margin-top:16px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:10px;padding:12px;color:#1e40af}.note.warn{border-color:#fcd34d;background:#fffbeb;color:#92400e}
@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border:none;border-radius:0}.top{break-inside:avoid}}
</style></head><body><div class="sheet">
<div class="top">
  <div><h1>Informe de evidencia de firma</h1><div class="sub">${htmlEscape(pedido.empresa_nombre || "Empresa")} ${pedido.empresa_cif ? ` &middot; ${htmlEscape(pedido.empresa_cif)}` : ""}</div></div>
  <div><span class="badge ${firmado && !integrityOk ? "warn" : ""}">${firmado ? (integrityOk ? "Firma registrada sin cambios" : "Firma con cambios posteriores") : "Sin firma registrada"}</span></div>
</div>
<div class="grid">
  <div class="box"><div class="lbl">Pedido</div><div class="val">${htmlEscape(pedido.numero || pedido.id)}</div><div class="sub">${htmlEscape(pedido.origen || "-")} -> ${htmlEscape(pedido.destino || "-")}</div></div>
  <div class="box"><div class="lbl">Integridad postfirma</div><div class="val">${integrityOk ? "Sin cambios detectados" : "Cambios detectados"}</div><div class="sub">Compara origen, destino y fechas firmadas contra el estado actual.</div></div>
</div>
<table>
  <tbody>
    ${row("Fecha firma", pedido.firma_fecha ? new Date(pedido.firma_fecha).toLocaleString("es-ES") : "")}
    ${row("Firmante", pedido.firma_nombre || firmante.nombre || "")}
    ${row("Rol firmante", firmante.rol || "destinatario")}
    ${row("Proveedor", evidencia.provider || "transgest_internal")}
    ${row("Estado evidencia", evidencia.estado || "")}
    ${row("Origen captura", captura.source || "")}
    ${row("Actor", [captura.actor_tipo, captura.actor_id].filter(Boolean).join(" / "))}
    ${row("IP captura", captura.ip || "")}
    ${row("User-Agent", captura.user_agent || "")}
    ${row("Formato firma", firma.formato || "")}
    <tr><th>Hash firma SHA-256</th><td class="hash">${htmlEscape(pedido.firma_hash || firma.hash || "")}</td></tr>
    <tr><th>Hash integridad evidencia</th><td class="hash">${htmlEscape(evidencia.integrity_hash_sha256 || "")}</td></tr>
    <tr><th>Hash contexto firmado</th><td class="hash">${htmlEscape(postSignatureIntegrity.signed_context_hash_sha256 || "")}</td></tr>
    <tr><th>Hash contexto actual</th><td class="hash">${htmlEscape(postSignatureIntegrity.current_context_hash_sha256 || "")}</td></tr>
  </tbody>
</table>
<div class="note ${integrityOk ? "" : "warn"}"><strong>Integridad postfirma:</strong> ${changesHtml}</div>
<div class="note"><strong>Nota:</strong> este informe deja constancia auditable de la captura interna. Para uso legal avanzado, conservar tambien el paquete eIDAS y la evidencia tecnica devuelta por el proveedor de firma seleccionado.</div>
<div class="sub" style="margin-top:18px">Generado: ${htmlEscape(new Date(generatedAt).toLocaleString("es-ES"))}</div>
</div></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message || "No se pudo generar el informe de evidencia de firma" }); }
});

router.startAlbaranesReminderScheduler = startAlbaranesReminderScheduler;
router.procesarRecordatoriosAlbaranesPendientes = procesarRecordatoriosAlbaranesPendientes;

module.exports = router;
