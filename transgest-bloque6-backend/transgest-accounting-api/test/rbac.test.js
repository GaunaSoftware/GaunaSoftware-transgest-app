const test = require("node:test");
const assert = require("node:assert/strict");
const {
  accountingRoleForTransgestRole,
  hasTransgestAccountingPermission,
  permissionsForRole,
} = require("../src/domain/rbac");

test("gerente y contable pueden acceder a contabilidad por rol base", () => {
  assert.equal(hasTransgestAccountingPermission({}, "gerente"), true);
  assert.equal(hasTransgestAccountingPermission({}, "contable"), true);
});

test("usuario sin permiso contabilidad no puede acceder", () => {
  assert.equal(hasTransgestAccountingPermission({ modulos: { facturacion: { ver: true } } }, "trafico"), false);
});

test("permiso explicito de modulo contabilidad concede acceso", () => {
  assert.equal(hasTransgestAccountingPermission({ modulos: { contabilidad: { ver: true } } }, "trafico"), true);
});

test("roles TransGest se transforman en roles contables iniciales", () => {
  assert.equal(accountingRoleForTransgestRole("gerente"), "accounting_admin");
  assert.equal(accountingRoleForTransgestRole("contable"), "accounting_user");
  assert.equal(accountingRoleForTransgestRole("trafico"), "accounting_viewer");
});

test("accounting_user tiene permisos minimos de Fase 1", () => {
  const permissions = permissionsForRole("accounting_user");
  assert.ok(permissions.includes("accounting.access"));
  assert.ok(permissions.includes("accounts.read"));
  assert.ok(permissions.includes("accounts.write"));
  assert.ok(permissions.includes("banks.read"));
  assert.ok(permissions.includes("banks.write"));
  assert.ok(permissions.includes("company.select"));
  assert.ok(permissions.includes("fixed_assets.read"));
  assert.ok(permissions.includes("fixed_assets.write"));
  assert.ok(permissions.includes("fiscal_years.write"));
  assert.ok(permissions.includes("periods.write"));
  assert.ok(!permissions.includes("periods.reopen"));
  assert.ok(!permissions.includes("unknown.permission"));
});

test("accounting_viewer puede consultar pero no modificar el plan contable", () => {
  const permissions = permissionsForRole("accounting_viewer");
  assert.ok(permissions.includes("accounts.read"));
  assert.ok(permissions.includes("banks.read"));
  assert.ok(!permissions.includes("banks.write"));
  assert.ok(permissions.includes("fixed_assets.read"));
  assert.ok(!permissions.includes("fixed_assets.write"));
  assert.ok(permissions.includes("templates.read"));
  assert.ok(!permissions.includes("accounts.write"));
  assert.ok(!permissions.includes("templates.write"));
  assert.ok(permissions.includes("journal.read"));
  assert.ok(permissions.includes("ledger.read"));
  assert.ok(!permissions.includes("journal.write"));
  assert.ok(!permissions.includes("journal.post"));
});

test("solo accounting_admin puede reabrir periodos cerrados", () => {
  assert.ok(permissionsForRole("accounting_admin").includes("periods.reopen"));
  assert.ok(!permissionsForRole("accounting_user").includes("periods.reopen"));
  assert.ok(!permissionsForRole("accounting_viewer").includes("periods.reopen"));
});

test("solo accounting_admin puede leer auditoria en Fase 1", () => {
  assert.ok(permissionsForRole("accounting_admin").includes("audit.read"));
  assert.ok(!permissionsForRole("accounting_user").includes("audit.read"));
  assert.ok(!permissionsForRole("accounting_viewer").includes("audit.read"));
});

test("solo accounting_admin puede operar el outbox en Fase 1", () => {
  assert.ok(permissionsForRole("accounting_admin").includes("outbox.read"));
  assert.ok(permissionsForRole("accounting_admin").includes("outbox.retry"));
  assert.ok(!permissionsForRole("accounting_user").includes("outbox.read"));
  assert.ok(!permissionsForRole("accounting_user").includes("outbox.retry"));
});
