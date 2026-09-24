const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { HEADERS, REQUIRED, mapHeaders } = require('./importCatalog');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_ROWS = 100000;
const MAX_COLUMNS = 70;
const NUMERIC = new Set('precio,km,peso_kg,bultos,km_ruta,km_vacio,importe,precio_colaborador,coste_gasoil,coste_peajes,coste_dietas,coste_otros,total,cobrado,saldo_pendiente,linea,coste_proveedor,beneficio_origen,iva_pct,litros,precio_litro,km_odometro'.split(','));
const DATES = new Set('fecha,fecha_nacimiento,fecha_alta,fecha_emision,fecha_vencimiento,fecha_carga,fecha_descarga,fecha_factura_proveedor,periodo_desde,periodo_hasta,fecha_desde,fecha_hasta'.split(','));
const COST_TYPES = new Set('peaje,combustible_agregado,parking,ferry,adblue,dieta,lavado,recambios,mantenimiento,renting_leasing,itv,otros_costes_flota'.split(','));

function reject(message, code = 'IMPORT_FILE_INVALID', status = 422) {
  throw Object.assign(new Error(message), { code, status });
}

function inspectZip(buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) reject('XLSX no válido: se esperaba un ZIP');
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) reject('XLSX sin directorio ZIP');
  const count = buffer.readUInt16LE(eocd + 10);
  const size = buffer.readUInt32LE(eocd + 12);
  const start = buffer.readUInt32LE(eocd + 16);
  if (count === 0 || count > 256 || size === 0xffffffff || start === 0xffffffff || start + size > eocd) reject('XLSX demasiado grande o ZIP64 no admitido', 'ZIP_LIMIT');
  let cursor = start;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > start + size || buffer.readUInt32LE(cursor) !== 0x02014b50) reject('Directorio ZIP no válido');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || (flags & 1) || ![0,8].includes(method)) reject('Entrada ZIP no admitida', 'ZIP_LIMIT');
    total += uncompressed;
    if (total > MAX_UNCOMPRESSED || uncompressed > 30 * 1024 * 1024 || (compressed < 1000 && uncompressed > 100000) || (compressed > 0 && uncompressed / compressed > 200)) reject('XLSX descomprimido excede el límite', 'ZIP_BOMB');
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (name.includes('..') || name.startsWith('/') || /vbaProject\.bin$/i.test(name)) reject('Ruta o macro no admitida en XLSX', 'XLSX_UNSAFE');
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== start + size) reject('Directorio ZIP inconsistente');
}

