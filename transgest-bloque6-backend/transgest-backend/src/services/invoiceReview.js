const crypto = require('crypto');
const db = require('./db');
let schema;
function ensureSchema() {
  if (!schema) schema=(async()=>{
    // Separate statements also work with prepared-query database adapters.
    const statements=[
      'ALTER TABLE facturas ADD COLUMN IF NOT EXISTS factura_original_id UUID REFERENCES facturas(id)',
      'ALTER TABLE facturas ADD COLUMN IF NOT EXISTS factura_original_numero TEXT',
      'ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_rectificacion TEXT',
      'ALTER TABLE facturas ADD COLUMN IF NOT EXISTS tipo_rectificacion TEXT',
      `CREATE TABLE IF NOT EXISTS factura_revisiones (
        factura_id UUID PRIMARY KEY REFERENCES facturas(id) ON DELETE CASCADE,
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        huella TEXT NOT NULL, motivo_sin_referencia TEXT NOT NULL DEFAULT '',
        revisada_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    ];
    for(const statement of statements)await db.query(statement);
  })().catch(e=>{schema=null;throw e;});
  return schema;
}
async function snapshot(client,id,empresaId) {
  const invoice=await client.query('SELECT id,cliente_id,numero,fecha,fecha_vencimiento,base_imponible,total,tipo_iva,cuota_iva,tipo_irpf,cuota_irpf,observaciones,referencia_cliente,factura_original_id,factura_original_numero,motivo_rectificacion,tipo_rectificacion FROM facturas WHERE id=$1 AND empresa_id=$2',[id,empresaId]);
  if(!invoice.rows[0])throw Object.assign(new Error('Factura no encontrada'),{status:404});
  const originalId=invoice.rows[0].factura_original_id;
  let original=null;
  if(originalId){
    original=(await client.query('SELECT id,numero,estado,cliente_id,total,base_imponible,tipo_iva,tipo_irpf FROM facturas WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[originalId,empresaId])).rows[0];
    if(!original || original.cliente_id!==invoice.rows[0].cliente_id || ['borrador','rectificada'].includes(original.estado))throw Object.assign(new Error('La factura original ya no puede rectificarse. Revisa su estado y cliente.'),{status:409});
  }
  const sourceId=originalId || id;
  await client.query(`SELECT p.id FROM pedidos p WHERE p.empresa_id=$2 AND (p.factura_id=$1 OR EXISTS(SELECT 1 FROM factura_pedidos fp WHERE fp.factura_id=$1 AND fp.pedido_id=p.id)) ORDER BY p.id FOR UPDATE`,[sourceId,empresaId]);
  await client.query(`SELECT d.id FROM pedido_docs d JOIN pedidos p ON p.id=d.pedido_id AND p.empresa_id=d.empresa_id WHERE p.empresa_id=$2 AND (p.factura_id=$1 OR EXISTS(SELECT 1 FROM factura_pedidos fp WHERE fp.factura_id=$1 AND fp.pedido_id=p.id)) ORDER BY d.id FOR UPDATE OF d`,[sourceId,empresaId]);
  const orders=await client.query(`SELECT p.id,p.numero,p.estado,p.cliente_id,p.referencia_cliente,p.origen,p.destino,p.fecha_carga,p.fecha_descarga,p.importe,p.peso_kg,p.mercancia,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'tipo',d.tipo,'nombre',d.nombre,'contenido',md5(COALESCE(to_jsonb(d)->>'file_base64','') || COALESCE(to_jsonb(d)->>'file_url',''))) ORDER BY d.id)
      FROM pedido_docs d WHERE d.pedido_id=p.id AND d.empresa_id=p.empresa_id
      AND (LOWER(COALESCE(d.tipo,'') || ' ' || COALESCE(d.nombre,'')) ~ '(albar|pod|cmr)')
      AND (NULLIF(to_jsonb(d)->>'file_base64','') IS NOT NULL OR NULLIF(to_jsonb(d)->>'file_url','') IS NOT NULL)), '[]'::jsonb) AS soportes
    FROM pedidos p WHERE p.empresa_id=$2 AND (p.factura_id=$1 OR EXISTS(SELECT 1 FROM factura_pedidos fp WHERE fp.factura_id=$1 AND fp.pedido_id=p.id)) ORDER BY p.id`,[sourceId,empresaId]);
  const lines=await client.query('SELECT concepto,cantidad,precio_unit FROM factura_lineas WHERE factura_id=$1 ORDER BY id FOR UPDATE',[id]);
  const extras=await client.query('SELECT tipo,concepto,importe FROM factura_extracostes WHERE factura_id=$1 ORDER BY id FOR UPDATE',[id]);
  const value={factura:invoice.rows[0],original,pedidos:orders.rows,lineas:lines.rows,extracostes:extras.rows};
  return {...value,huella:crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}
function problems(value,waiver='') {
  const result=[];
  for(const p of value.pedidos) {
    if(String(p.cliente_id)!==String(value.factura.cliente_id))result.push(`${p.numero}: pertenece a otro cliente`);
    if(!['entregado','facturado'].includes(p.estado))result.push(`${p.numero}: pendiente de entrega`);
    if(!p.soportes.length)result.push(`${p.numero}: falta albarán, POD o CMR con archivo`);
    if(!String(p.referencia_cliente || value.factura.referencia_cliente || '').trim() && !String(waiver).trim())result.push(`${p.numero}: revisa la referencia o justifica que no procede`);
  }
  return result;
}
async function review(client,id,empresaId,usuarioId,waiver) {
  const value=await snapshot(client,id,empresaId);
  const errors=problems(value,waiver);
  if(errors.length)throw Object.assign(new Error(errors.join('; ')),{status:409,code:'REVISION_FACTURA_PENDIENTE'});
  await client.query(`INSERT INTO factura_revisiones(factura_id,empresa_id,usuario_id,huella,motivo_sin_referencia)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(factura_id) DO UPDATE SET usuario_id=$3,huella=$4,motivo_sin_referencia=$5,revisada_at=now()`,[id,empresaId,usuarioId,value.huella,waiver]);
}
async function assertReviewed(client,id,empresaId) {
  const value=await snapshot(client,id,empresaId);
  const {rows}=await client.query('SELECT * FROM factura_revisiones WHERE factura_id=$1 AND empresa_id=$2',[id,empresaId]);
  const errors=problems(value,rows[0]?.motivo_sin_referencia);
  if(!rows[0] || rows[0].huella!==value.huella)errors.push('Abre la factura y confirma la revisión de referencias, importes y documentos actuales.');
  if(errors.length)throw Object.assign(new Error(errors.join('; ')),{status:409,code:'REVISION_FACTURA_PENDIENTE'});
}
module.exports={ensureSchema,snapshot,review,assertReviewed,problems};
