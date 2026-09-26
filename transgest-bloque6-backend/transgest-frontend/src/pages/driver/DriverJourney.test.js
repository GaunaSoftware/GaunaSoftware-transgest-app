import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import DriverJourney from './DriverJourney';
import {getPedidoChoferPasos} from '../../services/api';
jest.mock('../../services/api',()=>({getPedidoChoferPasos:jest.fn()}));
jest.mock('./DriverTrip',()=>({TarjetaViaje:({pedido,journeyStopId})=><div data-testid="active-stop">{pedido.numero}:{journeyStopId}</div>}));
const orders=[{id:'a',numero:'PED-A'},{id:'b',numero:'PED-B'}];
test('one journey opens the next order in the saved stop sequence and keeps an accessible full itinerary',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 getPedidoChoferPasos.mockResolvedValue({viaje_operativo:{paradas:[{id:'1',orden:1,tipo:'carga',label:'Alicante',completa:true},{id:'2',orden:2,tipo:'carga',label:'Murcia'}],proxima_parada:{id:'2',orden:2,pedido_id:'b',parada_legacy_id:'b-load',tipo:'carga',label:'Murcia'}}});
 try{
  await act(async()=>root.render(<DriverJourney pedidos={orders}/>));
  expect(host.textContent).toContain('Próxima parada · 2/2');expect(host.querySelector('[aria-current="step"]').textContent).toContain('Murcia');
  await act(async()=>host.querySelector('button').click());expect(host.querySelector('[data-testid="active-stop"]').textContent).toBe('PED-B:b-load');
  getPedidoChoferPasos.mockRejectedValue(new Error('Acceso denegado'));
  await act(async()=>root.render(<DriverJourney pedidos={[...orders]}/>));
  expect(host.querySelector('[role="alert"]').textContent).toContain('Acceso denegado');expect(host.querySelector('[data-testid="active-stop"]')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();}
});
