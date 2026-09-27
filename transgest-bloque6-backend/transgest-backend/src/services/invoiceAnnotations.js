const FIELDS = Object.freeze({
  matricula: 60,
  remolque: 60,
  referencias_internas: 500,
  referencia_cliente: 255,
  observaciones_informativas: 2000,
});

function reject(message, status = 400, code = 'FACTURA_ANOTACIONES_INVALIDAS') {
  throw Object.assign(new Error(message), { status, code });
}

function normalizePatch(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) reject('Datos de anotación no válidos.');
  const keys = Object.keys(body).filter(key => !['version', 'motivo'].includes(key));
  if (!keys.length) reject('Indica al menos un dato informativo.');
  const patch = {};
  for (const key of keys) {
    if (key === 'etiquetas') {
      if (!Array.isArray(body[key]) || body[key].length > 20 || body[key].some(item => typeof item !== 'string' || item.trim().length > 60))
        reject('Las etiquetas deben ser una lista de hasta 20 textos de 60 caracteres.');
      patch[key] = [...new Set(body[key].map(item => item.trim()).filter(Boolean))];
    } else {
      if (!Object.hasOwn(FIELDS, key)) reject(`El campo ${key} no se puede cambiar tras emitir la factura.`);
      if (typeof body[key] !== 'string' || body[key].trim().length > FIELDS[key]) reject(`El campo ${key} no es válido.`);
      patch[key] = body[key].trim();
    }
  }
  return patch;
}

async function read(db, { facturaId, empresaId }) {
  const { rows } = await db.query(
    `SELECT version, datos, cambios, motivo, usuario_id, created_at
       FROM factura_anotaciones
      WHERE factura_id=$1 AND empresa_id=$2
      ORDER BY version DESC`,
    [facturaId, empresaId]
  );
  return { actual: rows[0] || null, historial: rows };
}

async function save(db, { facturaId, empresaId, actorId, body }) {
  const patch = normalizePatch(body);
  const expectedVersion = Number(body.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) reject('La versión de las anotaciones no es válida.');
  const motivo = String(body.motivo || '').trim();
  if (motivo.length < 5 || motivo.length > 1000) reject('Indica un motivo de entre 5 y 1000 caracteres.');
  return db.transaction(async tx => {
    const { rows: invoices } = await tx.query(
      'SELECT id, estado::text AS estado FROM facturas WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [facturaId, empresaId]
    );
    if (!invoices[0]) reject('Factura no encontrada.', 404, 'FACTURA_NO_ENCONTRADA');
    if (invoices[0].estado === 'borrador') reject('Las anotaciones versionadas se reservan para facturas emitidas.', 409, 'FACTURA_BORRADOR');
    const { rows } = await tx.query(
      'SELECT version, datos FROM factura_anotaciones WHERE factura_id=$1 AND empresa_id=$2 ORDER BY version DESC LIMIT 1',
      [facturaId, empresaId]
    );
    const previous = rows[0]?.datos || {};
    const changes = Object.fromEntries(Object.entries(patch)
      .filter(([key, value]) => JSON.stringify(previous[key] ?? (key === 'etiquetas' ? [] : '')) !== JSON.stringify(value))
      .map(([key, value]) => [key, { anterior: previous[key] ?? (key === 'etiquetas' ? [] : ''), nuevo: value }]));
    if (!Object.keys(changes).length) return { actual: rows[0] || null, sin_cambios: true };
    if ((rows[0]?.version || 0) !== expectedVersion) reject('Las anotaciones cambiaron. Recarga la factura antes de guardar.', 409, 'FACTURA_ANOTACIONES_VERSION');
    const next = { ...previous, ...patch };
    const { rows: saved } = await tx.query(
      `INSERT INTO factura_anotaciones (factura_id, empresa_id, version, datos, cambios, motivo, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING version, datos, cambios, motivo, usuario_id, created_at`,
      [facturaId, empresaId, expectedVersion + 1, JSON.stringify(next), JSON.stringify(changes), motivo, actorId]
    );
    return { actual: saved[0], sin_cambios: false };
  });
}

module.exports = { FIELDS, normalizePatch, read, save };
