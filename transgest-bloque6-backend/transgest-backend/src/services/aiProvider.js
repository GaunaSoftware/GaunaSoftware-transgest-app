const AI_PROVIDERS = ["anthropic", "openai", "ai_generic"];

function normalizeAiProvider(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  return AI_PROVIDERS.includes(provider) ? provider : "anthropic";
}

function normalizeAiModel(provider = "", value = "") {
  const safeProvider = normalizeAiProvider(provider);
  const raw = String(value || "").trim();
  if (!raw) {
    if (safeProvider === "openai") return "gpt-5-mini";
    if (safeProvider === "anthropic") return "claude-sonnet-4-20250514";
    return "gpt-4o-mini";
  }
  if (safeProvider !== "openai") return raw;

  const normalized = raw.toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
  // "GPT-5.4-MINI" and similar labels are not valid OpenAI API model ids.
  if (/^gpt-5(?:\.\d+)+-mini$/.test(normalized)) return "gpt-5-mini";
  return normalized;
}

function normalizeAiBaseUrl(provider = "", value = "") {
  const safeProvider = normalizeAiProvider(provider);
  if (safeProvider === "openai") return "https://api.openai.com/v1";
  if (safeProvider === "anthropic") return "https://api.anthropic.com/v1";
  return String(value || "").trim().replace(/\/$/, "") || "https://api.openai.com/v1";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3000, Number(timeoutMs || 15000)));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("El proveedor de IA no ha respondido dentro del tiempo de espera.");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function providerErrorMessage(data = {}, status = 0) {
  return String(
    data?.error?.message || data?.message || data?.error || `El proveedor ha respondido HTTP ${status || "desconocido"}.`
  ).slice(0, 500);
}

async function testAiProviderConnection({ provider, apiKey, model, baseUrl }) {
  const safeProvider = normalizeAiProvider(provider);
  const safeModel = normalizeAiModel(safeProvider, model);
  const safeBaseUrl = normalizeAiBaseUrl(safeProvider, baseUrl);
  if (!String(apiKey || "").trim()) {
    return { ok: false, provider: safeProvider, model: safeModel, message: "Falta la clave API." };
  }

  let response;
  if (safeProvider === "openai") {
    response = await fetchWithTimeout(`${safeBaseUrl}/models/${encodeURIComponent(safeModel)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
  } else if (safeProvider === "anthropic") {
    response = await fetchWithTimeout(`${safeBaseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: 8,
        messages: [{ role: "user", content: "Responde OK" }],
      }),
    });
  } else {
    response = await fetchWithTimeout(`${safeBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: safeModel,
        messages: [{ role: "user", content: "Responde OK" }],
        max_tokens: 8,
      }),
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      provider: safeProvider,
      model: safeModel,
      http_status: response.status,
      message: providerErrorMessage(data, response.status),
    };
  }
  return {
    ok: true,
    provider: safeProvider,
    model: safeModel,
    http_status: response.status,
    message: `Conexion verificada con ${safeProvider} y el modelo ${safeModel}.`,
  };
}

module.exports = {
  AI_PROVIDERS,
  normalizeAiProvider,
  normalizeAiModel,
  normalizeAiBaseUrl,
  fetchWithTimeout,
  providerErrorMessage,
  testAiProviderConnection,
};
