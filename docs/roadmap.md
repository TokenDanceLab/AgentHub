# AgentHub 48h Sprint Roadmap

> Last updated: 2026-06-09 01:25 +08:00
> Baseline: `origin/dev/delicious233 @ 4700ad0b`
> Integration worktree: `codex/p0-remote-control-integration` / `.worktrees/p0-remote-control-integration`

Old merge history remains in `docs/archive/roadmap-pre-refresh-20260608-1008.md` and `docs/archive/roadmap-full-history-20260605.md`. This file is the short sprint board and branch ledger.

## 48h P0

Make Desktop and Web usable through one remote-control loop:

```text
Web -> Hub -> registered Desktop/Edge -> Local Edge -> CLI adapter
```

The sprint succeeds when Web can start or control work through Hub, Hub targets one owner-scoped registered Desktop/Edge, Desktop receives the dispatch, Local Edge starts the run through an adapter, and Web/Desktop can replay the run state plus evidence. Mobile is out of implementation scope for this thread, but the same Hub-mediated protocol must remain reusable by Mobile.

P0 fixture topology now proves Web authenticated Hub session can address a registered Desktop/Edge target. Real TokenDanceID/OIDC login and real CLI/model execution remain explicit approval gates.

## Current Baseline

- Backend is mainlined for this sprint: Hub/Edge contracts, target-bound dispatch, fake/local login gates, Desktop packaged Local Edge SQLite, Edge SQL readmodel, TeamRun fixture evidence, Web Projects/Icons, Tauri/macOS dry policy, and SDK fixture mapper are already on dev.
- `codex/p0-remote-control-integration` is the unified P0 baseline for new work. It has absorbed Hub exact target dispatch, Web composer target selection, TeamRun target routing, Desktop Hub bridge mount, Edge CLI adapter validation, Edge brokered permission decisions, shared `agent.control`, FIFO exact-device replay, login topology, and evidence taxonomy.
- The local main worktree is dirty and behind; do not use it for implementation or evidence. New implementation worktrees must fork from the unified P0 baseline or from `origin/dev/delicious233` only when explicitly marked as read-only/audit.
- Global owner covers Web, Hub, Desktop, Edge, CLI adapter, evidence, packaging/deploy readiness, and docs. Mobile is external.
- Web remains Hub-only. Desktop remains Local Edge/Tauri/host-capability only. No Web direct Local Edge access and no Desktop direct CLI spawn.

## P0 Critical Path

| Step | Deliverable | Minimum proof |
|---|---|---|
| 1. Login/device readiness | Web and Desktop have Hub session/device state sufficient for routing, using fake/local gates unless real TokenDanceID is approved. | `scripts/verify-login-fixture-topology.ps1`; `scripts/verify-oidc-flow.ps1 -LocalOnly -SkipTD`; Desktop `/edge/devices/register`; Hub WS auth evidence. |
| 2. Web -> Hub dispatch | Web starts a task or TeamRun with a concrete `target_id`; Hub persists `target_id` and `edge_device_id`. | Hub focused tests for `ExecutionTarget`, dispatch/control, offline exact-device queue, and no fallback. |
| 3. Hub -> registered Desktop/Edge | Hub sends `agent.dispatch` / `agent.control` only to the recorded Desktop device or its queue. | Desktop `useHubIntegration` focused test plus captured WS payload shape. |
| 4. Desktop -> Local Edge | Desktop active path mounts the Hub task bridge, converts dispatch into a Local Edge run, and never starts CLI directly. | Desktop App/bridge tests with Hub task id, Edge run id, adapter id, and failure/completion callback. |
| 5. Local Edge -> CLI adapter | Edge validates adapter id, rejects unknown explicit agent ids, and emits normalized runtime events. | Edge focused tests for API, adapter, lifecycle, and `cmd/agenthub-edge`; `-RealCli` remains explicit. |
| 6. Evidence replay | Web/Hub and Desktop/Edge show transcript/task/event/evidence state for the same run. | TeamRun/ByteDance fixture rehearsal or approved real evidence package, clearly labeled. |

