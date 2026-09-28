const db = require('./db');
const CATALOG = {here:'HERE',ors:'OpenRouteService',locatel:'Locatel',tacogest:'Tacogest',movildata:'Movildata',geotab:'Geotab',clavei:'ClaveiCon',sage:'Sage',a3:'A3',holded:'Holded',wtransnet:'Wtransnet',verifacti:'Verifacti',aeat:'AEAT directa',openai:'OpenAI',anthropic:'Anthropic',ai_generic:'IA compatible',firma:'Firma electrónica'};
const STATES = ['planned','development','sandbox_verified','pilot','production_ready','degraded'];
const CRITERIA = ['authentication','roundtrip','idempotence','errors_retries','tenant_isolation','logs','monitoring','tests','healthcheck'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function identity(company,provider) { if(!/^[a-z][a-z0-9_]{1,47}$/.test(provider))fail('Identificador de integración no válido'); if(company&&!/^[0-9a-f-]{36}$/i.test(company))fail('Empresa no válida'); return company||'global'; }
function readiness(row,events,now=Date.now()) {
 const applicable=events.filter(e=>e.environment===row.environment&&e.api_version===row.api_version).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)||Number(b.sequence||0)-Number(a.sequence||0));
 const last=criterion=>applicable.find(e=>e.criterion===criterion);
 const missing=CRITERIA.filter(c=>{const e=last(c);return !e?.passed||now-new Date(e.created_at).getTime()>(c==='healthcheck'?864e5:30*864e5)||(c==='healthcheck'&&e.source!=='server_probe');});
 const health=last('healthcheck');
 if(row.api_version==='unspecified')missing.push('api_version');
 const ready=missing.length===0;
 return {missing,ready,last_test:applicable.find(e=>['health','evidence'].includes(e.kind))?.created_at||null,last_error:health?.passed===false?health.reference:null,health:!health?'not_tested':now-new Date(health.created_at)>864e5?'stale':health.passed?'healthy':'failed',effective_state:['production_ready','sandbox_verified','pilot'].includes(row.state)&&!ready?'degraded':row.state};
}
async function list(company) {
 const scope=identity(company,'registry');
 const rows=(await db.query('SELECT * FROM integration_registry WHERE scope_key=$1 ORDER BY provider',[scope])).rows;
 const events=rows.length?(await db.query('SELECT * FROM integration_registry_events WHERE registry_id=ANY($1::uuid[]) ORDER BY created_at DESC,sequence DESC',[rows.map(r=>r.id)])).rows:[];
 const providers=new Set([...Object.keys(CATALOG),...rows.map(r=>r.provider)]);
 return {states:STATES,criteria:CRITERIA,rows:[...providers].map(provider=>{const row=rows.find(r=>r.provider===provider)||{provider,state:'planned',environment:'sandbox',api_version:'unspecified',revision:0};const history=events.filter(e=>e.registry_id===row.id);return {...row,label:CATALOG[provider]||provider,...readiness(row,history),evidence:history};})};
}
async function change(company,provider,input,actor) {
 const scope=identity(company,provider);
 return db.transaction(async tx=>{
  if(company&&!(await tx.query('SELECT id FROM empresas WHERE id=$1',[company])).rows.length)fail('Empresa no encontrada',404);
  await tx.query('INSERT INTO integration_registry(scope_key,empresa_id,provider) VALUES($1,$2,$3) ON CONFLICT(scope_key,provider) DO NOTHING',[scope,company||null,provider]);
  const row=(await tx.query('SELECT * FROM integration_registry WHERE scope_key=$1 AND provider=$2 FOR UPDATE',[scope,provider])).rows[0];
  if(Number(input.revision)!==(row.revision===1&&Number(input.revision)===0?0:row.revision))fail('El registro cambió. Recarga antes de guardar.',409);
  const env=input.environment??row.environment,version=String(input.api_version??row.api_version).trim(),state=input.state??row.state;
  if(!['sandbox','production'].includes(env)||!STATES.includes(state)||!version||version.length>80)fail('Estado, entorno o versión no válidos');
  const event=async(kind,criterion,passed,reference,source)=>tx.query('INSERT INTO integration_registry_events(registry_id,kind,criterion,passed,reference,source,environment,api_version,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.id,kind,criterion,passed,reference,source,env,version,String(actor||'superadmin')]);
  if(input.evidence){const e=input.evidence; if(!CRITERIA.includes(e.criterion)||e.criterion==='healthcheck'||typeof e.passed!=='boolean'||typeof e.reference!=='string'||e.reference.trim().length<8||e.reference.length>1000)fail('Evidencia inválida: referencia verificable y criterio requerido. Salud se registra desde la prueba real.');await event('evidence',e.criterion,e.passed,e.reference.trim(),'superadmin_attestation');}
  const events=(await tx.query('SELECT * FROM integration_registry_events WHERE registry_id=$1 ORDER BY created_at DESC,sequence DESC',[row.id])).rows;
  if(['sandbox_verified','pilot','production_ready'].includes(state)){
   const gate=readiness({...row,environment:env,api_version:version},events);
   if(!gate.ready||(state==='production_ready'&&env!=='production')||(state==='sandbox_verified'&&env!=='sandbox'))fail('Faltan evidencias vigentes para este estado: '+gate.missing.join(', '),409);
  }
  await event('state',null,null,state,'superadmin');
  await tx.query('UPDATE integration_registry SET environment=$2,api_version=$3,state=$4,revision=revision+1,updated_at=now() WHERE id=$1',[row.id,env,version,state]);
  return {ok:true};
 });
}
// Called ONLY by trusted server-side probes. Never accept health from a client payload.
async function recordProbe(company,provider,{ok,reference,environment='sandbox',apiVersion='unspecified'}) {
 const scope=identity(company,provider);
 await db.transaction(async tx=>{
  await tx.query('INSERT INTO integration_registry(scope_key,empresa_id,provider) VALUES($1,$2,$3) ON CONFLICT(scope_key,provider) DO NOTHING',[scope,company||null,provider]);
  const row=(await tx.query('SELECT * FROM integration_registry WHERE scope_key=$1 AND provider=$2 FOR UPDATE',[scope,provider])).rows[0];
  await tx.query("INSERT INTO integration_registry_events(registry_id,kind,criterion,passed,reference,source,environment,api_version,actor) VALUES($1,'health','healthcheck',$2,$3,'server_probe',$4,$5,'provider_probe')",[row.id,ok===true,String(reference|| (ok?'Conexión verificada':'Prueba fallida')).slice(0,1000),environment,apiVersion]);
  await tx.query("UPDATE integration_registry SET state=CASE WHEN $2=false AND state IN ('production_ready','pilot','sandbox_verified') THEN 'degraded' ELSE state END,revision=revision+1,updated_at=now() WHERE id=$1",[row.id,ok===true]);
 });
}
async function invalidate(company,provider,client=null) {
 identity(company,provider);
 const work=async tx=>{
 const rows=(await tx.query('SELECT * FROM integration_registry WHERE provider=$1 AND ($2::uuid IS NULL OR empresa_id=$2) FOR UPDATE',[provider,company||null])).rows;
 for(const row of rows){
 await tx.query("INSERT INTO integration_registry_events(registry_id,kind,criterion,passed,reference,source,environment,api_version,actor) VALUES($1,'definition','healthcheck',false,'Configuración modificada; repetir prueba','configuration_change',$2,$3,'configuration')",[row.id,row.environment,row.api_version]);
 await tx.query("UPDATE integration_registry SET state=CASE WHEN state IN ('production_ready','pilot','sandbox_verified') THEN 'degraded' ELSE state END,revision=revision+1,updated_at=now() WHERE id=$1",[row.id]);
 }
 };
 return client?work(client):db.transaction(work);
}
module.exports={invalidate,CATALOG,STATES,CRITERIA,readiness,list,change,recordProbe};
