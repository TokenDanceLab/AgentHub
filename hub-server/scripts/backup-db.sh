#!/bin/bash
# AgentHub Hub Server — DB backup script (hk2 production)
# Cron: 0 2 * * * /opt/agenthub-hub/hub-server/scripts/backup-db.sh
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/opt/agenthub-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
echo "[$(date)] Starting DB backup..."
docker exec agenthub-postgres pg_dump -U agenthub -Fc agenthub > "$BACKUP_DIR/agenthub-db-$TIMESTAMP.dump"
echo "[$(date)] DB dump: $BACKUP_DIR/agenthub-db-$TIMESTAMP.dump"
docker exec agenthub-redis redis-cli -a "${AGENTHUB_REDIS_PASSWORD}" BGSAVE 2>/dev/null || true
echo "[$(date)] Redis BGSAVE triggered"
find "$BACKUP_DIR" -name "agenthub-db-*.dump" -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
SIZE=$(du -h "$BACKUP_DIR/agenthub-db-$TIMESTAMP.dump" | cut -f1)
echo "[$(date)] Backup complete — $SIZE | dir: $BACKUP_DIR"