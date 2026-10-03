import { orderFocusFilters } from './orderFocusFilters';

test('dashboard scope keeps exact dates and an empty active snapshot', () => {
  expect(orderFocusFilters({ desde:'2026-10-02', hasta:'2026-10-02' })).toEqual({from:'2026-10-02',to:'2026-10-02',ids:null,title:''});
  expect(orderFocusFilters({ pedido_ids:[] }).ids).toEqual([]);
  expect(orderFocusFilters({ desde:'tomorrow' }).from).toBe('');
  expect(orderFocusFilters({ pedido_id:'single' }).ids).toBeNull();
  expect(orderFocusFilters(null).ids).toBeNull();
});
