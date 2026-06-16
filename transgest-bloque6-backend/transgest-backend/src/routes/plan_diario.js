const express = require("express");
const db = require("../services/db");

const router = express.Router();

function empresaId(req) {
  return req.user?.empresa_id || req.empresaId || null;
}

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function daysUntil(date, baseDate) {
  const d = new Date(`${dateOnly(date)}T00:00:00`);
  const b = new Date(`${dateOnly(baseDate)}T00:00:00`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.ceil((d.getTime() - b.getTime()) / 86400000);
}

function alertLevel({ severity = "info", label = "", title = "", detail = "", source = "" }) {
  return {
    severity,
    label,
    title,
    detail,
    source,
  };
}

function normalizeEstadoPedido(estado) {
  const raw = String(estado || "pendiente").toLowerCase();
  if (["entregado", "facturado", "cancelado"].includes(raw)) return raw;
  if (raw === "en_curso") return "en_curso";
  if (raw === "descarga") return "descarga";
  if (raw === "confirmado") return "confirmado";
  return "pendiente";
}

async function ensurePlanDiarioSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS plan_diario_notas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE CASCADE,
      matricula_snapshot VARCHAR(60),
      nota TEXT NOT NULL DEFAULT '',
      pedido_orden JSONB NOT NULL DEFAULT '[]'::jsonb,
      color VARCHAR(30) NOT NULL DEFAULT 'info',
      updated_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("ALTER TABLE plan_diario_notas ADD COLUMN IF NOT EXISTS pedido_orden JSONB NOT NULL DEFAULT '[]'::jsonb").catch(() => {});
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_diario_notas_empresa_fecha_vehiculo
      ON plan_diario_notas(empresa_id, fecha, vehiculo_id)
      WHERE vehiculo_id IS NOT NULL
  `);
}

function isRemolqueLike(row = {}, remolqueIds = new Set()) {
  if (remolqueIds.has(String(row.id || ""))) return true;
  const text = normalizeSearchText(`${row.clase || ""} ${row.tipo || ""} ${row.tipo_vehiculo || ""}`);
  const remolqueTerms = [
    "remolque", "semirremolque", "semi", "trailer", "tautliner", "tauliner",
    "lona", "banera", "volcador", "cisterna", "frigorifico", "frigo",
    "portacoches", "lateral bajo", "lowboy", "dolly", "balleston",
    "plataforma", "chasis", "piso movil", "gondola",
  ];
  return remolqueTerms.some(term => text.includes(term));
}

function isTractora(row = {}, remolqueIds = new Set()) {
  if (isRemolqueLike(row, remolqueIds)) return false;
  return true;
}

function buildRutaPedido(p) {
  const origen = cleanText(p.origen);
  const destino = cleanText(p.destino);
  if (origen && destino) return `${origen} -> ${destino}`;
  return origen || destino || "Sin ruta";
}

function buildPedidoResumen(p, fecha) {
  const carga = dateOnly(p.fecha_carga || p.fecha_pedido);
  const descarga = dateOnly(p.fecha_descarga || p.fecha_entrega);
  const momento = carga === fecha && descarga === fecha
    ? "carga_descarga"
    : descarga === fecha
      ? "descarga"
      : "carga";
  return {
    id: p.id,
    numero: p.numero,
    cliente_nombre: p.cliente_nombre,
    colaborador_id: p.colaborador_id || null,
    colaborador_nombre: p.colaborador_nombre,
    origen: p.origen,
    destino: p.destino,
    ruta: buildRutaPedido(p),
    estado: normalizeEstadoPedido(p.estado),
    fecha_carga: carga,
    hora_carga: p.hora_carga || null,
    fecha_descarga: descarga || null,
    hora_descarga: p.hora_descarga || null,
    ventana_carga: p.ventana_carga || null,
    ventana_descarga: p.ventana_descarga || null,
    vehiculo_id: p.vehiculo_id || null,
    vehiculo_matricula: p.vehiculo_matricula || p.matricula_colaborador || null,
    remolque_id: p.remolque_id || null,
    remolque_matricula: p.remolque_matricula || p.remolque_matricula_colaborador || null,
    chofer_id: p.chofer_id || null,
    chofer_nombre: p.chofer_nombre || null,
    pendiente_completar: !!p.pendiente_completar,
    aviso_completar: p.aviso_completar || "",
    momento,
  };
}

function sortPedidosPlan(pedidos, nota) {
  const order = Array.isArray(nota?.pedido_orden) ? nota.pedido_orden.map(String) : [];
  const index = new Map(order.map((id, i) => [id, i]));
  return [...pedidos].sort((a, b) => {
    const ai = index.has(String(a.id)) ? index.get(String(a.id)) : 9999;
    const bi = index.has(String(b.id)) ? index.get(String(b.id)) : 9999;
    if (ai !== bi) return ai - bi;
    return String(a.hora_carga || a.hora_descarga || "").localeCompare(String(b.hora_carga || b.hora_descarga || ""));
  });
}

function matchAgendaForRow(eventos, row) {
  const matricula = cleanText(row.matricula).toLowerCase();
  const chofer = cleanText(row.chofer_nombre).toLowerCase();
  const choferUserId = row.chofer_usuario_id ? String(row.chofer_usuario_id) : "";
  return eventos.filter(e => {
    const metadata = e.metadata && typeof e.metadata === "object" ? e.metadata : {};
    if (e.vehiculo_id && String(e.vehiculo_id) === String(row.id)) return true;
    if (metadata.vehiculo_id && String(metadata.vehiculo_id) === String(row.id)) return true;
    if (metadata.matricula && matricula && cleanText(metadata.matricula).toLowerCase() === matricula) return true;
    if (choferUserId && e.asignado_a && String(e.asignado_a) === choferUserId) return true;
    const text = `${e.titulo || ""} ${e.descripcion || ""}`.toLowerCase();
    if (matricula && text.includes(matricula)) return true;
    if (chofer && text.includes(chofer)) return true;
    return false;
  });
}

function buildMaintenanceAlerts({ vehiculo, tallerData }) {
  const alerts = [];
  const reparaciones = Array.isArray(tallerData?.reparaciones) ? tallerData.reparaciones : [];
  const cfgs = Array.isArray(tallerData?.avisos_mant) ? tallerData.avisos_mant : [];
  for (const cfg of cfgs) {
    if (!cfg?.activo) continue;
    const tipo = cleanText(cfg.tipo_mantenimiento);
    if (!tipo) continue;
    const ultimas = reparaciones
      .filter(r => String(r.vehiculo_id || "") === String(vehiculo.id || "") && cleanText(r.tipo).toLowerCase().includes(tipo.toLowerCase()))
      .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    const ult = ultimas[0];
    if (!ult) continue;
    const diasDesde = Math.ceil((new Date() - new Date(ult.fecha)) / 86400000);
    const kmDesde = Number(vehiculo.km_actuales || 0) - Number(ult.km_en_intervencion || 0);
    const pctDias = Number(cfg.dias_aviso || 0) > 0 ? diasDesde / Number(cfg.dias_aviso) : 0;
    const pctKm = Number(cfg.km_aviso || 0) > 0 ? kmDesde / Number(cfg.km_aviso) : 0;
    const pct = Math.max(pctDias, pctKm);
    if (pct >= 0.75) {
      alerts.push(alertLevel({
        severity: pct >= 1 ? "danger" : "warning",
        label: pct >= 1 ? "Vencido" : "Proximo",
        title: tipo,
        detail: [
          cfg.descripcion,
          Number(cfg.km_aviso || 0) > 0 ? `${Math.max(0, Math.round(kmDesde))}/${cfg.km_aviso} km` : "",
          Number(cfg.dias_aviso || 0) > 0 ? `${Math.max(0, diasDesde)}/${cfg.dias_aviso} dias` : "",
        ].filter(Boolean).join(" - "),
        source: "mantenimiento",
      }));
    }
  }
  return alerts;
}

router.get("/", async (req, res, next) => {
  try {
    await ensurePlanDiarioSchema();
    const empresa = empresaId(req);
    if (!empresa) return res.status(401).json({ error: "Sin empresa_id" });
    const fecha = dateOnly(req.query.fecha || new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Fecha no valida" });

    const [
      vehiculosRes,
      pedidosRes,
      docsVehRes,
      docsChoferRes,
      agendaRes,
      tallerEstadoRes,
      intervencionesRes,
      notasRes,
    ] = await Promise.all([
      db.query(
        `SELECT v.*,
                r.matricula AS remolque_matricula,
                r.marca AS remolque_marca,
                r.modelo AS remolque_modelo,
                TRIM(CONCAT(COALESCE(ch.nombre,''), ' ', COALESCE(ch.apellidos,''))) AS chofer_nombre,
                ch.telefono AS chofer_telefono,
                u.id AS chofer_usuario_id
           FROM vehiculos v
           LEFT JOIN vehiculos r ON r.id=v.remolque_id AND r.empresa_id=v.empresa_id
           LEFT JOIN choferes ch ON ch.id=v.chofer_id AND ch.empresa_id=v.empresa_id
           LEFT JOIN usuarios u ON u.chofer_id=ch.id AND u.empresa_id=v.empresa_id AND u.activo=true
          WHERE v.empresa_id=$1 AND COALESCE(v.activo,true)=true
          ORDER BY v.matricula`,
        [empresa]
      ),
      db.query(
        `SELECT p.*,
                c.nombre AS cliente_nombre,
                co.nombre AS colaborador_nombre,
                TRIM(CONCAT(COALESCE(ch.nombre,''), ' ', COALESCE(ch.apellidos,''))) AS chofer_nombre,
                v.matricula AS vehiculo_matricula,
                r.matricula AS remolque_matricula
           FROM pedidos p
           LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
           LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
           LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
           LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
           LEFT JOIN vehiculos r ON r.id=p.remolque_id AND r.empresa_id=p.empresa_id
          WHERE p.empresa_id=$1
            AND COALESCE(p.estado::text,'pendiente') NOT IN ('cancelado','facturado')
            AND (
              COALESCE(p.fecha_carga, p.fecha_pedido)::date=$2::date
              OR COALESCE(p.fecha_descarga, p.fecha_entrega)::date=$2::date
            )
          ORDER BY COALESCE(p.hora_carga, p.hora_descarga, '23:59') ASC, p.numero ASC`,
        [empresa, fecha]
      ),
      db.query(
        `SELECT d.*, v.id AS vehiculo_id, v.matricula
           FROM docs_vehiculos d
           JOIN vehiculos v ON v.id=d.vehiculo_id AND v.empresa_id=$1
          WHERE d.fecha_vencimiento IS NOT NULL
            AND d.fecha_vencimiento <= $2::date + INTERVAL '30 days'`,
        [empresa, fecha]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT d.*, ch.id AS chofer_id,
                TRIM(CONCAT(COALESCE(ch.nombre,''), ' ', COALESCE(ch.apellidos,''))) AS chofer_nombre
           FROM docs_choferes d
           JOIN choferes ch ON ch.id=d.chofer_id AND ch.empresa_id=$1
          WHERE d.fecha_vencimiento IS NOT NULL
            AND d.fecha_vencimiento <= $2::date + INTERVAL '30 days'`,
        [empresa, fecha]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT e.*
           FROM agenda_eventos e
          WHERE e.empresa_id=$1
            AND e.estado NOT IN ('hecha','cancelada')
            AND e.fecha_inicio::date <= $2::date
            AND COALESCE(e.fecha_fin::date, e.fecha_inicio::date) >= $2::date
          ORDER BY e.prioridad, e.fecha_inicio`,
        [empresa, fecha]
      ).catch(() => ({ rows: [] })),
      db.query("SELECT data FROM taller_estado WHERE empresa_id=$1", [empresa]).catch(() => ({ rows: [] })),
      db.query(
        `SELECT i.*, v.matricula AS vehiculo_matricula
           FROM taller_intervenciones i
           LEFT JOIN vehiculos v ON v.id=i.vehiculo_id AND v.empresa_id=i.empresa_id
          WHERE i.empresa_id=$1
            AND COALESCE(i.estado,'abierta') NOT IN ('cerrada','cerrado','cancelada','cancelado')
          ORDER BY i.fecha DESC, i.created_at DESC
          LIMIT 300`,
        [empresa]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT *
           FROM plan_diario_notas
          WHERE empresa_id=$1 AND fecha=$2::date`,
        [empresa, fecha]
      ),
    ]);

    const tallerData = tallerEstadoRes.rows[0]?.data || {};
    const pedidos = pedidosRes.rows.map(p => buildPedidoResumen(p, fecha));
    const pedidosByVehicle = new Map();
    pedidos.forEach(p => {
      if (!p.vehiculo_id) return;
      const key = String(p.vehiculo_id);
      if (!pedidosByVehicle.has(key)) pedidosByVehicle.set(key, []);
      pedidosByVehicle.get(key).push(p);
    });
    const notasByVehicle = new Map(notasRes.rows.filter(n => n.vehiculo_id).map(n => [String(n.vehiculo_id), n]));
    const docsVehByVehicle = new Map();
    docsVehRes.rows.forEach(d => {
      const key = String(d.vehiculo_id);
      if (!docsVehByVehicle.has(key)) docsVehByVehicle.set(key, []);
      docsVehByVehicle.get(key).push(d);
    });
    const docsChoferByChofer = new Map();
    docsChoferRes.rows.forEach(d => {
      const key = String(d.chofer_id);
      if (!docsChoferByChofer.has(key)) docsChoferByChofer.set(key, []);
      docsChoferByChofer.get(key).push(d);
    });
    const intervByVehicle = new Map();
    intervencionesRes.rows.forEach(i => {
      if (!i.vehiculo_id) return;
      const key = String(i.vehiculo_id);
      if (!intervByVehicle.has(key)) intervByVehicle.set(key, []);
      intervByVehicle.get(key).push(i);
    });

    const remolqueIds = new Set(
      vehiculosRes.rows
        .map(v => v.remolque_id)
        .filter(Boolean)
        .map(String)
    );
    const rows = vehiculosRes.rows.filter(v => isTractora(v, remolqueIds)).map(v => {
      const alerts = [];
      if (["taller", "inactivo"].includes(String(v.estado || "").toLowerCase())) {
        alerts.push(alertLevel({
          severity: "danger",
          label: "No disponible",
          title: v.estado === "taller" ? "Vehiculo en taller" : "Vehiculo inactivo",
          detail: cleanText(v.ubicacion_actual || v.notas),
          source: "vehiculo",
        }));
      }
      (docsVehByVehicle.get(String(v.id)) || []).forEach(d => {
        const diff = daysUntil(d.fecha_vencimiento, fecha);
        alerts.push(alertLevel({
          severity: diff <= 0 ? "danger" : diff <= 7 ? "danger" : "warning",
          label: diff <= 0 ? "Caducado" : `${diff} dias`,
          title: `Doc vehiculo: ${d.tipo || d.tipo_doc || "documento"}`,
          detail: `Vence ${dateOnly(d.fecha_vencimiento)}`,
          source: "documentos",
        }));
      });
      (docsChoferByChofer.get(String(v.chofer_id)) || []).forEach(d => {
        const diff = daysUntil(d.fecha_vencimiento, fecha);
        alerts.push(alertLevel({
          severity: diff <= 0 ? "danger" : diff <= 7 ? "danger" : "warning",
          label: diff <= 0 ? "Caducado" : `${diff} dias`,
          title: `Doc chofer: ${d.tipo || d.tipo_doc || "documento"}`,
          detail: `Vence ${dateOnly(d.fecha_vencimiento)}`,
          source: "documentos",
        }));
      });
      (intervByVehicle.get(String(v.id)) || []).forEach(i => {
        alerts.push(alertLevel({
          severity: String(i.estado || "").toLowerCase().includes("abierta") ? "danger" : "warning",
          label: i.estado || "Taller",
          title: i.tipo || "Intervencion taller",
          detail: cleanText(i.descripcion || i.notas || i.taller_externo),
          source: "taller",
        }));
      });
      buildMaintenanceAlerts({ vehiculo: v, tallerData }).forEach(a => alerts.push(a));
      matchAgendaForRow(agendaRes.rows, v).forEach(e => {
        alerts.push(alertLevel({
          severity: e.prioridad === "alta" ? "danger" : e.prioridad === "baja" ? "info" : "warning",
          label: e.tipo || "Agenda",
          title: e.titulo || "Evento",
          detail: cleanText(e.descripcion),
          source: "agenda",
        }));
      });
      const nota = notasByVehicle.get(String(v.id));
      return {
        id: v.id,
        matricula: v.matricula,
        marca: v.marca,
        modelo: v.modelo,
        clase: v.clase || v.tipo || "",
        estado: v.estado || "disponible",
        ubicacion_actual: v.ubicacion_actual || "",
        km_actuales: v.km_actuales || null,
        remolque_id: v.remolque_id || null,
        remolque_matricula: v.remolque_matricula || "",
        chofer_id: v.chofer_id || null,
        chofer_nombre: v.chofer_nombre || "",
        chofer_telefono: v.chofer_telefono || "",
        notas_operacion: v.notas_operacion || v.notas || "",
        pedidos: sortPedidosPlan(pedidosByVehicle.get(String(v.id)) || [], nota),
        avisos: alerts.sort((a, b) => {
          const order = { danger: 0, warning: 1, info: 2, ok: 3 };
          return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
        }),
        nota_plan: nota?.nota || "",
        nota_color: nota?.color || "info",
        pedido_orden: Array.isArray(nota?.pedido_orden) ? nota.pedido_orden : [],
      };
    });

    const validTractoraIds = new Set(rows.map(r => String(r.id)));
    const unassigned = pedidos.filter(p => {
      if (p.colaborador_nombre || p.colaborador_id) return false;
      const hasValidTractora = p.vehiculo_id && validTractoraIds.has(String(p.vehiculo_id));
      return !hasValidTractora || !p.chofer_id;
    });
    const resumen = {
      tractoras: rows.length,
      vehiculos: rows.length,
      con_trabajo: rows.filter(r => r.pedidos.length > 0).length,
      sin_trabajo: rows.filter(r => r.pedidos.length === 0).length,
      avisos_rojos: rows.reduce((s, r) => s + r.avisos.filter(a => a.severity === "danger").length, 0),
      avisos_amarillos: rows.reduce((s, r) => s + r.avisos.filter(a => a.severity === "warning").length, 0),
      pedidos_sin_asignar: unassigned.length,
    };
    res.json({ fecha, rows, unassigned, resumen });
  } catch (error) {
    next(error);
  }
});

