import { displayLocation, missingLocationFields, orderTown } from './orderTown';
import { getBrandDisplayName } from '../branding';
test('lists towns, never street addresses or company names', () => {
  expect(orderTown({ciudad:'San Vicente del Raspeig',direccion:'Calle Malaga 1'})).toBe('SAN VICENTE DEL RASPEIG');
  expect(orderTown({},'Calle Malaga 1, San Vicente del Raspeig')).toBe('SAN VICENTE DEL RASPEIG');
  expect(orderTown({},'Calle Malaga 1')).toBe('POBLACION PENDIENTE');
  expect(orderTown({},'SKRETTING')).toBe('POBLACION PENDIENTE');
  expect(orderTown({},'Benissa')).toBe('BENISSA');
});
test('commercial names map legacy Control to Pro without changing its identifier in historical data', () => {
  expect(['lite','basico','profesional','enterprise'].map(getBrandDisplayName)).toEqual(['TransGest Go','TransGest Pro','TransGest Pro','TransGest Pro Intelligence']);
});

// A reordered secondary stop can contain only direccion, without ciudad.
test('reordered unloading towns remain visible without guessing from a company', () => {
  expect(orderTown({ciudad:'',direccion:'CASTELLÓN'}, 'CASTELLÓN')).toBe('CASTELLÓN');
  expect(orderTown({ciudad:'',direccion:'CASTELLÓN'}, 'Vinaròs')).toBe('CASTELLÓN');
  expect(orderTown({ciudad:'Vinaròs',direccion:'VINAROZ'}, 'CASTELLÓN')).toBe('VINARÒS');
  expect(orderTown({ciudad:' ',poblacion:'Benissa'})).toBe('BENISSA');
  expect(orderTown({direccion:'Calle Castellón 5'})).toBe('POBLACION PENDIENTE');
  expect(orderTown({direccion:'CEMENTOS CASTELLÓN'})).toBe('POBLACION PENDIENTE');
  expect(orderTown({direccion:'constructor'})).toBe('POBLACION PENDIENTE');
});

test('location display uses explicit population, normalized address, point name and incomplete fallback', () => {
  expect(displayLocation({ poblacion: 'Tortosa', ciudad: 'Barcelona', nombre: 'Plataforma' })).toBe('TORTOSA');
  expect(displayLocation({ direccion_normalizada: 'Calle Mayor 1, Abanilla' })).toBe('ABANILLA');
  expect(displayLocation({ nombre: 'Kerahome Tiles, S.A.', direccion: 'Polígono 4, nave 3' })).toBe('Kerahome Tiles, S.A.');
  expect(displayLocation({ direccion: 'Calle Mayor 1' })).toBe('Ubicación incompleta');
  expect(missingLocationFields({ nombre: 'Almacén', direccion: 'Calle Mayor 1' })).toEqual(['población', 'código postal']);
});
