import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import BiGroupPanel from './BiGroupPanel';
import {getBiGroups,getGroupBi} from '../../services/api';
jest.mock('../../services/api',()=>({getBiGroups:jest.fn(),getGroupBi:jest.fn()}));
test('group BI is on demand, uses exact period and shows permission errors',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 getBiGroups.mockResolvedValue({groups:[{id:'g',nombre:'Grupo sintético'}]});getGroupBi.mockRejectedValue(Error('Acceso revocado a una sociedad'));
 try{
 await act(async()=>root.render(<BiGroupPanel periodo={{desde:'2026-09-01',hasta:'2026-09-20'}}/>));expect(getGroupBi).not.toHaveBeenCalled();
 await act(async()=>node.querySelector('button').click());await act(async()=>{node.querySelector('select').value='g';node.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Consultar grupo').click());
 expect(getGroupBi).toHaveBeenCalledWith({grupo_id:'g',desde:'2026-09-01',hasta:'2026-09-20'});expect(node.querySelector('[role="alert"]').textContent).toBe('Acceso revocado a una sociedad');
 }finally{await act(async()=>root.unmount());node.remove();}
});
