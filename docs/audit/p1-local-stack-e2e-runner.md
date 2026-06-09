# P1 Local Stack E2E Readiness Runner

This slice adds `scripts/verify-local-stack-e2e-readiness.ps1` as the next practical local product-loop gate. It composes the existing fixture, localhost service readiness, login approval, Edge CLI approval, and observed-dispatch verifiers without turning caller-supplied topology into real proof.

## Modes

| Mode | What it does | Claim boundary |
|---|---|---|
| `FixtureOnly` | Runs `verify-localhost-product-loop.ps1` and records fixture Web -> Hub -> Desktop bridge -> Local Edge -> fixture adapter -> Hub replay evidence. | Fixture-only; `real_tested=false`. |
| `ReadinessOnly` | Checks required commands, expected local-stack ports, required environment variable names, safe artifact roots, login/CLI approval blockers, direct Web-to-LocalEdge topology, and optional localhost service probes through `verify-localhost-real-services.ps1`. | Readiness-only; `real_tested=false`. |
| `ApprovedReal` | Requires `-ApproveRealEvidence` plus a separate observed-dispatch manifest reviewed by `verify-observed-localhost-dispatch.ps1`. | May promote `real_tested=true` only when the observed-dispatch verifier accepts approval-gated evidence. |

## Default Behavior

The default mode is `ReadinessOnly`, and it fails closed unless the caller supplies:

- safe `-ArtifactRoot` under `.tmp/local-stack-e2e-readiness`, `tmp/local-stack-e2e-readiness`, or `$env:TEMP/AgentHub/local-stack-e2e-readiness`;
- caller-supplied `-EvidencePath` under a canonical readiness temp root or under the validated `-ArtifactRoot`; omitted `-EvidencePath` keeps the existing process-temp default;
- required environment variable names: `AGENTHUB_WEB_URL`, `AGENTHUB_HUB_URL`, `AGENTHUB_DESKTOP_BRIDGE_URL`, `AGENTHUB_LOCAL_EDGE_URL`, and `AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT`;
- localhost topology that keeps Web upstream on Hub and Desktop bridge upstream on Local Edge;
- `-ProbeServices` for already-running services, or explicit `-StartServices -StartServicePlanPath` to delegate bounded startup to the existing real-services verifier.

## What This Gate Proves

- The fixture product loop can still exercise the full intended sequence without real login or model spend.
- The readiness contract names the commands, ports, environment variable names, and artifact root boundaries needed before a local stack run.
- The Web surface is blocked from pointing directly at Local Edge.
- The login and real CLI/model paths remain approval-gated by their existing verifiers.
- Optional service probes can verify Web, Hub, Desktop bridge, and Local Edge health markers on loopback URLs.

## What This Gate Does Not Prove

- It does not prove real TokenDanceID login.
- It does not prove real CLI/model execution or API-budget spend.
- It does not prove public deploy, signing, release upload, installer packaging, or mobile behavior.
- It does not accept caller-supplied URL parameters as observed Hub dispatch proof.
- It does not set `real_tested=true` unless an approved observed-dispatch manifest is accepted by the observed-dispatch verifier.

## Example Commands

Fixture-only:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-local-stack-e2e-readiness.ps1 `
  -RepoRoot . `
  -Mode FixtureOnly `
  -ArtifactRoot .tmp\local-stack-e2e-readiness\fixture
```

Readiness-only for already-running services:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-local-stack-e2e-readiness.ps1 `
  -RepoRoot . `
  -ArtifactRoot .tmp\local-stack-e2e-readiness\readiness `
  -SuppliedEnvironmentNames AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT `
  -ProbeServices `
  -ExpectedWebMarker "agenthub-web-real-service-marker" `
  -ExpectedHubMarker "agenthub-hub-real-service-marker" `
  -ExpectedDesktopMarker "agenthub-desktop-bridge-real-service-marker" `
  -ExpectedEdgeMarker "agenthub-local-edge-real-service-marker" `
  -RegisteredTargetUrl http://127.0.0.1:5173 `
  -HubDispatchTargetUrl http://127.0.0.1:5173
```

Approved observed dispatch review:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-local-stack-e2e-readiness.ps1 `
  -RepoRoot . `
  -Mode ApprovedReal `
  -ArtifactRoot .tmp\local-stack-e2e-readiness\approved `
  -SuppliedEnvironmentNames AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT `
  -ProbeServices `
  -ApproveRealEvidence `
  -ObservedEvidencePath .tmp\local-stack-e2e-readiness\approved\observed-dispatch.json
```
