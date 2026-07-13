const crypto = require("crypto");

const DOC_CONTROL_DEFAULTS = {
  habilitado: true,
  sistema: "qr_url", // codigo_numerico | qr_url
  dominio_url: "",
  dominio_comunicado: false,
  usar_orden_carga_como_soporte: true,
  observaciones: "",
};

const CMR_EU_COUNTRY_TERMS = [
  "alemania", "austria", "belgica", "bulgaria", "chipre", "croacia", "dinamarca", "eslovaquia",
  "eslovenia", "estonia", "finlandia", "francia", "grecia", "hungria", "irlanda", "italia",
  "letonia", "lituania", "luxemburgo", "malta", "paises bajos", "polonia", "portugal",
  "republica checa", "rumania", "suecia",
  "germany", "austria", "belgium", "bulgaria", "cyprus", "croatia", "denmark", "slovakia",
  "slovenia", "estonia", "finland", "france", "greece", "hungary", "ireland", "italy",
  "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland", "portugal",
  "czech republic", "romania", "sweden",
];

const CMR_UK_COUNTRY_TERMS = [
  "reino unido", "inglaterra", "escocia", "gales", "irlanda del norte",
  "united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "great britain",
];

const CMR_EU_UK_COUNTRY_TERMS = [...CMR_EU_COUNTRY_TERMS, ...CMR_UK_COUNTRY_TERMS];

function normalizeDocumentoControlConfig(raw = {}) {
  return {
    ...DOC_CONTROL_DEFAULTS,
    ...(raw && typeof raw === "object" ? raw : {}),
    dominio_comunicado: Boolean(raw?.dominio_comunicado),
    usar_orden_carga_como_soporte: raw?.usar_orden_carga_como_soporte !== false,
  };
}

