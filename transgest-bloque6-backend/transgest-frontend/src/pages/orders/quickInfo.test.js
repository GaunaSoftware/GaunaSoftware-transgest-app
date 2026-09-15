import { driverName, driverOption, orderRig, incidentDescription } from './quickInfo';

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
});
