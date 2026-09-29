const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const operativeRead = require('../src/services/operativeReadState');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333',V='44444444-4444-4444-8444-444444444444',T='55555555-5555-4555-8555-555555555555';
async function run(){
 const pg=new PGlite();let server;const original=db.query,originalTransaction=db.transaction;
 try{
  await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY);
   CREATE TABLE usuarios(id uuid PRIMARY KEY,empresa_id uuid,activo boolean DEFAULT true);
   CREATE TABLE colaboradores(id uuid PRIMARY KEY,empresa_id uuid,nombre text,email text,activo boolean);
   CREATE TABLE vehiculos(id uuid PRIMARY KEY,empresa_id uuid,matricula text);
   CREATE TABLE choferes(id uuid PRIMARY KEY,empresa_id uuid,nombre text,apellidos text);
   CREATE TABLE pedidos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,numero text,estado text,fecha_pedido date,fecha_carga date,fecha_descarga date,fecha_entrega date,hora_carga text,ventana_carga text,hora_descarga text,ventana_descarga text,descarga_real_at timestamptz,created_at timestamptz DEFAULT NOW(),colaborador_id uuid,chofer_id uuid,vehiculo_id uuid);
   CREATE TABLE pedido_eventos(pedido_id uuid,empresa_id uuid,tipo text,detalle jsonb,created_at timestamptz DEFAULT NOW());
   CREATE TABLE colaborador_facturas(pedido_id uuid,empresa_id uuid,colaborador_id uuid,factura_proveedor_id uuid,created_at timestamptz);
   CREATE TABLE facturas_proveedor(id uuid,empresa_id uuid,nombre text,estado text,created_at timestamptz);
   CREATE TABLE agenda_eventos(id uuid DEFAULT gen_random_uuid(),empresa_id uuid,asignado_a uuid,creado_por uuid,estado text,metadata jsonb,source_type text,source_id text,cause_code text,visibilidad text,created_at timestamptz DEFAULT NOW(),titulo text,descripcion text,fecha_inicio timestamptz,todo_dia boolean,tipo text,prioridad text,pedido_id uuid);
   INSERT INTO empresas VALUES('${A}'),('${B}');INSERT INTO usuarios(id,empresa_id) VALUES('${U}','${A}'),('${V}','${B}'),('${T}','${A}');
   INSERT INTO colaboradores VALUES('${A}','${A}','Transportista QA A','qa-a@example.invalid',true),('${B}','${B}','Transportista QA B','qa-b@example.invalid',true);
   INSERT INTO pedidos(empresa_id,numero,estado,fecha_descarga,descarga_real_at,colaborador_id) SELECT '${A}','QA-'||n,'entregado',CURRENT_DATE-4,NOW()-INTERVAL '4 days','${A}' FROM generate_series(1,301)n;
   INSERT INTO pedidos(empresa_id,numero,estado,fecha_descarga,descarga_real_at,colaborador_id) VALUES('${B}','SECRET-B','entregado',CURRENT_DATE-4,NOW()-INTERVAL '4 days','${B}');`);
  await pg.exec(fs.readFileSync(path.join(__dirname,'migrations/20260928_operational_alert_reads.sql'),'utf8'));
  db.query=pg.query.bind(pg);
  db.transaction=fn=>pg.transaction(fn);
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=req.headers['x-test-user']==='b'?{empresa_id:B,id:V,rol:'gerente'}:req.headers['x-test-user']==='traffic'?{empresa_id:A,id:T,rol:'trafico'}:req.headers['x-test-user']==='office'?{empresa_id:A,id:U,rol:'administrativo'}:{empresa_id:A,id:U,rol:'gerente'};next();});
  app.use('/notifications',require('../src/routes/notificaciones'));
  app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}/notifications`;
  const get=async(url,options={})=>{const r=await fetch(base+url,options);const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;};
  const initial=await get('/operativas/colaboradores?empresa_id='+B);
  assert.equal(initial.items.length,80);assert.equal(initial.resumen.total,301);assert.equal(initial.limited,true);assert.ok(!JSON.stringify(initial).includes('SECRET-B'));
  const marked=await get('/operativas/leer-todas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:B,usuario_id:V})});
  assert.equal(marked.actualizadas,301);
  assert.equal((await get('/operativas/colaboradores')).resumen.total,0);
  assert.equal((await get('/operativas/colaboradores',{headers:{'x-test-user':'b'}})).resumen.total,1);
  assert.equal((await get('/operativas/leer-todas',{method:'POST'})).actualizadas,0);
  // A promoted agenda reminder must not reappear as the same operational popup.
  await pg.query('DELETE FROM avisos_operativos_leidos WHERE empresa_id=$1',[A]);
  await pg.query(`INSERT INTO agenda_eventos(empresa_id,asignado_a,creado_por,estado,metadata) VALUES($1,$2,$2,'pendiente',$3)`,[A,U,JSON.stringify({source:'avisos_operativos_colaborador',alert_key:initial.items[0].key})]);
  const delegated=await get('/operativas/colaboradores');assert.equal(delegated.resumen.total,300);assert.ok(!delegated.items.some(i=>i.key===initial.items[0].key));
  const {rows:[active]}=await pg.query(`INSERT INTO pedidos(empresa_id,numero,estado,fecha_carga,fecha_descarga,colaborador_id,colaborador_workflow_enviado_at) VALUES($1,'QA-ACTIVE','confirmado',CURRENT_DATE-1,CURRENT_DATE-1,$1,NOW()) RETURNING id`,[A]);
  await pg.query(`INSERT INTO agenda_eventos(empresa_id,estado,source_type,source_id,cause_code,visibilidad) VALUES($1,'pendiente','pedido',$2,'carga_sin_finalizar','equipo'),($1,'en_progreso','pedido',$2,'entrega_vencida','equipo')`,[A,active.id]);
  assert.equal((await get('/operativas/colaboradores')).resumen.total,300,'automated load/delivery tasks suppress the corresponding AvImp reminders');
  await pg.query(`UPDATE agenda_eventos SET estado='completado' WHERE source_id=$1`,[active.id]);
  assert.equal((await get('/operativas/colaboradores')).resumen.total,302,'closed tasks must not conceal unresolved conditions');
  const payload={alert:initial.items[1],asignado_a:U};
  const promote=async(body)=>{const r=await fetch(base+'/operativas/colaboradores/agenda',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  assert.equal((await promote({...payload,asignado_a:V})).status,400,'cross-tenant assignee rejected');
  assert.equal((await promote({alert:{key:'colaborador:foreign:albaran_pendiente'}})).status,404,'forged alert rejected');
  const first=await promote({...payload,alert:{...payload.alert,title:'FORGED TITLE'}});assert.equal(first.status,201,JSON.stringify(first));assert.notEqual(first.body.titulo,'FORGED TITLE');
  const retry=await promote(payload);assert.equal(retry.status,201);assert.equal(retry.body.id,first.body.id);
  const {rows:[count]}=await pg.query(`SELECT COUNT(*)::int AS total FROM agenda_eventos WHERE metadata->>'alert_key'=$1`,[payload.alert.key]);assert.equal(count.total,1);
  assert.equal((await get('/operativas/colaboradores')).resumen.total,301);
  const {rows:[late]}=await pg.query(`INSERT INTO pedidos(empresa_id,numero,estado,fecha_carga,fecha_descarga,chofer_id)
    VALUES($1,'LATE-SYNTHETIC','en_curso',CURRENT_DATE,CURRENT_DATE,$2) RETURNING id`,[A,T]);
  await pg.query(`INSERT INTO pedido_chofer_pasos(empresa_id,pedido_id,chofer_id,data) VALUES($1,$2,$3,$4)`,
    [A,late.id,T,JSON.stringify({carga_iniciada:true,carga_iniciada_at:new Date(Date.now()-90*60000).toISOString()})]);
  const managerDelay=(await get('/operativas/colaboradores')).items.find(item=>item.pedido_id===late.id);
  assert.equal(managerDelay?.demora_paralizacion,true);
  assert.equal((await get('/operativas/colaboradores',{headers:{'x-test-user':'traffic'}})).items.some(item=>item.key===managerDelay.key),true);
  const forbidden=await fetch(base+'/operativas/colaboradores/leer',{method:'POST',headers:{'Content-Type':'application/json','x-test-user':'office'},body:JSON.stringify({key:managerDelay.key})});
  assert.equal(forbidden.status,403,'office staff cannot acknowledge a loading delay');
  const acknowledged=await get('/operativas/colaboradores/leer',{method:'POST',headers:{'Content-Type':'application/json','x-test-user':'traffic'},body:JSON.stringify({key:managerDelay.key})});
  assert.equal(acknowledged.compartido,true);
  assert.equal((await get('/operativas/colaboradores')).items.some(item=>item.key===managerDelay.key),false,'traffic acknowledgement hides delay for management');
  await pg.query(`UPDATE pedidos SET estado='entregado' WHERE id=$1`,[late.id]);
  await pg.query(`UPDATE pedido_chofer_pasos SET data=data||$2::jsonb WHERE pedido_id=$1`,[late.id,JSON.stringify({carga_ok:true,aviso_espera_carga:true,aviso_espera_carga_at:new Date().toISOString()})]);
  assert.equal((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===late.id),false,'acknowledged loading episode stays silent after completion');
  const {rows:[multi]}=await pg.query(`INSERT INTO pedidos(empresa_id,numero,estado,fecha_carga,fecha_descarga,chofer_id)
    VALUES($1,'MULTI-STOP-SYNTHETIC','entregado',CURRENT_DATE-30,CURRENT_DATE-30,$2) RETURNING id`,[A,T]);
  await pg.query(`INSERT INTO pedido_chofer_pasos(empresa_id,pedido_id,chofer_id,data) VALUES($1,$2,$3,$4)`,[A,multi.id,T,
    JSON.stringify({paradas:{'carga-capa':{tipo:'carga',label:'Capa Abanilla',carga_iniciada:true,
      carga_iniciada_at:new Date(Date.now()-95*60000).toISOString(),carga_ok:true,carga_ok_at:new Date().toISOString(),aviso_espera_carga:true}}})]);
  const stopAlert=(await get('/operativas/colaboradores',{headers:{'x-test-user':'traffic'}})).items.find(item=>item.pedido_id===multi.id);
  assert.equal(stopAlert?.parada_id,'carga-capa','unacknowledged completed stop remains visible after 30 days');
  assert.equal(stopAlert?.prefactura_disponible,true);
  await pg.query('INSERT INTO avisos_operativos_leidos(empresa_id,usuario_id,alert_key,fingerprint) VALUES($1,$2,$3,$4)',
    [A,U,stopAlert.key,operativeRead.fingerprint(stopAlert)]);
  await pg.query('INSERT INTO avisos_operativos_ignorados(empresa_id,usuario_id,alert_key) VALUES($1,$2,$3)',[A,T,stopAlert.key]);
  await pg.query(`INSERT INTO agenda_eventos(empresa_id,asignado_a,creado_por,estado,metadata)
    VALUES($1,$2,$2,'pendiente',$3)`,[A,U,JSON.stringify({source:'avisos_operativos_colaborador',alert_key:stopAlert.key})]);
  assert.equal((await get('/operativas/colaboradores')).items.some(item=>item.key===stopAlert.key),true,
    'per-user read or agenda state cannot silence a delay for management');
  assert.equal((await get('/operativas/colaboradores',{headers:{'x-test-user':'traffic'}})).items.some(item=>item.key===stopAlert.key),true,
    'per-user ignore cannot replace company acknowledgement');
  await get('/operativas/colaboradores/leer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:stopAlert.key})});
  assert.equal((await get('/operativas/colaboradores',{headers:{'x-test-user':'traffic'}})).items.some(item=>item.pedido_id===multi.id),false,
    'management acknowledgement is shared with traffic for a specific stop');
  await get('/operativas/leer-todas',{method:'POST'});
  const supplierWithoutEmail='66666666-6666-4666-8666-666666666666';
  await pg.query(`INSERT INTO colaboradores(id,empresa_id,nombre,email,activo) VALUES($1,$2,'Proveedor sin correo',NULL,true)`,[supplierWithoutEmail,A]);
  const {rows:[withoutEmail]}=await pg.query(`INSERT INTO pedidos(empresa_id,numero,estado,fecha_carga,fecha_descarga,colaborador_id,precio_colaborador)
    VALUES($1,'NO-EMAIL-QA','confirmado',CURRENT_DATE,CURRENT_DATE,$2,440) RETURNING id`,[A,supplierWithoutEmail]);
  const trafficAlerts=()=>get('/operativas/colaboradores',{headers:{'x-test-user':'traffic'}});
  assert.equal((await trafficAlerts()).items.some(item=>item.pedido_id===withoutEmail.id),false,
    'a supplier without email cannot receive confirmation links and must not trigger confirmation alerts');
  await pg.query(`UPDATE colaboradores SET email='proveedor@example.invalid' WHERE id=$1`,[supplierWithoutEmail]);
  const withEmail=(await trafficAlerts()).items.filter(item=>item.pedido_id===withoutEmail.id);
  assert.ok(withEmail.some(item=>item.kind==='workflow_no_enviado'));
  assert.ok(withEmail.some(item=>item.kind==='precio_sin_confirmar'));
  await pg.query(`UPDATE colaboradores SET email='   ' WHERE id=$1`,[supplierWithoutEmail]);
  assert.equal((await trafficAlerts()).items.some(item=>item.pedido_id===withoutEmail.id),false,
    'removing the email resolves link-only alerts without recording a false price acceptance');
  await pg.query(`UPDATE pedidos SET estado='entregado', descarga_real_at=NOW()-INTERVAL '4 days' WHERE id=$1`,[withoutEmail.id]);
  assert.ok((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===withoutEmail.id && item.kind==='albaran_pendiente'),
    'missing delivery documents remain actionable even when the supplier has no email');
  await pg.query(`UPDATE colaboradores SET email='proveedor@example.invalid' WHERE id=$1`,[supplierWithoutEmail]);
  const {rows:[recentDelivery]}=await pg.query(`INSERT INTO pedidos(empresa_id,numero,estado,fecha_descarga,descarga_real_at,colaborador_id)
    VALUES($1,'POD-THREE-DAYS','entregado',CURRENT_DATE-10,NOW()-INTERVAL '2 days',$2) RETURNING id`,[A,supplierWithoutEmail]);
  assert.equal((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===recentDelivery.id),false,
    'planned delivery date cannot trigger POD before three days from confirmed delivery');
  await pg.query(`UPDATE pedidos SET descarga_real_at=NOW()-INTERVAL '3 days 1 minute' WHERE id=$1`,[recentDelivery.id]);
  assert.ok((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===recentDelivery.id && item.kind==='albaran_pendiente'));
  await pg.query(`INSERT INTO pedido_docs(empresa_id,pedido_id,nombre,tipo) VALUES($1,$2,'POD.pdf','pod')`,[A,recentDelivery.id]);
  assert.ok((await get('/operativas/colaboradores',{headers:{'x-test-user':'office'}})).items.some(item=>item.pedido_id===recentDelivery.id && item.kind==='documentacion_pago_pendiente'),
    'payment documents use the same three-day confirmed-delivery threshold');
  const {rows:[withoutActual]}=await pg.query(`INSERT INTO pedidos(empresa_id,numero,estado,fecha_descarga,colaborador_id)
    VALUES($1,'POD-NO-ACTUAL','entregado',CURRENT_DATE-10,$2) RETURNING id`,[A,supplierWithoutEmail]);
  assert.equal((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===withoutActual.id),false,
    'no confirmed delivery timestamp is not replaced with a planned date');
  await pg.query(`INSERT INTO pedido_eventos(empresa_id,pedido_id,tipo,detalle,created_at)
    VALUES($1,$2,'estado.actualizado','{"estado":"entregado"}',NOW()-INTERVAL '4 days')`,[B,withoutActual.id]);
  assert.equal((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===withoutActual.id),false,
    'another company event cannot establish this company delivery date');
  await pg.query(`INSERT INTO pedido_eventos(empresa_id,pedido_id,tipo,detalle,created_at)
    VALUES($1,$2,'estado.actualizado','{"estado":"entregado"}',NOW()-INTERVAL '4 days')`,[A,withoutActual.id]);
  assert.ok((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===withoutActual.id && item.kind==='albaran_pendiente'),
    'an audited delivery transition is a valid fallback when the actual timestamp is absent');
  const {rows:[webStatus]}=await pg.query(`INSERT INTO pedidos(empresa_id,numero,estado,fecha_carga,fecha_descarga,colaborador_id,colaborador_workflow_enviado_at)
    VALUES($1,'WEB-STATUS','en_curso',CURRENT_DATE-1,CURRENT_DATE+1,$2,NOW()) RETURNING id`,[A,supplierWithoutEmail]);
  assert.equal((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===webStatus.id && item.kind==='camino_sin_confirmar'),false,
    'web status alone does not imply an unconfirmed departure');
  const { madridClock }=require('../src/services/operativeAlertTiming');
  const {rows:[noHour]}=await pg.query(`INSERT INTO pedidos(empresa_id,numero,estado,fecha_carga,fecha_descarga,colaborador_id,colaborador_workflow_enviado_at)
    VALUES($1,'LOAD-NO-HOUR','confirmado',$3::date,CURRENT_DATE+1,$2,NOW()) RETURNING id`,[A,supplierWithoutEmail,madridClock().date]);
  assert.ok((await get('/operativas/colaboradores')).items.some(item=>item.pedido_id===noHour.id && item.kind==='carga_sin_confirmar'),
    'a load without a time is reminded on its planned date');
  console.log('PASS HTTP AvImp: 301 notices, tenant isolation, company-wide traffic/management delay acknowledgement, multi-stop persistence, read ALL and agenda deduplication.');
 }finally{db.query=original;db.transaction=originalTransaction;if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pg.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
