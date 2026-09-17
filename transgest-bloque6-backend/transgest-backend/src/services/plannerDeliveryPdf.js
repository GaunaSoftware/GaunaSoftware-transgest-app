const PDFDocument=require('pdfkit');
const number=v=>Number(v||0).toLocaleString('es-ES',{maximumFractionDigits:3});
const postal=p=>[p.direccion||p.domicilio,p.cp||p.codigo_postal,p.ciudad||p.poblacion,p.provincia,p.pais].filter(Boolean).join(' · ');
function deliveryPdf(albaran){return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true}),chunks=[];
 doc.on('data',c=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 const data=albaran.datos||{};let y=42;
 const header=()=>{
  doc.font('Helvetica-Bold').fontSize(19).fillColor('#007f78').text('ALBARÁN DE ENTREGA',42,40,{width:380});
  const logo=data.cliente?.logo_base64||data.empresa?.logo_base64;
  if(typeof logo==='string'&&logo.length<1500000){try{const raw=logo.replace(/^data:image\/(png|jpeg|jpg);base64,/,'');const bytes=Buffer.from(raw,'base64');if(bytes[0]===137||(bytes[0]===255&&bytes[1]===216))doc.image(bytes,440,35,{fit:[110,48],align:'right'});}catch{/* Invalid optional logo does not prevent printing. */}}
  doc.font('Helvetica').fontSize(10).fillColor('#183249').text(albaran.numero,42,68,{width:375});
  doc.fontSize(9).fillColor('#61788b').text(`Emitido: ${new Date(albaran.created_at||Date.now()).toLocaleDateString('es-ES')}`,42,85);
  doc.moveTo(42,106).lineTo(552,106).strokeColor('#d9e7e6').stroke();y=120;
 };
 const text=(value,{bold=false,size=10,color='#183249',width=510,x=42}={})=>{
  const s=String(value||'—');doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);
  const h=doc.heightOfString(s,{width})+7;if(y+h>744){doc.addPage();header();}
  doc.fillColor(color).text(s,x,y,{width});y+=h;
 };
 const title=s=>{y+=8;text(s,{bold:true,color:'#007f78',size:11});};
 header();title('EMISOR');text(data.empresa?.nombre,{bold:true});text(`NIF: ${data.empresa?.cif||'—'} · ${postal(data.empresa||{})}`);
 title('CLIENTE');text(data.cliente?.nombre||data.cliente_nombre,{bold:true});text(`NIF: ${data.cliente?.cif||data.cliente_cif||'—'} · ${postal(data.cliente||{direccion:data.cliente_direccion})}`);
 text(`Pedido: ${data.pedido_numero||'—'} · Referencia del cliente: ${data.referencia_cliente||'—'}`);
 title('TRANSPORTE');text(`${data.transportista?.nombre||'Transportista pendiente'} · NIF: ${data.transportista?.cif||'—'}`);
 text(`Tractora: ${data.matricula||'—'} · Remolque: ${data.remolque||'—'}`);
 for(const [label,key,fallback,date] of [['Carga','puntos_carga',data.origen,data.fecha_carga],['Entrega','puntos_descarga',data.destino,data.fecha_descarga]]){
  const points=Array.isArray(data[key])&&data[key].length?data[key]:[{nombre:fallback}];
  points.forEach((p,i)=>{text(`${label} ${i+1}: ${p.nombre||p.cliente_nombre||p.ciudad||fallback||'—'}`,{bold:true});text([postal(p),String(p.fecha||date||'').slice(0,10),p.hora,p.ventana].filter(Boolean).join(' · '));});
 }
 title('MERCANCÍA Y REPARTOS');
 for(const l of data.lineas||[]){
  if(y+66>744){doc.addPage();header();title('MERCANCÍA (continuación)');}
  text(`${l.referencia||'—'} · ${l.descripcion||'Mercancía'}`,{bold:true});
  text(`${number(l.cantidad)} ${l.unidad||'unidades'} · Lote: ${l.lote||'—'} · Entrega ${l.parada||1} · ${number(Number(l.cantidad)*Number(l.peso_kg||0))} kg`,{size:9});
  doc.moveTo(42,y).lineTo(552,y).strokeColor('#e1e9ed').stroke();y+=6;
 }
 text(`Peso total: ${number((data.lineas||[]).reduce((n,l)=>n+Number(l.cantidad)*Number(l.peso_kg||0),0))} kg · Palets: ${data.palets??'—'}`,{bold:true});
 if(y+115>744){doc.addPage();header();}
 title('RECEPCIÓN');text('Nombre, fecha y firma de quien recibe:');y+=20;text('Observaciones, faltas o reservas:');y+=20;
 text('Documento de entrega. No es una factura ni sustituye por sí solo al documento de control del transporte.',{size:8,color:'#61788b'});
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(8).fillColor('#61788b').text(`${albaran.numero} · ${i+1} / ${range.count}`,42,778,{width:510,align:'center',lineBreak:false});}
 doc.end();
});}
module.exports={deliveryPdf};
