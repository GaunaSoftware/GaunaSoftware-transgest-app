const router=require('express').Router(),db=require('../services/db'),wms=require('../services/plannerWms');
const {requireRole,requireModulePermission}=require('../middleware/auth');
router.use(requireRole('gerente','trafico','administrativo'));
router.use(requireModulePermission('palets'));
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});if(e.code==='23505')return res.status(409).json({error:'Ya existe ese código o referencia.'});if(['22007','22008','22P02'].includes(e.code))return res.status(400).json({error:'Revisa los identificadores, cantidades y fechas.'});next(e);}};
router.get('/',wrap(async(req,res)=>{
 const company=req.empresaId;
 res.json({
 ubicaciones:(await db.query('SELECT * FROM planner_ubicaciones WHERE empresa_id=$1 ORDER BY almacen,codigo LIMIT 500',[company])).rows,
 recepciones:(await db.query('SELECT * FROM planner_asn WHERE empresa_id=$1 ORDER BY created_at DESC LIMIT 200',[company])).rows,
 conteos:(await db.query(`SELECT c.*,a.referencia,e.almacen,e.ubicacion,e.lote FROM planner_conteos c JOIN planner_existencias e ON e.id=c.existencia_id AND e.empresa_id=c.empresa_id JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id WHERE c.empresa_id=$1 ORDER BY c.created_at DESC LIMIT 200`,[company])).rows,
 packs:(await db.query(`SELECT b.id,b.sscc,b.preparacion_id,b.lineas,b.created_at,p.numero FROM planner_bultos_sscc b JOIN planner_preparaciones r ON r.id=b.preparacion_id AND r.empresa_id=b.empresa_id JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id WHERE b.empresa_id=$1 ORDER BY b.created_at DESC LIMIT 200`,[company])).rows,
 movimientos:(await db.query('SELECT operacion,tipo,datos,created_at FROM planner_wms_operaciones WHERE empresa_id=$1 ORDER BY created_at DESC LIMIT 100',[company])).rows,
 limites:{ubicaciones:500,recepciones:200,conteos:200,packs:200,movimientos:100}
 });
}));
router.post('/accion',wrap(async(req,res)=>res.status(201).json(await wms.act(db,req.empresaId,req.user.id,req.body))));
router.get('/automatismos',wrap(async(req,res)=>res.json(await require('../services/plannerAutomation').list(db,req.empresaId))));
router.get('/muelles-propuestos',wrap(async(req,res)=>res.json(await require('../services/plannerAutomation').docks(db,req.empresaId,req.query))));
router.post('/gs1',wrap(async(req,res)=>res.json(wms.parseGs1(req.body.codigo))));
router.get('/reservas/:id/etiqueta',wrap(async(req,res)=>{
 const row=(await db.query("SELECT r.id,p.numero FROM planner_reservas r JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id WHERE r.id::text=$1 AND r.empresa_id=$2 AND r.tipo='carga'",[req.params.id,req.empresaId])).rows[0];
 if(!row)return res.status(404).json({error:'Reserva no encontrada.'});
 const contenido='TG-CHECKIN:'+row.id;
 res.json({id:row.id,titulo:'Llegada · '+row.numero,contenido,qr:await require('qrcode').toDataURL(contenido),aviso:'Código de reserva. Requiere acceso autorizado al almacén y confirmación de llegada; no es un enlace de acceso público.'});
}));
router.get('/propuesta',wrap(async(req,res)=>res.json(await wms.suggest(db,req.empresaId,req.query.articulo_id,req.query.metodo))));
router.get('/kpis',wrap(async(req,res)=>{
 const {desde,hasta}=req.query;if(!/^\d{4}-\d{2}-\d{2}$/.test(desde||'')||!/^\d{4}-\d{2}-\d{2}$/.test(hasta||'')||desde>hasta)return res.status(400).json({error:'Selecciona un periodo válido.'});
 const timings=(await db.query(`SELECT COUNT(*)::int AS muestra,AVG(EXTRACT(EPOCH FROM(carga_fin_at-carga_inicio_at))/60) AS media_min,
 percentile_cont(0.5) WITHIN GROUP(ORDER BY EXTRACT(EPOCH FROM(carga_fin_at-carga_inicio_at))/60) AS mediana_min,
 percentile_cont(0.9) WITHIN GROUP(ORDER BY EXTRACT(EPOCH FROM(carga_fin_at-carga_inicio_at))/60) AS p90_min
 FROM planner_preparaciones WHERE empresa_id=$1 AND estado<>'cancelada' AND carga_fin_at>carga_inicio_at
 AND carga_fin_at>=($2::date::timestamp AT TIME ZONE 'Europe/Madrid') AND carga_fin_at<(($3::date+1)::timestamp AT TIME ZONE 'Europe/Madrid')`,[req.empresaId,desde,hasta])).rows[0];
 const stock=(await db.query(`SELECT a.unidad,COUNT(*)::int AS lotes,SUM(e.cantidad) AS cantidad,SUM(e.reservado) AS reservado,
 SUM(e.cantidad) FILTER(WHERE e.calidad='pendiente') AS calidad_pendiente,SUM(e.cantidad) FILTER(WHERE e.calidad='bloqueado') AS bloqueado,
 COUNT(*) FILTER(WHERE e.calidad IS NULL)::int AS lotes_sin_revision FROM planner_existencias e JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id WHERE e.empresa_id=$1 GROUP BY a.unidad ORDER BY a.unidad`,[req.empresaId])).rows;
 res.json({periodo:{desde,hasta,zona:'Europe/Madrid'},generado:new Date().toISOString(),carga:{...timings,cobertura:timings.muestra?'parcial':'sin_datos',definicion:'Minutos entre inicio y fin registrados, por fecha real de finalización. Solo preparaciones con ambos eventos.'},stock:{datos:stock,fecha_corte:new Date().toISOString(),definicion:'Existencias actuales por unidad; no es el saldo histórico del periodo ni suma unidades incompatibles.'}});
}));
router.get('/packs/:id/etiqueta',wrap(async(req,res)=>{
 const row=(await db.query('SELECT sscc FROM planner_bultos_sscc WHERE id::text=$1 AND empresa_id=$2',[req.params.id,req.empresaId])).rows[0];if(!row)return res.status(404).json({error:'Unidad logística no encontrada.'});
 res.json({sscc:row.sscc,contenido:'(00)'+row.sscc,qr:await require('qrcode').toDataURL('(00)'+row.sscc),aviso:'SSCC facilitado por la empresa. La aplicación verifica el dígito de control, no la titularidad del prefijo GS1.'});
}));
module.exports=router;
