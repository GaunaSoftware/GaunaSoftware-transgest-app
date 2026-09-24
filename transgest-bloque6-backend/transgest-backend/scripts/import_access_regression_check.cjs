const assert = require('node:assert/strict');
const {
  normalizePlan, planHasFeature, normalizePermissionsForRole, requireModulePermission,
} = require('../src/middleware/auth');

function request({ module = 'importacion', plan = 'basico', role = 'gerente', method = 'GET', path = '/', permissions, products = ['transgest'] }) {
  const req = { user: { plan, rol: role, productos: products, permisos: permissions }, method, path };
  let status = 200;
  let body;
  let next = false;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  requireModulePermission(module)(req, res, () => { next = true; });
  return { status, body, next };
}

for (const [source, normalized] of Object.entries({
  go: 'lite', transgest_go: 'lite', control: 'profesional', transgest_control: 'profesional',
  pro: 'profesional', transgest_pro: 'profesional', pro_intelligence: 'enterprise',
  planner: 'profesional', pro_planner: 'profesional',
})) assert.equal(normalizePlan(source), normalized);
assert.equal(normalizePlan('unexpected-plan'), 'unknown');
assert.equal(planHasFeature('unexpected-plan', 'ai'), false);
assert.equal(planHasFeature('unexpected-plan', 'importacion'), false);

for (const plan of ['lite', 'basico', 'profesional', 'enterprise']) {
  assert.equal(planHasFeature(plan, 'importacion'), true);
  assert.equal(request({ plan, method: 'POST' }).next, true, plan);
}
assert.equal(request({ plan: 'unexpected-plan' }).status, 403);
assert.equal(request({ role: 'visualizador' }).status, 403);
assert.equal(request({ products: ['planner'] }).status, 403);

for (const role of ['gerente', 'contable']) {
  const permissions = normalizePermissionsForRole(null, role);
  assert.deepEqual(permissions.modulos.gastos_estructura, { ver: true, editar: true });
  assert.equal(request({ module: 'empresa', role, plan: 'profesional', method: 'POST', path: '/gastos-estructura', permissions }).next, true);
}
const accountant = normalizePermissionsForRole(null, 'contable');
assert.equal(request({ module: 'empresa', role: 'contable', plan: 'profesional', method: 'POST', path: '/empresa', permissions: accountant }).status, 403);
const denied = { modulos: { gastos_estructura: { ver: false, editar: false } } };
assert.equal(request({ module: 'empresa', plan: 'profesional', method: 'POST', path: '/gastos-estructura', permissions: denied }).status, 403);
assert.equal(request({ module: 'importacion', plan: 'basico', method: 'POST', permissions: { modulos: { importacion: { ver: false, editar: false } } } }).status, 403);
assert.equal(request({ module: 'empresa', role: 'contable', plan: 'basico', method: 'POST', path: '/gastos-estructura' }).next, true);

console.log('PASS: import onboarding access, known/unknown plans, structure-cost permissions, explicit denials.');
