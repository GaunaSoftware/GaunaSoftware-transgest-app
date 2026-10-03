const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { supplierEmailData, dateLabel } = require('../src/services/transportEmailData');
const { transportEmail, emailBrand } = require('../src/services/transportEmail');

async function main() {
  const order = {
    id:'order-qa', empresa_id:'company-qa', numero:'PED-QA-01', empresa_nombre:'Empresa QA', colaborador_nombre:'Colaborador QA', colaborador_email:'qa@example.invalid',
    origen:'Madrid', destino:'Sevilla', fecha_carga:'2026-10-02', ventana_carga:'08:00 - 12:00', fecha_descarga:'2026-10-05', referencia_cliente:'CLIENTE-01',
    mercancia:'Maquinaria', peso_kg:8000, bultos:2, metros_lineales:13.6, precio_colaborador:400, precio_cliente_col:975,
    puntos_carga:JSON.stringify([{cliente_nombre:'Planta Norte',direccion:'Calle Uno 1',codigo_postal:'28001',poblacion:'Madrid',pais:'España',referencia:'CARGA-01',contacto:'Muelle 2',telefono:'900000000',notas:'Llamar antes de entrar.',google_maps_url:'https://maps.app.goo.gl/qa'}]),
    puntos_descarga:[{nombre:'Almacén Sur',direccion:'Calle Dos 2',poblacion:'Sevilla',fecha_descarga:'2026-10-05',hora_descarga:'09:30'},
      {nombre:'Almacén Oeste',direccion:'Calle Tres 3',poblacion:'Cádiz',peso_kg:2000}],
    condiciones_adicionales:'No subcontratar sin autorización.\nRemitir los albaranes firmados.', notas:'Necesario llevar cinchas.',
    empresa_cfg_precios:{empresa_perfil:{texto_pago_colaboradores:'Transferencia a 15 días'}},
  };
  const data = supplierEmailData(order);
  assert.equal(data.cargas[0].nombre,'Planta Norte');
  assert.match(data.cargas[0].direccion,/Calle Uno 1, 28001 Madrid, España/);
  assert.equal(data.cargas[0].cuando,'02/10/2026 · 08:00 - 12:00');
  assert.equal(data.cargas[0].map_url,'https://maps.app.goo.gl/qa');
  assert.equal(data.descargas[0].cuando,'05/10/2026 · 09:30');
  assert.equal(data.descargas[1].cuando,'','no inventar el horario de una descarga adicional');
  assert.match(data.descargas[1].map_url,/Calle%20Tres%203/,'una parada sin enlace usa su propia dirección');
  assert.equal(data.cantidad,'8.000 kg · 2 bultos · 13,6 m lineales');
  assert.equal(data.pago,'Transferencia a 15 días');
  assert.equal(dateLabel(new Date('2026-10-02T00:00:00Z')),'02/10/2026');
  const noCoords = supplierEmailData({...order,puntos_carga:[{nombre:'Punto',direccion:'Calle Uno',lat:null,lng:null}]}).cargas[0];
  assert.match(noCoords.map_url,/Calle%20Uno/);assert.doesNotMatch(noCoords.map_url,/0%2C0/);
  assert.equal(supplierEmailData({...order,puntos_carga:'malformed'}).cargas[0].nombre,'Madrid');

  const payload = {...data,numero:order.numero,empresa:order.empresa_nombre,colaborador:order.colaborador_nombre,ruta:'Madrid → Sevilla',precio:'400,00 EUR',url:'https://example.invalid/confirmar',dcd_url:'https://example.invalid/deca',dcd_instrucciones:'DeCA QA'};
  const ctas = {colaborador_confirmar:'Revisar y aceptar carga',colaborador_carga:'Marcar como cargado',colaborador_camino:'Marcar como en camino',colaborador_descarga:'Confirmar descarga y subir albaranes'};
  for (const [template,cta] of Object.entries(ctas)) {
    const mail = transportEmail(template,payload,emailBrand({nombre:'Empresa QA'}));
    assert(mail.html.includes(cta));assert(mail.text.includes(cta));
    assert.equal((mail.html.match(/<table\b/g)||[]).length,(mail.html.match(/<\/table>/g)||[]).length,'estructura de tablas completa');
    assert(mail.html.includes('Planta Norte'));assert(mail.html.includes('Descarga 2'));assert(mail.html.includes('Por confirmar'));
    assert(mail.html.includes('CLIENTE-01'));assert(mail.html.includes('CARGA-01'));assert(mail.html.includes('09:30'));
    assert(mail.html.includes('Llamar antes de entrar.'));assert(mail.html.includes('cid:transgest-brand'));
    assert(!mail.html.includes('desde tu cuenta de TransGest'));
    assert(!mail.html.includes('975'),'no publicar el precio cobrado al cliente');
    if(['colaborador_confirmar','colaborador_carga'].includes(template)) {
      assert(mail.html.includes('400,00 EUR'));assert(mail.text.includes('Transferencia a 15 días'));assert(mail.html.includes('No subcontratar'));
    } else {assert(!mail.html.includes('400,00 EUR'));assert(!mail.text.includes('400,00 EUR'));}
    if(template==='colaborador_camino') assert(mail.html.includes('example.invalid/deca'));
    else {assert(!mail.html.includes('example.invalid/deca'));assert(!mail.text.includes('example.invalid/deca'));}
  }
  const escaped = transportEmail('colaborador_confirmar',{...payload,empresa:'<script>alert(1)</script>',cargas:[{nombre:'<img src=x onerror=alert(1)>',map_url:'javascript:alert(1)'}],url:'javascript:alert(1)'});
  assert(!escaped.html.includes('<script>'));assert(!escaped.html.includes('<img src=x'));assert(!escaped.html.includes('href="javascript:'));

  // Execute the real sending adapter: each stage keeps its own endpoint and only
  // the accepted order sends the PDF. No SMTP, database or external recipient.
  const source = fs.readFileSync(path.join(__dirname,'../src/routes/pedidos.js'),'utf8');
  const sent = [];
  let documentReads = 0;
  const context = {supplierEmailData,publicBaseUrl:()=> 'https://example.invalid',colaboradorPrecioLabel:()=> '400,00 EUR',
    ensurePedidoOrdenCargaNumero:async()=>({numero:'OC-QA-01'}),buildSupplierLoadOrderPdf:async()=>Buffer.from('%PDF-synthetic'),
    getColaboradorDocumentoControlPayload:async()=>{documentReads++;return {status:{ready:true},versiones:[{id:'deca-qa'}]};},
    transportDocuments:{read:async()=>({filename:'deca-qa.pdf',pdf:Buffer.from('%PDF-synthetic-original')})},db:{},
    enviarEmail:async message=>{sent.push(message);return {messageId:'qa'};},
    logPedidoEvento:async()=>{},logColaboradorDocumentoControl:async()=>{},buildColaboradorMapLinks:()=>[],
    crypto:require('node:crypto'),logger:{warn(){}},Date,Buffer};
  vm.runInNewContext(source.slice(source.indexOf('async function sendColaboradorEmail('),source.indexOf('function colaboradorPrecioLabel(')),context);
  for (const stage of ['confirmar','carga','camino','descarga']) await context.sendColaboradorEmail({},order,stage,'test-token');
  sent.forEach((message,index)=>{
    assert.equal(message.destinatario,order.colaborador_email);assert.equal(message.empresa_id,order.empresa_id);
    assert.match(message.datos.url,new RegExp('/colaborador/'+['confirmar','carga','camino','descarga'][index]+'/test-token$'));
    assert.equal(message.datos.cargas[0].nombre,'Planta Norte');assert.equal(message.attachments.length,[1,2].includes(index)?1:0);
  });
  assert.equal(documentReads,1,'solo consultar/remitir DeCA en el aviso de salida');
  assert.equal(sent[1].attachments[0].contentType,'application/pdf');
  assert.equal(sent[1].datos.orden_carga_numero,'OC-QA-01');
  assert.deepEqual(sent[2].attachments[0].content,Buffer.from('%PDF-synthetic-original'),'El correo de salida adjunta el original vigente');
  context.getColaboradorDocumentoControlPayload=async()=>({status:{ready:false},versiones:[]});
  await assert.rejects(context.sendColaboradorEmail({},order,'camino','test-token'),{status:409});
  assert.equal(sent.length,4,'No se envía el correo de salida cuando falta el DeCA');
  console.log('PASS correos por etapas, puntos y horarios propios, CTA, PDF tras aceptar, privacidad, enlaces seguros y SMTP aislado.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
