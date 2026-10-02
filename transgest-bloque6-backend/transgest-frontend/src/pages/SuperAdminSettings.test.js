import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {IntegracionesAdmin,ModalEditarEmpresa} from './SuperAdmin';
jest.mock('../services/notify',()=>({notify:jest.fn(),confirmDialog:jest.fn(),promptDialog:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let node,root;
beforeEach(()=>{node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(()=>{act(()=>root.unmount());node.remove();jest.restoreAllMocks();});
const companies=[{id:'a',nombre:'Empresa A',plan:'enterprise'},{id:'b',nombre:'Empresa B',plan:'profesional'}];
function fixture(path){
  if(path==='/integraciones')return {empresas:companies,providers:['here','ors','openai','anthropic','ai_generic','locatel'],configs:[],fiscal_configs:[],gps_providers:['locatel'],global:{}};
  if(path==='/integraciones/contabilidad')return {integrations:[],company_settings:[]};
  if(path.startsWith('/integraciones/registry'))return {rows:[],states:[],criteria:[]};
  if(path.endsWith('/claveicon'))return {config:{codemp:'PRUEB'},credential_configured:false};
  return {};
}
async function tab(name){await act(async()=>[...node.querySelectorAll('[role=tab]')].find(x=>x.textContent===name).click());}
function change(select,value){act(()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});}
test('keeps a single company across areas, limits providers to their family, and does not save while navigating',async()=>{
  const request=jest.fn(async path=>fixture(path));
  await act(async()=>root.render(<IntegracionesAdmin saFetchFn={request}/>));
  await tab('Rutas y mapas');
  expect(node.querySelectorAll('[aria-label="Empresa a configurar"]')).toHaveLength(1);
  let provider=node.querySelector('.sa-provider-only select');
  expect([...provider.options].map(x=>x.value)).toEqual(['here','ors']);
  change(provider,'ors');
  await act(async()=>change(node.querySelector('[aria-label="Empresa a configurar"]'),'b'));
  await tab('Inteligencia artificial');
  provider=node.querySelector('.sa-provider-only select');
  expect([...provider.options].map(x=>x.value)).toEqual(['openai','anthropic','ai_generic']);
  expect(node.querySelector('[aria-label="Empresa a configurar"]').value).toBe('b');
  await tab('Contabilidad');
  expect(node.querySelector('.sa-claveicon-setup').textContent).toContain('Código ClaveiCon');
  expect(request).toHaveBeenCalledWith('/integraciones/fiscal/b/claveicon');
  await tab('Fiscal');
  expect(node.querySelector('[aria-label="Empresa a configurar"]').value).toBe('b');
  expect(request).toHaveBeenCalledWith('/integraciones/fiscal/b/queue-summary');
  expect(node.querySelector('.sa-fiscal-only').textContent).not.toContain('ClaveiCon');
  await tab('Rutas y mapas');
  expect(node.querySelector('.sa-provider-only select').value).toBe('ors');
  expect(request.mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
});
test('clears a typed company credential when changing company',async()=>{
  const request=jest.fn(async path=>fixture(path));
  await act(async()=>root.render(<IntegracionesAdmin saFetchFn={request}/>));
  await tab('Rutas y mapas');
  const input=node.querySelector('[aria-label="Clave API de empresa"]');
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'dummy-company-a');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(input.value).toBe('dummy-company-a');
  await act(async()=>change(node.querySelector('[aria-label="Empresa a configurar"]'),'b'));
  expect(node.querySelector('[aria-label="Clave API de empresa"]').value).toBe('');
});
test('edit company submits product and edition together and preserves existing plan until changed',async()=>{
  const fetchMock=jest.spyOn(global,'fetch').mockImplementation(async(url,opts)=>({ok:true,status:200,json:async()=>opts?.method==='PATCH'?{ok:true}:{modalidad:'combinado'}}));
  const saved=jest.fn();
  await act(async()=>root.render(<ModalEditarEmpresa empresa={{id:'a',nombre:'A',plan:'pro_planner',estado:'activo',email_admin:'a@example.invalid'}} onClose={()=>{}} onGuardado={saved}/>));
  expect(fetchMock.mock.calls.every(([,opts])=>!opts?.method)).toBe(true);
  act(()=>node.querySelector('.sa-product-fields input[type=checkbox]').click());
  // The edition is changed explicitly; Planner remains an independent optional product.
  change(node.querySelectorAll('.sa-product-grid select')[1],'enterprise');
  await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Guardar').click());
  const writes=fetchMock.mock.calls.filter(([,opts])=>opts?.method==='PATCH');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body)).toMatchObject({plan:'enterprise',modalidad:'transgest'});
  expect(saved).toHaveBeenCalledTimes(1);
});
test('failed product read blocks saving instead of dropping an existing access',async()=>{
  jest.spyOn(global,'fetch').mockRejectedValue(new Error('Sin conexión'));
  await act(async()=>root.render(<ModalEditarEmpresa empresa={{id:'a',nombre:'A',plan:'pro_planner',estado:'activo'}} onClose={()=>{}} onGuardado={()=>{}}/>));
  expect([...node.querySelectorAll('button')].find(b=>b.textContent==='Guardar').disabled).toBe(true);
  expect(node.querySelector('[role=alert]').textContent).toContain('Sin conexión');
});
