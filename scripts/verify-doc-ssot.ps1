param()

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "doc SSOT check failed: $Message"
}

function Normalize-Path([string]$Path) {
    return $Path -replace "\\", "/"
}

function Is-ActiveDoc([string]$Path) {
    $p = Normalize-Path $Path
    if ($p -match "^docs/(archive|archives|audit|release)/") { return $false }
    if ($p -eq "AGENTS.md") { return $true }
    if ($p -eq "CONTRIBUTING.md") { return $true }
    if ($p -eq "reference/INDEX.md") { return $true }
    if ($p -eq "api/README.md" -or $p -eq "api/events.md" -or $p -eq "api/conventions.md") { return $true }
    if ($p -eq "edge-server/README.md") { return $true }
    if ($p -eq "hub-server/README.md" -or $p -eq "hub-server/deployments/README.md" -or $p -eq "hub-server/tests/README.md") { return $true }
    if ($p -eq "app/web/README.md" -or $p -eq "app/desktop/README.md") { return $true }
    if ($p -eq "scripts/load-test-scenarios.md") { return $true }
    if ($p -eq "docs/README.md" -or $p -eq "docs/reference/README.md" -or $p -eq "docs/api-reference.md") { return $true }
    if ($p -eq "docs/roadmap.md") { return $true }
    if ($p -match "^docs/(analysis|plan|progress|governance|adr)/.+\.md$") { return $true }
    if ($p -match "^\.agents/skills/.+\.md$") { return $true }
    return $false
}

if (Test-Path -LiteralPath "CLAUDE.md") {
    Fail "root CLAUDE.md must not exist; AGENTS.md is the single project rule surface"
}

foreach ($stalePath in @(
    "STATE.md",
    "docs/contributing.md",
    "docs/roadmap",
    "docs/audit",
    "docs/reference/projects",
    "docs/release/screenshot-checklist.md",
    "api/events-full.md",
    "edge-server/docs/audit",
    "hub-server/docs/audit"
)) {
    if (Test-Path -LiteralPath $stalePath) {
        Fail "$stalePath must stay archived or removed from active docs"
    }
}

if (Test-Path -LiteralPath "docs/reference/desktop-ui-qa-sop.md") {
    Fail "old Desktop UI QA SOP must stay archived; use real-e2e-acceptance for active UI/E2E gates"
}

$datedGovernance = @(Get-ChildItem -LiteralPath "docs/governance" -File -Filter "*.md" | Where-Object { $_.Name -match "\d{4}-\d{2}-\d{2}" })
if ($datedGovernance.Count -gt 0) {
    Fail ("dated governance evidence must live under docs/archives/: " + (($datedGovernance | ForEach-Object { $_.Name }) -join ", "))
}

$requiredMarkers = @(
    @{ Path = "AGENTS.md"; Marker = "项目总规则唯一入口" },
    @{ Path = "AGENTS.md"; Marker = "docs/progress/MASTER.md" },
    @{ Path = "AGENTS.md"; Marker = "docs/roadmap.md" },
    @{ Path = "AGENTS.md"; Marker = ".agents/skills/real-e2e-acceptance/SKILL.md" },
    @{ Path = "AGENTS.md"; Marker = "避免巨石文档" },
    @{ Path = "api/events.md"; Marker = "Owner" },
    @{ Path = "app/web/README.md"; Marker = "docs/archive/app/web-readme-full-2026-06-27.md" },
    @{ Path = "app/desktop/README.md"; Marker = "packaged-release" },
    @{ Path = "edge-server/README.md"; Marker = "Source Map" },
    @{ Path = "hub-server/README.md"; Marker = "Source Map" },
    @{ Path = "hub-server/deployments/README.md"; Marker = "Live host" },
    @{ Path = "hub-server/tests/README.md"; Marker = "Integration Tests" },
    @{ Path = "scripts/load-test-scenarios.md"; Marker = "Current Scope" },
    @{ Path = "scripts/load-test-scenarios.md"; Marker = "Gate Matrix" },
    @{ Path = "scripts/load-test-scenarios.md"; Marker = "Do Not Claim" },
    @{ Path = "reference/INDEX.md"; Marker = "docs/reference/README.md" },
    @{ Path = "CONTRIBUTING.md"; Marker = "旧详细贡献指南已归档" },
    @{ Path = "docs/governance/document-standards.md"; Marker = "避免巨石文档" }
    @{ Path = "docs/architecture/04-frontend-data-flow.md"; Marker = "Source Owner Map" }
    @{ Path = "hub-server/README.md"; Marker = "scripts/load-test-scenarios.md" }
    @{ Path = "edge-server/README.md"; Marker = "verify-backend-perf-leak-gates.ps1" }
)

foreach ($required in $requiredMarkers) {
    $content = Get-Content -LiteralPath $required.Path -Raw
    if (-not $content.Contains($required.Marker)) {
        Fail "$($required.Path) is missing required ownership marker: $($required.Marker)"
    }
}

$allowedClaudeMentions = @(
    "AGENTS.md",
    "docs/governance/document-standards.md",
    "docs/progress/MASTER.md"
)

