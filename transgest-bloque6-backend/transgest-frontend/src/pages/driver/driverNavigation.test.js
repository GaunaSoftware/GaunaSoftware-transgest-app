import {nextStopDirections,plannedLoadWeight,canPhotographCargo} from './driverNavigation';
import {driverStops} from './driverStops';
import {normalizeChoferPasos} from './driverSupport';
jest.mock('../../services/api',()=>({}));
const order={estado:'confirmado',peso_kg:200,origen:'Madrid',destino:'Valencia'};
test('navigation uses the next stop, never the current location as destination',()=>{
 const [load,unload]=driverStops(order);
 expect(new URL(nextStopDirections(order,{})).searchParams.get('destination')).toBe('Madrid');
 expect(new URL(nextStopDirections(order,{paradas:{[load.id]:{carga_ok:true}}})).searchParams.get('destination')).toBe('Valencia');
 expect(nextStopDirections(order,{paradas:{[load.id]:{carga_ok:true},[unload.id]:{firma_entrega:true}}})).toBeNull();
 expect(new URL(nextStopDirections(order,{}, {...load,lat:40,lng:-3})).searchParams.get('destination')).toBe('40,-3');
 const capa={...order,origen:'CEMENTOS CAPA',puntos_carga:[{nombre:'Cementos Capa',direccion:'Av. Murcia 12',ciudad:'Abanilla',provincia:'Murcia'}]};
 expect(new URL(nextStopDirections(capa,{})).searchParams.get('destination')).toContain('Abanilla');
 expect(new URL(nextStopDirections(capa,{}, {nombre:'Cementos Capa',municipio:'Abanilla',provincia:'Murcia'})).searchParams.get('destination')).toBe('Abanilla, Murcia');
 expect(nextStopDirections(capa,{}, {nombre:'Cementos Capa',provincia:'Murcia'})).toBeNull();
});
test('cargo photo requires an actual completed loading and weight keeps the planned baseline',()=>{
 const [load]=driverStops(order);
 expect(canPhotographCargo(order,{})).toBe(false);
 expect(canPhotographCargo(order,{paradas:{[load.id]:{carga_proceso:true}}})).toBe(false);
 expect(canPhotographCargo(order,{paradas:{[load.id]:{carga_ok:true}}})).toBe(true);
 expect(plannedLoadWeight(order,load,{})).toBe(200);
 expect(plannedLoadWeight({...order,peso_kg:220},load,{peso_planificado_kg:200})).toBe(200);
 expect(plannedLoadWeight(order,load,{peso_planificado_kg:null})).toBeNull();
 expect(normalizeChoferPasos({peso_variacion_confirmacion:'confirmo'}).peso_variacion_confirmacion).toBe('confirmo');
});
