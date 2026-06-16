const { paginatedResponse } = require("../services/paginate");
const { cacheMiddleware, invalidateCache } = require("../services/cache");
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { body, validationResult } = require("express-validator");
const db      = require("../services/db");
const { authenticate, GERENTE_O_CONTABLE } = require("../middleware/auth");

const router = express.Router();

let integracionTokensSchemaReady = null;
function ensureIntegracionTokensSchema() {
  if (!integracionTokensSchemaReady) {
    integracionTokensSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS cliente_integracion_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        nombre VARCHAR(120) NOT NULL DEFAULT 'Integracion EDI/API',
        token_hash VARCHAR(80) NOT NULL UNIQUE,
        token_mask VARCHAR(80) NOT NULL,
        scopes JSONB NOT NULL DEFAULT '["manifest","feed"]'::jsonb,
        activo BOOLEAN NOT NULL DEFAULT true,
        expires_at TIMESTAMPTZ,
        created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        last_used_ip VARCHAR(80),
        usage_count INTEGER NOT NULL DEFAULT 0,
        window_started_at TIMESTAMPTZ,
        window_count INTEGER NOT NULL DEFAULT 0,
        rate_limit_per_hour INTEGER NOT NULL DEFAULT 120,
        last_rate_limit_at TIMESTAMPTZ
      )
    `).then(async () => {
      await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0").catch(() => {});
      await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS window_started_at TIMESTAMPTZ").catch(() => {});
      await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS window_count INTEGER NOT NULL DEFAULT 0").catch(() => {});
      await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER NOT NULL DEFAULT 120").catch(() => {});
      await db.query("ALTER TABLE cliente_integracion_tokens ADD COLUMN IF NOT EXISTS last_rate_limit_at TIMESTAMPTZ").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_cliente_integracion_tokens_empresa_cliente ON cliente_integracion_tokens(empresa_id, cliente_id, activo)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_cliente_integracion_tokens_hash ON cliente_integracion_tokens(token_hash)").catch(() => {});
    }).catch(err => {
      integracionTokensSchemaReady = null;
      throw err;
    });
  }
  return integracionTokensSchemaReady;
}

function hashIntegrationToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function maskIntegrationToken(token) {
  const raw = String(token || "");
  return raw.length > 18 ? `${raw.slice(0, 14)}...${raw.slice(-6)}` : raw;
}

function normalizeIntegrationScopes(value) {
  const allowed = new Set(["manifest", "feed"]);
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const scopes = raw.map(v => String(v || "").trim().toLowerCase()).filter(v => allowed.has(v));
  const unique = Array.from(new Set(scopes));
  return unique.length ? unique : ["manifest", "feed"];
}

function normalizeIntegrationRateLimit(value) {
  const n = Math.round(Number(value || 120) || 120);
  return Math.min(Math.max(n, 30), 1000);
}

function normalizeHorarioHabitual(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parts = raw
    .replace(/,/g, ";")
    .replace(/\r?\n/g, ";")
    .replace(/[–—]/g, "-")
    .replace(/\s+a\s+/gi, "-")
    .split(";")
    .map(p => p.trim())
    .filter(Boolean);
  const normalizeTime = (t) => {
    const clean = String(t || "").trim().replace(/[hH]\.?$/, "").replace(".", ":");
    const m = clean.match(/^(\d{1,2})(?::?(\d{2}))?$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = m[2] === undefined ? 0 : Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  const normalized = [];
  for (const part of parts) {
    const [start, end] = part.split("-").map(x => x.trim());
    const a = normalizeTime(start);
    const b = normalizeTime(end);
    if (!a || !b) {
      const err = new Error("Horario no valido. Usa formato 08:00-13:30; 15:00-18:00.");
      err.status = 400;
      throw err;
    }
    normalized.push(`${a}-${b}`);
  }
  return normalized.join("; ");
}
router.use(authenticate);

router.use(async (req, res, next) => {
  try {
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS tarifa_tipo VARCHAR(30)");
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS minimo_facturable NUMERIC");
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS minimo_unidades NUMERIC");
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS recargo_combustible_pct NUMERIC DEFAULT 0");
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS iva_pct NUMERIC DEFAULT 21");
    await db.query("ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS notas TEXT");
    await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS minimo_facturable_toneladas NUMERIC");
  } catch (e) {}
  next();
});

function normalizeIva(tipoIva, ivaRegimen) {
  const rawRegimen = String(ivaRegimen || "").trim().toLowerCase();
  const rawTipo = String(tipoIva ?? "").trim().toLowerCase();
  const key = rawRegimen || rawTipo;

  if (key === "exento") return { tipo_iva: 0, iva_regimen: "exento" };
  if (key === "cero" || key === "0") return { tipo_iva: 0, iva_regimen: "cero" };
  if (key === "reducido" || key === "10") return { tipo_iva: 10, iva_regimen: "reducido" };
  if (key === "superreducido" || key === "4") return { tipo_iva: 4, iva_regimen: "superreducido" };

  const pct = Number(tipoIva);
  if (Number.isFinite(pct)) {
    if (pct === 0) return { tipo_iva: 0, iva_regimen: rawRegimen === "exento" ? "exento" : "cero" };
    if (pct === 10) return { tipo_iva: 10, iva_regimen: "reducido" };
    if (pct === 4) return { tipo_iva: 4, iva_regimen: "superreducido" };
  }

  return { tipo_iva: 21, iva_regimen: "general" };
}

function numericOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  let raw = String(value).trim();
  if (raw.includes(",") && raw.includes(".")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (raw.includes(",")) raw = raw.replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const TARIFA_TIPOS = new Set(["viaje", "kg", "tonelada", "km", "hora", "palet"]);

function normalizeTarifaTipo(value, fallback = "viaje") {
  const raw = String(value || "").trim().toLowerCase();
  return TARIFA_TIPOS.has(raw) ? raw : fallback;
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

function normalizeRouteHealthKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildRutasClienteSalud(rows = []) {
  const issues = [];
  const groupMap = new Map();
  const pushIssue = (ruta, severity, key, label, detail, action) => {
    issues.push({
      ruta_id: ruta?.ruta_id || ruta?.id || null,
      severity,
      key,
      label,
      detail,
      action,
      origen: ruta?.origen || "",
      destino: ruta?.destino || "",
    });
  };

  for (const ruta of rows) {
    const tarifaTipo = normalizeTarifaTipo(ruta.tarifa_tipo);
    const precio = Number(ruta.precio_base ?? ruta.precio ?? 0) || 0;
    const km = Number(ruta.km || 0) || 0;
    const minimoFacturable = numericOrNull(ruta.minimo_facturable);
    const minimoUnidades = numericOrNull(ruta.minimo_unidades);
    const key = [
      normalizeRouteHealthKey(ruta.origen),
      normalizeRouteHealthKey(ruta.destino),
      normalizeRouteHealthKey(ruta.tipo_vehiculo || "cualquiera"),
    ].join("|");
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        origen: ruta.origen || "",
        destino: ruta.destino || "",
        tipo_vehiculo: ruta.tipo_vehiculo || "cualquiera",
        count: 0,
        tarifa_tipos: new Set(),
        ruta_ids: [],
      });
    }
    const group = groupMap.get(key);
    group.count += 1;
    group.tarifa_tipos.add(tarifaTipo);
    group.ruta_ids.push(ruta.ruta_id || ruta.id);

    if (!precio || precio <= 0) {
      pushIssue(ruta, "alta", "sin_precio", "Ruta sin precio", "La ruta no tiene precio base pactado.", "Completar precio antes de usarla en pedidos.");
    }
    if (!km || km <= 0) {
      pushIssue(ruta, "media", "sin_km", "Ruta sin kilometros", "La ruta no tiene kilometros, por lo que margen y EUR/km quedan incompletos.", "Calcular o completar kilometros.");
    }
    if (tarifaTipo === "viaje" && minimoUnidades !== null) {
      pushIssue(ruta, "media", "minimo_incoherente", "Minimo en campo incorrecto", "Una tarifa por viaje no debe mantener minimo de unidades.", "Guardar de nuevo la ruta para limpiar minimo_unidades.");
    }
    if (tarifaTipo !== "viaje" && minimoFacturable !== null) {
      pushIssue(ruta, "media", "minimo_incoherente", "Minimo facturable incoherente", "Una tarifa por unidades debe usar minimo de unidades, no minimo facturable en EUR.", "Guardar de nuevo la ruta para normalizar el minimo.");
    }
    if (tarifaTipo === "tonelada" && minimoUnidades !== null && Math.abs(minimoUnidades) >= 1000) {
      pushIssue(ruta, "alta", "minimo_toneladas_kg", "Minimo de toneladas en kg", "El minimo de toneladas parece guardado en kg.", "Revisar y guardar como toneladas, por ejemplo 24 en vez de 24000.");
    }
  }

  const groups = Array.from(groupMap.values()).map(group => ({
    ...group,
    tarifa_tipos: Array.from(group.tarifa_tipos),
  }));
  for (const group of groups) {
    if (group.count > 1) {
      issues.push({
        ruta_id: null,
        severity: "alta",
        key: "duplicada",
        label: "Ruta duplicada",
        detail: `${group.count} rutas para ${group.origen} -> ${group.destino} (${group.tipo_vehiculo}).`,
        action: "Unificar en una sola ruta/tarifa para evitar sugerencias ambiguas en pedidos.",
        origen: group.origen,
        destino: group.destino,
        ruta_ids: group.ruta_ids,
      });
    }
    if (group.tarifa_tipos.length > 1) {
      issues.push({
        ruta_id: null,
        severity: "alta",
        key: "tarifa_conflictiva",
        label: "Tipos de tarifa mezclados",
        detail: `${group.origen} -> ${group.destino} mezcla ${group.tarifa_tipos.join(", ")}.`,
        action: "Dejar una tarifa clara por cliente/ruta o separar por tipo de vehiculo.",
        origen: group.origen,
        destino: group.destino,
        ruta_ids: group.ruta_ids,
      });
    }
  }

  const bloqueantes = issues.filter(i => i.severity === "alta").length;
  const avisos = issues.filter(i => i.severity !== "alta").length;
  const total = rows.length;
  const score = total ? Math.max(0, Math.round(100 - bloqueantes * 18 - avisos * 8)) : 100;
  return {
    resumen: {
      total_rutas: total,
      duplicadas: issues.filter(i => i.key === "duplicada").length,
      conflictos_tarifa: issues.filter(i => i.key === "tarifa_conflictiva").length,
      sin_precio: issues.filter(i => i.key === "sin_precio").length,
      sin_km: issues.filter(i => i.key === "sin_km").length,
      minimos_incoherentes: issues.filter(i => i.key === "minimo_incoherente" || i.key === "minimo_toneladas_kg").length,
      bloqueantes,
      avisos,
      score,
      estado: bloqueantes ? "critica" : avisos ? "vigilancia" : "ok",
    },
    issues: issues.sort((a, b) => (a.severity === "alta" ? -1 : 1) - (b.severity === "alta" ? -1 : 1)),
    groups: groups.filter(g => g.count > 1 || g.tarifa_tipos.length > 1),
  };
}

function portalUsername(cliente) {
  const clean = String(cliente.cif || cliente.nombre || "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24) || "cliente";
  return `portal_${clean}_${String(cliente.id).slice(0, 8)}`;
}

function tempPassword() {
  return `Portal${Math.random().toString(36).slice(2, 8)}${Math.floor(10 + Math.random() * 89)}`;
}

async function assertClienteEmpresa(clienteId, empresaId) {
  const { rows } = await db.query(
    "SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2",
    [clienteId, empresaId]
  );
  return !!rows[0];
}

async function getRutasClienteRows(clienteId, empresaId) {
  const { rows } = await db.query(
    `SELECT COALESCE(rc.ruta_id, r.id) AS ruta_id,
            COALESCE(rc.cliente_id, r.cliente_id) AS cliente_id,
            rc.precio,
            rc.iva_pct,
            rc.notas AS precio_notas,
            cli.minimo_facturable_toneladas AS cliente_minimo_facturable_toneladas,
            r.id, r.origen, r.destino, r.km, r.peajes, r.tiempo_h, r.tipo_vehiculo,
            COALESCE(rc.tarifa_tipo, r.tarifa_tipo, 'viaje') AS tarifa_tipo,
            COALESCE(rc.precio, r.precio_base, 0) AS precio_base,
            COALESCE(rc.minimo_facturable, r.minimo_facturable) AS minimo_facturable,
            COALESCE(rc.minimo_unidades, r.minimo_unidades, cli.minimo_facturable_toneladas) AS minimo_unidades,
            COALESCE(rc.recargo_combustible_pct, r.recargo_combustible_pct, 0) AS recargo_combustible_pct
       FROM rutas r
       LEFT JOIN ruta_precios_cliente rc ON rc.ruta_id = r.id AND rc.cliente_id = $1
       JOIN clientes cli ON cli.id = $1 AND cli.empresa_id = $2
      WHERE (r.cliente_id = $1 OR rc.cliente_id = $1)
        AND r.activa = true
        AND (r.empresa_id = $2 OR r.empresa_id IS NULL)
      ORDER BY r.origen, r.destino`,
    [clienteId, empresaId]
  );
  return rows;
}

function buildClienteRiesgoAvisos(row = {}) {
  const limite = Number(row.limite_riesgo || 0) || 0;
  const pendiente = Number(row.total_pendiente || 0) || 0;
  const vencido = Number(row.total_vencido || 0) || 0;
  const facturasPendientes = Number(row.facturas_pendientes || 0) || 0;
  const facturasVencidas = Number(row.facturas_vencidas || 0) || 0;
  const riesgoPct = limite > 0 ? Math.round((pendiente / limite) * 1000) / 10 : null;
  const avisos = [];
  if (vencido > 0 || facturasVencidas > 0) {
    avisos.push({
      tipo: "cobro_vencido",
      nivel: "alto",
      mensaje: `${facturasVencidas} factura(s) vencida(s) por ${vencido.toFixed(2)} EUR.`,
    });
  } else if (pendiente > 0) {
    avisos.push({
      tipo: "deuda_pendiente",
      nivel: "medio",
      mensaje: `${facturasPendientes} factura(s) pendiente(s) por ${pendiente.toFixed(2)} EUR.`,
    });
  }
  if (limite > 0 && riesgoPct !== null) {
    if (riesgoPct >= 100) {
      avisos.push({ tipo: "limite_riesgo", nivel: "critico", mensaje: `Cliente por encima del limite de riesgo (${riesgoPct.toFixed(1)}%).` });
    } else if (riesgoPct >= 80) {
      avisos.push({ tipo: "limite_riesgo", nivel: "alto", mensaje: `Cliente cercano al limite de riesgo (${riesgoPct.toFixed(1)}%).` });
    } else if (riesgoPct >= 60) {
      avisos.push({ tipo: "limite_riesgo", nivel: "medio", mensaje: `Cliente en vigilancia de riesgo (${riesgoPct.toFixed(1)}%).` });
    }
  }
  const nivel = avisos.some(a => a.nivel === "critico") ? "critico"
    : avisos.some(a => a.nivel === "alto") ? "alto"
      : avisos.some(a => a.nivel === "medio") ? "medio"
        : "ok";
  return { riesgoPct, avisos, nivel };
}

// GET /clientes?q=texto&activo=true
router.get("/", async (req, res) => {
  const { q, activo, page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;
  const where  = ["empresa_id = $1"]; // tenant isolation
  const params = [req.empresaId||req.user.empresa_id];
  let i = 2;

  if (q) {
    where.push(`(nombre ILIKE $${i} OR cif ILIKE $${i} OR contacto ILIKE $${i} OR email ILIKE $${i})`);
    params.push(`%${q}%`); i++;
  }
  if (activo !== undefined) { where.push(`activo = $${i++}`); params.push(activo === "true"); }

  const countParams = params.slice(); // params without limit/offset
  const [{ rows }, { rows: cr }] = await Promise.all([
    db.query(`SELECT * FROM clientes WHERE ${where.join(" AND ")} ORDER BY nombre ASC LIMIT $${i} OFFSET $${i+1}`, [...params, limit, offset]),
    db.query(`SELECT COUNT(*) FROM clientes WHERE ${where.join(" AND ")}`, countParams),
  ]);
  const total = parseInt(cr[0].count);
  const pageN = +page; const limitN = +limit;
  res.json({
    data: rows,
    pagination: { total, page: pageN, limit: limitN,
      totalPages: Math.ceil(total/limitN), hasNext: pageN*limitN<total, hasPrev: pageN>1 }
  });
});

// GET /clientes/:id
router.get("/pendientes-revision", cacheMiddleware(60), async (req,res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    const {rows} = await db.query(
      "SELECT COUNT(*) FROM clientes WHERE empresa_id=$1 AND pendiente_revision=true AND activo=true",
      [empresaId]
    );
    res.json({count: parseInt(rows[0].count)});
  } catch(e) {
    // If column doesn't exist yet, return 0
    res.json({count: 0});
  }
});

// PATCH /clientes/:id/revision — mark as reviewed
router.get("/:id/riesgo-operativo", cacheMiddleware(30), async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(`
      SELECT c.id AS cliente_id,
             c.nombre AS cliente_nombre,
             COALESCE(c.limite_riesgo, 0) AS limite_riesgo,
             COUNT(f.id) FILTER (WHERE f.estado::text IN ('emitida','enviada','vencida','reclamada','sin_cobrar'))::int AS facturas_pendientes,
             COALESCE(SUM(f.total) FILTER (WHERE f.estado::text IN ('emitida','enviada','vencida','reclamada','sin_cobrar')), 0)::numeric AS total_pendiente,
             COUNT(f.id) FILTER (
               WHERE f.estado::text IN ('vencida','reclamada','sin_cobrar')
                  OR (fv.vencimiento_date IS NOT NULL AND fv.vencimiento_date < CURRENT_DATE AND f.estado::text IN ('emitida','enviada'))
             )::int AS facturas_vencidas,
             COALESCE(SUM(f.total) FILTER (
               WHERE f.estado::text IN ('vencida','reclamada','sin_cobrar')
                  OR (fv.vencimiento_date IS NOT NULL AND fv.vencimiento_date < CURRENT_DATE AND f.estado::text IN ('emitida','enviada'))
             ), 0)::numeric AS total_vencido,
             MIN(fv.vencimiento_date) FILTER (
               WHERE f.estado::text IN ('vencida','reclamada','sin_cobrar')
                  OR (fv.vencimiento_date IS NOT NULL AND fv.vencimiento_date < CURRENT_DATE AND f.estado::text IN ('emitida','enviada'))
             ) AS primer_vencimiento,
             MAX(f.fecha) FILTER (WHERE f.estado::text IN ('emitida','enviada','vencida','reclamada','sin_cobrar')) AS ultima_factura
        FROM clientes c
        LEFT JOIN facturas f ON f.cliente_id = c.id AND f.empresa_id = c.empresa_id
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN f.vencimiento IS NULL THEN NULL
            WHEN f.vencimiento::text ~ '^\\d{4}-\\d{2}-\\d{2}' THEN f.vencimiento::date
            ELSE NULL
          END AS vencimiento_date
        ) fv ON true
       WHERE c.id = $1 AND c.empresa_id = $2
       GROUP BY c.id, c.nombre, c.limite_riesgo
       LIMIT 1
    `, [req.params.id, empresaId]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "Cliente no encontrado" });
    const riesgo = buildClienteRiesgoAvisos(row);
    res.json({
      ...row,
      limite_riesgo: Number(row.limite_riesgo || 0),
      facturas_pendientes: Number(row.facturas_pendientes || 0),
      total_pendiente: Number(row.total_pendiente || 0),
      facturas_vencidas: Number(row.facturas_vencidas || 0),
      total_vencido: Number(row.total_vencido || 0),
      riesgo_pct: riesgo.riesgoPct,
      nivel: riesgo.nivel,
      avisos: riesgo.avisos,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo calcular el riesgo del cliente" });
  }
});

router.get("/:id", async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  const { rows } = await db.query("SELECT * FROM clientes WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
  if (!rows[0]) return res.status(404).json({ error: "Cliente no encontrado" });
  res.json(rows[0]);
});

router.post("/:id/portal-user", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    const empresaId = req.empresaId || req.user.empresa_id;
    const clienteRes = await db.query(
      "SELECT id,nombre,cif,email FROM clientes WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const cliente = clienteRes.rows[0];
    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });

  const existing = await db.query(
    `SELECT id,nombre,email,username,rol,cliente_id,activo
       FROM usuarios
      WHERE empresa_id=$1 AND cliente_id=$2 AND rol='cliente'
      ORDER BY created_at ASC
      LIMIT 1`,
    [empresaId, cliente.id]
  );
  if (existing.rows[0] && !req.body?.reset_password) {
    return res.json({ exists: true, usuario: existing.rows[0] });
  }

  const password = tempPassword();
  const hash = await bcrypt.hash(password, 12);
  const permisos = { modulos: { portal_cliente: { ver: true, editar: true }, mi_cuenta: { ver: true, editar: true } } };

  if (existing.rows[0]) {
    const { rows } = await db.query(
      `UPDATE usuarios
          SET password_hash=$1, debe_cambiar_password=true, activo=true
        WHERE id=$2 AND empresa_id=$3
        RETURNING id,nombre,email,username,rol,cliente_id,activo`,
      [hash, existing.rows[0].id, empresaId]
    );
    return res.json({ exists: true, reset: true, password_temporal: password, usuario: rows[0] });
  }

  const username = portalUsername(cliente);
  const { rows } = await db.query(
    `INSERT INTO usuarios
      (nombre,email,username,password_hash,rol,empresa_id,cliente_id,perfil,permisos,debe_cambiar_password)
     VALUES ($1,$2,$3,$4,'cliente',$5,$6,'Portal cliente',$7,true)
     RETURNING id,nombre,email,username,rol,cliente_id,activo`,
    [
      `${cliente.nombre} (Portal)`,
      null,
      username,
      hash,
      empresaId,
      cliente.id,
      permisos,
    ]
  );
    res.status(201).json({ created: true, password_temporal: password, usuario: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo crear el usuario de portal" });
  }
});

router.get("/:id/integracion-tokens", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    await ensureIntegracionTokensSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const clienteRes = await db.query(
      "SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    if (!clienteRes.rows[0]) return res.status(404).json({ error: "Cliente no encontrado" });
    const { rows } = await db.query(
      `SELECT id,nombre,token_mask,scopes,activo,expires_at,created_at,updated_at,last_used_at,last_used_ip,
              usage_count,window_started_at,window_count,rate_limit_per_hour,last_rate_limit_at
         FROM cliente_integracion_tokens
        WHERE empresa_id=$1 AND cliente_id=$2
        ORDER BY activo DESC, created_at DESC
        LIMIT 20`,
      [empresaId, req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudieron cargar los tokens de integracion" });
  }
});

router.post("/:id/integracion-token", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    await ensureIntegracionTokensSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const clienteRes = await db.query(
      "SELECT id,nombre,COALESCE(activo,true) AS activo FROM clientes WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    const cliente = clienteRes.rows[0];
    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
    if (!cliente.activo) return res.status(409).json({ error: "No se puede generar un token de integracion para un cliente inactivo" });
    const dias = Math.min(Math.max(Number(req.body?.dias || 365) || 365, 1), 1095);
    const nombre = String(req.body?.nombre || "Integracion EDI/API").trim().slice(0, 120) || "Integracion EDI/API";
    const scopes = normalizeIntegrationScopes(req.body?.scopes);
    const rateLimitPerHour = normalizeIntegrationRateLimit(req.body?.rate_limit_per_hour);
    const token = `tedi_${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = hashIntegrationToken(token);
    const tokenMask = maskIntegrationToken(token);
    const expiresAt = new Date(Date.now() + dias * 86400000).toISOString();
    const { rows } = await db.query(
      `INSERT INTO cliente_integracion_tokens
        (empresa_id,cliente_id,nombre,token_hash,token_mask,scopes,expires_at,created_by,rate_limit_per_hour)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
       RETURNING id,nombre,token_mask,scopes,activo,expires_at,created_at,updated_at,last_used_at,last_used_ip,
                 usage_count,window_started_at,window_count,rate_limit_per_hour,last_rate_limit_at`,
      [
        empresaId,
        cliente.id,
        nombre,
        tokenHash,
        tokenMask,
        JSON.stringify(scopes),
        expiresAt,
        req.user?.id || null,
        rateLimitPerHour,
      ]
    );
    await db.query(
      `INSERT INTO audit_log_saas (actor_tipo, actor_id, actor_email, empresa_id, accion, detalle, ip)
       VALUES ('usuario', $1, $2, $3, 'cliente.integracion_token.creado', $4::jsonb, $5)`,
      [
        req.user?.id || null,
        req.user?.email || req.user?.username || null,
        empresaId,
        JSON.stringify({ cliente_id: cliente.id, cliente_nombre: cliente.nombre, token_id: rows[0].id, token_mask: tokenMask, scopes, expires_at: expiresAt, rate_limit_per_hour: rateLimitPerHour }),
        req.ip || null,
      ]
    ).catch(() => {});
    res.status(201).json({
      token,
      message: "Copia este token ahora. No se volvera a mostrar completo.",
      credencial: rows[0],
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo generar el token de integracion" });
  }
});

