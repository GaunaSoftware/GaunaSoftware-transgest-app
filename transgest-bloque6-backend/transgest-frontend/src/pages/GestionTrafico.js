import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getVehiculos, getPedidosResumenLista, getPedido, getPedidoEventos, getPedidoIdaRetorno, enlazarPedidoRetorno, desvincularPedidoRetorno, getChoferes, getRutas, editarPedido, cambiarEstadoPedido, desvincularFacturaPedido, actualizarKmVehiculo, actualizarPosicionVehiculo, getRouteProviders, optimizarRuta, getRutaOptimizadaPedido, getRutaEnviosPedido, enviarRutaOptimizada, avisarClientePedido, crearPedido, getEmpresaConfig, getNotificaciones, marcarNotificacionLeida, guardarPlanDiarioOrden } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";
import { clearRuntimeFocus, readRuntimeFocus, setRuntimeFocus } from "../services/runtimeFocus";
import { inferPlaceGeo } from "../utils/placeGeo";

// â”€â”€ Calculadora de tiempo de conducciÃ³n â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calcTiempoTransito(km, cfg){
  if (!km || km <= 0) return null;
  const vel    = Number(cfg?.velocidad_media || 80);
  const pausaC = Number(cfg?.horas_pausa     || 4.5);
  const pausaM = Number(cfg?.min_pausa       || 45);
  const descM  = Number(cfg?.tiempo_descarga || 60);
  const horasConduccion = km / vel;
  const pausas = Math.floor(horasConduccion / pausaC);
  const totalMinutos = Math.round(horasConduccion * 60) + pausas * pausaM + descM;
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return { h, m, label: h + "h" + (m > 0 ? " " + m + "min" : ""), totalMin: totalMinutos };
}

function cfgTraficoLoad(){
  try {
    if (typeof window !== "undefined" && window.__TMS_CFG_TRAFICO && typeof window.__TMS_CFG_TRAFICO === "object") {
      return window.__TMS_CFG_TRAFICO;
    }
  } catch {}
  return {};
}

function pedidoTieneFacturaFinal(pedido){
  const facturaId = pedido?.factura_id && pedido.factura_id !== "null";
  const estadoFactura = String(pedido?.factura_estado || pedido?.estado_factura || "").toLowerCase();
  if (facturaId && estadoFactura && estadoFactura !== "borrador") return true;
  return Boolean(facturaId && pedido?.facturado);
}

function tipoViajeLabel(tipo) {
  const raw = String(tipo || "normal").toLowerCase();
  if (raw === "salida") return "Salida";
  if (raw === "retorno") return "Retorno";
  return "Normal";
}

function buildChoferCopyData(chofer, vehiculo) {
  const nombre = `${chofer?.nombre || ""} ${chofer?.apellidos || ""}`.replace(/\s+/g, " ").trim() || "-";
  const matriculas = [vehiculo?.matricula, vehiculo?.remolque_matricula].filter(Boolean).join(" + ") || "-";
  return [
    `Matriculas: ${matriculas}`,
    `Chofer: ${nombre}`,
    `Telefono: ${chofer?.telefono || chofer?.movil || "-"}`,
    `DNI: ${chofer?.dni || chofer?.nif || "-"}`,
  ].join("\n");
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
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

// â”€â”€ Constantes de estado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function numOperacion(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPedidoFinancialSnapshot(pedido) {
  const esColaborador = Boolean(pedido?.colaborador_id || pedido?.colaborador_nombre);
  const ingreso = esColaborador
    ? numOperacion(pedido?.precio_cliente_col || pedido?.importe)
    : numOperacion(pedido?.importe || pedido?.precio_cliente_col);
  const costeColaborador = esColaborador ? numOperacion(pedido?.precio_colaborador) : 0;
  const costesPropios = esColaborador ? 0 : [
    pedido?.coste_gasoil,
    pedido?.coste_peajes,
    pedido?.coste_dietas,
    pedido?.coste_otros,
  ].reduce((sum, value) => sum + numOperacion(value), 0);
  const costes = costeColaborador + costesPropios;
  const margen = ingreso - costes;
  const pct = ingreso > 0 ? (margen / ingreso) * 100 : 0;
  return {
    ingreso,
    costes,
    margen,
    pct,
    esColaborador,
    sinPrecio: ingreso <= 0,
    margenNegativo: ingreso > 0 && margen < 0,
  };
}

function fmtEur(value) {
  return `${numOperacion(value).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

function cantidadTarifaPedido(pedido, tipo = "viaje") {
  if (!tipo || tipo === "viaje") return 1;
  if (tipo === "kg") return numOperacion(pedido?.peso_kg || pedido?.kg);
  if (tipo === "tonelada") return numOperacion(pedido?.peso_kg || pedido?.kg) / 1000;
  if (tipo === "km") return numOperacion(pedido?.km_ruta || pedido?.km);
  if (tipo === "palet") return numOperacion(pedido?.bultos);
  if (tipo === "hora") return numOperacion(pedido?.cantidad);
  return numOperacion(pedido?.cantidad);
}

function calcularTarifaRutaPedido(pedido, ruta) {
  if (!pedido || !ruta) return null;
  const tipo = ruta.tarifa_tipo || pedido.tipo_precio || "viaje";
  const precioBase = numOperacion(ruta.precio_base || ruta.precio);
  if (precioBase <= 0) return null;
  const recargoPct = numOperacion(ruta.recargo_combustible_pct);
  const precioUnitario = Number((precioBase * (1 + recargoPct / 100)).toFixed(4));
  const minEur = numOperacion(ruta.minimo_facturable);
  const minUnits = numOperacion(ruta.minimo_unidades || (tipo !== "viaje" ? ruta.minimo_facturable : 0));
  const cantidadBase = cantidadTarifaPedido(pedido, tipo);
  const cantidad = tipo === "viaje" ? 1 : Math.max(cantidadBase, minUnits || 0);
  let importe = 0;
  if (tipo === "viaje") importe = precioUnitario;
  else if (tipo === "kg") importe = (cantidad / 100) * precioUnitario;
  else importe = cantidad * precioUnitario;
  if (tipo === "viaje" && minEur > 0) importe = Math.max(importe, minEur);
  return {
    ruta,
    tipo,
    precioBase,
    precioUnitario,
    recargoPct,
    cantidad,
    importe: Number((Number.isFinite(importe) ? importe : 0).toFixed(2)),
  };
}

function buscarTarifaRutaPedido(pedido, rutas = []) {
  const origen = normalizeSearchText(pedido?.origen);
  const destino = normalizeSearchText(pedido?.destino);
  if (!origen || !destino) return null;
  const clienteId = String(pedido?.cliente_id || "");
  const candidatas = (Array.isArray(rutas) ? rutas : []).filter(r => {
    const rOrigen = normalizeSearchText(r.origen);
    const rDestino = normalizeSearchText(r.destino);
    if (!rOrigen || !rDestino) return false;
    const sameRoute = rOrigen === origen && rDestino === destino;
    if (!sameRoute) return false;
    if (r.cliente_id && clienteId && String(r.cliente_id) !== clienteId) return false;
    return true;
  });
  return candidatas.sort((a, b) => {
    const aCliente = a.cliente_id && clienteId && String(a.cliente_id) === clienteId ? 0 : 1;
    const bCliente = b.cliente_id && clienteId && String(b.cliente_id) === clienteId ? 0 : 1;
    return aCliente - bCliente;
  }).map(r => calcularTarifaRutaPedido(pedido, r)).find(Boolean) || null;
}

const EC = {
  en_curso:   { label:"En Curso",   color:"#f97316", bg:"rgba(249,115,22,.18)",  border:"rgba(249,115,22,.5)"  },
  espera_carga: { label:"Espera carga", color:"#eab308", bg:"rgba(234,179,8,.16)", border:"rgba(234,179,8,.45)" },
  cargando: { label:"Cargando", color:"#14b8a6", bg:"rgba(20,184,166,.16)", border:"rgba(20,184,166,.45)" },
  espera_descarga: { label:"Espera descarga", color:"#d946ef", bg:"rgba(217,70,239,.16)", border:"rgba(217,70,239,.45)" },
  descarga: { label:"En descarga", color:"#a78bfa", bg:"rgba(167,139,250,.16)", border:"rgba(167,139,250,.45)" },
  confirmado: { label:"Confirmado", color:"#3b82f6", bg:"rgba(59,130,246,.18)",  border:"rgba(59,130,246,.5)"  },
  pendiente:  { label:"Pendiente",  color:"#9ca3af", bg:"rgba(156,163,175,.14)", border:"rgba(156,163,175,.4)" },
  entregado:  { label:"Entregado",  color:"#10b981", bg:"rgba(16,185,129,.16)",  border:"rgba(16,185,129,.45)" },
  cancelado:  { label:"Cancelado",  color:"#ef4444", bg:"rgba(239,68,68,.14)",   border:"rgba(239,68,68,.4)"   },
  facturado:  { label:"Facturado",  color:"#8b5cf6", bg:"rgba(139,92,246,.15)",  border:"rgba(139,92,246,.4)"  },
};

const QUICK_STATE_FLOW = {
  pendiente: { next: "confirmado", label: "Confirmar" },
  confirmado: { next: "espera_carga", label: "Espera carga" },
  espera_carga: { next: "cargando", label: "Cargando" },
  cargando: { next: "en_curso", label: "En curso" },
  en_curso: { next: "espera_descarga", label: "Espera descarga" },
  espera_descarga: { next: "descarga", label: "Descarga" },
  descarga: { next: "entregado", label: "Entregar" },
};
const CRITICAL_ALERTS_STORAGE_KEY = "tms_trafico_critical_alerts_read";

function broadcastPedidosChanged(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tms:pedidos-changed", { detail }));
}

function navegarModulo(view) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: view }));
}

function loadReadCriticalAlerts() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CRITICAL_ALERTS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Estado vehiculo
const EV = {
  disponible:   { label:"Disponible",    color:"#10b981" },
  en_ruta:      { label:"En Ruta",       color:"#3b82f6" },
  taller:       { label:"Mantenimiento", color:"#f97316" },
  cargando:     { label:"Cargando",      color:"#f59e0b" },
  descargando:  { label:"Descargando",   color:"#a78bfa" },
  baja:         { label:"Baja",          color:"#4b5675" },
  inactivo:     { label:"Inactivo",      color:"#4b5675" },
};

function readTraficoFocus() {
  return readRuntimeFocus("tms_trafico_focus");
}

function safeStops(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function cleanAddress(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getPedidoClienteLabel(pedido) {
  return cleanAddress(pedido?.cliente_nombre || pedido?.cliente || "Sin cliente") || "Sin cliente";
}

function getPedidoClienteKey(pedido) {
  const byId = pedido?.cliente_id ? `id:${pedido.cliente_id}` : "";
  if (byId) return byId;
  const label = normalizeSearchText(getPedidoClienteLabel(pedido));
  return label ? `name:${label}` : "name:sin-cliente";
}

function stopAddressFull(stop) {
  if (!stop || typeof stop !== "object") return cleanAddress(stop);
  return cleanAddress([
    stop.direccion || stop.lugar || stop.nombre,
    stop.codigo_postal || stop.cp,
    stop.ciudad,
    stop.provincia,
    stop.pais,
  ].filter(Boolean).join(", "));
}

function stopName(stop, fallback) {
  if (!stop || typeof stop !== "object") return fallback || "";
  return cleanAddress(stop.cliente_nombre || stop.nombre || stop.empresa || fallback || stopAddressFull(stop));
}

function toDateInputValue(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function toTimeInputValue(value) {
  if (!value) return "";
  const match = String(value).match(/(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function normalizePedidoForModal(pedido) {
  if (!pedido || typeof pedido !== "object") return pedido;
  return {
    ...pedido,
    fecha_pedido: toDateInputValue(pedido.fecha_pedido),
    fecha_carga: toDateInputValue(pedido.fecha_carga),
    fecha_descarga: toDateInputValue(pedido.fecha_descarga || pedido.fecha_entrega),
    fecha_entrega: toDateInputValue(pedido.fecha_entrega),
    hora_carga: toTimeInputValue(pedido.hora_carga),
    hora_descarga: toTimeInputValue(pedido.hora_descarga),
    puntos_carga: safeStops(pedido.puntos_carga),
    puntos_descarga: safeStops(pedido.puntos_descarga),
    extracostes: Array.isArray(pedido.extracostes) ? pedido.extracostes : [],
  };
}

function sumarDiasISO(fecha, dias) {
  if (!fecha) return "";
  const base = new Date(`${String(fecha).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return String(fecha).slice(0, 10);
  base.setDate(base.getDate() + Number(dias || 0));
  return base.toISOString().slice(0, 10);
}

function sanitizePedidoCopyPayload(payload) {
  const out = { ...payload };
  [
    "id","numero","factura_id","factura_estado","factura_numero","facturado",
    "created_at","updated_at","orden_carga_numero","orden_carga_generada_at",
    "carta_porte_numero","carta_porte_generada_at","workflow_colaborador_enviado_at",
    "workflow_colaborador_confirmado_at","workflow_colaborador_cargado_at",
    "workflow_colaborador_en_camino_at","workflow_colaborador_descargado_at",
    "firma_entrega","firma_colaborador","albaranes","docs","eventos",
    "cliente_nombre","chofer_nombre","vehiculo_matricula","colaborador_nombre",
    "viaje_enlazado_id","grupo_ida_vuelta","km_vacio_enlace","enlace_retorno_at","enlace_retorno_by",
    "_readonly","_duplicado","_aiCreado","facturado_label"
  ].forEach(k => { delete out[k]; });
  out.tipo_viaje = "normal";
  Object.entries(out).forEach(([key, value]) => {
    if (value === undefined) out[key] = null;
    if (typeof value === "string" && !value.trim()) out[key] = null;
  });
  return out;
}

function buildPedidoCopyPayload(pedido, { offsetDays = 7, keepAssignment = true } = {}) {
  const fechaCargaBase = toDateInputValue(pedido?.fecha_carga || pedido?.fecha_pedido);
  const fechaDescargaBase = toDateInputValue(pedido?.fecha_descarga || pedido?.fecha_entrega || fechaCargaBase);
  const deltaDias = fechaCargaBase && fechaDescargaBase
    ? Math.round((new Date(`${fechaDescargaBase}T00:00:00`) - new Date(`${fechaCargaBase}T00:00:00`)) / 86400000)
    : 0;
  const fecha_carga = sumarDiasISO(fechaCargaBase || new Date().toISOString().slice(0, 10), offsetDays);
  const fecha_descarga = fechaDescargaBase ? sumarDiasISO(fecha_carga, Number.isFinite(deltaDias) ? deltaDias : 0) : null;
  return sanitizePedidoCopyPayload({
    ...pedido,
    estado: "pendiente",
    numero: null,
    fecha_carga,
    fecha_descarga,
    fecha_entrega: fecha_descarga,
    fecha_pedido: new Date().toISOString().slice(0, 10),
    pendiente_completar: true,
    aviso_completar: "Viaje copiado desde trafico: revisar fechas, asignacion y precio antes de cerrar.",
    puntos_carga: safeStops(pedido?.puntos_carga),
    puntos_descarga: safeStops(pedido?.puntos_descarga),
    vehiculo_id: keepAssignment ? pedido?.vehiculo_id || null : null,
    chofer_id: keepAssignment ? pedido?.chofer_id || null : null,
    remolque_id: keepAssignment ? pedido?.remolque_id || null : null,
  });
}

function buildPedidoReschedulePayload(pedido, offsetDays = 1) {
  const fechaCargaBase = toDateInputValue(pedido?.fecha_carga || pedido?.fecha_pedido);
  const fechaDescargaBase = toDateInputValue(pedido?.fecha_descarga || pedido?.fecha_entrega || fechaCargaBase);
  const deltaDias = fechaCargaBase && fechaDescargaBase
    ? Math.round((new Date(`${fechaDescargaBase}T00:00:00`) - new Date(`${fechaCargaBase}T00:00:00`)) / 86400000)
    : 0;
  const nuevaFechaCarga = sumarDiasISO(fechaCargaBase || new Date().toISOString().slice(0, 10), offsetDays);
  const nuevaFechaDescarga = fechaDescargaBase
    ? sumarDiasISO(nuevaFechaCarga, Number.isFinite(deltaDias) ? deltaDias : 0)
    : null;
  return {
    ...pedido,
    fecha_carga: nuevaFechaCarga,
    fecha_descarga: nuevaFechaDescarga,
    fecha_entrega: nuevaFechaDescarga,
    pendiente_completar: true,
    aviso_completar: "Viaje reprogramado desde trafico: revisar horarios, asignacion y compromiso con cliente.",
  };
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + (minutes * 60 * 1000));
}

function estimateTransitMinutes(pedido) {
  const km = Number(pedido?.km_ruta || pedido?.km || 0);
  if (km > 0) {
    const eta = calcTiempoTransito(km, cfgTraficoLoad());
    if (eta?.totalMin) return eta.totalMin;
  }
  return 180;
}

function buildPedidoWindow(pedido) {
  const fechaInicio = toDateInputValue(pedido?.fecha_carga || pedido?.fecha_pedido);
  if (!fechaInicio) return null;

  const horaInicio = toTimeInputValue(pedido?.hora_carga);
  const fechaFin = toDateInputValue(pedido?.fecha_descarga || pedido?.fecha_entrega || fechaInicio) || fechaInicio;
  const horaFin = toTimeInputValue(pedido?.hora_descarga);

  const tieneHoraInicio = Boolean(horaInicio);
  const tieneHoraFin = Boolean(horaFin);
  const inicio = new Date(`${fechaInicio}T${horaInicio || "00:00"}:00`);

  let fin;
  if (tieneHoraFin) {
    fin = new Date(`${fechaFin}T${horaFin}:00`);
  } else {
    fin = addMinutes(inicio, estimateTransitMinutes(pedido));
  }
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;
  if (fin < inicio) {
    fin = addMinutes(inicio, estimateTransitMinutes(pedido));
  }

  return {
    start: inicio,
    end: fin,
    precise: tieneHoraInicio || tieneHoraFin,
    dateKey: fechaInicio,
  };
}

function windowsOverlap(a, b) {
  if (!a || !b) return false;
  return a.start <= b.end && b.start <= a.end;
}

function collectAssignmentConflicts({ pedidoActual, form, pedidos = [], vehiculos = [], choferes = [] }) {
  const currentWindow = buildPedidoWindow({ ...pedidoActual, ...form });
  if (!currentWindow) return [];

  const vehiculo = vehiculos.find(v => String(v.id) === String(form?.vehiculo_id || ""));
  const chofer = choferes.find(c => String(c.id) === String(form?.chofer_id || ""));
  const conflictos = [];

  pedidos.forEach(other => {
    if (!other?.id || other.id === pedidoActual?.id) return;
    if (String(other.estado || "").toLowerCase() === "cancelado") return;
    const otherWindow = buildPedidoWindow(other);
    if (!otherWindow) return;

    const sameVehiculo = form?.vehiculo_id && String(other.vehiculo_id || "") === String(form.vehiculo_id);
    const sameChofer = form?.chofer_id && String(other.chofer_id || "") === String(form.chofer_id);
    if (!sameVehiculo && !sameChofer) return;

    const overlap = windowsOverlap(currentWindow, otherWindow);
    const sameDate = currentWindow.dateKey === otherWindow.dateKey;
    if (!overlap && !sameDate) return;

    const precise = currentWindow.precise && otherWindow.precise;
    const level = overlap && precise ? "hard" : "warning";
    const etiqueta = [
      sameVehiculo && vehiculo ? `Vehiculo ${vehiculo.matricula}` : null,
      sameChofer && chofer ? `Chofer ${chofer.nombre || ""} ${chofer.apellidos || ""}`.trim() : null,
    ].filter(Boolean).join(" y ");

    conflictos.push({
      id: `${other.id}-${sameVehiculo ? "veh" : ""}-${sameChofer ? "ch" : ""}`,
      pedidoId: other.id,
      level,
      recurso: etiqueta || "Recurso asignado",
      pedidoNumero: other.numero || "Pedido sin numero",
      resumen: `${other.numero || "Pedido"} - ${other.origen || "origen"} -> ${other.destino || "destino"}`,
      ventana: `${toDateInputValue(other.fecha_carga || other.fecha_pedido) || ""}${other.hora_carga ? ` ${toTimeInputValue(other.hora_carga)}` : ""}`,
    });
  });

  return conflictos;
}

function buildOperationalConflictMap(pedidos = [], vehiculos = [], choferes = []) {
  const map = {};
  pedidos.forEach(pedido => {
    if (!pedido?.id || String(pedido.estado || "").toLowerCase() === "cancelado") return;
    const conflictos = collectAssignmentConflicts({
      pedidoActual: pedido,
      form: {
        vehiculo_id: pedido.vehiculo_id || "",
        chofer_id: pedido.chofer_id || "",
        fecha_carga: toDateInputValue(pedido.fecha_carga || pedido.fecha_pedido),
        hora_carga: toTimeInputValue(pedido.hora_carga),
        fecha_descarga: toDateInputValue(pedido.fecha_descarga || pedido.fecha_entrega),
        hora_descarga: toTimeInputValue(pedido.hora_descarga),
        km_ruta: pedido.km_ruta || pedido.km || 0,
        km: pedido.km || pedido.km_ruta || 0,
      },
      pedidos,
      vehiculos,
      choferes,
    });
    if (conflictos.length) map[pedido.id] = conflictos;
  });
  return map;
}

