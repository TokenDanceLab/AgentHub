# P0 Edge CLI Real Readiness Gate

This slice is a proposal/readiness gate for future approved Edge CLI runs. No real CLI/model run was executed, no network was accessed, no secrets were read or printed, and no API/model budget was consumed.

## Scope

- Supported direct real runtime ids: codex, claude-code, opencode.
- Excluded runtime ids: `agenthub-runner-mock`, `orchestrator`, blank ids, and unknown ids.
- Evidence files checked by the gate:
  - `edge-server/internal/adapters/registry.go`
  - `edge-server/internal/adapters/registry_test.go`
  - `edge-server/internal/lifecycle/process_executor.go`
  - `edge-server/internal/lifecycle/process_executor_test.go`
  - `edge-server/cmd/agenthub-edge/main.go`
  - `docs/backend-integration-governance.md`

## Static Readiness Evidence

| Check | Evidence | Status |
|---|---|---|
| Runtime id allowlist | `ValidateCLIAdapterID` allows only `codex`, `claude-code`, and `opencode` for direct CLI readiness. | Static pass |
| Unknown runtime no-fallback | `TestProcessExecutorFailsUnknownExplicitAdapterWithoutDefaultFallback` uses `unknown-runtime` and fails if the default adapter is invoked. | Static pass |
| Runtime path/env names | Edge config exposes `AGENTHUB_CODEX_PATH`, `AGENTHUB_CLAUDE_CODE_PATH`, and `AGENTHUB_OPENCODE_PATH`. | Static pass |
| Real execution | This slice does not run Codex, Claude Code, OpenCode, SDKs, model APIs, or network calls. | Blocked |

## Approval Prerequisites

Future `RealTested` or `Submission` mode must include all of the following before real execution can be considered:

| Prerequisite | Required approval evidence | Current status |
|---|---|---|
| runtime path/env | Runtime id, redacted executable path or owner, required env variable names, and secret owner without values. | Missing |
| budget/redaction | Request/token/cost/time cap plus stdout/stderr/env/artifact redaction rules. | Missing |
| artifact root | Isolated evidence output directory, retention owner, and generated-artifact ignore boundary. | Missing |
| evidence mode | Redacted log, hash-only, or operator-reviewed evidence mode. | Missing |
| operator approval | Explicit approval id for the exact runtime, path/env, budget, artifact root, and evidence mode. | Missing |

Default `ProposalOnly` mode may pass static checks while still reporting these items as blockers. `RealTested` and `Submission` modes must fail if any prerequisite is missing.

## Proposed Commands

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-edge-cli-real-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-edge-cli-real-readiness.ps1 -RepoRoot .
```

Do not add `codex`, `claude`, or `opencode` invocation commands to this gate. Future real execution must be a separate approved slice with redacted evidence handling.
