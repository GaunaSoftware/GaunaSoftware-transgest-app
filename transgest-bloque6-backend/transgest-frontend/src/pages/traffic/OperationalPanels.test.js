import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import JourneyReplanning from './JourneyReplanning';
import RouteConstraintsPanel from './RouteConstraintsPanel';
import DetentionPanel from './DetentionPanel';
import * as api from '../../services/api';
jest.mock('../../services/api',()=>({journeyOperation:jest.fn(),optimizarRuta:jest.fn(),pedidoParalizaciones:jest.fn()}));
let root,host;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);jest.clearAllMocks();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const click=async text=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);expect(button).toBeTruthy();await act(async()=>button.click());};
const change=async(input,value)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
test('new order and read-only user cannot start a replan or claim',async()=>{
 await act(async()=>root.render(<><JourneyReplanning pedido={null} canEdit/><DetentionPanel pedido={null} canEdit/></>));
 expect(host.textContent).toBe('');
 await act(async()=>root.render(<><JourneyReplanning pedido={{id:'a'}} canEdit={false}/><DetentionPanel pedido={{id:'a'}} canEdit={false}/></>));
 expect(host.textContent).toBe('');expect(api.journeyOperation).not.toHaveBeenCalled();expect(api.pedidoParalizaciones).not.toHaveBeenCalled();
});
test('started stops cannot be moved and failed loads cannot be confirmed',async()=>{
 api.journeyOperation.mockResolvedValue({origen:'materializado',viajes:[{version:2,asignacion_snapshot:{},paradas:[{id:'a',estado:'finalizada',tipo:'carga',ubicacion:{ciudad:'A'}},{id:'b',estado:'pendiente',tipo:'descarga',ubicacion:{ciudad:'B'}}]}]});
 await act(async()=>root.render(<JourneyReplanning pedido={{id:'p',numero:'SINTÉTICO'}} canEdit/>));await click('Replanificación y relevos');
 expect(document.querySelector('[aria-label="Bajar parada 1"]').disabled).toBe(true);
 expect(document.querySelector('[aria-label="Subir parada 2"]').disabled).toBe(true);
 expect([...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar nueva versión').disabled).toBe(true);
 await click('Cancelar');api.journeyOperation.mockRejectedValueOnce(Error('API sin conexión'));await click('Replanificación y relevos');
 expect(document.querySelector('[role="alert"]').textContent).toContain('API sin conexión');
 expect([...document.querySelectorAll('button')].find(b=>b.textContent==='Incorporar eventos existentes').disabled).toBe(true);
});
test('routing conflict cannot be applied, partial proposal remains explicit',async()=>{
 const onApply=jest.fn();api.optimizarRuta.mockResolvedValue({provider_label:'Proveedor sintético',stops:[],constraint_review:{estado:'conflicto',incidencias:[{level:'conflicto',text:'Peso excedido'}],paradas:[]}});
 await act(async()=>root.render(<RouteConstraintsPanel stops={[]} onApply={onApply}/>));await click('Proponer con restricciones');
 await change(document.querySelector('input[type="date"]'),'2026-10-01');await change(document.querySelector('input[type="time"]'),'08:00');await click('Calcular propuesta');
 const apply=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Revisar y aplicar al borrador');
 expect(apply().disabled).toBe(true);expect(document.body.textContent).toContain('Peso excedido');expect(onApply).not.toHaveBeenCalled();
 api.optimizarRuta.mockResolvedValue({stops:[],constraint_review:{estado:'parcial',incidencias:[{text:'Falta duración de carretera'}],paradas:[]}});
 await click('Calcular propuesta');expect(document.body.textContent).toContain('Propuesta parcial');expect(apply().disabled).toBe(false);
 await click('Revisar y aplicar al borrador');expect(onApply).toHaveBeenCalledTimes(1);
});
test('unrecorded detention payment is shown as unknown, never zero or paid',async()=>{
 api.pedidoParalizaciones.mockResolvedValue({reclamaciones:[],documentos:[],facturas:[],resumen:{documentado:200,aceptado:150,facturado:0,cobrado:null}});
 await act(async()=>root.render(<DetentionPanel pedido={{id:'p',numero:'SINTÉTICO'}} canEdit/>));await click('Paralización / prefactura');
 expect(document.body.textContent).toContain('Cobro acreditadoNo calculable');
 expect(document.body.textContent).not.toContain('Valorar paralización · preparar prefactura');
 expect(document.body.textContent).toContain('emite una factura separada');
});

test('a recorded loading delay offers the linked prefactura with observed times',async()=>{
 api.pedidoParalizaciones.mockResolvedValue({demora_chofer:{carga:true,inicio:'2026-09-17T08:00:00Z',fin:'2026-09-17T10:00:00Z'},
  reclamaciones:[],documentos:[],facturas:[],resumen:{documentado:0,aceptado:0,facturado:0,cobrado:null}});
 await act(async()=>root.render(<DetentionPanel pedido={{id:'p',numero:'SINTÉTICO',_focus_detention:true}} canEdit/>));
 expect(document.querySelector('[aria-label="Prefactura rápida de paralización"]')).toBeTruthy();
 const times=[...document.querySelectorAll('input[type="datetime-local"]')].map(input=>input.value);
 expect(times).toHaveLength(2);
 expect((new Date(times[1])-new Date(times[0]))/60000).toBe(120);
});

test('an alert for the second loading point selects that stop in the quick prefactura',async()=>{
 const first={carga:true,parada_id:'carga-a',parada_label:'Primera carga',inicio:'2026-09-17T08:00:00Z',fin:'2026-09-17T09:05:00Z'};
 const second={carga:true,parada_id:'carga-b',parada_label:'Capa Abanilla',inicio:'2026-09-17T10:00:00Z',fin:'2026-09-17T12:00:00Z'};
 api.pedidoParalizaciones.mockResolvedValue({demora_chofer:first,demoras_chofer:[first,second],
  reclamaciones:[],documentos:[],facturas:[],resumen:{documentado:0,aceptado:0,facturado:0,cobrado:null}});
 await act(async()=>root.render(<DetentionPanel pedido={{id:'p',numero:'SINTÉTICO',_focus_detention:true,_focus_detention_stop:'carga-b'}} canEdit/>));
 expect(document.querySelector('[aria-label="Prefactura rápida de paralización"]').textContent).toContain('Capa Abanilla');
 const times=[...document.querySelectorAll('input[type="datetime-local"]')].map(input=>input.value);
 expect((new Date(times[1])-new Date(times[0]))/60000).toBe(120);
});
