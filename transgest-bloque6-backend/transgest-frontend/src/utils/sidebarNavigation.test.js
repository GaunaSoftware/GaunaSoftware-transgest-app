import { flattenNavigation, organizeSidebar } from './sidebarNavigation';
import { normalizePlan, planHasFeature } from './planFeatures';

const item = (id, children) => ({ id, label: id, ...(children ? { children } : {}) });

test('Localización belongs to Operations once and remains hidden without its upstream permission', () => {
  const modules = [{ items: [item('pedidos'), item('localizacion'), item('vehiculos')] }];
  const entries = organizeSidebar(modules, [], 'gerente')[0].items;
  expect(entries.find(entry => entry.id === 'nav_operaciones').children.map(entry => entry.id)).toEqual(['pedidos', 'localizacion']);
  expect(flattenNavigation(entries).filter(entry => entry.id === 'localizacion')).toHaveLength(1);
  const restricted = organizeSidebar([{ items: [item('pedidos')] }], [], 'trafico')[0].items;
  expect(flattenNavigation(restricted).some(entry => entry.id === 'localizacion')).toBe(false);
});

test('the new navigation keeps only modules already granted to the user', () => {
  const available = [item('dashboard'), item('clientes'), item('rutas'), item('tarifas'),
    item('control_horario'), item('avisos'), item('actividad'), item('empresa'), item('importacion')];
  const result = organizeSidebar([{ items: available }], [], 'gerente');
  const ids = flattenNavigation(result.flatMap(group => group.items)).map(entry => entry.id);
  for (const original of available) expect(ids).toContain(original.id);
  expect(ids).not.toContain('facturacion');
  const clientGroup = ids.includes('nav_clientes') && result[0].items.find(entry => entry.id === 'nav_clientes');
  expect(clientGroup.children[0].id).toBe('clientes');
  expect(clientGroup.children[1].children.map(entry => entry.id)).toEqual(['rutas', 'tarifas']);
});

test('Clientes keeps its icon and contains collaborators, never under Flota', () => {
  const clientIcon = { type: 'client-icon' };
  const modules = [{ items: [
    { ...item('clientes_grupo', [item('clientes'), item('colaboradores')]), icon: clientIcon },
    item('vehiculos'), item('choferes'),
  ] }];
  const result = organizeSidebar(modules, [], 'gerente')[0].items;
  const clients = result.find(entry => entry.id === 'nav_clientes');
  const fleet = result.find(entry => entry.id === 'nav_flota');
  expect(clients.icon).toBe(clientIcon);
  expect(clients.children.map(entry => entry.id)).toEqual(['clientes', 'colaboradores']);
  expect(fleet.children.map(entry => entry.id)).not.toContain('colaboradores');
  expect(flattenNavigation(result).filter(entry => entry.id === 'colaboradores')).toHaveLength(1);
});

test('Go, Pro, Intelligence and migrated Control can import, without enabling AI in Go', () => {
  for (const plan of ['lite', 'profesional', 'enterprise', 'basico']) expect(planHasFeature(plan, 'importacion')).toBe(true);
  expect(normalizePlan('control')).toBe('profesional');
  expect(planHasFeature('lite', 'ai')).toBe(false);
});

test('structure expenses belong to Finance / Costs without granting new permissions',()=>{
  const result=organizeSidebar([{items:[item('gastos_estructura'),item('nominas'),item('hojas_ruta')]}],[],'contable')[0].items;
  const finance=result.find(x=>x.id==='nav_finanzas');
  expect(finance.children.find(x=>x.id==='nav_costes').children.map(x=>x.id)).toEqual(['gastos_estructura']);
  expect(flattenNavigation(result).filter(x=>x.id==='gastos_estructura')).toHaveLength(1);
  expect(flattenNavigation(organizeSidebar([{items:[item('pedidos')]}],[],'trafico')[0].items).some(x=>x.id==='nav_costes')).toBe(false);
});

test('warehouse belongs to Operations once, and grouping never grants a hidden warehouse', () => {
  const available = [{ items: [item('pedidos'), item('palets'), item('control_horario'), item('nominas'), item('hojas_ruta')] }];
  const result = organizeSidebar(available, [], 'gerente')[0].items;
  expect(result.find(x=>x.id==='nav_operaciones').children.map(x=>x.id)).toEqual(['pedidos','palets']);
  expect(flattenNavigation(result).filter(x=>x.id==='palets')).toHaveLength(1);
  expect(result.find(x=>x.id==='nav_gestion').children.map(x=>x.id)).toEqual(['control_horario']);
  const restricted=organizeSidebar([{items:[item('pedidos')]}],[],'trafico');
  expect(flattenNavigation(restricted[0].items).some(x=>x.id==='palets')).toBe(false);
});

test('GPS is under Operations and Network under Clients, with each permission checked upstream',()=>{
 const entries=organizeSidebar([{items:[item('pedidos'),item('localizacion'),item('clientes_grupo',[item('clientes'),item('network')])]}],[],'gerente')[0].items;
 expect(entries.find(x=>x.id==='nav_operaciones').children.map(x=>x.id)).toContain('localizacion');
 expect(entries.find(x=>x.id==='nav_clientes').children.map(x=>x.id)).toContain('network');
 for(const id of ['localizacion','network'])expect(flattenNavigation(entries).filter(x=>x.id===id)).toHaveLength(1);
});
