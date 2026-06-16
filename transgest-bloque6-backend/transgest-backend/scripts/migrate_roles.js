require("dotenv").config();
const db = require("../src/services/db");

async function run(){
  console.log("Adding chofer/cliente roles to enum...");
  try{
    await db.query("ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'chofer'");
    await db.query("ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'cliente'");
    console.log("✓ Roles added");

    // Add demo chofer and cliente users
    const bcrypt = require("bcryptjs");
    const pass = await bcrypt.hash("demo1234", 12);
    await db.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
        ('Juan García', 'chofer@empresa.com', $1, 'chofer'),
        ('Transportes García', 'cliente@empresa.com', $1, 'cliente')
      ON CONFLICT (email) DO NOTHING
    `, [pass]);
    console.log("✓ Demo chofer/cliente users created");
    console.log("  chofer@empresa.com  / demo1234");
    console.log("  cliente@empresa.com / demo1234");
  }catch(e){ console.error(e.message); }
  process.exit(0);
}
run();
