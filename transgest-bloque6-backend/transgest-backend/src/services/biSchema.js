// Apply only the two additive BI migrations before the report routes are served.
// Render's runtime does not execute scripts/migrate.js as part of npm start.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const files = ['20260923_bi_report_center.sql', '20260923_bi_weekly_delivery.sql'];
const directory = path.join(__dirname, '../../scripts/migrations');

async function ensureSchema({ query = db.query, transaction = db.transaction } = {}) {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id varchar(180) PRIMARY KEY,
    name varchar(220) NOT NULL,
    checksum varchar(80) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const file of files) {
    const id = path.basename(file, '.sql');
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const existing = await query('SELECT checksum FROM schema_migrations WHERE id=$1', [id]);
    if (existing.rows[0]?.checksum === checksum) continue;
    if (existing.rows[0]) throw new Error(`Migración BI ${id}: checksum distinto al publicado`);
    await transaction(async client => {
      await client.query(sql);
      const inserted = await client.query(`INSERT INTO schema_migrations(id,name,checksum)
        VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id`, [id, file, checksum]);
      if (!inserted.rows.length) {
        const raced = await client.query('SELECT checksum FROM schema_migrations WHERE id=$1', [id]);
        if (raced.rows[0]?.checksum !== checksum) throw new Error(`Migración BI ${id}: carrera con otro checksum`);
      }
    });
  }
}

module.exports = { ensureSchema };
