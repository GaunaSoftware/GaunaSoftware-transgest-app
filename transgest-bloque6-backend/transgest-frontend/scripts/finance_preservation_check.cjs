// Compare protected logic against the pre-redesign revision. Run from the frontend directory.
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const parser = require('@babel/parser');
const relative='transgest-bloque6-backend/transgest-frontend/src/pages/Facturacion.js';
const before=execFileSync('git',['show',`${process.argv[2] || '24abb6f'}:${relative}`],{encoding:'utf8',maxBuffer:4e6});
const after=fs.readFileSync('src/pages/Facturacion.js','utf8');
const parse=s=>parser.parse(s,{sourceType:'module',plugins:['jsx']});
const clean=node=>JSON.parse(JSON.stringify(node,(key,value)=>['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(key)?undefined:value));
function nodes(ast){const result=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type)result.push(n);for(const [k,v]of Object.entries(n)){if(k==='loc')continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}walk(ast);return result;}
const original=nodes(parse(before)),current=nodes(parse(after));
const protectedNames=['cargar','cargarSinFacturar','pedidoFacturableEnPeriodo','ordenarPorFechaCarga','filtradas','facturasPorCliente','pagosProveedorPorColaborador','tableItems','total','cobrado','pendiente','nRect','previsionTesoreria','sinFacturarOrdenados','sinFacturarTotal'];
const checks=[];
for(const name of protectedNames){
 const find=list=>list.find(n=>n.type==='VariableDeclarator'&&n.id?.name===name);
 assert.deepEqual(clean(find(current)),clean(find(original)),`Protected calculation/fetch changed: ${name}`);checks.push(name);
}
const oldHandlers=original.filter(n=>n.type==='FunctionDeclaration'&&n.async);
const newHandlers=current.filter(n=>n.type==='FunctionDeclaration'&&n.async);
assert.equal(newHandlers.length,oldHandlers.length,'Async handler count changed');
for(const [index,n] of oldHandlers.entries()){
 const found=newHandlers[index];
 assert.ok(found,`Missing handler ${n.id.name}`);assert.ok(JSON.stringify(clean(found))===JSON.stringify(clean(n)),`Handler changed: ${n.id.name} at index ${index}`);checks.push(n.id.name);
}
const apiImport=list=>list.find(n=>n.type==='ImportDeclaration'&&n.source.value==='../services/api');
assert.deepEqual(clean(apiImport(original)),clean(apiImport(current)),'API imports changed');
console.log(`PASS: ${checks.length} existing calculations, fetching functions and async handlers unchanged; API imports unchanged.`);
