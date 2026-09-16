const express=require('express'),crypto=require('crypto'),db=require('../services/db');
const router=express.Router();
let schema;
router.use(async(req,res,next)=>{try{if(!schema)schema=require('./colaboradores').ensureColaboradorOpsSchema().then(()=>db.query('ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS conductor_proveedor_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL')).catch(e=>{schema=null;throw e;});await schema;next();}catch(e){next(e);}});
router.use((req,res,next)=>{
 if(!req.user?.colaborador_id||!['colaborador','chofer'].includes(req.user.rol))return res.status(403).json({error:'Acceso exclusivo del proveedor invitado'});next();
});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
const supplier=req=>[req.empresaId,req.user.colaborador_id];
router.get('/pedidos',wrap(async(req,res)=>{
 const {rows}=await db.query(`SELECT id,numero,estado,origen,destino,fecha_carga,fecha_descarga,mercancia,
   matricula_colaborador,conductor_colaborador,chofer_id,colaborador_precio_confirmado
   FROM pedidos WHERE empresa_id=$1 AND colaborador_id=$2
   AND ($3::uuid IS NULL OR conductor_proveedor_usuario_id=$3) ORDER BY fecha_carga DESC NULLS LAST LIMIT 200`,[...supplier(req),req.user.rol==='chofer'?req.user.id:null]);
 res.json(rows);
}));
router.post('/pedidos/:id/acceso',wrap(async(req,res)=>{
 const {rows}=await db.query('SELECT id FROM pedidos WHERE id=$1 AND empresa_id=$2 AND colaborador_id=$3 AND ($4::uuid IS NULL OR conductor_proveedor_usuario_id=$4)',[req.params.id,...supplier(req),req.user.rol==='chofer'?req.user.id:null]);
 if(!rows.length)return res.status(404).json({error:'Pedido no encontrado'});
 const token=crypto.randomBytes(32).toString('hex');
 await db.query(`INSERT INTO colaborador_liquidacion_tokens(empresa_id,colaborador_id,pedido_id,token_hash,expires_at,created_by)
   VALUES($1,$2,$3,$4,NOW()+INTERVAL '2 hours',$5)`,[...supplier(req),req.params.id,crypto.createHash('sha256').update(token).digest('hex'),req.user.id]);
 res.json({path:`/colaboradores/public/portal/${token}/operativa`});
}));
const documentScope=(req,tx=db,lock=false)=>tx.query(`SELECT id,estado FROM pedidos WHERE id=$1 AND empresa_id=$2 AND colaborador_id=$3 AND ($4::uuid IS NULL OR conductor_proveedor_usuario_id=$4) ${lock?'FOR UPDATE':''}`,[req.params.id,...supplier(req),req.user.rol==='chofer'?req.user.id:null]);
router.get('/pedidos/:id/documentos',wrap(async(req,res)=>{
 if(!(await documentScope(req)).rows.length)return res.status(404).json({error:'Pedido no encontrado'});
 res.json((await db.query("SELECT id,nombre,tipo,created_at FROM pedido_docs WHERE pedido_id=$1 AND empresa_id=$2 AND tipo IN ('albaran','albaran_colaborador','pod','cmr') ORDER BY created_at DESC",[req.params.id,req.empresaId])).rows);
}));
router.post('/pedidos/:id/documentos',wrap(async(req,res)=>{
 const tipo=String(req.body.tipo||'albaran_colaborador'),nombre=String(req.body.nombre||'').replace(/[\\/\r\n]/g,'_').slice(0,180);
 if(!nombre||!['albaran_colaborador','pod','cmr'].includes(tipo))return res.status(400).json({error:'Adjunta un albarán, POD o CMR.'});
 const result=await db.transaction(async tx=>{
  const order=(await documentScope(req,tx,true)).rows[0];if(!order)throw Object.assign(new Error('Pedido no encontrado'),{status:404});
  if(order.estado==='cancelado')throw Object.assign(new Error('El pedido está cancelado'),{status:409});
  const upload=require('../services/uploadValidation').validateBase64Upload({data:req.body.file_base64,mime:req.body.file_mime,filename:nombre,allowedMimes:new Set(['application/pdf','image/jpeg','image/png','image/webp'])});
  const row=(await tx.query(`INSERT INTO pedido_docs(pedido_id,empresa_id,nombre,tipo,file_base64,file_mime,file_size_kb,notas) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,nombre,tipo`,[req.params.id,req.empresaId,nombre,tipo,upload.base64,upload.mime,Math.ceil(upload.sizeBytes/1024),'Subido por proveedor autenticado'])).rows[0];
  await tx.query("INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,detalle) VALUES($1,$2,'colaborador_portal.albaran_subido','colaborador_portal',$3)",[req.params.id,req.empresaId,JSON.stringify({documento_id:row.id,usuario_id:req.user.id,colaborador_id:req.user.colaborador_id})]);return row;
 });res.status(201).json(result);
}));
router.get('/pedidos/:id/documentos/:docId',wrap(async(req,res)=>{
 if(!(await documentScope(req)).rows.length)return res.status(404).json({error:'Pedido no encontrado'});
 const doc=(await db.query("SELECT nombre,file_mime,file_base64 FROM pedido_docs WHERE id=$1 AND pedido_id=$2 AND empresa_id=$3 AND tipo IN ('albaran','albaran_colaborador','pod','cmr')",[req.params.docId,req.params.id,req.empresaId])).rows[0];
 if(!doc)return res.status(404).json({error:'Documento no encontrado'});res.json(doc);
}));
const plannerEnabled=async(req,res,next)=>{try{
 const enabled=await require('../services/companyProducts').get(req.empresaId);
 if(!enabled.productos.includes('planner'))return res.status(403).json({error:'El cargador no tiene Planner activo.'});
 await require('../services/plannerSchema').ensurePlannerSchema();next();
}catch(e){next(e);}};
router.get('/pedidos/:id/hueco',plannerEnabled,wrap(async(req,res)=>{
 if(!(await documentScope(req)).rows.length)return res.status(404).json({error:'Carga no encontrada'});
 const reservas=(await db.query(`SELECT r.id,r.inicio,r.fin,m.nombre AS muelle,m.almacen,m.zona_horaria FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id AND m.empresa_id=r.empresa_id WHERE r.empresa_id=$1 AND r.pedido_id=$2 AND r.tipo='carga' ORDER BY r.inicio`,[req.empresaId,req.params.id])).rows;
 const solicitudes=(await db.query('SELECT id,inicio,fin,estado,notas FROM planner_solicitudes_hueco WHERE empresa_id=$1 AND pedido_id=$2 AND colaborador_id=$3 ORDER BY created_at DESC LIMIT 10',[req.empresaId,req.params.id,req.user.colaborador_id])).rows;
 res.json({reservas,solicitudes});
}));
router.post('/pedidos/:id/hueco',plannerEnabled,wrap(async(req,res)=>{
 if(req.user.rol!=='colaborador')return res.status(403).json({error:'El responsable del transportista debe solicitar el hueco.'});
 res.status(201).json(await require('../services/plannerSupplierSlots').requestSlot(db,req.empresaId,req.user.colaborador_id,req.user.id,req.params.id,req.body));
}));
router.get('/pedidos/:id/albaran-salida',plannerEnabled,wrap(async(req,res)=>{
 if(!(await documentScope(req)).rows.length)return res.status(404).json({error:'Carga no encontrada'});
 const note=(await db.query('SELECT a.* FROM planner_albaranes a JOIN planner_preparaciones p ON p.id=a.preparacion_id AND p.empresa_id=a.empresa_id WHERE p.pedido_id=$1 AND p.empresa_id=$2',[req.params.id,req.empresaId])).rows[0];
 if(!note)return res.status(404).json({error:'El almacén todavía no ha generado el albarán.'});
 const pdf=await require('../services/plannerDeliveryPdf').deliveryPdf(note);res.json({nombre:`${note.numero}.pdf`,file_mime:'application/pdf',file_base64:pdf.toString('base64')});
}));
router.get('/vehiculos',wrap(async(req,res)=>res.json((await db.query('SELECT id,matricula,marca,modelo,tipo FROM colaborador_vehiculos WHERE empresa_id=$1 AND colaborador_id=$2 AND activo=true ORDER BY matricula',supplier(req))).rows)));
router.post('/vehiculos',wrap(async(req,res)=>{
 if(req.user.rol!=='colaborador')return res.status(403).json({error:'Solo el responsable del proveedor puede dar de alta vehículos'});
 const matricula=String(req.body.matricula||'').trim().toUpperCase(),tipo=String(req.body.tipo||'tractora');
 if(!/^[A-Z0-9 -]{3,20}$/.test(matricula)||!['tractora','remolque','rigido','furgoneta'].includes(tipo))return res.status(400).json({error:'Indica matrícula y tipo válidos'});
 const {rows}=await db.query('INSERT INTO colaborador_vehiculos(empresa_id,colaborador_id,matricula,tipo) VALUES($1,$2,$3,$4) RETURNING id,matricula,tipo',[...supplier(req),matricula,tipo]);res.status(201).json(rows[0]);
}));
router.get('/conductores',wrap(async(req,res)=>{
 if(req.user.rol!=='colaborador')return res.status(403).json({error:'Acceso reservado al responsable'});
 res.json((await db.query("SELECT id,nombre,email,activo FROM usuarios WHERE empresa_id=$1 AND colaborador_id=$2 AND rol='chofer' ORDER BY nombre",supplier(req))).rows);
}));
router.post('/conductores',wrap(async(req,res)=>{
 if(req.user.rol!=='colaborador')return res.status(403).json({error:'Acceso reservado al responsable'});
 const nombre=String(req.body.nombre||'').trim();if(nombre.length<2||nombre.length>120)return res.status(400).json({error:'Indica el nombre del conductor'});
 try{res.status(201).json(await require('../services/supplierInvitations').inviteSupplier({empresaId:req.empresaId,colaboradorId:req.user.colaborador_id,nombre,email:req.body.email,driver:true,actor:req.user.email}));}catch(e){res.status(e.status||500).json({error:e.message});}
}));
router.post('/pedidos/:id/conductor',wrap(async(req,res)=>{
 if(req.user.rol!=='colaborador')return res.status(403).json({error:'Acceso reservado al responsable'});
 const driver=(await db.query("SELECT id,nombre FROM usuarios WHERE id=$1 AND empresa_id=$2 AND colaborador_id=$3 AND rol='chofer'",[req.body.usuario_id,...supplier(req)])).rows[0];
 if(!driver)return res.status(404).json({error:'Conductor no encontrado'});
 const {rows}=await db.query("UPDATE pedidos SET conductor_proveedor_usuario_id=$1,conductor_colaborador=$2 WHERE id=$3 AND empresa_id=$4 AND colaborador_id=$5 AND estado::text NOT IN ('entregado','facturado','cancelado') RETURNING id",[driver.id,driver.nombre,req.params.id,...supplier(req)]);
 if(!rows.length)return res.status(404).json({error:'Pedido no disponible'});res.json({ok:true});
}));
module.exports=router;
