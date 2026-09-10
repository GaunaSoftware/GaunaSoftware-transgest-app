import { supplierPriceType, supplierTonneAgreement, canIssueSupplierOrder } from './supplierPricing';
test('supplier tonnes are independent of customer trip price and need no quantity or minimum', () => {
  const order = {tipo_precio:'viaje',cantidad:1,tipo_precio_colaborador:'tonelada',precio_colaborador_unitario:'32,50',peso_kg:0,precio_colaborador:900};
  expect(supplierPriceType(order)).toBe('tonelada');
  expect(supplierTonneAgreement(order)).toEqual({precioTonelada:32.5,minimoToneladas:0,toneladasFacturables:0});
  expect(supplierTonneAgreement({...order,peso_kg:500} ).toneladasFacturables).toBe(.5);
  expect(supplierTonneAgreement({...order,peso_kg:24000,minimo_colaborador_unidades:'25,5'}).toneladasFacturables).toBe(25.5);
  expect(supplierTonneAgreement({...order,tipo_precio_colaborador:'viaje'})).toBeNull();
});
test('legacy closed and unit agreements remain distinguishable', () => {
  expect(supplierPriceType({tipo_precio:'tonelada',precio_colaborador:450})).toBe('viaje');
  expect(supplierPriceType({tipo_precio:'tonelada',precio_colaborador_unitario:20})).toBe('tonelada');
});
test('own fleet never issues subcontractor orders including manual own plates', () => {
  expect(canIssueSupplierOrder({vehiculo_id:'own'})).toBe(false);
  expect(canIssueSupplierOrder({colaborador_id:'agency',vehiculo_id:'own'})).toBe(false);
  expect(canIssueSupplierOrder({colaborador_id:'agency',matricula_colaborador:'1234 ABC'},[{matricula:'1234-ABC'}])).toBe(false);
  expect(canIssueSupplierOrder({colaborador_id:'agency',matricula_colaborador:'2222ABC'},[{matricula:'1234-ABC'}])).toBe(true);
});
