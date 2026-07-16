// ══════════════════════════════════════════════════════
// API SERVICE — Todas las llamadas al backend
// ══════════════════════════════════════════════════════

import { fixMojibakePayload } from "../utils/mojibake";

const BASE = process.env.REACT_APP_API_URL || "";

function extractRequestId(res, data = {}) {
  return (
    data?.request_id ||
    data?.requestId ||
    res?.headers?.get?.("x-request-id") ||
    res?.headers?.get?.("x-correlation-id") ||
    null
  );
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function rememberApiError(entry) {
  if (typeof window === "undefined") return;
  const item = {
    ts: new Date().toISOString(),
    status: entry.status || 0,
    method: entry.method || "GET",
    path: entry.path || "",
    request_id: entry.request_id || null,
    error: entry.error || null,
    message: entry.message || null,
  };
  window.__TMS_LAST_API_ERROR = item;
  try {
    const previous = JSON.parse(localStorage.getItem("tms_api_errors") || "[]");
    const next = [item, ...(Array.isArray(previous) ? previous : [])].slice(0, 20);
    localStorage.setItem("tms_api_errors", JSON.stringify(next));
  } catch {}
}

async function parseApiResponse(res) {
  const contentType = String(res?.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return fixMojibakePayload(await res.json().catch(() => ({})));
  }
  const text = compactText(await res.text().catch(() => ""));
  return text ? { raw_text: text } : {};
}

function friendlyApiError(message, status, requestId, path = "") {
  const raw = String(message || "").trim();
  const lower = raw.toLowerCase();
  const moduloLabel =
    path.includes("/pedidos") ? "el pedido" :
    path.includes("/facturas") ? "la factura" :
    path.includes("/vehiculos") ? "el vehiculo" :
    path.includes("/choferes") ? "el chofer" :
    path.includes("/clientes") ? "el cliente" :
    path.includes("/rutas") ? "la ruta" :
    path.includes("/taller") ? "la intervencion" :
    "la operacion";

  if (!raw || lower === "failed to fetch" || lower.includes("networkerror")) {
    return "No se pudo conectar con el servidor. Comprueba que el backend esta arrancado y vuelve a intentarlo.";
  }
  if (lower.includes("tardado demasiado") || lower.includes("abort")) {
    return "El servidor ha tardado demasiado en responder. Vuelve a intentarlo y, si se repite, revisa el estado de la API.";
  }
  if (lower.includes("load failed") || lower.includes("fetch failed") || lower.includes("network request failed")) {
    return "La conexion con el servidor se ha cortado. Revisa que el backend siga activo y vuelve a intentarlo.";
  }
  if (lower.includes("invalid input syntax for type numeric")) {
    return "Hay un campo numerico vacio o mal formado. Revisa importes, kilometros, peso y cantidades.";
  }
  if (lower.includes("invalid input syntax for type date") || lower.includes("date/time field value out of range")) {
    return "Hay una fecha u hora con formato no valido. Revisa carga, descarga y ventanas horarias.";
  }
  if (lower.includes("duplicate key value")) {
    return "Ya existe un registro con esos datos.";
  }
  if (lower.includes("violates foreign key constraint")) {
    return "No se puede guardar porque falta o no coincide un dato relacionado.";
  }
  if (lower.includes("violates not-null constraint")) {
    return "Falta un dato obligatorio para completar la operacion.";
  }
  if (lower.includes("jwt") || (lower.includes("token") && lower.includes("expired"))) {
    return "Tu sesion ha caducado. Vuelve a iniciar sesion.";
  }
  if (status === 401 && path.startsWith("/auth/login")) return "Credenciales incorrectas";
  if (status === 403) return "No tienes permisos para realizar esta accion.";
  if (status === 404) return "No se encontro el registro solicitado.";
  if (status === 409) return raw || "No se pudo guardar porque hay un conflicto con datos ya existentes.";
  if (status === 422) return raw || "Hay datos del formulario que no son validos.";
  if (status >= 500) {
    return requestId
      ? `No se pudo completar ${moduloLabel}. Codigo de seguimiento: ${requestId}.`
      : `No se pudo completar ${moduloLabel} por un problema interno del servidor.`;
  }
  return raw;
}

function notifyError(message, status) {
  if (typeof window === "undefined") return;
  if (status === 401 || status === 402) return;
  window.dispatchEvent(new CustomEvent("tms:notify", {
    detail: { type:"error", message },
  }));
}

function notifySuccess(message) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tms:notify", {
    detail: { type:"success", message },
  }));
}

// ── Token management ──────────────────────────────────
export function getToken() {
  if (typeof window !== "undefined" && typeof window.__TMS_TOKEN === "string") return window.__TMS_TOKEN;
  return localStorage.getItem("tms_token");
}
export function setToken(t) {
  if (typeof window !== "undefined") window.__TMS_TOKEN = t || "";
  localStorage.setItem("tms_token", t);
}
export function removeToken() {
  if (typeof window !== "undefined") {
    window.__TMS_TOKEN = "";
    window.__TMS_USER = null;
  }
  localStorage.removeItem("tms_token");
  localStorage.removeItem("tms_user");
}
export function getUser() {
  if (typeof window !== "undefined" && window.__TMS_USER && typeof window.__TMS_USER === "object") return window.__TMS_USER;
  try { return JSON.parse(localStorage.getItem("tms_user")); } catch { return null; }
}
export function setUser(u) {
  if (typeof window !== "undefined") window.__TMS_USER = u || null;
  localStorage.setItem("tms_user", JSON.stringify(u));
}

function applyAuthSession(data = {}) {
  if (data.token) setToken(data.token);
  if (data.user) setUser(data.user);
  return data;
}

// ── Fetch base ────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const { silentSuccess = false, silentError = false, timeoutMs, ...fetchOptions } = options;
  const token = getToken();
  const method = String(fetchOptions.method || "GET").toUpperCase();
  const effectiveTimeoutMs = Number(timeoutMs ?? (method === "GET" ? 45000 : 30000));
  const timeoutController = typeof AbortController !== "undefined" && effectiveTimeoutMs > 0 && !fetchOptions.signal
    ? new AbortController()
    : null;
  const timeoutId = timeoutController
    ? setTimeout(() => timeoutController.abort(), effectiveTimeoutMs)
    : null;
  let res;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      ...fetchOptions,
      signal: timeoutController ? timeoutController.signal : fetchOptions.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(fetchOptions.headers || {}),
      },
      body: fetchOptions.body ? JSON.stringify(fetchOptions.body) : undefined,
    });
  } catch (e) {
    const rawMessage = e?.name === "AbortError"
      ? `La peticion ha tardado demasiado (${effectiveTimeoutMs} ms).`
      : e.message;
    const message = friendlyApiError(rawMessage, 0, null, path);
    rememberApiError({ status: 0, method, path, request_id: null, error: rawMessage || null, message });
    const isTimeout = e?.name === "AbortError" || String(rawMessage || "").toLowerCase().includes("tardado demasiado");
    const shouldNotify = !silentError && (method !== "GET" || !isTimeout);
    if (shouldNotify) notifyError(message);
    throw new Error(message);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  // Token expirado → logout
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    removeToken();
    window.location.href = "/";
    return;
  }

  // Suscripción bloqueada → guardar motivo y redirigir
  if (res.status === 402) {
    const data = fixMojibakePayload(await res.json().catch(() => ({})));
    const bloqueado = {
      motivo:  data.motivo  || "vencido",
      mensaje: data.mensaje || "Tu suscripción ha vencido.",
    };
    if (typeof window !== "undefined") window.__TMS_BLOQUEADO = bloqueado;
    localStorage.setItem("tms_bloqueado", JSON.stringify(bloqueado));
    window.dispatchEvent(new CustomEvent("tms:bloqueado", { detail: data }));
    throw new Error("suscripcion_bloqueada");
  }

  const data = await parseApiResponse(res);
  if (!res.ok) {
    const validationMsg = Array.isArray(data.errors) && data.errors[0]?.msg;
    const fallbackText = data.raw_text || "";
    const requestId = extractRequestId(res, data);
    const message = friendlyApiError(
      data.error || data.message || data.mensaje || validationMsg || fallbackText || `Error ${res.status}`,
      res.status,
      requestId,
      path
    );
    rememberApiError({
      status: res.status,
      method,
      path,
      request_id: requestId,
      error: data.error || data.message || data.mensaje || validationMsg || data.raw_text || null,
      message,
    });
    const autoNotify = method !== "GET" || res.status < 500;
    if (!data.requiere_confirmacion && !silentError && autoNotify) notifyError(message, res.status);
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    err.request_id = requestId;
    throw err;
  }
  if (!silentSuccess && ["POST","PUT","PATCH","DELETE"].includes(method) && !path.startsWith("/auth/")) {
    const msg = method === "DELETE" ? "Eliminado correctamente." : "Cambios guardados correctamente.";
    notifySuccess(data?.message || data?.mensaje || msg);
  }
  return data;
}

