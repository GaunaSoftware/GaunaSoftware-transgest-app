const express = require("express");
const db      = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const router  = express.Router();
router.use(authenticate);
router.get("/", async (req,res)=>{
  const empresaId = req.empresaId || req.user?.empresa_id;
  const { activo } = req.query;
  let q = `SELECT ch.*,
             v.matricula AS vehiculo_matricula,
             v.matricula AS vehiculo_matricula_display,
             v.remolque_id AS vehiculo_remolque_id,
             COALESCE(ch.apellidos,'') AS apellidos
           FROM choferes ch LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id WHERE 1=1`;
  const params = [];
  if (empresaId) { q += " AND ch.empresa_id=$"+(params.length+1); params.push(empresaId); }
  if (activo === "false") { q += " AND ch.activo=false"; }
  else if (activo === "todos") { /* no filter */ }
  else { q += " AND ch.activo=true"; }
  q += " ORDER BY ch.nombre";
  const {rows} = await db.query(q, params);
  res.json(rows);
});
router.get("/:id", async (req,res)=>{ const {rows}=await db.query("SELECT ch.*,v.matricula FROM choferes ch LEFT JOIN vehiculos v ON v.id=ch.vehiculo_id WHERE ch.id=$1",[req.params.id]); if(!rows[0])return res.status(404).json({error:"No encontrado"}); res.json(rows[0]); });
router.post("/", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const {nombre,dni,telefono,email,vehiculo_id,categoria_carnet,apellidos,tipo_contrato,salario,notas}=req.body;
    const empresaId = req.empresaId || req.user.empresa_id;
    const {rows}=await db.query(
      "INSERT INTO choferes (nombre,apellidos,dni,telefono,email,vehiculo_id,categoria_carnet,tipo_contrato,salario,notas,empresa_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [nombre,apellidos||null,dni||null,telefono||null,email||null,vehiculo_id||null,categoria_carnet||"C+E",tipo_contrato||null,salario||null,notas||null,empresaId]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/:id", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const {nombre,apellidos,dni,telefono,email,vehiculo_id,categoria_carnet,activo,notas,tipo_contrato,salario}=req.body;
    const empresaId = req.empresaId || req.user.empresa_id;
    const {rows}=await db.query(
      "UPDATE choferes SET nombre=$1,apellidos=$2,dni=$3,telefono=$4,email=$5,vehiculo_id=$6,categoria_carnet=$7,activo=$8,notas=$9,tipo_contrato=$10,salario=$11 WHERE id=$12 AND empresa_id=$13 RETURNING *",
      [nombre,apellidos||null,dni||null,telefono||null,email||null,vehiculo_id||null,categoria_carnet||"C+E",activo!==undefined?activo:true,notas||null,tipo_contrato||null,salario||null,req.params.id,empresaId]
    );
    if(!rows[0]) return res.status(404).json({error:"No encontrado"});
    res.json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
module.exports = router;
