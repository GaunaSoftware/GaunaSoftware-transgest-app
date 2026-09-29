import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Login from './Login';
import { useAuth } from '../context/AuthContext';
import { getLoginBrand, getPublicAppMeta, healthCheck } from '../services/api';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../context/ThemeContext', () => ({ useTheme: () => ({ isDark: false, toggle: jest.fn() }) }));
jest.mock('../services/api', () => ({
  getLoginBrand: jest.fn(), getPublicAppMeta: jest.fn(), healthCheck: jest.fn(), requestPasswordReset: jest.fn(),
}));
jest.mock('../services/notify', () => ({ confirmDialog: jest.fn() }));
jest.mock('../utils/serverConfig', () => ({
  getConfiguredServer: () => '', setConfiguredServer: jest.fn(), clearConfiguredServer: jest.fn(),
  isDesktopApp: () => false, DEFAULT_API_URL: 'https://api.transgest.app',
}));
jest.mock('../services/mobileRuntime', () => ({ isNativeMobileApp: () => false }));

let host, root, login;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  login = jest.fn().mockResolvedValue({});
  useAuth.mockReturnValue({ login });
  healthCheck.mockResolvedValue({ status: 'ok' });
  getPublicAppMeta.mockResolvedValue({});
  getLoginBrand.mockResolvedValue({ found: false });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jest.clearAllMocks();
});
const type = async (selector, value) => act(async () => {
  const input = host.querySelector(selector);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

test('login requires company code and remembers it with the user', async () => {
  await act(async () => root.render(<Login />));
  const codeInput = host.querySelector('#login-company-code');
  expect(codeInput.required).toBe(true);
  expect(codeInput.placeholder).toMatch(/^Ej\.: TG-[A-F0-9]{16}$/);
  expect(host.textContent).not.toContain('Identifica tu empresa cuando otras');
  await type('#login-identifier', 'plg');
  await type('#login-password', 'pass1234');
  await act(async () => host.querySelector('form[aria-label="Iniciar sesión"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(login).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]').textContent).toMatch(/código de empresa/i);
  await type('#login-company-code', 'asensi-code');
  await act(async () => host.querySelector('input[type="checkbox"]').click());
  await act(async () => host.querySelector('form[aria-label="Iniciar sesión"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(login).toHaveBeenCalledWith('plg', 'pass1234', 'ASENSI-CODE');
  expect(JSON.parse(localStorage.getItem('tms_remember_credentials'))).toMatchObject({ email: 'plg', codigo_empresa: 'ASENSI-CODE' });
});
