const baseUrl = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

async function check(name, path, expectedStatus, validate) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  if (res.status !== expectedStatus) {
    throw new Error(`${name}: esperado ${expectedStatus}, recibido ${res.status}. ${text.slice(0, 180)}`);
  }
  if (validate) validate(text, res);
  console.log(`OK ${name}`);
}

async function run() {
  await check("health", "/health", 200, (text) => {
    const data = JSON.parse(text);
    if (data.status !== "ok") throw new Error("health no devuelve status ok");
  });
  await check("pedidos protegido", "/api/v1/pedidos", 401);
  await check("colaborador publico", "/api/v1/pedidos/colaborador/confirmar/token-invalido-smoke", 404);
  await check("api protegida desconocida", "/api/v1/ruta-inexistente-smoke", 401);
}

run().catch(err => {
  console.error("SMOKE FAIL:", err.message);
  process.exitCode = 1;
});