function buildPedidoCargaDate(pedido) {
  const fecha = toDateInputValue(pedido?.fecha_carga || pedido?.fecha_pedido);
  if (!fecha) return null;
  const hora = toTimeInputValue(pedido?.hora_carga) || "00:00";
  const dt = new Date(`${fecha}T${hora}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getPedidoOperationalFlags(pedido, now = new Date()) {
  const cargaAt = buildPedidoCargaDate(pedido);
  const diffHours = cargaAt ? (cargaAt.getTime() - now.getTime()) / 3600000 : null;
  const missingVehiculo = !pedido?.vehiculo_id && !pedido?.colaborador_id;
  const missingChofer = !pedido?.chofer_id && !pedido?.colaborador_id;
  const missingAssignment = missingVehiculo || missingChofer;
  const overdueAssignment = missingAssignment && diffHours !== null && diffHours < 0;
  const urgentAssignment = missingAssignment && diffHours !== null && diffHours >= 0 && diffHours <= 24;
  return {
    missingAssignment,
    overdueAssignment,
    urgentAssignment,
    diffHours,
  };
}

function getPedidoMissingAssignmentLabel(pedido) {
  const flags = getPedidoOperationalFlags(pedido);
  if (!flags.missingAssignment) return "";
  const missingVehiculo = !pedido?.vehiculo_id && !pedido?.colaborador_id;
  const missingChofer = !pedido?.chofer_id && !pedido?.colaborador_id;
  if (missingVehiculo && missingChofer) return "Falta vehiculo y chofer";
  if (missingVehiculo) return "Falta vehiculo";
  if (missingChofer) return "Falta chofer";
  return "Asignacion incompleta";
}

function isVehiculoAsignable(v, vehiculos = []) {
  const clase = String(v?.clase || v?.tipo || "").toLowerCase();
  const matricula = String(v?.matricula || "").toUpperCase();
  const estadoVehiculo = String(v?.estado || "").toLowerCase();
  const isRemolqueDeAlguien = vehiculos.some(t => t.remolque_id === v.id);
  if (!v?.id) return false;
  if (["baja", "inactivo", "taller"].includes(estadoVehiculo)) return false;
  if (clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly")) return false;
  if (isRemolqueDeAlguien || matricula.startsWith("R-") || matricula.endsWith("-R")) return false;
  return true;
}

function isChoferAsignable(c) {
  const estadoChofer = String(c?.estado || "").toLowerCase();
  if (!c?.id) return false;
  if (["baja", "inactivo"].includes(estadoChofer)) return false;
  return true;
}

function findLinkedChoferForVehiculo(vehiculo, choferes = []) {
  if (!vehiculo?.id) return null;
  return choferes.find(c =>
    String(c.id || "") === String(vehiculo.chofer_id || "") ||
    String(c.vehiculo_id || "") === String(vehiculo.id)
  ) || null;
}

function buildTrafficAssignment(pedido, vehiculo, fechaCarga, choferes = []) {
  const linkedChoferRaw = findLinkedChoferForVehiculo(vehiculo, choferes);
  const linkedChofer = isChoferAsignable(linkedChoferRaw) ? linkedChoferRaw : null;
  const hasCollaborator = Boolean(pedido?.colaborador_id || pedido?.colaborador_nombre);
  const choferId = hasCollaborator
    ? (pedido?.chofer_id || null)
    : (linkedChofer?.id || vehiculo?.chofer_id || pedido?.chofer_id || null);
  const remolqueId = vehiculo?.remolque_id || pedido?.remolque_id || null;
  const estadoActual = String(pedido?.estado || "pendiente").toLowerCase();

  return {
    linkedChofer,
    payload: {
      vehiculo_id: vehiculo?.id || null,
      chofer_id: choferId,
      remolque_id: remolqueId,
      fecha_carga: fechaCarga,
      estado: estadoActual === "pendiente" ? "confirmado" : estadoActual,
    },
  };
}

function buildTrafficAssignmentLocalPatch(actualizado, payload, vehiculo, linkedChofer) {
  const choferNombre = linkedChofer
    ? `${linkedChofer.nombre || ""} ${linkedChofer.apellidos || ""}`.replace(/\s+/g, " ").trim()
    : String(vehiculo?.chofer_nombre || "").trim();
  return {
    ...(actualizado || {}),
    ...payload,
    vehiculo_matricula: vehiculo?.matricula || actualizado?.vehiculo_matricula || null,
    remolque_matricula: vehiculo?.remolque_matricula || actualizado?.remolque_matricula || null,
    ...(choferNombre ? { chofer_nombre: choferNombre } : {}),
  };
}

function getPedidoStateValidationIssues(pedido, targetEstado = "") {
  const estado = String(targetEstado || pedido?.estado || "").toLowerCase();
  const issues = [];
  const hasCollaborator = Boolean(pedido?.colaborador_id || pedido?.colaborador_nombre);
  const needsOperationalData = ["confirmado", "en_curso", "descarga", "entregado"].includes(estado);
  const needsDeliveryData = ["descarga", "entregado"].includes(estado);

  if (!toDateInputValue(pedido?.fecha_carga || pedido?.fecha_pedido)) {
    issues.push("Falta fecha de carga");
  }
  if (needsOperationalData) {
    if (!cleanAddress(pedido?.origen)) issues.push("Falta origen");
    if (!cleanAddress(pedido?.destino)) issues.push("Falta destino");
    if (!hasCollaborator && !pedido?.vehiculo_id) issues.push("Falta vehiculo");
    if (!hasCollaborator && !pedido?.chofer_id) issues.push("Falta chofer");
  }
  if (needsDeliveryData && !toDateInputValue(pedido?.fecha_descarga || pedido?.fecha_entrega)) {
    issues.push("Falta fecha de descarga");
  }

  return issues;
}

function sortTripsByOperationalPriority(trips = []) {
  const now = new Date();
  return [...trips].sort((a, b) => {
    const fa = getPedidoOperationalFlags(a, now);
    const fb = getPedidoOperationalFlags(b, now);
    const pa = fa.overdueAssignment ? 0 : fa.urgentAssignment ? 1 : 2;
    const pb = fb.overdueAssignment ? 0 : fb.urgentAssignment ? 1 : 2;
    if (pa !== pb) return pa - pb;
    const ta = String(a?.hora_carga || "99:99");
    const tb = String(b?.hora_carga || "99:99");
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a?.numero || "").localeCompare(String(b?.numero || ""));
  });
}

function pedidoEventoLabel(ev) {
  const tipo = String(ev?.tipo || "").toLowerCase();
  if (tipo.includes("documento_control.remitido")) return "DCD remitido";
  if (tipo.includes("documento_control.consultado")) return "DCD consultado";
  if (tipo.includes("documento_control.descargado")) return "DCD descargado";
  if (tipo.includes("documento_control")) return "Documento de control";
  if (tipo.includes("colaborador")) return "Colaborador";
  if (tipo.includes("descarg")) return "Descarga";
  if (tipo.includes("carg")) return "Carga";
  if (tipo.includes("estado")) return "Estado";
  if (tipo.includes("ruta")) return "Ruta";
  if (tipo.includes("crea")) return "Creacion";
  return ev?.tipo || "Evento";
}

function pedidoEventoDetalle(ev) {
  const detalle = ev?.detalle && typeof ev.detalle === "object" ? ev.detalle : {};
  const documentos = Array.isArray(detalle.documentos_meta)
    ? detalle.documentos_meta.map(doc => [doc.nombre, doc.size_kb ? `${doc.size_kb} KB` : ""].filter(Boolean).join(" ")).filter(Boolean).join(", ")
    : "";
  const dcdCampos = [
    detalle.accion ? `Accion: ${detalle.accion}` : "",
    detalle.canal ? `Canal: ${detalle.canal}` : "",
    detalle.codigo_control ? `DCD: ${detalle.codigo_control}` : "",
    detalle.source ? `Origen: ${detalle.source}` : "",
    detalle.ready !== undefined ? `Listo: ${detalle.ready ? "si" : "no"}` : "",
    documentos ? `Docs: ${documentos}` : "",
  ].filter(Boolean);
  if (dcdCampos.length) return dcdCampos.join(" - ");
  if (detalle.estado) return `Estado: ${detalle.estado}`;
  if (detalle.status) return `Estado: ${detalle.status}`;
  if (detalle.detalle) return detalle.detalle;
  if (detalle.message) return detalle.message;
  if (detalle.email) return detalle.email;
  if (detalle.matricula) return detalle.matricula;
  const pairs = Object.entries(detalle).filter(([,v]) => typeof v === "string" || typeof v === "number").slice(0,2);
  return pairs.length ? pairs.map(([k,v]) => `${k}: ${v}`).join(" - ") : "";
}

function uniqueStops(stops) {
  const seen = new Set();
  return stops.filter(stop => {
    const address = cleanAddress(stop.address || stop);
    const key = address.toLowerCase();
    if (!address || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pedidoRouteStops(pedido) {
  const cargas = safeStops(pedido.puntos_carga).map((stop, idx) => ({
    type: "Carga",
    name: stopName(stop, idx === 0 ? pedido.origen : ""),
    address: stopAddressFull(stop) || cleanAddress(pedido.origen),
    date: stop.fecha || pedido.fecha_carga,
    time: stop.hora || pedido.hora_carga,
    window: stop.ventana || pedido.ventana_carga,
  }));
  const descargas = safeStops(pedido.puntos_descarga).map((stop, idx) => ({
    type: "Descarga",
    name: stopName(stop, idx === 0 ? pedido.destino : ""),
    address: stopAddressFull(stop) || cleanAddress(pedido.destino),
    date: stop.fecha || pedido.fecha_descarga || pedido.fecha_entrega,
    time: stop.hora || pedido.hora_descarga,
    window: stop.ventana || pedido.ventana_descarga,
  }));
  const fallback = [
    { type:"Carga", name: cleanAddress(pedido.origen), address: cleanAddress(pedido.origen), date: pedido.fecha_carga, time: pedido.hora_carga, window: pedido.ventana_carga },
    { type:"Descarga", name: cleanAddress(pedido.destino), address: cleanAddress(pedido.destino), date: pedido.fecha_descarga || pedido.fecha_entrega, time: pedido.hora_descarga, window: pedido.ventana_descarga },
  ];
  return uniqueStops((cargas.length || descargas.length) ? [...cargas, ...descargas] : fallback);
}

function buildMapsRouteUrl(stops) {
  const addresses = stops.map(s => cleanAddress(s.address || s)).filter(Boolean);
  if (!addresses.length) return "";
  const origin = addresses[0];
  const destination = addresses[addresses.length - 1] || origin;
  const waypoints = addresses.slice(1, -1).join("|");
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function htmlSafe(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[ch]));
}

function buildRoutePlan(pedido, preferencia, vehiculo) {
  const stops = pedidoRouteStops(pedido);
  const km = Number(pedido.km_ruta || pedido.km || 0);
  const cfg = cfgTraficoLoad();
  const tiempo = calcTiempoTransito(km, cfg);
  const pesoTn = Number(pedido.peso_kg || 0) / 1000;
  const modoLabel = {
    rapida: "Mas rapida",
    eficiente: "Mas eficiente",
    segura: "Mas segura",
    camion: "Camion / restricciones",
  }[preferencia] || "Camion / restricciones";
  const recomendaciones = {
    rapida: [
      "Priorizar autovias y autopistas para cumplir ventanas de carga y descarga.",
      "Mantener margen de llegada para pausas obligatorias y posibles retenciones.",
    ],
    eficiente: [
      "Reducir rodeos y kilometros en vacio; si hay peajes, revisar si compensan por consumo y tiempo.",
      "Conducir a velocidad estable para bajar consumo, especialmente con carga pesada.",
    ],
    segura: [
      "Evitar travesias y accesos urbanos estrechos cuando exista alternativa razonable.",
      "Confirmar zonas de espera, accesos de carga y horarios de muelle antes de iniciar ruta.",
    ],
    camion: [
      "Revisar galibo, MMA, restricciones locales, ADR si aplica y accesos al muelle.",
      "Usar el enlace como navegacion orientativa; la validacion final debe ser apta para camion.",
    ],
  }[preferencia] || [];
  return {
    pedido,
    vehiculo,
    stops,
    km,
    tiempo,
    modoLabel,
    url: buildMapsRouteUrl(stops),
    pesoTn,
    recomendaciones,
  };
}

function printRoutePlan(plan) {
  const w = window.open("", "_blank", "width=820,height=1100");
  if (!w) { notify("No se pudo abrir la ventana de impresion.", "warning"); return; }
  const stopsHtml = plan.stops.map((s, idx) => `
    <li>
      <strong>${idx + 1}. ${htmlSafe(s.type)}</strong>
      <div>${htmlSafe(s.name || s.address)}</div>
      <small>${htmlSafe(s.address)}</small>
      ${s.date || s.time || s.window ? `<small>${htmlSafe([s.date, s.time, s.window].filter(Boolean).join(" - "))}</small>` : ""}
    </li>`).join("");
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Ruta ${htmlSafe(plan.pedido.numero || "")}</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;color:#111827;margin:0;padding:24px}
.sheet{max-width:780px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:16px;padding:28px;box-shadow:0 24px 70px rgba(15,23,42,.12)}
.top{border-left:5px solid #0f766e;padding-left:14px;margin-bottom:22px}
h1{font-size:25px;margin:0;color:#0f172a}.muted{color:#64748b;font-size:12px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px}.lbl{font-size:10px;color:#64748b;text-transform:uppercase;font-weight:800;letter-spacing:.06em}.val{font-size:17px;font-weight:900;margin-top:4px}
ol{padding-left:22px}li{margin-bottom:12px}li div{font-weight:800;margin-top:2px}small{display:block;color:#64748b;margin-top:2px}
.box{border:1px solid #dbeafe;background:#eff6ff;border-radius:12px;padding:13px 16px;margin-top:16px}.warn{border-color:#fde68a;background:#fffbeb}
a{color:#0f766e;word-break:break-all}@media print{@page{margin:1.05cm;size:A4}body{background:#fff;padding:0}.sheet{border:0;box-shadow:none;border-radius:0}}
</style></head><body><main class="sheet">
<div class="top"><h1>Ruta recomendada para camion</h1><div class="muted">Pedido ${htmlSafe(plan.pedido.numero || "")} - ${htmlSafe(plan.modoLabel)}</div></div>
<div class="grid">
<div class="kpi"><div class="lbl">Kilometros</div><div class="val">${plan.km ? `${plan.km.toLocaleString("es-ES")} km` : "Pendiente"}</div></div>
<div class="kpi"><div class="lbl">Tiempo estimado</div><div class="val">${plan.tiempo?.label || "Pendiente"}</div></div>
<div class="kpi"><div class="lbl">Peso</div><div class="val">${plan.pesoTn ? `${plan.pesoTn.toFixed(1)} t` : "Sin dato"}</div></div>
</div>
<h2>Paradas</h2><ol>${stopsHtml}</ol>
<div class="box"><strong>Enlace de navegacion</strong><br><a href="${htmlSafe(plan.url)}">${htmlSafe(plan.url || "Sin direcciones suficientes")}</a></div>
<div class="box warn"><strong>Control para camion</strong><br>Antes de salir, revisar galibo, peso maximo autorizado, restricciones locales, ADR si aplica, accesos a muelle, horarios y zonas de espera. Esta ruta es una recomendacion operativa y debe validarse con navegacion apta para camion cuando este disponible.</div>
<div class="box"><strong>Recomendaciones</strong><ul>${plan.recomendaciones.map(x=>`<li>${htmlSafe(x)}</li>`).join("")}</ul></div>
</main></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

function getWeekDays(anchor) {
  const d = new Date(anchor);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return Array.from({length:7}, (_, i) => {
    const dt = new Date(d);
    dt.setDate(d.getDate() + i);
    return dt;
  });
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : "";
}

function addDaysLocal(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function nearestActivePedidoDate(pedidos, anchor = new Date()) {
  const anchorTime = new Date(anchor).getTime();
  const active = (Array.isArray(pedidos) ? pedidos : [])
    .filter(p => !["cancelado", "entregado", "facturado"].includes(String(p?.estado || "").toLowerCase()))
    .map(p => dateOnly(p?.fecha_carga) || dateOnly(p?.fecha_pedido))
    .filter(Boolean)
    .map(fecha => ({ fecha, time: new Date(`${fecha}T12:00:00`).getTime() }))
    .filter(item => Number.isFinite(item.time))
    .sort((a, b) => Math.abs(a.time - anchorTime) - Math.abs(b.time - anchorTime));
  return active[0]?.fecha || "";
}

const DIA_NAMES = ["LUN","MAR","MIE","JUE","VIE","SAB","DOM"];
const TRAFICO_TRIP_ORDER_KEY = "tms_gestion_trafico_trip_order_v1";

function loadTraficoTripOrder() {
  try {
    const raw = localStorage.getItem(TRAFICO_TRIP_ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveTraficoTripOrder(value) {
  try { localStorage.setItem(TRAFICO_TRIP_ORDER_KEY, JSON.stringify(value || {})); } catch {}
}

function trafficOrderKey(vehiculoId, fecha) {
  return `${vehiculoId || ""}:${fecha || ""}`;
}

// â”€â”€ Tarjeta de viaje - idÃ©ntica a la imagen de referencia â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TripCard({
  pedido,
  onClick,
  llegada,
  conflictos = [],
  quickAction = null,
  onQuickState = null,
  disableQuickState = false,
  onCopyNextWeek = null,
  disableCopy = false,
  onDelayRequest = null,
  disableReschedule = false,
  highlighted = false,
  highlightLabel = "",
  draggable = false,
  onDragStart = null,
  onDragOverTrip = null,
  onDropTrip = null,
}) {
  const e = EC[pedido.estado] || EC.pendiente;
  const hasKmVacio = Number(pedido.km_vacio) > 0;
  const tieneConflictoDuro = conflictos.some(c => c.level === "hard");
  const tieneConflicto = conflictos.length > 0;
  const flags = getPedidoOperationalFlags(pedido);
  const finanzas = getPedidoFinancialSnapshot(pedido);

  return (
    <div
      onClick={() => onClick(pedido)}
      draggable={draggable}
      onDragStart={(e2) => onDragStart?.(e2, pedido)}
      onDragOver={(e2) => onDragOverTrip?.(e2, pedido)}
      onDrop={(e2) => onDropTrip?.(e2, pedido)}
      title={`${pedido.numero} - ${pedido.origen||""} -> ${pedido.destino||""}`}
      style={{
        background: e.bg,
        border: `1.5px solid ${tieneConflictoDuro ? "rgba(239,68,68,.42)" : tieneConflicto ? "rgba(245,158,11,.35)" : e.border}`,
        borderLeft: `3px solid ${e.color}`,
        borderRadius: 5,
        padding: "5px 7px",
        marginBottom: 3,
        cursor: "pointer",
        transition: "filter .12s",
        userSelect: "none",
        minWidth: 0,
        boxShadow: highlighted ? "0 0 0 2px rgba(59,130,246,.35), inset 0 0 0 1px rgba(59,130,246,.22)" : undefined,
      }}
      onMouseEnter={e2 => e2.currentTarget.style.filter = "brightness(1.12)"}
      onMouseLeave={e2 => e2.currentTarget.style.filter = "brightness(1)"}
    >
      {/* Header: numero + icono estado */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:3, marginBottom:2 }}>
        <span style={{
          fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:800, color:e.color,
          letterSpacing:".02em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>
          {pedido.numero}
          {" "}
          <span style={{ fontSize:9 }}>*</span>
        </span>
      </div>
      {highlighted && (
        <div style={{display:"inline-flex",marginBottom:3,padding:"1px 5px",borderRadius:3,background:"rgba(59,130,246,.14)",border:"1px solid rgba(59,130,246,.30)",color:"#60a5fa",fontSize:9,fontWeight:800}}>
          {highlightLabel || "En foco"}
        </div>
      )}
      {pedido.pendiente_completar && (
        <div title={pedido.aviso_completar || "Pendiente de completar"} style={{display:"inline-flex",marginBottom:3,padding:"1px 5px",borderRadius:3,background:"rgba(251,191,36,.16)",border:"1px solid rgba(251,191,36,.32)",color:"#fbbf24",fontSize:9,fontWeight:800}}>
          Completar despues
        </div>
      )}
      {String(pedido.tipo_viaje || "normal") !== "normal" && (
        <div title={pedido.viaje_enlazado_id ? "Viaje enlazado ida-retorno" : "Tipo de viaje"} style={{display:"inline-flex",marginBottom:3,marginLeft:pedido.pendiente_completar ? 4 : 0,padding:"1px 5px",borderRadius:3,background:"rgba(20,184,166,.10)",border:"1px solid rgba(20,184,166,.28)",color:"var(--accent-xl)",fontSize:9,fontWeight:900}}>
          {tipoViajeLabel(pedido.tipo_viaje)}
        </div>
      )}
      {(pedido.grupaje_id || pedido.tipo_carga === "grupaje") && (
        <div title="Viaje combinado en grupaje" style={{display:"inline-flex",marginBottom:3,marginLeft:(pedido.pendiente_completar || String(pedido.tipo_viaje || "normal") !== "normal") ? 4 : 0,padding:"1px 5px",borderRadius:3,background:"rgba(16,185,129,.12)",border:"1px solid rgba(16,185,129,.30)",color:"#34d399",fontSize:9,fontWeight:900}}>
          Carga completa
        </div>
      )}
      {tieneConflicto && (
        <div title={conflictos.map(c => `${c.recurso}: ${c.resumen}`).join("\n")} style={{
          display:"inline-flex",
          marginBottom:3,
          marginLeft: pedido.pendiente_completar ? 4 : 0,
          padding:"1px 5px",
          borderRadius:3,
          background: tieneConflictoDuro ? "rgba(239,68,68,.14)" : "rgba(245,158,11,.14)",
          border: tieneConflictoDuro ? "1px solid rgba(239,68,68,.35)" : "1px solid rgba(245,158,11,.35)",
          color: tieneConflictoDuro ? "#f87171" : "#f59e0b",
          fontSize:9,
          fontWeight:800
        }}>
          {tieneConflictoDuro ? "Conflicto" : "Revisar"}
        </div>
      )}
      {flags.overdueAssignment && (
        <div style={{display:"inline-flex",marginBottom:3,marginLeft: (pedido.pendiente_completar || tieneConflicto) ? 4 : 0,padding:"1px 5px",borderRadius:3,background:"rgba(239,68,68,.14)",border:"1px solid rgba(239,68,68,.35)",color:"#f87171",fontSize:9,fontWeight:800}}>
          Sin asignar - vencido
        </div>
      )}
      {!flags.overdueAssignment && flags.urgentAssignment && (
        <div style={{display:"inline-flex",marginBottom:3,marginLeft: (pedido.pendiente_completar || tieneConflicto) ? 4 : 0,padding:"1px 5px",borderRadius:3,background:"rgba(245,158,11,.14)",border:"1px solid rgba(245,158,11,.35)",color:"#f59e0b",fontSize:9,fontWeight:800}}>
          Urgente {Math.max(0, Math.round(flags.diffHours || 0))}h
        </div>
      )}
      {finanzas.sinPrecio && (
        <div style={{display:"inline-flex",marginBottom:3,marginLeft: (pedido.pendiente_completar || tieneConflicto || flags.overdueAssignment || flags.urgentAssignment) ? 4 : 0,padding:"1px 5px",borderRadius:3,background:"rgba(239,68,68,.12)",border:"1px solid rgba(239,68,68,.32)",color:"#f87171",fontSize:9,fontWeight:800}}>
          Sin precio
        </div>
      )}
      {!finanzas.sinPrecio && finanzas.margenNegativo && (
        <div title={`Margen ${fmtEur(finanzas.margen)} (${finanzas.pct.toFixed(1)}%)`} style={{display:"inline-flex",marginBottom:3,marginLeft: (pedido.pendiente_completar || tieneConflicto || flags.overdueAssignment || flags.urgentAssignment) ? 4 : 0,padding:"1px 5px",borderRadius:3,background:"rgba(244,63,94,.12)",border:"1px solid rgba(244,63,94,.30)",color:"#fb7185",fontSize:9,fontWeight:800}}>
          Margen negativo
        </div>
      )}

      {/* Origen -> Destino */}
      {(pedido.origen || pedido.destino) && (
        <div style={{
          fontSize:11, fontWeight:700, color:"var(--text)",
          lineHeight:1.25, marginBottom:2, overflow:"hidden",
          display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
        }}>
          {pedido.origen && pedido.destino
            ? `${pedido.origen} -> ${pedido.destino}`
            : pedido.origen || pedido.destino}
        </div>
      )}

      {/* Hora + Cliente */}
      <div style={{ fontSize:10, color:"var(--text4)", lineHeight:1.3 }}>
        {pedido.hora_carga && <span>{pedido.hora_carga}</span>}
        {pedido.hora_carga && pedido.cliente_nombre && <span> </span>}
        {pedido.cliente_nombre && (
          <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {pedido.cliente_nombre.length > 16 ? pedido.cliente_nombre.slice(0,16)+"..." : pedido.cliente_nombre}
          </span>
        )}
      </div>

      {/* KM ruta + tiempo estimado */}
      {Number(pedido.km_ruta||pedido.km||0) > 0 && (() => {
        const cfg = cfgTraficoLoad();
        const t   = calcTiempoTransito(Number(pedido.km_ruta||pedido.km||0), cfg);
        return t ? (
          <div style={{ marginTop:3, display:"inline-flex", alignItems:"center", gap:3,
            background:"rgba(16,185,129,.08)", border:"1px solid rgba(16,185,129,.2)",
            borderRadius:3, padding:"1px 5px" }}>
            <span style={{ fontSize:9 }}>HORA</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700, color:"#34d399" }}>
              {t.label} - {Number(pedido.km_ruta||pedido.km||0).toLocaleString("es-ES")}km
            </span>
          </div>
        ) : null;
      })()}
      {/* Llegada estimada / real encadenada */}
      {llegada && (
        <div style={{
          marginTop:3, display:"inline-flex", alignItems:"center", gap:3,
          background:llegada.encadenado?"rgba(251,191,36,.12)":"rgba(16,185,129,.08)",
          border:`1px solid ${llegada.encadenado?"rgba(251,191,36,.3)":"rgba(16,185,129,.2)"}`,
          borderRadius:3, padding:"1px 5px",
        }}>
          <span style={{fontSize:9}}>{llegada.encadenado?"ENLACE":"HORA"}</span>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:700,
            color:llegada.encadenado?"#fbbf24":"#34d399"}}>
            {llegada.encadenado?"llegada real: ":"llegada: "}{llegada.llegada}
          </span>
        </div>
      )}
      {/* KM vacio badge */}
      {hasKmVacio && (
        <div style={{
          marginTop:3, display:"inline-flex", alignItems:"center", gap:3,
          background:"rgba(59,130,246,.1)", border:"1px solid rgba(59,130,246,.25)",
          borderRadius:3, padding:"1px 5px",
        }}>
          <span style={{ fontSize:9 }}>VACIO</span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700, color:"#60a5fa" }}>
            {Number(pedido.km_vacio).toLocaleString("es-ES")} km
          </span>
        </div>
      )}
      {(quickAction && onQuickState) || onCopyNextWeek || onDelayRequest ? (
        <div style={{marginTop:4,display:"flex",justifyContent:"flex-end",gap:6,flexWrap:"wrap"}}>
          {onDelayRequest && (
            <button
              onClick={(e2) => {
                e2.stopPropagation();
                if (!disableReschedule) onDelayRequest(pedido);
              }}
              disabled={disableReschedule}
              style={{
                padding:"3px 7px",
                borderRadius:5,
                border:"1px solid rgba(245,158,11,.28)",
                background:"rgba(245,158,11,.12)",
                color:"#f59e0b",
                fontSize:10,
                fontWeight:800,
                cursor:disableReschedule ? "not-allowed" : "pointer",
                opacity:disableReschedule ? .6 : 1,
              }}
            >
              {disableReschedule ? "Moviendo..." : "Retrasar"}
            </button>
          )}
          {onCopyNextWeek && (
            <button
              onClick={(e2) => {
                e2.stopPropagation();
                if (!disableCopy) onCopyNextWeek(pedido);
              }}
              disabled={disableCopy}
              style={{
                padding:"3px 7px",
                borderRadius:5,
                border:"1px solid rgba(59,130,246,.28)",
                background:"rgba(59,130,246,.12)",
                color:"#60a5fa",
                fontSize:10,
                fontWeight:800,
                cursor:disableCopy ? "not-allowed" : "pointer",
                opacity:disableCopy ? .6 : 1,
              }}
            >
              {disableCopy ? "Copiando..." : "Copiar"}
            </button>
          )}
          {quickAction && onQuickState && (
          <button
            onClick={(e2) => {
              e2.stopPropagation();
              if (!disableQuickState) onQuickState(pedido, quickAction.next);
            }}
            disabled={disableQuickState}
            title={quickAction.disabled && quickAction.issues?.length ? quickAction.issues.join(" · ") : quickAction.label}
            style={{
              padding:"3px 7px",
              borderRadius:5,
              border:`1px solid ${quickAction.disabled ? "rgba(245,158,11,.28)" : "rgba(16,185,129,.28)"}`,
              background:quickAction.disabled ? "rgba(245,158,11,.12)" : "rgba(16,185,129,.12)",
              color:quickAction.disabled ? "#f59e0b" : "#34d399",
              fontSize:10,
              fontWeight:800,
              cursor:disableQuickState ? "not-allowed" : "pointer",
              opacity:disableQuickState ? .6 : 1,
            }}
          >
            {quickAction.disabled ? "Completar datos" : quickAction.label}
          </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function buildCriticalAlertKey(item) {
  if (!item?.pedido?.id) return "";
  const reasons = (item.reasons || []).map(reason => reason.key).sort().join("|") || "sin-motivo";
  const blocking = item.blockingConflict?.pedidoId ? `block:${item.blockingConflict.pedidoId}` : "block:none";
  const availability = item.availability?.summary || "disp:none";
  const quickState = item.quick?.disabled ? "datos-pendientes" : "ok";
  return `${item.pedido.id}::${reasons}::${blocking}::${availability}::${quickState}`;
}

// â”€â”€ Modal ediciÃ³n de viaje â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ModalViaje({ pedido, pedidos = [], vehiculos, choferes, rutas = [], onClose, onSaved, onReload, onFacturaDesvinculada, focusContext = null, resolveSuggestedAssignment = null, onClearAssignment = null, clearingAssignment = false }) {
  const [form, setForm] = useState(() => normalizePedidoForModal(pedido));
  const [saving, setSaving] = useState(false);
  const [avisoVehiculo, setAvisoVehiculo] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [eventosLoading, setEventosLoading] = useState(false);
  const [avisandoCliente, setAvisandoCliente] = useState(false);
  const [idaRetorno, setIdaRetorno] = useState(null);
  const [idaRetornoLoading, setIdaRetornoLoading] = useState(false);
  const [enlazandoRetorno, setEnlazandoRetorno] = useState(false);
  const [linkRetornoId, setLinkRetornoId] = useState("");
  const [linkKmVacio, setLinkKmVacio] = useState("");
  const origenRef = useRef(null);
  const destinoRef = useRef(null);
  const fechaCargaRef = useRef(null);
  const fechaDescargaRef = useRef(null);
  const vehiculoRef = useRef(null);
  const choferRef = useRef(null);
  const conflictosOperativos = useMemo(
    () => collectAssignmentConflicts({ pedidoActual: pedido, form, pedidos, vehiculos, choferes }),
    [pedido, form, pedidos, vehiculos, choferes]
  );
  const validationIssues = useMemo(
    () => getPedidoStateValidationIssues(form, form?.estado || pedido?.estado),
    [form, pedido]
  );
  const suggestedAssignment = useMemo(() => {
    if (typeof resolveSuggestedAssignment !== "function") return null;
    return resolveSuggestedAssignment({ ...pedido, ...form });
  }, [resolveSuggestedAssignment, pedido, form]);
  const suggestedTariff = useMemo(
    () => buscarTarifaRutaPedido({ ...pedido, ...form }, rutas),
    [pedido, form, rutas]
  );
  const f = k => e => setForm(p => ({ ...p, [k]: (k==="origen"||k==="destino") ? e.target.value.toUpperCase() : e.target.value }));

  useEffect(() => {
    setForm(normalizePedidoForModal(pedido));
  }, [pedido]);

  useEffect(() => {
    setForm(prev => {
      let next = prev;
      const origenGeo = inferPlaceGeo(prev.origen, prev.origen_provincia, prev.origen_pais);
      const destinoGeo = inferPlaceGeo(prev.destino, prev.destino_provincia, prev.destino_pais);
      if (origenGeo && !prev.origen_provincia) {
        next = { ...next, origen_provincia: origenGeo.provincia, origen_pais: prev.origen_pais || origenGeo.pais || "Espana" };
      }
      if (destinoGeo && !prev.destino_provincia) {
        next = { ...next, destino_provincia: destinoGeo.provincia, destino_pais: prev.destino_pais || destinoGeo.pais || "Espana" };
      }
      return next;
    });
  }, [form.origen, form.destino, form.origen_provincia, form.destino_provincia, form.origen_pais, form.destino_pais]);


  useEffect(() => {
    let alive = true;
    if (!pedido?.id) return undefined;
    setEventosLoading(true);
    getPedidoEventos(pedido.id)
      .then(rows => {
        if (!alive) return;
        setEventos(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (alive) setEventos([]);
      })
      .finally(() => {
        if (alive) setEventosLoading(false);
    });
    return () => { alive = false; };
  }, [pedido?.id]);

  const cargarIdaRetorno = useCallback(async () => {
    if (!pedido?.id) return;
    setIdaRetornoLoading(true);
    try {
      const data = await getPedidoIdaRetorno(pedido.id);
      setIdaRetorno(data);
    } catch {
      setIdaRetorno(null);
    } finally {
      setIdaRetornoLoading(false);
    }
  }, [pedido?.id]);

  useEffect(() => {
    cargarIdaRetorno();
  }, [cargarIdaRetorno]);

  const candidatosRetorno = useMemo(() => {
    const baseDate = String(form.fecha_carga || pedido.fecha_carga || "").slice(0, 10);
    const baseVeh = String(form.vehiculo_id || pedido.vehiculo_id || "");
    return pedidos
      .filter(p => p?.id && String(p.id) !== String(pedido?.id))
      .filter(p => !pedidoTieneFacturaFinal(p))
      .filter(p => !p.viaje_enlazado_id || String(p.viaje_enlazado_id) === String(pedido?.id))
      .filter(p => {
        const fecha = String(p.fecha_carga || p.fecha_pedido || "").slice(0, 10);
        return !baseDate || !fecha || fecha >= baseDate;
      })
      .sort((a, b) => {
        const vehScoreA = baseVeh && String(a.vehiculo_id || "") === baseVeh ? 0 : 1;
        const vehScoreB = baseVeh && String(b.vehiculo_id || "") === baseVeh ? 0 : 1;
        if (vehScoreA !== vehScoreB) return vehScoreA - vehScoreB;
        return String(a.fecha_carga || a.fecha_pedido || "").localeCompare(String(b.fecha_carga || b.fecha_pedido || ""));
      })
      .slice(0, 80);
  }, [pedidos, pedido, form.fecha_carga, form.vehiculo_id]);

  async function enlazarRetornoSeleccionado() {
    if (!pedido?.id || !linkRetornoId) {
      notify("Selecciona el viaje de retorno.", "warning");
      return;
    }
    setEnlazandoRetorno(true);
    try {
      const data = await enlazarPedidoRetorno(pedido.id, {
        retorno_id: linkRetornoId,
        km_vacio_enlace: linkKmVacio || 0,
        copiar_asignacion: true,
      });
      setIdaRetorno(data);
      setLinkRetornoId("");
      setLinkKmVacio("");
      if (typeof onReload === "function") onReload();
      broadcastPedidosChanged({ pedido_id: pedido.id, source: "gestion-trafico-ida-retorno-link" });
      notify("Salida y retorno enlazados. Ya se calcula el total ida y vuelta.", "success");
    } catch (e) {
      notify(e.message || "No se pudo enlazar el retorno.", "error");
    } finally {
      setEnlazandoRetorno(false);
    }
  }

  async function desvincularIdaRetornoActual() {
    if (!pedido?.id) return;
    const ok = await confirmDialog({
      title: "Desvincular ida-retorno",
      message: "Se mantendran los pedidos, pero dejaran de estar tratados como viaje ida y vuelta.",
      confirmText: "Desvincular",
      tone: "warning",
    });
    if (!ok) return;
    setEnlazandoRetorno(true);
    try {
      await desvincularPedidoRetorno(pedido.id);
      setIdaRetorno({ enlazado: false, resumen: null });
      if (typeof onReload === "function") onReload();
      broadcastPedidosChanged({ pedido_id: pedido.id, source: "gestion-trafico-ida-retorno-unlink" });
      notify("Enlace ida-retorno eliminado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo desvincular.", "error");
    } finally {
      setEnlazandoRetorno(false);
    }
  }
  const inp = { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"7px 10px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:12, outline:"none", width:"100%", boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text5)", marginBottom:3, marginTop:9 };
  const nextRecommendedAction = useMemo(() => {
    const hasIssue = (text) => validationIssues.some(issue => issue.toLowerCase() === text.toLowerCase());
    if (hasIssue("Falta vehiculo")) return { label: "Ir a vehiculo", ref: vehiculoRef };
    if (hasIssue("Falta chofer")) return { label: "Ir a chofer", ref: choferRef };
    if (hasIssue("Falta origen")) return { label: "Ir a origen", ref: origenRef };
    if (hasIssue("Falta destino")) return { label: "Ir a destino", ref: destinoRef };
    if (hasIssue("Falta fecha de carga")) return { label: "Ir a fecha de carga", ref: fechaCargaRef };
    if (hasIssue("Falta fecha de descarga")) return { label: "Ir a fecha de descarga", ref: fechaDescargaRef };
    return null;
  }, [validationIssues]);
  const isControlTowerFocus = focusContext?.source === "control_tower" && String(focusContext?.pedido_id || "") === String(pedido?.id);
  const focusActionKey = String(focusContext?.action_key || "");
  const finanzasModal = useMemo(
    () => getPedidoFinancialSnapshot({ ...pedido, ...form }),
    [pedido, form]
  );

  function focusModalField(ref) {
    ref?.current?.focus?.();
    ref?.current?.scrollIntoView?.({ behavior:"smooth", block:"center" });
  }

  function aplicarSugerenciaModal() {
    if (!suggestedAssignment) return;
    setForm(prev => ({
      ...prev,
      vehiculo_id: suggestedAssignment.vehiculo_id || prev.vehiculo_id || "",
      chofer_id: suggestedAssignment.chofer_id || prev.chofer_id || "",
    }));
    if (suggestedAssignment.vehiculo_id) {
      const veh = vehiculos?.find(v => String(v.id) === String(suggestedAssignment.vehiculo_id));
      if (veh?.notas_operacion?.trim()) {
        setAvisoVehiculo({ matricula: veh.matricula, notas: veh.notas_operacion });
      }
    }
    notify(`Sugerencia aplicada${suggestedAssignment.label ? `: ${suggestedAssignment.label}.` : "."}`, "success");
  }

  function aplicarTarifaSugerida() {
    if (!suggestedTariff) return;
    setForm(prev => ({
      ...prev,
      importe: suggestedTariff.importe,
      tipo_precio: suggestedTariff.tipo,
      precio_unitario: suggestedTariff.precioUnitario,
      precio_base_sin_combustible: suggestedTariff.precioBase,
      recargo_combustible_pct: suggestedTariff.recargoPct,
      cantidad: suggestedTariff.cantidad,
    }));
    notify("Tarifa aplicada al viaje.", "success");
  }

  async function avisarClienteDesdeControlTower() {
    if (!pedido?.id || avisandoCliente) return;
    const destinatario = pedido.cliente_email || pedido.cliente_email_facturacion || "";
    if (!destinatario) {
      notify("El cliente no tiene email configurado en su ficha.", "warning");
      return;
    }
    const ok = await confirmDialog({
      title: "Avisar al cliente",
      message: `Se enviara un aviso operativo a ${destinatario} sobre el pedido ${pedido.numero || ""}.\n\nMotivo: ${focusContext?.title || focusContext?.action || "Seguimiento operativo"}`,
      confirmText: "Enviar aviso",
      tone: "warning",
    });
    if (!ok) return;
    setAvisandoCliente(true);
    try {
      const r = await avisarClientePedido(pedido.id, {
        destinatario,
        motivo: focusContext?.title || focusContext?.action || "Seguimiento operativo",
        mensaje: focusContext?.description || "Nuestro equipo de trafico esta revisando el transporte y le mantendra informado.",
      });
      notify(r?.simulado ? "Aviso registrado como email simulado. Revisa SMTP si quieres envio real." : "Cliente avisado y evento registrado en el pedido.", "success");
      setEventos(prev => [{
        id: `local-${Date.now()}`,
        tipo: "cliente.avisado",
        actor_tipo: "usuario",
        created_at: new Date().toISOString(),
        detalle: { destinatario, origen: "control_tower" },
      }, ...prev]);
    } catch (e) {
      notify(e.message || "No se pudo avisar al cliente.", "error");
    } finally {
      setAvisandoCliente(false);
    }
  }

  async function calcKmOSRM(origen, destino) {
    if (!origen?.trim() || !destino?.trim()) return null;
    try {
      const geo = async place => {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place+", España")}&format=json&limit=1`);
        const d = await r.json();
        if (!d[0]) return null;
        return [parseFloat(d[0].lon), parseFloat(d[0].lat)];
      };
      const [o, d] = await Promise.all([geo(origen), geo(destino)]);
      if (!o || !d) return null;
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${o[0]},${o[1]};${d[0]},${d[1]}?overview=false`);
      const data = await r.json();
      return data.code === "Ok" ? Math.round(data.routes[0].distance/1000) : null;
    } catch(e) { return null; }
  }

  async function guardar() {
    const tieneFacturaFinal = pedidoTieneFacturaFinal(pedido);
    if (tieneFacturaFinal && !desvinculado) { notify("Este pedido esta facturado y no se puede editar.", "warning"); return; }
    // Validacion: fecha de carga obligatoria
    if (!form.fecha_carga) { notify("La fecha de carga es obligatoria.\nSin fecha, el pedido no aparecera en el cuadrante.", "warning"); return; }
    if (conflictosOperativos.length) {
      const conflictosDuros = conflictosOperativos.filter(c => c.level === "hard");
      const lista = conflictosOperativos.slice(0, 4).map(c => `- ${c.recurso}: ${c.resumen}`).join("\n");
      const seguir = await confirmDialog({
        title: conflictosDuros.length ? "Conflicto operativo detectado" : "Posible conflicto operativo",
        message: `${conflictosDuros.length ? "Hay un solape real" : "Hay una posible coincidencia"} con otros viajes asignados:\n\n${lista}${conflictosOperativos.length > 4 ? `\nY ${conflictosOperativos.length - 4} mas.` : ""}\n\nPuedes guardar igualmente si ya esta validado por trafico.`,
        confirmText: "Guardar igualmente",
        tone: conflictosDuros.length ? "danger" : "warning",
      });
      if (!seguir) return;
    }
    setSaving(true);
    try {
      await editarPedido(pedido.id, form);
      // Auto-update vehicle km when marking as delivered with km_ruta
      if (form.estado === "entregado" && form.vehiculo_id && form.km_ruta) {
        const veh = vehiculos?.find(v => v.id === form.vehiculo_id);
        if (veh && veh.km_actuales) {
          const newKm = Number(veh.km_actuales) + Number(form.km_ruta);
          actualizarKmVehiculo(form.vehiculo_id, newKm).catch(() => {}); // silently update
        }
      }

      // AUTO-POSITION: When estado = entregado, update vehicle's last known position
      // to the descarga city, and trigger "disponible" notification
      if (form.estado === "entregado" && form.vehiculo_id) {
        const posicion = form.destino || pedido.destino;
        if (posicion) {
          actualizarPosicionVehiculo(form.vehiculo_id, {
            provider: "trafico-entrega",
            ubicacion: posicion,
            km_actuales: null,
          }).catch(() => {});
        }

        // Show notification that vehicle is now available
        const veh = vehiculos?.find(v=>v.id===form.vehiculo_id);
        const mat = veh?.matricula || form.vehiculo_id;
        // Check if vehicle has next trip already assigned
        const proximoViaje = pedidos?.find(p =>
          p.vehiculo_id === form.vehiculo_id &&
          p.estado === "confirmado" &&
          p.id !== pedido.id
        );
        if (proximoViaje) {
          setTimeout(()=>notify(
            `${mat} ha descargado en ${posicion || "destino"}\n\nYa tiene asignada la siguiente carga:\n${proximoViaje.numero} - ${proximoViaje.origen} -> ${proximoViaje.destino}`,
            "success",
            9000
          ), 500);
        } else {
          setTimeout(()=>notify(
            `${mat} ha descargado en ${posicion || "destino"}\n\nVehiculo disponible - sin carga asignada`,
            "success",
            9000
          ), 500);
        }
      }

      if (typeof onSaved === "function") {
        onSaved({
          ...pedido,
          ...form,
          fecha_carga: form.fecha_carga || pedido.fecha_carga,
          fecha_descarga: form.fecha_descarga || pedido.fecha_descarga,
          estado: form.estado || pedido.estado,
        });
      }
      broadcastPedidosChanged({ pedido_id: pedido.id, source: "gestion-trafico-modal-save" });
    }
    catch(e) {
      if (isFestivoConfirmError(e) && await confirmFestivoDestino(e)) {
        try {
          await editarPedido(pedido.id, { ...form, festivo_confirmado: true });
          if (typeof onSaved === "function") {
            onSaved({
              ...pedido,
              ...form,
              fecha_carga: form.fecha_carga || pedido.fecha_carga,
              fecha_descarga: form.fecha_descarga || pedido.fecha_descarga,
              estado: form.estado || pedido.estado,
            });
          }
          broadcastPedidosChanged({ pedido_id: pedido.id, source: "gestion-trafico-modal-save-festivo" });
          notify("Pedido guardado con aviso de festivo aceptado. Gerencia queda notificada.", "success");
        } catch (retryErr) {
          notify("Error al guardar: " + retryErr.message, "error");
        }
      } else {
        notify("Error al guardar: " + e.message, "error");
      }
    }
    finally { setSaving(false); }
  }

  const [desvinculado, setDesvinculado] = useState(false);
  // Solo bloquear si realmente hay factura final vinculada
  const bloquear = !desvinculado && pedidoTieneFacturaFinal(pedido);

  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.82)", zIndex:300,
               display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:13,
                    padding:22, width:"min(560px,96vw)", maxHeight:"92vh", overflowY:"auto" }}>
        {/* Aviso operacional vehiculo */}
        {avisoVehiculo && (
          <div style={{background:"rgba(245,158,11,.12)",border:"2px solid rgba(245,158,11,.5)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <span style={{fontSize:11,flexShrink:0,fontWeight:800,color:"#f59e0b"}}>AVISO</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:13,color:"#f59e0b",marginBottom:4}}>Aviso - {avisoVehiculo.matricula}</div>
                <div style={{fontSize:13,color:"var(--text)",lineHeight:1.6,whiteSpace:"pre-line"}}>{avisoVehiculo.notas}</div>
                <button onClick={()=>setAvisoVehiculo(null)}
                  style={{marginTop:8,padding:"5px 16px",borderRadius:7,border:"none",background:"#f59e0b",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  Entendido - Continuar
                </button>
              </div>
            </div>
          </div>
        )}
        {focusContext?.pedido_id && String(focusContext.pedido_id) === String(pedido?.id) && (
          <div style={{background:"rgba(59,130,246,.10)",border:"1px solid rgba(59,130,246,.28)",borderRadius:10,padding:"10px 12px",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:11,fontWeight:900,color:"#60a5fa",textTransform:"uppercase",letterSpacing:".06em"}}>En foco</span>
              <div style={{flex:"1 1 260px"}}>
                <div style={{fontSize:12,color:"var(--text)",fontWeight:800}}>
                  {isControlTowerFocus ? (focusContext.title || focusContext.action || "Aviso de Control Tower") : "Abierto desde Pedidos"}
                </div>
                {isControlTowerFocus && focusContext.action && (
                  <div style={{display:"inline-flex",marginTop:5,padding:"2px 8px",borderRadius:20,border:"1px solid rgba(20,184,166,.35)",background:"rgba(20,184,166,.10)",color:"var(--accent-xl)",fontSize:10,fontWeight:900}}>
                    Accion elegida: {focusContext.action}
                  </div>
                )}
                <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.35,marginTop:2}}>
                  {isControlTowerFocus
                    ? (focusContext.description || "Revisa el pedido y aplica la siguiente accion operativa.")
                    : "Revisar urgencia, asignacion o datos pendientes."}
                </div>
              </div>
              {nextRecommendedAction && (
                <button
                  onClick={() => focusModalField(nextRecommendedAction.ref)}
                  style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(59,130,246,.30)",background:"rgba(59,130,246,.14)",color:"#60a5fa",fontWeight:800,fontSize:11,cursor:"pointer"}}
                >
                  {nextRecommendedAction.label}
                </button>
              )}
            </div>
            {isControlTowerFocus && (
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                {(["sin_asignar","retraso"].includes(String(focusContext.type || "")) || ["asignar_recurso","reasignar","actualizar_eta"].includes(focusActionKey)) && (
                  <button onClick={() => focusModalField(vehiculoRef)} style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(16,185,129,.30)",background:"rgba(16,185,129,.12)",color:"#34d399",fontWeight:800,fontSize:11,cursor:"pointer"}}>
                    Reasignar
                  </button>
                )}
                {(["notificar_cliente","avisar_cliente"].includes(focusActionKey) || ["incidencia_pedido","retraso","espera_carga","espera_descarga"].includes(String(focusContext.type || ""))) && <button onClick={avisarClienteDesdeControlTower} disabled={avisandoCliente} style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(245,158,11,.34)",background:"rgba(245,158,11,.12)",color:"#f59e0b",fontWeight:800,fontSize:11,cursor:avisandoCliente?"wait":"pointer",opacity:avisandoCliente ? .6 : 1}}>
                  {avisandoCliente ? "Enviando..." : "Notificar cliente"}
                </button>}
                {(["pod_pendiente","facturacion_inconsistente"].includes(String(focusContext.type || "")) || focusActionKey === "pedir_albaran") && (
                  <button onClick={() => navegarModulo("documentos")} style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(148,163,184,.28)",background:"var(--bg4)",color:"var(--text)",fontWeight:800,fontSize:11,cursor:"pointer"}}>
                    Documentos
                  </button>
                )}
                {(["facturacion_inconsistente","cobro_riesgo"].includes(String(focusContext.type || "")) || ["bloquear_factura","revisar_factura","reclamar_cobro","abrir_control_cobros"].includes(focusActionKey)) && (
                  <button onClick={() => navegarModulo("facturacion")} style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(139,92,246,.28)",background:"rgba(139,92,246,.12)",color:"#a78bfa",fontWeight:800,fontSize:11,cursor:"pointer"}}>
                    Facturacion
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:"var(--text)" }}>
              {pedido.numero}
            </div>
            {bloquear && (
              <div style={{ fontSize:11, color:"var(--green)", marginTop:2, display:"flex", alignItems:"center", gap:8 }}>
                <span>Facturado (Factura {pedido.factura_numero||"emitida"}) - solo lectura</span>
                <button
                  onClick={async()=>{
                    const ok = await confirmDialog({
                      title: "Desvincular factura",
                      message: "Esto NO elimina la factura; solo separa el pedido de ella.\nEl pedido volvera a estar editable.\n\nUsa esto solo si el pedido fue facturado por error.",
                      confirmText: "Desvincular",
                      tone: "danger",
                    });
                    if(!ok) return;
                    try {
                      await desvincularFacturaPedido(pedido.id);
                      // Unlock modal in-place without closing it
                      setDesvinculado(true);
                      if (typeof onFacturaDesvinculada === "function") {
                        onFacturaDesvinculada(pedido.id);
                      }
                      // Silently refresh parent list without closing modal
                      if (typeof onReload === "function") onReload();
                    } catch(e) { notify("Error: "+e.message, "error"); }
                  }}
                  style={{fontSize:10,padding:"2px 8px",borderRadius:5,border:"1px solid rgba(239,68,68,.4)",
                          background:"rgba(239,68,68,.08)",color:"#ef4444",cursor:"pointer",
                          fontFamily:"'DM Sans',sans-serif",fontWeight:700,whiteSpace:"nowrap"}}>
                  Desvincular factura
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            style={{ background:"none", border:"none", color:"var(--text4)", fontSize:24, cursor:"pointer", lineHeight:1, width:30, height:30 }}
          >
            x
          </button>
        </div>

        {!finanzasModal.sinPrecio && (
          <div style={{background:finanzasModal.margen < 0 ? "rgba(239,68,68,.08)" : "rgba(20,184,166,.08)",border:`1px solid ${finanzasModal.margen < 0 ? "rgba(239,68,68,.28)" : "rgba(20,184,166,.24)"}`,borderRadius:10,padding:"10px 12px",marginBottom:14}}>
            <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:finanzasModal.margen < 0 ? "#ef4444" : "var(--accent-xl)",marginBottom:8}}>Rentabilidad</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
              {[
                ["Ingreso", fmtEur(finanzasModal.ingreso)],
                ["Costes", fmtEur(finanzasModal.costes)],
                ["Margen", fmtEur(finanzasModal.margen)],
                ["Margen %", `${finanzasModal.pct.toFixed(1)}%`],
              ].map(([label, value]) => (
                <div key={label} style={{border:"1px solid var(--border)",background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>{label}</div>
                  <div style={{fontSize:13,fontWeight:900,color:label === "Margen" && finanzasModal.margen < 0 ? "#ef4444" : "var(--text)",marginTop:3}}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pedido.pendiente_completar && (
          <div style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.28)",borderRadius:8,padding:"8px 12px",marginBottom:12,color:"#fbbf24",fontSize:12,fontWeight:700}}>
            {pedido.aviso_completar || "Pedido creado rapido. Terminar de completar mas tarde."}
          </div>
        )}

        {!!conflictosOperativos.length && (
          <div style={{
            background: conflictosOperativos.some(c => c.level === "hard") ? "rgba(239,68,68,.08)" : "rgba(245,158,11,.10)",
            border: conflictosOperativos.some(c => c.level === "hard") ? "1px solid rgba(239,68,68,.28)" : "1px solid rgba(245,158,11,.28)",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 12
          }}>
            <div style={{
              color: conflictosOperativos.some(c => c.level === "hard") ? "#f87171" : "#f59e0b",
              fontSize: 12,
              fontWeight: 800,
              marginBottom: 6
            }}>
              {conflictosOperativos.some(c => c.level === "hard")
                ? "Conflicto operativo detectado"
                : "Posible conflicto operativo"}
            </div>
            <div style={{display:"grid",gap:6}}>
              {conflictosOperativos.slice(0, 3).map(conflicto => (
                <div key={conflicto.id} style={{fontSize:12,color:"var(--text)",lineHeight:1.45}}>
                  <strong>{conflicto.recurso}:</strong> {conflicto.resumen}
                  {conflicto.ventana ? <span style={{color:"var(--text5)"}}> ({conflicto.ventana})</span> : null}
                </div>
              ))}
              {conflictosOperativos.length > 3 && (
                <div style={{fontSize:11,color:"var(--text5)"}}>Y {conflictosOperativos.length - 3} conflicto(s) mas.</div>
              )}
            </div>
            {(pedido.vehiculo_id || pedido.chofer_id || pedido.remolque_id) && (
              <button
                type="button"
                onClick={() => onClearAssignment?.(pedido)}
                disabled={clearingAssignment || !onClearAssignment}
                style={{marginTop:9,padding:"6px 10px",borderRadius:7,border:"1px solid rgba(239,68,68,.28)",background:"rgba(239,68,68,.10)",color:"#f87171",fontSize:11,fontWeight:900,cursor:(clearingAssignment || !onClearAssignment) ? "not-allowed" : "pointer",opacity:(clearingAssignment || !onClearAssignment) ? .6 : 1,fontFamily:"'DM Sans',sans-serif"}}
              >
                {clearingAssignment ? "Limpiando..." : "Limpiar asignacion y devolver a bolsa"}
              </button>
            )}
          </div>
        )}
        {!!validationIssues.length && (
          <div style={{
            background:"rgba(245,158,11,.10)",
            border:"1px solid rgba(245,158,11,.28)",
            borderRadius:8,
            padding:"10px 12px",
            marginBottom:12
          }}>
            <div style={{color:"#f59e0b",fontSize:12,fontWeight:800,marginBottom:6}}>
              Datos pendientes para el estado actual
            </div>
            <div style={{display:"grid",gap:4}}>
              {validationIssues.slice(0, 5).map(issue => (
                <div key={issue} style={{fontSize:12,color:"var(--text)"}}>{issue}</div>
              ))}
            </div>
          </div>
        )}
        {suggestedAssignment && (
          <div style={{
            background:"rgba(59,130,246,.10)",
            border:"1px solid rgba(59,130,246,.26)",
            borderRadius:8,
            padding:"10px 12px",
            marginBottom:12
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
              <div>
                <div style={{color:"#60a5fa",fontSize:12,fontWeight:800,marginBottom:4}}>
                  Sugerencia operativa
                </div>
                <div style={{fontSize:12,color:"var(--text)"}}>
                  {suggestedAssignment.label || "Hay una asignacion sugerida para este viaje."}
                </div>
              </div>
              <button
                type="button"
                onClick={aplicarSugerenciaModal}
                style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(59,130,246,.30)",background:"rgba(59,130,246,.14)",color:"#60a5fa",fontWeight:800,fontSize:11,cursor:"pointer"}}
              >
                Aplicar sugerencia
              </button>
            </div>
          </div>
        )}
        {suggestedTariff && (
          <div style={{
            background:"rgba(16,185,129,.08)",
            border:"1px solid rgba(16,185,129,.24)",
            borderRadius:8,
            padding:"10px 12px",
            marginBottom:12
          }}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div>
                <div style={{color:"#34d399",fontSize:12,fontWeight:800,marginBottom:4}}>
                  Tarifa encontrada
                </div>
                <div style={{fontSize:12,color:"var(--text)"}}>
                  {suggestedTariff.ruta.origen} -> {suggestedTariff.ruta.destino}: <strong>{fmtEur(suggestedTariff.importe)}</strong>
                  {suggestedTariff.recargoPct ? <span style={{color:"var(--text5)"}}> con revision combustible {suggestedTariff.recargoPct}%</span> : null}
                </div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                  Tipo {suggestedTariff.tipo} · base {fmtEur(suggestedTariff.precioBase)} · cantidad {Number(suggestedTariff.cantidad || 0).toLocaleString("es-ES")}
                </div>
              </div>
              <button
                type="button"
                onClick={aplicarTarifaSugerida}
                disabled={bloquear}
                style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(16,185,129,.30)",background:"rgba(16,185,129,.14)",color:"#34d399",fontWeight:800,fontSize:11,cursor:bloquear?"not-allowed":"pointer",opacity:bloquear ? .55 : 1}}
              >
                Aplicar tarifa
              </button>
            </div>
          </div>
        )}
        <div style={{
          background:"rgba(20,184,166,.08)",
          border:"1px solid rgba(20,184,166,.24)",
          borderRadius:8,
          padding:"10px 12px",
          marginBottom:12
        }}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
            <div>
              <div style={{color:"var(--accent-xl)",fontSize:12,fontWeight:900,marginBottom:3}}>Ida y retorno</div>
              <div style={{fontSize:11,color:"var(--text4)"}}>
                Enlaza una salida con su retorno para calcular km en vacio, km cargados y precio total.
              </div>
            </div>
            <span style={{fontSize:10,fontWeight:900,color:"var(--accent-xl)",border:"1px solid rgba(20,184,166,.30)",borderRadius:20,padding:"3px 8px"}}>
              {tipoViajeLabel(form.tipo_viaje || pedido.tipo_viaje)}
            </span>
          </div>
          {idaRetornoLoading ? (
            <div style={{fontSize:11,color:"var(--text5)"}}>Calculando enlace...</div>
          ) : idaRetorno?.enlazado && idaRetorno?.resumen ? (
            <div style={{display:"grid",gap:8}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                {[
                  ["Precio total", fmtEur(idaRetorno.resumen.ingresos?.total || 0)],
                  ["Km cargados", `${Number(idaRetorno.resumen.km?.cargado_total || 0).toLocaleString("es-ES")} km`],
                  ["Km vacio", `${Number(idaRetorno.resumen.km?.vacio_enlace || 0).toLocaleString("es-ES")} km`],
                  ["EUR/km", idaRetorno.resumen.eur_km_total ? `${Number(idaRetorno.resumen.eur_km_total).toLocaleString("es-ES")} EUR/km` : "-"],
                ].map(([label, value]) => (
                  <div key={label} style={{border:"1px solid rgba(148,163,184,.18)",borderRadius:7,padding:"6px 7px",background:"rgba(2,6,23,.04)"}}>
                    <div style={{fontSize:9,color:"var(--text5)",textTransform:"uppercase",fontWeight:800}}>{label}</div>
                    <div style={{fontSize:12,color:"var(--text)",fontWeight:900,marginTop:2}}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.45}}>
                Salida {idaRetorno.resumen.salida_numero || "-"}: {idaRetorno.resumen.rutas?.ida?.origen || "-"} - {idaRetorno.resumen.rutas?.ida?.destino || "-"}<br/>
                Retorno {idaRetorno.resumen.retorno_numero || "-"}: {idaRetorno.resumen.rutas?.retorno?.origen || "-"} - {idaRetorno.resumen.rutas?.retorno?.destino || "-"}
              </div>
              {!!idaRetorno.resumen.avisos?.length && (
                <div style={{fontSize:11,color:"#f59e0b",lineHeight:1.45}}>
                  {idaRetorno.resumen.avisos.slice(0, 3).join(" ")}
                </div>
              )}
              <button type="button" onClick={desvincularIdaRetornoActual} disabled={bloquear || enlazandoRetorno}
                style={{justifySelf:"start",padding:"6px 10px",borderRadius:7,border:"1px solid rgba(239,68,68,.28)",background:"rgba(239,68,68,.10)",color:"#ef4444",fontWeight:800,fontSize:11,cursor:bloquear||enlazandoRetorno?"not-allowed":"pointer",opacity:(bloquear || enlazandoRetorno) ? .6 : 1}}>
                Desvincular retorno
              </button>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"1.5fr .7fr auto",gap:8,alignItems:"end"}}>
              <div>
                <label style={{...lbl, marginTop:0}}>Retorno asociado</label>
                <select style={inp} value={linkRetornoId} onChange={e => setLinkRetornoId(e.target.value)} disabled={bloquear || enlazandoRetorno}>
                  <option value="">Seleccionar retorno...</option>
                  {candidatosRetorno.map(p => (
                    <option key={p.id} value={p.id}>
                      {(p.vehiculo_matricula || p.matricula || "Sin matricula")} - {p.numero} - {p.origen || "-"} a {p.destino || "-"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{...lbl, marginTop:0}}>Km vacio</label>
                <input style={inp} type="number" min="0" step="0.1" value={linkKmVacio} onChange={e => setLinkKmVacio(e.target.value)} disabled={bloquear || enlazandoRetorno}/>
              </div>
              <button type="button" onClick={enlazarRetornoSeleccionado} disabled={bloquear || enlazandoRetorno || !linkRetornoId}
                style={{padding:"8px 12px",borderRadius:7,border:"1px solid rgba(20,184,166,.30)",background:"rgba(20,184,166,.14)",color:"var(--accent-xl)",fontWeight:900,fontSize:11,cursor:bloquear||enlazandoRetorno||!linkRetornoId?"not-allowed":"pointer",opacity:(bloquear || enlazandoRetorno || !linkRetornoId) ? .55 : 1}}>
                {enlazandoRetorno ? "Enlazando..." : "Enlazar"}
              </button>
            </div>
          )}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
          <div><label style={lbl}>Origen</label><input ref={origenRef} style={inp} value={form.origen||""} onChange={f("origen")} disabled={bloquear}/></div>
          <div><label style={lbl}>Destino</label><input ref={destinoRef} style={inp} value={form.destino||""} onChange={f("destino")} disabled={bloquear}/></div>
          <div><label style={lbl}>Tipo de viaje</label>
            <select style={inp} value={form.tipo_viaje || "normal"} onChange={f("tipo_viaje")} disabled={bloquear}>
              <option value="normal">Normal</option>
              <option value="salida">Salida</option>
              <option value="retorno">Retorno</option>
            </select>
          </div>
          <div><label style={lbl}>Enlace</label><input style={inp} value={form.viaje_enlazado_id ? "Viaje ida-retorno enlazado" : "Sin enlace"} disabled/></div>
          <div>
              <label style={lbl}>Fecha carga <span style={{color:"#ef4444"}}>*</span></label>
              <input ref={fechaCargaRef} type="date" style={{...inp, borderColor: !form.fecha_carga ? "rgba(239,68,68,.5)" : "var(--border2)"}}
                value={form.fecha_carga||""} onChange={f("fecha_carga")} disabled={bloquear}/>
              {!form.fecha_carga && <div style={{fontSize:10,color:"#ef4444",marginTop:2}}>Obligatoria</div>}
            </div>
          <div><label style={lbl}>Hora carga</label><input type="time" style={inp} value={form.hora_carga||""} onChange={f("hora_carga")} disabled={bloquear}/></div>
          <div><label style={lbl}>Fecha descarga</label><input ref={fechaDescargaRef} type="date" style={inp} value={form.fecha_descarga||""} onChange={f("fecha_descarga")} disabled={bloquear}/></div>
          <div><label style={lbl}>Hora descarga</label><input type="time" style={inp} value={form.hora_descarga||""} onChange={f("hora_descarga")} disabled={bloquear}/></div>
          <div><label style={lbl}>Vehiculo</label>
            <select ref={vehiculoRef} style={inp} value={form.vehiculo_id||""} onChange={e=>{
              const vid = e.target.value;
              setForm(p=>({...p,vehiculo_id:vid}));
              const veh = vehiculos?.find(v=>v.id===vid);
              if(veh?.notas_operacion?.trim()){
                setAvisoVehiculo({matricula:veh.matricula, notas:veh.notas_operacion});
              }
            }} disabled={bloquear}>
              <option value="">Sin asignar</option>
              {vehiculos.map(v => <option key={v.id} value={v.id}>{v.matricula} - {v.marca} {v.modelo}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Chofer</label>
            <select ref={choferRef} style={inp} value={form.chofer_id||""} onChange={f("chofer_id")} disabled={bloquear}>
              <option value="">Sin asignar</option>
              {choferes.map(c => <option key={c.id} value={c.id}>{c.nombre} {c.apellidos||""}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Estado</label>
            <select style={inp} value={form.estado||"pendiente"} onChange={f("estado")} disabled={bloquear}>
              {Object.entries(EC).map(([v,d]) => <option key={v} value={v}>{d.label}</option>)}
            </select>
          </div>
          <div><label style={lbl}>KM ruta (cargado)</label>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input type="number" style={{...inp,flex:1}} value={form.km_ruta||form.km||""} onChange={e => setForm(p=>({...p, km_ruta:e.target.value, km:e.target.value}))} placeholder="0"/>
              {form.origen && form.destino && (
                <button type="button" onClick={async()=>{
                  const km = await calcKmOSRM(form.origen, form.destino);
                  if(km) setForm(p=>({...p, km_ruta:km, km:km}));
                  else notify("No se pudo calcular. Introduce los km manualmente.", "warning");
                }} style={{padding:"6px 10px",borderRadius:6,border:"1px solid var(--accent)",background:"transparent",color:"var(--accent)",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",fontWeight:700}}>
                  Calc
                </button>
              )}
            </div>
          </div>
          <div><label style={lbl}>KM en vacio</label>
            <input type="number" style={inp} value={form.km_vacio||""} onChange={f("km_vacio")} placeholder="0" onFocus={e=>e.target.select()}/>
          </div>
          <div><label style={lbl}>Importe (EUR)</label>
            <input type="number" step="0.01" style={inp} value={form.importe||""} onChange={f("importe")} disabled={bloquear} onFocus={e=>e.target.select()}/>
          </div>
          <div><label style={lbl}>Cliente</label>
            <input style={inp} value={form.cliente_nombre||""} disabled/>
          </div>
          {Number(form.km_ruta||form.km||0)>0 && (() => {
            const cfg = cfgTraficoLoad();
            const t = calcTiempoTransito(Number(form.km_ruta||form.km||0), cfg);
            if (!t) return null;
            return (
              <div style={{ gridColumn:"1/-1", background:"rgba(16,185,129,.07)", border:"1px solid rgba(16,185,129,.2)", borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
                <span style={{fontSize:10,fontWeight:800,color:"#34d399",padding:"4px 7px",borderRadius:999,border:"1px solid rgba(52,211,153,.35)",background:"rgba(52,211,153,.10)"}}>ETA</span>
                <div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:14,color:"#34d399"}}>Tiempo estimado de transito: {t.label}</div>
                  <div style={{fontSize:11,color:"var(--text5)"}}>
                    {Number(form.km_ruta||form.km||0)} km / {cfgTraficoLoad().velocidad_media||80} km/h
                    {" + "}{Math.floor((Number(form.km_ruta||form.km||0)/(cfgTraficoLoad().velocidad_media||80))/(cfgTraficoLoad().horas_pausa||4.5))} pausa(s)
                    {" + "}{cfgTraficoLoad().tiempo_descarga||60} min descarga
                  </div>
                </div>
              </div>
            );
          })()}
          <div style={{ gridColumn:"1/-1" }}>
            <label style={lbl}>Mercancia / Notas</label>
            <textarea style={{ ...inp, height:56, resize:"vertical" }} value={form.notas||""} onChange={f("notas")} disabled={bloquear}/>
          </div>
        </div>

        <div style={{marginTop:14,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px"}}>
          <div style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Historial del pedido</div>
          {eventosLoading ? (
            <div style={{fontSize:12,color:"var(--text5)"}}>Cargando eventos...</div>
          ) : eventos.length ? (
            <div style={{display:"grid",gap:8}}>
              {eventos.slice(0,8).map(ev=>(
                <div key={ev.id} style={{paddingTop:8,borderTop:"1px solid var(--border)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:11}}>
                    <span style={{color:"var(--text)",fontWeight:800}}>{pedidoEventoLabel(ev)}</span>
                    <span style={{color:"var(--text5)"}}>{new Date(ev.created_at).toLocaleString("es-ES")}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>
                    {pedidoEventoDetalle(ev) || (ev.actor_tipo ? `Actor: ${ev.actor_tipo}` : "Sin detalle adicional")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{fontSize:12,color:"var(--text5)"}}>Todavia no hay eventos registrados para este pedido.</div>
          )}
        </div>

        {!bloquear && (
          <div style={{ display:"flex", gap:8, marginTop:16, justifyContent:"flex-end" }}>
            <button onClick={onClose} style={{ padding:"7px 14px", borderRadius:7, border:"1px solid var(--border2)", background:"transparent", color:"var(--text3)", fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:600, cursor:"pointer" }}>
              Cancelar
            </button>
            <button onClick={guardar} disabled={saving} style={{ padding:"7px 16px", borderRadius:7, border:"none", background:"var(--accent)", color:"#fff", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, cursor:saving?"not-allowed":"pointer", opacity:saving?0.7:1 }}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function OptimizacionRutas({ pedidos, vehiculos, choferes, soloLecturaChofer = false }) {
  const [preferencia, setPreferencia] = useState("camion");
  const [search, setSearch] = useState("");
  const [providerInfo, setProviderInfo] = useState(null);
  const [apiPlan, setApiPlan] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [dispatches, setDispatches] = useState([]);
  const [sendLoading, setSendLoading] = useState("");
  const candidatos = useMemo(() => pedidos
    .filter(p => !["cancelado"].includes(p.estado))
    .filter(p => pedidoRouteStops(p).length >= 2)
    .filter(p => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [p.numero, p.cliente_nombre, p.colaborador_nombre, p.origen, p.destino, p.vehiculo_matricula, p.chofer_nombre]
        .some(x => String(x || "").toLowerCase().includes(q));
    }), [pedidos, search]);
  const [selectedId, setSelectedId] = useState("");
  const selected = candidatos.find(p => p.id === selectedId) || candidatos[0] || null;
  const vehiculo = selected ? vehiculos.find(v => v.id === selected.vehiculo_id) : null;
  const chofer = selected ? choferes.find(c => c.id === selected.chofer_id) : null;
  const plan = selected ? buildRoutePlan(selected, preferencia, vehiculo) : null;
  const remotePlan = apiPlan?.pedido_id === selected?.id && apiPlan?.preference === preferencia ? apiPlan : null;
  const planKm = remotePlan?.distance_km || plan?.km || 0;
  const planDuration = remotePlan?.duration_min ? `${Math.floor(remotePlan.duration_min / 60)}h${remotePlan.duration_min % 60 ? ` ${remotePlan.duration_min % 60}min` : ""}` : plan?.tiempo?.label;
  const planUrl = remotePlan?.maps_url || plan?.url || "";
  const providerLabel = remotePlan?.provider_label || providerInfo?.providers?.[providerInfo?.active]?.label || "Local / enlace orientativo";
  const activeProvider = providerInfo?.active || "local";
  const activeProviderMeta = providerInfo?.providers?.[activeProvider] || {};
  const puedeEnviarRuta = !soloLecturaChofer;

  useEffect(() => {
    if (!selectedId && candidatos[0]) setSelectedId(candidatos[0].id);
    if (selectedId && !candidatos.some(p => p.id === selectedId)) setSelectedId(candidatos[0]?.id || "");
  }, [candidatos, selectedId]);

  useEffect(() => {
    getRouteProviders().then(setProviderInfo).catch(() => {});
  }, []);

  useEffect(() => {
    setApiPlan(null);
  }, [selected?.id, preferencia]);

  useEffect(() => {
    let alive = true;
    if (!selected?.id) return undefined;
    getRutaOptimizadaPedido(selected.id)
      .then(data => {
        if (!alive || !data) return;
        setApiPlan({
          ...data,
          pedido_id: selected.id,
          preference: data.preference || "camion",
          provider_label: data.provider_label || data.provider,
          maps_url: data.maps_url,
          distance_km: data.distance_km ? Number(data.distance_km) : null,
          duration_min: data.duration_min ? Number(data.duration_min) : null,
          stops: data.stops || [],
          truck: data.truck || {},
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [selected?.id]);

  const cargarEnvios = useCallback(() => {
    if (!selected?.id) { setDispatches([]); return; }
    getRutaEnviosPedido(selected.id).then(setDispatches).catch(() => setDispatches([]));
  }, [selected?.id]);

  useEffect(() => {
    cargarEnvios();
  }, [cargarEnvios]);

  const card = { background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, padding:14 };
  const btn = { padding:"8px 12px", borderRadius:7, border:"1px solid var(--border2)", background:"var(--bg4)", color:"var(--text)", fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" };

  async function copiar() {
    if (!planUrl) return notify("No hay direcciones suficientes para generar enlace.", "warning");
    try {
      await navigator.clipboard.writeText(planUrl);
      notify("Enlace de ruta copiado.", "success");
    } catch {
      window.prompt("Copia el enlace de ruta:", planUrl);
    }
  }

  async function enviarRuta(tipo) {
    if (!planUrl) return notify("No hay direcciones suficientes para enviar ruta.", "warning");
    const esAppChofer = tipo === "chofer_app";
    const destinatario = tipo === "chofer"
      ? (chofer?.email || chofer?.correo || selected?.chofer_email || "")
      : (selected?.colaborador_email || "");
    if (!esAppChofer && !destinatario) {
      notify(tipo === "chofer" ? "El chofer no tiene email registrado." : "El colaborador no tiene email registrado.", "warning");
      return;
    }
    setSendLoading(tipo);
    try {
      const res = await enviarRutaOptimizada(selected.id, {
        recipient_type: tipo,
        email: esAppChofer ? "" : destinatario,
        name: esAppChofer ? (chofer ? `${chofer.nombre || ""} ${chofer.apellidos || ""}`.trim() : selected?.chofer_nombre || "") : "",
        route_url: planUrl,
        preference: preferencia,
        distance_km: planKm || null,
        duration_label: planDuration || "",
        stops: plan.stops,
        provider_label: providerLabel,
      });
      cargarEnvios();
      notify(res?.app_notification ? "Ruta enviada a la app del chofer y trazabilidad registrada." : res?.public_url ? "Ruta enviada y trazabilidad registrada." : "Ruta registrada.", "success");
      if (res?.public_url) {
        try { await navigator.clipboard.writeText(res.public_url); } catch {}
      }
    } catch (e) {
      notify("No se pudo enviar la ruta: " + e.message, "error");
    } finally {
      setSendLoading("");
    }
  }

  async function calcularConApi() {
    if (!plan) return;
    setApiLoading(true);
    try {
      const data = await optimizarRuta({
        pedido_id: selected.id,
        preference: preferencia,
        stops: plan.stops,
        truck: {
          height_m: Number(vehiculo?.altura_m || 4),
          width_m: Number(vehiculo?.anchura_m || 2.55),
          length_m: Number(vehiculo?.longitud_m || 16.5),
          weight_t: Number(selected?.peso_kg || 40000) / 1000 > 1 ? Number(selected?.peso_kg || 40000) / 1000 : 40,
        },
      });
      setApiPlan({ ...data, pedido_id: selected.id });
      notify(data.warning || `Ruta calculada y guardada con ${data.provider_label}.`, data.warning ? "warning" : "success");
    } catch (e) {
      notify("No se pudo calcular la ruta: " + e.message, "error");
    } finally {
      setApiLoading(false);
    }
  }

  return (
    <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"grid",gridTemplateColumns:"minmax(280px,390px) 1fr",gap:16}}>
      <div style={{display:"flex",flexDirection:"column",gap:12,minWidth:0}}>
        <div style={card}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:18,color:"var(--text)",marginBottom:6}}>{soloLecturaChofer ? "Mi ruta recomendada" : "Optimizacion de rutas"}</div>
          <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.5,marginBottom:12}}>
            {soloLecturaChofer
              ? "Consulta tus viajes de la semana seleccionada y abre la ruta recomendada con referencia para camion."
              : "Recomienda rutas usando las direcciones completas de cargas y descargas. El enlace es navegacion orientativa y se debe validar como ruta apta para camion."}
          </div>
          <div style={{background:activeProvider==="local"?"rgba(245,158,11,.10)":"rgba(16,185,129,.08)",border:`1px solid ${activeProvider==="local"?"rgba(245,158,11,.30)":"rgba(16,185,129,.25)"}`,borderRadius:8,padding:"9px 10px",marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
              <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em"}}>Proveedor activo</div>
              <div style={{fontSize:10,fontWeight:900,color:activeProvider==="local"?"#f59e0b":"#10b981",textTransform:"uppercase"}}>{activeProvider}</div>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",fontWeight:800,marginTop:3}}>{activeProviderMeta.label || providerLabel}</div>
            <div style={{fontSize:11,color:"var(--text5)",marginTop:3,lineHeight:1.4}}>
              {activeProvider==="local"
                ? (soloLecturaChofer ? "Ruta orientativa sin API avanzada activa. Si necesitas precision camion real, revisalo con trafico." : "Sin API de rutas activa. Configura HERE en TransGestAdmin para calculo camion real.")
                : activeProviderMeta.truck_aware
                  ? "Calcula con restricciones de camion cuando las direcciones son geocodificables."
                  : "Proveedor activo sin restricciones avanzadas de camion."}
            </div>
          </div>
          <label style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".07em"}}>Criterio</label>
          <select value={preferencia} onChange={e=>setPreferencia(e.target.value)}
            style={{width:"100%",marginTop:5,marginBottom:10,padding:"9px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",fontSize:13}}>
            <option value="camion">Camion / restricciones</option>
            <option value="rapida">Mas rapida</option>
            <option value="eficiente">Mas eficiente</option>
            <option value="segura">Mas segura</option>
          </select>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pedido, cliente, camion..."
            style={{width:"100%",boxSizing:"border-box",padding:"9px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",fontSize:13}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {candidatos.map(p => {
            const active = selected?.id === p.id;
            const stops = pedidoRouteStops(p);
            return (
              <button key={p.id} onClick={()=>setSelectedId(p.id)}
                style={{...card,textAlign:"left",cursor:"pointer",borderColor:active?"var(--accent)":"var(--border)",background:active?"rgba(20,184,166,.08)":"var(--bg2)"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                  <div style={{fontWeight:900,color:"var(--text)",fontSize:13}}>{p.numero || "Pedido"}</div>
                  <div style={{fontSize:11,color:"var(--text5)"}}>{Number(p.km_ruta||p.km||0) ? `${Number(p.km_ruta||p.km).toLocaleString("es-ES")} km` : "km pendiente"}</div>
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:5,lineHeight:1.35}}>{stops[0]?.address} -> {stops[stops.length-1]?.address}</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:6}}>
                  {p.colaborador_nombre ? `Colaborador: ${p.colaborador_nombre}` : `Vehiculo: ${p.vehiculo_matricula || "sin asignar"}`}
                </div>
              </button>
            );
          })}
          {!candidatos.length && <div style={{...card,color:"var(--text5)",fontSize:13}}>No hay pedidos con direcciones suficientes en este periodo.</div>}
        </div>
      </div>

      <div style={{...card,minWidth:0}}>
        {!plan ? (
          <div style={{height:"100%",minHeight:300,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text5)",fontWeight:700}}>Selecciona un pedido para optimizar la ruta.</div>
        ) : (
          <>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".08em"}}>Plan recomendado</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:900,color:"var(--text)",marginTop:3}}>{plan.pedido.numero || "Pedido"}</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>{plan.modoLabel} - {plan.pedido.cliente_nombre || plan.pedido.colaborador_nombre || "sin cliente"}</div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                <button style={btn} onClick={calcularConApi} disabled={apiLoading}>{apiLoading ? "Calculando..." : "Calcular"}</button>
                <button style={btn} onClick={()=>planUrl && window.open(planUrl,"_blank","noopener,noreferrer")}>Abrir enlace</button>
                <button style={btn} onClick={copiar}>Copiar enlace</button>
                <button style={btn} onClick={()=>printRoutePlan({ ...plan, km: planKm, tiempo: planDuration ? { label: planDuration } : plan.tiempo, url: planUrl })}>PDF ruta</button>
              </div>
            </div>
            {remotePlan?.warning && (
              <div style={{background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.35)",borderRadius:8,padding:"9px 12px",color:"#f59e0b",fontSize:12,fontWeight:700,marginBottom:12}}>
                {remotePlan.warning}
              </div>
            )}
            {remotePlan?.saved?.created_at || remotePlan?.created_at ? (
              <div style={{background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.25)",borderRadius:8,padding:"9px 12px",color:"#10b981",fontSize:12,fontWeight:800,marginBottom:12}}>
                Ruta guardada: {new Date(remotePlan.saved?.created_at || remotePlan.created_at).toLocaleString("es-ES")}
              </div>
            ) : null}
            <RutaMapaVisual
              plan={plan}
              remotePlan={remotePlan}
              planUrl={planUrl}
              onPreferencia={next => {
                setPreferencia(next);
                setTimeout(() => notify(`Criterio cambiado a ${next}. Pulsa Calcular para guardar la alternativa.`, "success"), 50);
              }}
            />

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(120px,1fr))",gap:10,marginBottom:14}}>
              {[
                ["Km", planKm ? `${Number(planKm).toLocaleString("es-ES")} km` : "Pendiente"],
                ["Tiempo", planDuration || "Pendiente"],
                ["Peso", plan.pesoTn ? `${plan.pesoTn.toFixed(1)} t` : "Sin dato"],
                ["Proveedor", providerLabel],
              ].map(([k,v])=>(
                <div key={k} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase"}}>{k}</div>
                  <div style={{fontSize:15,color:"var(--text)",fontWeight:900,marginTop:4}}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1.1fr .9fr",gap:14}}>
              <div>
                <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Paradas</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {plan.stops.map((s, idx)=>(
                    <div key={`${s.address}-${idx}`} style={{display:"grid",gridTemplateColumns:"34px 1fr",gap:10,alignItems:"start",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:10}}>
                      <div style={{height:28,width:28,borderRadius:6,background:idx===0?"#0f766e":idx===plan.stops.length-1?"#f97316":"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:"#fff"}}>{idx+1}</div>
                      <div>
                        <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase"}}>{s.type}</div>
                        <div style={{fontSize:13,color:"var(--text)",fontWeight:900,marginTop:2}}>{s.name || s.address}</div>
                        <div style={{fontSize:12,color:"var(--text4)",marginTop:3,lineHeight:1.45}}>{s.address}</div>
                        {(s.date || s.time || s.window) && <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>{[s.date, s.time, s.window].filter(Boolean).join(" - ")}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>
                  {soloLecturaChofer ? "Acciones del viaje" : "Envio y control camion"}
                </div>
                <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.45,marginBottom:10}}>
                  {soloLecturaChofer
                    ? "Abre, copia o descarga la ruta para seguirla durante el viaje. Solo ves tus pedidos de la semana seleccionada."
                    : 'Para recomendarla al colaborador, selecciona un pedido asignado a colaborador, calcula la ruta y pulsa "Enviar al colaborador". Le llega un enlace para abrir la ruta y marcarla como aceptada.'}
                </div>
                {puedeEnviarRuta && (
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
                    <button style={{...btn,borderColor:"rgba(20,184,166,.35)",background:"rgba(20,184,166,.10)",color:"#14b8a6"}} onClick={()=>enviarRuta("chofer_app")} disabled={sendLoading==="chofer_app" || !selected?.chofer_id}>
                      {sendLoading==="chofer_app" ? "Enviando..." : selected?.chofer_id ? "Enviar a app del chofer" : "Asigna chofer para enviar a app"}
                    </button>
                    <button style={btn} onClick={()=>enviarRuta("chofer")} disabled={sendLoading==="chofer"}>{sendLoading==="chofer" ? "Enviando..." : "Enviar por email al chofer"}</button>
                    <button style={btn} onClick={()=>enviarRuta("colaborador")} disabled={sendLoading==="colaborador"}>{sendLoading==="colaborador" ? "Enviando..." : "Enviar al colaborador"}</button>
                  </div>
                )}
                <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:12,marginBottom:10}}>
                  <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",marginBottom:8}}>Trazabilidad de ruta</div>
                  {dispatches.length ? dispatches.slice(0,4).map(d => (
                    <div key={d.id} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center",padding:"7px 0",borderTop:"1px solid var(--border)"}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12,color:"var(--text)",fontWeight:900,textTransform:"capitalize"}}>{d.recipient_type} - {d.recipient_name || d.recipient_email}</div>
                        <div style={{fontSize:11,color:"var(--text5)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.recipient_email}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:11,fontWeight:900,color:d.status==="aceptada"?"#10b981":d.status==="abierta"?"#f59e0b":"var(--text4)",textTransform:"uppercase"}}>{d.status}</div>
                        <div style={{fontSize:10,color:"var(--text5)"}}>{d.accepted_at ? new Date(d.accepted_at).toLocaleString("es-ES") : d.opened_at ? new Date(d.opened_at).toLocaleString("es-ES") : new Date(d.sent_at).toLocaleString("es-ES")}</div>
                      </div>
                    </div>
                  )) : <div style={{fontSize:12,color:"var(--text5)",lineHeight:1.45}}>{soloLecturaChofer ? "Todavia no hay eventos de envio registrados para esta ruta." : "Todavia no se ha enviado esta ruta. Al enviarla se registrara como enviada, abierta y aceptada."}</div>}
                </div>
                <div style={{background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.35)",borderRadius:8,padding:12,color:"var(--text3)",fontSize:12,lineHeight:1.55,marginBottom:10}}>
                  Revisar antes de salir: galibo, MMA, restricciones urbanas, ADR si aplica, accesos a muelle, horario de carga/descarga y zonas de espera.
                </div>
                <div style={{background:"rgba(20,184,166,.08)",border:"1px solid rgba(20,184,166,.25)",borderRadius:8,padding:12}}>
                  <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",marginBottom:6}}>Recomendaciones</div>
                  <ul style={{margin:"0 0 0 18px",padding:0,color:"var(--text3)",fontSize:12,lineHeight:1.65}}>
                    {plan.recomendaciones.map((r,i)=><li key={i}>{r}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function routeLonLatToWorld({ lon, lat }, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  const x = ((Number(lon) + 180) / 360) * scale;
  const sin = Math.sin((Number(lat) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function buildEmbeddedRouteMap(points, width = 720, height = 310) {
  const valid = points.filter(p => Number.isFinite(Number(p.lon)) && Number.isFinite(Number(p.lat)));
  if (valid.length < 2) return null;
  const minLon = Math.min(...valid.map(p => Number(p.lon)));
  const maxLon = Math.max(...valid.map(p => Number(p.lon)));
  const minLat = Math.min(...valid.map(p => Number(p.lat)));
  const maxLat = Math.max(...valid.map(p => Number(p.lat)));
  const span = Math.max(maxLon - minLon, maxLat - minLat);
  const zoom = span > 12 ? 5 : span > 6 ? 6 : span > 3 ? 7 : span > 1.4 ? 8 : 9;
  const center = { lon:(minLon + maxLon) / 2, lat:(minLat + maxLat) / 2 };
  const centerWorld = routeLonLatToWorld(center, zoom);
  const topLeft = { x:centerWorld.x - width / 2, y:centerWorld.y - height / 2 };
  const minTileX = Math.floor(topLeft.x / 256);
  const maxTileX = Math.floor((topLeft.x + width) / 256);
  const minTileY = Math.floor(topLeft.y / 256);
  const maxTileY = Math.floor((topLeft.y + height) / 256);
  const tiles = [];
  const maxTile = Math.pow(2, zoom);
  for (let tx = minTileX; tx <= maxTileX; tx += 1) {
    for (let ty = minTileY; ty <= maxTileY; ty += 1) {
      if (ty < 0 || ty >= maxTile) continue;
      const wrappedX = ((tx % maxTile) + maxTile) % maxTile;
      tiles.push({
        key: `${zoom}-${tx}-${ty}`,
        left: Math.round(tx * 256 - topLeft.x),
        top: Math.round(ty * 256 - topLeft.y),
        url: `https://a.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${wrappedX}/${ty}.png`,
      });
    }
  }
  const projected = valid.map(p => {
    const world = routeLonLatToWorld(p, zoom);
    return { ...p, x: world.x - topLeft.x, y: world.y - topLeft.y };
  });
  return { tiles, projected, width, height };
}

