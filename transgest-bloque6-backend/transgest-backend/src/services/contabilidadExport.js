// ─────────────────────────────────────────────────────────────────────────
// Exportacion de facturas emitidas hacia programas de contabilidad externos.
//
// Formatos implementados segun la documentacion oficial de cada fabricante:
//
//  - CONTASOL / FACTUSOL (Software DELSOL / TeamSystem): fichero "APU.xlsx"
//    (apuntes de diario). Estructura de columnas A..Q tomada del manual
//    "ContaSOL - Importacion Excel/Calc" (sdelsol.es). Se importa desde
//    Utilidades > Importaciones > Archivos > .XLSX/.XLS.
//
//  - a3ASESOR |eco |con (Wolters Kluwer): fichero "SUENLACE.DAT", ASCII de
//    registros SECUENCIALES de 256 bytes. Estructura tomada del manual oficial
//    "Enlace contable de entrada. Descripcion de registros". Se importa desde
//    Utilidades > Importar/Exportar > Enlace Contable.
//
// Ninguno de los dos programas ofrece API: ambos son importacion por fichero.
// El asiento generado para una factura emitida (IVA repercutido) es:
//    Debe  430 Cliente          total
//    Debe  473 Retencion IRPF   cuota_irpf   (solo si hay retencion)
//    Haber 705 Ventas           base_imponible
//    Haber 477 IVA repercutido  cuota_iva
// ─────────────────────────────────────────────────────────────────────────
const zlib = require("zlib");

// Cuentas por defecto (PGC espanol). Configurables por empresa al exportar.
const CUENTAS_DEFECTO = {
  cliente: "4300000",     // Clientes
  ventas: "7050000",      // Prestaciones de servicios (transporte)
  iva_repercutido: "4770000",
  retencion: "4730000",   // H.P. retenciones y pagos a cuenta
  digitos: 7,             // longitud de cuenta del plan contable
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
}

// Ajusta una cuenta a la longitud de digitos del plan contable: se completa con
// ceros por la derecha (4300000 -> 43000000 si el plan es de 8 digitos).
function cuentaConDigitos(cuenta, digitos) {
  const base = String(cuenta || "").replace(/\D/g, "");
  const len = Math.max(3, Math.min(12, Number(digitos) || CUENTAS_DEFECTO.digitos));
  if (base.length >= len) return base.slice(0, len);
  return base.padEnd(len, "0");
}

// Subcuenta de cliente: raiz (430) + contador, respetando la longitud del plan.
function cuentaCliente(raiz, indice, digitos) {
  const len = Math.max(3, Math.min(12, Number(digitos) || CUENTAS_DEFECTO.digitos));
  const prefijo = String(raiz || CUENTAS_DEFECTO.cliente).replace(/\D/g, "").slice(0, 3) || "430";
  const restantes = Math.max(1, len - prefijo.length);
  const sufijo = String(Math.max(1, Number(indice) || 1)).padStart(restantes, "0").slice(-restantes);
  return `${prefijo}${sufijo}`;
}

