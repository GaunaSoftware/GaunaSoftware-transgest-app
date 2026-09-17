import React from 'react';
import {createRoot} from 'react-dom/client';
import {act} from 'react';
import {AuthProvider,useAuth} from './AuthContext';
import * as api from '../services/api';
jest.mock('../services/api',()=>({getToken:jest.fn(),getUser:jest.fn(),setUser:jest.fn(),removeToken:jest.fn(),login:jest.fn(),getMe:jest.fn()}));
let root,host,auth,token;
function Probe(){auth=useAuth();return <span>{auth.user?.id||'anonymous'}</span>;}
beforeEach(()=>{jest.clearAllMocks();token=null;api.getToken.mockImplementation(()=>token);host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);window.history.replaceState(null,'','/');global.IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const mount=()=>act(async()=>{root.render(<AuthProvider><Probe/></AuthProvider>);});
test('logging in without Planner leaves its old URL and clears on logout',async()=>{
 await mount();window.history.replaceState(null,'','/planner');
 api.login.mockResolvedValue({user:{id:'asensi',productos:['transgest']}});
 await act(async()=>{await auth.login('test','test');});
 expect(window.location.pathname).toBe('/');expect(window.location.search).toBe('?workspace=tms');expect(auth.user.id).toBe('asensi');
 act(()=>auth.logout());expect(auth.user).toBeNull();expect(api.removeToken).toHaveBeenCalled();expect(window.location.search).toBe('');
});
test('browser restore revalidates the account and drops stale product memory',async()=>{
 await mount();token='new';window.__TMS_TOKEN='old';window.__TMS_USER={id:'old',productos:['planner']};window.__TMS_SUSCRIPCION={plan:'old'};
 api.getMe.mockResolvedValue({id:'new',productos:['transgest']});
 await act(async()=>{window.dispatchEvent(new StorageEvent('storage',{key:'tms_token',newValue:'new'}));});
 expect(window.__TMS_TOKEN).toBeUndefined();expect(window.__TMS_SUSCRIPCION).toBeUndefined();expect(auth.user.id).toBe('new');
});
test('an old refresh completing after logout cannot restore its user',async()=>{
 await mount();token='old';let resolve;api.getMe.mockReturnValue(new Promise(r=>{resolve=r;}));
 let pending;act(()=>{pending=auth.refreshUser();});token=null;act(()=>auth.logout());
 await act(async()=>{resolve({id:'old'});await pending;});expect(auth.user).toBeNull();expect(api.setUser).not.toHaveBeenCalled();
});
