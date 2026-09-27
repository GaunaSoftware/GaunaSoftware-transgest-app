import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import ImportacionWizard from './ImportacionWizard';
import * as api from '../services/api';
jest.mock('../services/api',()=>({getImportCatalog:jest.fn(),getImportBatches:jest.fn(),getImportBatch:jest.fn(),getImportRows:jest.fn(),getImportReport:jest.fn(),getImportHistoricalOverview:jest.fn()}));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const fixture=(id)=>({id,tipo:'Clientes',filename:`Lote ${id}`,status:'review',total_rows:1,created_at:'2026-09-26T12:00:00Z'});
test('switching batch rejects late responses and rows from the previous batch',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 const first=deferred(),oldRows=deferred();
 api.getImportCatalog.mockResolvedValue({templates:[]});api.getImportBatches.mockResolvedValue({batches:[fixture('A'),fixture('B')]});
 api.getImportRows.mockImplementation(id=>id==='A'?oldRows.promise:Promise.resolve({rows:[{id:'b1',entity_type:'Clientes',row_number:2,source_id:'ONLY-B',status:'valid'}]}));
 api.getImportBatch.mockImplementation(id=>id==='A'?first.promise:Promise.resolve(fixture('B')));
 const click=async text=>act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent.includes(text)).click());
 try{
  await act(async()=>root.render(<ImportacionWizard/>));
  await click('Lote A');expect(node.textContent).toContain('Cargando lote');
  await click('Tipos de importación');await click('Lote B');
  await act(async()=>first.resolve(fixture('A')));
  expect(node.querySelector('h2').textContent).toBe('Lote B');expect(node.textContent).toContain('ONLY-B');
  api.getImportBatch.mockResolvedValue(fixture('A'));
  await click('Tipos de importación');await click('Lote A');
  api.getImportBatch.mockResolvedValue(fixture('B'));
  await click('Tipos de importación');await click('Lote B');
  await act(async()=>oldRows.resolve({rows:[{id:'a1',entity_type:'Clientes',row_number:2,source_id:'STALE-A',status:'valid'}]}));
  expect(node.textContent).toContain('ONLY-B');expect(node.textContent).not.toContain('STALE-A');
 }finally{await act(async()=>root.unmount());node.remove();}
});
