const assert = require('node:assert/strict');
const {MONTHLY_EUR,priceFor,monthlyEquivalent} = require('../src/services/commercialPricing');
const stripe = require('../src/services/stripe');

for (const [origin,prices] of Object.entries(MONTHLY_EUR)) {
  for (const [plan,monthly] of Object.entries(prices)) {
    assert.equal(priceFor(plan,'mensual',origin),monthly);
    assert.equal(priceFor(plan,'anual',origin),Math.round(monthly*12*.85*100)/100);
    assert.equal(monthlyEquivalent(plan,'anual',origin),priceFor(plan,'anual',origin)/12);
  }
}
assert.equal(priceFor('basico','mensual','directa'),null);
assert.equal(priceFor('planner','mensual','canal'),null);
assert.equal(priceFor('profesional','semanal','canal'),null);
const key = 'STRIPE_PRICE_PROFESIONAL_MENSUAL_CANAL';
const old = process.env[key];
const directKey='STRIPE_PRICE_PROFESIONAL_MENSUAL_DIRECTA';
const oldDirect=process.env[directKey];
delete process.env[directKey];
process.env[key]='price_test_channel';
assert.equal(stripe.planPriceId('profesional','mensual','canal'),'price_test_channel');
assert.equal(stripe.planPriceId('profesional','mensual','directa'),null);
assert.equal(stripe.planPriceId('profesional','mensual'),null, 'legacy companies must not silently use Directa');
if (old===undefined) delete process.env[key]; else process.env[key]=old;
if (oldDirect===undefined) delete process.env[directKey]; else process.env[directKey]=oldDirect;
async function testStripeAmountGuard() {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ok:true,json:async()=>({active:true,currency:'eur',unit_amount:34900,recurring:{interval:'month',interval_count:1}})});
    await stripe.assertCatalogPrice('price_test_direct',349,'mensual');
    await assert.rejects(stripe.assertCatalogPrice('price_test_direct',539,'mensual'),/no coincide/);
    await assert.rejects(stripe.assertCatalogPrice('price_test_direct',349,'anual'),/no coincide/);
  } finally { global.fetch = originalFetch; }
}
testStripeAmountGuard().then(()=>console.log('Tarifas Directa/Canal, descuento anual y validación del precio Stripe: OK')).catch(error=>{console.error(error);process.exitCode=1;});
