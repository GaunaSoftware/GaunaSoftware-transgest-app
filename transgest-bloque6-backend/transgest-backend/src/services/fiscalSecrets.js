const {encryptSecret,decryptSecret}=require('./apiKeys');
const paths=[['verifactu','provider_api_key'],['verifactu','provider_webhook_secret'],['factura_b2b','api_key']];
function encryptFiscalSecrets(config) {
  const result=JSON.parse(JSON.stringify(config));
  for(const [group,key] of paths) {
    if(result[group]?.[key]) result[group][key]=encryptSecret(decryptSecret(result[group][key]));
  }
  return result;
}
function sanitizeNestedFiscal(value) {
  if(Array.isArray(value)) return value.map(sanitizeNestedFiscal);
  if(!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  const result={...value};
  for(const [key,item] of Object.entries(value)) {
    if(key === 'facturacion_fiscal' && item && typeof item === 'object') {
      const config=JSON.parse(JSON.stringify(item));
      for(const [group,secretKey] of paths) if(config[group]) {
        const present=Boolean(config[group][secretKey]);
        delete config[group][secretKey];
        config[group][secretKey+'_masked']=present?'********':'';
      }
      result[key]=config;
    } else result[key]=sanitizeNestedFiscal(item);
  }
  return result;
}
module.exports={encryptFiscalSecrets,sanitizeNestedFiscal};
