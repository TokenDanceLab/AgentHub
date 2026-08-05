#!/usr/bin/env python3
"""Static topology verifier for the P1 live-chain audit — ps1 迁移。

It checks that the expected Web -> Hub -> Desktop -> Local Edge -> Hub replay
chain is still present. It also performs a focused production Web source scan
for direct Local Edge paths while excluding test-only E2E fixtures.
"""

import argparse
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

REQUIRED_FILES = [
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
    "scripts/verify/verify-web-hub-boundary.py",
]

# (relative path, regex pattern, label) — PowerShell -match is case-insensitive,
# so re.IGNORECASE keeps assertion semantics identical.
CONTAINS_CHECKS = [
    # Hub route and dispatch checks
    ("hub-server/internal/router/router.go", r'web\.POST\("/agent-tasks",\s*agentHandler\.TriggerTask\)', "Hub exposes Web agent task trigger"),
    ("hub-server/internal/router/router.go", r'web\.GET\("/execution-targets",\s*targetHandler\.ListTargets\)', "Hub exposes Web execution target inventory"),
    ("hub-server/internal/router/router.go", r'web\.POST\("/agent-teams/:id/runs",\s*agentTeamHandler\.StartRun\)', "Hub exposes TeamRun start"),
    ("hub-server/internal/router/router.go", r'edge\.POST\("/devices/register",\s*deviceHandler\.Register\)', "Hub exposes Desktop device registration"),
    ("hub-server/internal/router/router.go", r'edge\.POST\("/agent-tasks/:id/ack",\s*agentHandler\.TaskAck\)', "Hub exposes Edge task ack callback"),
    ("hub-server/internal/router/router.go", r'edge\.POST\("/agent-tasks/:id/stream",\s*agentHandler\.TaskStream\)', "Hub exposes Edge task stream callback"),
    ("hub-server/internal/router/router.go", r'edge\.POST\("/agent-tasks/:id/done",\s*agentHandler\.TaskDone\)', "Hub exposes Edge task done callback"),
    ("hub-server/internal/router/router.go", r'edge\.POST\("/agent-tasks/:id/fail",\s*agentHandler\.TaskFail\)', "Hub exposes Edge task fail callback"),
    ("hub-server/internal/handler/agent.go", r'TargetID\s+string\s+`json:"target_id,omitempty"`', "Web task handler accepts target_id"),
    ("hub-server/internal/service/agent_dispatch.go", r"func \(s \*AgentService\) validateDispatchTarget", "Hub validates dispatch target"),
    ("hub-server/internal/service/agent_dispatch.go", r'target\.TargetType != "local_edge"', "Hub dispatch currently rejects non-local_edge targets"),
    ("hub-server/internal/service/agent_dispatch.go", r'device\.DeviceType != "desktop"', "Hub dispatch requires Desktop-bound target"),
    ("hub-server/internal/service/agent_dispatch.go", r'GetRouteForDevice\(ctx,\s*userID,\s*"desktop",\s*deviceID\)', "Hub target-bound dispatch routes to exact Desktop device"),
    ("hub-server/internal/service/agent_dispatch.go", r"PushPendingTargetTask\(ctx,\s*userID,\s*task\.TargetID,\s*deviceID", "Hub preserves target-bound task when Desktop route is unavailable"),
    ("hub-server/internal/service/execution_target.go", r"func \(s \*ExecutionTargetService\) UpsertLocalEdgeForDesktopDevice", "Desktop registration upserts local_edge target"),
    ("hub-server/internal/service/execution_target.go", r'case "local_edge":\s*return repository\.UpdateTargetOnlineStatus', "local_edge ping updates target online status"),
    ("hub-server/internal/service/agent_team.go", r"func \(s \*AgentTeamService\) StartTeamRun", "TeamRun service starts supervisor dispatch"),
    ("hub-server/internal/service/agent_team.go", r"TriggerAgentTask\(ctx,\s*userID,\s*triggerMessageID,\s*supervisorAIID", "TeamRun supervisor uses Hub agent dispatch"),
    ("hub-server/internal/service/agent_team.go", r"func \(s \*AgentTeamService\) DispatchAssignment", "TeamRun assignment dispatch exists"),
    # Web checks
    ("app/web/src/platform/webPlatform.ts", r"localEdge:\s*false", "Web platform declares no localEdge capability"),
    ("app/web/src/platform/webPlatform.ts", r"localFiles:\s*false", "Web platform declares no localFiles capability"),
    ("app/web/src/platform/webPlatform.ts", r"resolveWebDispatchTarget", "Web resolves dispatch target through Hub inventory"),
    ("app/web/src/platform/webPlatform.ts", r"target_type:\s*'local_edge'", "Web lists only local_edge targets for dispatch"),
    ("app/web/src/platform/webPlatform.ts", r"target\.is_online\s*===\s*true", "Web composer dispatch requires online target"),
    ("app/web/src/platform/webPlatform.ts", r"target\.health_state\s*!==\s*'offline'", "Web composer dispatch rejects offline health state"),
    ("app/web/src/platform/webPlatform.ts", r"target_id:\s*target\.id", "Web sends selected target_id to Hub"),
    ("app/web/src/platform/useWebWorkbenchModel.ts", r"useWebHubRealtime", "Web workbench subscribes Hub realtime runtime events"),
    ("app/web/src/platform/useWebWorkbenchModel.ts", r"useHubExecutionTargets", "Web workbench loads Hub execution targets"),
    ("app/web/src/views/TeamRunConsole.tsx", r"target\.target_type\s*===\s*'local_edge'", "TeamRun target list filters local_edge"),
    ("app/web/src/views/TeamRunConsole.tsx", r"target\.is_online\s*===\s*true", "TeamRun target list requires online target"),
    ("app/web/src/views/TeamRunConsole.tsx", r"target\.health_state\s*!==\s*'offline'", "TeamRun target list rejects offline health state"),
    ("app/web/src/views/TeamRunConsole.tsx", r"target_id:\s*selectedRunTarget\.id", "TeamRun start sends selected target_id"),
    ("app/web/src/api/hubClient.ts", r"/web/agent-tasks", "Web Hub client calls Web agent task endpoint"),
    ("app/web/src/api/hubClient.ts", r"/web/execution-targets", "Web Hub client calls execution target inventory"),
    ("app/web/src/api/hubClient.ts", r"/web/agent-teams/.*/runs", "Web Hub client calls TeamRun endpoint"),
    # Desktop bridge checks
    ("app/desktop/src/components/DesktopHubTaskBridge.tsx", r"useHubIntegration", "Desktop bridge mounts Hub integration hook"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"HUB_EVENTS\.AGENT_DISPATCH", "Desktop listens for Hub agent.dispatch"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"fetch\(`\$\{edgeBaseUrl\}/v1/runs`", "Desktop posts Hub dispatch to Local Edge /v1/runs"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"/v1/events", "Desktop subscribes Local Edge /v1/events"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"hubClient\.ackTask", "Desktop acks Hub task"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"hubClient\.streamTaskEvent", "Desktop streams runtime events back to Hub"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"hubClient\.doneTask", "Desktop completes Hub task"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"hubClient\.failTask", "Desktop fails Hub task"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"postTeamRouteDecision", "Desktop forwards TeamRun route decisions"),
    ("app/desktop/src/hooks/useHubIntegration.ts", r"HUB_AGENT_CONTROL_EVENT", "Desktop handles Hub-originated agent.control"),
    # Local Edge and adapter checks
    ("edge-server/internal/api/handlers.go", r"func \(h \*Handler\) PostRuns", "Local Edge implements POST /v1/runs"),
    ("edge-server/internal/api/handlers.go", r'HubTaskID\s+string\s+`json:"hubTaskId"`', "Local Edge accepts hubTaskId for callbacks"),
    ("edge-server/internal/api/handlers.go", r"ErrWorkspaceNotAllowed", "Local Edge enforces workspace allowlist"),
    ("edge-server/internal/api/handlers.go", r"unknown agent adapter", "Local Edge rejects unknown explicit adapter"),
    ("edge-server/internal/api/handlers.go", r"func \(h \*Handler\) GetEvents", "Local Edge implements /v1/events"),
    ("edge-server/internal/httpserver/server.go", r"NewProcessExecutor", "Local Edge wires ProcessExecutor"),
    ("edge-server/internal/httpserver/server.go", r"SetHubCallback|WithHubCallback", "Local Edge can wire direct Hub callbacks"),
    ("edge-server/internal/lifecycle/process_executor.go", r"func \(e \*ProcessExecutor\) Start", "ProcessExecutor starts runs"),
    ("edge-server/internal/lifecycle/process_executor.go", r"adapter\.BuildCommand", "ProcessExecutor calls adapter BuildCommand"),
    ("edge-server/internal/lifecycle/process_executor.go", r"func \(e \*ProcessExecutor\) fireHubDone", "ProcessExecutor supports Hub done callback"),
    ("edge-server/internal/orchestration/contracts.go", r"BuildCommand\(ctx RunProcessContext\)", "Adapter contract includes BuildCommand (SSOT: internal/orchestration)"),
    ("edge-server/internal/adapters/codex.go", r"func \(a \*CodexAdapter\) BuildCommand", "Codex adapter builds command"),
    ("edge-server/internal/adapters/codex.go", r'args = append\(args, "exec"\)', "Codex adapter invokes codex exec"),
    ("edge-server/internal/adapters/codex.go", r"--skip-git-repo-check", "Codex adapter supports non-git temporary workspaces"),
    ("edge-server/internal/adapters/sdk_fixture_mapper.go", r"func MapSDKFixtureStream", "SDK fixture mapper exists"),
]

