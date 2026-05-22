# ROADMAP

Last updated: 2026-05-23 00:50 +08:00

## Current Goal

Build the AgentHub backend foundation on branch `feat/backend-foundation`, using `ROADMAP.md` to record progress, decisions, verification, and next steps.

Status: handed off for backend teammate takeover. This branch contains the first backend foundation increment and should be continued by the backend owner rather than extended by the current Codex session.

## Task Card

- Branch: `feat/backend-foundation`
- Worktree: `.worktrees/backend-foundation`
- Owner scope: backend
- Write scope: `go.mod`, `packages/`, `internal/`, `hub-server/`, `edge-server/`, backend-facing docs and this `ROADMAP.md`
- Shared interface impact: REST JSON endpoints already listed in `api/openapi.yaml`; WebSocket typed event envelope in `api/events.md`
- Privacy boundary: no secrets, private machine paths, production data, local agent state, or real server configuration
- Runtime goal note: platform goal storage is unavailable in this session (`thread_goals` table missing), so this file is the durable goal ledger

## Principles

- Match the Hub-Edge-Runner architecture: Hub owns account, IM, sync, relay; Edge owns local project, runner control, local event stream, and Hub sync client.
- Keep `api/openapi.yaml` and `api/events.md` as the protocol authority.
- Prefer a small, running Go module over empty architecture directories.
- Use testable package seams: process entrypoints in `cmd/`, service assembly in service packages, shared HTTP/config/protocol code in focused packages.
- Keep stores replaceable so in-memory foundation code can move to PostgreSQL for Hub and SQLite for Edge without rewriting handlers.
- Use standard library first; add dependencies only when the current implementation needs them.

## Milestones

- [x] Create isolated backend worktree from `origin/master`.
- [x] Establish root Go module for Hub, Edge, and shared packages.
- [x] Add shared REST error/JSON response helpers.
- [x] Add shared service configuration loader.
- [x] Add Hub and Edge executable entrypoints.
- [x] Add Hub and Edge `/v1/health`.
- [x] Add Hub Edge registration/list/get/heartbeat foundation.
- [x] Add shared WebSocket event envelope model.
- [x] Refine package structure to avoid duplicated HTTP fallback behavior.
- [ ] Add Edge event stream foundation with cursor-ready in-memory event log.
- [ ] Add Hub sync upload/list/ack foundation.
- [ ] Add service documentation and smoke-test commands.
- [ ] Run review gates and commit the first backend foundation increment.

## Active Work

- [x] Baseline Go tests pass: `go test ./...`.
- [x] Targeted server/helper tests pass: `go test ./internal/httpapi ./hub-server/internal/hubserver ./edge-server/internal/edgeserver`.
- [x] Handoff requested by user because backend teammate will take over.
- [ ] Add deterministic smoke tests for Hub and Edge entrypoints.
- [ ] Update `hub-server/README.md` and `edge-server/README.md` with current architecture and commands.
- [ ] Run OpenAPI YAML validation after docs/API checks.

## Review Gates

- [x] Baseline verified.
- [x] Tests or deterministic checks updated.
- [ ] Documentation synchronized.
- [ ] Cross-review completed for non-trivial changes.
- [ ] Git status reviewed.
- [ ] Commit created for a coherent backend increment.

## Verification Log

- 2026-05-23 00:46 +08:00: `go test ./...` passed in backend worktree.
- 2026-05-23 00:50 +08:00: `go test ./internal/httpapi ./hub-server/internal/hubserver ./edge-server/internal/edgeserver` passed in backend worktree.

## Handoff Notes

- Current branch: `feat/backend-foundation`.
- Current worktree: `.worktrees/backend-foundation`.
- Implemented: root Go module, shared HTTP JSON/error helpers, shared service config loader, shared protocol event envelope, Hub/Edge process entrypoints, Hub/Edge health endpoints, Hub Edge register/list/get/heartbeat foundation.
- Not implemented yet: Edge WebSocket event stream, Hub sync upload/list/ack, database-backed stores, authentication, service README command updates.
- Recommended next owner action: review this branch, run `go test ./...`, then continue from the unchecked milestones above.

## Backlog

- [ ] Replace Hub in-memory Edge registry with PostgreSQL-backed store and migrations.
- [ ] Add Edge SQLite store and local event persistence.
- [ ] Add authentication boundary for Hub P2 endpoints.
- [ ] Add WebSocket implementation with `coder/websocket` once event replay semantics are defined.
- [ ] Add CI `go test ./...` once backend module is merged.
