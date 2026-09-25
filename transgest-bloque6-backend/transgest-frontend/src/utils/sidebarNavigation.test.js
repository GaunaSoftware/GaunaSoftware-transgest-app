import { flattenNavigation, organizeSidebar } from './sidebarNavigation';
import { normalizePlan, planHasFeature } from './planFeatures';

const item = (id, children) => ({ id, label: id, ...(children ? { children } : {}) });

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

test('Go, Pro, Intelligence and migrated Control can import, without enabling AI in Go', () => {
  for (const plan of ['lite', 'profesional', 'enterprise', 'basico']) expect(planHasFeature(plan, 'importacion')).toBe(true);
  expect(normalizePlan('control')).toBe('profesional');
  expect(planHasFeature('lite', 'ai')).toBe(false);
});
