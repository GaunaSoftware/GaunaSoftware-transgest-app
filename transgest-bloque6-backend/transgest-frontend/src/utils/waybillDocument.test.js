import { buildWaybillHtml } from './waybillDocument';

const options = (data = {}, extra = {}) => ({
  data, docNumero:'CP-SINTETICO', pedidoNumero:'PED-SINTETICO', documentoTitulo:'Carta de Porte',
  isCmrInternacional:false, origenGeo:'España', destinoGeo:'España',
  origenPostalGeo:'12006 Castellón', destinoPostalGeo:'46120 Alboraya',
  anexosConArchivo:[], firmas:{}, firmaNombre:'', ...extra,
});

test('la carta reutiliza la población verificada y conserva la dirección de la parada', () => {
  const html = buildWaybillHtml(options({origen:'POBLACION PENDIENTE', destino:'POBLACIÓN DESCONOCIDA',
    puntos_carga:[{nombre:'Kerahome Tiles, S.A.',ciudad:'Castellón',direccion:'Polígono Norte 4',codigo_postal:'12006'}],
    puntos_descarga:[{ciudad:'Alboraya',direccion:'Calle Puerto 2',codigo_postal:'46120'}]}));
  expect(html).not.toMatch(/POBLACI[OÓ]N (PENDIENTE|DESCONOCIDA)/);
  expect(html).toContain('CASTELLÓN');
  expect(html).toContain('ALBORAYA');
  expect(html).toContain('Polígono Norte 4');
  expect(html).toContain('Calle Puerto 2');
});

test('los datos del documento se imprimen como texto y las imágenes no pueden inyectar HTML', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const html = buildWaybillHtml(options({cliente_nombre:attack,notas:'<script>alert(1)</script>'}, {
    firmaNombre:attack, firmas:{destinatario:'x" onerror="alert(1)'},
    anexosConArchivo:[{nombre:attack,etiqueta:attack,data_url:'javascript:alert(1)'}],
  }));
  const doc = new DOMParser().parseFromString(html,'text/html');
  expect(doc.querySelector('script,[onerror]')).toBeNull();
  expect(doc.body.textContent).toContain(attack);
  expect(doc.querySelector('img[src^="javascript:"]')).toBeNull();
});

test('una fecha ausente no se sustituye por el día de impresión', () => {
  const html = buildWaybillHtml(options({origen:'Madrid',destino:'Valencia'}));
  const doc = new DOMParser().parseFromString(html,'text/html');
  const label = Array.from(doc.querySelectorAll('.lbl')).find(el=>el.textContent==='Fecha de carga');
  expect(label.nextElementSibling.textContent).toBe('-');
});
