#!/bin/bash
# Usage: ./restore-db.sh backups/agenthub-db-20260524-120000.dump
# Restores a pg_dump -Fc custom-format backup created by backup-db.sh.
set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-agenthub}"
DB_NAME="${DB_NAME:-agenthub}"

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

echo "[$(date)] Restoring from: $BACKUP_FILE"
echo "  Target: $DB_HOST:$DB_PORT/$DB_NAME as $DB_USER"

# Restore custom-format dump (matches pg_dump -Fc from backup-db.sh)
docker exec -i agenthub-postgres pg_restore \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --clean --if-exists --no-owner --no-acl \
    < "$BACKUP_FILE"

echo "[$(date)] Restore complete."
