// Initialise the legacy base schema only on a genuinely empty database.
// Later changes remain the responsibility of `npm run migrate`.
const fs = require('node:fs');
const path = require('node:path');

const BASE_TABLES = ['usuarios', 'clientes', 'pedidos'];

async function bootstrapEmptyDatabase(client, sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8')) {
  const { rows } = await client.query(
    `SELECT ${BASE_TABLES.map((table, index) => `to_regclass('public.${table}') AS t${index}`).join(', ')}`
  );
  const present = BASE_TABLES.filter((_, index) => rows[0][`t${index}`] !== null);
  if (present.length === BASE_TABLES.length) return 'already_initialized';
  if (present.length) {
    throw new Error(`Base de datos parcialmente inicializada (${present.join(', ')}); no se modifica`);
  }
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
    return 'initialized';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (require.main === module) {
  const db = require('../src/services/db');
  db.pool.connect()
    .then(async client => {
      try {
        console.log(`Base inicial: ${await bootstrapEmptyDatabase(client)}`);
      } finally {
        client.release();
      }
    })
    .catch(error => {
      console.error(`No se pudo preparar la base vacía: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { bootstrapEmptyDatabase };