# (regex pattern, label) scanned against production app/web/src only.
NO_PRODUCTION_WEB_MATCHES = [
    (r"127\.0\.0\.1:3210|localhost:3210", "Local Edge loopback URL"),
    (r"/v1/events|/v1/runs", "Local Edge event/run API"),
    (r"edgeBaseUrl|edgeAuthHeaders|withEdgeAuthQuery|createEventStream", "legacy Edge bridge helper"),
    (r"@tauri-apps/|app/desktop/|src-tauri|desktopHost|localEdgeRuntime", "Desktop/Tauri import or runtime reference"),
]

passed = 0
failed = 0


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}")


def repo_path(repo_root: str, relative_path: str) -> str:
    return os.path.join(repo_root, relative_path.replace("/", os.sep))


def read_text(path: str) -> str:
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def assert_file(repo_root: str, relative_path: str) -> None:
    if os.path.isfile(repo_path(repo_root, relative_path)):
        pass_check(f"{relative_path} exists")
    else:
        fail_check(f"{relative_path} missing")


def assert_contains(repo_root: str, relative_path: str, pattern: str, label: str) -> None:
    path = repo_path(repo_root, relative_path)
    if not os.path.isfile(path):
        fail_check(f"{label} ({relative_path} missing)")
        return
    if re.search(pattern, read_text(path), re.IGNORECASE):
        pass_check(label)
    else:
        fail_check(f"{label} ({relative_path} did not match /{pattern}/)")


