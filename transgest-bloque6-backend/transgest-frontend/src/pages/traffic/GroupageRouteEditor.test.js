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
