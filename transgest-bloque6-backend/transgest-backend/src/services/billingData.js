function missingBillingData(record={},supplier=false){
 const fields=[['nombre','nombre o razón social'],['cif','NIF/CIF'],[supplier?'calle':'direccion','dirección fiscal'],[supplier?'codigo_postal':'cp','código postal'],['ciudad','población']];
 return fields.filter(([key])=>!String(record[key]||'').trim()).map(([,label])=>label);
}
async function billingProblem(db,id,empresaId,supplier=false){
 const {rows}=await db.query(`SELECT * FROM ${supplier?'colaboradores':'clientes'} WHERE id=$1 AND empresa_id=$2`,[id,empresaId]);
 if(!rows.length)return `No se encuentra el ${supplier?'colaborador':'cliente'} en esta empresa.`;
 const missing=missingBillingData(rows[0],supplier);
 return missing.length?`No se puede emitir la factura: faltan ${missing.join(', ')} en ${rows[0].nombre||'la ficha'}. Completa su ficha en ${supplier?'Colaboradores':'Clientes'} e inténtalo de nuevo.`:null;
}
module.exports={missingBillingData,billingProblem};
