import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import NetworkConsentPanel from './NetworkConsentPanel';
import {transportExchange,getPedidos} from '../services/api';
jest.mock('../services/api',()=>({transportExchange:jest.fn(),getPedidos:jest.fn()}));
test('Network requires preview and explicit consent, allows narrower scopes and invalidates a changed invitation',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;getPedidos.mockResolvedValue({data:[]});
 const token='a'.repeat(64),onConnected=jest.fn();
 transportExchange.mockImplementation(p=>Promise.resolve(p==='/catalogo'?{scopes:{pedidos:'Encargos',gps:'Posición GPS'}}:p==='/previsualizar'?{cargador:'Emisor sintético',cif:'QA-CIF',scopes:['pedidos','gps'],encargo:{numero:'QA-1',origen:'A',destino:'B',precio_colaborador:350}}:p==='/conectar'?{viaje_id:'trip'}:[]));
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 const button=t=>[...node.querySelectorAll('button')].find(x=>x.textContent===t);
 try{
  await act(async()=>root.render(<NetworkConsentPanel user={{productos:['transgest']}} canReceive clients={[{id:'client',nombre:'Emisor',cif:'QA-CIF'}]} onConnected={onConnected}/>));
  expect(button('Aceptar y crear viaje')).toBeUndefined();
  const form=node.querySelectorAll('form')[1],codeInput=form.querySelector('input');
  await act(async()=>Simulate.change(codeInput,{target:{value:token}}));await act(async()=>button('Revisar invitación').click());
  expect(button('Aceptar y crear viaje').disabled).toBe(true);
  await act(async()=>Simulate.change(form.querySelector('select'),{target:{value:'client'}}));
  const checks=form.querySelectorAll('input[type="checkbox"]');
  await act(async()=>Simulate.change(checks[1],{target:{checked:false}}));await act(async()=>Simulate.change(checks[2],{target:{checked:true}}));
  await act(async()=>Simulate.submit(form));
  const accepted=transportExchange.mock.calls.find(([p])=>p==='/conectar')[1].body;expect(accepted.scopes).toEqual(['pedidos']);expect(accepted.acepta_condiciones).toBe(true);expect(onConnected).toHaveBeenCalledWith({viaje_id:'trip'});
  await act(async()=>Simulate.change(codeInput,{target:{value:token}}));await act(async()=>button('Revisar invitación').click());
  await act(async()=>Simulate.change(codeInput,{target:{value:'b'.repeat(64)}}));expect(button('Aceptar y crear viaje')).toBeUndefined();
 }finally{await act(async()=>root.unmount());node.remove();}
});
