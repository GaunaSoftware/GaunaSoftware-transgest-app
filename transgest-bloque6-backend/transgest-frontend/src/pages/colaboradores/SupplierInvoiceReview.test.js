import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import SupplierInvoiceReview from './SupplierInvoiceReview';
import {supplierInvoiceReview as api} from '../../services/api';
jest.mock('../../services/api',()=>({supplierInvoiceReview:jest.fn()}));
jest.mock('../../context/AuthContext',()=>({useAuth:()=>({user:{rol:'gerente'},puedeVer:()=>true,puedeEditar:()=>true})}));
test('supplier review requires human confirmation and invalidates it after an amount edit',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const data={numero:'QA-1',proveedor_cif:'QA-CIF',fecha:'2026-09-27',moneda:'EUR',base:100,impuestos:21,total:121,lineas:[{referencia:'PED-QA',base:100,impuestos:21}],nota_revision:''};
 api.mockImplementation(path=>Promise.resolve(path.startsWith('?')?{data:[{id:'invoice',numero:'QA-1',estado:'revision'}],total:1}:path==='/config'?{tolerancia_eur:0,tolerancia_pct:0}:{id:'invoice',nombre:'qa.pdf',datos:data,version:1,estado:'revision',lineas:[]}));
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node),button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
 try{
  await act(async()=>root.render(<SupplierInvoiceReview proveedor={{id:'provider',cif:'QA-CIF'}}/>));await act(async()=>button('QA-1').click());
  expect(button('Registrar factura revisada').disabled).toBe(true);
  const modal=document.querySelector('[role="dialog"]'),confirm=[...modal.querySelectorAll('label')].find(l=>l.textContent.includes('He contrastado')).querySelector('input');
  await act(async()=>Simulate.change(confirm,{target:{checked:true}}));expect(button('Registrar factura revisada').disabled).toBe(false);
  const total=[...modal.querySelectorAll('label')].find(l=>l.textContent==='Total documento (€)').querySelector('input');await act(async()=>Simulate.change(total,{target:{value:'120'}}));expect(button('Registrar factura revisada').disabled).toBe(true);
  expect(api.mock.calls.some(([path])=>path.endsWith('/revisar'))).toBe(false);
 }finally{await act(async()=>root.unmount());node.remove();}
});
