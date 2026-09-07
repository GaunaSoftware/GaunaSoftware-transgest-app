import { inferPlaceGeo, provinciaDeLugar } from './placeGeo';

test('solo poblaciones completas, sin convertir Aspe en Raspeig', () => {
  expect(inferPlaceGeo('Aspe').municipio).toBe('Aspe');
  expect(inferPlaceGeo('Aspe, Alicante').municipio).toBe('Aspe');
  expect(inferPlaceGeo('Santa')).toBeNull();
  expect(inferPlaceGeo('San Vic')).toBeNull();
  expect(provinciaDeLugar('Santa Pola')).toMatch(/Alicante/);
});

test('la calle y el nombre comercial no sustituyen la localidad', () => {
  expect(inferPlaceGeo({ ciudad:'Aspe', nombre:'San Vicente del Raspeig', direccion:'Calle Malaga 1' }).municipio).toBe('Aspe');
  expect(inferPlaceGeo('Calle Malaga 1, San Vicente del Raspeig, Alicante').municipio).toBe('San Vicente del Raspeig');
  expect(inferPlaceGeo('Calle Malaga 1')).toBeNull();
});
