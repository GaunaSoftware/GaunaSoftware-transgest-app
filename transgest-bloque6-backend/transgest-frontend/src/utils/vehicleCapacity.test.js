import {capacityUnit,vehicleCapacity,cargoVehicle} from './vehicleCapacity';
test('units are derived from body, with explicit overrides, but no default capacities',()=>{
 expect(capacityUnit({clase:'Remolque - Bañera (volcador)'})).toBe('m3');
 expect(capacityUnit({tipo_carroceria:'Cisterna'})).toBe('m3');
 expect(capacityUnit({tipo_carroceria:'Piso móvil'})).toBe('m3');
 expect(capacityUnit({tipo_carroceria:'Portacoches'})).toBe('unidades');
 expect(capacityUnit({tipo_carroceria:'Frigorífico'})).toBe('ml');
 expect(vehicleCapacity({tipo_carroceria:'Cisterna',volumen_m3:'28,5',carga_max_kg:25000,metros_carga:12})).toMatchObject({unit:'m3',quantity:28.5,weight:25000});
 expect(vehicleCapacity({})).toMatchObject({quantity:null,weight:null});
 expect(vehicleCapacity({tipo_carroceria:'Cisterna',unidad_ocupacion:'ml',metros_carga:8})).toMatchObject({unit:'ml',quantity:8});
});
test('a selected trailer is authoritative and a rigid does not require a trailer',()=>{
 const v=[{id:'rigid',clase:'Camión rígido',metros_carga:6},{id:'tractor',clase:'Tractora',remolque_id:'trailer'},{id:'trailer',metros_carga:12}];
 expect(cargoVehicle({vehiculo_id:'rigid'},v)).toBe(v[0]);
 expect(cargoVehicle({vehiculo_id:'tractor'},v)).toBe(v[2]);
 expect(cargoVehicle({vehiculo_id:'tractor',remolque_id_manual:'invalid'},v)).toBeNull();
});
