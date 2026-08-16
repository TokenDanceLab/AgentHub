# Task Breakdown — Post-Polish Residual Hardening

> pending external archive — see docs/history.md
> last-updated: 2026-07-20
> program: post-visual-polish residual (after gate 89)
> tracking: GITHUB_FULL
> hard rule: **NO big-bang rewrite**; Mobile UI deep refactor out of scope
> strategy: Strangler Fig — thin mobile hubClient + docs authority

## Overview

| Item | Value |
|---|---|
| Total Phases | 2 |
| Total Tasks | 5 |
| Strategy | Strangler + Spec-Driven |
| Super focus | R (Replaceable), P (Ports), E (Environment-agnostic) |

## Phase 79: Docs Authority + Gates Hygiene

| # | Task | Priority | Effort | Depends | Super | Acceptance |
|---|---|---|---|---|---|---|
| T79.1 | Strengthen HISTORICAL banners on cleanup-baseline `docs/plan/*`; MASTER becomes sole live index for post-polish | P0 | S | — | E | plan files explicit non-live; MASTER links post-polish analysis; `verify-doc-ssot.ps1` green |
| T79.2 | Record backend perf gate green + optional workflow_dispatch note in MASTER/roadmap | P1 | S | T79.1 | E | evidence note; no claim of production capacity |

## Phase 80: Mobile hubClient Strangler

| # | Task | Priority | Effort | Depends | Super | Acceptance |
|---|---|---|---|---|---|---|
| T80.1 | Inventory mobile-only surface (errors, WS helpers, fixture snapshot) vs shared SSOT methods | P0 | M | T79.1 | P | analysis note in issue/PR; list keep vs re-export |
| T80.2 | Thin mobile hubClient: re-export shared types/methods; keep mobile-only glue (SecureStore refresh, fixture snapshot, legacy WS types) | P0 | L | T80.1 | R,P | file shrinks; no new REST methods on mobile; `pnpm --filter agenthub-mobile-rn typecheck` (+ focused tests if present) |
| T80.3 | RN-safe boundary note: Mobile remains Hub-only; no Local Edge; document in AGENTS or mobile README | P1 | S | T80.2 | E,U | docs + existing verify scripts still pass |

## Delivery Batches

| Batch | Tasks | Branch | Rationale |
|---|---|---|---|
| B1 | T79.1 + T79.2 | `feat/p79-docs-authority` | docs-only, independent |
| B2 | T80.1 + T80.2 + T80.3 | `feat/p80-mobile-hubclient-thin` | single mobile API surface PR for reviewability |

## Out of Scope

- Live OIDC / secret rotation / packaged Desktop evidence
- Full Mobile UI redesign
- Further Edge handlers split without API change
- Static Visual QA gate chase past 89
