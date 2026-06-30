const { cacheMiddleware, invalidateCache } = require("../services/cache");
// ══════════════════════════════════════════════════
// src/routes/rutas.js
// ══════════════════════════════════════════════════
const express = require("express");
const db      = require("../services/db");
const zlib    = require("zlib");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const router  = express.Router();
router.use(authenticate);

const TIPOS_VEHICULO_RUTA = new Set(["cualquiera", "tautliner", "banera", "frigorifico", "cisterna", "portacoches", "lowboy", "caja", "adr"]);
const TARIFA_TIPOS = new Set(["viaje", "kg", "tonelada", "km", "hora", "palet"]);

function numericOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  let raw = String(value)
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/[€$£]/g, "")
    .replace(/%$/g, "")
    .replace(/\s+/g, "");
  raw = raw.replace(/[^0-9,.\-]/g, "");
  if (!raw || raw === "-" || raw === "," || raw === ".") return null;
  if (raw.includes(",") && raw.includes(".")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (raw.includes(",")) raw = raw.replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeTarifaTipo(value, fallback = "viaje") {
  const raw = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const compact = raw.replace(/\s+/g, "").replace(/€/g, "eur");
  if (!compact) return fallback;
  if (["tn", "ton", "tm", "tonelada", "toneladas", "eurtn", "eur/t", "eur/tn", "precioportonelada"].includes(compact)) return "tonelada";
  if (["kg", "eurkg", "eur/kg", "100kg", "eur/100kg"].includes(compact)) return "kg";
  if (["km", "eurkm", "eur/km", "kilometro", "kilometros"].includes(compact)) return "km";
  if (["h", "hr", "hora", "horas", "eur/h", "eurhora"].includes(compact)) return "hora";
  if (["palet", "pallet", "palets", "pallets"].includes(compact)) return "palet";
  if (["viaje", "fijo", "porte", "preciofijo", "viaje/kg/km"].includes(compact)) return "viaje";
  return TARIFA_TIPOS.has(raw) ? raw : fallback;
}

function normalizeImportKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function splitImportLine(line) {
  const text = String(line || "");
  const delimiter = text.includes(";") ? ";" : text.includes("\t") ? "\t" : ",";
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === delimiter && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function normalizeTipoVehiculoRuta(value) {
  const tipo = String(value || "cualquiera").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (TIPOS_VEHICULO_RUTA.has(tipo)) return tipo;
  if (tipo.includes("ba") || tipo.includes("volquete")) return "banera";
  if (tipo.includes("taut") || tipo.includes("lona") || tipo.includes("curtain")) return "tautliner";
  if (tipo.includes("frigo")) return "frigorifico";
  if (tipo.includes("cisterna")) return "cisterna";
  if (tipo.includes("caja")) return "caja";
  if (tipo.includes("adr")) return "adr";
  return "cualquiera";
}

function importIndex(headers, candidates) {
  return headers.findIndex(h => candidates.some(c => h === c || h.includes(c)));
}

function normalizeMinimumsByTarifa(tarifaTipo, minimoFacturable, minimoUnidades) {
  const tipo = normalizeTarifaTipo(tarifaTipo);
  const facturable = numericOrNull(minimoFacturable);
  let unidades = numericOrNull(minimoUnidades);

  if (tipo === "viaje") {
    return { tarifaTipo: tipo, minimoFacturable: facturable, minimoUnidades: null };
  }

  if (unidades === null) unidades = facturable;
  if (tipo === "tonelada" && unidades !== null && Math.abs(unidades) >= 1000) {
    unidades = Number((unidades / 1000).toFixed(3));
  }

  return { tarifaTipo: tipo, minimoFacturable: null, minimoUnidades: unidades };
}

async function assertRutaEmpresa(rutaId, empresaId) {
  const { rows } = await db.query(
    "SELECT id FROM rutas WHERE id=$1 AND activa=true AND (empresa_id=$2 OR empresa_id IS NULL)",
    [rutaId, empresaId]
  );
  return rows[0] || null;
}

async function assertClienteEmpresa(clienteId, empresaId) {
  if (!clienteId) return null;
  const { rows } = await db.query(
    "SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 AND activo=true",
    [clienteId, empresaId]
  );
  return rows[0] || null;
}

let rutasSchemaReady = null;

function ensureRutasSchema() {
  if (!rutasSchemaReady) {
    rutasSchemaReady = (async () => {
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS activa BOOLEAN DEFAULT true");
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tipo_vehiculo VARCHAR(50) DEFAULT 'cualquiera'");
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS pct_subida NUMERIC DEFAULT 0");
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL");
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tarifa_tipo VARCHAR(30) DEFAULT 'viaje'");
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS precio_base NUMERIC DEFAULT 0");
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS minimo_facturable NUMERIC");
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS minimo_unidades NUMERIC");
      await db.query("ALTER TABLE rutas ADD COLUMN IF NOT EXISTS recargo_combustible_pct NUMERIC DEFAULT 0");
      await db.query("UPDATE rutas SET activa=true WHERE activa IS NULL");
      await db.query(`
        CREATE TABLE IF NOT EXISTS ruta_precios_cliente (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          ruta_id UUID NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
          cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          precio NUMERIC DEFAULT 0,
          tarifa_tipo VARCHAR(30),
          minimo_facturable NUMERIC,
          minimo_unidades NUMERIC,
          recargo_combustible_pct NUMERIC DEFAULT 0,
          iva_pct NUMERIC DEFAULT 21,
          notas TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (ruta_id, cliente_id)
        )
      `);
      await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS tarifa_tipo VARCHAR(30)");
      await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS minimo_facturable NUMERIC");
      await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS minimo_unidades NUMERIC");
      await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS recargo_combustible_pct NUMERIC DEFAULT 0");
      await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS iva_pct NUMERIC DEFAULT 21");
      await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS notas TEXT");
      await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS minimo_facturable_toneladas NUMERIC");
    })().catch((err) => {
      rutasSchemaReady = null;
      throw err;
    });
  }
  return rutasSchemaReady;
}

router.use(async (req, res, next) => {
  try {
    await ensureRutasSchema();
    next();
  } catch (e) {
    next(e);
  }
});

router.get("/", cacheMiddleware(300), async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { rows } = await db.query(`
    SELECT r.*,
           COALESCE(r.cliente_id, rpc.cliente_id) AS cliente_id,
           c.nombre AS cliente_nombre,
           c.minimo_facturable_toneladas AS cliente_minimo_facturable_toneladas,
           COALESCE(rpc.precio, r.precio_base, 0) AS precio_base,
           COALESCE(rpc.tarifa_tipo, r.tarifa_tipo, 'viaje') AS tarifa_tipo,
           COALESCE(rpc.minimo_facturable, r.minimo_facturable) AS minimo_facturable,
           COALESCE(rpc.minimo_unidades, r.minimo_unidades) AS minimo_unidades,
           COALESCE(rpc.recargo_combustible_pct, r.recargo_combustible_pct, 0) AS recargo_combustible_pct
    FROM rutas r
    LEFT JOIN ruta_precios_cliente rpc ON rpc.ruta_id = r.id
    LEFT JOIN clientes c ON c.id = COALESCE(r.cliente_id, rpc.cliente_id)
    WHERE r.activa=true AND (r.empresa_id=$1 OR r.empresa_id IS NULL)
    ORDER BY c.nombre NULLS LAST, r.origen, r.destino
  `, [empresaId]);
  res.json(rows);
});

router.get("/:id/precios", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const ruta = await db.query(
    "SELECT * FROM rutas WHERE id=$1 AND activa=true AND (empresa_id=$2 OR empresa_id IS NULL)",
    [req.params.id, empresaId]
  );
  if (!ruta.rows[0]) return res.status(404).json({ error: "Ruta no encontrada" });

  const [precios, repartos] = await Promise.all([
    db.query(`SELECT rpc.*, c.nombre AS cliente_nombre FROM ruta_precios_cliente rpc
              JOIN clientes c ON c.id=rpc.cliente_id AND c.empresa_id=$2
              WHERE rpc.ruta_id=$1`, [req.params.id, empresaId]),
    db.query(`SELECT rr.*, c.nombre AS cliente_nombre FROM ruta_repartos rr
              LEFT JOIN clientes c ON c.id=rr.cliente_id AND c.empresa_id=$2
              WHERE rr.ruta_id=$1 ORDER BY rr.orden`, [req.params.id, empresaId]),
  ]);
  res.json({ ...ruta.rows[0], precios: precios.rows, repartos: repartos.rows });
});

