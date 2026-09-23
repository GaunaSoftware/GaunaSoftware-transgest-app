const { officialQrUrl } = require('./fiscalProviderVerifacti');

// Prefer the PNG supplied by Verifacti. Only reconstruct the same official URL
// when a status response supplies the URL without the original image.
async function officialQrImage(url, image) {
  const officialUrl = officialQrUrl(url);
  if (!officialUrl) return null;
  const base64 = typeof image === 'string'
    ? image.replace(/^data:image\/png;base64,/, '') : '';
  if (base64.length <= 2 * 1024 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      && bytes.toString('ascii', 12, 16) === 'IHDR'
      && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 4096
      && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 4096) return bytes;
  }
  return require('qrcode').toBuffer(officialUrl, { width: 280, margin: 4, errorCorrectionLevel: 'M' });
}

module.exports = { officialQrImage };
