const CP1252_BYTES = {
  0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85,
  0x2020:0x86, 0x2021:0x87, 0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A,
  0x2039:0x8B, 0x0152:0x8C, 0x017D:0x8E, 0x2018:0x91, 0x2019:0x92,
  0x201C:0x93, 0x201D:0x94, 0x2022:0x95, 0x2013:0x96, 0x2014:0x97,
  0x02DC:0x98, 0x2122:0x99, 0x0161:0x9A, 0x203A:0x9B, 0x0153:0x9C,
  0x017E:0x9E, 0x0178:0x9F,
};

const MOJIBAKE_RE = /[ÃÂâð�]/;

export function fixMojibakeText(value) {
  if (typeof value !== "string" || !value || !MOJIBAKE_RE.test(value) || typeof TextDecoder === "undefined") {
    return value;
  }
  try {
    const bytes = [];
    for (const ch of value) {
      const code = ch.charCodeAt(0);
      if (code <= 0xFF) bytes.push(code);
      else if (CP1252_BYTES[code] !== undefined) bytes.push(CP1252_BYTES[code]);
      else return value;
    }
    const fixed = new TextDecoder("utf-8", { fatal:true }).decode(new Uint8Array(bytes));
    return fixed && fixed !== value ? fixed : value;
  } catch {
    return value;
  }
}

export function fixMojibakePayload(value, seen = new WeakSet()) {
  if (typeof value === "string") return fixMojibakeText(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => fixMojibakePayload(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, fixMojibakePayload(item, seen)])
  );
}
