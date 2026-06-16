require("../src/resolveWorkspaceModules");
const db = require("../src/services/db");
const config = require("../src/services/config");
const logger = require("../src/services/logger");

function validateRoleName(value) {
  const role = String(value || "").trim();
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("El rol de base de datos debe ser un identificador PostgreSQL simple");
  }
  return role;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function assertSafeRoleSeparation({ adminUser, apiUser, workerUser, legacyUser }) {
  if (new Set([apiUser, workerUser, legacyUser]).size !== 3) {
    throw new Error("Los roles SQL de API, worker y runtime legacy deben ser distintos");
  }
  if ([apiUser, workerUser, legacyUser].includes(adminUser)) {
    throw new Error("Los roles SQL runtime no pueden reutilizar la credencial administradora");
  }
}

async function passwordLiteral(client, password, variableName) {
  if (String(password || "").length < 12) {
    throw new Error(`${variableName} debe tener al menos 12 caracteres`);
  }
  const { rows } = await client.query("SELECT quote_literal($1) AS password_literal", [password]);
  return rows[0].password_literal;
}

async function ensureLoginRole(client, roleName, password, variableName) {
  const roleIdentifier = quoteIdentifier(roleName);
  const literal = await passwordLiteral(client, password, variableName);
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [roleName]);
  if (role.rows.length) {
    await client.query(`ALTER ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal}`);
  } else {
    await client.query(`CREATE ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal}`);
  }
}

async function resetAccountingPrivileges(client, roleName, schemaIdentifier) {
  const roleIdentifier = quoteIdentifier(roleName);
  await client.query(`REVOKE ALL ON SCHEMA ${schemaIdentifier} FROM ${roleIdentifier}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaIdentifier} FROM ${roleIdentifier}`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schemaIdentifier} FROM ${roleIdentifier}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} REVOKE ALL ON TABLES FROM ${roleIdentifier}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} REVOKE ALL ON SEQUENCES FROM ${roleIdentifier}`);
}

async function provisionRuntimeRole() {
  const apiUser = validateRoleName(process.env.ACCOUNTING_API_DB_USER || "transgest_accounting_api");
  const apiPassword = String(process.env.ACCOUNTING_API_DB_PASSWORD || "");
  const workerUser = validateRoleName(process.env.ACCOUNTING_WORKER_DB_USER || "transgest_accounting_worker");
  const workerPassword = String(process.env.ACCOUNTING_WORKER_DB_PASSWORD || "");
  const legacyUser = validateRoleName(process.env.ACCOUNTING_LEGACY_RUNTIME_DB_USER || "transgest_accounting_app");
  const databaseIdentifier = quoteIdentifier(config.db.database);
  const schemaIdentifier = quoteIdentifier(config.schema);

  assertSafeRoleSeparation({
    adminUser: config.db.user,
    apiUser,
    workerUser,
    legacyUser,
  });

  await db.transaction(async client => {
    await client.query(`REVOKE ALL ON SCHEMA ${schemaIdentifier} FROM PUBLIC`);
    await ensureLoginRole(client, apiUser, apiPassword, "ACCOUNTING_API_DB_PASSWORD");
    await ensureLoginRole(client, workerUser, workerPassword, "ACCOUNTING_WORKER_DB_PASSWORD");
    await resetAccountingPrivileges(client, apiUser, schemaIdentifier);
    await resetAccountingPrivileges(client, workerUser, schemaIdentifier);

    const legacyRole = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [legacyUser]);
    if (legacyRole.rows.length && legacyUser !== apiUser && legacyUser !== workerUser) {
      await resetAccountingPrivileges(client, legacyUser, schemaIdentifier);
    }

    const apiIdentifier = quoteIdentifier(apiUser);
    await client.query(`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${apiIdentifier}`);
    await client.query(`GRANT USAGE ON SCHEMA ${schemaIdentifier} TO ${apiIdentifier}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaIdentifier} TO ${apiIdentifier}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schemaIdentifier} TO ${apiIdentifier}`);
    await client.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ${schemaIdentifier}.schema_migrations FROM ${apiIdentifier}`);
    await client.query(`GRANT SELECT ON TABLE ${schemaIdentifier}.schema_migrations TO ${apiIdentifier}`);
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE ${schemaIdentifier}.audit_log FROM ${apiIdentifier}`);
    await client.query(`GRANT SELECT, INSERT ON TABLE ${schemaIdentifier}.audit_log TO ${apiIdentifier}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${apiIdentifier}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} GRANT USAGE, SELECT ON SEQUENCES TO ${apiIdentifier}`);

    const workerIdentifier = quoteIdentifier(workerUser);
    await client.query(`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${workerIdentifier}`);
    await client.query(`GRANT USAGE ON SCHEMA ${schemaIdentifier} TO ${workerIdentifier}`);
    await client.query(`GRANT SELECT, UPDATE ON TABLE ${schemaIdentifier}.outbox_events TO ${workerIdentifier}`);
    await client.query(`GRANT SELECT, INSERT ON TABLE ${schemaIdentifier}.processed_events TO ${workerIdentifier}`);
  });

  logger.info({
    msg: "accounting_runtime_roles_provisioned",
    api_role: apiUser,
    worker_role: workerUser,
    legacy_role_revoked: legacyUser,
    schema: config.schema,
  });
}

if (require.main === module) {
  provisionRuntimeRole()
    .then(() => db.pool.end())
    .catch(async error => {
      logger.error({ msg: "accounting_runtime_role_provision_failed", error: error.message, stack: error.stack });
      await db.pool.end();
      process.exitCode = 1;
    });
}

module.exports = {
  provisionRuntimeRole,
  quoteIdentifier,
  validateRoleName,
  assertSafeRoleSeparation,
};
