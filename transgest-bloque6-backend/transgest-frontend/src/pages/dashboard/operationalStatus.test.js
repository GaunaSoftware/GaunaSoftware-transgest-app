import {overdueOrder,incidentDescription} from './operationalStatus';
const now=new Date(2026,8,15,10);
test('overdue operations use planned delivery and keep completed trips out',()=>{
 expect(overdueOrder({estado:'en_curso',fecha_carga:'2026-09-10',fecha_descarga:'2026-09-16'},now)).toBe(false);
 expect(overdueOrder({estado:'pendiente',fecha_carga:'2026-09-14'},now)).toBe(true);
 expect(overdueOrder({estado:'en_curso',fecha_descarga:'2026-09-15'},now)).toBe(false);
 for(const estado of ['entregado','facturado','cancelado'])expect(overdueOrder({estado,fecha_descarga:'2026-08-01'},now)).toBe(false);
 expect(overdueOrder({estado:'pendiente'},now)).toBe(false);
});
test('incident description includes the recorded reason',()=>{expect(incidentDescription({estado:'incidencia',incidencia_tipo:'retraso_carga',incidencia_descripcion:'Muelle cerrado'})).toBe('retraso carga: Muelle cerrado');});
