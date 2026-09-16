// Headers win even when empty or malformed: never fall back to a query token
// after a caller explicitly supplied authentication headers.
function integrationSecret(req, headerNames, queryName) {
  const headers=req.headers || {};
  for(const name of headerNames) {
    if(Object.prototype.hasOwnProperty.call(headers,name)) return typeof headers[name] === 'string' ? headers[name].trim() : '';
  }
  if(Object.prototype.hasOwnProperty.call(headers,'authorization')) {
    const match=/^Bearer\s+(.+)$/i.exec(String(headers.authorization || ''));
    return match ? match[1].trim() : '';
  }
  if(process.env.ALLOW_LEGACY_INTEGRATION_QUERY_SECRETS === 'false') return '';
  const value=req.query?.[queryName];
  return typeof value === 'string' ? value.trim() : '';
}

const SECRET_KEY=/(password|passwd|secret|token|authorization|api.?key|credential|private.?key|cookie)/i;
function redactText(value) {
  return String(value)
    .replace(/([?&](?:[^=&#\s]*(?:token|secret|password|api[_-]?key|signature|verify)[^=&#\s]*)=)[^&#\s"']*/gi,'$1[REDACTED]')
    .replace(/\bBearer\s+[^\s"']+/gi,'Bearer [REDACTED]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@');
}
function redactSecrets(value, seen=new WeakSet()) {
  if(typeof value === 'string') return redactText(value);
  if(!value || typeof value !== 'object') return value;
  if(seen.has(value)) return '[Circular]';
  seen.add(value);
  const result=Array.isArray(value)?[]:{};
  for(const key of Object.keys(value)) result[key]=SECRET_KEY.test(key)?'[REDACTED]':redactSecrets(value[key],seen);
  return result;
}
// Access logs do not need query parameters or signed public-link path tokens.
function logRequestPath(req) {
  return String(req.originalUrl || req.url || '/').split('?')[0]
    .replace(/(\/public\/[^/]+\/)[^/]+/gi,'$1[REDACTED]')
    .replace(/(\/(?:token|access|confirmar)\/)[^/]+/gi,'$1[REDACTED]');
}
module.exports={integrationSecret,redactSecrets,redactText,logRequestPath};
