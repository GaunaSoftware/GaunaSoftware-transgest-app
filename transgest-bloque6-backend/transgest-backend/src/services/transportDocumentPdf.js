const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const DECA_TEMPLATE_VERSION = '2026-10-readable-parties';

const C = { ink: '#17313a', teal: '#087a73', pale: '#e8f5f2', line: '#c9d9d6', muted: '#577078' };
const text = value => String(value ?? '').trim() || 'No informado';
const date = value => {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}` : text(value);
};
const party = value => [value?.nombre, value?.nif && `NIF ${value.nif}`, value?.domicilio].filter(Boolean).join('\n');
const comparable = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const stop = value => {
  const name = String(value?.nombre || '').trim(), address = String(value?.direccion || '').trim();
  // Algunos puntos antiguos usan la dirección como nombre. Imprime una sola
  // vez la dirección completa, sin perder el nombre cuando es diferente.
  if (name && address && comparable(address).startsWith(comparable(name))) return address;
  return [name, address].filter(Boolean).join('\n');
};
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
  const left = 28, width = pdf.page.width - 56, gap = 8, bottom = 754, overflow = [];
  const put = (value, x, y, w, { size = 8, bold = false, color = C.ink, height } = {}) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
      .text(text(value), x, y, { width: w, height, lineGap: 2 });
  };
  const measure = (value, w, size = 8, lineGap = 2) => pdf.font('Helvetica').fontSize(size).heightOfString(value, { width: w, lineGap });
  const fit = (content, w, height, size = 8, lineGap = 2) => {
    if (measure(content, w, size, lineGap) <= height) return [content, ''];
    let low = 0, high = content.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (measure(content.slice(0, middle), w, size, lineGap) <= height) low = middle;
      else high = middle - 1;
    }
    const boundary = content.lastIndexOf(' ', low);
    const split = boundary > low / 2 ? boundary : Math.max(1, low);
    return [content.slice(0, split).trimEnd(), content.slice(split).trimStart()];
  };
  const prepare = (label, value, w, minimum) => {
    let content = text(value);
    if (measure(content, w - 18) > 160) {
      const [visible, rest] = fit(content, w - 18, 145);
      content = `${visible}\nContinúa en el anexo.`;
      overflow.push({ label, content: rest });
    }
    return { label, content, w, h: Math.max(minimum, Math.ceil(measure(content, w - 18)) + 31) };
  };
  const box = ({ label, content, w }, x, y, h) => {
    pdf.roundedRect(x, y, w, h, 5).lineWidth(.7).strokeColor(C.line).stroke();
    put(label.toUpperCase(), x + 9, y + 7, w - 18, { bold: true, size: 7, color: C.teal, height: 12 });
    put(content, x + 9, y + 22, w - 18);
  };
  const band = (label, y) => {
    pdf.roundedRect(left, y, width, 22, 4).fill(C.pale);
    put(label, left + 9, y + 5, width - 18, { bold: true, size: 9, color: C.teal });
  };
  const logo = dataImage(d.empresa?.logo_url);
  const titleX = left + (logo ? 75 : 13);
  const titleWidth = width - (titleX - left) - 100;
  const companyHeight = measure(text(d.empresa?.nombre), titleWidth, 7.5);
  const headerHeight = Math.max(99, 76 + companyHeight);
  pdf.roundedRect(left, 28, width, headerHeight, 8).lineWidth(1).strokeColor(C.line).stroke();
  if (logo) { try { pdf.image(logo, left + 10, 39, { fit: [55, 50] }); } catch {} }
  put('DOCUMENTO DE CONTROL ADMINISTRATIVO', titleX, 41, titleWidth, { bold: true, size: 10, color: C.teal });
  put('ELECTRÓNICO · DeCA', titleX, 58, titleWidth, { bold: true, size: 11, color: C.ink });
  put(text(d.empresa?.nombre), titleX, 79, titleWidth, { size: 7.5, color: C.muted });
  put(`${text(d.referencia_pedido)} · Original v${version} · ${new Date(generatedAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`, titleX, 84 + companyHeight, titleWidth, { size: 7, color: C.muted });
  const qr = await QRCode.toBuffer(url, { width: 200, margin: 1, errorCorrectionLevel: 'M' });
  pdf.image(qr, left + width - 81, 34, { width: 75 });

  let y = 28 + headerHeight + 8;
  const ensure = height => {
    if (y + height <= bottom) return;
    pdf.addPage(); y = 36;
    put(`DeCA · ${text(d.referencia_pedido)} · continuación`, left, y, width, { bold: true, size: 10, color: C.teal }); y += 26;
  };
  const section = (label, reserve = 60) => { ensure(28 + reserve); band(label, y); y += 28; };
  const row = (items, minimum = 52, portion = .5) => {
    const widths = items.length === 1 ? [width] : [(width - gap) * portion, (width - gap) * (1 - portion)];
    const cells = items.map(([label, value], i) => prepare(label, value, widths[i], minimum));
    const height = Math.max(...cells.map(cell => cell.h));
    ensure(height);
    let x = left;
    for (const cell of cells) { box(cell, x, y, height); x += cell.w + gap; }
    y += height + 8;
  };
  section('PARTES DEL TRANSPORTE', 100);
  row([['Cargador contractual', party(d.cargador_contractual)], ['Transportista efectivo', party(d.transportista_efectivo)]], 68);
  const recipient = d.destino?.destinatario || d.destino?.nombre;
  row([['Destinatario', comparable(recipient) === comparable(d.destino?.direccion) ? '' : recipient], ['Fecha de transporte y referencia', `${date(d.fecha_transporte)}\n${text(d.referencia_pedido)}`]]);
  section('ORIGEN, DESTINO Y MERCANCÍA');
  row([['Lugar de carga', stop(d.origen)], ['Lugar de entrega', stop(d.destino)]], 61);
  row([['Naturaleza y embalaje', [d.mercancia?.descripcion, d.mercancia?.embalaje && `Embalaje: ${d.mercancia.embalaje}`].filter(Boolean).join('\n')], ['Cantidad', `${number(d.mercancia?.peso_kg)} kg\n${number(d.mercancia?.bultos)} bultos/unidades`]], 60, .57);
  row([['Tractora y remolque', [d.vehiculo?.tractora && `Tractora: ${d.vehiculo.tractora}`, d.vehiculo?.remolque && `Remolque: ${d.vehiculo.remolque}`].filter(Boolean).join('\n')], ['Autorización especial de circulación', d.autorizacion_especial?.requerida ? text(d.autorizacion_especial.referencia) : 'No indicada como necesaria']]);
  if (d.observaciones) row([['Observaciones públicas', d.observaciones]], 49);
  section('QR Y TRAZABILIDAD');
  row([['Original verificable', `QR de descarga directa · código ${text(d.codigo_control)}\nEsta versión conserva sus propios datos y URL.`]], 55);
  const notes = 'Las firmas de carga y entrega, cuando se registran, se consultan en los justificantes operativos del expediente. Este original es el documento de control administrativo; no incorpora una firma contractual avanzada.\nEste QR no publica importes. Cuando proceda, el precio y los gastos constarán en un acuerdo escrito privado vinculado al envío.';
  const notesHeight = measure(notes, width, 7);
  ensure(notesHeight + 4); put(notes, left, y, width, { size: 7, color: C.muted }); y += notesHeight + 8;

  if (d.envios?.length) {
    pdf.addPage(); y = 36;
    put(`ENVÍOS CONSOLIDADOS · ${text(d.referencia_pedido)}`, left, y, width, { bold: true, size: 13, color: C.teal }); y += 32;
    for (const [index, shipment] of d.envios.entries()) {
      section(`ENVÍO ${index + 1} · ${text(shipment.referencia || shipment.id)}`, 130);
      row([['Origen', stop(shipment.origen)], ['Destinatario y destino', stop({nombre:shipment.destino?.destinatario,direccion:shipment.destino?.direccion})]], 45);
      row([['Mercancía', [shipment.mercancia?.descripcion, shipment.mercancia?.embalaje].filter(Boolean).join(' · ')], ['Peso y bultos', `${number(shipment.mercancia?.peso_kg)} kg · ${number(shipment.mercancia?.bultos)} bultos`]], 45, .57);
    }
  }
  if (overflow.length) {
    ensure(80);
    put(`ANEXO · DATOS ÍNTEGROS · ${text(d.referencia_pedido)}`, left, y, width, { bold: true, size: 12, color: C.teal }); y += 30;
    for (const item of overflow) {
      let remaining = item.content, continuation = false;
      while (remaining) {
        ensure(50);
        put(`${item.label.toUpperCase()}${continuation ? ' (CONTINUACIÓN)' : ''}`, left, y, width, { bold: true, size: 8, color: C.teal }); y += 16;
        const [visible, rest] = fit(remaining, width, bottom - y - 16, 9, 3);
        pdf.font('Helvetica').fontSize(9).fillColor(C.ink).text(visible, left, y, { width, lineGap: 3 });
        y = pdf.y + 16; remaining = rest; continuation = true;
        if (remaining) { pdf.addPage(); y = 36; }
      }
    }
  }
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(i); pdf.moveTo(left, 786).lineTo(left + width, 786).strokeColor(C.line).stroke();
    put(`TransGest · DeCA ${text(d.referencia_pedido)} · v${version} · ${i + 1}/${range.count}`, left, 790, width, { size: 7, color: C.muted });
  }
  pdf.end(); return done;
}

module.exports = { renderDeca, DECA_TEMPLATE_VERSION };
