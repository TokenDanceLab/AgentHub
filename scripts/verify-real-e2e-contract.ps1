param()

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "real E2E contract check failed: $Message"
}

function Read-Text([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Fail "missing required file: $Path"
    }
    return Get-Content -LiteralPath $Path -Raw
}

$skillPath = ".agents/skills/real-e2e-acceptance/SKILL.md"
$workflowPath = "docs/governance/workflow-standard.md"
$architecturePath = "docs/architecture.md"
$roadmapPath = "docs/roadmap.md"
$smokeMatrixPath = "scripts/verify-e2e-smoke-matrix.ps1"

$skill = Read-Text $skillPath
$workflow = Read-Text $workflowPath
$architecture = Read-Text $architecturePath
$roadmap = Read-Text $roadmapPath
$smokeMatrix = Read-Text $smokeMatrixPath

$canonicalLevels = [ordered]@{
    "Fixture/unit" = "fixture-unit"
    "Playwright UI E2E" = "playwright-ui"
    "Visual QA" = "visual-qa"
    "Stubbed Hub" = "stubbed-hub"
    "Observed local" = "observed-local"
    "Approved real" = "approved-real"
    "Backend/API" = "backend-api"
    "Performance/leak" = "performance-leak"
    "Packaged release" = "packaged-release"
}

foreach ($label in $canonicalLevels.Keys) {
    if ($skill -notmatch "\|\s*$([regex]::Escape($label))\s*\|") {
        Fail "canonical real-e2e skill is missing evidence level '$label'"
    }
    $machineLabel = $canonicalLevels[$label]
    $expectedMachineLabel = "``$machineLabel``"
    if ($skill -notmatch [regex]::Escape($expectedMachineLabel)) {
        Fail "canonical real-e2e skill is missing machine label '$machineLabel'"
    }
}

if ($workflow -notmatch [regex]::Escape($skillPath)) {
    Fail "workflow-standard must point to the real-e2e-acceptance skill instead of owning another matrix"
}
if ($workflow -match "\|\s*Fixture/unit\s*\|" -or $workflow -match "\|\s*Playwright UI\s*\|") {
    Fail "workflow-standard duplicates the evidence-level matrix; keep the table only in $skillPath"
}

if ($architecture -match "1440x920") {
    Fail "architecture Visual QA still references stale 1440x920 viewport"
}
if ($architecture -notmatch "1440x810") {
    Fail "architecture Visual QA must name the 16:9 1440x810 desktop viewport"
}

foreach ($pattern in @(
    "当前活跃 PR 的 Mobile required check 阻塞",
    "Mobile required check 当前阻塞",
    "Visual QA fixture/display-name 断言"
)) {
    if ($roadmap -match [regex]::Escape($pattern)) {
        Fail "roadmap contains stale Mobile gate wording: $pattern"
    }
}

foreach ($required in @(
    "evidence_level",
    "real_tested",
    "claim",
    "status",
    "skipped_evidence_levels",
    "planned_evidence_levels"
)) {
    if ($smokeMatrix -notmatch [regex]::Escape($required)) {
        Fail "smoke matrix is missing manifest field '$required'"
    }
}

$declaredEvidenceLevels = [regex]::Matches($smokeMatrix, '-EvidenceLevel\s+"(?<level>[^"]+)"') |
    ForEach-Object { $_.Groups["level"].Value } |
    Sort-Object -Unique
$allowedEvidenceLevels = @($canonicalLevels.Values)
foreach ($level in $declaredEvidenceLevels) {
    if ($level -notin $allowedEvidenceLevels) {
        Fail "smoke matrix declares non-canonical evidence_level '$level'"
    }
}

Write-Host "real E2E contract ok"
