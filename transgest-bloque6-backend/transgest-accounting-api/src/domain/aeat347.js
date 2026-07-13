// Generador del fichero oficial del Modelo 347 (diseño de registro AEAT).
// Registros de tipo 1 (declarante) y tipo 2 (declarado), 500 posiciones cada
// uno, según el diseño publicado por la AEAT. Validar en la Sede antes de
// presentar. Las posiciones son 1-indexadas e inclusivas.

function asciiUpper(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .,'/-]/g, " ");
}

function makeRecord() {
  return new Array(500).fill(" ");
}

function putText(buf, from, to, value) {
  const len = to - from + 1;
  const s = asciiUpper(value).slice(0, len);
  for (let i = 0; i < len; i++) buf[from - 1 + i] = s[i] || " ";
}

function putNumRight(buf, from, to, value, pad = "0") {
  const len = to - from + 1;
  let s = String(value ?? "").replace(/[^0-9]/g, "").slice(-len);
  s = s.padStart(len, pad);
  for (let i = 0; i < len; i++) buf[from - 1 + i] = s[i];
}

function putConst(buf, from, to, value) {
  const len = to - from + 1;
  const s = String(value).slice(0, len).padEnd(len, " ");
  for (let i = 0; i < len; i++) buf[from - 1 + i] = s[i];
}

// Importe: 15 posiciones (13 enteros + 2 decimales), sin coma, ceros a la
// izquierda. El signo va en la posición anterior ("N" negativo, espacio +).
function putAmount(buf, signPos, from, to, cents) {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  buf[signPos - 1] = negative ? "N" : " ";
  putNumRight(buf, from, to, String(abs));
}

// Convierte un importe decimal en texto ("12345.670000") a céntimos enteros.
function decimalToCents(value) {
  const [whole, fraction = ""] = String(value ?? "0").replace("-", "").split(".");
  const negative = String(value ?? "").trim().startsWith("-");
  const cents = (Number(whole || "0") * 100) + Number((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function nif(value) {
  return asciiUpper(value).replace(/[^A-Z0-9]/g, "").slice(0, 9);
}

function buildDeclarante(buf, { ejercicio, nifDeclarante, nombre, telefono, contacto, idDeclaracion, numDeclarados, totalCents }) {
  putConst(buf, 1, 1, "1");
  putConst(buf, 2, 4, "347");
  putNumRight(buf, 5, 8, ejercicio);
  putText(buf, 9, 17, nif(nifDeclarante));
  putText(buf, 18, 57, nombre);
  putConst(buf, 58, 58, "T");
  putNumRight(buf, 59, 67, telefono || "");
  putText(buf, 68, 107, contacto || nombre);
  putNumRight(buf, 108, 120, idDeclaracion);
  // 121-122 complementaria/sustitutiva: espacios (declaración normal)
  putNumRight(buf, 123, 135, "0");             // nº identificativo declaración anterior
  putNumRight(buf, 136, 144, String(numDeclarados));
  putAmount(buf, 145, 146, 160, totalCents);   // importe total anual
  putNumRight(buf, 161, 169, "0");             // nº total inmuebles
  putAmount(buf, 170, 171, 185, 0);            // importe total inmuebles
  return buf.join("");
}

function buildDeclarado(buf, { ejercicio, nifDeclarante, record }) {
  putConst(buf, 1, 1, "2");
  putConst(buf, 2, 4, "347");
  putNumRight(buf, 5, 8, ejercicio);
  putText(buf, 9, 17, nif(nifDeclarante));
  putText(buf, 18, 26, nif(record.nif));
  // 27-35 NIF representante legal: espacios
  putText(buf, 36, 75, record.nombre);
  putConst(buf, 76, 76, "D");
  putNumRight(buf, 77, 78, record.provincia || "");   // código provincia (2)
  // 79-80 código país: espacios (residentes)
  // 81 blanco
  putConst(buf, 82, 82, record.clave);                // A/B
  putAmount(buf, 83, 84, 98, record.totalCents);      // importe anual
  // 99 operación seguro, 100 arrendamiento: espacios
  putNumRight(buf, 101, 115, "0");                    // importe metálico
  putAmount(buf, 116, 117, 131, 0);                   // transmisiones inmuebles
  // 132-135 ejercicio metálico: espacios
  const q = record.quartersCents || [0, 0, 0, 0];
  putAmount(buf, 136, 137, 151, q[0] || 0);           // 1T operaciones
  putAmount(buf, 152, 153, 167, 0);                   // 1T inmuebles
  putAmount(buf, 168, 169, 183, q[1] || 0);           // 2T operaciones
  putAmount(buf, 184, 185, 199, 0);                   // 2T inmuebles
  putAmount(buf, 200, 201, 215, q[2] || 0);           // 3T operaciones
  putAmount(buf, 216, 217, 231, 0);                   // 3T inmuebles
  putAmount(buf, 232, 233, 247, q[3] || 0);           // 4T operaciones
  putAmount(buf, 248, 249, 263, 0);                   // 4T inmuebles
  return buf.join("");
}

// records: [{ nif, nombre, provincia, clave: "A"|"B", totalCents, quartersCents:[q1..q4] }]
function buildModel347File({ ejercicio, declarante, records = [] }) {
  const valid = records.filter(r => r.nif && r.totalCents > 300506); // umbral 3.005,06 €
  if (!valid.length) {
    const error = new Error("No hay declarados con NIF que superen 3.005,06 € para el fichero del modelo 347");
    error.status = 422;
    throw error;
  }
  const totalCents = valid.reduce((sum, r) => sum + r.totalCents, 0);
  const idDeclaracion = `347${String(Date.now()).slice(-10)}`;

  const lines = [];
  lines.push(buildDeclarante(makeRecord(), {
    ejercicio,
    nifDeclarante: declarante.nif,
    nombre: declarante.nombre,
    telefono: declarante.telefono,
    contacto: declarante.contacto,
    idDeclaracion,
    numDeclarados: valid.length,
    totalCents,
  }));
  for (const record of valid) {
    lines.push(buildDeclarado(makeRecord(), { ejercicio, nifDeclarante: declarante.nif, record }));
  }
  return { content: lines.join("\r\n") + "\r\n", numDeclarados: valid.length, idDeclaracion };
}

module.exports = { buildModel347File, decimalToCents };
