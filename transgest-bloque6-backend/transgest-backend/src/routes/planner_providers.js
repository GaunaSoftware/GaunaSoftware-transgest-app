const express=require('express'),db=require('../services/db');
const {requireRole,requireModulePermission}=require('../middleware/auth');
const {text,fail}=require('../services/plannerInventory');
const router=express.Router(),write=requireRole('gerente','trafico','administrativo');
router.use(requireModulePermission('colaboradores'));
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};

router.post('/propio',write,wrap(async(req,res)=>{
  const provider=await db.transaction(async tx=>{
    const company=(await tx.query('SELECT * FROM empresas WHERE id=$1 FOR UPDATE',[req.empresaId])).rows[0];
    if(!company?.cif||!company?.nombre)throw fail('Completa el nombre y el NIF de tu empresa antes de registrarla como transportista.');
    const existing=(await tx.query("SELECT * FROM colaboradores WHERE empresa_id=$1 AND regexp_replace(upper(cif),'[^A-Z0-9]','','g')=regexp_replace(upper($2),'[^A-Z0-9]','','g') ORDER BY id LIMIT 1",[req.empresaId,company.cif])).rows[0];
    if(existing)return existing;
    return (await tx.query("INSERT INTO colaboradores(empresa_id,tipo,nombre,cif,email,telefono,notas) VALUES($1,'empresa',$2,$3,$4,$5,$6) RETURNING *",[req.empresaId,company.razon_social||company.nombre,company.cif,company.email||null,company.telefono||null,'Flota propia de la empresa · Planner'])).rows[0];
  });res.json(provider);
}));
router.get('/conductores',wrap(async(req,res)=>res.json((await db.query(`SELECT d.*,c.nombre AS colaborador FROM planner_conductores d
 JOIN colaboradores c ON c.id=d.colaborador_id AND c.empresa_id=d.empresa_id
 WHERE d.empresa_id=$1 ORDER BY c.nombre,d.nombre,d.apellidos`,[req.empresaId])).rows)));
const fields=async(req)=>{
 const b=req.body;
 if(!text(b.nombre,100)||!b.colaborador_id)throw fail('Indica el nombre y el proveedor de transporte.');
 if(!(await db.query('SELECT id FROM colaboradores WHERE id=$1 AND empresa_id=$2',[b.colaborador_id,req.empresaId])).rows.length)throw fail('Proveedor no encontrado.',404);
 const email=text(b.email,180);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Introduce un email válido.');
 return [b.colaborador_id,text(b.nombre,100),text(b.apellidos,160),text(b.alias,80),text(b.telefono,40),email,text(b.dni,30),text(b.carnet,80),b.activo!==false];
};
router.post('/conductores',write,wrap(async(req,res)=>{
 const values=await fields(req);
 res.status(201).json((await db.query(`INSERT INTO planner_conductores(empresa_id,colaborador_id,nombre,apellidos,alias,telefono,email,dni,carnet,activo)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.empresaId,...values])).rows[0]);
}));
router.put('/conductores/:id',write,wrap(async(req,res)=>{
 const values=await fields(req);
 const row=(await db.query(`UPDATE planner_conductores SET colaborador_id=$3,nombre=$4,apellidos=$5,alias=$6,telefono=$7,email=$8,dni=$9,carnet=$10,activo=$11,version=version+1
 WHERE id=$1 AND empresa_id=$2 AND version=$12 RETURNING *`,[req.params.id,req.empresaId,...values,Number(req.body.version)])).rows[0];
 if(!row)throw fail('La ficha ha cambiado. Actualiza antes de continuar.',409);res.json(row);
}));
module.exports=router;
