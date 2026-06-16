function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[;"\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function buildCsv(headers, rows) {
  const lines = [
    headers.map(header => csvEscape(header.label)).join(";"),
    ...rows.map(row => headers.map(header => csvEscape(row[header.key])).join(";")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

module.exports = {
  buildCsv,
  csvEscape,
};
