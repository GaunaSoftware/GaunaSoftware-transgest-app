const { spawnSync } = require("child_process");

const baseUrl = (process.env.DAILY_READY_BASE_URL || process.env.DEPLOY_BASE_URL || process.env.PUBLIC_APP_URL || "http://localhost").replace(/\/$/, "");
const timeoutMs = Number(process.env.DAILY_READY_TIMEOUT_MS || 8000);

function runNodeScript(label, script, env = {}) {
  console.log(`\n[${label}]`);
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label}: termino con codigo ${result.status}`);
  }
}

function withTimeout(promise, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return promise(controller.signal)
    .finally(() => clearTimeout(timer))
    .catch((err) => {
      if (err?.name === "AbortError") throw new Error(`${label}: sin respuesta tras ${timeoutMs} ms`);
      throw err;
    });
}

async function fetchText(label, path, expectedStatus = 200) {
  return withTimeout(async (signal) => {
    const response = await fetch(`${baseUrl}${path}`, { signal });
    const text = await response.text();
    if (response.status !== expectedStatus) {
      throw new Error(`${label}: esperado ${expectedStatus}, recibido ${response.status}. ${text.slice(0, 180)}`);
    }
    console.log(`OK ${label}`);
    return text;
  }, label);
}

async function checkPublicSurface() {
  console.log(`\n[superficie diaria] ${baseUrl}`);
  const healthText = await fetchText("health publico", "/health", 200);
  let health = null;
  try {
    health = JSON.parse(healthText);
  } catch {}
  if (health?.status !== "ok" || health?.db !== "connected") {
    throw new Error(`health publico: respuesta inesperada ${healthText.slice(0, 180)}`);
  }

  const html = (await fetchText("frontend publico", "/", 200)).toLowerCase();
  if (!html.includes("<!doctype html") && !html.includes("<div id=\"root\"")) {
    throw new Error("frontend publico: no parece estar sirviendo la SPA de React");
  }

  const protectedApi = (await fetchText("api protegida", "/api/v1/pedidos", 401)).toLowerCase();
  if (!protectedApi.includes("token")) {
    throw new Error("api protegida: no devuelve rechazo de autenticacion esperado");
  }
}

function printDailyChecklist() {
  console.log("\nDAILY READY OK");
  console.log("- Dashboard: revisar Control Tower, avisos y rentabilidad.");
  console.log("- Pedidos / Trafico: revisar pedidos sin asignar, pedidos rapidos y viajes por tonelada.");
  console.log("- Gestion financiera: revisar facturas pendientes, cobros y pagos a colaboradores.");
  console.log("- Mi Empresa > Puesta en marcha: descargar informe si se va a validar go-live.");
  console.log("- TransGestAdmin > Salud: revisar empresas criticas, backups e integraciones.");
  console.log("- Si aparece una pantalla de error, descargar el JSON de incidencia y conservar el codigo.");
}

async function run() {
  runNodeScript("entorno", "scripts/env_check.js");
  runNodeScript("smoke despliegue", "scripts/deploy_smoke_check.js", { DEPLOY_BASE_URL: baseUrl });
  await checkPublicSurface();
  printDailyChecklist();
}

run().catch((err) => {
  console.error("\nDAILY READY FAIL:", err.message);
  console.error("Revisa logs con: docker compose logs --tail=120 api");
  process.exitCode = 1;
});
