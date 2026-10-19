#!/bin/bash
# Usage: ./restore-db.sh backups/agenthub-db-20260524-120000.dump
# Restores a pg_dump -Fc custom-format backup created by backup-db.sh.
set -euo pipefail

PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5433}"
PG_USER="${PG_USER:-agenthub}"
PG_DB_NAME="${PG_DB_NAME:-agenthub}"

if [ -z "$1" ]; then
    echo "Usage: $0 <backup-file.dump>"
    echo ""
    echo "Restores a pg_dump -Fc custom-format backup to the database."
    echo "The target database must already exist. Existing objects are dropped"
    echo "before restore (--clean --if-exists)."
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

export PGPASSWORD="${PG_PASSWORD:?set PG_PASSWORD}"

echo "[$(date)] Restoring from: $BACKUP_FILE"
echo "  Target: $PG_HOST:$PG_PORT/$PG_DB_NAME as $PG_USER"

# Restore custom-format dump (matches pg_dump -Fc from backup-db.sh)
pg_restore \
    -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB_NAME" \
    --clean --if-exists --no-owner --no-acl \
    < "$BACKUP_FILE"

echo "[$(date)] Restore complete."
