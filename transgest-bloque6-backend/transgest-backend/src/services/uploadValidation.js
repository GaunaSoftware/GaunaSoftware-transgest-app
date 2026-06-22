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
  return { base64: parsed.base64, mime: effectiveMime, sizeBytes: bytes.length };
}

module.exports = { DOCUMENT_MIMES, IMAGE_MIMES, validateBase64Upload };
