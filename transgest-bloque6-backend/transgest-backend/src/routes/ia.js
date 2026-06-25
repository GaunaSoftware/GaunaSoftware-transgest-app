const express = require("express");
const router  = express.Router();
const { authenticate } = require("../middleware/auth");
const https   = require("https");
const db      = require("../services/db");
const { resolveBestApiKey, assertApiUsageAllowed, recordApiUsage, getGlobalSetting } = require("../services/apiKeys");

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

function parseNumberLike(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractEmbeddedPdfText(base64 = "", maxChars = 12000) {
  try {
    const raw = Buffer.from(String(base64 || "").replace(/^data:[^;]+;base64,/, ""), "base64").toString("latin1");
    const chunks = [];
    raw.replace(/\(([^()]{2,220})\)/g, (_, text) => {
      const clean = String(text || "").replace(/\\([()\\])/g, "$1").replace(/[^\x20-\x7E\xA0-\xFF]/g, " ").trim();
      if (/[A-Za-z0-9]/.test(clean)) chunks.push(clean);
      return "";
    });
    return chunks.join("\n").slice(0, maxChars);
  } catch {
    return "";
  }
}

function isBillingSupportDoc(doc = {}) {
  const raw = `${doc.tipo || ""} ${doc.nombre || ""} ${doc.notas || ""}`.toLowerCase();
  return /albar|cmr|pod|ticket|bascul|b[áa]scul|pesaje|peso|descarga|carga|entrega/.test(raw);
}

function heuristicBillingSupportAnalysis(pedido = {}, docs = []) {
  const docText = docs.map(d => [d.nombre, d.tipo, d.notas, d.extracted_text].filter(Boolean).join("\n")).join("\n\n");
  const parsed = heuristicDocumentParse(docText);
  const pesoDoc = parseNumberLike(parsed.peso_kg || parsed.peso || parsed.toneladas);
  const pesoPedido = parseNumberLike(pedido.peso_kg);
  const diffs = [];
  if (pesoDoc && pesoPedido && Math.abs(pesoDoc - pesoPedido) > Math.max(50, pesoPedido * 0.01)) {
    diffs.push({ campo:"peso_kg", pedido:pesoPedido, documento:pesoDoc, diferencia: pesoDoc - pesoPedido });
  }
  if (!docs.length) diffs.push({ campo:"documentos", aviso:"No hay soportes de facturacion adjuntos al pedido" });
  return {
    modo: "heuristico",
    confianza: docs.length ? 0.35 : 0.1,
    resumen: docs.length
      ? "Revision basica de soportes. Si el documento es un PDF escaneado, subelo como imagen o con OCR para lectura IA visual."
      : "Sin documentos de soporte para revisar.",
    ticket_bascula: {
      detectado: /ticket|bascul|b[áa]scul|pesaje/.test(docText.toLowerCase()),
      peso_neto_kg: pesoDoc,
      bruto_kg: null,
      tara_kg: null,
      numero: parsed.albaran_numero || parsed.referencia_cliente || null,
    },
    pedido: {
      id: pedido.id,
      numero: pedido.numero,
      peso_kg: pesoPedido,
      importe: parseNumberLike(pedido.importe),
      mercancia: pedido.mercancia || null,
    },
    diferencias: diffs,
    faltantes: docs.length ? [] : ["documentos_soporte"],
    recomendaciones: diffs.length ? ["Revisar pedido antes de emitir la factura."] : ["Soportes sin diferencias evidentes con lectura disponible."],
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
  const keyInfo = await resolveBestApiKey(empresaId, safeProvider, ["openai", "ai_generic", "anthropic"]);
  return { provider: keyInfo.provider || safeProvider, baseUrl, model, apiKey: keyInfo.key, keySource: keyInfo.source };
}

function normalizeOpenAiMessages(messages, system) {
  const list = Array.isArray(messages) ? [...messages] : [];
  if (system) list.unshift({ role: "system", content: system });
  return list;
}

function normalizeAttachments(raw = []) {
  return (Array.isArray(raw) ? raw : []).map(a => ({
    base64: String(a?.base64 || "").replace(/^data:[^;]+;base64,/, ""),
    mediaType: String(a?.mediaType || a?.mime || "").toLowerCase(),
    name: String(a?.name || a?.nombre || "").slice(0, 120),
  })).filter(a => a.base64 && a.mediaType.startsWith("image/") && a.base64.length <= 7_000_000);
}

function buildOpenAiDocumentContent(prompt, attachments = []) {
  const content = [{ type: "text", text: prompt }];
  for (const a of attachments) {
    content.push({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.base64}` } });
  }
  return content;
}

function buildAnthropicDocumentContent(prompt, attachments = []) {
  const content = [{ type: "text", text: prompt }];
  for (const a of attachments) {
    content.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.base64 } });
  }
  return content;
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
  const attachments = normalizeAttachments(req.body?.attachments || req.body?.adjuntos || []);
  if (!cleanText && !attachments.length) return res.status(400).json({ error: "Texto o imagen del documento requerido" });

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
${cleanText || "(Documento aportado como imagen adjunta. Lee la imagen y extrae los datos visibles.)"}`;

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
          messages: normalizeOpenAiMessages([{ role:"user", content:buildOpenAiDocumentContent(userPrompt, attachments) }], system),
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
          messages: [{ role:"user", content:buildAnthropicDocumentContent(userPrompt, attachments) }],
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

router.post("/pedido/:id/facturacion-soportes", async (req, res) => {
  const empresaId = req.user?.empresa_id || req.empresaId;
  try {
    const { rows: pedidoRows } = await db.query(
      `SELECT id, numero, cliente_id, origen, destino, fecha_carga, fecha_descarga,
              mercancia, peso_kg, bultos, importe, referencia_cliente
         FROM pedidos
        WHERE id=$1 AND empresa_id=$2`,
      [req.params.id, empresaId]
    );
    const pedido = pedidoRows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

    const { rows: docRows } = await db.query(
      `SELECT id, nombre, tipo, file_base64, file_mime, file_size_kb, notas, metadata, created_at
         FROM pedido_docs
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY created_at DESC`,
      [req.params.id, empresaId]
    );
    const docs = docRows.filter(isBillingSupportDoc).slice(0, 8);
    const preparedDocs = docs.map(doc => {
      const mime = String(doc.file_mime || "").toLowerCase();
      const extractedText = mime.includes("pdf") ? extractEmbeddedPdfText(doc.file_base64) : "";
      return {
        id: doc.id,
        nombre: doc.nombre,
        tipo: doc.tipo,
        file_mime: doc.file_mime,
        notas: doc.notas || "",
        metadata: doc.metadata || {},
        extracted_text: extractedText,
      };
    });

    if (!preparedDocs.length) {
      const resultado = heuristicBillingSupportAnalysis(pedido, []);
      return res.json({ ok:true, modo:"heuristico", pedido, documentos:[], resultado, avisos:["No hay albaranes, CMR, tickets de bascula o soportes detectados."] });
    }

    let iaConfig;
    try {
      await comprobarCupoIA(req);
      iaConfig = await getIaRuntimeConfig(empresaId);
      if (iaConfig.apiKey) await assertApiUsageAllowed(empresaId, iaConfig.provider);
    } catch (err) {
      if (err.status === 403 || err.status === 429) {
        const resultado = heuristicBillingSupportAnalysis(pedido, preparedDocs);
        return res.json({ ok:true, modo:"heuristico", pedido, documentos:preparedDocs.map(({ metadata, ...d }) => d), resultado, avisos:[err.message] });
      }
      throw err;
    }

    if (!iaConfig.apiKey) {
      const resultado = heuristicBillingSupportAnalysis(pedido, preparedDocs);
      return res.json({ ok:true, modo:"heuristico", pedido, documentos:preparedDocs.map(({ metadata, ...d }) => d), resultado, avisos:["IA no configurada. Se ha usado revision heuristica."] });
    }

    const imageAttachments = docs
      .filter(doc => String(doc.file_mime || "").toLowerCase().startsWith("image/"))
      .slice(0, 5)
      .map(doc => ({
        base64: doc.file_base64,
        mediaType: doc.file_mime,
        name: doc.nombre,
      }));
    const docsForPrompt = preparedDocs.map(doc => ({
      id: doc.id,
      nombre: doc.nombre,
      tipo: doc.tipo,
      mime: doc.file_mime,
      notas: doc.notas,
      metadata: doc.metadata,
      texto_extraido: doc.extracted_text || null,
      aviso: !doc.extracted_text && String(doc.file_mime || "").toLowerCase().includes("pdf")
        ? "PDF sin texto extraible en backend; si es escaneado, valorar imagen/OCR."
        : null,
    }));
    const system = "Eres un auditor de facturacion para transporte. Devuelve solo JSON valido. No inventes datos: si no se ve, usa null y baja la confianza.";
    const prompt = `Analiza soportes de facturacion de un pedido antes de emitir factura. Especialmente tickets de bascula, albaranes, CMR y POD.

Pedido:
${JSON.stringify(pedido, null, 2)}

Documentos:
${JSON.stringify(docsForPrompt, null, 2)}

Devuelve este JSON:
{
  "confianza":0.0,
  "resumen":"",
  "ticket_bascula":{"detectado":false,"numero":null,"fecha":null,"peso_bruto_kg":null,"tara_kg":null,"peso_neto_kg":null},
  "albaranes":[{"numero":null,"fecha":null,"mercancia":null,"peso_kg":null}],
  "pedido":{"peso_kg":null,"importe":null,"mercancia":null,"referencia_cliente":null},
  "diferencias":[{"campo":"","pedido":null,"documento":null,"diferencia":null,"gravedad":"baja|media|alta","detalle":""}],
  "faltantes":[],
  "recomendaciones":[]
}`;

    let remoteData;
    if (iaConfig.provider === "openai" || iaConfig.provider === "ai_generic") {
      const baseUrl = iaConfig.provider === "openai" ? "https://api.openai.com/v1" : (iaConfig.baseUrl || "https://api.openai.com/v1");
      const proxyRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${iaConfig.apiKey}` },
        body: JSON.stringify({
          model: iaConfig.model || "gpt-4o-mini",
          response_format: { type:"json_object" },
          messages: normalizeOpenAiMessages([{ role:"user", content:buildOpenAiDocumentContent(prompt, imageAttachments) }], system),
          max_tokens: 2200,
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
          max_tokens: 2200,
          system,
          messages: [{ role:"user", content:buildAnthropicDocumentContent(prompt, imageAttachments) }],
        }),
      });
      remoteData = await proxyRes.json().catch(() => ({}));
      if (!proxyRes.ok) return res.status(proxyRes.status).json(remoteData);
    }

    await recordApiUsage(empresaId, iaConfig.provider, 1).catch(() => {});
    const parsed = tryJson(extractModelText(iaConfig.provider, remoteData));
    const resultado = parsed || heuristicBillingSupportAnalysis(pedido, preparedDocs);
    const analyzedAt = new Date().toISOString();
    const metadataPayload = {
      facturacion_ai: {
        analyzed_at: analyzedAt,
        modo: parsed ? "ia" : "heuristico",
        resumen: resultado.resumen || "",
        confianza: resultado.confianza ?? null,
        diferencias: Array.isArray(resultado.diferencias) ? resultado.diferencias : [],
        ticket_bascula: resultado.ticket_bascula || null,
      },
    };
    for (const doc of docs) {
      await db.query(
        `UPDATE pedido_docs
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
          WHERE id=$2 AND empresa_id=$3`,
        [JSON.stringify(metadataPayload), doc.id, empresaId]
      ).catch(() => {});
    }
    res.json({
      ok:true,
      modo: parsed ? "ia" : "heuristico",
      pedido,
      documentos: preparedDocs.map(({ metadata, ...d }) => d),
      resultado,
      avisos: parsed ? [] : ["La IA no devolvio JSON valido. Se ha usado revision heuristica."],
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
