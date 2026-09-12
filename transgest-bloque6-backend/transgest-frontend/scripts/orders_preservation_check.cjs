const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),parser=require('@babel/parser');
const relative='transgest-bloque6-backend/transgest-frontend/src/pages/Pedidos.js';
const before=process.argv[2]?fs.readFileSync(process.argv[2],'utf8'):execFileSync('git',['show','c266e24:'+relative],{encoding:'utf8',maxBuffer:6e6});
const after=process.argv[3]?fs.readFileSync(process.argv[3],'utf8'):execFileSync('git',['show',':'+relative],{encoding:'utf8',maxBuffer:6e6});
const clean=n=>JSON.parse(JSON.stringify(n,(k,v)=>['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(k)?undefined:v));
function nodes(s){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type)out.push(n);for(const [k,v]of Object.entries(n)){if(k==='loc')continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}walk(parser.parse(s,{sourceType:'module',plugins:['jsx']}));return out;}
const old=nodes(before),current=nodes(after),a=old.filter(n=>n.type==='FunctionDeclaration'&&n.async),b=current.filter(n=>n.type==='FunctionDeclaration'&&n.async);
assert.equal(a.length,b.length);a.forEach((n,i)=>assert.deepEqual(clean(n),clean(b[i]),'Async handler '+n.id.name));
const variables=['cargar','pedidosConMeta','pedidosFiltrados','resumenCriticos','pedidosVisibles','pedidosRenderList','selectedPedidosOperables'];
for(const name of variables){const find=list=>list.filter(n=>n.type==='VariableDeclarator'&&n.id?.name===name);assert.deepEqual(clean(find(old)),clean(find(current)),name);}
for(const name of ['calcImporte','getPedidoOperationalFlags','getPedidoStateValidationIssues','getPedidoPriorityMeta']){const find=list=>list.find(n=>n.type==='FunctionDeclaration'&&n.id?.name===name);assert.deepEqual(clean(find(old)),clean(find(current)),name);}
const api=list=>list.filter(n=>n.type==='ImportDeclaration'&&n.source.value.includes('services/api'));assert.deepEqual(clean(api(old)),clean(api(current)));
console.log(`PASS ${a.length} async handlers, 7 data/selection calculations, 4 operational calculations and API imports unchanged.`);
