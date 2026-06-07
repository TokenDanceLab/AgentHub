#!/usr/bin/env pwsh
<#
Verify that Desktop/Web v4 do not route through the retired main workbench UI.

Old utility components may still exist temporarily as migration material, tests,
or type fixtures. The retired Chat/Prompt/Thread/IM hook files must stay
deleted, and active app source must not import old workbench paths.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
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

function Relative([string]$Path) {
    return [System.IO.Path]::GetRelativePath($RepoRoot, $Path).Replace("\", "/")
}

function Get-ActiveSourceFiles([string]$Root) {
    Get-ChildItem -LiteralPath $Root -Recurse -File |
        Where-Object {
            $_.Extension -in @(".ts", ".tsx", ".js", ".jsx") -and
            $_.FullName -notmatch "\\(__tests__|__e2e__)\\|(\.test|\.spec|\.stories)\."
        }
}

Write-Host "`n=== v4 old UI active path boundary ===" -ForegroundColor Cyan

$RemovedActiveFiles = @(
    "app/desktop/src/config/viewRegistry.ts",
    "app/desktop/src/views/viewRegistry.tsx",
    "app/desktop/src/views/MainView.tsx",
    "app/desktop/src/views/IMView.tsx",
    "app/web/src/viewRegistryConfig.ts",
    "app/web/src/views/viewRegistry.tsx",
    "app/web/src/views/MainView.tsx",
    "app/web/src/views/IMView.tsx",
    "app/desktop/src/components/ChatView.tsx",
    "app/desktop/src/components/ChatView.module.css",
    "app/desktop/src/components/ChatView.types.ts",
    "app/desktop/src/components/PromptInput.tsx",
    "app/desktop/src/components/PromptInput.module.css",
    "app/desktop/src/components/ThreadPanel.tsx",
    "app/desktop/src/components/ThreadPanel.module.css",
    "app/desktop/src/hooks/useChatMessages.ts",
    "app/desktop/src/hooks/useIMChat.ts",
    "app/desktop/src/components/IM/IMBlockRenderer.tsx",
    "app/desktop/src/components/IM/IMBlockRenderer.module.css",
    "app/desktop/src/components/IM/IMMessageView.tsx",
    "app/desktop/src/components/IM/IMMessageView.module.css",
    "app/web/src/components/ChatView.tsx",
    "app/web/src/components/ChatView.module.css",
    "app/web/src/components/ChatView.types.ts",
    "app/web/src/components/PromptInput.tsx",
    "app/web/src/components/PromptInput.module.css",
    "app/web/src/components/ThreadPanel.tsx",
    "app/web/src/components/ThreadPanel.module.css",
    "app/web/src/components/RunDetail.tsx",
    "app/web/src/components/RunDetail.module.css",
    "app/web/src/components/ReplyPreviewBar.tsx",
    "app/web/src/components/ReplyPreviewBar.module.css",
    "app/web/src/hooks/useIMChat.ts",
    "app/web/src/components/IM/IMMessageView.tsx",
    "app/web/src/components/IM/IMMessageView.module.css"
)

foreach ($relativePath in $RemovedActiveFiles) {
    $path = Join-Path $RepoRoot $relativePath
    if (Test-Path -LiteralPath $path) {
        Fail "$relativePath should not exist as an active v4 route entry"
    } else {
        Pass "$relativePath remains removed"
    }
}

$SourceRoots = @(
    (Join-Path $RepoRoot "app/desktop/src"),
    (Join-Path $RepoRoot "app/web/src")
)

$SourceFiles = @()
foreach ($root in $SourceRoots) {
    $SourceFiles += Get-ActiveSourceFiles $root
}

$ForbiddenImports = @(
    @{ Pattern = "from ['""]@/components/ChatView['""]|import\(['""]@/components/ChatView['""]\)"; Label = "old ChatView import" },
    @{ Pattern = "from ['""]@/components/PromptInput['""]|import\(['""]@/components/PromptInput['""]\)"; Label = "old PromptInput import" },
    @{ Pattern = "from ['""]@/components/RunDetail['""]|import\(['""]@/components/RunDetail['""]\)"; Label = "old RunDetail import" },
    @{ Pattern = "from ['""]@/components/ThreadPanel['""]|import\(['""]@/components/ThreadPanel['""]\)"; Label = "old ThreadPanel import" },
    @{ Pattern = "from ['""]@/components/IM/IMBlockRenderer['""]|import\(['""]@/components/IM/IMBlockRenderer['""]\)"; Label = "old IMBlockRenderer import" },
    @{ Pattern = "from ['""]@/hooks/useChatMessages['""]|import\(['""]@/hooks/useChatMessages['""]\)"; Label = "old useChatMessages import" },
    @{ Pattern = "from ['""]@/hooks/useIMChat['""]|import\(['""]@/hooks/useIMChat['""]\)"; Label = "old useIMChat import" },
    @{ Pattern = "from ['""](@/components/ChatView\.types|\./ChatView\.types|\.\./ChatView\.types)['""]|import\(['""](@/components/ChatView\.types|\./ChatView\.types|\.\./ChatView\.types)['""]\)"; Label = "old ChatView.types import" },
    @{ Pattern = "from ['""]@/(config/viewRegistry|viewRegistryConfig|views/viewRegistry)['""]|import\(['""]@/(config/viewRegistry|viewRegistryConfig|views/viewRegistry)['""]\)"; Label = "old viewRegistry import" }
)

foreach ($entry in $ForbiddenImports) {
    $matches = $SourceFiles | Select-String -Pattern $entry.Pattern
    if ($matches) {
        foreach ($match in $matches) {
            Fail "$($entry.Label) found in $(Relative $match.Path):$($match.LineNumber)"
        }
    } else {
        Pass "$($entry.Label) absent from active Desktop/Web source"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
