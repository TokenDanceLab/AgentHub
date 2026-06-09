# P0 Approved Real Evidence Verifier

This slice adds the independent verifier required before any Edge CLI evidence
can claim `real_tested=true`. It does not run Codex, Claude Code, OpenCode,
model APIs, login, network calls, or real remote-control actions. It only reads
approved, redacted evidence that already exists on disk.

## Rule

`real_tested=true` is allowed only when all of the following are true:

- An explicit approval marker file exists and `-ApproveRealEvidence` is passed.
- The observed manifest is valid JSON and contains no secret-like content.
- The manifest names a supported adapter: `codex`, `claude-code`, or `opencode`.
- The manifest has `invocationPlanEventId`, `terminalEventId`, `correlationId`,
  `adapterId`, `terminalStatus=finished`, `exitCode=0`, `redacted=true`, and
  `noSecrets=true`.
- `observedEvidenceRef` dereferences to a JSON event log or to a hash manifest
  that points at a JSON event log artifact.
- The event log contains the invocation-plan event and terminal event named by
  the manifest.
- Both events match the manifest `correlationId` and `adapterId`.
- The terminal event has `terminalStatus=finished` and `exitCode=0`.
- The invocation-plan and terminal events both carry `redacted=true` and
  `noSecrets=true`.

Manifest text alone is never enough. A passing manifest from
`scripts/verify-edge-cli-dispatch-evidence.ps1` can only reach
`observed_manifest_accepted=true`; it must still pass this verifier before
`real_tested=true`.

## Future Artifact Schema

The minimum future artifact schema is intentionally small and fail-closed.

Observed manifest:

```json
{
  "adapterId": "codex",
  "approvalId": "approval-real-123",
  "observedEvidenceRef": "event-log:edge-events.json",
  "correlationId": "corr-real-123",
  "invocationPlanEventId": "evt-plan",
  "terminalEventId": "evt-finished",
  "requestMapped": true,
  "invocationPlanObserved": true,
  "eventReplayObserved": true,
  "realCliObserved": true,
  "redacted": true,
  "noSecrets": true,
  "terminalStatus": "finished",
  "exitCode": 0
}
```

Event log artifact:

```json
{
  "schema": "agenthub.edge_cli.real_evidence.v1",
  "events": [
    {
      "id": "evt-plan",
      "type": "run.agent.cli_invocation_plan",
      "correlationId": "corr-real-123",
      "adapterId": "codex",
      "redacted": true,
      "noSecrets": true
    },
    {
      "id": "evt-finished",
      "type": "run.finished",
      "correlationId": "corr-real-123",
      "adapterId": "codex",
      "terminalStatus": "finished",
      "exitCode": 0,
      "redacted": true,
      "noSecrets": true
    }
  ]
}
```

Hash-manifest mode is accepted only when `observedEvidenceRef` is
`sha256:<event-log-sha256>` and the observed manifest also includes:

```json
{
  "eventLogArtifact": "edge-events.json",
  "hashManifest": "artifact-manifest.json"
}
```

The hash manifest may be an array of artifact entries or an object with an
`artifacts` array. Each entry must include `name` or `path`, `sha256`, and
optionally `bytes`. If the verifier cannot locate a parseable event log through
that schema, it returns `real_tested=false` and
`Status: APPROVED_REAL_EVIDENCE_BLOCKED`.

## Commands

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-approved-real-edge-cli-evidence.ps1 -RepoRoot . -ObservedManifest <path> -ApprovalMarker <path> -ApproveRealEvidence
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-approved-real-edge-cli-evidence.ps1 -RepoRoot .
```

## Non-Goals

- No real CLI/model/login execution.
- No production Hub, Edge, Desktop, or Web code changes.
- No `docs/roadmap.md` changes.
- No secret-bearing raw artifact publication.