## Mock/Fixture Vs Real Tested Mode

| Mode | Allowed in 48h | Claims allowed |
|---|---|---|
| Mock/fixture rehearsal | Fake/local login, fixture TeamRun, fixture/fake adapter events, static evidence package. | UI/protocol/evidence-shape readiness only. Not final runtime proof. |
| Real tested mode | Only after explicit approval for real TokenDanceID, real CLI/model, environment, budget, and redaction. | Live remote-control chain proof for the approved runtime only. |
| Submission evidence | Requires real recording plus state/events/tasks/assignments/runtime proof. | Final competition/demo claim. Fixture-only evidence must fail submission mode. |

ByteDance/TeamRun evidence must always state whether it is fixture rehearsal or real tested evidence. There is no active `bytedance.md` file in this repo; the current competition evidence inputs are `docs/competition/teamrun-e2e-evidence.md`, `docs/competition/teamrun-demo-scenario.json`, and the ByteDance Demo Value section in `docs/reference/sdk-agent-strategy.md`.

## Competition Evidence Inputs

| Source | Required proof |
|---|---|
| `docs/competition/teamrun-e2e-evidence.md` | Final package needs a real run, not only unit tests: screen recording, Desktop transcript, right inspector, TeamRun state, route/task/event lists, Hub API exports, remote-control manifest, runtime proof, and redaction status. |
| `docs/competition/teamrun-demo-scenario.json` | Fixture-only manifest freezes shape for `FixtureRehearsal`; it explicitly blocks real runtime, final recording, live Hub runtime, and submission claims. |
| `docs/reference/sdk-agent-strategy.md` | SDK work must keep AgentHub as the product model: Agent Profiles, TeamRun, approvals, evidence, and ExecutionTarget stay Hub/Edge-owned; Claude/OpenAI/OpenCode SDK objects remain below the Edge adapter boundary. |

The final demo narrative must show: AgentHub defines the collaboration model; Edge adapters translate provider SDK/CLI outputs into AgentHub events; TeamRun and evidence prove the collaboration loop.

## Practical Audit Lanes

| Lane | Purpose | Current owner/worktree | Exit proof |
|---|---|---|---|
| Tauri compile/package | Prove Desktop can actually build with bundled Local Edge policy. Signing/notarization remains gated. | Audit report complete in `codex/audit-build-deploy`: Web/Desktop builds and Tauri `--no-bundle` pass; full installer proof missing. | `app/desktop` typecheck, targeted Tauri Rust tests, NSIS/portable dry proof, then approved installer smoke. |
| Web deploy/readiness | Prove Web production build and Hub-only boundary. Actual public deploy needs environment approval. | Audit report complete in `codex/audit-build-deploy`: build passes but deploy pipeline/path is undefined and OIDC callback defaults need cleanup. | Web typecheck/build, `verify-web-hub-boundary.ps1`, deploy artifact manifest, OIDC callback `5174`/production allowlist sync. |
| Login and chat | Prove Web/Desktop auth topology, Hub sessions/messages, WS sync, and no silent demo fallback in real mode. | Audit report complete in `codex/audit-login-chat-sync`; implementation follow-up needed for Web auth root and Desktop device registration mount. | Fake/local auth topology gate, Hub session/message focused tests, real TokenDanceID only after approval. |
| Hub/Edge dispatch sync | Prove exact target routing, offline queue semantics, callbacks, and event replay. | Integrated in P0 baseline; final gap is combined fixture/e2e proof. | Hub service/cache tests plus Desktop bridge tests. |
| CLI adapter and permission control | Prove runtime id validation, no unknown fallback, and Hub `agent.control` can unblock or deny real permission waits. | Integrated in P0 baseline; timeout policy remains P1 unless approved. | Edge adapter/lifecycle/API tests; real CLI/model only after approval. |
| Agent SDK strategy | Decide SDK value without leaking SDK objects into Hub/Web/Tauri product model. | Report complete in `codex/sdk-agent-report`; next worker should implement fixture/sidecar adapter plan only. | Report and fixture-only next steps; no SDK package install or API/model call. |
| Real E2E evidence | Produce final demo evidence after the chain is wired. | Next parallel worker after build/auth/device checks are green. | Evidence manifest in `RealTested` or `Submission` mode, screenshots/log/API refs, video path, redaction status. |

