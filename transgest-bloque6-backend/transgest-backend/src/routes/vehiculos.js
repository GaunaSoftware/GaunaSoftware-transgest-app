const { cacheMiddleware } = require("../services/cache");
const express = require("express");
const db = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const { resolveApiKey, recordApiUsage } = require("../services/apiKeys");

const r1 = express.Router();
r1.use(authenticate);

const GPS_PROVIDERS = {
  locatel: "Locatel",
  tacogest: "Tacogest",
  movildata: "Movildata",
  gps_generic: "GPS generico",
  manual: "Manual / fallback",
  ultima_descarga: "Ultima descarga",
  app_chofer: "App chofer",
};
const GPS_REMOTE_PROVIDERS = ["locatel", "tacogest", "movildata", "gps_generic"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

function normalizePlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseMovildataLoc(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};
  const direct = raw.split(/[;|]/).map(v => Number(String(v).trim().replace(",", ".")));
  if (direct.length >= 2 && Number.isFinite(direct[0]) && Number.isFinite(direct[1])) return { lat: direct[0], lng: direct[1] };
  const commaParts = raw.split(",").map(v => v.trim());
  if (commaParts.length === 2) {
    const lat = Number(commaParts[0]);
    const lng = Number(commaParts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const numbers = raw.match(/-?\d+(?:[.,]\d+)?/g)?.map(v => Number(v.replace(",", "."))) || [];
  if (numbers.length >= 2 && Number.isFinite(numbers[0]) && Number.isFinite(numbers[1])) return { lat: numbers[0], lng: numbers[1] };
  return {};
}

function listFromProviderPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.Items)) return payload.Items;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.Result)) return payload.Result;
  if (Array.isArray(payload?.vehiculos)) return payload.vehiculos;
  if (Array.isArray(payload?.Vehiculos)) return payload.Vehiculos;
  if (Array.isArray(payload?.vehicles)) return payload.vehicles;
  if (Array.isArray(payload?.Vehicles)) return payload.Vehicles;
  if (Array.isArray(payload?.lastLocations)) return payload.lastLocations;
  if (Array.isArray(payload?.LastLocations)) return payload.LastLocations;
  if (Array.isArray(payload?.response?.data)) return payload.response.data;
  if (Array.isArray(payload?.response?.items)) return payload.response.items;
  if (Array.isArray(payload?.d?.data)) return payload.d.data;
  if (Array.isArray(payload?.d?.items)) return payload.d.items;
  return payload && typeof payload === "object" ? [payload] : [];
}

function readFirst(item = {}, keys = []) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") return item[key];
  }
  return "";
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function movildataPositionFromItem(item = {}) {
  const loc = parseMovildataLoc(item.Loc ?? item.loc ?? item.localizacion ?? item.posicion ?? item.position);
  const lat = numberFrom(readFirst(item, ["Latitud", "latitud", "Latitude", "latitude", "Lat", "lat", "Y", "y"])) ?? loc.lat ?? null;
  const lng = numberFrom(readFirst(item, ["Longitud", "longitud", "Longitude", "longitude", "Lng", "lng", "Lon", "lon", "X", "x"])) ?? loc.lng ?? null;
  return {
    plate: readFirst(item, ["Matricula", "Matrícula", "matricula", "plate", "Plate", "registration", "Registration", "vehiclePlate"]),
    imei: readFirst(item, ["Imei", "IMEI", "imei", "idv", "IDV", "Idv", "IdDispositivo", "idDispositivo", "deviceId", "DeviceId", "id", "Id"]),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    velocidad: readFirst(item, ["Veloc", "veloc", "velocidad", "Velocidad", "speed", "Speed"]),
    odometro: readFirst(item, ["Odometro", "odometro", "Odometer", "odometer", "Km", "km", "kilometros"]),
    recorded_at: readFirst(item, ["Fecha", "fecha", "f", "F", "date", "Date", "recorded_at", "timestamp", "Timestamp", "UtcDate"]),
    ubicacion: readFirst(item, ["Direccion", "direccion", "Poblacion", "poblacion", "Ubicacion", "ubicacion", "address", "Address", "dir", "Dir"]),
    raw: item,
  };
}

function movildataVehicleFromItem(item = {}) {
  const plate = readFirst(item, ["Matricula", "Matrícula", "matricula", "plate", "Plate", "registration", "Registration", "vehiclePlate"]);
  const imei = readFirst(item, ["Imei", "IMEI", "imei", "IdDispositivo", "idDispositivo", "deviceId", "DeviceId", "id", "Id"]);
  const alias = readFirst(item, ["Alias", "alias", "Nombre", "nombre", "Name", "name", "descripcion", "Descripcion"]);
  return {
    plate: String(plate || "").trim(),
    imei: String(imei || "").trim(),
    alias: String(alias || "").trim(),
    raw: item,
  };
}

function uniqueMovildataPositions(positions = []) {
  const byKey = new Map();
  for (const pos of positions) {
    if (pos.lat == null || pos.lng == null) continue;
    const key = String(pos.imei || pos.plate || `${pos.lat},${pos.lng},${pos.recorded_at || ""}`).trim().toUpperCase();
    if (!byKey.has(key)) byKey.set(key, pos);
  }
  return Array.from(byKey.values());
}

function isMovildataAuthError(message = "") {
  const text = String(message || "").toLowerCase();
  return text.includes("deneg") || text.includes("autoriz") || text.includes("unauthorized") || text.includes("forbidden") || text.includes("401") || text.includes("403");
}

