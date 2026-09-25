const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { bootstrapEmptyDatabase } = require('./bootstrap_empty_database.cjs');

async function main() {
  const pg = new PGlite();
  try {
    // Minimal synthetic schema: PGlite does not bundle uuid-ossp or pg_trgm.
    const sql = 'CREATE TABLE usuarios(id uuid PRIMARY KEY); CREATE TABLE clientes(id uuid PRIMARY KEY); CREATE TABLE pedidos(id uuid PRIMARY KEY);';
    const client = { query: (statement, params) => statement === sql ? pg.exec(statement) : pg.query(statement, params) };
    assert.equal(await bootstrapEmptyDatabase(client, sql), 'initialized');
    assert.equal(await bootstrapEmptyDatabase(client, sql), 'already_initialized');
    const { rows } = await pg.query("SELECT to_regclass('public.pedidos') IS NOT NULL AS present");
    assert.equal(rows[0].present, true);
  } finally {
    await pg.close();
  }

  const partial = new PGlite();
  try {
    await partial.exec('CREATE TABLE usuarios(id uuid PRIMARY KEY)');
    await assert.rejects(bootstrapEmptyDatabase(partial), /parcialmente inicializada/);
    const { rows } = await partial.query("SELECT to_regclass('public.clientes') IS NULL AS absent");
    assert.equal(rows[0].absent, true);
  } finally {
    await partial.close();
  }
  console.log('PASS: base vacía, idempotencia y rechazo de base parcial. Datos sintéticos.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
