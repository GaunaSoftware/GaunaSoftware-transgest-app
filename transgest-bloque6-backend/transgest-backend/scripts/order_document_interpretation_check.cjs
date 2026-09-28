const assert = require('node:assert/strict');
const { reviewDocumentInterpretation } = require('../src/services/orderDocumentInterpretation');

const document = `Orden de transporte
Cliente: TRANSPORTES ASENSI TEST, S.L.
Contratante: CAR VOLUM TEST, S.L. B98328891
Transportista efectivo: TRANSPORTES ASENSI TEST, S.L. B03168853
Recogida NATUYSER TEST, CALLE CARGA 4, ALMENDRALEJO, 28/09/2026
Recogida ALMACEN SUR, AVENIDA SUR 9, MERIDA, 28/09/2026
Entrega PALECO TEST, CAMINO ENTREGA 2, FORTUNA, 29/09/2026
Entrega ALMACEN LEVANTE, CALLE ESTE 3, ELCHE, 29/09/2026`;
const interpreted = {
  tipo_documento:'orden_transporte', numero_pedidos_detectados:1,
  cliente_nombre:'CAR VOLUM TEST, S.L.', cliente_cif:'B98328891',
  transportista_nombre:'TRANSPORTES ASENSI TEST, S.L.', transportista_cif:'B03168853',
  puntos_carga:[
    {cliente_nombre:'NATUYSER TEST',direccion:'CALLE CARGA 4',ciudad:'ALMENDRALEJO',fecha:'2026-09-28',hora:'08:00',ventana:'08:00-17:00'},
    {cliente_nombre:'ALMACEN SUR',direccion:'AVENIDA SUR 9',ciudad:'MERIDA',fecha:'2026-09-28'},
  ],
  puntos_descarga:[
    {cliente_nombre:'PALECO TEST',direccion:'CAMINO ENTREGA 2',ciudad:'FORTUNA',fecha:'2026-09-29'},
    {cliente_nombre:'ALMACEN LEVANTE',direccion:'CALLE ESTE 3',ciudad:'ELCHE',fecha:'2026-09-29'},
  ],
};

const result = reviewDocumentInterpretation(interpreted,document,{readableText:true});
assert.equal(result.rejectClient,false);
assert.deepEqual(result.issues,[]);
assert.equal(result.patch.cliente_nombre,'CAR VOLUM TEST, S.L.');
assert.equal(result.patch.transportista_detectado,'TRANSPORTES ASENSI TEST, S.L.');
assert.equal(result.patch.origen,'ALMENDRALEJO');
assert.equal(result.patch.destino,'FORTUNA');
assert.equal(result.patch.puntos_carga.length,2);
assert.equal(result.patch.puntos_descarga.length,2);
assert.equal(result.patch.puntos_carga[0].ventana,'08:00-17:00');

const inventedClient = reviewDocumentInterpretation({...interpreted,cliente_nombre:'EMPRESA INVENTADA'},document,{readableText:true});
assert.equal(inventedClient.rejectClient,true);
assert.ok(inventedClient.issues.some(issue=>issue.key==='cliente_rol'));
const inventedStop = reviewDocumentInterpretation({...interpreted,puntos_descarga:[
  interpreted.puntos_descarga[0], {cliente_nombre:'DESTINO INVENTADO',direccion:'CALLE FALSA',ciudad:'TOLEDO',fecha:'2026-09-29'},
]},document,{readableText:true});
assert.ok(inventedStop.issues.some(issue=>issue.key==='puntos_descarga'));
assert.equal(inventedStop.patch.puntos_descarga,undefined,'an incomplete route is not silently accepted');

const visual = reviewDocumentInterpretation(interpreted,'',{readableText:false});
assert.equal(visual.patch.puntos_carga.length,2);
assert.ok(visual.issues.some(issue=>issue.key==='documento_visual'));
const sameParty = reviewDocumentInterpretation({...interpreted,cliente_nombre:interpreted.transportista_nombre},document,{readableText:true});
assert.equal(sameParty.rejectClient,true);
const several = reviewDocumentInterpretation({...interpreted,numero_pedidos_detectados:2},document,{readableText:true});
assert.equal(several.rejectClient,true);
assert.equal(several.patch.puntos_carga,undefined);
const invoice = reviewDocumentInterpretation({...interpreted,tipo_documento:'factura'},document,{readableText:true});
assert.ok(invoice.issues.some(issue=>issue.key==='tipo_documento'));

console.log('PASS generic document roles: multiple stops, conflicting heuristic correction, invented data, visual review, non-orders and multiple orders.');
