// Printed invoices retain the identities sent to the fiscal provider, even when
// the current customer/company profile is edited later.
function applyFiscalInvoiceSnapshot(invoice,record) {
 const recipient=record?.payload?.receptor;
 const issuer=record?.payload?.emisor;
 if(!recipient || invoice.estado==='borrador')return invoice;
 const result={...invoice,fiscal_identity_frozen:true,cliente_nombre:recipient.nombre,cliente_cif:recipient.nif};
 for(const [key,target] of [['direccion','cliente_direccion'],['cp','cliente_cp'],['ciudad','cliente_ciudad'],['pais','cliente_pais']]){
  if(Object.hasOwn(recipient,key))result[target]=recipient[key];
 }
 if(Object.hasOwn(recipient,'direccion'))result.cliente_dir=recipient.direccion;
 if(issuer)result.emisor_fiscal={nombre:issuer.nombre,razon_social:issuer.nombre,cif:issuer.nif,...(Object.hasOwn(issuer,'domicilio')?{domicilio:issuer.domicilio}:{})};
 return result;
}
module.exports={applyFiscalInvoiceSnapshot};
