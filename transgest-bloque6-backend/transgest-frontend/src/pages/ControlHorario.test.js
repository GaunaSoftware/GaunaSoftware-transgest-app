import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import ControlHorario from './ControlHorario';
import * as api from '../services/api';
import {useAuth} from '../context/AuthContext';
jest.mock('../context/AuthContext',()=>({useAuth:jest.fn()}));
jest.mock('../services/notify',()=>({notify:jest.fn()}));
jest.mock('../services/api',()=>Object.fromEntries(['getControlHorario','getControlHorarioResumen','getMiControlHorario','ficharControlHorario','editarControlHorario','controlHorarioCsvUrl','getControlHorarioConfig','saveControlHorarioConfig','getTeletrabajoSolicitudes','crearTeletrabajoSolicitud','resolverTeletrabajoSolicitud','getJornadaConfig','saveJornadaConfig','getOfficeVacationRequests','createOfficeVacationRequest','resolveOfficeVacationRequest'].map(name=>[name,jest.fn()])));
let root,host;
const click=label=>act(async()=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent===label);expect(button).toBeTruthy();button.click();});
const setValue=(label,value)=>act(async()=>{const input=host.querySelector(`[aria-label="${label}"]`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
beforeEach(()=>{
  jest.resetAllMocks();global.IS_REACT_ACT_ENVIRONMENT=true;
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  useAuth.mockReturnValue({user:{id:'office',rol:'administrativo'}});
  api.getMiControlHorario.mockResolvedValue(null);api.getControlHorario.mockResolvedValue([]);
  api.getControlHorarioResumen.mockResolvedValue({resumen:{jornadas:0},abiertas:[],por_usuario:[{usuario_id:'office',nombre:'Empleado sintético',rol:'administrativo'}]});
  api.getControlHorarioConfig.mockResolvedValue({configurada:false});
  api.getJornadaConfig.mockResolvedValue({usuario_id:'office',hora_entrada:'08:00',hora_salida:'16:00',pausa_min:0});
  api.getTeletrabajoSolicitudes.mockResolvedValue([]);api.getOfficeVacationRequests.mockResolvedValue([]);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});

test.each(['trafico','administrativo','contable'])('%s clocks without payroll links or schedule editing',async rol=>{
  useAuth.mockReturnValue({user:{rol}});await act(async()=>root.render(<ControlHorario/>));
  expect(host.textContent).not.toMatch(/Nóminas|Hojas de ruta|Guardar jornada prevista/);
  expect(host.querySelector('input[type="time"]')).toBeNull();
  expect(host.textContent).toContain('08:00');expect(host.textContent).toContain('0h 00m');
  await click('Fichar entrada');
  expect(api.ficharControlHorario).toHaveBeenCalledWith(expect.objectContaining({accion:'entrada',ubicacion_gps:null}));
  expect(api.editarControlHorario).not.toHaveBeenCalled();expect(api.saveJornadaConfig).not.toHaveBeenCalled();
});

test('employees request holidays and future remote work, but cannot approve',async()=>{
  api.getOfficeVacationRequests.mockResolvedValue([{id:'v',desde:'2027-01-10',hasta:'2027-01-12',estado:'pendiente'}]);
  await act(async()=>root.render(<ControlHorario/>));
  await setValue('Inicio de vacaciones','2027-01-10');await setValue('Fin de vacaciones','2027-01-12');
  const vacationForm=host.querySelector('[aria-label="Vacaciones"] form');
  await act(async()=>vacationForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(api.createOfficeVacationRequest).toHaveBeenCalledWith({desde:'2027-01-10',hasta:'2027-01-12',motivo:''});
  expect(host.textContent).not.toContain('Aprobar');
  await setValue('Día de teletrabajo','2028-01-10');
  await act(async()=>host.querySelector('[aria-label="Teletrabajo"] form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(api.crearTeletrabajoSolicitud).toHaveBeenCalledWith({fecha:'2028-01-10',motivo:''});
  expect(api.getTeletrabajoSolicitudes).toHaveBeenLastCalledWith(expect.objectContaining({hasta:'2028-01-10'}));
});

test('gerencia can configure a named employee and approve a holiday request',async()=>{
  useAuth.mockReturnValue({user:{rol:'gerente'}});
  api.getOfficeVacationRequests.mockResolvedValue([{id:'v',usuario_nombre:'Empleado sintético',desde:'2027-01-10',hasta:'2027-01-12',estado:'pendiente'}]);
  await act(async()=>root.render(<ControlHorario/>));
  expect(api.getJornadaConfig).toHaveBeenCalledWith({usuario_id:'office'});
  await click('Guardar jornada prevista');expect(api.saveJornadaConfig).toHaveBeenCalledWith(expect.objectContaining({usuario_id:'office',pausa_min:0}));
  await click('Aprobar');expect(api.resolveOfficeVacationRequest).toHaveBeenCalledWith('v',{estado:'aprobada'});
  expect(host.textContent).not.toMatch(/Hojas de ruta|Nóminas/);
});

test('a clock API error is visible and does not permit a new entry from unknown state',async()=>{
  api.getMiControlHorario.mockRejectedValue(new Error('No se puede consultar tu jornada'));
  await act(async()=>root.render(<ControlHorario/>));
  expect(host.querySelector('[role="alert"]').textContent).toContain('No se puede consultar');
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Fichar entrada').disabled).toBe(true);
  expect(host.textContent).not.toContain('Sin fichajes en el periodo.');
});
