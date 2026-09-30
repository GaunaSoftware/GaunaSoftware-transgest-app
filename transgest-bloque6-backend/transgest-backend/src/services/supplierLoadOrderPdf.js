const path = require("path");
const PDFDocument = require("pdfkit");
const { formatCompanyPaymentTerms } = require("./companyPayment");

const FONT = path.join(__dirname, "../../assets/fonts/LiberationSans-Regular.ttf");
const FONT_BOLD = path.join(__dirname, "../../assets/fonts/LiberationSans-Bold.ttf");
const LEFT = 42;
const WIDTH = 511;
const COLOR = { ink: "#17352F", muted: "#526A62", teal: "#0F766E", line: "#D9E4E1", pale: "#F3F8F6" };
const value = input => String(input ?? "").trim();

function companyDataForSupplierOrder(pedido) {
  const cfg = pedido.empresa_cfg_precios && typeof pedido.empresa_cfg_precios === "object" ? pedido.empresa_cfg_precios : {};
  const perfil = cfg.empresa_perfil && typeof cfg.empresa_perfil === "object" ? cfg.empresa_perfil : cfg;
  // Mi Empresa alimentaba el PDF interno; se usa también para el correo.
  return {
    ...pedido,
    empresa_nombre: perfil.razon_social || perfil.nombre || pedido.empresa_nombre,
    empresa_cif: perfil.cif || perfil.nif || pedido.empresa_cif,
    empresa_direccion: perfil.domicilio || perfil.direccion || "",
    empresa_cp: perfil.cp || perfil.codigo_postal || "",
    empresa_ciudad: perfil.municipio || perfil.ciudad || "",
    empresa_provincia: perfil.provincia || "",
    empresa_pais: perfil.pais || "España",
    empresa_telefono: perfil.telefono || "",
    empresa_email: perfil.email || pedido.empresa_email,
    empresa_emails_albaranes: perfil.emails_albaranes || perfil.email || pedido.empresa_email,
    empresa_logo_mime: cfg.logo_mime || perfil.logo_mime || "image/png",
    empresa_perfil: perfil,
  };
}

