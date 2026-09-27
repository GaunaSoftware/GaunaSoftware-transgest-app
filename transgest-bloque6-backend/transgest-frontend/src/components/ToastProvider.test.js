import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import ToastProvider from './ToastProvider';
import {confirmDialog} from '../services/notify';
test('date confirmation distinguishes original, today and cancel without changing boolean callers',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<ToastProvider><div/></ToastProvider>));
  for(const [label,expected] of [['Conservar fecha original','alternate'],['Registrar carga de hoy',true],['Cancelar',false]]){
   let answer;await act(async()=>{answer=confirmDialog({title:'Fecha de carga',alternateText:'Conservar fecha original',confirmText:'Registrar carga de hoy'});});
   await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===label).click());expect(await answer).toBe(expected);
  }
  let answer;await act(async()=>{answer=confirmDialog({title:'Compatibilidad'});});
  expect(host.textContent).not.toContain('Conservar fecha original');await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Confirmar').click());expect(await answer).toBe(true);
 }finally{await act(async()=>root.unmount());host.remove();}
});
