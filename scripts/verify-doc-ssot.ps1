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
    if ($p -eq "docs/README.md" -or $p -eq "docs/contributing.md" -or $p -eq "docs/reference/README.md") { return $true }
    if ($p -eq "docs/roadmap.md" -or $p -match "^docs/roadmap/[^/]+\.md$") { return $true }
    if ($p -match "^docs/(analysis|plan|progress|governance|adr)/.+\.md$") { return $true }
    if ($p -match "^\.agents/skills/.+\.md$") { return $true }
    return $false
}

if (Test-Path -LiteralPath "CLAUDE.md") {
    Fail "root CLAUDE.md must not exist; AGENTS.md is the single project rule surface"
}

if (Test-Path -LiteralPath "docs/reference/desktop-ui-qa-sop.md") {
    Fail "old Desktop UI QA SOP must stay archived; use real-e2e-acceptance for active UI/E2E gates"
}

$datedGovernance = @(Get-ChildItem -LiteralPath "docs/governance" -File -Filter "*.md" | Where-Object { $_.Name -match "\d{4}-\d{2}-\d{2}" })
if ($datedGovernance.Count -gt 0) {
    Fail ("dated governance evidence must live under docs/archives/: " + (($datedGovernance | ForEach-Object { $_.Name }) -join ", "))
}

$agents = Get-Content -LiteralPath "AGENTS.md" -Raw
foreach ($required in @("项目总规则唯一入口", "docs/progress/MASTER.md", "docs/roadmap.md", ".agents/skills/real-e2e-acceptance/SKILL.md")) {
    if (-not $agents.Contains($required)) {
        Fail "AGENTS.md is missing required ownership marker: $required"
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
    @{ Pattern = "Mobile tests pass"; Message = "stale Mobile pass claim" },
    @{ Pattern = "真实执行已验证"; Message = "stale real-execution acceptance claim without current approved-real evidence" },
    @{ Pattern = "当前事实写在\s+`?STATE\.md`?"; Message = "old STATE.md fact-owner rule" },
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

Write-Host "doc SSOT ok"
