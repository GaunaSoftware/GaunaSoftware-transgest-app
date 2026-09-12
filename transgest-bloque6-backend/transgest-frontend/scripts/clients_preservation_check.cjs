const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),parser=require('@babel/parser');
const clean=n=>JSON.parse(JSON.stringify(n,(k,v)=>['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(k)?undefined:v));
function nodes(s){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type)out.push(n);for(const [k,v] of Object.entries(n)){if(k==='loc')continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}walk(parser.parse(s,{sourceType:'module',plugins:['jsx']}));return out;}
let count=0;
for(const file of ['Clientes.js','Rutas.js']){
 const relative='transgest-bloque6-backend/transgest-frontend/src/pages/'+file;
 const before=nodes(execFileSync('git',['show','085addf:'+relative],{encoding:'utf8',maxBuffer:4e6})),after=nodes(fs.readFileSync('src/pages/'+file,'utf8'));
 // The only intentional handler change is a warning if an older API ignores the optional photo.
 function normalizePhotoNotice(list){for(const n of list){if(n.type==='BlockStatement')n.body=n.body.map(stmt=>stmt.type==='IfStatement'&&stmt.test?.type==='LogicalExpression'&&stmt.test.left?.left?.object?.name==='form'&&stmt.test.left?.left?.property?.name==='imagen_data'?stmt.alternate.body[0]:stmt);}}
 normalizePhotoNotice(after);
 const a=before.filter(n=>n.type==='FunctionDeclaration'&&n.async),b=after.filter(n=>n.type==='FunctionDeclaration'&&n.async);
 assert.equal(a.length,b.length);
 a.forEach((node,i)=>{assert.deepEqual(clean(node),clean(b[i]),file+': '+node.id.name);count++;});
 for(const name of ['routeMargin','rutaEditPayload','getMinimoDescriptor','getMinimoUnidadesRuta','getClienteMinimoToneladas','ordenarRutasPorGrupo']) {
  const match=list=>list.find(n=>(n.type==='FunctionDeclaration'&&n.id?.name===name)||(n.type==='VariableDeclarator'&&n.id?.name===name));
  if(match(before)){assert.deepEqual(clean(match(before)),clean(match(after)),file+': '+name);count++;}
 }
 const imports=list=>list.find(n=>n.type==='ImportDeclaration'&&n.source.value==='../services/api');assert.deepEqual(clean(imports(before)),clean(imports(after)));
}
console.log('PASS: '+count+' client and tariff business handlers/calculations unchanged; API imports unchanged.');
