// src/routes/colaboradores.js
const express = require("express");
const db      = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const router  = express.Router();
router.use(authenticate);
router.get("/",    async (req,res)=>{ const {rows}=await db.query("SELECT * FROM colaboradores WHERE activo=true ORDER BY nombre"); res.json(rows); });
router.post("/", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const {tipo,nombre,cif,email,telefono,iban,valoracion,notas,direccion}=req.body;
    const empresaId=req.empresaId||req.user.empresa_id;
    const {rows}=await db.query(
      "INSERT INTO colaboradores (tipo,nombre,cif,email,telefono,iban,valoracion,notas,empresa_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [tipo||"autonomo",nombre,cif||null,email||null,telefono||null,iban||null,valoracion||5,notas||null,empresaId]
    );
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/:id", GERENTE_O_TRAFICO, async (req,res)=>{
  const {tipo,nombre,cif,email,telefono,iban,activo,notas,
         calle,num_ext,codigo_postal,ciudad,provincia,
         contacto_nombre,contacto_telefono,forma_pago}=req.body;
  try {
    const {rows}=await db.query(
      `UPDATE colaboradores SET
        tipo=$1,nombre=$2,cif=$3,email=$4,telefono=$5,iban=$6,activo=$7,notas=$8,
        calle=$9,num_ext=$10,codigo_postal=$11,ciudad=$12,provincia=$13,
        contacto_nombre=$14,contacto_telefono=$15,forma_pago=$16
       WHERE id=$17 RETURNING *`,
      [tipo,nombre,cif||null,email||null,telefono||null,iban||null,
       activo!==undefined?activo:true,notas||null,
       calle||null,num_ext||null,codigo_postal||null,ciudad||null,provincia||null,
       contacto_nombre||null,contacto_telefono||null,forma_pago||null,
       req.params.id]);
    if(!rows[0])return res.status(404).json({error:"No encontrado"});
    res.json(rows[0]);
  } catch(e) {
    // Fallback if new columns don't exist yet
    if(e.code==='42703') {
      const {rows}=await db.query(
        "UPDATE colaboradores SET tipo=$1,nombre=$2,cif=$3,email=$4,telefono=$5,iban=$6,activo=$7,notas=$8 WHERE id=$9 RETURNING *",
        [tipo,nombre,cif||null,email||null,telefono||null,iban||null,activo!==undefined?activo:true,notas||null,req.params.id]);
      return res.json(rows[0]);
    }
    throw e;
  }
});
module.exports = router;

// ── Vehículos de colaboradores ────────────────────────────────────────────
router.get("/:id/vehiculos", async (req,res)=>{
  try {
    const {rows}=await db.query(
      "SELECT * FROM colaborador_vehiculos WHERE colaborador_id=$1 AND activo=true ORDER BY matricula",
      [req.params.id]
    );
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.post("/:id/vehiculos", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const empresaId = req.empresaId||req.user.empresa_id;
    const {matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,bastidor,num_ejes,longitud_m,notas,
           doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc}=req.body;
    if(!matricula) return res.status(400).json({error:"Matrícula obligatoria"});
    const {rows}=await db.query(
      `INSERT INTO colaborador_vehiculos
        (colaborador_id,empresa_id,matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,bastidor,
         num_ejes,longitud_m,notas,doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [req.params.id,empresaId,matricula,marca||null,modelo||null,año||null,tipo||"Camión",
       tara_kg||null,carga_max_kg||null,bastidor||null,num_ejes||2,longitud_m||null,notas||null,
       doc_tarjeta_transp||null,doc_tarjeta_exp||null,doc_seguro_venc||null,doc_itv_venc||null,doc_tacografo_venc||null]
    );
    res.status(201).json(rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.put("/:id/vehiculos/:vid", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const {matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,bastidor,num_ejes,longitud_m,notas,
           doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc}=req.body;
    const {rows}=await db.query(
      `UPDATE colaborador_vehiculos SET
        matricula=$1,marca=$2,modelo=$3,año=$4,tipo=$5,tara_kg=$6,carga_max_kg=$7,bastidor=$8,
        num_ejes=$9,longitud_m=$10,notas=$11,doc_tarjeta_transp=$12,doc_tarjeta_exp=$13,
        doc_seguro_venc=$14,doc_itv_venc=$15,doc_tacografo_venc=$16
       WHERE id=$17 AND colaborador_id=$18 RETURNING *`,
      [matricula,marca||null,modelo||null,año||null,tipo||"Camión",tara_kg||null,carga_max_kg||null,
       bastidor||null,num_ejes||2,longitud_m||null,notas||null,doc_tarjeta_transp||null,
       doc_tarjeta_exp||null,doc_seguro_venc||null,doc_itv_venc||null,doc_tacografo_venc||null,
       req.params.vid,req.params.id]
    );
    if(!rows[0]) return res.status(404).json({error:"No encontrado"});
    res.json(rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.delete("/:id/vehiculos/:vid", GERENTE_O_TRAFICO, async (req,res)=>{
  await db.query("UPDATE colaborador_vehiculos SET activo=false WHERE id=$1 AND colaborador_id=$2",
    [req.params.vid,req.params.id]);
  res.json({ok:true});
});
