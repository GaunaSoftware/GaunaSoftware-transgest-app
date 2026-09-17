import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import QuickAssignModal from './QuickAssignModal';
jest.mock('../services/api',()=>({getDisponibilidadRecursos:()=>Promise.resolve({vehiculos:[],choferes:[]})}));

test('supplier assignment is only submitted after the form and includes plates, driver and explicit prices',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container),save=jest.fn().mockResolvedValue();
 try{
  await act(async()=>root.render(<QuickAssignModal pedido={{id:'order',colaborador_id:'provider',importe:500,precio_colaborador:350}} colaboradores={[{id:'provider',nombre:'Transportista'}]} onAssign={save} onClose={()=>{}}/>));
  expect(save).not.toHaveBeenCalled();
  const field=label=>[...container.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)).querySelector('input');
  const change=async(label,value)=>act(async()=>{const input=field(label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
  await change('Matrícula de la tractora','1234-ABC');await change('Matrícula del remolque','R-2222-BCD');await change('Nombre del conductor','Ana');await change('Apellidos del conductor','García');
  await change('Precio de venta total','600');await change('Coste total del proveedor','400');
  expect(container.textContent).toContain('200,00');
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Asignar').click());
  expect(save).toHaveBeenCalledTimes(1);expect(save.mock.calls[0][0]).toMatchObject({colaborador_id:'provider',matricula_colaborador:'1234-ABC',remolque_matricula_colaborador:'R-2222-BCD',conductor_efectivo_nombre:'Ana',conductor_efectivo_apellidos:'García',precio_venta_total:600,precio_colaborador:400});
 }finally{await act(async()=>root.unmount());container.remove();}
});
