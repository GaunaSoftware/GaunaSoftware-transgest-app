import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import TrafficLocationAgenda from './TrafficLocationAgenda';
import {localDate,addDays} from './useTrafficDateWindow';
import {getEmpresaConfig,getPedidosResumenLista,getPlanDiario,editarPedido} from '../../services/api';

jest.mock('../../context/AuthContext',()=>({useAuth:()=>({puedeEditar:()=>true})}));
jest.mock('../../services/api',()=>({
 getEmpresaConfig:jest.fn(),getPedidosResumenLista:jest.fn(),getPlanDiario:jest.fn(),editarPedido:jest.fn(),
}));

const day=()=>localDate();

test('traffic board keeps own fleet first, groups pending loads, and folds rows and side panel',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 localStorage.removeItem('tg_traffic_pending_collapsed');
 const date=day();
 const own={id:'own',numero:'PED-QA-1',estado:'confirmado',vehiculo_id:'truck',chofer_id:'driver',vehiculo_matricula:'900-AAA',fecha_carga:date,fecha_descarga:date,km_ruta:20,origen:'A',destino:'B'};
 const supplier={...own,id:'supplier',numero:'PED-QA-2',vehiculo_id:null,colaborador_id:'supplier',colaborador_nombre:'Proveedor',matricula_colaborador:'100-AAA'};
 const pending={...own,id:'pending',numero:'PED-QA-3',vehiculo_id:null,fecha_carga:date,cliente_nombre:'Cementos',hora_carga:'09:00'};
 getEmpresaConfig.mockResolvedValue({cfg_trafico:{}});
 getPlanDiario.mockResolvedValue({rows:[{id:'truck',matricula:'900-AAA',estado:'disponible'}]});
 getPedidosResumenLista.mockResolvedValue({data:[supplier,pending,own],pagination:{hasNext:false}});
 editarPedido.mockResolvedValue({});
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  await act(async()=>{root.render(<TrafficLocationAgenda/>);});
  expect(host.querySelector('h2').textContent).toBe('Mesa de tráfico');
  expect([...host.querySelectorAll('.traffic-location-group th')].map(node=>node.textContent)).toEqual(['Flota propia','Colaboradores']);
  expect(host.textContent).toContain('Cargas pendientes (1)');
  const pendingDay=host.querySelector('.traffic-location-pending-day h3');
  expect(pendingDay).toBeTruthy();
  expect(pendingDay.getAttribute('aria-expanded')).toBe('true');
  await act(async()=>pendingDay.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
  expect(pendingDay.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.traffic-location-pending-day .traffic-location-pending')).toBeNull();
  await act(async()=>pendingDay.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(pendingDay.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('.traffic-location-pending-day .traffic-location-pending')).toBeTruthy();
  const vehicleHeader=host.querySelector('tr:not(.traffic-location-group) th[scope="row"]');
  await act(async()=>vehicleHeader.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
  expect(vehicleHeader.closest('tr').classList.contains('traffic-location-row-collapsed')).toBe(true);
  expect(vehicleHeader.closest('tr').querySelector('td[colspan="7"]').textContent).toContain('1 viaje en el período visible');
  const fold=host.querySelector('[aria-label="Plegar cargas pendientes"]');
  await act(async()=>fold.click());
  expect(host.querySelector('#plan-pendientes').hidden).toBe(true);
  expect(localStorage.getItem('tg_traffic_pending_collapsed')).toBe('1');
  await act(async()=>host.querySelector('[aria-label="Mostrar cargas pendientes"]').click());
  expect(host.querySelector('#plan-pendientes').hidden).toBe(false);
  const nextDay=host.querySelector('[aria-label="Día siguiente"]');
  const previousDay=host.querySelector('[aria-label="Día anterior"]');
  expect(previousDay.disabled).toBe(false);
  await act(async()=>nextDay.click());
  expect(previousDay.disabled).toBe(false);
  expect(host.querySelector('[aria-label="Primer día a consultar"]').value).toBe(addDays(date,1));
  await act(async()=>host.querySelector('.traffic-location-week-controls button:last-child').click());
  expect(host.querySelector('[aria-label="Primer día a consultar"]').value).toBe(date);
 }finally{await act(async()=>root.unmount());host.remove();localStorage.removeItem('tg_traffic_pending_collapsed');}
});

test('compact trips preserve opening details, and mobile assignment reuses selected pending loads',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 localStorage.removeItem('tg_traffic_pending_collapsed');
 const date=day(),truck={id:'truck',matricula:'900-AAA',estado:'disponible',chofer_id:'driver',chofer_nombre:'Ana Prueba',remolque_id:'trailer'};
 const own={id:'own',numero:'PED-TEST-1',estado:'confirmado',vehiculo_id:'truck',chofer_id:'driver',fecha_carga:date,fecha_descarga:date,km_ruta:20,origen:'Almacén completo en Calle Prueba, 20, Madrid',destino:'Cliente completo en Valencia',puntos_carga:[{ciudad:'Madrid',hora:'08:15'}],puntos_descarga:[{ciudad:'Valencia'}]};
 const pending=[1,2].map(i=>({...own,id:`pending-${i}`,numero:`PED-TEST-${i+1}`,vehiculo_id:null,chofer_id:null,cliente_nombre:'Cliente de ensayo'}));
 getEmpresaConfig.mockResolvedValue({cfg_trafico:{}});getPlanDiario.mockResolvedValue({rows:[truck]});
 getPedidosResumenLista.mockResolvedValue({data:[own,...pending],pagination:{hasNext:false}});editarPedido.mockClear();editarPedido.mockResolvedValue({});
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),navigate=jest.fn();window.addEventListener('tms:navegar',navigate);
 try{
  await act(async()=>root.render(<TrafficLocationAgenda/>));
  const card=host.querySelector('.traffic-location-scroll .traffic-location-trip');
  expect(card.textContent).toContain('Madrid → Valencia');expect(card.textContent).not.toContain('Almacén completo');
  expect(card.title).toContain('Almacén completo en Calle Prueba');
  await act(async()=>card.click());expect(navigate).toHaveBeenCalled();
  expect(host.querySelector('td .traffic-location-empty')).toBeNull();
  await act(async()=>host.querySelector('.traffic-location-mobile-assign').click());
  expect(host.querySelector('section').getAttribute('data-mobile-view')).toBe('pending');
  const vehiclesTab=host.querySelector('[role=tab][id=traffic-day-view-vehicles]');
  await act(async()=>vehiclesTab.click());expect(host.querySelector('section').getAttribute('data-mobile-view')).toBe('vehicles');
  await act(async()=>host.querySelector('[role=tab][id=traffic-day-view-pending]').click());
  expect(host.querySelector('[role=tab][id=traffic-day-view-pending]').getAttribute('aria-selected')).toBe('true');
  await act(async()=>{for(const box of host.querySelectorAll('.traffic-location-pending input[type=checkbox]'))box.click();});
  expect(host.querySelector('#traffic-vehicle-target').value).toBe('propio:truck');
  await act(async()=>host.querySelector('.traffic-location-assign button').click());
  expect(editarPedido).toHaveBeenCalledTimes(2);
  expect(editarPedido).toHaveBeenCalledWith('pending-1',{vehiculo_id:'truck',chofer_id:'driver',remolque_id:'trailer'});
  expect(editarPedido).toHaveBeenCalledWith('pending-2',{vehiculo_id:'truck',chofer_id:'driver',remolque_id:'trailer'});
  await act(async()=>host.querySelector('[aria-label="Día anterior"]').click());
  expect(getPedidosResumenLista).toHaveBeenLastCalledWith(expect.objectContaining({hasta:expect.any(String)}),{silentError:true});
 }finally{await act(async()=>root.unmount());host.remove();window.removeEventListener('tms:navegar',navigate);localStorage.removeItem('tg_traffic_pending_collapsed');}
});

