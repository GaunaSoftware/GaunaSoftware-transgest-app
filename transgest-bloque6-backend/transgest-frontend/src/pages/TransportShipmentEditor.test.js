import {initialShipmentRows} from './TransportShipmentEditor';

test('additional unloads inherit general merchandise while retaining separate shipment destinations',()=>{
 const rows=initialShipmentRows({mercancia:'Cemento',peso_kg:16000,puntos_descarga:[
  {cliente_nombre:'Obra A',peso_kg:'8,0'}, {cliente_nombre:'Obra B',peso_kg:'8,0'},
 ]},[
  {id:'load',tipo:'carga'}, {id:'drop-a',tipo:'descarga'}, {id:'drop-b',tipo:'descarga'},
 ]);
 expect(rows).toHaveLength(2);
 expect(rows.map(row=>row.origen_id)).toEqual(['load','load']);
 expect(rows.map(row=>row.destino_id)).toEqual(['drop-a','drop-b']);
 expect(rows.map(row=>row.mercancia)).toEqual(['Cemento','Cemento']);
 expect(rows.map(row=>row.peso_kg)).toEqual([8000,8000]);
 expect(rows.map(row=>row.destinatario)).toEqual(['Obra A','Obra B']);
});