// Algunos exportadores OOXML usan <x:workbook>/<x:worksheet> en vez del
// espacio de nombres por defecto. ExcelJS no interpreta ese prefijo. Se
// normaliza solo la representación XML en memoria; las tablas de formato se
// descartan porque la importación utiliza exclusivamente los valores.
async function normalizeSpreadsheetNamespace(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = zip.file('xl/workbook.xml');
  if (!workbookXml) return buffer;
  const workbookText = await workbookXml.async('string');
  const mainNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const prefixedRoot = /<([A-Za-z][\w.-]*):workbook\b/.exec(workbookText);
  if (!prefixedRoot || !workbookText.includes(`xmlns:${prefixedRoot[1]}="${mainNamespace}"`)) return buffer;
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith('xl/tables/')) { zip.remove(name); continue; }
    if (!name.endsWith('.xml')) continue;
    const entry = zip.file(name);
    if (!entry) continue;
    let xml = await entry.async('string');
    const prefix = /xmlns:([A-Za-z][\w.-]*)="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/.exec(xml)?.[1];
    if (!prefix || /\sxmlns="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/.test(xml)) continue;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    xml = xml.replace(new RegExp(`xmlns:${escaped}="${mainNamespace}"`, 'g'), `xmlns="${mainNamespace}"`)
      .replace(new RegExp(`(<\\/?)${escaped}:`, 'g'), '$1')
      .replace(new RegExp(`\\s${escaped}:`, 'g'), ' ')
      .replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/g, '');
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function parseDelimited(text, delimiter) {
  if (text.includes('\u0000')) reject('Archivo de texto no válido');
  const rows = [];
  let row = [], field = '', quoted = false, line = 1, rowLine = 1;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else { field += char; if (char === '\n') line++; }
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value !== '')) rows.push({ line: rowLine, values: row });
      row = []; field = ''; line++; rowLine = line;
      if (rows.length > MAX_ROWS + 1) reject('Más de 100.000 filas', 'ROW_LIMIT');
    } else field += char;
    if (field.length > 65536) reject('Celda demasiado larga', 'CELL_LIMIT');
  }
  if (quoted) reject('Comillas CSV sin cerrar');
  row.push(field);
  if (row.some(value => value !== '')) rows.push({ line: rowLine, values: row });
  return rows;
}
function detectDelimiter(text, extension) {
  if (extension === '.tsv') return '\t';
  const first = text.split(/\r?\n/, 1)[0];
  const comma = parseDelimited(first, ',')[0]?.values.length || 0;
  const semicolon = parseDelimited(first, ';')[0]?.values.length || 0;
  return semicolon > comma ? ';' : ',';
}
function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return null;
  if (!/^[+-]?[\d.,]+$/.test(text)) return null;
  const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.');
  const decimal = comma > dot ? ',' : '.';
  const normalized = decimal === ',' ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function dateValue(value, date1904 = false) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < (date1904 ? 0 : 1) || value > 100000 || (!date1904 && value === 60)) return null;
    const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
    const serial = Math.floor(value) + (!date1904 && value < 60 ? 1 : 0);
    return new Date(epoch + serial * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const check = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return check.toISOString().slice(0, 10) === text ? text : null;
}
function cellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('formula' in value || 'sharedFormula' in value) reject('El archivo contiene fórmulas. Sustitúyelas por valores.', 'FORMULA_NOT_ALLOWED');
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (typeof value.text === 'string') return value.text;
    reject('Tipo de celda Excel no admitido', 'CELL_TYPE');
  }
  return value == null ? '' : value;
}
function normalizeRow(type, mapped, values, date1904 = false) {
  const source = {};
  const normalized = {};
  const errors = [];
  const warnings = [];
  for (let i = 0; i < mapped.length; i++) {
    const field = mapped[i];
    if (!field) continue;
    const value = values[i] == null ? '' : values[i];
    source[field] = value instanceof Date ? value.toISOString() : value;
    if (NUMERIC.has(field)) {
      const parsed = numberValue(value);
      if (value !== '' && parsed == null) errors.push(`${field}: número no válido`);
      normalized[field] = parsed;
    } else if (DATES.has(field)) {
      if (field === 'fecha_vencimiento' && String(value).trim().toUpperCase() === 'PERMANENTE') {
        normalized[field] = null;
        normalized.estado_vencimiento = 'PERMANENTE';
      } else {
        const parsed = dateValue(value, date1904);
        if (value !== '' && parsed == null) {
          (field === 'fecha_vencimiento' ? warnings : errors).push(`${field}: texto o fecha no válida`);
        }
        normalized[field] = parsed;
      }
    } else normalized[field] = typeof value === 'string' ? value.trim() : String(value);
  }
  if (String(source.fecha_vencimiento || '').trim().toUpperCase() === 'PERMANENTE') normalized.estado_vencimiento = 'PERMANENTE';
  for (const field of REQUIRED[type] || []) {
    if (normalized[field] == null || normalized[field] === '') errors.push(`${field}: obligatorio`);
  }
  if (!normalized.source_id) warnings.push('Sin source_id: requiere revisar fingerprint');
  if (type === 'Conductores' && normalized.estado && !['activo','inactivo'].includes(String(normalized.estado).toLowerCase())) errors.push('estado: solo activo o inactivo');
  if (type === 'Gastos_Operativos' && normalized.tipo && !COST_TYPES.has(String(normalized.tipo).toLowerCase())) errors.push('tipo: coste operativo no reconocido');
  if (type === 'Repostajes' && (normalized.litros == null || normalized.litros <= 0)) errors.push('litros: debe ser positivo');
  return { source, normalized, errors, warnings };
}
function buildSheet(type, records, mapping = {}, date1904 = false) {
  if (!records.length) reject(`La hoja ${type} está vacía`, 'EMPTY_SHEET');
  const headers = records[0].values.map(value => String(value ?? '').trim());
  if (headers.length > MAX_COLUMNS) reject('Demasiadas columnas', 'COLUMN_LIMIT');
  const headerMap = mapHeaders(type, headers, mapping);
  if (headerMap.errors.length) reject(headerMap.errors.join('; '), 'HEADER_INVALID');
  const rows = [];
  for (const record of records.slice(1)) {
    if (record.values.length > headers.length && record.values.slice(headers.length).some(value => value !== '')) reject(`Fila ${record.line}: columnas adicionales`, 'COLUMN_COUNT');
    const result = normalizeRow(type, headerMap.mapped, record.values, date1904);
    const raw = Object.fromEntries(headers.map((header, index) => [header, record.values[index] instanceof Date ? record.values[index].toISOString() : (record.values[index] ?? '')]));
    rows.push({ entity_type: type, row_number: record.line, source_data: raw,
      normalized_data: result.normalized, status: result.errors.length ? 'invalid' : result.warnings.length ? 'warning' : 'valid',
      error_code: result.errors.length ? 'ROW_INVALID' : result.warnings.length ? 'ROW_WARNING' : null,
      error_message: [...result.errors, ...result.warnings].join('; ') || null });
  }
  const bySourceId = new Map();
  for (const row of rows) {
    const sourceId = String(row.normalized_data.source_id || '').trim();
    if (!sourceId) continue;
    const first = bySourceId.get(sourceId);
    if (!first) { bySourceId.set(sourceId, row); continue; }
    for (const duplicate of [first, row]) {
      duplicate.status = 'invalid';
      duplicate.error_code = 'DUPLICATE_SOURCE_ID';
      if (!String(duplicate.error_message || '').includes('source_id repetido en la hoja')) {
        duplicate.error_message = [duplicate.error_message, 'source_id repetido en la hoja'].filter(Boolean).join('; ');
      }
    }
  }
  return { type, headers, mapped: headerMap.mapped, rows };
}
async function parseFile(buffer, filename, type, mapping = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) reject('Archivo vacío o superior a 20 MB', 'FILE_SIZE', 413);
  const extension = /\.[^.]+$/.exec(String(filename).toLowerCase())?.[0];
  if (!['.csv','.tsv','.xlsx'].includes(extension)) reject('Usa CSV, TSV o XLSX', 'FILE_TYPE');
  if (extension !== '.xlsx' && type === 'Pack_TransGest') reject('El pack debe ser XLSX', 'FILE_TYPE');
  if (extension === '.xlsx') {
    inspectZip(buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await normalizeSpreadsheetNamespace(buffer));
    const sheets = type === 'Pack_TransGest' ? workbook.worksheets : [workbook.getWorksheet(type)];
    if (!sheets.length || sheets.length > Object.keys(HEADERS).length) reject('Hojas no válidas', 'SHEET_LIMIT');
    let total = 0;
    const parsed = sheets.map(sheet => {
      if (!sheet) reject(`Falta la hoja oficial: ${type}`, 'SHEET_UNKNOWN');
      const sheetType = type === 'Pack_TransGest' ? sheet.name : type;
      if (!HEADERS[sheetType]) reject(`Hoja no reconocida: ${sheetType}`, 'SHEET_UNKNOWN');
      const records = [];
      sheet.eachRow((row, rowNumber) => {
        if (row.cellCount > MAX_COLUMNS) reject('Demasiadas columnas', 'COLUMN_LIMIT');
        const values = Array.from({ length: row.cellCount }, (_, i) => cellValue(row.getCell(i + 1)));
        if (rowNumber === 1 || values.some(value => value !== '')) records.push({ line: rowNumber, values });
        total++;
        if (total > MAX_ROWS + Object.keys(HEADERS).length) reject('Más de 100.000 filas', 'ROW_LIMIT');
      });
      // El pack descargable contiene todas las cabeceras; se rellenan solo las
      // hojas necesarias. Una hoja vacía no es un error ni crea un lote ficticio.
      if (type === 'Pack_TransGest' && records.length <= 1) return null;
      return buildSheet(sheetType, records, mapping[sheetType] || mapping, Boolean(workbook.properties.date1904));
    }).filter(Boolean);
    if (!parsed.length) reject('El pack no contiene filas de datos', 'EMPTY_PACK');
    return parsed;
  }
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) reject('Texto no UTF-8 válido', 'ENCODING');
  const records = parseDelimited(text, detectDelimiter(text, extension));
  return [buildSheet(type, records, mapping)];
}
module.exports = { parseFile, inspectZip, parseDelimited, numberValue, dateValue, normalizeRow };
