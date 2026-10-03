import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import InvoiceWorkflow from './InvoiceWorkflow';
import {invoiceWorkflow,crearFactura} from '../../services/api';
jest.mock('../../services/api',()=>({invoiceWorkflow:jest.fn(),crearFactura:jest.fn()}));
test('batch only sends selected ready services and surfaces failed data requests',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node),onInvoice=jest.fn();
 invoiceWorkflow.mockImplementation(path=>Promise.resolve(path.startsWith('/reglas')?{reglas:{hito:'delivery',exigir_pod:true,exigir_deca:false,bloquear_incidencia:true}}:{total:2,data:[{id:'ready',numero:'QA-1',estado:'listo',importe:100,documentos:{pod:1,deca:1}},{id:'blocked',numero:'QA-2',estado:'excepcion',errores:['Falta POD'],importe:100,documentos:{pod:0,deca:0}}]}));crearFactura.mockResolvedValue({id:'draft'});
 try{await act(async()=>root.render(<InvoiceWorkflow clients={[]} canEdit manager={false} onInvoice={onInvoice}/>));await act(async()=>{node.querySelector('details').open=true;Simulate.toggle(node.querySelector('details'));});
 const boxes=node.querySelectorAll('input[type="checkbox"]');expect(boxes).toHaveLength(2);expect(boxes[1].disabled).toBe(true);
 await act(async()=>Simulate.change(boxes[0],{target:{checked:true}}));await act(async()=>Simulate.change(node.querySelector('option[value="detalle"]').parentElement,{target:{value:'detalle'}}));const button=[...node.querySelectorAll('button')].find(b=>b.textContent.startsWith('Preparar borrador'));await act(async()=>button.click());expect(crearFactura).toHaveBeenCalledWith({workflow_pedidos_ids:['ready'],invoice_format:'detalle'});expect(onInvoice).toHaveBeenCalledWith('draft');
 invoiceWorkflow.mockRejectedValue(new Error('Servicio no disponible'));await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Actualizar preparación').click());expect(node.querySelector('[role="alert"]').textContent).toContain('Servicio no disponible');expect(node.querySelector('table')).toBeNull();
 }finally{await act(async()=>root.unmount());node.remove();}
});

test('batch fuel variation accepts a Spanish percentage and sends the confirmed clause',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node),onInvoice=jest.fn();
 invoiceWorkflow.mockImplementation(path=>Promise.resolve(path.startsWith('/reglas')?{reglas:{hito:'delivery',exigir_pod:true,exigir_deca:false,bloquear_incidencia:true}}:{total:1,data:[{id:'ready-fuel',numero:'QA-FUEL',estado:'listo',importe:110,documentos:{pod:1,deca:1}}]}));
 crearFactura.mockResolvedValue({id:'fuel-draft'});
 try{
  await act(async()=>root.render(<InvoiceWorkflow clients={[]} canEdit manager={false} onInvoice={onInvoice}/>));
  await act(async()=>{node.querySelector('details').open=true;Simulate.toggle(node.querySelector('details'));});
  await act(async()=>Simulate.change(node.querySelector('input[type="checkbox"]'),{target:{checked:true}}));
  await act(async()=>Simulate.change(node.querySelector('option[value="detalle"]').parentElement,{target:{value:'detalle'}}));
  await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent.includes('Variación de gasoil')).click());
  const percent=node.querySelector('#workflow-fuel-percent');
  await act(async()=>Simulate.change(percent,{target:{value:'8,5'}}));
  await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent.startsWith('Preparar borrador')).click());
  expect(crearFactura).toHaveBeenCalledWith({workflow_pedidos_ids:['ready-fuel'],invoice_format:'detalle',fuel_clause_percent:8.5,fuel_clause_confirmed:true});
  expect(onInvoice).toHaveBeenCalledWith('fuel-draft');
 }finally{await act(async()=>root.unmount());node.remove();}
});
