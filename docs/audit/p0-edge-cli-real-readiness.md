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
| Runtime path/env names | Edge config exposes `AGENTHUB_CODEX_PATH`, `AGENTHUB_CLAUDE_CODE_PATH`, and `AGENTHUB_OPENCODE_PATH`. Future approval must provide env var ownership without values. | Static pass |
| Secret-like input rejection | The readiness script rejects secret-like parameter content and reports only the field name. | Static pass |
| Artifact output boundary | Future artifact roots must be under allowed temp directories: `.tmp/edge-cli-real-readiness/` or `$env:TEMP/AgentHub/edge-cli-real-readiness/`. | Static pass |
| Real execution | This slice does not run Codex, Claude Code, OpenCode, SDKs, model APIs, or network calls. | Blocked |

## Approval Prerequisites

Future real execution approval must include all of the following before a separate real-run verifier is allowed to run. Metadata alone is not real execution evidence, and this static script cannot certify `RealTested` or `Submission` completion.

| Prerequisite | Required approval evidence | Current status |
|---|---|---|
| adapter | Explicit adapter id: `codex`, `claude-code`, or `opencode`. Unknown adapters fail closed. | Missing |
| command | Exact future command shape, including approval mode, output format, and dry-run/non-dry-run distinction. This script records it but does not execute it. | Missing |
| runtime path/env | Runtime id, redacted executable path or owner, required env variable names, env var ownership, and secret owner without values. | Missing |
| budget | Request/token/cost/time cap plus stop policy. | Missing |
| timeout | Hard timeout, idle timeout if any, and process-tree kill policy. | Missing |
| redaction policy | stdout/stderr/env/artifact redaction rules; secret-like values in approval parameters fail closed. | Missing |
| artifact root | Isolated evidence output directory under the allowed temp roots only. | Missing |
| artifact retention | Retention owner, duration, raw-artifact deletion policy, and generated-artifact ignore boundary. | Missing |
| evidence mode | Redacted log, hash-only, or operator-reviewed evidence mode. | Missing |
| operator approval | Explicit approval id for the exact adapter, command, path/env ownership, budget, timeout, redaction policy, artifact root, artifact retention, and evidence mode. | Missing |
| approval flags | `-ApproveNoRealExecution`, `-ApproveRedactionPolicy`, `-ApproveArtifactRetention`, and `-ApproveEnvVarOwnership`; use `-RequireApprovalInputs` to fail closed when any input or flag is absent. | Missing |
| real execution evidence manifest | Separate no-secret manifest from an approved real run. This static gate records the requirement but does not validate arbitrary files as real evidence. | Missing |

Default `ProposalOnly` mode may pass static checks while still reporting these items as blockers. `RealTested` and `Submission` modes must fail in this script even when runtime/path/env/budget/redaction/artifact/evidence/approval metadata is non-empty. A markdown file, proposal note, or arbitrary existing file must not unlock a successful real-tested/submission status.

Before any future real run, run this gate with `-RequireApprovalInputs` plus the approval flags. Missing approval flags, unsupported adapter ids, secret-like parameter content, and artifact paths outside the allowed temp roots fail closed.

Allowed status claims from this script:

- `PROPOSAL_ONLY`: static evidence was checked; real execution is still blocked or not attempted.
- `BLOCKED_FOR_REAL_EXECUTION`: requested mode is `RealTested` or `Submission`; use a separate approved real-run verifier with redacted evidence.

## Proposed Commands

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-edge-cli-real-readiness.ps1 -RepoRoot .
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-edge-cli-real-readiness.ps1 -RepoRoot .
```

Do not add `codex`, `claude`, or `opencode` invocation commands to this gate. Future real execution must be a separate approved slice with redacted evidence handling.
