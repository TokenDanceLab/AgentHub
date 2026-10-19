#!/bin/bash
# AgentHub Hub Server — DB backup script (production)
# Cron example: 0 2 * * * BACKUP_DIR=/path/to/backups PG_PASSWORD=... /path/to/repo/hub-server/scripts/backup-db.sh
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:?set BACKUP_DIR}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5433}"
PG_USER="${PG_USER:-agenthub}"
PG_DB_NAME="${PG_DB_NAME:-agenthub}"
export PGPASSWORD="${PG_PASSWORD:?set PG_PASSWORD}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
echo "[$(date)] Starting DB backup..."
pg_dump -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -Fc "$PG_DB_NAME" > "$BACKUP_DIR/agenthub-db-$TIMESTAMP.dump"
echo "[$(date)] DB dump: $BACKUP_DIR/agenthub-db-$TIMESTAMP.dump"
docker exec agenthub-redis redis-cli -a "${AGENTHUB_REDIS_PASSWORD:-}" BGSAVE 2>/dev/null || true
echo "[$(date)] Redis BGSAVE triggered"
find "$BACKUP_DIR" -name "agenthub-db-*.dump" -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
SIZE=$(du -h "$BACKUP_DIR/agenthub-db-$TIMESTAMP.dump" | cut -f1)
echo "[$(date)] Backup complete — $SIZE | dir: $BACKUP_DIR"
