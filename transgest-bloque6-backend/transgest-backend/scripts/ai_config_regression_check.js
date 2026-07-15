const assert = require("assert");
const {
  normalizeAiProvider,
  normalizeAiModel,
  normalizeAiBaseUrl,
  testAiProviderConnection,
} = require("../src/services/aiProvider");

async function main() {
  assert.equal(normalizeAiProvider("OPENAI"), "openai");
  assert.equal(normalizeAiProvider("desconocido"), "anthropic");
  assert.equal(normalizeAiModel("openai", "GPT-5.4-MINI"), "gpt-5-mini");
  assert.equal(normalizeAiModel("openai", ""), "gpt-5-mini");
  assert.equal(normalizeAiModel("anthropic", ""), "claude-sonnet-4-20250514");
  assert.equal(normalizeAiBaseUrl("openai", "https://otro.example/v1"), "https://api.openai.com/v1");

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "gpt-5-mini", url, method: options.method || "GET" }),
  });
  try {
    const result = await testAiProviderConnection({
      provider: "openai",
      apiKey: "test-key-not-real",
      model: "GPT-5.4-MINI",
    });
    assert.equal(result.ok, true);
    assert.equal(result.model, "gpt-5-mini");
  } finally {
    global.fetch = originalFetch;
  }
  console.log("AI config regression checks OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
