import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import RouteMapCanvas from './RouteMapCanvas';
import * as maps from 'maplibre-gl';

jest.mock('maplibre-gl',()=>{
  const map={on:jest.fn(),off:jest.fn(),remove:jest.fn(),addControl:jest.fn(),addSource:jest.fn(),addLayer:jest.fn(),getSource:jest.fn(),getContainer:()=>({clientWidth:390}),fitBounds:jest.fn(),resize:jest.fn(),easeTo:jest.fn()};
  const popup={setLngLat:jest.fn().mockReturnThis(),setDOMContent:jest.fn().mockReturnThis(),setText:jest.fn().mockReturnThis(),addTo:jest.fn().mockReturnThis(),remove:jest.fn()};
  return {Map:jest.fn(()=>map),NavigationControl:jest.fn(),setWorkerUrl:jest.fn(),Marker:jest.fn(),Popup:jest.fn(()=>popup),LngLatBounds:jest.fn(()=>({extend:jest.fn().mockReturnThis()})),__map:map,__popup:popup};
},{virtual:true});
jest.mock('maplibre-gl/package.json',()=>({version:'6.2.1'}),{virtual:true});
jest.mock('maplibre-gl/dist/maplibre-gl.css',()=>({}),{virtual:true});
global.IS_REACT_ACT_ENVIRONMENT=true;
let root,node;
beforeEach(()=>{
  global.ResizeObserver=class{observe(){} disconnect(){}};jest.clearAllMocks();
  maps.Map.mockImplementation(()=>maps.__map);maps.Popup.mockImplementation(()=>maps.__popup);
  maps.LngLatBounds.mockImplementation(()=>({extend:jest.fn().mockReturnThis()}));
  ['setLngLat','setDOMContent','setText','addTo'].forEach(name=>maps.__popup[name].mockReturnThis());
  node=document.createElement('div');document.body.append(node);root=createRoot(node);maps.__map.getSource.mockReturnValue(null);
});
afterEach(()=>{act(()=>root.unmount());node.remove();});
test('fleet markers cluster overlapping trucks and expose all plates without large DOM buttons',async()=>{
  const points=['2836NKV','9523NGL','OTHER'].map(stopNumber=>({lat:38,lng:-1,stopNumber,label:`${stopNumber} · Geotab`}));
  await act(async()=>root.render(<RouteMapCanvas points={points} fleet/>));
  await act(async()=>maps.__map.on.mock.calls.find(c=>c[0]==='style.load')[1]());
  const source=maps.__map.addSource.mock.calls.find(c=>c[0]==='fleet-vehicles')[1];
  expect(source.cluster).toBe(true);expect(source.data.features).toHaveLength(3);
  expect(maps.Marker).not.toHaveBeenCalled();
  const labels=maps.__map.addLayer.mock.calls.map(c=>c[0]).find(l=>l.id==='fleet-vehicle-labels');
  expect(labels.layout['text-size']).toBe(11);
  maps.__map.getSource.mockReturnValue({getClusterLeaves:jest.fn().mockResolvedValue(source.data.features),getClusterExpansionZoom:jest.fn().mockResolvedValue(15)});
  const click=maps.__map.on.mock.calls.find(c=>c[0]==='click'&&c[1]==='fleet-clusters')[2];
  await act(async()=>click({features:[{properties:{point_count:3,cluster_id:1},geometry:{coordinates:[-1,38]}}]}));
  const content=maps.__popup.setDOMContent.mock.calls[0][0];
  expect(content.textContent).toContain('3 vehículos');
  points.forEach(p=>expect(content.textContent).toContain(p.stopNumber));
  await act(async()=>content.querySelector('button').click());
  expect(maps.__map.easeTo).toHaveBeenCalledWith({center:[-1,38],zoom:15});
});
