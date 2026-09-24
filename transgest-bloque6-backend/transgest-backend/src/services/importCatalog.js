const HEADERS = Object.freeze({
  Clientes: 'source_id,nombre,cif,telefono,email,direccion,poblacion,provincia,codigo_postal,pais,notas',
  Conductores: 'source_id,nombre,apellidos,dni,telefono,movil_empresa,fecha_nacimiento,fecha_alta,estado,categoria_carnet,notas',
  Vehiculos: 'source_id,matricula,tipo,marca,modelo,estado,notas',
  Colaboradores: 'source_id,nombre,cif,telefono,email,direccion,poblacion,provincia,codigo_postal,notas',
  Tarifas: 'source_id,cliente_cif,nombre,origen,destino,km,precio,unidad,fecha_desde,fecha_hasta,notas',
  Docs_Conductores: 'source_id,chofer_dni,chofer_nombre,tipo_doc,fecha_emision,fecha_vencimiento,estado_vencimiento,numero_doc,organismo,archivo_nombre,notas',
  Docs_Vehiculos: 'source_id,matricula,tipo_doc,fecha_emision,fecha_vencimiento,estado_vencimiento,numero_doc,organismo,archivo_nombre,notas',
  Viajes_Historicos: 'source_id,numero_origen,cliente_cif,cliente_nombre,referencia_cliente,origen,destino,fecha_carga,hora_carga,fecha_descarga,hora_descarga,matricula_tractora,matricula_remolque,chofer_dni,colaborador_cif,mercancia,peso_kg,bultos,km_ruta,km_vacio,importe,precio_colaborador,coste_gasoil,coste_peajes,coste_dietas,coste_otros,estado,notas',
  Viajes_Pendientes: 'source_id,numero_origen,cliente_cif,cliente_nombre,referencia_cliente,origen,destino,fecha_carga,hora_carga,fecha_descarga,hora_descarga,matricula_tractora,matricula_remolque,chofer_dni,colaborador_cif,mercancia,peso_kg,bultos,km_ruta,km_vacio,importe,precio_colaborador,coste_gasoil,coste_peajes,coste_dietas,coste_otros,estado,notas',
  Facturas_Historicas: 'source_id,numero_origen,serie_origen,fecha,cliente_nombre,cliente_cif,total,tipo_operacion,rectificativa,rectifica_referencia,estado_historico,origen,notas',
  Facturas_Lineas: 'source_id,factura_source_id,linea,importe,vehiculo_matricula,tipo_operacion,fecha_factura_proveedor,proveedor,factura_proveedor,coste_proveedor,beneficio_origen,observaciones',
  Facturas_Pendientes: 'source_id,numero_origen,serie_origen,fecha,fecha_vencimiento,cliente_cif,cliente_nombre,total,cobrado,saldo_pendiente,notas',
  Gastos_Operativos: 'source_id,tipo,subtipo,proveedor,matricula,pedido_source_id,chofer_dni,periodo_desde,periodo_hasta,fecha,pais,importe,iva_pct,referencia,notas',
  Repostajes: 'source_id,matricula,fecha,hora,litros,precio_litro,importe,km_odometro,proveedor,referencia,notas',
  Gastos_Estructura: 'source_id,nombre,tipo,importe,periodo,fecha,notas',
});
const REQUIRED = Object.freeze({
  Clientes: ['nombre','cif'], Conductores: ['nombre'], Vehiculos: ['matricula'],
  Colaboradores: ['nombre'], Tarifas: ['cliente_cif','origen','destino','precio'],
  Docs_Conductores: ['tipo_doc'], Docs_Vehiculos: ['matricula','tipo_doc'],
  Viajes_Historicos: ['cliente_nombre','origen','destino','fecha_carga'],
  Viajes_Pendientes: ['cliente_nombre','origen','destino','fecha_carga'],
  Facturas_Historicas: ['numero_origen','fecha','cliente_nombre','total'],
  Facturas_Lineas: ['factura_source_id','linea','importe'],
  Facturas_Pendientes: ['numero_origen','cliente_nombre','total'],
  Gastos_Operativos: ['tipo','importe'], Repostajes: ['matricula','fecha','litros','importe'],
  Gastos_Estructura: ['nombre','importe','fecha'],
});
const ALIASES = Object.freeze({
  matricula: ['matrícula','matricula vehiculo','matrícula vehículo'],
  codigo_postal: ['código postal','cp'],
  fecha_vencimiento: ['fecha de vencimiento'],
  fecha_carga: ['fecha de carga'],
  fecha_descarga: ['fecha de descarga'],
  cliente_cif: ['cif cliente'],
  chofer_dni: ['dni conductor','dni chófer'],
  tipo_doc: ['tipo documento'],
  source_id: ['id origen','identificador origen'],
});
const PROVENANCE_HEADERS = new Set(['source_sheet', 'source_row']);

function normalizeHeader(value) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function columnsFor(type) { return HEADERS[type]?.split(',') || null; }
function mapHeaders(type, headers, manual = {}) {
  const columns = columnsFor(type);
  if (!columns) throw Object.assign(new Error(`Plantilla no reconocida: ${type}`), { status: 400 });
  const byAlias = new Map();
  for (const column of columns) {
    for (const alias of [column, column.replace(/_/g, ' '), ...(ALIASES[column] || [])]) {
      const normalized = normalizeHeader(alias);
      if (!byAlias.has(normalized)) byAlias.set(normalized, column);
    }
  }
  const mapped = [];
  const errors = [];
  const used = new Set();
  for (const raw of headers) {
    const key = String(raw ?? '').trim();
    const hasManual = Object.prototype.hasOwnProperty.call(manual, key);
    if (!hasManual && PROVENANCE_HEADERS.has(key)) { mapped.push(null); continue; }
    const target = hasManual ? manual[key] : byAlias.get(normalizeHeader(key));
    if (hasManual && target == null) { mapped.push(null); continue; }
    if (!target || !columns.includes(target)) errors.push(`Columna no reconocida: ${key || '(vacía)'}`);
    else if (used.has(target)) errors.push(`Columna duplicada: ${target}`);
    else used.add(target);
    mapped.push(target || null);
  }
  for (const column of REQUIRED[type] || []) if (!used.has(column)) errors.push(`Falta columna obligatoria: ${column}`);
  return { mapped, errors };
}
module.exports = { HEADERS, REQUIRED, ALIASES, columnsFor, normalizeHeader, mapHeaders };
