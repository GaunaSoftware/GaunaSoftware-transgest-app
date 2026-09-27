const crypto=require('crypto'),{canonical}=require('./transportDocumentVersions'),{fail}=require('./plannerInventory'),{validInvoiceSql}=require('./financialKpis');
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const text=(v,n=1500)=>String(v||'').trim().slice(0,n);
const uuid=v=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v||'');
function amount(v){if(v===null||v===''||v===undefined||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>1e8)throw fail('Indica un importe neto válido.');return Math.round(Number(v)*100)/100;}
async function list(db,c,id){
 const p=(await db.query('SELECT id,numero,importe_paralizacion,paralizacion_minutos FROM pedidos WHERE empresa_id=$1 AND id::text=$2',[c,String(id)])).rows[0];if(!p)throw fail('Pedido no encontrado.',404);
 const claims=(await db.query('SELECT * FROM pedido_paralizaciones WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY created_at',[c,id])).rows;
 const documents=(await db.query("SELECT id,nombre,tipo,created_at FROM pedido_docs WHERE empresa_id=$1 AND pedido_id=$2 AND (NULLIF(file_base64,'') IS NOT NULL OR NULLIF(to_jsonb(pedido_docs)->>'file_url','') IS NOT NULL) ORDER BY created_at DESC",[c,id])).rows;
 const invoices=(await db.query(`SELECT f.id,f.numero,f.estado,f.fecha,l.importe FROM factura_lineas l JOIN facturas f ON f.id=l.factura_id WHERE f.empresa_id=$1 AND l.paralizacion_pedido_id=$2 AND ${validInvoiceSql('f')} ORDER BY f.fecha`,[c,id])).rows;
 return {pedido:p,reclamaciones:claims,documentos:documents,facturas:invoices,resumen:{documentado:claims.reduce((n,r)=>n+Number(r.documentado),0),aceptado:claims.filter(r=>r.estado==='aceptada').reduce((n,r)=>n+Number(r.aceptado),0),facturado:invoices.reduce((n,r)=>n+Number(r.importe),0),cobrado:null},definicion:'Importes netos. Intervalos reales declarados con documento y acuerdo comercial. Las líneas emitidas se enlazan al pedido; los cobros no son deducibles del estado de la factura.'};
}
async function save(db,c,user,id,input){
 if(!uuid(input.operacion))throw fail('Falta identificador de operación.');const fingerprint=hash({pedido:id,...input});
 return db.transaction(async tx=>{
  const p=(await tx.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id::text=$2 FOR UPDATE',[c,String(id)])).rows[0];if(!p)throw fail('Pedido no encontrado.',404);
  const prior=(await tx.query('SELECT * FROM pedido_paralizacion_eventos WHERE empresa_id=$1 AND operacion=$2',[c,input.operacion])).rows[0];
  if(prior){if(prior.huella!==fingerprint||prior.actor_id!==user)throw fail('Operación utilizada con otros datos.',409);return prior.datos.siguiente;}
  if(p.estado==='cancelado')throw fail('El pedido está cancelado.',409);
  if((await tx.query(`SELECT f.id FROM facturas f WHERE f.empresa_id=$1 AND (f.id=$2 OR EXISTS(SELECT 1 FROM factura_pedidos fp WHERE fp.factura_id=f.id AND fp.pedido_id=$3)) LIMIT 1`,[c,p.factura_id,id])).rows.length)throw fail('El pedido ya tiene factura o borrador. Resuelve su facturación antes de cambiar la reclamación.',409);
  const start=new Date(input.inicio),end=new Date(input.fin),documented=amount(input.documentado),accepted=input.estado==='aceptada'?amount(input.aceptado):0;
  if(!['reclamada','aceptada','rechazada'].includes(input.estado)||![input.inicio,input.fin].every(d=>/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(d||''))||!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end>Date.now()||!text(input.acuerdo)||!text(input.motivo))throw fail('Indica intervalo real finalizado con zona horaria, estado, acuerdo y motivo de revisión.');
  if(accepted>documented)throw fail('El importe aceptado supera lo documentado.');
  const doc=(await tx.query("SELECT id FROM pedido_docs WHERE empresa_id=$1 AND pedido_id=$2 AND id::text=$3 AND (NULLIF(file_base64,'') IS NOT NULL OR NULLIF(to_jsonb(pedido_docs)->>'file_url','') IS NOT NULL)",[c,id,String(input.documento_id)])).rows[0];if(!doc)throw fail('Selecciona un documento de este pedido que acredite la paralización.',404);
  const old=input.id?(await tx.query('SELECT * FROM pedido_paralizaciones WHERE empresa_id=$1 AND pedido_id=$2 AND id::text=$3 FOR UPDATE',[c,id,String(input.id)])).rows[0]:null;
  if(input.id&&(!old||old.version!==Number(input.version)))throw fail('La reclamación ha cambiado. Actualiza.',409);
  if(input.estado!=='rechazada'){const overlap=(await tx.query("SELECT id FROM pedido_paralizaciones WHERE empresa_id=$1 AND pedido_id=$2 AND estado<>'rechazada' AND inicio<$4 AND fin>$3 AND id IS DISTINCT FROM $5::uuid LIMIT 1",[c,id,start,end,old?.id||null])).rows[0];if(overlap)throw fail('El intervalo se solapa con otra reclamación. Revisa la existente.',409);}
  if(!old){
   if(Number(p.importe_paralizacion)>0&&!(await tx.query('SELECT id FROM pedido_paralizaciones WHERE empresa_id=$1 AND pedido_id=$2',[c,id])).rows.length)throw fail('Existe una paralización manual. Documenta primero su importe en el pedido sin duplicarlo; este flujo requiere revisión del valor previo.',409);
  }
  const params=[c,id,input.estado,start,end,(end-start)/60000,documented,accepted,doc.id,text(input.acuerdo),text(input.motivo),user,input.operacion,fingerprint];
  let row;
  if(old)row=(await tx.query('UPDATE pedido_paralizaciones SET estado=$3,inicio=$4,fin=$5,minutos=$6,documentado=$7,aceptado=$8,documento_id=$9,acuerdo=$10,motivo=$11,version=version+1,updated_at=now() WHERE empresa_id=$1 AND pedido_id=$2 AND id=$12 RETURNING *',[...params.slice(0,11),old.id])).rows[0];
  else row=(await tx.query('INSERT INTO pedido_paralizaciones(empresa_id,pedido_id,estado,inicio,fin,minutos,documentado,aceptado,documento_id,acuerdo,motivo,created_by,operacion,huella) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',params)).rows[0];
  await tx.query("UPDATE pedidos SET importe_paralizacion=(SELECT COALESCE(sum(aceptado) FILTER(WHERE estado='aceptada'),0) FROM pedido_paralizaciones WHERE empresa_id=$1 AND pedido_id=$2) WHERE empresa_id=$1 AND id=$2",[c,id]);
  await tx.query('INSERT INTO pedido_paralizacion_eventos(empresa_id,reclamacion_id,operacion,huella,actor_id,datos) VALUES($1,$2,$3,$4,$5,$6)',[c,row.id,input.operacion,fingerprint,user,JSON.stringify({anterior:old,siguiente:row})]);return row;
 });
}
// Report only the authorized service cohort. Claims are reconstructed from their audited revisions.
async function recovery(db,c,orders,cutoff){
 const ids=orders.map(p=>String(p.id));
 const definition='Importes netos de la cohorte de servicios filtrada. Reclamaciones según la última revisión registrada al corte; documentado facturable excluye rechazadas. Facturas válidas con fecha hasta el corte y estado vigente. Sin libro de cobros aplicados: no calculable. Los importes manuales sin expediente quedan fuera del porcentaje.';
 const empty={estado:'sin_datos',documentado:null,aceptado:null,facturado:null,porcentaje:null,cobrado:null,rows:[],cobertura:{evaluables:0,total:orders.length},definicion:definition,fecha_corte:cutoff};
 if(!ids.length)return empty;
 if(!(await db.query("SELECT to_regclass('pedido_paralizacion_eventos') AS relation")).rows[0]?.relation)return {...empty,fuente_no_disponible:true};
 const claims=(await db.query(`SELECT DISTINCT ON (e.reclamacion_id) e.datos->'siguiente' AS snapshot
   FROM pedido_paralizacion_eventos e JOIN pedido_paralizaciones p ON p.id=e.reclamacion_id AND p.empresa_id=e.empresa_id
   WHERE e.empresa_id=$1 AND p.pedido_id=ANY($2::uuid[]) AND e.created_at < (($3::date+INTERVAL '1 day') AT TIME ZONE 'Europe/Madrid')
   ORDER BY e.reclamacion_id,e.created_at DESC,(e.datos->'siguiente'->>'version')::int DESC`,[c,ids,cutoff])).rows.map(r=>r.snapshot);
 const lines=(await db.query(`SELECT l.id,l.paralizacion_pedido_id AS pedido_id,l.importe FROM factura_lineas l JOIN facturas f ON f.id=l.factura_id
   WHERE f.empresa_id=$1 AND l.paralizacion_pedido_id=ANY($2::uuid[]) AND f.fecha<=$3::date AND ${validInvoiceSql('f')}`,[c,ids,cutoff])).rows;
 const result=recoveryTotals(c,orders,claims,lines);return {...empty,...result,definicion:definition,fecha_corte:cutoff};
}
function recoveryTotals(c,orders,claims,lines){
 const map=new Map(orders.filter(p=>String(p.empresa_id)===String(c)).map(p=>[String(p.id),{id:p.id,numero:p.numero,documentado:0,aceptado:0,facturado:0,reclamaciones:0}]));
 const seen=new Set();for(const r of claims){if(r.estado==='preparada')continue;const p=map.get(String(r.pedido_id));if(!p||String(r.empresa_id)!==String(c)||seen.has(r.id))continue;seen.add(r.id);p.reclamaciones++;if(r.estado!=='rechazada')p.documentado+=Number(r.documentado);if(r.estado==='aceptada')p.aceptado+=Number(r.aceptado);}
 const seenLines=new Set();let unmatched=0;for(const l of lines){const p=map.get(String(l.pedido_id));if(!p||seenLines.has(l.id))continue;seenLines.add(l.id);if(p.reclamaciones)p.facturado+=Number(l.importe);else unmatched+=Number(l.importe);}
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const rows=[...map.values()].filter(p=>p.reclamaciones).map(p=>({...p,documentado:round(p.documentado),aceptado:round(p.aceptado),facturado:round(p.facturado)}));
 const sums=key=>rows.length?round(rows.reduce((n,r)=>n+r[key],0)):null;
 const documented=sums('documentado'),invoiced=sums('facturado');return {estado:rows.length?'parcial':'sin_datos',documentado:documented,aceptado:sums('aceptado'),facturado:invoiced,porcentaje:documented>0?round(invoiced/documented*100):null,cobrado:null,facturado_sin_expediente:round(unmatched),rows,cobertura:{evaluables:rows.length,total:map.size}};
}
module.exports={list,save,recovery,recoveryTotals};
