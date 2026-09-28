const PDFDocument = require('pdfkit');
const path = require('path');
const { buildXlsx } = require('./contabilidadExport');

const number = (value, digits=2) => Number(value).toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const date = value => value ? new Date(`${String(value).slice(0,10)}T12:00:00Z`).toLocaleDateString('es-ES',{timeZone:'UTC'}) : '—';
const dateCell = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) ? new Date(`${value}T00:00:00Z`) : null;
function display(value,type) {
  if(value==null)return 'No calculable';
  if(type==='date')return date(value);
  if(type==='money')return `${number(value)} €`;
  if(type==='number')return number(value,Number.isInteger(Number(value))?0:2);
  if(type==='boolean')return value?'Sí':'No';
  return String(value);
}
const safeCsvText = value => /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
function csvCell(value,type) {
  if(value==null)return '';
  const raw=(type==='money'||type==='number')&&typeof value==='number' ? String(value).replace('.',',')
    :safeCsvText(type==='boolean'?(value?'Sí':'No'):String(value));
  return /[;"\r\n]/.test(raw)?`"${raw.replace(/"/g,'""')}"`:raw;
}
function buildCsv(report) {
  const lines=[`# Informe;${csvCell(report.title,'text')}`,`# Descripción;${csvCell(report.description||'','text')}`,`# Empresa;${csvCell(report.company.name,'text')}`,
    `# Desde;${report.metadata.periodo.desde}`,`# Hasta;${report.metadata.periodo.hasta}`,
    `# Corte;${report.metadata.fecha_corte}`,`# Generado;${report.metadata.generated_at}`,
    `# Contrato;${csvCell(report.metric_contract,'text')}`,`# Filtros;${csvCell(JSON.stringify(report.config.filtros),'text')}`,
    `# Detalle;Completo - ${report.rows.length} registros`];
  for(const m of report.metrics)lines.push(`# Indicador;${csvCell(m.label,'text')};${csvCell(m.valor,m.unidad==='EUR'?'money':'number')};${csvCell(m.unidad,'text')};${csvCell(m.estado,'text')};${csvCell(m.definicion,'text')}`);
  for(const warning of report.warnings)lines.push(`# Advertencia;${csvCell(warning,'text')}`);
  lines.push('',report.columns.map(c=>csvCell(c.label,'text')).join(';'));
  for(const row of report.rows)lines.push(report.columns.map(c=>csvCell(row[c.id],c.type)).join(';'));
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`,'utf8');
}
function xlsxCell(value,type) {
  if(value==null)return '';
  if(type==='date')return dateCell(value)||String(value);
  if((type==='money'||type==='number')&&typeof value==='number'&&Number.isFinite(value))return value;
  if(type==='boolean')return value?'Sí':'No';
  // Inline string cells cannot execute formula text in Excel.
  return String(value);
}
function buildReportXlsx(report) {
  const rows=[['TransGest BI',report.title],['Descripción',report.description||''],['Empresa',report.company.name],['Periodo desde',dateCell(report.metadata.periodo.desde)],
    ['Periodo hasta',dateCell(report.metadata.periodo.hasta)],['Fecha de corte',dateCell(report.metadata.fecha_corte)],
    ['Generado',report.metadata.generated_at],['Contrato',report.metric_contract],['Alcance',report.metadata.scope],
    ['Filtros',JSON.stringify(report.config.filtros)],['Agrupación',report.config.agrupacion],
    ['Detalle','Completo; sin top N ni límite de página'],[],['INDICADORES','Valor','Unidad','Cobertura','Definición']];
  for(const m of report.metrics)rows.push([m.label,m.valor==null?'':Number(m.valor),m.unidad||m.unit||'',m.estado||'',
    `${m.definicion||''}${m.costes_incluidos?` Costes incluidos: ${m.costes_incluidos}.`:''}`]);
  rows.push([],['ADVERTENCIAS']);for(const w of report.warnings)rows.push([w]);
  rows.push([],report.columns.map(c=>c.label));
  for(const row of report.rows)rows.push(report.columns.map(c=>xlsxCell(row[c.id],c.type)));
  return buildXlsx(rows,'Informe BI');
}
function logoBuffer(data) {
  const match=String(data||'').match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i);
  if(!match)return null;
  const buf=Buffer.from(match[2],'base64');return buf.length<=1000000?buf:null;
}
function buildPdf(report) {
  return new Promise((resolve,reject)=>{
    const landscape=report.columns.length>5;
    const doc=new PDFDocument({size:'A4',layout:landscape?'landscape':'portrait',margin:42,bufferPages:true,autoFirstPage:false});
    doc.registerFont('Report',path.join(__dirname,'../../assets/fonts/LiberationSans-Regular.ttf'));
    doc.registerFont('ReportBold',path.join(__dirname,'../../assets/fonts/LiberationSans-Bold.ttf'));
    const chunks=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
    const pageWidth=landscape?842:595, pageHeight=landscape?595:842, left=42,right=pageWidth-42,bottom=pageHeight-75,usable=right-left;
    let tableHeader=null;
    const addPage=()=>{doc.addPage();doc.rect(0,0,pageWidth,40).fill('#104b45');doc.font('ReportBold').fontSize(9).fillColor('#ffffff').text('TransGest  /  Centro de informes',left,19,{width:usable});
      doc.y=53;
      if(tableHeader)tableHeader();};
    const ensure=h=>{if(doc.y+h>bottom)addPage();};
    const heading=(label,size=13)=>{ensure(32);doc.moveDown(.35).font('ReportBold').fontSize(size).fillColor('#17253b').text(label,left,doc.y,{width:usable});doc.moveDown(.25);};
    try{
      addPage();
      const logo=logoBuffer(report.company.logo);if(logo){try{doc.image(logo,right-75,48,{fit:[70,42]});}catch{/* invalid company logo: keep readable heading */}}
      doc.font('ReportBold').fontSize(18).fillColor('#102d37').text(report.title,left,doc.y,{width:usable-85});
      if(report.description)doc.font('Report').fontSize(9).fillColor('#475569').text(report.description,left,doc.y+4,{width:usable-85});
      doc.font('Report').fontSize(9).fillColor('#475569').text(report.company.name,left,doc.y+5,{width:usable-85});
      doc.text(`Periodo ${date(report.metadata.periodo.desde)} - ${date(report.metadata.periodo.hasta)}  ·  Corte ${date(report.metadata.fecha_corte)}`,left,doc.y+5,{width:usable});
      doc.text(`Generado ${new Date(report.metadata.generated_at).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})}  ·  Contrato ${report.metric_contract}`,left,doc.y+4,{width:usable});
      const filters=Object.entries(report.config.filtros).map(([key,value])=>`${key}: ${value}`).join('  ·  ')||'Ninguno';
      doc.text(`Filtros: ${filters}`,left,doc.y+4,{width:usable});
      heading('Indicadores');
      const metricWidth=report.config.template==='vehiculo'?(usable-10)/2:usable;
      const cards=report.metrics.map(m=>{
        const label=`${m.label}: ${display(m.valor,m.unidad==='%'?'number':m.unidad==='registros'?'number':m.unidad==='km'?'number':m.unidad?.includes('EUR/km')?'number':'money')}${m.valor==null?'':m.unidad==='%'?' %':m.unidad?.includes('EUR/km')?' €/km':''}  [${m.estado||'sin datos'}]`;
        const definition=`${m.definicion||''}${m.costes_incluidos?` Costes incluidos: ${m.costes_incluidos}.`:''}`;
        doc.font('ReportBold').fontSize(10);const titleHeight=doc.heightOfString(label,{width:metricWidth-20});
        doc.font('Report').fontSize(8);const definitionHeight=doc.heightOfString(definition,{width:metricWidth-20});
        return {m,label,definition,titleHeight,height:titleHeight+definitionHeight+23};
      });
      const perRow=report.config.template==='vehiculo'?2:1;
      for(let start=0;start<cards.length;start+=perRow){
        const row=cards.slice(start,start+perRow),h=Math.max(...row.map(c=>c.height));ensure(h+5);const y=doc.y;
        row.forEach((card,index)=>{
          const x=left+index*(metricWidth+10);
          doc.roundedRect(x,y,metricWidth,h,6).fill(card.m.estado==='completo'?'#eef8f5':'#fff7ed');
          doc.rect(x,y,3,h).fill(card.m.estado==='completo'?'#0f766e':'#b45309');
          doc.font('ReportBold').fontSize(10).fillColor('#123e3b').text(card.label,x+10,y+7,{width:metricWidth-20});
          doc.font('Report').fontSize(8).fillColor('#475569').text(card.definition,x+10,y+11+card.titleHeight,{width:metricWidth-20});
        });
        doc.y=y+h+5;
      }
      if(report.chart.length){
        const points=report.chart.slice(-12),max=Math.max(1,...points.flatMap(p=>[Math.abs(Number(p.ingreso||0)),Math.abs(Number(p.margen||0))]));
        const h=points.length*18+22;ensure(h+54);heading('Evolución de ingresos y margen (€)');const y=doc.y;
        points.forEach((p,i)=>{const yy=y+i*18;doc.font('Report').fontSize(8).fillColor('#17253b').text(p.fecha,left,yy,{width:70});
          const barStart=left+78,barWidth=(usable-188)*Math.max(0,Number(p.ingreso||0))/max;
          doc.rect(barStart,yy+2,barWidth,6).fill('#0f766e');
          const marginWidth=(usable-188)*Math.max(0,Number(p.margen||0))/max;
          doc.rect(barStart,yy+10,marginWidth,5).fill('#3b82f6');
          doc.fillColor('#334155').text(`${number(p.ingreso||0)} / ${p.margen==null?'—':number(p.margen)}`,right-108,yy,{width:108,align:'right'});
        });doc.y=y+h;
        doc.fontSize(8).fillColor('#475569').text('Verde: ingreso realizado  ·  Azul: margen directo registrado. Importes negativos se consultan en la tabla.',left,doc.y,{width:usable});
      }
      if(report.bars?.length){ensure(report.bars.length*20+72);heading(report.config.template==='vehiculo'?'Margen directo por vehículo (€)':'Comparación');
        const max=Math.max(1,...report.bars.map(b=>Math.abs(Number(b.value||0))));
        const y=doc.y;
        report.bars.forEach((bar,i)=>{const yy=y+i*20;doc.font('Report').fontSize(8).fillColor('#17253b').text(bar.label,left,yy,{width:Math.min(155,usable*.31)});
          const x=left+Math.min(160,usable*.32);doc.rect(x,yy+3,(usable-270)*Math.abs(Number(bar.value||0))/max,9).fill(Number(bar.value)<0?'#b45309':'#0f766e');
          doc.fontSize(8).fillColor('#334155').text(`${number(bar.value)} ${bar.unit==='%'?'%':'€'}`,right-104,yy,{width:104,align:'right'});
        });doc.y=y+report.bars.length*20+4;doc.fontSize(8).fillColor('#475569').text(report.bars_label||'',left,doc.y,{width:usable});
      }
      if(report.vehicle_scope){
        heading('Cobertura de vehículos',11);
        const scope=report.vehicle_scope;
        const lines=[scope.criterio,`${scope.servicios_realizados} servicios realizados; ${scope.sin_vehiculo} sin matrícula atribuida; ${scope.asignacion_historica_ambigua} con asignación histórica ambigua; ${scope.asignacion_sin_instantanea||0} atribuidos desde el pedido sin instantánea histórica.`,
          `${scope.pedidos_fuera_del_criterio} pedidos con vehículo quedan fuera del ingreso realizado por su estado o fecha.`,
          scope.matriculas_fuera_del_criterio?.length?`Matrículas de esos pedidos: ${scope.matriculas_fuera_del_criterio.join(', ')}.`:''];
        for(const line of lines.filter(Boolean)){doc.font('Report').fontSize(8);const h=doc.heightOfString(line,{width:usable})+6;ensure(h);doc.fillColor('#334155').text(line,left,doc.y,{width:usable});doc.y+=5;}
      }
      if(report.vehicle_explanations?.length){
        heading('Por qué hay márgenes negativos',11);
        for(const row of report.vehicle_explanations){
          const refs=row.servicios?.map(s=>s.numero).join(', ')||'sin referencia de pedido';
          const line=`${row.vehiculo}: ingreso realizado ${number(row.ingreso)} € − coste directo registrado ${number(row.coste)} € = margen ${number(row.margen)} €. Servicios: ${refs}.`;
          doc.font('Report').fontSize(8);const h=doc.heightOfString(line,{width:usable-20})+18;ensure(h+5);const y=doc.y;
          doc.roundedRect(left,y,usable,h,6).fill('#fff7ed');doc.fillColor('#78350f').text(line,left+10,y+8,{width:usable-20});doc.y=y+h+5;
        }
      }
      if(report.warnings.length){doc.font('Report').fontSize(8);ensure(32+doc.heightOfString(report.warnings[0],{width:usable})+8);heading('Cobertura y advertencias');for(const warning of report.warnings){const h=doc.heightOfString(warning,{width:usable})+8;ensure(h);
        doc.font('Report').fontSize(8).fillColor('#92400e').text(`• ${warning}`,left,doc.y,{width:usable});doc.moveDown(.35);}}
      ensure(92);heading(`Detalle completo (${report.rows.length} registros)`);
      const columns=report.columns,weights=columns.map(c=>c.type==='text'?(c.id==='ruta'?1.8:c.id==='cliente'?1.5:1.1):1);
      const sum=weights.reduce((a,b)=>a+b,0);const widths=weights.map(w=>usable*w/sum);
      const positions=widths.map((_,i)=>left+widths.slice(0,i).reduce((a,b)=>a+b,0));
      tableHeader=()=>{const y=doc.y;doc.rect(left,y,usable,25).fill('#e8f4f2');
        columns.forEach((c,i)=>doc.font('ReportBold').fontSize(7).fillColor('#17413f').text(c.label,positions[i]+3,y+5,{width:widths[i]-6,height:18}));doc.y=y+26;};
      ensure(45);tableHeader();
      if(!report.rows.length){ensure(30);doc.font('Report').fontSize(9).fillColor('#64748b').text('Sin registros para esta selección.',left,doc.y,{width:usable});}
      for(let index=0;index<report.rows.length;index++){
        const row=report.rows[index],texts=columns.map(c=>display(row[c.id],c.type));
        doc.font('Report').fontSize(7);
        const height=Math.max(19,...texts.map((value,i)=>doc.heightOfString(value,{width:widths[i]-6})+7));
        ensure(height+1);const y=doc.y;
        if(index%2===0)doc.rect(left,y,usable,height).fill('#f8fafc');
        columns.forEach((c,i)=>doc.font('Report').fontSize(7).fillColor('#24364b').text(texts[i],positions[i]+3,y+3,{width:widths[i]-6}));
        doc.y=y+height;doc.moveTo(left,doc.y).lineTo(right,doc.y).strokeColor('#e2e8f0').stroke();
      }
      tableHeader=null;
      if(report.vehicle_services?.length){
        heading(`Servicios que forman el desglose (${report.vehicle_services.length})`,11);
        const fields=[['numero','Pedido',95],['vehiculo','Matrícula',95],['ingreso','Ingreso',80],['coste','Coste',80],['margen','Margen',80],['advertencia','Observación',usable-430]];
        const starts=fields.map((_,i)=>left+fields.slice(0,i).reduce((n,f)=>n+f[2],0));
        tableHeader=()=>{const y=doc.y;doc.rect(left,y,usable,22).fill('#e8f4f2');fields.forEach(([key,label,width],i)=>doc.font('ReportBold').fontSize(7).fillColor('#17413f').text(label,starts[i]+3,y+5,{width:width-6}));doc.y=y+23;};
        ensure(45);tableHeader();
        report.vehicle_services.forEach((service,index)=>{
          const values=fields.map(([key])=>key==='advertencia'?(service[key]||'—'):display(service[key],['ingreso','coste','margen'].includes(key)?'money':'text'));
          doc.font('Report').fontSize(7);const h=Math.max(20,...values.map((value,i)=>doc.heightOfString(value,{width:fields[i][2]-6})+7));ensure(h+1);const y=doc.y;
          if(index%2===0)doc.rect(left,y,usable,h).fill('#f8fafc');
          values.forEach((value,i)=>doc.font('Report').fontSize(7).fillColor('#24364b').text(value,starts[i]+3,y+3,{width:fields[i][2]-6}));
          doc.y=y+h;doc.moveTo(left,doc.y).lineTo(right,doc.y).strokeColor('#e2e8f0').stroke();
        });
        tableHeader=null;
      }
      const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);
        doc.font('Report').fontSize(8).fillColor('#64748b').text(`${report.company.name}  ·  ${report.title}`,left,pageHeight-61,{width:usable-65});
        doc.text(`${i+1} / ${pages.count}`,right-65,pageHeight-61,{width:65,align:'right'});}
      doc.end();
    }catch(error){doc.destroy();reject(error);}
  });
}
async function render(report,format){if(format==='csv')return {buffer:buildCsv(report),mime:'text/csv; charset=utf-8'};
  if(format==='xlsx')return {buffer:buildReportXlsx(report),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  if(format==='pdf')return {buffer:await buildPdf(report),mime:'application/pdf'};
  throw Object.assign(new Error('Formato no autorizado'),{status:400});}
module.exports={display,buildCsv,buildReportXlsx,buildPdf,render};
