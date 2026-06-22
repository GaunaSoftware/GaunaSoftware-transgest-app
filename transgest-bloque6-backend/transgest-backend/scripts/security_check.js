const baseUrl = String(process.env.SECURITY_BASE_URL || "http://localhost").replace(/\/$/, "");
const apiUrl = String(process.env.SECURITY_API_URL || baseUrl).replace(/\/$/, "");
const allowedOrigin = process.env.SECURITY_ALLOWED_ORIGIN || "http://localhost";
const disallowedOrigin = "https://security-probe.invalid";

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const health = await request(`${apiUrl}/health`, { headers: { Origin: allowedOrigin } });
  const healthData = await health.json();
  assert(health.status === 200 && healthData.status === "ok" && healthData.db === "connected", "Health o base de datos no disponibles");
  assert(Boolean(healthData.release), "Health no identifica la version desplegada");
  assert(String(health.headers.get("x-content-type-options") || "").includes("nosniff"), "Falta X-Content-Type-Options");
  assert(Boolean(health.headers.get("content-security-policy")), "Falta Content-Security-Policy");
  assert(Boolean(health.headers.get("permissions-policy")), "Falta Permissions-Policy");
  assert(health.headers.get("access-control-allow-origin") === allowedOrigin, "CORS no autoriza el origen esperado");

  const deniedCors = await request(`${apiUrl}/health`, { headers: { Origin: disallowedOrigin } });
  assert(!deniedCors.headers.get("access-control-allow-origin"), "CORS refleja un origen no autorizado");

  const protectedApi = await request(`${apiUrl}/api/v1/pedidos`);
  assert(protectedApi.status === 401, `Ruta protegida responde ${protectedApi.status}, se esperaba 401`);

  const frontend = await request(`${baseUrl}/`);
  assert(frontend.status === 200, "Frontend no disponible");
  if (baseUrl.startsWith("https://")) {
    assert(String(frontend.headers.get("x-content-type-options") || "").includes("nosniff"), "Frontend sin X-Content-Type-Options");
    assert(Boolean(frontend.headers.get("content-security-policy")), "Frontend sin Content-Security-Policy");
    assert(frontend.headers.get("x-frame-options") === "DENY", "Frontend permite ser embebido en marcos");
  }
  console.log(`SECURITY CHECK OK frontend=${baseUrl} api=${apiUrl} release=${healthData.release}`);
}

run().catch((error) => {
  console.error("SECURITY CHECK FAIL:", error.message);
  process.exitCode = 1;
});
