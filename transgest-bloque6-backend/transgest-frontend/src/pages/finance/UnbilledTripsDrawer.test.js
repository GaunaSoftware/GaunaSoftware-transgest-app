import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import UnbilledTripsDrawer from './UnbilledTripsDrawer';
import { getViajesSinFacturar, getViajesSinFacturarCliente } from '../../services/api';

jest.mock('../../services/api', () => ({
  getViajesSinFacturar: jest.fn(),
  getViajesSinFacturarCliente: jest.fn(),
}));

const groups = [
  { cliente_id: 'a', cliente_nombre: 'Cliente A', viajes: 2, importe_registrado: 150 },
  { cliente_id: 'b', cliente_nombre: 'Cliente B', viajes: 1, importe_registrado: 80 },
];
const trips = {
  a: [
    { id: 'a1', numero: 'PED-A1', estado_importe: 'positivo', importe_registrado: 100, importe: 100, origen: 'Madrid', destino: 'Valencia' },
    { id: 'a2', numero: 'PED-A2', estado_importe: 'positivo', importe_registrado: 50, importe: 50, origen: 'Valencia', destino: 'Murcia' },
  ],
  b: [{ id: 'b1', numero: 'PED-B1', estado_importe: 'positivo', importe_registrado: 80, importe: 80, origen: 'Sevilla', destino: 'Cádiz' }],
};

test('selection stays inside one client and invoices exactly the selected trips', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  getViajesSinFacturar.mockResolvedValue({ data: groups, total: 2, resumen: { clientes: 2, viajes: 3, importe_registrado: 230 } });
  getViajesSinFacturarCliente.mockImplementation(async id => ({ data: trips[id], total: trips[id].length }));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const invoice = jest.fn();
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent.includes(label));
  try {
    await act(async () => { root.render(<UnbilledTripsDrawer open canEdit onClose={() => {}} onInvoice={invoice} />); });
    expect(document.body.textContent).toContain('3 viajes pendientes');
    await act(async () => { button('Cliente A').click(); });
    await act(async () => { button('Seleccionar viajes mostrados').click(); });
    expect(button('Preparar factura').disabled).toBe(false);
    await act(async () => { button('Cliente B').click(); });
    expect(button('Preparar factura').disabled).toBe(true);
    await act(async () => { document.querySelector('input[aria-label="Seleccionar PED-B1"]').click(); });
    await act(async () => { button('Preparar factura').click(); });
    expect(invoice).toHaveBeenCalledWith('b', [trips.b[0]]);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
