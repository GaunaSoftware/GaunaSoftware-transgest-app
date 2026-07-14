import { useDebounce } from "../hooks/useDebounce";
import { getCartaPorte, guardarFirmaEntrega, getFirmaEntregaEvidencia, verArchivoProtegido } from "../services/api";
import { getLogoDataUrl } from "../services/logoHelper";
import { getPedidoDocs, getDescargas, subirPedidoDoc, borrarPedidoDoc, eliminarPedido, desvincularFacturaPedido, getPedidoEventos } from "../services/api";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { getPedidosResumenLista, getClientes, getVehiculos, getChoferes, getRutas, getColaboradores,
         crearPedido, editarPedido, cambiarEstadoPedido, crearFactura, crearRutaCliente,
         getRutasCliente, getClienteRiesgoOperativo, getPedido, getPedidoRentabilidadPredictiva, getPedidoDocumentoControl, generarPedidoDocumentoControl, getPedidoDocumentoControlExport, getPedidoDocumentoControlFirmaPaquete, getPedidoRegulatoryCoreExport, descargarPedidoRegulatoryDossierPdf, getPedidoRegulatoryPayload, crearPedidoRegulatoryTransmissionDraft, descargarFirmaEntregaEvidenciaInforme, registrarPedidoDocumentoControlEvento, getPedidoColaboradorPago, guardarPedidoColaboradorPago, getEmpresaConfig, setConfigPrecios,
         crearCliente, crearColaborador, enviarWorkflowColaborador, getWorkflowColaboradorPreview, crearPuntoInteres, editarPuntoInteres, borrarPuntoInteres,
         crearColaboradorLiquidacionToken,
         getPuntosInteres as getPuntosInteresApi, interpretarPedidoIA, getAiInboxRuns, getAiInboxStatus, getPlanificacionCargaIA, getRutaOptimizadaPedido, optimizarRuta, resolveGeoPlace,
         getPedidoWhatsappPreflight, enviarPedidoWhatsapp, notificarPedidoChoferApp, getPedidoChoferPasos } from "../services/api";
import { getEmpresaPerfilSync, useEmpresaPerfil } from "../hooks/useEmpresaPerfil";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";
import { getEmpresaPlanLocal, planHasFeature } from "../utils/planFeatures";
import { clearRuntimeFocus, readRuntimeFocus, setRuntimeFocus } from "../services/runtimeFocus";
import { canonicalCountry, cmrTypeForCountries, completeOnTab, getEnabledEuropeCountries, getRegionsForCountry } from "../utils/europeGeo";
import { GeoFields } from "../components/GeoFields";
import { inferPlaceGeo } from "../utils/placeGeo";
import RutaMapa from "../components/RutaMapa";

let puntosInteresCache = [];
const AI_INBOX_MAX_FILE_BYTES = 6 * 1024 * 1024;
const AI_INBOX_MAX_TOTAL_BYTES = 7 * 1024 * 1024;

function formatDateInputLocal(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function withPedidoGeoDefaults(draft = {}) {
  const origenPaisFallback = canonicalCountry(draft.origen_pais || draft.pais_origen || "España") || "España";
  const destinoPaisFallback = canonicalCountry(draft.destino_pais || draft.pais_destino || "España") || "España";
  const puntosCarga = hydrateStopsGeo(parseStops(draft.puntos_carga), origenPaisFallback, draft.origen_provincia || draft.provincia_origen || "");
  const puntosDescarga = hydrateStopsGeo(parseStops(draft.puntos_descarga), destinoPaisFallback, draft.destino_provincia || draft.provincia_destino || "");
  const origenPrimary = puntosCarga[0] || {};
  const destinoPrimary = puntosDescarga[0] || {};
  const origenPais = stopCountry(origenPrimary, origenPaisFallback);
  const destinoPais = stopCountry(destinoPrimary, destinoPaisFallback);
  return {
    ...draft,
    puntos_carga: puntosCarga.length ? puntosCarga : draft.puntos_carga,
    puntos_descarga: puntosDescarga.length ? puntosDescarga : draft.puntos_descarga,
    origen_pais: origenPais,
    destino_pais: destinoPais,
    origen_provincia: stopRegion(origenPrimary, draft.origen_provincia || draft.provincia_origen || ""),
    destino_provincia: stopRegion(destinoPrimary, draft.destino_provincia || draft.provincia_destino || ""),
    cmr_tipo: cmrTypeForPedidoStops({ ...draft, puntos_carga: puntosCarga, puntos_descarga: puntosDescarga, origen_pais: origenPais, destino_pais: destinoPais }),
  };
}

function stopCountry(stop = {}, fallback = "España") {
  return canonicalCountry(stop.pais || stop.country || stop.pais_origen || fallback || "España") || "España";
}

function stopCountryInputValue(stop = {}, fallback = "España") {
  if (Object.prototype.hasOwnProperty.call(stop, "pais")) return stop.pais ?? "";
  if (Object.prototype.hasOwnProperty.call(stop, "country")) return stop.country ?? "";
  if (Object.prototype.hasOwnProperty.call(stop, "pais_origen")) return stop.pais_origen ?? "";
  return fallback || "";
}

function stopRegion(stop = {}, fallback = "") {
  return stop.provincia || stop.region || stop.state || stop.provincia_origen || fallback || "";
}

function placeQueryFromDraft(draft = {}, ...extra) {
  return [
    ...extra,
    draft.ciudad,
    draft.municipio,
    draft.direccion,
    draft.address,
    draft.nombre,
    draft.name,
    draft.cliente_nombre,
  ].map(v => String(v || "").trim()).find(v => v.length >= 2) || "";
}

function mergeResolvedGeo(draft = {}, geo = {}, fallbackCountry = "EspaÃ±a") {
  if (!geo) return draft;
  const resolvedPais = canonicalCountry(geo.pais || geo.country || "") || geo.pais || geo.country || "";
  const currentPais = canonicalCountry(draft.pais || "") || draft.pais || "";
  const currentLooksDefault = !currentPais || ["espana", "espaÃ±a", "spain"].includes(String(currentPais).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  const pais = currentLooksDefault && resolvedPais ? resolvedPais : (currentPais || resolvedPais || fallbackCountry);
  return {
    ...draft,
    ciudad: draft.ciudad || geo.municipio || geo.city || "",
    pais,
    // La provincia escrita o corregida por el usuario siempre prevalece.
    provincia: draft.provincia || geo.provincia || geo.region || geo.state || "",
    lat: draft.lat ?? draft.latitud ?? geo.lat ?? null,
    lng: draft.lng ?? draft.longitud ?? geo.lng ?? null,
  };
}

async function resolveGeoDraft(draft = {}, fallbackCountry = "EspaÃ±a", ...extra) {
  const local = inferPlaceGeo(draft, ...extra, draft.ciudad, draft.direccion, draft.nombre, draft.cliente_nombre, draft.pais);
  if (local?.provincia || local?.pais) return mergeResolvedGeo(draft, local, fallbackCountry);
  const q = placeQueryFromDraft(draft, ...extra);
  if (!q) return draft;
  try {
    const remote = await resolveGeoPlace({
      q,
      country: draft.pais || fallbackCountry || "",
      region: draft.provincia || "",
    });
    if (!remote?.ok && !remote?.provincia && !remote?.pais) return draft;
    return mergeResolvedGeo(draft, remote, fallbackCountry);
  } catch {
    return draft;
  }
}

function hydrateStopsGeo(stops = [], fallbackCountry = "España", fallbackRegion = "") {
  return (Array.isArray(stops) ? stops : []).map((stop, idx) => ({
    ...stop,
    pais: stopCountry(stop, idx === 0 ? fallbackCountry : "España"),
    provincia: stopRegion(stop, idx === 0 ? fallbackRegion : ""),
  }));
}

function cmrTypeForPedidoStops(form = {}) {
  const cargas = hydrateStopsGeo(parseStops(form.puntos_carga), form.origen_pais || "España", form.origen_provincia || "");
  const descargas = hydrateStopsGeo(parseStops(form.puntos_descarga), form.destino_pais || "España", form.destino_provincia || "");
  const countries = [
    ...cargas.map(stop => stopCountry(stop)),
    ...descargas.map(stop => stopCountry(stop)),
    form.origen_pais || "España",
    form.destino_pais || "España",
  ];
  return countries.some(country => cmrTypeForCountries(country, "España") === "internacional") ? "internacional" : "nacional";
}

function currentWeekRangeLocal(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = base.getDay() || 7;
  const monday = new Date(base);
  monday.setDate(base.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    week: formatDateInputLocal(monday),
    desde: formatDateInputLocal(monday),
    hasta: formatDateInputLocal(sunday),
  };
}

function currentMonthRangeLocal(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    month: formatDateInputLocal(first),
    desde: formatDateInputLocal(first),
    hasta: formatDateInputLocal(last),
    label: first.toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
  };
}

function addDaysLocal(dateIso, days) {
  const base = new Date(`${String(dateIso || "").slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + Number(days || 0));
  return formatDateInputLocal(base);
}

function pedidoFechaOperativaKey(pedido) {
  return toDateInputValue(pedido?.fecha_carga || pedido?.fecha_descarga || pedido?.fecha_entrega) || "sin-fecha";
}

function pedidoClienteOrdenKey(pedido) {
  return String(pedido?.cliente_nombre || pedido?.cliente || "Sin cliente").trim();
}

function formatWeekdayLabel(dateIso) {
  if (!dateIso || dateIso === "sin-fecha") return "Sin fecha";
  const d = new Date(`${String(dateIso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  const weekday = d.toLocaleDateString("es-ES", { weekday: "long" });
  const date = d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${date}`;
}

function formatShortDateLabel(dateIso) {
  if (!dateIso || dateIso === "sin-fecha") return "";
  const d = new Date(`${String(dateIso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

function monthKeyLocal(dateIso) {
  if (!dateIso || dateIso === "sin-fecha") return "sin-fecha";
  const raw = String(dateIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "sin-fecha";
  return `${raw.slice(0, 7)}-01`;
}

function formatMonthLabel(dateIso) {
  if (!dateIso || dateIso === "sin-fecha") return "Sin fecha";
  const d = new Date(`${String(dateIso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" }).toUpperCase();
}

function startOfWeekLocal(dateIso) {
  if (!dateIso || dateIso === "sin-fecha") return "sin-fecha";
  const d = new Date(`${String(dateIso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "sin-fecha";
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return formatDateInputLocal(d);
}

function weekIndexInRange(weekStartIso, rangeStartIso) {
  if (!weekStartIso || weekStartIso === "sin-fecha") return null;
  const rangeWeekStart = startOfWeekLocal(rangeStartIso || weekStartIso);
  const a = new Date(`${rangeWeekStart}T00:00:00`);
  const b = new Date(`${weekStartIso}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(1, Math.floor((b.getTime() - a.getTime()) / (7 * 86400000)) + 1);
}

function weekIndexInMonth(dateIso) {
  if (!dateIso || dateIso === "sin-fecha") return null;
  const day = new Date(`${String(dateIso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(day.getTime())) return null;
  const firstDay = new Date(day.getFullYear(), day.getMonth(), 1);
  const offset = firstDay.getDay() || 7;
  return Math.ceil((day.getDate() + offset - 1) / 7);
}

function buildPedidoCalendarGroups(items, { desde, hasta, currentWeek = false } = {}) {
  const byMonth = new Map();
  const sorted = [...items].sort((a, b) => {
    const da = pedidoFechaOperativaKey(a.pedido);
    const db = pedidoFechaOperativaKey(b.pedido);
    if (da !== db) return String(da).localeCompare(String(db));
    const ca = pedidoClienteOrdenKey(a.pedido);
    const cb = pedidoClienteOrdenKey(b.pedido);
    const clienteCmp = ca.localeCompare(cb, "es", { sensitivity: "base" });
    if (clienteCmp !== 0) return clienteCmp;
    return String(a.pedido?.hora_carga || "").localeCompare(String(b.pedido?.hora_carga || ""));
  });
  sorted.forEach(item => {
    const dayKey = pedidoFechaOperativaKey(item.pedido);
    const weekKey = startOfWeekLocal(dayKey);
    const monthKey = monthKeyLocal(dayKey);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, new Map());
    const byWeek = byMonth.get(monthKey);
    if (!byWeek.has(weekKey)) byWeek.set(weekKey, new Map());
    const days = byWeek.get(weekKey);
    if (!days.has(dayKey)) days.set(dayKey, []);
    days.get(dayKey).push(item);
  });
  return Array.from(byMonth.entries()).map(([monthKey, weeksMap]) => {
    const weeks = Array.from(weeksMap.entries()).map(([weekKey, daysMap]) => {
      const dayGroups = Array.from(daysMap.entries()).map(([dayKey, dayItems]) => ({
        key: `day-${dayKey}`,
        label: formatWeekdayLabel(dayKey),
        count: dayItems.length,
        items: dayItems,
      }));
      const total = dayGroups.reduce((sum, g) => sum + g.count, 0);
      const firstDayKey = dayGroups[0]?.key?.replace(/^day-/, "") || weekKey;
      const lastDayKey = dayGroups[dayGroups.length - 1]?.key?.replace(/^day-/, "") || addDaysLocal(weekKey, 6);
      const idx = weekIndexInMonth(firstDayKey) || weekIndexInRange(weekKey, desde);
      return {
        key: `week-${monthKey}-${weekKey}`,
        label: weekKey === "sin-fecha"
          ? "Sin fecha"
          : currentWeek
            ? `Semana actual (${formatShortDateLabel(firstDayKey)} - ${formatShortDateLabel(lastDayKey)})`
            : `Semana ${idx || ""} (${formatShortDateLabel(firstDayKey)} - ${formatShortDateLabel(lastDayKey)})`,
        count: total,
        days: dayGroups,
      };
    }).filter(group => group.count > 0);
    const total = weeks.reduce((sum, g) => sum + g.count, 0);
    return {
      key: `month-${monthKey}`,
      label: formatMonthLabel(monthKey),
      count: total,
      weeks,
    };
  }).filter(group => group.count > 0);
}

// Module-level constant - NOT inside any function so webpack keeps it

// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Numeracion ordenes de carga ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function getOrdenCargaNumero(pedido, docControl) {
  return docControl?.orden_carga_numero || pedido?.orden_carga_numero || "";
}

function pedidoTieneFacturaFinal(pedido) {
  const facturaId = pedido?.factura_id && pedido.factura_id !== "null";
  const estadoFactura = String(pedido?.factura_estado || pedido?.estado_factura || "").toLowerCase();
  if (facturaId && estadoFactura && estadoFactura !== "borrador") return true;
  return Boolean(facturaId && pedido?.facturado);
}

function pedidoTieneFacturaBorrador(pedido) {
  const facturaId = pedido?.factura_id && pedido.factura_id !== "null";
  const estadoFactura = String(pedido?.factura_estado || pedido?.estado_factura || "").toLowerCase();
  return Boolean(facturaId && estadoFactura === "borrador");
}

function isFestivoConfirmError(err) {
  return err?.status === 409 && err?.data?.requiere_confirmacion && err?.data?.aviso_festivo;
}

async function confirmFestivoDestino(err) {
  const aviso = err?.data?.aviso_festivo || {};
  return confirmDialog({
    title: "Festivo en destino",
    message: `El destino esta en ${aviso.ccaa_label || aviso.ccaa || "la comunidad detectada"} y el ${aviso.fecha || "dia indicado"} figura como festivo (${aviso.festivo_nombre || "festivo"}).\n\nPara continuar debes leer y aceptar el aviso. Se notificara al gerente.`,
    confirmText: "He leido el aviso y acepto",
    cancelText: "Cancelar",
    tone: "warning",
  });
}

function buildPedidoDuplicado(pedido = {}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const clone = { ...pedido };
  [
    "id","numero","factura_id","factura_estado","factura_numero","facturado",
    "created_at","updated_at","orden_carga_numero","orden_carga_generada_at",
    "carta_porte_numero","carta_porte_generada_at","workflow_colaborador_enviado_at",
    "workflow_colaborador_confirmado_at","workflow_colaborador_cargado_at",
    "workflow_colaborador_en_camino_at","workflow_colaborador_descargado_at",
    "firma_entrega","firma_colaborador","albaranes","docs","eventos"
  ].forEach(k => { delete clone[k]; });
  return withPedidoGeoDefaults({
    ...clone,
    numero: "",
    estado: "pendiente",
    fecha_pedido: hoy,
    fecha_descarga: "",
    fecha_entrega: "",
    pendiente_completar: true,
    aviso_completar: "Pedido duplicado: completa fecha de descarga, revisa asignacion, precio y documentacion antes de guardar.",
    _duplicado: true,
    _readonly: false,
  });
}

const PEDIDOS_COLLAPSED_GROUPS_KEY = "tms_pedidos_collapsed_groups_v1";
const PEDIDOS_GROUP_BY_CLIENT_KEY = "tms_pedidos_group_by_client_v1";

function loadPedidosCollapsedGroups() {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PEDIDOS_COLLAPSED_GROUPS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function savePedidosCollapsedGroups(value) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PEDIDOS_COLLAPSED_GROUPS_KEY, JSON.stringify(value || {})); } catch {}
}

function pedidosGroupByClientKey(user) {
  const empresa = user?.empresa_id || user?.empresaId || "empresa";
  const usuario = user?.id || user?.email || user?.rol || "usuario";
  return `${PEDIDOS_GROUP_BY_CLIENT_KEY}:${empresa}:${usuario}`;
}

function loadPedidosGroupByClient(user) {
  if (typeof window === "undefined") return false;
  try {
    const saved = localStorage.getItem(pedidosGroupByClientKey(user));
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {}
  return false;
}

function savePedidosGroupByClient(user, value) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(pedidosGroupByClientKey(user), value ? "1" : "0"); } catch {}
}

function sumarDiasISO(fecha, dias) {
  if (!fecha) return "";
  const base = new Date(`${String(fecha).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return String(fecha).slice(0, 10);
  base.setDate(base.getDate() + Number(dias || 0));
  return base.toISOString().slice(0, 10);
}

function normalizarFechasCopia(fechaBase, copias, actuales = []) {
  const total = Math.max(1, Math.min(20, Number(copias || 1)));
  const base = String(fechaBase || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return Array.from({ length: total }, (_, idx) => {
    const current = String(actuales[idx] || "").slice(0, 10);
    return current || (idx === 0 ? base : "");
  });
}

function descargaAntesQueCarga(fechaCarga, fechaDescarga) {
  const carga = String(fechaCarga || "").slice(0, 10);
  const descarga = String(fechaDescarga || "").slice(0, 10);
  return Boolean(carga && descarga && descarga < carga);
}

function fileToPedidoDocBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(String(ev.target?.result || "").split(",")[1] || "");
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target?.result);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsArrayBuffer(file);
  });
}

function decodeDocumentBytes(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array();
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return Array.from(bytes).map(b => String.fromCharCode(b)).join("");
  }
}

function cleanExtractedDocumentText(text = "") {
  return String(text || "")
    .replace(/\0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  return cleanExtractedDocumentText(visible.length > 80 ? visible : fallback.slice(0, 12000));
}

async function prepareAiInboxFile(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const raw = decodeDocumentBytes(buffer);
  const lower = String(file.name || "").toLowerCase();
  const mediaType = file.type ||
    (lower.endsWith(".pdf") ? "application/pdf" :
     lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" :
     lower.endsWith(".png") ? "image/png" :
     lower.endsWith(".webp") ? "image/webp" :
     "application/octet-stream");
  let extractedText = "";
  let extractionStatus = "ok";
  if (mediaType.includes("pdf") || lower.endsWith(".pdf")) {
    extractedText = extractPdfTextHeuristic(raw);
    if (extractedText.length < 40) extractionStatus = "sin_texto_pdf";
  } else if (/\.(txt|eml|csv|xml|html?)$/i.test(lower) || /^text\//i.test(mediaType) || mediaType.includes("message")) {
    extractedText = cleanExtractedDocumentText(raw);
  } else if (/\.(docx|xlsx|jpg|jpeg|png|webp)$/i.test(lower) || /^image\//i.test(mediaType)) {
    extractedText = "";
    extractionStatus = "requiere_texto_manual";
  } else {
    extractedText = cleanExtractedDocumentText(raw.replace(/[^\x20-\x7E\n\r\t]/g, " "));
    if (extractedText.length < 40) extractionStatus = "texto_no_detectado";
  }
  return {
    name: file.name,
    mediaType,
    sizeKb: Math.round(file.size / 1024),
    base64: await fileToPedidoDocBase64(file),
    extractedText,
    extractionStatus,
  };
}

function inferPedidoDocTipo(nombre = "") {
  const lower = String(nombre || "").toLowerCase();
  if (lower.includes("cmr")) return "CMR";
  if (lower.includes("albar")) return "Albaran";
  if (lower.includes("descarga") || lower.includes("foto")) return "Foto descarga";
  if (lower.includes("pesaje") || lower.includes("bascula")) return "Pesaje";
  if (lower.includes("incid")) return "Incidencia";
  return "Otro";
}

function buildPedidoCopyPayload(basePedido = {}, overrides = {}) {
  const merged = { ...buildPedidoDuplicado(basePedido), ...overrides };
  if (merged.mantener_asignacion === false) {
    Object.assign(merged, {
      vehiculo_id: null,
      chofer_id: null,
      chofer2_id: null,
      remolque_id: null,
      remolque_id_manual: null,
      colaborador_id: null,
      precio_colaborador: null,
      matricula_colaborador: null,
      remolque_matricula_colaborador: null,
      coste_gasoil: 0,
    });
  }
  const {
    remolque_id_manual, _readonly, _aiCreado, colaborador_nombre,
    chofer_nombre, vehiculo_matricula, cliente_nombre, remolque_matricula,
    factura_numero, facturado, cliente_email, cliente_telefono,
    chofer2_nombre, remolque_id, mantener_asignacion, ...formClean
  } = merged;
  const descargaPendiente = !merged.fecha_descarga && !merged.fecha_entrega;
  const puntosDescargaCopy = normalizeStopsForCopy(merged.puntos_descarga, merged.destino, "descarga")
    .map(stop => descargaPendiente ? { ...stop, fecha:"" } : stop);
  const payload = sanitizePedidoPayload({
    ...formClean,
    importe: calcImporte(merged),
    puntos_carga: normalizeStopsForCopy(merged.puntos_carga, merged.origen, "carga"),
    puntos_descarga: puntosDescargaCopy,
    extracostes_importe: toFiniteNumber(merged.extracostes ?? merged.extracostes_importe, 0),
    importe_revision_combustible: calcRevisionCombustible(merged),
    importe_minimo: merged.tipo_precio === "viaje" ? toNullableNumber(merged.importe_minimo) : null,
    minimo_unidades: merged.tipo_precio !== "viaje" ? toNullableNumber(merged.minimo_unidades) : null,
    importe_paralizacion: toNullableNumber(merged.importe_paralizacion),
    paralizacion_horas: toNullableNumber(merged.paralizacion_horas),
  });
  if (remolque_id_manual !== undefined) payload.remolque_id = remolque_id_manual || null;
  if (payload.colaborador_id) payload.coste_gasoil = 0;
  return payload;
}

function buildPedidoReschedulePayload(basePedido = {}, offsetDays = 1, overrides = {}) {
  const fechaCargaBase = basePedido?.fecha_carga || new Date().toISOString().slice(0, 10);
  const fechaDescargaBase = basePedido?.fecha_descarga || fechaCargaBase;
  const cargaNorm = String(fechaCargaBase).slice(0, 10);
  const descargaNorm = String(fechaDescargaBase).slice(0, 10);
  const diferenciaDias = Math.round(
    (new Date(`${descargaNorm}T00:00:00`) - new Date(`${cargaNorm}T00:00:00`)) / 86400000
  );
  const nextFechaCarga = sumarDiasISO(cargaNorm, offsetDays);
  const nextFechaDescarga = sumarDiasISO(nextFechaCarga, Number.isFinite(diferenciaDias) ? diferenciaDias : 0);
  return sanitizePedidoPayload({
    ...basePedido,
    ...overrides,
    fecha_carga: nextFechaCarga,
    fecha_descarga: nextFechaDescarga,
    pendiente_completar: true,
    aviso_completar: `Viaje reprogramado desde pedidos: revisar horarios, asignacion y compromiso con el cliente.`,
    importe: calcImporte(basePedido),
    puntos_carga: parseStops(basePedido?.puntos_carga),
    puntos_descarga: parseStops(basePedido?.puntos_descarga),
    extracostes_importe: toFiniteNumber(basePedido?.extracostes ?? basePedido?.extracostes_importe, 0),
    importe_revision_combustible: calcRevisionCombustible(basePedido),
    importe_minimo: basePedido?.tipo_precio === "viaje" ? toNullableNumber(basePedido?.importe_minimo) : null,
    minimo_unidades: basePedido?.tipo_precio !== "viaje" ? toNullableNumber(basePedido?.minimo_unidades) : null,
    importe_paralizacion: toNullableNumber(basePedido?.importe_paralizacion),
    paralizacion_horas: toNullableNumber(basePedido?.paralizacion_horas),
  });
}

function mergePrimaryStopSchedule(stops, { fecha, hora, ventana } = {}) {
  const parsed = parseStops(stops);
  if (!parsed.length) return parsed;
  return parsed.map((stop, idx) => idx === 0 ? {
    ...stop,
    fecha: stop.fecha || fecha || "",
    hora: stop.hora || hora || "",
    ventana: stop.ventana || ventana || "",
  } : stop);
}

function buildPedidoUpdatePayload(basePedido = {}, overrides = {}) {
  const merged = normalizePedidoTarifaDraft({ ...basePedido, ...overrides });
  const geoMerged = withPedidoGeoDefaults(merged);
  const {
    remolque_id_manual, _readonly, _aiCreado, _ai_docs, _ai_meta, _duplicado, _focus_asignacion,
    colaborador_nombre, chofer_nombre, vehiculo_matricula, cliente_nombre, remolque_matricula,
    factura_numero, factura_estado, factura_id,
    facturado, cliente_email, cliente_telefono,
    chofer2_nombre, remolque_id,
    created_at, updated_at, eventos, docs, albaranes,
    workflow_colaborador_enviado_at, workflow_colaborador_confirmado_at,
    workflow_colaborador_cargado_at, workflow_colaborador_en_camino_at,
    workflow_colaborador_descargado_at,
    ...formClean
  } = merged;
  const payload = sanitizePedidoPayload({
    ...formClean,
    origen_pais: geoMerged.origen_pais,
    origen_provincia: geoMerged.origen_provincia || null,
    destino_pais: geoMerged.destino_pais,
    destino_provincia: geoMerged.destino_provincia || null,
    cmr_tipo: cmrTypeForPedidoStops(geoMerged),
    importe: calcImporte(merged),
    precio_colaborador: merged.colaborador_id ? (importeColaboradorCalculado(merged) || merged.precio_colaborador || null) : merged.precio_colaborador,
    puntos_carga: mergePrimaryStopSchedule(geoMerged.puntos_carga, {
      fecha: geoMerged.fecha_carga,
      hora: geoMerged.hora_carga,
      ventana: geoMerged.ventana_carga,
    }),
    puntos_descarga: mergePrimaryStopSchedule(geoMerged.puntos_descarga, {
      fecha: geoMerged.fecha_descarga || geoMerged.fecha_entrega,
      hora: geoMerged.hora_descarga,
      ventana: geoMerged.ventana_descarga,
    }),
    extracostes_importe: toFiniteNumber(merged.extracostes ?? merged.extracostes_importe, 0),
    importe_revision_combustible: calcRevisionCombustible(merged),
    importe_minimo: merged.tipo_precio === "viaje" ? toNullableNumber(merged.importe_minimo) : null,
    minimo_unidades: merged.tipo_precio !== "viaje" ? toNullableNumber(merged.minimo_unidades) : null,
    importe_paralizacion: toNullableNumber(merged.importe_paralizacion),
    paralizacion_horas: toNullableNumber(merged.paralizacion_horas),
  });
  if (remolque_id_manual !== undefined) payload.remolque_id = remolque_id_manual || null;
  if (payload.colaborador_id) {
    payload.vehiculo_id = null;
    payload.chofer_id = null;
    payload.chofer2_id = null;
    payload.remolque_id = null;
    payload.coste_gasoil = 0;
  }
  if (_ai_meta && typeof _ai_meta === "object") {
    payload.ai_metadata = _ai_meta;
  }
  return payload;
}

const PEDIDOS_CRITICAL_ALERTS_STORAGE_KEY = "tms_pedidos_critical_alerts_read";

function loadReadPedidoAlerts() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PEDIDOS_CRITICAL_ALERTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildPedidoCriticalAlertKey(item) {
  const pedido = item?.pedido || {};
  const meta = item?.meta || item?.priorityMeta || {};
  const flags = meta?.flags || {};
  const reasons = Array.isArray(meta?.reasons) ? meta.reasons.map(r => r?.key || r?.label || "").filter(Boolean).sort().join("|") : "";
  const issues = Array.isArray(meta?.validationIssues) ? meta.validationIssues.slice().sort().join("|") : "";
  return [
    pedido?.id || pedido?.numero || "pedido",
    flags.overdueAssignment ? "overdue" : "",
    flags.urgentAssignment ? "urgent" : "",
    flags.missingVehiculo ? "vehiculo" : "",
    flags.missingChofer ? "chofer" : "",
    reasons,
    issues,
  ].filter(Boolean).join("::");
}

const ESTADOS_RAW = ["pendiente","confirmado","en_curso","descarga","entregado","cancelado","incidencia"];
const LABEL_ESTADO = {
  pendiente:"Pendiente", confirmado:"Confirmado", en_curso:"En curso",
  descarga:"En descarga", entregado:"Entregado", cancelado:"Cancelado", incidencia:"Incidencia"
};
const COLOR_ESTADO = {
  pendiente:"#fb8c3a", confirmado:"#3b6ef5", en_curso:"#22d3ee",
  descarga:"#a78bfa", entregado:"var(--green)", cancelado:"#f05252", incidencia:"#fbbf24"
};
const TIPOS_PRECIO = [
  { v:"viaje",    l:"Precio por viaje (EUR fijo)" },
  { v:"kg",       l:"Por kg (EUR/100kg)" },
  { v:"tonelada", l:"Por toneladas (EUR/tn)" },
  { v:"km",       l:"Por kilometro (EUR/km)" },
  { v:"hora",     l:"Por hora (EUR/h)" },
  { v:"palet",    l:"Por palet (EUR/palet)" },
];
const S = {
  page:{flex:1,padding:"34px 36px",minHeight:"100vh",background:"linear-gradient(180deg,#f8fbfd 0%,#ffffff 45%,#f7fafc 100%)",boxSizing:"border-box",minWidth:0,width:"100%"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:36,fontWeight:900,marginBottom:16,color:"#0f172a"},
  bar:{display:"flex",gap:12,marginBottom:18,alignItems:"center",flexWrap:"wrap"},
  btn:{padding:"10px 16px",borderRadius:8,border:"1px solid #dbe5ec",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:6,background:"#fff",color:"#0f172a"},
  card:{background:"rgba(255,255,255,.96)",border:"1px solid #dbe5ec",borderRadius:12,overflow:"hidden",boxShadow:"0 12px 30px rgba(15,23,42,.055)"},
  th:{textAlign:"left",padding:"13px 16px",fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"#64748b",borderBottom:"1px solid #dbe5ec",background:"#f8fbfd",whiteSpace:"nowrap"},
  td:{padding:"13px 16px",borderBottom:"1px solid #e2e8f0",fontSize:14,color:"#0f172a",verticalAlign:"middle"},
  input:{background:"#fff",border:"1px solid #cfdbe5",color:"#0f172a",padding:"11px 14px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"},
  sel:{background:"#fff",border:"1px solid #cfdbe5",color:"#0f172a",padding:"11px 14px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  mbox:{background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border2)",borderRadius:8,padding:"clamp(14px,3vw,28px)",width:"100%",maxWidth:720,boxSizing:"border-box",maxHeight:"92vh",overflowY:"auto",overflowX:"hidden",overflowAnchor:"none",position:"relative"},
  label:{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:5,marginTop:12},
  sec:{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".1em",color:"var(--accent)",marginTop:20,marginBottom:8,paddingBottom:6,borderBottom:"1px solid var(--border)"},
};

function Badge({ estado }) {
  const c = COLOR_ESTADO[estado] || "var(--text2)";
  return <span style={{display:"inline-flex",alignItems:"center",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:`${c}1a`,color:c}}>{LABEL_ESTADO[estado]||estado}</span>;
}

function toDateInputValue(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function buildPedidoCargaDate(pedido) {
  const fecha = toDateInputValue(pedido?.fecha_carga);
  if (!fecha) return null;
  const hora = String(pedido?.hora_carga || "00:00").slice(0, 5);
  const dt = new Date(`${fecha}T${hora}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getPedidoOperationalFlags(pedido, now = new Date()) {
  const cargaAt = buildPedidoCargaDate(pedido);
  const diffHours = cargaAt ? (cargaAt.getTime() - now.getTime()) / 3600000 : null;
  const hasCollaborator = Boolean(pedido?.colaborador_id || pedido?.colaborador_nombre);
  const missingVehiculo = !pedido?.vehiculo_id && !hasCollaborator;
  const missingChofer = !pedido?.chofer_id && !hasCollaborator;
  const missingAssignment = missingVehiculo || missingChofer;
  const overdueAssignment = missingAssignment && diffHours !== null && diffHours < 0;
  const urgentAssignment = missingAssignment && diffHours !== null && diffHours >= 0 && diffHours <= 24;
  return { missingVehiculo, missingChofer, missingAssignment, overdueAssignment, urgentAssignment, diffHours };
}

function getPedidoStateValidationIssues(pedido, targetEstado = "") {
  const estado = String(targetEstado || pedido?.estado || "").toLowerCase();
  const issues = [];
  const hasCollaborator = Boolean(pedido?.colaborador_id || pedido?.colaborador_nombre);
  const needsOperationalData = ["confirmado", "en_curso", "descarga", "entregado"].includes(estado);
  const needsDeliveryData = ["descarga", "entregado"].includes(estado);
  if (!toDateInputValue(pedido?.fecha_carga)) issues.push("Falta fecha de carga");
  if (needsOperationalData) {
    if (!String(pedido?.origen || "").trim()) issues.push("Falta origen");
    if (!String(pedido?.destino || "").trim()) issues.push("Falta destino");
    if (!hasCollaborator && !pedido?.vehiculo_id) issues.push("Falta vehiculo");
    if (!hasCollaborator && !pedido?.chofer_id) issues.push("Falta chofer");
  }
  if (needsDeliveryData && !toDateInputValue(pedido?.fecha_descarga || pedido?.fecha_entrega)) issues.push("Falta fecha de descarga");
  return issues;
}

function getPedidoPriorityMeta(pedido, now = new Date()) {
  const flags = getPedidoOperationalFlags(pedido, now);
  const validationIssues = getPedidoStateValidationIssues(pedido, pedido?.estado);
  const reasons = [
    flags.overdueAssignment ? { key:"overdue", label:"Vencido", tone:"danger" } : null,
    !flags.overdueAssignment && flags.urgentAssignment ? { key:"urgent", label:"Urgente", tone:"warning" } : null,
    validationIssues.length ? { key:"data", label:"Datos pendientes", tone:"warning" } : null,
  ].filter(Boolean);
  const severity =
    (flags.overdueAssignment ? 220 : flags.urgentAssignment ? 120 : 0) +
    (validationIssues.length ? 70 : 0) +
    (typeof flags.diffHours === "number" ? Math.max(0, 36 - Math.round(flags.diffHours)) : 0);
  return { flags, validationIssues, reasons, severity };
}
function calcImporte(form) {
  const toNum = parseLocaleNumber;
  const precio  = toNum(form.precio_unitario, 0);
  const cant    = toNum(form.cantidad, 0);
  const extra   = toNum(form.extracostes ?? form.extracostes_importe, 0);
  const descargasExtra = sumAdditionalDescargaPrices(form.puntos_descarga);
  const minEur  = toNum(form.importe_minimo, 0);
  const minUnits = toNum(form.minimo_unidades, 0);
  const units = minUnits > 0 ? Math.max(cant, minUnits) : cant;
  let base = 0;
  if (form.tipo_precio === "viaje") base = precio;
  else if (form.tipo_precio === "kg") base = (units / 100) * precio;
  else base = precio * units;
  if (form.tipo_precio === "viaje" && minEur > 0) base = Math.max(base, minEur);
  const total = base + extra + descargasExtra;
  const safeTotal = Number.isFinite(total) ? total : 0;
  return safeTotal;
}

function buildClienteRiesgoPedidoAvisos(riesgo = null, importeNuevo = 0) {
  if (!riesgo) return { avisos: [], nivel: "ok", total_proyectado: 0, riesgo_pct_actual: null, riesgo_pct_proyectado: null, requiere_confirmacion: false };
  const pendiente = Number(riesgo.total_pendiente || 0) || 0;
  const limite = Number(riesgo.limite_riesgo || 0) || 0;
  const nuevo = Math.max(0, Number(importeNuevo || 0) || 0);
  const totalProyectado = pendiente + nuevo;
  const pctActualApi = parseLocaleNumber(riesgo.riesgo_pct, NaN);
  const pctActual = Number.isFinite(pctActualApi)
    ? Math.round(pctActualApi * 10) / 10
    : limite > 0 ? Math.round((pendiente / limite) * 1000) / 10 : null;
  const pctProyectado = limite > 0 ? Math.round((totalProyectado / limite) * 1000) / 10 : null;
  const avisos = Array.isArray(riesgo.avisos) ? [...riesgo.avisos] : [];
  if (limite > 0 && pctProyectado !== null && nuevo > 0) {
    if (pctProyectado >= 100 && !avisos.some(a => a.tipo === "limite_riesgo_proyectado_critico")) {
      avisos.push({ tipo: "limite_riesgo_proyectado_critico", nivel: "critico", mensaje: `Con este pedido el cliente superaria el limite de riesgo (${pctProyectado.toFixed(1)}%).` });
    } else if (pctProyectado >= 80 && !avisos.some(a => a.tipo === "limite_riesgo_proyectado_alto")) {
      avisos.push({ tipo: "limite_riesgo_proyectado_alto", nivel: "alto", mensaje: `Con este pedido el cliente quedaria cerca del limite de riesgo (${pctProyectado.toFixed(1)}%).` });
    }
  }
  const nivel = avisos.some(a => a.nivel === "critico") ? "critico"
    : avisos.some(a => a.nivel === "alto") ? "alto"
      : avisos.some(a => a.nivel === "medio") ? "medio"
        : "ok";
  return {
    avisos,
    nivel,
    total_proyectado: totalProyectado,
    riesgo_pct_actual: pctActual,
    riesgo_pct_proyectado: pctProyectado,
    requiere_confirmacion: avisos.length > 0,
  };
}

function formatRiskPct(pct) {
  const n = Number(pct);
  return Number.isFinite(n) ? `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%` : "Sin limite";
}

function riskPctValue(riesgoPedido = {}) {
  const projected = Number(riesgoPedido?.riesgo_pct_proyectado);
  if (Number.isFinite(projected)) return projected;
  const actual = Number(riesgoPedido?.riesgo_pct_actual);
  return Number.isFinite(actual) ? actual : 0;
}

function isRiskConfirmationFresh(ref, clienteId, riesgoPedido = {}) {
  if (!clienteId || !ref?.current) return false;
  const confirmedPct = Number(ref.current.get(String(clienteId)) || -1);
  return confirmedPct >= riskPctValue(riesgoPedido) - 0.1;
}

function markRiskConfirmed(ref, clienteId, riesgoPedido = {}) {
  if (!clienteId || !ref?.current) return;
  const key = String(clienteId);
  const prev = Number(ref.current.get(key) || -1);
  ref.current.set(key, Math.max(prev, riskPctValue(riesgoPedido)));
}

function truthyFlag(value) {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true";
}

function userCanOverrideClienteRisk(user) {
  return String(user?.rol || "").toLowerCase() === "gerente";
}

function clienteCreationBlock(cliente = null, riesgoPedido = null, user = null) {
  if (cliente && truthyFlag(cliente.bloqueado)) {
    const motivo = String(cliente.bloqueo_motivo || "").trim() || "Sin motivo indicado";
    return {
      type: "manual",
      title: "Cliente bloqueado",
      message: `No se puede crear el viaje para este cliente. Motivo: ${motivo}`,
    };
  }
  const pct = Number(riesgoPedido?.riesgo_pct_proyectado);
  if (Number.isFinite(pct) && pct >= 100 && !userCanOverrideClienteRisk(user)) {
    return {
      type: "riesgo",
      title: "Cliente en limite de riesgo",
      message: "No se pueden grabar mas viajes para este cliente porque supera el limite de riesgo. Solo gerencia puede autorizarlo.",
    };
  }
  return null;
}

function unidadesFacturablesPedido(form, minOverride = form?.minimo_unidades) {
  const tipo = String(form?.tipo_precio || "viaje");
  if (tipo === "viaje") return 1;
  const cantidad = parseLocaleNumber(form?.cantidad, NaN);
  const sugerida = parseLocaleNumber(cantidadSugeridaPorTipo(form, tipo), NaN);
  const base = Number.isFinite(cantidad) && cantidad > 0 ? cantidad : (Number.isFinite(sugerida) ? sugerida : 0);
  const minUnits = parseLocaleNumber(minOverride, 0);
  return Math.max(base, Number.isFinite(minUnits) ? minUnits : 0);
}

function importeClienteColCalculado(form) {
  const importe = calcImporte(form);
  return importe > 0 ? Number(importe.toFixed(2)) : "";
}

function precioKmPedidoInfo(form) {
  const km = parseLocaleNumber(form?.km_ruta || form?.km, 0);
  const importe = calcImporte(form);
  if (!Number.isFinite(km) || km <= 0) return { value: null, label: "-", hint: "Faltan km de ruta" };
  if (!Number.isFinite(importe) || importe <= 0) return { value: null, label: "-", hint: "Falta precio del viaje" };
  const value = importe / km;
  return {
    value,
    label: `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR/km`,
    hint: `${importe.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR / ${km.toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`,
  };
}

function importeColaboradorCalculado(form) {
  const unit = parseLocaleNumber(form?.precio_colaborador_unitario, NaN);
  if (Number.isFinite(unit) && unit > 0 && form?.tipo_precio !== "viaje") {
    const unidades = unidadesFacturablesPedido(form, form?.minimo_colaborador_unidades);
    const total = unit * unidades;
    return Number.isFinite(total) && total > 0 ? Number(total.toFixed(2)) : "";
  }
  const totalManual = parseLocaleNumber(form?.precio_colaborador, NaN);
  return Number.isFinite(totalManual) && totalManual > 0 ? Number(totalManual.toFixed(2)) : "";
}

function syncPrecioColaboradorCalc(draft) {
  if (!draft?.colaborador_id) return draft;
  const total = importeColaboradorCalculado(draft);
  return total ? { ...draft, precio_colaborador: total } : draft;
}

function getPagoColaboradorPorTonelada(form) {
  if (!form?.colaborador_id || String(form?.tipo_precio || "") !== "tonelada") return null;
  const unitarioManual = parseLocaleNumber(form?.precio_colaborador_unitario, NaN);
  const minimoToneladasManual = parseLocaleNumber(form?.minimo_colaborador_unidades, NaN);
  const minimoToneladasPedido = parseLocaleNumber(form?.minimo_unidades, NaN);
  if (!Number.isFinite(unitarioManual) || unitarioManual <= 0) return null;
  const minimoToneladas = Number.isFinite(minimoToneladasManual) && minimoToneladasManual > 0
    ? minimoToneladasManual
    : (Number.isFinite(minimoToneladasPedido) && minimoToneladasPedido > 0 ? minimoToneladasPedido : 0);
  const toneladasFacturables = unidadesFacturablesPedido(form, minimoToneladas);
  if (!Number.isFinite(minimoToneladas) || minimoToneladas <= 0 || !Number.isFinite(toneladasFacturables) || toneladasFacturables <= 0) return null;
  const total = unitarioManual * toneladasFacturables;
  return {
    precioTonelada: unitarioManual,
    minimoToneladas,
    toneladasFacturables,
    total: Number.isFinite(total) ? Number(total.toFixed(2)) : 0,
  };
}

function getPagoColaboradorTotalCerrado(form) {
  if (!form?.colaborador_id && !form?.colaborador_nombre) return null;
  const total = parseLocaleNumber(form?.precio_colaborador, NaN);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (String(form?.tipo_precio || "") === "tonelada" && getPagoColaboradorPorTonelada(form)) return null;
  return { total: Number(total.toFixed(2)) };
}

function syncPrecioClienteCol(draft) {
  if (!draft?.colaborador_id) return draft;
  const importe = importeClienteColCalculado(draft);
  return syncPrecioColaboradorCalc({ ...draft, precio_cliente_col: importe || draft.precio_cliente_col || "" });
}

function calcRevisionCombustible(form) {
  const pct = Number(form?.recargo_combustible_pct || 0);
  const precioBase = Number(form?.precio_base_sin_combustible || 0);
  if (!Number.isFinite(pct) || pct <= 0 || !Number.isFinite(precioBase) || precioBase <= 0) return 0;
  const totalConRevision = calcImporte(form);
  const totalSinRevision = calcImporte({ ...form, precio_unitario: precioBase });
  const revision = totalConRevision - totalSinRevision;
  return Number.isFinite(revision) && revision > 0 ? Math.round(revision * 100) / 100 : 0;
}

function toFiniteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = parseLocaleNumber(value, NaN);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = parseLocaleNumber(value, NaN);
  return Number.isFinite(n) ? n : null;
}

function cantidadSugeridaPorTipo(form, tipo = form?.tipo_precio) {
  if (!tipo || tipo === "viaje") return "";
  if (tipo === "kg") return parseLocaleNumber(form?.peso_kg || form?.kg, 0) || "";
  if (tipo === "tonelada") {
    const peso = parseLocaleNumber(form?.peso_kg || form?.kg, 0);
    const toneladas = peso > 0 && peso < 1000 ? peso : peso / 1000;
    return toneladas ? Number(toneladas.toFixed(3)) : "";
  }
  if (tipo === "km") return parseLocaleNumber(form?.km_ruta || form?.km, 0) || "";
  if (tipo === "palet") return parseLocaleNumber(form?.bultos, 0) || "";
  return parseLocaleNumber(form?.cantidad, 0) || "";
}

function normalizeMinimoUnidadesRuta(ruta = {}, tarifaTipo = ruta?.tarifa_tipo) {
  const raw = ruta.minimo_unidades ?? ruta.minimo_facturable ?? "";
  const value = parseLocaleNumber(raw, NaN);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (tarifaTipo === "tonelada" && value >= 1000) {
    return Number((value / 1000).toFixed(3));
  }
  return value;
}

function routeTarifaMatchesDraft(ruta = {}, draft = {}) {
  const tipoRuta = String(ruta.tarifa_tipo || "viaje");
  const tipoDraft = String(draft.tipo_precio || "viaje");
  if (tipoRuta !== tipoDraft) return false;
  const precioRuta = parseLocaleNumber(ruta.precio_base ?? ruta.precio, NaN);
  const precioDraft = parseLocaleNumber(draft.precio_unitario, NaN);
  if (Number.isFinite(precioRuta) && precioRuta > 0 && Number.isFinite(precioDraft) && precioDraft > 0) {
    const diffPct = Math.abs(precioRuta - precioDraft) / Math.max(precioRuta, precioDraft);
    if (diffPct > 0.05) return false;
  }
  const minRuta = normalizeMinimoUnidadesRuta(ruta, tipoRuta);
  const minDraft = parseLocaleNumber(draft.minimo_unidades, NaN);
  if (tipoRuta !== "viaje" && Number.isFinite(minDraft) && minDraft > 0 && minRuta) {
    const diff = Math.abs(Number(minRuta) - minDraft);
    if (diff > 0.01) return false;
  }
  return true;
}

function formatRutaTarifaLabel(ruta = {}) {
  const tipos = { viaje:"EUR/viaje", kg:"EUR/100kg", tonelada:"EUR/tn", km:"EUR/km", hora:"EUR/h", palet:"EUR/palet" };
  const precio = parseLocaleNumber(ruta.precio_base ?? ruta.precio, 0);
  const minimo = normalizeMinimoUnidadesRuta(ruta, ruta.tarifa_tipo);
  const recargo = parseLocaleNumber(ruta.recargo_combustible_pct, 0);
  return [
    `${ruta.origen || "Origen"} -> ${ruta.destino || "Destino"}`,
    precio > 0 ? `${precio.toLocaleString("es-ES", { maximumFractionDigits: 4 })} ${tipos[ruta.tarifa_tipo] || ruta.tarifa_tipo || "EUR/viaje"}` : "sin precio",
    ruta.km ? `${ruta.km} km` : "",
    minimo ? `min. ${minimo}` : "",
    recargo ? `+${recargo.toLocaleString("es-ES")} % gasoil` : "",
  ].filter(Boolean).join(" | ");
}

const NUMERIC_PEDIDO_FIELDS = new Set([
  "peso_kg", "bultos", "importe", "km_ruta", "km_vacio", "volumen",
  "cantidad", "precio_unitario", "extracostes_importe",
  "tipo_iva",
  "precio_base_sin_combustible", "recargo_combustible_pct", "importe_revision_combustible",
  "precio_cliente_col", "precio_colaborador", "precio_colaborador_unitario", "minimo_colaborador_unidades", "reparto_chofer1",
  "coste_gasoil", "coste_peajes", "coste_dietas", "coste_otros",
  "importe_minimo", "minimo_unidades", "importe_paralizacion",
  "paralizacion_horas",
]);
const DATE_PEDIDO_FIELDS = new Set(["fecha_pedido", "fecha_carga", "fecha_entrega", "fecha_descarga", "firma_fecha"]);
const TIME_PEDIDO_FIELDS = new Set(["hora_carga", "hora_descarga"]);
const UUID_PEDIDO_FIELDS = new Set(["cliente_id", "ruta_id", "vehiculo_id", "chofer_id", "chofer2_id", "colaborador_id", "remolque_id"]);

function normalizeStrictDateInput(value) {
  if (value === "" || value === null || value === undefined) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return false;
  return raw;
}

function isValidPedidoDateInput(value) {
  return normalizeStrictDateInput(value) !== false;
}

function assertValidPedidoDates(source = {}) {
  for (const field of DATE_PEDIDO_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field) && !isValidPedidoDateInput(source[field])) {
      throw new Error("Revisa las fechas. Usa el selector de fecha o el formato AAAA-MM-DD.");
    }
  }
}

function normalizePesoKgInput(value) {
  if (value === null || value === undefined) return value;
  const raw = String(value).trim().replace(/\s+/g, "");
  if (!raw) return null;
  const kg = parseLocaleNumber(raw, NaN);
  if ((raw.includes(",") || raw.includes(".")) && Number.isFinite(kg) && kg > 0 && kg < 1000) return Math.round(kg * 1000);
  return Number.isFinite(kg) ? kg : null;
}

function parseLocaleNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  let raw = String(value).trim().replace(/\s+/g, "");
  if (!raw) return fallback;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    raw = raw.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3}){2,}$/.test(raw)) {
    raw = raw.replace(/\./g, "");
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function compactNumberInput(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = parseLocaleNumber(value, NaN);
  if (!Number.isFinite(n)) return value;
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

function normalizePedidoTarifaDraft(draft = {}) {
  const tipo = draft.tipo_precio || "viaje";
  const next = {
    ...draft,
    tipo_iva: draft.tipo_iva ?? 21,
    iva_regimen: draft.iva_regimen || ivaOptionValue(draft),
  };
  for (const key of ["puntos_carga", "puntos_descarga"]) {
    const stops = parseStops(next[key]);
    if (stops.length) {
      next[key] = stops.map(stop => {
        const rawMaps = String(stop?.google_maps_url || stop?.googleMapsUrl || stop?.maps_url || "").trim();
        if (!rawMaps || /^(https?:\/\/|geo:)/i.test(rawMaps)) return stop;
        return { ...stop, google_maps_url: "", notas: stop.notas || rawMaps };
      });
    }
  }
  if (tipo === "tonelada") {
    const minUnits = parseLocaleNumber(next.minimo_unidades, NaN);
    if (Number.isFinite(minUnits) && Math.abs(minUnits) >= 1000) {
      next.minimo_unidades = Number((minUnits / 1000).toFixed(3));
    }
    const minColUnits = parseLocaleNumber(next.minimo_colaborador_unidades, NaN);
    if (Number.isFinite(minColUnits) && Math.abs(minColUnits) >= 1000) {
      next.minimo_colaborador_unidades = Number((minColUnits / 1000).toFixed(3));
    }
    const cantidad = parseLocaleNumber(next.cantidad, NaN);
    const peso = parseLocaleNumber(next.peso_kg || next.kg, NaN);
    if (Number.isFinite(peso) && peso > 0 && (!Number.isFinite(cantidad) || cantidad <= 0 || (cantidad < 1 && peso >= 1000))) {
      next.cantidad = peso < 1000 ? peso : Number((peso / 1000).toFixed(3));
    }
  }
  return next;
}

function sanitizePedidoPayload(payload) {
  const out = {...payload};
  Object.entries(out).forEach(([key, value]) => {
    if (value === "") {
      out[key] = null;
      return;
    }
    if (UUID_PEDIDO_FIELDS.has(key) && value !== null && value !== undefined) {
      const raw = String(value).trim();
      out[key] = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
      return;
    }
    if (DATE_PEDIDO_FIELDS.has(key) && value !== null && value !== undefined) {
      const normalizedDate = normalizeStrictDateInput(value);
      if (normalizedDate === false) throw new Error("Revisa las fechas. Usa el selector de fecha o el formato AAAA-MM-DD.");
      out[key] = normalizedDate;
      return;
    }
    if (TIME_PEDIDO_FIELDS.has(key) && value !== null && value !== undefined) {
      const raw = String(value).trim();
      const match = raw.match(/(\d{2}:\d{2})/);
      if (match) {
        out[key] = match[1];
      } else {
        const parsed = new Date(raw);
        out[key] = Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(11, 16);
      }
      return;
    }
    if (NUMERIC_PEDIDO_FIELDS.has(key) && value !== null && value !== undefined) {
      const n = key === "peso_kg" ? normalizePesoKgInput(value) : parseLocaleNumber(value, NaN);
      out[key] = Number.isFinite(n) ? (key === "bultos" ? Math.max(0, Math.round(n)) : n) : null;
    }
  });
  return out;
}

function normalizePesoKgDraft(draft = {}) {
  const normalized = normalizePesoKgInput(draft.peso_kg ?? draft.kg);
  if (!Number.isFinite(normalized)) return draft;
  const next = { ...draft, peso_kg: normalized };
  if (String(next.tipo_precio || "") === "tonelada") {
    const toneladas = normalized < 1000 ? normalized : Number((normalized / 1000).toFixed(3));
    next.cantidad = toneladas || next.cantidad || "";
  }
  return syncPrecioClienteCol(syncPrecioColaboradorCalc(next));
}

function precioGasoilDefault() {
  try {
    const empresaCfg = (typeof window !== "undefined" && window.__TMS_EMPRESA_CONFIG && typeof window.__TMS_EMPRESA_CONFIG === "object")
      ? window.__TMS_EMPRESA_CONFIG
      : {};
    const cfg = empresaCfg?.cfg_precios?.combustible || empresaCfg?.cfg_precios?.gasoil || {};
    return Number(cfg.precio_fijo || cfg.precio_litro || 1.45);
  } catch { return 1.45; }
}

function consumoLitros100PorPeso(pesoKg) {
  const toneladas = Math.max(0, parseLocaleNumber(pesoKg, 0) / 1000);
  return Math.round((20 + (Math.min(toneladas, 30) * 7 / 24)) * 10) / 10;
}

function calcularCosteGasoil(form) {
  const km = parseLocaleNumber(form.km_ruta, 0);
  if (!km) return "";
  const litros = km * consumoLitros100PorPeso(form.peso_kg) / 100;
  return Math.round(litros * precioGasoilDefault() * 100) / 100;
}

function parseStops(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function formatPedidoListDate(value) {
  if (!value) return "";
  const raw = String(value).slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString("es-ES");
}

function formatPedidoListTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : raw;
}

function pedidoStopsForList(pedido = {}, tipo = "carga") {
  const isCarga = tipo === "carga";
  const parsed = parseStops(isCarga ? pedido.puntos_carga : pedido.puntos_descarga);
  const fallback = {
    direccion: isCarga ? pedido.origen : pedido.destino,
    fecha: isCarga ? pedido.fecha_carga : (pedido.fecha_descarga || pedido.fecha_entrega),
    hora: isCarga ? pedido.hora_carga : pedido.hora_descarga,
    ventana: isCarga ? pedido.ventana_carga : pedido.ventana_descarga,
  };
  if (!parsed.length) return [fallback];
  return parsed.map((stop, index) => ({
    ...stop,
    direccion: stopAddress(stop) || (index === 0 ? fallback.direccion : ""),
    fecha: stop.fecha || stop.fecha_carga || stop.fecha_descarga || (index === 0 ? fallback.fecha : ""),
    hora: stop.hora || stop.hora_carga || stop.hora_descarga || (index === 0 ? fallback.hora : ""),
    ventana: stop.ventana || stop.ventana_carga || stop.ventana_descarga || (index === 0 ? fallback.ventana : ""),
  }));
}

function pedidoStopMeta(stop = {}) {
  const fecha = formatPedidoListDate(stop.fecha);
  const hora = formatPedidoListTime(stop.hora);
  const ventana = String(stop.ventana || "").trim();
  return [fecha, hora, ventana ? `Ventana ${ventana}` : ""].filter(Boolean).join(" | ");
}

function normalizeStopsForCopy(stops, fallbackAddress = "", tipo = "carga") {
  const parsed = parseStops(stops)
    .map((stop, idx) => {
      const direccion = String(stop?.direccion || stop?.address || stop?.lugar || (idx === 0 ? fallbackAddress : "") || "").trim();
      const googleMapsUrl = cleanMapsUrl(stop?.google_maps_url || stop?.googleMapsUrl || stop?.maps_url || stop?.metadata?.google_maps_url || "");
      const mapsCoords = coordsFromMapsUrl(googleMapsUrl);
      const lat = stop?.lat ?? stop?.latitud ?? stop?.metadata?.lat ?? mapsCoords?.lat ?? null;
      const lng = stop?.lng ?? stop?.longitud ?? stop?.metadata?.lng ?? mapsCoords?.lng ?? null;
      return { ...stop, direccion, google_maps_url: googleMapsUrl, lat, lng };
    })
    .filter(stop => stop.direccion || stop.google_maps_url || (stop.lat != null && stop.lng != null));
  if (!parsed.length && fallbackAddress) parsed.push({ direccion: fallbackAddress, cliente_nombre: "", google_maps_url: "", tipo });
  const seen = new Set();
  return parsed.filter(stop => {
    const key = [
      normalizePlaceText(stop.direccion || stop.address || ""),
      String(stop.google_maps_url || "").trim().toLowerCase(),
      stop.lat ?? "",
      stop.lng ?? "",
    ].join("|");
    if (!key.replace(/\|/g, "") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function legacyPuntosInteresLoad() {
  try { return JSON.parse(localStorage.getItem("tms_puntos_interes") || "[]"); }
  catch { return []; }
}

function setPuntosInteresCache(next, { broadcast = true } = {}) {
  puntosInteresCache = Array.isArray(next) ? next.slice(-200) : [];
  if (typeof window !== "undefined") {
    window.__TMS_PUNTOS_INTERES = puntosInteresCache;
    if (broadcast) window.dispatchEvent(new Event("tms:puntos-interes"));
  }
  return puntosInteresCache;
}

function getPuntosInteres() {
  if (puntosInteresCache.length) return puntosInteresCache;
  if (typeof window !== "undefined" && Array.isArray(window.__TMS_PUNTOS_INTERES)) {
    puntosInteresCache = window.__TMS_PUNTOS_INTERES.slice(-200);
  }
  return puntosInteresCache;
}

async function syncPuntosInteresCache(setter) {
  const apply = (list) => {
    const next = setPuntosInteresCache(list, { broadcast: false });
    setter?.(next);
    return next;
  };
  const legacy = legacyPuntosInteresLoad();
  if (legacy.length && !getPuntosInteres().length) apply(legacy);
  try {
    let apiPuntos = await getPuntosInteresApi();
    if (Array.isArray(apiPuntos) && apiPuntos.length) {
      apply(apiPuntos);
      localStorage.removeItem("tms_puntos_interes");
      return apiPuntos;
    }
    if (legacy.length) {
      const migraciones = await Promise.allSettled(
        legacy.map(p => crearPuntoInteres(p).catch(() => null))
      );
      if (migraciones.some(r => r.status === "fulfilled")) {
        apiPuntos = await getPuntosInteresApi().catch(() => legacy);
        if (Array.isArray(apiPuntos) && apiPuntos.length) {
          apply(apiPuntos);
          localStorage.removeItem("tms_puntos_interes");
          return apiPuntos;
        }
      }
      return apply(legacy);
    }
  } catch {}
  return apply(getPuntosInteres());
}

function direccionCompletaPunto(punto) {
  return [
    punto?.direccion,
    punto?.codigo_postal,
    punto?.ciudad,
    punto?.provincia,
    punto?.pais,
  ].map(x => (x || "").trim()).filter(Boolean).join(", ");
}

function normalizePlaceText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function distinctPlaceName(name, address) {
  const cleanName = String(name || "").replace(/\s+/g, " ").trim();
  const cleanAddress = String(address || "").replace(/\s+/g, " ").trim();
  if (!cleanName) return "";
  if (!cleanAddress) return cleanName;
  const a = normalizePlaceText(cleanName);
  const b = normalizePlaceText(cleanAddress);
  return a && b && (a === b || a.includes(b) || b.includes(a)) ? "" : cleanName;
}

function isValidMapsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^https?:\/\//i.test(raw) || /^geo:/i.test(raw);
}

function cleanMapsUrl(value) {
  const raw = String(value || "").trim();
  return isValidMapsUrl(raw) ? raw : "";
}

function coordsFromMapsUrl(value) {
  const raw = String(value || "");
  if (!raw) return null;
  const decoded = (() => {
    try { return decodeURIComponent(raw); } catch { return raw; }
  })();
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function normalizePuntoInteresForForm(punto = {}) {
  const metadata = punto?.metadata && typeof punto.metadata === "object" ? punto.metadata : {};
  const googleMapsUrl = cleanMapsUrl(
    punto?.google_maps_url ||
    punto?.googleMapsUrl ||
    metadata.google_maps_url ||
    metadata.maps_url ||
    ""
  );
  const mapsCoords = coordsFromMapsUrl(googleMapsUrl);
  return {
    ...punto,
    metadata,
    google_maps_url: googleMapsUrl,
    punto_general: punto?.punto_general ?? punto?.es_general ?? !punto?.cliente_id,
    telefono: punto?.telefono || metadata.telefono || metadata.phone || "",
    email: punto?.email || metadata.email || "",
    contacto_nombre: punto?.contacto_nombre || metadata.contacto_nombre || metadata.contacto || "",
    contacto_telefono: punto?.contacto_telefono || metadata.contacto_telefono || metadata.telefono_contacto || "",
    ventana: punto?.ventana || metadata.ventana || metadata.horario || "",
    notas: punto?.notas || metadata.notas || metadata.notes || "",
    lat: punto?.lat ?? punto?.latitud ?? metadata.lat ?? metadata.latitud ?? mapsCoords?.lat ?? "",
    lng: punto?.lng ?? punto?.longitud ?? punto?.lon ?? metadata.lng ?? metadata.longitud ?? metadata.lon ?? mapsCoords?.lng ?? "",
  };
}

function resolvePuntoInteresQuery(place, puntos = null) {
  const raw = typeof place === "object" && place !== null
    ? String(place.address || place.direccion || place.lugar || place.name || place.nombre || "").trim()
    : String(place || "").trim();
  if (!raw) return "";
  const lista = Array.isArray(puntos) ? puntos : getPuntosInteres();
  const needle = normalizePlaceText(raw);
  const variants = (p) => ([
    p?.nombre,
    p?.direccion,
    direccionCompletaPunto(p),
    [p?.nombre, p?.ciudad].filter(Boolean).join(" "),
    [p?.nombre, p?.provincia].filter(Boolean).join(" "),
    [p?.direccion, p?.ciudad].filter(Boolean).join(" "),
    p?.ciudad,
    p?.provincia,
    p?.codigo_postal,
  ].map(normalizePlaceText).filter(Boolean));
  const exact = lista.find((p) => variants(p).some((v) => v === needle));
  const partial = exact || lista.find((p) => variants(p).some((v) => v.includes(needle) || needle.includes(v)));
  return (partial ? (direccionCompletaPunto(partial) || partial.direccion || raw) : raw).trim();
}

function savePuntoInteres(punto) {
  const direccion = (punto?.direccion || direccionCompletaPunto(punto)).trim();
  const nombre = (punto?.nombre || punto?.cliente_nombre || direccion).trim();
  if (!direccion) return getPuntosInteres();
  const id = punto?.id || `poi_${Date.now()}`;
  const googleMapsUrl = cleanMapsUrl(punto?.google_maps_url || punto?.metadata?.google_maps_url || "");
  const mapsCoords = coordsFromMapsUrl(googleMapsUrl);
  const normalizado = {
    id,
    nombre,
    direccion,
    cif: (punto?.cif || "").trim(),
    telefono: (punto?.telefono || "").trim(),
    email: (punto?.email || "").trim(),
    contacto_nombre: (punto?.contacto_nombre || "").trim(),
    contacto_telefono: (punto?.contacto_telefono || "").trim(),
    codigo_postal: (punto?.codigo_postal || "").trim(),
    ciudad: (punto?.ciudad || "").trim(),
    provincia: (punto?.provincia || "").trim(),
    pais: (punto?.pais || "España").trim(),
    ventana: (punto?.ventana || "").trim(),
    notas: (punto?.notas || "").trim(),
    tipo: punto?.tipo || "ambos",
    cliente_id: punto?.cliente_id || "",
    punto_general: punto?.punto_general ?? punto?.es_general ?? !punto?.cliente_id,
    es_general: punto?.es_general ?? punto?.punto_general ?? !punto?.cliente_id,
    google_maps_url: googleMapsUrl,
    lat: punto?.lat ?? punto?.latitud ?? punto?.metadata?.lat ?? mapsCoords?.lat ?? null,
    lng: punto?.lng ?? punto?.longitud ?? punto?.metadata?.lng ?? mapsCoords?.lng ?? null,
  };
  const actuales = getPuntosInteres();
  const reemplazaPorId = actuales.some(p => String(p.id) === String(id));
  const next = [
    ...actuales.filter(p => reemplazaPorId
      ? String(p.id) !== String(id)
      : (p.direccion || "").trim().toLowerCase() !== direccion.toLowerCase()
    ),
    normalizado,
  ].slice(-200);
  return setPuntosInteresCache(next);
}

function puntoToStop(punto) {
  const googleMapsUrl = cleanMapsUrl(punto?.google_maps_url || punto?.metadata?.google_maps_url || "");
  const mapsCoords = coordsFromMapsUrl(googleMapsUrl);
  return {
    direccion: punto?.direccion || "",
    cliente_nombre: punto?.nombre || "",
    punto_interes_id: punto?.id || punto?.punto_interes_id || null,
    ciudad: punto?.ciudad || punto?.poblacion || punto?.localidad || punto?.municipio || "",
    codigo_postal: punto?.codigo_postal || punto?.cp || punto?.postal_code || "",
    ventana: punto?.ventana || "",
    notas: punto?.notas || "",
    cif: punto?.cif || "",
    telefono: punto?.telefono || punto?.contacto_telefono || "",
    email: punto?.email || "",
    provincia: punto?.provincia || "",
    pais: punto?.pais || "",
    google_maps_url: googleMapsUrl,
    lat: punto?.lat ?? punto?.latitud ?? punto?.metadata?.lat ?? mapsCoords?.lat ?? null,
    lng: punto?.lng ?? punto?.longitud ?? punto?.metadata?.lng ?? mapsCoords?.lng ?? null,
  };
}

function isCargaPoint(punto = {}) {
  const tipo = String(punto?.tipo || "ambos").toLowerCase();
  return tipo === "carga" || tipo === "ambos";
}

function isDescargaPoint(punto = {}) {
  const tipo = String(punto?.tipo || "ambos").toLowerCase();
  return tipo === "descarga" || tipo === "ambos";
}

function isPuntoGeneral(punto = {}) {
  return !punto?.cliente_id;
}

function isPuntoVisibleParaCliente(punto = {}, clienteId = "", { includeGenerales = false } = {}) {
  if (isPuntoGeneral(punto)) return !!includeGenerales;
  return !!clienteId && String(punto.cliente_id) === String(clienteId);
}

function sortPuntosByClienteScope(a = {}, b = {}, clienteId = "") {
  const scope = (p) => (!isPuntoGeneral(p) && clienteId && String(p.cliente_id) === String(clienteId) ? 0 : 1);
  const byScope = scope(a) - scope(b);
  if (byScope) return byScope;
  return String(a.nombre || a.direccion || "").localeCompare(String(b.nombre || b.direccion || ""), "es");
}

function filterPuntosForPedido(puntos = [], { clienteId = "", tipo = "ambos", includeGenerales = false } = {}) {
  return (Array.isArray(puntos) ? puntos : [])
    .filter(p => isPuntoVisibleParaCliente(p, clienteId, { includeGenerales }))
    .filter(p => {
      if (tipo === "carga") return isCargaPoint(p);
      if (tipo === "descarga") return isDescargaPoint(p);
      return true;
    })
    .sort((a, b) => sortPuntosByClienteScope(a, b, clienteId));
}

function puntoEndpointVariants(punto = {}) {
  return [
    punto.nombre,
    punto.direccion,
    direccionCompletaPunto(punto),
    [punto.nombre, punto.ciudad].filter(Boolean).join(" "),
    [punto.nombre, punto.provincia].filter(Boolean).join(" "),
    [punto.direccion, punto.ciudad].filter(Boolean).join(" "),
  ].map(normalizePlaceText).filter(Boolean);
}

function findPuntoInteresForTypedEndpoint(text, clienteId = "", tipo = "ambos", puntos = null) {
  const needle = normalizePlaceText(text);
  if (!needle) return null;
  const lista = filterPuntosForPedido(Array.isArray(puntos) ? puntos : getPuntosInteres(), { clienteId, tipo });
  return lista.find(p => puntoEndpointVariants(p).some(v => v === needle)) || null;
}

function getPuntosCargaCliente(clienteId, puntos = null) {
  const lista = Array.isArray(puntos) ? puntos : getPuntosInteres();
  return filterPuntosForPedido(lista, { clienteId, tipo: "carga" });
}

function applyPuntoCargaToDraft(draft = {}, punto = {}) {
  const nombre = (punto.nombre || punto.direccion || draft.origen || "").toUpperCase();
  return {
    ...draft,
    origen: nombre,
    origen_pais: canonicalCountry(punto.pais || draft.origen_pais || "España") || "España",
    origen_provincia: punto.provincia || draft.origen_provincia || "",
    cmr_tipo: cmrTypeForCountries(punto.pais || draft.origen_pais || "España", draft.destino_pais || "España"),
    ventana_carga: draft.ventana_carga || punto.ventana || "",
    puntos_carga: updatePrimaryStop(
      draft.puntos_carga,
      puntoToStop(punto),
      nombre
    ),
  };
}

function applyPuntoDescargaToDraft(draft = {}, punto = {}) {
  const nombre = (punto.nombre || punto.direccion || draft.destino || "").toUpperCase();
  return {
    ...draft,
    destino: nombre,
    destino_pais: canonicalCountry(punto.pais || draft.destino_pais || "España") || "España",
    destino_provincia: punto.provincia || draft.destino_provincia || "",
    cmr_tipo: cmrTypeForCountries(draft.origen_pais || "España", punto.pais || draft.destino_pais || "España"),
    ventana_descarga: draft.ventana_descarga || punto.ventana || "",
    puntos_descarga: updatePrimaryStop(
      draft.puntos_descarga,
      puntoToStop(punto),
      nombre
    ),
  };
}

function findPuntoInteresForRouteEndpoint(endpoint, clienteId, tipo = "ambos") {
  const needle = normalizePlaceText(endpoint);
  if (!needle) return null;
  const stop = new Set(["de","del","la","el","los","las","s","sl","sa","sau","slu","cementos","capa","grupo"]);
  const endpointTokens = needle.split(/\W+/).filter(t => t.length >= 3 && !stop.has(t));
  const candidates = getPuntosInteres().filter(p => {
    const pointTipo = String(p?.tipo || "ambos").toLowerCase();
    const typeOk = tipo === "ambos" || pointTipo === "ambos" || pointTipo === tipo;
    if (!typeOk) return false;
    return !p?.cliente_id || !clienteId || String(p.cliente_id) === String(clienteId);
  });
  const score = (p) => {
    const haystack = normalizePlaceText([
      p.nombre,
      p.direccion,
      p.ciudad,
      p.provincia,
      p.codigo_postal,
      direccionCompletaPunto(p),
    ].filter(Boolean).join(" "));
    if (!haystack) return 0;
    if (haystack === needle) return 100;
    if (haystack.includes(needle) || needle.includes(haystack)) return 90;
    const hits = endpointTokens.filter(t => haystack.includes(t)).length;
    return hits >= Math.min(2, endpointTokens.length || 2) ? 50 + hits : 0;
  };
  return candidates
    .map(p => ({ p, score: score(p) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.p || null;
}

function applyRouteEndpointsFromSavedPoints(draft = {}, ruta = {}) {
  let next = { ...draft };
  const puntoCarga = findPuntoInteresForRouteEndpoint(ruta.origen || next.origen, next.cliente_id, "carga");
  const puntoDescarga = findPuntoInteresForRouteEndpoint(ruta.destino || next.destino, next.cliente_id, "descarga");
  if (puntoCarga) next = applyPuntoCargaToDraft(next, puntoCarga);
  if (puntoDescarga) next = applyPuntoDescargaToDraft(next, puntoDescarga);
  return next;
}

function formatPaymentTerms(empresa = {}) {
  const plazo = Number(empresa?.plazo_pago_colaboradores || 0);
  const dias = String(empresa?.dias_pago_colaboradores || "").trim();
  const forma = String(empresa?.forma_pago_colaboradores || "dias_fijos");
  if (forma === "transferencia_inmediata") return "Transferencia inmediata";
  if (forma === "fin_mes") return `Transferencia fin de mes${plazo ? ` + ${plazo} dias desde recepcion de factura` : ""}`;
  if (forma === "dias_fijos") {
    return `Transferencia ${plazo || 60} dias fecha recepcion factura${dias ? ` · pago dias ${dias}` : ""}`;
  }
  return empresa?.texto_pie || "Transferencia bancaria";
}

function formatClientPaymentTerms(empresa = {}) {
  const custom = String(empresa?.texto_pago_clientes || "").trim();
  if (custom) return custom;
  const plazo = Number(empresa?.plazo_pago_clientes || 0);
  const dias = String(empresa?.dias_pago_clientes || "").trim();
  const forma = String(empresa?.forma_pago_clientes || "recepcion_factura");
  if (forma === "contado") return "Pago al contado";
  if (forma === "transferencia_inmediata") return "Transferencia inmediata";
  if (forma === "fin_mes") return `Transferencia fin de mes${plazo ? ` + ${plazo} dias` : ""}${dias ? `; pago dias ${dias}` : ""}`;
  if (forma === "recepcion_factura") return `Transferencia ${plazo || 60} dias fecha recepcion factura${dias ? `; pago dias ${dias}` : ""}`;
  return "Transferencia bancaria";
}

function buildOperativaCargaLabels(pedido = {}) {
  const labels = [];
  if (pedido?.carga_lateral) labels.push("Carga lateral");
  if (pedido?.carga_trasera) labels.push("Carga trasera");
  if (pedido?.intercambio_palets) labels.push("Con intercambio de palets");
  else labels.push("Sin intercambio de palets");
  if (pedido?.requiere_cinchas) labels.push("Necesario llevar cinchas");
  return labels;
}

function getPrimaryStop(stops) {
  const parsed = parseStops(stops);
  return parsed[0] || {};
}

function getPrimaryStopField(stops, key) {
  return getPrimaryStop(stops)?.[key] || "";
}

function updatePrimaryStop(stops, patch = {}, fallbackAddress = "") {
  const parsed = parseStops(stops);
  const hasPrimary = parsed.length > 0 && isPrimaryStop(parsed[0], fallbackAddress);
  const current = hasPrimary ? parsed[0] : {};
  const next = {
    ...current,
    ...patch,
    direccion: patch.direccion ?? current.direccion ?? fallbackAddress ?? "",
    es_principal: true,
  };
  if (!next.direccion && parsed.length <= 1) return hasPrimary ? parsed.slice(1) : parsed;
  if (hasPrimary) return [next, ...parsed.slice(1)];
  return [next, ...parsed];
}

function isPrimaryStop(stop, fallbackAddress = "") {
  if (!stop) return false;
  if (stop.es_principal === true || stop.primary === true || stop.principal === true) return true;
  if (stop.es_adicional === true || stop.additional === true) return false;
  const fallbackText = normalizePlaceText(fallbackAddress);
  if (!fallbackText) return false;
  const candidates = [
    stopAddress(stop),
    stop.nombre,
    stop.name,
    stop.cliente_nombre,
    stop.address,
    stop.lugar,
  ].map(normalizePlaceText).filter(Boolean);
  return candidates.some(text => text === fallbackText || text.includes(fallbackText) || fallbackText.includes(text));
}

function splitPrimaryAndAdditionalStops(stops, fallbackAddress = "") {
  const parsed = parseStops(stops);
  if (!parsed.length) return { primary: null, extras: [] };
  if (parsed.length === 1 && fallbackAddress && !parsed[0]?.es_adicional && !parsed[0]?.additional) {
    return { primary: { ...parsed[0], es_principal: true }, extras: [] };
  }
  if (isPrimaryStop(parsed[0], fallbackAddress)) {
    return { primary: { ...parsed[0], es_principal: true }, extras: parsed.slice(1) };
  }
  return { primary: null, extras: parsed };
}

function stopAddress(stop) {
  return (stop?.direccion || stop?.lugar || stop?.ciudad || "").trim();
}

function findPuntoInteresForStop(stop = {}, fallback = "") {
  const lista = getPuntosInteres();
  if (!Array.isArray(lista) || !lista.length) return null;
  const id = stop?.punto_interes_id || stop?.punto_id || stop?.point_id || stop?.id_punto;
  if (id) {
    const byId = lista.find(p => String(p.id) === String(id));
    if (byId) return byId;
  }
  const candidates = [
    stop?.cliente_nombre,
    stop?.nombre,
    stop?.name,
    stopAddress(stop),
    fallback,
  ].map(normalizePlaceText).filter(Boolean);
  if (!candidates.length) return null;
  const pointVariants = (p) => ([
    p?.nombre,
    p?.direccion,
    direccionCompletaPunto(p),
    [p?.nombre, p?.ciudad].filter(Boolean).join(" "),
    [p?.nombre, p?.provincia].filter(Boolean).join(" "),
  ].map(normalizePlaceText).filter(Boolean));
  return lista.find(p => {
    const variants = pointVariants(p);
    return candidates.some(c => variants.some(v => v === c || v.includes(c) || c.includes(v)));
  }) || null;
}

function stopDisplayParts(stop = {}, fallback = "") {
  const punto = findPuntoInteresForStop(stop, fallback);
  const puntoDireccion = punto ? (direccionCompletaPunto(punto) || punto.direccion || "") : "";
  const rawDireccion = (stopAddress(stop) || fallback || "").trim();
  let direccion = rawDireccion;
  if (puntoDireccion && (!direccion || normalizePlaceText(direccion) === normalizePlaceText(punto?.nombre))) {
    direccion = puntoDireccion;
  }
  let nombre = (stop?.cliente_nombre || stop?.nombre || stop?.name || "").trim();
  if (punto?.nombre && (!nombre || normalizePlaceText(nombre) === normalizePlaceText(direccion || rawDireccion))) {
    nombre = punto.nombre;
  }
  nombre = distinctPlaceName(nombre, direccion);
  return { nombre, direccion };
}

function stopPostalLine(stop = {}, fallbackProvincia = "", fallbackPais = "España") {
  const punto = findPuntoInteresForStop(stop, stopAddress(stop));
  const source = { ...(punto || {}), ...(stop || {}) };
  const cp = String(source.codigo_postal || source.cp || source.postal_code || "").trim();
  const poblacion = String(source.ciudad || source.poblacion || source.localidad || source.municipio || "").trim();
  const provincia = String(source.provincia || source.region || source.state || fallbackProvincia || "").trim();
  const pais = stopCountry(source, fallbackPais || "España");
  return [cp, poblacion, provincia, pais].filter(Boolean).join(", ");
}

function empresaPostalAddress(empresa = {}) {
  const cpPoblacion = [
    empresa.cp || empresa.codigo_postal || empresa.postal_code,
    empresa.municipio || empresa.ciudad || empresa.poblacion,
  ].map(x => String(x || "").trim()).filter(Boolean).join(" ");
  return [
    empresa.domicilio || empresa.direccion || empresa.emp_dir,
    cpPoblacion,
    empresa.provincia,
    empresa.pais,
  ].map(x => String(x || "").trim()).filter(Boolean).join(", ");
}

function hasRoutePlaceData(place) {
  if (!place) return false;
  if (typeof place === "string") return !!place.trim();
  return !!(
    place.address ||
    place.direccion ||
    cleanMapsUrl(place.google_maps_url || place.googleMapsUrl) ||
    ((place.lat ?? place.latitud) != null && (place.lng ?? place.longitud) != null)
  );
}

function routePlaceKey(place) {
  if (typeof place === "string") return normalizePlaceText(place);
  return [
    place?.address || place?.direccion || "",
    cleanMapsUrl(place?.google_maps_url || place?.googleMapsUrl) || "",
    place?.lat ?? place?.latitud ?? "",
    place?.lng ?? place?.longitud ?? "",
  ].join("|").toLowerCase();
}

function stopToRoutePlace(stop, fallback = "", type = "Parada") {
  const source = stop || {};
  const { nombre, direccion } = stopDisplayParts(source, fallback);
  const punto = findPuntoInteresForStop(source, fallback);
  const routeAddress = direccionCompletaPunto(punto) || [
    direccion,
    source.codigo_postal || source.cp || source.postal_code,
    source.ciudad || source.poblacion || source.localidad || source.municipio,
    source.provincia || source.region || source.state,
    stopCountry(source, source.pais || "España"),
  ].map(x => String(x || "").trim()).filter(Boolean).join(", ");
  const mapsCoords = coordsFromMapsUrl(source.google_maps_url || source.googleMapsUrl || source.maps_url || source.metadata?.google_maps_url || punto?.google_maps_url || punto?.metadata?.google_maps_url || "");
  return {
    type,
    name: nombre || punto?.nombre || routeAddress,
    address: routeAddress || direccion,
    google_maps_url: cleanMapsUrl(source.google_maps_url || source.googleMapsUrl || source.maps_url || source.metadata?.google_maps_url || punto?.google_maps_url || punto?.metadata?.google_maps_url || ""),
    lat: source.lat ?? source.latitud ?? source.metadata?.lat ?? punto?.lat ?? punto?.latitud ?? punto?.metadata?.lat ?? mapsCoords?.lat ?? null,
    lng: source.lng ?? source.longitud ?? source.metadata?.lng ?? punto?.lng ?? punto?.longitud ?? punto?.metadata?.lng ?? mapsCoords?.lng ?? null,
  };
}

function sumStopWeights(stops) {
  return parseStops(stops).reduce((total, stop) => total + Number(stop.peso_kg || 0), 0);
}

function sumAdditionalDescargaPrices(stops) {
  return parseStops(stops)
    .slice(1)
    .reduce((total, stop) => {
      const n = parseLocaleNumber(stop?.precio ?? stop?.importe ?? stop?.precio_cliente, 0);
      return total + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
}

const IVA_PEDIDO_OPTIONS = [
  { value: "general", label: "21% IVA", tipo_iva: 21, iva_regimen: "general" },
  { value: "reducido", label: "10% IVA", tipo_iva: 10, iva_regimen: "reducido" },
  { value: "cero", label: "0% IVA", tipo_iva: 0, iva_regimen: "cero" },
  { value: "exento", label: "Exento", tipo_iva: 0, iva_regimen: "exento" },
];

function ivaOptionValue(data = {}) {
  const regimen = String(data.iva_regimen || "").toLowerCase();
  if (regimen === "exento") return "exento";
  if (regimen === "cero") return "cero";
  const tipo = parseLocaleNumber(data.tipo_iva, 21);
  if (tipo === 10) return "reducido";
  if (tipo === 0) return regimen === "exento" ? "exento" : "cero";
  return "general";
}

function applyIvaOptionToDraft(draft = {}, value = "general") {
  const option = IVA_PEDIDO_OPTIONS.find(o => o.value === value) || IVA_PEDIDO_OPTIONS[0];
  return { ...draft, tipo_iva: option.tipo_iva, iva_regimen: option.iva_regimen };
}

function calcIvaPedido(form = {}, baseOverride = null) {
  const base = Number.isFinite(Number(baseOverride)) ? Number(baseOverride) : calcImporte(form);
  const regimen = ivaOptionValue(form);
  const option = IVA_PEDIDO_OPTIONS.find(o => o.value === regimen) || IVA_PEDIDO_OPTIONS[0];
  const cuota = option.tipo_iva > 0 ? base * (option.tipo_iva / 100) : 0;
  return {
    ...option,
    base,
    cuota,
    total: base + cuota,
    aplica: option.tipo_iva > 0,
  };
}

function PuntoInteresPicker({ onPick, placeholder = "Usar punto de interes", style, puntos: puntosProp = null, clienteId = "", tipo = "ambos" }) {
  const [puntos, setPuntos] = useState(getPuntosInteres);
  const puntosDisponibles = Array.isArray(puntosProp)
    ? filterPuntosForPedido(puntosProp, { clienteId, tipo })
    : filterPuntosForPedido(puntos, { clienteId, tipo });

  useEffect(() => {
    const refresh = () => setPuntos(getPuntosInteres());
    let alive = true;
    syncPuntosInteresCache((next) => { if (alive) setPuntos(next); });
    window.addEventListener("tms:puntos-interes", refresh);
    return () => {
      alive = false;
      window.removeEventListener("tms:puntos-interes", refresh);
    };
  }, []);

  if (!puntosDisponibles.length) return null;

  return (
    <select
      value=""
      onChange={e => {
        const punto = puntosDisponibles.find(p => p.id === e.target.value);
        if (punto) onPick(punto);
      }}
      style={style || S.sel}
    >
      <option value="">{placeholder}</option>
      {puntosDisponibles.map(p => (
        <option key={p.id} value={p.id}>{p.nombre} - {p.direccion}{isPuntoGeneral(p) ? " (general)" : ""}</option>
      ))}
    </select>
  );
}

function getRoutePlaces(form) {
  const cargas = parseStops(form.puntos_carga);
  const descargas = parseStops(form.puntos_descarga);
  const places = [
    stopToRoutePlace(cargas[0], form.origen, "Carga"),
    ...cargas.slice(1).map(stop => stopToRoutePlace(stop, stopAddress(stop), "Carga intermedia")),
    stopToRoutePlace(descargas[0], form.destino, "Descarga"),
    ...descargas.slice(1).map(stop => stopToRoutePlace(stop, stopAddress(stop), "Descarga intermedia")),
  ].filter(hasRoutePlaceData);
  const seen = new Set();
  return places.filter(place => {
    const key = routePlaceKey(place);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMapsRouteUrl(places) {
  const clean = places.map(x => {
    if (typeof x === "object" && x !== null) {
      const lat = Number(x.lat ?? x.latitud);
      const lng = Number(x.lng ?? x.longitud);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng}`;
      return String(cleanMapsUrl(x.google_maps_url || x.googleMapsUrl) || x.address || x.direccion || x.name || "");
    }
    return String(x || "");
  }).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!clean.length) return "";
  const origin = clean[0];
  const destination = clean[clean.length - 1] || origin;
  const waypoints = clean.slice(1, -1).join("|");
  const params = new URLSearchParams({ api:"1", origin, destination, travelmode:"driving" });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildMapsSearchUrl(query) {
  const clean = String(query || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}`;
}

function stopMapsLink(stop, fallback = "") {
  const direct = cleanMapsUrl(stop?.google_maps_url || stop?.googleMapsUrl || stop?.maps_url || stop?.metadata?.google_maps_url || "");
  if (direct) return direct;
  const lat = Number(stop?.lat ?? stop?.latitud ?? stop?.metadata?.lat);
  const lng = Number(stop?.lng ?? stop?.longitud ?? stop?.metadata?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return buildMapsSearchUrl(`${lat},${lng}`);
  return buildMapsSearchUrl(stopAddress(stop) || fallback);
}

function buildStopMapsRows(stops, tipo, fallback = "") {
  return parseStops(stops).map((stop, idx) => {
    const { nombre, direccion } = stopDisplayParts(stop, idx === 0 ? fallback : "");
    return {
      label: idx === 0 ? tipo : `${tipo} ${idx + 1}`,
      nombre,
      direccion,
      url: stopMapsLink(stop, direccion || fallback),
    };
  }).filter(row => row.direccion || row.url);
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[ch]));
}

function splitEmailList(value) {
  return String(value || "")
    .split(/[;,\n\r]+/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
}

function joinEmailList(values, fallback = "") {
  const emails = values.flatMap(splitEmailList);
  const unique = emails.filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
  return unique.length ? unique.join(", ") : fallback;
}

function isMeaningfulVehicleNotice(text) {
  const clean = (text || "").trim();
  if (!clean) return false;
  if (/^fix[_\s-]*test$/i.test(clean)) return false;
  if (/^test$/i.test(clean)) return false;
  return true;
}


// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Crear pedido con IA (texto libre O archivo PDF/imagen -> campos del formulario) ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function ModalCrearConIA({ clientes, vehiculos, choferes, onClose, onCreado, embedded = false }) {
  const [texto,     setTexto]     = useState("");
  const [archivos,  setArchivos]  = useState([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [preview,   setPreview]   = useState(null);
  const [error,     setError]     = useState("");
  const [modo,      setModo]      = useState("texto"); // texto | archivo
  const [runs,      setRuns]      = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const fileInputRef = useRef(null);
  const speechSupported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const pedidoPreview = preview?.pedido || null;
  const camposClave = [
    "cliente_nombre", "origen", "destino", "fecha_carga", "hora_carga", "fecha_descarga",
    "hora_descarga", "mercancia", "peso_kg", "bultos", "importe", "tipo_precio",
    "precio_unitario", "referencia_cliente", "matricula_detectada", "km_ruta"
  ];
  const avisoTexto = item => item?.message || item?.detail || item?.label || String(item || "");
  const visualInfo = preview?.source?.attachments?.length ? (preview?.source?.ai_visual || null) : null;
  const statusLabel = status => ({
    listo_para_revisar: "Listo",
    requiere_revision: "Revisar",
    incompleto: "Incompleto",
    error: "Error",
    local: "Local",
  }[String(status || "")] || String(status || "-"));
  const prioridadIA = priority => ({
    alta: { label:"Alta", color:"#ef4444", bg:"rgba(239,68,68,.10)", border:"rgba(239,68,68,.28)" },
    media: { label:"Media", color:"#f59e0b", bg:"rgba(245,158,11,.10)", border:"rgba(245,158,11,.28)" },
    baja: { label:"Baja", color:"var(--green)", bg:"rgba(16,185,129,.09)", border:"rgba(16,185,129,.25)" },
  }[String(priority || "media")] || { label:"Media", color:"#f59e0b", bg:"rgba(245,158,11,.10)", border:"rgba(245,158,11,.28)" });
  const resumenRunIA = run => {
    const summary = run?.operational_summary || {};
    if (summary.action) return summary.action;
    const issues = Array.isArray(run?.issues) ? run.issues : [];
    const warnings = Array.isArray(run?.warnings) ? run.warnings : [];
    if (issues.length) return "Completar campos bloqueantes antes de crear el pedido.";
    if (warnings.length) return "Validar avisos de tarifa, ruta o asignacion antes de guardar.";
    return "Revisar borrador antes de guardar.";
  };
  const formatRunDate = value => {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-ES", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
  };
  const describeAttachmentStatus = (a) => {
    if (a.extractionStatus === "ok") return `${a.extractedText.length} caracteres detectados`;
    if (/^image\//i.test(a.mediaType || "")) return "imagen lista para IA visual";
    if (a.mediaType === "application/pdf") return "PDF listo para IA visual; fallback local si no hay API";
    return "sin texto claro, se adjunta para revisar";
  };

  const cargarHistorialIA = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await getAiInboxRuns(8);
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarHistorialIA();
    getAiInboxStatus().then(setAiStatus).catch(() => setAiStatus(null));
  }, [cargarHistorialIA]);

  async function interpretar() {
    const textoLimpio = texto.trim();
    const textosArchivo = archivos.map(a => a.extractedText).filter(Boolean);
    const textoCombinado = [textoLimpio, ...textosArchivo.map((t, i) => `Documento ${archivos[i]?.name || i + 1}:\n${t}`)]
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, 20000);
    const tieneArchivo = archivos.length > 0;
    const tieneVisual = archivos.some(a => a.base64 && (/^image\//i.test(a.mediaType || "") || a.mediaType === "application/pdf"));
    if (!textoCombinado.trim() && !tieneArchivo) { setError("Escribe texto o sube un email/PDF con texto legible."); return; }
    if (!textoCombinado.trim() && tieneArchivo && !tieneVisual) {
      setError("No he podido extraer texto del documento. Pega tambien el texto o sube una imagen/PDF compatible con IA visual.");
      return;
    }
    setLoading(true); setError(""); setPreview(null);
    try {
      const data = await interpretarPedidoIA({
        texto: textoCombinado,
        source: tieneArchivo ? "email_documentos" : "texto",
        filename: archivos.map(a => a.name).join(", ") || null,
        attachments: archivos.map(a => ({
          name: a.name,
          mediaType: a.mediaType,
          sizeKb: a.sizeKb,
          extractionStatus: a.extractionStatus,
          base64: (/^image\//i.test(a.mediaType || "") || a.mediaType === "application/pdf") ? a.base64 : undefined,
        })),
      });
      setPreview(data);
      cargarHistorialIA();
    } catch(e) {
      setError("No se pudo interpretar el pedido: " + (e.message || "verifica los datos pegados."));
    } finally { setLoading(false); }
  }

  async function handleAiFiles(inputFiles = []) {
    const files = Array.from(inputFiles || []);
    if (!files.length) return;
    setFileLoading(true);
    setError("");
    const next = [];
    let totalBytes = archivos.reduce((sum, a) => sum + Number(a.rawSize || 0), 0);
    for (const file of files) {
      if (file.size > AI_INBOX_MAX_FILE_BYTES) {
        setError(`${file.name}: maximo 6MB por documento en Bandeja IA.`);
        continue;
      }
      if (totalBytes + file.size > AI_INBOX_MAX_TOTAL_BYTES) {
        setError("Limite total de adjuntos alcanzado en Bandeja IA. Sube menos documentos o pega el texto principal.");
        continue;
      }
      try {
        const prepared = await prepareAiInboxFile(file);
        prepared.rawSize = file.size;
        next.push(prepared);
        totalBytes += file.size;
      } catch (err) {
        setError(`No se pudo leer ${file.name}: ${err.message}`);
      }
    }
    if (next.length) {
      setArchivos(prev => [...prev, ...next].slice(0, 8));
      setModo("archivo");
    }
    setFileLoading(false);
  }

  async function handleFile(e) {
    await handleAiFiles(e.target.files || []);
    e.target.value = "";
  }

  function handleDropFiles(e) {
    e.preventDefault();
    e.stopPropagation();
    setDraggingFile(false);
    handleAiFiles(e.dataTransfer?.files || []);
  }

  function dictarPedidoIA() {
    if (!speechSupported || voiceListening) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "es-ES";
    recognition.interimResults = false;
    recognition.continuous = false;
    setVoiceListening(true);
    recognition.onresult = event => {
      const transcript = Array.from(event.results || [])
        .map(result => result?.[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) setTexto(prev => `${prev ? `${prev}\n` : ""}${transcript}`);
    };
    recognition.onerror = () => setError("No se pudo capturar la voz. Revisa permisos de microfono del navegador.");
    recognition.onend = () => setVoiceListening(false);
    recognition.start();
  }

  return (
    <div style={embedded ? {width:"100%"} : {position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:24,width:embedded ? "100%" : "min(640px,96vw)",maxHeight:embedded ? "none" : "92vh",overflowY:embedded ? "visible" : "auto",boxSizing:"border-box"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:6}}>Bandeja IA de pedidos</div>
        <div style={{fontSize:12,color:"var(--text4)",marginBottom:12}}>
          Pega el email, WhatsApp u orden de carga. La bandeja detecta cliente, ruta, matricula, tarifa, conflictos y huecos antes de abrir el pedido.
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:12,background:aiStatus?.visual_available?"rgba(16,185,129,.08)":"rgba(59,130,246,.08)",border:`1px solid ${aiStatus?.visual_available?"rgba(16,185,129,.22)":"rgba(59,130,246,.22)"}`,borderRadius:8,padding:"8px 10px"}}>
          <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:aiStatus?.visual_available?"var(--green)":"#60a5fa"}}>
            {aiStatus?.mode_label || "Modo basico local"}
          </span>
          <span style={{fontSize:12,color:"var(--text3)",lineHeight:1.35}}>
            {aiStatus?.guidance || "Texto, emails y documentos con texto funcionan sin API externa. Imagenes o PDF escaneados requieren API visual."}
          </span>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,padding:"8px 10px",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>Historial IA</div>
            <div style={{fontSize:12,color:"var(--text3)"}}>
              {runsLoading ? "Cargando ultimos analisis..." : runs.length ? `${runs.length} analisis recientes registrados` : "Sin analisis recientes registrados"}
            </div>
          </div>
          <button
            type="button"
            onClick={()=>setShowHistory(v=>!v)}
            style={{padding:"6px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}
          >
            {showHistory ? "Ocultar" : "Ver historial"}
          </button>
        </div>
        {showHistory && (
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
            {runs.slice(0, 6).map(run => {
              const priority = prioridadIA(run.operational_summary?.priority);
              const detected = Array.isArray(run.operational_summary?.detected) ? run.operational_summary.detected : [];
              const missing = Array.isArray(run.operational_summary?.missing) ? run.operational_summary.missing : [];
              return (
              <div key={run.id} style={{display:"grid",gridTemplateColumns:"82px 1fr auto",gap:8,alignItems:"start",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"8px 9px"}}>
                <div style={{fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>{formatRunDate(run.created_at)}</div>
                <div style={{minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:2}}>
                    <div style={{fontSize:12,fontWeight:800,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:280}}>
                      {run.filename || run.source_type || "Analisis de pedido"}
                    </div>
                    <span style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:priority.color,background:priority.bg,border:`1px solid ${priority.border}`,borderRadius:999,padding:"2px 6px"}}>
                      {priority.label}
                    </span>
                  </div>
                  <div style={{fontSize:10,color:"var(--text5)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {statusLabel(run.status)} | {run.provider || "parser local"} | {(run.attachments || []).length} adjunto(s)
                    {(run.issues || []).length ? ` | ${(run.issues || []).length} pendiente(s)` : ""}
                    {run.error ? ` | ${run.error}` : ""}
                  </div>
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:4,lineHeight:1.35}}>{resumenRunIA(run)}</div>
                  {(detected.length || missing.length) && (
                    <div style={{fontSize:10,color:"var(--text5)",marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {detected.length ? `Detectado: ${detected.slice(0, 2).join(", ")}` : ""}
                      {detected.length && missing.length ? " | " : ""}
                      {missing.length ? `Falta: ${missing.slice(0, 2).join(", ")}` : ""}
                    </div>
                  )}
                </div>
                <span style={{fontSize:11,fontWeight:800,color:Number(run.confidence || 0) >= 70 ? "var(--green)" : "#f59e0b",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:16,padding:"3px 8px"}}>
                  {Number(run.confidence || 0)}%
                </span>
              </div>
            );})}
            {!runs.length && <div style={{fontSize:12,color:"var(--text5)",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"9px 10px"}}>Todavia no hay analisis IA guardados en esta empresa.</div>}
          </div>
        )}

        {/* Selector modo */}
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[["texto","Texto / email"],["archivo","Documento + texto"]].map(([v,l])=>(
            <button key={v} onClick={()=>setModo(v)}
              style={{padding:"6px 14px",borderRadius:8,border:`1.5px solid ${modo===v?"var(--accent)":"var(--border)"}`,
                background:modo===v?"var(--accent)":"var(--bg3)",color:modo===v?"#fff":"var(--text3)",
                fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>
              {l}
            </button>
          ))}
        </div>

        {modo==="texto" && (
          <div style={{display:"grid",gap:8}}>
            {speechSupported && (
              <button type="button" onClick={dictarPedidoIA} disabled={voiceListening}
                style={{justifySelf:"start",padding:"7px 12px",borderRadius:8,border:"1px solid rgba(59,130,246,.28)",background:voiceListening?"rgba(239,68,68,.12)":"rgba(59,130,246,.10)",color:voiceListening?"#ef4444":"var(--accent-xl)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:900,cursor:voiceListening?"wait":"pointer"}}>
                {voiceListening ? "Escuchando..." : "Dictar pedido"}
              </button>
            )}
            <textarea value={texto} onChange={e=>setTexto(e.target.value)}
              placeholder={"Ej: Cliente: Transportes Garcia\nOrigen: Barcelona\nDestino: Madrid\nFecha carga: 15/06/2026 08:00\nMercancia: palets fruta\nPeso: 24000 kg\nPrecio: 850 EUR\nReferencia: OC-1234"}
              style={{width:"100%",minHeight:132,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"10px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",resize:"vertical",boxSizing:"border-box"}}/>
          </div>
        )}

        {modo==="archivo" && (
          <div
            onDragOver={(e)=>{ e.preventDefault(); setDraggingFile(true); }}
            onDragLeave={()=>setDraggingFile(false)}
            onDrop={handleDropFiles}
            style={{border:`2px dashed ${draggingFile ? "var(--accent)" : "var(--border2)"}`,borderRadius:10,padding:"24px",textAlign:"center",background:draggingFile?"rgba(59,130,246,.10)":"var(--bg3)"}}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.eml,.html,.htm,.csv,.xml,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,text/plain,message/rfc822,text/html,text/csv,application/xml,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFile}
              style={{display:"none"}}
            />
            <div style={{fontSize:18,fontWeight:800,marginBottom:8,color:"var(--text)"}}>{fileLoading ? "Leyendo documento..." : "Seleccionar documentos"}</div>
            <div style={{fontWeight:600,color:"var(--text)",fontSize:13}}>Email, PDF con texto, DOCX, TXT, HTML, CSV, XML o imagen</div>
            <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>
              PDF/email con texto no necesita API. Imagenes o PDF escaneados necesitan API visual configurada en SuperAdmin.
            </div>
            <button
              type="button"
              onClick={()=>fileInputRef.current?.click()}
              disabled={fileLoading}
              style={{marginTop:12,padding:"8px 14px",borderRadius:7,border:"1px solid var(--accent)",background:"rgba(59,130,246,.14)",color:"var(--accent-xl)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:800,cursor:fileLoading?"wait":"pointer"}}
            >
              Buscar archivo
            </button>
            <div style={{fontSize:10,color:"var(--text5)",marginTop:8}}>Tambien puedes arrastrar aqui los documentos. Maximo 6MB por archivo y 7MB en total.</div>
            {archivos.length > 0 && (
              <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6,textAlign:"left"}}>
                {archivos.map((a, idx)=>(
                  <div key={`${a.name}-${idx}`} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 9px",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:7}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</div>
                      <div style={{fontSize:10,color:a.extractionStatus==="ok"?"var(--green)":"#f59e0b"}}>
                        {a.sizeKb}KB | {describeAttachmentStatus(a)}
                      </div>
                    </div>
                    <button type="button" onClick={()=>setArchivos(prev=>prev.filter((_, i)=>i!==idx))} style={{background:"none",border:"none",color:"var(--text5)",cursor:"pointer",fontSize:12}}>Quitar</button>
                  </div>
                ))}
              </div>
            )}
            <textarea value={texto} onChange={e=>setTexto(e.target.value)}
              placeholder={"Opcional: pega aqui el cuerpo del email o texto adicional si el documento es escaneado."}
              style={{width:"100%",minHeight:92,marginTop:14,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"10px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",resize:"vertical",boxSizing:"border-box",textAlign:"left"}}/>
          </div>
        )}

        <div style={{display:"flex",gap:8,margin:"14px 0"}}>
          <button onClick={interpretar} disabled={loading || fileLoading || (!texto.trim() && !archivos.length)}
            style={{padding:"8px 16px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:(loading||fileLoading)?"not-allowed":"pointer",opacity:(loading||fileLoading)?0.6:1}}>
            {loading?"Analizando pedido...":"Analizar pedido"}
          </button>
          <button onClick={onClose} style={{padding:"8px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
        </div>
        {error && <div style={{color:"var(--red)",fontSize:12,marginBottom:10}}>{error}</div>}
        {preview && (
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:10,flexWrap:"wrap"}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--green)"}}>Pedido interpretado - revisa y confirma</div>
              <div style={{display:"inline-flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>Confianza</span>
                <span style={{fontSize:12,fontWeight:800,color:"var(--text)",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:18,padding:"4px 10px"}}>
                  {Math.round(Math.min(100, Number(preview.confidence || 0)))}%
                </span>
              </div>
            </div>
            {visualInfo && (
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"8px 10px",fontSize:11,color:"var(--text3)",marginBottom:10}}>
                <span style={{fontWeight:800,color:visualInfo.ok ? "var(--green)" : "#f59e0b"}}>IA visual</span>
                <span>
                  {visualInfo.ok
                    ? `Documento analizado con ${visualInfo.provider || "proveedor configurado"}`
                    : visualInfo.reason === "sin_api_key"
                      ? "Preparada para analizar imagen/PDF cuando se configure la API en SuperAdmin"
                      : "No hubo JSON interpretable; se mantiene el analisis local"}
                </span>
              </div>
            )}
            {(preview.suggestions?.length > 0 || preview.warnings?.length > 0 || preview.issues?.length > 0) && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8,marginBottom:12}}>
                {preview.suggestions?.length > 0 && (
                  <div style={{background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.25)",borderRadius:8,padding:"9px 11px"}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".08em",color:"var(--green)",marginBottom:5}}>Sugerencias</div>
                    {preview.suggestions.slice(0, 4).map((x, i) => <div key={i} style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{avisoTexto(x)}</div>)}
                  </div>
                )}
                {preview.warnings?.length > 0 && (
                  <div style={{background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.28)",borderRadius:8,padding:"9px 11px"}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".08em",color:"#f59e0b",marginBottom:5}}>Avisos</div>
                    {preview.warnings.slice(0, 4).map((x, i) => <div key={i} style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{avisoTexto(x)}</div>)}
                  </div>
                )}
                {preview.issues?.length > 0 && (
                  <div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.26)",borderRadius:8,padding:"9px 11px"}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".08em",color:"var(--red)",marginBottom:5}}>Pendiente</div>
                    {preview.issues.slice(0, 4).map((x, i) => <div key={i} style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{avisoTexto(x)}</div>)}
                  </div>
                )}
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {camposClave.filter(k => pedidoPreview?.[k] !== undefined && pedidoPreview?.[k] !== null && pedidoPreview?.[k] !== "").map(k=>(
                <div key={k} style={{background:"var(--bg4)",borderRadius:7,padding:"7px 10px"}}>
                  <div style={{fontSize:9,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>{k.replace(/_/g," ")}</div>
                  <div style={{fontSize:13,color:"var(--text)",fontWeight:600,marginTop:2}}>{String(pedidoPreview[k])}</div>
                </div>
              ))}
            </div>
            <div style={{background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.2)",borderRadius:8,padding:"9px 13px",fontSize:12,color:"var(--text3)",marginBottom:12}}>
              {preview.next_action || "Se abrira el formulario de pedido con estos datos pre-rellenados. Puedes completar o corregir antes de guardar."}
            </div>
            {archivos.length > 0 && (
              <div style={{background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.22)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"var(--text3)",marginBottom:12}}>
                Se adjuntaran {archivos.length} documento(s) al guardar el pedido. Quedaran trazados como origen Bandeja IA.
              </div>
            )}
            <button onClick={()=>onCreado({
              ...(pedidoPreview || {}),
              _ai_meta: {
                source: preview.source?.type || "bandeja_ia",
                filename: preview.source?.filename || archivos.map(a => a.name).join(", ") || null,
                confidence: Math.round(Math.min(100, Number(preview.confidence || 0))),
                status: preview.status || "",
                issues_count: Array.isArray(preview.issues) ? preview.issues.length : 0,
                warnings_count: Array.isArray(preview.warnings) ? preview.warnings.length : 0,
                attachments_count: archivos.length,
                visual_provider: preview.source?.ai_visual?.provider || null,
                visual_ok: Boolean(preview.source?.ai_visual?.ok),
              },
              _ai_docs: archivos.map(a => ({
                nombre: a.name,
                tipo: inferPedidoDocTipo(a.name),
                file_base64: a.base64,
                file_mime: a.mediaType || "application/pdf",
                file_size_kb: a.sizeKb,
              })),
            })}
              style={{padding:"9px 18px",borderRadius:7,border:"none",background:"var(--green)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              Continuar con estos datos
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Componente edicion concepto de factura ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function ModalPedidoRapido({ clientes = [], vehiculos = [], choferes = [], colaboradores = [], onClose, onCreado }) {
  const { user } = useAuth();
  const hoy = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(withPedidoGeoDefaults({
    cliente_nombre: "",
    cliente_id: "",
    ruta_id: "",
    origen: "",
    destino: "",
    vehiculo_id: "",
    chofer_id: "",
    remolque_id_manual: "",
    matricula_colaborador: "",
    remolque_matricula_colaborador: "",
    colaborador_id: "",
    matricula_rapida: "",
    tipo_descarga: "trasera",
    retorno: "no",
    fecha_carga: hoy,
    fecha_descarga: hoy,
    hora_carga: "",
    hora_descarga: "",
    referencia_cliente: "",
    tipo_precio: "viaje",
    precio_unitario: "",
    cantidad: "",
    importe_minimo: "",
    minimo_unidades: "",
    km_ruta: "",
    observaciones: "",
  }));
  const [saving, setSaving] = useState(false);
  const [rutasCliente, setRutasCliente] = useState([]);
  const [rutasLoading, setRutasLoading] = useState(false);
  const [clienteRiesgoRapido, setClienteRiesgoRapido] = useState(null);
  const [clienteRiesgoLoadingRapido, setClienteRiesgoLoadingRapido] = useState(false);
  const [puntosCargaCliente, setPuntosCargaCliente] = useState([]);
  const [puntosCargaLoading, setPuntosCargaLoading] = useState(false);
  const [poiDraftRapido, setPoiDraftRapido] = useState(null);
  const riesgoConfirmadoRapidoRef = useRef(new Map());
  const f = k => e => setForm(p => ({ ...p, [k]: (k === "origen" || k === "destino") ? e.target.value.toUpperCase() : e.target.value }));
  const inp = { ...S.input, boxSizing:"border-box" };
  const quickGrid = {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10};
  const cleanCliente = form.cliente_nombre.trim();
  const matches = cleanCliente
    ? clientes.filter(c => (c.nombre || "").toLowerCase().includes(cleanCliente.toLowerCase())).slice(0, 5)
    : [];
  const clienteSeleccionadoRapido = clientes.find(c => String(c.id || "") === String(form.cliente_id || ""))
    || clientes.find(c => (c.nombre || "").trim().toLowerCase() === cleanCliente.toLowerCase())
    || null;
  const importeRapidoPreview = calcImporte({
    ...form,
    tipo_precio: form.tipo_precio || "viaje",
    extracostes_importe: 0,
    puntos_descarga: [],
  });
  const clienteRiesgoRapidoPedido = buildClienteRiesgoPedidoAvisos(clienteRiesgoRapido, importeRapidoPreview);
  const bloqueoClienteRapido = clienteCreationBlock(clienteSeleccionadoRapido, clienteRiesgoRapidoPedido, user);
  const bloqueoRapidoNoticeRef = useRef("");
  const vehiculosConjunto = vehiculos.filter(v => {
    const clase = (v.clase || v.tipo || "").toLowerCase();
    const mat = (v.matricula || "").toUpperCase();
    const esRemolqueDeAlguien = vehiculos.some(t => t.remolque_id === v.id);
    const esRemolque = clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly") ||
      esRemolqueDeAlguien || /^R[-_\s]/i.test(mat) || mat.endsWith("-R") || mat.endsWith("_R");
    return !esRemolque;
  });
  const vehiculoSeleccionado = vehiculos.find(v => v.id === form.vehiculo_id);
  const vehiculoPorMatriculaRapida = form.matricula_rapida
    ? vehiculosConjunto.find(v => String(v.matricula || "").replace(/[\s-]/g, "").toUpperCase() === String(form.matricula_rapida || "").replace(/[\s-]/g, "").toUpperCase())
    : null;
  const choferAsignado = choferes.find(c => c.id === form.chofer_id);
  const colaboradorSeleccionado = colaboradores.find(c => c.id === form.colaborador_id);
  const labelConjunto = v => {
    const remolque = v.remolque_matricula || vehiculos.find(r => r.id === v.remolque_id)?.matricula;
    return remolque ? `${v.matricula} + ${remolque}` : v.matricula;
  };
  const buildCargasRapidas = () => {
    const pais = canonicalCountry(form.origen_pais || "España") || "España";
    const paradasGuardadas = parseStops(form.puntos_carga);
    if (paradasGuardadas.length) return paradasGuardadas.map((stop, idx) => ({
      ...stop,
      direccion: (stopAddress(stop) || stop.direccion || form.origen || "").trim().toUpperCase(),
      fecha: stop.fecha || (idx === 0 ? form.fecha_carga : "") || form.fecha_carga || "",
      hora: stop.hora || (idx === 0 ? form.hora_carga : "") || "",
      ventana: stop.ventana || (idx === 0 ? form.ventana_carga : "") || "",
      pais: stopCountry(stop, pais),
      provincia: stopRegion(stop, idx === 0 ? form.origen_provincia || "" : ""),
      notas: stop.notas || (idx === 0 ? "Pedido rapido" : "Carga adicional desde pedido rapido"),
    }));
    const principal = {
      direccion: form.origen.trim().toUpperCase(),
      cliente_nombre: "",
      fecha: form.fecha_carga || "",
      hora: form.hora_carga || "",
      ventana: form.ventana_carga || "",
      bultos: "",
      peso_kg: "",
      pais,
      provincia: form.origen_provincia || "",
      notas: "Pedido rapido",
    };
    return [principal];
  };
  const buildDescargasRapidas = () => {
    const pais = canonicalCountry(form.destino_pais || "España") || "España";
    const paradasGuardadas = parseStops(form.puntos_descarga);
    if (paradasGuardadas.length) return paradasGuardadas.map((stop, idx) => ({
      ...stop,
      direccion: (stopAddress(stop) || stop.direccion || form.destino || "").trim().toUpperCase(),
      fecha: stop.fecha || (idx === 0 ? form.fecha_descarga : "") || form.fecha_descarga || form.fecha_carga || "",
      hora: stop.hora || (idx === 0 ? form.hora_descarga : "") || "",
      ventana: stop.ventana || (idx === 0 ? form.ventana_descarga : "") || "",
      pais: stopCountry(stop, pais),
      provincia: stopRegion(stop, idx === 0 ? form.destino_provincia || "" : ""),
      tipo_descarga: stop.tipo_descarga || form.tipo_descarga || "indiferente",
      notas: stop.notas || (idx === 0 ? (form.tipo_descarga ? `Pedido rapido. Descarga ${form.tipo_descarga}` : "Pedido rapido") : "Descarga adicional desde pedido rapido"),
    }));
    const principal = {
      direccion: form.destino.trim().toUpperCase(),
      cliente_nombre: "",
      fecha: form.fecha_descarga || form.fecha_carga || "",
      hora: form.hora_descarga || "",
      ventana: form.ventana_descarga || "",
      bultos: "",
      peso_kg: "",
      precio: "",
      pais,
      provincia: form.destino_provincia || "",
      tipo_descarga: form.tipo_descarga || "indiferente",
      notas: form.tipo_descarga ? `Pedido rapido. Descarga ${form.tipo_descarga}` : "Pedido rapido",
    };
    return [principal];
  };

  useEffect(() => {
    if (!clienteSeleccionadoRapido?.id) {
      setRutasCliente([]);
      setClienteRiesgoRapido(null);
      setPuntosCargaCliente([]);
      return undefined;
    }
    let alive = true;
    setRutasLoading(true);
    getRutasCliente(clienteSeleccionadoRapido.id, { silentError: true })
      .then(d => {
        if (!alive) return;
        const lista = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
        setRutasCliente(lista.map(r => ({ ...r, id: r.ruta_id || r.id, precio_base: r.precio_base ?? r.precio ?? 0 })));
      })
      .catch(() => { if (alive) setRutasCliente([]); })
      .finally(() => { if (alive) setRutasLoading(false); });
    setClienteRiesgoLoadingRapido(true);
    getClienteRiesgoOperativo(clienteSeleccionadoRapido.id, { silentError: true })
      .then(d => { if (alive) setClienteRiesgoRapido(d || null); })
      .catch(() => { if (alive) setClienteRiesgoRapido(null); })
      .finally(() => { if (alive) setClienteRiesgoLoadingRapido(false); });
    setPuntosCargaLoading(true);
    getPuntosInteresApi({ cliente_id: clienteSeleccionadoRapido.id, tipo: "carga" })
      .then(d => {
        if (!alive) return;
        const lista = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
        const cargas = lista.filter(isCargaPoint);
        setPuntosCargaCliente(cargas);
        if (cargas.length === 1) {
          setForm(p => String(p.origen || "").trim() ? p : applyPuntoCargaToDraft(p, cargas[0]));
        }
      })
      .catch(() => {
        if (alive) setPuntosCargaCliente(getPuntosCargaCliente(clienteSeleccionadoRapido.id));
      })
      .finally(() => { if (alive) setPuntosCargaLoading(false); });
    return () => { alive = false; };
  }, [clienteSeleccionadoRapido?.id]);

  useEffect(() => {
    if (!bloqueoClienteRapido || !form.cliente_id) return;
    const key = `${form.cliente_id}:${bloqueoClienteRapido.type}:${bloqueoClienteRapido.message}`;
    if (bloqueoRapidoNoticeRef.current === key) return;
    bloqueoRapidoNoticeRef.current = key;
    notify(bloqueoClienteRapido.message, "error");
  }, [bloqueoClienteRapido, form.cliente_id]);

  async function resolverCliente() {
    const exact = clientes.find(c => (c.nombre || "").trim().toLowerCase() === cleanCliente.toLowerCase());
    if (exact) return exact;
    const firstMatch = matches[0];
    if (firstMatch) return firstMatch;
    const encontrados = await getClientes(cleanCliente, "true", 1, 5).catch(() => null);
    const remotos = Array.isArray(encontrados?.data) ? encontrados.data : Array.isArray(encontrados) ? encontrados : [];
    if (remotos[0]) return remotos[0];
    const nuevo = await crearCliente({
      nombre: cleanCliente,
      cif: "PTE" + Date.now(),
      tipo_iva: 21,
      iva_regimen: "general",
      pais: "España",
      pendiente_revision: true,
      notas: "Creado desde pedido rapido. Completar datos fiscales.",
    });
    return nuevo?.data || nuevo;
  }

  async function resolverTarifaRapida(cliente) {
    if (form.ruta_id) {
      const selected = rutasCliente.find(r => String(r.id || r.ruta_id || "") === String(form.ruta_id));
      if (selected) return selected;
    }
    const data = await getRutasCliente(cliente.id, { silentError: true }).catch(() => []);
    const lista = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    if (form.ruta_id) return lista.find(r => String(r.ruta_id || r.id || "") === String(form.ruta_id)) || null;
    return null;
  }

  function aplicarTarifaRapida(ruta) {
    if (!ruta) return;
    setForm(p => {
      const tarifaTipo = ruta.tarifa_tipo || p.tipo_precio || "viaje";
      const recargoPct = parseLocaleNumber(ruta.recargo_combustible_pct, 0);
      const precioBase = parseLocaleNumber(ruta.precio_base ?? ruta.precio, 0);
      const precioFinal = precioBase > 0 ? Number((precioBase * (1 + (recargoPct / 100))).toFixed(4)) : precioBase;
      const minimoUnidades = normalizeMinimoUnidadesRuta(ruta, tarifaTipo);
      return syncCantidadRapida({
        ...p,
        ruta_id: ruta.id || ruta.ruta_id || "",
        origen: (ruta.origen || p.origen || "").toUpperCase(),
        destino: (ruta.destino || p.destino || "").toUpperCase(),
        km_ruta: ruta.km || p.km_ruta || "",
        tipo_precio: tarifaTipo,
        precio_unitario: precioFinal || p.precio_unitario,
        importe_minimo: tarifaTipo === "viaje" ? (ruta.minimo_facturable || "") : "",
        minimo_unidades: tarifaTipo !== "viaje" ? (minimoUnidades || "") : "",
      }, true);
    });
  }

  function syncCantidadRapida(draft, force = false) {
    const tipo = draft.tipo_precio || "viaje";
    if (tipo === "viaje") return { ...draft, cantidad: force ? "" : draft.cantidad };
    if (force || draft.cantidad === null || draft.cantidad === undefined || draft.cantidad === "") {
      return { ...draft, cantidad: cantidadSugeridaPorTipo(draft, tipo) };
    }
    return draft;
  }

  async function guardarRapido() {
    if (!cleanCliente) { notify("Indica el cliente.", "warning"); return; }
    if (!form.origen.trim()) { notify("Indica el origen.", "warning"); return; }
    if (!form.destino.trim()) { notify("Indica el destino.", "warning"); return; }
    if (!form.fecha_carga) { notify("Indica la fecha de carga para que aparezca en el cuadrante.", "warning"); return; }
    try {
      assertValidPedidoDates({ fecha_carga: form.fecha_carga, fecha_descarga: form.fecha_descarga });
    } catch (dateErr) {
      notify(dateErr.message, "warning");
      return;
    }
    if (descargaAntesQueCarga(form.fecha_carga, form.fecha_descarga)) {
      notify("La fecha de descarga no puede ser anterior a la fecha de carga.", "warning");
      return;
    }
    setSaving(true);
    try {
      const cliente = await resolverCliente();
      if (!cliente?.id) throw new Error("No se pudo resolver el cliente.");
      const bloqueo = clienteCreationBlock(cliente, clienteRiesgoRapidoPedido, user);
      if (bloqueo) {
        notify(bloqueo.message, "error");
        return;
      }
      const rutasDisponiblesRaw = rutasCliente.length ? rutasCliente : await getRutasCliente(cliente.id, { silentError: true }).catch(() => []);
      const rutasDisponibles = Array.isArray(rutasDisponiblesRaw)
        ? rutasDisponiblesRaw
        : Array.isArray(rutasDisponiblesRaw?.data) ? rutasDisponiblesRaw.data : [];
      const tieneTarifasSinRuta = rutasDisponibles.length > 0 && !form.ruta_id;
      if (clienteRiesgoRapidoPedido?.requiere_confirmacion && !isRiskConfirmationFresh(riesgoConfirmadoRapidoRef, cliente.id, clienteRiesgoRapidoPedido)) {
        const money = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const ok = await confirmDialog({
          title: clienteRiesgoRapidoPedido.nivel === "critico" ? "Cliente en riesgo critico" : "Cliente con cobros/riesgo pendiente",
          message: [
            `Pendiente actual: ${money(clienteRiesgoRapido?.total_pendiente)} EUR`,
            `Riesgo actual: ${formatRiskPct(clienteRiesgoRapidoPedido.riesgo_pct_actual)}`,
            `Con este pedido: ${formatRiskPct(clienteRiesgoRapidoPedido.riesgo_pct_proyectado)} (${money(clienteRiesgoRapidoPedido.total_proyectado)} EUR expuestos)`,
            ...clienteRiesgoRapidoPedido.avisos.map(a => `- ${a.mensaje}`),
            "Quieres crear el pedido rapido igualmente?",
          ].join("\n"),
          confirmText: "Crear igualmente",
          cancelText: "Revisar",
          tone: "warning",
        });
        if (!ok) return;
        markRiskConfirmed(riesgoConfirmadoRapidoRef, cliente.id, clienteRiesgoRapidoPedido);
      }
      const ruta = await resolverTarifaRapida(cliente);
      const matriculaColaborador = String(form.matricula_colaborador || "").trim().toUpperCase();
      const remolqueColaborador = String(form.remolque_matricula_colaborador || "").trim().toUpperCase();
      const colaboradorId = form.colaborador_id || "";
      const vehiculoRapido = form.vehiculo_id
        ? vehiculos.find(v => String(v.id) === String(form.vehiculo_id))
        : vehiculoPorMatriculaRapida;
      const vehiculoRapidoId = colaboradorId ? "" : (vehiculoRapido?.id || "");
      const choferRapidoId = !colaboradorId && vehiculoRapidoId
        ? (form.chofer_id || vehiculoRapido?.chofer_id || choferes.find(c => String(c.vehiculo_id) === String(vehiculoRapidoId))?.id || "")
        : "";
      const matriculaManualRapida = !vehiculoRapidoId && !colaboradorId
        ? String(form.matricula_rapida || "").trim().toUpperCase()
        : matriculaColaborador;
      const tipoPrecio = form.tipo_precio || ruta?.tarifa_tipo || "viaje";
      const kmRuta = toNullableNumber(form.km_ruta) ?? toNullableNumber(ruta?.km);
      const precioUnitario = toNullableNumber(form.precio_unitario) ?? toNullableNumber(ruta?.precio_base) ?? 0;
      const minimoUnidadesRuta = normalizeMinimoUnidadesRuta(ruta || {}, tipoPrecio);
      const tarifaDraft = syncCantidadRapida({
        tipo_precio: tipoPrecio,
        precio_unitario: precioUnitario,
        cantidad: form.cantidad || "",
        peso_kg: "",
        bultos: "",
        km_ruta: kmRuta || "",
        importe_minimo: tipoPrecio === "viaje" ? (form.importe_minimo || ruta?.minimo_facturable || "") : "",
        minimo_unidades: tipoPrecio !== "viaje" ? (form.minimo_unidades || minimoUnidadesRuta || "") : "",
        extracostes_importe: 0,
      }, true);
      const importeCalculado = Number(calcImporte(tarifaDraft).toFixed(2));
      const conAsignacion = !!vehiculoRapidoId || !!colaboradorId || !!matriculaManualRapida;
      const aviso = conAsignacion
        ? `Pedido rapido: completar ${tieneTarifasSinRuta ? "ruta/tarifa, " : ""}mercancia, peso, bultos, documentos y datos de facturacion.`
        : `Pedido rapido sin asignar: completar ${tieneTarifasSinRuta ? "ruta/tarifa, " : ""}vehiculo o colaborador, chofer, precio, mercancia, peso, bultos, documentos y datos de facturacion.`;
      await crearPedido({
        cliente_id: cliente.id,
        ruta_id: ruta?.id || ruta?.ruta_id || null,
        origen: form.origen.trim().toUpperCase(),
        destino: form.destino.trim().toUpperCase(),
        origen_pais: canonicalCountry(form.origen_pais || "España") || "España",
        origen_provincia: form.origen_provincia || null,
        destino_pais: canonicalCountry(form.destino_pais || "España") || "España",
        destino_provincia: form.destino_provincia || null,
        cmr_tipo: cmrTypeForPedidoStops({
          ...form,
          puntos_carga: buildCargasRapidas(),
          puntos_descarga: buildDescargasRapidas(),
        }),
        vehiculo_id: colaboradorId ? null : (vehiculoRapidoId || null),
        chofer_id: !colaboradorId && vehiculoRapidoId ? (choferRapidoId || null) : null,
        remolque_id_manual: colaboradorId ? null : (form.remolque_id_manual || vehiculoRapido?.remolque_id || null),
        colaborador_id: colaboradorId || null,
        matricula_colaborador: matriculaManualRapida || null,
        remolque_matricula_colaborador: remolqueColaborador || null,
        fecha_pedido: hoy,
        fecha_carga: form.fecha_carga,
        fecha_descarga: form.fecha_descarga || null,
        hora_carga: form.hora_carga || null,
        hora_descarga: form.hora_descarga || null,
        referencia_cliente: form.referencia_cliente || null,
        puntos_carga: buildCargasRapidas(),
        puntos_descarga: buildDescargasRapidas(),
        estado: conAsignacion ? "confirmado" : "pendiente",
        importe: importeCalculado,
        tipo_carga: "completa",
        carga_trasera: form.tipo_descarga === "trasera",
        carga_lateral: form.tipo_descarga === "lateral",
        condiciones_adicionales: [
          form.tipo_descarga ? `Tipo descarga: ${form.tipo_descarga}` : "",
          form.retorno === "si" ? "Retorno: si" : "Retorno: no",
        ].filter(Boolean).join(" | ") || null,
        tipo_precio: tipoPrecio,
        precio_unitario: precioUnitario,
        cantidad: tarifaDraft.cantidad || null,
        importe_minimo: tipoPrecio === "viaje" ? toNullableNumber(tarifaDraft.importe_minimo) : null,
        minimo_unidades: tipoPrecio !== "viaje" ? toNullableNumber(tarifaDraft.minimo_unidades) : null,
        km_ruta: kmRuta,
        precio_cliente_col: colaboradorId ? importeCalculado : null,
        precio_colaborador: null,
        precio_colaborador_unitario: null,
        minimo_colaborador_unidades: null,
        coste_gasoil: colaboradorId ? 0 : undefined,
        pendiente_completar: true,
        aviso_completar: aviso,
        notas: [aviso, form.observaciones].filter(Boolean).join("\n"),
      });
      onCreado();
    } catch(e) {
      notify(e.message || "No se pudo crear el pedido rapido.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.82)",zIndex:220,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(860px,96vw)",maxHeight:"92vh",overflowY:"auto",boxSizing:"border-box"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:800,color:"var(--text)",marginBottom:4}}>Pedido rapido</div>
        <div style={{fontSize:12,color:"var(--text4)",marginBottom:14}}>
          Captura minima para crear el viaje en segundos. Queda marcado en amarillo para completar datos antes de asignar o cerrar.
        </div>

        <div style={quickGrid}>
          <div style={{gridColumn:"1/-1"}}>
            <label style={S.label}>Cliente *</label>
            <input list="clientes-pedido-rapido" style={inp} value={form.cliente_nombre} onChange={e=>{
              const value = e.target.value;
              const exact = clientes.find(c => (c.nombre || "").trim().toLowerCase() === value.trim().toLowerCase());
              setForm(p => ({
                ...p,
                cliente_nombre: value,
                cliente_id: exact?.id || "",
                ruta_id: exact?.id === p.cliente_id ? p.ruta_id : "",
              }));
            }} placeholder="Nombre del cliente"/>
            <datalist id="clientes-pedido-rapido">
              {clientes.map(c => <option key={c.id} value={c.nombre}/>)}
            </datalist>
            {cleanCliente && matches.length === 0 && (
              <div style={{fontSize:11,color:"#fbbf24",marginTop:4}}>No hay coincidencias. Se creara el cliente como pendiente de revisar.</div>
            )}
          </div>
          {clienteSeleccionadoRapido?.id && (
            <div style={{gridColumn:"1/-1",display:"grid",gap:8}}>
              {bloqueoClienteRapido && (
                <div style={{padding:"10px 12px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,fontSize:12,color:"#b91c1c",fontWeight:800}}>
                  {bloqueoClienteRapido.title}: {bloqueoClienteRapido.message}
                </div>
              )}
              {clienteRiesgoLoadingRapido ? (
                <div style={{padding:"8px 12px",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:7,fontSize:12,color:"var(--text4)"}}>
                  Revisando cobros pendientes y riesgo del cliente...
                </div>
              ) : clienteRiesgoRapido && (
                <div style={{padding:"9px 12px",background:clienteRiesgoRapidoPedido.avisos.length ? "rgba(245,158,11,.09)" : "rgba(16,185,129,.07)",border:`1px solid ${clienteRiesgoRapidoPedido.avisos.length ? "rgba(245,158,11,.28)" : "rgba(16,185,129,.2)"}`,borderRadius:8,fontSize:12,color:"var(--text3)"}}>
                  <div style={{display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
                    <strong style={{color:clienteRiesgoRapidoPedido.avisos.length ? "#f59e0b" : "#10b981"}}>Riesgo cliente</strong>
                    <span style={{fontSize:18,fontWeight:900,color:clienteRiesgoRapidoPedido.avisos.length ? "#f59e0b" : "#10b981",fontFamily:"'JetBrains Mono',monospace"}}>
                      {formatRiskPct(clienteRiesgoRapidoPedido.riesgo_pct_actual)}
                    </span>
                  </div>
                  <div style={{marginTop:4,color:"var(--text4)"}}>
                    Pendiente: {Number(clienteRiesgoRapido.total_pendiente || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
                    {clienteRiesgoRapido.limite_riesgo > 0 ? ` de ${Number(clienteRiesgoRapido.limite_riesgo || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR` : " | sin limite configurado"}
                    {clienteRiesgoRapidoPedido.riesgo_pct_proyectado !== null ? ` | con este pedido: ${formatRiskPct(clienteRiesgoRapidoPedido.riesgo_pct_proyectado)}` : ""}
                  </div>
                </div>
              )}
              <div>
                <label style={S.label}>Tarifa / ruta guardada {rutasCliente.length > 0 ? "*" : ""}</label>
                <select style={S.sel} value={form.ruta_id || ""} onChange={e=>{
                  const ruta = rutasCliente.find(r => String(r.id || r.ruta_id || "") === String(e.target.value));
                  if (ruta) aplicarTarifaRapida(ruta);
                  else setForm(p => ({ ...p, ruta_id: "" }));
                }} disabled={rutasLoading}>
                  <option value="">{rutasLoading ? "Cargando tarifas..." : rutasCliente.length ? "Selecciona tarifa del cliente" : "Sin tarifas guardadas"}</option>
                  {rutasCliente.map(r => <option key={r.id || r.ruta_id} value={r.id || r.ruta_id}>{formatRutaTarifaLabel(r)}</option>)}
                </select>
                <div style={{fontSize:11,color:rutasCliente.length ? "#f59e0b" : "var(--text5)",marginTop:4}}>
                  {rutasCliente.length ? "Opcional: si no eliges tarifa, se creara marcado para revisar ruta/precio." : "No hay tarifas guardadas; puedes completar el precio manualmente."}
                </div>
              </div>
              <div>
                <label style={S.label}>Punto de carga del cliente</label>
                <div style={{display:"flex",gap:6}}>
                  {puntosCargaCliente.length > 0 ? (
                    <PuntoInteresPicker
                      placeholder={puntosCargaCliente.length === 1 ? "Punto de carga cargado" : "Elegir punto de carga del cliente"}
                      puntos={puntosCargaCliente}
                      clienteId={form.cliente_id}
                      tipo="carga"
                      onPick={p=>setForm(x=>applyPuntoCargaToDraft(x, p))}
                      style={{...S.sel,flex:1}}
                    />
                  ) : (
                    <div style={{...S.sel,flex:1,display:"flex",alignItems:"center",color:"var(--text5)",fontSize:12}}>
                      {puntosCargaLoading ? "Cargando puntos..." : "Este cliente no tiene puntos de carga propios"}
                    </div>
                  )}
                  <button type="button" onClick={()=>setPoiDraftRapido({nombre:form.origen || clienteSeleccionadoRapido.nombre,direccion:"",tipo:"carga",cliente_id:clienteSeleccionadoRapido.id,ventana:"",pais:"España"})}
                    style={{...S.btn,background:"transparent",color:"var(--accent)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Crear punto
                  </button>
                </div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>
                  {puntosCargaCliente.length > 1 ? "Este cliente tiene varios puntos de carga: elige el origen correcto." : puntosCargaCliente.length === 1 ? "Origen cargado desde el punto habitual del cliente." : "Sin puntos propios: crea uno nuevo para este cliente."}
                </div>
              </div>
            </div>
          )}
          <div><label style={S.label}>Origen *</label><input style={inp} value={form.origen} onChange={f("origen")} placeholder="MADRID"/></div>
          <div><label style={S.label}>Destino *</label><input style={inp} value={form.destino} onChange={f("destino")} placeholder="VALENCIA"/></div>
          <div><label style={S.label}>Fecha carga *</label><input type="date" min="2000-01-01" max="2100-12-31" style={inp} value={form.fecha_carga} onChange={e=>setForm(p=>({...p,fecha_carga:e.target.value,fecha_descarga:p.fecha_descarga || e.target.value}))}/></div>
          <div><label style={S.label}>Hora carga</label><input type="time" style={inp} value={form.hora_carga} onChange={f("hora_carga")}/></div>
          <div><label style={S.label}>Hora descarga</label><input type="time" style={inp} value={form.hora_descarga} onChange={f("hora_descarga")}/></div>
          <div><label style={S.label}>Fecha descarga</label><input type="date" min="2000-01-01" max="2100-12-31" style={inp} value={form.fecha_descarga || ""} onChange={f("fecha_descarga")}/></div>
          <div>
            <label style={S.label}>Matricula</label>
            <input list="matriculas-pedido-rapido" style={inp} value={form.matricula_rapida} onChange={e=>{
              const value = e.target.value.toUpperCase();
              const match = vehiculosConjunto.find(v => String(v.matricula || "").replace(/[\s-]/g, "").toUpperCase() === value.replace(/[\s-]/g, "").toUpperCase());
              setForm(p => ({
                ...p,
                matricula_rapida: value,
                vehiculo_id: match?.id || p.vehiculo_id,
                chofer_id: match?.chofer_id || p.chofer_id,
                remolque_id_manual: match?.remolque_id || p.remolque_id_manual,
                matricula_colaborador: match ? "" : p.matricula_colaborador,
              }));
            }} placeholder="1234ABC"/>
            <datalist id="matriculas-pedido-rapido">
              {vehiculosConjunto.map(v => <option key={v.id} value={v.matricula}>{labelConjunto(v)}</option>)}
            </datalist>
          </div>
          <div>
            <label style={S.label}>Retorno</label>
            <select style={S.sel} value={form.retorno} onChange={f("retorno")}>
              <option value="no">No</option>
              <option value="si">Si</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Matricula / conjunto</label>
            <select style={S.sel} value={form.vehiculo_id} onChange={e=>{
              const vid = e.target.value;
              const veh = vehiculos.find(v => v.id === vid);
              const choferId = veh?.chofer_id || choferes.find(c => c.vehiculo_id === vid)?.id || "";
              setForm(p => ({
                ...p,
                vehiculo_id: vid,
                chofer_id: choferId,
                remolque_id_manual: veh?.remolque_id || "",
                matricula_colaborador: vid ? "" : p.matricula_colaborador,
                remolque_matricula_colaborador: vid ? "" : p.remolque_matricula_colaborador,
              }));
            }}>
              <option value="">Selecciona matricula / conjunto</option>
              {vehiculosConjunto.map(v => (
                <option key={v.id} value={v.id}>
                  {labelConjunto(v)} {v.marca ? "- " + v.marca : ""} {v.modelo || ""}
                </option>
              ))}
            </select>
              {vehiculoSeleccionado && (
                <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>
                  Conjunto: <strong style={{color:"var(--text3)"}}>{labelConjunto(vehiculoSeleccionado)}</strong>
                {" | "}
                Chofer: <strong style={{color:choferAsignado?"var(--text3)":"#fbbf24"}}>{choferAsignado ? `${choferAsignado.nombre} ${choferAsignado.apellidos || ""}`.trim() : "sin chofer asignado"}</strong>
                </div>
              )}
              {!vehiculoSeleccionado && (
                <div style={{fontSize:11,color:"#fbbf24",marginTop:4}}>
                  Si lo dejas vacio, el viaje se crea sin asignar para planificarlo despues.
                </div>
              )}
            </div>
          <div>
            <label style={S.label}>Matricula colaborador</label>
            <input style={inp} value={form.matricula_colaborador} onChange={e=>{
              const value = e.target.value.toUpperCase();
              setForm(p=>({
                ...p,
                matricula_colaborador:value,
                vehiculo_id:value.trim() ? "" : p.vehiculo_id,
                chofer_id:value.trim() ? "" : p.chofer_id,
                remolque_id_manual:value.trim() ? "" : p.remolque_id_manual,
              }));
            }} placeholder="Ej: 1234ABC"/>
            <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Usalo si el viaje sale con un transportista externo.</div>
          </div>
          <div>
            <label style={S.label}>Colaborador</label>
            <select style={S.sel} value={form.colaborador_id} onChange={e=>setForm(p=>({
              ...p,
              colaborador_id:e.target.value,
              vehiculo_id:e.target.value ? "" : p.vehiculo_id,
              chofer_id:e.target.value ? "" : p.chofer_id,
              remolque_id_manual:e.target.value ? "" : p.remolque_id_manual,
            }))}>
              <option value="">Sin colaborador asignado</option>
              {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nombre} {c.cif ? `- ${c.cif}` : ""}</option>)}
            </select>
            {colaboradorSeleccionado && (
              <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>
                Se guardara como transporte subcontratado y cargara sus matriculas en la orden.
              </div>
            )}
          </div>
          <div>
            <label style={S.label}>Remolque colaborador</label>
            <input style={inp} value={form.remolque_matricula_colaborador} onChange={e=>setForm(p=>({...p,remolque_matricula_colaborador:e.target.value.toUpperCase()}))} placeholder="Opcional"/>
          </div>
          <div>
            <label style={S.label}>Tipo descarga</label>
            <select style={S.sel} value={form.tipo_descarga} onChange={f("tipo_descarga")}>
              <option value="trasera">Trasera</option>
              <option value="lateral">Lateral</option>
              <option value="muelle">Muelle</option>
              <option value="grua">Grua</option>
              <option value="indiferente">Indiferente</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Tipo precio</label>
            <select style={S.sel} value={form.tipo_precio} onChange={e=>setForm(p=>syncCantidadRapida({...p,tipo_precio:e.target.value}, true))}>
              {TIPOS_PRECIO.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>{form.tipo_precio==="viaje" ? "Precio viaje cliente" : form.tipo_precio==="tonelada" ? "EUR/ton cliente" : "Precio unitario cliente"}</label>
            <input type="text" inputMode="decimal" style={inp} value={form.precio_unitario} onChange={f("precio_unitario")} placeholder="Si existe ruta, se cargara al crear"/>
          </div>
          {form.tipo_precio !== "viaje" && (
            <div>
              <label style={S.label}>{form.tipo_precio==="tonelada" ? "Toneladas" : form.tipo_precio==="km" ? "Kilometros" : form.tipo_precio==="palet" ? "Palets" : "Cantidad"}</label>
              <input type="text" inputMode="decimal" style={inp} value={form.cantidad} onChange={f("cantidad")} placeholder="Opcional"/>
            </div>
          )}
          <div>
            <label style={S.label}>{form.tipo_precio==="viaje" ? "Minimo EUR" : "Minimo facturable"}</label>
            <input type="text" inputMode="decimal" style={inp}
              value={form.tipo_precio==="viaje" ? form.importe_minimo : form.minimo_unidades}
              onChange={e=>setForm(p=>({...p,[p.tipo_precio==="viaje" ? "importe_minimo" : "minimo_unidades"]:e.target.value}))}
              placeholder="Si existe ruta, se cargara al crear"/>
          </div>
          <div>
            <label style={S.label}>Km ruta</label>
            <input type="text" inputMode="decimal" style={inp} value={form.km_ruta} onChange={f("km_ruta")} placeholder="Si existe ruta, se cargara al crear"/>
          </div>
          <div style={{background:"rgba(20,184,166,.08)",border:"1px solid rgba(20,184,166,.22)",borderRadius:8,padding:"8px 10px"}}>
            <label style={S.label}>EUR/km venta</label>
            {(() => {
              const eurKm = precioKmPedidoInfo(form);
              return (
                <>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color:eurKm.value ? "var(--green)" : "var(--text5)"}}>{eurKm.label}</div>
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>{eurKm.hint}</div>
                </>
              );
            })()}
          </div>
          <div style={{gridColumn:"1/-1"}}><label style={S.label}>Referencia de carga</label><input style={inp} value={form.referencia_cliente} onChange={f("referencia_cliente")} placeholder="Referencia / carga / orden"/></div>
          <div style={{gridColumn:"1/-1"}}>
            <label style={S.label}>Observaciones</label>
            <textarea style={{...inp,minHeight:58,resize:"vertical"}} value={form.observaciones} onChange={f("observaciones")} placeholder="Ej: levantar techo, llamar antes de cargar, traslado bobinas..." />
          </div>
          <div style={{gridColumn:"1/-1"}}>
            <div style={S.sec}>Puntos de carga</div>
            <ParadasEditor tipo="carga" form={form} setForm={setForm} />
          </div>
          <div style={{gridColumn:"1/-1"}}>
            <div style={S.sec}>Puntos de descarga</div>
            <ParadasEditor tipo="descarga" form={form} setForm={setForm} />
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:18}}>
          <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid var(--border2)"}} onClick={onClose} disabled={saving}>Cancelar</button>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:saving?0.7:1}} onClick={guardarRapido} disabled={saving}>
            {saving ? "Creando..." : "Crear rapido"}
          </button>
        </div>
        {poiDraftRapido && (
          <PuntoInteresModal
            initial={poiDraftRapido}
            onClose={()=>setPoiDraftRapido(null)}
            onSave={(next, saved)=>{
              if (saved) {
                setPuntosCargaCliente(prev => {
                  const exists = prev.some(p => String(p.id) === String(saved.id));
                  return exists ? prev.map(p => String(p.id) === String(saved.id) ? saved : p) : [...prev, saved];
                });
                setForm(p => applyPuntoCargaToDraft(p, saved));
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function PuntoInteresModal({ initial, onClose, onSave }) {
  const initialPoint = normalizePuntoInteresForForm(initial || {});
  const geoRequestRef = React.useRef(0);
  function inferPuntoGeoDraft(draft = {}) {
    const inferred = inferPlaceGeo(draft, draft.ciudad, draft.direccion, draft.nombre);
    if (!inferred) return draft;
    return {
      ...draft,
      pais: draft.pais || canonicalCountry(inferred.pais || "España") || "España",
      provincia: draft.provincia || inferred.provincia || "",
      ciudad: draft.ciudad || inferred.municipio || "",
      lat: draft.lat || inferred.lat || "",
      lng: draft.lng || inferred.lng || "",
    };
  }
  async function completarPuntoGeo(draft = form) {
    const requestId = geoRequestRef.current + 1;
    geoRequestRef.current = requestId;
    const next = await resolveGeoDraft(draft, draft.pais || "EspaÃ±a", draft.ciudad, draft.direccion, draft.nombre);
    let merged = next;
    setForm(current => {
      if (requestId !== geoRequestRef.current) {
        merged = current;
        return current;
      }
      merged = {
        ...current,
        ciudad: current.ciudad || next.ciudad || "",
        pais: current.pais || next.pais || "España",
        provincia: current.provincia || next.provincia || "",
        lat: current.lat || next.lat || "",
        lng: current.lng || next.lng || "",
      };
      return merged;
    });
    return merged;
  }
  const [form, setForm] = useState(() => ({
    id: initialPoint.id || "",
    cliente_id: initialPoint.cliente_id || "",
    punto_general: initialPoint.punto_general,
    nombre: initialPoint.nombre || initialPoint.cliente_nombre || "",
    cif: initialPoint.cif || "",
    direccion: initialPoint.direccion || "",
    codigo_postal: initialPoint.codigo_postal || "",
    ciudad: initialPoint.ciudad || "",
    provincia: initialPoint.provincia || "",
    pais: initial?.pais || "España",
    telefono: initialPoint.telefono || "",
    email: initialPoint.email || "",
    contacto_nombre: initialPoint.contacto_nombre || "",
    contacto_telefono: initialPoint.contacto_telefono || "",
    ventana: initialPoint.ventana || "",
    notas: initialPoint.notas || "",
    tipo: initialPoint.tipo || "ambos",
    google_maps_url: initialPoint.google_maps_url || "",
    lat: initialPoint.lat ?? "",
    lng: initialPoint.lng ?? "",
    metadata: initialPoint.metadata || {},
  }));
  useEffect(() => {
    setForm(p => inferPuntoGeoDraft(p));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = k => e => setForm(p => {
    const next = {...p, [k]: e.target.value};
    return next;
  });
  const setGeneral = e => {
    const checked = e.target.checked;
    setForm(p => ({...p, punto_general: checked, cliente_id: checked ? "" : (initialPoint?.cliente_id || p.cliente_id || "")}));
  };
  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 10px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4,marginTop:10};
  const modalPais = canonicalCountry(form.pais || "España") || "España";
  const modalCountries = Array.from(new Set([...getEnabledEuropeCountries(), modalPais]));
  const modalRegions = getRegionsForCountry(modalPais);
  const modalCountryListId = `poi-countries-${form.id || "nuevo"}`;
  const modalRegionListId = `poi-regions-${form.id || "nuevo"}`;

  async function guardar() {
    if (!form.nombre.trim()) { notify("Indica el nombre de la empresa o punto.", "warning"); return; }
    if (!form.direccion.trim()) { notify("Indica la direccion del punto.", "warning"); return; }
    const resolvedForm = await completarPuntoGeo(form);
    const mapsCoords = coordsFromMapsUrl(resolvedForm.google_maps_url);
    const payload = {
      ...resolvedForm,
      cliente_id: resolvedForm.punto_general ? "" : resolvedForm.cliente_id,
      punto_general: !!resolvedForm.punto_general,
      pais: canonicalCountry(resolvedForm.pais || form.pais || "España") || "España",
      provincia: String(resolvedForm.provincia || "").trim(),
      google_maps_url: cleanMapsUrl(resolvedForm.google_maps_url),
      lat: resolvedForm.lat || mapsCoords?.lat || null,
      lng: resolvedForm.lng || mapsCoords?.lng || null,
    };
    let saved = payload;
    try {
      saved = payload.id ? await editarPuntoInteres(payload.id, payload) : await crearPuntoInteres(payload);
    } catch (e) {
      notify("Punto guardado localmente, pero no se ha sincronizado con la base de datos: " + e.message, "warning");
    }
    const next = savePuntoInteres(saved || payload);
    onSave?.(next, saved || payload);
    onClose();
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.76)",zIndex:520,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:20,width:"min(620px,96vw)",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:900,color:"var(--text)",marginBottom:4}}>{form.id ? "Editar punto de interes" : "Guardar punto de interes"}</div>
        <div style={{fontSize:12,color:"var(--text4)",marginBottom:12}}>Crea una ficha reutilizable para empresas donde cargas o descargas con frecuencia.</div>
        <datalist id={modalCountryListId}>
          {modalCountries.map(country => <option key={country} value={country} />)}
        </datalist>
        <datalist id={modalRegionListId}>
          {modalRegions.map(region => <option key={region} value={region} />)}
        </datalist>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
          <div style={{gridColumn:"1/-1",border:"1px solid var(--border2)",background:"var(--bg3)",borderRadius:9,padding:"10px 12px",marginBottom:4}}>
            <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,fontWeight:800,color:"var(--text)",cursor:(!initial?.cliente_id && !form.cliente_id)?"default":"pointer"}}>
              <input
                type="checkbox"
                checked={!!form.punto_general}
                onChange={setGeneral}
                disabled={!initial?.cliente_id && !form.cliente_id}
                style={{marginTop:2}}
              />
              <span>
                Punto general para todos los clientes
                <span style={{display:"block",fontSize:11,fontWeight:500,color:"var(--text5)",marginTop:2}}>
                  {initial?.cliente_id || form.cliente_id
                    ? "Si no lo marcas, se guarda solo para el cliente del pedido."
                    : "Sin cliente seleccionado, el punto se guarda como general."}
                </span>
              </span>
            </label>
          </div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Nombre empresa / punto *</label><input style={inp} value={form.nombre} onChange={set("nombre")} onBlur={()=>completarPuntoGeo()} autoFocus placeholder="Ej: Logistica Madrid Norte"/></div>
          <div><label style={lbl}>CIF / NIF</label><input style={inp} value={form.cif} onChange={set("cif")} /></div>
          <div><label style={lbl}>Tipo</label><select style={inp} value={form.tipo} onChange={set("tipo")}><option value="ambos">Carga y descarga</option><option value="carga">Carga</option><option value="descarga">Descarga</option></select></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Direccion completa *</label><input style={inp} value={form.direccion} onChange={set("direccion")} onBlur={()=>completarPuntoGeo()} placeholder="Calle, numero, poligono, nave..." /></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Enlace Google Maps</label><input style={inp} value={form.google_maps_url} onChange={e=>setForm(p=>{
            const google_maps_url = e.target.value;
            const coords = coordsFromMapsUrl(google_maps_url);
            return {...p, google_maps_url, lat: p.lat || coords?.lat || "", lng: p.lng || coords?.lng || ""};
          })} onBlur={()=>setForm(p=>{
            const coords = coordsFromMapsUrl(p.google_maps_url);
            return coords ? {...p, lat: p.lat || coords.lat, lng: p.lng || coords.lng} : p;
          })} placeholder="https://maps.google.com/..." /></div>
          <div><label style={lbl}>Latitud</label><input style={inp} value={form.lat ?? ""} onChange={set("lat")} placeholder="Ej: 38.3452" /></div>
          <div><label style={lbl}>Longitud</label><input style={inp} value={form.lng ?? ""} onChange={set("lng")} placeholder="Ej: -0.4815" /></div>
          <div><label style={lbl}>Codigo postal</label><input style={inp} value={form.codigo_postal} onChange={set("codigo_postal")} /></div>
          <div><label style={lbl}>Ciudad</label><input style={inp} value={form.ciudad} onChange={set("ciudad")} onBlur={()=>completarPuntoGeo()} /></div>
          <div>
            <label style={lbl}>Pais *</label>
            <input
              list={modalCountryListId}
              style={inp}
              value={modalPais}
              onChange={e=>setForm(p=>({...p,pais:e.target.value,provincia:""}))}
              onKeyDown={e=>completeOnTab(e, modalCountries, modalPais, value=>setForm(p=>({...p,pais:value,provincia:""})))}
              placeholder="España"
            />
          </div>
          <div>
            <label style={lbl}>Provincia / region</label>
            <input
              list={modalRegionListId}
              style={inp}
              value={form.provincia || ""}
              onChange={set("provincia")}
              onKeyDown={e=>completeOnTab(e, modalRegions, form.provincia || "", value=>setForm(p=>({...p,provincia:value})))}
              placeholder={modalRegions.length ? "Selecciona de la lista" : "Region / provincia"}
            />
          </div>
          <div><label style={lbl}>Telefono empresa</label><input style={inp} value={form.telefono} onChange={set("telefono")} /></div>
          <div><label style={lbl}>Email</label><input type="email" style={inp} value={form.email} onChange={set("email")} /></div>
          <div><label style={lbl}>Contacto</label><input style={inp} value={form.contacto_nombre} onChange={set("contacto_nombre")} /></div>
          <div><label style={lbl}>Telefono contacto</label><input style={inp} value={form.contacto_telefono} onChange={set("contacto_telefono")} /></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Horario / ventana habitual</label><input style={inp} value={form.ventana} onChange={set("ventana")} placeholder="Ej: 08:00-14:00" /></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Notas operativas</label><textarea style={{...inp,height:74,resize:"vertical"}} value={form.notas} onChange={set("notas")} placeholder="Ej: entrada por puerta 3, pedir referencia en garita..." /></div>
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
          <button type="button" onClick={onClose} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text4)"}}>Cancelar</button>
          <button type="button" onClick={guardar} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>Guardar punto</button>
        </div>
      </div>
    </div>
  );
}

function FacturarConcepto({ pedido, onConfirm, onCancel, saving = false }) {
  const hoy = new Date();
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0,10);
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth()+1, 0).toISOString().slice(0,10);
  const fmtES = d => d ? new Date(d).toLocaleDateString("es-ES",{day:"2-digit",month:"long",year:"numeric"}) : "";

  const [modo, setModo] = useState("unalinea"); // unalinea | detallado
  const [concepto, setConcepto] = useState(
    `VIAJES REALIZADOS DEL ${fmtES(primerDia).toUpperCase()} AL ${fmtES(ultimoDia).toUpperCase()}`
  );
  const [fechaDesde, setFechaDesde] = useState(primerDia);
  const [fechaHasta, setFechaHasta] = useState(ultimoDia);
  const [importe, setImporte] = useState(pedido.importe||0);

  // Auto-update concepto when dates change
  const actualizarConcepto = (desde, hasta) => {
    setConcepto(`VIAJES REALIZADOS DEL ${fmtES(desde).toUpperCase()} AL ${fmtES(hasta).toUpperCase()}`);
  };

  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10};

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["unalinea","Una linea"],["detallado","Personalizar"]].map(([v,l])=>(
          <button key={v} onClick={()=>setModo(v)}
            style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${modo===v?"var(--accent)":"var(--border2)"}`,
                    background:modo===v?"var(--accent)":"var(--bg3)",color:modo===v?"#fff":"var(--text3)",
                    fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>
            {l}
          </button>
        ))}
      </div>
      {modo==="unalinea" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 10px"}}>
            <div>
              <label style={lbl}>Desde</label>
              <input type="date" min="2000-01-01" max="2100-12-31" style={inp} value={fechaDesde} onChange={e=>{setFechaDesde(e.target.value);actualizarConcepto(e.target.value,fechaHasta);}}/>
            </div>
            <div>
              <label style={lbl}>Hasta</label>
              <input type="date" min="2000-01-01" max="2100-12-31" style={inp} value={fechaHasta} onChange={e=>{setFechaHasta(e.target.value);actualizarConcepto(fechaDesde,e.target.value);}}/>
            </div>
          </div>
          <label style={lbl}>Concepto de la factura</label>
          <textarea value={concepto} onChange={e=>setConcepto(e.target.value)}
            style={{...inp,minHeight:60,resize:"vertical"}}/>
          <label style={lbl}>Importe (EUR)</label>
          <input type="number" step="0.01" style={inp} value={importe} onChange={e=>setImporte(e.target.value)}/>
        </div>
      )}
      {modo==="detallado" && (
        <div>
          <div style={{background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.15)",borderRadius:7,padding:"8px 12px",fontSize:12,color:"var(--text3)",marginBottom:10}}>
            Personaliza el concepto como quieras. El importe es editable.
          </div>
          <label style={lbl}>Concepto *</label>
          <textarea value={concepto} onChange={e=>setConcepto(e.target.value)} style={{...inp,minHeight:60,resize:"vertical"}}/>
          <label style={lbl}>Importe (EUR)</label>
          <input type="number" step="0.01" style={inp} value={importe} onChange={e=>setImporte(e.target.value)}/>
        </div>
      )}
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <button style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={onCancel}>Cancelar</button>
        <button style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--green)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:saving?"not-allowed":"pointer",opacity:saving?0.7:1}}
          onClick={()=>onConfirm({...pedido,conceptoFactura:concepto,importeFactura:parseFloat(importe)||pedido.importe})}
          disabled={saving}>
          {saving?"Creando...":"Emitir factura"}
        </button>
      </div>
    </div>
  );
}

// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Panel de pago a colaborador con adjunto de factura y fecha de pago ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function PagoColaboradorPanel({ pedido, onUpdated }) {
  const [estado, setEstado] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getPedidoColaboradorPago(pedido.id)
      .then((data) => {
        if (alive) {
          setEstado(data && data.factura_nombre ? data : null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setEstado(null);
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [pedido.id]);

  function calcFechaPago(fechaRecepcion) {
    const empresa = getEmpresaPerfilSync();
    const plazo   = Number(empresa.plazo_pago_colaboradores || 60);
    const dias    = (empresa.dias_pago_colaboradores || "15").split(",").map(d => parseInt(d.trim())).filter(d => !isNaN(d));
    const forma   = empresa.forma_pago_colaboradores || "dias_fijos";

    const base = new Date(fechaRecepcion);
    base.setDate(base.getDate() + plazo);

    if (forma === "transferencia_inmediata") return base.toISOString().slice(0, 10);
    if (forma === "fin_mes") {
      base.setMonth(base.getMonth() + 1, 0);
      return base.toISOString().slice(0, 10);
    }
    // dias_fijos: encontrar el proximo dia de pago tras la fecha base
    const diaBase = base.getDate();
    const mesBase = base.getMonth();
    const anoBase = base.getFullYear();
    const diasOrdenados = [...dias].sort((a, b) => a - b);
    const siguiente = diasOrdenados.find(d => d >= diaBase);
    if (siguiente) {
      return new Date(anoBase, mesBase, siguiente).toISOString().slice(0, 10);
    } else {
      // next month, first payment day
      return new Date(anoBase, mesBase + 1, diasOrdenados[0]).toISOString().slice(0, 10);
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const hoy = new Date().toISOString().slice(0, 10);
      const fechaPago = calcFechaPago(hoy);
      const nuevo = {
        factura_nombre: file.name,
        factura_data:   reader.result,
        fecha_recepcion: hoy,
        fecha_pago_calculada: fechaPago,
        importe: Number(pedido.precio_colaborador || 0),
        pagado: false,
      };
      const saved = await guardarPedidoColaboradorPago(pedido.id, nuevo).catch((err) => {
        notify(err.message || "No se pudo guardar el pago del colaborador", "error");
        return null;
      });
      if (saved) {
        setEstado(saved);
        if (typeof onUpdated === "function") onUpdated(saved);
      }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  async function marcarPagado() {
    const ok = await confirmDialog({
      title: "Marcar pago",
      message: "Marcar como pagado al colaborador?",
      confirmText: "Marcar pagado",
    });
    if (!ok) return;
    const updated = await guardarPedidoColaboradorPago(pedido.id, {
      ...estado,
      pagado: true,
      fecha_pago_real: new Date().toISOString().slice(0, 10),
    }).catch((err) => {
      notify(err.message || "No se pudo marcar el pago", "error");
      return null;
    });
    if (!updated) return;
    setEstado(updated);
    if (typeof onUpdated === "function") onUpdated(updated);
  }

  function verFactura() {
    if (!estado?.factura_data) return;
    const a = document.createElement("a");
    a.href = estado.factura_data;
    a.download = estado.factura_nombre;
    a.click();
  }

  const fmt2l = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2 });

  if (loading) {
    return (
      <div style={{ marginTop: 10, border: "1px dashed var(--border2)", borderRadius: 8, padding: "14px 16px", color: "var(--text4)", fontSize: 12 }}>
        Cargando pago del colaborador...
      </div>
    );
  }

  if (!estado) {
    return (
      <div style={{ marginTop: 10, border: "1.5px dashed rgba(251,191,36,.4)", borderRadius: 8, padding: "14px 16px" }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: "#fbbf24", marginBottom: 6 }}>Pendiente - adjunta la factura del colaborador</div>
        <div style={{ fontSize: 11, color: "var(--text4)", marginBottom: 10 }}>
          Una vez recibida la factura, adjuntala aqui. El sistema calculara automaticamente la fecha de pago segun las condiciones configuradas en Mi Empresa.
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 7, background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.3)", cursor: uploading ? "wait" : "pointer", fontSize: 12, fontWeight: 600, color: "#fbbf24", fontFamily: "'DM Sans',sans-serif" }}>
          {uploading ? "Subiendo..." : "Adjuntar factura del colaborador"}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" onChange={handleFile} style={{ display: "none" }} disabled={uploading}/>
        </label>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, background: estado.pagado ? "rgba(16,185,129,.07)" : "rgba(251,191,36,.07)", border: `1.5px solid ${estado.pagado ? "rgba(16,185,129,.3)" : "rgba(251,191,36,.35)"}`, borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: estado.pagado ? "#10b981" : "#fbbf24" }}>
          {estado.pagado ? "Pagado al colaborador" : "Pendiente de pago"}
        </div>
        {estado.pagado && (
          <div style={{ fontSize: 11, color: "var(--text4)" }}>Pagado el {new Date(estado.fecha_pago_real).toLocaleDateString("es-ES")}</div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
        {[
          ["Importe colaborador", fmt2l(estado.importe) + " EUR", "#ef4444"],
          ["Factura recibida", new Date(estado.fecha_recepcion).toLocaleDateString("es-ES"), "var(--text)"],
          ["Fecha pago calculada", new Date(estado.fecha_pago_calculada).toLocaleDateString("es-ES"), estado.pagado ? "#10b981" : "#f59e0b"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "var(--bg3)", borderRadius: 7, padding: "8px 10px" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 13, color: c }}>{v}</div>
            <div style={{ fontSize: 10, color: "var(--text5)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={verFactura} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text3)", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {estado.factura_nombre?.length > 20 ? estado.factura_nombre.slice(0, 20) + "..." : estado.factura_nombre}
        </button>
        {!estado.pagado && (
          <button onClick={marcarPagado} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "rgba(16,185,129,.15)", color: "#10b981", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
            Marcar como pagado
          </button>
        )}
        {!estado.pagado && (
          <label style={{ padding: "5px 12px", borderRadius: 6, border: "1px dashed var(--border2)", background: "transparent", color: "var(--text5)", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
            Cambiar factura
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} style={{ display: "none" }}/>
          </label>
        )}
      </div>
    </div>
  );
}


// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ DescargasEditor: gestiona multiples puntos de descarga ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function ParadasEditor({ tipo, form, setForm, disabled, pedidoId }) {
  const [adding, setAdding] = useState(false);
  const [puntosInteres, setPuntosInteres] = useState(getPuntosInteres);
  const emptyStop = { direccion:"", cliente_nombre:"", fecha:"", hora:"", ventana:"", bultos:"", peso_kg:"", precio:"", referencia:"", notas:"", google_maps_url:"", pais:"España", provincia:"" };
  const [newStop, setNewStop] = useState(emptyStop);
  const [newStopDetailsOpen, setNewStopDetailsOpen] = useState(false);
  const [puntoQuery, setPuntoQuery] = useState("");
  const [poiDraft, setPoiDraft] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const key = tipo === "carga" ? "puntos_carga" : "puntos_descarga";
  const mainLugar = tipo === "carga" ? form.origen : form.destino;
  const mainFecha = tipo === "carga" ? form.fecha_carga : form.fecha_descarga;
  const mainHora = tipo === "carga" ? form.hora_carga : form.hora_descarga;
  const fallbackPais = tipo === "carga" ? (form.origen_pais || "España") : (form.destino_pais || "España");
  const fallbackProvincia = tipo === "carga" ? (form.origen_provincia || "") : (form.destino_provincia || "");
  const inferStopGeo = (stop = {}, idx = 0) => {
    const inferred = inferPlaceGeo(stop, stopAddress(stop), stop.cliente_nombre, stop.direccion, stop.pais);
    return {
      ...stop,
      pais: stopCountryInputValue(stop, idx === 0 ? fallbackPais : "España") || canonicalCountry(inferred?.pais || "") || fallbackPais || "España",
      provincia: inferred?.provincia || stopRegion(stop) || (idx === 0 ? fallbackProvincia : ""),
    };
  };
  const resolveStopGeo = async (stop = {}, idx = 0) => {
    const local = inferStopGeo(stop, idx);
    if (local.provincia && (local.lat != null || local.lng != null)) return local;
    const resolved = await resolveGeoDraft(
      local,
      stopCountryInputValue(local, idx === 0 ? fallbackPais : "EspaÃ±a"),
      stopAddress(local),
      local.cliente_nombre
    );
    return inferStopGeo(resolved, idx);
  };
  const completarNewStopGeo = async () => {
    const next = await resolveStopGeo(newStop, stopsOrdenados.length ? 1 : 0);
    setNewStop(next);
    return next;
  };
  const { primary: primaryStop, extras: paradas } = splitPrimaryAndAdditionalStops(form[key], mainLugar);
  const effectivePrimary = primaryStop
    ? inferStopGeo({
        ...primaryStop,
        direccion: stopAddress(primaryStop) || mainLugar || "",
        fecha: primaryStop.fecha || mainFecha || "",
        hora: primaryStop.hora || mainHora || "",
        tipo,
        es_principal: true,
        es_adicional: false,
      }, 0)
    : (mainLugar ? inferStopGeo({ direccion: mainLugar, fecha: mainFecha || "", hora: mainHora || "", pais: fallbackPais, provincia: fallbackProvincia, tipo, es_principal: true, es_adicional: false }, 0) : null);
  const stopsOrdenados = effectivePrimary ? [effectivePrimary, ...paradas] : paradas;
  useEffect(() => {
    const inferred = inferPlaceGeo(mainLugar);
    if (!mainLugar || !inferred?.provincia) return;
    setForm(p => {
      if (tipo === "carga") {
        if (p.origen_provincia && normalizePlaceText(p.origen_provincia) === normalizePlaceText(inferred.provincia)) return p;
        return {
          ...p,
          origen_pais: p.origen_pais || canonicalCountry(inferred.pais || "España") || "España",
          origen_provincia: inferred.provincia,
        };
      }
      if (p.destino_provincia && normalizePlaceText(p.destino_provincia) === normalizePlaceText(inferred.provincia)) return p;
      return {
        ...p,
        destino_pais: p.destino_pais || canonicalCountry(inferred.pais || "España") || "España",
        destino_provincia: inferred.provincia,
      };
    });
  }, [mainLugar, setForm, tipo]);
  useEffect(() => {
    let alive = true;
    async function run() {
      if (!mainLugar || fallbackProvincia) return;
      const inferred = await resolveGeoDraft({ direccion: mainLugar, pais: fallbackPais }, fallbackPais, mainLugar);
      if (!alive || !inferred?.provincia) return;
      setForm(p => {
        if (tipo === "carga") {
          if (p.origen_provincia && normalizePlaceText(p.origen_provincia) === normalizePlaceText(inferred.provincia)) return p;
          return {
            ...p,
            origen_pais: p.origen_pais || canonicalCountry(inferred.pais || "EspaÃ±a") || "EspaÃ±a",
            origen_provincia: inferred.provincia,
          };
        }
        if (p.destino_provincia && normalizePlaceText(p.destino_provincia) === normalizePlaceText(inferred.provincia)) return p;
        return {
          ...p,
          destino_pais: p.destino_pais || canonicalCountry(inferred.pais || "EspaÃ±a") || "EspaÃ±a",
          destino_provincia: inferred.provincia,
        };
      });
    }
    run();
    return () => { alive = false; };
  }, [fallbackPais, fallbackProvincia, mainLugar, setForm, tipo]);
  const puntosFiltrados = filterPuntosForPedido(puntosInteres, { clienteId: form.cliente_id || "", tipo });
  const puntosListId = `puntos-${tipo}-${pedidoId || "nuevo"}`;
  const countryListId = `paises-${tipo}-${pedidoId || "nuevo"}`;
  const paisesActivos = getEnabledEuropeCountries();
  const normalizarBusqueda = (v) => String(v || "").trim().toLowerCase();
  const buscarPuntoExacto = (texto) => {
    const q = normalizarBusqueda(texto);
    if (!q) return null;
    return puntosFiltrados.find(p =>
      normalizarBusqueda(p.nombre) === q ||
      normalizarBusqueda(p.direccion) === q ||
      normalizarBusqueda(`${p.nombre || ""} - ${p.direccion || ""}`) === q
    ) || null;
  };
  const textoBusquedaPuntos = normalizarBusqueda(puntoQuery);
  const puntosBusqueda = textoBusquedaPuntos
    ? puntosFiltrados
        .filter(p => [
          p.nombre,
          p.direccion,
          p.ciudad,
          p.provincia,
          p.pais,
          `${p.nombre || ""} - ${p.direccion || ""}`,
        ].some(v => normalizarBusqueda(v).includes(textoBusquedaPuntos)))
        .slice(0, 8)
    : [];
  const noExistePuntoBusqueda = textoBusquedaPuntos.length >= 3 && puntosBusqueda.length === 0;
  const aplicarPuntoGuardado = (punto) => {
    if (!punto) return;
    setPuntoQuery(punto.nombre || punto.direccion || "");
    setNewStop(prev => inferStopGeo({
      ...prev,
      ...puntoToStop(punto),
      pais: stopCountry(punto, prev.pais || "España"),
      provincia: stopRegion(punto, prev.provincia || ""),
      cliente_nombre: punto.cliente_nombre || punto.nombre || prev.cliente_nombre || "",
    }, stopsOrdenados.length ? 1 : 0));
  };
  const resetNewStop = () => {
    setNewStop(emptyStop);
    setPuntoQuery("");
    setNewStopDetailsOpen(false);
  };
  const puntoToSelectableStop = (punto) => {
    const puntoStop = puntoToStop(punto);
    const selectable = {
      ...newStop,
      ...puntoStop,
      punto_interes_id: punto?.id || puntoStop.punto_interes_id,
      direccion: puntoStop.direccion || newStop.direccion || puntoQuery.trim(),
      cliente_nombre: punto?.cliente_nombre || punto?.nombre || puntoStop.cliente_nombre || newStop.cliente_nombre || "",
      fecha: newStop.fecha || puntoStop.fecha || mainFecha || "",
      hora: newStop.hora || puntoStop.hora || mainHora || "",
      pais: stopCountry(puntoStop, newStop.pais || "EspaÃ±a"),
      provincia: stopRegion(puntoStop, newStop.provincia || ""),
      tipo,
    };
    return inferStopGeo(selectable, stopsOrdenados.length ? 1 : 0);
  };
  const usarPuntoBuscado = (punto, modo = "adicional") => {
    if (!punto) return;
    const stop = puntoToSelectableStop(punto);
    if (modo === "principal" || !stopsOrdenados.length) {
      setStopsOrdenados([{...stop, es_principal:true, es_adicional:false}, ...stopsOrdenados.slice(1)]);
    } else {
      setStopsOrdenados([...stopsOrdenados, {...stop, es_principal:false, es_adicional:true}]);
    }
    resetNewStop();
    setAdding(false);
  };
  const abrirCrearPunto = () => {
    const texto = (puntoQuery || newStop.cliente_nombre || newStop.direccion || "").trim();
    setPoiDraft({
      ...newStop,
      nombre: newStop.cliente_nombre || texto,
      direccion: newStop.direccion || texto,
      tipo,
      cliente_id: form.cliente_id || "",
    });
  };

  useEffect(() => {
    if (tipo !== "descarga" || !pedidoId || parseStops(form.puntos_descarga).length) return;
    getDescargas(pedidoId)
      .then(d => {
        if (!Array.isArray(d) || !d.length) return;
        setForm(p => ({...p, puntos_descarga: d.map(x => ({
          direccion: x.direccion || "",
          cliente_nombre: x.cliente_nombre || "",
          fecha: x.fecha_descarga || "",
          hora: x.hora_descarga || "",
          ventana: [x.ventana_inicio, x.ventana_fin].filter(Boolean).join("-"),
          bultos: x.bultos || "",
          peso_kg: x.peso_kg || "",
          precio: x.precio || "",
          referencia: x.referencia || x.referencia_cliente || "",
          notas: x.notas || "",
        }))}));
      })
      .catch(() => {});
  }, [form.puntos_descarga, pedidoId, setForm, tipo]);

  useEffect(() => {
    const refresh = () => setPuntosInteres(getPuntosInteres());
    let alive = true;
    syncPuntosInteresCache((next) => { if (alive) setPuntosInteres(next); });
    window.addEventListener("tms:puntos-interes", refresh);
    return () => {
      alive = false;
      window.removeEventListener("tms:puntos-interes", refresh);
    };
  }, []);

  function setStopsOrdenados(nextStops) {
    setForm(p => {
      const stopsToStore = nextStops
        .filter(stop => stopAddress(stop) || stop?.cliente_nombre || stop?.google_maps_url)
        .map((stop, idx) => inferStopGeo({
          ...stop,
          tipo,
          es_principal: idx === 0,
          es_adicional: idx !== 0,
        }, idx));
      const first = stopsToStore[0] || {};
      const updated = {...p, [key]: stopsToStore};
      if (tipo === "carga") {
        updated.origen = stopAddress(first) || "";
        updated.fecha_carga = first.fecha || "";
        updated.hora_carga = first.hora || "";
        updated.origen_pais = stopCountryInputValue(first, p.origen_pais || "España");
        updated.origen_provincia = stopRegion(first, p.origen_provincia || "");
      } else {
        updated.destino = stopAddress(first) || "";
        updated.fecha_descarga = first.fecha || "";
        updated.hora_descarga = first.hora || "";
        updated.destino_pais = stopCountryInputValue(first, p.destino_pais || "España");
        updated.destino_provincia = stopRegion(first, p.destino_provincia || "");
      }
      updated.cmr_tipo = cmrTypeForPedidoStops(updated);
      const totalCarga = tipo === "carga" ? sumStopWeights(stopsToStore) : sumStopWeights(updated.puntos_carga);
      const totalDescarga = tipo === "descarga" ? sumStopWeights(stopsToStore) : sumStopWeights(updated.puntos_descarga);
      const totalPeso = totalCarga || totalDescarga;
      if (totalPeso > 0) {
        updated.peso_kg = totalPeso;
        if (!updated.colaborador_id && Number(updated.km_ruta || 0) > 0) updated.coste_gasoil = calcularCosteGasoil(updated);
      }
      return syncPrecioClienteCol(updated);
    });
  }
  async function addParada() {
    if (!newStop.direccion.trim()) { notify("La direccion es obligatoria", "warning"); return; }
    const resolvedStop = await resolveStopGeo({...newStop, direccion:newStop.direccion.trim(), es_adicional:true, es_principal:false}, 1);
    setStopsOrdenados([...stopsOrdenados, resolvedStop]);
    setNewStop(emptyStop);
    setNewStopDetailsOpen(false);
    setAdding(false);
  }
  function updateStop(idx, patch) {
    const next = stopsOrdenados.map((stop, i) => i === idx ? inferStopGeo({ ...stop, ...patch }, i) : stop);
    setStopsOrdenados(next);
  }
  function removeStop(idx) {
    if (stopsOrdenados.length <= 1) return;
    setStopsOrdenados(stopsOrdenados.filter((_, i) => i !== idx));
  }
  function moveStop(idx, delta) {
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= stopsOrdenados.length) return;
    const next = [...stopsOrdenados];
    [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
    setStopsOrdenados(next);
  }
  function dropStop(overIdx) {
    if (disabled || dragIdx === null || dragIdx === overIdx) return;
    const next = [...stopsOrdenados];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(overIdx, 0, moved);
    setStopsOrdenados(next);
    setDragIdx(null);
  }

  const inp = {width:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"6px 10px",borderRadius:6,fontSize:12,outline:"none"};
  const label = tipo === "carga" ? "carga" : "descarga";
  const newStopPais = stopCountryInputValue(newStop, "España");
  const newStopRegions = getRegionsForCountry(newStopPais);
  const newStopRegionListId = `regiones-${tipo}-${pedidoId || "nuevo"}-new`;

  return (
    <div className="tg-stop-editor">
      <style>{`
        .tg-stop-editor { container-type:inline-size; }
        .tg-stop-editor, .tg-stop-editor * { box-sizing:border-box; min-width:0; }
        .tg-stop-editor input, .tg-stop-editor select, .tg-stop-editor textarea, .tg-stop-editor button { max-width:100%; }
        .tg-stop-add-card { width:100%; max-width:100%; overflow:hidden; }
        .tg-stop-add-grid { width:100%; max-width:100%; }
        .tg-stop-schedule-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        .tg-stop-details-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        .tg-stop-grid-wide { grid-column:1/-1 !important; }
        @container (max-width: 700px) {
          .tg-stop-add-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
          .tg-stop-add-grid > select, .tg-stop-address, .tg-stop-add-grid > [style*="grid-column:1/-1"] { grid-column:1/-1 !important; }
          .tg-stop-card { display:grid !important; grid-template-columns:auto minmax(0,1fr) !important; align-items:start !important; }
          .tg-stop-card-body { width:100% !important; }
          .tg-stop-card-actions { grid-column:1/-1; justify-self:end; max-width:100%; flex-wrap:wrap; }
          .tg-stop-footer { align-items:stretch !important; }
          .tg-stop-footer-group { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); flex:1 1 260px; }
          .tg-stop-footer-group > button { width:100%; }
        }
        @container (max-width: 460px) {
          .tg-stop-add-grid, .tg-stop-mini-grid, .tg-stop-schedule-grid, .tg-stop-details-grid { grid-template-columns:minmax(0,1fr) !important; }
          .tg-stop-add-grid > * { grid-column:1/-1 !important; }
          .tg-stop-card { grid-template-columns:1fr !important; }
          .tg-stop-card > span { display:none; }
          .tg-stop-card-actions { grid-column:1; justify-self:stretch; justify-content:flex-end; }
          .tg-stop-footer { display:grid !important; grid-template-columns:1fr !important; }
          .tg-stop-footer-group { width:100%; }
        }
        @media (max-width: 760px) {
          .tg-stop-add-grid, .tg-stop-mini-grid, .tg-stop-schedule-grid, .tg-stop-details-grid { grid-template-columns:minmax(0,1fr) !important; }
          .tg-stop-add-grid > * { grid-column:1/-1 !important; }
          .tg-stop-card { align-items:flex-start !important; flex-wrap:wrap !important; }
          .tg-stop-card-body { flex:1 1 100% !important; }
          .tg-stop-footer { display:grid !important; grid-template-columns:1fr !important; }
          .tg-stop-footer-group { width:100%; }
        }
      `}</style>
      <datalist id={countryListId}>
        {paisesActivos.map(country => <option key={country} value={country} />)}
      </datalist>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
        <span style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase"}}>{tipo === "carga" ? "Carga principal" : "Descarga principal"}</span>
        <span style={{fontSize:11,color:"var(--text5)"}}>-&gt; {mainLugar||"Sin direccion"} - {mainFecha||"Sin fecha"}{mainHora?` - ${mainHora}`:""}</span>
      </div>

      {stopsOrdenados.length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
          {stopsOrdenados.map((d, i) => {
            const isPrimary = i === 0;
            const isDragging = dragIdx === i;
            const stopPais = stopCountryInputValue(d, "España");
            const stopRegions = getRegionsForCountry(stopPais);
            const stopRegionListId = `regiones-${tipo}-${pedidoId || "nuevo"}-${i}`;
            return (
            <div
              className="tg-stop-card"
              key={`${key}-${i}-${stopAddress(d) || d.cliente_nombre || "stop"}`}
              draggable={!disabled && stopsOrdenados.length > 1}
              onDragStart={e=>{ setDragIdx(i); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={e=>{ if (!disabled && dragIdx !== null) e.preventDefault(); }}
              onDrop={e=>{ e.preventDefault(); dropStop(i); }}
              onDragEnd={()=>setDragIdx(null)}
              style={{
                background:isPrimary ? "rgba(20,184,166,.08)" : "var(--bg4)",
                border:`1px solid ${dragIdx !== null && dragIdx !== i ? "rgba(20,184,166,.38)" : "var(--border2)"}`,
                borderRadius:8,
                padding:"8px 12px",
                display:"flex",
                gap:10,
                alignItems:"center",
                opacity:isDragging ? .45 : 1,
                cursor:!disabled && stopsOrdenados.length > 1 ? "grab" : "default",
              }}
            >
              <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:isPrimary?"var(--green)":"var(--accent)",minWidth:20}}>{i+1}</span>
              <div className="tg-stop-card-body" style={{flex:1}}>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:12,color:"var(--text)"}}>{stopAddress(d)}</span>
                  <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",color:isPrimary?"var(--green)":"var(--text5)"}}>
                    {isPrimary ? "Principal" : "Secundaria"}
                  </span>
                </div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                  {d.cliente_nombre && <span style={{marginRight:8}}>{d.cliente_nombre}</span>}
                  {d.fecha && <span style={{marginRight:8}}>{new Date(d.fecha).toLocaleDateString("es-ES")}</span>}
                  {d.hora && <span style={{marginRight:8}}>{d.hora}</span>}
                  {d.ventana && <span style={{marginRight:8}}>{d.ventana}</span>}
                  {d.bultos && <span style={{marginRight:8}}>{d.bultos} bultos</span>}
                  {d.referencia && <span style={{marginRight:8}}>Ref. {d.referencia}</span>}
                  {Number(d.precio||0) > 0 && <span style={{color:"var(--green)",fontWeight:700}}>+{Number(d.precio).toFixed(2)} EUR</span>}
                </div>
                <datalist id={stopRegionListId}>
                  {stopRegions.map(region => <option key={region} value={region} />)}
                </datalist>
                <div className="tg-stop-mini-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginTop:6,maxWidth:680}}>
                  <input
                    list={countryListId}
                    style={inp}
                    disabled={disabled}
                    value={stopPais}
                    onChange={e=>updateStop(i, { pais:e.target.value, provincia:"" })}
                    onKeyDown={e=>completeOnTab(e, Array.from(new Set([...paisesActivos, stopPais])), stopPais, value=>updateStop(i, { pais:value, provincia:"" }))}
                    placeholder="País"
                  />
                  <input
                    list={stopRegionListId}
                    style={inp}
                    disabled={disabled}
                    value={stopRegion(d)}
                    onChange={e=>updateStop(i, { provincia:e.target.value })}
                    onKeyDown={e=>completeOnTab(e, stopRegions, stopRegion(d), value=>updateStop(i, { provincia:value }))}
                    placeholder="Provincia / región"
                  />
                  <input
                    style={inp}
                    disabled={disabled}
                    value={d.referencia || ""}
                    onChange={e=>updateStop(i, { referencia:e.target.value })}
                    placeholder={`Referencia ${label}`}
                  />
                </div>
              </div>
              {!disabled && (
                <div className="tg-stop-card-actions" style={{display:"flex",gap:2,alignItems:"center"}}>
                  <span title="Arrastra para reordenar" style={{color:"var(--text5)",fontSize:14,padding:"0 3px"}}>::</span>
                  <button type="button" onClick={() => moveStop(i, -1)} disabled={i===0} style={{background:"none",border:"none",color:"var(--text5)",cursor:i===0?"not-allowed":"pointer",fontSize:13,padding:"2px 4px"}}>Subir</button>
                  <button type="button" onClick={() => moveStop(i, 1)} disabled={i===stopsOrdenados.length-1} style={{background:"none",border:"none",color:"var(--text5)",cursor:i===stopsOrdenados.length-1?"not-allowed":"pointer",fontSize:13,padding:"2px 4px"}}>Bajar</button>
                  <button type="button" onClick={() => removeStop(i)} disabled={stopsOrdenados.length<=1} style={{background:"none",border:"none",color:stopsOrdenados.length<=1?"var(--text5)":"var(--red)",cursor:stopsOrdenados.length<=1?"not-allowed":"pointer",fontSize:14,padding:"2px 6px"}}>x</button>
                </div>
              )}
            </div>
          )})}
        </div>
      )}

      {!disabled && (adding ? (
        <div className="tg-stop-add-card" style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,padding:12,marginTop:6}}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,padding:10,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:12,fontWeight:900,color:"var(--text)",textTransform:"uppercase",letterSpacing:".04em"}}>{tipo === "carga" ? "Origen / punto de carga" : "Destino / punto de descarga"}</div>
                <div style={{fontSize:11,color:"var(--text5)"}}>Escribe la poblacion o selecciona un punto guardado del cliente.</div>
              </div>
            </div>
            <input
              style={{...inp,width:"100%",boxSizing:"border-box"}}
              placeholder={`Buscar por nombre, direccion o poblacion de ${label}...`}
              value={puntoQuery}
              onChange={e=>setPuntoQuery(e.target.value)}
            />
            {puntosBusqueda.length > 0 && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8,marginTop:8}}>
                {puntosBusqueda.map(p=>(
                  <div key={p.id || `${p.nombre}-${p.direccion}`} style={{border:"1px solid var(--border2)",borderRadius:8,padding:9,background:"var(--bg3)"}}>
                    <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{p.nombre || "Punto sin nombre"}</div>
                    <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>{p.direccion || "-"}{p.ciudad ? ` · ${p.ciudad}` : ""}</div>
                    <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                      <button type="button" onClick={()=>usarPuntoBuscado(p, "principal")} style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--accent)",background:"rgba(20,184,166,.08)",color:"var(--accent)",fontSize:11,fontWeight:800,cursor:"pointer"}}>Usar principal</button>
                      <button type="button" onClick={()=>usarPuntoBuscado(p, "adicional")} style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"transparent",color:"var(--text4)",fontSize:11,fontWeight:800,cursor:"pointer"}}>Anadir parada</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {noExistePuntoBusqueda && (
              <div style={{marginTop:8,padding:9,borderRadius:8,border:"1px solid rgba(245,158,11,.35)",background:"rgba(245,158,11,.08)",display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:12,color:"var(--text4)"}}>No hay ningun punto guardado con esa busqueda. Puedes usarlo como poblacion o guardarlo como punto.</span>
                <button type="button" onClick={abrirCrearPunto} style={{padding:"5px 12px",borderRadius:6,border:"1px solid rgba(245,158,11,.45)",background:"rgba(245,158,11,.12)",color:"var(--orange)",fontSize:12,fontWeight:800,cursor:"pointer"}}>Guardar punto</button>
              </div>
            )}
          </div>
          <div className="tg-stop-add-grid tg-stop-schedule-grid" style={{display:"grid",gap:8,marginBottom:8}}>
            {puntosFiltrados.length > 0 && (
              <select
                style={{...inp,gridColumn:"1/-1"}}
                value=""
                onChange={e=>{
                  const punto = puntosFiltrados.find(p=>p.id===e.target.value);
                  aplicarPuntoGuardado(punto);
                }}
              >
                <option value="">Usar punto de interes guardado</option>
                {puntosFiltrados.map(p=><option key={p.id} value={p.id}>{p.nombre} - {p.direccion}</option>)}
              </select>
            )}
            <datalist id={puntosListId}>
              {puntosFiltrados.map(p=>(
                <option key={p.id} value={`${p.nombre || ""}${p.direccion ? " - " + p.direccion : ""}`} />
              ))}
            </datalist>
            <input
              className="tg-stop-address"
              list={puntosListId}
              style={inp}
              placeholder={tipo === "carga" ? "Poblacion o punto de carga *" : "Poblacion o punto de descarga *"}
              value={newStop.direccion}
              onChange={e=>{
                const val = e.target.value;
                const punto = buscarPuntoExacto(val);
                if (punto) aplicarPuntoGuardado(punto);
                else setNewStop(p=>inferStopGeo({...p,direccion:val}, stopsOrdenados.length ? 1 : 0));
              }}
              onBlur={e=>{
                const punto = buscarPuntoExacto(e.target.value);
                if (punto) aplicarPuntoGuardado(punto);
                else completarNewStopGeo();
              }}
            />
            <datalist id={newStopRegionListId}>
              {newStopRegions.map(region => <option key={region} value={region} />)}
            </datalist>
            <input type="date" min="2000-01-01" max="2100-12-31" style={inp} value={newStop.fecha} onChange={e=>setNewStop(p=>({...p,fecha:e.target.value}))}/>
            <input type="time" style={inp} value={newStop.hora} onChange={e=>setNewStop(p=>({...p,hora:e.target.value}))}/>
            <input style={inp} placeholder="Ventana" value={newStop.ventana} onChange={e=>setNewStop(p=>({...p,ventana:e.target.value}))}/>
          </div>
          <div className="tg-stop-footer" style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
            <div className="tg-stop-footer-group" style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <button type="button" onClick={()=>setNewStopDetailsOpen(v=>!v)} style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"transparent",color:"var(--text4)",fontSize:12,fontWeight:800,cursor:"pointer"}}>
                {newStopDetailsOpen ? "Ocultar detalles" : "Mas detalles"}
              </button>
              <button type="button" onClick={abrirCrearPunto} disabled={!String(puntoQuery || newStop.direccion).trim()} style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"transparent",color:String(puntoQuery || newStop.direccion).trim()?"var(--accent)":"var(--text5)",fontSize:12,fontWeight:800,cursor:String(puntoQuery || newStop.direccion).trim()?"pointer":"not-allowed"}}>
                Guardar como punto
              </button>
            </div>
            <div className="tg-stop-footer-group" style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <button type="button" onClick={addParada} style={{padding:"6px 14px",borderRadius:6,border:"none",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer"}}>Anadir {label}</button>
              <button type="button" onClick={()=>{ setAdding(false); resetNewStop(); }} style={{padding:"6px 14px",borderRadius:6,border:"1px solid var(--border2)",background:"transparent",color:"var(--text4)",fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
          {newStopDetailsOpen && (
            <div className="tg-stop-add-grid tg-stop-details-grid" style={{display:"grid",gap:6,marginBottom:8,padding:10,border:"1px solid var(--border2)",borderRadius:8,background:"var(--bg2)"}}>
            <input className="tg-stop-grid-wide" style={inp} placeholder="Enlace Google Maps (opcional)" value={newStop.google_maps_url||""} onChange={e=>setNewStop(p=>({...p,google_maps_url:e.target.value}))}/>
            <input
              list={countryListId}
              style={inp}
              placeholder="País"
              value={newStopPais}
              onChange={e=>setNewStop(p=>({...p,pais:e.target.value,provincia:""}))}
              onKeyDown={e=>completeOnTab(e, Array.from(new Set([...paisesActivos, newStopPais])), newStopPais, value=>setNewStop(p=>({...p,pais:value,provincia:""})))}
            />
            <input
              list={newStopRegionListId}
              style={inp}
              placeholder="Provincia / región"
              value={newStop.provincia || ""}
              onChange={e=>setNewStop(p=>({...p,provincia:e.target.value}))}
              onKeyDown={e=>completeOnTab(e, newStopRegions, newStop.provincia || "", value=>setNewStop(p=>({...p,provincia:value})))}
            />
            <input type="number" style={inp} placeholder="Bultos" value={newStop.bultos} onChange={e=>setNewStop(p=>({...p,bultos:e.target.value}))}/>
            <input type="number" style={inp} placeholder="Peso kg" value={newStop.peso_kg} onChange={e=>setNewStop(p=>({...p,peso_kg:e.target.value}))}/>
            <input type="number" step="0.01" style={inp} placeholder={`Precio ${label} EUR`} value={newStop.precio} onChange={e=>setNewStop(p=>({...p,precio:e.target.value}))}/>
            <input style={inp} placeholder={`Referencia ${label}`} value={newStop.referencia} onChange={e=>setNewStop(p=>({...p,referencia:e.target.value}))}/>
            <input className="tg-stop-grid-wide" style={inp} placeholder="Notas" value={newStop.notas} onChange={e=>setNewStop(p=>({...p,notas:e.target.value}))}/>
            <button type="button" onClick={abrirCrearPunto} disabled={!String(puntoQuery || newStop.direccion).trim()} style={{padding:"5px 14px",borderRadius:6,border:"1px solid var(--border2)",background:"transparent",color:String(puntoQuery || newStop.direccion).trim()?"var(--accent)":"var(--text5)",fontSize:12,cursor:String(puntoQuery || newStop.direccion).trim()?"pointer":"not-allowed"}}>
              {buscarPuntoExacto(newStop.direccion || puntoQuery) ? "Actualizar punto" : "Guardar como punto"}
            </button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={()=>setAdding(true)} style={{padding:"8px 14px",borderRadius:7,border:"1px dashed var(--accent)",background:"rgba(20,184,166,.08)",color:"var(--accent)",fontSize:12,fontWeight:800,cursor:"pointer",marginTop:4}}>
          + Añadir {label}
        </button>
      ))}
      {poiDraft && (
        <PuntoInteresModal
          initial={poiDraft}
          onClose={()=>setPoiDraft(null)}
          onSave={(next, saved)=>{
            setPuntosInteres(next);
            setNewStop(p=>({...p,...puntoToStop(saved)}));
            setPuntoQuery(saved?.nombre || saved?.direccion || "");
          }}
        />
      )}
    </div>
  );
}

function CargasEditor(props) { return <ParadasEditor {...props} tipo="carga" />; }
function DescargasEditor(props) { return <ParadasEditor {...props} tipo="descarga" />; }

function OrdenCargaModal({ pedido, onClose }) {
  const esColaborador = !!pedido.colaborador_id;
  const [rutaOptimizada, setRutaOptimizada] = useState(null);
  const [rutaOptLoading, setRutaOptLoading] = useState(false);
  const [docControl, setDocControl] = useState(null);
  const [docControlLoading, setDocControlLoading] = useState(false);
  const [firmaEvidencia, setFirmaEvidencia] = useState(null);
  const [firmaEvidenciaLoading, setFirmaEvidenciaLoading] = useState(false);
  const { user } = useAuth();
  const esGerente = user?.rol === "gerente";
  const empresa = useEmpresaPerfil();
  const numOC = getOrdenCargaNumero(pedido, docControl);
  const pagoColaboradorTonelada = getPagoColaboradorPorTonelada(pedido);
  const pagoColaboradorTotalCerrado = getPagoColaboradorTotalCerrado(pedido);
  const numOCDisplay = numOC || "Generando...";
  const referenciaPedido = pedido.referencia_cliente || pedido.numero || numOC || "";
  const cargaPrincipal = parseStops(pedido.puntos_carga)[0] || {};
  const descargaPrincipal = parseStops(pedido.puntos_descarga)[0] || {};
  const cargaDisplay = stopDisplayParts(cargaPrincipal, pedido.origen || "");
  const descargaDisplay = stopDisplayParts(descargaPrincipal, pedido.destino || "");
  const origenOrden = cargaDisplay.direccion || pedido.origen || "";
  const destinoOrden = descargaDisplay.direccion || pedido.destino || "";
  const origenNombreOrden = cargaDisplay.nombre;
  const destinoNombreOrden = descargaDisplay.nombre;
  const destinatarioOrden = destinoNombreOrden || descargaPrincipal.cliente_nombre || pedido.destino || "";
  const condicionesPagoColaborador = formatPaymentTerms(empresa);
  const condicionesPagoCliente = formatClientPaymentTerms(empresa);
  const operativaCarga = buildOperativaCargaLabels(pedido);
  const cargaMapsRows = buildStopMapsRows(pedido.puntos_carga, "Carga", pedido.origen);
  const descargaMapsRows = buildStopMapsRows(pedido.puntos_descarga, "Descarga", pedido.destino);
  const allMapsRows = [
    ...(cargaMapsRows.length ? cargaMapsRows : (origenOrden ? [{ label:"Carga", nombre:origenNombreOrden, direccion:origenOrden, url:buildMapsSearchUrl(origenOrden) }] : [])),
    ...(descargaMapsRows.length ? descargaMapsRows : (destinoOrden ? [{ label:"Descarga", nombre:destinoNombreOrden, direccion:destinoOrden, url:buildMapsSearchUrl(destinoOrden) }] : [])),
  ];
  const firmaPostIntegrity = firmaEvidencia?.post_signature_integrity || null;
  const firmaPostChanges = Array.isArray(firmaPostIntegrity?.changes) ? firmaPostIntegrity.changes : [];
  const firmaPostModificada = !!firmaPostIntegrity?.changed_after_signature;

  useEffect(() => {
    let alive = true;
    if (!pedido?.id) return undefined;
    setRutaOptLoading(true);
    getRutaOptimizadaPedido(pedido.id)
      .then(data => { if (alive) setRutaOptimizada(data || null); })
      .catch(() => { if (alive) setRutaOptimizada(null); })
      .finally(() => { if (alive) setRutaOptLoading(false); });
    return () => { alive = false; };
  }, [pedido?.id]);

  useEffect(() => {
    let alive = true;
    if (!pedido?.id || (!pedido.firma_fecha && !pedido.firma_hash)) {
      setFirmaEvidencia(null);
      return undefined;
    }
    setFirmaEvidenciaLoading(true);
    getFirmaEntregaEvidencia(pedido.id)
      .then(data => { if (alive) setFirmaEvidencia(data || null); })
      .catch(() => { if (alive) setFirmaEvidencia(null); })
      .finally(() => { if (alive) setFirmaEvidenciaLoading(false); });
    return () => { alive = false; };
  }, [pedido?.id, pedido?.firma_fecha, pedido?.firma_hash]);

  useEffect(() => {
    let alive = true;
    if (!pedido?.id) return undefined;
    setDocControlLoading(true);
    getPedidoDocumentoControl(pedido.id)
      .then(data => { if (alive) setDocControl(data || null); })
      .catch(() => { if (alive) setDocControl(null); })
      .finally(() => { if (alive) setDocControlLoading(false); });
    return () => { alive = false; };
  }, [pedido?.id]);

  function imprimir(tipo) {
    const w = window.open("","_blank","width=820,height=1100");
    const esCol = tipo==="colaborador";
    const fmtDate = d => d ? new Date(d).toLocaleDateString("es-ES") : "-";
    const fmtEur  = v => v ? Number(v).toLocaleString("es-ES",{minimumFractionDigits:2, maximumFractionDigits:2})+" EUR" : "-";
    const fmtEur0 = v => Number(v || 0).toLocaleString("es-ES",{minimumFractionDigits:2, maximumFractionDigits:2})+" EUR";
    const fmtNum = v => Number(v || 0).toLocaleString("es-ES", { maximumFractionDigits: 3 });
    const empCol  = esCol ? "#6d28d9" : "#1d4ed8";
    const empBg   = esCol ? "#ede9fe" : "#dbeafe";
    const empresaDireccion = empresaPostalAddress(empresa);
    const cargaPostalOrden = stopPostalLine(cargaPrincipal, pedido.origen_provincia || "", pedido.origen_pais || "España");
    const descargaPostalOrden = stopPostalLine(descargaPrincipal, pedido.destino_provincia || "", pedido.destino_pais || "España");
    const albaranesDireccionPostal = empresaDireccion || "Direccion postal pendiente de configurar en Mi Empresa";
    const logoHtml = getLogoDataUrl() ? `<img src="${getLogoDataUrl()}" style="max-height:52px;max-width:160px;object-fit:contain;margin-bottom:6px;display:block" alt="">` : "";
    const emailAlbaranesColaborador = joinEmailList(
      [empresa.emails_albaranes, empresa.email],
      "Email de albaranes pendiente de configurar en Mi Empresa"
    );
    const bloqueEmailsAlbaranes = `
<div class="sec">
  <div class="sec-t">Envio de albaranes</div>
  <div class="f"><div class="fl">Destinatarios de albaranes firmados</div><div class="fv">${htmlEscape(emailAlbaranesColaborador)}</div></div>
  <div class="f" style="margin-top:8px"><div class="fl">Envio postal obligatorio de albaranes</div><div class="fv">Los albaranes originales deben remitirse a: ${htmlEscape(albaranesDireccionPostal)}</div></div>
</div>`;
    const fallbackRoutePlaces = getRoutePlaces({ ...pedido, origen: origenOrden, destino: destinoOrden })
      .filter((place, idx, arr) => arr.findIndex(x => routePlaceKey(x) === routePlaceKey(place)) === idx);
    const optimizedStops = Array.isArray(rutaOptimizada?.stops) ? rutaOptimizada.stops.filter(s => s?.address || s?.name || s) : [];
    const routeStops = optimizedStops.length
      ? optimizedStops.map((s, idx) => ({
          type: s.type || (idx === 0 ? "Carga" : idx === optimizedStops.length - 1 ? "Descarga" : "Parada intermedia"),
          name: s.name || "",
          address: s.address || s.name || String(s || ""),
          google_maps_url: s.google_maps_url || s.maps_url || "",
        }))
      : fallbackRoutePlaces.map((place, idx) => ({
          type: idx === 0 ? "Carga" : idx === fallbackRoutePlaces.length - 1 ? "Descarga" : "Parada intermedia",
          name: place?.name || "",
          address: place?.address || place?.direccion || place?.google_maps_url || String(place || ""),
          google_maps_url: place?.google_maps_url || place?.googleMapsUrl || "",
        }));
    const routeUrl = rutaOptimizada?.maps_url || buildMapsRouteUrl(fallbackRoutePlaces);
    const routeProvider = rutaOptimizada?.provider_label || "Enlace orientativo";
    const routeKm = rutaOptimizada?.distance_km || pedido.km_ruta || pedido.km || "";
    const routeDuration = rutaOptimizada?.duration_min
      ? `${Math.floor(Number(rutaOptimizada.duration_min) / 60)}h${Number(rutaOptimizada.duration_min) % 60 ? ` ${Number(rutaOptimizada.duration_min) % 60}min` : ""}`
      : "";
    const importeClienteBase = parseLocaleNumber(pedido.importe, calcImporte(pedido));
    const ivaOrden = calcIvaPedido(pedido, importeClienteBase);
    const bloqueEconomicoCliente = !esCol && importeClienteBase > 0 ? `
<div class="price-box">
  <div class="price-head"><div class="price-title">Condiciones economicas</div><div class="price-pill">Cliente</div></div>
  <div class="g3" style="margin-top:10px">
    <div class="price-cell"><div class="fl">Precio viaje sin IVA</div><div class="fv">${fmtEur0(ivaOrden.base)}</div></div>
    <div class="price-cell"><div class="fl">${ivaOrden.aplica ? `IVA ${ivaOrden.tipo_iva}%` : (ivaOrden.iva_regimen === "exento" ? "IVA exento" : "IVA 0%")}</div><div class="fv">${ivaOrden.aplica ? fmtEur0(ivaOrden.cuota) : "Sin IVA"}</div></div>
    <div class="price-cell"><div class="fl">${ivaOrden.aplica ? "Total con IVA" : "Total sin IVA"}</div><div class="fv">${fmtEur0(ivaOrden.total)}</div></div>
  </div>
</div>` : "";
    const bloqueEconomicoColaborador = esCol && (pagoColaboradorTonelada || pagoColaboradorTotalCerrado) ? `
<div class="price-box">
  <div class="price-head"><div class="price-title">Condiciones economicas</div><div class="price-pill">Colaborador</div></div>
  <div class="g3" style="margin-top:10px">
    ${pagoColaboradorTonelada ? `
    <div class="price-cell"><div class="fl">Precio acordado por tonelada</div><div class="fv">${fmtEur(pagoColaboradorTonelada.precioTonelada)} / tn</div></div>
    <div class="price-cell"><div class="fl">Minimo facturable acordado</div><div class="fv">${fmtNum(pagoColaboradorTonelada.minimoToneladas)} tn</div></div>
    ` : `
    <div class="price-cell"><div class="fl">Precio acordado</div><div class="fv">${fmtEur(pagoColaboradorTotalCerrado.total)}</div></div>
    <div class="price-cell"><div class="fl">Tipo de acuerdo</div><div class="fv">Precio cerrado</div></div>
    `}
    <div class="price-cell"><div class="fl">Referencia de pedido</div><div class="fv">${htmlEscape(referenciaPedido || "-")}</div></div>
  </div>
  <div class="notice" style="margin-top:10px"><strong>Forma de pago:</strong> ${htmlEscape(condicionesPagoColaborador)}</div>
  <div class="notice"><strong>PENDIENTE DE PAGO</strong> - Adjuntar factura del colaborador. Enviar copia digital a: ${htmlEscape(emailAlbaranesColaborador)}. Los albaranes originales deben remitirse por correo postal a: ${htmlEscape(albaranesDireccionPostal)}</div>
</div>` : "";
    const dcdReady = !!docControl?.status?.ready;
    const dcdSupportUrl = docControl?.documento?.soporte_url || "";
    const dcdCode = docControl?.documento?.codigo_control || "";
    const dcdSystem = docControl?.documento?.sistema === "qr_url" ? "QR / URL" : "Codigo numerico";
    const dcdScore = Number(docControlReadiness.score || 0);
    const bloqueOperativa = `
<div class="cond">
  <div style="font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#166534;margin-bottom:6px">Instrucciones operativas</div>
  <ol>
    ${operativaCarga.map((item) => `<li><strong>${htmlEscape(item)}</strong>.</li>`).join("")}
  </ol>
</div>`;
    const bloqueCombustible = `
<div class="cond">
  <div style="font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#b45309;margin-bottom:6px">Clausula de revision del combustible</div>
  <div>
    El precio pactado solo se ajustara por variacion del combustible si el indice G de variacion del precio medio del gasoleo publicado por la Administracion entre la fecha de esta orden de carga y la fecha de carga efectiva de la mercancia es igual o superior al 5%.
    <br><br>El ajuste debera reflejarse en la factura correspondiente al transporte ejecutado como concepto separado e identificado. No se admitiran ajustes en facturas rectificativas o posteriores emitidas fuera del ciclo de facturacion habitual de las partes.
    <br><br>Si el porteador hubiera percibido ayudas publicas que compensen total o parcialmente la variacion del gasoleo, el indice G se calculara sobre el precio neto tras descontar dichas ayudas.
    <br><br>El ajuste a la baja opera en las mismas condiciones cuando la variacion sea favorable al cargador.
  </div>
</div>`;
    const bloquePagoCliente = `
<div class="cond">
  <div style="font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#1d4ed8;margin-bottom:6px">Condiciones de pago del servicio</div>
  <div><strong>Forma de pago:</strong> ${htmlEscape(condicionesPagoCliente)}</div>
</div>`;
    const mapsRowsHtml = allMapsRows.map((item) => `
      <div class="map-stop">
        <div class="fl">${htmlEscape(item.label)}</div>
        <div class="fv">${htmlEscape(item.nombre || item.direccion || "-")}</div>
        ${item.nombre && item.direccion ? `<div class="map-address">${htmlEscape(item.direccion)}</div>` : ""}
        ${item.url ? `<a class="map-button" href="${htmlEscape(item.url)}">Abrir ${htmlEscape(item.label)} en Google Maps</a><div class="route-link" style="font-size:9.5px;margin-top:4px">${htmlEscape(item.url)}</div>` : ""}
      </div>
    `).join("");
    const mapsBlock = mapsRowsHtml ? `
<div class="sec">
  <div class="sec-t">Ubicaciones Google Maps</div>
  <div class="map-grid">${mapsRowsHtml}</div>
</div>` : "";
    const dcdBlock = docControl?.documento ? `
<div class="sec">
  <div class="sec-t">Documento de control digital</div>
  <div class="${esCol ? "g2" : "g3"}">
    <div class="f"><div class="fl">Sistema</div><div class="fv">${dcdSystem}</div></div>
    <div class="f"><div class="fl">Codigo control</div><div class="fv">${htmlEscape(dcdCode || "Pendiente")}</div></div>
    ${!esCol ? `<div class="f"><div class="fl">Estado</div><div class="fv">${dcdReady ? "Listo" : "Pendiente de completar"}</div></div>
    <div class="f"><div class="fl">Preparacion digital</div><div class="fv">${dcdScore || "-"}${dcdScore ? "%" : ""}</div></div>` : ""}
  </div>
  ${dcdSupportUrl ? `<div class="route-box" style="margin-top:8px"><strong>Soporte digital:</strong><br><a class="route-link" href="${htmlEscape(dcdSupportUrl)}">${htmlEscape(dcdSupportUrl)}</a></div>` : ""}
  ${!esCol && docControlFaltantes.length ? `<div class="notice"><strong>Revision pendiente:</strong> ${htmlEscape(docControlFaltantes.join(" | "))}</div>` : ""}
  ${!esCol && docControlAvisos.length ? `<div class="cond"><strong>Avisos eCMR/eFTI:</strong> ${htmlEscape(docControlAvisos.join(" | "))}</div>` : ""}
</div>` : "";
    const routeTypeCounts = {};
    const routeStopsWithLabels = routeStops.map((stop) => {
      const baseType = String(stop.type || "Parada").replace(/\s+\d+$/g, "");
      routeTypeCounts[baseType] = (routeTypeCounts[baseType] || 0) + 1;
      const address = String(stop.address || "").trim();
      const name = distinctPlaceName(stop.name || "", address);
      return { ...stop, name, address, displayType: routeTypeCounts[baseType] > 1 ? `${baseType} ${routeTypeCounts[baseType]}` : baseType };
    });
    const routeStopsHtml = routeStopsWithLabels.map((stop) => `
      <li>
        <strong>${htmlEscape(stop.displayType)}</strong>
        ${stop.name ? `<div>${htmlEscape(stop.name)}</div>` : ""}
        <div>${htmlEscape(stop.address)}</div>
        ${stop.google_maps_url ? `<a class="map-button" href="${htmlEscape(stop.google_maps_url)}">Abrir este punto en Google Maps</a>` : ""}
      </li>
    `).join("");
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>OC ${pedido.numero}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#eef2f7;padding:22px;color:#111827;font-size:12px;line-height:1.45}
.sheet{position:relative;max-width:780px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:28px 30px 24px;box-shadow:0 24px 70px rgba(15,23,42,.14);overflow:hidden}
.sheet:before{content:"";position:absolute;inset:0 0 auto 0;height:8px;background:linear-gradient(90deg,${empCol},#16a34a,#f59e0b)}
.sheet:after{content:"ORDEN";position:absolute;right:-18px;top:126px;font-size:82px;font-weight:900;letter-spacing:8px;color:#0f172a;opacity:.035;transform:rotate(-90deg);pointer-events:none}
.hdr{position:relative;display:grid;grid-template-columns:1.25fr .75fr;gap:24px;align-items:start;padding:8px 0 18px;margin-bottom:18px;border-bottom:1px solid #e5e7eb}
.brand-block{border-left:4px solid ${empCol};padding-left:14px}
.emp-name{font-size:21px;font-weight:900;color:#111827;letter-spacing:-.02em}
.emp-info{font-size:10.5px;color:#64748b;margin-top:4px;line-height:1.65}
.doc-panel{text-align:right;background:linear-gradient(180deg,${empBg},#fff);border:1px solid ${empCol}33;border-radius:12px;padding:12px 14px}
.doc-oc{font-size:23px;font-weight:950;color:${empCol};letter-spacing:-.02em;text-align:right}
.doc-ref{font-size:11px;color:#475569;text-align:right;margin-top:2px}
.badge{display:inline-block;padding:5px 12px;border-radius:6px;font-size:10px;font-weight:900;background:${empCol};color:#fff;text-transform:uppercase;margin-top:8px;letter-spacing:.05em}
.sec{position:relative;margin-bottom:15px;break-inside:avoid}
.sec-t{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:${empCol};padding-bottom:7px;margin-bottom:9px;border-bottom:1px solid #e5e7eb}
.sec-t:before{content:"";width:8px;height:8px;border-radius:3px;background:${empCol};display:inline-block}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.f{background:#f8fafc;border:1px solid #e5e7eb;border-radius:9px;padding:9px 11px;min-height:54px}
.fl{font-size:8.5px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:900;margin-bottom:3px}
.fv{font-size:13px;font-weight:800;color:#111827;word-break:break-word}
.fv.big{font-size:16px;color:${empCol};letter-spacing:-.01em}
.hl{background:linear-gradient(180deg,${empBg},#fff);border:1px solid ${empCol}33;border-radius:12px;padding:13px 15px;margin:0}
.price-box{background:linear-gradient(135deg,#ecfdf5,#fff);border:1.5px solid #86efac;border-radius:14px;padding:14px 16px;margin:12px 0;break-inside:avoid}
.price-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.price-title{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#166534}
.price-pill{font-size:9px;font-weight:900;color:#166534;background:#dcfce7;border:1px solid #bbf7d0;border-radius:999px;padding:3px 8px;text-transform:uppercase}
.price-cell{background:#fff;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px}
.notice{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 11px;font-size:11px;color:#92400e;margin-top:10px}
.cond{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:12px 16px;margin:12px 0;font-size:11px;break-inside:avoid}
.cond ol{padding-left:18px;margin-top:7px;line-height:1.65}
.cond li{margin-bottom:2px}
.firma-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:26px;padding-top:14px;border-top:1px solid #e5e7eb;break-inside:avoid}
.firma-box{border:1px solid #d1d5db;border-radius:11px;padding:34px 10px 10px;min-height:88px;background:#f8fafc;position:relative}
.firma-box:before{content:"";position:absolute;left:12px;right:12px;top:28px;border-top:1.5px solid #111827}
.firma-lbl{font-size:8.5px;font-weight:900;text-transform:uppercase;color:#64748b;letter-spacing:.06em}
.firma-name{font-size:11px;color:#111827;font-weight:700;margin-top:4px}
.route-sheet{page-break-before:always;margin-top:24px;padding-top:10px}
.route-head{border-left:5px solid #0f766e;padding-left:14px;margin-bottom:18px}
.route-head h2{font-size:24px;color:#0f172a;margin:0 0 4px}
.route-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin:16px 0}
.route-kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px}
.route-list{padding-left:22px;margin:12px 0}
.route-list li{margin-bottom:10px}
.route-list div{font-size:13px;color:#111827;font-weight:800;margin-top:2px}
.route-box{border:1px solid #dbeafe;background:#eff6ff;border-radius:12px;padding:12px 14px;margin-top:12px;font-size:11.5px;color:#1f2937}
.route-warn{border-color:#fde68a;background:#fffbeb;color:#92400e}
.route-link{color:#0f766e;word-break:break-all;font-weight:700}
.map-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.map-stop{background:#eff6ff;border:1px solid #bfdbfe;border-radius:11px;padding:10px 12px;break-inside:avoid}
.map-address{font-size:11px;color:#475569;margin-top:3px}
.map-button{display:inline-block;margin-top:8px;background:#2563eb;color:#fff;text-decoration:none;border-radius:7px;padding:7px 10px;font-size:10.5px;font-weight:900}
@media print{@page{margin:1.05cm;size:A4}body{background:#fff;padding:0}.sheet{max-width:none;border:none;border-radius:0;padding:0;box-shadow:none}.sheet:before,.sheet:after{display:none}}
</style></head><body>
<main class="sheet">
<div class="hdr">
<div class="brand-block">${logoHtml}<div class="emp-name">${empresa.razon_social||empresa.nombre||"-"}</div>
    <div class="emp-info">${empresa.cif?"CIF: "+empresa.cif:""}${empresaDireccion?" | "+empresaDireccion:""}<br>${empresa.telefono?"Tel: "+empresa.telefono:""}${empresa.email?" | "+empresa.email:""}</div>
  </div>
  <div class="doc-panel">
    <div class="doc-oc">ORDEN DE CARGA</div>
    <div class="doc-ref">N. OC: <strong>${numOCDisplay}</strong></div>
    <div class="doc-ref">Ref: ${pedido.numero}</div>
    <div class="doc-ref">${new Date().toLocaleDateString("es-ES")}</div>
    <div class="badge">${esCol?"COLABORADOR EXTERNO":"TRANSPORTE PROPIO"}</div>
  </div>
</div>
  <div class="sec">
    <div class="sec-t">Ruta y fechas</div>
    <div class="g2" style="margin-bottom:8px">
      <div class="f hl"><div class="fl">Origen -> Punto de carga</div><div class="fv big">${htmlEscape(origenNombreOrden || origenOrden || "-")}</div>${origenNombreOrden && origenOrden ? `<div class="map-address">${htmlEscape(origenOrden)}</div>` : ""}${cargaPostalOrden ? `<div class="map-address"><strong>CP / poblacion / provincia:</strong> ${htmlEscape(cargaPostalOrden)}</div>` : ""}${pedido.ventana_carga?`<div style="font-size:10px;color:#6b7280;margin-top:2px">${pedido.ventana_carga}</div>`:""}${cargaPrincipal?.google_maps_url?`<div style="font-size:10px;margin-top:4px"><a class="route-link" href="${htmlEscape(cargaPrincipal.google_maps_url)}">${htmlEscape(cargaPrincipal.google_maps_url)}</a></div>`:""}</div>
      <div class="f hl"><div class="fl">Destino -> Punto de entrega</div><div class="fv big">${htmlEscape(destinoNombreOrden || destinoOrden || "-")}</div>${destinoNombreOrden && destinoOrden ? `<div class="map-address">${htmlEscape(destinoOrden)}</div>` : ""}${descargaPostalOrden ? `<div class="map-address"><strong>CP / poblacion / provincia:</strong> ${htmlEscape(descargaPostalOrden)}</div>` : ""}${pedido.ventana_descarga?`<div style="font-size:10px;color:#6b7280;margin-top:2px">${pedido.ventana_descarga}</div>`:""}${descargaPrincipal?.google_maps_url?`<div style="font-size:10px;margin-top:4px"><a class="route-link" href="${htmlEscape(descargaPrincipal.google_maps_url)}">${htmlEscape(descargaPrincipal.google_maps_url)}</a></div>`:""}</div>
    </div>
    <div class="g3">
      <div class="f"><div class="fl">Fecha carga</div><div class="fv">${fmtDate(pedido.fecha_carga)}</div></div>
      <div class="f"><div class="fl">Hora carga</div><div class="fv">${pedido.hora_carga||"-"}</div></div>
      <div class="f"><div class="fl">Ventana carga</div><div class="fv">${pedido.ventana_carga||"-"}</div></div>
    </div>
    <div class="g3" style="margin-top:8px">
      <div class="f"><div class="fl">Fecha descarga</div><div class="fv">${fmtDate(pedido.fecha_descarga||pedido.fecha_entrega)}</div></div>
      <div class="f"><div class="fl">Hora descarga</div><div class="fv">${pedido.hora_descarga||"-"}</div></div>
      <div class="f"><div class="fl">Ventana descarga</div><div class="fv">${pedido.ventana_descarga||"-"}</div></div>
    </div>
    <div class="g3" style="margin-top:8px">
      <div class="f"><div class="fl">KM ruta</div><div class="fv">${pedido.km_ruta||pedido.km||"-"} km</div></div>
      <div class="f"><div class="fl">Referencia cliente</div><div class="fv">${pedido.referencia_cliente||"-"}</div></div>
      <div class="f"><div class="fl">Estado</div><div class="fv">${pedido.estado||"-"}</div></div>
    </div>
</div>
${mapsBlock}
${!esCol ? bloqueEmailsAlbaranes : ""}
<div class="sec">
  <div class="sec-t">Mercancia y referencias</div>
  <div class="g2" style="margin-bottom:8px">
    <div class="f"><div class="fl">Pedido</div><div class="fv">${pedido.numero||"-"}</div></div>
    <div class="f"><div class="fl">Referencia cliente</div><div class="fv">${pedido.referencia_cliente||"-"}</div></div>
  </div>
  <div class="f" style="margin-bottom:8px"><div class="fl">Descripcion mercancia</div><div class="fv">${pedido.mercancia||pedido.descripcion_carga||"-"}</div></div>
  <div class="g3">
    <div class="f"><div class="fl">Peso (kg)</div><div class="fv">${pedido.peso_kg||pedido.kg||"-"}</div></div>
    <div class="f"><div class="fl">Bultos/Palets</div><div class="fv">${pedido.bultos||"-"}</div></div>
    <div class="f"><div class="fl">Volumen (m3)</div><div class="fv">${pedido.volumen||"-"}</div></div>
  </div>
</div>
${esCol ? `
<div class="sec">
  <div class="sec-t">Colaborador / Transportista subcontratado</div>
  <div class="hl">
    <div class="g2">
      <div><div class="fl">Empresa colaboradora</div><div class="fv" style="font-size:16px;color:${empCol};font-weight:900">${pedido.colaborador_nombre||"-"}</div></div>
      <div><div class="fl">Tipo operacion</div><div class="fv">Subcontratacion de porte</div></div>
    </div>
    <div style="font-size:11px;color:#4b5563;margin-top:8px">
      ${pedido.colaborador_cif?`CIF/NIF: ${pedido.colaborador_cif}`:""}${pedido.colaborador_telefono?` | Tel: ${pedido.colaborador_telefono}`:""}${pedido.colaborador_email?` | Email: ${pedido.colaborador_email}`:""}
    </div>
  </div>
</div>
<div class="sec">
  <div class="sec-t">Conjunto confirmado</div>
  <div class="g2">
    <div class="f"><div class="fl">Vehiculo / Tractora</div><div class="fv">${pedido.matricula_colaborador||"Pendiente de confirmar"}</div></div>
    <div class="f"><div class="fl">Remolque</div><div class="fv">${pedido.remolque_matricula_colaborador||"Pendiente de confirmar"}</div></div>
  </div>
</div>
${bloqueEconomicoColaborador}
<div class="cond">
  <div style="font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#b45309;margin-bottom:6px">Condiciones para el colaborador</div>
  <ol>
    <li><strong>Aceptacion:</strong> La presente orden constituye un contrato de transporte de mercancias por carretera. Se considerara aceptada y vinculante salvo que el porteador comunique su rechazo expreso en el plazo de una hora desde la recepcion de esta orden.</li>
    <li><strong>Prohibicion de subcontratacion:</strong> Queda expresamente prohibida la subcontratacion total o parcial del servicio sin autorizacion escrita previa del cargador. En caso de incumplimiento, el cargador quedara facultado para resolver el contrato, rechazar la factura emitida y no abonar cantidad alguna por el servicio, sin perjuicio de reclamar los danos y perjuicios causados. Cuando la subcontratacion hubiera sido autorizada por escrito, el cargador podra condicionar el pago de la factura del porteador a la acreditacion documental del pago efectivo al subcontratista por los servicios objeto de autorizacion.</li>
    <li><strong>Estacionamiento y pernocta:</strong> Solo podra estacionarse o pernoctar en instalaciones cerradas con vigilancia presencial las 24 horas. Queda prohibido el estacionamiento en areas de servicio, explanadas o vias publicas sin estas caracteristicas. El incumplimiento trasladara al porteador la responsabilidad por cualquier dano, robo o perdida producidos durante el estacionamiento no autorizado.</li>
    <li><strong>Cancelacion de la orden:</strong> El cargador podra cancelar la presente orden de transporte sin coste ni penalizacion alguna dentro de las doce horas siguientes a su emision, mediante comunicacion escrita dirigida al porteador por cualquier medio que deje constancia de su recepcion.</li>
    <li><strong>Ley aplicable y jurisdiccion:</strong> Queda expresamente excluida la sumision a las Juntas Arbitrales del Transporte. Cualquier controversia derivada de la presente orden sera resuelta exclusivamente ante la jurisdiccion ordinaria.</li>
    <li><strong>Retencion:</strong> Queda prohibida la retencion de la mercancia salvo en los casos expresamente autorizados por la ley.</li>
    <li><strong>Puntualidad:</strong> La puntualidad en carga y descarga es esencial. Los retrasos no justificados pueden generar penalizaciones.</li>
    <li><strong>Contacto con clientes:</strong> Queda expresamente prohibido el contacto directo con los clientes de la empresa contratante.</li>
    <li><strong>Documentacion:</strong> No se pagara la factura hasta recibir todos los documentos de transporte originales firmados por el destinatario (CMR o carta de porte y albaran) en maximo 48h.</li>
    <li><strong>Albaranes originales:</strong> Deben enviarse por correo postal a ${htmlEscape(albaranesDireccionPostal)}.</li>
    <li><strong>Mercancia:</strong> El colaborador es responsable de la mercancia desde la carga hasta la entrega.</li>
    <li><strong>Facturacion:</strong> Las facturas deben emitirse a: <strong>${empresa.razon_social||empresa.nombre||"-"} | CIF: ${empresa.cif||"-"}</strong>.</li>
  </ol>
</div>` : `
<div class="sec">
  <div class="sec-t">Asignacion de transporte propio</div>
  <div class="g3">
    <div class="f hl"><div class="fl">Vehiculo / Tractora</div><div class="fv big">${pedido.vehiculo_matricula||pedido.matricula||"Sin asignar"}</div></div>
    <div class="f hl"><div class="fl">Remolque</div><div class="fv">${pedido.remolque_matricula||pedido.remolque_mat||"Sin remolque"}</div></div>
    <div class="f hl"><div class="fl">Chofer principal</div><div class="fv big">${pedido.chofer_nombre||"Sin asignar"}</div></div>
  </div>
  ${pedido.chofer2_nombre?`<div class="f" style="margin-top:8px"><div class="fl">2o Chofer</div><div class="fv">${pedido.chofer2_nombre}</div></div>`:""}
</div>`}
${bloqueEconomicoCliente}
${pedido.notas||pedido.condiciones_adicionales?`
<div class="sec">
  <div class="sec-t">Instrucciones</div>
  ${pedido.notas?`<div class="f" style="margin-bottom:6px"><div class="fl">Instrucciones especiales</div><div style="white-space:pre-wrap;line-height:1.6">${pedido.notas}</div></div>`:""}
  ${pedido.condiciones_adicionales?`<div class="f"><div class="fl">Condiciones adicionales</div><div style="white-space:pre-wrap;line-height:1.6">${pedido.condiciones_adicionales}</div></div>`:""}
</div>`:""}
${dcdBlock}
${!esCol ? bloquePagoCliente : ""}
${bloqueOperativa}
${bloqueCombustible}
<div class="firma-row">
  ${esCol?`<div class="firma-box"><div class="firma-lbl">Colaborador</div><div class="firma-name">${pedido.colaborador_nombre||""}</div></div>`:`<div class="firma-box"><div class="firma-lbl">Chofer</div><div class="firma-name">${pedido.chofer_nombre||""}</div></div>`}
  <div class="firma-box"><div class="firma-lbl">Expedidor (empresa)</div><div class="firma-name">${empresa.razon_social||empresa.nombre||""}</div></div>
  <div class="firma-box"><div class="firma-lbl">Destinatario</div><div class="firma-name">${destinatarioOrden}</div></div>
</div>
${esCol ? `
<section class="route-sheet">
  <div class="route-head">
    <h2>Ruta recomendada para camion</h2>
    <div class="muted">Hoja adjunta a la orden de carga ${numOCDisplay}</div>
  </div>
  <div class="route-kpis">
    <div class="route-kpi"><div class="fl">Pedido</div><div class="fv">${pedido.numero||"---"}</div></div>
    <div class="route-kpi"><div class="fl">Proveedor</div><div class="fv">${htmlEscape(routeProvider)}</div></div>
    <div class="route-kpi"><div class="fl">Kilometros previstos</div><div class="fv">${routeKm||"Pendiente"}${routeKm?" km":""}</div></div>
    <div class="route-kpi"><div class="fl">Tiempo estimado</div><div class="fv">${routeDuration||"Pendiente"}</div></div>
    <div class="route-kpi"><div class="fl">Peso</div><div class="fv">${pedido.peso_kg||pedido.kg||"Sin dato"}${pedido.peso_kg||pedido.kg?" kg":""}</div></div>
  </div>
  <div class="sec-t">Paradas de la ruta</div>
  <ol class="route-list">${routeStopsHtml || "<li>Sin direcciones suficientes</li>"}</ol>
  <div class="route-box">
    <strong>Enlace de navegacion:</strong><br>
    ${routeUrl ? `<a class="route-link" href="${htmlEscape(routeUrl)}">${htmlEscape(routeUrl)}</a>` : "No disponible"}
  </div>
  <div class="route-box route-warn">
    <strong>Control obligatorio para camion:</strong><br>
    Revisar galibo, MMA, restricciones locales, ADR si aplica, peajes, accesos a muelle, horarios de carga/descarga y zonas de espera. Esta ruta es orientativa y debe validarse con navegacion apta para camion cuando este disponible.
  </div>
</section>` : ""}
</main>
</body></html>`);
    w.document.close(); w.focus(); setTimeout(()=>w.print(),350);
  }

  const S2 = {
    modal:{position:"fixed",inset:0,background:"radial-gradient(circle at 50% 0%, rgba(59,130,246,.22), transparent 34%), rgba(2,6,23,.82)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16},
    box:{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:0,width:"min(720px,96vw)",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 28px 80px rgba(0,0,0,.38)"},
    body:{padding:22},
    kv:{background:"linear-gradient(180deg,var(--bg4),var(--bg3))",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px",minHeight:62},
    lbl:{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4},
    val:{fontWeight:700,color:"var(--text)",fontSize:13},
  };

  const docControlChecks = Array.isArray(docControl?.status?.checks) ? docControl.status.checks : [];
  const docControlFaltantes = Array.isArray(docControl?.status?.faltantes) ? docControl.status.faltantes : [];
  const docControlAvisos = Array.isArray(docControl?.status?.avisos) ? docControl.status.avisos : [];
  const docControlReadiness = docControl?.status?.readiness || {};
  const docControlExpediente = docControl?.expediente || null;
  const regulatoryCore = docControl?.regulatory_core || null;
  const regulatoryPayloads = Array.isArray(regulatoryCore?.payloads) ? regulatoryCore.payloads : [];
  const regulatoryChecklist = Array.isArray(regulatoryCore?.checklist?.items) ? regulatoryCore.checklist.items : [];
  const expedienteAcciones = Array.isArray(docControlExpediente?.acciones) ? docControlExpediente.acciones : [];
  const expedienteBloqueos = Array.isArray(docControlExpediente?.bloqueos) ? docControlExpediente.bloqueos : [];
  const expedienteDocs = docControlExpediente?.documentos?.counts || {};
  const expedienteTrazas = docControlExpediente?.trazabilidad || {};
  const docControlSupportUrl = docControl?.documento?.soporte_url || "";
  const showDcdDebug = false;
  const registrarDcdEvento = useCallback((action) => {
    if (!pedido?.id || !docControl?.documento) return;
    registrarPedidoDocumentoControlEvento(pedido.id, { action, source:"pedidos_orden_carga" }).catch(() => {});
  }, [pedido?.id, docControl?.documento]);

  function abrirSoporteDocControl(printMode = false) {
    if (!docControlSupportUrl) return;
    const url = printMode
      ? `${docControlSupportUrl}${docControlSupportUrl.includes("?") ? "&" : "?"}print=1`
      : docControlSupportUrl;
    registrarDcdEvento(printMode ? "impreso" : "abierto");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function descargarSoporteDocControl() {
    const url = docControl?.remision?.download_url || (docControlSupportUrl ? `${docControlSupportUrl}${docControlSupportUrl.includes("?") ? "&" : "?"}download=1` : "");
    if (!url) return;
    registrarDcdEvento("descargado");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function generarDeCADocControl() {
    if (!pedido?.id) return;
    try {
      setDocControlLoading(true);
      const data = await generarPedidoDocumentoControl(pedido.id);
      setDocControl(data || null);
      notify("DeCA generado y archivado en repositorio.", "success");
    } catch (e) {
      notify(e.message || "No se pudo generar el DeCA.", "error");
    } finally {
      setDocControlLoading(false);
    }
  }

  async function descargarExportDocControl() {
    if (!pedido?.id) return;
    try {
      const data = await getPedidoDocumentoControlExport(pedido.id);
      const filename = data?.audit?.export_filename || `deca-efti-ecmr-${pedido.numero || pedido.id}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Exportacion JSON eFTI/eCMR descargada.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar la exportacion eFTI/eCMR.", "error");
    }
  }

  function descargarJsonLocal(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function descargarPaqueteRegulatorio() {
    if (!pedido?.id) return;
    try {
      const data = await getPedidoRegulatoryCoreExport(pedido.id);
      const filename = `transgest-regulatory-package-${pedido.numero || pedido.id}.json`;
      descargarJsonLocal(data, filename);
      notify("Paquete regulatorio descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar el paquete regulatorio.", "error");
    }
  }

  async function descargarDossierRegulatorioPdf() {
    if (!pedido?.id) return;
    try {
      const { blob, filename } = await descargarPedidoRegulatoryDossierPdf(pedido.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `transgest-dossier-regulatorio-${pedido.numero || pedido.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Dossier regulatorio PDF descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar el dossier regulatorio.", "error");
    }
  }

  async function descargarPayloadRegulatorio(type) {
    if (!pedido?.id || !type) return;
    try {
      const data = await getPedidoRegulatoryPayload(pedido.id, type);
      const filename = `transgest-${type}-payload-${pedido.numero || pedido.id}.json`;
      descargarJsonLocal(data, filename);
      notify(`Payload ${String(type).toUpperCase()} descargado.`, "success");
    } catch (e) {
      notify(e.message || `No se pudo descargar el payload ${type}.`, "error");
    }
  }

  async function crearBorradorTransmisionRegulatoria(payloadType = "efti") {
    if (!pedido?.id) return;
    try {
      const data = await crearPedidoRegulatoryTransmissionDraft(pedido.id, {
        payload_type: payloadType,
        provider: "certified_platform_pending",
      });
      notify(`Borrador ${payloadType.toUpperCase()} preparado: ${data?.draft?.provider || "proveedor pendiente"}.`, "success");
      const refreshed = await getPedidoDocumentoControl(pedido.id).catch(() => null);
      if (refreshed) setDocControl(refreshed);
    } catch (e) {
      notify(e.message || "No se pudo crear el borrador de transmisión regulatoria.", "error");
    }
  }

  async function descargarFirmaPaqueteDocControl() {
    if (!pedido?.id) return;
    try {
      const data = await getPedidoDocumentoControlFirmaPaquete(pedido.id);
      const filename = data?.document?.signature_package_filename || `deca-firma-eidas-${pedido.numero || pedido.id}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Paquete de firma eIDAS descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar el paquete de firma eIDAS.", "error");
    }
  }

  async function descargarInformeFirmaEvidencia() {
    if (!pedido?.id) return;
    try {
      const { blob, filename } = await descargarFirmaEntregaEvidenciaInforme(pedido.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `evidencia-firma-${pedido.numero || pedido.id}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Informe de evidencia de firma descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar el informe de evidencia de firma.", "error");
    }
  }

  async function copiarEnlaceDocControl() {
    if (!docControlSupportUrl) return;
    try {
      await navigator.clipboard.writeText(docControlSupportUrl);
      registrarDcdEvento("copiado");
      notify("Enlace del documento digital copiado");
    } catch {
      notify("No se pudo copiar el enlace", "error");
    }
  }

  async function marcarRemisionDocControl() {
    if (!pedido?.id || !docControl?.documento) return;
    const ready = !!docControl?.status?.ready;
    const faltantes = docControlFaltantes.length ? `\n\nFaltantes:\n- ${docControlFaltantes.join("\n- ")}` : "";
    const firmaCambios = firmaPostChanges.length ? firmaPostChanges.map(c => c.label || c.field).join(", ") : "";
    const firmaAviso = firmaPostModificada
      ? `\n\nAviso firma: hay cambios posteriores a la firma${firmaCambios ? ` (${firmaCambios})` : ""}. Solo gerencia puede confirmar la remision formal en este estado.`
      : "";
    const ok = await confirmDialog({
      title: "Marcar DCD remitido",
      message: ready
        ? `Se registrara en el historial del pedido que el documento de control digital ha sido remitido o puesto a disposicion por el canal indicado. Continuar?${firmaAviso}`
        : `El Documento de Control Digital aun no esta listo. Preparacion actual: ${Number(docControlReadiness.score || 0)}%.\n\nSolo gerencia puede confirmar una remision incompleta y quedara trazado en el historial.${faltantes}${firmaAviso}`,
      confirmText: ready && !firmaPostModificada ? "Marcar remitido" : "Confirmar con gerencia",
      cancelText: "Cancelar",
      tone: ready && !firmaPostModificada ? "default" : "warning",
    });
    if (!ok) return;
    if (firmaPostModificada && !esGerente) {
      notify("La remision formal con firma modificada tras la firma requiere confirmacion de gerencia.", "warning");
      return;
    }
    if (!ready && !esGerente) {
      notify("La remision incompleta del DCD requiere confirmacion de gerencia.", "warning");
      return;
    }
    try {
      await registrarPedidoDocumentoControlEvento(pedido.id, {
        action:"remitido",
        source:"pedidos_orden_carga",
        confirmar_remision_incompleta: !ready && esGerente,
        confirmar_firma_modificada: firmaPostModificada && esGerente,
      });
      notify(ready ? "Documento de control marcado como remitido." : "Documento de control remitido con confirmacion de gerencia.", "success");
    } catch (e) {
      if (e.status === 409 && e.data?.requiere_confirmacion) {
        const cambiosFirma = Array.isArray(e.data.changes) && e.data.changes.length
          ? ` Cambios firma: ${e.data.changes.map(c => c.label || c.field).join(" | ")}`
          : "";
        const detalles = Array.isArray(e.data.faltantes) && e.data.faltantes.length
          ? ` Faltan: ${e.data.faltantes.join(" | ")}`
          : "";
        notify(`${e.data.error || "El DCD requiere confirmacion antes de remitir."}${cambiosFirma}${detalles}`, "warning");
      } else {
        notify(e.message || "No se pudo registrar la remision del DCD.", "error");
      }
    }
  }

  return (
    <div style={S2.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S2.box}>
        <div style={{height:7,background:esColaborador?"linear-gradient(90deg,#7c3aed,#10b981,#f59e0b)":"linear-gradient(90deg,var(--accent),#10b981,#f59e0b)"}}/>
        <div style={S2.body}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,marginBottom:16,padding:"14px 16px",background:"linear-gradient(180deg,var(--bg3),transparent)",border:"1px solid var(--border)",borderRadius:12}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,color:"var(--text)"}}>Orden de carga - {pedido.numero}</div>
            <div style={{display:"flex",gap:8,marginTop:4,alignItems:"center"}}>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:800,color:"var(--orange)",background:"rgba(249,115,22,.1)",border:"1px solid rgba(249,115,22,.25)",borderRadius:5,padding:"2px 8px"}}>
                N. OC: {numOCDisplay}
              </span>
              <span style={{fontSize:11,color:"var(--text5)"}}>Este numero se indica en la factura al cliente</span>
            </div>
            <div style={{marginTop:5,display:"inline-flex",alignItems:"center",gap:6,padding:"3px 10px",borderRadius:20,
              background:esColaborador?"rgba(139,92,246,.15)":"rgba(59,130,246,.12)",
              border:`1px solid ${esColaborador?"rgba(139,92,246,.3)":"rgba(59,130,246,.3)"}`,
              fontSize:11,fontWeight:700,color:esColaborador?"#a78bfa":"var(--accent)"}}>
              {esColaborador?"COLABORADOR EXTERNO":"TRANSPORTE PROPIO"}
            </div>
            {esColaborador && (
              <div style={{marginTop:8,fontSize:11,color:rutaOptimizada?"#10b981":"var(--text5)",fontWeight:700}}>
                {rutaOptLoading
                  ? "Comprobando ruta optimizada..."
                  : rutaOptimizada
                    ? `Se adjuntara ruta optimizada: ${rutaOptimizada.provider_label || rutaOptimizada.provider || "API"}${rutaOptimizada.distance_km ? ` | ${rutaOptimizada.distance_km} km` : ""}`
                    : "Se adjuntara ruta orientativa. Para incluir HERE, calcula la ruta en Gestion de Trafico > Optimizacion."}
              </div>
            )}
            <div style={{marginTop:10,fontSize:11,fontWeight:700,color:docControl?.status?.ready?"#10b981":docControl?.status?.level==="warning"?"#f59e0b":"var(--text5)"}}>
              {docControlLoading
                ? "Comprobando documento de control digital..."
                : docControl?.status?.summary || "Documento de control digital no disponible todavia."}
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>imprimir(esColaborador?"colaborador":"chofer")}
              style={{padding:"6px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:5}}>
              {esColaborador?"Imprimir orden":"Imprimir"}
            </button>
            <button onClick={onClose} style={{background:"none",border:"1px solid var(--border2)",color:"var(--text4)",borderRadius:7,padding:"6px 10px",cursor:"pointer",fontSize:13}}>Cerrar</button>
          </div>
        </div>

        <div style={{marginBottom:14,padding:"12px 14px",borderRadius:12,background:"linear-gradient(180deg,var(--bg3),transparent)",border:"1px solid var(--border)"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:10,flexWrap:"wrap"}}>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:14,color:"var(--text)"}}>Documento de Control Digital</div>
              <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>
                Base preparada segun la normativa del documento de control electronico: codigo numerico o QR con URL HTTPS.
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {docControl?.documento && (
                <button
                  onClick={generarDeCADocControl}
                  disabled={docControlLoading}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(16,185,129,.28)",background:docControlLoading?"rgba(148,163,184,.12)":"rgba(16,185,129,.10)",color:docControlLoading?"var(--text5)":"#10b981",fontSize:12,fontWeight:700,cursor:docControlLoading?"wait":"pointer"}}>
                  {docControlLoading ? "Generando..." : "Generar DeCA"}
                </button>
              )}
              {docControlSupportUrl && (
                <button
                  onClick={()=>abrirSoporteDocControl(false)}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(16,185,129,.28)",background:"rgba(16,185,129,.10)",color:"#10b981",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Abrir soporte DCD
                </button>
              )}
              {docControlSupportUrl && (
                <button
                  onClick={()=>abrirSoporteDocControl(true)}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(59,130,246,.28)",background:"rgba(59,130,246,.10)",color:"var(--accent)",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Imprimir soporte
                </button>
              )}
              {docControlSupportUrl && (
                <button
                  onClick={copiarEnlaceDocControl}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg4)",color:"var(--text3)",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Copiar enlace
                </button>
              )}
              {docControlSupportUrl && (
                <button
                  onClick={descargarSoporteDocControl}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(139,92,246,.28)",background:"rgba(139,92,246,.10)",color:"#a78bfa",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Descargar soporte
                </button>
              )}
              {docControl?.documento && (
                <button
                  onClick={descargarExportDocControl}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(20,184,166,.28)",background:"rgba(20,184,166,.10)",color:"#2dd4bf",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Export JSON eFTI/eCMR
                </button>
              )}
              {docControl?.documento && (
                <button
                  onClick={descargarFirmaPaqueteDocControl}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(124,58,237,.28)",background:"rgba(124,58,237,.10)",color:"#8b5cf6",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Paquete firma eIDAS
                </button>
              )}
              {(pedido.firma_fecha || pedido.firma_hash) && (
                <button
                  onClick={descargarInformeFirmaEvidencia}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(16,185,129,.28)",background:"rgba(16,185,129,.10)",color:"#10b981",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Informe evidencia firma
                </button>
              )}
              {docControl?.documento && (
                <button
                  onClick={marcarRemisionDocControl}
                  style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(245,158,11,.30)",background:"rgba(245,158,11,.10)",color:"#f59e0b",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Marcar remitido
                </button>
              )}
            </div>
          </div>
          {docControl && (
            <>
              {(firmaPostModificada || firmaEvidenciaLoading) && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:firmaPostModificada?"rgba(245,158,11,.10)":"rgba(59,130,246,.08)",border:`1px solid ${firmaPostModificada?"rgba(245,158,11,.28)":"rgba(59,130,246,.20)"}`,fontSize:12,color:firmaPostModificada?"#f59e0b":"var(--accent)"}}>
                  {firmaEvidenciaLoading
                    ? "Comprobando integridad de la firma..."
                    : `Aviso firma: se han modificado datos sensibles despues de firmar (${firmaPostChanges.map(change => change.field).join(", ")}). Descarga el informe de evidencia antes de remitir o auditar.`}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:10}}>
                <div style={S2.kv}><div style={S2.lbl}>Sistema</div><div style={S2.val}>{docControl.documento?.sistema === "qr_url" ? "QR / URL" : "Codigo numerico"}</div></div>
                <div style={S2.kv}><div style={S2.lbl}>Codigo control</div><div style={{...S2.val,fontFamily:"'JetBrains Mono',monospace"}}>{docControl.documento?.codigo_control || "Pendiente"}</div></div>
                <div style={S2.kv}><div style={S2.lbl}>Estado</div><div style={{...S2.val,color:docControl.status?.ready?"#10b981":docControl.status?.level==="warning"?"#f59e0b":"var(--text)"}}>{docControl.status?.ready ? "Listo" : "Pendiente de completar"}</div></div>
                <div style={S2.kv}><div style={S2.lbl}>Archivo soporte</div><div style={{...S2.val,fontSize:12}}>{docControl.remision?.filename || "Pendiente"}</div></div>
              </div>
              {(docControl.qr?.data_url || docControl.qr?.url) && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.24)",display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:900,color:"#10b981",fontSize:12,marginBottom:3}}>QR del documento</div>
                    <div style={{fontSize:11,color:"var(--text4)",overflowWrap:"anywhere"}}>{docControl.qr?.url || docControlSupportUrl}</div>
                  </div>
                  {docControl.qr?.data_url && (
                    <img src={docControl.qr.data_url} alt="QR documento de control" style={{width:118,height:118,objectFit:"contain",background:"#fff",border:"1px solid var(--border2)",borderRadius:8,padding:6}}/>
                  )}
                </div>
              )}
              {docControl.repositorio && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.24)",fontSize:12,color:"var(--text3)",display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontWeight:900,color:"#10b981",marginBottom:3}}>DCD archivado en repositorio</div>
                    <div style={{color:"var(--text4)"}}>
                      Estado: {docControl.repositorio.estado || "archivado"} | Activo operativo: {docControl.repositorio.activo ? "si" : "no"} | Hash: {(docControl.repositorio.payload_hash_sha256 || "").slice(0, 12) || "-"}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {docControl.repositorio.download_url && (
                      <button type="button" onClick={()=>window.open(docControl.repositorio.download_url, "_blank", "noopener,noreferrer")}
                        style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(16,185,129,.28)",background:"rgba(16,185,129,.10)",color:"#10b981",fontSize:12,fontWeight:800,cursor:"pointer"}}>
                        Descargar archivado
                      </button>
                    )}
                    {docControl.repositorio.export_url && (
                      <button type="button" onClick={()=>window.open(docControl.repositorio.export_url, "_blank", "noopener,noreferrer")}
                        style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(20,184,166,.28)",background:"rgba(20,184,166,.10)",color:"#2dd4bf",fontSize:12,fontWeight:800,cursor:"pointer"}}>
                        Export archivado
                      </button>
                    )}
                  </div>
                </div>
              )}
              {showDcdDebug && (
              <details style={{marginBottom:10,border:"1px solid var(--border)",borderRadius:8,background:"var(--bg3)",padding:"8px 10px"}}>
                <summary style={{cursor:"pointer",fontSize:12,fontWeight:900,color:"var(--text3)",userSelect:"none"}}>
                  Diagnostico interno DCD/eCMR
                </summary>
                <div style={{marginTop:10}}>
              {docControlExpediente && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:"rgba(20,184,166,.07)",border:"1px solid rgba(20,184,166,.20)",fontSize:12,color:"var(--text3)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",flexWrap:"wrap",marginBottom:8}}>
                    <div>
                      <div style={{fontWeight:900,color:"var(--text)",marginBottom:3}}>Expediente DCD/eCMR</div>
                      <div style={{color:"var(--text4)"}}>
                        Estado: {docControlExpediente.estado || "-"} | eCMR: {docControlExpediente.ecmr?.status || "-"} | eFTI: {docControlExpediente.efti?.platform_certified_connected ? "certificado" : "preparado, sin plataforma certificada"}
                      </div>
                    </div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:Number(docControlExpediente.score || 0) >= 85 ? "#10b981" : "#f59e0b"}}>
                      {Number(docControlExpediente.score || 0)}%
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:8}}>
                    <div><strong>Docs:</strong> {Number(expedienteDocs.total || 0)}</div>
                    <div><strong>Albaran/POD/CMR:</strong> {Number(expedienteDocs.albaran || 0) + Number(expedienteDocs.pod || 0) + Number(expedienteDocs.cmr || 0)}</div>
                    <div><strong>Remisiones:</strong> {Number(expedienteTrazas.remitido || 0)}</div>
                    <div><strong>Descargas:</strong> {Number(expedienteTrazas.descargado || 0)}</div>
                  </div>
                  {expedienteBloqueos.length > 0 && (
                    <div style={{marginBottom:6,color:"#f59e0b",fontWeight:800}}>
                      Bloqueos: {expedienteBloqueos.join(" | ")}
                    </div>
                  )}
                  {expedienteAcciones.length > 0 && (
                    <div style={{color:"var(--text4)"}}>
                      Siguiente accion: {expedienteAcciones[0]}
                    </div>
                  )}
                </div>
              )}
              {regulatoryPayloads.length > 0 && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.20)",fontSize:12,color:"var(--text3)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:7}}>
                    <div style={{fontWeight:900,color:"var(--text)"}}>Nucleo regulatorio interno</div>
                    {regulatoryCore?.checklist?.status && (
                      <div style={{fontSize:11,fontWeight:900,color:regulatoryCore.checklist.status === "ready" ? "#10b981" : "#f59e0b"}}>
                        {regulatoryCore.checklist.status === "ready" ? "Listo" : "Requiere revision"}
                        {regulatoryCore.checklist.readiness_score != null ? ` · ${Number(regulatoryCore.checklist.readiness_score || 0)}%` : ""}
                      </div>
                    )}
                  </div>
                  {Array.isArray(regulatoryCore?.checklist?.certification_gaps) && regulatoryCore.checklist.certification_gaps.length > 0 && (
                    <div style={{fontSize:11,color:"#f59e0b",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.20)",borderRadius:7,padding:"7px 9px",marginBottom:8}}>
                      Pendiente para certificacion: {regulatoryCore.checklist.certification_gaps.slice(0, 4).join(" | ")}
                    </div>
                  )}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
                    {regulatoryPayloads.map((p) => (
                      <div key={p.payload_type} style={{padding:"8px 10px",borderRadius:7,background:"var(--bg3)",border:"1px solid var(--border)"}}>
                        <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:"var(--text5)",letterSpacing:".04em"}}>{p.payload_type}</div>
                        <div style={{fontWeight:900,color:p.status === "requires_review" ? "#f59e0b" : "#10b981"}}>{p.status || "prepared"}</div>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"var(--text5)"}}>v{p.version || 1} · {(p.hash_sha256 || "").slice(0, 10) || "-"}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:9}}>
                    <button onClick={descargarPaqueteRegulatorio} style={{border:"1px solid rgba(59,130,246,.28)",background:"rgba(59,130,246,.10)",color:"var(--accent)",borderRadius:7,padding:"5px 9px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Paquete regulatorio
                    </button>
                    <button onClick={descargarDossierRegulatorioPdf} style={{border:"1px solid rgba(15,118,110,.30)",background:"rgba(15,118,110,.10)",color:"#0f766e",borderRadius:7,padding:"5px 9px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Dossier PDF
                    </button>
                    {["efti","ecmr","diwass"].map(type => (
                      <button key={type} onClick={()=>descargarPayloadRegulatorio(type)} style={{border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text3)",borderRadius:7,padding:"5px 9px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                        JSON {type.toUpperCase()}
                      </button>
                    ))}
                    <button onClick={()=>crearBorradorTransmisionRegulatoria("efti")} style={{border:"1px solid rgba(20,184,166,.30)",background:"rgba(20,184,166,.10)",color:"#0f766e",borderRadius:7,padding:"5px 9px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Borrador envío eFTI
                    </button>
                  </div>
                  {regulatoryChecklist.length > 0 && (
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginTop:8}}>
                      {regulatoryChecklist.map((item) => {
                        const color = item.status === "ready" || item.status === "prepared" ? "#10b981" : item.status === "not_applicable" ? "var(--text5)" : "#f59e0b";
                        return (
                          <div key={item.key} title={item.detail || ""} style={{padding:"8px 10px",borderRadius:7,background:"var(--bg2)",border:"1px solid var(--border)"}}>
                            <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:"var(--text5)",letterSpacing:".04em"}}>{item.label}</div>
                            <div style={{fontWeight:900,color}}>{item.status || "-"}</div>
                            {!!item.missing?.length && <div style={{fontSize:10,color:"#f59e0b"}}>{item.missing.join(", ")}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {docControlFaltantes.length > 0 && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.22)",fontSize:12,color:"#f59e0b"}}>
                  Faltan datos para cumplir bien el documento digital: {docControlFaltantes.join(" | ")}
                </div>
              )}
              {docControlAvisos.length > 0 && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.20)",fontSize:12,color:"var(--accent)"}}>
                  Avisos de preparacion eCMR/eFTI: {docControlAvisos.join(" | ")}
                </div>
              )}
              {docControl?.remision && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.18)",fontSize:12,color:"var(--text3)"}}>
                  <div style={{fontWeight:800,color:"var(--text)",marginBottom:4}}>Canal de remision</div>
                  <div style={{marginBottom:4}}>{docControl.remision.etiqueta}</div>
                  <div style={{color:"var(--text4)"}}>{docControl.remision.instrucciones}</div>
                </div>
              )}
              {docControl?.documento?.condiciones && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:8,background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.18)",fontSize:12,color:"var(--text3)"}}>
                  <div style={{fontWeight:800,color:"var(--text)",marginBottom:4}}>Condiciones documentadas</div>
                  <div><strong>Pago:</strong> {docControl.documento.condiciones.forma_pago || "-"}</div>
                  {!!docControl.documento.condiciones.operativa_carga?.length && (
                    <div><strong>Operativa:</strong> {docControl.documento.condiciones.operativa_carga.join(" | ")}</div>
                  )}
                  <div style={{color:"var(--text4)",marginTop:4}}>{docControl.documento.condiciones.revision_combustible}</div>
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
                {docControlChecks.map(check => (
                  <div key={check.key} style={{padding:"8px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg4)",fontSize:11,color:check.ok?"#10b981":check.required === false ? "var(--accent)" : "var(--text4)",fontWeight:700}}>
                    {check.ok ? "OK" : check.required === false ? "Aviso" : "Pendiente"} | {check.label}
                  </div>
                ))}
              </div>
                </div>
              </details>
              )}
            </>
          )}
        </div>

        {/* Datos del viaje */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          {[["Origen",origenOrden],["Destino",destinoOrden],
              ["Fecha carga",pedido.fecha_carga?new Date(pedido.fecha_carga).toLocaleDateString("es-ES"):"-"],
              ["Hora carga",pedido.hora_carga||"-"],
              ["Ventana carga",pedido.ventana_carga||"-"],
              ["Fecha descarga",pedido.fecha_descarga?new Date(pedido.fecha_descarga).toLocaleDateString("es-ES"):(pedido.fecha_entrega?new Date(pedido.fecha_entrega).toLocaleDateString("es-ES"):"-")],
              ["Hora descarga",pedido.hora_descarga||"-"],
              ["Ventana descarga",pedido.ventana_descarga||"-"],
              ["Estado",pedido.estado],
              ["Peso (kg)",pedido.peso_kg||pedido.kg||"-"],["Bultos",pedido.bultos||"-"],
            esColaborador?["Colaborador",pedido.colaborador_nombre]:["Vehiculo",pedido.vehiculo_matricula||pedido.matricula||"-"],
            esColaborador?["Vehiculo colaborador",pedido.matricula_colaborador||"(pendiente del colaborador)"]:["Chofer",pedido.chofer_nombre||"-"],
            ...(esColaborador?[["Remolque colaborador",pedido.remolque_matricula_colaborador||"-"]]:[]),
            ...(pedido.chofer2_nombre?[["2o Chofer",pedido.chofer2_nombre]]:[] ),
          ].map(([l,v])=>(
            <div key={l} style={S2.kv}>
              <div style={S2.lbl}>{l}</div>
              <div style={S2.val}>{v||"-"}</div>
            </div>
          ))}
          {(pedido.notas||pedido.descripcion_carga)&&(
            <div style={{...S2.kv,gridColumn:"1/-1"}}>
              <div style={S2.lbl}>Mercancia / Instrucciones</div>
              <div style={S2.val}>{pedido.mercancia||pedido.descripcion_carga||pedido.notas||"-"}</div>
            </div>
          )}
          {allMapsRows.length > 0 && (
            <div style={{...S2.kv,gridColumn:"1/-1"}}>
              <div style={S2.lbl}>Google Maps para colaborador</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
                {allMapsRows.map((item, idx)=>(
                  <div key={`${item.label}-${idx}`} style={{border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px",background:"var(--bg4)"}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>{item.label}</div>
                    <div style={{...S2.val,fontSize:12,marginTop:3}}>{item.nombre || item.direccion || "-"}</div>
                    {item.nombre && item.direccion && <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{item.direccion}</div>}
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noreferrer" style={{display:"inline-block",marginTop:7,padding:"6px 10px",borderRadius:7,background:"rgba(59,130,246,.12)",border:"1px solid rgba(59,130,246,.24)",color:"var(--accent)",fontSize:11,fontWeight:800,textDecoration:"none"}}>
                        Abrir en Google Maps
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{...S2.kv,gridColumn:"1/-1"}}>
            <div style={S2.lbl}>Operativa de carga</div>
            <div style={S2.val}>{operativaCarga.join(" | ") || "-"}</div>
          </div>
        </div>

        {!esColaborador && (
          <div style={{background:"rgba(59,130,246,.06)",border:"1px solid rgba(59,130,246,.18)",borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontWeight:800,fontSize:12,textTransform:"uppercase",letterSpacing:".06em",color:"#60a5fa",marginBottom:8}}>Condiciones de pago</div>
            <div style={{fontSize:12,color:"var(--text3)",background:"var(--bg3)",borderRadius:7,padding:"8px 10px"}}>
              <strong>Forma de pago:</strong> {condicionesPagoCliente}
            </div>
          </div>
        )}

        {/* Seccion economica - solo si es colaborador */}
        {esColaborador && (
          <div style={{background:"rgba(139,92,246,.06)",border:"1px solid rgba(139,92,246,.2)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontWeight:800,fontSize:12,textTransform:"uppercase",letterSpacing:".06em",color:"#a78bfa",marginBottom:10}}>Condiciones economicas</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:10}}>
              {[
                ["Colaborador",pedido.colaborador_nombre || "Colaborador","#a78bfa"],
                ...(pagoColaboradorTonelada ? [
                  ["Precio por tonelada",`${pagoColaboradorTonelada.precioTonelada.toLocaleString("es-ES",{minimumFractionDigits:2})} EUR/tn`,"#10b981"],
                  ["Minimo facturable",`${pagoColaboradorTonelada.minimoToneladas.toLocaleString("es-ES",{maximumFractionDigits:3})} tn`,"#f59e0b"],
                ] : pagoColaboradorTotalCerrado ? [
                  ["Precio acordado",`${pagoColaboradorTotalCerrado.total.toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})} EUR`,"#10b981"],
                  ["Tipo de acuerdo","Precio cerrado","#f59e0b"],
                ] : [
                  ["Precio acordado","Pendiente","#f59e0b"],
                ]),
                ["Referencia",referenciaPedido,"#10b981"],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:"var(--bg3)",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:15,color:c}}>{v}</div>
                  <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".05em",marginTop:2}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:11,color:"var(--text4)",background:"var(--bg3)",borderRadius:7,padding:"8px 10px",marginBottom:10}}>
              {pagoColaboradorTonelada
                ? "La orden de colaborador imprimira el precio por tonelada y el minimo acordado. No mostrara el total cerrado."
                : pagoColaboradorTotalCerrado
                  ? "La orden de colaborador imprimira el precio cerrado acordado."
                  : "Indica el precio acordado con el colaborador para que aparezca en la orden."}
            </div>
            <div style={{fontSize:11,color:"var(--text4)",background:"var(--bg3)",borderRadius:7,padding:"8px 10px",marginBottom:10}}>
              <strong>Forma de pago:</strong> {condicionesPagoColaborador}
            </div>
            <PagoColaboradorPanel pedido={pedido} onUpdated={onClose}/>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Modal crear cliente rapido desde pedido ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function ModalNuevoClienteRapido({ datosIniciales, onClose, onCreado }) {
  const [form, setForm] = useState({
    nombre: datosIniciales?.nombre || "",
    cif: "", email: "", telefono: "",
    calle: "", num_ext: "", codigo_postal: "", ciudad: "", provincia: "", pais: "España",
    forma_pago: "Transferencia bancaria", tipo_iva: 21, iva_regimen: "general",
    contacto_nombre: "", contacto_telefono: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fk = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:12};

  // Detect incomplete fields
  const camposFaltantes = [
    !form.cif?.trim() && "CIF/NIF",
    !form.email?.trim() && "Email",
    !form.telefono?.trim() && "Telefono",
    !form.codigo_postal?.trim() && "Codigo postal",
    !form.ciudad?.trim() && "Ciudad",
  ].filter(Boolean);

  async function crear() {
    setError("");
    if (!form.nombre.trim()) { setError("El nombre / razon social es obligatorio."); return; }
    setSaving(true);
    try {
      const nuevo = await crearCliente({
        ...form,
        direccion: form.calle ? (form.calle + (form.num_ext?" "+form.num_ext:"")) : "",
        cp: form.codigo_postal,
        pendiente_revision: camposFaltantes.length > 0,
      });
      onCreado(nuevo);
    } catch(e) { setError(e.message || "No se pudo crear el cliente."); }
    finally { setSaving(false); }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:24,width:"min(600px,96vw)",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)",marginBottom:4}}>Nuevo cliente</div>
        <div style={{fontSize:12,color:"var(--text4)",marginBottom:16}}>
          Rellena todos los datos posibles. Los campos incompletos generaran una notificacion para que administracion los complete.
        </div>

        {/* Datos basicos */}
        <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:6,marginTop:4,textTransform:"uppercase",letterSpacing:".06em"}}>Datos de empresa</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Nombre / Razon social *</label><input style={inp} value={form.nombre} onChange={fk("nombre")} autoFocus/></div>
          <div><label style={lbl}>CIF / NIF</label><input style={inp} value={form.cif} onChange={fk("cif")} placeholder="B12345678"/></div>
          <div><label style={lbl}>Telefono</label><input style={inp} value={form.telefono} onChange={fk("telefono")}/></div>
          <div><label style={lbl}>Email facturacion</label><input type="email" style={inp} value={form.email} onChange={fk("email")}/></div>
          <div><label style={lbl}>Forma de pago</label>
            <select style={inp} value={form.forma_pago} onChange={fk("forma_pago")}>
              {["Contado","Transferencia bancaria","30 dias","45 dias","60 dias","90 dias"].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {/* Direccion */}
        <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:6,marginTop:16,textTransform:"uppercase",letterSpacing:".06em"}}>Direccion fiscal</div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:"0 14px"}}>
          <div><label style={lbl}>Calle / Avenida</label><input style={inp} value={form.calle} onChange={fk("calle")} placeholder="Calle Mayor"/></div>
          <div><label style={lbl}>N. / Piso / Pta</label><input style={inp} value={form.num_ext} onChange={fk("num_ext")} placeholder="12, 3oB"/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 2fr 2fr",gap:"0 14px"}}>
          <div><label style={lbl}>Codigo postal</label><input style={inp} value={form.codigo_postal} onChange={fk("codigo_postal")} placeholder="28001"/></div>
          <div><label style={lbl}>Ciudad</label><input style={inp} value={form.ciudad} onChange={fk("ciudad")}/></div>
          <GeoFields
            values={form}
            onChange={(campo, valor) => setForm(p => ({ ...p, [campo]: valor }))}
            inputStyle={inp}
            labelStyle={lbl}
          />
        </div>

        {/* Contacto */}
        <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:6,marginTop:16,textTransform:"uppercase",letterSpacing:".06em"}}>Contacto</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <div><label style={lbl}>Nombre contacto</label><input style={inp} value={form.contacto_nombre} onChange={fk("contacto_nombre")}/></div>
          <div><label style={lbl}>Tel. contacto</label><input style={inp} value={form.contacto_telefono} onChange={fk("contacto_telefono")}/></div>
        </div>

        {/* Warning if incomplete */}
        {camposFaltantes.length > 0 && (
          <div style={{marginTop:14,padding:"10px 14px",background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.25)",borderRadius:8,fontSize:12,color:"#fbbf24",display:"flex",gap:8,alignItems:"flex-start"}}>
            <span style={{flexShrink:0}}>Aviso</span>
            <div>
              <div style={{fontWeight:700,marginBottom:3}}>Datos incompletos - el cliente quedara marcado para revision</div>
              <div style={{color:"var(--text4)"}}>Faltan: {camposFaltantes.join(", ")}. Administracion recibira una notificacion para completarlos.</div>
            </div>
          </div>
        )}
        {error && (
          <div style={{marginTop:14,padding:"10px 14px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,fontSize:12,color:"#ef4444",fontWeight:700}}>
            {error}
          </div>
        )}

        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--border2)",background:"transparent",color:"var(--text4)",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>
            Cancelar
          </button>
          <button onClick={crear} disabled={saving}
            style={{padding:"8px 20px",borderRadius:8,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer",opacity:saving?0.7:1}}>
            {saving?"Creando...":"Crear cliente y continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Auto-asignacion IA ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function ModalAutoAsignacion({ pedido, vehiculos, choferes, onAsignar, onClose }) {
  const [loading,   setLoading]   = useState(true);
  const [sugerencia, setSugerencia] = useState(null);
  const [candidatos, setCandidatos] = useState([]);
  const [policy, setPolicy] = useState("");
  const [error,     setError]     = useState("");
  const [aplicando, setAplicando] = useState(false);

  const analizar = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await getPlanificacionCargaIA(pedido.id);
      const list = Array.isArray(data.candidatos) ? data.candidatos : [];
      if (!list.length) throw new Error("No hay vehiculos candidatos para planificar esta carga.");
      setCandidatos(list);
      setPolicy(data.data_policy || "");
      setSugerencia(data.sugerencia || list[0]);
    } catch(e) {
      setError("No se pudo obtener sugerencia: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [pedido?.id]);

  useEffect(() => { analizar(); }, [analizar]);

  const CONFIANZA_COLOR = { alta:"#10b981", media:"#f59e0b", baja:"#f97316" };
  const fmtMin = (mins) => {
    const n = Number(mins);
    if (!Number.isFinite(n)) return "-";
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return h <= 0 ? `${m} min` : `${h} h ${String(m).padStart(2, "0")} min`;
  };
  const fmtDateTime = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString("es-ES", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:24,width:"min(520px,96vw)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:22}}>IA</span>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)"}}>Autoasignacion IA</div>
            <div style={{fontSize:12,color:"var(--text4)"}}>{pedido.numero} | {pedido.origen} -> {pedido.destino}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:20,cursor:"pointer",marginLeft:"auto",padding:4}}>Cerrar</button>
        </div>

        {loading && (
          <div style={{textAlign:"center",padding:"32px 0",color:"var(--text4)"}}>
            <div style={{fontSize:28,marginBottom:10}}>!</div>
            <div style={{fontSize:13}}>Analizando pedido y vehiculos disponibles...</div>
          </div>
        )}

        {error && !loading && (
          <div style={{padding:"12px 16px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",borderRadius:9,fontSize:13,color:"#ef4444",marginTop:12}}>
            Aviso: {error}
            <button onClick={analizar} style={{marginLeft:12,background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontWeight:700,textDecoration:"underline",fontSize:12}}>Reintentar</button>
          </div>
        )}

        {sugerencia && !loading && (
          <div>
            {/* Confianza */}
            <div style={{display:"flex",alignItems:"center",gap:8,margin:"16px 0 12px"}}>
              <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)"}}>Confianza:</span>
              <span style={{padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:`${CONFIANZA_COLOR[sugerencia.confianza] || "#94a3b8"}18`,color:CONFIANZA_COLOR[sugerencia.confianza] || "#94a3b8",border:`1px solid ${CONFIANZA_COLOR[sugerencia.confianza] || "#94a3b8"}40`}}>
                {sugerencia.confianza?.toUpperCase()}
              </span>
              {Number.isFinite(Number(sugerencia.score)) && (
                <span style={{fontSize:11,color:"var(--text4)",fontWeight:800}}>Score {sugerencia.score}/100</span>
              )}
            </div>

            {/* Sugerencia */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div style={{background:"var(--bg3)",borderRadius:9,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:6}}>Vehiculo sugerido</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:"var(--text)"}}>{sugerencia.vehiculo_matricula||"-"}</div>
                {sugerencia.remolque_matricula && (
                  <div style={{fontSize:11,color:"#a78bfa",marginTop:3}}>Remolque: {sugerencia.remolque_matricula}</div>
                )}
                {!vehiculos.find(v=>v.id===sugerencia.vehiculo_id) && sugerencia.vehiculo_id && (
                  <div style={{fontSize:10,color:"#f97316",marginTop:3}}>ID no encontrado</div>
                )}
              </div>
              <div style={{background:"var(--bg3)",borderRadius:9,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:6}}>Chofer sugerido</div>
                <div style={{fontWeight:700,fontSize:14,color:"var(--text)"}}>{sugerencia.chofer_nombre||"-"}</div>
                {!choferes.find(c=>c.id===sugerencia.chofer_id) && sugerencia.chofer_id && (
                  <div style={{fontSize:10,color:"#f97316",marginTop:3}}>No encontrado</div>
                )}
              </div>
            </div>

            {/* Razon */}
            <div style={{background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.15)",borderRadius:9,padding:"10px 14px",fontSize:13,color:"var(--text2)",lineHeight:1.6,marginBottom:12}}>
              Motivo: {sugerencia.razon}
              <div style={{fontSize:11,color:"var(--text4)",marginTop:6}}>
                Fuente posicion: {sugerencia.ubicacion?.source || "sin posicion"}
                {sugerencia.ubicacion?.priority === "gps_api" ? " (GPS conectado)" : sugerencia.ubicacion?.priority === "app_chofer" ? " (app chofer)" : ""}
                {sugerencia.distancia_origen_km != null ? ` - ${sugerencia.distancia_origen_km} km al origen` : ""}
              </div>
              {policy && <div style={{fontSize:10,color:"var(--text5)",marginTop:5}}>{policy}</div>}
            </div>

            {sugerencia.reposicionamiento && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:12}}>
                <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"10px 11px"}}>
                  <div style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4}}>Termina / sale desde</div>
                  <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{sugerencia.reposicionamiento.source_label || "-"}</div>
                  {sugerencia.reposicionamiento.from_text && <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>{sugerencia.reposicionamiento.from_text}</div>}
                </div>
                <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"10px 11px"}}>
                  <div style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4}}>Hasta carga</div>
                  <div style={{fontSize:14,fontWeight:900,color:"var(--text)"}}>
                    {sugerencia.reposicionamiento.distancia_hasta_carga_km != null ? `${sugerencia.reposicionamiento.distancia_hasta_carga_km} km` : "-"}
                  </div>
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>{fmtMin(sugerencia.reposicionamiento.tiempo_hasta_carga_min)}</div>
                </div>
                <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"10px 11px"}}>
                  <div style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4}}>Llegada prevista</div>
                  <div style={{fontSize:13,fontWeight:900,color:sugerencia.reposicionamiento.llega_antes_hora_carga === false ? "#f59e0b" : "#10b981"}}>
                    {fmtDateTime(sugerencia.reposicionamiento.llegada_estimada_carga_at)}
                  </div>
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>salida {fmtDateTime(sugerencia.reposicionamiento.salida_considerada_at)}</div>
                </div>
                <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"10px 11px"}}>
                  <div style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4}}>Horas chofer</div>
                  <div style={{fontSize:13,fontWeight:900,color:sugerencia.tacografo?.integrated ? "#10b981" : "var(--text)"}}>
                    {sugerencia.tacografo?.conduccion_disponible_min != null ? fmtMin(sugerencia.tacografo.conduccion_disponible_min) : "Sin dato"}
                  </div>
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>
                    {sugerencia.tacografo?.integrated ? `Tacografo ${sugerencia.tacografo.source || ""}` : sugerencia.tacografo?.source === "app_chofer_estimado" ? "Estimado por app chofer" : "Sin tacografo integrado"}
                  </div>
                </div>
              </div>
            )}

            {candidatos.length > 1 && (
              <div style={{display:"grid",gap:6,marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>Ranking de candidatos</div>
                {candidatos.slice(0, 5).map(c => {
                  const active = String(c.vehiculo_id) === String(sugerencia.vehiculo_id);
                  return (
                    <button
                      type="button"
                      key={`${c.vehiculo_id}-${c.chofer_id || "sin-chofer"}`}
                      onClick={()=>setSugerencia(c)}
                      style={{display:"grid",gridTemplateColumns:"58px 1fr auto",gap:8,alignItems:"center",textAlign:"left",border:`1px solid ${active ? "rgba(139,92,246,.45)" : "var(--border2)"}`,background:active ? "rgba(139,92,246,.10)" : "var(--bg3)",borderRadius:8,padding:"8px 10px",cursor:"pointer",color:"var(--text)"}}
                    >
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:900,color:active?"#a78bfa":"var(--text3)"}}>{c.score}/100</span>
                      <span>
                        <span style={{display:"block",fontSize:12,fontWeight:900}}>{c.vehiculo_matricula || "-"} · {c.chofer_nombre || "Sin chofer"}</span>
                        <span style={{display:"block",fontSize:10,color:"var(--text5)",marginTop:2}}>
                          {c.ubicacion?.priority === "gps_api" ? "GPS API" : c.ubicacion?.priority === "app_chofer" ? "App chofer" : c.ubicacion?.source || "Sin posicion"}
                          {c.distancia_origen_km != null ? ` · ${c.distancia_origen_km} km` : ""}
                        </span>
                      </span>
                      <span style={{fontSize:10,fontWeight:900,color:CONFIANZA_COLOR[c.confianza] || "var(--text4)",textTransform:"uppercase"}}>{c.confianza || ""}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Advertencias */}
            {sugerencia.advertencias?.length > 0 && (
              <div style={{background:"rgba(245,158,11,.07)",border:"1px solid rgba(245,158,11,.2)",borderRadius:9,padding:"10px 14px",marginBottom:14}}>
                {sugerencia.advertencias.map((a,i)=>(
                  <div key={i} style={{fontSize:12,color:"#fbbf24",display:"flex",gap:7,alignItems:"flex-start"}}>
                    <span>Aviso</span><span>{a}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Aviso revision */}
            <div style={{fontSize:11,color:"var(--text5)",marginBottom:16,fontStyle:"italic"}}>
              Esta es una sugerencia automatica. Revisa que la asignacion es correcta antes de confirmar.
            </div>

            <div style={{display:"flex",gap:10}}>
              <button
                disabled={aplicando || !vehiculos.find(v=>v.id===sugerencia.vehiculo_id)}
                onClick={async()=>{
                  setAplicando(true);
                  await onAsignar({
                    vehiculo_id: sugerencia.vehiculo_id,
                    chofer_id: sugerencia.chofer_id,
                    remolque_id_manual: sugerencia.remolque_id_manual || sugerencia.remolque_id || null,
                  });
                  onClose();
                }}
                style={{flex:1,padding:"11px 0",borderRadius:9,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:700,cursor:"pointer",opacity:aplicando?.7:1}}>
                {aplicando?"Asignando...":"Aplicar asignacion"}
              </button>
              <button onClick={analizar} style={{padding:"11px 16px",borderRadius:9,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>
                Nueva sugerencia
              </button>
              <button onClick={onClose} style={{padding:"11px 16px",borderRadius:9,border:"1px solid var(--border2)",background:"transparent",color:"var(--text4)",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>
                Ignorar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Tab Documentos de Pedido ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function TabDocsPedido({ pedido }) {
  const [docs,       setDocs]       = useState([]);
  const [uploading,  setUploading]  = useState(false);
  const [loading,    setLoading]    = useState(true);

  useEffect(()=>{
    if(!pedido?.id) return;
    getPedidoDocs(pedido.id)
      .then(d=>setDocs(Array.isArray(d)?d:[]))
      .catch(()=>setDocs([]))
      .finally(()=>setLoading(false));
  },[pedido?.id]);

  async function subir(e) {
    const files = Array.from(e.target.files || []);
    if(!files.length) return;
    setUploading(true);
    for (const file of files) {
      if(file.size > 3145728) { notify(`${file.name}: maximo 3MB por documento`, "warning"); continue; }
      try {
        const b64 = await fileToPedidoDocBase64(file);
        const tipo = inferPedidoDocTipo(file.name);
        const doc = await subirPedidoDoc(pedido.id, {
          nombre: file.name,
          tipo,
          file_base64: b64,
          file_mime: file.type || "application/pdf",
          file_size_kb: Math.round(file.size/1024),
        });
        setDocs(p=>[...p, doc]);
      } catch(err) { notify("Error al subir: "+err.message, "error"); }
    }
    setUploading(false);
    e.target.value="";
  }

  const TIPO_COLOR = {
    CMR:"#3b82f6", "Albaran":"#10b981", "Foto descarga":"#f59e0b",
    Pesaje:"#8b5cf6", Incidencia:"#ef4444", Otro:"#6b7280"
  };

  async function verDoc(doc) {
    try {
      await verArchivoProtegido(`/empresa/pedido-docs/doc/${encodeURIComponent(doc.id)}/archivo`, doc.nombre || "documento");
    } catch (err) {
      notify(err.message || "No se pudo abrir el documento.", "error");
    }
  }

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:600,color:"var(--text3)"}}>Documentos del viaje</div>
        <label style={{marginLeft:"auto",padding:"5px 12px",borderRadius:7,background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:700,cursor:uploading?"not-allowed":"pointer",opacity:uploading?0.6:1}}>
          {uploading?"Subiendo...":"Adjuntar"}
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:"none"}} disabled={uploading} onChange={subir}/>
        </label>
      </div>
      {loading ? (
        <div style={{color:"var(--text5)",fontSize:12,textAlign:"center",padding:20}}>Cargando...</div>
      ) : docs.length === 0 ? (
        <div style={{textAlign:"center",padding:"24px 0",color:"var(--text5)"}}>
          <div style={{fontSize:28,marginBottom:6}}>Docs</div>
          <div style={{fontSize:12}}>Sin documentos adjuntos</div>
          <div style={{fontSize:11,marginTop:4}}>Adjunta CMR, albaranes, fotos de descarga, etc.</div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {docs.map(d=>(
            <div key={d.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"var(--bg3)",borderRadius:8,border:"1px solid var(--border)"}}>
              <span style={{fontSize:18}}>
                {d.file_mime?.includes("pdf")?"PDF":d.file_mime?.startsWith("image/")?"IMG":"DOC"}
              </span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.nombre}</div>
                <div style={{fontSize:10,color:"var(--text5)"}}>{d.file_size_kb}KB | {new Date(d.created_at).toLocaleDateString("es-ES")}</div>
              </div>
              <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:4,background:`${TIPO_COLOR[d.tipo]||"#6b7280"}20`,color:TIPO_COLOR[d.tipo]||"#6b7280",border:`1px solid ${TIPO_COLOR[d.tipo]||"#6b7280"}40`,flexShrink:0}}>
                {d.tipo}
              </span>
              <button onClick={()=>verDoc(d)} style={{border:"1px solid var(--border2)",background:"var(--bg)",color:"var(--accent)",borderRadius:7,padding:"5px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",flexShrink:0}}>Ver</button>
              <button onClick={async()=>{
                const ok = await confirmDialog({
                  title: "Eliminar documento",
                  message: "Eliminar este documento del viaje?",
                  confirmText: "Eliminar",
                  tone: "danger",
                });
                if(!ok) return;
                await borrarPedidoDoc(d.id);
                setDocs(p=>p.filter(x=>x.id!==d.id));
              }} style={{background:"none",border:"none",color:"var(--text5)",cursor:"pointer",fontSize:16,padding:"0 2px",flexShrink:0}}>Eliminar</button>
            </div>
          ))}
        </div>
      )}
      <div style={{marginTop:12,fontSize:10,color:"var(--text5)"}}>
        Los documentos se adjuntaran automaticamente al enviar la factura por email.
      </div>
    </div>
  );
}


// Memoized - solo re-renderiza cuando cambia el peso, vehiculo o remolque
const PesoAlerta = React.memo(function PesoAlerta({ pesoKg, vehiculoId, remolqueId, vehiculos }) {
  if (!pesoKg) return null;
  const veh = (vehiculos||[]).find(v=>v.id===vehiculoId);
  const rem = (vehiculos||[]).find(v=>v.id===(remolqueId||veh?.remolque_id));
  // checkNormativaPeso inlined to avoid hoisting issues with React.memo
  const alerta = (function(pesoKg, veh, rem) {
    const MMA_VEH = veh?.masa_total_kg ? Number(veh.masa_total_kg) : (veh?.carga_max_kg ? Number(veh.carga_max_kg) + 8000 : 0);
    const MMA_REM = rem?.masa_total_kg ? Number(rem.masa_total_kg) : (rem?.carga_max_kg ? Number(rem.carga_max_kg) + 4000 : 0);
    const ejes = Number(veh?.ejes||0) + Number(rem?.ejes||0);
    const pesoTotal = Number(pesoKg||0);
    if (!pesoTotal) return null;
    if (pesoTotal > 44000) return { nivel:"error", mensaje:`Error: peso ${(pesoTotal/1000).toFixed(1)}t supera el maximo legal de 44t (vehiculos especiales con 6+ ejes). Requiere autorizacion especial.` };
    if (pesoTotal > 40000 && ejes < 6) return { nivel:"error", mensaje:`Error: peso ${(pesoTotal/1000).toFixed(1)}t supera 40t. Para cargas entre 40-44t se requieren 6 ejes y autorizacion especial.` };
    if (pesoTotal > 40000) return { nivel:"aviso", mensaje:`Aviso: peso ${(pesoTotal/1000).toFixed(1)}t entre 40-44t. Requiere autorizacion especial y 6+ ejes.` };
    if (MMA_VEH && pesoTotal > MMA_VEH + MMA_REM) return { nivel:"error", mensaje:`Error: peso ${(pesoTotal/1000).toFixed(1)}t supera la MMA del conjunto (${((MMA_VEH+MMA_REM)/1000).toFixed(1)}t).` };
    if (pesoTotal > 34000) return { nivel:"info", mensaje:`Info: carga pesada ${(pesoTotal/1000).toFixed(1)}t. Verifica los ejes del conjunto.` };
    return null;
  })(pesoKg, veh, rem);
  if (!alerta) return null;
  const colors = {
    error: {bg:"rgba(239,68,68,.08)",border:"rgba(239,68,68,.3)",text:"#ef4444",icon:"Error"},
    aviso: {bg:"rgba(245,158,11,.08)",border:"rgba(245,158,11,.3)",text:"#f59e0b",icon:"Aviso"},
    info:  {bg:"rgba(59,130,246,.08)",border:"rgba(59,130,246,.25)",text:"#60a5fa",icon:"Info"},
  };
  const col = colors[alerta.nivel];
  return (
    <div style={{marginTop:6,padding:"7px 10px",background:col.bg,
                 border:`1px solid ${col.border}`,borderRadius:7,fontSize:11,
                 color:col.text,display:"flex",gap:6,alignItems:"flex-start"}}>
      <span style={{flexShrink:0}}>{col.icon}</span>
      <span style={{lineHeight:1.5}}>{alerta.mensaje}</span>
    </div>
  );
});


function PedidoTimeline({ pedido }) {
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!pedido?.id) return;
    setLoading(true);
    getPedidoEventos(pedido.id)
      .then(data => setEventos(Array.isArray(data) ? data : []))
      .catch(() => setEventos([]))
      .finally(() => setLoading(false));
  }, [pedido?.id]);

  const labelEvento = tipo => ({
    "estado.actualizado": "Estado actualizado",
    "pedido.creado": "Pedido creado",
    "pedido.editado": "Pedido editado",
    "pedido.creado_bandeja_ia": "Creado desde Bandeja IA",
    "pedido.editado_estado": "Estado editado",
    "firma.contexto_modificado": "Firma con cambios posteriores",
    "firma.evidencia_registrada": "Evidencia de firma",
    "factura.borrador_auto": "Borrador de factura",
    "colaborador.factura_recibida_auto": "Factura proveedor",
    "colaborador.workflow_enviado": "Enlace colaborador",
    "colaborador.carga_confirmada": "Carga confirmada",
    "colaborador.descarga_confirmada": "Descarga confirmada",
    "documento_control.abierto": "DCD abierto",
    "documento_control.impreso": "DCD impreso",
    "documento_control.descargado": "DCD descargado",
    "documento_control.copiado": "DCD enlace copiado",
    "documento_control.compartido": "DCD compartido",
    "documento_control.consultado": "DCD consultado",
    "documento_control.remitido": "DCD remitido",
  }[tipo] || String(tipo || "Evento"));

  const formatoDetalleEvento = detalle => {
    if (!detalle || typeof detalle !== "object") return "";
    const documentos = Array.isArray(detalle.documentos_meta)
      ? detalle.documentos_meta.map(doc => [doc.nombre, doc.size_kb ? `${doc.size_kb} KB` : ""].filter(Boolean).join(" ")).filter(Boolean).join(", ")
      : "";
    const campos = [
      detalle.accion ? `Accion: ${detalle.accion}` : "",
      detalle.canal ? `Canal: ${detalle.canal}` : "",
      detalle.codigo_control ? `DCD: ${detalle.codigo_control}` : "",
      detalle.source ? `Origen: ${detalle.source}` : "",
      detalle.mensaje ? detalle.mensaje : "",
      Array.isArray(detalle.changes) && detalle.changes.length ? `Cambios: ${detalle.changes.map(change => `${change.label || change.field}: ${change.before ?? change.signed ?? "-"} -> ${change.after ?? change.current ?? "-"}`).slice(0, 3).join(" | ")}` : "",
      detalle.firma_nombre ? `Firmante: ${detalle.firma_nombre}` : "",
      detalle.firma_hash ? `Hash firma: ${String(detalle.firma_hash).slice(0, 12)}...` : "",
      detalle.filename ? `Documento: ${detalle.filename}` : "",
      detalle.confidence !== undefined ? `Confianza: ${detalle.confidence}%` : "",
      detalle.status ? `Estado IA: ${detalle.status}` : "",
      detalle.attachments_count !== undefined ? `Adjuntos: ${detalle.attachments_count}` : "",
      detalle.visual_provider ? `IA visual: ${detalle.visual_provider}` : "",
      detalle.ready !== undefined ? `Listo: ${detalle.ready ? "si" : "no"}` : "",
      documentos ? `Docs: ${documentos}` : "",
    ].filter(Boolean);
    if (campos.length) return campos.join(" / ");
    return Object.entries(detalle)
      .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v ?? ""}`)
      .join(" / ");
  };

  return (
    <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid var(--border)"}}>
      <div style={{fontSize:12,fontWeight:800,color:"var(--text4)",marginBottom:10,textTransform:"uppercase",letterSpacing:".06em"}}>Trazabilidad del viaje</div>
      {loading
        ? <div style={{fontSize:12,color:"var(--text5)"}}>Cargando historial...</div>
        : eventos.length===0
          ? <div style={{fontSize:12,color:"var(--text5)"}}>Sin eventos registrados todavia.</div>
          : <div style={{display:"grid",gap:8}}>
              {eventos.slice(0,8).map(ev => {
                const isAiEvent = ev.tipo === "pedido.creado_bandeja_ia";
                const isSignatureWarning = ev.tipo === "firma.contexto_modificado";
                const actor = ev.actor_nombre || ev.actor_email || ev.actor_tipo || "Sistema";
                return (
                  <div key={ev.id} style={{display:"grid",gridTemplateColumns:"130px 1fr",gap:10,alignItems:"start",background:isSignatureWarning?"rgba(245,158,11,.08)":isAiEvent?"rgba(59,130,246,.08)":"var(--bg3)",border:`1px solid ${isSignatureWarning?"rgba(245,158,11,.28)":isAiEvent?"rgba(59,130,246,.25)":"#1e2d45"}`,borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text5)"}}>
                      {ev.created_at ? new Date(ev.created_at).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "-"}
                    </div>
                    <div>
                      <div style={{fontSize:12,fontWeight:800,color:isSignatureWarning?"#f59e0b":isAiEvent?"#60a5fa":"var(--text)"}}>{labelEvento(ev.tipo)}</div>
                      <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,marginTop:1}}>
                        {actor}{ev.actor_rol ? ` - ${ev.actor_rol}` : ""}
                      </div>
                      {ev.detalle && Object.keys(ev.detalle).length>0 && (
                        <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>
                          {formatoDetalleEvento(ev.detalle)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
      }
    </div>
  );
}

function PedidoRentabilidadPredictiva({ pedido }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pedido?.id) return;
    setLoading(true);
    getPedidoRentabilidadPredictiva(pedido.id)
      .then(res => setData(res && typeof res === "object" ? res : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [pedido?.id]);

  if (!pedido?.id) return null;
  const color = data?.margen?.color === "rojo" ? "#ef4444" : data?.margen?.color === "amarillo" ? "#f59e0b" : "#10b981";
  const riesgos = Array.isArray(data?.riesgos) ? data.riesgos : [];
  const acciones = Array.isArray(data?.acciones) ? data.acciones : [];
  const fmtRent = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid var(--border)"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:10}}>
        <div>
          <div style={{fontSize:12,fontWeight:800,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".06em"}}>Rentabilidad predictiva</div>
          <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>Decision economica con precio, costes, kilometros, documentos y riesgos operativos.</div>
        </div>
        {data?.decision && (
          <span style={{padding:"3px 9px",borderRadius:20,fontSize:10,fontWeight:900,textTransform:"uppercase",color,background:`${color}16`,border:`1px solid ${color}30`}}>
            {data.decision.replace(/_/g, " ")}
          </span>
        )}
      </div>
      {loading ? (
        <div style={{fontSize:12,color:"var(--text5)"}}>Calculando rentabilidad...</div>
      ) : !data ? (
        <div style={{fontSize:12,color:"var(--text5)"}}>Sin datos suficientes para calcular rentabilidad.</div>
      ) : (
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:8}}>
            {[
              ["Ingreso", `${fmtRent(data.ingreso?.total)} EUR`, "#10b981"],
              ["Coste", `${fmtRent(data.costes?.total)} EUR`, "#f59e0b"],
              ["Margen", `${fmtRent(data.margen?.importe)} EUR`, color],
              ["Margen %", data.margen?.pct == null ? "-" : `${fmtRent(data.margen.pct)}%`, color],
              ["EUR/km", data.ingreso?.eur_km == null ? "-" : `${fmtRent(data.ingreso.eur_km)}`, "var(--accent)"],
            ].map(([label,value,c]) => (
              <div key={label} style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,padding:"9px 10px"}}>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:16,color:c}}>{value}</div>
                <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,padding:"9px 11px",borderRadius:8,background:"var(--bg3)",border:"1px solid var(--border2)",fontSize:12,color:"var(--text3)",lineHeight:1.45}}>
            <strong style={{color:"var(--text)"}}>Recomendacion:</strong> {data.recomendacion || "-"}
          </div>
          {riesgos.length > 0 && (
            <div style={{display:"grid",gap:6,marginTop:10}}>
              {riesgos.slice(0,4).map(r => {
                const rc = r.severidad === "critica" || r.severidad === "alta" ? "#ef4444" : r.severidad === "media" ? "#f59e0b" : "#3b82f6";
                return (
                  <div key={`${r.tipo}-${r.mensaje}`} style={{fontSize:12,color:rc,background:`${rc}12`,border:`1px solid ${rc}25`,borderRadius:8,padding:"7px 9px",fontWeight:700}}>
                    {r.mensaje}
                  </div>
                );
              })}
            </div>
          )}
          {acciones.length > 0 && (
            <div style={{marginTop:8,fontSize:11,color:"var(--text5)"}}>
              Acciones sugeridas: {acciones.slice(0,3).join(" / ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PedidoModal - aislado del componente padre para evitar re-renders
// La key prop asegura nuevo estado cuando cambia el pedido editado
// ---------------------------------------------------------------------------
function getPedidoIncidenciaResumen(pedido = {}) {
  const descripcion = String(pedido.incidencia_descripcion || "").trim()
    || (String(pedido.notas || "").match(/INCIDENCIA(?: AUTO)?:\s*([^|]+)/i)?.[1] || "").trim();
  const estadoIncidencia = String(pedido.estado || "").toLowerCase() === "incidencia";
  if (!descripcion && !estadoIncidencia) return null;
  const minutos = Number(pedido.paralizacion_minutos || 0);
  const importe = Number(pedido.paralizacion_importe || 0);
  return {
    tipo: pedido.incidencia_tipo || (minutos > 0 ? "paralizacion" : "operativa"),
    descripcion: descripcion || "Incidencia abierta pendiente de detalle.",
    origen: pedido.incidencia_origen || "trafico",
    automatica: pedido.incidencia_automatica === true || pedido.incidencia_automatica === "true",
    creadaAt: pedido.incidencia_creada_at || null,
    minutos,
    importe,
    moneda: pedido.paralizacion_moneda || "EUR",
    norma: pedido.paralizacion_norma || "",
    pais: pedido.paralizacion_pais || "",
  };
}

function PedidoIncidenciaPanel({ pedido }) {
  const inc = getPedidoIncidenciaResumen(pedido);
  if (!inc) return null;
  const importeTxt = inc.importe > 0
    ? `${inc.importe.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${inc.moneda}`
    : "Pendiente de pacto/norma aplicable";
  const origenTxt = inc.automatica ? "Automatica" : inc.origen === "chofer" ? "Chofer" : "Trafico";
  const fechaTxt = inc.creadaAt ? new Date(inc.creadaAt).toLocaleString("es-ES") : "";
  return (
    <div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.28)",borderRadius:9,padding:"11px 13px",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:11,color:"#ef4444",fontWeight:900,textTransform:"uppercase",letterSpacing:".08em"}}>Incidencia activa</div>
          <div style={{fontSize:14,color:"var(--text)",fontWeight:900,marginTop:3}}>{inc.descripcion}</div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <span style={{fontSize:10,fontWeight:900,color:"#ef4444",border:"1px solid rgba(239,68,68,.32)",borderRadius:999,padding:"4px 8px",background:"rgba(239,68,68,.08)"}}>{origenTxt}</span>
          {fechaTxt && <span style={{fontSize:10,fontWeight:800,color:"var(--text4)",border:"1px solid var(--border2)",borderRadius:999,padding:"4px 8px",background:"var(--bg3)"}}>{fechaTxt}</span>}
        </div>
      </div>
      {(inc.minutos > 0 || inc.norma || inc.pais) && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginTop:10}}>
          <div style={{border:"1px solid var(--border2)",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
            <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>Tiempo detenido</div>
            <div style={{fontSize:15,color:"var(--text)",fontWeight:900}}>{inc.minutos > 0 ? `${inc.minutos} min` : "-"}</div>
          </div>
          <div style={{border:"1px solid var(--border2)",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
            <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>Importe orientativo</div>
            <div style={{fontSize:15,color:"#ef4444",fontWeight:900}}>{importeTxt}</div>
          </div>
          <div style={{border:"1px solid var(--border2)",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
            <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>Pais operacion</div>
            <div style={{fontSize:15,color:"var(--text)",fontWeight:900}}>{inc.pais || "-"}</div>
          </div>
        </div>
      )}
      {inc.norma && (
        <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.35,marginTop:8}}>
          {inc.norma}
        </div>
      )}
    </div>
  );
}

function getPedidoMapPoint(pedido = {}, side = "origen", stop = null, idx = 0) {
  const isOrigen = side === "origen";
  const rawStop = stop || parseStops(isOrigen ? pedido.puntos_carga : pedido.puntos_descarga)[0] || {};
  const initialLabel = rawStop.nombre || rawStop.name || rawStop.cliente_nombre || rawStop.direccion || pedido[side] || "";
  const tipo = isOrigen ? "carga" : "descarga";
  const puntoGuardado = findPuntoInteresForStop(rawStop, initialLabel)
    || findPuntoInteresForTypedEndpoint(initialLabel || pedido[side], pedido.cliente_id || "", tipo);
  const puntoStop = puntoGuardado ? puntoToStop(puntoGuardado) : {};
  const googleMapsUrl = rawStop.google_maps_url || rawStop.googleMapsUrl || puntoStop.google_maps_url || "";
  const mapsCoords = coordsFromMapsUrl(googleMapsUrl);
  const sourceStop = {
    ...puntoStop,
    ...rawStop,
    lat: rawStop.lat ?? rawStop.latitud ?? rawStop.latitude ?? puntoStop.lat ?? puntoStop.latitud ?? mapsCoords?.lat ?? null,
    lng: rawStop.lng ?? rawStop.longitud ?? rawStop.lon ?? rawStop.longitude ?? puntoStop.lng ?? puntoStop.longitud ?? mapsCoords?.lng ?? null,
    google_maps_url: googleMapsUrl,
    provincia: rawStop.provincia || rawStop.region || puntoStop.provincia || "",
    pais: rawStop.pais || rawStop.country || puntoStop.pais || "",
  };
  const lat = Number(sourceStop.lat ?? sourceStop.latitude ?? pedido[`${side}_lat`] ?? pedido[`${side}_latitude`]);
  const lng = Number(sourceStop.lng ?? sourceStop.lon ?? sourceStop.longitude ?? pedido[`${side}_lng`] ?? pedido[`${side}_lon`] ?? pedido[`${side}_longitude`]);
  const label = sourceStop.nombre || sourceStop.name || sourceStop.cliente_nombre || sourceStop.direccion || pedido[side] || "";
  const provincia = sourceStop.provincia || pedido[`${side}_provincia`] || "";
  const pais = sourceStop.pais || pedido[`${side}_pais`] || "España";
  const localidad = sourceStop.ciudad || sourceStop.poblacion || sourceStop.localidad || sourceStop.municipio || "";
  const direccion = sourceStop.direccion || sourceStop.address || "";
  const direccionEsSoloNombre = normalizePlaceText(direccion) && normalizePlaceText(direccion) === normalizePlaceText(label);
  const query = [!direccionEsSoloNombre ? direccion : "", localidad].filter(Boolean).join(", ")
    || localidad || direccion || label;
  const pointDetails = {
    google_maps_url: googleMapsUrl,
    provincia,
    pais,
    query,
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, label, hasGeo:true, ...pointDetails };
  const geo = inferPlaceGeo(sourceStop, label, pedido[`${side}_provincia`], pedido[`${side}_pais`]);
  if (geo) return { lat: geo.lat, lng: geo.lng, label: label || geo.municipio || `${side} ${idx + 1}`, hasGeo:true, ...pointDetails };
  if (!query && !provincia) return null;
  const fallbackLabel = [label, provincia, pais].filter(Boolean).join(", ");
  return fallbackLabel ? { lat:null, lng:null, label:fallbackLabel, hasGeo:false, ...pointDetails } : null;
}

function getPedidoVehiclePosition(pedido = {}) {
  const candidates = [
    [pedido.gps_lat, pedido.gps_lng],
    [pedido.vehiculo_gps_lat, pedido.vehiculo_gps_lng],
    [pedido.ultima_latitud, pedido.ultima_longitud],
    [pedido.vehiculo_latitud, pedido.vehiculo_longitud],
  ];
  for (const [rawLat, rawLng] of candidates) {
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const text = String(pedido.ultima_posicion || pedido.ubicacion_actual || "");
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function getPedidoMapaPasos(pedido = {}, choferPasos = null) {
  return choferPasos?.data || choferPasos || pedido.chofer_pasos?.data || pedido.chofer_pasos || pedido.pasos_chofer || {};
}

function pedidoPointTone({ tipo, pedido = {}, pasos = {} }) {
  const estado = String(pedido?.estado || "").toLowerCase();
  const incidencia = estado === "incidencia" || pedido?.incidencia_activa || pedido?.incidencia_descripcion;
  if (incidencia) return { key:"incidencia", label:"Incidencia", color:"#ef4444", bg:"rgba(239,68,68,.16)", border:"rgba(239,68,68,.55)" };
  if (tipo === "carga") {
    if (pasos.carga_ok || ["en_curso","descarga","entregado","facturado"].includes(estado)) {
      return { key:"ok", label:"Carga OK", color:"#10b981", bg:"rgba(16,185,129,.17)", border:"rgba(16,185,129,.55)" };
    }
    if (pasos.carga_proceso || pasos.carga_iniciada) {
      return { key:"activo", label:"En carga", color:"#f59e0b", bg:"rgba(245,158,11,.18)", border:"rgba(245,158,11,.55)" };
    }
  }
  if (tipo === "descarga") {
    if (pasos.descarga_ok || ["entregado","facturado"].includes(estado)) {
      return { key:"ok", label:"Descarga OK", color:"#10b981", bg:"rgba(16,185,129,.17)", border:"rgba(16,185,129,.55)" };
    }
    if (pasos.descarga_iniciada || pasos.posicionado_descarga || estado === "descarga") {
      return { key:"activo", label:pasos.descarga_iniciada || estado === "descarga" ? "En descarga" : "Llegado a descarga", color:"#f97316", bg:"rgba(249,115,22,.18)", border:"rgba(249,115,22,.55)" };
    }
    if (pasos.viaje_iniciado || pasos.carga_ok || estado === "en_curso") {
      return { key:"proximo", label:"Destino pendiente", color:"#3b82f6", bg:"rgba(59,130,246,.16)", border:"rgba(59,130,246,.48)" };
    }
  }
  return { key:"pendiente", label:"Pendiente", color:"var(--text4)", bg:"var(--bg3)", border:"var(--border2)" };
}

function buildPedidoMapPoints(pedido = {}, choferPasos = null) {
  const cargaStops = parseStops(pedido.puntos_carga);
  const descargaStops = parseStops(pedido.puntos_descarga);
  const cargas = (cargaStops.length ? cargaStops : [{}]).map((stop, idx) => {
    const point = getPedidoMapPoint(pedido, "origen", stop, idx);
    return point ? { ...point, tipo:"carga", index:idx, title:`Carga ${idx + 1}` } : null;
  }).filter(Boolean);
  const descargas = (descargaStops.length ? descargaStops : [{}]).map((stop, idx) => {
    const point = getPedidoMapPoint(pedido, "destino", stop, idx);
    return point ? { ...point, tipo:"descarga", index:idx, title:`Descarga ${idx + 1}` } : null;
  }).filter(Boolean);
  const pasos = getPedidoMapaPasos(pedido, choferPasos);
  return [...cargas, ...descargas].map(point => ({
    ...point,
    tone: pedidoPointTone({ tipo:point.tipo, pedido, pasos }),
  }));
}

function PedidoMapaOperativo({ pedido, choferPasos }) {
  const mapPoints = buildPedidoMapPoints(pedido, choferPasos);
  if (!mapPoints.length) return null;
  const pasos = getPedidoMapaPasos(pedido, choferPasos);
  const estado = String(pedido?.estado || "pendiente").toLowerCase();
  const currentLabel = pasos.descarga_ok || ["entregado","facturado"].includes(estado)
    ? "Viaje entregado"
    : pasos.descarga_iniciada || estado === "descarga"
      ? "Descargando"
      : pasos.posicionado_descarga
        ? "En punto de descarga"
        : pasos.viaje_iniciado || pasos.carga_ok || estado === "en_curso"
          ? "En ruta"
          : pasos.carga_proceso || pasos.carga_iniciada
            ? "En carga"
          : LABEL_ESTADO[estado] || estado;
  return (
    <div style={{border:"1px solid var(--border)",borderRadius:10,padding:12,background:"var(--bg2)",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:9,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>Ruta operativa</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:2}}>Ruta, paradas y posicion conocida del vehiculo.</div>
        </div>
        <span style={{fontSize:10,fontWeight:900,border:"1px solid rgba(20,184,166,.30)",background:"rgba(20,184,166,.10)",color:"var(--accent-xl)",borderRadius:999,padding:"4px 8px"}}>
          {currentLabel}
        </span>
      </div>
      <RutaMapa points={mapPoints} vehiclePosition={getPedidoVehiclePosition(pedido)} />
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:8,marginTop:9}}>
        {mapPoints.map(point => (
          <div key={`card-${point.tipo}-${point.index}-${point.label}`} style={{border:`1px solid ${point.tone.border}`,borderRadius:8,padding:"8px 10px",background:point.tone.bg}}>
            <div style={{fontSize:10,color:point.tone.color,fontWeight:900,textTransform:"uppercase"}}>{point.title} - {point.tone.label}</div>
            <div style={{fontSize:12,color:"var(--text)",fontWeight:800,marginTop:2}}>{point.label || "-"}</div>
            {point.google_maps_url ? (
              <a href={point.google_maps_url} target="_blank" rel="noreferrer" style={{display:"inline-block",fontSize:10,color:"var(--accent)",fontWeight:900,marginTop:5}}>
                Abrir punto externo
              </a>
            ) : (
              <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,marginTop:3}}>Sin enlace Maps guardado</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PedidoModal({ editando, onClose, onSaved, onReload, onFacturaDesvinculada,
  pedidos, clientes: clientesProp, vehiculos, choferes, rutas: rutas_prop, colaboradores, canEdit,
  guidedActive = false, onGuidedProgress,
}) {
  const { user } = useAuth();
  const esGerente = String(user?.rol || "").toLowerCase() === "gerente";
  const asignacionRef = React.useRef(null);
  const [choferPasosMapa, setChoferPasosMapa] = useState(null);
  const [clientes, setClientes] = useState(clientesProp || []);
  const [rutas,    setRutas]    = useState(rutas_prop || []);

  useEffect(() => {
    let alive = true;
    const pedidoId = editando?.id;
    setChoferPasosMapa(null);
    if (!pedidoId) return () => { alive = false; };
    getPedidoChoferPasos(pedidoId)
      .then(data => { if (alive) setChoferPasosMapa(data || null); })
      .catch(() => { if (alive) setChoferPasosMapa(null); });
    return () => { alive = false; };
  }, [editando?.id]);

  // Sync clientes: use prop when available, fetch fresh if empty
  useEffect(() => {
    if (clientesProp && clientesProp.length > 0) {
      setClientes(clientesProp);
    } else {
      getClientes("", "true", 1, 500)
        .then(d => setClientes(Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : []))
        .catch(() => {});
    }
  }, [clientesProp]);

  // Sync rutas from prop
  useEffect(() => {
    if (rutas_prop && rutas_prop.length > 0) setRutas(rutas_prop);
  }, [rutas_prop]);

  // Colaboradores: local state with fallback fetch
  const [colaboradoresLocal, setColaboradoresLocal] = useState(colaboradores || []);
  useEffect(() => {
    if (colaboradores && colaboradores.length > 0) {
      setColaboradoresLocal(colaboradores);
    } else {
      getColaboradores()
        .then(d => setColaboradoresLocal(Array.isArray(d) ? d : []))
        .catch(() => {});
    }
  }, [colaboradores]);

  // Vehiculos: local state with fallback fetch (critical: modal opens before parent loads)
  const [vehiculosLocal, setVehiculosLocal] = useState(vehiculos || []);
  useEffect(() => {
    if (vehiculos && vehiculos.length > 0) {
      setVehiculosLocal(vehiculos);
    } else {
      getVehiculos()
        .then(d => setVehiculosLocal(Array.isArray(d) ? d : []))
        .catch(() => {});
    }
  }, [vehiculos]);

  // Choferes: local state with fallback fetch
  const [choferesLocal, setChoferesLocal] = useState(choferes || []);
  useEffect(() => {
    if (!editando?._focus_asignacion) return;
    const t = window.setTimeout(() => {
      asignacionRef.current?.scrollIntoView({ behavior:"smooth", block:"center" });
      asignacionRef.current?.querySelector("select")?.focus();
    }, 120);
    return () => window.clearTimeout(t);
  }, [editando?.id, editando?._focus_asignacion]);
  useEffect(() => {
    if (choferes && choferes.length > 0) {
      setChoferesLocal(choferes);
    } else {
      getChoferes()
        .then(d => setChoferesLocal(Array.isArray(d) ? d : []))
        .catch(() => {});
    }
  }, [choferes]);

  const [desvinculado, setDesvinculado] = useState(false);
  const [form,       setForm]       = useState(
    editando
      ? withPedidoGeoDefaults(normalizePedidoTarifaDraft({...editando, remolque_id_manual: editando.remolque_id||""}))
      : withPedidoGeoDefaults({ estado:"pendiente", tipo_precio:"viaje", fecha_pedido:new Date().toISOString().slice(0,10), importe_minimo:"", importe_paralizacion:"", paralizacion_horas:"", tipo_iva:21, iva_regimen:"general" })
  );
  const [mapPedidoDraft, setMapPedidoDraft] = useState(() => form);
  const [saving,     setSaving]     = useState(false);
  const [nombreBusqueda, setNombreBusqueda]= useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [modalNuevoCliente, setModalNuevoCliente] = useState(null);
  const [colaboradorBusqueda, setColaboradorBusqueda] = useState("");
  const [showColaboradorSuggestions, setShowColaboradorSuggestions] = useState(false);
  const [creandoColaborador, setCreandoColaborador] = useState(false);
  const [calcKm,     setCalcKm]     = useState(false);
  const [avisoVehiculo, setAvisoVehiculo] = useState(null); // {matricula, notas}
  const [showCostes, setShowCostes] = useState(!!(editando?.coste_gasoil || editando?.coste_peajes || editando?.coste_dietas || editando?.coste_otros));
  const [poiDraft, setPoiDraft] = useState(null);
  const [managePointsOpen, setManagePointsOpen] = useState(false);
  const [managePointsMode, setManagePointsMode] = useState("carga");
  const [notificandoColaborador, setNotificandoColaborador] = useState(false);
  const [previsualizandoColaborador, setPrevisualizandoColaborador] = useState(false);
  const [generandoAccesoTemporal, setGenerandoAccesoTemporal] = useState(false);
  const [accesoTemporalColaborador, setAccesoTemporalColaborador] = useState(null);
  const [clienteRiesgo, setClienteRiesgo] = useState(null);
  const [clienteRiesgoLoading, setClienteRiesgoLoading] = useState(false);
  const [puntosInteresModal, setPuntosInteresModal] = useState(getPuntosInteres);
  const [puntosCargaClienteModal, setPuntosCargaClienteModal] = useState([]);
  const [puntosCargaClienteLoading, setPuntosCargaClienteLoading] = useState(false);
  const [pendingDocs, setPendingDocs] = useState(() => Array.isArray(editando?._ai_docs) ? editando._ai_docs : []);
  const initialFormRef = React.useRef(JSON.stringify(form));
  const hydratedPedidoKeyRef = React.useRef(editando?.id || (editando ? "draft" : "new"));
  const rutasCreadasRef = React.useRef(new Set());
  const riesgoConfirmadoRef = React.useRef(new Map());
  const bloqueoClienteNoticeRef = React.useRef("");

  useEffect(() => {
    const editandoKey = editando?.id || (editando ? "draft" : "new");
    if (hydratedPedidoKeyRef.current === editandoKey) return;
    const nextForm = editando
      ? withPedidoGeoDefaults(normalizePedidoTarifaDraft({ ...editando, remolque_id_manual: editando.remolque_id || "" }))
      : withPedidoGeoDefaults({ estado:"pendiente", tipo_precio:"viaje", fecha_pedido:new Date().toISOString().slice(0,10), importe_minimo:"", importe_paralizacion:"", paralizacion_horas:"", tipo_iva:21, iva_regimen:"general", carga_lateral:true, carga_trasera:false, intercambio_palets:false, requiere_cinchas:true });
    hydratedPedidoKeyRef.current = editandoKey;
    setForm(nextForm);
    setColaboradorBusqueda("");
    setAccesoTemporalColaborador(null);
    setPendingDocs(Array.isArray(editando?._ai_docs) ? editando._ai_docs : []);
    setShowColaboradorSuggestions(false);
    setShowCostes(!!(nextForm.coste_gasoil || nextForm.coste_peajes || nextForm.coste_dietas || nextForm.coste_otros));
    initialFormRef.current = JSON.stringify(nextForm);
  }, [editando]);

  useEffect(() => {
    const timer = window.setTimeout(() => setMapPedidoDraft(form), 550);
    return () => window.clearTimeout(timer);
  }, [form]);

  useEffect(() => {
    if (!guidedActive || typeof onGuidedProgress !== "function") return;
    onGuidedProgress(form);
  }, [guidedActive, onGuidedProgress, form]);

  useEffect(() => {
    const refresh = () => setPuntosInteresModal(getPuntosInteres());
    let alive = true;
    syncPuntosInteresCache((next) => { if (alive) setPuntosInteresModal(next); });
    window.addEventListener("tms:puntos-interes", refresh);
    return () => {
      alive = false;
      window.removeEventListener("tms:puntos-interes", refresh);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!form.cliente_id) {
      setRutas([]);
      return undefined;
    }
    getRutasCliente(form.cliente_id, { silentError: true })
      .then(d => {
        if (!alive) return;
        const arr = Array.isArray(d) ? d : [];
        setRutas(arr.map(r => ({
          ...r,
          id: r.ruta_id || r.id,
          precio_base: r.precio_base ?? r.precio ?? 0,
          cliente_id: form.cliente_id,
        })));
      })
      .catch(() => {
        if (alive) setRutas([]);
      });
    return () => { alive = false; };
  }, [form.cliente_id]);

  useEffect(() => {
    let alive = true;
    if (!form.cliente_id) {
      setPuntosCargaClienteModal([]);
      setPuntosCargaClienteLoading(false);
      return undefined;
    }
    setPuntosCargaClienteLoading(true);
    getPuntosInteresApi({ cliente_id: form.cliente_id, tipo: "carga" })
      .then(d => {
        if (!alive) return;
        const lista = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
        const cargas = lista.filter(isCargaPoint);
        setPuntosCargaClienteModal(cargas);
        if (cargas.length === 1) {
          setForm(p => String(p.origen || "").trim() ? p : applyPuntoCargaToDraft(p, cargas[0]));
        }
      })
      .catch(() => {
        if (alive) setPuntosCargaClienteModal(getPuntosCargaCliente(form.cliente_id));
      })
      .finally(() => {
        if (alive) setPuntosCargaClienteLoading(false);
      });
    return () => { alive = false; };
  }, [form.cliente_id]);

  useEffect(() => {
    let alive = true;
    if (!form.cliente_id) {
      setClienteRiesgo(null);
      setClienteRiesgoLoading(false);
      return undefined;
    }
    setClienteRiesgoLoading(true);
    getClienteRiesgoOperativo(form.cliente_id, { silentError: true })
      .then(d => {
        if (alive) setClienteRiesgo(d || null);
      })
      .catch(() => {
        if (alive) setClienteRiesgo(null);
      })
      .finally(() => {
        if (alive) setClienteRiesgoLoading(false);
      });
    return () => { alive = false; };
  }, [form.cliente_id]);

  const normalizarTipoRuta = (value) => String(value || "cualquiera").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matchEndpointRuta = (actual, esperado) => {
    const a = normalizePlaceText(actual);
    const e = normalizePlaceText(esperado);
    if (!e) return true;
    if (!a) return false;
    if (a.includes(e) || e.includes(a)) return true;
    const stop = new Set(["de","del","la","el","los","las","s","sl","sa","sau","slu","calle","av","avenida","ctra","carretera"]);
    const aTokens = new Set(a.split(/\W+/).filter(t => t.length >= 3 && !stop.has(t)));
    const eTokens = e.split(/\W+/).filter(t => t.length >= 3 && !stop.has(t));
    if (!eTokens.length) return false;
    const hits = eTokens.filter(t => aTokens.has(t)).length;
    return hits >= Math.min(2, eTokens.length);
  };
  const tipoVehiculoDeTexto = (value) => {
    const txt = normalizarTipoRuta(value);
    if (!txt) return "cualquiera";
    if (txt.includes("banera") || txt.includes("bañera") || txt.includes("volquete")) return "banera";
    if (txt.includes("taut") || txt.includes("lona") || txt.includes("curtain")) return "tautliner";
    if (txt.includes("frigo")) return "frigorifico";
    if (txt.includes("cisterna")) return "cisterna";
    if (txt.includes("caja")) return "caja";
    if (txt.includes("adr")) return "adr";
    return txt || "cualquiera";
  };
  const vehiculoActual = vehiculosLocal.find(v => v.id === form.vehiculo_id);
  const remolqueActual = vehiculosLocal.find(v => v.id === (form.remolque_id_manual || vehiculoActual?.remolque_id));
  const tipoRemolqueActual = tipoVehiculoDeTexto([remolqueActual?.clase, remolqueActual?.tipo, remolqueActual?.marca, remolqueActual?.modelo, remolqueActual?.notas_operacion].filter(Boolean).join(" "));
  const rutaCompatibleConConjunto = (ruta) => {
    const requerido = tipoVehiculoDeTexto(ruta?.tipo_vehiculo);
    if (!requerido || requerido === "cualquiera") return true;
    if (!remolqueActual) return true;
    return requerido === tipoRemolqueActual;
  };
  const rutasCompatibles = rutas.filter(rutaCompatibleConConjunto);
  const rutaSeleccionada = rutas.find(r => r.id === form.ruta_id);
  const clienteRiesgoPedido = buildClienteRiesgoPedidoAvisos(clienteRiesgo, calcImporte(form));
  const clienteSeleccionadoModal = clientes.find(c => String(c.id || "") === String(form.cliente_id || "")) || null;
  const bloqueoClienteModal = clienteCreationBlock(clienteSeleccionadoModal, clienteRiesgoPedido, user);
  const cmrInternacionalModal = cmrTypeForPedidoStops(form) === "internacional";
  const rutaIncompatible = rutaSeleccionada && !rutaCompatibleConConjunto(rutaSeleccionada);
  const remolquesCompatiblesRuta = rutaSeleccionada
    ? vehiculosLocal.filter(v => {
        const clase = (v.clase||v.tipo||"").toLowerCase();
        const mat = (v.matricula||"").toUpperCase();
        const remolqueIds = new Set(vehiculosLocal.map(x=>x.remolque_id).filter(Boolean));
        const esRem = clase.includes("remolque") || clase.includes("semirremolque") || remolqueIds.has(v.id) || /^R[-_\s]/i.test(mat) || mat.endsWith("-R") || mat.endsWith("_R");
        if (!esRem) return false;
        const requerido = tipoVehiculoDeTexto(rutaSeleccionada.tipo_vehiculo);
        return requerido === "cualquiera" || tipoVehiculoDeTexto([v.clase,v.tipo,v.marca,v.modelo,v.notas_operacion].filter(Boolean).join(" ")) === requerido;
      })
    : [];
  const puntosCargaSugeridosModal = filterPuntosForPedido(puntosInteresModal, { clienteId: form.cliente_id || "", tipo: "carga" });
  const puntosDescargaSugeridosModal = filterPuntosForPedido(puntosInteresModal, { clienteId: form.cliente_id || "", tipo: "descarga" });
  const cargaEndpointListId = `pedido-origen-puntos-${editando?.id || "nuevo"}`;
  const descargaEndpointListId = `pedido-destino-puntos-${editando?.id || "nuevo"}`;

  useEffect(() => {
    if (editando?.id || !bloqueoClienteModal || !form.cliente_id) return;
    const key = `${form.cliente_id}:${bloqueoClienteModal.type}:${bloqueoClienteModal.message}`;
    if (bloqueoClienteNoticeRef.current === key) return;
    bloqueoClienteNoticeRef.current = key;
    notify(bloqueoClienteModal.message, "error");
  }, [bloqueoClienteModal, editando?.id, form.cliente_id]);

// ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Calcular km por carretera via OpenRouteService (gratuito) ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
function routePointCoords(place = {}) {
  const raw = typeof place === "object" && place !== null ? place : { name: String(place || ""), address: String(place || "") };
  const lat = Number(raw.lat ?? raw.latitud);
  const lng = Number(raw.lng ?? raw.longitud);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  const inferred = inferPlaceGeo(raw, raw.address, raw.direccion, raw.name, raw.nombre, raw.cliente_nombre);
  if (inferred?.lat != null && inferred?.lng != null) return { lat:Number(inferred.lat), lng:Number(inferred.lng) };
  return null;
}

function haversineKm(a, b) {
  const toRad = deg => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

function fallbackRouteKm(lugares = []) {
  const coords = lugares.map(routePointCoords);
  if (coords.length < 2 || coords.some(p => !p)) return null;
  const directKm = coords.slice(1).reduce((sum, point, idx) => sum + haversineKm(coords[idx], point), 0);
  const roadApprox = directKm * 1.22;
  return Number.isFinite(roadApprox) && roadApprox > 0 ? Math.round(roadApprox) : null;
}

async function calcularKmRuta(origen, destino, puntos = null) {
  const lugares = Array.isArray(puntos) && puntos.length ? puntos : [origen, destino].filter(Boolean);
  if (lugares.length < 2) return null;
  setCalcKm(true);
  try {
    const stops = lugares.map((place, idx) => {
      const raw = typeof place === "object" && place !== null ? place : { name: String(place || "").trim(), address: String(place || "").trim() };
      const hasCoords = Number.isFinite(Number(raw.lat ?? raw.latitud)) && Number.isFinite(Number(raw.lng ?? raw.longitud));
      const rawAddress = raw.address || raw.direccion || raw.name || raw.nombre || "";
      const address = hasCoords ? String(rawAddress || "").trim() : resolvePuntoInteresQuery(rawAddress);
      return {
        type: raw.type || raw.tipo || (idx === 0 ? "Carga" : idx === lugares.length - 1 ? "Descarga" : "Parada"),
        name: raw.name || raw.nombre || raw.cliente_nombre || address,
        address,
        google_maps_url: raw.google_maps_url || raw.googleMapsUrl || raw.maps_url || "",
        lat: raw.lat ?? raw.latitud ?? null,
        lng: raw.lng ?? raw.longitud ?? null,
      };
    }).filter(hasRoutePlaceData);
    const data = await optimizarRuta({ preference: "rapida", stops });
    const km = Number(data?.distance_km || 0);
    if (data?.warning && km) notify(data.warning, "warning");
    if (!km) throw new Error("No se pudo calcular distancia con las direcciones indicadas.");
    return Math.round(km);
  } catch(e) {
    const fallbackKm = fallbackRouteKm(lugares);
    if (fallbackKm) {
      notify("No se pudo calcular la ruta exacta. Se ha aplicado una distancia orientativa por coordenadas conocidas.", "warning");
      return fallbackKm;
    }
    notify("No se pudieron calcular los km automaticamente. Revisa los enlaces/coordenadas o introduce los km manualmente.", "warning");
    return null;
  } finally {
    setCalcKm(false);
  }
}

function GestionPuntosInteresModal({ onClose, onApply, onSelectPoint, clienteId = "", modo = "carga" }) {
  const [puntos, setPuntos] = useState(getPuntosInteres);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pointSearch, setPointSearch] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    syncPuntosInteresCache((next) => setPuntos(next))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function removePoint(point) {
    const ok = await confirmDialog({
      title: "Eliminar punto guardado",
      message: `Eliminar el punto "${point.nombre}"?`,
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      if (point.id && !String(point.id).startsWith("poi_")) await borrarPuntoInteres(point.id);
    } catch (e) {
      notify(e.message || "No se pudo eliminar en servidor.", "warning");
    }
    const next = setPuntosInteresCache(getPuntosInteres().filter(p => String(p.id) !== String(point.id)));
    setPuntos(next);
    onApply?.(next);
  }

  function buildClientPointPayload(point, targetClienteId, clone = false) {
    return {
      ...(clone ? {} : { id: point.id }),
      nombre: point.nombre || point.direccion || "",
      cif: point.cif || "",
      direccion: point.direccion || point.nombre || "",
      codigo_postal: point.codigo_postal || "",
      ciudad: point.ciudad || "",
      provincia: point.provincia || "",
      pais: point.pais || "EspaÃ±a",
      lat: point.lat ?? point.latitud ?? null,
      lng: point.lng ?? point.longitud ?? null,
      tipo: point.tipo || modo || "ambos",
      ventana: point.ventana || "",
      contacto_nombre: point.contacto_nombre || "",
      contacto_telefono: point.contacto_telefono || point.telefono || "",
      email: point.email || "",
      notas: point.notas || "",
      google_maps_url: point.google_maps_url || point.metadata?.google_maps_url || "",
      cliente_id: targetClienteId,
      punto_general: false,
      es_general: false,
    };
  }

  async function ensurePointForClient(point) {
    const targetClienteId = String(clienteId || "").trim();
    if (!targetClienteId) {
      notify("Selecciona primero un cliente para poder asociar el punto.", "warning");
      return null;
    }
    if (String(point.cliente_id || "") === targetClienteId) return { point, changed: false };

    const belongsToOtherClient = !!point.cliente_id && String(point.cliente_id) !== targetClienteId;
    const isGeneralPoint = point.punto_general || point.es_general || !point.cliente_id;
    const clone = belongsToOtherClient || isGeneralPoint;
    const payload = buildClientPointPayload(point, targetClienteId, clone);
    if (!payload.nombre || !payload.direccion) {
      notify("El punto necesita nombre y direccion antes de poder seleccionarse.", "warning");
      return null;
    }

    let saved = null;
    try {
      if (!clone && point.id && !String(point.id).startsWith("poi_")) {
        saved = await editarPuntoInteres(point.id, payload);
      } else {
        saved = await crearPuntoInteres(payload);
      }
    } catch (e) {
      saved = {
        ...point,
        ...payload,
        id: clone ? `poi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` : (point.id || `poi_${Date.now()}`),
        synced: false,
      };
      notify(e.message || "No se pudo guardar el punto en servidor; se aplicara en local.", "warning");
    }

    const base = normalizePuntoInteresForForm(saved || payload);
    const normalized = {
      ...base,
      id: base.id || `poi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      nombre: (base.nombre || base.direccion || "").trim(),
      direccion: (base.direccion || base.nombre || "").trim(),
      cliente_id: targetClienteId,
      punto_general: false,
      es_general: false,
    };
    const current = getPuntosInteres();
    const next = setPuntosInteresCache([
      ...current.filter(p => String(p.id) !== String(normalized.id)),
      normalized,
    ].slice(-250));
    setPuntos(next);
    onApply?.(next);
    return { point: normalized, changed: true, cloned: clone };
  }

  async function selectPoint(point) {
    const result = await ensurePointForClient(point);
    if (!result?.point) return;
    onSelectPoint?.(result.point);
    if (result.changed) {
      notify(result.cloned ? "Punto copiado al cliente y seleccionado." : "Punto asociado al cliente y seleccionado.", "success");
    } else {
      notify("Punto seleccionado.", "success");
    }
  }

  const qPoint = normalizePlaceText(pointSearch);
  const puntosFiltrados = qPoint
    ? puntos.filter(point => [
        point.nombre,
        point.direccion,
        point.ciudad,
        point.provincia,
        point.pais,
        point.cif,
      ].some(value => normalizePlaceText(value).includes(qPoint)))
    : puntos;
  const crearDesdeBusqueda = () => {
    const text = pointSearch.trim();
    setEditing({ nombre:text, direccion:text, tipo:"ambos", pais:"EspaÃ±a" });
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.78)",zIndex:540,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,width:"min(880px,96vw)",maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"18px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:900,color:"var(--text)"}}>Puntos guardados</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:4}}>Catalogo independiente de clientes para origenes, destinos y paradas habituales.</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button type="button" onClick={()=>setEditing({ tipo:"ambos", pais:"España" })} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>Nuevo punto</button>
            <button type="button" onClick={onClose} style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid var(--border2)"}}>Cerrar</button>
          </div>
        </div>
        <div style={{padding:20,overflowY:"auto"}}>
          <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
            <input
              value={pointSearch}
              onChange={e=>setPointSearch(e.target.value)}
              placeholder="Buscar punto por nombre, direccion, poblacion, provincia..."
              style={{...S.input,flex:"1 1 320px"}}
            />
            <button
              type="button"
              onClick={crearDesdeBusqueda}
              disabled={!pointSearch.trim()}
              style={{...S.btn,background:pointSearch.trim()?"rgba(20,184,166,.12)":"var(--bg4)",color:pointSearch.trim()?"var(--accent)":"var(--text5)",border:"1px solid var(--border2)",cursor:pointSearch.trim()?"pointer":"not-allowed"}}
            >
              Crear desde busqueda
            </button>
          </div>
          {loading ? (
            <div style={{fontSize:12,color:"var(--text5)"}}>Cargando puntos guardados...</div>
          ) : !puntosFiltrados.length ? (
            <div style={{fontSize:12,color:"var(--text5)"}}>
              {pointSearch.trim() ? "No hay puntos con esa busqueda. Puedes crearlo con el boton superior." : "Todavia no hay puntos guardados."}
            </div>
          ) : (
            <div style={{display:"grid",gap:10}}>
              {puntosFiltrados.map(point => (
                <div key={point.id} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"start"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{point.nombre}</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>{point.direccion}</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                      {point.tipo && <span style={{fontSize:10,padding:"2px 8px",borderRadius:999,background:"rgba(59,130,246,.12)",color:"#60a5fa",border:"1px solid rgba(59,130,246,.22)"}}>{point.tipo}</span>}
                      {(point.pais || point.provincia) && <span style={{fontSize:10,padding:"2px 8px",borderRadius:999,background:"rgba(20,184,166,.12)",color:"var(--accent)",border:"1px solid rgba(20,184,166,.22)"}}>{[point.provincia, point.pais].filter(Boolean).join(", ")}</span>}
                      {point.ventana && <span style={{fontSize:10,padding:"2px 8px",borderRadius:999,background:"rgba(16,185,129,.12)",color:"#10b981",border:"1px solid rgba(16,185,129,.22)"}}>{point.ventana}</span>}
                      {point.google_maps_url && <a href={point.google_maps_url} target="_blank" rel="noreferrer" style={{fontSize:10,color:"var(--accent)"}}>Google Maps</a>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    {onSelectPoint && (
                      <button type="button" onClick={()=>selectPoint(point)} style={{...S.btn,background:"rgba(20,184,166,.12)",color:"var(--accent)",border:"1px solid rgba(20,184,166,.28)",padding:"6px 10px"}}>Seleccionar</button>
                    )}
                    <button type="button" onClick={()=>setEditing(point)} style={{...S.btn,background:"transparent",color:"var(--accent)",border:"1px solid var(--border2)",padding:"6px 10px"}}>Editar</button>
                    <button type="button" onClick={()=>removePoint(point)} style={{...S.btn,background:"rgba(239,68,68,.08)",color:"#ef4444",border:"1px solid rgba(239,68,68,.2)",padding:"6px 10px"}}>Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {editing && (
        <PuntoInteresModal
          initial={editing}
          onClose={()=>setEditing(null)}
          onSave={(next)=>{ setPuntos(next); onApply?.(next); setEditing(null); }}
        />
      )}
    </div>
  );
}

// Calcular km en vacio: desde ultimo destino del vehiculo hasta nuevo origen ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬
async function calcularKmVacio(vehiculoId, nuevoOrigen) {
  if (!vehiculoId || !nuevoOrigen?.trim()) return null;
  // Buscar ultimo pedido entregado de este vehiculo
  const ultimos = (pedidos||[])
    .filter(p => p.vehiculo_id === vehiculoId && 
                 (p.estado === "entregado" || p.estado === "facturado") &&
                 p.destino)
    .sort((a,b) => new Date(b.fecha_descarga || b.fecha_entrega || b.fecha_carga || 0) - new Date(a.fecha_descarga || a.fecha_entrega || a.fecha_carga || 0));
  const ultimoDestino = ultimos[0]?.destino;
  if (!ultimoDestino) return null;
  const km = await calcularKmRuta(ultimoDestino, nuevoOrigen);
  return { km, desde: ultimoDestino };
}

async function maybeCrearRutaClienteDesdePedido() {
  if (!form.origen || !form.destino || !form.cliente_id) return;
  if (form.ruta_id) return form.ruta_id;
  const origenN  = form.origen.trim().toLowerCase();
  const destinoN = form.destino.trim().toLowerCase();
  const tipoRutaActual = tipoVehiculoDeTexto([remolqueActual?.clase, remolqueActual?.tipo, remolqueActual?.marca, remolqueActual?.modelo, remolqueActual?.notas_operacion].filter(Boolean).join(" "));
  const routeKey = `${form.cliente_id}|${origenN}|${destinoN}|${tipoRutaActual || "cualquiera"}`;
  if (rutasCreadasRef.current.has(routeKey)) return;
  let rutasClienteActualizadas = rutas;
  try {
    const fresh = await getRutasCliente(form.cliente_id, { silentError: true });
    if (Array.isArray(fresh)) {
      rutasClienteActualizadas = fresh.map(r => ({
        ...r,
        id: r.ruta_id || r.id,
        precio_base: r.precio_base ?? r.precio ?? 0,
        cliente_id: form.cliente_id,
      }));
      setRutas(rutasClienteActualizadas);
    }
  } catch (e) {
    console.warn("No se pudieron refrescar las rutas del cliente antes de guardar:", e.message);
  }
  const rutaExistente = rutasClienteActualizadas.find(r =>
    matchEndpointRuta(form.origen, r.origen) &&
    matchEndpointRuta(form.destino, r.destino) &&
    (!r.cliente_id || r.cliente_id === form.cliente_id) &&
    (!r.tipo_vehiculo || r.tipo_vehiculo === "cualquiera" || tipoVehiculoDeTexto(r.tipo_vehiculo) === (tipoRutaActual || "cualquiera"))
  );
  if (rutaExistente) {
    if (!routeTarifaMatchesDraft(rutaExistente, form)) {
      rutasCreadasRef.current.add(routeKey);
      notify("Existe una ruta con ese origen/destino, pero tiene otra tarifa. No se ha vinculado automaticamente.", "info");
      return null;
    }
    if (!form.ruta_id && rutaExistente.id) setForm(p => ({...p, ruta_id: rutaExistente.id}));
    rutasCreadasRef.current.add(routeKey);
    return rutaExistente.id || null;
  }
  const addRoute = await confirmDialog({
    title: "Guardar ruta del cliente",
    message: `La ruta "${form.origen} -> ${form.destino}" no existe todavia.\n\nQuieres guardarla como ruta de este cliente para reutilizarla en futuros viajes?`,
    confirmText: "Guardar ruta",
    cancelText: "No guardar",
  });
  if (!addRoute) {
    rutasCreadasRef.current.add(routeKey);
    return null;
  }
  const origenRuta = form.origen.trim().toUpperCase();
  const destinoRuta = form.destino.trim().toUpperCase();
  const nueva = await crearRutaCliente(form.cliente_id, {
    origen: origenRuta,
    destino: destinoRuta,
    km: toNullableNumber(form.km_ruta),
    precio_base: toFiniteNumber(form.precio_unitario, calcImporte(form)),
    tarifa_tipo: form.tipo_precio || "viaje",
    tipo_vehiculo: tipoRutaActual || "cualquiera",
    minimo_facturable: form.tipo_precio === "viaje" ? toNullableNumber(form.importe_minimo) : null,
    minimo_unidades: form.tipo_precio !== "viaje" ? toNullableNumber(form.minimo_unidades) : null,
    notas: "Creada automaticamente desde pedido",
  }, { silentError: true });
  setRutas(prev => prev.some(r => r.id === nueva.ruta_id || (
    matchEndpointRuta(origenRuta, r.origen) &&
    matchEndpointRuta(destinoRuta, r.destino) &&
    (!r.cliente_id || r.cliente_id === form.cliente_id)
  )) ? prev : [...prev, {
    id: nueva.ruta_id,
    origen: origenRuta,
    destino: destinoRuta,
    km: toNullableNumber(form.km_ruta),
    precio_base: toFiniteNumber(form.precio_unitario, calcImporte(form)),
    tarifa_tipo: form.tipo_precio || "viaje",
    tipo_vehiculo: tipoRutaActual || "cualquiera",
    minimo_facturable: form.tipo_precio === "viaje" ? toNullableNumber(form.importe_minimo) : null,
    minimo_unidades: form.tipo_precio !== "viaje" ? toNullableNumber(form.minimo_unidades) : null,
    cliente_id: form.cliente_id,
  }]);
  rutasCreadasRef.current.add(routeKey);
  setForm(p => ({...p, ruta_id: nueva.ruta_id}));
  return nueva.ruta_id;
}

function pedidoTieneContenidoReal(draft = {}) {
  const camposTexto = [
    "cliente_id", "cliente_nombre", "origen", "destino", "vehiculo_id", "chofer_id", "chofer2_id",
    "remolque_id_manual", "matricula_colaborador", "colaborador_id", "ruta_id", "referencia_cliente",
    "notas", "observaciones", "km_ruta", "km_vacio", "precio_unitario", "importe_minimo",
    "precio_colaborador", "precio_colaborador_unitario", "extracostes", "bultos", "peso_kg",
  ];
  if (camposTexto.some(key => String(draft[key] ?? "").trim())) return true;
  const hasStops = value => parseStops(value).some(stop => stopAddress(stop) || stop?.cliente_nombre || stop?.google_maps_url);
  if (hasStops(draft.puntos_carga) || hasStops(draft.puntos_descarga)) return true;
  if (Array.isArray(pendingDocs) && pendingDocs.length) return true;
  return false;
}

async function requestClose() {
  if (saving) return;
  if (editando?._readonly && !desvinculado) { onClose(); return; }
  const changed = JSON.stringify(form) !== initialFormRef.current;
  if (!editando && !pedidoTieneContenidoReal(form)) { onClose(); return; }
  if (editando && !changed) { onClose(); return; }
  const guardarAntes = await confirmDialog({
    title: "Cambios sin guardar",
    message: "Hay cambios sin guardar o el pedido todavia no se ha creado.\n\nQuieres guardar antes de salir?",
    confirmText: "Guardar y salir",
    cancelText: "No guardar",
    tone: "warning",
  });
  if (guardarAntes) {
    await guardar();
    return;
  }
  const salirSinGuardar = await confirmDialog({
    title: "Salir sin guardar",
    message: "Salir sin guardar el pedido?",
    confirmText: "Salir sin guardar",
    cancelText: "Volver",
    tone: "danger",
  });
  if (salirSinGuardar) onClose();
}

async function notificarColaborador(force = false) {
  if (!editando?.id) {
    notify("Guarda el pedido antes de enviar el enlace al colaborador.", "warning");
    return;
  }
  setNotificandoColaborador(true);
  try {
    const resp = await enviarWorkflowColaborador(editando.id, force);
    notify(resp?.already ? "El colaborador ya tenia el flujo enviado." : "Email enviado al colaborador.", resp?.already ? "info" : "success");
  } catch (e) {
    notify(e.message || "No se pudo enviar el email al colaborador.", "error");
  } finally {
    setNotificandoColaborador(false);
  }
}

async function previsualizarColaborador() {
  if (!editando?.id) {
    notify("Guarda el pedido antes de previsualizar el enlace del colaborador.", "warning");
    return;
  }
  setPrevisualizandoColaborador(true);
  try {
    const data = await getWorkflowColaboradorPreview(editando.id);
    if (!data?.html) throw new Error("El servidor no ha devuelto la previsualizacion.");
    const w = window.open("", "_blank", "width=820,height=980");
    if (!w) {
      notify("El navegador ha bloqueado la ventana de previsualizacion.", "warning");
      return;
    }
    w.document.write(data.html);
    w.document.close();
  } catch (e) {
    notify(e.message || "No se pudo previsualizar el enlace del colaborador.", "error");
  } finally {
    setPrevisualizandoColaborador(false);
  }
}

async function generarAccesoTemporalColaborador() {
  if (!editando?.id || !form.colaborador_id) {
    notify("Guarda el pedido y asigna un colaborador antes de generar el acceso temporal.", "warning");
    return;
  }
  setGenerandoAccesoTemporal(true);
  try {
    const data = await crearColaboradorLiquidacionToken(form.colaborador_id, {
      pedido_id: editando.id,
      dias: 7,
    });
    setAccesoTemporalColaborador(data);
    notify("Acceso temporal de conductor generado para este viaje.", "success");
  } catch (e) {
    notify(e.message || "No se pudo generar el acceso temporal.", "error");
  } finally {
    setGenerandoAccesoTemporal(false);
  }
}

async function copiarAccesoTemporalColaborador() {
  const url = accesoTemporalColaborador?.operativa_url || "";
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    notify("Enlace temporal copiado.", "success");
  } catch {
    notify("No se pudo copiar automaticamente. Selecciona el enlace y copialo.", "warning");
  }
}

async function guardar() {
  if (!form.cliente_id) { notify("Selecciona un cliente", "warning"); return; }
  if (!form.fecha_carga) { notify("La fecha de carga es obligatoria.", "warning"); return; }
  try {
    assertValidPedidoDates({
      fecha_pedido: form.fecha_pedido,
      fecha_carga: form.fecha_carga,
      fecha_descarga: form.fecha_descarga,
      fecha_entrega: form.fecha_entrega,
      firma_fecha: form.firma_fecha,
    });
  } catch (dateErr) {
    notify(dateErr.message, "warning");
    return;
  }
  if (descargaAntesQueCarga(form.fecha_carga, form.fecha_descarga || form.fecha_entrega)) {
    notify("La fecha de descarga no puede ser anterior a la fecha de carga.", "warning");
    return;
  }
  if (!editando?.id && bloqueoClienteModal) {
    notify(bloqueoClienteModal.message, "error");
    return;
  }
  if (rutaIncompatible) {
    notify("La ruta seleccionada no es compatible con el remolque actual. Cambia el remolque antes de guardar.", "warning");
    return;
  }
  if (editando?.id && String(editando?.estado || "").toLowerCase() === "entregado" && String(form.estado || "").toLowerCase() !== "entregado" && !esGerente) {
    notify("Solo gerencia puede cambiar el estado de un pedido marcado como entregado.", "warning");
    return;
  }
  if (clienteRiesgoPedido?.requiere_confirmacion && !isRiskConfirmationFresh(riesgoConfirmadoRef, form.cliente_id, clienteRiesgoPedido)) {
    const money = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const detalleRiesgo = [
      `Pendiente actual: ${money(clienteRiesgo?.total_pendiente)} EUR`,
      clienteRiesgo?.facturas_pendientes ? `Facturas pendientes: ${clienteRiesgo.facturas_pendientes}` : null,
      clienteRiesgo?.facturas_vencidas ? `Facturas vencidas: ${clienteRiesgo.facturas_vencidas}` : null,
      `Riesgo actual: ${formatRiskPct(clienteRiesgoPedido.riesgo_pct_actual)}`,
      clienteRiesgo?.limite_riesgo > 0 ? `Limite riesgo: ${money(clienteRiesgo.limite_riesgo)} EUR` : "Sin limite de riesgo configurado",
      `Con este pedido: ${formatRiskPct(clienteRiesgoPedido.riesgo_pct_proyectado)} (${money(clienteRiesgoPedido.total_proyectado)} EUR expuestos)`,
      "",
      ...clienteRiesgoPedido.avisos.map(a => `- ${a.mensaje}`),
      "",
      "Confirma si quieres guardar igualmente el pedido.",
    ].filter(Boolean).join("\n");
    const ok = await confirmDialog({
      title: clienteRiesgoPedido.nivel === "critico" ? "Cliente en riesgo critico" : "Cliente con cobros/riesgo pendiente",
      message: detalleRiesgo,
      confirmText: "Guardar pedido",
      cancelText: "Revisar",
      tone: clienteRiesgoPedido.nivel === "critico" || clienteRiesgoPedido.nivel === "alto" ? "warning" : "success",
    });
    if (!ok) return;
    markRiskConfirmed(riesgoConfirmadoRef, form.cliente_id, clienteRiesgoPedido);
  }
  setSaving(true);
  try {
    const payload = buildPedidoUpdatePayload(form);

    if (form.vehiculo_id) {
      const veh = vehiculosLocal.find(v => v.id === form.vehiculo_id);
      if (veh) {
        const choferChanged = form.chofer_id && form.chofer_id !== veh.chofer_id;
        if (choferChanged) {
          import("../services/api")
            .then(({ editarVehiculo: evFn }) => evFn(form.vehiculo_id, { ...veh, chofer_id: form.chofer_id }))
            .catch(e => console.warn("No se pudo actualizar chofer del conjunto:", e.message));
        }
      }
    }

    let pedidoGuardado;
    try {
      pedidoGuardado = editando?.id
        ? await editarPedido(editando.id, payload)
        : await crearPedido(payload);
    } catch (err) {
      if (!isFestivoConfirmError(err) || !(await confirmFestivoDestino(err))) throw err;
      const payloadConfirmado = { ...payload, festivo_confirmado: true };
      pedidoGuardado = editando?.id
        ? await editarPedido(editando.id, payloadConfirmado)
        : await crearPedido(payloadConfirmado);
      notify("Pedido guardado con aviso de festivo aceptado. Gerencia queda notificada.", "success");
    }

    const pedidoId = pedidoGuardado?.id || editando?.id;
    const esNuevoPedido = !editando?.id;
    if (esNuevoPedido && pedidoId) {
      const docsPendientes = [...pendingDocs];
      const colaboradorId = payload.colaborador_id;
      const precioColaborador = Number(payload.precio_colaborador || 0);
      if (docsPendientes.length) {
        Promise.allSettled(docsPendientes.map(doc => subirPedidoDoc(pedidoId, doc)))
          .then(results => {
            const ok = results.filter(r => r.status === "fulfilled").length;
            const ko = results.length - ok;
            if (ok) notify(`${ok} documento(s) adjuntados al pedido.`, "success");
            if (ko) notify(`${ko} documento(s) no se pudieron adjuntar. Abre el pedido y vuelve a subirlos.`, "warning");
          });
        setPendingDocs([]);
      }
      if (colaboradorId && precioColaborador) {
        enviarWorkflowColaborador(pedidoId, false).catch(e => console.warn("No se pudo iniciar flujo de colaborador:", e.message));
      }
      notify("Pedido creado correctamente.", "success");
      onSaved();
      return;
    }

    let rutaAutoId = null;
    try {
      rutaAutoId = await maybeCrearRutaClienteDesdePedido();
    } catch (e) {
      console.warn("No se pudo crear la ruta:", e.message);
      notify("El pedido se ha guardado, pero la ruta no pudo anadirse al cliente. Puedes crearla despues desde su ficha.", "warning");
    }

    if (pedidoId && rutaAutoId && !payload.ruta_id) {
      try {
        await editarPedido(pedidoId, buildPedidoUpdatePayload(form, { ruta_id: rutaAutoId }));
      } catch (e) {
        console.warn("No se pudo vincular la ruta al pedido:", e.message);
      }
    }

    if (pedidoId && pendingDocs.length) {
      for (const doc of pendingDocs) {
        await subirPedidoDoc(pedidoId, doc);
      }
      notify(`${pendingDocs.length} documento(s) adjuntados al pedido.`, "success");
      setPendingDocs([]);
    }

    if (pedidoId && payload.colaborador_id && Number(payload.precio_colaborador || 0)) {
      enviarWorkflowColaborador(pedidoId, false).catch(e => console.warn("No se pudo iniciar flujo de colaborador:", e.message));
    }

    onSaved();
  } catch (e) {
    notify(e.message, "error");
  } finally {
    setSaving(false);
  }
}

const aplicarEndpointText = (key, tipo) => (e) => {
  const value = (key === "origen" || key === "destino") ? e.target.value.toUpperCase() : e.target.value;
  setForm(p => {
    const base = { ...p, [key]: value };
    if (!["origen", "destino"].includes(key)) return base;
    const punto = findPuntoInteresForTypedEndpoint(
      value,
      p.cliente_id || "",
      tipo,
      tipo === "carga" ? puntosCargaSugeridosModal : puntosDescargaSugeridosModal
    );
    if (!punto) {
      const stopsKey = tipo === "carga" ? "puntos_carga" : "puntos_descarga";
      const regionKey = tipo === "carga" ? "origen_provincia" : "destino_provincia";
      const countryKey = tipo === "carga" ? "origen_pais" : "destino_pais";
      const { extras } = splitPrimaryAndAdditionalStops(p[stopsKey], p[key] || "");
      base[regionKey] = "";
      ["lat", "lng", "lon", "latitude", "longitude", "google_maps_url"].forEach(suffix => {
        const staleKey = `${key}_${suffix}`;
        if (Object.prototype.hasOwnProperty.call(p, staleKey)) base[staleKey] = null;
      });
      base[stopsKey] = value.trim() ? [{
        direccion: value,
        es_principal: true,
        pais: p[countryKey] || "España",
        provincia: "",
        ciudad: "",
        codigo_postal: "",
        cliente_nombre: "",
        punto_interes_id: null,
        google_maps_url: "",
        lat: null,
        lng: null,
      }, ...extras] : extras;
      return base;
    }
    return tipo === "carga" ? applyPuntoCargaToDraft(base, punto) : applyPuntoDescargaToDraft(base, punto);
  });
};

function isSimpleMunicipalityInput(value = "") {
  const text = String(value || "").trim();
  if (!text || /\d|[,;]/.test(text)) return false;
  return !/\b(?:autovia|autopista|avenida|calle|camino|carretera|ctra|km|paseo|plaza|poligono|ronda|ruta|via)\b/i.test(text);
}

async function resolverEndpointEnFormulario(key, tipo, rawValue = null) {
  const value = String(rawValue != null ? rawValue : (form[key] || "")).trim();
  if (value.length < 2) return;
  const suggestions = tipo === "carga" ? puntosCargaSugeridosModal : puntosDescargaSugeridosModal;
  if (findPuntoInteresForTypedEndpoint(value, form.cliente_id || "", tipo, suggestions)) return;
  const regionKey = tipo === "carga" ? "origen_provincia" : "destino_provincia";
  const countryKey = tipo === "carga" ? "origen_pais" : "destino_pais";
  const stopsKey = tipo === "carga" ? "puntos_carga" : "puntos_descarga";
  try {
    const geo = await resolveGeoPlace({
      q: value,
      country: form[countryKey] || "España",
      region: form[regionKey] || "",
    });
    if (!Number.isFinite(Number(geo?.lat)) || !Number.isFinite(Number(geo?.lng))) return;
    setForm(current => {
      if (normalizePlaceText(current[key]) !== normalizePlaceText(value)) return current;
      const { primary, extras } = splitPrimaryAndAdditionalStops(current[stopsKey], current[key] || "");
      const pais = canonicalCountry(geo.pais || current[countryKey] || "España") || geo.pais || current[countryKey] || "España";
      const canonicalEndpoint = isSimpleMunicipalityInput(value) && geo.municipio
        ? String(geo.municipio).toUpperCase()
        : value;
      return {
        ...current,
        [key]: canonicalEndpoint,
        [regionKey]: geo.provincia || current[regionKey] || "",
        [countryKey]: pais,
        [stopsKey]: [{
          ...(primary || {}),
          direccion: canonicalEndpoint,
          es_principal: true,
          ciudad: geo.municipio || primary?.ciudad || "",
          provincia: geo.provincia || primary?.provincia || "",
          pais,
          lat: Number(geo.lat),
          lng: Number(geo.lng),
        }, ...extras],
      };
    });
  } catch {
    // El mapa muestra el aviso contextual y el usuario puede corregir el texto.
  }
}

const f = k => e => setForm(p => ({...p,[k]: (k==="origen"||k==="destino") ? e.target.value.toUpperCase() : e.target.value}));

async function seleccionarDocsPendientes(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const next = [];
  for (const file of files) {
    if (file.size > 3145728) {
      notify(`${file.name}: maximo 3MB por documento`, "warning");
      continue;
    }
    try {
      next.push({
        nombre: file.name,
        tipo: inferPedidoDocTipo(file.name),
        file_base64: await fileToPedidoDocBase64(file),
        file_mime: file.type || "application/pdf",
        file_size_kb: Math.round(file.size / 1024),
      });
    } catch (err) {
      notify(`No se pudo leer ${file.name}: ${err.message}`, "error");
    }
  }
  if (next.length) setPendingDocs(prev => [...prev, ...next]);
  e.target.value = "";
}

function aplicarColaborador(col) {
  const impActual = importeClienteColCalculado(form) || Number(form.precio_unitario || 0);
  setForm(p => ({
    ...p,
    colaborador_id: col?.id || "",
    colaborador_nombre: col?.nombre || "",
    precio_cliente_col: col?.id ? (impActual || p.precio_cliente_col || "") : "",
    coste_gasoil: col?.id ? 0 : p.coste_gasoil,
  }));
  setColaboradorBusqueda("");
  setShowColaboradorSuggestions(false);
}

async function crearColaboradorDesdePedido(nombre) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) return;
  setCreandoColaborador(true);
  try {
    const nuevo = await crearColaborador({
      tipo: "empresa",
      nombre: nombreLimpio,
      notas: "Creado desde pedidos. Pendiente de completar datos fiscales, contacto, pago y documentacion.",
      pendiente_revision: true,
      origen_creacion: "pedidos",
    });
    setColaboradoresLocal(prev => [nuevo, ...prev.filter(c => c.id !== nuevo.id)]);
    aplicarColaborador(nuevo);
    notify("Colaborador creado y asignado al pedido.", "success");
  } catch (e) {
    notify(e.message || "No se pudo crear el colaborador.", "error");
  } finally {
    setCreandoColaborador(false);
  }
}

const syncCantidadSiVacia = (draft, force = false) => {
  const tipo = draft.tipo_precio || "viaje";
  if (tipo === "viaje") {
    if (force && (draft.cantidad === null || draft.cantidad === undefined || draft.cantidad === "")) draft.cantidad = "";
    return draft;
  }
  if (force || draft.cantidad === null || draft.cantidad === undefined || draft.cantidad === "") {
    draft.cantidad = cantidadSugeridaPorTipo(draft, tipo);
  }
  return draft;
};

const aplicarTarifaRutaADraft = (draft, ruta) => {
  if (!ruta) return draft;
  const tarifaTipo = ruta.tarifa_tipo || draft.tipo_precio || "viaje";
  const recargoPct = Number(ruta.recargo_combustible_pct || 0) || 0;
  const precioBase = Number(ruta.precio_base || 0) || 0;
  const precioFinal = precioBase > 0 ? Number((precioBase * (1 + (recargoPct / 100))).toFixed(4)) : precioBase;
  const minimoUnidades = normalizeMinimoUnidadesRuta(ruta, tarifaTipo);
  const next = {
    ...draft,
    tipo_precio: tarifaTipo,
    precio_unitario: precioFinal || draft.precio_unitario,
    precio_base_sin_combustible: precioBase || draft.precio_base_sin_combustible || "",
    recargo_combustible_pct: recargoPct || 0,
    importe_minimo: tarifaTipo === "viaje" ? (ruta.minimo_facturable || "") : "",
    minimo_unidades: tarifaTipo !== "viaje" ? minimoUnidades : "",
  };
  if (!Number(draft.cantidad || 0)) {
    next.cantidad = cantidadSugeridaPorTipo(next, tarifaTipo);
  }
  next.importe_revision_combustible = calcRevisionCombustible(next);
  return next;
};

  // The modal JSX (extracted from Pedidos main render)
  return (
    <>
<div className="tg-pedido-modal-overlay" style={S.modal}>
          <style>{`
            .tg-pedido-modal, .tg-pedido-modal * { box-sizing:border-box; min-width:0; }
            .tg-pedido-modal input, .tg-pedido-modal select, .tg-pedido-modal textarea, .tg-pedido-modal button { max-width:100%; }
            .tg-pedido-modal-header { position:sticky; top:0; z-index:1200; isolation:isolate; margin:-28px -28px 16px; padding:18px 28px 12px; background:var(--bg2); border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; }
            .tg-pedido-form-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
            .tg-pedido-form-grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
            .tg-pedido-form-grid-4 { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px; }
            .tg-pedido-actions-row { display:flex; gap:6px; margin-top:6px; }
            @media (max-width: 760px) {
              .tg-pedido-modal-overlay { align-items:flex-start !important; justify-content:center !important; padding:8px !important; overflow:auto !important; }
              .tg-pedido-modal { width:100% !important; max-width:calc(100vw - 16px) !important; max-height:calc(100dvh - 16px) !important; padding:16px 14px 18px !important; border-radius:12px !important; overflow-x:hidden !important; }
              .tg-pedido-modal-header { top:0 !important; margin:-16px -14px 12px !important; padding:12px 14px 10px !important; }
              .tg-pedido-form-grid-2, .tg-pedido-form-grid-3, .tg-pedido-form-grid-4 { grid-template-columns:1fr !important; }
              .tg-pedido-form-grid-2 > *, .tg-pedido-form-grid-3 > *, .tg-pedido-form-grid-4 > * { grid-column:1/-1 !important; }
              .tg-pedido-actions-row { display:grid !important; grid-template-columns:1fr !important; }
              .tg-pedido-actions-row > * { width:100% !important; }
              .tg-pedido-modal [style*="grid-template-columns:1fr 1fr"],
              .tg-pedido-modal [style*="grid-template-columns: 1fr 1fr"],
              .tg-pedido-modal [style*="grid-template-columns:1fr 1fr 1fr"],
              .tg-pedido-modal [style*="grid-template-columns: 1fr 1fr 1fr"],
              .tg-pedido-modal [style*="grid-template-columns:1fr 1fr 1fr 1fr"],
              .tg-pedido-modal [style*="grid-template-columns: 1fr 1fr 1fr 1fr"],
              .tg-pedido-modal [style*="grid-template-columns:repeat(4"],
              .tg-pedido-modal [style*="grid-template-columns: repeat(4"],
              .tg-pedido-modal [style*="grid-template-columns:2fr"],
              .tg-pedido-modal [style*="grid-template-columns: 2fr"],
              .tg-pedido-modal [style*="grid-template-columns:1fr 2fr"],
              .tg-pedido-modal [style*="grid-template-columns: 1fr 2fr"] {
                grid-template-columns:1fr !important;
              }
              .tg-pedido-modal [style*="grid-column:1/3"],
              .tg-pedido-modal [style*="grid-column:3/5"] {
                grid-column:1/-1 !important;
              }
            }
          `}</style>
          <div className="tg-pedido-modal" style={S.mbox}>
            <div className="tg-pedido-modal-header">
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,color:"var(--text)",flex:1}}>
                {editando?._readonly
                  ? editando.numero
                  : editando?._duplicado
                    ? `Duplicar ${editando.numero || "pedido"}`
                    : editando
                      ? `Editar ${editando.numero}`
                      : "Nuevo pedido"}
              </div>
              <button
                type="button"
                onClick={requestClose}
                title="Cerrar pedido"
                aria-label="Cerrar pedido"
                style={{position:"relative",zIndex:1,flex:"0 0 36px",width:36,height:36,borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",fontSize:20,lineHeight:"20px",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:800}}
              >
                x
              </button>
            </div>
            {form.pendiente_completar && (
              <div style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.28)",borderRadius:8,padding:"9px 12px",marginBottom:14,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{fontSize:12,color:"#fbbf24",fontWeight:700,flex:1}}>
                  {form.aviso_completar || "Pedido creado rapido. Completar datos antes de cerrar el trabajo."}
                </div>
                {!editando?._readonly && (
                  <button type="button" onClick={()=>setForm(p=>({...p,pendiente_completar:false,aviso_completar:null}))}
                    style={{...S.btn,background:"rgba(251,191,36,.16)",color:"#fbbf24",border:"1px solid rgba(251,191,36,.35)",padding:"5px 10px",fontSize:11}}>
                    Marcar completado
                  </button>
                )}
              </div>
            )}
            {pedidoTieneFacturaFinal(editando) && !desvinculado && (
              <div style={{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.25)",borderRadius:8,padding:"7px 14px",marginBottom:16,fontSize:12,color:"var(--green)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span><strong>PEDIDO FACTURADO{editando.factura_numero ? ` - ${editando.factura_numero}` : ""}</strong>
                &nbsp;| Modo correccion: puedes editar datos del pedido. Si esta entregado, solo gerencia puede cambiar el estado.</span>
                <button onClick={async()=>{
                  const ok = await confirmDialog({
                    title: "Desvincular factura",
                    message: "Esto NO elimina la factura; solo separa el pedido de ella.\nEl pedido volvera a estar editable.\n\nUsa esto solo si el pedido fue facturado por error.",
                    confirmText: "Desvincular",
                    tone: "danger",
                  });
                  if(!ok) return;
                  try {
                    await desvincularFacturaPedido(editando.id);
                    setDesvinculado(true);
                    if (typeof onFacturaDesvinculada === "function") onFacturaDesvinculada(editando.id);
                    // Reload parent list without closing modal
                    if (typeof onReload === "function") onReload();
                  } catch(e) { notify("Error: "+e.message, "error"); }
                }} style={{marginLeft:"auto",fontSize:10,padding:"3px 10px",borderRadius:5,
                  border:"1px solid rgba(239,68,68,.4)",background:"rgba(239,68,68,.08)",
                  color:"#ef4444",cursor:"pointer",fontWeight:700,whiteSpace:"nowrap",
                  fontFamily:"'DM Sans',sans-serif"}}>
                  Desvincular factura
                </button>
              </div>
            )}

            <PedidoIncidenciaPanel pedido={form || editando} />
            <PedidoMapaOperativo pedido={mapPedidoDraft || editando} choferPasos={choferPasosMapa} />

            <div style={S.sec}>Cliente y ruta</div>
            <div className="tg-pedido-form-grid-2">
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.label}>Cliente *</label>
                {/* Autocomplete por nombre */}
                <div style={{position:"relative"}}>
                  <input
                    placeholder="Escribe el nombre del cliente..."
                    style={{...S.input,width:"100%"}}
                    value={nombreBusqueda || (form.cliente_id ? clientes.find(c=>c.id===form.cliente_id)?.nombre||"" : "")}
                    onChange={e=>{
                      const val = e.target.value;
                      setNombreBusqueda(val);
                      if(!val) { setForm(p=>({...p,cliente_id:""})); }
                      setShowSuggestions(true);
                    }}
                    onFocus={()=>setShowSuggestions(true)}
                    onBlur={()=>setTimeout(()=>setShowSuggestions(false),200)}
                  />
                  {/* Sugerencias */}
                  {showSuggestions && nombreBusqueda && (()=>{
                    const sugs = clientes.filter(c=>
                      c.nombre.toLowerCase().includes(nombreBusqueda.toLowerCase()) ||
                      (c.cif||"").toLowerCase().includes(nombreBusqueda.toLowerCase())
                    ).slice(0,6);
                    if(sugs.length===0) return(
                      <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,zIndex:50,padding:"10px 14px"}}>
                        <div style={{fontSize:12,color:"var(--text4)",marginBottom:8}}>
                          No hay ningun cliente con ese nombre.
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <button type="button"
                            onClick={()=>{ setModalNuevoCliente({nombre:nombreBusqueda}); setShowSuggestions(false); }}
                            style={{...S.btn,background:"var(--accent)",color:"#fff",fontSize:12,padding:"5px 12px"}}>
                            Crear cliente "{nombreBusqueda}"
                          </button>
                          <button type="button"
                            onClick={()=>{ setNombreBusqueda(""); setShowSuggestions(false); }}
                            style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text4)",fontSize:12,padding:"5px 10px"}}>
                            Cancelar
                          </button>
                        </div>
                        <div style={{fontSize:11,color:"var(--text5)",marginTop:6}}>
                          Aviso: sin cliente no se puede crear el viaje.
                        </div>
                      </div>
                    );
                    return(
                      <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,zIndex:50,overflow:"hidden"}}>
                        {sugs.map(c=>(
                          <div key={c.id}
                            onMouseDown={()=>{
                              setForm(p=>({
                                ...p,
                                cliente_id: c.id,
                                tipo_iva: c.tipo_iva ?? p.tipo_iva ?? 21,
                                iva_regimen: c.iva_regimen || ivaOptionValue({ tipo_iva: c.tipo_iva ?? p.tipo_iva }),
                                ventana_carga: p.ventana_carga || c.horario_carga || "",
                                ventana_descarga: p.ventana_descarga || c.horario_descarga || "",
                              }));
                              setNombreBusqueda("");
                              setShowSuggestions(false);
                            }}
                            style={{padding:"9px 14px",cursor:"pointer",borderBottom:"1px solid var(--border2)",display:"flex",justifyContent:"space-between",alignItems:"center"}}
                            onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{c.nombre}</span>
                            {c.cif&&<span style={{fontSize:11,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>{c.cif}</span>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                {/* Cliente seleccionado */}
                {form.cliente_id&&!nombreBusqueda&&(()=>{
                  const c=clientes.find(x=>x.id===form.cliente_id);
                  if(!c) return null;
                  return(
                    <div style={{marginTop:6,padding:"6px 12px",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.2)",borderRadius:7,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:12,color:"var(--accent)",fontWeight:600}}>{c.nombre}{c.cif?" | "+c.cif:""}</span>
                      <button type="button" onClick={()=>setForm(p=>({...p,cliente_id:""}))}
                        style={{background:"none",border:"none",color:"var(--text5)",cursor:"pointer",fontSize:14,padding:"0 4px"}}>Quitar</button>
                    </div>
                  );
                })()}
              </div>
              {!editando?.id && bloqueoClienteModal && (
                <div style={{gridColumn:"1/-1",padding:"10px 12px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,fontSize:12,color:"#b91c1c",fontWeight:800}}>
                  {bloqueoClienteModal.title}: {bloqueoClienteModal.message}
                </div>
              )}
              {form.cliente_id && clienteRiesgoLoading && (
                <div style={{gridColumn:"1/-1",padding:"8px 12px",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:7,fontSize:12,color:"var(--text4)"}}>
                  Revisando cobros pendientes y limite de riesgo del cliente...
                </div>
              )}
              {form.cliente_id && clienteRiesgo && (() => {
                const nivel = clienteRiesgoPedido.nivel || "medio";
                const danger = nivel === "critico" || nivel === "alto";
                const color = nivel === "critico" ? "#ef4444" : danger ? "#f59e0b" : "#22c55e";
                const money = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return (
                  <div style={{gridColumn:"1/-1",padding:"10px 12px",background:danger ? "rgba(245,158,11,.09)" : "rgba(34,197,94,.08)",border:`1px solid ${danger ? "rgba(245,158,11,.3)" : "rgba(34,197,94,.24)"}`,borderRadius:8,display:"grid",gap:6}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
                      <strong style={{fontSize:12,color}}>Aviso de cobro/riesgo del cliente</strong>
                      <span style={{fontSize:18,color,fontWeight:900,fontFamily:"'JetBrains Mono',monospace"}}>
                        {formatRiskPct(clienteRiesgoPedido.riesgo_pct_actual)}
                      </span>
                    </div>
                    <div style={{fontSize:11,color:"var(--text4)"}}>
                      Pendiente: {money(clienteRiesgo.total_pendiente)} EUR
                      {clienteRiesgo.limite_riesgo > 0 ? ` de ${money(clienteRiesgo.limite_riesgo)} EUR` : " | Sin limite de riesgo configurado"}
                      {clienteRiesgoPedido.riesgo_pct_proyectado !== null ? ` | con este pedido: ${formatRiskPct(clienteRiesgoPedido.riesgo_pct_proyectado)}` : ""}
                    </div>
                    {clienteRiesgoPedido.avisos.length > 0 && (
                      <div style={{display:"grid",gap:4}}>
                        {clienteRiesgoPedido.avisos.map((av, idx) => (
                          <div key={`${av.tipo}-${idx}`} style={{fontSize:12,color:"var(--text3)"}}>{av.mensaje}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {form.cliente_id && rutas.length > 0 && (
                <div style={{gridColumn:"1/-1",padding:"8px 12px",background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.2)",borderRadius:7,fontSize:12,color:"var(--text3)"}}>
                  Hay {rutas.length} tarifa(s) guardada(s) para este cliente. Usa "Cargar tarifa / ruta guardada" para rellenar origen, destino, km, precio, minimos y recargos.
                </div>
              )}
              {cmrInternacionalModal && (
                <div style={{gridColumn:"1/-1",padding:"9px 12px",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.22)",borderRadius:8,fontSize:12,color:"var(--text3)",lineHeight:1.35}}>
                  <strong style={{color:"#2563eb"}}>eCMR internacional:</strong> origen o destino fuera de España. El documento se preparara como CMR internacional con trazabilidad, firmas/evidencias, historial y exportacion eFTI/eCMR cuando generes la carta de porte/documento digital.
                </div>
              )}
              {/* Regla tarifaria por ruta */}
              {form.cliente_id&&form.origen&&form.destino&&(()=>{
                const rutaTarifa = rutasCompatibles.find(r=>{
                  const mO = matchEndpointRuta(form.origen, r.origen);
                  const mD = matchEndpointRuta(form.destino, r.destino);
                  return mO&&mD&&routeTarifaMatchesDraft(r, form);
                });
                if(!rutaTarifa) return null;
                const precioVista = Number(rutaTarifa.precio_base || 0) * (1 + ((Number(rutaTarifa.recargo_combustible_pct || 0) || 0) / 100));
                const tipos={viaje:"viaje",kg:"EUR/100kg",tonelada:"EUR/tn",km:"EUR/km",hora:"EUR/h",palet:"EUR/palet"};
                return(
                  <div style={{gridColumn:"1/-1",padding:"8px 12px",background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.2)",borderRadius:7,display:"flex",alignItems:"center",gap:10,fontSize:12}}>
                    <span style={{fontSize:14}}>Ruta</span>
                    <span style={{color:"var(--text3)"}}>
                      Regla encontrada: <strong style={{color:"#10b981"}}>{precioVista.toLocaleString("es-ES",{minimumFractionDigits:2})} EUR {tipos[rutaTarifa.tarifa_tipo]||rutaTarifa.tarifa_tipo}</strong>
                      {Number(rutaTarifa.recargo_combustible_pct||0)>0 && <span style={{marginLeft:8,color:"#fbbf24"}}>+{Number(rutaTarifa.recargo_combustible_pct).toLocaleString("es-ES")} % combustible</span>}
                    </span>
                    <button type="button" onClick={()=>{
                      setForm(p=>{
                        const next = aplicarTarifaRutaADraft(p, rutaTarifa);
                        return syncPrecioClienteCol(next);
                      });
                    }} style={{marginLeft:"auto",padding:"3px 10px",borderRadius:5,border:"none",background:"rgba(16,185,129,.2)",color:"#10b981",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Aplicar precio
                    </button>
                  </div>
                );
              })()}
              <div><label style={S.label}>Cargar tarifa / ruta guardada</label>
                <select value={form.ruta_id||""} onChange={e=>{
  const r=rutas.find(rt=>rt.id===e.target.value);
  setForm(p=>{
    const newForm = {...p, ruta_id:e.target.value};
    if (r) {
      // Auto-fill route data
      if (r.origen)  newForm.origen  = r.origen;
      if (r.destino) newForm.destino = r.destino;
      if (r.km)      newForm.km_ruta = r.km;
      Object.assign(newForm, applyRouteEndpointsFromSavedPoints(newForm, r));

      // Auto-fill peajes cost if ruta has it
      if (r.peajes && Number(r.peajes) > 0) {
        newForm.coste_peajes = Number(r.peajes);
        setShowCostes(true);
      }
      Object.assign(newForm, aplicarTarifaRutaADraft(newForm, r));

      // Auto-fill estimated gasoil cost if km available
      if (r.km && !newForm.colaborador_id) {
        newForm.coste_gasoil = calcularCosteGasoil(newForm);
        setShowCostes(true);
      }
    }
    return syncPrecioClienteCol(newForm);
  });
}} style={S.sel}>
                  <option value="">Sin ruta / Manual</option>
                  {rutas.map(r=>{
                    const compatible = rutaCompatibleConConjunto(r);
                    const tipoReq = r.tipo_vehiculo && r.tipo_vehiculo !== "cualquiera" ? ` (${r.tipo_vehiculo})` : "";
                    return (
                      <option key={r.id} value={r.id} disabled={!compatible}>
                        {r.origen} -> {r.destino}{tipoReq}{!compatible ? " - requiere cambio de remolque" : ""}
                      </option>
                    );
                  })}
                </select>
                <div style={{marginTop:6,fontSize:11,color:"var(--text5)"}}>
                  Al seleccionar una ruta se cargan automaticamente origen, destino, km, precio, minimo facturable y recargo.
                </div>
                {form.cliente_id && rutas.length > rutasCompatibles.length && (
                  <div style={{marginTop:6,fontSize:11,color:"var(--text5)"}}>
                    Hay {rutas.length - rutasCompatibles.length} ruta(s) del cliente no compatibles con el remolque actual. Cambia el remolque para poder seleccionarlas.
                  </div>
                )}
                {rutaIncompatible && (
                  <div style={{marginTop:6,fontSize:11,color:"#f59e0b",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.22)",borderRadius:7,padding:"7px 9px"}}>
                    La ruta exige {rutaSeleccionada.tipo_vehiculo}; el remolque actual parece {tipoRemolqueActual || "sin clasificar"}. Cambia el remolque a uno compatible antes de guardar.
                    {remolquesCompatiblesRuta.length > 0 && (
                      <button type="button" onClick={()=>setForm(p=>({...p,remolque_id_manual:remolquesCompatiblesRuta[0].id}))}
                        style={{marginLeft:8,padding:"3px 8px",borderRadius:6,border:"1px solid rgba(245,158,11,.35)",background:"transparent",color:"#f59e0b",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                        Usar {remolquesCompatiblesRuta[0].matricula}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div><label style={S.label}>Referencia cliente</label><input style={S.input} value={form.referencia_cliente||""} onChange={f("referencia_cliente")} placeholder="Ref. pedido del cliente"/></div>
              <div>
                <label style={S.label}>Origen (carga) *</label>
                <input
                  style={S.input}
                  value={form.origen||""}
                  onChange={aplicarEndpointText("origen", "carga")}
                  onBlur={e=>resolverEndpointEnFormulario("origen", "carga", e.currentTarget.value)}
                  list={cargaEndpointListId}
                  placeholder="Escribe o elige un punto de carga"
                />
                <datalist id={cargaEndpointListId}>
                  {puntosCargaSugeridosModal.map(p => (
                    <option key={`${p.id}-carga`} value={p.nombre || p.direccion}>
                      {direccionCompletaPunto(p) || p.direccion || p.nombre}
                    </option>
                  ))}
                </datalist>
                {form.cliente_id && (
                  <div style={{marginTop:6}}>
                    {puntosCargaClienteModal.length > 0 ? (
                      <PuntoInteresPicker
                        placeholder={puntosCargaClienteModal.length === 1 ? "Punto de carga del cliente" : "Elegir punto de carga del cliente"}
                        puntos={puntosCargaClienteModal}
                        clienteId={form.cliente_id}
                        tipo="carga"
                        onPick={p=>setForm(x=>applyPuntoCargaToDraft(x, p))}
                        style={{...S.sel,width:"100%"}}
                      />
                    ) : (
                      <div style={{fontSize:11,color:"var(--text5)",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:7,padding:"7px 9px"}}>
                        {puntosCargaClienteLoading ? "Cargando puntos de carga del cliente..." : "Este cliente no tiene puntos de carga propios. Crea un punto nuevo asociado a este cliente."}
                      </div>
                    )}
                  </div>
                )}
                <div className="tg-pedido-actions-row">
                  <PuntoInteresPicker
                    placeholder="Usar punto como origen"
                    clienteId={form.cliente_id}
                    tipo="carga"
                    onPick={p=>setForm(x=>applyPuntoCargaToDraft(x, p))}
                    style={{...S.sel,flex:1}}
                  />
                  <button type="button" onClick={()=>setPoiDraft({nombre:form.origen,direccion:"",tipo:"carga",cliente_id:form.cliente_id || "",ventana:form.ventana_carga || "",pais:"España"})} disabled={!form.origen?.trim()}
                    style={{...S.btn,background:"transparent",color:form.origen?.trim()?"var(--accent)":"var(--text5)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Guardar punto
                  </button>
                  <button type="button" onClick={()=>{ setManagePointsMode("carga"); setManagePointsOpen(true); }}
                    style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Puntos
                  </button>
                </div>
              </div>
              <div>
                <label style={S.label}>Destino (entrega) *</label>
                <input
                  style={S.input}
                  value={form.destino||""}
                  onChange={aplicarEndpointText("destino", "descarga")}
                  onBlur={e=>resolverEndpointEnFormulario("destino", "descarga", e.currentTarget.value)}
                  list={descargaEndpointListId}
                  placeholder="Escribe o elige un punto de descarga"
                />
                <datalist id={descargaEndpointListId}>
                  {puntosDescargaSugeridosModal.map(p => (
                    <option key={`${p.id}-descarga`} value={p.nombre || p.direccion}>
                      {direccionCompletaPunto(p) || p.direccion || p.nombre}
                    </option>
                  ))}
                </datalist>
                <div className="tg-pedido-actions-row">
                  <PuntoInteresPicker
                    placeholder="Usar punto como destino"
                    clienteId={form.cliente_id}
                    tipo="descarga"
                    onPick={p=>setForm(x=>{
                      return applyPuntoDescargaToDraft(x, p);
                    })}
                    style={{...S.sel,flex:1}}
                  />
                  <button type="button" onClick={()=>setPoiDraft({nombre:form.destino,direccion:"",tipo:"descarga",cliente_id:form.cliente_id || "",ventana:form.ventana_descarga || "",pais:"España"})} disabled={!form.destino?.trim()}
                    style={{...S.btn,background:"transparent",color:form.destino?.trim()?"var(--accent)":"var(--text5)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Guardar punto
                  </button>
                  <button type="button" onClick={()=>{ setManagePointsMode("descarga"); setManagePointsOpen(true); }}
                    style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid var(--border2)",padding:"8px 10px"}}>
                    Puntos
                  </button>
                </div>
              </div>
            </div>

            <div style={S.sec}>Planificacion</div>
            <div className="tg-pedido-form-grid-4">
              <div><label style={S.label}>Fecha pedido</label><input type="date" min="2000-01-01" max="2100-12-31" style={S.input} value={form.fecha_pedido||""} onChange={f("fecha_pedido")}/></div>
              <div><label style={S.label}>Fecha carga</label><input type="date" min="2000-01-01" max="2100-12-31" style={S.input} value={form.fecha_carga||""} onChange={f("fecha_carga")}/></div>
              <div><label style={S.label}>Hora carga</label><input type="time" style={S.input} value={form.hora_carga||""} onChange={f("hora_carga")}/></div>
              <div><label style={S.label}>Ventana carga</label><input style={S.input} value={form.ventana_carga||""} onChange={f("ventana_carga")} placeholder="08:00-14:00"/></div>
              <div><label style={S.label}>Fecha descarga</label><input type="date" min="2000-01-01" max="2100-12-31" style={S.input} value={form.fecha_descarga||""} onChange={f("fecha_descarga")}/></div>
              <div><label style={S.label}>Hora descarga</label><input type="time" style={S.input} value={form.hora_descarga||""} onChange={f("hora_descarga")}/></div>
              <div><label style={S.label}>Ventana descarga</label><input style={S.input} value={form.ventana_descarga||""} onChange={f("ventana_descarga")} placeholder="07:00-17:00"/></div>
              <div><label style={S.label}>Estado</label>
                <select
                  value={form.estado||"pendiente"}
                  onChange={f("estado")}
                  disabled={editando?.id && String(editando?.estado || "").toLowerCase() === "entregado" && !esGerente}
                  style={{...S.sel,opacity:editando?.id && String(editando?.estado || "").toLowerCase() === "entregado" && !esGerente ? 0.65 : 1}}
                >
                  {ESTADOS_RAW.map(e=><option key={e} value={e}>{LABEL_ESTADO[e]}</option>)}
                </select>
                {editando?.id && String(editando?.estado || "").toLowerCase() === "entregado" && !esGerente && (
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Estado bloqueado: solo gerencia puede cambiar un pedido entregado.</div>
                )}
              </div>
              <div style={{gridColumn:"1/3"}}>
                <label style={S.label}>Google Maps carga</label>
                <input
                  style={S.input}
                  value={getPrimaryStopField(form.puntos_carga, "google_maps_url")}
                  onChange={e=>setForm(p=>({
                    ...p,
                    puntos_carga: updatePrimaryStop(
                      p.puntos_carga,
                      { google_maps_url: e.target.value },
                      p.origen || ""
                    ),
                  }))}
                  placeholder="https://maps.google.com/..."
                />
              </div>
              <div style={{gridColumn:"3/5"}}>
                <label style={S.label}>Google Maps descarga</label>
                <input
                  style={S.input}
                  value={getPrimaryStopField(form.puntos_descarga, "google_maps_url")}
                  onChange={e=>setForm(p=>({
                    ...p,
                    puntos_descarga: updatePrimaryStop(
                      p.puntos_descarga,
                      { google_maps_url: e.target.value },
                      p.destino || ""
                    ),
                  }))}
                  placeholder="https://maps.google.com/..."
                />
              </div>
            </div>

            <div style={S.sec}>Distancias</div>
            <div className="tg-pedido-form-grid-2" style={{marginBottom:10}}>
              <div>
                <label style={S.label}>
                  Km en ruta
                  {getRoutePlaces(form).length >= 2 && (
                    <button type="button" onClick={async()=>{
                      const km = await calcularKmRuta(form.origen, form.destino, getRoutePlaces(form));
                      if(km) setForm(p=>{
                        const next = {...p, km_ruta:km};
                        if (!next.colaborador_id) {
                          next.coste_gasoil = calcularCosteGasoil(next);
                          setShowCostes(true);
                        }
                        return syncCantidadSiVacia(next);
                      });
                    }} disabled={calcKm}
                      style={{marginLeft:8,padding:"1px 8px",borderRadius:5,border:"1px solid var(--accent)",background:"transparent",color:"var(--accent)",fontSize:10,cursor:calcKm?"not-allowed":"pointer",fontWeight:700}}>
                      {calcKm ? "Calculando..." : "Calcular"}
                    </button>
                  )}
                </label>
                <input type="text" inputMode="decimal" style={S.input} value={form.km_ruta||""} onChange={e=>{ const km=parseLocaleNumber(e.target.value,0); setForm(p=>{ const u=syncPrecioClienteCol(syncCantidadSiVacia({...p,km_ruta:e.target.value})); if(km>0&&!u.colaborador_id){u.coste_gasoil=calcularCosteGasoil(u); setShowCostes(true);} return u; }); }}
                  placeholder="Se calcula automaticamente"/>
              </div>
              <div>
                <label style={S.label}>
                  Km en vacio
                  {form.vehiculo_id && form.origen && (
                    <button type="button" onClick={async()=>{
                      const result = await calcularKmVacio(form.vehiculo_id, form.origen);
                      if(result) {
                        setForm(p=>({...p, km_vacio:result.km}));
                        if(result.km > 0)
                          notify(`Km en vacio calculados: ${result.km} km (desde ${result.desde} hasta ${form.origen})`, "success");
                      } else {
                        notify("No hay viajes anteriores de este vehiculo o no se pudo calcular la distancia.", "warning");
                      }
                    }} disabled={calcKm}
                      style={{marginLeft:8,padding:"1px 8px",borderRadius:5,border:"1px solid #a78bfa",background:"transparent",color:"#a78bfa",fontSize:10,cursor:calcKm?"not-allowed":"pointer",fontWeight:700}}>
                      {calcKm ? "..." : "Calcular"}
                    </button>
                  )}
                </label>
                <input type="text" inputMode="decimal" style={S.input} value={form.km_vacio||""} onChange={f("km_vacio")}
                  placeholder="Distancia hasta punto de carga"/>
              </div>
              <div style={{gridColumn:"1/-1",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:10}}>Operativa de carga</div>
                <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                  {[
                    ["carga_lateral","Carga lateral"],
                    ["carga_trasera","Carga trasera"],
                    ["intercambio_palets","Intercambio de palets"],
                    ["requiere_cinchas","Necesario llevar cinchas"],
                  ].map(([key,label])=>(
                    <label key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"var(--text3)",cursor:"pointer"}}>
                      <input type="checkbox" checked={!!form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.checked}))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div style={S.sec}>Puntos de carga</div>
            <CargasEditor pedidoId={editando?.id} form={form} setForm={setForm} disabled={editando?._readonly}/>

            <div style={S.sec}>Puntos de descarga</div>
            <DescargasEditor pedidoId={editando?.id} form={form} setForm={setForm} disabled={editando?._readonly}/>

            <div style={S.sec}>Mercancia</div>
            <div style={{display:"flex",gap:16,marginBottom:10,alignItems:"center",padding:"10px 14px",background:"var(--bg4)",borderRadius:8,border:"1px solid var(--border2)"}}>
              <span style={{fontSize:12,fontWeight:700,color:"var(--text3)"}}>Tipo de carga:</span>
              {["completa","grupaje"].map(t=>(
                <label key={t} style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:13,fontWeight:t===(form.tipo_carga||"completa")?"700":"400",color:t===(form.tipo_carga||"completa")?"var(--accent)":"var(--text4)"}}>
                  <input type="radio" name="tipo_carga" value={t} checked={(form.tipo_carga||"completa")===t}
                    onChange={()=>setForm(p=>({...p,tipo_carga:t}))} style={{accentColor:"var(--accent)"}}/>
                  {t==="completa"?"Carga completa":"Grupaje (carga parcial)"}
                </label>
              ))}
              {(form.tipo_carga||"completa")==="grupaje" && (
                <span style={{fontSize:11,color:"#f59e0b",marginLeft:8}}>Se anadira a Grupajes para combinarlo con otros pedidos</span>
              )}
            </div>
            <div className="tg-pedido-form-grid-2">
              <div style={{gridColumn:"1/-1"}}><label style={S.label}>Descripcion mercancia</label><input style={S.input} value={form.mercancia||""} onChange={f("mercancia")} placeholder="Pallets de ceramica, maquinaria..."/></div>
                <div>
                  <label style={S.label}>Peso (kg)</label>
                  <input type="text" inputMode="decimal" style={S.input} value={form.peso_kg||""} onChange={e=>setForm(p=>{
                    const next = syncPrecioClienteCol(syncCantidadSiVacia({...p, peso_kg:e.target.value}));
                    if (!next.colaborador_id && parseLocaleNumber(next.km_ruta, 0) > 0) {
                      next.coste_gasoil = calcularCosteGasoil(next);
                      setShowCostes(true);
                    }
                    return next;
                  })} onBlur={()=>setForm(p=>{
                    const next = normalizePesoKgDraft(p);
                    if (!next.colaborador_id && parseLocaleNumber(next.km_ruta, 0) > 0) next.coste_gasoil = calcularCosteGasoil(next);
                    return next;
                  })}/>
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:4}}>Acepta kg totales o toneladas con coma. Ej: 27,6 -> 27.600 kg.</div>
                  <PesoAlerta
                    pesoKg={form.peso_kg}
                    vehiculoId={form.vehiculo_id}
                    remolqueId={form.remolque_id_manual}
                  vehiculos={vehiculosLocal}
                />
              </div>
              <div><label style={S.label}>Bultos / Palets</label><input type="text" inputMode="decimal" style={S.input} value={form.bultos||""} onChange={e=>setForm(p=>syncPrecioClienteCol(syncCantidadSiVacia({...p,bultos:e.target.value})))}/></div>
              <div><label style={S.label}>Volumen (m3)</label><input type="text" inputMode="decimal" style={S.input} value={form.volumen||""} onChange={f("volumen")}/></div>
            </div>

            <div style={S.sec}>Precio</div>
            <div style={{fontSize:11,color:"var(--text5)",margin:"-6px 0 8px"}}>El porte se introduce sin IVA. Selecciona aqui si la orden va con IVA, 0% o exenta.</div>
            <div className="tg-pedido-form-grid-3">
              <div><label style={S.label}>Tipo tarificacion</label>
                <select value={form.tipo_precio||"viaje"} onChange={e=>setForm(p=>syncPrecioClienteCol(syncCantidadSiVacia({...p,tipo_precio:e.target.value}, true)))} style={S.sel}>
                  {TIPOS_PRECIO.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div><label style={S.label}>{form.tipo_precio==="viaje"?"Precio viaje (EUR)":form.tipo_precio==="kg"?"EUR por 100 kg":form.tipo_precio==="tonelada"?"EUR por tonelada":form.tipo_precio==="km"?"EUR por km":form.tipo_precio==="palet"?"EUR por palet":"EUR por hora"}</label>
                <input type="text" inputMode="decimal" style={S.input} value={form.precio_unitario||""} onChange={e => {
                  const v = e.target.value;
                  setForm(p => syncPrecioClienteCol({
                    ...p,
                    precio_unitario: v,
                  }));
                }}/>
              </div>
              {form.tipo_precio!=="viaje"&&<div><label style={S.label}>{form.tipo_precio==="kg"?"Peso kg":form.tipo_precio==="tonelada"?"Toneladas":form.tipo_precio==="km"?"Kilometros":form.tipo_precio==="palet"?"Palets":"Horas"}</label>
                <input type="text" inputMode="decimal" style={S.input} value={compactNumberInput(form.cantidad)} onChange={e=>setForm(p=>syncPrecioClienteCol(syncPrecioColaboradorCalc({...p,cantidad:e.target.value})))}/>
              </div>}
              <div><label style={S.label}>Extracostes / Esperas (EUR)</label><input type="text" inputMode="decimal" style={S.input} value={form.extracostes ?? form.extracostes_importe ?? ""} onChange={e=>setForm(p=>syncPrecioClienteCol({...p,extracostes:e.target.value,extracostes_importe:e.target.value}))} placeholder="0.00"/></div>
              <div>
                <label style={S.label}>IVA del viaje</label>
                <select value={ivaOptionValue(form)} onChange={e=>setForm(p=>applyIvaOptionToDraft(p,e.target.value))} style={S.sel}>
                  {IVA_PEDIDO_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{...S.label,color:"#f59e0b"}}>Clausula gasoil (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  style={S.input}
                  value={form.recargo_combustible_pct || ""}
                  onChange={e=>setForm(p=>{
                    const base = parseLocaleNumber(p.precio_base_sin_combustible || p.precio_unitario, 0);
                    const pct = parseLocaleNumber(e.target.value, 0);
                    const next = {
                      ...p,
                      recargo_combustible_pct:e.target.value,
                      precio_base_sin_combustible:p.precio_base_sin_combustible || p.precio_unitario || "",
                      precio_unitario:base > 0 && pct > 0 ? Number((base * (1 + pct / 100)).toFixed(2)) : p.precio_unitario,
                    };
                    return {...next, importe_revision_combustible:calcRevisionCombustible(next)};
                  })}
                  placeholder="Ej. 5"
                />
              </div>
              <div>
                <label style={{...S.label,color:"#f59e0b"}}>Precio base sin gasoil</label>
                <input
                  type="text"
                  inputMode="decimal"
                  style={S.input}
                  value={form.precio_base_sin_combustible || ""}
                  onChange={e=>setForm(p=>{
                    const base = parseLocaleNumber(e.target.value, 0);
                    const pct = parseLocaleNumber(p.recargo_combustible_pct, 0);
                    const next = {...p,precio_base_sin_combustible:e.target.value,precio_unitario:base > 0 && pct > 0 ? Number((base * (1 + pct / 100)).toFixed(2)) : p.precio_unitario};
                    return {...next, importe_revision_combustible:calcRevisionCombustible(next)};
                  })}
                  placeholder="Importe antes del recargo"
                />
                <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Importe del viaje antes de aplicar la clausula de gasoil.</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}>
              <div>
                <label style={{...S.label,color:"#f59e0b"}}>{form.tipo_precio==="kg"?"Minimo facturable (kg)":form.tipo_precio==="tonelada"?"Minimo facturable (toneladas)":form.tipo_precio==="km"?"Minimo facturable (km)":form.tipo_precio==="palet"?"Minimo facturable (palets)":form.tipo_precio==="hora"?"Minimo facturable (horas)":"Minimo facturable (EUR)"}</label>
                <input type="text" inputMode="decimal" style={S.input}
                  value={form.tipo_precio==="viaje" ? compactNumberInput(form.importe_minimo) : compactNumberInput(form.minimo_unidades)}
                  onChange={e=>setForm(p=>syncPrecioClienteCol(syncPrecioColaboradorCalc({...p,[p.tipo_precio==="viaje" ? "importe_minimo" : "minimo_unidades"]:e.target.value})))}
                  placeholder="Dejar vacio si no hay minimo"/>
                <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>
                  {form.tipo_precio==="viaje" ? "Si el calculo queda por debajo, se cobra este importe." : "Para kg, toneladas, km, palets u horas se aplica el minimo de unidades antes de multiplicar por el precio."}
                </div>
              </div>
              <div>
                <label style={{...S.label,color:"#ef4444"}}>Importe paralizacion (EUR, sin IVA)</label>
                <input type="text" inputMode="decimal"
                  style={{...S.input, borderColor:"rgba(239,68,68,.35)"}}
                  value={form.importe_paralizacion||""} onChange={f("importe_paralizacion")}
                  placeholder="0 si no hay paralizacion"/>
                <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>
                  Se factura en documento separado sin IVA
                </div>
              </div>
            </div>
            {parseLocaleNumber(form.importe_paralizacion,0)>0&&(
              <div style={{background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.2)",borderRadius:7,padding:"8px 14px",fontSize:11,color:"#ef4444",fontWeight:600,marginTop:4}}>
                Se generara factura de paralizacion por {parseLocaleNumber(form.importe_paralizacion,0).toFixed(2)} EUR sin IVA
              </div>
            )}
            {form.precio_unitario&&(
              <div style={{background:"rgba(34,211,160,.07)",border:"1px solid rgba(34,211,160,.2)",borderRadius:8,padding:"10px 16px",marginTop:4}}>
                {sumAdditionalDescargaPrices(form.puntos_descarga)>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:11,color:"var(--text3)"}}>Descargas adicionales incluidas</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"var(--green)"}}>+{sumAdditionalDescargaPrices(form.puntos_descarga).toFixed(2)} EUR</span>
                  </div>
                )}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:12,color:"var(--text2)"}}>
                    Importe viaje sin IVA
                    {((form.tipo_precio==="viaje" && parseLocaleNumber(form.importe_minimo,0)>0 && calcImporte(form)===parseLocaleNumber(form.importe_minimo,0)) ||
                      (form.tipo_precio!=="viaje" && parseLocaleNumber(form.minimo_unidades,0)>parseLocaleNumber(form.cantidad,0))) &&
                      <span style={{fontSize:10,color:"#f59e0b",marginLeft:6}}>minimo</span>}
                  </span>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:18,color:"var(--green)"}}>{calcImporte(form).toFixed(2)} EUR</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:4,paddingTop:4,borderTop:"1px solid rgba(34,211,160,.2)"}}>
                  <span style={{fontSize:11,color:"var(--text3)"}}>EUR/km venta</span>
                  {(() => {
                    const eurKm = precioKmPedidoInfo(form);
                    return <span title={eurKm.hint} style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:13,color:eurKm.value ? "var(--green)" : "var(--text5)"}}>{eurKm.label}</span>;
                  })()}
                </div>
                {parseLocaleNumber(form.importe_paralizacion,0)>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:4,paddingTop:4,borderTop:"1px solid rgba(34,211,160,.2)"}}>
                    <span style={{fontSize:11,color:"#ef4444"}}>+ Paralizacion (sin IVA)</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"#ef4444"}}>+{parseLocaleNumber(form.importe_paralizacion,0).toFixed(2)} EUR</span>
                  </div>
                )}
                {calcRevisionCombustible(form)>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:4,paddingTop:4,borderTop:"1px solid rgba(245,158,11,.25)"}}>
                    <span style={{fontSize:11,color:"#f59e0b"}}>Revision combustible desglosable en factura ({Number(form.recargo_combustible_pct||0).toLocaleString("es-ES")}%)</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"#f59e0b"}}>{calcRevisionCombustible(form).toFixed(2)} EUR</span>
                  </div>
                )}
                {(()=> {
                  const iva = calcIvaPedido(form);
                  return (
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:4,paddingTop:4,borderTop:"1px solid rgba(34,211,160,.2)"}}>
                      <span style={{fontSize:11,color:iva.aplica?"var(--text3)":"#64748b"}}>{iva.aplica ? `IVA ${iva.tipo_iva}%` : (iva.iva_regimen === "exento" ? "Exento de IVA" : "IVA 0%")}</span>
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:iva.aplica?"var(--green)":"#64748b"}}>{iva.aplica ? `+${iva.cuota.toFixed(2)} EUR` : "Sin IVA"}</span>
                    </div>
                  );
                })()}
                <div style={{display:"flex",justifyContent:"space-between",marginTop:4,paddingTop:4,borderTop:"1px solid rgba(34,211,160,.3)"}}>
                  <span style={{fontSize:11,fontWeight:700,color:"var(--text3)"}}>{calcIvaPedido(form).aplica ? "TOTAL CON IVA" : "TOTAL SIN IVA"}</span>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:14,color:"var(--green)"}}>{(calcIvaPedido(form).total+parseLocaleNumber(form.importe_paralizacion,0)).toFixed(2)} EUR</span>
                </div>
              </div>
            )}

            {/* Banner aviso operacional vehiculo */}
            {avisoVehiculo && (
              <div style={{
                background:"rgba(245,158,11,.12)",
                border:"2px solid rgba(245,158,11,.5)",
                borderRadius:10,
                padding:"14px 16px",
                marginBottom:14,
                position:"relative",
              }}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  <span style={{fontSize:24,flexShrink:0}}>!</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:800,fontSize:14,color:"#f59e0b",marginBottom:6}}>
                      Aviso para {avisoVehiculo.matricula}
                    </div>
                    <div style={{fontSize:13,color:"var(--text)",lineHeight:1.6,whiteSpace:"pre-line"}}>
                      {avisoVehiculo.notas}
                    </div>
                    <button
                      onClick={()=>setAvisoVehiculo(null)}
                      style={{marginTop:10,padding:"6px 18px",borderRadius:7,border:"none",
                        background:"#f59e0b",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",
                        fontFamily:"'DM Sans',sans-serif"}}>
                       Entendido - Continuar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Costes reales del viaje ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",
              background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.18)",borderRadius:8,
              padding:"8px 14px",marginBottom:showCostes?8:14}}
              onClick={()=>setShowCostes(v=>!v)}>
              <span style={{fontWeight:700,fontSize:12,color:"#ef4444"}}>Costes del viaje</span>
              <span style={{fontSize:11,color:"var(--text4)"}}>
                {(()=>{
                  const total = [form.coste_gasoil,form.coste_peajes,form.coste_dietas,form.coste_otros]
                    .reduce((s,v)=>s+Number(v||0),0);
                  const ingresoTotal = calcImporte(form) + parseLocaleNumber(form.importe_paralizacion, 0);
                  const margen = ingresoTotal - total;
                  return total>0
                    ? `Total costes: ${total.toFixed(2)}EUR - Margen: ${margen.toFixed(2)}EUR (${ingresoTotal>0?(margen/ingresoTotal*100).toFixed(1):0}%)`
                    : showCostes ? "Ocultar" : "Registrar costes";
                })()}
              </span>
            </div>
            {showCostes && (
              <div style={{background:"rgba(239,68,68,.04)",border:"1px solid rgba(239,68,68,.15)",borderRadius:8,padding:"14px",marginBottom:14}}>
                {parseLocaleNumber(form.km_ruta, 0) > 0 && (
                  <div style={{fontSize:11,color:"var(--text4)",marginBottom:10}}>
                    {form.colaborador_id
                      ? "Viaje cargado por colaborador: el coste de gasoil se mantiene a 0."
                      : `Gasoil calculado con ${consumoLitros100PorPeso(form.peso_kg)} L/100 km segun peso (${parseLocaleNumber(form.peso_kg,0).toLocaleString("es-ES")} kg) y ${parseLocaleNumber(form.km_ruta,0).toLocaleString("es-ES")} km.`}
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  {[
                    {l:"Gasoil (EUR)",    k:"coste_gasoil"},
                    {l:"Peajes (EUR)",     k:"coste_peajes"},
                    {l:"Dietas (EUR)",     k:"coste_dietas"},
                    {l:"Otros costes (EUR)", k:"coste_otros"},
                  ].map(({l,k})=>(
                    <div key={k}>
                      <label style={{...S.label,color:"var(--text3)"}}>{l}</label>
                      <input type="number" min="0" step="0.01" style={S.sel}
                        disabled={k==="coste_gasoil" && !!form.colaborador_id}
                        value={k==="coste_gasoil" && form.colaborador_id ? "" : form[k]||""}
                        onChange={e=>setForm(p=>({...p,[k]:e.target.value}))}
                        placeholder={k==="coste_gasoil" && form.colaborador_id ? "0 por colaborador" : "0.00"}/>
                    </div>
                  ))}
                </div>
                {/* Resumen margen */}
                {(()=>{
                  const ingreso = calcImporte(form) + parseLocaleNumber(form.importe_paralizacion, 0);
                  const totalC  = [form.coste_gasoil,form.coste_peajes,form.coste_dietas,form.coste_otros]
                    .reduce((s,v)=>s+Number(v||0),0);
                  const margen  = ingreso - totalC;
                  const pct     = ingreso>0 ? (margen/ingreso*100).toFixed(1) : 0;
                  return ingreso>0||totalC>0 ? (
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                      {[
                        {l:"Ingresos",v:`${ingreso.toFixed(2)} EUR`,c:"var(--green)"},
                        {l:"Costes",  v:`${totalC.toFixed(2)} EUR`, c:"#ef4444"},
                        {l:"Margen",  v:`${margen.toFixed(2)} EUR (${pct}%)`,
                          c:margen>=0?"var(--green)":"#ef4444"},
                      ].map(({l,v,c})=>(
                        <div key={l} style={{background:"var(--bg3)",borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
                          <div style={{fontSize:13,fontWeight:800,color:c}}>{v}</div>
                          <div style={{fontSize:9,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".07em",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
                <div>
                  <label style={{...S.label,color:"var(--text3)"}}>Notas de costes</label>
                  <input style={S.sel} value={form.coste_notas||""} placeholder="Ej: Conductor extra, esperas en carga..."
                    onChange={e=>setForm(p=>({...p,coste_notas:e.target.value}))}/>
                </div>
              </div>
            )}

            <div style={S.sec}>Asignacion</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label style={S.label}>Vehiculo</label>
                <select value={form.vehiculo_id||""} onChange={e=>{
                  const vid = e.target.value;
                  const veh = vehiculosLocal.find(v=>v.id===vid);
                  const prevVeh = vehiculosLocal.find(v=>v.id===form.vehiculo_id);
                  setForm(p=>{
                    const choferEraDelAnterior = !p.chofer_id || p.chofer_id === prevVeh?.chofer_id;
                    const remolqueEraDelAnterior = !p.remolque_id_manual || p.remolque_id_manual === prevVeh?.remolque_id;
                    const choferDelVehiculo = veh?.chofer_id ||
                      choferesLocal.find(ch => ch.vehiculo_id === vid)?.id || "";
                    return {
                      ...p,
                      vehiculo_id: vid,
                      chofer_id: choferEraDelAnterior ? choferDelVehiculo : p.chofer_id,
                      remolque_id_manual: remolqueEraDelAnterior ? (veh?.remolque_id || "") : p.remolque_id_manual,
                    };
                  });
                  // Mostrar aviso operacional si el vehiculo tiene notas
                  if (isMeaningfulVehicleNotice(veh?.notas_operacion)) {
                    setAvisoVehiculo({ matricula: veh.matricula, notas: veh.notas_operacion });
                  } else {
                    setAvisoVehiculo(null);
                  }
                }} style={S.sel}>
                  <option value="">Sin asignar</option>
                  {(()=>{
                    // Detectar remolques: por clase, por matricula R-*, o por ser remolque_id de alguien
                    const esRemolqueDeAlguien = new Set(vehiculosLocal.map(v=>v.remolque_id).filter(Boolean));
                    const esRemolque = v => {
                      const clase = (v.clase||v.tipo||"").toLowerCase();
                      const mat = (v.matricula||"").toUpperCase();
                      return clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly") ||
                             esRemolqueDeAlguien.has(v.id) ||
                             /^R[-_\s]/i.test(mat) || mat.endsWith("-R") || mat.endsWith("_R");
                    };
                    return vehiculosLocal
                      .filter(v => !esRemolque(v))
                      .map(v => {
                        const rem = v.remolque_matricula;
                        const label = rem
                          ? `${v.matricula} - ${rem}` // conjunto: tractora + remolque
                          : v.matricula;                  // solo tractora
                        return <option key={v.id} value={v.id}>{label}</option>;
                      });
                  })()}
                </select>
              </div>
              <div>
                <label style={S.label}>
                  Chofer principal
                  {form.vehiculo_id&&vehiculosLocal.find(v=>v.id===form.vehiculo_id)?.chofer_id&&(
                    <span style={{marginLeft:6,fontSize:10,color:"var(--accent)",fontWeight:500}}>
                      - auto del vehiculo
                    </span>
                  )}
                </label>
                <select value={form.chofer_id||""} onChange={f("chofer_id")} style={S.sel}>
                  <option value="">Sin asignar</option>
                  {choferesLocal.map(c=><option key={c.id} value={c.id}>{c.nombre} {c.apellidos||""}</option>)}
                </select>
              </div>
              {/* ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Remolque del conjunto ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ */}
              <div>
                <label style={S.label}>
                  Remolque
                  {form.vehiculo_id && vehiculosLocal.find(v=>v.id===form.vehiculo_id)?.remolque_id && (
                    <span style={{marginLeft:6,fontSize:10,color:"#a78bfa",fontWeight:500}}>- del conjunto</span>
                  )}
                </label>
                <select
                  value={form.remolque_id_manual||vehiculosLocal.find(v=>v.id===form.vehiculo_id)?.remolque_id||""}
                  onChange={e=>setForm(p=>({...p, remolque_id_manual: e.target.value||""}))}
                  style={S.sel}>
                  <option value="">Sin remolque</option>
                  {(()=>{
                    const remolqueIds2 = new Set(vehiculosLocal.map(v=>v.remolque_id).filter(Boolean));
                    const esRemolque2 = v => {
                      const clase = (v.clase||v.tipo||"").toLowerCase();
                      const mat = (v.matricula||"").toUpperCase();
                      return clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly") ||
                             remolqueIds2.has(v.id) ||
                             /^R[-_\s]/i.test(mat) || mat.endsWith("-R") || mat.endsWith("_R");
                    };
                    return vehiculosLocal.filter(v => esRemolque2(v))
                      .map(v=>(
                        <option key={v.id} value={v.id}>{v.matricula}{v.marca?" - "+v.marca:""}</option>
                      ));
                  })()}
                </select>
                {form.remolque_id_manual && form.vehiculo_id &&
                 form.remolque_id_manual !== vehiculosLocal.find(v=>v.id===form.vehiculo_id)?.remolque_id && (
                  <div style={{marginTop:4,fontSize:11,color:"#fbbf24",padding:"4px 9px",background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.2)",borderRadius:6}}>
                    Aviso: Distinto al conjunto habitual - al guardar se actualizara el conjunto de la tractora
                  </div>
                )}
              </div>

              <div><label style={S.label}>2o Chofer (opcional)</label>
                <select value={form.chofer2_id||""} onChange={f("chofer2_id")} style={S.sel}>
                  <option value="">Sin segundo chofer</option>
                  {choferesLocal.filter(c=>c.id!==form.chofer_id).map(c=><option key={c.id} value={c.id}>{c.nombre} {c.apellidos||""}</option>)}
                </select>
              </div>
              {form.chofer2_id&&(
                <div style={{gridColumn:"1/-1",background:"rgba(139,92,246,.06)",border:"1px solid rgba(139,92,246,.18)",borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",gap:12}}>
                  <span style={{fontSize:13}}></span>
                  <div style={{flex:1,fontSize:12,color:"var(--text3)"}}>Viaje compartido entre dos choferes. El importe se repartira a partes iguales en las hojas de ruta.</div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <label style={{fontSize:11,color:"var(--text4)"}}>% chofer 1:</label>
                    <input type="number" min="0" max="100" style={{...S.input,width:60,padding:"4px 8px",fontSize:12}} value={form.reparto_chofer1||50} onChange={f("reparto_chofer1")}/>
                    <label style={{fontSize:11,color:"var(--text4)"}}>% chofer 2:</label>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"var(--accent)"}}>{100-Number(form.reparto_chofer1||50)}%</span>
                  </div>
                </div>
              )}

              {/* ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Colaborador ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ */}
              <div style={{gridColumn:"1/-1",background:"rgba(15,118,110,.06)",border:"1px solid rgba(15,118,110,.2)",borderRadius:9,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--accent)",marginBottom:4}}>Conductor efectivo para DCD</div>
                <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.45,marginBottom:10}}>
                  Si hay un chofer de plantilla se usan los datos de su ficha. Completa estos campos para un conductor externo o para una correccion puntual del documento.
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}}>
                  <div><label style={S.label}>Nombre</label><input style={S.input} value={form.conductor_efectivo_nombre||""} onChange={f("conductor_efectivo_nombre")} placeholder="Nombre" /></div>
                  <div><label style={S.label}>Apellidos</label><input style={S.input} value={form.conductor_efectivo_apellidos||""} onChange={f("conductor_efectivo_apellidos")} placeholder="Apellidos" /></div>
                  <div><label style={S.label}>DNI / NIE</label><input style={S.input} value={form.conductor_efectivo_dni||""} onChange={e=>setForm(p=>({...p,conductor_efectivo_dni:e.target.value.toUpperCase()}))} placeholder="Documento de identidad" /></div>
                  <div><label style={S.label}>Telefono</label><input type="tel" style={S.input} value={form.conductor_efectivo_telefono||""} onChange={f("conductor_efectivo_telefono")} placeholder="Telefono" /></div>
                </div>
              </div>

              <div style={{gridColumn:"1/-1",background:"rgba(139,92,246,.05)",border:"1px solid rgba(139,92,246,.15)",borderRadius:9,padding:"12px 14px",marginTop:4}}>
                <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#a78bfa",marginBottom:10}}>Colaborador (transporte subcontratado)</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                  <div><label style={S.label}>Colaborador / proveedor</label>
                    <div style={{position:"relative",marginBottom:6}}>
                      <input
                        style={S.input}
                        placeholder="Buscar o crear colaborador..."
                        value={colaboradorBusqueda}
                        onChange={e=>{ setColaboradorBusqueda(e.target.value); setShowColaboradorSuggestions(true); }}
                        onFocus={()=>setShowColaboradorSuggestions(true)}
                        onBlur={()=>setTimeout(()=>setShowColaboradorSuggestions(false),200)}
                      />
                      {showColaboradorSuggestions && colaboradorBusqueda && (()=>{
                        const q = colaboradorBusqueda.toLowerCase();
                        const sugs = colaboradoresLocal.filter(c =>
                          String(c.nombre || "").toLowerCase().includes(q) ||
                          String(c.cif || "").toLowerCase().includes(q) ||
                          String(c.email || "").toLowerCase().includes(q)
                        ).slice(0,6);
                        if (!sugs.length) return (
                          <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,zIndex:60,padding:"10px 14px"}}>
                            <div style={{fontSize:12,color:"var(--text4)",marginBottom:8}}>No hay ningun colaborador con ese nombre.</div>
                            <button type="button" disabled={creandoColaborador}
                              onMouseDown={e=>{ e.preventDefault(); crearColaboradorDesdePedido(colaboradorBusqueda); }}
                              style={{...S.btn,background:"var(--accent)",color:"#fff",fontSize:12,padding:"5px 12px",opacity:creandoColaborador ? .7 : 1}}>
                              {creandoColaborador ? "Creando..." : `Crear colaborador "${colaboradorBusqueda}"`}
                            </button>
                          </div>
                        );
                        return (
                          <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,zIndex:60,overflow:"hidden"}}>
                            {sugs.map(c=>(
                              <div key={c.id}
                                onMouseDown={()=>aplicarColaborador(c)}
                                style={{padding:"9px 14px",cursor:"pointer",borderBottom:"1px solid var(--border2)",display:"flex",justifyContent:"space-between",alignItems:"center"}}
                                onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"}
                                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{c.nombre}</span>
                                {c.cif&&<span style={{fontSize:11,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>{c.cif}</span>}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <select value={form.colaborador_id||""} onChange={e=>{
                      const col=colaboradoresLocal.find(c=>c.id===e.target.value);
                      const impActual = importeClienteColCalculado(form) || parseLocaleNumber(form.precio_unitario, 0);
                      setForm(p=>({
                        ...p,
                        colaborador_id: e.target.value,
                        colaborador_nombre: col?.nombre||"",
                        // Siempre sincronizar precio del viaje -> lo que cobramos al colaborador
                        precio_cliente_col: e.target.value ? (impActual || p.precio_cliente_col || "") : "",
                        precio_colaborador: e.target.value ? (importeColaboradorCalculado({ ...p, colaborador_id: e.target.value }) || p.precio_colaborador || "") : "",
                        coste_gasoil: e.target.value ? 0 : p.coste_gasoil,
                      }));
                      setColaboradorBusqueda("");
                    }} style={S.sel}>
                      <option value="">Sin colaborador (chofer propio)</option>
                      {colaboradoresLocal.map(c=><option key={c.id} value={c.id}>{c.nombre} {c.cif?`- ${c.cif}`:""}</option>)}
                    </select>
                  </div>
                  {form.colaborador_id&&(<>
                    <div>
                      <label style={S.label}>
                        Lo que cobramos al cliente (EUR, sin IVA)
                        <span style={{marginLeft:4,fontSize:9,color:"var(--text5)",fontWeight:400,textTransform:"none"}}>
                          - precio del viaje
                        </span>
                      </label>
                      <input type="text" inputMode="decimal" style={S.input}
                        value={form.precio_cliente_col||""}
                        onChange={e=>{
                          const v = e.target.value;
                          setForm(p=>({
                            ...p,
                            precio_cliente_col: v,
                          }));
                        }}
                        placeholder="Ej: 850"/>
                    </div>
                    {form.tipo_precio==="tonelada" ? (<>
                      <div>
                        <label style={S.label}>Precio acordado EUR/tonelada</label>
                        <input type="text" inputMode="decimal" style={S.input}
                          value={form.precio_colaborador_unitario ?? ""}
                          onChange={e=>setForm(p=>syncPrecioColaboradorCalc({...p,precio_colaborador_unitario:e.target.value}))}
                          placeholder="Ej: 32,50"/>
                      </div>
                      <div>
                        <label style={S.label}>Minimo facturable acordado (toneladas)</label>
                        <input type="text" inputMode="decimal" style={S.input}
                          value={form.minimo_colaborador_unidades ?? ""}
                          onChange={e=>setForm(p=>syncPrecioColaboradorCalc({...p,minimo_colaborador_unidades:e.target.value}))}
                          placeholder="Ej: 25,5"/>
                      </div>
                      <div>
                        <label style={S.label}>Total colaborador (EUR)</label>
                        <input type="text" inputMode="decimal" style={{...S.input,background:"var(--bg3)"}} value={form.precio_colaborador ?? ""}
                          onChange={e=>setForm(p=>({...p,precio_colaborador:e.target.value,precio_colaborador_unitario:"",minimo_colaborador_unidades:""}))}
                          placeholder="Ej: 650 (precio cerrado)"/>
                        <div style={{fontSize:10,color:"var(--text5)",marginTop:4}}>
                          Si escribes aqui, se guarda como precio cerrado y se limpian los campos por tonelada.
                        </div>
                      </div>
                    </>) : (
                      <div><label style={S.label}>Lo que pagamos al colaborador (EUR, sin IVA)</label>
                        <input type="text" inputMode="decimal" style={S.input} value={form.precio_colaborador||""} onChange={f("precio_colaborador")} placeholder="Ej: 650"/>
                      </div>
                    )}
                    <div><label style={S.label}>Matricula tractora colaborador</label>
                      <input style={S.input} value={form.matricula_colaborador||""} onChange={e=>setForm(p=>({...p,matricula_colaborador:e.target.value.toUpperCase()}))} placeholder="Ej: 1234-ABC"/>
                    </div>
                    <div><label style={S.label}>Matricula remolque colaborador</label>
                      <input style={S.input} value={form.remolque_matricula_colaborador||""} onChange={e=>setForm(p=>({...p,remolque_matricula_colaborador:e.target.value.toUpperCase()}))} placeholder="Opcional"/>
                    </div>
                    {(form.precio_cliente_col&&form.precio_colaborador)&&(
                      <div style={{gridColumn:"1/-1",display:"flex",gap:16,background:"var(--bg3)",borderRadius:7,padding:"8px 14px",alignItems:"center"}}>
                        <div><span style={{fontSize:11,color:"var(--text5)"}}>Beneficio viaje: </span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:parseLocaleNumber(form.precio_cliente_col)-parseLocaleNumber(form.precio_colaborador)>=0?"var(--green)":"var(--red)"}}>{(parseLocaleNumber(form.precio_cliente_col)-parseLocaleNumber(form.precio_colaborador)).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR</span></div>
                        <div><span style={{fontSize:11,color:"var(--text5)"}}>Margen: </span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"#f59e0b"}}>{parseLocaleNumber(form.precio_cliente_col)>0?((1-parseLocaleNumber(form.precio_colaborador)/parseLocaleNumber(form.precio_cliente_col))*100).toFixed(1):0}%</span></div>
                        {form.tipo_precio==="tonelada" && form.precio_colaborador_unitario && (
                          <div><span style={{fontSize:11,color:"var(--text5)"}}>Pago acordado: </span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"var(--text2)"}}>{parseLocaleNumber(form.precio_colaborador_unitario,0).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR/tn x {unidadesFacturablesPedido(form, form.minimo_colaborador_unidades).toLocaleString("es-ES")} tn</span></div>
                        )}
                        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.25)",borderRadius:6,padding:"4px 10px"}}>
                          <span style={{fontSize:12}}>!</span><span style={{fontSize:11,fontWeight:700,color:"#fbbf24"}}>Pendiente de pago al colaborador</span>
                        </div>
                      </div>
                    )}
                    <div style={{gridColumn:"1/-1",display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",background:"rgba(15,118,110,.08)",border:"1px solid rgba(15,118,110,.22)",borderRadius:8,padding:"9px 12px",flexWrap:"wrap"}}>
                      <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.45}}>
                        Se enviara un enlace para que el colaborador confirme precio y matriculas. Despues recibira enlaces para marcar carga, en camino, descarga y subir albaranes.
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                        <button
                          type="button"
                          disabled={previsualizandoColaborador || !editando?.id}
                          onClick={previsualizarColaborador}
                          style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",opacity:(previsualizandoColaborador || !editando?.id)?0.6:1}}
                        >
                          {previsualizandoColaborador ? "Abriendo..." : "Previsualizar"}
                        </button>
                        <button
                          type="button"
                          disabled={notificandoColaborador || !editando?.id}
                          onClick={()=>notificarColaborador(true)}
                          style={{...S.btn,background:"var(--green)",color:"#fff",opacity:(notificandoColaborador || !editando?.id)?0.6:1}}
                        >
                          {notificandoColaborador ? "Enviando..." : editando?.id ? "Enviar/Reenviar enlace" : "Guarda para enviar"}
                        </button>
                      </div>
                    </div>
                    <div style={{gridColumn:"1/-1",background:"rgba(37,99,235,.07)",border:"1px solid rgba(37,99,235,.2)",borderRadius:8,padding:"10px 12px"}}>
                      <div style={{display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
                        <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.45,flex:"1 1 360px"}}>
                          <strong>Acceso temporal de conductor.</strong> Da acceso solo a este viaje para completar conductor, estados, albaranes y DCD. Caduca al entregar o cancelar el viaje.
                        </div>
                        <button type="button" disabled={generandoAccesoTemporal || !editando?.id} onClick={generarAccesoTemporalColaborador}
                          style={{...S.btn,background:"#2563eb",color:"#fff",opacity:(generandoAccesoTemporal || !editando?.id)?0.6:1}}>
                          {generandoAccesoTemporal ? "Generando..." : editando?.id ? "Generar acceso temporal" : "Guarda para generar"}
                        </button>
                      </div>
                      {accesoTemporalColaborador?.operativa_url&&(
                        <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginTop:10}}>
                          <input readOnly value={accesoTemporalColaborador.operativa_url} onFocus={e=>e.target.select()} style={{...S.input,minWidth:0,flex:"1 1 260px",fontSize:11}} />
                          <button type="button" onClick={copiarAccesoTemporalColaborador} style={{...S.btn,whiteSpace:"nowrap"}}>Copiar</button>
                          <button type="button" onClick={()=>window.open(accesoTemporalColaborador.operativa_url,"_blank","noopener,noreferrer")} style={{...S.btn,whiteSpace:"nowrap"}}>Abrir</button>
                        </div>
                      )}
                    </div>
                    <div style={{gridColumn:"1/-1",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.18)",borderRadius:8,padding:"10px 12px"}}>
                      <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",color:"var(--accent)",marginBottom:4}}>Forma de pago al colaborador</div>
                      <div style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>{formatPaymentTerms(getEmpresaPerfilSync())}</div>
                    </div>
                    <div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                      {[
                        ["Precio y matriculas", form.colaborador_precio_confirmado_at || form.colaborador_precio_confirmado],
                        ["Carga", form.colaborador_carga_confirmada_at],
                        ["En camino", form.colaborador_en_camino_confirmada_at],
                        ["Descarga y albaranes", form.colaborador_descarga_confirmada_at],
                      ].map(([label, done])=>(
                        <div key={label} style={{border:"1px solid "+(done?"rgba(16,185,129,.28)":"var(--border2)"),background:done?"rgba(16,185,129,.08)":"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",color:done?"var(--green)":"var(--text5)"}}>{done?"Confirmado":"Pendiente"}</div>
                          <div style={{fontSize:12,fontWeight:700,color:"var(--text)",marginTop:2}}>{label}</div>
                          {typeof done === "string" && <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>{new Date(done).toLocaleString("es-ES")}</div>}
                        </div>
                      ))}
                    </div>
                  </>)}
                </div>
              </div>

              <div style={{gridColumn:"1/-1"}}><label style={S.label}>Notas / Instrucciones</label>
                <textarea style={{...S.input,height:64,resize:"vertical"}} value={form.notas||""} onChange={f("notas")}/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.label}>
                  Condiciones del encargo
                  <span style={{marginLeft:6,fontSize:9,color:"var(--text5)",fontWeight:400,
                    textTransform:"none",letterSpacing:"normal"}}>
                    - aparecen al pie de la orden de carga
                  </span>
                </label>
                <textarea
                  style={{...S.input,height:72,resize:"vertical",fontSize:12,color:"var(--text3)"}}
                  value={form.condiciones_adicionales||""}
                  onChange={f("condiciones_adicionales")}
                  placeholder="Ej: Mercancia fragil - manipular con precaucion. Temperatura 2-8oC. Firmar albaran en destino y devolver copia..."/>
              </div>
            </div>

            {/* ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Documentos adjuntos ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ */}
            <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid var(--border)"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".06em"}}>Documentacion de la carga</div>
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>CMR, albaranes, fotos, pesajes o instrucciones. Se adjuntan al pedido y a la factura.</div>
                </div>
                {!editando?.id && (
                  <label style={{marginLeft:"auto",padding:"6px 12px",borderRadius:7,background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    Adjuntar antes de crear
                    <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:"none"}} onChange={seleccionarDocsPendientes}/>
                  </label>
                )}
              </div>
              {editando?.id ? (
                <TabDocsPedido pedido={editando}/>
              ) : pendingDocs.length ? (
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {pendingDocs.map((d, idx)=>(
                    <div key={`${d.nombre}-${idx}`} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"var(--bg3)",borderRadius:8,border:"1px solid var(--border)"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.nombre}</div>
                        <div style={{fontSize:10,color:"var(--text5)"}}>{d.tipo} | {d.file_size_kb}KB | se subira al guardar</div>
                      </div>
                      <button type="button" onClick={()=>setPendingDocs(prev=>prev.filter((_, i)=>i!==idx))} style={{background:"none",border:"none",color:"var(--text5)",cursor:"pointer",fontSize:13}}>Quitar</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{padding:"14px 0",fontSize:12,color:"var(--text5)"}}>Sin documentos preparados.</div>
              )}
            </div>

            {editando?.id && <PedidoRentabilidadPredictiva pedido={editando}/>}
            {editando?.id && <PedidoTimeline pedido={editando}/>}

            <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
              <button style={{...S.btn,background:"transparent",color:"var(--text2)",border:"1px solid var(--border2)"}} onClick={requestClose}>Salir</button>
              {!(editando?._readonly && !desvinculado) && (
                <button style={{...S.btn,background:"#3b6ef5",color:"#fff",opacity:saving?0.7:1}} onClick={guardar} disabled={saving}>{saving?"Guardando...":editando?.id?"Guardar cambios":"Crear pedido"}</button>
              )}
            </div>
          </div>
        </div>

      {modalNuevoCliente && (
        <ModalNuevoClienteRapido
          datosIniciales={modalNuevoCliente}
          onClose={()=>setModalNuevoCliente(null)}
          onCreado={async(nuevoCliente)=>{
            const updated = await getClientes("","true");
            const arr = Array.isArray(updated)?updated:(updated?.data||[]);
            setClientes(arr);
            const creado = arr.find(x => x.id === nuevoCliente.id) || arr.find(x=>x.nombre===nuevoCliente.nombre) || nuevoCliente;
            setForm(p=>({
              ...p,
              cliente_id: creado.id || "",
              tipo_iva: creado.tipo_iva ?? p.tipo_iva ?? 21,
              iva_regimen: creado.iva_regimen || ivaOptionValue({ tipo_iva: creado.tipo_iva ?? p.tipo_iva }),
            }));
            setNombreBusqueda(nuevoCliente.nombre||"");
            setModalNuevoCliente(null);
          }}
        />
      )}
      {poiDraft && (
        <PuntoInteresModal
          initial={poiDraft}
          onClose={()=>setPoiDraft(null)}
          onSave={(next, saved)=>{
            if (saved.tipo === "carga") {
              if (saved.cliente_id && String(saved.cliente_id) === String(form.cliente_id || "")) {
                setPuntosCargaClienteModal(prev => {
                  const exists = prev.some(p => String(p.id) === String(saved.id));
                  return exists ? prev.map(p => String(p.id) === String(saved.id) ? saved : p) : [...prev, saved];
                });
              }
              setForm(p=>({
                ...applyPuntoCargaToDraft(p, saved),
              }));
            } else if (saved.tipo === "descarga") {
              setForm(p=>({
                ...p,
                destino:(saved.nombre || saved.direccion || p.destino || "").toUpperCase(),
                puntos_descarga: updatePrimaryStop(
                  p.puntos_descarga,
                  puntoToStop(saved),
                  (saved.nombre || saved.direccion || p.destino || "").toUpperCase()
                ),
                ventana_descarga:p.ventana_descarga || saved.ventana || ""
              }));
            }
          }}
        />
      )}
      {managePointsOpen && (
        <GestionPuntosInteresModal
          onClose={()=>setManagePointsOpen(false)}
          onApply={(next)=>setPuntosInteresCache(next)}
          clienteId={form.cliente_id}
          modo={managePointsMode}
          onSelectPoint={(point)=>{
            setForm(prev => managePointsMode === "descarga"
              ? applyPuntoDescargaToDraft(prev, point)
              : applyPuntoCargaToDraft(prev, point)
            );
            if (managePointsMode === "carga" && point?.cliente_id && String(point.cliente_id) === String(form.cliente_id || "")) {
              setPuntosCargaClienteModal(prev => prev.some(p => String(p.id) === String(point.id))
                ? prev.map(p => String(p.id) === String(point.id) ? point : p)
                : [...prev, point]
              );
            }
            setManagePointsOpen(false);
          }}
        />
      )}
    </>
  );
}


// ---------------------------------------------------------------------------
// CartaPorteModal - Genera y muestra la Carta de Porte / CMR / Albaran
// ---------------------------------------------------------------------------
function CartaPorteModal({ data, onClose }) {
  const docNumero = data.carta_porte_numero || data.numero || "";
  const pedidoNumero = data.pedido_numero || data.numero || "";
  const cargaPrincipalGeo = parseStops(data.puntos_carga)[0] || {};
  const descargaPrincipalGeo = parseStops(data.puntos_descarga)[0] || {};
  const cmrTipo = data.cmr_tipo || cmrTypeForPedidoStops(data);
  const isCmrInternacional = cmrTipo === "internacional";
  const documentoTitulo = isCmrInternacional ? "CMR Internacional" : "Carta de Porte";
  const origenGeo = [stopRegion(cargaPrincipalGeo, data.origen_provincia || ""), stopCountry(cargaPrincipalGeo, data.origen_pais || "España")].filter(Boolean).join(", ");
  const destinoGeo = [stopRegion(descargaPrincipalGeo, data.destino_provincia || ""), stopCountry(descargaPrincipalGeo, data.destino_pais || "España")].filter(Boolean).join(", ");
  const origenPostalGeo = stopPostalLine(cargaPrincipalGeo, data.origen_provincia || "", data.origen_pais || "España");
  const destinoPostalGeo = stopPostalLine(descargaPrincipalGeo, data.destino_provincia || "", data.destino_pais || "España");
  const documentosAnexos = Array.isArray(data.documentos_anexos) ? data.documentos_anexos : [];
  const anexosConArchivo = documentosAnexos.filter(a => a?.data_url || a?.pdf_adjunto || a?.mime);
  const [firmaMode, setFirmaMode] = React.useState(null); // null | 'remitente' | 'destinatario' | 'chofer'
  const [firmas, setFirmas] = React.useState({
    remitente:    data.firma_cargador || null,
    destinatario: data.firma_destinatario || null,
    chofer:       data.firma_chofer || null,
  });
  const [firmaNombre, setFirmaNombre] = React.useState('');
  const [guardandoFirma, setGuardandoFirma] = React.useState(false);
  const canvasRef = React.useRef(null);
  const drawing   = React.useRef(false);
  const lastPt    = React.useRef(null);

  function canvasPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches?.[0] || e;
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width),
             y: (src.clientY - rect.top)  * (canvas.height / rect.height) };
  }
  function startDraw(e)  { e.preventDefault(); drawing.current=true; lastPt.current=canvasPos(e,canvasRef.current); }
  function moveDraw(e) {
    e.preventDefault(); if(!drawing.current) return;
    const ctx=canvasRef.current.getContext('2d'); const pt=canvasPos(e,canvasRef.current);
    ctx.beginPath(); ctx.strokeStyle='#111'; ctx.lineWidth=2; ctx.lineCap='round';
    ctx.moveTo(lastPt.current.x,lastPt.current.y); ctx.lineTo(pt.x,pt.y); ctx.stroke();
    lastPt.current=pt;
  }
  function endDraw() { drawing.current=false; }
  function clearCanvas() {
    const c=canvasRef.current; c.getContext('2d').clearRect(0,0,c.width,c.height);
  }

  async function confirmarFirma() {
    const canvas = canvasRef.current;
    // Check if canvas has any drawing
    const blank = document.createElement('canvas');
    blank.width=canvas.width; blank.height=canvas.height;
    if (canvas.toDataURL() === blank.toDataURL()) {
      notify("Por favor firma en el recuadro antes de confirmar", "warning"); return;
    }
    const imgData = canvas.toDataURL('image/png');
    setFirmas(prev => ({ ...prev, [firmaMode]: imgData }));

    setGuardandoFirma(true);
    try {
      await guardarFirmaEntrega(data.id, {
        rol: firmaMode === "remitente" ? "cargador" : firmaMode,
        firma_destinatario: imgData,
        firma_nombre: firmaNombre || (firmaMode === "remitente" ? "Cargador" : firmaMode === "chofer" ? "Chofer" : "Destinatario"),
        source: "carta_porte",
      });
      notify("Firma guardada en el DCD.", "success");
    } catch(e) {
      console.warn('Firma no guardada:', e.message);
      notify("No se pudo guardar la firma en el servidor.", "warning");
    } finally {
      setGuardandoFirma(false);
    }
    setFirmaMode(null);
  }

  function imprimir() {
    const win = window.open("","_blank","width=900,height=700");
    win.document.write(generarHTML());
    win.document.close();
    win.focus();
    setTimeout(()=>{ win.print(); }, 500);
  }

  function generarHTML() {
    const d = data;
    const anexosHtml = anexosConArchivo.length ? `
<div class="page-break"></div>
<h1>Anexos de la carta de porte / DCD</h1>
<div style="font-size:10px;color:#555;text-align:center;margin-bottom:12px">
  Albaranes, POD o CMR subidos al viaje una vez firmados.
</div>
${anexosConArchivo.map((a, idx) => `
  <div class="box anexo-box">
    <h2>Anexo ${idx + 1}: ${a.etiqueta || a.tipo || "Documento adjunto"}</h2>
    <div class="grid3" style="margin-bottom:8px">
      <div><div class="lbl">Nombre</div><div class="val">${a.nombre || "-"}</div></div>
      <div><div class="lbl">Tipo</div><div class="val">${a.tipo || "-"}</div></div>
      <div><div class="lbl">Fecha subida</div><div class="val">${a.created_at ? new Date(a.created_at).toLocaleString("es-ES") : "-"}</div></div>
    </div>
    ${a.data_url
      ? `<img src="${a.data_url}" class="anexo-img" alt="${a.nombre || "Anexo"}"/>`
      : `<div class="anexo-pdf">PDF adjunto al expediente DCD: ${a.nombre || "Documento"}${a.size_kb ? ` (${a.size_kb} KB)` : ""}</div>`}
  </div>
`).join("")}` : "";
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>${documentoTitulo} - ${docNumero}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#111;padding:20px}
  h1{font-size:16px;font-weight:700;text-align:center;letter-spacing:1px;margin-bottom:4px}
  h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;color:#1e3a5f;border-bottom:1px solid #1e3a5f;padding-bottom:3px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1e3a5f}
  .empresa{flex:1}
  .doc-info{text-align:right;min-width:180px}
  .doc-num{font-size:20px;font-weight:700;color:#1e3a5f}
  .doc-label{font-size:9px;color:#666;letter-spacing:1px;text-transform:uppercase}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px}
  .box{border:1px solid #ccc;border-radius:4px;padding:10px}
  .lbl{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
  .val{font-size:11px;font-weight:600}
  .val-big{font-size:14px;font-weight:700;color:#1e3a5f}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
  td{padding:6px 8px;border-bottom:1px solid #eee;font-size:11px}
  .firma-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:20px}
  .firma-box{border:1px solid #ccc;border-radius:4px;padding:10px;min-height:80px}
  .firma-label{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .firma-line{margin-top:50px;border-top:1px solid #999;font-size:9px;color:#666;padding-top:3px}
  .status{display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700}
  .badge-ok{background:#d1fae5;color:#065f46}
  .badge-warn{background:#fef3c7;color:#92400e}
  .cmr-note{border-color:#0f766e;background:#f0fdfa;margin-bottom:12px}
  .cmr-note h2{color:#0f766e;border-bottom-color:#0f766e}
  .page-break{break-before:page;page-break-before:always}
  .anexo-box{margin-bottom:14px;break-inside:avoid;page-break-inside:avoid}
  .anexo-img{display:block;max-width:100%;max-height:920px;margin:10px auto 0;border:1px solid #ddd;object-fit:contain}
  .anexo-pdf{border:1px dashed #999;border-radius:4px;padding:14px;background:#f8fafc;color:#334155;font-size:12px}
  @media print{@page{margin:1cm}body{padding:0}}
</style></head><body>
<div class="header">
  <div class="empresa">
    <div style="font-size:18px;font-weight:700;color:#1e3a5f">${d.empresa_nombre||"-"}</div>
    <div style="color:#555">CIF: ${d.empresa_cif||"-"} - ${d.empresa_direccion||""} - Tel: ${d.empresa_telefono||"-"}</div>
    <div style="color:#555">${d.empresa_email||""}</div>
  </div>
  <div class="doc-info">
    <div class="doc-label">${documentoTitulo}</div>
    <div class="doc-num">${docNumero||"-"}</div>
    <div style="font-size:10px;color:#555;margin-top:4px">Pedido: ${pedidoNumero||"-"}</div>
    <div style="font-size:10px;color:#555;margin-top:4px">Fecha: ${new Date().toLocaleDateString("es-ES")}</div>
    <div style="margin-top:6px">
      <span class="status ${["entregado","facturado"].includes(d.estado)?"badge-ok":"badge-warn"}">${(d.estado||"").toUpperCase()}</span>
    </div>
  </div>
</div>

${isCmrInternacional ? `<div class="box cmr-note">
  <h2>CMR internacional</h2>
  <div class="grid3" style="margin-bottom:0">
    <div><div class="lbl">CP / poblacion / provincia carga</div><div class="val">${origenPostalGeo || origenGeo || "-"}</div></div>
    <div><div class="lbl">CP / poblacion / provincia entrega</div><div class="val">${destinoPostalGeo || destinoGeo || "-"}</div></div>
    <div><div class="lbl">Regimen</div><div class="val">Transporte internacional por carretera sujeto al Convenio CMR cuando proceda</div></div>
  </div>
  <div style="margin-top:8px;font-size:10px;color:#134e4a">
    Verifica remitente, transportista, destinatario, lugar y fecha de toma de mercancia, lugar de entrega, descripcion, bultos, marcas/numeros, peso/cantidad, gastos, instrucciones y documentos entregados.
  </div>
</div>` : ""}

<div class="grid2">
  <div class="box">
    <h2>Transportista (Porteador)</h2>
    <div class="lbl">Empresa</div><div class="val">${d.empresa_nombre||"-"}</div>
    <div class="lbl" style="margin-top:6px">CIF</div><div class="val">${d.empresa_cif||"-"}</div>
    <div class="lbl" style="margin-top:6px">Direccion</div><div class="val">${d.empresa_direccion||"-"}</div>
    <div class="lbl" style="margin-top:6px">Telefono / Email</div>
    <div class="val">${d.empresa_telefono||"-"} - ${d.empresa_email||"-"}</div>
  </div>
  <div class="box">
    <h2>Remitente / Cliente</h2>
    <div class="lbl">Empresa / Persona</div><div class="val">${d.cliente_nombre||"-"}</div>
    <div class="lbl" style="margin-top:6px">CIF / NIF</div><div class="val">${d.cliente_cif||"-"}</div>
    <div class="lbl" style="margin-top:6px">Direccion</div><div class="val">${d.cliente_dir||d.cliente_ciudad||"-"}</div>
    <div class="lbl" style="margin-top:6px">Telefono / Email</div>
    <div class="val">${d.cliente_tel||"-"} - ${d.cliente_email||"-"}</div>
  </div>
</div>

<div class="grid2">
  <div class="box">
    <h2>Origen (Carga)</h2>
    <div class="val-big">${d.origen||"-"}</div>
    <div class="lbl" style="margin-top:6px">Pais / provincia</div>
    <div class="val">${origenGeo || "-"}</div>
    <div class="lbl" style="margin-top:6px">Codigo postal / poblacion / provincia</div>
    <div class="val">${origenPostalGeo || "-"}</div>
    <div class="lbl" style="margin-top:8px">Fecha de carga</div>
    <div class="val">${new Date(d.fecha_carga||Date.now()).toLocaleDateString("es-ES")}${d.hora_carga?" - "+d.hora_carga:""}</div>
    ${d.ventana_carga?`<div class="lbl" style="margin-top:4px">Ventana horaria</div><div class="val">${d.ventana_carga}</div>`:""}
    ${d.referencia_cliente?`<div class="lbl" style="margin-top:4px">Ref. cliente</div><div class="val">${d.referencia_cliente}</div>`:""}
  </div>
  <div class="box">
    <h2>Destino (Descarga)</h2>
    <div class="val-big">${d.destino||"-"}</div>
    <div class="lbl" style="margin-top:6px">Pais / provincia</div>
    <div class="val">${destinoGeo || "-"}</div>
    <div class="lbl" style="margin-top:6px">Codigo postal / poblacion / provincia</div>
    <div class="val">${destinoPostalGeo || "-"}</div>
    <div class="lbl" style="margin-top:8px">Fecha de entrega</div>
    <div class="val">${d.fecha_entrega?new Date(d.fecha_entrega).toLocaleDateString("es-ES"):"-"}${d.hora_descarga?" - "+d.hora_descarga:""}</div>
    ${d.ventana_descarga?`<div class="lbl" style="margin-top:4px">Ventana horaria</div><div class="val">${d.ventana_descarga}</div>`:""}
  </div>
</div>

<h2>Mercancia</h2>
<table>
  <thead><tr>
    <th style="width:40%">Descripcion</th><th>Bultos</th><th>Peso (kg)</th>
    <th>Volumen (m3)</th><th>Tipo carga</th><th>Valor</th>
  </tr></thead>
  <tbody><tr>
    <td>${d.mercancia||"-"}</td>
    <td>${d.bultos||"-"}</td>
    <td>${d.peso_kg?Number(d.peso_kg).toLocaleString("es-ES")+" kg":"-"}</td>
    <td>${d.volumen||"-"}</td>
    <td>${d.tipo_carga||"-"}</td>
    <td>${d.importe?Number(d.importe).toLocaleString("es-ES",{minimumFractionDigits:2})+" EUR":"-"}</td>
  </tr></tbody>
</table>

${isCmrInternacional ? `<div class="grid2">
  <div class="box">
    <h2>Documentos / Aduanas</h2>
    <div class="lbl">Documentos entregados al transportista</div>
    <div class="val">${d.documentos_aduaneros || d.condiciones_adicionales || "-"}</div>
    <div class="lbl" style="margin-top:6px">Instrucciones del remitente</div>
    <div class="val">${d.instrucciones_aduaneras || d.notas || "-"}</div>
  </div>
  <div class="box">
    <h2>Reservas y gastos</h2>
    <div class="lbl">Reservas del transportista</div>
    <div class="val">${d.reservas_transportista || "-"}</div>
    <div class="lbl" style="margin-top:6px">Gastos / porte</div>
    <div class="val">${d.importe?Number(d.importe).toLocaleString("es-ES",{minimumFractionDigits:2})+" EUR":"-"}</div>
  </div>
</div>` : ""}

<div class="grid3">
  <div class="box">
    <h2>Vehiculo Tractor</h2>
    <div class="val-big">${d.veh_matricula||"-"}</div>
    <div class="val" style="color:#555">${[d.veh_marca,d.veh_modelo].filter(Boolean).join(" ")||""}</div>
  </div>
  <div class="box">
    <h2>Remolque / Semirremolque</h2>
    <div class="val-big">${d.rem_matricula||"-"}</div>
  </div>
  <div class="box">
    <h2>Chofer</h2>
    <div class="val-big">${[d.chofer_nombre,d.chofer_apellidos].filter(Boolean).join(" ")||"-"}</div>
    ${d.chofer_dni?`<div class="lbl" style="margin-top:4px">DNI/NIE</div><div class="val">${d.chofer_dni}</div>`:""}
    ${d.chofer_tel?`<div class="lbl" style="margin-top:4px">Telefono</div><div class="val">${d.chofer_tel}</div>`:""}
  </div>
</div>

${d.notas?`<div class="box" style="margin-bottom:12px"><h2>Observaciones</h2><div style="white-space:pre-line">${d.notas}</div></div>`:""}

<div class="firma-row">
  <div class="firma-box">
    <div class="firma-label">Firma Remitente</div>
    ${firmas.remitente
      ? `<img src="${firmas.remitente}" style="max-width:100%;max-height:60px;margin-top:4px"/>`
      : `<div class="firma-line">Nombre y sello</div>`}
  </div>
  <div class="firma-box">
    <div class="firma-label">Firma Chofer / Transportista</div>
    ${firmas.chofer
      ? `<img src="${firmas.chofer}" style="max-width:100%;max-height:60px;margin-top:4px"/>`
      : `<div class="firma-line">Nombre y sello</div>`}
  </div>
  <div class="firma-box">
    <div class="firma-label">Firma Destinatario</div>
    ${firmas.destinatario
      ? `<img src="${firmas.destinatario}" style="max-width:100%;max-height:60px;margin-top:4px"/>
         <div style="font-size:9px;color:#555;margin-top:3px">${firmaNombre||""}</div>
         <div style="font-size:9px;color:#555;">Fecha: ${new Date().toLocaleDateString("es-ES")}</div>`
      : `<div class="firma-line">Nombre, sello y fecha de recepcion</div>`}
  </div>
</div>

<div style="text-align:center;margin-top:16px;font-size:9px;color:#999;border-top:1px solid #eee;padding-top:8px">
  Documento generado por TransGest TMS - ${new Date().toLocaleString("es-ES")}
</div>
${anexosHtml}
</body></html>`;
  }

  const O = {
    overlay: {position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:9000,
      display:"flex",alignItems:"center",justifyContent:"center"},
    modal: {background:"var(--bg2)",borderRadius:14,width:"min(900px,96vw)",maxHeight:"90vh",
      display:"flex",flexDirection:"column",border:"1px solid var(--border2)"},
    header: {display:"flex",justifyContent:"space-between",alignItems:"center",
      padding:"16px 20px",borderBottom:"1px solid var(--border2)"},
    body: {overflowY:"auto",flex:1,padding:"20px"},
    footer: {padding:"14px 20px",borderTop:"1px solid var(--border2)",
      display:"flex",gap:10,justifyContent:"flex-end"},
    btn: {padding:"8px 18px",borderRadius:8,border:"none",cursor:"pointer",
      fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"},
  };

  const d = data;
  const fmt2 = v => v ? Number(v).toLocaleString("es-ES",{minimumFractionDigits:2})+" EUR" : "-";
  const fmtD = v => v ? new Date(v).toLocaleDateString("es-ES") : "-";

  return (
    <div style={O.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={O.modal}>
        <div style={O.header}>
          <div>
            <div style={{fontWeight:800,fontSize:16,color:"var(--text)"}}>{documentoTitulo} - {docNumero}</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:2}}>
              Pedido {pedidoNumero} · {d.origen} -> {d.destino} · {fmtD(d.fecha_carga)}
            </div>
          </div>
          <button onClick={onClose} style={{...O.btn,background:"var(--bg4)",color:"var(--text3)",padding:"6px 12px"}}>Cerrar</button>
        </div>

        <div style={O.body}>
          {isCmrInternacional && (
            <div style={{background:"rgba(20,184,166,.08)",border:"1px solid rgba(20,184,166,.24)",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:800,color:"#0f766e"}}>CMR internacional</div>
              <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>
                Se genera como transporte internacional porque el pais de carga o descarga no es España. Revisa documentos aduaneros e instrucciones antes de imprimir o firmar.
              </div>
            </div>
          )}
          {/* Preview compacto */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
            {[
              {l:"Transportista", v:d.empresa_nombre||"-"},
              {l:"Cliente / Remitente", v:d.cliente_nombre||"-"},
              {l:"Origen", v:d.origen||"-"},
              {l:"Destino", v:d.destino||"-"},
              {l:"Pais / provincia carga", v:origenGeo || "-"},
              {l:"Pais / provincia descarga", v:destinoGeo || "-"},
              {l:"CP / poblacion carga", v:origenPostalGeo || "-"},
              {l:"CP / poblacion descarga", v:destinoPostalGeo || "-"},
              {l:"Fecha carga", v:fmtD(d.fecha_carga)},
              {l:"Fecha entrega", v:fmtD(d.fecha_entrega)},
              {l:"Vehiculo", v:[d.veh_matricula,d.veh_marca,d.veh_modelo].filter(Boolean).join(" ")||"-"},
              {l:"Remolque", v:d.rem_matricula||"-"},
              {l:"Chofer", v:[d.chofer_nombre,d.chofer_apellidos].filter(Boolean).join(" ")||"-"},
              {l:"Mercancia", v:d.mercancia||"-"},
              {l:"Peso / Bultos", v:`${d.peso_kg?Number(d.peso_kg).toLocaleString("es-ES")+" kg":"-"} - ${d.bultos||"-"} bultos`},
              {l:"Importe", v:fmt2(d.importe)},
            ].map(({l,v})=>(
              <div key={l} style={{background:"var(--bg3)",borderRadius:8,padding:"10px 14px"}}>
                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3}}>{l}</div>
                <div style={{fontSize:12,fontWeight:600,color:"var(--text)"}}>{v}</div>
              </div>
            ))}
          </div>
          {d.notas&&(
            <div style={{background:"var(--bg3)",borderRadius:8,padding:"10px 14px",marginBottom:8}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",color:"var(--text5)",marginBottom:4}}>Observaciones</div>
              <div style={{fontSize:12,color:"var(--text2)",whiteSpace:"pre-line"}}>{d.notas}</div>
            </div>
          )}
          {anexosConArchivo.length > 0 && (
            <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 14px",marginBottom:8}}>
              <div style={{fontSize:9,fontWeight:800,textTransform:"uppercase",color:"var(--text5)",marginBottom:8}}>Anexos firmados adjuntos</div>
              <div style={{display:"grid",gap:6}}>
                {anexosConArchivo.map((a, idx) => (
                  <div key={a.id || `${a.nombre}-${idx}`} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center",fontSize:12,color:"var(--text2)"}}>
                    <span style={{fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.nombre || `Anexo ${idx + 1}`}</span>
                    <span style={{fontSize:10,color:a.data_url ? "#10b981" : "var(--text5)",fontWeight:800}}>{a.data_url ? "Imagen embebida" : "PDF adjunto"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{fontSize:11,color:"var(--text4)",textAlign:"center",marginTop:8}}>
            Al imprimir se generara el documento completo con campos de firma para remitente, chofer y destinatario.
          </div>
        </div>

        {/* Firma mode: canvas pad */}
        {firmaMode && (
          <div style={{padding:"16px 20px",borderTop:"1px solid var(--border2)",background:"var(--bg3)"}}>
            <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:8}}>
              Firma de {firmaMode==="destinatario"?"Destinatario":firmaMode==="remitente"?"Remitente":"Chofer"}
            </div>
            <input
              value={firmaNombre} onChange={e=>setFirmaNombre(e.target.value)}
              placeholder="Nombre completo del firmante"
              style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid var(--border3)",
                background:"var(--bg4)",color:"var(--text)",fontFamily:"'DM Sans',sans-serif",
                fontSize:12,marginBottom:8}}
            />
            <div style={{background:"#fff",borderRadius:8,border:"2px solid var(--border3)",overflow:"hidden",touchAction:"none"}}>
              <canvas ref={canvasRef} width={560} height={140}
                style={{width:"100%",height:140,display:"block",cursor:"crosshair"}}
                onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={endDraw}
              />
            </div>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button onClick={clearCanvas}
                style={{...O.btn,background:"var(--bg4)",color:"var(--text3)",border:"1px solid var(--border2)",flex:1}}>
                Borrar
              </button>
              <button onClick={()=>setFirmaMode(null)}
                style={{...O.btn,background:"var(--bg4)",color:"var(--text3)",border:"1px solid var(--border2)",flex:1}}>
                Cancelar
              </button>
              <button onClick={confirmarFirma} disabled={guardandoFirma}
                style={{...O.btn,background:"#10b981",color:"#fff",flex:2}}>
                {guardandoFirma?"Guardando...":"Confirmar firma"}
              </button>
            </div>
          </div>
        )}

        {/* Signature status row */}
        {!firmaMode && (
          <div style={{padding:"12px 20px",borderTop:"1px solid var(--border2)",
            display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:11,color:"var(--text4)",marginRight:4}}>Firmas digitales:</span>
            {[
              {k:"remitente",    l:"Remitente"},
              {k:"destinatario", l:"Destinatario"},
              {k:"chofer",       l:"Chofer"},
            ].map(({k,l})=>(
              <button key={k} onClick={()=>{ setFirmaMode(k); setFirmaNombre(''); clearCanvas && canvasRef.current && canvasRef.current.getContext('2d').clearRect(0,0,560,140); }}
                style={{padding:"4px 10px",borderRadius:6,border:"1px solid var(--border2)",
                  background: firmas[k] ? "rgba(16,185,129,.15)" : "var(--bg4)",
                  color: firmas[k] ? "var(--green)" : "var(--text3)",
                  fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                {firmas[k] ? "OK" : "Pendiente"} {l}
              </button>
            ))}
          </div>
        )}

        <div style={O.footer}>
          <button onClick={onClose}
            style={{...O.btn,background:"var(--bg4)",color:"var(--text3)",border:"1px solid var(--border2)"}}>
            Cerrar
          </button>
          <button onClick={imprimir}
            style={{...O.btn,background:"#f59e0b",color:"#fff"}}>
            Imprimir / Guardar PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function readPedidosFocus() {
  return readRuntimeFocus("tms_pedidos_focus");
}

function buildPedidoDraftFromTrafficFocus(focus = {}, vehiculos = [], choferes = []) {
  const defaults = focus?.defaults || {};
  const vehiculoId = defaults.vehiculo_id || "";
  const vehiculo = vehiculos.find(v => String(v.id || "") === String(vehiculoId));
  const chofer = choferes.find(c =>
    String(c.id || "") === String(defaults.chofer_id || "") ||
    String(c.id || "") === String(vehiculo?.chofer_id || "") ||
    String(c.vehiculo_id || "") === String(vehiculo?.id || "") ||
    String(c.matricula || "").toUpperCase() === String(vehiculo?.matricula || "").toUpperCase()
  );
  const fechaCarga = toDateInputValue(defaults.fecha_carga) || "";
  const fechaDescarga = toDateInputValue(defaults.fecha_descarga || fechaCarga) || fechaCarga;
  const remolqueId = defaults.remolque_id || vehiculo?.remolque_id || "";

  return withPedidoGeoDefaults({
    estado: "pendiente",
    tipo_precio: "viaje",
    fecha_pedido: toDateInputValue(defaults.fecha_pedido) || new Date().toISOString().slice(0, 10),
    fecha_carga: fechaCarga,
    fecha_descarga: fechaDescarga,
    vehiculo_id: vehiculoId,
    chofer_id: defaults.chofer_id || chofer?.id || "",
    remolque_id: remolqueId,
    remolque_id_manual: remolqueId,
    tipo_iva: 21,
    iva_regimen: "general",
    carga_lateral: true,
    carga_trasera: false,
    intercambio_palets: false,
    requiere_cinchas: true,
    pendiente_completar: true,
    aviso_completar: "Pedido iniciado desde Gestion de trafico: completar cliente, ruta, precio y documentacion.",
    _focus_asignacion: true,
    _nuevo_desde_trafico: true,
  });
}

function readGuidedPedidoTutorial() {
  const focus = readRuntimeFocus("tms_guided_tutorial");
  return focus?.type === "pedido_create" ? focus : null;
}

function buildGuidedPedidoProgress(form = {}, meta = {}) {
  const precio = parseLocaleNumber(form.precio_unitario || form.importe_minimo || form.precio_cliente_col || form.importe, 0);
  return {
    modal: !!meta.modalOpened,
    cliente: !!form.cliente_id,
    ruta: !!String(form.origen || "").trim() && !!String(form.destino || "").trim(),
    fechas: !!form.fecha_carga && !!form.fecha_descarga,
    precio: precio > 0 || !!String(form.precio_unitario || form.importe_minimo || "").trim(),
    asignacion: !!(form.colaborador_id || form.vehiculo_id || form.chofer_id || form.matricula_colaborador),
    guardado: !!meta.saved,
  };
}

const GUIDED_PEDIDO_STEPS = [
  { key:"modal", title:"Abre un pedido nuevo", detail:"Pulsa el boton para abrir el formulario de alta." },
  { key:"cliente", title:"Selecciona o crea el cliente", detail:"El pedido no puede guardarse sin cliente." },
  { key:"ruta", title:"Completa origen y destino", detail:"Indica punto de carga y entrega o usa puntos guardados." },
  { key:"fechas", title:"Marca carga y descarga", detail:"Fecha de carga y fecha de descarga dejan el viaje planificado." },
  { key:"precio", title:"Introduce el precio", detail:"Pon precio del viaje, toneladas, km o tarifa aplicable." },
  { key:"asignacion", title:"Asigna recurso", detail:"Elige vehiculo/chofer o colaborador subcontratado." },
  { key:"guardado", title:"Guarda el pedido", detail:"Al guardar se completa la mision y el pedido queda creado." },
];

function GuidedPedidoTutorialPanel({ active, progress, onStart, onClose }) {
  if (!active) return null;
  const doneCount = GUIDED_PEDIDO_STEPS.filter(step => progress?.[step.key]).length;
  const current = GUIDED_PEDIDO_STEPS.find(step => !progress?.[step.key]) || GUIDED_PEDIDO_STEPS[GUIDED_PEDIDO_STEPS.length - 1];
  const complete = doneCount === GUIDED_PEDIDO_STEPS.length;
  return (
    <div style={{position:"fixed",right:18,bottom:18,zIndex:520,width:"min(380px,calc(100vw - 36px))",background:"var(--bg2)",border:"1px solid rgba(20,184,166,.35)",borderRadius:10,boxShadow:"0 20px 55px rgba(0,0,0,.28)",padding:14,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
        <div style={{width:34,height:34,borderRadius:9,background:complete?"rgba(16,185,129,.16)":"rgba(20,184,166,.14)",color:complete?"#10b981":"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900}}>
          {complete ? "OK" : doneCount + 1}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--accent-xl)"}}>Tutorial interactivo</div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:900,color:"var(--text)",marginTop:2}}>Mision: crear pedido</div>
          <div style={{fontSize:11,color:"var(--text5)",fontWeight:800,marginTop:3}}>{doneCount}/{GUIDED_PEDIDO_STEPS.length} pasos completados</div>
        </div>
        <button type="button" onClick={onClose} title="Cerrar tutorial" style={{border:"none",background:"transparent",color:"var(--text5)",fontSize:18,fontWeight:900,cursor:"pointer",lineHeight:1}}>x</button>
      </div>
      <div style={{height:5,background:"var(--bg4)",borderRadius:999,overflow:"hidden",margin:"12px 0"}}>
        <div style={{height:"100%",width:`${Math.round((doneCount / GUIDED_PEDIDO_STEPS.length) * 100)}%`,background:complete?"#10b981":"var(--accent)",transition:"width .25s ease"}} />
      </div>
      <div style={{border:"1px solid var(--border)",background:"var(--bg)",borderRadius:8,padding:"10px 11px",marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:900,color:complete?"#10b981":"var(--text)"}}>{complete ? "Pedido creado. Mision completada." : current.title}</div>
        <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.45,marginTop:3}}>{complete ? "Ya puedes seguir trabajando o crear otro pedido cuando quieras." : current.detail}</div>
      </div>
      <div style={{display:"grid",gap:6,maxHeight:220,overflowY:"auto",paddingRight:2}}>
        {GUIDED_PEDIDO_STEPS.map(step => {
          const done = !!progress?.[step.key];
          const isCurrent = step.key === current.key && !complete;
          return (
            <div key={step.key} style={{display:"flex",gap:8,alignItems:"center",padding:"7px 8px",borderRadius:7,border:`1px solid ${isCurrent ? "rgba(20,184,166,.32)" : "var(--border)"}`,background:isCurrent ? "rgba(20,184,166,.08)" : "transparent"}}>
              <span style={{width:18,height:18,borderRadius:999,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,background:done?"rgba(16,185,129,.16)":"var(--bg4)",color:done?"#10b981":"var(--text5)"}}>{done ? "✓" : ""}</span>
              <span style={{fontSize:11,fontWeight:850,color:done?"#10b981":"var(--text3)"}}>{step.title}</span>
            </div>
          );
        })}
      </div>
      {!progress?.modal && (
        <button type="button" onClick={onStart} style={{marginTop:12,width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid var(--accent)",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:900,cursor:"pointer"}}>
          Empezar pedido guiado
        </button>
      )}
      {complete && (
        <button type="button" onClick={onClose} style={{marginTop:12,width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid rgba(16,185,129,.28)",background:"rgba(16,185,129,.12)",color:"#10b981",fontSize:12,fontWeight:900,cursor:"pointer"}}>
          Cerrar mision
        </button>
      )}
    </div>
  );
}

function openPedidoInTrafico(pedido) {
  if (!pedido?.id || typeof window === "undefined") return;
  setRuntimeFocus("tms_trafico_focus", {
    pedido_id: pedido.id,
    numero: pedido.numero || "",
    fecha_carga: toDateInputValue(pedido.fecha_carga),
    source: "pedidos",
  });
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: "gestion_trafico" }));
}

export default function Pedidos() {
  useEmpresaPerfil();
  const { puedeEditar, user } = useAuth();
  const canEdit = puedeEditar("pedidos");
  const canFacturarPedidos = ["gerente","contable","contabilidad","administrativo","administracion","admin","superadmin"]
    .includes(String(user?.rol || "").toLowerCase());
  const empresaPlan = getEmpresaPlanLocal();
  const aiVisualPlanActivo = planHasFeature(empresaPlan, "ai");
  const aiDisponible = planHasFeature(empresaPlan, "ai");
  const [focusPedido] = useState(() => readPedidosFocus());
  const focusNuevoAplicadoRef = useRef(false);
  const [guidedPedido, setGuidedPedido] = useState(() => {
    const focus = readGuidedPedidoTutorial();
    return focus ? { active:true, modalOpened:false, saved:false, progress:buildGuidedPedidoProgress({}, { modalOpened:false, saved:false }) } : null;
  });
  const [pedidos,    setPedidos]    = useState([]);
  const [clientes,   setClientes]   = useState([]);
  const [vehiculos,  setVehiculos]  = useState([]);
  const [choferes,   setChoferes]   = useState([]);
  const [rutas,      setRutas]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState("");
  const _rangoSemanaActual = currentWeekRangeLocal();
  const [filtroEst,  setFiltroEst]  = useState(() => (focusPedido?.source && focusPedido?.estado && !focusPedido?.pedido_id) ? String(focusPedido.estado) : "todos");
  const [filtroMes,  setFiltroMes]  = useState("");
  const [filtroFechasCustom, setFiltroFechasCustom] = useState(false);
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [filtroCliente,setFiltroCliente]=useState("");
  const [q,          setQ]          = useState(() => focusPedido?.pedido_id ? (focusPedido?.numero || "") : "");
  const [soloCriticos, setSoloCriticos] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filtroSinAsignacion, setFiltroSinAsignacion] = useState(false);
  const [filtroPendienteCompletar, setFiltroPendienteCompletar] = useState(false);
  const [filtroColaborador, setFiltroColaborador] = useState(false);
  const [groupByCliente, setGroupByCliente] = useState(() => loadPedidosGroupByClient(user));
  const groupByClienteKey = pedidosGroupByClientKey(user);
  const groupByClienteLoadedKeyRef = useRef(groupByClienteKey);
  const groupByClienteSkipSaveRef = useRef(false);
  const [vistaPedidos, setVistaPedidos] = useState("lista");
  const [collapsedClientes, setCollapsedClientes] = useState(() => loadPedidosCollapsedGroups());
  const [criticalPanelOpen, setCriticalPanelOpen] = useState(false);
  const [readCriticalAlerts, setReadCriticalAlerts] = useState(() => loadReadPedidoAlerts());
  const [selectedPedidoIds, setSelectedPedidoIds] = useState([]);
  const [bulkEstado, setBulkEstado] = useState("confirmado");
  const debouncedQ   = useDebounce(q, 350); // debounce search input 350ms
  const [page,       setPage]       = useState(1);
  const [cartaPorte, setCartaPorte] = useState(null); // pedido data for CMR modal
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;
  const [modal,      setModal]      = useState(false);
  const [editando,   setEditando]   = useState(null);
  const [facturando, setFacturando] = useState(null);
  const [savingFactura, setSavingFactura] = useState(false);
  const [ordenCarga, setOrdenCarga] = useState(null); // pedido para ver/imprimir orden de carga
  const [aiCreando,     setAiCreando]    = useState(false); // texto libre -> pedido IA
  const [quickCreando,  setQuickCreando] = useState(false);
  const [copyPlan, setCopyPlan] = useState(null);
  const [copyReviewQueue, setCopyReviewQueue] = useState([]);
  const [copySaving, setCopySaving] = useState(false);
  const [bulkCopying, setBulkCopying] = useState(false);
  const [reprogrammingPedidoId, setReprogrammingPedidoId] = useState("");
  const [bulkRescheduling, setBulkRescheduling] = useState(false);
  const [bulkClearing, setBulkClearing] = useState(false);
  const [openActionMenuPedidoId, setOpenActionMenuPedidoId] = useState("");
  const [whatsappSending, setWhatsappSending] = useState("");
  const delayResolverRef = React.useRef(null);
  const [delayRequest, setDelayRequest] = useState(null);
  const [autoAsignando, setAutoAsignando] = useState(null);  // pedido para autoasignacion IA
  const [colaboradores,setColaboradores]=useState([]);
  const filtroSemanaActualActivo = filtroDesde === _rangoSemanaActual.desde && filtroHasta === _rangoSemanaActual.hasta;
  const _rangoMesActual = currentMonthRangeLocal();
  const filtroPeriodoActivo = filtroFechasCustom || Boolean(filtroMes);
  const vistaMesActualPorDefecto = !filtroPeriodoActivo;

  useEffect(() => {
    savePedidosCollapsedGroups(collapsedClientes);
  }, [collapsedClientes]);

  const guidedPedidoActive = !!guidedPedido?.active;

  const startGuidedPedido = useCallback(() => {
    setGuidedPedido({ active:true, modalOpened:false, saved:false, progress:buildGuidedPedidoProgress({}, { modalOpened:false, saved:false }) });
  }, []);

  const openGuidedPedidoModal = useCallback(() => {
    setEditando(null);
    setModal(true);
    setGuidedPedido(prev => {
      const base = prev?.active ? prev : { active:true, saved:false, progress:{} };
      return {
        ...base,
        modalOpened:true,
        saved:false,
        progress:buildGuidedPedidoProgress({}, { modalOpened:true, saved:false }),
      };
    });
  }, []);

  const updateGuidedPedidoProgress = useCallback((form = {}) => {
    setGuidedPedido(prev => {
      if (!prev?.active) return prev;
      return {
        ...prev,
        modalOpened:true,
        lastForm:form,
        progress:buildGuidedPedidoProgress(form, { modalOpened:true, saved:prev.saved }),
      };
    });
  }, []);

  const closeGuidedPedido = useCallback(() => {
    setGuidedPedido(null);
    clearRuntimeFocus("tms_guided_tutorial");
  }, []);

  useEffect(() => {
    if (guidedPedidoActive) return undefined;
    const pending = readGuidedPedidoTutorial();
    if (pending) startGuidedPedido();
    const onStart = e => {
      if (e?.detail?.type === "pedido_create") startGuidedPedido();
    };
    window.addEventListener("tms:guided-tutorial-start", onStart);
    return () => window.removeEventListener("tms:guided-tutorial-start", onStart);
  }, [guidedPedidoActive, startGuidedPedido]);

  function aplicarSemanaActual() {
    if (filtroSemanaActualActivo) {
      setFiltroMes("");
      setFiltroFechasCustom(false);
      setFiltroDesde("");
      setFiltroHasta("");
      setPage(1);
      return;
    }
    const range = currentWeekRangeLocal();
    setFiltroMes(range.week);
    setFiltroFechasCustom(false);
    setFiltroDesde(range.desde);
    setFiltroHasta(range.hasta);
    setPage(1);
  }

  async function enviarWhatsappPedidoAccion(pedido, target = "cliente") {
    if (!pedido?.id || whatsappSending) return;
    const key = `${pedido.id}:${target}`;
    setWhatsappSending(key);
    try {
      const preflight = await getPedidoWhatsappPreflight(pedido.id, target);
      if (preflight?.bloqueantes?.length) {
        notify(preflight.bloqueantes.join(" "), "warning");
        return;
      }
      const avisos = Array.isArray(preflight?.avisos) ? preflight.avisos : [];
      const targetLabel = target === "chofer" ? "chofer por WhatsApp" : target === "colaborador" ? "colaborador/proveedor por WhatsApp" : "cliente con el estado del pedido";
      const force = avisos.length > 0
        ? await confirmDialog({
            title: `Enviar aviso a ${targetLabel}`,
            message: `${avisos.join("\n")}\n\nSe registrara el envio igualmente para dejar trazabilidad.`,
            confirmText: "Registrar envio",
            cancelText: "Cancelar",
            tone: "warning",
          })
        : true;
      if (!force) return;
      const res = await enviarPedidoWhatsapp(pedido.id, { target, force:true });
      notify(res?.simulado ? "WhatsApp registrado como simulado. Faltan credenciales Meta." : "WhatsApp enviado y registrado.", res?.simulado ? "warning" : "success");
      cargar();
    } catch(e) {
      notify(e.message || "No se pudo registrar el WhatsApp.", "error");
    } finally {
      setWhatsappSending("");
    }
  }

  async function notificarChoferAppAccion(pedido) {
    if (!pedido?.id || whatsappSending) return;
    const key = `${pedido.id}:app_chofer`;
    setWhatsappSending(key);
    try {
      await notificarPedidoChoferApp(pedido.id, {
        mensaje: `Revisa el pedido ${pedido.numero || ""}: ${pedido.origen || "-"} -> ${pedido.destino || "-"}`,
      });
      notify("Aviso enviado a la app del chofer.", "success");
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo enviar aviso a la app del chofer.", "error");
    } finally {
      setWhatsappSending("");
    }
  }

  async function convertirFacturaConConcepto(pedido) {
    if (!canFacturarPedidos) {
      notify("Solo gerencia, contabilidad o administracion pueden facturar pedidos.", "warning");
      return;
    }
    if (pedidoTieneFacturaFinal(pedido) || pedidoTieneFacturaBorrador(pedido)) {
      notify(pedidoTieneFacturaBorrador(pedido) ? "El pedido ya tiene un borrador de factura vinculado: " + (pedido.factura_numero || "borrador") : "Pedido ya facturado: " + (pedido.factura_numero || "factura emitida"), "warning");
      return;
    }
    if (String(pedido?.estado || "").toLowerCase() !== "entregado") {
      notify("Solo se puede facturar cuando el pedido esta entregado. Si esta en descarga, se mandara automaticamente al terminar.", "warning");
      return;
    }

    const estadoActual = pedido.estado;
    const cambiaEstado = !["entregado","facturado"].includes(estadoActual);
    const importe = Number(pedido.importeFactura || pedido.importe || 0)
      .toLocaleString("es-ES", { minimumFractionDigits: 2 });
    const msg = [
      "CREAR BORRADOR DE FACTURA",
      "Pedido:  " + pedido.numero,
      "Cliente: " + (pedido.cliente_nombre || "-"),
      "Importe: " + importe + " EUR",
      "",
      cambiaEstado ? "El pedido cambiara de \"" + estadoActual + "\" a \"Entregado\"" : "",
      "",
      "Se creara como BORRADOR. Administracion la emitira desde Facturacion.",
    ].filter(Boolean).join("\n");
    const ok = await confirmDialog({
      title: "Crear factura borrador",
      message: msg,
      confirmText: "Crear borrador",
    });
    if (!ok) return;

    const concepto = pedido.conceptoFactura ||
      `Servicio de transporte - ${pedido.numero} - ${pedido.origen || ""}${pedido.destino ? " -> " + pedido.destino : ""}`;
    await crearFactura({
      cliente_id: pedido.cliente_id,
      serie: "A",
      fecha: new Date().toISOString().slice(0,10),
      estado: "borrador",
      pedidos_ids: [pedido.id],
      lineas: [{ concepto, cantidad: 1, precio_unit: Number(pedido.importeFactura || pedido.importe || 0) }],
      observaciones: pedido.notas || "",
    });
    if (cambiaEstado) await cambiarEstadoPedido(pedido.id, "entregado");
    if (pedido.vehiculo_id && pedido.km_ruta) {
      import("../services/api").then(m=>m.actualizarKmVehiculo(pedido.vehiculo_id, Number(pedido.km_ruta)).catch(()=>{}));
    }
    await cargar();
  }
  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [filtroEst, filtroMes, filtroFechasCustom, filtroDesde, filtroHasta, debouncedQ, filtroCliente, filtroSinAsignacion, filtroPendienteCompletar, filtroColaborador]);
  useEffect(() => { setSelectedPedidoIds([]); }, [filtroEst, filtroMes, filtroFechasCustom, filtroDesde, filtroHasta, debouncedQ, filtroCliente, filtroSinAsignacion, filtroPendienteCompletar, filtroColaborador, soloCriticos, groupByCliente]);
  useEffect(() => {
    if (groupByClienteLoadedKeyRef.current === groupByClienteKey) return;
    groupByClienteSkipSaveRef.current = true;
    setGroupByCliente(loadPedidosGroupByClient(user));
    groupByClienteLoadedKeyRef.current = groupByClienteKey;
  }, [groupByClienteKey, user]);
  useEffect(() => {
    if (groupByClienteLoadedKeyRef.current !== groupByClienteKey) return;
    if (groupByClienteSkipSaveRef.current) {
      groupByClienteSkipSaveRef.current = false;
      return;
    }
    savePedidosGroupByClient(user, groupByCliente);
  }, [groupByClienteKey, user, groupByCliente]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PEDIDOS_CRITICAL_ALERTS_STORAGE_KEY, JSON.stringify(readCriticalAlerts));
    } catch {}
  }, [readCriticalAlerts]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleClose = () => setOpenActionMenuPedidoId("");
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("tms:pedido-action-menu", { detail: { open: Boolean(openActionMenuPedidoId) } }));
    return () => window.dispatchEvent(new CustomEvent("tms:pedido-action-menu", { detail: { open: false } }));
  }, [openActionMenuPedidoId]);

  const cargar = useCallback(async (options = {}) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setLoadError("");
    }
    let listadoCargado = false;
    try {
      const params = {};
      if (filtroEst === "activos") {
        params.estado = "pendiente,confirmado,en_curso,descarga,incidencia";
      }
      else if (filtroEst !== "todos") { params.estado = filtroEst; }
      if (debouncedQ) params.q = debouncedQ;
      if (filtroCliente) params.cliente_id = filtroCliente;
      const aplicarRangoFechas = filtroFechasCustom || Boolean(filtroMes);
      const rangoMesActualCarga = currentMonthRangeLocal();
      if (aplicarRangoFechas && filtroDesde) params.desde = filtroDesde;
      if (aplicarRangoFechas && filtroHasta) params.hasta = filtroHasta;
      if (!aplicarRangoFechas) {
        params.desde = rangoMesActualCarga.desde;
        params.hasta = rangoMesActualCarga.hasta;
      }
      const cargarPeriodoCompleto = !debouncedQ || groupByCliente || !filtroFechasCustom || Boolean(filtroMes);
      const effectivePage = cargarPeriodoCompleto ? 1 : page;
      const effectiveLimit = cargarPeriodoCompleto ? 1000 : PAGE_SIZE;
      params.page  = effectivePage;
      params.limit = effectiveLimit;
      const p = await getPedidosResumenLista(params, { timeoutMs: 45000, silentError: true });
      // Handle paginated response {data, pagination} or legacy array
      let pedidosData = Array.isArray(p) ? p : (Array.isArray(p?.data) ? p.data : []);
      // Safety net for "activos" if an older backend ignores multi-state filtering.
      if (filtroEst === "activos") {
        pedidosData = pedidosData.filter(x => ["pendiente","confirmado","en_curso","descarga","incidencia"].includes(x.estado));
      }
      setPedidos(pedidosData);
      if (p?.pagination) {
        setTotalPages(cargarPeriodoCompleto ? 1 : (p.pagination.totalPages || 1));
        setTotalCount(p.pagination.total || pedidosData.length);
      } else {
        setTotalPages(1);
        setTotalCount(pedidosData.length);
      }
      listadoCargado = true;
      if (!silent) setLoading(false);

      Promise.allSettled([
        getClientes(),
        getVehiculos(),
        getChoferes(),
        getRutas(),
        getColaboradores(),
        getEmpresaConfig(),
      ]).then(async (results) => {
        const valueAt = (idx, fallback) => results[idx]?.status === "fulfilled" ? results[idx].value : fallback;
        const c = valueAt(0, []);
        const v = valueAt(1, []);
        const ch = valueAt(2, []);
        const r = valueAt(3, []);
        const col = valueAt(4, []);
        const cfgEmpresa = valueAt(5, {});
        setClientes(Array.isArray(c?.data) ? c.data : Array.isArray(c) ? c : []);
        setVehiculos(Array.isArray(v) ? v : []);
        setChoferes(Array.isArray(ch) ? ch : []);
        setRutas(Array.isArray(r) ? r : []);
        setColaboradores(Array.isArray(col) ? col : []);
        let cfgEmpresaObj = cfgEmpresa && typeof cfgEmpresa === "object" ? cfgEmpresa : {};
        if (typeof window !== "undefined") window.__TMS_EMPRESA_CONFIG = cfgEmpresaObj;
        const hasCombCfg = !!(cfgEmpresaObj?.cfg_precios?.combustible || cfgEmpresaObj?.cfg_precios?.gasoil);
        if (!hasCombCfg) {
          try {
            const legacyComb = JSON.parse(localStorage.getItem("tms_gasoil_cfg") || "null");
            if (legacyComb && typeof legacyComb === "object") {
              const nextPrecios = {
                ...(cfgEmpresaObj?.cfg_precios || {}),
                combustible: legacyComb,
              };
              await setConfigPrecios(nextPrecios);
              cfgEmpresaObj = { ...cfgEmpresaObj, cfg_precios: nextPrecios };
              if (typeof window !== "undefined") window.__TMS_EMPRESA_CONFIG = cfgEmpresaObj;
              localStorage.removeItem("tms_gasoil_cfg");
            }
          } catch {}
        }
      }).catch((e) => { console.error(e); });
      } catch(e) {
        console.error(e);
        if (!silent) setLoadError(e.message || "No se pudieron cargar los viajes.");
      }
    finally { if (!listadoCargado && !silent) setLoading(false); }
  }, [filtroEst, filtroMes, filtroFechasCustom, filtroDesde, filtroHasta, debouncedQ, filtroCliente, page, groupByCliente]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const sync = event => {
      const source = String(event?.detail?.source || "");
      if (event?.type === "tms:pedidos-changed" && source.startsWith("pedidos-")) return;
      cargar({ silent: true });
    };
    window.addEventListener("tms:facturas-changed", sync);
    window.addEventListener("tms:pedidos-changed", sync);
    return () => {
      window.removeEventListener("tms:facturas-changed", sync);
      window.removeEventListener("tms:pedidos-changed", sync);
    };
  }, [cargar]);

  useEffect(() => {
    if (focusNuevoAplicadoRef.current || loading) return;
    if (focusPedido?.action !== "nuevo") return;
    const draft = buildPedidoDraftFromTrafficFocus(focusPedido, vehiculos, choferes);
    focusNuevoAplicadoRef.current = true;
    setFiltroEst("todos");
    setFiltroMes("");
    setFiltroFechasCustom(false);
    setFiltroDesde("");
    setFiltroHasta("");
    setQ("");
    setEditando(draft);
    setModal(true);
    clearRuntimeFocus("tms_pedidos_focus");
    notify("Pedido nuevo preparado con el conjunto seleccionado en trafico.", "success");
  }, [focusPedido, loading, vehiculos, choferes]);

  useEffect(() => {
    if (!focusPedido?.pedido_id || loading) return;
    const found = pedidos.find(p => String(p.id) === String(focusPedido.pedido_id));
    if (!found) return;
    let alive = true;
    const t = window.setTimeout(() => {
      document.getElementById(`pedido-row-${focusPedido.pedido_id}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      const focusText = `${focusPedido.type || ""} ${focusPedido.title || ""} ${focusPedido.action || ""} ${focusPedido.action_key || ""}`.toLowerCase();
      const focusIncidencia = focusText.includes("incidencia") || String(found.estado || "").toLowerCase() === "incidencia";
      getPedido(found.id)
        .then(full => {
          if (!alive) return;
          setEditando({ ...(full || found), _focus_incidencia: focusIncidencia });
          setModal(true);
          clearRuntimeFocus("tms_pedidos_focus");
        })
        .catch(() => {
          if (!alive) return;
          setEditando({ ...found, _focus_incidencia: focusIncidencia });
          setModal(true);
          clearRuntimeFocus("tms_pedidos_focus");
        });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [focusPedido, loading, pedidos]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const resetFocusFilters = () => {
      setFiltroMes("");
      setFiltroFechasCustom(false);
      setFiltroDesde("");
      setFiltroHasta("");
      setFiltroCliente("");
      setFiltroSinAsignacion(false);
      setFiltroPendienteCompletar(false);
      setFiltroColaborador(false);
      setSoloCriticos(false);
      setPage(1);
    };
    const openFocusedPedido = (focus) => {
      if (!focus) return;
      if (focus.action === "nuevo") {
        const draft = buildPedidoDraftFromTrafficFocus(focus, vehiculos, choferes);
        resetFocusFilters();
        setFiltroEst("todos");
        setQ("");
        setEditando(draft);
        setModal(true);
        clearRuntimeFocus("tms_pedidos_focus");
        notify("Pedido nuevo preparado desde Dashboard.", "success");
        return;
      }
      if (focus.pedido_id) {
        resetFocusFilters();
        setFiltroEst("todos");
        setQ(focus.numero || "");
        const fallback = pedidos.find(p => String(p.id) === String(focus.pedido_id));
        const focusText = `${focus.type || ""} ${focus.title || ""} ${focus.action || ""} ${focus.action_key || ""}`.toLowerCase();
        const focusIncidencia = focusText.includes("incidencia") || String(fallback?.estado || focus.estado || "").toLowerCase() === "incidencia";
        getPedido(focus.pedido_id)
          .then(full => setEditando({ ...(full || fallback || {}), _focus_incidencia: focusIncidencia }))
          .catch(() => setEditando({ ...(fallback || { id: focus.pedido_id, numero: focus.numero || "" }), _focus_incidencia: focusIncidencia }))
          .finally(() => {
            setModal(true);
            clearRuntimeFocus("tms_pedidos_focus");
          });
        return;
      }
      if (focus.estado) {
        resetFocusFilters();
        setFiltroEst(String(focus.estado));
        if (focus.operativo === "carga") {
          setFiltroFechasCustom(true);
          setFiltroHasta(new Date().toISOString().slice(0, 10));
        }
        setQ("");
        clearRuntimeFocus("tms_pedidos_focus");
        notify(focus.title ? `Mostrando ${focus.title}.` : "Filtro de pedidos aplicado.", "info");
      }
    };
    const handle = (event) => openFocusedPedido(event?.detail);
    window.addEventListener("tms:pedidos-focus", handle);
    return () => window.removeEventListener("tms:pedidos-focus", handle);
  }, [vehiculos, choferes, pedidos]);

  function empresaRequiereMotivoCancelacion() {
    const cfg = (typeof window !== "undefined" && window.__TMS_EMPRESA_CONFIG && typeof window.__TMS_EMPRESA_CONFIG === "object")
      ? window.__TMS_EMPRESA_CONFIG
      : {};
    const trafico = cfg?.cfg_trafico || {};
    return trafico.requerir_motivo_cancelacion !== false && trafico.requiere_motivo_cancelacion !== false;
  }

  async function solicitarCancelacionPedido(p) {
    if (!p?.id) return;
    let motivo = "";
    if (empresaRequiereMotivoCancelacion()) {
      const input = window.prompt(`Motivo de cancelacion para ${p.numero || "este pedido"}:`, p.motivo_cancelacion || "");
      if (input === null) return;
      motivo = String(input || "").trim();
      if (!motivo) {
        notify("Indica un motivo para cancelar el pedido.", "warning");
        return;
      }
    } else {
      const ok = await confirmDialog({
        title: "Cancelar pedido",
        message: `Cancelar el pedido ${p.numero || ""}?`,
        confirmText: "Cancelar pedido",
        tone: "warning",
      });
      if (!ok) return;
    }
    await cambiarEstado(p.id, "cancelado", { motivo_cancelacion: motivo, __fromCancelFlow: true });
  }

  async function cambiarEstado(id, estado, extra = {}) {
    const p = pedidos.find(x => x.id === id);
    if (estado === "cancelado" && !extra.__fromCancelFlow) {
      await solicitarCancelacionPedido(p);
      return;
    }
    if (pedidoTieneFacturaFinal(p)) {
      notify("No se puede cambiar el estado de un pedido facturado.", "warning");
      return;
    }
    if (String(p?.estado || "").toLowerCase() === "entregado" && String(estado || "").toLowerCase() !== "entregado" && user?.rol !== "gerente") {
      notify("Solo gerencia puede cambiar el estado de un pedido entregado.", "warning");
      return;
    }
    const validationIssues = getPedidoStateValidationIssues(p, estado);
    if (validationIssues.length) {
      notify(`No se puede pasar a "${LABEL_ESTADO[estado] || estado}" hasta completar: ${validationIssues.join(", ")}.`, "warning");
      return;
    }
    const incidenciaTexto = String(extra.incidencia || "").trim();
    if (estado === "incidencia" && !incidenciaTexto) {
      const motivo = window.prompt("Describe la incidencia del pedido", "");
      if (!motivo || !motivo.trim()) return;
      extra = { ...extra, incidencia: motivo.trim(), incidencia_tipo: "operativa" };
    }
    // Optimistic update - UI responds instantly
    setPedidos(prev => prev.map(x => x.id===id ? {
      ...x,
      estado,
      ...(estado === "cancelado" ? { motivo_cancelacion: extra.motivo_cancelacion || x.motivo_cancelacion || "" } : {}),
      ...(estado === "incidencia" ? {
        incidencia_descripcion: extra.incidencia || x.incidencia_descripcion || "",
        incidencia_tipo: extra.incidencia_tipo || x.incidencia_tipo || "operativa",
        incidencia_origen: "trafico",
      } : {}),
    } : x));
    try {
      const payloadExtra = { ...extra };
      delete payloadExtra.__fromCancelFlow;
      await cambiarEstadoPedido(id, estado, payloadExtra);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { pedido_id: id, estado, source: "pedidos-estado" } }));
      // No need to full reload - optimistic update is correct
    } catch(e) {
      // Revert on error
      setPedidos(prev => prev.map(x => x.id===id ? {...x, estado: p?.estado} : x));
      notify(e.message, "error");
    }
  }


  function abrirNuevo() {
    setEditando(null);
    setModal(true);
    if (guidedPedidoActive) {
      setGuidedPedido(prev => ({
        ...(prev || { active:true, saved:false }),
        modalOpened:true,
        progress:buildGuidedPedidoProgress({}, { modalOpened:true, saved:false }),
      }));
    }
  }
  async function abrirEditar(p, options = {}) {
    let pedidoCompleto = p;
    if (p?.id) {
      try {
        const fetched = await getPedido(p.id);
        if (fetched?.id) pedidoCompleto = fetched;
      } catch (e) {
        notify("No se pudo refrescar el pedido completo. Se abre la version disponible.", "warning");
      }
    }
    const estaFacturado = pedidoTieneFacturaFinal(pedidoCompleto);
    setEditando(estaFacturado ? { ...pedidoCompleto, ...options, _correccion_factura: true, _readonly: false } : { ...pedidoCompleto, ...options });
    setModal(true);
  }

  async function abrirOrdenCarga(p) {
    let pedidoCompleto = p;
    if (p?.id) {
      try {
        const fetched = await getPedido(p.id);
        if (fetched?.id) pedidoCompleto = fetched;
      } catch (e) {
        notify("No se pudo refrescar el pedido completo. Se abre la version disponible.", "warning");
      }
    }
    if (!pedidoCompleto?.colaborador_id) {
      notify("Asigna primero un colaborador/proveedor para poder mandar la orden de carga.", "warning");
      return;
    }
    setOrdenCarga(normalizePedidoTarifaDraft(pedidoCompleto));
  }

  async function duplicarPedidoExistente(p) {
    try {
      let pedidoBase = p;
      if (p?.id) {
        const fetched = await getPedido(p.id);
        if (fetched?.id) pedidoBase = fetched;
      }
      setEditando(buildPedidoDuplicado(pedidoBase));
      setModal(true);
    } catch (e) {
      notify("No se pudo preparar el duplicado del pedido.", "error");
    }
  }

  async function abrirCopiarPedido(p) {
    try {
      let pedidoBase = p;
      if (p?.id) {
        const fetched = await getPedido(p.id);
        if (fetched?.id) pedidoBase = fetched;
      }
      setCopyPlan({
        source: pedidoBase,
        fecha_carga: String(pedidoBase?.fecha_carga || new Date().toISOString().slice(0, 10)).slice(0, 10),
        copias: 1,
        fechas_copia: normalizarFechasCopia(pedidoBase?.fecha_carga || new Date().toISOString().slice(0, 10), 1),
        mantener_asignacion: true,
      });
    } catch (e) {
      notify("No se pudo preparar la copia del viaje.", "error");
    }
  }

  async function confirmarCopiaPedido() {
    if (!copyPlan?.source) return;
    const copias = Math.max(1, Math.min(20, Number(copyPlan.copias || 1)));
    const fechasCopia = normalizarFechasCopia(copyPlan.fecha_carga, copias, copyPlan.fechas_copia);
    if (fechasCopia.some(f => !f)) {
      notify("Indica la fecha de cada copia.", "warning");
      return;
    }
    setCopySaving(true);
    try {
      const creados = [];
      for (let i = 0; i < copias; i += 1) {
        const fechaCarga = fechasCopia[i];
        const payload = buildPedidoCopyPayload(copyPlan.source, {
          fecha_carga: fechaCarga,
          fecha_descarga: null,
          fecha_entrega: null,
          pendiente_completar: true,
          aviso_completar: copias > 1
            ? "Viaje copiado en serie: completar fecha de descarga, revisar asignacion y precio antes de cerrar."
            : "Viaje copiado: completar fecha de descarga, revisar asignacion y precio antes de cerrar.",
          mantener_asignacion: !!copyPlan.mantener_asignacion,
          vehiculo_id: copyPlan.mantener_asignacion ? copyPlan.source?.vehiculo_id || null : null,
          chofer_id: copyPlan.mantener_asignacion ? copyPlan.source?.chofer_id || null : null,
          remolque_id_manual: copyPlan.mantener_asignacion ? copyPlan.source?.remolque_id || copyPlan.source?.remolque_id_manual || null : null,
          estado: "pendiente",
        });
        const creado = await crearPedido(payload);
        if (creado?.id) creados.push(creado);
      }
      notify(
        copias > 1
          ? `Se han creado ${creados.length} copias. Se abrira cada una para revisarla.`
          : "Viaje copiado correctamente.",
        "success"
      );
      setCopyPlan(null);
      await cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { source: "pedidos-copy-batch" } }));
      }
      if (creados.length) {
        const [first, ...rest] = creados;
        setCopyReviewQueue(rest);
        await abrirEditar(first, { _copyReview:true });
      }
    } catch (e) {
      notify(e.message || "No se pudieron copiar los viajes.", "error");
    } finally {
      setCopySaving(false);
    }
  }

  async function abrirSiguienteCopiaPendiente(queueOverride = null) {
    const queue = Array.isArray(queueOverride) ? queueOverride : copyReviewQueue;
    const [next, ...rest] = queue;
    setCopyReviewQueue(rest);
    if (!next) return;
    await abrirEditar(next, { _copyReview:true });
  }

  async function reprogramarPedidoDias(pedido, offsetDays = 1) {
    const texto = offsetDays === 1 ? "1 dia" : `${offsetDays} dias`;
    const ok = await confirmDialog({
      title: "Reprogramar pedido",
      message: `Se moveran las fechas operativas de ${pedido.numero || "este pedido"} ${texto} manteniendo la separacion entre carga y descarga.\n\nEl pedido quedara marcado para revisar horarios y compromiso con el cliente.`,
      confirmText: "Reprogramar",
      tone: "warning",
    });
    if (!ok) return;
    setReprogrammingPedidoId(String(pedido.id));
    try {
      let pedidoBase = pedido;
      if (pedido?.id) {
        const fetched = await getPedido(pedido.id);
        if (fetched?.id) pedidoBase = fetched;
      }
      await editarPedido(pedido.id, buildPedidoReschedulePayload(pedidoBase, offsetDays));
      notify(`${pedido.numero || "Pedido"} reprogramado ${texto}.`, "success");
      cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { pedido_id: pedido.id, source: "pedidos-reschedule" } }));
      }
    } catch (e) {
      notify(e.message || "No se pudo reprogramar el pedido.", "error");
    } finally {
      setReprogrammingPedidoId("");
    }
  }

  function pedirDiasRetraso(etiqueta = "este pedido", defaultDays = 1) {
    return new Promise(resolve => {
      delayResolverRef.current = resolve;
      setDelayRequest({
        etiqueta,
        value: String(defaultDays || 1),
      });
    });
  }

  function cerrarSelectorRetraso(value = null) {
    const resolve = delayResolverRef.current;
    delayResolverRef.current = null;
    setDelayRequest(null);
    if (resolve) resolve(value);
  }

  function confirmarSelectorRetraso() {
    const days = Number(String(delayRequest?.value || "").trim().replace(",", "."));
    if (!Number.isFinite(days) || days <= 0) {
      notify("Introduce un numero de dias valido mayor que cero.", "warning");
      return;
    }
    cerrarSelectorRetraso(Math.min(365, Math.round(days)));
  }

  async function solicitarRetrasoPedido(pedido, etiqueta) {
    const days = await pedirDiasRetraso(etiqueta || pedido?.numero || "este pedido", 1);
    if (days == null) return;
    await reprogramarPedidoDias(pedido, days);
  }

  async function limpiarAsignacionPedido(pedido) {
    if (!pedido?.id || pedidoTieneFacturaFinal(pedido) || pedidoTieneFacturaBorrador(pedido)) {
      notify("Ese pedido no se puede desasignar desde aqui.", "warning");
      return;
    }
    const ok = await confirmDialog({
      title: "Limpiar asignacion",
      message: `Se quitara la asignacion operativa de ${pedido.numero || "este pedido"} para volver a planificarlo.\n\nSe eliminaran vehiculo, chofer y conjunto, pero el resto del viaje seguira intacto.`,
      confirmText: "Limpiar asignacion",
      tone: "warning",
    });
    if (!ok) return;
    setReprogrammingPedidoId(String(pedido.id));
    try {
      await editarPedido(pedido.id, buildPedidoUpdatePayload(pedido, {
        vehiculo_id: "",
        chofer_id: "",
        remolque_id: "",
        remolque_id_manual: "",
        pendiente_completar: true,
        aviso_completar: "Asignacion limpiada desde pedidos: volver a planificar recurso y horario operativo.",
      }));
      notify(`Asignacion limpiada en ${pedido.numero || "el pedido"}.`, "success");
      cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { pedido_id: pedido.id, source: "pedidos-clear-assignment" } }));
      }
    } catch (e) {
      notify(e.message || "No se pudo limpiar la asignacion.", "error");
    } finally {
      setReprogrammingPedidoId("");
    }
  }

  async function copiarCriticosSemanaSiguiente() {
    const lista = pedidosCriticosOperativos
      .map(item => item.pedido)
      .filter(p => !pedidoTieneFacturaFinal(p));
    if (!lista.length) {
      notify("No hay pedidos criticos disponibles para copiar.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Copiar pedidos criticos",
      message: `Se copiaran ${lista.length} pedido(s) criticos a la semana siguiente manteniendo, si existe, la asignacion actual.\n\nLas copias quedaran como pendientes para revisarlas antes de cerrar.`,
      confirmText: "Copiar semana siguiente",
    });
    if (!ok) return;
    setBulkCopying(true);
    try {
      for (const pedido of lista) {
        let pedidoBase = pedido;
        if (pedido?.id) {
          const fetched = await getPedido(pedido.id);
          if (fetched?.id) pedidoBase = fetched;
        }
        const payload = buildPedidoCopyPayload(pedidoBase, {
          fecha_carga: sumarDiasISO(pedidoBase?.fecha_carga, 7),
          fecha_descarga: pedidoBase?.fecha_descarga
            ? sumarDiasISO(pedidoBase.fecha_descarga, 7)
            : sumarDiasISO(pedidoBase?.fecha_carga, 7),
          pendiente_completar: true,
          aviso_completar: "Viaje copiado desde pedidos: revisar fechas, asignacion y precio antes de cerrar.",
          estado: "pendiente",
        });
        await crearPedido(payload);
      }
      notify(`Se han copiado ${lista.length} pedido(s) criticos.`, "success");
      cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { source: "pedidos-copy-criticals" } }));
      }
    } catch (e) {
      notify(e.message || "No se pudieron copiar los pedidos criticos.", "error");
    } finally {
      setBulkCopying(false);
    }
  }

  async function reprogramarCriticosDias(offsetDays = 1) {
    const lista = pedidosCriticosOperativos
      .map(item => item.pedido)
      .filter(p => !pedidoTieneFacturaFinal(p));
    if (!lista.length) {
      notify("No hay pedidos criticos disponibles para reprogramar.", "info");
      return;
    }
    const texto = offsetDays === 1 ? "1 dia" : `${offsetDays} dias`;
    const ok = await confirmDialog({
      title: "Reprogramar pedidos criticos",
      message: `Se moveran ${lista.length} pedido(s) criticos ${texto} manteniendo la separacion entre carga y descarga.\n\nTodos quedaran marcados para revisar horarios y compromiso con el cliente.`,
      confirmText: "Reprogramar criticos",
      tone: "warning",
    });
    if (!ok) return;
    setBulkRescheduling(true);
    try {
      for (const pedido of lista) {
        let pedidoBase = pedido;
        if (pedido?.id) {
          const fetched = await getPedido(pedido.id);
          if (fetched?.id) pedidoBase = fetched;
        }
        await editarPedido(pedido.id, buildPedidoReschedulePayload(pedidoBase, offsetDays, {
          aviso_completar: "Viaje reprogramado en lote desde pedidos: revisar horarios, asignacion y compromiso con el cliente.",
        }));
      }
      notify(`${lista.length} pedido(s) criticos reprogramados ${texto}.`, "success");
      cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { source: "pedidos-bulk-reschedule" } }));
      }
    } catch (e) {
      notify(e.message || "No se pudieron reprogramar los pedidos criticos.", "error");
    } finally {
      setBulkRescheduling(false);
    }
  }

  async function solicitarRetrasoCriticos() {
    const days = await pedirDiasRetraso("los pedidos criticos visibles", 1);
    if (days == null) return;
    await reprogramarCriticosDias(days);
  }

  async function copiarSeleccionadosSemanaSiguiente() {
    const lista = selectedPedidosOperables;
    if (!lista.length) {
      notify("Selecciona pedidos editables para copiarlos.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Copiar pedidos seleccionados",
      message: `Se copiaran ${lista.length} pedido(s) seleccionados a la semana siguiente manteniendo, si existe, la asignacion actual.\n\nLas copias quedaran como pendientes para revisarlas antes de cerrar.`,
      confirmText: "Copiar seleccionados",
    });
    if (!ok) return;
    setBulkCopying(true);
    try {
      for (const pedido of lista) {
        let pedidoBase = pedido;
        if (pedido?.id) {
          const fetched = await getPedido(pedido.id);
          if (fetched?.id) pedidoBase = fetched;
        }
        await crearPedido(buildPedidoCopyPayload(pedidoBase, {
          fecha_carga: sumarDiasISO(pedidoBase?.fecha_carga, 7),
          fecha_descarga: pedidoBase?.fecha_descarga
            ? sumarDiasISO(pedidoBase.fecha_descarga, 7)
            : sumarDiasISO(pedidoBase?.fecha_carga, 7),
          pendiente_completar: true,
          aviso_completar: "Viaje copiado desde seleccion multiple: revisar fechas, asignacion y precio antes de cerrar.",
          estado: "pendiente",
        }));
      }
      notify(`Se han copiado ${lista.length} pedido(s) seleccionados.`, "success");
      setSelectedPedidoIds([]);
      cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { source: "pedidos-copy-selected" } }));
      }
    } catch (e) {
      notify(e.message || "No se pudieron copiar los pedidos seleccionados.", "error");
    } finally {
      setBulkCopying(false);
    }
  }

  async function reprogramarSeleccionadosDias(offsetDays = 1) {
    const lista = selectedPedidosOperables;
    if (!lista.length) {
      notify("Selecciona pedidos editables para reprogramarlos.", "info");
      return;
    }
    const texto = offsetDays === 1 ? "1 dia" : `${offsetDays} dias`;
    const ok = await confirmDialog({
      title: "Reprogramar pedidos seleccionados",
      message: `Se moveran ${lista.length} pedido(s) seleccionados ${texto} manteniendo la separacion entre carga y descarga.\n\nTodos quedaran marcados para revisar horarios y compromiso con el cliente.`,
      confirmText: "Reprogramar seleccionados",
      tone: "warning",
    });
    if (!ok) return;
    setBulkRescheduling(true);
    try {
      for (const pedido of lista) {
        let pedidoBase = pedido;
        if (pedido?.id) {
          const fetched = await getPedido(pedido.id);
          if (fetched?.id) pedidoBase = fetched;
        }
        await editarPedido(pedido.id, buildPedidoReschedulePayload(pedidoBase, offsetDays, {
          aviso_completar: "Viaje reprogramado desde seleccion multiple: revisar horarios, asignacion y compromiso con el cliente.",
        }));
      }
      notify(`${lista.length} pedido(s) seleccionados reprogramados ${texto}.`, "success");
      setSelectedPedidoIds([]);
      cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { source: "pedidos-reschedule-selected" } }));
      }
    } catch (e) {
      notify(e.message || "No se pudieron reprogramar los pedidos seleccionados.", "error");
    } finally {
      setBulkRescheduling(false);
    }
  }

  async function solicitarRetrasoSeleccionados() {
    const days = await pedirDiasRetraso("los pedidos seleccionados", 1);
    if (days == null) return;
    await reprogramarSeleccionadosDias(days);
  }

  async function marcarPedidoAvisoLeido(item) {
    const pedido = item?.pedido;
    if (!pedido?.id) return;
    const ok = await confirmDialog({
      title: "Marcar aviso como leido",
      message: `El aviso de ${pedido.numero || "este pedido"} se ocultara de la bandeja de avisos hasta que cambie su situacion operativa.`,
      confirmText: "Marcar como leido",
    });
    if (!ok) return;
    const key = buildPedidoCriticalAlertKey(item);
    setReadCriticalAlerts(prev => Array.from(new Set([...prev, key])));
    notify(`Aviso de ${pedido.numero || "pedido"} marcado como leido.`, "success");
  }

  async function marcarPedidosAvisosVisiblesLeidos(lista = []) {
    const visibles = (lista || []).filter(Boolean);
    if (!visibles.length) {
      notify("No hay avisos pendientes para marcar como leidos.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Marcar avisos como leidos",
      message: `Se ocultaran ${visibles.length} aviso(s) operativos visibles hasta que cambie su situacion.`,
      confirmText: "Marcar visibles",
    });
    if (!ok) return;
    setReadCriticalAlerts(prev => Array.from(new Set([
      ...prev,
      ...visibles.map(buildPedidoCriticalAlertKey),
    ])));
    notify(`${visibles.length} aviso(s) marcados como leidos.`, "success");
  }

  async function limpiarAsignacionesSeleccionadas() {
    const lista = selectedPedidosOperables.filter(
      p => !pedidoTieneFacturaBorrador(p) && (p.vehiculo_id || p.chofer_id || p.remolque_id || p.remolque_id_manual)
    );
    if (!lista.length) {
      notify("No hay asignaciones seleccionadas para limpiar.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Limpiar asignaciones seleccionadas",
      message: `Se limpiara la asignacion operativa de ${lista.length} pedido(s) seleccionados para volver a planificarlos sin arrastrar recursos equivocados.`,
      confirmText: "Limpiar asignaciones",
      tone: "warning",
    });
    if (!ok) return;
    setBulkClearing(true);
    try {
      for (const pedido of lista) {
        await editarPedido(pedido.id, buildPedidoUpdatePayload(pedido, {
          vehiculo_id: "",
          chofer_id: "",
          remolque_id: "",
          remolque_id_manual: "",
          pendiente_completar: true,
          aviso_completar: "Asignacion limpiada desde seleccion multiple: volver a planificar recurso y horario operativo.",
        }));
      }
      notify(`Asignaciones limpiadas en ${lista.length} pedido(s).`, "success");
      setSelectedPedidoIds([]);
      cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { source: "pedidos-clear-selected-assignments" } }));
      }
    } catch (e) {
      notify(e.message || "No se pudieron limpiar las asignaciones seleccionadas.", "error");
    } finally {
      setBulkClearing(false);
    }
  }

  async function cambiarEstadoSeleccionados() {
    const lista = selectedPedidosOperables;
    if (!lista.length) {
      notify("Selecciona pedidos editables para cambiarles el estado.", "info");
      return;
    }
    const evaluados = lista.map(pedido => ({
      pedido,
      issues: getPedidoStateValidationIssues(pedido, bulkEstado),
    }));
    const validos = evaluados.filter(item => item.issues.length === 0).map(item => item.pedido);
    const invalidos = evaluados.filter(item => item.issues.length > 0);
    if (!validos.length) {
      const firstIssues = invalidos[0]?.issues?.join(", ");
      notify(`No hay pedidos listos para pasar a "${LABEL_ESTADO[bulkEstado] || bulkEstado}".${firstIssues ? ` Falta completar: ${firstIssues}.` : ""}`, "warning");
      return;
    }
    if (invalidos.length) {
      notify(`${invalidos.length} pedido(s) se quedaran fuera por datos pendientes.`, "warning");
    }
    const ok = await confirmDialog({
      title: "Cambiar estado en lote",
      message: `Se cambiara el estado de ${validos.length} pedido(s) a "${LABEL_ESTADO[bulkEstado] || bulkEstado}".${invalidos.length ? ` ${invalidos.length} pedido(s) se omitiran por datos pendientes.` : ""}`,
      confirmText: "Actualizar estados",
    });
    if (!ok) return;
    setBulkRescheduling(true);
    try {
      for (const pedido of validos) {
        await cambiarEstadoPedido(pedido.id, bulkEstado);
      }
      notify(`Estado actualizado en ${validos.length} pedido(s).`, "success");
      setSelectedPedidoIds(prev => prev.filter(id => invalidos.some(item => item.pedido.id === id)));
      cargar();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { source: "pedidos-bulk-state", estado: bulkEstado } }));
      }
    } catch (e) {
      notify(e.message || "No se pudieron actualizar los estados seleccionados.", "error");
    } finally {
      setBulkRescheduling(false);
    }
  }

  const pedidosConMeta = pedidos.map(p => ({ pedido: p, priorityMeta: getPedidoPriorityMeta(p) }));
  const pedidosFiltrados = pedidosConMeta.filter(({ pedido, priorityMeta }) => {
    if (filtroSinAsignacion && !priorityMeta.flags.missingAssignment) return false;
    if (filtroPendienteCompletar && !pedido.pendiente_completar && priorityMeta.validationIssues.length === 0) return false;
    if (filtroColaborador && !pedido.colaborador_id) return false;
    return true;
  });
  const pedidosCriticosOperativos = pedidosFiltrados.filter(({ priorityMeta }) =>
    priorityMeta.flags.overdueAssignment ||
    priorityMeta.flags.urgentAssignment ||
    priorityMeta.validationIssues.length > 0
  );
  const resumenCriticos = pedidosFiltrados.reduce((acc, item) => {
    const { flags, validationIssues } = item.priorityMeta;
    if (flags.overdueAssignment) acc.vencidos += 1;
    if (!flags.overdueAssignment && flags.urgentAssignment) acc.urgentes += 1;
    if (validationIssues.length > 0) acc.datos += 1;
    if (flags.missingAssignment) acc.sinAsignacion += 1;
    return acc;
  }, { vencidos: 0, urgentes: 0, datos: 0, sinAsignacion: 0 });
  const alertasCriticasPedidos = pedidos
    .filter(p => !["cancelado", "entregado"].includes(String(p.estado || "").toLowerCase()) && !pedidoTieneFacturaFinal(p))
    .map(p => ({ pedido: p, meta: getPedidoPriorityMeta(p, new Date()) }))
    .filter(({ meta }) => meta.flags.overdueAssignment || meta.flags.urgentAssignment)
    .sort((a, b) => b.meta.severity - a.meta.severity);
  const alertasCriticasPendientes = alertasCriticasPedidos.filter(
    item => !readCriticalAlerts.includes(buildPedidoCriticalAlertKey(item))
  );
  const totalAlertasCriticas = alertasCriticasPedidos.length;
  const totalAlertasCriticasPendientes = alertasCriticasPendientes.length;
  const pedidosVisibles = soloCriticos
    ? pedidosCriticosOperativos
    : pedidosFiltrados;
  const usarAgrupadoCalendario = !groupByCliente;
  const ordenarItemsPedidoPorFecha = (a, b) => {
    const da = pedidoFechaOperativaKey(a?.pedido);
    const db = pedidoFechaOperativaKey(b?.pedido);
    if (da !== db) return String(da).localeCompare(String(db));
    const ca = pedidoClienteOrdenKey(a?.pedido);
    const cb = pedidoClienteOrdenKey(b?.pedido);
    const clienteCmp = ca.localeCompare(cb, "es", { sensitivity: "base" });
    if (clienteCmp !== 0) return clienteCmp;
    const ha = String(a?.pedido?.hora_carga || "");
    const hb = String(b?.pedido?.hora_carga || "");
    if (ha !== hb) return ha.localeCompare(hb);
    return String(a?.pedido?.numero || "").localeCompare(String(b?.pedido?.numero || ""));
  };
  const pedidosAgrupados = groupByCliente
    ? Object.entries(
        pedidosVisibles.reduce((acc, item) => {
          const key = item.pedido.cliente_id || item.pedido.cliente_nombre || "sin-cliente";
          if (!acc[key]) acc[key] = { label: item.pedido.cliente_nombre || "Sin cliente", items: [] };
          acc[key].items.push(item);
          return acc;
        }, {})
      )
        .map(([key, group]) => ({ key, ...group, items: [...group.items].sort(ordenarItemsPedidoPorFecha) }))
        .sort((a, b) => {
          const label = String(a.label || "").localeCompare(String(b.label || ""), "es", { sensitivity: "base" });
          if (label !== 0) return label;
          const da = pedidoFechaOperativaKey(a.items[0]?.pedido);
          const db = pedidoFechaOperativaKey(b.items[0]?.pedido);
          return String(da).localeCompare(String(db));
        })
    : usarAgrupadoCalendario ? buildPedidoCalendarGroups(pedidosVisibles, {
        desde: filtroDesde || undefined,
        hasta: filtroHasta || undefined,
          currentWeek: filtroSemanaActualActivo,
      }) : [];
  const pedidosRenderList = groupByCliente
    ? pedidosAgrupados.flatMap(group => {
        const collapsed = !!collapsedClientes[group.key];
        return [
          { _group: true, type: "cliente", key: group.key, label: group.label, count: group.items.length, collapsed },
          ...(collapsed ? [] : group.items),
        ];
      })
    : usarAgrupadoCalendario ? pedidosAgrupados.flatMap(month => {
        const monthCollapsed = !!collapsedClientes[month.key];
        const entries = [{ _group: true, type: "month", key: month.key, label: month.label, count: month.count, collapsed: monthCollapsed }];
        if (monthCollapsed) return entries;
        month.weeks.forEach(week => {
          const weekCollapsed = !!collapsedClientes[week.key];
          entries.push({ _group: true, type: "week", key: week.key, label: week.label, count: week.count, collapsed: weekCollapsed });
          if (weekCollapsed) return;
          week.days.forEach(day => {
            const dayCollapsed = !!collapsedClientes[day.key];
            entries.push({ _group: true, type: "day", key: day.key, label: day.label, count: day.count, collapsed: dayCollapsed });
            if (!dayCollapsed) entries.push(...day.items);
          });
        });
        return entries;
      }) : pedidosVisibles;
  const pedidosVisiblesAccionables = pedidosVisibles
    .map(item => item.pedido)
    .filter(Boolean);
  const selectedPedidos = pedidosVisiblesAccionables.filter(p => selectedPedidoIds.includes(String(p.id)));
  const selectedPedidosOperables = selectedPedidos.filter(p => !pedidoTieneFacturaFinal(p));
  const allVisibleSelected = pedidosVisiblesAccionables.length > 0 && pedidosVisiblesAccionables.every(p => selectedPedidoIds.includes(String(p.id)));
  const searchActive = q.trim().length > 0;
  const searchHasMatches = searchActive && pedidosVisiblesAccionables.length > 0;
  const noHayViajesParaPlanificar = !loading && !soloCriticos && pedidosVisiblesAccionables.length === 0;

  function togglePedidoSelected(pedidoId) {
    setSelectedPedidoIds(prev => prev.includes(String(pedidoId))
      ? prev.filter(id => id !== String(pedidoId))
      : [...prev, String(pedidoId)]);
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedPedidoIds([]);
      return;
    }
    setSelectedPedidoIds(pedidosVisiblesAccionables.map(p => String(p.id)));
  }


  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={S.title}>Pedidos / Tráfico</div>
      <div style={{display:"flex",gap:8,margin:"-4px 0 24px",flexWrap:"wrap"}}>
        {[
          ["lista", "Listado"],
          ["ia", "Bandeja IA"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={()=>setVistaPedidos(key)}
            style={{...S.btn,padding:"10px 16px",background:vistaPedidos===key?"#fff":"#fff",color:vistaPedidos===key?"#006f68":"#64748b",border:vistaPedidos===key?"1px solid #008b82":"1px solid #dbe5ec",boxShadow:vistaPedidos===key?"0 8px 18px rgba(0,111,104,.10)":"none"}}
          >
            {label}
          </button>
        ))}
      </div>
      {totalAlertasCriticasPendientes > 0 ? (
        <div style={{margin:"0 0 26px",padding:"18px 22px",background:"rgba(239,68,68,.05)",border:"1px solid rgba(239,68,68,.22)",borderRadius:12,display:"flex",flexDirection:"column",gap:10,boxShadow:"0 10px 24px rgba(239,68,68,.06)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              <div style={{fontSize:16,fontWeight:900,color:"#ef4444"}}>
                Atencion: {totalAlertasCriticasPendientes} aviso{totalAlertasCriticasPendientes !== 1 ? "s" : ""} pendiente{totalAlertasCriticasPendientes !== 1 ? "s" : ""}
              </div>
              <div style={{fontSize:14,color:"#64748b",marginTop:3}}>
                {totalAlertasCriticas} pedido{totalAlertasCriticas !== 1 ? "s" : ""} critico{totalAlertasCriticas !== 1 ? "s" : ""} en total
              </div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <button
                onClick={() => setCriticalPanelOpen(v => !v)}
                style={{...S.btn,padding:"10px 16px",fontSize:14,background:"#fff",color:"#475569",border:"1px solid #dbe5ec"}}
              >
                {criticalPanelOpen ? "Ocultar avisos" : "Mostrar avisos"}
              </button>
              <button
                onClick={() => marcarPedidosAvisosVisiblesLeidos(alertasCriticasPendientes)}
                disabled={!totalAlertasCriticasPendientes}
                style={{...S.btn,padding:"10px 16px",fontSize:14,background:"rgba(16,185,129,.10)",color:"#008b82",border:"1px solid rgba(16,185,129,.24)",opacity:totalAlertasCriticasPendientes?1:0.5,cursor:totalAlertasCriticasPendientes?"pointer":"not-allowed"}}
              >
                Marcar visibles leidos
              </button>
              {canEdit && totalAlertasCriticasPendientes > 0 && (
                <>
                  <button
                    onClick={copiarCriticosSemanaSiguiente}
                    disabled={bulkCopying}
                    style={{...S.btn,padding:"10px 16px",fontSize:14,background:"rgba(79,70,229,.09)",color:"#4f46e5",border:"1px solid rgba(79,70,229,.20)",opacity:bulkCopying?0.6:1,cursor:bulkCopying?"not-allowed":"pointer"}}
                  >
                    {bulkCopying ? "Copiando..." : "Copiar criticos"}
                  </button>
                  <button
                    onClick={solicitarRetrasoCriticos}
                    disabled={bulkRescheduling}
                    style={{...S.btn,padding:"10px 16px",fontSize:14,background:"rgba(245,158,11,.10)",color:"#f97316",border:"1px solid rgba(245,158,11,.24)",opacity:bulkRescheduling?0.6:1,cursor:bulkRescheduling?"not-allowed":"pointer"}}
                  >
                    {bulkRescheduling ? "Reprogramando..." : "Retrasar"}
                  </button>
                </>
              )}
            </div>
          </div>
          {criticalPanelOpen && (
            totalAlertasCriticasPendientes > 0 ? alertasCriticasPendientes.slice(0,3).map(({ pedido: p, meta })=>{
              const diffH = typeof meta.flags.diffHours === "number" ? Math.round(meta.flags.diffHours) : null;
              const needsAssignment = meta.flags.missingVehiculo || meta.flags.missingChofer;
              return (
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",background:"rgba(239,68,68,.06)",borderRadius:7}}>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:"var(--text)"}}>{p.numero}</span>
                  <span style={{fontSize:12,color:"var(--text3)"}}>{p.origen} -> {p.destino}</span>
                  {meta.flags.overdueAssignment ? (
                    <span style={{fontSize:11,color:"#fca5a5"}}>{diffH !== null ? `${Math.abs(diffH)}h vencido` : "Vencido"}</span>
                  ) : diffH !== null ? (
                    <span style={{fontSize:11,color:"#fca5a5"}}>en {diffH}h</span>
                  ) : null}
                  {meta.flags.missingVehiculo && <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:"rgba(239,68,68,.15)",color:"#f87171"}}>Sin vehiculo</span>}
                  {meta.flags.missingChofer && <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:"rgba(245,158,11,.15)",color:"#fbbf24"}}>Sin chofer</span>}
                  {meta.validationIssues.length > 0 && <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:"rgba(251,191,36,.12)",color:"#fbbf24"}}>{meta.validationIssues.length} dato{meta.validationIssues.length !== 1 ? "s" : ""} pendiente{meta.validationIssues.length !== 1 ? "s" : ""}</span>}
                  {canEdit && (
                    <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      {meta.validationIssues.length > 0 && (
                        <button onClick={e=>{e.stopPropagation();abrirEditar(p, {_focus_asignacion: needsAssignment});}}
                          style={{padding:"3px 10px",borderRadius:6,border:"1px solid rgba(251,191,36,.35)",background:"rgba(251,191,36,.08)",color:"#fbbf24",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                          Completar datos
                        </button>
                      )}
                      <button onClick={e=>{e.stopPropagation();openPedidoInTrafico(p);}}
                        style={{padding:"3px 10px",borderRadius:6,border:"1px solid rgba(59,130,246,.30)",background:"rgba(59,130,246,.10)",color:"#60a5fa",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                        Ver en trafico
                      </button>
                      {needsAssignment && (
                      <button onClick={e=>{e.stopPropagation();setAutoAsignando(p);}}
                          style={{padding:"3px 10px",borderRadius:6,border:"1px solid rgba(139,92,246,.4)",background:"rgba(139,92,246,.1)",color:"#a78bfa",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                          Asignar
                        </button>
                      )}
                      <button onClick={e=>{e.stopPropagation();solicitarRetrasoPedido(p, p.numero || "este pedido");}}
                        disabled={reprogrammingPedidoId === String(p.id)}
                        style={{padding:"3px 10px",borderRadius:6,border:"1px solid rgba(245,158,11,.35)",background:"rgba(245,158,11,.08)",color:"#f59e0b",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,cursor:reprogrammingPedidoId === String(p.id) ? "not-allowed" : "pointer",opacity:reprogrammingPedidoId === String(p.id) ? 0.6 : 1}}>
                        {reprogrammingPedidoId === String(p.id) ? "Moviendo..." : "Retrasar"}
                      </button>
                      {(p.vehiculo_id || p.chofer_id || p.remolque_id || p.remolque_id_manual) && (
                        <button onClick={e=>{e.stopPropagation();limpiarAsignacionPedido(p);}}
                          disabled={reprogrammingPedidoId === String(p.id)}
                          style={{padding:"3px 10px",borderRadius:6,border:"1px solid rgba(239,68,68,.35)",background:"rgba(239,68,68,.08)",color:"#f87171",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,cursor:reprogrammingPedidoId === String(p.id) ? "not-allowed" : "pointer",opacity:reprogrammingPedidoId === String(p.id) ? 0.6 : 1}}>
                          {reprogrammingPedidoId === String(p.id) ? "Limpiando..." : "Limpiar asignacion"}
                        </button>
                      )}
                      <button onClick={e=>{e.stopPropagation();abrirCopiarPedido(p);}}
                        style={{padding:"3px 10px",borderRadius:6,border:"1px solid rgba(59,130,246,.30)",background:"rgba(59,130,246,.08)",color:"#60a5fa",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                        Copiar
                      </button>
                      <button onClick={e=>{e.stopPropagation();marcarPedidoAvisoLeido({ pedido: p, meta });}}
                        style={{padding:"3px 10px",borderRadius:6,border:"1px solid rgba(16,185,129,.30)",background:"rgba(16,185,129,.08)",color:"#10b981",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                        Leido
                      </button>
                    </div>
                  )}
                </div>
              );
            }) : (
              <div style={{padding:"8px 10px",borderRadius:7,background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.16)",fontSize:12,color:"var(--text3)"}}>
                No quedan avisos pendientes. Los visibles ya se marcaron como revisados.
              </div>
            )
          )}
        </div>
      ) : null}

      <div style={S.bar}>
        {canEdit && <button style={{...S.btn,background:"linear-gradient(180deg,#008b82,#006f68)",color:"#fff",border:"1px solid #007f78",boxShadow:"0 12px 22px rgba(0,111,104,.18)"}} onClick={abrirNuevo}>+ Nuevo pedido</button>}
        {canEdit && <button style={{...S.btn,background:"rgba(16,185,129,.10)",color:"#008b82",border:"1px solid rgba(16,185,129,.24)"}} onClick={()=>setQuickCreando(true)}>+ Pedido rapido</button>}
        {canEdit && aiDisponible && <button style={{...S.btn,background:"rgba(139,92,246,.12)",color:"#6d5dfc",border:"1px solid rgba(139,92,246,.22)"}} onClick={()=>setVistaPedidos("ia")}>IA: email / PDF</button>}
        <button onClick={aplicarSemanaActual}
          title={filtroSemanaActualActivo ? "Quitar el filtro de semana" : "Mostrar solo la semana actual"}
          style={{...S.btn,background:filtroSemanaActualActivo?"rgba(245,158,11,.12)":"#fff",color:filtroSemanaActualActivo?"#f59e0b":"#475569",border:filtroSemanaActualActivo?"1px solid rgba(245,158,11,.26)":"1px solid #dbe5ec"}}>
          {filtroSemanaActualActivo ? "Quitar semana" : "Semana actual"}
        </button>
        <input type="date" min="2000-01-01" max="2100-12-31" value={filtroDesde} onChange={e=>{setFiltroFechasCustom(true);setFiltroDesde(e.target.value);}}
          style={{...S.input,width:132}} title="Desde"/>
        <input type="date" min="2000-01-01" max="2100-12-31" value={filtroHasta} onChange={e=>{setFiltroFechasCustom(true);setFiltroHasta(e.target.value);}}
          style={{...S.input,width:132}} title="Hasta"/>
        <select value={filtroEst} onChange={e=>setFiltroEst(e.target.value)} style={{...S.input,width:150}}>
          <option value="activos">Activos</option>
          <option value="todos">Todos los estados</option>
          {ESTADOS_RAW.map(e=><option key={e} value={e}>{LABEL_ESTADO[e]}</option>)}
        </select>
        <select value={filtroCliente} onChange={e=>setFiltroCliente(e.target.value)} style={{...S.input,width:150}}>
          <option value="">Todos los clientes</option>
          {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar..." style={{...S.input,width:160}}/>
        <button onClick={()=>setShowAdvancedFilters(v=>!v)}
          style={{...S.btn,background:showAdvancedFilters?"#2563eb":"#fff",color:showAdvancedFilters?"#fff":"#475569",border:showAdvancedFilters?"1px solid #2563eb":"1px solid #dbe5ec"}}>
          Filtros avanzados
        </button>
        <button onClick={()=>setGroupByCliente(v=>!v)}
          title={groupByCliente ? "Volver a agrupar por fechas" : "Agrupar por cliente"}
          style={{...S.btn,background:groupByCliente?"#008b82":"#fff",color:groupByCliente?"#fff":"#475569",border:groupByCliente?"1px solid #008b82":"1px solid #dbe5ec"}}>
          {groupByCliente ? "Agrupado por cliente" : "Agrupado por fecha"}
        </button>
        <button onClick={()=>setSoloCriticos(v=>!v)}
          style={{...S.btn,background:soloCriticos?"#dc2626":"#fff",color:soloCriticos?"#fff":"#475569",border:soloCriticos?"1px solid #dc2626":"1px solid #dbe5ec"}}>
          {soloCriticos ? "Solo criticos" : "Ver criticos"}
        </button>
        {(filtroEst!=="todos"||filtroDesde||filtroHasta||filtroMes||filtroCliente||q||filtroSinAsignacion||filtroPendienteCompletar||filtroColaborador)&&(
          <button onClick={()=>{setFiltroEst("todos");setFiltroMes("");setFiltroFechasCustom(false);setFiltroDesde("");setFiltroHasta("");setFiltroCliente("");setQ("");setFiltroSinAsignacion(false);setFiltroPendienteCompletar(false);setFiltroColaborador(false);}}
            style={{...S.btn,background:"rgba(239,68,68,.12)",color:"#ef4444",border:"1px solid rgba(239,68,68,.2)",fontSize:11,padding:"4px 10px"}}>Reset</button>
        )}
        {vistaMesActualPorDefecto && (
          <span style={{
            fontSize:11,
            fontWeight:900,
            color:"#0f766e",
            background:"rgba(16,185,129,.10)",
            border:"1px solid rgba(16,185,129,.24)",
            borderRadius:999,
            padding:"5px 10px",
          }}>
            Mes actual: {_rangoMesActual.label}
          </span>
        )}
        <span style={{
          fontSize:12,
          color:searchHasMatches ? "#60a5fa" : "var(--text4)",
          marginLeft:"auto",
          padding:searchActive ? "4px 9px" : undefined,
          borderRadius:999,
          background:searchHasMatches ? "rgba(59,130,246,.12)" : searchActive ? "rgba(148,163,184,.08)" : undefined,
          border:searchHasMatches ? "1px solid rgba(59,130,246,.28)" : searchActive ? "1px solid var(--border2)" : undefined,
          fontWeight:searchHasMatches ? 900 : 500,
        }}>
          {searchActive
            ? `${pedidosVisiblesAccionables.length} coincidencia${pedidosVisiblesAccionables.length!==1?"s":""}`
            : soloCriticos ? `${pedidosVisibles.length} critico${pedidosVisibles.length!==1?"s":""}` : (totalCount>0?`${totalCount} pedido${totalCount!==1?"s":""}`:`${pedidos.length} pedido${pedidos.length!==1?"s":""}`)}
          {totalPages>1&&<span style={{marginLeft:6,color:"var(--text5)"}}>· pag {page}/{totalPages}</span>}
        </span>
      </div>

      {aiDisponible && vistaPedidos === "ia" && (
        <div style={{margin:"0 0 16px"}}>
          {noHayViajesParaPlanificar && (
            <div style={{background:"rgba(245,158,11,.10)",border:"1px solid rgba(245,158,11,.26)",borderRadius:9,padding:"12px 14px",color:"var(--text3)",fontSize:12,marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
              <div>
                <div style={{fontWeight:900,color:"var(--text)",marginBottom:3}}>La IA no puede planificar cargas</div>
                <div style={{color:"var(--text4)"}}>No hay viajes disponibles con los filtros actuales. Quieres crear un nuevo viaje?</div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={()=>setQuickCreando(true)}
                  style={{...S.btn,background:"#f59e0b",color:"#fff",border:"1px solid #f59e0b",padding:"8px 12px"}}
                >
                  Crear nuevo viaje
                </button>
              )}
            </div>
          )}
          {!aiVisualPlanActivo && (
            <div style={{background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.20)",borderRadius:9,padding:"9px 12px",color:"var(--text3)",fontSize:12,marginBottom:10}}>
              Bandeja IA en modo basico: emails, PDF/DOCX con texto y documentos legibles funcionan sin API externa. Imagenes o PDFs escaneados necesitan IA visual configurada.
            </div>
          )}
            <ModalCrearConIA
              clientes={clientes}
              vehiculos={vehiculos}
              choferes={choferes}
              embedded
              onClose={()=>setVistaPedidos("lista")}
              onCreado={p=>{ setVistaPedidos("lista"); setEditando({...p, _aiCreado:true}); setModal(true); }}
            />
        </div>
      )}

      {showAdvancedFilters && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"-6px 0 12px"}}>
          <button onClick={()=>setFiltroSinAsignacion(v=>!v)}
            style={{...S.btn,padding:"6px 12px",background:filtroSinAsignacion?"#7c3aed":"var(--bg3)",color:filtroSinAsignacion?"#fff":"var(--text3)",border:filtroSinAsignacion?"1px solid #7c3aed":"1px solid var(--border2)"}}>
            Sin asignacion completa
          </button>
          <button onClick={()=>setFiltroPendienteCompletar(v=>!v)}
            style={{...S.btn,padding:"6px 12px",background:filtroPendienteCompletar?"#b45309":"var(--bg3)",color:filtroPendienteCompletar?"#fff":"var(--text3)",border:filtroPendienteCompletar?"1px solid #b45309":"1px solid var(--border2)"}}>
            Pendientes de completar
          </button>
          <button onClick={()=>setFiltroColaborador(v=>!v)}
            style={{...S.btn,padding:"6px 12px",background:filtroColaborador?"#059669":"var(--bg3)",color:filtroColaborador?"#fff":"var(--text3)",border:filtroColaborador?"1px solid #059669":"1px solid var(--border2)"}}>
            Solo colaborador
          </button>
        </div>
      )}

      {(resumenCriticos.vencidos || resumenCriticos.urgentes || resumenCriticos.datos || resumenCriticos.sinAsignacion) ? (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"0 0 12px"}}>
          {resumenCriticos.vencidos > 0 && <span style={{display:"inline-flex",alignItems:"center",padding:"5px 10px",borderRadius:999,border:"1px solid rgba(239,68,68,.24)",background:"rgba(239,68,68,.10)",color:"#f87171",fontSize:11,fontWeight:800}}>{resumenCriticos.vencidos} vencido{resumenCriticos.vencidos !== 1 ? "s" : ""}</span>}
          {resumenCriticos.urgentes > 0 && <span style={{display:"inline-flex",alignItems:"center",padding:"5px 10px",borderRadius:999,border:"1px solid rgba(245,158,11,.22)",background:"rgba(245,158,11,.10)",color:"#fbbf24",fontSize:11,fontWeight:800}}>{resumenCriticos.urgentes} urgente{resumenCriticos.urgentes !== 1 ? "s" : ""}</span>}
          {resumenCriticos.datos > 0 && <span style={{display:"inline-flex",alignItems:"center",padding:"5px 10px",borderRadius:999,border:"1px solid rgba(59,130,246,.22)",background:"rgba(59,130,246,.10)",color:"#60a5fa",fontSize:11,fontWeight:800}}>{resumenCriticos.datos} con datos pendientes</span>}
          {resumenCriticos.sinAsignacion > 0 && <span style={{display:"inline-flex",alignItems:"center",padding:"5px 10px",borderRadius:999,border:"1px solid rgba(139,92,246,.22)",background:"rgba(139,92,246,.10)",color:"#a78bfa",fontSize:11,fontWeight:800}}>{resumenCriticos.sinAsignacion} sin asignacion completa</span>}
          <button
            onClick={() => setCriticalPanelOpen(v => !v)}
            style={{...S.btn,padding:"5px 12px",fontSize:11,background:"rgba(148,163,184,.10)",color:"var(--text3)",border:"1px solid var(--border2)"}}
          >
            {criticalPanelOpen ? "Ocultar avisos" : "Mostrar avisos"}
          </button>
        </div>
      ) : null}

      {canEdit && selectedPedidoIds.length > 0 && (
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",margin:"0 0 12px",padding:"10px 12px",borderRadius:9,background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.18)"}}>
          <span style={{fontSize:12,fontWeight:800,color:"#60a5fa"}}>
            {selectedPedidoIds.length} seleccionado{selectedPedidoIds.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={copiarSeleccionadosSemanaSiguiente}
            disabled={bulkCopying}
            style={{...S.btn,padding:"5px 10px",fontSize:11,background:"rgba(59,130,246,.10)",color:"#60a5fa",border:"1px solid rgba(59,130,246,.24)",opacity:bulkCopying?0.6:1,cursor:bulkCopying?"not-allowed":"pointer"}}
          >
            {bulkCopying ? "Copiando..." : "Copiar +1 semana"}
          </button>
          <button
            onClick={solicitarRetrasoSeleccionados}
            disabled={bulkRescheduling}
            style={{...S.btn,padding:"5px 10px",fontSize:11,background:"rgba(245,158,11,.10)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.24)",opacity:bulkRescheduling?0.6:1,cursor:bulkRescheduling?"not-allowed":"pointer"}}
          >
            {bulkRescheduling ? "Reprogramando..." : "Retrasar"}
          </button>
          <select
            value={bulkEstado}
            onChange={e => setBulkEstado(e.target.value)}
            style={{...S.sel,width:170,padding:"5px 10px",fontSize:11}}
          >
            {ESTADOS_RAW.map(e => <option key={e} value={e}>{LABEL_ESTADO[e]}</option>)}
          </select>
          <button
            onClick={limpiarAsignacionesSeleccionadas}
            disabled={bulkClearing}
            style={{...S.btn,padding:"5px 10px",fontSize:11,background:"rgba(239,68,68,.10)",color:"#f87171",border:"1px solid rgba(239,68,68,.24)",opacity:bulkClearing?0.6:1,cursor:bulkClearing?"not-allowed":"pointer"}}
          >
            {bulkClearing ? "Limpiando..." : "Limpiar asignacion"}
          </button>
          <button
            onClick={cambiarEstadoSeleccionados}
            disabled={bulkRescheduling}
            style={{...S.btn,padding:"5px 10px",fontSize:11,background:"rgba(16,185,129,.10)",color:"#10b981",border:"1px solid rgba(16,185,129,.24)",opacity:bulkRescheduling?0.6:1,cursor:bulkRescheduling?"not-allowed":"pointer"}}
          >
            Aplicar estado
          </button>
          <button
            onClick={() => setSelectedPedidoIds([])}
            style={{...S.btn,padding:"5px 10px",fontSize:11,background:"rgba(148,163,184,.10)",color:"var(--text3)",border:"1px solid var(--border2)"}}
          >
            Limpiar
          </button>
        </div>
      )}

      <div style={{...S.card, overflow:"visible",width:"100%",maxWidth:"100%",boxSizing:"border-box"}}>
        <table style={{width:"100%",maxWidth:"100%",borderCollapse:"collapse"}}>
          <thead><tr>
            <th style={{...S.th,width:42}}>
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
            </th>
            {["N. Pedido","Cliente","Origen -> Destino","F. Carga","H. Carga","F. Descarga","H. Descarga","Vehiculo","Estado","Importe","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={12} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Cargando...</td></tr>
            : loadError ? <tr><td colSpan={12} style={{...S.td,textAlign:"center",padding:26}}>
              <div style={{display:"grid",justifyItems:"center",gap:9}}>
                <div style={{fontSize:13,fontWeight:900,color:"#ef4444"}}>No se pudieron cargar los viajes.</div>
                <div style={{fontSize:12,color:"var(--text4)",maxWidth:520,lineHeight:1.45}}>
                  La lista no esta vacia necesariamente: la API no ha respondido correctamente. Reintenta y, si se repite, revisa el estado del servidor.
                </div>
                <button
                  type="button"
                  onClick={cargar}
                  style={{...S.btn,background:"rgba(239,68,68,.10)",color:"#ef4444",border:"1px solid rgba(239,68,68,.25)",padding:"7px 12px",fontSize:12}}
                >
                  Reintentar
                </button>
              </div>
            </td></tr>
            : pedidosVisibles.length===0 ? <tr><td colSpan={12} style={{...S.td,textAlign:"center",color:"var(--text4)",padding:26}}>
              {soloCriticos ? "No hay pedidos criticos con los filtros actuales." : (
                <div style={{display:"grid",justifyItems:"center",gap:8}}>
                  <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>No hay viajes disponibles con los filtros actuales.</div>
                  <div style={{fontSize:12,color:"var(--text4)"}}>Quieres crear un nuevo viaje?</div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={()=>setQuickCreando(true)}
                      style={{...S.btn,background:"var(--accent)",color:"#fff",border:"none",padding:"7px 12px",fontSize:12}}
                    >
                      Crear nuevo viaje
                    </button>
                  )}
                </div>
              )}
            </td></tr>
            : pedidosRenderList.map((entry)=>{
              if (entry?._group) {
                const isMonth = entry.type === "month";
                const isWeek = entry.type === "week";
                return (
                  <tr key={`group-${entry.key}`} style={{background:isMonth ? "var(--bg4)" : isWeek ? "var(--bg3)" : "var(--bg2)"}}>
                    <td colSpan={12} style={{...S.td,padding:isMonth ? "16px 18px" : isWeek ? "19px 22px" : "12px 18px 12px 56px",borderTop:(isMonth || isWeek) ? "1px solid var(--border)" : S.td.borderTop}}>
                      <button
                        onClick={() => setCollapsedClientes(prev => ({ ...prev, [entry.key]: !prev[entry.key] }))}
                        style={{display:"flex",alignItems:"center",gap:16,width:"100%",background:"transparent",border:"none",color:"var(--text)",cursor:"pointer",padding:0,fontFamily:"'DM Sans',sans-serif"}}
                      >
                        <span style={{fontSize:16,color:"#008b82",fontWeight:900,width:16}}>{entry.collapsed ? "+" : "−"}</span>
                        {isWeek && <span style={{width:48,height:48,borderRadius:10,background:"rgba(16,185,129,.10)",border:"1px solid rgba(16,185,129,.18)",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#008b82",fontSize:24}}>▣</span>}
                        <span style={{fontWeight:isMonth ? 950 : isWeek ? 900 : 850,fontSize:isMonth ? 14 : isWeek ? 17 : 13,textTransform:(isMonth || isWeek) ? "uppercase" : "none",letterSpacing:(isMonth || isWeek) ? ".04em" : 0}}>{entry.label}</span>
                        <span style={{fontSize:13,color:"#64748b",paddingLeft:10,borderLeft:"1px solid #dbe5ec"}}>{entry.count} pedido{entry.count !== 1 ? "s" : ""}</span>
                      </button>
                    </td>
                  </tr>
                );
              }
              const { pedido: p, priorityMeta } = entry;
              const cargasPedido = pedidoStopsForList(p, "carga");
              const descargasPedido = pedidoStopsForList(p, "descarga");
              const cargaPrincipal = cargasPedido[0] || {};
              const descargaPrincipal = descargasPedido[0] || {};
              const cargasAdicionales = cargasPedido.slice(1);
              const descargasAdicionales = descargasPedido.slice(1);
              const estadoRow = String(p.estado || "").toLowerCase();
              const estadoBackground =
                estadoRow === "en_curso" ? "rgba(34,211,238,.12)" :
                estadoRow === "descarga" ? "rgba(167,139,250,.10)" :
                estadoRow === "incidencia" ? "rgba(251,191,36,.12)" :
                undefined;
              const pendingCompleteBackground = p.pendiente_completar ? "rgba(251,191,36,.18)" : undefined;
              const rowBackground =
                String(focusPedido?.pedido_id || "") === String(p.id)
                  ? "rgba(34,211,160,.10)"
                  : pendingCompleteBackground
                    ? pendingCompleteBackground
                    : priorityMeta.flags.overdueAssignment
                    ? "rgba(239,68,68,.08)"
                    : priorityMeta.flags.urgentAssignment
                      ? "rgba(245,158,11,.07)"
                      : estadoBackground;
              const rowShadow =
                String(focusPedido?.pedido_id || "") === String(p.id)
                  ? "inset 3px 0 0 var(--green)"
                    : p.pendiente_completar
                    ? "inset 3px 0 0 rgba(245,158,11,.8)"
                    : priorityMeta.flags.overdueAssignment
                    ? "inset 3px 0 0 rgba(239,68,68,.85)"
                    : priorityMeta.flags.urgentAssignment
                      ? "inset 3px 0 0 rgba(245,158,11,.8)"
                      : estadoRow === "en_curso"
                        ? "inset 3px 0 0 rgba(34,211,238,.65)"
                        : estadoRow === "descarga"
                          ? "inset 3px 0 0 rgba(167,139,250,.55)"
                          : estadoRow === "incidencia"
                            ? "inset 3px 0 0 rgba(251,191,36,.55)"
                            : undefined;
              const actionMenuOpen = openActionMenuPedidoId === String(p.id);
              return (
              <tr key={p.id} id={`pedido-row-${p.id}`} style={{
                cursor:"pointer",
                opacity:pedidoTieneFacturaFinal(p)?0.85:1,
                background: rowBackground,
                boxShadow: rowShadow,
              }} onClick={()=>{
  if (pedidoTieneFacturaFinal(p)) abrirEditar(p);
  else abrirEditar(p);
}}>
                <td style={S.td} onClick={e=>e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedPedidoIds.includes(String(p.id))}
                    onChange={() => togglePedidoSelected(p.id)}
                  />
                </td>
                <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--accent-xl)"}}>
                  <div>{p.numero}</div>
                  {priorityMeta.reasons.length > 0 && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                      {priorityMeta.reasons.map(reason => (
                        <span key={reason.key} style={{
                          display:"inline-flex",
                          padding:"2px 6px",
                          borderRadius:5,
                          background: reason.tone === "danger" ? "rgba(239,68,68,.14)" : "rgba(245,158,11,.12)",
                          border: reason.tone === "danger" ? "1px solid rgba(239,68,68,.28)" : "1px solid rgba(245,158,11,.24)",
                          color: reason.tone === "danger" ? "#f87171" : "#fbbf24",
                          fontSize:9,
                          fontFamily:"'DM Sans',sans-serif",
                          fontWeight:800
                        }}>
                          {reason.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.pendiente_completar && (
                    <div title={p.aviso_completar || "Pendiente de completar"} style={{marginTop:4,display:"inline-flex",padding:"2px 6px",borderRadius:5,background:"rgba(251,191,36,.14)",border:"1px solid rgba(251,191,36,.32)",color:"#fbbf24",fontSize:9,fontFamily:"'DM Sans',sans-serif",fontWeight:800}}>
                      Completar
                    </div>
                  )}
                </td>
                <td style={{...S.td,fontWeight:600,fontSize:12}}>{p.cliente_nombre||"-"}</td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)",minWidth:190}}>
                  <div>{p.origen&&p.destino?`${p.origen} -> ${p.destino}`:"-"}</div>
                  {(cargasAdicionales.length > 0 || descargasAdicionales.length > 0) && (
                    <div style={{display:"grid",gap:3,marginTop:6,paddingTop:6,borderTop:"1px solid var(--border)"}}>
                      {cargasAdicionales.map((stop, index) => (
                        <div key={`carga-${index}-${stop.direccion || "parada"}`} style={{fontSize:10,lineHeight:1.35,color:"var(--text4)"}}>
                          <strong style={{color:"#0f9f95"}}>Carga {index + 2}:</strong> {stop.direccion || "Sin poblacion"}
                          {pedidoStopMeta(stop) && <div style={{color:"var(--text5)"}}>{pedidoStopMeta(stop)}</div>}
                        </div>
                      ))}
                      {descargasAdicionales.map((stop, index) => (
                        <div key={`descarga-${index}-${stop.direccion || "parada"}`} style={{fontSize:10,lineHeight:1.35,color:"var(--text4)"}}>
                          <strong style={{color:"#f59e0b"}}>Descarga {index + 2}:</strong> {stop.direccion || "Sin poblacion"}
                          {pedidoStopMeta(stop) && <div style={{color:"var(--text5)"}}>{pedidoStopMeta(stop)}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{...S.td,fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>{formatPedidoListDate(cargaPrincipal.fecha)||"-"}</td>
                <td style={{...S.td,fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>
                  <div>{formatPedidoListTime(cargaPrincipal.hora)||"-"}</div>
                  {cargaPrincipal.ventana && <div style={{fontSize:9,color:"var(--text5)",marginTop:3,fontFamily:"'DM Sans',sans-serif"}}>Ventana {cargaPrincipal.ventana}</div>}
                </td>
                <td style={{...S.td,fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>{formatPedidoListDate(descargaPrincipal.fecha)||"-"}</td>
                <td style={{...S.td,fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>
                  <div>{formatPedidoListTime(descargaPrincipal.hora)||"-"}</div>
                  {descargaPrincipal.ventana && <div style={{fontSize:9,color:"var(--text5)",marginTop:3,fontFamily:"'DM Sans',sans-serif"}}>Ventana {descargaPrincipal.ventana}</div>}
                </td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>
                  {p.colaborador_id ? (
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:"#a78bfa",marginBottom:2}}>COLABORADOR</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>{p.colaborador_nombre||"Externo"}</div>
                    </div>
                  ) : (
                    <>
                      <div style={{fontFamily:"'JetBrains Mono',monospace"}}>{p.vehiculo_matricula||"-"}</div>
                      {p.remolque_matricula && (
                        <div style={{fontSize:10,color:"#a78bfa",marginTop:1}}>REM {p.remolque_matricula}</div>
                      )}
                    </>
                  )}
                </td>
                <td style={S.td}>
                  <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-start"}}>
                    <Badge estado={p.estado}/>
                    {priorityMeta.validationIssues.length > 0 && (
                      <span title={priorityMeta.validationIssues.join(" · ")} style={{fontSize:10,color:"#fbbf24",fontWeight:700}}>
                        {priorityMeta.validationIssues.length} pendiente{priorityMeta.validationIssues.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </td>
                <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--text)"}}>{Number(p.importe||0).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR</td>
                <td style={S.td} onClick={e=>e.stopPropagation()}>
                  {pedidoTieneFacturaFinal(p)
                    ? <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)"}}>FACTURADO</span>
                        <span style={{fontSize:10,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>{p.factura_numero||""}</span>
                      </div>
                    : pedidoTieneFacturaBorrador(p)
                    ? <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:"rgba(59,110,245,.12)",color:"#60a5fa",border:"1px solid rgba(59,110,245,.25)"}}>BORRADOR</span><span style={{fontSize:10,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>{p.factura_numero||""}</span></div>
                    : <div style={{display:"flex",gap:5,flexWrap:"wrap",position:"relative"}}>
                        {canEdit && priorityMeta.validationIssues.length > 0 && (
                          <button onClick={e=>{e.stopPropagation();abrirEditar(p, {_focus_asignacion: priorityMeta.flags.missingVehiculo || priorityMeta.flags.missingChofer});}}
                            title={priorityMeta.validationIssues.join(" · ")}
                            style={{...S.btn,background:"rgba(251,191,36,.10)",color:"#fbbf24",border:"1px solid rgba(251,191,36,.25)",padding:"3px 8px",fontSize:11}}>
                            Completar datos
                          </button>
                        )}
                        {(priorityMeta.flags.overdueAssignment || priorityMeta.flags.urgentAssignment || priorityMeta.validationIssues.length > 0) && (
                          <button onClick={e=>{e.stopPropagation();openPedidoInTrafico(p);}}
                            style={{...S.btn,background:"rgba(59,130,246,.10)",color:"#60a5fa",border:"1px solid rgba(59,130,246,.25)",padding:"3px 8px",fontSize:11}}>
                            Ver trafico
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={e=>{e.stopPropagation();solicitarRetrasoPedido(p, p.numero || "este pedido");}}
                            disabled={reprogrammingPedidoId === String(p.id)}
                            title="Mover carga y descarga los dias que necesites"
                            style={{...S.btn,background:"rgba(245,158,11,.10)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.25)",padding:"3px 8px",fontSize:11,opacity:reprogrammingPedidoId === String(p.id) ? 0.6 : 1,cursor:reprogrammingPedidoId === String(p.id) ? "not-allowed" : "pointer"}}>
                            {reprogrammingPedidoId === String(p.id) ? "Moviendo..." : "Retrasar"}
                          </button>
                        )}
                        {false && canEdit && (
                          <button onClick={e=>{e.stopPropagation();abrirCopiarPedido(p);}}
                            title="Copiar viaje"
                            style={{...S.btn,background:"rgba(59,130,246,.10)",color:"#3b82f6",border:"1px solid rgba(59,130,246,.22)",padding:"3px 8px",fontSize:11}}>
                            Copiar
                          </button>
                        )}
                        {false && canEdit && (
                          <button onClick={e=>{e.stopPropagation();duplicarPedidoExistente(p);}}
                            title="Duplicar pedido"
                            style={{...S.btn,background:"rgba(16,185,129,.10)",color:"#10b981",border:"1px solid rgba(16,185,129,.22)",padding:"3px 8px",fontSize:11}}>
                            Duplicar
                          </button>
                        )}
                        {/* Eliminar pedido cancelado */}
                        {false && canEdit && p.estado === "cancelado" && (
                          <button onClick={async e=>{
                            e.stopPropagation();
                            const ok = await confirmDialog({
                              title: "Eliminar pedido",
                              message: `Eliminar el pedido ${p.numero}?\n\nEsta accion no se puede deshacer.`,
                              confirmText: "Eliminar",
                              tone: "danger",
                            });
                            if(!ok) return;
                            try { await eliminarPedido(p.id); cargar(); }
                            catch(err){ notify("Error al eliminar: "+err.message, "error"); }
                          }}
                            title="Eliminar pedido cancelado"
                            style={{...S.btn,background:"rgba(239,68,68,.1)",color:"#ef4444",border:"1px solid rgba(239,68,68,.3)",padding:"3px 9px",fontSize:11}}>
                            Eliminar
                          </button>
                        )}
                        {false && canEdit && !pedidoTieneFacturaFinal(p) && !pedidoTieneFacturaBorrador(p) && (
                          <button onClick={e=>{e.stopPropagation();abrirEditar(p, {_focus_asignacion:true});}}
                            title="Cambiar vehículo o chófer"
                            style={{...S.btn,background:"rgba(59,110,245,.12)",color:"#60a5fa",border:"1px solid rgba(59,110,245,.25)",padding:"3px 8px",fontSize:11}}>
                            Cambio veh.
                          </button>
                        )}
                        {false && canEdit && !pedidoTieneFacturaFinal(p) && !pedidoTieneFacturaBorrador(p) && (p.vehiculo_id || p.chofer_id || p.remolque_id || p.remolque_id_manual) && (
                          <button onClick={e=>{e.stopPropagation();limpiarAsignacionPedido(p);}}
                            title="Quitar asignacion para volver a planificar"
                            disabled={reprogrammingPedidoId === String(p.id)}
                            style={{...S.btn,background:"rgba(239,68,68,.10)",color:"#f87171",border:"1px solid rgba(239,68,68,.25)",padding:"3px 8px",fontSize:11,opacity:reprogrammingPedidoId === String(p.id) ? 0.6 : 1,cursor:reprogrammingPedidoId === String(p.id) ? "not-allowed" : "pointer"}}>
                            {reprogrammingPedidoId === String(p.id) ? "Limpiando..." : "Limpiar asignacion"}
                          </button>
                        )}
                        {canEdit && (priorityMeta.flags.missingVehiculo || priorityMeta.flags.missingChofer) && (
                          <button onClick={e=>{e.stopPropagation();setAutoAsignando(p);}}
                            title="Autoasignacion IA"
                            style={{...S.btn,background:"rgba(139,92,246,.12)",color:"#a78bfa",border:"1px solid rgba(139,92,246,.25)",padding:"3px 7px",fontSize:11}}>
                            Asignar
                          </button>
                        )}
                        {canEdit&&<select value={p.estado} onChange={e=>cambiarEstado(p.id,e.target.value)} style={{...S.sel,width:130,padding:"4px 8px",fontSize:11}}>
                          {ESTADOS_RAW.map(e=><option key={e} value={e}>{LABEL_ESTADO[e]}</option>)}
                        </select>}
                        {canFacturarPedidos&&!pedidoTieneFacturaFinal(p)&&!pedidoTieneFacturaBorrador(p)&&p.estado==="entregado"&&(
                          <button style={{...S.btn,background:"rgba(34,211,160,.12)",color:"var(--green)",border:"1px solid rgba(34,211,160,.2)",padding:"4px 10px",fontSize:11}} onClick={()=>setFacturando(p)}>Facturar</button>
                        )}
                        <button
                          onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId(actionMenuOpen ? "" : String(p.id));}}
                          style={{...S.btn,background:"rgba(148,163,184,.10)",color:"var(--text3)",border:"1px solid var(--border2)",padding:"4px 8px",fontSize:11}}
                        >
                          {actionMenuOpen ? "Cerrar" : "Mas"}
                        </button>
                        {actionMenuOpen && (
                          <div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:500,minWidth:190,padding:8,borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border2)",boxShadow:"0 18px 36px rgba(0,0,0,.18)",display:"flex",flexDirection:"column",gap:6}}>
                            {canEdit && (
                              <button onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");abrirCopiarPedido(p);}}
                                style={{...S.btn,textAlign:"left",background:"rgba(59,130,246,.10)",color:"#3b82f6",border:"1px solid rgba(59,130,246,.22)",padding:"6px 10px",fontSize:11}}>
                                Copiar viaje
                              </button>
                            )}
                            {canEdit && pedidoTieneFacturaFinal(p) && (
                              <button onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");abrirEditar(p);}}
                                style={{...S.btn,textAlign:"left",background:"rgba(245,158,11,.10)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.25)",padding:"6px 10px",fontSize:11}}>
                                Corregir pedido
                              </button>
                            )}
                            {canEdit && !pedidoTieneFacturaFinal(p) && !pedidoTieneFacturaBorrador(p) && (
                              <button onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");abrirEditar(p, {_focus_asignacion:true});}}
                                style={{...S.btn,textAlign:"left",background:"rgba(59,110,245,.12)",color:"#60a5fa",border:"1px solid rgba(59,110,245,.25)",padding:"6px 10px",fontSize:11}}>
                                Cambiar vehiculo/chofer
                              </button>
                            )}
                            {canEdit && !pedidoTieneFacturaFinal(p) && !pedidoTieneFacturaBorrador(p) && (
                              <button onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");setAutoAsignando(p);}}
                                style={{...S.btn,textAlign:"left",background:"rgba(139,92,246,.12)",color:"#a78bfa",border:"1px solid rgba(139,92,246,.25)",padding:"6px 10px",fontSize:11}}>
                                Autoasignacion IA
                              </button>
                            )}
                            {canEdit && !pedidoTieneFacturaFinal(p) && !pedidoTieneFacturaBorrador(p) && (p.vehiculo_id || p.chofer_id || p.remolque_id || p.remolque_id_manual) && (
                              <button onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");limpiarAsignacionPedido(p);}}
                                disabled={reprogrammingPedidoId === String(p.id)}
                                style={{...S.btn,textAlign:"left",background:"rgba(239,68,68,.10)",color:"#f87171",border:"1px solid rgba(239,68,68,.25)",padding:"6px 10px",fontSize:11,opacity:reprogrammingPedidoId === String(p.id) ? 0.6 : 1,cursor:reprogrammingPedidoId === String(p.id) ? "not-allowed" : "pointer"}}>
                                {reprogrammingPedidoId === String(p.id) ? "Limpiando..." : "Limpiar asignacion"}
                              </button>
                            )}
                            {p.cliente_telefono&&(
                              <button
                                style={{...S.btn,textAlign:"left",background:"rgba(37,211,102,.1)",color:"#25d366",border:"1px solid rgba(37,211,102,.25)",padding:"6px 10px",fontSize:11}}
                                disabled={whatsappSending === `${p.id}:cliente`}
                                onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");enviarWhatsappPedidoAccion(p, "cliente");}}>
                                {whatsappSending === `${p.id}:cliente` ? "Registrando..." : "WhatsApp cliente (estado)"}
                              </button>
                            )}
                            {p.chofer_id&&(
                              <button
                                style={{...S.btn,textAlign:"left",background:"rgba(37,211,102,.1)",color:"#25d366",border:"1px solid rgba(37,211,102,.25)",padding:"6px 10px",fontSize:11}}
                                disabled={whatsappSending === `${p.id}:chofer`}
                                onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");enviarWhatsappPedidoAccion(p, "chofer");}}>
                                {whatsappSending === `${p.id}:chofer` ? "Registrando..." : "WhatsApp chofer"}
                              </button>
                            )}
                            {p.chofer_id&&(
                              <button
                                style={{...S.btn,textAlign:"left",background:"rgba(59,130,246,.1)",color:"#60a5fa",border:"1px solid rgba(59,130,246,.25)",padding:"6px 10px",fontSize:11}}
                                disabled={whatsappSending === `${p.id}:app_chofer`}
                                onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");notificarChoferAppAccion(p);}}>
                                {whatsappSending === `${p.id}:app_chofer` ? "Enviando..." : "App chofer"}
                              </button>
                            )}
                            {p.colaborador_telefono&&(
                              <button
                                style={{...S.btn,textAlign:"left",background:"rgba(34,197,94,.1)",color:"#22c55e",border:"1px solid rgba(34,197,94,.25)",padding:"6px 10px",fontSize:11}}
                                disabled={whatsappSending === `${p.id}:colaborador`}
                                onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");enviarWhatsappPedidoAccion(p, "colaborador");}}>
                                {whatsappSending === `${p.id}:colaborador` ? "Registrando..." : "WhatsApp colaborador"}
                              </button>
                            )}
                            {canEdit&&!pedidoTieneFacturaFinal(p)&&!pedidoTieneFacturaBorrador(p)&&(
                              <button style={{...S.btn,textAlign:"left",background:"rgba(99,102,241,.1)",color:"#818cf8",border:"1px solid rgba(99,102,241,.2)",padding:"6px 10px",fontSize:11}}
                                onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");abrirOrdenCarga(p);}}>
                                Orden de carga
                              </button>
                            )}
                            <button
                              style={{...S.btn,textAlign:"left",background:"rgba(245,158,11,.1)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.25)",padding:"6px 10px",fontSize:11}}
                              onClick={async e=>{
                                e.stopPropagation();
                                setOpenActionMenuPedidoId("");
                                try {
                                  const data = await getCartaPorte(p.id);
                                  setCartaPorte(data);
                                } catch(err) { notify("Error al cargar datos: "+err.message, "error"); }
                              }}>
                              Carta de porte / CMR
                            </button>
                            {canEdit && p.estado !== "cancelado" && !pedidoTieneFacturaFinal(p) && !pedidoTieneFacturaBorrador(p) && (
                              <button onClick={e=>{e.stopPropagation();setOpenActionMenuPedidoId("");solicitarCancelacionPedido(p);}}
                                style={{...S.btn,textAlign:"left",background:"rgba(239,68,68,.10)",color:"#ef4444",border:"1px solid rgba(239,68,68,.28)",padding:"6px 10px",fontSize:11}}>
                                Cancelar pedido
                              </button>
                            )}
                            {canEdit && p.estado === "cancelado" && (
                              <button onClick={async e=>{
                                e.stopPropagation();
                                setOpenActionMenuPedidoId("");
                                const ok = await confirmDialog({
                                  title: "Eliminar pedido",
                                  message: `Eliminar el pedido ${p.numero}?\n\nEsta accion no se puede deshacer.`,
                                  confirmText: "Eliminar",
                                  tone: "danger",
                                });
                                if(!ok) return;
                                try { await eliminarPedido(p.id); cargar(); }
                                catch(err){ notify("Error al eliminar: "+err.message, "error"); }
                              }}
                                style={{...S.btn,textAlign:"left",background:"rgba(239,68,68,.1)",color:"#ef4444",border:"1px solid rgba(239,68,68,.3)",padding:"6px 10px",fontSize:11}}>
                                Eliminar pedido
                              </button>
                            )}
                          </div>
                        )}
                        {false && p.cliente_telefono&&(
                          <a href={`https://wa.me/${(p.cliente_telefono||"").replace(/[^0-9]/g,"")}?text=${encodeURIComponent("Estimado/a "+p.cliente_nombre+", le confirmamos el pedido "+p.numero+" de "+p.origen+" a "+p.destino+". Fecha de carga: "+(p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):"pendiente")+". Atentamente, TransGest TMS")}`}
                            target="_blank" rel="noopener noreferrer"
                            style={{...S.btn,background:"rgba(37,211,102,.1)",color:"#25d366",border:"1px solid rgba(37,211,102,.25)",padding:"4px 8px",fontSize:11,textDecoration:"none"}}
                            onClick={e=>e.stopPropagation()}>
                            WhatsApp
                          </a>
                        )}
                        {false && canEdit&&!pedidoTieneFacturaFinal(p)&&!pedidoTieneFacturaBorrador(p)&&(
                          <button style={{...S.btn,background:"rgba(99,102,241,.1)",color:"#818cf8",border:"1px solid rgba(99,102,241,.2)",padding:"4px 8px",fontSize:11}}
                            onClick={e=>{e.stopPropagation();abrirOrdenCarga(p);}}>
                            O. carga
                          </button>
                        )}
                        {false && <button
                          title="Generar Carta de Porte / CMR / Albaran"
                          style={{...S.btn,background:"rgba(245,158,11,.1)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.25)",padding:"4px 8px",fontSize:11}}
                          onClick={async e=>{
                            e.stopPropagation();
                            try {
                              const data = await getCartaPorte(p.id);
                              setCartaPorte(data);
                            } catch(err) { notify("Error al cargar datos: "+err.message, "error"); }
                          }}>
                          CMR
                        </button>}
                      </div>
                  }
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {/* Paginacion */}
      {totalPages>1&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px 0",marginTop:4,flexWrap:"wrap"}}>
          <button onClick={()=>setPage(1)} disabled={page===1}
            style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:page===1?"not-allowed":"pointer",opacity:page===1?.5:1}}>
            {"<<"}
          </button>
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
            style={{padding:"5px 12px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:page===1?"not-allowed":"pointer",opacity:page===1?.5:1}}>
            Anterior
          </button>
          <span style={{fontSize:13,color:"var(--text3)",fontWeight:600,padding:"0 8px"}}>
            Pagina {page} de {totalPages} - {totalCount} pedidos
          </span>
          <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
            style={{padding:"5px 12px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:page===totalPages?"not-allowed":"pointer",opacity:page===totalPages?.5:1}}>
            Siguiente
          </button>
          <button onClick={()=>setPage(totalPages)} disabled={page===totalPages}
            style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:page===totalPages?"not-allowed":"pointer",opacity:page===totalPages?.5:1}}>
            {">>"}
          </button>
        </div>
      )}

      {copyPlan && (
        <div style={S.modal} onClick={e=>e.target===e.currentTarget && !copySaving && setCopyPlan(null)}>
          <div style={{...S.mbox, width:"min(520px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,marginBottom:16,color:"var(--text)"}}>
              Copiar viaje
            </div>
            <div style={{background:"rgba(59,110,245,.07)",border:"1px solid rgba(59,110,245,.15)",borderRadius:8,padding:"12px 16px",marginBottom:16}}>
              <div style={{fontWeight:700,color:"var(--text)"}}>{copyPlan.source?.numero || "Pedido"}</div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>
                {(copyPlan.source?.origen || "-")} -> {(copyPlan.source?.destino || "-")}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <label style={S.lbl}>Fecha primera copia</label>
                <input
                  type="date"
                  min="2000-01-01"
                  max="2100-12-31"
                  style={S.inp}
                  value={copyPlan.fecha_carga || ""}
                  onChange={e=>setCopyPlan(prev=>({...prev, fecha_carga:e.target.value, fechas_copia:normalizarFechasCopia(e.target.value, prev?.copias || 1, prev?.fechas_copia)}))}
                />
              </div>
              <div>
                <label style={S.lbl}>Numero de copias</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  style={S.inp}
                  value={copyPlan.copias || 1}
                  onChange={e=>setCopyPlan(prev=>({...prev, copias:e.target.value, fechas_copia:normalizarFechasCopia(prev?.fecha_carga, e.target.value, prev?.fechas_copia)}))}
                />
              </div>
              {(copyPlan.fechas_copia || normalizarFechasCopia(copyPlan.fecha_carga, copyPlan.copias)).map((fecha, idx) => (
                <div key={`fecha-copia-${idx}`}>
                  <label style={S.lbl}>{(Number(copyPlan.copias || 1) > 1) ? `Fecha copia ${idx + 1}` : "Fecha de copia"}</label>
                  <input
                    type="date"
                    min="2000-01-01"
                    max="2100-12-31"
                    style={S.inp}
                    value={fecha || ""}
                    onChange={e=>setCopyPlan(prev=>{
                      const fechas = normalizarFechasCopia(prev?.fecha_carga, prev?.copias || 1, prev?.fechas_copia);
                      fechas[idx] = e.target.value;
                      return {...prev, fecha_carga:idx===0 ? e.target.value : prev?.fecha_carga, fechas_copia:fechas};
                    })}
                  />
                </div>
              ))}
            </div>
            <label style={{display:"flex",alignItems:"center",gap:10,marginTop:16,padding:"10px 12px",border:"1px solid var(--border)",borderRadius:8,background:"var(--bg3)"}}>
              <input
                type="checkbox"
                checked={!!copyPlan.mantener_asignacion}
                onChange={e=>setCopyPlan(prev=>({...prev, mantener_asignacion:e.target.checked}))}
              />
              <span style={{fontSize:12,color:"var(--text2)"}}>Copiar asignacion (vehiculo, chofer, remolque o colaborador)</span>
            </label>
            <div style={{fontSize:11,color:"var(--text5)",marginTop:10}}>
              Cada copia se crea en la fecha indicada. Si desmarcas la asignacion, saldran sin vehiculo, chofer, colaborador, remolque ni matriculas manuales.
            </div>
            <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
              <button
                style={{...S.btn,background:"transparent",color:"var(--text2)",border:"1px solid var(--border2)"}}
                onClick={()=>setCopyPlan(null)}
                disabled={copySaving}
              >
                Cancelar
              </button>
              <button
                style={{...S.btn,background:"#3b6ef5",color:"#fff",opacity:copySaving?0.7:1}}
                onClick={confirmarCopiaPedido}
                disabled={copySaving}
              >
                {copySaving ? "Copiando..." : "Crear copias"}
              </button>
            </div>
          </div>
        </div>
      )}

      {delayRequest && (
        <div style={S.modal} onClick={e=>e.target===e.currentTarget && cerrarSelectorRetraso(null)}>
          <div style={{...S.mbox, width:"min(440px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,marginBottom:10,color:"var(--text)"}}>
              Retrasar carga
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:14}}>
              Indica cuantos dias quieres retrasar {delayRequest.etiqueta || "este pedido"}. Se mantendra la separacion entre carga y descarga.
            </div>
            <label style={S.lbl}>Dias de retraso</label>
            <input
              type="number"
              min="1"
              max="365"
              step="1"
              autoFocus
              style={S.inp}
              value={delayRequest.value}
              onChange={e=>setDelayRequest(prev=>({...prev, value:e.target.value}))}
              onKeyDown={e=>{
                if (e.key === "Enter") confirmarSelectorRetraso();
                if (e.key === "Escape") cerrarSelectorRetraso(null);
              }}
            />
            <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
              <button
                style={{...S.btn,background:"transparent",color:"var(--text2)",border:"1px solid var(--border2)"}}
                onClick={()=>cerrarSelectorRetraso(null)}
              >
                Cancelar
              </button>
              <button
                style={{...S.btn,background:"#f59e0b",color:"#111827"}}
                onClick={confirmarSelectorRetraso}
              >
                Retrasar
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <PedidoModal
          key={editando?.id||"new"}
          editando={editando}
          onClose={()=>{ const abrirSiguiente = !!editando?._copyReview; setModal(false);setEditando(null); if (abrirSiguiente) abrirSiguienteCopiaPendiente(); }}
          onSaved={()=>{ const abrirSiguiente = !!editando?._copyReview; if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail: { pedido_id: editando?.id || null, source: "pedidos-modal-save" } })); if (guidedPedidoActive) setGuidedPedido(prev => ({ ...(prev || { active:true }), saved:true, modalOpened:true, progress:buildGuidedPedidoProgress(prev?.lastForm || {}, { modalOpened:true, saved:true }) })); setModal(false);setEditando(null);cargar(); if (abrirSiguiente) abrirSiguienteCopiaPendiente();}}
          onReload={()=>{cargar();}}
          onFacturaDesvinculada={(pedidoId)=>{
            setPedidos(prev=>prev.map(p=>String(p.id)===String(pedidoId)
              ? {...p, factura_id:null, factura_estado:null, factura_numero:null, facturado:false}
              : p
            ));
            setEditando(prev=>prev && String(prev.id)===String(pedidoId)
              ? {...prev, factura_id:null, factura_estado:null, factura_numero:null, facturado:false, _readonly:false}
              : prev
            );
          }}
          pedidos={pedidos}
          clientes={clientes}
          vehiculos={vehiculos}
          choferes={choferes}
          rutas={rutas}
          colaboradores={colaboradores}
          canEdit={canEdit}
          guidedActive={guidedPedidoActive}
          onGuidedProgress={updateGuidedPedidoProgress}
        />
      )}
      {/* ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Orden de carga ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ */}
      {ordenCarga && <OrdenCargaModal pedido={ordenCarga} onClose={()=>setOrdenCarga(null)}/>}

      {/* ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Autoasignacion IA ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ */}
      {autoAsignando && (
        <ModalAutoAsignacion
          pedido={autoAsignando}
          vehiculos={vehiculos}
          choferes={choferes}
          onClose={()=>setAutoAsignando(null)}
          onAsignar={async(asig)=>{
            try {
              await editarPedido(autoAsignando.id, buildPedidoUpdatePayload(autoAsignando, {
                vehiculo_id: asig.vehiculo_id || autoAsignando.vehiculo_id,
                chofer_id: asig.chofer_id || autoAsignando.chofer_id,
                remolque_id_manual: asig.remolque_id_manual,
              }));
              cargar();
            } catch(e) { notify("Error al asignar: " + e.message, "error"); }
          }}
        />
      )}

      {/* ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Crear pedido con IA ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ */}
      {aiDisponible && aiCreando && <ModalCrearConIA clientes={clientes} vehiculos={vehiculos} choferes={choferes}
        onClose={()=>setAiCreando(false)}
        onCreado={p=>{ setAiCreando(false); setEditando({...p, _aiCreado:true}); setModal(true); }}/>}

      {quickCreando && (
        <ModalPedidoRapido
          clientes={clientes}
          vehiculos={vehiculos}
          choferes={choferes}
          colaboradores={colaboradores}
          onClose={()=>setQuickCreando(false)}
          onCreado={()=>{ setQuickCreando(false); cargar(); }}
        />
      )}

      {/* ModalNuevoClienteRapido is handled inside PedidoModal */}

      {/* Modal facturar */}
      {facturando&&(
        <div style={S.modal} onClick={e=>e.target===e.currentTarget&&setFacturando(null)}>
          <div style={{...S.mbox,width:"min(520px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,marginBottom:16,color:"var(--text)"}}>Emitir factura</div>
            <div style={{background:"rgba(59,110,245,.07)",border:"1px solid rgba(59,110,245,.15)",borderRadius:8,padding:"12px 16px",marginBottom:16}}>
              <div style={{fontWeight:600,color:"var(--text)",marginBottom:4}}>{facturando.numero} - {facturando.cliente_nombre}</div>
              <div style={{color:"var(--text2)",fontSize:12}}>{facturando.origen} -> {facturando.destino}</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"var(--green)",fontSize:20,marginTop:6}}>{Number(facturando.importe||0).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR</div>
            </div>
            <FacturarConcepto pedido={facturando} saving={savingFactura} onConfirm={async p=>{setSavingFactura(true);try{await convertirFacturaConConcepto(p);}finally{setSavingFactura(false);setFacturando(null);}}} onCancel={()=>setFacturando(null)}/>
          </div>
        </div>
      )}

      {/* ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ Carta de Porte / CMR modal ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ÃÂ¢Ã¢â¬ÂÃ¢âÂ¬ */}
      {cartaPorte && (
        <CartaPorteModal data={cartaPorte} onClose={()=>setCartaPorte(null)}/>
      )}
      <GuidedPedidoTutorialPanel
        active={guidedPedidoActive}
        progress={guidedPedido?.progress || {}}
        onStart={openGuidedPedidoModal}
        onClose={closeGuidedPedido}
      />
    </div>
  );
}






