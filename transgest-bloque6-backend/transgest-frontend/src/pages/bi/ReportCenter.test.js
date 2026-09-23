import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import ReportCenter from './ReportCenter';
import {getBiReportCatalog,getBiReportViews,getBiWeeklySettings,saveBiWeeklySettings,saveBiReportView,updateBiReportView,runBiReport,getBiReportPage} from '../../services/api';

jest.mock('../../services/api',()=>({
  getBiReportCatalog:jest.fn(),getBiReportViews:jest.fn(),getBiWeeklySettings:jest.fn(),saveBiWeeklySettings:jest.fn(),saveBiReportView:jest.fn(),
  updateBiReportView:jest.fn(),deleteBiReportView:jest.fn(),runBiReport:jest.fn(),getBiReportPage:jest.fn(),
  exportBiReport:jest.fn(),downloadBiReport:jest.fn()
}));
global.IS_REACT_ACT_ENVIRONMENT=true;

const config={template:'direccion',periodo:'mes',desde:'',hasta:'',filtros:{cliente_id:'',ruta:'',vehiculo_id:'',ejecucion:''},
  metricas:['ingreso'],columnas:['pedido'],dimension:'cliente',agrupacion:'cliente',orden:{columna:'pedido',direccion:'asc'},visualizaciones:['barras']};
const shared={id:'view-1',nombre:'Informe compartido',descripcion:'Vista de la empresa',alcance:'compartida',
  owner_id:'manager-1',configuracion:config};
const catalog={templates:[{id:'direccion',name:'Dirección',metrics:['ingreso'],columns:['pedido'],dimensions:['cliente'],charts:['barras']},
  {id:'vehiculo',name:'Vehículos',metrics:['ingreso'],columns:['pedido'],dimensions:['cliente'],charts:['barras']}],
  periods:['mes','semana_anterior','anual'],metrics:{ingreso:'Ingreso'},columns:{pedido:{label:'Pedido',type:'text'}},opciones:{clientes:[]}};
