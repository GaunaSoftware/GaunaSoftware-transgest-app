// ── Rutas que migran localStorage → BD ───────────────────────────────────
// Cubre: gastos estructura, gasoil/repostajes, noches, objetivos,
//        nóminas emitidas, config chófer, config empresa
const express = require("express");
const db      = require("../services/db");
const { authenticate, SOLO_GERENTE, GERENTE_O_CONTABLE, requireRole } = require("../middleware/auth");
const router  = express.Router();
router.use(authenticate);

const EID = req => req.empresaId || req.user.empresa_id;

// ════════════════════════════════════════════════════════════
// GASTOS DE ESTRUCTURA
// ════════════════════════════════════════════════════════════
router.get("/gastos-estructura", async (req,res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM gastos_estructura WHERE empresa_id=$1 AND activo=true ORDER BY fecha DESC, nombre",
      [EID(req)]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post("/gastos-estructura", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    const {nombre,tipo,importe,periodo,fecha,notas} = req.body;
    if (!nombre) return res.status(400).json({error:"Nombre obligatorio"});
    const {rows} = await db.query(
      "INSERT INTO gastos_estructura (empresa_id,nombre,tipo,importe,periodo,fecha,notas) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [EID(req),nombre,tipo||"Otros",importe||0,periodo||"mensual",fecha||new Date().toISOString().slice(0,7),notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.put("/gastos-estructura/:id", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    const {nombre,tipo,importe,periodo,fecha,notas} = req.body;
    const {rows} = await db.query(
      "UPDATE gastos_estructura SET nombre=$1,tipo=$2,importe=$3,periodo=$4,fecha=$5,notas=$6 WHERE id=$7 AND empresa_id=$8 RETURNING *",
      [nombre,tipo,importe,periodo,fecha,notas||null,req.params.id,EID(req)]
    );
    if (!rows[0]) return res.status(404).json({error:"No encontrado"});
    res.json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete("/gastos-estructura/:id", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    await db.query("UPDATE gastos_estructura SET activo=false WHERE id=$1 AND empresa_id=$2", [req.params.id,EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Meses cerrados
router.get("/meses-cerrados", async (req,res) => {
  const {rows} = await db.query("SELECT mes FROM meses_cerrados WHERE empresa_id=$1",[EID(req)]);
  res.json(rows.map(r=>r.mes));
});
router.post("/meses-cerrados/:mes", GERENTE_O_CONTABLE, async (req,res) => {
  await db.query("INSERT INTO meses_cerrados (empresa_id,mes) VALUES ($1,$2) ON CONFLICT DO NOTHING",[EID(req),req.params.mes]);
  res.json({ok:true});
});
router.delete("/meses-cerrados/:mes", GERENTE_O_CONTABLE, async (req,res) => {
  await db.query("DELETE FROM meses_cerrados WHERE empresa_id=$1 AND mes=$2",[EID(req),req.params.mes]);
  res.json({ok:true});
});

// ════════════════════════════════════════════════════════════
// GASOIL CONFIG por vehículo
// ════════════════════════════════════════════════════════════
router.get("/gasoil-config/:vehiculo_id", async (req,res) => {
  try {
    const {rows} = await db.query("SELECT * FROM vehiculo_gasoil_config WHERE vehiculo_id=$1",[req.params.vehiculo_id]);
    res.json(rows[0] || {tipo:"fijo",precio_fijo:1.65,periodos:[]});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/gasoil-config/:vehiculo_id", async (req,res) => {
  try {
    const {tipo,precio_fijo,periodos} = req.body;
    await db.query(
      `INSERT INTO vehiculo_gasoil_config (vehiculo_id,empresa_id,tipo,precio_fijo,periodos,updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (vehiculo_id) DO UPDATE SET tipo=$3,precio_fijo=$4,periodos=$5,updated_at=NOW()`,
      [req.params.vehiculo_id,EID(req),tipo||"fijo",precio_fijo||1.65,JSON.stringify(periodos||[])]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// REPOSTAJES
// ════════════════════════════════════════════════════════════
router.get("/repostajes/:vehiculo_id", async (req,res) => {
  try {
    const {rows} = await db.query(
      "SELECT * FROM vehiculo_repostajes WHERE vehiculo_id=$1 ORDER BY fecha DESC",
      [req.params.vehiculo_id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post("/repostajes/:vehiculo_id", async (req,res) => {
  try {
    const {fecha,litros,precio_litro,importe,km_odometro,notas} = req.body;
    const {rows} = await db.query(
      "INSERT INTO vehiculo_repostajes (vehiculo_id,empresa_id,fecha,litros,precio_litro,importe,km_odometro,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [req.params.vehiculo_id,EID(req),fecha,litros||0,precio_litro||null,importe||null,km_odometro||null,notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/repostajes/:id", async (req,res) => {
  await db.query("DELETE FROM vehiculo_repostajes WHERE id=$1",[req.params.id]);
  res.json({ok:true});
});

// ════════════════════════════════════════════════════════════
// NOCHES / DIETAS
// ════════════════════════════════════════════════════════════
router.get("/noches/:vehiculo_id", async (req,res) => {
  try {
    const {desde,hasta} = req.query;
    let q = "SELECT n.*, ch.nombre AS chofer_nombre FROM vehiculo_noches n LEFT JOIN choferes ch ON ch.id=n.chofer_id WHERE n.vehiculo_id=$1";
    const params = [req.params.vehiculo_id];
    if (desde) { q += " AND n.fecha>=$2"; params.push(desde); }
    if (hasta) { q += ` AND n.fecha<=$${params.length+1}`; params.push(hasta); }
    q += " ORDER BY n.fecha DESC";
    const {rows} = await db.query(q,params);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post("/noches/:vehiculo_id", async (req,res) => {
  try {
    const {fecha,chofer_id,pedido_id,ciudad,importe,notas} = req.body;
    const {rows} = await db.query(
      "INSERT INTO vehiculo_noches (vehiculo_id,empresa_id,fecha,chofer_id,pedido_id,ciudad,importe,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [req.params.vehiculo_id,EID(req),fecha,chofer_id||null,pedido_id||null,ciudad||null,importe||0,notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/noches/:id", async (req,res) => {
  await db.query("DELETE FROM vehiculo_noches WHERE id=$1",[req.params.id]);
  res.json({ok:true});
});

// ════════════════════════════════════════════════════════════
// CONFIGURACIÓN CHÓFER
// ════════════════════════════════════════════════════════════
router.get("/chofer-config/:chofer_id", async (req,res) => {
  try {
    const {rows} = await db.query("SELECT * FROM chofer_config WHERE chofer_id=$1",[req.params.chofer_id]);
    res.json(rows[0] || {salario_base:0,precio_noche:40,plus_actividad:0,incentivo_pct:0,irpf_pct:0,ss_empresa_pct:29.9,ss_trabajador_pct:6.35});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/chofer-config/:chofer_id", async (req,res) => {
  try {
    const {salario_base,precio_noche,plus_actividad,irpf_pct,ss_empresa_pct,ss_trabajador_pct,convenio,incentivo_pct} = req.body;
    await db.query(
      `INSERT INTO chofer_config (chofer_id,empresa_id,salario_base,precio_noche,plus_actividad,irpf_pct,ss_empresa_pct,ss_trabajador_pct,convenio,incentivo_pct,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (chofer_id) DO UPDATE SET salario_base=$3,precio_noche=$4,plus_actividad=$5,irpf_pct=$6,ss_empresa_pct=$7,ss_trabajador_pct=$8,convenio=$9,incentivo_pct=$10,updated_at=NOW()`,
      [req.params.chofer_id,EID(req),salario_base||null,precio_noche||40,plus_actividad||0,irpf_pct||0,ss_empresa_pct||29.9,ss_trabajador_pct||6.35,convenio||null,incentivo_pct||0]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// NÓMINAS EMITIDAS
// ════════════════════════════════════════════════════════════
router.get("/nominas-emitidas", async (req,res) => {
  try {
    const {chofer_id} = req.query;
    let q = `SELECT n.*, ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos
             FROM nominas_emitidas n
             LEFT JOIN choferes ch ON ch.id=n.chofer_id
             WHERE n.empresa_id=$1`;
    const params = [EID(req)];
    if (chofer_id) { q += " AND n.chofer_id=$2"; params.push(chofer_id); }
    q += " ORDER BY n.periodo DESC, ch.nombre";
    const {rows} = await db.query(q,params);
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post("/nominas-emitidas", GERENTE_O_CONTABLE, async (req,res) => {
  try {
    const {chofer_id,periodo,salario_base,plus_actividad,horas_extra,noches,importe_noches,
           ss_empresa,ss_trabajador,irpf,liquido,total_empresa,notas} = req.body;
    const {rows} = await db.query(
      `INSERT INTO nominas_emitidas (empresa_id,chofer_id,periodo,salario_base,plus_actividad,horas_extra,
        noches,importe_noches,ss_empresa,ss_trabajador,irpf,liquido,total_empresa,notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (empresa_id,chofer_id,periodo) DO UPDATE SET
         salario_base=$4,plus_actividad=$5,horas_extra=$6,noches=$7,importe_noches=$8,
         ss_empresa=$9,ss_trabajador=$10,irpf=$11,liquido=$12,total_empresa=$13,notas=$14,
         emitida_at=NOW()
       RETURNING *`,
      [EID(req),chofer_id,periodo,salario_base||0,plus_actividad||0,horas_extra||0,
       noches||0,importe_noches||0,ss_empresa||0,ss_trabajador||0,irpf||0,liquido||0,total_empresa||0,notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/nominas-emitidas/:id", GERENTE_O_CONTABLE, async (req,res) => {
  await db.query("DELETE FROM nominas_emitidas WHERE id=$1 AND empresa_id=$2",[req.params.id,EID(req)]);
  res.json({ok:true});
});

// ════════════════════════════════════════════════════════════
// OBJETIVOS KPI
// ════════════════════════════════════════════════════════════
router.get("/objetivos", async (req,res) => {
  try {
    const {rows} = await db.query("SELECT * FROM objetivos_kpi WHERE empresa_id=$1",[EID(req)]);
    // Return as object keyed by periodo
    const result = {};
    rows.forEach(r => { result[r.periodo] = r; });
    res.json(result);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/objetivos/:periodo", SOLO_GERENTE, async (req,res) => {
  try {
    const {facturacion,km_totales,pct_km_vacio,pedidos,coste_taller,margen} = req.body;
    await db.query(
      `INSERT INTO objetivos_kpi (empresa_id,periodo,facturacion,km_totales,pct_km_vacio,pedidos,coste_taller,margen,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (empresa_id,periodo) DO UPDATE SET
         facturacion=$3,km_totales=$4,pct_km_vacio=$5,pedidos=$6,coste_taller=$7,margen=$8,updated_at=NOW()`,
      [EID(req),req.params.periodo,facturacion||null,km_totales||null,pct_km_vacio||null,pedidos||null,coste_taller||null,margen||null]
    );
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// CONFIGURACIÓN EMPRESA (cfg_trafico, cfg_precios, cfg_alertas)
// ════════════════════════════════════════════════════════════
router.get("/config", async (req,res) => {
  try {
    const {rows} = await db.query(
      "SELECT cfg_trafico, cfg_precios, cfg_alertas FROM empresas WHERE id=$1",
      [EID(req)]
    );
    res.json(rows[0] || {cfg_trafico:{},cfg_precios:{},cfg_alertas:[]});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/config/trafico", async (req,res) => {
  try {
    await db.query("UPDATE empresas SET cfg_trafico=$1 WHERE id=$2",[JSON.stringify(req.body),EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/config/precios", async (req,res) => {
  try {
    await db.query("UPDATE empresas SET cfg_precios=$1 WHERE id=$2",[JSON.stringify(req.body),EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/config/alertas", async (req,res) => {
  try {
    await db.query("UPDATE empresas SET cfg_alertas=$1 WHERE id=$2",[JSON.stringify(req.body),EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;

// ════════════════════════════════════════════════════════════
// LOGO EMPRESA
// ════════════════════════════════════════════════════════════
router.post("/logo", async (req,res) => {
  try {
    const { logo_base64, logo_mime } = req.body;
    if (!logo_base64) return res.status(400).json({error:"Falta logo_base64"});
    // Validate size (max 500KB base64 ≈ 375KB file)
    if (logo_base64.length > 700000) return res.status(400).json({error:"El logo es demasiado grande (máx 500KB)"});
    await db.query(
      "UPDATE empresas SET logo_base64=$1, cfg_precios=jsonb_set(COALESCE(cfg_precios,'{}'),'{logo_mime}',$2) WHERE id=$3",
      [logo_base64, JSON.stringify(logo_mime||"image/png"), EID(req)]
    );
    res.json({ok:true, logo_base64});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete("/logo", async (req,res) => {
  try {
    await db.query("UPDATE empresas SET logo_base64=NULL WHERE id=$1",[EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get("/logo", async (req,res) => {
  try {
    const {rows} = await db.query("SELECT logo_base64, cfg_precios->>'logo_mime' AS logo_mime FROM empresas WHERE id=$1",[EID(req)]);
    res.json({logo_base64: rows[0]?.logo_base64||null, logo_mime: rows[0]?.logo_mime||"image/png"});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// DOCUMENTOS DE PEDIDO
// ════════════════════════════════════════════════════════════
router.get("/pedido-docs/:pedido_id", async (req,res) => {
  try {
    const {rows} = await db.query(
      "SELECT id,nombre,tipo,file_mime,file_size_kb,notas,created_at FROM pedido_docs WHERE pedido_id=$1 ORDER BY created_at",
      [req.params.pedido_id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET con base64 para un doc específico (para generar PDF adjunto)
router.get("/pedido-docs/:pedido_id/base64", async (req,res) => {
  try {
    const {rows} = await db.query(
      "SELECT * FROM pedido_docs WHERE pedido_id=$1 ORDER BY created_at",
      [req.params.pedido_id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post("/pedido-docs/:pedido_id", async (req,res) => {
  try {
    const {nombre,tipo,file_base64,file_mime,file_size_kb,notas} = req.body;
    if (!nombre || !file_base64) return res.status(400).json({error:"Faltan nombre o archivo"});
    if (file_base64.length > 5000000) return res.status(400).json({error:"Archivo demasiado grande (máx ~3MB)"});
    const {rows} = await db.query(
      "INSERT INTO pedido_docs (pedido_id,empresa_id,nombre,tipo,file_base64,file_mime,file_size_kb,notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,nombre,tipo,file_mime,file_size_kb,created_at",
      [req.params.pedido_id,EID(req),nombre,tipo||"otro",file_base64,file_mime||"application/pdf",file_size_kb||null,notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.delete("/pedido-docs/:doc_id", async (req,res) => {
  try {
    await db.query("DELETE FROM pedido_docs WHERE id=$1 AND empresa_id=$2",[req.params.doc_id,EID(req)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ════════════════════════════════════════════════════════════
// PERIODOS TRACTORA POR CHÓFER
// ════════════════════════════════════════════════════════════
router.get("/tractora-periodos/:chofer_id", async (req,res) => {
  try {
    const {rows} = await db.query(
      `SELECT p.*, v.matricula AS veh_matricula, v.marca, v.modelo,
              r.matricula AS rem_matricula
       FROM chofer_tractora_periodos p
       LEFT JOIN vehiculos v ON v.id=p.vehiculo_id
       LEFT JOIN vehiculos r ON r.id=p.remolque_id
       WHERE p.chofer_id=$1
       ORDER BY p.fecha_inicio DESC`,
      [req.params.chofer_id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post("/tractora-periodos", async (req,res) => {
  try {
    const {chofer_id,vehiculo_id,remolque_id,fecha_inicio,fecha_fin,notas} = req.body;
    // Cerrar período activo anterior para esta tractora+chófer
    await db.query(
      "UPDATE chofer_tractora_periodos SET fecha_fin=$1 WHERE chofer_id=$2 AND vehiculo_id=$3 AND fecha_fin IS NULL",
      [fecha_inicio, chofer_id, vehiculo_id]
    );
    const {rows} = await db.query(
      `INSERT INTO chofer_tractora_periodos (chofer_id,vehiculo_id,remolque_id,empresa_id,fecha_inicio,fecha_fin,notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [chofer_id,vehiculo_id,remolque_id||null,EID(req),fecha_inicio||new Date().toISOString().slice(0,10),fecha_fin||null,notas||null]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Docs de varios pedidos a la vez (para generar PDF adjunto de factura)
router.post("/pedido-docs-bulk", async (req,res) => {
  try {
    const {pedido_ids} = req.body;
    if (!Array.isArray(pedido_ids)||!pedido_ids.length) return res.json([]);
    const placeholders = pedido_ids.map((_,i)=>`$${i+2}`).join(",");
    const {rows} = await db.query(
      `SELECT d.*, p.numero AS pedido_numero, p.origen, p.destino
       FROM pedido_docs d
       JOIN pedidos p ON p.id=d.pedido_id
       WHERE d.pedido_id IN (${placeholders}) AND d.empresa_id=$1
       ORDER BY p.numero, d.tipo, d.created_at`,
      [EID(req), ...pedido_ids]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});
