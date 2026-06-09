#!/usr/bin/env pwsh
<#
Verifies an AgentHub redacted evidence manifest without running CLIs, model APIs,
services, uploads, or competition packaging.
#>

[CmdletBinding()]
param(
    [string]$ManifestPath,
    [string]$PackagePath
)

$ErrorActionPreference = "Stop"
$SensitiveValuePattern = '(?i)(Authorization\s*:\s*Bearer\s+(?!<redacted)[^\s,;]+|Cookie\s*:\s*[^\r\n]+|(?:password|passwd|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|auth[_ -]?token)\s*[:=]\s*(?!"?(?:false|true|null|none|not[_ -]?required|not[_ -]?available|blocked|redacted|<redacted|fixture|manifest|approved|redact)[^"]*"?)(?!"?\s*(?:false|true|null)"?\s*(?:,|$))["'']?[^"''\s,;}]{8,}|(?<![A-Za-z0-9_])(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{12,})'
$TextScanExtensions = @(".json", ".md", ".txt", ".log", ".csv", ".yaml", ".yml")
$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Resolve-InputPath([string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return [System.IO.Path]::GetFullPath($PathValue)
    }
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $PathValue))
}

function Test-PackageRelativePath([string]$RelativePath) {
    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
        return $false
    }
    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        return $false
    }
    if ($RelativePath -match '(^|/|\\)\.\.($|/|\\)') {
        return $false
    }
    return $true
}

function Test-TextRedaction([string]$PathValue) {
    $extension = [System.IO.Path]::GetExtension($PathValue)
    if ($TextScanExtensions -notcontains $extension.ToLowerInvariant()) {
        return $true
    }
    $content = Get-Content -Raw -LiteralPath $PathValue
    return ($content -notmatch $SensitiveValuePattern)
}

function Get-Sha256 {
    param([string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha.ComputeHash($stream)
            return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

if ([string]::IsNullOrWhiteSpace($ManifestPath) -and -not [string]::IsNullOrWhiteSpace($PackagePath)) {
    $ManifestPath = Join-Path $PackagePath "redacted-manifest.json"
}

$resolvedManifest = Resolve-InputPath $ManifestPath
if (-not $resolvedManifest -or -not (Test-Path -LiteralPath $resolvedManifest)) {
    Fail "redacted manifest exists"
    Write-Host "`nRedacted manifest verification: $Passed passed, $Failed failed"
    exit 1
}
Pass "redacted manifest exists"

$packageRoot = Split-Path -Parent $resolvedManifest
$rootFull = [System.IO.Path]::GetFullPath($packageRoot)
if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull = $rootFull + [System.IO.Path]::DirectorySeparatorChar
}

$manifest = $null
try {
    $manifest = Get-Content -Raw -LiteralPath $resolvedManifest | ConvertFrom-Json
    Pass "redacted manifest parses"
} catch {
    Fail "redacted manifest parses"
}

if ($manifest) {
    if ($manifest.schema -eq "agenthub-redacted-evidence-manifest-v1") {
        Pass "redacted manifest schema is supported"
    } else {
        Fail "redacted manifest schema is supported"
    }

    $label = [string]$manifest.evidence_boundary.label
    if (@("fixture", "observed", "RealTested", "approved-real") -contains $label) {
        Pass "evidence boundary label is explicit"
    } else {
        Fail "evidence boundary label is explicit"
    }

    if ($manifest.redaction.status -eq "passed") {
        Pass "redaction status is passed"
    } else {
        Fail "redaction status is passed"
    }

    $files = @($manifest.files)
    if ($files.Count -gt 0) {
        Pass "manifest lists files"
    } else {
        Fail "manifest lists files"
    }

    foreach ($file in $files) {
        $relative = [string]$file.path
        if (Test-PackageRelativePath $relative) {
            Pass "file path is package-relative: $relative"
        } else {
            Fail "file path is package-relative: $relative"
            continue
        }

        $full = [System.IO.Path]::GetFullPath((Join-Path $packageRoot $relative))
        if ($full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            Pass "file stays under package root: $relative"
        } else {
            Fail "file stays under package root: $relative"
            continue
        }

        if (Test-Path -LiteralPath $full) {
            Pass "file exists: $relative"
        } else {
            Fail "file exists: $relative"
            continue
        }

        $actualHash = Get-Sha256 $full
        if ($actualHash -eq ([string]$file.sha256).ToLowerInvariant()) {
            Pass "file hash matches: $relative"
        } else {
            Fail "file hash matches: $relative"
        }

        if (Test-TextRedaction $full) {
            Pass "text file has no sensitive values: $relative"
        } else {
            Fail "text file has no sensitive values: $relative"
        }
    }
}

Write-Host "`nRedacted manifest verification: $Passed passed, $Failed failed"
if ($Failed -gt 0) {
    exit 1
}
