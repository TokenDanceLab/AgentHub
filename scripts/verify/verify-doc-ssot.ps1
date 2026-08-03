param()

$ErrorActionPreference = "Stop"

function Fail([string]$Message, [string]$Code = "DOC-SSOT") {
    if ($Code -notmatch '^DOC-[A-Z0-9-]+$') {
        throw "invalid doc SSOT failure code: $Code"
    }
    throw "doc SSOT check failed [$Code]: $Message"
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
    if ($p -eq "app/web/README.md" -or $p -eq "app/desktop/README.md" -or $p -eq "app/mobile-rn/README.md") { return $true }
    if ($p -eq "docs/reference/backend-performance-gates.md") { return $true }
    if ($p -eq "docs/README.md" -or $p -eq "docs/history.md" -or $p -eq "docs/decisions.md" -or $p -eq "docs/reference/README.md" -or $p -eq "docs/api-reference.md") { return $true }
    if ($p -eq "docs/roadmap.md") { return $true }
    if ($p -match "^docs/(analysis|plan|progress|governance)/.+\.md$") { return $true }
    if ($p -match "^\.agents/skills/.+\.md$") { return $true }
    return $false
}

$forbiddenRootEntrypoints = @(
    @{ Path = "CLAUDE.md"; Reason = "AGENTS.md is the single project rule surface" },
    @{ Path = "CODEX.md"; Reason = "tool-specific rules must not fork AGENTS.md" },
    @{ Path = "GEMINI.md"; Reason = "tool-specific rules must not fork AGENTS.md" },
    @{ Path = "CURSOR.md"; Reason = "tool-specific rules must not fork AGENTS.md" },
    @{ Path = "PROGRESS.md"; Reason = "docs/progress/MASTER.md is the single current-progress surface" },
    @{ Path = "STATE.md"; Reason = "current facts belong to AGENTS.md, MASTER.md, and owner docs" },
    @{ Path = "ROADMAP.md"; Reason = "docs/roadmap.md is the canonical roadmap path" }
)
foreach ($entrypoint in $forbiddenRootEntrypoints) {
    if (Test-Path -LiteralPath $entrypoint.Path) {
        Fail "root $($entrypoint.Path) must not exist; $($entrypoint.Reason)" "DOC-ROOT-ENTRYPOINT"
    }
}

