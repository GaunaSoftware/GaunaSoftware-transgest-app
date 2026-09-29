const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { ensureCompanyAccessCodes, normalizeCompanyCode, validCompanyCode } = require('../src/services/companyAccessCode');

async function main() {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE empresas(id text PRIMARY KEY, nombre text);
      CREATE TABLE usuarios(id text PRIMARY KEY, empresa_id text, username text, email text, activo boolean DEFAULT true);
      INSERT INTO empresas VALUES ('a','Empresa A'),('b','Empresa B');
      INSERT INTO usuarios VALUES ('ua','a','plg','a@example.test',true),('ub','b','plg','b@example.test',true);`);
    await ensureCompanyAccessCodes(pg);
    const companies = (await pg.query('SELECT id,codigo_acceso FROM empresas ORDER BY id')).rows;
    assert.equal(companies.length, 2);
    assert.notEqual(companies[0].codigo_acceso, companies[1].codigo_acceso);
    companies.forEach(({ codigo_acceso }) => assert.match(codigo_acceso, /^TG-[A-F0-9]{16}$/));
    await ensureCompanyAccessCodes(pg);
    assert.deepEqual((await pg.query('SELECT id,codigo_acceso FROM empresas ORDER BY id')).rows, companies);
    const withoutCode = (await pg.query(`SELECT u.id FROM usuarios u JOIN empresas e ON e.id=u.empresa_id
      WHERE LOWER(u.username)=$1 AND e.codigo_acceso=$2 LIMIT 2`, ['plg',''])).rows;
    assert.equal(withoutCode.length, 0, 'without company code no account is selected');
    const selected = (await pg.query(`SELECT u.id FROM usuarios u JOIN empresas e ON e.id=u.empresa_id
      WHERE LOWER(u.username)=$1 AND e.codigo_acceso=$2 LIMIT 2`, ['plg',companies[0].codigo_acceso])).rows;
    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, 'ua');
    await assert.rejects(pg.query('UPDATE empresas SET codigo_acceso=$1 WHERE id=$2', [companies[0].codigo_acceso,'b']), /duplicate key/i);
    await assert.rejects(pg.query('UPDATE empresas SET codigo_acceso=NULL WHERE id=$1', ['b']), /null value/i);
    await pg.query("INSERT INTO empresas(id,nombre) VALUES ('c','Empresa C')");
    const newCode = (await pg.query("SELECT codigo_acceso FROM empresas WHERE id='c'")).rows[0].codigo_acceso;
    assert.match(newCode, /^TG-[A-F0-9]{16}$/);
    assert.ok(!companies.some(({ codigo_acceso }) => codigo_acceso === newCode));
    await pg.query("UPDATE empresas SET codigo_acceso='ASENSI-CODE' WHERE id='a'");
    await ensureCompanyAccessCodes(pg);
    assert.equal((await pg.query("SELECT codigo_acceso FROM empresas WHERE id='a'")).rows[0].codigo_acceso, 'ASENSI-CODE');
    assert.equal(normalizeCompanyCode(' tlm-001 '), 'TLM-001');
    assert.equal(validCompanyCode('TLM-001'), true);
    assert.equal(validCompanyCode('TLM 001'), false);
    const authRouter = require('../src/routes/auth');
    const route = (path, method) => authRouter.stack.find(layer => layer.route?.path === path && layer.route?.methods?.[method]).route;
    const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
    const missingCodeLogin = response();
    await route('/login', 'post').stack.at(-1).handle({ body: { email: 'plg', password: 'pass1234' } }, missingCodeLogin);
    assert.equal(missingCodeLogin.statusCode, 400);
    assert.match(missingCodeLogin.body.error, /código de empresa/i);
    const missingCodeBrand = response();
    await route('/login-brand', 'get').stack.at(-1).handle({ query: { identifier: 'plg' } }, missingCodeBrand);
    assert.deepEqual(missingCodeBrand.body, { found: false });
    console.log('OK company access code: random unique default, stable existing codes, mandatory scoped login');
  } finally { await pg.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
