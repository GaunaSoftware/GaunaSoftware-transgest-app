const crypto = require('crypto');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const serialize = value => JSON.stringify(canonical(JSON.parse(JSON.stringify(value))));
const digest = value => crypto.createHash('sha256').update(serialize(value)).digest('hex');
module.exports = { serialize, digest };
