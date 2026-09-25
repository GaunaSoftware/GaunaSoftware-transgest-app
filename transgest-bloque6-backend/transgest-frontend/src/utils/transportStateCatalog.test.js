import { TRANSPORT_STATES, RECOMMENDED_STATE_FLOW, transportStateMeta } from './transportStateCatalog';

test('shared transport states keep incident and execution separate', () => {
  for (const key of ['pendiente','confirmado','espera_carga','cargando','en_curso','espera_descarga','descarga','entregado','incidencia','cancelado']) {
    expect(transportStateMeta(key).label).toBeTruthy();
    expect(transportStateMeta(key).color).toMatch(/^#[0-9a-f]{6}$/i);
  }
  expect(TRANSPORT_STATES.incidencia.incident).toBe(true);
  expect(TRANSPORT_STATES.entregado.final).toBe(true);
  expect(TRANSPORT_STATES.en_curso.final).toBe(false);
  expect(TRANSPORT_STATES.colaborador).toBeUndefined();
  expect(RECOMMENDED_STATE_FLOW.cargando).toBe('en_curso');
  expect(transportStateMeta('estado_legacy').description).toBe('Estado no catalogado');
});
