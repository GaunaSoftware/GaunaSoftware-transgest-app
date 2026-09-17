export const PLANNER_MODULES = [
  ['pedidos', 'Cargas'],
  ['muelles', 'Muelles y horarios'], ['palets', 'Almacén y stock'],
  ['ia', 'Intelligence'], ['colaboradores', 'Proveedores de transporte'],
  ['clientes', 'Clientes / Destinatarios'], ['documentos', 'Documentos'], ['facturacion', 'Facturación'], ['empresa', 'Empresa'],
];

export function hasProduct(user, product) {
  const enabled = Array.isArray(user?.productos) ? user.productos : ['transgest'];
  return enabled.includes(product);
}
export function visiblePlannerModules(user, puedeVer) {
  if (!hasProduct(user, 'planner')) return [];
  if (!['gerente', 'trafico', 'administrativo', 'contable', 'visualizador'].includes(user?.rol)) return [];
  return PLANNER_MODULES.filter(([id]) =>
    (hasProduct(user, 'transgest') || !['viajes','choferes','gestion_trafico','vehiculos','ia'].includes(id)) &&
    (id !== 'muelles' || user.rol !== 'contable') &&
    (id !== 'documentos' || (puedeVer('palets') && puedeVer('pedidos'))) &&
    puedeVer(['muelles', 'viajes'].includes(id) ? 'pedidos' : id));
}

export function isPlannerRoute(path, product, search = '') {
  return path === '/planner' || path.startsWith('/planner/') ||
    (product === 'planner' && new URLSearchParams(search).get('workspace') !== 'tms');
}
