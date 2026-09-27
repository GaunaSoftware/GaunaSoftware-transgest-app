import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import useOptimizedRoute from './useOptimizedRoute';
import * as api from './api';
jest.mock('./api', () => ({getRutaOptimizadaPedido:jest.fn(), optimizarRuta:jest.fn()}));
const geometry = {type:'LineString', coordinates:[[-3,40],[-1,39]]};
const input = {pedido_id:'A',preference:'camion',stops:[{address:'Madrid'},{address:'Valencia'}],truck:{height_m:4,width_m:2.55,length_m:16.5,weight_t:40}};
let root, host, query;
function Probe({value}) {query=useOptimizedRoute(value);return <span>{query.data?.distance_km ?? query.error}</span>;}
beforeEach(()=>{jest.clearAllMocks();global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');root=createRoot(host);api.getRutaOptimizadaPedido.mockResolvedValue(null);});
afterEach(()=>act(()=>root.unmount()));
const mount=value=>act(async()=>root.render(<Probe value={value}/>));
test('changed criteria, stops and truck dimensions recalculate; old replies cannot overwrite a new order',async()=>{
  let resolveOld;
  api.optimizarRuta.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue({distance_km:200,geometry});
  await mount(input);
  const next={...input,pedido_id:'B',stops:[{address:'Bilbao'},{address:'Zaragoza'}]};
  await mount(next);expect(host.textContent).toBe('200');
  await act(async()=>resolveOld({distance_km:999,geometry}));expect(host.textContent).toBe('200');
  await mount({...next,preference:'eficiente'});expect(api.optimizarRuta).toHaveBeenLastCalledWith(expect.objectContaining({preference:'eficiente',pedido_id:'B'}));
  await mount({...next,stops:[{address:'Bilbao'},{address:'Sevilla',lat:37.38,lng:-5.98}]});
  expect(api.optimizarRuta.mock.calls.at(-1)[0].stops[1].address).toBe('Sevilla');
  await mount({...next,truck:{...next.truck,height_m:4.2}});expect(api.optimizarRuta.mock.calls.at(-1)[0].truck.height_m).toBe(4.2);
});
test('saved route needs matching coordinates and truck profile; errors clear the previous route',async()=>{
  api.getRutaOptimizadaPedido.mockResolvedValue({...input,geometry,distance_km:150});
  await mount(input);expect(api.optimizarRuta).not.toHaveBeenCalled();expect(host.textContent).toBe('150');
  api.optimizarRuta.mockRejectedValue(new Error('Proveedor no disponible'));
  await mount({...input,stops:[{address:'Madrid',lat:40.4,lng:-3.7},{address:'Valencia'}]});
  expect(host.textContent).toBe('Proveedor no disponible');expect(query.data).toBeNull();
});
test('manual recalculation bypasses a saved route',async()=>{
  api.getRutaOptimizadaPedido.mockResolvedValue({...input,geometry,distance_km:150});
  api.optimizarRuta.mockResolvedValue({...input,geometry,distance_km:180});
  await mount(input);await act(async()=>query.recalculate());expect(host.textContent).toBe('180');
});