async function requestMovildata(path, apiKey, params = {}) {
  const url = new URL(path, "https://mapi.movildata.com/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("apiKey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw_text: text }; }
  if (!res.ok) {
    const err = new Error(data?.Message || data?.message || data?.error || `Movildata respondio HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  return data;
}

async function requestMovildataLastLocationForVehicle(apiKey, vehicle = {}) {
  const attempts = [];
  if (vehicle.external_id) attempts.push(["Users/GetLastLocation", { imei: vehicle.external_id }]);
  if (vehicle.external_id) attempts.push(["Users/GetLastLocationWithGPS", { imei: vehicle.external_id }]);
  if (vehicle.matricula) attempts.push(["Users/GetLastLocationPlate", { plate: vehicle.matricula }]);
  if (vehicle.matricula) {
    const today = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    attempts.push(["Users/GetGPSData", {
      matricula: vehicle.matricula,
      desde: yesterday.toISOString().slice(0, 10),
      hasta: today.toISOString().slice(0, 10),
    }]);
  }
  const errors = [];
  for (const [path, params] of attempts) {
    try {
      const payload = await requestMovildata(path, apiKey, params);
      const positions = listFromProviderPayload(payload)
        .map(item => {
          const pos = movildataPositionFromItem(item);
          return {
            ...pos,
            imei: pos.imei || vehicle.external_id || "",
            plate: pos.plate || vehicle.matricula || "",
          };
        })
        .filter(p => p.lat != null && p.lng != null);
      if (positions.length) return { positions: positions.slice(-1), errors };
    } catch (e) {
      errors.push(e.message || `No se pudo consultar ${path}`);
    }
  }
  return { positions: [], errors };
}

function summarizeRemoteVehicle(remote) {
  return {
    matricula: remote.plate || "",
    external_id: remote.imei || remote.plate || "",
    alias: remote.alias || "",
  };
}

async function syncMovildataVehicleLinks(empresaId, apiKey) {
  const { rows: vehiculos } = await db.query(
    `SELECT id, matricula, gps_provider, gps_external_id
     FROM vehiculos
     WHERE empresa_id=$1 AND activo IS DISTINCT FROM false`,
    [empresaId]
  );
  if (!vehiculos.length) return { linked: 0, receivedVehicles: 0 };
  const byPlate = new Map(vehiculos.map(v => [normalizePlate(v.matricula), v]).filter(([k]) => k));
  const payload = await requestMovildata("Users/GetVehiculos", apiKey);
  const remoteVehicles = listFromProviderPayload(payload).map(movildataVehicleFromItem).filter(v => v.plate || v.imei);
  let linked = 0;
  const matched = [];
  const unmatched = [];
  for (const remote of remoteVehicles) {
    const vehiculo = byPlate.get(normalizePlate(remote.plate));
    if (!vehiculo) {
      unmatched.push(summarizeRemoteVehicle(remote));
      continue;
    }
    const externalId = remote.imei || remote.plate || vehiculo.matricula;
    matched.push({ matricula: vehiculo.matricula, external_id: externalId || "", alias: remote.alias || "" });
    if (vehiculo.gps_provider === "movildata" && String(vehiculo.gps_external_id || "") === String(externalId || "")) continue;
    await db.query(
      `UPDATE vehiculos
       SET gps_provider='movildata',
           gps_external_id=$1,
           ubicacion_fuente='movildata',
           updated_at=NOW()
       WHERE id=$2 AND empresa_id=$3`,
      [externalId || null, vehiculo.id, empresaId]
    );
    await logVehiculoEvento({
      empresaId,
      vehiculoId: vehiculo.id,
      tipo: "vehiculo.gps_link",
      actorId: null,
      detalle: {
        matricula: vehiculo.matricula,
        provider: "movildata",
        external_id: externalId || null,
        source: "movildata_sync",
      },
    }).catch(() => {});
    linked += 1;
  }
  return { linked, receivedVehicles: remoteVehicles.length, matched, unmatched };
}

async function syncMovildataPositions(empresaId, apiKey) {
  const { rows: vehiculos } = await db.query(
    `SELECT id, matricula, gps_provider, gps_external_id
     FROM vehiculos
     WHERE empresa_id=$1 AND activo IS DISTINCT FROM false`,
    [empresaId]
  );
  if (!vehiculos.length) return { updated: 0, received: 0, unmatched: 0 };
  const byPlate = new Map(vehiculos.map(v => [normalizePlate(v.matricula), v]).filter(([k]) => k));
  const byExternal = new Map(vehiculos.map(v => [String(v.gps_external_id || "").trim().toUpperCase(), v]).filter(([k]) => k));
  const linkResult = await syncMovildataVehicleLinks(empresaId, apiKey).catch((e) => ({ linked: 0, receivedVehicles: 0, matched: [], unmatched: [], link_error: e.message }));
  if (linkResult.linked) {
    const refreshed = await db.query(
      `SELECT id, matricula, gps_provider, gps_external_id
       FROM vehiculos
       WHERE empresa_id=$1 AND activo IS DISTINCT FROM false`,
      [empresaId]
    );
    byExternal.clear();
    refreshed.rows.forEach(v => {
      const ext = String(v.gps_external_id || "").trim().toUpperCase();
      if (ext) byExternal.set(ext, v);
    });
  }
  let payload = null;
  let positionsError = null;
  try {
    payload = await requestMovildata("Users/GetLastLocations", apiKey, { direcciones: "true" });
  } catch (e) {
    positionsError = e.message || "Movildata no devolvio posiciones.";
  }
  let positions = positionsError
    ? []
    : listFromProviderPayload(payload).map(movildataPositionFromItem).filter(p => p.lat != null && p.lng != null);
  const fallbackErrors = [];
  if (!positions.length && Array.isArray(linkResult.matched) && linkResult.matched.length) {
    const fallbackPositions = [];
    for (const vehicle of linkResult.matched.slice(0, 120)) {
      const fallback = await requestMovildataLastLocationForVehicle(apiKey, vehicle);
      fallbackPositions.push(...fallback.positions);
      fallbackErrors.push(...fallback.errors);
    }
    if (fallbackPositions.length) {
      positions = uniqueMovildataPositions(fallbackPositions);
      positionsError = null;
    }
  }
  if (positionsError && !positions.length) {
    const authError = isMovildataAuthError(positionsError) || fallbackErrors.some(isMovildataAuthError);
    return {
      updated: 0,
      received: 0,
      unmatched: 0,
      linked: linkResult.linked || 0,
      receivedVehicles: linkResult.receivedVehicles || 0,
      matchedVehicles: linkResult.matched || [],
      unmatchedVehicles: linkResult.unmatched || [],
      link_error: linkResult.link_error || null,
      positions_error: positionsError,
      fallback_errors: fallbackErrors.slice(0, 5),
      auth_error: authError,
      no_signal: !authError,
    };
  }
  let updated = 0;
  let unmatched = 0;
  for (const pos of positions) {
    const vehiculo = byExternal.get(String(pos.imei || "").trim().toUpperCase())
      || byExternal.get(String(pos.plate || "").trim().toUpperCase())
      || byPlate.get(normalizePlate(pos.plate));
    if (!vehiculo) { unmatched += 1; continue; }
    await updateVehiclePosition({
      empresaId,
      vehiculoId: vehiculo.id,
      provider: "movildata",
      externalId: pos.imei || pos.plate || vehiculo.gps_external_id || vehiculo.matricula,
      lat: pos.lat,
      lng: pos.lng,
      ubicacion: pos.ubicacion,
      velocidad: pos.velocidad,
      odometro: pos.odometro,
      raw: { source: "movildata_sync", payload: pos.raw },
      recordedAt: pos.recorded_at,
    });
    updated += 1;
  }
  return {
    updated,
    received: positions.length,
    unmatched,
    linked: linkResult.linked || 0,
    receivedVehicles: linkResult.receivedVehicles || 0,
    matchedVehicles: linkResult.matched || [],
    unmatchedVehicles: linkResult.unmatched || [],
    link_error: linkResult.link_error || null,
    positions_error: null,
    fallback_used: !listFromProviderPayload(payload).map(movildataPositionFromItem).filter(p => p.lat != null && p.lng != null).length && positions.length > 0,
    fallback_errors: fallbackErrors.slice(0, 5),
    auth_error: false,
    no_signal: positions.length === 0,
  };
}

async function syncWebhookOnlyProvider(empresaId, provider) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS linked
     FROM vehiculos
     WHERE empresa_id=$1
       AND activo IS DISTINCT FROM false
       AND gps_provider=$2
       AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL`,
    [empresaId, provider]
  );
  return {
    updated: 0,
    received: 0,
    unmatched: 0,
    linked: Number(rows[0]?.linked || 0),
    webhook_only: true,
  };
}

async function getActiveGpsProvider(empresaId) {
  if (!empresaId) return "";
  const { rows } = await db.query(
    `SELECT provider
     FROM empresa_api_configs
     WHERE empresa_id=$1 AND provider = ANY($2::varchar[]) AND activo=true
     ORDER BY updated_at DESC
     LIMIT 1`,
    [empresaId, GPS_REMOTE_PROVIDERS]
  );
  return rows[0]?.provider || "";
}

