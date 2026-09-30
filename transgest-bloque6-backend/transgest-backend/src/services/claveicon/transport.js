// ClaveiCon gateway contract supplied by the customer, version 0.2.3.
// This probe is read-only. Imports remain disabled until their non-idempotent
// failure cases have been validated against the PRUEB company.
const COMPANIES_URL = 'https://gateway.claveicowork.com/api/v1/config/companies';

function companyRows(body) {
  if (Array.isArray(body)) return body;
  for (const field of ['companies', 'data', 'items', 'result']) {
    if (Array.isArray(body?.[field])) return body[field];
  }
  return null;
}

function companyCode(row) {
  if (typeof row === 'string') return row.trim();
  return String(row?.companyCode ?? row?.codemp ?? row?.codigo ?? row?.code ?? '').trim();
}

async function listCompanies({apiKey, expectedCode, fetchImpl=fetch, timeoutMs=8000}) {
  if (!apiKey || /[\r\n]/.test(apiKey)) throw Object.assign(new Error('Falta una clave privada válida de ClaveiCon.'),{status:422});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchImpl(COMPANIES_URL,{
      method:'GET',
      headers:{Accept:'application/json',apikey:apiKey},
      signal:controller.signal,
    });
    if(!response.ok)return {ok:false,http_status:response.status,company_visible:false,company_list_recognized:false};
    const body=await response.json().catch(()=>null);
    const rows=companyRows(body);
    const expected=String(expectedCode||'').trim();
    return {ok:true,http_status:response.status,company_list_recognized:!!rows,company_visible:!!rows?.some(row=>companyCode(row)===expected)};
  } finally {clearTimeout(timer);}
}
async function send() {
  throw Object.assign(new Error('La importación API de ClaveiCon sigue bloqueada hasta validar el resultado de PRUEB y la conciliación de duplicados. Utiliza la exportación XML manual.'), {code:'CLAVEICON_IMPORT_NOT_VALIDATED',retryable:false});
}
function parseResponse() {
  throw new Error('Pendiente de validar el formato real de respuesta de importación de ClaveiCon');
}
module.exports={listCompanies,send,parseResponse};
