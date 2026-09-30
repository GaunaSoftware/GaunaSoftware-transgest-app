const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const serviceRoot = path.resolve(__dirname, '../src/services');
const trafficPath = require.resolve(path.join(serviceRoot, 'trafficAssignment'));
const planPath = require.resolve(path.join(serviceRoot, 'groupagePlan'));
const assignmentPath = require.resolve(path.join(serviceRoot, 'journeyAssignment'));
const validations = [];
const plans = [];
require.cache[trafficPath] = { id: trafficPath, filename: trafficPath, loaded: true, exports: {
  validateTrafficAssignment: async (_tx, empresaId, aggregate, patch) => { validations.push({ empresaId, aggregate, patch }); return []; }
}};
require.cache[planPath] = { id: planPath, filename: planPath, loaded: true, exports: {
  saveGroupagePlan: async (_tx, input) => { plans.push(input); return { ok: true, viaje_id: crypto.randomUUID(), grupaje_id: input.grupajeId, borrador: !input.confirm }; }
}};
const { assignGroupage } = require(assignmentPath);
const company = crypto.randomUUID(), group = crypto.randomUUID();
const orders = [1000, 1500].map((peso, i) => ({
  id: crypto.randomUUID(), empresa_id: company, grupaje_id: group, estado: 'pendiente',
  peso_kg: peso, palets_cantidad: i + 1, fecha_carga: '2026-09-30', fecha_descarga: '2026-10-01',
  origen: 'Madrid', destino: 'Alicante', mercancia: 'Cemento'
}));
let truck;
let trailerId;
let update;
let conjuntoUpdate;
let occupiedDriver = false;
const tx = { query: async (sql, params = []) => {
  if (sql.includes('SELECT * FROM pedidos WHERE empresa_id=$1 AND grupaje_id=')) return { rows: params[0] === company ? orders : [] };
  if (sql.includes('SELECT * FROM vehiculos WHERE empresa_id=$1 AND id=$2')) return { rows: truck && params[0] === company && params[1] === truck.id ? [truck] : [] };
  if (sql.includes('SELECT clase,tipo FROM vehiculos WHERE empresa_id=$1 AND id=$2')) return { rows: params[0] === company && params[1] === trailerId ? [{ clase: 'Semirremolque' }] : [] };
  if (sql.includes('SELECT matricula FROM vehiculos WHERE empresa_id=$1 AND chofer_id=$2')) return { rows: occupiedDriver ? [{matricula:'OTRO'}] : [] };
  if (sql.startsWith('UPDATE vehiculos SET chofer_id=')) { conjuntoUpdate = params; return { rows: [] }; }
  if (sql.startsWith('UPDATE pedidos SET')) { update = { sql, params }; return { rows: [] }; }
  return { rows: [] };
}};
const operation = () => crypto.randomUUID();
async function main() {
  truck = { id: crypto.randomUUID(), clase: 'Camion rigido', remolque_id: crypto.randomUUID() };
  const rigid = await assignGroupage(tx, { empresaId: company, groupId: group, actorId: crypto.randomUUID(), operationId: operation(), saveOperationId: operation(), confirm: true, requireConjunto: true, patch: { vehiculo_id: truck.id } });
  assert.equal(rigid.borrador, false);
  assert.equal(validations.at(-1).patch.remolque_id, null, 'A rigid truck must use its own body, not an attached trailer by default');
  assert.equal(validations.at(-1).aggregate.peso_kg, 2500, 'Review must use aggregate cargo');
  assert.equal(plans.at(-1).confirm, true);
  assert(update.sql.includes('remolque_id='));
  truck = { id: crypto.randomUUID(), clase: 'Tractora', remolque_id: null };
  await assert.rejects(assignGroupage(tx, { empresaId: company, groupId: group, operationId: operation(), requireConjunto: true, patch: { vehiculo_id: truck.id } }), { code: 'ASSIGNMENT_TRAILER' });
  const selectedTrailer = crypto.randomUUID();
  trailerId = selectedTrailer;
  await assignGroupage(tx, { empresaId: company, groupId: group, operationId: operation(), requireConjunto: true, patch: { vehiculo_id: truck.id, remolque_id: selectedTrailer } });
  assert.equal(validations.at(-1).patch.remolque_id, selectedTrailer);
  const selectedDriver=crypto.randomUUID();
  await assignGroupage(tx, { empresaId: company, groupId: group, operationId: operation(), requireConjunto: true, patch: { vehiculo_id: truck.id, remolque_id: selectedTrailer, chofer_id:selectedDriver, sync_conjunto:true } });
  assert.deepEqual(conjuntoUpdate,[company,truck.id,selectedDriver,selectedTrailer], 'The selected outfit must update the truck record');
  occupiedDriver=true;
  await assert.rejects(assignGroupage(tx, { empresaId: company, groupId: group, operationId: operation(), requireConjunto: true, patch: { vehiculo_id: truck.id, remolque_id: selectedTrailer, chofer_id:selectedDriver, sync_conjunto:true } }), {code:'DRIVER_CONJUNTO_CONFLICT'});
  occupiedDriver=false;
  await assert.rejects(assignGroupage(tx, { empresaId: company, groupId: group, operationId: operation(), requireConjunto: true, patch: { vehiculo_id: truck.id, remolque_id: crypto.randomUUID() } }), { code: 'ASSIGNMENT_TRAILER' });
  await assert.rejects(assignGroupage(tx, { empresaId: crypto.randomUUID(), groupId: group, operationId: operation(), requireConjunto: true, patch: { vehiculo_id: truck.id } }), { code: 'GROUPAGE_NOT_FOUND' });
  console.log('PASS groupage conjunto: rigid body, explicit tractor trailer, aggregate cargo, one confirmed plan and tenant scope.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
