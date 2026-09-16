import { clearAssignmentPatch, hasAssignment, quickSaleTotal, recordedCosts } from './quickAssignment';
import { buildPedidoUpdatePatch } from './pedidoUpdatePatch';

test('limpieza elimina también colaborador, segundo conductor y matrículas manuales sin alterar el pedido', () => {
  const order = {colaborador_id:'supplier',matricula_colaborador:'1234 ABC',chofer2_id:'driver',
    matricula_manual:'5678 DEF',importe:900,precio_colaborador:600,estado:'confirmado',notas:'Conservar'};
  const result = {...order,...buildPedidoUpdatePatch(clearAssignmentPatch())};
  expect(hasAssignment(order)).toBe(true);
  expect(hasAssignment(result)).toBe(false);
  expect(result).toMatchObject({importe:900,precio_colaborador:600,estado:'confirmado',notas:'Conservar'});
});

test('venta por viaje conserva mínimo y suplementos de todas las paradas', () => {
  expect(quickSaleTotal({tipo_precio:'viaje',importe_minimo:500,extracostes_importe:10,
    puntos_carga:[{precio:20}],puntos_descarga:'[{"precio":"30,50"}]'},'450,50')).toBe(560.5);
});

test('venta por unidad y costes conocidos permiten comparar el margen', () => {
  expect(quickSaleTotal({tipo_precio:'tonelada',cantidad:24.2,minimo_unidades:25},'32,50')).toBe(812.5);
  expect(quickSaleTotal({tipo_precio:'kg',cantidad:1000},'12')).toBe(120);
  const order={coste_gasoil:100,coste_peajes:20,coste_dietas:30,coste_otros:10};
  expect(recordedCosts(order,false,900)).toBe(160);
  expect(recordedCosts(order,true,'600,50')).toBe(660.5);
});
