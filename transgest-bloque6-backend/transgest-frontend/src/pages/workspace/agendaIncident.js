export const isAutomaticIncident = event => Boolean(event?.source_type && event?.cause_code);

export function incidentDetailParts(event) {
  if (!isAutomaticIncident(event)) return [];
  return [
    ['Motivo', event.explanation || event.descripcion],
    ['Pedido', event.pedido_numero || event.metadata?.pedido_numero || event.pedido_id],
    ['Qué hacer', event.recommended_action],
    ['Se resuelve cuando', event.resolution_condition],
    ...(event.resolved_at ? [['Resuelta', event.resolution_reason || 'Causa desaparecida']] : []),
  ].filter(([, value]) => String(value || '').trim());
}

export function incidentAccessibleText(event) {
  return [event?.titulo, ...incidentDetailParts(event).map(([label, value]) => `${label}: ${value}`)]
    .filter(Boolean).join('. ');
}
