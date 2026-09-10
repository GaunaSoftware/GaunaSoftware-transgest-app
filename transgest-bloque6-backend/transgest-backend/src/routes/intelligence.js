const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../services/db');
const logger = require('../services/logger');
const { resolveApiKey, getGlobalSetting, ensureTables } = require('../services/apiKeys');
const { normalizeAiModel, fetchWithTimeout } = require('../services/aiProvider');
const { runConversation, validateMessages, toolsFor } = require('../services/intelligence');

router.use(rateLimit({ windowMs: 60000, max: 12, keyGenerator: req => `${req.user.empresa_id}:${req.user.id}`, message: { error: 'Espera un minuto antes de enviar mas consultas.' } }));

async function config(user) {
  const key = await resolveApiKey(user.empresa_id, 'openai');
  const provider = await getGlobalSetting('ia_provider', process.env.AI_PROVIDER || 'openai');
  const model = normalizeAiModel('openai', await getGlobalSetting('intelligence_model', '') || (provider === 'openai' ? await getGlobalSetting('ia_model', '') : ''));
  return { ...key, model };
}
router.get('/estado', async (req, res, next) => {
  try {
    const c = await config(req.user);
    res.json({ configured: Boolean(c.key), source: c.source, model: c.model, read_only: true, tools: toolsFor(req.user).map(t => t.name) });
  } catch (error) { next(error); }
});

// Reserve a turn atomically across processes, before any paid provider call.
async function reserveTurn(eid) {
  await ensureTables();
  const periodo = new Date().toISOString().slice(0,7);
  await db.transaction(async tx => {
    const { rows } = await tx.query('SELECT plan,ia_limite_mensual,ia_usos_mes,ia_periodo_mes FROM empresas WHERE id=$1 FOR UPDATE', [eid]);
    const e = rows[0];
    const limit = Number(e?.ia_limite_mensual || (e?.plan === 'enterprise' ? 1000 : 0));
    if (!e || limit <= 0) throw Object.assign(new Error('TransGest Intelligence requiere TransGest Pro Intelligence.'), {status:403});
    if (e.ia_periodo_mes === periodo && Number(e.ia_usos_mes) >= limit) throw Object.assign(new Error('Cupo mensual de Intelligence agotado.'), {status:429});
    await tx.query(`INSERT INTO empresa_api_configs (empresa_id,provider,use_global,activo,limite_mensual,usos_mes,periodo_mes)
      VALUES ($1,'openai',true,true,0,0,$2) ON CONFLICT (empresa_id,provider) DO NOTHING`, [eid,periodo]);
    const result = await tx.query(`UPDATE empresa_api_configs SET periodo_mes=$2,
      usos_mes=CASE WHEN periodo_mes=$2 THEN usos_mes+1 ELSE 1 END
      WHERE empresa_id=$1 AND provider='openai' AND activo=true
      AND (limite_mensual=0 OR periodo_mes IS DISTINCT FROM $2 OR usos_mes < limite_mensual) RETURNING empresa_id`, [eid,periodo]);
    if (!result.rows.length) throw Object.assign(new Error('OpenAI desactivado o cupo mensual agotado.'), {status:429});
    await tx.query(`UPDATE empresas SET ia_periodo_mes=$2, ia_usos_mes=CASE WHEN ia_periodo_mes=$2 THEN ia_usos_mes+1 ELSE 1 END WHERE id=$1`,[eid,periodo]);
  });
}
router.post('/chat', async (req, res) => {
  const start = Date.now();
  try {
    const messages = validateMessages(req.body?.messages);
    const c = await config(req.user);
    if (!c.key) return res.status(503).json({ error: 'Configura OpenAI para esta empresa en Superadmin > Integraciones. Puedes usar su clave propia o la general.' });
    await reserveTurn(req.user.empresa_id);
    const result = await runConversation({ db, user: req.user, messages, request: async payload => {
      const remaining = 70000 - (Date.now()-start);
      if (remaining < 3000) throw Object.assign(new Error('Consulta demasiado larga. Prueba con un pedido o mes concreto.'), {status:504});
      const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${c.key}` },
        body:JSON.stringify({ ...payload, model:c.model })
      }, Math.min(remaining,35000));
      if (!response.ok) throw Object.assign(new Error(response.status===429 ? 'OpenAI ha alcanzado su limite de uso. Revisa saldo y cuota de la clave seleccionada.' : 'OpenAI no pudo atender la consulta. Revisa la conexion, la clave y el modelo en Integraciones.'), {status:response.status===429?429:502});
      return response.json();
    }});
    logger.info({ event:'intelligence_chat', empresa_id:req.user.empresa_id, user_id:req.user.id, model:c.model, tools:result.sources.map(s=>s.name), usage:result.usage, duration_ms:Date.now()-start });
    res.json({ ...result, model:c.model });
  } catch (error) {
    logger.warn({ event:'intelligence_error', empresa_id:req.user.empresa_id, request_id:req.id, status:error.status||503 });
    res.status(error.status || 503).json({ error:error.status ? error.message : 'TransGest Intelligence no esta disponible. Comprueba la conexion a Internet del servidor.', request_id:req.id });
  }
});
module.exports = router;
