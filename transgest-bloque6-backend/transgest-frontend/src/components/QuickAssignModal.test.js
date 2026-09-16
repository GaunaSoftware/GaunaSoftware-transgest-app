import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import QuickAssignModal from './QuickAssignModal';
import { getDisponibilidadRecursos } from '../services/api';
jest.mock('../services/api', () => ({getDisponibilidadRecursos: jest.fn().mockResolvedValue({vehiculos:[],choferes:[]})}));
jest.mock('./ResourcePicker', () => props => <input aria-label={props.label} value={props.value} onChange={e => props.onChange(e.target.value)} />);

let container, root;
beforeEach(() => {global.IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(() => {act(() => root.unmount());container.remove();});
const order={id:'order',numero:'PED-1',colaborador_id:'supplier',matricula_colaborador:'1234 ABC',
  remolque_matricula_colaborador:'R-1234 ABC',tipo_precio:'viaje',precio_unitario:900,importe:900,precio_colaborador:600};
async function render(pedido=order, extra={}) {
  getDisponibilidadRecursos.mockResolvedValue({vehiculos:[],choferes:[]});
  const onAssign=jest.fn().mockResolvedValue(undefined);
  await act(async()=>root.render(<QuickAssignModal pedido={pedido} colaboradores={[{id:'supplier',nombre:'Transportista'}]} onClose={()=>{}} onAssign={onAssign} {...extra} />));
  return onAssign;
}
async function change(id,value) {
  await act(async()=>{const el=container.querySelector(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
}
async function click(text) {await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent===text).click());}

test('asigna colaborador, ambas matrículas y nuevo precio sin entrar en el pedido',async()=>{
  const save=await render();
  await change('#quick-sale-price','1000,50');
  await change('#quick-external-plate','5678 DEF');
  expect(container.textContent).toContain('400,50');
  await click('Asignar');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({colaborador_id:'supplier',matricula_colaborador:'5678-DEF',precio_unitario:1000.5,remolque_id:null,chofer2_id:''}));
  expect(save.mock.calls[0][0]).not.toHaveProperty('importe');
});

test('asignar sin editar precio conserva la tarifa y bloquea importes inválidos',async()=>{
  const save=await render();
  await click('Asignar');
  expect(save.mock.calls[0][0]).not.toHaveProperty('precio_unitario');
  save.mockClear();
  await change('#quick-sale-price','abc');
  await click('Asignar');
  expect(save).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

test('cambiar a flota propia quita colaborador y matrículas externas',async()=>{
  const save=await render();await click('Flota propia');
  await change('[aria-label="Tractora"]','1234-ABC');
  await click('Asignar');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({colaborador_id:'',matricula_colaborador:null,remolque_matricula_colaborador:null,matricula_manual:'1234-ABC'}));
});

test('asignación múltiple conserva los precios individuales',async()=>{
  const save=await render(order,{bulkCount:2});
  expect(container.querySelector('#quick-sale-price')).toBeNull();
  await click('Asignar a 2');
  expect(save.mock.calls[0][0]).not.toHaveProperty('precio_unitario');
});
