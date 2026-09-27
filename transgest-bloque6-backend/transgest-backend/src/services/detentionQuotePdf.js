const PDFDocument = require('pdfkit');
const path = require('path');
const euro = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
const date = v => new Date(v).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

module.exports = function renderPrefactura(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true,
      info: { Title: `Prefactura de paralización ${data.pedido_numero}`, Author: data.empresa.nombre,
        CreationDate: new Date(data.created_at), ModDate: new Date(data.created_at) } });
    const chunks = []; doc.on('data', b => chunks.push(b)); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.registerFont('Body', path.join(__dirname, '../../assets/fonts/LiberationSans-Regular.ttf'));
    doc.registerFont('Bold', path.join(__dirname, '../../assets/fonts/LiberationSans-Bold.ttf'));
    const header = () => {
      doc.font('Bold').fontSize(19).fillColor('#0f766e').text('PREFACTURA', 42, 35, { width: 370 });
      doc.font('Body').fontSize(11).text('Paralización de vehículo · sin IVA', 42, 59, { width: 360 });
      const logo = data.empresa.logo_base64;
      if (logo) { try { const b = Buffer.from(logo.replace(/^data:image\/(png|jpe?g);base64,/, ''), 'base64');
        if (b[0] === 137 || (b[0] === 255 && b[1] === 216)) doc.image(b, 445, 34, { fit: [108, 40] });
      } catch { /* Optional invalid image is omitted. */ } }
      doc.moveTo(42, 86).lineTo(553, 86).strokeColor('#cbdedb').stroke(); doc.y = 98;
    };
    const space = h => { if (doc.y + h > 746) { doc.addPage(); header(); } };
    const text = (value, bold = false, size = 10) => {
      const s = String(value || 'No informado'); doc.font(bold ? 'Bold' : 'Body').fontSize(size);
      space(doc.heightOfString(s, { width: 511 }) + 9);
      doc.fillColor('#18342f').text(s, 42, doc.y, { width: 511, lineGap: 2 }); doc.moveDown(.3);
    };
    const title = s => { space(58); doc.moveDown(.5); text(s, true, 11); };
    header(); text(`Pedido ${data.pedido_numero}`, true, 12); text(data.numero, false, 8);
    text(`Preparada el ${date(data.created_at)} · Horas Europe/Madrid`, false, 9);
    title('EMISOR'); text(data.empresa.nombre, true); text(`NIF: ${data.empresa.cif || 'No informado'} · ${data.empresa.direccion || 'Dirección no informada'}`);
    title('CLIENTE'); text(data.cliente.nombre, true); text(`NIF: ${data.cliente.cif || 'No informado'} · ${data.cliente.direccion || 'Dirección no informada'}`);
    title('VIAJE Y PARALIZACIÓN'); text(`${data.origen || 'Origen pendiente'} → ${data.destino || 'Destino pendiente'}`);
    if (data.referencia_cliente) text(`Referencia del cliente: ${data.referencia_cliente}`);
    text(`Operación: ${data.tipo}. Motivo: ${data.motivo}`);
    text(`Puesta a disposición: ${date(data.calculo.inicio)}. Fin: ${date(data.calculo.fin)}`);
    const tableHeader = () => { space(40); doc.font('Bold').fontSize(9).fillColor('#0f766e');
      const y = doc.y; for (const [label,x,w] of [['Periodo',42,135],['Horas facturables',180,120],['Tarifa / hora',320,105],['Importe',444,109]]) doc.text(label,x,y,{width:w});
      doc.y = y + 22; };
    title('CÁLCULO'); tableHeader();
    for (const row of data.calculo.filas) {
      if (doc.y + 25 > 746) { doc.addPage(); header(); tableHeader(); }
      const y = doc.y; doc.font('Body').fontSize(10).fillColor('#18342f');
      for (const [s,x,w] of [[`Día ${row.dia}`,42,135],[String(row.horas),180,120],[euro(row.tarifa_hora),320,105],[euro(row.importe),444,109]]) doc.text(s,x,y,{width:w});
      doc.moveTo(42,y+18).lineTo(553,y+18).strokeColor('#e2eceb').stroke(); doc.y=y+26;
    }
    text(`Referencia legal: ${euro(data.calculo.referencia_legal)}`);
    text(`Acuerdo: ${data.calculo.acuerdo}`);
    space(65); doc.moveDown(.3); text(`TOTAL PREFACTURA SIN IVA: ${euro(data.calculo.importe)}`, true, 14);
    text('No se liquida IVA en este documento. No es una factura fiscal ni acredita el cobro o la aceptación del cliente.', false, 9);
    title('CRITERIO Y ALCANCE'); text(data.calculo.criterio, false, 9); text(data.calculo.alcance, false, 9);
    text('Referencia: Ley 15/2009, art. 22. IPREM diario 20,00 €. Tarifa verificada el 27/09/2026. Se conserva el cálculo aplicado al preparar este documento.', false, 8);
    const pages = doc.bufferedPageRange();
    for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.font('Body').fontSize(8).fillColor('#617b76').text(`TransGest · ${data.pedido_numero} · ${i+1}/${pages.count}`,42,780,{width:511,align:'center',lineBreak:false});}
    doc.end();
  });
};
