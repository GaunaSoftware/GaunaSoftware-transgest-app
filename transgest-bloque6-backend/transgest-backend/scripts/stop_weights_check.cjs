const assert = require('node:assert/strict');
const { weightKg, derivedOrderWeight, fillMissingOrderWeight } = require('../src/services/stopWeights');

assert.equal(weightKg('8,0'), 8000);
assert.equal(weightKg('8.5'), 8500);
assert.equal(weightKg('8000'), 8000);
assert.equal(weightKg('8.000,0'), 8000);
assert.equal(weightKg(''), null);
assert.equal(derivedOrderWeight([{peso_kg:'8,0'},{peso_kg:'9,0'},{peso_kg:'7,0'}],[{peso_kg:24000}]), 24000);
assert.equal(derivedOrderWeight([{peso_kg:24000}],[{peso_kg:'8,0'},{peso_kg:'9,0'},{peso_kg:'7,0'}]), 24000);
assert.equal(derivedOrderWeight([{peso_kg:8000}],[{peso_kg:8000}]), 8000);
const blank = { peso_kg:'', puntos_carga:[{peso_kg:'8,0'}], puntos_descarga:[] };
assert.equal(fillMissingOrderWeight(blank).peso_kg, 8000);
const zero = { peso_kg:0, puntos_carga:[{peso_kg:'8,0'}] };
assert.equal(fillMissingOrderWeight(zero).peso_kg, 8000);
const manual = { peso_kg:12345, puntos_carga:[{peso_kg:'8,0'}] };
assert.equal(fillMissingOrderWeight(manual).peso_kg, 12345);
console.log('Pesos de paradas: correcto');
