import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import PlanificacionOperativa from './PlanificacionOperativa';
import {readRuntimeFocus,clearRuntimeFocus} from '../services/runtimeFocus';

jest.mock('./GestionTrafico',()=>()=>null);
jest.mock('./PlanDiario',()=>()=>null);
jest.mock('./traffic/TrafficLocationAgenda',()=>()=>null);

test('new order from groupage carries first-step context to Pedidos',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<PlanificacionOperativa initialTab="grupajes"/>));
  const button=[...host.querySelectorAll('button')].find(item=>item.textContent==='+ Nuevo pedido');
  await act(async()=>button.click());
  expect(readRuntimeFocus('tms_pedidos_focus')).toMatchObject({source:'gestion_trafico',view:'grupajes',action:'nuevo'});
 }finally{await act(async()=>root.unmount());host.remove();clearRuntimeFocus('tms_pedidos_focus');}
});
