const {formatCompanyPaymentTerms:format,calculateCompanyPaymentDate:due,validateCompanyPaymentSettings:validate} = require('./companyPayment');
test('editable instruments and custom order conditions are independent of the term',()=>{
 expect(format({medio_pago_clientes:'Pagaré',plazo_pago_clientes:45})).toContain('Pagaré · 45 días');
 expect(format({medio_pago_colaboradores:'Transferencia SEPA',plazo_pago_colaboradores:0},'colaboradores')).toContain('Transferencia SEPA · 0 días');
 expect(format({texto_pago_colaboradores:'Pagaré a 30 días'},'colaboradores')).toBe('Pagaré a 30 días');
 expect(format({})).toContain('30 días');
});
test('payment schedules respect zero days, month length, UTC dates and the 60-day ceiling',()=>{
 expect(due('2026-03-05',{plazo_pago_colaboradores:60,forma_pago_colaboradores:'dias_fijos',dias_pago_colaboradores:'15'})).toBe('2026-05-04');
 expect(due('2026-01-15',{plazo_pago_colaboradores:30,forma_pago_colaboradores:'dias_fijos',dias_pago_colaboradores:'31'})).toBe('2026-02-28');
 expect(due('2026-09-17',{plazo_pago_colaboradores:60,forma_pago_colaboradores:'transferencia_inmediata'})).toBe('2026-09-17');
 expect(due('2026-09-17',{plazo_pago_colaboradores:0})).toBe('2026-09-17');
 expect(due('2026-03-05',{plazo_pago_colaboradores:60,forma_pago_colaboradores:'fin_mes'})).toBe('2026-05-04');
 expect(due('2026-03-05',{plazo_pago_colaboradores:30,forma_pago_colaboradores:'dias_fijos',dias_pago_colaboradores:'15,30'})).toBe('2026-04-15');
 expect(due('2026-03-05',{plazo_pago_colaboradores:30,forma_pago_colaboradores:'recepcion_factura',dias_pago_colaboradores:'15'})).toBe('2026-04-04');
 expect(due('2026-02-31',{})).toBeNull();
});
test('server-side settings validation rejects excessive or malformed terms',()=>{
 for(const n of [61,-1,1.5,'abc',Infinity]) expect(validate({plazo_pago_clientes:n})).toMatch(/0 y 60/);
 expect(validate({plazo_pago_clientes:0,plazo_pago_colaboradores:60})).toBe('');
 expect(validate({dias_pago_colaboradores:'32'})).toMatch(/1 al 31/);
 expect(validate({texto_pago_colaboradores:'Pagaré 90 días'})).toMatch(/superior a 60/);
});
