// The supplied specification documents SQL procedures, not an HTTP API.
// Do not guess endpoint URLs, authentication, success responses or idempotency.
async function send() {
  throw Object.assign(new Error('NECESITA CONFIRMACIÓN DEL PROVEEDOR: contrato HTTP de ClaveiCon, autenticación, respuestas y consulta de duplicados. Utiliza la exportación manual.'), {code:'CLAVEICON_API_UNCONFIRMED',retryable:false});
}
function parseResponse() {
  throw new Error('NECESITA CONFIRMACIÓN DEL PROVEEDOR: formato de respuesta de ClaveiCon');
}
module.exports={send,parseResponse};
