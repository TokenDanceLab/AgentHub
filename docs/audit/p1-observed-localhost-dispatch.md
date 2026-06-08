# P1 Observed Localhost Dispatch Gate

This slice adds a fail-closed verifier for observed localhost dispatch proof:
`scripts/verify-observed-localhost-dispatch.ps1`.

The existing `verify-localhost-real-services.ps1` gate remains readiness-only.
It can prove marked localhost services and internally consistent topology hints,
but caller-supplied URLs still cannot prove Hub routing.

## Evidence Contract

The observed-dispatch verifier accepts either:

- `-ObservedEvidencePath` pointing at a no-secret Hub/Desktop evidence manifest.
- `-ObservedEvidenceUrl` pointing at a loopback HTTP evidence endpoint.

The manifest must use `schema=agenthub-observed-localhost-dispatch-v1` and
`evidence_origin=observed_hub_manifest` or `observed_desktop_path`.

Required proof:

| Required element | Source expectation |
|---|---|
| Target registration | Hub target registry event with target id, edge device id, Desktop bridge URL, and observed `target.registered` ref |
| Hub dispatch | Hub dispatch log event with hub task id and observed dispatch target URL |
| Desktop bridge accept | Desktop bridge log event proving the dispatch was accepted before Local Edge handoff |
| Edge run id | Edge run log with edge run id and adapter id |
| Hub replay refs | Hub replay store event matching the same hub task id, target, edge device, edge run id, and adapter id |

The verifier rejects readiness artifacts, caller-only/self-supplied URL proof,
missing dispatch events, direct Hub-to-LocalEdge targets, and forged replay refs.

## RealTested Boundary

Default output keeps `real_tested=false` even when the observed manifest is
otherwise valid. An input `real_tested=true` claim is downgraded unless a future
operator explicitly runs with `-AllowRealTestedApproval` and the manifest carries
`approval_gate=observed-localhost-dispatch-approved`.

This verifier does not start services and does not perform TokenDanceID login,
real CLI/model invocation, public deploy, signing, release upload, or installer
publication.

## Commands

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-observed-localhost-dispatch.ps1 -RepoRoot .
```

Example manifest validation:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-observed-localhost-dispatch.ps1 `
  -RepoRoot . `
  -ObservedEvidencePath .\path\to\observed-dispatch-manifest.json `
  -EvidencePath .\path\to\observed-dispatch-report.json
```

## Non-Goals

- Real TokenDanceID browser login.
- Real Codex, Claude Code, OpenCode, SDK, model, or API-budget execution.
- Accepting caller-supplied URL parameters as dispatch proof.
- Direct Hub-to-LocalEdge dispatch certification.
- Public deploy, signing, release upload, installer build, or package publication.
- Roadmap edits.
