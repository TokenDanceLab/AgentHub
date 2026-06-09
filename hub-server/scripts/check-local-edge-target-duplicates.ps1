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

$psqlCommand = Get-Command -Name $Psql -ErrorAction SilentlyContinue
if ($null -eq $psqlCommand) {
    Write-Error "psql executable was not found. Install PostgreSQL client tools or pass -Psql."
    exit 127
}
$psqlPath = if (-not [string]::IsNullOrWhiteSpace($psqlCommand.Path)) { $psqlCommand.Path } else { $psqlCommand.Source }

function ConvertTo-LibpqEnvironment {
    param([string]$ConnectionUrl)

    try {
        $uri = [System.Uri]::new($ConnectionUrl)
    } catch {
        Write-Error "Database URL is not a valid URI."
        exit 1
    }

    if ($uri.Scheme -ne "postgres" -and $uri.Scheme -ne "postgresql") {
        Write-Error "Database URL must use the postgres or postgresql scheme."
        exit 1
    }

    $databaseName = $uri.AbsolutePath.TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($databaseName)) {
        Write-Error "Database URL must include a database name."
        exit 1
    }

    $result = @{
        PGHOST = $uri.Host
        PGDATABASE = [System.Uri]::UnescapeDataString($databaseName)
    }

    if (-not $uri.IsDefaultPort) {
        $result.PGPORT = [string]$uri.Port
    }

    if (-not [string]::IsNullOrWhiteSpace($uri.UserInfo)) {
        $parts = $uri.UserInfo.Split(":", 2)
        if ($parts.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($parts[0])) {
            $result.PGUSER = [System.Uri]::UnescapeDataString($parts[0])
        }
        if ($parts.Count -gt 1) {
            $result.PGPASSWORD = [System.Uri]::UnescapeDataString($parts[1])
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($uri.Query)) {
        foreach ($pair in $uri.Query.TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
            $parts = $pair.Split("=", 2)
            $key = [System.Uri]::UnescapeDataString($parts[0])
            if ($key -eq "sslmode" -and $parts.Count -gt 1 -and -not [string]::IsNullOrWhiteSpace($parts[1])) {
                $result.PGSSLMODE = [System.Uri]::UnescapeDataString($parts[1])
            }
        }
    }

    return $result
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
    "--command", $sql
)

$libpqEnv = ConvertTo-LibpqEnvironment -ConnectionUrl $DatabaseUrl
$savedEnv = @{}
foreach ($key in @("DATABASE_URL", "PGCONNECT_TIMEOUT", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE")) {
    $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}

try {
    $env:DATABASE_URL = $DatabaseUrl
    if ([string]::IsNullOrWhiteSpace($env:PGCONNECT_TIMEOUT)) {
        $env:PGCONNECT_TIMEOUT = "10"
    }
    foreach ($entry in $libpqEnv.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }

    $output = & $psqlPath @psqlArgs 2>&1
    $psqlExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
} finally {
    foreach ($entry in $savedEnv.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
}

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