router.put("/notas", async (req, res, next) => {
  try {
    await ensurePlanDiarioSchema();
    const empresa = empresaId(req);
    if (!empresa) return res.status(401).json({ error: "Sin empresa_id" });
    const fecha = dateOnly(req.body?.fecha);
    const vehiculoId = cleanText(req.body?.vehiculo_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Fecha no valida" });
    if (!vehiculoId) return res.status(400).json({ error: "Vehiculo obligatorio" });
    const nota = String(req.body?.nota || "").slice(0, 1000);
    const color = ["info", "warning", "danger", "ok"].includes(req.body?.color) ? req.body.color : "info";
    const veh = await db.query(
      `SELECT v.*,
              EXISTS (
                SELECT 1 FROM vehiculos tractor
                 WHERE tractor.remolque_id=v.id
                   AND tractor.empresa_id=v.empresa_id
                   AND COALESCE(tractor.activo,true)=true
              ) AS usado_como_remolque
         FROM vehiculos v
        WHERE v.id=$1 AND v.empresa_id=$2`,
      [vehiculoId, empresa]
    );
    if (!veh.rows[0]) return res.status(404).json({ error: "Vehiculo no encontrado" });
    const remolqueIds = veh.rows[0].usado_como_remolque ? new Set([String(veh.rows[0].id)]) : new Set();
    if (!isTractora(veh.rows[0], remolqueIds)) return res.status(400).json({ error: "El plan diario solo admite notas sobre tractoras." });
    const { rows } = await db.query(
      `INSERT INTO plan_diario_notas
        (empresa_id, fecha, vehiculo_id, matricula_snapshot, nota, color, updated_by, updated_at)
       VALUES ($1,$2::date,$3::uuid,$4,$5,$6,$7,NOW())
       ON CONFLICT (empresa_id, fecha, vehiculo_id)
       WHERE vehiculo_id IS NOT NULL
       DO UPDATE SET nota=$5, color=$6, matricula_snapshot=$4, updated_by=$7, updated_at=NOW()
       RETURNING *`,
      [empresa, fecha, vehiculoId, veh.rows[0].matricula, nota, color, req.user?.id || null]
    );
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put("/orden", async (req, res, next) => {
  try {
    await ensurePlanDiarioSchema();
    const empresa = empresaId(req);
    if (!empresa) return res.status(401).json({ error: "Sin empresa_id" });
    const fecha = dateOnly(req.body?.fecha);
    const vehiculoId = cleanText(req.body?.vehiculo_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Fecha no valida" });
    if (!vehiculoId) return res.status(400).json({ error: "Vehiculo obligatorio" });
    const pedidoOrden = Array.isArray(req.body?.pedido_orden)
      ? req.body.pedido_orden.map(cleanText).filter(Boolean).slice(0, 80)
      : [];
    const veh = await db.query(
      `SELECT v.*,
              EXISTS (
                SELECT 1 FROM vehiculos tractor
                 WHERE tractor.remolque_id=v.id
                   AND tractor.empresa_id=v.empresa_id
                   AND COALESCE(tractor.activo,true)=true
              ) AS usado_como_remolque
         FROM vehiculos v
        WHERE v.id=$1 AND v.empresa_id=$2`,
      [vehiculoId, empresa]
    );
    if (!veh.rows[0]) return res.status(404).json({ error: "Vehiculo no encontrado" });
    const remolqueIds = veh.rows[0].usado_como_remolque ? new Set([String(veh.rows[0].id)]) : new Set();
    if (!isTractora(veh.rows[0], remolqueIds)) return res.status(400).json({ error: "El plan diario solo admite ordenar pedidos sobre tractoras." });
    const { rows } = await db.query(
      `INSERT INTO plan_diario_notas
        (empresa_id, fecha, vehiculo_id, matricula_snapshot, pedido_orden, updated_by, updated_at)
       VALUES ($1,$2::date,$3::uuid,$4,$5::jsonb,$6,NOW())
       ON CONFLICT (empresa_id, fecha, vehiculo_id)
       WHERE vehiculo_id IS NOT NULL
       DO UPDATE SET pedido_orden=$5::jsonb, matricula_snapshot=$4, updated_by=$6, updated_at=NOW()
       RETURNING *`,
      [empresa, fecha, vehiculoId, veh.rows[0].matricula, JSON.stringify(pedidoOrden), req.user?.id || null]
    );
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
