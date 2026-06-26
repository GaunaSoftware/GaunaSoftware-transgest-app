const baseUrl = (process.env.DEPLOY_BASE_URL || process.env.PUBLIC_APP_URL || "http://localhost").replace(/\/$/, "");
const apiUrl = (process.env.DEPLOY_API_URL || baseUrl).replace(/\/$/, "");
const expectedRelease = String(process.env.DEPLOY_EXPECTED_RELEASE || "").trim();
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

async function fetchText(name, path, expectedStatus = 200, origin = baseUrl) {
  return withTimeout(async (signal) => {
    const res = await fetch(`${origin}${path}`, { signal });
    const text = await res.text();
    if (res.status !== expectedStatus) {
      throw new Error(`${name}: esperado ${expectedStatus}, recibido ${res.status}. ${text.slice(0, 180)}`);
    }
    console.log(`OK ${name}`);
    return { res, text };
  }, name);
}

async function fetchJson(name, path, options = {}, expectedStatus = 200, origin = apiUrl) {
  return withTimeout(async (signal) => {
    const res = await fetch(`${origin}${path}`, {
      ...options,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_text: text }; }
    if (res.status !== expectedStatus) {
      const msg = data.error || data.message || data.mensaje || data.raw_text || "";
      throw new Error(`${name}: esperado ${expectedStatus}, recibido ${res.status}. ${String(msg).slice(0, 180)}`);
    }
    console.log(`OK ${name}`);
    return data;
  }, name);
}

async function runClienteRoundtrip() {
  const user = String(process.env.DEPLOY_SMOKE_USER || "").trim();
  const password = String(process.env.DEPLOY_SMOKE_PASSWORD || "").trim();
  if (!user || !password) {
    console.log("SKIP cliente roundtrip: configura DEPLOY_SMOKE_USER y DEPLOY_SMOKE_PASSWORD");
    return;
  }

  const login = await fetchJson("login smoke", "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: user, usuario: user, password }),
  });
  if (!login?.token) throw new Error("login smoke: no devuelve token");

  const auth = { Authorization: `Bearer ${login.token}` };
  const suffix = Date.now().toString(36).toUpperCase();
  let clienteId = null;
  try {
    const created = await fetchJson("alta cliente smoke", "/api/v1/clientes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        nombre: `QA Deploy Cliente ${suffix}`,
        cif: `QA-${suffix}`,
        calle: "Calle QA",
        num_ext: "1",
        cod_postal: "28001",
        municipio: "Madrid",
        provincia: "Madrid",
        pais_iso: "ES",
        email: `qa-${suffix.toLowerCase()}@example.invalid`,
        telefono: "600000000",
        forma_pago: "transferencia",
        vencimiento: "30 dias fecha factura",
      }),
    }, 201);
    clienteId = created?.id || null;
    if (!clienteId) throw new Error("alta cliente smoke: falta id del cliente creado");
  } finally {
    if (clienteId) {
      await fetchJson("limpieza cliente smoke", `/api/v1/clientes/${encodeURIComponent(clienteId)}`, {
        method: "DELETE",
        headers: auth,
      }).catch(err => {
        console.warn(`WARN limpieza cliente smoke: ${err.message}`);
      });
    }
  }
}

async function run() {
  const health = await fetchText("health publico", "/health", 200, apiUrl);
  let healthData = null;
  try { healthData = JSON.parse(health.text); } catch {}
  if (healthData?.status !== "ok" || healthData?.db !== "connected") {
    throw new Error(`health publico: respuesta inesperada ${health.text.slice(0, 180)}`);
  }
  if (!healthData?.release) throw new Error("health publico: falta identificador de release");
  if (expectedRelease && !String(healthData.release).startsWith(expectedRelease)) {
    throw new Error(`health publico: release ${healthData.release} no coincide con ${expectedRelease}`);
  }

  const home = await fetchText("frontend publico", "/", 200);
  const html = home.text.toLowerCase();
  if (!html.includes("<!doctype html") && !html.includes("<div id=\"root\"")) {
    throw new Error("frontend publico: no parece estar sirviendo la SPA de React");
  }

  const protectedApi = await fetchText("api protegida", "/api/v1/pedidos", 401, apiUrl);
  if (!protectedApi.text.toLowerCase().includes("token")) {
    throw new Error("api protegida via proxy: no devuelve rechazo de autenticacion esperado");
  }

  await runClienteRoundtrip();

  console.log(`DEPLOY SMOKE OK: frontend=${baseUrl} api=${apiUrl} release=${healthData.release}`);
}

run().catch((err) => {
  console.error("DEPLOY SMOKE FAIL:", err.message);
  process.exitCode = 1;
});
