require("../src/resolveWorkspaceModules");
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { hasTransgestAccountingPermission } = require("../src/domain/rbac");
const { isUuidLike } = require("../src/routes/auth");

test("SSO payload de contabilidad requiere proposito correcto y permiso", () => {
  const secret = "test-secret";
  const token = jwt.sign({
    purpose: "accounting_sso",
    sub: "11111111-1111-1111-1111-111111111111",
    empresa_id: "22222222-2222-2222-2222-222222222222",
    rol: "trafico",
    permisos: { modulos: { contabilidad: { ver: true, editar: false } } },
  }, secret, { expiresIn: "2m" });

  const payload = jwt.verify(token, secret);
  assert.equal(payload.purpose, "accounting_sso");
  assert.equal(hasTransgestAccountingPermission(payload.permisos, payload.rol), true);
});

test("SSO payload sin permiso contable debe considerarse no autorizado", () => {
  const payload = {
    purpose: "accounting_sso",
    rol: "visualizador",
    permisos: { modulos: { dashboard: { ver: true } } },
  };
  assert.equal(hasTransgestAccountingPermission(payload.permisos, payload.rol), false);
});

test("SSO acepta UUIDs validos de PostgreSQL aunque no tengan version RFC", () => {
  assert.equal(isUuidLike("00000000-0000-0000-0000-000000000001"), true);
  assert.equal(isUuidLike("not-a-uuid"), false);
});
