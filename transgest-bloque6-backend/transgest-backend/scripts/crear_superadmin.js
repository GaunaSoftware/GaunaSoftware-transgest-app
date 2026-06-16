// ── Crear primer usuario superadmin ──────────────────
// Uso: node scripts/crear_superadmin.js
// Pide email y contraseña por línea de comandos
require("dotenv").config();
const bcrypt = require("bcryptjs");
const db     = require("../src/services/db");
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) { return new Promise(r => rl.question(q, r)); }

async function main() {
  console.log("\n🔐 Crear superadmin de TransGest\n");

  // Check if table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS superadmins (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email         VARCHAR(200) NOT NULL UNIQUE,
      password_hash VARCHAR(200) NOT NULL,
      nombre        VARCHAR(200),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existing = await db.query("SELECT COUNT(*) FROM superadmins");
  if (parseInt(existing.rows[0].count) > 0) {
    console.log("⚠️  Ya existe un superadmin. ¿Crear otro de todas formas? (s/n)");
    const resp = await ask("> ");
    if (resp.toLowerCase() !== "s") { rl.close(); process.exit(0); }
  }

  const nombre = await ask("Nombre: ");
  const email  = await ask("Email: ");
  const pass   = await ask("Contraseña (mín. 8 caracteres): ");

  if (!email || !pass || pass.length < 8) {
    console.error("❌ Email y contraseña son obligatorios (mín. 8 caracteres)");
    rl.close(); process.exit(1);
  }

  const hash = await bcrypt.hash(pass, 12);
  await db.query(
    "INSERT INTO superadmins (email, password_hash, nombre) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET password_hash=$2, nombre=$3",
    [email, hash, nombre || email]
  );

  console.log(`\n✅ Superadmin creado: ${email}`);
  console.log(`   Accede en: https://tudominio.com/superadmin\n`);
  rl.close();
  process.exit(0);
}

main().catch(e => { console.error("Error:", e.message); rl.close(); process.exit(1); });
