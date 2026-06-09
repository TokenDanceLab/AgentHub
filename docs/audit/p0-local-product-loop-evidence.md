# P0 Local Product-Loop Evidence Runner

This slice adds `scripts/verify-p0-local-product-loop-evidence.ps1` as the P0 sanitized evidence entrypoint for the local product loop:

```text
Web -> Hub -> Desktop Local Edge sidecar -> fixture/CLI adapter -> Hub replay -> Web render
```

The runner composes the existing localhost fixture harness and writes a compact machine-readable report with schema `agenthub-p0-local-product-loop-evidence-v1`.

## Modes

| Mode | What it does | Claim boundary |
|---|---|---|
| `FixtureOnly` | Runs `verify-localhost-product-loop.ps1`, validates the fixture evidence, and writes sanitized segment evidence for Web, Hub, Desktop sidecar, Local Edge fixture adapter, Hub replay, and Web render. | Reproducible local fixture evidence only; `real_tested=false`. |
| `ApprovedRealReview` | Runs the same fixture gate, then reviews a separate observed-dispatch manifest through `verify-observed-localhost-dispatch.ps1`. | May promote `real_tested=true` only when the observed manifest validates and `-ApproveRealEvidence` is explicitly supplied. |

## What This Proves

- The localhost fixture chain covers Web -> Hub -> Desktop Local Edge sidecar -> fixture/CLI adapter -> Hub replay -> Web render.
- Web remains Hub-only in the sanitized evidence report; direct Local Edge proof is recorded as rejected.
- Desktop dispatch is represented as a Local Edge sidecar boundary, not direct browser access or UI-driven CLI spawn.
- Local Edge uses the fixture adapter and records `real_cli_or_model_invoked=false`.
- Hub replay is consumed by the Web fixture render step after the replay record exists.

## What This Does Not Prove

- It does not perform real TokenDanceID login.
- It does not invoke a real CLI/model adapter or spend API budget.
- It does not deploy, sign, push, merge, tag, upload release artifacts, or touch production code.
- It does not certify caller-supplied URLs as real dispatch proof.

## Fixture Command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-p0-local-product-loop-evidence.ps1 `
  -RepoRoot . `
  -ArtifactRoot .tmp\p0-local-product-loop-evidence\fixture
```

Default evidence path:

```text
.tmp\p0-local-product-loop-evidence\<run>\sanitized-evidence.json
```

## Approved-Real Requirements

Approved-real review requires a separate no-secret observed-dispatch manifest with schema `agenthub-observed-localhost-dispatch-v1`.

Required environment names for the real local-stack side are:

- `AGENTHUB_WEB_URL`
- `AGENTHUB_HUB_URL`
- `AGENTHUB_DESKTOP_BRIDGE_URL`
- `AGENTHUB_LOCAL_EDGE_URL`
- `AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT`

Review command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-p0-local-product-loop-evidence.ps1 `
  -RepoRoot . `
  -Mode ApprovedRealReview `
  -ArtifactRoot .tmp\p0-local-product-loop-evidence\approved `
  -ObservedEvidencePath <observed-dispatch.json> `
  -ApproveRealEvidence
```

Local stack probe command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-local-stack-e2e-readiness.ps1 `
  -RepoRoot . `
  -Mode ApprovedReal `
  -ArtifactRoot .tmp\local-stack-e2e-readiness\approved `
  -SuppliedEnvironmentNames AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT `
  -ProbeServices `
  -ApproveRealEvidence `
  -ObservedEvidencePath <observed-dispatch.json>
```

Without those requirements, the approved-real lane remains blocked and reports `real_tested=false`.

## Verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-p0-local-product-loop-evidence.ps1 -RepoRoot .
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-localhost-product-loop.ps1 -RepoRoot .
```
