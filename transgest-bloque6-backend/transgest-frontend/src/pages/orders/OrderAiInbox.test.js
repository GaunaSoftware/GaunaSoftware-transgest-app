import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import OrderAiInbox from './OrderAiInbox';
import {getOrderInbox,interpretarPedidoIA,changeOrderInboxState} from '../../services/api';
jest.mock('../../services/api',()=>({getOrderInbox:jest.fn(),interpretarPedidoIA:jest.fn(),changeOrderInboxState:jest.fn(),descargarArchivoProtegido:jest.fn(),getPedido:jest.fn()}));
test('inbox restores a draft without creating an order, shows API errors and rejects a stale list response',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node),prepared=jest.fn();
 const item={id:'entry-a',state:'revisar',version:2,filename:'Orden sintética',created_at:'2026-09-26T10:00:00Z'};
 getOrderInbox.mockResolvedValue({items:[item],counts:[{state:'revisar',count:1}],inbound:{configured:false,guidance:'Correo pendiente de configurar'}});
 interpretarPedidoIA.mockResolvedValue({inbox_id:item.id,pedido:{origen:'Madrid'}});
 try{
  await act(async()=>root.render(<OrderAiInbox onPrepared={prepared}/>));
  expect(node.textContent).toContain('Correo pendiente');
  await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Recuperar borrador').click());
  expect(interpretarPedidoIA).toHaveBeenCalledWith({inbox_id:item.id});expect(prepared).toHaveBeenCalledWith({inbox_id:item.id,pedido:{origen:'Madrid'}});expect(changeOrderInboxState).not.toHaveBeenCalled();
  getOrderInbox.mockRejectedValueOnce(Error('Permiso revocado'));
  await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Actualizar bandeja').click());
  expect(node.querySelector('[role="alert"]').textContent).toBe('Permiso revocado');expect(node.textContent).not.toContain('No hay entradas');
  let resolveOld;getOrderInbox.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  await act(async()=>root.render(<OrderAiInbox onPrepared={prepared} revision="b"/>));
  getOrderInbox.mockResolvedValueOnce({items:[],counts:[]});
  await act(async()=>root.render(<OrderAiInbox onPrepared={prepared} revision="c"/>));
  await act(async()=>resolveOld({items:[item],counts:[]}));expect(node.textContent).not.toContain('Orden sintética');
 }finally{await act(async()=>root.unmount());node.remove();}
});
