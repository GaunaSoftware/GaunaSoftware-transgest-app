const router=require('express').Router(),db=require('../services/db');
const {requireRole,requireModulePermission}=require('../middleware/auth');
const loading=require('../services/plannerLoading');
router.use(requireRole('gerente','trafico','administrativo','carretillero'));
router.use((req,res,next)=>{
 if(!require('../services/companyProducts').moduleAvailable(req.user.productos,'planner'))return res.status(403).json({error:'Planner no está habilitado.',code:'PRODUCT_NOT_ENABLED'});
 if(req.user.rol==='carretillero')return next();
 return requireModulePermission('palets')(req,res,next);
});
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message,code:e.code});next(e);}};
router.get('/operarios',requireRole('gerente','trafico','administrativo'),wrap(async(req,res)=>res.json((await db.query("SELECT id,nombre FROM usuarios WHERE empresa_id=$1 AND rol='carretillero' AND activo=true ORDER BY nombre",[req.empresaId])).rows)));
router.get('/politicas',requireRole('gerente','trafico','administrativo'),wrap(async(req,res)=>res.json({
 politicas:(await db.query('SELECT ambito,billing_trigger FROM planner_facturacion_politicas WHERE empresa_id=$1',[req.empresaId])).rows,
 clientes:(await db.query('SELECT id,nombre FROM clientes WHERE empresa_id=$1 ORDER BY nombre LIMIT 500',[req.empresaId])).rows
})));
router.post('/politicas',requireRole('gerente'),wrap(async(req,res)=>{
 const {ambito,billing_trigger}=req.body;
 if(!['departure','delivery'].includes(billing_trigger))return res.status(400).json({error:'Hito de facturación no válido.'});
 if(ambito!=='empresa'&&!(await db.query('SELECT id FROM clientes WHERE empresa_id=$1 AND id::text=$2',[req.empresaId,String(ambito)])).rows.length)return res.status(404).json({error:'Cliente no encontrado.'});
 await db.transaction(async tx=>{
  await tx.query('INSERT INTO planner_facturacion_politicas(empresa_id,ambito,billing_trigger,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(empresa_id,ambito) DO UPDATE SET billing_trigger=EXCLUDED.billing_trigger,updated_by=EXCLUDED.updated_by,updated_at=now()',[req.empresaId,ambito,billing_trigger,req.user.id]);
  await tx.query("INSERT INTO planner_eventos(empresa_id,tipo,datos,created_by) VALUES($1,'facturacion.politica',$2,$3)",[req.empresaId,JSON.stringify({ambito,billing_trigger}),req.user.id]);
 });res.json({ok:true});
}));
router.get('/',wrap(async(req,res)=>{
 const page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1));
 const rows=(await db.query(`SELECT r.id,p.numero,p.fecha_carga,r.estado,r.situacion_camion,r.carretillero_id,r.incidencia,r.documentos_listos_at,r.entrega_confirmada_at,
 COUNT(*) OVER()::int AS total FROM planner_preparaciones r JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id
 WHERE r.empresa_id=$1 AND ($2::boolean OR r.carretillero_id=$3) AND r.estado<>'cancelada' AND r.entrega_confirmada_at IS NULL ORDER BY r.created_at DESC,r.id LIMIT 50 OFFSET $4`,[req.empresaId,loading.office(req.user),req.user.id,(page-1)*50])).rows;
 res.json({data:rows.map(p=>({...p,estado_operativo:loading.state(p)})),page,total:rows[0]?.total||0});
}));
router.get('/:id',wrap(async(req,res)=>res.json(await loading.detail(db,req.empresaId,req.user,req.params.id))));
router.post('/:id/accion',wrap(async(req,res)=>res.json(await loading.act(db,req.empresaId,req.user,req.params.id,req.body))));
module.exports=router;
