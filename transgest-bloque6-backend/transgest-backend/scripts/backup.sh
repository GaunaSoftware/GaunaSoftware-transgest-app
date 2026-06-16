#!/bin/sh
# ══════════════════════════════════════════════════════
# TRANSGEST — Backup automático PostgreSQL
# Ejecuta pg_dump diariamente a las 02:00 y 14:00
# Conserva los últimos BACKUP_KEEP_DAYS días
# ══════════════════════════════════════════════════════

BACKUP_DIR="/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

# Añadir tarea cron
echo "0 2,14 * * * /backup.sh run >> /var/log/backup.log 2>&1" | crontab -

do_backup() {
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  FILENAME="${BACKUP_DIR}/transgest_${TIMESTAMP}.sql.gz"

  echo "[$(date)] Iniciando backup → ${FILENAME}"

  pg_dump \
    -h "${DB_HOST}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --format=custom \
    --compress=9 \
    --no-password \
    | gzip > "${FILENAME}"

  if [ $? -eq 0 ]; then
    SIZE=$(du -sh "${FILENAME}" | cut -f1)
    echo "[$(date)] ✓ Backup completado: ${FILENAME} (${SIZE})"

    # Limpiar backups antiguos
    find "${BACKUP_DIR}" -name "transgest_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
    COUNT=$(find "${BACKUP_DIR}" -name "transgest_*.sql.gz" | wc -l)
    echo "[$(date)] Backups conservados: ${COUNT}"
  else
    echo "[$(date)] ✗ ERROR en backup"
    exit 1
  fi
}

# Arranque: backup inmediato + loop cron
if [ "$1" = "run" ]; then
  do_backup
else
  do_backup   # Backup al arrancar el contenedor
  crond -f -d 8
fi
