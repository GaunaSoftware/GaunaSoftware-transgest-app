const assert = require('node:assert/strict');
const {fromOrder,stableStopUids,validate} = require('../src/services/transportShipments');

const point=(direccion,peso_kg,extra={})=>({direccion,peso_kg,...extra});
const base={numero:'PED-TEST',estado:'confirmado',origen:'Almacén A',destino:'Cliente B',mercancia:'Cemento',peso_kg:8000,bultos:8};
const stable=stableStopUids([point('Cliente B',3000),point('Cliente C',5000)]);
assert.deepEqual(stableStopUids([{direccion:'Cliente C'},{direccion:'Cliente B'}],stable).map(stop=>stop.pedido_stop_uid),stable.map(stop=>stop.pedido_stop_uid).reverse(),'La edición desde un cliente anterior conserva la identidad por dirección');
assert.equal(stableStopUids([{direccion:'Dirección corregida'},{direccion:'Cliente C'}],stable)[0].pedido_stop_uid,stable[0].pedido_stop_uid);
assert.notEqual(stableStopUids([stable[0],stable[0]])[0].pedido_stop_uid,stableStopUids([stable[0],stable[0]])[1].pedido_stop_uid);

const single=fromOrder({...base,puntos_carga:[point('Almacén A',8000)],puntos_descarga:[point('Cliente B',8000)]});
assert.equal(single.length,1);
assert.equal(single[0].mercancia,'Cemento');
assert.equal(single[0].peso_kg,8000);

const {buildDocumentoControlPayload}=require('../src/services/documentoControl');
const stopOnly={...base,peso_kg:null,puntos_carga:[point('Almacén A',null)],puntos_descarga:[point('Cliente B',8000)]};
assert.equal(fromOrder(stopOnly)[0].peso_kg,8000,'Una única descarga puede aportar el peso del envío');
assert.equal(buildDocumentoControlPayload({pedido:stopOnly}).documento.mercancia.peso_kg,8000,'La generación utiliza el mismo peso que el envío');
const loadOnly={...stopOnly,puntos_carga:[point('Almacén A',8000)],puntos_descarga:[point('Cliente B',null)]};
assert.equal(buildDocumentoControlPayload({pedido:loadOnly}).documento.mercancia.peso_kg,8000);
assert.throws(()=>fromOrder({...base,puntos_carga:[point('Almacén A',-1)],puntos_descarga:[point('Cliente B',8000)]}),{code:'ORDER_SHIPMENT_WEIGHT'},'Un peso inválido no se oculta usando el total');
const decimalKg={...base,peso_kg:'250.500',puntos_carga:[point('Almacén A',250.5)],puntos_descarga:[point('Cliente B',250.5)]};
assert.equal(fromOrder(decimalKg)[0].peso_kg,250.5,'Los pesos numéricos almacenados ya están en kg');
assert.equal(buildDocumentoControlPayload({pedido:decimalKg}).documento.mercancia.peso_kg,250.5);

const legacySplit={...base,peso_kg:16000,puntos_carga:[point('Almacén A',16000)],puntos_descarga:[point('Cliente B','8,0'),point('Cliente C','8,0')]};
assert.deepEqual(fromOrder(legacySplit).map(row=>row.peso_kg),[8000,8000],'Se reconoce la entrada antigua en toneladas de cada reparto');
assert.throws(()=>fromOrder({...legacySplit,puntos_descarga:[point('Cliente B',8000),point('Cliente C',null)]}),error=>error.code==='ORDER_SHIPMENT_WEIGHT'&&error.message.includes('Descarga 2')&&error.message.includes('El peso total no define su reparto'),'El total no se reparte por suposición');
const withoutTotal={...legacySplit,peso_kg:null};
assert.equal(buildDocumentoControlPayload({pedido:withoutTotal}).documento.mercancia.peso_kg,16000,'Las cargas y descargas no se suman entre sí');
assert.equal(buildDocumentoControlPayload({pedido:{...withoutTotal,puntos_carga:[],puntos_descarga:[point('Cliente B',8000),point('Cliente C',null)]}}).documento.mercancia.peso_kg,null,'Un reparto parcial no define el peso total');
assert.equal(buildDocumentoControlPayload({pedido:{...withoutTotal,puntos_carga:[point('Almacén A',15000)]}}).documento.mercancia.peso_kg,null,'No se deduce un total de repartos contradictorios');

