<div align="center">

# AgentHub

## IM-native Multi-Agent Collaboration Platform

Chat with AI Agents like teammates. @mention them, create group chats, and keep code, diffs, approvals, and previews in one conversation thread.

[中文文档](README.md) &nbsp;·&nbsp; [Product Requirements](docs/product-requirements.md) &nbsp;·&nbsp; [System Architecture](docs/system-architecture.md) &nbsp;·&nbsp; [API](api/) &nbsp;·&nbsp; [Website](https://hub.vectorcontrol.tech)

<img src="https://img.shields.io/badge/status-P0--M7_complete-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square" alt="license">

</div>

<br>

## What is AgentHub

AgentHub turns AI coding agents into IM contacts. You can @mention Claude Code for implementation, Codex for review, or a Reviewer profile for feedback, while plans, tool output, diffs, approvals, and previews stay in the same thread.

**vs. existing tools**: most Claude Code GUIs are single-player chat shells. AgentHub is built around multi-agent collaboration and multi-device control: Desktop provides the local command center, Edge Server connects real agent CLIs, and Hub Server owns accounts, IM, sync, and relay.

Current implementation includes three Edge Agent Runtime adapters (Claude Code, Codex, OpenCode), a Tauri Desktop IM workspace, a Gin/GORM/Redis/PostgreSQL Hub Server with 17 migrations, and an Edge-Hub deployment path. Current project state lives in [docs/handoff/STATE.md](docs/handoff/STATE.md) and [docs/roadmap.md](docs/roadmap.md).

<br>

## Architecture

```text
Desktop UI -> Local Edge Server -> Agent Runtime Adapter -> Claude Code / Codex / OpenCode
                         |
                         v
                    Hub Server
```

| Component | Dir | Responsibility |
|---|---|---|
| **Hub Server** | `hub-server/` | Accounts, TokenDance ID relying-party flow, IM, contacts/groups, multi-device sync, device routing, Edge relay, audit |
| **Edge Server** | `edge-server/` | Local/remote execution node: projects, threads, runs, EventStore, execution lifecycle, Agent Runtime adapters, artifact index |
| **Agent Runtime** | `edge-server/internal/adapters/` | Codex, OpenCode, Claude Code CLI/SDK adapters; command construction, protocol parsing, cancellation, capability metadata |
| **Agent Profile** | Hub profile store / Edge local profile | User-managed agent entity: Runtime + Model/Provider + configuration + Skill/MCP + approval policy + Execution Target |
| **Desktop App** | `app/desktop/` | Tauri desktop workspace for Local Edge control, Hub login, multi-device IM, settings, and visual debugging |
| **Web App** | `app/web/` | Browser workspace and page-preview entry for remote viewing, approvals, and collaboration flows |
| **Shared App** | `app/shared/` | Shared frontend types, API/event clients, tree/diff helpers, and `@shared/ui` components |
| **API Contract** | `api/` | REST JSON API and WebSocket typed event contracts |

Earlier drafts had a standalone `runner/` directory. The current execution lifecycle lives in `edge-server/internal/lifecycle/`, and runtime protocol adapters live in `edge-server/internal/adapters/`. Docs and UI must distinguish **Agent Runtime**, **Agent Profile**, **Agent Configuration**, and **Execution Target** instead of calling a raw runtime a configured agent.

<br>

## Core Concepts

| Concept | Meaning | Examples |
|---|---|---|
| **Agent Runtime** | Adapter that can launch and parse a specific agent CLI/SDK. It answers "what runs this". | Claude Code, Codex, OpenCode |
| **Agent Profile** | User-managed agent entity. It answers "who does the work". | `Reviewer on Codex/gpt-5.4-high`, `Builder on Claude Code/sonnet` |
| **Agent Configuration** | Editable rule set attached to a profile. It answers "under what rules". | `AGENTS.md`, memory, context, chat history, workdir, Skill, MCP, model parameters, approval policy |
| **Execution Target** | Where one run actually executes. It answers "where it runs". | Local Edge, Remote Edge over SSH/Tailscale, Cloud Edge, Hub Relay target |

Local execution does not depend on Hub: Desktop can connect only to `127.0.0.1:3210` and complete projects, threads, runs, and Runtime adapter dispatch. Hub enters the path for accounts, team IM, multi-device sync, remote viewing/approval, device routing, and relay.

<br>

## Product Layers

| Layer | Description | Phase |
|---|---|:---:|
| **Desktop Command Center** | Local project, thread, agent lifecycle, worktree, diff, approval, preview | P0 |
| **IM Collaboration** | Direct chat, group chat, @Agent, orchestrator, multi-agent review, progress cards | P1 |
| **Hub Network** | Accounts, friends, groups, multi-device sync, Edge relay, team memory and audit | P2-P4 |

<br>

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite + CSS Modules + OKLCH tokens + `@shared/ui` |
| Desktop | Tauri 2 |
| Edge Server | Go 1.25 + `net/http` + WebSocket + Agent Runtime adapters |
| Hub Server | Go 1.25 + Gin + GORM + PostgreSQL + Redis + Hub session; TokenDance ID bearer middleware is compatibility-only |
| Realtime | WebSocket typed events |
| Database | Hub: PostgreSQL + Redis; Edge: memory/file store |
| Protocol | REST JSON API + WebSocket typed events |

<br>

## Quick Start

Initialize local development after cloning:

```powershell
.\scripts\setup.ps1
```

macOS/Linux:

```bash
./scripts/setup.sh
```

### Recommended Local Loop

The current reliable local path is to start Edge and Desktop manually. `scripts/dev-start.ps1` / `scripts/dev-start.sh` still reference an old Hub command and should not be treated as the recommended entry until fixed.

Terminal 1: Edge Server.

```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --agent-default claude-code
```

Common runtime presets:

```powershell
go run ./cmd/agenthub-edge --runner-profile claude-code
go run ./cmd/agenthub-edge --runner-profile codex
go run ./cmd/agenthub-edge --runner-profile opencode
```

Terminal 2: Desktop Web UI.

```powershell
cd app/desktop
pnpm install
pnpm dev --port 5199
```

Open `http://localhost:5199`. Desktop defaults to `http://127.0.0.1:3210` and `ws://127.0.0.1:3210/v1/events`.

### Hub Development

Hub needs PostgreSQL 16 and Redis 7. Root `docker-compose.yml` can be used for local dependency/service orchestration; for code debugging run:

```powershell
cd hub-server
go run ./cmd/server-hub
```

Defaults come from `hub-server/configs/config.yaml`: Hub HTTP `localhost:8080`, admin/pprof/metrics `localhost:6060`, Redis `localhost:6380`.

### Desktop Build and Checks

```powershell
cd app/desktop
pnpm build
pnpm tauri dev
pnpm test:e2e
```

`pnpm build` only builds the frontend and does not need Rust. `pnpm tauri dev` needs Rust and Tauri system dependencies. Playwright uses `http://localhost:5199`.

Note: `scripts/client-smoke.ps1` still includes historical checks for the removed `runner/` directory. Do not use it as the pass/fail source until that script is fixed.

### Verification

Docs/API changes:

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

Backend changes:

```powershell
cd edge-server
go test ./... -short -count=1

cd ..\hub-server
go test ./... -short -count=1
```

Frontend changes:

```powershell
cd app/desktop
pnpm test
pnpm build
pnpm typecheck

cd ..\web
pnpm typecheck
pnpm build
```

Known limitation: `app/shared/src/ui` React type resolution and pnpm cross-package virtual store behavior can affect some shared-ui tests/typecheck. Separate newly introduced failures from this known limitation in handoff notes.

<br>

## Project Structure

```text
AgentHub/
├── docs/                   # primary docs, handoff, roadmap, archive/reference
│   ├── product-requirements.md
│   ├── system-architecture.md
│   ├── implementation-guide.md
│   ├── handoff/STATE.md    # current project-state SSOT
│   └── reference/          # research and engineering specifications
├── app/
│   ├── desktop/            # Tauri desktop app
│   ├── web/                # Web workspace and page preview
│   └── shared/             # shared frontend components, state, types, API/event clients
├── hub-server/             # central Hub: auth, IM, groups, sync, relay
├── edge-server/            # Edge node: projects, context, run lifecycle, Runtime adapters
├── api/                    # REST API and WebSocket event contracts
└── scripts/                # local setup, git hooks and integration scripts
```

Docker and deployment files live with the module that needs them. Root compose is only for cross-module local orchestration.

<br>

## Documentation

| Document | Description |
|---|---|
| [Product Requirements](docs/product-requirements.md) | Product positioning, users, core experience, phases and competition deliverables |
| [System Architecture](docs/system-architecture.md) | Desktop-Edge-Hub, Agent product model, execution lifecycle, communication and authority boundaries |
| [Implementation Guide](docs/implementation-guide.md) | Implementation order, API update rules, adapter details and checks |
| [Client Roadmap](docs/client-roadmap.md) | Desktop/Edge client milestones and acceptance checks |
| [API Contract](api/) | REST API and WebSocket typed event contract entrypoint |
| [Research Index](docs/reference/) | Cross-repo research and engineering specifications |
| [Archive](docs/archive/) | Previous detailed docs for architecture, protocol, memory, workspace and planning |

When working inside the `D:\Code\TokenDance` workspace, read root `../AGENTS.md` and `../docs/` for TokenDance-level governance first. Root `../docs/system-architecture.md`, `../docs/identity-auth.md`, and `../docs/design-system.md` define cross-product architecture, identity/auth, and design boundaries; this repository's `docs/` folder owns AgentHub implementation details.

<br>

## TokenDance ID Auth Boundary

TokenDance ID is the cross-product identity entry. Hub session is AgentHub's own product session. Final browser/desktop login must be implemented by Hub Server as the TokenDance ID relying party: OIDC Authorization Code + PKCE code exchange, issuer/audience/JWKS ID token validation, `tokendance_sub` to Hub user mapping, and Hub-local access/refresh session issuance.

| Item | Boundary |
|---|---|
| TokenDance ID | Owns unified third-party login and account identity; products do not integrate GitHub/Google/Feishu directly |
| Hub Server | Owns Hub callback, code exchange, Hub user mapping, Hub access/refresh sessions, and device proof |
| Desktop/Web | Opens browser/Web login and stores Hub session; does not store third-party provider tokens |
| Compatibility bearer path | `hub-server/internal/middleware/auth.go` can verify TokenDance ID RS256/JWKS bearer tokens, but this is compatibility-only and does not replace Hub session |
| Local execution | Local Edge + Desktop execution does not require Hub login; Hub session is required for cloud IM, sync, remote control, or relay |

<br>

## References

- [Claude Code Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Multica](https://github.com/multica-ai/multica)
- [LibreChat](https://github.com/danny-avila/LibreChat)
- [Kanna](https://github.com/jakemor/kanna)
- [CloudCLI](https://github.com/siteboon/claudecodeui)

---

<div align="center">
<a href="README.md">中文文档</a> &nbsp;·&nbsp; <a href="docs/product-requirements.md">Product</a> &nbsp;·&nbsp; <a href="docs/system-architecture.md">Architecture</a> &nbsp;·&nbsp; <a href="api/">API</a>
</div>
