const express=require('express'),db=require('../services/db');
const {requireRole}=require('../middleware/auth');
const {text,fail}=require('../services/plannerInventory');
const router=express.Router(),write=requireRole('gerente','trafico','administrativo');
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.code==='23505')return res.status(409).json({error:'Esta matrícula ya está registrada.'});if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
const scoped=(req,tx=db)=>tx.query('SELECT * FROM planner_vehiculos_autorizados WHERE id=$1 AND empresa_id=$2',[req.params.id,req.empresaId]);
router.get('/',wrap(async(req,res)=>res.json((await db.query(`SELECT v.*,c.nombre AS colaborador,
 (SELECT COUNT(*)::int FROM planner_vehiculo_documentos d WHERE d.vehiculo_id=v.id AND d.empresa_id=v.empresa_id) AS documentos,
 (SELECT COUNT(*)::int FROM planner_vehiculo_documentos d WHERE d.vehiculo_id=v.id AND d.empresa_id=v.empresa_id AND d.vigente AND d.vencimiento<CURRENT_DATE) AS caducados
 FROM planner_vehiculos_autorizados v LEFT JOIN colaboradores c ON c.id=v.colaborador_id AND c.empresa_id=v.empresa_id WHERE v.empresa_id=$1 ORDER BY v.matricula`,[req.empresaId])).rows)));
router.post('/',write,wrap(async(req,res)=>{
 const matricula=text(req.body.matricula,20).toUpperCase().replace(/[ -]/g,''),tipo=req.body.tipo;
 if(!/^[A-Z0-9]{3,20}$/.test(matricula)||!['tractora','remolque','rigido','furgoneta','banera','otro'].includes(tipo))throw fail('Indica matrícula y tipo válidos.');
 if(req.body.colaborador_id&&!(await db.query('SELECT id FROM colaboradores WHERE id=$1 AND empresa_id=$2',[req.body.colaborador_id,req.empresaId])).rows.length)throw fail('Transportista no encontrado.',404);
 res.status(201).json((await db.query('INSERT INTO planner_vehiculos_autorizados(empresa_id,colaborador_id,matricula,tipo,marca,modelo,notas) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.empresaId,req.body.colaborador_id||null,matricula,tipo,text(req.body.marca,80),text(req.body.modelo,100),text(req.body.notas,2000)])).rows[0]);
}));
router.patch('/:id',write,wrap(async(req,res)=>{
 if(!['pendiente','autorizado','bloqueado'].includes(req.body.estado))throw fail('Estado no válido.');
 const row=await db.transaction(async tx=>{
 const v=(await tx.query('SELECT * FROM planner_vehiculos_autorizados WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[req.params.id,req.empresaId])).rows[0];if(!v)throw fail('Vehículo no encontrado.',404);
 if(v.version!==Number(req.body.version))throw fail('La ficha ha cambiado. Actualiza antes de continuar.',409);
 if(req.body.estado==='autorizado'){
 const docs=(await tx.query('SELECT tipo,vencimiento FROM planner_vehiculo_documentos WHERE vehiculo_id=$1 AND empresa_id=$2 AND vigente',[v.id,req.empresaId])).rows;
 const current=new Date().toISOString().slice(0,10);
 if(!docs.length||docs.some(d=>d.vencimiento&&new Date(d.vencimiento).toISOString().slice(0,10)<current))throw fail('Adjunta la documentación y actualiza los documentos caducados antes de autorizar.',409);
 }
 return (await tx.query('UPDATE planner_vehiculos_autorizados SET estado=$3,notas=$4,version=version+1 WHERE id=$1 AND empresa_id=$2 RETURNING *',[v.id,req.empresaId,req.body.estado,text(req.body.notas,2000)])).rows[0];
 });res.json(row);
}));
router.get('/:id/documentos',wrap(async(req,res)=>{if(!(await scoped(req)).rows.length)throw fail('Vehículo no encontrado.',404);res.json((await db.query('SELECT id,tipo,nombre,vencimiento,vigente,created_at FROM planner_vehiculo_documentos WHERE vehiculo_id=$1 AND empresa_id=$2 ORDER BY created_at DESC',[req.params.id,req.empresaId])).rows);}));
router.post('/:id/documentos',write,wrap(async(req,res)=>{
 const body=req.body,tipo=text(body.tipo,40),nombre=text(body.nombre,180).replace(/[\\/\r\n]/g,'_');
 if(!nombre||!['itv','seguro','permiso_circulacion','ficha_tecnica','autorizacion','otro'].includes(tipo))throw fail('Selecciona el tipo y el archivo.');
 const file=require('../services/uploadValidation').validateBase64Upload({data:body.file_base64,mime:body.file_mime,filename:nombre,allowedMimes:new Set(['application/pdf','image/jpeg','image/png','image/webp'])});
 const result=await db.transaction(async tx=>{
 const vehicle=(await tx.query('SELECT * FROM planner_vehiculos_autorizados WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[req.params.id,req.empresaId])).rows[0];if(!vehicle)throw fail('Vehículo no encontrado.',404);
 // One current version per document type; replacing a file always requires a new review.
 await tx.query('UPDATE planner_vehiculo_documentos SET vigente=false WHERE vehiculo_id=$1 AND empresa_id=$2 AND tipo=$3',[vehicle.id,req.empresaId,tipo]);
 const row=(await tx.query('INSERT INTO planner_vehiculo_documentos(empresa_id,vehiculo_id,tipo,nombre,file_mime,file_base64,vencimiento,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,nombre,tipo,vencimiento',[req.empresaId,vehicle.id,tipo,nombre,file.mime,file.base64,body.vencimiento||null,req.user.id])).rows[0];
 await tx.query("UPDATE planner_vehiculos_autorizados SET estado='pendiente',version=version+1 WHERE id=$1 AND empresa_id=$2",[vehicle.id,req.empresaId]);return row;
 });res.status(201).json(result);
}));
router.get('/:id/documentos/:docId',wrap(async(req,res)=>{
 if(!(await scoped(req)).rows.length)throw fail('Vehículo no encontrado.',404);
 const row=(await db.query('SELECT nombre,file_mime,file_base64 FROM planner_vehiculo_documentos WHERE id=$1 AND vehiculo_id=$2 AND empresa_id=$3',[req.params.docId,req.params.id,req.empresaId])).rows[0];if(!row)throw fail('Documento no encontrado.',404);res.json(row);
}));
module.exports=router;
