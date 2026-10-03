const EXPECTED_DATABASE = 'transgest_workflow_test_oct02';
const MARKER = 'workflow-oct02-isolated';

function configureStaging(env) {
  if (env.TRANSGEST_STAGING !== 'true' || env.DB_NAME !== EXPECTED_DATABASE) {
    throw new Error('Arranque de pruebas rechazado: entorno o base de datos incorrectos.');
  }
  const url = new URL(env.RENDER_EXTERNAL_URL || '');
  if (url.protocol !== 'https:' || !/^transgest-workflow-test-oct02(?:-[a-z0-9]+)?\.onrender\.com$/.test(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Arranque de pruebas rechazado: dirección pública incorrecta.');
  }
  for (const key of ['STAGING_MANAGER_PASSWORD', 'STAGING_ADMIN_PASSWORD']) {
    if (String(env[key] || '').length < 32) throw new Error(`${key}: falta un secreto aleatorio de pruebas.`);
  }
  const publicPort = Number(env.PORT || 10000);
  if (!Number.isInteger(publicPort) || publicPort < 1024 || publicPort > 65535 || publicPort === 3001) {
    throw new Error('Puerto público de pruebas incorrecto.');
  }
  Object.assign(env, {
    NODE_ENV: 'production', PORT: '3001',
    ALLOW_DEMO_SEED: 'false', DEMO_SHOWCASE_SEED: 'false',
    PUBLIC_APP_URL: url.origin, APP_PUBLIC_URL: url.origin, APP_URL: url.origin,
    FRONTEND_URL: url.origin, PUBLIC_API_URL: url.origin, API_PUBLIC_URL: url.origin,
    BACKEND_PUBLIC_URL: url.origin, CORS_ORIGINS: url.origin,
  });
  return { publicPort, origin: url.origin };
}

async function prepareDatabase(client, bootstrap) {
  const { rows: [database] } = await client.query('SELECT current_database() AS name');
  if (database.name !== EXPECTED_DATABASE) throw new Error('La conexión no pertenece a la base de pruebas.');
  const { rows: [state] } = await client.query("SELECT to_regclass('public.transgest_staging_marker') AS marker");
  if (state.marker) {
    const { rows } = await client.query('SELECT name FROM transgest_staging_marker');
    if (rows.length !== 1 || rows[0].name !== MARKER) throw new Error('Identificación de pruebas incorrecta.');
    return 'already_initialized';
  }
  const { rows: [tables] } = await client.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public'");
  if (tables.n !== 0) throw new Error('La base contiene datos ajenos a este entorno: no se modifica.');
  await client.query('BEGIN');
  try {
    await bootstrap(client);
    await client.query('CREATE TABLE transgest_staging_marker (name TEXT PRIMARY KEY)');
    await client.query('INSERT INTO transgest_staging_marker(name) VALUES($1)', [MARKER]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return 'initialized';
}

module.exports = { configureStaging, prepareDatabase, EXPECTED_DATABASE, MARKER };
