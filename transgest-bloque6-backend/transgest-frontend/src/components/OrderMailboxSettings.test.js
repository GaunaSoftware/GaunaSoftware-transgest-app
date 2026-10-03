import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import OrderMailboxSettings from './OrderMailboxSettings';
import {getOrderMailbox,saveOrderMailbox,testOrderMailbox,syncOrderMailbox} from '../services/api';
jest.mock('../services/api',()=>({getOrderMailbox:jest.fn(),saveOrderMailbox:jest.fn(),testOrderMailbox:jest.fn(),syncOrderMailbox:jest.fn()}));
const cfg={email:'',provider:'otro',host:'',username:'',password:'',folder:'INBOX',enabled:false,has_password:false,verified_at:null,state:'pendiente_configuracion',missing:['Servidor IMAP']};
test('incomplete settings stay inactive; verification is required before activation and errors remain visible',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 getOrderMailbox.mockResolvedValue(cfg);saveOrderMailbox.mockResolvedValue(cfg);
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 try{
  await act(async()=>root.render(<OrderMailboxSettings/>));
  expect(host.textContent).toContain('Pendiente de configurar');
  expect(button('Probar recepción').disabled).toBe(true);expect(button('Activar recepción').disabled).toBe(true);expect(button('Recoger correos ahora').disabled).toBe(true);
  await act(async()=>button('Guardar recepción').click());expect(saveOrderMailbox.mock.calls[0][0].enabled).toBe(false);
  const ready={...cfg,email:'pedidos@example.invalid',host:'imap.example.invalid',username:'pedidos',has_password:true,missing:[],state:'pendiente_prueba'};
  saveOrderMailbox.mockResolvedValue(ready);await act(async()=>button('Guardar recepción').click());
  expect(button('Probar recepción').disabled).toBe(false);expect(button('Activar recepción').disabled).toBe(true);
  getOrderMailbox.mockResolvedValue({...ready,state:'error',last_error:'Acceso IMAP rechazado'});
  testOrderMailbox.mockRejectedValue(new Error('Acceso IMAP rechazado'));await act(async()=>button('Probar recepción').click());
  expect(host.querySelector('[role="alert"]').textContent).toContain('Acceso IMAP rechazado');expect(button('Activar recepción').disabled).toBe(true);
  const verified={...ready,verified_at:'2026-09-27T10:00:00Z',state:'desactivado'};
  testOrderMailbox.mockResolvedValue({config:verified,message:'Verificado'});await act(async()=>button('Probar recepción').click());
  expect(button('Activar recepción').disabled).toBe(false);saveOrderMailbox.mockResolvedValue({...verified,enabled:true,state:'activo'});
  await act(async()=>button('Activar recepción').click());expect(saveOrderMailbox.mock.calls.at(-1)[0].enabled).toBe(true);
  syncOrderMailbox.mockResolvedValue({config:{...verified,enabled:true,state:'activo'},received:2});await act(async()=>button('Recoger correos ahora').click());expect(host.textContent).toContain('2 entradas nuevas');
 }finally{await act(async()=>root.unmount());host.remove();}
});
