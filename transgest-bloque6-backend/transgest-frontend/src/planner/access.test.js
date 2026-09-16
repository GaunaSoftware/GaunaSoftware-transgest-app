import { isPlannerRoute, visiblePlannerModules } from './access';

test('opens Planner in the existing TMS build and preserves the standalone build', () => {
  expect(isPlannerRoute('/planner', 'tms')).toBe(true);
  expect(isPlannerRoute('/planner/', undefined)).toBe(true);
  expect(isPlannerRoute('/planner-other', 'tms')).toBe(false);
  expect(isPlannerRoute('/', 'tms')).toBe(false);
  expect(isPlannerRoute('/', 'planner')).toBe(true);
  expect(isPlannerRoute('/', 'planner', '?workspace=tms')).toBe(false);
});

test('external accounts cannot open the internal Planner regardless of order access', () => {
  for (const rol of ['cliente', 'cliente_portal', 'chofer', 'colaborador', 'mecanico']) {
    expect(visiblePlannerModules({ rol, productos:['transgest','planner'] }, () => true)).toEqual([]);
  }
  expect(visiblePlannerModules(null, () => true)).toEqual([]);
});

test('shows only permitted modules and respects the dock API role restrictions', () => {
  expect(visiblePlannerModules({productos:['transgest','planner'],rol:'trafico'}, id => id === 'pedidos').map(([id])=>id))
    .toEqual(['pedidos','viajes','muelles']);
  expect(visiblePlannerModules({productos:['transgest','planner'],rol:'gerente'}, () => false)).toEqual([]);
  expect(visiblePlannerModules({productos:['transgest','planner'],rol:'contable'}, id => id === 'pedidos').map(([id])=>id))
    .toEqual(['pedidos','viajes']);
  expect(visiblePlannerModules({productos:['transgest','planner'],rol:'gerente'}, id => id === 'palets').map(([id])=>id))
    .toEqual(['palets']);
});


test('licenses distinguish TMS-only, Planner-only and combined companies', () => {
  expect(visiblePlannerModules({rol:'gerente',productos:['transgest']},()=>true)).toEqual([]);
  expect(visiblePlannerModules({rol:'gerente'},()=>true)).toEqual([]);
  const modules=visiblePlannerModules({rol:'gerente',productos:['planner']},()=>true).map(([id])=>id);
  expect(modules).toEqual(['pedidos','muelles','palets','colaboradores','clientes','documentos','facturacion','empresa']);
});
