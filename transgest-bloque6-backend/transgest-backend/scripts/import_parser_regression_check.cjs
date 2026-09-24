const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
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

  const csv = Buffer.from('\uFEFFsource_id,nombre,apellidos,dni,estado\nold-1,"Ana, María",López,12345678Z,activo\nold-2,José,Ruiz,87654321X,inactivo\n');
  const [drivers] = await parseFile(csv, 'conductores.csv', 'Conductores');
  assert.equal(drivers.rows.length, 2);
  assert.equal(drivers.rows[0].normalized_data.nombre, 'Ana, María');
  assert.equal(drivers.rows[1].normalized_data.estado, 'inactivo');
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
  const formulaBook = new ExcelJS.Workbook();
  const formulaSheet = formulaBook.addWorksheet('Clientes');
  formulaSheet.addRow(['source_id','nombre','cif']);
  formulaSheet.addRow(['client-1',{ formula: '1+1', result: 2 },'A12345678']);
  await assert.rejects(parseFile(Buffer.from(await formulaBook.xlsx.writeBuffer()), 'formula.xlsx', 'Clientes'), { code: 'FORMULA_NOT_ALLOWED' });

  const large = ['source_id,nombre,cif', ...Array.from({ length: 10001 }, (_, index) => `client-${index},Cliente ${index},A${String(index).padStart(8,'0')}`)].join('\n');
  assert.equal((await parseFile(Buffer.from(large), 'clientes.csv', 'Clientes'))[0].rows.length, 10001);
  console.log('PASS: CSV/TSV/XLSX, official pack, aliases, formula rejection, Excel dates, Spanish decimals, permanent documents and 10,001 rows. Synthetic data only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
