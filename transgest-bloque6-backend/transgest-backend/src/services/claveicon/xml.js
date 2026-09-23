// ClaveiCon: Intercambio XML, enero de 2020, and vendor examples supplied by the customer.
// This is accounting interchange, never an AEAT registration XML.
const HEADER = '<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>';
function fail(message) { throw Object.assign(new Error(message), { status: 422 }); }
function field(value, max, name) {
  const text = String(value ?? '').trim();
  if (text.length > max) fail(`${name}: máximo ${max} caracteres`);
  return text;
}
function escape(value) {
  return Array.from(String(value ?? '')).map(c => {
    const n = c.codePointAt(0);
    if (n < 32 || n === 0xFFFE || n === 0xFFFF) fail('Carácter de control no permitido en XML');
    return ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'})[c] || (n > 127 ? `&#${n};` : c);
  }).join('');
}
function attributes(values) {
  return Object.entries(values).map(([key,value]) => `${key.toLowerCase()}="${escape(value)}"`).join(' ');
}
function document(body) { return Buffer.from(`${HEADER}\n<ROOT>\n${body}\n</ROOT>\n`, 'latin1'); }
function money(value) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) fail('Importe obligatorio o no válido');
  const n = Number(value); return (Math.round((n + Math.sign(n)*Number.EPSILON)*100)/100).toFixed(2);
}
function dateOnly(value) {
  const v = value instanceof Date ? value.toISOString().slice(0,10) : String(value || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10)!==v) fail('Fecha obligatoria o no válida');
  return v;
}
function date(value) { return `${dateOnly(value)} 00:00:00`; }
function year(value) { return dateOnly(value).slice(0,4); }
function bit(value) { if (![true,false,0,1,'0','1'].includes(value)) fail('Valor booleano no válido'); return value === true || value === 1 || value === '1' ? '1' : '0'; }
function config(input={}) {
  const c={};
  for (const key of ['codemp','ivaope','ivadia','ivacon','codtipopre','codban']) c[key]=field(input[key],5,key);
  c.codusu=field(input.codusu,10,'codusu');
  for (const key of ['sales_account','vat_account','withholding_account','customer_root']) c[key]=field(input[key],15,key);
  c.ivagenast=bit(input.ivagenast ?? false);
  c.mode=input.mode === 'api' ? 'api' : 'manual_file';
  c.sign_confirmed=input.sign_confirmed === true;
  c.amount_sign=Number(input.amount_sign) === -1 ? -1 : 1;
  c.ivbtret=field(input.ivbtret,1,'ivbtret');
  if (!c.codemp) fail('ClaveiCon: falta el código de empresa');
  return c;
}
function accountCode(value) { const v=field(value,15,'Cuenta contable');if(!v)fail('Cuenta contable obligatoria');return v; }
function emptyFields(spec) {
  return Object.fromEntries(spec.split(/\s+/).filter(Boolean).map(s=> { const [key,type]=s.split(':');return [key,type==='n'?'0':'']; }));
}
function buildAccountXml(party, code, settings) {
  const c=config(settings);
  const row={...emptyFields('codemp cuecod cuedes dnifis razonsocial direccion codpostal poblacion provincia telefono fax siglas numero escalera piso puerta direccion2 apdocorreos clavefiscal:n codpais codtipopre cuenumplazos:n cuediasplazos:n cuediapago1:n cuediapago2:n ccc swift ibaniso ibancontrol crjcaja:n email emailpagos web'),codemp:c.codemp,cuecod:accountCode(code)};
  const values={cuedes:[party.nombre,35],razonsocial:[party.nombre,50],dnifis:[party.cif,28],direccion:[party.direccion,50],codpostal:[party.cp || party.codigo_postal,10],poblacion:[party.ciudad || party.poblacion,30],provincia:[party.provincia,30],telefono:[party.telefono,15],email:[party.email_facturacion || party.email,100]};
  for (const [key,[value,length]] of Object.entries(values)) row[key]=field(value,length,key);
  row.clavefiscal=String(party.clavefiscal ?? 1);row.codtipopre=c.codtipopre;
  if(!row.dnifis || !row.razonsocial)fail('Faltan NIF o nombre fiscal del cliente');
  return document(`<c ${attributes(row)}/>`);
}
function requireConfirmed(c) {
  if(!c.sign_confirmed) fail('NECESITA CONFIRMACIÓN DEL PROVEEDOR: convenio de signos de facturas y previsiones de ClaveiCon');
}
function buildInvoiceXml(invoice, party, code, settings) {
  const c=config(settings); requireConfirmed(c);
  if (invoice.factura_original_id || invoice.factura_original_numero) fail('NECESITA CONFIRMACIÓN DEL PROVEEDOR: formato Ser/Eje/Fac de ivafrarectifi para rectificativas');
  for(const key of ['ivaope','ivadia','ivacon','codusu','sales_account'])if(!c[key])fail(`ClaveiCon: falta ${key}`);
  const sign=c.amount_sign;
  const amount=v=>money(Number(v)*sign);
  const h={...emptyFields('codemp codeje:n ivatip ivaser ivaord:n ivacta ivades ivacif ivafac ivafas ivaope ivadoc ivacon ivadescon ivaampcon ivagenast:n ivadia ivaobs iva347:n iva349:n ivatbas:n ivativa:n ivatirpt:n ivatfra:n ivaserieges ivaejerges:n ivanumfacges:n ivaproyecto codusu ivctadto ivafdireccion ivafpoblacion ivafprovincia ivafpais ivafcodpostal ivafclavefiscal:n ivabcreacuenta:n ivadesproyecto coddivisa impcambio:n ivagenprev:n ivafecval ivafrarectifi ivacrjcaja:n baseimpdua:n impivadua:n referenciadua fecexpediciondua siidescope primerafac340:n ultimafac340:n serresfac claveoperacion303 siifecregcon iddoc tributades:n'),codemp:c.codemp,codeje:year(invoice.fecha),ivatip:'R',ivaser:field(invoice.serie,5,'serie'),ivaord:'0',ivacta:accountCode(code),ivades:field(party.nombre,35,'ivades'),ivacif:field(party.cif,28,'ivacif'),ivafac:date(invoice.fecha),ivafas:date(invoice.fecha),ivaope:c.ivaope,ivadoc:field(invoice.numero,60,'ivadoc'),ivacon:c.ivacon,ivaampcon:field(invoice.numero,30,'ivaampcon'),ivagenast:c.ivagenast,ivadia:c.ivadia,ivatbas:amount(invoice.base_imponible),ivativa:amount(invoice.cuota_iva),ivatirpt:amount(invoice.cuota_irpf || 0),ivatfra:amount(invoice.total),codusu:c.codusu};
  const taxes=invoice.tax_lines || [{base:invoice.base_imponible,vat_rate:invoice.tipo_iva,vat:invoice.cuota_iva,irpf_rate:invoice.tipo_irpf || 0,irpf:invoice.cuota_irpf || 0,non_taxable:invoice.iva_regimen==='no_sujeto'}];
  const sum=k=>taxes.reduce((total,l)=>total+Number(l[k]||0),0);
  if(money(sum('base'))!==money(invoice.base_imponible) || money(sum('vat'))!==money(invoice.cuota_iva) || money(sum('irpf'))!==money(invoice.cuota_irpf || 0) || money(sum('base')+sum('vat')-sum('irpf'))!==money(invoice.total))fail('El desglose fiscal no coincide con los totales de la factura');
  const lines=taxes.map((l,i)=>{
    if(Number(l.irpf) && !c.ivbtret)fail('ClaveiCon: configura el tipo de retención ivbtret');
    const row={ivbnbas:String(i+1),ivbbru:amount(l.base),ivbpdto:'0',ivbdto:'0',ivbpirpf:money(l.irpf_rate||0),ivbirpf:amount(l.irpf||0),ivbbas:amount(l.base),ivbiva:money(l.vat_rate||0),ivbimpiva:amount(l.vat||0),ivbrec:'0',ivbimprec:'0',ivbinv:'0',ivbdec:'1',ivbpro:'0',ivbtret:c.ivbtret,ivbnosujeto:bit(l.non_taxable||false)};
    const counterpart={ivcbas:'1',ivccta:accountCode(c.sales_account),ivcimp:amount(l.base),ivccco:'',ivcdpto:'',ivcproyecto:'',ivcseccion:'',ivcamp:'',ivcdes:''};
    return `<l ${attributes(row)}><p ${attributes(counterpart)}/></l>`;
  }).join('\n');
  return document(`<c ${attributes(h)}>\n${lines}\n</c>`);
}
function buildReceivableXml(invoice, code, settings) {
  const c=config(settings);requireConfirmed(c);
  if(!c.codtipopre || !c.codban || !c.codusu)fail('Configura tipo de previsión, banco y usuario ClaveiCon');
  const row={...emptyFields('codemp pretip ejeemp:n prefra preord:n precta codtipopre prefecfra prevto codban pretipiva preejeiva:n preseriva preordiva:n preimporte:n codusu precifpro precccpro preibaniso preibancontrol preamp proyecto coddivisa impcambio:n impdivisa:n'),codemp:c.codemp,pretip:'C',ejeemp:year(invoice.fecha),prefra:field(invoice.numero,60,'prefra'),preord:'1',precta:accountCode(code),codtipopre:c.codtipopre,prefecfra:date(invoice.fecha),prevto:date(invoice.fecha_vencimiento),codban:c.codban,pretipiva:'R',preejeiva:year(invoice.fecha),preseriva:field(invoice.serie,5,'serie'),preordiva:'0',preimporte:money(Number(invoice.total)*c.amount_sign),codusu:c.codusu};
  return document(`<c ${attributes(row)}/>`);
}
module.exports={config,buildAccountXml,buildInvoiceXml,buildReceivableXml,date,year,money,escape,bit};
