import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import GeotabCredentials,{parseGeotabCredentials} from './GeotabCredentials';
global.IS_REACT_ACT_ENVIRONMENT=true;
let node,root;
beforeEach(()=>{node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(()=>{act(()=>root.unmount());node.remove();});
test('imports an authentication JSON, masks the password and rejects a session-only or invalid file without replacing it',async()=>{
  function Form(){const [value,setValue]=useState('');return <GeotabCredentials value={value} onChange={setValue}/>;}
  await act(async()=>root.render(<Form/>));
  const picker=node.querySelector('input[type=file]');
  async function upload(text){Object.defineProperty(picker,'files',{configurable:true,value:[{size:50,text:async()=>text}]});await act(async()=>picker.dispatchEvent(new Event('change',{bubbles:true})));}
  await upload(JSON.stringify({params:{database:'demo',userName:'api@example.invalid',password:'synthetic-only'}}));
  expect(node.querySelector('[aria-label="Base de datos Geotab"]').value).toBe('demo');
  expect(node.querySelector('[aria-label="Contraseña Geotab"]').type).toBe('password');
  await upload('invalid sensitive secret');
  expect(node.querySelector('[role=alert]').textContent).not.toContain('sensitive secret');
  expect(node.querySelector('[aria-label="Base de datos Geotab"]').value).toBe('demo');
  expect(()=>parseGeotabCredentials(JSON.stringify({sessionId:'temporary'}))).toThrow(/database/);
});
