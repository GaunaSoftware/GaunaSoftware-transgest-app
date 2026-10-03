import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Localizacion from './Localizacion';
import { getFleetLocations, getGpsProviders, refreshFleetGps } from '../services/api';
import { useAuth } from '../context/AuthContext';

jest.mock('../services/api', () => ({ getFleetLocations: jest.fn(), getGpsProviders: jest.fn(), refreshFleetGps: jest.fn() }));
jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../components/RouteMapCanvas', () => function Map({ points }) {
  return <div data-testid="fleet-map">{points.map(point => point.stopNumber).join(',')}</div>;
});
global.IS_REACT_ACT_ENVIRONMENT = true;
let node, root;
const capturedAt = '2026-10-03T12:00:00Z';
const vehicle = (id, status = 'reciente') => ({
  id, matricula: id, chofer_nombre: 'Ana Prueba', provider: 'geotab', status,
  last_recorded_at: capturedAt, stale_seconds: 900,
  position: status === 'reciente' ? { lat: 38, lng: -1 } : null,
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(capturedAt));
  useAuth.mockReturnValue({ puedeEditar: () => true });
  getGpsProviders.mockResolvedValue({ active_provider: 'geotab' });
  refreshFleetGps.mockResolvedValue({ updated: 14 });
  getFleetLocations.mockResolvedValue({ generated_at: capturedAt, items: [vehicle('2418-LPH'), vehicle('4456-LKV', 'obsoleta')] });
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); jest.useRealTimers(); jest.clearAllMocks(); });

test('shows only verified recent map positions, with old signal clearly labelled and searchable vehicles', async () => {
  await act(async () => root.render(<Localizacion />));
  expect(refreshFleetGps).toHaveBeenCalledWith('geotab');
  expect(refreshFleetGps.mock.invocationCallOrder[0]).toBeLessThan(getFleetLocations.mock.invocationCallOrder[0]);
  expect(node.querySelector('[role=status]').textContent).toContain('14 posiciones recibidas');
  expect(node.querySelector('[data-testid=fleet-map]').textContent).toBe('2418-LPH');
  expect(node.textContent).toContain('Señal antigua');
  expect(node.querySelectorAll('article')).toHaveLength(2);
  expect(node.querySelectorAll('a')).toHaveLength(1);
  const input = node.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '4456');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(node.querySelectorAll('article')).toHaveLength(1);
  expect(node.querySelector('article').textContent).toContain('4456-LKV');
  expect(node.querySelector('[data-testid=fleet-map]').textContent).toBe('');
});

test('refreshes the active company provider once per minute and stops when LOCATE closes', async () => {
  await act(async () => root.render(<Localizacion />));
  await act(async () => jest.advanceTimersByTime(60000));
  expect(refreshFleetGps).toHaveBeenCalledTimes(2);
  expect(getFleetLocations).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  await act(async () => jest.advanceTimersByTime(120000));
  expect(refreshFleetGps).toHaveBeenCalledTimes(2);
});

test('keeps stored and driver positions visible when the provider fails and allows retry', async () => {
  refreshFleetGps.mockRejectedValueOnce(Error('Geotab no disponible'));
  await act(async () => root.render(<Localizacion />));
  expect(node.querySelector('[role=alert]').textContent).toContain('Geotab no disponible');
  expect(node.querySelector('[data-testid=fleet-map]').textContent).toBe('2418-LPH');
  await act(async () => node.querySelector('header button').click());
  expect(node.querySelector('[role=alert]')).toBeNull();
});

test('read-only users and webhook providers only reread stored positions', async () => {
  useAuth.mockReturnValue({ puedeEditar: () => false });
  await act(async () => root.render(<Localizacion />));
  expect(refreshFleetGps).not.toHaveBeenCalled();
  expect(getGpsProviders).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  useAuth.mockReturnValue({ puedeEditar: () => true });
  getGpsProviders.mockResolvedValue({ active_provider: 'gps_generic' });
  await act(async () => root.render(<Localizacion />));
  expect(refreshFleetGps).not.toHaveBeenCalled();
  expect(getFleetLocations).toHaveBeenCalledTimes(2);
});

test('expires a signal locally if refreshing fails, exposes the failure and supports a manual retry', async () => {
  await act(async () => root.render(<Localizacion />));
  getFleetLocations.mockRejectedValue(new Error('Consulta temporalmente no disponible'));
  await act(async () => { jest.setSystemTime(new Date(Date.parse(capturedAt) + 901000)); jest.advanceTimersByTime(10000); });
  expect(node.querySelector('[data-testid=fleet-map]').textContent).toBe('');
  await act(async () => node.querySelector('header button').click());
  expect(node.querySelector('[role=alert]').textContent).toContain('Consulta temporalmente no disponible');
  expect(node.querySelector('header button').disabled).toBe(false);
});

test('refreshes multiple GPS providers independently and keeps the mixed fleet visible if one fails', async () => {
  getGpsProviders.mockResolvedValue({active_provider:'',active_providers:['geotab','movildata','locatel']});
  refreshFleetGps.mockImplementation(provider=>provider==='geotab'?Promise.reject(Error('Sin conexión')):Promise.resolve({updated:3}));
  getFleetLocations.mockResolvedValue({generated_at:capturedAt,items:[vehicle('GPS-A'),{...vehicle('GPS-B'),provider:'movildata'},{...vehicle('APP'),provider:'app_chofer'}]});
  await act(async()=>root.render(<Localizacion/>));
  expect(refreshFleetGps.mock.calls).toEqual([['geotab'],['movildata']]);
  expect(node.querySelector('[role=alert]').textContent).toContain('Geotab: Sin conexión');
  expect(node.querySelector('[role=status]').textContent).toContain('Movildata: 3 posiciones recibidas');
  expect(node.querySelector('[data-testid=fleet-map]').textContent).toBe('GPS-A,GPS-B,APP');
  expect(node.querySelectorAll('article')).toHaveLength(3);
});
