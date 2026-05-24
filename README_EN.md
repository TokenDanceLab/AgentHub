<div align="center">

# AgentHub

## IM-native Multi-Agent Collaboration Platform

Chat with AI Agents like teammates. @mention them, create group chats, watch code, diffs, and previews unfold inline.

[中文文档](README.md) &nbsp;·&nbsp; [Product Requirements](docs/product-requirements.md) &nbsp;·&nbsp; [System Architecture](docs/system-architecture.md) &nbsp;·&nbsp; [API](api/) &nbsp;·&nbsp; [Website](https://hub.vectorcontrol.tech)

<img src="https://img.shields.io/badge/status-P0--M7_complete-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square" alt="license">

</div>

<br>

## What is AgentHub

AgentHub turns AI coding agents into IM contacts. Instead of switching between terminals and IDEs, you chat with Claude Code, Codex, and OpenCode in a group chat — like you chat with teammates on Feishu or Slack.

**vs. existing tools**: Most Claude Code GUIs are single-player chat shells. AgentHub is a multi-agent collaboration platform — plan with an orchestrator, code with Claude Code, review with a reviewer agent, all in one conversation thread.

<br>

## Architecture

```
Desktop UI ─→ Edge Server ─→ AgentAdapter ─→ Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

| Component | Dir | Responsibility |
|-----------|-----|---------------|
| **Hub Server** | `hub-server/` | Central IM: users, contacts, groups, message routing, multi-device sync, Edge relay |
| **Edge Server** | `edge-server/` | Local node: projects, threads, runs, EventStore, execution lifecycle, Agent CLI adapters, Hub sync |
| **Execution Runtime** | `edge-server/internal/lifecycle/`, `edge-server/internal/adapters/` | Process lifecycle, cancellation, permission gates, Claude/Codex/OpenCode protocol parsing, orchestrator sub-agent dispatch |
| **Desktop App** | `app/desktop/` | Tauri desktop entrypoint and local command center |
| **Web App** | `app/web/` | React IM interface: sidebar, message tree, diff cards, preview panel |
| **Shared App** | `app/shared/` | Shared frontend components, state, API client and event client |

> Earlier drafts used a standalone `runner/` directory. The current implementation folds Runner capabilities into Edge Server. Any machine that runs Edge Server plus Agent CLI adapters is an **Edge Node**.

<br>

## Demo Flow

```
You: @ClaudeCode build a login page with email and OAuth

Orchestrator: Task split into 3 steps — scaffold, implement, review

Claude Code: Created src/LoginPage.tsx with form validation
             [View Diff] [Apply] [Preview]

Reviewer: Found missing loading state. Suggested edge-case handling.

Claude Code: Fixed. Added useFormStatus() and error boundary.

Orchestrator: Done. Preview running at http://localhost:5173
              [Deploy] [Share] [Archive]
```

<br>

## Product Layers

| Layer | Description | Phase |
|-------|------------|:-----:|
| **Desktop Command Center** | Local project, thread, agent lifecycle, worktree, diff, approval, preview | P0 |
| **IM Collaboration** | Direct chat, group chat, @Agent, orchestrator, multi-agent review, agent progress cards | P1 |
| **Hub Network** | Accounts, friends, groups, multi-device sync, Edge relay, team memory | P2-P4 |

<br>

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite + CSS Modules + `@shared/ui` |
| Hub Server | Go 1.25 + Gin + GORM + PostgreSQL + Redis + Hub JWT / TokenDance ID bearer-token middleware |
| Edge Server | Go 1.25 + `net/http` + WebSocket + AgentAdapter |
| Desktop | Tauri 2 |
| Mobile | PWA |
| Realtime | WebSocket (coder/websocket) |
| Database | Hub: PostgreSQL + Redis; Edge: local store / file store |
| Protocol | REST JSON API + WebSocket typed events |

<br>

## Quick Start

After cloning, initialize local development first:

```bash
./scripts/setup.sh
```

Windows PowerShell:

```powershell
.\scripts\setup.ps1
```

To clone core reference repositories:

```powershell
.\scripts\setup.ps1 -Reference core
```

Manual local loop:

```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --claude-code-path claude --agent-default claude-code

cd ..\app\desktop
pnpm install
pnpm dev --port 5199
```

Current local execution path: `Desktop UI -> Local Edge -> AgentAdapter -> Agent CLI`.

<br>

## Project Structure

```
AgentHub/
├── docs/                   # primary docs, handoff, roadmap, archive/reference
│   ├── product-requirements.md
│   ├── system-architecture.md
│   ├── implementation-guide.md
│   ├── handoff/STATE.md    # current project-state SSOT
│   └── reference/          # 69 research and engineering specification documents, including Multica Tier-0 reference
├── app/
│   ├── desktop/            # Tauri desktop app
│   ├── web/                # Web UI
│   └── shared/             # shared frontend components, state and API client
├── hub-server/             # central Hub: auth, IM, groups, sync, relay
├── edge-server/            # local Edge: projects, context, run lifecycle, Agent CLI adapters
├── api/                    # REST API and WebSocket event contracts
└── scripts/                # local setup, git hooks and reference sync scripts
```

Docker and deployment files live with the module that needs them, such as `hub-server/deployments/Dockerfile`, module-level `docker-compose.yml`, or deployment docs. Root compose files are reserved for optional cross-module local orchestration.

<br>

## Documentation

| Document | Description |
|----------|------------|
| [Product Requirements](docs/product-requirements.md) | Product positioning, users, core experience, phases and competition deliverables |
| [System Architecture](docs/system-architecture.md) | Desktop-Edge-Hub, execution lifecycle, communication and authority model |
| [Implementation Guide](docs/implementation-guide.md) | Module ownership, API foundation, P0 implementation order and checks |
| [API Contract](api/) | REST API and WebSocket typed event contract entrypoint |
| [Research Index](docs/reference/) | 69 cross-repo research and engineering specification documents, organized for Agent navigation |
| [Archive](docs/archive/) | Previous detailed docs for architecture, protocol, memory, workspace and planning |

When working inside the `D:\Code\TokenDance` workspace, read root `../AGENTS.md` and `../docs/` for TokenDance-level governance first. Root `../docs/system-architecture.md`, `../docs/identity-auth.md`, and `../docs/design-system.md` define cross-product architecture, identity/auth, and design boundaries; this repository's `docs/` folder owns AgentHub implementation details.

<br>

## TokenDance ID Auth Boundary

AgentHub Hub Server currently has dual JWT compatibility, but the final TokenDance ID browser login callback is not finalized yet. Cross-system identity rules live in [../docs/identity-auth.md](../docs/identity-auth.md).

| Item | Current implementation |
|------|------------------------|
| Callback | Hub Server's TokenDance ID browser-login callback is not finalized; AgentHub Home's site callback is `https://hub.vectorcontrol.tech/api/auth/callback` |
| Token exchange | Hub local login/register still uses `/client/auth/*`; Hub middleware can accept TokenDance ID RS256 bearer tokens |
| Token storage | Hub local login stores Hub JWT on clients; TokenDance ID bearer-token mode does not create a Hub refresh session |
| Refresh | Hub local refresh tokens exist; TokenDance ID refresh is not wired as a Hub browser-login flow |
| Logout | Hub local logout is separate from TokenDance ID `/logout` |
| JWKS validation | `hub-server/internal/middleware/auth.go` tries TokenDance ID RS256/JWKS first, then falls back to Hub local HS256; explicit issuer/audience validation for the TokenDance ID path is still a P0 hardening item |

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