router.put("/:id/precios", GERENTE_O_TRAFICO, invalidateCache("rutas", "clientes"), async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const precios = Array.isArray(req.body?.precios) ? req.body.precios : [];
    const { rows: rutaRows } = await db.query(
      "SELECT id, tarifa_tipo FROM rutas WHERE id=$1 AND (empresa_id=$2 OR empresa_id IS NULL)",
      [req.params.id, empresaId]
    );
    if (!rutaRows[0]) return res.status(404).json({ error: "Ruta no encontrada" });

    await db.transaction(async (client) => {
      const keepClienteIds = [];
      for (const item of precios) {
        const clienteId = item.cliente_id || item.clienteId || null;
        const precioRaw = item.precio ?? item.precio_base ?? item.importe;
        if (!clienteId || precioRaw === "" || precioRaw === null || precioRaw === undefined) continue;
        const precio = Number(precioRaw);
        if (!Number.isFinite(precio)) continue;
        const clienteOk = await client.query(
          "SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 AND activo=true",
          [clienteId, empresaId]
        );
        if (!clienteOk.rows[0]) continue;
        keepClienteIds.push(clienteId);
        const minima = normalizeMinimumsByTarifa(
          item.tarifa_tipo || item.tipo_precio || item.tipo || rutaRows[0].tarifa_tipo,
          item.minimo_facturable,
          item.minimo_unidades
        );
        const recargoCombustiblePct = numericOrNull(item.recargo_combustible_pct) || 0;
        await client.query(`
          INSERT INTO ruta_precios_cliente (ruta_id, cliente_id, precio, tarifa_tipo, minimo_facturable, minimo_unidades, recargo_combustible_pct)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (ruta_id, cliente_id)
          DO UPDATE SET
            precio=EXCLUDED.precio,
            tarifa_tipo=EXCLUDED.tarifa_tipo,
            minimo_facturable=EXCLUDED.minimo_facturable,
            minimo_unidades=EXCLUDED.minimo_unidades,
            recargo_combustible_pct=EXCLUDED.recargo_combustible_pct
        `, [req.params.id, clienteId, precio, minima.tarifaTipo, minima.minimoFacturable, minima.minimoUnidades, recargoCombustiblePct]);
      }
      if (keepClienteIds.length) {
        await client.query(
          "DELETE FROM ruta_precios_cliente WHERE ruta_id=$1 AND NOT (cliente_id = ANY($2::uuid[]))",
          [req.params.id, keepClienteIds]
        );
      } else {
        await client.query("DELETE FROM ruta_precios_cliente WHERE ruta_id=$1", [req.params.id]);
      }
    });

    const { rows } = await db.query(`
      SELECT rpc.*, c.nombre AS cliente_nombre
      FROM ruta_precios_cliente rpc
      JOIN clientes c ON c.id=rpc.cliente_id
      WHERE rpc.ruta_id=$1
      ORDER BY c.nombre
    `, [req.params.id]);
    res.json({ ok: true, precios: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", GERENTE_O_TRAFICO, invalidateCache("rutas", "clientes"), async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const {
    origen, destino, km, peajes, tiempo_h, notas, tipo_vehiculo, pct_subida, cliente_id,
    tarifa_tipo, precio_base, minimo_facturable, minimo_unidades, recargo_combustible_pct
  } = req.body;
  // Always store in uppercase to avoid duplicates
  const origenUp  = (origen||"").trim().toUpperCase();
  const destinoUp = (destino||"").trim().toUpperCase();
  if (!origenUp || !destinoUp) return res.status(400).json({ error: "Origen y destino son obligatorios" });
  const tipoVehiculo = tipo_vehiculo || "cualquiera";
  const clienteId = cliente_id || null;
  // Una misma ruta puede tener tarifa distinta por cliente o tipo de vehiculo.
  const exists = await db.query(
    `SELECT id FROM rutas
      WHERE UPPER(origen)=$1
        AND UPPER(destino)=$2
        AND COALESCE(cliente_id::text,'')=COALESCE($3::uuid::text,'')
        AND COALESCE(tipo_vehiculo,'cualquiera')=$4
        AND activa=true
        AND (empresa_id=$5 OR empresa_id IS NULL)
      LIMIT 1`,
    [origenUp, destinoUp, clienteId, tipoVehiculo, empresaId]
  );
  const minima = normalizeMinimumsByTarifa(tarifa_tipo, minimo_facturable, minimo_unidades);
  if (exists.rows[0]) {
    const { rows: updatedRows } = await db.query(
      `UPDATE rutas
          SET km=COALESCE($1, km),
              peajes=COALESCE($2, peajes),
              tiempo_h=COALESCE($3, tiempo_h),
              notas=COALESCE($4, notas),
              pct_subida=COALESCE($5, pct_subida),
              tarifa_tipo=$6,
              precio_base=COALESCE($7, precio_base),
              minimo_facturable=$8,
              minimo_unidades=$9,
              recargo_combustible_pct=COALESCE($10, recargo_combustible_pct),
              empresa_id=COALESCE(empresa_id,$11)
        WHERE id=$12 AND (empresa_id=$11 OR empresa_id IS NULL)
        RETURNING *`,
      [
        numericOrNull(km), numericOrNull(peajes), numericOrNull(tiempo_h), notas || null,
        numericOrNull(pct_subida), minima.tarifaTipo, numericOrNull(precio_base),
        minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct),
        empresaId, exists.rows[0].id,
      ]
    );
    if (clienteId && updatedRows[0]) {
      await db.query(
        `INSERT INTO ruta_precios_cliente (ruta_id,cliente_id,precio,tarifa_tipo,minimo_facturable,minimo_unidades,recargo_combustible_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (ruta_id,cliente_id) DO UPDATE SET
           precio=EXCLUDED.precio,
           tarifa_tipo=EXCLUDED.tarifa_tipo,
           minimo_facturable=EXCLUDED.minimo_facturable,
           minimo_unidades=EXCLUDED.minimo_unidades,
           recargo_combustible_pct=EXCLUDED.recargo_combustible_pct`,
        [updatedRows[0].id, clienteId, numericOrNull(precio_base) || 0, minima.tarifaTipo, minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct) || 0]
      ).catch(() => {});
    }
    return res.status(200).json({ ...(updatedRows[0] || exists.rows[0]), reutilizada: true });
  }
  const { rows } = await db.query(
    "INSERT INTO rutas (origen,destino,km,peajes,tiempo_h,notas,tipo_vehiculo,pct_subida,cliente_id,tarifa_tipo,precio_base,minimo_facturable,minimo_unidades,recargo_combustible_pct,empresa_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
    [origenUp, destinoUp, km||null, peajes||0, tiempo_h||null, notas||null,
     tipoVehiculo, pct_subida||0, clienteId,
     minima.tarifaTipo, numericOrNull(precio_base)||0, minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct)||0, empresaId]
  );
  if (clienteId) {
    await db.query(
      `INSERT INTO ruta_precios_cliente (ruta_id,cliente_id,precio,tarifa_tipo,minimo_facturable,minimo_unidades,recargo_combustible_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (ruta_id,cliente_id) DO UPDATE SET
         precio=EXCLUDED.precio,
         tarifa_tipo=EXCLUDED.tarifa_tipo,
         minimo_facturable=EXCLUDED.minimo_facturable,
         minimo_unidades=EXCLUDED.minimo_unidades,
         recargo_combustible_pct=EXCLUDED.recargo_combustible_pct`,
      [rows[0].id, clienteId, numericOrNull(precio_base) || 0, minima.tarifaTipo, minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct) || 0]
    ).catch(() => {});
  }
  res.status(201).json(rows[0]);
});

