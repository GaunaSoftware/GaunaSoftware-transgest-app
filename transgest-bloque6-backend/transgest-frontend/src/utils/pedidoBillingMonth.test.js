import { pedidoOriginalMonth } from './pedidoBillingMonth';

test('usa el mes del viaje y no el de creacion ni el cierre tardio', () => {
  expect(pedidoOriginalMonth({fecha_pedido:'2026-07-01',fecha_carga:'2026-08-30',fecha_descarga:'2026-08-31',fecha_entrega:'2026-09-08'})).toBe('2026-08');
  expect(pedidoOriginalMonth({fecha_pedido:'2026-07-01',fecha_carga:'2026-08-30',fecha_entrega:'2026-09-08'})).toBe('2026-08');
  expect(pedidoOriginalMonth({fecha_carga:'2025-12-31',fecha_descarga:'2026-01-01'})).toBe('2026-01');
});

test('ignora fechas invalidas y conserva compatibilidad con pedidos antiguos', () => {
  expect(pedidoOriginalMonth({fecha_descarga:'2026-02-30',fecha_carga:'2026-02-28'})).toBe('2026-02');
  expect(pedidoOriginalMonth({fecha_pedido:'2026-07-13'})).toBe('2026-07');
  expect(pedidoOriginalMonth({})).toBe('');
});
