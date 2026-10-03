const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schemaSql = fs.readFileSync(path.join(__dirname,'../../scripts/migrations/20261002_order_customer_notifications.sql'),'utf8');

function recipients(value) {
  if (typeof value === 'string') {
    try { const parsed=JSON.parse(value); if(Array.isArray(parsed))value=parsed; } catch {}
  }
  return [...new Set((Array.isArray(value)?value:String(value || '').split(/[;,\n]/))
    .map(v=>String(v).trim().toLowerCase()).filter(v=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)))];
}

function createCustomerTripNotifications({ db, send, logger = console }) {
  let schema, processing, timer;
  const ensureSchema=()=>schema || (schema=db.query(schemaSql).catch(error=>{schema=null;throw error;}));
  async function finish(job,status,error=null,fingerprint=null) {
    await db.query(`UPDATE pedido_cliente_email_jobs SET status=$3,last_error=$4,
      sent_at=CASE WHEN $3='sent' THEN NOW() ELSE sent_at END,document_fingerprint=COALESCE($5,document_fingerprint),
      available_at=NOW()+INTERVAL '5 minutes'
      WHERE id=$1 AND empresa_id=$2 AND revision=$6 AND attempts=$7`,
      [job.id,job.empresa_id,status,error,fingerprint,job.revision,job.attempts]);
  }
  async function processJob(job) {
    const row=(await db.query(`SELECT p.id,p.colaborador_id,c.emails_albaranes,e.nombre AS empresa
      FROM pedidos p JOIN clientes c ON c.id=$3 AND c.empresa_id=p.empresa_id
      JOIN empresas e ON e.id=p.empresa_id WHERE p.id=$1 AND p.empresa_id=$2`,
      [job.pedido_id,job.empresa_id,job.cliente_id])).rows[0];
    const emails=recipients(row?.emails_albaranes);
    const staff=row?.colaborador_id?(await db.query(`SELECT email,rol FROM usuarios WHERE empresa_id=$1
      AND activo IS DISTINCT FROM false AND rol::text IN ('trafico','gerente')`,[job.empresa_id])).rows:[];
    const traffic=recipients(staff.filter(u=>u.rol==='trafico').map(u=>u.email));
    const issuer=traffic.length?traffic:recipients(staff.filter(u=>u.rol==='gerente').map(u=>u.email));
    if(!emails.length&&!issuer.length) return finish(job,'skipped','No hay correos de cliente o tráfico configurados para avisar del estado.');
    const includeDocs=job.tipo==='albaranes'||job.estado==='entregado';
    const docs=includeDocs?(await db.query(`SELECT id,nombre,file_base64,file_mime FROM pedido_docs
      WHERE pedido_id=$1 AND empresa_id=$2 AND file_base64 IS NOT NULL
      AND LOWER(COALESCE(tipo,'')) IN ('albaran','albarán','albaran_colaborador','albaran_descarga','albaran_entrega','foto_entrega','pod','cmr') ORDER BY id`,[job.pedido_id,job.empresa_id])).rows:[];
    const fingerprint=docs.length?crypto.createHash('sha256').update(JSON.stringify(docs.map(d=>[d.id,crypto.createHash('sha256').update(d.file_base64).digest('hex')]))).digest('hex'):null;
    if(job.tipo==='albaranes') {
      if(fingerprint && job.document_fingerprint===fingerprint)return finish(job,'skipped',null,fingerprint);
      const previous=(await db.query(`SELECT 1 FROM pedido_cliente_email_jobs WHERE empresa_id=$1 AND pedido_id=$2
        AND status='sent' AND document_fingerprint=$3 LIMIT 1`,[job.empresa_id,job.pedido_id,fingerprint])).rows;
      if(!docs.length||previous.length)return finish(job,'skipped',null,fingerprint);
    }
    const attachments=docs.map(d=>({filename:d.nombre,content:Buffer.from(String(d.file_base64).replace(/^data:[^,]*,/,'').replace(/\s/g,''),'base64'),contentType:d.file_mime||'application/pdf'}));
    const bytes=attachments.reduce((n,d)=>n+d.content.length,0);
    if(bytes>20*1024*1024)throw new Error('Los albaranes superan 20 MB en un correo. Administración debe revisar el tamaño de los adjuntos.');
    const result=await send({trigger:'pedido_cliente_estado',empresa_id:job.empresa_id,require_company:true,destinatario:(emails.length?emails:issuer).join(','),bcc:emails.length?issuer.filter(v=>!emails.includes(v)):[],
      plantilla:'pedido_cliente_estado',attachments,meta:{job_id:job.id,revision:job.revision},
      datos:{...job.snapshot,empresa:row.empresa,estado:job.estado,albaranes:job.tipo==='albaranes',documentos:docs.length}});
    if(result?.simulado||result?.error)throw new Error('El correo no se ha enviado. Revisa SMTP.');
    await finish(job,'sent',null,fingerprint);
  }
  async function drain() {
    if(processing)return processing;
    processing=(async()=>{
      await ensureSchema();
      for(let n=0;n<10;n++) {
        const job=await db.transaction(async tx=>{
          const candidate=(await tx.query(`SELECT j.id FROM pedido_cliente_email_jobs j
            WHERE j.status IN ('pending','failed','processing') AND j.attempts<8 AND j.available_at<=NOW()
              AND NOT EXISTS(SELECT 1 FROM pedido_cliente_email_jobs earlier
                WHERE earlier.empresa_id=j.empresa_id AND earlier.pedido_id=j.pedido_id
                  AND earlier.status IN ('pending','failed','processing') AND earlier.attempts<8
                  AND (earlier.created_at,earlier.id)<(j.created_at,j.id))
            ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`)).rows[0];
          if(!candidate)return null;
          return (await tx.query(`UPDATE pedido_cliente_email_jobs SET status='processing',attempts=attempts+1,
            available_at=NOW()+INTERVAL '10 minutes' WHERE id=$1 RETURNING *`,[candidate.id])).rows[0];
        });
        if(!job)break;
        try { await processJob(job); } catch(error) {
          await finish(job,'failed',String(error.message).slice(0,1500));
          logger.warn('Aviso de viaje pendiente de envío:',error.message);
        }
      }
    })().finally(()=>{processing=null;});
    return processing;
  }
  function start() { if(timer)return;timer=setInterval(()=>drain().catch(error=>logger.warn('Avisos de cliente:',error.message)),15000);timer.unref();drain().catch(error=>logger.warn('Avisos de cliente:',error.message)); }
  async function stop() {clearInterval(timer);timer=null;await processing;}
  return {ensureSchema,drain,start,stop};
}
module.exports={createCustomerTripNotifications,recipients,schemaSql};
