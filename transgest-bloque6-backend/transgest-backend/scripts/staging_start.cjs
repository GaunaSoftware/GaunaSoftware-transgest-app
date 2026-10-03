const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { configureStaging, prepareDatabase } = require('./staging_guard.cjs');
const children = new Set();
let gateway;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  gateway?.close();
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
function launch(file, args = []) {
  const child = spawn(process.execPath, [...args, file], { stdio: 'inherit', env: process.env });
  children.add(child);
  child.on('error', () => stop(1));
  child.on('exit', () => children.delete(child));
  return child;
}
async function migrate() {
  const child = launch(path.join(__dirname, 'migrate.js'));
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('No se pudo preparar el esquema de pruebas.')));
  });
}
async function seedAccess(db) {
  const bcrypt = require('bcryptjs');
  const managerHash = await bcrypt.hash(process.env.STAGING_MANAGER_PASSWORD, 12);
  const adminHash = await bcrypt.hash(process.env.STAGING_ADMIN_PASSWORD, 12);
  await db.transaction(async client => {
    const { rows: [company] } = await client.query(`INSERT INTO empresas(nombre,cif,email_admin,dominio,codigo_acceso,plan,estado)
      VALUES('TRANSGEST · PRUEBAS','B00000000','gerencia@example.invalid','workflow-pruebas','TG-PRUEBAS','enterprise','activo')
      ON CONFLICT(email_admin) DO UPDATE SET email_admin=EXCLUDED.email_admin RETURNING id`);
    await client.query(`INSERT INTO usuarios(empresa_id,nombre,email,username,password_hash,rol,activo)
      VALUES($1,'Gerencia de pruebas','gerencia@example.invalid','gerencia@example.invalid',$2,'gerente',true)
      ON CONFLICT(email) DO NOTHING`, [company.id, managerHash]);
    await client.query(`INSERT INTO superadmins(email,nombre,password_hash,rol,activo)
      VALUES('superadmin@example.invalid','Administración de pruebas',$1,'superadmin',true)
      ON CONFLICT(email) DO NOTHING`, [adminHash]);
  });
}
async function main() {
  const { publicPort } = configureStaging(process.env);
  require('../src/services/envValidator').validateEnv();
  const webRoot = path.join(__dirname, '..', 'staging-web');
  const indexPath = path.join(webRoot, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error('Falta la aplicación de pruebas compilada.');
  let html = fs.readFileSync(indexPath, 'utf8');
  if (!html.includes('data-staging-badge')) {
    html = html.replace('<title>TransGest TMS</title>', '<title>PRUEBAS · TransGest TMS</title>').replace('</body>',
      '<aside data-staging-badge aria-label="Entorno de pruebas" style="position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 24px);padding:5px 12px;border-radius:6px;background:#173d78;color:white;font:600 12px sans-serif;text-align:center;pointer-events:none">PRUEBAS · Datos independientes</aside></body>');
    fs.writeFileSync(indexPath, html);
  }
  const db = require('../src/services/db');
  const client = await db.pool.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'install_completo.sql'), 'utf8').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, '');
    await prepareDatabase(client, database => database.query(sql));
  } finally { client.release(); }
  await migrate();
  const api = launch(path.join(__dirname, '../src/server.js'), ['--require', path.join(__dirname, 'staging_mail_guard.cjs')]);
  api.on('exit', code => { if (!stopping) stop(code || 1); });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(1500) });
      const health = await response.json();
      if (response.ok && health.schema === 'ready') { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('El servidor de pruebas no ha completado su arranque.');
  await seedAccess(db);
  await db.pool.end();
  gateway = require('./staging_gateway.cjs').createGateway({ webRoot }).listen(publicPort, '0.0.0.0');
  gateway.on('error', () => stop(1));
  console.log('Pruebas listas: TG-PRUEBAS. Credenciales custodiadas en las variables de Render; no se muestran en logs.');
}
if (require.main === module) main().catch(error => { console.error(error.message); stop(1); });
module.exports = { seedAccess };
