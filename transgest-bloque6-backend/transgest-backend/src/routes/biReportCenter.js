const express=require('express');
const db=require('../services/db');
const center=require('../services/biReportCenter');
const exporter=require('../services/biReportExport');
const router=express.Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const company=req=>req.empresaId||req.user?.empresa_id;
const actor=req=>req.user?.id;
const error=(res,e)=>res.status(e.status||500).json({estado:'error',error:e.status?e.message:'No se pudo procesar el informe'});
const validId=(res,id)=>{if(uuid.test(id))return true;res.status(400).json({error:'Identificador inválido'});return false;};
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
function payload(body){
  const nombre=String(body?.nombre||'').trim(),descripcion=String(body?.descripcion||'').trim();
  if(!nombre||nombre.length>120||descripcion.length>500)throw Object.assign(new Error('Nombre o descripción inválidos'),{status:400});
  const alcance=body?.alcance==='compartida'?'compartida':'personal';
  return {nombre,descripcion,alcance,config:center.validateConfig(body?.configuracion)};
}
router.get('/catalogo',async(req,res)=>{try{
  const clients=await db.query('SELECT id::text AS id,nombre FROM clientes WHERE empresa_id=$1 ORDER BY nombre',[company(req)]);
  res.json({...center.catalogue(),opciones:{clientes:clients.rows}});
}catch(e){error(res,e);}});
router.get('/vistas',async(req,res)=>{try{const result=await db.query(`SELECT id,nombre,descripcion,alcance,configuracion,version,owner_id,updated_at
  FROM bi_report_views WHERE empresa_id=$1 AND (alcance='compartida' OR owner_id=$2)
  ORDER BY alcance DESC,nombre COLLATE "C" ASC`,[company(req),actor(req)]);res.json(result.rows);}catch(e){error(res,e);}});
router.post('/vistas',async(req,res)=>{try{const p=payload(req.body);
  if(p.alcance==='compartida'&&req.user?.rol!=='gerente')return res.status(403).json({error:'Solo gerencia puede publicar vistas compartidas'});
  const result=await db.query(`INSERT INTO bi_report_views(empresa_id,owner_id,nombre,descripcion,alcance,configuracion)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id,nombre,descripcion,alcance,configuracion,version,owner_id,updated_at`,
    [company(req),actor(req),p.nombre,p.descripcion,p.alcance,JSON.stringify(p.config)]);
  res.status(201).json(result.rows[0]);}catch(e){error(res,e);}});
router.put('/vistas/:id',async(req,res)=>{if(!validId(res,req.params.id))return;try{const p=payload(req.body);
  if(p.alcance==='compartida'&&req.user?.rol!=='gerente')return res.status(403).json({error:'Solo gerencia puede publicar vistas compartidas'});
  const result=await db.query(`UPDATE bi_report_views SET nombre=$4,descripcion=$5,alcance=$6,configuracion=$7,
    version=version+1,updated_at=now() WHERE id=$1 AND empresa_id=$2 AND owner_id=$3
    RETURNING id,nombre,descripcion,alcance,configuracion,version,owner_id,updated_at`,
    [req.params.id,company(req),actor(req),p.nombre,p.descripcion,p.alcance,JSON.stringify(p.config)]);
  if(!result.rows[0])return res.status(404).json({error:'Vista no disponible'});res.json(result.rows[0]);}catch(e){error(res,e);}});
router.delete('/vistas/:id',async(req,res)=>{if(!validId(res,req.params.id))return;try{
  const result=await db.query('DELETE FROM bi_report_views WHERE id=$1 AND empresa_id=$2 AND owner_id=$3 RETURNING id',
    [req.params.id,company(req),actor(req)]);
  if(!result.rows[0])return res.status(404).json({error:'Vista no disponible'});res.json({deleted:true});}catch(e){error(res,e);}});
