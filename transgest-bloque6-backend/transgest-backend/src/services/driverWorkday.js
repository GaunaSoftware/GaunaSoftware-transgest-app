const db = require('./db');

function workdayError(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

function validateOdometer(value, start = null) {
  if (value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw workdayError('Introduce un cuentakilómetros válido.', 400);
  }
  const km = Math.round(Number(value) * 10) / 10;
  if (start != null && km < Number(start) + 1) {
    throw workdayError('El cuentakilómetros de cierre debe superar al de apertura en al menos 1 km.', 400);
  }
  return km;
}

function validateConfirmedSet(body, vehicleId, trailerId) {
  if (!vehicleId || String(body.vehiculo_id || '') !== String(vehicleId) || String(body.remolque_id || '') !== String(trailerId || '')) {
    throw workdayError('Selecciona la tractora y el remolque actuales antes de continuar.', 400);
  }
}

async function assertDriverWorkday(req) {
  if (req.user?.rol !== 'chofer' || req.user?.colaborador_id) return;
  const { rows } = await db.query(
    "SELECT id FROM chofer_jornadas WHERE empresa_id=$1 AND usuario_id=$2 AND estado='abierta' LIMIT 1",
    [req.empresaId || req.user.empresa_id, req.user.id]
  );
  if (!rows.length) throw workdayError('Abre tu jornada antes de realizar una acción del viaje. Puedes consultar sus documentos con la jornada cerrada.');
}

async function externalGpsTimestamp(empresaId, vehicleId) {
  if (!vehicleId) return null;
  const { rows } = await db.query(
    `SELECT recorded_at FROM gps_position_log WHERE empresa_id=$1 AND vehiculo_id=$2
      AND provider NOT IN ('app_chofer','manual') AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY recorded_at DESC LIMIT 1`, [empresaId, vehicleId]
  );
  return rows[0]?.recorded_at || null;
}

function freshGps(timestamp, now = Date.now()) {
  const ms = timestamp ? new Date(timestamp).getTime() : NaN;
  return Number.isFinite(ms) && ms <= now + 60000 && ms >= now - 5 * 60000;
}

module.exports = { validateOdometer, validateConfirmedSet, assertDriverWorkday, externalGpsTimestamp, freshGps, workdayError };