def assert_no_production_web_matches(repo_root: str, pattern: str, label: str) -> None:
    web_src = repo_path(repo_root, "app/web/src")
    if not os.path.isdir(web_src):
        fail_check(f"{label} (app/web/src missing)")
        return

    production_files = []
    for dirpath, dirnames, filenames in os.walk(web_src):
        dirnames[:] = sorted(dirnames)
        for name in sorted(filenames):
            full_path = os.path.join(dirpath, name)
            if os.path.splitext(name)[1].lower() not in (".ts", ".tsx", ".js", ".jsx", ".json"):
                continue
            normalized = full_path.replace("\\", "/")
            if "/__e2e__/" in normalized:
                continue
            if re.search(r"/tests?/|\.test\.|\.spec\.", normalized, re.IGNORECASE):
                continue
            production_files.append(full_path)

    matches = []
    for full_path in production_files:
        for line_number, line in enumerate(read_text(full_path).splitlines(), start=1):
            if re.search(pattern, line, re.IGNORECASE):
                matches.append((full_path, line_number))

    if matches:
        for full_path, line_number in matches:
            relative = os.path.relpath(full_path, repo_root).replace("\\", "/")
            fail_check(f"{label} found in {relative}:{line_number}")
    else:
        pass_check(f"{label} absent from production app/web/src")


def main() -> int:
    global passed, failed
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=DEFAULT_REPO_ROOT, help="repository root (defaults to the script's repo)")
    args = parser.parse_args()

    repo_root = os.path.abspath(args.RepoRoot)
    passed = 0
    failed = 0

    print("\n=== Live chain topology static verifier ===")
    for file in REQUIRED_FILES:
        assert_file(repo_root, file)

    print("\n=== Hub route and dispatch checks ===")
    for relative_path, pattern, label in CONTAINS_CHECKS[:19]:
        assert_contains(repo_root, relative_path, pattern, label)

    print("\n=== Web checks ===")
    for relative_path, pattern, label in CONTAINS_CHECKS[19:35]:
        assert_contains(repo_root, relative_path, pattern, label)

    print("\n=== Desktop bridge checks ===")
    for relative_path, pattern, label in CONTAINS_CHECKS[35:45]:
        assert_contains(repo_root, relative_path, pattern, label)

    print("\n=== Local Edge and adapter checks ===")
    for relative_path, pattern, label in CONTAINS_CHECKS[45:]:
        assert_contains(repo_root, relative_path, pattern, label)

    print("\n=== Production Web Hub-only boundary ===")
    for pattern, label in NO_PRODUCTION_WEB_MATCHES:
        assert_no_production_web_matches(repo_root, pattern, label)

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}")
    print("========================================")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
