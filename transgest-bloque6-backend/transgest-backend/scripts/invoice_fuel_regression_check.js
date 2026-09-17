const assert = require('node:assert/strict');
const { fuelInvoiceLines, validateFuelInvoiceLines } = require('../src/services/invoiceFuelLines');
const { buildFacturaPdfBuffer } = require('../src/services/invoicePdf');
const parsePdf = buffer => require('pdf-parse')(new Uint8Array(buffer));
async function main() {
 const orders=[{numero:'PED-FUEL-1',importe:528,importe_revision_combustible:48},{numero:'PED-FUEL-2',importe:220,importe_revision_combustible:20}];
 const detailed=orders.flatMap(p=>fuelInvoiceLines(p));
 assert.equal(detailed.length,4);assert.equal(detailed.reduce((s,l)=>s+l.precio_unit,0),748);
 validateFuelInvoiceLines(orders,detailed);
 const grouped=[{concepto:'Transporte',cantidad:1,precio_unit:680},{concepto:'Recargo de combustible',cantidad:1,precio_unit:68}];
 validateFuelInvoiceLines(orders,grouped);
 assert.throws(()=>validateFuelInvoiceLines(orders,[{concepto:'Transporte',cantidad:1,precio_unit:748}]),e=>e.status===409);
 assert.throws(()=>validateFuelInvoiceLines(orders,[...grouped,grouped[1]]),e=>e.status===409);
 assert.throws(()=>fuelInvoiceLines({numero:'INVALID',importe:10,importe_revision_combustible:11}),e=>e.status===409);
 assert.equal(fuelInvoiceLines({importe:100}).length,1);
 assert.equal(fuelInvoiceLines({importe:10,importe_revision_combustible:10})[0].precio_unit,0);
 for (const [label,lines] of [['individual',fuelInvoiceLines(orders[0])],['grouped',grouped],['detailed',detailed]]) {
  const base=lines.reduce((s,l)=>s+l.precio_unit*l.cantidad,0);
  const pdf=await parsePdf(await buildFacturaPdfBuffer({numero:label,base_imponible:base,tipo_iva:21,cuota_iva:Math.round(base*21)/100,total:Math.round(base*121)/100},lines));
  assert.ok(pdf.text.includes('Recargo de combustible'));assert.ok(pdf.text.includes(base.toFixed(2).replace('.',',')+' EUR'));
 }
 console.log('OK recargo: separado en factura individual/agrupada/PDF, totales conservados, duplicación u omisión rechazadas.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
