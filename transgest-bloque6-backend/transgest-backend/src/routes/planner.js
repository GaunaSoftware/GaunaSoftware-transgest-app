const express = require('express');
const crypto = require('crypto');
const db = require('../services/db');
const {requireRole} = require('../middleware/auth');
const router = express.Router();
router.use((req,res,next)=>{
  if (!require('../services/companyProducts').moduleAvailable(req.user?.productos,'planner')) return res.status(403).json({error:'Planner no está habilitado para tu empresa. Contacta con el administrador.',code:'PRODUCT_NOT_ENABLED'});
  next();
});
router.use(requireRole('gerente','trafico','administrativo','contable','visualizador'));
router.use(async(req,res,next)=>{try{await require('../services/plannerSchema').ensurePlannerSchema();next();}catch(e){next(e);}});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res,next);}catch(e){if(e.status)return res.status(e.status).json({error:e.message,code:e.code,requiere_confirmacion:e.requiere_confirmacion});next(e);}};
const write=requireRole('gerente','trafico','administrativo');
router.get('/resumen',wrap(async(req,res)=>{
 const month=String(req.query.mes||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:'Selecciona un mes válido.'});
 res.json((await db.query(`SELECT COUNT(*)::int AS cargas,COUNT(*) FILTER(WHERE colaborador_id IS NULL AND vehiculo_id IS NULL)::int AS sin_asignar,
 COUNT(*) FILTER(WHERE colaborador_precio_confirmado)::int AS aceptadas,COUNT(*) FILTER(WHERE estado::text='incidencia')::int AS incidencias
 FROM pedidos WHERE empresa_id=$1 AND origen_producto='planner' AND fecha_carga >= $2::date AND fecha_carga < $2::date+INTERVAL '1 month'`,[req.empresaId,month+'-01'])).rows[0]);
}));
router.get('/muelles',wrap(async(req,res)=>res.json((await db.query(`SELECT m.*,s.media_min,s.muestras FROM planner_muelles m LEFT JOIN LATERAL (
 SELECT ROUND(AVG(EXTRACT(EPOCH FROM(pp.carga_fin_at-pp.carga_inicio_at))/60))::int AS media_min,COUNT(*)::int AS muestras
 FROM planner_preparaciones pp WHERE pp.empresa_id=m.empresa_id AND pp.estado<>'cancelada' AND pp.carga_fin_at>pp.carga_inicio_at
 AND pp.muelle_carga_id=m.id
 ) s ON true WHERE m.empresa_id=$1 ORDER BY m.almacen,m.nombre`,[req.empresaId])).rows)));
