// src/routes/usuarios.js
const express  = require("express");
const bcrypt   = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const db       = require("../services/db");
const { authenticate, SOLO_GERENTE } = require("../middleware/auth");
const router   = express.Router();
router.use(authenticate, SOLO_GERENTE);

router.get("/", async (req,res) => {
  const { rows } = await db.query("SELECT id,nombre,email,rol,activo,ultimo_acceso,created_at FROM usuarios ORDER BY nombre");
  res.json(rows);
});

router.post("/",
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min:8 }).withMessage("Mínimo 8 caracteres"),
  body("rol").isIn(["gerente","contable","trafico","visualizador","chofer"]),
  async (req,res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nombre, email, password, rol } = req.body;
    const empresaId = req.empresaId || req.user?.empresa_id;
    const hash = await bcrypt.hash(password, 12);
    try {
      const { rows } = await db.query(
        "INSERT INTO usuarios (nombre,email,password_hash,rol,empresa_id) VALUES ($1,$2,$3,$4,$5) RETURNING id,nombre,email,rol",
        [nombre, email, hash, rol, empresaId]
      );
      res.status(201).json(rows[0]);
    } catch(e) {
      if (e.code === '23505') return res.status(409).json({ error: "Ya existe un usuario con ese email" });
      throw e;
    }
  }
);

router.patch("/:id", async (req,res) => {
  const { nombre, rol, activo } = req.body;
  const { rows } = await db.query(
    "UPDATE usuarios SET nombre=COALESCE($1,nombre), rol=COALESCE($2,rol), activo=COALESCE($3,activo) WHERE id=$4 RETURNING id,nombre,email,rol,activo",
    [nombre, rol, activo, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error:"Usuario no encontrado" });
  res.json(rows[0]);
});

// Reset password por gerente
router.post("/:id/reset-password",
  body("password_nuevo").isLength({ min:8 }),
  async (req,res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const hash = await bcrypt.hash(req.body.password_nuevo, 12);
    await db.query("UPDATE usuarios SET password_hash=$1 WHERE id=$2", [hash, req.params.id]);
    res.json({ ok:true });
  }
);

module.exports = router;
