<div align="center">

# AgentHub

## IM-native Multi-Agent Collaboration Platform

Chat with AI Agents like teammates. @mention them, create group chats, watch code, diffs, and previews unfold inline.

[中文文档](README.md) &nbsp;·&nbsp; [Product Requirements](docs/product-requirements.md) &nbsp;·&nbsp; [System Architecture](docs/system-architecture.md) &nbsp;·&nbsp; [API](api/)

<img src="https://img.shields.io/badge/status-research-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.24+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="license">

</div>

<br>

## What is AgentHub

AgentHub turns AI coding agents into IM contacts. Instead of switching between terminals and IDEs, you chat with Claude Code, Codex, and OpenCode in a group chat — like you chat with teammates on Feishu or Slack.

**vs. existing tools**: Most Claude Code GUIs are single-player chat shells. AgentHub is a multi-agent collaboration platform — plan with an orchestrator, code with Claude Code, review with a reviewer agent, all in one conversation thread.

<br>

## Architecture

```
Desktop UI ─→ Edge Server ─→ Runner ─→ Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

| Component | Dir | Responsibility |
|-----------|-----|---------------|
| **Hub Server** | `hub-server/` | Central IM: users, contacts, groups, message routing, multi-device sync, Edge relay |
| **Edge Server** | `edge-server/` | Local node: projects, memory, context, runner management, syncs to Hub |
| **Runner** | `runner/` | Executor: workspace, process lifecycle, Agent CLI adapters, diff/preview/logs |
| **Desktop App** | `app/desktop/` | Tauri desktop entrypoint and local command center |
| **Web App** | `app/web/` | React IM interface: sidebar, message tree, diff cards, preview panel |
| **Shared App** | `app/shared/` | Shared frontend components, state, API client and event client |

> Every machine that runs a Runner is an **Edge Node** — your laptop, a remote server, or a cloud VM.

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
| Frontend | React 19 + TypeScript + Vite + shadcn/ui |
| Hub / Edge / Runner | Go 1.24 |
| Desktop | Tauri 2 |
| Mobile | PWA |
| Realtime | WebSocket (coder/websocket) |
| Database | SQLite + FTS5 (modernc.org/sqlite) |
| Protocol | REST JSON API + WebSocket typed events |
| Editor | Monaco Editor |

<br>

## Quick Start

```bash
# Edge Server (local node)
cd edge-server && go run ./cmd/main.go

# Runner (agent executor)
cd runner && go run ./cmd/main.go

# Web UI
cd app/web && pnpm dev
```

> P0 does not require Hub Server. Edge + Runner work offline.

<br>

## Project Structure

```
AgentHub/
├── docs/                   # three primary docs + archive/reference/research
│   ├── product-requirements.md
│   ├── system-architecture.md
│   ├── implementation-guide.md
│   └── reference/          # 69 research and engineering specification documents, including Multica Tier-0 reference
├── app/
│   ├── desktop/            # Tauri desktop app
│   ├── web/                # Web UI
│   └── shared/             # shared frontend components, state and API client
├── hub-server/             # central Hub: auth, IM, groups, sync, relay
├── edge-server/            # local Edge: projects, context, Runner management
├── runner/                 # executor: Agent CLI, workspace, diff, preview, logs
├── api/                    # REST API and WebSocket event contracts
├── scripts/
└── .agenthub/              # project memory and rules
```

Docker files are colocated with the module that needs them, such as `hub-server/Dockerfile`, `edge-server/compose.yaml`, or `runner/Dockerfile`. A root `compose.yaml` is only for optional cross-module local orchestration.

<br>

## Documentation

| Document | Description |
|----------|------------|
| [Product Requirements](docs/product-requirements.md) | Product positioning, users, core experience, phases and competition deliverables |
| [System Architecture](docs/system-architecture.md) | Hub-Edge-Runner, component responsibilities, communication and authority model |
| [Implementation Guide](docs/implementation-guide.md) | Module ownership, API foundation, P0 implementation order and checks |
| [API Contract](api/) | REST API and WebSocket typed event contract entrypoint |
| [Research Index](docs/reference/) | 69 cross-repo research and engineering specification documents, organized for Agent navigation |
| [Archive](docs/archive/) | Previous detailed docs for architecture, protocol, memory, workspace and planning |

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
