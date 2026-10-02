import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import TrafficLocationAgenda from './TrafficLocationAgenda';
import {getEmpresaConfig,getPedidosResumenLista,getPlanDiario,editarPedido} from '../../services/api';

jest.mock('../../context/AuthContext',()=>({useAuth:()=>({puedeEditar:()=>true})}));
jest.mock('../../services/api',()=>({
 getEmpresaConfig:jest.fn(),getPedidosResumenLista:jest.fn(),getPlanDiario:jest.fn(),editarPedido:jest.fn(),
}));

const day=()=>{const now=new Date();now.setDate(now.getDate()-(now.getDay()+6)%7);return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;};

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
  expect(vehicleHeader.closest('tr').querySelector('td[colspan="7"]').textContent).toContain('1 viaje en la semana visible');
  const fold=host.querySelector('[aria-label="Plegar cargas pendientes"]');
  await act(async()=>fold.click());
  expect(host.querySelector('#plan-pendientes').hidden).toBe(true);
  expect(localStorage.getItem('tg_traffic_pending_collapsed')).toBe('1');
  await act(async()=>host.querySelector('[aria-label="Mostrar cargas pendientes"]').click());
  expect(host.querySelector('#plan-pendientes').hidden).toBe(false);
  const nextDay=host.querySelector('[aria-label="Día siguiente"]');
  const previousDay=host.querySelector('[aria-label="Día anterior"]');
  expect(previousDay.disabled).toBe(true);
  await act(async()=>nextDay.click());
  expect(previousDay.disabled).toBe(false);
  expect(host.querySelector('thead th.traffic-mobile-selected').textContent).toContain('mar');
 }finally{await act(async()=>root.unmount());host.remove();localStorage.removeItem('tg_traffic_pending_collapsed');}
});
