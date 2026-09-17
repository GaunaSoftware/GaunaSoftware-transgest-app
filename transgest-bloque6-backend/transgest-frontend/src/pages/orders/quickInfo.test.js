import { driverName, driverOption, orderRig, incidentDescription, incidentLabel, assignDriver, stopSchedule } from './quickInfo';

test('selecting a driver fills missing rig but preserves manual overrides', () => {
  const drivers=[{id:'d',vehiculo_id:'t'},{id:'d2',vehiculo_id:'t2'}];
  const vehicles=[{id:'t',remolque_id:'r'},{id:'t2',remolque_id:'r2'}];
  const first=assignDriver({colaborador_id:'supplier'},'d',drivers,vehicles);
  expect(first).toMatchObject({chofer_id:'d',vehiculo_id:'t',remolque_id_manual:'r',colaborador_id:''});
  expect(assignDriver(first,'d2',drivers,vehicles)).toMatchObject({vehiculo_id:'t2',remolque_id_manual:'r2'});
  expect(assignDriver({...first,remolque_id_manual:'manual'},'d2',drivers,vehicles).remolque_id_manual).toBe('manual');
  expect(assignDriver({...first,vehiculo_id:'t2'},'d',drivers,vehicles).vehiculo_id).toBe('t2');
  expect(assignDriver(first,'',drivers,vehicles).vehiculo_id).toBe('t');
});
test('stop details include date, time and loading/unloading window', () => {
  expect(stopSchedule({fecha:'2026-09-17',hora:'08:30:00',ventana_inicio:'08:00:00',ventana_fin:'10:00:00'})).toBe('17/09/2026 · 08:30 · Ventana: 08:00–10:00');
  expect(stopSchedule({ventana:'Por la tarde'})).toBe('Ventana: Por la tarde');
  expect(stopSchedule({})).toBe('');
});

test('driver alias is optional; full name and the assigned rig remain available', () => {
  const vehicles=[{id:'t',matricula:'1234 ABC',remolque_id:'r'},{id:'r',matricula:'R-1234'},{id:'other',matricula:'R-9999'}];
  const driver={nombre:'Ana',apellidos:'García Pérez',vehiculo_id:'t'};
  expect(driverName(driver)).toBe('Ana García Pérez');
  expect(driverName({...driver,alias:'Ana GP'})).toBe('Ana GP');
  expect(driverName({nombre:'Ana García Pérez',apellidos:'García Pérez'})).toBe('Ana García Pérez');
  expect(driverOption(driver,vehicles)).toBe('Ana García Pérez · 1234 ABC · R-1234');
  expect(orderRig({vehiculo_id:'t',remolque_id_manual:'other'},vehicles)).toBe('1234 ABC · R-9999');
  expect(orderRig({matricula_colaborador:'COL-1',remolque_matricula_colaborador:'COL-2'},[])).toBe('COL-1 · COL-2');
});
test('incidents display the actual reason or explicitly identify missing details', () => {
  expect(incidentDescription({estado:'incidencia',incidencia_descripcion:'Retraso en muelle'})).toBe('Retraso en muelle');
  expect(incidentDescription({estado:'incidencia'})).toContain('sin descripción registrada');
  expect(incidentDescription({estado:'entregado'})).toBe('');
  expect(incidentDescription({estado:'confirmado',incidencia_tipo:'operativa'})).toContain('ejecución del transporte');
  expect(incidentDescription({estado:'confirmado',incidencia_tipo:'operativa'})).toContain('No hay un motivo concreto registrado');
  expect(incidentDescription({estado:'confirmado',incidencia_tipo:'operativa',motivo_incidencia:'Muelle ocupado'})).toBe('Muelle ocupado');
  expect(incidentLabel({estado:'confirmado',incidencia_tipo:'operativa'})).toBe('Operativa');
  expect(incidentDescription({incidencia_tipo:'documentacion'})).toContain('albarán');
  expect(incidentDescription({incidencia_tipo:'otra_categoria'})).toContain('otra categoria');
});
