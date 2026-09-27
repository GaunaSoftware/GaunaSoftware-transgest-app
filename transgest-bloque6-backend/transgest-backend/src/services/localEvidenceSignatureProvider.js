const crypto=require('crypto');
const PDFDocument=require('pdfkit');
const {canonical,hash,list:documentVersions}=require('./transportDocumentVersions');
const {driverStops,stopData,activeDriverStop}=require('./driverStops');
const {loadJourney,assertNextStop}=require('./driverJourney');
const fail=(message,code,status=409)=>{throw Object.assign(new Error(message),{code,status});};
const uuid=v=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(v||''));
const reservations=['daños','faltante','sobrante','embalaje','temperatura','retraso','rechazo parcial','rechazo total','documentación','otro'];
const declarations={carga:'Declaro que la mercancía indicada ha sido entregada al transportista en las condiciones reflejadas en este justificante.',conforme:'Confirmo la recepción de la mercancía descrita sin reservas aparentes.',reservas:'Confirmo la recepción de la mercancía descrita con las reservas indicadas en este documento.'};

async function participants(tx,company,order,journey,versions,stop){
 const assignment=journey?.trip.asignacion_snapshot||order;
 const master=async(table,id)=>id?(await tx.query(`SELECT * FROM ${table} WHERE empresa_id=$1 AND id=$2`,[company,id])).rows[0]||{}:{};
 const [vehicle,trailer,driver,customer,carrier]=await Promise.all([
  master('vehiculos',assignment.vehiculo_id),master('vehiculos',assignment.remolque_id_manual||assignment.remolque_id),
  master('choferes',assignment.chofer_id),master('clientes',order.cliente_id),master('colaboradores',assignment.colaborador_id),
 ]);
 const companyRow=(await tx.query('SELECT nombre,cif FROM empresas WHERE id=$1',[company])).rows[0]||{};
 const document=versions[0]?.payload?.documento;
 return {cargador:document?.cargador_contractual||{nombre:customer.nombre||null,nif:customer.cif||null},
  transportista:document?.transportista_efectivo||(assignment.colaborador_id?{nombre:carrier.nombre||null,nif:carrier.cif||null}:{nombre:companyRow.nombre||null,nif:companyRow.cif||null}),
  destinatario:{nombre:stop.nombre||stop.label||null,direccion:stop.direccion||null},
  vehiculo:{tractora:assignment.matricula_colaborador||assignment.matricula_manual||vehicle.matricula||null,remolque:assignment.remolque_matricula_colaborador||trailer.matricula||null},
  conductor:[driver.nombre,driver.apellidos].filter(Boolean).join(' ')||null,
  asignacion_fuente:journey?'Asignación conservada del viaje':'Asignación del pedido al preparar el justificante'};
}

