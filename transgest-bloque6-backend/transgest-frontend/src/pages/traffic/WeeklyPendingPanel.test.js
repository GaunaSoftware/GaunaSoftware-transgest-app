import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import WeeklyPendingPanel from './WeeklyPendingPanel';
test('pending panel can collapse and opens a selected order through the existing flow',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const onToggle=jest.fn(),onOpen=jest.fn(),order={id:'1',numero:'QA-1',origen:'Madrid',destino:'Valencia'};
 const props={orders:[order],open:true,onToggle,onOpen,onDragStart:jest.fn(),canEdit:true};
 try {
  await act(async()=>root.render(<WeeklyPendingPanel {...props}/>));
  await act(async()=>host.querySelector('.traffic-week-pending-item button').click());expect(onOpen).toHaveBeenCalledWith(order);
  await act(async()=>host.querySelector('button').click());expect(onToggle).toHaveBeenCalled();
  await act(async()=>root.render(<WeeklyPendingPanel {...props} open={false}/>));expect(host.textContent).not.toContain('QA-1');
  expect(host.querySelector('button').getAttribute('aria-expanded')).toBe('false');expect(host.textContent).toContain('Mostrar pendientes (1)');
 } finally {await act(async()=>root.unmount());host.remove();}
});
