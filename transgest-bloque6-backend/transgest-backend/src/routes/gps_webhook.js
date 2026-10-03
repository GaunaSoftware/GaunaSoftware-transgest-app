const crypto = require("crypto");
const express = require("express");
const db = require("../services/db");
const { ensureTables: ensureApiKeyTables } = require("../services/apiKeys");

const router = express.Router();

const GPS_REMOTE_PROVIDERS = ["locatel", "tacogest", "movildata", "gps_generic"];

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function pickToken(req) {
  return require("../services/integrationSecrets").integrationSecret(req, ["x-transgest-gps-token"], "token");
}

function normalizePositions(body) {
  const raw = Array.isArray(body) ? body : Array.isArray(body?.positions) ? body.positions : [body];
  return raw
    .filter(Boolean)
    .slice(0, 500)
    .map(item => ({
      external_id: String(item.external_id || item.gps_external_id || item.vehicle_id || item.id || "").trim(),
      matricula: String(item.matricula || item.plate || item.license_plate || "").trim().toUpperCase(),
      lat: item.lat ?? item.latitude ?? null,
      lng: item.lng ?? item.lon ?? item.longitude ?? null,
      ubicacion: String(item.ubicacion || item.location || item.address || "").trim(),
      velocidad_kmh: item.velocidad_kmh ?? item.speed_kmh ?? item.speed ?? null,
      odometro_km: item.odometro_km ?? item.odometer_km ?? item.odometer ?? item.km_actuales ?? null,
      fuel_total_l: item.fuel_total_l ?? null,
      frigo_temperature_c: item.frigo_temperature_c ?? null,
      frigo_temperature_c_sensor: item.frigo_temperature_c_sensor ?? null,
      engine_hours: item.engine_hours ?? null,
      recorded_at: item.recorded_at || item.timestamp || item.fecha || null,
      heading: item.heading ?? item.bearing ?? null,
      accuracy_m: item.accuracy_m ?? item.accuracy ?? null,
      raw: item,
    }));
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

router.post("/webhook/:empresaId/:provider", async (req, res) => {
  try {
    await ensureApiKeyTables();
    const empresaId = req.params.empresaId;
    const provider = String(req.params.provider || "").toLowerCase();
    if (!GPS_REMOTE_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor GPS no valido" });

    const token = pickToken(req);
    if (!token) return res.status(401).json({ error: "Token GPS requerido" });
    const { rows: tokenRows } = await db.query(
      `SELECT token_hash
       FROM gps_webhook_tokens
       WHERE empresa_id=$1 AND provider=$2 AND activo=true
       LIMIT 1`,
      [empresaId, provider]
    );
    const tokenHash = hashToken(token);
    if (!tokenRows[0] || !safeEqual(tokenRows[0].token_hash, tokenHash)) {
      return res.status(401).json({ error: "Token GPS invalido" });
    }

    const providerConfig = await db.query(
      `SELECT activo
       FROM empresa_api_configs
       WHERE empresa_id=$1 AND provider=$2`,
      [empresaId, provider]
    );
    if (providerConfig.rows[0]?.activo === false) {
      return res.status(409).json({ error: `El conector ${provider} está desactivado para esta empresa` });
    }

    const positions = normalizePositions(req.body);
    if (!positions.length) return res.status(400).json({ error: "Sin posiciones GPS" });

    let updated = 0;
    let ignored = 0;
    const errors = [];
    const updatedVehicles = [];
    await db.transaction(async client => {
      for (const pos of positions) {

        if (!pos.external_id && !pos.matricula) {
          ignored += 1;
          errors.push({ reason: "sin external_id ni matricula" });
          continue;
        }
        const veh = await client.query(
          `SELECT id, gps_provider, gps_external_id
           FROM vehiculos
           WHERE empresa_id=$1 AND activo=true AND (
             (gps_provider=$2 AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND UPPER(TRIM(gps_external_id))=UPPER(TRIM($3)))
             OR ($4 <> '' AND UPPER(TRIM(matricula))=$4
                 AND (gps_provider IS NULL OR gps_provider='' OR gps_provider=$2)
                 AND (NULLIF(TRIM(gps_external_id),'') IS NULL OR UPPER(TRIM(gps_external_id))=UPPER(TRIM($3))))
           )
           ORDER BY CASE WHEN gps_provider=$2 AND UPPER(TRIM(COALESCE(gps_external_id,'')))=UPPER(TRIM($3)) THEN 0 ELSE 1 END
           FOR UPDATE`,
          [empresaId, provider, pos.external_id, pos.matricula]
        );
        const exact = veh.rows.filter(v => v.gps_provider===provider && v.gps_external_id && String(v.gps_external_id).trim().toUpperCase()===pos.external_id.toUpperCase());
        const matches = exact.length ? exact : veh.rows;
        if (matches.length !== 1) {
          ignored += 1;
          errors.push({ external_id: pos.external_id || null, matricula: pos.matricula || null, reason: "vehiculo no vinculado" });
          continue;
        }

        const current = matches[0];
        const tracking=require('../services/vehicleTracking');
        try { tracking.position(pos); }catch(e){ignored++;errors.push({external_id:pos.external_id,reason:e.message});continue;}
        const link=await client.query("UPDATE vehiculos SET gps_provider=$3,gps_external_id=COALESCE(NULLIF($4,''),gps_external_id) WHERE empresa_id=$1 AND id=$2 AND (gps_provider IS NULL OR gps_provider='' OR gps_provider=$3) RETURNING id",[empresaId,current.id,provider,pos.external_id]);
        if (!link.rows.length) { ignored++; continue; }
        await tracking.record({query:(...args)=>client.query(...args),transaction:fn=>fn(client)}, {empresaId,vehiculoId:current.id,provider,input:pos,externalId:pos.external_id||current.gps_external_id,raw:pos.raw});
        const update=await client.query("SELECT id,matricula,ubicacion_actual,gps_lat,gps_lng,km_actuales FROM vehiculos WHERE empresa_id=$1 AND id=$2",[empresaId,current.id]);
        updated += 1;
        updatedVehicles.push(update.rows[0]);
      }
      await client.query(
        "UPDATE gps_webhook_tokens SET last_used_at=NOW(), updated_at=NOW() WHERE empresa_id=$1 AND provider=$2",
        [empresaId, provider]
      );
    });

    res.json({ ok: true, provider, received: positions.length, updated, ignored, errors: errors.slice(0, 20), vehiculos: updatedVehicles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
