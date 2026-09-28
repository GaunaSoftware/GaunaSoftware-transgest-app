import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CompanyInsurance from './CompanyInsurance';
import { getPolizasEmpresa, guardarPolizaEmpresa } from '../services/api';
import { clearRuntimeFocus, setRuntimeFocus } from '../services/runtimeFocus';

jest.mock('../services/api',()=>({getPolizasEmpresa:jest.fn(),guardarPolizaEmpresa:jest.fn()}));
const policy={id:'11111111-1111-4111-8111-111111111111',aseguradora:'AXA',cobertura:'Seguro de prueba',matricula_referencia:'QA-123',fecha_vencimiento:'2026-10-01',importe_referencia:'100.00',activo:true};
let root,node;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;node=document.createElement('div');document.body.appendChild(node);root=createRoot(node);getPolizasEmpresa.mockResolvedValue([policy]);guardarPolizaEmpresa.mockResolvedValue(policy);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();clearRuntimeFocus('tms_seguros_focus');jest.clearAllMocks();});
test('insurance notice opens its policy while the reference premium stays informational',async()=>{
  await act(async()=>root.render(<CompanyInsurance canEdit/>));
  expect(node.textContent).toContain('QA-123');
  await act(async()=>setRuntimeFocus('tms_seguros_focus',{poliza_id:policy.id}));
  expect(node.querySelector('#polizas-empresa-form')).not.toBeNull();
  expect(node.querySelector('input[type="number"]').value).toBe('100.00');
  expect(node.textContent).toContain('no genera un gasto');
  await act(async()=>node.querySelector('#polizas-empresa-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(guardarPolizaEmpresa).toHaveBeenCalledWith(expect.objectContaining({matricula_referencia:'QA-123',fecha_vencimiento:'2026-10-01'}),policy.id);
});
test('read-only office role cannot edit insurance policies',async()=>{
  await act(async()=>root.render(<CompanyInsurance canEdit={false}/>));
  expect(node.textContent).toContain('Seguro de prueba');
  expect([...node.querySelectorAll('button')].some(button=>button.textContent==='Editar')).toBe(false);
});
