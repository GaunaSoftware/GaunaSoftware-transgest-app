const pdfParse = require('pdf-parse');

const normal = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const taxId = value => normal(value).toUpperCase().replace(/^(?:ES)[\s-]*/, '').replace(/[^A-Z0-9]/g, '');

function dateEs(value) {
  const match = String(value || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!match) return '';
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const date = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? '' : date;
}

function moneyEs(value) {
  const match = String(value || '').match(/\d[\d.,]*/);
  if (!match) return null;
  const normalized = match[0].includes(',') ? match[0].replace(/\./g, '').replace(',', '.') : match[0];
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function label(items, pattern, range = {}) {
  return items.find(item => pattern.test(normal(item.text)) &&
    (range.top == null || item.y <= range.top) &&
    (range.bottom == null || item.y > range.bottom));
}

function rightOf(items, source, minX, maxX, maxDeltaY = 5) {
  if (!source) return '';
  return items.filter(item => item !== source && item.x >= minX && item.x < maxX &&
    Math.abs(item.y - source.y) <= maxDeltaY && item.text.trim())
    .sort((a, b) => a.x - b.x)[0]?.text.trim() || '';
}

function party(items, role, nextRole, width) {
  const name = rightOf(items, role, role.x + 40, width * .66);
  const nif = label(items, /^NIF\s*:?$/i, { top: role.y - 4, bottom: nextRole?.y ?? role.y - 60 });
  return { name, cif: taxId(rightOf(items, nif, (nif?.x || 0) + 20, width)) };
}

function stop(items, role, nextRole, width) {
  const block = items.filter(item => item.y <= role.y + 5 && item.y > (nextRole?.y ?? role.y - 115) + 4);
  const value = (pattern, min, max) => {
    const source = label(block, pattern);
    return rightOf(block, source, width * min, width * max);
  };
  const kind = normal(value(/^R\s*\/\s*E\s*:?$/i, .10, .25)).toUpperCase();
  if (!/^(RECOGIDA|ENTREGA)$/.test(kind)) return null;
  const name = value(/^Nombre\s*:?$/i, .35, 1);
  const street = value(/^Direcci[oó]n\s*:?$/i, .35, 1);
  const postalRaw = value(/^Pa[ií]s\s*\/\s*CP\s*:?$/i, .35, .53);
  const cityRaw = value(/^Poblaci[oó]n\s*:?$/i, .60, 1);
  const cityParts = cityRaw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const city = (cityParts?.[1] || cityRaw).trim();
  const province = (cityParts?.[2] || '').trim();
  const postal = postalRaw.match(/\b\d{5}\b/)?.[0] || '';
  const address = [street, [postal, city].filter(Boolean).join(' '), province].filter(Boolean).join(', ');
  const windowRaw = value(/^Hora\s*:?$/i, .10, .25);
  const times = [...windowRaw.matchAll(/\b\d{1,2}[:.]\d{2}\b/g)].map(match => match[0].replace('.', ':'));
  const weight = moneyEs(value(/^Peso\s*:?$/i, .35, .53));
  return {
    kind,
    point: {
      tipo: kind === 'RECOGIDA' ? 'carga' : 'descarga',
      cliente_nombre: name, direccion: address.toUpperCase(), ciudad: city.toUpperCase(),
      provincia: province.toUpperCase(), codigo_postal: postal, pais: 'España',
      fecha: dateEs(value(/^Fecha\s*:?$/i, .10, .25)), hora: times[0] || '',
      ventana: times.length >= 2 ? `${times[0]}-${times[1]}` : '',
    },
    weight,
  };
}

function parsePage(page) {
  const { items, width } = page;
  const contractual = label(items, /^Carg\.?\s*Cont\.?$/i);
  const effective = label(items, /^Tta\.?\s*Efectivo\s*$/i);
  const roles = items.filter(item => /^R\s*\/\s*E\s*:?$/i.test(normal(item.text)))
    .sort((a, b) => b.y - a.y);
  if (!contractual || !effective || contractual.y <= effective.y || !roles.length) return null;
  const customer = party(items, contractual, effective, width);
  const carrier = party(items, effective, roles[0], width);
  const parsedStops = roles.map((role, index) => stop(items, role, roles[index + 1], width)).filter(Boolean);
  const loads = parsedStops.filter(entry => entry.kind === 'RECOGIDA').map(entry => entry.point);
  const unloads = parsedStops.filter(entry => entry.kind === 'ENTREGA').map(entry => entry.point);
  if (!customer.name || !carrier.name || !loads.length || !unloads.length || !loads[0].ciudad || !unloads[0].ciudad) return null;
  const priceLabel = label(items, /^Precio\s*$/i, { top: effective.y, bottom: roles[0].y });
  const goodsLabel = label(items, /^Mercanc[ií]a\s*$/i, { top: effective.y, bottom: roles[0].y });
  const price = moneyEs(rightOf(items, priceLabel, width * .55, width * .69));
  const weight = parsedStops.find(entry => entry.kind === 'RECOGIDA' && entry.weight)?.weight || null;
  return {
    customer: customer.name, customerTaxId: customer.cif, carrier: carrier.name,
    origin: loads[0].ciudad, destination: unloads[0].ciudad,
    loads, unloads, weightKg: weight, goods: rightOf(items, goodsLabel, width * .72, width),
    price,
  };
}

async function extractTabularLoadOrderPdf(buffer) {
  const pages = [];
  await pdfParse(buffer, { max: 3, pagerender: async page => {
    const text = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    pages.push({ width: page.view[2] - page.view[0], items: text.items.slice(0, 6000).map(item => ({
      text: String(item.str || '').trim(), x: item.transform[4], y: item.transform[5],
    })).filter(item => item.text) });
    return '';
  } });
  return pages.map(parsePage).find(Boolean) || null;
}

function applyTabularLoadOrder(draft, order) {
  if (!order) return draft;
  const firstLoad = order.loads[0], firstUnload = order.unloads[0];
  return {
    ...draft,
    cliente_nombre: order.customer, cliente_cif: order.customerTaxId,
    transportista_detectado: order.carrier,
    origen: order.origin, destino: order.destination,
    puntos_carga: order.loads, puntos_descarga: order.unloads,
    fecha_carga: firstLoad.fecha, hora_carga: firstLoad.hora,
    fecha_descarga: firstUnload.fecha, hora_descarga: firstUnload.hora,
    mercancia: order.goods || '', peso_kg: order.weightKg,
    bultos: null, referencia_cliente: null, matricula_detectada: '',
    tipo_precio: 'viaje', precio_unitario: order.price, importe: order.price,
    cantidad: null, minimo_unidades: null, importe_minimo: null,
    _tarifa_unitaria_detectada: false, _origen_estructurado: 'orden_carga_pdf',
  };
}

module.exports = { extractTabularLoadOrderPdf, applyTabularLoadOrder, parsePage, dateEs, moneyEs, taxId };
