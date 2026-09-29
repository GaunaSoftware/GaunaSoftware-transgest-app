import { buildTransportInvoiceLines as build } from './invoiceLines';
const orders = [
 { numero: 'PED-1', importe: 528, importe_revision_combustible: 48, precio_base_sin_combustible: 20, precio_unitario: 22, peso_kg: 24000 },
 { numero: 'PED-2', importe: 220, importe_revision_combustible: 20, precio_base_sin_combustible: 20, precio_unitario: 22, peso_kg: 10000 },
 { numero: 'PED-3', importe: 150, peso_kg: 1000, precio_unitario: 100 },
];
const total = lines => lines.reduce((sum,l) => sum + Math.round(l.cantidad*l.precio_unit*100),0)/100;
test.each(['linea','agrupada_linea','detalle','detalle_combustible_agrupado','kg','agrupada_kg'])('%s separates fuel while preserving agreed totals and extras', mode => {
 const lines=build(orders,mode,'Transportes');
 expect(total(lines)).toBe(898);
 expect(total(lines.filter(l=>l.concepto.startsWith('Recargo de combustible')))).toBe(68);
 expect(total(lines.filter(l=>!l.concepto.startsWith('Recargo de combustible')))).toBe(830);
});
test('one trip has transport and surcharge, not an added charge',()=>{
 expect(build([orders[0]],'detalle')).toEqual([
 expect.objectContaining({precio_unit:480,cantidad:1}),expect.objectContaining({concepto:'Recargo de combustible · PED-1',precio_unit:48,cantidad:1})]);
});
test('grouped trips have one separate fuel line',()=>expect(build(orders,'linea','Viajes')).toEqual([
  {concepto:'Viajes',cantidad:1,precio_unit:830},{concepto:'Recargo de combustible',cantidad:1,precio_unit:68}]));
test('one line per trip can keep a single aggregated fuel line', () => {
 const lines = build(orders, 'detalle_combustible_agrupado');
 expect(lines).toHaveLength(4);
 expect(lines.filter(l => l.concepto.startsWith('Recargo de combustible'))).toEqual([{concepto:'Recargo de combustible',cantidad:1,precio_unit:68}]);
 expect(lines.slice(0,3).map(l => l.precio_unit)).toEqual([480,200,150]);
});
test('weight invoices retain base rate, and preserve minimum charges',()=>{
 const lines=build(orders,'kg');expect(lines[0]).toEqual({concepto:'Transporte 34.000 kg (2 viajes)',cantidad:34,precio_unit:20});
 expect(lines[1].precio_unit).toBe(150);
});
test('rounding uses cents per order and omits nonexistent fuel',()=>{
 expect(total(build([{importe:'100.01',importe_revision_combustible:'0.01'},{importe:'9.99',importe_revision_combustible:'0.02'}],'linea','Porte'))).toBe(110);
 expect(build([{importe:100}],'detalle')).toHaveLength(1);
 expect(build([],'linea','Porte')).toEqual([]);
});
test.each(['linea','detalle','kg'])('%s adds the separate agreed detention charge once',mode=>{
 const lines=build([{id:'p1',numero:'PED-1',importe:1000,importe_revision_combustible:50,importe_paralizacion:150}],mode,'Servicio');
 expect(total(lines)).toBe(1150);expect(lines.find(l=>l.paralizacion_pedido_id==='p1')).toEqual({concepto:'Paralización · PED-1',cantidad:1,precio_unit:150,paralizacion_pedido_id:'p1'});
});
test.each(['linea','detalle','detalle_combustible_agrupado','kg'])('%s replaces stored fuel with invoice-time clause without doubling it', mode=>{
 const lines=build(orders,mode,'Transporte',10);
 expect(total(lines)).toBe(913);
 expect(total(lines.filter(l=>l.concepto.startsWith('Recargo de combustible')))).toBe(83);
 expect(total(lines.filter(l=>!l.concepto.startsWith('Recargo de combustible')))).toBe(830);
});
