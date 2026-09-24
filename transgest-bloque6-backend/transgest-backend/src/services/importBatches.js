const path = require('node:path');
const crypto = require('node:crypto');
const defaultDb = require('./db');

const TYPES = new Set([
  'Clientes','Conductores','Vehiculos','Colaboradores','Tarifas',
  'Docs_Conductores','Docs_Vehiculos','Viajes_Historicos','Viajes_Pendientes',
  'Facturas_Historicas','Facturas_Lineas','Facturas_Pendientes',
  'Gastos_Operativos','Repostajes','Gastos_Estructura','Pack_TransGest',
]);

function fail(message, status = 400, code = 'IMPORT_INVALID') {
  return Object.assign(new Error(message), { status, code });
}
function requireCompany(empresaId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(empresaId || ''))) throw fail('Empresa no válida', 403, 'TENANT_REQUIRED');
  return empresaId;
}
function requireBatchId(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''))) throw fail('Identificador de lote no válido');
  return id;
}
function normalizeFilename(value) {
  const name = path.basename(String(value || '').replace(/\\/g, '/'));
  const cleaned = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').slice(0, 180).trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') throw fail('Nombre de archivo no válido');
  return cleaned;
}
function normalizeSourceSystem(value) {
  const result = String(value || '').trim().slice(0, 80);
  if (!result) throw fail('Indica el sistema de origen');
  return result;
}
function hashRow(entityType, data) {
  const pairs = Object.entries(data || {}).sort(([a], [b]) => a.localeCompare(b));
  return crypto.createHash('sha256').update(JSON.stringify([entityType, pairs])).digest('hex');
}

