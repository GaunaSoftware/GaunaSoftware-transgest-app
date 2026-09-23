const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const zlib=require('node:zlib');
const pdfParse=require('pdf-parse');const {PGlite}=require('@electric-sql/pglite');
const center=require('../src/services/biReportCenter');const reportExport=require('../src/services/biReportExport');
const db=require('../src/services/db');const reportRoutes=require('../src/routes/biReportCenter');
const root=path.resolve(__dirname,'../../..');const out=path.join(root,'output','pdf');const dataOut=path.join(root,'output','reports');
const metric=(valor,unidad='EUR',estado='completo')=>({valor,unidad,estado,definicion:'Valor sintético para verificar la exportación; cálculo original del contrato BI.',
  cobertura:{evaluables:valor==null?0:1,total:1}});
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const u='10000000-0000-4000-8000-000000000001',v='10000000-0000-4000-8000-000000000002';
function fixture(count=2,partial=false){
  const services=Array.from({length:count},(_,i)=>({id:`p${i}`,numero:`PED-2026-${String(i+1).padStart(4,'0')}`,fecha:'2026-09-17',
    cliente:i%2?'=HYPERLINK("evil")':'Compañía Muñoz',ruta:'Madrid → León',vehiculo:'1234-ABC',ejecucion:'flota_propia',
    ingreso:i===0?-50:100,coste:partial?null:60,margen:partial?null:i===0?-110:40,km_pedido:100,pendiente_factura:i===0}));
  const matrix=[{id:'c',nombre:'Compañía Muñoz',servicios:count,ingreso:count*100-150,coste_directo_registrado:partial?null:count*60,
    margen_directo_registrado:partial?null:count*40-150,margen_pct:partial?null:20,km_total:count*100,km_vacios:0}];
  const economic={};for(const id of Object.keys(center.METRICS))economic[id]=metric(id==='margen_directo'&&partial?null:250);
  economic.ingreso_realizado=metric(count?1500:null);economic.margen_directo=metric(partial?null:250,'EUR',partial?'parcial':'completo');
  economic.ingreso_km_total=metric(count?1.5:null,'EUR/km total');economic.km_vacios_pct=metric(count?20:null,'%');
  economic.pendiente_facturar=metric(count?150:null);economic.vencido_al_corte=metric(count?605:null,'EUR','estimado');
  const operational={};for(const id of ['puntualidad_recogida','puntualidad_entrega','otif','pod_pendiente','incidencias_servicio'])operational[id]=metric(count?88:null,id==='pod_pendiente'||id==='incidencias_servicio'?'registros':'%',partial?'parcial':'completo');
  if(!count){for(const item of Object.values(economic)){item.valor=null;item.estado='sin_datos';item.cobertura={evaluables:0,total:0};}
    for(const item of Object.values(operational)){item.valor=null;item.estado='sin_datos';item.cobertura={evaluables:0,total:0};}}
  return {metadata:{periodo:{desde:'2026-09-01',hasta:'2026-09-30'}},
    economia:{version:'bi.economia.v2',metricas:economic,cobertura:{servicios:count,ingresos:count,costes:partial?0:count,km:count},fuentes_no_disponibles:partial?['chofer_gastos']:[]},
    operations:{version:'bi.operaciones.v1',metricas:operational,detalle:{servicios:{rows:services.map(s=>({numero:s.numero,cargas_confirmadas:true,
      descargas_confirmadas:true,entregado:true,incidencia:false,pod_recibido:true}))}}},
    matriz:{cliente:matrix,ruta:matrix,vehiculo:matrix,ejecucion:matrix},servicios:{rows:services},
    facturas_vencidas:{rows:count?[{numero:'A-2026-01',cliente:'Compañía Muñoz',fecha_vencimiento:'2026-09-01',total:605}]:[]},
    evolucion:count?[{fecha:'2026-09-17',ingreso:1500,margen:partial?null:250}]:[]};
}
function config(template,extra={}){const t=center.TEMPLATES[template];return center.validateConfig({template,periodo:'personalizado',desde:'2026-09-01',hasta:'2026-09-30',
  filtros:template==='servicio_cliente'?{cliente_id:'c'}:{},metricas:t.metrics,columnas:t.columns,
  dimension:t.dimensions[0],agrupacion:t.dimensions[0],visualizaciones:t.charts,...extra});}
