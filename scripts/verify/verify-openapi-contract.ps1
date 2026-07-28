<#
.SYNOPSIS
  OpenAPI <-> Hub router route contract gate.

.DESCRIPTION
  Parses api/openapi.yaml (Hub-owned, x-agenthub-status: implemented paths) and
  compares the (method, path) set against the routes statically registered in
  hub-server/internal/router/router.go. Fails (exit 1) on either side of the
  drift: an OpenAPI route not present in the router, or a router route not
  documented in OpenAPI.

  Admin/debug/health sub-routes that are legitimately absent from OpenAPI live
  in the allowlist below. The allowlist is audited against current reality —
  do not add real API routes here to manufacture a green build.

  Param-name differences (e.g. router :user_id vs OpenAPI {userId}) are
  normalized to a {param} placeholder so the contract compares route *shape*,
  not parameter naming.
#>
param(
    [string]$OpenApiPath = "api/openapi.yaml",
    [string]$RouterPath = "hub-server/internal/router/router.go"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $OpenApiPath)) { Fail "OpenAPI spec not found: $OpenApiPath" }
if (-not (Test-Path -LiteralPath $RouterPath)) { Fail "router source not found: $RouterPath" }

# ── Router route extraction (static regex reflect of router.go) ──────────────
$src = Get-Content -LiteralPath $RouterPath -Raw
$lines = $src -split "`r?`n"

# Build group-variable -> full-prefix map. Group declarations look like:
#   public := r.Group("/api/public")
#   auth := client.Group("/auth")
# Resolve nested groups iteratively until stable.
$prefix = @{}
$changed = $true
while ($changed) {
    $changed = $false
    foreach ($ln in $lines) {
        if ($ln -match '^\s*//') { continue }
        if ($ln -match '(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"') {
            $var = $Matches[1]; $parent = $Matches[2]; $seg = $Matches[3]
            if ($prefix.ContainsKey($var)) { continue }
            if ($parent -eq 'r') {
                $prefix[$var] = $seg
                $changed = $true
            } elseif ($prefix.ContainsKey($parent)) {
                $prefix[$var] = $prefix[$parent] + $seg
                $changed = $true
            }
        }
    }
}

# Extract route registrations: var.METHOD("path", ...) or r.METHOD("path", ...)
$routerRoutes = @{}
$routePattern = '(\w+)\.(GET|POST|PUT|DELETE|PATCH)\("([^"]*)"'
foreach ($ln in $lines) {
    if ($ln -match '^\s*//') { continue }
    foreach ($m in [regex]::Matches($ln, $routePattern)) {
        $var = $m.Groups[1].Value
        $method = $m.Groups[2].Value
        $path = $m.Groups[3].Value
        if ($var -eq 'r') {
            $base = ''
        } elseif ($prefix.ContainsKey($var)) {
            $base = $prefix[$var]
        } else {
            continue
        }
        $full = $base + $path
        # normalize gin :param -> {param}
        $full = $full -replace ':(\w+)', '{$1}'
        $routerRoutes["$method $full"] = $true
    }
}

