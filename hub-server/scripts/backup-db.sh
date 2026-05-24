#!/bin/bash
# PostgreSQL backup script for AgentHub
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DB_NAME="${DB_NAME:-agenthub}"
DB_USER="${DB_USER:-agenthub}"
DB_HOST="${DB_HOST:-localhost}"
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/agenthub_$TIMESTAMP.sql.gz"

pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" | gzip > "$FILE"
echo "Backup: $FILE"

# Clean old backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "Cleaned backups older than $RETENTION_DAYS days"
