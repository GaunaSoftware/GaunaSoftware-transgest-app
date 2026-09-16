const PDFDocument=require('pdfkit');
function deliveryPdf(albaran){return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true}),chunks=[];doc.on('data',c=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 const data=albaran.datos;let y=44;
 const header=()=>{doc.font('Helvetica-Bold').fontSize(20).fillColor('#007f78').text('ALBARÁN',44,40);doc.fontSize(12).fillColor('#10263b').text(albaran.numero,310,44,{width:240,align:'right'});doc.font('Helvetica').fontSize(10).text(data.empresa?.nombre||'',44,76).text(`CIF: ${data.empresa?.cif||'—'}`,44,93).text(`Fecha: ${new Date(albaran.created_at||Date.now()).toLocaleDateString('es-ES')}`,310,76,{width:240,align:'right'});y=125;};
 const line=(value,bold=false)=>{const txt=String(value||'—');doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(10);const h=doc.heightOfString(txt,{width:500})+8;if(y+h>760){doc.addPage();header();}doc.text(txt,44,y,{width:500});y+=h;};
 header();line(`Cliente: ${data.cliente_nombre}`,true);line(`CIF: ${data.cliente_cif||'—'} · ${data.cliente_direccion||''}`);line(`Carga: ${data.pedido_numero}`);line(`Origen: ${data.origen}`);line(`Destino: ${data.destino}`);y+=10;
 for(const l of data.lineas||[]){
 const title=`${l.referencia} · ${l.descripcion}`,detail=`${Number(l.cantidad).toLocaleString('es-ES')} ${l.unidad} · Lote: ${l.lote||'—'} · Reparto ${l.parada} · Peso: ${(Number(l.cantidad)*Number(l.peso_kg)).toLocaleString('es-ES')} kg`;
 doc.font('Helvetica-Bold').fontSize(10);const itemHeight=doc.heightOfString(title,{width:500})+doc.font('Helvetica').heightOfString(detail,{width:500})+26;if(y+itemHeight>760){doc.addPage();header();}
 line(`${l.referencia} · ${l.descripcion}`,true);line(`${Number(l.cantidad).toLocaleString('es-ES')} ${l.unidad} · Lote: ${l.lote||'—'} · Reparto ${l.parada} · Peso: ${(Number(l.cantidad)*Number(l.peso_kg)).toLocaleString('es-ES')} kg`);doc.moveTo(44,y).lineTo(550,y).strokeColor('#dce6ed').stroke();y+=10;}
 if(y+100>760){doc.addPage();header();}
 line('Recepción de mercancía — Nombre, fecha y firma:',true);line('Observaciones / reservas:');
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.fontSize(8).fillColor('#65798d').text(`${albaran.numero} · Página ${i+1} de ${range.count}`,44,778,{width:500,align:'center',lineBreak:false});}doc.end();
});}
module.exports={deliveryPdf};
