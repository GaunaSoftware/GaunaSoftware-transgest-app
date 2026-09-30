const assert = require('node:assert/strict');
const { scopePlanData } = require('../src/routes/plan_diario');

const vehicles = [{ id: 'v1' }, { id: 'v2' }];
const orders = [
  { id: 'a', vehiculo_id: 'v1', tipo_viaje: 'salida' },
  { id: 'b', vehiculo_id: 'v2', tipo_viaje: 'salida' },
  { id: 'c', vehiculo_id: 'v1', tipo_viaje: 'retorno' },
  { id: 'd', vehiculo_id: null, tipo_viaje: 'salida' },
];
const limited = scopePlanData(vehicles, orders, { rol: 'trafico', trafico_config: { vehiculo_ids: ['v1'], tipos_viaje: ['salida'] } });
assert.deepEqual(limited.vehicles.map(v => v.id), ['v1']);
assert.deepEqual(limited.orders.map(p => p.id), ['a']);
assert.equal(scopePlanData(vehicles, orders, { rol: 'gerente' }).orders.length, 4);
console.log('Plan diario: alcance de tráfico aplicado a vehículos y pedidos.');
