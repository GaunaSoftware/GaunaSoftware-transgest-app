const express = require('express');
const crypto = require('crypto');
const db = require('../services/db');
const {requireRole} = require('../middleware/auth');
const router = express.Router();
let schema;
router.use(requireRole('gerente','trafico','administrativo','visualizador'));
router.use(async(req,res,next)=>{
  try {
    if(!schema) schema=db.query(`CREATE TABLE IF NOT EXISTS planner_muelles(
      id UUID PRIMARY KEY,empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre VARCHAR(120) NOT NULL,almacen VARCHAR(160) NOT NULL,
      UNIQUE(empresa_id,almacen,nombre));
      CREATE TABLE IF NOT EXISTS planner_reservas(
      id UUID PRIMARY KEY,empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      muelle_id UUID NOT NULL REFERENCES planner_muelles(id),pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
      inicio TIMESTAMPTZ NOT NULL,fin TIMESTAMPTZ NOT NULL,tipo VARCHAR(16) NOT NULL,
      notas TEXT,created_by UUID REFERENCES usuarios(id),CHECK(fin>inicio));
      CREATE INDEX IF NOT EXISTS planner_reservas_fecha ON planner_reservas(empresa_id,inicio,fin);`).catch(e=>{schema=null;throw e;});
    await schema;next();
  }catch(e){next(e);}
});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
const write=requireRole('gerente','trafico','administrativo');
router.get('/muelles',wrap(async(req,res)=>res.json((await db.query('SELECT * FROM planner_muelles WHERE empresa_id=$1 ORDER BY almacen,nombre',[req.empresaId])).rows)));
router.post('/muelles',write,wrap(async(req,res)=>{
  const nombre=String(req.body.nombre||'').trim(),almacen=String(req.body.almacen||'').trim();
  if(!nombre||nombre.length>120||!almacen||almacen.length>160)return res.status(400).json({error:'Indica el almacén y el nombre del muelle'});
  const {rows}=await db.query('INSERT INTO planner_muelles(id,empresa_id,nombre,almacen) VALUES($1,$2,$3,$4) ON CONFLICT(empresa_id,almacen,nombre) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING *',[crypto.randomUUID(),req.empresaId,nombre,almacen]);
  res.status(201).json(rows[0]);
}));
router.get('/reservas',wrap(async(req,res)=>{
  const desde=new Date(req.query.desde),hasta=new Date(req.query.hasta);
  if(!Number.isFinite(+desde)||!Number.isFinite(+hasta)||hasta<=desde||hasta-desde>32*86400000)return res.status(400).json({error:'Selecciona un periodo de hasta 31 días'});
  const {rows}=await db.query(`SELECT r.*,m.nombre AS muelle,m.almacen,p.numero,p.estado,p.origen,p.destino,
    c.nombre AS colaborador FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id
    LEFT JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id
    LEFT JOIN colaboradores c ON c.id=p.colaborador_id AND c.empresa_id=r.empresa_id
    WHERE r.empresa_id=$1 AND r.inicio<$3 AND r.fin>$2 ORDER BY r.inicio`,[req.empresaId,desde,hasta]);res.json(rows);
}));
router.post('/reservas',write,wrap(async(req,res)=>{
  const {muelle_id,pedido_id,tipo}=req.body,inicio=new Date(req.body.inicio),fin=new Date(req.body.fin),notas=String(req.body.notas||'').trim();
  if(!['carga','descarga'].includes(tipo)||!Number.isFinite(+inicio)||!Number.isFinite(+fin)||fin<=inicio||fin-inicio>86400000||notas.length>2000)return res.status(400).json({error:'Indica carga o descarga y un horario válido de hasta 24 horas'});
  const result=await db.transaction(async tx=>{
    // Serialize reservations per dock so simultaneous submissions cannot overlap.
    const dock=await tx.query('SELECT id FROM planner_muelles WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[muelle_id,req.empresaId]);
    if(!dock.rows.length)throw Object.assign(new Error('Muelle no encontrado'),{status:404});
    if(pedido_id){const order=await tx.query('SELECT id FROM pedidos WHERE id=$1 AND empresa_id=$2',[pedido_id,req.empresaId]);if(!order.rows.length)throw Object.assign(new Error('Pedido no encontrado'),{status:404});}
    const overlap=await tx.query('SELECT id FROM planner_reservas WHERE muelle_id=$1 AND empresa_id=$2 AND inicio<$4 AND fin>$3',[muelle_id,req.empresaId,inicio,fin]);
    if(overlap.rows.length)throw Object.assign(new Error('El muelle ya está reservado en ese horario. Selecciona otro hueco.'),{status:409});
    return (await tx.query('INSERT INTO planner_reservas(id,empresa_id,muelle_id,pedido_id,inicio,fin,tipo,notas,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[crypto.randomUUID(),req.empresaId,muelle_id,pedido_id||null,inicio,fin,tipo,notas,req.user.id])).rows[0];
  });res.status(201).json(result);
}));
router.delete('/reservas/:id',write,wrap(async(req,res)=>{
  const {rows}=await db.query('DELETE FROM planner_reservas WHERE id=$1 AND empresa_id=$2 RETURNING id',[req.params.id,req.empresaId]);
  if(!rows.length)return res.status(404).json({error:'Reserva no encontrada'});res.json({ok:true});
}));
module.exports=router;
