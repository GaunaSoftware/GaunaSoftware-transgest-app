const assert = require('node:assert/strict');
const { fuelInvoiceLines, fuelInvoiceLinesForOrders, fuelClause, validateFuelInvoiceLines } = require('../src/services/invoiceFuelLines');
const { buildFacturaPdfBuffer } = require('../src/services/invoicePdf');
const parsePdf = buffer => require('pdf-parse')(new Uint8Array(buffer));
async function main() {
 const orders=[{numero:'PED-FUEL-1',importe:528,importe_revision_combustible:48},{numero:'PED-FUEL-2',importe:220,importe_revision_combustible:20}];
 const detailed=orders.flatMap(p=>fuelInvoiceLines(p));
 assert.equal(detailed.length,4);assert.equal(detailed.reduce((s,l)=>s+l.precio_unit,0),748);
 validateFuelInvoiceLines(orders,detailed);
 const grouped=[{concepto:'Transporte',cantidad:1,precio_unit:680},{concepto:'Recargo de combustible',cantidad:1,precio_unit:68}];
 validateFuelInvoiceLines(orders,grouped);
 validateFuelInvoiceLines(orders,[grouped[0],{concepto:'Variación de gasoil',cantidad:1,precio_unit:68}]);
 assert.throws(()=>validateFuelInvoiceLines(orders,[{concepto:'Transporte',cantidad:1,precio_unit:748}]),e=>e.status===409);
 assert.throws(()=>validateFuelInvoiceLines(orders,[...grouped,grouped[1]]),e=>e.status===409);
 assert.throws(()=>validateFuelInvoiceLines(orders,[...grouped,{concepto:'Variación de gasoil',cantidad:1,precio_unit:68}]),e=>e.status===409);
 assert.throws(()=>fuelInvoiceLines({numero:'INVALID',importe:10,importe_revision_combustible:11}),e=>e.status===409);
 assert.equal(fuelInvoiceLines({importe:100}).length,1);
 assert.equal(fuelInvoiceLines({importe:10,importe_revision_combustible:10})[0].precio_unit,0);
 const clause=fuelClause(orders,10);
 assert.deepEqual(clause,{percentage:10,transport_base:680,previous_fuel:68,applied_fuel:68});
 const changed=fuelClause(orders,12.5);
 assert.equal(changed.applied_fuel,85);
 validateFuelInvoiceLines(orders,[{concepto:'Transporte',cantidad:1,precio_unit:680},{concepto:'Recargo de combustible',cantidad:1,precio_unit:85}],changed);
 const workflowLines=fuelInvoiceLinesForOrders(orders,changed);
 assert.ok(workflowLines.some(line=>line.concepto.startsWith('Variación de gasoil (12,5 %)')));
 validateFuelInvoiceLines(orders,workflowLines,changed);
 assert.equal(workflowLines.reduce((sum,line)=>sum+Math.round(line.cantidad*line.precio_unit*100),0),76500);
 const clausePdf=await parsePdf(await buildFacturaPdfBuffer({numero:'VAR-FUEL',base_imponible:765,tipo_iva:21,cuota_iva:160.65,total:925.65},workflowLines));
 assert.ok(clausePdf.text.includes('Variación de gasoil'));
 assert.throws(()=>validateFuelInvoiceLines(orders,grouped,changed),e=>e.status===409);
 assert.throws(()=>fuelClause(orders,101),e=>e.status===409);
 assert.throws(()=>fuelClause(orders,''),e=>e.status===409);
 assert.throws(()=>fuelClause(orders,null),e=>e.status===409);
 for (const [label,lines] of [['individual',fuelInvoiceLines(orders[0])],['grouped',grouped],['detailed',detailed]]) {
  const base=lines.reduce((s,l)=>s+l.precio_unit*l.cantidad,0);
  const pdf=await parsePdf(await buildFacturaPdfBuffer({numero:label,base_imponible:base,tipo_iva:21,cuota_iva:Math.round(base*21)/100,total:Math.round(base*121)/100},lines));
  assert.ok(pdf.text.includes('Recargo de combustible'));assert.ok(pdf.text.includes(base.toFixed(2).replace('.',',')+' EUR'));
 }
 console.log('OK recargo: separado en factura individual/agrupada/PDF, totales conservados, duplicación u omisión rechazadas.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