# ── OpenAPI Hub-owned implemented route extraction (via PyYAML) ──────────────
$pyScript = @'
import yaml, json, pathlib, sys
spec = yaml.safe_load(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
out = []
paths = spec.get("paths", {}) if isinstance(spec, dict) else {}
for path, node in paths.items():
    if not isinstance(node, dict):
        continue
    for method, op in node.items():
        if method not in ("get", "post", "put", "delete", "patch", "head", "options"):
            continue
        if not isinstance(op, dict):
            continue
        owner = op.get("x-agenthub-owner") or node.get("x-agenthub-owner")
        status = op.get("x-agenthub-status") or node.get("x-agenthub-status")
        if owner == "Hub" and status == "implemented":
            out.append(method.upper() + " " + path)
print(json.dumps(sorted(out)))
'@

# Cross-platform temp dir (Linux runners do not set $env:TEMP).
$tempDir = $env:TEMP
if ([string]::IsNullOrWhiteSpace($tempDir)) { $tempDir = $env:TMPDIR }
if ([string]::IsNullOrWhiteSpace($tempDir)) { $tempDir = [System.IO.Path]::GetTempPath() }
# Ensure PyYAML is available (Linux runners have python3 but not PyYAML by default).
$pyCheck = & python -c "import yaml; print('ok')" 2>$null
if ($LASTEXITCODE -ne 0 -or $pyCheck -neq 'ok') {
    & python -m pip install --quiet --disable-pip-version-check PyYAML 2>$null
    if ($LASTEXITCODE -ne 0) {
        & python3 -m pip install --quiet --disable-pip-version-check PyYAML 2>$null
    }
}
$tmp = New-Item -ItemType File -Path (Join-Path $tempDir "agenthub-openapi-extract-$([guid]::NewGuid()).py") -Force
try {
    Set-Content -LiteralPath $tmp.FullName -Value $pyScript -Encoding utf8
    $pyExe = 'python'
    $json = & $pyExe $tmp.FullName $OpenApiPath
    if ($LASTEXITCODE -ne 0) {
        $pyExe = 'python3'
        $json = & $pyExe $tmp.FullName $OpenApiPath
    }
    if ($LASTEXITCODE -ne 0) {
        Fail "python OpenAPI extraction failed (exit $LASTEXITCODE). Ensure PyYAML is installed: python -m pip install PyYAML"
    }
} finally {
    Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
}

$openapiRoutes = @{}
foreach ($entry in ($json | ConvertFrom-Json)) {
    $openapiRoutes[$entry] = $true
}

# ── Normalize param names to {param} so shape, not naming, is compared ───────
function Normalize-Route([string]$route) {
    $parts = $route -split ' ', 2
    $method = $parts[0]
    $path = $parts[1]
    $path = $path -replace '\{[^}]+\}', '{param}'
    return "$method $path"
}

$routerN = @{}
foreach ($k in $routerRoutes.Keys) { $routerN[(Normalize-Route $k)] = $true }

$openapiN = @{}
foreach ($k in $openapiRoutes.Keys) { $openapiN[(Normalize-Route $k)] = $true }

# ── Allowlist: router routes legitimately absent from OpenAPI ────────────────
# Admin/debug/health sub-routes only. Real API routes must be documented.
$allowlist = @(
    'GET /debug/panic',
    'GET /health/live',
    'GET /health/ready'
)
$allowN = @{}
foreach ($a in $allowlist) { $allowN[(Normalize-Route $a)] = $true }

# ── Compare ───────────────────────────────────────────────────────────────────
$onlyOpenApi = @($openapiN.Keys | Where-Object { -not $routerN.ContainsKey($_) } | Sort-Object)
$onlyRouter = @($routerN.Keys | Where-Object {
    -not $openapiN.ContainsKey($_) -and -not $allowN.ContainsKey($_)
} | Sort-Object)

$failures = @()
if ($onlyOpenApi.Count -gt 0) {
    $failures += "OpenAPI documents Hub-implemented routes NOT registered in hub router ($($onlyOpenApi.Count)):"
    foreach ($r in $onlyOpenApi) { $failures += "  + $r" }
}
if ($onlyRouter.Count -gt 0) {
    $failures += "Hub router registers routes NOT documented in OpenAPI ($($onlyRouter.Count)):"
    foreach ($r in $onlyRouter) { $failures += "  - $r" }
}

if ($failures.Count -gt 0) {
    Write-Host "OpenAPI <-> hub router contract drift detected:" -ForegroundColor Red
    Write-Host "  OpenAPI Hub-implemented routes: $($openapiN.Count)"
    Write-Host "  Router routes: $($routerN.Count)"
    Write-Host "  Allowlisted (admin/debug only): $($allowN.Count)"
    Write-Host ""
    $failures | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    Write-Host ""
    Write-Host "Fix: document new router routes in api/openapi.yaml (x-agenthub-owner: Hub, x-agenthub-status: implemented), or remove stale OpenAPI paths. Admin/debug-only routes go in the allowlist in scripts/verify/verify-openapi-contract.ps1." -ForegroundColor Yellow
    exit 1
}

Write-Host "openapi<->hub router contract ok"
Write-Host "  OpenAPI Hub-implemented routes: $($openapiN.Count)"
Write-Host "  Router routes: $($routerN.Count)"
Write-Host "  Allowlisted (admin/debug only): $($allowN.Count)"