function xmlDecode(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function unzipEntries(buffer) {
  const entries = new Map();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return entries;
  const total = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < total && ptr < buffer.length; i++) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const uncompressedSize = buffer.readUInt32LE(ptr + 24);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.slice(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const payload = buffer.slice(dataStart, dataStart + compressedSize);
      try {
        const content = method === 0 ? payload : method === 8 ? zlib.inflateRawSync(payload) : Buffer.alloc(0);
        if (content.length || uncompressedSize === 0) entries.set(name, content);
      } catch {}
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function xlsxBufferToText(buffer) {
  const entries = unzipEntries(buffer);
  if (!entries.size) return "";
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8") || "";
  const shared = Array.from(sharedXml.matchAll(/<si\b[\s\S]*?<\/si>/g)).map(m => {
    const texts = Array.from(m[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(x => xmlDecode(x[1]));
    return texts.join("");
  });
  const sheetNames = Array.from(entries.keys()).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k)).sort();
  const lines = [];
  for (const name of sheetNames) {
    const xml = entries.get(name).toString("utf8");
    for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
      const cells = [];
      for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1] || "";
        const body = cellMatch[2] || "";
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] || "";
        const colIndex = ref ? ref.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
        const type = /t="([^"]+)"/.exec(attrs)?.[1] || "";
        let value = "";
        if (type === "s") {
          const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]);
          value = shared[idx] || "";
        } else if (type === "inlineStr") {
          value = Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(x => xmlDecode(x[1])).join("");
        } else {
          value = xmlDecode(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] || "");
        }
        cells[colIndex] = String(value || "").trim();
      }
      if (cells.some(Boolean)) lines.push(cells.map(v => v || "").join(";"));
    }
  }
  return lines.join("\n");
}

