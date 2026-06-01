<div align="center">

# AgentHub

## IM-native Multi-Agent Collaboration Platform

Chat with AI Agents like teammates. @mention them, create group chats, and keep code, diffs, approvals, and previews in one conversation thread.

[中文文档](README.md) &nbsp;·&nbsp; [Product Requirements](docs/architecture/product-requirements.md) &nbsp;·&nbsp; [System Architecture](docs/architecture/system-architecture.md) &nbsp;·&nbsp; [API](api/) &nbsp;·&nbsp; [Website](https://hub.vectorcontrol.tech)

<img src="https://img.shields.io/badge/status-P0_Complete-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square" alt="license">

</div>

<br>

## What is AgentHub

AgentHub turns AI coding agents into IM contacts. @mention Claude Code for implementation, Codex for review, or a Reviewer profile for feedback. Plans, execution, diffs, approvals, and previews all stay in the same conversation thread without switching between tools.

Unlike single-player chat shells, AgentHub is built for multi-agent collaboration and multi-device control: Desktop is your local command center, Edge Server runs real agent CLIs on your machine, and Hub Server owns accounts, IM, multi-device sync, and remote relay.

Create a group, add Builder, Reviewer, and Tester profiles. Builder writes code, Reviewer inspects diffs, Tester runs tests. All output and decisions stay visible in the group chat. Approval cards, progress updates, and artifact previews are native IM collaboration experiences.

AgentHub supports Claude Code, Codex, and OpenCode runtimes out of the box. Agent Profiles combine runtime, model, skills, MCP tools, and approval policies into reusable configurations that sync across your devices.

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

### Start Edge Server

```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --agent-default claude-code
```

Common runtime presets:

```powershell
go run ./cmd/agenthub-edge --agent-default claude-code
go run ./cmd/agenthub-edge --agent-default codex
go run ./cmd/agenthub-edge --agent-default opencode
```

### Start Desktop

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

### Desktop Build

```powershell
cd app/desktop
pnpm build
pnpm tauri dev
```

`pnpm build` only builds the frontend and does not need Rust. `pnpm tauri dev` needs Rust and Tauri system dependencies.

<br>

## Project Structure

```text
AgentHub/
├── docs/                   # primary docs, handoff, roadmap, archive/reference
│   ├── architecture/       # product requirements, system architecture, implementation guide
│   ├── governance/         # branch governance, doc standards, security risk register
│   ├── operations/         # client roadmap, deployment records
│   ├── handoff/STATE.md    # current project-state SSOT
│   ├── roadmap.md          # master roadmap
│   ├── reference/          # research and engineering specifications
│   └── archive/            # historical archive
├── app/
│   ├── desktop/            # Tauri desktop app
│   ├── web/                # Web workspace and page preview
│   ├── mobile/             # Mobile lightweight IM, approvals, and previews
│   └── shared/             # shared frontend components, state, types, API/event clients
├── hub-server/             # central Hub: auth, IM, groups, sync, relay
├── edge-server/            # Edge node: projects, context, run lifecycle, Runtime adapters
├── api/                    # REST API and WebSocket event contracts
└── scripts/                # local setup, git hooks and integration scripts
```

<br>

## Documentation

| Document | Description |
|---|---|
| [Product Requirements](docs/architecture/product-requirements.md) | Product positioning, users, core experience, phases and competition deliverables |
| [System Architecture](docs/architecture/system-architecture.md) | Desktop-Edge-Hub, Agent product model, execution lifecycle, communication and authority boundaries |
| [Implementation Guide](docs/architecture/implementation-guide.md) | Implementation order, API update rules, adapter details and checks |
| [Client Roadmap](docs/operations/client-roadmap.md) | Desktop/Edge client milestones and acceptance checks |
| [API Contract](api/) | REST API and WebSocket typed event contract entrypoint |
| [Research Index](docs/reference/) | Cross-repo research and engineering specifications |
| [Archive](docs/archive/) | Previous detailed docs for architecture, protocol, memory, workspace and planning |

<br>

## Auth

AgentHub uses TokenDance ID for unified login. Hub Server manages its own session layer. Local execution works without login; Hub connectivity is required for cloud IM, multi-device sync, and remote control.

<br>

## References

- [Claude Code Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [OpenCode](https://github.com/sst/opencode)
- [Multica](https://github.com/multica-ai/multica)
- [LibreChat](https://github.com/danny-avila/LibreChat)
- [Kanna](https://github.com/jakemor/kanna)
- [CloudCLI](https://github.com/siteboon/claudecodeui)

---

<div align="center">
<a href="README.md">中文文档</a> &nbsp;·&nbsp; <a href="docs/architecture/product-requirements.md">Product</a> &nbsp;·&nbsp; <a href="docs/architecture/system-architecture.md">Architecture</a> &nbsp;·&nbsp; <a href="api/">API</a>
</div>