function RutaMapaVisual({ plan, remotePlan, planUrl, onPreferencia }) {
  const stops = remotePlan?.stops?.length ? remotePlan.stops : plan?.stops || [];
  const coords = Array.isArray(remotePlan?.waypoint_coordinates) ? remotePlan.waypoint_coordinates : [];
  const hasCoords = coords.length >= 2;
  const points = hasCoords ? coords.map(c => ({ lon:Number(c.lon), lat:Number(c.lat) })) : stops.map((_, idx) => ({
    lon: idx,
    lat: idx % 2 === 0 ? 0 : 0.35,
  }));
  const lons = points.map(p => p.lon);
  const lats = points.map(p => p.lat);
  const minLon = Math.min(...lons, 0);
  const maxLon = Math.max(...lons, 1);
  const minLat = Math.min(...lats, 0);
  const maxLat = Math.max(...lats, 1);
  const pad = 34;
  const w = 720;
  const h = 310;
  const spanLon = Math.max(maxLon - minLon, 0.01);
  const spanLat = Math.max(maxLat - minLat, 0.01);
  const xy = p => ({
    x: pad + ((p.lon - minLon) / spanLon) * (w - pad * 2),
    y: h - pad - ((p.lat - minLat) / spanLat) * (h - pad * 2),
  });
  const svgPts = points.map(xy);
  const path = svgPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const embeddedMap = hasCoords ? buildEmbeddedRouteMap(points, w, h) : null;
  const embeddedPath = embeddedMap?.projected?.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") || "";

  return (
    <div style={{background:"linear-gradient(180deg,var(--bg3),var(--bg2))",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:10}}>
        <div>
          <div style={{fontSize:11,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".08em"}}>Mapa operativo</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:2}}>
            {hasCoords ? "Trazado con la ruta calculada." : "Vista esquematica hasta calcular la ruta."}
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button onClick={()=>onPreferencia("rapida")} style={{padding:"5px 9px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text4)",fontSize:11,fontWeight:800,cursor:"pointer"}}>Alternativa rapida</button>
          <button onClick={()=>onPreferencia("eficiente")} style={{padding:"5px 9px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text4)",fontSize:11,fontWeight:800,cursor:"pointer"}}>Alternativa eficiente</button>
          <button disabled={!hasCoords} style={{padding:"5px 9px",borderRadius:6,border:"1px solid rgba(20,184,166,.35)",background:"rgba(20,184,166,.1)",color:"#14b8a6",fontSize:11,fontWeight:900,cursor:hasCoords?"default":"not-allowed",opacity:hasCoords?1:.55}}>Mapa real</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:hasCoords ? "1fr 1fr" : "1fr",gap:10}}>
        <div style={{position:"relative",minHeight:310,border:"1px solid var(--border)",borderRadius:8,overflow:"hidden",background:"radial-gradient(circle at 20% 20%, rgba(20,184,166,.14), transparent 26%), linear-gradient(135deg, rgba(15,23,42,.88), rgba(30,41,59,.64))"}}>
          <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%",height:"100%",display:"block",minHeight:310}}>
            {[0,1,2,3,4].map(i => <line key={`v${i}`} x1={pad+i*(w-pad*2)/4} x2={pad+i*(w-pad*2)/4} y1={pad} y2={h-pad} stroke="rgba(148,163,184,.12)" strokeWidth="1"/>)}
            {[0,1,2,3].map(i => <line key={`h${i}`} y1={pad+i*(h-pad*2)/3} y2={pad+i*(h-pad*2)/3} x1={pad} x2={w-pad} stroke="rgba(148,163,184,.12)" strokeWidth="1"/>)}
            <path d={path} fill="none" stroke="rgba(20,184,166,.24)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"/>
            <path d={path} fill="none" stroke="#14b8a6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
            {svgPts.map((p, idx) => (
              <g key={idx}>
                <circle cx={p.x} cy={p.y} r="14" fill={idx===0?"#0f766e":idx===svgPts.length-1?"#f97316":"#3b82f6"} stroke="#fff" strokeWidth="2"/>
                <text x={p.x} y={p.y+4} textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff">{idx+1}</text>
              </g>
            ))}
          </svg>
        </div>
        {embeddedMap && (
          <div style={{position:"relative",minHeight:310,border:"1px solid var(--border)",borderRadius:8,overflow:"hidden",background:"var(--bg3)"}}>
            {embeddedMap.tiles.map(tile => (
              <img key={tile.key} src={tile.url} alt="" draggable="false" style={{position:"absolute",left:tile.left,top:tile.top,width:256,height:256,userSelect:"none",pointerEvents:"none"}} />
            ))}
            <svg viewBox={`0 0 ${w} ${h}`} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
              <path d={embeddedPath} fill="none" stroke="rgba(15,118,110,.22)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"/>
              <path d={embeddedPath} fill="none" stroke="#0f766e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
              {embeddedMap.projected.map((p, idx) => (
                <g key={idx}>
                  <circle cx={p.x} cy={p.y} r="13" fill={idx===0?"#0f766e":idx===embeddedMap.projected.length-1?"#f97316":"#3b82f6"} stroke="#fff" strokeWidth="2"/>
                  <text x={p.x} y={p.y+4} textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff">{idx+1}</text>
                </g>
              ))}
            </svg>
            <div style={{position:"absolute",right:8,bottom:8,background:"rgba(255,255,255,.86)",border:"1px solid rgba(148,163,184,.5)",borderRadius:6,padding:"3px 6px",fontSize:10,color:"#334155"}}>
              Carto / OpenStreetMap
            </div>
          </div>
        )}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
        {stops.map((s, idx)=>(
          <div key={`${s.address}-${idx}`} style={{display:"flex",alignItems:"center",gap:6,border:"1px solid var(--border)",borderRadius:7,padding:"5px 8px",fontSize:11,color:"var(--text4)",background:"var(--bg4)",maxWidth:260}}>
            <span style={{width:18,height:18,borderRadius:5,background:idx===0?"#0f766e":idx===stops.length-1?"#f97316":"#3b82f6",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:"#fff",flexShrink:0}}>{idx+1}</span>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.address}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GestionTrafico({ initialVista = "cuadrante", soloOptimizacion = false, hideInternalTabs = false }) {
  const { puedeEditar, user } = useAuth();
  const esModoChoferOptimizacion = soloOptimizacion || user?.rol === "chofer";

  const [focusPedido, setFocusPedido] = useState(() => readTraficoFocus());
  const [focusContext, setFocusContext] = useState(() => readTraficoFocus());
  const [anchor,    setAnchor]    = useState(new Date());
  const [pedidos,   setPedidos]   = useState([]);
  const [pedidosGrupajeActivos, setPedidosGrupajeActivos] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [choferes,  setChoferes]  = useState([]);
  const [rutas, setRutas] = useState([]);
  const [incidenciasViaje, setIncidenciasViaje] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editViaje, setEditViaje] = useState(null);
  const [addTripCell, setAddTripCell] = useState(null);
  const [addTripExistingId, setAddTripExistingId] = useState("");
  const [addTripSaving, setAddTripSaving] = useState(false);
  const [dragOver,  setDragOver]  = useState(null); // {vehiculo_id, fecha}
  const [manualTripOrder, setManualTripOrder] = useState(() => loadTraficoTripOrder());
  const [quickUpdatingId, setQuickUpdatingId] = useState("");
  const [quickAssigningId, setQuickAssigningId] = useState("");
  const [copyingPedidoId, setCopyingPedidoId] = useState("");
  const [reschedulingPedidoId, setReschedulingPedidoId] = useState("");
  const [bulkCopying, setBulkCopying] = useState(false);
  const [selectedCriticalIds, setSelectedCriticalIds] = useState([]);
  const [bulkCriticalAssigning, setBulkCriticalAssigning] = useState(false);
  const [bulkCriticalAdvancing, setBulkCriticalAdvancing] = useState(false);
  const [bulkCriticalRescheduling, setBulkCriticalRescheduling] = useState(false);
  const [bulkCriticalClearing, setBulkCriticalClearing] = useState(false);
  const [criticalPanelOpen, setCriticalPanelOpen] = useState(false);
  const [readCriticalAlerts, setReadCriticalAlerts] = useState(() => loadReadCriticalAlerts());
  const [filtroEst, setFiltroEst] = useState("todos");
  const [soloCompletar, setSoloCompletar] = useState(false);
  const [soloCriticos, setSoloCriticos] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [searchTrafico, setSearchTrafico] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [soloSinAsignar, setSoloSinAsignar] = useState(false);
  const [soloColaboradores, setSoloColaboradores] = useState(false);
  const [soloKmVacio, setSoloKmVacio] = useState(false);
  const [soloSinKmRuta, setSoloSinKmRuta] = useState(false);
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);
  const [soloMargenNegativo, setSoloMargenNegativo] = useState(false);
  const [filtroTipoViaje, setFiltroTipoViaje] = useState("todos");
  const [agruparPorCliente, setAgruparPorCliente] = useState(false);
  const [resumenSemanaVisible, setResumenSemanaVisible] = useState(true);
  const [collapsedClienteGroups, setCollapsedClienteGroups] = useState({});
  const [vistaMain, setVistaMain] = useState(esModoChoferOptimizacion ? "optimizacion" : initialVista);
  const autoAnchorAppliedRef = useRef(false);

  const dias = getWeekDays(anchor);
  const today = new Date().toISOString().slice(0,10);
  const cargar = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const semana = getWeekDays(anchor);
      const desde = semana[0].toISOString().slice(0,10);
      const hasta = semana[6].toISOString().slice(0,10);
      const desdeCarga = addDaysLocal(semana[0], -45).toISOString().slice(0,10);
      const hastaCarga = addDaysLocal(semana[6], 75).toISOString().slice(0,10);
      const [p, pg, v, c, r, cfgEmpresa, notifs] = await Promise.all([
        getPedidosResumenLista({ desde: desdeCarga, hasta: hastaCarga, limit: 1000 }, { timeoutMs: 45000, silentError: true }),
        getPedidosResumenLista({
          tipo_carga: "grupaje",
          estado: "pendiente,confirmado,espera_carga,cargando,en_curso,espera_descarga,descarga,incidencia",
          facturado: "false",
          limit: 1000,
        }, { timeoutMs: 45000, silentError: true }),
        getVehiculos().catch(() => []),
        getChoferes().catch(() => []),
        getRutas().catch(() => []),
        getEmpresaConfig().catch(() => ({})),
        getNotificaciones(80).catch(() => ({ data: [] })),
      ]);
      const pedidosData = Array.isArray(p?.data) ? p.data : Array.isArray(p) ? p : [];
      setPedidos(pedidosData);
      const hasCurrentWeek = pedidosData.some(item => {
        if (String(item?.estado || "").toLowerCase() === "cancelado") return false;
        const fecha = dateOnly(item?.fecha_carga) || dateOnly(item?.fecha_pedido);
        return fecha >= desde && fecha <= hasta;
      });
      if (!autoAnchorAppliedRef.current && !hasCurrentWeek && pedidosData.length) {
        const nearest = nearestActivePedidoDate(pedidosData, anchor);
        if (nearest && (nearest < desde || nearest > hasta)) {
          autoAnchorAppliedRef.current = true;
          setAnchor(new Date(`${nearest}T12:00:00`));
        }
      }
      setPedidosGrupajeActivos(Array.isArray(pg?.data) ? pg.data : Array.isArray(pg) ? pg : []);
      const cfg = cfgEmpresa?.cfg_trafico && typeof cfgEmpresa.cfg_trafico === "object" ? cfgEmpresa.cfg_trafico : {};
      try { window.__TMS_CFG_TRAFICO = cfg; } catch {}
      setVehiculos(Array.isArray(v) ? v : []);
      setChoferes(Array.isArray(c) ? c : []);
      setRutas(Array.isArray(r) ? r : []);
      const avisos = Array.isArray(notifs?.data) ? notifs.data : [];
      setIncidenciasViaje(avisos.filter(n =>
        !n?.leida &&
        ["chofer_paralizacion", "chofer_descanso_incorrecto", "chofer_descanso_excedido", "chofer_pausa_obligatoria"].includes(String(n?.tipo || ""))
      ));
    } catch (e) {
      console.error(e);
      setLoadError(e.message || "No se pudieron cargar los viajes de trafico.");
      setPedidos([]);
      setPedidosGrupajeActivos([]);
    } finally { setLoading(false); }
  }, [anchor]);

  const pedidosGrupaje = useMemo(() => pedidosGrupajeActivos.filter(p =>
    p.tipo_carga === "grupaje" && !["cancelado","entregado","facturado"].includes(p.estado)
  ), [pedidosGrupajeActivos]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const sync = () => { cargar(); };
    window.addEventListener("tms:facturas-changed", sync);
    window.addEventListener("tms:pedidos-changed", sync);
    return () => {
      window.removeEventListener("tms:facturas-changed", sync);
      window.removeEventListener("tms:pedidos-changed", sync);
    };
  }, [cargar]);

  useEffect(() => {
    if (esModoChoferOptimizacion && vistaMain !== "optimizacion") {
      setVistaMain("optimizacion");
    }
  }, [esModoChoferOptimizacion, vistaMain]);

  useEffect(() => {
    if (!esModoChoferOptimizacion) setVistaMain(initialVista || "cuadrante");
  }, [initialVista, esModoChoferOptimizacion]);

  // â”€â”€ Semana label â”€â”€
  useEffect(() => {
    if (!focusPedido?.pedido_id) return;
    if (vistaMain !== "cuadrante") {
      setVistaMain("cuadrante");
      return;
    }
    const focusDate = focusPedido?.fecha_carga ? new Date(`${focusPedido.fecha_carga}T12:00:00`) : null;
    if (focusDate && !Number.isNaN(focusDate.getTime())) {
      const semanaActual = getWeekDays(anchor);
      const inicio = semanaActual[0].toISOString().slice(0, 10);
      const fin = semanaActual[6].toISOString().slice(0, 10);
      const targetDate = focusPedido.fecha_carga;
      if (targetDate < inicio || targetDate > fin) {
        setAnchor(focusDate);
        return;
      }
    }
    if (loading) return;
    const found = pedidos.find(p => String(p.id) === String(focusPedido.pedido_id));
    if (!found) {
      let cancelled = false;
      const t = window.setTimeout(async () => {
        try {
          const fetched = await getPedido(focusPedido.pedido_id);
          if (cancelled || !fetched?.id) return;
          setPedidos(prev => prev.some(p => String(p.id) === String(fetched.id)) ? prev : [fetched, ...prev]);
          setFocusContext(focusPedido);
          await abrirViaje(fetched);
          clearRuntimeFocus("tms_trafico_focus");
          setFocusPedido(null);
        } catch {}
      }, 180);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }
    const t = window.setTimeout(() => {
      setFocusContext(focusPedido);
      abrirViaje(found).catch(() => {});
      clearRuntimeFocus("tms_trafico_focus");
      setFocusPedido(null);
    }, 180);
    return () => window.clearTimeout(t);
  }, [focusPedido, vistaMain, anchor, loading, pedidos]);

  const fmt = d => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  const weekLabel = `Semana ${fmt(dias[0])} - ${fmt(dias[6])} ${dias[6].getFullYear()}`;

  // â”€â”€ Get trips for a vehicle on a specific day â”€â”€
  // Pre-computed map: vehiculo_id -> pedidos[] for O(1) lookup in cuadrante
  const pedidosPorVehiculo = useMemo(() => {
    const map = {};
    pedidos.forEach(p => {
      if (!p.vehiculo_id) return;
      if (!map[p.vehiculo_id]) map[p.vehiculo_id] = [];
      map[p.vehiculo_id].push(p);
    });
    return map;
  }, [pedidos]);

  function getTrips(vehiculo_id, dia) {
    const dStr = dia.toISOString().slice(0,10);
    // Use pre-computed map for O(1) vehicle lookup instead of full array scan
    const baseTrips = sortTripsByOperationalPriority((pedidosPorVehiculo[vehiculo_id] || []).filter(p => {
      if (!pasaFiltrosOperativos(p)) return false;
      const fecha = p.fecha_carga?.slice(0,10) || p.fecha_pedido?.slice(0,10) || "";
      return fecha === dStr;
    }));
    const order = manualTripOrder[trafficOrderKey(vehiculo_id, dStr)];
    if (!Array.isArray(order) || !order.length) return baseTrips;
    const position = new Map(order.map((id, idx) => [String(id), idx]));
    return [...baseTrips].sort((a, b) => {
      const ai = position.has(String(a.id)) ? position.get(String(a.id)) : 9999;
      const bi = position.has(String(b.id)) ? position.get(String(b.id)) : 9999;
      if (ai !== bi) return ai - bi;
      return baseTrips.indexOf(a) - baseTrips.indexOf(b);
    });
  }

  const semanaInicio = dias[0].toISOString().slice(0,10);
  const semanaFin = dias[6].toISOString().slice(0,10);
  const fechaPedido = p => p.fecha_carga?.slice(0,10) || p.fecha_pedido?.slice(0,10) || "";
  const pedidosSemana = useMemo(() => pedidos.filter(p => {
    if (String(p?.estado || "").toLowerCase() === "cancelado") return false;
    const f = fechaPedido(p);
    return f >= semanaInicio && f <= semanaFin;
  }), [pedidos, semanaInicio, semanaFin]);
  const clienteOptionsSemana = useMemo(() => {
    const grouped = pedidosSemana.reduce((acc, p) => {
      const key = getPedidoClienteKey(p);
      if (!acc[key]) acc[key] = { key, label: getPedidoClienteLabel(p), count: 0 };
      acc[key].count += 1;
      return acc;
    }, {});
    return Object.values(grouped).sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [pedidosSemana]);
  const urgentesSinAsignarSemana = useMemo(
    () => pedidosSemana.filter(p => getPedidoOperationalFlags(p).urgentAssignment || getPedidoOperationalFlags(p).overdueAssignment).length,
    [pedidosSemana]
  );
  const pedidosCriticosSemana = useMemo(() => {
    const now = new Date();
    return sortTripsByOperationalPriority(
      pedidosSemana.filter(p => {
        if (["cancelado", "entregado", "facturado"].includes(String(p.estado || "").toLowerCase())) return false;
        const flags = getPedidoOperationalFlags(p, now);
        return flags.urgentAssignment || flags.overdueAssignment;
      })
    ).slice(0, 6);
  }, [pedidosSemana]);
  const conflictosOperativosSemana = useMemo(
    () => buildOperationalConflictMap(pedidosSemana, vehiculos, choferes),
    [pedidosSemana, vehiculos, choferes]
  );
  const esPedidoCritico = useCallback((p) => {
    const flags = getPedidoOperationalFlags(p);
    return flags.urgentAssignment || flags.overdueAssignment || Boolean(conflictosOperativosSemana[p?.id]);
  }, [conflictosOperativosSemana]);
  const pasaFiltroEstado = useCallback((p) =>
    (filtroEst === "todos" || p.estado === filtroEst) &&
    (!soloCompletar || p.pendiente_completar) &&
    (!soloCriticos || esPedidoCritico(p)),
  [filtroEst, soloCompletar, soloCriticos, esPedidoCritico]);
  const pasaFiltrosOperativos = useCallback((p) => {
    if (String(p?.estado || "").toLowerCase() === "cancelado") return false;
    if (!pasaFiltroEstado(p)) return false;
    if (soloSinAsignar && (p.vehiculo_id || p.colaborador_id || p.colaborador_nombre)) return false;
    if (soloColaboradores && !(p.colaborador_id || p.colaborador_nombre)) return false;
    if (soloKmVacio && !Number(p.km_vacio || 0)) return false;
    if (soloSinKmRuta && Number(p.km_ruta || p.km || 0)) return false;
    if (filtroTipoViaje !== "todos" && String(p.tipo_viaje || "normal") !== filtroTipoViaje) return false;
    const finanzas = getPedidoFinancialSnapshot(p);
    if (soloSinPrecio && !finanzas.sinPrecio) return false;
    if (soloMargenNegativo && !finanzas.margenNegativo) return false;
    if (filtroCliente && getPedidoClienteKey(p) !== filtroCliente) return false;
    const needle = normalizeSearchText(searchTrafico);
    if (needle) {
      const hayTexto = [
        p.numero,
        getPedidoClienteLabel(p),
        p.colaborador_nombre,
        p.origen,
        p.destino,
        p.vehiculo_matricula,
        p.chofer_nombre,
        p.referencia_cliente,
      ].some(x => normalizeSearchText(x).includes(needle));
      if (!hayTexto) return false;
    }
    return true;
  }, [pasaFiltroEstado, soloSinAsignar, soloColaboradores, soloKmVacio, soloSinKmRuta, soloSinPrecio, soloMargenNegativo, filtroTipoViaje, filtroCliente, searchTrafico]);
  const pendientesCompletarSemana = pedidosSemana.filter(p => p.pendiente_completar).length;
  const canQuickState = puedeEditar("pedidos");
  const getQuickActionForPedido = useCallback((pedido) => {
    if (!canQuickState || pedidoTieneFacturaFinal(pedido)) return null;
    const action = QUICK_STATE_FLOW[String(pedido?.estado || "").toLowerCase()] || null;
    if (!action) return null;
    const issues = getPedidoStateValidationIssues(pedido, action.next);
    return {
      ...action,
      issues,
      disabled: issues.length > 0,
    };
  }, [canQuickState]);
  const getAssignmentAvailabilitySnapshot = useCallback((pedido) => {
    if (!pedido || pedido.colaborador_id || pedido.colaborador_nombre) return null;
    const missingVehiculo = !pedido.vehiculo_id;
    const missingChofer = !pedido.chofer_id;
    if (!missingVehiculo && !missingChofer) return null;

    const baseForm = {
      fecha_carga: toDateInputValue(pedido.fecha_carga || pedido.fecha_pedido),
      hora_carga: toTimeInputValue(pedido.hora_carga),
      fecha_descarga: toDateInputValue(pedido.fecha_descarga || pedido.fecha_entrega),
      hora_descarga: toTimeInputValue(pedido.hora_descarga),
      km_ruta: pedido.km_ruta || pedido.km || 0,
      km: pedido.km || pedido.km_ruta || 0,
    };

    const vehiculosLibres = [];
    const choferesLibres = [];
    const parejasLibres = [];
    const availableVehiculos = vehiculos.filter(v => isVehiculoAsignable(v, vehiculos));
    const availableChoferes = choferes.filter(c => isChoferAsignable(c));

    if (missingVehiculo && !missingChofer) {
      availableVehiculos.forEach(v => {
        const conflictos = collectAssignmentConflicts({
          pedidoActual: pedido,
          form: { ...baseForm, vehiculo_id: v.id, chofer_id: pedido.chofer_id || "" },
          pedidos,
          vehiculos,
          choferes,
        });
        if (!conflictos.some(c => c.level === "hard")) vehiculosLibres.push(v);
      });
    }

    if (!missingVehiculo && missingChofer) {
      availableChoferes.forEach(c => {
        const conflictos = collectAssignmentConflicts({
          pedidoActual: pedido,
          form: { ...baseForm, vehiculo_id: pedido.vehiculo_id || "", chofer_id: c.id },
          pedidos,
          vehiculos,
          choferes,
        });
        if (!conflictos.some(conf => conf.level === "hard")) choferesLibres.push(c);
      });
    }

    if (missingVehiculo && missingChofer) {
      availableVehiculos.forEach(v => {
        const linkedChofer = availableChoferes.find(c =>
          String(c.id || "") === String(v.chofer_id || "") ||
          String(c.vehiculo_id || "") === String(v.id)
        );
        if (!linkedChofer) return;
        const conflictos = collectAssignmentConflicts({
          pedidoActual: pedido,
          form: { ...baseForm, vehiculo_id: v.id, chofer_id: linkedChofer.id },
          pedidos,
          vehiculos,
          choferes,
        });
        if (!conflictos.some(c => c.level === "hard")) {
          parejasLibres.push({ vehiculo: v, chofer: linkedChofer });
        }
      });
    }

    return {
      vehiculosLibres: vehiculosLibres.length,
      choferesLibres: choferesLibres.length,
      parejasLibres: parejasLibres.length,
      hayHueco: vehiculosLibres.length > 0 || choferesLibres.length > 0 || parejasLibres.length > 0,
    };
  }, [pedidos, vehiculos, choferes]);
  const getSuggestedAssignment = useCallback((pedido) => {
    if (!pedido || pedido.colaborador_id || pedido.colaborador_nombre) return null;
    const missingVehiculo = !pedido.vehiculo_id;
    const missingChofer = !pedido.chofer_id;
    if (!missingVehiculo && !missingChofer) return null;

    const baseForm = {
      fecha_carga: toDateInputValue(pedido.fecha_carga || pedido.fecha_pedido),
      hora_carga: toTimeInputValue(pedido.hora_carga),
      fecha_descarga: toDateInputValue(pedido.fecha_descarga || pedido.fecha_entrega),
      hora_descarga: toTimeInputValue(pedido.hora_descarga),
      km_ruta: pedido.km_ruta || pedido.km || 0,
      km: pedido.km || pedido.km_ruta || 0,
    };

    const buildSuggestion = (veh, ch) => {
      const resolvedVehiculo = veh || null;
      const resolvedChofer = ch || null;
      if (missingVehiculo && !resolvedVehiculo) return null;
      if (missingChofer && !resolvedChofer) return null;
      return {
        vehiculo_id: missingVehiculo ? resolvedVehiculo?.id || "" : pedido.vehiculo_id,
        chofer_id: missingChofer ? resolvedChofer?.id || "" : pedido.chofer_id,
        label: [
          missingVehiculo && resolvedVehiculo ? `Vehiculo ${resolvedVehiculo.matricula}` : null,
          missingChofer && resolvedChofer ? `Chofer ${resolvedChofer.nombre || ""} ${resolvedChofer.apellidos || ""}`.trim() : null,
        ].filter(Boolean).join(" + "),
        missing: { vehiculo: missingVehiculo, chofer: missingChofer },
      };
    };

    if (!missingChofer && missingVehiculo) {
      const chofer = choferes.find(c => String(c.id) === String(pedido.chofer_id));
      const candidates = vehiculos
        .filter(v => isVehiculoAsignable(v, vehiculos))
        .map(v => {
          const conflictos = collectAssignmentConflicts({
            pedidoActual: pedido,
            form: { ...baseForm, vehiculo_id: v.id, chofer_id: pedido.chofer_id || "" },
            pedidos,
            vehiculos,
            choferes,
          });
          const linkedScore =
            String(v.chofer_id || "") === String(pedido.chofer_id || "") ||
            String(chofer?.vehiculo_id || "") === String(v.id) ? 0 : 1;
          return {
            vehiculo: v,
            chofer,
            linkedScore,
            hardConflicts: conflictos.filter(c => c.level === "hard").length,
            warningConflicts: conflictos.filter(c => c.level !== "hard").length,
          };
        })
        .filter(c => c.hardConflicts === 0)
        .sort((a, b) =>
          a.linkedScore - b.linkedScore ||
          a.warningConflicts - b.warningConflicts ||
          String(a.vehiculo?.matricula || "").localeCompare(String(b.vehiculo?.matricula || ""))
        );

      return candidates[0] ? buildSuggestion(candidates[0].vehiculo, candidates[0].chofer) : null;
    }

    if (!missingVehiculo && missingChofer) {
      const vehiculo = vehiculos.find(v => String(v.id) === String(pedido.vehiculo_id));
      const candidates = choferes
        .filter(c => isChoferAsignable(c))
        .map(c => {
          const conflictos = collectAssignmentConflicts({
            pedidoActual: pedido,
            form: { ...baseForm, vehiculo_id: pedido.vehiculo_id || "", chofer_id: c.id },
            pedidos,
            vehiculos,
            choferes,
          });
          const linkedScore =
            String(c.vehiculo_id || "") === String(pedido.vehiculo_id || "") ||
            String(vehiculo?.chofer_id || "") === String(c.id) ? 0 : 1;
          return {
            vehiculo,
            chofer: c,
            linkedScore,
            hardConflicts: conflictos.filter(conf => conf.level === "hard").length,
            warningConflicts: conflictos.filter(conf => conf.level !== "hard").length,
          };
        })
        .filter(c => c.hardConflicts === 0)
        .sort((a, b) =>
          a.linkedScore - b.linkedScore ||
          a.warningConflicts - b.warningConflicts ||
          `${a.chofer?.nombre || ""} ${a.chofer?.apellidos || ""}`.localeCompare(`${b.chofer?.nombre || ""} ${b.chofer?.apellidos || ""}`)
        );

      return candidates[0] ? buildSuggestion(candidates[0].vehiculo, candidates[0].chofer) : null;
    }

    if (missingVehiculo && missingChofer) {
      const seen = new Set();
      const candidates = [];

      vehiculos
        .filter(v => isVehiculoAsignable(v, vehiculos))
        .forEach(v => {
        const linkedChofer = choferes.find(c =>
          String(c.id || "") === String(v.chofer_id || "") ||
          String(c.vehiculo_id || "") === String(v.id)
        );
        if (!isChoferAsignable(linkedChofer)) return;

        const key = `${v.id}-${linkedChofer.id}`;
        if (seen.has(key)) return;
        seen.add(key);

        const conflictos = collectAssignmentConflicts({
          pedidoActual: pedido,
          form: { ...baseForm, vehiculo_id: v.id, chofer_id: linkedChofer.id },
          pedidos,
          vehiculos,
          choferes,
        });

        const hardConflicts = conflictos.filter(c => c.level === "hard").length;
        const warningConflicts = conflictos.filter(c => c.level !== "hard").length;
        candidates.push({
          vehiculo: v,
          chofer: linkedChofer,
          hardConflicts,
          warningConflicts,
        });
      });

      candidates.sort((a, b) =>
        a.hardConflicts - b.hardConflicts ||
        a.warningConflicts - b.warningConflicts ||
          String(a.vehiculo?.matricula || "").localeCompare(String(b.vehiculo?.matricula || ""))
      );

      const best = candidates.find(c => c.hardConflicts === 0);
      if (!best) return null;
      return buildSuggestion(best.vehiculo, best.chofer);
    }

    return null;
  }, [vehiculos, choferes, pedidos]);
  const getFallbackAssignmentSuggestion = useCallback((pedido) => {
    if (!pedido || pedido.colaborador_id || pedido.colaborador_nombre) return null;
    const missingVehiculo = !pedido.vehiculo_id;
    const missingChofer = !pedido.chofer_id;
    if (!missingVehiculo && !missingChofer) return null;

    const baseForm = {
      fecha_carga: toDateInputValue(pedido.fecha_carga || pedido.fecha_pedido),
      hora_carga: toTimeInputValue(pedido.hora_carga),
      fecha_descarga: toDateInputValue(pedido.fecha_descarga || pedido.fecha_entrega),
      hora_descarga: toTimeInputValue(pedido.hora_descarga),
      km_ruta: pedido.km_ruta || pedido.km || 0,
      km: pedido.km || pedido.km_ruta || 0,
    };

    const buildFallback = (veh, ch, conflictos = []) => {
      if (missingVehiculo && !veh) return null;
      if (missingChofer && !ch) return null;
      const hardConflicts = conflictos.filter(c => c.level === "hard");
      const warningConflicts = conflictos.filter(c => c.level !== "hard");
      return {
        vehiculo_id: missingVehiculo ? veh?.id || "" : pedido.vehiculo_id,
        chofer_id: missingChofer ? ch?.id || "" : pedido.chofer_id,
        label: [
          missingVehiculo && veh ? `Vehiculo ${veh.matricula}` : null,
          missingChofer && ch ? `Chofer ${ch.nombre || ""} ${ch.apellidos || ""}`.trim() : null,
        ].filter(Boolean).join(" + "),
        hardConflicts: hardConflicts.length,
        warningConflicts: warningConflicts.length,
        conflictos,
        missing: { vehiculo: missingVehiculo, chofer: missingChofer },
      };
    };

    let candidates = [];

    if (missingVehiculo && !missingChofer) {
      const chofer = choferes.find(c => String(c.id) === String(pedido.chofer_id));
      candidates = vehiculos
        .filter(v => isVehiculoAsignable(v, vehiculos))
        .map(v => {
          const conflictos = collectAssignmentConflicts({
            pedidoActual: pedido,
            form: { ...baseForm, vehiculo_id: v.id, chofer_id: pedido.chofer_id || "" },
            pedidos,
            vehiculos,
            choferes,
          });
          const linkedScore =
            String(v.chofer_id || "") === String(pedido.chofer_id || "") ||
            String(chofer?.vehiculo_id || "") === String(v.id) ? 0 : 1;
          return {
            vehiculo: v,
            chofer,
            linkedScore,
            hardConflicts: conflictos.filter(c => c.level === "hard").length,
            warningConflicts: conflictos.filter(c => c.level !== "hard").length,
            conflictos,
          };
        });
    } else if (!missingVehiculo && missingChofer) {
      const vehiculo = vehiculos.find(v => String(v.id) === String(pedido.vehiculo_id));
      candidates = choferes
        .filter(c => isChoferAsignable(c))
        .map(c => {
          const conflictos = collectAssignmentConflicts({
            pedidoActual: pedido,
            form: { ...baseForm, vehiculo_id: pedido.vehiculo_id || "", chofer_id: c.id },
            pedidos,
            vehiculos,
            choferes,
          });
          const linkedScore =
            String(c.vehiculo_id || "") === String(pedido.vehiculo_id || "") ||
            String(vehiculo?.chofer_id || "") === String(c.id) ? 0 : 1;
          return {
            vehiculo,
            chofer: c,
            linkedScore,
            hardConflicts: conflictos.filter(conf => conf.level === "hard").length,
            warningConflicts: conflictos.filter(conf => conf.level !== "hard").length,
            conflictos,
          };
        });
    } else {
      const seen = new Set();
      vehiculos
        .filter(v => isVehiculoAsignable(v, vehiculos))
        .forEach(v => {
          const linkedChofer = choferes.find(c =>
            String(c.id || "") === String(v.chofer_id || "") ||
            String(c.vehiculo_id || "") === String(v.id)
          );
          if (!isChoferAsignable(linkedChofer)) return;
          const key = `${v.id}-${linkedChofer.id}`;
          if (seen.has(key)) return;
          seen.add(key);
          const conflictos = collectAssignmentConflicts({
            pedidoActual: pedido,
            form: { ...baseForm, vehiculo_id: v.id, chofer_id: linkedChofer.id },
            pedidos,
            vehiculos,
            choferes,
          });
          candidates.push({
            vehiculo: v,
            chofer: linkedChofer,
            linkedScore: 0,
            hardConflicts: conflictos.filter(c => c.level === "hard").length,
            warningConflicts: conflictos.filter(c => c.level !== "hard").length,
            conflictos,
          });
        });
    }

    candidates.sort((a, b) =>
      a.hardConflicts - b.hardConflicts ||
      a.warningConflicts - b.warningConflicts ||
      (a.linkedScore || 0) - (b.linkedScore || 0) ||
      String(a.vehiculo?.matricula || "").localeCompare(String(b.vehiculo?.matricula || ""))
    );

    const best = candidates[0];
    return best ? buildFallback(best.vehiculo, best.chofer, best.conflictos) : null;
  }, [pedidos, vehiculos, choferes]);
  const pedidosCriticosMetaSemana = useMemo(() => {
    return pedidosCriticosSemana
      .map(pedido => {
        const flags = getPedidoOperationalFlags(pedido);
        const quick = getQuickActionForPedido(pedido);
        const suggestion = getSuggestedAssignment(pedido);
        const fallbackSuggestion = !suggestion ? getFallbackAssignmentSuggestion(pedido) : null;
        const availability = getAssignmentAvailabilitySnapshot(pedido);
        const blockingConflict = [...(fallbackSuggestion?.conflictos || conflictosOperativosSemana[pedido.id] || [])]
          .sort((a, b) => (a.level === "hard" ? 0 : 1) - (b.level === "hard" ? 0 : 1))[0] || null;
        const hardConflict = blockingConflict?.level === "hard";
        const severity =
          (flags.overdueAssignment ? 220 : flags.urgentAssignment ? 90 : 0) +
          (!availability?.hayHueco ? 180 : 0) +
          (hardConflict ? 150 : blockingConflict ? 70 : 0) +
          (quick?.disabled ? 110 : 0) +
          (fallbackSuggestion?.hardConflicts ? 85 : fallbackSuggestion?.warningConflicts ? 35 : 0) +
          (typeof flags.diffHours === "number" ? Math.max(0, 48 - Math.round(flags.diffHours)) : 0);
        const reasons = [
          !availability?.hayHueco ? { key:"sin_hueco", label:"Sin hueco", tone:"danger" } : null,
          hardConflict ? { key:"conflicto_duro", label:"Conflicto duro", tone:"danger" } : null,
          !hardConflict && blockingConflict ? { key:"revisar", label:"Revisar conflicto", tone:"warning" } : null,
          quick?.disabled ? { key:"datos", label:"Datos pendientes", tone:"warning" } : null,
          !suggestion && fallbackSuggestion ? { key:"alternativa", label:"Alternativa forzada", tone:"info" } : null,
        ].filter(Boolean);
        return {
          pedido,
          flags,
          quick,
          suggestion,
          fallbackSuggestion,
          availability,
          blockingConflict,
          severity,
          reasons,
        };
      })
      .sort((a, b) =>
        b.severity - a.severity ||
        String(a.pedido?.hora_carga || "99:99").localeCompare(String(b.pedido?.hora_carga || "99:99")) ||
        String(a.pedido?.numero || "").localeCompare(String(b.pedido?.numero || ""))
      );
  }, [
    pedidosCriticosSemana,
    conflictosOperativosSemana,
    getAssignmentAvailabilitySnapshot,
    getQuickActionForPedido,
    getSuggestedAssignment,
    getFallbackAssignmentSuggestion,
  ]);
  const pedidosCriticosMetaVisibles = useMemo(
    () => pedidosCriticosMetaSemana.filter(item => pasaFiltrosOperativos(item.pedido)),
    [pedidosCriticosMetaSemana, pasaFiltrosOperativos]
  );
  const pedidosCriticosMetaActivos = useMemo(
    () => pedidosCriticosMetaVisibles.filter(item => !readCriticalAlerts.includes(buildCriticalAlertKey(item))),
    [pedidosCriticosMetaVisibles, readCriticalAlerts]
  );
  const selectedCriticalItems = useMemo(
    () => pedidosCriticosMetaActivos.filter(item => selectedCriticalIds.includes(String(item.pedido?.id))),
    [pedidosCriticosMetaActivos, selectedCriticalIds]
  );
  const allVisibleCriticalsSelected = pedidosCriticosMetaActivos.length > 0
    && pedidosCriticosMetaActivos.every(item => selectedCriticalIds.includes(String(item.pedido?.id)));
  const pedidosCriticosGrouped = useMemo(() => {
    if (!agruparPorCliente) return [{ key: "__all__", label: "", items: pedidosCriticosMetaActivos }];
    const groups = pedidosCriticosMetaActivos.reduce((acc, item) => {
      const key = getPedidoClienteKey(item.pedido);
      if (!acc[key]) acc[key] = { key, label: getPedidoClienteLabel(item.pedido), items: [] };
      acc[key].items.push(item);
      return acc;
    }, {});
    return Object.values(groups).sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [pedidosCriticosMetaActivos, agruparPorCliente]);

  useEffect(() => {
    setSelectedCriticalIds(prev => prev.filter(id => pedidosCriticosMetaActivos.some(item => String(item.pedido?.id) === String(id))));
  }, [pedidosCriticosMetaActivos]);

  useEffect(() => {
    try {
      localStorage.setItem(CRITICAL_ALERTS_STORAGE_KEY, JSON.stringify(readCriticalAlerts));
    } catch {}
  }, [readCriticalAlerts]);

  function toggleCriticalSelected(pedidoId) {
    setSelectedCriticalIds(prev => prev.includes(String(pedidoId))
      ? prev.filter(id => id !== String(pedidoId))
      : [...prev, String(pedidoId)]);
  }

  function toggleSelectAllCriticals() {
    if (allVisibleCriticalsSelected) {
      setSelectedCriticalIds([]);
      return;
    }
    setSelectedCriticalIds(pedidosCriticosMetaActivos.map(item => String(item.pedido?.id)));
  }

  async function marcarIncidenciaViajeLeida(id) {
    try {
      await marcarNotificacionLeida(id);
      setIncidenciasViaje(prev => prev.filter(n => String(n.id) !== String(id)));
      window.dispatchEvent(new CustomEvent("tms:notificaciones-refresh"));
    } catch (e) {
      notify(e.message || "No se pudo marcar la incidencia como leida", "error");
    }
  }

  async function marcarAvisoLeido(item) {
    const key = buildCriticalAlertKey(item);
    if (!key || readCriticalAlerts.includes(key)) return;
    const ok = await confirmDialog({
      title: "Marcar aviso como leido",
      message: `Se ocultara el aviso de ${item?.pedido?.numero || "este pedido"} hasta que cambie su situacion operativa.`,
      confirmText: "Marcar leido",
    });
    if (!ok) return;
    setReadCriticalAlerts(prev => [...prev, key]);
    setSelectedCriticalIds(prev => prev.filter(id => String(id) !== String(item?.pedido?.id)));
  }

  async function marcarAvisosVisiblesLeidos() {
    if (!pedidosCriticosMetaActivos.length) return;
    const ok = await confirmDialog({
      title: "Marcar avisos visibles como leidos",
      message: `Se ocultaran ${pedidosCriticosMetaActivos.length} aviso(s) visibles hasta que cambie su situacion operativa.`,
      confirmText: "Marcar visibles",
    });
    if (!ok) return;
    setReadCriticalAlerts(prev => {
      const next = new Set(prev);
      pedidosCriticosMetaActivos.forEach(item => {
        const key = buildCriticalAlertKey(item);
        if (key) next.add(key);
      });
      return [...next];
    });
    setSelectedCriticalIds([]);
  }

  async function abrirViaje(pedido) {
    let pedidoCompleto = pedido;
    if (pedido?.id) {
      try {
        const fetched = await getPedido(pedido.id);
        if (fetched?.id) pedidoCompleto = fetched;
      } catch (e) {
        notify("No se pudo recargar el viaje completo. Se abre la version disponible.", "warning");
      }
    }
    setEditViaje({
      ...pedidoCompleto,
      ...(pedidoTieneFacturaFinal(pedidoCompleto) ? { _readonly: true } : {}),
    });
  }

  function syncPedidoLocal(pedidoId, patch = {}) {
    setPedidos(prev => prev.map(p => String(p.id) === String(pedidoId) ? { ...p, ...patch } : p));
    setEditViaje(prev => prev && String(prev.id) === String(pedidoId) ? { ...prev, ...patch } : prev);
  }

  async function abrirPedidoBloqueante(conflicto) {
    if (!conflicto?.pedidoId) return;
    const local = pedidos.find(p => String(p.id) === String(conflicto.pedidoId));
    if (local) {
      await abrirViaje(local);
      return;
    }
    try {
      const fetched = await getPedido(conflicto.pedidoId);
      if (fetched?.id) {
        await abrirViaje(fetched);
        return;
      }
    } catch (_) {}
    notify("No se pudo abrir el viaje que bloquea el recurso.", "warning");
  }

  async function aplicarEstadoRapido(pedido, nextEstado) {
    if (!pedido?.id || !nextEstado || pedidoTieneFacturaFinal(pedido)) return;
    const validationIssues = getPedidoStateValidationIssues(pedido, nextEstado);
    if (validationIssues.length) {
      notify(`No se puede pasar a ${EC[nextEstado]?.label || nextEstado}: ${validationIssues[0]}.`, "warning");
      return;
    }
    setQuickUpdatingId(String(pedido.id));
    try {
      await cambiarEstadoPedido(pedido.id, nextEstado);
      syncPedidoLocal(pedido.id, { estado: nextEstado });
      broadcastPedidosChanged({ pedido_id: pedido.id, estado: nextEstado, source: "gestion-trafico-quick-state" });
      notify(`Pedido ${pedido.numero || ""} actualizado a ${EC[nextEstado]?.label || nextEstado}.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudo actualizar el estado.", "error");
    } finally {
      setQuickUpdatingId("");
    }
  }

  async function aplicarAsignacionSugerida(pedido, providedSuggestion = null) {
    const suggestion = providedSuggestion || getSuggestedAssignment(pedido);
    if (!pedido?.id || !suggestion) return;
    if (suggestion.hardConflicts > 0 || suggestion.warningConflicts > 0) {
      const resumen = (suggestion.conflictos || []).slice(0, 4).map(c => `- ${c.recurso}: ${c.resumen}`).join("\n");
      const seguir = await confirmDialog({
        title: suggestion.hardConflicts > 0 ? "Asignacion con conflicto" : "Asignacion con advertencia",
        message: `La mejor alternativa disponible para ${pedido.numero || "este pedido"} sigue teniendo conflictos operativos.\n\n${resumen}${(suggestion.conflictos || []).length > 4 ? `\nY ${(suggestion.conflictos || []).length - 4} mas.` : ""}\n\nSi continuas, se aplicara igualmente para que trafico lo resuelva despues.`,
        confirmText: "Aplicar igualmente",
        tone: suggestion.hardConflicts > 0 ? "danger" : "warning",
      });
      if (!seguir) return;
    }
    setQuickAssigningId(String(pedido.id));
    try {
      await editarPedido(pedido.id, {
        vehiculo_id: suggestion.vehiculo_id || pedido.vehiculo_id || "",
        chofer_id: suggestion.chofer_id || pedido.chofer_id || "",
      });
      syncPedidoLocal(pedido.id, {
        vehiculo_id: suggestion.vehiculo_id || pedido.vehiculo_id || "",
        chofer_id: suggestion.chofer_id || pedido.chofer_id || "",
      });
      broadcastPedidosChanged({ pedido_id: pedido.id, source: "gestion-trafico-quick-assignment" });
      notify(`Asignacion sugerida aplicada en ${pedido.numero || "pedido"}${suggestion.label ? `: ${suggestion.label}.` : "."}`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudo aplicar la asignacion sugerida.", "error");
    } finally {
      setQuickAssigningId("");
    }
  }

  async function copiarPedido(pedido, opts = {}) {
    if (!pedido?.id || pedidoTieneFacturaFinal(pedido)) return;
    const keepAssignment = opts.keepAssignment !== false;
    setCopyingPedidoId(String(pedido.id));
    try {
      const fresh = await getPedido(pedido.id).catch(() => pedido);
      const payload = buildPedidoCopyPayload(fresh || pedido, { offsetDays: 0, keepAssignment });
      await crearPedido(payload);
      broadcastPedidosChanged({ source: "gestion-trafico-copy", pedido_id: pedido.id });
      notify(`Copia creada de ${pedido.numero || "este viaje"}.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudo copiar el viaje.", "error");
    } finally {
      setCopyingPedidoId("");
    }
  }

  async function reprogramarPedidoDias(pedido, offsetDays = 1) {
    if (!pedido?.id || pedidoTieneFacturaFinal(pedido)) return;
    const texto = offsetDays > 0 ? `+${offsetDays} dia${offsetDays !== 1 ? "s" : ""}` : `${offsetDays} dia${Math.abs(offsetDays) !== 1 ? "s" : ""}`;
    const ok = await confirmDialog({
      title: "Reprogramar viaje",
      message: `Se moveran las fechas operativas de ${pedido.numero || "este viaje"} ${texto} manteniendo la separacion entre carga y descarga.\n\nEl pedido quedara marcado para revisar horarios y compromiso con el cliente.`,
      confirmText: "Reprogramar",
      tone: "warning",
    });
    if (!ok) return;
    setReschedulingPedidoId(String(pedido.id));
    try {
      const fresh = await getPedido(pedido.id).catch(() => pedido);
      const payload = buildPedidoReschedulePayload(fresh || pedido, offsetDays);
      await editarPedido(pedido.id, payload);
      broadcastPedidosChanged({ source: "gestion-trafico-reschedule", pedido_id: pedido.id });
      notify(`${pedido.numero || "Pedido"} reprogramado ${texto}.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudo reprogramar el viaje.", "error");
    } finally {
      setReschedulingPedidoId("");
    }
  }

  function pedirDiasRetraso(etiqueta = "este viaje", defaultDays = 1) {
    const raw = typeof window !== "undefined"
      ? window.prompt(`Cuantos dias quieres retrasar ${etiqueta}?`, String(defaultDays))
      : String(defaultDays);
    if (raw === null) return null;
    const days = parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(days) || days <= 0) {
      notify("Indica un numero de dias valido.", "warning");
      return null;
    }
    return days;
  }

  async function solicitarRetrasoPedido(pedido) {
    const days = pedirDiasRetraso(pedido?.numero ? `el viaje ${pedido.numero}` : "este viaje", 1);
    if (!days) return;
    await reprogramarPedidoDias(pedido, days);
  }

  async function solicitarRetrasoSeleccionados() {
    const total = selectedCriticalItems
      .map(item => item.pedido)
      .filter(p => p?.id && !pedidoTieneFacturaFinal(p))
      .length;
    if (!total) {
      notify("Selecciona pedidos criticos editables para retrasarlos.", "info");
      return;
    }
    const days = pedirDiasRetraso(`${total} pedido(s) seleccionado(s)`, 1);
    if (!days) return;
    await reprogramarCriticosSeleccionadosDias(days);
  }

  async function limpiarAsignacionPedido(pedido) {
    if (!pedido?.id || pedidoTieneFacturaFinal(pedido)) return;
    const ok = await confirmDialog({
      title: "Limpiar asignacion",
      message: `Se quitara la asignacion operativa de ${pedido.numero || "este viaje"} para volver a planificarlo.\n\nSe eliminaran vehiculo, chofer y remolque, pero el resto del viaje seguira intacto.`,
      confirmText: "Limpiar asignacion",
      tone: "warning",
    });
    if (!ok) return;
    setQuickAssigningId(String(pedido.id));
    try {
      await editarPedido(pedido.id, {
        vehiculo_id: "",
        chofer_id: "",
        remolque_id: "",
        pendiente_completar: true,
        aviso_completar: "Asignacion limpiada desde trafico: volver a planificar recurso y horario operativo.",
      });
      syncPedidoLocal(pedido.id, {
        vehiculo_id: "",
        chofer_id: "",
        remolque_id: "",
        pendiente_completar: true,
        aviso_completar: "Asignacion limpiada desde trafico: volver a planificar recurso y horario operativo.",
      });
      broadcastPedidosChanged({ source: "gestion-trafico-clear-assignment", pedido_id: pedido.id });
      notify(`Asignacion limpiada en ${pedido.numero || "el viaje"}.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudo limpiar la asignacion.", "error");
    } finally {
      setQuickAssigningId("");
    }
  }

  async function copiarCriticosSemanaSiguiente() {
    const lista = pedidosCriticosMetaVisibles
      .map(item => item.pedido)
      .filter(p => p?.id && !pedidoTieneFacturaFinal(p));
    if (!lista.length) {
      notify("No hay pedidos criticos disponibles para copiar.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Copiar pedidos criticos",
      message: `Se copiaran ${lista.length} pedido(s) criticos manteniendo, si existe, la asignacion actual.\n\nLas copias quedaran como pendientes para revisarlas antes de cerrar.`,
      confirmText: "Copiar",
    });
    if (!ok) return;
    setBulkCopying(true);
    try {
      for (const pedido of lista) {
        const fresh = await getPedido(pedido.id).catch(() => pedido);
        const payload = buildPedidoCopyPayload(fresh || pedido, { offsetDays: 0, keepAssignment: true });
        await crearPedido(payload);
      }
      broadcastPedidosChanged({ source: "gestion-trafico-copy-critical-batch" });
      notify(`Se han copiado ${lista.length} pedido(s) criticos.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudieron copiar los pedidos criticos.", "error");
    } finally {
      setBulkCopying(false);
    }
  }

  async function copiarCriticosSeleccionadosSemanaSiguiente() {
    const lista = selectedCriticalItems
      .map(item => item.pedido)
      .filter(p => p?.id && !pedidoTieneFacturaFinal(p));
    if (!lista.length) {
      notify("Selecciona pedidos criticos editables para copiarlos.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Copiar criticos seleccionados",
      message: `Se copiaran ${lista.length} pedido(s) criticos seleccionados manteniendo, si existe, la asignacion actual.`,
      confirmText: "Copiar seleccionados",
    });
    if (!ok) return;
    setBulkCopying(true);
    try {
      for (const pedido of lista) {
        const fresh = await getPedido(pedido.id).catch(() => pedido);
        const payload = buildPedidoCopyPayload(fresh || pedido, { offsetDays: 0, keepAssignment: true });
        await crearPedido(payload);
      }
      setSelectedCriticalIds([]);
      broadcastPedidosChanged({ source: "gestion-trafico-copy-selected-criticals" });
      notify(`Se han copiado ${lista.length} pedido(s) criticos seleccionados.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudieron copiar los criticos seleccionados.", "error");
    } finally {
      setBulkCopying(false);
    }
  }

  async function reprogramarCriticosSeleccionadosDias(offsetDays = 1) {
    const lista = selectedCriticalItems
      .map(item => item.pedido)
      .filter(p => p?.id && !pedidoTieneFacturaFinal(p));
    if (!lista.length) {
      notify("Selecciona pedidos criticos editables para reprogramarlos.", "info");
      return;
    }
    const texto = offsetDays > 0 ? `+${offsetDays} dia${offsetDays !== 1 ? "s" : ""}` : `${offsetDays} dia${Math.abs(offsetDays) !== 1 ? "s" : ""}`;
    const ok = await confirmDialog({
      title: "Reprogramar criticos seleccionados",
      message: `Se moveran ${lista.length} pedido(s) criticos seleccionados ${texto} manteniendo la separacion entre carga y descarga.`,
      confirmText: "Reprogramar seleccionados",
      tone: "warning",
    });
    if (!ok) return;
    setBulkCriticalRescheduling(true);
    try {
      for (const pedido of lista) {
        const fresh = await getPedido(pedido.id).catch(() => pedido);
        const payload = buildPedidoReschedulePayload(fresh || pedido, offsetDays);
        await editarPedido(pedido.id, payload);
      }
      setSelectedCriticalIds([]);
      broadcastPedidosChanged({ source: "gestion-trafico-reschedule-selected-criticals" });
      notify(`${lista.length} pedido(s) criticos seleccionados reprogramados ${texto}.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudieron reprogramar los criticos seleccionados.", "error");
    } finally {
      setBulkCriticalRescheduling(false);
    }
  }

  async function limpiarAsignacionesSeleccionadas() {
    const lista = selectedCriticalItems
      .map(item => item.pedido)
      .filter(p => p?.id && !pedidoTieneFacturaFinal(p) && (p.vehiculo_id || p.chofer_id || p.remolque_id));
    if (!lista.length) {
      notify("No hay asignaciones seleccionadas para limpiar.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Limpiar asignaciones seleccionadas",
      message: `Se limpiara la asignacion operativa de ${lista.length} pedido(s) criticos seleccionados para volver a planificarlos sin arrastrar recursos equivocados.`,
      confirmText: "Limpiar asignaciones",
      tone: "warning",
    });
    if (!ok) return;
    setBulkCriticalClearing(true);
    try {
      for (const pedido of lista) {
        await editarPedido(pedido.id, {
          vehiculo_id: "",
          chofer_id: "",
          remolque_id: "",
          pendiente_completar: true,
          aviso_completar: "Asignacion limpiada desde trafico: volver a planificar recurso y horario operativo.",
        });
      }
      setSelectedCriticalIds([]);
      broadcastPedidosChanged({ source: "gestion-trafico-clear-selected-assignments" });
      notify(`Asignaciones limpiadas en ${lista.length} pedido(s) criticos.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudieron limpiar las asignaciones seleccionadas.", "error");
    } finally {
      setBulkCriticalClearing(false);
    }
  }

  async function aplicarSugerenciasSeleccionadas() {
    const lista = selectedCriticalItems.filter(item => item.pedido?.id && item.suggestion && !pedidoTieneFacturaFinal(item.pedido));
    if (!lista.length) {
      notify("No hay sugerencias limpias seleccionadas para aplicar.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Aplicar sugerencias seleccionadas",
      message: `Se aplicaran ${lista.length} sugerencia(s) operativas limpias sobre los pedidos criticos seleccionados.`,
      confirmText: "Aplicar sugerencias",
    });
    if (!ok) return;
    setBulkCriticalAssigning(true);
    try {
      for (const item of lista) {
        const p = item.pedido;
        const suggestion = item.suggestion;
        await editarPedido(p.id, {
          vehiculo_id: suggestion.vehiculo_id || p.vehiculo_id || "",
          chofer_id: suggestion.chofer_id || p.chofer_id || "",
        });
      }
      setSelectedCriticalIds([]);
      broadcastPedidosChanged({ source: "gestion-trafico-assign-selected-criticals" });
      notify(`Sugerencias aplicadas en ${lista.length} pedido(s) criticos.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudieron aplicar las sugerencias seleccionadas.", "error");
    } finally {
      setBulkCriticalAssigning(false);
    }
  }

  async function avanzarCriticosSeleccionados() {
    const lista = selectedCriticalItems.filter(item => item.pedido?.id && item.quick && !item.quick.disabled && !pedidoTieneFacturaFinal(item.pedido));
    if (!lista.length) {
      notify("No hay pedidos criticos seleccionados listos para avanzar.", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "Avanzar criticos seleccionados",
      message: `Se aplicara el siguiente estado rapido en ${lista.length} pedido(s) criticos seleccionados.`,
      confirmText: "Avanzar seleccionados",
    });
    if (!ok) return;
    setBulkCriticalAdvancing(true);
    try {
      for (const item of lista) {
        await cambiarEstadoPedido(item.pedido.id, item.quick.next);
      }
      setSelectedCriticalIds([]);
      broadcastPedidosChanged({ source: "gestion-trafico-advance-selected-criticals" });
      notify(`Estado rapido aplicado en ${lista.length} pedido(s) criticos.`, "success");
      cargar();
    } catch (err) {
      notify(err.message || "No se pudieron avanzar los criticos seleccionados.", "error");
    } finally {
      setBulkCriticalAdvancing(false);
    }
  }

  const tractores = useMemo(() => vehiculos.filter(v => {
    const clase = (v.clase || v.tipo || "").toLowerCase();
    const mat = (v.matricula||"").toUpperCase();
    const isRemolqueDeAlguien = vehiculos.some(t=>t.remolque_id===v.id);
    return !clase.includes("remolque") && !clase.includes("semirremolque") &&
           !clase.includes("dolly") && !isRemolqueDeAlguien &&
           !mat.startsWith("R-") && !mat.endsWith("-R");
  }), [vehiculos]);

  const viajesSinAsignacion = pedidosSemana
    .filter(p => pasaFiltrosOperativos(p) && !p.vehiculo_id && !p.colaborador_id && !p.colaborador_nombre);

  const colaboradoresSemana = useMemo(() => {
    return pedidosSemana
      .filter(p => pasaFiltrosOperativos(p) && (p.colaborador_id || p.colaborador_nombre))
      .reduce((acc, p) => {
        const id = p.colaborador_id || p.colaborador_nombre || "colaborador";
        if (!acc[id]) {
          acc[id] = {
            id,
            nombre: p.colaborador_nombre || "Colaborador asignado",
            telefono: p.colaborador_telefono || "",
            email: p.colaborador_email || "",
            viajes: [],
          };
        }
        acc[id].viajes.push(p);
        return acc;
      }, {});
  }, [pedidosSemana, pasaFiltrosOperativos]);

  const resumenOperativoSemana = useMemo(() => {
    const conflictos = Object.values(conflictosOperativosSemana || {}).flat();
    const conflictosDuros = conflictos.filter(c => c.level === "hard").length;
    const kmVacio = pedidosSemana.reduce((sum, p) => sum + Number(p.km_vacio || 0), 0);
    const rutasSinKm = pedidosSemana.filter(p =>
      !Number(p.km_ruta || p.km || 0) &&
      !["cancelado", "facturado"].includes(String(p.estado || "").toLowerCase())
    ).length;
    const colaboradores = Object.values(colaboradoresSemana || {}).reduce((sum, g) => sum + (g.viajes || []).length, 0);
    const finanzas = pedidosSemana.reduce((acc, p) => {
      const snap = getPedidoFinancialSnapshot(p);
      acc.ingreso += snap.ingreso;
      acc.costes += snap.costes;
      acc.margen += snap.margen;
      if (snap.sinPrecio) acc.sinPrecio += 1;
      if (snap.margenNegativo) acc.margenNegativo += 1;
      return acc;
    }, { ingreso: 0, costes: 0, margen: 0, sinPrecio: 0, margenNegativo: 0 });
    const sinAsignacionParcial = pedidosSemana.filter(p =>
      !p.colaborador_id &&
      !p.colaborador_nombre &&
      (!p.vehiculo_id || !p.chofer_id)
    ).length;
    return {
      total: pedidosSemana.length,
      sinAsignacion: viajesSinAsignacion.length,
      sinAsignacionParcial,
      conflictos: Object.keys(conflictosOperativosSemana || {}).length,
      conflictosDuros,
      pendientesCompletar: pendientesCompletarSemana,
      urgentesSinAsignar: urgentesSinAsignarSemana,
      kmVacio,
      rutasSinKm,
      colaboradores,
      ingreso: finanzas.ingreso,
      costes: finanzas.costes,
      margen: finanzas.margen,
      sinPrecio: finanzas.sinPrecio,
      margenNegativo: finanzas.margenNegativo,
    };
  }, [pedidosSemana, viajesSinAsignacion.length, conflictosOperativosSemana, pendientesCompletarSemana, urgentesSinAsignarSemana, colaboradoresSemana]);

  // â”€â”€ Calcular llegadas reales encadenadas para un vehiculo en un dÃ­a â”€â”€
  function calcLlegadasEncadenadas(vehiculo_id, dia) {
    const cfg = cfgTraficoLoad();
    const vel    = Number(cfg.velocidad_media || 80);
    const pausaC = Number(cfg.horas_pausa || 4.5);
    const pausaM = Number(cfg.min_pausa || 45);
    const descM  = Number(cfg.tiempo_descarga || 60);

    const trips = getTrips(vehiculo_id, dia)
      .filter(p => p.hora_carga)
      .sort((a,b) => (a.hora_carga||"").localeCompare(b.hora_carga||""));

    const resultado = {};
    let tiempoAcumuladoExtra = 0; // minutos extra por encadenamiento

    trips.forEach((p, idx) => {
      const km = Number(p.km_ruta || p.km || 0);
      if (km <= 0 || !p.hora_carga) { resultado[p.id] = null; return; }

      const [h, m] = p.hora_carga.split(":").map(Number);
      const salidaMin = h * 60 + m + tiempoAcumuladoExtra;

      const horasTransito = km / vel;
      const pausas = Math.floor(horasTransito / pausaC);
      const transitoMin = Math.round(horasTransito * 60) + pausas * pausaM + descM;

      const llegadaMin = salidaMin + transitoMin;
      const llegadaH = Math.floor(llegadaMin / 60) % 24;
      const llegadaM = llegadaMin % 60;
      const llegadaStr = String(llegadaH).padStart(2,"0") + ":" + String(llegadaM).padStart(2,"0");

      resultado[p.id] = {
        llegada: llegadaStr,
        transitoMin,
        encadenado: idx > 0,
      };

      // Para el siguiente viaje, aÃ±adir el tiempo de transito como retraso potencial
      // solo si hay un encadenamiento real (mismo vehiculo, siguiente viaje del dÃ­a)
      if (idx < trips.length - 1) {
        const siguienteHora = trips[idx + 1].hora_carga;
        if (siguienteHora) {
          const [sh, sm] = siguienteHora.split(":").map(Number);
          const siguienteMin = sh * 60 + sm;
          const llegadaReal = llegadaMin;
          if (llegadaReal > siguienteMin) {
            // El camiÃ³n llega despuÃ©s de la hora de carga del siguiente viaje
            tiempoAcumuladoExtra += (llegadaReal - siguienteMin);
          }
        }
      }
    });
    return resultado;
  }

  // â”€â”€ Count all trips per day for header â”€â”€
  function countDia(dia) {
    const dStr = dia.toISOString().slice(0,10);
    return pedidos.filter(p => {
      if (!pasaFiltrosOperativos(p)) return false;
      const f = p.fecha_carga?.slice(0,10) || p.fecha_pedido?.slice(0,10) || "";
      return f === dStr;
    }).length;
  }

  function renderTripCards(trips, scopeKey) {
    if (!agruparPorCliente) {
      return trips.map(p => (
        <TripCard
          key={p.id}
          pedido={p}
          llegada={null}
          onClick={() => abrirViaje(p)}
          conflictos={conflictosOperativosSemana[p.id] || []}
          quickAction={getQuickActionForPedido(p)}
          onQuickState={aplicarEstadoRapido}
          disableQuickState={quickUpdatingId === String(p.id)}
          onCopyNextWeek={pedidoTieneFacturaFinal(p) ? null : copiarPedido}
          disableCopy={copyingPedidoId === String(p.id)}
          onDelayRequest={pedidoTieneFacturaFinal(p) ? null : solicitarRetrasoPedido}
          disableReschedule={reschedulingPedidoId === String(p.id)}
          highlighted={String(focusContext?.pedido_id || "") === String(p.id)}
          highlightLabel={focusContext?.source === "pedidos" ? "Desde pedidos" : "En foco"}
          draggable={puedeEditar("pedidos") && !pedidoTieneFacturaFinal(p)}
          onDragStart={startTripDrag}
        />
      ));
    }
    const groups = trips.reduce((acc, p) => {
      const key = getPedidoClienteKey(p);
      if (!acc[key]) acc[key] = { key, label: getPedidoClienteLabel(p), items: [] };
      acc[key].items.push(p);
      return acc;
    }, {});
    return Object.values(groups)
      .sort((a, b) => a.label.localeCompare(b.label, "es"))
      .map(group => {
        const collapseKey = `${scopeKey}:${group.key}`;
        const collapsed = !!collapsedClienteGroups[collapseKey];
        return (
          <div key={collapseKey} style={{marginBottom:6}}>
            <button
              onClick={() => setCollapsedClienteGroups(prev => ({ ...prev, [collapseKey]: !prev[collapseKey] }))}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"5px 8px",borderRadius:7,border:"1px solid var(--border2)",background:"rgba(16,185,129,.08)",color:"var(--text)",cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:"'DM Sans',sans-serif"}}
            >
              <span style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{color:"var(--green)"}}>{collapsed ? "+" : "-"}</span>
                <span>{group.label}</span>
              </span>
              <span style={{fontSize:10,color:"var(--text5)"}}>{group.items.length} viaje{group.items.length !== 1 ? "s" : ""}</span>
            </button>
            {!collapsed && (
              <div style={{marginTop:6}}>
                {group.items.map(p => (
                  <TripCard
                    key={p.id}
                    pedido={p}
                    llegada={null}
                    onClick={() => abrirViaje(p)}
                    conflictos={conflictosOperativosSemana[p.id] || []}
                    quickAction={getQuickActionForPedido(p)}
                    onQuickState={aplicarEstadoRapido}
                    disableQuickState={quickUpdatingId === String(p.id)}
                    onCopyNextWeek={pedidoTieneFacturaFinal(p) ? null : copiarPedido}
                    disableCopy={copyingPedidoId === String(p.id)}
                    onDelayRequest={pedidoTieneFacturaFinal(p) ? null : solicitarRetrasoPedido}
                    disableReschedule={reschedulingPedidoId === String(p.id)}
                    highlighted={String(focusContext?.pedido_id || "") === String(p.id)}
                    highlightLabel={focusContext?.source === "pedidos" ? "Desde pedidos" : "En foco"}
                    draggable={puedeEditar("pedidos") && !pedidoTieneFacturaFinal(p)}
                    onDragStart={startTripDrag}
                  />
                ))}
              </div>
            )}
          </div>
        );
      });
  }

  // â”€â”€ Drag & drop â”€â”€
  function startTripDrag(e, pedido) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("pedido_id", String(pedido?.id || ""));
    e.dataTransfer.setData("from_vehiculo_id", String(pedido?.vehiculo_id || ""));
    e.dataTransfer.setData("from_fecha", fechaPedido(pedido));
  }

  function setCellTripOrder(vehiculo_id, fecha, orderedIds) {
    const key = trafficOrderKey(vehiculo_id, fecha);
    setManualTripOrder(prev => {
      const next = { ...(prev || {}), [key]: orderedIds.map(String) };
      saveTraficoTripOrder(next);
      return next;
    });
  }

  async function persistCellTripOrder(vehiculo_id, fecha, orderedIds) {
    try {
      await guardarPlanDiarioOrden({
        fecha,
        vehiculo_id,
        pedido_orden: orderedIds.map((id, idx) => ({ pedido_id: id, orden: idx + 1 })),
      });
    } catch {}
  }

  async function reorderTripInCell(e, vehiculo_id, dia, targetPedido) {
    const pedido_id = e.dataTransfer.getData("pedido_id");
    const fecha = dia.toISOString().slice(0,10);
    if (!pedido_id || !targetPedido?.id || String(pedido_id) === String(targetPedido.id)) return;
    const fromVehiculo = e.dataTransfer.getData("from_vehiculo_id");
    const fromFecha = e.dataTransfer.getData("from_fecha");
    if (String(fromVehiculo || "") !== String(vehiculo_id || "") || String(fromFecha || "") !== String(fecha || "")) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const current = getTrips(vehiculo_id, dia).map(p => String(p.id));
    const withoutDragged = current.filter(id => id !== String(pedido_id));
    const targetIndex = withoutDragged.indexOf(String(targetPedido.id));
    const nextOrder = [...withoutDragged];
    nextOrder.splice(targetIndex >= 0 ? targetIndex : nextOrder.length, 0, String(pedido_id));
    setCellTripOrder(vehiculo_id, fecha, nextOrder);
    await persistCellTripOrder(vehiculo_id, fecha, nextOrder);
  }

  async function handleDrop(e, vehiculo_id, dia) {
    e.preventDefault();
    setDragOver(null);
    if (!puedeEditar("pedidos")) return;
    const pedido_id = e.dataTransfer.getData("pedido_id");
    const p = pedidos.find(x => String(x.id) === String(pedido_id));
    if (!p || pedidoTieneFacturaFinal(p)) return;
    const vehiculo = vehiculos.find(v => String(v.id) === String(vehiculo_id));
    if (!vehiculo) return;
    const { payload: assignmentPayload, linkedChofer } = buildTrafficAssignment(
      p,
      vehiculo,
      dia.toISOString().slice(0,10),
      choferes
    );
    const nextForm = { ...p, ...assignmentPayload };
    if (
      String(p.vehiculo_id || "") === String(nextForm.vehiculo_id || "") &&
      toDateInputValue(p.fecha_carga || p.fecha_pedido) === nextForm.fecha_carga &&
      String(p.chofer_id || "") === String(nextForm.chofer_id || "")
    ) {
      notify("El pedido ya estaba colocado en ese vehiculo y fecha.", "warning");
      return;
    }
    const conflictos = collectAssignmentConflicts({
      pedidoActual: p,
      form: {
        vehiculo_id: nextForm.vehiculo_id || "",
        chofer_id: nextForm.chofer_id || "",
        fecha_carga: toDateInputValue(nextForm.fecha_carga || nextForm.fecha_pedido),
        hora_carga: toTimeInputValue(nextForm.hora_carga),
        fecha_descarga: toDateInputValue(nextForm.fecha_descarga || nextForm.fecha_entrega),
        hora_descarga: toTimeInputValue(nextForm.hora_descarga),
        km_ruta: nextForm.km_ruta || nextForm.km || 0,
        km: nextForm.km || nextForm.km_ruta || 0,
      },
      pedidos,
      vehiculos,
      choferes,
    });
    const hardConflicts = conflictos.filter(c => c.level === "hard");
    const warnings = [];
    if (!p.colaborador_id && !p.colaborador_nombre && !nextForm.chofer_id) {
      warnings.push("El viaje sigue sin chofer asignado");
    }
    const stateIssues = getPedidoStateValidationIssues(nextForm, nextForm.estado).filter(issue =>
      issue !== "Falta fecha de carga" && issue !== "Falta vehiculo"
    );
    warnings.push(...stateIssues);
    if (hardConflicts.length) {
      const resumen = hardConflicts.slice(0, 4).map(c => `- ${c.recurso}: ${c.resumen}`).join("\n");
      const seguir = await confirmDialog({
        title: "Conflicto operativo en la asignacion",
        message: `Ese movimiento pisa otros viajes activos:\n\n${resumen}${hardConflicts.length > 4 ? `\nY ${hardConflicts.length - 4} mas.` : ""}\n\nPuedes colocarlo igualmente si trafico ya lo ha validado.`,
        confirmText: "Asignar igualmente",
        tone: "danger",
      });
      if (!seguir) return;
    } else if (warnings.length) {
      const seguir = await confirmDialog({
        title: "Asignacion incompleta",
        message: `El pedido se puede colocar, pero quedan datos pendientes:\n\n- ${warnings.slice(0, 4).join("\n- ")}${warnings.length > 4 ? `\n- Y ${warnings.length - 4} mas.` : ""}\n\nSi continuas, el pedido quedara visible en el cuadrante con aviso para completarlo despues.`,
        confirmText: "Colocar igualmente",
        tone: "warning",
      });
      if (!seguir) return;
    }
    try {
      let actualizado;
      try {
        actualizado = await editarPedido(p.id, assignmentPayload);
      } catch (err) {
        if (!isFestivoConfirmError(err) || !(await confirmFestivoDestino(err))) throw err;
        actualizado = await editarPedido(p.id, { ...assignmentPayload, festivo_confirmado: true });
        notify("Asignacion aceptada con aviso de festivo. Gerencia queda notificada.", "success");
      }
      syncPedidoLocal(
        p.id,
        buildTrafficAssignmentLocalPatch(actualizado, assignmentPayload, vehiculo, linkedChofer)
      );
      const currentIds = getTrips(vehiculo_id, dia).map(x => String(x.id)).filter(id => id !== String(p.id));
      const nextIds = [...currentIds, String(p.id)];
      setCellTripOrder(vehiculo_id, assignmentPayload.fecha_carga, nextIds);
      persistCellTripOrder(vehiculo_id, assignmentPayload.fecha_carga, nextIds);
      broadcastPedidosChanged({ pedido_id: p.id, source: "gestion-trafico-dnd" });
      notify(
        `${p.numero || "Pedido"} asignado a ${vehiculo?.matricula || "vehiculo"}${linkedChofer && !p.chofer_id ? ` con ${linkedChofer.nombre || ""} ${linkedChofer.apellidos || ""}`.trim().replace(/\s+/g, " ") : ""}.`,
        "success"
      );
    } catch(err) { notify(err.message, "error"); }
  }

  const viajesParaAnadir = useMemo(() => {
    if (!addTripCell) return [];
    const fecha = addTripCell.fecha;
    return sortTripsByOperationalPriority(pedidos.filter(p => {
      if (!p?.id || pedidoTieneFacturaFinal(p)) return false;
      if (["cancelado", "facturado"].includes(String(p.estado || "").toLowerCase())) return false;
      if (p.colaborador_id || p.colaborador_nombre) return false;
      const sameCell = String(p.vehiculo_id || "") === String(addTripCell.vehiculo_id || "") && fechaPedido(p) === fecha;
      if (sameCell) return false;
      const f = fechaPedido(p);
      return !p.vehiculo_id || !f || f === fecha || (f >= semanaInicio && f <= semanaFin);
    })).slice(0, 80);
  }, [addTripCell, pedidos, semanaInicio, semanaFin]);

  const viajesYaCargadosEnCelda = useMemo(() => {
    if (!addTripCell) return [];
    return sortTripsByOperationalPriority(pedidos.filter(p =>
      String(p.vehiculo_id || "") === String(addTripCell.vehiculo_id || "") &&
      fechaPedido(p) === addTripCell.fecha &&
      !["cancelado", "facturado"].includes(String(p.estado || "").toLowerCase())
    ));
  }, [addTripCell, pedidos]);

  function abrirAnadirViaje(vehiculo, dia) {
    if (!vehiculo?.id) return;
    const fecha = dia.toISOString().slice(0, 10);
    setAddTripCell({ vehiculo_id: vehiculo.id, fecha, matricula: vehiculo.matricula || "" });
    setAddTripExistingId("");
  }

  async function asignarViajeExistenteACelda() {
    if (!addTripCell || !addTripExistingId) {
      notify("Selecciona un viaje existente.", "warning");
      return;
    }
    const pedido = pedidos.find(p => String(p.id) === String(addTripExistingId));
    const vehiculo = vehiculos.find(v => String(v.id) === String(addTripCell.vehiculo_id));
    if (!pedido || !vehiculo) return;
    const { payload, linkedChofer } = buildTrafficAssignment(
      pedido,
      vehiculo,
      addTripCell.fecha,
      choferes
    );
    setAddTripSaving(true);
    try {
      let actualizado;
      try {
        actualizado = await editarPedido(pedido.id, payload);
      } catch (err) {
        if (!isFestivoConfirmError(err) || !(await confirmFestivoDestino(err))) throw err;
        actualizado = await editarPedido(pedido.id, { ...payload, festivo_confirmado: true });
      }
      syncPedidoLocal(
        pedido.id,
        buildTrafficAssignmentLocalPatch(actualizado, payload, vehiculo, linkedChofer)
      );
      const day = new Date(`${addTripCell.fecha}T00:00:00`);
      const currentIds = getTrips(vehiculo.id, day).map(x => String(x.id)).filter(id => id !== String(pedido.id));
      const nextIds = [...currentIds, String(pedido.id)];
      setCellTripOrder(vehiculo.id, addTripCell.fecha, nextIds);
      persistCellTripOrder(vehiculo.id, addTripCell.fecha, nextIds);
      broadcastPedidosChanged({ pedido_id: pedido.id, source: "gestion-trafico-add-existing" });
      notify(`${pedido.numero || "Viaje"} anadido a ${vehiculo.matricula || "la celda"}.`, "success");
      setAddTripCell(null);
      setAddTripExistingId("");
    } catch (err) {
      notify(err.message || "No se pudo anadir el viaje.", "error");
    } finally {
      setAddTripSaving(false);
    }
  }

  function irACrearViajeDesdeCelda() {
    if (!addTripCell) return;
    const vehiculo = vehiculos.find(v => String(v.id) === String(addTripCell.vehiculo_id));
    const linkedChoferRaw = findLinkedChoferForVehiculo(vehiculo, choferes);
    const linkedChofer = isChoferAsignable(linkedChoferRaw) ? linkedChoferRaw : null;
    setRuntimeFocus("tms_pedidos_focus", {
      source: "gestion_trafico",
      action: "nuevo",
      defaults: {
        vehiculo_id: addTripCell.vehiculo_id,
        chofer_id: linkedChofer?.id || vehiculo?.chofer_id || "",
        remolque_id: vehiculo?.remolque_id || "",
        fecha_carga: addTripCell.fecha,
        fecha_pedido: addTripCell.fecha,
      },
    });
    window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"pedidos" }));
    notify("Abro Pedidos para crear el viaje con la fecha y vehiculo de la celda como referencia.", "success");
    setAddTripCell(null);
  }

  const LEGEND = [
    { k:"en_curso",   l:"En Curso" },
    { k:"confirmado", l:"Confirmado" },
    { k:"pendiente",  l:"Pendiente" },
    { k:"entregado",  l:"Entregado" },
    { k:"cancelado",  l:"Cancelado" },
  ];

  // Column width
  const COL_VEH  = 230;
  const COL_DAY  = 148;
  const aplicarFiltroResumen = useCallback((key) => {
    setVistaMain("cuadrante");
    if (key === "total") {
      setFiltroEst("todos");
      setSoloCompletar(false);
      setSoloCriticos(false);
      setSoloSinAsignar(false);
      setSoloColaboradores(false);
      setSoloKmVacio(false);
      setSoloSinKmRuta(false);
      setSoloSinPrecio(false);
      setSoloMargenNegativo(false);
      return;
    }
    if (key === "sin_asignar") {
      setSoloSinAsignar(v => !v);
      setShowAdvancedFilters(true);
      return;
    }
    if (key === "conflictos") {
      setSoloCriticos(v => !v);
      return;
    }
    if (key === "completar") {
      setSoloCompletar(v => !v);
      return;
    }
    if (key === "km_vacio") {
      setSoloKmVacio(v => !v);
      setShowAdvancedFilters(true);
      return;
    }
    if (key === "sin_km") {
      setSoloSinKmRuta(v => !v);
      setShowAdvancedFilters(true);
      return;
    }
    if (key === "sin_precio") {
      setSoloSinPrecio(v => !v);
      setShowAdvancedFilters(true);
      return;
    }
    if (key === "margen_negativo") {
      setSoloMargenNegativo(v => !v);
      setShowAdvancedFilters(true);
      return;
    }
    if (key === "colaborador") {
      setSoloColaboradores(v => !v);
      setShowAdvancedFilters(true);
    }
  }, []);

  return (
    <div className="tg-traffic-page" style={{ fontFamily:"'DM Sans',sans-serif", height:"100%", display:"flex", flexDirection:"column", overflow:"hidden", background:"var(--bg)" }}>

      {/* â”€â”€ Vista tabs â”€â”€ */}
      {!esModoChoferOptimizacion && !hideInternalTabs && <div className="tg-traffic-tabs" style={{padding:"6px 16px",borderBottom:"1px solid var(--border)",background:"var(--bg3)",display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
        {[["cuadrante","Cuadrante semanal"],["grupajes","Grupajes"],["optimizacion","Optimizacion de rutas"]].map(([v,lbl])=>(
          <button key={v} onClick={()=>setVistaMain(v)}
            style={{padding:"5px 14px",borderRadius:6,border:"none",fontSize:12,fontWeight:700,cursor:"pointer",
              background:vistaMain===v?"var(--accent)":"var(--bg4)",color:vistaMain===v?"#fff":"var(--text4)"}}>
            {lbl}
            {v === "grupajes" && pedidosGrupaje.length > 0 ? (
              <span style={{
                marginLeft:6,
                minWidth:18,
                height:18,
                padding:"0 5px",
                borderRadius:9,
                background:vistaMain===v ? "rgba(255,255,255,.22)" : "#f59e0b",
                color:"#fff",
                display:"inline-flex",
                alignItems:"center",
                justifyContent:"center",
                fontSize:10,
                fontWeight:900,
              }}>
                {pedidosGrupaje.length}
              </span>
            ) : null}
          </button>
        ))}
        {vistaMain==="grupajes"&&<span style={{fontSize:11,color:"var(--text5)",marginLeft:8}}>Arrastra para reordenar</span>}
      </div>}

      {/* â”€â”€ Leyenda de estados â”€â”€ */}
      {!esModoChoferOptimizacion && <div className="tg-traffic-legend" style={{
        padding:"8px 16px", borderBottom:"1px solid var(--border)",
        background:"var(--bg2)", flexShrink:0,
        display:"flex", alignItems:"center", gap:6, flexWrap:"wrap",
      }}>
        {LEGEND.map(({ k, l }) => {
          const e = EC[k];
          const active = filtroEst === k;
          return (
            <button key={k} onClick={() => setFiltroEst(active ? "todos" : k)}
              style={{
                display:"flex", alignItems:"center", gap:6, padding:"3px 11px", borderRadius:20,
                cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:active?700:500,
                background: active ? e.bg : "transparent",
                border: `1.5px solid ${active ? e.color : "var(--border)"}`,
                transition:"all .12s",
              }}>
              <span style={{ width:9, height:9, borderRadius:"50%", background:e.color, flexShrink:0, display:"inline-block" }}/>
              <span style={{ color: active ? e.color : "var(--text4)" }}>{l}</span>
            </button>
          );
        })}
        <button onClick={() => setSoloCompletar(v => !v)}
          style={{
            display:"flex", alignItems:"center", gap:6, padding:"3px 11px", borderRadius:20,
            cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:soloCompletar?800:600,
            background: soloCompletar ? "rgba(251,191,36,.16)" : "transparent",
            border: `1.5px solid ${soloCompletar ? "#fbbf24" : "var(--border)"}`,
            color: soloCompletar ? "#fbbf24" : "var(--text4)",
          }}>
          Pendientes de completar
          {pendientesCompletarSemana > 0 && (
            <span style={{minWidth:18,height:18,padding:"0 5px",borderRadius:9,display:"inline-flex",alignItems:"center",justifyContent:"center",background:soloCompletar?"rgba(255,255,255,.18)":"#f59e0b",color:"#fff",fontSize:10,fontWeight:900}}>
              {pendientesCompletarSemana}
            </span>
          )}
        </button>
        <button onClick={() => setSoloCriticos(v => !v)}
          style={{
            display:"flex", alignItems:"center", gap:6, padding:"3px 11px", borderRadius:20,
            cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:soloCriticos?800:600,
            background: soloCriticos ? "rgba(239,68,68,.14)" : "transparent",
            border: `1.5px solid ${soloCriticos ? "rgba(239,68,68,.42)" : "var(--border)"}`,
            color: soloCriticos ? "#f87171" : "var(--text4)",
          }}>
          Solo criticos
          {(urgentesSinAsignarSemana > 0 || Object.keys(conflictosOperativosSemana).length > 0) && (
            <span style={{minWidth:18,height:18,padding:"0 5px",borderRadius:9,display:"inline-flex",alignItems:"center",justifyContent:"center",background:soloCriticos?"rgba(255,255,255,.18)":"#ef4444",color:"#fff",fontSize:10,fontWeight:900}}>
              {urgentesSinAsignarSemana + Object.keys(conflictosOperativosSemana).length}
            </span>
          )}
        </button>
        {Object.keys(conflictosOperativosSemana).length > 0 && (
          <div style={{
            display:"flex", alignItems:"center", gap:6, padding:"3px 11px", borderRadius:20,
            border:"1.5px solid rgba(239,68,68,.28)", background:"rgba(239,68,68,.08)",
            color:"#f87171", fontSize:11, fontWeight:800
          }}>
            Conflictos semanales
            <span style={{minWidth:18,height:18,padding:"0 5px",borderRadius:9,display:"inline-flex",alignItems:"center",justifyContent:"center",background:"rgba(239,68,68,.18)",color:"#fff",fontSize:10,fontWeight:900}}>
              {Object.keys(conflictosOperativosSemana).length}
            </span>
          </div>
        )}
        {urgentesSinAsignarSemana > 0 && (
          <div style={{
            display:"flex", alignItems:"center", gap:6, padding:"3px 11px", borderRadius:20,
            border:"1.5px solid rgba(245,158,11,.28)", background:"rgba(245,158,11,.10)",
            color:"#f59e0b", fontSize:11, fontWeight:800
          }}>
            Cargas urgentes sin asignar
            <span style={{minWidth:18,height:18,padding:"0 5px",borderRadius:9,display:"inline-flex",alignItems:"center",justifyContent:"center",background:"rgba(245,158,11,.18)",color:"#fff",fontSize:10,fontWeight:900}}>
              {urgentesSinAsignarSemana}
            </span>
          </div>
        )}
        <span style={{ marginLeft:"auto", fontSize:11, color:"var(--text5)", fontStyle:"italic" }}>
          Clic en vehiculo para expandir - clic en viaje para editar
        </span>
      </div>}
      {!esModoChoferOptimizacion && vistaMain==="cuadrante" && (
        <div className="tg-traffic-summary" style={{
          padding:"8px 16px",
          borderBottom:"1px solid var(--border)",
          background:"var(--bg2)",
          display:"grid",
          gridTemplateColumns:resumenSemanaVisible ? "repeat(auto-fit,minmax(128px,1fr))" : "1fr auto",
          gap:8,
          flexShrink:0
        }}>
          {!resumenSemanaVisible && (
            <div style={{display:"flex",alignItems:"center",gap:10,minHeight:30}}>
              <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>Resumen semanal oculto</div>
              <div style={{fontSize:12,color:"var(--text4)"}}>
                {resumenOperativoSemana.total} viaje(s), {resumenOperativoSemana.sinAsignacionParcial} sin asignacion, {resumenOperativoSemana.conflictos} conflicto(s)
              </div>
            </div>
          )}
          {resumenSemanaVisible && [
            ["total", "Viajes semana", resumenOperativoSemana.total, "var(--text)", "Pedidos visibles en el cuadrante"],
            ["sin_asignar", "Sin asignar", resumenOperativoSemana.sinAsignacionParcial, resumenOperativoSemana.sinAsignacionParcial ? "#f59e0b" : "#10b981", "Sin vehiculo, chofer o colaborador completo"],
            ["conflictos", "Conflictos", resumenOperativoSemana.conflictos, resumenOperativoSemana.conflictosDuros ? "#f87171" : resumenOperativoSemana.conflictos ? "#f59e0b" : "#10b981", `${resumenOperativoSemana.conflictosDuros} duros`],
            ["completar", "Completar", resumenOperativoSemana.pendientesCompletar, resumenOperativoSemana.pendientesCompletar ? "#fbbf24" : "#10b981", "Viajes marcados para revisar"],
            ["km_vacio", "Km vacio", Number(resumenOperativoSemana.kmVacio).toLocaleString("es-ES"), resumenOperativoSemana.kmVacio > 0 ? "#f59e0b" : "#10b981", "Kilometros en vacio previstos"],
            ["sin_km", "Sin km ruta", resumenOperativoSemana.rutasSinKm, resumenOperativoSemana.rutasSinKm ? "#60a5fa" : "#10b981", "Falta distancia para ETA/costes"],
            ["sin_precio", "Sin precio", resumenOperativoSemana.sinPrecio, resumenOperativoSemana.sinPrecio ? "#f87171" : "#10b981", "Viajes sin precio de venta"],
            ["margen_negativo", "Margen", fmtEur(resumenOperativoSemana.margen), resumenOperativoSemana.margen < 0 ? "#fb7185" : "#10b981", `${resumenOperativoSemana.margenNegativo} viaje(s) con margen negativo`],
            ["colaborador", "Colaborador", resumenOperativoSemana.colaboradores, resumenOperativoSemana.colaboradores ? "#38bdf8" : "var(--text5)", "Viajes cargados a colaborador"],
          ].map(([key, label, value, color, hint]) => (
            <div key={label} role="button" tabIndex={0} onClick={() => aplicarFiltroResumen(key)} onKeyDown={e => { if (e.key === "Enter") aplicarFiltroResumen(key); }} title={`${hint}. Clic para filtrar.`} style={{border:"1px solid var(--border2)",borderRadius:8,background:"var(--bg3)",padding:"7px 9px",cursor:"pointer"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:15,color}}>{value}</div>
              <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",color:"var(--text5)",marginTop:2}}>{label}</div>
            </div>
          ))}
          <button
            onClick={() => setResumenSemanaVisible(v => !v)}
            style={{alignSelf:"stretch",padding:"6px 12px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
          >
            {resumenSemanaVisible ? "Ocultar resumen" : "Mostrar resumen"}
          </button>
        </div>
      )}

      {/* â”€â”€ Nav semana â”€â”€ */}
      {!esModoChoferOptimizacion && vistaMain==="cuadrante" && incidenciasViaje.length > 0 && (
        <div style={{padding:"10px 16px",borderBottom:"1px solid rgba(239,68,68,.20)",background:"rgba(239,68,68,.07)",display:"grid",gap:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:12,fontWeight:900,color:"#f87171"}}>Incidencias de viaje</div>
              <div style={{fontSize:11,color:"var(--text5)"}}>Paralizaciones, descansos incorrectos o avisos generados desde la app del chofer.</div>
            </div>
            <span style={{fontSize:11,fontWeight:900,color:"#f87171",background:"rgba(239,68,68,.12)",border:"1px solid rgba(239,68,68,.24)",borderRadius:999,padding:"4px 10px"}}>
              {incidenciasViaje.length} pendiente{incidenciasViaje.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div style={{display:"grid",gap:6}}>
            {incidenciasViaje.slice(0,4).map(n => {
              const data = n.data || {};
              const pedidoId = data.pedido_id || data.pedidoId || "";
              const pedido = pedidoId ? pedidos.find(p => String(p.id) === String(pedidoId)) : null;
              return (
                <div key={n.id} style={{display:"flex",alignItems:"center",gap:8,justifyContent:"space-between",background:"var(--bg2)",border:"1px solid rgba(239,68,68,.22)",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>
                      {n.titulo || "Incidencia operativa"}{pedido?.numero ? <span style={{color:"#f87171"}}> - {pedido.numero}</span> : null}
                    </div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {n.mensaje || data.ruta || "Revisar incidencia del viaje."}{data.minutos ? ` - ${data.minutos} min` : ""}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    {pedido && (
                      <button onClick={()=>abrirViaje(pedido)} style={{padding:"5px 9px",borderRadius:7,border:"1px solid rgba(59,130,246,.24)",background:"rgba(59,130,246,.10)",color:"#60a5fa",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                        Abrir viaje
                      </button>
                    )}
                    <button onClick={()=>marcarIncidenciaViajeLeida(n.id)} style={{padding:"5px 9px",borderRadius:7,border:"1px solid rgba(16,185,129,.24)",background:"rgba(16,185,129,.10)",color:"#10b981",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                      Leida
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!esModoChoferOptimizacion && vistaMain==="cuadrante" && pedidosCriticosMetaVisibles.length > 0 && (
        <div style={{
          padding:"10px 16px",
          borderBottom:"1px solid var(--border)",
          background:"rgba(245,158,11,.06)",
          display:"grid",
          gap:8
        }}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:12,fontWeight:900,color:"#f59e0b"}}>Pedidos criticos proximos a carga</div>
              <div style={{fontSize:11,color:"var(--text5)"}}>
                {pedidosCriticosMetaActivos.length
                  ? `${pedidosCriticosMetaActivos.length} aviso(s) pendiente(s) de ${pedidosCriticosMetaVisibles.length} visible(s).`
                  : `No quedan avisos pendientes. ${pedidosCriticosMetaVisibles.length} ya fueron revisados.`}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <div style={{fontSize:11,color:"var(--text4)"}}>
                {pedidosCriticosMetaActivos.length} pendiente(s) / {pedidosCriticosMetaVisibles.length} total
              </div>
              <button
                onClick={() => setCriticalPanelOpen(v => !v)}
                style={{padding:"5px 10px",borderRadius:999,border:"1px solid rgba(245,158,11,.24)",background:"rgba(245,158,11,.10)",color:"#f59e0b",fontSize:11,fontWeight:800,cursor:"pointer"}}
              >
                {criticalPanelOpen ? "Ocultar avisos" : "Mostrar avisos"}
              </button>
              {pedidosCriticosMetaActivos.length > 0 && (
                <button
                  onClick={marcarAvisosVisiblesLeidos}
                  style={{padding:"5px 10px",borderRadius:999,border:"1px solid rgba(59,130,246,.24)",background:"rgba(59,130,246,.10)",color:"#60a5fa",fontSize:11,fontWeight:800,cursor:"pointer"}}
                >
                  Marcar visibles leidos
                </button>
              )}
            </div>
          </div>
          {criticalPanelOpen && (
            <>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <div style={{fontSize:11,fontWeight:800,color:"#f87171",background:"rgba(239,68,68,.10)",border:"1px solid rgba(239,68,68,.24)",borderRadius:999,padding:"4px 10px"}}>
              Sin hueco {pedidosCriticosMetaActivos.filter(item => !item.availability?.hayHueco).length}
            </div>
            <div style={{fontSize:11,fontWeight:800,color:"#f59e0b",background:"rgba(245,158,11,.10)",border:"1px solid rgba(245,158,11,.24)",borderRadius:999,padding:"4px 10px"}}>
              Datos pendientes {pedidosCriticosMetaActivos.filter(item => item.quick?.disabled).length}
            </div>
            <div style={{fontSize:11,fontWeight:800,color:"#fb7185",background:"rgba(244,63,94,.10)",border:"1px solid rgba(244,63,94,.24)",borderRadius:999,padding:"4px 10px"}}>
              Conflictos duros {pedidosCriticosMetaActivos.filter(item => item.blockingConflict?.level === "hard").length}
            </div>
            <button
              onClick={copiarCriticosSemanaSiguiente}
              disabled={bulkCopying}
              style={{fontSize:11,fontWeight:800,color:"#60a5fa",background:"rgba(59,130,246,.12)",border:"1px solid rgba(59,130,246,.24)",borderRadius:999,padding:"4px 12px",cursor:bulkCopying?"not-allowed":"pointer",opacity:bulkCopying?.6:1}}
            >
              {bulkCopying ? "Copiando criticos..." : "Copiar criticos"}
            </button>
            <label style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:11,fontWeight:800,color:"var(--text3)",padding:"4px 10px",borderRadius:999,border:"1px solid var(--border2)",background:"rgba(148,163,184,.08)"}}>
              <input type="checkbox" checked={allVisibleCriticalsSelected} onChange={toggleSelectAllCriticals} />
              Seleccionar visibles
            </label>
          </div>
          {selectedCriticalIds.length > 0 && (
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",padding:"8px 10px",borderRadius:8,border:"1px solid rgba(59,130,246,.18)",background:"rgba(59,130,246,.08)"}}>
              <span style={{fontSize:11,fontWeight:900,color:"#60a5fa"}}>
                {selectedCriticalIds.length} critico{selectedCriticalIds.length !== 1 ? "s" : ""} seleccionado{selectedCriticalIds.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={copiarCriticosSeleccionadosSemanaSiguiente}
                disabled={bulkCopying}
                style={{padding:"4px 10px",borderRadius:999,border:"1px solid rgba(59,130,246,.24)",background:"rgba(59,130,246,.12)",color:"#60a5fa",fontSize:11,fontWeight:800,cursor:bulkCopying?"not-allowed":"pointer",opacity:bulkCopying?0.6:1}}
              >
                {bulkCopying ? "Copiando..." : "Copiar seleccionados"}
              </button>
              <button
                onClick={solicitarRetrasoSeleccionados}
                disabled={bulkCriticalRescheduling}
                style={{padding:"4px 10px",borderRadius:999,border:"1px solid rgba(245,158,11,.24)",background:"rgba(245,158,11,.12)",color:"#f59e0b",fontSize:11,fontWeight:800,cursor:bulkCriticalRescheduling?"not-allowed":"pointer",opacity:bulkCriticalRescheduling?0.6:1}}
              >
                {bulkCriticalRescheduling ? "Retrasando..." : "Retrasar"}
              </button>
              <button
                onClick={aplicarSugerenciasSeleccionadas}
                disabled={bulkCriticalAssigning}
                style={{padding:"4px 10px",borderRadius:999,border:"1px solid rgba(16,185,129,.24)",background:"rgba(16,185,129,.12)",color:"#34d399",fontSize:11,fontWeight:800,cursor:bulkCriticalAssigning?"not-allowed":"pointer",opacity:bulkCriticalAssigning?0.6:1}}
              >
                {bulkCriticalAssigning ? "Asignando..." : "Aplicar sugeridos"}
              </button>
              <button
                onClick={avanzarCriticosSeleccionados}
                disabled={bulkCriticalAdvancing}
                style={{padding:"4px 10px",borderRadius:999,border:"1px solid rgba(168,85,247,.24)",background:"rgba(168,85,247,.12)",color:"#c084fc",fontSize:11,fontWeight:800,cursor:bulkCriticalAdvancing?"not-allowed":"pointer",opacity:bulkCriticalAdvancing?0.6:1}}
              >
                {bulkCriticalAdvancing ? "Actualizando..." : "Avanzar seleccionados"}
              </button>
              <button
                onClick={limpiarAsignacionesSeleccionadas}
                disabled={bulkCriticalClearing}
                style={{padding:"4px 10px",borderRadius:999,border:"1px solid rgba(239,68,68,.24)",background:"rgba(239,68,68,.10)",color:"#f87171",fontSize:11,fontWeight:800,cursor:bulkCriticalClearing?"not-allowed":"pointer",opacity:bulkCriticalClearing?0.6:1}}
              >
                {bulkCriticalClearing ? "Limpiando..." : "Limpiar asignacion"}
              </button>
              <button
                onClick={() => setSelectedCriticalIds([])}
                style={{padding:"4px 10px",borderRadius:999,border:"1px solid var(--border2)",background:"rgba(148,163,184,.08)",color:"var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer"}}
              >
                Limpiar
              </button>
            </div>
          )}
          <div style={{display:"grid",gap:6}}>
            {pedidosCriticosGrouped.map(group => (
              <div key={`crit-group-${group.key}`} style={{display:"grid",gap:6}}>
                {agruparPorCliente && (
                  <button
                    onClick={() => setCollapsedClienteGroups(prev => ({ ...prev, [`crit:${group.key}`]: !prev[`crit:${group.key}`] }))}
                    style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"6px 10px",borderRadius:8,border:"1px solid rgba(16,185,129,.24)",background:"rgba(16,185,129,.08)",color:"var(--text)",cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:"'DM Sans',sans-serif"}}
                  >
                    <span style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:"var(--green)"}}>{collapsedClienteGroups[`crit:${group.key}`] ? "+" : "-"}</span>
                      <span>{group.label}</span>
                    </span>
                    <span style={{fontSize:10,color:"var(--text5)"}}>{group.items.length} aviso{group.items.length !== 1 ? "s" : ""}</span>
                  </button>
                )}
                {(!agruparPorCliente || !collapsedClienteGroups[`crit:${group.key}`]) && group.items.map(item => {
              const { pedido: p, flags, quick, suggestion, fallbackSuggestion, availability, blockingConflict, reasons } = item;
              const missingLabel = getPedidoMissingAssignmentLabel(p);
              const blockingPedido = blockingConflict ? pedidos.find(px => String(px.id) === String(blockingConflict.pedidoId)) : null;
              const blockingQuick = blockingPedido ? getQuickActionForPedido(blockingPedido) : null;
              const availabilityLabel = availability?.parejasLibres
                ? `${availability.parejasLibres} pareja${availability.parejasLibres !== 1 ? "s" : ""} libre${availability.parejasLibres !== 1 ? "s" : ""}`
                : availability?.vehiculosLibres
                  ? `${availability.vehiculosLibres} vehiculo${availability.vehiculosLibres !== 1 ? "s" : ""} libre${availability.vehiculosLibres !== 1 ? "s" : ""}`
                  : availability?.choferesLibres
                    ? `${availability.choferesLibres} chofer${availability.choferesLibres !== 1 ? "es" : ""} libre${availability.choferesLibres !== 1 ? "s" : ""}`
                    : "Sin recurso libre";
              return (
                <div key={`crit-${p.id}`} style={{
                  display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",
                  padding:"8px 10px",borderRadius:8,border:"1px solid rgba(245,158,11,.22)",background:"var(--bg2)"
                }}>
                  <label style={{display:"inline-flex",alignItems:"center",gap:6}}>
                    <input
                      type="checkbox"
                      checked={selectedCriticalIds.includes(String(p.id))}
                      onChange={() => toggleCriticalSelected(p.id)}
                    />
                  </label>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:800,color:"var(--text)"}}>{p.numero}</span>
                  <span style={{fontSize:12,color:"var(--text3)"}}>{p.origen} -> {p.destino}</span>
                  {reasons.map(reason => (
                    <span key={`${p.id}-${reason.key}`} style={{
                      fontSize:10,
                      fontWeight:900,
                      color: reason.tone === "danger" ? "#f87171" : reason.tone === "warning" ? "#f59e0b" : "#60a5fa",
                      background: reason.tone === "danger" ? "rgba(239,68,68,.10)" : reason.tone === "warning" ? "rgba(245,158,11,.10)" : "rgba(59,130,246,.12)",
                      border: reason.tone === "danger" ? "1px solid rgba(239,68,68,.24)" : reason.tone === "warning" ? "1px solid rgba(245,158,11,.24)" : "1px solid rgba(59,130,246,.24)",
                      borderRadius:999,
                      padding:"3px 8px"
                    }}>
                      {reason.label}
                    </span>
                  ))}
                  {missingLabel && (
                    <span style={{
                      fontSize:10,
                      fontWeight:900,
                      color:"#60a5fa",
                      background:"rgba(59,130,246,.12)",
                      border:"1px solid rgba(59,130,246,.26)",
                      borderRadius:999,
                      padding:"3px 8px"
                    }}>
                      {missingLabel}
                    </span>
                  )}
                  <span style={{fontSize:11,fontWeight:800,color:flags.overdueAssignment ? "#f87171" : "#f59e0b"}}>
                    {flags.overdueAssignment ? "Sin asignar - vencido" : `Sin asignar - ${Math.max(0, Math.round(flags.diffHours || 0))}h`}
                  </span>
                  <span style={{
                    fontSize:10,
                    fontWeight:800,
                    color: availability?.hayHueco ? "#34d399" : "#f87171",
                    background: availability?.hayHueco ? "rgba(16,185,129,.10)" : "rgba(239,68,68,.12)",
                    border: availability?.hayHueco ? "1px solid rgba(16,185,129,.24)" : "1px solid rgba(239,68,68,.28)",
                    borderRadius:999,
                    padding:"3px 8px"
                    }}>
                      {availabilityLabel}
                    </span>
                  {blockingConflict && (
                    <span style={{
                      fontSize:10,
                      fontWeight:800,
                      color: blockingConflict.level === "hard" ? "#f87171" : "#f59e0b",
                      background: blockingConflict.level === "hard" ? "rgba(239,68,68,.10)" : "rgba(245,158,11,.10)",
                      border: blockingConflict.level === "hard" ? "1px solid rgba(239,68,68,.24)" : "1px solid rgba(245,158,11,.24)",
                      borderRadius:999,
                      padding:"3px 8px"
                    }}
                    title={`${blockingConflict.recurso}: ${blockingConflict.resumen}`}>
                      Bloquea {blockingConflict.pedidoNumero}
                    </span>
                  )}
                  {quick?.disabled && quick.issues?.[0] && (
                    <span style={{
                      fontSize:10,
                      fontWeight:800,
                      color:"#f59e0b",
                      background:"rgba(245,158,11,.10)",
                      border:"1px solid rgba(245,158,11,.24)",
                      borderRadius:999,
                      padding:"3px 8px"
                    }}
                    title={quick.issues.join(" · ")}>
                      Falta: {quick.issues[0].replace(/^Falta\s+/i, "")}
                    </span>
                  )}
                  <div style={{display:"flex",gap:6,marginLeft:"auto",flexWrap:"wrap"}}>
                    {suggestion && (
                      <button
                        onClick={() => aplicarAsignacionSugerida(p)}
                        disabled={quickAssigningId === String(p.id)}
                        style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(59,130,246,.28)",background:"rgba(59,130,246,.12)",color:"#60a5fa",fontSize:11,fontWeight:800,cursor:quickAssigningId === String(p.id) ? "not-allowed" : "pointer",opacity:quickAssigningId === String(p.id) ? .6 : 1}}
                        title={suggestion.label || "Asignacion sugerida"}
                      >
                        {quickAssigningId === String(p.id)
                          ? "Asignando..."
                          : suggestion?.missing?.vehiculo && suggestion?.missing?.chofer
                            ? "Asignar pareja sugerida"
                            : "Completar sugerido"}
                      </button>
                    )}
                    {!suggestion && fallbackSuggestion && (
                      <button
                        onClick={() => aplicarAsignacionSugerida(p, fallbackSuggestion)}
                        disabled={quickAssigningId === String(p.id)}
                        style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(239,68,68,.28)",background:"rgba(239,68,68,.12)",color:"#f87171",fontSize:11,fontWeight:800,cursor:quickAssigningId === String(p.id) ? "not-allowed" : "pointer",opacity:quickAssigningId === String(p.id) ? .6 : 1}}
                        title={`${fallbackSuggestion.label || "Alternativa operativa"}${fallbackSuggestion.hardConflicts ? ` - ${fallbackSuggestion.hardConflicts} conflicto(s)` : ""}${fallbackSuggestion.warningConflicts ? ` - ${fallbackSuggestion.warningConflicts} aviso(s)` : ""}`}
                      >
                        {quickAssigningId === String(p.id) ? "Aplicando..." : "Mejor alternativa"}
                      </button>
                    )}
                    {blockingConflict && (
                      <button
                        onClick={() => abrirPedidoBloqueante(blockingConflict)}
                        style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(245,158,11,.28)",background:"rgba(245,158,11,.12)",color:"#f59e0b",fontSize:11,fontWeight:800,cursor:"pointer"}}
                        title={`${blockingConflict.pedidoNumero} - ${blockingConflict.resumen}`}
                      >
                        Ir al bloqueo
                      </button>
                    )}
                    {blockingPedido && blockingQuick && (
                      <button
                        onClick={() => aplicarEstadoRapido(blockingPedido, blockingQuick.next)}
                        disabled={quickUpdatingId === String(blockingPedido.id) || blockingQuick.disabled}
                        style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(168,85,247,.28)",background:"rgba(168,85,247,.12)",color:"#c084fc",fontSize:11,fontWeight:800,cursor:(quickUpdatingId === String(blockingPedido.id) || blockingQuick.disabled) ? "not-allowed" : "pointer",opacity:(quickUpdatingId === String(blockingPedido.id) || blockingQuick.disabled) ? .6 : 1}}
                        title={blockingQuick.disabled && blockingQuick.issues?.length ? blockingQuick.issues.join(" · ") : `${blockingPedido.numero || "Viaje bloqueante"} -> ${blockingQuick.label}`}
                      >
                        {quickUpdatingId === String(blockingPedido.id)
                          ? "Actualizando..."
                          : blockingQuick.disabled
                            ? "Bloqueo incompleto"
                            : `Mover bloqueo a ${blockingQuick.label}`}
                      </button>
                    )}
                    {quick && (
                      <button
                        onClick={() => aplicarEstadoRapido(p, quick.next)}
                        disabled={quickUpdatingId === String(p.id) || quick.disabled}
                        style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${quick.disabled ? "rgba(245,158,11,.28)" : "rgba(16,185,129,.28)"}`,background:quick.disabled ? "rgba(245,158,11,.12)" : "rgba(16,185,129,.12)",color:quick.disabled ? "#f59e0b" : "#34d399",fontSize:11,fontWeight:800,cursor:(quickUpdatingId === String(p.id) || quick.disabled) ? "not-allowed" : "pointer",opacity:(quickUpdatingId === String(p.id) || quick.disabled) ? .6 : 1}}
                        title={quick.disabled && quick.issues?.length ? quick.issues.join(" · ") : quick.label}
                      >
                        {quick.disabled ? "Completar datos" : quick.label}
                      </button>
                    )}
                    <button
                      onClick={() => copiarPedido(p)}
                      disabled={copyingPedidoId === String(p.id)}
                      style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(59,130,246,.28)",background:"rgba(59,130,246,.12)",color:"#60a5fa",fontSize:11,fontWeight:800,cursor:copyingPedidoId === String(p.id) ? "not-allowed" : "pointer",opacity:copyingPedidoId === String(p.id) ? .6 : 1}}
                    >
                      {copyingPedidoId === String(p.id) ? "Copiando..." : "Copiar"}
                    </button>
                    <button
                      onClick={() => solicitarRetrasoPedido(p)}
                      disabled={reschedulingPedidoId === String(p.id)}
                      style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(245,158,11,.28)",background:"rgba(245,158,11,.12)",color:"#f59e0b",fontSize:11,fontWeight:800,cursor:reschedulingPedidoId === String(p.id) ? "not-allowed" : "pointer",opacity:reschedulingPedidoId === String(p.id) ? .6 : 1}}
                    >
                      {reschedulingPedidoId === String(p.id) ? "Moviendo..." : "Retrasar"}
                    </button>
                    {(p.vehiculo_id || p.chofer_id || p.remolque_id) && (
                      <button
                        onClick={() => limpiarAsignacionPedido(p)}
                        disabled={quickAssigningId === String(p.id)}
                        style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(239,68,68,.28)",background:"rgba(239,68,68,.10)",color:"#f87171",fontSize:11,fontWeight:800,cursor:quickAssigningId === String(p.id) ? "not-allowed" : "pointer",opacity:quickAssigningId === String(p.id) ? .6 : 1}}
                      >
                        {quickAssigningId === String(p.id) ? "Limpiando..." : "Limpiar asignacion"}
                      </button>
                    )}
                    <button
                      onClick={() => marcarAvisoLeido(item)}
                      style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--border2)",background:"rgba(148,163,184,.08)",color:"var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer"}}
                    >
                      Leido
                    </button>
                    <button
                      onClick={() => abrirViaje(p)}
                      style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",fontSize:11,fontWeight:800,cursor:"pointer"}}
                    >
                      Abrir
                    </button>
                  </div>
                </div>
                );
              })}
              </div>
            ))}
          </div>
            </>
          )}
        </div>
      )}

      {!esModoChoferOptimizacion && vistaMain==="cuadrante" && (
        <>
          <div className="tg-traffic-filters" style={{padding:"8px 16px",borderBottom:"1px solid var(--border)",background:"var(--bg3)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <input
              value={searchTrafico}
              onChange={e => setSearchTrafico(e.target.value)}
              placeholder="Buscar pedido, cliente, origen, destino..."
              style={{minWidth:240,flex:"1 1 280px",padding:"7px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",fontSize:12,fontFamily:"'DM Sans',sans-serif"}}
            />
            <select
              value={filtroCliente}
              onChange={e => setFiltroCliente(e.target.value)}
              style={{minWidth:190,padding:"7px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",fontSize:12,fontFamily:"'DM Sans',sans-serif"}}
            >
              <option value="">Todos los clientes</option>
              {clienteOptionsSemana.map(opt => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowAdvancedFilters(v => !v)}
              style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${showAdvancedFilters ? "rgba(59,130,246,.25)" : "var(--border2)"}`,background:showAdvancedFilters ? "rgba(59,130,246,.12)" : "rgba(148,163,184,.10)",color:showAdvancedFilters ? "#60a5fa" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
            >
              Filtros avanzados
            </button>
            <button
              onClick={() => setAgruparPorCliente(v => !v)}
              style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${agruparPorCliente ? "rgba(16,185,129,.25)" : "var(--border2)"}`,background:agruparPorCliente ? "rgba(16,185,129,.12)" : "rgba(148,163,184,.10)",color:agruparPorCliente ? "#10b981" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
            >
              {agruparPorCliente ? "Agrupado por cliente" : "Agrupar por cliente"}
            </button>
            {(searchTrafico || filtroCliente || soloSinAsignar || soloColaboradores || soloKmVacio || soloSinKmRuta || soloSinPrecio || soloMargenNegativo || filtroTipoViaje !== "todos") && (
              <button
                onClick={() => { setSearchTrafico(""); setFiltroCliente(""); setSoloSinAsignar(false); setSoloColaboradores(false); setSoloKmVacio(false); setSoloSinKmRuta(false); setSoloSinPrecio(false); setSoloMargenNegativo(false); setFiltroTipoViaje("todos"); }}
                style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(239,68,68,.22)",background:"rgba(239,68,68,.10)",color:"#ef4444",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
              >
                Reset
              </button>
            )}
          </div>
          {showAdvancedFilters && (
            <div style={{padding:"8px 16px",borderBottom:"1px solid var(--border)",background:"var(--bg2)",display:"flex",gap:8,flexWrap:"wrap"}}>
              <button
                onClick={() => setSoloSinAsignar(v => !v)}
                style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${soloSinAsignar ? "rgba(139,92,246,.28)" : "var(--border2)"}`,background:soloSinAsignar ? "rgba(139,92,246,.12)" : "var(--bg3)",color:soloSinAsignar ? "#a78bfa" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
              >
                Solo sin asignar
              </button>
              <button
                onClick={() => setSoloColaboradores(v => !v)}
                style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${soloColaboradores ? "rgba(14,165,233,.28)" : "var(--border2)"}`,background:soloColaboradores ? "rgba(14,165,233,.12)" : "var(--bg3)",color:soloColaboradores ? "#38bdf8" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
              >
                Solo colaboradores
              </button>
              <button
                onClick={() => setSoloKmVacio(v => !v)}
                style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${soloKmVacio ? "rgba(245,158,11,.28)" : "var(--border2)"}`,background:soloKmVacio ? "rgba(245,158,11,.12)" : "var(--bg3)",color:soloKmVacio ? "#f59e0b" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
              >
                Km vacio
              </button>
              <button
                onClick={() => setSoloSinKmRuta(v => !v)}
                style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${soloSinKmRuta ? "rgba(59,130,246,.28)" : "var(--border2)"}`,background:soloSinKmRuta ? "rgba(59,130,246,.12)" : "var(--bg3)",color:soloSinKmRuta ? "#60a5fa" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
              >
                Sin km ruta
              </button>
              <button
                onClick={() => setSoloSinPrecio(v => !v)}
                style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${soloSinPrecio ? "rgba(239,68,68,.28)" : "var(--border2)"}`,background:soloSinPrecio ? "rgba(239,68,68,.12)" : "var(--bg3)",color:soloSinPrecio ? "#f87171" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
              >
                Sin precio
              </button>
              <button
                onClick={() => setSoloMargenNegativo(v => !v)}
                style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${soloMargenNegativo ? "rgba(244,63,94,.28)" : "var(--border2)"}`,background:soloMargenNegativo ? "rgba(244,63,94,.12)" : "var(--bg3)",color:soloMargenNegativo ? "#fb7185" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
              >
                Margen negativo
              </button>
              {[
                ["todos", "Todos"],
                ["salida", "Salidas"],
                ["retorno", "Retornos"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFiltroTipoViaje(key)}
                  style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${filtroTipoViaje === key ? "var(--accent)" : "var(--border2)"}`,background:filtroTipoViaje === key ? "var(--accent)" : "var(--bg3)",color:filtroTipoViaje === key ? "#fff" : "var(--text3)",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="tg-traffic-weeknav" style={{
        padding:"7px 16px", borderBottom:"1px solid var(--border)",
        background:"var(--bg3)", flexShrink:0,
        display:"flex", alignItems:"center", gap:8,
      }}>
        <button onClick={() => { const d=new Date(anchor); d.setDate(d.getDate()-7); setAnchor(d); }}
          style={{ padding:"4px 12px", borderRadius:6, border:"1px solid var(--border)", background:"var(--bg4)", color:"var(--text3)", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
          Anterior
        </button>
        <button onClick={() => setAnchor(new Date())}
          style={{ padding:"4px 12px", borderRadius:6, border:"none", background:"var(--accent)", color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
          Hoy
        </button>
        <button onClick={() => { const d=new Date(anchor); d.setDate(d.getDate()+7); setAnchor(d); }}
          style={{ padding:"4px 12px", borderRadius:6, border:"1px solid var(--border)", background:"var(--bg4)", color:"var(--text3)", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
          Siguiente
        </button>
        <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13, color:"var(--text)", marginLeft:6 }}>
          {weekLabel}
        </span>
        {loading && <span style={{ fontSize:11, color:"var(--text5)", marginLeft:8 }}>Actualizando...</span>}
      </div>

      {loadError && (
        <div style={{margin:"10px 16px 0",border:"1px solid rgba(239,68,68,.28)",background:"rgba(239,68,68,.08)",borderRadius:9,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:13,fontWeight:900,color:"#ef4444"}}>No se pudieron cargar los viajes.</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:2}}>La vista de trafico puede estar incompleta. Reintenta antes de asumir que no hay pedidos.</div>
          </div>
          <button onClick={cargar} style={{padding:"7px 12px",borderRadius:7,border:"1px solid rgba(239,68,68,.25)",background:"rgba(239,68,68,.10)",color:"#ef4444",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Reintentar
          </button>
        </div>
      )}

      {/* â”€â”€ Grid principal â”€â”€ */}
      <div className="tg-traffic-board" style={{ flex:1, overflowY:"auto", overflowX:"auto", display:vistaMain==="cuadrante"?"block":"none" }}>
        <table style={{ borderCollapse:"collapse", tableLayout:"fixed", minWidth: COL_VEH + COL_DAY*7 }}>
          <colgroup>
            <col style={{ width:COL_VEH }}/>
            {dias.map((_, i) => <col key={i} style={{ width:COL_DAY }}/>)}
          </colgroup>

          {/* â”€â”€ Header dÃ­as â”€â”€ */}
          <thead>
            <tr style={{ background:"var(--bg3)" }}>
              {/* Columna vehiculo */}
              <th style={{
                padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700,
                color:"var(--text5)", letterSpacing:".06em", textTransform:"uppercase",
                borderBottom:"2px solid var(--border)", borderRight:"1px solid var(--border)",
                position:"sticky", left:0, top:0, background:"var(--bg3)", zIndex:40,
              }}>
                VEHICULO
              </th>
              {dias.map((d, i) => {
                const dStr = d.toISOString().slice(0,10);
                const isToday = dStr === today;
                const n = countDia(d);
                return (
                  <th key={i} style={{
                    padding:"8px 10px", textAlign:"center",
                    borderBottom: `2px solid ${isToday ? "var(--accent-l)" : "var(--border)"}`,
                    borderRight:"1px solid var(--border2)",
                    background: isToday ? "rgba(59,130,246,.07)" : "var(--bg3)",
                    position:"sticky",
                    top:0,
                    zIndex:30,
                  }}>
                    <div style={{ fontSize:10, fontWeight:600, color:"var(--text5)", letterSpacing:".07em" }}>{DIA_NAMES[i]}</div>
                    <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:22, color: isToday ? "var(--accent-xl)" : "var(--text)", lineHeight:1.1 }}>{d.getDate()}</div>
                    <div style={{ fontSize:10, color:"var(--text5)", marginTop:1 }}>
                      {n > 0 ? `${n} viaje${n !== 1 ? "s" : ""}` : ""}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* â”€â”€ Filas de vehiculos â”€â”€ */}
          <tbody>
            {tractores.length === 0 && viajesSinAsignacion.length === 0 && Object.keys(colaboradoresSemana).length === 0 && !loading && (
              <tr>
                <td colSpan={8} style={{ padding:60, textAlign:"center", color:"var(--text5)", fontSize:13 }}>
                  Sin vehiculos. Anade vehiculos en el modulo Flota -> Vehiculos.
                </td>
              </tr>
            )}

            {viajesSinAsignacion.length > 0 && (
              <tr style={{ borderBottom:"1px solid var(--border)" }}>
                <td style={{
                  padding:"12px 14px", borderRight:"1px solid var(--border)",
                  verticalAlign:"top", background:"rgba(245,158,11,.08)",
                  position:"sticky", left:0, zIndex:5,
                  minWidth:COL_VEH, maxWidth:COL_VEH,
                }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15, color:"#f59e0b", marginBottom:4 }}>
                    Sin asignacion
                  </div>
                  <div style={{ fontSize:11, color:"var(--text4)", lineHeight:1.35 }}>
                    Pedidos pendientes de vehiculo, chofer o colaborador
                  </div>
                </td>
                {dias.map((d, i) => {
                  const dStr = d.toISOString().slice(0,10);
                  const isToday = dStr === today;
                  const trips = sortTripsByOperationalPriority(viajesSinAsignacion.filter(p => fechaPedido(p) === dStr));
                  return (
                    <td key={i} style={{
                      padding:"5px 5px",
                      verticalAlign:"top",
                      borderRight:"1px solid var(--border2)",
                      background: isToday ? "rgba(59,130,246,.03)" : "transparent",
                    }}>
                      {renderTripCards(trips, `ua:${dStr}`)}
                    </td>
                  );
                })}
              </tr>
            )}

            {vehiculos
              .filter(v => {
                // Only tractoras - exclude remolques by clase, matricula pattern, or conjunto assignment
                const clase = (v.clase || v.tipo || "").toLowerCase();
                const mat = (v.matricula||"").toUpperCase();
                const isRemolqueDeAlguien = vehiculos.some(t=>t.remolque_id===v.id);
                return !clase.includes("remolque") && !clase.includes("semirremolque") && 
                       !clase.includes("dolly") && !isRemolqueDeAlguien && 
                       !mat.startsWith("R-") && !mat.endsWith("-R");
              })
              .map(v => {
              const ev = EV[v.estado] || { label: v.estado || "-", color: "#4b5675" };
              const chofer = choferes.find(c => c.id === v.chofer_id || c.vehiculo_id === v.id);
              const posicion = v.ubicacion_actual || v.ultima_posicion || v.ubicacion || "";
              const itv = v.fecha_itv || v.itv_proxima || "";
              const itvDias = itv ? Math.ceil((new Date(itv) - new Date()) / 86400000) : null;

              return (
                <tr key={v.id} style={{ borderBottom:"1px solid var(--border)" }}>

                  {/* â”€â”€ Celda vehiculo (sticky) â”€â”€ */}
                  <td style={{
                    padding:"12px 14px", borderRight:"1px solid var(--border)",
                    verticalAlign:"top", background:"var(--bg2)",
                    position:"sticky", left:0, zIndex:5,
                    minWidth:COL_VEH, maxWidth:COL_VEH,
                  }}>
                    {/* MatrÃ­cula + estado */}
                    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:6, marginBottom:4 }}>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:800, fontSize:15, color:"var(--text)", letterSpacing:".03em" }}>
                        {v.matricula}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                        <span style={{
                          padding:"2px 9px", borderRadius:20, fontSize:10, fontWeight:700, whiteSpace:"nowrap",
                          background:`${ev.color}1a`, color:ev.color, border:`1px solid ${ev.color}35`,
                        }}>
                          {ev.label}
                        </span>
                        {/* Expand arrow - visual only */}
                        <span style={{ color:"var(--text5)", fontSize:12 }}>></span>
                      </div>
                    </div>

                    {/* Tipo - Marca */}
                    {(v.clase || v.marca || v.modelo) && (
                      <div style={{ fontSize:11, color:"var(--text4)", marginBottom:5 }}>
                        {[v.clase, v.marca, v.modelo].filter(Boolean).join(" - ")}
                      </div>
                    )}

                    {/* Chofer */}
                    {chofer && (
                      <div
                        title="Clic derecho o boton para copiar matriculas, chofer, telefono y DNI"
                        onContextMenu={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const ok = await copyTextToClipboard(buildChoferCopyData(chofer, v));
                          notify(ok ? "Datos del chofer copiados." : "No se pudieron copiar los datos del chofer.", ok ? "success" : "error");
                        }}
                        style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"var(--accent-xl)", marginBottom:3, cursor:"context-menu" }}
                      >
                        <span>CHOFER</span>
                        <span style={{ fontWeight:600 }}>{chofer.nombre} {chofer.apellidos||""}</span>
                        <button
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const ok = await copyTextToClipboard(buildChoferCopyData(chofer, v));
                            notify(ok ? "Datos del chofer copiados." : "No se pudieron copiar los datos del chofer.", ok ? "success" : "error");
                          }}
                          style={{marginLeft:"auto",padding:"2px 6px",borderRadius:5,border:"1px solid rgba(20,184,166,.25)",background:"rgba(20,184,166,.10)",color:"var(--accent-xl)",fontSize:10,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
                        >
                          Copiar
                        </button>
                      </div>
                    )}

                    {/* Conjunto (remolque asignado) */}
                    {v.remolque_matricula && (
                      <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#a78bfa", marginBottom:3 }}>
                        <span>ENLACE</span>
                        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
                          {v.matricula} + {v.remolque_matricula}
                        </span>
                      </div>
                    )}

                    {/* Posicion */}
                    {posicion && (
                      <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#f97316", marginBottom:3 }}>
                        <span>PUNTO</span>
                        <span>{posicion}</span>
                      </div>
                    )}

                    {/* ITV proxima */}
                    {itv && itvDias !== null && itvDias <= 30 && (
                      <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11,
                                    color: itvDias <= 0 ? "var(--red)" : "#f59e0b", marginBottom:3 }}>
                        <span>FECHA</span>
                        <span style={{ fontWeight:700 }}>{new Date(itv).toLocaleDateString("es-ES")}</span>
                        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9 }}>
                          ({itvDias <= 0 ? "VENCIDA" : `${itvDias}d`})
                        </span>
                      </div>
                    )}
                  </td>

                  {/* â”€â”€ Celdas de dÃ­as â”€â”€ */}
                  {dias.map((d, i) => {
                    const dStr = d.toISOString().slice(0,10);
                    const isToday = dStr === today;
                    const trips = getTrips(v.id, d);
                    const isDrop = dragOver?.vehiculo_id === v.id && dragOver?.fecha === dStr;

                    return (
                      <td key={i}
                        onDragOver={e => { e.preventDefault(); setDragOver({ vehiculo_id:v.id, fecha:dStr }); }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={e => handleDrop(e, v.id, d)}
                        style={{
                          padding:"5px 5px",
                          verticalAlign:"top",
                          borderRight:"1px solid var(--border2)",
                          minHeight:70,
                          background: isDrop
                            ? "rgba(59,130,246,.15)"
                            : isToday
                              ? "rgba(59,130,246,.03)"
                              : "transparent",
                          transition:"background .1s",
                        }}>
                        {(() => {
                          const llegadas = calcLlegadasEncadenadas(v.id, d);
                          return trips.map(p => (
                            <TripCard
                              key={p.id}
                              pedido={p}
                              llegada={llegadas[p.id]}
                              onClick={() => abrirViaje(p)}
                              conflictos={conflictosOperativosSemana[p.id] || []}
                              quickAction={getQuickActionForPedido(p)}
                              onQuickState={aplicarEstadoRapido}
                              disableQuickState={quickUpdatingId === String(p.id)}
                              onCopyNextWeek={pedidoTieneFacturaFinal(p) ? null : copiarPedido}
                              disableCopy={copyingPedidoId === String(p.id)}
                              onDelayRequest={pedidoTieneFacturaFinal(p) ? null : solicitarRetrasoPedido}
                              disableReschedule={reschedulingPedidoId === String(p.id)}
                              highlighted={String(focusContext?.pedido_id || "") === String(p.id)}
                              highlightLabel={focusContext?.source === "pedidos" ? "Desde pedidos" : "En foco"}
                              draggable={puedeEditar("pedidos") && !pedidoTieneFacturaFinal(p)}
                              onDragStart={startTripDrag}
                              onDragOverTrip={(e2) => { e2.preventDefault(); e2.dataTransfer.dropEffect = "move"; }}
                              onDropTrip={(e2, targetPedido) => reorderTripInCell(e2, v.id, d, targetPedido)}
                            />
                          ));
                        })()}
                        {puedeEditar("pedidos") && (
                          <button
                            type="button"
                            onClick={() => abrirAnadirViaje(v, d)}
                            style={{
                              width:"100%",
                              marginTop:trips.length ? 4 : 14,
                              padding:trips.length ? "4px 6px" : "9px 6px",
                              borderRadius:7,
                              border:"1px dashed var(--border2)",
                              background:trips.length ? "rgba(20,184,166,.06)" : "transparent",
                              color:trips.length ? "var(--accent-xl)" : "var(--text5)",
                              fontSize:trips.length ? 10 : 11,
                              fontWeight:800,
                              cursor:"pointer",
                              fontFamily:"'DM Sans',sans-serif",
                            }}
                          >
                            + Anadir viaje
                          </button>
                        )}
                        {trips.length === 0 && isDrop && (
                          <div style={{
                            border:"2px dashed var(--accent-l)", borderRadius:5,
                            padding:"10px 0", textAlign:"center",
                            fontSize:11, color:"var(--accent-l)",
                          }}>
                            Soltar aqui
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {Object.values(colaboradoresSemana).filter(g => g.viajes.some(pasaFiltrosOperativos)).map(g => (
              <tr key={`col_${g.id}`} style={{ borderBottom:"1px solid var(--border)" }}>
                <td style={{
                  padding:"12px 14px", borderRight:"1px solid var(--border)",
                  verticalAlign:"top", background:"rgba(14,165,233,.07)",
                  position:"sticky", left:0, zIndex:5,
                  minWidth:COL_VEH, maxWidth:COL_VEH,
                }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15, color:"#38bdf8", marginBottom:4 }}>
                    {g.nombre}
                  </div>
                  <div style={{ fontSize:11, color:"var(--text4)", lineHeight:1.35 }}>
                    Colaborador asignado
                  </div>
                  {(g.telefono || g.email) && (
                    <div style={{ fontSize:10, color:"var(--text5)", marginTop:5, lineHeight:1.35 }}>
                      {[g.telefono, g.email].filter(Boolean).join(" - ")}
                    </div>
                  )}
                </td>
                {dias.map((d, i) => {
                  const dStr = d.toISOString().slice(0,10);
                  const isToday = dStr === today;
                  const trips = g.viajes.filter(p => pasaFiltrosOperativos(p) && fechaPedido(p) === dStr);
                  return (
                    <td key={i} style={{
                      padding:"5px 5px",
                      verticalAlign:"top",
                      borderRight:"1px solid var(--border2)",
                      background: isToday ? "rgba(59,130,246,.03)" : "transparent",
                    }}>
                      {renderTripCards(trips, `col:${g.id}:${dStr}`)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* â”€â”€ Modal ediciÃ³n â”€â”€ */}
      {addTripCell && (
        <div
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.78)", zIndex:280, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
          onClick={e => e.target === e.currentTarget && !addTripSaving && setAddTripCell(null)}
        >
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:12, padding:18, width:"min(520px,96vw)", boxShadow:"0 24px 60px rgba(0,0,0,.35)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"flex-start", marginBottom:12 }}>
              <div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:900, color:"var(--text)" }}>Anadir viaje</div>
                <div style={{ fontSize:12, color:"var(--text4)", marginTop:3 }}>
                  {addTripCell.matricula || "Vehiculo"} - {new Date(`${addTripCell.fecha}T12:00:00`).toLocaleDateString("es-ES", { weekday:"long", day:"2-digit", month:"2-digit" })}
                </div>
              </div>
              <button onClick={() => setAddTripCell(null)} disabled={addTripSaving} style={{ border:"none", background:"transparent", color:"var(--text4)", fontSize:22, cursor:addTripSaving ? "not-allowed" : "pointer" }}>x</button>
            </div>

            {viajesYaCargadosEnCelda.length > 0 && (
              <div style={{ border:"1px solid rgba(20,184,166,.24)", background:"rgba(20,184,166,.07)", borderRadius:10, padding:10, marginBottom:12 }}>
                <div style={{ fontSize:10, fontWeight:900, textTransform:"uppercase", letterSpacing:".07em", color:"var(--accent-xl)", marginBottom:7 }}>
                  Viajes ya cargados en esta matricula
                </div>
                <div style={{ display:"grid", gap:7, maxHeight:150, overflowY:"auto", paddingRight:3 }}>
                  {viajesYaCargadosEnCelda.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setEditViaje(p);
                        setFocusContext({ pedido_id:p.id, fecha_carga:fechaPedido(p), source:"add_trip_cell" });
                        setAddTripCell(null);
                      }}
                      style={{
                        textAlign:"left",
                        border:"1px solid var(--border2)",
                        background:"var(--bg3)",
                        borderRadius:8,
                        padding:"8px 10px",
                        cursor:"pointer",
                        fontFamily:"'DM Sans',sans-serif",
                      }}
                    >
                      <div style={{ fontSize:12, fontWeight:900, color:"var(--text)" }}>{p.numero || "Pedido"} - {getPedidoClienteLabel(p)}</div>
                      <div style={{ fontSize:11, color:"var(--text4)", marginTop:2 }}>
                        {p.origen || "-"} - {p.destino || "-"}{p.estado ? ` - ${EC[p.estado]?.label || p.estado}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {viajesParaAnadir.length ? (
              <div style={{ display:"grid", gap:10 }}>
                <div>
                  <label style={{ display:"block", fontSize:10, fontWeight:900, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text5)", marginBottom:5 }}>Viaje existente</label>
                  <select value={addTripExistingId} onChange={e => setAddTripExistingId(e.target.value)} style={{ width:"100%", background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"9px 10px", borderRadius:8, fontFamily:"'DM Sans',sans-serif", fontSize:13 }}>
                    <option value="">Seleccionar viaje...</option>
                    {viajesParaAnadir.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.numero || "Pedido"} - {getPedidoClienteLabel(p)} - {p.origen || "-"} a {p.destino || "-"}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ maxHeight:210, overflowY:"auto", display:"grid", gap:7, paddingRight:3 }}>
                  {viajesParaAnadir.slice(0, 8).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setAddTripExistingId(p.id)}
                      style={{
                        textAlign:"left",
                        border:`1px solid ${String(addTripExistingId) === String(p.id) ? "rgba(20,184,166,.45)" : "var(--border2)"}`,
                        background:String(addTripExistingId) === String(p.id) ? "rgba(20,184,166,.10)" : "var(--bg3)",
                        borderRadius:8,
                        padding:"8px 10px",
                        cursor:"pointer",
                        fontFamily:"'DM Sans',sans-serif",
                      }}
                    >
                      <div style={{ fontSize:12, fontWeight:900, color:"var(--text)" }}>{p.numero || "Pedido"} - {getPedidoClienteLabel(p)}</div>
                      <div style={{ fontSize:11, color:"var(--text4)", marginTop:2 }}>{p.origen || "-"} - {p.destino || "-"}{fechaPedido(p) ? ` - ${fechaPedido(p)}` : ""}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ border:"1px dashed var(--border2)", borderRadius:10, padding:18, textAlign:"center", color:"var(--text4)", fontSize:12 }}>
                No hay viajes existentes que encajen con esta celda.
              </div>
            )}

            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:16, flexWrap:"wrap" }}>
              <button type="button" onClick={irACrearViajeDesdeCelda} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid rgba(59,130,246,.30)", background:"rgba(59,130,246,.12)", color:"#60a5fa", fontWeight:900, fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                Crear viaje nuevo
              </button>
              <button type="button" onClick={() => setAddTripCell(null)} disabled={addTripSaving} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid var(--border2)", background:"var(--bg4)", color:"var(--text3)", fontWeight:800, fontSize:12, cursor:addTripSaving ? "not-allowed" : "pointer", fontFamily:"'DM Sans',sans-serif" }}>
                Cancelar
              </button>
              <button type="button" onClick={asignarViajeExistenteACelda} disabled={addTripSaving || !addTripExistingId} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid rgba(20,184,166,.35)", background:addTripExistingId ? "var(--accent)" : "var(--bg4)", color:addTripExistingId ? "#fff" : "var(--text5)", fontWeight:900, fontSize:12, cursor:addTripSaving || !addTripExistingId ? "not-allowed" : "pointer", fontFamily:"'DM Sans',sans-serif", opacity:addTripSaving ? .7 : 1 }}>
                {addTripSaving ? "Anadiendo..." : "Anadir existente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editViaje && (
        <ModalViaje
          pedido={editViaje}
          pedidos={pedidos}
          vehiculos={vehiculos}
          choferes={choferes}
          rutas={rutas}
          focusContext={focusContext}
          resolveSuggestedAssignment={getSuggestedAssignment}
          onClearAssignment={limpiarAsignacionPedido}
          clearingAssignment={quickAssigningId === String(editViaje.id)}
          onClose={() => {
            setEditViaje(null);
            setFocusContext(null);
          }}
          onSaved={(savedPedido) => {
            if (savedPedido?.id) {
              syncPedidoLocal(savedPedido.id, savedPedido);
            }
            setEditViaje(null);
            setFocusContext(null);
            cargar();
          }}
          onReload={() => { cargar(); }}
          onFacturaDesvinculada={(pedidoId) => {
            syncPedidoLocal(pedidoId, { factura_id: null, factura_estado: null, factura_numero: null, facturado: false, _readonly: false });
          }}
        />
      )}

      {vistaMain==="grupajes" && <CuadranteCascada pedidos={pedidosGrupaje} vehiculos={vehiculos} choferes={choferes} allPedidos={pedidos}/>}
      {vistaMain==="optimizacion" && <OptimizacionRutas pedidos={pedidos} vehiculos={vehiculos} choferes={choferes} soloLecturaChofer={esModoChoferOptimizacion}/>}
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CUADRANTE EN CASCADA - Grupajes con drag & drop
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Simple distance estimator between Spanish cities (lat/lon approximation)
const CITY_COORDS = {
  "MADRID":[40.42,-3.70],"BARCELONA":[41.39,2.17],"VALENCIA":[39.47,-0.38],
  "SEVILLA":[37.39,-5.99],"ZARAGOZA":[41.65,-0.89],"BILBAO":[43.26,-2.93],
  "MALAGA":[36.72,-4.42],"ALICANTE":[38.35,-0.48],"CORDOBA":[37.89,-4.78],
  "GRANADA":[37.18,-3.60],"VALLADOLID":[41.65,-4.72],"MURCIA":[37.99,-1.13],
  "PALMA":[39.57,2.65],"VIGO":[42.23,-8.72],"GIJON":[43.54,-5.66],
  "TOLEDO":[39.86,-4.02],"BURGOS":[42.34,-3.70],"SALAMANCA":[40.97,-5.66],
  "ALBACETE":[38.99,-1.86],"LOGRONO":[42.47,-2.45],"SANTANDER":[43.46,-3.81],
  "PAMPLONA":[42.82,-1.64],"VITORIA":[42.85,-2.67],"SAN SEBASTIAN":[43.32,-1.98],
  "ALCOY":[38.70,-0.47],"ELCHE":[38.27,-0.70],"CARTAGENA":[37.60,-0.99],
  "JEREZ":[36.69,-6.14],"CADIZ":[36.53,-6.30],"HUELVA":[37.26,-6.95],
  "BADAJOZ":[38.88,-6.97],"CACERES":[39.47,-6.37],"SEGOVIA":[40.95,-4.12],
  "AVILA":[40.66,-4.69],"SORIA":[41.77,-2.47],"TERUEL":[40.34,-1.11],
  "CUENCA":[40.07,-2.14],"GUADALAJARA":[40.63,-3.17],"HUESCA":[42.14,-0.41],
  "LLEIDA":[41.61,0.63],"TARRAGONA":[41.12,1.25],"GIRONA":[41.98,2.82],
};

function getCityCoords(name) {
  if (!name) return null;
  const upper = name.toUpperCase().trim();
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (upper.includes(city) || city.includes(upper)) return coords;
  }
  return null;
}

function distKm([lat1,lon1], [lat2,lon2]) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function sortParadasByProximity(pedidos) {
  if (pedidos.length <= 1) return pedidos;
  // Greedy nearest-neighbor: start from first carga, alternate carga/descarga by proximity
  const paradas = [];
  pedidos.forEach(p => {
    paradas.push({ tipo:"carga",    ciudad:p.origen,  pedido:p, key:`c_${p.id}` });
    paradas.push({ tipo:"descarga", ciudad:p.destino, pedido:p, key:`d_${p.id}` });
  });

  // Sort: first all cargas by proximity to each other, then all descargas
  // Simple approach: sort cargas by proximity, keep carga-descarga pairs but order cargas by geography
  const cargas    = paradas.filter(p=>p.tipo==="carga");
  const descargas = paradas.filter(p=>p.tipo==="descarga");

  // Sort cargas greedily
  const sorted = [];
  let remaining = [...cargas];
  let lastCoords = null;

  while (remaining.length > 0) {
    let best = 0;
    if (lastCoords) {
      let minD = Infinity;
      const currentCoords = lastCoords;
      remaining.forEach((p, i) => {
        const coords = getCityCoords(p.ciudad);
        if (coords) {
          const d = distKm(currentCoords, coords);
          if (d < minD) { minD = d; best = i; }
        }
      });
    }
    const chosen = remaining.splice(best, 1)[0];
    sorted.push(chosen);
    lastCoords = getCityCoords(chosen.ciudad);
  }

  // After cargas, add descargas sorted by proximity to last carga
  let lastDCoords = lastCoords;
  let remDesc = [...descargas];
  while (remDesc.length > 0) {
    let best = 0;
    if (lastDCoords) {
      let minD = Infinity;
      const currentDCoords = lastDCoords;
      remDesc.forEach((p, i) => {
        const coords = getCityCoords(p.ciudad);
        if (coords) {
          const d = distKm(currentDCoords, coords);
          if (d < minD) { minD = d; best = i; }
        }
      });
    }
    const chosen = remDesc.splice(best, 1)[0];
    sorted.push(chosen);
    lastDCoords = getCityCoords(chosen.ciudad);
  }

  return sorted;
}

function CuadranteCascada({ pedidos, vehiculos, choferes, allPedidos }) {
  // Group pedidos by grupaje_id
  const byGrupaje = useMemo(() => {
    const grouped = {};
    pedidos.forEach(p => {
      const gid = p.grupaje_id ? `grupo:${p.grupaje_id}` : `pedido:${p.id}`;
      if (!grouped[gid]) grouped[gid] = [];
      grouped[gid].push(p);
    });
    return grouped;
  }, [pedidos]);

  const [paradasMap, setParadasMap] = useState(() => {
    // Initialize each grupaje with proximity-sorted paradas
    const m = {};
    Object.entries(byGrupaje).forEach(([gid, peds]) => {
      m[gid] = sortParadasByProximity(peds);
    });
    return m;
  });

  const [dragItem, setDragItem] = useState(null); // {gid, idx}

  // Update when pedidos change
  useEffect(() => {
    setParadasMap(prev => {
      const m = { ...prev };
      Object.entries(byGrupaje).forEach(([gid, peds]) => {
        if (!m[gid]) m[gid] = sortParadasByProximity(peds);
      });
      return m;
    });
  }, [byGrupaje]);

  function onDragStart(gid, idx) {
    setDragItem({ gid, idx });
  }

  function onDragOver(e, gid, idx) {
    e.preventDefault();
    if (!dragItem || dragItem.gid !== gid || dragItem.idx === idx) return;
    setParadasMap(prev => {
      const list = [...(prev[gid]||[])];
      const [removed] = list.splice(dragItem.idx, 1);
      list.splice(idx, 0, removed);
      setDragItem({ gid, idx });
      return { ...prev, [gid]: list };
    });
  }

  function onDragEnd() { setDragItem(null); }

  function resetOrder(gid) {
    const peds = byGrupaje[gid] || [];
    setParadasMap(prev => ({ ...prev, [gid]: sortParadasByProximity(peds) }));
  }

  if (Object.keys(byGrupaje).length === 0) {
    return (
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:"var(--text5)"}}>
        <div style={{width:22,height:22,borderRadius:6,background:"rgba(16,185,129,.12)",border:"1px solid rgba(16,185,129,.24)"}} />
        <div style={{fontWeight:700,fontSize:15,color:"var(--text)"}}>Sin grupajes activos en el cuadrante</div>
        <div style={{fontSize:12}}>Crea pedidos de tipo grupaje y aqui apareceran ordenados aunque sean de otra semana o sigan pendientes de agrupar.</div>
      </div>
    );
  }

  return (
    <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
      <div style={{marginBottom:12,fontSize:12,color:"var(--text5)"}}>
        Paradas ordenadas por proximidad geografica. Arrastra para reordenar.
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:20}}>
        {Object.entries(byGrupaje).map(([gid, peds]) => {
          const paradas = paradasMap[gid] || sortParadasByProximity(peds);
          // Find vehicle for this grupaje
          const primerPed = peds[0];
          const esGrupoReal = String(gid).startsWith("grupo:");
          const grupoLabel = esGrupoReal ? `Grupaje #${String(gid).replace("grupo:","")}` : `Pendiente de agrupar - ${primerPed?.numero || gid}`;
          const veh = vehiculos.find(v=>v.id===primerPed?.vehiculo_id);
          const chofer = choferes.find(c=>c.id===primerPed?.chofer_id);
          const kgTotal = peds.reduce((s,p)=>s+Number(p.peso_kg||0),0);
          const impTotal = peds.reduce((s,p)=>s+Number(p.importe||0),0);

          return (
            <div key={gid} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,overflow:"hidden"}}>
              {/* Header */}
              <div style={{background:"var(--bg3)",padding:"10px 16px",borderBottom:"1px solid var(--border2)",display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>
                  {grupoLabel}
                </span>
                {veh && <span style={{fontSize:12,color:"var(--accent)",fontWeight:700}}>{veh.matricula}</span>}
                {chofer && <span style={{fontSize:12,color:"var(--text4)"}}>{chofer.nombre}</span>}
                {esGrupoReal && <span style={{fontSize:10,fontWeight:900,color:"#34d399",border:"1px solid rgba(16,185,129,.28)",background:"rgba(16,185,129,.12)",borderRadius:999,padding:"2px 8px"}}>Carga completa</span>}
                <span style={{fontSize:11,color:"var(--text5)",marginLeft:4}}>{peds.length} pedido{peds.length!==1?"s":""} - {Number(kgTotal).toLocaleString("es-ES")} kg - {Number(impTotal).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR</span>
                <button onClick={()=>resetOrder(gid)}
                  style={{marginLeft:"auto",padding:"3px 10px",borderRadius:5,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text4)",fontSize:11,cursor:"pointer"}}>
                  Reordenar por proximidad
                </button>
              </div>

              {/* Paradas */}
              <div style={{padding:"8px 0"}}>
                {paradas.map((parada, idx) => {
                  const isCarga = parada.tipo === "carga";
                  const isDragging = dragItem?.gid===gid && dragItem?.idx===idx;
                  const coords = getCityCoords(parada.ciudad);

                  return (
                    <div key={parada.key}
                      draggable
                      onDragStart={()=>onDragStart(gid,idx)}
                      onDragOver={e=>onDragOver(e,gid,idx)}
                      onDragEnd={onDragEnd}
                      style={{
                        display:"flex",alignItems:"center",gap:10,
                        padding:"8px 16px",
                        background:isDragging?"rgba(59,130,246,.1)":"transparent",
                        borderBottom:"1px solid var(--border2)",
                        cursor:"grab",
                        opacity:isDragging?0.5:1,
                        transition:"background .15s",
                      }}>
                      {/* Drag handle */}
                      <span style={{color:"var(--text5)",fontSize:14,cursor:"grab",flexShrink:0}}>::</span>
                      {/* Step number */}
                      <span style={{
                        minWidth:24,height:24,borderRadius:"50%",
                        background:isCarga?"rgba(59,130,246,.15)":"rgba(16,185,129,.15)",
                        color:isCarga?"var(--accent)":"var(--green)",
                        fontSize:11,fontWeight:800,
                        display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0
                      }}>{idx+1}</span>
                      {/* Type badge */}
                      <span style={{
                        padding:"2px 8px",borderRadius:10,fontSize:11,fontWeight:700,flexShrink:0,
                        background:isCarga?"rgba(59,130,246,.12)":"rgba(16,185,129,.12)",
                        color:isCarga?"var(--accent)":"var(--green)"
                      }}>
                        {isCarga?"CARGA":"DESCARGA"}
                      </span>
                      {/* City */}
                      <span style={{fontWeight:700,fontSize:13,color:"var(--text)",flex:1}}>
                        {parada.ciudad||"-"}
                        {!coords&&<span style={{fontSize:10,color:"var(--text5)",fontWeight:400,marginLeft:6}}>(sin coord.)</span>}
                      </span>
                      {/* Pedido info */}
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:11,fontWeight:700,color:"var(--text3)"}}>{parada.pedido.numero}</div>
                        <div style={{fontSize:10,color:"var(--text5)"}}>
                          {parada.pedido.cliente_nombre||""}
                          {parada.pedido.peso_kg&&<span style={{marginLeft:4}}>{Number(parada.pedido.peso_kg).toLocaleString("es-ES")}kg</span>}
                        </div>
                        {isCarga&&parada.pedido.fecha_carga&&
                          <div style={{fontSize:10,color:"var(--text5)"}}>{new Date(parada.pedido.fecha_carga).toLocaleDateString("es-ES")}</div>}
                        {!isCarga&&parada.pedido.fecha_descarga&&
                          <div style={{fontSize:10,color:"var(--text5)"}}>{new Date(parada.pedido.fecha_descarga).toLocaleDateString("es-ES")}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

