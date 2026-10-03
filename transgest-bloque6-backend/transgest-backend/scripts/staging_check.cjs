const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { configureStaging, prepareDatabase, MARKER, EXPECTED_DATABASE } = require('./staging_guard.cjs');
const { validateRecipients, installMailGuard } = require('./staging_mail_guard.cjs');
const { createGateway } = require('./staging_gateway.cjs');

async function main() {
  const correct = { TRANSGEST_STAGING: 'true', DB_NAME: EXPECTED_DATABASE, RENDER_EXTERNAL_URL: 'https://transgest-workflow-test-oct02.onrender.com', STAGING_MANAGER_PASSWORD: 'a'.repeat(40), STAGING_ADMIN_PASSWORD: 'b'.repeat(40), PORT: '10000' };
  for (const patch of [{ DB_NAME: 'transgest' }, { TRANSGEST_STAGING: '' }, { RENDER_EXTERNAL_URL: 'https://transgest.app' }, { RENDER_EXTERNAL_URL: 'https://transgest-workflow-test-oct02.onrender.com.evil.invalid' }, { STAGING_MANAGER_PASSWORD: '' }]) {
    assert.throws(() => configureStaging({ ...correct, ...patch }));
  }
  const env = { ...correct, PUBLIC_API_URL: 'https://api.transgest.app', CORS_ORIGINS: '*' };
  assert.equal(configureStaging(env).publicPort, 10000);
  assert.equal(env.PUBLIC_API_URL, correct.RENDER_EXTERNAL_URL);
  assert.equal(env.CORS_ORIGINS, correct.RENDER_EXTERNAL_URL);
  assert.equal(env.DEMO_SHOWCASE_SEED, 'false');

  function database({ name = EXPECTED_DATABASE, marker = null, tables = 0 } = {}) {
    const calls = [];
    return { calls, async query(sql, params) {
      calls.push(sql);
      if (sql.includes('current_database')) return { rows: [{ name }] };
      if (sql.includes('to_regclass')) return { rows: [{ marker }] };
      if (sql.includes('pg_tables')) return { rows: [{ n: tables }] };
      if (sql === 'SELECT name FROM transgest_staging_marker') return { rows: [{ name: marker }] };
      return { rows: [] };
    } };
  }
  for (const client of [database({ name: 'transgest' }), database({ tables: 7 }), database({ marker: 'another-test' })]) {
    await assert.rejects(prepareDatabase(client, () => { throw new Error('must not write'); }));
    assert.ok(!client.calls.includes('BEGIN'), 'No writes to an unrecognized database');
  }
  const known = database({ marker: MARKER });
  assert.equal(await prepareDatabase(known, () => { throw new Error('must not reseed'); }), 'already_initialized');
  const fresh = database();
  assert.equal(await prepareDatabase(fresh, async client => client.query('BASE SCHEMA')), 'initialized');
  assert.equal(fresh.calls.at(-1), 'COMMIT');
  const failed = database();
  await assert.rejects(prepareDatabase(failed, async () => { throw new Error('installation failed'); }));
  assert.equal(failed.calls.at(-1), 'ROLLBACK');

  validateRecipients({ to: 'Tester <QA@example.invalid>', cc: [{ address: 'qa2@example.invalid' }] }, 'qa@example.invalid, qa2@example.invalid');
  for (const mail of [{ to: 'client@real.invalid' }, { to: 'qa@example.invalid', bcc: 'client@real.invalid' }, { to: 'qa@example.invalid', envelope: { to: ['client@real.invalid'] } }, { raw: 'To: client@real.invalid' }, { to: 'qa@example.invalid' }]) {
    assert.throws(() => validateRecipients(mail, mail.to === 'qa@example.invalid' && !mail.bcc && !mail.envelope ? '' : 'qa@example.invalid'));
  }
  const nodemailer=require('nodemailer'),originalTransport=nodemailer.createTransport;
  try {
    let delivered=0;
    nodemailer.createTransport=()=>({sendMail:async()=>{delivered++;return {messageId:'synthetic-only'};}});
    installMailGuard({TRANSGEST_STAGING:'true',STAGING_EMAIL_UNRESTRICTED:'true'});
    await nodemailer.createTransport({}).sendMail({to:'any@example.invalid',bcc:'another@example.invalid'});
    assert.equal(delivered,1,'Explicit unrestricted mode reaches the configured SMTP boundary without a list');
    installMailGuard({TRANSGEST_STAGING:'true',STAGING_EMAIL_ALLOWLIST:''});
    await assert.rejects(nodemailer.createTransport({}).sendMail({to:'any@example.invalid'}),{code:'STAGING_RECIPIENT_BLOCKED'});
  } finally {nodemailer.createTransport=originalTransport;}

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'transgest-staging-check-'));
  fs.writeFileSync(path.join(folder, 'index.html'), '<html>STAGING FRONTEND</html>');
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => res.end(JSON.stringify({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString('base64'), authorization: req.headers.authorization })));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = createGateway({ webRoot: folder, backendPort: upstream.address().port }).listen(0, '127.0.0.1');
  await new Promise(resolve => gateway.on('listening', resolve));
  try {
    const base = `http://127.0.0.1:${gateway.address().port}`;
    const upload = Buffer.from([0, 255, 18, 72, 25]);
    const response = await fetch(base + '/api/v1/pedidos/colaborador/upload?token=test-only', { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: upload });
    const data = await response.json();
    assert.equal(data.path, '/api/v1/pedidos/colaborador/upload?token=test-only');
    assert.equal(data.method, 'POST');
    assert.equal(data.authorization, 'Bearer test-only');
    assert.equal(data.body, upload.toString('base64'), 'Uploads must reach the backend byte for byte');
    assert.equal(response.headers.get('x-transgest-environment'), 'staging');
    const page = await fetch(base + '/planner');
    assert.match(await page.text(), /STAGING FRONTEND/);
    assert.ok(!page.headers.get('content-security-policy').includes('api.transgest.app'));
    assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \//);
    await new Promise(resolve => upstream.close(resolve));
    assert.equal((await fetch(base + '/api/v1/pedidos')).status, 502);
  } finally {
    await new Promise(resolve => gateway.close(resolve));
    if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
    fs.unlinkSync(path.join(folder, 'index.html'));
    fs.rmdirSync(folder);
  }
  console.log('OK: staging rejects production databases, keeps migrations atomic, restricts real email recipients and proxies uploads without changing them.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
