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
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
const write=requireRole('gerente','trafico','administrativo');
router.get('/resumen',wrap(async(req,res)=>{
 const month=String(req.query.mes||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:'Selecciona un mes válido.'});
 res.json((await db.query(`SELECT COUNT(*)::int AS cargas,COUNT(*) FILTER(WHERE colaborador_id IS NULL AND vehiculo_id IS NULL)::int AS sin_asignar,
 COUNT(*) FILTER(WHERE colaborador_precio_confirmado)::int AS aceptadas,COUNT(*) FILTER(WHERE estado::text='incidencia')::int AS incidencias
 FROM pedidos WHERE empresa_id=$1 AND fecha_carga >= $2::date AND fecha_carga < $2::date+INTERVAL '1 month'`,[req.empresaId,month+'-01'])).rows[0]);
}));
router.get('/muelles',wrap(async(req,res)=>res.json((await db.query('SELECT * FROM planner_muelles WHERE empresa_id=$1 ORDER BY almacen,nombre',[req.empresaId])).rows)));
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
router.get('/solicitudes-hueco',wrap(async(req,res)=>res.json((await db.query(`SELECT s.*,p.numero,p.origen,p.destino,c.nombre AS colaborador
 FROM planner_solicitudes_hueco s JOIN pedidos p ON p.id=s.pedido_id AND p.empresa_id=s.empresa_id JOIN colaboradores c ON c.id=s.colaborador_id AND c.empresa_id=s.empresa_id
 WHERE s.empresa_id=$1 AND s.estado='pendiente' ORDER BY s.inicio LIMIT 200`,[req.empresaId])).rows)));
router.get('/reservas',wrap(async(req,res)=>{
  const desde=new Date(req.query.desde),hasta=new Date(req.query.hasta);
  if(!Number.isFinite(+desde)||!Number.isFinite(+hasta)||hasta<=desde||hasta-desde>32*86400000)return res.status(400).json({error:'Selecciona un periodo de hasta 31 días'});
  const {rows}=await db.query(`SELECT r.*,m.nombre AS muelle,m.almacen,p.numero,p.estado,p.origen,p.destino,
    c.nombre AS colaborador FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id
    LEFT JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id
    LEFT JOIN colaboradores c ON c.id=p.colaborador_id AND c.empresa_id=r.empresa_id
    WHERE r.empresa_id=$1 AND r.inicio<$3 AND r.fin>$2 ORDER BY r.inicio`,[req.empresaId,desde,hasta]);res.json(rows);
}));
router.post('/reservas',write,wrap(async(req,res)=>res.status(201).json(await require('../services/plannerBooking').reserve(db,req.empresaId,req.user.id,req.body))));
router.delete('/reservas/:id',write,wrap(async(req,res)=>{
  const {rows}=await db.transaction(async tx=>{await tx.query("UPDATE planner_solicitudes_hueco SET reserva_id=NULL,estado='pendiente' WHERE reserva_id=$1 AND empresa_id=$2",[req.params.id,req.empresaId]);return tx.query('DELETE FROM planner_reservas WHERE id=$1 AND empresa_id=$2 RETURNING id',[req.params.id,req.empresaId]);});
  if(!rows.length)return res.status(404).json({error:'Reserva no encontrada'});res.json({ok:true});
}));
router.use('/vehiculos-autorizados',require('./planner_vehicles'));
router.use('/inventario',require('./planner_inventory'));
module.exports=router;