## Active Worktree Board

| Worktree / branch | State | P0 action |
|---|---|---|
| `.worktrees/p0-remote-control-integration` / `codex/p0-remote-control-integration` | unified baseline | Only branch currently eligible to merge back to `dev/delicious233` after final combined gates. |
| `.worktrees/roadmap-48h` / `codex/roadmap-48h` | absorbed | No further writes; superseded by unified baseline. |
| `.worktrees/p0-web-remote-target` / `codex/p0-web-remote-target` | absorbed | Web composer target selection is in unified baseline. |
| `.worktrees/p0-hub-target-dispatch` / `codex/p0-hub-target-dispatch` | absorbed | Hub target-bound dispatch/control is in unified baseline. |
| `.worktrees/p0-desktop-edge-bridge` / `codex/p0-desktop-edge-bridge` | absorbed with follow-up | Bridge proof plus App mount are in unified baseline. |
| `.worktrees/p0-desktop-bridge-mount` / `codex/p0-desktop-bridge-mount` | absorbed | Desktop v4 active path mounts the Hub task bridge and uses configured Edge base URL. |
| `.worktrees/p0-edge-cli-evidence` / `codex/p0-edge-cli-evidence` | absorbed | Edge adapter/runtime event evidence proof is in unified baseline. |
| `.worktrees/p0-edge-permission-control` / `codex/p0-edge-permission-control` | absorbed | Brokered permission decision path is in unified baseline; independent timeout remains P1. |
| `.worktrees/p0-teamrun-target-routing` / `codex/p0-teamrun-target-routing` | absorbed with integration fix | Hub TeamRun target persistence/dispatch plus Web TeamRun target selection are in unified baseline. |
| `.worktrees/p0-control-vocabulary-queue` / `codex/p0-control-vocabulary-queue` | absorbed | Shared `agent.control` and FIFO replay are in unified baseline. |
| `.worktrees/p0-remote-evidence` / `codex/p0-remote-evidence` | absorbed | Evidence taxonomy/readiness gate is in unified baseline. |
| `.worktrees/login-e2e-topology` / `codex/login-e2e-topology` | absorbed | Mock/topology auth gate is in unified baseline; real TokenDanceID remains approval-gated. |
| `.worktrees/sdk-agent-report` / `codex/sdk-agent-report` | report ready | Keep as report source; do not merge into P0 integration unless docs/reference is requested. |
| `.worktrees/audit-login-chat-sync` / `codex/audit-login-chat-sync` | report ready | Use report findings for next worker dispatch; bridge mount finding is superseded by unified baseline. |
| `.worktrees/audit-scheduling-cli` / `codex/audit-scheduling-cli` | report ready | Use report findings for final e2e/evidence planning; several base blockers are superseded by unified baseline. |
| `.worktrees/audit-build-deploy` / `codex/audit-build-deploy` | report ready | Build/deploy findings feed Desktop packaging and Web deploy workers. |
| `.worktrees/p0-desktop-packaging-dry` / `codex/p0-desktop-packaging-dry` | running | Desktop packaging dry proof: sidecar, SQLite app-data policy, installer readiness; no signing/notarization/upload. |
| `.worktrees/p0-web-auth-deploy` / `codex/p0-web-auth-deploy` | running | Web auth root, callback defaults, production build/deploy manifest; no live TokenDanceID or public deploy. |
| `.worktrees/p0-desktop-device-registration` / `codex/p0-desktop-device-registration` | running | Active Desktop device registration and execution-target refresh for Web/TeamRun routing. |
| `.worktrees/p0-remote-fixture-e2e` / `codex/p0-remote-fixture-e2e` | running | Fixture E2E evidence gate for Web -> Hub -> Desktop/Edge -> Local Edge -> adapter chain. |
| `.worktrees/p0-sdk-adapter-fixture` / `codex/p0-sdk-adapter-fixture` | running | Claude/OpenAI/OpenCode SDK fixture mapping below Edge adapter boundary; no SDK installs or model/API calls. |
| `.worktrees/edge-sql-store` / `codex/edge-sql-store` | broken object | Do not use for P0 unless recreated. |
| `.worktrees/tauri-package-next` / `codex/tauri-package-next` | dirty, behind dev | P1 packaging reference only. |
| `mobile-*` | external | Do not edit. |
| main `dev/delicious233` | dirty and behind | Read-only reference at most. |

