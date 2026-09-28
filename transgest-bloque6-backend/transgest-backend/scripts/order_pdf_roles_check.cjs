const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { extractTabularLoadOrderPdf, applyTabularLoadOrder } = require('../src/services/orderPdfRoles');

async function syntheticOrder() {
  const doc = new PDFDocument({ size:'A4', margin:20 });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const finished = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const cell = (value, x, y) => doc.text(value, x, y, { lineBreak:false });
  cell('Carg. Cont.', 23, 65); cell('CAR VOLUM TEST, S.L.', 78, 65);
  cell('NIF:', 395, 82); cell('B98328891', 466, 82);
  cell('Tta. Efectivo', 23, 105); cell('TRANSPORTES ASENSI TEST, S.L.', 78, 105);
  cell('NIF:', 249, 122); cell('B03168853', 290, 122);
  cell('Precio', 290, 156); cell('600,00', 341, 156);
  cell('Mercancia', 401, 156); cell('PALETS', 455, 156);
  const stop = (y, kind, name, street, date, time, postal, city, weight) => {
    cell('R / E:', 25, y); cell(kind, 75, y); cell('Nombre:', 157, y); cell(name, 227, y);
    cell('Fecha:', 25, y+16); cell(date, 75, y+16); cell('Direccion:', 157, y+16); cell(street, 227, y+16);
    cell('Hora:', 25, y+32); cell(time, 75, y+32); cell('Pais/CP:', 157, y+32); cell(postal, 227, y+32);
    cell('Poblacion:', 320, y+32); cell(city, 377, y+32);
    cell('Peso:', 157, y+48); cell(weight, 227, y+48);
  };
  stop(210, 'RECOGIDA', 'NATUYSER TEST', 'CALLE CARGA 4', '28/09/26', '08:00 a 17:00', 'ES-06200', 'ALMENDRALEJO (BADAJOZ)', '18000.00');
  stop(340, 'ENTREGA', 'PALECO TEST', 'CAMINO ENTREGA S/N', '29/09/26', '08:00 a 16:00', 'ES-30620', 'FORTUNA (MURCIA)', '18000.00');
  doc.end();
  return finished;
}

async function check() {
  const parsed = await extractTabularLoadOrderPdf(await syntheticOrder());
  assert.equal(parsed.customer, 'CAR VOLUM TEST, S.L.');
  assert.equal(parsed.customerTaxId, 'B98328891');
  assert.equal(parsed.carrier, 'TRANSPORTES ASENSI TEST, S.L.');
  assert.equal(parsed.origin, 'ALMENDRALEJO');
  assert.equal(parsed.destination, 'FORTUNA');
  assert.equal(parsed.loads[0].cliente_nombre, 'NATUYSER TEST');
  assert.match(parsed.loads[0].direccion, /06200 ALMENDRALEJO/);
  assert.equal(parsed.loads[0].ventana, '08:00-17:00');
  assert.equal(parsed.unloads[0].cliente_nombre, 'PALECO TEST');
  assert.match(parsed.unloads[0].direccion, /30620 FORTUNA/);
  assert.equal(parsed.unloads[0].ventana, '08:00-16:00');
  assert.equal(parsed.weightKg, 18000);
  assert.equal(parsed.price, 600);
  const draft = applyTabularLoadOrder({cliente_nombre:'TRANSPORTES ASENSI TEST, S.L.',origen:'MURCIA',destino:'VALENCIA',importe:45},parsed);
  assert.equal(draft.cliente_nombre, 'CAR VOLUM TEST, S.L.');
  assert.equal(draft.transportista_detectado, 'TRANSPORTES ASENSI TEST, S.L.');
  assert.equal(draft.origen, 'ALMENDRALEJO');
  assert.equal(draft.destino, 'FORTUNA');
  assert.equal(draft.importe, 600);
  assert.equal(draft.bultos, null, 'PALETS describes goods; the pallet count is blank');
  console.log('PASS PDF loading order: contractual client, effective carrier, both stops, windows, weight and price stay separate.');
}

module.exports = { syntheticOrder, check };
if (require.main === module) check().catch(error => { console.error(error); process.exitCode = 1; });
