import { mergePointGeoDraft } from './pointGeoDraft';

test('conserva la identidad del punto al completar la geolocalización', () => {
  const draft = {
    id: 'punto-1',
    cliente_id: 'cliente-1',
    nombre: 'TEJAS COBERT IBERIAN',
    direccion: 'CALLE TONELEROS, 2',
    codigo_postal: '02640',
    ciudad: 'Almansa',
    provincia: 'Albacete',
  };
  const inferred = {
    ...draft,
    nombre: '',
    cliente_nombre: '',
    lat: 38.8731218,
    lng: -1.1155516,
  };

  expect(mergePointGeoDraft(draft, inferred)).toMatchObject({
    id: 'punto-1',
    cliente_id: 'cliente-1',
    nombre: 'TEJAS COBERT IBERIAN',
    direccion: 'CALLE TONELEROS, 2',
    codigo_postal: '02640',
    ciudad: 'Almansa',
    provincia: 'Albacete',
    lat: 38.8731218,
    lng: -1.1155516,
  });
});
