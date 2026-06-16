const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "src");
const badPairs = [
  {
    name: "active filter blue text on dark blue",
    background: /background\s*:\s*[^,\n]*#1a2d5a/,
    color: /color\s*:\s*[^,\n]*var\(--accent-xl\)/,
  },
  {
    name: "active filter accent-dim with accent-xl text",
    background: /background\s*:\s*[^,\n]*var\(--accent-dim\)/,
    color: /color\s*:\s*[^,\n]*var\(--accent-xl\)/,
  },
  {
    name: "active filter translucent teal with accent-xl text",
    background: /background\s*:\s*[^,\n]*rgba\(20,184,166,.12\)/,
    color: /color\s*:\s*[^,\n]*var\(--accent-xl\)/,
  },
  {
    name: "active filter translucent blue with accent text",
    background: /background\s*:\s*[^,\n]*rgba\(59,130,246,.\d+\)/,
    color: /color\s*:\s*[^,\n]*var\(--accent(?:-xl)?\)/,
  },
  {
    name: "active filter pastel severity with colored text",
    background: /background\s*:\s*[^,\n]*rgba\((?:239,68,68|249,115,22|185,28,28|34,211,238|139,92,246|251,191,36|16,185,129),.\d+\)/,
    color: /color\s*:\s*[^,\n]*(?:#[a-fA-F0-9]{3,6}|var\(--accent(?:-xl)?\))/,
  },
];

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.isFile() && entry.name.endsWith(".js") ? [full] : [];
  });
}

const findings = [];
for (const file of listFiles(root)) {
  const rel = path.relative(path.resolve(__dirname, ".."), file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/(filtro|periodo|modo|TipoViaje|Filtro|filter)/i.test(line)) return;
    if (!line.includes("?")) return;
    if (line.includes("<span")) return;
    for (const pair of badPairs) {
      if (pair.background.test(line) && pair.color.test(line)) {
        findings.push(`${rel}:${index + 1} ${pair.name}`);
      }
    }
  });
}

if (findings.length) {
  console.error("UI CONTRAST FAIL: filtros activos con texto azul/teal detectados");
  findings.forEach((item) => console.error("- " + item));
  process.exitCode = 1;
} else {
  console.log("OK filter contrast audit");
}
