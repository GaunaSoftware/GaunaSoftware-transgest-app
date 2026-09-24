const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function main() {
  const db = new PGlite();
  await db.exec("CREATE TABLE empresas(id uuid PRIMARY KEY, plan varchar(20) NOT NULL DEFAULT 'basico');");
  await db.query("INSERT INTO empresas(id,plan) VALUES('00000000-0000-0000-0000-000000000001','basico'),('00000000-0000-0000-0000-000000000002','profesional')");
  for (const file of ['20260924_commercial_origin.sql','20260924_invoice_template.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8'));
  }
  const { rows } = await db.query('SELECT plan,origen_comercial FROM empresas ORDER BY id');
  assert.deepEqual(rows.map(row=>row.plan),['profesional','profesional']);
  assert.deepEqual(rows.map(row=>row.origen_comercial),[null,null], 'existing companies require classification');
  await db.query("INSERT INTO empresas(id,origen_comercial) VALUES('00000000-0000-0000-0000-000000000003','canal')");
  assert.equal((await db.query("SELECT plan FROM empresas WHERE id='00000000-0000-0000-0000-000000000003'")).rows[0].plan,'profesional');
  await assert.rejects(db.query("INSERT INTO empresas(id,origen_comercial) VALUES('00000000-0000-0000-0000-000000000004','desconocido')"));
  await db.query("INSERT INTO empresa_factura_plantillas(empresa_id,nombre,mime,imagen_base64) VALUES('00000000-0000-0000-0000-000000000003','QA','image/png','AA==')");
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM empresa_factura_plantillas')).rows[0].n,1);
  await db.close();
  console.log('Migraciones comerciales y de plantilla en DB aislada: OK');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
