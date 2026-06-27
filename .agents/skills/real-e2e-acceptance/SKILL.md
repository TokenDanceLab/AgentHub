---
name: real-e2e-acceptance
description: Use when AgentHub work claims real E2E, approved-real, release readiness, packaged Desktop behavior, full-stack data flow, performance acceptance, or before merging branches that change UI workflows, Hub/Edge behavior, runtime execution, login, packaging, or test gates.
---

# Real E2E Acceptance

## Overview

Real E2E acceptance means the evidence level matches the claim. It is a gate bundle, not one command: automated Playwright, Visual QA, backend/API checks, observed or approved-real runtime paths, and packaging gates are selected according to the touched surface.

Stubbed, fixture, Vite renderer, observed-local, approved-real, and packaged-release checks are different evidence levels and must not be mixed.

## When To Use

- Before saying a branch is ready to merge because E2E passed.
- Before claiming real login, real CLI/model/API, packaged Tauri, installer, icon, sidecar, signing, release, performance, or memory-leak acceptance.
- When adding or changing `scripts/verify-*`, Playwright specs, visual checks, API contracts, Hub/Edge routes, Desktop/Web/Mobile workflows, or runtime adapters.
- When reviewing a handoff, PR, or roadmap item that says "real", "approved-real", "full stack", "release gate", "真实闭环", or "端到端".

## Evidence Levels

| Level | Proves | Does Not Prove |
|---|---|---|
| Fixture/unit | Pure contracts, normalizers, model logic | Network, browser, runtime, packaging |
| Playwright UI E2E | Real browser interaction, ordering, scrolling, route guards, visible state | Packaged Tauri, real login, real CLI/model/API |
| Visual QA | Screenshot, pixel/geometry, responsive layout, occlusion/overflow, visual regressions | Data correctness, backend health, runtime execution |
| Stubbed Hub | Hub-shaped Web contracts without live backend | Real Hub availability, auth, model spend |
| Observed local | Real local Edge/Hub read or no-spend dispatch path | Cloud/prod, real model/API spend, packaged installer |
| Approved real | Explicitly approved real login, CLI, model, API, or spend path | Packaged installer or release unless that gate ran |
| Backend/API | Hub/Edge handlers, service contracts, auth/permission checks | Browser UX, renderer geometry, packaged Desktop |
| Performance/leak | Benchmarks, load checks, pprof/leak evidence for the claimed path | Functional correctness unless paired with behavior tests |
| Packaged release | Tauri sidecar/icon/installer/signing/update behavior | Runtime/model correctness unless paired with runtime gates |

Use the narrowest accurate wording. Stubbed or manifest-only reports must include `real_tested=false`.

Smoke matrix manifests must be machine-honest:

- Every row records `evidence_level`, `real_tested`, `status`, and a short `claim`.
- Top-level `evidence_levels` includes only non-skipped rows that actually ran.
- Skipped gates may appear only under `skipped_evidence_levels` and row-level `status: "skipped"`.
- Stubbed Hub rows use `evidence_level: "stubbed-hub"` and `real_tested: false`; they must not be named or reported as real login/model/API execution.
- Desktop Vite rows use Playwright/UI wording; packaged Desktop claims require a separate packaged-release row.

## Gate Matrix

| Claim | Minimum useful gates |
|---|---|
| Chat/UI workflow is fixed | Unit/contract + automated Playwright UI E2E + Visual QA screenshot/geometry |
| Web Hub replay works | Playwright with Hub stub + boundary assertions + `real_tested=false` manifest when stubbed |
| Local Desktop/Edge works | Desktop renderer E2E + observed local Edge/Hub checks after entry/runtime phase split |
| Real login or real model/API works | Explicit approved-real run, no silent fallback, evidence of the live path and cost/risk boundary |
| Hub/Edge API behavior changed | Go tests for touched service/handler + API contract check + relevant browser/runtime E2E |
| Performance or leak is accepted | Targeted benchmark/load/pprof/leak gate plus behavior gate for the same path |
| Packaged Desktop is ready | Tauri package gate plus sidecar/sqlite/icon/installer/signing/update evidence as claimed |

## Required Workflow

1. **Scope first**: list touched surfaces: `app/shared`, `app/web`, `app/desktop`, `app/mobile-rn`, `hub-server`, `edge-server`, `api`, `.github`, `scripts`, docs.
2. **Map claims to gates**: for every claim, name the command or artifact that proves it. If no command exists, the claim is not accepted.
3. **Run focused gates**:
   - Always: `git diff --check` and stale-wording search for the changed scope.
   - API/docs: parse `api/openapi.yaml` and sync `docs/architecture.md`, `docs/roadmap.md`, or affected child docs.
   - Web/Desktop UI: Vitest/typecheck/build plus automated Playwright and `test:visual:*` or equivalent Visual QA evidence.
   - Mobile: `corepack pnpm --dir app/mobile-rn verify` when Mobile or shared RN-safe contracts changed.
   - Hub/Edge: `go test ./... -short -count=1` in each touched Go service; run targeted benchmarks or load/pprof checks for performance or leak claims.
   - Packaging: Tauri package/sidecar/icon/signing gates only when claiming packaged Desktop behavior.
4. **Read the output**: record pass counts, failed tests, warnings, screenshot paths, manifests, and artifact paths. A screenshot produced before a timeout is not a pass; fix teardown and rerun.
5. **Write the boundary**: state what was not tested, especially real login, real CLI/model/API spend, production deploy, installer, signing, and release upload.
6. **Sync docs and rules**: durable behavior changes go to `AGENTS.md`, `docs/architecture.md`, `docs/roadmap.md`, relevant `docs/architecture/*`, active `docs/progress/MASTER.md`, or a completed archive `MASTER.md`. Do not create duplicate truth sources.
7. **Merge gate**: before merging, verify architecture docs are either unchanged by design or updated, workflow gates passed, and no debug/mock/mode metadata was added to the main chat stream.

## Common Mistakes

- Treating `test:e2e:stubbed-hub` as real Hub login or real model execution.
- Treating Desktop Vite E2E as Tauri sidecar, sqlite, icon, installer, or WebView proof.
- Counting a visual screenshot after the script timed out.
- Relaxing a test, route guard, or mode boundary to make a gate green.
- Adding diagnostic/mode/mock details into transcript bubbles instead of status, settings, manifest, or test evidence surfaces.