function zipEntry(buffer,name){let pos=0;while(pos<buffer.length-30&&buffer.readUInt32LE(pos)===0x04034b50){
  const compressed=buffer.readUInt32LE(pos+18),nameLen=buffer.readUInt16LE(pos+26),extra=buffer.readUInt16LE(pos+28);
  const found=buffer.subarray(pos+30,pos+30+nameLen).toString();const start=pos+30+nameLen+extra;
  if(found===name)return zlib.inflateRawSync(buffer.subarray(start,start+compressed)).toString();pos=start+compressed;
}throw new Error(`ZIP entry ${name} missing`);}
async function databaseIsolation(){const pg=new PGlite(),original=db.query;try{
  await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY);CREATE TABLE usuarios(id uuid PRIMARY KEY);
    CREATE TABLE clientes(id uuid,empresa_id uuid,nombre text);
    INSERT INTO empresas VALUES ('${a}'),('${b}');INSERT INTO usuarios VALUES ('${u}'),('${v}');
    INSERT INTO clientes VALUES ('30000000-0000-4000-8000-000000000001','${a}','Cliente A'),('30000000-0000-4000-8000-000000000002','${b}','Cliente B');`);
  await pg.exec(fs.readFileSync(path.join(__dirname,'migrations','20260923_bi_report_center.sql'),'utf8'));
  await pg.query(`INSERT INTO bi_report_views(empresa_id,owner_id,nombre,alcance,configuracion)
    VALUES($1,$2,'A','personal',$3),($4,$5,'B','compartida',$3)`,[a,u,JSON.stringify(config('ejecutivo')),b,v]);
  const views=await pg.query("SELECT * FROM bi_report_views WHERE empresa_id=$1 AND (alcance='compartida' OR owner_id=$2)",[a,u]);
  assert.equal(views.rows.length,1);assert.equal(views.rows[0].nombre,'A');
  const run=await pg.query(`INSERT INTO bi_report_runs(empresa_id,owner_id,snapshot,contract_version)
    VALUES($1,$2,$3,'bi.report.v1') RETURNING id`,[a,u,JSON.stringify(center.projectReport(fixture(2),config('ejecutivo')))]);
  const binary=Buffer.from('private');const exported=await pg.query(`INSERT INTO bi_report_exports(empresa_id,owner_id,run_id,formato,contenido)
    VALUES($1,$2,$3,'pdf',$4) RETURNING id`,[a,u,run.rows[0].id,binary]);
  const sql=`SELECT x.formato,x.contenido FROM bi_report_exports x JOIN bi_report_runs r ON r.id=x.run_id AND r.empresa_id=x.empresa_id AND r.owner_id=x.owner_id
    WHERE x.empresa_id=$1 AND x.owner_id=$2 AND x.expires_at>now() AND r.expires_at>now()`;
  assert.equal((await pg.query(sql,[b,v])).rows.length,0,'Other company cannot download');
  assert.equal((await pg.query(sql,[a,v])).rows.length,0,'Other user cannot download');
  assert.equal((await pg.query(sql,[a,u])).rows.length,1);
  db.query=(query,params)=>pg.query(query,params);
  const call=async(route,method,enterprise,user,body={},id=null,userRole='gerente',query={})=>{
    const layer=reportRoutes.stack.find(x=>x.route?.path===route&&x.route.methods[method.toLowerCase()]);
    let status=200,result=null,headers={};const res={status(code){status=code;return this;},json(data){result=data;return this;},
      set(key,value){headers[key]=value;return this;},send(data){result=data;return this;}};
    await layer.route.stack[0].handle({empresaId:enterprise,user:{id:user,rol:userRole},body,params:{id},query},res);
    return {status,result,headers};
  };
  const catalogue=await call('/catalogo','GET',a,u);
  assert.equal(catalogue.result.opciones.clientes.length,1);assert.equal(catalogue.result.opciones.clientes[0].nombre,'Cliente A');
  const viewBody={nombre:'Informe compartido',descripcion:'Prueba sintética',alcance:'compartida',configuracion:config('ejecutivo')};
  assert.equal((await call('/vistas','POST',a,u,viewBody,null,'contable')).status,403,'Accounting cannot publish a shared view');
  const created=await call('/vistas','POST',a,u,viewBody);assert.equal(created.status,201);
  assert.equal((await call('/vistas','GET',a,u)).result.length,2);
  assert.equal((await call('/vistas','GET',b,v)).result.length,1,'A shared view does not cross companies');
  assert.equal((await call('/vistas/:id','PUT',a,v,{...viewBody,nombre:'Otro'},created.result.id)).status,404);
  assert.equal((await call('/vistas/:id','PUT',a,u,{...viewBody,nombre:'Actualizado'},created.result.id)).status,200);
  assert.equal((await call('/vistas/:id','DELETE',a,v,{},created.result.id)).status,404);
  assert.equal((await call('/vistas/:id','DELETE',a,u,{},created.result.id)).status,200);
  const page=await call('/ejecuciones/:id','GET',a,u,{},run.rows[0].id,'gerente',{pagina:'1'});
  assert.equal(page.status,200);assert.equal(page.result.metadata.total_rows,2);
  assert.equal((await call('/ejecuciones/:id','GET',b,v,{},run.rows[0].id)).status,404);
  assert.equal((await call('/ejecuciones/:id','GET',a,v,{},run.rows[0].id)).status,404);
  const download=await call('/descargas/:id','GET',a,u,{},exported.rows[0].id);
  assert.equal(download.status,200);assert.deepEqual(Buffer.from(download.result),binary);assert.equal(download.headers['Cache-Control'],'private, no-store');
  assert.equal((await call('/descargas/:id','GET',b,v,{},exported.rows[0].id)).status,404);
  assert.equal((await call('/descargas/:id','GET',a,v,{},exported.rows[0].id)).status,404);
  await pg.query("UPDATE bi_report_exports SET expires_at=now()-interval '1 minute' WHERE empresa_id=$1",[a]);
  assert.equal((await pg.query(sql,[a,u])).rows.length,0,'Expired export is inaccessible');
  assert.equal((await call('/descargas/:id','GET',a,u,{},exported.rows[0].id)).status,404);
}finally{db.query=original;await pg.close();}}
async function main(){
  assert.throws(()=>center.validateConfig({template:'ejecutivo',metricas:['SELECT * FROM facturas']}),/catálogo/);
  assert.throws(()=>center.validateConfig({template:'servicio_cliente'}),/requiere un cliente/);
  for(const id of Object.keys(center.TEMPLATES)){
    const report=center.projectReport(fixture(2),config(id),{name:'Empresa Ñáñez'});
    assert.equal(report.version,'bi.report.v1');assert.equal(report.metadata.total_rows,report.rows.length);
    if(id==='servicio_cliente'){
      assert(!JSON.stringify(report).includes('coste_directo'),'The customer quality report must not reveal costs');
      assert(!JSON.stringify(report).includes('margen_directo'),'The customer quality report must not reveal margins');
    }
  }
  fs.mkdirSync(out,{recursive:true});fs.mkdirSync(dataOut,{recursive:true});
  for(const [name,count,partial] of [['corto',2,false],['largo',85,false],['sin_datos',0,false],['parcial',2,true]]){
    const report=center.projectReport(fixture(count,partial),config('ejecutivo'),{name:'Empresa sintética Ñáñez'});
    const snapshot=JSON.parse(JSON.stringify(report));
    const pdf=await reportExport.buildPdf(snapshot);fs.writeFileSync(path.join(out,`bi-fase5-${name}-sintetico.pdf`),pdf);
    const parsed=await pdfParse(pdf);assert(parsed.text.includes(report.title));assert(parsed.text.includes('Ñáñez'));
    if(count)assert(parsed.text.includes('€'));
    if(name==='largo'){assert(parsed.numpages>1);assert(parsed.text.includes('PED-2026-0085'));assert(parsed.text.includes('Compañía Muñoz'));
      assert((parsed.text.match(/Centro de informes/g)||[]).length===parsed.numpages);
      assert((parsed.text.match(/PedidoFechaClienteRutaIngreso neto/g)||[]).length>=2,'Long tables repeat their header');}
    if(name==='sin_datos')assert(parsed.text.includes('Sin registros'));
    if(name==='parcial')assert(parsed.text.includes('Cobertura y advertencias'));
    assert.equal(snapshot.metrics[0].valor,report.metrics[0].valor,'PDF renders the displayed snapshot');
  }
  const report=center.projectReport(fixture(2),config('ejecutivo'),{name:'Empresa sintética Ñáñez'});
  const csv=reportExport.buildCsv(report),xlsx=reportExport.buildReportXlsx(report);
  fs.writeFileSync(path.join(dataOut,'bi-fase5-sintetico.csv'),csv);
  fs.writeFileSync(path.join(dataOut,'bi-fase5-sintetico.xlsx'),xlsx);
  assert(csv.toString().includes("'=HYPERLINK"),'CSV neutralizes spreadsheet formulas');
  assert(csv.toString().includes('-50'),'Legitimate negative amounts remain numeric');
  const xml=zipEntry(xlsx,'xl/worksheets/sheet1.xml');
  assert(xml.includes('<v>-50</v>'),'XLSX negative amount is a numeric cell');
  assert(xml.includes('s="1"'),'XLSX dates have date style');
  assert(xml.includes('Cobertura')&&xml.includes('Definición'));
  const longReport=center.projectReport(fixture(85),config('ejecutivo'),{name:'Empresa sintética Ñáñez'});
  assert.equal(longReport.rows.length,85);
  assert(reportExport.buildCsv(longReport).toString().includes('PED-2026-0085'),'CSV includes the last detail row');
  assert(zipEntry(reportExport.buildReportXlsx(longReport),'xl/worksheets/sheet1.xml').includes('PED-2026-0085'),
    'XLSX includes the last detail row');
  const massReport=center.projectReport(fixture(1501),config('ejecutivo'));
  const first=center.previewReport(massReport),last=center.previewReport(massReport,61);
  assert.equal(first.rows.length,25);assert.equal(last.rows.length,1);
  assert.equal(first.metadata.total_rows,1501);assert.equal(last.metadata.total_rows,1501);
  assert.deepEqual(first.metrics,last.metrics,'Totals do not change with the detail page');
  assert.equal(massReport.rows.length,1501,'The full snapshot remains available to exports');
  await databaseIsolation();console.log('OK BI fase 5: catálogo, seis plantillas, PDF paginado, XLSX/CSV, fórmula, fechas y aislamiento');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
