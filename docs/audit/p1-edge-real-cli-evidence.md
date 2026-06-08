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

The manifest must show:

- supported adapter id: `codex`, `claude-code`, or `opencode`
- approval id
- `requestMapped=true`
- `invocationPlanObserved=true`
- `eventReplayObserved=true`
- `realCliObserved=true`
- `redacted=true`
- `noSecrets=true`
- `terminalStatus=finished`
- `exitCode=0`

Any missing approval marker, missing manifest field, failed terminal status, nonzero exit code, unsupported adapter, or secret-like manifest content keeps `real_tested=false`. In `RealTested` mode, a failed observed chain exits nonzero and still reports `real_tested=false`.

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
