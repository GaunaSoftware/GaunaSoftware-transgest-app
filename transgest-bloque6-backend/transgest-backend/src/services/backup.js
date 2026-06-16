const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const logger = require("./logger");
const db = require("./db");

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
const MAX_BACKUPS = Number(process.env.MAX_BACKUPS || 30);
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const JSON_FALLBACK_ENABLED = process.env.BACKUP_JSON_FALLBACK !== "false";

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "_");
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return path.resolve(BACKUP_DIR);
}

function fileExistsExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return fs.existsSync(file);
  }
}

function findInPath(binary) {
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binary.endsWith(ext.toLowerCase()) || binary.endsWith(ext) ? binary : binary + ext.toLowerCase());
      if (fileExistsExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function findWindowsPgDump() {
  if (process.platform !== "win32") return null;
  const roots = [
    "C:\\Program Files\\PostgreSQL",
    "C:\\Program Files (x86)\\PostgreSQL",
  ];
  const candidates = [];
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(root, entry.name, "bin", "pg_dump.exe"));
        }
      }
    } catch {}
  }
  candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return candidates.find(fileExistsExecutable) || null;
}

function resolvePgDumpBin() {
  if (process.env.PG_DUMP_BIN) {
    if (fileExistsExecutable(process.env.PG_DUMP_BIN)) return process.env.PG_DUMP_BIN;
    const fromPath = findInPath(process.env.PG_DUMP_BIN);
    if (fromPath) return fromPath;
    return null;
  }
  return findInPath(process.platform === "win32" ? "pg_dump.exe" : "pg_dump") || findWindowsPgDump();
}

function getBackupStatus() {
  const dir = ensureBackupDir();
  const pgDumpBin = resolvePgDumpBin();
  const backups = listBackups();
  const degraded = !pgDumpBin && JSON_FALLBACK_ENABLED;
  const configured = Boolean(pgDumpBin) || JSON_FALLBACK_ENABLED;
  return {
    configured,
    degraded,
    mode: pgDumpBin ? "pg_dump" : "json_fallback",
    pg_dump_bin: pgDumpBin || null,
    backup_dir: dir,
    backups_count: backups.length,
    last_backup: backups[0] || null,
    message: pgDumpBin
      ? "Backups configurados"
      : JSON_FALLBACK_ENABLED
        ? "pg_dump no encontrado. Se usara backup JSON de contingencia."
        : "No se encontro pg_dump. Instala PostgreSQL client o configura PG_DUMP_BIN.",
  };
}

function isBackupName(filename) {
  return /^transgest_backup_[0-9T_\-]+\.dump$/.test(filename)
    || /^transgest_backup_[0-9T_\-]+\.sql\.gz$/.test(filename)
    || /^transgest_backup_[0-9T_\-]+\.json$/.test(filename);
}

function backupPath(filename) {
  if (!isBackupName(filename)) return null;
  const dir = ensureBackupDir();
  const full = path.resolve(dir, filename);
  return full.startsWith(dir + path.sep) ? full : null;
}

