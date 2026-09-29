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
    await ensureCompanyAccessCodes(pg);
    assert.deepEqual((await pg.query('SELECT id,codigo_acceso FROM empresas ORDER BY id')).rows, companies);
    const candidates = (await pg.query(`SELECT u.id FROM usuarios u JOIN empresas e ON e.id=u.empresa_id
      WHERE LOWER(u.username)=$1 AND ($2::text='' OR e.codigo_acceso=$2) LIMIT 2`, ['plg',''])).rows;
    assert.equal(candidates.length, 2, 'without company code the login is ambiguous');
    const selected = (await pg.query(`SELECT u.id FROM usuarios u JOIN empresas e ON e.id=u.empresa_id
      WHERE LOWER(u.username)=$1 AND ($2::text='' OR e.codigo_acceso=$2) LIMIT 2`, ['plg',companies[0].codigo_acceso])).rows;
    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, 'ua');
    await assert.rejects(pg.query('UPDATE empresas SET codigo_acceso=$1 WHERE id=$2', [companies[0].codigo_acceso,'b']), /duplicate key/i);
    await pg.query("INSERT INTO empresas(id,nombre) VALUES ('c','Empresa C')");
    assert.ok((await pg.query("SELECT codigo_acceso FROM empresas WHERE id='c'")).rows[0].codigo_acceso);
    assert.equal(normalizeCompanyCode(' tlm-001 '), 'TLM-001');
    assert.equal(validCompanyCode('TLM-001'), true);
    assert.equal(validCompanyCode('TLM 001'), false);
    console.log('OK company access code: unique migration, ambiguous username, scoped login, new company');
  } finally { await pg.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
