const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// Administrative document only. Operation signatures belong to independent receipts.
async function renderDeca({ documento: d, version, generatedAt, url }) {
  const pdf = new PDFDocument({ size: 'A4', margin: 38, bufferPages: true, info: {
    Title: `DeCA ${d.referencia_pedido} · versión ${version}`, Author: d.empresa?.nombre || 'TransGest',
    Creator: 'TransGest', Producer: 'TransGest PDF service',
    CreationDate: new Date(generatedAt), ModDate: new Date(generatedAt),
  } });
  const chunks = []; pdf.on('data', b => chunks.push(b));
  const done = new Promise((resolve, reject) => { pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject); });
  const left = 38, width = 519;
  const space = height => { if (pdf.y + height > 765) pdf.addPage(); };
  const heading = title => {
    space(60); pdf.moveDown(.5); pdf.font('Helvetica-Bold').fontSize(10).fillColor('#0f766e').text(title);
    pdf.moveTo(left, pdf.y + 3).lineTo(left + width, pdf.y + 3).strokeColor('#cbd5e1').stroke(); pdf.moveDown(.6);
  };
  const line = (label, value) => {
    const content = `${label}: ${String(value ?? '').trim() || 'No informado'}`;
    pdf.font('Helvetica').fontSize(9); space(pdf.heightOfString(content, { width }) + 8);
    pdf.fillColor('#172b2b').text(content, left, pdf.y, { width, lineGap: 2 }); pdf.moveDown(.35);
  };
  pdf.font('Helvetica-Bold').fontSize(14).fillColor('#0f766e').text('DOCUMENTO ELECTRÓNICO DE\nCONTROL ADMINISTRATIVO (DeCA)', left, 38, { width: 390 });
  pdf.font('Helvetica').fontSize(10).fillColor('#334155').text('Formato carta de porte', { width: 380 });
  pdf.fontSize(8).text(`${d.referencia_pedido} · Versión ${version}`, { width: 380 });
  const qr = await QRCode.toBuffer(url, { width: 180, margin: 1 }); pdf.image(qr, 465, 35, { width: 90 });
  pdf.y = 136;
  heading('Partes del transporte');
  line('CARGADOR CONTRACTUAL', `${d.cargador_contractual.nombre} · NIF ${d.cargador_contractual.nif}`);
  line('Domicilio completo', d.cargador_contractual.domicilio);
  line('TRANSPORTISTA EFECTIVO', `${d.transportista_efectivo.nombre} · NIF ${d.transportista_efectivo.nif}`);
  line('DESTINATARIO', d.destino.destinatario || d.destino.nombre);
  line('Dirección del destinatario', d.destino.direccion);
  heading('Envío y mercancía');
  line('Fecha de transporte', String(d.fecha_transporte).slice(0, 10));
  line('Origen', [d.origen.nombre, d.origen.direccion].filter(Boolean).join(' · '));
  line('Destino', [d.destino.nombre, d.destino.direccion].filter(Boolean).join(' · '));
  line('Naturaleza de la mercancía', d.mercancia.descripcion);
  line('Embalaje', d.mercancia.embalaje);
  line('Peso', `${Number(d.mercancia.peso_kg).toLocaleString('es-ES')} kg`);
  line('Bultos / unidades', d.mercancia.bultos);
  line('Matrículas', [d.vehiculo.tractora, d.vehiculo.remolque].filter(Boolean).join(' / '));
  for(const [index,shipment] of (d.envios||[]).entries()){
    heading(`Envío ${index+1} · ${shipment.referencia||shipment.id}`);
    line('Origen', [shipment.origen.nombre,shipment.origen.direccion].filter(Boolean).join(' · '));
    line('Destinatario',shipment.destino.destinatario);
    line('Destino',shipment.destino.direccion);
    line('Naturaleza / embalaje',[shipment.mercancia.descripcion,shipment.mercancia.embalaje].filter(Boolean).join(' · '));
    line('Peso / bultos',`${Number(shipment.mercancia.peso_kg).toLocaleString('es-ES')} kg / ${shipment.mercancia.bultos??'No informado'}`);
  }
  if (d.observaciones) { heading('Observaciones'); line('Observaciones', d.observaciones); }
  heading('Identificación de esta versión');
  line('Creado (UTC)', new Date(generatedAt).toISOString());
  line('Descarga del original', url);
  line('Conservación', 'Original inmutable. Las evidencias de carga y entrega se conservan en justificantes separados.');
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(i); pdf.font('Helvetica').fontSize(7).fillColor('#64748b').text(`TransGest · ${d.referencia_pedido} · v${version} · ${i + 1}/${range.count}`, left, 783, { width, align: 'center', lineBreak: false });
  }
  pdf.end(); return done;
}
module.exports = { renderDeca };
