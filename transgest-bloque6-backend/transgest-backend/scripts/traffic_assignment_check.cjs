const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {validateTrafficAssignment,overlaps}=require('../src/services/trafficAssignment');
async function main(){
 const pg=new PGlite(),company=crypto.randomUUID(),other=crypto.randomUUID(),truck=crypto.randomUUID(),driver=crypto.randomUUID(),id=crypto.randomUUID();
 const order={id,estado:'pendiente',fecha_carga:'2026-09-26',fecha_descarga:'2026-09-26',hora_carga:'08:00',hora_descarga:'09:00',peso_kg:900};
 const patch={asignar_solo_si_libre:true,vehiculo_id:truck,chofer_id:driver};
 const run=(extra={})=>pg.transaction(tx=>validateTrafficAssignment(tx,company,order,{...patch,...extra}));
 try{
  await pg.exec(`CREATE TABLE vehiculos(id uuid,empresa_id uuid,matricula text,estado text,activo boolean,clase text,tipo text,carga_max_kg numeric,fecha_itv date,fecha_seguro date);
   CREATE TABLE vehiculos_ext(vehiculo_id uuid,empresa_id uuid,data jsonb);
   CREATE TABLE choferes(id uuid,empresa_id uuid,activo boolean,estado text);
   CREATE TABLE chofer_vacaciones_solicitudes(empresa_id uuid,chofer_id uuid,estado text,fecha_inicio date,fecha_fin date);
   CREATE TABLE pedidos(id uuid,empresa_id uuid,numero text,estado text,vehiculo_id uuid,remolque_id uuid,chofer_id uuid,chofer2_id uuid,fecha_carga date,fecha_pedido date,fecha_descarga date,fecha_entrega date,hora_carga time,hora_descarga time);
   CREATE TABLE pedido_eventos(pedido_id uuid,empresa_id uuid,tipo text,actor_tipo text,actor_id uuid,detalle jsonb);`);
  await pg.query("INSERT INTO vehiculos(id,empresa_id,matricula,estado,activo,clase,carga_max_kg) VALUES($1,$2,'1234QA','disponible',true,'rigido',1000)",[truck,company]);
  await pg.query("INSERT INTO choferes VALUES($1,$2,true,'disponible')",[driver,company]);
  assert.deepEqual(await run(),[]);
  await assert.rejects(run({peso_kg:1500}),{code:'ASSIGNMENT_REVIEW_REQUIRED'});
  await run({peso_kg:1500,asignacion_revisada:true});assert.equal((await pg.query('SELECT count(*)::int n FROM pedido_eventos')).rows[0].n,1);
  await pg.query("UPDATE vehiculos SET estado='taller'");await assert.rejects(run({asignacion_revisada:true}),{code:'ASSIGNMENT_UNAVAILABLE'});
  await pg.query("UPDATE vehiculos SET estado='disponible',empresa_id=$1",[other]);await assert.rejects(run(),{code:'ASSIGNMENT_SCOPE'});
  await pg.query('UPDATE vehiculos SET empresa_id=$1',[company]);
  await pg.query("INSERT INTO chofer_vacaciones_solicitudes VALUES($1,$2,'aprobada','2026-09-26','2026-09-28')",[company,driver]);await assert.rejects(run(),{code:'ASSIGNMENT_UNAVAILABLE'});
  await pg.query('DELETE FROM chofer_vacaciones_solicitudes');
  await pg.query("INSERT INTO pedidos(id,empresa_id,numero,estado,chofer_id,fecha_carga,fecha_descarga,hora_carga,hora_descarga) VALUES($1,$2,'OTHER','confirmado',$3,'2026-09-26','2026-09-26','08:30','10:00')",[crypto.randomUUID(),company,driver]);
  await assert.rejects(run(),{code:'ASSIGNMENT_REVIEW_REQUIRED'});
  assert.deepEqual(await run({hora_carga:'11:00',hora_descarga:'12:00'}),[]);
  assert.equal(overlaps(order,{...order,hora_carga:null,hora_descarga:null}),true,'Unknown hours are flagged, not invented');
  await assert.rejects(run({fecha_carga:'2026-09-28'}),{code:'ASSIGNMENT_DATES'});
  console.log('PASS traffic assignment: company/resources, workshop, absence, known capacity, overlap, missing hours and audited confirmation.');
 } finally {await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
