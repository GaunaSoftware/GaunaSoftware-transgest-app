const crypto=require('crypto');
const express=require('express');
const rateLimit=require('express-rate-limit');
const db=require('../services/db');
const {getEmpresaFiscalConfig}=require('../services/fiscal');
const {validSignature}=require('../services/verifactiWebhook');
const router=express.Router();
router.use(rateLimit({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false}));
router.post('/webhook/verifacti/:empresaId',async(req,res)=>{
 try {
  if(!/^[a-f0-9-]{36}$/i.test(req.params.empresaId))return res.status(400).json({error:'Empresa no válida'});
  if(!req.rawBody || req.rawBody.length>1024*1024)return res.status(413).json({error:'Notificación demasiado grande o cuerpo original no disponible'});
  const config=await getEmpresaFiscalConfig(req.params.empresaId);
  if(config.modo!=='verifactu' || config.verifactu.proveedor!=='verifacti' || !validSignature(req.rawBody,req.get('X-Webhook-Signature'),config.verifactu.provider_webhook_secret))return res.status(401).json({error:'Firma de webhook no válida'});
  const eventId=req.get('X-Webhook-Id');
  if(!eventId || eventId.length>255 || !Array.isArray(req.body) || !req.body.length || req.body.length>1000)return res.status(400).json({error:'Notificación no válida'});
  if(req.body.some(r=>!r || !r.uuid || r.nif!==config.nif_declarante))return res.status(400).json({error:'La notificación no corresponde al NIF configurado'});
  const hash=crypto.createHash('sha256').update(req.rawBody).digest('hex');
  const inserted=await db.query(`INSERT INTO fiscal_webhook_receipts(empresa_id,provider,event_id,payload_hash,payload) VALUES($1,'verifacti',$2,$3,$4::jsonb) ON CONFLICT(empresa_id,provider,event_id) DO NOTHING RETURNING event_id`,[req.params.empresaId,eventId,hash,JSON.stringify(req.body)]);
  if(!inserted.rows.length){const previous=await db.query("SELECT payload_hash FROM fiscal_webhook_receipts WHERE empresa_id=$1 AND provider='verifacti' AND event_id=$2",[req.params.empresaId,eventId]);if(previous.rows[0]?.payload_hash!==hash)return res.status(409).json({error:'Identidad de notificación reutilizada con contenido diferente'});}
  res.status(202).json({ok:true,duplicate:!inserted.rows.length});
 }catch{res.status(503).json({error:'No se pudo guardar la notificación. Reintente más tarde.'});}
});
module.exports=router;
