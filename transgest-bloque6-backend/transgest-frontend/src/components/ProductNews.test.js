import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import ProductNews from './ProductNews';
import {getUserRelease,dismissUserRelease} from '../services/api';
let mockUser={id:'u1',empresa_id:'a'};
jest.mock('../context/AuthContext',()=>({useAuth:()=>({user:mockUser,loading:false})}));
jest.mock('../services/api',()=>({getUserRelease:jest.fn(),dismissUserRelease:jest.fn()}));
const news={id:'release-1',title:'Novedades',intro:'Para ti',items:[{title:'Agenda',text:'Tus tareas'}],dismissed:false};
let node,root;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;mockUser={id:'u1',empresa_id:'a'};getUserRelease.mockResolvedValue(news);dismissUserRelease.mockResolvedValue({dismissed:true});node=document.createElement('div');document.body.appendChild(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();jest.clearAllMocks();});
const click=async text=>act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent.includes(text)).click());
test('only an acknowledged server write hides this release across new sessions',async()=>{
  await act(async()=>root.render(<ProductNews/>));expect(node.querySelector('[role=dialog]')).not.toBeNull();
  await click('No mostrar más');expect(dismissUserRelease).toHaveBeenCalledWith('release-1');expect(node.querySelector('[role=dialog]')).toBeNull();
  getUserRelease.mockResolvedValue({...news,dismissed:true});await act(async()=>root.render(<ProductNews key="another-device"/>));expect(node.querySelector('[role=dialog]')).toBeNull();
});
test('Ahora no does not persist a dismissal and failed saves remain actionable',async()=>{
  await act(async()=>root.render(<ProductNews/>));await click('Ahora no');expect(dismissUserRelease).not.toHaveBeenCalled();
  await act(async()=>root.render(<ProductNews key="next-login"/>));dismissUserRelease.mockRejectedValueOnce(Error('offline'));await click('No mostrar más');expect(node.querySelector('[role=alert]')).not.toBeNull();expect(node.querySelector('[role=dialog]')).not.toBeNull();
});
test('a stale acknowledgement cannot close the next account’s release',async()=>{
  let finish;dismissUserRelease.mockReturnValueOnce(new Promise(r=>{finish=r;}));
  await act(async()=>root.render(<ProductNews/>));await click('No mostrar más');
  mockUser={id:'u2',empresa_id:'b'};await act(async()=>root.render(<ProductNews/>));await act(async()=>finish({dismissed:true}));expect(node.querySelector('[role=dialog]')).not.toBeNull();
});