const split=fromOrder({...base,puntos_carga:[point('Almacén A',8000)],puntos_descarga:[point('Cliente B',3000),point('Cliente C',5000,{mercancia:'Cemento blanco'})]});
assert.equal(split.length,2);
assert.equal(split[0].origen_id,split[1].origen_id);
assert.equal(split[1].mercancia,'Cemento blanco');
const addresses={...base,puntos_carga:[point('Calle de ensayo 1',8000,{nombre:'Almacén sintético',codigo_postal:'30100',ciudad:'Murcia',provincia:'Murcia',pais:'España'})],
  puntos_descarga:[point('Calle de entrega 2',3000,{nombre:'Destinatario uno',codigo_postal:'23400',ciudad:'Úbeda',provincia:'Jaén',pais:'España'}),
    point('Calle de entrega 3',5000,{nombre:'Destinatario dos',cp:'03100',poblacion:'Ciudad de ensayo',region:'Provincia de ensayo',country:'España'})]};
const addressSnapshots=validate(addresses,fromOrder(addresses));
assert.equal(addressSnapshots[0].snapshot.origen.direccion,'Calle de ensayo 1, 30100 Murcia, España');
assert.equal(addressSnapshots[0].snapshot.destino.direccion,'Calle de entrega 2, 23400 Úbeda, Jaén, España');
assert.equal(addressSnapshots[0].snapshot.destino.destinatario,'Destinatario uno');
assert.equal(addressSnapshots[0].snapshot.destino.codigo_postal,'23400');
assert.equal(addressSnapshots[0].snapshot.destino.provincia,'Jaén');
assert.equal(addressSnapshots[1].snapshot.destino.direccion,'Calle de entrega 3, 03100 Ciudad de ensayo, Provincia de ensayo, España');

const merged=fromOrder({...base,puntos_carga:[point('Almacén A',3000),point('Almacén C',5000)],puntos_descarga:[point('Cliente B',8000)]});
assert.equal(merged.length,2);
assert.notEqual(merged[0].origen_id,merged[1].origen_id);
assert.equal(merged[0].destino_id,merged[1].destino_id);

