const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertSafeRoleSeparation,
  quoteIdentifier,
  validateRoleName,
} = require("../scripts/provision-runtime-role");

const compose = fs.readFileSync(
  path.join(__dirname, "..", "..", "transgest-backend", "docker-compose.yml"),
  "utf8"
);

test("validateRoleName acepta rol runtime simple y rechaza SQL arbitrario", () => {
  assert.equal(validateRoleName("transgest_accounting_app"), "transgest_accounting_app");
  assert.throws(() => validateRoleName("app; DROP ROLE x"), /identificador PostgreSQL simple/);
});

test("quoteIdentifier escapa identificadores PostgreSQL", () => {
  assert.equal(quoteIdentifier("accounting"), "\"accounting\"");
  assert.equal(quoteIdentifier("a\"b"), "\"a\"\"b\"");
});

test("el provisioner exige roles runtime distintos de la credencial administradora", () => {
  const valid = {
    adminUser: "transgest_user",
    apiUser: "transgest_accounting_api",
    workerUser: "transgest_accounting_worker",
    legacyUser: "transgest_accounting_app",
  };

  assert.doesNotThrow(() => assertSafeRoleSeparation(valid));
  assert.throws(
    () => assertSafeRoleSeparation({ ...valid, workerUser: valid.apiUser }),
    /deben ser distintos/
  );
  assert.throws(
    () => assertSafeRoleSeparation({ ...valid, apiUser: valid.adminUser }),
    /credencial administradora/
  );
});

test("docker compose separa migrador, provisioner, API y worker contables", () => {
  assert.match(compose, /accounting-migrator:/);
  assert.match(compose, /accounting-db-provisioner:/);
  assert.match(compose, /condition: service_completed_successfully/);
  assert.match(compose, /ACCOUNTING_API_DB_USER:-transgest_accounting_api/);
  assert.match(compose, /ACCOUNTING_WORKER_DB_USER:-transgest_accounting_worker/);
  assert.doesNotMatch(compose, /ACCOUNTING_RUNTIME_DB_USER:-transgest_accounting_app/);
});

test("el provisioner limita el worker y revoca el rol runtime legacy", () => {
  const provisioner = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "provision-runtime-role.js"),
    "utf8"
  );

  assert.match(provisioner, /GRANT SELECT, UPDATE ON TABLE .*\.outbox_events/);
  assert.match(provisioner, /GRANT SELECT, INSERT ON TABLE .*\.processed_events/);
  assert.match(provisioner, /resetAccountingPrivileges\(client, legacyUser/);
  assert.match(provisioner, /ALTER DEFAULT PRIVILEGES .* REVOKE ALL ON TABLES/);
});
