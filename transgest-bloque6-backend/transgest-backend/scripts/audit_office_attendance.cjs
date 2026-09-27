const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { attendanceDay, schedule } = require('../src/services/officeAttendancePolicy');

module.exports = async ({ db, base, company, token, password }) => {
  const call = async (t, method, path, body) => {
    const response = await fetch(base + '/control-horario' + path, { method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
  const expect = async (t, method, path, body, status = 200) => {
    const result = await call(t, method, path, body);
    assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.data)}`);
    return result.data;
  };
  const other = crypto.randomUUID();
  await db.query("INSERT INTO empresas(id,nombre,cif,email_admin,plan,estado) VALUES($1,'OFICINA B SINTÉTICA','B00000018','office-b@example.invalid','lite','activa')", [other]);
  const hash = await require('bcryptjs').hash(password, 4);
  async function employee(role, eid = company, perms = {}) {
    const id = crypto.randomUUID(), email = `${id}@example.invalid`;
    await db.query("INSERT INTO usuarios(id,empresa_id,nombre,email,password_hash,rol,activo,permisos) VALUES($1,$2,$3,$4,$5,$6,true,$7)", [id, eid, 'Oficina sintética ' + role, email, hash, role, perms]);
    return { id, email, token: jwt.sign({ sub: id, empresa_id: eid, rol: role }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  }
  const foreign = await employee('administrativo', other);
  const foreignEntry = await expect(foreign.token, 'POST', '/fichar', { accion: 'entrada' });
  await expect(token, 'PUT', '/' + foreignEntry.id, { motivo: 'No autorizado', notas: 'Otra empresa' }, 404);
  await expect(token, 'PUT', '/jornada-config', { usuario_id: foreign.id, hora_entrada: '08:00', hora_salida: '16:00', pausa_min: 0 }, 404);

  const employees = [];
  for (const role of ['trafico', 'administrativo', 'contable']) {
    const user = await employee(role); employees.push(user);
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
    assert.equal(login.status, 200); user.token = (await login.json()).token;
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => expect(user.token, 'POST', '/fichar', { accion: 'entrada', usuario_id: foreign.id, empresa_id: other, entrada_at: '2001-01-01T00:00:00Z' })));
    const entry = concurrent[0]; assert.ok(concurrent.every(r => r.id === entry.id));
    assert.equal(entry.usuario_id, user.id); assert.equal(entry.empresa_id, company);
    assert.equal(entry.fecha instanceof Date ? attendanceDay(entry.fecha) : entry.fecha.slice(0, 10), attendanceDay());
    assert.equal(entry.ubicacion_estado, 'sin_ubicacion'); assert.equal(entry.entrada_lat, null);
    const summary = await expect(user.token, 'GET', '/resumen?usuario_id=' + foreign.id + '&empresa_id=' + other);
    assert.equal(summary.por_usuario.length, 1); assert.equal(summary.por_usuario[0].usuario_id, user.id);
    assert.ok(summary.abiertas.every(r => r.usuario_id === user.id));
    const list = await expect(user.token, 'GET', '/?usuario_id=' + foreign.id); assert.equal(list.length, 1); assert.equal(list[0].id, entry.id);
    for (const [path, body] of [['/' + entry.id, { motivo: 'Empleado no puede editar', entrada_at: '2000-01-01T00:00:00Z' }], ['/jornada-config', { pausa_min: 0 }], ['/config', { lat: 40, lng: -3 }]]) await expect(user.token, 'PUT', path, body, 403);
    await expect(user.token, 'GET', '/export.csv', null, 403);
    await expect(user.token, 'POST', '/fichar', { accion: 'pausa' });
    await db.query("UPDATE oficina_fichajes SET entrada_at=NOW()-INTERVAL '70 minutes',pausa_inicio_at=NOW()-INTERVAL '10 minutes' WHERE id=$1", [entry.id]);
    const paused = await expect(user.token, 'GET', '/resumen');
    assert.equal(paused.resumen.pausa_min, 10); assert.equal(paused.resumen.trabajado_min, 60);
    await expect(user.token, 'POST', '/fichar', { accion: 'reanudar' });
    const closed = await expect(user.token, 'POST', '/fichar', { accion: 'salida' });
    const replay = await expect(user.token, 'POST', '/fichar', { accion: 'salida', salida_at: '2030-01-01T12:00:00Z', notas: 'No debe cambiar' });
    assert.equal(replay.salida_at, closed.salida_at); assert.equal(replay.notas, closed.notas);
    await expect(user.token, 'POST', '/fichar', { accion: 'entrada' }, 409);
    await expect(user.token, 'POST', '/fichar', { accion: 'reanudar' }, 409);
    assert.equal((await db.query("SELECT count(*)::int n FROM oficina_fichaje_eventos WHERE fichaje_id=$1 AND tipo='salida'", [entry.id])).rows[0].n, 1);
    await expect(token, 'PUT', '/jornada-config', { usuario_id: user.id, hora_entrada: '08:00', hora_salida: '16:00', pausa_min: 0 });
    assert.equal((await expect(user.token, 'GET', '/jornada-config?usuario_id=' + foreign.id)).pausa_min, 0);
    const adjusted = await expect(token, 'PUT', '/' + entry.id, { motivo: 'Corrección sintética auditada', pausa_total_min: 0 });
    assert.equal(adjusted.pausa_total_min, 0);
    const audit = (await db.query("SELECT detalle FROM oficina_fichaje_eventos WHERE fichaje_id=$1 AND tipo='ajuste_manual'", [entry.id])).rows[0].detalle;
    assert.equal(audit.antes.pausa_total_min, 10); assert.equal(audit.despues.pausa_total_min, 0);
  }
  const own = employees[0];
  const vacation = await expect(own.token, 'POST', '/vacaciones', { desde: '2027-02-01', hasta: '2027-02-05', usuario_id: foreign.id, estado: 'aprobada' }, 201);
  assert.equal(vacation.usuario_id, own.id); assert.equal(vacation.estado, 'pendiente');
  await expect(own.token, 'POST', '/vacaciones', { desde: '2027-02-03', hasta: '2027-02-06' }, 409);
  await expect(own.token, 'POST', '/vacaciones', { desde: '2027-02-30', hasta: '2027-03-02' }, 400);
  await expect(own.token, 'POST', '/vacaciones', { desde: '2027-04-04', hasta: '2027-04-01' }, 400);
  await expect(own.token, 'PATCH', '/vacaciones/' + vacation.id, { estado: 'aprobada' }, 403);
  const foreignManager = await employee('gerente', other);
  await expect(foreignManager.token, 'PATCH', '/vacaciones/' + vacation.id, { estado: 'aprobada' }, 404);
  assert.equal((await expect(employees[1].token, 'GET', '/vacaciones?desde=2027-01-01&hasta=2027-12-31&usuario_id=' + own.id)).length, 0);
  await expect(token, 'PATCH', '/vacaciones/' + vacation.id, { estado: 'aprobada' });
  await expect(token, 'PATCH', '/vacaciones/' + vacation.id, { estado: 'rechazada' }, 404);

  const readOnly = await employee('visualizador', company, { modulos: { control_horario: { ver: true, editar: false } } });
  await expect(readOnly.token, 'POST', '/fichar', { accion: 'entrada', modalidad: 'teletrabajo' }, 409);
  const remote = await expect(readOnly.token, 'POST', '/teletrabajo', { fecha: attendanceDay(), estado: 'aprobada' }, 201);
  assert.equal(remote.estado, 'pendiente');
  await expect(readOnly.token, 'PATCH', '/teletrabajo/' + remote.id, { estado: 'aprobada' }, 403);
  await expect(token, 'PATCH', '/teletrabajo/' + remote.id, { estado: 'aprobada' });
  await expect(readOnly.token, 'POST', '/fichar', { accion: 'entrada', modalidad: 'teletrabajo' });
  await expect(readOnly.token, 'POST', '/vacaciones', { desde: '2027-06-01', hasta: '2027-06-02' }, 201);
  // Read access is required even for self service; explicit denial is preserved.
  const denied = await employee('trafico', company, { modulos: { control_horario: { ver: false, editar: true } } });
  await expect(denied.token, 'POST', '/fichar', { accion: 'entrada' }, 403);
  for (const role of ['cliente', 'colaborador', 'chofer']) {
    const external = await employee(role, company, { modulos: { control_horario: { ver: true, editar: true } } });
    await expect(external.token, 'GET', '/resumen', null, 403);
    await expect(external.token, 'POST', '/fichar', { accion: 'entrada' }, 403);
  }
  // An active secondary membership uses its own tenant and office role.
  await db.query("INSERT INTO usuario_empresas(usuario_id,empresa_id,rol,permisos,activo) VALUES($1,$2,'contable','{}',true)", [own.id, other]);
  const secondary = jwt.sign({ sub: own.id, empresa_id: other, rol: 'gerente' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await expect(secondary, 'POST', '/fichar', { accion: 'entrada' });
  assert.equal((await expect(secondary, 'GET', '/resumen')).por_usuario[0].rol, 'contable');
  await expect(secondary, 'PUT', '/jornada-config', { pausa_min: 0 }, 403);
  assert.equal((await expect(secondary, 'GET', '/jornada-config')).usuario_id, own.id);
  const night = await employee('administrativo');
  const nightEntry = await expect(night.token, 'POST', '/fichar', { accion: 'entrada' });
  await db.query("UPDATE oficina_fichajes SET fecha=$2::date-1,entrada_at=NOW()-INTERVAL '2 hours' WHERE id=$1", [nightEntry.id, attendanceDay()]);
  assert.equal((await expect(night.token, 'GET', '/mi-jornada')).id, nightEntry.id);
  assert.equal((await expect(night.token, 'POST', '/fichar', { accion: 'salida' })).id, nightEntry.id);
  await expect(own.token, 'GET', '/?desde=bad', null, 400);
  for (const [utc, day] of [['2026-03-28T23:30:00Z', '2026-03-29'], ['2026-03-29T22:30:00Z', '2026-03-30'], ['2026-10-24T22:30:00Z', '2026-10-25'], ['2026-10-25T23:30:00Z', '2026-10-26']]) assert.equal(attendanceDay(new Date(utc)), day);
  assert.throws(() => schedule({ hora_entrada: '29:99', hora_salida: '17:00', pausa_min: 0 }));
  if (process.env.AUDIT_BROWSER === '1') console.log(JSON.stringify({ officeBrowser: { email: own.email, password, note: 'Cuenta sintética; sin correos externos' } }));
  return { officeRolesClock: 3, goClock: true, ownScope: true, managerOnly: true, selfServiceWithoutEdit: true, tenantAndRoleIsolation: true, membershipScope: true, concurrentEntry: true, immutableClockOut: true, overnight: true, madridDst: true, auditedAdjustments: true, vacations: true, remoteWork: true };
};
