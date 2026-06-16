require("dotenv").config();

const transgestBaseUrl = (process.env.ACCOUNTING_CHECK_TRANSGEST_URL || "http://localhost").replace(/\/$/, "");
const accountingBaseUrl = (process.env.ACCOUNTING_CHECK_API_URL || "http://localhost:3011").replace(/\/$/, "");
const authorizedUser = process.env.ACCOUNTING_CHECK_USER || "gerente@empresa.com";
const authorizedPassword = process.env.ACCOUNTING_CHECK_PASSWORD || "demo1234";
const unauthorizedUser = process.env.ACCOUNTING_CHECK_UNAUTHORIZED_USER || "trafico@empresa.com";
const unauthorizedPassword = process.env.ACCOUNTING_CHECK_UNAUTHORIZED_PASSWORD || authorizedPassword;
const timeoutMs = Number(process.env.ACCOUNTING_CHECK_TIMEOUT_MS || 8000);

async function request(name, url, options = {}, expectedStatus = 200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (response.status !== expectedStatus) {
      throw new Error(`${name}: esperado ${expectedStatus}, recibido ${response.status}. ${text.slice(0, 180)}`);
    }

    console.log(`OK ${name}`);
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${name}: sin respuesta tras ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function jsonOptions(body, token = "") {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

async function login(email, password) {
  return request(
    `login TransGest ${email}`,
    `${transgestBaseUrl}/api/v1/auth/login`,
    jsonOptions({ email, password })
  );
}

async function run() {
  const health = await request("health Accounting API", `${accountingBaseUrl}/health`);
  if (health?.status !== "ok" || health?.db !== "connected") {
    throw new Error("health Accounting API no confirma conexion a PostgreSQL");
  }

  const loginResult = await login(authorizedUser, authorizedPassword);
  const launch = await request(
    "token de lanzamiento SSO",
    `${transgestBaseUrl}/api/v1/accounting/launch-token`,
    { headers: { Authorization: `Bearer ${loginResult.token}` } }
  );
  if (!launch?.sso_token || !launch?.launch_url) {
    throw new Error("token de lanzamiento SSO incompleto");
  }

  const exchange = await request(
    "intercambio SSO en Contabilidad",
    `${accountingBaseUrl}/api/v1/auth/sso/exchange`,
    jsonOptions({ sso_token: launch.sso_token })
  );
  if (!exchange?.token || !exchange?.selected_company_id) {
    throw new Error("intercambio SSO no devuelve sesion y empresa seleccionada");
  }

  const accountingHeaders = { headers: { Authorization: `Bearer ${exchange.token}` } };
  const me = await request("contexto contable", `${accountingBaseUrl}/api/v1/auth/me`, accountingHeaders);
  const companies = await request("empresas autorizadas", `${accountingBaseUrl}/api/v1/companies`, accountingHeaders);
  const selectedCompany = companies?.data?.find(company => company.id === exchange.selected_company_id);

  if (!selectedCompany || me?.selected_company_id !== selectedCompany.id || !selectedCompany.source_company_id) {
    throw new Error("el contexto SSO no conserva correctamente la empresa de TransGest");
  }

  await request(
    "seleccion de empresa autorizada",
    `${accountingBaseUrl}/api/v1/companies/select`,
    jsonOptions({ company_id: selectedCompany.id }, exchange.token)
  );
  await request(
    "rechazo de empresa no autorizada",
    `${accountingBaseUrl}/api/v1/companies/select`,
    jsonOptions({ company_id: "00000000-0000-0000-0000-000000000099" }, exchange.token),
    403
  );
  const deniedAudit = await request(
    "auditoria de seleccion no autorizada",
    `${accountingBaseUrl}/api/v1/audit-log?action=company.selection_denied&limit=1`,
    accountingHeaders
  );
  if (deniedAudit?.data?.[0]?.detail?.requested_company_id !== "00000000-0000-0000-0000-000000000099") {
    throw new Error("el rechazo cross-company no ha quedado registrado en audit_log");
  }

  const deniedLogin = await login(unauthorizedUser, unauthorizedPassword);
  await request(
    "rechazo de usuario sin permiso contable",
    `${transgestBaseUrl}/api/v1/accounting/launch-token`,
    { headers: { Authorization: `Bearer ${deniedLogin.token}` } },
    403
  );

  console.log(`ACCOUNTING CONNECTION OK: ${authorizedUser} -> ${selectedCompany.name}`);
}

run().catch(error => {
  console.error("ACCOUNTING CONNECTION FAIL:", error.message);
  process.exitCode = 1;
});