function decodeImportText({ file_base64, texto }) {
  if (texto) return String(texto);
  const raw = String(file_base64 || "").includes(",") ? String(file_base64).split(",").pop() : String(file_base64 || "");
  if (!raw) return "";
  const buffer = Buffer.from(raw, "base64");
  if (buffer.slice(0, 2).toString("utf8") === "PK") return xlsxBufferToText(buffer);
  const asText = buffer.toString("utf8");
  // Best-effort para PDF simple: muchos PDFs contienen cadenas legibles entre parentesis.
  if (asText.includes("%PDF")) {
    return Array.from(asText.matchAll(/\(([^()]{3,160})\)/g)).map(m => m[1]).join("\n");
  }
  return asText.replace(/\u0000/g, "");
}

function parseImportRows(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  if (!lines.length) return rows;
  const firstParts = splitImportLine(lines[0]);
  const headers = firstParts.map(normalizeImportKey);
  const hasHeader = headers.some(h => h.includes("origen")) && headers.some(h => h.includes("destino"));
  const idx = hasHeader ? {
    origen: importIndex(headers, ["origen", "carga", "desde"]),
    destino: importIndex(headers, ["destino", "descarga", "hasta"]),
    precio: importIndex(headers, ["precio", "importe", "base", "eur"]),
    km: importIndex(headers, ["km", "kms", "kilometros", "kilometraje"]),
    tipoVehiculo: importIndex(headers, ["tipo_vehiculo", "vehiculo", "remolque", "conjunto"]),
    tarifaTipo: importIndex(headers, ["tarifa_tipo", "tipo_precio", "tipo_viaje_kg_km", "tipo"]),
    minimo: importIndex(headers, ["minimo_facturable", "minimo", "minimo_toneladas"]),
    recargo: importIndex(headers, ["recargo_combustible", "combustible", "recargo"]),
  } : null;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  for (const line of dataLines) {
    const parts = splitImportLine(line);
    if (parts.length < 3) continue;
    const pick = key => {
      const n = idx?.[key];
      return n >= 0 ? String(parts[n] || "").trim() : "";
    };
    const [origen, destino, precio, km, tipoVehiculo, tarifaTipo, minimo, recargo] = hasHeader
      ? [pick("origen"), pick("destino"), pick("precio"), pick("km"), pick("tipoVehiculo"), pick("tarifaTipo"), pick("minimo"), pick("recargo")]
      : parts.map(p => String(p || "").trim());
    if (!origen || !destino) continue;
    const tarifaTipoNormalizada = normalizeTarifaTipo(tarifaTipo);
    const minima = normalizeMinimumsByTarifa(tarifaTipoNormalizada, minimo, null);
    rows.push({
      origen: origen.toUpperCase(),
      destino: destino.toUpperCase(),
      precio_base: numericOrNull(precio) || 0,
      km: numericOrNull(km),
      tipo_vehiculo: normalizeTipoVehiculoRuta(tipoVehiculo),
      tarifa_tipo: minima.tarifaTipo,
      minimo_facturable: minima.minimoFacturable,
      minimo_unidades: minima.minimoUnidades,
      recargo_combustible_pct: numericOrNull(recargo) || 0,
    });
  }
  return rows;
}

