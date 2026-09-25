const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function main() {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY);
      CREATE TABLE usuarios(id uuid PRIMARY KEY);
      CREATE TABLE clientes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,cif text UNIQUE);
      CREATE TABLE choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,dni text UNIQUE);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,matricula text UNIQUE);
      CREATE TABLE colaboradores(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,cif text UNIQUE);
      CREATE TABLE rutas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),origen text,destino text,km integer);
      CREATE TABLE ruta_precios_cliente(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ruta_id uuid,cliente_id uuid,precio numeric);
      CREATE TABLE docs_choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chofer_id uuid,tipo text);
      CREATE TABLE docs_vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehiculo_id uuid,tipo text);`);
    const dir = path.join(__dirname, 'migrations');
    for (const file of ['20260924_import_batches.sql','20260924_import_doc_metadata.sql','20260924_import_master_fields.sql','20260924_import_tenant_keys.sql']) {
      await pg.exec(fs.readFileSync(path.join(dir,file),'utf8'));
    }
    const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
    await pg.query('INSERT INTO empresas(id) VALUES($1),($2)',[a,b]);
    await pg.query('INSERT INTO clientes(empresa_id,nombre,cif) VALUES($1,$2,$3),($4,$5,$6)',[a,'A','B12345678',b,'B','B12345678']);
    await pg.query('INSERT INTO vehiculos(empresa_id,matricula) VALUES($1,$2),($3,$4)',[a,'0009-LCZ',b,'0009LCZ']);
    await assert.rejects(pg.query('INSERT INTO vehiculos(empresa_id,matricula) VALUES($1,$2)',[a,'0009 LCZ']), { code:'23505' });
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n,2);
    console.log('PASS: additive document/master schema, same CIF and plate across tenants, normalized plate unique within tenant. Synthetic PGlite only.');
  } finally { await pg.close(); }

  // Un cliente de producción puede tener maestros repetidos antes de importar.
  // La migración debe conservarlos y ofrecer búsqueda sin bloquear el deploy.
  const legacy = new PGlite();
  try {
    await legacy.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY);
      CREATE TABLE usuarios(id uuid PRIMARY KEY);
      CREATE TABLE clientes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,cif text UNIQUE);
      CREATE TABLE choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,dni text UNIQUE);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,matricula text UNIQUE);
      CREATE TABLE colaboradores(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,nombre text,cif text UNIQUE);
      CREATE TABLE rutas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),origen text,destino text,km integer);
      CREATE TABLE ruta_precios_cliente(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ruta_id uuid,cliente_id uuid,precio numeric);
      CREATE TABLE docs_choferes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chofer_id uuid,tipo text);
      CREATE TABLE docs_vehiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehiculo_id uuid,tipo text);`);
    const dir = path.join(__dirname, 'migrations');
    for (const file of ['20260924_import_batches.sql','20260924_import_doc_metadata.sql','20260924_import_master_fields.sql']) {
      await legacy.exec(fs.readFileSync(path.join(dir,file),'utf8'));
    }
    await legacy.exec(`ALTER TABLE clientes DROP CONSTRAINT clientes_cif_key;
      ALTER TABLE choferes DROP CONSTRAINT choferes_dni_key;
      ALTER TABLE vehiculos DROP CONSTRAINT vehiculos_matricula_key;
      ALTER TABLE colaboradores DROP CONSTRAINT colaboradores_cif_key;`);
    const company='11111111-1111-4111-8111-111111111111';
    await legacy.query('INSERT INTO empresas(id) VALUES($1)',[company]);
    await legacy.query("INSERT INTO clientes(empresa_id,nombre,cif) VALUES($1,'Anterior A','B12345678'),($1,'Anterior B',' b12345678 ')",[company]);
    await legacy.query("INSERT INTO choferes(empresa_id,nombre,dni) VALUES($1,'Anterior A','12345678A'),($1,'Anterior B','12345678-A')",[company]);
    await legacy.query("INSERT INTO vehiculos(empresa_id,matricula) VALUES($1,'0009-LCZ'),($1,'0009 LCZ')",[company]);
    await legacy.query("INSERT INTO colaboradores(empresa_id,nombre,cif) VALUES($1,'Anterior A','B87654321'),($1,'Anterior B',' b87654321 ')",[company]);
    await legacy.exec(fs.readFileSync(path.join(dir,'20260924_import_tenant_keys.sql'),'utf8'));
    for (const table of ['clientes','choferes','vehiculos','colaboradores']) {
      assert.equal((await legacy.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n,2);
      const indexes=(await legacy.query('SELECT indexname FROM pg_indexes WHERE tablename=$1',[table])).rows.map(row=>row.indexname);
      assert(indexes.some(name=>name.endsWith('_import_lookup')), `${table}: falta índice de búsqueda`);
      assert(indexes.some(name=>name.endsWith('_imported')), `${table}: falta unicidad de lotes importados`);
    }
    console.log('PASS: la migración conserva los maestros duplicados por empresa y mantiene los índices de importación.');
  } finally { await legacy.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
