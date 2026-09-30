import { assignPendingOrders, pendingOrdersForWeek } from './dailyPlanAssignment';

test('solo expone pedidos operativos propios de la semana sin asignación completa', () => {
  const days = ['2026-09-30'];
  const make = (id, extra = {}) => ({ id, fecha_carga: days[0], estado: 'confirmado', ...extra });
  const result = pendingOrdersForWeek([
    make('a'), make('b', { vehiculo_id: 'v', chofer_id: 'c' }),
    make('c', { colaborador_id: 'co' }), make('d', { estado: 'cancelado' }),
    make('e', { fecha_carga: '2026-10-01' }), make('a'),
  ], days);
  expect(result.map(order => order.id)).toEqual(['a']);
});

test('asigna varios pedidos una sola vez, conserva fallos individuales y usa el conjunto del vehículo', async () => {
  const calls = [];
  const save = async (id, body) => { calls.push([id, body]); if (id === 'b') throw new Error('Conflicto'); };
  const pending = [{ id: 'a', numero: 'A' }, { id: 'b', numero: 'B' }];
  const result = await assignPendingOrders({ ids: ['a', 'a', 'b'], pending,
    vehicle: { id: 'v', chofer_id: 'c', remolque_id: 'r' }, save });
  expect(calls).toEqual([
    ['a', { vehiculo_id: 'v', chofer_id: 'c', remolque_id: 'r' }],
    ['b', { vehiculo_id: 'v', chofer_id: 'c', remolque_id: 'r' }],
  ]);
  expect(result.ok).toEqual(['a']);
  expect(result.failed).toEqual([{ numero: 'B', error: 'Conflicto' }]);
});
