import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NoticeList, NoticeSettings } from './NoticeCenter';
import { openNotice } from '../services/noticeNavigation';
import { readRuntimeFocus, setRuntimeFocus, clearRuntimeFocus } from '../services/runtimeFocus';
import useRuntimeFocus from '../hooks/useRuntimeFocus';
import { uniquePendingTasks } from '../services/operativeTasks';
import { guardarConfiguracionAvisos } from '../services/api';
jest.mock('../services/api',()=>({ guardarConfiguracionAvisos:jest.fn(async()=>[]),getCentroAvisos:jest.fn() }));
const invoice={id:'invoice',category:'facturas',title:'Factura A-2026-0072',entity:'CLIENTE SINTÉTICO',date:'2026-09-01',days:-26,amount:1210,view:'facturacion',focusKey:'tms_facturacion_focus',focus:{factura_id:'qa-invoice',open:true}};
let node,root;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;node=document.createElement('div');document.body.appendChild(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();clearRuntimeFocus('tms_facturacion_focus');});
test('due invoice opens its invoice focus, never the generic notices page',async()=>{
  const events=[];const receive=e=>events.push(e.detail);window.addEventListener('tms:navegar',receive);
  await act(async()=>root.render(<NoticeList data={{items:[invoice],date:'2026-09-27'}} reload={()=>{}}/>));
  expect(node.textContent).toContain((1210).toLocaleString('es-ES',{style:'currency',currency:'EUR'}));
  await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Ver factura').click());
  expect(events).toEqual(['facturacion']);expect(readRuntimeFocus('tms_facturacion_focus').factura_id).toBe('qa-invoice');
  expect(readRuntimeFocus('tms_finance_tab')).toBe('facturas');
  window.removeEventListener('tms:navegar',receive);
});
test('mounted destinations receive subsequent focus changes',async()=>{
  function Target(){const focus=useRuntimeFocus('tms_facturacion_focus');return <p>{focus?.factura_id}</p>;}
  await act(async()=>root.render(<Target/>));
  await act(async()=>openNotice(invoice));expect(node.textContent).toBe('qa-invoice');
  await act(async()=>setRuntimeFocus('tms_facturacion_focus',{factura_id:'second'}));expect(node.textContent).toBe('second');
});
test('error remains distinct from no due notices',async()=>{
  await act(async()=>root.render(<NoticeList data={null} error="Consulta fallida" reload={()=>{}}/>));
  expect(node.querySelector('[role="alert"]').textContent).toContain('Consulta fallida');expect(node.textContent).not.toContain('Sin avisos');
});
test('settings stay read-only without manager permission',async()=>{
  await act(async()=>root.render(<NoticeSettings data={{categories:[{key:'facturas',label:'Facturas',enabled:true,days:30}]}} canEdit={false}/>));
  expect(node.querySelector('fieldset').disabled).toBe(true);expect(node.querySelector('button[type="submit"]')).toBeNull();expect(guardarConfiguracionAvisos).not.toHaveBeenCalled();
});
test('only repeated reminders for the same operational condition are grouped',()=>{
  const metadata={source:'avisos_operativos_colaborador',alert_key:'p1:pod'};
  expect(uniquePendingTasks([{id:1,metadata},{id:2,metadata},{id:3,metadata:{...metadata,alert_key:'p2:pod'}},{id:4,titulo:'Call'},{id:5,titulo:'Call'}]).map(e=>e.id)).toEqual([1,3,4,5]);
});
