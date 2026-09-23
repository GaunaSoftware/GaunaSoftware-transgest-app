import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import InvoiceFiscalData from './InvoiceFiscalData';
import ClaveiconPanel from './ClaveiconPanel';
import {fiscalFlowRequest} from '../services/api';
jest.mock('../services/api',()=>({fiscalFlowRequest:jest.fn(),downloadClaveicon:jest.fn()}));
jest.mock('../services/notify',()=>({promptDialog:jest.fn()}));

let root,container;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);fiscalFlowRequest.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});

test('fiscal data sends an object and invalidates review only after successful save',async()=>{
 const saved=jest.fn();fiscalFlowRequest.mockResolvedValue({operacion_exenta:'E1'});
 await act(async()=>root.render(<InvoiceFiscalData invoice={{id:'draft',estado:'borrador'}} onSaved={saved}/>));
 const select=container.querySelector('select');
 await act(async()=>{select.value='E1';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>container.querySelector('button').click());
 expect(fiscalFlowRequest).toHaveBeenCalledWith('/draft/fiscal/datos',{method:'PUT',body:{operacion_exenta:'E1',calificacion_operacion:''}});
 expect(saved).toHaveBeenCalledTimes(1);
});

test.each([{estado:'emitida'},{estado:'borrador',fiscal:{id:'frozen'}}])('registered fiscal identity cannot be edited in the form',async fields=>{
 await act(async()=>root.render(<InvoiceFiscalData invoice={{id:'invoice',...fields}}/>));
 expect(container.querySelector('button')).toBeNull();
});

test('Clavei does not treat numeric string zero as enabled and unknown results cannot be downloaded',async()=>{
 fiscalFlowRequest.mockImplementation(path=>Promise.resolve(path.endsWith('/config')?{codemp:'005',ivagenast:'0'}:path.endsWith('/envios')?[{id:'unknown',numero:'QA',entity_type:'invoice',status:'unknown'}]:[]));
 await act(async()=>root.render(<ClaveiconPanel canConfigure/>));
 const label=[...container.querySelectorAll('label')].find(el=>el.textContent.includes('Generar asiento'));
 expect(label.querySelector('input').checked).toBe(false);
 expect([...container.querySelectorAll('button')].find(el=>el.textContent==='Descargar XML').disabled).toBe(true);
 expect(container.textContent).toContain('Verificado: no importado');
});
