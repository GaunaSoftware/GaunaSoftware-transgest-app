const express=require('express'),db=require('../services/db');
const {requireRole,requireModulePermission}=require('../middleware/auth');
const router=express.Router();
const consent=require('../services/networkConsent');
const active="x.activo AND x.revocada_at IS NULL AND x.consentimiento_origen_at IS NOT NULL AND x.consentimiento_destino_at IS NOT NULL";
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.use(requireRole('gerente','trafico','administrativo'));
router.use(requireModulePermission('pedidos'));
router.use(async(req,res,next)=>{try{await require('../services/plannerSchema').ensurePlannerSchema();next();}catch(e){next(e);}});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});if(['22P02','23505'].includes(e.code))return res.status(409).json({error:'Identificador no válido o ya utilizado.'});next(e);}};
router.get('/catalogo',wrap(async(req,res)=>res.json({scopes:consent.catalog})));
router.get('/sugerencia',requireRole('gerente'),wrap(async(req,res)=>{const match=await consent.target(db,req.empresaId,req.query.colaborador_id);res.json({nombre:match.nombre,cif:match.cif,coincidencia:true,conectada:false});}));
router.post('/invitaciones',requireRole('gerente'),wrap(async(req,res)=>res.status(201).json(await consent.invite(db,req.empresaId,req.user.id,req.body))));
router.get('/invitaciones',requireRole('gerente'),wrap(async(req,res)=>res.json((await db.query(`SELECT n.id,n.scopes,n.created_at,n.expires_at,n.aceptada_at,n.revocada_at,p.numero,e.nombre AS destinatario FROM network_invitaciones n JOIN pedidos p ON p.id=n.pedido_id AND p.empresa_id=n.empresa_id JOIN empresas e ON e.id=n.transportista_empresa_id WHERE n.empresa_id=$1 ORDER BY n.created_at DESC LIMIT 100`,[req.empresaId])).rows)));
router.post('/previsualizar',requireRole('gerente'),wrap(async(req,res)=>res.json(await consent.preview(db,req.empresaId,req.user.id,req.body.token))));
router.delete('/invitaciones/:id',requireRole('gerente'),wrap(async(req,res)=>{
 await db.transaction(async tx=>{const n=(await tx.query('SELECT * FROM network_invitaciones WHERE id::text=$1 AND empresa_id=$2 FOR UPDATE',[req.params.id,req.empresaId])).rows[0];if(!n)throw Object.assign(Error('Invitación no encontrada.'),{status:404});if(n.aceptada_at)throw Object.assign(Error('Desactiva la conexión para revocar una invitación ya aceptada.'),{status:409});if(!n.revocada_at){await tx.query('UPDATE network_invitaciones SET revocada_at=now() WHERE id=$1',[n.id]);await consent.event(tx,req.empresaId,req.user.id,'invitacion.revocada',{invite:n.id});}});res.json({ok:true});
}));
router.get('/',wrap(async(req,res)=>res.json((await db.query(`SELECT x.id,(${active}) AS activo,x.scopes,x.consentimiento_version,x.revocada_at,x.empresa_id,x.transportista_empresa_id,e.nombre AS cargador,t.nombre AS transportista,x.created_at,
 (SELECT COUNT(*)::int FROM planner_viajes_compartidos v WHERE v.conexion_id=x.id) AS viajes
 FROM planner_conexiones_transporte x JOIN empresas e ON e.id=x.empresa_id JOIN empresas t ON t.id=x.transportista_empresa_id
 WHERE x.empresa_id=$1 OR x.transportista_empresa_id=$1 ORDER BY x.created_at DESC`,[req.empresaId])).rows)));
router.post('/conectar',requireRole('gerente'),wrap(async(req,res)=>{
 if(!req.user.productos?.includes('transgest')||['lite','basico','go','control'].includes(req.user.plan))return res.status(403).json({error:'La recepción en flota propia requiere TransGest Pro o superior.'});
 if(req.body.acepta_condiciones!==true)return res.status(400).json({error:'Confirma la aceptación del transporte y la conexión con el cargador.'});
 res.status(201).json(await require('../services/plannerExchange').connect(db,req.empresaId,req.user.id,req.body));
}));
router.post('/sincronizar',wrap(async(req,res)=>res.json(await require('../services/plannerExchange').synchronize(db,req.empresaId,req.user.id))));
router.delete('/:id',requireRole('gerente'),wrap(async(req,res)=>{
 res.json(await consent.revoke(db,req.empresaId,req.user.id,req.params.id));
}));
const relation=`planner_viajes_compartidos v JOIN planner_conexiones_transporte x ON x.id=v.conexion_id
 JOIN pedidos p ON p.id=v.pedido_id AND p.empresa_id=v.empresa_id AND p.colaborador_id=x.colaborador_id
 JOIN pedidos t ON t.id=v.viaje_id AND t.empresa_id=v.transportista_empresa_id
 JOIN empresas e ON e.id=v.empresa_id JOIN empresas carrier ON carrier.id=v.transportista_empresa_id
 JOIN colaboradores co ON co.id=x.colaborador_id AND co.empresa_id=x.empresa_id
 JOIN clientes cli ON cli.id=x.cliente_id AND cli.empresa_id=x.transportista_empresa_id
 LEFT JOIN empresa_productos ep ON ep.empresa_id=carrier.id`;
