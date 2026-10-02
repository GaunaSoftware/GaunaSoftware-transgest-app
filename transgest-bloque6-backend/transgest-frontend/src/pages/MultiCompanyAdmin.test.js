import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import MultiCompanyAdmin from './MultiCompanyAdmin';
test('membership edit preserves company and revision, handles legacy null permissions and conflicts',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 const api=jest.fn(path=>Promise.resolve(path.includes('/referencias')?{}:{groups:[],companies:[{id:'b',nombre:'Sociedad B'}],users:[{id:'u',nombre:'Usuario'}],members:[{usuario_id:'u',empresa_id:'b',rol:'contable',permisos:null,revision:8,activo:true,bi_consolidado:false}],roles:['contable','cliente']}));
 try{
 await act(async()=>root.render(<MultiCompanyAdmin saFetchFn={api}/>));
 const selects=node.querySelectorAll('select');
 await act(async()=>{selects[1].value='u';selects[1].dispatchEvent(new Event('change',{bubbles:true}));selects[2].value='b';selects[2].dispatchEvent(new Event('change',{bubbles:true}));});
 expect(node.textContent).toContain('Permisos en la empresa seleccionada');
 const permission=[...node.querySelectorAll('label')].find(l=>l.textContent.startsWith('Nóminas')).querySelector('select');
 await act(async()=>{permission.value='none';permission.dispatchEvent(new Event('change',{bubbles:true}));});
 api.mockRejectedValueOnce(Error('Membresía modificada. Recarga los datos.'));
 await act(async()=>node.querySelectorAll('form')[1].dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api).toHaveBeenLastCalledWith('/multiempresas/membresias',expect.objectContaining({method:'PUT',body:expect.objectContaining({empresa_id:'b',usuario_id:'u',revision:8,permisos:{modulos:{nominas:{ver:false,editar:false}}}})}));
 expect(node.querySelector('[role="alert"]').textContent).toContain('Membresía modificada');
 }finally{await act(async()=>root.unmount());node.remove();}
});
