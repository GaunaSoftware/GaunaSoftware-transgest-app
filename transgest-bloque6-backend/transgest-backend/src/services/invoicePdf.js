const PDFDocument = require('pdfkit');

function buildFacturaPdfBuffer(factura = {}, lineas = [], empresa = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 84, bottom: 48, left: 48, right: 48 }, autoFirstPage: false });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    let page = 0;
    const width = 499;
    const text = (value, options = {}) => doc.text(String(value ?? ''), 48, doc.y, { width, lineGap: 3, ...options });
    const money = value => `${Number(value ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
    const date = value => value ? new Date(value).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }) : '';
    doc.on('pageAdded', () => {
      page++;
      if (empresa.factura_plantilla?.imagen_base64) {
        doc.image(Buffer.from(empresa.factura_plantilla.imagen_base64,'base64'),0,0,{width:doc.page.width,height:doc.page.height});
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151');
      doc.text(page === 1 ? 'FACTURA' : 'FACTURA / CONTINUACION', 48, 40, { width: 390 });
      doc.text(String(page), 498, 40, { width: 49, align: 'right' });
      doc.moveTo(48, 63).lineTo(547, 63).strokeColor('#d1d5db').stroke();
      doc.font('Helvetica').fontSize(10).fillColor('#111827');
      doc.y = 84;
    });
    try {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(16);
      text(empresa.razon_social || empresa.nombre || 'TransGest');
      doc.fontSize(13);
      text(`FACTURA ${factura.numero || ''}`);
      doc.font('Helvetica').fontSize(10);
      if (empresa.cif) text(`CIF/NIF emisor: ${empresa.cif}`);
      if (empresa.domicilio) text(`Domicilio emisor: ${empresa.domicilio}`);
      doc.moveDown();
      text(`Cliente: ${factura.cliente_nombre || ''}`);
      if (factura.cliente_cif) text(`CIF/NIF: ${factura.cliente_cif}`);
      const locality = [factura.cliente_cp, factura.cliente_ciudad].filter(Boolean).join(' ');
      const address = [factura.cliente_direccion, locality, factura.cliente_pais].filter(Boolean).join(', ');
      if (address) text(`Direccion: ${address}`);
      if (factura.cliente_contacto) text(`Contacto: ${factura.cliente_contacto}`);
      if (factura.cliente_telefono) text(`Telefono: ${factura.cliente_telefono}`);
      const email = factura.cliente_email_facturacion || factura.cliente_email;
      if (email) text(`Email: ${email}`);
      if (factura.factura_original_numero) text(`Rectifica: ${factura.factura_original_numero}`);
      if (factura.motivo_rectificacion) text(`Motivo: ${factura.motivo_rectificacion}`);
      if (factura.referencia_cliente) text(`Referencia: ${factura.referencia_cliente}`);
      text(`Fecha: ${date(factura.fecha)}    Vencimiento: ${date(factura.fecha_vencimiento)}`);
      doc.moveDown();
      doc.font('Helvetica-Bold');
      text('CONCEPTOS');
      doc.font('Helvetica');
      for (const [index, line] of lineas.entries()) {
        if (doc.y > doc.page.height - 100) doc.addPage();
        text(`${index + 1}. ${line.concepto || 'Servicio'}`);
        text(`Cantidad: ${Number(line.cantidad ?? 1)}    Precio unitario: ${money(line.precio_unit)}`);
        doc.moveDown(0.7);
      }
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.moveDown();
      text(`Base imponible: ${money(factura.base_imponible)}`, { align: 'right' });
      text(`IVA: ${money(factura.cuota_iva)}`, { align: 'right' });
      if (Number(factura.cuota_irpf)) text(`Retención IRPF: ${money(factura.cuota_irpf)}`, { align: 'right' });
      doc.font('Helvetica-Bold').fontSize(13);
      text(`TOTAL: ${money(factura.total)}`, { align: 'right' });
      doc.font('Helvetica').fontSize(10);
      doc.moveDown();
      if (empresa.iban) text(`IBAN: ${empresa.iban}`);
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}

module.exports = { buildFacturaPdfBuffer };
