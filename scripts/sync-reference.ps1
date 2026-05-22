# Clone or update public reference repositories.
# Reference repositories are ignored by git; only reference/INDEX.md is tracked.

[CmdletBinding()]
param(
    [ValidateSet("core", "all")]
    [string]$Tier = "core"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ReferenceRoot = Join-Path $Root "reference"

$repos = @(
    @{ Tier = "core"; Name = "multica"; Url = "https://github.com/multica-ai/multica.git" },
    @{ Tier = "core"; Name = "codex"; Url = "https://github.com/openai/codex.git" },
    @{ Tier = "core"; Name = "opencode"; Url = "https://github.com/anomalyco/opencode.git" },
    @{ Tier = "core"; Name = "OpenHands"; Url = "https://github.com/All-Hands-AI/OpenHands.git" },
    @{ Tier = "core"; Name = "claudecodeui"; Url = "https://github.com/siteboon/claudecodeui.git" },
    @{ Tier = "core"; Name = "opcode"; Url = "https://github.com/winfunc/opcode.git" },

    @{ Tier = "all"; Name = "aider"; Url = "https://github.com/Aider-AI/aider.git" },
    @{ Tier = "all"; Name = "ChatDev"; Url = "https://github.com/OpenBMB/ChatDev.git" },
    @{ Tier = "all"; Name = "claude-code-viewer"; Url = "https://github.com/d-kimuson/claude-code-viewer.git" },
    @{ Tier = "all"; Name = "claude-code-webui"; Url = "https://github.com/sugyan/claude-code-webui.git" },
    @{ Tier = "all"; Name = "cline"; Url = "https://github.com/cline/cline.git" },
    @{ Tier = "all"; Name = "continue"; Url = "https://github.com/continuedev/continue.git" },
    @{ Tier = "all"; Name = "crush"; Url = "https://github.com/charmbracelet/crush.git" },
    @{ Tier = "all"; Name = "dify"; Url = "https://github.com/langgenius/dify.git" },
    @{ Tier = "all"; Name = "eca"; Url = "https://github.com/editor-code-assistant/eca.git" },
    @{ Tier = "all"; Name = "emdash"; Url = "https://github.com/generalaction/emdash.git" },
    @{ Tier = "all"; Name = "Flowise"; Url = "https://github.com/FlowiseAI/Flowise.git" },
    @{ Tier = "all"; Name = "goose"; Url = "https://github.com/aaif-goose/goose.git" },
    @{ Tier = "all"; Name = "jean"; Url = "https://github.com/coollabsio/jean.git" },
    @{ Tier = "all"; Name = "kanna"; Url = "https://github.com/jakemor/kanna.git" },
    @{ Tier = "all"; Name = "langflow"; Url = "https://github.com/langflow-ai/langflow.git" },
    @{ Tier = "all"; Name = "LibreChat"; Url = "https://github.com/danny-avila/LibreChat.git" },
    @{ Tier = "all"; Name = "orca"; Url = "https://github.com/stablyai/orca.git" },
    @{ Tier = "all"; Name = "picoclaw"; Url = "https://github.com/sipeed/picoclaw.git" },
    @{ Tier = "all"; Name = "Roo-Code"; Url = "https://github.com/RooCodeInc/Roo-Code.git" },
    @{ Tier = "all"; Name = "ruflo"; Url = "https://github.com/ruvnet/ruflo.git" }
)

$selected = if ($Tier -eq "core") {
    $repos | Where-Object { $_.Tier -eq "core" }
} else {
    $repos
}

New-Item -ItemType Directory -Force -Path $ReferenceRoot | Out-Null

foreach ($repo in $selected) {
    $target = Join-Path $ReferenceRoot $repo.Name
    if (Test-Path (Join-Path $target ".git")) {
        Write-Host "Updating reference/$($repo.Name)"
        git -C $target pull --ff-only
    } elseif (Test-Path $target) {
        Write-Warning "Skipping reference/$($repo.Name): directory exists but is not a git repository"
    } else {
        Write-Host "Cloning reference/$($repo.Name)"
        git clone --depth 1 $repo.Url $target
    }
}

Write-Host "Reference sync complete. See reference/INDEX.md for the full reading map."
