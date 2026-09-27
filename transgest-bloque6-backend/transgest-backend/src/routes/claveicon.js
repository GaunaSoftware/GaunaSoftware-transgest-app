const router=require('express').Router();
const db=require('../services/db');
const {GERENTE_O_CONTABLE,SOLO_GERENTE}=require('../middleware/auth');
const service=require('../services/claveicon/outbox');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(e=>e.status?res.status(e.status).json({error:e.message}):next(e));
const company=req=>req.empresaId || req.user.empresa_id;
router.use(GERENTE_O_CONTABLE);
router.get('/config',wrap(async(req,res)=>res.json(await service.settings(db,company(req)))));
router.put('/config',SOLO_GERENTE,wrap(async(req,res)=>{
 const cfg={...require('../services/claveicon/xml').config(req.body),enabled:req.body.enabled===true};
 await db.transaction(async c=>{
  await c.query("UPDATE empresas SET configuracion=jsonb_set(COALESCE(configuracion,'{}'::jsonb),'{claveicon}',$1::jsonb,true) WHERE id=$2",[JSON.stringify(cfg),company(req)]);
  await c.query("INSERT INTO audit_log(tabla,registro_id,campo,valor_nuevo,usuario_id,empresa_id) VALUES('empresas',$1,'claveicon_config',$2,$3,$1)",[company(req),JSON.stringify(cfg),req.user.id]);
 });res.json(cfg);
}));
router.get('/envios',wrap(async(req,res)=>{
 const {rows}=await db.query("SELECT id,factura_id,entity_type,status,attempts,last_error,external_ref,exported_at,processed_at,created_at,payload->'invoice'->>'numero' AS numero FROM accounting_invoice_outbox WHERE empresa_id=$1 AND provider='claveicon' ORDER BY created_at DESC, CASE entity_type WHEN 'account' THEN 0 WHEN 'invoice' THEN 1 ELSE 2 END LIMIT 200",[company(req)]);res.json(rows);
}));
router.post('/:id/exportar',wrap(async(req,res)=>{
 let result;
 try {result=await db.transaction(c=>service.exportEntity(c,company(req),req.params.id));}
 catch(error){
  if(error.status===422)await db.query("UPDATE accounting_invoice_outbox SET status=CASE WHEN exported_at IS NULL THEN 'failed' ELSE status END,last_error=$1,updated_at=NOW() WHERE id=$2 AND empresa_id=$3 AND provider='claveicon' AND status NOT IN ('synced','unknown')",[error.message,req.params.id,company(req)]);
  throw error;
 }
 res.type('application/xml; charset=ISO-8859-1').set('Content-Disposition',`attachment; filename="${result.filename}"`).set('X-Content-SHA256',result.hash).send(result.buffer);
}));
router.get('/cuentas',wrap(async(req,res)=>{
 const {rows}=await db.query("SELECT c.id,c.nombre,c.cif,m.account_code FROM clientes c LEFT JOIN accounting_party_mappings m ON m.empresa_id=c.empresa_id AND m.source_party_id=c.id AND m.provider='claveicon' AND m.party_type='customer' WHERE c.empresa_id=$1 ORDER BY c.nombre LIMIT 500",[company(req)]);
 res.json(rows);
}));
router.put('/cuentas/:id',SOLO_GERENTE,wrap(async(req,res)=>{
 const code=String(req.body.account_code || '').trim();
 if(!/^[a-zA-Z0-9]{1,15}$/.test(code))throw Object.assign(new Error('La cuenta debe tener entre 1 y 15 letras o números.'),{status:422});
 await db.transaction(async client=>{
  await client.query('SELECT id FROM empresas WHERE id=$1 FOR UPDATE',[company(req)]);
  const party=await client.query('SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2',[req.params.id,company(req)]);
  if(!party.rows.length)throw Object.assign(new Error('Cliente no encontrado'),{status:404});
  const used=await client.query("SELECT id FROM accounting_invoice_outbox WHERE empresa_id=$1 AND provider='claveicon' AND payload->>'source_party_id'=$2 AND exported_at IS NOT NULL LIMIT 1",[company(req),req.params.id]);
  if(used.rows.length)throw Object.assign(new Error('La cuenta ya se utilizó en una exportación. Concilia su cambio antes de modificarla.'),{status:409});
  const duplicate=await client.query("SELECT id FROM accounting_party_mappings WHERE empresa_id=$1 AND provider='claveicon' AND account_code=$2 AND source_party_id<>$3",[company(req),code,req.params.id]);
  if(duplicate.rows.length)throw Object.assign(new Error('La cuenta ya está asignada a otro tercero.'),{status:409});
  await client.query("INSERT INTO accounting_party_mappings(empresa_id,provider,party_type,source_party_id,account_code) VALUES($1,'claveicon','customer',$2,$3) ON CONFLICT(empresa_id,provider,party_type,source_party_id) DO UPDATE SET account_code=EXCLUDED.account_code",[company(req),req.params.id,code]);
  await client.query("INSERT INTO audit_log(tabla,registro_id,campo,valor_nuevo,usuario_id,empresa_id) VALUES('clientes',$1,'claveicon_account',$2,$3,$4)",[req.params.id,code,req.user.id,company(req)]);
 });res.json({ok:true});
}));
router.post('/:id/resultado-desconocido',wrap(async(req,res)=>{
 const result=await db.query("UPDATE accounting_invoice_outbox SET status='unknown',last_error='Comprueba en ClaveiCon si se importó antes de volver a exportar.',updated_at=NOW() WHERE id=$1 AND empresa_id=$2 AND provider='claveicon' AND status='processing' RETURNING id",[req.params.id,company(req)]);
 if(!result.rows.length)throw Object.assign(new Error('No hay una importación pendiente para conciliar.'),{status:409});
 res.json({ok:true});
}));
router.post('/:id/no-importado',wrap(async(req,res)=>{
 const reference=String(req.body.reference || '').trim().slice(0,300);
 if(req.body.confirmed!==true || !reference)throw Object.assign(new Error('Confirma que has comprobado en Clavei que NO existe el registro e indica la referencia de la comprobación.'),{status:422});
 await db.transaction(async client=>{
  const result=await client.query("UPDATE accounting_invoice_outbox SET status='failed',external_ref=NULL,exported_at=NULL,last_error=NULL,updated_at=NOW() WHERE id=$1 AND empresa_id=$2 AND provider='claveicon' AND status IN ('unknown','processing') RETURNING id",[req.params.id,company(req)]);
  if(!result.rows.length)throw Object.assign(new Error('El registro no requiere conciliación.'),{status:409});
  await client.query("INSERT INTO audit_log(tabla,registro_id,campo,valor_nuevo,usuario_id,empresa_id) VALUES('accounting_invoice_outbox',$1,'verified_not_imported',$2,$3,$4)",[req.params.id,reference,req.user.id,company(req)]);
 });res.json({ok:true});
}));
router.post('/:id/confirmar',wrap(async(req,res)=>{
 const reference=String(req.body.reference||'').trim().slice(0,300);
 if(!reference || req.body.confirmed!==true)throw Object.assign(new Error('Confirma la importación e indica su referencia en ClaveiCon.'),{status:422});
 await db.transaction(async c=>{
  const {rows}=await c.query("UPDATE accounting_invoice_outbox SET status='synced',processed_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1 AND empresa_id=$2 AND provider='claveicon' AND status IN ('processing','unknown') AND exported_at IS NOT NULL RETURNING factura_id,entity_type",[req.params.id,company(req)]);
  if(!rows[0])throw Object.assign(new Error('El registro no está pendiente de confirmar.'),{status:409});
  await c.query("INSERT INTO audit_log(tabla,registro_id,campo,valor_nuevo,usuario_id,empresa_id) VALUES('accounting_invoice_outbox',$1,'manual_import_confirmed',$2,$3,$4)",[req.params.id,JSON.stringify({reference,...rows[0]}),req.user.id,company(req)]);
 });res.json({ok:true});
}));
module.exports=router;
