// PostgreSQL-compatible local preflight; cloud PostgreSQL is checked on activation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'src/server.js'));
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_SEED = 'false';
process.env.DEMO_SHOWCASE_SEED = 'false';
for (const key of ['JWT_SECRET', 'USER_JWT_SECRET', 'SUPERADMIN_JWT_SECRET', 'ACCOUNTING_SSO_JWT_SECRET', 'API_KEYS_ENCRYPTION_SECRET', 'DOC_CONTROL_SECRET', 'STAGING_MANAGER_PASSWORD', 'STAGING_ADMIN_PASSWORD']) process.env[key] = crypto.randomBytes(32).toString('hex');
const { PGlite } = req('@electric-sql/pglite');
const { uuid_ossp } = req('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = req('@electric-sql/pglite/contrib/pg_trgm');

async function main() {
  const pg = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
  const db = req('./services/db');
  let server;
  const adapt = database => ({ query: async (sql, params) => {
    const result = params?.length ? await database.query(sql, params) : (await database.exec(sql)).at(-1) || { rows: [] };
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  } });
  db.query = adapt(pg).query;
  db.transaction = fn => pg.transaction(transaction => fn(adapt(transaction)));
  try {
    const { prepareDatabase, EXPECTED_DATABASE } = require('./staging_guard.cjs');
    // PGlite's internal DB name differs; only this identity read is substituted.
    const client = { query: (sql, params) => sql.startsWith('SELECT current_database()') ? Promise.resolve({ rows: [{ name: EXPECTED_DATABASE }] }) : db.query(sql, params) };
    const sql = fs.readFileSync(path.join(__dirname, 'install_completo.sql'), 'utf8').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, '');
    assert.equal(await prepareDatabase(client, database => database.query(sql)), 'initialized');
    assert.equal(await prepareDatabase(client, () => { throw new Error('must not reinstall'); }), 'already_initialized');
    const { sortMigrationFiles } = require('./migrationHistory');
    for (const file of sortMigrationFiles(fs.readdirSync(path.join(__dirname, 'migrations')).filter(file => file.endsWith('.sql')))) {
      await pg.exec(fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/g, ''));
    }
    const errors = [];
    const code = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
    const migration = code.slice(code.indexOf('async function applyMigrations()'), code.indexOf('// ── Auto-seed:'));
    const logger = { info() {}, warn() {}, error: message => errors.push(message) };
    await vm.runInNewContext(migration + '\napplyMigrations()', { db, logger, require: req, process, console, ensureApiKeyTables: req('./services/apiKeys').ensureTables, captureStartupMigrationError: error => errors.push(error.message), startupMigrationFailures: 0 });
    assert.deepEqual(errors, [], 'The fresh database must accept startup migrations');
    const auth = req('./routes/auth');
    await auth.initializeSchema();
    const { seedAccess } = require('./staging_start.cjs');
    await seedAccess(db);
    const first = (await db.query("SELECT password_hash FROM usuarios WHERE email='gerencia@example.invalid'")).rows[0].password_hash;
    await seedAccess(db);
    const second = (await db.query("SELECT password_hash FROM usuarios WHERE email='gerencia@example.invalid'")).rows[0].password_hash;
    assert.equal(first, second, 'Restarting staging must preserve user password changes');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM empresas')).rows[0].n, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM usuarios')).rows[0].n, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM superadmins')).rows[0].n, 1);
    assert.ok(await req('bcryptjs').compare(process.env.STAGING_MANAGER_PASSWORD, first));
    const app = req('express')();
    app.use(req('express').json());
    app.use('/auth', auth);
    app.use('/informes', req('./routes/informes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gerencia@example.invalid', password: process.env.STAGING_MANAGER_PASSWORD, codigo_empresa: 'TG-PRUEBAS' }) });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    assert.ok(result.token);
    const summaryResponse = await fetch(`http://127.0.0.1:${server.address().port}/informes/bi/resumen?periodo=mes`, { headers: { Authorization: `Bearer ${result.token}` } });
    const summary = await summaryResponse.json();
    assert.equal(summaryResponse.status, 200, summary.error);
    assert.equal(summary.kpis.realizados, 0);
    assert.equal(summary.kpis.facturado, 0);
    assert.equal(summary.kpis.paralizacion, 0);
    console.log('OK: fresh isolated schema, startup migrations, idempotent private access, manager login and real BI summary SQL on a fresh database. No SMTP/AI calls or production data.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pg.close();
    await db.pool.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