function dateLabel(input) {
  if (!input) return "Por confirmar";
  const iso = input instanceof Date ? input.toISOString().slice(0, 10) : value(input).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value(input);
}
function stops(input) {
  if (Array.isArray(input)) return input;
  try { const parsed = JSON.parse(value(input)); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function mapsUrl(stop, fallback = "") {
  const supplied = value(stop.google_maps_url || stop.maps_url || fallback);
  if (/^https:\/\/(?:www\.)?(?:google\.[^/]+\/maps|maps\.google\.[^/]+\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/)/i.test(supplied)) return supplied;
  const lat = Number(stop.latitud ?? stop.lat), lon = Number(stop.longitud ?? stop.lng);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  }
  const address = [stop.direccion || stop.direccion_completa, stop.poblacion || stop.ciudad, stop.provincia, stop.pais].map(value).filter(Boolean).join(", ");
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "";
}
function stopLines(input, fallback, fallbackDate, fallbackTime, fallbackMaps = "") {
  const entries = stops(input);
  return (entries.length ? entries : [{}]).map((stop, index) => {
    const name = value(stop.cliente_nombre || stop.nombre || stop.punto_nombre || (index === 0 ? fallback : ""));
    const address = value(stop.direccion || stop.direccion_completa || "");
    return {
      name: name || "Por confirmar",
      location: [address && address !== name ? address : "", stop.codigo_postal || stop.cp, stop.poblacion || stop.ciudad, stop.provincia, stop.pais].map(value).filter(Boolean).join(", "),
      when: [dateLabel(stop.fecha || (index === 0 ? fallbackDate : "")), value(stop.hora || (index === 0 ? fallbackTime : "")), value(stop.ventana || [stop.ventana_inicio, stop.ventana_fin].filter(Boolean).join("–"))].filter(Boolean).join(" · "),
      reference: value(stop.referencia || stop.referencia_cliente),
      quantities: [stop.bultos ? `${stop.bultos} bultos` : "", stop.peso_kg ? `${stop.peso_kg} kg` : ""].filter(Boolean).join(" · "),
      notes: value(stop.notas),
      mapUrl: mapsUrl(stop, index === 0 ? fallbackMaps : ""),
    };
  });
}
function routeUrl(pedido) {
  const cargas = stopLines(pedido.puntos_carga, pedido.origen, pedido.fecha_carga, pedido.hora_carga);
  const descargas = stopLines(pedido.puntos_descarga, pedido.destino, pedido.fecha_descarga, pedido.hora_descarga);
  const places = [...cargas, ...descargas].map(stop => stop.location || stop.name).filter(place => place && place !== "Por confirmar");
  if (places.length < 2) return "";
  const params = new URLSearchParams({ api: "1", origin: places[0], destination: places[places.length - 1] });
  if (places.length > 2) params.set("waypoints", places.slice(1, -1).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Mismo contenido que la orden interna anterior, ahora en el PDF compartido.
const SUPPLIER_TERMS = [
  ["Aceptación", "La presente orden constituye un contrato de transporte de mercancías por carretera. Se considerará aceptada y vinculante salvo que el porteador comunique su rechazo expreso en el plazo de una hora desde la recepción de esta orden."],
  ["Prohibición de subcontratación", "Queda expresamente prohibida la subcontratación total o parcial del servicio sin autorización escrita previa del cargador. En caso de incumplimiento, el cargador quedará facultado para resolver el contrato, rechazar la factura emitida y no abonar cantidad alguna por el servicio, sin perjuicio de reclamar los daños y perjuicios causados. Cuando la subcontratación hubiera sido autorizada por escrito, el cargador podrá condicionar el pago de la factura del porteador a la acreditación documental del pago efectivo al subcontratista por los servicios objeto de autorización."],
  ["Estacionamiento y pernocta", "Solo podrá estacionarse o pernoctar en instalaciones cerradas con vigilancia presencial las 24 horas. Queda prohibido el estacionamiento en áreas de servicio, explanadas o vías públicas sin estas características. El incumplimiento trasladará al porteador la responsabilidad por cualquier daño, robo o pérdida producidos durante el estacionamiento no autorizado."],
  ["Cancelación de la orden", "El cargador podrá cancelar la presente orden de transporte sin coste ni penalización alguna dentro de las doce horas siguientes a su emisión, mediante comunicación escrita dirigida al porteador por cualquier medio que deje constancia de su recepción."],
  ["Ley aplicable y jurisdicción", "Queda expresamente excluida la sumisión a las Juntas Arbitrales del Transporte. Cualquier controversia derivada de la presente orden será resuelta exclusivamente ante la jurisdicción ordinaria."],
  ["Retención", "Queda prohibida la retención de la mercancía salvo en los casos expresamente autorizados por la ley."],
  ["Puntualidad", "La puntualidad en carga y descarga es esencial. Los retrasos no justificados pueden generar penalizaciones."],
  ["Contacto con clientes", "Queda expresamente prohibido el contacto directo con los clientes de la empresa contratante."],
  ["Documentación", "No se pagará la factura hasta recibir todos los documentos de transporte originales firmados por el destinatario (CMR o carta de porte y albarán) en máximo 48 h."],
  ["Mercancía", "El colaborador es responsable de la mercancía desde la carga hasta la entrega."],
];
const FUEL_TERM = "El precio pactado solo se ajustará por variación del combustible si el índice G de variación del precio medio del gasóleo publicado por la Administración entre la fecha de esta orden de carga y la fecha de carga efectiva de la mercancía es igual o superior al 5 %. El ajuste deberá reflejarse en la factura correspondiente al transporte ejecutado como concepto separado e identificado. No se admitirán ajustes en facturas rectificativas o posteriores emitidas fuera del ciclo de facturación habitual de las partes. Si el porteador hubiera percibido ayudas públicas que compensen total o parcialmente la variación del gasóleo, el índice G se calculará sobre el precio neto tras descontar dichas ayudas. El ajuste a la baja opera en las mismas condiciones cuando la variación sea favorable al cargador.";

function logoBuffer(pedido) {
  const raw = value(pedido.empresa_logo_base64).replace(/^data:image\/(?:png|jpeg|jpg);base64,/i, "");
  if (!raw || raw.length > 750000 || !/^[A-Za-z0-9+/=\s]+$/.test(raw)) return null;
  return Buffer.from(raw, "base64");
}
async function buildSupplierLoadOrderPdf(pedido, { orderNumber, priceLabel, acceptedAt = null } = {}) {
  const number = value(orderNumber || pedido.orden_carga_numero || pedido.numero);
  const document = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, info: {
    Title: `Orden de carga ${number}`, Author: value(pedido.empresa_nombre || "TransGest"),
    Subject: "Orden de carga para colaborador", Creator: "TransGest",
  } });
  document.registerFont("regular", FONT);
  document.registerFont("bold", FONT_BOLD);
  const chunks = [];
  document.on("data", chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const limit = () => document.page.height - 90;
  const ensure = height => { if (document.y + height > limit()) document.addPage(); };
  const textHeight = (content, size = 9, width = WIDTH) => document.font("regular").fontSize(size).heightOfString(value(content), { width, lineGap: 2 });
  const section = title => {
    ensure(44);
    document.moveDown(0.7).font("bold").fontSize(10).fillColor(COLOR.teal).text(title.toUpperCase());
    document.moveDown(0.2).strokeColor(COLOR.line).moveTo(LEFT, document.y).lineTo(LEFT + WIDTH, document.y).stroke();
    document.y += 8;
  };
  const line = (label, content) => {
    if (!value(content)) return;
    ensure(textHeight(`${label}: ${value(content)}`) + 5);
    document.font("bold").fontSize(9).fillColor(COLOR.muted).text(`${label}: `, { continued: true });
    document.font("regular").fillColor(COLOR.ink).text(value(content), { lineGap: 2 });
    document.y += 4;
  };
  const paragraph = (content, size = 8.5) => {
    if (!value(content)) return;
    ensure(Math.min(textHeight(content, size) + 8, limit() - 42));
    document.font("regular").fontSize(size).fillColor(COLOR.ink).text(value(content), { width: WIDTH, lineGap: 2 });
    document.y += 7;
  };
  const stopBlock = (stop, index, type) => {
    const lines = [stop.name, stop.location, stop.when, stop.reference && `Referencia: ${stop.reference}`, stop.quantities, stop.notes].filter(Boolean);
    const height = lines.reduce((sum, item) => sum + textHeight(item, 9, WIDTH - 24) + 3, 0) + (stop.mapUrl ? 16 : 0) + 32;
    ensure(height);
    const top = document.y;
    document.roundedRect(LEFT, top, WIDTH, height - 6, 6).fill(COLOR.pale);
    document.y = top + 10;
    document.font("bold").fontSize(9).fillColor(COLOR.teal).text(`${type} ${index + 1}`, LEFT + 12, document.y, { width: WIDTH - 24 });
    for (const [position, item] of lines.entries()) {
      document.font(position === 0 ? "bold" : "regular").fontSize(position === 0 ? 10 : 9).fillColor(COLOR.ink)
        .text(item, LEFT + 12, document.y + 3, { width: WIDTH - 24, lineGap: 2 });
    }
    if (stop.mapUrl) document.font("bold").fontSize(8.5).fillColor(COLOR.teal)
      .text("Abrir ubicación en Google Maps", LEFT + 12, document.y + 3, { link: stop.mapUrl, underline: true });
    document.y = Math.max(document.y + 10, top + height);
  };

  const logo = logoBuffer(pedido);
  if (logo) {
    try { document.image(logo, LEFT, 39, { fit: [112, 42] }); document.y = 86; }
    catch { document.y = 42; }
  }
  document.font("bold").fontSize(19).fillColor(COLOR.teal).text("ORDEN DE CARGA", LEFT, document.y);
  document.font("regular").fontSize(10).fillColor(COLOR.muted).text(`N.º ${number} · Pedido ${value(pedido.numero)}`);
  document.moveDown(0.5).strokeColor(COLOR.line).moveTo(LEFT, document.y).lineTo(LEFT + WIDTH, document.y).stroke();
  document.y += 5;

  section("Empresa y colaboración");
  line("Contratante", [pedido.empresa_nombre, pedido.empresa_cif].map(value).filter(Boolean).join(" · "));
  line("Domicilio", [pedido.empresa_direccion, pedido.empresa_cp, pedido.empresa_ciudad, pedido.empresa_provincia, pedido.empresa_pais].map(value).filter(Boolean).join(", "));
  line("Contacto", [pedido.empresa_telefono, pedido.empresa_email].map(value).filter(Boolean).join(" · "));
  line("Colaborador", [pedido.colaborador_nombre, pedido.colaborador_cif].map(value).filter(Boolean).join(" · "));
  line("Confirmación", acceptedAt ? new Date(acceptedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : "Pendiente de aceptación");
  line("Referencia de carga", pedido.referencia_cliente || pedido.referencia_carga);

  section("Conjunto confirmado");
  line("Vehículo / tractora", pedido.matricula_colaborador || "Por confirmar");
  line("Remolque", pedido.remolque_matricula_colaborador || "No indicado");
  section("Cargas");
  stopLines(pedido.puntos_carga, pedido.origen, pedido.fecha_carga, pedido.hora_carga, pedido.google_maps_carga).forEach((stop, index) => stopBlock(stop, index, "Carga"));
  section("Descargas");
  stopLines(pedido.puntos_descarga, pedido.destino, pedido.fecha_descarga || pedido.fecha_entrega, pedido.hora_descarga, pedido.google_maps_descarga).forEach((stop, index) => stopBlock(stop, index, "Descarga"));
  const itinerary = routeUrl(pedido);
  if (itinerary) {
    ensure(27);
    document.font("bold").fontSize(9).fillColor(COLOR.teal).text("Abrir ruta completa en Google Maps", { link: itinerary, underline: true });
    document.y += 4;
  }

  section("Mercancía y operativa");
  line("Mercancía", pedido.mercancia || pedido.descripcion_carga || "Por confirmar");
  if (pedido.peso_kg != null) line("Peso previsto", `${Number(pedido.peso_kg).toLocaleString("es-ES")} kg`);
  if (pedido.bultos != null) line("Bultos / palés", pedido.bultos);
  const modes = [pedido.carga_lateral && "Carga lateral", pedido.carga_trasera && "Carga trasera", pedido.carga_techo && "Techo",
    pedido.intercambio_palets ? "Con intercambio de palets" : "Sin intercambio de palets", pedido.requiere_cinchas && "Necesario llevar cinchas"].filter(Boolean);
  line("Instrucciones operativas", modes.join(" · "));
  if (pedido.notas) line("Instrucciones especiales", pedido.notas);
  if (Number(pedido.km_ruta) > 0) line("Distancia prevista", `${Number(pedido.km_ruta).toLocaleString("es-ES")} km`);

  ensure(82);
  section("Condiciones económicas");
  line("Precio pactado con el colaborador, sin IVA", priceLabel || "Por confirmar");
  line("Forma de pago", formatCompanyPaymentTerms(pedido.empresa_perfil || {}, "colaboradores"));
  section("Condiciones para el colaborador");
  for (const [title, content] of SUPPLIER_TERMS) paragraph(`${title}: ${content}`);
  paragraph(`Facturación: las facturas deben emitirse a ${value(pedido.empresa_nombre) || "la empresa contratante"} · CIF/NIF: ${value(pedido.empresa_cif) || "pendiente de configurar"}.`);
  section("Envío de albaranes");
  line("Correo para documentos firmados", pedido.empresa_emails_albaranes || "Pendiente de configurar en Mi Empresa");
  line("Originales por correo postal", [pedido.empresa_direccion, pedido.empresa_cp, pedido.empresa_ciudad, pedido.empresa_provincia, pedido.empresa_pais].map(value).filter(Boolean).join(", ") || "Dirección pendiente de configurar en Mi Empresa");
  if (pedido.condiciones_adicionales) { section("Condiciones adicionales"); paragraph(pedido.condiciones_adicionales); }
  section("Cláusula de revisión del combustible");
  paragraph(FUEL_TERM);
  section("Firmas");
  paragraph(`Colaborador: ${value(pedido.colaborador_nombre) || "________________"}     ·     Empresa: ${value(pedido.empresa_nombre) || "________________"}     ·     Destinatario: ${value(pedido.destino) || "________________"}`);

  const pages = document.bufferedPageRange().count;
  for (let index = 0; index < pages; index++) {
    document.switchToPage(index);
    document.strokeColor(COLOR.line).moveTo(LEFT, document.page.height - 71).lineTo(LEFT + WIDTH, document.page.height - 71).stroke();
    document.font("regular").fontSize(8).fillColor(COLOR.muted)
      .text(`Orden ${number} · ${value(pedido.numero)}                                      Página ${index + 1} de ${pages}`, LEFT, document.page.height - 65, { width: WIDTH, lineBreak: false });
  }
  document.end();
  return finished;
}

module.exports = { buildSupplierLoadOrderPdf, companyDataForSupplierOrder, stopLines };
