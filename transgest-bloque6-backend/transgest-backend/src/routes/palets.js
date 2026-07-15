const express = require("express");
const db = require("../services/db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();
const PUEDE_EDITAR = requireRole("gerente", "trafico", "administrativo", "contable", "responsable_taller");

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id;
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function num(value, fallback = 0) {
  const clean = emptyToNull(value);
  if (clean === null) return fallback;
  const n = Number(clean);
  return Number.isFinite(n) ? n : fallback;
}

function int(value, fallback = 0) {
  return Math.trunc(num(value, fallback));
}

function normalizeObraReferencia(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function stockSign(tipo) {
  const t = String(tipo || "").toLowerCase();
  if (["salida", "salida_stock", "consumo", "venta", "devolucion", "baja"].includes(t)) return -1;
  return 1;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isPaletClienteTipo(tipo) {
  return ["entrega", "devolucion", "rectificativa_devolucion"].includes(String(tipo || "").toLowerCase());
}

function isPaletDevolucion(tipo) {
  return String(tipo || "").toLowerCase() === "devolucion";
}

function validatePaletsMovimientoDocumental({ tipo, num_albaran }) {
  if (isPaletDevolucion(tipo) && !emptyToNull(num_albaran)) {
    throw httpError(400, "El numero de albaran es obligatorio para registrar devoluciones de palets.");
  }
}

async function assertClienteEmpresa(clienteId, empresa) {
  const id = emptyToNull(clienteId);
  if (!id) return null;
  const { rows } = await db.query(
    "SELECT id, nombre FROM clientes WHERE id=$1 AND empresa_id=$2 AND activo=true LIMIT 1",
    [id, empresa]
  );
  return rows[0] || null;
}

async function getPaletLoteBalance(queryable, { empresa, movimientoOrigenId, propietarioId, excludeMovimientoId = null }) {
  const { rows } = await queryable.query(
    `SELECT origen.id, origen.cantidad, origen.obra_referencia, origen.pedido_ref,
            origen.cliente_movimiento_id, origen.propietario_cliente_id,
            COALESCE((
              SELECT SUM(dev.cantidad)
                FROM palets_movimientos dev
               WHERE dev.empresa_id=origen.empresa_id
                 AND LOWER(dev.tipo)='devolucion'
                 AND dev.movimiento_origen_id=origen.id
                 AND ($4::uuid IS NULL OR dev.id<>$4::uuid)
            ),0) AS devueltos_reservados,
            COALESCE((
              SELECT SUM(rect.cantidad)
                FROM palets_movimientos rect
                JOIN palets_movimientos dev_rect ON dev_rect.id=rect.movimiento_origen_id
               WHERE rect.empresa_id=origen.empresa_id
                 AND LOWER(rect.tipo)='rectificativa_devolucion'
                 AND dev_rect.movimiento_origen_id=origen.id
                 AND ($4::uuid IS NULL OR dev_rect.id<>$4::uuid)
            ),0) AS rectificados
       FROM palets_movimientos origen
      WHERE origen.id=$1 AND origen.empresa_id=$2
        AND origen.propietario_cliente_id=$3
        AND LOWER(origen.tipo)='entrega'
      FOR UPDATE`,
    [movimientoOrigenId, empresa, propietarioId, excludeMovimientoId]
  );
  const lote = rows[0];
  if (!lote) throw httpError(404, "No se ha encontrado la entrada de palets seleccionada para esta obra/referencia.");
  const devueltosNetos = Math.max(0, int(lote.devueltos_reservados) - int(lote.rectificados));
  return {
    ...lote,
    devueltos_netos: devueltosNetos,
    pendiente: Math.max(0, int(lote.cantidad) - devueltosNetos),
  };
}

async function validatePaletsMovimientoClientes({ empresa, tipo, propietario_cliente_id, cliente_movimiento_id }) {
  const propietarioId = emptyToNull(propietario_cliente_id);
  const movimientoId = emptyToNull(cliente_movimiento_id);

  if (isPaletClienteTipo(tipo) && !propietarioId) {
    throw httpError(400, "Selecciona el cliente propietario para separar correctamente los registros de palets.");
  }

  const propietario = propietarioId ? await assertClienteEmpresa(propietarioId, empresa) : null;
  const movimiento = movimientoId ? await assertClienteEmpresa(movimientoId, empresa) : null;
  if (propietarioId && !propietario) {
    throw httpError(404, "Cliente propietario no encontrado para esta empresa.");
  }
  if (movimientoId && !movimiento) {
    throw httpError(404, "Cliente/obra del movimiento no encontrado para esta empresa.");
  }

  return { propietarioId, movimientoId, propietario, movimiento };
}

async function validatePaletsFacturaBorrador({ empresa, factura_id, cliente_id }) {
  const facturaId = emptyToNull(factura_id);
  if (!facturaId) return null;
  const { rows } = await db.query(
    "SELECT id, cliente_id, estado FROM facturas WHERE id=$1 AND empresa_id=$2 LIMIT 1",
    [facturaId, empresa]
  );
  const factura = rows[0];
  if (!factura) {
    throw httpError(404, "Factura no encontrada para esta empresa.");
  }
  if (cliente_id && String(factura.cliente_id) !== String(cliente_id)) {
    throw httpError(400, "La factura de devolucion debe pertenecer al mismo cliente propietario de los palets.");
  }
  if (String(factura.estado || "").toLowerCase() !== "borrador") {
    throw httpError(409, "Solo se puede vincular una factura borrador a una devolucion de palets.");
  }
  return facturaId;
}

async function prepararMercanciaMovimiento(client, { empresa, mercancia_id, almacen_id, tipo, cantidad }) {
  if (!mercancia_id) return { mercancia: null, almacenId: emptyToNull(almacen_id), error: null };

  const { rows } = await client.query(
    "SELECT id, almacen_id, stock_actual FROM almacen_mercancias WHERE id=$1 AND empresa_id=$2 AND activo=true FOR UPDATE",
    [mercancia_id, empresa]
  );
  const mercancia = rows[0];
  if (!mercancia) {
    return { error: { status: 404, message: "Mercancia no encontrada" } };
  }

  const requestedAlmacenId = emptyToNull(almacen_id);
  const mercanciaAlmacenId = emptyToNull(mercancia.almacen_id);
  if (requestedAlmacenId && mercanciaAlmacenId && String(requestedAlmacenId) !== String(mercanciaAlmacenId)) {
    return {
      error: {
        status: 409,
        message: "La mercancia pertenece a otro almacen. Cambia el filtro de almacen o mueve la mercancia antes de registrar el movimiento.",
      },
    };
  }

  if (stockSign(tipo) < 0 && num(mercancia.stock_actual) < num(cantidad)) {
    return {
      error: {
        status: 409,
        message: `Stock insuficiente. Disponible: ${num(mercancia.stock_actual)} ${num(mercancia.stock_actual) === 1 ? "unidad" : "unidades"}.`,
      },
    };
  }

  return { mercancia, almacenId: mercanciaAlmacenId || requestedAlmacenId || null, error: null };
}

let paletsWorkflowSchemaReady = null;
function ensurePaletsWorkflowSchema() {
  if (!paletsWorkflowSchemaReady) {
    paletsWorkflowSchemaReady = (async () => {
      await db.query("ALTER TABLE palets_movimientos ADD COLUMN IF NOT EXISTS estado_salida VARCHAR(30) DEFAULT 'confirmada'");
      await db.query("ALTER TABLE palets_movimientos ADD COLUMN IF NOT EXISTS salida_confirmada_at TIMESTAMPTZ");
      await db.query("ALTER TABLE palets_movimientos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ");
      await db.query("ALTER TABLE palets_movimientos ADD COLUMN IF NOT EXISTS obra_referencia VARCHAR(240)");
      await db.query("ALTER TABLE palets_movimientos ADD COLUMN IF NOT EXISTS movimiento_origen_id UUID REFERENCES palets_movimientos(id) ON DELETE SET NULL");
      await db.query("UPDATE palets_movimientos SET estado_salida='confirmada' WHERE estado_salida IS NULL");
      await db.query("UPDATE palets_movimientos SET obra_referencia=NULLIF(TRIM(pedido_ref),'') WHERE obra_referencia IS NULL AND NULLIF(TRIM(pedido_ref),'') IS NOT NULL");
      await db.query("CREATE INDEX IF NOT EXISTS idx_palets_movimientos_origen ON palets_movimientos(empresa_id, movimiento_origen_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_palets_movimientos_obra ON palets_movimientos(empresa_id, propietario_cliente_id, obra_referencia)");
    })().catch(err => {
      paletsWorkflowSchemaReady = null;
      throw err;
    });
  }
  return paletsWorkflowSchemaReady;
}

function activeBoolean(active, activo) {
  if (active !== undefined) return active !== false;
  if (activo !== undefined) return activo !== false;
  return true;
}

router.get("/", async (req, res) => {
  await ensurePaletsWorkflowSchema();
  const empresa = empresaId(req);
  const { rows } = await db.query(
    `SELECT pm.*, cp.nombre AS propietario_nombre, cm.nombre AS cliente_movimiento_nombre, a.nombre AS almacen_nombre
       FROM palets_movimientos pm
       LEFT JOIN clientes cp ON cp.id=pm.propietario_cliente_id
       LEFT JOIN clientes cm ON cm.id=pm.cliente_movimiento_id
       LEFT JOIN almacenes a ON a.id=pm.almacen_id
      WHERE pm.empresa_id=$1
      ORDER BY pm.fecha DESC, pm.created_at DESC
      LIMIT 500`,
    [empresa]
  );
  res.json({ data: rows });
});

router.get("/almacenes", async (req, res) => {
  const empresa = empresaId(req);
  const { rows } = await db.query(
    "SELECT * FROM almacenes WHERE empresa_id=$1 AND activo=true ORDER BY nombre",
    [empresa]
  );
  res.json(rows);
});

router.post("/almacenes", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  const { nombre, tipo, direccion, lat, lng, responsable, notas } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "Nombre obligatorio" });

  const { rows } = await db.query(
    `INSERT INTO almacenes (empresa_id,nombre,tipo,direccion,lat,lng,responsable,notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      empresa,
      nombre.trim(),
      emptyToNull(tipo) || "general",
      emptyToNull(direccion),
      emptyToNull(lat),
      emptyToNull(lng),
      emptyToNull(responsable),
      emptyToNull(notas),
    ]
  );
  if (rows[0]) return res.status(201).json(rows[0]);

  const existing = await db.query(
    "SELECT * FROM almacenes WHERE empresa_id=$1 AND LOWER(TRIM(nombre))=LOWER(TRIM($2)) AND activo=true LIMIT 1",
    [empresa, nombre]
  );
  res.json(existing.rows[0]);
});

router.delete("/almacenes/:id", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  await db.query(
    "UPDATE almacenes SET activo=false, updated_at=NOW() WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresa]
  );
  res.json({ ok: true });
});

router.get("/movimientos", async (req, res) => {
  await ensurePaletsWorkflowSchema();
  const empresa = empresaId(req);
  const { propietario_cliente_id, cliente_movimiento_id, desde, hasta } = req.query;
  const params = [empresa];
  const where = ["pm.empresa_id=$1"];
  if (propietario_cliente_id) {
    params.push(propietario_cliente_id);
    where.push(`pm.propietario_cliente_id=$${params.length}`);
  }
  if (cliente_movimiento_id) {
    params.push(cliente_movimiento_id);
    where.push(`pm.cliente_movimiento_id=$${params.length}`);
  }
  if (desde) {
    params.push(desde);
    where.push(`pm.fecha >= $${params.length}`);
  }
  if (hasta) {
    params.push(hasta);
    where.push(`pm.fecha <= $${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT pm.*, cp.nombre AS propietario_nombre, cm.nombre AS cliente_movimiento_nombre, a.nombre AS almacen_nombre
       FROM palets_movimientos pm
       LEFT JOIN clientes cp ON cp.id=pm.propietario_cliente_id
       LEFT JOIN clientes cm ON cm.id=pm.cliente_movimiento_id
       LEFT JOIN almacenes a ON a.id=pm.almacen_id
      WHERE ${where.join(" AND ")}
      ORDER BY pm.fecha DESC, pm.created_at DESC
      LIMIT 1000`,
    params
  );
  res.json(rows);
});

router.post("/movimientos", PUEDE_EDITAR, async (req, res) => {
  await ensurePaletsWorkflowSchema();
  const empresa = empresaId(req);
  const {
    almacen_id, propietario_cliente_id, cliente_movimiento_id, tipo,
    cantidad, precio_unitario, num_albaran, pedido_ref, fecha, notas, factura_id,
    estado_salida, salida_confirmada_at, obra_referencia, movimiento_origen_id,
  } = req.body || {};

  if (!tipo) return res.status(400).json({ error: "Tipo obligatorio" });
  if (int(cantidad) <= 0) return res.status(400).json({ error: "La cantidad debe ser mayor que cero" });
  let clientesMovimiento;
  let facturaId = null;
  try {
    validatePaletsMovimientoDocumental({ tipo, num_albaran });
    clientesMovimiento = await validatePaletsMovimientoClientes({ empresa, tipo, propietario_cliente_id, cliente_movimiento_id });
    facturaId = await validatePaletsFacturaBorrador({ empresa, factura_id, cliente_id: clientesMovimiento.propietarioId });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  try {
    const created = await db.transaction(async client => {
      const tipoNormalizado = String(tipo).toLowerCase();
      let origenId = emptyToNull(movimiento_origen_id);
      let obraRef = normalizeObraReferencia(obra_referencia || pedido_ref || clientesMovimiento.movimiento?.nombre);

      if (["entrega", "devolucion"].includes(tipoNormalizado) && !obraRef && !origenId) {
        throw httpError(400, "Indica la obra o referencia para poder controlar las devoluciones pendientes.");
      }

      if (tipoNormalizado === "devolucion") {
        if (!origenId) {
          const candidates = await client.query(
            `SELECT id
               FROM palets_movimientos
              WHERE empresa_id=$1 AND propietario_cliente_id=$2 AND LOWER(tipo)='entrega'
                AND LOWER(COALESCE(NULLIF(obra_referencia,''),NULLIF(pedido_ref,''),''))=LOWER($3)
              ORDER BY fecha, created_at
              FOR UPDATE`,
            [empresa, clientesMovimiento.propietarioId, obraRef]
          );
          for (const candidate of candidates.rows) {
            const saldo = await getPaletLoteBalance(client, {
              empresa,
              movimientoOrigenId: candidate.id,
              propietarioId: clientesMovimiento.propietarioId,
            });
            if (saldo.pendiente >= int(cantidad)) {
              origenId = candidate.id;
              break;
            }
          }
        }
        if (!origenId) {
          throw httpError(409, "Selecciona la entrada/obra concreta. No hay un lote con saldo suficiente para esta devolucion.");
        }
        const saldo = await getPaletLoteBalance(client, {
          empresa,
          movimientoOrigenId: origenId,
          propietarioId: clientesMovimiento.propietarioId,
        });
        if (int(cantidad) > saldo.pendiente) {
          throw httpError(409, `Solo quedan ${saldo.pendiente} palets pendientes en esta obra/referencia.`);
        }
        obraRef = obraRef || normalizeObraReferencia(saldo.obra_referencia || saldo.pedido_ref);
      }

      if (tipoNormalizado === "rectificativa_devolucion") {
        if (!origenId) throw httpError(400, "Selecciona la devolucion que quieres rectificar.");
        const original = await client.query(
          `SELECT dev.*, COALESCE((SELECT SUM(r.cantidad) FROM palets_movimientos r
                                   WHERE r.empresa_id=dev.empresa_id
                                     AND LOWER(r.tipo)='rectificativa_devolucion'
                                     AND r.movimiento_origen_id=dev.id),0) AS rectificado
             FROM palets_movimientos dev
            WHERE dev.id=$1 AND dev.empresa_id=$2 AND LOWER(dev.tipo)='devolucion'
            FOR UPDATE`,
          [origenId, empresa]
        );
        if (!original.rows[0]) throw httpError(404, "No se ha encontrado la devolucion original.");
        const disponibleRectificar = Math.max(0, int(original.rows[0].cantidad) - int(original.rows[0].rectificado));
        if (int(cantidad) > disponibleRectificar) {
          throw httpError(409, `Solo se pueden rectificar ${disponibleRectificar} palets de esta devolucion.`);
        }
        obraRef = obraRef || normalizeObraReferencia(original.rows[0].obra_referencia || original.rows[0].pedido_ref);
      }

      const { rows } = await client.query(
        `INSERT INTO palets_movimientos
          (empresa_id,almacen_id,propietario_cliente_id,cliente_movimiento_id,tipo,cantidad,precio_unitario,
           num_albaran,pedido_ref,obra_referencia,movimiento_origen_id,fecha,notas,factura_id,
           estado_salida,salida_confirmada_at,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::date,CURRENT_DATE),$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          empresa, emptyToNull(almacen_id), clientesMovimiento.propietarioId, clientesMovimiento.movimientoId,
          tipoNormalizado, int(cantidad), num(precio_unitario), emptyToNull(num_albaran),
          emptyToNull(pedido_ref) || obraRef || null, obraRef || null, origenId,
          emptyToNull(fecha), emptyToNull(notas), facturaId,
          emptyToNull(estado_salida) || (tipoNormalizado === "devolucion" ? "pendiente" : "confirmada"),
          emptyToNull(salida_confirmada_at), req.user?.id || null,
        ]
      );
      return rows[0];
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put("/movimientos/:id", PUEDE_EDITAR, async (req, res) => {
  await ensurePaletsWorkflowSchema();
  const empresa = empresaId(req);
  const actual = await db.query(
    "SELECT * FROM palets_movimientos WHERE id=$1 AND empresa_id=$2 LIMIT 1",
    [req.params.id, empresa]
  );
  if (!actual.rows[0]) return res.status(404).json({ error: "Movimiento no encontrado" });
  if (actual.rows[0].factura_id) {
    return res.status(409).json({ error: "El movimiento tiene factura vinculada y no se puede editar" });
  }
  if (String(actual.rows[0].tipo || "").toLowerCase() === "devolucion" && String(actual.rows[0].estado_salida || "").toLowerCase() === "confirmada") {
    return res.status(409).json({ error: "La devolucion ya esta confirmada y no se puede editar" });
  }

  const {
    almacen_id, propietario_cliente_id, cliente_movimiento_id, tipo,
    cantidad, precio_unitario, num_albaran, pedido_ref, fecha, notas, factura_id,
    estado_salida, obra_referencia, movimiento_origen_id,
  } = req.body || {};
  if (!tipo) return res.status(400).json({ error: "Tipo obligatorio" });
  if (int(cantidad) <= 0) return res.status(400).json({ error: "La cantidad debe ser mayor que cero" });
  let clientesMovimiento;
  let facturaId = actual.rows[0].factura_id;
  try {
    validatePaletsMovimientoDocumental({ tipo, num_albaran });
    clientesMovimiento = await validatePaletsMovimientoClientes({ empresa, tipo, propietario_cliente_id, cliente_movimiento_id });
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "factura_id")) {
      facturaId = await validatePaletsFacturaBorrador({ empresa, factura_id, cliente_id: clientesMovimiento.propietarioId });
    }
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  const tipoNormalizado = String(tipo).toLowerCase();
  const origenId = emptyToNull(movimiento_origen_id) || actual.rows[0].movimiento_origen_id || null;
  const obraRef = normalizeObraReferencia(
    obra_referencia || pedido_ref || actual.rows[0].obra_referencia || clientesMovimiento.movimiento?.nombre
  );
  if (["entrega", "devolucion"].includes(tipoNormalizado) && !obraRef && !origenId) {
    return res.status(400).json({ error: "Indica la obra o referencia del movimiento." });
  }
  if (tipoNormalizado === "devolucion" && origenId) {
    try {
      const saldo = await getPaletLoteBalance(db, {
        empresa,
        movimientoOrigenId: origenId,
        propietarioId: clientesMovimiento.propietarioId,
        excludeMovimientoId: req.params.id,
      });
      if (int(cantidad) > saldo.pendiente) {
        return res.status(409).json({ error: `Solo quedan ${saldo.pendiente} palets pendientes en esta obra/referencia.` });
      }
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  const { rows } = await db.query(
    `UPDATE palets_movimientos SET
       almacen_id=$1,propietario_cliente_id=$2,cliente_movimiento_id=$3,tipo=$4,cantidad=$5,
       precio_unitario=$6,num_albaran=$7,pedido_ref=$8,fecha=COALESCE($9::date,CURRENT_DATE),
       notas=$10,factura_id=$11,estado_salida=$12,obra_referencia=$13,movimiento_origen_id=$14,updated_at=NOW()
     WHERE id=$15 AND empresa_id=$16
     RETURNING *`,
    [
      emptyToNull(almacen_id),
      clientesMovimiento.propietarioId,
      clientesMovimiento.movimientoId,
      tipoNormalizado,
      int(cantidad),
      num(precio_unitario),
      emptyToNull(num_albaran),
      emptyToNull(pedido_ref),
      emptyToNull(fecha),
      emptyToNull(notas),
      facturaId,
      emptyToNull(estado_salida) || (tipoNormalizado === "devolucion" ? "pendiente" : "confirmada"),
      obraRef || null,
      origenId,
      req.params.id,
      empresa,
    ]
  );
  res.json(rows[0]);
});

router.patch("/movimientos/:id/confirmar-salida", PUEDE_EDITAR, async (req, res) => {
  await ensurePaletsWorkflowSchema();
  const empresa = empresaId(req);
  const { factura_id } = req.body || {};
  const actual = await db.query(
    "SELECT * FROM palets_movimientos WHERE id=$1 AND empresa_id=$2 AND LOWER(tipo)='devolucion' LIMIT 1",
    [req.params.id, empresa]
  );
  if (!actual.rows[0]) return res.status(404).json({ error: "Devolucion no encontrada" });
  let facturaId = null;
  try {
    validatePaletsMovimientoDocumental({ tipo: actual.rows[0].tipo, num_albaran: actual.rows[0].num_albaran });
    facturaId = await validatePaletsFacturaBorrador({
      empresa,
      factura_id,
      cliente_id: actual.rows[0].propietario_cliente_id,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  const { rows } = await db.query(
    `UPDATE palets_movimientos SET
       estado_salida='confirmada',
       salida_confirmada_at=COALESCE(salida_confirmada_at,NOW()),
       factura_id=COALESCE($1::uuid,factura_id),
       updated_at=NOW()
     WHERE id=$2 AND empresa_id=$3 AND LOWER(tipo)='devolucion'
     RETURNING *`,
    [facturaId, req.params.id, empresa]
  );
  res.json(rows[0]);
});

router.delete("/movimientos/:id", PUEDE_EDITAR, async (req, res) => {
  await ensurePaletsWorkflowSchema();
  const empresa = empresaId(req);
  await db.query("DELETE FROM palets_movimientos WHERE id=$1 AND empresa_id=$2", [req.params.id, empresa]);
  res.json({ ok: true });
});

router.get("/resumen", async (req, res) => {
  await ensurePaletsWorkflowSchema();
  const empresa = empresaId(req);
  const { rows } = await db.query(
    `SELECT
        pm.propietario_cliente_id,
        cp.nombre AS propietario_nombre,
        pm.cliente_movimiento_id,
        cm.nombre AS cliente_movimiento_nombre,
        SUM(CASE
          WHEN LOWER(pm.tipo) IN ('salida','salida_stock','consumo','venta','baja') THEN -pm.cantidad
          WHEN LOWER(pm.tipo)='devolucion' AND COALESCE(pm.estado_salida,'confirmada')='confirmada' THEN -pm.cantidad
          WHEN LOWER(pm.tipo)='devolucion' THEN 0
          ELSE pm.cantidad
        END) AS stock,
        SUM(CASE WHEN pm.fecha < CURRENT_DATE - INTERVAL '14 days' THEN
          CASE
            WHEN LOWER(pm.tipo) IN ('salida','salida_stock','consumo','venta','baja') THEN -pm.cantidad
            WHEN LOWER(pm.tipo)='devolucion' AND COALESCE(pm.estado_salida,'confirmada')='confirmada' THEN -pm.cantidad
            WHEN LOWER(pm.tipo)='devolucion' THEN 0
            ELSE pm.cantidad
          END
        ELSE 0 END) AS stock_mas_14_dias
       FROM palets_movimientos pm
       LEFT JOIN clientes cp ON cp.id=pm.propietario_cliente_id
       LEFT JOIN clientes cm ON cm.id=pm.cliente_movimiento_id
      WHERE pm.empresa_id=$1
      GROUP BY pm.propietario_cliente_id, cp.nombre, pm.cliente_movimiento_id, cm.nombre
      ORDER BY cp.nombre NULLS LAST, cm.nombre NULLS LAST`,
    [empresa]
  );
  res.json(rows);
});

router.get("/mercancias", async (req, res) => {
  const empresa = empresaId(req);
  const { origen, cliente_id, almacen_id } = req.query;
  const params = [empresa];
  const where = ["m.empresa_id=$1", "m.activo=true"];
  if (origen) {
    params.push(origen);
    where.push(`m.origen=$${params.length}`);
  }
  if (cliente_id) {
    params.push(cliente_id);
    where.push(`m.cliente_id=$${params.length}`);
  }
  if (almacen_id) {
    params.push(almacen_id);
    where.push(`m.almacen_id=$${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT m.*, c.nombre AS cliente_nombre, a.nombre AS almacen_nombre
       FROM almacen_mercancias m
       LEFT JOIN clientes c ON c.id=m.cliente_id
       LEFT JOIN almacenes a ON a.id=m.almacen_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.nombre`,
    params
  );
  res.json(rows);
});

router.post("/mercancias", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  const {
    almacen_id, cliente_id, origen, nombre, sku, lote, unidad,
    stock_actual, stock_minimo, precio_compra, precio_venta,
    margen_objetivo_pct, aviso_dias, fecha_caducidad, notas,
  } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "Nombre obligatorio" });

  const { rows } = await db.query(
    `INSERT INTO almacen_mercancias
      (empresa_id,almacen_id,cliente_id,origen,nombre,sku,lote,unidad,stock_actual,stock_minimo,
       precio_compra,precio_venta,margen_objetivo_pct,aviso_dias,fecha_caducidad,notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      empresa,
      emptyToNull(almacen_id),
      emptyToNull(cliente_id),
      emptyToNull(origen) || "propia",
      nombre,
      emptyToNull(sku),
      emptyToNull(lote),
      emptyToNull(unidad) || "unidad",
      num(stock_actual),
      num(stock_minimo),
      num(precio_compra),
      num(precio_venta),
      num(margen_objetivo_pct),
      emptyToNull(aviso_dias),
      emptyToNull(fecha_caducidad),
      emptyToNull(notas),
    ]
  );
  res.status(201).json(rows[0]);
});

router.put("/mercancias/:id", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  const {
    almacen_id, cliente_id, origen, nombre, sku, lote, unidad,
    stock_actual, stock_minimo, precio_compra, precio_venta,
    margen_objetivo_pct, aviso_dias, fecha_caducidad, notas, activo,
  } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "Nombre obligatorio" });

  const { rows } = await db.query(
    `UPDATE almacen_mercancias SET
       almacen_id=$1,cliente_id=$2,origen=$3,nombre=$4,sku=$5,lote=$6,unidad=$7,
       stock_actual=$8,stock_minimo=$9,precio_compra=$10,precio_venta=$11,
       margen_objetivo_pct=$12,aviso_dias=$13,fecha_caducidad=$14,notas=$15,
       activo=$16,updated_at=NOW()
     WHERE id=$17 AND empresa_id=$18
     RETURNING *`,
    [
      emptyToNull(almacen_id),
      emptyToNull(cliente_id),
      emptyToNull(origen) || "propia",
      nombre,
      emptyToNull(sku),
      emptyToNull(lote),
      emptyToNull(unidad) || "unidad",
      num(stock_actual),
      num(stock_minimo),
      num(precio_compra),
      num(precio_venta),
      num(margen_objetivo_pct),
      emptyToNull(aviso_dias),
      emptyToNull(fecha_caducidad),
      emptyToNull(notas),
      activeBoolean(undefined, activo),
      req.params.id,
      empresa,
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: "Mercancia no encontrada" });
  res.json(rows[0]);
});

router.delete("/mercancias/:id", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  await db.query(
    "UPDATE almacen_mercancias SET activo=false, updated_at=NOW() WHERE id=$1 AND empresa_id=$2",
    [req.params.id, empresa]
  );
  res.json({ ok: true });
});

router.get("/movimientos-almacen", async (req, res) => {
  const empresa = empresaId(req);
  const filters = ["am.empresa_id=$1"];
  const values = [empresa];
  if (req.query.almacen_id) {
    values.push(req.query.almacen_id);
    filters.push(`am.almacen_id=$${values.length}`);
  }
  if (req.query.origen) {
    values.push(req.query.origen);
    filters.push(`m.origen=$${values.length}`);
  }
  if (req.query.mercancia_id) {
    values.push(req.query.mercancia_id);
    filters.push(`am.mercancia_id=$${values.length}`);
  }
  const { rows } = await db.query(
    `SELECT am.*, m.nombre AS mercancia_nombre, c.nombre AS cliente_nombre, a.nombre AS almacen_nombre
       FROM almacen_movimientos am
       LEFT JOIN almacen_mercancias m ON m.id=am.mercancia_id
       LEFT JOIN clientes c ON c.id=am.cliente_id
       LEFT JOIN almacenes a ON a.id=am.almacen_id
      WHERE ${filters.join(" AND ")}
      ORDER BY am.fecha DESC, am.created_at DESC
      LIMIT 1000`,
    values
  );
  res.json(rows);
});

router.post("/movimientos-almacen", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  const {
    almacen_id, mercancia_id, cliente_id, cliente_origen_id, cliente_destino_id,
    tipo, cantidad, unidad, precio_unitario, num_albaran, pedido_ref, fecha, notas, metadata,
  } = req.body || {};
  if (!tipo) return res.status(400).json({ error: "Tipo obligatorio" });
  if (!num(cantidad)) return res.status(400).json({ error: "Cantidad obligatoria" });

  const result = await db.transaction(async client => {
    const prepared = await prepararMercanciaMovimiento(client, { empresa, mercancia_id, almacen_id, tipo, cantidad });
    if (prepared.error) throw httpError(prepared.error.status, prepared.error.message);

    const inserted = await client.query(
      `INSERT INTO almacen_movimientos
        (empresa_id,almacen_id,mercancia_id,cliente_id,cliente_origen_id,cliente_destino_id,tipo,cantidad,
         unidad,precio_unitario,num_albaran,pedido_ref,fecha,notas,metadata,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::date,CURRENT_DATE),$14,$15,$16)
       RETURNING *`,
      [
        empresa,
        prepared.almacenId,
        emptyToNull(mercancia_id),
        emptyToNull(cliente_id),
        emptyToNull(cliente_origen_id),
        emptyToNull(cliente_destino_id),
        tipo,
        num(cantidad),
        emptyToNull(unidad) || "unidad",
        num(precio_unitario),
        emptyToNull(num_albaran),
        emptyToNull(pedido_ref),
        emptyToNull(fecha),
        emptyToNull(notas),
        metadata && typeof metadata === "object" ? metadata : {},
        req.user?.id || null,
      ]
    );
    if (mercancia_id) {
      await client.query(
        "UPDATE almacen_mercancias SET stock_actual=stock_actual+$1, updated_at=NOW() WHERE id=$2 AND empresa_id=$3",
        [num(cantidad) * stockSign(tipo), mercancia_id, empresa]
      );
    }
    return inserted.rows[0];
  });

  res.status(201).json(result);
});

router.put("/movimientos-almacen/:id", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  const {
    almacen_id, mercancia_id, cliente_id, cliente_origen_id, cliente_destino_id,
    tipo, cantidad, unidad, precio_unitario, num_albaran, pedido_ref, fecha, notas, metadata,
  } = req.body || {};
  if (!tipo) return res.status(400).json({ error: "Tipo obligatorio" });
  if (!num(cantidad)) return res.status(400).json({ error: "Cantidad obligatoria" });

  const result = await db.transaction(async client => {
    const current = await client.query(
      "SELECT * FROM almacen_movimientos WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
      [req.params.id, empresa]
    );
    if (!current.rows[0]) return null;
    const old = current.rows[0];
    if (old.mercancia_id) {
      await client.query(
        "UPDATE almacen_mercancias SET stock_actual=stock_actual-$1, updated_at=NOW() WHERE id=$2 AND empresa_id=$3",
        [num(old.cantidad) * stockSign(old.tipo), old.mercancia_id, empresa]
      );
    }
    const prepared = await prepararMercanciaMovimiento(client, { empresa, mercancia_id, almacen_id, tipo, cantidad });
    if (prepared.error) throw httpError(prepared.error.status, prepared.error.message);

    const updated = await client.query(
      `UPDATE almacen_movimientos SET
         almacen_id=$1, mercancia_id=$2, cliente_id=$3, cliente_origen_id=$4, cliente_destino_id=$5,
         tipo=$6, cantidad=$7, unidad=$8, precio_unitario=$9, num_albaran=$10, pedido_ref=$11,
         fecha=COALESCE($12::date,CURRENT_DATE), notas=$13, metadata=$14
       WHERE id=$15 AND empresa_id=$16
      RETURNING *`,
      [
        prepared.almacenId,
        emptyToNull(mercancia_id),
        emptyToNull(cliente_id),
        emptyToNull(cliente_origen_id),
        emptyToNull(cliente_destino_id),
        tipo,
        num(cantidad),
        emptyToNull(unidad) || "unidad",
        num(precio_unitario),
        emptyToNull(num_albaran),
        emptyToNull(pedido_ref),
        emptyToNull(fecha),
        emptyToNull(notas),
        metadata && typeof metadata === "object" ? metadata : {},
        req.params.id,
        empresa,
      ]
    );
    if (mercancia_id) {
      await client.query(
        "UPDATE almacen_mercancias SET stock_actual=stock_actual+$1, updated_at=NOW() WHERE id=$2 AND empresa_id=$3",
        [num(cantidad) * stockSign(tipo), mercancia_id, empresa]
      );
    }
    return updated.rows[0];
  });

  if (!result) return res.status(404).json({ error: "Movimiento no encontrado" });
  res.json(result);
});

router.delete("/movimientos-almacen/:id", PUEDE_EDITAR, async (req, res) => {
  const empresa = empresaId(req);
  await db.transaction(async client => {
    const current = await client.query(
      "SELECT * FROM almacen_movimientos WHERE id=$1 AND empresa_id=$2 FOR UPDATE",
      [req.params.id, empresa]
    );
    const old = current.rows[0];
    if (old?.mercancia_id) {
      await client.query(
        "UPDATE almacen_mercancias SET stock_actual=stock_actual-$1, updated_at=NOW() WHERE id=$2 AND empresa_id=$3",
        [num(old.cantidad) * stockSign(old.tipo), old.mercancia_id, empresa]
      );
    }
    await client.query("DELETE FROM almacen_movimientos WHERE id=$1 AND empresa_id=$2", [req.params.id, empresa]);
  });
  res.json({ ok: true });
});

module.exports = router;
