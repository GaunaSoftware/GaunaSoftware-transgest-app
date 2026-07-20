"use strict";

// ---------------------------------------------------------------------------
// Motor ADR (transporte de mercancias peligrosas por carretera).
//
// Basado en el Acuerdo ADR 2025 (obligatorio desde 01/07/2025). Cubre lo que
// necesita un TMS para preparar el viaje y el documento de transporte:
//   - Catalogo de numeros ONU mas habituales en transporte por carretera en
//     Espana (combustibles, gases, quimicos, residuos). Para cualquier ONU que
//     no este en el catalogo, el operador introduce los datos a mano.
//   - Linea del documento de transporte segun 5.4.1.1.1:
//       "UN 1202, GASOLEO, 3, III, (D/E)" [, PELIGROSO PARA EL MEDIO AMBIENTE]
//   - Exencion parcial 1.1.3.6 ("regla de los 1000 puntos"): categoria de
//     transporte 0-4, factores 50/3/1/0 y limite 1000.
//   - Requisitos de placas naranja, etiquetas, carne ADR del conductor,
//     certificado de aprobacion del vehiculo e instrucciones escritas.
//
// AVISO: es una herramienta de apoyo. El consejero de seguridad / expedidor es
// el responsable ultimo de la clasificacion y del documento definitivo.
// ---------------------------------------------------------------------------

// Clases de peligro ADR (col. 5 / etiquetas principales).
const ADR_CLASSES = {
  "1": "Materias y objetos explosivos",
  "2": "Gases",
  "2.1": "Gases inflamables",
  "2.2": "Gases no inflamables, no toxicos",
  "2.3": "Gases toxicos",
  "3": "Liquidos inflamables",
  "4.1": "Solidos inflamables",
  "4.2": "Materias que pueden experimentar inflamacion espontanea",
  "4.3": "Materias que en contacto con agua desprenden gases inflamables",
  "5.1": "Materias comburentes",
  "5.2": "Peroxidos organicos",
  "6.1": "Materias toxicas",
  "6.2": "Materias infecciosas",
  "7": "Materias radiactivas",
  "8": "Materias corrosivas",
  "9": "Materias y objetos peligrosos diversos",
};

// Grupos de embalaje (peligrosidad: I alta, II media, III baja).
const PACKING_GROUPS = ["I", "II", "III"];

// Categorias de transporte para la exencion 1.1.3.6.
//   factor: multiplicador de la cantidad para el calculo de puntos.
//   maxUnidad: cantidad maxima por unidad de transporte si solo hay esa categoria.
//   cat 0  -> nunca exenta (cualquier cantidad exige ADR completo).
//   cat 4  -> sin limite (no puntua).
const TRANSPORT_CATEGORIES = {
  0: { factor: null, maxUnidad: 0, label: "0 (sin exencion por cantidad)" },
  1: { factor: 50, maxUnidad: 20, label: "1" },
  2: { factor: 3, maxUnidad: 333, label: "2" },
  3: { factor: 1, maxUnidad: 1000, label: "3" },
  4: { factor: 0, maxUnidad: Infinity, label: "4 (sin limite)" },
};

