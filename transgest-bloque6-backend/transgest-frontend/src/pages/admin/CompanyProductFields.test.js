import React, {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import CompanyProductFields, {CompanyProductBadge} from './CompanyProductFields';
global.IS_REACT_ACT_ENVIRONMENT=true;
let node,root;
beforeEach(()=>{node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(()=>{act(()=>root.unmount());node.remove();});
function Editor({initial,onSave}){
  const [selection,setSelection]=useState(initial);
  return <><CompanyProductFields {...selection} onChange={setSelection}/><button onClick={()=>onSave(selection)}>Guardar</button></>;
}
function change(select,value){act(()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});}
test('selects standalone Planner, then a TransGest edition, with one explicit save',()=>{
  const save=jest.fn();
  act(()=>root.render(<Editor initial={{plan:'enterprise',modalidad:'transgest'}} onSave={save}/>));
  expect([...node.querySelectorAll('option')].map(x=>x.textContent)).not.toContain('Pro Planner');
  change(node.querySelector('select'),'planner');
  expect(node.querySelectorAll('select')).toHaveLength(1);
  expect(save).not.toHaveBeenCalled();
  act(()=>node.querySelector('button').click());
  expect(save).toHaveBeenLastCalledWith({plan:'planner',modalidad:'planner'});
  change(node.querySelector('select'),'transgest');
  change(node.querySelectorAll('select')[1],'lite');
  act(()=>node.querySelector('button').click());
  expect(save).toHaveBeenLastCalledWith({plan:'lite',modalidad:'transgest'});
});
test('preserves existing combined license and keeps Planner separate from the edition',()=>{
  const save=jest.fn();
  act(()=>root.render(<Editor initial={{plan:'pro_planner',modalidad:'combinado'}} onSave={save}/>));
  expect(node.querySelectorAll('select')[1].value).toBe('profesional');
  expect(node.querySelector('[type=checkbox]').checked).toBe(true);
  act(()=>node.querySelector('button').click());
  expect(save).toHaveBeenLastCalledWith({plan:'pro_planner',modalidad:'combinado'});
  change(node.querySelectorAll('select')[1],'enterprise');
  act(()=>node.querySelector('button').click());
  expect(save).toHaveBeenLastCalledWith({plan:'enterprise',modalidad:'combinado'});
  act(()=>node.querySelector('[type=checkbox]').click());
  act(()=>node.querySelector('button').click());
  expect(save).toHaveBeenLastCalledWith({plan:'enterprise',modalidad:'transgest'});
});
test('company list shows actual products independently of billing plan',()=>{
  act(()=>root.render(<CompanyProductBadge company={{plan:'enterprise',modalidad:'combinado'}}/>));
  expect(node.textContent).toContain('TransGest Pro Intelligence');
  expect(node.textContent).toContain('Planner');
  act(()=>root.render(<CompanyProductBadge company={{plan:'planner'}}/>));
  expect(node.textContent).toBe('Planner');
});
