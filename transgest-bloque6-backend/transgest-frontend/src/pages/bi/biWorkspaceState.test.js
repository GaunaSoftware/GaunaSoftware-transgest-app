import {initialBiState,queryForBi,changeBiFilter,clearBiFilters,restoreBiState} from './biWorkspaceState';
test('cliente → ruta → pedido → regreso mantiene filtros y totales independientes de página',()=>{
  const client=changeBiFilter(initialBiState,'cliente_id','c1');
  const route=changeBiFilter(client,'ruta','Madrid → Murcia');
  const detail={...route,page:3,limit:10};
  const restored=restoreBiState(JSON.stringify(detail));
  expect(queryForBi(restored)).toMatchObject({cliente_id:'c1',ruta:'Madrid → Murcia',page:3,limit:10});
  expect(queryForBi({...restored,page:1})).toMatchObject({cliente_id:'c1',ruta:'Madrid → Murcia'});
  expect(queryForBi(clearBiFilters(restored))).not.toHaveProperty('cliente_id');
});
test('restauración descarta estado malformado',()=>{
  expect(restoreBiState('{')).toEqual(initialBiState);
  expect(restoreBiState(JSON.stringify({vista:'desconocida'})).vista).toBe('direccion');
});
test('las vistas operativas conservan filtros y solicitan su contrato ampliado',()=>{
  const state=changeBiFilter({...initialBiState,vista:'operaciones'},'cliente_id','c1');
  expect(queryForBi(state)).toMatchObject({vista:'operaciones',cliente_id:'c1'});
  expect(restoreBiState(JSON.stringify({...state,vista:'flota'})).vista).toBe('flota');
  expect(restoreBiState(JSON.stringify({...state,vista:'calidad'})).vista).toBe('calidad');
  expect(queryForBi({...state,vista:'direccion'})).not.toHaveProperty('vista');
});
