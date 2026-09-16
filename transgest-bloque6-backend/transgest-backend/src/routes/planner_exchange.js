const express=require('express'),db=require('../services/db');
const {requireRole,requireModulePermission}=require('../middleware/auth');
const router=express.Router();
router.use(requireRole('gerente','trafico','administrativo'));
router.use(requireModulePermission('pedidos'));
router.use(async(req,res,next)=>{try{await require('../services/plannerSchema').ensurePlannerSchema();next();}catch(e){next(e);}});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
router.get('/',wrap(async(req,res)=>res.json((await db.query(`SELECT x.id,x.activo,x.empresa_id,x.transportista_empresa_id,e.nombre AS cargador,t.nombre AS transportista,x.created_at,
 (SELECT COUNT(*)::int FROM planner_viajes_compartidos v WHERE v.conexion_id=x.id) AS viajes
 FROM planner_conexiones_transporte x JOIN empresas e ON e.id=x.empresa_id JOIN empresas t ON t.id=x.transportista_empresa_id
 WHERE x.empresa_id=$1 OR x.transportista_empresa_id=$1 ORDER BY x.created_at DESC`,[req.empresaId])).rows)));
router.post('/conectar',requireRole('gerente'),wrap(async(req,res)=>{
 if(!req.user.productos?.includes('transgest')||['lite','basico','go','control'].includes(req.user.plan))return res.status(403).json({error:'La recepción en flota propia requiere TransGest Pro o superior.'});
 if(req.body.acepta_condiciones!==true)return res.status(400).json({error:'Confirma la aceptación del transporte y la conexión con el cargador.'});
 res.status(201).json(await require('../services/plannerExchange').connect(db,req.empresaId,req.user.id,req.body));
}));
router.post('/sincronizar',wrap(async(req,res)=>res.json(await require('../services/plannerExchange').synchronize(db,req.empresaId))));
router.delete('/:id',requireRole('gerente'),wrap(async(req,res)=>{
 const row=(await db.query('UPDATE planner_conexiones_transporte SET activo=false WHERE id=$1 AND (empresa_id=$2 OR transportista_empresa_id=$2) RETURNING id',[req.params.id,req.empresaId])).rows[0];
 if(!row)return res.status(404).json({error:'Conexión no encontrada'});res.json({ok:true});
}));
router.get('/encargos',wrap(async(req,res)=>res.json((await db.query(`SELECT v.viaje_id,t.numero,p.numero AS referencia_cargador,e.nombre AS cargador,t.estado,p.fecha_carga,p.origen,p.destino,
 EXISTS(SELECT 1 FROM planner_preparaciones prep JOIN planner_albaranes a ON a.preparacion_id=prep.id AND a.empresa_id=prep.empresa_id WHERE prep.pedido_id=p.id AND prep.empresa_id=p.empresa_id AND prep.estado<>'cancelada') AS albaran_disponible,
 (SELECT jsonb_build_object('inicio',r.inicio,'fin',r.fin,'muelle',m.nombre,'almacen',m.almacen,'zona_horaria',m.zona_horaria) FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id AND m.empresa_id=r.empresa_id WHERE r.empresa_id=p.empresa_id AND r.pedido_id=p.id AND r.tipo='carga' ORDER BY r.inicio LIMIT 1) AS hueco,
 EXISTS(SELECT 1 FROM planner_solicitudes_hueco h WHERE h.pedido_id=p.id AND h.empresa_id=p.empresa_id AND h.estado='pendiente') AS hueco_pendiente
 FROM planner_viajes_compartidos v JOIN planner_conexiones_transporte x ON x.id=v.conexion_id AND x.activo JOIN pedidos p ON p.id=v.pedido_id AND p.empresa_id=v.empresa_id AND p.colaborador_id=x.colaborador_id
 JOIN pedidos t ON t.id=v.viaje_id AND t.empresa_id=v.transportista_empresa_id JOIN empresas e ON e.id=v.empresa_id
 WHERE v.transportista_empresa_id=$1 ORDER BY p.fecha_carga DESC LIMIT 200`,[req.empresaId])).rows)));
router.post('/viajes/:id/hueco',wrap(async(req,res)=>{
 const link=(await db.query(`SELECT v.empresa_id,v.pedido_id,x.colaborador_id FROM planner_viajes_compartidos v JOIN planner_conexiones_transporte x ON x.id=v.conexion_id AND x.activo
 WHERE v.viaje_id=$1 AND v.transportista_empresa_id=$2`,[req.params.id,req.empresaId])).rows[0];
 if(!link)return res.status(404).json({error:'Encargo no encontrado'});
 res.status(201).json(await require('../services/plannerSupplierSlots').requestSlot(db,link.empresa_id,link.colaborador_id,req.user.id,link.pedido_id,req.body));
}));
router.get('/viajes/:id/albaran',wrap(async(req,res)=>{
 const row=(await db.query(`SELECT a.* FROM planner_viajes_compartidos v JOIN planner_conexiones_transporte x ON x.id=v.conexion_id AND x.activo
 JOIN pedidos p ON p.id=v.pedido_id AND p.empresa_id=v.empresa_id AND p.colaborador_id=x.colaborador_id
 JOIN planner_preparaciones prep ON prep.pedido_id=p.id AND prep.empresa_id=p.empresa_id AND prep.estado<>'cancelada'
 JOIN planner_albaranes a ON a.preparacion_id=prep.id AND a.empresa_id=prep.empresa_id
 WHERE v.viaje_id=$1 AND v.transportista_empresa_id=$2`,[req.params.id,req.empresaId])).rows[0];
 if(!row)return res.status(404).json({error:'El albarán de salida no está disponible.'});
 const pdf=await require('../services/plannerDeliveryPdf').deliveryPdf(row);res.json({nombre:row.numero+'.pdf',file_mime:'application/pdf',file_base64:pdf.toString('base64')});
}));
module.exports=router;
