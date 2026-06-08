#!/usr/bin/env pwsh
<#
Build-artifact deploy readiness verifier for AgentHub Web.

This script inspects app/web/dist after a production build and can write a
manifest into the ignored dist directory. It does not deploy, upload, contact
Hub/TokenDance ID, open a browser, or read secrets.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$DistRelativePath = "app\web\dist",
    [string]$ManifestName = "web-deploy-readiness-manifest.json",
    [string]$ProductionWebOrigin = "https://hub.vectorcontrol.tech",
    [string]$ProductionHubUrl = "https://api.hub.vectorcontrol.tech",
    [string]$ProductionHubWsUrl = "wss://api.hub.vectorcontrol.tech/client/ws",
    [switch]$WriteManifest
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$DistPath = Join-Path $RepoRoot $DistRelativePath
$ManifestPath = Join-Path $DistPath $ManifestName
$Failed = 0
$Passed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Read-RepoFile([string]$RelativePath) {
    $path = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Fail "missing $RelativePath"
        return ""
    }
    return Get-Content -LiteralPath $path -Raw -Encoding UTF8
}

function Assert-Contains([string]$RelativePath, [string]$Pattern, [string]$Label) {
    $content = Read-RepoFile $RelativePath
    if ($content -match $Pattern) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath missing pattern: $Pattern)"
    }
}

function Assert-NotContains([string]$RelativePath, [string]$Pattern, [string]$Label) {
    $content = Read-RepoFile $RelativePath
    if ($content -notmatch $Pattern) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath contains pattern: $Pattern)"
    }
}

function Get-GitValue([string[]]$Arguments) {
    try {
        $value = & git -C $RepoRoot @Arguments 2>$null
        if ($LASTEXITCODE -eq 0) {
            return ($value -join "`n").Trim()
        }
    } catch {
        return ""
    }
    return ""
}

function Get-RelativeDistPath([string]$Path) {
    return [System.IO.Path]::GetRelativePath($DistPath, $Path).Replace("\", "/")
}

Write-Host "AgentHub Web deploy readiness verifier" -ForegroundColor Magenta
Write-Host "No deployment, upload, live auth, secret, or browser action will be performed." -ForegroundColor Magenta

if (Test-Path -LiteralPath $DistPath) {
    Pass "dist directory exists at $DistRelativePath"
} else {
    Fail "dist directory missing at $DistRelativePath; run app/web production build first"
}

if (Test-Path -LiteralPath $DistPath) {
    $indexPath = Join-Path $DistPath "index.html"
    if (Test-Path -LiteralPath $indexPath) {
        Pass "dist index.html exists"
    } else {
        Fail "dist index.html missing"
    }

    $files = Get-ChildItem -LiteralPath $DistPath -Recurse -File |
        Where-Object { $_.Name -ne $ManifestName } |
        Sort-Object FullName
    $assetFiles = $files | Where-Object { $_.FullName -match "[\\/]assets[\\/]" }

    if ($files.Count -gt 0) {
        Pass "dist has $($files.Count) deployable file(s)"
    } else {
        Fail "dist has no deployable files"
    }

    if ($assetFiles.Count -gt 0) {
        Pass "dist has hashed/static asset files"
    } else {
        Fail "dist assets directory has no files"
    }

    $distTextFiles = $files | Where-Object { $_.Extension -in @(".html", ".js", ".css", ".json", ".txt", ".svg") }
    $forbiddenPatterns = @(
        @{ Pattern = "127\.0\.0\.1:3210|localhost:3210"; Label = "Local Edge loopback URL" },
        @{ Pattern = "/v1/events|/v1/runs"; Label = "Local Edge event/run API" },
        @{ Pattern = "@tauri-apps/|src-tauri|desktopHost|localEdgeRuntime"; Label = "Desktop/Tauri runtime reference" }
    )
    foreach ($entry in $forbiddenPatterns) {
        $matches = $distTextFiles | Select-String -Pattern $entry.Pattern
        if ($matches) {
            foreach ($match in $matches) {
                Fail "$($entry.Label) found in dist/$(Get-RelativeDistPath $match.Path):$($match.LineNumber)"
            }
        } else {
            Pass "$($entry.Label) absent from app/web/dist"
        }
    }

    $fileManifests = @()
    foreach ($file in $files) {
        $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
        $fileManifests += [pscustomobject]@{
            path = Get-RelativeDistPath $file.FullName
            bytes = $file.Length
            sha256 = $hash.Hash.ToLowerInvariant()
        }
    }

    $manifest = [ordered]@{
        schema = "agenthub-web-deploy-readiness.v1"
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
        source_commit = Get-GitValue -Arguments @("rev-parse", "HEAD")
        branch = Get-GitValue -Arguments @("branch", "--show-current")
        artifact_root = $DistRelativePath.Replace("\", "/")
        deployment = [ordered]@{
            public_web_origin = $ProductionWebOrigin
            required_build_env = [ordered]@{
                VITE_HUB_URL = $ProductionHubUrl
                VITE_HUB_WS_URL = $ProductionHubWsUrl
            }
            oidc_callbacks = [ordered]@{
                production_web = "$ProductionWebOrigin/auth/tokendance/callback"
                dev_web_localhost = "http://localhost:5174/auth/tokendance/callback"
                dev_web_loopback = "http://127.0.0.1:5174/auth/tokendance/callback"
                desktop_loopback_policy = "http://127.0.0.1/callback"
            }
            not_performed = @("public_deploy", "artifact_upload", "live_tokendance_id_login", "secret_read", "browser_open")
        }
        files = $fileManifests
    }

    if ($WriteManifest) {
        $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
        Pass "wrote deploy readiness manifest to $DistRelativePath\$ManifestName"
    } else {
        Pass "manifest can be written with -WriteManifest"
    }
}

Assert-Contains "app\web\vite.config.ts" "port:\s*5174" "Web Vite dev port is 5174"
Assert-Contains "app\web\vite.config.ts" "strictPort:\s*true" "Web Vite dev port is strict"
Assert-Contains "app\web\src\api\hubAuth.ts" "/auth/tokendance/callback" "Web auth owns browser callback route"
Assert-Contains "hub-server\.env.example" "localhost:5174/auth/tokendance/callback" "Hub dev env documents localhost Web callback on 5174"
Assert-Contains "hub-server\.env.example" "127\.0\.0\.1:5174/auth/tokendance/callback" "Hub dev env documents loopback Web callback on 5174"
Assert-NotContains "hub-server\.env.example" "5173/auth/tokendance/callback" "Hub dev env has no stale Web 5173 callback"
Assert-Contains "hub-server\deployments\.env.production.example" "https://hub\.vectorcontrol\.tech/auth/tokendance/callback" "production env example documents Web callback"
Assert-Contains "hub-server\deployments\docker-compose.prod.yml" "https://hub\.vectorcontrol\.tech/auth/tokendance/callback" "production compose default includes Web callback"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -gt 0) {
    exit 1
}
