const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const path=require('node:path');
async function main(){
 const pg=new PGlite();let failVehicle=false;
 const company='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',driver='33333333-3333-4333-8333-333333333333',user='44444444-4444-4444-8444-444444444444',vehicle='55555555-5555-4555-8555-555555555555';
 const db={query:async(sql,args)=>{if(failVehicle&&sql.startsWith('UPDATE vehiculos'))throw Error('injected odometer write failure');return pg.query(sql,args);},transaction:fn=>pg.transaction(tx=>fn({query:(sql,args)=>{if(failVehicle&&sql.startsWith('UPDATE vehiculos'))throw Error('injected odometer write failure');return tx.query(sql,args);}}))};
 const helper={module:{exports:{}},Date,require:()=>db};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/driverWorkday.js'),'utf8'),helper);const helpers=helper.module.exports;
 try{
 await pg.exec(`CREATE TABLE choferes(id uuid PRIMARY KEY,empresa_id uuid,vehiculo_id uuid);CREATE TABLE vehiculos(id uuid PRIMARY KEY,empresa_id uuid,matricula text,remolque_id uuid,km_actuales numeric,updated_at timestamptz);
 CREATE TABLE chofer_jornadas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,chofer_id uuid,usuario_id uuid,vehiculo_id uuid,estado text DEFAULT 'abierta',inicio_at timestamptz DEFAULT now(),fin_at timestamptz,km_inicio numeric,km_fin numeric,actividad_actual text,eventos jsonb,notas text,hace_noche boolean,noche_lugar text,updated_at timestamptz);
 CREATE TABLE vehiculo_noches(empresa_id uuid,vehiculo_id uuid,fecha date,ciudad text,chofer_id uuid,notas text);
 CREATE TABLE gps_position_log(empresa_id uuid,vehiculo_id uuid,provider text,lat numeric,lng numeric,recorded_at timestamptz);`);
 await db.query('INSERT INTO vehiculos(id,empresa_id,matricula,km_actuales) VALUES ($1,$2,$3,100)',[vehicle,company,'TEST-001']);await db.query('INSERT INTO choferes VALUES ($1,$2,$3)',[driver,company,vehicle]);
 const handlers={},router={post:(p,...fn)=>handlers[p]=fn.at(-1)},source=fs.readFileSync(path.join(__dirname,'../src/routes/choferes.js'),'utf8');
 const scope={...helpers,db,router,Date,requireChoferApp:()=>{},ensureChoferJornadaSchema:async()=>{},resolveChoferApp:async req=>(await db.query('SELECT id,vehiculo_id FROM choferes WHERE id=$1 AND empresa_id=$2',[driver,req.empresaId])).rows[0],serializeJornada:x=>x,jornadaEventos:x=>x.eventos||[],normalizeActividad:x=>x,diffMinutes:(a,b)=>Math.max(0,(Date.parse(b)-Date.parse(a))/60000),TACOGRAFO:{descansoDiarioReducidoMin:540,descansoDiarioNormalMin:660}};
 for(const [start,end]of [['router.post("/app/jornada/iniciar"','router.post("/app/jornada/actividad"'],['router.post("/app/jornada/cerrar"','router.get("/:id"']])vm.runInNewContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),scope);
 const call=async(name,body,empresaId=company)=>{const res={code:200,status(n){this.code=n;return this;},json(x){this.data=x;return this;}};await handlers['/app/jornada/'+name]({empresaId,user:{id:user,empresa_id:empresaId,rol:'chofer'},body},res);return res;};
 const rig={conjunto_confirmado:true,vehiculo_id:vehicle,remolque_id:null};
 assert.equal((await call('iniciar',{km_inicio:100})).code,400);
 assert.equal((await call('iniciar',{...rig,km_inicio:99})).code,400);
 assert.equal((await call('iniciar',{...rig,km_inicio:100},other)).code,404);
 const opened=await call('iniciar',{...rig,km_inicio:100});assert.equal(opened.code,201);assert.equal((await call('iniciar',{...rig,km_inicio:100})).data.jornada.id,opened.data.jornada.id,'Opening retry must not duplicate workday');
 const req={empresaId:company,user:{id:user,rol:'chofer'}};await helpers.assertDriverWorkday(req);
 for(const km of [99,100,100.9])assert.equal((await call('cerrar',{...rig,km_fin:km})).code,400);
 assert.equal((await db.query('SELECT actividad_actual FROM chofer_jornadas')).rows[0].actividad_actual,'otros_trabajos','Invalid close must not switch to rest');
 failVehicle=true;assert.equal((await call('cerrar',{...rig,km_fin:101})).code,500);failVehicle=false;
 assert.equal((await db.query('SELECT estado FROM chofer_jornadas')).rows[0].estado,'abierta','Failed odometer write rolls back closing');
 assert.equal((await call('cerrar',{...rig,km_fin:101})).code,200);
 assert.equal(Number((await db.query('SELECT km_actuales FROM vehiculos')).rows[0].km_actuales),101);
 await assert.rejects(()=>helpers.assertDriverWorkday(req),/Abre tu jornada/);
 assert.equal((await call('cerrar',{...rig,km_fin:102})).code,400);
 assert.equal(helpers.freshGps(new Date(Date.now()-600000)),false);assert.equal(helpers.freshGps(new Date()),true);
 const email=require('../src/services/transportEmail');const brand=email.emailBrand({nombre:'Empresa',cfg_precios:{empresa_perfil:{email:'test@example.com'}}});assert.equal(brand.replyTo,'test@example.com');
 const mail=email.transportEmail('colaborador_confirmar',{numero:'<script>',empresa:'ACME',url:'https://example.com/accept'},brand);assert(mail.html.includes('&lt;script&gt;'));assert(!mail.html.includes('<script>'));assert(mail.html.includes('Revisar y aceptar carga'));assert(mail.html.includes('cid:transgest-brand'));assert.equal(email.safeLink('javascript:alert(1)'),'');
 console.log('PASS driver PostgreSQL: confirmed rig, tenant isolation, odometer +1, retry, atomic rollback, closed-day guard, GPS freshness and branded email escaping.');
 }finally{await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