function createImportBatches(db = defaultDb) {
  async function getBatch(empresaId, id, client = db, lock = false) {
    requireCompany(empresaId);
    requireBatchId(id);
    const { rows } = await client.query(`SELECT * FROM import_batches WHERE id=$1 AND empresa_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, empresaId]);
    if (!rows[0]) throw fail('Lote no encontrado', 404, 'BATCH_NOT_FOUND');
    return rows[0];
  }

  async function createBatch({ empresaId, actorId, tipo, filename, fileBuffer, sourceSystem, config = {} }) {
    requireCompany(empresaId);
    if (!TYPES.has(tipo)) throw fail('Plantilla no reconocida');
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) throw fail('Archivo vacío o no recibido');
    if (fileBuffer.length > 20 * 1024 * 1024) throw fail('Archivo superior a 20 MB', 413, 'FILE_TOO_LARGE');
    if (config === null || typeof config !== 'object' || Array.isArray(config)) throw fail('Configuración no válida');
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const { rows } = await db.query(`INSERT INTO import_batches
      (empresa_id,tipo,filename,file_hash_sha256,source_system,created_by,config)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
    [empresaId, tipo, normalizeFilename(filename), hash, normalizeSourceSystem(sourceSystem), actorId || null, JSON.stringify(config)]);
    return rows[0];
  }

  async function stageRows(empresaId, batchId, rows) {
    requireCompany(empresaId);
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) throw fail('Bloque de filas no válido (máximo 500)');
    const seen = new Set();
    const values = rows.map((row) => {
      if (!TYPES.has(row.entity_type) || row.entity_type === 'Pack_TransGest') throw fail('Entidad de fila no reconocida');
      if (!Number.isSafeInteger(row.row_number) || row.row_number < 2) throw fail('Número de fila no válido');
      const key = `${row.entity_type}:${row.row_number}`;
      if (seen.has(key)) throw fail('Fila duplicada dentro del bloque');
      seen.add(key);
      if (!row.source_data || typeof row.source_data !== 'object' || Array.isArray(row.source_data)) throw fail('Datos de fila no válidos');
      if (JSON.stringify(row.source_data).length > 65536) throw fail('Fila demasiado grande', 413, 'ROW_TOO_LARGE');
      const sourceIdValue = row.normalized_data?.source_id ?? row.source_data.source_id;
      const sourceId = sourceIdValue == null ? null : String(sourceIdValue).trim() || null;
      const status = ['valid','warning','invalid'].includes(row.status) ? row.status : 'uploaded';
      return { entity_type: row.entity_type, row_number: row.row_number, source_data: row.source_data,
        normalized_data: row.normalized_data || null, source_id: sourceId,
        fingerprint: hashRow(row.entity_type, row.normalized_data || row.source_data),
        status, error_code: row.error_code || null, error_message: row.error_message || null };
    });
    return db.transaction(async (client) => {
      const batch = await getBatch(empresaId, batchId, client, true);
      if (!['uploaded','validating'].includes(batch.status)) throw fail('Este lote ya no admite filas', 409, 'BATCH_LOCKED');
      const { rows: conflicts } = await client.query(`SELECT existing.row_number
        FROM import_rows existing
        JOIN jsonb_to_recordset($2::jsonb) AS incoming(entity_type text,row_number integer,fingerprint char(64))
          ON incoming.entity_type=existing.entity_type AND incoming.row_number=existing.row_number
        WHERE existing.batch_id=$1 AND existing.fingerprint<>incoming.fingerprint LIMIT 1`, [batchId, JSON.stringify(values)]);
      if (conflicts.length) throw fail(`La fila ${conflicts[0].row_number} cambió al reintentar el mismo lote`, 409, 'ROW_CONFLICT');
      const { rows: inserted } = await client.query(`INSERT INTO import_rows
        (batch_id,entity_type,row_number,source_data,normalized_data,source_id,fingerprint,status,error_code,error_message)
        SELECT $1,r.entity_type,r.row_number,r.source_data,r.normalized_data,r.source_id,r.fingerprint,r.status,r.error_code,r.error_message
        FROM jsonb_to_recordset($2::jsonb) AS r(entity_type text,row_number integer,source_data jsonb,normalized_data jsonb,source_id text,fingerprint char(64),status text,error_code text,error_message text)
        ON CONFLICT (batch_id,entity_type,row_number) DO NOTHING RETURNING id`,
      [batchId, JSON.stringify(values)]);
      await client.query(`UPDATE import_batches SET total_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1)
        WHERE id=$1 AND empresa_id=$2`, [batchId, empresaId]);
      return { inserted: inserted.length, duplicate_rows: values.length - inserted.length };
    });
  }

  async function sealBatch(empresaId, batchId, actorId) {
    requireCompany(empresaId);
    return db.transaction(async (client) => {
      const batch = await getBatch(empresaId, batchId, client, true);
      if (batch.status !== 'uploaded') throw fail('Lote no disponible para revisión', 409, 'BATCH_LOCKED');
      const { rows } = await client.query(`UPDATE import_batches SET
        total_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1),
        valid_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status IN ('valid','warning')),
        invalid_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status='invalid'),
        status='review' WHERE id=$1 AND empresa_id=$2 RETURNING *`, [batchId, empresaId]);
      await client.query('INSERT INTO import_events(batch_id,actor_id,action,details) VALUES ($1,$2,$3,$4::jsonb)',
        [batchId, actorId || null, 'validated', JSON.stringify({ total_rows: rows[0].total_rows, invalid_rows: rows[0].invalid_rows })]);
      return rows[0];
    });
  }

  async function failBatch(empresaId, batchId, actorId, code = 'STAGING_FAILED') {
    requireCompany(empresaId);
    await db.transaction(async (client) => {
      const batch = await getBatch(empresaId, batchId, client, true);
      if (!['uploaded','validating'].includes(batch.status)) return;
      await client.query("UPDATE import_batches SET status='failed',finished_at=NOW() WHERE id=$1 AND empresa_id=$2", [batchId, empresaId]);
      await client.query('INSERT INTO import_events(batch_id,actor_id,action,details) VALUES ($1,$2,$3,$4::jsonb)',
        [batchId, actorId || null, 'staging_failed', JSON.stringify({ code })]);
    });
  }

  async function listBatches(empresaId, { limit = 30, offset = 0 } = {}) {
    requireCompany(empresaId);
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 30)));
    const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    const { rows } = await db.query(`SELECT id,tipo,filename,file_hash_sha256,source_system,status,
      total_rows,valid_rows,invalid_rows,created_rows,updated_rows,skipped_rows,failed_rows,
      created_by,created_at,started_at,finished_at,config
      FROM import_batches WHERE empresa_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
    [empresaId, safeLimit, safeOffset]);
    return rows;
  }

  async function listRows(empresaId, batchId, { limit = 100, offset = 0, status } = {}) {
    await getBatch(empresaId, batchId);
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(Number(limit) || 100)));
    const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    const params = [batchId, safeLimit, safeOffset];
    let filter = '';
    if (status) {
      if (!/^[a-z_]+$/.test(status)) throw fail('Estado no válido');
      params.push(status);
      filter = 'AND status=$4';
    }
    const { rows } = await db.query(`SELECT id,entity_type,row_number,source_data,normalized_data,simulation,
      status,target_id,error_code,error_message,source_id,created_at,updated_at
      FROM import_rows WHERE batch_id=$1 ${filter} ORDER BY entity_type,row_number LIMIT $2 OFFSET $3`, params);
    return rows;
  }

  return { createBatch, stageRows, sealBatch, failBatch, getBatch, listBatches, listRows };
}

module.exports = { TYPES, createImportBatches, normalizeFilename, normalizeSourceSystem, hashRow };