async function getGpsProviderStatuses(empresaId) {
  const activeProvider = await getActiveGpsProvider(empresaId);
  const providers = await Promise.all(
    Object.entries(GPS_PROVIDERS)
      .filter(([id]) => !["ultima_descarga", "app_chofer"].includes(id))
      .map(async ([id, label]) => {
        if (id === "manual") return { id, label, configured: true, source: "manual", active: !activeProvider };
        const resolved = await resolveApiKey(empresaId, id).catch(() => ({ key: "", source: "none", config: null }));
        const companyEnabled = !!resolved.key && (resolved.source === "company" || resolved.config?.use_global === true);
        return {
          id,
          label,
          configured: companyEnabled,
          source: resolved.source || "none",
          active: activeProvider ? activeProvider === id : false,
          mode: resolved.config ? (resolved.config.use_global ? "global" : "company") : "default",
          blocked: resolved.source === "disabled",
        };
      })
  );
  const resolvedActive = activeProvider || "";
  return { providers: providers.map(p => ({ ...p, active: resolvedActive ? p.id === resolvedActive : p.active })), activeProvider: resolvedActive };
}

async function assertGpsProviderMatchesCompany(empresaId, provider) {
  if (!GPS_REMOTE_PROVIDERS.includes(provider)) return;
  void empresaId;
}

async function assertGpsExternalIdAvailable(empresaId, vehiculoId, provider, externalId) {
  if (!GPS_REMOTE_PROVIDERS.includes(provider) || !externalId) return;
  const { rows } = await db.query(
    `SELECT id, matricula
     FROM vehiculos
     WHERE empresa_id=$1
       AND id<>$2
       AND gps_provider=$3
       AND UPPER(TRIM(gps_external_id))=UPPER(TRIM($4))
     LIMIT 1`,
    [empresaId, vehiculoId, provider, externalId]
  );
  if (rows[0]) {
    const err = new Error(`El ID GPS "${externalId}" ya esta asociado al vehiculo ${rows[0].matricula}.`);
    err.status = 409;
    throw err;
  }
}

async function updateVehiclePosition({ empresaId, vehiculoId, provider = "manual", externalId = null, lat = null, lng = null, ubicacion = "", velocidad = null, odometro = null, raw = {}, recordedAt = null }) {
  const cleanUbicacion = String(ubicacion || "").trim();
  const safeProvider = GPS_PROVIDERS[provider] ? provider : "gps_generic";
  const { rows } = await db.query(
    `UPDATE vehiculos
     SET ubicacion_actual=COALESCE(NULLIF($1,''), ubicacion_actual),
         ubicacion_fuente=$2,
         ubicacion_ts=COALESCE($3::timestamptz, NOW()),
         gps_lat=COALESCE($4, gps_lat),
         gps_lng=COALESCE($5, gps_lng),
         gps_provider=COALESCE(NULLIF($6,''), gps_provider),
         gps_external_id=COALESCE(NULLIF($7,''), gps_external_id),
         km_actuales=COALESCE($8, km_actuales)
     WHERE id=$9 AND empresa_id=$10
     RETURNING *`,
    [
      cleanUbicacion,
      safeProvider,
      recordedAt || null,
      lat === null || lat === "" ? null : Number(lat),
      lng === null || lng === "" ? null : Number(lng),
      safeProvider,
      externalId || null,
      odometro === null || odometro === "" ? null : Math.round(Number(odometro)),
      vehiculoId,
      empresaId,
    ]
  );
  if (!rows[0]) return null;
  await db.query(
    `INSERT INTO gps_position_log
      (empresa_id,vehiculo_id,provider,external_id,lat,lng,ubicacion,velocidad_kmh,odometro_km,raw,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,COALESCE($11::timestamptz,NOW()))`,
    [
      empresaId,
      vehiculoId,
      safeProvider,
      externalId || rows[0].gps_external_id || null,
      lat === null || lat === "" ? null : Number(lat),
      lng === null || lng === "" ? null : Number(lng),
      cleanUbicacion || null,
      velocidad === null || velocidad === "" ? null : Number(velocidad),
      odometro === null || odometro === "" ? null : Number(odometro),
      JSON.stringify(raw || {}),
      recordedAt || null,
    ]
  ).catch(() => {});
  return rows[0];
}

function normalizeVehiculoBody(body = {}) {
  return {
    matricula: body.matricula,
    marca: body.marca,
    modelo: body.modelo,
    anio: body.anio ?? body["a\u00f1o"] ?? null,
    tipo: body.tipo,
    tara_kg: body.tara_kg,
    carga_max_kg: body.carga_max_kg,
    estado: body.estado,
    km_actuales: body.km_actuales,
    activo: body.activo,
    notas: body.notas,
    chofer_id: body.chofer_id,
    clase: body.clase,
    notas_operacion: body.notas_operacion,
    ubicacion_actual: body.ubicacion_actual,
    ubicacion_fuente: body.ubicacion_fuente,
    gps_provider: body.gps_provider,
    gps_external_id: body.gps_external_id,
    fecha_matriculacion: body.fecha_matriculacion,
    fecha_itv: body.fecha_itv,
    fecha_seguro: body.fecha_seguro,
  };
}

const VEHICULO_EXT_FIELDS = [
  "color", "numero_bastidor", "numero_motor",
  "masa_total_kg", "plazas", "potencia_cv", "cilindrada", "combustible",
  "longitud_mm", "anchura_mm", "altura_mm", "ejes", "velocidad_max_kmh", "homologacion_co2",
  "fecha_compra", "valor_compra", "financiacion", "concesionario", "numero_pedido_compra",
  "fecha_venta", "valor_venta", "comprador",
  "compania_seguro", "numero_poliza",
  "taller_entrada_at", "estado_aux", "estado_aux_updated_at",
];

function extractVehiculoExtData(body = {}) {
  const data = {};
  VEHICULO_EXT_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) data[field] = body[field];
  });
  return data;
}

async function attachVehiculosExt(empresaId, rows = []) {
  if (!empresaId || !Array.isArray(rows) || !rows.length) return rows;
  const { rows: extRows } = await db.query(
    `SELECT vehiculo_id, data
     FROM vehiculos_ext
     WHERE empresa_id=$1`,
    [empresaId]
  ).catch(() => ({ rows: [] }));
  const extMap = new Map(extRows.map(r => [String(r.vehiculo_id), r.data || {}]));
  return rows.map(r => {
    const ext = extMap.get(String(r.id)) || {};
    return {
      ...r,
      anio: r.anio ?? r["año"] ?? null,
      ...ext,
      compania_seguro: ext.compania_seguro ?? ext["compañia_seguro"] ?? null,
    };
  });
}

