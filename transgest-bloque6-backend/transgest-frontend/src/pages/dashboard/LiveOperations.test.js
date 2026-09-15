import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LiveOperations from './LiveOperations';
import { dashboardAssignment } from '../orders/quickInfo';

jest.mock('../../services/api', () => ({ getPedidosTodos: jest.fn() }));
jest.mock('../../ui', () => ({
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
  expect(html).not.toContain('Sin conductor');
  expect(html).not.toContain('Sin vehículo');
  expect(dashboardAssignment({...order,colaborador_nombre:''})).toBe('Asignado a colaborador');
  expect(dashboardAssignment({...order,matricula_colaborador:'1234 ABC'})).toBe('Asignado a Transportes QA · 1234 ABC');
  expect(dashboardAssignment({})).toContain('Sin asignar');
  expect(dashboardAssignment({vehiculo_matricula:'1234 ABC',chofer_nombre:'Ana',chofer_apellidos:'García'})).toBe('1234 ABC · Ana García');
});
