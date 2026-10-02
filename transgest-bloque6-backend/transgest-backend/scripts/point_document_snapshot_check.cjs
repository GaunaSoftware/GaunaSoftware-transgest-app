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
  assert.equal(snapshot.documento.destino.destinatario,'Almacén receptor','Se conserva el nombre del punto receptor aunque el pedido tenga otro destino general');
  // Selected points in the order editor carry cliente_nombre, not nombre.
  const editorLoad={...carga,cliente_nombre:'ALMACÉN DEL PUNTO DE ENSAYO'};delete editorLoad.nombre;
  const editorDrop={...editorLoad,cliente_nombre:'RECEPTOR DEL PUNTO DE ENSAYO'};
  const editorPayload=buildDocumentoControlPayload({pedido:{...pedido,origen:carga.direccion,
    puntos_carga:JSON.stringify([editorLoad]),puntos_descarga:JSON.stringify([editorDrop])},
    cliente:{nombre:'CLIENTE FISCAL DISTINTO'}}).documento;
  assert.equal(editorPayload.origen.nombre,editorLoad.cliente_nombre,'El nombre del punto no se sustituye por la calle ni por el cliente fiscal');
  assert.equal(editorPayload.cargas[0].nombre,editorLoad.cliente_nombre);
  assert.equal(editorPayload.destino.nombre,editorDrop.cliente_nombre);
  assert.equal(editorPayload.descargas[0].nombre,editorDrop.cliente_nombre);
  assert.equal(editorPayload.origen.direccion,'Polígono Norte 4, 12006 Castellón, España');
  const legacyPoint={...editorLoad,cliente_nombre:undefined,clienteNombre:'PUNTO DE ENSAYO ANTIGUO'};
  assert.equal(buildDocumentoControlPayload({pedido:{...pedido,puntos_carga:[legacyPoint]}}).documento.origen.nombre,legacyPoint.clienteNombre);
  const editorHtml=await buildDocumentoControlHtml({documento:editorPayload});
  assert.ok(editorHtml.includes(editorLoad.cliente_nombre));
  const pointPriority=buildDocumentoControlPayload({pedido:{...pedido,origen_provincia:'Provincia antigua',destino_provincia:'Provincia antigua',origen_pais:'Portugal',destino_pais:'Portugal'}}).documento;
  for(const place of [pointPriority.origen,pointPriority.destino]){
    assert.equal(place.provincia,'Castellón','La provincia de cada punto prevalece sobre el dato general del pedido');
    assert.equal(place.pais,'España');
  }
  const {fullStopAddress}=require('../src/services/stopAddress');
  assert.equal(fullStopAddress(snapshot.documento.origen),snapshot.documento.origen.direccion,'Una dirección ya completa no duplica componentes');
  assert.equal(fullStopAddress({direccion:'CALLE 2, 12006 CASTELLON, ESPANA',codigo_postal:'12006',ciudad:'Castellón',provincia:'Castellón',pais:'España'}),'CALLE 2, 12006 CASTELLON, ESPANA');
  assert.equal(fullStopAddress({direccion:'Calle Murcia 4',codigo_postal:'30100',ciudad:'Murcia',provincia:'Murcia',pais:'España'}),'Calle Murcia 4, 30100 Murcia, España','La localidad no se confunde con el nombre de la calle');
  assert.equal(fullStopAddress({direccion:'Calle 1',codigo_postal:'03100',ciudad:'Ciudad de ensayo',provincia:'Provincia de ensayo',pais:'España'}),'Calle 1, 03100 Ciudad de ensayo, Provincia de ensayo, España');
  assert.equal(fullStopAddress({nombre:'Solo un nombre',provincia:'Provincia',pais:'España'}),'','No se inventa la ubicación a partir del nombre');
  const driver = buildDocumentoControlPayload({pedido:{...pedido,chofer_nombre:'Conductor',chofer_apellidos:'De Ensayo',conductor_efectivo_nombre:'Conductor Efectivo',conductor_efectivo_apellidos:'De Ensayo'}});
  assert.equal(driver.documento.chofer.nombre,'Conductor Efectivo De Ensayo');
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
