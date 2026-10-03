import {supplierLedgerSummary} from './supplierLedgerSummary';
test('does not compare gross tax invoices or unlinked extra invoices with net trip forecasts',()=>{
 const result=supplierLedgerSummary([{id:'p',precio_colaborador:300}],[{numero_factura:'',base:300,total:363},{pedido_id:'p',numero_factura:'F1',base:100,total:121},{numero_factura:'EXTRA',base:50,total:60.5}],[{estado:'pagado',importe:40}]);
 expect(result.pendienteFactura).toBe(200);expect(result.pendientePago).toBe(141.5);expect(result.received).toHaveLength(2);
});
test('invoices outside the shown trip cohort do not reduce its amount pending invoice',()=>{
 expect(supplierLedgerSummary([{id:'today',precio_colaborador:300}],[{pedido_id:'older',numero_factura:'F1',base:500,total:605}]).pendienteFactura).toBe(300);
});