$forbiddenPatterns = @(
    @{ Pattern = "AGENTS\.md\s*/\s*CLAUDE\.md"; Message = "legacy AGENTS/CLAUDE dual-rule wording" },
    @{ Pattern = "STATE\.md"; Message = "root STATE.md as an active project fact source" },
    @{ Pattern = "ROADMAP\.md"; Message = "uppercase ROADMAP.md legacy reference" },
    @{ Pattern = "GPT-5\.5"; Message = "hard-coded private/local model alias" },
    @{ Pattern = "(?<![\w-])/(goal|loop)(?![\w-])"; Message = "legacy Codex /goal or /loop workflow rule" },
    @{ Pattern = "Desktop/Web UI freeze|UI freeze"; Message = "obsolete UI freeze rule" },
    @{ Pattern = "Phase 2 Real E2E Contract\s*\|\s*进行中"; Message = "stale Phase 2 progress state" },
    @{ Pattern = 'current pre-Phase 3 hygiene branch `docs/active-doc-regroup`'; Message = "stale active-doc-regroup branch status" },
    @{ Pattern = 'Review and merge `docs/active-doc-regroup`'; Message = "stale active-doc-regroup next step" },
    @{ Pattern = 'docs/module-readme-trim'; Message = "stale module-readme cleanup branch presented as active work" },
    @{ Pattern = 'T3\.0b\s*\|\s*#344[^\r\n]*\|\s*open'; Message = "stale #344 open status after module README cleanup merged" },
    @{ Pattern = '#344\s*/\s*T3\.0b\s+on'; Message = "stale #344 active-task wording" },
    @{ Pattern = 'Phase 3 Source And Test Alignment\s*\|\s*待开始'; Message = "stale Phase 3 not-started roadmap state" },
    @{ Pattern = 'Phase 3: Source And Test Alignment\s*\(1/7 tasks\)'; Message = "stale Phase 3 pre-#344 progress count" },
    @{ Pattern = 'current governance/source-contract branch'; Message = "stale current branch prose in progress docs" },
    @{ Pattern = "Mobile tests pass"; Message = "stale Mobile pass claim" },
    @{ Pattern = "真实执行已验证"; Message = "stale real-execution acceptance claim without current approved-real evidence" },
    @{ Pattern = "当前事实写在\s+`?STATE\.md`?"; Message = "old STATE.md fact-owner rule" },
    @{ Pattern = "docs/architecture/system-design/"; Message = "removed system-design architecture path" },
    @{ Pattern = "docs/operations/desktop-ui-qa-sop"; Message = "removed Desktop UI QA SOP path" },
    @{ Pattern = "app/web/screenshots/web-design"; Message = "old Web screenshot evidence list in active docs" },
    @{ Pattern = "132 tests|278 tests|11/11|12/12\s+(Mock|curl|tests|PASS)"; Message = "fixed test-count acceptance claim" }
)

$files = @(git ls-files | ForEach-Object { Normalize-Path $_ } | Where-Object { Is-ActiveDoc $_ })

foreach ($file in $files) {
    $content = Get-Content -LiteralPath $file -Raw

    if ($content -cmatch "CLAUDE\.md" -and $file -notin $allowedClaudeMentions) {
        Fail "$file contains CLAUDE.md outside the allowed negative/ownership notes"
    }

    foreach ($rule in $forbiddenPatterns) {
        if ($content -cmatch $rule.Pattern) {
            Fail "$file contains $($rule.Message)"
        }
    }
}

$maxLines = @{
    "AGENTS.md" = 260
    "CHANGELOG.md" = 90
    "CONTRIBUTING.md" = 90
    "reference/INDEX.md" = 80
    "api/README.md" = 100
    "api/events.md" = 180
    "api/conventions.md" = 190
    "app/web/README.md" = 95
    "app/desktop/README.md" = 95
    "edge-server/README.md" = 115
    "hub-server/README.md" = 120
    "hub-server/deployments/README.md" = 100
    "hub-server/tests/README.md" = 70
    "scripts/load-test-scenarios.md" = 115
    "docs/README.md" = 120
    "docs/developer-quickstart.md" = 170
    "docs/roadmap.md" = 220
    "docs/architecture.md" = 170
    "docs/architecture/04-frontend-data-flow.md" = 150
    "docs/api-reference.md" = 80
    "docs/reference/README.md" = 80
    "docs/reference/sdk-agent-strategy.md" = 120
    "docs/reference/agent-protocol-compat.md" = 100
    "docs/governance/security-risk-register.md" = 180
    "docs/governance/threat-model.md" = 140
    "docs/progress/MASTER.md" = 150
}

foreach ($entry in $maxLines.GetEnumerator()) {
    if (Test-Path -LiteralPath $entry.Key) {
        $lineCount = ([System.IO.File]::ReadLines((Resolve-Path -LiteralPath $entry.Key).ProviderPath) | Measure-Object).Count
        if ($lineCount -gt $entry.Value) {
            Fail "$($entry.Key) has $lineCount lines; active entry limit is $($entry.Value). Move detail to owner docs or archive."
        }
    }
}

Write-Host "doc SSOT ok"
