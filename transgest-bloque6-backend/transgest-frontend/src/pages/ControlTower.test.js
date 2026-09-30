import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import ControlTower from './ControlTower';
import {getControlTower,getControlTowerFlow} from '../services/api';
import {readRuntimeFocus,clearRuntimeFocus} from '../services/runtimeFocus';
jest.mock('../services/api',()=>({getControlTower:jest.fn(),getControlTowerFlow:jest.fn()}));
test('Control Tower dispatches the selected order to an already mounted order workspace',async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  getControlTower.mockResolvedValue({flujo_operativo_v2:[],flujo_alcance:{cargas_finalizadas_sin_salida:1}});
  getControlTowerFlow.mockResolvedValue({total:1,page_size:40,items:[{id:'qa-target',numero:'QA-TARGET'}]});
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  const focus=jest.fn();window.addEventListener('tms:pedidos-focus',focus);
  try {
    await act(async()=>root.render(<ControlTower/>));
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Cargas finalizadas sin salida registrada')).click());
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('QA-TARGET')).click());
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.calls[0][0].detail).toMatchObject({pedido_id:'qa-target',numero:'QA-TARGET'});
    expect(readRuntimeFocus('tms_pedidos_focus')).toMatchObject({pedido_id:'qa-target'});
  } finally {await act(async()=>root.unmount());host.remove();window.removeEventListener('tms:pedidos-focus',focus);clearRuntimeFocus('tms_pedidos_focus');}
});
