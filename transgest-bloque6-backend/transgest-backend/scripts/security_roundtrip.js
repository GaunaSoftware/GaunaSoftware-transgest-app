require("dotenv").config();

const bcrypt = require("bcryptjs");
const db = require("../src/services/db");

const baseUrl = String(process.env.SECURITY_API_URL || "http://localhost").replace(/\/$/, "");
const email = "qa-security-local@invalid.test";
const password = "QA-Only-7f4c9a2!";
const cif = "QA-SEC-LOCAL";

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function cleanup() {
  await db.query("DELETE FROM clientes WHERE cif=$1", [cif]).catch(() => {});
  await db.query("DELETE FROM usuarios WHERE email=$1", [email]).catch(() => {});
}

async function run() {
  await cleanup();
  const empresa = (await db.query("SELECT id FROM empresas ORDER BY created_at LIMIT 1")).rows[0];
  assert(empresa?.id, "No hay empresa local para ejecutar la prueba");
  const hash = await bcrypt.hash(password, 12);
  await db.query(
    "INSERT INTO usuarios(nombre,email,password_hash,rol,empresa_id,activo) VALUES($1,$2,$3,'gerente',$4,true)",
    ["QA Security", email, hash, empresa.id]
  );

  const login = await jsonRequest("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  assert(login.response.status === 200 && login.data.token, `Login QA fallo: ${login.response.status}`);
  const auth = { Authorization: `Bearer ${login.data.token}` };

  const created = await jsonRequest("/api/v1/clientes", {
    method: "POST", headers: auth,
    body: JSON.stringify({ nombre: "QA Seguridad Temporal", cif, direccion: "Calle Inicial 1", cp: "28001", ciudad: "Madrid", pais: "España", email, telefono: "600000000" }),
  });
  assert(created.response.status === 201 && created.data.id, `Alta de cliente fallo: ${created.response.status}`);

  const updated = await jsonRequest(`/api/v1/clientes/${created.data.id}`, {
    method: "PUT", headers: auth,
    body: JSON.stringify({ ...created.data, calle: "Calle Actualizada", num_ext: "2", direccion: "Calle Actualizada 2", cod_postal: "28002", cp: "28002" }),
  });
  assert(updated.response.status === 200 && updated.data.calle === "Calle Actualizada" && updated.data.cod_postal === "28002", `Edicion de cliente fallo: ${updated.response.status}`);

  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await jsonRequest("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password: "incorrecta-segura" }) });
    lastStatus = failed.response.status;
  }
  assert(lastStatus === 429, `El bloqueo temporal no se activo: ${lastStatus}`);
  console.log("SECURITY ROUNDTRIP OK login, alta cliente, edicion cliente, bloqueo temporal y limpieza");
}

run()
  .finally(async () => { await cleanup(); await db.pool.end(); })
  .catch((error) => { console.error("SECURITY ROUNDTRIP FAIL:", error.message); process.exitCode = 1; });
