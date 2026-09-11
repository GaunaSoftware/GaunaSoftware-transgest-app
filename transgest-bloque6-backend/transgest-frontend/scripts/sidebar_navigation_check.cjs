const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parser = require('@babel/parser');
const generate = require('@babel/generator').default;
const babel = require('@babel/core');
const path = require('node:path');
const base = path.resolve(__dirname, '../src');
const code = babel.transformSync(fs.readFileSync(path.join(base, 'utils/sidebarNavigation.js'), 'utf8'), { babelrc:false, configFile:false, plugins:['@babel/plugin-transform-modules-commonjs'] }).code;
const exportsObject = {};
new Function('exports', code)(exportsObject);
const { organizeSidebar, flattenNavigation } = exportsObject;
const app = parser.parse(fs.readFileSync(path.join(base, 'App.js'), 'utf8'), { sourceType:'module', plugins:['jsx'] });
const definitions = new Map(app.program.body.filter(node=>node.type==='VariableDeclaration').flatMap(node=>node.declarations.map(d=>[d.id.name,d.init])));
const tabs = ['resumen','facturas','cobros','pagos','tesoreria','fiscal'].map(value=>({value,label:value}));
let checks = 0;
const leaves = modules => flattenNavigation(modules.flatMap(g=>g.items)).filter(n=>!n.children?.length);
for (const [role,constant] of [['gerente','MODULOS_GERENTE'],['trafico','MODULOS_TRAFICO'],['contable','MODULOS_CONTABLE'],['visualizador','MODULOS_VISUALIZADOR'],['colaborador','MODULOS_COLABORADOR'],['mecanico','MODULOS_RESPONSABLE_TALLER'],['chofer','MODULOS_CHOFER'],['cliente','MODULOS_CLIENTE']]) {
 const original = vm.runInNewContext(`(${generate(definitions.get(constant)).code})`, {IC:new Proxy({}, {get:(_,key)=>key})});
 const before = JSON.stringify(original);
 const organized = organizeSidebar(original,tabs,role);
 const targets = leaves(organized).map(n=>n.target||n.id);
 assert.deepEqual([...new Set(targets)].sort(), Array.from(leaves(original),n=>n.id).sort(),`${role}: preserve accessible routes`);
 assert.equal(JSON.stringify(original),before,'Do not mutate source navigation');
 if (['colaborador','mecanico','chofer','cliente'].includes(role)) assert.equal(organized,original,'Keep portals unchanged');
 if (role==='contable') { assert.equal(organized[0].items.find(item=>item.id==='nav_finanzas').icon,'facturacion','Finance keeps its icon without the manager navigation group');checks++; }
 checks++;
}
const ids = ['dashboard','agenda','ia','pedidos','clientes','vehiculos','choferes','colaboradores','nominas','hojas_ruta','objetivos','facturacion','informes','empresa','usuarios','mi_cuenta','custom_module'];
const source = [{titulo:'Fixture',items:ids.map(id=>({id,label:id}))}];
const organized = organizeSidebar(source,tabs,'gerente');
const nodes = flattenNavigation(organized[0].items);
const childrenOf = id => flattenNavigation(nodes.find(n=>n.id===id).children).map(n=>n.id);
assert.ok(childrenOf('nav_flota').includes('colaboradores'));
assert.ok(childrenOf('nav_finanzas').includes('nominas'));
assert.ok(childrenOf('nav_finanzas').includes('hojas_ruta'));
assert.ok(childrenOf('nav_informes').includes('objetivos'));
assert.ok(childrenOf('nav_configuracion').includes('mi_cuenta'));
assert.deepEqual(organized[0].items.slice(0,3).map(n=>n.id),['dashboard','agenda','ia']);
assert.equal(nodes.filter(n=>n.target==='facturacion').length,6);
checks+=7;
// Exercise every single-route grant. No generated menu may grant another route.
for (const id of ids) {
 const result = organizeSidebar([{titulo:'Limited',items:[{id,label:id}]}],tabs,'gerente');
 assert.deepEqual([...new Set(leaves(result).map(n=>n.target||n.id))],[id]);
 checks++;
}
assert.deepEqual(organizeSidebar([],tabs,'gerente'),[{titulo:'',items:[]}]);checks++;
console.log(`PASS: ${checks} sidebar hierarchy, permission-boundary and route-preservation checks.`);
