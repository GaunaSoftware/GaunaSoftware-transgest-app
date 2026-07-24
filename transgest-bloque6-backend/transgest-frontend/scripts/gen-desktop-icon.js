// ══════════════════════════════════════════════════════
// GENERADOR DEL ICONO DE ESCRITORIO (assets/icon.ico + icon.png)
// ══════════════════════════════════════════════════════
//
// Toma el LOGO real de TransGest (src/assets/brand/transgest_logo_dark.svg),
// extrae el isotipo (la "T" con las lineas de carretera, extremo izquierdo del
// wordmark) y lo compone en un cuadrado con el degradado de marca. De ahi saca
// un PNG 1024x1024 y un .ico multi-resolucion para el .exe.
//
// Requiere (solo para regenerar):  npm i -D @resvg/resvg-js png-to-ico
// Uso:                              node scripts/gen-desktop-icon.js

const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");
const pngToIcoMod = require("png-to-ico");
const pngToIco = pngToIcoMod.default || pngToIcoMod;

const ROOT = path.join(__dirname, "..");
const LOGO = path.join(ROOT, "src", "assets", "brand", "transgest_logo_dark.svg");
const ASSETS = path.join(ROOT, "assets");
const OUT_SVG = path.join(ASSETS, "icon.svg");
const OUT_PNG = path.join(ASSETS, "icon.png");
const OUT_ICO = path.join(ASSETS, "icon.ico");

// Subpaths del isotipo dentro del <path> unico del logo (extremo izquierdo:
// la "T" + swoosh de carretera). Se identifican por su punto inicial "M x y".
const ISO_STARTS = ["M 8 51", "M 405 30", "M 217 58"];

function extractIsotype() {
  const svg = fs.readFileSync(LOGO, "utf8");
  const dMatch = svg.match(/d="([\s\S]*?)"/);
  if (!dMatch) throw new Error("No se encontro el atributo d en el logo");
  const d = dMatch[1];
  // Cada subpath termina en "Z". Nos quedamos con los del isotipo.
  const subpaths = d
    .split("Z")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s + " Z");
  const iso = subpaths.filter((s) => ISO_STARTS.some((p) => s.startsWith(p)));
  if (iso.length !== ISO_STARTS.length) {
    throw new Error(
      `Se esperaban ${ISO_STARTS.length} subpaths del isotipo, encontrados ${iso.length}`
    );
  }
  return iso.join(" ");
}

function buildIconSvg(isotypeD) {
  // bbox del isotipo ~ x[8..405] y[8..153] -> centro (206,80), tamano 397x145.
  // Lo escalamos y centramos en un lienzo 1024 con esquinas redondeadas.
  const scale = 1.6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f766e"/>
      <stop offset="1" stop-color="#14b8a6"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="232" ry="232" fill="url(#bg)"/>
  <g transform="translate(512 512) scale(${scale}) translate(-206 -80)" fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd">
    <path d="${isotypeD}"/>
  </g>
</svg>`;
}

function main() {
  if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });
  const isotypeD = extractIsotype();
  const iconSvg = buildIconSvg(isotypeD);
  fs.writeFileSync(OUT_SVG, iconSvg);
  console.log("icon.svg escrito");

  const resvg = new Resvg(iconSvg, { fitTo: { mode: "width", value: 1024 } });
  const png1024 = resvg.render().asPng();
  fs.writeFileSync(OUT_PNG, png1024);
  console.log("icon.png 1024x1024 escrito");

  // .ico multi-resolucion a partir de PNGs 256/128/64/48/32/16.
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngs = sizes.map((s) =>
    new Resvg(iconSvg, { fitTo: { mode: "width", value: s } }).render().asPng()
  );
  pngToIco(pngs).then((buf) => {
    fs.writeFileSync(OUT_ICO, buf);
    console.log("icon.ico multi-resolucion escrito");
  });
}

main();
