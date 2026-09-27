const verifacti = require('./fiscalProviderVerifacti');
// Common contract; unavailable connectors never simulate production acceptance.
function fiscalProvider(config) {
  if (config.modo === 'verifactu' && config.verifactu?.proveedor === 'verifacti') return {
    name: 'verifacti', sendRecord: item => verifacti.createVerifactiRecord(config, item),
    cancelRecord: item => verifacti.cancelVerifactiRecord(config, item),
    getStatus: uuid => verifacti.getVerifactiRecordStatus(config, uuid),
    healthCheck: () => verifacti.probeVerifactiConnection(config),
  };
  const unavailable = async () => { throw Object.assign(new Error('Conector AEAT directo/SII pendiente de validación; no disponible.'), { status: 501 }); };
  return { name: config.modo === 'sii' ? 'sii' : 'aeat_directo', sendRecord: unavailable, cancelRecord: unavailable, getStatus: unavailable, healthCheck: async () => ({ ok: false, status: 'planned' }) };
}
module.exports = { fiscalProvider };
