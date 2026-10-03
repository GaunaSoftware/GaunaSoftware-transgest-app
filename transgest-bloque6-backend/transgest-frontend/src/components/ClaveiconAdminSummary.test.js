import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClaveiconAdminSummary from './ClaveiconAdminSummary';

global.IS_REACT_ACT_ENVIRONMENT = true;
let node, root;
beforeEach(() => { node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(() => { act(() => root.unmount()); node.remove(); });
const config = { config: { codemp: 'PRUEB' }, credential_configured: true, credential_mask: '…abcd' };
const button = label => [...node.querySelectorAll('button')].find(el => el.textContent === label);

test('tests the saved company credential without sending a key or accounting data, and explains a provider 401', async () => {
  const request = jest.fn(async path => path.endsWith('/probar-conexion') ? { ok: false, http_status: 401 } : config);
  await act(async () => root.render(<ClaveiconAdminSummary empresaId="company-tlm" request={request} defaultOpen />));
  expect(node.querySelector('input[type=password]').value).toBe('');
  await act(async () => button('Probar conexión').click());
  expect(request).toHaveBeenLastCalledWith('/integraciones/fiscal/company-tlm/claveicon/probar-conexion', { method: 'POST' });
  expect(node.querySelector('[role=alert]').textContent).toContain('HTTP 401');
  expect(node.querySelector('[role=alert]').textContent).toContain('ClaveiCon no ha aceptado');
  expect(node.querySelector('[role=status]')).toBeNull();
  expect(button('Probar conexión').disabled).toBe(false);
});

test('confirms a visible ERP company without enabling imports and allows preserving the saved credential', async () => {
  const request = jest.fn(async path => path.endsWith('/probar-conexion')
    ? { ok: true, company_list_recognized: true, company_visible: true, expected_code: 'PRUEB' } : config);
  await act(async () => root.render(<ClaveiconAdminSummary empresaId="company-tlm" request={request} defaultOpen />));
  await act(async () => button('Probar conexión').click());
  expect(node.querySelector('[role=status]').textContent).toContain('PRUEB');
  expect(node.querySelector('[role=status]').textContent).toContain('pendiente de validación');
  await act(async () => node.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(request).toHaveBeenCalledWith('/integraciones/fiscal/company-tlm/claveicon/credencial', {
    method: 'PUT', body: { api_key: '', codemp: 'PRUEB' },
  });
});
