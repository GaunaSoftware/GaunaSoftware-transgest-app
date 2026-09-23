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
    const addPage=()=>{doc.addPage();doc.font('ReportBold').fontSize(9).fillColor('#0b5250').text('TransGest  /  Centro de informes',left,20,{width:usable});
      doc.moveTo(left,36).lineTo(right,36).strokeColor('#cbd5e1').stroke();doc.y=49;
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
      for(const m of report.metrics){
        const label=`${m.label}: ${display(m.valor,m.unidad==='%'?'number':m.unidad==='registros'?'number':m.unidad==='km'?'number':m.unidad?.includes('EUR/km')?'number':'money')}${m.valor==null?'':m.unidad==='%'?' %':m.unidad?.includes('EUR/km')?' €/km':''}  [${m.estado||'sin datos'}]`;
        const definition=`${m.definicion||''}${m.costes_incluidos?` Costes incluidos: ${m.costes_incluidos}.`:''}`;
        const h=doc.heightOfString(label,{width:usable})+doc.heightOfString(definition,{width:usable})+11;
        ensure(h);doc.font('ReportBold').fontSize(10).fillColor('#0c6663').text(label,left,doc.y,{width:usable});
        doc.font('Report').fontSize(8).fillColor('#475569').text(definition,left,doc.y+2,{width:usable});doc.moveDown(.5);
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
      if(report.bars?.length){ensure(report.bars.length*20+72);heading('Comparación');
        const max=Math.max(1,...report.bars.map(b=>Math.abs(Number(b.value||0))));
        const y=doc.y;
        report.bars.forEach((bar,i)=>{const yy=y+i*20;doc.font('Report').fontSize(8).fillColor('#17253b').text(bar.label,left,yy,{width:Math.min(155,usable*.31)});
          const x=left+Math.min(160,usable*.32);doc.rect(x,yy+3,(usable-270)*Math.abs(Number(bar.value||0))/max,9).fill(Number(bar.value)<0?'#b45309':'#0f766e');
          doc.fontSize(8).fillColor('#334155').text(`${number(bar.value)} ${bar.unit==='%'?'%':'€'}`,right-104,yy,{width:104,align:'right'});
        });doc.y=y+report.bars.length*20+4;doc.fontSize(7).fillColor('#64748b').text(report.bars_label||'',left,doc.y,{width:usable});
      }
      if(report.warnings.length){heading('Cobertura y advertencias');for(const warning of report.warnings){const h=doc.heightOfString(warning,{width:usable})+8;ensure(h);
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
