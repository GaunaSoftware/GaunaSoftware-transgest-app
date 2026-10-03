const key = value => String(value || '').toUpperCase().replace(/[\s.-]/g,'');
function validCompanyId(value) {
  const cif=key(value);
  if (!/^[ABCDEFGHJNPQRSUVW]\d{7}[\dA-J]$/.test(cif)) return false;
  const digits=[...cif.slice(1,8)].map(Number);
  const total=digits.reduce((sum,n,i)=>sum+(i%2===1?n:Math.floor(n*2/10)+n*2%10),0);
  const control=(10-total%10)%10, last=cif[8];
  const numeric=String(control), letter='JABCDEFGHI'[control];
  return /^[ABEH]/.test(cif) ? last===numeric : /^[PQRSW]/.test(cif) ? last===letter : last===numeric||last===letter;
}
function validIndividualId(value) {
  const nif=key(value).replace(/^[XYZ]/,c=>String('XYZ'.indexOf(c)));
  return /^\d{8}[A-Z]$/.test(nif) && 'TRWAGMYFPDXBNJZSQVHLCKE'[Number(nif.slice(0,8))%23]===nif[8];
}
export function inferSupplierType(name,cif) {
  if (validCompanyId(cif)) return 'empresa';
  if (validIndividualId(cif)) return 'autonomo';
  if (/(?:\bS\.?\s?L\.?U?\.?|\bS\.?\s?A\.?U?\.?|\bS\.?\s?COOP\.?|\bLTD\.?|\bGMBH)\s*$/i.test(String(name||''))) return 'empresa';
  return null;
}
