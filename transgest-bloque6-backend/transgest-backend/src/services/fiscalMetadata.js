const invalid=message=>{throw Object.assign(new Error(message),{status:422});};
async function saveFiscalMetadata(client,id,empresaId,actorId,input={}) {
 const {rows}=await client.query('SELECT * FROM facturas WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[id,empresaId]);
 const invoice=rows[0];
 if(!invoice)throw Object.assign(new Error('Factura no encontrada'),{status:404});
 const frozen=await client.query('SELECT id FROM factura_registros_fiscales WHERE factura_id=$1 AND empresa_id=$2',[id,empresaId]);
 if(invoice.estado!=='borrador' || frozen.rows.length)throw Object.assign(new Error('Los datos de una solicitud fiscal ya registrada no se pueden modificar.'),{status:409});
 const metadata={};
 if(input.operacion_exenta){
  if(!/^E[1-6]$/.test(input.operacion_exenta) || Number(invoice.cuota_iva)!==0)invalid('La exención requiere una causa E1–E6 y cuota de IVA cero.');
  metadata.operacion_exenta=input.operacion_exenta;
 }
 if(input.calificacion_operacion){
  if(!['S1','S2','N1','N2'].includes(input.calificacion_operacion))invalid('Calificación fiscal no válida.');
  if(input.calificacion_operacion!=='S1' && Number(invoice.cuota_iva)!==0)invalid('Esta calificación requiere cuota de IVA cero.');
  if(metadata.operacion_exenta)invalid('No combines exención y no sujeción/inversión.');
  metadata.calificacion_operacion=input.calificacion_operacion;
 }
 if(invoice.factura_original_id){
  const rc=input.rectificacion || {};
  if(!/^R[1-5]$/.test(rc.tipo_factura || '') || !['I','S'].includes(rc.tipo_rectificativa))invalid('Indica el tipo R1–R5 y el método de rectificación.');
  const original=(await client.query('SELECT numero,serie,fecha,cliente_id FROM facturas WHERE id=$1 AND empresa_id=$2',[invoice.factura_original_id,empresaId])).rows[0];
  if(!original || original.cliente_id!==invoice.cliente_id)invalid('La factura original no corresponde al cliente y empresa.');
  metadata.rectificacion={tipo_factura:rc.tipo_factura,tipo_rectificativa:rc.tipo_rectificativa,original_numero:original.numero,original_serie:original.serie,original_fecha:original.fecha};
  if(rc.tipo_rectificativa==='S')for(const key of ['base_rectificada','cuota_rectificada','cuota_recargo_rectificada']){
   const value=rc[key];
   if(value==null || value==='' || !Number.isFinite(Number(value)))invalid('Completa los importes sustituidos, incluido el recargo (cero si no procede).');
   metadata.rectificacion[key]=Number(value);
  }
 }
 await client.query('UPDATE facturas SET fiscal_metadata=$1::jsonb,updated_by=$2 WHERE id=$3 AND empresa_id=$4',[JSON.stringify(metadata),actorId,id,empresaId]);
 await client.query("INSERT INTO audit_log(tabla,registro_id,campo,valor_nuevo,usuario_id,empresa_id) VALUES('facturas',$1,'fiscal_metadata',$2,$3,$4)",[id,JSON.stringify(metadata),actorId,empresaId]);
 return metadata;
}
module.exports={saveFiscalMetadata};
