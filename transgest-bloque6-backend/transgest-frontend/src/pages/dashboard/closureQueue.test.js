import { pendingClosureRows, filterPendingClosures } from './closureQueue';
const now = new Date(2026, 8, 15, 12);
const order = (id, date, extra = {}) => ({ id, numero:id, estado:'confirmado', fecha_descarga:date, ...extra });
test('only unfinished past orders enter review, using delivery before loading dates', () => {
  const rows = pendingClosureRows([
    order('yesterday','2026-09-14'), order('week','2026-09-08'), order('old','2026-09-01'),
    order('today','2026-09-15'), order('future','2026-09-16',{fecha_carga:'2026-09-01'}),
    ...['entregado','facturado','cancelado'].map(estado=>order(estado,'2026-09-01',{estado})),
    order('invalid','2026-02-31'), order('missing',''),
    order('load-only','',{fecha_carga:'2026-09-13'}),
  ], now);
  expect(rows.map(r=>[r.order.id,r.days])).toEqual([['yesterday',1],['load-only',2],['week',7],['old',14]]);
  expect(rows.find(r=>r.order.id==='load-only').dateLabel).toBe('Carga prevista');
});
test('filters retain access to historical orders, actual incidents and accent-insensitive searches', () => {
  const rows = pendingClosureRows([
    order('recent','2026-09-14',{cliente_nombre:'Cerámica',estado:'incidencia',incidencia_descripcion:'Avería'}),
    order('boundary','2026-09-08'), order('historical','2026-08-01'),
  ], now);
  expect(filterPendingClosures(rows,'recent','','recent').map(r=>r.order.id)).toEqual(['recent','boundary']);
  expect(filterPendingClosures(rows,'older','','recent').map(r=>r.order.id)).toEqual(['historical']);
  expect(filterPendingClosures(rows,'incident','','recent').map(r=>r.order.id)).toEqual(['recent']);
  expect(filterPendingClosures(rows,'all','ceramica','recent')).toHaveLength(1);
  expect(filterPendingClosures(rows,'all','averia','recent')).toHaveLength(1);
  expect(filterPendingClosures(rows,'all','','oldest')[0].order.id).toBe('historical');
  expect(filterPendingClosures(rows,'all','absent','recent')).toEqual([]);
});
test('calendar days remain exact across a daylight-saving transition', () => {
  const rows=pendingClosureRows([order('dst','2026-03-28')],new Date(2026,2,30,0,30));
  expect(rows[0].days).toBe(2);
});