router.post('/muelles',write,wrap(async(req,res)=>{
 const d=require('../services/plannerBooking').dockFields(req.body);
 const values=[crypto.randomUUID(),req.empresaId,...Object.values(d)];
 const row=(await db.query(`INSERT INTO planner_muelles(id,empresa_id,nombre,almacen,activo,horario_inicio,horario_fin,dias,capacidad,duracion_min,margen_min,zona_horaria)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,values)).rows[0];res.status(201).json(row);
}));
router.put('/muelles/:id',write,wrap(async(req,res)=>{
 const d=require('../services/plannerBooking').dockFields(req.body);
 const row=(await db.query(`UPDATE planner_muelles SET nombre=$3,almacen=$4,activo=$5,horario_inicio=$6,horario_fin=$7,dias=$8,capacidad=$9,duracion_min=$10,margen_min=$11,zona_horaria=$12
 WHERE id=$1 AND empresa_id=$2 RETURNING *`,[req.params.id,req.empresaId,...Object.values(d)])).rows[0];
 if(!row)return res.status(404).json({error:'Muelle no encontrado'});res.json(row);
}));
router.get('/solicitudes-hueco',wrap(async(req,res)=>res.json((await db.query(`SELECT p.id AS pedido_id,s.id AS solicitud_id,p.numero,p.origen,p.destino,p.fecha_carga,p.bultos,p.peso_kg,
 s.inicio,s.fin,s.notas,c.nombre AS colaborador,cl.nombre AS cliente,p.colaborador_precio_confirmado
 FROM pedidos p LEFT JOIN planner_solicitudes_hueco s ON s.pedido_id=p.id AND s.empresa_id=p.empresa_id AND s.estado='pendiente'
 LEFT JOIN colaboradores c ON c.id=p.colaborador_id AND c.empresa_id=p.empresa_id LEFT JOIN clientes cl ON cl.id=p.cliente_id AND cl.empresa_id=p.empresa_id
 WHERE p.empresa_id=$1 AND p.origen_producto='planner' AND p.estado::text NOT IN ('cancelado','entregado','facturado')
 AND NOT EXISTS(SELECT 1 FROM planner_reservas r WHERE r.pedido_id=p.id AND r.empresa_id=p.empresa_id AND r.tipo='carga')
 ORDER BY p.fecha_carga NULLS LAST,p.numero LIMIT 500`,[req.empresaId])).rows)));
router.get('/reservas',wrap(async(req,res)=>{
  const desde=new Date(req.query.desde),hasta=new Date(req.query.hasta);
  if(!Number.isFinite(+desde)||!Number.isFinite(+hasta)||hasta<=desde||hasta-desde>32*86400000)return res.status(400).json({error:'Selecciona un periodo de hasta 31 días'});
  const {rows}=await db.query(`SELECT r.*,m.nombre AS muelle,m.almacen,p.numero,p.estado,p.origen,p.destino,
    c.nombre AS colaborador,cl.nombre AS cliente,pp.situacion_camion,pp.carga_inicio_at,pp.carga_fin_at FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id
    LEFT JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id
    LEFT JOIN colaboradores c ON c.id=p.colaborador_id AND c.empresa_id=r.empresa_id
    LEFT JOIN clientes cl ON cl.id=p.cliente_id AND cl.empresa_id=r.empresa_id
    LEFT JOIN planner_preparaciones pp ON pp.pedido_id=p.id AND pp.empresa_id=r.empresa_id AND pp.estado<>'cancelada'
    WHERE r.empresa_id=$1 AND r.inicio<$3 AND r.fin>$2 ORDER BY r.inicio`,[req.empresaId,desde,hasta]);res.json(rows);
}));
router.post('/reservas',write,wrap(async(req,res)=>res.status(201).json(await require('../services/plannerBooking').reserve(db,req.empresaId,req.user.id,req.body))));
router.delete('/reservas/:id',write,wrap(async(req,res)=>{
  const {rows}=await db.transaction(async tx=>{await tx.query("UPDATE planner_solicitudes_hueco SET reserva_id=NULL,estado='pendiente' WHERE reserva_id=$1 AND empresa_id=$2",[req.params.id,req.empresaId]);return tx.query('DELETE FROM planner_reservas WHERE id=$1 AND empresa_id=$2 RETURNING id',[req.params.id,req.empresaId]);});
  if(!rows.length)return res.status(404).json({error:'Reserva no encontrada'});res.json({ok:true});
}));
router.use('/proveedores',require('./planner_providers'));
router.use('/vehiculos-autorizados',require('./planner_vehicles'));
router.use('/inventario',require('./planner_inventory'));
// Reuse reviewed invoice operations, never the unrestricted TMS finance dashboard.
router.use('/facturas',requireRole('gerente','contable','administrativo'),wrap(async(req,res,next)=>{
 const match=req.path.match(/^\/([0-9a-f-]{36})(?:\/(revision|estado))?\/?$/i);
 const list=req.method==='GET' && req.path==='/';
 const rectify=req.method==='POST'&&req.path==='/'&&/^[0-9a-f-]{36}$/i.test(req.body.factura_original_id||'');
 if(rectify){
  const original=await db.query(`SELECT f.id FROM facturas f WHERE f.id=$1 AND f.empresa_id=$2 AND ${require('../services/invoiceWorkspace').plannerInvoiceSql('f')}`,[req.body.factura_original_id,req.empresaId]);
  if(!original.rows.length)return res.status(404).json({error:'Factura original de Planner no encontrada.'});
 }
 if(!list && !rectify && (!match || !((req.method==='GET'&&!match[2])||(req.method==='POST'&&match[2]==='revision')||(req.method==='PATCH'&&match[2]==='estado'))))return res.status(404).json({error:'Operación de facturación no disponible en Planner.'});
 if(match){
  const found=await db.query(`SELECT f.id FROM facturas f WHERE f.id=$1 AND f.empresa_id=$2 AND ${require('../services/invoiceWorkspace').plannerInvoiceSql('f')}`,[match[1],req.empresaId]);
  if(!found.rows.length)return res.status(404).json({error:'Factura de Planner no encontrada.'});
 }
 req.plannerInvoiceWorkspace=true;
 return require('./facturas')(req,res,next);
}));
module.exports=router;