async function attachVehiculosGpsSnapshot(empresaId, rows = []) {
  if (!empresaId || !Array.isArray(rows) || !rows.length) return rows;
  const vehiculoIds = rows.map(r => String(r.id || "")).filter(Boolean);
  if (!vehiculoIds.length) return rows;
  const { rows: gpsRows } = await db.query(
    `SELECT DISTINCT ON (vehiculo_id)
        vehiculo_id, provider, external_id, lat, lng, ubicacion, odometro_km, velocidad_kmh, recorded_at, created_at
     FROM gps_position_log
     WHERE empresa_id=$1
       AND vehiculo_id = ANY($2::uuid[])
     ORDER BY vehiculo_id, recorded_at DESC, created_at DESC`,
    [empresaId, vehiculoIds]
  ).catch(() => ({ rows: [] }));
  const gpsMap = new Map(gpsRows.map(r => [String(r.vehiculo_id), r]));
  return rows.map((row) => {
    const snap = gpsMap.get(String(row.id));
    if (!snap) return row;
    const snapTs = snap.recorded_at ? new Date(snap.recorded_at).getTime() : 0;
    const rowTs = row.ubicacion_ts ? new Date(row.ubicacion_ts).getTime() : 0;
    const shouldOverlay =
      !row.ubicacion_actual ||
      !row.ubicacion_fuente ||
      !rowTs ||
      (snapTs && snapTs > rowTs);
    if (!shouldOverlay) return row;
    return {
      ...row,
      ubicacion_actual: snap.ubicacion || row.ubicacion_actual || null,
      ubicacion_fuente: snap.provider || row.ubicacion_fuente || row.gps_provider || null,
      ubicacion_ts: snap.recorded_at || row.ubicacion_ts || null,
      gps_lat: snap.lat ?? row.gps_lat ?? null,
      gps_lng: snap.lng ?? row.gps_lng ?? null,
      gps_provider: row.gps_provider || snap.provider || null,
      gps_external_id: row.gps_external_id || snap.external_id || null,
      gps_odometro_km: snap.odometro_km ?? row.gps_odometro_km ?? null,
      gps_velocidad_kmh: snap.velocidad_kmh ?? row.gps_velocidad_kmh ?? null,
    };
  });
}

async function hydrateVehiculos(empresaId, rows = []) {
  const withExt = await attachVehiculosExt(empresaId, rows);
  return attachVehiculosGpsSnapshot(empresaId, withExt);
}

async function upsertVehiculoExt({ empresaId, vehiculoId, data = {}, updatedBy = null }) {
  if (!empresaId || !vehiculoId) return;
  await db.query(
    `INSERT INTO vehiculos_ext (empresa_id, vehiculo_id, data, updated_by, updated_at)
     VALUES ($1,$2,$3::jsonb,$4,NOW())
     ON CONFLICT (vehiculo_id)
     DO UPDATE SET data=$3::jsonb, updated_by=$4, updated_at=NOW()`,
    [empresaId, vehiculoId, JSON.stringify(data || {}), updatedBy]
  ).catch(() => {});
}

