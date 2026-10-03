const fs=require('fs'),path=require('path');
const {parseLocaleNumber}=require('../utils/number');
const {date}=require('./supplierTripPayment');
const invoices=require('./supplierInvoiceReview');
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const schemas=new WeakMap();
async function ensure(db){
 if(!schemas.has(db))schemas.set(db,db.query(fs.readFileSync(path.join(__dirname,'../../scripts/migrations/20261002_supplier_invoice_payments.sql'),'utf8')).catch(e=>{schemas.delete(db);throw e;}));
 await schemas.get(db);
}
async function read(db,company,id){
 const invoice=await invoices.get(db,company,id);
 const payments=(await db.query("SELECT id,fecha,importe,estado,referencia,notas,created_at FROM colaborador_pagos WHERE empresa_id=$1 AND factura_proveedor_id=$2 ORDER BY fecha,id",[company,id])).rows;
 const total=Math.round(Number(invoice.datos?.total||0)*100),paid=payments.filter(p=>p.estado==='pagado').reduce((n,p)=>n+Math.round(Number(p.importe)*100),0);
 return {total:total/100,pagado:paid/100,pendiente:(total-paid)/100,pagos:payments};
}
async function record(db,company,id,actor,input){
 await ensure(db);
 const value=parseLocaleNumber(input.importe,NaN),amount=Math.round(value*100),when=date(input.fecha),operation=input.client_operation_uuid;
 if(!uuid(operation)||!when||!Number.isFinite(value)||value<=0||value>=1e10||Math.abs(value*100-amount)>1e-6)throw fail('Indica una fecha y un importe positivo con hasta dos decimales.');
 return db.transaction(async tx=>{
   const invoice=await invoices.get(tx,company,id,{lock:true});
   if(invoice.estado!=='revisada')throw fail('Revisa la factura original antes de registrar su pago.',409);
   const existing=(await tx.query('SELECT * FROM colaborador_pagos WHERE empresa_id=$1 AND client_operation_uuid=$2',[company,operation])).rows[0];
   if(existing){if(existing.factura_proveedor_id!==id||Math.round(Number(existing.importe)*100)!==amount||String(existing.fecha instanceof Date?existing.fecha.toISOString():existing.fecha).slice(0,10)!==when)throw fail('Este identificador corresponde a otro pago.',409);return {...await read(tx,company,id),repetido:true};}
   const balance=await read(tx,company,id);
   if(amount>Math.round(balance.pendiente*100))throw fail('El importe supera el saldo pendiente de esta factura.',409);
   const reference=String(input.referencia||'').trim().slice(0,180),notes=String(input.notas||'').trim().slice(0,2000);
   if(!reference)throw fail('Indica la referencia del pago realizado (transferencia, recibo u otro justificante).');
   const payment=(await tx.query(`INSERT INTO colaborador_pagos(empresa_id,colaborador_id,factura_proveedor_id,client_operation_uuid,fecha,importe,concepto,referencia,notas,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[company,invoice.proveedor_id,id,operation,when,amount/100,'Pago factura '+String(invoice.numero||invoice.nombre).slice(0,150),reference,notes,actor])).rows[0];
   const result=await read(tx,company,id);
   await tx.query("UPDATE colaborador_facturas SET estado=$3,updated_at=NOW() WHERE empresa_id=$1 AND factura_proveedor_id=$2",[company,id,result.pendiente===0?'pagada':'pendiente']);
   await invoices.event(tx,company,id,actor,'pago_registrado',{pago_id:payment.id,fecha:when,importe:amount/100,referencia:reference});
   return result;
 }).catch(e=>{if(e.code==='23505')throw fail('Este identificador ya se ha utilizado para registrar un pago.',409);throw e;});
}
module.exports={ensure,read,record};
