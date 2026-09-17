const db = require('./db');
const { validateBase64Upload } = require('./uploadValidation');
const { workdayError } = require('./driverWorkday');
let ready;
function ensureSchema() {
  if (!ready) ready = (async()=>{
    await db.query(`CREATE TABLE IF NOT EXISTS empresa_ubicaciones_operativas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL, poblacion TEXT NOT NULL, provincia TEXT NOT NULL DEFAULT '', pais TEXT NOT NULL DEFAULT 'España',
      es_base BOOLEAN NOT NULL DEFAULT false, activo BOOLEAN NOT NULL DEFAULT true)`);
    await db.query(`CREATE TABLE IF NOT EXISTS chofer_gastos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      chofer_id UUID NOT NULL REFERENCES choferes(id), vehiculo_id UUID NOT NULL REFERENCES vehiculos(id),
      usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL, jornada_id UUID REFERENCES chofer_jornadas(id) ON DELETE SET NULL,
      solicitud_id UUID NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('gasoil','dieta')), fecha DATE NOT NULL,
      poblacion TEXT NOT NULL, provincia TEXT NOT NULL DEFAULT '', en_base BOOLEAN NOT NULL DEFAULT false,
      litros NUMERIC(12,2), importe NUMERIC(12,2), estado TEXT NOT NULL DEFAULT 'registrado',
      notas TEXT NOT NULL DEFAULT '', ticket_nombre TEXT, ticket_mime TEXT, ticket_base64 TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), actualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(empresa_id,usuario_id,solicitud_id))`);
    await db.query('CREATE INDEX IF NOT EXISTS chofer_gastos_vehiculo_fecha ON chofer_gastos(empresa_id,vehiculo_id,fecha)');
  })().catch(e=>{ready=null;throw e;});
  return ready;
}
const clean=v=>String(v||'').trim();
function amount(value,label) {
  const n=Number(String(value??'').replace(',','.'));
  if(value==null||clean(value)===''||!Number.isFinite(n)||n<=0||n>1000000)throw workdayError(`Introduce ${label} válido y mayor que cero.`,400);
  return Math.round(n*100)/100;
}
function validateExpense(body) {
  if(!['gasoil','dieta'].includes(body.tipo))throw workdayError('Tipo de gasto no válido.',400);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha||'') || !Number.isFinite(Date.parse(body.fecha)) || new Date(body.fecha).toISOString().slice(0,10)!==body.fecha)throw workdayError('Fecha no válida.',400);
  if(!clean(body.poblacion)||(!(body.tipo==='gasoil'&&body.en_base===true)&&!clean(body.provincia)))throw workdayError('Indica población y provincia.',400);
  const pending=body.tipo==='gasoil'&&body.en_base===true;
  return {tipo:body.tipo,fecha:body.fecha,poblacion:clean(body.poblacion).slice(0,160),provincia:clean(body.provincia).slice(0,160),en_base:pending,
    litros:body.tipo==='gasoil'&&!pending?amount(body.litros,'litros'):null,importe:pending?null:amount(body.importe,'un importe'),estado:pending?'pendiente_base':'registrado'};
}
function registerRoutes(router,{resolveChoferApp,requireChoferApp,manager}) {
  const eid=req=>req.empresaId||req.user.empresa_id;
  const wrap=fn=>async(req,res)=>{try{await ensureSchema();await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.message});}};
  const driver=async req=>{
    if(req.user.colaborador_id)throw workdayError('Los gastos de flota propia no están disponibles para transportistas externos.',403);
    const c=await resolveChoferApp(req);if(!c||c.activo===false)throw workdayError('No hay un chófer activo vinculado a tu usuario.',403);return c;
  };
  for(const [url,guard]of [['/app/ubicaciones',requireChoferApp],['/ubicaciones-operativas',manager]])router.get(url,guard,wrap(async(req,res)=>res.json((await db.query('SELECT id,nombre,poblacion,provincia,pais,es_base FROM empresa_ubicaciones_operativas WHERE empresa_id=$1 AND activo=true ORDER BY es_base DESC,nombre',[eid(req)])).rows)));
  router.post('/ubicaciones-operativas',manager,wrap(async(req,res)=>{
    const b=req.body;if(!clean(b.nombre)||!clean(b.poblacion))throw workdayError('Nombre y población son obligatorios.',400);
    res.status(201).json((await db.query('INSERT INTO empresa_ubicaciones_operativas(empresa_id,nombre,poblacion,provincia,pais,es_base) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[eid(req),clean(b.nombre).slice(0,160),clean(b.poblacion).slice(0,160),clean(b.provincia).slice(0,160),clean(b.pais||'España').slice(0,80),b.es_base===true])).rows[0]);
  }));
  router.delete('/ubicaciones-operativas/:id',manager,wrap(async(req,res)=>{await db.query('UPDATE empresa_ubicaciones_operativas SET activo=false WHERE id=$1 AND empresa_id=$2',[req.params.id,eid(req)]);res.json({ok:true});}));
  const columns='g.id,g.tipo,g.fecha,g.vehiculo_id,g.chofer_id,g.poblacion,g.provincia,g.en_base,g.litros,g.importe,g.estado,g.notas,g.ticket_nombre,g.created_at,v.matricula';
  router.get('/app/gastos',requireChoferApp,wrap(async(req,res)=>{
    const c=await driver(req);res.json((await db.query(`SELECT ${columns} FROM chofer_gastos g JOIN vehiculos v ON v.id=g.vehiculo_id AND v.empresa_id=g.empresa_id WHERE g.empresa_id=$1 AND g.chofer_id=$2 ORDER BY g.fecha DESC,g.created_at DESC LIMIT 200`,[eid(req),c.id])).rows);
  }));
  router.post('/app/gastos',requireChoferApp,wrap(async(req,res)=>{
    const c=await driver(req),b=validateExpense(req.body);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.body.solicitud_id||''))throw workdayError('Identificador de envío no válido.',400);
    const ticket=req.body.ticket?validateBase64Upload({data:req.body.ticket.base64,mime:req.body.ticket.mime,filename:req.body.ticket.nombre,allowedMimes:new Set(['image/jpeg','image/png','image/webp','application/pdf'])}):null;
    const row=await db.transaction(async tx=>{
      const locked=(await tx.query('SELECT vehiculo_id FROM choferes WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[c.id,eid(req)])).rows[0];
      if(!locked?.vehiculo_id||String(locked.vehiculo_id)!==String(req.body.vehiculo_id))throw workdayError('El conjunto ha cambiado. Actualiza la pantalla y revisa la matrícula.');
      const j=(await tx.query("SELECT id FROM chofer_jornadas WHERE empresa_id=$1 AND chofer_id=$2 AND estado='abierta' ORDER BY inicio_at DESC LIMIT 1",[eid(req),c.id])).rows[0];
      return (await tx.query(`INSERT INTO chofer_gastos(empresa_id,chofer_id,vehiculo_id,usuario_id,jornada_id,solicitud_id,tipo,fecha,poblacion,provincia,en_base,litros,importe,estado,notas,ticket_nombre,ticket_mime,ticket_base64)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT(empresa_id,usuario_id,solicitud_id) DO UPDATE SET solicitud_id=EXCLUDED.solicitud_id RETURNING id`,
        [eid(req),c.id,locked.vehiculo_id,req.user.id,j?.id||null,req.body.solicitud_id,b.tipo,b.fecha,b.poblacion,b.provincia,b.en_base,b.litros,b.importe,b.estado,clean(req.body.notas).slice(0,1000),ticket?clean(req.body.ticket.nombre).slice(0,180):null,ticket?.mime||null,ticket?.base64||null])).rows[0];
    });res.status(201).json(row);
  }));
  router.get('/gastos',manager,wrap(async(req,res)=>{
    res.json((await db.query(`SELECT ${columns} FROM chofer_gastos g JOIN vehiculos v ON v.id=g.vehiculo_id AND v.empresa_id=g.empresa_id WHERE g.empresa_id=$1 AND ($2::uuid IS NULL OR g.vehiculo_id=$2) AND g.fecha >= COALESCE($3::date,CURRENT_DATE-31) AND g.fecha <= COALESCE($4::date,CURRENT_DATE) ORDER BY g.fecha DESC,g.created_at DESC LIMIT 1000`,[eid(req),req.query.vehiculo_id||null,req.query.desde||null,req.query.hasta||null])).rows);
  }));
  router.patch('/gastos/:id/base',manager,wrap(async(req,res)=>{
    const litros=amount(req.body.litros,'litros'),importe=amount(req.body.importe,'un importe');
    const row=(await db.query("UPDATE chofer_gastos SET litros=$1,importe=$2,estado='registrado',actualizado_por=$3,updated_at=NOW() WHERE id=$4 AND empresa_id=$5 AND estado='pendiente_base' RETURNING id",[litros,importe,req.user.id,req.params.id,eid(req)])).rows[0];
    if(!row)throw workdayError('El repostaje ya está completado o no existe.',409);res.json(row);
  }));
  for(const [url,guard]of [['/app/gastos/:id/ticket',requireChoferApp],['/gastos/:id/ticket',manager]])router.get(url,guard,wrap(async(req,res)=>{
    const c=req.user.rol==='chofer'?await driver(req):null;
    const g=(await db.query('SELECT ticket_mime,ticket_base64 FROM chofer_gastos WHERE id=$1 AND empresa_id=$2 AND ($3::uuid IS NULL OR chofer_id=$3)',[req.params.id,eid(req),c?.id||null])).rows[0];
    if(!g?.ticket_base64)throw workdayError('Justificante no encontrado.',404);
    res.set('Content-Type',g.ticket_mime).set('X-Content-Type-Options','nosniff').set('Cache-Control','private, no-store').send(Buffer.from(g.ticket_base64,'base64'));
  }));
}
module.exports={ensureSchema,registerRoutes,validateExpense,amount};
