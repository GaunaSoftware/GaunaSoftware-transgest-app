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
    const {rows} = await db.query('SELECT ia_limite_mensual,ia_usos_mes,ia_periodo_mes FROM empresas WHERE id=$1',[req.user.empresa_id]);
    const company=rows[0], period=new Date().toISOString().slice(0,7);
    const limit=Number(company?.ia_limite_mensual ?? 0), used=company?.ia_periodo_mes===period?Number(company.ia_usos_mes||0):0;
    const providerLimit=Number(c.config?.limite_mensual||0), providerUsed=c.config?.periodo_mes===period?Number(c.config.usos_mes||0):0;
    const remaining=Math.max(0,Math.min(limit-used,providerLimit>0?providerLimit-providerUsed:Infinity));
    const available=Boolean(c.key)&&limit>0&&remaining>0;
    const message=!c.key?'Intelligence pendiente de configuración. Contacta con administración.':limit<=0?'Intelligence desactivado: administración debe asignar una cuota mensual.':remaining===0?'Has agotado la cuota mensual de Intelligence.':'TransGest Intelligence · Consultas sobre los datos de tu empresa';
    res.json({ configured: Boolean(c.key), available, message, remaining, read_only: true, tools: toolsFor(req.user).map(t => t.name) });
  } catch (error) { next(error); }
});

// Reserve a turn atomically across processes, before any paid provider call.
async function reserveTurn(eid) {
  await ensureTables();
  const periodo = new Date().toISOString().slice(0,7);
  await db.transaction(async tx => {
    const { rows } = await tx.query('SELECT plan,ia_limite_mensual,ia_usos_mes,ia_periodo_mes FROM empresas WHERE id=$1 FOR UPDATE', [eid]);
    const e = rows[0];
    const limit = Number(e?.ia_limite_mensual ?? 0);
    if (!e || limit <= 0) throw Object.assign(new Error('Intelligence está desactivado para esta empresa. Solicita a administración una cuota mensual mayor que cero.'), {status:403});
    if (e.ia_periodo_mes === periodo && Number(e.ia_usos_mes) >= limit) throw Object.assign(new Error('Cupo mensual de Intelligence agotado.'), {status:429});
    await tx.query(`INSERT INTO empresa_api_configs (empresa_id,provider,use_global,activo,limite_mensual,usos_mes,periodo_mes)
      VALUES ($1,'openai',true,true,0,0,$2) ON CONFLICT (empresa_id,provider) DO NOTHING`, [eid,periodo]);
    const result = await tx.query(`UPDATE empresa_api_configs SET periodo_mes=$2::varchar,
      usos_mes=CASE WHEN periodo_mes=$2::varchar THEN usos_mes+1 ELSE 1 END
      WHERE empresa_id=$1 AND provider='openai' AND activo=true
      AND (limite_mensual=0 OR periodo_mes IS DISTINCT FROM $2::varchar OR usos_mes < limite_mensual) RETURNING empresa_id`, [eid,periodo]);
    if (!result.rows.length) throw Object.assign(new Error('Intelligence desactivado o cupo mensual agotado.'), {status:429});
    await tx.query(`UPDATE empresas SET ia_periodo_mes=$2::varchar, ia_usos_mes=CASE WHEN ia_periodo_mes=$2::varchar THEN ia_usos_mes+1 ELSE 1 END WHERE id=$1`,[eid,periodo]);
  });
  return periodo;
}
async function releaseTurn(eid,periodo) {
  await db.transaction(async tx => {
    await tx.query('SELECT id FROM empresas WHERE id=$1 FOR UPDATE',[eid]);
    await tx.query('UPDATE empresas SET ia_usos_mes=GREATEST(0,ia_usos_mes-1) WHERE id=$1 AND ia_periodo_mes=$2::varchar',[eid,periodo]);
    await tx.query("UPDATE empresa_api_configs SET usos_mes=GREATEST(0,usos_mes-1) WHERE empresa_id=$1 AND provider='openai' AND periodo_mes=$2::varchar",[eid,periodo]);
  });
}
router.post('/chat', async (req, res) => {
  const start = Date.now();
  let reservation;
  try {
    const messages = validateMessages(req.body?.messages);
    const c = await config(req.user);
    if (!c.key) return res.status(503).json({ error: 'Intelligence está pendiente de configuración. Contacta con administración.', code:'INTELLIGENCE_CONFIG' });
    reservation = await reserveTurn(req.user.empresa_id);
    const result = await runConversation({ db, user: req.user, messages, request: async payload => {
      const remaining = 70000 - (Date.now()-start);
      if (remaining < 3000) throw Object.assign(new Error('Consulta demasiado larga. Prueba con un pedido o mes concreto.'), {status:504});
      const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${c.key}` },
        body:JSON.stringify({ ...payload, model:c.model })
      }, Math.min(remaining,35000));
      if (!response.ok) throw Object.assign(new Error(response.status===429 ? 'El servicio de Intelligence ha alcanzado su límite. Contacta con administración.' : 'El servicio de Intelligence no pudo atender la consulta. Administración puede revisar la conexión en Integraciones.'), {status:response.status===429?429:502});
      return response.json();
    }});
    logger.info({ event:'intelligence_chat', empresa_id:req.user.empresa_id, user_id:req.user.id, model:c.model, tools:result.sources.map(s=>s.name), usage:result.usage, duration_ms:Date.now()-start });
    res.json({ ...result, model:c.model });
  } catch (error) {
    if (reservation) await releaseTurn(req.user.empresa_id,reservation).catch(e => logger.error({event:'intelligence_refund_error',empresa_id:req.user.empresa_id,request_id:req.id,code:e.code}));
    logger.warn({ event:'intelligence_error', empresa_id:req.user.empresa_id, request_id:req.id, status:error.status||503, code:error.code, message:String(error.message || '').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]') });
    res.status(error.status || 503).json({ error:error.status ? error.message : 'No se pudo completar la consulta por un error interno. Contacta con soporte e indica el código de seguimiento.', code:error.status?'INTELLIGENCE_SERVICE':'INTELLIGENCE_INTERNAL', request_id:req.id });
  }
});
module.exports = router;
