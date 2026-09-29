const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const C = { ink: '#17313a', teal: '#087a73', pale: '#e8f5f2', line: '#c9d9d6', muted: '#577078' };
const text = value => String(value ?? '').trim() || 'No informado';
const date = value => {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}` : text(value);
};
const party = value => [value?.nombre, value?.nif && `NIF ${value.nif}`, value?.domicilio].filter(Boolean).join('\n');
const stop = value => [value?.nombre, value?.direccion].filter(Boolean).join('\n');
const number = value => value === null || value === undefined || value === '' ? 'No informado' : Number(value).toLocaleString('es-ES');

function dataImage(value) {
  const match = /^data:image\/(?:png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || ''));
  return match ? Buffer.from(match[1], 'base64') : null;
}

// The public original is an administrative DeCA. A captured operation signature
// stays in its separate receipt; it must never be pasted onto a new PDF as an
// advanced signature of these bytes.
async function renderDeca({ documento: d, version, generatedAt, url }) {
  const pdf = new PDFDocument({ size: 'A4', margin: 28, bufferPages: true, info: {
    Title: `DeCA ${d.referencia_pedido} · versión ${version}`,
    Subject: 'Documento electrónico de control administrativo del transporte',
    Author: d.empresa?.nombre || 'TransGest', Creator: 'TransGest',
    Producer: 'TransGest PDF service', CreationDate: new Date(generatedAt), ModDate: new Date(generatedAt),
  } });
  const chunks = []; pdf.on('data', chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => { pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject); });
  const left = 28, width = pdf.page.width - 56, half = width / 2, overflow = [];
  const put = (value, x, y, w, { size = 8, bold = false, color = C.ink, height } = {}) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
      .text(text(value), x, y, { width: w, height, lineGap: 2, ellipsis: true });
  };
  const box = (label, value, x, y, w, h) => {
    pdf.roundedRect(x, y, w, h, 5).lineWidth(.7).strokeColor(C.line).stroke();
    put(label.toUpperCase(), x + 9, y + 7, w - 18, { bold: true, size: 7, color: C.teal, height: 12 });
    const content = text(value);
    const fullHeight = pdf.font('Helvetica').fontSize(8).heightOfString(content, { width: w - 18, lineGap: 2 });
    if (fullHeight > h - 26) {
      overflow.push({ label, content });
      put('Ver texto íntegro en anexo', x + 9, y + 21, w - 18, { size: 8, height: h - 26 });
    } else put(content, x + 9, y + 21, w - 18, { size: 8, height: h - 26 });
  };
  const band = (label, y) => {
    pdf.roundedRect(left, y, width, 22, 4).fill(C.pale);
    put(label, left + 9, y + 5, width - 18, { bold: true, size: 9, color: C.teal });
  };
  pdf.roundedRect(left, 28, width, 92, 8).lineWidth(1).strokeColor(C.line).stroke();
  const logo = dataImage(d.empresa?.logo_url);
  if (logo) { try { pdf.image(logo, left + 10, 39, { fit: [55, 50] }); } catch {} }
  const titleX = left + (logo ? 75 : 13);
  put('DOCUMENTO DE CONTROL ADMINISTRATIVO', titleX, 41, 357 - (logo ? 60 : 0), { bold: true, size: 10, color: C.teal });
  put('ELECTRÓNICO · DeCA', titleX, 58, 357 - (logo ? 60 : 0), { bold: true, size: 11, color: C.ink });
  put(`${text(d.empresa?.nombre)}  ·  Pedido ${text(d.referencia_pedido)}`, titleX, 79, 354 - (logo ? 60 : 0), { size: 7.5, color: C.muted, height: 16 });
  put(`Original v${version} · ${new Date(generatedAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`, titleX, 98, 350 - (logo ? 60 : 0), { size: 7, color: C.muted, height: 14 });
  const qr = await QRCode.toBuffer(url, { width: 200, margin: 1, errorCorrectionLevel: 'M' });
  pdf.image(qr, left + width - 81, 34, { width: 75 });

  let y = 128;
  band('PARTES DEL TRANSPORTE', y); y += 28;
  box('Cargador contractual', party(d.cargador_contractual), left, y, half - 4, 68);
  box('Transportista efectivo', party(d.transportista_efectivo), left + half + 4, y, half - 4, 68); y += 75;
  box('Destinatario', [d.destino?.destinatario, d.destino?.direccion].filter(Boolean).join('\n'), left, y, half - 4, 60);
  box('Fecha de transporte y referencia', `${date(d.fecha_transporte)}\n${text(d.referencia_pedido)}`, left + half + 4, y, half - 4, 60); y += 68;

  band('ORIGEN, DESTINO Y MERCANCÍA', y); y += 28;
  box('Lugar de carga', stop(d.origen), left, y, half - 4, 61);
  box('Lugar de entrega', stop(d.destino), left + half + 4, y, half - 4, 61); y += 68;
  box('Naturaleza y embalaje', [d.mercancia?.descripcion, d.mercancia?.embalaje && `Embalaje: ${d.mercancia.embalaje}`].filter(Boolean).join('\n'), left, y, width * .57 - 4, 60);
  box('Cantidad', `${number(d.mercancia?.peso_kg)} kg\n${number(d.mercancia?.bultos)} bultos/unidades`, left + width * .57 + 4, y, width * .43 - 4, 60); y += 68;
  box('Tractora y remolque', [d.vehiculo?.tractora && `Tractora: ${d.vehiculo.tractora}`, d.vehiculo?.remolque && `Remolque: ${d.vehiculo.remolque}`].filter(Boolean).join('\n'), left, y, half - 4, 52);
  box('Autorización especial de circulación', d.autorizacion_especial?.requerida ? text(d.autorizacion_especial.referencia) : 'No indicada como necesaria', left + half + 4, y, half - 4, 52); y += 60;

  if (d.observaciones) { box('Observaciones públicas', d.observaciones, left, y, width, 49); y += 57; }
  band('QR Y TRAZABILIDAD', y); y += 28;
  box('Original verificable', `QR de descarga directa · código ${text(d.codigo_control)}\nEsta versión conserva sus propios datos y URL.`, left, y, width, 55); y += 62;
  const third = (width - 12) / 3;
  ['Cargador', 'Transportista', 'Destinatario'].forEach((label, i) => {
    box(`Firma contractual · ${label}`, 'No incorporada a este original.\nJustificantes operativos en expediente privado.', left + i * (third + 6), y, third, 68);
  }); y += 77;
  put('Documento de control administrativo. Este QR no publica importes. Cuando proceda, el precio y los gastos deben constar en un acuerdo escrito privado vinculado al envío.', left, y, width, { size: 7, color: C.muted, height: 25 });

  if (d.envios?.length) {
    pdf.addPage(); y = 36;
    put(`ENVÍOS CONSOLIDADOS · ${text(d.referencia_pedido)}`, left, y, width, { bold: true, size: 13, color: C.teal }); y += 32;
    for (const [index, shipment] of d.envios.entries()) {
      if (y + 154 > 760) { pdf.addPage(); y = 36; }
      band(`ENVÍO ${index + 1} · ${text(shipment.referencia || shipment.id)}`, y); y += 29;
      box('Origen', stop(shipment.origen), left, y, half - 4, 45);
      box('Destinatario y destino', [shipment.destino?.destinatario, shipment.destino?.direccion].filter(Boolean).join('\n'), left + half + 4, y, half - 4, 45); y += 51;
      box('Mercancía', [shipment.mercancia?.descripcion, shipment.mercancia?.embalaje].filter(Boolean).join(' · '), left, y, width * .57 - 4, 45);
      box('Peso y bultos', `${number(shipment.mercancia?.peso_kg)} kg · ${number(shipment.mercancia?.bultos)} bultos`, left + width * .57 + 4, y, width * .43 - 4, 45); y += 57;
    }
  }
  if (overflow.length) {
    pdf.addPage(); y = 36;
    put(`ANEXO · DATOS ÍNTEGROS · ${text(d.referencia_pedido)}`, left, y, width, { bold: true, size: 12, color: C.teal }); y += 30;
    for (const item of overflow) {
      const height = pdf.font('Helvetica').fontSize(9).heightOfString(item.content, { width, lineGap: 3 });
      if (y + height + 38 > 760) { pdf.addPage(); y = 36; }
      put(item.label.toUpperCase(), left, y, width, { bold: true, size: 8, color: C.teal }); y += 16;
      pdf.font('Helvetica').fontSize(9).fillColor(C.ink).text(item.content, left, y, { width, lineGap: 3 });
      y = pdf.y + 16;
    }
  }
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(i); pdf.moveTo(left, 786).lineTo(left + width, 786).strokeColor(C.line).stroke();
    put(`TransGest · DeCA ${text(d.referencia_pedido)} · v${version} · ${i + 1}/${range.count}`, left, 790, width, { size: 7, color: C.muted });
  }
  pdf.end(); return done;
}

module.exports = { renderDeca };
