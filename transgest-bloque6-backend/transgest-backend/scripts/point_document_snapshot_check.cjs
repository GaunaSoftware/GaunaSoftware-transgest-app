const assert = require('node:assert/strict');
const { buildDocumentoControlPayload, buildDocumentoControlHtml } = require('../src/services/documentoControl');

(async () => {
  const carga = { nombre:'Kerahome Tiles, S.A.', direccion:'Polígono Norte 4', codigo_postal:'12006',
    ciudad:'Castellón', provincia:'Castellón', pais:'España' };
  const pedido = { id:'22222222-2222-4222-8222-222222222222', numero:'PED-TEST',
    puntos_carga:[carga], puntos_descarga:[{...carga,nombre:'Almacén receptor'}] };
  const snapshot = buildDocumentoControlPayload({ empresaId:'11111111-1111-4111-8111-111111111111',
    pedido, empresa:{nombre:'Empresa de prueba'}, cliente:{nombre:'Cliente de prueba'} });
  assert.equal(snapshot.documento.origen.nombre,'Kerahome Tiles, S.A.');
  assert.equal(snapshot.documento.origen.codigo_postal,'12006');
  assert.equal(snapshot.documento.origen.ciudad,'Castellón');
  assert.equal(snapshot.documento.origen.direccion,'Polígono Norte 4, 12006 Castellón, España');
  const html = await buildDocumentoControlHtml({ documento:snapshot.documento });
  assert.ok(html.includes('Polígono Norte 4, 12006 Castellón, España'));
  carga.direccion='Dirección modificada después';
  assert.equal(snapshot.documento.origen.direccion,'Polígono Norte 4, 12006 Castellón, España',
    'a generated document keeps its point snapshot');
  const missing = buildDocumentoControlPayload({ empresaId:'11111111-1111-4111-8111-111111111111',
    pedido:{...pedido,origen:'',puntos_carga:[{nombre:'Kerahome Tiles, S.A.'}]},
    empresa:{nombre:'Empresa de prueba'}, cliente:{nombre:'Cliente de prueba'} });
  assert.equal(missing.documento.origen.direccion,'','the point name is not an address');
  console.log('PASS DeCA point snapshot: full address, postal code, city and no inferred name-as-address');
})().catch(error => { console.error(error); process.exitCode=1; });
