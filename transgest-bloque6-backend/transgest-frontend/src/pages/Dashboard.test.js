import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Dashboard from './Dashboard';
import { getPedidosTodos, getFacturasTodas, getVehiculos, getChoferes, getEmpresaConfig,
  getExcepcionesOperativas, getTallerEstado, getPaletMovimientos, getBiResumen } from '../services/api';

jest.mock('../context/AuthContext', () => {
  const user = { id:'qa-go', rol:'gerente', plan:'lite' };
  const allowed = new Set(['dashboard','pedidos','facturacion','vehiculos','choferes','empresa']);
  const puedeVer = module => allowed.has(module);
  return { useAuth: () => ({ user, puedeVer }) };
});
jest.mock('../services/api', () => ({
  getPedidosTodos:jest.fn(()=>Promise.resolve([])),
  getFacturasTodas:jest.fn(()=>Promise.resolve([])),
  getVehiculos:jest.fn(()=>Promise.resolve([])),
  getChoferes:jest.fn(()=>Promise.resolve([])),
  getExcepcionesOperativas:jest.fn(()=>Promise.resolve({data:[]})),
  getEmpresaConfig:jest.fn(()=>Promise.resolve({cfg_alertas:[]})),
  getTallerEstado:jest.fn(()=>Promise.resolve(null)),
  getPaletMovimientos:jest.fn(()=>Promise.resolve([])),
  getBiResumen:jest.fn(()=>Promise.resolve({})),
}));
jest.mock('./dashboard/DashboardWorkspace', () => () => <div>Dashboard cargado</div>);
jest.mock('./dashboard/DashboardBI', () => () => null);

test('Go loads its operational dashboard without requesting restricted BI, workshop or pallet data', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  for (const loader of [getPedidosTodos,getFacturasTodas,getVehiculos,getChoferes]) loader.mockResolvedValue([]);
  getEmpresaConfig.mockResolvedValue({cfg_alertas:[]});
  const node = document.createElement('div');
  const root = createRoot(node);
  await act(async()=>{root.render(<Dashboard/>);await Promise.resolve();});
  expect(node.textContent).toContain('Dashboard cargado');
  for (const loader of [getPedidosTodos,getFacturasTodas,getVehiculos,getChoferes]) expect(loader).toHaveBeenCalled();
  for (const loader of [getBiResumen,getExcepcionesOperativas,getTallerEstado,getPaletMovimientos]) expect(loader).not.toHaveBeenCalled();
  await act(async()=>root.unmount());
});
