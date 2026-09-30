import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LiveOperations from './LiveOperations';
import DashboardWorkspace from './DashboardWorkspace';
import { dashboardAssignment } from '../orders/quickInfo';

jest.mock('../../services/api', () => ({ getPedidosTodos: jest.fn() }));
jest.mock('../../context/AuthContext', () => ({useAuth:()=>({puedeVer:()=>true,puedeEditar:()=>true})}));
jest.mock('../../ui', () => ({
  ...jest.requireActual('../../ui'),
  Card: ({children}) => <div>{children}</div>,
  Button: ({children}) => <button>{children}</button>,
  Select: ({children}) => <select>{children}</select>,
  Badge: ({children}) => <span>{children}</span>,
  EmptyState: ({title}) => <div>{title}</div>,
}));

test('dashboard treats an external collaborator as an assignment without an internal driver', () => {
  const order={id:'external',numero:'PED-2026-0397',colaborador_id:'supplier',colaborador_nombre:'Transportes QA',estado:'confirmado',fecha_carga:'2099-01-01'};
  const html=renderToStaticMarkup(<LiveOperations initialItems={[order]} onSnapshot={()=>{}} openOrder={()=>{}}/>);
  expect(html).toContain('Asignado a Transportes QA');
  expect(html).toContain('Viaje confirmado y pendiente de carga');
  expect(html).not.toContain('Sin conductor');
  expect(html).not.toContain('Sin vehículo');
  expect(dashboardAssignment({...order,colaborador_nombre:''})).toBe('Asignado a colaborador');
  expect(dashboardAssignment({...order,matricula_colaborador:'1234 ABC'})).toBe('Asignado a Transportes QA · 1234 ABC');
  expect(dashboardAssignment({})).toContain('Sin asignar');
  expect(dashboardAssignment({vehiculo_matricula:'1234 ABC',chofer_nombre:'Ana',chofer_apellidos:'García'})).toBe('1234 ABC · Ana García');
});

test('dashboard and live operations use structured locations without rewriting the order', () => {
  const today=new Date().toISOString().slice(0,10);
  const order={id:'locations',numero:'QA-LOC',estado:'confirmado',fecha_carga:today,origen:'Población pendiente',destino:'Población desconocida',puntos_carga:[{ciudad:'Castellón',direccion:'Polígono Norte 4'}],puntos_descarga:[{ciudad:'Alboraya',direccion:'Calle Puerto 2'}]};
  const noop=()=>{};
  const html=renderToStaticMarkup(<DashboardWorkspace pedidos={[order]} facturas={[]} vehiculos={[]} choferes={[]} alertas={[]} tareas={[]} loadErrors={[]} onSnapshot={noop} openOrder={noop} navigate={noop} stateMeta={()=>({label:'Confirmado'})}/>);
  expect(html).toContain('CASTELLÓN');
  expect(html).toContain('ALBORAYA');
  expect(html).not.toMatch(/Población (pendiente|desconocida)/);
  expect(order.origen).toBe('Población pendiente');
});

test('live operations reconciles the loaded badge with its counter without inventing departure', () => {
  const order={id:'loaded',numero:'QA-CARGADO',estado:'en_curso',estado_operativo:{codigo:'cargado',estado_legacy:'en_curso'},fecha_carga:'2099-01-01'};
  const html=renderToStaticMarkup(<LiveOperations initialItems={[order]} onSnapshot={()=>{}} openOrder={()=>{}}/>);
  expect(html).toContain('Carga terminada');
  expect(html).toContain('sin salida registrada');
  expect(html).not.toContain('<span>Carga terminada</span>');
  expect(html).toContain('<strong>0</strong><span>En tránsito</span>');
  expect(html).not.toContain('En ruta');
  expect(order.estado).toBe('en_curso');
});


test('today agenda shows the assigned supplier without an internal vehicle', () => {
  const now=new Date(), today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const order={id:'agenda-supplier',numero:'QA-AGENDA',estado:'confirmado',fecha_carga:today,colaborador_id:'supplier',colaborador_nombre:'Proveedor Agenda'};
  const html=renderToStaticMarkup(<DashboardWorkspace pedidos={[order]} facturas={[]} vehiculos={[]} choferes={[]} alertas={[]} tareas={[]} loadErrors={[]} onSnapshot={()=>{}} openOrder={()=>{}} navigate={()=>{}} stateMeta={()=>({label:'Confirmado'})}/>);
  const agenda=html.split('Cargas y descargas de hoy')[1].split('Acciones rápidas')[0];
  expect(agenda).toContain('Asignado a Proveedor Agenda');expect(agenda).not.toContain('Sin asignar');
});
