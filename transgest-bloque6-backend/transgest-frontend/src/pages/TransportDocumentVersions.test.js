import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import TransportDocumentVersions from './TransportDocumentVersions';
import {getFirmasOperacion,generarPedidoDocumentoControl} from '../services/api';

jest.mock('./TransportShipmentEditor',()=>()=>null);
jest.mock('./driver/OperationSignature',()=>()=>null);
jest.mock('../services/api',()=>({
 getFirmasOperacion:jest.fn(),generarPedidoDocumentoControl:jest.fn(),
 adjuntarDecaExterno:jest.fn(),descargarArchivoProtegido:jest.fn(),
 anularFirmaOperacion:jest.fn(),guardarFirmaEntrega:jest.fn(),
}));

test('a replacement DeCA keeps the issue action visible but requires its reason',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 getFirmasOperacion.mockResolvedValue([]);
 generarPedidoDocumentoControl.mockResolvedValue({versiones:[]});
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<TransportDocumentVersions pedidoId="pedido-1" data={{envios:[{id:'envio-1'}],versiones:[{id:'v1',version:1,estado:'activa',source:'transgest',envio_id:'envio-1',created_at:'2026-09-29T10:00:00Z'}]}} onChange={()=>{}}/>));
  const issue=[...host.querySelectorAll('button')].find(button=>button.textContent==='Generar nueva versión');
  expect(issue).toBeTruthy();expect(issue.disabled).toBe(true);
  const reason=host.querySelector('input[maxlength="500"]');
  await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(reason,'Corrección de mercancía');reason.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(issue.disabled).toBe(false);
  await act(async()=>issue.click());
  expect(generarPedidoDocumentoControl).toHaveBeenCalledWith('pedido-1',expect.objectContaining({motivo:'Corrección de mercancía',envio_id:'envio-1'}));
  const permit=[...host.querySelectorAll('select')].find(select=>select.querySelector('option[value="mantener"]'));
  await act(async()=>{permit.value='si';permit.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(issue.disabled).toBe(true);
  const reference=host.querySelector('input[maxlength="120"]');
  await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(reference,'AUT-123');reference.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(issue.disabled).toBe(false);
  await act(async()=>issue.click());
  expect(generarPedidoDocumentoControl).toHaveBeenLastCalledWith('pedido-1',expect.objectContaining({autorizacion_especial:{requerida:true,referencia:'AUT-123'}}));
 }finally{await act(async()=>root.unmount());host.remove();}
});