function checkedReservation(reserva={}) {
 if(reserva.tipo&&!reservations.includes(reserva.tipo))fail('Tipo de reserva inválido','RESERVATION_INVALID',400);
 if(reserva.tipo&&!String(reserva.descripcion||'').trim())fail('Describe la reserva','RESERVATION_DESCRIPTION',422);
 return reserva.tipo?{tipo:reserva.tipo,descripcion:String(reserva.descripcion).trim().slice(0,3000)}:null;
}
async function context(tx,company,order,stopId,authorize,reserva={},correctionId=null,allowCorrection=false) {
 if(!authorize(order))fail('Asignación no autorizada','FORBIDDEN',403);
 const reservation=checkedReservation(reserva);
 if(correctionId){
  if(!allowCorrection)fail('Solo tráfico o gerencia pueden corregir una evidencia cerrada','CORRECTION_FORBIDDEN',403);
  if(!uuid(correctionId))fail('Referencia de corrección inválida','CORRECTION_INVALID',422);
  const old=(await tx.query(`SELECT s.id,s.package_hash,o.payload,a.reason FROM signature_evidence s
   JOIN operacion_evidencias o ON o.empresa_id=s.empresa_id AND o.id=s.operation_id
   JOIN signature_evidence_annulments a ON a.empresa_id=s.empresa_id AND a.signature_id=s.id
   WHERE s.empresa_id=$1 AND o.pedido_id=$2 AND o.parada_id=$3 AND s.id=$4`,[company,order.id,stopId,correctionId])).rows[0];
  if(!old)fail('La firma a corregir debe pertenecer a esta parada y estar anulada','CORRECTION_NOT_FOUND',404);
  if((await tx.query('SELECT id FROM signature_evidence WHERE empresa_id=$1 AND replaces_id=$2',[company,correctionId])).rows.length)fail('Esta firma ya tiene una sustitución. Revisa el último justificante.','CORRECTION_REPLACED');
  // A correction is a new act of signature, never a replay of the physical stop.
  // Preserve the original goods, parties, times, documents and location verbatim.
  return {...old.payload,reserva:reservation,correccion_de:old.id,correccion_motivo:old.reason,correccion_hash_anterior:old.package_hash,
   declaracion:old.payload.operacion==='carga'?declarations.carga:reservation?declarations.reservas:declarations.conforme};
 }
 const journey=await loadJourney(tx,company,order.id);
 for(const child of journey?.orders||[])if(!authorize(child))fail('No tienes acceso a todos los servicios del viaje','FORBIDDEN',403);
 const stops=driverStops(order),stop=stops.find(s=>s.id===stopId);
 if(!stop)fail('Parada no encontrada','STOP_NOT_FOUND',404);
 const steps=(await tx.query('SELECT data FROM pedido_chofer_pasos WHERE empresa_id=$1 AND pedido_id=$2',[company,order.id])).rows[0]?.data||{};
 const data=stopData(stop,steps,stops);
 if(activeDriverStop(order,steps)?.id!==stopId)fail('Revisa la parada actual antes de firmar','STOP_NOT_CURRENT');
 if(journey)assertNextStop(journey,order.id,stopId);
 if(stop.tipo==='carga'?!(data.mercancia_confirmada&&data.albaran_carga):!(data.descarga_ok&&data.albaran_descarga))fail('Completa los datos de mercancía y el albarán antes de firmar','STOP_NOT_READY');
 const originals=(await documentVersions(tx,company,order.id)).filter(v=>v.estado==='activa');
 const versions=originals.map(v=>({id:v.id,envio_id:v.envio_id,envio_ids:v.payload.envio_ids||[],version:v.version,pdf_hash:v.pdf_hash}));
 const parties=await participants(tx,company,order,journey,originals,stop);
 const attachments=(await tx.query("SELECT id,nombre,tipo,created_at FROM pedido_docs WHERE empresa_id=$1 AND pedido_id=$2 AND metadata->>'parada_id'=$3 ORDER BY created_at,id",[company,order.id,stopId])).rows;
 return {pedido_id:order.id,pedido_numero:order.numero,viaje_id:journey?.trip.id||null,envios:[...new Set(versions.flatMap(v=>v.envio_ids.length?v.envio_ids:[v.envio_id]).filter(Boolean))],operacion:stop.tipo,parada_id:stopId,
  lugar:stop.direccion||stop.nombre||stop.label,mercancia:data.mercancia_cargada||order.mercancia,peso_kg:data.mercancia_peso_kg??order.peso_kg,bultos:data.mercancia_palets??order.bultos,
  vehiculo_id:order.vehiculo_id,remolque_id:order.remolque_id_manual||order.remolque_id||null,chofer_id:order.chofer_id,...parties,
  llegada:data[stop.tipo==='carga'?'carga_iniciada_at':'posicionado_descarga_at']||null,inicio:data[stop.tipo==='carga'?'carga_proceso_at':'descarga_iniciada_at']||null,fin:data[stop.tipo==='carga'?'carga_ok_at':'descarga_ok_at']||null,
  reserva:reservation,documentos:attachments,deca:versions,
  declaracion:stop.tipo==='carga'?declarations.carga:reserva.tipo?declarations.reservas:declarations.conforme};
}
async function renderReceipt(payload,evidence,signature) {
 const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true}),parts=[];
 doc.on('data',b=>parts.push(b));const done=new Promise((r,j)=>{doc.on('end',()=>r(Buffer.concat(parts)));doc.on('error',j);});
 const text=(label,value)=>{const t=`${label}: ${value??'No registrado'}`;doc.font('Helvetica').fontSize(9);if(doc.y+doc.heightOfString(t,{width:510})>744)doc.addPage();doc.fillColor('#172b2b').text(t,{width:510,lineGap:2});doc.moveDown(.5);};
 doc.font('Helvetica-Bold').fontSize(17).fillColor('#0f766e').text(payload.operacion==='carga'?'JUSTIFICANTE DE CARGA':'JUSTIFICANTE DE ENTREGA / POD');doc.moveDown();
 text('Pedido',payload.pedido_numero);text('Viaje',payload.viaje_id);text('Envíos',payload.envios.join(', ')||'Envío compatible del pedido');text('Parada / lugar',payload.lugar);
 text('Mercancía',payload.mercancia);text('Peso (kg) / bultos',`${payload.peso_kg} / ${payload.bultos}`);
 text('Cargador',`${payload.cargador?.nombre||'No registrado'} · NIF ${payload.cargador?.nif||'No registrado'}`);
 text('Transportista efectivo',`${payload.transportista?.nombre||'No registrado'} · NIF ${payload.transportista?.nif||'No registrado'}`);
 if(payload.operacion==='descarga')text('Destinatario',payload.destinatario?.nombre);
 text('Tractora / remolque',`${payload.vehiculo?.tractora||'No registrado'} / ${payload.vehiculo?.remolque||'No registrado'}`);
 text('Conductor',payload.conductor);
 text('Llegada / inicio / fin (UTC recepción servidor)',`${payload.llegada||'No registrado'} / ${payload.inicio||'No registrado'} / ${payload.fin||'No registrado'}`);
 text('Reserva',payload.reserva?`${payload.reserva.tipo}: ${payload.reserva.descripcion}`:'Sin reservas aparentes');
 text('Declaración',payload.declaracion);
 if(payload.correccion_de)text('Corrección documental; no modifica la operación física',`${payload.correccion_de} · ${payload.correccion_motivo}`);
 text('DeCA',payload.deca.map(d=>`${d.id} v${d.version} SHA256 ${d.pdf_hash}`).join('\n')||'Sin DeCA emitido asociado');
 text('Albaranes / anexos',payload.documentos.map(d=>`${d.nombre} (${d.tipo}) · ${d.id}`).join('\n')||'Sin anexos asociados');
 if(evidence){text('Firmante',`${evidence.identidad.nombre} ${evidence.identidad.apellidos} · ${evidence.identidad.empresa}`);text('Firma registrada (UTC)',evidence.firmado_at);text('Ubicación',evidence.gps?`${evidence.gps.lat}, ${evidence.gps.lng} · precisión ${evidence.gps.accuracy_m??'no informada'} m`:({denied:'Permiso denegado',timeout:'Sin respuesta del dispositivo',unavailable:'No disponible'}[evidence.gps_status]||'No disponible'));text('Evidencia / documento / versión',`${evidence.id} / ${evidence.documento.id} / ${evidence.documento.version}`);text('SHA256 documento revisado',evidence.documento.pdf_hash);text('SHA256 paquete de evidencia',hash(canonical(evidence)));if(doc.y+80>744)doc.addPage();doc.image(signature,42,doc.y,{fit:[220,75]});doc.moveDown(6);}
 else text('Estado','Resumen pendiente de firma de conformidad. No es un DeCA firmado.');
 const count=doc.bufferedPageRange().count;for(let i=0;i<count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(`TransGest · Justificante independiente del DeCA · ${i+1}/${count}`,42,783,{width:510,align:'center',lineBreak:false});}
 doc.end();return done;
}
async function withOrder(db,company,orderId,fn){return db.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${company}:groupage-write`]);const order=(await tx.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id=$2 FOR UPDATE',[company,orderId])).rows[0];if(!order)fail('Pedido no encontrado','ORDER_NOT_FOUND',404);return fn(tx,order);});}
async function prepare(db,{empresaId,pedidoId,stopId,authorize,actorId,reserva,correctionId,allowCorrection=false}){
 return withOrder(db,empresaId,pedidoId,async(tx,order)=>{
  const payload=await context(tx,empresaId,order,stopId,authorize,reserva,correctionId,allowCorrection),payloadHash=hash(canonical(payload));
  const prior=(await tx.query('SELECT id,version,payload,payload_hash,pdf_hash FROM operacion_evidencias WHERE empresa_id=$1 AND pedido_id=$2 AND parada_id=$3 ORDER BY version DESC LIMIT 1',[empresaId,pedidoId,stopId])).rows[0];
  if(prior?.payload_hash===payloadHash)return prior;
  const id=crypto.randomUUID(),version=(prior?.version||0)+1,pdf=await renderReceipt(payload);
  await tx.query('INSERT INTO operacion_evidencias(id,empresa_id,pedido_id,parada_id,version,payload,payload_hash,pdf,pdf_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,empresaId,pedidoId,stopId,version,JSON.stringify(payload),payloadHash,pdf,hash(pdf),actorId]);
  return {id,version,payload,payload_hash:payloadHash,pdf_hash:hash(pdf)};
 });
}
async function signatureBytes(dataUrl){
 if(typeof dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)||dataUrl.length>1000000)fail('Firma PNG inválida','SIGNATURE_INVALID',422);
 const bytes=Buffer.from(dataUrl.split(',')[1],'base64');
 try{
  // Reject excessive dimensions before allocation. The synchronous decoder reports
  // malformed streams/CRC through this catch, never through an uncaught callback.
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')fail('Firma PNG inválida','SIGNATURE_INVALID',422);
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width>1600||height>800||width<30||height<20)fail('Dimensiones de firma inválidas','SIGNATURE_INVALID',422);
  const png=require('pngjs').PNG.sync.read(bytes,{checkCRC:true});
  const pixels=png.data;let ink=0,minX=png.width,maxX=0,minY=png.height,maxY=0;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>50&&(pixels[i]+pixels[i+1]+pixels[i+2])/3<220){ink++;const x=(i/4)%png.width,y=Math.floor(i/4/png.width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  if(ink<40||maxX-minX<10||maxY-minY<5)fail('Firma vacía o demasiado pequeña','SIGNATURE_EMPTY',422);
 }catch(e){if(e.status)throw e;fail('No se puede leer la firma','SIGNATURE_INVALID',422);}
 return bytes;
}
async function sign(db,{empresaId,pedidoId,request,authorize,actorId,capture,allowCorrection=false}){
 if(!uuid(request.client_operation_uuid)||!uuid(request.operation_id))fail('Falta la referencia del justificante o de la operación','OPERATION_REQUIRED',422);
 const identity=request.identidad||{};
 for(const k of ['nombre','apellidos','empresa'])if(!String(identity[k]||'').trim()||String(identity[k]).length>200)fail(`Indica ${k} del firmante`,'IDENTITY_REQUIRED',422);
 if(request.revisado!==true||request.conforme_version!==true)fail('Debes revisar y aceptar la vinculación de la firma a esta versión','CONSENT_REQUIRED',422);
 const signature=await signatureBytes(request.firma_destinatario),requestHash=hash(canonical(request));
 return withOrder(db,empresaId,pedidoId,async(tx,order)=>{
  if(!authorize(order))fail('No puedes firmar este pedido','FORBIDDEN',403);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:signature:${request.client_operation_uuid}`]);
  const existing=(await tx.query('SELECT e.*,o.pedido_id FROM signature_evidence e JOIN operacion_evidencias o ON o.empresa_id=e.empresa_id AND o.id=e.operation_id WHERE e.empresa_id=$1 AND e.client_operation_uuid=$2',[empresaId,request.client_operation_uuid])).rows[0];
  if(existing){if(existing.request_hash!==requestHash||existing.pedido_id!==pedidoId)fail('El identificador ya se usó para otra firma','OPERATION_CONFLICT');return {ok:true,evidence_id:existing.id,idempotent:true};}
  const op=(await tx.query('SELECT * FROM operacion_evidencias WHERE empresa_id=$1 AND pedido_id=$2 AND id=$3',[empresaId,pedidoId,request.operation_id])).rows[0];
  if(!op)fail('Justificante no encontrado','OPERATION_NOT_FOUND',404);
  const fresh=await context(tx,empresaId,order,op.parada_id,authorize,op.payload.reserva||{},op.payload.correccion_de,allowCorrection);
  if(hash(canonical(fresh))!==op.payload_hash||request.document_hash!==op.pdf_hash)fail('El justificante ha cambiado. Revísalo de nuevo antes de firmar.','DOCUMENT_CHANGED');
  const previous=(await tx.query('SELECT e.id,a.signature_id AS annulled FROM signature_evidence e LEFT JOIN signature_evidence_annulments a ON a.empresa_id=e.empresa_id AND a.signature_id=e.id JOIN operacion_evidencias o ON o.empresa_id=e.empresa_id AND o.id=e.operation_id WHERE e.empresa_id=$1 AND o.pedido_id=$2 AND o.parada_id=$3 ORDER BY e.created_at DESC LIMIT 1',[empresaId,pedidoId,op.parada_id])).rows[0];
  if(previous&&!previous.annulled)fail('Ya existe una firma. Tráfico debe anularla con motivo antes de sustituirla.','SIGNATURE_EXISTS');
  if(op.payload.correccion_de&&previous?.id!==op.payload.correccion_de)fail('Revisa la última firma anulada de esta parada','CORRECTION_REPLACED');
  let gps=null,status=['denied','unavailable','timeout'].includes(request.gps_status)?request.gps_status:'unavailable';
  if(request.gps){const {lat,lng,accuracy_m}=request.gps;if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail('GPS inválido','GPS_INVALID',422);gps={lat,lng,accuracy_m:Number.isFinite(accuracy_m)&&accuracy_m>=0?accuracy_m:null};status='available';}
  const id=crypto.randomUUID(),at=new Date().toISOString();
  const evidence={id,provider:'LocalEvidenceSignatureProvider',version:1,identidad:Object.fromEntries(['nombre','apellidos','empresa','dni','cargo','telefono','email'].filter(k=>identity[k]).map(k=>[k,String(identity[k]).trim().slice(0,200)])),documento:{id:op.id,version:op.version,pdf_hash:op.pdf_hash,payload_hash:op.payload_hash},pedido_id:pedidoId,parada_id:op.parada_id,firmado_at:at,timezone:String(request.timezone||'UTC').slice(0,80),gps,gps_status:status,captura:capture,declaracion:op.payload.declaracion,revisado:true,conforme_version:true,firma_hash:hash(signature),replaces_id:previous?.id||null};
  const receipt=await renderReceipt(op.payload,evidence,signature);
  await tx.query('INSERT INTO signature_evidence(id,empresa_id,operation_id,client_operation_uuid,request_hash,payload,package_hash,signature,signature_hash,receipt_pdf,receipt_hash,replaces_id,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,empresaId,op.id,request.client_operation_uuid,requestHash,JSON.stringify(evidence),hash(canonical(evidence)),signature,hash(signature),receipt,hash(receipt),previous?.id||null,actorId,at]);
  const role=op.payload.operacion==='carga'?'cargador':'destinatario';
  const legacy={...evidence,firmante:{nombre:`${identity.nombre} ${identity.apellidos}`,rol:role},firma:{hash:hash(signature),data_url:request.firma_destinatario},parada:{id:op.parada_id},integrity_hash_sha256:hash(canonical(evidence))};
  const projection={...(order.firma_evidencia||{}),firmas:{...(order.firma_evidencia?.firmas||{}),[role]:legacy},paradas:{...(order.firma_evidencia?.paradas||{}),[op.parada_id]:legacy}};
  await tx.query('UPDATE pedidos SET firma_evidencia=$3,updated_at=NOW() WHERE empresa_id=$1 AND id=$2',[empresaId,pedidoId,JSON.stringify(projection)]);
  return {ok:true,evidence_id:id,operation_id:op.id,package_hash:hash(canonical(evidence)),idempotent:false};
 });
}
module.exports={prepare,sign,renderReceipt,reservations,declarations,signatureBytes};