async function logVehiculoEvento({ empresaId, vehiculoId, tipo, detalle = {}, actorId = null }) {
  if (!empresaId || !vehiculoId || !tipo) return;
  await db.query(
    `INSERT INTO vehiculo_eventos (empresa_id, vehiculo_id, tipo, actor_id, detalle)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [empresaId, vehiculoId, tipo, actorId, JSON.stringify(detalle || {})]
  ).catch(() => {});
}

async function syncVehiculoStatusAux({ empresaId, vehiculoId, estado, updatedBy = null }) {
  if (!empresaId || !vehiculoId) return;
  const { rows } = await db.query(
    `SELECT data FROM vehiculos_ext WHERE empresa_id=$1 AND vehiculo_id=$2 LIMIT 1`,
    [empresaId, vehiculoId]
  ).catch(() => ({ rows: [] }));
  const current = rows[0]?.data || {};
  const next = {
    ...current,
    estado_aux: estado || current.estado_aux || null,
    estado_aux_updated_at: new Date().toISOString(),
  };
  if (estado === "taller") {
    next.taller_entrada_at = current.taller_entrada_at || new Date().toISOString();
  } else if (current.taller_entrada_at) {
    next.taller_entrada_at = null;
  }
  await upsertVehiculoExt({ empresaId, vehiculoId, data: next, updatedBy });
}

r1.get("/", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { activo } = req.query;
  let q = `SELECT v.*,
             r.matricula AS remolque_matricula, r.marca AS remolque_marca, r.modelo AS remolque_modelo,
             CONCAT(ch.nombre, CASE WHEN ch.apellidos IS NOT NULL AND ch.apellidos != '' THEN ' ' || ch.apellidos ELSE '' END) AS chofer_nombre
           FROM vehiculos v
           LEFT JOIN vehiculos r ON r.id = v.remolque_id
           LEFT JOIN choferes ch ON ch.id = v.chofer_id
           WHERE 1=1`;
  const params = [];
  if (empresaId) { q += " AND v.empresa_id=$" + (params.length + 1); params.push(empresaId); }
  if (activo === "false") {
    q += " AND v.activo=false";
  } else if (activo !== "todos") {
    q += " AND v.activo=true";
  }
  q += " ORDER BY v.matricula";
  const { rows } = await db.query(q, params);
  res.json(await hydrateVehiculos(empresaId, rows));
});

// GET /vehiculos/gps/providers - supported GPS connectors.
r1.get("/gps/providers", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { providers, activeProvider } = await getGpsProviderStatuses(empresaId);
  res.json({ providers, active_provider: activeProvider });
});

r1.get("/gps/status", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { providers, activeProvider } = await getGpsProviderStatuses(empresaId);
    const tractoraFilter = `
      AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%remolque%'
      AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%semirremolque%'
      AND LOWER(COALESCE(clase,tipo,'')) NOT LIKE '%dolly%'
      AND UPPER(COALESCE(matricula,'')) NOT LIKE 'R-%'
      AND UPPER(COALESCE(matricula,'')) NOT LIKE '%-R'
      AND NOT EXISTS (
        SELECT 1
          FROM vehiculos vt
         WHERE vt.empresa_id=vehiculos.empresa_id
           AND vt.remolque_id=vehiculos.id
           AND vt.activo IS DISTINCT FROM false
      )
    `;
    const [counts, duplicates, lastPosition, staleVehicles, webhookRows] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE activo=true)::int AS activos,
           COUNT(*) FILTER (WHERE activo=true AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL)::int AS enlazados,
           COUNT(*) FILTER (WHERE activo=true AND (gps_provider IS NULL OR gps_provider='manual' OR NULLIF(TRIM(gps_external_id),'') IS NULL))::int AS pendientes,
           COUNT(*) FILTER (WHERE activo=true AND ubicacion_ts IS NOT NULL)::int AS con_ubicacion,
           COUNT(*) FILTER (WHERE activo=true AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND ubicacion_ts IS NULL)::int AS nunca_senal,
           COUNT(*) FILTER (WHERE activo=true AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND ubicacion_ts >= NOW()-INTERVAL '6 hours')::int AS senal_reciente,
           COUNT(*) FILTER (WHERE activo=true AND gps_provider IS NOT NULL AND gps_provider <> 'manual' AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND (ubicacion_ts IS NULL OR ubicacion_ts < NOW()-INTERVAL '6 hours'))::int AS sin_senal_reciente
         FROM vehiculos
         WHERE empresa_id=$1
         ${tractoraFilter}`,
        [empresaId]
      ),
      db.query(
        `SELECT gps_provider, UPPER(TRIM(gps_external_id)) AS gps_external_id, COUNT(*)::int AS total,
                ARRAY_AGG(matricula ORDER BY matricula) AS matriculas
         FROM vehiculos
         WHERE empresa_id=$1
           ${tractoraFilter}
           AND gps_provider IS NOT NULL
           AND gps_provider <> 'manual'
           AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL
         GROUP BY gps_provider, UPPER(TRIM(gps_external_id))
         HAVING COUNT(*) > 1
         ORDER BY total DESC, gps_provider`,
        [empresaId]
      ),
      db.query(
        `SELECT l.vehiculo_id, v.matricula, l.provider, l.ubicacion, l.lat, l.lng, l.recorded_at
         FROM gps_position_log l
         LEFT JOIN vehiculos v ON v.id=l.vehiculo_id AND v.empresa_id=l.empresa_id
         WHERE l.empresa_id=$1
         ORDER BY l.recorded_at DESC, l.created_at DESC
         LIMIT 1`,
        [empresaId]
      ),
      db.query(
        `SELECT id, matricula, gps_provider, gps_external_id, ubicacion_actual, ubicacion_ts
         FROM vehiculos
         WHERE empresa_id=$1
           ${tractoraFilter}
           AND activo=true
           AND gps_provider IS NOT NULL
           AND gps_provider <> 'manual'
           AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL
           AND (ubicacion_ts IS NULL OR ubicacion_ts < NOW()-INTERVAL '6 hours')
         ORDER BY ubicacion_ts NULLS FIRST, matricula
         LIMIT 20`,
        [empresaId]
      ),
      db.query(
        `SELECT provider, token_mask, activo, updated_at, last_used_at
         FROM gps_webhook_tokens
         WHERE empresa_id=$1
         ORDER BY updated_at DESC`,
        [empresaId]
      ).catch(() => ({ rows: [] })),
    ]);
    const c = counts.rows[0] || {};
    const configured = providers.filter(p => p.id !== "manual" && p.configured && !p.blocked).map(p => p.id);
    const warnings = [];
    if (!activeProvider) warnings.push("No hay proveedor GPS activo para esta empresa.");
    if (!configured.length) warnings.push("No hay proveedor GPS configurado. Para activarlo, habla con soporte o configura el proveedor desde SuperAdmin.");
    if (Number(c.pendientes || 0) > 0) warnings.push(`${c.pendientes} vehiculo(s) activos sin enlace GPS.`);
    if (Number(c.nunca_senal || 0) > 0) warnings.push(`${c.nunca_senal} vehiculo(s) enlazados todavia no han enviado ninguna posicion.`);
    if (Number(c.sin_senal_reciente || 0) > 0) warnings.push(`${c.sin_senal_reciente} vehiculo(s) enlazados sin senal GPS reciente.`);
    if (duplicates.rows.length) warnings.push(`${duplicates.rows.length} ID(s) GPS duplicados.`);
    const activeWebhook = webhookRows.rows.find(w => w.provider === activeProvider && w.activo);
    res.json({
      active_provider: activeProvider || "",
      providers,
      configured,
      counts: {
        total: Number(c.total || 0),
        activos: Number(c.activos || 0),
        enlazados: Number(c.enlazados || 0),
        pendientes: Number(c.pendientes || 0),
        con_ubicacion: Number(c.con_ubicacion || 0),
        nunca_senal: Number(c.nunca_senal || 0),
        senal_reciente: Number(c.senal_reciente || 0),
        sin_senal_reciente: Number(c.sin_senal_reciente || 0),
      },
      duplicates: duplicates.rows,
      stale_vehicles: staleVehicles.rows,
      last_position: lastPosition.rows[0] || null,
      webhook: activeWebhook || null,
      webhooks: webhookRows.rows,
      warnings,
      signal_help: {
        recent_window_hours: 6,
        meaning: "El proveedor reconoce el vehiculo/ID, pero TransGest aun no ha recibido una posicion GPS reciente.",
        likely_causes: [
          "El equipo GPS esta apagado, sin alimentacion o el vehiculo lleva tiempo sin comunicar.",
          "El equipo no tiene cobertura GPS/GPRS o Movildata aun no ha publicado la ultima localizacion por API.",
          "El IMEI/ID esta enlazado, pero el endpoint de posiciones no devuelve coordenadas para ese dispositivo.",
          "La posicion llega por webhook/proveedor externo y todavia no se ha recibido ningun envio."
        ]
      },
      ready: !!activeProvider && configured.includes(activeProvider) && !duplicates.rows.length && Number(c.sin_senal_reciente || 0) === 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r1.patch("/gps-links", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const links = Array.isArray(req.body?.links) ? req.body.links : [];
    if (!links.length) return res.status(400).json({ error: "No hay enlaces GPS para guardar" });
    if (links.length > 500) return res.status(400).json({ error: "Maximo 500 enlaces GPS por operacion" });

    const normalized = links.map(item => ({
      vehiculo_id: String(item.vehiculo_id || item.id || "").trim(),
      matricula: String(item.matricula || "").trim().toUpperCase(),
      provider: String(item.provider || "").trim() || "manual",
      external_id: String(item.external_id || item.gps_external_id || "").trim(),
    }));
    const missing = normalized.find(l => (!l.vehiculo_id && !l.matricula) || !GPS_PROVIDERS[l.provider]);
    if (missing) return res.status(400).json({ error: "Hay enlaces GPS con vehiculo/matricula o proveedor no valido" });

    const requestedIds = normalized.filter(l => l.vehiculo_id).map(l => l.vehiculo_id);
    const requestedMats = normalized.filter(l => l.matricula).map(l => l.matricula);
    const existing = await db.query(
      `SELECT id, matricula
       FROM vehiculos
       WHERE empresa_id=$1
         AND (
           ($2::uuid[] IS NOT NULL AND id = ANY($2::uuid[]))
           OR ($3::varchar[] IS NOT NULL AND UPPER(TRIM(matricula)) = ANY($3::varchar[]))
         )`,
      [empresaId, requestedIds.length ? requestedIds : [], requestedMats.length ? requestedMats : []]
    );
    const byId = new Map(existing.rows.map(v => [v.id, v]));
    const byMatricula = new Map(existing.rows.map(v => [String(v.matricula || "").trim().toUpperCase(), v]));
    for (const link of normalized) {
      if (!link.vehiculo_id && link.matricula && byMatricula.has(link.matricula)) {
        link.vehiculo_id = byMatricula.get(link.matricula).id;
      }
    }

    const requestKeys = new Map();
    for (const link of normalized) {
      await assertGpsProviderMatchesCompany(empresaId, link.provider);
      if (GPS_REMOTE_PROVIDERS.includes(link.provider) && link.external_id) {
        const key = `${link.provider}:${link.external_id.trim().toUpperCase()}`;
        if (requestKeys.has(key)) {
          return res.status(409).json({ error: `El ID GPS "${link.external_id}" esta repetido en la operacion.` });
        }
        requestKeys.set(key, link.vehiculo_id);
      }
    }

    const existingIds = new Set(byId.keys());
    const unknown = normalized.find(l => !l.vehiculo_id || !existingIds.has(l.vehiculo_id));
    if (unknown) return res.status(404).json({ error: "Uno de los vehiculos no existe en esta empresa" });

    for (const link of normalized) {
      await assertGpsExternalIdAvailable(empresaId, link.vehiculo_id, link.provider, link.external_id);
    }

    const rows = await db.transaction(async client => {
      const updated = [];
      for (const link of normalized) {
        const res = await client.query(
          `UPDATE vehiculos
           SET gps_provider=$1::varchar,
               gps_external_id=$2,
               ubicacion_fuente=CASE WHEN $1::varchar='manual' THEN COALESCE(ubicacion_fuente,'manual') ELSE $1::varchar END,
               updated_at=NOW()
           WHERE id=$3 AND empresa_id=$4
           RETURNING *`,
          [link.provider, link.external_id || null, link.vehiculo_id, empresaId]
        );
        if (res.rows[0]) updated.push(res.rows[0]);
      }
      return updated;
    });

    res.json({ ok: true, updated: rows.length, vehiculos: rows });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /vehiculos/alertas-doc - ITV and seguro expiring within 30 days.
r1.get("/alertas-doc", cacheMiddleware(60), async (req, res) => {
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return res.json([]);
  const en30 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const { rows } = await db.query(`
      SELECT id, matricula, km_actuales, fecha_itv, fecha_seguro, clase,
        CASE WHEN fecha_itv < CURRENT_DATE THEN 'vencida'
             WHEN fecha_itv <= $2::date   THEN 'proxima' END AS alerta_itv,
        CASE WHEN fecha_seguro < CURRENT_DATE THEN 'vencido'
             WHEN fecha_seguro <= $2::date    THEN 'proximo' END AS alerta_seguro,
        CASE WHEN fecha_itv IS NULL THEN NULL ELSE (fecha_itv - CURRENT_DATE)::int END AS dias_itv,
        CASE WHEN fecha_seguro IS NULL THEN NULL ELSE (fecha_seguro - CURRENT_DATE)::int END AS dias_seguro
      FROM vehiculos
      WHERE empresa_id = $1 AND activo = true
        AND (fecha_itv <= $2::date OR fecha_seguro <= $2::date)
    `, [empresaId, en30]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r1.get("/:id", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const vehiculoId = String(req.params.id || "").trim();
    if (!isUuid(vehiculoId)) {
      return res.status(400).json({ error: "Identificador de vehiculo no valido" });
    }
    const { rows } = await db.query("SELECT * FROM vehiculos WHERE id=$1 AND empresa_id=$2", [vehiculoId, empresaId]);
    if (!rows[0]) return res.status(404).json({ error: "No encontrado" });
    res.json((await hydrateVehiculos(empresaId, rows))[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r1.post("/", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const v = normalizeVehiculoBody(req.body);
    if (!v.matricula?.trim()) return res.status(400).json({ error: "La matricula es obligatoria" });
    const empresaId = req.empresaId || req.user.empresa_id;

    const { rows: existe } = await db.query(
      "SELECT id, activo, estado FROM vehiculos WHERE UPPER(TRIM(matricula))=UPPER(TRIM($1)) AND empresa_id=$2",
      [v.matricula, empresaId]
    );
    if (existe[0]) {
      const current = existe[0];
      if (!current.activo || current.estado === "baja") {
        return res.status(409).json({
          error: `La matricula "${v.matricula.toUpperCase()}" ya existe pero esta dada de baja. Puedes reactivarla desde el filtro "Dados de baja" en Vehiculos.`,
        });
      }
      return res.status(409).json({
        error: `La matricula "${v.matricula.toUpperCase()}" ya esta registrada en el sistema. No se puede crear un vehiculo duplicado.`,
      });
    }

    const { rows } = await db.query(
      `INSERT INTO vehiculos
       (matricula,marca,modelo,"a\u00f1o",tipo,tara_kg,carga_max_kg,empresa_id,clase,fecha_matriculacion,fecha_itv,fecha_seguro,
        ubicacion_actual,ubicacion_fuente,gps_provider,gps_external_id,ubicacion_ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::varchar,$14,$15,$16,CASE WHEN NULLIF($13::text,'') IS NULL THEN NULL ELSE NOW() END) RETURNING *`,
      [
        v.matricula.trim().toUpperCase(), v.marca, v.modelo, v.anio || null,
        v.tipo || "Camion", v.tara_kg || null, v.carga_max_kg || null, empresaId,
        v.clase || null, v.fecha_matriculacion || null, v.fecha_itv || null, v.fecha_seguro || null,
        v.ubicacion_actual || null,
        v.ubicacion_fuente || (v.ubicacion_actual ? "manual" : null),
        v.gps_provider || null,
        v.gps_external_id || null,
      ]
    );
    const extData = extractVehiculoExtData(req.body || {});
    await upsertVehiculoExt({ empresaId, vehiculoId: rows[0].id, data: extData, updatedBy: req.user?.id || null });
    await syncVehiculoStatusAux({
      empresaId,
      vehiculoId: rows[0].id,
      estado: rows[0].estado || v.estado || "disponible",
      updatedBy: req.user?.id || null,
    });
    await logVehiculoEvento({
      empresaId,
      vehiculoId: rows[0].id,
      tipo: "vehiculo.creado",
      actorId: req.user?.id || null,
      detalle: { matricula: rows[0].matricula, estado: rows[0].estado || "disponible" },
    });
    res.status(201).json((await hydrateVehiculos(empresaId, rows))[0]);
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Esa matricula ya existe en el sistema. No se puede crear un vehiculo duplicado." });
    }
    res.status(500).json({ error: e.message });
  }
});

r1.patch("/:id/estado", GERENTE_O_TRAFICO, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { rows: beforeRows } = await db.query(
    "SELECT id, matricula, estado, ubicacion_actual FROM vehiculos WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresaId]
  );
  if (!beforeRows[0]) return res.status(404).json({ error: "Vehiculo no encontrado" });
  const { rows } = await db.query(
    `UPDATE vehiculos
     SET estado=$1,
         ubicacion_actual=COALESCE($2::varchar, ubicacion_actual),
         ubicacion_fuente=CASE WHEN NULLIF($2::text,'') IS NULL THEN ubicacion_fuente ELSE 'manual' END,
         ubicacion_ts=CASE WHEN NULLIF($2::text,'') IS NULL THEN ubicacion_ts ELSE NOW() END
     WHERE id=$3 AND empresa_id=$4
     RETURNING *`,
    [req.body.estado, req.body.ubicacion_actual || null, req.params.id, empresaId]
  );
  await syncVehiculoStatusAux({
    empresaId,
    vehiculoId: req.params.id,
    estado: rows[0].estado,
    updatedBy: req.user?.id || null,
  });
  await logVehiculoEvento({
    empresaId,
    vehiculoId: req.params.id,
    tipo: "vehiculo.estado",
    actorId: req.user?.id || null,
    detalle: {
      matricula: rows[0].matricula,
      estado_anterior: beforeRows[0].estado || null,
      estado_nuevo: rows[0].estado || null,
      ubicacion_actual: rows[0].ubicacion_actual || null,
    },
  });
  res.json((await hydrateVehiculos(empresaId, rows))[0]);
});

r1.put("/:id", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const v = normalizeVehiculoBody(req.body);
    const empresaId = req.empresaId || req.user?.empresa_id;
    const forceReassignChofer = req.body?.confirmar_reasignacion_chofer === true || req.body?.force_reassign_chofer === true;
    if (v.matricula) {
      const { rows: dup } = await db.query(
        "SELECT id FROM vehiculos WHERE UPPER(TRIM(matricula))=UPPER(TRIM($1)) AND empresa_id=$2 AND id<>$3",
        [v.matricula, empresaId, req.params.id]
      );
      if (dup[0]) return res.status(409).json({ error: `La matricula "${v.matricula.toUpperCase()}" ya esta registrada en otro vehiculo.` });
    }

    if (v.chofer_id) {
      const { rows: chDup } = await db.query(
        `SELECT v.id, v.matricula, r.matricula AS remolque_matricula
         FROM vehiculos v
         LEFT JOIN vehiculos r ON r.id=v.remolque_id AND r.empresa_id=v.empresa_id
         WHERE v.chofer_id=$1 AND v.id<>$2 AND v.empresa_id=$3 AND v.activo=true`,
        [v.chofer_id, req.params.id, empresaId]
      );
      if (chDup[0]) {
        if (!forceReassignChofer) {
          const conjunto = chDup[0].remolque_matricula ? `${chDup[0].matricula} + ${chDup[0].remolque_matricula}` : chDup[0].matricula;
          return res.status(409).json({
            error: `Este chofer ya esta asignado al conjunto ${conjunto}. Confirma para moverlo al nuevo vehiculo.`,
            code: "CHOFER_YA_ASIGNADO",
            requiere_confirmacion: true,
            conflicto: {
              tipo: "chofer",
              chofer_id: v.chofer_id,
              vehiculo_origen_id: chDup[0].id,
              vehiculo_origen_matricula: chDup[0].matricula,
              remolque_origen_matricula: chDup[0].remolque_matricula || null,
              vehiculo_destino_id: req.params.id,
              vehiculo_destino_matricula: v.matricula || null,
            },
          });
        }
        await db.query(
          "UPDATE vehiculos SET chofer_id=NULL WHERE chofer_id=$1 AND id<>$2 AND empresa_id=$3 AND activo=true",
          [v.chofer_id, req.params.id, empresaId]
        );
      }
    }

    const { rows } = await db.query(
      `UPDATE vehiculos SET matricula=$1,marca=$2,modelo=$3,"a\u00f1o"=$4,tipo=$5,tara_kg=$6,
       carga_max_kg=$7,estado=$8,km_actuales=$9,activo=$10,notas=$11,chofer_id=$12,clase=$13,notas_operacion=$14,
       fecha_matriculacion=$15,fecha_itv=$16,fecha_seguro=$17,ubicacion_actual=COALESCE($18::varchar,ubicacion_actual),
       ubicacion_fuente=COALESCE(NULLIF($19::text,''),ubicacion_fuente),
       ubicacion_ts=CASE WHEN NULLIF($18::text,'') IS NULL THEN ubicacion_ts ELSE NOW() END,
       gps_provider=COALESCE(NULLIF($20,''),gps_provider),
       gps_external_id=COALESCE(NULLIF($21,''),gps_external_id)
       WHERE id=$22 AND empresa_id=$23 RETURNING *`,
      [
        v.matricula, v.marca, v.modelo, v.anio, v.tipo, v.tara_kg, v.carga_max_kg,
        v.estado, v.km_actuales, v.activo, v.notas, v.chofer_id || null,
        v.clase || null, v.notas_operacion || null,
        v.fecha_matriculacion || null, v.fecha_itv || null, v.fecha_seguro || null, v.ubicacion_actual || null,
        v.ubicacion_fuente || (v.ubicacion_actual ? "manual" : null),
        v.gps_provider || null,
        v.gps_external_id || null,
        req.params.id, empresaId,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "No encontrado" });
    const extData = extractVehiculoExtData(req.body || {});
    await upsertVehiculoExt({ empresaId, vehiculoId: rows[0].id, data: extData, updatedBy: req.user?.id || null });
    await syncVehiculoStatusAux({
      empresaId,
      vehiculoId: rows[0].id,
      estado: rows[0].estado,
      updatedBy: req.user?.id || null,
    });
    await logVehiculoEvento({
      empresaId,
      vehiculoId: rows[0].id,
      tipo: "vehiculo.editado",
      actorId: req.user?.id || null,
      detalle: {
        matricula: rows[0].matricula,
        estado: rows[0].estado || null,
        ubicacion_actual: rows[0].ubicacion_actual || null,
      },
    });
    res.json((await hydrateVehiculos(empresaId, rows))[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "La matricula ya existe en el sistema." });
    res.status(500).json({ error: e.message });
  }
});

r1.patch("/:id/gps-link", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const provider = String(req.body.provider || "").trim() || "manual";
    if (!GPS_PROVIDERS[provider]) return res.status(400).json({ error: "Proveedor GPS no soportado" });
    const externalId = String(req.body.external_id || req.body.gps_external_id || "").trim();
    await assertGpsProviderMatchesCompany(empresaId, provider);
    await assertGpsExternalIdAvailable(empresaId, req.params.id, provider, externalId);
    const { rows } = await db.query(
      `UPDATE vehiculos
       SET gps_provider=$1::varchar,
           gps_external_id=$2,
           ubicacion_fuente=CASE WHEN $1::varchar='manual' THEN COALESCE(ubicacion_fuente,'manual') ELSE $1::varchar END,
           updated_at=NOW()
       WHERE id=$3 AND empresa_id=$4
       RETURNING *`,
      [provider, externalId || null, req.params.id, empresaId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Vehiculo no encontrado" });
    await logVehiculoEvento({
      empresaId,
      vehiculoId: req.params.id,
      tipo: "vehiculo.gps_link",
      actorId: req.user?.id || null,
      detalle: {
        matricula: rows[0].matricula,
        provider,
        external_id: externalId || null,
      },
    });
    res.json((await hydrateVehiculos(empresaId, rows))[0]);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

r1.patch("/:id/posicion", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const updated = await updateVehiclePosition({
      empresaId,
      vehiculoId: req.params.id,
      provider: req.body.provider || "manual",
      externalId: req.body.external_id || req.body.gps_external_id || null,
      lat: req.body.lat ?? null,
      lng: req.body.lng ?? null,
      ubicacion: req.body.ubicacion || req.body.ubicacion_actual || "",
      velocidad: req.body.velocidad_kmh ?? null,
      odometro: req.body.odometro_km ?? req.body.km_actuales ?? null,
      raw: { source: "manual_update", user_id: req.user?.id || null },
      recordedAt: req.body.recorded_at || null,
    });
    if (!updated) return res.status(404).json({ error: "Vehiculo no encontrado" });
    await logVehiculoEvento({
      empresaId,
      vehiculoId: req.params.id,
      tipo: "vehiculo.posicion_manual",
      actorId: req.user?.id || null,
      detalle: {
        provider: req.body.provider || "manual",
        ubicacion: req.body.ubicacion || req.body.ubicacion_actual || "",
        lat: req.body.lat ?? null,
        lng: req.body.lng ?? null,
      },
    });
    res.json((await hydrateVehiculos(empresaId, [updated]))[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r1.get("/:id/eventos", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows } = await db.query(
      `SELECT e.id, e.tipo, e.actor_id, e.detalle, e.created_at,
              COALESCE(NULLIF(TRIM(u.nombre), ''), u.email, u.username) AS usuario_nombre
       FROM vehiculo_eventos e
       LEFT JOIN usuarios u ON u.id = e.actor_id
       WHERE e.vehiculo_id=$1 AND e.empresa_id=$2
       ORDER BY e.created_at DESC
       LIMIT 100`,
      [req.params.id, empresaId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r1.get("/:id/posiciones", async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows } = await db.query(
      `SELECT id,provider,external_id,lat,lng,ubicacion,velocidad_kmh,odometro_km,recorded_at,created_at
       FROM gps_position_log
       WHERE vehiculo_id=$1 AND empresa_id=$2
       ORDER BY recorded_at DESC, created_at DESC
       LIMIT 100`,
      [req.params.id, empresaId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r1.post("/gps/sync", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { providers, activeProvider } = await getGpsProviderStatuses(empresaId);
    const provider = String(req.body.provider || activeProvider || "").trim().toLowerCase();
    if (!GPS_PROVIDERS[provider] || provider === "manual") {
      return res.status(400).json({ error: "Selecciona un proveedor GPS activo para sincronizar." });
    }
    const providerStatus = providers.find(p => p.id === provider);
    if (!providerStatus?.configured || providerStatus?.blocked) {
      return res.status(400).json({ error: `No hay proveedor GPS configurado para ${GPS_PROVIDERS[provider] || provider}. Habla con soporte para activarlo.` });
    }
    if (activeProvider && provider !== activeProvider) {
      return res.status(409).json({ error: `El GPS activo de la empresa es ${GPS_PROVIDERS[activeProvider]}. Cambialo en SuperAdmin antes de sincronizar ${GPS_PROVIDERS[provider]}.` });
    }
    const resolved = await resolveApiKey(empresaId, provider);
    if (!resolved.key) {
      return res.status(400).json({
        error: `Falta configurar la API de ${GPS_PROVIDERS[provider]} para esta empresa o como clave global.`,
      });
    }
    let result = { updated: 0, received: 0, unmatched: 0 };
    if (provider === "movildata") {
      result = await syncMovildataPositions(empresaId, resolved.key);
    } else {
      result = await syncWebhookOnlyProvider(empresaId, provider);
    }
    await recordApiUsage(empresaId, provider, 1).catch(() => {});
    res.json({
        ok: true,
        provider,
        updated: result.updated || 0,
        linked: result.linked || 0,
        received_vehicles: result.receivedVehicles || 0,
        matched_vehicles: result.matchedVehicles || [],
        unmatched_vehicles: result.unmatchedVehicles || [],
        received: result.received || 0,
        unmatched: result.unmatched || 0,
        webhook_only: !!result.webhook_only,
        link_error: result.link_error || null,
        positions_error: result.positions_error || null,
        fallback_used: !!result.fallback_used,
        fallback_errors: result.fallback_errors || [],
        auth_error: !!result.auth_error,
        no_signal: !!result.no_signal,
        message: provider === "movildata"
          ? `Movildata sincronizado: ${result.linked || 0} matricula(s) enlazadas y ${result.updated || 0} vehiculo(s) actualizados de ${result.received || 0} posicion(es) recibidas${result.fallback_used ? "; se uso consulta individual por vehiculo" : ""}${result.auth_error ? "; Movildata ha denegado el endpoint de posiciones para esta clave API" : ""}${result.no_signal ? "; no hay senal GPS disponible ahora mismo" : ""}${result.positions_error ? ` (${result.positions_error})` : ""}${result.unmatched ? `; ${result.unmatched} sin matricula/ID coincidente` : ""}${result.unmatchedVehicles?.length ? `; ${result.unmatchedVehicles.length} vehiculo(s) del proveedor no existen aun en TransGest` : ""}.`
          : `El proveedor ${GPS_PROVIDERS[provider] || provider} esta activo por webhook/API externa. Hay ${result.linked || 0} vehiculo(s) enlazados; cuando el proveedor envie posiciones se actualizaran automaticamente.`,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

r1.patch("/:id/remolque", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { remolque_id } = req.body;
    const forceReassignRemolque = req.body?.confirmar_reasignacion_remolque === true || req.body?.force_reassign_remolque === true;
    if (remolque_id && String(remolque_id) === String(req.params.id)) {
      return res.status(409).json({ error: "No se puede asignar el mismo vehiculo como remolque." });
    }
    if (remolque_id) {
      const { rows: rem } = await db.query("SELECT id, matricula FROM vehiculos WHERE id=$1 AND empresa_id=$2", [remolque_id, empresaId]);
      if (!rem[0]) return res.status(404).json({ error: "Remolque no encontrado" });
      const { rows: dup } = await db.query(
        "SELECT id, matricula FROM vehiculos WHERE remolque_id=$1 AND id<>$2 AND empresa_id=$3 AND activo=true LIMIT 1",
        [remolque_id, req.params.id, empresaId]
      );
      if (dup[0]) {
        if (!forceReassignRemolque) {
          return res.status(409).json({
            error: `El remolque ${rem[0].matricula} ya esta asignado a la tractora ${dup[0].matricula}. Confirma para moverlo al nuevo conjunto.`,
            code: "REMOLQUE_YA_ASIGNADO",
            requiere_confirmacion: true,
            conflicto: {
              tipo: "remolque",
              remolque_id,
              remolque_matricula: rem[0].matricula,
              vehiculo_origen_id: dup[0].id,
              vehiculo_origen_matricula: dup[0].matricula,
              vehiculo_destino_id: req.params.id,
            },
          });
        }
        await db.query(
          "UPDATE vehiculos SET remolque_id=NULL WHERE remolque_id=$1 AND id<>$2 AND empresa_id=$3 AND activo=true",
          [remolque_id, req.params.id, empresaId]
        );
      }
    }
    const { rows } = await db.query(
      "UPDATE vehiculos SET remolque_id=$1 WHERE id=$2 AND empresa_id=$3 RETURNING *",
      [remolque_id || null, req.params.id, empresaId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Vehiculo no encontrado" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r1.delete("/:id", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const forzar = req.body?.forzar === true;

    if (forzar && req.user.rol !== "gerente") {
      return res.status(403).json({ error: "Solo el gerente puede eliminar vehiculos definitivamente." });
    }

    const { rows: pedidos } = await db.query(
      "SELECT COUNT(*) FROM pedidos WHERE vehiculo_id=$1 AND empresa_id=$2 AND estado NOT IN ('entregado','cancelado')",
      [req.params.id, empresaId]
    );
    if (parseInt(pedidos[0].count) > 0) {
      return res.status(409).json({ error: "Este vehiculo tiene pedidos activos. Finalizalos antes de continuar." });
    }

    if (forzar) {
      await db.query("UPDATE pedidos SET vehiculo_id=NULL WHERE vehiculo_id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
      await db.query("DELETE FROM vehiculos WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
    } else {
      const { rows } = await db.query(
        "UPDATE vehiculos SET activo=false, estado='baja' WHERE id=$1 AND empresa_id=$2 RETURNING id",
        [req.params.id, empresaId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Vehiculo no encontrado" });
    }

    res.json({ ok: true, tipo: forzar ? "eliminado" : "baja" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r1.patch("/:id/reactivar", GERENTE_O_TRAFICO, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  await db.query("UPDATE vehiculos SET activo=true, estado='disponible' WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
  res.json({ ok: true });
});

r1.patch("/:id/km", GERENTE_O_TRAFICO, async (req, res) => {
  const { km_actuales } = req.body;
  if (!km_actuales || isNaN(km_actuales)) {
    return res.status(400).json({ error: "km_actuales requerido" });
  }
  const empresaId = req.empresaId || req.user?.empresa_id;
  try {
    const { rows } = await db.query(
      `UPDATE vehiculos SET km_actuales=$1, updated_at=NOW()
       WHERE id=$2 AND empresa_id=$3 RETURNING id, matricula, km_actuales`,
      [Math.round(Number(km_actuales)), req.params.id, empresaId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Vehiculo no encontrado" });
    res.json({ ok: true, vehiculo: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = r1;
