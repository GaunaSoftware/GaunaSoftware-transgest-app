import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import OperationSignature from './OperationSignature';
import {prepararFirmaOperacion} from '../../services/api';
jest.mock('../../services/api',()=>({prepararFirmaOperacion:jest.fn(),verArchivoProtegido:jest.fn()}));
jest.mock('../../services/mobileRuntime',()=>({getCurrentLocation:jest.fn()}));
test('signature requires an authoritative summary, identity and explicit consent; load failures stay visible',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;global.crypto={randomUUID:()=> 'synthetic-operation'};jest.useFakeTimers();
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),save=jest.fn();
 prepararFirmaOperacion.mockResolvedValue({id:'operation',version:2,pdf_hash:'sha256',payload:{pedido_numero:'QA-SINTETICO',operacion:'carga',lugar:'Madrid',mercancia:'Cerámica',peso_kg:100,bultos:2,declaracion:'Declaración específica'}});
 try{
  await act(async()=>root.render(<OperationSignature pedido={{id:'p'}} paradaId="load" onFirma={save}/>));
  expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Confirmar firma').disabled).toBe(true);
  await act(async()=>jest.advanceTimersByTime(300));expect(host.textContent).toContain('Declaración específica');expect(host.textContent).toContain('QA-SINTETICO');
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Confirmar firma').click());
  expect(save).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]').textContent).toContain('nombre, apellidos y empresa');
  expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  prepararFirmaOperacion.mockRejectedValue(new Error('No tienes acceso a esta parada'));
  await act(async()=>root.render(<OperationSignature pedido={{id:'other'}} paradaId="load" onFirma={save}/>));
  await act(async()=>jest.advanceTimersByTime(300));expect(host.querySelector('[role="alert"]').textContent).toContain('No tienes acceso');expect(host.textContent).not.toContain('QA-SINTETICO');
 }finally{await act(async()=>root.unmount());host.remove();jest.useRealTimers();}
});
