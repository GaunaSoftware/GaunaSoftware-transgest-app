const assert = require('node:assert/strict');
// PDF.js expects a byte array; copy Buffer slices to avoid pooled backing-array offsets.
const parsePdf = buffer => require('pdf-parse')(new Uint8Array(buffer));
const { buildFacturaPdfBuffer } = require('../src/services/invoicePdf');

async function main() {
  const description = 'Transporte con varias paradas y referencias detalladas. '.repeat(15) + 'FIN_CONCEPTO_LARGO';
  const lineas = Array.from({ length: 60 }, (_, i) => ({
    concepto: `LINEA_QA_${String(i + 1).padStart(3, '0')} ${i === 20 ? description : 'Servicio de transporte nacional'}`,
    cantidad: i === 0 ? 0 : 1, precio_unit: 100,
  }));
  const buffer = await buildFacturaPdfBuffer({ numero: 'QA-LARGA', cliente_nombre: 'Cliente de prueba', cliente_cif: 'QA000',
    fecha: '2026-09-11', fecha_vencimiento: '2026-10-11', base_imponible: 5900, cuota_iva: 1239, total: 7139,
    ia_result: { resumen: 'SECRETO_IA' } }, lineas, { razon_social: 'Transportes QA', iban: 'IBAN DE PRUEBA' });
  const parsed = await parsePdf(buffer);
  assert.ok(parsed.numpages >= 3, 'long invoice must paginate');
  for (let index = 1; index <= 60; index++) assert.ok(parsed.text.includes(`LINEA_QA_${String(index).padStart(3, '0')}`));
  assert.ok(parsed.text.includes('FIN_CONCEPTO_LARGO'));
  assert.ok(parsed.text.includes('Cantidad: 0'), 'explicit zero is not replaced by one');
  assert.ok(parsed.text.includes('7139,00 EUR'));
  assert.ok(!parsed.text.includes('SECRETO_IA'));
  const huge = await parsePdf(await buildFacturaPdfBuffer({ numero: 'QA-EXTREMA' }, [{
    concepto: 'Referencia extensa '.repeat(1100) + 'FIN_MULTIPAGINA', cantidad: 1, precio_unit: 0,
  }]));
  assert.ok(huge.numpages > 1);
  assert.ok(huge.text.includes('FIN_MULTIPAGINA'), 'single multi-page concept remains complete');
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const branded = await parsePdf(await buildFacturaPdfBuffer({ numero:'QA-PLANTILLA', total:1210 }, lineas,
    { razon_social:'Empresa QA', factura_plantilla:{mime:'image/png',imagen_base64:tinyPng} }));
  assert.ok(branded.numpages >= 3, 'template must not interrupt pagination');
  assert.ok(branded.text.includes('QA-PLANTILLA'));
  assert.ok(branded.text.includes('LINEA_QA_060'));
  if (process.argv.includes('--write-sample')) {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.resolve('tmp/pdfs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'invoice-long-qa.pdf'), buffer);
  }
  console.log('OK PDF factura: 60 lineas, textos largos/multipagina, cero explicito, totales y sin campos IA internos.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
