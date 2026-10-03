import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import TripTelemetryPanel from './TripTelemetryPanel';
import {getPedidoTelemetry} from '../services/api';
jest.mock('../services/api',()=>({getPedidoTelemetry:jest.fn(),requestPedidoTelemetry:jest.fn()}));
jest.mock('./RouteMapCanvas',()=>()=> <div data-testid="actual-route"/>);
test('closed-trip report displays quality and does not treat missing telemetry as zero',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{getPedidoTelemetry.mockResolvedValue({status:'ready',data:{generated_at:new Date().toISOString(),context:{provider:'geotab'},loaded:{distance:{value:120,quality:'estimated',method:'gps_trace'},fuel:null,route:{segments:[]}},empty:null,temperatures:[],warnings:['Recorrido incompleto']}});
  await act(async()=>root.render(<TripTelemetryPanel pedidoId="a"/>));
  expect(host.textContent).toContain('120 km · estimado');expect(host.textContent).toContain('No disponible');expect(host.textContent).toContain('Recorrido incompleto');expect(host.textContent).not.toContain('0 l');
  expect(host.textContent).not.toContain('Añadidos al pedido');
  let old;getPedidoTelemetry.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;}));
  await act(async()=>root.render(<TripTelemetryPanel pedidoId="b"/>));
  getPedidoTelemetry.mockResolvedValue({status:'not_requested'});await act(async()=>root.render(<TripTelemetryPanel pedidoId="c"/>));
  await act(async()=>old({status:'ready',data:{loaded:{distance:{value:999}},temperatures:[]}}));expect(host.textContent).not.toContain('999');
 }finally{await act(async()=>root.unmount());host.remove();}
});
