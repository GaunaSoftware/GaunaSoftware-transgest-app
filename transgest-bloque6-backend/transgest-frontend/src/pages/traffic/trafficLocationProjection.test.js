import {estimateArrival,projectedLocation,locationAgendaRows} from './trafficLocationProjection';

const trip={id:'synthetic',vehiculo_id:'truck',estado:'confirmado',fecha_carga:'2026-09-29',hora_carga:'08:00',fecha_descarga:'2026-10-01',km_ruta:1200,origen:'Madrid',destino:'A Coruña',tipo_viaje:'salida'};
test('a long route remains in transit next day and planned destination is explicit',()=>{
 expect(estimateArrival(trip).getTime()).toBeGreaterThan(new Date('2026-09-30T00:00:00').getTime());
 expect(projectedLocation(trip,'2026-09-30').phase).toBe('ruta');
 expect(projectedLocation(trip,'2026-10-01').phase).toBe('descarga');
 expect(projectedLocation(trip,'2026-10-02')).toBeNull();
});
test('missing kilometres never produces an invented ETA',()=>{
 const result=projectedLocation({...trip,km_ruta:0},'2026-09-30');
 expect(result.arrival).toBeNull();expect(result.estimate).toBe(false);
});
test('return is marked separately; unassigned and cancelled trips are excluded',()=>{
 expect(projectedLocation({...trip,tipo_viaje:'retorno'},'2026-09-29').direction).toBe('retorno');
 expect(projectedLocation({...trip,vehiculo_id:null},'2026-09-29')).toBeNull();
 expect(projectedLocation({...trip,estado:'cancelado'},'2026-09-29')).toBeNull();
});
test('a collaborator truck with a confirmed plate appears without an own-fleet vehicle id',()=>{
 expect(projectedLocation({...trip,vehiculo_id:null,matricula_colaborador:'1234-ABC'},'2026-09-29').phase).toBe('salida');
});
test('collaborators without a trip in the displayed week do not occupy empty rows',()=>{
 const days=['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04'];
 const active={...trip,vehiculo_id:null,colaborador_id:'supplier',colaborador_nombre:'Proveedor',matricula_colaborador:'1234-ABC'};
 const old={...active,id:'old',fecha_carga:'2026-09-01',fecha_descarga:'2026-09-02'};
 expect(locationAgendaRows([old],days)).toEqual([]);
 expect(locationAgendaRows([old,active],days)).toHaveLength(1);
 expect(locationAgendaRows([old,active],days)[0].orders).toHaveLength(1);
});
