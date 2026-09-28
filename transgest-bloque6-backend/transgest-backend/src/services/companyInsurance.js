const { can } = require('./noticeCenter');

const denied = () => Object.assign(new Error('Seguros de empresa no autorizados.'), { status: 403 });
const invalid = message => Object.assign(new Error(message), { status: 400 });
function authorize(user, edit = false) {
  if (!user?.empresa_id || !['gerente','contable','administrativo'].includes(user.rol) || !can(user, 'avisos') || !can(user, 'empresa') || (edit && (user.rol !== 'gerente' || !can(user, 'empresa', 'editar')))) throw denied();
}
function string(value, max, label, required = false) {
  const result = String(value ?? '').replace(/\s+/g, ' ').trim();
  if ((required && !result) || result.length > max) throw invalid(`${label}: indica un texto de hasta ${max} caracteres.`);
  return result || null;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('Indica una fecha de vencimiento válida.');
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== value) throw invalid('Indica una fecha de vencimiento válida.');
  return value;
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Datos de póliza no válidos.');
  const frequency = input.periodicidad ? string(input.periodicidad, 24, 'Periodicidad') : null;
  if (frequency && !['mensual','trimestral','semestral','anual','otra'].includes(frequency)) throw invalid('Periodicidad no válida.');
  let amount = null;
  if (input.importe_referencia !== null && input.importe_referencia !== undefined && input.importe_referencia !== '') {
    const raw = String(input.importe_referencia).trim();
    if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) throw invalid('El importe de referencia debe ser positivo y expresado en euros.');
    amount = Number(raw);
  }
  if (input.activo !== undefined && typeof input.activo !== 'boolean') throw invalid('Estado de póliza no válido.');
  return {
    aseguradora: string(input.aseguradora,160,'Aseguradora',true),
    cobertura: string(input.cobertura,200,'Cobertura',true),
    numero_poliza: string(input.numero_poliza,120,'Número de póliza'),
    matricula_referencia: string(input.matricula_referencia,32,'Matrícula'),
    fecha_vencimiento: validDate(input.fecha_vencimiento),
    periodicidad: frequency,
    importe_referencia: amount,
    correduria: string(input.correduria,160,'Correduría'),
    notas: string(input.notas,2000,'Notas'),
    activo: input.activo !== false,
  };
}
async function list(db, user) {
  authorize(user);
  const { rows } = await db.query(`SELECT id,aseguradora,cobertura,numero_poliza,matricula_referencia,fecha_vencimiento,periodicidad,importe_referencia,correduria,notas,activo,updated_at
    FROM empresa_polizas_seguro WHERE empresa_id=$1 ORDER BY activo DESC, fecha_vencimiento, aseguradora`, [user.empresa_id]);
  return rows;
}
async function save(db, user, input, id = null) {
  authorize(user, true);
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw invalid('Identificador de póliza no válido.');
  const data = validate(input);
  const values = [user.empresa_id,data.aseguradora,data.cobertura,data.numero_poliza,data.matricula_referencia,data.fecha_vencimiento,data.periodicidad,data.importe_referencia,data.correduria,data.notas,data.activo];
  const fields = 'aseguradora,cobertura,numero_poliza,matricula_referencia,fecha_vencimiento,periodicidad,importe_referencia,correduria,notas,activo';
  const returning = 'id,aseguradora,cobertura,numero_poliza,matricula_referencia,fecha_vencimiento,periodicidad,importe_referencia,correduria,notas,activo,updated_at';
  const query = id
    ? `UPDATE empresa_polizas_seguro SET (${fields})=($2,$3,$4,$5,$6,$7,$8,$9,$10,$11),updated_at=NOW() WHERE empresa_id=$1 AND id=$12 RETURNING ${returning}`
    : `INSERT INTO empresa_polizas_seguro(empresa_id,${fields}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${returning}`;
  const { rows } = await db.query(query, id ? [...values,id] : values);
  if (!rows[0]) throw Object.assign(new Error('Póliza no encontrada en esta empresa.'), { status: 404 });
  return rows[0];
}
module.exports = { authorize, validate, list, save };