function parseStops(raw) {
  if (!raw) return [];
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

function firstStopInfo(stops = [], fallbackName = "") {
  const stop = Array.isArray(stops) ? stops[0] || {} : {};
  return {
    nombre: stop.nombre || stop.name || fallbackName || "",
    direccion: stop.direccion || stop.address || stop.nombre || stop.name || fallbackName || "",
    cliente_nombre: stop.cliente_nombre || stop.clienteNombre || "",
    fecha: stop.fecha_carga || stop.fecha_descarga || stop.fecha || "",
    hora: stop.hora_carga || stop.hora_descarga || stop.hora || "",
    ventana: stop.ventana || "",
    google_maps_url: stop.google_maps_url || stop.maps_url || "",
    provincia: stop.provincia || stop.region || "",
    pais: stop.pais || stop.country || "",
    referencia: stop.referencia || stop.referencia_cliente || stop.ref || stop.albaran || stop.numero_albaran || "",
  };
}

function normalizeStopList(stops = [], fallback = {}) {
  return (Array.isArray(stops) ? stops : []).map((stop, index) => ({
    orden: index + 1,
    nombre: stop.nombre || stop.name || stop.cliente_nombre || "",
    direccion: stop.direccion || stop.address || stop.nombre || stop.name || "",
    fecha: stop.fecha_carga || stop.fecha_descarga || stop.fecha || fallback.fecha || "",
    hora: stop.hora_carga || stop.hora_descarga || stop.hora || fallback.hora || "",
    ventana: stop.ventana || fallback.ventana || "",
    google_maps_url: stop.google_maps_url || stop.maps_url || "",
    provincia: stop.provincia || stop.region || fallback.provincia || "",
    pais: stop.pais || stop.country || fallback.pais || "",
    referencia: stop.referencia || stop.referencia_cliente || stop.ref || "",
  })).filter(stop => stop.direccion || stop.nombre);
}

function companyName(empresa = {}) {
  return empresa?.razon_social || empresa?.nombre || "";
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function hasEmail(value) {
  const raw = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

function buildReadiness(checks = []) {
  const required = checks.filter(check => check.required !== false);
  const optional = checks.filter(check => check.required === false);
  const requiredOk = required.filter(check => check.ok).length;
  const optionalOk = optional.filter(check => check.ok).length;
  const totalWeight = (required.length * 2) + optional.length;
  const okWeight = (requiredOk * 2) + optionalOk;
  const score = totalWeight ? Math.round((okWeight / totalWeight) * 100) : 100;
  const byCategory = checks.reduce((acc, check) => {
    const key = check.category || "general";
    if (!acc[key]) acc[key] = { total: 0, ok: 0, faltantes: [] };
    acc[key].total += 1;
    if (check.ok) acc[key].ok += 1;
    else acc[key].faltantes.push(check.label);
    return acc;
  }, {});
  return { score, required_ok: requiredOk, required_total: required.length, optional_ok: optionalOk, optional_total: optional.length, by_category: byCategory };
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
  return `Transferencia ${plazo || 60} dias fecha recepcion factura${dias ? `; pago dias ${dias}` : ""}`;
}

function cleanCmrOptionalField(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = normalizeSearchText(raw);
  const paymentOnly = [
    "transferencia",
    "fecha factura",
    "recepcion factura",
    "dias fecha",
    "forma pago",
    "forma de pago",
    "vencimiento",
  ].some(term => normalized.includes(term));
  return paymentOnly ? "" : raw;
}

function formatStopReference(stop = {}) {
  return String(stop?.referencia || stop?.referencia_cliente || stop?.ref || stop?.albaran || stop?.numero_albaran || "").trim();
}

function buildGoodsMarksAndReferences(pedido = {}, cargas = [], descargas = []) {
  const refs = [];
  const add = (value) => {
    const raw = String(value || "").trim();
    if (raw && !refs.includes(raw)) refs.push(raw);
  };
  [...(Array.isArray(cargas) ? cargas : []), ...(Array.isArray(descargas) ? descargas : [])].forEach(stop => {
    add(stop?.referencia);
    add(stop?.referencia_cliente);
    add(stop?.ref);
    add(stop?.albaran);
    add(stop?.numero_albaran);
  });
  add(pedido?.referencia_cliente);
  add(pedido?.albaran_numero);
  return refs.slice(0, 6).join(" | ");
}

function buildOperativaCargaLabels(pedido = {}) {
  const labels = [];
  if (pedido?.carga_lateral) labels.push("Carga lateral");
  if (pedido?.carga_trasera) labels.push("Carga trasera");
  labels.push(pedido?.intercambio_palets ? "Con intercambio de palets" : "Sin intercambio de palets");
  if (pedido?.requiere_cinchas) labels.push("Necesario llevar cinchas para sujetar la mercancia");
  return labels;
}

function detectWasteSignals(pedido = {}) {
  const text = normalizeSearchText([
    pedido?.origen,
    pedido?.destino,
    pedido?.mercancia,
    pedido?.descripcion_carga,
    pedido?.notas,
    pedido?.condiciones_adicionales,
    pedido?.referencia_cliente,
  ].filter(Boolean).join(" "));
  const terms = [
    "residuo",
    "residuos",
    "waste",
    "annex vii",
    "annex 7",
    "anexo vii",
    "diwass",
    "ler ",
    "codigo ler",
  ];
  const detectedTerms = terms.filter(term => text.includes(term));
  const crossBorderHints = CMR_EU_UK_COUNTRY_TERMS.filter(term => text.includes(term));
  return {
    detected: detectedTerms.length > 0,
    detected_terms: detectedTerms,
    cross_border_hint: crossBorderHints.length > 0,
    cross_border_terms: crossBorderHints,
  };
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function detectTerms(text, terms = []) {
  return terms.filter(term => text.includes(term));
}

function detectTransportComplianceSignals(pedido = {}) {
  const text = normalizeSearchText([
    pedido?.origen,
    pedido?.destino,
    pedido?.origen_pais,
    pedido?.destino_pais,
    pedido?.origen_provincia,
    pedido?.destino_provincia,
    pedido?.cmr_tipo,
    pedido?.mercancia,
    pedido?.descripcion_carga,
    pedido?.notas,
    pedido?.condiciones_adicionales,
    pedido?.referencia_cliente,
  ].filter(Boolean).join(" "));
  const adrTerms = detectTerms(text, [
    "adr",
    "mercancia peligrosa",
    "mercancias peligrosas",
    "numero onu",
    "onu ",
    "inflamable",
    "corrosivo",
    "toxico",
    "explosivo",
  ]);
  const zbeTerms = detectTerms(text, [
    "madrid",
    "barcelona",
    "valencia",
    "sevilla",
    "bilbao",
    "zaragoza",
    "malaga",
    "alicante",
    "palma",
    "vigo",
    "valladolid",
    "pamplona",
  ]);
  const internationalTerms = detectTerms(text, [
    ...CMR_EU_UK_COUNTRY_TERMS,
    "andorra",
    "marruecos",
    "morocco",
  ]);
  const cabotageTerms = detectTerms(text, [
    "cabotaje",
    "cabotage",
    "servicio interior",
    "transporte interior",
    "segunda descarga",
    "retorno nacional",
  ]);
  const pesoKg = Number(pedido?.peso_kg || pedido?.kg || 0);
  const internacional = internationalTerms.length > 0;
  const colaborador = !!pedido?.colaborador_id || !!pedido?.colaborador_nombre;
  const tacografoRevision = internacional || cabotageTerms.length > 0 || (pesoKg >= 2500 && pesoKg <= 3500 && internacional);
  const avisos = [];
  if (adrTerms.length) avisos.push("Revisar ADR, documentacion del conductor/vehiculo y restricciones de carga antes de confirmar.");
  if (zbeTerms.length) avisos.push("Revisar restricciones urbanas/ZBE, accesos y ventanas locales de carga/descarga.");
  if (internacional) avisos.push("Revisar documentacion internacional, eCMR/eFTI y datos maestros de todas las partes.");
  if (colaborador && (internacional || cabotageTerms.length)) avisos.push("Revisar cabotaje/subcontratacion y condiciones del carrier antes de asignar.");
  if (tacografoRevision) avisos.push("Confirmar disponibilidad de tacografo/horas y descansos antes de iniciar el servicio.");

  return {
    adr: {
      requiere_revision: adrTerms.length > 0,
      terminos_detectados: adrTerms,
      accion: adrTerms.length ? "Validar ADR, autorizaciones y documentacion antes de expedir." : "Sin senal automatica ADR.",
    },
    zbe: {
      requiere_revision: zbeTerms.length > 0,
      zonas_detectadas: Array.from(new Set(zbeTerms)),
      accion: zbeTerms.length ? "Comprobar ZBE/accesos locales y etiqueta ambiental del vehiculo." : "Sin senal automatica ZBE.",
    },
    internacional: {
      requiere_revision: internacional,
      terminos_detectados: internationalTerms,
      accion: internacional ? "Preparar eCMR/eFTI, datos maestros y soporte documental internacional." : "Sin senal automatica internacional.",
    },
    cabotaje: {
      requiere_revision: colaborador && (internacional || cabotageTerms.length > 0),
      terminos_detectados: cabotageTerms,
      accion: colaborador && (internacional || cabotageTerms.length > 0)
        ? "Revisar reglas de cabotaje/subcontratacion y conservar evidencia operativa."
        : "Sin senal automatica de cabotaje.",
    },
    tacografo: {
      requiere_revision: tacografoRevision,
      motivo: tacografoRevision ? "Servicio internacional/cabotaje o indicio de vehiculo ligero regulado." : "Sin senal automatica adicional.",
      accion: tacografoRevision ? "Comprobar tacografo, horas disponibles y descansos antes de planificar." : "Validacion ordinaria de horas si aplica.",
    },
    avisos,
  };
}

function isSpainLike(value = "") {
  const norm = normalizeSearchText(value);
  return !norm || ["espana", "spain", "es"].includes(norm);
}

function isEuCmrCountry(value = "") {
  return CMR_EU_COUNTRY_TERMS.includes(normalizeSearchText(value));
}

function isEuOrUkCmrCountry(value = "") {
  const normalized = normalizeSearchText(value);
  return CMR_EU_UK_COUNTRY_TERMS.includes(normalized);
}

function shouldUseInternationalCmr(origenPais = "España", destinoPais = "España") {
  return [origenPais, destinoPais].some(country => !isSpainLike(country) && isEuOrUkCmrCountry(country));
}

function documentIsInternational(documento = {}) {
  const explicit = normalizeSearchText(documento.cmr_tipo || documento.tipo_cmr || "");
  if (explicit === "internacional") return true;
  if (explicit === "nacional") return false;
  return shouldUseInternationalCmr(documento.origen?.pais || "España", documento.destino?.pais || "España");
}

function buildCodigoControl({ empresaId, pedidoId }) {
  return crypto.createHash("sha1").update(`${empresaId}:${pedidoId}`).digest("hex").slice(0, 12).toUpperCase();
}

function currentDocumentSecret() {
  return process.env.DOC_CONTROL_SECRET || process.env.JWT_SECRET || "transgest-doc-control";
}

function documentVerificationSecrets() {
  return [...new Set([
    currentDocumentSecret(),
    process.env.DOC_CONTROL_LEGACY_SECRET,
  ].map(value => String(value || "").trim()).filter(Boolean))];
}

function buildPublicToken({ empresaId, pedidoId, secret = currentDocumentSecret() }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${empresaId}:${pedidoId}`)
    .digest("hex");
}

function buildLegacyPublicToken({ empresaId, pedidoId, secret = currentDocumentSecret() }) {
  return crypto.createHash("sha256").update(`${empresaId}:${pedidoId}:${secret}`).digest("hex");
}

function buildPublicVerificationCode({ empresaId, pedidoId, secret = currentDocumentSecret() }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`verify:${empresaId}:${pedidoId}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

function safeTokenEqual(expectedHex, receivedToken) {
  const expected = Buffer.from(String(expectedHex || ""), "hex");
  const received = Buffer.from(String(receivedToken || ""), "hex");
  return expected.length > 0 && expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function safeTextEqual(expected, received) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(received || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyPublicToken({ empresaId, pedidoId, token }) {
  if (!token) return false;
  return documentVerificationSecrets().some(secret => (
    safeTokenEqual(buildPublicToken({ empresaId, pedidoId, secret }), token) ||
    safeTokenEqual(buildLegacyPublicToken({ empresaId, pedidoId, secret }), token)
  ));
}

function verifyPublicVerificationCode({ empresaId, pedidoId, code }) {
  if (!code) return true;
  return documentVerificationSecrets().some(secret => safeTextEqual(
    buildPublicVerificationCode({ empresaId, pedidoId, secret }),
    String(code).trim().toUpperCase()
  ));
}

function isLocalhostBase(value) {
  try {
    const url = new URL(String(value || ""));
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function looksLikeFrontendAppHost(value) {
  try {
    const url = new URL(String(value || ""));
    return /^app\./i.test(url.hostname) || /vercel\.app$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function buildPublicUrl({ empresaId, pedidoId, config, appBaseUrl }) {
  const cfg = normalizeDocumentoControlConfig(config);
  const configuredBase = String(cfg.dominio_url || "").trim();
  const runtimeBase = String(appBaseUrl || "").trim();
  const configuredLooksFrontend = configuredBase && runtimeBase && looksLikeFrontendAppHost(configuredBase) && !looksLikeFrontendAppHost(runtimeBase);
  const baseSource = configuredBase && !configuredLooksFrontend && !(isLocalhostBase(configuredBase) && runtimeBase && !isLocalhostBase(runtimeBase))
    ? configuredBase
    : runtimeBase;
  const base = String(baseSource || "").trim().replace(/\/$/, "");
  if (!base) return "";
  const token = buildPublicToken({ empresaId, pedidoId });
  const verify = buildPublicVerificationCode({ empresaId, pedidoId });
  return `${base}/api/v1/pedidos/public/documento-control/${empresaId}/${pedidoId}?token=${token}&verify=${verify}`;
}

function sanitizeFilenamePart(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildDocumentoControlFilename(documento = {}) {
  const ref = sanitizeFilenamePart(documento?.referencia_pedido || "pedido");
  const code = sanitizeFilenamePart(documento?.codigo_control || "control");
  return `deca-${ref}-${code}.pdf`;
}

function buildDocumentoControlExportFilename(documento = {}) {
  const ref = sanitizeFilenamePart(documento?.referencia_pedido || "pedido");
  const code = sanitizeFilenamePart(documento?.codigo_control || "control");
  return `deca-efti-ecmr-${ref}-${code}.json`;
}

function buildDocumentoControlSignaturePackageFilename(documento = {}) {
  const ref = sanitizeFilenamePart(documento?.referencia_pedido || "pedido");
  const code = sanitizeFilenamePart(documento?.codigo_control || "control");
  return `deca-firma-eidas-${ref}-${code}.json`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function docFieldOk(value) {
  return String(value || "").trim().length > 0;
}

function buildEcmrConsignmentNote(documento = {}) {
  const internacional = documentIsInternational(documento);
  const requiredFields = [
    { key: "sender", label: "Remitente/cargador", ok: docFieldOk(documento.cargador_contractual?.nombre) },
    { key: "sender_id", label: "NIF/VAT del remitente", ok: docFieldOk(documento.cargador_contractual?.nif) },
    { key: "carrier", label: "Transportista", ok: docFieldOk(documento.transportista_efectivo?.nombre) },
    { key: "carrier_id", label: "NIF/VAT del transportista", ok: docFieldOk(documento.transportista_efectivo?.nif) },
    { key: "consignee", label: "Destinatario", ok: docFieldOk(documento.destino?.destinatario || documento.destino?.nombre) },
    { key: "taking_over_place", label: "Lugar de carga", ok: docFieldOk(documento.origen?.direccion) },
    { key: "delivery_place", label: "Lugar de entrega", ok: docFieldOk(documento.destino?.direccion) },
    { key: "date", label: "Fecha de transporte", ok: docFieldOk(documento.fecha_transporte) },
    { key: "goods", label: "Naturaleza de la mercancia", ok: docFieldOk(documento.mercancia?.descripcion) },
    { key: "weight", label: "Peso/cantidad", ok: !!documento.mercancia?.peso_kg },
    { key: "vehicle", label: "Matricula tractora", ok: docFieldOk(documento.vehiculo?.tractora) },
  ];
  if (internacional) {
    requiredFields.push(
      { key: "origin_country", label: "Pais de carga", ok: docFieldOk(documento.origen?.pais) },
      { key: "destination_country", label: "Pais de entrega", ok: docFieldOk(documento.destino?.pais) },
      { key: "cmr_statement", label: "Clausula de sometimiento CMR", ok: true },
      { key: "electronic_integrity", label: "Integridad electronica y trazabilidad", ok: docFieldOk(documento.verificacion?.codigo_verificacion) },
    );
  }
  const faltantes = requiredFields.filter(f => !f.ok).map(f => f.label);
  return {
    profile: internacional ? "eCMR-internacional-preparado" : "eCMR-nacional-preparado",
    tipo: internacional ? "internacional" : "nacional",
    certified_provider_connected: false,
    status: faltantes.length ? "incompleto" : "preparado_para_firma_y_proveedor",
    nota: internacional
      ? "CMR electronico internacional preparatorio. Requiere acuerdo de partes, autenticidad, integridad, firmas/evidencias y, para interoperabilidad oficial, proveedor o plataforma aplicable."
      : "Carta de porte electronica preparatoria. La validez avanzada requiere acuerdo de partes, firma/evidencia y proveedor o plataforma aplicable cuando proceda.",
    legal_basis: internacional ? {
      convention: "CMR 1956",
      electronic_protocol: "Protocolo adicional e-CMR 2008",
      operational_scope: "Union Europea y Reino Unido/Inglaterra",
      minimum_controls: [
        "Identificacion de remitente, transportista y destinatario",
        "Lugar y fecha de toma de cargo y entrega",
        "Naturaleza de la mercancia, bultos/peso y referencias",
        "Autenticidad de partes e integridad del documento electronico",
        "Historial de modificaciones y disponibilidad durante el transporte",
      ],
    } : {
      convention: "Carta de porte / documento de control nacional",
      electronic_protocol: "Preparacion digital interna",
    },
    required_fields: requiredFields,
    missing_fields: faltantes,
    consignment: {
      sender: documento.cargador_contractual || {},
      carrier: documento.transportista_efectivo || {},
      consignee: {
        nombre: documento.destino?.destinatario || documento.destino?.nombre || "",
        direccion: documento.destino?.direccion || "",
      },
      taking_over: {
        place: documento.origen?.direccion || "",
        country: documento.origen?.pais || "",
        region: documento.origen?.provincia || "",
        date: documento.horarios?.fecha_carga || documento.fecha_transporte || "",
        time_window: documento.horarios?.hora_carga || documento.horarios?.ventana_carga || "",
      },
      delivery: {
        place: documento.destino?.direccion || "",
        country: documento.destino?.pais || "",
        region: documento.destino?.provincia || "",
        date: documento.horarios?.fecha_descarga || "",
        time_window: documento.horarios?.hora_descarga || documento.horarios?.ventana_descarga || "",
      },
      goods: documento.mercancia || {},
      vehicle: documento.vehiculo || {},
      references: {
        codigo_control: documento.codigo_control || "",
        referencia_pedido: documento.referencia_pedido || "",
        verification_code: documento.verificacion?.codigo_verificacion || "",
      },
      electronic_evidence: {
        integrity_algorithm: documento.verificacion?.algoritmo || "HMAC-SHA256",
        secure_url: documento.verificacion?.url_segura || "",
        noindex: documento.verificacion?.noindex !== false,
        modification_history_required: true,
      },
    },
  };
}

function classifyTransportDoc(doc = {}) {
  const text = normalizeSearchText([doc.tipo, doc.nombre, doc.notas].filter(Boolean).join(" "));
  if (text.includes("cmr") || text.includes("carta porte") || text.includes("carta de porte")) return "cmr";
  if (text.includes("pod") || text.includes("proof of delivery") || text.includes("entrega")) return "pod";
  if (text.includes("albar")) return "albaran";
  if (text.includes("pesaje") || text.includes("peso")) return "pesaje";
  if (text.includes("foto")) return "foto";
  return "otro";
}

function summarizeDocumentosTransporte(documentos = []) {
  const items = (Array.isArray(documentos) ? documentos : []).map(doc => ({
    id: doc.id || "",
    nombre: doc.nombre || "",
    tipo: doc.tipo || "",
    clase: classifyTransportDoc(doc),
    mime: doc.file_mime || doc.mime || "",
    size_kb: Number(doc.file_size_kb || 0),
    created_at: doc.created_at || null,
  }));
  const counts = items.reduce((acc, item) => {
    acc[item.clase] = (acc[item.clase] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { total: 0, albaran: 0, pod: 0, cmr: 0, pesaje: 0, foto: 0, otro: 0 });
  return { counts, items };
}

function summarizeDocumentControlEvents(eventos = []) {
  const items = (Array.isArray(eventos) ? eventos : []).map(ev => ({
    tipo: ev.tipo || "",
    created_at: ev.created_at || null,
    actor_tipo: ev.actor_tipo || "",
    detalle: ev.detalle && typeof ev.detalle === "object" ? ev.detalle : {},
  }));
  const findLast = (prefix) => items.find(ev => String(ev.tipo || "").startsWith(prefix)) || null;
  return {
    total: items.length,
    remitido: items.filter(ev => ev.tipo === "documento_control.remitido").length,
    consultado: items.filter(ev => ["documento_control.consultado", "documento_control.abierto"].includes(ev.tipo)).length,
    descargado: items.filter(ev => ev.tipo === "documento_control.descargado").length,
    impreso: items.filter(ev => ev.tipo === "documento_control.impreso").length,
    firma: items.filter(ev => String(ev.tipo || "").startsWith("firma.")).length,
    last_documento_control: findLast("documento_control."),
    last_firma: findLast("firma."),
    items: items.slice(0, 25),
  };
}

function buildDocumentoControlExpediente(payload = {}, options = {}) {
  const documento = payload.documento || {};
  const status = payload.status || {};
  const docs = summarizeDocumentosTransporte(options.documentos || []);
  const eventos = summarizeDocumentControlEvents(options.eventos || []);
  const firma = options.firma || {};
  const postFirma = options.postSignatureIntegrity || {};
  const ecmr = buildEcmrConsignmentNote(documento);
  const hasPod = (docs.counts.albaran || 0) + (docs.counts.pod || 0) + (docs.counts.cmr || 0) > 0;
  const checks = [
    { key: "dcd_ready", label: "DCD listo", ok: !!status.ready, required: true },
    { key: "support_url", label: "Soporte tokenizado disponible", ok: docFieldOk(documento.soporte_url), required: true },
    { key: "verification_code", label: "Codigo de verificacion", ok: docFieldOk(documento.verificacion?.codigo_verificacion), required: true },
    { key: "ecmr_ready", label: "Datos minimos eCMR completos", ok: ecmr.status !== "incompleto", required: true },
    { key: "remision_trace", label: "Remision formal trazada", ok: eventos.remitido > 0, required: false },
    { key: "pod_or_cmr", label: "Albaran/POD/CMR adjunto", ok: hasPod, required: false },
    { key: "signature_evidence", label: "Evidencia de firma registrada", ok: !!(firma.firma_hash || firma.firma_fecha), required: false },
    { key: "signature_integrity", label: "Sin cambios posteriores a la firma", ok: !postFirma.changed_after_signature, required: false },
  ];
  const required = checks.filter(c => c.required !== false);
  const optional = checks.filter(c => c.required === false);
  const score = Math.round((((required.filter(c => c.ok).length * 2) + optional.filter(c => c.ok).length) / ((required.length * 2) + optional.length || 1)) * 100);
  const bloqueos = checks.filter(c => c.required !== false && !c.ok).map(c => c.label);
  const avisos = checks.filter(c => c.required === false && !c.ok).map(c => c.label);
  const acciones = [];
  if (!status.ready) acciones.push("Completar los faltantes obligatorios del DCD antes de remitir.");
  if (ecmr.missing_fields.length) acciones.push(`Completar datos eCMR: ${ecmr.missing_fields.join(", ")}.`);
  if (!eventos.remitido) acciones.push("Marcar remision formal cuando el documento se haya enviado o puesto a disposicion.");
  if (!hasPod) acciones.push("Adjuntar albaran/POD/CMR firmado al entregar el viaje.");
  if (postFirma.changed_after_signature) acciones.push("Revisar cambios posteriores a la firma y descargar informe de evidencia.");
  if (!acciones.length) acciones.push("Expediente documental completo para operativa interna. Pendiente solo de proveedor certificado si se exige integracion oficial.");
  return {
    schema: "transgest.documento_control.expediente.v1",
    generated_at: new Date().toISOString(),
    estado: bloqueos.length ? "requiere_completar" : avisos.length ? "operativo_con_avisos" : "completo",
    score,
    checks,
    bloqueos,
    avisos,
    acciones,
    dcd: {
      codigo_control: documento.codigo_control || "",
      soporte_url: documento.soporte_url || "",
      ready: !!status.ready,
      readiness_score: status.readiness?.score ?? null,
      faltantes: status.faltantes || [],
    },
    ecmr,
    efti: {
      exportable: !!documento.codigo_control,
      platform_certified_connected: false,
      profile: "eFTI-ready interno",
      note: "Preparado para intercambio estructurado. La aceptacion oficial B2A dependera de plataforma eFTI certificada.",
    },
    firma: {
      registrada: !!(firma.firma_hash || firma.firma_fecha),
      firma_fecha: firma.firma_fecha || null,
      firma_nombre: firma.firma_nombre || "",
      firma_hash: firma.firma_hash || "",
      post_signature_integrity: postFirma || null,
    },
    documentos: docs,
    trazabilidad: eventos,
  };
}

function buildDocumentoControlStructuredExport(payload = {}) {
  const documento = payload.documento || {};
  const status = payload.status || {};
  const generatedAt = new Date().toISOString();
  const ecmrConsignmentNote = buildEcmrConsignmentNote(documento);
  const exportData = {
    schema: {
      name: "transgest.documento_control.interoperable",
      version: "2026.06",
      profile: "DCD-ES/eCMR/eFTI-ready",
      language: "es",
    },
    regulatory_context: {
      documento_control_espana_obligatorio_desde: status.normativa?.documento_control_obligatorio_desde || "2026-10-05",
      diwass_eannex_vii_entrada_vigor: status.normativa?.diwass_eannex_vii_entrada_vigor || "2026-05-21",
      diwass_eannex_vii_transicion_hasta: status.normativa?.diwass_eannex_vii_transicion_hasta || "2026-12-31",
      efti_ue_plena_aplicacion_desde: status.normativa?.efti_plena_aplicacion_desde || "2027-07-09",
      firma_minima_objetivo: documento.preparacion_digital?.firma_eidas?.minimo_objetivo || "firma electronica avanzada",
      nota: "Exportacion preparatoria para interoperabilidad B2B/B2A. La remision oficial dependera de proveedor/plataforma certificada aplicable.",
    },
    identifiers: {
      codigo_control: documento.codigo_control || "",
      codigo_verificacion: documento.verificacion?.codigo_verificacion || "",
      referencia_pedido: documento.referencia_pedido || "",
      orden_carga_numero: payload.orden_carga_numero || "",
      soporte_url: documento.soporte_url || "",
      qr_url: documento.qr_url || "",
      canal_remision: payload.remision?.canal || "",
    },
    parties: {
      cargador_contractual: documento.cargador_contractual || {},
      transportista_efectivo: documento.transportista_efectivo || {},
      destinatario: {
        nombre: documento.destino?.destinatario || documento.destino?.nombre || "",
        direccion: documento.destino?.direccion || "",
      },
    },
    transport: {
      fecha_transporte: documento.fecha_transporte || "",
      horarios: documento.horarios || {},
      origen: documento.origen || {},
      destino: documento.destino || {},
      cargas: Array.isArray(documento.cargas) ? documento.cargas : [],
      descargas: Array.isArray(documento.descargas) ? documento.descargas : [],
      vehiculo: documento.vehiculo || {},
    },
    goods: documento.mercancia || {},
    ecmr_consignment_note: ecmrConsignmentNote,
    efti_dataset: {
      platform_certified_connected: false,
      machine_readable: true,
      data_model_status: "preparado_para_mapeo_certificado",
      authority_access: {
        tokenized_support_url: documento.verificacion?.url_segura || "",
        verification_code: documento.verificacion?.codigo_verificacion || "",
        noindex: true,
        cache_policy: "no-store",
      },
    },
    waste_annex_vii: {
      potentially_applicable: !!documento.preparacion_digital?.diwass_annex_vii?.senal_residuo,
      cross_border_hint: !!documento.preparacion_digital?.diwass_annex_vii?.indicio_transfronterizo,
      detected_terms: documento.preparacion_digital?.diwass_annex_vii?.terminos_detectados || [],
      required_if_applicable: documento.preparacion_digital?.diwass_annex_vii?.datos_requeridos_si_aplica || [],
      status: documento.preparacion_digital?.diwass_annex_vii?.senal_residuo
        ? "requiere_revision_operativa"
        : "sin_senal_automatica_de_residuos",
    },
    compliance_operativo: documento.preparacion_digital?.cumplimiento_operativo || {},
    commercial_terms: documento.condiciones || {},
    digital_readiness: {
      ready: !!status.ready,
      score: status.readiness?.score ?? null,
      faltantes: Array.isArray(status.faltantes) ? status.faltantes : [],
      avisos: Array.isArray(status.avisos) ? status.avisos : [],
      checks: Array.isArray(status.checks) ? status.checks.map(check => ({
        key: check.key,
        ok: !!check.ok,
        required: check.required !== false,
        label: check.label,
        category: check.category || "general",
      })) : [],
    },
    signature_envelope: {
      status: "pendiente_proveedor",
      required_level: documento.preparacion_digital?.firma_eidas?.minimo_objetivo || "firma electronica avanzada",
      signer_identity: null,
      timestamp: null,
      evidence_hash: null,
    },
    verification: {
      status: documento.verificacion?.url_segura ? "verificable_con_enlace_tokenizado" : "pendiente_url_publica",
      tokenized_public_url: documento.verificacion?.url_segura || "",
      verification_code: documento.verificacion?.codigo_verificacion || "",
      noindex: true,
      cache_policy: "no-store",
    },
    audit: {
      generated_at: generatedAt,
      generator: "TransGest",
      export_filename: buildDocumentoControlExportFilename(documento),
    },
  };
  exportData.audit.integrity_hash_sha256 = crypto
    .createHash("sha256")
    .update(stableJson(exportData))
    .digest("hex");
  return exportData;
}

function normalizeSignatureEvidence(evidence = null) {
  if (!evidence) return null;
  if (typeof evidence === "object") return evidence;
  if (typeof evidence === "string") {
    try {
      const parsed = JSON.parse(evidence);
      return parsed && typeof parsed === "object" ? parsed : { raw: evidence };
    } catch {
      return { raw: evidence };
    }
  }
  return { raw: String(evidence) };
}

function buildDocumentoControlSignaturePackage(payload = {}, firma = {}) {
  const documento = payload.documento || {};
  const structuredExport = buildDocumentoControlStructuredExport(payload);
  const evidence = normalizeSignatureEvidence(firma?.evidencia || firma?.firma_evidencia || null);
  const evidenceHash = firma?.firma_hash || evidence?.integrity_hash_sha256 || evidence?.hash_sha256 || "";
  const signers = Array.isArray(structuredExport.signature_envelope?.signers)
    ? structuredExport.signature_envelope.signers
    : [
        { role: "cargador", required: true, name: documento.cargador_contractual?.nombre || "" },
        { role: "transportista", required: true, name: documento.transportista_efectivo?.nombre || "" },
        { role: "destinatario", required: false, name: documento.destino?.destinatario || documento.destino?.nombre || "" },
      ];
  const payloadToSign = {
    document_type: "documento_control_digital",
    identifiers: structuredExport.identifiers,
    parties: structuredExport.parties,
    transport: structuredExport.transport,
    goods: structuredExport.goods,
    verification: structuredExport.verification,
    structured_export_hash_sha256: structuredExport.audit?.integrity_hash_sha256 || "",
  };
  const checks = [
    { key: "dcd_ready", ok: !!payload.status?.ready, required: false, label: "Documento de Control Digital completo" },
    { key: "verification_code", ok: !!documento.verificacion?.codigo_verificacion, required: true, label: "Codigo de verificacion seguro generado" },
    { key: "support_url", ok: !!documento.soporte_url, required: true, label: "Soporte publico tokenizado disponible" },
    { key: "required_signers", ok: signers.filter(s => s.required !== false).every(s => !!String(s.name || "").trim()), required: true, label: "Firmantes requeridos identificados" },
    { key: "provider_connected", ok: false, required: false, label: "Proveedor eIDAS conectado" },
    { key: "existing_signature_evidence", ok: !!evidenceHash, required: false, label: "Evidencia de firma registrada" },
  ];
  const packageData = {
    schema: {
      name: "transgest.documento_control.signature_package",
      version: "2026.06",
      profile: "eIDAS-advanced-signature-ready",
      language: "es",
    },
    document: {
      type: "documento_control_digital",
      codigo_control: documento.codigo_control || "",
      referencia_pedido: documento.referencia_pedido || "",
      verification_code: documento.verificacion?.codigo_verificacion || "",
      support_url: documento.soporte_url || "",
      export_hash_sha256: structuredExport.audit?.integrity_hash_sha256 || "",
      signature_package_filename: buildDocumentoControlSignaturePackageFilename(documento),
    },
    signature_policy: {
      target_level: documento.preparacion_digital?.firma_eidas?.minimo_objetivo || "firma electronica avanzada",
      regulation: "eIDAS",
      timestamp_required: true,
      identity_validation_required: true,
      provider_status: "pending_provider_integration",
      allowed_provider_types: ["firma_electronica_avanzada", "sello_tiempo_cualificado", "validacion_identidad_firmante"],
      note: "Paquete preparatorio. La firma legal debe ejecutarse con proveedor eIDAS y conservar su evidencia tecnica.",
    },
    signers_required: signers,
    evidence_current: evidenceHash
      ? {
          status: "firma_registrada_en_transgest",
          signer_name: firma?.firma_nombre || evidence?.firmante?.nombre || "",
          signed_at: firma?.firma_fecha || evidence?.fecha || "",
          evidence_hash_sha256: evidenceHash,
          evidence,
        }
      : {
          status: "pendiente_firma_proveedor",
          signer_name: "",
          signed_at: "",
          evidence_hash_sha256: "",
          evidence: null,
        },
    payload_to_sign: payloadToSign,
    hashes: {
      payload_hash_sha256: sha256Hex(payloadToSign),
      structured_export_hash_sha256: structuredExport.audit?.integrity_hash_sha256 || "",
    },
    checks,
    next_action: evidenceHash
      ? "Conservar este paquete junto a la evidencia del proveedor eIDAS y bloquear cambios posteriores al documento firmado."
      : "Enviar payload_to_sign al proveedor de firma avanzada eIDAS, registrar identidad, sello de tiempo y evidencia tecnica devuelta.",
    audit: {
      generated_at: new Date().toISOString(),
      generator: "TransGest",
    },
  };
  packageData.hashes.signature_package_hash_sha256 = sha256Hex(packageData);
  return packageData;
}

function dataUrlFromBase64(base64 = "", mime = "image/png") {
  const raw = String(base64 || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  return `data:${mime || "image/png"};base64,${raw}`;
}

function buildDocumentoControlSignatures(pedido = {}) {
  const evidencia = pedido?.firma_evidencia && typeof pedido.firma_evidencia === "object" ? pedido.firma_evidencia : {};
  const firmas = evidencia.firmas && typeof evidencia.firmas === "object" ? evidencia.firmas : {};
  const pick = (role, fallback = {}) => {
    const ev = firmas[role] || {};
    return {
      rol: role,
      nombre: fallback.nombre || ev.firmante?.nombre || "",
      fecha: fallback.fecha || ev.firmado_at || "",
      hash: fallback.hash || ev.firma?.hash || "",
      imagen: fallback.imagen || ev.firma?.data_url || ev.firma?.imagen || "",
      evidencia: ev,
    };
  };
  return {
    cargador: pick("cargador", {
      nombre: pedido?.firma_cargador_nombre || "",
      fecha: pedido?.firma_cargador_fecha || "",
      imagen: pedido?.firma_cargador || "",
    }),
    chofer: pick("chofer", {
      nombre: pedido?.firma_chofer_nombre || pedido?.chofer_firma_base_nombre || [pedido?.conductor_efectivo_nombre, pedido?.conductor_efectivo_apellidos].filter(Boolean).join(" ").trim() || [pedido?.chofer_nombre, pedido?.chofer_apellidos].filter(Boolean).join(" ").trim(),
      fecha: pedido?.firma_chofer_fecha || pedido?.chofer_firma_base_fecha || "",
      imagen: pedido?.firma_chofer || pedido?.chofer_firma_base || "",
    }),
    destinatario: pick("destinatario", {
      nombre: pedido?.firma_nombre || "",
      fecha: pedido?.firma_fecha || "",
      hash: pedido?.firma_hash || "",
      imagen: pedido?.firma_destinatario || "",
    }),
  };
}

function buildDocumentoControlPayload({ empresaId, pedido, empresa = {}, cliente = {}, colaborador = {}, appBaseUrl = "" }) {
  const config = normalizeDocumentoControlConfig(empresa?.documento_control);
  const cargas = parseStops(pedido?.puntos_carga);
  const descargas = parseStops(pedido?.puntos_descarga);
  const carga = firstStopInfo(cargas, pedido?.origen || "");
  const descarga = firstStopInfo(descargas, pedido?.destino || "");
  const esColaborador = Boolean(pedido?.colaborador_id);
  const wasteSignals = detectWasteSignals(pedido);
  const complianceSignals = detectTransportComplianceSignals(pedido);

  const cargador = esColaborador
    ? {
        nombre: companyName(empresa),
        nif: empresa?.cif || "",
        domicilio: [empresa?.domicilio, empresa?.cp, empresa?.municipio, empresa?.provincia, empresa?.pais].filter(Boolean).join(", "),
        contacto: empresa?.contacto || empresa?.responsable || "",
        email: empresa?.email || empresa?.email_admin || "",
        telefono: empresa?.telefono || "",
      }
    : {
        nombre: cliente?.nombre || companyName(empresa),
        nif: cliente?.cif || "",
        domicilio: [cliente?.direccion, cliente?.cp, cliente?.poblacion, cliente?.provincia, cliente?.pais].filter(Boolean).join(", "),
        contacto: cliente?.contacto || "",
        email: cliente?.email_facturacion || cliente?.email || "",
        telefono: cliente?.telefono || "",
      };

  const transportista = esColaborador
    ? {
        nombre: colaborador?.nombre || pedido?.colaborador_nombre || "",
        nif: colaborador?.cif || pedido?.colaborador_cif || "",
        domicilio: [colaborador?.direccion, colaborador?.cp, colaborador?.poblacion, colaborador?.provincia, colaborador?.pais].filter(Boolean).join(", "),
        contacto: colaborador?.contacto || "",
        email: colaborador?.email || "",
        telefono: colaborador?.telefono || "",
      }
    : {
        nombre: companyName(empresa),
        nif: empresa?.cif || "",
        domicilio: [empresa?.domicilio, empresa?.cp, empresa?.municipio, empresa?.provincia, empresa?.pais].filter(Boolean).join(", "),
        contacto: empresa?.contacto || empresa?.responsable || "",
        email: empresa?.email || empresa?.email_admin || "",
        telefono: empresa?.telefono || "",
      };

  const matriculaTractora = pedido?.matricula_colaborador || pedido?.vehiculo_matricula || pedido?.veh_matricula || pedido?.matricula || "";
  const matriculaRemolque = pedido?.remolque_matricula_colaborador || pedido?.remolque_matricula || pedido?.rem_matricula || pedido?.remolque_mat || "";
  const pesoKg = Number(pedido?.peso_kg || pedido?.kg || 0);
  const codigoControl = buildCodigoControl({ empresaId, pedidoId: pedido?.id });
  const publicUrl = buildPublicUrl({ empresaId, pedidoId: pedido?.id, config, appBaseUrl });
  const verificationCode = buildPublicVerificationCode({ empresaId, pedidoId: pedido?.id });
  const origenPais = pedido?.origen_pais || carga.pais || "España";
  const destinoPais = pedido?.destino_pais || descarga.pais || "España";
  const cmrTipo = String(pedido?.cmr_tipo || "").toLowerCase() === "internacional" || shouldUseInternationalCmr(origenPais, destinoPais)
    ? "internacional"
    : "nacional";
  const choferNombre = [pedido?.conductor_efectivo_nombre, pedido?.conductor_efectivo_apellidos].filter(Boolean).join(" ").trim()
    || [pedido?.chofer_nombre, pedido?.chofer_apellidos].filter(Boolean).join(" ").trim();
  const firmas = buildDocumentoControlSignatures(pedido);

  const documento = {
    codigo_control: codigoControl,
    sistema: config.sistema,
    cmr_tipo: cmrTipo,
    soporte_url: publicUrl,
    qr_url: config.sistema === "qr_url" ? publicUrl : "",
    referencia_pedido: pedido?.numero || pedido?.referencia_cliente || "",
    fecha_transporte: pedido?.fecha_carga || pedido?.fecha_servicio || pedido?.fecha_descarga || "",
    horarios: {
      fecha_carga: pedido?.fecha_carga || carga.fecha || "",
      hora_carga: pedido?.hora_carga || carga.hora || "",
      ventana_carga: pedido?.ventana_carga || carga.ventana || "",
      fecha_descarga: pedido?.fecha_descarga || pedido?.fecha_entrega || descarga.fecha || "",
      hora_descarga: pedido?.hora_descarga || descarga.hora || "",
      ventana_descarga: pedido?.ventana_descarga || descarga.ventana || "",
    },
    cargador_contractual: cargador,
    transportista_efectivo: transportista,
    colaborador: esColaborador ? transportista : null,
    // La subcontratacion no convierte por si sola al transportista efectivo en
    // transportista sucesivo ni justifica repetirlo en las casillas 16 y 17.
    transportistas_sucesivos: [],
    empresa: {
      nombre: companyName(empresa),
      cif: empresa?.cif || "",
      nif: empresa?.cif || "",
      domicilio: empresa?.domicilio || empresa?.direccion || "",
      cp: empresa?.cp || empresa?.codigo_postal || "",
      poblacion: empresa?.poblacion || empresa?.ciudad || "",
      provincia: empresa?.provincia || "",
      pais: empresa?.pais || "España",
      telefono: empresa?.telefono || "",
      email: empresa?.email || "",
      contacto: empresa?.contacto || "",
      logo_url: dataUrlFromBase64(empresa?.logo_base64 || "", empresa?.logo_mime || "image/png"),
    },
    chofer: {
      nombre: choferNombre || firmas.chofer.nombre || "",
      dni: pedido?.conductor_efectivo_dni || pedido?.chofer_dni || "",
      telefono: pedido?.conductor_efectivo_telefono || pedido?.chofer_telefono || pedido?.chofer_tel || "",
      email: pedido?.chofer_email || "",
    },
    firmas,
    origen: {
      nombre: carga.nombre || pedido?.origen || "",
      direccion: carga.direccion || pedido?.origen || "",
      provincia: pedido?.origen_provincia || "",
      pais: origenPais,
      google_maps_url: carga.google_maps_url || "",
      referencia: carga.referencia || "",
    },
    destino: {
      nombre: descarga.nombre || pedido?.destino || "",
      direccion: descarga.direccion || pedido?.destino || "",
      destinatario: descarga.cliente_nombre || pedido?.destino || "",
      provincia: pedido?.destino_provincia || "",
      pais: destinoPais,
      google_maps_url: descarga.google_maps_url || "",
      referencia: descarga.referencia || "",
    },
    cargas: normalizeStopList(cargas, {
      fecha: pedido?.fecha_carga || "",
      hora: pedido?.hora_carga || "",
      ventana: pedido?.ventana_carga || "",
      provincia: pedido?.origen_provincia || "",
      pais: origenPais,
    }),
    descargas: normalizeStopList(descargas, {
      fecha: pedido?.fecha_descarga || pedido?.fecha_entrega || "",
      hora: pedido?.hora_descarga || "",
      ventana: pedido?.ventana_descarga || "",
      provincia: pedido?.destino_provincia || "",
      pais: destinoPais,
    }),
    mercancia: {
      descripcion: pedido?.mercancia || pedido?.descripcion_carga || "",
      peso_kg: pesoKg || null,
      bultos: pedido?.bultos || null,
      volumen: pedido?.volumen || null,
      embalaje: pedido?.embalaje || (pedido?.bultos ? "Bultos/palets" : ""),
      marcas_numeros: buildGoodsMarksAndReferences(pedido, cargas, descargas),
    },
    vehiculo: {
      tractora: matriculaTractora,
      remolque: matriculaRemolque,
    },
    verificacion: {
      codigo_verificacion: verificationCode,
      algoritmo: "HMAC-SHA256",
      url_segura: publicUrl,
      tokenizado: !!publicUrl,
      noindex: true,
      cache_policy: "no-store",
    },
    observaciones: pedido?.notas || pedido?.condiciones_adicionales || config.observaciones || "",
    condiciones: {
      forma_pago_interna: formatClientPaymentTerms(empresa),
      reembolso_contra_entrega: cleanCmrOptionalField(pedido?.reembolso_contra_entrega || pedido?.cash_on_delivery || ""),
      acuerdos_especiales: cleanCmrOptionalField(pedido?.acuerdos_especiales || ""),
      operativa_carga: buildOperativaCargaLabels(pedido),
      revision_combustible: "El precio pactado solo se ajustara por variacion del combustible si el indice G de variacion del precio medio del gasoleo publicado por la Administracion entre la fecha de esta orden de carga y la fecha de carga efectiva de la mercancia es igual o superior al 5%. El ajuste debera reflejarse en la factura correspondiente al transporte ejecutado como concepto separado e identificado. No se admitiran ajustes en facturas rectificativas o posteriores emitidas fuera del ciclo de facturacion habitual de las partes. Si el porteador hubiera percibido ayudas publicas que compensen total o parcialmente la variacion del gasoleo, el indice G se calculara sobre el precio neto tras descontar dichas ayudas. El ajuste a la baja opera en las mismas condiciones cuando la variacion sea favorable al cargador.",
      clausulas_orden_carga: [
        { titulo: "Aceptacion", texto: "La presente orden constituye un contrato de transporte de mercancias por carretera. Se considerara aceptada y vinculante salvo que el porteador comunique su rechazo expreso en el plazo de una hora desde la recepcion de esta orden." },
        { titulo: "Documentacion", texto: "No se pagara la factura hasta recibir todos los documentos de transporte originales firmados por el destinatario (CMR o carta de porte y albaran) en maximo 48h." },
        { titulo: "Prohibicion de subcontratacion", texto: "Queda expresamente prohibida la subcontratacion total o parcial del servicio sin autorizacion escrita previa del cargador. En caso de incumplimiento, el cargador quedara facultado para resolver el contrato, rechazar la factura emitida y no abonar cantidad alguna por el servicio, sin perjuicio de reclamar los danos y perjuicios causados. Cuando la subcontratacion hubiera sido autorizada por escrito, el cargador podra condicionar el pago de la factura del porteador a la acreditacion documental del pago efectivo al subcontratista por los servicios objeto de autorizacion." },
        { titulo: "Estacionamiento y pernocta", texto: "Solo podra estacionarse o pernoctar en instalaciones cerradas con vigilancia presencial las 24 horas. Queda prohibido el estacionamiento en areas de servicio, explanadas o vias publicas sin estas caracteristicas. El incumplimiento trasladara al porteador la responsabilidad por cualquier dano, robo o perdida producidos durante el estacionamiento no autorizado." },
        { titulo: "Cancelacion de la orden", texto: "El cargador podra cancelar la presente orden de transporte sin coste ni penalizacion alguna dentro de las doce horas siguientes a su emision, mediante comunicacion escrita dirigida al porteador por cualquier medio que deje constancia de su recepcion." },
        { titulo: "Ley aplicable y jurisdiccion", texto: "Queda expresamente excluida la sumision a las Juntas Arbitrales del Transporte. Cualquier controversia derivada de la presente orden sera resuelta exclusivamente ante la jurisdiccion ordinaria." },
        { titulo: "Retencion", texto: "Queda prohibida la retencion de la mercancia salvo en los casos expresamente autorizados por la ley." },
      ],
    },
    preparacion_digital: {
      documento_control: {
        fecha_obligacion_espana: "2026-10-05",
        soporte: config.sistema === "qr_url" ? "QR/URL HTTPS" : "codigo numerico y soporte descargable",
      },
      firma_eidas: {
        minimo_objetivo: "firma electronica avanzada",
        pendiente_integracion: true,
      },
      efti_ecmr: {
        fecha_aplicacion_ue: "2027-07-09",
        pendiente_plataforma_certificada: true,
        cmr_tipo: cmrTipo,
        internacional: cmrTipo === "internacional",
      },
      diwass_annex_vii: {
        aplica_si_residuos_transfronterizos: true,
        entrada_vigor_diwass: "2026-05-21",
        transicion_annex_vii_hasta: "2026-12-31",
        senal_residuo: wasteSignals.detected,
        indicio_transfronterizo: wasteSignals.cross_border_hint,
        terminos_detectados: wasteSignals.detected_terms,
        datos_requeridos_si_aplica: [
          "codigo LER/residuo",
          "productor o poseedor inicial",
          "destinatario/instalacion de valorizacion o eliminacion",
          "transportistas intervinientes",
          "cantidades y embalaje",
          "firmas y aceptaciones de partes",
        ],
      },
      cumplimiento_operativo: {
        estado: complianceSignals.avisos.length ? "requiere_revision" : "sin_senales_automaticas",
        enfoque: "Checklist preventivo. No sustituye validacion legal o documental humana.",
        adr: complianceSignals.adr,
        zbe: complianceSignals.zbe,
        internacional: complianceSignals.internacional,
        cabotaje: complianceSignals.cabotaje,
        tacografo: complianceSignals.tacografo,
        avisos: complianceSignals.avisos,
      },
    },
  };

  const checks = [
    { key: "habilitado", ok: !!config.habilitado, label: "Modulo activado", category: "sistema" },
    { key: "cargador_nombre", ok: hasText(documento.cargador_contractual.nombre), label: "Cargador contractual identificado", category: "datos_maestros" },
    { key: "cargador_nif", ok: hasText(documento.cargador_contractual.nif), label: "NIF del cargador contractual", category: "datos_maestros" },
    { key: "cargador_domicilio", ok: hasText(documento.cargador_contractual.domicilio), label: "Domicilio del cargador contractual", category: "datos_maestros" },
    { key: "cargador_contacto", ok: hasText(documento.cargador_contractual.contacto), label: "Contacto del cargador", category: "datos_maestros", required: false },
    { key: "cargador_email", ok: hasEmail(documento.cargador_contractual.email), label: "Email valido del cargador", category: "datos_maestros", required: false },
    { key: "transportista_nombre", ok: hasText(documento.transportista_efectivo.nombre), label: "Transportista efectivo identificado", category: "datos_maestros" },
    { key: "transportista_nif", ok: hasText(documento.transportista_efectivo.nif), label: "NIF del transportista efectivo", category: "datos_maestros" },
    { key: "transportista_domicilio", ok: hasText(documento.transportista_efectivo.domicilio), label: "Domicilio del transportista efectivo", category: "datos_maestros" },
    { key: "transportista_contacto", ok: hasText(documento.transportista_efectivo.contacto), label: "Contacto del transportista", category: "datos_maestros", required: false },
    { key: "transportista_email", ok: hasEmail(documento.transportista_efectivo.email), label: "Email valido del transportista", category: "datos_maestros", required: false },
    { key: "origen", ok: hasText(documento.origen.direccion), label: "Origen con direccion", category: "operativa" },
    { key: "destino", ok: hasText(documento.destino.direccion), label: "Destino con direccion", category: "operativa" },
    { key: "destinatario", ok: hasText(documento.destino.destinatario), label: "Destinatario de la mercancia", category: "datos_maestros" },
    { key: "mercancia", ok: hasText(documento.mercancia.descripcion), label: "Naturaleza de la mercancia", category: "mercancia" },
    { key: "peso", ok: !!documento.mercancia.peso_kg, label: "Peso o magnitud del envio", category: "mercancia" },
    { key: "bultos", ok: hasText(documento.mercancia.bultos), label: "Bultos/unidades del envio", category: "mercancia", required: false },
    { key: "fecha", ok: hasText(documento.fecha_transporte), label: "Fecha de transporte", category: "operativa" },
    { key: "hora_carga", ok: hasText(documento.horarios.hora_carga) || hasText(documento.horarios.ventana_carga), label: "Hora o ventana de carga", category: "operativa" },
    { key: "hora_descarga", ok: hasText(documento.horarios.hora_descarga) || hasText(documento.horarios.ventana_descarga), label: "Hora o ventana de descarga", category: "operativa" },
    { key: "vehiculo", ok: hasText(documento.vehiculo.tractora), label: "Matricula del vehiculo tractor", category: "vehiculo" },
    { key: "remolque", ok: hasText(documento.vehiculo.remolque), label: "Matricula de remolque si aplica", category: "vehiculo", required: false },
    { key: "chofer_nombre", ok: hasText(documento.chofer.nombre), label: "Conductor efectivo identificado", category: "vehiculo", required: false },
    { key: "chofer_dni", ok: hasText(documento.chofer.dni), label: "DNI/NIE del conductor efectivo", category: "vehiculo", required: false },
    { key: "operativa_carga", ok: Array.isArray(documento.condiciones.operativa_carga), label: "Operativa de carga documentada", category: "condiciones", required: false },
    { key: "ecmr_internacional", ok: documento.cmr_tipo !== "internacional" || buildEcmrConsignmentNote(documento).missing_fields.length === 0, label: "eCMR internacional con datos CMR minimos", category: "interoperabilidad" },
    { key: "firma_avanzada", ok: false, label: "Proveedor de firma avanzada eIDAS integrado", category: "firma", required: false },
    { key: "efti_platform", ok: false, label: "Preparado para plataforma eFTI/e-CMR certificada", category: "interoperabilidad", required: false },
    { key: "diwass_annex_vii", ok: !wasteSignals.detected || wasteSignals.cross_border_hint, label: "Revision DIWASS/eAnnex VII si hay residuos transfronterizos", category: "interoperabilidad", required: false },
    { key: "cumplimiento_operativo", ok: complianceSignals.avisos.length === 0, label: "Revision ADR/ZBE/tacografo/cabotaje si hay senales", category: "cumplimiento", required: false },
  ];

  if (config.sistema === "qr_url") {
    checks.push(
      { key: "dominio_url", ok: /^https:\/\//i.test(config.dominio_url || publicUrl || ""), label: "Dominio HTTPS configurado", category: "sistema" },
      { key: "dominio_comunicado", ok: !!config.dominio_comunicado, label: "Dominio comunicado al Ministerio", category: "sistema", required: false },
      { key: "qr_public_url", ok: !!publicUrl, label: "URL publica para QR", category: "sistema" },
    );
  }

  const faltantes = checks.filter(check => check.required !== false && !check.ok).map(check => check.label);
  const avisos = checks.filter(check => check.required === false && !check.ok).map(check => check.label);
  const readiness = buildReadiness(checks);
  const level = !config.habilitado ? "warning" : faltantes.length ? "warning" : "ok";

  return {
    config,
    documento,
    orden_carga_numero: pedido?.orden_carga_numero || "",
    orden_carga_generada_at: pedido?.orden_carga_generada_at || null,
    status: {
      level,
      ready: config.habilitado && !faltantes.length,
      readiness,
      summary: !config.habilitado
        ? "Documento de control digital no activado para esta empresa."
        : faltantes.length
          ? `Faltan ${faltantes.length} datos para dejar el DeCA listo.`
          : avisos.length
            ? `Documento de control listo. ${avisos.length} avisos de preparacion digital/e-CMR.`
            : "Documento de control digital listo para este pedido.",
      checks,
      faltantes,
      avisos,
      normativa: {
        soporte: config.sistema === "qr_url" ? "QR con URL en dominio HTTPS comunicado" : "Codigo numerico para remision DeCA/PDF-A",
        pdf: "PDF/A maximo 4 MB cuando se remita a inspeccion mediante codigo numerico.",
        documento_control_obligatorio_desde: "2026-10-05",
        diwass_eannex_vii_entrada_vigor: "2026-05-21",
        diwass_eannex_vii_transicion_hasta: "2026-12-31",
        efti_plena_aplicacion_desde: "2027-07-09",
      },
    },
    remision: {
      canal: config.sistema === "qr_url" ? "qr_url" : "codigo_numerico",
      etiqueta: config.sistema === "qr_url" ? "QR con URL HTTPS comunicada" : "Codigo numerico / soporte imprimible",
      filename: buildDocumentoControlFilename(documento),
      download_url: documento.soporte_url ? `${documento.soporte_url}${documento.soporte_url.includes("?") ? "&" : "?"}download=1` : "",
      instrucciones: config.sistema === "qr_url"
        ? "Mantener disponible el soporte en dominio HTTPS comunicado y accesible mediante QR o URL."
        : "Usar soporte imprimible y conservar version apta para remision/archivo. Para inspeccion por codigo, preparar PDF/A maximo 4 MB.",
    },
  };
}

function buildDocumentoControlPublicPayload(payload = {}) {
  const documento = payload.documento || {};
  return {
    config: {
      sistema: payload.config?.sistema || documento.sistema || "",
    },
    documento: {
      codigo_control: documento.codigo_control || "",
      sistema: documento.sistema || "",
      cmr_tipo: documento.cmr_tipo || "",
      soporte_url: documento.soporte_url || "",
      qr_url: documento.qr_url || "",
      referencia_pedido: documento.referencia_pedido || "",
      fecha_transporte: documento.fecha_transporte || "",
      horarios: documento.horarios || {},
      cargador_contractual: documento.cargador_contractual || {},
      transportista_efectivo: documento.transportista_efectivo || {},
      empresa: documento.empresa || {},
      chofer: documento.chofer || {},
      colaborador: documento.colaborador || {},
      firmas: documento.firmas || {},
      origen: documento.origen || {},
      destino: documento.destino || {},
      cargas: Array.isArray(documento.cargas) ? documento.cargas : [],
      descargas: Array.isArray(documento.descargas) ? documento.descargas : [],
      mercancia: documento.mercancia || {},
      vehiculo: documento.vehiculo || {},
      verificacion: documento.verificacion || {},
      condiciones: documento.condiciones || {},
      documentos_anexos: Array.isArray(documento.documentos_anexos) ? documento.documentos_anexos : [],
      observaciones: documento.observaciones || "",
    },
    orden_carga_numero: payload.orden_carga_numero || "",
    orden_carga_generada_at: payload.orden_carga_generada_at || null,
    status: {
      level: payload.status?.level || "info",
      ready: !!payload.status?.ready,
      summary: payload.status?.ready
        ? "Documento digital disponible."
        : "Documento digital pendiente de completar por trafico.",
    },
    remision: {
      canal: payload.remision?.canal || "",
      etiqueta: payload.remision?.etiqueta || "",
      filename: payload.remision?.filename || buildDocumentoControlFilename(documento),
      download_url: payload.remision?.download_url || "",
    },
  };
}

async function buildDocumentoControlQrDataUrl(documento = {}) {
  const QRCode = require("qrcode");
  const url = documento?.qr_url || documento?.soporte_url || documento?.verificacion?.url_segura || "";
  if (!url) return "";
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 360 });
}

async function buildDocumentoControlHtml({
  documento,
  empresaNombre = "TransGest TMS",
  generatedAt = new Date().toISOString(),
  autoPrint = false,
  publicView = false,
}) {
  const fecha = documento?.fecha_transporte ? new Date(`${documento.fecha_transporte}T12:00:00`).toLocaleDateString("es-ES") : "-";
  const fechaCarga = documento?.horarios?.fecha_carga ? new Date(`${documento.horarios.fecha_carga}T12:00:00`).toLocaleDateString("es-ES") : "-";
  const fechaDescarga = documento?.horarios?.fecha_descarga ? new Date(`${documento.horarios.fecha_descarga}T12:00:00`).toLocaleDateString("es-ES") : "-";
  const horaCarga = documento?.horarios?.hora_carga || documento?.horarios?.ventana_carga || "-";
  const horaDescarga = documento?.horarios?.hora_descarga || documento?.horarios?.ventana_descarga || "-";
  const peso = documento?.mercancia?.peso_kg ? `${Number(documento.mercancia.peso_kg).toLocaleString("es-ES")} kg` : "-";
  const ecmr = buildEcmrConsignmentNote(documento || {});
  const qrUrl = documento?.qr_url || documento?.soporte_url || documento?.verificacion?.url_segura || "";
  const qrDataUrl = qrUrl ? await buildDocumentoControlQrDataUrl({ ...documento, qr_url: qrUrl }).catch(() => "") : "";
  const docTipoLabel = documentIsInternational(documento || {})
    ? "Carta de porte CMR/eCMR internacional"
    : "Documento de control nacional";
  const buildStopsRows = (items = []) => (Array.isArray(items) && items.length ? items : []).map(item => `
    <tr>
      <td>${escapeHtml(item.orden || "")}</td>
      <td>${escapeHtml(item.nombre || "-")}</td>
      <td>${escapeHtml(item.direccion || "-")}${item.google_maps_url ? `<br><a href="${escapeHtml(item.google_maps_url)}">${escapeHtml(item.google_maps_url)}</a>` : ""}</td>
      <td>${escapeHtml(item.fecha || "-")}</td>
      <td>${escapeHtml(item.hora || item.ventana || "-")}</td>
    </tr>
  `).join("");
  const firmaBox = (label, firma = {}, extra = "") => {
    const hasImage = !!firma?.imagen;
    return `<div class="firma-box">
      <div class="lbl">${escapeHtml(label)}</div>
      ${extra ? `<div class="sub">${escapeHtml(extra)}</div>` : ""}
      ${hasImage ? `<img class="firma-img" src="${escapeHtml(firma.imagen)}" alt="${escapeHtml(label)}">` : `<div class="firma-line">Nombre, firma y sello</div>`}
      <div class="sub">${escapeHtml(firma?.nombre || "Pendiente")}${firma?.fecha ? ` · ${escapeHtml(new Date(firma.fecha).toLocaleString("es-ES"))}` : ""}</div>
      ${firma?.hash ? `<div class="sub hash">SHA-256 ${escapeHtml(firma.hash)}</div>` : ""}
    </div>`;
  };
  const firmas = documento?.firmas || {};
  const firmaBlock = `<section class="firmas">
    ${firmaBox("Firma cargador / remitente", firmas.cargador, documento?.cargador_contractual?.nombre || "")}
    ${firmaBox("Firma chofer / transportista", firmas.chofer, [documento?.chofer?.nombre, documento?.chofer?.dni, documento?.chofer?.telefono].filter(Boolean).join(" · "))}
    ${firmaBox("Firma destinatario", firmas.destinatario, documento?.destino?.destinatario || documento?.destino?.nombre || "")}
  </section>`;
  const qrBlock = qrUrl
    ? `<div class="qr-card"><div><strong>QR de inspeccion / acceso seguro</strong><br><a href="${escapeHtml(qrUrl)}">${escapeHtml(qrUrl)}</a><div class="sub">Escaneable para visualizar el documento alojado por empresa.</div></div>${qrDataUrl ? `<img class="qr-img" src="${escapeHtml(qrDataUrl)}" alt="QR documento de control">` : ""}</div>`
    : `<div class="note"><strong>Codigo numerico de control:</strong> ${escapeHtml(documento?.codigo_control || "-")}</div>`;
  const supportBlock = documento?.soporte_url
    ? `<div class="note"><strong>Soporte digital:</strong><br><a href="${escapeHtml(documento.soporte_url)}">${escapeHtml(documento.soporte_url)}</a></div>`
    : "";
  const verificationBlock = documento?.verificacion?.codigo_verificacion
    ? `<div class="note"><strong>Verificacion para inspeccion:</strong><br>
      Codigo de verificacion: <strong>${escapeHtml(documento.verificacion.codigo_verificacion)}</strong><br>
      Acceso protegido por token y politica no-index/no-cache.
    </div>`
    : "";
  const operativa = Array.isArray(documento?.condiciones?.operativa_carga) ? documento.condiciones.operativa_carga : [];
  const clausulasOrden = Array.isArray(documento?.condiciones?.clausulas_orden_carga) ? documento.condiciones.clausulas_orden_carga : [];
  const condicionesBlock = publicView ? "" : `<div class="note"><strong>Condiciones del servicio:</strong><br>
    Forma de pago interna: ${escapeHtml(documento?.condiciones?.forma_pago_interna || "-")}<br>
    ${operativa.length ? `Operativa: ${escapeHtml(operativa.join(" | "))}<br>` : ""}
    ${escapeHtml(documento?.condiciones?.revision_combustible || "")}
    ${clausulasOrden.length ? `<ul>${clausulasOrden.map(clausula => `<li><strong>${escapeHtml(clausula.titulo || "")}:</strong> ${escapeHtml(clausula.texto || "")}</li>`).join("")}</ul>` : ""}
  </div>`;
  const prep = documento?.preparacion_digital || {};
  const cumplimiento = prep?.cumplimiento_operativo || {};
  const cumplimientoAvisos = Array.isArray(cumplimiento.avisos) ? cumplimiento.avisos : [];
  const cumplimientoBlock = publicView ? "" : `<div class="note"><strong>Checklist de cumplimiento operativo:</strong><br>
    Estado: ${escapeHtml(cumplimiento.estado || "sin_senales_automaticas")}.<br>
    ADR: ${cumplimiento?.adr?.requiere_revision ? "revisar antes de confirmar" : "sin senal automatica"}.<br>
    ZBE/accesos urbanos: ${cumplimiento?.zbe?.requiere_revision ? `revisar ${escapeHtml((cumplimiento.zbe.zonas_detectadas || []).join(", "))}` : "sin senal automatica"}.<br>
    Internacional/eCMR/eFTI: ${cumplimiento?.internacional?.requiere_revision ? "revisar documentacion internacional" : "sin senal automatica"}.<br>
    Cabotaje/subcontratacion: ${cumplimiento?.cabotaje?.requiere_revision ? "revisar carrier y reglas aplicables" : "sin senal automatica"}.<br>
    Tacografo/horas: ${cumplimiento?.tacografo?.requiere_revision ? "confirmar horas, descansos y dispositivo" : "validacion ordinaria si aplica"}.
    ${cumplimientoAvisos.length ? `<ul>${cumplimientoAvisos.map(aviso => `<li>${escapeHtml(aviso)}</li>`).join("")}</ul>` : ""}
  </div>`;
  const preparacionBlock = publicView ? "" : `<div class="note"><strong>Preparacion normativa digital:</strong><br>
    Documento de Control digital en Espana: obligatorio desde ${escapeHtml(prep?.documento_control?.fecha_obligacion_espana || "2026-10-05")}.<br>
    Firma objetivo: ${escapeHtml(prep?.firma_eidas?.minimo_objetivo || "firma electronica avanzada")}.<br>
    eFTI/e-CMR: plena aplicacion prevista desde ${escapeHtml(prep?.efti_ecmr?.fecha_aplicacion_ue || "2027-07-09")}.<br>
    DIWASS Annex VII: revisar si hay residuos transfronterizos; entrada en vigor ${escapeHtml(prep?.diwass_annex_vii?.entrada_vigor_diwass || "2026-05-21")} y transicion Annex VII hasta ${escapeHtml(prep?.diwass_annex_vii?.transicion_annex_vii_hasta || "2026-12-31")}.<br>
    Senal residuos: ${prep?.diwass_annex_vii?.senal_residuo ? "requiere revision" : "sin senal automatica"}.
  </div>`;
  const ecmrBlock = publicView ? "" : `<div class="note"><strong>Preparacion para certificacion eCMR:</strong><br>
    Estado: ${escapeHtml(ecmr.status || "pendiente")}. Proveedor certificado conectado: ${ecmr.certified_provider_connected ? "si" : "no"}.<br>
    ${ecmr.missing_fields?.length ? `Faltantes: ${escapeHtml(ecmr.missing_fields.join(" | "))}<br>` : "Datos minimos eCMR completos para preparacion interna.<br>"}
    Nota: ${escapeHtml(ecmr.nota || "")}
  </div>`;
  const controls = `<div class="actions no-print">
    <button onclick="window.print()">Imprimir</button>
    ${documento?.soporte_url ? `<button onclick="navigator.clipboard && navigator.clipboard.writeText(${JSON.stringify(documento.soporte_url)})">Copiar enlace</button>` : ""}
  </div>`;
  const printScript = autoPrint
    ? `<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),280));</script>`
    : "";
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Documento de control ${escapeHtml(documento?.referencia_pedido || "")}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111827;padding:28px;background:#f8fafc}
    .actions{display:flex;gap:8px;justify-content:flex-end;max-width:900px;margin:0 auto 14px}
    .actions button{border:1px solid #0f766e;background:#ecfeff;color:#0f766e;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer}
    .sheet{max-width:900px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:24px 26px}
    .top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #0f766e;padding-bottom:14px;margin-bottom:18px}
    .brand{display:flex;gap:12px;align-items:center}
    .logo{width:54px;height:54px;object-fit:contain;border:1px solid #e5e7eb;border-radius:8px;padding:4px}
    h1{font-size:24px;margin:0 0 4px}
    .sub{font-size:12px;color:#64748b}
    .code{font-size:22px;font-weight:800;color:#0f766e}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
    .box{border:1px solid #e5e7eb;border-radius:10px;padding:12px}
    .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;margin-bottom:6px}
    .val{font-size:14px;font-weight:700;color:#111827}
    .note{margin-top:14px;padding:12px 14px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;font-size:12px;word-break:break-all}
    .qr-card{margin-top:14px;display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px 14px;border-radius:10px;background:#ecfdf5;border:1px solid #99f6e4;font-size:12px;word-break:break-all}
    .qr-img{width:126px;height:126px;object-fit:contain;background:#fff;border:1px solid #d1d5db;border-radius:8px;padding:6px;flex:0 0 auto}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:12px}
    th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
    .firmas{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px}
    .firma-box{border:1px solid #e5e7eb;border-radius:10px;padding:12px;min-height:118px}
    .firma-line{border-top:1px solid #94a3b8;margin-top:56px;padding-top:5px;font-size:11px;color:#64748b}
    .firma-img{display:block;max-width:100%;height:58px;object-fit:contain;margin:8px 0;background:#fff}
    .hash{font-family:monospace;word-break:break-all}
    .no-print{display:flex}
    @media print{body{padding:0;background:#fff}.sheet{max-width:none;border:none;border-radius:0;padding:0}.no-print{display:none!important}.firmas{break-inside:avoid}}
  </style></head><body>${controls}<main class="sheet">
  <div class="top">
    <div class="brand">${documento?.empresa?.logo_url ? `<img class="logo" src="${escapeHtml(documento.empresa.logo_url)}" alt="Logo empresa">` : ""}<div><h1>${escapeHtml(docTipoLabel)}</h1><div class="sub">${escapeHtml(empresaNombre)} · Transporte publico de mercancias por carretera</div></div></div>
    <div><div class="lbl">Codigo de control</div><div class="code">${escapeHtml(documento?.codigo_control || "-")}</div><div class="sub">${escapeHtml(documento?.sistema || "")}</div></div>
  </div>
  <div class="grid">
    <div class="box"><div class="lbl">Cargador contractual</div><div class="val">${escapeHtml(documento?.cargador_contractual?.nombre || "-")}</div><div class="sub">${escapeHtml(documento?.cargador_contractual?.nif || "-")} · ${escapeHtml(documento?.cargador_contractual?.domicilio || "-")}</div><div class="sub">${escapeHtml([documento?.cargador_contractual?.contacto, documento?.cargador_contractual?.email, documento?.cargador_contractual?.telefono].filter(Boolean).join(" · ") || "Contacto no informado")}</div></div>
    <div class="box"><div class="lbl">Transportista efectivo</div><div class="val">${escapeHtml(documento?.transportista_efectivo?.nombre || "-")}</div><div class="sub">${escapeHtml(documento?.transportista_efectivo?.nif || "-")} · ${escapeHtml(documento?.transportista_efectivo?.domicilio || "-")}</div><div class="sub">${escapeHtml([documento?.transportista_efectivo?.contacto, documento?.transportista_efectivo?.email, documento?.transportista_efectivo?.telefono].filter(Boolean).join(" · ") || "Contacto no informado")}</div></div>
  </div>
  <div class="box"><div class="lbl">Chofer</div><div class="val">${escapeHtml(documento?.chofer?.nombre || "-")}</div><div class="sub">${escapeHtml([documento?.chofer?.dni, documento?.chofer?.telefono, documento?.chofer?.email].filter(Boolean).join(" · ") || "Datos de chofer no informados")}</div></div>
  <div class="grid">
    <div class="box"><div class="lbl">Origen</div><div class="val">${escapeHtml(documento?.origen?.nombre || documento?.origen?.direccion || "-")}</div><div class="sub">${escapeHtml(documento?.origen?.direccion || "-")}</div>${documento?.origen?.google_maps_url ? `<div class="sub"><a href="${escapeHtml(documento.origen.google_maps_url)}">${escapeHtml(documento.origen.google_maps_url)}</a></div>` : ""}</div>
    <div class="box"><div class="lbl">Destino</div><div class="val">${escapeHtml(documento?.destino?.nombre || documento?.destino?.direccion || "-")}</div><div class="sub">${escapeHtml(documento?.destino?.direccion || "-")}</div>${documento?.destino?.google_maps_url ? `<div class="sub"><a href="${escapeHtml(documento.destino.google_maps_url)}">${escapeHtml(documento.destino.google_maps_url)}</a></div>` : ""}</div>
  </div>
  <div class="grid">
    <div class="box"><div class="lbl">Carga</div><div class="val">${escapeHtml(fechaCarga)}</div><div class="sub">Hora / ventana: ${escapeHtml(horaCarga)}</div></div>
    <div class="box"><div class="lbl">Descarga</div><div class="val">${escapeHtml(fechaDescarga)}</div><div class="sub">Hora / ventana: ${escapeHtml(horaDescarga)}</div></div>
  </div>
  <table>
    <thead><tr><th>Referencia</th><th>Fecha transporte</th><th>Mercancia</th><th>Peso</th><th>Tractora</th><th>Remolque</th></tr></thead>
    <tbody><tr><td>${escapeHtml(documento?.referencia_pedido || "-")}</td><td>${escapeHtml(fecha)}</td><td>${escapeHtml(documento?.mercancia?.descripcion || "-")}</td><td>${escapeHtml(peso)}</td><td>${escapeHtml(documento?.vehiculo?.tractora || "-")}</td><td>${escapeHtml(documento?.vehiculo?.remolque || "-")}</td></tr></tbody>
  </table>
  ${(documento?.cargas?.length || documento?.descargas?.length) ? `
  <table>
    <thead><tr><th colspan="5">Puntos de carga</th></tr><tr><th>#</th><th>Nombre</th><th>Direccion</th><th>Fecha</th><th>Hora / ventana</th></tr></thead>
    <tbody>${buildStopsRows(documento?.cargas) || `<tr><td colspan="5">Sin puntos adicionales.</td></tr>`}</tbody>
  </table>
  <table>
    <thead><tr><th colspan="5">Puntos de descarga</th></tr><tr><th>#</th><th>Nombre</th><th>Direccion</th><th>Fecha</th><th>Hora / ventana</th></tr></thead>
    <tbody>${buildStopsRows(documento?.descargas) || `<tr><td colspan="5">Sin puntos adicionales.</td></tr>`}</tbody>
  </table>` : ""}
  ${qrBlock}
  ${firmaBlock}
  ${supportBlock}
  ${verificationBlock}
  ${condicionesBlock}
  ${ecmrBlock}
  ${cumplimientoBlock}
  ${preparacionBlock}
  ${documento?.observaciones ? `<div class="note"><strong>Observaciones:</strong><br>${escapeHtml(documento.observaciones)}</div>` : ""}
  <div class="sub" style="margin-top:16px">Generado: ${escapeHtml(new Date(generatedAt).toLocaleString("es-ES"))}</div>
  </main>${printScript}</body></html>`;
}

async function generateDocumentoControlPdf({
  documento,
  empresaNombre = "TransGest TMS",
  generatedAt = new Date().toISOString(),
  publicView = false,
}) {
  const PDFDocument = require("pdfkit");
  const QRCode = require("qrcode");
  const pdfDate = new Date(generatedAt);
  const qrUrl = documento?.qr_url || documento?.soporte_url || "";
  const qrDataUrl = qrUrl
    ? await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 180 })
    : "";
  const qrBuffer = qrDataUrl ? Buffer.from(qrDataUrl.split(",")[1] || "", "base64") : null;
  const imageBufferFromDataUrl = (value = "") => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const base64 = raw.startsWith("data:") ? raw.split(",")[1] : raw;
    try { return Buffer.from(base64 || "", "base64"); } catch { return null; }
  };
  const logoBuffer = imageBufferFromDataUrl(documento?.empresa?.logo_url);
  const firmaImageBuffer = (firma = {}) => imageBufferFromDataUrl(firma?.imagen);
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    info: {
      Title: `DeCA ${documento?.referencia_pedido || documento?.codigo_control || ""}`.trim(),
      Author: empresaNombre || "TransGest TMS",
      Subject: "Documento de control digital de transporte",
      Keywords: "DeCA,DCD,Documento de control,TransGest",
      Creator: "TransGest",
      Producer: "TransGest PDF service",
      CreationDate: pdfDate,
      ModDate: pdfDate,
    },
  });
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const fmtDate = (value) => {
    if (!value) return "-";
    const date = new Date(String(value).includes("T") ? value : `${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("es-ES");
  };
  const text = (value) => String(value ?? "").trim() || "-";
  const peso = documento?.mercancia?.peso_kg ? `${Number(documento.mercancia.peso_kg).toLocaleString("es-ES")} kg` : "-";
  const writeLine = (label, value, opts = {}) => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text(label.toUpperCase(), { continued: false });
    doc.font("Helvetica").fontSize(opts.size || 10).fillColor("#111827").text(text(value), {
      width: opts.width || 500,
      lineGap: 1.5,
    });
    doc.moveDown(0.45);
  };
  const section = (title) => {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f766e").text(title);
    doc.moveTo(42, doc.y + 4).lineTo(553, doc.y + 4).strokeColor("#cbd5e1").lineWidth(0.7).stroke();
    doc.moveDown(0.65);
  };
  const ensureSpace = (height = 120) => {
    if (doc.y + height > doc.page.height - 52) doc.addPage();
  };
  const writeStops = (title, items = []) => {
    if (!Array.isArray(items) || !items.length) return;
    section(title);
    items.forEach((item, idx) => {
      ensureSpace(52);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827")
        .text(`${idx + 1}. ${text(item.nombre)}`, { width: 500 });
      doc.font("Helvetica").fontSize(9).fillColor("#334155")
        .text(text(item.direccion), { width: 500 });
      doc.font("Helvetica").fontSize(8).fillColor("#64748b")
        .text(`Fecha: ${text(item.fecha)}  Hora/ventana: ${text(item.hora || item.ventana)}`);
      doc.moveDown(0.45);
    });
  };

  if (logoBuffer) {
    try { doc.image(logoBuffer, 42, 38, { fit: [54, 54] }); } catch {}
  }
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text("Documento de Control Digital (DeCA)", logoBuffer ? 106 : 42, 42, { width: logoBuffer ? 296 : 360 });
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(empresaNombre, { width: 360 });
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f766e").text("Codigo de control", 420, 42, { width: 130, align: "right" });
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text(text(documento?.codigo_control), 350, 57, { width: 200, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(`Generado: ${pdfDate.toLocaleString("es-ES")}`, 350, 75, { width: 200, align: "right" });
  doc.moveDown(2.2);

  if (qrBuffer) {
    doc.image(qrBuffer, 430, 98, { width: 96, height: 96 });
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text("QR de descarga/verificacion", 398, 198, { width: 150, align: "center" });
  }

  section("Partes");
  writeLine("Cargador contractual", `${text(documento?.cargador_contractual?.nombre)} | ${text(documento?.cargador_contractual?.nif)}`);
  writeLine("Domicilio cargador", documento?.cargador_contractual?.domicilio);
  writeLine("Transportista efectivo", `${text(documento?.transportista_efectivo?.nombre)} | ${text(documento?.transportista_efectivo?.nif)}`);
  writeLine("Domicilio transportista", documento?.transportista_efectivo?.domicilio);
  writeLine("Chofer", `${text(documento?.chofer?.nombre)} | DNI: ${text(documento?.chofer?.dni)} | Tel: ${text(documento?.chofer?.telefono)}`);

  section("Viaje y mercancia");
  writeLine("Referencia pedido", documento?.referencia_pedido);
  writeLine("Fecha transporte", fmtDate(documento?.fecha_transporte));
  writeLine("Carga", `${text(documento?.origen?.nombre)} - ${text(documento?.origen?.direccion)} | ${fmtDate(documento?.horarios?.fecha_carga)} ${text(documento?.horarios?.hora_carga || documento?.horarios?.ventana_carga)}`);
  writeLine("Descarga", `${text(documento?.destino?.nombre)} - ${text(documento?.destino?.direccion)} | ${fmtDate(documento?.horarios?.fecha_descarga)} ${text(documento?.horarios?.hora_descarga || documento?.horarios?.ventana_descarga)}`);
  writeLine("Mercancia", documento?.mercancia?.descripcion);
  writeLine("Peso / bultos", `${peso} | ${text(documento?.mercancia?.bultos)}`);
  writeLine("Vehiculo", `Tractora: ${text(documento?.vehiculo?.tractora)} | Remolque: ${text(documento?.vehiculo?.remolque)}`);

  writeStops("Puntos de carga", documento?.cargas);
  writeStops("Puntos de descarga", documento?.descargas);

  ensureSpace(130);
  section("Verificacion y soporte");
  writeLine("URL segura", documento?.soporte_url || qrUrl, { size: 8, width: 500 });
  writeLine("Codigo de verificacion", documento?.verificacion?.codigo_verificacion);
  writeLine("Politica de acceso", "Enlace tokenizado, noindex, no-store. La descarga publica puede desactivarse; el repositorio interno conserva el documento.");

  ensureSpace(180);
  section("Firmas");
  const firmas = documento?.firmas || {};
  const firmaRows = [
    ["Cargador / remitente", firmas.cargador, documento?.cargador_contractual?.nombre || ""],
    ["Chofer / transportista", firmas.chofer, [documento?.chofer?.nombre, documento?.chofer?.dni].filter(Boolean).join(" | ")],
    ["Destinatario", firmas.destinatario, documento?.destino?.destinatario || documento?.destino?.nombre || ""],
  ];
  const startY = doc.y;
  firmaRows.forEach(([label, firma, extra], idx) => {
    const x = 42 + idx * 171;
    doc.roundedRect(x, startY, 158, 104, 6).strokeColor("#cbd5e1").lineWidth(0.7).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text(String(label).toUpperCase(), x + 8, startY + 8, { width: 142 });
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(text(extra), x + 8, startY + 21, { width: 142, height: 18 });
    const img = firmaImageBuffer(firma);
    if (img) {
      try { doc.image(img, x + 10, startY + 42, { fit: [138, 32] }); } catch {}
    } else {
      doc.moveTo(x + 12, startY + 68).lineTo(x + 146, startY + 68).strokeColor("#94a3b8").lineWidth(0.6).stroke();
      doc.font("Helvetica").fontSize(7).fillColor("#64748b").text("Nombre, firma y sello", x + 12, startY + 72, { width: 134 });
    }
    doc.font("Helvetica").fontSize(7).fillColor("#334155").text(text(firma?.nombre || "Pendiente"), x + 8, startY + 82, { width: 142 });
    if (firma?.fecha) doc.font("Helvetica").fontSize(6).fillColor("#64748b").text(new Date(firma.fecha).toLocaleString("es-ES"), x + 8, startY + 94, { width: 142 });
  });
  doc.y = startY + 116;

  if (!publicView) {
    ensureSpace(150);
    section("Condiciones y observaciones");
    writeLine("Forma de pago interna", documento?.condiciones?.forma_pago_interna);
    writeLine("Observaciones", documento?.observaciones || "-");
    if (documento?.condiciones?.revision_combustible) writeLine("Revision combustible", documento.condiciones.revision_combustible, { size: 8 });
  } else if (documento?.observaciones) {
    ensureSpace(80);
    section("Observaciones");
    writeLine("Observaciones", documento.observaciones, { size: 9 });
  }

  doc.font("Helvetica").fontSize(7).fillColor("#64748b")
    .text("Documento generado automaticamente por TransGest. Validez operativa vinculada a los datos guardados y al historial de modificaciones del pedido.", 42, 792, { width: 510, align: "center" });
  doc.end();
  const buffer = await done;
  return {
    buffer,
    base64: buffer.toString("base64"),
    mime: "application/pdf",
    filename: buildDocumentoControlFilename(documento || {}),
    hash_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    metadata: {
      title: doc.info.Title,
      author: doc.info.Author,
      subject: doc.info.Subject,
      creator: doc.info.Creator,
      producer: doc.info.Producer,
      creation_date: pdfDate.toISOString(),
      modification_date: pdfDate.toISOString(),
      qr_url: qrUrl || "",
      filename: buildDocumentoControlFilename(documento || {}),
    },
  };
}

function cmrText(value, fallback = "-") {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

function cmrDate(value) {
  if (!value) return "-";
  const date = new Date(String(value).includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? cmrText(value) : date.toLocaleDateString("es-ES");
}

function cmrPartyLines(party = {}) {
  return [
    cmrText(party.nombre),
    [party.nif, party.domicilio].filter(Boolean).join(" | "),
    [party.contacto, party.email, party.telefono].filter(Boolean).join(" | "),
  ].filter(Boolean);
}

function cmrAddressLines(stop = {}) {
  return [
    cmrText(stop.nombre || stop.direccion),
    [stop.direccion, stop.provincia || stop.region, stop.pais || stop.country].filter(Boolean).join(", "),
  ].filter(Boolean);
}

function cmrStopLines(stop = {}) {
  const lines = cmrAddressLines(stop);
  const ref = formatStopReference(stop);
  if (ref) lines.push(`Referencia: ${ref}`);
  return lines;
}

function cmrSignatureHtml(label, firma = {}, extra = "") {
  const signedAt = firma?.fecha ? new Date(firma.fecha).toLocaleString("es-ES") : "";
  return `<div class="cmr-sign">
    <div class="cmr-num">${escapeHtml(label)}</div>
    <div class="cmr-sign-extra">${escapeHtml(extra || "Nombre, firma y sello")}</div>
    ${firma?.imagen ? `<img src="${escapeHtml(firma.imagen)}" alt="${escapeHtml(label)}">` : `<div class="cmr-sign-line"></div>`}
    <div class="cmr-small">${escapeHtml(firma?.nombre || "Pendiente")}${signedAt ? ` - ${escapeHtml(signedAt)}` : ""}</div>
    ${firma?.hash ? `<div class="cmr-hash">SHA-256 ${escapeHtml(firma.hash)}</div>` : ""}
  </div>`;
}

async function buildDocumentoControlCmrHtml({
  documento,
  empresaNombre = "TransGest TMS",
  generatedAt = new Date().toISOString(),
  autoPrint = false,
  publicView = false,
}) {
  const doc = documento || {};
  const qrUrl = doc.qr_url || doc.soporte_url || doc.verificacion?.url_segura || "";
  const qrDataUrl = qrUrl ? await buildDocumentoControlQrDataUrl({ ...doc, qr_url: qrUrl }).catch(() => "") : "";
  const internacional = documentIsInternational(doc);
  const title = internacional
    ? "Carta de porte electronica CMR / Electronic consignment note"
    : "Documento de Control Digital - formato carta de porte";
  const firmas = doc.firmas || {};
  const anexos = Array.isArray(doc.documentos_anexos) ? doc.documentos_anexos : [];
  const anexosTexto = anexos.length
    ? anexos.slice(0, 8).map((item, idx) => `${idx + 1}. ${escapeHtml(item.nombre || "Documento adjunto")}${item.tipo ? ` (${escapeHtml(item.tipo)})` : ""}`).join("<br>")
    : "DCD/eCMR TransGest. Albaranes/POD pendientes de adjuntar al viaje.";
  const anexosImagen = anexos
    .filter(item => String(item.data_url || "").startsWith("data:image/"))
    .slice(0, 2);
  const anexosImagenHtml = anexosImagen.length
    ? `<section class="cmr-box cmr-wide"><h2>Albaranes/POD escaneados adjuntos</h2><div class="cmr-annex-grid">${anexosImagen.map((item, idx) => `<figure><img src="${escapeHtml(item.data_url)}" alt="Anexo ${idx + 1}"><figcaption>${escapeHtml(item.nombre || `Anexo ${idx + 1}`)}</figcaption></figure>`).join("")}</div></section>`
    : "";
  const cargaFecha = `${cmrDate(doc.horarios?.fecha_carga)} ${cmrText(doc.horarios?.hora_carga || doc.horarios?.ventana_carga, "")}`.trim();
  const descargaFecha = `${cmrDate(doc.horarios?.fecha_descarga)} ${cmrText(doc.horarios?.hora_descarga || doc.horarios?.ventana_descarga, "")}`.trim();
  const peso = doc.mercancia?.peso_kg ? `${Number(doc.mercancia.peso_kg).toLocaleString("es-ES")} kg` : "-";
  const volumen = doc.mercancia?.volumen ? `${cmrText(doc.mercancia.volumen)} m3` : "-";
  const controls = `<div class="no-print cmr-actions"><button onclick="window.print()">Imprimir</button>${qrUrl ? `<button onclick="navigator.clipboard && navigator.clipboard.writeText(${JSON.stringify(qrUrl)})">Copiar enlace QR</button>` : ""}</div>`;
  const printScript = autoPrint ? `<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script>` : "";
  const privateNotes = publicView ? "" : `<section class="cmr-box cmr-wide"><h2>Condiciones operativas internas / Internal operational terms</h2>
    ${doc.condiciones?.revision_combustible ? `<p>${escapeHtml(doc.condiciones.revision_combustible)}</p>` : ""}
    <p><strong>Estado interoperabilidad:</strong> ${escapeHtml(buildEcmrConsignmentNote(doc).status || "-")}</p>
  </section>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escapeHtml(title)} ${escapeHtml(doc.referencia_pedido || "")}</title>
  <style>
    *{box-sizing:border-box} body{margin:0;background:#eef2f7;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
    .cmr-actions{max-width:960px;margin:16px auto;display:flex;gap:8px;justify-content:flex-end}
    .cmr-actions button{border:1px solid #2563eb;background:#fff;color:#1d4ed8;border-radius:6px;padding:8px 12px;font-weight:700;cursor:pointer}
    .cmr-sheet{max-width:960px;margin:0 auto 28px;background:#fff;border:2px solid #111827;padding:14px}
    .cmr-head{display:grid;grid-template-columns:1.1fr 1.3fr 140px;gap:10px;border-bottom:2px solid #111827;padding-bottom:10px}
    .cmr-brand{display:flex;gap:10px;align-items:flex-start}.cmr-logo{width:58px;height:58px;object-fit:contain;border:1px solid #94a3b8;padding:4px}
    h1{font-size:18px;margin:0 0 4px;line-height:1.2}.cmr-sub{font-size:10px;color:#475569;line-height:1.35}.cmr-code{font-size:13px;font-weight:800;text-align:right}
    .cmr-qr{width:124px;height:124px;object-fit:contain;border:1px solid #111827;padding:5px}.cmr-qr-empty{height:124px;border:1px dashed #64748b;display:grid;place-items:center;font-size:11px}
    .cmr-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border-left:1px solid #111827;border-top:1px solid #111827;margin-top:10px}
    .cmr-box{min-height:84px;border-right:1px solid #111827;border-bottom:1px solid #111827;padding:8px 9px;break-inside:avoid}
    .cmr-wide{grid-column:1/-1}.cmr-box h2{font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.02em}.cmr-box p{font-size:12px;margin:2px 0;line-height:1.35}
    .cmr-num{font-size:10px;font-weight:800;color:#0f766e;text-transform:uppercase;margin-bottom:5px}.cmr-small{font-size:10px;color:#475569;line-height:1.35}.cmr-link{word-break:break-all}
    .cmr-goods{width:100%;border-collapse:collapse;margin-top:10px;border:1px solid #111827}.cmr-goods th,.cmr-goods td{border:1px solid #111827;padding:7px;font-size:11px;text-align:left;vertical-align:top}.cmr-goods th{font-size:10px;text-transform:uppercase;background:#f8fafc}
    .cmr-signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-left:1px solid #111827;border-top:1px solid #111827;margin-top:10px}
    .cmr-sign{min-height:128px;border-right:1px solid #111827;border-bottom:1px solid #111827;padding:8px}.cmr-sign-extra{font-size:11px;min-height:26px}.cmr-sign-line{border-top:1px solid #111827;margin:48px 8px 8px}.cmr-sign img{display:block;max-width:100%;height:48px;object-fit:contain;margin:8px 0}.cmr-hash{font-size:8px;word-break:break-all;color:#64748b}
    .cmr-annex-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.cmr-annex-grid figure{margin:0}.cmr-annex-grid img{width:100%;max-height:360px;object-fit:contain;border:1px solid #cbd5e1;background:#fff}.cmr-annex-grid figcaption{font-size:10px;color:#475569;margin-top:4px}
    @media print{body{background:#fff}.no-print{display:none!important}.cmr-sheet{margin:0;max-width:none;border:2px solid #111827;page-break-after:auto}.cmr-box{min-height:76px}}
  </style></head><body>${controls}<main class="cmr-sheet">
    <header class="cmr-head">
      <div class="cmr-brand">${doc.empresa?.logo_url ? `<img class="cmr-logo" src="${escapeHtml(doc.empresa.logo_url)}" alt="Logo empresa">` : ""}<div><h1>${escapeHtml(title)}</h1><div class="cmr-sub">TransGest DCD/eCMR ready - ${escapeHtml(empresaNombre || doc.empresa?.nombre || "Empresa transportista")}</div></div></div>
      <div class="cmr-sub">Este soporte permite verificar el documento alojado por empresa mediante QR o codigo de control. Para transporte internacional UE/Reino Unido se usa perfil CMR/eCMR preparatorio.</div>
      <div><div class="cmr-code">No. ${escapeHtml(doc.referencia_pedido || doc.codigo_control || "-")}</div>${qrDataUrl ? `<img class="cmr-qr" src="${escapeHtml(qrDataUrl)}" alt="QR documento">` : `<div class="cmr-qr-empty">QR pendiente</div>`}</div>
    </header>
    <section class="cmr-grid">
      <div class="cmr-box"><div class="cmr-num">1 Remitente / Sender</div>${cmrPartyLines(doc.cargador_contractual).map(line => `<p>${escapeHtml(line)}</p>`).join("")}</div>
      <div class="cmr-box"><div class="cmr-num">16 Transportista / Carrier</div>${cmrPartyLines(doc.transportista_efectivo).map(line => `<p>${escapeHtml(line)}</p>`).join("")}</div>
      <div class="cmr-box"><div class="cmr-num">2 Destinatario / Consignee</div>${cmrAddressLines(doc.destino).map(line => `<p>${escapeHtml(line)}</p>`).join("")}</div>
      <div class="cmr-box"><div class="cmr-num">17 Transportistas sucesivos / Successive carriers</div><p>${escapeHtml((Array.isArray(doc.transportistas_sucesivos) ? doc.transportistas_sucesivos : []).map(t => [t.nombre, t.nif, t.domicilio].filter(Boolean).join(" | ")).join("\n") || "-")}</p></div>
      <div class="cmr-box"><div class="cmr-num">3 Lugar de entrega / Place of delivery</div>${cmrStopLines(doc.destino).map(line => `<p>${escapeHtml(line)}</p>`).join("")}<p class="cmr-small">Previsto: ${escapeHtml(descargaFecha)}</p></div>
      <div class="cmr-box"><div class="cmr-num">18 Reservas y observaciones / Reservations</div><p>${escapeHtml(doc.observaciones || "-")}</p></div>
      <div class="cmr-box"><div class="cmr-num">4 Lugar y fecha de carga / Place and date of taking over</div>${cmrStopLines(doc.origen).map(line => `<p>${escapeHtml(line)}</p>`).join("")}<p class="cmr-small">Previsto: ${escapeHtml(cargaFecha)}</p></div>
      <div class="cmr-box"><div class="cmr-num">19 Acuerdos especiales / Special agreements</div><p>${escapeHtml(doc.condiciones?.acuerdos_especiales || "-")}</p></div>
      <div class="cmr-box"><div class="cmr-num">5 Documentos anexos / Documents attached</div><p>${anexosTexto}</p></div>
      <div class="cmr-box"><div class="cmr-num">21 Establecido en / Established in</div><p>${escapeHtml(doc.origen?.provincia || doc.origen?.pais || "Espana")} - ${escapeHtml(cmrDate(generatedAt))}</p><p class="cmr-small">Control: ${escapeHtml(doc.codigo_control || "-")}</p></div>
    </section>
    <table class="cmr-goods">
      <thead><tr><th>6 Marcas y numeros</th><th>7 Cantidad</th><th>8 Embalaje</th><th>9 Naturaleza mercancia</th><th>11 Peso bruto</th><th>12 Volumen</th></tr></thead>
      <tbody><tr><td>${escapeHtml(doc.mercancia?.marcas_numeros || "-")}</td><td>${escapeHtml(doc.mercancia?.bultos || "-")}</td><td>${escapeHtml(doc.mercancia?.embalaje || "-")}</td><td>${escapeHtml(doc.mercancia?.descripcion || "-")}</td><td>${escapeHtml(peso)}</td><td>${escapeHtml(volumen)}</td></tr></tbody>
    </table>
    <section class="cmr-grid">
      <div class="cmr-box"><div class="cmr-num">15 Reembolso / Cash on delivery</div><p>${escapeHtml(doc.condiciones?.reembolso_contra_entrega || "-")}</p></div>
      <div class="cmr-box"><div class="cmr-num">Vehiculo y chofer / Vehicle and driver</div><p>Tractora: ${escapeHtml(doc.vehiculo?.tractora || "-")} | Remolque: ${escapeHtml(doc.vehiculo?.remolque || "-")}</p><p>Chofer: ${escapeHtml([doc.chofer?.nombre, doc.chofer?.dni, doc.chofer?.telefono].filter(Boolean).join(" | ") || "-")}</p></div>
      <div class="cmr-box cmr-wide"><div class="cmr-num">QR y verificacion / Verification</div><p class="cmr-link">${escapeHtml(qrUrl || "Sin enlace publico configurado")}</p><p class="cmr-small">Codigo de verificacion: ${escapeHtml(doc.verificacion?.codigo_verificacion || "-")}</p></div>
    </section>
    <section class="cmr-signatures">
      ${cmrSignatureHtml("22 Firma remitente / Sender signature", firmas.cargador, doc.cargador_contractual?.nombre || "")}
      ${cmrSignatureHtml("23 Firma transportista / Carrier signature", firmas.chofer, [doc.chofer?.nombre, doc.chofer?.dni].filter(Boolean).join(" | "))}
      ${cmrSignatureHtml("24 Firma destinatario / Consignee signature", firmas.destinatario, doc.destino?.destinatario || doc.destino?.nombre || "")}
    </section>
    ${anexosImagenHtml}
    ${privateNotes}
    <p class="cmr-small" style="margin-top:10px">Generado: ${escapeHtml(new Date(generatedAt).toLocaleString("es-ES"))}. Hash y trazabilidad se conservan en el repositorio DCD de la empresa.</p>
  </main>${printScript}</body></html>`;
}

async function generateDocumentoControlCmrPdf({
  documento,
  empresaNombre = "TransGest TMS",
  generatedAt = new Date().toISOString(),
  publicView = false,
}) {
  const PDFDocument = require("pdfkit");
  const QRCode = require("qrcode");
  const docData = documento || {};
  const createdAt = new Date(generatedAt);
  const qrUrl = docData.qr_url || docData.soporte_url || docData.verificacion?.url_segura || "";
  const qrDataUrl = qrUrl ? await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 220 }) : "";
  const dataUrlBuffer = (value = "") => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const base64 = raw.startsWith("data:") ? raw.split(",")[1] : raw;
    try { return Buffer.from(base64 || "", "base64"); } catch { return null; }
  };
  const qrBuffer = dataUrlBuffer(qrDataUrl);
  const logoBuffer = dataUrlBuffer(docData.empresa?.logo_url);
  const pdf = new PDFDocument({
    size: "A4",
    margin: 22,
    info: {
      Title: `CMR-DCD ${docData.referencia_pedido || docData.codigo_control || ""}`.trim(),
      Author: empresaNombre || "TransGest TMS",
      Subject: "Carta de porte electronica / Documento de Control Digital",
      Keywords: "CMR,eCMR,DCD,DeCA,TransGest,QR",
      Creator: "TransGest",
      Producer: "TransGest PDF service",
      CreationDate: createdAt,
      ModDate: createdAt,
    },
  });
  const chunks = [];
  pdf.on("data", chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  const pageW = pdf.page.width;
  const left = 28;
  const right = pageW - 28;
  const colW = (right - left) / 2;
  const title = documentIsInternational(docData)
    ? "Carta de porte electronica CMR / Electronic consignment note"
    : "Documento de Control Digital - formato carta de porte";
  const drawRect = (x, y, w, h) => pdf.rect(x, y, w, h).strokeColor("#111827").lineWidth(0.7).stroke();
  const put = (textValue, x, y, w, opts = {}) => {
    pdf.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size || 8).fillColor(opts.color || "#111827")
      .text(cmrText(textValue, opts.fallback || ""), x, y, { width: w, lineGap: opts.lineGap ?? 1, height: opts.height });
  };
  const box = (num, label, lines, x, y, w, h) => {
    drawRect(x, y, w, h);
    put(`${num} ${label}`, x + 5, y + 5, w - 10, { bold: true, size: 7, color: "#0f766e" });
    const arr = Array.isArray(lines) ? lines : [lines];
    put(arr.filter(Boolean).join("\n"), x + 5, y + 18, w - 10, { size: 7.5, height: h - 22 });
  };
  const signature = (num, label, firma = {}, extra = "", x, y, w, h) => {
    drawRect(x, y, w, h);
    put(`${num} ${label}`, x + 5, y + 5, w - 10, { bold: true, size: 7, color: "#0f766e" });
    put(extra || "Nombre, firma y sello", x + 5, y + 18, w - 10, { size: 7, color: "#475569", height: 18 });
    const img = dataUrlBuffer(firma?.imagen);
    if (img) {
      try { pdf.image(img, x + 8, y + 40, { fit: [w - 16, 34] }); } catch {}
    } else {
      pdf.moveTo(x + 10, y + 70).lineTo(x + w - 10, y + 70).strokeColor("#111827").lineWidth(0.6).stroke();
    }
    put(`${firma?.nombre || "Pendiente"}${firma?.fecha ? ` - ${new Date(firma.fecha).toLocaleString("es-ES")}` : ""}`, x + 5, y + h - 22, w - 10, { size: 6.5 });
    if (firma?.hash) put(`SHA-256 ${firma.hash}`, x + 5, y + h - 12, w - 10, { size: 5, color: "#64748b" });
  };

  drawRect(left, 26, right - left, 82);
  if (logoBuffer) {
    try { pdf.image(logoBuffer, left + 8, 34, { fit: [48, 48] }); } catch {}
  }
  put(title, left + (logoBuffer ? 64 : 8), 34, 300, { bold: true, size: 12 });
  put(`${empresaNombre || docData.empresa?.nombre || "TransGest"}\nGenerado: ${createdAt.toLocaleString("es-ES")}`, left + (logoBuffer ? 64 : 8), 68, 300, { size: 7, color: "#475569" });
  put(`No. ${docData.referencia_pedido || docData.codigo_control || "-"}\nControl: ${docData.codigo_control || "-"}`, right - 194, 34, 110, { bold: true, size: 8 });
  if (qrBuffer) pdf.image(qrBuffer, right - 76, 32, { width: 66, height: 66 });
  else drawRect(right - 76, 32, 66, 66);

  let y = 114;
  const rowH = 58;
  box("1", "Remitente / Sender", cmrPartyLines(docData.cargador_contractual), left, y, colW, rowH);
  box("16", "Transportista / Carrier", cmrPartyLines(docData.transportista_efectivo), left + colW, y, colW, rowH);
  y += rowH;
  box("2", "Destinatario / Consignee", cmrAddressLines(docData.destino), left, y, colW, rowH);
  box("17", "Transportistas sucesivos / Successive carriers", (Array.isArray(docData.transportistas_sucesivos) ? docData.transportistas_sucesivos : []).map(t => [t.nombre, t.nif, t.domicilio].filter(Boolean).join(" | ")).join("\n") || "-", left + colW, y, colW, rowH);
  y += rowH;
  box("3", "Lugar de entrega / Place of delivery", [...cmrStopLines(docData.destino), `Previsto: ${cmrDate(docData.horarios?.fecha_descarga)} ${docData.horarios?.hora_descarga || docData.horarios?.ventana_descarga || ""}`], left, y, colW, rowH);
  box("18", "Reservas y observaciones / Reservations", docData.observaciones || "-", left + colW, y, colW, rowH);
  y += rowH;
  box("4", "Lugar y fecha de carga / Place and date of taking over", [...cmrStopLines(docData.origen), `Previsto: ${cmrDate(docData.horarios?.fecha_carga)} ${docData.horarios?.hora_carga || docData.horarios?.ventana_carga || ""}`], left, y, colW, rowH);
  box("19", "Acuerdos especiales / Special agreements", docData.condiciones?.acuerdos_especiales || "-", left + colW, y, colW, rowH);
  y += rowH;
  const anexosPdf = Array.isArray(docData.documentos_anexos) ? docData.documentos_anexos : [];
  const anexosPdfTexto = anexosPdf.length
    ? anexosPdf.slice(0, 5).map((item, idx) => `${idx + 1}. ${item.nombre || "Documento adjunto"}${item.tipo ? ` (${item.tipo})` : ""}`).join("\n")
    : "DCD/eCMR TransGest. Albaranes/POD pendientes de adjuntar al viaje.";
  box("5", "Documentos anexos / Documents attached", anexosPdfTexto, left, y, colW, 46);
  box("21", "Establecido en / Established in", `${docData.origen?.provincia || docData.origen?.pais || "Espana"} - ${cmrDate(generatedAt)}`, left + colW, y, colW, 46);
  y += 56;

  const goodsH = 64;
  const goodsCols = [82, 62, 72, 168, 70, 57];
  let x = left;
  ["6 Marcas y numeros", "7 Cantidad", "8 Embalaje", "9 Naturaleza mercancia", "11 Peso bruto", "12 Volumen"].forEach((h, idx) => {
    const w = goodsCols[idx];
    drawRect(x, y, w, goodsH);
    put(h, x + 4, y + 5, w - 8, { bold: true, size: 6.5, color: "#0f766e" });
    const value = [
      docData.mercancia?.marcas_numeros || "-",
      docData.mercancia?.bultos || "-",
      docData.mercancia?.embalaje || "-",
      docData.mercancia?.descripcion || "-",
      docData.mercancia?.peso_kg ? `${Number(docData.mercancia.peso_kg).toLocaleString("es-ES")} kg` : "-",
      docData.mercancia?.volumen || "-",
    ][idx];
    put(value, x + 4, y + 28, w - 8, { size: 7.5, height: 28 });
    x += w;
  });
  y += goodsH;

  box("15", "Reembolso / Cash on delivery", docData.condiciones?.reembolso_contra_entrega || "-", left, y, colW, 48);
  box("", "Vehiculo y chofer / Vehicle and driver", [
    `Tractora: ${docData.vehiculo?.tractora || "-"} | Remolque: ${docData.vehiculo?.remolque || "-"}`,
    `Chofer: ${[docData.chofer?.nombre, docData.chofer?.dni, docData.chofer?.telefono].filter(Boolean).join(" | ") || "-"}`,
  ], left + colW, y, colW, 48);
  y += 48;
  box("", "QR y verificacion / Verification", [`URL: ${qrUrl || "Sin enlace publico configurado"}`, `Codigo: ${docData.verificacion?.codigo_verificacion || "-"}`], left, y, right - left, 46);
  y += 56;

  const sigW = (right - left) / 3;
  const firmas = docData.firmas || {};
  signature("22", "Firma remitente / Sender signature", firmas.cargador, docData.cargador_contractual?.nombre || "", left, y, sigW, 96);
  signature("23", "Firma transportista / Carrier signature", firmas.chofer, [docData.chofer?.nombre, docData.chofer?.dni].filter(Boolean).join(" | "), left + sigW, y, sigW, 96);
  signature("24", "Firma destinatario / Consignee signature", firmas.destinatario, docData.destino?.destinatario || docData.destino?.nombre || "", left + sigW * 2, y, sigW, 96);
  y += 106;

  if (!publicView) {
    box("", "Condiciones operativas internas / Internal operational terms", [
      docData.condiciones?.revision_combustible || "",
      `Estado interoperabilidad: ${buildEcmrConsignmentNote(docData).status || "-"}`,
    ], left, y, right - left, 48);
  }
  put("Documento generado por TransGest. El QR abre el soporte alojado por empresa; la trazabilidad y los hashes se conservan en el repositorio DCD.", left, 810, right - left, { size: 6.5, color: "#475569" });
  const anexosImagenPdf = (Array.isArray(docData.documentos_anexos) ? docData.documentos_anexos : [])
    .filter(item => String(item.data_url || "").startsWith("data:image/"))
    .slice(0, 4);
  anexosImagenPdf.forEach((item, idx) => {
    const img = dataUrlBuffer(item.data_url);
    if (!img) return;
    pdf.addPage({ margin: 28 });
    put(`Anexo ${idx + 1}: ${item.nombre || "Documento adjunto"}`, left, 32, right - left, { bold: true, size: 12 });
    put([item.tipo, item.created_at ? `Subido: ${new Date(item.created_at).toLocaleString("es-ES")}` : ""].filter(Boolean).join(" | "), left, 50, right - left, { size: 8, color: "#475569" });
    try {
      pdf.image(img, left, 72, { fit: [right - left, 700], align: "center", valign: "top" });
    } catch {
      put("No se pudo renderizar la imagen adjunta en el PDF.", left, 90, right - left, { size: 9, color: "#b91c1c" });
    }
  });
  pdf.end();
  const buffer = await done;
  return {
    buffer,
    base64: buffer.toString("base64"),
    mime: "application/pdf",
    filename: buildDocumentoControlFilename(docData || {}),
    hash_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    metadata: {
      title: pdf.info.Title,
      author: pdf.info.Author,
      subject: pdf.info.Subject,
      creator: pdf.info.Creator,
      producer: pdf.info.Producer,
      creation_date: createdAt.toISOString(),
      modification_date: createdAt.toISOString(),
      qr_url: qrUrl || "",
      filename: buildDocumentoControlFilename(docData || {}),
    },
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = {
  DOC_CONTROL_DEFAULTS,
  normalizeDocumentoControlConfig,
  detectWasteSignals,
  detectTransportComplianceSignals,
  buildDocumentoControlPayload,
  buildDocumentoControlPublicPayload,
  buildDocumentoControlExpediente,
  buildDocumentoControlStructuredExport,
  buildDocumentoControlSignaturePackage,
  buildDocumentoControlQrDataUrl,
  buildDocumentoControlHtml: buildDocumentoControlCmrHtml,
  generateDocumentoControlPdf: generateDocumentoControlCmrPdf,
  buildDocumentoControlFilename,
  buildDocumentoControlExportFilename,
  buildDocumentoControlSignaturePackageFilename,
  buildPublicToken,
  buildPublicVerificationCode,
  verifyPublicToken,
  verifyPublicVerificationCode,
  buildPublicUrl,
};

