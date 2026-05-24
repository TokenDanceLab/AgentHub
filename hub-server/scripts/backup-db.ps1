#!/usr/bin/env pwsh
# PostgreSQL backup script for AgentHub (PowerShell)
param(
    [string]$BackupDir = $env:BACKUP_DIR ?? "./backups",
    [string]$DbName = $env:DB_NAME ?? "agenthub",
    [string]$DbUser = $env:DB_USER ?? "agenthub",
    [string]$DbHost = $env:DB_HOST ?? "localhost",
    [int]$RetentionDays = 7
)

$null = New-Item -ItemType Directory -Force -Path $BackupDir
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$file = Join-Path $BackupDir "agenthub_$timestamp.sql.gz"

$env:PGPASSWORD = $env:PGPASSWORD
& pg_dump -h $DbHost -U $DbUser -d $DbName | gzip > $file
Write-Host "Backup: $file"

# Clean old backups
Get-ChildItem -Path $BackupDir -Filter "*.sql.gz" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    Remove-Item -Force
Write-Host "Cleaned backups older than $RetentionDays days"
