const express = require("express");
const router  = express.Router();
const { authenticate } = require("../middleware/auth");
const https   = require("https");
const db      = require("../services/db");
const { resolveApiKey, assertApiUsageAllowed, recordApiUsage, getGlobalSetting } = require("../services/apiKeys");

router.use(authenticate);

const IA_LIMITES_PLAN = {
  basico: 0,
  profesional: 0,
  enterprise: 1000,
};

function stripCodeFence(text) {
  return String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function tryJson(text) {
  try { return JSON.parse(stripCodeFence(text)); } catch { return null; }
}

function extractModelText(provider, data = {}) {
  if (provider === "openai" || provider === "ai_generic") {
    return data?.choices?.[0]?.message?.content || "";
  }
  if (Array.isArray(data?.content)) {
    return data.content.map(p => p?.text || "").join("\n");
  }
  return data?.text || "";
}

function heuristicDocumentParse(text = "") {
  const src = String(text || "");
  const norm = src.replace(/\r/g, "\n");
  const find = (patterns) => {
    for (const p of patterns) {
      const m = norm.match(p);
      if (m?.[1]) return String(m[1]).trim();
    }
    return "";
  };
  const amount = find([/(?:importe|total|precio)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{1,2})?)/i]);
  const weight = find([/(?:peso|toneladas|tn|t)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{1,3})?)/i]);
  const ref = find([/(?:referencia|ref\.?|pedido|orden)\s*[:\-]?\s*([A-Z0-9._/-]{3,})/i]);
  const date = find([/(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/]);
  return {
    tipo_documento: src.toLowerCase().includes("factura") ? "factura" : src.toLowerCase().includes("albar") ? "albaran" : "pedido",
    confianza: 0.35,
    cliente: find([/(?:cliente|cargador)\s*[:\-]?\s*(.+)/i]),
    origen: find([/(?:origen|carga|recogida)\s*[:\-]?\s*(.+)/i]),
    destino: find([/(?:destino|descarga|entrega)\s*[:\-]?\s*(.+)/i]),
    fecha_carga: date,
    referencia_cliente: ref,
    mercancia: find([/(?:mercancia|producto|material)\s*[:\-]?\s*(.+)/i]),
    peso: weight,
    importe: amount,
    observaciones: "Extraccion heuristica sin IA configurada. Revisar antes de crear registros.",
  };
}

async function comprobarCupoIA(req) {
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return;

  const periodo = new Date().toISOString().slice(0, 7);
  const { rows } = await db.query(
    "SELECT plan, ia_limite_mensual, ia_usos_mes, ia_periodo_mes FROM empresas WHERE id=$1",
    [empresaId]
  );
  const empresa = rows[0];
  if (!empresa) return;

  const limite = Number(empresa.ia_limite_mensual || IA_LIMITES_PLAN[empresa.plan] || 0);
  if (limite <= 0) {
    const err = new Error("La IA esta incluida solo en el plan Enterprise.");
    err.status = 403;
    throw err;
  }

  const usos = empresa.ia_periodo_mes === periodo ? Number(empresa.ia_usos_mes || 0) : 0;
  if (usos >= limite) {
    const err = new Error(`Limite mensual de IA alcanzado (${limite} usos).`);
    err.status = 429;
    throw err;
  }

  await db.query(
    `UPDATE empresas
     SET ia_periodo_mes=$1,
         ia_usos_mes=CASE WHEN ia_periodo_mes=$1 THEN ia_usos_mes + 1 ELSE 1 END
     WHERE id=$2`,
    [periodo, empresaId]
  );
}

async function getIaRuntimeConfig(empresaId) {
  const provider = String(await getGlobalSetting("ia_provider", process.env.AI_PROVIDER || "anthropic")).toLowerCase();
  const baseUrl = String(await getGlobalSetting("ia_base_url", process.env.AI_BASE_URL || "") || "").replace(/\/$/, "");
  const model = String(await getGlobalSetting("ia_model", process.env.AI_MODEL || "") || "");
  const safeProvider = ["anthropic", "openai", "ai_generic"].includes(provider) ? provider : "anthropic";
  const keyInfo = await resolveApiKey(empresaId, safeProvider);
  return { provider: safeProvider, baseUrl, model, apiKey: keyInfo.key };
}

function normalizeOpenAiMessages(messages, system) {
  const list = Array.isArray(messages) ? [...messages] : [];
  if (system) list.unshift({ role: "system", content: system });
  return list;
}

