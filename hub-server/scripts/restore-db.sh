#!/bin/bash
# Usage: ./restore-db.sh backups/agenthub_20260524_120000.sql.gz
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-agenthub}"
DB_NAME="${DB_NAME:-agenthub}"

if [ -z "$1" ]; then
    echo "Usage: $0 <backup-file.sql.gz>"
    exit 1
fi

gunzip -c "$1" | psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME"
