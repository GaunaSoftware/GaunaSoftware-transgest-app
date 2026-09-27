import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import GastosEstructura from './GastosEstructura';
import * as api from '../services/api';
import {useAuth} from '../context/AuthContext';
import {confirmDialog} from '../services/notify';
jest.mock('../context/AuthContext',()=>({useAuth:jest.fn()}));
jest.mock('../services/notify',()=>({notify:jest.fn(),confirmDialog:jest.fn().mockResolvedValue(true)}));
jest.mock('recharts',()=>({ResponsiveContainer:()=>null,BarChart:()=>null,Bar:()=>null,XAxis:()=>null,YAxis:()=>null,CartesianGrid:()=>null,Tooltip:()=>null}));
jest.mock('../services/api',()=>Object.fromEntries(['getResumenGastosEstructura','crearGastoEstructura','editarGastoEstructura','borrarGastoEstructura','cambiarVigenciaGasto','getMesesCerrados','cerrarMes','abrirMes'].map(name=>[name,jest.fn()])));
let root,host;
const fixture=()=>({total:300,gastos:[{id:'one',nombre:'Gasto sintético',tipo:'Alquiler',importe:300,importe_periodo:300,periodo:'mensual',fecha:'2026-09'}],
  coste_medio_camion:150,reparto:[{v:{id:'v1',matricula:'0001-SYN'},peso_igual:.5,peso_ingresos:.8,coste_igual:150,coste_ingresos:240},{v:{id:'v2',matricula:'0002-SYN'},peso_igual:.5,peso_ingresos:.2,coste_igual:150,coste_ingresos:60}],
  comparativa:{periodos:[{periodo:'2026-09',total:300,registros:1},{periodo:'2026-08',total:200,registros:1},{periodo:'2025-09',total:null,registros:0}],
    categorias:[{tipo:'Alquiler',actual:300,anterior:200,ano_anterior:null}],variacion_anterior:{diferencia:100,porcentaje:50},variacion_anual:{diferencia:null,porcentaje:null},
    generado_at:'2026-09-27T12:00:00Z',version:'estructura.mensual.v1'}});
const click=label=>act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===label);expect(b).toBeTruthy();b.click();});
const change=(input,value)=>act(async()=>{
  const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));
});
test('recurring changes and ending call the versioned API instead of overwriting historical amounts',async()=>{
  const data=fixture();data.gastos[0].revision=3;api.getResumenGastosEstructura.mockResolvedValue(data);
  await act(async()=>root.render(<GastosEstructura/>));
  await change(host.querySelector('input[type="month"]'),'2026-10');
  await click('Cambiar desde un mes');
  let form=document.querySelector('#structure-expense-form');
  await change(form.querySelector('textarea'),'Nuevo alquiler');
  await change(form.querySelector('input[type="number"]'),'400');
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(api.cambiarVigenciaGasto).toHaveBeenCalledWith('one',expect.objectContaining({accion:'cambiar',revision:3,desde:'2026-10',motivo:'Nuevo alquiler',datos:expect.objectContaining({importe:400})}));
  expect(api.editarGastoEstructura).not.toHaveBeenCalled();
  await click('Finalizar recurrencia');form=document.querySelector('#structure-expense-form');
  await change(form.querySelector('textarea'),'Fin contrato');
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(api.cambiarVigenciaGasto).toHaveBeenLastCalledWith('one',expect.objectContaining({accion:'finalizar',hasta:'2026-10',motivo:'Fin contrato'}));
});
beforeEach(()=>{
  jest.clearAllMocks();global.IS_REACT_ACT_ENVIRONMENT=true;
  confirmDialog.mockResolvedValue(true);
  useAuth.mockReturnValue({user:{rol:'gerente'},puedeEditar:()=>true});
  api.getResumenGastosEstructura.mockReset().mockResolvedValue(fixture());api.getMesesCerrados.mockReset().mockResolvedValue([]);
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
test('management retains allocation and comparison displays server values with missing history',async()=>{
  await act(async()=>root.render(<GastosEstructura/>));
  expect(host.textContent).not.toContain('Imputación mensual estimada:');
  await change(host.querySelector('.structure-allocation-filter select'),'ingresos');
  expect(host.textContent).toContain('240,00');expect(host.textContent).toContain('60,00');
  await click('Comparativa');
  expect(host.textContent).toContain('50 %');expect(host.textContent).toContain('Sin datos comparables');
  expect(host.textContent).toContain('Gastos de estructura registrados (€)');
  expect(api.getResumenGastosEstructura).toHaveBeenCalledTimes(1);
});
test.each(['mensual','unico'])('new %s expense uses selected month and saves the old operational fields',async frequency=>{
  await act(async()=>root.render(<GastosEstructura/>));
  await change(host.querySelector('input[type="month"]'),'2026-02');
  await click('+ Añadir gasto');
  const form=document.querySelector('#structure-expense-form');
  expect(form.querySelector('input[type="month"]').value).toBe('2026-02');
  await change(form.querySelector('input:not([type])'),'Ensayo puntual');
  await change(form.querySelector('input[type="number"]'),'125.50');
  await change(form.querySelectorAll('select')[1],frequency);
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(api.crearGastoEstructura).toHaveBeenCalledWith(expect.objectContaining({nombre:'Ensayo puntual',importe:125.5,periodo:frequency,fecha:'2026-02'}));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
test('API errors are visible and do not enable writes or present zero activity',async()=>{
  api.getResumenGastosEstructura.mockRejectedValue(new Error('Sin conexión'));
  await act(async()=>root.render(<GastosEstructura/>));
  expect(host.querySelector('[role="alert"]').textContent).toContain('Sin conexión');
  expect(host.textContent).not.toContain('Sin gastos registrados');
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='+ Añadir gasto').disabled).toBe(true);
  api.getResumenGastosEstructura.mockResolvedValue(fixture());await click('Reintentar');
  expect(host.textContent).toContain('Gasto sintético');
});
test('a late response from the previous month cannot overwrite current totals',async()=>{
  let resolveOld;api.getResumenGastosEstructura.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue({...fixture(),total:700});
  await act(async()=>root.render(<GastosEstructura/>));
  await change(host.querySelector('input[type="month"]'),'2027-01');
  await act(async()=>resolveOld(fixture()));
  expect(host.querySelector('.structure-kpis').textContent).toContain('700,00');
  expect(host.querySelector('.structure-kpis').textContent).not.toContain('300,00');
});
test('closed month and read-only roles retain consultation without editing controls',async()=>{
  await act(async()=>root.render(<GastosEstructura/>));
  const month=host.querySelector('input[type="month"]').value;
  api.getMesesCerrados.mockResolvedValue([month]);
  await click('Cerrar mes');
  expect(api.cerrarMes).toHaveBeenCalledWith(month);
  expect(host.textContent).toContain('Mes cerrado');
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='+ Añadir gasto').disabled).toBe(true);
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Editar')).toBe(false);
  useAuth.mockReturnValue({user:{rol:'visualizador'},puedeEditar:()=>false});
  await act(async()=>root.render(<GastosEstructura/>));
  expect(host.textContent).not.toContain('Reabrir mes');expect(host.textContent).not.toContain('+ Añadir gasto');
});
