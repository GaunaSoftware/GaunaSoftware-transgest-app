const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { deleteCompany } = require('../src/services/companyDeletion');

async function main() {
  const pg = new PGlite();
  const db = {transaction: fn => pg.transaction(tx => fn({query:(sql,args)=>tx.query(sql,args)}))};
  try {
    await pg.exec(`
      CREATE TABLE empresas(id text PRIMARY KEY,nombre text,estado text);
      CREATE TABLE a_clientes(id text PRIMARY KEY,empresa_id text REFERENCES empresas(id));
      CREATE TABLE z_pedidos(id text PRIMARY KEY,empresa_id text REFERENCES empresas(id),cliente_id text REFERENCES a_clientes(id));
      CREATE TABLE pedido_lineas(id text PRIMARY KEY,pedido_id text REFERENCES z_pedidos(id) ON DELETE CASCADE);
      CREATE TABLE legacy(id text PRIMARY KEY,empresa_id text);
      CREATE TABLE email_log(id text PRIMARY KEY,empresa_id text REFERENCES empresas(id) ON DELETE SET NULL);
      CREATE TABLE audit_log(id text PRIMARY KEY,empresa_id text REFERENCES empresas(id) ON DELETE SET NULL,detalle text);
      INSERT INTO empresas VALUES ('a','Empresa A','cancelado'),('b','Empresa B','activo');
      INSERT INTO a_clientes VALUES ('ca','a'),('cb','b');
      INSERT INTO z_pedidos VALUES ('pa','a','ca'),('pb','b','cb');
      INSERT INTO pedido_lineas VALUES ('la','pa'),('lb','pb');
      INSERT INTO legacy VALUES ('a','a'),('b','b');
      INSERT INTO email_log VALUES ('a','a'),('b','b');
      INSERT INTO audit_log VALUES ('a','a','Conservar auditoría'),('b','b','Conservar otra empresa');
    `);
    await assert.rejects(deleteCompany(db,'a','Nombre incorrecto'), e=>e.status===400);
    await assert.rejects(deleteCompany(db,'b','Empresa B'), e=>e.status===409);
    // An unexpected dependency must roll back even rows removed earlier in the attempt.
    await pg.exec("CREATE TABLE bloqueo(id text PRIMARY KEY, cliente_id text REFERENCES a_clientes(id)); INSERT INTO bloqueo VALUES ('locked','ca');");
    await assert.rejects(deleteCompany(db,'a','Empresa A'), e=>e.status===409);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM z_pedidos WHERE empresa_id='a'")).rows[0].n,1);
    assert.equal((await pg.query("SELECT empresa_id FROM audit_log WHERE id='a'")).rows[0].empresa_id,'a');
    await pg.exec('DROP TABLE bloqueo');
    assert.deepEqual(await deleteCompany(db,'a','Empresa A'),{ok:true,deleted:'Empresa A'});
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM empresas WHERE id='a'")).rows[0].n,0);
    for (const table of ['a_clientes','z_pedidos','legacy','email_log']) {
      const {rows}=await pg.query(`SELECT empresa_id FROM ${table}`);
      assert.deepEqual(rows,[{empresa_id:'b'}],table);
    }
    assert.deepEqual((await pg.query('SELECT id FROM pedido_lineas')).rows,[{id:'lb'}]);
    assert.equal((await pg.query("SELECT empresa_id FROM audit_log WHERE id='a'")).rows[0].empresa_id,null);
    await assert.rejects(deleteCompany(db,'a','Empresa A'),e=>e.status===404);
    console.log('PASS company deletion: legacy non-cascade dependencies, child ordering, tenant isolation, rollback, audit retention and confirmation checks');
  } finally {await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