test('pending search and multiple-load drag keep the existing vehicle assignment payload',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const date=day();
 const pending=[1,2].map(i=>({id:`p${i}`,numero:`PED-DND-${i}`,estado:'pendiente',fecha_carga:date,origen:'Madrid',destino:i===1?'Valencia':'Bilbao',cliente_nombre:'Cliente QA'}));
 getEmpresaConfig.mockResolvedValue({});getPlanDiario.mockResolvedValue({rows:[{id:'truck',matricula:'100-AAA',chofer_id:'driver',remolque_id:'trailer',estado:'disponible'}]});getPedidosResumenLista.mockResolvedValue({data:pending,pagination:{hasNext:false}});editarPedido.mockClear();editarPedido.mockResolvedValue({});
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<TrafficLocationAgenda/>));
  const search=host.querySelector('#traffic-pending-search'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  await act(async()=>{setter.call(search,'Bilbao');search.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelectorAll('.traffic-location-pending')).toHaveLength(1);
  await act(async()=>{setter.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{for(const box of host.querySelectorAll('.traffic-location-pending input'))box.click();});
  const data=new Map(),transfer={setData:(type,value)=>data.set(type,value),getData:type=>data.get(type)};
  const drag=new Event('dragstart',{bubbles:true});Object.defineProperty(drag,'dataTransfer',{value:transfer});
  await act(async()=>host.querySelector('.traffic-location-pending').dispatchEvent(drag));
  expect(JSON.parse(data.get('application/transgest-pedidos'))).toEqual(['p1','p2']);
  expect(host.querySelector('section').getAttribute('data-dragging')).toBe('true');
  const drop=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:transfer});
  await act(async()=>host.querySelector('tr.traffic-location-drop-valid').dispatchEvent(drop));
  expect(editarPedido).toHaveBeenCalledTimes(2);
  expect(editarPedido).toHaveBeenCalledWith('p2',{vehiculo_id:'truck',chofer_id:'driver',remolque_id:'trailer'});
  expect(host.querySelector('section').getAttribute('data-dragging')).toBe('false');
 }finally{await act(async()=>root.unmount());host.remove();}
});
