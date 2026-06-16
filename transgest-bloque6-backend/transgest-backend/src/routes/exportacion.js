const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../services/db");

const router = express.Router();

const TABLES = {
  clientes: ["id","nombre","cif","email","email_facturacion","telefono","direccion","ciudad","pais","forma_pago","dias_pago","tipo_iva","iva_regimen","tipo_irpf","limite_riesgo","modo_facturacion","notas","activo","created_at"],
  vehiculos: ["id","matricula","marca","modelo","clase","tipo","tara_kg","carga_max_kg","km_actuales","estado","activo","chofer_id","remolque_id","ubicacion_actual","created_at"],
  choferes: ["id","nombre","apellidos","dni","telefono","email","vehiculo_id","categoria_carnet","tipo_contrato","salario","activo","created_at"],
  pedidos: ["id","numero","cliente_id","vehiculo_id","chofer_id","origen","destino","fecha_pedido","fecha_carga","hora_carga","fecha_descarga","hora_descarga","mercancia","peso_kg","bultos","importe","estado","notas","created_at"],
  facturas: ["id","numero","cliente_id","pedido_id","fecha","vencimiento","base","iva","irpf","total","estado","created_at"],
  colaboradores: ["id","nombre","cif","email","telefono","tipo","iban","forma_pago","tipo_iva","iva_regimen","calle","num_ext","codigo_postal","ciudad","provincia","pais","contacto_nombre","contacto_telefono","notas","activo","created_at"],
  rutas: ["id","cliente_id","origen","destino","km","peajes","tiempo_h","activa","created_at"],
};

function superAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autorizado" });
  try {
    const payload = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    if (!payload.superadmin) return res.status(403).json({ error: "Acceso denegado" });
    req.superadmin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r;]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toCsv(rows, cols) {
  const header = cols.map(csvCell).join(",");
  const body = rows.map(row => cols.map(col => csvCell(row[col])).join(",")).join("\n");
  return `${header}\n${body}`;
}

async function assertEmpresa(empresaId) {
  const { rows } = await db.query("SELECT id, nombre FROM empresas WHERE id=$1", [empresaId]);
  return rows[0] || null;
}

async function availableColumns(table, preferred) {
  const { rows } = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const existing = new Set(rows.map(r => r.column_name));
  return preferred.filter(col => existing.has(col));
}

async function exportTable(empresaId, table) {
  const preferred = TABLES[table];
  if (!preferred) {
    const err = new Error("Tabla no exportable");
    err.status = 404;
    throw err;
  }
  const cols = await availableColumns(table, preferred);
  if (!cols.length) return { cols: [], rows: [] };

  const order = cols.includes("created_at") ? " ORDER BY created_at DESC NULLS LAST" : "";
  const { rows } = await db.query(
    `SELECT ${cols.map(c => `"${c}"`).join(", ")} FROM "${table}" WHERE empresa_id=$1${order}`,
    [empresaId]
  );
  return { cols, rows };
}

router.get("/exportar/:empresaId/:tabla", superAuth, async (req, res) => {
  try {
    const empresa = await assertEmpresa(req.params.empresaId);
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });
    const tabla = req.params.tabla;
    const { cols, rows } = await exportTable(req.params.empresaId, tabla);
    const filename = `${tabla}_${empresa.nombre || empresa.id}.csv`.replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + toCsv(rows, cols));
  } catch(e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get("/exportar/:empresaId", superAuth, async (req, res) => {
  try {
    const empresa = await assertEmpresa(req.params.empresaId);
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

    const sections = [];
    for (const table of Object.keys(TABLES)) {
      const { cols, rows } = await exportTable(req.params.empresaId, table);
      sections.push(`### ${table}\n${toCsv(rows, cols)}`);
    }

    const filename = `export_${empresa.nombre || empresa.id}.txt`.replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + sections.join("\n\n"));
  } catch(e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
