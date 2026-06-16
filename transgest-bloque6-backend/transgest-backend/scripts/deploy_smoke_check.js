const baseUrl = (process.env.DEPLOY_BASE_URL || process.env.PUBLIC_APP_URL || "http://localhost").replace(/\/$/, "");
const timeoutMs = Number(process.env.DEPLOY_SMOKE_TIMEOUT_MS || 8000);

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

async function fetchText(name, path, expectedStatus = 200) {
  return withTimeout(async (signal) => {
    const res = await fetch(`${baseUrl}${path}`, { signal });
    const text = await res.text();
    if (res.status !== expectedStatus) {
      throw new Error(`${name}: esperado ${expectedStatus}, recibido ${res.status}. ${text.slice(0, 180)}`);
    }
    console.log(`OK ${name}`);
    return { res, text };
  }, name);
}

async function run() {
  const health = await fetchText("health publico", "/health", 200);
  let healthData = null;
  try { healthData = JSON.parse(health.text); } catch {}
  if (healthData?.status !== "ok" || healthData?.db !== "connected") {
    throw new Error(`health publico: respuesta inesperada ${health.text.slice(0, 180)}`);
  }

  const home = await fetchText("frontend publico", "/", 200);
  const html = home.text.toLowerCase();
  if (!html.includes("<!doctype html") && !html.includes("<div id=\"root\"")) {
    throw new Error("frontend publico: no parece estar sirviendo la SPA de React");
  }

  const protectedApi = await fetchText("api protegida via proxy", "/api/v1/pedidos", 401);
  if (!protectedApi.text.toLowerCase().includes("token")) {
    throw new Error("api protegida via proxy: no devuelve rechazo de autenticacion esperado");
  }

  console.log(`DEPLOY SMOKE OK: ${baseUrl}`);
}

run().catch((err) => {
  console.error("DEPLOY SMOKE FAIL:", err.message);
  process.exitCode = 1;
});
