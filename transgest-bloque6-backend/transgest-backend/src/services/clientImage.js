const MAX_CLIENT_IMAGE_BYTES = 256 * 1024;

function normalizeClientImage(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const invalid = () => Object.assign(new Error("La foto debe ser PNG, JPG o WebP y ocupar como máximo 256 KB."), { status: 400 });
  if (typeof value !== "string" || value.length > MAX_CLIENT_IMAGE_BYTES * 4 / 3 + 64) throw invalid();
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw invalid();
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_CLIENT_IMAGE_BYTES || bytes.toString("base64") !== match[2]) throw invalid();
  const valid = match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw invalid();
  return value;
}

module.exports = { normalizeClientImage, MAX_CLIENT_IMAGE_BYTES };