foreach ($stalePath in @(
    "docs/contributing.md",
    "docs/roadmap",
    "docs/adr",
    "docs/audit",
    "docs/reference/projects",
    "docs/release/screenshot-checklist.md",
    "docs/governance/document-standards.md",
    "docs/governance/workflow-standard.md",
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

foreach ($archivedActivePath in @(
    "docs/governance/branch-governance.md",
    "app/mobile-rn/docs/handoff.md"
)) {
    if (Test-Path -LiteralPath $archivedActivePath) {
        Fail "$archivedActivePath must stay archived; active branch rules live in AGENTS.md and Mobile gates live in app/mobile-rn/README.md"
    }
}

$datedGovernance = @(Get-ChildItem -LiteralPath "docs/governance" -File -Filter "*.md" | Where-Object { $_.Name -match "\d{4}-\d{2}-\d{2}" })
if ($datedGovernance.Count -gt 0) {
    Fail ("dated governance evidence must live in the external archive indexed by docs/history.md: " + (($datedGovernance | ForEach-Object { $_.Name }) -join ", "))
}

$requiredReadmeEntrypoints = @(
    "docs/developer-quickstart.md",
    "docs/architecture.md",
    "AGENTS.md",
    "docs/progress/MASTER.md"
)
$readmeContent = Get-Content -LiteralPath "README.md" -Raw
foreach ($target in $requiredReadmeEntrypoints) {
    $linkPattern = '\[[^\]]+\]\(' + [regex]::Escape($target) + '\)'
    if ($readmeContent -notmatch $linkPattern) {
        Fail "README.md is missing required entrypoint target: $target" "DOC-README-ENTRYPOINT"
    }
    if (-not (Test-Path -LiteralPath $target)) {
        Fail "README.md entrypoint target does not exist: $target" "DOC-README-TARGET"
    }
}

$requiredMarkers = @(
    @{ Path = "AGENTS.md"; Marker = "新 Agent 90 秒入口" },
    @{ Path = "AGENTS.md"; Marker = "项目总规则唯一入口" },
    @{ Path = "AGENTS.md"; Marker = "docs/progress/MASTER.md" },
    @{ Path = "AGENTS.md"; Marker = "docs/roadmap.md" },
    @{ Path = "AGENTS.md"; Marker = ".agents/skills/real-e2e-acceptance/SKILL.md" },
    @{ Path = "AGENTS.md"; Marker = "避免巨石文档" },
    @{ Path = "AGENTS.md"; Marker = '项目规则只写 `AGENTS.md`' },
    @{ Path = "docs/history.md"; Marker = "archive commit" },
    @{ Path = "docs/history.md"; Marker = "TokenDanceLab/docs" },
    @{ Path = "docs/decisions.md"; Marker = "ADR-017" },
    @{ Path = "docs/decisions.md"; Marker = "Full ADR bodies are archived" },
    @{ Path = ".agents/skills/real-e2e-acceptance/SKILL.md"; Marker = "Packaged release" },
    @{ Path = "api/events.md"; Marker = "Owner" },
    @{ Path = "app/web/README.md"; Marker = "docs/history.md" },
    @{ Path = "app/desktop/README.md"; Marker = "packaged-release" },
    @{ Path = "app/desktop/README.md"; Marker = "Vite renderer 证据不等于 packaged Desktop" },
    @{ Path = "app/mobile-rn/README.md"; Marker = "real_tested=false" },
    @{ Path = "app/mobile-rn/README.md"; Marker = "Mobile must not connect directly to Local Edge" },
    @{ Path = "edge-server/README.md"; Marker = "Source Map" },
    @{ Path = "hub-server/README.md"; Marker = "Source Map" },
    @{ Path = "hub-server/deployments/README.md"; Marker = "Live host" },
    @{ Path = "hub-server/tests/README.md"; Marker = "Integration Tests" },
    @{ Path = "docs/reference/backend-performance-gates.md"; Marker = "Current Scope" },
    @{ Path = "docs/reference/backend-performance-gates.md"; Marker = "Gate Matrix" },
    @{ Path = "docs/reference/backend-performance-gates.md"; Marker = "Do Not Claim" },
    @{ Path = "reference/INDEX.md"; Marker = "docs/reference/README.md" },
    @{ Path = "CONTRIBUTING.md"; Marker = "旧详细贡献指南见" },
    @{ Path = "docs/governance/governance-execution.md"; Marker = "D2b. Release dry build topology" }
    @{ Path = "docs/governance/governance-execution.md"; Marker = "later approval slice" }
    @{ Path = "docs/architecture/05-deployment.md"; Marker = "Desktop packaged 行为正确" }
    @{ Path = "scripts/release/verify-tauri-package-readiness.ps1"; Marker = "Assert-WorkflowCommandExplicitOptIn" }
    @{ Path = "scripts/release/verify-tauri-package-readiness.ps1"; Marker = "Assert-NoMacOSUnsignedDryReleaseActions" }
    @{ Path = "scripts/release/verify-tauri-package-dry.ps1"; Marker = "windows-desktop-package-dry" }
    @{ Path = "docs/architecture/04-frontend-data-flow.md"; Marker = "Source Owner Map" }
    @{ Path = "hub-server/README.md"; Marker = "docs/reference/backend-performance-gates.md" }
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
    @{ Pattern = "Local mock Hub check passed"; Message = "stale Mobile mock-Hub pass claim" },
    @{ Pattern = "Visual QA should pass"; Message = "stale Mobile visual QA pass claim" },
    @{ Pattern = "Wi-Fi ADB"; Message = "stale Mobile device proof wording" },
    @{ Pattern = "v0\.3\.0-rc\.7"; Message = "stale Mobile release-candidate proof wording" },
    @{ Pattern = "Current branch handoff"; Message = "stale Mobile handoff owner wording" },
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
    "AGENTS.md" = 340  # 含 §9.5 规则→验证映射表（约 40 行）
    "CHANGELOG.md" = 90
    "CONTRIBUTING.md" = 90
    "reference/INDEX.md" = 80
    "api/README.md" = 100
    "api/events.md" = 180
    "api/conventions.md" = 190
    "app/web/README.md" = 95
    "app/desktop/README.md" = 95
    "app/mobile-rn/README.md" = 95
    "edge-server/README.md" = 115
    "hub-server/README.md" = 120
    "hub-server/deployments/README.md" = 100
    "hub-server/tests/README.md" = 70
    "docs/reference/backend-performance-gates.md" = 115
    "docs/README.md" = 120
    "docs/history.md" = 80
    "docs/decisions.md" = 80
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
    "docs/governance/governance-execution.md" = 110
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

# --- AGENTS.md 路径存在性检查（CI 保鲜：反引号路径必须真实存在） ---
function Expand-BracePath([string]$Path) {
    $m = [regex]::Match($Path, '^([^{]*)\{([^}]+)\}(.*)$')
    if (-not $m.Success) { return @($Path) }
    $prefix = $m.Groups[1].Value
    $suffix = $m.Groups[3].Value
    return @(($m.Groups[2].Value -split ',' | ForEach-Object { "$prefix$_$suffix" }))
}

function Assert-AgentsMdPaths {
    $content = Get-Content -LiteralPath "AGENTS.md" -Raw
    # 剥离代码围栏块（``` ... ```），只扫描行内单反引号路径
    $content = [regex]::Replace($content, '```[\s\S]*?```', '')
    $checked = 0
    foreach ($m in [regex]::Matches($content, '`([^`]*)`')) {
        $p = $m.Groups[1].Value.Trim()
        if ($p -match '^\.\./') { continue }              # 外部路径（../ 开头，属上级仓库）
        if ($p -match '^\.(agenthub|claude|codex)/') { continue }  # gitignored 本机 agent 状态目录
        if ($p -match '^\.worktrees/') { continue }       # git worktree 机制目录
        if ($p -notmatch '/') { continue }                # 无斜杠不是仓库内路径
        if ($p -match '[*?<>@]') { continue }             # 通配符/占位符/外部引用（如 paths-filter@v3）
        if ($p -match '^/') { continue }                  # API 路由（如 /v1/runners），非文件路径
        if ($p -match '\s') { continue }                  # 含空格 = 命令/短语（如 `bash scripts/x.sh`），非仓库内路径
        $p = $p -replace '^\./', ''                       # 剥离 ./ 前缀
        foreach ($cand in (Expand-BracePath $p)) {
            if (-not (Test-Path -LiteralPath $cand)) {
                Fail "AGENTS.md references missing path: $cand"
            }
            $checked++
        }
    }
    Write-Host "AGENTS.md path check ok ($checked paths)"
}

Assert-AgentsMdPaths

# --- AGENTS.md §9.5 规则→验证映射表检查（脚本路径 + CI 文件必须存在） ---
function Assert-AgentsMdMappingTable {
    $content = Get-Content -LiteralPath "AGENTS.md" -Raw
    $sectionMatch = [regex]::Match($content, '(?ms)^## 9\.5 .*?^## ')
    if (-not $sectionMatch.Success) {
        Fail "AGENTS.md is missing the ## 9.5 rule-to-verifier mapping table section"
    }
    $checkedScripts = 0
    $checkedCiFiles = 0
    foreach ($line in ($sectionMatch.Value -split "`r?`n")) {
        if ($line -notmatch '^\s*\|') { continue }
        $cells = $line -split '\|'
        if ($cells.Count -lt 5) { continue }   # 表头/分隔行/短行跳过（[空,规则,脚本,CI,空]）
        $scriptCell = $cells[2]
        $ciCell = $cells[3]
        # 脚本列：反引号内为仓库内路径（无/内联 等裸文本行跳过）；{a,b} 花括号展开
        # 用 [regex]::Match 缓存局部变量，不依赖自动变量 $matches（前序函数的 -match 会污染它）
        $scriptMatch = [regex]::Match($scriptCell, '`([^`]*)`')
        if ($scriptMatch.Success) {
            $ref = $scriptMatch.Groups[1].Value.Trim()
            foreach ($cand in (Expand-BracePath $ref)) {
                if (-not (Test-Path -LiteralPath $cand)) {
                    Fail "AGENTS.md mapping table references missing path: $cand"
                }
                $checkedScripts++
            }
        }
        # CI 列：识别 workflow 文件引用，必须存在
        $ciMatch = [regex]::Match($ciCell, '(?i)(checks\.yml|release-readiness\.yml|cd-[a-z-]+\.yml|release\.yml)')
        if ($ciMatch.Success) {
            $ciFile = $ciMatch.Groups[1].Value
            if (-not (Test-Path -LiteralPath ".github/workflows/$ciFile")) {
                Fail "AGENTS.md mapping table references missing CI file: .github/workflows/$ciFile"
            }
            $checkedCiFiles++
        }
    }
    Write-Host "AGENTS.md mapping table check ok ($checkedScripts script paths, $checkedCiFiles CI files)"
}

Assert-AgentsMdMappingTable

# --- 脚本镜像防线:scripts/ 脚本文件名禁止在 tests/ 出现同名(SSOT 收敛) ---
function Assert-NoScriptMirror {
    $scriptLeaves = @(git ls-files "scripts/" | ForEach-Object { Normalize-Path $_ } | ForEach-Object { Split-Path $_ -Leaf })
    $mirrors = @(git ls-files "tests/" | ForEach-Object { Normalize-Path $_ } |
        Where-Object { $_ -match '\.(ps1|sh|mjs|py)$' } |
        ForEach-Object { Split-Path $_ -Leaf } |
        Where-Object { $scriptLeaves -contains $_ })
    if ($mirrors.Count -gt 0) {
        Fail ("tests/ must not mirror scripts/ script names: " + (($mirrors | Sort-Object -Unique) -join ", "))
    }
    Write-Host "script mirror check ok (no tests/ file shares a scripts/ script name)"
}

Assert-NoScriptMirror

Write-Host "doc SSOT ok"