router.post('/ejecutar',async(req,res)=>{try{
  let config=req.body?.configuracion,viewId=null,viewMeta={};
  if(req.body?.vista_id){if(!validId(res,req.body.vista_id))return;
    const r=await db.query(`SELECT id,nombre,descripcion,configuracion FROM bi_report_views WHERE id=$1 AND empresa_id=$2
      AND (owner_id=$3 OR alcance='compartida')`,[req.body.vista_id,company(req),actor(req)]);
    if(!r.rows[0])return res.status(404).json({error:'Vista no disponible'});
    config=r.rows[0].configuracion;viewId=r.rows[0].id;viewMeta=r.rows[0];
  }
  await db.query('DELETE FROM bi_report_exports WHERE empresa_id=$1 AND expires_at<now()',[company(req)]);
  await db.query('DELETE FROM bi_report_runs WHERE empresa_id=$1 AND expires_at<now()',[company(req)]);
  const run=await center.runReport(company(req),actor(req),config,viewId,undefined,viewMeta);
  res.status(201).json(run);
}catch(e){error(res,e);}});
router.get('/ejecuciones/:id',async(req,res)=>{if(!validId(res,req.params.id))return;try{
  const run=await db.query(`SELECT snapshot FROM bi_report_runs WHERE id=$1 AND empresa_id=$2 AND owner_id=$3 AND expires_at>now()`,
    [req.params.id,company(req),actor(req)]);
  if(!run.rows[0])return res.status(404).json({error:'Ejecución caducada o no disponible'});
  res.json(center.previewReport(run.rows[0].snapshot,req.query?.pagina||1));
}catch(e){error(res,e);}});
router.post('/ejecuciones/:id/exportar',async(req,res)=>{if(!validId(res,req.params.id))return;try{
  const formato=String(req.body?.formato||'');if(!['pdf','xlsx','csv'].includes(formato))return res.status(400).json({error:'Formato no autorizado'});
  const run=await db.query(`SELECT snapshot FROM bi_report_runs WHERE id=$1 AND empresa_id=$2 AND owner_id=$3 AND expires_at>now()`,
    [req.params.id,company(req),actor(req)]);
  if(!run.rows[0])return res.status(404).json({error:'Ejecución caducada o no disponible'});
  const {buffer}=await exporter.render(run.rows[0].snapshot,formato);
  if(buffer.length>50*1024*1024)return res.status(413).json({error:'El informe supera 50 MB; acota el periodo'});
  const inserted=await db.query(`INSERT INTO bi_report_exports(empresa_id,owner_id,run_id,formato,contenido)
    VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at`,[company(req),actor(req),req.params.id,formato,buffer]);
  res.status(201).json({id:inserted.rows[0].id,formato,expires_at:inserted.rows[0].expires_at,
    download_url:`/informes/bi/reportes/descargas/${inserted.rows[0].id}`});
}catch(e){error(res,e);}});
router.get('/descargas/:id',async(req,res)=>{if(!validId(res,req.params.id))return;try{
  const result=await db.query(`SELECT x.formato,x.contenido FROM bi_report_exports x
    JOIN bi_report_runs r ON r.id=x.run_id AND r.empresa_id=x.empresa_id AND r.owner_id=x.owner_id
    WHERE x.id=$1 AND x.empresa_id=$2 AND x.owner_id=$3 AND x.expires_at>now() AND r.expires_at>now()`,
    [req.params.id,company(req),actor(req)]);
  if(!result.rows[0])return res.status(404).json({error:'Descarga caducada o no disponible'});
  const {formato,contenido}=result.rows[0];
  res.set('Cache-Control','private, no-store');res.set('X-Content-Type-Options','nosniff');
  res.set('Content-Type',{pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv; charset=utf-8'}[formato]);
  res.set('Content-Disposition',`attachment; filename="transgest-bi-${req.params.id}.${formato}"`);res.send(contenido);
}catch(e){error(res,e);}});
module.exports=router;
