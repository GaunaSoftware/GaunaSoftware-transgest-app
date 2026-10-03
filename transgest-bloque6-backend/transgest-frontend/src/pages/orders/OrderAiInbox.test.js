import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import OrderAiInbox,{InboxHeading} from './OrderAiInbox';
import {getOrderInbox,getOrderInboxEntry,interpretarPedidoIA,changeOrderInboxState,readOrderInboxOriginal,descargarArchivoProtegido,getPedido} from '../../services/api';
jest.mock('../../services/api',()=>({getOrderInbox:jest.fn(),getOrderInboxEntry:jest.fn(),interpretarPedidoIA:jest.fn(),changeOrderInboxState:jest.fn(),descargarArchivoProtegido:jest.fn(),readOrderInboxOriginal:jest.fn(),getPedido:jest.fn()}));
const draft={confidence:82,pedido:{cliente_id:'client-a',cliente_nombre:'Cliente esperado',origen:'Madrid',destino:'Valencia',fecha_carga:'2026-10-03',mercancia:'Palets',peso_kg:24000}};
const item={id:'entry-a',state:'revisar',version:2,filename:'Orden sintética',email_subject:'Carga sintética',email_from:'pedidos@example.invalid',created_at:'2026-10-03T10:00:00Z',result:draft,attachments:[{name:'correo.eml',mediaType:'message/rfc822',sizeKb:2}]};
let node,root;
beforeEach(()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;jest.clearAllMocks();node=document.createElement('div');document.body.append(node);root=createRoot(node);
 getOrderInbox.mockResolvedValue({items:[item],counts:[{state:'revisar',count:1}],inbound:{configured:true,address:'entrada@example.invalid'}});
 getOrderInboxEntry.mockImplementation(async id=>id===item.id?item:{id});
 interpretarPedidoIA.mockResolvedValue({inbox_id:item.id,...draft});
 changeOrderInboxState.mockResolvedValue({});descargarArchivoProtegido.mockResolvedValue();
 readOrderInboxOriginal.mockResolvedValue('From: pedidos@example.invalid\r\nTo: entrada@example.invalid\r\nSubject: Carga sintética\r\n\r\nHola, necesitamos cargar en Madrid.');
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
const button=text=>[...node.querySelectorAll('button')].find(b=>b.textContent===text);
test('selecting an email only displays saved data; draft and reanalysis use existing actions and order creation stays manual',async()=>{
 const prepared=jest.fn(),create=jest.fn();
 await act(async()=>root.render(<OrderAiInbox onPrepared={prepared} onCreate={create}/>));
 expect(node.textContent).toContain('Cliente esperado');expect(node.textContent).toContain('24.000 kg');expect(interpretarPedidoIA).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
 await act(async()=>button('Crear pedido').click());expect(create).toHaveBeenCalledWith(expect.objectContaining({inbox_id:item.id,pedido:draft.pedido}));
 await act(async()=>button('Recuperar borrador').click());expect(interpretarPedidoIA).toHaveBeenLastCalledWith({inbox_id:item.id});
 expect(prepared).toHaveBeenCalledWith(expect.objectContaining({inbox_id:item.id,pedido:draft.pedido}));expect(changeOrderInboxState).not.toHaveBeenCalled();
 await act(async()=>button('Volver a analizar').click());expect(interpretarPedidoIA).toHaveBeenLastCalledWith({inbox_id:item.id,reanalyze:true});
 await act(async()=>button('He revisado: marcar listo').click());expect(changeOrderInboxState).toHaveBeenLastCalledWith(item.id,{state:'listo',version:2,reviewed:true});
});
test('original and attachments remain private and separate from the AI review',async()=>{
 await act(async()=>root.render(<OrderAiInbox/>));
 await act(async()=>button('Contenido original').click());
 expect(node.textContent).toContain('Hola, necesitamos cargar en Madrid.');expect(node.textContent).not.toContain('Información detectada por la IA');
 expect(readOrderInboxOriginal).toHaveBeenCalledWith(item.id,0);
 await act(async()=>button('Archivos adjuntos (1)').click());await act(async()=>button('Descargar').click());
 expect(descargarArchivoProtegido).toHaveBeenCalledWith('/pedidos/ai-inbox/entries/entry-a/attachments/0','correo.eml');
});
test.each(['nuevo','error','listo','creado','descartado'])('actions are valid for %s and never pretend there is a missing draft',async state=>{
 const entry={...item,state,result:['listo','creado','descartado'].includes(state)?draft:null,pedido_id:state==='creado'?'order-a':null};
 getOrderInbox.mockResolvedValue({items:[entry],counts:[{state,count:1}]});getOrderInboxEntry.mockResolvedValue(entry);getPedido.mockResolvedValue({id:'order-a'});
 const create=jest.fn(),open=jest.fn();await act(async()=>root.render(<OrderAiInbox onCreate={create} onOpenOrder={open}/>));
 expect(button('He revisado: marcar listo')).toBeUndefined();expect(button('Volver a analizar')).toBeUndefined();
 if(['nuevo','error'].includes(state)){expect(button('Recuperar borrador')).toBeUndefined();expect(button('Crear pedido')).toBeUndefined();await act(async()=>button('Analizar entrada').click());expect(interpretarPedidoIA).toHaveBeenCalledWith({inbox_id:item.id});}
 if(state==='listo'){expect(button('Crear pedido')).toBeTruthy();expect(button('Recuperar borrador')).toBeTruthy();}
 if(state==='creado'){expect(button('Crear pedido')).toBeUndefined();await act(async()=>button('Ver pedido creado').click());expect(open).toHaveBeenCalledWith({id:'order-a'});}
 if(state==='descartado'){expect(button('Descartar')).toBeUndefined();expect(button('Crear pedido')).toBeUndefined();await act(async()=>button('Restaurar para revisar').click());expect(changeOrderInboxState).toHaveBeenCalledWith(item.id,{state:'revisar',version:2,reviewed:false});}
});
test('search matches the detected customer, API failures are visible, and old responses cannot replace a newer list',async()=>{
 await act(async()=>root.render(<OrderAiInbox/>));const search=node.querySelector('input[type=search]');
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'Cliente esperado');search.dispatchEvent(new Event('input',{bubbles:true}));});expect(node.querySelectorAll('.ai-inbox-item')).toHaveLength(1);
 getOrderInbox.mockRejectedValueOnce(Error('Permiso revocado'));await act(async()=>button('Actualizar bandeja').click());expect(node.querySelector('[role=alert]').textContent).toBe('Permiso revocado');
 let resolveOld;getOrderInbox.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));await act(async()=>root.render(<OrderAiInbox revision="b"/>));
 getOrderInbox.mockResolvedValueOnce({items:[],counts:[]});await act(async()=>root.render(<OrderAiInbox revision="c"/>));await act(async()=>resolveOld({items:[item],counts:[]}));expect(node.querySelectorAll('.ai-inbox-item')).toHaveLength(0);
});
test('connection badge and manual analysis/history use actual state and separate panels',async()=>{
 const tabChange=jest.fn();
 await act(async()=>root.render(<><InboxHeading inbound={{configured:false}}/><OrderAiInbox activeTab="documents" onTabChange={tabChange} documentAnalyzer={<p>Análisis manual</p>} history={<p>Historial real</p>}/></>));
 expect(node.textContent).toContain('IMAP sin conectar');expect(node.textContent).toContain('Análisis manual');expect(node.querySelector('.ai-inbox-split')).toBeNull();
 await act(async()=>root.render(<><InboxHeading inbound={{configured:true,address:'entrada@example.invalid'}}/><OrderAiInbox activeTab="history" onTabChange={tabChange} history={<p>Historial real</p>}/></>));
 expect(node.textContent).toContain('IMAP conectado');expect(node.textContent).toContain('entrada@example.invalid');expect(node.textContent).toContain('Historial real');
});
test('a newly analysed document opens its own result after resetting an active state filter',async()=>{
 const discarded={...item,id:'discarded-a',state:'descartado',email_subject:'Correo anterior'};
 const fresh={...item,id:'manual-a',email_subject:'Documento nuevo',result:{...draft,pedido:{...draft.pedido,cliente_nombre:'Cliente nuevo'}}};
 getOrderInboxEntry.mockImplementation(async id=>[discarded,fresh].find(entry=>entry.id===id));
 getOrderInbox.mockImplementation(async ({state})=>({items:state==='descartado'?[discarded]:[discarded],counts:[{state:'descartado',count:1}]}));
 const prepared=jest.fn();await act(async()=>root.render(<OrderAiInbox onPrepared={prepared} revision={0}/>));
 const state=node.querySelector('select');await act(async()=>{state.value='descartado';state.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(node.querySelector('h3').textContent).toContain('Correo anterior');
 getOrderInbox.mockImplementation(async ({state})=>({items:state==='descartado'?[discarded]:[fresh,discarded],counts:[{state:'revisar',count:1},{state:'descartado',count:1}]}));
 await act(async()=>root.render(<OrderAiInbox onPrepared={prepared} revision={1} preview={{inbox_id:fresh.id,...fresh.result}}/>));
 expect(node.querySelector('select').value).toBe('');expect(node.querySelector('h3').textContent).toContain('Documento nuevo');
 expect(node.textContent).toContain('Cliente nuevo');expect(prepared).not.toHaveBeenCalled();
});