const multiple={...base,puntos_carga:[point('Almacén A',3000),point('Almacén C',5000)],puntos_descarga:[point('Cliente B',3000,{origen_carga_indice:0}),point('Cliente D',5000,{origen_carga_indice:1})]};
const mapped=fromOrder(multiple);
assert.equal(mapped.length,2);
assert.notEqual(mapped[0].origen_id,mapped[1].origen_id);
assert.throws(()=>fromOrder({...multiple,puntos_descarga:multiple.puntos_descarga.map(stop=>({...stop,origen_carga_indice:''}))}),/selecciona su carga de origen/);
assert.throws(()=>fromOrder({...multiple,puntos_descarga:[point('Cliente B',2000,{origen_carga_indice:0}),point('Cliente D',5000,{origen_carga_indice:1})]}),/suma de los pesos/);
async function persistence(){
  const {PGlite}=require('@electric-sql/pglite'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
  const shipments=require('../src/services/transportShipments'),documents=require('../src/services/transportDocumentVersions');
  const pg=new PGlite(),db={query:(...args)=>pg.query(...args),transaction:fn=>pg.transaction(tx=>fn(tx))};
  try{
    await pg.exec('CREATE TABLE pedidos(id UUID PRIMARY KEY,empresa_id UUID,estado text,numero text,origen text,destino text,mercancia text,bultos numeric,peso_kg numeric,puntos_carga jsonb,puntos_descarga jsonb,carga_real_at timestamptz,descarga_real_at timestamptz,updated_at timestamptz DEFAULT NOW()); CREATE TABLE pedido_eventos(id uuid DEFAULT gen_random_uuid(),pedido_id uuid,empresa_id uuid,tipo text,actor_tipo text,actor_id uuid,detalle jsonb);');
    for(const file of ['20260926_operational_model.sql','20260926_operational_model_groupage.sql','20260926_transport_document_versions.sql'])await pg.exec(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8'));
    const empresaId=crypto.randomUUID(),pedidoId=crypto.randomUUID();
    await pg.query("INSERT INTO pedidos(id,empresa_id,estado,numero,origen,destino,mercancia,peso_kg,puntos_carga,puntos_descarga) VALUES($1,$2,'confirmado','QA-PEDIDO','Madrid','Valencia','Cemento',8000,$3,$4)",[pedidoId,empresaId,JSON.stringify(addresses.puntos_carga),JSON.stringify(addresses.puntos_descarga)]);
    const args={empresaId,pedidoId};
    await assert.rejects(shipments.ensureFromOrder(db,{...args,empresaId:crypto.randomUUID()}),{code:'ORDER_NOT_FOUND'});
    const prepared=await shipments.ensureFromOrder(db,args),ids=prepared.envioIds;
    assert.equal(ids.length,2);assert.deepEqual((await shipments.ensureFromOrder(db,args)).envioIds,ids);
    const order=(await pg.query('SELECT * FROM pedidos WHERE id=$1',[pedidoId])).rows[0];
    assert.ok(order.puntos_descarga.every(stop=>stop.pedido_stop_uid));
    const payload={documento:{referencia_pedido:order.numero,fecha_transporte:'2026-10-02',cargador_contractual:{nombre:'Cargador QA',nif:'QA',domicilio:'Madrid'},transportista_efectivo:{nombre:'Transportista QA',nif:'QA'},vehiculo:{tractora:'QA-0000'}}};
    await pg.query("UPDATE pedidos SET updated_at=updated_at+INTERVAL '1 second' WHERE id=$1",[pedidoId]);
    await assert.rejects(documents.issue(db,{...args,payload,envioId:ids[0],baseUrl:'https://example.invalid',expectedUpdatedAt:prepared.updatedAt}),{code:'ORDER_CHANGED'});
    for(const envioId of ids)await documents.issue(db,{...args,payload,envioId,baseUrl:'https://example.invalid'});
    const originals=await documents.list(db,empresaId,pedidoId);
    const normalize=value=>value.replace(/\s+/g,' ').trim();
    for(const original of originals){
      const stored=await documents.read(db,empresaId,pedidoId,original.id),document=original.payload.documento;
      const shipment=addressSnapshots.find(s=>s.snapshot.destino.destinatario===document.destino.destinatario);
      assert.ok(shipment,'El destinatario corresponde a su reparto');
      assert.equal(document.destino.direccion,shipment.snapshot.destino.direccion);
      const pdfText=normalize((await require('pdf-parse')(Buffer.from(stored.pdf))).text);
      assert.ok(pdfText.includes(shipment.snapshot.destino.destinatario)&&pdfText.includes(shipment.snapshot.destino.direccion),'El PDF conserva toda la dirección específica de ese reparto');
    }
    const stops=order.puntos_descarga.map((stop,index)=>({...stop,peso_kg:index?4800:3200}));
    await pg.query('UPDATE pedidos SET puntos_descarga=$2 WHERE id=$1',[pedidoId,JSON.stringify(stops)]);
    await assert.rejects(shipments.ensureFromOrder(db,args),{code:'VERSION_REASON_REQUIRED'});
    assert.deepEqual((await shipments.ensureFromOrder(db,{...args,reason:'Reparto corregido desde el pedido'})).envioIds,ids);
    for(const envioId of ids)await documents.issue(db,{...args,payload,envioId,reason:'Reparto corregido desde el pedido',baseUrl:'https://example.invalid'});
    const corrected=await documents.list(db,empresaId,pedidoId);
    assert.deepEqual(corrected.filter(v=>v.estado==='activa').map(v=>Number(v.payload.documento.mercancia.peso_kg)).sort((a,b)=>a-b),[3200,4800]);
    for(const original of originals)assert.equal(corrected.find(v=>v.id===original.id).pdf_hash,original.pdf_hash,'El PDF original permanece intacto');
    await pg.query('UPDATE pedidos SET puntos_descarga=$2 WHERE id=$1',[pedidoId,JSON.stringify([...stops].reverse())]);
    assert.deepEqual((await shipments.ensureFromOrder(db,{...args,reason:'Orden de paradas corregido'})).envioIds,[...ids].reverse(),'La identidad sigue al envío al reordenar paradas');
    await pg.query("UPDATE pedidos_envios SET snapshot=(snapshot-'pedido_envio_uid'-'pedido_envio_indice')||'{\"origen_dato\":\"revision_trafico\"}'::jsonb WHERE pedido_id=$1",[pedidoId]);
    await assert.rejects(shipments.ensureFromOrder(db,args),{code:'VERSION_REASON_REQUIRED'});
    assert.deepEqual((await shipments.ensureFromOrder(db,{...args,reason:'Datos desde el pedido en lugar del antiguo editor'})).envioIds,[...ids].reverse(),'Los envíos del antiguo editor conservan su identidad al alimentarse del pedido');
  }finally{await pg.close();}
}
persistence().then(()=>console.log('Desglose de DeCA desde pedido, aislamiento y originales conservados: OK')).catch(error=>{console.error(error);process.exitCode=1;});
