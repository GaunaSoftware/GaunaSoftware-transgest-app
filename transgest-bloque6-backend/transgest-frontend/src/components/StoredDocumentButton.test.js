import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import StoredDocumentButton from './StoredDocumentButton';
import {downloadStoredDocument} from '../services/api';
import {notify} from '../services/notify';
jest.mock('../services/api',()=>({downloadStoredDocument:jest.fn()}));
jest.mock('../services/notify',()=>({notify:jest.fn()}));
let host,root,clicked;
beforeEach(()=>{
  jest.useFakeTimers();global.IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  URL.createObjectURL=jest.fn(()=> 'blob:test-document');URL.revokeObjectURL=jest.fn();
  clicked=[];jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){clicked.push({href:this.href,download:this.download});});
});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.runOnlyPendingTimers();jest.useRealTimers();jest.restoreAllMocks();jest.clearAllMocks();});
test('private imported PDF downloads through authenticated API and releases its temporary URL',async()=>{
  downloadStoredDocument.mockResolvedValue(new Blob(['%PDF-'],{type:'application/pdf'}));
  await act(async()=>root.render(<StoredDocumentButton scope="vehiculo" doc={{id:'doc-1',storage_key:'db:private',file_name:'VEH_ITV.pdf'}}/>));
  expect(host.textContent).toBe('Descargar');
  await act(async()=>host.querySelector('button').click());
  expect(downloadStoredDocument).toHaveBeenCalledWith('vehiculo','doc-1');
  expect(clicked).toEqual([{href:'blob:test-document',download:'VEH_ITV.pdf'}]);
  expect(document.querySelector('a')).toBeNull();
  act(()=>jest.runOnlyPendingTimers());expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-document');
});
test('authorization/network failure is visible and does not generate a download',async()=>{
  downloadStoredDocument.mockRejectedValue(new Error('Acceso denegado'));
  await act(async()=>root.render(<StoredDocumentButton scope="vehiculo" doc={{id:'doc-2',storage_key:'db:private'}}/>));
  await act(async()=>host.querySelector('button').click());
  expect(notify).toHaveBeenCalledWith('Acceso denegado','error');expect(clicked).toEqual([]);expect(host.querySelector('button').disabled).toBe(false);
});
test('legacy links remain usable and metadata without a file has no empty action',async()=>{
  await act(async()=>root.render(<StoredDocumentButton scope="vehiculo" doc={{file_url:'https://example.com/legacy.pdf'}}/>));
  expect(host.querySelector('a').href).toBe('https://example.com/legacy.pdf');expect(host.querySelector('a').rel).toBe('noreferrer');
  await act(async()=>root.render(<StoredDocumentButton scope="vehiculo" doc={{id:'metadata'}}/>));
  expect(host.children.length).toBe(0);expect(downloadStoredDocument).not.toHaveBeenCalled();
});
