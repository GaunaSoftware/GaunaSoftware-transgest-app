// Render the current native icon SVG for desktop installers.
// Optional tooling (only when regenerating): @resvg/resvg-js and png-to-ico.
// The icon uses the first T of src/assets/brand/transgest_wordmark.png.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;
const assets = path.join(__dirname, '..', 'assets');
const icon = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
const render = size => new Resvg(icon, { fitTo: { mode:'width', value:size } }).render().asPng();
fs.writeFileSync(path.join(assets, 'icon.png'), render(1024));
pngToIco([256,128,64,48,32,16].map(render)).then(bytes => {
  fs.writeFileSync(path.join(assets, 'icon.ico'), bytes);
  console.log('Iconos de escritorio generados con la marca actual.');
}).catch(error => { console.error(error); process.exitCode = 1; });
