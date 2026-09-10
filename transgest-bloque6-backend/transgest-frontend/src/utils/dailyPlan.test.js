import { dailyDeliveries } from './dailyPlan';
test('multiple orders share one numbered, reorderable delivery sequence',()=>{
  const orders=[{id:'a',numero:'A',puntos_descarga:[{ciudad:'Aspe'},{ciudad:'Burgos'}]},{id:'b',numero:'B',destino:'Alicante'}];
  const ordered=dailyDeliveries(orders,['b:0','a:1','a:0']);
  expect(ordered.map(stop=>stop.lugar)).toEqual(['Alicante','Burgos','Aspe']);
  expect(ordered.map(stop=>stop.orden)).toEqual([1,2,3]);
  expect(dailyDeliveries(orders,['removed:0']).length).toBe(3);
  expect(orders[0].puntos_descarga[0].ciudad).toBe('Aspe');
});
