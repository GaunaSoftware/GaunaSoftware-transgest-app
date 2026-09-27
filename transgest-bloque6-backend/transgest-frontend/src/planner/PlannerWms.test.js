import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import PlannerWms from './PlannerWms';
import {plannerApi} from '../services/api';
jest.mock('../services/api',()=>({plannerApi:jest.fn()}));
test('WMS preserves receipt operation on uncertain retry and never offers writes without permission',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> 'receipt-operation'}});
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 const data={ubicaciones:[{id:'loc',almacen:'Sintético',codigo:'A1',activo:true}],recepciones:[{id:'asn',referencia:'ASN sintética',fecha_prevista:'2026-09-26',estado:'prevista',lineas:[{id:'line',referencia:'ART',prevista:10,recibida:0}]}],conteos:[],packs:[],movimientos:[],limites:{recepciones:200,ubicaciones:500,movimientos:100}};
 let writes=0;plannerApi.mockImplementation((p,o)=>{if(p==='/wms/accion'){writes++;return writes===1?Promise.reject(Error('Respuesta interrumpida')):Promise.resolve({resultado:{estado:'parcial'}});}return Promise.resolve(data);});
 const click=async label=>act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent===label).click());
 try{
  await act(async()=>root.render(<PlannerWms canEdit/>));await click('Recibir mercancía');
  const form=document.querySelector('.planner-form');const sels=form.querySelectorAll('select');
  await act(async()=>Simulate.change(sels[1],{target:{value:'loc'}}));
  await act(async()=>Simulate.change(form.querySelector('input[type="number"]'),{target:{value:'4'}}));
  await act(async()=>Simulate.submit(form));expect(document.body.textContent).toContain('Respuesta interrumpida');
  await act(async()=>Simulate.submit(form));
  const calls=plannerApi.mock.calls.filter(([p])=>p==='/wms/accion');expect(calls).toHaveLength(2);expect(calls[0][1].body.operacion).toBe(calls[1][1].body.operacion);expect(calls[1][1].body.cantidad).toBe('4');
  expect(node.textContent).toContain('Operación registrada');
  await act(async()=>root.render(<PlannerWms canEdit={false}/>));expect([...node.querySelectorAll('button')].find(b=>b.textContent==='Nueva recepción').disabled).toBe(true);
 }finally{await act(async()=>root.unmount());node.remove();}
});
