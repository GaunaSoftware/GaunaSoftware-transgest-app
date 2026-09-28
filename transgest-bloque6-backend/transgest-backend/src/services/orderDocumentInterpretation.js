const plain = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

const clipped = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function supported(value, source) {
  const needle = plain(value);
  return needle.length >= 4 && plain(source).includes(needle);
}

function date(value) {
  const input = clipped(value, 20);
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/) || input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const iso = input.includes('/') ? `${match[3]}-${match[2]}-${match[1]}` : input;
  const parsed = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : '';
}

function time(value) {
  const match = clipped(value, 12).match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function window(value) {
  const times = [...clipped(value, 60).matchAll(/\b\d{1,2}[:.]\d{2}\b/g)].map(match => time(match[0])).filter(Boolean);
  return times.length >= 2 ? `${times[0]}-${times[1]}` : '';
}

function normalizeStop(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const address = clipped(value.direccion || value.address || value.lugar, 300);
  const city = clipped(value.ciudad || value.poblacion || value.localidad, 100);
  const name = clipped(value.cliente_nombre || value.nombre, 140);
  if (!address && !city && !name) return null;
  return {
    tipo: kind,
    cliente_nombre: name,
    direccion: address,
    ciudad: city,
    provincia: clipped(value.provincia, 100),
    codigo_postal: clipped(value.codigo_postal || value.cp, 15),
    pais: clipped(value.pais, 80) || 'España',
    fecha: date(value.fecha),
    hora: time(value.hora),
    ventana: window(value.ventana),
  };
}

function stopSupported(stop, source) {
  const firstAddressPart = stop.direccion.split(',')[0];
  return [stop.cliente_nombre, firstAddressPart, stop.ciudad, stop.codigo_postal]
    .some(value => supported(value, source));
}

function dateSupported(iso, source) {
  if (!iso) return true;
  const [year, month, day] = iso.split('-');
  return [iso, `${day}/${month}/${year}`, `${day}/${month}/${year.slice(2)}`,
    `${day}-${month}-${year}`, `${day}.${month}.${year}`, `${day}.${month}.${year.slice(2)}`]
    .some(value => String(source).includes(value));
}

function reviewDocumentInterpretation(ai = {}, sourceText = '', { readableText = false } = {}) {
  const patch = {};
  const issues = [];
  const warnings = [];
  let rejectClient = false;
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return { patch, issues, warnings, rejectClient };

  const kind = plain(ai.tipo_documento).toLowerCase();
  if (kind && !['ordentransporte', 'ordendetransporte', 'ordencarga', 'ordendecarga', 'transportorder', 'booking', 'emailtransporte'].includes(kind)) {
    issues.push({ key:'tipo_documento', severity:'alta', message:'El documento no se identifica claramente como una orden de transporte. Comprueba su propósito antes de crear un pedido.' });
  }
  if (Number(ai.numero_pedidos_detectados) > 1) {
    issues.push({ key:'varios_pedidos', severity:'alta', message:'El documento parece contener varias órdenes. Revísalas por separado para no mezclar clientes ni paradas.' });
    return { patch, issues, warnings, rejectClient:true };
  }

  const customer = clipped(ai.cliente_nombre || ai.contratante_nombre, 140);
  const customerTaxId = clipped(ai.cliente_cif || ai.contratante_cif, 30);
  const carrier = clipped(ai.transportista_nombre || ai.transportista_efectivo, 140);
  const carrierTaxId = clipped(ai.transportista_cif, 30);
  const sameParty = customer && carrier && plain(customer) === plain(carrier);
  const customerSupported = !readableText ||
    ((!customer || supported(customer, sourceText)) && (!customerTaxId || supported(customerTaxId, sourceText)));
  const carrierSupported = !readableText ||
    ((!carrier || supported(carrier, sourceText)) && (!carrierTaxId || supported(carrierTaxId, sourceText)));
  if (sameParty || ((customer || customerTaxId) && !customerSupported)) {
    rejectClient = true;
    issues.push({ key:'cliente_rol', severity:'alta', message:sameParty
      ? 'La IA atribuyó el mismo nombre a cliente y transportista. Selecciona el cliente contractual.'
      : 'El cliente sugerido por la IA no se puede corroborar en el texto del documento. Selecciónalo manualmente.' });
  } else if (customer || customerTaxId) {
    if (customer) patch.cliente_nombre = customer;
    patch.cliente_cif = customerTaxId || '';
  }
  if (carrier && carrierSupported) patch.transportista_detectado = carrier;
  else if (carrier) warnings.push({ key:'transportista_no_verificado', severity:'media', message:'El transportista sugerido no se puede corroborar en el documento.' });
  if (!readableText && (customer || carrier)) {
    issues.push({ key:'documento_visual', severity:'alta', message:'Los roles se han leído de una imagen sin texto verificable. Confirma cliente y transportista antes de guardar.' });
  }

  for (const [field, kind, label] of [
    ['puntos_carga', 'carga', 'recogida'], ['puntos_descarga', 'descarga', 'entrega'],
  ]) {
    if (!Array.isArray(ai[field])) continue;
    if (ai[field].length > 20) {
      issues.push({ key:field, severity:'alta', message:`El documento contiene demasiados puntos de ${label}. Revísalos por separado.` });
      continue;
    }
    const stops = ai[field].map(value => normalizeStop(value, kind)).filter(Boolean);
    if (readableText && stops.some(stop => !dateSupported(stop.fecha, sourceText))) {
      issues.push({ key:`${field}_fecha`, severity:'alta', message:`Alguna fecha de ${label} no se puede corroborar en el documento. Revisa el horario.` });
      continue;
    }
    const verified = readableText ? stops.filter(stop => stopSupported(stop, sourceText)) : stops;
    if (verified.length !== ai[field].length) {
      issues.push({ key:field, severity:'alta', message:`Algún punto de ${label} propuesto por la IA no aparece en el texto. Revisa la ruta completa.` });
    }
    if (verified.length && verified.length === ai[field].length) {
      patch[field] = verified;
      const first = verified[0];
      patch[kind === 'carga' ? 'origen' : 'destino'] = (first.ciudad || first.direccion || first.cliente_nombre).toUpperCase();
      patch[kind === 'carga' ? 'fecha_carga' : 'fecha_descarga'] = first.fecha;
      patch[kind === 'carga' ? 'hora_carga' : 'hora_descarga'] = first.hora;
    }
  }

  for (const [field, aiValue] of [['origen', ai.origen], ['destino', ai.destino]]) {
    if (patch[field] || !clipped(aiValue)) continue;
    if (!readableText || supported(aiValue, sourceText)) patch[field] = clipped(aiValue, 140).toUpperCase();
    else warnings.push({ key:field, severity:'media', message:`La ${field === 'origen' ? 'recogida' : 'entrega'} sugerida no se puede corroborar en el texto.` });
  }
  for (const field of ['fecha_carga', 'fecha_descarga']) {
    if (patch[field]) continue;
    const value = date(ai[field]);
    if (value && (!readableText || dateSupported(value, sourceText))) patch[field] = value;
  }
  return { patch, issues, warnings, rejectClient };
}

module.exports = { reviewDocumentInterpretation, normalizeStop, supported };
