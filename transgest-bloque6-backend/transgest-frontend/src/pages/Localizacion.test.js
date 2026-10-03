import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Localizacion from './Localizacion';
import { getFleetLocations } from '../services/api';

jest.mock('../services/api', () => ({ getFleetLocations: jest.fn() }));
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
  getFleetLocations.mockResolvedValue({ generated_at: capturedAt, items: [vehicle('2418-LPH'), vehicle('4456-LKV', 'obsoleta')] });
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); jest.useRealTimers(); jest.clearAllMocks(); });

test('shows only verified recent map positions, with old signal clearly labelled and searchable vehicles', async () => {
  await act(async () => root.render(<Localizacion />));
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

test('expires a signal locally if refreshing fails, exposes the failure and supports a manual retry', async () => {
  await act(async () => root.render(<Localizacion />));
  getFleetLocations.mockRejectedValue(new Error('Consulta temporalmente no disponible'));
  await act(async () => { jest.setSystemTime(new Date(Date.parse(capturedAt) + 901000)); jest.advanceTimersByTime(10000); });
  expect(node.querySelector('[data-testid=fleet-map]').textContent).toBe('');
  await act(async () => node.querySelector('header button').click());
  expect(node.querySelector('[role=alert]').textContent).toContain('Consulta temporalmente no disponible');
  expect(node.querySelector('header button').disabled).toBe(false);
});
