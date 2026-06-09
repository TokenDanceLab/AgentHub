# AgentHub

AgentHub is an open-source workbench for AI agent collaboration. It connects Web, Desktop, Mobile, Hub Server, Edge Server, and multiple CLI runtimes into one IM-style workflow for projects, agents, approvals, replay, artifacts, and local execution targets.

[中文](README.md) · [Website](https://hub.vectorcontrol.tech) · [Roadmap](docs/roadmap.md) · [API](api/)

![status](https://img.shields.io/badge/status-active_development-blue?style=flat-square)
![version](https://img.shields.io/badge/version-0.3.0--rc.7-orange?style=flat-square)
![go](https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go)
![react](https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react)
![license](https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square)

## Status

AgentHub is moving toward the `v0.3.0-rc.7` candidate. The active path is to stabilize `dev/delicious233`, promote it to `master`, then publish Windows Desktop and Android preview evidence.

| Area | Status | Notes |
|---|---|---|
| Web workbench | Development-ready | Hub projects, tasks, approvals, artifacts, project group threads, and agent message contracts are wired |
| Desktop workbench | Development-ready | Tauri 2, local Edge/CLI readiness, and Windows packaging gates are being closed |
| Mobile | Merged to dev | Expo / React Native lives in `app/mobile-rn`; Android/iOS release gates still need device evidence |
| Hub Server | Development-ready | Projects, AgentProfile, ExecutionTarget, tasks, approvals, and message contracts are active |
| Edge Server | Development-ready | CLI adapters, SQLite readiness, SDK fixtures, and local evidence gates are being hardened |
| Real login / real CLI | Not complete | TokenDanceID and real CLI/model/API usage require separate approved-real evidence |

## Quick Start

### Requirements

- Go 1.25+
- Node.js 20+
- pnpm / Corepack
- Rust, Tauri prerequisites, and Windows toolchain for Desktop packaging

### Install

```powershell
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
corepack enable
corepack pnpm install --dir app --frozen-lockfile
```

### Run Hub Server

```powershell
cd hub-server
go test ./... -short
go run ./cmd/agenthub-hub
```

### Run Web

```powershell
cd app
corepack pnpm --filter agenthub-web dev
```

### Run Desktop

```powershell
cd app
corepack pnpm --filter agenthub-desktop dev
```

Desktop connects to a local Edge/sidecar for local execution. Real CLI calls require the matching local CLI setup and readiness evidence for no-secret / no-spend boundaries.

## Architecture

```text
Web / Desktop / Mobile
        |
        v
Hub Server  <---->  TokenDanceID
        |
        v
Local Edge / Remote Edge
        |
        v
Claude Code / Codex / OpenCode / SDK fixtures
```

| Path | Purpose |
|---|---|
| `app/web` | Browser workbench |
| `app/desktop` | Tauri Desktop workbench |
| `app/mobile-rn` | Expo / React Native Mobile |
| `app/shared` | Shared UI, types, transcript logic, API client |
| `hub-server` | Hub API, sessions, projects, tasks, messages, approvals |
| `edge-server` | Local execution node, CLI adapters, SQLite store, event replay |
| `api` | OpenAPI and event contracts |
| `tests/scripts` | Release, readiness, and approved-real gates |
| `docs` | Roadmap, state, architecture, and governance docs |

## Boundaries

| Capability | Current contract |
|---|---|
| Mock / fixture | Used for local development, CI, and no-secret proof; not real login or real model execution |
| Real mode | Requires TokenDanceID, Hub, Desktop/Edge, CLI adapter, and redacted evidence together |
| Windows Release | Unsigned / artifact-only readiness is allowed first; signing and updater publication need approval |
| Android Release | Mobile is merged to dev; release needs dev-build/device/AuthSession/SecureStore/Push/Hub evidence |
| macOS Release | Policy gate only for now; signing, notarization, and upload are separate approval slices |

## Verification

```powershell
# Web
cd app
corepack pnpm --filter agenthub-web typecheck
corepack pnpm --filter agenthub-web test

# Hub
cd ..\hub-server
go test ./... -short

# Edge
cd ..\edge-server
go test ./... -short

# Release readiness
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-release-gate.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-token-dance-id-login-readiness.ps1 -RepoRoot .
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-p0-approved-real-gold-path.ps1 -RepoRoot .
```

## Release Flow

1. Stabilize `dev/delicious233` with green CI.
2. Clean or close outdated PRs and worktrees.
3. Open a fresh `dev/delicious233 -> master` promotion PR.
4. Tag `v0.3.0-rc.7` after `master` is updated.
5. Produce Windows Desktop and Android preview evidence; signing, notarization, and store release require separate approval.

## Documentation

- [Roadmap](docs/roadmap.md)
- [Current state](STATE.md)
- [Architecture](docs/architecture.md)
- [API contract](api/)
- [Security risk register](docs/governance/security-risk-register.md)
- [TokenDanceID login readiness](docs/audit/token-dance-id-login-readiness.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
