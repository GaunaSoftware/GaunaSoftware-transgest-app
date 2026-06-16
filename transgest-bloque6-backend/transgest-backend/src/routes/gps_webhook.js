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
  const bearer = String(req.headers.authorization || "").startsWith("Bearer ")
    ? String(req.headers.authorization || "").slice(7)
    : "";
  return String(req.headers["x-transgest-gps-token"] || req.query.token || bearer || "").trim();
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
      recorded_at: item.recorded_at || item.timestamp || item.fecha || null,
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

    const activeProvider = await db.query(
      `SELECT provider
       FROM empresa_api_configs
       WHERE empresa_id=$1 AND provider = ANY($2::varchar[]) AND activo=true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [empresaId, GPS_REMOTE_PROVIDERS]
    );
    if (activeProvider.rows[0]?.provider && activeProvider.rows[0].provider !== provider) {
      return res.status(409).json({ error: `El GPS activo de la empresa es ${activeProvider.rows[0].provider}` });
    }

    const positions = normalizePositions(req.body);
    if (!positions.length) return res.status(400).json({ error: "Sin posiciones GPS" });

    let updated = 0;
    let ignored = 0;
    const errors = [];
    const updatedVehicles = [];
    await db.transaction(async client => {
      for (const pos of positions) {
        const lat = numericOrNull(pos.lat);
        const lng = numericOrNull(pos.lng);
        if (!pos.external_id && !pos.matricula) {
          ignored += 1;
          errors.push({ reason: "sin external_id ni matricula" });
          continue;
        }
        const veh = await client.query(
          `SELECT id, gps_external_id
           FROM vehiculos
           WHERE empresa_id=$1 AND activo=true AND (
             (gps_provider=$2 AND NULLIF(TRIM(gps_external_id),'') IS NOT NULL AND UPPER(TRIM(gps_external_id))=UPPER(TRIM($3)))
             OR ($4 <> '' AND UPPER(TRIM(matricula))=$4)
           )
           ORDER BY CASE WHEN gps_provider=$2 AND UPPER(TRIM(COALESCE(gps_external_id,'')))=UPPER(TRIM($3)) THEN 0 ELSE 1 END
           LIMIT 1`,
          [empresaId, provider, pos.external_id, pos.matricula]
        );
        if (!veh.rows[0]) {
          ignored += 1;
          errors.push({ external_id: pos.external_id || null, matricula: pos.matricula || null, reason: "vehiculo no vinculado" });
          continue;
        }

        const current = veh.rows[0];
        const update = await client.query(
          `UPDATE vehiculos
           SET ubicacion_actual=COALESCE(NULLIF($1,''), ubicacion_actual),
               ubicacion_fuente=$2,
               ubicacion_ts=COALESCE($3::timestamptz, NOW()),
               gps_lat=COALESCE($4, gps_lat),
               gps_lng=COALESCE($5, gps_lng),
               gps_provider=$2,
               gps_external_id=COALESCE(NULLIF($6,''), gps_external_id),
               km_actuales=COALESCE($7, km_actuales),
               updated_at=NOW()
           WHERE id=$8 AND empresa_id=$9
           RETURNING id, matricula, ubicacion_actual, gps_lat, gps_lng, km_actuales`,
          [
            pos.ubicacion,
            provider,
            pos.recorded_at || null,
            lat,
            lng,
            pos.external_id || current.gps_external_id || null,
            numericOrNull(pos.odometro_km),
            current.id,
            empresaId,
          ]
        );
        await client.query(
          `INSERT INTO gps_position_log
            (empresa_id,vehiculo_id,provider,external_id,lat,lng,ubicacion,velocidad_kmh,odometro_km,raw,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,COALESCE($11::timestamptz,NOW()))`,
          [
            empresaId,
            current.id,
            provider,
            pos.external_id || current.gps_external_id || null,
            lat,
            lng,
            pos.ubicacion || null,
            numericOrNull(pos.velocidad_kmh),
            numericOrNull(pos.odometro_km),
            JSON.stringify(pos.raw || {}),
            pos.recorded_at || null,
          ]
        );
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
