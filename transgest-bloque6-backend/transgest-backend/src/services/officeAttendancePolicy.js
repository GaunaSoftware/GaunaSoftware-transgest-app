const OFFICE_ROLES = ['gerente', 'trafico', 'contable', 'administrativo', 'visualizador'];
const canManageAttendance = user => user?.rol === 'gerente';
const isOfficeEmployee = user => OFFICE_ROLES.includes(user?.rol);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function attendanceDay(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T12:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value) return value;
    return fail('Fecha no válida.');
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return fail('Fecha no válida.');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

function attendancePeriod(query = {}) {
  const desde = attendanceDay(query.desde ?? new Date(Date.now() - 30 * 86400000));
  const hasta = attendanceDay(query.hasta ?? new Date());
  if (desde > hasta) fail('La fecha inicial debe ser anterior o igual a la final.');
  return { desde, hasta };
}

function schedule(input = {}) {
  const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!time(input.hora_entrada) || !time(input.hora_salida)) fail('Indica horas válidas de entrada y salida.');
  const pause = Number(input.pausa_min);
  if (input.pausa_min === '' || input.pausa_min == null || !Number.isInteger(pause) || pause < 0 || pause > 240) fail('La pausa debe estar entre 0 y 240 minutos.');
  return { entrada: input.hora_entrada, salida: input.hora_salida, pausa: pause, extras: input.extras_requieren_aprobacion !== false };
}

module.exports = { OFFICE_ROLES, canManageAttendance, isOfficeEmployee, attendanceDay, attendancePeriod, schedule, fail };
