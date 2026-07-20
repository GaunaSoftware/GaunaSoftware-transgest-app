// Cálculo ADR en el cliente (mercancías peligrosas). Espeja la lógica del
// backend (services/adr.js) para el cálculo en vivo del formulario, sin
// necesidad del catálogo: solo usa los campos que el usuario ya ha rellenado.
// El catálogo de números ONU se consulta por API (getAdrCatalogo).

export const ADR_CLASSES = {
  "1": "Explosivos", "2.1": "Gases inflamables", "2.2": "Gases no inflamables",
  "2.3": "Gases tóxicos", "3": "Líquidos inflamables", "4.1": "Sólidos inflamables",
  "4.2": "Inflamación espontánea", "4.3": "Desprenden gases con agua",
  "5.1": "Comburentes", "5.2": "Peróxidos orgánicos", "6.1": "Tóxicos",
  "6.2": "Infecciosos", "7": "Radiactivos", "8": "Corrosivos", "9": "Diversos",
};

export const PACKING_GROUPS = ["I", "II", "III"];

// factor para la regla de los 1000 puntos (1.1.3.6). cat 0 = sin exención.
export const TRANSPORT_CATEGORIES = {
  0: { factor: null, label: "0 · sin exención por cantidad" },
  1: { factor: 50, label: "1 · máx 20" },
  2: { factor: 3, label: "2 · máx 333" },
  3: { factor: 1, label: "3 · máx 1000" },
  4: { factor: 0, label: "4 · sin límite" },
};

export const ADR_POINTS_LIMIT = 1000;

function toNum(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function emptyAdrItem() {
  return {
    un: "", nombre: "", clase: "", grupo_embalaje: "", codigo_tunel: "",
    categoria_transporte: "", cantidad: "", unidad: "L", num_bultos: "",
    tipo_bulto: "", peligro_ambiente: false,
  };
}

// Línea del documento de transporte (ADR 5.4.1.1.1).
export function buildTransportDocumentLine(item = {}) {
  const un = String(item.un || "").replace(/[^0-9]/g, "").slice(0, 4);
  const nombre = String(item.nombre || "").toUpperCase().trim();
  if (!un && !nombre) return "";
  const partes = [];
  partes.push(`UN ${un}`.trim());
  if (nombre) partes.push(nombre);
  if (item.clase) partes.push(String(item.clase));
  if (item.grupo_embalaje) partes.push(String(item.grupo_embalaje));
  const tunel = String(item.codigo_tunel || "").trim();
  if (tunel && tunel !== "-") partes.push(`(${tunel})`);
  let linea = partes.join(", ");
  if (item.peligro_ambiente) linea += ", PELIGROSO PARA EL MEDIO AMBIENTE";
  const cola = [];
  const bultos = toNum(item.num_bultos);
  if (bultos > 0) cola.push(`${bultos} ${item.tipo_bulto || "bulto(s)"}`.trim());
  const cant = toNum(item.cantidad);
  if (cant > 0) cola.push(`${cant} ${item.unidad || "L"}`.trim());
  if (cola.length) linea += ` - ${cola.join(", ")}`;
  return linea;
}

// Exención parcial 1.1.3.6 ("regla de los 1000 puntos").
export function calcExencion1136(items = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it && (it.un || it.nombre));
  let puntos = 0;
  let bloqueadoCat0 = false;
  for (const it of list) {
    const cat = it.categoria_transporte === 0 || it.categoria_transporte === "0"
      ? 0 : (it.categoria_transporte != null && it.categoria_transporte !== "" ? Number(it.categoria_transporte) : null);
    const cantidad = toNum(it.cantidad);
    if (cat === 0 && cantidad > 0) { bloqueadoCat0 = true; continue; }
    const def = cat != null ? TRANSPORT_CATEGORIES[cat] : null;
    if (def && def.factor != null) puntos += cantidad * def.factor;
  }
  const exento = !bloqueadoCat0 && puntos <= ADR_POINTS_LIMIT && list.length > 0;
  return {
    puntos: Math.round(puntos * 100) / 100,
    limite: ADR_POINTS_LIMIT,
    exento,
    bloqueado_categoria_0: bloqueadoCat0,
    aplica: list.length > 0,
    resumen: list.length === 0
      ? "Sin mercancía ADR declarada."
      : bloqueadoCat0
        ? "Hay materia de categoría 0: no cabe exención por cantidad → ADR completo."
        : exento
          ? `Exención parcial 1.1.3.6 aplicable (${Math.round(puntos)} ≤ 1000 puntos).`
          : `No exento: ${Math.round(puntos)} puntos > 1000 → ADR completo.`,
  };
}

// Requisitos operativos resumidos (para el checklist de carga en el cliente).
export function adrRequisitos(items = []) {
  const ex = calcExencion1136(items);
  const completo = ex.aplica && !ex.exento;
  return [
    { clave: "documento_transporte", etiqueta: "Documento de transporte ADR en cabina", obligatorio: ex.aplica },
    { clave: "carne_adr_conductor", etiqueta: "Carné ADR del conductor en vigor", obligatorio: completo },
    { clave: "instrucciones_escritas", etiqueta: "Instrucciones escritas (fichas 5.4.3)", obligatorio: completo },
    { clave: "placas_naranja", etiqueta: "Placas naranja / panel (5.3.2)", obligatorio: completo },
    { clave: "etiquetas_bultos", etiqueta: "Etiquetas de peligro y señalización", obligatorio: ex.aplica },
    { clave: "equipo_dotacion", etiqueta: "Equipo de a bordo (extintores, calzos, EPI)", obligatorio: completo },
  ];
}
