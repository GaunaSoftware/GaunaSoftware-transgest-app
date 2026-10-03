const assert=require('node:assert/strict');
const {cargoRows,confirmedCargo}=require('../src/services/supplierCargoConfirmation');
const {fromOrder}=require('../src/services/transportShipments');
const order={mercancia:'Palletized',peso_kg:8000,bultos:8,origen:'Warehouse',destino:'Destination',
 puntos_carga:[{nombre:'Warehouse',direccion:'Street A',ciudad:'Madrid',peso_kg:8000}],
 puntos_descarga:[{nombre:'Destination',direccion:'Street B',ciudad:'Sevilla',peso_kg:8000}]};
const input={verificado_chofer:'true',mercancia_0:'Actual goods',peso_0:'8.000,0',bultos_0:'8',origen_0:'0',embalaje_0:'Pallets'};
assert.equal(cargoRows(order)[0].peso_kg,8000);
assert.throws(()=>confirmedCargo(order,{...input,verificado_chofer:false}),/Contrasta/);
const patch=confirmedCargo(order,input);
assert.equal(patch.peso_kg,8000);assert.equal(patch.puntos_carga[0].mercancia,'Actual goods');assert.equal(patch.puntos_descarga[0].mercancia,'Actual goods');
assert.equal(fromOrder({...order,...patch})[0].mercancia,'Actual goods','document source is the updated order, including explicit old stop values');
const multiple={...order,puntos_descarga:[{direccion:'A',ciudad:'Sevilla',peso_kg:3000,bultos:3},{direccion:'B',ciudad:'Malaga',peso_kg:5000,bultos:5}]};
const multiInput={...input,peso_0:'3000',bultos_0:'3',mercancia_1:'Other goods',peso_1:'5000',bultos_1:'5',origen_1:'0'};
assert.throws(()=>confirmedCargo(multiple,input),/Envío 2/);
const split=confirmedCargo(multiple,multiInput);
assert.equal(split.peso_kg,8000);assert.equal(fromOrder({...multiple,...split}).length,2);
assert.equal(split.puntos_descarga[1].mercancia,'Other goods');
assert.throws(()=>confirmedCargo(multiple,{...multiInput,origen_1:''}),/carga de origen/);
console.log('PASS driver verification, Spanish weights, per-shipment quantities, preserved addresses and document generation exclusively from confirmed order cargo.');
