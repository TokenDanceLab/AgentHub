---
name: integration-test
description: Use when AgentHub adapter, executor, Edge runtime event pipeline, WebSocket, or local runtime smoke behavior changes.
---

# Integration Test

The current local runtime smoke entrypoint is `scripts/edge-runtime-smoke.ps1`. The older `scripts/integration-e2e.ps1` is a compatibility wrapper and must not be documented as the primary gate.

## CI-Safe Fixture Smoke

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\edge-runtime-smoke.ps1
```

This starts local Edge, uses a fake process fixture, creates a run, and checks REST + WebSocket events. It does not prove real CLI/model/API execution.

## Approved Real CLI Smoke

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\edge-runtime-smoke.ps1 -RealCli -Runtime claude-code
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\edge-runtime-smoke.ps1 -RealCli -Runtime codex
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\edge-runtime-smoke.ps1 -RealCli -Runtime opencode
```

Run real CLI smoke only when approval, credentials, runtime path, and evidence boundary are explicit. Pair it with `.agents/skills/real-e2e-acceptance/SKILL.md` and record `real_tested=true` only for the exact runtime that executed.

## Assertions

- Edge becomes healthy on the selected local port.
- `POST /v1/runs` returns a run id.
- WebSocket receives events for the same run id.
- Fixture mode emits `run.output.batch` and `run.finished`.
- Real CLI mode emits structured runtime events and a successful terminal event.

## Reporting

Report mode (`fake-process-fixture`, `real-cli`, or skipped), runtime, pass/fail assertions, and the structured JSON output path when provided. Do not call fixture mode full-stack or real execution.