const ADR_POINTS_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Catalogo de numeros ONU habituales. Nombre = designacion oficial de
// transporte (ADR, columna 2). tunel = codigo de restriccion en tunel
// (columna 15). cat = categoria de transporte (columna 15/1.1.3.6). ambiente =
// peligroso para el medio ambiente por defecto (se puede cambiar por viaje).
// hin = numero de identificacion de peligro (Kemler) para la placa naranja.
// ---------------------------------------------------------------------------
const UN_CATALOG = {
  "1202": { nombre: "GASOLEO (DIESEL) o ACEITE PARA CALEFACCION (LIGERO) o GASOIL", clase: "3", grupo: "III", tunel: "D/E", cat: 3, ambiente: true, hin: "30", etiquetas: ["3"] },
  "1203": { nombre: "GASOLINA (CARBURANTE PARA MOTORES)", clase: "3", grupo: "II", tunel: "D/E", cat: 2, ambiente: true, hin: "33", etiquetas: ["3"] },
  "1223": { nombre: "QUEROSENO", clase: "3", grupo: "III", tunel: "D/E", cat: 3, ambiente: true, hin: "30", etiquetas: ["3"] },
  "1268": { nombre: "DESTILADOS DE PETROLEO, N.E.P.", clase: "3", grupo: "II", tunel: "D/E", cat: 2, ambiente: true, hin: "33", etiquetas: ["3"] },
  "1863": { nombre: "COMBUSTIBLE PARA TURBINAS DE AVIACION", clase: "3", grupo: "III", tunel: "D/E", cat: 3, ambiente: true, hin: "30", etiquetas: ["3"] },
  "1170": { nombre: "ETANOL (ALCOHOL ETILICO) o ETANOL EN SOLUCION", clase: "3", grupo: "II", tunel: "D/E", cat: 2, ambiente: false, hin: "33", etiquetas: ["3"] },
  "1993": { nombre: "LIQUIDO INFLAMABLE, N.E.P.", clase: "3", grupo: "II", tunel: "D/E", cat: 2, ambiente: false, hin: "33", etiquetas: ["3"] },
  "1219": { nombre: "ISOPROPANOL (ALCOHOL ISOPROPILICO)", clase: "3", grupo: "II", tunel: "D/E", cat: 2, ambiente: false, hin: "33", etiquetas: ["3"] },
  "1090": { nombre: "ACETONA", clase: "3", grupo: "II", tunel: "D/E", cat: 2, ambiente: false, hin: "33", etiquetas: ["3"] },
  "1263": { nombre: "PINTURA o PRODUCTOS PARA PINTURA", clase: "3", grupo: "II", tunel: "D/E", cat: 2, ambiente: false, hin: "33", etiquetas: ["3"] },
  "3082": { nombre: "MATERIA LIQUIDA PELIGROSA PARA EL MEDIO AMBIENTE, N.E.P.", clase: "9", grupo: "III", tunel: "-", cat: 3, ambiente: true, hin: "90", etiquetas: ["9"] },
  "3077": { nombre: "MATERIA SOLIDA PELIGROSA PARA EL MEDIO AMBIENTE, N.E.P.", clase: "9", grupo: "III", tunel: "-", cat: 3, ambiente: true, hin: "90", etiquetas: ["9"] },
  // Gases (clase 2)
  "1965": { nombre: "HIDROCARBUROS GASEOSOS EN MEZCLA LICUADA, N.E.P. (GLP)", clase: "2.1", grupo: "", tunel: "B/D", cat: 2, ambiente: false, hin: "23", etiquetas: ["2.1"] },
  "1978": { nombre: "PROPANO", clase: "2.1", grupo: "", tunel: "B/D", cat: 2, ambiente: false, hin: "23", etiquetas: ["2.1"] },
  "1011": { nombre: "BUTANO", clase: "2.1", grupo: "", tunel: "B/D", cat: 2, ambiente: false, hin: "23", etiquetas: ["2.1"] },
  "1972": { nombre: "GAS NATURAL LICUADO (GNL) o METANO LICUADO REFRIGERADO", clase: "2.1", grupo: "", tunel: "B/D", cat: 2, ambiente: false, hin: "223", etiquetas: ["2.1"] },
  "1049": { nombre: "HIDROGENO COMPRIMIDO", clase: "2.1", grupo: "", tunel: "B/D", cat: 1, ambiente: false, hin: "23", etiquetas: ["2.1"] },
  "1072": { nombre: "OXIGENO COMPRIMIDO", clase: "2.2", grupo: "", tunel: "C/D", cat: 3, ambiente: false, hin: "25", etiquetas: ["2.2", "5.1"] },
  "1013": { nombre: "DIOXIDO DE CARBONO", clase: "2.2", grupo: "", tunel: "-", cat: 3, ambiente: false, hin: "20", etiquetas: ["2.2"] },
  "1066": { nombre: "NITROGENO COMPRIMIDO", clase: "2.2", grupo: "", tunel: "-", cat: 3, ambiente: false, hin: "20", etiquetas: ["2.2"] },
  "1005": { nombre: "AMONIACO ANHIDRO", clase: "2.3", grupo: "", tunel: "C/D", cat: 1, ambiente: true, hin: "268", etiquetas: ["2.3", "8"] },
  "1791": { nombre: "HIPOCLORITO EN SOLUCION (LEJIA)", clase: "8", grupo: "III", tunel: "E", cat: 3, ambiente: true, hin: "80", etiquetas: ["8"] },
  "1789": { nombre: "ACIDO CLORHIDRICO", clase: "8", grupo: "II", tunel: "E", cat: 2, ambiente: false, hin: "80", etiquetas: ["8"] },
  "1830": { nombre: "ACIDO SULFURICO con mas del 51% de acido", clase: "8", grupo: "II", tunel: "E", cat: 2, ambiente: false, hin: "80", etiquetas: ["8"] },
  "1824": { nombre: "HIDROXIDO DE SODIO EN SOLUCION (SOSA CAUSTICA)", clase: "8", grupo: "II", tunel: "E", cat: 2, ambiente: false, hin: "80", etiquetas: ["8"] },
  "2794": { nombre: "ACUMULADORES ELECTRICOS con electrolito liquido acido", clase: "8", grupo: "", tunel: "-", cat: 3, ambiente: false, hin: "80", etiquetas: ["8"] },
  "3480": { nombre: "BATERIAS DE ION LITIO (incluidas las de polimero de litio)", clase: "9", grupo: "", tunel: "E", cat: 2, ambiente: false, hin: "90", etiquetas: ["9A"] },
  "3481": { nombre: "BATERIAS DE ION LITIO CONTENIDAS EN UN EQUIPO o EMBALADAS CON UN EQUIPO", clase: "9", grupo: "", tunel: "E", cat: 2, ambiente: false, hin: "90", etiquetas: ["9A"] },
  "3090": { nombre: "BATERIAS DE METAL LITIO", clase: "9", grupo: "", tunel: "E", cat: 2, ambiente: false, hin: "90", etiquetas: ["9A"] },
  "1950": { nombre: "AEROSOLES", clase: "2.1", grupo: "", tunel: "D", cat: 3, ambiente: false, hin: "", etiquetas: ["2.1"] },
  "3175": { nombre: "SOLIDOS QUE CONTIENEN LIQUIDO INFLAMABLE, N.E.P.", clase: "4.1", grupo: "II", tunel: "E", cat: 2, ambiente: false, hin: "40", etiquetas: ["4.1"] },
  "1942": { nombre: "NITRATO AMONICO con no mas del 0,2% de materia combustible", clase: "5.1", grupo: "III", tunel: "E", cat: 3, ambiente: false, hin: "50", etiquetas: ["5.1"] },
  "2031": { nombre: "ACIDO NITRICO", clase: "8", grupo: "II", tunel: "C/D", cat: 2, ambiente: false, hin: "80", etiquetas: ["8"] },
  "1863b": { nombre: "", clase: "", grupo: "", tunel: "", cat: 3, ambiente: false, hin: "", etiquetas: [] }, // reservado
};
delete UN_CATALOG["1863b"];

