const fs = require('node:fs');
const path = require('node:path');
const pkg = require.resolve('maplibre-gl/package.json');
const {version} = require(pkg);
const source = path.dirname(pkg);
const destination = path.resolve(__dirname, '../public/vendor/maplibre', version);
fs.mkdirSync(destination, {recursive: true});
// v5 ships a self-contained CSP worker; v6 ships an ESM worker with a sibling.
const files = Number(version.split('.')[0]) >= 6
  ? ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']
  : ['maplibre-gl-csp-worker.js'];
for (const file of files) fs.copyFileSync(path.join(source, 'dist', file), path.join(destination, file));
fs.copyFileSync(path.join(source, 'LICENSE.txt'), path.join(destination, 'LICENSE.txt'));
console.log(`MapLibre ${version}: ${files.join(', ')} prepared.`);
