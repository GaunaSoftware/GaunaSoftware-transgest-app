const MONTHLY_EUR = Object.freeze({
  directa: Object.freeze({ lite: 169, profesional: 349, enterprise: 479 }),
  canal: Object.freeze({ lite: 259, profesional: 539, enterprise: 959 }),
});

function normalizeOrigin(value) {
  return value === 'canal' ? 'canal' : 'directa';
}

function priceFor(plan, cycle = 'mensual', origin = 'directa') {
  const monthly = MONTHLY_EUR[normalizeOrigin(origin)][plan];
  if (!monthly) return null;
  if (!['mensual', 'anual'].includes(cycle)) return null;
  return cycle === 'anual' ? Math.round(monthly * 12 * .85 * 100) / 100 : monthly;
}

function monthlyEquivalent(plan, cycle = 'mensual', origin = 'directa') {
  const price = priceFor(plan, cycle, origin);
  return price === null ? null : (cycle === 'anual' ? price / 12 : price);
}

module.exports = { MONTHLY_EUR, normalizeOrigin, priceFor, monthlyEquivalent };
