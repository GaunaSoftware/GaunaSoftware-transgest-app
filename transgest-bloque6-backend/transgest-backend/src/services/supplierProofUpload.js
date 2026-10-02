const path = require('node:path');
const { validateBase64Upload } = require('./uploadValidation');

const ALLOWED_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MIME_BY_EXTENSION = { '.pdf':'application/pdf', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' };
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function prepareSupplierProofs(documents) {
  if (!Array.isArray(documents) || !documents.length || documents.length > 8) {
    throw Object.assign(new Error('Selecciona entre 1 y 8 albaranes firmados.'), { status:400 });
  }
  let totalBytes = 0;
  return documents.map(document => {
    const name = String(document?.nombre || '').trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160);
    if (!name) throw Object.assign(new Error('Cada albarán debe tener un nombre de archivo.'), { status:400 });
    const declared = String(document?.file_mime || '').toLowerCase().trim();
    const mime = !declared || declared === 'application/octet-stream' ? MIME_BY_EXTENSION[path.extname(name).toLowerCase()] : declared;
    const validated = validateBase64Upload({ data:document?.file_base64, mime, filename:name,
      maxBytes:MAX_FILE_BYTES, allowedMimes:ALLOWED_MIMES });
    totalBytes += validated.sizeBytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw Object.assign(new Error('Los albaranes superan 8 MB en total. Envíalos en varios lotes.'), { status:400 });
    }
    return { name, mime:validated.mime, base64:validated.base64,
      sizeKb:Math.max(1, Math.ceil(validated.sizeBytes / 1024)) };
  });
}

module.exports = { prepareSupplierProofs, MAX_FILE_BYTES, MAX_TOTAL_BYTES };
