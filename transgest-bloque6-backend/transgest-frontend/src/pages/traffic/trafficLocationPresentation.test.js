import {trafficRouteSummary,trafficTripPresentation} from './trafficLocationPresentation';

test('location summaries use saved cities, preserving complete addresses in the tooltip',()=>{
 const order={numero:'PED-1',origen:'Almacén en Calle Toneleros, 2, Almansa',destino:'Cliente, carretera de Murcia, 28',puntos_carga:JSON.stringify([{ciudad:'Almansa'}]),puntos_descarga:[{poblacion:'Murcia'}],hora_carga:'08:15:00'};
 const view=trafficTripPresentation(order,{direction:'salida',phase:'salida',estimate:false});
 expect(view.origin).toBe('Almansa');expect(view.destination).toBe('Murcia');expect(view.time).toBe('08:15');expect(view.detail).toContain(order.origen);
 expect(trafficRouteSummary({...order,puntos_carga:[],origen:'A'.repeat(100)}).origin.length).toBeLessThanOrEqual(40);
});

test('return and destination labels keep the projection and do not invent missing hours',()=>{
 const order={origen:'Madrid',destino:'Valencia'};
 expect(trafficTripPresentation(order,{direction:'retorno',phase:'salida'}).label).toBe('Retorno');
 expect(trafficTripPresentation(order,{direction:'salida',phase:'descarga'})).toEqual(expect.objectContaining({label:'Descarga prevista',time:''}));
 expect(trafficTripPresentation({...order,puntos_descarga:[{ventana:'10:00 - 12:00'}]},{phase:'descarga'}).time).toBe('10:00 - 12:00');
});
