import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import AgendaNotices from './AgendaNotices';
import {getAgendaPreferences,saveAgendaPreferences,getCentroAvisos} from '../services/api';
jest.mock('../context/AuthContext',()=>({useAuth:()=>({user:{id:'a',empresa_id:'company'}})}));
jest.mock('../services/api',()=>({getAgendaPreferences:jest.fn(),saveAgendaPreferences:jest.fn(),getCentroAvisos:jest.fn()}));
let node,root;
const prefs={notice_types:[],allowed:[{key:'operativa',label:'Tráfico'},{key:'facturas',label:'Facturas'}],recommended:['operativa']};
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;getAgendaPreferences.mockResolvedValue(prefs);getCentroAvisos.mockResolvedValue({items:[],date:'2026-09-27'});saveAgendaPreferences.mockImplementation(async types=>({...prefs,notice_types:types}));node=document.createElement('div');document.body.appendChild(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();jest.clearAllMocks();});
const click=async text=>act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent===text).click());
test('the default calendar does not fetch automatic notices; profile choices persist',async()=>{
  await act(async()=>root.render(<AgendaNotices/>));expect(getCentroAvisos).not.toHaveBeenCalled();
  await click('Configurar agenda');await click('Sugeridos para mi perfil');
  expect(node.querySelectorAll('input:checked')).toHaveLength(1);
  await act(async()=>node.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(saveAgendaPreferences).toHaveBeenCalledWith(['operativa']);expect(getCentroAvisos).toHaveBeenCalledTimes(1);expect(node.textContent).toContain('Avisos seleccionados');
});
test('a failed save keeps the old calendar and shows the error',async()=>{
  await act(async()=>root.render(<AgendaNotices/>));await click('Configurar agenda');await click('Sugeridos para mi perfil');saveAgendaPreferences.mockRejectedValueOnce(Error('Sin conexión'));
  await act(async()=>node.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(node.querySelector('[role=alert]').textContent).toBe('Sin conexión');expect(getCentroAvisos).not.toHaveBeenCalled();
});