function fechaDDMMAAAA(value) {
  const iso = String(value || "").slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function fechaAAAAMMDD(value) {
  const iso = String(value || "").slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}`;
}

// Reparte las facturas en subcuentas de cliente estables (por cliente_id).
function mapaCuentasCliente(facturas = [], opciones = {}) {
  const raiz = opciones.cuenta_cliente || CUENTAS_DEFECTO.cliente;
  const digitos = opciones.digitos || CUENTAS_DEFECTO.digitos;
  const mapa = new Map();
  let siguiente = 1;
  for (const f of facturas) {
    const key = String(f.cliente_id || f.cliente_cif || f.cliente_nombre || "sin-cliente");
    if (!mapa.has(key)) {
      mapa.set(key, cuentaCliente(raiz, siguiente, digitos));
      siguiente += 1;
    }
  }
  return mapa;
}

// Lineas contables de una factura emitida (asiento cuadrado).
function lineasAsientoFactura(factura, cuentas, cuentaClienteFactura) {
  const base = round2(factura.base_imponible);
  const iva = round2(factura.cuota_iva);
  const irpf = round2(factura.cuota_irpf);
  const total = round2(factura.total);
  const concepto = `S/Fra ${factura.numero || ""} ${factura.cliente_nombre || ""}`.trim().slice(0, 40);
  const lineas = [
    { cuenta: cuentaClienteFactura, nombre: String(factura.cliente_nombre || "Cliente").slice(0, 30), debe: total, haber: 0, concepto },
  ];
  if (irpf > 0) {
    lineas.push({ cuenta: cuentas.retencion, nombre: "H.P. retenciones y pagos a cuenta", debe: irpf, haber: 0, concepto });
  }
  lineas.push({ cuenta: cuentas.ventas, nombre: "Prestaciones de servicios", debe: 0, haber: base, concepto });
  if (iva > 0) {
    lineas.push({ cuenta: cuentas.iva_repercutido, nombre: "H.P. IVA repercutido", debe: 0, haber: iva, concepto, tipo_iva: "R" });
  }
  return lineas;
}

function resolverCuentas(opciones = {}) {
  const digitos = Number(opciones.digitos) || CUENTAS_DEFECTO.digitos;
  return {
    digitos,
    cliente: opciones.cuenta_cliente || CUENTAS_DEFECTO.cliente,
    ventas: cuentaConDigitos(opciones.cuenta_ventas || CUENTAS_DEFECTO.ventas, digitos),
    iva_repercutido: cuentaConDigitos(opciones.cuenta_iva || CUENTAS_DEFECTO.iva_repercutido, digitos),
    retencion: cuentaConDigitos(opciones.cuenta_retencion || CUENTAS_DEFECTO.retencion, digitos),
  };
}

// ── CONTASOL / FACTUSOL: filas del fichero APU ───────────────────────────
// Col: A Diario | B Fecha | C Asiento | D Orden | E Cuenta | F Importe ptas |
//      G Concepto | H Documento | I Debe EUR | J Haber EUR | K Moneda |
//      L Punteo | M Tipo IVA | N Cod. IVA | O Depto | P Subdepto | Q Imagen
function buildContasolApuRows(facturas = [], opciones = {}) {
  const cuentas = resolverCuentas(opciones);
  const mapaCliente = mapaCuentasCliente(facturas, { ...opciones, digitos: cuentas.digitos });
  const diario = Number(opciones.diario) || 1;
  let asiento = Number(opciones.asiento_inicial) || 1;
  const filas = [];
  for (const f of facturas) {
    const key = String(f.cliente_id || f.cliente_cif || f.cliente_nombre || "sin-cliente");
    const ctaCliente = mapaCliente.get(key);
    const fecha = fechaDDMMAAAA(f.fecha);
    // "Documento" en CONTASOL son solo 5 caracteres: se usa el numero correlativo
    // final de la factura (A-2026-0001 -> "0001"), no los ultimos 5 caracteres
    // literales (que dejarian un guion: "-0001").
    const numeroLimpio = String(f.numero || "").trim();
    const correlativo = (numeroLimpio.match(/(\d+)\s*$/) || [])[1] || numeroLimpio.replace(/\W+/g, "");
    const documento = correlativo.slice(-5);
    const lineas = lineasAsientoFactura(f, cuentas, ctaCliente);
    lineas.forEach((linea, idx) => {
      filas.push([
        diario,                                   // A Diario
        fecha,                                    // B Fecha
        asiento,                                  // C Asiento
        idx + 1,                                  // D Orden
        cuentaConDigitos(linea.cuenta, cuentas.digitos), // E Cuenta
        0,                                        // F Importe en pesetas
        linea.concepto,                           // G Concepto
        documento,                                // H Documento
        round2(linea.debe),                       // I Importe debe euros
        round2(linea.haber),                      // J Importe haber euros
        "E",                                      // K Moneda (Euros)
        0,                                        // L Punteo
        linea.tipo_iva || "",                     // M Tipo de IVA (R = repercutido)
        "",                                       // N Codigo de IVA
        "",                                       // O Departamento
        "",                                       // P Subdepartamento
        "",                                       // Q Archivo de imagen
      ]);
    });
    asiento += 1;
  }
  return filas;
}

// ── a3ASESOR: SUENLACE.DAT (registros de 256 bytes) ──────────────────────
// Marcas diacriticas (U+0300-U+036F) en ASCII puro, para no depender de que el
// fichero fuente conserve caracteres no-ASCII.
const RE_DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

function a3Texto(value, longitud) {
  // Sin acentos ni caracteres fuera de ASCII imprimible, longitud fija.
  const limpio = String(value == null ? "" : value)
    .normalize("NFD").replace(RE_DIACRITICOS, "")
    .replace(/[^\x20-\x7E]/g, " ");
  return limpio.slice(0, longitud).padEnd(longitud, " ");
}

function a3Numero(value, longitud) {
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  return String(n).padStart(longitud, "0").slice(-longitud);
}

// Importe A3: signo + 10 enteros + "." + 2 decimales = 14 caracteres.
function a3Importe(value) {
  const n = round2(value);
  const signo = n < 0 ? "-" : "+";
  const abs = Math.abs(n);
  const enteros = String(Math.trunc(abs)).padStart(10, "0").slice(-10);
  const dec = String(Math.round((abs - Math.trunc(abs)) * 100)).padStart(2, "0").slice(-2);
  return `${signo}${enteros}.${dec}`;
}

// Porcentaje A3: "xx.xx" = 5 caracteres.
function a3Porcentaje(value) {
  const n = Math.max(0, round2(value));
  const enteros = String(Math.trunc(n)).padStart(2, "0").slice(-2);
  const dec = String(Math.round((n - Math.trunc(n)) * 100)).padStart(2, "0").slice(-2);
  return `${enteros}.${dec}`;
}

function a3Registro(campos) {
  // Cada registro son exactamente 256 caracteres.
  const linea = campos.join("");
  return linea.length >= 256 ? linea.slice(0, 256) : linea.padEnd(256, " ");
}

function buildA3Suenlace(facturas = [], opciones = {}) {
  const cuentas = resolverCuentas(opciones);
  const mapaCliente = mapaCuentasCliente(facturas, { ...opciones, digitos: cuentas.digitos });
  const empresa = a3Numero(opciones.codigo_empresa || 1, 5);
  const registros = [];

  for (const f of facturas) {
    const key = String(f.cliente_id || f.cliente_cif || f.cliente_nombre || "sin-cliente");
    const ctaCliente = cuentaConDigitos(mapaCliente.get(key), cuentas.digitos);
    const fecha = fechaAAAAMMDD(f.fecha);
    if (!fecha) continue;
    const doc = a3Texto(String(f.numero || "").slice(-10), 10);
    const concepto = a3Texto(`S/Fra ${f.numero || ""}`, 30);
    const esAbono = round2(f.total) < 0 || String(f.tipo || "").toLowerCase().includes("rectificativa");

    // Tipo 1 (factura) / 2 (rectificativa-abono): cabecera con el total.
    registros.push(a3Registro([
      "4",                                        // 1     Tipo de formato (constante 4)
      empresa,                                    // 2-6   Codigo de empresa
      fecha,                                      // 7-14  Fecha del apunte (aaaammdd)
      esAbono ? "2" : "1",                        // 15    Tipo de registro
      a3Texto(ctaCliente, 12),                    // 16-27 Cuenta (cliente)
      a3Texto(f.cliente_nombre || "Cliente", 30), // 28-57 Descripcion de la cuenta
      "1",                                        // 58    Tipo de factura (1 = Ventas)
      doc,                                        // 59-68 Numero de factura
      "I",                                        // 69    Linea de apunte (Inicio)
      concepto,                                   // 70-99 Descripcion del apunte
      a3Importe(f.total),                         // 100-113 Importe (total factura)
      a3Texto("", 62),                            // 114-175 Reserva
      a3Texto(f.cliente_cif || "", 14),           // 176-189 NIF cliente
      a3Texto(f.cliente_nombre || "", 40),        // 190-229 Nombre cliente
      a3Texto(f.cliente_cp || "", 5),             // 230-234 Codigo postal
      a3Texto("", 2),                             // 235-236 Reserva
      fecha,                                      // 237-244 Fecha de operacion
    ]));

    // Tipo 9: detalle de IVA (base, % IVA, cuota) contra la cuenta de ventas.
    registros.push(a3Registro([
      "4",                                        // 1     Tipo de formato
      empresa,                                    // 2-6   Codigo de empresa
      fecha,                                      // 7-14  Fecha
      "9",                                        // 15    Tipo de registro (detalle IVA)
      a3Texto(cuentas.ventas, 12),                // 16-27 Cuenta de ventas
      a3Texto("Prestaciones de servicios", 30),   // 28-57 Descripcion de la cuenta
      esAbono ? "A" : "C",                        // 58    C = cargo, A = abono
      doc,                                        // 59-68 Numero de factura
      "U",                                        // 69    Ultima linea del asiento
      concepto,                                   // 70-99 Descripcion del apunte
      "01",                                       // 100-101 Subtipo (01 = interiores sujetas)
      a3Importe(f.base_imponible),                // 102-115 Base imponible
      a3Porcentaje(f.tipo_iva),                   // 116-120 % de IVA
      a3Importe(f.cuota_iva),                     // 121-134 Cuota de IVA
      a3Porcentaje(0),                            // 135-139 % de recargo
      a3Importe(0),                               // 140-153 Cuota de recargo
      a3Porcentaje(f.tipo_irpf),                  // 154-158 % de retencion
      a3Importe(f.cuota_irpf),                    // 159-172 Cuota de retencion
      a3Texto("", 2),                             // 173-174 Impreso
    ]));
  }

  // A3 espera ASCII/latin-1, no UTF-8.
  return Buffer.from(registros.map(r => `${r}\r\n`).join(""), "latin1");
}

// ── Escritor XLSX minimo (sin dependencias) ──────────────────────────────
// Genera un .xlsx valido (ZIP con entradas DEFLATE) con una unica hoja. Se usa
// para el fichero APU de CONTASOL, que exige .xlsx/.xls/.ods (no admite CSV).
const CRC_TABLA = (() => {
  const tabla = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    tabla[i] = c;
  }
  return tabla;
})();

function crc32(buf) {
  let c = 0 ^ (-1);
  for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ CRC_TABLA[(c ^ buf[i]) & 0xFF];
  return (c ^ (-1)) >>> 0;
}

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function columnaExcel(indice) {
  let n = indice + 1;
  let nombre = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    nombre = String.fromCharCode(65 + resto) + nombre;
    n = Math.floor((n - resto) / 26);
  }
  return nombre;
}

function hojaXml(filas) {
  const cuerpo = filas.map((fila, r) => {
    const celdas = fila.map((valor, c) => {
      const ref = `${columnaExcel(c)}${r + 1}`;
      if (valor === "" || valor === null || valor === undefined) return "";
      if (typeof valor === "number" && Number.isFinite(valor)) {
        return `<c r="${ref}"><v>${valor}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(valor)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${cuerpo}</sheetData></worksheet>`;
}

function buildXlsx(filas = [], nombreHoja = "APU") {
  const archivos = [
    ["[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      + `</Types>`],
    ["_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + `</Relationships>`],
    ["xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + `<sheets><sheet name="${escapeXml(nombreHoja).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
      + `</Relationships>`],
    ["xl/worksheets/sheet1.xml", hojaXml(filas)],
  ];

  const locales = [];
  const central = [];
  let offset = 0;
  for (const [nombre, contenido] of archivos) {
    const nombreBuf = Buffer.from(nombre, "utf8");
    const datos = Buffer.from(contenido, "utf8");
    const comprimido = zlib.deflateRawSync(datos);
    const crc = crc32(datos);

    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0);   // firma local
    cabecera.writeUInt16LE(20, 4);           // version necesaria
    cabecera.writeUInt16LE(0, 6);            // flags
    cabecera.writeUInt16LE(8, 8);            // metodo deflate
    cabecera.writeUInt16LE(0, 10);           // hora
    cabecera.writeUInt16LE(0x21, 12);        // fecha (1980-01-01)
    cabecera.writeUInt32LE(crc, 14);
    cabecera.writeUInt32LE(comprimido.length, 18);
    cabecera.writeUInt32LE(datos.length, 22);
    cabecera.writeUInt16LE(nombreBuf.length, 26);
    cabecera.writeUInt16LE(0, 28);
    locales.push(cabecera, nombreBuf, comprimido);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);        // firma directorio central
    dir.writeUInt16LE(20, 4);                // version creador
    dir.writeUInt16LE(20, 6);                // version necesaria
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(comprimido.length, 20);
    dir.writeUInt32LE(datos.length, 24);
    dir.writeUInt16LE(nombreBuf.length, 28);
    dir.writeUInt16LE(0, 30);                // extra
    dir.writeUInt16LE(0, 32);                // comentario
    dir.writeUInt16LE(0, 34);                // disco
    dir.writeUInt16LE(0, 36);                // atributos internos
    dir.writeUInt32LE(0, 38);                // atributos externos
    dir.writeUInt32LE(offset, 42);           // offset de la cabecera local
    central.push(dir, nombreBuf);

    offset += cabecera.length + nombreBuf.length + comprimido.length;
  }

  const centralBuf = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(centralBuf.length, 12);
  fin.writeUInt32LE(offset, 16);
  fin.writeUInt16LE(0, 20);
  return Buffer.concat([...locales, centralBuf, fin]);
}

function buildContasolApuXlsx(facturas = [], opciones = {}) {
  return buildXlsx(buildContasolApuRows(facturas, opciones), "APU");
}

// CSV alternativo (para revisar el contenido o importar en otras herramientas).
function buildContasolApuCsv(facturas = [], opciones = {}) {
  const filas = buildContasolApuRows(facturas, opciones);
  const cabecera = [
    "Diario", "Fecha", "Asiento", "Orden", "Cuenta", "ImportePesetas", "Concepto",
    "Documento", "DebeEuros", "HaberEuros", "Moneda", "Punteo", "TipoIVA",
    "CodigoIVA", "Departamento", "Subdepartamento", "ArchivoImagen",
  ];
  const celda = v => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return Buffer.from(
    [cabecera.join(";"), ...filas.map(f => f.map(celda).join(";"))].join("\r\n"),
    "latin1"
  );
}

module.exports = {
  CUENTAS_DEFECTO,
  buildA3Suenlace,
  buildContasolApuCsv,
  buildContasolApuRows,
  buildContasolApuXlsx,
  buildXlsx,
  // exportados para pruebas
  a3Importe,
  a3Porcentaje,
  cuentaConDigitos,
  lineasAsientoFactura,
  resolverCuentas,
};
