const DRIVER_DOC_TYPES = new Set('dni,pasaporte,permiso_conducir,permiso_camion,cap,tarjeta_tacografo,adr,reconocimiento_medico,certificado_formacion,certificado_comunitario,a1_ta300,road_cert,contrato_laboral,otro'.split(','));
const VEHICLE_DOC_TYPES = new Set('itv,seguro,permiso_circulacion,ficha_tecnica,tarjeta_transporte,tacografo,contrato_renting,contrato_leasing,mantenimiento,extintor,otro'.split(','));
const TARIFF_TYPES = new Set('viaje,kg,tonelada,km,hora,palet'.split(','));
const TABLES = Object.freeze({
  Clientes: 'clientes', Conductores: 'choferes', Vehiculos: 'vehiculos',
  Colaboradores: 'colaboradores', Tarifas: 'ruta_precios_cliente',
  Docs_Conductores: 'docs_choferes', Docs_Vehiculos: 'docs_vehiculos',
});
function compact(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim() || null; }
function one(rows, label) {
  if (rows.length > 1) return { action: 'review', reason: `${label}: varias coincidencias` };
  return rows[0] || null;
}
async function findNatural(client, empresaId, type, data) {
  if (type === 'Clientes') {
    if (!text(data.cif)) return { action: 'review', reason: 'Cliente sin CIF/NIF' };
    return one((await client.query('SELECT id FROM clientes WHERE empresa_id=$1 AND UPPER(TRIM(cif))=$2 LIMIT 2', [empresaId, text(data.cif).toUpperCase()])).rows, 'CIF cliente');
  }
  if (type === 'Conductores') {
    if (!text(data.dni)) return null;
    return one((await client.query("SELECT id FROM choferes WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(dni),'[^A-Z0-9]','','g')=$2 LIMIT 2", [empresaId, compact(data.dni)])).rows, 'DNI conductor');
  }
  if (type === 'Vehiculos') {
    return one((await client.query("SELECT id FROM vehiculos WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g')=$2 LIMIT 2", [empresaId, compact(data.matricula)])).rows, 'matrícula');
  }
  if (type === 'Colaboradores') {
    if (!text(data.cif)) return null;
    return one((await client.query('SELECT id FROM colaboradores WHERE empresa_id=$1 AND UPPER(TRIM(cif))=$2 LIMIT 2', [empresaId, text(data.cif).toUpperCase()])).rows, 'CIF colaborador');
  }
  if (type === 'Docs_Conductores') {
    if (!DRIVER_DOC_TYPES.has(String(data.tipo_doc || '').toLowerCase())) return { action: 'review', reason: 'Tipo de documento de conductor no reconocido' };
    if (!text(data.chofer_dni)) return { action: 'review', reason: 'Indica DNI del conductor; el nombre solo sirve para revisión' };
    const match = one((await client.query("SELECT id FROM choferes WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(dni),'[^A-Z0-9]','','g')=$2 LIMIT 2", [empresaId, compact(data.chofer_dni)])).rows, 'conductor');
    return match?.action ? match : match ? { parentId: match.id } : { action: 'review', reason: 'Conductor no localizado' };
  }
  if (type === 'Docs_Vehiculos') {
    if (!VEHICLE_DOC_TYPES.has(String(data.tipo_doc || '').toLowerCase())) return { action: 'review', reason: 'Tipo de documento de vehículo no reconocido' };
    const match = one((await client.query("SELECT id FROM vehiculos WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g')=$2 LIMIT 2", [empresaId, compact(data.matricula)])).rows, 'vehículo');
    return match?.action ? match : match ? { parentId: match.id } : { action: 'review', reason: 'Vehículo no localizado' };
  }
  if (type === 'Tarifas') {
    if (!TARIFF_TYPES.has(String(data.unidad || 'viaje').toLowerCase())) return { action: 'review', reason: 'Unidad de tarifa no reconocida' };
    if (data.precio == null) return { action: 'review', reason: 'Tarifa sin precio' };
    const clients = (await client.query('SELECT id FROM clientes WHERE empresa_id=$1 AND UPPER(TRIM(cif))=$2 LIMIT 2', [empresaId, text(data.cliente_cif)?.toUpperCase() || ''])).rows;
    const customer = one(clients, 'cliente de tarifa');
    if (!customer || customer.action) return customer?.action ? customer : { action: 'review', reason: 'Cliente de tarifa no localizado' };
    const routes = (await client.query(`SELECT r.id,rc.id AS price_id FROM rutas r
      LEFT JOIN ruta_precios_cliente rc ON rc.ruta_id=r.id AND rc.cliente_id=$2
      WHERE r.empresa_id=$1 AND UPPER(TRIM(r.origen))=$3 AND UPPER(TRIM(r.destino))=$4 LIMIT 2`,
    [empresaId, customer.id, text(data.origen)?.toUpperCase() || '', text(data.destino)?.toUpperCase() || ''])).rows;
    const route = one(routes, 'ruta');
    if (route?.action) return route;
    if (route?.price_id) return { action: 'skip', targetId: route.price_id, reason: 'Tarifa existente; no se sobrescribe' };
    if (!route && (!Number.isInteger(data.km) || data.km < 0)) return { action: 'review', reason: 'Nueva ruta sin kilómetros enteros verificables' };
    return { action: 'create', customerId: customer.id, routeId: route?.id || null, table: TABLES[type] };
  }
  return null;
}
async function evaluateMaster(client, empresaId, sourceSystem, type, data, sourceId, fingerprint) {
  if (!TABLES[type]) return { action: 'unsupported', reason: 'Este tipo aún no se puede confirmar' };
  if (!data || typeof data !== 'object') return { action: 'review', reason: 'Fila sin datos normalizados' };
  const natural = await findNatural(client, empresaId, type, data);
  const identity = (await client.query(`SELECT target_id,target_table FROM import_identities
    WHERE empresa_id=$1 AND entity_type=$2 AND source_system=$3 AND
      (($4::text IS NOT NULL AND source_id=$4) OR ($4::text IS NULL AND source_id IS NULL AND fingerprint=$5)) LIMIT 1`,
  [empresaId, type, sourceSystem, sourceId || null, fingerprint || null])).rows[0];
  if (natural?.action === 'review') return natural;
  if (identity) {
    if (natural?.id && natural.id !== identity.target_id) return { action: 'review', reason: 'Identidad de origen y documento apuntan a registros distintos' };
    return { action: 'skip', targetId: identity.target_id, identityExisting: true, reason: 'Origen ya importado' };
  }
  if (natural?.id) return { action: 'skip', targetId: natural.id, reason: 'Registro maestro existente; no se sobrescribe' };
  if (natural?.action === 'skip') return natural;
  if (natural?.action === 'create') return natural;
  if (natural?.parentId) return { action: 'create', parentId: natural.parentId, table: TABLES[type] };
  return { action: 'create', table: TABLES[type] };
}
async function createMaster(client, empresaId, batchId, type, data, decision) {
  if (decision.action !== 'create') throw new Error('La fila no está autorizada para crear');
  let sql, params;
  if (type === 'Clientes') {
    sql = `INSERT INTO clientes(empresa_id,nombre,cif,direccion,cp,ciudad,provincia,pais,email,telefono,notas,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`;
    params = [empresaId,text(data.nombre),text(data.cif)?.toUpperCase(),text(data.direccion),text(data.codigo_postal),text(data.poblacion),text(data.provincia),text(data.pais)||'España',text(data.email),text(data.telefono),text(data.notas),batchId];
  } else if (type === 'Conductores') {
    const active = String(data.estado || 'activo').toLowerCase() !== 'inactivo';
    sql = `INSERT INTO choferes(empresa_id,nombre,apellidos,dni,telefono,movil_empresa,fecha_nacimiento,fecha_alta,activo,estado,categoria_carnet,notas,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`;
    params = [empresaId,text(data.nombre),text(data.apellidos),text(data.dni)?.toUpperCase(),text(data.telefono),text(data.movil_empresa),data.fecha_nacimiento||null,data.fecha_alta||null,active,active?'disponible':'baja',text(data.categoria_carnet)||'C+E',text(data.notas),batchId];
  } else if (type === 'Vehiculos') {
    const state = String(data.estado || '').toLowerCase();
    const active = !['inactivo','baja'].includes(state);
    const vehicleState = ['disponible','en_ruta','taller'].includes(state) ? state : active ? 'disponible' : 'baja';
    sql = `INSERT INTO vehiculos(empresa_id,matricula,tipo,marca,modelo,activo,estado,notas,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`;
    params = [empresaId,text(data.matricula),text(data.tipo)||'Camión',text(data.marca),text(data.modelo),active,vehicleState,text(data.notas),batchId];
  } else if (type === 'Colaboradores') {
    sql = `INSERT INTO colaboradores(empresa_id,tipo,nombre,cif,telefono,email,calle,ciudad,provincia,codigo_postal,notas,import_batch_id)
      VALUES($1,'empresa',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`;
    params = [empresaId,text(data.nombre),text(data.cif)?.toUpperCase(),text(data.telefono),text(data.email),text(data.direccion),text(data.poblacion),text(data.provincia),text(data.codigo_postal),text(data.notas),batchId];
  } else if (type === 'Docs_Conductores' || type === 'Docs_Vehiculos') {
    const table = TABLES[type];
    const foreign = type === 'Docs_Conductores' ? 'chofer_id' : 'vehiculo_id';
    sql = `INSERT INTO ${table}(empresa_id,${foreign},tipo,tipo_doc,descripcion,fecha_emision,fecha_vencimiento,referencia,
      estado_vencimiento,numero_doc,organismo,archivo_nombre,notas,import_batch_id)
      VALUES($1,$2,'otro',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`;
    params = [empresaId,decision.parentId,text(data.tipo_doc),text(data.tipo_doc),data.fecha_emision||null,data.fecha_vencimiento||null,
      text(data.numero_doc),text(data.estado_vencimiento),text(data.numero_doc),text(data.organismo),text(data.archivo_nombre),text(data.notas),batchId];
  } else if (type === 'Tarifas') {
    let routeId = decision.routeId;
    if (!routeId) {
      const route = await client.query(`INSERT INTO rutas(empresa_id,cliente_id,origen,destino,km,notas,tarifa_tipo,precio_base,import_batch_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [empresaId,decision.customerId,text(data.origen),text(data.destino),data.km,text(data.notas),text(data.unidad)||'viaje',data.precio,batchId]);
      routeId = route.rows[0].id;
    }
    const price = await client.query(`INSERT INTO ruta_precios_cliente(ruta_id,cliente_id,precio,tarifa_tipo,empresa_id,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [routeId,decision.customerId,data.precio,text(data.unidad)||'viaje',empresaId,batchId]);
    return { table: TABLES[type], id: price.rows[0].id,
      auxiliary: decision.routeId ? null : { table:'rutas', id:routeId } };
  } else throw new Error('Tipo de maestro no implementado');
  const { rows } = await client.query(sql, params);
  return { table: TABLES[type], id: rows[0].id };
}
module.exports = { TABLES, compact, evaluateMaster, createMaster };
