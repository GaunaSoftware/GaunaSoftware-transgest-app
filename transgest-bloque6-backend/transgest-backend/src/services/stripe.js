const API_BASE = "https://api.stripe.com/v1";

function configured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function planPriceId(plan, ciclo, origin) {
  if (['planner','pro_planner'].includes(plan)) return process.env[`STRIPE_PRICE_${String(plan).toUpperCase()}_${String(ciclo || 'mensual').toUpperCase()}`] || null;
  if (!['directa','canal'].includes(origin)) return null;
  const key = `STRIPE_PRICE_${String(plan || "").toUpperCase()}_${String(ciclo || "mensual").toUpperCase()}_${origin.toUpperCase()}`;
  return process.env[key] || null;
}

async function assertCatalogPrice(priceId, expectedEur, cycle) {
  if (expectedEur === null || expectedEur === undefined) throw new Error('Tarifa comercial no configurada para este plan');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.STRIPE_TIMEOUT_MS || 10000));
  try {
    const response = await fetch(`${API_BASE}/prices/${encodeURIComponent(priceId)}`, {
      headers:{ Authorization:'Basic ' + Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString('base64') },
      signal:controller.signal,
    });
    const actual = await response.json();
    if (!response.ok) throw new Error(actual.error?.message || `Stripe error ${response.status}`);
    const interval = cycle === 'anual' ? 'year' : 'month';
    if (actual.active !== true || actual.currency !== 'eur' || actual.unit_amount !== Math.round(expectedEur * 100) || actual.recurring?.interval !== interval || actual.recurring?.interval_count !== 1) {
      const err = new Error('El precio configurado en Stripe no coincide con la tarifa comercial. Revisa importe, moneda y periodicidad.');
      err.code = 'stripe_price_mismatch';
      throw err;
    }
    return actual;
  } finally { clearTimeout(timer); }
}

async function request(path, params = {}) {
  if (!configured()) {
    const err = new Error("Stripe no esta configurado");
    err.code = "stripe_not_configured";
    throw err;
  }

  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        Object.entries(item).forEach(([childKey, childValue]) => {
          body.append(`${key}[${index}][${childKey}]`, childValue);
        });
      });
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) => {
        body.append(`${key}[${childKey}]`, childValue);
      });
      return;
    }
    body.append(key, String(value));
  });

  const controller = new AbortController();
  const timeoutMs = Number(process.env.STRIPE_TIMEOUT_MS || 10000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(e.name === "AbortError" ? "Stripe no respondio a tiempo" : e.message);
    err.code = e.name === "AbortError" ? "stripe_timeout" : "stripe_request_error";
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `Stripe error ${res.status}`);
    err.code = data.error?.code || "stripe_error";
    throw err;
  }
  return data;
}

function defaultUrl(name, fallback) {
  return process.env[name] || process.env.APP_URL || process.env.FRONTEND_URL || fallback;
}

async function createCustomer({ email, name, empresaId }) {
  return request("/customers", {
    email,
    name,
    metadata: { empresa_id: empresaId },
  });
}

async function createCheckoutSession({ customerId, priceId, empresaId, plan, ciclo, userId, metodoPago = "auto" }) {
  const base = {
    mode: "subscription",
    customer: customerId,
    success_url: `${defaultUrl("STRIPE_SUCCESS_URL", "http://localhost:3000")}/?stripe=success`,
    cancel_url: `${defaultUrl("STRIPE_CANCEL_URL", "http://localhost:3000")}/?stripe=cancel`,
    client_reference_id: empresaId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      empresa_id: empresaId,
      user_id: userId,
      plan,
      ciclo,
    },
    "subscription_data[metadata]": {
      empresa_id: empresaId,
      plan,
      ciclo,
    },
  };
  const method = String(metodoPago || "auto").toLowerCase();
  if (method === "tarjeta" || method === "card") {
    base["payment_method_types[0]"] = "card";
  } else if (method === "domiciliacion" || method === "sepa_debit" || method === "sepa") {
    base["payment_method_types[0]"] = "sepa_debit";
  } else {
    base["payment_method_types[0]"] = "card";
    base["payment_method_types[1]"] = "sepa_debit";
  }
  return request("/checkout/sessions", {
    ...base,
  });
}

module.exports = {
  configured,
  planPriceId,
  assertCatalogPrice,
  createCustomer,
  createCheckoutSession,
};
