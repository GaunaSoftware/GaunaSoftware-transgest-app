import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import GroupageRouteEditor,{groupageStops,nearestGroupageSequence,validGroupageSequence} from './GroupageRouteEditor';
import {getGroupagePlan,saveGroupagePlan,getGroupageCosts} from '../../services/api';
import {notify} from '../../services/notify';
import {capacidadRemolque} from '../../components/RemolqueGrupaje';
jest.mock('../../services/api',()=>({getGroupagePlan:jest.fn(),saveGroupagePlan:jest.fn(),optimizarRuta:jest.fn(),getGroupageCosts:jest.fn().mockResolvedValue({data:[]})}));
jest.mock('../../services/notify',()=>({notify:jest.fn()}));
jest.mock('../../components/RouteMapCanvas',()=>()=> <div>Mapa</div>);
let host,root;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);jest.clearAllMocks();getGroupageCosts.mockResolvedValue({data:[]});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const orders=[{id:'a',numero:'A',origen:'Valencia',destino:'Madrid',palets_cantidad:2},{id:'b',numero:'B',origen:'Murcia',destino:'Bilbao',palets_cantidad:2}];
const click=async text=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===text).click());
test('layout and route remain independent; invalid delivery-first move is rejected',async()=>{
 getGroupagePlan.mockResolvedValue({origen:'legacy'});saveGroupagePlan.mockResolvedValue({version:1});
 await act(async()=>root.render(<GroupageRouteEditor orders={orders} groupId="g"/>));
 const initial=groupageStops(orders),sequence=[...initial.filter(s=>s.tipo==='carga'),...initial.filter(s=>s.tipo==='descarga')].map(s=>s.key);
 await act(async()=>host.querySelector('[aria-label="Adelantar mercancía B"]').click());
 await click('Guardar plan');
 expect(saveGroupagePlan).toHaveBeenLastCalledWith('g',expect.objectContaining({disposicion:['b','a'],paradas:sequence}));
 await act(async()=>host.querySelector('[aria-label="Subir parada 3"]').click());
 await act(async()=>host.querySelector('[aria-label="Subir parada 2"]').click());
 expect(notify).toHaveBeenCalledWith('La descarga debe ir después de su carga.','warning');
});
test('gross mass is never treated as payload capacity',()=>{
 expect(capacidadRemolque({masa_total_kg:40000}).peso).toBe(24000);
 expect(capacidadRemolque({masa_total_kg:40000,carga_max_kg:22000}).peso).toBe(22000);
 expect(capacidadRemolque(null).metros).toBe(13.65);
});

test('strict groupage capacity uses the selected body or trailer without standard dimensions',()=>{
 const rigid={clase:'Camion rigido',matricula:'1234-ABC',metros_carga:'7,20',carga_max_kg:12000,capacidad_palets:18,longitud_mm:9800};
 const trailer={clase:'Semirremolque',matricula:'R-4321',metros_carga:'12,4',carga_max_kg:22000,capacidad_palets:30};
 expect(capacidadRemolque(rigid,{estricta:true})).toMatchObject({metros:7.2,peso:12000,palets:18,estimado:false});
 expect(capacidadRemolque(trailer,{estricta:true})).toMatchObject({metros:12.4,peso:22000,palets:30,estimado:false});
 expect(capacidadRemolque({clase:'Camion rigido',longitud_mm:9800,masa_total_kg:18000},{estricta:true}))
  .toMatchObject({metros:null,peso:null,palets:null,estimado:true});
});

test('proximity proposal preserves precedences and requires actual coordinates',()=>{
 const points=[{key:'a1',tipo:'carga',pedido:{id:'a'},lat:39,lng:-1},{key:'a2',tipo:'descarga',pedido:{id:'a'},lat:38,lng:-2},{key:'b1',tipo:'carga',pedido:{id:'b'},lat:39.1,lng:-1},{key:'b2',tipo:'descarga',pedido:{id:'b'},lat:40,lng:-1}];
 const result=nearestGroupageSequence(points);expect(validGroupageSequence(result.map(key=>points.find(p=>p.key===key)))).toBe(true);expect(result[1]).toBe('b1');expect(nearestGroupageSequence([{...points[0],lat:null}])).toBeNull();
});
test('failed loading never enables saving an empty plan and can be retried',async()=>{
 getGroupagePlan.mockRejectedValueOnce(new Error('Servidor no disponible')).mockResolvedValueOnce({origen:'legacy'});
 await act(async()=>root.render(<GroupageRouteEditor orders={orders} groupId="g"/>));
 expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Guardar plan').disabled).toBe(true);
 await click('Volver a cargar el plan');
 expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Guardar plan').disabled).toBe(false);
});
test('dragging cargo inside the trailer changes only the saved load order',async()=>{
 getGroupagePlan.mockResolvedValue({origen:'legacy'});saveGroupagePlan.mockResolvedValue({version:1});
 await act(async()=>root.render(<GroupageRouteEditor orders={orders} groupId="g"/>));
 const source=host.querySelector('[aria-label^="B. Posición 2"]');
 const target=host.querySelector('[aria-label^="A. Posición 1"]');
 const values=new Map(),dataTransfer={effectAllowed:'',setData:(key,value)=>values.set(key,value),getData:key=>values.get(key)||''};
 const drag=type=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:dataTransfer});return event;};
 await act(async()=>{
  source.dispatchEvent(drag('dragstart'));
  target.dispatchEvent(drag('drop'));
 });
 await click('Guardar plan');
 expect(saveGroupagePlan).toHaveBeenLastCalledWith('g',expect.objectContaining({disposicion:['b','a']}));
});
test('groupage map uses order coordinates when a stop has no separate pin',()=>{
 const stops=groupageStops([{...orders[0],origen_lat:39.47,origen_lng:-0.38,destino_lat:40.42,destino_lng:-3.7}]);
 expect(stops.map(stop=>[stop.lat,stop.lng])).toEqual([[39.47,-0.38],[40.42,-3.7]]);
});
