import { incidentAccessibleText, incidentDetailParts, isAutomaticIncident } from './agendaIncident';

test('automatic agenda incident exposes reason, order, action and resolution to assistive text', () => {
  const event = {
    titulo:'Carga prevista sin finalizar · PED-TEST-1', source_type:'pedido',
    cause_code:'carga_sin_finalizar', pedido_numero:'PED-TEST-1',
    explanation:'La carga prevista ha pasado.', recommended_action:'Confirmar con el conductor.',
    resolution_condition:'Carga confirmada.',
  };
  expect(isAutomaticIncident(event)).toBe(true);
  expect(incidentDetailParts(event).map(([label]) => label)).toEqual(['Motivo', 'Pedido', 'Qué hacer', 'Se resuelve cuando']);
  expect(incidentAccessibleText(event)).toContain('Qué hacer: Confirmar con el conductor.');
  expect(incidentAccessibleText({ titulo:'Tarea manual' })).toBe('Tarea manual');
});
