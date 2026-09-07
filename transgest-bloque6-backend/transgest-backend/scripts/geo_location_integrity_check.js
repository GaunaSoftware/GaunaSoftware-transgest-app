const assert = require('node:assert/strict');
const { coordinatesCompatible, coordinate } = require('../src/services/geoCoordinateGuard');
const { coordsFromText, resolveMapsCoords } = require('../src/services/mapsLink');
const { parsePlaceRequest } = require('../src/services/geoPlaceMatch');
const keys = require('../src/services/apiKeys');
const db = require('../src/services/db');

async function main() {
  const originalFetch = global.fetch;
  const originalQuery = db.query;
  const originalKey = keys.resolveApiKey;
  const calls = [];
  try {
    keys.resolveApiKey = async () => ({ key: null });
    db.query = async () => ({ rows: [] });
    global.fetch = async url => {
      const u = new URL(url);
      calls.push(u);
      if (u.hostname === 'maps.app.goo.gl') return new Response(null, { status: 302, headers: { location: 'https://maps.google.com/?q=Skretting+Cojobar+Burgos' } });
      if (u.hostname === 'maps.google.com') return new Response('<meta property="og:image" content="https://maps.google.com/?center=40.4168,-3.7038">');
      if (u.hostname === 'nominatim.openstreetmap.org') return Response.json([
        { lat:'40.4168', lon:'-3.7038', address:{city:'Madrid',province:'Madrid',country:'Espana',country_code:'es'}, display_name:'Madrid, Espana' },
        { lat:'42.25', lon:'-3.66', address:{village:'Cojobar',province:'Burgos',country:'Espana',country_code:'es'}, display_name:'Carretera de la Estacion, Cojobar, Burgos, Espana' },
      ]);
      throw new Error('Unexpected provider: ' + u.hostname);
    };
    const { resolvePlace } = require('../src/routes/geocoding')._test;
    for (const v of [null, undefined, '', ' ']) assert.equal(coordinate(v,-90,90),null);
    const context = {city:'Cojobar',region:'Burgos',country:'Espana'};
    assert.equal(coordinatesCompatible({lat:40.4168,lng:-3.7038},context),false);
    assert.equal(coordinatesCompatible({lat:0,lng:0},{city:'Aspe',country:'Espana'}),false);
    assert.equal(coordinatesCompatible({lat:28.46,lng:-16.25},{country:'Espana'}),true);
    assert.equal(coordinatesCompatible({lat:48.85,lng:2.35},{country:'Francia'}),true);
    assert.equal(parsePlaceRequest('Ctra de la Estacion s/n, Cojobar, Burgos, Espana','Espana','Burgos').locality,'Cojobar');
    assert.deepEqual(coordsFromText('https://www.google.com/maps/place/test/@40.4168,-3.7038,6z/data=!3d42.25!4d-3.66'),{lat:42.25,lng:-3.66});
    assert.deepEqual(coordsFromText('https://www.google.com/maps/place/test/@40.4168,-3.7038,6z/data=%213d42.25%214d-3.66'),{lat:42.25,lng:-3.66});
    assert.equal(await resolveMapsCoords('https://maps.app.goo.gl/test'),null,'El centro del HTML nunca es el pin');
    const skretting = await resolvePlace({empresaId:'qa',q:'Carretera de la Estacion s/n, Cojobar, Burgos',...context,raw:{...context,label:'Skretting',lat:40.4168,lng:-3.7038,google_maps_url:'https://maps.app.goo.gl/test'}});
    assert.equal(skretting.municipio,'Cojobar');
    assert.equal(skretting.lat,42.25);
    const aspe = await resolvePlace({empresaId:'qa',q:'Aspe, Alicante',country:'Espana',region:'Alicante',raw:{city:'Aspe',lat:0,lng:0}});
    assert.equal(aspe.municipio,'Aspe');
    assert.ok(aspe.lat>38 && aspe.lat<39);
    const { normalizeLocationFields, normalizeMetadata } = require('../src/routes/puntos_interes')._test;
    const point = await normalizeLocationFields({cleanDireccion:'CRTA DE LA ESTACION S/N',cleanCiudad:'Cojobar',cleanProvincia:'Burgos',pais:'Espana',lat:40.4168,lng:-3.7038});
    assert.equal(point.lat,null);
    assert.equal(point.lng,null);
    assert.equal(point.ciudad,'Cojobar');
    assert.equal(normalizeMetadata({lat:40.4168,lng:-3.7038},null,point).lat,null);
    assert.equal(calls.filter(u=>u.hostname==='nominatim.openstreetmap.org').every(u=>u.searchParams.get('countrycodes')==='es'),true);
    console.log('OK: Skretting/Burgos, Aspe, coordenadas vacias, pin frente a encuadre y enlaces cortos sin pin');
  } finally {
    global.fetch = originalFetch;
    db.query = originalQuery;
    keys.resolveApiKey = originalKey;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
