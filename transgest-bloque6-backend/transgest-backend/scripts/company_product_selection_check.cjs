const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const products=require('../src/services/companyProducts');
const source=fs.readFileSync(require.resolve('../src/routes/superadminCore'),'utf8');
function handler(method,route,context){
  const marker=`router.${method}("${route}", superAuth, `;
  const start=source.indexOf(marker)+marker.length;
  assert.ok(start>=marker.length,'route exists');
  const end=source.indexOf('\n});',start);
  return vm.runInNewContext('('+source.slice(start,end)+'\n})',context);
}
const initial={a:{plan:'enterprise',modalidad:'combinado',email_admin:'a@example.invalid'},b:{plan:'profesional',modalidad:'transgest',email_admin:'b@example.invalid'}};
let saved=structuredClone(initial),failWrite=false,emails=0;
const db={transaction:async fn=>{
  const staged=structuredClone(saved);
  const result=await fn({query:async(sql,args)=>{
    const text=sql.trim();
    if(text.startsWith('SELECT email_admin,plan')){assert.match(text,/FOR UPDATE/);return{rows:staged[args[0]]?[staged[args[0]]]:[]};}
    if(text.startsWith('UPDATE empresas')){
      const id=args[args.length-1];assert.ok(staged[id]);
      const match=text.match(/plan=\$(\d+)/);if(match)staged[id].plan=args[Number(match[1])-1];
      return {rows:[]};
    }
    if(text.startsWith('INSERT INTO empresa_productos')){
      assert.ok(staged[args[0]]);if(failWrite)throw Error('simulated product write failure');
      staged[args[0]].modalidad=args[1];return{rows:[]};
    }
    if(text.startsWith('INSERT INTO empresas')){staged.c={plan:args[4],email_admin:args[2]};return{rows:[{id:'c',nombre:args[0]}]};}
    if(text.startsWith('INSERT INTO usuarios'))return{rows:[{id:'user-c'}]};
    throw Error('Unexpected SQL: '+text);
  }});
  saved=staged;return result;
}};
const context={db,require:name=>{assert.equal(name,'../services/companyProducts');return{...products,ensure:async()=>{}};},audit:async()=>{},normalizeBillingMethod:x=>x,
  bcrypt:{hash:async()=> 'test-hash'},crypto:require('node:crypto'),createInvitationForUser:async()=>({url:'https://example.invalid/invite'}),enviarEmail:async()=>{emails++;return{simulado:true};}};
function response(){return{code:200,status(code){this.code=code;return this;},json(data){this.body=data;return this;}};}
async function call(method,route,id,body){const res=response();await handler(method,route,context)({params:{id},body,superadmin:{email:'qa@example.invalid'}},res);return res;}
(async()=>{
  assert.equal(products.validateSelection('planner',undefined),'planner');
  assert.equal(products.validateSelection('pro_planner',undefined),'combinado');
  for(const mode of ['invalid','__proto__',null])assert.throws(()=>products.validateSelection('enterprise',mode),{status:400});
  assert.throws(()=>products.validateSelection('planner','transgest'),{status:400});
  const peer=structuredClone(saved.b);
  assert.equal((await call('patch','/empresas/:id','a',{plan:'planner',modalidad:'planner'})).code,200);
  assert.equal(saved.a.plan,'planner');assert.equal(saved.a.modalidad,'planner');assert.deepEqual(saved.b,peer);
  const snapshot=structuredClone(saved);
  assert.equal((await call('patch','/empresas/:id','a',{plan:'planner',modalidad:'transgest'})).code,400);assert.deepEqual(saved,snapshot);
  failWrite=true;
  assert.equal((await call('patch','/empresas/:id','a',{plan:'enterprise',modalidad:'combinado'})).code,500);assert.deepEqual(saved,snapshot);
  failWrite=false;
  assert.equal((await call('patch','/empresas/:id','a',{plan:'enterprise',modalidad:'combinado'})).code,200);
  assert.equal(saved.a.modalidad,'combinado');
  assert.equal((await call('patch','/empresas/:id','a',{modalidad:'transgest'})).code,200);
  assert.equal(saved.a.plan,'enterprise');assert.equal(saved.a.modalidad,'transgest');
  assert.equal((await call('patch','/empresas/:id','missing',{modalidad:'transgest'})).code,404);
  const create={nombre_empresa:'Empresa QA',nombre_admin:'QA',email_admin:'qa@example.invalid',origen_comercial:'directa',plan:'enterprise',modalidad:'combinado'};
  failWrite=true;
  assert.equal((await call('post','/empresas',null,create)).code,500);assert.equal(saved.c,undefined);assert.equal(emails,0);
  failWrite=false;
  assert.equal((await call('post','/empresas',null,{...create,modalidad:'__proto__'})).code,400);assert.equal(emails,0);
  assert.equal((await call('post','/empresas',null,create)).code,201);
  assert.equal(saved.c.plan,'enterprise');assert.equal(saved.c.modalidad,'combinado');assert.equal(emails,1);
  console.log('PASS: actual admin handlers save product and edition atomically, reject invalid selections, roll back both fields and isolate companies; simulated DB and mail.');
})().catch(e=>{console.error(e);process.exitCode=1;});
