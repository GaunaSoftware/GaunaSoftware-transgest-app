const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "../src");
const targets = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) targets.push(full);
  }
}

walk(srcDir);

const findings = [];
for (const file of targets) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/\bwindow\.confirm\s*\(/.test(line)) {
      findings.push({
        file: path.relative(path.join(__dirname, ".."), file).replace(/\\/g, "/"),
        line: index + 1,
        text: line.trim().slice(0, 180),
      });
    }
  });
}

if (!findings.length) {
  console.log("OK frontend confirms: no quedan window.confirm() nativos en src");
  process.exit(0);
}

console.log(`Frontend confirms pendientes de migrar: ${findings.length}`);
const byFile = new Map();
for (const f of findings) byFile.set(f.file, (byFile.get(f.file) || 0) + 1);
for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`- ${file}: ${count}`);
}

if (process.env.STRICT_CONFIRM_AUDIT === "true") {
  process.exit(1);
}
