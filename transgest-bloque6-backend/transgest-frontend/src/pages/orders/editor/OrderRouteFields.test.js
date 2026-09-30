import { pointDraft } from './OrderRouteFields';

test('un punto nuevo no copia el nombre ni la parada en la dirección postal', () => {
  const draft = pointDraft({
    cliente_id: 'cliente-1',
    origen: 'PEPITO PEREZ',
    puntos_carga: [{ cliente_nombre: 'PEPITO PEREZ', direccion: 'PEPITO PEREZ' }],
  }, 'carga');
  expect(draft.nombre).toBe('PEPITO PEREZ');
  expect(draft.direccion).toBe('');
  expect(draft.cliente_id).toBe('cliente-1');
});
