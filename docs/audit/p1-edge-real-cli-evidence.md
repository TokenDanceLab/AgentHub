# P1 Edge Real CLI Dispatch Evidence Gate

This slice moves Edge CLI evidence from static readiness toward a dispatch proof chain:

```text
request -> CLI invocation plan -> event replay/status
```

Default verification is fixture-only and no-spend. It does not run Codex, Claude Code, OpenCode, SDKs, model APIs, network calls, or real remote-control actions.

## Fixture Evidence

- `BuildCLIInvocationPlan` projects adapter `BuildCommand` output into a redacted command-shape plan.
- The plan records adapter id, command basename, safe argument flags/config keys, env names, basename-only workdir, and redaction/approval fields.
- The plan always reports `observed=false` and `real_tested=false` by default.
- `ProcessExecutor` publishes `run.agent.cli_invocation_plan` before subprocess start for adapter runs.
- The fixture lifecycle test proves the invocation plan, SDK fixture permission/result events, and `run.finished` are replayed by the Edge event bus.

## Observed Gate

Observed evidence is only accepted by `scripts/verify-edge-cli-dispatch-evidence.ps1` when all of these are present:

- `-Mode Observed` or `-Mode RealTested`
- `-ApproveObservedCLI`
- an existing approval marker file via `-ApprovalMarker`
- a redacted JSON manifest via `-ObservedManifest`

The manifest is fail-closed: required scalar fields must be present with the expected JSON type. Missing values and wrong-type values do not coerce to success.

The manifest must show typed execution identity and correlation:

- supported adapter id: `codex`, `claude-code`, or `opencode`
- approval id
- `observedEvidenceRef` with a concrete reference prefix such as `edge-event-log:`, `event-log:`, `artifact:`, or `sha256:`
- `correlationId`
- `invocationPlanEventId`
- `terminalEventId`
- `requestMapped=true`
- `invocationPlanObserved=true`
- `eventReplayObserved=true`
- `realCliObserved=true`
- `redacted=true`
- `noSecrets=true`
- `terminalStatus=finished`
- `exitCode=0`

Any missing approval marker, missing manifest field, wrong-type required field, missing observed evidence reference, missing correlation field, failed terminal status, nonzero exit code, unsupported adapter, or secret-like manifest content keeps `real_tested=false`. In `RealTested` mode, a failed observed chain exits nonzero and still reports `real_tested=false`.

Passing observed manifests are still manifest-level evidence only. They report
`observed_manifest_accepted=true` and keep `real_tested=false` because this
verifier does not dereference the referenced artifact, event log, or hash. A
future RealTested promotion needs a separate verifier that reads the referenced
material and checks event ids/correlation ids against it.

Boolean-only synthetic manifests are fixture proof only. Even with an approval marker, they remain `real_tested=false`; concrete observed evidence reference and event correlation fields are required only to accept the manifest for follow-up verification.

## Commands

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-edge-cli-dispatch-evidence.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-edge-cli-dispatch-evidence.ps1 -RepoRoot .
```

## Non-Goals

- No real CLI/model execution by default.
- No real remote-control run without explicit approval marker and manifest.
- No Hub/Web/Desktop code.
- No SQLite production store work.
- No `docs/roadmap.md` edits.
