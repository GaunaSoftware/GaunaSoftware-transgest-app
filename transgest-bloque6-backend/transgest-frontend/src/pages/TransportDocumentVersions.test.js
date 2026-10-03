import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import TransportDocumentVersions from './TransportDocumentVersions';
import {getFirmasOperacion,generarPedidoDocumentoControl,solicitarDecaPedido,getPedidoDocumentoControl} from '../services/api';

jest.mock('./driver/OperationSignature',()=>()=>null);
jest.mock('../services/api',()=>({
 getFirmasOperacion:jest.fn(),generarPedidoDocumentoControl:jest.fn(),solicitarDecaPedido:jest.fn(),getPedidoDocumentoControl:jest.fn(),
 adjuntarDecaExterno:jest.fn(),descargarArchivoProtegido:jest.fn(),
 anularFirmaOperacion:jest.fn(),guardarFirmaEntrega:jest.fn(),
}));

test('fulfilled DeCA requests do not warn again and both original versions stay accessible',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 getFirmasOperacion.mockResolvedValue([]);
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const versions=[{id:'v2',version:2,estado:'activa',source:'transgest',created_at:'2026-10-02T15:42:19Z'},
  {id:'v1',version:1,estado:'superada',source:'transgest',created_at:'2026-10-02T15:39:18Z'}];
 const request={created_at:'2026-10-02T15:39:13Z'};
 try{
  await act(async()=>root.render(<TransportDocumentVersions pedidoId="pedido-1" data={{status:{ready:true},solicitud_deca:request,versiones:versions}} onChange={()=>{}}/>));
  expect(host.textContent).not.toContain('DeCA solicitado a tráfico');
  expect(host.textContent).toContain('Consultar versiones (2)');
  expect([...host.querySelectorAll('button')].filter(button=>button.textContent==='Descargar original')).toHaveLength(2);
  await act(async()=>root.render(<TransportDocumentVersions pedidoId="pedido-1" data={{status:{ready:false},solicitud_deca:request,versiones:versions}} onChange={()=>{}}/>));
  expect(host.textContent).toContain('Pendiente de completar los originales vigentes de todos los envíos');
 }finally{await act(async()=>root.unmount());host.remove();}
});

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

test('traffic can issue the first DeCA and optionally record a request for the shipper original',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 getFirmasOperacion.mockResolvedValue([]);
 solicitarDecaPedido.mockResolvedValue({ok:true});
 getPedidoDocumentoControl.mockResolvedValue({solicitud_deca:{created_at:'2026-09-30T10:00:00Z'},envios:[{id:'envio-1'}],versiones:[]});
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),onChange=jest.fn();
 try{
  await act(async()=>root.render(<TransportDocumentVersions pedidoId="pedido-1" data={{envios:[{id:'envio-1'}],versiones:[]}} onChange={onChange}/>));
  const issue=[...host.querySelectorAll('button')].find(button=>button.textContent==='Generar DeCA');
  expect(issue.disabled).toBe(false);
  const request=[...host.querySelectorAll('button')].find(button=>button.textContent==='Registrar que el cargador no entregó el DeCA');
  await act(async()=>request.click());
  expect(solicitarDecaPedido).toHaveBeenCalledWith('pedido-1');
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({solicitud_deca:expect.any(Object)}));
 }finally{await act(async()=>root.unmount());host.remove();}
});

test('multiple stops are generated from the saved order without a shipment entry form',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 getFirmasOperacion.mockResolvedValue([]);generarPedidoDocumentoControl.mockClear();
 generarPedidoDocumentoControl.mockResolvedValue({envios:[{id:'a'},{id:'b'}],versiones:[]});
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),onChange=jest.fn();
 try{
  await act(async()=>root.render(<TransportDocumentVersions pedidoId="multi" pedido={{puntos_carga:[{direccion:'A'}],puntos_descarga:[{direccion:'B'},{direccion:'C'}]}} data={{envios:[],versiones:[]}} onChange={onChange}/>));
  expect(host.querySelector('fieldset')).toBeNull();
  expect(host.textContent).toContain('se toman del pedido');
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Generar DeCA').click());
  expect(generarPedidoDocumentoControl).toHaveBeenCalledWith('multi',expect.objectContaining({envio_id:null,consolidado:false}));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({envios:[{id:'a'},{id:'b'}]}));
 }finally{await act(async()=>root.unmount());host.remove();}
});
