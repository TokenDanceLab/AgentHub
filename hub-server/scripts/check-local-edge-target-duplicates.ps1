#!/usr/bin/env pwsh
param(
    [string]$DatabaseUrl = "",
    [string]$Psql = "psql"
)

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    if (-not [string]::IsNullOrWhiteSpace($env:AGENTHUB_DATABASE_URL)) {
        $DatabaseUrl = $env:AGENTHUB_DATABASE_URL
    } elseif (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
        $DatabaseUrl = $env:DATABASE_URL
    }
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    Write-Error "Set AGENTHUB_DATABASE_URL or DATABASE_URL, or pass -DatabaseUrl."
    exit 1
}

$sql = @'
WITH duplicate_local_edge_targets AS (
    SELECT
        owner_id,
        device_id,
        string_agg(id::text, ',' ORDER BY id::text) AS target_ids,
        COUNT(*) AS target_count
    FROM execution_targets
    WHERE deleted_at IS NULL
      AND target_type = 'local_edge'
      AND device_id IS NOT NULL
    GROUP BY owner_id, device_id
    HAVING COUNT(*) > 1
)
SELECT owner_id, device_id, target_ids, target_count
FROM duplicate_local_edge_targets
ORDER BY owner_id, device_id;
'@

$psqlArgs = @(
    "--no-align",
    "--tuples-only",
    "--field-separator", " | ",
    "--set", "ON_ERROR_STOP=1",
    $DatabaseUrl,
    "--command", $sql
)

$output = & $Psql @psqlArgs 2>&1
$psqlExitCode = $LASTEXITCODE
if ($psqlExitCode -ne 0) {
    Write-Error "local_edge target duplicate preflight query failed."
    foreach ($line in $output) {
        Write-Error $line
    }
    exit $psqlExitCode
}

$rows = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($rows.Count -gt 0) {
    Write-Host "Duplicate active local_edge targets found. Resolve these rows before applying migration 0047."
    Write-Host "owner_id | device_id | target_ids | target_count"
    foreach ($row in $rows) {
        Write-Host $row
    }
    exit 2
}

Write-Host "No duplicate active local_edge targets found for migration 0047."
