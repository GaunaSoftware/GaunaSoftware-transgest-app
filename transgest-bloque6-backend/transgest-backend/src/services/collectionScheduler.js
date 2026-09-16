const db = require('./db');
const email = require('./email');
const logger = require('./logger');
const crypto = require('crypto');
let schema, timer;
function ensureSchema() {
  if (!schema) schema = db.query(`
    CREATE TABLE IF NOT EXISTS cobros_procesos (
      empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
      owner UUID NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS cobros_envios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
      ronda INTEGER NOT NULL, destinatario TEXT NOT NULL, estado TEXT NOT NULL,
      error TEXT, message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(factura_id,ronda,destinatario));
  `).catch(e=>{schema=null;throw e;});
  return schema;
}
const clamp=(n,f,min,max)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Math.trunc(Number(n)))):f;
function normalize(raw={}) {
  return {
    dias_revision_post_vencimiento:clamp(raw.dias_revision_post_vencimiento,1,0,30),
    dias_entre_reclamaciones:clamp(raw.dias_entre_reclamaciones,7,3,30),
    max_envios_reclamacion:clamp(raw.max_envios_reclamacion,6,1,20),
    dias_hasta_juridico:clamp(raw.dias_hasta_juridico,45,7,180),
    envio_email_auto:raw.envio_email_auto!==false,
    programacion_activa:raw.programacion_activa===true,
  };
}
async function config(company, client=db) {
  const {rows}=await client.query('SELECT configuracion FROM empresas WHERE id=$1',[company]);
  return normalize(rows[0]?.configuracion?.facturacion_cobros);
}
async function processCompany(company,{automatic=false,max_envios}={}) {
  await ensureSchema();
  const cfg=await config(company);
  if (automatic && (!cfg.programacion_activa || !cfg.envio_email_auto)) return {omitida:true};
  const owner=crypto.randomUUID();
  const lease=await db.query(`INSERT INTO cobros_procesos(empresa_id,owner,expires_at) VALUES($1,$2,now()+interval '15 minutes')
    ON CONFLICT(empresa_id) DO UPDATE SET owner=$2,expires_at=now()+interval '15 minutes'
    WHERE cobros_procesos.expires_at<now() RETURNING owner`,[company,owner]);
  if (!lease.rows.length) throw Object.assign(new Error('Ya hay una revisión de cobros en curso.'),{status:409});
  const result={ok:true,revisadas:0,reclamadas:0,sin_cobrar:0,emails:0,emails_simulados:0,emails_fallidos:0,sin_destinatario:0,envios_por_verificar:0};
  try {
    const {rows}=await db.query(`SELECT f.*,c.nombre AS cliente_nombre,c.email,c.email_facturacion,e.nombre AS empresa_nombre,(f.reclamacion_hasta<CURRENT_DATE) AS reclamacion_agotada
      FROM facturas f JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id JOIN empresas e ON e.id=f.empresa_id
      WHERE f.empresa_id=$1 AND f.estado IN ('emitida','enviada','vencida','reclamada') AND f.total>0
      AND f.fecha_vencimiento<CURRENT_DATE AND f.revision_cobro_at<=CURRENT_DATE
      ORDER BY f.fecha_vencimiento,f.id LIMIT 100`,[company]);
    result.revisadas=rows.length;
    for (const f of rows) {
      await db.query("UPDATE cobros_procesos SET expires_at=now()+interval '15 minutes' WHERE empresa_id=$1 AND owner=$2",[company,owner]);
      if (f.reclamacion_agotada) {
        const escalated=await db.query(`UPDATE facturas SET estado='sin_cobrar',reclamacion_estado='juridico_recomendado'
          WHERE id=$1 AND empresa_id=$2 AND estado IN ('emitida','enviada','vencida','reclamada') RETURNING id`,[f.id,company]);
        result.sin_cobrar+=escalated.rows.length;continue;
      }
      const round=Number(f.reclamacion_envios||0)+1;
      if (round>Math.min(cfg.max_envios_reclamacion,clamp(max_envios,cfg.max_envios_reclamacion,1,20))) continue;
      const days=Math.max(3,Number(f.aviso_cobro_dias || cfg.dias_entre_reclamaciones));
      if (f.reclamacion_ultimo_envio_at && Date.now()-new Date(f.reclamacion_ultimo_envio_at).getTime()<days*86400000) continue;
      const recipients=[...new Set([f.email_facturacion,f.email].flatMap(v=>String(v||'').split(/[;,]/)).map(v=>v.trim().toLowerCase()).filter(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))];
      if (!recipients.length) {result.sin_destinatario++;continue;}
      if (!cfg.envio_email_auto) continue;
      for (const recipient of recipients) {
        // Claim before SMTP. Uncertain deliveries are never sent again automatically.
        const claimed=await db.query(`INSERT INTO cobros_envios(empresa_id,factura_id,ronda,destinatario,estado)
          SELECT $1,$2,$3,$4,'enviando' FROM facturas WHERE id=$2 AND empresa_id=$1 AND estado IN ('emitida','enviada','vencida','reclamada')
          ON CONFLICT(factura_id,ronda,destinatario) DO UPDATE SET estado='enviando',error=NULL,updated_at=now()
          WHERE cobros_envios.estado IN ('fallido','simulado') RETURNING id`,[company,f.id,round,recipient]);
        if (!claimed.rows.length) continue;
        const delivery=claimed.rows[0].id;
        try {
          const sent=await email.enviarEmail({trigger:'factura_reclamacion',destinatario:recipient,plantilla:'factura_reclamacion',empresa_id:company,
            datos:{empresa:f.empresa_nombre,cliente:f.cliente_nombre,numero:f.numero,total:f.total,fecha_vencimiento:f.fecha_vencimiento},
            meta:{factura_id:f.id,factura_numero:f.numero,cliente_id:f.cliente_id,envio_id:delivery}});
          const simulated=sent?.simulado===true;
          if (!simulated && !sent?.messageId && sent?.ok!==true) throw new Error('SMTP no ha confirmado el envío');
          await db.query("UPDATE cobros_envios SET estado=$1,message_id=$2,updated_at=now() WHERE id=$3",[simulated?'simulado':'enviado',sent?.messageId||null,delivery]);
          result[simulated?'emails_simulados':'emails']++;
        } catch(e) {
          // Explicit server rejection/authentication errors can be retried. A disconnected socket may have delivered the mail.
          const definitive=['EAUTH','EENVELOPE','ECONNECTION','EDNS'].includes(e.code) || Number(e.responseCode)>=400;
          const state=definitive?'fallido':'por_verificar';
          await db.query('UPDATE cobros_envios SET estado=$1,error=$2,updated_at=now() WHERE id=$3',[state,String(e.message).slice(0,500),delivery]);
          result.emails_fallidos++;if(!definitive)result.envios_por_verificar++;
          logger.warn(`Reclamación ${delivery}: ${state}`);
        }
      }
      const sent=await db.query("SELECT COUNT(*)::int AS n FROM cobros_envios WHERE factura_id=$1 AND ronda=$2 AND estado='enviado'",[f.id,round]);
      if (sent.rows[0].n>0) {
        const updated=await db.query(`UPDATE facturas SET estado='reclamada',reclamacion_estado='reclamada',reclamacion_envios=$3,
          reclamacion_ultimo_envio_at=now(),reclamacion_hasta=COALESCE(reclamacion_hasta,CURRENT_DATE+($4::int*interval '1 day'))
          WHERE id=$1 AND empresa_id=$2 AND estado IN ('emitida','enviada','vencida','reclamada') AND COALESCE(reclamacion_envios,0)<$3 RETURNING id`,[f.id,company,round,cfg.dias_hasta_juridico]);
        result.reclamadas+=updated.rows.length;
      }
    }
    return result;
  } finally {await db.query('DELETE FROM cobros_procesos WHERE empresa_id=$1 AND owner=$2',[company,owner]);}
}
async function tick() {
  const {rows}=await db.query("SELECT id FROM empresas WHERE configuracion->'facturacion_cobros'->>'programacion_activa'='true' AND estado IN ('activo','activa')");
  for(const company of rows) {
    try {await processCompany(company.id,{automatic:true});}
    catch(e){logger.warn(`Reclamaciones automáticas: ${e.message}`);}
  }
}
function startScheduler() {
  if(timer)return;
  timer=setInterval(()=>tick().catch(e=>logger.error('Reclamaciones: '+e.message)),15*60*1000);
  timer.unref?.();
}
module.exports={ensureSchema,normalize,config,processCompany,startScheduler,tick};
