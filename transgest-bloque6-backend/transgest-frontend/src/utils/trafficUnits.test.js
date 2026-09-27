import {trafficUnits} from './trafficUnits';
test('a physical journey is one unit without merging commercial orders',()=>{
 const trip={id:'t',pedidos_count:2,fecha_inicio:'2026-09-26'};
 const orders=[{id:'a',importe:200,viaje_operativo:trip},{id:'b',importe:300,viaje_operativo:trip},{id:'c'}];
 const units=trafficUnits(orders);
 expect(units).toHaveLength(2);expect(units[0]._pedidos).toHaveLength(2);
 expect(units[0].numero).toBe('Grupaje · 2 pedidos');expect(orders[0].importe).toBe(200);
 expect(trafficUnits([orders[1]])[0]._pedidos).toHaveLength(1);
});
