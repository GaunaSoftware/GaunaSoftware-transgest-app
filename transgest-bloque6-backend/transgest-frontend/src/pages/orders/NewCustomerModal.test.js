import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NewCustomerModal from './NewCustomerModal';
import { crearCliente } from '../../services/api';

jest.mock('../../services/api', () => ({ crearCliente: jest.fn() }));
jest.mock('../../components/GeoFields', () => ({ GeoFields: () => null }));

let host, root, onCreated;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host); onCreated = jest.fn();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.clearAllMocks(); });
const render = name => act(async () => root.render(<NewCustomerModal datosIniciales={{ nombre: name }} onCreado={onCreated} onClose={() => {}} />));
async function type(label, value) {
  const element = [...host.querySelectorAll('label')].find(item => item.textContent === label).parentElement.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'Crear cliente y continuar');
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

test('una ficha incompleta se crea y permite continuar con el mismo cliente confirmado', async () => {
  const customer = { id: 'nuevo-uuid', nombre: 'Cliente Z', pendiente_revision: true, bloqueado: false };
  crearCliente.mockResolvedValue(customer);
  await render('Cliente Z');
  expect(host.textContent).toContain('puedes continuar con el pedido');
  await submit();
  expect(crearCliente).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Cliente Z', cif: '', pendiente_revision: true }));
  expect(onCreated).toHaveBeenCalledWith(customer);
});

test('un cliente completo conserva sus datos fiscales y no pide revisión por campos vacíos', async () => {
  crearCliente.mockResolvedValue({ id: 'nuevo-uuid', nombre: 'Cliente completo' });
  await render('Cliente completo');
  for (const [label, value] of [['CIF / NIF', 'B12345678'], ['Telefono', '600000000'], ['Email', 'cliente@example.invalid'], ['Calle / Avenida', 'Calle Prueba'], ['N. / Piso / Pta', '1'], ['Codigo postal', '28013'], ['Ciudad', 'Madrid']]) await type(label, value);
  await submit();
  expect(crearCliente).toHaveBeenCalledWith(expect.objectContaining({ direccion: 'Calle Prueba 1', cp: '28013', ciudad: 'Madrid', pendiente_revision: false }));
});

test('un rechazo real del servidor se muestra y no selecciona un cliente que no se ha guardado', async () => {
  crearCliente.mockRejectedValue(new Error('Ya existe un cliente activo con ese CIF.'));
  await render('Cliente repetido'); await submit();
  expect(host.textContent).toContain('Ya existe un cliente activo con ese CIF.');
  expect(onCreated).not.toHaveBeenCalled();
});

test('la razón social sigue siendo obligatoria', async () => {
  await render('   '); await submit();
  expect(crearCliente).not.toHaveBeenCalled(); expect(onCreated).not.toHaveBeenCalled();
  expect(host.textContent).toContain('El nombre / razon social es obligatorio.');
});
