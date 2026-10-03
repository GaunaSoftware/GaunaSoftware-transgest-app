const assert=require('node:assert/strict');
const {orderTextHints}=require('../src/services/orderTextHints');
const text='Hola. Necesitamos cargar un camión en Ciudad A, Provincia A, para entregar en Ciudad B.\nCargar 03/10/2026\n24.000kg hora de entrega 12:00 04/10/2026';
assert.deepEqual(orderTextHints(text),{origin:'Ciudad A, Provincia A',destination:'Ciudad B',loadDate:'03/10/2026',unloadDate:'04/10/2026',weightKg:24000});
for(const [input,expected] of [['24.000kg',24000],['24 000 kg',24000],['24.000,5 kg',24000.5],['24000 kg',24000],['24,5 kg',24.5],['24.5 kg',24.5]])assert.equal(orderTextHints(input).weightKg,expected);
assert.equal(orderTextHints('Hora de entrega 12:00 04/10/2026').destination,'');
assert.equal(orderTextHints('Cargar 03/10/2026').origin,'');
console.log('PASS prose order cues: distinct locations, dates and Spanish kilogram grouping; decimal kilos preserved.');
