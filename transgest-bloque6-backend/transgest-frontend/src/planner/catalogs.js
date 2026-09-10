export async function loadPlannerClients(fetchPage, isActive = () => true) {
  const clients = new Map();
  for (let page = 1; page <= 100 && isActive(); page++) {
    const response = await fetchPage(page, 250);
    const rows = Array.isArray(response) ? response : response?.data || [];
    rows.forEach(client => clients.set(client.id, client));
    if (!response?.pagination?.hasNext) return [...clients.values()];
  }
  if (!isActive()) return [];
  throw new Error('El catalogo supera el limite de carga. Revisa los destinatarios con administracion.');
}
