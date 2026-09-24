const defaultDb = require('./db');
const { evaluateMaster, createMaster, TABLES, compact } = require('./importMasterData');
const { evaluateCost, createCost, TABLES: COST_TABLES } = require('./importCosts');
const { evaluateHistory, createHistory, TABLES: HISTORY_TABLES } = require('./importHistory');
const { evaluateTrip, createTrip, TABLES: TRIP_TABLES } = require('./importTrips');

const ORDER = ['Clientes','Conductores','Vehiculos','Colaboradores','Tarifas','Docs_Conductores','Docs_Vehiculos',
  'Viajes_Historicos','Viajes_Pendientes','Gastos_Operativos','Repostajes','Gastos_Estructura',
  'Facturas_Historicas','Facturas_Lineas','Facturas_Pendientes'];
const ALL_TABLES = { ...TABLES, ...COST_TABLES, ...HISTORY_TABLES, ...TRIP_TABLES };
const activeWorkers = new Set();
const activeSimulations = new Set();
function error(message, status = 409, code = 'IMPORT_STATE') { return Object.assign(new Error(message), { status, code }); }
function identityKey(row) { return `${row.entity_type}\u0000${row.source_id || row.fingerprint || ''}`; }
function naturalKey(row) {
  const d = row.normalized_data || {};
  const key = row.entity_type === 'Clientes' || row.entity_type === 'Colaboradores' ? d.cif
    : row.entity_type === 'Conductores' ? d.dni : row.entity_type === 'Vehiculos' ? d.matricula : null;
  return key ? `${row.entity_type}\u0000${compact(key)}` : null;
}
function stagedDependency(row, planned) {
  const d = row.normalized_data || {};
  if (row.entity_type === 'Docs_Conductores' && d.chofer_dni && planned.Conductores.has(compact(d.chofer_dni))) return true;
  if (row.entity_type === 'Docs_Vehiculos' && d.matricula && planned.Vehiculos.has(compact(d.matricula))) return true;
  if (row.entity_type === 'Tarifas' && d.cliente_cif && planned.Clientes.has(compact(d.cliente_cif))) return true;
  if (['Gastos_Operativos','Repostajes'].includes(row.entity_type) && d.matricula && planned.Vehiculos.has(compact(d.matricula))) return true;
  if (['Facturas_Historicas','Facturas_Pendientes'].includes(row.entity_type) && d.cliente_cif && planned.Clientes.has(compact(d.cliente_cif))) return true;
  if (row.entity_type === 'Viajes_Pendientes' && d.cliente_cif && planned.Clientes.has(compact(d.cliente_cif))) return true;
  if (row.entity_type === 'Facturas_Lineas' && d.factura_source_id && planned.Facturas_Historicas.has(String(d.factura_source_id))) return true;
  if (row.entity_type === 'Gastos_Operativos' && d.pedido_source_id && planned.Viajes_Pendientes.has(String(d.pedido_source_id))) return true;
  return false;
}
function createImportEngine(db = defaultDb) {
  function evaluate(client,empresaId,sourceSystem,row) {
    const args=[client,empresaId,sourceSystem,row.entity_type,row.normalized_data,row.source_id,row.fingerprint];
    return COST_TABLES[row.entity_type] ? evaluateCost(...args)
      : HISTORY_TABLES[row.entity_type] ? evaluateHistory(...args)
        : TRIP_TABLES[row.entity_type] ? evaluateTrip(...args) : evaluateMaster(...args);
  }
  async function getBatch(empresaId, batchId, client = db, lock = false) {
    const { rows } = await client.query(`SELECT * FROM import_batches WHERE id=$1 AND empresa_id=$2${lock ? ' FOR UPDATE' : ''}`, [batchId, empresaId]);
    if (!rows[0]) throw error('Lote no encontrado', 404, 'BATCH_NOT_FOUND');
    return rows[0];
  }
  async function readRows(batchId) {
    const { rows } = await db.query(`SELECT id,entity_type,row_number,normalized_data,status,source_id,fingerprint,simulation
      FROM import_rows WHERE batch_id=$1 ORDER BY entity_type,row_number`, [batchId]);
    return rows;
  }
  async function simulate(empresaId, batchId) {
    const batch = await db.transaction(async client => {
      const current = await getBatch(empresaId, batchId, client, true);
      if (current.tipo === 'Docs_PDF') throw error('Usa la simulación documental para este lote');
      if (!['review','ready','validating'].includes(current.status)) throw error('El lote no está preparado para simular');
      await client.query("UPDATE import_batches SET status='validating',dry_run_at=NULL WHERE id=$1 AND empresa_id=$2", [batchId, empresaId]);
      return current;
    });
    const rows = await readRows(batchId);
    const counts = new Map(), naturalCounts = new Map();
    const planned = { Clientes:new Set(), Conductores:new Set(), Vehiculos:new Set(), Facturas_Historicas:new Set(), Viajes_Pendientes:new Set() };
    for (const row of rows) {
      if (!['valid','warning'].includes(row.status)) continue;
      const key = identityKey(row);
      counts.set(key,(counts.get(key)||0)+1);
      const natural = naturalKey(row);
      if (natural) naturalCounts.set(natural,(naturalCounts.get(natural)||0)+1);
      const d = row.normalized_data || {};
      if (row.status === 'valid' && row.entity_type === 'Clientes' && d.cif) planned.Clientes.add(compact(d.cif));
      if (row.status === 'valid' && row.entity_type === 'Conductores' && d.dni) planned.Conductores.add(compact(d.dni));
      if (row.status === 'valid' && row.entity_type === 'Vehiculos' && d.matricula) planned.Vehiculos.add(compact(d.matricula));
      if (row.status === 'valid' && row.entity_type === 'Facturas_Historicas' && row.source_id) planned.Facturas_Historicas.add(String(row.source_id));
      if (row.status === 'valid' && row.entity_type === 'Viajes_Pendientes' && row.source_id) planned.Viajes_Pendientes.add(String(row.source_id));
    }
    const totals = { new:0, existing:0, review:0, invalid:0, unsupported:0, by_type:{} };
    const updates = [];
    for (const row of rows) {
      if ((await getBatch(empresaId,batchId)).status !== 'validating') return { cancelled:true };
      let decision;
      const natural = naturalKey(row);
      if (row.status === 'invalid') decision = { action:'invalid', reason:'Errores de validación de fila' };
      else if (row.status === 'warning') decision = { action:'review', reason:'Advertencia pendiente de resolver' };
      else if (counts.get(identityKey(row)) > 1 || (natural && naturalCounts.get(natural) > 1)) decision = { action:'review', reason:'Identidad duplicada dentro del archivo' };
      else {
        decision = await evaluate(db, empresaId, batch.source_system, row);
        if (decision.action === 'review' && stagedDependency(row, planned) && /no localizad[oa]/i.test(decision.reason || '')) {
          decision = { action:'create', reason:'El maestro se creará antes dentro de este lote' };
        }
      }
      const bucket = { create:'new', skip:'existing', review:'review', invalid:'invalid', unsupported:'unsupported' }[decision.action] || 'review';
      totals[bucket]++;
      totals.by_type[row.entity_type] ||= { new:0, existing:0, review:0, invalid:0, unsupported:0 };
      totals.by_type[row.entity_type][bucket]++;
      updates.push({ id:row.id, simulation:{ action:decision.action, reason:decision.reason || null, target_id:decision.targetId || null } });
      if (updates.length === 500) { await writeSimulations(batchId, updates); updates.length=0; }
    }
    if (updates.length) await writeSimulations(batchId, updates);
    const completed=await db.query(`UPDATE import_batches SET status='ready',dry_run_at=NOW(),config=jsonb_set(config,'{dry_run}',$3::jsonb,true)
      WHERE id=$1 AND empresa_id=$2 AND status='validating' RETURNING id`, [batchId, empresaId, JSON.stringify(totals)]);
    if(!completed.rows.length)return{cancelled:true};
    await db.query('INSERT INTO import_events(batch_id,action,details) VALUES ($1,$2,$3::jsonb)', [batchId,'dry_run',JSON.stringify(totals)]);
    return totals;
  }
  async function writeSimulations(batchId, rows) {
    await db.query(`UPDATE import_rows r SET simulation=s.simulation,updated_at=NOW()
      FROM jsonb_to_recordset($2::jsonb) AS s(id uuid,simulation jsonb)
      WHERE r.batch_id=$1 AND r.id=s.id`, [batchId, JSON.stringify(rows)]);
  }
  async function startSimulation(empresaId,batchId) {
    if (activeSimulations.has(batchId)) return { id:batchId,status:'validating' };
    await db.transaction(async client => {
      const batch=await getBatch(empresaId,batchId,client,true);
      if (batch.tipo === 'Docs_PDF') throw error('Usa la simulación documental para este lote');
      if (!['review','ready','validating'].includes(batch.status)) throw error('El lote no está disponible para simular');
      await client.query("UPDATE import_batches SET status='validating',dry_run_at=NULL WHERE id=$1 AND empresa_id=$2",[batchId,empresaId]);
    });
    activeSimulations.add(batchId);
    setImmediate(() => simulate(empresaId,batchId).catch(async cause => {
      await db.query("UPDATE import_batches SET status='review' WHERE id=$1 AND empresa_id=$2 AND status='validating'",[batchId,empresaId]).catch(()=>{});
      await db.query('INSERT INTO import_events(batch_id,action,details) VALUES($1,$2,$3::jsonb)',[batchId,'dry_run_failed',JSON.stringify({code:cause.code||'DRY_RUN_FAILED'})]).catch(()=>{});
    }).finally(()=>activeSimulations.delete(batchId)));
    return { id:batchId,status:'validating' };
  }
  async function confirm(empresaId, batchId, actorId) {
    const batch = await db.transaction(async client => {
      const current = await getBatch(empresaId, batchId, client, true);
      if (current.tipo === 'Docs_PDF') throw error('Usa la confirmación documental para este lote');
      if (current.status !== 'ready' || !current.dry_run_at) throw error('Simula y revisa el lote antes de confirmar');
      await client.query("UPDATE import_batches SET status='running',started_at=NOW() WHERE id=$1 AND empresa_id=$2", [batchId, empresaId]);
      await client.query('INSERT INTO import_events(batch_id,actor_id,action) VALUES ($1,$2,$3)', [batchId,actorId||null,'confirmed']);
      return current;
    });
    schedule(empresaId, batchId);
    return { id: batch.id, status:'running' };
  }
  function schedule(empresaId, batchId) {
    if (activeWorkers.has(batchId)) return;
    activeWorkers.add(batchId);
    setImmediate(() => run(empresaId,batchId).catch(async cause => {
      await db.query("UPDATE import_batches SET status='failed',finished_at=NOW() WHERE id=$1 AND empresa_id=$2 AND status='running'",[batchId,empresaId]).catch(()=>{});
      await db.query('INSERT INTO import_events(batch_id,action,details) VALUES ($1,$2,$3::jsonb)',[batchId,'worker_failed',JSON.stringify({ code:cause.code||'WORKER_FAILED' })]).catch(()=>{});
    }).finally(() => activeWorkers.delete(batchId)));
  }
  async function run(empresaId,batchId) {
    const batch = await getBatch(empresaId,batchId);
    if (batch.status !== 'running') return;
    const rows = await readRows(batchId);
    rows.sort((a,b) => (ORDER.indexOf(a.entity_type) < 0 ? 99 : ORDER.indexOf(a.entity_type)) - (ORDER.indexOf(b.entity_type) < 0 ? 99 : ORDER.indexOf(b.entity_type)) || a.row_number-b.row_number);
    let processed = 0;
    for (const row of rows) {
      if (!['create','skip'].includes(row.simulation?.action) || row.status !== 'valid') continue;
      try {
        await db.transaction(async client => {
          const currentBatch = await getBatch(empresaId,batchId,client,true);
          if (currentBatch.status !== 'running') return;
          const currentRow = (await client.query('SELECT * FROM import_rows WHERE id=$1 AND batch_id=$2 FOR UPDATE',[row.id,batchId])).rows[0];
          if (!currentRow || currentRow.status !== 'valid') return;
          const decision = await evaluate(client,empresaId,batch.source_system,currentRow);
          if (!['create','skip'].includes(decision.action)) throw error(decision.reason || 'La fila requiere revisión',409,'ROW_REVIEW');
          if (currentRow.simulation?.action === 'skip' && decision.action === 'create') throw error('El registro existente cambió tras la simulación',409,'DRY_RUN_CHANGED');
          const target = decision.action === 'create'
            ? (COST_TABLES[currentRow.entity_type]
              ? await createCost(client,empresaId,batchId,batch.source_system,currentRow.entity_type,currentRow.normalized_data,decision)
              : HISTORY_TABLES[currentRow.entity_type]
                ? await createHistory(client,empresaId,batchId,batch.source_system,currentRow.entity_type,currentRow.normalized_data,decision)
                : TRIP_TABLES[currentRow.entity_type]
                  ? await createTrip(client,empresaId,batchId,batch.source_system,currentRow.entity_type,currentRow.normalized_data,decision)
                : await createMaster(client,empresaId,batchId,currentRow.entity_type,currentRow.normalized_data,decision))
            : { table:ALL_TABLES[currentRow.entity_type], id:decision.targetId };
          if (!target.id) throw error('No se pudo verificar el destino de la fila',409,'TARGET_NOT_FOUND');
          const targetSnapshot = decision.action === 'create'
            ? (await client.query(`SELECT to_jsonb(t) AS snapshot FROM ${target.table} t WHERE id=$1`,[target.id])).rows[0]?.snapshot : null;
          const auxiliary = target.auxiliary ? { ...target.auxiliary,
            snapshot:(await client.query(`SELECT to_jsonb(t) AS snapshot FROM ${target.auxiliary.table} t WHERE id=$1`,[target.auxiliary.id])).rows[0]?.snapshot } : null;
          if (!decision.identityExisting) {
            await client.query(`INSERT INTO import_identities(empresa_id,entity_type,source_system,source_id,fingerprint,target_table,target_id,created_by_batch_id)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [empresaId,currentRow.entity_type,batch.source_system,currentRow.source_id,currentRow.fingerprint,target.table,target.id,batchId]);
          }
          await client.query(`UPDATE import_rows SET status=$3,target_id=$4,target_snapshot=$5::jsonb,auxiliary_target=$6::jsonb,
            error_code=NULL,error_message=NULL,updated_at=NOW() WHERE id=$1 AND batch_id=$2`,
          [row.id,batchId,decision.action==='create'?'created':'skipped',target.id,
            targetSnapshot?JSON.stringify(targetSnapshot):null,auxiliary?JSON.stringify(auxiliary):null]);
        });
      } catch (cause) {
        await db.query(`UPDATE import_rows SET status='failed',error_code=$3,error_message=$4,updated_at=NOW()
          WHERE id=$1 AND batch_id=$2 AND status='valid'`,[row.id,batchId,cause.code||'ROW_FAILED',String(cause.message||'Error de fila').slice(0,500)]);
      }
      processed++;
      if (processed % 50 === 0) await refreshCounters(empresaId,batchId);
    }
    await refreshCounters(empresaId,batchId);
    await db.query(`UPDATE import_batches SET
      status=CASE WHEN EXISTS(SELECT 1 FROM import_rows WHERE batch_id=$1 AND status NOT IN ('created','skipped'))
        THEN 'completed_with_errors' ELSE 'completed' END,
      finished_at=NOW() WHERE id=$1 AND empresa_id=$2 AND status='running'`,[batchId,empresaId]);
  }
  async function cancel(empresaId,batchId,actorId){
    return db.transaction(async client=>{
      const batch=await getBatch(empresaId,batchId,client,true);
      if(!['review','ready','validating','running'].includes(batch.status))throw error('El lote ya está detenido');
      await client.query("UPDATE import_batches SET status='cancelled',finished_at=NOW() WHERE id=$1 AND empresa_id=$2",[batchId,empresaId]);
      await client.query('INSERT INTO import_events(batch_id,actor_id,action) VALUES($1,$2,$3)',[batchId,actorId||null,'cancelled']);
      return{id:batchId,status:'cancelled'};
    });
  }
  async function continueBatch(empresaId,batchId,actorId){
    const batch=await db.transaction(async client=>{
      const current=await getBatch(empresaId,batchId,client,true);
      if(!['cancelled','failed'].includes(current.status))throw error('El lote no está detenido');
      const hasWork=(await client.query("SELECT 1 FROM import_rows WHERE batch_id=$1 AND status='valid' LIMIT 1",[batchId])).rows.length>0;
      if(!hasWork)throw error('No quedan filas pendientes; usa Reintentar errores si procede');
      if(!current.dry_run_at&&Number(current.created_rows)>0)throw error('No se puede repetir la simulación de un lote parcialmente aplicado');
      const next=hasWork&&current.dry_run_at?'running':'review';
      await client.query('UPDATE import_batches SET status=$3,finished_at=NULL WHERE id=$1 AND empresa_id=$2',[batchId,empresaId,next]);
      await client.query('INSERT INTO import_events(batch_id,actor_id,action) VALUES($1,$2,$3)',[batchId,actorId||null,'resumed']);
      return{id:batchId,status:next};
    });
    if(batch.status==='running')schedule(empresaId,batchId);
    return batch;
  }
  async function retryErrors(empresaId,batchId,actorId){
    const result=await db.transaction(async client=>{
      const batch=await getBatch(empresaId,batchId,client,true);
      if(!['completed_with_errors','failed'].includes(batch.status))throw error('No hay errores de un lote detenido para reintentar');
      const retried=await client.query(`UPDATE import_rows SET status='valid',error_code=NULL,error_message=NULL,updated_at=NOW()
        WHERE batch_id=$1 AND status='failed' AND simulation->>'action' IN ('create','skip') RETURNING id`,[batchId]);
      const pending=(await client.query("SELECT 1 FROM import_rows WHERE batch_id=$1 AND status='valid' LIMIT 1",[batchId])).rows.length>0;
      if(!pending)throw error('No hay errores reintentables; corrige el archivo y crea otro lote');
      await client.query("UPDATE import_batches SET status='running',finished_at=NULL WHERE id=$1 AND empresa_id=$2",[batchId,empresaId]);
      await client.query('INSERT INTO import_events(batch_id,actor_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
        [batchId,actorId||null,'retry_errors',JSON.stringify({rows:retried.rows.length})]);
      return{id:batchId,status:'running',retried:retried.rows.length};
    });
    schedule(empresaId,batchId);
    return result;
  }
  async function refreshCounters(empresaId,batchId) {
    await db.query(`UPDATE import_batches SET
      created_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status='created'),
      skipped_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status='skipped'),
      failed_rows=(SELECT count(*) FROM import_rows WHERE batch_id=$1 AND status='failed')
      WHERE id=$1 AND empresa_id=$2 AND status='running'`,[batchId,empresaId]);
  }
  async function resume() {
    const { rows } = await db.query("SELECT id,empresa_id,status FROM import_batches WHERE tipo<>'Docs_PDF' AND status IN ('running','validating') ORDER BY created_at LIMIT 100");
    for (const row of rows) row.status === 'running' ? schedule(row.empresa_id,row.id) : await startSimulation(row.empresa_id,row.id);
  }
  return { simulate, startSimulation, confirm, run, resume, cancel, continueBatch, retryErrors };
}
module.exports = { createImportEngine };
