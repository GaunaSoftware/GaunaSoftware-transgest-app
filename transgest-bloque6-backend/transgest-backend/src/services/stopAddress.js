// A document uses the location saved on its order, never the client's fiscal
// address or an inferred locality. Already formatted addresses stay idempotent.
function fullStopAddress(stop = {}) {
  const street = String(stop.direccion || stop.address || '').trim();
  const postal = String(stop.codigo_postal || stop.cp || stop.postal_code || '').trim();
  const city = String(stop.ciudad || stop.poblacion || stop.localidad || '').trim();
  const province = String(stop.provincia || stop.region || '').trim();
  const country = String(stop.pais || stop.country || '').trim();
  if (!street && !city && !postal) return '';
  const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const address = ` ${fold(street)} `;
  const has = value => value && address.includes(` ${fold(value)} `);
  // A street named "Calle Murcia" does not mean that the locality Murcia
  // already appears. Recognize locality components, including postcode + city.
  const components = street.split(/[,;\n]/).map(fold);
  const hasPlace = value => value && components.some(component => component === fold(value)
    || (postal && component === fold(`${postal} ${value}`)));
  const locality = [has(postal) ? '' : postal, hasPlace(city) ? '' : city].filter(Boolean).join(' ');
  return [street, locality, province && fold(province) !== fold(city) && !hasPlace(province) ? province : '',
    country && !has(country) ? country : ''].filter(Boolean).join(', ');
}

// The order editor stores a selected point's business name as cliente_nombre.
// Keep it separate from the address and the order's invoicing customer.
function stopPointName(stop = {}) {
  return String(stop.nombre || stop.name || stop.cliente_nombre || stop.clienteNombre || '').trim();
}

module.exports = { fullStopAddress, stopPointName };
