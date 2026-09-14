const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const handlers={};let queries=[],row=null;
const router={use(){},get(p,...h){handlers['GET '+p]=h.at(-1);},post(p,...h){handlers['POST '+p]=h.at(-1);},patch(p,...h){handlers['PATCH '+p]=h.at(-1);},delete(p,...h){handlers['DELETE '+p]=h.at(-1);}};
const db={query:async(sql,args)=>{queries.push({sql,args});return {rows:row?[row]:[]};}};
const sandbox={module:{exports:{}},require(name){if(name==='express')return {Router:()=>router};if(name.includes('/db'))return db;if(name.includes('/auth'))return {authenticate(){},requireRole:()=>()=>{}};if(name.includes('/notificaciones'))return {crearNotificacion:async()=>{}};throw Error(name);},console};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/agenda.js'),'utf8'),sandbox);
const req=(role,query={})=>({user:{id:'me',empresa_id:'company',rol:role},query,params:{id:'event'},body:{}});
const response=()=>({code:200,status(code){this.code=code;return this;},json(value){this.value=value;return this;}});
(async()=>{
 for(const role of ['gerente','trafico']){
  queries=[];await handlers['GET /'](req(role,{modo:'mias'}),response());
  assert.ok(queries[0].sql.includes('e.creado_por ='));assert.ok(!queries[0].sql.includes("OR e.visibilidad = 'equipo'"));
  queries=[];await handlers['GET /'](req(role,{modo:'todas'}),response());
  assert.ok(queries[0].sql.includes("OR e.visibilidad = 'equipo'"));assert.ok(queries[0].args.includes('me'));
 }
 row={id:'event',creado_por:'other',asignado_a:'other',visibilidad:'personal'};
 await assert.rejects(()=>handlers['DELETE /:id'](req('gerente'),response()),e=>e.statusCode===403);
 row={id:'event',creado_por:'manager',asignado_a:'me',visibilidad:'personal'};
 const allowed=response();await handlers['DELETE /:id'](req('trafico'),allowed);assert.equal(allowed.code,200);
 row=null;queries=[];const own=req('trafico');own.body={titulo:'Personal',fecha_inicio:'2026-09-14T09:00:00',asignado_a:'other'};await handlers['POST /'](own,response());assert.equal(queries.find(q=>q.sql.includes('INSERT')).args[2],'me');
 queries=[];const assigned=req('gerente');assigned.body={...own.body};await handlers['POST /'](assigned,response());assert.equal(queries.find(q=>q.sql.includes('INSERT')).args[2],'other');
 console.log('OK agenda access: personal lists, private event protection and manager assignment');
})().catch(e=>{console.error(e);process.exitCode=1;});
