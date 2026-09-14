const fs = require("fs");
const path = require("path");

const routesDir = path.resolve(__dirname, "../src/routes");
const wrapperPath = path.join(routesDir, "superadmin.js");
const legacyPath = path.join(routesDir, "superadminCore.js");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function expect(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

if (!fs.existsSync(wrapperPath)) fail("Falta src/routes/superadmin.js");
if (!fs.existsSync(legacyPath)) fail("Falta src/routes/superadminCore.js");
if (process.exitCode) process.exit(process.exitCode);

const wrapper = fs.readFileSync(wrapperPath, "utf8");
const legacy = fs.readFileSync(legacyPath, "utf8");

expect(wrapper, /jwt\.verify\([\s\S]*algorithms:\s*\["HS256"\]/, "El wrapper debe fijar HS256 al verificar JWT administrativos");
expect(wrapper, /SELECT id,nombre,email,rol,activo FROM superadmins WHERE id=\$1 LIMIT 1/, "El wrapper debe revalidar la cuenta administrativa contra BD");
expect(wrapper, /account\.activo !== true/, "El wrapper debe rechazar cuentas administrativas desactivadas");
expect(wrapper, /isSuperadminOnlyRequest/, "Debe existir control explicito para operaciones exclusivas de superadmin");
expect(wrapper, /\["superadmin", "soporte"\]\.includes\(req\.superadmin\.rol\)/, "Debe separarse soporte de facturacion en operaciones sensibles");
expect(wrapper, /password_changed_at=NOW\(\)/, "Los resets deben invalidar sesiones de usuario anteriores");
expect(wrapper, /router\.use\(legacyRouter\)/, "El router original debe conservarse detras del wrapper");
expect(legacy, /router\.post\("\/login"/, "El router principal debe conservar el login de SuperAdmin");
expect(legacy, /module\.exports\s*=\s*router/, "El router principal debe seguir exportandose correctamente");

if (!process.exitCode) {
  console.log("OK: hardening SuperAdmin verificado estaticamente");
}
