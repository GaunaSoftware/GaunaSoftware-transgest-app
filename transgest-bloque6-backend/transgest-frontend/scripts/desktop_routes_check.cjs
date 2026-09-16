const assert = require('node:assert/strict');
const path = require('node:path');
const { appFile } = require('../electron/app-file');
const root = path.resolve(__dirname, '../build');
for (const route of ['/', '/index.html', '/planner', '/planner/', '/?workspace=tms']) {
  assert.equal(appFile(root, 'transgest://app' + route), path.join(root, 'index.html'));
}
assert.equal(appFile(root,'transgest://app/static/js/main.js'),path.join(root,'static/js/main.js'));
assert.equal(appFile(root,'transgest://app/missing.js'),path.join(root,'missing.js'));
for (const url of ['https://app/planner','transgest://other/planner','transgest://user@app/planner',
  'transgest://app/%2e%2e%2fsecret','transgest://app/%2e%2e%5csecret','transgest://app/%ZZ']) {
  assert.equal(appFile(root,url),null,url);
}
console.log('Desktop: Planner, TransGest, assets and traversal checks passed.');