const live=`${active} AND x.scopes ? 'pedidos' AND e.estado IN ('activo','activa') AND carrier.estado IN ('activo','activa')
 AND carrier.plan IN ('profesional','enterprise','pro','pro_intelligence','pro_planner') AND COALESCE(ep.modalidad,'transgest')<>'planner'
 AND NULLIF(regexp_replace(upper(co.cif),'[^A-Z0-9]','','g'),'')=regexp_replace(upper(carrier.cif),'[^A-Z0-9]','','g')
 AND NULLIF(regexp_replace(upper(cli.cif),'[^A-Z0-9]','','g'),'')=regexp_replace(upper(e.cif),'[^A-Z0-9]','','g')`;
async function linkFor(tx,req,scope,owner=false){
 const where=owner?'v.pedido_id::text=$1 AND v.empresa_id=$2':'v.viaje_id::text=$1 AND v.transportista_empresa_id=$2';
 const row=(await tx.query(`SELECT v.*,x.scopes FROM ${relation} WHERE ${live} AND ${where} FOR SHARE OF x`,[req.params.id,req.empresaId])).rows[0];
 if(!row||!row.scopes.includes(scope))throw Object.assign(Error('Encargo o permiso de intercambio no disponible.'),{status:404});return row;
}
router.get('/enviados',wrap(async(req,res)=>res.json((await db.query(`SELECT p.id,p.numero,p.origen,p.destino,carrier.nombre AS transportista,x.scopes,v.external_reference FROM ${relation} WHERE ${live} AND v.empresa_id=$1 ORDER BY v.created_at DESC LIMIT 200`,[req.empresaId])).rows)));
router.get('/encargos',wrap(async(req,res)=>res.json((await db.query(`SELECT v.viaje_id,t.numero,p.numero AS referencia_cargador,e.nombre AS cargador,t.estado,p.fecha_carga,p.origen,p.destino,x.scopes,
 (x.scopes ? 'documentos' AND EXISTS(SELECT 1 FROM planner_preparaciones prep JOIN planner_albaranes a ON a.preparacion_id=prep.id AND a.empresa_id=prep.empresa_id WHERE prep.pedido_id=p.id AND prep.empresa_id=p.empresa_id AND prep.estado<>'cancelada')) AS albaran_disponible,
 CASE WHEN x.scopes ? 'slots' THEN (SELECT jsonb_build_object('inicio',r.inicio,'fin',r.fin,'muelle',m.nombre,'almacen',m.almacen,'zona_horaria',m.zona_horaria) FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id AND m.empresa_id=r.empresa_id WHERE r.empresa_id=p.empresa_id AND r.pedido_id=p.id AND r.tipo='carga' ORDER BY r.inicio LIMIT 1) END AS hueco,
 (x.scopes ? 'slots' AND EXISTS(SELECT 1 FROM planner_solicitudes_hueco h WHERE h.pedido_id=p.id AND h.empresa_id=p.empresa_id AND h.estado='pendiente')) AS hueco_pendiente
 FROM ${relation} WHERE ${live} AND v.transportista_empresa_id=$1 ORDER BY p.fecha_carga DESC LIMIT 200`,[req.empresaId])).rows)));
