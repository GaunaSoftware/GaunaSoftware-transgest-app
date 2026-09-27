import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import PlannerLoading from './PlannerLoading';
import {plannerLoadingApi} from '../services/api';
jest.mock('../context/AuthContext',()=>({useAuth:()=>({user:{id:'worker',rol:'carretillero'},logout:jest.fn()})}));
jest.mock('../services/api',()=>({plannerLoadingApi:jest.fn(),plannerApi:jest.fn(),getPedidoDocumentoControl:jest.fn(),generarPedidoDocumentoControl:jest.fn()}));
test('warehouse mobile retries the same scan operation after an uncertain response and hides office actions',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> 'operation-qa'}});
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 const detail={id:'prep',numero:'PL-SINTÉTICO',version:1,estado:'lista',estado_operativo:'cargando',situacion_camion:'cargando',lineas:[{id:'line',referencia:'REF',cantidad:10,cantidad_cargada:null,unidad:'sacos',peso_kg:25,ubicacion:'A1',lote:'L1'}]};
 let writes=0;
 plannerLoadingApi.mockImplementation((path,opts)=>{
  if(opts?.method==='POST'){writes++;return writes===1?Promise.reject(Error('Conexión interrumpida')):Promise.resolve({...detail,version:2,lineas:[{...detail.lineas[0],cantidad_cargada:5}]});}
  return Promise.resolve(path==='/prep'?detail:{data:[detail],total:1});
 });
 const click=async text=>act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent.includes(text)).click());
 try{
  await act(async()=>root.render(<PlannerLoading standalone/>));await click('PL-SINTÉTICO');
  expect(node.textContent).not.toContain('Guardar asignación');expect(node.textContent).not.toContain('facturación por empresa');
  const form=[...node.querySelectorAll('form')].find(f=>f.textContent.includes('Registrar lectura'));
  await act(async()=>{Simulate.change(form.querySelector('select'),{target:{value:'line'}});});
  for(const [i,value]of ['A1','REF','L1','5'].entries())await act(async()=>Simulate.change(form.querySelectorAll('input')[i],{target:{value}}));
  await act(async()=>Simulate.submit(form));expect(node.textContent).toContain('Conexión interrumpida');
  await act(async()=>Simulate.submit(form));
  const bodies=plannerLoadingApi.mock.calls.filter(([,o])=>o?.method==='POST').map(([,o])=>o.body);
  expect(bodies).toHaveLength(2);expect(bodies[0].operacion).toBe(bodies[1].operacion);expect(bodies[1].cantidad).toBe('5');
  expect(node.textContent).toContain('5 / 10');
  expect([...node.querySelectorAll('button')].find(b=>b.textContent.includes('Confirmar camión cargado')).disabled).toBe(true);
 }finally{await act(async()=>root.unmount());node.remove();}
});
