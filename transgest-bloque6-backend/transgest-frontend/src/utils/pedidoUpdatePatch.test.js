import { buildPedidoUpdatePatch } from './pedidoUpdatePatch';

test('asignar no incluye precio ni datos de la fila resumida',()=>{
  const patch=buildPedidoUpdatePatch({vehiculo_id:'vehiculo',chofer_id:'chofer',colaborador_id:''});
  expect(patch).toEqual({vehiculo_id:'vehiculo',chofer_id:'chofer',colaborador_id:''});
  const pedido={importe:480,precio_unitario:480,notas:'Conservar',puntos_carga:[{direccion:'Burgos'}]};
  expect({...pedido,...patch}.importe).toBe(480);
  expect({...pedido,...patch}.puntos_carga).toBe(pedido.puntos_carga);
});

test('remolque, km en vacio y desasignacion son cambios parciales',()=>{
  expect(buildPedidoUpdatePatch({remolque_id_manual:'remolque',km_vacio:40})).toEqual({remolque_id:'remolque',km_vacio:40});
  expect(buildPedidoUpdatePatch({remolque_id_manual:'',chofer_id:undefined})).toEqual({remolque_id:null});
  expect(buildPedidoUpdatePatch({ruta_id:'ruta'})).toEqual({ruta_id:'ruta'});
});

test('proveedor externo cambia recursos sin inventar un importe',()=>{
  expect(buildPedidoUpdatePatch({colaborador_id:'proveedor',colaborador_nombre:'Nombre'})).toEqual({colaborador_id:'proveedor',vehiculo_id:null,chofer_id:null,chofer2_id:null,remolque_id:null});
});
