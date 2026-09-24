import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import QuickAssignModal from './QuickAssignModal';
jest.mock('../services/api',()=>({getDisponibilidadRecursos:()=>Promise.resolve({vehiculos:[],choferes:[]})}));

test('supplier assignment preserves the configured sale price and accepts supplier cost and resources',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container),save=jest.fn().mockResolvedValue();
 try{
  await act(async()=>root.render(<QuickAssignModal pedido={{id:'order',colaborador_id:'provider',importe:500,precio_colaborador:350}} colaboradores={[{id:'provider',nombre:'Transportista'}]} onAssign={save} onClose={()=>{}}/>));
  expect(save).not.toHaveBeenCalled();
  const field=label=>[...container.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)).querySelector('input');
  const change=async(label,value)=>act(async()=>{const input=field(label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
  await change('Matrícula de la tractora','1234-ABC');await change('Matrícula del remolque','R-2222-BCD');await change('Nombre del conductor','Ana');await change('Apellidos del conductor','García');
  expect(container.textContent).toContain('500,00');
  expect([...container.querySelectorAll('input')].some(input=>input.value==='500')).toBe(false);
  await change('Coste total del proveedor','400');
  expect(container.textContent).toContain('100,00');
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Asignar').click());
  expect(save).toHaveBeenCalledTimes(1);expect(save.mock.calls[0][0]).toMatchObject({colaborador_id:'provider',matricula_colaborador:'1234-ABC',remolque_matricula_colaborador:'R-2222-BCD',conductor_efectivo_nombre:'Ana',conductor_efectivo_apellidos:'García',precio_colaborador:400});
  expect(save.mock.calls[0][0]).not.toHaveProperty('precio_venta_total');
 }finally{await act(async()=>root.unmount());container.remove();}
});

test.each([1,3])('own fleet keeps prices out of the form and patch, including after switching supplier mode (%i orders)',async(bulkCount)=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container),save=jest.fn().mockResolvedValue();
 try{
  await act(async()=>root.render(<QuickAssignModal pedido={{id:'order',vehiculo_id:'truck',vehiculo_matricula:'1234-ABC',chofer_id:'driver',importe:500}} vehiculos={[{id:'truck',matricula:'1234-ABC',clase:'tractora',chofer_id:'driver'}]} choferes={[{id:'driver',nombre:'Ana',vehiculo_id:'truck'}]} colaboradores={[{id:'provider',nombre:'Transportista'}]} bulkCount={bulkCount} onAssign={save} onClose={()=>{}}/>));
  expect(container.textContent).not.toContain('Importes del viaje');
  const click=async text=>act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent===text).click());
  await click('Proveedor externo');
  expect(container.textContent).toContain('Precio de venta del pedido');
  expect([...container.querySelectorAll('label')].some(l=>l.textContent.startsWith('Precio de venta total'))).toBe(false);
  await click('Flota propia');
  expect(container.textContent).not.toContain('Importes del viaje');
  await click(bulkCount>1?`Asignar a ${bulkCount}`:'Asignar');
  expect(save).toHaveBeenCalledTimes(1);
  const patch=save.mock.calls[0][0];
  expect(patch).toMatchObject({vehiculo_id:'truck',chofer_id:'driver',colaborador_id:''});
  for(const key of ['importe','precio_unitario','precio_venta_total','precio_colaborador','tipo_precio'])expect(patch).not.toHaveProperty(key);
 }finally{await act(async()=>root.unmount());container.remove();}
});
