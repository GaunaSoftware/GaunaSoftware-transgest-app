#!/bin/bash
# TransGest TMS — Restaurar backup
# Uso: ./restore.sh transgest_backup_20240315_030000.sql.gz

set -euo pipefail

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "Uso: $0 <archivo_backup.sql.gz>"
  echo "Backups disponibles:"
  ls -lht /app/backups/transgest_backup_*.sql.gz 2>/dev/null | head -10
  exit 1
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-transgest}"
DB_USER="${DB_USER:-transgest_user}"
export PGPASSWORD="${DB_PASSWORD:-}"

if [ ! -f "$BACKUP_FILE" ]; then
  BACKUP_FILE="/app/backups/$BACKUP_FILE"
fi

echo "⚠️  ADVERTENCIA: Esto sobrescribirá la BD '$DB_NAME'"
echo "Restaurando desde: $BACKUP_FILE"
read -p "¿Confirmar? (escribe 'si' para continuar): " CONFIRM
[ "$CONFIRM" != "si" ] && echo "Cancelado" && exit 0

gunzip -c "$BACKUP_FILE" | psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-password

echo "✅ Restauración completada desde $BACKUP_FILE"
