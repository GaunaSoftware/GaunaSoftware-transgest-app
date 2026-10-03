const GPS_PROVIDERS = ['locatel', 'tacogest', 'movildata', 'geotab', 'gps_generic'];
function assignedGps(vehicle) {
  const provider = String(vehicle?.gps_provider || '').trim().toLowerCase();
  return GPS_PROVIDERS.includes(provider) ? provider : null;
}
function positionSource(vehicle) { return assignedGps(vehicle) || 'app_chofer'; }
function canAutoLink(vehicle, provider) {
  // An explicit app/manual choice and another GPS assignment are preserved.
  return !vehicle.gps_provider || vehicle.gps_provider === provider;
}
function uniqueIndex(rows, keyFor) {
  const index=new Map(),duplicates=new Set();
  for(const row of rows) { const key=keyFor(row);if(!key)continue;if(index.has(key))duplicates.add(key);else index.set(key,row); }
  for(const key of duplicates)index.delete(key);
  return index;
}
module.exports = { GPS_PROVIDERS, assignedGps, positionSource, canAutoLink, uniqueIndex };
