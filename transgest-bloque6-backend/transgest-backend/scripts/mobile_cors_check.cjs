const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { appCorsOptions } = require('../src/services/appCors');
const { authenticate } = require('../src/middleware/auth');

async function run() {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../transgest-frontend/capacitor.config.json'), 'utf8'));
  const androidOrigin = `${config.server.androidScheme}://${config.server.hostname || 'localhost'}`;
  assert.equal(androidOrigin, 'https://localhost');
  const app = express();
  app.use(cors(appCorsOptions(' https://transgest.app,https://planner.transgest.app ')));
  app.use(express.json());
  app.get('/api/v1/pedidos', authenticate, (_req, res) => res.json({ private: true }));
  // No credentials or real users: exercise JSON transport, not a login attempt.
  app.post('/transport', (req, res) => res.json({ received: req.body.synthetic === true }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const origin of [androidOrigin, 'https://transgest.app', 'https://planner.transgest.app', 'transgest://app']) {
      const preflight = await fetch(`${base}/api/v1/pedidos`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
      assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
      assert.match(preflight.headers.get('vary'), /Origin/);
      const protectedResponse = await fetch(`${base}/api/v1/pedidos`, { headers: { Origin: origin } });
      assert.equal(protectedResponse.status, 401, 'CORS must not bypass real authentication');
      assert.equal(protectedResponse.headers.get('access-control-allow-origin'), origin);
      assert.match((await protectedResponse.json()).error, /token/i);
    }
    const json = await fetch(`${base}/transport`, { method: 'POST', headers: { Origin: androidOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ synthetic: true }) });
    assert.equal(json.headers.get('access-control-allow-origin'), androidOrigin);
    assert.deepEqual(await json.json(), { received: true });
    for (const origin of ['https://localhost.attacker.invalid', 'http://localhost', 'https://localhost:8443', 'https://127.0.0.1', 'capacitor://localhost', 'null', 'https://untrusted.invalid']) {
      const response = await fetch(`${base}/api/v1/pedidos`, { headers: { Origin: origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), null, origin);
      assert.equal(response.status, 401);
    }
    const withoutOrigin = await fetch(`${base}/api/v1/pedidos`);
    assert.equal(withoutOrigin.status, 401);
    console.log('Mobile CORS OK: APK origin, web/desktop compatibility, JSON/preflight, real authentication and denied lookalike origins.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
