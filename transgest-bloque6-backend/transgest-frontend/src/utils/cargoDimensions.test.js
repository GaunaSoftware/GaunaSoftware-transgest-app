import {fullLoadLength,palletLayout,cargoCount,cargoLength,cargoPayload,updateCargo} from './cargoDimensions';

test('calculates complete rows and their occupied width',()=>{
 expect(palletLayout(1,'europeo')).toEqual({length:0.8,width:1.2});
 expect(palletLayout(2,'europeo')).toEqual({length:0.8,width:2.4});
 expect(palletLayout(33,'europeo')).toEqual({length:13.2,width:2.4});
 expect(palletLayout(26,'americano')).toEqual({length:13,width:2.4});
 expect(palletLayout(3,'medio')).toEqual({length:0.6,width:2.4});
 expect(palletLayout(4,'europeo',true)).toEqual(palletLayout(2,'europeo'));
});
test('old duplicated fields count once and the old default cannot mask pallets',()=>{
 const old={bultos:12,palets_cantidad:6,palets_tipo:'europeo',metros_lineales:13.65};
 expect(cargoCount(old)).toBe(6);
 expect(cargoLength(old)).toBe(2.4);
 expect(cargoPayload(old)).toMatchObject({bultos:6,palets_cantidad:6,metros_lineales:2.4,carga_largo_m:2.4});
 expect(cargoCount({bultos:12,palets_cantidad:''})).toBe(12);
});
test('quantity and pallet type update automatic dimensions',()=>{
 let p=updateCargo({palets_tipo:'europeo'},'palets_cantidad',2);
 expect(p).toMatchObject({bultos:2,carga_largo_m:0.8,carga_ancho_m:2.4});
 p=updateCargo(p,'palets_cantidad',3);
 expect(p.carga_largo_m).toBe(1.2);
 p=updateCargo(p,'palets_tipo','americano');
 expect(p.carga_largo_m).toBe(2);
});
test('manual dimensions survive later quantity edits and are used by groupage',()=>{
 let p=updateCargo({palets_tipo:'europeo'},'palets_cantidad',2);
 p=updateCargo(p,'carga_largo_m','2,5');
 p=updateCargo(p,'carga_ancho_m','2,1');
 p=updateCargo(p,'palets_cantidad',4);
 expect(cargoLength(p)).toBe(2.5);
 expect(p.carga_ancho_m).toBe('2,1');
 expect(cargoPayload(p).metros_lineales).toBe(2.5);
 expect(cargoLength({palets_tipo:'granel',bultos:4,carga_largo_m:3})).toBe(3);
});

test('full load uses explicit trailer, linked trailer, or 13.65m fallback',()=>{
 const vehicles=[{id:'tractor',remolque_id:'long'},{id:'long',metros_carga:15},{id:'short',metros_carga:'12,5'}];
 expect(fullLoadLength({vehiculo_id:'tractor'},vehicles)).toBe(15);
 expect(fullLoadLength({vehiculo_id:'tractor',remolque_id_manual:'short'},vehicles)).toBe(12.5);
 expect(fullLoadLength({},vehicles)).toBe(13.65);
 expect(fullLoadLength({remolque_id_manual:'missing'},vehicles)).toBe(13.65);
});
