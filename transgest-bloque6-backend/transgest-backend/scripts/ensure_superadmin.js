require("dotenv").config();

const bcrypt = require("bcryptjs");
const db = require("../src/services/db");

const DEFAULT_EMAIL = "admin@transgest.local";
const DEFAULT_PASSWORD = "admin1234";
const DEFAULT_NAME = "Maestro";

async function main() {
  const email = String(process.env.SUPERADMIN_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();
  const password = String(process.env.SUPERADMIN_PASSWORD || DEFAULT_PASSWORD);
  const nombre = String(process.env.SUPERADMIN_NAME || DEFAULT_NAME).trim() || DEFAULT_NAME;
  const rol = String(process.env.SUPERADMIN_ROLE || "superadmin").trim() || "superadmin";

  if (process.env.NODE_ENV === "production" && (!process.env.SUPERADMIN_EMAIL || !process.env.SUPERADMIN_PASSWORD)) {
    throw new Error("En produccion SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD son obligatorios; no se permiten credenciales por defecto");
  }

  if (!email.includes("@")) {
    throw new Error("SUPERADMIN_EMAIL debe ser un email valido");
  }
  if (password.length < 8) {
    throw new Error("SUPERADMIN_PASSWORD debe tener al menos 8 caracteres");
  }
  if (!["superadmin", "soporte", "facturacion"].includes(rol)) {
    throw new Error("SUPERADMIN_ROLE debe ser superadmin, soporte o facturacion");
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS superadmins (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email VARCHAR(200) NOT NULL UNIQUE,
      password_hash VARCHAR(200) NOT NULL,
      nombre VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query("ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS rol VARCHAR(30) DEFAULT 'superadmin'");
  await db.query("ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true");

  const hash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO superadmins (email, password_hash, nombre, rol, activo)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (email)
     DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       nombre = EXCLUDED.nombre,
       rol = EXCLUDED.rol,
       activo = true`,
    [email, hash, nombre, rol]
  );

  console.log(`Superadmin listo: ${email}`);
}

main()
  .then(() => db.pool.end())
  .catch(async (err) => {
    console.error("Error preparando superadmin:", err.message);
    try {
      await db.pool.end();
    } catch (_) {
      // Ignore shutdown errors.
    }
    process.exit(1);
  });
