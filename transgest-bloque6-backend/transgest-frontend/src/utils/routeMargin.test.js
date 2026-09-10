import { routeMargin } from './routeMargin';
test('tonne margin uses 24t or the agreed route/client minimum and distance',()=>{
  const route={tarifa_tipo:'tonelada',precio_base:30,km:300};
  expect(routeMargin(route).ingresoTotal).toBe(720);
  expect(routeMargin(route).ingresoKm).toBe(2.4);
  expect(routeMargin(route).margen).toBe(594);
  expect(routeMargin(route,{minimo_facturable_toneladas:'25,5'}).ingresoTotal).toBe(765);
  expect(routeMargin({...route,minimo_unidades:26},{minimo_facturable_toneladas:25}).ingresoTotal).toBe(780);
  expect(routeMargin({...route,minimo_unidades:0,cliente_minimo_facturable_toneladas:0}).units).toBe(24);
  expect(routeMargin({...route,km:0}).ingresoKm).toBe(0);
  expect(route.minimo_unidades).toBeUndefined();
});