function rotateBackups() {
  const dir = ensureBackupDir();
  const now = Date.now();
  const maxAge = KEEP_DAYS > 0 ? KEEP_DAYS * 86400000 : null;
  const files = fs.readdirSync(dir)
    .filter(isBackupName)
    .map(name => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, full, mtime: stat.mtime, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files) {
    const byAge = maxAge && (now - file.mtime.getTime()) > maxAge;
    const byCount = files.indexOf(file) >= MAX_BACKUPS;
    if (byAge || byCount) {
      fs.unlinkSync(file.full);
      logger.info(`[Backup] Eliminado backup antiguo: ${file.name}`);
    }
  }
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function jsonReplacer(_key, value) {
  if (Buffer.isBuffer(value)) {
    return { type: "Buffer", encoding: "base64", data: value.toString("base64") };
  }
  return value;
}

async function runJsonBackup() {
  const dir = ensureBackupDir();
  const filename = `transgest_backup_${getTimestamp()}.json`;
  const filepath = path.join(dir, filename);

  logger.info(`[Backup] Iniciando backup JSON: ${filename}`);
  const { rows: tables } = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public'
      AND table_type='BASE TABLE'
    ORDER BY table_name
  `);

  const payload = {
    format: "transgest-json-backup",
    version: 1,
    created_at: new Date().toISOString(),
    database: process.env.DB_NAME || "transgest",
    tables: {},
  };

  for (const { table_name: tableName } of tables) {
    const quoted = quoteIdent(tableName);
    const { rows } = await db.query(`SELECT * FROM ${quoted}`);
    payload.tables[tableName] = {
      row_count: rows.length,
      rows,
    };
  }

  fs.writeFileSync(filepath, JSON.stringify(payload, jsonReplacer, 2), "utf8");
  const stat = fs.statSync(filepath);
  logger.info(`[Backup] JSON completado: ${filename} (${Math.round(stat.size / 1024)}KB)`);
  try { rotateBackups(); } catch (e) { logger.warn("[Backup] Rotacion fallida:", e.message); }
  return filename;
}

async function runBackup() {
  const {
    DB_HOST = "localhost",
    DB_PORT = "5432",
    DB_NAME = "transgest",
    DB_USER = "transgest_user",
    DB_PASSWORD = "",
  } = process.env;
  const PG_DUMP_BIN = resolvePgDumpBin();
  if (!PG_DUMP_BIN) {
    if (JSON_FALLBACK_ENABLED) return runJsonBackup();
    throw new Error("No se encontro pg_dump. Instala PostgreSQL client o configura PG_DUMP_BIN.");
  }

  const dir = ensureBackupDir();
  const filename = `transgest_backup_${getTimestamp()}.dump`;
  const filepath = path.join(dir, filename);
  const args = [
    "-h", DB_HOST,
    "-p", String(DB_PORT),
    "-U", DB_USER,
    "-d", DB_NAME,
    "--no-password",
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "-f", filepath,
  ];

  return new Promise((resolve, reject) => {
    logger.info(`[Backup] Iniciando backup: ${filename}`);
    let fallbackStarted = false;
    const child = spawn(PG_DUMP_BIN, args, {
      env: { ...process.env, PGPASSWORD: DB_PASSWORD },
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", err => {
      const message = err.code === "ENOENT"
        ? `No se encontro pg_dump. Configura PG_DUMP_BIN o instala PostgreSQL client.`
        : err.message;
      logger.error(`[Backup] Error: ${message}`);
      if (err.code === "ENOENT" && JSON_FALLBACK_ENABLED) {
        fallbackStarted = true;
        runJsonBackup().then(resolve).catch(reject);
        return;
      }
      reject(new Error(message));
    });
    child.on("close", code => {
      if (fallbackStarted) return;
      if (code !== 0) {
        try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch {}
        const message = stderr.trim() || `pg_dump termino con codigo ${code}`;
        logger.error(`[Backup] Error: ${message}`);
        reject(new Error(message));
        return;
      }

      const stat = fs.statSync(filepath);
      logger.info(`[Backup] Completado: ${filename} (${Math.round(stat.size / 1024)}KB)`);
      try { rotateBackups(); } catch (e) { logger.warn("[Backup] Rotacion fallida:", e.message); }
      resolve(filename);
    });
  });
}

function listBackups() {
  try {
    const dir = ensureBackupDir();
    return fs.readdirSync(dir)
      .filter(isBackupName)
      .map(filename => {
        const stat = fs.statSync(path.join(dir, filename));
        return {
          filename,
          type: filename.endsWith(".json") ? "json_fallback" : "pg_dump",
          size: stat.size,
          created: stat.mtime,
        };
      })
      .sort((a, b) => b.created - a.created);
  } catch(e) {
    return [];
  }
}

function startScheduler() {
  const status = getBackupStatus();
  if (!status.configured) {
    logger.warn(`[Backup] Desactivado: ${status.message}`);
    return;
  }

  try {
    const cron = require("node-cron");
    cron.schedule("0 3 * * *", async () => {
      try { await runBackup(); }
      catch(e) { logger.error("[Backup] Scheduled backup failed:", e.message); }
    });
    logger.info(`[Backup] Scheduler iniciado - backup diario a las 03:00 (${status.mode})`);
  } catch(e) {
    const MS_24H = 24 * 60 * 60 * 1000;
    setInterval(async () => {
      try { await runBackup(); }
      catch(err) { logger.error("[Backup] Scheduled backup failed:", err.message); }
    }, MS_24H);
    logger.info(`[Backup] Scheduler iniciado - backup cada 24h (${status.mode})`);
  }

  const backups = listBackups();
  if (backups.length === 0) {
    logger.info("[Backup] No hay backups previos - ejecutando backup inicial...");
    setTimeout(() => {
      runBackup().catch(e => logger.warn("[Backup] Backup inicial fallo:", e.message));
    }, 10000);
  }
}

module.exports = { runBackup, listBackups, startScheduler, backupPath, rotateBackups, getBackupStatus };
