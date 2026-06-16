#!/bin/bash
# ══════════════════════════════════════════════════════
# TransGest TMS — Backup automático PostgreSQL
# Se ejecuta via cron dentro del contenedor API
# ══════════════════════════════════════════════════════

set -euo pipefail

# Config desde variables de entorno
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-transgest}"
DB_USER="${DB_USER:-transgest_user}"
PGPASSWORD="${DB_PASSWORD:-}"
export PGPASSWORD

BACKUP_DIR="/app/backups"
MAX_BACKUPS="${MAX_BACKUPS:-30}"   # guardar últimos 30 días
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="transgest_backup_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando backup: $FILENAME"

# Ejecutar pg_dump + comprimir
pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-password \
  --format=plain \
  --no-owner \
  --no-acl \
  | gzip > "$FILEPATH"

SIZE=$(du -sh "$FILEPATH" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup completado: $FILENAME ($SIZE)"

# Rotar backups: eliminar los más antiguos si superan MAX_BACKUPS
COUNT=$(ls -1 "$BACKUP_DIR"/transgest_backup_*.sql.gz 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$MAX_BACKUPS" ]; then
  TO_DELETE=$(ls -1t "$BACKUP_DIR"/transgest_backup_*.sql.gz | tail -n +$((MAX_BACKUPS+1)))
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Eliminando backups antiguos: $(echo "$TO_DELETE" | wc -l)"
  echo "$TO_DELETE" | xargs rm -f
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backups disponibles: $(ls -1 "$BACKUP_DIR"/transgest_backup_*.sql.gz 2>/dev/null | wc -l)"
