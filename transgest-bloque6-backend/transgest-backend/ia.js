const express = require("express");
const router  = express.Router();
const { authenticate } = require("../middleware/auth");
const https   = require("https");
const db      = require("../services/db");

router.use(authenticate);

// POST /ia/chat — proxy to Anthropic API
router.post("/chat", async (req, res) => {
  // Check DB first, then env
  let apiKey = process.env.ANTHROPIC_API_KEY;
  try {
    const { rows } = await db.query("SELECT value FROM system_config WHERE key='anthropic_api_key' LIMIT 1");
    if (rows[0]?.value) apiKey = rows[0].value;
  } catch(e) { /* table may not exist yet, use env */ }
  
  if (!apiKey) return res.status(503).json({ 
    error: "IA no configurada. Ve al panel de Superadmin → Configuración → Clave API de IA para añadirla." 
  });

  const { messages, max_tokens = 1000, system } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "messages requerido" });

  try {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens,
      messages,
      ...(system ? { system } : {}),
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let data = "";
      proxyRes.on("data", (chunk) => { data += chunk; });
      proxyRes.on("end", () => {
        try { res.status(proxyRes.statusCode).json(JSON.parse(data)); }
        catch(e) { res.status(500).json({ error: "Error parsing Anthropic response" }); }
      });
    });

    proxyReq.on("error", (e) => res.status(500).json({ error: e.message }));
    proxyReq.write(body);
    proxyReq.end();
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
