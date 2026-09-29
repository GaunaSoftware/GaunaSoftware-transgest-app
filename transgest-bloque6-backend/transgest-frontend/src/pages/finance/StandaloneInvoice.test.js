import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {ModalFacturaSinPedido} from '../Facturacion';

jest.mock('../../hooks/useEmpresaPerfil',()=>({useEmpresaPerfil:()=>({serie_facturas:'A'})}));

test('creates a draft with no order and preserves the client reference and net amount',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const create=jest.fn().mockResolvedValue({id:'synthetic-invoice'}),done=jest.fn();
 try{
  await act(async()=>root.render(<ModalFacturaSinPedido onClose={()=>{}} onSaved={done} create={create} loadClients={()=>Promise.resolve([{id:'synthetic-client',nombre:'Cliente de prueba',vencimiento:'30 dias'}])}/>));
  const change=(id,value)=>{const input=document.getElementById(id);const setter=Object.getOwnPropertyDescriptor(input.tagName==='SELECT' ? HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(input,value);input.dispatchEvent(new Event('change',{bubbles:true}));};
  await act(async()=>{change('independent-invoice-client','synthetic-client');change('independent-invoice-reference','REF-1');change('independent-invoice-concept','Gestión documental');change('independent-invoice-amount','125,50');});
  await act(async()=>document.querySelector('.finance-dialog-content').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({cliente_id:'synthetic-client',estado:'borrador',pedidos_ids:[],referencia_cliente:'REF-1',lineas:[{concepto:'Gestión documental',cantidad:1,precio_unit:125.5}]}));
  expect(done).toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());host.remove();}
});
