import { askOperationalDateChoice } from './loadingDateChoice';

const now = new Date('2026-09-29T08:00:00Z');
const order = { estado: 'confirmado', fecha_carga: '2026-09-30' };

test('al marcar cargando ofrece adelantar la fecha prevista a hoy', async () => {
  const confirm = jest.fn().mockResolvedValue(true);
  await expect(askOperationalDateChoice(order, 'cargando', 'trafico', confirm, now))
    .resolves.toEqual({ fecha_carga_accion: 'hoy' });
  expect(confirm.mock.calls[0][0].message).toContain('2026-09-30');
  expect(confirm.mock.calls[0][0].message).toContain('2026-09-29');
});

test('conservar fecha y cancelar son decisiones distintas', async () => {
  await expect(askOperationalDateChoice(order, 'cargando', 'gerente', async () => 'alternate', now))
    .resolves.toEqual({ fecha_carga_accion: 'conservar' });
  await expect(askOperationalDateChoice(order, 'cargando', 'gerente', async () => false, now)).resolves.toBeNull();
});

test('pregunta también al completar la carga si se conservó la fecha prevista', async () => {
  await expect(askOperationalDateChoice({ ...order, estado: 'cargando' }, 'en_curso', 'trafico', async () => 'alternate', now))
    .resolves.toEqual({ fecha_carga_accion: 'conservar' });
});

test('pregunta por la fecha de descarga al descargar o entregar', async () => {
  const delivery = { ...order, estado: 'en_curso', fecha_descarga: '2026-09-30' };
  for (const state of ['espera_descarga', 'descarga', 'entregado']) {
    await expect(askOperationalDateChoice(delivery, state, 'trafico', async () => true, now))
      .resolves.toEqual({ fecha_descarga_accion: 'hoy' });
  }
});

test('no pregunta al chófer ni en una transición repetida', async () => {
  const confirm = jest.fn();
  await expect(askOperationalDateChoice(order, 'cargando', 'chofer', confirm, now)).resolves.toEqual({});
  await expect(askOperationalDateChoice({ ...order, estado: 'cargando' }, 'cargando', 'trafico', confirm, now)).resolves.toEqual({});
  expect(confirm).not.toHaveBeenCalled();
});
