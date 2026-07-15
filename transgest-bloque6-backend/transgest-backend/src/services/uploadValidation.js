const path = require("path");

const DOCUMENT_MIMES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".txt", ".doc", ".docx", ".xls", ".xlsx"]);

function splitDataUrl(value) {
  const raw = String(value || "").trim();
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(raw);
  return match
    ? { mime: match[1].toLowerCase(), base64: match[2].replace(/\s/g, "") }
    : { mime: "", base64: raw.replace(/\s/g, "") };
}

// Verificacion de firma de contenido (magic bytes) contra el tipo declarado
// (ASVS V12.3): impide subir un fichero malicioso (ejecutable, HTML con script)
// disfrazado con un MIME/extension permitidos.
function contentMatchesMime(bytes, mime) {
  if (!bytes || bytes.length < 4) return false;
  const b = bytes;
  const at = (offset, sig) => sig.every((v, i) => b[offset + i] === v);
  switch (mime) {
    case "application/pdf":
      return at(0, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case "image/jpeg":
      return at(0, [0xFF, 0xD8, 0xFF]);
    case "image/png":
      return at(0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    case "image/webp":
      return b.length >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]); // RIFF....WEBP
    case "application/msword":
    case "application/vnd.ms-excel":
      return at(0, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]); // OLE2 (doc/xls antiguos)
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return at(0, [0x50, 0x4B, 0x03, 0x04]) || at(0, [0x50, 0x4B, 0x05, 0x06]) || at(0, [0x50, 0x4B, 0x07, 0x08]); // ZIP (PK) -> OOXML
    case "text/plain":
      return true; // el texto plano no tiene firma fiable
    default:
      return false;
  }
}

function validateBase64Upload({ data, mime, filename, maxBytes = 3 * 1024 * 1024, allowedMimes = DOCUMENT_MIMES }) {
  const parsed = splitDataUrl(data);
  const effectiveMime = String(mime || parsed.mime || "application/octet-stream").trim().toLowerCase();
  if (!parsed.base64 || !/^[a-z0-9+/]+={0,2}$/i.test(parsed.base64)) {
    throw Object.assign(new Error("El archivo no contiene base64 valido."), { status: 400 });
  }
  if (!allowedMimes.has(effectiveMime)) {
    throw Object.assign(new Error("Tipo de archivo no permitido."), { status: 400 });
  }
  const extension = path.extname(String(filename || "")).toLowerCase();
  if (extension && !DOCUMENT_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error("Extension de archivo no permitida."), { status: 400 });
  }
  const bytes = Buffer.from(parsed.base64, "base64");
  if (!bytes.length || bytes.length > maxBytes) {
    throw Object.assign(new Error(`Archivo demasiado grande (max ${Math.floor(maxBytes / 1024 / 1024)}MB).`), { status: 400 });
  }
  if (!contentMatchesMime(bytes, effectiveMime)) {
    throw Object.assign(new Error("El contenido del archivo no coincide con el tipo declarado."), { status: 400 });
  }
  return { base64: parsed.base64, mime: effectiveMime, sizeBytes: bytes.length };
}

module.exports = { DOCUMENT_MIMES, IMAGE_MIMES, validateBase64Upload, contentMatchesMime };
