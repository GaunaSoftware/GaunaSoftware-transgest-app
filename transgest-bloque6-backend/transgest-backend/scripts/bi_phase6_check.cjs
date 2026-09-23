const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const pdfParse=require('pdf-parse');
const {buildEconomics}=require('../src/services/financialEconomics');
const {evolution}=require('../src/services/financialWorkspace');
const center=require('../src/services/biReportCenter');
const exporter=require('../src/services/biReportExport');
const dockerfile=fs.readFileSync(path.join(__dirname,'../Dockerfile'),'utf8');
assert.match(dockerfile,/^COPY\s+assets\/fonts\/\s+\.\/assets\/fonts\/\s*$/m,
  'The production image must include the embedded fonts required by BI PDFs');
function sheetXml(buffer){let pos=0;while(pos<buffer.length-30&&buffer.readUInt32LE(pos)===0x04034b50){
  const compressed=buffer.readUInt32LE(pos+18),nameLen=buffer.readUInt16LE(pos+26),extra=buffer.readUInt16LE(pos+28);
  const name=buffer.subarray(pos+30,pos+30+nameLen).toString(),start=pos+30+nameLen+extra;
  if(name==='xl/worksheets/sheet1.xml')return zlib.inflateRawSync(buffer.subarray(start,start+compressed)).toString();
  pos=start+compressed;
}throw new Error('XLSX sheet not found');}

const range={desde:'2026-09-01',hasta:'2026-09-30'};
const order=(id,more={})=>({id,numero:`PED-${id}`,empresa_id:'a',estado:'entregado',fecha_bi:'2026-09-17',
  cliente_id:'c',origen:'Madrid',destino:'León',vehiculo_id:'v',chofer_id:'historico',importe:1000,
  coste_operativo:500,coste_gasoil:500,km_ruta:100,km_vacio:20,pendiente_factura:false,...more});
const orders=[order('1'),order('2',{importe:500,coste_operativo:250,coste_gasoil:250,
  km_ruta:100,km_vacio:20,grupaje_id:'g',pendiente_factura:true}),
  order('3',{importe:0,coste_operativo:1,coste_gasoil:1,km_ruta:100,km_vacio:20,grupaje_id:'g',pendiente_factura:false})];
const invoices=[
  {id:'paid',empresa_id:'a',cliente_id:'c',estado:'cobrada',fecha:'2026-09-17',total:1210,base_imponible:1000},
  {id:'previous',empresa_id:'a',cliente_id:'c',estado:'emitida',fecha:'2026-08-01',fecha_vencimiento:'2026-08-31',total:605,base_imponible:500},
  {id:'draft',empresa_id:'a',cliente_id:'c',estado:'borrador',fecha:'2026-09-17',total:999,base_imponible:999},
  {id:'annulled',empresa_id:'a',cliente_id:'c',estado:'anulada',fecha:'2026-09-17',total:999,base_imponible:999},
  {id:'credit',empresa_id:'a',cliente_id:'c',estado:'rectificada',fecha:'2026-09-17',total:-121,base_imponible:-100},
  {id:'future',empresa_id:'a',cliente_id:'c',estado:'emitida',fecha:'2026-10-01',total:999,base_imponible:999},
  {id:'foreign',empresa_id:'b',cliente_id:'c',estado:'emitida',fecha:'2026-09-17',total:999999,base_imponible:999999}];
const clients=[{id:'c',empresa_id:'a',nombre:'Cliente Ñ'}];
const economic=buildEconomics({empresaId:'a',range,orders:[...orders,
  order('cancelled',{estado:'cancelado',importe:999999}),order('later',{fecha_bi:'2026-10-01',importe:999999}),
  order('other',{empresa_id:'b',importe:999999})],invoices,clients});
assert.equal(economic.ingreso_servicios_realizados,1500);
assert.equal(economic.costes_directos.directo_registrado,751);
assert.equal(economic.margen_directo,749);
assert.equal(economic.facturacion_emitida_neta,900,'The credit offsets issued net sales, without draft/annulled/future invoices');
assert.equal(economic.facturacion_emitida_total,1089,'VAT is taken from signed invoice totals, never a fixed rate');
assert.equal(economic.saldo_estimado_al_corte,484,'Previous debt and credit remain in the current-state estimate');
assert.equal(economic.cobros_efectivos,null,'Invoice status does not prove dated cash');
assert.equal(economic.pendiente_facturar.importe,500);
assert.equal(economic.kilometros.total,240,'The shared 100+20 km leg is counted once');
assert.equal(economic.ingreso_km_total,6.25,'The ratio uses aggregate income and physical km');
const workspace={metadata:{periodo:range},economia:economic,
  operations:{version:'bi.operations.v1',metricas:{},detalle:{servicios:{rows:[]}}},
  matriz:{cliente:economic.por_cliente,ruta:economic.por_ruta,vehiculo:economic.por_vehiculo,ejecucion:economic.por_ejecucion},
  servicios:{rows:orders.map(p=>({numero:p.numero,fecha:p.fecha_bi,cliente:'Cliente Ñ',ruta:'Madrid → León',
    ingreso:p.importe,coste:p.coste_operativo,margen:p.importe-p.coste_operativo}))},
  facturas_vencidas:{rows:[]},evolucion:evolution(orders,'dia')};
const template=center.TEMPLATES.ejecutivo;
const config=center.validateConfig({template:'ejecutivo',periodo:'personalizado',desde:range.desde,hasta:range.hasta,
  metricas:template.metrics,columnas:template.columns,visualizaciones:template.charts});
const report=center.projectReport(workspace,config,{name:'Empresa sintética Ñ'});
assert.equal(report.metrics.find(m=>m.id==='ingreso_realizado').valor,1500);
assert.equal(report.metrics.find(m=>m.id==='margen_directo').valor,749);
assert.equal(report.chart.reduce((n,r)=>n+r.ingreso,0),1500,'Chart income reconciles to the KPI');
assert.equal(report.chart.reduce((n,r)=>n+r.margen,0),749,'Chart margin reconciles to the KPI');
assert.equal(report.rows.reduce((n,r)=>n+r.ingreso,0),1500,'Full detail reconciles to the KPI');
assert.equal(report.rows.reduce((n,r)=>n+r.margen,0),749,'Full detail margin reconciles to the KPI');
assert.deepEqual(center.previewReport(report).metrics,center.previewReport(report,2).metrics,
  'Paging cannot change aggregate metrics');
const csv=exporter.buildCsv(report).toString(),xlsx=exporter.buildReportXlsx(report);
assert(csv.includes('PED-2')&&csv.includes('1.500')===false,'CSV preserves numeric cells without presentation grouping');
assert(csv.includes('1500')&&csv.includes('749'),'CSV includes KPI values from the snapshot');
assert(sheetXml(xlsx).includes('PED-2'),'XLSX contains the same detail');
async function main(){const pdf=await exporter.buildPdf(report),parsed=await pdfParse(pdf);
  assert(parsed.text.includes('PED-2')&&parsed.text.includes('1500,00 €'),'PDF includes the same orders and income');
  console.log('OK BI fase 6: impuestos, estados, corte, grupaje y conciliación KPI/serie/detalle/PDF/XLSX/CSV');}
main().catch(error=>{console.error(error);process.exitCode=1;});
