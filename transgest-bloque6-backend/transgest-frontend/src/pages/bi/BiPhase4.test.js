import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import BiPhase4 from './BiPhase4';
jest.mock('recharts',()=>({Bar:()=>null,CartesianGrid:()=>null,ComposedChart:({children})=><div>{children}</div>,ResponsiveContainer:({children})=><div>{children}</div>,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null}));
test('recovery shows backend totals, missing cash and opens the contributing order',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const open=jest.fn(),page=jest.fn();
 const info={periodo:{desde:'2026-09-01',hasta:'2026-09-27'},poblacion:{pedidos:2,realizados:2},metricas:{},tiempos:{},detalle:{paradas:{rows:[]}},pendientes:{},paralizaciones:{definicion:'Importes netos al corte',fecha_corte:'2026-09-27',cobertura:{evaluables:1,total:2},documentado:200,aceptado:150,facturado:150,porcentaje:75,cobrado:null,detalle:{rows:[{id:'order',numero:'QA',documentado:200,aceptado:150,facturado:150}],total:1,page:1,limit:20}}};
 await act(async()=>root.render(<BiPhase4 kind="operaciones" data={{operations:info}} onOpen={open} onPage={page}/>));
 expect(host.textContent).toContain('75,00 %');
 expect(host.textContent).toContain('Cobro acreditado');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Abrir pedido').click());expect(open).toHaveBeenCalledWith(expect.objectContaining({id:'order'}));
 await act(async()=>root.unmount());host.remove();
});
