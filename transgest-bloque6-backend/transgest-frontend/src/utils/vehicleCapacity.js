// Units follow the body type; capacities always come from this vehicle's record.
const numeric=value=>{const n=Number(String(value??'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null;};
export function capacityUnit(vehicle={}) {
 const explicit=vehicle.unidad_ocupacion;
 if(['ml','m3','unidades'].includes(explicit))return explicit;
 const type=[vehicle.tipo_carroceria,vehicle.clase].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/cisterna|banera|volquete|volcador|silo|piso movil/.test(type))return 'm3';
 if(/portacoches/.test(type))return 'unidades';
 return 'ml';
}
export function vehicleCapacity(vehicle={}) {
 const unit=capacityUnit(vehicle);
 return {unit,quantity:numeric(unit==='m3'?vehicle.volumen_m3:unit==='unidades'?vehicle.capacidad_unidades:vehicle.metros_carga),
  length:numeric(vehicle.metros_carga),volume:numeric(vehicle.volumen_m3),weight:numeric(vehicle.carga_max_kg),pallets:numeric(vehicle.capacidad_palets)};
}
export function cargoVehicle(form,vehicles=[]) {
 const tractor=vehicles.find(v=>String(v.id)===String(form.vehiculo_id));
 const trailerId=form.remolque_id_manual||form.remolque_id||tractor?.remolque_id;
 if(trailerId)return vehicles.find(v=>String(v.id)===String(trailerId))||null;
 return /rigido/i.test(String(tractor?.clase||'').normalize('NFD').replace(/[\u0300-\u036f]/g,''))?tractor:null;
}
