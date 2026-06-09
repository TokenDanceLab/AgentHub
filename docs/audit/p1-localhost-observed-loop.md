# P1 Localhost Observed Loop Gate

This slice adds `scripts/verify-localhost-observed-loop.ps1` as the no-spend
localhost observed-loop glue for:

```text
Web 5174 -> Hub 8080 -> Desktop/Tauri evidence bridge 5173 -> Local Edge 3210
-> fixture adapter -> Hub replay -> Web transcript/approval/artifact render
```

It does not perform real TokenDanceID login, does not invoke real CLI/model/API
work, and does not deploy, sign, release, push, or touch mobile paths.

## Modes

| Mode | Output | Boundary |
|---|---|---|
| `ReadinessOnly` | Writes `agenthub-localhost-observed-loop-readiness-v1`. | Startup/probe manifest only; no live-service proof; `real_tested=false`. |
| `FixtureManifest` | Writes `agenthub-observed-localhost-dispatch-v1`, then validates it with `verify-observed-localhost-dispatch.ps1`. | Deterministic fixture manifest only; no real services or spend; `real_tested=false`. |
| `ApprovedReal` | Reviews caller-provided observed evidence through the local-stack readiness and observed-dispatch gates. | Only eligible after explicit approval and a no-secret observed manifest; the runner itself still does not log in or run real CLI/model work. |

## Commands

Default readiness-only manifest:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-localhost-observed-loop.ps1 `
  -RepoRoot . `
  -ArtifactRoot .tmp\localhost-observed-loop\readiness `
  -ManifestPath .tmp\localhost-observed-loop\readiness\localhost-observed-loop-readiness.json `
  -SuppliedEnvironmentNames AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT
```

Fixture observed-dispatch manifest:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-localhost-observed-loop.ps1 `
  -RepoRoot . `
  -Mode FixtureManifest `
  -ArtifactRoot .tmp\localhost-observed-loop\fixture `
  -ManifestPath .tmp\localhost-observed-loop\fixture\observed-dispatch-manifest.json `
  -ObservedDispatchReportPath .tmp\localhost-observed-loop\fixture\observed-dispatch-report.json
```

Approved-real review:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-localhost-observed-loop.ps1 `
  -RepoRoot . `
  -Mode ApprovedReal `
  -ArtifactRoot .tmp\localhost-observed-loop\approved-real `
  -ManifestPath .tmp\localhost-observed-loop\approved-real\localhost-observed-loop-review.json `
  -ObservedEvidencePath <observed-dispatch-manifest.json> `
  -ApproveRealEvidence
```

`ApprovedReal` can pass `-ProbeServices` for already-running localhost
services or `-StartServices -StartServicePlanPath <plan.json>` to delegate
bounded startup to the existing local-stack readiness verifier. The default
mode does neither.

`ReadinessOnly` also accepts `-ProbeServices` as a no-spend localhost health
probe. It checks the Web dev server, Hub health, Desktop/Tauri bridge, and
Local Edge health URLs with explicit identity markers, then still reports
`real_tested=false`. `-StartServices` is never implicit; it only runs when a
caller supplies `-StartServicePlanPath`, and this runner does not treat that as
real CLI/model/API proof.

Focused verification:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-localhost-observed-loop.ps1 -RepoRoot .
```

Related readiness checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-localhost-real-stack-smoke.ps1 `
  -RepoRoot . `
  -ArtifactRoot .tmp\localhost-real-stack-smoke\edge-only `
  -EvidencePath .tmp\localhost-real-stack-smoke\edge-only\localhost-real-stack-smoke.json `
  -SkipWeb `
  -SkipDesktop `
  -ProbeHub

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-local-stack-e2e-readiness.ps1 `
  -RepoRoot . `
  -Mode FixtureOnly `
  -ArtifactRoot .tmp\local-stack-e2e-readiness\fixture `
  -EvidencePath .tmp\local-stack-e2e-readiness\fixture\local-stack-e2e-readiness.json

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-observed-localhost-dispatch.ps1 `
  -RepoRoot . `
  -ObservedEvidencePath .tmp\localhost-observed-loop\fixture\observed-dispatch-manifest.json `
  -EvidencePath .tmp\localhost-observed-loop\fixture\observed-dispatch-report.json
```

## Evidence Paths

Default evidence lives under:

```text
.tmp\localhost-observed-loop\<run>\
```

The runner records:

- `localhost-observed-loop-readiness.json` or `observed-dispatch-manifest.json`
- `observed-dispatch-report.json` when observed manifest validation runs
- `service-probe-manifest.json` as the unified service probe manifest
- `service-pids.json` as the pid manifest for harness-started service metadata
- `service-health.json` as the health manifest for Web, Hub, Desktop bridge,
  and Local Edge probes
- `logs\startup.log`
- `logs\cleanup.log`

The stronger local service smoke writes `agenthub-localhost-real-stack-smoke-v1`
under `.tmp\localhost-real-stack-smoke\...`. It starts the safe Local Edge
subset with `agenthub-runner-mock` and a temporary SQLite store, probes Hub
only, and starts Web/Desktop Vite only when app workspace dependencies already
exist. That evidence still reports `real_tested=false` and is not live Hub
dispatch proof.

Artifact roots are accepted only under `.tmp\localhost-observed-loop`,
`tmp\localhost-observed-loop`, or `$env:TEMP\AgentHub\localhost-observed-loop`.
`-CleanArtifactRoot` is allowed only after that root check passes.

Cleanup policy: keep the artifact root until evidence review is complete, then
remove that safe root with `Remove-Item`. If `-StartServices` is used, process
cleanup is delegated to `verify-localhost-real-services.ps1`; default
readiness and `-ProbeServices` do not start processes and therefore write an
empty pid manifest.

## Approved-Real Checklist

Approved-real is blocked unless all items are true:

- Operator explicitly passes `-ApproveRealEvidence`.
- The observed manifest has `schema=agenthub-observed-localhost-dispatch-v1`.
- The manifest origin is `observed_hub_manifest` or `observed_desktop_path`.
- Hub dispatch targets the registered Desktop/Tauri bridge, not Local Edge.
- Desktop/Tauri evidence proves handoff to Local Edge 3210.
- Local Edge evidence includes an `edge_run_id` and `fixture-sdk-adapter` or later approved adapter id.
- Hub replay refs match the same Hub task, target, edge device, edge run, and adapter.
- Web render evidence comes from Hub replay and includes transcript, approval, and artifact render proof.
- Evidence is redacted and contains no tokens, API keys, passwords, provider secrets, or raw secret paths.

## Non-Goals

- Real TokenDanceID browser login.
- Real Codex, Claude Code, OpenCode, SDK, model, or API-budget execution.
- Treating caller-supplied URLs as dispatch proof.
- Direct Hub-to-LocalEdge dispatch certification.
- Public deploy, signing, notarization, updater metadata, release upload, merge, push, or tag.
- Mobile app coverage.
