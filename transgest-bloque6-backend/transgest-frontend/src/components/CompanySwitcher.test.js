import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import CompanySwitcher from './CompanySwitcher';
import {useAuth} from '../context/AuthContext';
import {getCompanyMemberships,switchActiveCompany} from '../services/api';
import {confirmDialog} from '../services/notify';
jest.mock('../context/AuthContext',()=>({useAuth:jest.fn()}));
jest.mock('../services/api',()=>({getCompanyMemberships:jest.fn(),switchActiveCompany:jest.fn()}));
jest.mock('../services/notify',()=>({confirmDialog:jest.fn()}));
test('company selector requires confirmation, reports revoked access and ignores stale scopes',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 useAuth.mockReturnValue({user:{id:'u',empresa_id:'a'}});getCompanyMemberships.mockResolvedValue({companies:[{empresa_id:'a',nombre:'Alfa',rol:'gerente'},{empresa_id:'b',nombre:'Beta',rol:'contable'}]});
 try{
 await act(async()=>root.render(<CompanySwitcher/>));const select=node.querySelector('select');expect(select.value).toBe('a');
 confirmDialog.mockResolvedValue(false);await act(async()=>{select.value='b';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(switchActiveCompany).not.toHaveBeenCalled();
 confirmDialog.mockResolvedValue(true);switchActiveCompany.mockRejectedValue(Error('Membresía revocada'));await act(async()=>{select.value='b';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(node.querySelector('[role="alert"]').textContent).toBe('Membresía revocada');expect(switchActiveCompany).toHaveBeenCalledWith('b');
 }finally{await act(async()=>root.unmount());node.remove();}
});