router.post("/importar", GERENTE_O_TRAFICO, invalidateCache("rutas", "clientes"), async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const clienteId = req.body?.cliente_id || null;
    if (!clienteId) return res.status(400).json({ error: "Selecciona un cliente para importar rutas" });
    if (!(await assertClienteEmpresa(clienteId, empresaId))) return res.status(404).json({ error: "Cliente no encontrado" });
    const text = decodeImportText(req.body || {});
    const parsed = parseImportRows(text);
    if (!parsed.length) {
      return res.status(400).json({ error: "No se detectaron rutas. En Excel/CSV usa cabeceras como Origen, Destino, Precio, Tipo, Km, Minimo o el formato origen;destino;precio;km;tipo_vehiculo;tarifa_tipo;minimo;recargo. Si es PDF, debe tener texto seleccionable." });
    }
    if (req.body?.dry_run === true) {
      return res.json({ ok: true, dry_run: true, total: parsed.length, rutas: parsed.slice(0, 50) });
    }
    let creadas = 0;
    let actualizadas = 0;
    const detalles = [];
    for (const r of parsed.slice(0, 500)) {
      const existing = await db.query(
        `SELECT id FROM rutas
          WHERE UPPER(TRIM(origen))=UPPER(TRIM($1))
            AND UPPER(TRIM(destino))=UPPER(TRIM($2))
            AND COALESCE(cliente_id::text,'')=$3
            AND COALESCE(tipo_vehiculo,'cualquiera')=$4
            AND activa=true
            AND (empresa_id=$5 OR empresa_id IS NULL)
          LIMIT 1`,
        [r.origen, r.destino, clienteId, r.tipo_vehiculo, empresaId]
      );
      let rutaId = existing.rows[0]?.id;
      if (rutaId) {
        actualizadas += 1;
        await db.query(
          `UPDATE rutas SET km=$1, tipo_vehiculo=$2, tarifa_tipo=$3, precio_base=$4, minimo_facturable=$5, minimo_unidades=$6, recargo_combustible_pct=$7, empresa_id=$8, cliente_id=$9
            WHERE id=$10`,
          [r.km, r.tipo_vehiculo, r.tarifa_tipo, r.precio_base, r.minimo_facturable, r.minimo_unidades, r.recargo_combustible_pct, empresaId, clienteId, rutaId]
        );
      } else {
        const inserted = await db.query(
          `INSERT INTO rutas (origen,destino,km,empresa_id,cliente_id,tipo_vehiculo,tarifa_tipo,precio_base,minimo_facturable,minimo_unidades,recargo_combustible_pct)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [r.origen, r.destino, r.km, empresaId, clienteId, r.tipo_vehiculo, r.tarifa_tipo, r.precio_base, r.minimo_facturable, r.minimo_unidades, r.recargo_combustible_pct]
        );
        rutaId = inserted.rows[0].id;
        creadas += 1;
      }
      await db.query(
        `INSERT INTO ruta_precios_cliente (ruta_id,cliente_id,precio,tarifa_tipo,minimo_facturable,minimo_unidades,recargo_combustible_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (ruta_id,cliente_id) DO UPDATE SET precio=EXCLUDED.precio, tarifa_tipo=EXCLUDED.tarifa_tipo, minimo_facturable=EXCLUDED.minimo_facturable, minimo_unidades=EXCLUDED.minimo_unidades, recargo_combustible_pct=EXCLUDED.recargo_combustible_pct`,
        [rutaId, clienteId, r.precio_base, r.tarifa_tipo, r.minimo_facturable, r.minimo_unidades, r.recargo_combustible_pct]
      );
      detalles.push({ ...r, ruta_id: rutaId });
    }
    res.json({ ok: true, creadas, actualizadas, total: detalles.length, rutas: detalles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", GERENTE_O_TRAFICO, invalidateCache("rutas"), async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const {
    origen, destino, km, peajes, tiempo_h, activa, notas, tipo_vehiculo, pct_subida, cliente_id,
    tarifa_tipo, precio_base, minimo_facturable, minimo_unidades, recargo_combustible_pct
  } = req.body;
  const minima = normalizeMinimumsByTarifa(tarifa_tipo, minimo_facturable, minimo_unidades);
  const { rows } = await db.query(
    "UPDATE rutas SET origen=$1,destino=$2,km=$3,peajes=$4,tiempo_h=$5,activa=$6,notas=$7,tipo_vehiculo=$8,pct_subida=$9,cliente_id=$10,tarifa_tipo=$11,precio_base=$12,minimo_facturable=$13,minimo_unidades=$14,recargo_combustible_pct=$15,empresa_id=COALESCE(empresa_id,$16) WHERE id=$17 AND (empresa_id=$16 OR empresa_id IS NULL) RETURNING *",
    [
      (origen||"").trim().toUpperCase(),
      (destino||"").trim().toUpperCase(),
      numericOrNull(km),
      numericOrNull(peajes) || 0,
      numericOrNull(tiempo_h),
      activa!==undefined?activa:true,
      notas || null,
      tipo_vehiculo || "cualquiera",
      numericOrNull(pct_subida) || 0,
      cliente_id || null,
      minima.tarifaTipo,
      numericOrNull(precio_base) || 0,
      minima.minimoFacturable,
      minima.minimoUnidades,
      numericOrNull(recargo_combustible_pct) || 0,
      empresaId,
      req.params.id
    ]
  );
  if (!rows[0]) return res.status(404).json({ error:"Ruta no encontrada" });
  res.json(rows[0]);
});

router.delete("/:id", GERENTE_O_TRAFICO, invalidateCache("rutas", "clientes"), async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { rows } = await db.query(
    "UPDATE rutas SET activa=false, empresa_id=COALESCE(empresa_id,$1) WHERE id=$2 AND (empresa_id=$1 OR empresa_id IS NULL) RETURNING *",
    [empresaId, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error:"Ruta no encontrada" });
  res.json({ ok:true });
});

// Upsert precio por cliente
router.put("/:id/precio-cliente", GERENTE_O_TRAFICO, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { cliente_id, precio, tarifa_tipo, minimo_facturable, minimo_unidades, recargo_combustible_pct } = req.body;
  if (!(await assertRutaEmpresa(req.params.id, empresaId))) {
    return res.status(404).json({ error: "Ruta no encontrada" });
  }
  if (!(await assertClienteEmpresa(cliente_id, empresaId))) {
    return res.status(404).json({ error: "Cliente no encontrado" });
  }
  const minima = normalizeMinimumsByTarifa(tarifa_tipo, minimo_facturable, minimo_unidades);
  const { rows } = await db.query(`
    INSERT INTO ruta_precios_cliente (ruta_id,cliente_id,precio,tarifa_tipo,minimo_facturable,minimo_unidades,recargo_combustible_pct)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (ruta_id,cliente_id) DO UPDATE SET
      precio=EXCLUDED.precio,
      tarifa_tipo=EXCLUDED.tarifa_tipo,
      minimo_facturable=EXCLUDED.minimo_facturable,
      minimo_unidades=EXCLUDED.minimo_unidades,
      recargo_combustible_pct=EXCLUDED.recargo_combustible_pct
    RETURNING *`,
    [req.params.id, cliente_id, precio, minima.tarifaTipo, minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct) || 0]
  );
  res.json(rows[0]);
});

// Guardar repartos de una ruta
router.put("/:id/repartos", GERENTE_O_TRAFICO, async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { repartos } = req.body; // array de {cliente_id, lugar, precio, orden}
  if (!(await assertRutaEmpresa(req.params.id, empresaId))) {
    return res.status(404).json({ error: "Ruta no encontrada" });
  }
  await db.transaction(async (client) => {
    await client.query("DELETE FROM ruta_repartos WHERE ruta_id=$1", [req.params.id]);
    for (const [i, r] of repartos.entries()) {
      if (r.cliente_id && !(await assertClienteEmpresa(r.cliente_id, empresaId))) continue;
      await client.query(
        "INSERT INTO ruta_repartos (ruta_id,cliente_id,lugar,precio,orden) VALUES ($1,$2,$3,$4,$5)",
        [req.params.id, r.cliente_id||null, r.lugar, r.precio, i]
      );
    }
  });
  res.json({ ok: true });
});

module.exports = router;
