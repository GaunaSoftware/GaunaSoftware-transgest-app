const API_BASE = "https://api.stripe.com/v1";

function configured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function planPriceId(plan, ciclo) {
  const key = `STRIPE_PRICE_${String(plan || "").toUpperCase()}_${String(ciclo || "mensual").toUpperCase()}`;
  return process.env[key] || null;
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

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
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

async function createCheckoutSession({ customerId, priceId, empresaId, plan, ciclo, userId }) {
  return request("/checkout/sessions", {
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
  });
}

module.exports = {
  configured,
  planPriceId,
  createCustomer,
  createCheckoutSession,
};
