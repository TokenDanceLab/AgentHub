#!/usr/bin/env pwsh
<#
Static topology verifier for the P1 live-chain audit.

It checks that the expected Web -> Hub -> Desktop -> Local Edge -> Hub replay
chain is still present. It also performs a focused production Web source scan
for direct Local Edge paths while excluding test-only E2E fixtures.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
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

function RepoPath([string]$RelativePath) {
    return Join-Path $RepoRoot $RelativePath
}

function Assert-File([string]$RelativePath) {
    $path = RepoPath $RelativePath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Pass "$RelativePath exists"
        return
    }
    Fail "$RelativePath missing"
}

function Assert-Contains([string]$RelativePath, [string]$Pattern, [string]$Label) {
    $path = RepoPath $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Fail "$Label ($RelativePath missing)"
        return
    }
    $text = Get-Content -Raw -LiteralPath $path
    if ($text -match $Pattern) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath did not match /$Pattern/)"
    }
}

function Assert-NoProductionWebMatches([string]$Pattern, [string]$Label) {
    $webSrc = RepoPath "app/web/src"
    if (-not (Test-Path -LiteralPath $webSrc -PathType Container)) {
        Fail "$Label (app/web/src missing)"
        return
    }
    $files = Get-ChildItem -LiteralPath $webSrc -Recurse -File |
        Where-Object {
            $_.Extension -in @(".ts", ".tsx", ".js", ".jsx", ".json") -and
            $_.FullName -notmatch [regex]::Escape((Join-Path $webSrc "__e2e__")) -and
            $_.FullName -notmatch '\\tests?\\|\.test\.|\.spec\.'
        }
    $matches = $files | Select-String -Pattern $Pattern
    if ($matches) {
        foreach ($match in $matches) {
            $relative = [System.IO.Path]::GetRelativePath($RepoRoot, $match.Path).Replace("\", "/")
            Fail "$Label found in ${relative}:$($match.LineNumber)"
        }
    } else {
        Pass "$Label absent from production app/web/src"
    }
}

Write-Host "`n=== Live chain topology static verifier ===" -ForegroundColor Cyan

$RequiredFiles = @(
    "hub-server/internal/router/router.go",
    "hub-server/internal/handler/agent.go",
    "hub-server/internal/handler/agent_team.go",
    "hub-server/internal/handler/device.go",
    "hub-server/internal/handler/execution_target.go",
    "hub-server/internal/service/agent_dispatch.go",
    "hub-server/internal/service/execution_target.go",
    "hub-server/internal/service/agent_team.go",
    "hub-server/migrations/0047_execution_target_local_edge_uniqueness.up.sql",
    "api/openapi.yaml",
    "api/events.md",
    "app/web/src/platform/webPlatform.ts",
    "app/web/src/platform/useWebWorkbenchModel.ts",
    "app/web/src/views/TeamRunConsole.tsx",
    "app/web/src/api/hubClient.ts",
    "app/desktop/src/components/DesktopHubTaskBridge.tsx",
    "app/desktop/src/hooks/useHubIntegration.ts",
    "edge-server/internal/httpserver/server.go",
    "edge-server/internal/api/handlers.go",
    "edge-server/internal/lifecycle/process_executor.go",
    "edge-server/internal/adapters/adapter.go",
    "edge-server/internal/adapters/codex.go",
    "edge-server/internal/adapters/sdk_fixture_mapper.go",
    "scripts/verify/verify-web-hub-boundary.ps1"
)

foreach ($file in $RequiredFiles) {
    Assert-File $file
}

Write-Host "`n=== Hub route and dispatch checks ===" -ForegroundColor Cyan
Assert-Contains "hub-server/internal/router/router.go" 'web\.POST\("/agent-tasks",\s*agentHandler\.TriggerTask\)' "Hub exposes Web agent task trigger"
Assert-Contains "hub-server/internal/router/router.go" 'web\.GET\("/execution-targets",\s*targetHandler\.ListTargets\)' "Hub exposes Web execution target inventory"
Assert-Contains "hub-server/internal/router/router.go" 'web\.POST\("/agent-teams/:id/runs",\s*agentTeamHandler\.StartRun\)' "Hub exposes TeamRun start"
Assert-Contains "hub-server/internal/router/router.go" 'edge\.POST\("/devices/register",\s*deviceHandler\.Register\)' "Hub exposes Desktop device registration"
Assert-Contains "hub-server/internal/router/router.go" 'edge\.POST\("/agent-tasks/:id/ack",\s*agentHandler\.TaskAck\)' "Hub exposes Edge task ack callback"
Assert-Contains "hub-server/internal/router/router.go" 'edge\.POST\("/agent-tasks/:id/stream",\s*agentHandler\.TaskStream\)' "Hub exposes Edge task stream callback"
Assert-Contains "hub-server/internal/router/router.go" 'edge\.POST\("/agent-tasks/:id/done",\s*agentHandler\.TaskDone\)' "Hub exposes Edge task done callback"
Assert-Contains "hub-server/internal/router/router.go" 'edge\.POST\("/agent-tasks/:id/fail",\s*agentHandler\.TaskFail\)' "Hub exposes Edge task fail callback"
Assert-Contains "hub-server/internal/handler/agent.go" 'TargetID\s+string\s+`json:"target_id,omitempty"`' "Web task handler accepts target_id"
Assert-Contains "hub-server/internal/service/agent_dispatch.go" 'func \(s \*AgentService\) validateDispatchTarget' "Hub validates dispatch target"
Assert-Contains "hub-server/internal/service/agent_dispatch.go" 'target\.TargetType != "local_edge"' "Hub dispatch currently rejects non-local_edge targets"
Assert-Contains "hub-server/internal/service/agent_dispatch.go" 'device\.DeviceType != "desktop"' "Hub dispatch requires Desktop-bound target"
Assert-Contains "hub-server/internal/service/agent_dispatch.go" 'GetRouteForDevice\(ctx,\s*userID,\s*"desktop",\s*deviceID\)' "Hub target-bound dispatch routes to exact Desktop device"
Assert-Contains "hub-server/internal/service/agent_dispatch.go" 'PushPendingTargetTask\(ctx,\s*userID,\s*task\.TargetID,\s*deviceID' "Hub preserves target-bound task when Desktop route is unavailable"
Assert-Contains "hub-server/internal/service/execution_target.go" 'func \(s \*ExecutionTargetService\) UpsertLocalEdgeForDesktopDevice' "Desktop registration upserts local_edge target"
Assert-Contains "hub-server/internal/service/execution_target.go" 'case "local_edge":\s*return repository\.UpdateTargetOnlineStatus' "local_edge ping updates target online status"
Assert-Contains "hub-server/internal/service/agent_team.go" 'func \(s \*AgentTeamService\) StartTeamRun' "TeamRun service starts supervisor dispatch"
Assert-Contains "hub-server/internal/service/agent_team.go" 'TriggerAgentTask\(ctx,\s*userID,\s*triggerMessageID,\s*supervisorAIID' "TeamRun supervisor uses Hub agent dispatch"
Assert-Contains "hub-server/internal/service/agent_team.go" 'func \(s \*AgentTeamService\) DispatchAssignment' "TeamRun assignment dispatch exists"

Write-Host "`n=== Web checks ===" -ForegroundColor Cyan
Assert-Contains "app/web/src/platform/webPlatform.ts" 'localEdge:\s*false' "Web platform declares no localEdge capability"
Assert-Contains "app/web/src/platform/webPlatform.ts" 'localFiles:\s*false' "Web platform declares no localFiles capability"
Assert-Contains "app/web/src/platform/webPlatform.ts" 'resolveWebDispatchTarget' "Web resolves dispatch target through Hub inventory"
Assert-Contains "app/web/src/platform/webPlatform.ts" 'target_type:\s*''local_edge''' "Web lists only local_edge targets for dispatch"
Assert-Contains "app/web/src/platform/webPlatform.ts" 'target\.is_online\s*===\s*true' "Web composer dispatch requires online target"
Assert-Contains "app/web/src/platform/webPlatform.ts" 'target\.health_state\s*!==\s*''offline''' "Web composer dispatch rejects offline health state"
Assert-Contains "app/web/src/platform/webPlatform.ts" 'target_id:\s*target\.id' "Web sends selected target_id to Hub"
Assert-Contains "app/web/src/platform/useWebWorkbenchModel.ts" 'useWebHubRealtime' "Web workbench subscribes Hub realtime runtime events"
Assert-Contains "app/web/src/platform/useWebWorkbenchModel.ts" 'useHubExecutionTargets' "Web workbench loads Hub execution targets"
Assert-Contains "app/web/src/views/TeamRunConsole.tsx" 'target\.target_type\s*===\s*''local_edge''' "TeamRun target list filters local_edge"
Assert-Contains "app/web/src/views/TeamRunConsole.tsx" 'target\.is_online\s*===\s*true' "TeamRun target list requires online target"
Assert-Contains "app/web/src/views/TeamRunConsole.tsx" 'target\.health_state\s*!==\s*''offline''' "TeamRun target list rejects offline health state"
Assert-Contains "app/web/src/views/TeamRunConsole.tsx" 'target_id:\s*selectedRunTarget\.id' "TeamRun start sends selected target_id"
Assert-Contains "app/web/src/api/hubClient.ts" '/web/agent-tasks' "Web Hub client calls Web agent task endpoint"
Assert-Contains "app/web/src/api/hubClient.ts" '/web/execution-targets' "Web Hub client calls execution target inventory"
Assert-Contains "app/web/src/api/hubClient.ts" '/web/agent-teams/.*/runs' "Web Hub client calls TeamRun endpoint"

Write-Host "`n=== Desktop bridge checks ===" -ForegroundColor Cyan
Assert-Contains "app/desktop/src/components/DesktopHubTaskBridge.tsx" 'useHubIntegration' "Desktop bridge mounts Hub integration hook"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" 'HUB_EVENTS\.AGENT_DISPATCH' "Desktop listens for Hub agent.dispatch"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" 'fetch\(`\$\{edgeBaseUrl\}/v1/runs`' "Desktop posts Hub dispatch to Local Edge /v1/runs"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" '/v1/events' "Desktop subscribes Local Edge /v1/events"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" 'hubClient\.ackTask' "Desktop acks Hub task"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" 'hubClient\.streamTaskEvent' "Desktop streams runtime events back to Hub"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" 'hubClient\.doneTask' "Desktop completes Hub task"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" 'hubClient\.failTask' "Desktop fails Hub task"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" 'postTeamRouteDecision' "Desktop forwards TeamRun route decisions"
Assert-Contains "app/desktop/src/hooks/useHubIntegration.ts" 'HUB_AGENT_CONTROL_EVENT' "Desktop handles Hub-originated agent.control"

Write-Host "`n=== Local Edge and adapter checks ===" -ForegroundColor Cyan
Assert-Contains "edge-server/internal/api/handlers.go" 'func \(h \*Handler\) PostRuns' "Local Edge implements POST /v1/runs"
Assert-Contains "edge-server/internal/api/handlers.go" 'HubTaskID\s+string\s+`json:"hubTaskId"`' "Local Edge accepts hubTaskId for callbacks"
Assert-Contains "edge-server/internal/api/handlers.go" 'ErrWorkspaceNotAllowed' "Local Edge enforces workspace allowlist"
Assert-Contains "edge-server/internal/api/handlers.go" 'unknown agent adapter' "Local Edge rejects unknown explicit adapter"
Assert-Contains "edge-server/internal/api/handlers.go" 'func \(h \*Handler\) GetEvents' "Local Edge implements /v1/events"
Assert-Contains "edge-server/internal/httpserver/server.go" 'NewProcessExecutor' "Local Edge wires ProcessExecutor"
Assert-Contains "edge-server/internal/httpserver/server.go" 'SetHubCallback|WithHubCallback' "Local Edge can wire direct Hub callbacks"
Assert-Contains "edge-server/internal/lifecycle/process_executor.go" 'func \(e \*ProcessExecutor\) Start' "ProcessExecutor starts runs"
Assert-Contains "edge-server/internal/lifecycle/process_executor.go" 'adapter\.BuildCommand' "ProcessExecutor calls adapter BuildCommand"
Assert-Contains "edge-server/internal/lifecycle/process_executor.go" 'func \(e \*ProcessExecutor\) fireHubDone' "ProcessExecutor supports Hub done callback"
Assert-Contains "edge-server/internal/orchestration/contracts.go" 'BuildCommand\(ctx RunProcessContext\)' "Adapter contract includes BuildCommand (SSOT: internal/orchestration)"
Assert-Contains "edge-server/internal/adapters/codex.go" 'func \(a \*CodexAdapter\) BuildCommand' "Codex adapter builds command"
Assert-Contains "edge-server/internal/adapters/codex.go" 'args = append\(args, "exec"\)' "Codex adapter invokes codex exec"
Assert-Contains "edge-server/internal/adapters/codex.go" '--skip-git-repo-check' "Codex adapter supports non-git temporary workspaces"
Assert-Contains "edge-server/internal/adapters/sdk_fixture_mapper.go" 'func MapSDKFixtureStream' "SDK fixture mapper exists"

Write-Host "`n=== Production Web Hub-only boundary ===" -ForegroundColor Cyan
Assert-NoProductionWebMatches '127\.0\.0\.1:3210|localhost:3210' "Local Edge loopback URL"
Assert-NoProductionWebMatches '/v1/events|/v1/runs' "Local Edge event/run API"
Assert-NoProductionWebMatches 'edgeBaseUrl|edgeAuthHeaders|withEdgeAuthQuery|createEventStream' "legacy Edge bridge helper"
Assert-NoProductionWebMatches '@tauri-apps/|app/desktop/|src-tauri|desktopHost|localEdgeRuntime' "Desktop/Tauri import or runtime reference"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
