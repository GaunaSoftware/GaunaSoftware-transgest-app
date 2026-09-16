const express=require('express'),crypto=require('crypto'),db=require('../services/db');
const {requireRole}=require('../middleware/auth');
const inventory=require('../services/plannerInventory');
const {ensurePlannerSchema}=require('../services/plannerSchema');
const router=express.Router(),write=requireRole('gerente','trafico','administrativo');
router.use(async(req,res,next)=>{try{await ensurePlannerSchema();next();}catch(error){next(error);}});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){if(error.status)return res.status(error.status).json({error:error.message});if(error.code==='23505')return res.status(409).json({error:'La referencia o el registro ya existe. Actualiza la lista antes de repetir.'});next(error);}};
router.get('/articulos',wrap(async(req,res)=>{
 const rows=(await db.query(`SELECT a.*,COALESCE(SUM(e.cantidad),0) AS stock,COALESCE(SUM(e.reservado),0) AS reservado,
   COALESCE(SUM(e.cantidad-e.reservado),0) AS disponible FROM planner_articulos a
   LEFT JOIN planner_existencias e ON e.articulo_id=a.id AND e.empresa_id=a.empresa_id WHERE a.empresa_id=$1 GROUP BY a.id ORDER BY a.referencia`,[req.empresaId])).rows;
 res.json(rows);
}));
const articleBody=b=>{
 const out={referencia:inventory.text(b.referencia,80).toUpperCase(),descripcion:inventory.text(b.descripcion,240),familia:inventory.text(b.familia,100),unidad:inventory.text(b.unidad,20)||'unidad'};
 if(!out.referencia||!out.descripcion)throw inventory.fail('Indica la referencia y descripción del artículo.');
 if(!['unidad','kg','litro','palet','caja','metro'].includes(out.unidad))throw inventory.fail('Unidad no válida.');
 for(const key of ['coste','precio_venta','peso_kg','stock_minimo'])out[key]=inventory.decimal(b[key]??0);
 out.unidades_palet=inventory.decimal(b.unidades_palet??1,{positive:true});return out;
};
router.post('/articulos',write,wrap(async(req,res)=>{
 const a=articleBody(req.body);
 res.status(201).json((await db.query(`INSERT INTO planner_articulos(empresa_id,referencia,descripcion,familia,unidad,coste,precio_venta,peso_kg,stock_minimo,unidades_palet)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.empresaId,...Object.values(a)])).rows[0]);
}));
router.put('/articulos/:id',write,wrap(async(req,res)=>{
 const a=articleBody(req.body);
 const row=(await db.query(`UPDATE planner_articulos SET referencia=$3,descripcion=$4,familia=$5,unidad=$6,coste=$7,precio_venta=$8,peso_kg=$9,stock_minimo=$10,unidades_palet=$11,activo=$12,version=version+1
   WHERE id=$1 AND empresa_id=$2 AND version=$13 RETURNING *`,[req.params.id,req.empresaId,...Object.values(a),req.body.activo!==false,Number(req.body.version)])).rows[0];
 if(!row)throw inventory.fail('El artículo ha cambiado o no está disponible. Actualiza para continuar.',409);res.json(row);
}));
router.get('/stock',wrap(async(req,res)=>res.json((await db.query(`SELECT e.*,a.referencia,a.descripcion,a.familia,a.unidad,a.coste,a.precio_venta,a.peso_kg,a.unidades_palet,a.stock_minimo,a.activo,e.cantidad-e.reservado AS disponible
 FROM planner_existencias e JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id WHERE e.empresa_id=$1 ORDER BY a.referencia,e.almacen,e.ubicacion,e.lote`,[req.empresaId])).rows)));
router.get('/movimientos',wrap(async(req,res)=>res.json((await db.query(`SELECT m.*,a.referencia AS articulo_referencia,a.descripcion,e.almacen,e.ubicacion,e.lote,u.nombre AS usuario
 FROM planner_movimientos m JOIN planner_existencias e ON e.id=m.existencia_id AND e.empresa_id=m.empresa_id JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id
 LEFT JOIN usuarios u ON u.id=m.created_by AND u.empresa_id=m.empresa_id WHERE m.empresa_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 200`,[req.empresaId])).rows)));
router.post('/movimientos',write,wrap(async(req,res)=>res.status(201).json(await inventory.move(db,req.empresaId,req.user.id,req.body))));
router.get('/preparaciones',wrap(async(req,res)=>res.json((await db.query(`SELECT r.*,p.numero,p.cliente_id,p.fecha_carga,p.origen,p.destino,p.estado AS viaje_estado,p.puntos_descarga,p.colaborador_id,p.colaborador_precio_confirmado,
 p.matricula_colaborador,p.vehiculo_id,c.nombre AS cliente,co.nombre AS colaborador,
 (SELECT COUNT(*)::int FROM planner_preparacion_lineas l WHERE l.preparacion_id=r.id) AS lineas,
 (SELECT COUNT(*)::int FROM planner_preparacion_lineas l WHERE l.preparacion_id=r.id AND l.preparada) AS lineas_preparadas,
 (SELECT COALESCE(SUM(l.cantidad*l.precio_venta),0) FROM planner_preparacion_lineas l WHERE l.preparacion_id=r.id) AS venta,
 (SELECT COALESCE(SUM(l.cantidad*l.coste_unitario),0) FROM planner_preparacion_lineas l WHERE l.preparacion_id=r.id) AS coste
 FROM planner_preparaciones r JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id
 LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=r.empresa_id LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=r.empresa_id
 WHERE r.empresa_id=$1 ORDER BY r.created_at DESC LIMIT 300`,[req.empresaId])).rows)));
router.get('/preparaciones/:id',wrap(async(req,res)=>{
 const prep=(await db.query('SELECT * FROM planner_preparaciones WHERE id=$1 AND empresa_id=$2',[req.params.id,req.empresaId])).rows[0];
 if(!prep)throw inventory.fail('Preparación no encontrada.',404);
 const lines=(await db.query(`SELECT l.*,e.lote,e.almacen,e.ubicacion
  FROM planner_preparacion_lineas l JOIN planner_existencias e ON e.id=l.existencia_id AND e.empresa_id=l.empresa_id
  JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id WHERE l.preparacion_id=$1 AND l.empresa_id=$2 ORDER BY l.parada,a.referencia`,[prep.id,req.empresaId])).rows;
 res.json({...prep,lineas:lines});
}));
router.post('/preparaciones',write,wrap(async(req,res)=>res.status(201).json(await inventory.prepare(db,req.empresaId,req.user.id,req.body))));
router.post('/preparaciones/:id/accion',write,wrap(async(req,res)=>res.json(await inventory.transition(db,req.empresaId,req.user.id,req.params.id,req.body))));
router.get('/albaranes',wrap(async(req,res)=>res.json((await db.query(`SELECT a.id,a.numero,a.created_at,a.preparacion_id,p.pedido_id,a.datos->>'pedido_numero' AS pedido_numero,a.datos->>'cliente_nombre' AS cliente,
 a.datos->>'destino' AS destino FROM planner_albaranes a JOIN planner_preparaciones p ON p.id=a.preparacion_id AND p.empresa_id=a.empresa_id WHERE a.empresa_id=$1 ORDER BY a.created_at DESC LIMIT 300`,[req.empresaId])).rows)));
router.get('/albaranes/:id',wrap(async(req,res)=>{
 const row=(await db.query('SELECT * FROM planner_albaranes WHERE id=$1 AND empresa_id=$2',[req.params.id,req.empresaId])).rows[0];
 if(!row)throw inventory.fail('Albarán no encontrado.',404);res.json(row);
}));
router.get('/albaranes/:id/pdf',wrap(async(req,res)=>{
 const row=(await db.query('SELECT * FROM planner_albaranes WHERE id=$1 AND empresa_id=$2',[req.params.id,req.empresaId])).rows[0];
 if(!row)throw inventory.fail('Albarán no encontrado.',404);
 const pdf=await require('../services/plannerDeliveryPdf').deliveryPdf(row);
 res.json({nombre:`${row.numero}.pdf`,file_mime:'application/pdf',file_base64:pdf.toString('base64')});
}));
router.post('/preparaciones/:id/albaran',write,wrap(async(req,res)=>{
 const row=await db.transaction(async tx=>{
  const prep=(await tx.query('SELECT * FROM planner_preparaciones WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[req.params.id,req.empresaId])).rows[0];
  if(!prep)throw inventory.fail('Preparación no encontrada.',404);
  if(!['lista','expedida'].includes(prep.estado))throw inventory.fail('Completa la preparación antes de generar el albarán.',409);
  const old=(await tx.query('SELECT * FROM planner_albaranes WHERE preparacion_id=$1 AND empresa_id=$2',[prep.id,req.empresaId])).rows[0];if(old)return old;
  const order=(await tx.query(`SELECT p.*,c.nombre AS cliente_nombre,c.cif AS cliente_cif,c.direccion AS cliente_direccion FROM pedidos p JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id WHERE p.id=$1 AND p.empresa_id=$2`,[prep.pedido_id,req.empresaId])).rows[0];
  if(!order)throw inventory.fail('Completa el destinatario de la carga.',409);
  const company=(await tx.query('SELECT nombre,cif FROM empresas WHERE id=$1',[req.empresaId])).rows[0];
  const lines=(await tx.query(`SELECT l.referencia,l.descripcion,l.unidad,l.cantidad,l.parada,l.peso_kg,e.lote,e.ubicacion FROM planner_preparacion_lineas l JOIN planner_existencias e ON e.id=l.existencia_id AND e.empresa_id=l.empresa_id
   JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id WHERE l.preparacion_id=$1 AND l.empresa_id=$2 ORDER BY l.parada,a.referencia`,[prep.id,req.empresaId])).rows;
  // Snapshot never includes costs or transport purchase prices in the recipient document.
  const data={empresa:company,pedido_numero:order.numero,cliente_nombre:order.cliente_nombre,cliente_cif:order.cliente_cif,cliente_direccion:order.cliente_direccion,
    origen:order.origen,destino:order.destino,puntos_descarga:order.puntos_descarga,fecha_carga:order.fecha_carga,lineas:lines};
  const id=crypto.randomUUID(),number=`ALB-${order.numero}-${id.slice(0,8).toUpperCase()}`;
  return (await tx.query('INSERT INTO planner_albaranes(id,empresa_id,preparacion_id,numero,datos,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,req.empresaId,prep.id,number,JSON.stringify(data),req.user.id])).rows[0];
 });res.status(201).json(row);
}));
module.exports=router;
