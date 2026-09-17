import {clearAssignmentPatch, hasAssignment, assignmentPricePatch} from './assignment';

test('clears provider, external driver and plates without touching the order or its price', () => {
  const before={colaborador_id:'provider',matricula_colaborador:'1234ABC',conductor_efectivo_nombre:'Ana',importe:500,puntos_descarga:[{ciudad:'Valencia'}]};
  expect(hasAssignment(before)).toBe(true);
  const after={...before,...clearAssignmentPatch()};
  expect(hasAssignment(after)).toBe(false);
  expect(after.importe).toBe(500);
  expect(after.puntos_descarga).toBe(before.puntos_descarga);
});
test('quick assignment only changes prices explicitly entered, including zero', () => {
  expect(assignmentPricePatch('', '')).toEqual({});
  expect(assignmentPricePatch('1.250,50','0')).toMatchObject({importe:1250.5,precio_colaborador:0,tipo_precio:'viaje'});
  expect(()=>assignmentPricePatch('-5','')).toThrow();
  expect(()=>assignmentPricePatch('','abc')).toThrow();
});
