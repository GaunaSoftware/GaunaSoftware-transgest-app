import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import VehicleTrackingPanel from './VehicleTrackingPanel';
import {getPedidoTracking} from '../services/api';
jest.mock('../services/api',()=>({getPedidoTracking:jest.fn(),calcularPedidoEta:jest.fn(),guardarPedidoTrackingConfig:jest.fn()}));
test('tracking removes a stale marker, keeps API errors visible and ignores a previous order response',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;jest.useFakeTimers();
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),position=jest.fn();
 const state={status:'reciente',last_recorded_at:new Date().toISOString(),stale_seconds:30,provider:'app_chofer',position:{lat:40,lng:-3},eta:{value:null},configuration:{stops:{}}};
 getPedidoTracking.mockResolvedValue(state);
 try{
  await act(async()=>root.render(<VehicleTrackingPanel pedidoId="a" onPosition={position}/>));
  expect(position).toHaveBeenLastCalledWith(state.position);expect(host.textContent).toContain('Última posición');
  expect(host.textContent).not.toContain('Guardar umbrales');expect(host.textContent).not.toContain('Confirmar llegada');
  getPedidoTracking.mockRejectedValue(new Error('Sin permiso para esta empresa'));
  await act(async()=>jest.advanceTimersByTime(31000));
  expect(position).toHaveBeenLastCalledWith(null);expect(host.querySelector('[role="alert"]').textContent).toContain('Sin permiso');
  let resolveOld;getPedidoTracking.mockImplementationOnce(()=>new Promise(r=>{resolveOld=r;}));
  await act(async()=>root.render(<VehicleTrackingPanel pedidoId="b" onPosition={position}/>));
  getPedidoTracking.mockResolvedValue({...state,status:'sin_datos',last_recorded_at:null,position:null});
  await act(async()=>root.render(<VehicleTrackingPanel pedidoId="c" onPosition={position}/>));
  await act(async()=>resolveOld(state));expect(position).toHaveBeenLastCalledWith(null);expect(host.textContent).toContain('Sin posición registrada');
 }finally{await act(async()=>root.unmount());host.remove();jest.useRealTimers();}
});