// ── Auth ──────────────────────────────────────────────
function apiUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/api/v1/")) return `${BASE}${value}`;
  return `${BASE}/api/v1${value.startsWith("/") ? value : `/${value}`}`;
}

function filenameFromDisposition(disposition) {
  const text = String(disposition || "");
  const utf8 = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1].replace(/"/g, "")); } catch {}
  }
  const simple = text.match(/filename="?([^";]+)"?/i);
  return simple?.[1] || "";
}

export async function descargarArchivoProtegido(path, fallbackName = "documento") {
  const token = getToken();
  let res;
  try {
    res = await fetch(apiUrl(path), {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (e) {
    const message = friendlyApiError(e.message, 0, null, path);
    notifyError(message);
    throw new Error(message);
  }

  if (res.status === 401) {
    removeToken();
    window.location.href = "/";
    return null;
  }

  if (!res.ok) {
    const data = await parseApiResponse(res);
    const requestId = extractRequestId(res, data);
    const message = friendlyApiError(
      data.error || data.message || data.mensaje || data.raw_text || `Error ${res.status}`,
      res.status,
      requestId,
      path
    );
    rememberApiError({ status: res.status, path, request_id: requestId, error: data.error || data.message || data.mensaje || data.raw_text || null });
    notifyError(message, res.status);
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    err.request_id = requestId;
    throw err;
  }

  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("content-disposition")) || fallbackName || "documento";
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return { filename, size: blob.size };
}

export async function verArchivoProtegido(path, fallbackName = "documento") {
  const token = getToken();
  let res;
  try {
    res = await fetch(apiUrl(path), {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (e) {
    const message = friendlyApiError(e.message, 0, null, path);
    notifyError(message);
    throw new Error(message);
  }

  if (res.status === 401) {
    removeToken();
    window.location.href = "/";
    return null;
  }

  if (!res.ok) {
    const data = await parseApiResponse(res);
    const requestId = extractRequestId(res, data);
    const message = friendlyApiError(
      data.error || data.message || data.mensaje || data.raw_text || `Error ${res.status}`,
      res.status,
      requestId,
      path
    );
    rememberApiError({ status: res.status, path, request_id: requestId, error: data.error || data.message || data.mensaje || data.raw_text || null });
    notifyError(message, res.status);
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    err.request_id = requestId;
    throw err;
  }

  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("content-disposition")) || fallbackName || "documento";
  const objectUrl = URL.createObjectURL(blob);
  const opened = window.open(objectUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  return { filename, size: blob.size };
}

export async function login(email, password) {
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  applyAuthSession(data);
  if (data.bloqueado) {
    if (typeof window !== "undefined") window.__TMS_BLOQUEADO = data.bloqueado;
    localStorage.setItem("tms_bloqueado", JSON.stringify(data.bloqueado));
    window.dispatchEvent(new CustomEvent("tms:bloqueado", { detail: data.bloqueado }));
  } else {
    if (typeof window !== "undefined") window.__TMS_BLOQUEADO = null;
    localStorage.removeItem("tms_bloqueado");
  }
  if (data.suscripcion) {
    if (typeof window !== "undefined") window.__TMS_SUSCRIPCION = data.suscripcion;
    localStorage.setItem("tms_suscripcion", JSON.stringify(data.suscripcion));
  } else {
    if (typeof window !== "undefined") window.__TMS_SUSCRIPCION = null;
    localStorage.removeItem("tms_suscripcion");
  }
  return data;
}

export async function getMe() {
  return apiFetch("/auth/me");
}

export const getDemoOptions = () => apiFetch("/auth/demo/options", { silentSuccess:true });
export const switchDemoPlan = (plan) => apiFetch("/auth/demo/switch-plan", { method:"POST", body:{ plan }, silentSuccess:true }).then(applyAuthSession);
export const switchDemoUser = (user_id) => apiFetch("/auth/demo/switch-user", { method:"POST", body:{ user_id }, silentSuccess:true }).then(applyAuthSession);
export const requestPasswordReset = (identifier) => apiFetch("/auth/forgot-password", { method:"POST", body:{ identifier }, silentSuccess:true });

export async function getAccountingLaunch() {
  return apiFetch("/accounting/launch-token", { silentSuccess: true });
}

export async function cambiarPassword(password_actual, password_nuevo) {
  return apiFetch("/auth/cambiar-password", {
    method: "POST",
    body: { password_actual, password_nuevo },
  });
}

// ── Clientes ──────────────────────────────────────────
export const getClientes  = (q = "", activo = "true", page = 1, limit = 100, options = {}) => apiFetch(`/clientes?q=${encodeURIComponent(q)}&activo=${activo}&page=${page}&limit=${limit}`, options);
export const getCliente   = (id)      => apiFetch(`/clientes/${id}`);
export const getClienteRiesgoOperativo = (id, options = {}) => apiFetch(`/clientes/${id}/riesgo-operativo`, options);
export const crearCliente = (data)    => apiFetch("/clientes", { method:"POST", body:data, timeoutMs:30000, silentSuccess:true });
export const editarCliente= (id,data) => apiFetch(`/clientes/${id}`, { method:"PUT", body:data, timeoutMs:30000, silentSuccess:true });
export const borrarCliente= (id)      => apiFetch(`/clientes/${id}`, { method:"DELETE" });
export const crearPortalUsuarioCliente = (id, data={}) => apiFetch(`/clientes/${id}/portal-user`, { method:"POST", body:data });
export const getClienteIntegracionTokens = (id) => apiFetch(`/clientes/${id}/integracion-tokens`);
export const crearClienteIntegracionToken = (id, data={}) => apiFetch(`/clientes/${id}/integracion-token`, { method:"POST", body:data });
export const revocarClienteIntegracionToken = (id, tokenId) => apiFetch(`/clientes/${id}/integracion-tokens/${encodeURIComponent(tokenId)}`, { method:"DELETE" });

// ── Pedidos ───────────────────────────────────────────
export const getPedidos     = (params={}, options = {}) => apiFetch(`/pedidos?${new URLSearchParams(params)}`, options);
export async function getPedidosResumenLista(params = {}, options = {}) {
  try {
    return await apiFetch(`/pedidos/resumen-lista?${new URLSearchParams(params)}`, options);
  } catch (error) {
    if (error?.status === 404) {
      return getPedidos(params, options);
    }
    throw error;
  }
}
export const getPedido      = (id)        => apiFetch(`/pedidos/${id}`);
export const getPedidoIdaRetorno = (id)   => apiFetch(`/pedidos/${id}/ida-retorno`);
export const enlazarPedidoRetorno = (id, data) => apiFetch(`/pedidos/${id}/ida-retorno`, { method:"POST", body:data });
export const desvincularPedidoRetorno = (id) => apiFetch(`/pedidos/${id}/ida-retorno`, { method:"DELETE" });
export const getPedidoRentabilidadPredictiva = (id) => apiFetch(`/pedidos/${id}/rentabilidad-predictiva`);
export const getPedidoDocumentoControl = (id) => apiFetch(`/pedidos/${id}/documento-control-digital`);
export const generarPedidoDocumentoControl = (id) => apiFetch(`/pedidos/${id}/documento-control-digital/generar`, { method:"POST", body:{}, silentSuccess:true });
export const getPedidoDocumentoControlExport = (id) => apiFetch(`/pedidos/${id}/documento-control-digital/export`);
export const getPedidoDocumentoControlFirmaPaquete = (id) => apiFetch(`/pedidos/${id}/documento-control-digital/firma-paquete`);
export const getPedidoRegulatoryCoreExport = (id, params = {}) =>
  apiFetch(`/pedidos/${id}/regulatory-core/export?${new URLSearchParams(params)}`, { silentSuccess:true });
export async function descargarPedidoRegulatoryDossierPdf(id) {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1/pedidos/${encodeURIComponent(id)}/regulatory-core/dossier.pdf`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const data = await parseApiResponse(res).catch(() => ({}));
    throw new Error(data.error || data.message || data.raw_text || "No se pudo descargar el dossier regulatorio.");
  }
  const disposition = res.headers.get("content-disposition") || "";
  const filename = filenameFromDisposition(disposition) || `transgest-dossier-regulatorio-${id}.pdf`;
  return { blob: await res.blob(), filename };
}
export const getPedidoRegulatoryPayload = (id, type) =>
  apiFetch(`/pedidos/${id}/regulatory-core/payload/${encodeURIComponent(type)}`, { silentSuccess:true });
export const crearPedidoRegulatoryTransmissionDraft = (id, data = {}) =>
  apiFetch(`/pedidos/${id}/regulatory-core/transmission-draft`, { method:"POST", body:data, silentSuccess:true });
export const getDocumentoControlRepositorio = (params = {}) => apiFetch(`/pedidos/documento-control-repositorio?${new URLSearchParams(params)}`);
export const getDocumentoControlRepositorioDetalle = (id) => apiFetch(`/pedidos/documento-control-repositorio/${encodeURIComponent(id)}`);
export const registrarPedidoDocumentoControlEvento = (id, data={}) =>
  apiFetch(`/pedidos/${id}/documento-control-digital/evento`, { method:"POST", body:data, silentSuccess:true });
export const getPedidoEventos = (id)      => apiFetch(`/pedidos/${id}/eventos`);
export const getPedidoChoferPasos = (id)  => apiFetch(`/pedidos/${id}/chofer-pasos`);
export const getPedidoColaboradorPago = (id) => apiFetch(`/pedidos/${id}/colaborador-pago`);
export const guardarPedidoChoferPasos = (id, data) =>
  apiFetch(`/pedidos/${id}/chofer-pasos`, { method:"PATCH", body:data, silentSuccess:true });
export const guardarPedidoColaboradorPago = (id, data) =>
  apiFetch(`/pedidos/${id}/colaborador-pago`, { method:"PUT", body:data, silentSuccess:true });
export const interpretarPedidoIA = (data) =>
  apiFetch("/pedidos/ai-inbox/parse", { method:"POST", body:data, silentSuccess:true });
export const getAiInboxRuns = (limit = 30) =>
  apiFetch(`/pedidos/ai-inbox/runs?limit=${encodeURIComponent(limit)}`, { silentSuccess:true });
export const getAiInboxStatus = () =>
  apiFetch("/pedidos/ai-inbox/status", { silentSuccess:true });
export const getPlanificacionCargaIA = (id) =>
  apiFetch(`/pedidos/${id}/planificacion-ia`, { silentSuccess:true });
export const crearPedido    = (data)      => apiFetch("/pedidos", { method:"POST", body:data, timeoutMs:60000 });
export const crearPedidoChofer = (data)   => apiFetch("/pedidos/chofer", { method:"POST", body:data, timeoutMs:60000 });
export const getChoferClientes = (q = "") => apiFetch(`/pedidos/chofer/clientes${q ? `?q=${encodeURIComponent(q)}` : ""}`);
export const getChoferClientePuntosCarga = (clienteId) => apiFetch(`/pedidos/chofer/clientes/${encodeURIComponent(clienteId)}/puntos-carga`);
export const crearChoferClientePuntoCarga = (clienteId, data) => apiFetch(`/pedidos/chofer/clientes/${encodeURIComponent(clienteId)}/puntos-carga`, { method:"POST", body:data });
export const getChoferClienteRutas = (clienteId) => apiFetch(`/pedidos/chofer/clientes/${encodeURIComponent(clienteId)}/rutas`);
export const crearChoferRuta = (data) => apiFetch("/pedidos/chofer/rutas", { method:"POST", body:data });
export const editarPedido   = (id,data)   => apiFetch(`/pedidos/${id}`, { method:"PUT", body:data });
export const cambiarEstadoPedido = (id, estado, extra = {}) =>
  apiFetch(`/pedidos/${id}/estado`, { method:"PATCH", body:{ estado, ...extra } });
export const enviarWorkflowColaborador = (id, force = false) =>
  apiFetch(`/pedidos/${id}/colaborador/notificar`, { method:"POST", body:{ force } });
export const getWorkflowColaboradorPreview = (id) =>
  apiFetch(`/pedidos/${id}/colaborador/preview`, { silentSuccess:true });

// ── Optimizacion de rutas ─────────────────────────────
export const getRouteProviders = () => apiFetch("/route-optimizer/providers");
export const optimizarRuta = (data) => apiFetch("/route-optimizer/optimize", { method:"POST", body:data, timeoutMs:60000 });
export const getRutaOptimizadaPedido = (pedidoId) => apiFetch(`/route-optimizer/pedido/${pedidoId}/latest`);
export const getRutaEnviosPedido = (pedidoId) => apiFetch(`/route-optimizer/pedido/${pedidoId}/dispatches`);
export const enviarRutaOptimizada = (pedidoId, data) => apiFetch(`/route-optimizer/pedido/${pedidoId}/send`, { method:"POST", body:data });
export const resolveGeoPlace = (params = {}) =>
  apiFetch(`/geocoding/resolve?${new URLSearchParams(params)}`, { silentSuccess:true, silentError:true, timeoutMs:12000 });
export const avisarClientePedido = (id, data = {}) => apiFetch(`/pedidos/${id}/avisar-cliente`, { method:"POST", body:data });
export const getWhatsappStatus = () => apiFetch("/whatsapp/status", { silentSuccess:true });
export const getWhatsappConfig = () => apiFetch("/whatsapp/config", { silentSuccess:true });
export const guardarWhatsappConfig = (data) => apiFetch("/whatsapp/config", { method:"PUT", body:data });
export const getWhatsappLog = () => apiFetch("/whatsapp/log", { silentSuccess:true });
export const getPedidoWhatsappPreflight = (id, target = "cliente") =>
  apiFetch(`/whatsapp/pedido/${id}/preflight?target=${encodeURIComponent(target)}`, { silentSuccess:true });
export const enviarPedidoWhatsapp = (id, data = {}) =>
  apiFetch(`/whatsapp/pedido/${id}`, { method:"POST", body:data, silentSuccess:true });
export const notificarPedidoChoferApp = (id, data = {}) =>
  apiFetch(`/pedidos/${id}/notificar-chofer-app`, { method:"POST", body:data });
export const getPlanDiario = (params = {}) =>
  apiFetch(`/plan-diario?${new URLSearchParams(params)}`, { silentSuccess:true });
export const guardarPlanDiarioNota = (data) =>
  apiFetch("/plan-diario/notas", { method:"PUT", body:data, silentSuccess:true });
export const guardarPlanDiarioOrden = (data) =>
  apiFetch("/plan-diario/orden", { method:"PUT", body:data, silentSuccess:true });

// ── Facturas ──────────────────────────────────────────
export const getFacturas    = (params={}) => apiFetch(`/facturas?${new URLSearchParams(params)}`);
export const getFactura     = (id)        => apiFetch(`/facturas/${id}`);
export const getFacturaFiscal = (id)      => apiFetch(`/facturas/${id}/fiscal`);
export const reencolarFacturaFiscal = (id) => apiFetch(`/facturas/${id}/fiscal/requeue`, { method:"POST", body:{} });
export const sincronizarFacturaFiscal = (id) => apiFetch(`/facturas/${id}/fiscal/sincronizar`, { method:"POST", body:{} });
export const facturaFiscalXmlUrl = (id) => `${BASE}/api/v1/facturas/${encodeURIComponent(id)}/fiscal/xml`;
export const facturasFiscalLoteXmlUrl = (params={}) => `${BASE}/api/v1/facturas/fiscal/export-lote.xml?${new URLSearchParams(params)}`;
export const getControlCobros = ()        => apiFetch("/facturas/control-cobros");
export const getBloqueosDocumentalesCobro = () => apiFetch("/facturas/bloqueos-documentales");
export const getControlCobrosConfig = ()  => apiFetch("/facturas/control-cobros/config");
export const guardarControlCobrosConfig = (data) => apiFetch("/facturas/control-cobros/config", { method:"PUT", body:data });
export const getPuestaMarchaComercial = () => apiFetch("/empresa/puesta-marcha");
export const getJornadaDiariaOperativa = () => apiFetch("/empresa/jornada-diaria");
export const solicitarBackupEmpresa = (data={}) => apiFetch("/backup/solicitudes", { method:"POST", body:data });
export async function descargarPuestaMarchaInforme() {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1/empresa/puesta-marcha/informe`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await parseApiResponse(res).catch(() => ({}));
    throw new Error(data.error || data.message || data.raw_text || "No se pudo descargar el informe de puesta en marcha.");
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return {
    blob: await res.blob(),
    filename: match?.[1] || `puesta-marcha-${new Date().toISOString().slice(0,10)}.html`,
  };
}
export async function descargarJornadaDiariaInforme() {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1/empresa/jornada-diaria/informe`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await parseApiResponse(res).catch(() => ({}));
    throw new Error(data.error || data.message || data.raw_text || "No se pudo descargar el informe de jornada diaria.");
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return {
    blob: await res.blob(),
    filename: match?.[1] || `jornada-diaria-${new Date().toISOString().slice(0,10)}.html`,
  };
}
export const getFacturacionFiscalResumen = () => apiFetch("/facturas/fiscal/resumen");
export const procesarColaFiscalFacturas = (data={}) => apiFetch("/facturas/fiscal/procesar-cola", { method:"POST", body:data });
export const crearFactura   = (data)      => apiFetch("/facturas", { method:"POST", body:data });
export const procesarReclamacionesFacturas = (data={}) => apiFetch("/facturas/reclamaciones/procesar", { method:"POST", body:data });
export const cambiarEstadoFactura = (id, estado, motivo) =>
  apiFetch(`/facturas/${id}/estado`, { method:"PATCH", body:{ estado, motivo } });
export const borrarFactura  = (id)        => apiFetch(`/facturas/${id}`, { method:"DELETE" });

// ── Rutas ─────────────────────────────────────────────
export const getChoferHistorialVehiculos = (cid) => apiFetch(`/pedidos/chofer/${cid}/historial-vehiculos`);
export const getRutas       = (options = {}) => apiFetch("/rutas", options);
export const getRutaPrecios   = (id)        => apiFetch(`/rutas/${id}/precios`);
export const editarRutaPrecios= (id,data)    => apiFetch(`/rutas/${id}/precios`, { method:"PUT", body:data });
export const crearRuta      = (data)      => apiFetch("/rutas", { method:"POST", body:data });
export const importarRutas  = (data)      => apiFetch("/rutas/importar", { method:"POST", body:data });
export const editarRuta     = (id,data)   => apiFetch(`/rutas/${id}`, { method:"PUT", body:data });
export const borrarRuta     = (id)        => apiFetch(`/rutas/${id}`, { method:"DELETE" });

// ── Vehículos ─────────────────────────────────────────
export const getVehiculos   = ()          => apiFetch("/vehiculos");
export const getVehiculoEventos = (id)    => apiFetch(`/vehiculos/${id}/eventos`);
export const crearVehiculo  = (data)      => apiFetch("/vehiculos", { method:"POST", body:data });
export const asignarRemolque     = (id, remolque_id, data = {}) => apiFetch(`/vehiculos/${id}/remolque`, { method:"PATCH", body:{ remolque_id, ...data } });
export const eliminarVehiculo    = (id, data={}) => apiFetch(`/vehiculos/${id}`, { method:"DELETE", body:data });
export const reactivarVehiculo   = (id)        => apiFetch(`/vehiculos/${id}/reactivar`, { method:"PATCH" });
export const editarVehiculo = (id,data)   => apiFetch(`/vehiculos/${id}`, { method:"PUT", body:data });
export const cambiarEstadoVehiculo = (id, estado) =>
  apiFetch(`/vehiculos/${id}/estado`, { method:"PATCH", body:{ estado } });
export const getGpsProviders = () => apiFetch("/vehiculos/gps/providers");
export const getGpsStatus = () => apiFetch("/vehiculos/gps/status");
export const vincularGpsVehiculo = (id, data) => apiFetch(`/vehiculos/${id}/gps-link`, { method:"PATCH", body:data });
export const vincularGpsVehiculosBulk = (links) => apiFetch("/vehiculos/gps-links", { method:"PATCH", body:{ links } });
export const actualizarPosicionVehiculo = (id, data) => apiFetch(`/vehiculos/${id}/posicion`, { method:"PATCH", body:data });
export const getPosicionesVehiculo = (id) => apiFetch(`/vehiculos/${id}/posiciones`);
export const sincronizarPosicionesVehiculo = (id, data = {}) => apiFetch(`/vehiculos/${id}/posiciones/sync`, { method:"POST", body:data });
export const sincronizarGpsVehiculos = (provider) => apiFetch("/vehiculos/gps/sync", { method:"POST", body:{ provider } });

// ── Choferes ──────────────────────────────────────────
export const getChoferes    = (activo = "true") => apiFetch(`/choferes?activo=${encodeURIComponent(activo)}`);
export const crearChofer    = (data)      => apiFetch("/choferes", { method:"POST", body:data });
export const editarChofer   = (id,data)   => apiFetch(`/choferes/${id}`, { method:"PUT", body:data });
export const borrarChofer   = (id)        => apiFetch(`/choferes/${id}`, { method:"DELETE" });
export const getChoferJornadaApp = () => apiFetch("/choferes/app/jornada");
export const getChoferConjuntoApp = () => apiFetch("/choferes/app/conjunto");
export const cambiarChoferConjuntoApp = (data) => apiFetch("/choferes/app/conjunto", { method:"POST", body:data, silentSuccess:true });
export const guardarChoferFirmaBaseApp = (data) => apiFetch("/choferes/app/firma-base", { method:"POST", body:data, silentSuccess:true });
export const iniciarChoferJornada = (data) => apiFetch("/choferes/app/jornada/iniciar", { method:"POST", body:data, silentSuccess:true });
export const cambiarChoferJornadaActividad = (data) => apiFetch("/choferes/app/jornada/actividad", { method:"POST", body:data, silentSuccess:true });
export const cerrarChoferJornada = (data) => apiFetch("/choferes/app/jornada/cerrar", { method:"POST", body:data, silentSuccess:true });
export const getChoferVacaciones = (estado = "todas") => apiFetch(`/choferes/vacaciones?estado=${encodeURIComponent(estado)}`, { silentSuccess:true });
export const resolverChoferVacaciones = (id, data) => apiFetch(`/choferes/vacaciones/${id}/resolver`, { method:"POST", body:data });
export const adjudicarChoferVacaciones = (data) => apiFetch("/choferes/vacaciones/adjudicar", { method:"POST", body:data });
export const getChoferVacacionesApp = () => apiFetch("/choferes/app/vacaciones", { silentSuccess:true });
export const solicitarChoferVacacionesApp = (data) => apiFetch("/choferes/app/vacaciones", { method:"POST", body:data });
export const firmarChoferVacacionesApp = (id, data) => apiFetch(`/choferes/app/vacaciones/${id}/firma-aceptacion`, { method:"POST", body:data });

// ── Colaboradores ─────────────────────────────────────
export const getColaboradorVehiculos  = (cid)       => apiFetch(`/colaboradores/${cid}/vehiculos`);
export const crearColaboradorVehiculo = (cid,data)  => apiFetch(`/colaboradores/${cid}/vehiculos`,{method:"POST",body:data});
export const editarColaboradorVehiculo= (cid,vid,d) => apiFetch(`/colaboradores/${cid}/vehiculos/${vid}`,{method:"PUT",body:d});
export const borrarColaboradorVehiculo= (cid,vid)   => apiFetch(`/colaboradores/${cid}/vehiculos/${vid}`,{method:"DELETE"});
export const getColaboradores = ()        => apiFetch("/colaboradores");
export const crearColaborador = (data)    => apiFetch("/colaboradores", { method:"POST", body:data });
export const editarColaborador= (id,data) => apiFetch(`/colaboradores/${id}`, { method:"PUT", body:data });
export const borrarColaborador= (id)      => apiFetch(`/colaboradores/${id}`, { method:"DELETE" });
export const crearColaboradorLiquidacionToken = (id, data={}) => apiFetch(`/colaboradores/${id}/liquidacion-token`, { method:"POST", body:data });
export const enviarColaboradorLiquidacionEmail = (id, data={}) => apiFetch(`/colaboradores/${id}/liquidacion-email`, { method:"POST", body:data });
export const getColaboradorLiquidacionTokens = (id) => apiFetch(`/colaboradores/${id}/liquidacion-tokens`);
export const revocarColaboradorLiquidacionToken = (id, tokenId) => apiFetch(`/colaboradores/${id}/liquidacion-tokens/${tokenId}`, { method:"DELETE" });
export const revisarAlertasLiquidacionesColaboradores = () => apiFetch("/colaboradores/liquidaciones/revisar-alertas", { method:"POST", body:{} });
export const getColaboradorHistorial = (id, params={}) => apiFetch(`/colaboradores/${id}/historial?${new URLSearchParams(params)}`);
export const getColaboradorAccionesPendientes = (id, params={}) => apiFetch(`/colaboradores/${id}/acciones-pendientes?${new URLSearchParams(params)}`);
export async function descargarColaboradorInformeAcciones(id, params={}) {
  const token = getToken();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/api/v1/colaboradores/${encodeURIComponent(id)}/informe-acciones${qs ? `?${qs}` : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `No se pudo descargar el informe (${res.status})`);
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return {
    blob: await res.blob(),
    filename: match?.[1] || `acciones-proveedor-${new Date().toISOString().slice(0,10)}.html`,
  };
}
export const getColaboradorFacturas = (id, params={}) => apiFetch(`/colaboradores/${id}/facturas?${new URLSearchParams(params)}`);
export const crearColaboradorFactura = (id, data) => apiFetch(`/colaboradores/${id}/facturas`, { method:"POST", body:data });
export const editarColaboradorFactura = (id, facturaId, data) => apiFetch(`/colaboradores/${id}/facturas/${facturaId}`, { method:"PUT", body:data });
export const borrarColaboradorFactura = (id, facturaId) => apiFetch(`/colaboradores/${id}/facturas/${facturaId}`, { method:"DELETE" });
export const getColaboradorPagos = (id) => apiFetch(`/colaboradores/${id}/pagos`);
export const crearColaboradorPago = (id, data) => apiFetch(`/colaboradores/${id}/pagos`, { method:"POST", body:data });
export const borrarColaboradorPago = (id, pagoId) => apiFetch(`/colaboradores/${id}/pagos/${pagoId}`, { method:"DELETE" });
export const getColaboradorDocumentos = (id) => apiFetch(`/colaboradores/${id}/documentos`);
export const crearColaboradorDocumento = (id, data) => apiFetch(`/colaboradores/${id}/documentos`, { method:"POST", body:data });
export const borrarColaboradorDocumento = (id, docId) => apiFetch(`/colaboradores/${id}/documentos/${docId}`, { method:"DELETE" });

// ── Documentos ────────────────────────────────────────
export const getDocsProximosVencer = ()   => apiFetch("/docs/proximos-vencer", { silentSuccess:true, silentError:true });
export const getDocsVehiculo = (id)       => apiFetch(`/docs/vehiculo/${id}`);
export const getDocsChofer   = (id)       => apiFetch(`/docs/chofer/${id}`);
export const crearDocVehiculo= (id,data)  => apiFetch(`/docs/vehiculo/${id}`, { method:"POST", body:data });
export const crearDocChofer  = (id,data)  => apiFetch(`/docs/chofer/${id}`,   { method:"POST", body:data });
export const borrarDocVehiculo = (vehiculoId, docId) => apiFetch(`/docs/vehiculo/${vehiculoId}/${docId}`, { method:"DELETE" });
export const borrarDocChofer   = (choferId, docId)   => apiFetch(`/docs/chofer/${choferId}/${docId}`, { method:"DELETE" });

// ── Informes ──────────────────────────────────────────
export const getDashboard   = (desde,hasta) => apiFetch(`/informes/dashboard?desde=${desde}&hasta=${hasta}`);
export const getInformeGestion = (period="30d") => apiFetch(`/informes/gestion?period=${encodeURIComponent(period)}`, { silentSuccess:true, silentError:true });
export const getBiResumen = (periodo="30d") => apiFetch(`/informes/bi/resumen?periodo=${encodeURIComponent(periodo)}`, { silentSuccess:true, silentError:true });
export const getRentabilidadOperativa = (period="30d") => apiFetch(`/informes/rentabilidad-operativa?period=${encodeURIComponent(period)}`, { silentSuccess:true, silentError:true });
export const getCargasRetorno = (period="30d") => apiFetch(`/informes/cargas-retorno?period=${encodeURIComponent(period)}`, { silentSuccess:true, silentError:true });
export const prepararSolicitudRetornoCarrier = (data) => apiFetch("/informes/cargas-retorno/solicitud", { method:"POST", body:data });
export const enviarSolicitudRetornoCarrier = (data) => apiFetch("/informes/cargas-retorno/solicitud/enviar", { method:"POST", body:data });
export const actualizarSolicitudRetornoCarrier = (id, data) => apiFetch(`/informes/cargas-retorno/solicitudes/${encodeURIComponent(id)}`, { method:"PATCH", body:data });
export const getScoringOperativo = (period="90d") => apiFetch(`/informes/scoring-operativo?period=${encodeURIComponent(period)}`, { silentSuccess:true, silentError:true });
export const getEmisionesOperativas = (period="90d") => apiFetch(`/informes/emisiones-operativas?period=${encodeURIComponent(period)}`, { silentSuccess:true, silentError:true });
export const getDatosMaestrosReadiness = () => apiFetch("/informes/datos-maestros-readiness", { silentSuccess:true, silentError:true });
export const getCumplimientoEuropeo = (days=45) => apiFetch(`/informes/cumplimiento-europeo?days=${encodeURIComponent(days)}`, { silentSuccess:true, silentError:true });
export const getControlTower = (period="7d") => apiFetch(`/informes/control-tower?period=${encodeURIComponent(period)}`, { silentSuccess:true, silentError:true });
export const getExcepcionesOperativas = () => apiFetch("/informes/excepciones", { silentSuccess:true, silentError:true });
export const actualizarExcepcionOperativa = (key, data) => apiFetch(`/informes/excepciones/${encodeURIComponent(key)}`, { method:"PATCH", body:data });
export const getNotificaciones = (limit=50) => apiFetch(`/notificaciones?limit=${encodeURIComponent(limit)}`, { silentSuccess:true, silentError:true });
export const marcarNotificacionLeida = (id) => apiFetch(`/notificaciones/${encodeURIComponent(id)}/leida`, { method:"PATCH", body:{} });
export const marcarTodasNotificacionesLeidas = () => apiFetch("/notificaciones/leer-todas", { method:"POST", body:{} });
export const getAvisosOperativosColaboradores = () => apiFetch("/notificaciones/operativas/colaboradores", { silentSuccess:true, silentError:true });
export const getAvisosOperativosIgnorados = (params={}) => apiFetch(`/notificaciones/operativas/ignorados?${new URLSearchParams(params)}`, { silentSuccess:true });
export const crearAgendaAvisoOperativoColaborador = (alert, data = {}) =>
  apiFetch("/notificaciones/operativas/colaboradores/agenda", { method:"POST", body:{ alert, ...data } });
export const ignorarAvisoOperativoColaborador = (alert, motivo = "") =>
  apiFetch("/notificaciones/operativas/colaboradores/ignorar", { method:"POST", body:{ alert, motivo } });
export const getActividad = (params={}) => apiFetch(`/actividad?${new URLSearchParams(params)}`, { silentSuccess:true, silentError:true });
export const getAgendaUsuarios = () => apiFetch("/agenda/usuarios", { silentSuccess:true, silentError:true });
export const getAgendaEventos = (params={}) => apiFetch(`/agenda?${new URLSearchParams(params)}`, { silentSuccess:true, silentError:true });
export const crearAgendaEvento = (data) => apiFetch("/agenda", { method:"POST", body:data });
export const editarAgendaEvento = (id, data) => apiFetch(`/agenda/${id}`, { method:"PATCH", body:data });
export const posponerAgendaEvento = (id, data) => apiFetch(`/agenda/${id}/posponer`, { method:"POST", body:data });
export const completarAgendaEvento = (id) => apiFetch(`/agenda/${id}/completar`, { method:"POST", body:{} });
export const borrarAgendaEvento = (id) => apiFetch(`/agenda/${id}`, { method:"DELETE" });
export const getPortalClienteResumen = () => apiFetch("/portal-cliente/resumen", { silentError:true });
export const getPortalClientePedidos = () => apiFetch("/portal-cliente/pedidos", { silentError:true });
export const getPortalClienteFacturas = () => apiFetch("/portal-cliente/facturas", { silentError:true });
export const getPortalClienteFactura = (id) => apiFetch(`/portal-cliente/facturas/${encodeURIComponent(id)}`);
export const getPortalClienteSolicitudes = () => apiFetch("/portal-cliente/solicitudes", { silentError:true });
export const getPortalClienteNotificaciones = (limit=20) => apiFetch(`/portal-cliente/notificaciones?limit=${encodeURIComponent(limit)}`, { silentSuccess:true, silentError:true });
export const marcarPortalClienteNotificacionLeida = (id) => apiFetch(`/portal-cliente/notificaciones/${encodeURIComponent(id)}/leida`, { method:"PATCH", body:{} });
export const marcarTodasPortalClienteNotificacionesLeidas = () => apiFetch("/portal-cliente/notificaciones/leer-todas", { method:"POST", body:{} });
export const getPortalClienteSolicitudEventos = (id) => apiFetch(`/portal-cliente/solicitudes/${encodeURIComponent(id)}/eventos`);
export const getPortalClientePuntos = () => apiFetch("/portal-cliente/puntos");
export const crearPortalClientePunto = (data) => apiFetch("/portal-cliente/puntos", { method:"POST", body:data });
export const getPortalClienteDocumentosResumen = () => apiFetch("/portal-cliente/documentos-resumen", { silentError:true });
export const getPortalClienteIntegracionManifest = () => apiFetch("/portal-cliente/integracion/manifest", { silentError:true });
export const getPortalClienteIntegracionFeed = (days=90) => apiFetch(`/portal-cliente/integracion/feed?days=${encodeURIComponent(days)}`, { silentError:true });
export const solicitarPortalClienteIntegracion = (data={}) => apiFetch("/portal-cliente/integracion/solicitar", { method:"POST", body:data });
export const crearPortalClienteSolicitud = (data) => apiFetch("/portal-cliente/solicitudes", { method:"POST", body:data });
export const getPortalClienteSolicitudDocumentos = (id) => apiFetch(`/portal-cliente/solicitudes/${encodeURIComponent(id)}/documentos`);
export const subirPortalClienteSolicitudDocumento = (id, data) => apiFetch(`/portal-cliente/solicitudes/${encodeURIComponent(id)}/documentos`, { method:"POST", body:data });
export const actualizarPortalClienteSolicitud = (id, data) => apiFetch(`/portal-cliente/solicitudes/${encodeURIComponent(id)}`, { method:"PATCH", body:data });
export const responderPortalClienteReprogramacion = (id, data) => apiFetch(`/portal-cliente/solicitudes/${encodeURIComponent(id)}/reprogramacion`, { method:"POST", body:data });
export const responderPortalClientePrecio = (id, data) => apiFetch(`/portal-cliente/solicitudes/${encodeURIComponent(id)}/precio`, { method:"POST", body:data });
export const cancelarPortalClienteSolicitud = (id, data={}) => apiFetch(`/portal-cliente/solicitudes/${encodeURIComponent(id)}/cancelar`, { method:"POST", body:data });
export const getPortalPedidoAlbaranes = (pedidoId) => apiFetch(`/portal-cliente/pedidos/${encodeURIComponent(pedidoId)}/albaranes`);
export const getPortalPedidoEventos = (pedidoId) => apiFetch(`/portal-cliente/pedidos/${encodeURIComponent(pedidoId)}/eventos`);
export const getPortalPedidoDocumentoControl = (pedidoId) => apiFetch(`/portal-cliente/pedidos/${encodeURIComponent(pedidoId)}/documento-control`);
export const getPortalSolicitudesAdmin = (params={}) => apiFetch(`/portal-cliente/admin/solicitudes?${new URLSearchParams(params)}`, { silentSuccess:true, silentError:true });
export const actualizarPortalSolicitudAdmin = (id, data) => apiFetch(`/portal-cliente/admin/solicitudes/${encodeURIComponent(id)}`, { method:"PATCH", body:data });
export const convertirPortalSolicitudAdmin = (id, data={}) => apiFetch(`/portal-cliente/admin/solicitudes/${encodeURIComponent(id)}/convertir`, { method:"POST", body:data, timeoutMs:60000 });
export const getPortalSolicitudEventosAdmin = (id) => apiFetch(`/portal-cliente/admin/solicitudes/${encodeURIComponent(id)}/eventos`);
export const getPortalSolicitudDocumentosAdmin = (id) => apiFetch(`/portal-cliente/admin/solicitudes/${encodeURIComponent(id)}/documentos`);
export const getInformeRutas= (desde,hasta) => apiFetch(`/informes/rutas?desde=${desde}&hasta=${hasta}`);
export const getInformeChoferes=(desde,hasta)=>apiFetch(`/informes/choferes?desde=${desde}&hasta=${hasta}`);
export const getInformeCobros = ()          => apiFetch("/informes/cobros");

// ── Usuarios ──────────────────────────────────────────
export const getUsuarios    = ()          => apiFetch("/usuarios");
export const crearUsuario   = (data)      => apiFetch("/usuarios", { method:"POST", body:data });
export const editarUsuario  = (id,data)   => apiFetch(`/usuarios/${id}`, { method:"PATCH", body:data });
export const resetPassword  = (id,pw)     => apiFetch(`/usuarios/${id}/reset-password`, { method:"POST", body:{ password_nuevo:pw } });

// ── Health check ──────────────────────────────────────
export const healthCheck = () => fetch(`${BASE}/health`).then(r=>r.json()).catch(()=>({status:"error"}));
export function getErroresApiRecientes() {
  try { return JSON.parse(localStorage.getItem("tms_api_errors") || "[]"); } catch { return []; }
}
export function limpiarErroresApiRecientes() {
  if (typeof window !== "undefined") window.__TMS_LAST_API_ERROR = null;
  try { localStorage.removeItem("tms_api_errors"); } catch {}
}
export const getPublicAppMeta = async () => {
  if (typeof window !== "undefined" && window.__TMS_APP_META && typeof window.__TMS_APP_META === "object") return window.__TMS_APP_META;
  const res = await fetch(`${BASE}/api/v1/superadmin/public/app-meta`);
  const data = await res.json().catch(() => ({}));
  const meta = data?.app_meta || {};
  if (typeof window !== "undefined") window.__TMS_APP_META = meta;
  return meta;
};
export const getLoginBrand = async (identifier) => {
  const q = new URLSearchParams({ identifier: String(identifier || "").trim() });
  const res = await fetch(`${BASE}/api/v1/auth/login-brand?${q.toString()}`);
  if (!res.ok) return { found:false };
  return fixMojibakePayload(await res.json().catch(() => ({ found:false })));
};

// ── Rutas por cliente ─────────────────────────────────
export const getRutasCliente   = (cid, options = {}) => apiFetch(`/clientes/${cid}/rutas`, options);
export const getRutasClienteSalud = (cid)     => apiFetch(`/clientes/${cid}/rutas/salud`);
export const crearRutaCliente  = (cid, data, options = {}) => apiFetch(`/clientes/${cid}/rutas`, { method:"POST", body:data, ...options });
export const editarRutaCliente = (cid,rid,data)=>apiFetch(`/clientes/${cid}/rutas/${rid}`, { method:"PUT", body:data });
export const borrarRutaCliente = (cid, rid)   => apiFetch(`/clientes/${cid}/rutas/${rid}`, { method:"DELETE" });

// ── Pedidos por cliente ───────────────────────────────
export const getPedidosCliente = (cid, params={}) => apiFetch(`/pedidos?cliente_id=${cid}&${new URLSearchParams(params)}`);

// ── Facturación múltiple ──────────────────────────────
export const crearFacturaMultiple = (data) => apiFetch("/facturas", { method:"POST", body:data });

// ── Documentos con semáforo ───────────────────────────
export const getTodosLosDocs = () => apiFetch("/docs/todos");

// ── Empresa (cache local + backend) ───────────────────
export function getEmpresa()  {
  try {
    if (typeof window !== "undefined" && window.__TMS_EMPRESA_CACHE && typeof window.__TMS_EMPRESA_CACHE === "object") {
      return window.__TMS_EMPRESA_CACHE;
    }
    return JSON.parse(localStorage.getItem("tms_empresa")||"{}");
  } catch { return {}; }
}
export function saveEmpresa(d){
  if (typeof window !== "undefined") window.__TMS_EMPRESA_CACHE = d || {};
  try { localStorage.setItem("tms_empresa", JSON.stringify(d)); } catch {}
}
export const getEmpresaBackend = (options = {}) => apiFetch("/empresa/perfil", options);
export const saveEmpresaBackend = (data) => apiFetch("/empresa/perfil", { method:"PUT", body:data });
export const getEmpresaFiscalConfig = () => apiFetch("/empresa/fiscal-config");
export const saveEmpresaFiscalConfig = (data) => apiFetch("/empresa/fiscal-config", { method:"PUT", body:data });
export const testEmpresaFiscalConfig = () => apiFetch("/empresa/fiscal-config/test", { method:"POST", body:{} });
export const getEmpresaFiscalQueueSummary = () => apiFetch("/empresa/fiscal-config/queue-summary");

export const getMiControlHorario = () => apiFetch("/control-horario/mi-jornada", { silentSuccess:true });
export const ficharControlHorario = (data) => apiFetch("/control-horario/fichar", { method:"POST", body:data });
export const getControlHorario = (params={}) => apiFetch(`/control-horario?${new URLSearchParams(params)}`, { silentSuccess:true });
export const getControlHorarioResumen = (params={}) => apiFetch(`/control-horario/resumen?${new URLSearchParams(params)}`, { silentSuccess:true });
export const getControlHorarioConfig = () => apiFetch("/control-horario/config", { silentSuccess:true, silentError:true });
export const saveControlHorarioConfig = (data) => apiFetch("/control-horario/config", { method:"PUT", body:data });
export const getTeletrabajoSolicitudes = (params={}) => apiFetch(`/control-horario/teletrabajo?${new URLSearchParams(params)}`, { silentSuccess:true, silentError:true });
export const crearTeletrabajoSolicitud = (data) => apiFetch("/control-horario/teletrabajo", { method:"POST", body:data });
export const resolverTeletrabajoSolicitud = (id, data) => apiFetch(`/control-horario/teletrabajo/${encodeURIComponent(id)}`, { method:"PATCH", body:data });
export const getJornadaConfig = (params={}) => apiFetch(`/control-horario/jornada-config?${new URLSearchParams(params)}`, { silentSuccess:true, silentError:true });
export const saveJornadaConfig = (data) => apiFetch("/control-horario/jornada-config", { method:"PUT", body:data });
export const editarControlHorario = (id, data) => apiFetch(`/control-horario/${id}`, { method:"PUT", body:data });
export const controlHorarioCsvUrl = (params={}) => `${BASE}/api/v1/control-horario/export.csv?${new URLSearchParams(params)}`;
export const extraerDocumentoIA = (data) => apiFetch("/ia/documento/extraer", { method:"POST", body:data, silentSuccess:true });
export const analizarPedidoFacturacionIA = (id, data = {}) =>
  apiFetch(`/ia/pedido/${id}/facturacion-soportes`, { method:"POST", body:data, silentSuccess:true });
export const getEmpresaIntegracionesStatus = () => apiFetch("/empresa/integraciones/status");

// ── Config email (local) ──────────────────────────────
export function getEmailConfig()  {
  try {
    if (typeof window !== "undefined" && window.__TMS_EMAIL_CFG && typeof window.__TMS_EMAIL_CFG === "object") {
      return window.__TMS_EMAIL_CFG;
    }
    return JSON.parse(localStorage.getItem("tms_email_cfg")||"{}");
  } catch { return {}; }
}
export function saveEmailConfig(d){
  if (typeof window !== "undefined") window.__TMS_EMAIL_CFG = d || {};
  try { localStorage.setItem("tms_email_cfg", JSON.stringify(d)); } catch {}
}
export const getEmailConfigBackend = () => apiFetch("/email/config");
export const saveEmailConfigBackend = (data) => apiFetch("/email/config", { method:"PUT", body:data });
export const getEmailLogBackend = () => apiFetch("/email/log");

// ── Factura rectificativa ─────────────────────────────
export const crearRectificativa = (data) => apiFetch("/facturas", { method:"POST", body:data });

// ── Envío email factura ───────────────────────────────
export const revisarEmailFactura = (id, destinatario = "") => apiFetch(`/email/factura/${id}/preflight?${new URLSearchParams(destinatario ? { destinatario } : {})}`);
export const enviarEmailFactura = (id, data) => apiFetch(`/email/factura/${id}`, { method:"POST", body:data });
export const enviarEmailPedido  = (id, data) => apiFetch(`/email/pedido/${id}`,  { method:"POST", body:data });
export const getPagosColaboradorPendientes = () => apiFetch("/pedidos/colaborador-pagos/pendientes");

// ── Datos empresa (localStorage → BD) ────────────────────────────────────
// Gastos estructura
export const getGastosEstructura   = ()        => apiFetch("/empresa/gastos-estructura");
export const crearGastoEstructura  = (data)    => apiFetch("/empresa/gastos-estructura", {method:"POST",body:data});
export const editarGastoEstructura = (id,data) => apiFetch(`/empresa/gastos-estructura/${id}`, {method:"PUT",body:data});
export const borrarGastoEstructura = (id)      => apiFetch(`/empresa/gastos-estructura/${id}`, {method:"DELETE"});
export const getMesesCerrados      = ()        => apiFetch("/empresa/meses-cerrados");
export const cerrarMes             = (mes)     => apiFetch(`/empresa/meses-cerrados/${mes}`, {method:"POST"});
export const abrirMes              = (mes)     => apiFetch(`/empresa/meses-cerrados/${mes}`, {method:"DELETE"});
// Gasoil y repostajes
export const getGasoilConfig       = (vid)     => apiFetch(`/empresa/gasoil-config/${vid}`);
export const setGasoilConfig       = (vid,d)   => apiFetch(`/empresa/gasoil-config/${vid}`, {method:"PUT",body:d});
export const getRepostajes         = (vid)     => apiFetch(`/empresa/repostajes/${vid}`);
export const crearRepostaje        = (vid,d)   => apiFetch(`/empresa/repostajes/${vid}`, {method:"POST",body:d});
export const borrarRepostaje       = (id)      => apiFetch(`/empresa/repostajes/${id}`, {method:"DELETE"});
// Noches
export const getNochesVehiculo     = (vid,p)   => apiFetch(`/empresa/noches/${vid}${p?"?"+new URLSearchParams(p).toString():""}`);
export const crearNoche            = (vid,d)   => apiFetch(`/empresa/noches/${vid}`, {method:"POST",body:d});
export const borrarNoche           = (id)      => apiFetch(`/empresa/noches/${id}`, {method:"DELETE"});
export const getChoferJornadas     = (cid,p)   => apiFetch(`/empresa/chofer-jornadas/${cid}${p?"?"+new URLSearchParams(p).toString():""}`);
export const getKmVacioVehiculo    = (vid,p)   => apiFetch(`/empresa/km-vacio/${vid}${p?"?"+new URLSearchParams(p).toString():""}`);
export const crearKmVacioVehiculo  = (vid,d)   => apiFetch(`/empresa/km-vacio/${vid}`, {method:"POST",body:d});
export const borrarKmVacioVehiculo = (id)      => apiFetch(`/empresa/km-vacio/${id}`, {method:"DELETE"});
// Config chófer
export const getChoferConfig       = (cid)     => apiFetch(`/empresa/chofer-config/${cid}`);
export const setChoferConfig       = (cid,d)   => apiFetch(`/empresa/chofer-config/${cid}`, {method:"PUT",body:d});
// Nóminas emitidas
export const getNominasEmitidas    = (params)  => apiFetch(`/empresa/nominas-emitidas${params?"?"+new URLSearchParams(params).toString():""}`);
export const crearNominaEmitida    = (data)    => apiFetch("/empresa/nominas-emitidas", {method:"POST",body:data});
export const borrarNominaEmitida   = (id)      => apiFetch(`/empresa/nominas-emitidas/${id}`, {method:"DELETE"});
// Objetivos KPI
export const getObjetivos          = ()        => apiFetch("/empresa/objetivos");
export const setObjetivo           = (periodo,d) => apiFetch(`/empresa/objetivos/${periodo}`, {method:"PUT",body:d});
// Config empresa
export const getEmpresaConfig      = ()        => apiFetch("/empresa/config");
export const setConfigTrafico      = (data)    => apiFetch("/empresa/config/trafico", {method:"PUT",body:data});
export const setConfigPrecios      = (data)    => apiFetch("/empresa/config/precios", {method:"PUT",body:data});
export const actualizarCapitalTesoreria = (data) => apiFetch("/empresa/config/tesoreria/capital", {method:"PUT",body:data});
export const setConfigAlertas      = (data)    => apiFetch("/empresa/config/alertas", {method:"PUT",body:data});
export const getCalendarioLaboral  = (params={}) => apiFetch(`/empresa/calendario-laboral?${new URLSearchParams(params)}`);
export const getCalendarioLaboralCcaa = ()     => apiFetch("/empresa/calendario-laboral/ccaa");
export const actualizarKmVehiculo  = (id, km)  => apiFetch(`/vehiculos/${id}/km`, { method:"PATCH", body:{ km_actuales: km } });
export const getAlertasDocVehiculos = ()       => apiFetch("/vehiculos/alertas-doc", { silentSuccess:true, silentError:true });

// ── Taller ────────────────────────────────────────────
export const getTallerEstado       = ()        => apiFetch("/taller/estado", { silentSuccess:true, silentError:true });
export const guardarTallerEstado   = (data)    => apiFetch("/taller/estado", { method:"PUT", body:data });
export const getTallerSolicitudes  = ()        => apiFetch("/taller/solicitudes");
export const getTallerSolicitudCapacidades = () => apiFetch("/taller/solicitudes/capacidades", { silentSuccess:true, silentError:true });
export const crearTallerSolicitud  = (data)    => apiFetch("/taller/solicitudes", { method:"POST", body:data });
export const actualizarTallerSolicitud = (id,data) => apiFetch(`/taller/solicitudes/${id}`, { method:"PATCH", body:data });
export const getTallerPiezas       = (params={}) => apiFetch(`/taller/piezas?${new URLSearchParams(params)}`);
export const getTallerPiezaPorCodigo = (codigo) => apiFetch(`/taller/piezas/codigo/${encodeURIComponent(codigo)}`);
export const crearTallerPieza      = (data)    => apiFetch("/taller/piezas", { method:"POST", body:data });
export const editarTallerPieza     = (id,data) => apiFetch(`/taller/piezas/${id}`, { method:"PUT", body:data });
export const borrarTallerPieza     = (id)      => apiFetch(`/taller/piezas/${id}`, { method:"DELETE" });
export const getTallerPiezaUnidades = (id, params={}) => apiFetch(`/taller/piezas/${id}/unidades?${new URLSearchParams(params)}`);
export const getTallerUnidadesHistorial = (params={}) => apiFetch(`/taller/piezas/unidades/historial?${new URLSearchParams(params)}`);
export const generarTallerPiezaUnidades = (id, data) => apiFetch(`/taller/piezas/${id}/unidades/generar`, { method:"POST", body:data });
export const asignarTallerPiezaUnidad = (data) => apiFetch("/taller/piezas/unidades/asignar", { method:"POST", body:data });
export const devolverTallerPiezaUnidad = (id) => apiFetch(`/taller/piezas/unidades/${id}/devolver`, { method:"PATCH" });
export const getTallerIntervenciones = (params={}) => apiFetch(`/taller/intervenciones?${new URLSearchParams(params)}`);
export const crearTallerIntervencion = (data)  => apiFetch("/taller/intervenciones", { method:"POST", body:data });
export const editarTallerIntervencion = (id,data) => apiFetch(`/taller/intervenciones/${id}`, { method:"PUT", body:data });
export const addPiezaIntervencion  = (id,data) => apiFetch(`/taller/intervenciones/${id}/piezas`, { method:"POST", body:data });
export const cerrarTallerIntervencion = (id)   => apiFetch(`/taller/intervenciones/${id}/cerrar`, { method:"POST" });
export const borrarTallerIntervencion = (id)   => apiFetch(`/taller/intervenciones/${id}`, { method:"DELETE" });
export const getTallerNeumaticos   = (params={}) => apiFetch(`/taller/neumaticos?${new URLSearchParams(params)}`);
export const crearTallerNeumatico  = (data)    => apiFetch("/taller/neumaticos", { method:"POST", body:data });
export const montarTallerNeumatico = (id,data) => apiFetch(`/taller/neumaticos/${id}/montar`, { method:"PATCH", body:data });
export const bajaTallerNeumatico   = (id,data={}) => apiFetch(`/taller/neumaticos/${id}/baja`, { method:"PATCH", body:data });
export const borrarTallerNeumatico = (id)      => apiFetch(`/taller/neumaticos/${id}`, { method:"DELETE" });

// Puntos de interes
export const getPuntosInteres      = (params={}) => apiFetch(`/puntos-interes?${new URLSearchParams(params)}`);
export const crearPuntoInteres     = (data)      => apiFetch("/puntos-interes", { method:"POST", body:data });
export const editarPuntoInteres    = (id,data)   => apiFetch(`/puntos-interes/${id}`, { method:"PUT", body:data });
export const borrarPuntoInteres    = (id)        => apiFetch(`/puntos-interes/${id}`, { method:"DELETE" });

// Almacen y palets normalizados
export const getAlmacenes          = ()          => apiFetch("/palets/almacenes");
export const crearAlmacen          = (data)      => apiFetch("/palets/almacenes", { method:"POST", body:data });
export const borrarAlmacen         = (id)        => apiFetch(`/palets/almacenes/${id}`, { method:"DELETE" });
export const getPaletMovimientos   = (params={}) => apiFetch(`/palets/movimientos?${new URLSearchParams(params)}`);
export const crearPaletMovimiento  = (data)      => apiFetch("/palets/movimientos", { method:"POST", body:data });
export const editarPaletMovimiento = (id,data)   => apiFetch(`/palets/movimientos/${id}`, { method:"PUT", body:data });
export const confirmarSalidaPaletMovimiento = (id,data={}) => apiFetch(`/palets/movimientos/${id}/confirmar-salida`, { method:"PATCH", body:data, silentSuccess:true });
export const borrarPaletMovimiento = (id)        => apiFetch(`/palets/movimientos/${id}`, { method:"DELETE" });
export const getPaletResumen       = ()          => apiFetch("/palets/resumen");
export const getPaletAlertasEstado = ()          => apiFetch("/palets/alertas-estado", { silentError:true });
export const setPaletAlertaEstado  = (data)      => apiFetch("/palets/alertas-estado", { method:"PUT", body:data, silentSuccess:true });
export const getAlmacenMercancias  = (params={}) => apiFetch(`/palets/mercancias?${new URLSearchParams(params)}`);
export const crearAlmacenMercancia = (data)      => apiFetch("/palets/mercancias", { method:"POST", body:data });
export const editarAlmacenMercancia= (id,data)   => apiFetch(`/palets/mercancias/${id}`, { method:"PUT", body:data });
export const borrarAlmacenMercancia= (id)        => apiFetch(`/palets/mercancias/${id}`, { method:"DELETE" });
export const getAlmacenMovimientos = (params={}) => apiFetch(`/palets/movimientos-almacen?${new URLSearchParams(params)}`);
export const crearAlmacenMovimiento= (data)      => apiFetch("/palets/movimientos-almacen", { method:"POST", body:data });
export const editarAlmacenMovimiento= (id,data)  => apiFetch(`/palets/movimientos-almacen/${id}`, { method:"PUT", body:data });
export const borrarAlmacenMovimiento= (id)       => apiFetch(`/palets/movimientos-almacen/${id}`, { method:"DELETE" });


export const getLogo       = ()     => apiFetch("/empresa/logo");
export const subirLogo     = (data) => apiFetch("/empresa/logo", {method:"POST",body:data});
export const eliminarLogo  = ()     => apiFetch("/empresa/logo", {method:"DELETE"});
export const chatIA        = (data) => apiFetch("/ia/chat", { method:"POST", body:data });

// ── Documentos de pedido ─────────────────────────────────────────────────
export const getPedidoDocs      = (pid)       => apiFetch(`/empresa/pedido-docs/${pid}`);
export const getPedidoDocsB64   = (pid)       => apiFetch(`/empresa/pedido-docs/${pid}/base64`);
export const subirPedidoDoc     = (pid, data) => apiFetch(`/empresa/pedido-docs/${pid}`, {method:"POST",body:data});
export const subirPedidoDocChofer = (pid, data) => apiFetch(`/pedidos/${pid}/chofer-docs`, {method:"POST",body:data});
export const borrarPedidoDoc    = (id)        => apiFetch(`/empresa/pedido-docs/${id}`, {method:"DELETE"});
export const getPedidoDocsBulk  = (ids)       => apiFetch("/empresa/pedido-docs-bulk", {method:"POST",body:{pedido_ids:ids}});
// ── Periodos tractora por chófer ─────────────────────────────────────────
export const getTractoraPeriodos = (cid)      => apiFetch(`/empresa/tractora-periodos/${cid}`);
export const crearTractoraPeriodo = (data)    => apiFetch("/empresa/tractora-periodos", {method:"POST",body:data});

export const eliminarPedido = (id) => apiFetch(`/pedidos/${id}`, {method:"DELETE"});

// ── Clientes pendientes revisión ─────────────────────────────────────────
export const getClientesPendientesRevision = () => apiFetch("/clientes/pendientes-revision", { silentSuccess:true, silentError:true });
export const marcarClienteRevisado = (id)   => apiFetch(`/clientes/${id}/revision`, {method:"PATCH"});

// ── Desvincular pedido de factura ────────────────────────────────────────
export const getColaboradoresPendientesRevision = () => apiFetch("/colaboradores/pendientes-revision", { silentSuccess:true, silentError:true });
export const marcarColaboradorRevisado = (id) => apiFetch(`/colaboradores/${id}/revision`, {method:"PATCH"});

export const desvincularFacturaPedido = (id) => apiFetch(`/pedidos/${id}/factura`, { method: 'DELETE' });
// ── Múltiples descargas ──────────────────────────────────────────────────
export const getDescargas    = (pid)     => apiFetch(`/pedidos/${pid}/descargas`);
export const crearDescarga   = (pid,d)   => apiFetch(`/pedidos/${pid}/descargas`, { method:"POST", body:d });
export const editarDescarga  = (pid,did,d) => apiFetch(`/pedidos/${pid}/descargas/${did}`, { method:"PATCH", body:d });
export const borrarDescarga  = (pid,did) => apiFetch(`/pedidos/${pid}/descargas/${did}`, { method:"DELETE" });

// ── Grupajes ─────────────────────────────────────────────────────────────
export const getGrupajes     = ()        => apiFetch("/grupajes");
export const crearGrupaje    = (d)       => apiFetch("/grupajes", { method:"POST", body:d });
export const editarGrupaje   = (id,d)    => apiFetch(`/grupajes/${id}`, { method:"PATCH", body:d });
export const addPedidoGrupaje= (gid,pid) => apiFetch(`/grupajes/${gid}/pedidos`, { method:"POST", body:{ pedido_id:pid } });
export const quitarPedidoGrupaje=(gid,pid)=> apiFetch(`/grupajes/${gid}/pedidos/${pid}`, { method:"DELETE" });


export const getCartaPorte  = (id) => apiFetch(`/pedidos/${id}/carta-porte`);

export const guardarFirmaEntrega = (id, data) =>
  apiFetch(`/pedidos/${id}/firma`, { method: "POST", body: data });
export const getFirmaEntregaEvidencia = (id) => apiFetch(`/pedidos/${id}/firma/evidencia`);
export async function descargarFirmaEntregaEvidenciaInforme(id) {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1/pedidos/${encodeURIComponent(id)}/firma/evidencia/informe`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const data = await parseApiResponse(res).catch(() => ({}));
    throw new Error(data.error || data.message || data.raw_text || "No se pudo descargar el informe de firma.");
  }
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return {
    blob: await res.blob(),
    filename: match?.[1] || `evidencia-firma-${id}.html`,
  };
}
export const actualizarGpsPedido = (id, data) =>
  apiFetch(`/pedidos/${id}/gps`, { method: "POST", body: data });
export const registrarGpsChoferApp = (data) =>
  apiFetch("/choferes/app/gps", { method: "POST", body: data, timeoutMs: 15000, silentSuccess: true, silentError: true });

export const calcularRutaGeo = (points = []) => {
  const compactPoints = points.map(point => {
    const hasExplicitQuery = Object.prototype.hasOwnProperty.call(point, "query");
    return {
      label: point.label || point.nombre || point.direccion || "",
      query: hasExplicitQuery ? (point.query || "") : (point.address || point.direccion || point.label || point.nombre || ""),
      role: point.role || point.tipo || "parada",
      country: point.country || point.pais || "",
      region: point.region || point.provincia || "",
      google_maps_url: point.google_maps_url || "",
      lat: point.lat ?? point.latitude ?? point.latitud ?? null,
      lng: point.lng ?? point.lon ?? point.longitude ?? point.longitud ?? null,
    };
  });
  return apiFetch(`/geocoding/route?points=${encodeURIComponent(JSON.stringify(compactPoints))}`, {
    timeoutMs: 35000,
    silentSuccess: true,
  });
};

export const calcularDistanciaGeo = (origin, destination) =>
  calcularRutaGeo([
    { label: origin, role: "origen" },
    { label: destination, role: "destino" },
  ]);


