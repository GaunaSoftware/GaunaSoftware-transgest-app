const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isPublishedHistoricalVariant } = require('./migrationHistory');
const { sortMigrationFiles } = require('./migrationHistory');
const migrationFiles=sortMigrationFiles(fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>n.endsWith('.sql')));
for (const extension of ['groupage','journey_costs']) assert.ok(
  migrationFiles.indexOf('20260926_operational_model.sql') < migrationFiles.indexOf('20260926_operational_model_'+extension+'.sql'),
  'Operational base must precede its extensions on every locale');
const original = '3e40fa76cccb251472f7ac364174f77771d6819982b0d772fc39318b925bea90';
const published = '046a56f955e70ee7d83b9be4deaa863084a2049fbe9cbcbc0e0b67b962c535e7';
const sql = fs.readFileSync(path.join(__dirname, 'migrations/003_operational_normalization.sql'), 'utf8').replace(/\r\n/g, '\n');
assert.equal(crypto.createHash('sha256').update(sql).digest('hex'), original);
assert.equal(isPublishedHistoricalVariant('003_operational_normalization', published, original), true);
assert.equal(isPublishedHistoricalVariant('003_operational_normalization', 'unknown', original), false);
assert.equal(isPublishedHistoricalVariant('003_operational_normalization', published, 'edited'), false);
assert.equal(isPublishedHistoricalVariant('004_taller_neumaticos_trace', published, original), false);
console.log('Migration history: original preserved; only documented historical variants accepted.');
