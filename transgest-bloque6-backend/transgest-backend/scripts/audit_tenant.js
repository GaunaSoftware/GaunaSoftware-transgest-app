const fs = require("fs");
const path = require("path");

const routesDir = path.join(__dirname, "../src/routes");
const skipFiles = new Set(["superadmin.js", "auth.js", "stripe_webhook.js", "exportacion.js", "registro.js"]);
const riskyTables = [
  "pedidos", "facturas", "clientes", "vehiculos", "choferes", "colaboradores",
  "pedido_descargas", "grupajes", "pedido_docs", "vehiculo_repostajes", "vehiculo_noches",
  "nominas_emitidas", "gastos_estructura",
];
const riskySql = new RegExp(`\\b(SELECT|UPDATE|DELETE)\\b[\\s\\S]{0,220}\\b(FROM|UPDATE)\\s+(${riskyTables.join("|")})\\b`, "i");
const strict = process.argv.includes("--strict") || process.env.STRICT_TENANT_AUDIT === "true";

function hasTenantGuard(text) {
  return /empresa_id|req\.empresaId|req\.user\.empresa_id|EID\(req\)/i.test(text);
}

const findings = [];
for (const file of fs.readdirSync(routesDir).filter(f => f.endsWith(".js")).sort()) {
  if (skipFiles.has(file)) continue;
  const fullPath = path.join(routesDir, file);
  const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/\b(SELECT|UPDATE|DELETE)\b/i.test(lines[i])) continue;
    if (/where\.join|countWhere/i.test(lines[i])) continue;
    const windowText = lines.slice(i, i + 20).join(" ");
    if (!riskySql.test(windowText)) continue;
    if (hasTenantGuard(windowText)) continue;
    findings.push({ file, line: i + 1, text: lines[i].trim().slice(0, 180) });
  }
}

if (!findings.length) {
  console.log("OK tenant audit: no se han detectado consultas obvias sin empresa_id");
  process.exit(0);
}

console.log("Tenant audit: revisar posibles consultas sin aislamiento multiempresa:");
for (const f of findings) {
  console.log(`- ${f.file}:${f.line} ${f.text}`);
}

if (strict) {
  process.exit(1);
}
