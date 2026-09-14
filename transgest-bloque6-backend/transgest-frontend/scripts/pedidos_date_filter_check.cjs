const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/pages/Pedidos.js'), 'utf8');
const range = source.match(/function defaultTraficoRangeLocal\(now = new Date\(\)\) \{[\s\S]*?\n\}/)[0];
const active = source.match(/const hayFiltrosPedidos = ([^;]+);/)[1];
const query = source.slice(source.indexOf('      const params = {};', source.indexOf('const cargar = useCallback')), source.indexOf('      const cargarPeriodoCompleto', source.indexOf('const cargar = useCallback')));
function params(overrides = {}) {
 const context = {filtroEst:'todos', debouncedQ:'', filtroCliente:'', filtroFechasCustom:false, filtroMes:'', filtroDesde:'', filtroHasta:'', mostrarHistorico:false, filtroSinAsignacion:false, filtroPendienteCompletar:false, filtroColaborador:false, soloCriticos:false, ESTADOS_ACTIVOS:['confirmado','en_curso'], formatDateInputLocal:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'), ...overrides};
 return vm.runInNewContext(`${range}; const hayFiltrosPedidos = ${active}; ${query}; params`,context);
}
const today = new Date();
const iso = [today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
assert.equal(params().desde,iso);
assert.equal(params().hasta,undefined);
for (const filters of [{debouncedQ:'antiguo'},{filtroCliente:'cliente-1'},{filtroEst:'entregado'},{filtroSinAsignacion:true},{filtroPendienteCompletar:true},{filtroColaborador:true},{soloCriticos:true},{mostrarHistorico:true}]) assert.equal(params(filters).desde,undefined,JSON.stringify(filters));
assert.equal(params({debouncedQ:'   '}).desde,iso);
const dated=params({filtroFechasCustom:true,filtroDesde:'2025-01-01',filtroHasta:'2025-01-31',debouncedQ:'pedido'});
assert.equal(dated.desde,'2025-01-01');assert.equal(dated.hasta,'2025-01-31');
assert.equal(params({filtroFechasCustom:true,filtroHasta:'2025-12-31'}).desde,undefined);
assert.equal(params().desde,iso);
console.log('OK: today onwards, historical filters, explicit ranges and reset');
