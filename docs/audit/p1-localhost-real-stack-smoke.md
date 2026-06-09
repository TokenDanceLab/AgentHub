# P1 Localhost Real Stack Smoke

This slice adds `scripts/verify-localhost-real-stack-smoke.ps1` as a no-spend
local service smoke that moves beyond pure fixture manifests without promoting
the gate to approved-real evidence.

## What It Starts Or Probes

| Surface | Default behavior | Evidence boundary |
|---|---|---|
| Web 5174 | Start/probe Vite only when app workspace dependencies already exist. | Real local dev server readiness only; Web still talks through Hub. |
| Hub 8080 | Probe-only with `-ProbeHub`; no automatic startup. | Hub startup still needs local database and Redis setup. |
| Desktop 5173 | Start/probe Desktop Vite renderer only when app workspace dependencies already exist. | Renderer/bridge readiness only; no package build or signing. |
| Local Edge 3210 | Starts `agenthub-edge` with `agenthub-runner-mock` and a temp SQLite store. | Real Local Edge process plus SQLite health; no real CLI/model/API spend. |

The manifest schema is `agenthub-localhost-real-stack-smoke-v1` and keeps
`RealTested=false`. Local Edge evidence records `store_backend=SQLite`,
`runner_profile=agenthub-runner-mock`, and `real_cli_or_model_invoked=false`.

## Commands

Minimal safe smoke, useful when Web/Desktop dependencies are not installed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-localhost-real-stack-smoke.ps1 `
  -RepoRoot . `
  -ArtifactRoot .tmp\localhost-real-stack-smoke\edge-only `
  -EvidencePath .tmp\localhost-real-stack-smoke\edge-only\localhost-real-stack-smoke.json `
  -SkipWeb `
  -SkipDesktop `
  -ProbeHub
```

Full localhost readiness attempt, still no-spend:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-localhost-real-stack-smoke.ps1 `
  -RepoRoot . `
  -ArtifactRoot .tmp\localhost-real-stack-smoke\full `
  -EvidencePath .tmp\localhost-real-stack-smoke\full\localhost-real-stack-smoke.json `
  -ProbeHub
```

Focused verification:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-localhost-real-stack-smoke.ps1 -RepoRoot .
```

## Evidence

Default evidence lives under:

```text
.tmp\localhost-real-stack-smoke\<run>\
```

The runner writes:

- `localhost-real-stack-smoke.json`
- Local Edge SQLite database under the same artifact root when the harness
  starts Edge.
- A service table for Web, Hub, Desktop, and Local Edge with `healthy`,
  `blocked`, `missing`, `skipped`, or `not_requested` status.
- Harness-started process metadata and cleanup status.

The evidence is redacted for bearer tokens, common provider tokens, client
secrets, passwords, and token-like values.

## Non-Goals

- Real TokenDanceID browser login.
- Real Codex, Claude Code, OpenCode, SDK, model, or API-budget execution.
- Treating Hub probe health as live dispatch proof.
- Starting Hub without explicit local database and Redis setup.
- Public deploy, signing, notarization, updater metadata, release upload,
  merge, push, or tag.
- Mobile app coverage.
