param(
    [string]$SkillsRoot = ".agents/skills",
    [string]$ArchiveRoot = "docs/archives/project-skills",
    [string]$GitignorePath = ".gitignore"
)

$ErrorActionPreference = "Stop"

$Allowlist = @(
    "adapter-dev",
    "dev-loop",
    "env-sandbox",
    "integration-test",
    "pre-push",
    "real-e2e-acceptance",
    "test-coverage"
)

$ArchivedOnly = @(
    "ui-screenshot",
    "dev-team",
    "dev-team-codex"
)

function Fail([string]$Message) {
    throw "project skill whitelist check failed: $Message"
}

function Normalize-Set([string[]]$Items) {
    return @($Items | Where-Object { $_ } | Sort-Object -Unique)
}

if (-not (Test-Path -LiteralPath $SkillsRoot -PathType Container)) {
    Fail "skills root not found: $SkillsRoot"
}

$actual = Normalize-Set @(Get-ChildItem -LiteralPath $SkillsRoot -Directory | ForEach-Object { $_.Name })
$expected = Normalize-Set $Allowlist

$unexpected = @($actual | Where-Object { $_ -notin $expected })
$missing = @($expected | Where-Object { $_ -notin $actual })

if ($unexpected.Count -gt 0) {
    Fail ("unexpected active skill(s): " + ($unexpected -join ", "))
}

if ($missing.Count -gt 0) {
    Fail ("missing allowlisted skill(s): " + ($missing -join ", "))
}

foreach ($skill in $Allowlist) {
    $skillPath = Join-Path $SkillsRoot $skill
    $skillFile = Join-Path $skillPath "SKILL.md"
    if (-not (Test-Path -LiteralPath $skillFile -PathType Leaf)) {
        Fail "allowlisted skill is missing SKILL.md: $skill"
    }
}

foreach ($skill in $ArchivedOnly) {
    $activePath = Join-Path $SkillsRoot $skill
    if (Test-Path -LiteralPath $activePath) {
        Fail "archived skill is active again: $skill"
    }

    $archivedPath = Join-Path $ArchiveRoot $skill
    if (-not (Test-Path -LiteralPath $archivedPath -PathType Container)) {
        Fail "archived skill copy is missing: $skill"
    }
}

if (-not (Test-Path -LiteralPath $GitignorePath -PathType Leaf)) {
    Fail "gitignore not found: $GitignorePath"
}

$gitignore = Get-Content -LiteralPath $GitignorePath -Raw

foreach ($skill in $Allowlist) {
    $dirPattern = [regex]::Escape("!.agents/skills/$skill/")
    $allPattern = [regex]::Escape("!.agents/skills/$skill/**")
    if ($gitignore -notmatch $dirPattern -or $gitignore -notmatch $allPattern) {
        Fail "allowlisted skill is not explicitly unignored in .gitignore: $skill"
    }
}

foreach ($skill in $ArchivedOnly) {
    $dirPattern = [regex]::Escape("!.agents/skills/$skill/")
    $allPattern = [regex]::Escape("!.agents/skills/$skill/**")
    if ($gitignore -match $dirPattern -or $gitignore -match $allPattern) {
        Fail "archived skill is still unignored in .gitignore: $skill"
    }
}

Write-Host "project skill whitelist ok"
