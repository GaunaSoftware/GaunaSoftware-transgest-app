import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ControlTowerFlowDetails from './ControlTowerFlowDetails';
import { getControlTowerFlow } from '../../services/api';
jest.mock('../../services/api', () => ({ getControlTowerFlow: jest.fn() }));

let root, host;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  getControlTowerFlow.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const click = async label => { await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent.includes(label)).click()); };

test('loads complete count with separate pages and opens the selected order', async () => {
  getControlTowerFlow.mockImplementation((estado, page) => Promise.resolve({ total: 1501, page_size: 40, items: [{ id:`p${page}`, numero:`QA-${page}`, origen:'A',destino:'B' }] }));
  const onSelect=jest.fn(),onClose=jest.fn();
  await act(async () => root.render(<ControlTowerFlowDetails selection={{ key:'cargado',label:'Cargado',remote:true }} onSelect={onSelect} onClose={onClose}/>));
  expect(document.body.textContent).toContain('1501 viajes · Página 1 de 38');
  await click('Siguiente');
  expect(document.body.textContent).toContain('1501 viajes · Página 2 de 38');
  expect(document.body.textContent).not.toContain('QA-1');
  await click('QA-2');expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id:'p2' }));
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(onClose).toHaveBeenCalled();
});

test('errors remain visible and can be retried; old requests cannot replace a new selection', async () => {
  getControlTowerFlow.mockRejectedValueOnce(Error('Sin conexión')).mockResolvedValueOnce({total:0,page_size:40,items:[]});
  await act(async () => root.render(<ControlTowerFlowDetails selection={{key:'cargado',label:'Cargado',remote:true}}/>));
  expect(document.querySelector('[role="alert"]').textContent).toContain('Sin conexión');
  expect(document.body.textContent).not.toContain('No hay viajes');
  await click('Reintentar');expect(document.body.textContent).toContain('No hay viajes');
  let finishOld;
  getControlTowerFlow.mockReturnValueOnce(new Promise(resolve=>{finishOld=resolve;})).mockResolvedValueOnce({total:1,page_size:40,items:[{id:'new',numero:'NEW'}]});
  await act(async () => root.render(<ControlTowerFlowDetails selection={{key:'en_curso',label:'En curso',remote:true}}/>));
  await act(async () => root.render(<ControlTowerFlowDetails selection={{key:'en_transito',label:'En tránsito',remote:true}}/>));
  await act(async()=>finishOld({total:1,page_size:40,items:[{id:'old',numero:'OLD'}]}));
  expect(document.body.textContent).toContain('NEW');expect(document.body.textContent).not.toContain('OLD');
});
