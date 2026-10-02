import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import Vehiculos from './Vehiculos';
import Choferes from './Choferes';
import * as api from '../services/api';
import {useAuth} from '../context/AuthContext';
import useRuntimeFocus from '../hooks/useRuntimeFocus';

jest.mock('../context/AuthContext',()=>({useAuth:jest.fn()}));
jest.mock('../hooks/useRuntimeFocus',()=>({__esModule:true,default:jest.fn()}));
jest.mock('../services/api',()=>Object.fromEntries([
  'getVehiculos','getPedidos','getChoferes','getGpsProviders','getGpsStatus',
  'getDocsVehiculo','getTallerEstado','crearVehiculo','crearChofer',
].map(name=>[name,jest.fn()])));

let root,host;
const click=label=>act(async()=>{
  const button=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
  expect(button).toBeTruthy();
  button.click();
});
beforeEach(()=>{
  jest.clearAllMocks();jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT=true;
  useAuth.mockReturnValue({user:{rol:'gerente'},puedeEditar:()=>true,puedeVer:()=>true});
  useRuntimeFocus.mockReturnValue(null);
  for(const name of ['getVehiculos','getPedidos','getChoferes','getDocsVehiculo'])api[name].mockResolvedValue([]);
  api.getGpsProviders.mockResolvedValue({providers:[]});
  api.getGpsStatus.mockResolvedValue(null);api.getTallerEstado.mockResolvedValue(null);
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.clearAllTimers();jest.useRealTimers();});

test.each([
  ['tractoras','Nueva tractora','Tractora',null],
  ['remolques','Nuevo remolque','Remolque - Tautliner (lona)',null],
  ['tractoras','Nueva tractora','Tractora',{}],
])('new %s opens identification with no vehicle notice',async(type,title,vehicleClass,focus)=>{
  useRuntimeFocus.mockReturnValue(focus);
  await act(async()=>root.render(<Vehiculos initialTipo={type}/>));
  await click('+ Nuevo vehículo');
  const modal=host.querySelector('.fleet-overlay');
  expect(modal.textContent).toContain(title);
  expect(modal.textContent).toContain('Datos de identificación');
  expect(modal.querySelector('input[placeholder="1234-ABC"]').value).toBe('');
  expect(modal.querySelector('select').value).toBe(vehicleClass);
  await click('Cerrar');
  expect(host.querySelector('.fleet-overlay')).toBeNull();
  expect(api.crearVehiculo).not.toHaveBeenCalled();
});

test('an existing vehicle notice still opens its documentation tab',async()=>{
  api.getVehiculos.mockResolvedValue([{id:'qa-vehicle',matricula:'0000-QAA',clase:'Tractora',estado:'disponible'}]);
  useRuntimeFocus.mockImplementation(key=>key==='tms_vehiculos_focus'?{vehiculo_id:'qa-vehicle',section:'documentacion'}:null);
  await act(async()=>root.render(<Vehiculos initialTipo="tractoras"/>));
  await act(async()=>jest.advanceTimersByTime(200));
  const modal=host.querySelector('.fleet-overlay');
  expect(modal.textContent).toContain('0000-QAA');
  expect(modal.textContent).toContain('ITV y documentación');
  expect(modal.textContent).not.toContain('Datos de identificación');
  expect(api.getDocsVehiculo).toHaveBeenCalledWith('qa-vehicle');
});

test('new driver opens personal data with no driver notice',async()=>{
  await act(async()=>root.render(<Choferes/>));
  await click('+ Nuevo conductor');
  expect(host.textContent).toContain('Nuevo conductor');
  expect(host.textContent).toContain('Datos personales');
  expect(host.querySelector('input[placeholder="José"]').value).toBe('');
  expect(api.crearChofer).not.toHaveBeenCalled();
});
