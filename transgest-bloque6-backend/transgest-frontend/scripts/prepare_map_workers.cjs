const fs = require('node:fs');
const path = require('node:path');
const pkg = require.resolve('maplibre-gl/package.json');
const {version} = require(pkg);
const source = path.dirname(pkg);
const destination = path.resolve(__dirname, '../public/vendor/maplibre', version);
fs.mkdirSync(destination, {recursive: true});
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  fs.copyFileSync(path.join(source, 'dist', file), path.join(destination, file));
}
fs.copyFileSync(path.join(source, 'LICENSE.txt'), path.join(destination, 'LICENSE.txt'));
console.log(`MapLibre ${version}: worker and shared module prepared.`);
