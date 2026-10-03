import {routeMargin} from './routeMargin';
test('no invented tonnes or deprecated customer minimum enter a rate estimate',()=>{
 const rate={tarifa_tipo:'tonelada',precio_base:30,km:300};
 expect(routeMargin(rate).available).toBe(false);
 expect(routeMargin(rate,{minimo_facturable_toneladas:25}).units).toBe(0);
 expect(routeMargin({...rate,minimo_unidades:26}).ingresoTotal).toBe(780);
 expect(routeMargin({...rate,minimo_unidades:26}).margen).toBe(654);
 expect(rate.minimo_unidades).toBeUndefined();
});
