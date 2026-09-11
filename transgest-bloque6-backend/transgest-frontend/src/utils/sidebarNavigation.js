// Receives the navigation AFTER role, plan and feature filters have run in App.
// Presentation groups never grant access to a new route.
export function flattenNavigation(items) {
  return items.flatMap(item => [item, ...flattenNavigation(item.children || [])]);
}

export function organizeSidebar(modules, financeTabs, role) {
  if (["chofer", "cliente", "cliente_portal", "colaborador", "mecanico", "responsable_taller"].includes(role)) return modules;
  const roots = modules.flatMap(group => group.items || []);
  const all = flattenNavigation(roots);
  const byId = new Map(all.map(item => [item.id, item]));
  const used = new Set();
  const take = (id, label) => {
    const item = byId.get(id);
    if (!item) return null;
    flattenNavigation([item]).forEach(node => used.add(node.id));
    return { ...item, label: label || item.label };
  };
  const group = (id, label, iconId, children) => {
    const visible = children.filter(Boolean);
    return visible.length ? { id, label, icon: byId.get(iconId)?.icon || visible.find(item => item.icon)?.icon, children: visible } : null;
  };
  const finance = take("facturacion");
  const items = [
    take("dashboard", "Dashboard"), take("agenda", "Agenda"), take("ia", "TransGest Intelligence"),
    group("nav_operaciones", "Operaciones", "pedidos", [
      take("pedidos", "Pedidos / tráfico"), take("gestion_trafico", "Mesa de tráfico"), take("control_tower", "Control Tower"),
      take("solicitudes", "Peticiones de viaje"), take("calculador_portes", "Calculador de portes"), take("plan_diario"), take("excepciones"),
    ]),
    group("nav_clientes", "Clientes", "clientes", [
      take("clientes", "Clientes"),
      group("nav_rutas_tarifas", "Rutas y tarifas", "rutas", [take("rutas", "Rutas"), take("tarifas", "Tarifas")]),
      take("palets", "Gestión de almacén"),
    ]),
    group("nav_flota", "Flota", "vehiculos", [take("choferes", "Conductores"), take("vehiculos", "Vehículos"), take("taller", "Taller"), take("colaboradores", "Colaboradores")]),
    group("nav_finanzas", "Finanzas", "facturacion_grupo", [
      ...(finance ? financeTabs.map(tab => ({ id: `finance-${tab.value}`, label: tab.label, target: finance.id, financeTab: tab.value, icon: finance.icon })) : []),
      group("nav_informes", "Informes", "informes_grupo", [take("informes", "Informes de gestión"), take("explotacion", "Explotación"), take("objetivos", "Objetivos")]),
      take("contabilidad", "Contabilidad"), take("gastos_estructura", "Gastos de estructura"), take("nominas", "Nóminas"), take("hojas_ruta", "Hojas de ruta"),
    ]),
    group("nav_gestion", "Gestión", "empresa", [
      take("control_horario", "Control horario"),
      group("nav_configuracion", "Configuración", "empresa", [take("avisos", "Avisos"), take("empresa", "Mi empresa"), take("usuarios", "Usuarios y roles"), take("importacion", "Importación"), take("mi_cuenta", "Mi cuenta")]),
      take("actividad", "Trazabilidad"), take("documentos", "Documentación"),
    ]),
  ].filter(Boolean);
  // Keep any future/unknown accessible leaves reachable without duplicating routes.
  const remaining = all.filter(item => !item.children?.length && !used.has(item.id));
  if (remaining.length) items.push({ id: "nav_otros", label: "Más opciones", children: remaining });
  return [{ titulo: "", items }];
}
