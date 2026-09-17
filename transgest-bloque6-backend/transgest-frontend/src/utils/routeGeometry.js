// HERE flexible polyline v1: https://github.com/heremaps/flexible-polyline
export function decodeFlexiblePolyline(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let index = 0;
  function integer() {
    let value = 0, factor = 1;
    while (index < encoded.length) {
      const digit = alphabet.indexOf(encoded[index++]);
      if (digit < 0 || factor > 2 ** 50) throw new Error('Invalid polyline');
      value += (digit & 31) * factor;
      if (!Number.isSafeInteger(value)) throw new Error('Invalid polyline');
      if (!(digit & 32)) return value;
      factor *= 32;
    }
    throw new Error('Truncated polyline');
  }
  const delta = () => { const n = integer(); return n % 2 ? -(n + 1) / 2 : n / 2; };
  if (integer() !== 1) throw new Error('Unsupported polyline version');
  const header = integer(), scale = 10 ** (header & 15), third = (header >> 4) & 7;
  let lat = 0, lng = 0;
  const points = [];
  while (index < encoded.length) {
    lat += delta(); lng += delta();
    if (third) delta();
    points.push({ lat: lat / scale, lng: lng / scale });
  }
  return points;
}

export function routeGeometry(geometry) {
  try {
    const points = geometry?.type === 'LineString'
      ? geometry.coordinates.map(([lng, lat]) => ({ lng, lat }))
      : Array.isArray(geometry) && geometry.every(p => typeof p === 'string')
        ? geometry.flatMap(decodeFlexiblePolyline) : [];
    return points.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) ? points : [];
  } catch (_) { return []; }
}