## Approval Gates

- Real TokenDanceID login: requires approved OAuth client, test account, Hub test environment, browser window, and no-secret evidence boundary.
- Real CLI/model run: requires runner, budget, environment approval, runtime redaction, and artifact upload policy.
- Actual Web deployment: requires target environment, env var ownership, auth callback URL, and no-secret deploy log boundary.
- Signing, notarization, stapling, updater production metadata, and release upload: separate release approval.
- Mobile implementation: separate owner; this sprint does not change mobile files.

## Verification Commands

Run the relevant focused gates per slice; the roadmap-level gate is:

```powershell
git diff --check origin/dev/delicious233...HEAD
```

Suggested slice gates:

```powershell
.\scripts\verify-login-fixture-topology.ps1
.\scripts\verify-oidc-flow.ps1 -LocalOnly -SkipTD
.\scripts\verify-web-hub-boundary.ps1
cd hub-server; go test ./internal/handler ./internal/service ./internal/router -run "ExecutionTarget|AgentTask|TeamRun|Dispatch|Control" -short -count=1
cd app/desktop; corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts
cd edge-server; go test ./internal/api ./internal/adapters ./internal/lifecycle ./cmd/agenthub-edge -short -count=1
.\scripts\verify-teamrun-demo-readiness.ps1 -EvidencePath .tmp\teamrun-evidence\<stamp>\teamrun-evidence.json -Mode FixtureRehearsal
```

## Parallel Dispatch Rules

1. Main agent owns branch topology, integration, review, and final gate evidence. Workers own isolated implementation slices.
2. New workers start from `codex/p0-remote-control-integration` after this unified baseline commit, not from the dirty main worktree.
3. Each worker gets a disjoint write set, focused tests, and explicit non-goals. Workers do not push, merge to `dev/delicious233`, run real TokenDanceID, consume real CLI/model budget, sign/notarize, or deploy without approval.
4. Completed worker branches require one read-only review pass before cherry-pick into the unified baseline.
5. Mobile remains external; only send coordination to mobile thread for protocol/contract drift.

## Next Parallel Wave

1. **Desktop packaging worker**: produce NSIS/portable dry proof if toolchain permits, keep `--no-bundle` executable proof, document macOS as policy-only unless a macOS runner exists; no signing/notarization/upload.
2. **Web auth + deploy worker**: mount/verify Web auth root, clean OIDC callback defaults (`5174` dev and production callback allowlist), production build, Hub-only deploy artifact manifest; no public deploy without approval.
3. **Desktop device registration worker**: prove active Desktop app registers/refreshes Hub device and execution target used by Web/TeamRun routing.
4. **Remote-control fixture E2E worker**: run local fake Hub/Desktop/Edge fixture chain and produce evidence manifest in `FixtureRehearsal` mode.
5. **SDK adapter worker**: implement only fixture/sidecar mapping for Claude Agent SDK / OpenAI Agents SDK value path; no SDK install or model/API calls unless separately approved.