// POST /ia/chat — proxy to Anthropic API
router.post("/chat", async (req, res) => {
  let iaConfig;
  try {
    await comprobarCupoIA(req);
    iaConfig = await getIaRuntimeConfig(req.user?.empresa_id);
    await assertApiUsageAllowed(req.user?.empresa_id, iaConfig.provider);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  const apiKey = iaConfig.apiKey;
  
  if (!apiKey) return res.status(503).json({ 
    error: "IA no configurada. Ve al panel de Superadmin → Configuración → Clave API de IA para añadirla." 
  });

  const { messages, max_tokens = 1000, system } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "messages requerido" });

  try {
    if (iaConfig.provider === "openai" || iaConfig.provider === "ai_generic") {
      const baseUrl = iaConfig.provider === "openai"
        ? "https://api.openai.com/v1"
        : (iaConfig.baseUrl || "https://api.openai.com/v1");
      const proxyRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: iaConfig.model || "gpt-4o-mini",
          messages: normalizeOpenAiMessages(messages, system),
          max_tokens,
        }),
      });
      const data = await proxyRes.json().catch(() => ({}));
      if (proxyRes.status < 400) await recordApiUsage(req.user?.empresa_id, iaConfig.provider, 1).catch(() => {});
      return res.status(proxyRes.status).json(data);
    }

    const body = JSON.stringify({
      model: iaConfig.model || "claude-sonnet-4-20250514",
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
        try {
          if (proxyRes.statusCode < 400) {
            recordApiUsage(req.user?.empresa_id, iaConfig.provider, 1).catch(() => {});
          }
          res.status(proxyRes.statusCode).json(JSON.parse(data));
        }
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

router.post("/documento/extraer", async (req, res) => {
  const { texto = "", tipo = "pedido", nombre = "", mime = "", contexto = {} } = req.body || {};
  const cleanText = String(texto || "").trim().slice(0, 60000);
  if (!cleanText) return res.status(400).json({ error: "Texto del documento requerido" });

  let iaConfig;
  try {
    await comprobarCupoIA(req);
    iaConfig = await getIaRuntimeConfig(req.user?.empresa_id);
    if (iaConfig.apiKey) await assertApiUsageAllowed(req.user?.empresa_id, iaConfig.provider);
  } catch (err) {
    if (err.status === 403 || err.status === 429) {
      return res.json({ ok:true, modo:"heuristico", resultado: heuristicDocumentParse(cleanText), avisos:[err.message] });
    }
    return res.status(err.status || 500).json({ error: err.message });
  }

  if (!iaConfig.apiKey) {
    return res.json({
      ok: true,
      modo: "heuristico",
      resultado: heuristicDocumentParse(cleanText),
      avisos: ["IA no configurada. Se ha usado extraccion heuristica."],
    });
  }

  const system = `Eres un extractor documental para un TMS de transporte en España. Devuelve solo JSON valido, sin markdown. Extrae datos para crear pedidos, facturas o albaranes. Usa null si no aparece. Normaliza importes con punto decimal y fechas ISO yyyy-mm-dd si puedes.`;
  const userPrompt = `Tipo esperado: ${tipo}
Nombre archivo: ${nombre}
MIME: ${mime}
Contexto: ${JSON.stringify(contexto || {})}

Devuelve este JSON:
{
  "tipo_documento":"pedido|factura|albaran|correo|otro",
  "confianza":0.0,
  "cliente":null,
  "referencia_cliente":null,
  "origen":null,
  "destino":null,
  "fecha_carga":null,
  "hora_carga":null,
  "fecha_descarga":null,
  "hora_descarga":null,
  "mercancia":null,
  "peso_kg":null,
  "toneladas":null,
  "bultos":null,
  "matricula":null,
  "remolque":null,
  "chofer":null,
  "importe":null,
  "tipo_iva":null,
  "factura_numero":null,
  "albaran_numero":null,
  "emails_detectados":[],
  "telefonos_detectados":[],
  "observaciones":null,
  "faltantes":[]
}

Texto:
${cleanText}`;

  try {
    let remoteData;
    if (iaConfig.provider === "openai" || iaConfig.provider === "ai_generic") {
      const baseUrl = iaConfig.provider === "openai" ? "https://api.openai.com/v1" : (iaConfig.baseUrl || "https://api.openai.com/v1");
      const proxyRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${iaConfig.apiKey}` },
        body: JSON.stringify({
          model: iaConfig.model || "gpt-4o-mini",
          response_format: { type:"json_object" },
          messages: normalizeOpenAiMessages([{ role:"user", content:userPrompt }], system),
          max_tokens: 1800,
        }),
      });
      remoteData = await proxyRes.json().catch(() => ({}));
      if (!proxyRes.ok) return res.status(proxyRes.status).json(remoteData);
    } else {
      const proxyRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":"application/json",
          "x-api-key": iaConfig.apiKey,
          "anthropic-version":"2023-06-01",
        },
        body: JSON.stringify({
          model: iaConfig.model || "claude-sonnet-4-20250514",
          max_tokens: 1800,
          system,
          messages: [{ role:"user", content:userPrompt }],
        }),
      });
      remoteData = await proxyRes.json().catch(() => ({}));
      if (!proxyRes.ok) return res.status(proxyRes.status).json(remoteData);
    }
    await recordApiUsage(req.user?.empresa_id, iaConfig.provider, 1).catch(() => {});
    const parsed = tryJson(extractModelText(iaConfig.provider, remoteData));
    if (!parsed) {
      return res.json({ ok:true, modo:"heuristico", resultado: heuristicDocumentParse(cleanText), avisos:["La IA no devolvio JSON valido. Se ha usado extraccion heuristica."], raw: remoteData });
    }
    res.json({ ok:true, modo:"ia", resultado: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