router.post('/viajes/:id/hueco',wrap(async(req,res)=>{
 const result=await db.transaction(async tx=>{const link=await linkFor(tx,req,'slots');const owner=(await tx.query(`SELECT e.plan,ep.modalidad FROM empresas e LEFT JOIN empresa_productos ep ON ep.empresa_id=e.id WHERE e.id=$1`,[link.empresa_id])).rows[0];if(!['planner','pro_planner'].includes(owner?.plan)&&!['planner','combinado'].includes(owner?.modalidad))throw Object.assign(Error('El remitente no tiene muelles Planner habilitados.'),{status:403});const order=(await tx.query('SELECT colaborador_id FROM pedidos WHERE id=$1 AND empresa_id=$2',[link.pedido_id,link.empresa_id])).rows[0];return require('../services/plannerSupplierSlots').requestSlot({query:(...a)=>tx.query(...a),transaction:fn=>fn(tx)},link.empresa_id,order.colaborador_id,req.user.id,link.pedido_id,req.body);});
 res.status(201).json(result);
}));
router.get('/viajes/:id/albaran',wrap(async(req,res)=>{
 const result=await db.transaction(async tx=>{
  const link=await linkFor(tx,req,'documentos');
  const doc=await require('../services/plannerDocumentation').latest(tx,link.empresa_id,link.pedido_id);
  if(!doc)throw Object.assign(Error('El albarán de salida no está disponible.'),{status:404});
  const pdf=doc.pdf?Buffer.from(doc.pdf):await require('../services/plannerDeliveryPdf').deliveryPdf(doc);
  await consent.event(tx,req.empresaId,req.user.id,'albaran.consultado',{link:link.conexion_id,data:{documento:doc.id,version:doc.version||0}});
  return {nombre:doc.numero+'.pdf',version:doc.version||0,file_mime:'application/pdf',file_base64:pdf.toString('base64')};
 });res.json(result);
}));
router.get('/seguimiento/:id',wrap(async(req,res)=>{
 const result=await db.transaction(async tx=>{
  const link=await linkFor(tx,req,'pedidos',true),order=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2',[link.viaje_id,link.transportista_empresa_id])).rows[0];
  const operational=['espera_carga','cargando','en_curso','espera_descarga','descarga','incidencia'].includes(order.estado);
  const state=operational&&(link.scopes.includes('gps')||link.scopes.includes('eta'))?await require('../services/vehicleTracking').snapshot(tx,link.transportista_empresa_id,order):null;
  let eta={value:null,status:'sin_datos',reason:'El transportista no ha calculado una ETA por carretera vigente.'};
  if(link.scopes.includes('eta')&&state?.status==='reciente'){
   const cached=(await tx.query('SELECT eta FROM tracking_eta_snapshot WHERE empresa_id=$1 AND pedido_id=$2 AND position_recorded_at=$3',[link.transportista_empresa_id,order.id,state.last_recorded_at])).rows[0];if(cached?.eta?.value&&Date.parse(cached.eta.value)>Date.now())eta=cached.eta;
  }
  await consent.event(tx,req.empresaId,req.user.id,'seguimiento.consultado',{link:link.conexion_id,data:{pedido_id:link.pedido_id,scopes:link.scopes.filter(s=>['gps','eta','estados'].includes(s))}});
  return {pedido_id:link.pedido_id,scopes:link.scopes,...(link.scopes.includes('estados')?{estado:order.estado}:{}),...(link.scopes.includes('gps')?{gps:{status:state?.status||'fuera_de_servicio',position:state?.position||null,recorded_at:state?.last_recorded_at||null}}:{}),...(link.scopes.includes('eta')?{eta}:{})};
 });res.json(result);
}));
router.get('/auditoria/:id',requireRole('gerente'),wrap(async(req,res)=>{
 const link=(await db.query('SELECT id FROM planner_conexiones_transporte WHERE id::text=$1 AND (empresa_id=$2 OR transportista_empresa_id=$2)',[req.params.id,req.empresaId])).rows[0];if(!link)return res.status(404).json({error:'Conexión no encontrada.'});
 res.json({limite:100,datos:(await db.query('SELECT tipo,datos,created_at FROM network_eventos WHERE conexion_id=$1 ORDER BY created_at DESC LIMIT 100',[link.id])).rows});
}));
router.get('/facturacion/:id',requireRole('gerente'),requireModulePermission('facturacion'),wrap(async(req,res)=>res.json(await require('../services/networkBilling').list(db,req.empresaId,req.params.id))));
router.post('/facturacion/:id/consentimiento',requireRole('gerente'),requireModulePermission('facturacion'),wrap(async(req,res)=>res.json(await require('../services/networkBilling').authorize(db,req.empresaId,req.user.id,req.params.id,req.body.autorizar))));
router.post('/facturacion/:id/compartir',requireRole('gerente'),requireModulePermission('facturacion'),wrap(async(req,res)=>res.status(201).json(await require('../services/networkBilling').send(db,req.empresaId,req.user.id,req.params.id,req.body))));
module.exports=router;
