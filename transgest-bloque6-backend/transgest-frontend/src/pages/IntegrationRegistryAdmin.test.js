import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import IntegrationRegistryAdmin from './IntegrationRegistryAdmin';
test('registry exposes evidence and reports rejected promotion without pretending success',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 const api=jest.fn().mockResolvedValue({states:['planned','production_ready'],criteria:['healthcheck','tests'],rows:[{provider:'here',label:'HERE',state:'planned',effective_state:'planned',health:'not_tested',revision:0,environment:'sandbox',api_version:'unspecified',evidence:[],missing:['healthcheck']}]});
 try{
 await act(async()=>root.render(<IntegrationRegistryAdmin saFetchFn={api}/>));expect(node.textContent).toContain('Sin prueba');
 await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Revisar HERE').click());expect(node.textContent).toContain('Prueba real de conexión');
 api.mockRejectedValueOnce(Error('Faltan evidencias vigentes'));
 await act(async()=>node.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(node.querySelector('[role="alert"]').textContent).toBe('Faltan evidencias vigentes');expect(node.textContent).toContain('revisión 0');
 }finally{await act(async()=>root.unmount());node.remove();}
});