function cleanUn(value) {
  return String(value == null ? "" : value).replace(/[^0-9]/g, "").slice(0, 4);
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// Devuelve los datos de catalogo de un numero ONU (o null si no esta).
function lookupUn(unRaw) {
  const un = cleanUn(unRaw);
  if (!un) return null;
  const base = UN_CATALOG[un];
  if (!base) return null;
  return { un, ...base };
}

// Sugerencias para autocompletar en la UI (texto -> lista de ONU).
function searchUn(query, limit = 12) {
  const q = String(query || "").trim().toLowerCase();
  const out = [];
  for (const [un, data] of Object.entries(UN_CATALOG)) {
    if (!data.nombre) continue;
    if (!q || un.includes(q.replace(/[^0-9]/g, "")) || data.nombre.toLowerCase().includes(q)) {
      out.push({ un, nombre: data.nombre, clase: data.clase, grupo: data.grupo, tunel: data.tunel, cat: data.cat, ambiente: data.ambiente });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// Normaliza un item ADR (una mercancia peligrosa del viaje) rellenando desde el
// catalogo lo que falte, sin pisar lo que el operador haya introducido a mano.
function normalizeItem(item = {}) {
  const un = cleanUn(item.un ?? item.un_number ?? item.numero_onu);
  const cat = lookupUn(un);
  const pick = (a, b) => {
    const v = a == null || a === "" ? undefined : a;
    return v !== undefined ? v : (b == null ? "" : b);
  };
  const categoria = item.categoria_transporte ?? item.cat;
  const categoriaNum = categoria === 0 || categoria === "0"
    ? 0
    : (categoria != null && categoria !== "" ? Number(categoria) : (cat ? cat.cat : null));
  return {
    un,
    nombre: String(pick(item.nombre ?? item.designacion, cat && cat.nombre)).toUpperCase(),
    clase: String(pick(item.clase ?? item.adr_class, cat && cat.clase)),
    grupo_embalaje: String(pick(item.grupo_embalaje ?? item.packing_group, cat && cat.grupo)),
    codigo_tunel: String(pick(item.codigo_tunel ?? item.tunnel_code, cat && cat.tunel)),
    categoria_transporte: Number.isFinite(categoriaNum) ? categoriaNum : null,
    cantidad: toNumber(item.cantidad),
    unidad: String(item.unidad || (String(pick(item.clase, cat && cat.clase)) === "2" ? "kg" : "L")).trim() || "L",
    num_bultos: item.num_bultos != null && item.num_bultos !== "" ? Math.max(0, Math.trunc(toNumber(item.num_bultos))) : null,
    tipo_bulto: String(item.tipo_bulto || "").trim(),
    peligro_ambiente: item.peligro_ambiente != null ? !!item.peligro_ambiente : !!(cat && cat.ambiente),
    hin: String(pick(item.hin, cat && cat.hin)),
    etiquetas: Array.isArray(item.etiquetas) && item.etiquetas.length ? item.etiquetas : (cat ? cat.etiquetas : []),
  };
}

// Linea del documento de transporte segun ADR 5.4.1.1.1:
//   UN <n>, <NOMBRE>, <clase>, <grupo>, (<tunel>)[, PELIGROSO PARA EL MEDIO AMBIENTE]
// mas, al final, numero/tipo de bultos y cantidad total.
function buildTransportDocumentLine(itemRaw = {}) {
  const it = normalizeItem(itemRaw);
  if (!it.un && !it.nombre) return "";
  const partes = [];
  partes.push(`UN ${it.un}`.trim());
  if (it.nombre) partes.push(it.nombre);
  if (it.clase) partes.push(it.clase);
  if (it.grupo_embalaje) partes.push(it.grupo_embalaje);
  if (it.codigo_tunel && it.codigo_tunel !== "-") partes.push(`(${it.codigo_tunel})`);
  let linea = partes.join(", ");
  if (it.peligro_ambiente) linea += ", PELIGROSO PARA EL MEDIO AMBIENTE";
  const cola = [];
  if (it.num_bultos) cola.push(`${it.num_bultos} ${it.tipo_bulto || "bulto(s)"}`.trim());
  if (it.cantidad > 0) cola.push(`${it.cantidad} ${it.unidad}`.trim());
  if (cola.length) linea += ` - ${cola.join(", ")}`;
  return linea;
}

// Exencion parcial 1.1.3.6 (regla de los 1000 puntos). Recibe la lista de items.
function calcExencion1136(itemsRaw = []) {
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map(normalizeItem).filter(it => it.un || it.nombre);
  let puntos = 0;
  let bloqueadoCat0 = false;
  const detalle = [];
  for (const it of items) {
    const catNum = it.categoria_transporte;
    const catDef = catNum != null && TRANSPORT_CATEGORIES[catNum] ? TRANSPORT_CATEGORIES[catNum] : null;
    const factor = catDef ? catDef.factor : null;
    let subtotal = 0;
    if (catNum === 0 && it.cantidad > 0) {
      bloqueadoCat0 = true;
    } else if (factor != null) {
      subtotal = it.cantidad * factor;
      puntos += subtotal;
    }
    detalle.push({ un: it.un, nombre: it.nombre, categoria: catNum, factor, cantidad: it.cantidad, subtotal });
  }
  const exento = !bloqueadoCat0 && puntos <= ADR_POINTS_LIMIT && items.length > 0;
  return {
    puntos: Math.round(puntos * 100) / 100,
    limite: ADR_POINTS_LIMIT,
    exento,
    bloqueado_categoria_0: bloqueadoCat0,
    detalle,
    // En exencion 1.1.3.6 no hacen falta placas naranja, panel, etiquetas de
    // vehiculo, extintores especificos ni ADR del conductor; el documento de
    // transporte y algunos requisitos basicos SI se mantienen.
    resumen: items.length === 0
      ? "Sin mercancia ADR declarada."
      : bloqueadoCat0
        ? "Hay materia de categoria 0: no cabe exencion por cantidad, ADR completo."
        : exento
          ? `Exencion parcial 1.1.3.6 aplicable (${Math.round(puntos)} <= 1000 puntos).`
          : `No exento: ${Math.round(puntos)} puntos > 1000. Aplica ADR completo.`,
  };
}

// Requisitos operativos del viaje ADR (para checklist de carga y validacion).
function buildRequisitos(itemsRaw = [], opts = {}) {
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map(normalizeItem).filter(it => it.un || it.nombre);
  const exencion = calcExencion1136(items);
  const completo = items.length > 0 && !exencion.exento; // ADR completo (no exento)
  const clases = Array.from(new Set(items.map(it => it.clase).filter(Boolean)));
  const tuneles = Array.from(new Set(items.map(it => it.codigo_tunel).filter(t => t && t !== "-")));
  const requisitos = [];
  const add = (clave, etiqueta, obligatorio, detalle) => requisitos.push({ clave, etiqueta, obligatorio, detalle });

  add("documento_transporte", "Documento de transporte ADR (5.4.1) en cabina", items.length > 0,
    "Con numero ONU, designacion oficial, clase, grupo de embalaje, codigo de tunel, numero y tipo de bultos y cantidad total.");
  add("carne_adr_conductor", "Carne ADR del conductor en vigor", completo,
    "Formacion ADR (8.2) valida para las clases transportadas. No exigible bajo exencion 1.1.3.6.");
  add("instrucciones_escritas", "Instrucciones escritas (fichas de seguridad 5.4.3)", completo,
    "Un ejemplar por unidad de transporte, en idioma que el conductor entienda.");
  add("placas_naranja", "Placas naranja / panel (5.3.2)", completo,
    tuneles.length ? `Numero de peligro (Kemler) y numero ONU. Restriccion de tunel: ${tuneles.join(", ")}.` : "Placas naranja delante y detras de la unidad.");
  add("etiquetas_bultos", "Etiquetas de peligro en bultos y senalizacion (5.2 / 5.3)", items.length > 0,
    clases.length ? `Etiquetas de las clases: ${clases.join(", ")}.` : "Etiquetas de peligro segun clase.");
  add("equipo_dotacion", "Equipo de a bordo (8.1.5): extintores, calzos, EPI", completo,
    "Extintores segun MMA, calzo, dos senales autoportantes, liquido lavaojos y EPI de la ficha.");
  add("certificado_vehiculo", "Certificado de aprobacion ADR del vehiculo (9.1.3)", completo && items.some(it => opts.cisterna || String(it.clase).startsWith("1")),
    "Solo cisternas (FL/AT/OX) y vehiculos EX. No exigible para bultos en vehiculo normal.");
  add("segregacion", "Segregacion y estiba compatible (7.5.2)", clases.length > 1,
    "Comprobar prohibiciones de carga en comun entre clases distintas.");

  return {
    aplica: items.length > 0,
    exencion,
    adr_completo: completo,
    clases,
    tuneles,
    requisitos,
  };
}

// Validacion de datos obligatorios del documento de transporte por item.
function validateItems(itemsRaw = []) {
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map(normalizeItem);
  const errores = [];
  items.forEach((it, idx) => {
    if (!it.un && !it.nombre) return;
    const falta = [];
    if (!it.un) falta.push("numero ONU");
    if (!it.nombre) falta.push("designacion oficial");
    if (!it.clase) falta.push("clase");
    // Grupo de embalaje no aplica a clase 2 ni a algunos de clase 1/7.
    if (!it.grupo_embalaje && !["2", "2.1", "2.2", "2.3", "1", "7"].includes(it.clase)) falta.push("grupo de embalaje");
    if (it.categoria_transporte == null) falta.push("categoria de transporte");
    if (!(it.cantidad > 0)) falta.push("cantidad");
    if (falta.length) errores.push({ index: idx, un: it.un, faltan: falta });
  });
  return { valido: errores.length === 0, errores };
}

module.exports = {
  ADR_CLASSES,
  PACKING_GROUPS,
  TRANSPORT_CATEGORIES,
  ADR_POINTS_LIMIT,
  UN_CATALOG,
  lookupUn,
  searchUn,
  normalizeItem,
  buildTransportDocumentLine,
  calcExencion1136,
  buildRequisitos,
  validateItems,
};
