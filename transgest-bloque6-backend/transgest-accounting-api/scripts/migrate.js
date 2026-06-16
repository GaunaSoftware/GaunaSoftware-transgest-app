require("../src/resolveWorkspaceModules");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../src/services/db");
const config = require("../src/services/config");

const direction = process.argv[2] || "up";
const migrationsDir = path.join(__dirname, "migrations");

function checksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function migrationId(file) {
  return path.basename(file, ".sql");
}

async function ensureSchemaMigrations(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${config.schema}"`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${config.schema}".schema_migrations (
      id VARCHAR(180) PRIMARY KEY,
      name VARCHAR(220) NOT NULL,
      checksum VARCHAR(80) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function readSql(file) {
  return fs.readFileSync(path.join(migrationsDir, file), "utf8");
}

async function migrateUp() {
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith(".up.sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const id = migrationId(file).replace(/\.up$/, "");
    const sql = readSql(file);
    const hash = checksum(sql);
    await db.transaction(async client => {
      await ensureSchemaMigrations(client);
      const { rows } = await client.query(`SELECT checksum FROM "${config.schema}".schema_migrations WHERE id=$1`, [id]);
      if (rows[0]?.checksum === hash) {
        console.log(`OK ${id} ya aplicada`);
        return;
      }
      if (rows[0]) throw new Error(`La migracion ${id} ya fue aplicada con otro checksum.`);
      await client.query(sql);
      await client.query(
        `INSERT INTO "${config.schema}".schema_migrations (id,name,checksum) VALUES ($1,$2,$3)`,
        [id, file, hash]
      );
      console.log(`APLICADA ${id}`);
    });
  }
}

async function migrateDown() {
  const applied = await db.transaction(async client => {
    await ensureSchemaMigrations(client);
    const { rows } = await client.query(`SELECT id FROM "${config.schema}".schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1`);
    return rows[0];
  });
  if (!applied) {
    console.log("No hay migraciones contables para revertir.");
    return;
  }

  const downFile = `${applied.id}.down.sql`;
  if (!fs.existsSync(path.join(migrationsDir, downFile))) {
    throw new Error(`No existe rollback para ${applied.id}`);
  }
  const sql = readSql(downFile);
  await db.transaction(async client => {
    await client.query(sql);
    await client.query(`DELETE FROM "${config.schema}".schema_migrations WHERE id=$1`, [applied.id]);
  });
  console.log(`REVERTIDA ${applied.id}`);
}

async function run() {
  if (!["up", "down"].includes(direction)) throw new Error("Uso: node scripts/migrate.js up|down");
  if (!fs.existsSync(migrationsDir)) throw new Error("No existe scripts/migrations");
  if (direction === "up") await migrateUp();
  else await migrateDown();
}

run()
  .catch(err => {
    console.error("Error en migraciones contables:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
