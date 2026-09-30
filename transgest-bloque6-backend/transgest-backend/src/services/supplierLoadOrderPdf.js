const path = require("path");
const PDFDocument = require("pdfkit");

const FONT = path.join(__dirname, "../../assets/fonts/LiberationSans-Regular.ttf");
const FONT_BOLD = path.join(__dirname, "../../assets/fonts/LiberationSans-Bold.ttf");

function value(input) {
  return String(input ?? "").trim();
}

function dateLabel(input) {
  if (!input) return "Por confirmar";
  const iso = input instanceof Date ? input.toISOString().slice(0, 10) : value(input).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value(input);
}

function stops(input) {
  if (Array.isArray(input)) return input;
  try {
    const parsed = JSON.parse(value(input));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stopLines(input, fallback, fallbackDate, fallbackTime) {
  const entries = stops(input);
  return (entries.length ? entries : [{}]).map((stop, index) => {
    const name = value(stop.cliente_nombre || stop.nombre || stop.punto_nombre || (index === 0 ? fallback : ""));
    const address = value(stop.direccion || stop.direccion_completa || "");
    const location = [address && address !== name ? address : "", stop.codigo_postal || stop.cp, stop.poblacion || stop.ciudad, stop.provincia, stop.pais].map(value).filter(Boolean).join(", ");
    const when = [dateLabel(stop.fecha || (index === 0 ? fallbackDate : "")), value(stop.hora || (index === 0 ? fallbackTime : "")), value(stop.ventana)].filter(Boolean).join(" · ");
    return { name: name || "Por confirmar", location, when, reference: value(stop.referencia || stop.referencia_cliente) };
  });
}

async function buildSupplierLoadOrderPdf(pedido, { orderNumber, priceLabel, acceptedAt = new Date() } = {}) {
  const document = new PDFDocument({ size: "A4", margin: 42, info: {
    Title: `Orden de carga ${value(orderNumber || pedido.orden_carga_numero || pedido.numero)}`,
    Author: value(pedido.empresa_nombre || "TransGest"),
    Subject: "Orden de carga confirmada para colaborador",
    Creator: "TransGest",
  } });
  document.registerFont("regular", FONT);
  document.registerFont("bold", FONT_BOLD);
  const chunks = [];
  document.on("data", chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const dark = "#17352F", muted = "#526A62", accent = "#0F766E";
  const heading = (text) => {
    document.moveDown(0.8).font("bold").fontSize(11).fillColor(accent).text(text.toUpperCase());
    document.moveDown(0.25);
  };
  const row = (label, content) => {
    document.font("bold").fontSize(9).fillColor(muted).text(`${label}: `, { continued: true });
    document.font("regular").fillColor(dark).text(value(content) || "Por confirmar");
    document.moveDown(0.25);
  };
  document.font("bold").fontSize(19).fillColor(accent).text("ORDEN DE CARGA");
  document.font("regular").fontSize(10).fillColor(muted).text(`N.º ${value(orderNumber || pedido.orden_carga_numero || pedido.numero)} · Pedido ${value(pedido.numero)}`);
  document.moveDown(0.5).strokeColor("#D9E4E1").moveTo(42, document.y).lineTo(553, document.y).stroke();
  heading("Partes y aceptación");
  row("Empresa contratante", [pedido.empresa_nombre, pedido.empresa_cif].map(value).filter(Boolean).join(" · "));
  row("Colaborador", [pedido.colaborador_nombre, pedido.colaborador_cif].map(value).filter(Boolean).join(" · "));
  row("Aceptada", acceptedAt instanceof Date ? acceptedAt.toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : value(acceptedAt));
  row("Referencia de carga", pedido.referencia_cliente || pedido.referencia_carga || "");
  heading("Conjunto confirmado");
  row("Vehículo / tractora", pedido.matricula_colaborador);
  row("Remolque", pedido.remolque_matricula_colaborador || "No indicado");
  heading("Cargas");
  stopLines(pedido.puntos_carga, pedido.origen, pedido.fecha_carga, pedido.hora_carga).forEach((stop, index) => {
    row(`${index + 1}. Punto`, [stop.name, stop.location].filter(Boolean).join(" · "));
    row("Fecha y hora", stop.when);
    if (stop.reference) row("Referencia", stop.reference);
  });
  heading("Descargas");
  stopLines(pedido.puntos_descarga, pedido.destino, pedido.fecha_descarga || pedido.fecha_entrega, pedido.hora_descarga).forEach((stop, index) => {
    row(`${index + 1}. Punto`, [stop.name, stop.location].filter(Boolean).join(" · "));
    row("Fecha y hora", stop.when);
    if (stop.reference) row("Referencia", stop.reference);
  });
  heading("Mercancía y condiciones");
  row("Mercancía", pedido.mercancia || pedido.descripcion_carga);
  if (pedido.peso_kg != null) row("Peso previsto", `${Number(pedido.peso_kg).toLocaleString("es-ES")} kg`);
  if (pedido.bultos != null) row("Bultos / palés", pedido.bultos);
  row("Precio pactado con el colaborador, sin IVA", priceLabel);
  if (pedido.condiciones_adicionales) row("Condiciones adicionales", pedido.condiciones_adicionales);
  document.moveDown(0.8).font("regular").fontSize(8).fillColor(muted)
    .text("La carga real y sus posibles diferencias se confirmarán al finalizar la carga. Conserva esta orden junto con la documentación del transporte.");
  document.end();
  return finished;
}

module.exports = { buildSupplierLoadOrderPdf, stopLines };
