const HOST = 'my.geotab.com';
const HOST_RE = /^(?:[a-z0-9-]+\.)*geotab\.com$/i;

function credentials(secret) {
  let value;
  try { value = JSON.parse(secret); } catch { throw Object.assign(Error('Configura Geotab como JSON con database, userName y password.'),{status:400}); }
  const database = String(value?.database || '').trim();
  const userName = String(value?.userName || value?.username || '').trim();
  const password = String(value?.password || '');
  if (!database || !userName || !password) throw Object.assign(Error('Faltan database, userName o password de Geotab.'),{status:400});
  return { database, userName, password };
}

function safeHost(path) {
  let host = String(path || HOST).trim().toLowerCase();
  if (host === 'thisserver') return HOST;
  if (host.startsWith('https://')) {
    let parsed;
    try { parsed = new URL(host); } catch { parsed = null; }
    if (!parsed || parsed.username || parsed.password || parsed.port ||
        !['','/','/apiv1'].includes(parsed.pathname) || parsed.search || parsed.hash) {
      throw Object.assign(Error('Geotab devolvió un servidor no autorizado.'),{status:502});
    }
    host = parsed.hostname;
  }
  if (!HOST_RE.test(host) || host.length > 150) throw Object.assign(Error('Geotab devolvió un servidor no autorizado.'),{status:502});
  return host;
}

async function call(host, method, params, transport = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await transport(`https://${safeHost(host)}/apiv1`, {
      method:'POST', headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify({method,params}), signal:controller.signal,
    });
    if (!response.ok) throw Object.assign(Error(`Geotab no respondió a ${method} (HTTP ${response.status}).`),{status:502});
    const payload = await response.json();
    if (payload?.error) throw Object.assign(Error(`Geotab rechazó ${method}. Comprueba el usuario, permisos y base de datos.`),{status:502});
    return payload?.result;
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(Error('Geotab no respondió en 15 segundos.'),{status:504});
    throw error;
  } finally { clearTimeout(timeout); }
}

async function snapshot(secret, transport = fetch) {
  const auth = await call(HOST,'Authenticate',credentials(secret),transport);
  if (!auth?.credentials?.sessionId) throw Object.assign(Error('Geotab no devolvió una sesión válida.'),{status:502});
  const host = auth.path && String(auth.path).toLowerCase() !== 'thisserver' ? safeHost(auth.path) : HOST;
  const deviceCredentials = auth.credentials;
  const [devices,statuses] = await Promise.all([
    call(host,'Get',{typeName:'Device',resultsLimit:5000,credentials:deviceCredentials},transport),
    call(host,'Get',{typeName:'DeviceStatusInfo',resultsLimit:5000,credentials:deviceCredentials},transport),
  ]);
  if (!Array.isArray(devices) || !Array.isArray(statuses)) throw Object.assign(Error('Geotab devolvió datos de vehículos no válidos.'),{status:502});
  if (devices.length >= 5000 || statuses.length >= 5000) throw Object.assign(Error('La flota supera el límite de una consulta Geotab; se necesita paginación antes de sincronizar.'),{status:422});
  return {devices,statuses};
}

function plate(value) { return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
function deviceId(status) { return String(status?.device?.id || status?.device || ''); }
function positions(snapshotData, vehicles) {
  const byId = new Map(snapshotData.devices.map(d => [String(d.id||''),d]).filter(([id])=>id));
  const externalCounts = new Map();
  for (const vehicle of vehicles.filter(v => v.gps_provider === 'geotab' && v.gps_external_id)) {
    const key=String(vehicle.gps_external_id); externalCounts.set(key,(externalCounts.get(key)||0)+1);
  }
  const byExternal = new Map(vehicles.filter(v => v.gps_provider === 'geotab' && v.gps_external_id && externalCounts.get(String(v.gps_external_id))===1)
    .map(v => [String(v.gps_external_id),v]));
  const plateCounts = new Map();
  for (const vehicle of vehicles) { const key=plate(vehicle.matricula);if(key)plateCounts.set(key,(plateCounts.get(key)||0)+1); }
  const devicePlateCounts = new Map();
  for (const device of snapshotData.devices) { const key=plate(device.licensePlate);if(key)devicePlateCounts.set(key,(devicePlateCounts.get(key)||0)+1); }
  const byPlate = new Map(vehicles.filter(v => plateCounts.get(plate(v.matricula))===1 &&
    !(v.gps_provider === 'geotab' && v.gps_external_id))
    .map(v => [plate(v.matricula),v]));
  const output=[]; let unmatched=0;
  for (const status of snapshotData.statuses) {
    const id=deviceId(status), device=byId.get(id);
    if (!device) { unmatched++; continue; }
    const devicePlate=plate(device.licensePlate);
    const vehicle=byExternal.get(id) || (devicePlateCounts.get(devicePlate)===1 ? byPlate.get(devicePlate) : null);
    const lat=Number(status.latitude),lng=Number(status.longitude);
    const recordedAt=Date.parse(status.dateTime);
    if (!vehicle || !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat)>90 || Math.abs(lng)>180 || !Number.isFinite(recordedAt) ||
        recordedAt>Date.now()+60000) { unmatched++; continue; }
    output.push({vehicle,deviceId:id,lat,lng,recordedAt:new Date(recordedAt).toISOString(),
      speed:Number.isFinite(Number(status.speed)) && Number(status.speed)>=0 ? Number(status.speed) : null,
      bearing:Number.isFinite(Number(status.bearing)) ? Number(status.bearing) : null});
  }
  return {positions:output,unmatched};
}

module.exports={credentials,safeHost,call,snapshot,positions};
