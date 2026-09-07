// ══════════════════════════════════════════════════════
// LIMPIEZA DE PUNTOS DE INTERES DUPLICADOS
// ══════════════════════════════════════════════════════
//
// Desactiva (activo=false, NO borra) los puntos_interes repetidos, dejando uno
// canonico por grupo. Un grupo = misma empresa + mismo cliente (o "general") +
// misma direccion normalizada. Usa EXACTAMENTE la misma normalizacion que el
// backend (foldPointKey), para no crear inconsistencias con el indice unico.
//
// SEGURO:
//   - Por defecto es DRY-RUN: solo informa, no toca nada.
//   - Con --apply escribe, dentro de una transaccion (todo o nada).
//   - Reversible: los duplicados quedan activo=false, no se borran. Para revertir
//     un punto: UPDATE puntos_interes SET activo=true WHERE id='...'.
//   - Los pedidos guardan el punto embebido en JSON (solo referencian punto_id de
//     forma blanda), asi que desactivar duplicados no rompe pedidos existentes.
//   - No mezcla puntos de cliente con puntos generales (grupos separados).
//
// USO (en Render Shell del backend, o local con DATABASE_URL):
//   node scripts/cleanup_duplicate_points.js            # dry-run (recomendado 1o)
//   node scripts/cleanup_duplicate_points.js --apply    # aplica de verdad

require("dotenv").config();
const db = require("../src/services/db");

const APPLY = process.argv.includes("--apply");
const GENERAL_BUCKET = "GENERAL";

// --- Misma normalizacion que src/routes/puntos_interes.js ---
function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}
function foldPointKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCoords(metadata) {
  const m = metadata && typeof metadata === "object" ? metadata : {};
  return Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng));
}

// Fecha segura para ordenar (ms). null -> 0.
function ts(v) {
  const t = v ? new Date(v).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

// Elige el punto canonico de un grupo: primero con coordenadas, luego el
// actualizado mas recientemente, y a igualdad el mas antiguo (id estable).
function pickCanonical(group) {
  return [...group].sort((a, b) => {
    const ca = hasCoords(a.metadata) ? 1 : 0;
    const cb = hasCoords(b.metadata) ? 1 : 0;
    if (ca !== cb) return cb - ca;
    const ua = ts(a.updated_at);
    const ub = ts(b.updated_at);
    if (ua !== ub) return ub - ua;
    const cra = ts(a.created_at);
    const crb = ts(b.created_at);
    if (cra !== crb) return cra - crb; // mas antiguo primero
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

async function main() {
  const dbHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL).host;
    } catch {
      return "(host desconocido)";
    }
  })();
  console.log(`\nBD: ${dbHost}`);
  console.log(APPLY ? ">>> MODO APLICAR (se escribiran cambios)\n" : ">>> DRY-RUN (no se escribe nada; usa --apply para aplicar)\n");

  const { rows } = await db.query(
    `SELECT id, empresa_id, cliente_id, nombre, direccion, direccion_key,
            metadata, created_at, updated_at
       FROM puntos_interes
      WHERE activo = true`
  );

  // Agrupar por empresa + cliente(o general) + clave normalizada.
  const groups = new Map();
  let sinClave = 0;
  for (const row of rows) {
    const key =
      (row.direccion_key && String(row.direccion_key).trim()) ||
      foldPointKey(row.direccion);
    if (!key) {
      sinClave += 1;
      continue; // direccion vacia/ambigua: no se toca
    }
    const bucket = row.cliente_id || GENERAL_BUCKET;
    const gk = `${row.empresa_id}|${bucket}|${key}`;
    if (!groups.has(gk)) groups.set(gk, { key, rows: [] });
    groups.get(gk).rows.push(row);
  }

  const toDeactivate = [];
  const backfill = []; // {id, key} para escribir direccion_key en los que se quedan
  let dupGroups = 0;
  const samples = [];

  for (const [, g] of groups) {
    // Backfill de clave en el/los que se quedan activos (evita re-duplicados).
    if (g.rows.length === 1) {
      const only = g.rows[0];
      if (!only.direccion_key || !String(only.direccion_key).trim()) {
        backfill.push({ id: only.id, key: g.key });
      }
      continue;
    }
    dupGroups += 1;
    const canonical = pickCanonical(g.rows);
    if (!canonical.direccion_key || !String(canonical.direccion_key).trim()) {
      backfill.push({ id: canonical.id, key: g.key });
    }
    for (const row of g.rows) {
      if (row.id !== canonical.id) toDeactivate.push(row.id);
    }
    if (samples.length < 15) {
      samples.push({
        cliente: canonical.cliente_id || GENERAL_BUCKET,
        direccion: canonical.direccion,
        conserva: `${canonical.id.slice(0, 8)} (${hasCoords(canonical.metadata) ? "con coords" : "sin coords"})`,
        desactiva: g.rows.filter((r) => r.id !== canonical.id).map((r) => r.id.slice(0, 8)),
      });
    }
  }

  console.log(`Puntos activos analizados : ${rows.length}`);
  console.log(`Sin clave (no se tocan)   : ${sinClave}`);
  console.log(`Grupos con duplicados     : ${dupGroups}`);
  console.log(`Puntos a desactivar       : ${toDeactivate.length}`);
  console.log(`Claves a rellenar (backfill): ${backfill.length}\n`);

  if (samples.length) {
    console.log("Ejemplos (hasta 15):");
    for (const s of samples) {
      console.log(
        `  [${s.cliente === GENERAL_BUCKET ? "general" : "cliente " + String(s.cliente).slice(0, 8)}] "${s.direccion}"`
      );
      console.log(`     conserva ${s.conserva} | desactiva ${s.desactiva.join(", ")}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("DRY-RUN: no se ha modificado nada. Revisa los numeros y vuelve a");
    console.log("ejecutar con --apply si estas conforme.\n");
    return;
  }

  if (toDeactivate.length === 0 && backfill.length === 0) {
    console.log("Nada que aplicar. Base ya limpia.\n");
    return;
  }

  await db.transaction(async (client) => {
    // 1) Desactivar duplicados (por lotes para no exceder parametros).
    const CHUNK = 500;
    for (let i = 0; i < toDeactivate.length; i += CHUNK) {
      const ids = toDeactivate.slice(i, i + CHUNK);
      await client.query(
        `UPDATE puntos_interes
            SET activo = false, updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [ids]
      );
    }
    // 2) Backfill de direccion_key en los que se quedan (ya son unicos por grupo).
    for (const b of backfill) {
      await client.query(
        `UPDATE puntos_interes
            SET direccion_key = $2
          WHERE id = $1
            AND (direccion_key IS NULL OR direccion_key = '')`,
        [b.id, b.key]
      );
    }
  });

  console.log(`APLICADO: ${toDeactivate.length} puntos desactivados, ${backfill.length} claves rellenadas.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Error en la limpieza:", e.message);
    process.exit(1);
  });
