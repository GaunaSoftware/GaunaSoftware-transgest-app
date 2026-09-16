import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CompanyProducts from './CompanyProducts';

global.IS_REACT_ACT_ENVIRONMENT = true;
let node,root;
beforeEach(()=>{node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(()=>{act(()=>root.unmount());node.remove();});

test('saves a company-specific combination and keeps product selection separate from billing',async()=>{
  const request=jest.fn().mockResolvedValueOnce({modalidad:'transgest'}).mockResolvedValueOnce({modalidad:'combinado'});
  await act(async()=>root.render(<CompanyProducts empresaId="company-a" request={request}/>));
  expect(request).toHaveBeenCalledWith('/empresas/company-a/productos');
  expect(node.querySelector('button').disabled).toBe(true);
  act(()=>{const select=node.querySelector('select');select.value='combinado';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(node.querySelector('button').disabled).toBe(false);
  await act(async()=>node.querySelector('button').click());
  expect(request).toHaveBeenLastCalledWith('/empresas/company-a/productos',{method:'PUT',body:{modalidad:'combinado'}});
  expect(node.querySelector('button').disabled).toBe(true);
  expect(node.textContent).toContain('no modifica tarifas ni genera cobros');
});

test('does not silently enable a product after a failed read',async()=>{
  const request=jest.fn().mockRejectedValue(new Error('Sin conexión'));
  await act(async()=>root.render(<CompanyProducts empresaId="company-b" request={request}/>));
  expect(node.querySelector('[role="alert"]').textContent).toBe('Sin conexión');
  expect(node.querySelector('button').disabled).toBe(true);
  expect(node.querySelector('select').disabled).toBe(true);
});
