const crypto = require('crypto');
const { renderDeca } = require('./transportDocumentPdf');
const { driverStops } = require('./driverStops');
const fail = (message, code, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const canonical = value => JSON.stringify(value, function (key, v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const validId = v => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(v || ''));
const PUBLIC_MINIMUM_AFTER_COMPLETION_MS = 7 * 24 * 60 * 60 * 1000;
function publicAccessEnded(completedAt, now = new Date()) {
  const completion = completedAt && new Date(completedAt).getTime();
  return Number.isFinite(completion) && new Date(now).getTime() >= completion + PUBLIC_MINIMUM_AFTER_COMPLETION_MS;
}
async function available(db) { return !!(await db.query("SELECT to_regclass('public.transport_document_versions') AS name")).rows[0]?.name; }
const columns = 'id,empresa_id,pedido_id,envio_id,viaje_id,scope_key,version,source,payload,payload_hash,material_hash,pdf_hash,filename,reason,created_by,created_at,public_url,retention_until,metadata';
async function list(db, empresaId, pedidoId) {
  if (!await available(db)) return [];
  const rows = (await db.query(`SELECT ${columns} FROM transport_document_versions WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY version DESC,created_at DESC`, [empresaId, pedidoId])).rows;
  const scopes = new Set();
  return rows.map(row => { const state = scopes.has(row.scope_key) ? 'superada' : 'activa'; scopes.add(row.scope_key); return { ...row, estado: state }; });
}
async function read(db, empresaId, pedidoId, id) {
  if (!validId(id)) return null;
  return (await db.query('SELECT * FROM transport_document_versions WHERE empresa_id=$1 AND pedido_id=$2 AND id=$3', [empresaId, pedidoId, id])).rows[0] || null;
}
function documentSnapshot(documento) {
  // Whitelist administrative fields. No financial conditions, changing signatures or attachments.
  const d = JSON.parse(JSON.stringify(documento));
  return {...Object.fromEntries(['codigo_control','referencia_pedido','fecha_transporte','cargador_contractual','transportista_efectivo','empresa','origen','destino','mercancia','vehiculo'].map(k => [k, d[k] || {}])),observaciones:d.observaciones_publicas||''};
}
function requiredFields(d) {
  return [
    ['cargador_contractual.nombre','Razón social del cargador contractual'], ['cargador_contractual.nif','NIF del cargador contractual'],
    ['cargador_contractual.domicilio','Domicilio completo del cargador contractual'], ['transportista_efectivo.nombre','Razón social del transportista efectivo'],
    ['transportista_efectivo.nif','NIF del transportista efectivo'], ['origen.direccion','Dirección de origen'], ['destino.direccion','Dirección de destino'],
    ['destino.destinatario','Destinatario'], ['mercancia.descripcion','Naturaleza de la mercancía'], ['fecha_transporte','Fecha de transporte'], ['vehiculo.tractora','Matrícula de la tractora'],
  ].filter(([path]) => !String(path.split('.').reduce((v, k) => v?.[k], d) || '').trim()).map(([, label]) => label)
    .concat(Number(d.mercancia?.peso_kg) > 0 ? [] : ['Peso del envío (kg)']);
}
async function validateExternal(base64, confirmedNative) {
  const raw = String(base64 || '').replace(/^data:application\/pdf;base64,/, '');
  if (!raw || raw.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(raw)) fail('PDF inválido o demasiado grande', 'PDF_INVALID', 400);
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') fail('Adjunta un PDF de un máximo de 5 MB', 'PDF_INVALID', 400);
  let parsed;
  try { parsed = await require('pdf-parse')(bytes); } catch { fail('No se puede leer el PDF. No se ha guardado.', 'PDF_INVALID', 400); }
  if (!confirmedNative || !String(parsed.text || '').trim()) fail('El DeCA debe ser un PDF digital nativo; un escaneo no lo sustituye. Confirma su procedencia.', 'NATIVE_PDF_REQUIRED', 422);
  return bytes; // Never re-encode, stamp, flatten or regenerate the supplier original.
}
async function issue(db, { empresaId, pedidoId, payload, source = 'transgest', envioId, consolidated=false, consolidationAllowed=false, actorId, reason, baseUrl, externalPdf, nativeConfirmed, expectedUpdatedAt }) {
  if (!['transgest','external'].includes(source)) fail('Fuente documental inválida', 'SOURCE_INVALID', 400);
  const endpoint = new URL(baseUrl);
  const local = process.env.NODE_ENV !== 'production' && ['127.0.0.1','localhost'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !local) fail('Configura una URL HTTPS para los documentos', 'HTTPS_REQUIRED', 422);
  const bytes = source === 'external' ? await validateExternal(externalPdf, nativeConfirmed) : null;
  return db.transaction(async tx => {
    const order = (await tx.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id=$2 FOR UPDATE', [empresaId, pedidoId])).rows[0];
    if (!order) fail('Pedido no encontrado', 'ORDER_NOT_FOUND', 404);
    assertReadyToIssue(order);
    if (expectedUpdatedAt && new Date(order.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) fail('El pedido ha cambiado. Recarga antes de emitir el documento.', 'ORDER_CHANGED');
    const shipments = (await tx.query('SELECT * FROM pedidos_envios WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY created_at,id', [empresaId, pedidoId])).rows;
    if (envioId && !shipments.some(e => e.id === envioId)) fail('Envío no encontrado en este pedido', 'SHIPMENT_NOT_FOUND', 404);
    if(consolidated && (!consolidationAllowed||source!=='transgest'||envioId||shipments.length<2))fail('La consolidación requiere autorización de la empresa y al menos dos envíos explícitos.','CONSOLIDATION_NOT_ALLOWED',422);
    if (!envioId && shipments.length > 1&&!consolidated) fail('Selecciona el envío; cada envío tiene su DeCA.', 'SHIPMENT_REQUIRED', 422);
    const shipment = shipments.find(e => e.id === envioId) || shipments[0];
    await assertShipmentLoadReady(tx, order, consolidated ? shipments : shipment ? [shipment] : []);
    const scope = consolidated?'consolidado':shipment?.id || 'pedido';
    const mixed=(await tx.query("SELECT scope_key FROM transport_document_versions WHERE empresa_id=$1 AND pedido_id=$2 AND (scope_key='consolidado' OR $3='consolidado') AND scope_key<>$3 LIMIT 1",[empresaId,pedidoId,scope])).rows[0];
    if(mixed)fail('Este pedido ya utiliza otra modalidad documental. Conserva esa modalidad para evitar coberturas duplicadas.','DOCUMENT_SCOPE_CONFLICT');
    const previous = (await tx.query('SELECT id,source,material_hash FROM transport_document_versions WHERE empresa_id=$1 AND pedido_id=$2 AND scope_key=$3 ORDER BY version DESC LIMIT 1', [empresaId, pedidoId, scope])).rows[0];
    if (source === 'transgest' && previous?.source === 'external') fail('Este envío usa el DeCA del cargador. Adjunta una nueva versión externa si ha cambiado.', 'EXTERNAL_DECA_ACTIVE');
    const d = documentSnapshot(payload.documento);
    if (source === 'transgest') {
      if (!shipment && ((payload.documento.cargas || []).length > 1 || (payload.documento.descargas || []).length > 1)) fail('Identifica la mercancía, origen y destino de cada envío antes de generar sus documentos.', 'SHIPMENT_MAPPING_REQUIRED', 422);
      if(consolidated){
        d.envios=shipments.map(s=>{
          const p=s.snapshot;
          for(const party of ['cargador_contractual','transportista_efectivo'])if(p[party]&&canonical(p[party])!==canonical(d[party]))fail('Los envíos deben compartir cargador contractual y transportista efectivo.','CONSOLIDATION_PARTIES',422);
          const item={...d,origen:p.origen,destino:p.destino,mercancia:{descripcion:p.mercancia,peso_kg:p.peso_kg,bultos:p.bultos,embalaje:p.embalaje}};
          if(!p.origen_stop_id||!p.destino_stop_id||requiredFields(item).length)fail('Identifica origen, destino, destinatario y mercancía de cada envío antes de consolidar.','CONSOLIDATION_FIELDS',422);
          return {id:s.id,referencia:s.referencia,origen:item.origen,destino:item.destino,mercancia:item.mercancia};
        });
        d.origen={direccion:'Orígenes individualizados en los envíos'};
        d.destino={direccion:'Destinos individualizados en los envíos',destinatario:'Destinatarios individualizados en los envíos'};
        d.mercancia={descripcion:'Envíos individualizados',peso_kg:d.envios.reduce((n,s)=>n+Number(s.mercancia.peso_kg),0)};
      } else if (shipment && (shipments.length > 1 || shipment.snapshot.origen_dato==='revision_trafico')) {
        const s = shipment.snapshot;
        d.origen = { ...s.origen, direccion: s.origen?.direccion };
        d.destino = { ...s.destino, destinatario: s.destino?.destinatario || s.destino?.nombre };
        d.mercancia = { descripcion: s.mercancia, peso_kg: s.peso_kg, bultos: s.bultos, embalaje: s.embalaje };
      }
      const missing = requiredFields(d);
      if (missing.length) { const err = Object.assign(new Error(`Faltan: ${missing.join('; ')}`), { code: 'DECA_FIELDS_REQUIRED', status: 422, fields: missing }); throw err; }
    }
    const shipmentId=consolidated?null:shipment?.id||null;
    const materialHash = hash(canonical({ source, documento: d, pdf: bytes ? hash(bytes) : null, envio_id: shipmentId }));
    if (previous?.material_hash === materialHash) return { id: previous.id, created: false };
    if (previous && !String(reason || '').trim()) fail('Indica el motivo de la nueva versión', 'VERSION_REASON_REQUIRED', 422);
    const version = Number((await tx.query('SELECT COALESCE(MAX(version),0)+1 AS n FROM transport_document_versions WHERE empresa_id=$1 AND pedido_id=$2 AND scope_key=$3', [empresaId, pedidoId, scope])).rows[0].n);
    const id = crypto.randomUUID(), token = crypto.randomBytes(32).toString('base64url'), generatedAt = new Date().toISOString();
    const url = `${endpoint.origin}/api/v1/pedidos/public/documento-version/${id}?token=${token}`;
    const snapshot = { tipo: 'DeCA', version, source, documento: { ...d, soporte_url: url, qr_url: url }, envio_id: shipmentId,envio_ids:consolidated?shipments.map(s=>s.id):shipmentId?[shipmentId]:[],created_at: generatedAt };
    const pdf = bytes || await renderDeca({ documento: d, version, generatedAt, url });
    if (pdf.length > 5 * 1024 * 1024) fail('El PDF supera 5 MB. Revisa el contenido.', 'PDF_TOO_LARGE', 422);
    const trip = (await tx.query("SELECT v.id FROM viajes_operativos v JOIN viaje_pedidos p ON p.empresa_id=v.empresa_id AND p.viaje_id=v.id WHERE p.empresa_id=$1 AND p.pedido_id=$2 AND p.activo=true AND v.estado<>'cancelado' ORDER BY v.created_at DESC LIMIT 1", [empresaId, pedidoId])).rows[0];
    await tx.query(`INSERT INTO transport_document_versions(id,empresa_id,pedido_id,envio_id,viaje_id,scope_key,version,source,payload,payload_hash,material_hash,pdf,pdf_hash,filename,reason,created_by,created_at,token_hash,public_url,retention_until,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,($17::timestamptz+INTERVAL '1 year')::date,$20)`,
      [id,empresaId,pedidoId,shipmentId,trip?.id||null,scope,version,source,JSON.stringify(snapshot),hash(canonical(snapshot)),materialHash,pdf,hash(pdf),`DeCA-${id}-v${version}.pdf`,reason||'Emisión inicial',actorId||null,generatedAt,hash(token),url,JSON.stringify({native_pdf:source==='transgest'?'generated':'uploader_declared_text_detected',external_original:source==='external',validation:'No certifica contenido, firma ni cumplimiento del documento externo'})]);
    return { id, created: true, version };
  });
}
function assertReadyToIssue(order) {
  const state = String(order?.estado || '').toLowerCase();
  if (!['confirmado','en_curso','descarga','entregado','facturado'].includes(state)) {
    fail('Confirma el pedido antes de emitir el DeCA.', 'ORDER_NOT_CONFIRMED');
  }
  if (!order?.carga_real_at && !order?.colaborador_carga_confirmada_at) {
    fail('Finaliza y verifica la carga antes de emitir el DeCA.', 'LOAD_NOT_COMPLETED');
  }
}
async function assertShipmentLoadReady(tx, order, shipments) {
  const loads = driverStops(order).filter(stop => stop.tipo === 'carga');
  if (loads.length <= 1) return;
  const required = shipments.length
    ? [...new Set(shipments.map(shipment => shipment.snapshot?.origen_stop_id))]
    : loads.map(stop => stop.id);
  if (required.some(id => !id || !loads.some(stop => stop.id === id))) {
    fail('Asocia cada envío con su punto de carga antes de emitir el DeCA.', 'SHIPMENT_MAPPING_REQUIRED', 422);
  }
  const progress = (await tx.query('SELECT data FROM pedido_chofer_pasos WHERE empresa_id=$1 AND pedido_id=$2', [order.empresa_id, order.id])).rows[0]?.data || {};
  if (required.some(id => progress.paradas?.[id]?.carga_ok !== true)) {
    fail('Finaliza y verifica la carga correspondiente a este envío antes de emitir su DeCA.', 'SHIPMENT_LOAD_NOT_COMPLETED');
  }
}
async function publicOriginal(db, id, token, now = new Date()) {
  if (!validId(id) || typeof token !== 'string' || token.length > 128) return null;
  const row = (await db.query('SELECT * FROM transport_document_versions WHERE id=$1 AND token_hash=$2', [id, hash(token)])).rows[0];
  if (!row) return null;
  const events = (await db.query('SELECT event,effective_at FROM transport_document_events WHERE empresa_id=$1 AND document_id=$2 ORDER BY created_at DESC,id DESC', [row.empresa_id,row.id])).rows;
  const completion = events.find(e => e.event === 'service_completed');
  // A manual disable must never make a road-inspection QR unusable before
  // seven full natural days have elapsed after actual service completion.
  if (publicAccessEnded(completion?.effective_at, now)) fail('La consulta pública ha finalizado. Solicita el original a la empresa.', 'PUBLIC_EXPIRED', 410);
  const pdf = Buffer.from(row.pdf);
  if (hash(pdf) !== row.pdf_hash) fail('Fallo de integridad del documento conservado', 'DOCUMENT_INTEGRITY', 500);
  return { ...row, pdf };
}
async function legacyPublicOriginal(db, { empresaId, pedidoId, now = new Date() }) {
  if (!validId(empresaId) || !validId(pedidoId)) return null;
  const order = (await db.query('SELECT descarga_real_at FROM pedidos WHERE empresa_id=$1 AND id=$2', [empresaId,pedidoId])).rows[0];
  if (!order) return null;
  if (publicAccessEnded(order.descarga_real_at, now)) fail('La descarga pública del DeCA ha finalizado. Solicita el original a la empresa.', 'PUBLIC_EXPIRED', 410);
  const archived = (await db.query('SELECT pdf_base64,pdf_hash_sha256,pdf_filename,filename FROM documento_control_repositorio WHERE empresa_id=$1 AND pedido_id=$2', [empresaId,pedidoId])).rows[0];
  if (!archived?.pdf_base64) return null;
  // The printed QR identifies this original file. Never regenerate or silently
  // replace it: a different PDF requires a different QR under the 2026 rules.
  const pdf = Buffer.from(archived.pdf_base64, 'base64');
  if (pdf.subarray(0,5).toString() !== '%PDF-') fail('El archivo conservado no es un PDF válido', 'DOCUMENT_INTEGRITY', 500);
  const pdfHash = hash(pdf);
  if (archived.pdf_hash_sha256 && pdfHash !== archived.pdf_hash_sha256) fail('Fallo de integridad del documento conservado', 'DOCUMENT_INTEGRITY', 500);
  return { pdf, pdf_hash:pdfHash, filename:archived.pdf_filename || archived.filename || 'DeCA.pdf' };
}
async function hasProtectedLegacyDeca(db, empresaId, pedidoId, now = new Date()) {
  const rows = (await db.query(`SELECT 1 FROM documento_control_repositorio r
    JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id
    WHERE r.pedido_id=$1 AND r.empresa_id=$2 AND r.pdf_base64 IS NOT NULL
      AND $3::timestamptz<GREATEST(COALESCE(r.retencion_minima_hasta::timestamptz,'epoch'::timestamptz),
        GREATEST(r.created_at,COALESCE(p.descarga_real_at,r.created_at))+INTERVAL '1 year') LIMIT 1`,
    [pedidoId,empresaId,now])).rows;
  return rows.length > 0;
}
async function assertDeparture(db,empresaId,order,steps){
  const active=(await list(db,empresaId,order.id)).filter(v=>v.estado==='activa');
  const shipments=(await db.query('SELECT id FROM pedidos_envios WHERE empresa_id=$1 AND pedido_id=$2',[empresaId,order.id])).rows;
  if(!active.length||shipments.some(s=>!active.some(v=>v.envio_id===s.id||v.payload.envio_ids?.includes(s.id))))fail('Falta emitir o adjuntar el DeCA de cada envío antes de iniciar el transporte.','DECA_REQUIRED');
  if(!steps.dcd_revisado||!steps.dcd_disponible||active.some(v=>!steps.dcd_versiones_revisadas?.includes(v.id)))fail('Revisa y lleva disponibles las versiones vigentes del DeCA antes de salir.','DECA_REVIEW_REQUIRED');
  if(Math.abs(active.reduce((sum,v)=>sum+Number(v.payload.documento?.mercancia?.peso_kg||0),0)-Number(order.peso_kg))>.01)fail('El peso cargado difiere de los DeCA. Tráfico debe emitir o adjuntar su nueva versión.','DECA_GOODS_CHANGED');
}
module.exports = { issue, list, read, publicOriginal, legacyPublicOriginal, hasProtectedLegacyDeca, publicAccessEnded, requiredFields, documentSnapshot, available, canonical, hash, assertDeparture, assertReadyToIssue };
