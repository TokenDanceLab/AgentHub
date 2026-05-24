<#
.SYNOPSIS
    One-click dev start for AgentHub — starts Edge, Hub, and Desktop.
.DESCRIPTION
    Starts edge-server (go run), hub-server (go run), and Desktop dev server (pnpm dev).
    Each service runs in the background; press Ctrl+C to stop all.
    URLs: Edge=http://127.0.0.1:3210, Hub=http://127.0.0.1:4210, Desktop=http://localhost:5199
#>

$ErrorActionPreference = 'Stop'

# Resolve repo root (parent of the scripts/ directory)
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# Track started process IDs for cleanup
$Pids = [System.Collections.ArrayList]::new()

function Write-Banner($Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Magenta
}

function Write-Starting($Name) {
    Write-Host "  [$Name] Starting..." -ForegroundColor Cyan
}

function Write-Ready($Name, $Port) {
    Write-Host "  [$Name] Ready on port $Port" -ForegroundColor Green
}

function Write-Timeout($Name, $Port, $Sec) {
    Write-Host "  [$Name] TIMEOUT — port $Port did not become available in ${Sec}s" -ForegroundColor Red
}

function Start-ServiceProcess {
    param($Name, $WorkingDir, $Exe, [string[]]$Args)

    $proc = Start-Process -FilePath $Exe `
        -ArgumentList $Args `
        -WorkingDirectory $WorkingDir `
        -PassThru `
        -NoNewWindow
    [void]$Pids.Add($proc.Id)
    Write-Starting $Name
}

function Test-TcpPort {
    param($Port, $HostAddr = '127.0.0.1')
    try {
        $client = [System.Net.Sockets.TcpClient]::new($HostAddr, $Port)
        $client.Close()
        $client.Dispose()
        return $true
    }
    catch {
        return $false
    }
}

function Wait-ForPort {
    param($Name, $Port, $HostAddr = '127.0.0.1', $TimeoutSec = 30)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        if (Test-TcpPort -Port $Port -HostAddr $HostAddr) {
            Write-Ready $Name $Port
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Timeout $Name $Port $TimeoutSec
    return $false
}

# --- Check prerequisites ---
$missing = @()
if (-not (Get-Command go -ErrorAction SilentlyContinue))   { $missing += 'go' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += 'node' }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { $missing += 'pnpm' }
if ($missing.Count -gt 0) {
    Write-Host "ERROR: Missing required tools: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "Developers should have Go and Node installed. See https://go.dev/dl/ and https://nodejs.org/" -ForegroundColor DarkGray
    exit 1
}

# --- Install desktop dependencies if needed ---
if (-not (Test-Path "$RepoRoot\app\desktop\node_modules")) {
    Write-Host "  [Desktop] Installing dependencies (pnpm install)..." -ForegroundColor Yellow
    Push-Location "$RepoRoot\app\desktop"
    try {
        pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: pnpm install failed" -ForegroundColor Red
            exit 1
        }
    }
    finally {
        Pop-Location
    }
}

Write-Banner "AgentHub Dev Start"
Write-Host "Repo: $RepoRoot"

try {
    # Start all services
    Start-ServiceProcess -Name 'edge-server' -WorkingDir "$RepoRoot\edge-server" -Exe 'go' -Args @('run', './cmd/agenthub-edge', '--addr', '127.0.0.1:3210')
    Start-ServiceProcess -Name 'hub-server'  -WorkingDir "$RepoRoot\hub-server"  -Exe 'go' -Args @('run', './cmd/agenthub-hub',  '--addr', '127.0.0.1:4210')
    Start-ServiceProcess -Name 'desktop'     -WorkingDir "$RepoRoot\app\desktop"  -Exe 'pnpm' -Args @('dev', '--port', '5199')

    # Wait for health checks
    Write-Host "`nWaiting for services to be ready...`n"
    $allReady = $true
    $allReady = (Wait-ForPort -Name 'Edge'    -Port 3210) -and $allReady
    $allReady = (Wait-ForPort -Name 'Hub'     -Port 4210) -and $allReady
    $allReady = (Wait-ForPort -Name 'Desktop' -Port 5199 -HostAddr 'localhost') -and $allReady

    Write-Banner "All services started"
    Write-Host "  Edge:    http://127.0.0.1:3210" -ForegroundColor Cyan
    Write-Host "  Hub:     http://127.0.0.1:4210" -ForegroundColor Cyan
    Write-Host "  Desktop: http://localhost:5199" -ForegroundColor Cyan
    Write-Host "`nPress Ctrl+C to stop all services.`n" -ForegroundColor Yellow

    # Keep running until Ctrl+C
    while ($true) { Start-Sleep 1 }
}
finally {
    Write-Host "`nShutting down..." -ForegroundColor Yellow
    foreach ($pid in $Pids) {
        # Try graceful first, then force if still running
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and !$proc.HasExited) {
            Write-Host "  Stopping PID $pid ($($proc.ProcessName))..." -ForegroundColor DarkGray
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    # Backup: kill any remaining with taskkill /T for process tree
    $remaining = $Pids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Where-Object { $_ -and !$_.HasExited }
    if ($remaining) {
        Start-Sleep 1
        foreach ($pid in $Pids) {
            taskkill /F /T /PID $pid 2>$null
        }
    }
    Write-Host "All services stopped." -ForegroundColor Green
}