router.delete("/:id/integracion-tokens/:tokenId", GERENTE_O_CONTABLE, async (req, res) => {
  try {
    await ensureIntegracionTokensSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      `UPDATE cliente_integracion_tokens
          SET activo=false, updated_at=NOW()
        WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3
        RETURNING id,token_mask`,
      [req.params.tokenId, empresaId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Token no encontrado" });
    await db.query(
      `INSERT INTO audit_log_saas (actor_tipo, actor_id, actor_email, empresa_id, accion, detalle, ip)
       VALUES ('usuario', $1, $2, $3, 'cliente.integracion_token.revocado', $4::jsonb, $5)`,
      [
        req.user?.id || null,
        req.user?.email || req.user?.username || null,
        empresaId,
        JSON.stringify({ cliente_id: req.params.id, token_id: rows[0].id, token_mask: rows[0].token_mask }),
        req.ip || null,
      ]
    ).catch(() => {});
    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message || "No se pudo revocar el token de integracion" });
  }
});

// POST /clientes
router.post("/", GERENTE_O_CONTABLE,
  body("nombre").notEmpty().withMessage("El nombre / razón social es obligatorio.").trim(),
  body("cif").notEmpty().withMessage("El CIF/NIF es obligatorio para crear el cliente.").trim().toUpperCase(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0]?.msg || "Datos de cliente no válidos.", errors: errors.array() });

    const { nombre, cif, direccion, cp, ciudad, pais, email, contacto, telefono,
            forma_pago, vencimiento, tipo_iva, iva_regimen, tipo_irpf, precio_tn_km, notas,
            calle, num_ext, codigo_postal, pendiente_revision,
            horario_carga, horario_descarga, email_facturacion, emails_albaranes, iban,
            minimo_facturable_toneladas } = req.body;
    const empresaId = req.empresaId||req.user.empresa_id;
    const iva = normalizeIva(tipo_iva, iva_regimen);
    let horarioCargaNorm;
    let horarioDescargaNorm;
    try {
      horarioCargaNorm = normalizeHorarioHabitual(horario_carga);
      horarioDescargaNorm = normalizeHorarioHabitual(horario_descarga);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    // Auto-marcar como pendiente si faltan datos clave
    const incompleto = pendiente_revision ||
      !cif?.trim() || !email?.trim() || !telefono?.trim() ||
      (!cp?.trim() && !codigo_postal?.trim()) || (!ciudad?.trim());

    const { rows } = await db.query(`
      INSERT INTO clientes (nombre,cif,direccion,cp,ciudad,pais,email,contacto,telefono,
        forma_pago,vencimiento,tipo_iva,iva_regimen,tipo_irpf,precio_tn_km,notas,empresa_id,
        pendiente_revision,email_facturacion,emails_albaranes,iban,horario_carga,horario_descarga,minimo_facturable_toneladas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
      [nombre,cif||null,calle?(calle+(num_ext?' '+num_ext:'')):direccion||null,
       codigo_postal||cp||null,ciudad||null,pais||"España",
       email||null,contacto||null,telefono||null,
       forma_pago||"Transferencia bancaria",vencimiento||"30 días",
       iva.tipo_iva,iva.iva_regimen,tipo_irpf||0,precio_tn_km||0,notas||null,empresaId,incompleto,
       email_facturacion || null, emails_albaranes || null, iban || null, horarioCargaNorm, horarioDescargaNorm,
       numericOrNull(minimo_facturable_toneladas)]
    );
    res.status(201).json(rows[0]);
  }
);

// PUT /clientes/:id
router.put("/:id", GERENTE_O_CONTABLE, async (req, res) => {
  const { nombre, cif, direccion, cp, ciudad, pais, email, contacto, telefono,
          forma_pago, vencimiento, tipo_iva, iva_regimen, tipo_irpf, precio_tn_km, activo, notas,
          email_facturacion, emails_albaranes, iban, horario_carga, horario_descarga,
          minimo_facturable_toneladas } = req.body;
  const empresaId = req.empresaId || req.user.empresa_id;
  const iva = normalizeIva(tipo_iva, iva_regimen);
  let horarioCargaNorm;
  let horarioDescargaNorm;
  try {
    horarioCargaNorm = normalizeHorarioHabitual(horario_carga);
    horarioDescargaNorm = normalizeHorarioHabitual(horario_descarga);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const { rows } = await db.query(`
    UPDATE clientes SET nombre=$1,cif=$2,direccion=$3,cp=$4,ciudad=$5,pais=$6,email=$7,
      contacto=$8,telefono=$9,forma_pago=$10,vencimiento=$11,tipo_iva=$12,iva_regimen=$13,tipo_irpf=$14,
      precio_tn_km=$15,activo=$16,notas=$17,email_facturacion=$18,emails_albaranes=$19,iban=$20,horario_carga=$21,horario_descarga=$22,minimo_facturable_toneladas=$23
    WHERE id=$24 AND empresa_id=$25 RETURNING *`,
    [nombre,cif,direccion,cp,ciudad,pais,email,contacto,telefono,forma_pago,vencimiento,
     iva.tipo_iva,iva.iva_regimen,tipo_irpf,precio_tn_km,activo!==undefined?activo:true,notas,
     email_facturacion || null, emails_albaranes || null, iban || null, horarioCargaNorm, horarioDescargaNorm,
     numericOrNull(minimo_facturable_toneladas), req.params.id,empresaId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Cliente no encontrado" });
  res.json(rows[0]);
});

// DELETE /clientes/:id — solo desactivar, no borrar
router.delete("/:id", GERENTE_O_CONTABLE, async (req, res) => {
  const empresaId = req.empresaId || req.user.empresa_id;
  await db.query("UPDATE clientes SET activo=false WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
  res.json({ ok: true });
});

// GET /clientes/pendientes-revision — count for notification badge
router.patch("/:id/revision", async (req,res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    await db.query(
      "UPDATE clientes SET pendiente_revision=false WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET /clientes/:id/rutas — listar rutas del cliente
router.get("/:id/rutas", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  try {
    if (!(await assertClienteEmpresa(req.params.id, empresaId))) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    const rows = await getRutasClienteRows(req.params.id, empresaId);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /clientes/:id/rutas/salud - diagnostico de duplicidades e incoherencias de tarifas
router.get("/:id/rutas/salud", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  try {
    if (!(await assertClienteEmpresa(req.params.id, empresaId))) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    const rows = await getRutasClienteRows(req.params.id, empresaId);
    res.json({
      generated_at: new Date().toISOString(),
      cliente_id: req.params.id,
      ...buildRutasClienteSalud(rows),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /clientes/:id/rutas — crear ruta vinculada a cliente
router.post("/:id/rutas", invalidateCache("rutas", "clientes"), async (req,res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    const { origen, destino, km, precio_base, notas, tarifa_tipo, minimo_facturable, minimo_unidades, recargo_combustible_pct, tipo_vehiculo } = req.body;
    const minima = normalizeMinimumsByTarifa(tarifa_tipo, minimo_facturable, minimo_unidades);
    if (!(await assertClienteEmpresa(req.params.id, empresaId))) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    if (!origen || !destino) return res.status(400).json({error:"Faltan origen y destino"});
    // Crear o actualizar la ruta general, reutilizando rutas globales o ya vinculadas al cliente.
    const { rows: existing } = await db.query(
      `SELECT r.id
       FROM rutas r
       LEFT JOIN ruta_precios_cliente rpc
         ON rpc.ruta_id = r.id
        AND rpc.cliente_id = $3
       WHERE LOWER(TRIM(r.origen))=LOWER(TRIM($1))
         AND LOWER(TRIM(r.destino))=LOWER(TRIM($2))
         AND (r.cliente_id=$3 OR rpc.cliente_id=$3 OR r.cliente_id IS NULL)
         AND COALESCE(r.tipo_vehiculo,'cualquiera')=$4
         AND COALESCE(r.activa,true)=true
         AND (r.empresa_id=$5 OR r.empresa_id IS NULL)
       ORDER BY CASE WHEN r.cliente_id=$3 OR rpc.cliente_id=$3 THEN 0 ELSE 1 END
       LIMIT 1`,
      [origen, destino, req.params.id, tipo_vehiculo || "cualquiera", empresaId]
    );
    let rutaId;
    if (existing[0]) {
      rutaId = existing[0].id;
    } else {
      const { rows: nueva } = await db.query(
        "INSERT INTO rutas (origen,destino,km,notas,empresa_id,cliente_id,tipo_vehiculo,tarifa_tipo,precio_base,minimo_facturable,minimo_unidades,recargo_combustible_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",
        [origen.trim(), destino.trim(), numericOrNull(km), notas||null, empresaId, req.params.id, tipo_vehiculo || "cualquiera", minima.tarifaTipo, numericOrNull(precio_base) || 0, minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct) || 0]
      );
      rutaId = nueva[0].id;
    }
    // Vincular precio al cliente
    const precio = numericOrNull(precio_base);
    await db.query(
      "INSERT INTO ruta_precios_cliente (ruta_id,cliente_id,precio,tarifa_tipo,minimo_facturable,minimo_unidades,recargo_combustible_pct) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (ruta_id,cliente_id) DO UPDATE SET precio=EXCLUDED.precio, tarifa_tipo=EXCLUDED.tarifa_tipo, minimo_facturable=EXCLUDED.minimo_facturable, minimo_unidades=EXCLUDED.minimo_unidades, recargo_combustible_pct=EXCLUDED.recargo_combustible_pct",
      [rutaId, req.params.id, precio || 0, minima.tarifaTipo, minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct) || 0]
    );
    res.status(201).json({ ruta_id: rutaId, ok: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PUT /clientes/:id/rutas/:rid - editar ruta asociada a cliente
router.put("/:id/rutas/:rid", invalidateCache("rutas", "clientes"), async (req,res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    const { origen, destino, km, precio_base, notas, tarifa_tipo, minimo_facturable, minimo_unidades, recargo_combustible_pct, tipo_vehiculo } = req.body;
    const minima = normalizeMinimumsByTarifa(tarifa_tipo, minimo_facturable, minimo_unidades);
    if (!(await assertClienteEmpresa(req.params.id, empresaId))) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    if (!origen || !destino) return res.status(400).json({error:"Faltan origen y destino"});

    const { rows: linked } = await db.query(`
      SELECT r.id
      FROM rutas r
      JOIN ruta_precios_cliente rc ON rc.ruta_id = r.id
      WHERE r.id=$1 AND rc.cliente_id=$2 AND (r.empresa_id=$3 OR r.empresa_id IS NULL)
    `, [req.params.rid, req.params.id, empresaId]);
    if (!linked[0]) return res.status(404).json({ error: "Ruta del cliente no encontrada" });

    const { rows } = await db.query(`
      UPDATE rutas
      SET origen=$1, destino=$2, km=$3, notas=$4, empresa_id=COALESCE(empresa_id, $5),
          tarifa_tipo=$7, precio_base=$8, minimo_facturable=$9, minimo_unidades=$10, recargo_combustible_pct=$11,
          cliente_id=$12, tipo_vehiculo=$13
      WHERE id=$6 AND (empresa_id=$5 OR empresa_id IS NULL)
      RETURNING *
    `, [origen.trim(), destino.trim(), numericOrNull(km), notas || null, empresaId, req.params.rid, minima.tarifaTipo, numericOrNull(precio_base) || 0, minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct) || 0, req.params.id, tipo_vehiculo || "cualquiera"]);
    if (!rows[0]) return res.status(404).json({ error: "Ruta no encontrada" });

    const precio = numericOrNull(precio_base);
    await db.query(
      "UPDATE ruta_precios_cliente SET precio=$1, tarifa_tipo=$2, minimo_facturable=$3, minimo_unidades=$4, recargo_combustible_pct=$5 WHERE ruta_id=$6 AND cliente_id=$7",
      [precio || 0, minima.tarifaTipo, minima.minimoFacturable, minima.minimoUnidades, numericOrNull(recargo_combustible_pct) || 0, req.params.rid, req.params.id]
    );
    res.json({ ok: true, ruta: rows[0] });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// DELETE /clientes/:id/rutas/:rid - quitar asociacion de ruta del cliente
router.delete("/:id/rutas/:rid", invalidateCache("rutas", "clientes"), async (req,res) => {
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    if (!(await assertClienteEmpresa(req.params.id, empresaId))) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    const { rowCount } = await db.query(`
      DELETE FROM ruta_precios_cliente rc
      USING rutas r
      WHERE rc.ruta_id=r.id
        AND rc.ruta_id=$1
        AND rc.cliente_id=$2
        AND (r.empresa_id=$3 OR r.empresa_id IS NULL)
    `, [req.params.rid, req.params.id, empresaId]);
    if (!rowCount) return res.status(404).json({ error: "Ruta del cliente no encontrada" });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
