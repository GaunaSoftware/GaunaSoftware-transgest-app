const assert = require('node:assert/strict');
const { shouldCalculateEmptyKmAfterLoad } = require('../src/services/emptyKmTiming');

const order = {
  carga_real_at: '2026-09-28T10:00:00Z',
  vehiculo_id: 'truck-b',
  chofer_id: 'driver-b',
  chofer2_id: null,
  colaborador_id: null,
  km_vacio: null,
};
const step = { carga_ok: true, km_carga: 120350 };
const can = (changes = {}) => shouldCalculateEmptyKmAfterLoad({ step, order, driverId: 'driver-b', ...changes });

assert.equal(can(), true, 'The final assigned driver can record positioning at load completion');
assert.equal(can({ step: { carga_iniciada: true, km_carga: 120350 } }), false, 'Arrival at the loading point is still provisional');
assert.equal(can({ step: { carga_proceso: true, km_carga: 120350 } }), false, 'Loading in progress is still provisional');
assert.equal(can({ order: { ...order, carga_real_at: null } }), false, 'No actual load was recorded');
assert.equal(can({ driverId: 'driver-a' }), false, 'The previous provisional driver cannot record empty km');
assert.equal(can({ order: { ...order, vehiculo_id: null } }), false, 'The final truck must be known');
assert.equal(can({ order: { ...order, colaborador_id: 'supplier' } }), false, 'A subcontracted trip is not own-fleet empty km');
assert.equal(can({ order: { ...order, km_vacio: 12 } }), false, 'Existing empty km must not be duplicated');
assert.equal(can({ step: { carga_ok: true } }), false, 'A missing odometer is not zero kilometres');
assert.equal(can({ step: { carga_ok: true, km_carga: null } }), false);
assert.equal(can({ step: { carga_ok: true, km_carga: 0 } }), true, 'Zero is a valid odometer reading');
console.log('PASS empty km after load: assignment remains provisional until loading is complete.');
