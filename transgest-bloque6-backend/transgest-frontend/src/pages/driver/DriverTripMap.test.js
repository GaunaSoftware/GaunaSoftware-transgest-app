import { driverRoutePoints } from './DriverTripMap';
test('route markers follow completed loading and active unloading without losing stop data',()=>{
 const points=driverRoutePoints({origen:'A',destino:'B',puntos_carga:JSON.stringify([{direccion:'A',lat:39,lng:-1}]),puntos_descarga:[{direccion:'B',hora:'09:00'},{direccion:'C',estado:'entregado'}]}, {carga_ok:true,posicionado_descarga:true});
 expect(points.map(p=>p.tone.label)).toEqual(['Completada','En curso','Completada']);
 expect(points[0].lat).toBe(39);expect(points[1].hora).toBe('09:00');
});
test('legacy and malformed point lists retain origin/destination and delivered status',()=>{
 const points=driverRoutePoints({origen:'A',destino:'B',puntos_carga:'null',puntos_descarga:'{}',estado:'entregado'});
 expect(points.map(p=>p.label)).toEqual(['A','B']);expect(points.every(p=>p.tone.label==='Completada')).toBe(true);
});
