const crypto=require('crypto');
const xml=require('./xml');
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');
async function settings(client,empresaId) {
 const {rows}=await client.query("SELECT configuracion->'claveicon' AS config FROM empresas WHERE id=$1",[empresaId]);
 return rows[0]?.config || {};
}
async function enqueueAcceptedInvoice(client,item) {
 const accepted=await client.query("SELECT id,payload FROM factura_registros_fiscales WHERE factura_id=$1 AND empresa_id=$2 AND estado_envio='aceptado'",[item.factura_id,item.empresa_id]);
 if(!accepted.rows.length)return;
 const cfg=await settings(client,item.empresa_id);
 const internal=require("../accountingSync").accountingConfigured();
 if(cfg.enabled!==true && !internal)return;
 const {rows}=await client.query(`SELECT f.*,to_jsonb(c) AS party FROM facturas f JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id WHERE f.id=$1 AND f.empresa_id=$2`,[item.factura_id,item.empresa_id]);
 const invoice=rows[0];if(!invoice || invoice.estado==='borrador')return;
 const recipient=accepted.rows[0].payload?.receptor;
 if(recipient)invoice.party={...invoice.party,nombre:recipient.nombre,cif:recipient.nif,...Object.fromEntries(['direccion','cp','ciudad','pais'].filter(k=>Object.hasOwn(recipient,k)).map(k=>[k,recipient[k]]))};
 const payload={invoice:{id:invoice.id,numero:invoice.numero,serie:invoice.serie,fecha:invoice.fecha,fecha_vencimiento:invoice.fecha_vencimiento,base_imponible:invoice.base_imponible,tipo_iva:invoice.tipo_iva,cuota_iva:invoice.cuota_iva,tipo_irpf:invoice.tipo_irpf,cuota_irpf:invoice.cuota_irpf,total:invoice.total,iva_regimen:invoice.iva_regimen,factura_original_id:invoice.factura_original_id,factura_original_numero:invoice.factura_original_numero},party:invoice.party,source_party_id:invoice.cliente_id};
 if(internal)await client.query(`INSERT INTO accounting_invoice_outbox(empresa_id,factura_id,provider,entity_type,payload,payload_hash) VALUES($1,$2,'internal','invoice',$3::jsonb,$4) ON CONFLICT(empresa_id,provider,factura_id,entity_type) DO NOTHING`,[item.empresa_id,item.factura_id,JSON.stringify(payload),digest(payload)]);
 if(cfg.enabled!==true)return;
 for(const type of ['account','invoice','receivable'])await client.query(`INSERT INTO accounting_invoice_outbox(empresa_id,factura_id,provider,entity_type,payload,payload_hash) VALUES($1,$2,'claveicon',$3,$4::jsonb,$5) ON CONFLICT(empresa_id,provider,factura_id,entity_type) DO NOTHING`,[item.empresa_id,item.factura_id,type,JSON.stringify(payload),digest(payload)]);
}
async function recoverAcceptedInvoices(client,empresaId) {
 const cfg=await settings(client,empresaId);
 const providers=[];
 if(cfg.enabled===true)providers.push('claveicon');
 if(require('../accountingSync').accountingConfigured())providers.push('internal');
 if(!providers.length)return;
 const {rows}=await client.query(`SELECT r.factura_id,r.empresa_id FROM factura_registros_fiscales r JOIN facturas f ON f.id=r.factura_id AND f.empresa_id=r.empresa_id
  WHERE r.empresa_id=$1 AND r.modo='verifactu' AND r.estado_envio='aceptado' AND f.estado<>'borrador'
  AND (EXISTS(SELECT 1 FROM factura_envios_fiscales q WHERE q.registro_id=r.id AND q.provider_uuid IS NOT NULL))
  AND EXISTS(SELECT 1 FROM unnest($2::text[]) wanted(provider) WHERE NOT EXISTS(SELECT 1 FROM accounting_invoice_outbox o WHERE o.factura_id=f.id AND o.empresa_id=f.empresa_id AND o.provider=wanted.provider)) ORDER BY r.accepted_at LIMIT 100`,[empresaId,providers]);
 for(const item of rows)await enqueueAcceptedInvoice(client,item);
}
async function accountMapping(client,empresaId,partyId,cfg) {
 await client.query('SELECT id FROM empresas WHERE id=$1 FOR UPDATE',[empresaId]);
 const existing=await client.query("SELECT account_code FROM accounting_party_mappings WHERE empresa_id=$1 AND provider='claveicon' AND party_type='customer' AND source_party_id=$2",[empresaId,partyId]);
 if(existing.rows[0])return existing.rows[0].account_code;
 const root=String(cfg.customer_root || '');
 if(!/^\d{3,10}$/.test(root))throw Object.assign(new Error('Configura la raíz de cuentas de clientes (3 a 10 dígitos).'),{status:422});
 const rows=await client.query("SELECT account_code FROM accounting_party_mappings WHERE empresa_id=$1 AND provider='claveicon'",[empresaId]);
 const used=new Set(rows.rows.map(r=>r.account_code));let n=1,code;
 do {code=root+String(n++).padStart(15-root.length,'0');}while(used.has(code));
 if(code.length>15)throw new Error('Se ha agotado la numeración de cuentas de clientes');
 await client.query("INSERT INTO accounting_party_mappings(empresa_id,provider,party_type,source_party_id,account_code) VALUES($1,'claveicon','customer',$2,$3)",[empresaId,partyId,code]);return code;
}
async function exportEntity(client,empresaId,id) {
 const {rows}=await client.query("SELECT * FROM accounting_invoice_outbox WHERE id=$1 AND empresa_id=$2 AND provider='claveicon' FOR UPDATE",[id,empresaId]);
 const item=rows[0];if(!item)throw Object.assign(new Error('Envío no encontrado'),{status:404});
 if(item.status==='synced')throw Object.assign(new Error('Este registro ya está contabilizado.'),{status:409});
 if(item.status==='unknown')throw Object.assign(new Error('Concilia el resultado desconocido en Clavei antes de reexportar.'),{status:409});
 const fiscal=await client.query("SELECT estado_envio FROM factura_registros_fiscales WHERE factura_id=$1 AND empresa_id=$2",[item.factura_id,empresaId]);
 if(fiscal.rows[0]?.estado_envio!=='aceptado')throw Object.assign(new Error('La factura todavía no está aceptada por AEAT.'),{status:409});
 if(digest(item.payload)!==item.payload_hash)throw new Error('El contenido contable ha cambiado: integridad no válida');
 const dependency={invoice:'account',receivable:'invoice'}[item.entity_type];
 if(dependency){const result=await client.query("SELECT status FROM accounting_invoice_outbox WHERE empresa_id=$1 AND factura_id=$2 AND provider='claveicon' AND entity_type=$3",[empresaId,item.factura_id,dependency]);if(result.rows[0]?.status!=='synced')throw Object.assign(new Error(`Confirma primero la importación de ${dependency==='account'?'la cuenta':'la factura'} en ClaveiCon.`),{status:409});}
 const cfg=await settings(client,empresaId);
 if(cfg.mode==='api')return require('./transport').send();
 const code=await accountMapping(client,empresaId,item.payload.source_party_id,cfg);
 const {invoice,party}=item.payload;
 const buffer=item.entity_type==='account'?xml.buildAccountXml(party,code,cfg):item.entity_type==='invoice'?xml.buildInvoiceXml(invoice,party,code,cfg):xml.buildReceivableXml(invoice,code,cfg);
 const fileHash=crypto.createHash('sha256').update(buffer).digest('hex');
 // Download does not mean imported. Freeze the delivered bytes until an operator reconciles the result.
 if(item.external_ref && item.external_ref!==fileHash)throw Object.assign(new Error('La configuración cambió después de exportar. Concilia el fichero anterior antes de generar otro.'),{status:409});
 await client.query("UPDATE accounting_invoice_outbox SET status='processing',attempts=attempts+1,last_error=NULL,external_ref=$1,exported_at=NOW(),updated_at=NOW() WHERE id=$2 AND empresa_id=$3",[fileHash,id,empresaId]);
 return {buffer,filename:`claveicon-${item.entity_type}-${invoice.numero.replace(/[^a-zA-Z0-9_-]/g,'_')}.xml`,hash:fileHash};
}
module.exports={settings,enqueueAcceptedInvoice,recoverAcceptedInvoices,exportEntity,accountMapping,digest};
