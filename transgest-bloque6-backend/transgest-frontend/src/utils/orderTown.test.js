import { orderTown } from './orderTown';
import { getBrandDisplayName } from '../branding';
test('lists towns, never street addresses or company names', () => {
  expect(orderTown({ciudad:'San Vicente del Raspeig',direccion:'Calle Malaga 1'})).toBe('SAN VICENTE DEL RASPEIG');
  expect(orderTown({},'Calle Malaga 1, San Vicente del Raspeig')).toBe('SAN VICENTE DEL RASPEIG');
  expect(orderTown({},'Calle Malaga 1')).toBe('POBLACION PENDIENTE');
  expect(orderTown({},'SKRETTING')).toBe('POBLACION PENDIENTE');
  expect(orderTown({},'Benissa')).toBe('BENISSA');
});
test('commercial names preserve existing plan identifiers', () => {
  expect(['lite','basico','profesional','enterprise'].map(getBrandDisplayName)).toEqual(['TransGest Go','TransGest Control','TransGest Pro','TransGest Pro Intelligence']);
});
