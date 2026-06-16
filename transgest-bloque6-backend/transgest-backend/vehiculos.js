// src/routes/vehiculos.js
const express = require("express");
const db      = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const r1      = express.Router();
r1.use(authenticate);
r1.get("/", async (req,res)=>{
  const empresaId = req.empresaId||req.user?.empresa_id;
  const { activo } = req.query;
  let q = `SELECT v.*,
             r.matricula AS remolque_matricula, r.marca AS remolque_marca, r.modelo AS remolque_modelo,
             CONCAT(ch.nombre, CASE WHEN ch.apellidos IS NOT NULL AND ch.apellidos != '' THEN ' ' || ch.apellidos ELSE '' END) AS chofer_nombre
           FROM vehiculos v
           LEFT JOIN vehiculos r ON r.id = v.remolque_id
           LEFT JOIN choferes ch ON ch.id = v.chofer_id
           WHERE 1=1`;
  const params = [];
  if (empresaId) { q += " AND v.empresa_id=$"+(params.length+1); params.push(empresaId); }
  if (activo === "false") {
    q += " AND v.activo=false";
  } else if (activo === "todos") {
    // no filter
  } else {
    q += " AND v.activo=true";
  }
  q += " ORDER BY v.matricula";
  const {rows}=await db.query(q, params);
  res.json(rows);
});
r1.get("/:id", async (req,res)=>{ const {rows}=await db.query("SELECT * FROM vehiculos WHERE id=$1",[req.params.id]); if(!rows[0])return res.status(404).json({error:"No encontrado"}); res.json(rows[0]); });
r1.post("/", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const {matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg}=req.body;
    if (!matricula?.trim()) return res.status(400).json({error:"La matrícula es obligatoria"});
    const empresaId = req.empresaId||req.user.empresa_id;

    // Comprobar si ya existe (activo o dado de baja)
    const { rows: existe } = await db.query(
      "SELECT id, activo, estado FROM vehiculos WHERE UPPER(TRIM(matricula))=UPPER(TRIM($1)) AND empresa_id=$2",
      [matricula, empresaId]
    );
    if (existe[0]) {
      const v = existe[0];
      if (!v.activo || v.estado === "baja") {
        return res.status(409).json({
          error: `La matrícula "${matricula.toUpperCase()}" ya existe pero está dada de baja. Puedes reactivarla desde el filtro "Dados de baja" en Vehículos.`
        });
      }
      return res.status(409).json({
        error: `La matrícula "${matricula.toUpperCase()}" ya está registrada en el sistema. No se puede crear un vehículo duplicado.`
      });
    }

    const {rows}=await db.query(
      "INSERT INTO vehiculos (matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,empresa_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [matricula.trim().toUpperCase(),marca,modelo,año||null,tipo||"Camión",tara_kg||null,carga_max_kg||null,empresaId]
    );
    res.status(201).json(rows[0]);
  } catch(e) {
    // Por si acaso el UNIQUE de PostgreSQL se dispara igualmente
    if (e.code === "23505") {
      return res.status(409).json({error:"Esa matrícula ya existe en el sistema. No se puede crear un vehículo duplicado."});
    }
    res.status(500).json({error:e.message});
  }
});
r1.patch("/:id/estado", GERENTE_O_TRAFICO, async (req,res)=>{ const {rows}=await db.query("UPDATE vehiculos SET estado=$1 WHERE id=$2 RETURNING *",[req.body.estado,req.params.id]); res.json(rows[0]); });
r1.put("/:id", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const {matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,estado,km_actuales,activo,notas,chofer_id,clase}=req.body;
    const empresaId = req.empresaId||req.user?.empresa_id;
    // Comprobar duplicado en edición
    if (matricula) {
      const { rows: dup } = await db.query(
        "SELECT id FROM vehiculos WHERE UPPER(TRIM(matricula))=UPPER(TRIM($1)) AND empresa_id=$2 AND id<>$3",
        [matricula, empresaId, req.params.id]
      );
      if (dup[0]) return res.status(409).json({error:`La matrícula "${matricula.toUpperCase()}" ya está registrada en otro vehículo.`});
    }
    // Si se asigna un chófer, verificar que no esté ya asignado a otro vehículo
    if (chofer_id) {
      const { rows: chDup } = await db.query(
        "SELECT id, matricula FROM vehiculos WHERE chofer_id=$1 AND id<>$2 AND empresa_id=$3 AND activo=true",
        [chofer_id, req.params.id, empresaId]
      );
      if (chDup[0]) {
        return res.status(409).json({
          error: `Este chófer ya está asignado al vehículo ${chDup[0].matricula}. Desasígnalo primero.`
        });
      }
    }
    const {rows}=await db.query(
      `UPDATE vehiculos SET matricula=$1,marca=$2,modelo=$3,año=$4,tipo=$5,tara_kg=$6,
       carga_max_kg=$7,estado=$8,km_actuales=$9,activo=$10,notas=$11,chofer_id=$12,clase=$13
       WHERE id=$14 AND empresa_id=$15 RETURNING *`,
      [matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,estado,km_actuales,
       activo,notas,chofer_id||null,clase||null,req.params.id,empresaId]
    );
    if(!rows[0]) return res.status(404).json({error:"No encontrado"});
    res.json(rows[0]);
  } catch(e) {
    if (e.code==="23505") return res.status(409).json({error:"La matrícula ya existe en el sistema."});
    res.status(500).json({error:e.message});
  }
});
// PATCH /vehiculos/:id/remolque — asignar/desasignar remolque a tractora
r1.patch("/:id/remolque", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const { remolque_id } = req.body; // null para desasignar
    const { rows } = await db.query(
      "UPDATE vehiculos SET remolque_id=$1 WHERE id=$2 RETURNING *",
      [remolque_id||null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({error:"Vehículo no encontrado"});
    res.json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// DELETE /vehiculos/:id — dar de baja (soft) o eliminar definitivo (forzar, solo gerente)
r1.delete("/:id", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const empresaId = req.empresaId||req.user?.empresa_id;
    const forzar    = req.body?.forzar === true;

    // Solo gerente puede eliminar definitivamente
    if (forzar && req.user.rol !== "gerente") {
      return res.status(403).json({ error: "Solo el gerente puede eliminar vehículos definitivamente." });
    }

    // Comprobar pedidos activos
    const { rows: pedidos } = await db.query(
      "SELECT COUNT(*) FROM pedidos WHERE vehiculo_id=$1 AND estado NOT IN ('entregado','cancelado')",
      [req.params.id]
    );
    if (parseInt(pedidos[0].count) > 0) {
      return res.status(409).json({ error: "Este vehículo tiene pedidos activos. Finalízalos antes de continuar." });
    }

    if (forzar) {
      // Eliminación definitiva — desvincula pedidos históricos primero
      await db.query("UPDATE pedidos SET vehiculo_id=NULL WHERE vehiculo_id=$1", [req.params.id]);
      await db.query("DELETE FROM vehiculos WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
    } else {
      // Baja suave — queda en el historial
      const { rows } = await db.query(
        "UPDATE vehiculos SET activo=false, estado='baja' WHERE id=$1 AND empresa_id=$2 RETURNING id",
        [req.params.id, empresaId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Vehículo no encontrado" });
    }

    res.json({ ok: true, tipo: forzar ? "eliminado" : "baja" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /vehiculos/:id/reactivar
r1.patch("/:id/reactivar", GERENTE_O_TRAFICO, async (req,res)=>{
  const empresaId = req.empresaId||req.user?.empresa_id;
  await db.query("UPDATE vehiculos SET activo=true, estado='disponible' WHERE id=$1 AND empresa_id=$2",[req.params.id,empresaId]);
  res.json({ ok: true });
});

// ── PATCH /vehiculos/:id/km — actualizar km actuales ─────────────────────
r1.patch("/:id/km", GERENTE_O_TRAFICO, async (req, res) => {
  const { km_actuales } = req.body;
  if (!km_actuales || isNaN(km_actuales))
    return res.status(400).json({ error: "km_actuales requerido" });
  const empresaId = req.empresaId || req.user?.empresa_id;
  try {
    const { rows } = await db.query(
      `UPDATE vehiculos SET km_actuales=$1, updated_at=NOW()
       WHERE id=$2 AND empresa_id=$3 RETURNING id, matricula, km_actuales`,
      [Math.round(Number(km_actuales)), req.params.id, empresaId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Vehículo no encontrado" });
    res.json({ ok: true, vehiculo: rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /vehiculos/alertas — ITV, seguro vencidos/próximos ───────────────
r1.get("/alertas-doc", async (req, res) => {
  const empresaId = req.empresaId || req.user?.empresa_id;
  const hoy = new Date().toISOString().slice(0, 10);
  const en30 = new Date(Date.now() + 30*24*3600*1000).toISOString().slice(0, 10);
  try {
    const { rows } = await db.query(
      `SELECT id, matricula, km_actuales, fecha_itv, fecha_seguro, clase
       FROM vehiculos WHERE empresa_id=$1 AND activo=true`,
      [empresaId]
    );
    const alertas = rows.map(r => ({
      ...r,
      alerta_itv: r.fecha_itv ? (r.fecha_itv < hoy ? 'vencida' : r.fecha_itv <= en30 ? 'proxima' : null) : null,
      alerta_seguro: r.fecha_seguro ? (r.fecha_seguro < hoy ? 'vencido' : r.fecha_seguro <= en30 ? 'proximo' : null) : null,
      dias_itv: r.fecha_itv ? Math.round((new Date(r.fecha_itv)-new Date())/(1000*3600*24)) : null,
      dias_seguro: r.fecha_seguro ? Math.round((new Date(r.fecha_seguro)-new Date())/(1000*3600*24)) : null,
    })).filter(r => r.alerta_itv || r.alerta_seguro);
    res.json(alertas);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


module.exports = r1;
