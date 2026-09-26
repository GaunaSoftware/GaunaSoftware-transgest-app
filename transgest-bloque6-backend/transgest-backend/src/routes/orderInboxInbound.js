const express=require('express'),crypto=require('crypto');
const rateLimit=require('express-rate-limit');
const db=require('../services/db'),inbox=require('../services/orderInbox');
const {planHasFeature,getSubscriptionState}=require('../middleware/auth');
const router=express.Router();
function verifySignature(body,timestamp,signature,secret,now=Date.now()){
 if(!Buffer.isBuffer(body)||!/^\d{10}$/.test(timestamp||'')||Math.abs(now-Number(timestamp)*1000)>300000||!/^sha256=[a-f0-9]{64}$/.test(signature||'')||String(secret||'').length<32)return false;
 const expected=crypto.createHmac('sha256',secret).update(`${timestamp}.`).update(body).digest();
 return crypto.timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));
}
router.post('/',rateLimit({windowMs:60000,max:60,standardHeaders:true,legacyHeaders:false}),express.raw({type:'application/json',limit:'12mb'}),async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  if(!inbox.inboundConfiguration('').configured)return res.status(503).json({error:'Entrada de correo no configurada'});
  if(!verifySignature(req.body,req.get('x-transgest-timestamp'),req.get('x-transgest-signature'),process.env.ORDERS_INBOUND_WEBHOOK_SECRET))return res.status(401).json({error:'Firma de entrada no válida'});
  let body;try{body=JSON.parse(req.body.toString('utf8'));}catch{return res.status(400).json({error:'JSON no válido'});}
  const address=String(body.to||'').trim().toLowerCase(),match=/^pedidos\+([a-f0-9]{32})@/.exec(address);
  if(!match)return res.status(404).json({error:'Destinatario no disponible'});
  const v=match[1],company=`${v.slice(0,8)}-${v.slice(8,12)}-${v.slice(12,16)}-${v.slice(16,20)}-${v.slice(20)}`;
  if(inbox.inboundConfiguration(company).address!==address)return res.status(404).json({error:'Destinatario no disponible'});
  const row=(await db.query('SELECT * FROM empresas WHERE id=$1',[company])).rows[0];
  if(!row||!planHasFeature(row.plan,'ai')||getSubscriptionState(row).blocked||['inactiva','inactivo','cancelada','suspendida'].includes(row.estado))return res.status(403).json({error:'Empresa no habilitada para esta entrada'});
  if(!String(body.message_id||'').trim())return res.status(422).json({error:'El conector debe conservar el Message-ID original'});
  const item=await inbox.receive(db,company,null,{...body,source:'email_inbound'});
  res.status(item.duplicate?200:202).json({id:item.id,state:item.state,duplicate:item.duplicate});
 }catch(e){res.status(e.status||500).json({error:e.status?e.message:'No se pudo registrar la entrada de correo'});}
});
module.exports=router;
module.exports.verifySignature=verifySignature;
