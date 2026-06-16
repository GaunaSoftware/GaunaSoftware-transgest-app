require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../src/services/db");

const migrationsDir = path.join(__dirname, "migrations");

function checksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(180) PRIMARY KEY,
      name VARCHAR(220) NOT NULL,
      checksum VARCHAR(80) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function run() {
  if (!fs.existsSync(migrationsDir)) {
    console.log("No hay carpeta scripts/migrations. Nada que aplicar.");
    return;
  }

  await ensureTable();
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    console.log("No hay migraciones SQL pendientes.");
    return;
  }

  for (const file of files) {
    const id = path.basename(file, ".sql");
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, "utf8");
    const hash = checksum(sql);
    const { rows } = await db.query("SELECT checksum FROM schema_migrations WHERE id=$1", [id]);

    if (rows[0]?.checksum === hash) {
      console.log(`OK ${id} ya aplicada`);
      continue;
    }
    if (rows[0] && rows[0].checksum !== hash) {
      throw new Error(`La migracion ${id} ya fue aplicada con otro checksum. Crea una nueva migracion en vez de editarla.`);
    }

    await db.transaction(async client => {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (id,name,checksum) VALUES ($1,$2,$3)",
        [id, file, hash]
      );
    });
    console.log(`APLICADA ${id}`);
  }
}

run()
  .catch(err => {
    console.error("Error aplicando migraciones:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
