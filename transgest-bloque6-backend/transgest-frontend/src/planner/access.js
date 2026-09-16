export const PLANNER_MODULES = [
  ['pedidos', 'Cargas'], ['viajes', 'Gestión de viajes'], ['choferes', 'Conductores'],
  ['muelles', 'Muelles y horarios'], ['palets', 'Almacén y stock'],
  ['gestion_trafico', 'Planificación de flota'], ['vehiculos', 'Vehículos'],
  ['ia', 'Intelligence'], ['colaboradores', 'Proveedores de transporte'],
  ['clientes', 'Destinatarios'], ['documentos', 'Documentos'], ['empresa', 'Empresa'],
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
    puedeVer(['muelles', 'viajes'].includes(id) ? 'pedidos' : id));
}

export function isPlannerRoute(path, product, search = '') {
  return path === '/planner' || path.startsWith('/planner/') ||
    (product === 'planner' && new URLSearchParams(search).get('workspace') !== 'tms');
}