let node,root;
beforeEach(()=>{
  jest.clearAllMocks();getBiReportCatalog.mockResolvedValue(catalog);getBiReportViews.mockResolvedValue([shared]);
  getBiWeeklySettings.mockResolvedValue({hora:'Lunes 09:00 Europe/Madrid',gerentes:[
    {id:'manager-1',nombre:'Gerente A',email:'gerente-a@example.test'},
    {id:'manager-2',nombre:'Gerente B',email:'gerente-b@example.test'}],destinatarios:[],ultimos_envios:[]});
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(()=>{act(()=>root.unmount());node.remove();});
const selectLabel=label=>[...node.querySelectorAll('label')].find(x=>x.textContent.startsWith(label)).querySelector('select');
const clickButton=label=>[...node.querySelectorAll('button')].find(x=>x.textContent===label).click();

test('a non-owner can copy a shared view only as personal',async()=>{
  saveBiReportView.mockResolvedValue({...shared,id:'copy-1',owner_id:'analyst-1',alcance:'personal'});
  await act(async()=>root.render(<ReportCenter initialState={{}} role="contable" ownerId="analyst-1"/>));
  await act(async()=>{const select=selectLabel('Vistas guardadas');select.value=shared.id;select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(selectLabel('Visibilidad').value).toBe('personal');
  expect([...selectLabel('Visibilidad').options].map(x=>x.value)).toEqual(['personal']);
  await act(async()=>clickButton('Guardar copia'));
  expect(saveBiReportView).toHaveBeenCalledWith(expect.objectContaining({alcance:'personal',configuracion:config}));
  expect(updateBiReportView).not.toHaveBeenCalled();
});

test('preview uses saved view until filters change, then executes the edited configuration',async()=>{
  runBiReport.mockResolvedValue({id:'run-1',expires_at:'2026-09-24T10:00:00Z',report:{title:'Informe',
    metadata:{periodo:{desde:'2026-09-01',hasta:'2026-09-30'},fecha_corte:'2026-09-30'},
    rows:[],metrics:[],columns:[],warnings:[]}});
  await act(async()=>root.render(<ReportCenter initialState={{}} role="gerente" ownerId="manager-1"/>));
  await act(async()=>{const select=selectLabel('Vistas guardadas');select.value=shared.id;select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>clickButton('Generar vista previa'));
  expect(runBiReport).toHaveBeenLastCalledWith({vista_id:'view-1'});
  await act(async()=>{const select=selectLabel('Periodo');select.value='anual';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>clickButton('Generar vista previa'));
  expect(runBiReport).toHaveBeenLastCalledWith({configuracion:expect.objectContaining({periodo:'anual'})});
});

test('paginates the private snapshot without changing the summary or fetching full history',async()=>{
  const report={title:'Informe',metadata:{periodo:{desde:'2026-09-01',hasta:'2026-09-30'},fecha_corte:'2026-09-30',total_rows:1501},
    rows:[{pedido:'PED-0001'}],metrics:[],columns:[{id:'pedido',label:'Pedido',type:'text'}],warnings:[]};
  runBiReport.mockResolvedValue({id:'run-1',expires_at:'2026-09-24T10:00:00Z',report});
  getBiReportPage.mockResolvedValue({...report,rows:[{pedido:'PED-0026'}],metadata:{...report.metadata,page:2}});
  await act(async()=>root.render(<ReportCenter initialState={{}} role="gerente" ownerId="manager-1"/>));
  await act(async()=>clickButton('Generar vista previa'));
  expect(node.textContent).toContain('1501 registros');
  await act(async()=>clickButton('Siguiente'));
  expect(getBiReportPage).toHaveBeenCalledWith('run-1',2);
  expect(node.textContent).toContain('PED-0026');
  expect(node.textContent).toContain('1501 registros');
  expect(node.textContent).toContain('Página 2 de 61');
});

test('manager can request the completed previous week with one action',async()=>{
  runBiReport.mockResolvedValue({id:'weekly-1',expires_at:'2026-09-29T10:00:00Z',report:{title:'Flota',
    metadata:{periodo:{desde:'2026-09-21',hasta:'2026-09-27'},fecha_corte:'2026-09-27',total_rows:0},
    rows:[],metrics:[],columns:[],warnings:[]}});
  await act(async()=>root.render(<ReportCenter initialState={{}} role="gerente" ownerId="manager-1"/>));
  await act(async()=>clickButton('Ver informe semanal de flota'));
  expect(runBiReport).toHaveBeenCalledWith({configuracion:expect.objectContaining({template:'vehiculo',periodo:'semana_anterior'})});
  expect(node.textContent).toContain('21 sept 2026');
  expect(node.textContent).toContain('El margen directo no es beneficio neto');
});

test('weekly delivery is opt-in and restricted to the selected managers',async()=>{
  saveBiWeeklySettings.mockResolvedValue({destinatarios:['manager-1']});
  getBiWeeklySettings.mockResolvedValueOnce({hora:'Lunes 09:00 Europe/Madrid',gerentes:[
    {id:'manager-1',nombre:'Gerente A',email:'gerente-a@example.test'},
    {id:'manager-2',nombre:'Gerente B',email:'gerente-b@example.test'}],destinatarios:[],ultimos_envios:[]})
    .mockResolvedValueOnce({hora:'Lunes 09:00 Europe/Madrid',gerentes:[
      {id:'manager-1',nombre:'Gerente A',email:'gerente-a@example.test'},
      {id:'manager-2',nombre:'Gerente B',email:'gerente-b@example.test'}],destinatarios:['manager-1'],ultimos_envios:[]});
  await act(async()=>root.render(<ReportCenter initialState={{}} role="gerente" ownerId="manager-1"/>));
  expect(saveBiWeeklySettings).not.toHaveBeenCalled();
  const first=[...node.querySelectorAll('.bi-weekly-people label')][0].querySelector('input');
  await act(async()=>{first.click();});
  await act(async()=>clickButton('Guardar destinatarios'));
  expect(saveBiWeeklySettings).toHaveBeenCalledWith({destinatarios:['manager-1']});
  expect(node.textContent).toContain('Envío semanal activado');
});

test('accounting role cannot see recipient settings',async()=>{
  await act(async()=>root.render(<ReportCenter initialState={{}} role="contable" ownerId="accountant-1"/>));
  expect(getBiWeeklySettings).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain('Envío semanal de rentabilidad');
});
