const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { parseFile, inspectZip, dateValue, numberValue } = require('../src/services/importParser');
const { mapHeaders } = require('../src/services/importCatalog');

async function main() {
  assert.equal(numberValue('1.234,56'), 1234.56);
  assert.equal(numberValue('-12,25'), -12.25);
  assert.equal(numberValue('1,25'), 1.25);
  assert.equal(dateValue(1), '1900-01-01');
  assert.equal(dateValue(60), null);
  assert.equal(dateValue(61), '1900-03-01');
  assert.equal(dateValue(0, true), '1904-01-01');
  assert.deepEqual(mapHeaders('Vehiculos', ['source_id', 'Matrícula vehículo', 'tipo']).mapped, ['source_id', 'matricula', 'tipo']);
  assert.match(mapHeaders('Gastos_Operativos', ['source_id', 'COSTE AUTOPISTA', 'tipo', 'importe']).errors.join(' '), /Columna no reconocida/);
  assert.equal(mapHeaders('Gastos_Operativos', ['source_id', 'COSTE AUTOPISTA', 'tipo', 'importe'], { 'COSTE AUTOPISTA': 'subtipo' }).errors.length, 0);
  assert.deepEqual(mapHeaders('Conductores', ['source_id', 'nombre', 'source_sheet', 'source_row']).mapped,
    ['source_id', 'nombre', null, null]);

  const csv = Buffer.from('\uFEFFsource_id,nombre,apellidos,dni,estado\nold-1,"Ana, María",López,12345678Z,activo\nold-2,José,Ruiz,87654321X,inactivo\n');
  const [drivers] = await parseFile(csv, 'conductores.csv', 'Conductores');
  assert.equal(drivers.rows.length, 2);
  assert.equal(drivers.rows[0].normalized_data.nombre, 'Ana, María');
  assert.equal(drivers.rows[1].normalized_data.estado, 'inactivo');
  const [repeated] = await parseFile(Buffer.from('source_id,nombre\nold-1,Ana\nold-1,Bea\n'), 'repetidos.csv', 'Conductores');
  assert.deepEqual(repeated.rows.map(row => row.status), ['invalid', 'invalid']);
  assert.deepEqual(repeated.rows.map(row => row.error_code), ['DUPLICATE_SOURCE_ID', 'DUPLICATE_SOURCE_ID']);
  const [costs] = await parseFile(Buffer.from('source_id;tipo;importe\npeaje-1;peaje;-12,25\n'), 'gastos.csv', 'Gastos_Operativos');
  assert.equal(costs.rows[0].normalized_data.importe, -12.25);
  const [tsv] = await parseFile(Buffer.from('source_id\tmatricula\nveh-1\t0009-LCZ\n'), 'vehiculos.tsv', 'Vehiculos');
  assert.equal(tsv.rows[0].normalized_data.matricula, '0009-LCZ');
  await assert.rejects(parseFile(Buffer.from('source_id,COSTE AUTOPISTA,tipo,importe\na,12,peaje,12'), 'gastos.csv', 'Gastos_Operativos'), { code: 'HEADER_INVALID' });

  const workbook = new ExcelJS.Workbook();
  const clients = workbook.addWorksheet('Clientes');
  clients.addRow(['source_id','nombre','cif']);
  clients.addRow(['client-1','Cliente sintético','A12345678']);
  const docs = workbook.addWorksheet('Docs_Conductores');
  docs.addRow(['source_id','chofer_dni','tipo_doc','fecha_vencimiento','estado_vencimiento']);
  docs.addRow(['doc-1','12345678Z','contrato_laboral','PERMANENTE','']);
  docs.addRow(['doc-2','12345678Z','cap','AÑO QUE VIENE','']);
  workbook.addWorksheet('Vehiculos').addRow(['source_id','matricula']);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const suspicious = Buffer.from(xlsx);
  let directory = -1;
  for (let offset = suspicious.length - 22; offset >= 0; offset--) {
    if (suspicious.readUInt32LE(offset) === 0x06054b50) { directory = suspicious.readUInt32LE(offset + 16); break; }
  }
  assert.ok(directory > 0);
  suspicious.writeUInt32LE(0x7fffffff, directory + 24);
  assert.throws(() => inspectZip(suspicious), { code: 'ZIP_BOMB' });
  const parsed = await parseFile(xlsx, 'Pack.xlsx', 'Pack_TransGest');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].rows[0].normalized_data.fecha_vencimiento, null);
  assert.equal(parsed[1].rows[0].normalized_data.estado_vencimiento, 'PERMANENTE');
  assert.equal(parsed[1].rows[1].status, 'warning');
  assert.equal(parsed[1].rows[1].normalized_data.fecha_vencimiento, null);
  const prefixedBook = new ExcelJS.Workbook();
  const prefixedDrivers = prefixedBook.addWorksheet('Conductores');
  prefixedDrivers.addTable({ name: 'ConductoresTbl', ref: 'A1', headerRow: true,
    columns: ['source_id', 'nombre', 'apellidos', 'dni', 'source_sheet', 'source_row'].map(name => ({ name })),
    rows: [['driver-1', 'Persona sintética', '', '', 'origen', 4]] });
  const prefixedZip = await JSZip.loadAsync(Buffer.from(await prefixedBook.xlsx.writeBuffer()));
  const mainNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  for (const path of Object.keys(prefixedZip.files)) {
    if (!path.endsWith('.xml')) continue;
    const entry = prefixedZip.file(path);
    if (!entry) continue;
    let xml = await entry.async('string');
    if (!xml.includes(`xmlns="${mainNamespace}"`)) continue;
    xml = xml.replace(`xmlns="${mainNamespace}"`, `xmlns:x="${mainNamespace}"`)
      .replace(/(<\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, '$1x:$2');
    prefixedZip.file(path, xml);
  }
  const prefixed = await prefixedZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const [prefixedResult] = await parseFile(prefixed, 'prefix.xlsx', 'Conductores');
  assert.equal(prefixedResult.rows.length, 1);
  assert.equal(prefixedResult.rows[0].status, 'valid');
  assert.equal(prefixedResult.rows[0].source_data.source_sheet, 'origen');
  assert.equal(prefixedResult.rows[0].normalized_data.apellidos, '');
  const formulaBook = new ExcelJS.Workbook();
  const formulaSheet = formulaBook.addWorksheet('Clientes');
  formulaSheet.addRow(['source_id','nombre','cif']);
  formulaSheet.addRow(['client-1',{ formula: '1+1', result: 2 },'A12345678']);
  await assert.rejects(parseFile(Buffer.from(await formulaBook.xlsx.writeBuffer()), 'formula.xlsx', 'Clientes'), { code: 'FORMULA_NOT_ALLOWED' });

  const large = ['source_id,nombre,cif', ...Array.from({ length: 10001 }, (_, index) => `client-${index},Cliente ${index},A${String(index).padStart(8,'0')}`)].join('\n');
  assert.equal((await parseFile(Buffer.from(large), 'clientes.csv', 'Clientes'))[0].rows.length, 10001);
  console.log('PASS: CSV/TSV/XLSX, prefixed OOXML with tables and blank cells, provenance columns, official pack, aliases, formula rejection, Excel dates, Spanish decimals, permanent documents and 10,001 rows. Synthetic data only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
